#!/usr/bin/env bash
set -euo pipefail

# sqlite3@5 pins node-gyp 8.x, whose gyp imports `distutils` -- removed from
# Python's standard library in 3.12. node-gyp otherwise picks the first
# `python3` on PATH, which fails the build when that interpreter is 3.12+
# without the setuptools shim. Resolve an interpreter that provides
# distutils and hand it to node-gyp through PYTHON.
#
# Meant to be sourced (justfile `install` recipe, CI build jobs), not
# executed directly, so `export PYTHON` reaches the caller's shell.

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
