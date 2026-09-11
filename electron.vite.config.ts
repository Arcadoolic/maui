import {resolve} from 'path';
import {defineConfig, swcPlugin} from 'electron-vite';
import vue from '@vitejs/plugin-vue';

// Decorator metadata.
//
// sequelize-typescript's `@Column` decorators need TypeScript's
// `emitDecoratorMetadata`. esbuild, which is what Vite uses to transform
// TypeScript by default, does not implement it: the decorators still run but
// they receive no design-time type information, so the models end up with no
// column metadata and the build succeeds anyway. Vitest hit exactly this in
// Phase A and had to stub the models.
//
// electron-vite 5 ships `swcPlugin`, powered by swc, which does emit the
// metadata. It is a plain Vite plugin (it sets `esbuild: false` and takes over
// every .ts/.mts/.tsx/.jsx transform), so it is applied to both bundles here:
// the main process carries boServer.ts and the models, and the renderer needs
// it once the class-based components are ported.
//
// In the renderer it must come AFTER `vue()`. @vitejs/plugin-vue compiles an
// SFC into a module plus virtual sub-requests such as
// `Foo.vue?vue&type=script&setup=true&lang.ts`. Those ids end in `.ts`, so swc
// picks them up and strips the TypeScript that `esbuild: false` no longer
// strips. Running swc first would hand `compileScript` type-erased source and
// break the type-only macros.

const alias = {
    // Force the real Node build of sequelize-typescript instead of the no-op
    // "browser" stub, which the default mainFields resolution picks up and
    // which silently turns the decorators into no-ops. Carried over from
    // vue.config.js.
    'sequelize-typescript': resolve(__dirname, 'node_modules/sequelize-typescript/dist/index.js'),
    '@': resolve(__dirname, 'src'),
};

export default defineConfig({
    main: {
        // No externalizeDepsPlugin: it is deprecated in electron-vite 5 and
        // replaced by `build.externalizeDeps`, which defaults to true for the
        // main and preload bundles. sqlite3 (a native addon) and sequelize
        // therefore stay external without any configuration, which is what
        // `externals: ['sqlite3', 'sequelize']` did in vue.config.js.
        plugins: [swcPlugin()],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/probe/main.ts')},
            },
        },
    },
    renderer: {
        // electron-vite defaults the renderer root to ./src/renderer and looks
        // for index.html there. The probe lives elsewhere, so point both the
        // root and the entry at it.
        root: resolve(__dirname, 'src/probe'),
        // `RendererBuildOptions` has no `externalizeDeps` in electron-vite 5:
        // the renderer is a web-target bundle and dependencies are bundled.
        // Node and native modules are reached at runtime through the
        // nodeIntegration `require` instead, which is what the probe checks.
        plugins: [vue(), swcPlugin()],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/probe/index.html')},
            },
        },
    },
});
