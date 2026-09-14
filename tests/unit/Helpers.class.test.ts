import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync} from 'fs';
import {join} from 'path';
import {tmpdir, homedir} from 'os';
import Helpers from '@/class/Helpers.class';

// Importing Helpers pulls @electron/remote at module scope. It resolves to
// tests/stubs/electron-remote.ts through the alias in vitest.config.ts; if this
// file fails to import at all, that alias is what to look at.

// Stubbing os.homedir for Helpers.getMameHomePath below.
//
// vi.spyOn(os, 'homedir') does not work here: under Vitest's ESM module
// handling, 'os' is imported as a namespace object whose properties are not
// configurable, so spyOn throws "Cannot redefine property: homedir".
//
// vi.mock('os', ...) does not work either: Node core modules imported by their
// bare specifier ('os') are resolved outside Vitest's mockable module graph, so
// the factory is silently never invoked, verified by adding a console.log
// inside it and seeing it never print.
//
// Mocking 'node:os' (the explicit node: specifier) does get intercepted, and
// Vite/Node resolve 'os' and 'node:os' to the same module id, so this also
// covers Helpers.class.ts's `import * as os from 'os'`, verified by confirming
// Helpers.getFirstExistingDirectory(['~']) resolves against the stubbed
// directory rather than the real home directory once this mock is active.
//
// homedirOverride is a plain mutable box the tests below write into; when it
// is null the mock falls through to the real homedir(), so every test outside
// the getMameHomePath describe block is unaffected.
const homedirOverride: {value: string | null} = {value: null};

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: () => homedirOverride.value ?? actual.homedir(),
    };
});

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
    // getMameHomePath() creates its directory under os.homedir() as a side
    // effect. Calling the real function unstubbed would write into this
    // developer's actual home directory as a side effect of running the test
    // suite, which is not acceptable. os.homedir is redirected to a throwaway
    // temp directory via the module mock above, then reset to null (falling
    // through to the real homedir()) so it cannot leak into other tests.
    let fakeHome: string;

    beforeEach(() => {
        fakeHome = mkdtempSync(join(tmpdir(), 'mame-helpers-home-'));
        homedirOverride.value = fakeHome;
    });

    afterEach(() => {
        homedirOverride.value = null;
        rmSync(fakeHome, {recursive: true, force: true});
    });

    it('returns a path under the stubbed home directory and creates it', () => {
        // Renamed from .mame-awesome-ui/mame-home to a plain .mame on refacto-2026,
        // to separate mame's own home directory from this app's own config/database
        // directory (~/.mame-awesome-ui, see Config.class.ts).
        const expected = join(fakeHome, '.mame');

        const path = Helpers.getMameHomePath();

        expect(path).toBe(expected);
        expect(existsSync(path)).toBe(true);
    });

    it('is idempotent: a second call agrees with the first and does not throw', () => {
        const first = Helpers.getMameHomePath();

        expect(() => Helpers.getMameHomePath()).not.toThrow();
        expect(Helpers.getMameHomePath()).toBe(first);
    });
});
