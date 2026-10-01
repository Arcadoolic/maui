import {describe, it, expect} from 'vitest';
import {planPlayerSync, syncPlayers, type LocalPlayer} from '@/class/PlayerSync';
import type {MauiApiClient, OnlinePlayer} from '@/class/MauiApiClient';
import User from '@/model/User.model';

const ID_A = '01a0f983-0000-7000-8000-00000000000a';
const ID_B = '01a0f983-0000-7000-8000-00000000000b';

const local = (overrides: Partial<LocalPlayer>): LocalPlayer => ({
    id_user: 1, pseudo_3: 'ACE', remote_id: null, is_public: false, online_status: null, ...overrides,
});
const remote = (overrides: Partial<OnlinePlayer>): OnlinePlayer => ({
    id: ID_A, pseudo3: 'ACE', isPublic: false, status: 'active', ...overrides,
});

describe('planPlayerSync', () => {
    it('takes the visibility and status of a linked player from the API', () => {
        expect(planPlayerSync(
            [local({remote_id: ID_A, online_status: 'active'})],
            [remote({isPublic: true, status: 'locked'})],
        )).toEqual([{id_user: 1, remote_id: ID_A, is_public: true, online_status: 'locked'}]);
    });

    it('changes nothing when both sides agree', () => {
        expect(planPlayerSync(
            [local({remote_id: ID_A, is_public: true, online_status: 'active'})],
            [remote({isPublic: true})],
        )).toEqual([]);
    });

    it('turns a player no longer linked to this cabinet back into a local one', () => {
        expect(planPlayerSync(
            [local({remote_id: ID_A, is_public: true, online_status: 'active'})],
            [],
        )).toEqual([{id_user: 1, remote_id: null, is_public: true, online_status: null}]);
    });

    it('adopts the API id of a local player with the same initials', () => {
        expect(planPlayerSync([local({})], [remote({status: 'disabled'})]))
            .toEqual([{id_user: 1, remote_id: ID_A, is_public: false, online_status: 'disabled'}]);
    });

    it('never adopts an API player another local player is already linked to', () => {
        expect(planPlayerSync(
            [local({id_user: 1, remote_id: ID_A, online_status: 'active'}), local({id_user: 2, pseudo_3: 'ACE'})],
            [remote({})],
        )).toEqual([]);
    });

    it('leaves local-only players alone', () => {
        expect(planPlayerSync([local({pseudo_3: 'ZZZ'})], [remote({id: ID_B, pseudo3: 'ACE'})])).toEqual([]);
    });
});

describe('syncPlayers', () => {
    type Statics = Record<string, (...args: unknown[]) => unknown>;
    const user = User as unknown as Statics;

    it('applies the changes to the local players', async () => {
        const updates: unknown[] = [];
        user.findAll = () => Promise.resolve([{id_user: 7, pseudo_3: 'ACE', remote_id: null, is_public: false, online_status: null}]);
        user.update = (fields, options) => {
            updates.push([fields, options]);
            return Promise.resolve([1]);
        };
        const client = {listPlayers: async () => ({kind: 'ok', value: [remote({isPublic: true})]})} as unknown as MauiApiClient;

        expect(await syncPlayers(client)).toEqual({kind: 'ok', value: 1});
        expect(updates).toEqual([[{remote_id: ID_A, is_public: true, online_status: 'active'}, {where: {id_user: 7}}]]);
    });

    it('passes an API failure through without touching anything', async () => {
        user.findAll = () => {
            throw new Error('must not be called');
        };
        const failure = {kind: 'unavailable', reason: 'network'} as const;
        const client = {listPlayers: async () => failure} as unknown as MauiApiClient;

        expect(await syncPlayers(client)).toEqual(failure);
    });
});
