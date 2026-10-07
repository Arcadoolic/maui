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
  The AppImage is run without being installed, so at each start it adds
  itself to the desktop (`src/class/DesktopIntegration.ts`, called from
  `background.ts`): a desktop entry in
  `~/.local/share/applications/mame-awesome-ui.desktop`, a copy of its icon in
  `~/.local/share/icons/`, and the first time only a shortcut in the user's
  desktop directory (read from `user-dirs.dirs`; one the user removed does not
  come back). Files are rewritten only when they differ, so an AppImage that
  was moved or replaced by another version repairs its entry the next time it
  is started. Only for a real AppImage (`APPIMAGE` set by its runtime): the
  cabinet's extracted `~/squashfs-root` is left alone. The entry's name must
  stay `desktopName` in `package.json` (and the app's name): that is how the
  desktop matches a running window to the entry and its icon. Verified on
  Bazzite (KDE, X11) on 2026-10-04; Wayland and GNOME are untested.
- **Windows** 10 and later (x64). CI packages an installer (NSIS, `…-setup-…-win-x64.exe`: per-user, no
  administrator rights, not code-signed; the BO's Update card downloads and
  runs it silently to update an installed app, `src/class/WindowsUpdate.ts`) via a
  `windows-latest` job in both `.github/workflows/build.yml` (manual,
  `workflow_dispatch`) and `.github/workflows/release.yml` (attached to
  every GitHub Release alongside the Linux/macOS artifacts). The packaged `.exe` was confirmed working on a real Windows
  machine (2026-10-04); the Windows dev environment is still unverified —
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

**The BO is loaded on demand.** `src/boCore.ts` is what the main process starts and keeps: the SQLite connection and its bootstrap, the ONLINE session, score capture, the shared leaderboards, and a bare HTTP listener on the BO's port (3131). `src/boServer.ts` (express, every BO page, and what only they import: multer, adm-zip, bcryptjs, react) is a separate chunk of the main build (`out/main/chunks/`), `import()`ed by the first request that reaches the port, or by the cabinet's own controls (scores + new-player keys held 2 s in `Home.vue`, through `BoWakeBridge.ts`, which also shows the BO's LAN address). `src/class/BoOnDemand.ts` drops it again after `Config.boIdleMinutes` (15, 0 = never) without a request, unless `isBusy()` (a MAME the BO launched or adopted); its in-memory sessions go with it. On a dedicated cabinet (`isKioskLayout()`) `boCore.ts` also listens on port 80, which the system must allow an unprivileged process to open (maui-cabinets sets `net.ipv4.ip_unprivileged_port_start=80`); the front then shows the machine's bare LAN address instead of `localhost:3131` (`src/class/BoUrl.ts`, `src/composables/useBoUrl.ts`: first-run screen, empty game list, back office key press), and falls back on `<address>:3131` when port 80 could not be opened. A desktop install only ever uses 3131. What must run without the BO goes in `boCore.ts`, never at `boServer.ts`'s module scope. Node does not unload a module: dropping frees the BO's data, its code stays until the application restarts.

**Routing is a 3-screen flow** (`src/router.ts`, `vue-router` 5): `/init` (`Init.vue`, splash) → `/config` (`Config.vue`, first-run setup) → `/home` (`Home.vue`, main browser UI). `Init.vue` loads `Config`, and if no valid config file exists redirects to `/config`; otherwise it calls `initServices()` from `src/services.ts` and pushes to `/home`.

**`src/services.ts` as a service container, not a state store.** A plain TS module (replaced Vuex, which held zero reactive state to begin with): holds a `Config` and `Database` instance created eagerly, plus `mameService`/`gameService`/`userService`/`hiscoreService` created once (in that dependency order) by `initServices()`. Views pull these out via `getMameService()`/`getGameService()`/etc. and `getIsInit()`, and call methods on them directly: treat these as plain service classes with a lazy-init guard, not reactive state.

**Service classes** (`src/class/*.class.ts`):
- `Config.class.ts` — loads/saves `mame-awesome-ui-config.json` (mame path, mame binary filename, avatars path).
  Its passwords (`ssDevPassword`, `ssUserPassword`) are stored encrypted (`MAUIENC1.` prefix, `src/class/SecretBox.ts`): a data key wrapped with the BO account's password (`bo_user.secretsKey`), unwrapped at BO sign-in into the in-memory session. Only BO routes given `new Config(getSecretsKey(req))` see them in the clear; any other `new Config()` carries them as stored. Signing in with the default `puckman` password forces a change before anything else (credentials stay locked meanwhile); plaintext values left by older versions are encrypted at the next sign-in. File written `0o600`.
- `UiMode.ts` — the front's **Lite** mode for weak hardware (a Raspberry Pi 3 composites in software, see `docs/RASPBERRY-PI-LAG.md`): `Config.uiMode` (`auto`/`lite`/`full`, BO's MAUI tab) resolved once by `App.vue` against the memory size and Electron's `gpu_compositing` status, then `html.lite` (rules in `App.vue`'s global style: no transitions, filters, shadows nor endless animation) and `isLite()` from `services.ts` for the few JS timings. A new effect in a component needs no Lite counterpart unless it is an endless animation or a blurred `text-shadow`.
- `DisplayMode.ts` — the screen mode of a dedicated cabinet (`Config.displayMode`: `auto`/`1080p`/`720p`/`native`, BO's MAUI tab, shown on a cabinet only), set with `xrandr` by `background.ts` before the window opens. Only on the kiosk layout (`isKioskLayout()` in `KioskRestart.ts`) under X11: a desktop's screen is never touched. `auto` is a ceiling (1080 lines, 720 in Lite mode) that leaves a lower mode alone. MAME follows the desktop's mode, nothing is passed to it.
- `MameService.class.ts` — the boundary to the external `mame` binary. Constructor runs `mame -showconfig` and parses it plus `ui.ini` (paths come from MAME's own ini search order); throws if either is unparseable. Reads `favorites.ini` for the ROM list (missing file = empty list, not an error), runs `mame -lx <rom>` for per-game metadata, and launches/stops games via `execFile`.
- `GameService.class.ts` — syncs the ROM list into the `Game` Sequelize model, and reads `genre.ini`/`Multiplayer.ini` for categories/player counts from `MameService.genreIniPath`/`nplayersIniPath` (resolved from `ui.ini`'s `categorypath`, populated by a starting-pack import; absent until then, not an error)). An optional progettoSNAPS `catver.ini` in the same directory (`MameService.catverIniPath`) takes precedence over `genre.ini`: its `Genre / Subgenre` categories are regrouped into finer MAUI genres (Fighting vs Beat 'em Up, Shoot 'em Up, Run 'n Gun...) by `src/class/CatverGenres.ts`, each with its own `src/assets/categories/<key>.svg`. The three files come from the **configuration pack** (`mame-conf-pack.zip` at the pack repository's root, `src/class/ConfPack.ts`), which also installs a corrected `hiscore.dat` in `~/.mame` (mame's cwd: its hiscore plugin reads it before its own; source in maui-repository's `conf-pack/`): game packs no longer ship `folders/`; the BO's Import tab installs it (not Advanced-only, but ONLINE only, like everything downloaded from the repository: `src/class/RepositoryAuth.ts`, URL and credentials from MAUI-API; no manual pack upload in the BO, OFFLINE cabinets are set up by hand), keeps the repository's game pack list locked until the three files exist, and reinstalls it before every game pack import from the repository. A pack is imported in the app by `src/class/PackImport.ts`: the repository's companion manifest says where each file sits in the ZIP (`zip`, `files`), so only the files wanted are fetched (HTTP Range) and inflated, with no python3 on the cabinet. A manifest without `files` cannot be imported: the repository must regenerate it (maui-repository's `generate-repo-manifests.py`). `scripts/import-starting-pack.py` is a hand tool for a local ZIP, neither shipped nor run by the app; keep it alike when the import changes.
- `Database.class.ts` — wraps a `sequelize-typescript` `Sequelize` (SQLite) instance over the `Category`/`Game`/`User`/`Hiscore` models, and runs pending migrations from `./migrations` on every start (`update()`), or seeds categories on first run (`install()`). The migration runner itself is `src/class/Migrations.ts` (`runMigrations()`, Umzug), Electron-free so the main process (`boCore.ts`, its own Sequelize connection) can run it too: at app start, `background.ts` awaits `boCore.ts`'s `bootstrapDatabase()` (creates the base tables if missing, then migrates, seeding the single `bo_user` login account, puckman/puckman - the former admin/admin account is dropped by a later migration; the BO's former admin-only tabs/sections now sit behind the header's "Advanced configuration" switch, a per-session flag rather than a role) before opening any window, so the BO login works on a first launch and `Init.vue`'s `install()`/`update()` finds the database ready. Migrations must be idempotent (`describeTable()` guard): a fresh install's `sync()` already created the columns from the models.
- `UserService.class.ts` / `HiscoreService.class.ts` — user/avatar and high-score bookkeeping. `saveHiscores()` reloads the players before each save and only gives scores to those allowed to receive them (`OnlineReconciliation.ts`: active, and in ONLINE mode linked and not disabled in MAUI-API).
- ONLINE players (MAUI-API Lot 2.2, `docs/DECISIONS.md` "Players"): `OnlineRegistration.ts` (cabinet and BO registration, PIN), `PlayerSync.ts` (run by `OnlineSession`), `OnlineReconciliation.ts` (who blocks turning ONLINE on), `OnlinePlayersBo.ts` (BO Players column). `OnlineClient.ts` gives a `MauiApiClient` outside `OnlineSession`, renderer included.
- `ScreenScraperClient.class.ts` — client for the ScreenScraper.fr API (credential-based: `devId`/`devPassword`/`userId`/`userPassword`), fetches game artwork/media (marquee, flyer, logo) and the game's publisher/developer, which the BO's download records per favorite in `~/.mame-awesome-ui/roms-infos-cache.json` (`FavoritesStore.ts`) - read by maui-repository's `build-starting-pack.ts --publisher` to build a pack per publisher.
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
  `Error: Electron uninstall` (missing `node_modules/electron/path.txt`) when
  Electron's own postinstall download fails silently during `npm install`
  (network hiccup, proxy) — `electron-vite`'s own `getElectronPath()` throws
  instead of re-downloading like `electron`'s `index.js` does. `just
  serve`/`just build` check this automatically (`_check-electron-binary`
  recipe) and re-run `node node_modules/electron/install.js` if needed. On
  Linux, reapply the sandbox chmod above afterward (fresh binary resets it
  to 755) — `_check-sandbox` runs after `_check-electron-binary` in `just
  serve` and will print the fix if needed, but `just build` doesn't run
  that check. Running `npm install`/`electron-vite` directly, outside
  `just`, still needs the manual fix.

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
