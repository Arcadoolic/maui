import {afterEach, beforeEach, describe, it, expect} from 'vitest';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'fs';
import {join} from 'path';
import {gunzipSync} from 'zlib';
import os from 'os';
import {adoptLegacyLogs, archive, archiveStamp, archivesToPrune, tidyArchives} from '@/class/LogArchive';

describe('archiveStamp', () => {
    it('writes the local date and time', () => {
        expect(archiveStamp(new Date(2026, 9, 26, 8, 3, 9))).toBe('20261026-080309');
    });
});

describe('archivesToPrune', () => {
    const now = new Date(2026, 9, 26, 12, 0, 0);

    it('drops the archives older than 30 days, compressed or not', () => {
        expect(archivesToPrune([
            'maui-20260925-110000.log.gz',
            'maui-20260927-120000.log.gz',
            'maui-20260920-120000.log',
        ], now)).toEqual(['maui-20260925-110000.log.gz', 'maui-20260920-120000.log']);
    });

    it('keeps the 20 most recent archives', () => {
        const names = Array.from({length: 22}, (_, i) => `maui-202610${String(i + 1).padStart(2, '0')}-120000.log.gz`);

        expect(archivesToPrune(names, now)).toEqual(['maui-20261002-120000.log.gz', 'maui-20261001-120000.log.gz']);
    });

    it('leaves the current log and any other file alone', () => {
        expect(archivesToPrune(['maui.log', 'log.log', 'notes-20200101-000000.log', 'electron-log-preload.js'], now)).toEqual([]);
    });
});

describe('archive and tidyArchives', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(os.tmpdir(), 'maui-logs-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('moves the log aside under its date, then compresses it', async () => {
        writeFileSync(join(dir, 'maui.log'), 'first line\n');
        const now = new Date(2026, 9, 26, 8, 13, 43);

        archive(join(dir, 'maui.log'), now);
        await tidyArchives(dir, now);

        expect(readdirSync(dir)).toEqual(['maui-20261026-081343.log.gz']);
        expect(gunzipSync(readFileSync(join(dir, 'maui-20261026-081343.log.gz'))).toString()).toBe('first line\n');
    });

    it('gives two rotations in the same second their own archive', async () => {
        const now = new Date(2026, 9, 26, 8, 13, 43);
        writeFileSync(join(dir, 'maui.log'), 'one\n');
        archive(join(dir, 'maui.log'), now);
        writeFileSync(join(dir, 'maui.log'), 'two\n');
        archive(join(dir, 'maui.log'), now);
        await tidyArchives(dir, now);

        expect(readdirSync(dir).sort()).toEqual(['maui-20261026-081343-1.log.gz', 'maui-20261026-081343.log.gz']);
    });
});

describe('adoptLegacyLogs', () => {
    let dir: string;
    let userData: string;

    beforeEach(() => {
        dir = mkdtempSync(join(os.tmpdir(), 'maui-logs-'));
        userData = mkdtempSync(join(os.tmpdir(), 'maui-user-data-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
        rmSync(userData, {recursive: true, force: true});
    });

    it('moves log.log and log.old.log into the archives, dated by their last write', () => {
        writeFileSync(join(userData, 'log.log'), 'recent\n');
        writeFileSync(join(userData, 'log.old.log'), 'older\n');
        utimesSync(join(userData, 'log.log'), new Date(2026, 9, 26, 8, 6, 29), new Date(2026, 9, 26, 8, 6, 29));
        utimesSync(join(userData, 'log.old.log'), new Date(2026, 9, 25, 9, 44, 39), new Date(2026, 9, 25, 9, 44, 39));

        adoptLegacyLogs([join(userData, 'log.log'), join(userData, 'log.old.log'), join(dir, 'log.log')], dir);

        expect(existsSync(join(userData, 'log.log'))).toBe(false);
        expect(readdirSync(dir).sort()).toEqual(['maui-20261025-094439.log', 'maui-20261026-080629.log']);
        expect(readFileSync(join(dir, 'maui-20261026-080629.log'), 'utf8')).toBe('recent\n');
    });
});
