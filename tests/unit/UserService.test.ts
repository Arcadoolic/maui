import {describe, it, expect, beforeEach} from 'vitest';
import UserService from '@/class/UserService.class';
import User from '@/model/User.model';
import type Config from '@/class/Config.class';

// registerUser() exists because userRegistration.vue used to call User.findOrCreate()
// directly, bypassing UserService's users3 cache. loadUsers() only runs once at startup
// (Init.vue), so a user created mid-session was invisible to getUserByPseudo3() - and
// therefore to HiscoreService, which reads that cache to attribute a saved hiscore -
// until the next app restart, silently dropping that player's very first score.

type FakeUser = {pseudo_3: string};

function stubFindOrCreate(result: [FakeUser, boolean]) {
    (User as unknown as {findOrCreate: (...args: unknown[]) => Promise<[FakeUser, boolean]>})
        .findOrCreate = () => Promise.resolve(result);
}

describe('UserService.registerUser', () => {
    let service: UserService;

    beforeEach(() => {
        service = new UserService({} as Config);
    });

    it('makes a newly created user immediately visible to getUserByPseudo3', async () => {
        const newUser = {pseudo_3: 'ABC'};
        stubFindOrCreate([newUser, true]);

        const {user, created} = await service.registerUser('ABC');

        expect(created).toBe(true);
        expect(user).toBe(newUser);
        expect(service.getUserByPseudo3('ABC')).toBe(newUser);
    });

    it('still caches the user when findOrCreate finds an existing one', async () => {
        const existingUser = {pseudo_3: 'XYZ'};
        stubFindOrCreate([existingUser, false]);

        const {created} = await service.registerUser('XYZ');

        expect(created).toBe(false);
        expect(service.getUserByPseudo3('XYZ')).toBe(existingUser);
    });
});
