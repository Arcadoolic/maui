import {describe, it, expect} from 'vitest';
import {mkdtempSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {createHash} from 'crypto';
import {championPictureUrl, fetchChampionPicture} from '@/class/ChampionsScreen';
import {parseIdleScreenSetting, pickIdleScreen} from '@/class/IdleScreen';
import type {ChampionLine} from '@/class/MauiApiClient';

const png = new Uint8Array([137, 80, 78, 71, 9, 9]);
const hash = createHash('sha256').update(png).digest('hex');
const champion: ChampionLine = {
    playerId: 'p1', pseudo3: 'NOB', avatar: null, romname: 'pengo', description: 'Pengo',
    marquee: hash, flyer: null, logo: null, score: 1000, players: 3, days: 2,
};

describe('champion pictures', () => {
    it('takes the cabinet\'s own picture of a game it has', () => {
        const local = mkdtempSync(join(tmpdir(), 'maui-local-'));
        writeFileSync(join(local, 'pengo.png'), png);
        expect(championPictureUrl('pengo', hash, {local, cache: mkdtempSync(join(tmpdir(), 'maui-cache-'))}))
            .toContain('pengo.png');
    });

    it('downloads the picture of a game the cabinet does not have, once, checked against its hash', async () => {
        const folders = {local: mkdtempSync(join(tmpdir(), 'maui-local-')), cache: mkdtempSync(join(tmpdir(), 'maui-cache-'))};
        expect(championPictureUrl('pengo', hash, folders)).toBeNull();

        expect(await fetchChampionPicture(champion, 'marquee', async () => ({kind: 'ok', value: new Uint8Array([1])}), folders.cache)).toBeNull();
        expect(await fetchChampionPicture(champion, 'flyer', async () => ({kind: 'ok', value: png}), folders.cache)).toBeNull();
        const url = await fetchChampionPicture(champion, 'marquee', async () => ({kind: 'ok', value: png}), folders.cache);

        expect(url).toContain(`${hash}.png`);
        expect(championPictureUrl('pengo', hash, folders)).toBe(url);
    });
});

describe('idle screen', () => {
    it('reads the setting, the band by default', () => {
        expect(parseIdleScreenSetting('champions')).toBe('champions');
        expect(parseIdleScreenSetting('random')).toBe('random');
        expect(parseIdleScreenSetting('nope')).toBe('messages');
        expect(parseIdleScreenSetting(undefined)).toBe('messages');
    });

    it('draws either screen for random', () => {
        expect(pickIdleScreen('champions')).toBe('champions');
        expect(pickIdleScreen('random', () => 0.1)).toBe('messages');
        expect(pickIdleScreen('random', () => 0.9)).toBe('champions');
    });
});
