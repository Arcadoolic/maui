# Progression: Vue 2 to Vue 3 migration

Current state of the migration, kept up to date as work continues. For why
things were done this way, see `docs/DECISIONS.md`. For the original design
and plan, see `docs/superpowers/specs/2026-09-10-vue3-migration-design.md`
and `docs/superpowers/plans/2026-09-11-vue3-migration-safety-net-and-plumbing.md`.

**Branch:** `chore/migrate-vue2-to-vue3`, based on `refacto-2026`.
**Last updated:** 2026-09-14, after Task 13.

## Status: Phase B complete. Not shippable yet.

The spec's five-step sequencing (design doc, section 5):

| Step | What | Status |
|---|---|---|
| 1 | Vitest safety net (characterization tests) | **Done** |
| 2 | Plumbing: electron-vite + Vue 3 probe proves native/decorator integration | **Done** |
| 3 | Port the Vue-free layers (`class/`, `model/`, `api/`, new `services.ts`) | **Done** |
| 4 | Port the 12 SFC to `<script setup>` | **Done** |
| 5 | Delete the legacy (vue-cli, Vuex, decorator libraries, the probe) | **Done** |

## What exists today

**Safety net (step 1, 10 commits, `36621f4`..`22cd8fb` plus the extraction
commit `f1f21b0`):** 51 Vitest tests across 4 files
(`Config.class.test.ts`, `MameIniParser.test.ts`, `Helpers.class.test.ts`,
`GameService.ini.test.ts`), each covering behavior that would otherwise fail
silently. Every non-trivial assertion was verified with a mutation check
(break the implementation on purpose, confirm the test catches it, restore).
Run with `npm test`.

**Plumbing probe (step 2, commits `0a5a1d2`..`f467853`):** `src/probe/*` and
`electron.vite.config.ts` are a throwaway Vue 3 renderer plus a wired-up main
process, proving:
- Vue 3 renders under `@vitejs/plugin-vue`
- `@electron/remote`, `sqlite3`, and `sequelize-typescript` all work from the
  renderer (real create/read/round-trip, not just "the build succeeded")
- decorator metadata survives the swc transform in both bundles
- `boServer.ts` (the real main-process BO server, 1521+ lines, unchanged)
  starts and serves real requests from inside the probe's main process
- a real `electron-builder` package (`npm run probe:package`) boots and
  passes all the same checks against production paths

Neither `src/probe/*` nor `electron.vite.config.ts`'s probe-specific comment
survived step 5 (Task 13): both were deleted once the real app was fully
ported (steps 3-4). Two pieces of code that *do* survive, because the probe's
checks forced real fixes in production files, not just probe scaffolding:
- `src/staticPath.ts`, replaces the `__static` global (see DECISIONS.md)
- `src/model/*.ts`'s six `InstanceType<typeof X>` retypes, fixes a real
  circular-import crash under Rollup (see DECISIONS.md)

**Packaging:** `electron-builder.yml` (new, replaces `vue.config.js`'s
`builderOptions` for the packaged-build path), `electron-builder` upgraded to
26.15.3. `vue.config.js` itself, and the `vue-cli` scripts that used it, were
deleted at step 5 (Task 13).

## Known gaps, carried forward explicitly

- **macOS 15.1+ has never been verified**, at any point in this migration.
  Every check ran on Linux. This project's stated platform floor is macOS
  15.1+ and Linux (Ubuntu 24.04+, Debian 13+): macOS verification is owed
  before this branch can be considered done, not just before it ships.
- **`electron-builder`'s Linux package (AppImage/snap) has no `chrome-sandbox`
  setuid helper.** The packaged app cannot start on a kernel that restricts
  unprivileged user namespaces (this dev machine, and potentially real user
  machines on the same Ubuntu 24.04+/Debian 13+ floor) without `--no-sandbox`.
  Not fixed. Needs a real decision before release, see DECISIONS.md.

## How to resume

1. Read `docs/DECISIONS.md` for the "why" behind anything surprising.
2. Confirm the baseline still holds: `npm test` (51/51),
   `npx tsc --noEmit` (exactly 6 errors, listed above), `npm run lint` (0
   errors, 29 pre-existing warnings), `git status` clean.
3. Write the implementation plan for spec steps 3-5 (porting + cleanup). This
   did not exist as of this writing: the safety-net-and-plumbing plan
   (`docs/superpowers/plans/2026-09-11-...md`) only ever covered steps 1-2, by
   design (writing concrete porting tasks against an unproven build would have
   been speculation).
4. Step 3 first (Vue-free layers): this is where `src/services.ts` (D3)
   and the `Helpers.class.ts`/`ControllableVue.ts` listener-leak fix
   (see DECISIONS.md's rebase note; check whether upstream `842ce72` already
   covers this before redoing it) belong.
5. Step 4 (SFC): 12 components, `<script setup>` + composables (D2), no
   decorator library. `ControllableVue.ts` becomes `useControllable()`.
6. Step 5 (cleanup): delete `vue.config.js`, `src/probe/*`, the vue-cli
   devDependencies, Vuex, the decorator libraries, the `.npmrc` override note
   above, and the `electron.vite.config.ts` comment about the dev-inline
   decorator hazard (it stops being relevant once no probe exists to trigger
   it; confirm no ported component hit the same hazard first).
7. Before packaging for real users: resolve the two known gaps above
   (macOS verification, the `chrome-sandbox` packaging gap).
