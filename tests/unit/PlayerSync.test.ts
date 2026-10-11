import {describe, it, expect, vi} from 'vitest';
import {downloadAvatars, planPlayerSync, syncPlayers, uploadAvatars, type LocalPlayer} from '@/class/PlayerSync';
import type {MauiApiClient, OnlinePlayer} from '@/class/MauiApiClient';
import User from '@/model/User.model';

const ID_A = '01a0f983-0000-7000-8000-00000000000a';
const ID_B = '01a0f983-0000-7000-8000-00000000000b';

const local = (overrides: Partial<LocalPlayer>): LocalPlayer => ({
    id_user: 1, pseudo_3: 'ACE', remote_id: null, is_public: false, online_status: null, is_origin: false, ...overrides,
});
const remote = (overrides: Partial<OnlinePlayer>): OnlinePlayer => ({
    id: ID_A, pseudo3: 'ACE', isPublic: false, status: 'active', isOrigin: false, avatar: null, avatarByAdmin: false, ...overrides,
});

describe('planPlayerSync', () => {
    it('takes the visibility and status of a linked player from the API', () => {
        expect(planPlayerSync(
            [local({remote_id: ID_A, online_status: 'active'})],
            [remote({isPublic: true, status: 'locked'})],
        )).toEqual([{id_user: 1, remote_id: ID_A, is_public: true, online_status: 'locked', is_origin: false}]);
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
        )).toEqual([{id_user: 1, remote_id: null, is_public: true, online_status: null, is_origin: false}]);
    });

    it('adopts the API id of a local player with the same initials', () => {
        expect(planPlayerSync([local({})], [remote({status: 'disabled'})]))
            .toEqual([{id_user: 1, remote_id: ID_A, is_public: false, online_status: 'disabled', is_origin: false}]);
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
        user.findAll = () => Promise.resolve([{id_user: 7, pseudo_3: 'ACE', remote_id: null, is_public: false, online_status: null, is_origin: false}]);
        user.update = (fields, options) => {
            updates.push([fields, options]);
            return Promise.resolve([1]);
        };
        const client = {listPlayers: async () => ({kind: 'ok', value: [remote({isPublic: true})]})} as unknown as MauiApiClient;

        expect(await syncPlayers(client)).toEqual({kind: 'ok', value: 1});
        expect(updates).toEqual([[{remote_id: ID_A, is_public: true, online_status: 'active', is_origin: false}, {where: {id_user: 7}}]]);
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

describe('origin cabinet', () => {
    it('takes from the API whether the player was created on this cabinet', () => {
        expect(planPlayerSync(
            [local({remote_id: ID_A, online_status: 'active'})],
            [remote({isOrigin: true})],
        )).toEqual([{id_user: 1, remote_id: ID_A, is_public: false, online_status: 'active', is_origin: true}]);
    });
});

describe('uploadAvatars', () => {
    const png = new Uint8Array([1, 2, 3]);
    const reader = (hash: string) => () => ({png, hash});

    it('sends the avatar of a player created here when MAUI-API has another one', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'ok' as const, value: 'new'}));
        const client = {uploadAvatar} as unknown as MauiApiClient;

        const sent = await uploadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'old', isOrigin: true})], reader('new'), new Set());

        expect(sent).toBe(1);
        expect(uploadAvatar).toHaveBeenCalledWith(ID_A, png, null);
    });

    it('skips the same avatar, local-only players, and a PNG already refused', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'rejected' as const, status: 422, code: 'validation_failed'}));
        const client = {uploadAvatar} as unknown as MauiApiClient;
        const refused = new Set<string>();

        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'same', isOrigin: true})], reader('same'), refused);
        await uploadAvatars(client, [local({remote_id: null})], [remote({isOrigin: true})], reader('x'), refused);
        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({isOrigin: true})], reader('big'), refused);
        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({isOrigin: true})], reader('big'), refused);

        expect(uploadAvatar).toHaveBeenCalledTimes(1);
        expect(refused.has('big')).toBe(true);
    });

    it('never sends the avatar of a player created on another cabinet (maui-api D56)', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'ok' as const, value: 'new'}));
        const client = {uploadAvatar} as unknown as MauiApiClient;

        const sent = await uploadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'old', isOrigin: false})], reader('new'), new Set());

        expect(sent).toBe(0);
        expect(uploadAvatar).not.toHaveBeenCalled();
    });
});

// An administrator may change an avatar too (maui-api D83).
describe('an avatar set by an administrator', () => {
    const mine = new Uint8Array([1, 2, 3]);
    const theirs = new Uint8Array([7, 8, 9]);
    const ledgerOf = (known: string | null) => {
        const entries = new Map<string, string>(known ? [[ID_A, known]] : []);
        return {get: (id: string) => entries.get(id) ?? null, set: (id: string, hash: string) => { entries.set(id, hash); }, entries};
    };
    const admins = remote({avatar: 'admin', avatarByAdmin: true, isOrigin: true});

    it('is taken by the cabinet the player was created on, which does not send its own over it', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'ok' as const, value: 'x'}));
        const getAvatar = vi.fn(async () => ({kind: 'ok' as const, value: theirs}));
        const client = {uploadAvatar, getAvatar} as unknown as MauiApiClient;
        const ledger = ledgerOf('before');
        const save = vi.fn();
        const read = () => ({png: mine, hash: 'before'});

        expect(await uploadAvatars(client, [local({remote_id: ID_A})], [admins], read, new Set(), ledger)).toBe(0);
        expect(uploadAvatar).not.toHaveBeenCalled();
        expect(await downloadAvatars(client, [local({remote_id: ID_A})], [admins], read, save, ledger)).toBe(1);
        expect(save).toHaveBeenCalledWith('ACE', theirs);
        expect(ledger.entries.get(ID_A)).toBe('admin');
    });

    it('is taken the first time too, when the cabinet has no record of what it last had', async () => {
        const getAvatar = vi.fn(async () => ({kind: 'ok' as const, value: theirs}));
        const save = vi.fn();

        expect(await downloadAvatars({getAvatar} as unknown as MauiApiClient, [local({remote_id: ID_A})], [admins],
            () => ({png: mine, hash: 'mine'}), save, ledgerOf(null))).toBe(1);
    });

    it('is replaced by a picture changed on the cabinet afterwards, named as what it replaces', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'ok' as const, value: 'newer'}));
        const getAvatar = vi.fn(async () => ({kind: 'ok' as const, value: theirs}));
        const client = {uploadAvatar, getAvatar} as unknown as MauiApiClient;
        // The cabinet has had the administrator's picture, then its own was changed.
        const ledger = ledgerOf('admin');
        const save = vi.fn();
        const read = () => ({png: mine, hash: 'newer'});

        expect(await uploadAvatars(client, [local({remote_id: ID_A})], [admins], read, new Set(), ledger)).toBe(1);
        expect(uploadAvatar).toHaveBeenCalledWith(ID_A, mine, 'admin');
        expect(ledger.entries.get(ID_A)).toBe('newer');
        // And nothing is taken back from MAUI-API.
        expect(await downloadAvatars(client, [local({remote_id: ID_A})], [admins], read, save, ledger)).toBe(0);
        expect(save).not.toHaveBeenCalled();
    });

    it('does not blame the PNG when an administrator changed the avatar meanwhile', async () => {
        const uploadAvatar = vi.fn(async () => ({kind: 'rejected' as const, status: 409, code: 'avatar_changed_by_admin'}));
        const refused = new Set<string>();

        await uploadAvatars({uploadAvatar} as unknown as MauiApiClient, [local({remote_id: ID_A})],
            [remote({avatar: 'old', isOrigin: true})], () => ({png: mine, hash: 'mine'}), refused, ledgerOf('old'));

        expect(uploadAvatar).toHaveBeenCalledWith(ID_A, mine, null);
        expect(refused.size).toBe(0);
    });

    it('remembers the avatar both sides have, and still never takes a cabinet\'s own picture back', async () => {
        const uploadAvatar = vi.fn();
        const getAvatar = vi.fn();
        const client = {uploadAvatar, getAvatar} as unknown as MauiApiClient;
        const ledger = ledgerOf(null);

        await uploadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'same', isOrigin: true})], () => ({png: mine, hash: 'same'}), new Set(), ledger);
        expect(ledger.entries.get(ID_A)).toBe('same');

        // Created here, changed here since, not an administrator's upstream: sent, never downloaded.
        expect(await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'same', isOrigin: true})],
            () => ({png: mine, hash: 'changed'}), vi.fn(), ledger)).toBe(0);
        expect(getAvatar).not.toHaveBeenCalled();
    });
});

describe('downloadAvatars', () => {
    const png = new Uint8Array([4, 5, 6]);
    const reader = (hash: string | null) => () => (hash === null ? null : {png: new Uint8Array([1]), hash});

    it('takes the avatar of a player created on another cabinet when the local one differs or is missing', async () => {
        const getAvatar = vi.fn(async () => ({kind: 'ok' as const, value: png}));
        const client = {getAvatar} as unknown as MauiApiClient;
        const save = vi.fn();

        expect(await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'theirs'})], reader('mine'), save)).toBe(1);
        // No local PNG at all: the default picture a link starts with is an SVG.
        expect(await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'theirs'})], reader(null), save)).toBe(1);

        expect(getAvatar).toHaveBeenCalledWith(ID_A);
        expect(save).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledWith('ACE', png);
    });

    it('leaves alone the same avatar, a player created here, one without avatar upstream and local-only players', async () => {
        const getAvatar = vi.fn(async () => ({kind: 'ok' as const, value: png}));
        const client = {getAvatar} as unknown as MauiApiClient;
        const save = vi.fn();

        await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'same'})], reader('same'), save);
        await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'theirs', isOrigin: true})], reader('mine'), save);
        await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: null})], reader('mine'), save);
        await downloadAvatars(client, [local({remote_id: null})], [remote({avatar: 'theirs'})], reader('mine'), save);

        expect(getAvatar).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('saves nothing when MAUI-API does not give the avatar', async () => {
        const getAvatar = vi.fn(async () => ({kind: 'rejected' as const, status: 404, code: 'avatar_not_found'}));
        const client = {getAvatar} as unknown as MauiApiClient;
        const save = vi.fn();

        expect(await downloadAvatars(client, [local({remote_id: ID_A})], [remote({avatar: 'theirs'})], reader('mine'), save)).toBe(0);
        expect(save).not.toHaveBeenCalled();
    });
});
