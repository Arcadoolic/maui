const path = require('path');

module.exports = {
    pluginOptions: {
        electronBuilder: {
            chainWebpackMainProcess: config => {
                config.resolve.alias.set('@', path.join(__dirname, 'src'))
            },
            mainProcessWatch: ['src/api/api.ts'],
            externals: ['sqlite3', 'sequelize'],
            builderOptions: {
                appId: "mame-awesome-ui",
                productName: "mame-awesome-ui",
                asar: true,
                linux: {
                    category: "Game"
                },
                extraResources: [
                    {
                        "from": "migrations/",
                        "to": "migrations/"
                    }
                ],
            }
        }
    }
};
