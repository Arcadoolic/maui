module.exports = {
    pluginOptions: {
        electronBuilder: {
            externals: ['sqlite3', 'sequelize'],
            builderOptions: {
                appId: "mame-awesome-ui",
                productName: "mame-awesome-ui",
                asar: true,
                linux: {
                    category: "Game"
                }
            }
        }
    }
};
