# Decisions: Vue 2 to Vue 3 migration

This file is the durable record of the choices made during the migration, and
why. It is meant to be read by whoever picks up the work next, including a
future version of whoever wrote it. The full investigation trail (commands
run, exact command output, mutation-check evidence) lives in the commit
messages this file points to; this document is the summary a reader needs
before touching the code, not a replacement for reading a commit.

Source documents:
- Design: `docs/superpowers/specs/2026-09-10-vue3-migration-design.md`
- Implementation plan (spec steps 1-2): `docs/superpowers/plans/2026-09-11-vue3-migration-safety-net-and-plumbing.md`

See also `docs/PROGRESSION.md` for what is done and what is next.

## Toolchain

**D1: Vite + electron-vite, drop vue-cli.**
`@vue/cli-service` (webpack 4) and `vue-cli-plugin-electron-builder` are both
in maintenance mode or abandoned. Landing on maintained tooling removes three
dead dependencies at once (`vue-cli-plugin-electron-builder`,
`vue-template-compiler`, and eventually `@vue/cli-service` itself at spec
step 5).

**D2: `<script setup>` + composables, no decorator library, for ported
components.**
Idiomatic Vue 3. `vue-class-component`/`vue-property-decorator` are Vue-2-only
and dead since 2022. `ControllableVue.ts`'s inheritance pattern becomes a
`useControllable()` composable when components are ported (spec steps 3-4,
not done yet).

**D3: Delete Vuex for a plain `src/services.ts` module.**
Every `$store` access in the app is an imperative read inside a method, zero
template bindings, zero `computed`, zero `watch`. Vuex here is ceremony around
a service container, which `CLAUDE.md` already documented. Not done yet (spec
step 3); `store.ts` is still Vuex today.

**D4: Do not touch the Electron process model.**
`nodeIntegration: true`, `contextIsolation: false`, `@electron/remote` all
stay. One change at a time: if something breaks, it's Vue or Vite, never the
process model. Hardening to a preload/IPC boundary is a separate, future
decision, not part of this migration.

**D5: Characterization tests before touching anything, not full coverage.**
41 tests were written against the pre-migration Vue 2.7 code (Phase A, see
`docs/PROGRESSION.md`), targeting specifically the code where a regression
would be silent: config load/save, mame ini parsing, path resolution, and (at
the time) the genre/nplayers ini lookup. Not an 80% coverage target: a
tripwire placed exactly where the risk is.

**D6: Sequencing: plumbing first, then port in layers (not a Vue-2.7-on-Vite
intermediate step).**
Two sequencing options were considered and rejected in favor of this one:

- *Option A, an intermediate Vite step on Vue 2.7* would have kept the app
  runnable throughout, at the cost of writing the Vite config twice (once for
  Vue 2, once for Vue 3) and not de-risking the actual unknown any faster.
- *Option B, a big-bang migration* is defensible given the codebase's size, but
  with no test suite existing before this work started, a boot failure could
  come from Vite, electron-vite, the native module externals, the Vue plugin,
  or any ported component, with no way to isolate which.

The chosen sequencing accepted a real cost, stated plainly in the plan before
work started: installing Vue 3 (needed for the plumbing proof) takes the
vue-cli pipeline down immediately, and `just serve` does not work again until
spec steps 3-4 (porting) are done. The branch is not shippable in this window.
That trade was made deliberately to prove the one thing that could not be
partially proven any other way: whether native `sqlite3`, `sequelize-typescript`,
and decorator metadata survive Rollup bundling in both the renderer and the
main process, before spending effort porting 12 components against a build
that might not have worked.

## Findings during execution (not knowable at design time)

These surfaced only once the plumbing was actually built and run: they are
recorded here because they change what the next phase needs to know, and
because several of them fixed real, permanent code (not just probe scaffolding).

**esbuild does not implement `emitDecoratorMetadata`.**
`sequelize-typescript`'s `@Column` decorators need it; `tsconfig.json` sets it;
Vite transforms TypeScript with esbuild by default, which silently drops it.
The failure mode is a green build with an inert data layer. Fixed by using
electron-vite's `swcPlugin()` (swc does implement it) on both bundles.
See commit `2c1e9ea`.

**`swcPlugin` hardcodes `jsc.target: 'es2022'`, which emits native class
fields that shadow Sequelize's prototype accessors.**
`useDefineForClassFields` is implicitly `true` at that target;
`tsconfig.json`'s `es6` target has it default to `false`. A class field
declared without an initializer therefore got emitted as a real own property
(`this.name = undefined`) that masks the accessor Sequelize v5 installs on the
prototype: the build stays green, database opens, every column reads back `undefined`.
Fixed with `swcPlugin({transformOptions: {useDefineForClassFields: false}})`.
Standing rule this created: `tsc --noEmit` cannot ever catch a regression of
this class, because it validates against `es6` semantics regardless of what
swc actually emits. Any new decorator, class field, or static block in
swc-transformed code must be verified by inspecting the built output, not by
a green build or a green typecheck. See commit `1bf8eb6`.

**`@vitejs/plugin-vue` inlines `<script setup lang="ts">` directly into the
`.vue` module id in dev-server mode, bypassing swc's metadata-emitting
transform entirely on that one path.**
`canInlineMain` returns `true` only when `options.devServer` is set (an
internal, non-configurable plugin option), which only happens for the
dev-server. In that branch Vue's own Babel-based compiler handles the
decorators, without emitting `design:type` metadata. The production build
path is unaffected (a different, `.ts`-suffixed sub-request is used instead).
This does not threaten the app: no real model is ever declared inline inside
a `<script setup>` block, and D2 already rules out decorators for ported
components. Documented as a standing comment in `electron.vite.config.ts` so
the reasoning survives after the throwaway probe is deleted. See commit
`f64d618`.

**A pre-existing circular import between four Sequelize models
(`Game.model.ts` ↔ `Hiscore.model.ts`, `Category.model.ts` ↔ `Game.model.ts`,
`Hiscore.model.ts` ↔ `User.model.ts`) crashes under Rollup bundling.**
Confirmed with a minimal reproduction in plain native Node ESM, no bundler
involved: this is ECMAScript module specification behavior (a circular
module graph's temporal dead zone), not a Rollup quirk, and no bundler
configuration can change it: the two files' mutual import alone forces one
side's decorators to run while the other's class is still uninitialized.
Fixed by retyping the six affected association properties (e.g.
`public game!: Game` to `public game!: InstanceType<typeof Game>`), the
identical type, computed a different way, that stops looking like "a simple
class reference" to the tooling that decides whether to emit a runtime value
for `design:type`. Verified as behaviorally inert first: `sequelize-typescript`
never reads `design:type` for `@BelongsTo`/`@HasMany`/`@ForeignKey`, only for
a bare `@Column` with no explicit type. See commit `a3edcda`.

**`__static`'s replacement scope shrank significantly mid-migration.**
The design doc's spec 2.6 described `__static` as used by both
`GameService.class.ts` (renderer, reading `genre_206.ini`/`nplayers_206.ini`
from `public/data/`) and `boServer.ts` (main). Partway through execution, the
`refacto-2026` branch (independent, ongoing app work) deleted those two ini
files entirely and moved category/player-count sourcing to
`MameService.genreIniPath`/`nplayersIniPath` (optional paths resolved from
`ui.ini`, populated by a starting-pack import). After rebasing onto that
branch, `__static`'s only remaining readers were three static assets in
`boServer.ts` (`input-probe.lua`, `background.jpg`, `mame-logo.svg`).
`src/staticPath.ts`'s replacement was implemented against this narrower,
current scope, not the design doc's original description. See commit
`f135485`.

**`electron-builder`'s Linux packaging (AppImage/snap) does not embed a
`chrome-sandbox` setuid helper in the unpacked staging tree.**
Confirmed: the electron devDependency install has one
(`node_modules/electron/dist/chrome-sandbox`, root:root/4755), and the
electron zip electron-builder downloads to build the package contains one too
but `dist_electron/linux-unpacked/` ends up with none at all. On a kernel
that restricts unprivileged user namespaces (this machine, and this project's
own stated floor of Ubuntu 24.04+/Debian 13+), the packaged app cannot start
without `--no-sandbox`. **Not fixed.** This is a real, end-user-facing gap on
a shipped Linux package, not a migration-plumbing concern, and deserves its
own deliberate decision before release. See commit `f467853`.

**macOS 15.1+ was never verified.**
Every check in this migration (Tasks 1-10) ran on Linux only, because that is
the only platform available in this environment. This is named here, and in
the relevant commits, as an explicit open gap, not silently treated as done.

## Rebasing decision (mid-migration)

Partway through Phase B, a colleague's ongoing work on `refacto-2026` (the
branch this migration is based on) had diverged by 14 commits, several of
which touched files this migration depends on directly (`GameService.class.ts`,
`Config.class.ts`, `Helpers.class.ts`, `MameService.class.ts`, `boServer.ts`,
`ControllableVue.ts`). Notably, upstream commit `842ce72`
("fix(gamepad): stop leaking listeners and fix stuck axis input") appears to
already fix the `ControllableVue.ts` `beforeDestroy` listener leak this
migration's own plan had separately flagged as a bug to fix in passing during
the eventual composable port (D2, spec step 4). This was not independently
re-verified before this file was written, and whoever does that port should
check `842ce72`'s content before re-fixing it. The choice was to rebase
immediately rather than defer
it to the end of the migration, on the reasoning that the drift concentrated
on exactly the files this plan is built around, and every extra task built on
top before rebasing would need redoing afterward anyway. The cost was real and
was paid immediately: Phase A's Config/Helpers/GameService characterization
tests were rewritten against the moved implementations (new `Config`
constructor shape, renamed `Helpers.getMameHomePath` directory, entirely
reworked genre/nplayers sourcing), and one already-shipped upstream bug fix
(the `favorites.ini` parsing regex) was reconciled with this migration's own
independent fix of the identical bug. See commit `7134f90` for the full
repair, and the "findings during execution" `__static` entry above for the
scope change it caused.
