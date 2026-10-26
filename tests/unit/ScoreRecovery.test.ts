import {afterEach, beforeEach, describe, it, expect, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'fs';
import {join, resolve} from 'path';
import os from 'os';
import {
    answerScoreRecoveries, findRow, readRecoveryAnswers, readRecoveryTable, recordRecoveryAnswer,
    type RecoveryAnswer, type RecoveryDeps,
} from '@/class/ScoreRecovery';
import type {MauiApiClient, ScoreRecoveryRequest, ScoreSubmission} from '@/class/MauiApiClient';

const MAME_HOME = resolve(__dirname, '../fixtures/mame-home');

const request = (overrides: Partial<ScoreRecoveryRequest> = {}): ScoreRecoveryRequest => ({
    id: 'r1', playerId: 'p-nob', romname: 'dkong', table: 'default', score: 12900,
    achievedAt: '2026-10-20T20:30:00Z', ...overrides,
});

function fakeClient(requests: ScoreRecoveryRequest[]) {
    return {
        listScoreRecoveries: vi.fn(async () => ({kind: 'ok' as const, value: requests})),
        reportScoreRecovery: vi.fn(async () => ({kind: 'ok' as const, value: undefined})),
    };
}

function deps(overrides: Partial<RecoveryDeps> = {}) {
    const added: ScoreSubmission[] = [];
    const answers: RecoveryAnswer[] = [];
    const result: RecoveryDeps = {
        players: async () => [{pseudo_3: 'NOB', remote_id: 'p-nob'}, {pseudo_3: 'MAF', remote_id: null}],
        readTable: (romname, table) => readRecoveryTable(MAME_HOME, romname, table),
        store: {add: async (submissions) => void added.push(...submissions)},
        record: answer => void answers.push(answer),
        ...overrides,
    };
    return {deps: result, added, answers};
}

describe('answerScoreRecoveries', () => {
    it('queues a requested score found in the table, as recovered, its id the request\'s', async () => {
        const client = fakeClient([request()]);
        const {deps: d, added, answers} = deps();

        expect(await answerScoreRecoveries(client as unknown as MauiApiClient, d)).toEqual({queued: 1, notFound: 0, failure: null});
        expect(added).toEqual([{
            id: 'r1', recoveryId: 'r1', playerId: 'p-nob', romname: 'dkong', table: 'default', score: 12900,
            rankOnCabinet: 2, achievedAt: '2026-10-20T20:30:00Z', startupId: null, attribution: 'recovered',
        }]);
        expect(client.reportScoreRecovery).not.toHaveBeenCalled();
        expect(answers).toMatchObject([{id: 'r1', romname: 'dkong', score: 12900, pseudo3: 'NOB', outcome: 'queued'}]);
    });

    it('reports a score that is not in the table, with the table read', async () => {
        const client = fakeClient([request({score: 13000})]);
        const {deps: d, added, answers} = deps();

        expect(await answerScoreRecoveries(client as unknown as MauiApiClient, d)).toMatchObject({queued: 0, notFound: 1});
        expect(added).toEqual([]);
        expect(client.reportScoreRecovery).toHaveBeenCalledWith('r1', 'not_in_table', expect.arrayContaining([
            {rank: 1, score: 19200, name: 'MAF'},
        ]));
        expect(answers).toMatchObject([{outcome: 'not_found', reason: 'not_in_table'}]);
    });

    it('reports a player this cabinet does not have, or a game it cannot read', async () => {
        const client = fakeClient([
            request({id: 'r1', playerId: 'p-unknown'}),
            request({id: 'r2', romname: 'notagame'}),
            request({id: 'r3', table: 'extra'}),
        ]);
        const {deps: d} = deps();

        await answerScoreRecoveries(client as unknown as MauiApiClient, d);

        expect(client.reportScoreRecovery.mock.calls.map(call => [call[0], call[1]])).toEqual([
            ['r1', 'player_not_on_cabinet'], ['r2', 'unsupported'], ['r3', 'unreadable'],
        ]);
    });

    it('reports a game whose file was never written', async () => {
        const empty = mkdtempSync(join(os.tmpdir(), 'maui-mame-'));
        const client = fakeClient([request()]);
        const {deps: d} = deps({readTable: (romname, table) => readRecoveryTable(empty, romname, table)});

        await answerScoreRecoveries(client as unknown as MauiApiClient, d);

        expect(client.reportScoreRecovery).toHaveBeenCalledWith('r1', 'no_file', []);
        rmSync(empty, {recursive: true, force: true});
    });

    it('leaves the requests open when MAUI-API cannot be reached', async () => {
        const client = {
            listScoreRecoveries: vi.fn(async () => ({kind: 'unavailable' as const, reason: 'network' as const})),
            reportScoreRecovery: vi.fn(),
        };
        const {deps: d, added} = deps();

        expect(await answerScoreRecoveries(client as unknown as MauiApiClient, d))
            .toEqual({queued: 0, notFound: 0, failure: {kind: 'unavailable', reason: 'network'}});
        expect(added).toEqual([]);
    });
});

describe('findRow', () => {
    it('matches the initials and the exact score, a score written as text included', () => {
        const rows = [{rank: 1, score: '250000' as unknown as number, name: 'nob'}, {rank: 2, score: 250000, name: 'ABE'}];

        expect(findRow(rows, 'NOB', 250000)?.rank).toBe(1);
        expect(findRow(rows, 'NOB', 249999)).toBeNull();
    });
});

describe('recovery answers', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(os.tmpdir(), 'maui-recoveries-'));
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('keeps one line per request, newest first', () => {
        const path = join(dir, 'score-recoveries.json');
        const answer = (id: string, outcome: RecoveryAnswer['outcome']): RecoveryAnswer =>
            ({id, romname: 'dkong', score: 1, pseudo3: 'NOB', outcome, answeredAt: '2026-10-26T10:00:00Z'});

        recordRecoveryAnswer(answer('r1', 'not_found'), path);
        recordRecoveryAnswer(answer('r2', 'queued'), path);
        recordRecoveryAnswer(answer('r1', 'queued'), path);

        expect(readRecoveryAnswers(path).map(a => `${a.id}:${a.outcome}`)).toEqual(['r1:queued', 'r2:queued']);
    });
});
