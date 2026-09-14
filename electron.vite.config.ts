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

// swcPlugin hardcodes `jsc.target: 'es2022'`, where `useDefineForClassFields`
// is implicitly true, while tsconfig.json is `target: "es6"` with the option
// unset, so the current webpack/ts-loader build defaults it to false. That
// difference is not cosmetic. With define semantics, a field declared without an
// initializer emits a native class field, which creates an own `undefined`
// property on every instance. Sequelize v5 installs its attribute accessors on
// the prototype (sequelize/lib/model.js, Object.defineProperty(this.prototype,
// ...)), so an own property shadows them and every column read returns
// undefined while the build stays green and the database opens. The same
// shadowing would hit `@Prop()` and `@Inject()` from vue-property-decorator
// once the SFC are ported. `transformOptions` is spread into swc's
// `jsc.transform`, so this puts the field semantics back where the current
// build has them.
const swcOptions = {
    transformOptions: {
        useDefineForClassFields: false,
    },
};

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
        plugins: [swcPlugin(swcOptions)],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/background.ts')},
            },
        },
    },
    renderer: {
        root: resolve(__dirname, 'src'),
        publicDir: resolve(__dirname, 'public'),
        plugins: [vue(), swcPlugin(swcOptions)],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/index.html')},
            },
        },
    },
});
