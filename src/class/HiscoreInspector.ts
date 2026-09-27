import {existsSync, readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import {MameHiExtractor} from '@arcadoolic/mhiex';
import {hasHiscoreExtraction, scorePseudo3} from '@/class/HiscoreSupport';

/**
 * What the BO's Hiscores page shows about one rom: which files mame wrote for it, what mhiex
 * decodes from them, and what MAUI does with each row (HiscoreService.saveHiscores()).
 * Electron-free and database-free: the caller passes the players and the stored scores in.
 */

export interface HiscoreFileInfo {
    // Relative to the mame home directory, e.g. "hiscore/dkong.hi" or "nvram/qbert/nvram"
    name: string;
    path: string;
    size: number;
    modified: Date;
    // Size hiscore.dat expects for a .hi file, when known
    expectedSize: number | null;
}

// saved: in the database. pending: its player exists, saveHiscores() stores it the next time it
// reads the file (MAUI start, end of a game). ignored: no player has this nickname.
// extra: an alternate table (extras), which saveHiscores() does not store.
export type HiscoreRowStatus = 'saved' | 'pending' | 'ignored' | 'extra';

export interface InspectedRow {
    rank: number;
    score: number | string;
    name: string;
    pseudo3: string;
    status: HiscoreRowStatus;
}

export interface InspectedTable {
    // null for the main table (mhiex's "default")
    id: string | null;
    rows: InspectedRow[];
}

export type HiscoreState = 'unsupported' | 'no-file' | 'ok' | 'error';

export interface HiscoreReport {
    romName: string;
    state: HiscoreState;
    error?: string;
    files: HiscoreFileInfo[];
    tables: InspectedTable[];
}

export interface StoredScore {
    pseudo3: string;
    rank: number;
    score: number;
}

/** Files mame keeps for a rom: its hiscore plugin's .hi, and the driver's own nvram directory. */
export function listHiscoreFiles(mameHome: string, romName: string, expectedSizes: Map<string, number> | null = null): HiscoreFileInfo[] {
    const files: HiscoreFileInfo[] = [];
    const hiPath = join(mameHome, 'hiscore', `${romName}.hi`);
    if (existsSync(hiPath)) {
        const stat = statSync(hiPath);
        files.push({
            name: `hiscore/${romName}.hi`, path: hiPath, size: stat.size, modified: stat.mtime,
            expectedSize: expectedSizes?.get(romName) ?? null,
        });
    }
    const nvramDir = join(mameHome, 'nvram', romName);
    if (existsSync(nvramDir) && statSync(nvramDir).isDirectory()) {
        for (const file of readdirSync(nvramDir).sort()) {
            const path = join(nvramDir, file);
            const stat = statSync(path);
            if (stat.isFile()) {
                files.push({name: `nvram/${romName}/${file}`, path, size: stat.size, modified: stat.mtime, expectedSize: null});
            }
        }
    }
    return files;
}

export async function inspectHiscores(
    mameHome: string, romName: string, playerPseudos: Set<string>, stored: StoredScore[],
    expectedSizes: Map<string, number> | null = null,
): Promise<HiscoreReport> {
    const files = listHiscoreFiles(mameHome, romName, expectedSizes);
    if (!hasHiscoreExtraction(romName)) {
        return {romName, state: 'unsupported', files, tables: []};
    }
    let scores;
    try {
        const extractor = await new MameHiExtractor(mameHome).get(romName);
        if (!extractor) {
            return {romName, state: 'unsupported', files, tables: []};
        }
        scores = extractor.extract(true).scores;
    } catch (error) {
        // Same case HiscoreService.saveHiscores() skips: the game has not written its file yet
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {romName, state: 'no-file', files, tables: []};
        }
        return {romName, state: 'error', error: error instanceof Error ? error.message : String(error), files, tables: []};
    }

    const isStored = (pseudo3: string, rank: number, score: number | string) =>
        stored.some(s => s.pseudo3 === pseudo3 && s.rank === rank && s.score === Number(score));
    const inspect = (rows: {rank: number; score: number | string; name: string}[], extra: boolean): InspectedRow[] =>
        rows.map(row => {
            const pseudo3 = scorePseudo3(row.name);
            let status: HiscoreRowStatus;
            if (extra) status = 'extra';
            else if (!playerPseudos.has(pseudo3)) status = 'ignored';
            else status = isStored(pseudo3, row.rank, row.score) ? 'saved' : 'pending';
            return {rank: row.rank, score: row.score, name: row.name, pseudo3, status};
        });

    const tables: InspectedTable[] = [{id: null, rows: inspect(scores.default || [], false)}];
    for (const [id, rows] of Object.entries(scores.extras || {})) {
        tables.push({id, rows: inspect(rows as InspectedRow[], true)});
    }
    return {romName, state: 'ok', files, tables};
}

/** rom -> total size of its hiscore.dat memory ranges, i.e. the size of the .hi file it writes */
export function parseHiscoreDatSizes(content: string): Map<string, number> {
    const sizes = new Map<string, number>();
    let names: string[] = [];
    let inRanges = false;
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';')) continue;
        if (line.startsWith('@')) {
            inRanges = true;
            const parts = line.split(',');
            if (parts.length > 3) {
                for (const name of names) sizes.set(name, (sizes.get(name) || 0) + parseInt(parts[3], 16));
            }
        } else if (line.endsWith(':')) {
            if (inRanges) {
                names = [];
                inRanges = false;
            }
            names.push(line.slice(0, -1));
        }
    }
    return sizes;
}

export function readHiscoreDatSizes(hiscoreDatPath: string | null): Map<string, number> | null {
    if (!hiscoreDatPath || !existsSync(hiscoreDatPath)) return null;
    return parseHiscoreDatSizes(readFileSync(hiscoreDatPath, 'latin1'));
}

/** Classic 16 bytes per line dump: offset, hex bytes, printable ASCII. */
export function hexDump(buffer: Buffer, maxBytes = 4096): {lines: string[]; truncated: boolean} {
    const lines: string[] = [];
    const length = Math.min(buffer.length, maxBytes);
    for (let offset = 0; offset < length; offset += 16) {
        const chunk = buffer.subarray(offset, Math.min(offset + 16, length));
        const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = [...chunk].map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
        lines.push(`${offset.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
    }
    return {lines, truncated: buffer.length > maxBytes};
}
