# Progression: Vue 2 to Vue 3 migration

Current state of the migration. For why things were done this way, see
`docs/DECISIONS.md`. For the original design and plan, see
`docs/superpowers/specs/2026-09-10-vue3-migration-design.md` and
`docs/superpowers/plans/2026-09-11-vue3-migration-safety-net-and-plumbing.md`.

**Branch:** `chore/migrate-vue2-to-vue3`, based on `refacto-2026`.
**Last updated:** 2026-09-14, after the final whole-branch review and its fixes.

## Status: all five spec steps done. Two platform/packaging gaps remain open.

The spec's five-step sequencing (design doc, section 5):

| Step | What | Status |
|---|---|---|
| 1 | Vitest safety net (characterization tests) | **Done** |
| 2 | Plumbing: electron-vite + Vue 3 probe proves native/decorator integration | **Done** |
| 3 | Port the Vue-free layers (`class/`, `model/`, `api/`, new `services.ts`) | **Done** |
| 4 | Port the 12 SFC to `<script setup>` | **Done** |
| 5 | Delete the legacy (vue-cli, Vuex, decorator libraries, the probe) | **Done** |

The plan the five steps came from is complete. What is left is not migration
work: it is the two gaps listed at the bottom, both of which predate or sit
outside this migration.

## Current baseline

Re-run these to confirm the branch still holds:

| Check | Expected |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors (589 warnings, all pre-existing `vue/script-indent`) |
| `npm test` | 51 passed, 4 files |
| `npm run electron:serve` | renderer reaches a real screen, no uncaught errors |
| `npm run electron:build` | packaged app does the same |

## What exists today

**Safety net (step 1):** 51 Vitest tests across 4 files
(`Config.class.test.ts`, `MameIniParser.test.ts`, `Helpers.class.test.ts`,
`GameService.ini.test.ts`), each covering behavior that would otherwise fail
silently. Every non-trivial assertion was verified with a mutation check
(break the implementation on purpose, confirm the test catches it, restore).

**Plumbing (step 2):** `electron.vite.config.ts` replaced the vue-cli/webpack
pipeline. The throwaway probe that proved it (`src/probe/*`) was deleted at
step 5, once the real app was fully ported. Two pieces of production code
survive from it, because the probe's checks forced real fixes rather than
probe scaffolding:
- `src/staticPath.ts`, replaces the `__static` global (see DECISIONS.md)
- `src/model/*.ts`'s six `InstanceType<typeof X>` retypes, fixes a real
  circular-import crash under Rollup (see DECISIONS.md)

**Port (steps 3-4):** all 12 SFC are `<script setup>`. Vuex is gone, replaced
by `src/services.ts` (D3); `ControllableVue.ts` became the `useControllable()`
composable (D2); the event bus became a module-level `mitt` instance
(`src/emitter.ts`).

**Cleanup (step 5):** `vue.config.js`, `src/probe/*`, the vue-cli
devDependencies, Vuex and the decorator libraries were all deleted.
`electron-builder.yml` (new) replaces `vue.config.js`'s `builderOptions`;
`electron-builder` is on 26.15.3.

**Renderer bootstrap fix (final review).** The packaged build and dev mode
were both reported working earlier in this migration on the strength of an
exit code and a live process. Neither claim was true: the renderer's own
JavaScript never executed in either mode, and no verification anywhere in this
migration had read the renderer's console. The fix replaces the
`build.rollupOptions.external` approach with `vite-plugin-electron-renderer`
(pinned to `0.14.7`, the last line supporting Vite < 8), which rewrites Node
builtin imports into real runtime `require()` calls in dev and build alike;
`sqlite3`, `sequelize` and `sequelize-typescript` are additionally kept on
runtime `require()`. Full reasoning, including why `external` could never have
worked and why the earlier verification could not have caught it, is in
DECISIONS.md (D7 and the entry above it).

This is now verified by forwarding `webContents.on('console-message', ...)` to
stdout in both modes: no uncaught errors, the router reaches `#/config`, the
real first-run screen renders, and `require('sqlite3')` completes a native
create/insert/select round-trip from inside the renderer.

## Known gaps, carried forward explicitly

Both are real, both are unrelated to the renderer fix above, and neither is
migration work.

- **macOS 15.1+ has never been verified**, at any point in this migration.
  Every check ran on Linux. This project's stated platform floor is macOS
  15.1+ and Linux (Ubuntu 24.04+, Debian 13+): macOS verification is owed
  before this branch can be considered done, not just before it ships.
- **`electron-builder`'s Linux package (AppImage/snap) has no `chrome-sandbox`
  setuid helper.** The packaged app cannot start on a kernel that restricts
  unprivileged user namespaces (this dev machine, and potentially real user
  machines on the same Ubuntu 24.04+/Debian 13+ floor) without `--no-sandbox`.
  Not fixed. Needs a real decision before release, see DECISIONS.md.

## Deferred, deliberately not fixed

- **`src/api/*` is dead code.** The Express REST controllers were already
  disabled before this migration (commented out in `src/background.ts`) and
  nothing reaches them now. Deleting them is a separate decision from porting
  the app, so they were left in place.
- **`src/background.ts` is excluded from eslint.** Pre-existing exclusion,
  left as-is.
- **`electron-builder.yml` sets no `desktopName`.** electron-builder warns
  that without it desktop environments may not associate the running window
  with the `.desktop` entry. Pre-existing gap, not a migration regression.
