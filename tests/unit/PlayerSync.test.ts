import {describe, it, expect, vi} from 'vitest';
import {planPlayerSync, syncPlayers, uploadAvatars, type LocalPlayer} from '@/class/PlayerSync';
import type {MauiApiClient, OnlinePlayer} from '@/class/MauiApiClient';
import User from '@/model/User.model';

const ID_A = '01a0f983-0000-7000-8000-00000000000a';
const ID_B = '01a0f983-0000-7000-8000-00000000000b';

const local = (overrides: Partial<LocalPlayer>): LocalPlayer => ({
    id_user: 1, pseudo_3: 'ACE', remote_id: null, is_public: false, online_status: null, ...overrides,
});
const remote = (overrides: Partial<OnlinePlayer>): OnlinePlayer => ({
    id: ID_A, pseudo3: 'ACE', isPublic: false, status: 'active', avatar: null, ...overrides,
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

describe('uploadAvatars', () => {
    const png = new Uint8Array([1, 2, 3]);
    const reader = (hash: string) => () => ({png, hash});

    it('sends the avatar of a linked player when MAUI-API has another one', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'ok' as const, value: 'new'}));
        const client = {uploadAvatar} as unknown as MauiApiClient;

        const sent = await uploadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'old'})], reader('new'), new Set());

        expect(sent).toBe(1);
        expect(uploadAvatar).toHaveBeenCalledWith(ID_A, png);
    });

    it('skips the same avatar, local-only players, and a PNG already refused', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'rejected' as const, status: 422, code: 'validation_failed'}));
        const client = {uploadAvatar} as unknown as MauiApiClient;
        const refused = new Set<string>();

        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'same'})], reader('same'), refused);
        await uploadAvatars(client, [local({remote_id: null})], [remote({})], reader('x'), refused);
        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({})], reader('big'), refused);
        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({})], reader('big'), refused);

        expect(uploadAvatar).toHaveBeenCalledTimes(1);
        expect(refused.has('big')).toBe(true);
    });
});
