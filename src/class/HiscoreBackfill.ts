import {existsSync, readdirSync, statSync} from 'fs';
import {join} from 'path';
import {MameHiExtractor} from '@arcadoolic/mhiex';
import type {TableRow} from '@/class/ScoreDiff';

// Development only: the hiscores already on this cabinet (<mame home>/hiscore, nvram), to fill
// MAUI-API with realistic data through the score outbox (ScoreOutbox.ts, BO MAUI > Online).
// maui-api's `php artisan dev:reset-scores` empties them again.

export interface CabinetTable {
    romname: string;
    // When the file was written: the best guess of when its scores were made.
    achievedAt: string;
    rows: TableRow[];
}

/** The default table of every game mhiex reads among the cabinet's .hi and nvram files. */
export async function readCabinetTables(mameHome: string): Promise<CabinetTable[]> {
    const extractor = new MameHiExtractor(mameHome);
    const listed = (dir: string, keep: (name: string) => string | null) => existsSync(join(mameHome, dir))
        ? readdirSync(join(mameHome, dir)).map(keep).filter((name): name is string => name !== null)
        : [];
    const romnames = new Set([
        ...listed('hiscore', name => name.endsWith('.hi') ? name.slice(0, -3) : null),
        ...listed('nvram', name => name),
    ]);
    const tables: CabinetTable[] = [];
    for (const romname of [...romnames].sort()) {
        const files = extractor.files(romname);
        if (!files) {
            continue;
        }
        const paths = [files.hi ? join('hiscore', `${romname}.hi`) : null, files.nvram]
            .filter((path): path is string => path !== null)
            .map(path => join(mameHome, path))
            .filter(existsSync);
        if (paths.length === 0) {
            continue;
        }
        try {
            const read = await extractor.get(romname);
            if (!read) {
                continue;
            }
            const writtenAt = Math.max(...paths.map(path => statSync(path).mtimeMs));
            tables.push({romname, achievedAt: new Date(writtenAt).toISOString(), rows: read.extract(false).scores.default});
        } catch {
            // A file mhiex cannot decode (another layout): nothing to send for this game.
        }
    }
    return tables;
}
