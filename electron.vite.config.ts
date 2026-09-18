import {resolve} from 'path';
import {execSync} from 'child_process';
import {defineConfig, swcPlugin} from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import renderer from 'vite-plugin-electron-renderer';

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

// Node builtins in the renderer.
//
// The renderer runs with nodeIntegration: true (see DECISIONS.md D4 and D7), and many files under
// src/ import Node builtins directly (`import {join} from 'path'`, `child_process`, `fs`, `os`,
// `url`). Vite has no equivalent of webpack's `target: 'electron-renderer'`, which is what made
// that work under the old vue-cli pipeline, and electron-vite's own documentation is explicit that
// it "does not support nodeIntegration" and that a polyfill plugin must be added for it.
//
// Two things Vite does on its own are both wrong here, and neither is fixable by configuration:
//   - by default it treats the renderer as a pure browser target and substitutes an empty stub for
//     every Node builtin, so the first named import off it is `undefined` (`path.join is not a
//     function`);
//   - marking the builtins `external` instead only moves the failure, because the renderer's output
//     is ES modules loaded through `<script type="module">` and Chromium's own ESM loader cannot
//     resolve a bare specifier like "child_process" at all, whatever Electron allows at runtime
//     ("Failed to resolve module specifier").
//
// `vite-plugin-electron-renderer` is the ecosystem's answer to exactly this, and is the renderer's
// counterpart to the externalizeDeps handling electron-vite already does for main/preload. It
// aliases every `(node:)?<builtin>` specifier to a small generated ES module that calls the real
// runtime `require()` and re-exports its members, so `import {join} from 'path'` becomes a genuine
// `require('path').join`. Because it is a plain `resolve.alias`, the same rewrite applies to
// `electron-vite dev` and `electron-vite build` alike.
//
// `resolve` names the npm packages that must stay on runtime `require()` instead of being bundled
// for the browser. This is the renderer's version of what electron-vite already does for the main
// process, whose bundle emits `require('sequelize-typescript')` and `require('sequelize')`
// verbatim. All three are production `dependencies`, so electron-builder ships them and the
// runtime `require()` resolves.
//
// Each entry fixes a failure that was observed, not a precaution:
//   - `sqlite3` is a native C++ addon that locates `node_sqlite3.node` relative to its own
//     directory. Bundled, the lookup resolves against the project root instead and throws
//     "Could not locate the bindings file".
//   - `sequelize` drags its whole CommonJS dependency graph into the single renderer chunk, and
//     Rollup hoists each of those modules' top-level declarations into one shared module scope.
//     `uuid` declares `var URL = '6ba7b811-...'` there, which then shadows the global `URL` for
//     the entire bundle, so Vite's own asset helper (`new URL(asset, import.meta.url)`) ran
//     against an undefined binding and threw "URL is not a constructor" before Vue ever mounted.
//     Keeping the package external keeps its scope out of the renderer chunk entirely.
//   - `sequelize-typescript` goes with them as the package that pulls both in.
const rendererCjsModules = {
    sqlite3: {type: 'cjs' as const},
    sequelize: {type: 'cjs' as const},
    'sequelize-typescript': {type: 'cjs' as const},
};

const alias = {
    // Force the real Node build of sequelize-typescript instead of the no-op
    // "browser" stub, which the default mainFields resolution picks up and
    // which silently turns the decorators into no-ops. Carried over from
    // vue.config.js.
    'sequelize-typescript': resolve(__dirname, 'node_modules/sequelize-typescript/dist/index.js'),
    '@': resolve(__dirname, 'src'),
};

// The renderer gets the same aliases minus the sequelize-typescript one: there the package is
// kept on runtime `require()` (see `rendererCjsModules`), and `require()` uses Node's own
// resolution, which ignores the `browser` field the alias existed to defeat. Leaving the alias in
// would win over the plugin's, since Vite takes the first matching alias entry, and put the
// package back into the bundle.
const rendererAlias = {
    '@': alias['@'],
};

// Build identity for develop builds.
//
// package.json's version is the same for every build cut from develop (only semantic-release, on
// main, ever bumps it), so on its own it can't tell two develop prereleases apart. build.yml names
// them `<version>-dev.<short sha>` (see its "Compute prerelease tag" step) and sets
// ARTIFACT_SUFFIX=-dev for those builds only: bake the same `-dev.<short sha>` into the main
// process, so the BO shows (and matches against the releases list) exactly that tag. Empty for
// release builds, for `electron-vite dev`, and when git isn't available - the plain package.json
// version is then all there is.
const buildVersionSuffix = (() => {
    if (process.env.ARTIFACT_SUFFIX !== '-dev') {
        return '';
    }
    try {
        const sha = execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
        return sha ? `-dev.${sha}` : '';
    } catch {
        return '';
    }
})();

export default defineConfig({
    main: {
        plugins: [swcPlugin(swcOptions)],
        define: {MAUI_BUILD_VERSION_SUFFIX: JSON.stringify(buildVersionSuffix)},
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
        plugins: [vue(), swcPlugin(swcOptions), renderer({resolve: rendererCjsModules})],
        resolve: {alias: rendererAlias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/index.html')},
            },
        },
    },
});
