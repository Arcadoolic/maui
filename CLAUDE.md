# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron + Vue 3 (TypeScript) frontend ("arcade cabinet" front-end) for the MAME emulator. It shells out to a locally installed `mame` binary to list/launch ROMs, mirrors game/user/hiscore data into a local SQLite database via Sequelize, and drives everything with a gamepad-friendly UI.

## Platform support

The project must run on:
- **macOS** 15.1 and later
- **Linux**: Ubuntu 24.04 and later, Debian 13 and later (Debian 13 "Trixie"
  arm64 is the current target for Raspberry Pi 4 Model B support, tracked on
  `perf/raspberry-pi-lag` — see `docs/RASPBERRY-PI-LAG.md`).
  `electron-builder.yml` has no arm64 Linux target declared yet, and
  `npm run rebuild` (sqlite3 native rebuild) is unverified on ARM toolchains.
- **Windows** 10 and later (x64). CI packages a portable `.exe` via a
  `windows-latest` job in both `.github/workflows/build.yml` (manual,
  `workflow_dispatch`) and `.github/workflows/release.yml` (attached to
  every GitHub Release alongside the Linux/macOS artifacts); beyond those
  jobs passing, this platform is unverified by a real Windows dev environment —
  no one has run `just serve`/`just build` there. The sqlite3 native
  rebuild needs the Visual Studio Build Tools (or the deprecated
  `windows-build-tools` npm package — see `docs/COMPILATION.md`); `just
  install`'s Python auto-resolution (`scripts/resolve-python.sh`) also
  applies here, but only `python`/`py`-launcher naming has been considered,
  not exercised.

Keep path handling, shell/process invocation, and packaging (Electron build targets, native module rebuilds) working on all three. When changing anything platform-sensitive (paths, `execFile`/shell calls, `mame -showconfig`/`ui.ini` parsing, `justfile` recipes, native module builds), verify it holds on macOS, Linux, and Windows — don't assume macOS-only behavior.

Requires **Node 24 LTS** or later (pinned via `engines.node` in `package.json` and `.nvmrc`) — `npm install` warns on older runtimes.

### Linux dev gotchas

- **Native module build**: `sqlite3`'s pinned `node-gyp` needs a Python interpreter with `distutils` (removed from stdlib in 3.12+, Ubuntu 24.04's default `python3`). `just install` auto-resolves one and passes it via `PYTHON`; if it fails, install Python 3.11 or `setuptools` for your 3.12+ interpreter.
- **Electron sandbox**: Ubuntu 24.04's `kernel.apparmor_restrict_unprivileged_userns=1` forces Electron onto the setuid `chrome-sandbox` helper. A fresh `npm install` leaves it mode 755, so Electron aborts before `background.ts` runs and no window appears (failure is swallowed by the dev-server plugin). `just serve` checks this and prints the fix; reapply after every Electron reinstall/version bump:
  ```bash
  sudo chown root:root node_modules/electron/dist/chrome-sandbox
  sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
  ```

## Commands

Prefer the `justfile` recipes; they wrap the npm scripts:

```bash
just serve    # npm install, then electron:serve (dev, hot-reload)
just build    # npm install, then electron:build (packaged app)
just lint     # npm run lint:fix (eslint --fix)
just install  # npm install only
```

Only ever run **one** `serve`/`build` at a time — both trigger `npm install`, and concurrent installs race on rebuilding the native `sqlite3` module (corrupts the `node-gyp`/`make` build directory).

`just serve`/`just build` wrap `electron:serve`/`electron:build`, which run `electron-vite dev --watch` (main-process changes such as `boServer.ts` restart Electron automatically) and `electron-vite build && electron-builder` respectively (not `vue-cli-service`, removed during the Vue 3 migration).

Other useful commands (no `just` recipe):
```bash
npm test                                              # run the Vitest characterization tests
npx sequelize-cli migration:generate --name=<name>   # new file in migrations/
electron-rebuild -f -w sqlite3                        # manually rebuild sqlite3 native binding
```

## Architecture

**Process split, no preload/contextBridge.** `src/background.ts` is the Electron main process; it creates a single frameless `BrowserWindow` with `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, and calls `@electron/remote/main`'s `enable()` on it. Every renderer view therefore uses `@electron/remote` and Node builtins (`fs`, `child_process`, `path`, `os`) directly — there is no IPC/preload boundary to maintain. `src/api/*` (Express-based REST controllers) is dead code: not imported anywhere outside itself, no wiring in `background.ts` (removed, not commented out). Confirm before resurrecting.

**Routing is a 3-screen flow** (`src/router.ts`, `vue-router` 5): `/init` (`Init.vue`, splash) → `/config` (`Config.vue`, first-run setup) → `/home` (`Home.vue`, main browser UI). `Init.vue` loads `Config`, and if no valid config file exists redirects to `/config`; otherwise it calls `initServices()` from `src/services.ts` and pushes to `/home`.

**`src/services.ts` as a service container, not a state store.** A plain TS module (replaced Vuex, which held zero reactive state to begin with): holds a `Config` and `Database` instance created eagerly, plus `mameService`/`gameService`/`userService`/`hiscoreService` created once (in that dependency order) by `initServices()`. Views pull these out via `getMameService()`/`getGameService()`/etc. and `getIsInit()`, and call methods on them directly: treat these as plain service classes with a lazy-init guard, not reactive state.

**Service classes** (`src/class/*.class.ts`):
- `Config.class.ts` — loads/saves `mame-awesome-ui-config.json` (mame path, mame binary filename, avatars path).
- `MameService.class.ts` — the boundary to the external `mame` binary. Constructor runs `mame -showconfig` and parses it plus `ui.ini` (paths come from MAME's own ini search order); throws if either is unparseable. Reads `favorites.ini` for the ROM list (missing file = empty list, not an error), runs `mame -lx <rom>` for per-game metadata, and launches/stops games via `execFile`.
- `GameService.class.ts` — syncs the ROM list into the `Game` Sequelize model, and reads `genre.ini`/`Multiplayer.ini` for categories/player counts from `MameService.genreIniPath`/`nplayersIniPath` (resolved from `ui.ini`'s `categorypath`, populated by a starting-pack import; absent until then, not an error).
- `Database.class.ts` — wraps a `sequelize-typescript` `Sequelize` (SQLite) instance over the `Category`/`Game`/`User`/`Hiscore` models, and runs pending migrations from `./migrations` through `Umzug` on every start (`update()`), or seeds categories on first run (`install()`).
- `UserService.class.ts` / `HiscoreService.class.ts` — user/avatar and high-score bookkeeping.
- `ScreenScraperClient.class.ts` — client for the ScreenScraper.fr API (credential-based: `devId`/`devPassword`/`userId`/`userPassword`), fetches game artwork/media (marquee, flyer, logo).
- `Gamepads.class.ts` + `src/composables/useControllable.ts` — gamepad polling dispatched as `gamepadKeydown`/`gamepadKeyup` window `CustomEvent`s; `useControllable()` is a composable that components call to register combined keyboard and gamepad handlers (`const {onKeydown, onKeyup} = useControllable()`), with cleanup handled automatically in `onUnmounted`.

**Dev vs. production paths differ throughout**, gated on `process.env.NODE_ENV === 'development'`: config JSON, the SQLite file, and migrations resolve to the project root/`./migrations` in dev vs. `remote.app.getPath('userData')`/`process.resourcesPath` in production; `Home.vue` only forces `setFullScreen(true)` outside development. When changing path or window logic, check both branches.

## Gotchas

- **sqlite3 native build on Python 3.12+**: node-gyp's gyp imports `distutils`,
  removed from Python's stdlib in 3.12. `just install` auto-resolves a Python
  interpreter that still provides `distutils` (via `PYTHON` env var) before
  running `npm install`. Running `npm install` directly on a system whose
  default `python3` is 3.12+ without `distutils`/`setuptools` will fail the
  sqlite3 build — use `just install` or export `PYTHON` yourself first.
- **Electron setuid sandbox on Ubuntu 24.04**: with
  `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04 default),
  Chromium falls back to the setuid sandbox helper
  (`node_modules/electron/dist/chrome-sandbox`), which npm cannot set to
  setuid-root. A fresh install leaves it mode 755, and Electron aborts
  *before* `background.ts` runs — no window appears, no visible error. Fix
  after every Electron reinstall/version bump:
  ```bash
  sudo chown root:root node_modules/electron/dist/chrome-sandbox
  sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
  ```
  `just serve` checks this automatically (`_check-sandbox` recipe) and prints
  this fix if misconfigured; `just build` does not run the check.
- **Electron binary missing after install**: `electron-vite dev` fails with
  `Error: Electron uninstall` (empty `node_modules/electron/dist/`) when
  Electron's own postinstall download fails silently during `npm install`
  (network hiccup, proxy). Fix: `node node_modules/electron/install.js`,
  then reapply the sandbox chmod above (fresh binary resets it to 755).

## Git workflow

Git-flow, two permanent branches (adopted 2026-09-16, replacing the
single-branch model used through tag `2.0.2`):
- **`develop`** — integration branch. Every feature/fix branch is cut from
  `develop` and every PR targets `develop` as its base branch. Never commit
  directly to `develop`.
- **`main`** — production branch. Only receives code via a promotion PR from
  `develop` once `develop` is release-ready. Never commit directly to `main`.
  Pushing to `main` (i.e. merging a promotion PR) is what triggers a release.

The `refacto-2026` Vue 3 migration branch was merged into `develop` via PR #36
(2026-09-15) and is done; do not resurrect it as a base branch.

### Versioning & releases

Version bumps, `CHANGELOG.md`, git tags and GitHub releases are automated by
semantic-release (`.releaserc.json`, branch `main` only), triggered by
`.github/workflows/release.yml` on every push to `main`. Pushing to `develop`
never triggers a release. The next version is derived from Conventional
Commits accumulated on `develop` since the last release, applied when that
work is promoted to `main` — never bump `version` in `package.json` by hand.
Tags use the bare `${version}` format (no `v` prefix, e.g. `2.0.0`).

`main` was branched from `develop` at tag `2.0.2` (2026-09-16), carrying the
full existing tag history (`1.0.0` → `2.0.2`) forward so semantic-release
keeps computing the next version from that line instead of resetting to
`1.0.0`.

## Style

- Linting is **eslint** (flat config, `eslint.config.js`): `@eslint/js` + `typescript-eslint` + `eslint-plugin-vue` (`essential`, Vue 3 preset) + `@stylistic` for formatting. 4-space indent, single quotes, fields-before-methods member ordering. Every rule reports at `warn` severity (ported from tslint's `defaultSeverity`), so `npm run lint` never fails the build.
- Vue components use `<script setup>` + the Composition API, no decorator library.
