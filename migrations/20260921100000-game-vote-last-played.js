'use strict';

module.exports = {
    /**
     * Add columns vote (1 thumbs up, 0 neutral / not voted yet, -1 thumbs down) and
     * last_played_at (null = never played) to table game. Each one is guarded by describeTable()
     * like user-active: a fresh install has already had them created from Game.model.ts by
     * sequelize.sync() (see Database.install()), only databases created by an older version need
     * the addColumn.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const gameTable = await queryInterface.describeTable('game');
        if (!gameTable.vote) {
            await queryInterface.addColumn('game', 'vote', {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            });
        }
        if (!gameTable.last_played_at) {
            await queryInterface.addColumn('game', 'last_played_at', {
                type: Sequelize.DATE,
                allowNull: true,
            });
        }
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('game', 'vote');
        await queryInterface.removeColumn('game', 'last_played_at');
    },
};
