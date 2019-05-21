module.exports = {
    pluginOptions: {
        electronBuilder: {
            builderOptions: {
                appId: "mame.frontend",
                productName: "Mame Frontend",
                asar: true,
                extraResources: [
                    {
                        "from": "resources/hi2txt/",
                        "to": "hi2txt/"
                    }
                ],
                linux: {
                    category: "Game"
                }
            }
        }
    }
};
