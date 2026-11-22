import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {sendDiagnostic} from '@/class/GameDiagnostic';
import {readSentDiagnostics} from '@/class/DiagnosticHistory';
import type {DiagnosticBundle} from '@/class/DiagnosticBundle';
import type {ApiResult} from '@/class/MauiApiClient';

const bundle: DiagnosticBundle = {
    romName: 'magdrop2', comment: 'Sent from the cabinet\'s front (Diagnostic action).', report: {},
    files: [{area: 'nvram', name: 'saveram', modified: null, content: Buffer.alloc(100)}] as DiagnosticBundle['files'],
};

function client(result: ApiResult<string>) {
    const sent: DiagnosticBundle[] = [];
    return {sent, sendDiagnostic: async (b: DiagnosticBundle) => {
        sent.push(b);
        return result;
    }};
}

describe('sendDiagnostic', () => {
    let dir: string;
    let history: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'maui-diag-'));
        history = join(dir, 'diagnostics-sent.json');
    });

    afterEach(() => rmSync(dir, {recursive: true, force: true}));

    it('sends the bundle and remembers it', async () => {
        const api = client({kind: 'ok', value: 'd-42'});
        expect(await sendDiagnostic(api, bundle, true, history)).toEqual({kind: 'sent', id: 'd-42'});
        expect(api.sent).toEqual([bundle]);
        expect(readSentDiagnostics(history)).toEqual([
            expect.objectContaining({romName: 'magdrop2', id: 'd-42', files: 1, size: 100, logs: true}),
        ]);
    });

    it('says so when the cabinet is not ONLINE, without sending', async () => {
        expect(await sendDiagnostic(null, bundle, true, history)).toEqual({kind: 'offline'});
        expect(readSentDiagnostics(history)).toEqual([]);
    });

    it('says why MAUI-API refused it, and does not remember it', async () => {
        const api = client({kind: 'rejected', status: 403, code: 'insufficient_ability'});
        const result = await sendDiagnostic(api, bundle, false, history);
        expect(result).toEqual({kind: 'failed', reason: expect.stringContaining('diagnostics:write')});
        expect(readSentDiagnostics(history)).toEqual([]);
    });
});
