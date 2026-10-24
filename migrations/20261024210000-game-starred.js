'use strict';

module.exports = {
    /**
     * Add column starred to table game: the star given on the cabinet when a game is quit (or from
     * the BO's Votes column), which puts it in the carousel's "My favourites" category. A starred
     * game is always voted thumbs up too (GameVote.ts).
     * Guarded by describeTable(), migrations must be idempotent.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const gameTable = await queryInterface.describeTable('game');
        if (!gameTable.starred) {
            await queryInterface.addColumn('game', 'starred', {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false});
        }
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('game', 'starred');
    },
};
