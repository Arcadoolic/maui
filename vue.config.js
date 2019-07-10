module.exports = {
    pluginOptions: {
        electronBuilder: {
            externals: ['sqlite3', 'sequelize'],
            builderOptions: {
                appId: "mame.frontend",
                productName: "Mame Frontend",
                asar: true,
                linux: {
                    category: "Game"
                }
            }
        }
    }
};
