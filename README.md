<div align="center">
  <img src="public/img/mame-logo.svg" width="96" alt="Mame Awesome UI logo">

  # Mame Awesome UI
  *A gamepad-friendly arcade cabinet front-end for MAME*

  [![Release](https://img.shields.io/github/actions/workflow/status/Arcadoolic/maui/release.yml?branch=main&style=flat-square&label=release)](https://github.com/Arcadoolic/maui/actions)
  [![Latest release](https://img.shields.io/github/v/release/Arcadoolic/maui?style=flat-square)](https://github.com/Arcadoolic/maui/releases)
  [![Node.js](https://img.shields.io/badge/Node.js->=24-3c873a?style=flat-square)](https://nodejs.org)
  [![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-informational?style=flat-square)](#platform-support)

  :star: If you like this project, star it on GitHub!

  [Overview](#overview) • [Getting Started](#getting-started) • [Usage](#usage) • [Resources](#resources)

</div>

Mame Awesome UI is an Electron + Vue 3 (TypeScript) front-end for the [MAME](https://www.mamedev.org/) emulator. It shells out to a locally installed `mame` binary to list and launch ROMs, mirrors game/user/hiscore data into a local SQLite database, and drives everything through a gamepad-friendly interface built for arcade cabinets.

## Overview

- **ROM browsing & launching** — reads MAME's own config (`mame -showconfig`, `ui.ini`, `favorites.ini`) to list and launch ROMs through the installed `mame` binary
- **Gamepad + keyboard navigation** — a shared composable (`useControllable`) wires up combined keyboard/gamepad handlers across the UI
- **Local persistence** — game, category, user and hiscore data is synced into a SQLite database via Sequelize, with migrations run automatically on startup
- **User profiles & hiscores** — per-user avatars and high-score tracking
- **Starting pack export** — bundle favorites, ROMs and artwork from a local MAME install into a distributable ZIP

## Platform Support

- **macOS** 15.1 and later
- **Linux** Ubuntu 24.04+ / Debian 13+ (Raspberry Pi 4 Model B / arm64 support in progress, see [`docs/RASPBERRY-PI-LAG.md`](docs/RASPBERRY-PI-LAG.md))

## Getting Started

### Prerequisites

- Node 24 LTS or later (see `.nvmrc`)
- A locally installed `mame` binary
- Build tools for the native `sqlite3` module — see [`docs/COMPILATION.md`](docs/COMPILATION.md) (Windows: `windows-build-tools`; Linux/macOS: `gcc`, `make`, `build-essential`)

> [!TIP]
> [`just`](https://github.com/casey/just) recipes wrap the npm scripts below and handle platform quirks automatically. Prefer them over calling `npm` directly.

### Install & run

```bash
just serve    # npm install, then dev server with hot-reload
```

```bash
just build    # npm install, then packaged Electron app
```

> [!IMPORTANT]
> On Ubuntu 24.04+ (`kernel.apparmor_restrict_unprivileged_userns=1`), Electron needs its setuid sandbox helper fixed up after every install:
> ```bash
> sudo chown root:root node_modules/electron/dist/chrome-sandbox
> sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
> ```
> `just serve` checks this automatically and prints the fix if needed.

Without `just`:

```bash
npm install
npm run electron:serve   # dev, hot-reload
npm run electron:build   # packaged app
```

> [!NOTE]
> Only run one `serve`/`build` at a time — both trigger `npm install`, and concurrent installs race on rebuilding the native `sqlite3` module.

## Usage

**Lint and auto-fix:**
```bash
just lint
```

**Run tests:**
```bash
npm test
```

**Generate a database migration:**
```bash
npx sequelize-cli migration:generate --name=<name>
```

## Resources

- [Compilation notes](docs/COMPILATION.md)
- [Database & migrations](docs/DATABASE.md)
- [Raspberry Pi performance tracking](docs/RASPBERRY-PI-LAG.md)
- [Architecture decisions](docs/DECISIONS.md)
