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

**`src/shims-vue.d.ts` is not deleted by Task 13, correcting the design doc's
section 4.** The design doc listed it as part of the legacy removed by this
migration. Spec step 2's plumbing probe had already found, before this task
started, that `tsc --noEmit` needs this file to resolve any
`import Foo from './Foo.vue'` at all (there is no other type declaration for
the `.vue` extension), and had rewritten its content to the Vue 3
`DefineComponent<{}, {}, any>` shape instead of leaving the Vue 2 one.
Deleting it would break every `.vue` import in `tsc --noEmit`. This was
already accounted for by the time Task 13's brief was written; recorded here
as the formal correction to the design doc's removal list.

**The `@electron/remote` Vitest alias/stub (`tests/stubs/electron-remote.ts`)
was dead by the time Task 13 ran.** Its comment said `Helpers.class.ts`
imports `@electron/remote` at module scope, which stopped being true earlier
in this plan (`grep -rn "@electron/remote" src/class` finds nothing).
Temporarily removing the alias from `vitest.config.ts` and running `npm test`
still passed all 51 tests, confirming nothing in the current test import
graph needs it (the remaining `@electron/remote` imports are in
`background.ts`, `boServer.ts`, `App.vue`, and the views, none of which any
test imports). Both the stub file and the alias were deleted.

**The packaged production build (`electron-vite build && electron-builder`)
has never actually succeeded for the real app, on any commit in this
migration, and this was not caught until Task 13's final verification.**
Tasks 1-12 (in particular Task 12, "wire the real app through electron-vite")
only ever ran `tsc`/`lint`/`test` as verification gates; the packaged-build
path was exercised only against the throwaway `src/probe/*` app (step 2), not
against the real renderer. Task 13's own `npm install` (removing the vue-cli
dependency chain) surfaced one self-inflicted regression: `postcss.config.js`
(a pre-existing, untouched file that predates this migration and still
applies to every `<style>` block Vite processes in every `.vue` file) depends
on `autoprefixer`, which was only ever present transitively through
`@vue/cli-service`. Once that chain was removed, `autoprefixer` disappeared
from `node_modules` and the renderer build failed at the CSS-transform stage.
Fixed by adding `autoprefixer` as a direct devDependency (it was not carried
over anywhere else). With that fixed, the renderer build progresses further
and fails on a second, unrelated, pre-existing problem, confirmed present
identically on the pre-Task-13 commit (`16fa890`) by temporarily reverting
and re-testing: `src/class/Config.class.ts`'s `fs`/`path`/`os` imports get
externalized to a browser stub (`__vite-browser-external`) by
`electron.vite.config.ts`'s `renderer` build, which has no mechanism (unlike
`main`) to keep Node builtins real for a `nodeIntegration: true` renderer.
This is not something Task 13's scope (deletions and dependency cleanup)
covers or should attempt to fix unilaterally: it needs a deliberate decision
about how the renderer's Vite config should treat Node builtins (e.g.
`build.rollupOptions.external`, a polyfill/externalization plugin, or
reconsidering the `nodeIntegration: true` boundary).

**First attempted fix (Task 13, fix 1): `build.rollupOptions.external`. It did
not work, and the verification that passed it did not look at the renderer.**
The approach was to expand `node:module`'s `builtinModules` into bare (`fs`)
and `node:`-prefixed (`node:fs`) forms and pass them as `external`, so Rollup
would leave every `import ... from 'fs'` statement untouched instead of
substituting `__vite-browser-external`. Rollup does leave them untouched, but
that is not enough: the renderer's output is ES modules loaded through
`<script type="module">`, and Chromium's own ESM loader cannot resolve a bare
specifier like `"child_process"` at all, whatever `nodeIntegration` permits
at runtime. `external` only exchanged one failure for another, from an empty
browser stub to `Failed to resolve module specifier "child_process"`.

It was recorded as verified because of how it was checked: `electron-vite
build && electron-builder` returning 0, and the packaged binary launching
without the process dying. Neither observes the renderer. The renderer's own
JS never ran, the window stayed blank, and nothing in that evidence could
have shown it. The claim in the `electron.vite.config.ts` comment that the
same imports were "confirmed working in dev mode" was wrong for the same
reason: the dev smoke test only checked the main process and the BO server.
Re-running dev with the renderer console forwarded shows dev was broken
identically the whole time (`Module "path" has been externalized for browser
compatibility` followed by `Uncaught TypeError: path.join is not a
function`), with `#app` empty.

This is precisely the silent failure D5 was written to catch, and it slipped
through because no verification anywhere in this migration read the
renderer's console until the final whole-branch review did. An exit code and
a live process are not evidence that a GUI application works.

**D7: Node builtins in the renderer are resolved by
`vite-plugin-electron-renderer`, not by `external`.**
Vite has no equivalent of the webpack `target: 'electron-renderer'` that made
this work under the old vue-cli pipeline, and electron-vite's own
documentation states plainly that it "does not support `nodeIntegration`" and
that a polyfill plugin must be supplied for it. `vite-plugin-electron-renderer`
(from the same `electron-vite` GitHub organisation) is the ecosystem's answer
to exactly this case, and is the renderer's counterpart to the dependency
externalization electron-vite already performs for `main`. It aliases every
`(node:)?<builtin>` specifier to a small generated ES module that calls the
real runtime `require()` and re-exports its members, so `import {join} from
'path'` becomes a genuine `require('path').join`. Because the mechanism is a
plain `resolve.alias`, `electron-vite dev` and `electron-vite build` get the
identical rewrite, which is what makes the two modes comparable for the first
time in this migration.

Version note, and a gap in this migration's plan: the version matrix drawn up
at design time did not anticipate needing a renderer-side plugin at all, so it
never checked one. `vite-plugin-electron-renderer@1.x` requires Vite 8, while
electron-vite 5 peers on Vite 5/6/7 and this project is on Vite 7.3.6. The
pinned version is therefore `0.14.7`, the last release of the line supporting
Vite < 8. It declares no peer dependencies and uses only long-stable Vite
config surface (`resolve.alias`, `optimizeDeps.exclude`, `base`,
`build.commonjsOptions.ignore`), which is why it works against Vite 7
unmodified. Whenever electron-vite is upgraded to a Vite 8 line, this pin
should move to 1.x in the same change.

Two npm packages are additionally kept on runtime `require()` through the
plugin's `resolve` option, each because a concrete failure was observed, not
as a precaution. Both are production `dependencies`, so electron-builder ships
them and the runtime `require()` resolves; this mirrors the main-process
bundle, which already emits `require('sequelize-typescript')` verbatim.
- `sqlite3` is a native C++ addon that locates `node_sqlite3.node` relative to
  its own directory. Bundled, the lookup resolved against the project root:
  `Could not locate the bindings file`.
- `sequelize` pulled its entire CommonJS dependency graph into the single
  renderer chunk, and Rollup hoists those modules' top-level declarations into
  one shared scope. `uuid` declares `var URL = '6ba7b811-...'` there, which
  then shadowed the global `URL` for the whole bundle, so Vite's own asset
  helper (`new URL(asset, import.meta.url)`) ran against an undefined binding
  and threw `URL is not a constructor` before Vue ever mounted. Externalizing
  the package keeps its scope out of the chunk. As a side effect the renderer
  bundle went from 4.05 MB to 782 kB.
`sequelize-typescript` is externalized alongside them, which also lets the
renderer drop the `resolve.alias` that forced its real Node build: `require()`
uses Node's resolution and ignores the `browser` field the alias existed to
defeat. The alias is kept for `main`, unchanged.

**Verified, this time by reading the renderer.** `win.webContents.on(
'console-message', ...)` was temporarily forwarded to stdout (reverted before
commit) for both `electron-vite dev` and the packaged
`dist_electron/linux-unpacked/mame-awesome-ui --no-sandbox`. In both, and
identically: no uncaught errors, the router reaches `#/config`, the real
first-run screen renders its actual content, `require('sqlite3')` returns the
native addon and completes a real in-memory create/insert/select round-trip,
and `require('sequelize-typescript')` returns the real Node build
(`Sequelize.prototype.addModels` present, not the no-op browser stub). D4
stands as-is: `src/background.ts`'s `webPreferences` were not touched.

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

## ONLINE mode (MAUI-API)

Integration handoff: `maui-api` `docs/MAUI-INTEGRATION.md`. Open questions
from its section 9 are decided here.

**CSRF, 2026-09-25: `Origin` check on the Online routes only.** The BO has no
CSRF protection and is reachable from the whole LAN, and the Online routes
decide where the ONLINE token is sent (a forged configuration pointing to
another server would leak it with the next heartbeat). `POST /maui/online/*`
therefore require a same-origin request (`src/class/SameOrigin.ts`: `Origin`
host equal to `Host`, `Referer` as fallback, neither header refused), on top of
the Advanced configuration switch. The rest of the BO (export, import, reset)
keeps the same gap: a CSRF token for the whole BO is a separate piece of work,
not tied to ONLINE. The URL also only changes by pasting a complete `MAUI1.`
string, never through a field of its own.

Not covered: DNS rebinding. An attacker's domain first resolves to their
server, then to the cabinet's IP, so their page reaches the BO while looking
same-origin to the browser (`Origin` and `Host` both carry the attacker's
domain). The real BO session cookie is not sent, but the default
`puckman`/`puckman` login lets the page sign in by itself. For ONLINE this
allows sabotage, not token theft: the token is never shown again, and pasting
a new string replaces the URL and the token together, so the saved token
cannot be redirected to another server. The rest of the BO is more exposed
(export of the config file with the ScreenScraper passwords, reset). The fix,
a `Host` header allowlist (`localhost`, IP literals, the machine's own name)
applied to the whole BO, is a separate piece of work, like a BO-wide CSRF
token. Changing the default password reduces the risk meanwhile.

**Corrupt `online.json`, 2026-09-25: reset from the BO.** A kiosk cabinet
often has no reachable shell, so "fix the file by hand" is not an option. The
Online subtab offers "Reset ONLINE settings" only when the file is unreadable:
the file is renamed to `online.json.corrupt-<timestamp>` (not deleted), and
`localUuid` is salvaged from the raw text when it is still there, which keeps
the machine binding valid. Credentials from a damaged file are never reused:
the configuration string must be pasted again.

**Unknown rejection code (open, slice 4).** What `OnlineSession` does with a
`rejected` result whose `code` MAUI does not know: stop, or keep retrying.
`MauiApiClient` passes the code through either way.
