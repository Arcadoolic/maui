# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron + Vue 2 (TypeScript) frontend ("arcade cabinet" front-end) for the MAME emulator. It shells out to a locally installed `mame` binary to list/launch ROMs, mirrors game/user/hiscore data into a local SQLite database via Sequelize, and drives everything with a gamepad-friendly UI.

## Platform support

The project must run on both:
- **macOS** 15.1 and later
- **Linux**: Ubuntu 24.04 and later, Debian 13 and later

Keep path handling, shell/process invocation, and packaging (Electron build targets, native module rebuilds) working on both platforms. When changing anything platform-sensitive (paths, `execFile`/shell calls, `mame -showconfig`/`ui.ini` parsing, `justfile` recipes, native module builds), verify it holds on both macOS and Linux — don't assume macOS-only behavior.

## Commands

Prefer the `justfile` recipes; they wrap the npm scripts:

```bash
just serve    # npm install, then electron:serve (dev, hot-reload)
just build    # npm install, then electron:build (packaged app)
just lint     # npm run lint:fix (eslint --fix)
just install  # npm install only
```

Only ever run **one** `serve`/`build` at a time — both trigger `npm install`, and concurrent installs race on rebuilding the native `sqlite3` module (corrupts the `node-gyp`/`make` build directory).

Other useful commands (no `just` recipe):
```bash
npx sequelize-cli migration:generate --name=<name>   # new file in migrations/
electron-rebuild -f -w sqlite3                        # manually rebuild sqlite3 native binding
```
There is no test suite in this repo.

## Architecture

**Process split, no preload/contextBridge.** `src/background.ts` is the Electron main process; it creates a single frameless `BrowserWindow` with `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, and calls `@electron/remote/main`'s `enable()` on it. Every renderer view therefore uses `@electron/remote` and Node builtins (`fs`, `child_process`, `path`, `os`) directly — there is no IPC/preload boundary to maintain. `src/api/*` (Express-based REST controllers) exists but is currently disabled (commented out in `background.ts`).

**Routing is a 3-screen flow** (`src/router.ts`): `/init` (`Init.vue`, splash) → `/config` (`Config.vue`, first-run setup) → `/home` (`Home.vue`, main browser UI). `Init.vue` loads `Config`, and if no valid config file exists redirects to `/config`; otherwise it commits the Vuex `initServices` mutation and pushes to `/home`.

**Vuex store as a service container, not state** (`src/store.ts`). State holds a `Config` and `Database` instance created eagerly, plus `mameService`/`gameService`/`userService`/`hiscoreService` created once (in that dependency order) by the `initServices` mutation. Views pull these out via getters (`this.$store.getters.mameService`, etc.) and call methods on them directly — treat these as plain service classes wired through Vuex, not reactive state.

**Service classes** (`src/class/*.class.ts`):
- `Config.class.ts` — loads/saves `mame-awesome-ui-config.json` (mame path, mame binary filename, avatars path).
- `MameService.class.ts` — the boundary to the external `mame` binary. Constructor runs `mame -showconfig` and parses it plus `ui.ini` (paths come from MAME's own ini search order); throws if either is unparseable. Reads `favorites.ini` for the ROM list (missing file = empty list, not an error), runs `mame -lx <rom>` for per-game metadata, and launches/stops games via `execFile`.
- `GameService.class.ts` — syncs the ROM list into the `Game` Sequelize model, and reads static `genre_206.ini`/`nplayers_206.ini` from `public/data` (via the `__static` global) for categories/player counts.
- `Database.class.ts` — wraps a `sequelize-typescript` `Sequelize` (SQLite) instance over the `Category`/`Game`/`User`/`Hiscore` models, and runs pending migrations from `./migrations` through `Umzug` on every start (`update()`), or seeds categories on first run (`install()`).
- `UserService.class.ts` / `HiscoreService.class.ts` — user/avatar and high-score bookkeeping.
- `Gamepads.class.ts` + `ControllableVue.ts` — gamepad polling dispatched as `gamepadKeydown`/`gamepadKeyup` window `CustomEvent`s; `ControllableVue` is a base class views extend to register combined keyboard+gamepad handlers.

**Dev vs. production paths differ throughout**, gated on `process.env.NODE_ENV === 'development'`: config JSON, the SQLite file, and migrations resolve to the project root/`./migrations` in dev vs. `remote.app.getPath('userData')`/`process.resourcesPath` in production; `Home.vue` only forces `setFullScreen(true)` outside development. When changing path or window logic, check both branches.

## Style

- Linting is **eslint** (flat config, `eslint.config.js`): `@eslint/js` + `typescript-eslint` + `eslint-plugin-vue` (`vue2-essential`) + `@stylistic` for formatting. 4-space indent, single quotes, fields-before-methods member ordering. Every rule reports at `warn` severity (ported from tslint's `defaultSeverity`), so `npm run lint` never fails the build.
- Vue components are class-based (`vue-property-decorator`/`vue-class-component`), not the Composition API.
