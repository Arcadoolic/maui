import User from '@/model/User.model';

export default class UserService {
    protected users3: {[pseudo3: string]: User} = {};

    public async loadUsers() {
        const users = await User.findAll();
        for (const user of users) {
            this.users3[user.pseudo_3] = user;
        }
    }

    public getUserByPseudo3(pseudo3: string) {
        return this.users3[pseudo3];
    }

}
