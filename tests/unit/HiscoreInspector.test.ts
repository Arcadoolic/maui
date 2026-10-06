import {describe, it, expect} from 'vitest';
import {mkdirSync, mkdtempSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';
import {hexDump, inspectHiscores, parseHiscoreDatSizes} from '@/class/HiscoreInspector';
import {scorePseudo3} from '@/class/HiscoreSupport';

// tests/fixtures/mame-home/hiscore/dkong.hi decodes to MAF 19200, NOB 12900, GUS 12500, NOB 12200, NOB 10500
const mameHome = resolve(__dirname, '../fixtures/mame-home');

describe('inspectHiscores', () => {
    it('tells, row by row, what MAUI does with the decoded scores', async () => {
        const report = await inspectHiscores(mameHome, 'dkong', new Set(['MAF', 'NOB']), [
            {pseudo3: 'MAF', rank: 1, score: 19200},
            {pseudo3: 'NOB', rank: 2, score: 12900},
        ]);

        expect(report.state).toBe('ok');
        expect(report.sources).toEqual({hi: true, nvram: null});
        expect(report.files.map(f => [f.name, f.size])).toEqual([['hiscore/dkong.hi', 179]]);
        expect(report.tables).toHaveLength(1);
        expect(report.tables[0].id).toBeNull();
        expect(report.tables[0].rows.map(r => [r.rank, r.name, r.status])).toEqual([
            [1, 'MAF', 'saved'],
            [2, 'NOB', 'saved'],
            [3, 'GUS', 'ignored'],
            [4, 'NOB', 'pending'],
            [5, 'NOB', 'pending'],
        ]);
    });

    it('does not count a stored score of another rank or value as saved', async () => {
        const report = await inspectHiscores(mameHome, 'dkong', new Set(['MAF']), [{pseudo3: 'MAF', rank: 2, score: 19200}]);

        expect(report.tables[0].rows[0].status).toBe('pending');
    });

    it('flags a .hi file whose size does not match hiscore.dat', async () => {
        const report = await inspectHiscores(mameHome, 'dkong', new Set(), [], new Map([['dkong', 180]]));

        expect(report.files[0].expectedSize).toBe(180);
    });

    it('reports a supported game mame has not written a file for yet', async () => {
        const report = await inspectHiscores(mameHome, 'raiden', new Set(), []);

        expect(report.state).toBe('no-file');
        expect(report.files).toEqual([]);
    });

    it('reports a rom mhiex has no extractor for', async () => {
        const report = await inspectHiscores(mameHome, 'not-a-mame-rom', new Set(), []);

        expect(report.state).toBe('unsupported');
    });

    it('lists the nvram files of the rom', async () => {
        const home = mkdtempSync(join(tmpdir(), 'maui-hiscores-'));
        mkdirSync(join(home, 'nvram', 'qbert'), {recursive: true});
        writeFileSync(join(home, 'nvram', 'qbert', 'nvram'), Buffer.alloc(4096));

        const report = await inspectHiscores(home, 'qbert', new Set(), []);

        expect(report.files.map(f => f.name)).toEqual(['nvram/qbert/nvram']);
    });
});

describe('scorePseudo3', () => {
    it('is the first 3 letters of the name, upper-cased', () => {
        expect(scorePseudo3('maf')).toBe('MAF');
        expect(scorePseudo3('YOSHIKIKUN')).toBe('YOS');
        expect(scorePseudo3('A')).toBe('A');
    });
});

describe('parseHiscoreDatSizes', () => {
    it('sums the ranges of an entry and shares them between its rom names', () => {
        const sizes = parseHiscoreDatSizes([
            ';(boulder dash)',
            'bouldash:',
            '@:maincpu,program,306d4d,44,00,52',
            '@:maincpu,program,306aa1,3,00,00',
            '',
            'slyspy:',
            'slyspy2:',
            '@:maincpu,program,306adc,4,00,00',
        ].join('\n'));

        expect(sizes.get('bouldash')).toBe(0x44 + 3);
        expect(sizes.get('slyspy')).toBe(4);
        expect(sizes.get('slyspy2')).toBe(4);
    });
});

describe('hexDump', () => {
    it('prints offset, hex bytes and printable characters', () => {
        const {lines, truncated} = hexDump(Buffer.from('MAF\u0000\u0001', 'latin1'));

        expect(lines).toEqual([`000000  4d 41 46 00 01${' '.repeat(33)}  MAF..`]);
        expect(truncated).toBe(false);
    });

    it('stops at the byte limit', () => {
        const {lines, truncated} = hexDump(Buffer.alloc(40), 32);

        expect(lines).toHaveLength(2);
        expect(truncated).toBe(true);
    });
});

describe('describeSources', () => {
    it('names what the extractor reads', async () => {
        const {describeSources} = await import('@/class/HiscoreInspector');
        expect(describeSources({hi: true, nvram: null})).toBe('.hi');
        expect(describeSources({hi: false, nvram: 'nvram/qbert/nvram'})).toBe('nvram');
        expect(describeSources({hi: true, nvram: 'nvram/centiped/earom'})).toBe('.hi + nvram');
        expect(describeSources({hi: 'optional', nvram: 'nvram/punchout/nvram'})).toBe('.hi (optional) + nvram');
        expect(describeSources(null)).toBe('');
    });
});
