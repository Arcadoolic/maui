import {defineConfig} from 'vitest/config';
import {resolve} from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Order matters: alias matching is first-match-wins on a prefix basis,
            // so the specific '@/model/...' entries must come before the generic
            // '@' entry below or they are shadowed by it.
            //
            // Helpers.class.ts imports @electron/remote at module scope, which does
            // not exist outside an Electron renderer. Tests get a stand-in instead.
            '@electron/remote': resolve(__dirname, 'tests/stubs/electron-remote.ts'),
            // Game.model.ts and Category.model.ts use sequelize-typescript `@Column`
            // decorators that need emitDecoratorMetadata, which Vitest's esbuild
            // transform does not emit. Loading the real models throws at
            // class-definition time. Tests get stand-ins instead.
            '@/model/Game.model': resolve(__dirname, 'tests/stubs/game-model.ts'),
            '@/model/Category.model': resolve(__dirname, 'tests/stubs/category-model.ts'),
            // Same '@' alias the app uses, so test imports match source imports.
            '@': resolve(__dirname, 'src'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
