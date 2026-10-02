import {describe, it, expect, vi} from 'vitest';
import {isPublishable, selectBackfillScores, sendScores, SCORE_BATCH_SIZE, type PublishablePlayer} from '@/class/HiscoreBackfill';
import type {MauiApiClient, ScoreSubmission} from '@/class/MauiApiClient';

const player = (pseudo3: string, overrides: Partial<PublishablePlayer> = {}): PublishablePlayer => ({
    pseudo_3: pseudo3, active: true, remote_id: `id-${pseudo3}`, is_public: true, online_status: 'active', ...overrides,
});

describe('isPublishable', () => {
    it('keeps the active, public players linked to MAUI-API and not disabled there', () => {
        expect(isPublishable(player('NOB'))).toBe(true);
        expect(isPublishable(player('NOB', {online_status: 'locked'}))).toBe(true);
        expect(isPublishable(player('NOB', {is_public: false}))).toBe(false);
        expect(isPublishable(player('NOB', {active: false}))).toBe(false);
        expect(isPublishable(player('NOB', {remote_id: null}))).toBe(false);
        expect(isPublishable(player('NOB', {online_status: 'disabled'}))).toBe(false);
    });
});

describe('selectBackfillScores', () => {
    let next = 0;
    const newId = () => `uuid-${++next}`;
    const at = '2026-09-01T10:00:00.000Z';

    it('keeps the best score of each publishable player on each game', () => {
        const scores = selectBackfillScores([
            {romname: 'dkong', achievedAt: at, rows: [
                {rank: 1, score: 19200, name: 'MAF'},
                {rank: 2, score: 12900, name: 'NOB'},
                {rank: 4, score: 12200, name: 'NOB'},
                {rank: 5, score: 10500, name: 'SAJ'},
            ]},
            {romname: 'galaga', achievedAt: at, rows: [{rank: 1, score: 40000, name: 'nob'}]},
        ], [player('NOB'), player('SAJ', {is_public: false})], newId);

        expect(scores.map(score => [score.romname, score.playerId, score.score, score.rankOnCabinet])).toEqual([
            ['dkong', 'id-NOB', 12900, 2],
            ['galaga', 'id-NOB', 40000, 1],
        ]);
        expect(scores[0].achievedAt).toBe(at);
        expect(new Set(scores.map(score => score.id)).size).toBe(2);
    });
});

describe('sendScores', () => {
    const score = (i: number): ScoreSubmission => ({id: `s${i}`, playerId: 'p', romname: 'dkong', score: i, achievedAt: '2026-09-01T10:00:00.000Z'});

    it('sends batches of 100 and counts the outcomes', async () => {
        const postScores = vi.fn(async (batch: ScoreSubmission[]) => ({
            kind: 'ok' as const,
            value: batch.map((s, i) => i === 0
                ? {id: s.id, status: 'rejected' as const, code: 'player_disabled'}
                : {id: s.id, status: i % 2 ? 'accepted' as const : 'not_improved' as const, best: 1}),
        }));
        const scores = Array.from({length: SCORE_BATCH_SIZE + 3}, (_, i) => score(i));

        const summary = await sendScores({postScores} as unknown as MauiApiClient, scores);

        expect(postScores).toHaveBeenCalledTimes(2);
        expect(summary).toEqual({sent: 103, accepted: 51, notImproved: 50, rejected: {player_disabled: 2}});
    });

    it('stops at the first failed batch', async () => {
        const postScores = vi.fn(async () => ({kind: 'unavailable' as const, reason: 'network' as const}));

        const summary = await sendScores({postScores} as unknown as MauiApiClient, [score(1)]);

        expect(summary.failure).toEqual({kind: 'unavailable', reason: 'network'});
        expect(summary.sent).toBe(0);
    });
});
