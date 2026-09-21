set shell := ["bash", "-cu"]

# List available recipes
default:
    @just --list

# Install dependencies
install:
    #!/usr/bin/env bash
    set -euo pipefail
    source scripts/resolve-python.sh
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
    # runs, so no window ever appears.
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

# Build production Electron app
build: install
    #!/usr/bin/env bash
    set -euo pipefail
    # electron-builder.yml's artifactName expands env.ARTIFACT_SUFFIX unconditionally - CI sets it
    # ('-dev'/''), but a plain local build has nothing to expand and errors out. Default it here
    # so `just build` works standalone; CI's own exported value still wins.
    export ARTIFACT_SUFFIX="${ARTIFACT_SUFFIX:--local}"
    npm run electron:build

# Lint and auto-fix files
lint:
    npm run lint:fix
