import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import {removeAvatarFiles} from '@/class/AvatarFiles';

/**
 * A deleted player is only soft-deleted (User is `paranoid`: destroy() stamps `deletionDate`), and
 * their row keeps holding the pseudo - pseudo_3 is unique. That is on purpose: the pseudo stays
 * reserved, so nobody else can register it and inherit the scores still attached to it. Only an
 * administrator can bring the player back (see restoreDeletedUser()), or delete them for good
 * (see purgeDeletedUser(), which also frees the pseudo).
 */

/** The deleted player still holding `pseudo3`, if any (live players are not returned). */
export async function findDeletedUser(pseudo3: string): Promise<User | null> {
    const user = await User.findOne({where: {pseudo_3: pseudo3}, paranoid: false});
    return user && user.deletionDate ? user : null;
}

export interface DeletedUserRow {
    user: User;
    // Scores that stay attached to the player, hidden from the hiscore views meanwhile.
    scoreCount: number;
}

/** Every deleted player, by pseudo, with the number of scores they still hold. */
export async function listDeletedUsers(): Promise<DeletedUserRow[]> {
    const users = (await User.findAll({paranoid: false, order: [['pseudo_3', 'ASC']]}))
        .filter(user => !!user.deletionDate);
    return Promise.all(users.map(async user => ({
        user, scoreCount: await Hiscore.count({where: {id_user: user.id_user}}),
    })));
}

/** Brings a deleted player back, scores included. Null when there is no such deleted player. */
export async function restoreDeletedUser(idUser: string | number): Promise<User | null> {
    const user = await User.findByPk(idUser, {paranoid: false});
    if (!user || !user.deletionDate) {
        return null;
    }
    await user.restore();
    return user;
}

/**
 * Deletes a *deleted* player for good: the user row, every score of theirs and their avatar
 * files, in one transaction so a failure cannot leave the scores without their player or the
 * reverse (the files go afterwards - they can't be rolled back, and keeping them is harmless if
 * it failed). `force: true` runs a real DELETE, where a plain destroy() would only stamp
 * `deletionDate` again. Only a player who is already deleted is accepted: a live player has to go
 * through the normal delete first. Returns who was removed and how many scores went with them, or
 * null when there is no such deleted player. The pseudo is free to register again afterwards.
 */
export async function purgeDeletedUser(
    idUser: string | number, avatarsPath: string | undefined,
): Promise<{user: User; scoreCount: number} | null> {
    const user = await User.findByPk(idUser, {paranoid: false});
    if (!user || !user.deletionDate) {
        return null;
    }
    // Same count listDeletedUsers() showed the administrator before they confirmed.
    const scoreCount = await Hiscore.count({where: {id_user: user.id_user}});
    await user.sequelize.transaction(async (transaction) => {
        await Hiscore.destroy({where: {id_user: user.id_user}, force: true, transaction});
        await user.destroy({force: true, transaction});
    });
    removeAvatarFiles(avatarsPath, user.pseudo_3);
    return {user, scoreCount};
}
