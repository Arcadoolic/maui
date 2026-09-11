import {defineConfig} from 'vitest/config';
import {resolve} from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Same '@' alias the app uses, so test imports match source imports.
            '@': resolve(__dirname, 'src'),
            // Helpers.class.ts imports @electron/remote at module scope, which does
            // not exist outside an Electron renderer. Tests get a stand-in instead.
            '@electron/remote': resolve(__dirname, 'tests/stubs/electron-remote.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
