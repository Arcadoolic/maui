'use strict';

module.exports = {
    /**
     * Add the ONLINE player columns to table user (MAUI-API Lot 2.2, maui-api docs/DECISIONS.md D48):
     * - remote_id: the player's id in MAUI-API (UUID), null while the player is local only;
     * - is_public: whether the player's scores show in the shared leaderboards, private by default
     *   so nothing is exposed without an explicit choice;
     * - online_status: the status MAUI-API last reported (active, disabled, locked), null when
     *   the player is not linked.
     * Guarded by describeTable(), migrations must be idempotent (a fresh install's sync() already
     * created the columns from the model).
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const userTable = await queryInterface.describeTable('user');
        if (!userTable.remote_id) {
            await queryInterface.addColumn('user', 'remote_id', {type: Sequelize.TEXT, allowNull: true});
            await queryInterface.addIndex('user', ['remote_id'], {unique: true, name: 'user_remote_id_unique'});
        }
        if (!userTable.is_public) {
            await queryInterface.addColumn('user', 'is_public', {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false});
        }
        if (!userTable.online_status) {
            await queryInterface.addColumn('user', 'online_status', {type: Sequelize.TEXT, allowNull: true});
        }
    },

    down: async (queryInterface) => {
        await queryInterface.removeIndex('user', 'user_remote_id_unique');
        await queryInterface.removeColumn('user', 'remote_id');
        await queryInterface.removeColumn('user', 'is_public');
        await queryInterface.removeColumn('user', 'online_status');
    },
};
