'use strict';

module.exports = {
    /**
     * Add column is_origin to table user (maui-api docs/DECISIONS.md D54): whether MAUI-API says
     * the player was created on this cabinet, the only one that may issue a new PIN. False until
     * the player sync says otherwise.
     * Guarded by describeTable(), migrations must be idempotent.
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: async (queryInterface, Sequelize) => {
        const userTable = await queryInterface.describeTable('user');
        if (!userTable.is_origin) {
            await queryInterface.addColumn('user', 'is_origin', {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false});
        }
    },

    down: async (queryInterface) => {
        await queryInterface.removeColumn('user', 'is_origin');
    },
};
