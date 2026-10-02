'use strict';

module.exports = {
    /**
     * The shared leaderboards MAUI-API last answered (MAUI-API Lot 2.4, maui-api
     * docs/DECISIONS.md D52, src/class/LeaderboardSync.ts): shown by the front in ONLINE mode,
     * also when the API cannot be reached. `entries` is the JSON array of the API's entries.
     * Guarded, migrations must be idempotent.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes('online_leaderboard')) {
            await queryInterface.createTable('online_leaderboard', {
                romname: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
                table_name: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
                entries: {type: Sequelize.TEXT, allowNull: false},
                updated_at: {type: Sequelize.TEXT, allowNull: false},
            });
        }
    },

    down: async (queryInterface) => {
        await queryInterface.dropTable('online_leaderboard');
    },
};
