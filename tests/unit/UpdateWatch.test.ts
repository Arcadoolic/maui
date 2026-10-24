import {describe, it, expect} from 'vitest';
import {newestStableAbove} from '@/class/ReleaseList';
import {UpdateWatch} from '@/class/UpdateWatch';
import {parseMessage, updateNoticeMessage} from '@/class/CabinetMessages';

const release = (tag: string, prerelease = false, draft = false) => ({tag_name: tag, prerelease, draft, assets: []});

describe('newestStableAbove', () => {
    it('gives the newest stable release above the running version', () => {
        expect(newestStableAbove([release('2.14.0'), release('2.16.0'), release('2.15.1')], '2.14.0')).toBe('2.16.0');
    });

    it('gives nothing when the cabinet is up to date, or ahead', () => {
        expect(newestStableAbove([release('2.14.0'), release('2.13.0')], '2.14.0')).toBeNull();
        expect(newestStableAbove([release('2.14.0')], '2.15.0')).toBeNull();
    });

    it('leaves out develop builds and drafts', () => {
        expect(newestStableAbove([release('2.15.0-dev.3', true), release('2.16.0', false, true)], '2.14.0')).toBeNull();
    });

    it('takes a develop build of a version for that version', () => {
        expect(newestStableAbove([release('2.14.0')], '2.14.0+dev.1a2b3c4')).toBeNull();
        expect(newestStableAbove([release('2.15.0')], '2.14.0+dev.1a2b3c4')).toBe('2.15.0');
    });

    it('ignores a tag it cannot read', () => {
        expect(newestStableAbove([release('latest'), release('2.15.0')], '2.14.0')).toBe('2.15.0');
    });
});

describe('UpdateWatch', () => {
    it('knows nothing before its first check', () => {
        expect(new UpdateWatch('2.14.0', async () => [release('2.15.0')]).available()).toBeNull();
    });

    it('gives the newer release once checked', async () => {
        const watch = new UpdateWatch('2.14.0', async () => [release('2.15.0')]);
        await watch.check();
        expect(watch.available()).toBe('2.15.0');
    });

    it('keeps what it knew when GitHub is out of reach, and never throws', async () => {
        let fail = false;
        const watch = new UpdateWatch('2.14.0', async () => {
            if (fail) {
                throw new Error('offline');
            }
            return [release('2.15.0')];
        });
        await watch.check();
        fail = true;
        await expect(watch.check()).resolves.toBeUndefined();
        expect(watch.available()).toBe('2.15.0');
    });

    it('says nothing when GitHub never answered', async () => {
        const watch = new UpdateWatch('2.14.0', async () => {
            throw new Error('offline');
        });
        await watch.check();
        expect(watch.available()).toBeNull();
    });
});

describe('updateNoticeMessage', () => {
    it('is a short system message, shown once, the version in bold', () => {
        const message = updateNoticeMessage('2.15.0');
        expect(message).toMatchObject({kind: 'system', once: true, id: 'maui-update-2.15.0'});
        const text = parseMessage(message.text).map(segment => segment.text).join('');
        expect(text).toBe('MAUI 2.15.0 is out: update from the BO');
        // It stops in the middle of the band only if it fits: about 42 characters in its font.
        expect(text.length).toBeLessThanOrEqual(42);
        expect(parseMessage(updateNoticeMessage('12.10.10').text).map(segment => segment.text).join('').length)
            .toBeLessThanOrEqual(42);
        expect(parseMessage(message.text).find(segment => segment.strong)?.text).toBe('2.15.0');
    });
});
