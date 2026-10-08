#!/usr/bin/env bash

# @swc/core (1.16.13 and later) unpacks its native binding under the user's
# cache directory and refuses one whose path goes through a symlink: on
# Fedora Atomic (Bazzite, Silverblue...) /home is a symlink to /var/home, so
# electron-vite fails with "swc plugin require @swc/core, you need to install
# it" although it is installed. Hand it the same directory by its real path.
#
# Meant to be sourced (justfile `serve` and `build` recipes), so the export
# reaches the caller's shell. Nothing is set where the path has no symlink.

if [ -z "${SWC_NATIVE_BINDING_CACHE:-}" ]; then
    swc_cache_root="${XDG_CACHE_HOME:-$HOME/.cache}"
    if [ -d "$swc_cache_root" ]; then
        swc_cache_real=$(cd "$swc_cache_root" && pwd -P)
        if [ "$swc_cache_real" != "$swc_cache_root" ]; then
            export SWC_NATIVE_BINDING_CACHE="$swc_cache_real/swc"
        fi
    fi
fi
