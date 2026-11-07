import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import {createHash} from 'crypto';
import {brokenLocalAvatars, removeBrokenOnlineAvatars} from '@/class/AvatarRepair';

// The 24 first bytes of a 1 x 1 PNG: signature and IHDR, all pngSize() reads.
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const hashOf = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');

describe('AvatarRepair', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(os.tmpdir(), 'avatar-repair-')); });
    afterEach(() => rmSync(dir, {recursive: true, force: true}));

    it('removes from the leaderboards\' cache the files that are not the picture of their hash, and only those', () => {
        const good = `${hashOf(PNG)}.png`;
        const broken = `${hashOf('another picture')}.png`;
        writeFileSync(join(dir, good), PNG);
        writeFileSync(join(dir, broken), '<html>maintenance</html>');
        writeFileSync(join(dir, 'notes.txt'), 'not an avatar');

        expect(removeBrokenOnlineAvatars(dir)).toEqual([broken]);
        expect(readdirSync(dir).sort()).toEqual([good, 'notes.txt'].sort());
    });

    it('finds nothing in a cache that does not exist yet', () => {
        expect(removeBrokenOnlineAvatars(join(dir, 'missing'))).toEqual([]);
    });

    it('tells the local avatars that are not a PNG, a missing one being fine', () => {
        writeFileSync(join(dir, 'ACE.png'), PNG);
        writeFileSync(join(dir, 'NOB.png'), '<html>');

        expect(brokenLocalAvatars(dir, ['ACE', 'NOB', 'ZED'])).toEqual(['NOB']);
        expect(existsSync(join(dir, 'NOB.png'))).toBe(true);
    });
});
