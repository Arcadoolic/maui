import {describe, it, expect, afterEach} from 'vitest';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {newestAbove, parseUpdateChannel} from '@/class/ReleaseList';
import {FrontUpdate, simulateInstall, type FrontUpdateDeps} from '@/class/FrontUpdate';
import type {UpdateStep} from '@/class/FrontUpdateBridge';
import {describeUpdateStep, filledCells} from '@/class/UpdateScreen';
import {parseMessage, updateNoticeMessage} from '@/class/CabinetMessages';

const release = (tag: string, publishedAt: string, prerelease = false, draft = false) =>
    ({tag_name: tag, published_at: publishedAt, prerelease, draft});

describe('newestAbove', () => {
    const releases = [
        release('2.17.0', '2026-10-22T21:11:11Z'),
        release('2.17.0+dev.aaaaaaa', '2026-10-23T08:00:00Z', true),
        release('2.17.0+dev.bbbbbbb', '2026-10-24T08:00:00Z', true),
        release('2.16.1', '2026-10-18T13:28:21Z'),
    ];

    it('offers the releases only on the releases channel', () => {
        expect(newestAbove(releases, '2.16.1', 'releases')).toBe('2.17.0');
        expect(newestAbove(releases, '2.17.0', 'releases')).toBeNull();
    });

    it('offers the development builds published after the running version on the pre-releases channel', () => {
        expect(newestAbove(releases, '2.17.0', 'prereleases')).toBe('2.17.0+dev.bbbbbbb');
        expect(newestAbove(releases, '2.17.0+dev.aaaaaaa', 'prereleases')).toBe('2.17.0+dev.bbbbbbb');
        expect(newestAbove(releases, '2.17.0+dev.bbbbbbb', 'prereleases')).toBeNull();
    });

    it('offers a release over the development builds of the version before it', () => {
        const withRelease = [...releases, release('2.18.0', '2026-10-25T10:00:00Z')];
        expect(newestAbove(withRelease, '2.17.0+dev.bbbbbbb', 'prereleases')).toBe('2.18.0');
    });

    it('offers the release a development build leads to', () => {
        const builds = [
            release('2.18.0+dev.ccccccc', '2026-10-25T09:00:00Z', true),
            release('2.18.0', '2026-10-25T10:00:00Z'),
        ];
        expect(newestAbove(builds, '2.18.0+dev.ccccccc', 'prereleases')).toBe('2.18.0');
    });

    it('only trusts a higher number when the running version is not listed', () => {
        expect(newestAbove(releases, '2.17.0+dev.local00', 'prereleases')).toBeNull();
        expect(newestAbove(releases, '2.16.0', 'prereleases')).toBe('2.17.0+dev.bbbbbbb');
    });

    it('never offers a draft', () => {
        expect(newestAbove([release('2.18.0', '2026-10-25T10:00:00Z', false, true)], '2.17.0', 'prereleases')).toBeNull();
    });

    it('reads an unknown channel as the releases', () => {
        expect(parseUpdateChannel('prereleases')).toBe('prereleases');
        expect(parseUpdateChannel('nightly')).toBe('releases');
        expect(parseUpdateChannel(undefined)).toBe('releases');
    });
});

describe('FrontUpdate', () => {
    let dir: string;

    afterEach(() => rmSync(dir, {recursive: true, force: true}));

    function frontUpdate(overrides: Partial<FrontUpdateDeps> = {}) {
        dir = mkdtempSync(join(tmpdir(), 'maui-front-update-'));
        const sent: UpdateStep[] = [];
        const installed: string[] = [];
        const update = new FrontUpdate({
            settings: () => ({frontUpdateEnabled: true, updateChannel: 'releases'}),
            capable: () => true,
            available: () => '2.18.0',
            installAndRestart: async (version, progress) => {
                installed.push(version);
                progress({step: 'extract', entries: 0, totalEntries: 0});
            },
            send: step => sent.push(step),
            declinedPath: join(dir, 'declined-update.json'),
            ...overrides,
        });
        return {update, sent, installed};
    }

    it('offers the newer version of the channel the BO set', () => {
        const channels: string[] = [];
        const {update} = frontUpdate({
            settings: () => ({frontUpdateEnabled: true, updateChannel: 'prereleases'}),
            available: (channel) => {
                channels.push(channel);
                return '2.18.0+dev.abc1234';
            },
        });
        expect(update.offer()).toBe('2.18.0+dev.abc1234');
        expect(channels).toEqual(['prereleases']);
    });

    it('offers nothing when the BO switched it off, or the machine cannot install', () => {
        expect(frontUpdate({settings: () => ({frontUpdateEnabled: false, updateChannel: 'releases'})}).update.offer()).toBeNull();
        expect(frontUpdate({capable: () => false}).update.offer()).toBeNull();
        expect(frontUpdate({available: () => null}).update.offer()).toBeNull();
    });

    it('does not offer a declined version again, but offers the next one', () => {
        let available = '2.18.0';
        const {update} = frontUpdate({available: () => available});
        update.decline('2.18.0');
        expect(update.offer()).toBeNull();
        available = '2.19.0';
        expect(update.offer()).toBe('2.19.0');
    });

    it('installs only the version it offers, then tells the front it restarts', async () => {
        const {update, sent, installed} = frontUpdate();
        expect(update.install('2.17.5')).toBe(false);
        expect(update.install('2.18.0')).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(installed).toEqual(['2.18.0']);
        expect(sent).toEqual([{step: 'extract', entries: 0, totalEntries: 0}, {step: 'restart'}]);
        // Nothing more is offered while it installs.
        expect(update.offer()).toBeNull();
    });

    it('reports a failure, and offers the version again', async () => {
        const {update, sent} = frontUpdate({
            installAndRestart: async () => {
                throw new Error('Download failed (HTTP 404).');
            },
        });
        update.install('2.18.0');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(sent).toEqual([{step: 'failed', message: 'Download failed (HTTP 404).'}]);
        expect(update.offer()).toBe('2.18.0');
    });

    it('plays every step in development without installing anything', async () => {
        const steps: string[] = [];
        await simulateInstall(step => steps.push(step.step), async () => undefined);
        expect(steps[0]).toBe('download');
        expect(steps.slice(-3)).toEqual(['extract', 'switch', 'cleanup']);
    });
});

describe('describeUpdateStep', () => {
    it('fills most of the bar with the download', () => {
        const half = describeUpdateStep({step: 'download', doneBytes: 50 * 1024 * 1024, totalBytes: 100 * 1024 * 1024});
        expect(half).toMatchObject({label: 'DOWNLOADING', percent: 40, detail: '50.0 MB / 100.0 MB', failed: false});
        expect(describeUpdateStep({step: 'download', doneBytes: 100, totalBytes: 100}).percent).toBe(80);
    });

    it('has no percentage when the size of the download is unknown', () => {
        expect(describeUpdateStep({step: 'download', doneBytes: 3 * 1024 * 1024, totalBytes: 0}))
            .toMatchObject({percent: null, detail: '3.0 MB'});
    });

    it('goes on with the installation, then the restart', () => {
        expect(describeUpdateStep({step: 'extract', entries: 0, totalEntries: 0}))
            .toMatchObject({label: 'INSTALLING', percent: 80, detail: 'Unpacking the new version'});
        expect(describeUpdateStep({step: 'extract', entries: 1500, totalEntries: 3000}))
            .toMatchObject({percent: 87, detail: 'Unpacking the new version: 1500 files'});
        // The estimate may be short: the bar never reaches the next step.
        expect(describeUpdateStep({step: 'extract', entries: 4000, totalEntries: 3000})).toMatchObject({percent: 94});
        expect(describeUpdateStep({step: 'switch'})).toMatchObject({label: 'INSTALLING', percent: 95});
        expect(describeUpdateStep({step: 'cleanup'})).toMatchObject({label: 'INSTALLING', percent: 98});
        expect(describeUpdateStep({step: 'restart'})).toMatchObject({label: 'RESTARTING', percent: 100});
    });

    it('shows a failure with its message', () => {
        expect(describeUpdateStep({step: 'failed', message: 'No space left'}))
            .toEqual({label: 'UPDATE FAILED', percent: null, detail: 'No space left', failed: true});
    });

    it('turns a percentage into cells of the bar', () => {
        expect(filledCells(0, 20)).toBe(0);
        expect(filledCells(42, 20)).toBe(8);
        expect(filledCells(100, 20)).toBe(20);
        expect(filledCells(null, 20)).toBe(0);
    });
});

describe('updateNoticeMessage on the front', () => {
    it('tells to press a key when the front offers the version', () => {
        const text = parseMessage(updateNoticeMessage('2.18.0', true).text).map(segment => segment.text).join('');
        expect(text).toBe('MAUI 2.18.0 is out: press to update');
        expect(text.length).toBeLessThanOrEqual(42);
    });
});
