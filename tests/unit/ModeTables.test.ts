import {describe, it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {ScoreCapture} from '@/class/ScoreCapture';
import {LeaderboardSync} from '@/class/LeaderboardSync';
import type {MauiApiClient, ScoreSubmission} from '@/class/MauiApiClient';
import {localTableName, modeTables, otherTables} from '@/class/ModeTables';
import {MODE_SHOWN_MS, tableAt} from '@/class/ModeRotation';

describe('mode tables', () => {
    it('lists a game ranking several modes, default first', () => {
        expect(modeTables('magdrop2')).toEqual([{id: 'default', label: 'Puzzle'}, {id: 'vs_cpu', label: 'VS CPU'}]);
        expect(otherTables('magdrop2')).toEqual(['vs_cpu']);
        expect(modeTables('raiden')).toEqual([]);
        expect(localTableName('default')).toBe('');
        expect(localTableName('vs_cpu')).toBe('vs_cpu');
    });

    it('shows them in turn, and nothing for a single table', () => {
        const tables = modeTables('magdrop2');
        expect([0, MODE_SHOWN_MS - 1, MODE_SHOWN_MS, 2 * MODE_SHOWN_MS].map(now => tableAt(tables, now)?.id))
            .toEqual(['default', 'default', 'vs_cpu', 'default']);
        expect(tableAt([], 0)).toBeNull();
    });
});

/** A magdrop2 saveram holding one score at the top of table 1 (VS CPU) and of table 3 (Puzzle). */
function saveram(vsCpu: number, puzzle: number): Buffer {
    const tables = Buffer.alloc(150);
    for (const [index, score] of [[0, vsCpu], [2, puzzle]]) {
        Buffer.from(String(score).padStart(8, '0'), 'hex').copy(tables, index * 50);
        // NOB in the game's charset: 0x40 + 4 * letter.
        Buffer.from([0x74, 0x78, 0x44, 0]).copy(tables, index * 50 + 20);
    }
    const ram = Buffer.alloc(65536);
    tables.swap16().copy(ram, 0x528);
    return ram;
}

describe('a game with two modes, ONLINE', () => {
    it('sends the new score of each mode with its table', async () => {
        const mameHome = mkdtempSync(join(tmpdir(), 'maui-modes-'));
        mkdirSync(join(mameHome, 'nvram', 'magdrop2'), {recursive: true});
        const write = (ram: Buffer) => writeFileSync(join(mameHome, 'nvram', 'magdrop2', 'saveram'), ram);
        const added: ScoreSubmission[] = [];
        const capture = new ScoreCapture({
            store: {add: async rows => void added.push(...rows), due: async () => [], remove: async () => {}, reschedule: async () => {}},
            mameHome: () => mameHome,
            enabled: () => true,
            players: async () => [{pseudo_3: 'NOB', active: true, remote_id: 'id-NOB', is_public: true, online_status: 'active'}],
            startupId: () => null,
            flush: () => {},
        });
        write(saveram(3500, 15000));
        await capture.started('magdrop2');
        write(saveram(9982, 38032));
        await capture.ended('magdrop2');
        rmSync(mameHome, {recursive: true, force: true});

        expect(added.map(score => [score.table ?? 'default', score.score]).sort())
            .toEqual([['default', 38032], ['vs_cpu', 9982]]);
    });

    it('asks the mode leaderboards apart', async () => {
        const asked: unknown[][] = [];
        const client = {getLeaderboards: async (...args: unknown[]) => {
            asked.push(args);
            return {kind: 'ok', value: {notModified: true}};
        }} as unknown as MauiApiClient;
        const sync = new LeaderboardSync({
            store: {save: async () => {}},
            avatars: {has: () => true, save: () => {}},
            romnames: async () => ['dkong', 'magdrop2'],
            otherTables: romname => romname === 'magdrop2' ? ['vs_cpu'] : [],
        });
        await sync.refresh(client, 'magdrop2');

        expect(asked).toEqual([
            [['magdrop2'], null], [['magdrop2'], null, 'vs_cpu'],
            [['dkong', 'magdrop2'], null], [['magdrop2'], null, 'vs_cpu'],
        ]);
    });
});
