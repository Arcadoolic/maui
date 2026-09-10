const path = require('path');

module.exports = {
    chainWebpack: config => {
        // Force the real Node build instead of the no-op "browser" stub
        // (webpack's default resolve.mainFields picks it up otherwise,
        // which silently turns Sequelize/decorators into no-ops).
        config.resolve.alias.set(
            'sequelize-typescript',
            path.join(__dirname, 'node_modules/sequelize-typescript/dist/index.js')
        );
    },
    pluginOptions: {
        electronBuilder: {
            chainWebpackMainProcess: config => {
                config.resolve.alias.set('@', path.join(__dirname, 'src'))
            },
            mainProcessWatch: ['src/api/api.ts', 'src/boServer.ts'],
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
