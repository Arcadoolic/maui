import {afterEach, beforeEach, describe, it, expect} from 'vitest';
import AdmZip from 'adm-zip';
import {mkdtempSync, rmSync} from 'fs';
import {join} from 'path';
import os from 'os';
import {diagnosticZip} from '@/class/DiagnosticZip';
import {readSentDiagnostics, recordSentDiagnostic, type SentDiagnostic} from '@/class/DiagnosticHistory';

describe('diagnosticZip', () => {
    it('lays the files out as a MAME home, with what the cabinet says about them', () => {
        const zip = new AdmZip(diagnosticZip({
            romName: 'centiped', comment: '15000 missing', report: {state: 'ok'},
            files: [
                {area: 'hiscore', name: 'centiped.hi', modified: null, content: Buffer.from('abc')},
                {area: 'nvram', name: 'earom', modified: new Date('2026-10-25T16:00:00Z'), content: Buffer.from('def')},
                {area: 'logs', name: 'maui.log', modified: null, content: Buffer.from('ghi')},
            ],
        }, new Date('2026-10-26T10:00:00Z')));

        expect(zip.getEntries().map(entry => entry.entryName).sort())
            .toEqual(['diagnostic.json', 'hiscore/centiped.hi', 'logs/maui.log', 'nvram/centiped/earom']);
        expect(zip.readAsText('nvram/centiped/earom')).toBe('def');
        expect(JSON.parse(zip.readAsText('diagnostic.json'))).toMatchObject({
            romname: 'centiped', comment: '15000 missing', created_at: '2026-10-26T10:00:00.000Z', report: {state: 'ok'},
            files: [
                {area: 'hiscore', name: 'centiped.hi', size: 3, modified: null},
                {area: 'nvram', name: 'earom', size: 3, modified: '2026-10-25T16:00:00.000Z'},
                {area: 'logs', name: 'maui.log', size: 3, modified: null},
            ],
        });
    });
});

describe('DiagnosticHistory', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(os.tmpdir(), 'maui-history-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    const sent = (id: string): SentDiagnostic => ({romName: 'mslug', id, sentAt: '2026-10-26T10:00:00Z', files: 2, size: 10, logs: true});

    it('keeps the diagnostics sent, newest first, 50 at most', () => {
        const path = join(dir, 'diagnostics-sent.json');
        for (let n = 1; n <= 51; n++) {
            recordSentDiagnostic(sent(`d${n}`), path);
        }

        const list = readSentDiagnostics(path);
        expect(list).toHaveLength(50);
        expect(list[0].id).toBe('d51');
        expect(list[49].id).toBe('d2');
    });

    it('has nothing before the first one', () => {
        expect(readSentDiagnostics(join(dir, 'none.json'))).toEqual([]);
    });
});
