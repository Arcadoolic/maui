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

    public getAvatars(): string[] {
        if (!this.avatars.length && this.avatarsPath) {
            this.avatars = readdirSync(this.avatarsPath);
        }
        return this.avatars;
    }
}
