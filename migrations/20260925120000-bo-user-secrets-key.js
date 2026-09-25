'use strict';

module.exports = {
    /**
     * Add column secretsKey to table bo_user: the data key encrypting the credentials held in
     * mame-awesome-ui-config.json, wrapped with a key derived from the account's password (see
     * src/class/SecretBox.ts). Null until the first sign-in with a non-default password.
     * Guarded by describeTable(), migrations must be idempotent (bo_user itself is only ever
     * created by a migration, never by sync()).
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: (queryInterface, Sequelize) => {
        return queryInterface.describeTable('bo_user').then(boUserTable => {
            if (boUserTable.secretsKey) return Promise.resolve();
            return queryInterface.addColumn('bo_user', 'secretsKey', {
                type: Sequelize.TEXT,
                allowNull: true,
            });
        });
    },

    down: (queryInterface) => {
        return queryInterface.removeColumn('bo_user', 'secretsKey');
    },
};
