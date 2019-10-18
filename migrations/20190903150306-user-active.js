'use strict';

module.exports = {
    /**
     * Add column active to table user and set active to 1 for existing users
     * @param queryInterface
     * @param Sequelize
     * @return {Promise<Object>}
     */
    up: (queryInterface, Sequelize) => {
        return queryInterface.describeTable('user').then(userTable => {
            if (userTable.active) return Promise.resolve();
            return Promise.all([
                queryInterface.addColumn('user', 'active', {type: Sequelize.BOOLEAN, defaultValue: 0}),
                queryInterface.bulkUpdate('user', {active: 1}, {})
            ])
        })
    },

    down: (queryInterface, Sequelize) => {
        return queryInterface.removeColumn('user', 'active')
    }
};
