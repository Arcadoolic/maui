'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
    /**
     * Creates the bo_user table (BO login accounts) and seeds the two default accounts:
     * admin/admin (role admin) and puckman/puckman (role user).
     */
    up: (queryInterface, Sequelize) => {
        return queryInterface.createTable('bo_user', {
            id: {type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true},
            username: {type: Sequelize.TEXT, allowNull: false, unique: true},
            passwordHash: {type: Sequelize.TEXT, allowNull: false},
            role: {type: Sequelize.TEXT, allowNull: false, defaultValue: 'user'},
            // Matches BoUser.model.ts's @CreatedAt/@UpdatedAt property names (creationDate/
            // updatedOn), same as User.model.ts/user - unlike "createdAt"/"updatedAt", Sequelize
            // doesn't rename these to a convention on its own, so the column names must match
            // the model's attribute names exactly.
            creationDate: {type: Sequelize.DATE, allowNull: false},
            updatedOn: {type: Sequelize.DATE, allowNull: false},
        }).then(() => {
            const now = new Date();
            return queryInterface.bulkInsert('bo_user', [
                {
                    username: 'admin',
                    passwordHash: bcrypt.hashSync('admin', 10),
                    role: 'admin',
                    creationDate: now,
                    updatedOn: now,
                },
                {
                    username: 'puckman',
                    passwordHash: bcrypt.hashSync('puckman', 10),
                    role: 'user',
                    creationDate: now,
                    updatedOn: now,
                },
            ]);
        });
    },

    down: (queryInterface) => {
        return queryInterface.dropTable('bo_user');
    },
};
