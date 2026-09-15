import User from '@/model/User.model';
import Config from '@/class/Config.class';
import {readdirSync} from 'fs';

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
     */
    public async registerUser(pseudo3: string): Promise<{user: User; created: boolean}> {
        const [user, created] = await User.findOrCreate({where: {pseudo_3: pseudo3}, defaults: {active: false}});
        this.users3[user.pseudo_3] = user;
        return {user, created};
    }

    public getAvatars(): string[] {
        if (!this.avatars.length && this.avatarsPath) {
            this.avatars = readdirSync(this.avatarsPath);
        }
        return this.avatars;
    }
}
