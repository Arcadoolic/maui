# Vue 3 Migration, Part 1: Safety Net and Plumbing, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a characterization-test safety net around the parsing logic, then
stand up electron-vite + Vue 3 with a throwaway renderer that proves the native
and Node integration works, before any application code is ported.

**Architecture:** Two phases from the approved design. Phase A adds Vitest and
locks in the current behavior of the pure parsing code, still running on
vue-cli and Vue 2.7. Phase B builds an electron-vite pipeline next to the
existing vue-cli one (they coexist until the end of the migration) and proves,
with a minimal renderer, that `sqlite3`, `sequelize-typescript`,
`@electron/remote`, the BO server and the static ini files all survive the
bundler change.

**Tech Stack:** Vitest 5, Vite 7, electron-vite 5, `@vitejs/plugin-vue` 6,
Vue 3.5, electron-builder 26, TypeScript 5.9, Electron 44.

**Spec:** `docs/superpowers/specs/2026-09-10-vue3-migration-design.md`

## Scope of this plan

This plan covers **steps 1 and 2 only** of the five-step sequencing in section 5
of the spec.

Steps 3 to 5 (port the Vue-free layers, port the 12 SFC, delete the legacy) get
their own plan, written once Task 10 below passes. That is deliberate: the spec
states that step 2 is the only step that can fail for a reason outside our
control. Writing concrete tasks for porting 12 components against a build that
may not exist in that shape would be speculation, and this plan format does not
allow placeholders.

## Global Constraints

- **Platforms:** the app must run on macOS 15.1+ and Linux (Ubuntu 24.04+,
  Debian 13+). Anything touching paths, process invocation or packaging is
  verified on both.
- **Node:** `^20.19.0 || >=22.12.0` (electron-vite 5 `engines`). Local is
  v22.15.1.
- **Vite is pinned to 7.** electron-vite 5 peers `vite ^5 || ^6 || ^7`, not
  Vite 8. Do not let a transitive update pull Vite 8 in.
- **Never run two `just serve` / `just build` at once.** Both trigger
  `npm install`, and concurrent installs corrupt the native `sqlite3` rebuild.
- **The Electron process model does not change** (spec D4): `nodeIntegration:
  true`, `contextIsolation: false`, `@electron/remote` stays. No preload is
  introduced.
- **All code, comments, identifiers and documentation in English.**
- **Conventional Commits** for every commit message.
- **No em dash** in any file this plan creates.

## A note on characterization tests, and how they invert TDD

The normal cycle is RED then GREEN: the test fails because the behavior does not
exist yet. Phase A is the opposite. The behavior already exists and must not
change; the tests exist to detect it changing later.

So in Phase A, a test that passes the first time is the expected outcome, and a
test that fails means either the test is wrong or you have found a real bug. The
RED step is replaced by an explicit **mutation check**: after the test passes,
break the implementation on purpose, confirm the test fails, then restore. A
characterization test that has never been seen to fail is worthless, because it
may be asserting nothing.

Two of these tests deliberately lock in behavior that is wrong. That is correct.
Fixing behavior during a migration destroys the safety net's only purpose, which
is to prove that nothing changed. Each such test carries a comment saying so and
naming the follow-up.

## File Structure

**Phase A creates:**

| File | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest setup: `@` alias, node environment, `@electron/remote` stub alias |
| `tests/stubs/electron-remote.ts` | Minimal stand-in for `@electron/remote` so `Helpers.class.ts` is importable outside Electron |
| `tests/unit/Config.class.test.ts` | Characterizes config load/save |
| `tests/unit/MameIniParser.test.ts` | Characterizes mame ini and favorites parsing |
| `tests/unit/Helpers.class.test.ts` | Characterizes path resolution |
| `tests/unit/GameService.ini.test.ts` | Characterizes genre/nplayers lookup through `__static` |
| `src/class/MameIniParser.ts` | Pure parsing extracted from `MameService.class.ts`, no I/O, no Electron |

**Phase A modifies:**

| File | Change |
|---|---|
| `src/class/MameService.class.ts` | Delegates parsing to `MameIniParser`, keeps identical behavior |
| `package.json` | Adds `vitest` and the `test` / `test:watch` scripts |
| `eslint.config.js` | Lints `tests/` with the right globals |
| `.gitignore` | Ignores coverage output |

**Phase B creates:**

| File | Responsibility |
|---|---|
| `electron.vite.config.ts` | The main and renderer bundle configs |
| `src/probe/main.ts` | Throwaway main entry for the plumbing proof |
| `src/probe/renderer.ts` | Throwaway renderer entry for the plumbing proof |
| `src/probe/Probe.vue` | Throwaway Vue 3 SFC displaying the probe results |
| `src/probe/index.html` | Renderer HTML entry for electron-vite |
| `src/staticPath.ts` | The `__static` replacement, valid in dev and packaged, usable from both processes |

**Phase B modifies:**

| File | Change |
|---|---|
| `package.json` | Adds Vue 3, electron-vite, Vite 7, `@vitejs/plugin-vue`, electron-builder 26; adds `probe:*` scripts. Does **not** remove vue-cli yet |
| `justfile` | Adds a `probe` recipe next to `serve` |
| `src/class/GameService.class.ts` | Reads the static path through `src/staticPath.ts` instead of the `__static` global |
| `src/boServer.ts` | Same change, main-process side |
| `eslint.config.js` | Drops the `__static` readonly global once nothing declares it |

---

# Phase A: the safety net (spec step 1)

## Task 1: Vitest harness, proved on Config

`Config.class.ts` is the right first target: it has no Electron import and no
`__static`, so it isolates "does the harness work" from "can this module even be
imported outside Electron".

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/Config.class.test.ts`
- Modify: `package.json` (devDependencies, scripts)
- Modify: `.gitignore`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test`, and the `@` path alias resolving inside tests.
  Every later task depends on both.

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest@^5.0.0
```

Note the constraint: this must not pull Vite 8. Check what landed:

```bash
npm ls vite
```

If Vite 8 appears, pin it explicitly with `npm install --save-dev vite@^7` and
re-check. Phase B depends on Vite 7.

- [ ] **Step 2: Add the test scripts**

In `package.json`, inside `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the Vitest config**

Create `vitest.config.ts`:

```ts
import {defineConfig} from 'vitest/config';
import {resolve} from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Same '@' alias the app uses, so test imports match source imports.
            '@': resolve(__dirname, 'src'),
            // Helpers.class.ts imports @electron/remote at module scope, which does
            // not exist outside an Electron renderer. Tests get a stand-in instead.
            '@electron/remote': resolve(__dirname, 'tests/stubs/electron-remote.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
```

- [ ] **Step 4: Write the `@electron/remote` stub**

Create `tests/stubs/electron-remote.ts`:

```ts
// Stand-in for @electron/remote, which only exists inside an Electron renderer.
// Helpers.class.ts imports it at module scope, so any test importing Helpers (or
// MameService, which imports Helpers) needs this to resolve.
export const app = {
    getPath(name: string): string {
        return `/tmp/mame-awesome-ui-test/${name}`;
    },
};
```

- [ ] **Step 5: Write the Config characterization test**

Create `tests/unit/Config.class.test.ts`:

```ts
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import Config from '@/class/Config.class';

// Config picks its directory from NODE_ENV: '.' in development, the passed
// userDataPath otherwise. These tests run in the non-development branch so the
// temp directory is actually used.
const originalNodeEnv = process.env.NODE_ENV;
let dir: string;

beforeEach(() => {
    process.env.NODE_ENV = 'test';
    dir = mkdtempSync(join(tmpdir(), 'mame-config-'));
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    rmSync(dir, {recursive: true, force: true});
});

describe('Config.exist', () => {
    it('is false when no config file is present', () => {
        expect(new Config(dir).exist()).toBe(false);
    });

    it('is true once the file exists', () => {
        writeFileSync(join(dir, 'mame-awesome-ui-config.json'), '{}');
        expect(new Config(dir).exist()).toBe(true);
    });
});

describe('Config.load', () => {
    it('returns false and leaves the instance unloaded when there is no file', () => {
        const config = new Config(dir);
        expect(config.load()).toBe(false);
        expect(config.loaded()).toBe(false);
    });

    it('reads the documented fields', () => {
        writeFileSync(join(dir, 'mame-awesome-ui-config.json'), JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            avatarsPath: '/opt/avatars',
            ssDevId: 'dev',
            ssUserId: 'user',
        }));

        const config = new Config(dir);
        expect(config.load()).toBe(true);
        expect(config.loaded()).toBe(true);
        expect(config.mamePath).toBe('/opt/mame');
        expect(config.mameBinaryName).toBe('mame');
        expect(config.avatarsPath).toBe('/opt/avatars');
        expect(config.ssDevId).toBe('dev');
        expect(config.ssUserId).toBe('user');
    });

    it('defaults the ScreenScraper credentials to empty strings when absent', () => {
        writeFileSync(join(dir, 'mame-awesome-ui-config.json'), JSON.stringify({
            mamePath: '/opt/mame',
            mameBinaryName: 'mame',
            avatarsPath: '/opt/avatars',
        }));

        const config = new Config(dir);
        config.load();
        expect(config.ssDevId).toBe('');
        expect(config.ssDevPassword).toBe('');
        expect(config.ssSoftName).toBe('');
        expect(config.ssUserPassword).toBe('');
    });

    it('treats openDevTools as true unless it is exactly false', () => {
        // The implementation is `configFile.openDevTools !== false`, so a missing
        // key and any truthy or non-false value all yield true.
        const cases: Array<[unknown, boolean]> = [
            [undefined, true],
            [true, true],
            [false, false],
        ];

        for (const [written, expected] of cases) {
            writeFileSync(join(dir, 'mame-awesome-ui-config.json'), JSON.stringify({
                mamePath: '/opt/mame',
                mameBinaryName: 'mame',
                avatarsPath: '/opt/avatars',
                openDevTools: written,
            }));
            const config = new Config(dir);
            config.load();
            expect(config.openDevTools).toBe(expected);
        }
    });
});

describe('Config.save', () => {
    it('round-trips through load', () => {
        const written = new Config(dir);
        written.mamePath = '/opt/mame';
        written.mameBinaryName = 'mame64';
        written.avatarsPath = '/opt/avatars';
        written.ssSoftName = 'mame-awesome-ui';
        written.openDevTools = false;
        written.save();

        expect(existsSync(join(dir, 'mame-awesome-ui-config.json'))).toBe(true);

        const read = new Config(dir);
        expect(read.load()).toBe(true);
        expect(read.mamePath).toBe('/opt/mame');
        expect(read.mameBinaryName).toBe('mame64');
        expect(read.avatarsPath).toBe('/opt/avatars');
        expect(read.ssSoftName).toBe('mame-awesome-ui');
        expect(read.openDevTools).toBe(false);
    });

    it('writes only the documented keys', () => {
        const config = new Config(dir);
        config.mamePath = '/opt/mame';
        config.save();

        const raw = JSON.parse(readFileSync(join(dir, 'mame-awesome-ui-config.json'), 'utf8'));
        expect(Object.keys(raw).sort()).toEqual([
            'avatarsPath',
            'mameBinaryName',
            'mamePath',
            'openDevTools',
            'ssDevId',
            'ssDevPassword',
            'ssSoftName',
            'ssUserId',
            'ssUserPassword',
        ]);
    });
});
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: all pass. These describe code that already works, so passing is the
correct first result. If anything fails, stop and read the failure: either the
test is wrong or you have found a real bug. Do not "fix" `Config.class.ts` to
make a test pass without understanding which of the two it is.

- [ ] **Step 7: Mutation check, to prove the tests actually bite**

In `src/class/Config.class.ts`, temporarily change
`this.openDevTools = configFile.openDevTools !== false;`
to
`this.openDevTools = configFile.openDevTools === true;`

Run: `npm test`
Expected: FAIL on "treats openDevTools as true unless it is exactly false".

Revert the change (`git checkout src/class/Config.class.ts`) and run `npm test`
again. Expected: PASS. Do not commit the mutation.

- [ ] **Step 8: Teach eslint about the test files**

In `eslint.config.js`, make sure `tests/**/*.ts` is linted and has the Vitest
globals available. Follow whatever shape the existing config uses for globals;
the identifiers needed are `describe`, `it`, `expect`, `beforeEach`,
`afterEach`.

Run: `npm run lint`
Expected: no errors from `tests/`.

- [ ] **Step 9: Ignore coverage output**

Append to `.gitignore`:

```
/coverage
```

- [ ] **Step 10: Commit**

```bash
git add vitest.config.ts tests/ package.json package-lock.json .gitignore eslint.config.js
git commit -m "test(config): add Vitest and characterize Config load and save

First tests in this repository. They exist as a safety net for the Vue 3
migration: they encode current behavior so a bundler or toolchain change that
silently alters it is caught.

Config is the first target because it has no Electron dependency, which keeps
the harness itself under test before harder modules are added."
```

## Task 2: Extract the mame ini parser and characterize it

`MameService.parseMameIniFile` is `protected static`, and the constructor around
it shells out to the `mame` binary, so the parsing cannot be reached from a test
as written. Extract it into a module with no I/O and no Electron import, and
have the class delegate.

**Files:**
- Create: `src/class/MameIniParser.ts`
- Create: `tests/unit/MameIniParser.test.ts`
- Modify: `src/class/MameService.class.ts`

**Interfaces:**
- Consumes: the `@` alias and `npm test` from Task 1.
- Produces: `parseMameIni(fileContent: string): Record<string, string[]>` and
  `parseFavorites(fileContent: string): string[]`, both exported from
  `@/class/MameIniParser`. Task 3 adds the second one; this task adds the first.

- [ ] **Step 1: Create the parser module with the ini function**

Create `src/class/MameIniParser.ts`:

```ts
/**
 * Pure parsing helpers for the ini files mame produces or consumes.
 *
 * Extracted from MameService so they can be tested without a mame binary: the
 * MameService constructor shells out to `mame -showconfig`, which makes the
 * parsing unreachable from a test as long as it lives there.
 *
 * Behavior here is deliberately identical to the original, quirks included.
 */

/**
 * Parse the key/value output of `mame -showconfig` or a mame ini file.
 *
 * Every value is split on ';' because several mame settings are path lists.
 * A single value therefore still comes back as a one-element array.
 */
export function parseMameIni(fileContent: string): { [key: string]: string[] } {
    const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
    const result: { [key: string]: string[] } = {};

    fileContent.split('\n').forEach((line) => {
        if (line[0] === '#') { // Skip comments
            return;
        }
        const data = regex.exec(line.trim());
        if (data) {
            result[data[1]] = data[2].replace(/^"(.*)"$/, '$1').split(';');
        }
    });

    return result;
}
```

Note the one intentional difference from the original: the original mutated a
target object passed in by the caller, this returns a new one. Both call sites
passed a freshly initialized empty object, so the observable behavior is
identical, and returning a new object matches the project's immutability rule.

- [ ] **Step 2: Write the characterization test**

Create `tests/unit/MameIniParser.test.ts`:

```ts
import {describe, it, expect} from 'vitest';
import {parseMameIni} from '@/class/MameIniParser';

describe('parseMameIni', () => {
    it('reads a key and its value', () => {
        expect(parseMameIni('rompath roms')).toEqual({rompath: ['roms']});
    });

    it('splits every value on semicolons, because mame path settings are lists', () => {
        expect(parseMameIni('rompath roms;/opt/mame/roms')).toEqual({
            rompath: ['roms', '/opt/mame/roms'],
        });
    });

    it('returns a single value as a one-element array', () => {
        expect(parseMameIni('samplepath samples').samplepath).toEqual(['samples']);
    });

    it('strips one layer of surrounding double quotes', () => {
        expect(parseMameIni('rompath "/opt/my roms"')).toEqual({
            rompath: ['/opt/my roms'],
        });
    });

    it('skips comment lines', () => {
        const content = [
            '# this is a comment',
            'rompath roms',
        ].join('\n');
        expect(parseMameIni(content)).toEqual({rompath: ['roms']});
    });

    it('ignores keys that are not lowercase letters and underscores', () => {
        // The key pattern is /^([a-z_]+)\s+(.+)$/, so anything with a digit or an
        // uppercase letter in the key is dropped entirely.
        const content = [
            'rompath roms',
            'romPath2 other',
        ].join('\n');
        expect(parseMameIni(content)).toEqual({rompath: ['roms']});
    });

    it('ignores a key with no value', () => {
        expect(parseMameIni('rompath')).toEqual({});
    });

    it('trims each line before matching, so indented entries still parse', () => {
        expect(parseMameIni('    rompath roms   ')).toEqual({rompath: ['roms']});
    });

    it('keeps the last occurrence when a key is repeated', () => {
        const content = [
            'rompath first',
            'rompath second',
        ].join('\n');
        expect(parseMameIni(content)).toEqual({rompath: ['second']});
    });

    it('returns an empty object for empty input', () => {
        expect(parseMameIni('')).toEqual({});
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/unit/MameIniParser.test.ts`
Expected: PASS.

If "ignores a key with no value" or "keeps the last occurrence" fails, you have
found a real difference between what the code does and what this plan claims.
Trust the code, correct the test to match it, and note the difference in the
commit message.

- [ ] **Step 4: Mutation check**

In `src/class/MameIniParser.ts`, temporarily remove `.split(';')`.

Run: `npx vitest run tests/unit/MameIniParser.test.ts`
Expected: FAIL on the semicolon and one-element-array tests.

Restore the `.split(';')` and re-run. Expected: PASS.

- [ ] **Step 5: Make MameService delegate**

In `src/class/MameService.class.ts`:

Add the import next to the existing ones:

```ts
import {parseMameIni} from '@/class/MameIniParser';
```

Delete the whole `protected static parseMameIniFile(...)` method.

Replace the two call sites in the constructor. This:

```ts
        MameService.parseMameIniFile(mameIniContent.toString(), this.mameIni);

        const uiIniContent = readFileSync(uiIniPath, 'utf8');
        MameService.parseMameIniFile(uiIniContent, this.uiIni);
```

becomes this:

```ts
        this.mameIni = parseMameIni(mameIniContent.toString());

        const uiIniContent = readFileSync(uiIniPath, 'utf8');
        this.uiIni = parseMameIni(uiIniContent);
```

While you are in the field declarations, fix the typo on the first one. This:

```ts
    public mameIni: { [key: string]: any } = {} = {};
```

becomes this:

```ts
    public mameIni: { [key: string]: string[] } = {};
```

and the next line becomes:

```ts
    public uiIni: { [key: string]: string[] } = {};
```

- [ ] **Step 6: Check nothing else called the removed method**

Run: `grep -rn 'parseMameIniFile' src tests`
Expected: no output.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. The `uiIni` type went from `any` to
`{ [key: string]: string[] }`, so a consumer that relied on `any` may now be
flagged. `this.uiIni.ui_path`, `this.uiIni.marquees_directory` and
`this.uiIni.flyers_directory` are all passed to
`Helpers.getFirstExistingDirectory(paths: string[], ...)`, so `string[]` is the
correct type and any error here is a real one worth reading.

Run: `npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/class/MameIniParser.ts src/class/MameService.class.ts tests/unit/MameIniParser.test.ts
git commit -m "refactor(mame): extract ini parsing into a testable module

parseMameIniFile was a protected static behind a constructor that shells out to
the mame binary, so the parsing was unreachable from a test. Move it to
MameIniParser with no I/O and no Electron import, and characterize it.

The extracted function returns a new object instead of mutating one passed in.
Both call sites handed it a freshly initialized empty object, so behavior is
unchanged.

Also type mameIni and uiIni as string[] maps, which is what the parser has
always produced, and drop a stray double initializer on mameIni."
```

## Task 3: Characterize favorites parsing, bug included

**Files:**
- Modify: `src/class/MameIniParser.ts`
- Modify: `src/class/MameService.class.ts`
- Modify: `tests/unit/MameIniParser.test.ts`

**Interfaces:**
- Consumes: `parseMameIni` and the module from Task 2.
- Produces: `parseFavorites(fileContent: string): string[]`, exported from
  `@/class/MameIniParser`.

**Read this before writing the test.** The current implementation builds its
regex with the `g` flag and then calls `.test()` in a loop over the lines. A
global regex keeps `lastIndex` between calls, so after a successful match the
next `.test()` resumes from that offset instead of the start. The effect,
verified by running the real code:

- lines `["pacman","galaga","dkong","frogger","mspacman"]` yield
  `["pacman","dkong","mspacman"]`, every other entry dropped
- when matching lines are separated by non-matching ones (a real `favorites.ini`
  interleaves rom names with metadata lines like `0`), the failed `.test()`
  resets `lastIndex` to 0 and nothing is dropped

This is the `FIXME : Do not take first favorite !` in the source. The symptom was
noticed, the cause was not. **Encode the behavior as it is.** Fixing it here
would destroy the only thing the safety net is for, which is proving that the
migration changed nothing. The fix is a separate ticket, after the migration.

- [ ] **Step 1: Add the function, preserving the bug**

Append to `src/class/MameIniParser.ts`:

```ts
/**
 * Extract rom names from a mame favorites.ini file.
 *
 * Known defect, preserved deliberately: the regex carries the 'g' flag and is
 * reused across .test() calls, so lastIndex persists and every other entry is
 * dropped whenever two matching lines are adjacent. Real favorites.ini files
 * interleave rom names with metadata lines, which resets lastIndex and hides
 * the problem most of the time.
 *
 * This is the 'FIXME: Do not take first favorite' noted in MameService. It is
 * kept as-is so the Vue 3 migration can prove it changed nothing; fixing it is
 * a separate change with its own test update.
 */
export function parseFavorites(fileContent: string): string[] {
    const regexp = new RegExp(/^(?![0-9]$)[a-z0-9]+$/, 'gm');
    const result: string[] = [];
    const existing: { [key: string]: boolean } = {};

    fileContent.split('\n').forEach((line: string) => {
        line = line.trim();
        if (regexp.test(line) && !existing[line]) {
            existing[line] = true;
            result.push(line);
        }
    });

    return result;
}
```

- [ ] **Step 2: Write the characterization test**

Append to `tests/unit/MameIniParser.test.ts`:

```ts
import {parseFavorites} from '@/class/MameIniParser';

describe('parseFavorites', () => {
    it('extracts rom names from a realistic favorites.ini', () => {
        const content = [
            '[ROOT_FOLDER]',
            '[Favorite]',
            '',
            'pacman',
            '0',
            '0',
            '0',
            'galaga',
            '0',
            '0',
            '0',
            'dkong',
            '0',
            '0',
            '0',
        ].join('\n');

        expect(parseFavorites(content)).toEqual(['pacman', 'galaga', 'dkong']);
    });

    it('drops every other entry when matching lines are adjacent (known defect)', () => {
        // Deliberately locked in. The regex is built with the 'g' flag and reused
        // across .test() calls, so lastIndex survives a successful match and the
        // next line is tested from the wrong offset. See parseFavorites' comment.
        // Do not "fix" this test; fixing the parser is a separate change.
        const content = ['pacman', 'galaga', 'dkong', 'frogger', 'mspacman'].join('\n');

        expect(parseFavorites(content)).toEqual(['pacman', 'dkong', 'mspacman']);
    });

    it('ignores section headers', () => {
        expect(parseFavorites('[ROOT_FOLDER]\npacman')).toEqual(['pacman']);
    });

    it('ignores a bare single digit', () => {
        // The negative lookahead (?![0-9]$) exists to skip the metadata lines.
        expect(parseFavorites('0\npacman')).toEqual(['pacman']);
    });

    it('keeps a multi-digit line, which the lookahead does not cover', () => {
        expect(parseFavorites('[Favorite]\n1942')).toEqual(['1942']);
    });

    it('deduplicates', () => {
        const content = ['pacman', '0', 'pacman', '0', 'galaga'].join('\n');
        expect(parseFavorites(content)).toEqual(['pacman', 'galaga']);
    });

    it('returns an empty list for empty input', () => {
        expect(parseFavorites('')).toEqual([]);
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/unit/MameIniParser.test.ts`
Expected: PASS, including the two tests that lock in the defect.

If "drops every other entry" fails, the implementation you pasted differs from
the original. Compare it against `getRomListFromFavorites` in
`src/class/MameService.class.ts` before the change, character by character, and
in particular check that the regex still carries `gm`.

- [ ] **Step 4: Mutation check**

Temporarily change the flags in `parseFavorites` from `'gm'` to `'m'`.

Run: `npx vitest run tests/unit/MameIniParser.test.ts`
Expected: FAIL on "drops every other entry when matching lines are adjacent",
which will now return all five names.

This is the proof that the test is pinning the defect rather than describing
nothing. Restore `'gm'` and re-run. Expected: PASS.

- [ ] **Step 5: Make MameService delegate**

In `src/class/MameService.class.ts`, extend the existing import:

```ts
import {parseMameIni, parseFavorites} from '@/class/MameIniParser';
```

Replace the body of `getRomListFromFavorites` after the `favoritePath` guard.
This:

```ts
        const regexp = new RegExp(/^(?![0-9]$)[a-z0-9]+$/, 'gm');
        const file = readFileSync(favoritePath!, 'utf8').split('\n');
        const retArray: string[] = [];
        const existing: { [key: string]: boolean } = {};
        file.forEach((line: string) => {
            line = line.trim(); // FIXME : Do not take first favorite !
            if (regexp.test(line) && !existing[line]) {
                existing[line] = true;
                retArray.push(line);
            }
        });
        return retArray;
```

becomes this:

```ts
        return parseFavorites(readFileSync(favoritePath, 'utf8'));
```

The non-null assertion on `favoritePath` is dropped because the early return
above already narrowed it.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

Run: `npm run lint`
Expected: clean.

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/class/MameIniParser.ts src/class/MameService.class.ts tests/unit/MameIniParser.test.ts
git commit -m "test(mame): characterize favorites parsing, defect included

Move the favorites.ini parsing next to the ini parser and pin its behavior.

The regex carries the 'g' flag and is reused across .test() calls, so lastIndex
persists and every other entry is dropped when two matching lines are adjacent.
Real favorites.ini files interleave rom names with metadata lines, which resets
lastIndex and hides it. This is the FIXME the source already carried.

The behavior is locked in on purpose: the safety net's job is to prove the Vue 3
migration changes nothing. Fixing the regex is a separate change."
```

## Task 4: Characterize path resolution in Helpers

This is the first test to import a module that pulls `@electron/remote` at
module scope, so it is also the proof that the stub alias from Task 1 works.

**Files:**
- Create: `tests/unit/Helpers.class.test.ts`

**Interfaces:**
- Consumes: the `@electron/remote` stub alias from Task 1.
- Produces: nothing new. `Helpers.getFirstExistingDirectory` keeps its existing
  signature `(paths: string[], parentPath?: string|null, file?: string) => string|null`.

- [ ] **Step 1: Write the test**

Create `tests/unit/Helpers.class.test.ts`:

```ts
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir, homedir} from 'os';
import Helpers from '@/class/Helpers.class';

// Importing Helpers pulls @electron/remote at module scope. It resolves to
// tests/stubs/electron-remote.ts through the alias in vitest.config.ts; if this
// file fails to import at all, that alias is what to look at.

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mame-helpers-'));
});

afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
});

describe('Helpers.getFirstExistingDirectory', () => {
    it('returns null when nothing in the list exists', () => {
        expect(Helpers.getFirstExistingDirectory([join(dir, 'nope')])).toBeNull();
    });

    it('returns the first path that exists', () => {
        const second = join(dir, 'second');
        mkdirSync(second);

        expect(Helpers.getFirstExistingDirectory([
            join(dir, 'first'),
            second,
        ])).toBe(second);
    });

    it('stops at the first hit even when a later one also exists', () => {
        const first = join(dir, 'first');
        const second = join(dir, 'second');
        mkdirSync(first);
        mkdirSync(second);

        expect(Helpers.getFirstExistingDirectory([first, second])).toBe(first);
    });

    it('appends the file argument and requires the file itself to exist', () => {
        const roms = join(dir, 'roms');
        mkdirSync(roms);

        expect(Helpers.getFirstExistingDirectory([roms], null, 'favorites.ini')).toBeNull();

        writeFileSync(join(roms, 'favorites.ini'), '');
        expect(Helpers.getFirstExistingDirectory([roms], null, 'favorites.ini'))
            .toBe(join(roms, 'favorites.ini'));
    });

    it('resolves a relative path against parentPath', () => {
        const child = join(dir, 'ui');
        mkdirSync(child);

        expect(Helpers.getFirstExistingDirectory(['ui'], dir)).toBe(child);
    });

    it('does not duplicate a segment shared between parentPath and the relative path', () => {
        // When the last segment of parentPath equals the first segment of the
        // relative path, the implementation drops the duplicate rather than
        // nesting it: parent /a/ui plus 'ui/cfg' resolves to /a/ui/cfg, not
        // /a/ui/ui/cfg.
        const ui = join(dir, 'ui');
        const cfg = join(ui, 'cfg');
        mkdirSync(ui);
        mkdirSync(cfg);

        expect(Helpers.getFirstExistingDirectory(['ui/cfg'], ui)).toBe(cfg);
    });

    it('expands a leading ~ to the home directory', () => {
        expect(Helpers.getFirstExistingDirectory(['~'])).toBe(homedir());
    });

    it('expands $HOME to the home directory', () => {
        expect(Helpers.getFirstExistingDirectory(['$HOME'])).toBe(homedir());
    });

    it('leaves an absolute path alone even when parentPath is given', () => {
        const absolute = join(dir, 'absolute');
        mkdirSync(absolute);

        expect(Helpers.getFirstExistingDirectory([absolute], '/somewhere/else')).toBe(absolute);
    });
});

describe('Helpers.getMameHomePath', () => {
    it('returns a stable path under the home directory and creates it', () => {
        const path = Helpers.getMameHomePath();
        expect(path).toBe(join(homedir(), '.mame-awesome-ui', 'mame-home'));
        // Calling it is what creates the directory, so a second call must agree.
        expect(Helpers.getMameHomePath()).toBe(path);
    });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/unit/Helpers.class.test.ts`
Expected: PASS.

If the file fails to import with an error mentioning `@electron/remote`, the
alias in `vitest.config.ts` is wrong. Fix the alias, not the source.

Two of these assertions describe behavior that is worth reading closely before
trusting the test: the shared-segment deduplication, and the `~` / `$HOME`
expansion (the implementation replaces only the first occurrence, since the
regex has no `g` flag). If either fails, correct the test to match the code and
say so in the commit message.

- [ ] **Step 3: Mutation check**

In `src/class/Helpers.class.ts`, temporarily comment out the `pathArray.shift()`
line inside the shared-segment branch.

Run: `npx vitest run tests/unit/Helpers.class.test.ts`
Expected: FAIL on "does not duplicate a segment shared between parentPath and
the relative path".

Restore the line and re-run. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/Helpers.class.test.ts
git commit -m "test(helpers): characterize path resolution

Pins the behavior MameService depends on to find ui.ini, favorites.ini,
marquees and flyers: first-match wins, relative paths resolve against the
parent, a segment shared between the parent and the relative path is not
duplicated, and ~ and \$HOME expand to the home directory.

Also the first test to import a module that pulls @electron/remote at module
scope, which exercises the stub alias added with the harness."
```

## Task 5: Characterize the genre and nplayers lookup

This is the test that matters most for the migration: it is the only one that
exercises the `__static` global, whose disappearance under electron-vite is the
failure mode the whole safety net exists to catch (spec 2.6).

**Files:**
- Create: `tests/unit/GameService.ini.test.ts`

**Interfaces:**
- Consumes: the harness from Task 1.
- Produces: nothing new. Characterizes `GameService.prototype.getGameCategoryId`
  and `getGameNplayers`.

**Read this first.** `GameService` reads the two ini files through the ambient
`__static` global and caches them in static fields (`GameService.genreIni`,
`GameService.nplayersIni`). Two consequences for the test:

- `__static` must be defined on `globalThis` before the module under test runs,
  pointing at the repository's `public/` directory
- the static cache is shared across tests in the same file, which is fine here
  because every test reads the same fixture, but means the cache must not be
  polluted by a test that points `__static` somewhere else

The constructor takes a `MameService` and a `HiscoreService`, neither of which
these two methods touch. Construct with `null` casts rather than building real
services, which would require a mame binary.

- [ ] **Step 1: Confirm the fixture files are where the test expects**

Run: `ls public/data`
Expected: `genre_206.ini` and `nplayers_206.ini` are both listed.

Run: `grep -c . public/data/genre_206.ini`
Expected: a large non-zero count. If either file is missing, stop: the test
below cannot be written and `GameService` is already broken.

- [ ] **Step 2: Confirm the fixture entries the test asserts on**

The assertions below use real entries read from the shipped files. Confirm they
are still there before writing the test, because the fixtures are versioned data
that could be regenerated:

```bash
grep -n '^\[' public/data/genre_206.ini | head -3
grep -n '^arkanoid$' public/data/genre_206.ini
grep -n '^academy$' public/data/genre_206.ini
grep -n '^\[' public/data/nplayers_206.ini | head -4
grep -n '^arkanoid$' public/data/nplayers_206.ini
```

Expected, and what the test depends on:

| Fact | Value |
|---|---|
| First genre section | `[Ball & Paddle]` at line 1 |
| Second genre section | `[Board Game]` at line 170 |
| `arkanoid` in genre file | line 5, so under `[Ball & Paddle]`, the first key |
| `academy` in genre file | line 171, so under `[Board Game]`, the second key |
| `arkanoid` in nplayers file | line 3980, so under `[2P alt]` (starts 3829, next section 7079) |
| `nplayersTranslation['2P alt']` | `{sim: 0, alt: 2}` |

`getGameCategoryId` returns `Object.keys(genreIni).indexOf(category) + 1`, so
`arkanoid` yields 1 and `academy` yields 2. If any line number above has moved,
adjust the expectations to what the files now say rather than forcing the old
values.

- [ ] **Step 3: Write the test**

Create `tests/unit/GameService.ini.test.ts`:

```ts
import {describe, it, expect, beforeAll} from 'vitest';
import {resolve} from 'path';

// GameService reads public/data/*.ini through the ambient __static global that
// vue-cli-plugin-electron-builder injects via DefinePlugin. Vitest does not, so
// define it before importing the module under test.
//
// This is exactly the coupling the Vue 3 migration breaks: electron-vite has no
// __static. When src/staticPath.ts replaces it, this test is what proves the
// replacement resolves to the same files.
(globalThis as Record<string, unknown>).__static = resolve(__dirname, '../../public');

describe('GameService ini lookups', () => {
    let service: import('@/class/GameService.class').default;

    beforeAll(async () => {
        const {default: GameService} = await import('@/class/GameService.class');
        // Neither method under test touches the injected services.
        service = new GameService(null as never, null as never);
    });

    it('loads the genre file and exposes the categories', () => {
        const categories = service.getGameCategories();
        expect(Object.keys(categories).length).toBeGreaterThan(0);
    });

    it('returns a 1-based category id, counting sections in file order', () => {
        // arkanoid sits under [Ball & Paddle], the first section, so id 1.
        expect(service.getGameCategoryId('arkanoid')).toBe(1);
        // academy sits under [Board Game], the second section, so id 2.
        expect(service.getGameCategoryId('academy')).toBe(2);
    });

    it('returns undefined for a rom in no category', () => {
        expect(service.getGameCategoryId('definitely-not-a-real-rom')).toBeUndefined();
    });

    it('reads the player counts for a known rom', () => {
        // arkanoid sits under [2P alt], which nplayersTranslation maps to alt 2.
        expect(service.getGameNplayers('arkanoid')).toEqual({sim: 0, alt: 2});
    });

    it('falls back to zeroes for a rom absent from nplayers.ini', () => {
        // Note this is the same shape as the '1P' translation, so this assertion
        // cannot distinguish "not found" from "found and single-player".
        expect(service.getGameNplayers('definitely-not-a-real-rom')).toEqual({sim: 0, alt: 0});
    });
});
```

If an assertion fails, read what the code actually returned and assert that
instead. The fixtures are versioned data and these expectations were read off
the files as they stand today; the code's behavior is the reference, not this
plan.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/GameService.ini.test.ts`
Expected: PASS.

If the import itself fails on `electron-log` or a Sequelize model, the module
graph needs another alias in `vitest.config.ts`, the same way
`@electron/remote` got one. Add a stub under `tests/stubs/` rather than changing
`GameService`.

- [ ] **Step 5: Mutation check**

Temporarily change `'data/genre_206.ini'` to `'data/genre_999.ini'` in
`src/class/GameService.class.ts`.

Run: `npx vitest run tests/unit/GameService.ini.test.ts`
Expected: FAIL with an ENOENT.

This is the single most important mutation check in the plan: it is the exact
shape of the failure that a broken `__static` replacement will produce in
Phase B. Restore the filename and re-run. Expected: PASS.

- [ ] **Step 6: Run the whole suite and lint**

Run: `npm test`
Expected: all pass.

Run: `npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/GameService.ini.test.ts
git commit -m "test(game): characterize genre and nplayers lookups

Pins the category id and player-count resolution, read from public/data through
the ambient __static global.

This is the test the migration is built around: electron-vite provides no
__static, and an unresolved static path yields an empty rom list rather than an
error. When staticPath.ts replaces the global, this test is what proves the
replacement points at the same files."
```

## Phase A exit criteria

Before starting Phase B, all of these must hold:

- `npm test` passes, with tests covering `Config`, `parseMameIni`,
  `parseFavorites`, `Helpers.getFirstExistingDirectory` and the `GameService`
  ini lookups
- every test has been seen to fail at least once through its mutation check
- `npm run lint` is clean
- `npx tsc --noEmit -p tsconfig.json` reports no new errors
- `just serve` still starts the app unchanged, on vue-cli and Vue 2.7. Phase A
  must not have altered any runtime behavior

---

# Phase B: the plumbing (spec step 2)

Phase B builds a second pipeline next to the existing one, reached through
separate `probe:*` scripts. No file is deleted: `vue.config.js`, the vue-cli
dependencies and every application source stay in the tree until spec step 5.

**But one thing does break, unavoidably, and it is worth stating plainly before
you start.** `vue@2` and `vue@3` are the same npm package, so they cannot be
installed side by side. The moment Task 6 installs Vue 3, the vue-cli pipeline
stops working and `just serve` no longer starts the app. There is no arrangement
that avoids this short of a second checkout.

The consequences to accept:

- From Task 6 onward, the probe is the only thing that runs. `just serve` comes
  back only when the SFC are ported, at spec step 4.
- The branch is therefore **not shippable between Task 6 and the end of spec
  step 4**. That is the cost of this sequencing, and it was weighed when option
  C was chosen over option A, whose intermediate step existed precisely to keep a
  working app at every point.
- Phase A must be fully green and committed before Task 6 starts, because
  running the Phase A suite is harder to reason about once Vue 3 is in place.
- If you need the current app working during Phase B (to compare behavior, or
  to actually use it), use a second worktree on `refacto-2026` rather than
  reinstalling Vue 2 here.

## Task 6: electron-vite skeleton that opens a window

**Files:**
- Create: `electron.vite.config.ts`
- Create: `src/probe/main.ts`
- Create: `src/probe/index.html`
- Create: `src/probe/renderer.ts`
- Create: `src/probe/Probe.vue`
- Modify: `package.json`
- Modify: `justfile`

**Interfaces:**
- Consumes: nothing from Phase A.
- Produces: `npm run probe:dev` starting an Electron window rendering a Vue 3
  component. Tasks 7 to 10 extend this same probe.

- [ ] **Step 1: Check the electron-vite 5 config API before writing it**

The config below is written against electron-vite 5's documented shape. Verify
it against the installed version's own docs rather than trusting this plan,
because a wrong `build.rollupOptions.input` key fails with an unhelpful error:

```bash
npm view electron-vite@^5.0.0 version
```

Then read the config reference for that exact version. If the shape differs from
what follows, follow the docs and note the difference in the commit message.

- [ ] **Step 2: Install the Phase B dependencies**

```bash
npm install --save-dev electron-vite@^5.0.0 vite@^7 @vitejs/plugin-vue@^6
npm install vue@^3.5.42
```

This is the commit that breaks `just serve`, as described in the phase preamble.
Confirm the state rather than being surprised by it later:

```bash
npm ls vue
```

Expected: `vue@3.5.x`, and `vue-template-compiler@2.7.16` now mismatched against
it. That mismatch is the vue-cli pipeline going down. It is expected here, and
it stays down until the SFC are ported at spec step 4.

Check that Phase A survived, since it is the safety net and its value depends on
still being runnable:

```bash
npm test
```

Expected: all pass. None of the Phase A tests import Vue, so the version change
must not affect them. If one breaks, stop and find out why before continuing:
a safety net that stopped working at the exact moment the risky work began is
worse than no safety net.

- [ ] **Step 3: Write the electron-vite config**

Create `electron.vite.config.ts`:

```ts
import {resolve} from 'path';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';
import vue from '@vitejs/plugin-vue';

// sqlite3 is a native module and sequelize/sequelize-typescript reach for it at
// runtime; none of the three can be bundled. externalizeDepsPlugin leaves every
// production dependency external, which is the electron-vite equivalent of the
// `externals: ['sqlite3', 'sequelize']` this project carried in vue.config.js.
//
// Both processes need it: boServer.ts runs in the main process and imports
// sequelize-typescript and the models directly.

const alias = {
    '@': resolve(__dirname, 'src'),
    // Force the real Node build of sequelize-typescript instead of the no-op
    // "browser" stub, which the default mainFields resolution picks up and which
    // silently turns the decorators into no-ops. Carried over from vue.config.js.
    'sequelize-typescript': resolve(__dirname, 'node_modules/sequelize-typescript/dist/index.js'),
};

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/probe/main.ts')},
            },
        },
    },
    renderer: {
        plugins: [externalizeDepsPlugin(), vue()],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/probe/index.html')},
            },
        },
    },
});
```

There is no `preload` section: this project has no preload script and is not
gaining one (spec D4).

- [ ] **Step 3b: Add the probe scripts**

In `package.json`, inside `"scripts"`:

```json
"probe:dev": "electron-vite dev",
"probe:build": "electron-vite build"
```

- [ ] **Step 4: Write the probe main process**

Create `src/probe/main.ts`:

```ts
import {app, BrowserWindow} from 'electron';
import {enable, initialize} from '@electron/remote/main';
import {join} from 'path';

// Throwaway entry for the Phase B plumbing proof. It mirrors the window options
// of src/background.ts so the probe exercises the same integration surface:
// nodeIntegration on, contextIsolation off, @electron/remote enabled.

function createWindow(): void {
    const win = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
        },
    });

    enable(win.webContents);

    if (process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        win.loadFile(join(__dirname, '../renderer/index.html'));
    }
}

initialize();

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});
```

- [ ] **Step 5: Write the probe renderer**

Create `src/probe/index.html`:

```html
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Plumbing probe</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="./renderer.ts"></script>
</body>
</html>
```

Create `src/probe/renderer.ts`:

```ts
import {createApp} from 'vue';
import Probe from './Probe.vue';

createApp(Probe).mount('#app');
```

Create `src/probe/Probe.vue`:

```vue
<template>
    <main>
        <h1>Plumbing probe</h1>
        <ul>
            <li v-for="check in checks" :key="check.name">
                {{ check.ok ? 'OK' : 'FAIL' }} {{ check.name }}: {{ check.detail }}
            </li>
        </ul>
    </main>
</template>

<script setup lang="ts">
import {ref, onMounted} from 'vue';

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}

const checks = ref<Check[]>([]);

function record(name: string, run: () => string): void {
    try {
        checks.value = [...checks.value, {name, ok: true, detail: run()}];
    } catch (error) {
        checks.value = [...checks.value, {name, ok: false, detail: String(error)}];
    }
}

onMounted(() => {
    record('vue', () => 'Vue 3 renders and this component is <script setup>');
});
</script>
```

- [ ] **Step 6: Run the probe**

Run: `npm run probe:dev`
Expected: an Electron window opens showing "Plumbing probe" and one OK line for
the `vue` check.

On Linux, if nothing appears and the process hangs, it is the `chrome-sandbox`
setuid helper, not electron-vite. Run the check the justfile already implements:

```bash
just _check-sandbox
```

and follow its instructions.

- [ ] **Step 7: Add the just recipe**

In `justfile`, after the `serve` recipe:

```
# Run the Phase B plumbing probe (electron-vite + Vue 3)
probe: install _check-sandbox
    npm run probe:dev
```

- [ ] **Step 8: Commit**

```bash
git add electron.vite.config.ts src/probe package.json package-lock.json justfile
git commit -m "build(vite): add an electron-vite probe rendering Vue 3

First half of the plumbing step: an electron-vite pipeline next to the existing
vue-cli one, with a throwaway main and renderer whose only job is to prove the
integration surface before any application code is ported.

The window options mirror background.ts (nodeIntegration on, contextIsolation
off, @electron/remote enabled) so the probe exercises what the real renderer
will need. externalizeDepsPlugin and the sequelize-typescript resolution
override carry over what vue.config.js did, applied to both bundles."
```

## Task 7: Prove the native modules survive in the renderer

**Files:**
- Modify: `src/probe/Probe.vue`

**Interfaces:**
- Consumes: the probe from Task 6.
- Produces: evidence that `@electron/remote`, `sqlite3` and
  `sequelize-typescript` work in a Vite-bundled renderer. Nothing downstream
  imports from this file; it is deleted at spec step 5.

- [ ] **Step 1: Add the remote check**

In `src/probe/Probe.vue`, inside `onMounted`, after the existing `vue` check:

```ts
    record('@electron/remote', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const remote = require('@electron/remote');
        return `userData resolves to ${remote.app.getPath('userData')}`;
    });
```

- [ ] **Step 2: Run and confirm**

Run: `npm run probe:dev`
Expected: a second OK line showing a real userData path.

A failure here means `externalizeDepsPlugin` is not covering `@electron/remote`,
or `nodeIntegration` is not actually on. Check the window options in
`src/probe/main.ts` first, then the config.

- [ ] **Step 3: Add the database check**

The point is to exercise the same stack `Database.class.ts` uses: the native
`sqlite3` binding underneath `sequelize-typescript`, opening a real file.

In `src/probe/Probe.vue`, add to `onMounted`:

```ts
    record('sqlite3 + sequelize-typescript', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {Sequelize} = require('sequelize-typescript');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {app} = require('@electron/remote');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {join} = require('path');

        const sequelize = new Sequelize({
            dialect: 'sqlite',
            storage: join(app.getPath('userData'), 'probe.sqlite'),
            logging: false,
        });

        // If the decorators were turned into no-ops by the browser stub, or the
        // native binding is missing, this is where it surfaces.
        return `sequelize dialect is ${sequelize.getDialect()}`;
    });
```

- [ ] **Step 4: Run and confirm**

Run: `npm run probe:dev`
Expected: a third OK line reading "sequelize dialect is sqlite".

If it fails with a message about a missing native binding, the `sqlite3`
external is not taking effect. If it fails with something about decorators or
undefined models, the `sequelize-typescript` alias is not being applied to the
renderer bundle. Those are different problems with different fixes; read the
error before changing anything.

- [ ] **Step 5: Commit**

```bash
git add src/probe/Probe.vue
git commit -m "build(vite): prove the native modules survive in a Vite renderer

The probe now resolves @electron/remote and opens sqlite3 through
sequelize-typescript from the renderer, which is the integration the migration's
only real unknown rests on."
```

## Task 8: Prove the main bundle, with the BO server

`boServer.ts` is the reason the main bundle needs the same treatment as the
renderer: it imports `sequelize-typescript` and the models directly (spec 2.5).

**Files:**
- Modify: `src/probe/main.ts`

**Interfaces:**
- Consumes: `startBoServer(userDataPath: string, port: number, onReady: () => void): Server`
  from `@/boServer`, and `BO_SERVER_PORT` from `@/boServerPort`. Confirm both
  signatures against the source before writing the call; the plan's reading of
  `background.ts:96` is `startBoServer(app.getPath('userData'), BO_SERVER_PORT, callback)`.
- Produces: evidence that the main bundle externalizes the native modules.

- [ ] **Step 1: Confirm the startBoServer signature**

Run: `grep -n 'export function startBoServer' -A 5 src/boServer.ts`

Write the call below to match what you see, not what this plan assumes.

- [ ] **Step 2: Start the BO server from the probe main**

In `src/probe/main.ts`, add the imports:

```ts
import {startBoServer} from '@/boServer';
import {BO_SERVER_PORT} from '@/boServerPort';
```

and inside `app.whenReady().then(...)`, before `createWindow()`:

```ts
    // boServer imports sequelize-typescript and the models in the main process.
    // Starting it here is what proves the main bundle externalizes the native
    // modules, not just the renderer one.
    startBoServer(app.getPath('userData'), BO_SERVER_PORT, () => {
        console.log(`probe: BO server listening on ${BO_SERVER_PORT}`);
    });
```

- [ ] **Step 3: Run and confirm**

Run: `npm run probe:dev`
Expected: the terminal prints "probe: BO server listening on 3131".

In another terminal:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3131/
```

Expected: `200`.

- [ ] **Step 4: Confirm @electron/remote stayed out of the main bundle**

`Helpers.class.ts` imports `@electron/remote` at module scope, which breaks a
main-process file. `boServer.ts` avoids it by duplicating the Sequelize import
shape rather than importing `Database.class.ts` (spec 2.5). Verify the build did
not reintroduce it:

```bash
npm run probe:build
grep -rl "@electron/remote" out/main/ || echo "clean: no @electron/remote in the main bundle"
```

Expected: the "clean" message. If the grep finds a hit, something in the main
entry's import graph now reaches `Helpers.class.ts`. Find it with
`npx vite-bundle-visualizer` or by bisecting the imports, and break the chain
rather than working around it.

The `out/` directory name comes from electron-vite's default `outDir`; adjust
the path if the installed version differs.

- [ ] **Step 5: Ignore the build output**

Append to `.gitignore`:

```
/out
```

- [ ] **Step 6: Commit**

```bash
git add src/probe/main.ts .gitignore
git commit -m "build(vite): prove the main bundle runs the BO server

boServer imports sequelize-typescript and the models in the main process, so the
native externals have to hold there too, not only in the renderer.

Also asserts that @electron/remote stays out of the main bundle: Helpers imports
it at module scope, which is why boServer duplicates the Sequelize import shape
instead of reusing Database.class.ts."
```

## Task 9: Replace `__static`

This is the required deliverable of spec 2.6. `__static` is injected by
`vue-cli-plugin-electron-builder`'s DefinePlugin and has no electron-vite
equivalent. It is read from both processes: `GameService.class.ts` (renderer)
and `boServer.ts` (main).

**Files:**
- Create: `src/staticPath.ts`
- Modify: `src/class/GameService.class.ts`
- Modify: `src/boServer.ts`
- Modify: `tests/unit/GameService.ini.test.ts`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `getStaticPath(): string`, exported from `@/staticPath`, returning
  the directory that holds `data/genre_206.ini` and `data/nplayers_206.ini`.
  Replaces every read of the `__static` global.

- [ ] **Step 1: Find every use**

Run: `grep -rn '__static' src tests eslint.config.js`

Expected: the ambient declarations in `src/class/GameService.class.ts` and
`src/boServer.ts`, the three `join(__static, ...)` call sites in `GameService`,
whatever `boServer.ts` does with it, the global in `eslint.config.js`, and the
assignment in the Task 5 test. Every one of them is replaced in this task.

- [ ] **Step 2: Write the replacement**

Create `src/staticPath.ts`:

```ts
import {join} from 'path';

/**
 * Directory holding the files shipped in public/, notably data/genre_206.ini and
 * data/nplayers_206.ini.
 *
 * Replaces the __static global, which vue-cli-plugin-electron-builder injected
 * through webpack's DefinePlugin and which electron-vite does not provide.
 * Importable from both processes: it depends on nothing but 'path' and
 * process.resourcesPath.
 *
 * In development the files are served from the repository's public/ directory.
 * In a packaged app electron-builder places them under the resources directory.
 */
export function getStaticPath(): string {
    if (process.env.NODE_ENV === 'development') {
        return join(__dirname, '..', '..', 'public');
    }
    return join(process.resourcesPath, 'public');
}
```

The development branch resolves relative to the built file, so verify it against
where electron-vite actually writes the bundles before trusting it. Step 4 is
that verification.

- [ ] **Step 3: Replace the call sites**

In `src/class/GameService.class.ts`:

Delete `declare const __static: string;`, add
`import {getStaticPath} from '@/staticPath';` next to the other imports, and
replace all three occurrences of `join(__static, ...)` with
`join(getStaticPath(), ...)`.

Do the same in `src/boServer.ts` for its declaration and its use.

Then in `eslint.config.js`, delete the `__static: 'readonly'` global.

Run: `grep -rn '__static' src eslint.config.js`
Expected: no output.

- [ ] **Step 4: Prove it resolves in development**

In `src/probe/Probe.vue`, add to `onMounted`:

```ts
    record('static path', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {readFileSync} = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {join} = require('path');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const {getStaticPath} = require('@/staticPath');

        const path = join(getStaticPath(), 'data', 'genre_206.ini');
        const lines = readFileSync(path, 'utf8').split('\n').length;
        return `${path} has ${lines} lines`;
    });
```

Run: `npm run probe:dev`
Expected: an OK line naming the real path and a large line count.

If it reports ENOENT, the development branch of `getStaticPath` is wrong for
where electron-vite puts the bundles. Print `__dirname` from the probe, count
the levels up to the repository root, and correct the number of `'..'` segments.
Do not paper over it by hardcoding an absolute path.

- [ ] **Step 5: Point the Phase A test at the new function**

In `tests/unit/GameService.ini.test.ts`, replace the `globalThis.__static`
assignment with a Vitest mock of the module, so the test exercises the same
indirection the app now uses:

```ts
import {vi} from 'vitest';
import {resolve} from 'path';

vi.mock('@/staticPath', () => ({
    getStaticPath: () => resolve(__dirname, '../../public'),
}));
```

Delete the old `(globalThis as Record<string, unknown>).__static = ...` line and
the comment above it that describes the global.

Run: `npm test`
Expected: all pass, unchanged. **This is the moment the safety net pays for
itself.** If the genre or nplayers tests fail here, the `__static` replacement
does not resolve to the same files, and you have caught in a test run exactly
the silent empty-rom-list failure the spec predicted.

- [ ] **Step 6: Lint and typecheck**

Run: `npm run lint`
Expected: clean, with no complaint about an undefined `__static`.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/staticPath.ts src/class/GameService.class.ts src/boServer.ts tests/unit/GameService.ini.test.ts eslint.config.js src/probe/Probe.vue
git commit -m "refactor(static): replace the __static global with getStaticPath

__static was injected by vue-cli-plugin-electron-builder through webpack's
DefinePlugin and defined nowhere in this repository. electron-vite provides no
equivalent, so dropping vue-cli would have removed it from under both processes.

getStaticPath depends only on path and process.resourcesPath, so the renderer
and the main process can both import it. The characterization test now mocks
that module instead of assigning the global, which is what proves the
replacement resolves to the same files."
```

## Task 10: Packaging

**Files:**
- Modify: `package.json`
- Create: `electron-builder.yml`

**Interfaces:**
- Consumes: everything from Tasks 6 to 9.
- Produces: a packaged app built from the electron-vite output. This is the last
  exit criterion of spec step 2.

- [ ] **Step 1: Move the builder config out of vue.config.js**

The current `builderOptions` live inside `vue.config.js` under
`pluginOptions.electronBuilder`, which electron-builder cannot read on its own.
Copy them into a standalone `electron-builder.yml`, preserving every value:

```yaml
appId: mame-awesome-ui
productName: mame-awesome-ui
asar: true
directories:
  output: dist_electron
files:
  - out/**/*
  - package.json
extraResources:
  - from: migrations/
    to: migrations/
  - from: public/
    to: public/
linux:
  category: Game
```

Two entries are new and deliberate. `directories.output` keeps the artifacts
where `dist_electron` already is, and the `public/` extra resource is what makes
the production branch of `getStaticPath` (`join(process.resourcesPath, 'public')`)
resolve. Under vue-cli, the plugin copied `public/` implicitly; electron-builder
will not.

Leave `vue.config.js` untouched. It is deleted at spec step 5.

- [ ] **Step 2: Add the package script**

In `package.json`, inside `"scripts"`:

```json
"probe:package": "electron-vite build && electron-builder --config electron-builder.yml"
```

- [ ] **Step 3: Upgrade electron-builder**

```bash
npm install --save-dev electron-builder@^26.15.3
```

The installed version is 21.2.0, from 2019, which predates Electron 44 by a wide
margin.

- [ ] **Step 4: Build the package**

Run: `npm run probe:package`
Expected: a package under `dist_electron/`.

Do not run this concurrently with `just serve` or `just build`. Both trigger
`npm install`, and concurrent installs corrupt the native `sqlite3` rebuild.

- [ ] **Step 5: Run the packaged app and read the probe**

Launch the built artifact (on Linux, the AppImage or the unpacked binary under
`dist_electron/linux-unpacked/`).

Expected: the probe window opens and **all four checks report OK**, including
the static path one, which now exercises the production branch of
`getStaticPath` rather than the development one.

The static check is the one to watch. If it reports ENOENT here but passed in
development, the `extraResources` entry for `public/` is missing or
`process.resourcesPath` does not point where the production branch assumes.

- [ ] **Step 6: Verify on the second platform**

Repeat steps 4 and 5 on whichever of macOS 15.1+ or Linux you did not use.
Packaging and path resolution are the two most platform-sensitive things in this
project, and this is the last task that can catch a divergence cheaply.

If only one platform is available right now, say so explicitly rather than
marking this step done. An unverified platform is a known gap, not a passed
check.

- [ ] **Step 7: Commit**

```bash
git add electron-builder.yml package.json package-lock.json
git commit -m "build(package): package the probe with electron-builder 26

Moves the builder options out of vue.config.js into a standalone config
electron-builder can read without the vue-cli plugin, and upgrades the builder
from 21.2.0 (2019) to 26.

Adds public/ as an extra resource. The vue-cli plugin copied it implicitly;
electron-builder does not, and the production branch of getStaticPath reads
from it."
```

## Phase B exit criteria

These are the spec's step 2 exit criteria, restated as a checklist:

- `npm run probe:dev` starts the app and all four probe checks report OK
- the renderer opens SQLite through `sequelize-typescript` and the native
  binding loads
- the BO server answers on `http://localhost:3131`
- `@electron/remote` resolves in the renderer and is absent from the main bundle
- both static ini files load through `getStaticPath`, in development **and** from
  the packaged app
- `npm run probe:package` produces a working package
- `npm test` still passes, in particular the `GameService` ini tests
- all of the above verified on both macOS and Linux, or the unverified platform
  named explicitly

When these hold, the migration's only real unknown is closed and the plan for
spec steps 3 to 5 can be written against a build that is known to work.

## What this plan deliberately does not do

- It does not port any application code. Every `src/probe/*` file is throwaway
  and is deleted at spec step 5.
- It does not remove vue-cli, `vue.config.js`, Vuex or the decorator libraries.
  That is spec step 5.
- It does not touch the Electron process model (spec D4).
- It does not characterize `ScreenScraperClient` or `boServer.ts`. The spec
  scopes both out of the safety net, with reasons.
- It does not reach 80% coverage. The safety net targets the code where a
  regression would be silent, which is a different goal.
