'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
    /**
     * Drops the seeded admin/admin BO account: the BO now has a single owner account (puckman),
     * and what used to be admin-only is shown through its "Advanced configuration" switch
     * instead of a second login. The role column stays (unused) - SQLite can't drop a column
     * without rebuilding the table, not worth it for a column nothing reads anymore.
     * Idempotent: deleting an absent row is a no-op. If no account is left (e.g. puckman had been
     * deleted by hand), puckman/puckman is recreated so the BO stays reachable.
     * @param queryInterface
     * @return {Promise<void>}
     */
    up: async (queryInterface) => {
        await queryInterface.bulkDelete('bo_user', {username: 'admin'});
        const [rows] = await queryInterface.sequelize.query('SELECT COUNT(*) AS count FROM bo_user');
        if (!Number(rows[0].count)) {
            const now = new Date();
            await queryInterface.bulkInsert('bo_user', [{
                username: 'puckman',
                passwordHash: bcrypt.hashSync('puckman', 10),
                role: 'user',
                creationDate: now,
                updatedOn: now,
            }]);
        }
    },

    down: async (queryInterface) => {
        const now = new Date();
        const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS count FROM bo_user WHERE username = 'admin'");
        if (!Number(rows[0].count)) {
            await queryInterface.bulkInsert('bo_user', [{
                username: 'admin',
                passwordHash: bcrypt.hashSync('admin', 10),
                role: 'admin',
                creationDate: now,
                updatedOn: now,
            }]);
        }
    },
};
