'use strict';

module.exports = {
    /**
     * Add column play_count (number of times the game was launched) to table game, starting at 0
     * for existing games. Guarded by describeTable() like user-active: a fresh install has
     * already had the column created from Game.model.ts by sequelize.sync() (see
     * Database.install()), only databases created by an older version need the addColumn.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: (queryInterface, Sequelize) => {
        return queryInterface.describeTable('game').then(gameTable => {
            if (gameTable.play_count) return Promise.resolve();
            return queryInterface.addColumn('game', 'play_count', {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            });
        });
    },

    down: (queryInterface) => {
        return queryInterface.removeColumn('game', 'play_count');
    },
};
