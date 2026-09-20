import User from '@/model/User.model';
import Config from '@/class/Config.class';
import {readdirSync} from 'fs';
import {ensureDefaultAvatar} from '@/class/DefaultAvatar';
import {findDeletedUser} from '@/class/UserReservation';

export default class UserService {
    protected users3: {[pseudo3: string]: User} = {};
    protected avatars: string[] = [];
    protected avatarsPath?: string;

    constructor(config: Config) {
        this.avatarsPath = config.avatarsPath;
    }

    public async loadUsers() {
        const users = await User.findAll();
        for (const user of users) {
            this.users3[user.pseudo_3] = user;
        }
    }

    public getUserByPseudo3(pseudo3: string): User {
        return this.users3[pseudo3];
    }

    /**
     * Create (or find) a user by their 3-letter pseudo and keep the users3 cache in sync.
     * loadUsers() only runs once at startup (see Init.vue), so a user created mid-session
     * through this method instead of a direct User.create()/findOrCreate() call would
     * otherwise stay invisible to getUserByPseudo3() - and to HiscoreService, which reads
     * that cache to attribute a saved score - until the next app restart.
     * A newly created user also gets a generated default avatar (see DefaultAvatar.ts). A pseudo
     * held by a deleted player is refused: `created` false and `reserved` true.
     */
    public async registerUser(pseudo3: string): Promise<{user: User; created: boolean; reserved: boolean}> {
        // A deleted player's pseudo stays reserved (see UserReservation.ts): refused here rather
        // than failing on the unique constraint, and never cached in users3 - HiscoreService
        // reads that cache to attribute scores, and a deleted player must not receive any.
        const deleted = await findDeletedUser(pseudo3);
        if (deleted) {
            return {user: deleted, created: false, reserved: true};
        }
        const [user, created] = await User.findOrCreate({where: {pseudo_3: pseudo3}, defaults: {active: false}});
        this.users3[user.pseudo_3] = user;
        if (created && ensureDefaultAvatar(this.avatarsPath, user.pseudo_3)) {
            // Forget the cached listing so getAvatars() picks the new file up (it also reloads
            // when empty, so pushing onto a cache that was never loaded would hide the others).
            this.avatars = [];
        }
        return {user, created, reserved: false};
    }

    public getAvatars(): string[] {
        if (!this.avatars.length && this.avatarsPath) {
            this.avatars = readdirSync(this.avatarsPath);
        }
        return this.avatars;
    }
}
