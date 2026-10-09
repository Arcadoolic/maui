import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {ScoreCapture} from '@/class/ScoreCapture';
import type {OutboxEntry, PublishablePlayer, ScoreStore} from '@/class/ScoreOutbox';
import type {ScoreSubmission} from '@/class/MauiApiClient';

// The whole chain on a real file: scobra keeps 10 scores without any name (mhiex), 3 bytes each,
// hex digits, little-endian, then the top score.

class MemoryStore implements ScoreStore {
    public added: ScoreSubmission[] = [];

    public async add(submissions: ScoreSubmission[]) {
        this.added.push(...submissions);
    }

    public async due(): Promise<OutboxEntry[]> {
        return [];
    }

    public async remove() {}

    public async reschedule() {}

    public async getBest() {
        return null;
    }

    public async setBest() {}
}

const player = (pseudo3: string): PublishablePlayer => ({
    pseudo_3: pseudo3, active: true, remote_id: `id-${pseudo3}`, is_public: true, online_status: 'active',
});

function scobraTable(scores: number[]): Buffer {
    const padded = [...scores, ...Array<number>(10).fill(0)].slice(0, 10);
    const bytes = [...padded, padded[0]].flatMap((score) => {
        const digits = String(score).padStart(6, '0');
        return [digits.slice(4, 6), digits.slice(2, 4), digits.slice(0, 2)].map(pair => parseInt(pair, 16));
    });
    return Buffer.from(bytes);
}

describe('ScoreCapture, on a game writing no name', () => {
    let mameHome: string;
    let flushed: number;

    const capture = (store: ScoreStore, players: PublishablePlayer[]) => new ScoreCapture({
        store,
        mameHome: () => mameHome,
        enabled: () => true,
        players: async () => players,
        startupId: () => 'startup-1',
        flush: () => { flushed++; },
    });
    const write = (scores: number[]) => writeFileSync(join(mameHome, 'hiscore', 'scobra.hi'), scobraTable(scores));

    beforeEach(() => {
        mameHome = mkdtempSync(join(tmpdir(), 'maui-capture-'));
        mkdirSync(join(mameHome, 'hiscore'));
        flushed = 0;
        write([10000, 9000, 8000]);
    });
    afterEach(() => rmSync(mameHome, {recursive: true, force: true}));

    it('asks who made the new scores when several players could have', async () => {
        const store = new MemoryStore();
        const scores = capture(store, [player('SAJ'), player('NOB')]);
        await scores.started('scobra');
        write([23450, 10000, 9500, 9000, 8000]);

        expect(await scores.ended('scobra')).toEqual({
            romname: 'scobra',
            scores: [{score: 23450, rank: 1}, {score: 9500, rank: 3}],
            players: [{remoteId: 'id-NOB', pseudo3: 'NOB'}, {remoteId: 'id-SAJ', pseudo3: 'SAJ'}],
        });
        expect(store.added).toEqual([]);

        await scores.attribute('scobra', 23450, 'id-SAJ');
        await scores.attribute('scobra', 9500, null);
        expect(store.added.map(score => [score.playerId, score.romname, score.score, score.attribution]))
            .toEqual([['id-SAJ', 'scobra', 23450, 'declared']]);
        expect(flushed).toBe(1);
    });

    it('gives them to the only player without asking', async () => {
        const store = new MemoryStore();
        const scores = capture(store, [player('NOB')]);
        await scores.started('scobra');
        write([23450, 10000, 9000, 8000]);

        expect(await scores.ended('scobra')).toBeNull();
        expect(store.added.map(score => [score.playerId, score.score, score.attribution])).toEqual([['id-NOB', 23450, 'declared']]);
        expect(flushed).toBe(1);
    });

    it('asks nothing when the game added no score', async () => {
        const store = new MemoryStore();
        const scores = capture(store, [player('SAJ'), player('NOB')]);
        await scores.started('scobra');

        expect(await scores.ended('scobra')).toBeNull();
        expect(store.added).toEqual([]);
    });
});
