# Vue 2 to Vue 3 migration: design

- **Date**: 2026-09-10, sequencing approved 2026-09-11, rebased onto the
  current `refacto-2026` on 2026-09-11
- **Branch**: `chore/migrate-vue2-to-vue3`, now based on `refacto-2026` at
  `d93fa46` (originally cut at `21a2b3d`; the 22 commits in between added the
  BO server, see 2.5)
- **Status**: **APPROVED. No code written yet, implementation plan pending**

This is the validated design for the migration. All six decisions below are
settled. The next artifact is an implementation plan derived from the
sequencing in section 5; code follows the plan, not this document.

---

## 1. Goal

Migrate the renderer from Vue 2.7.16 to Vue 3, on a maintained toolchain.

Vue 3 is confirmed as the current major: npm `vue@latest` = **3.5.42**,
`rc` = 3.6.0-rc.7. Vue 2 is frozen at 2.7.16 and has been EOL since
2023-12-31 (no further security patches).

## 2. Findings from codebase exploration

### 2.1 The Vue-level migration is small

- 5019 lines total, 12 SFC (8 components, 3 views, `App.vue`), already on
  **Vue 2.7.16** (so `defineComponent` and the Composition API are already
  available as a launch pad).
- `Config.vue` is now down to 35 lines: since the BO server landed (2.5), it is
  a static message pointing the user at `http://localhost:3131`. The heaviest
  view of the original design is no longer a concern.
- Grepped for Vue 3 breaking changes across `src/`: **zero** occurrences of
  `filters`, `$listeners`, `slot-scope`/`slot=`, functional components,
  `Vue.set`/`Vue.delete`, `Vue.prototype`, keyCode event modifiers,
  `$children`/`$parent`, `$scopedSlots`, renamed transition classes.
- The only `.sync` hit was a false positive: `sequelize.sync()` in
  `Database.class.ts:35`.
- `EventBus` (`src/EventBus.ts` = `new Vue()`) is used for **3 events only**
  (`game-quit`, `hiscores-loaded`) across 4 files. `new Vue()` as an event bus
  is removed in Vue 3 (`$on`/`$off` gone from the instance). Swap to `mitt`.
- `$refs` used in 3 places (behavior changes in Vue 3: no longer auto-registered
  as an array for `v-for` unless bound to a function ref); verified in step 4.

### 2.2 The real work is the toolchain, not Vue

Resolved versions from `package-lock.json`:

| Package | Installed | State |
|---|---|---|
| `@vue/cli-service` | 3.12.1 | webpack 4, maintenance mode |
| `vue-cli-plugin-electron-builder` | 1.4.6 | last publish 2022, abandoned |
| `electron-builder` | 21.2.0 | 2019 |
| `webpack` | 4.47.0 | EOL |
| `electron` | 44.3.0 | current, huge gap with the rest |
| `vue-class-component` | 6.x (latest 7.2.6) | **Vue 2 only**, peer `vue ^2.0.0`, dead since 2022 |
| `vue-property-decorator` | 7.x (latest 9.1.2) | **Vue 2 only**, dead since 2022 |
| `typescript` | 5.9.3 | current |
| `sequelize` / `sqlite3` | 5.22.5 / 5.1.7 | untouched by this migration |

`vue-cli-service@3` cannot compile a Vue 3 SFC (it needs `vue-loader` 16+).
Touching Vue 3 therefore forces touching the build. That is the actual project.

### 2.3 Project-specific hard point

`src/store.ts` instantiates `Database` (sequelize-typescript + native
`sqlite3`) and uses `@electron/remote` **inside the renderer**
(`nodeIntegration: true`, `contextIsolation: false`). Today this works via a
webpack alias plus `externals` in `vue.config.js`:

```js
config.resolve.alias.set('sequelize-typescript',
    path.join(__dirname, 'node_modules/sequelize-typescript/dist/index.js'))
// and: externals: ['sqlite3', 'sequelize']
```

Any bundler change must reproduce this. **This is the only genuine unknown in
the whole migration.**

### 2.4 Vuex is ceremony here

All 20 `$store` accesses are imperative reads inside methods (`created`,
`mounted`, handlers). Zero template access, zero `computed`, zero `watch`.
No reactivity is used at all. `CLAUDE.md` already documents the store as a
service container rather than state.

### 2.5 The main process is in scope too (BO server)

Added by the rebase onto `refacto-2026` at `d93fa46` on 2026-09-11, after the
first draft of this design: `src/boServer.ts` (1521 lines), a local Express
back office started by `background.ts` for the app's lifetime, plus
`src/class/ScreenScraperClient.class.ts` (152 lines) and
`src/boServerPort.ts` (one exported constant). Total went from 3347 to 5019
lines.

None of it is Vue code, so Vue 3 does not touch it. But all of it is bundled,
so the toolchain change does:

- `boServer.ts` imports `sequelize-typescript` and the models directly. The
  `sqlite3` / `sequelize` externals and the `sequelize-typescript` resolution
  override (2.3) must therefore be reproduced in the **main** bundle as well as
  the renderer one. electron-vite configures the two separately.
- `boServerPort.ts` is imported from both sides: `background.ts` and
  `boServer.ts` (main) and `Config.vue` (renderer). It must stay a plain
  dependency-free module so both bundles can take it.
- `boServer.ts` documents a landmine in its own header comment: importing
  `Database.class.ts` from the main process would drag in
  `GameService` to `MameService` to `Helpers.class.ts`, which imports
  `@electron/remote` **at module scope** and breaks a main-process file. That is
  why the file duplicates the Sequelize import shape instead of reusing
  `Database.class.ts`. Under electron-vite this coupling turns into a build-time
  failure instead of a runtime one, which is an improvement, but step 2 must not
  be surprised by it.

### 2.6 `__static` does not exist under electron-vite

`__static` is used in `GameService.class.ts` (renderer, to read
`genre_206.ini` / `nplayers_206.ini`) and in `boServer.ts` (main). It is
declared ambient in the sources (`declare const __static: string`) and listed as
a readonly global in `eslint.config.js`, but **defined nowhere in the repo**:
`vue-cli-plugin-electron-builder` injects it through webpack's DefinePlugin
(`lib/webpackConfig.js`, pointing at `./public` in dev and at the real dirname
in production).

electron-vite provides no equivalent. Dropping vue-cli therefore deletes this
global out from under both processes, and the symptom is exactly the silent
kind D5 is meant to catch: an unresolved static path yields an empty ROM list,
not an error. Replacing `__static` with an explicit resolution valid in dev and
in the packaged app is a **required deliverable of step 2**, not a detail.

## 3. Decisions taken (approved)

| # | Topic | Decision | Rationale |
|---|---|---|---|
| D1 | Toolchain | **Vite + electron-vite**, drop vue-cli | Lands on maintained tooling, removes 3 dead dependencies at once |
| D2 | SFC style | **`<script setup>` + composables** | Idiomatic Vue 3, no decorator library dependency, no deferred debt |
| D3 | Store | **Delete Vuex**, plain TS module `src/services.ts` | No reactivity is used; one dependency less. Pinia can be added later if real shared reactive state appears |
| D4 | Scope | **Do NOT touch the Electron process model** | Keep `nodeIntegration: true`, `contextIsolation: false`, `@electron/remote`. One change at a time: if the app breaks, the cause is Vue or Vite, never the process model. Hardening to preload/IPC is a separate follow-up |
| D5 | Verification | **Characterization tests first** (Vitest) | Written against the current Vue 2.7 code, must stay green after migration. Not 80% coverage: a safety net exactly where regressions would be silent |
| D6 | Sequencing | **Plumbing first, then port in layers** (option C, see section 5) | The unknown is the native/Node integration (2.3), not Vue 3. Prove it on day one with a trivial renderer, then every later step is pure Vue work on a known-good build |

### D2 detail: `ControllableVue`

`src/ControllableVue.ts` is an abstract class the views extend, wiring combined
keyboard + gamepad handlers. Vue 3 has no idiomatic class inheritance for
components. It becomes a composable:

```ts
const { onKeydown, onKeyup } = useControllable()
```

Note: the current `beforeDestroy` in `ControllableVue` calls
`removeEventListener` with **freshly created closures**, so it removes nothing:
the listeners leak. The composable rewrite must keep handler references and
actually remove them in `onUnmounted`. (Pre-existing bug, fix it in passing.)

### D5 detail: what to characterize

The risky surface is parsing, not templates (templates break loudly, parsing
breaks silently, since a broken `__static` or path resolution yields an empty ROM
list, not an error):

- `MameService`: `mame -showconfig` parsing, `ui.ini` parsing, `favorites.ini`
  reading (missing file must stay "empty list", not an error)
- `GameService`: `genre_206.ini` / `nplayers_206.ini` parsing from
  `public/data` via the `__static` global
- `Helpers`, `Config` (load/save of `mame-awesome-ui-config.json`)

`ScreenScraperClient.class.ts` (2.5) calls `https://api.screenscraper.fr` through
the global `fetch`. It is left **out of step 1**: characterizing it means
mocking the network, which is a different kind of test, and the bundler change
puts nothing about it at risk. Revisit it as its own task once the migration is
done.

`boServer.ts` is 1521 lines and is not characterized either. It is exercised by
the manual smoke path at step 4 instead. Testing it properly means driving an
Express app, which is out of scope for a migration safety net.

## 4. Version matrix (constrained by electron-vite)

`electron-vite@5` peers `vite ^5 || ^6 || ^7`, **not** Vite 8. So Vite 7 is
the pin, and everything else aligns on it.

| Package | Target | Constraint |
|---|---|---|
| `vue` | ^3.5.42 | |
| `vite` | ^7 | ceiling set by electron-vite 5 |
| `electron-vite` | ^5.0.0 | peer vite ^5\|\|^6\|\|^7; engines node `^20.19.0 \|\| >=22.12.0` |
| `@vitejs/plugin-vue` | ^6.0.8 | peer vue ^3.2.25, vite ^5..^8 |
| `vitest` | ^5.0.0 | peer vite ^6.4 \|\| ^7 \|\| ^8 |
| `vue-router` | ^5.3.1 | peer vue ^3.5.34 |
| `mitt` | ^3.0.1 | EventBus replacement |
| `electron-builder` | ^26.15.3 | up from 21.2.0 |

Local Node is v22.15.1, npm 10.9.2, which passes the electron-vite `engines` gate.

**Removed by the migration**: `@vue/cli-service`, `@vue/cli-plugin-typescript`,
`vue-cli-plugin-electron-builder`, `vue-template-compiler`,
`vue-class-component`, `vue-property-decorator`, `vuex`, `vue.config.js`,
`src/shims-vue.d.ts`, `src/shims-tsx.d.ts`, `src/EventBus.ts`, `src/store.ts`.

`eslint-plugin-vue` config must move from `vue2-essential` to the Vue 3
preset in `eslint.config.js`.

## 5. Sequencing (approved: plumbing first, then port in layers)

The unknown is not Vue 3, it is native `sqlite3` + `sequelize-typescript` +
`@electron/remote` in a Vite-bundled renderer (2.3). So that is attacked first,
alone, behind a trivial Vue 3 renderer. Every step ends on a runnable state,
so a failure is always attributable to the step that introduced it.

**Step 1: safety net.**
Add Vitest, write the characterization tests listed in D5 against the current
Vue 2.7 code, still on vue-cli.
*Exit criteria*: tests green on the unmodified codebase; they encode current
behavior, including "missing `favorites.ini` yields an empty list, not an
error".

**Step 2: plumbing.**
Stand up electron-vite + Vue 3 with a minimal renderer (no app code ported).
Reproduce what `vue.config.js` does today, **in both bundles** (2.5): the
`sequelize-typescript` resolution override and the `sqlite3` / `sequelize`
externals. Replace `__static` with an explicit path resolution valid in dev and
in the packaged app (2.6). Keep `nodeIntegration: true` and
`contextIsolation: false` per D4.
*Exit criteria*: `just serve` starts the app; the renderer opens the SQLite
database and runs migrations; the BO server answers on
`http://localhost:3131`; `@electron/remote` resolves in the renderer and is
absent from the main bundle; the two static ini files load through the
`__static` replacement, in dev and from the packaged app; `just build` produces
a working package. Verified on both macOS and Linux (section 7).

This is the only step that can fail for a reason outside our control. It is
deliberately first: if electron-vite cannot externalize the native modules
cleanly, we find out in a day rather than after porting 12 components.

**Step 3: Vue-free layers.**
Port `class/`, `model/`, `api/`, and introduce `src/services.ts` (D3). No SFC
touched yet. `boServer.ts`, `boServerPort.ts` and `ScreenScraperClient` come
along here as main-process code: no rewrite, only whatever the bundler change
forces, and the `Helpers` / `@electron/remote` module-scope constraint (2.5)
must survive intact.
*Exit criteria*: step 1 tests still green, now running against the ported code.

**Step 4: components, bottom-up.**
Port the SFC to `<script setup>` (D2): `components/` first, then `views/`, then
`App.vue`. Introduce `useControllable()` and replace the `EventBus` with `mitt`
in the same pass, since the two are entangled in `Champions.vue`,
`Hiscores.vue`, `Init.vue` and `Home.vue`. Move `vue-router` to v5 and
`eslint-plugin-vue` to its Vue 3 preset.
*Exit criteria*: the manual smoke path runs end to end: first-run config,
non-empty ROM list, categories, launching a game, hiscores, gamepad navigation.

**Step 5: remove the legacy.**
Delete everything listed at the end of section 4 and drop the dead
dependencies from `package.json`.
*Exit criteria*: no remaining import of `vuex`, `vue-property-decorator`,
`vue-class-component` or `@/EventBus`; `npm run lint` clean; packaged build
still works on both platforms.

### Rejected alternatives

**A, intermediate Vite step** (migrate to Vite while staying on Vue 2.7 via
`@vitejs/plugin-vue2@2.3.4`). Gives two bisection points, but costs a throwaway
dependency and the Vite config written twice, and de-risks the real danger no
better than step 2 above.

**B, big bang.** Defensible at 3347 lines, but with no tests a failure to boot
could come from Vite, electron-vite, the native externals, the Vue plugin, or
any of the 11 SFC at once.

## 6. Next actions

1. Produce the implementation plan from section 5 (`writing-plans` skill)
2. Then write code, step 1 first

## 7. Constraints to keep in mind

- The app must run on **macOS 15.1+ and Linux (Ubuntu 24.04+, Debian 13+)**.
  Path handling, process invocation and packaging must be verified on both.
- Never run two `just serve` / `just build` at once: both trigger
  `npm install` and concurrent installs corrupt the native `sqlite3` rebuild.
- There is no test suite in the repo today; D5 creates the first one.
