import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import {createHash} from 'crypto';
import {hasOnlineAvatar} from '@/class/OnlineAvatars';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const HASH = createHash('sha256').update(PNG).digest('hex');

describe('hasOnlineAvatar', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(os.tmpdir(), 'online-avatars-')); });
    afterEach(() => rmSync(dir, {recursive: true, force: true}));

    it('has the picture whose file holds that hash', () => {
        writeFileSync(join(dir, `${HASH}.png`), PNG);
        expect(hasOnlineAvatar(HASH, dir)).toBe(true);
    });

    it('counts as missing a file of that name holding something else, an empty one or none', () => {
        expect(hasOnlineAvatar(HASH, dir)).toBe(false);
        writeFileSync(join(dir, `${HASH}.png`), '<html>maintenance</html>');
        expect(hasOnlineAvatar(HASH, dir)).toBe(false);
        writeFileSync(join(dir, `${HASH}.png`), '');
        expect(hasOnlineAvatar(HASH, dir)).toBe(false);
    });

    it('never reads a path that is not a hash', () => {
        expect(hasOnlineAvatar('../avatars/NOB', dir)).toBe(false);
    });
});
