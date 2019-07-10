<template>
    <div>
        <p>Config</p>
        <div>
            <p>{{mamePath || 'undefined'}}</p>
            <button @click.prevent-="selectMamePath()">Select mame path</button>
            <button @click.prevent="selectAvatarsPath()">Select avatars path</button>
        </div>
        <button @click.prevent="save">Save</button>
    </div>
</template>

<script lang="ts">
    import {Component, Vue} from 'vue-property-decorator';
    import {remote} from 'electron';
    import {sep, join} from 'path';
    import {lstatSync, existsSync, mkdirSync} from 'fs';
    import Helpers from '@/class/Helpers.class';

    @Component
    export default class Config extends Vue {
        protected mamePath: string = '';
        protected mameBinaryName: string = '';
        protected avatarsPath: string = '';

        public created() {
            remote.getCurrentWindow().setResizable(true);
            remote.getCurrentWindow().setSize(640, 360);
            remote.getCurrentWindow().center();
            remote.getCurrentWindow().setResizable(false);

            this.mamePath = this.config.mamePath;
            this.mameBinaryName = this.config.mameBinaryName;
            this.avatarsPath = this.config.avatarsPath;
        }

        public get config() {
            return this.$store.getters.configuration;
        }

        public async selectMamePath() {
            const mameBinaryNames = ['mame.exe', 'mame64.exe', 'mame'];

            const mameDirPath = await remote.dialog.showOpenDialog({
                title: 'Select mame binary path',
                properties: ['openDirectory', 'showHiddenFiles'],
            });

            if (mameDirPath) {
                const mamePath = Helpers.getFirstExistingDirectory(mameBinaryNames, mameDirPath[0]);
                if (mamePath && lstatSync(mamePath).isFile()) {
                    this.mamePath = mameDirPath[0];
                    this.mameBinaryName = mamePath.split(sep).slice(-1)[0];
                    console.log(this.mameBinaryName);
                } else {
                    remote.dialog.showErrorBox('Path invalid', `Selected path "${mamePath}" is invalid.`);
                }
            }
        }

        public async selectAvatarsPath() {
            const avatarsDirPath = await remote.dialog.showOpenDialog({
                title: 'Select avatars directory path',
                properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
                defaultPath: Helpers.getUserDataPath(),
            });

            if (!existsSync(join(avatarsDirPath[0], 'mame-awesome-ui-avatars'))) {
                mkdirSync(join(avatarsDirPath[0], 'mame-awesome-ui-avatars'));
            }
            this.avatarsPath = join(avatarsDirPath[0], 'mame-awesome-ui-avatars');
        }

        public save() {
            this.config.mamePath = this.mamePath;
            this.config.mameBinaryName = this.mameBinaryName;
            this.config.avatarsPath = this.avatarsPath;
            this.config.save();
            return this.$router.push({name: 'init'});
        }
    }
</script>

<style scoped>
    * {
        color: white
    }
</style>
