'use strict';

module.exports = {
    /**
     * Drop table online_best: the best of each player as MAUI-API last answered it, which kept the
     * cabinet from sending lower scores. It stayed above a score MAUI-API hid since, so the
     * player's next scores never reached it (src/class/ScoreOutbox.ts). Every score is sent now.
     * Guarded by showAllTables(), migrations must be idempotent.
     * @param queryInterface
     * @return {Promise<Object>}
     */
    up: async (queryInterface) => {
        const tables = await queryInterface.showAllTables();
        if (tables.includes('online_best')) {
            await queryInterface.dropTable('online_best');
        }
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('online_best', {
            player_id: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
            romname: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
            table_name: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
            best: {type: Sequelize.INTEGER, allowNull: false},
        });
    },
};
