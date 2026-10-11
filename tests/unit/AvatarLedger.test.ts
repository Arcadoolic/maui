import {describe, it, expect, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {AvatarLedgerFile} from '@/class/AvatarLedger';

describe('AvatarLedgerFile', () => {
    const dirs: string[] = [];
    const file = (): string => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-ledger-'));
        dirs.push(dir);
        return join(dir, 'avatar-sync.json');
    };

    afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, {recursive: true, force: true})));

    it('remembers a hash per player, across instances', () => {
        const path = file();
        const ledger = new AvatarLedgerFile(path);
        expect(ledger.get('a')).toBeNull();

        ledger.set('a', 'h1');
        ledger.set('b', 'h2');
        ledger.set('a', 'h3');

        expect(new AvatarLedgerFile(path).get('a')).toBe('h3');
        expect(new AvatarLedgerFile(path).get('b')).toBe('h2');
    });

    it('starts empty from a damaged file, and can be written again', () => {
        const path = file();
        for (const content of ['not json', '[1, 2]', 'null', '{"a": 12}']) {
            writeFileSync(path, content);
            expect(new AvatarLedgerFile(path).get('a')).toBeNull();
        }
        const ledger = new AvatarLedgerFile(path);
        ledger.set('a', 'h1');
        expect(ledger.get('a')).toBe('h1');
    });
});
