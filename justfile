set shell := ["bash", "-cu"]

# List available recipes
default:
    @just --list

# Install dependencies
install:
    #!/usr/bin/env bash
    set -euo pipefail
    # sqlite3@5 pins node-gyp 8.x, whose gyp imports `distutils` -- removed from
    # Python's standard library in 3.12. node-gyp otherwise picks the first
    # `python3` on PATH, which fails the build when that interpreter is 3.12+
    # without the setuptools shim. Resolve an interpreter that provides
    # distutils and hand it to node-gyp through PYTHON.
    if [ -z "${PYTHON:-}" ]; then
        for candidate in python3.11 python3.10 python3.12 python3.13 python3 /usr/bin/python3 python; do
            resolved=$(command -v "$candidate" 2>/dev/null) || continue
            if "$resolved" -c 'import distutils' >/dev/null 2>&1; then
                PYTHON="$resolved"
                break
            fi
        done
    fi
    if [ -z "${PYTHON:-}" ]; then
        echo "error: no Python interpreter providing distutils was found." >&2
        echo "       Install setuptools for one of your Python 3.12+ interpreters," >&2
        echo "       or install Python 3.11, then re-run. sqlite3 cannot be built" >&2
        echo "       for Electron without it." >&2
        exit 1
    fi
    export PYTHON
    echo "just: building native deps with PYTHON=$PYTHON"
    npm install

# Verify Electron's setuid sandbox helper can run (Linux only, no-op elsewhere)
_check-sandbox:
    #!/usr/bin/env bash
    set -euo pipefail
    # Ubuntu 24.04 ships kernel.apparmor_restrict_unprivileged_userns=1, which
    # denies Chromium the unprivileged-namespace sandbox and makes it fall back
    # to the setuid helper, node_modules/electron/dist/chrome-sandbox. npm
    # cannot set a setuid-root bit, so a fresh install leaves that helper mode
    # 755 and Electron aborts during process startup -- before background.ts
    # runs, so no window ever appears. vue-cli-plugin-electron-builder does not
    # forward the child's stderr, which turns the abort into a silent hang
    # after "Launching Electron...".
    helper="node_modules/electron/dist/chrome-sandbox"
    [ "$(uname -s)" = "Linux" ] || exit 0
    [ -e "$helper" ] || exit 0
    restricted=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
    [ "$restricted" = "1" ] || exit 0
    owner=$(stat -c '%U' "$helper")
    mode=$(stat -c '%a' "$helper")
    if [ "$owner" = "root" ] && [ "$mode" = "4755" ]; then
        exit 0
    fi
    cat >&2 <<EOF
    error: Electron cannot start -- its setuid sandbox helper is misconfigured.

      helper: $PWD/$helper
      found:  owner=$owner mode=$mode
      needs:  owner=root mode=4755

    This kernel restricts unprivileged user namespaces
    (kernel.apparmor_restrict_unprivileged_userns=1), so Chromium requires the
    setuid helper. Without it Electron aborts before opening a window, and the
    error is swallowed by the dev-server plugin.

    Fix (re-run after every Electron reinstall or version bump):

      sudo chown root:root $PWD/$helper
      sudo chmod 4755 $PWD/$helper
    EOF
    exit 1

# Run the app in development mode (Electron, hot-reload)
serve: install _check-sandbox
    npm run electron:serve

# Run the Phase B plumbing probe (electron-vite + Vue 3)
probe: install _check-sandbox
    npm run probe:dev

# Build production Electron app
build: install
    npm run electron:build

# Lint and auto-fix files
lint:
    npm run lint:fix

# Build a starting pack ZIP (favorites + roms + artwork) from the local MAME home
starting-pack output="./mame-starting-pack.zip": install
    npm run starting-pack -- --output {{output}}
