import User from '@/model/User.model';
import Config from '@/class/Config.class';
import {readdirSync} from 'fs';
import {ensureDefaultAvatar} from '@/class/DefaultAvatar';
import {findDeletedUser} from '@/class/UserReservation';
import type {OnlinePlayer} from '@/class/MauiApiClient';
import {canReceiveScores} from '@/class/OnlineReconciliation';

export default class UserService {
    protected users3: {[pseudo3: string]: User} = {};
    protected avatars: string[] = [];
    protected avatarsPath?: string;

    constructor(config: Config) {
        this.avatarsPath = config.avatarsPath;
    }

    /**
     * (Re)loads every live player. Called again before each hiscore save: players are also created,
     * linked or deactivated by the BO and by the ONLINE sync, in the main process.
     */
    public async loadUsers() {
        const users3: {[pseudo3: string]: User} = {};
        for (const user of await User.findAll()) {
            users3[user.pseudo_3] = user;
        }
        this.users3 = users3;
    }

    public getUserByPseudo3(pseudo3: string): User {
        return this.users3[pseudo3];
    }

    /** The player a score under these initials goes to, if any (see canReceiveScores()). */
    public getScorer(pseudo3: string, onlineEnabled: boolean): User | undefined {
        const user = this.users3[pseudo3];
        return user && canReceiveScores({
            active: !!user.active, remote_id: user.remote_id ?? null, online_status: user.online_status ?? null,
        }, onlineEnabled) ? user : undefined;
    }

    /**
     * Create (or find) a user by their 3-letter pseudo and keep the users3 cache in sync.
     * loadUsers() only runs once at startup (see Init.vue), so a user created mid-session
     * through this method instead of a direct User.create()/findOrCreate() call would
     * otherwise stay invisible to getUserByPseudo3() - and to HiscoreService, which reads
     * that cache to attribute a saved score - until the next app restart.
     * A newly created user also gets a generated default avatar (see DefaultAvatar.ts). A pseudo
     * held by a deleted player is refused: `created` false and `reserved` true.
     * A player registered here (from the cabinet itself) is active straight away; an existing
     * player found by findOrCreate keeps whatever status the BO gave them.
     */
    public async registerUser(
        pseudo3: string, online?: OnlinePlayer,
    ): Promise<{user: User; created: boolean; reserved: boolean}> {
        // A deleted player's pseudo stays reserved (see UserReservation.ts): refused here rather
        // than failing on the unique constraint, and never cached in users3 - HiscoreService
        // reads that cache to attribute scores, and a deleted player must not receive any.
        const deleted = await findDeletedUser(pseudo3);
        if (deleted) {
            return {user: deleted, created: false, reserved: true};
        }
        const remote = online ? onlineFields(online) : {};
        const [user, created] = await User.findOrCreate({where: {pseudo_3: pseudo3}, defaults: {active: true, ...remote}});
        if (online && !created) {
            await user.update(remote);
        }
        this.users3[user.pseudo_3] = user;
        if (created && ensureDefaultAvatar(this.avatarsPath, user.pseudo_3)) {
            // Forget the cached listing so getAvatars() picks the new file up (it also reloads
            // when empty, so pushing onto a cache that was never loaded would hide the others).
            this.avatars = [];
        }
        return {user, created, reserved: false};
    }

    /**
     * The local player of an API player (OnlineRegistration.ts): created, or linked when a local
     * player already has these initials.
     */
    public saveOnlineUser(player: OnlinePlayer): Promise<{user: User; created: boolean; reserved: boolean}> {
        return this.registerUser(player.pseudo3, player);
    }

    /** Initials held by a local player, live or deleted (a deleted one keeps them reserved). */
    public async isPseudoUsedLocally(pseudo3: string): Promise<boolean> {
        return !!(this.users3[pseudo3] || await User.findOne({where: {pseudo_3: pseudo3}, paranoid: false}));
    }

    public getAvatars(): string[] {
        if (!this.avatars.length && this.avatarsPath) {
            this.avatars = readdirSync(this.avatarsPath);
        }
        return this.avatars;
    }
}

function onlineFields(player: OnlinePlayer): Pick<User, 'remote_id' | 'is_public' | 'online_status' | 'is_origin'> {
    return {remote_id: player.id, is_public: player.isPublic, online_status: player.status, is_origin: player.isOrigin};
}
