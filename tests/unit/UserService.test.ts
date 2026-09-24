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
