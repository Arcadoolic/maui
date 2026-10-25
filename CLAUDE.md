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

Development only: `MAIN_VITE_BO_NO_PASSWORD=1` in maui's `.env` (gitignored, read by electron-vite) signs the BO in without its password, from the machine itself (loopback) only; the credentials (`ssDevPassword`...) stay locked then. A production build compiles it out (`import.meta.env.DEV`), and `isPackaged` is checked again (`signInWithoutPassword()` in `boServer.ts`).

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
- `VideoOutput.ts` / `AudioOutput.ts` — the screen and sound outputs of a dedicated cabinet (`Config.videoOutput`, `Config.audioOutput`, BO's MAUI card, Screen group, kiosk layout only; '' = as the system set them). The sound follows the screen by default (`FOLLOW_SCREEN`): a Raspberry Pi's HDMI-1 port is ALSA card `vc4hdmi0`, HDMI-2 `vc4hdmi1` (xrandr counts from 1, ALSA from 0); elsewhere it comes down to the system's default. No root for either: the output picked is made primary with `xrandr` and the other connected ones switched off, before `DisplayMode.ts` sets the mode (on the primary output), at each start; the sound output is written as the ALSA default in `~/.asoundrc`, which ALSA reads after maui-cabinets' `/etc/asound.conf`: MAUI's own window plays there. MAME does not follow ALSA's default: since 0.278 each game names its output in its cfg file (`<sound_map>` per speaker, the output as SDL names it, "o:vc4-hdmi-0, MAI PCM i2s-hifi-0"), and without one it plays on the first card SDL lists (a Pi's 3.5 mm jack). So `MameService.startGame()` writes the output into `cfg/<rom>.cfg` before each game (`MameSoundMap.ts`, `AudioOutput.ts` `gameSoundNode()`; the speakers from the file, else `mame -listxml` the first time), and `~/.asoundrc` also redefines `hw:` through plug: SDL opens a card by its `hw:` name, which a Pi's HDMI refuses ("Sample format non available"). The BO writes `~/.asoundrc` at once, and the start writes it again. A `~/.asoundrc` without MAUI's marker line is never touched.
- `WifiControl.ts` — the Wi-Fi of a dedicated cabinet, driven through NetworkManager's `nmcli` from the BO's MAUI > Network tab (`NetworkBoCard.ts`, routes `/maui/network/*`): status, radio on/off, networks in range, connect, forget. Shown on the kiosk layout only (and on Linux in development), and only when `nmcli` answers. No sudo: the kiosk's session on tty1 is local and active, which polkit allows; the same commands are refused over SSH. A failed connection is rolled back; switching the Wi-Fi off or forgetting its network is refused when it is the cabinet's only link. Never put an nmcli error's own `message` in a page: it holds the command line, Wi-Fi password included.
- `BluetoothControl.ts` — the Bluetooth gamepads of a dedicated cabinet, paired through BlueZ's `bluetoothctl` from the BO's MAUI > Bluetooth tab (`BluetoothBoCard.ts`, routes `/maui/bluetooth/*`, shown where the Network tab is): adapter on/off (with `rfkill`, which is what survives a restart), paired devices, search, pair, forget. No sudo either. A search only lasts as long as the `bluetoothctl` that asked for it and BlueZ forgets an unpaired device after half a minute, so searching and pairing each keep one `bluetoothctl` open and type into it; its output is never read (late and in pieces through a pipe), the outcome is polled with one-shot `bluetoothctl info`.
- `MameService.class.ts` — the boundary to the external `mame` binary. Constructor runs `mame -showconfig` and parses it plus `ui.ini` (paths come from MAME's own ini search order); throws if either is unparseable. Reads `favorites.ini` for the ROM list (missing file = empty list, not an error), runs `mame -lx <rom>` for per-game metadata, and launches/stops games via `execFile`. Every game it launches gets `FairPlay.ts`'s options (no cheats, rewind, autosave, debugger nor console, real speed, cheat/autofire/input macro plugins off), which win over `mame.ini`/`plugin.ini` - a player can change those from MAME's own menu; verified against 0.289. MAME launched from the BO to set the controls doesn't get them.
- `GameService.class.ts` — syncs the ROM list into the `Game` Sequelize model, and reads `genre.ini`/`Multiplayer.ini` for categories/player counts from `MameService.genreIniPath`/`nplayersIniPath` (resolved from `ui.ini`'s `categorypath`, populated by a starting-pack import; absent until then, not an error)). An optional progettoSNAPS `catver.ini` in the same directory (`MameService.catverIniPath`) takes precedence over `genre.ini`: its `Genre / Subgenre` categories are regrouped into finer MAUI genres (Fighting vs Beat 'em Up, Shoot 'em Up, Run 'n Gun...) by `src/class/CatverGenres.ts`, each with its own `src/assets/categories/<key>.svg`. The three files come from the **configuration pack** (`mame-conf-pack.zip` at the pack repository's root, `src/class/ConfPack.ts`), which also installs a corrected `hiscore.dat` in `~/.mame` (mame's cwd: its hiscore plugin reads it before its own; source in maui-repository's `conf-pack/`): game packs no longer ship `folders/`; the BO's Import tab installs it (ONLINE only, like everything downloaded from the repository, Games > Repository included, none of it Advanced-only: `src/class/RepositoryAuth.ts`, URL and credentials from MAUI-API; no manual pack upload in the BO, OFFLINE cabinets are set up by hand), keeps the repository's game pack list locked until the three files exist, and reinstalls it before a game pack import from the repository when the repository's has changed (its companion's `zip` size and date, `confPackVersion()`, against `~/.mame-awesome-ui/conf-pack.json`) or its files are missing. A pack is imported in the app by `src/class/PackImport.ts`: the repository's companion manifest says where each file sits in the ZIP (`zip`, `files`), so only the files wanted are fetched (HTTP Range) and inflated, with no python3 on the cabinet. An import never brings back a favorite removed on the cabinet (a thumbs down, or the Games tab's remove button: `removed-favorites.json`, `PackImportOptions.removedGames`), even ticked on its own: it is neither fetched nor added, and only the BO's Removed tab restores it. On a weak cabinet (1.5 GiB of memory or less: a Pi 3, not a 2 GB Pi 4, `src/class/GameSpeed.ts`) an import also leaves out the games the pack's manifest gives under 120% of their speed on a Raspberry Pi 3 (`pi3Speeds`, measured by maui-repository): the BO's pack picker shows them as not offered, and a game that was not measured is kept. The cabinet's owner can take one all the same: a click on its cross in the picker swaps it for the game's checkbox, and the form's `forceSlow` field is what lets the import through (`parseForcedGames()`); a game the installed MAME cannot run stays out. A manifest without `files` cannot be imported: the repository must regenerate it (maui-repository's `generate-repo-manifests.py`). `scripts/import-starting-pack.py` is a hand tool for a local ZIP, neither shipped nor run by the app; keep it alike when the import changes.
- `Database.class.ts` — wraps a `sequelize-typescript` `Sequelize` (SQLite) instance over the `Category`/`Game`/`User`/`Hiscore` models, and runs pending migrations from `./migrations` on every start (`update()`), or seeds categories on first run (`install()`). The migration runner itself is `src/class/Migrations.ts` (`runMigrations()`, Umzug), Electron-free so the main process (`boCore.ts`, its own Sequelize connection) can run it too: at app start, `background.ts` awaits `boCore.ts`'s `bootstrapDatabase()` (creates the base tables if missing, then migrates, seeding the single `bo_user` login account, puckman/puckman - the former admin/admin account is dropped by a later migration; the BO's former admin-only tabs/sections now sit behind the header's "Advanced configuration" switch, a per-session flag rather than a role) before opening any window, so the BO login works on a first launch and `Init.vue`'s `install()`/`update()` finds the database ready. Migrations must be idempotent (`describeTable()` guard): a fresh install's `sync()` already created the columns from the models.
- `UserService.class.ts` / `HiscoreService.class.ts` — user/avatar and high-score bookkeeping. `saveHiscores()` reloads the players before each save and only gives scores to those allowed to receive them (`OnlineReconciliation.ts`: active, and in ONLINE mode linked and not disabled in MAUI-API).
- The BO's favorites list (Games tab, `renderFavoritesCard()`) is rendered by the browser, one page at a time: the server sends the games as JSON (`buildFavoritesListData()`) with templates made by its own helpers (`renderGameNameCell()`, `renderVoteForm()`...), tokens in place of a game's values. Hundreds of full rows were megabytes of HTML, too slow for a small machine to lay out and filter. Search, category and filters (starred, hiscores extractable, players' hiscores) run on that data. The media folders are listed once per page (`listFileNames()`), not checked per game.
- Favorites' names, BIOS and devices come from `mame -lx`, kept in `~/.mame-awesome-ui/favorites-cache.json` (`FavoritesStore.ts`) with the MAME version they come from. Pack imports resolve their new games; the Games tab resolves the others (added from MAME's own menu) and, when `mame -version` changed, all of them again (`updateFavoritesCache()`): up to 5 before the page is shown, more in the background (a progress bar polling `GET /favorites/resolution`, then the list reloads). Always with the asynchronous `readGameXmlInfo()`, never `execFileSync`: the BO runs in the main process. There is no "Update favorites" button any more.
- `FrontShowGameBridge.ts` — the BO's Games > List tab has a "Show on the cabinet" button per game (`POST /favorites/show`): the main process sends the rom name to the window (`maui:show-game`), and `Home.vue`'s `showGame()` moves the carousel to the game's own category, then to the game. Ignored while a game is being played or a modal is up.
- `FrontFavoritesBridge.ts` — when the BO takes a game out of the favorites (Games > List's remove button, a thumbs down from its Votes column) or restores one, the main process tells the window (`maui:favorites-changed`) and `Home.vue`'s `syncFavorites()` syncs the games with `favorites.ini` (after `removeReturnedFavorites()`, as `Init.vue` does) and rebuilds the carousel: a removed game leaves the cabinet at once, or once the game being played is quit (MAME writes `favorites.ini` back on exit). `askVote()` never asks the vote of a removed game, and a vote modal already up for it is dropped.
- Votes and the star — `GameVote.ts`, `VoteModal.vue`: once a game is quit the cabinet asks thumbs down, neutral, thumbs up or the star. The star (`game.starred`, migration `20261024210000-game-starred.js`) is a thumbs up that also puts the game in the carousel's dynamic "My favourites" category (`STARRED_CATEGORY`, after "All Games", only while a game is starred); `voteFields()` keeps the two together: a starred game is always voted up, any other vote takes the star away. The BO's Votes column has the star too (`POST /votes/set`, `vote=star`) and tells the front when a star changes (`maui:favorites-changed`). MAUI-API only hears the thumbs up. Games > List's "My favourites" card exports the starred games to a JSON file and imports one (`StarredGamesFile.ts`, `GET /favorites/starred/export`, `POST /favorites/starred/import`, 1 MB, same-origin): an import only adds stars, to the games the cabinet has.
- `IdleWatch.ts` + `MessageBand.vue` — the cabinet's messages while nobody plays (Lot V.1): `Home.vue` reports every key and what keeps the front busy (a game running, launched by the front or by the BO: `BoMameSession.ts`, told by `MAME_SESSION_CHANNEL`; a modal; no game at all) to an `IdleWatch`, idle after `Config.frontIdleMinutes` (2, BO's MAUI tab; `Config.frontIdleEnabled` switches the whole thing off). The key that wakes it only takes the band away. The band crosses the middle of the screen with one message at a time, scrolling right to left; in Lite mode each message stands still instead (no endless animation). For now the messages are the cabinet's own latest best scores (`HiscoreService.loadLatestBests()`, `CabinetMessages.ts`), read each time it turns idle; only `**bold**` is interpreted in a message's text. Left alone `Config.frontSleepMinutes` more (30, 0 = never; from the last key when the curtain is off), the front falls asleep: a black screen with nothing mounted under it, and on the kiosk layout under X11 the screen switched off through DPMS (`ScreenPower.ts`, `Config.frontSleepScreenOff`, on by default) - `xset dpms force on` then `-dpms` at the next key, since X never hears a gamepad and would otherwise blank the screen in the middle of a game.
- Updating MAUI — `SelfUpdate.ts` (main process) installs a version the way this machine can: on a dedicated Linux cabinet (`isKioskLayout()`) the AppImage is extracted and swapped into `~/squashfs-root` (the previous one kept as `~/squashfs-root.old`), then the kiosk session is restarted on it (`KioskRestart.ts`, sudo rule of `docs/RASPBERRY-PI-DEPLOY.md` §5.7); on Windows the NSIS installer runs silently and starts the new version. The BO's Update card and the front both go through it, and both restart by themselves once the version is installed. `UpdateWatch.ts` keeps the list of GitHub releases (100 a page), and `ReleaseList.ts` `newestAbove()` picks the newer version on the BO's channel (`Config.updateChannel`, Advanced configuration: releases, or development builds too, told apart by their publication since they carry the number of the release before them). The front's offer (`FrontUpdate.ts`, `Config.frontUpdateEnabled`, on by default): when a key wakes the cabinet from idle, `Home.vue` shows `UpdateModal.vue` (thumbs down / up, no answer in 20 s is a no; a no is kept in `~/.mame-awesome-ui/declined-update.json` and that version is not asked again, the next one is), and a yes shows `UpdateProgress.vue`, the retro progress screen, fed one step at a time over `UPDATE_PROGRESS_CHANNEL`. The main process only installs the version it offers, with the file GitHub lists for it: the front never names a version nor a file, and never goes back. `MAUI_FAKE_UPDATE=<version>` (development only) offers that version and plays the installation without installing anything.
- Hotkeys — `Hotkeys.ts`: the actions of the list of games (show the BO address, quit MAUI, create a new player, shut a dedicated cabinet down: `KioskRestart.ts` `powerOff()`, through the sudo rule of `docs/RASPBERRY-PI-DEPLOY.md` §5.7 else polkit, refused outside the kiosk layout) are triggered by hotkeys set in the BO's MAUI > Controls tab (Hotkeys card, `POST /maui/hotkeys`) and kept in `maui-controls.json` (`MauiBindings.hotkeys`): one key pressed, one key held (`holdMs`), or two keys together (held or not). A key is a MAUI key (`maui|Space`: any input bound to it) or a single input (a `mauiInputId()`), MAUI key or not: `Gamepads.class.ts` and the mouse also send the presses of the inputs a hotkey names without a MAUI key (`Gamepads.hotkeyInputs`, empty `key`), and every event carries its `input`. `Home.vue` feeds its presses to a `HotkeyEngine`: a key no hotkey uses acts at once; a key of a held or two-key hotkey does its own job once released, or `COMBO_WINDOW_MS` later when no other key came, and never when its hotkey went off; a held hotkey shows the loader until it goes off; a one-key held hotkey only starts once its key is held `HOLD_DELAY_MS` (1 s), then counts `holdMs`, so a plain press of the key never shows the loader. A single input added as a pressed (not held) hotkey leaves the MAUI key it had. A file from before the hotkeys gets `defaultHotkeys()`, what the front always did (Scores held 3 s quits, New player held 2 s creates a player, both held 2 s show the BO address); an empty list is kept.
- `AlphaJump.ts` — holding up or down in the front's game list (`Home.vue` `startHold()`, timings in `MauiControls.ts` `HOLD_MS`): in "All games" and "Hiscores only" the list jumps from one initial to the next, the initials it has shown in a column on the left; in any other category it scrolls game by game, fast. The initial is the one of the title shown above the list (`shortname`), and every list of the front is in that order (`GAMES_BY_TITLE` in `GameService.class.ts`, case-insensitive, "The King of Fighters" under T). The flyer waits for the key to be released.
- ONLINE scores (MAUI-API Lot 2.3): `ScoreCapture.ts` (in `boCore.ts`, told by `Home.vue` when a game starts and ends through `ScoreCaptureBridge.ts`) reads what a game added to its table (`PlaySession.ts`) and queues it for MAUI-API (`ScoreOutbox.ts`). A score the game wrote without a name is held instead (`ScoreDeclaration.ts`, maui-api D61): given to the cabinet's only publishable player, or asked when the game is quit (`WhoPlayedModal.vue`, before the vote) when there are several. A game gets this as soon as its mhiex extractor returns rows with `name: ''`. Each score carries the report on its game up to the score (maui-api D87, `GameIntegrity.ts`): `capture-daemon.lua`, which runs in every game the front launches, rewrites `session-report.json` in its directory every second and on each event (MAME options and plugins, DIP switches off their defaults, saved states loaded/saved, pauses, resets, speed); `Home.vue` prepares that directory before the launch and hands it to `ScoreCapture.started()`, which adds the session id, MAUI's version and `-verifyroms`'s verdict on the set. MAUI-API judges it; the cabinet never does.
- ONLINE votes and plays (MAUI-API Lot 4.1, maui-api D75): `OpinionReport.ts` sends the vote and the play count of every game voted on or played, the games removed from the favorites included (a thumbs down removes the game, and the other cabinets must still hear of it). No queue: MAUI-API replaces what it had, so a game is due while it differs from what was last acknowledged (`game.opinion_sent`, read and written by `SqliteOpinionStore.ts` in plain SQL to reach the soft-deleted games). Run by `OnlineSession` after the startup report and every heartbeat.
- ONLINE badge: the BO header's badge shows ONLINE / OFFLINE, then the cabinet's name and MAUI-API's environment, left out in production (`OnlineIndicatorBridge.ts`: `describeIdentity()`, `badgeLabel()`; maui-api D62); the front shows ONLINE / OFFLINE with the badge's dot, without the name and the environment, or the dot alone when the BO's MAUI card says so (`onlineBadgeDotOnly`, off by default; `OnlineBadge.vue`). Every minute, for 10 seconds, the badge shows the machine's local IPv4 address instead (`LocalAddress.ts`: the Wi-Fi's first, then the wired one; containers, VPNs and 169.254 left out), unless the BO hides it (`onlineBadgeHideIp`, off by default). `OnlineSession` takes the name and the environment from the startup report's answer and keeps them in `online.json` (`cabinetName`, `environment`), so that an OFFLINE cabinet is still named; a new configuration string forgets them.
- ONLINE players (MAUI-API Lot 2.2, `docs/DECISIONS.md` "Players"): `OnlineRegistration.ts` (cabinet and BO registration, PIN; players start private, those registered on the cabinet public when the BO's MAUI card says so, `Config.cabinetPlayersPublic`), `PlayerSync.ts` (run by `OnlineSession`; also the avatars, maui-api D53/D56: a player's picture is only changed on the cabinet it was created on, which sends it, while the other cabinets it is linked to download it as the player's local avatar and show it read-only in the BO; an administrator may change it in MAUI-API's back office too, maui-api D83: the origin cabinet then downloads that picture once, `AvatarLedger.ts` remembering per player the hash both sides last had so that a picture changed on the cabinet afterwards is sent again, with `replaces`), `OnlineReconciliation.ts` (who blocks turning ONLINE on), `OnlinePlayersBo.ts` (BO Players column). `OnlineClient.ts` gives a `MauiApiClient` outside `OnlineSession`, renderer included.
- `ScreenScraperClient.class.ts` — client for the ScreenScraper.fr API (credential-based: `devId`/`devPassword`/`userId`/`userPassword`), fetches game artwork/media (marquee, flyer, logo) and the game's publisher/developer, which the BO's download records per favorite in `~/.mame-awesome-ui/roms-infos-cache.json` (`FavoritesStore.ts`) - read by maui-repository's `build-starting-pack.ts --publisher` to build a pack per publisher.
- `Gamepads.class.ts` + `src/composables/useControllable.ts` — gamepad polling dispatched as `gamepadKeydown`/`gamepadKeyup` window `CustomEvent`s; `useControllable()` is a composable that components call to register combined keyboard and gamepad handlers (`const {onKeydown, onKeyup} = useControllable()`), with cleanup handled automatically in `onUnmounted`. On Linux, `SharedJoysticks.ts` reads from `/dev/input/js*` the joysticks Chromium merges into one gamepad (several joysticks under one HID device, e.g. a Xin-Mo Dual Arcade two-player encoder: Chromium keys a pad by its HID device's path, so only the last joystick reaches the Gamepad API), and `Gamepads.class.ts` leaves out the Gamepad API pads of that model. Separate USB/Bluetooth pads stay on the Gamepad API. Virtual pads made with `uinput` would be merged the same way (all under `/sys/devices/virtual/`), `uhid` ones would not. Which keyboard keys, mouse buttons and gamepad inputs produce each of MAUI's keys (`MAUI_KEYS` in `MauiControls.ts`) is set from the BO's MAUI > Controls tab and kept in `maui-controls.json` next to MAUI's config (`MauiControlBindings.ts`; without the file, the keys `MAUI_KEYS` names and `src/assets/controllers.json`, as before): the screens read a key through `controlKey()` (`MauiControlsRuntime.ts`, started by `App.vue`), never `KeyboardEvent.code` directly. An input produces one MAUI key at most. The tab's "Add a gamepad button" is caught by the front's window (`FrontControlsBridge.ts`, `Gamepads.captureNext()`), which sends nothing to the screens meanwhile; the main process tells the window to read the file again after each change. The BO's page reads the gamepads too (`data-pad-listen` in `boServer.ts`) and posts what it catches as `add`, which cancels the front's capture (`cancelCapture()`): Windows only hands an Xbox-type pad's presses (Windows.Gaming.Input) to the focused window, which is the BO's browser when it runs on the same computer. A page opened on another device sees no pad, and the front catches the press. Both captures, and MAME's (`capture-daemon.lua`), ignore what is already pressed when they start until it is released (vJoy on Windows holds about twenty buttons at rest).

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
