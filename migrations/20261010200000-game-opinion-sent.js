'use strict';

module.exports = {
    /**
     * Add column opinion_sent to table game (maui-api docs/DECISIONS.md D75): the vote and play
     * count MAUI-API last acknowledged for the game, as OpinionReport.ts's opinionSignature()
     * writes them. Null until a report went through: the game is then sent.
     * Guarded by describeTable(), migrations must be idempotent.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const gameTable = await queryInterface.describeTable('game');
        if (!gameTable.opinion_sent) {
            await queryInterface.addColumn('game', 'opinion_sent', {type: Sequelize.STRING, allowNull: true});
        }
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('game', 'opinion_sent');
    },
};
