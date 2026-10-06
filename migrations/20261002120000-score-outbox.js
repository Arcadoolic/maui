'use strict';

module.exports = {
    /**
     * Scores waiting for MAUI-API, and the best of each player as MAUI-API last answered it
     * (MAUI-API Lot 2.3, maui-api docs/DECISIONS.md D50, src/class/ScoreOutbox.ts):
     * - score_outbox: one row per score, `id` the UUID sent as its idempotency key, `payload` the
     *   ScoreSubmission as JSON, `next_attempt_at` an ISO date (backoff after a failure);
     * - online_best: the cache that keeps the cabinet from sending what does not beat it.
     * Guarded, migrations must be idempotent.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes('score_outbox')) {
            await queryInterface.createTable('score_outbox', {
                id: {type: Sequelize.TEXT, primaryKey: true},
                payload: {type: Sequelize.TEXT, allowNull: false},
                attempts: {type: Sequelize.INTEGER, allowNull: false, defaultValue: 0},
                next_attempt_at: {type: Sequelize.TEXT, allowNull: false},
                created_at: {type: Sequelize.TEXT, allowNull: false},
            });
            await queryInterface.addIndex('score_outbox', ['next_attempt_at'], {name: 'score_outbox_next_attempt_at'});
        }
        if (!tables.includes('online_best')) {
            await queryInterface.createTable('online_best', {
                player_id: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
                romname: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
                table_name: {type: Sequelize.TEXT, allowNull: false, primaryKey: true},
                best: {type: Sequelize.INTEGER, allowNull: false},
            });
        }
    },

    down: async (queryInterface) => {
        await queryInterface.dropTable('score_outbox');
        await queryInterface.dropTable('online_best');
    },
};
