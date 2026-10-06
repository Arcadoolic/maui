import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import UserService from '@/class/UserService.class';
import User from '@/model/User.model';
import type Config from '@/class/Config.class';

// registerUser() exists because userRegistration.vue used to call User.findOrCreate()
// directly, bypassing UserService's users3 cache. loadUsers() only runs once at startup
// (Init.vue), so a user created mid-session was invisible to getUserByPseudo3() - and
// therefore to HiscoreService, which reads that cache to attribute a saved hiscore -
// until the next app restart, silently dropping that player's very first score.

type FakeUser = {pseudo_3: string};

// registerUser() first asks whether a deleted player holds the pseudo (User.findOne, paranoid
// off); most tests are about a pseudo nobody holds.
function stubFindOne(result: unknown) {
    (User as unknown as {findOne: (...args: unknown[]) => Promise<unknown>}).findOne = () => Promise.resolve(result);
}

function stubFindOrCreate(result: [FakeUser, boolean]) {
    (User as unknown as {findOrCreate: (...args: unknown[]) => Promise<[FakeUser, boolean]>})
        .findOrCreate = () => Promise.resolve(result);
}

describe('UserService.registerUser', () => {
    let service: UserService;

    beforeEach(() => {
        service = new UserService({} as Config);
        stubFindOne(null);
    });

    it('makes a newly created user immediately visible to getUserByPseudo3', async () => {
        const newUser = {pseudo_3: 'ABC'};
        stubFindOrCreate([newUser, true]);

        const {user, created} = await service.registerUser('ABC');

        expect(created).toBe(true);
        expect(user).toBe(newUser);
        expect(service.getUserByPseudo3('ABC')).toBe(newUser);
    });

    it('creates a new player as active', async () => {
        let options: {defaults?: {active?: boolean}} = {};
        (User as unknown as {findOrCreate: (opts: typeof options) => Promise<unknown>}).findOrCreate = (opts) => {
            options = opts;
            return Promise.resolve([{pseudo_3: 'ACT'}, true]);
        };

        await service.registerUser('ACT');

        expect(options.defaults?.active).toBe(true);
    });

    it('refuses a pseudo held by a deleted player, without creating or caching anything', async () => {
        const deleted = {pseudo_3: 'DEL', deletionDate: new Date()};
        stubFindOne(deleted);
        let createCalls = 0;
        (User as unknown as {findOrCreate: () => Promise<unknown>}).findOrCreate = () => {
            createCalls++;
            return Promise.resolve([{pseudo_3: 'DEL'}, true]);
        };

        const result = await service.registerUser('DEL');

        expect(result).toEqual({user: deleted, created: false, reserved: true});
        expect(createCalls).toBe(0);
        expect(service.getUserByPseudo3('DEL')).toBeUndefined();
    });

    it('restores a deleted player for the MAUI-API player they were linked to', async () => {
        const calls: string[] = [];
        const deleted = {
            pseudo_3: 'DEL', deletionDate: new Date(), remote_id: 'uuid-1',
            restore: () => { calls.push('restore'); return Promise.resolve(); },
            update: (values: {active?: boolean; remote_id?: string}) => {
                calls.push(`update active=${values.active} remote_id=${values.remote_id}`);
                return Promise.resolve();
            },
        };
        stubFindOne(deleted);

        const result = await service.registerUser('DEL', {
            id: 'uuid-1', pseudo3: 'DEL', isPublic: false, status: 'active', isOrigin: false, avatar: null,
        });

        expect(result).toEqual({user: deleted, created: false, reserved: false});
        expect(calls).toEqual(['restore', 'update active=true remote_id=uuid-1']);
        expect(service.getUserByPseudo3('DEL')).toBe(deleted);
    });

    it('keeps a deleted player reserved for another MAUI-API player, or a local-only one', async () => {
        const online = {id: 'uuid-2', pseudo3: 'DEL', isPublic: false, status: 'active' as const, isOrigin: false, avatar: null};

        stubFindOne({pseudo_3: 'DEL', deletionDate: new Date(), remote_id: 'uuid-1'});
        expect((await service.registerUser('DEL', online)).reserved).toBe(true);

        stubFindOne({pseudo_3: 'DEL', deletionDate: new Date(), remote_id: null});
        expect((await service.registerUser('DEL', online)).reserved).toBe(true);
        expect(await service.isDeletedOnlinePlayer('DEL')).toBe(false);
        expect(service.getUserByPseudo3('DEL')).toBeUndefined();
    });

    it('does not treat a live player as reserved', async () => {
        stubFindOne({pseudo_3: 'LIV', deletionDate: null});
        const live = {pseudo_3: 'LIV'};
        stubFindOrCreate([live, false]);

        const result = await service.registerUser('LIV');

        expect(result).toEqual({user: live, created: false, reserved: false});
    });

    it('still caches the user when findOrCreate finds an existing one', async () => {
        const existingUser = {pseudo_3: 'XYZ'};
        stubFindOrCreate([existingUser, false]);

        const {created} = await service.registerUser('XYZ');

        expect(created).toBe(false);
        expect(service.getUserByPseudo3('XYZ')).toBe(existingUser);
    });
});

describe('UserService.registerUser default avatar', () => {
    let dir: string;
    let service: UserService;

    beforeEach(() => {
        stubFindOne(null);
        dir = mkdtempSync(join(tmpdir(), 'maui-userservice-'));
        service = new UserService({avatarsPath: dir} as Config);
    });

    afterEach(() => {
        rmSync(dir, {recursive: true, force: true});
    });

    it('gives a newly registered player an avatar, visible to getAvatars() right away', async () => {
        writeFileSync(join(dir, 'OLD.png'), 'x');
        expect(service.getAvatars()).toEqual(['OLD.png']);
        stubFindOrCreate([{pseudo_3: 'NEW'}, true]);

        await service.registerUser('NEW');

        expect(service.getAvatars().sort()).toEqual(['NEW.svg', 'OLD.png']);
    });

    it('gives none to a player who already existed', async () => {
        stubFindOrCreate([{pseudo_3: 'OLD'}, false]);

        await service.registerUser('OLD');

        expect(service.getAvatars()).toEqual([]);
    });

    it('keeps the avatar a player already has', async () => {
        writeFileSync(join(dir, 'NEW.png'), 'uploaded');
        stubFindOrCreate([{pseudo_3: 'NEW'}, true]);

        await service.registerUser('NEW');

        expect(service.getAvatars()).toEqual(['NEW.png']);
    });
});

describe('UserService ONLINE players', () => {
    const online = {id: '01a0f983-0000-7000-8000-00000000000a', pseudo3: 'ONL', isPublic: true, status: 'locked' as const, isOrigin: true, avatar: null};
    let service: UserService;

    beforeEach(() => {
        service = new UserService({} as Config);
        stubFindOne(null);
    });

    it('creates the local player of an API player with its remote fields', async () => {
        let options: {where?: unknown; defaults?: Record<string, unknown>} = {};
        (User as unknown as {findOrCreate: (opts: typeof options) => Promise<unknown>}).findOrCreate = (opts) => {
            options = opts;
            return Promise.resolve([{pseudo_3: 'ONL'}, true]);
        };

        const {created} = await service.saveOnlineUser(online);

        expect(created).toBe(true);
        expect(options.where).toEqual({pseudo_3: 'ONL'});
        expect(options.defaults).toEqual({active: true, remote_id: online.id, is_public: true, online_status: 'locked', is_origin: true});
        expect(service.getUserByPseudo3('ONL')).toEqual({pseudo_3: 'ONL'});
    });

    it('links an existing local player to the API player', async () => {
        const updates: unknown[] = [];
        const existing = {pseudo_3: 'ONL', update: (fields: unknown) => {
            updates.push(fields);
            return Promise.resolve();
        }};
        stubFindOrCreate([existing as unknown as FakeUser, false]);

        await service.saveOnlineUser(online);

        expect(updates).toEqual([{remote_id: online.id, is_public: true, online_status: 'locked', is_origin: true}]);
    });

    it('tells whether initials are used by a local player, live or deleted', async () => {
        stubFindOne({pseudo_3: 'DEL', deletionDate: new Date()});
        expect(await service.isPseudoUsedLocally('DEL')).toBe(true);

        stubFindOne(null);
        expect(await service.isPseudoUsedLocally('NEW')).toBe(false);

        stubFindOne({pseudo_3: 'LIV', deletionDate: null});
        expect(await service.isPseudoUsedLocally('LIV')).toBe(true);
    });
});

describe('UserService scorers', () => {
    type Statics = {findAll: () => Promise<unknown[]>};
    const statics = User as unknown as Statics;

    it('reloads the players from the database, dropping the ones gone since', async () => {
        const service = new UserService({} as Config);
        statics.findAll = () => Promise.resolve([{pseudo_3: 'OLD', active: true}]);
        await service.loadUsers();
        statics.findAll = () => Promise.resolve([{pseudo_3: 'NEW', active: true}]);
        await service.loadUsers();

        expect(service.getUserByPseudo3('OLD')).toBeUndefined();
        expect(service.getUserByPseudo3('NEW')).toEqual({pseudo_3: 'NEW', active: true});
    });

    it('only hands scores to the players allowed to receive them', async () => {
        const service = new UserService({} as Config);
        statics.findAll = () => Promise.resolve([
            {pseudo_3: 'ONL', active: true, remote_id: 'id-1', online_status: 'active'},
            {pseudo_3: 'LOC', active: true, remote_id: null, online_status: null},
            {pseudo_3: 'OFF', active: false, remote_id: 'id-2', online_status: 'active'},
        ]);
        await service.loadUsers();

        expect(service.getScorer('ONL', true)?.pseudo_3).toBe('ONL');
        expect(service.getScorer('LOC', true)).toBeUndefined();
        expect(service.getScorer('LOC', false)?.pseudo_3).toBe('LOC');
        expect(service.getScorer('OFF', false)).toBeUndefined();
    });
});
