import {describe, it, expect} from 'vitest';
import {mkdtempSync, rmSync, readdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import {findDeletedUser, listDeletedUsers, restoreDeletedUser, purgeDeletedUser} from '@/class/UserReservation';

type Statics = Record<string, (...args: unknown[]) => unknown>;
const user = User as unknown as Statics;
const hiscore = Hiscore as unknown as Statics;

const deletedAt = new Date('2026-09-20T07:55:41Z');

describe('findDeletedUser', () => {
    it('returns the deleted player holding the pseudo, looking past the soft delete', async () => {
        let options: unknown;
        const deleted = {pseudo_3: 'NOB', deletionDate: deletedAt};
        user.findOne = (opts) => {
            options = opts;
            return Promise.resolve(deleted);
        };

        expect(await findDeletedUser('NOB')).toBe(deleted);
        expect(options).toEqual({where: {pseudo_3: 'NOB'}, paranoid: false});
    });

    it('returns null for a live player or an unknown pseudo', async () => {
        user.findOne = () => Promise.resolve({pseudo_3: 'LIV', deletionDate: null});
        expect(await findDeletedUser('LIV')).toBeNull();
        user.findOne = () => Promise.resolve(null);
        expect(await findDeletedUser('NEW')).toBeNull();
    });
});

describe('listDeletedUsers', () => {
    it('lists only the deleted players, with the scores they still hold', async () => {
        const nob = {id_user: 1, pseudo_3: 'NOB', deletionDate: deletedAt};
        const live = {id_user: 2, pseudo_3: 'LIV', deletionDate: null};
        const bex = {id_user: 3, pseudo_3: 'BEX', deletionDate: deletedAt};
        user.findAll = () => Promise.resolve([nob, live, bex]);
        hiscore.count = (opts) => Promise.resolve((opts as {where: {id_user: number}}).where.id_user === 1 ? 33 : 0);

        expect(await listDeletedUsers()).toEqual([
            {user: nob, scoreCount: 33},
            {user: bex, scoreCount: 0},
        ]);
    });
});

describe('restoreDeletedUser', () => {
    it('restores a deleted player and returns them', async () => {
        let restored = false;
        const deleted = {pseudo_3: 'NOB', deletionDate: deletedAt, restore: () => {
            restored = true;
            return Promise.resolve();
        }};
        user.findByPk = () => Promise.resolve(deleted);

        expect(await restoreDeletedUser('1')).toBe(deleted);
        expect(restored).toBe(true);
    });

    it('does nothing for a player who is not deleted, or does not exist', async () => {
        let restored = false;
        user.findByPk = () => Promise.resolve({
            pseudo_3: 'LIV', deletionDate: null, restore: () => {
                restored = true;
                return Promise.resolve();
            },
        });
        expect(await restoreDeletedUser(2)).toBeNull();
        user.findByPk = () => Promise.resolve(null);
        expect(await restoreDeletedUser(9)).toBeNull();
        expect(restored).toBe(false);
    });
});

describe('purgeDeletedUser', () => {
    function stubDeletedUser(calls: string[]) {
        const deleted = {
            id_user: 1, pseudo_3: 'NOB', deletionDate: deletedAt,
            destroy: (opts: unknown) => {
                calls.push('user.destroy ' + JSON.stringify(opts));
                return Promise.resolve();
            },
            sequelize: {transaction: (work: (t: string) => Promise<void>) => work('tx')},
        };
        user.findByPk = () => Promise.resolve(deleted);
        hiscore.count = () => Promise.resolve(33);
        hiscore.destroy = (opts) => {
            calls.push('hiscore.destroy ' + JSON.stringify(opts));
            return Promise.resolve(33);
        };
        return deleted;
    }

    it('really deletes the scores then the player, in one transaction, and reports the count', async () => {
        const calls: string[] = [];
        const deleted = stubDeletedUser(calls);

        const result = await purgeDeletedUser('1', undefined);

        expect(result).toEqual({user: deleted, scoreCount: 33});
        expect(calls).toEqual([
            'hiscore.destroy {"where":{"id_user":1},"force":true,"transaction":"tx"}',
            'user.destroy {"force":true,"transaction":"tx"}',
        ]);
    });

    it('removes the avatar files of the purged player', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'maui-purge-'));
        try {
            writeFileSync(join(dir, 'NOB.png'), 'x');
            writeFileSync(join(dir, 'NOB.svg'), 'x');
            writeFileSync(join(dir, 'KEEP.png'), 'x');
            stubDeletedUser([]);

            await purgeDeletedUser(1, dir);

            expect(readdirSync(dir)).toEqual(['KEEP.png']);
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    });

    it('refuses a player who is not deleted, or who does not exist, and touches nothing', async () => {
        const calls: string[] = [];
        hiscore.destroy = () => {
            calls.push('hiscore.destroy');
            return Promise.resolve(0);
        };
        user.findByPk = () => Promise.resolve({pseudo_3: 'LIV', deletionDate: null});
        expect(await purgeDeletedUser(2, undefined)).toBeNull();
        user.findByPk = () => Promise.resolve(null);
        expect(await purgeDeletedUser(9, undefined)).toBeNull();
        expect(calls).toEqual([]);
    });
});
