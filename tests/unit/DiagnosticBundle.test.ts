import {afterEach, beforeEach, describe, it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'fs';
import {join} from 'path';
import {gunzipSync, gzipSync} from 'zlib';
import os from 'os';
import {buildDiagnosticBundle, filterLog, MAX_SIZE, type DiagnosticSources} from '@/class/DiagnosticBundle';
import {listHiscoreFiles, type HiscoreReport} from '@/class/HiscoreInspector';

const NOW = new Date(2026, 9, 26, 12, 0, 0);
const SQL = '[2026-10-26 08:06:29.100] [info] Executing (default): INSERT INTO `game` (`id_game`) VALUES (NULL)';
const SCORES = '[2026-10-25 17:21:42.655] [debug] [HiscoreService] Scores to save for game 6.';
const OLDER = '[2026-10-24 09:00:00.000] [debug] [HiscoreService] Scores to save for game 3.';

describe('filterLog', () => {
    it('drops the SQL lines and masks what looks like a secret', () => {
        const text = [
            SQL,
            '{',
            '  plain: false,',
            '  raw: false,',
            '}',
            SCORES,
            '[2026-10-26 08:06:30.000] [warn] nmcli failed: password=hunter2 token: "abc123"',
            '[2026-10-26 08:06:31.000] [info] Authorization: Bearer mk_secret_token',
        ].join('\n');

        expect(filterLog(text)).toBe([
            SCORES,
            '[2026-10-26 08:06:30.000] [warn] nmcli failed: password=*** token: "***"',
            '[2026-10-26 08:06:31.000] [info] Authorization: Bearer ***',
        ].join('\n'));
    });
});

describe('buildDiagnosticBundle', () => {
    let home: string;
    let captures: string;
    let logs: string;

    beforeEach(() => {
        home = mkdtempSync(join(os.tmpdir(), 'maui-mame-'));
        captures = mkdtempSync(join(os.tmpdir(), 'maui-captures-'));
        logs = mkdtempSync(join(os.tmpdir(), 'maui-logs-'));
        mkdirSync(join(home, 'hiscore'));
        mkdirSync(join(home, 'nvram', 'centiped'), {recursive: true});
        writeFileSync(join(home, 'hiscore', 'centiped.hi'), Buffer.from([1, 2, 3]));
        writeFileSync(join(home, 'nvram', 'centiped', 'earom'), Buffer.from([4, 5]));
    });

    afterEach(() => {
        for (const dir of [home, captures, logs]) {
            rmSync(dir, {recursive: true, force: true});
        }
    });

    function inspection(): HiscoreReport {
        return {
            romName: 'centiped', state: 'ok', sources: {hi: true, nvram: 'earom'},
            files: listHiscoreFiles(home, 'centiped'),
            tables: [{id: null, rows: [{rank: 1, score: 16543, name: 'NOB', pseudo3: 'NOB', status: 'pending'}]}],
        };
    }

    function sources(overrides: Partial<DiagnosticSources> = {}): DiagnosticSources {
        return {
            romName: 'centiped', comment: '  15000 missing  ', inspection: inspection(),
            versions: {maui: '2.19.0', mhiex: '2.2.6', mame: '0.289'},
            logDir: logs, capturesRoot: captures, now: NOW, ...overrides,
        };
    }

    function archive(name: string, text: string, modified: Date): void {
        writeFileSync(join(logs, name), gzipSync(text));
        utimesSync(join(logs, name), modified, modified);
    }

    it('takes the game files, its session reports and the logs of the last 7 days, filtered', () => {
        mkdirSync(join(captures, 'centiped-20261025-170000-aB3dE9'));
        writeFileSync(join(captures, 'centiped-20261025-170000-aB3dE9', 'session-report.json'), '{"resets":0}');
        writeFileSync(join(logs, 'maui.log'), `${SQL}\n${SCORES}\n`);
        archive('maui-20261024-090000.log.gz', `${SQL}\n${OLDER}\n`, new Date(2026, 9, 24, 9));
        archive('maui-20261001-090000.log.gz', 'far too old\n', new Date(2026, 9, 1, 9));

        const bundle = buildDiagnosticBundle(sources());

        expect(bundle.comment).toBe('15000 missing');
        expect(bundle.files.map(file => `${file.area}/${file.name}`)).toEqual([
            'hiscore/centiped.hi', 'nvram/earom', 'sessions/centiped-20261025-170000-aB3dE9.json',
            'logs/maui.log', 'logs/maui-20261024-090000.log.gz',
        ]);
        expect(bundle.files[1].content).toEqual(Buffer.from([4, 5]));
        expect(bundle.files[3].content.toString()).toBe(`${SCORES}\n`);
        expect(gunzipSync(bundle.files[4].content).toString()).toBe(`${OLDER}\n`);
        expect(bundle.report).toMatchObject({
            versions: {maui: '2.19.0', mhiex: '2.2.6', mame: '0.289'},
            state: 'ok',
            tables: [{id: null, rows: [{rank: 1, score: 16543, name: 'NOB', status: 'pending'}]}],
            logs: true,
            omitted: [],
        });
    });

    it('leaves the logs out when the owner did not attach them', () => {
        writeFileSync(join(logs, 'maui.log'), `${SCORES}\n`);

        const bundle = buildDiagnosticBundle(sources({logDir: null, comment: ''}));

        expect(bundle.comment).toBeNull();
        expect(bundle.files.map(file => file.area)).toEqual(['hiscore', 'nvram']);
        expect(bundle.report.logs).toBe(false);
    });

    it('stays within 16 files and 1 MB, and says what it left out', () => {
        writeFileSync(join(logs, 'maui.log'), 'x'.repeat(MAX_SIZE));
        for (let day = 20; day <= 25; day++) {
            archive(`maui-202610${day}-090000.log.gz`, `day ${day}\n`, new Date(2026, 9, day, 9));
        }
        for (let n = 0; n < 12; n++) {
            writeFileSync(join(home, 'nvram', 'centiped', `part${n}`), 'y');
        }

        const bundle = buildDiagnosticBundle(sources({inspection: inspection()}));

        expect(bundle.files).toHaveLength(16);
        expect(bundle.files.reduce((size, file) => size + file.content.length, 0)).toBeLessThanOrEqual(MAX_SIZE);
        expect(bundle.report.omitted).toEqual(expect.arrayContaining([
            {area: 'logs', name: 'maui.log', size: MAX_SIZE, reason: 'too_large'},
            expect.objectContaining({area: 'logs', name: 'maui-20261020-090000.log.gz', reason: 'too_many_files'}),
        ]));
    });

    it('leaves out a file whose name MAUI-API would refuse', () => {
        writeFileSync(join(home, 'nvram', 'centiped', 'main cpu'), 'z');

        const bundle = buildDiagnosticBundle(sources({inspection: inspection(), logDir: null}));

        expect(bundle.files.map(file => file.name)).not.toContain('main cpu');
        expect(bundle.report.omitted).toEqual([{area: 'nvram', name: 'main cpu', size: 1, reason: 'bad_name'}]);
    });
});
