import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync, statSync} from 'fs';
import {join, relative} from 'path';

// vite-plugin-electron-renderer turns every `require()`d package of the renderer into a generated ES
// module with one `export const <key> = ...` per key of the package. sequelize has a key named
// "DOUBLE PRECISION": the module is then a SyntaxError ("Missing initializer in const declaration")
// and the window stays black, with nothing else in the logs than an unhandled rejection. The
// renderer uses sequelize through sequelize-typescript; only the main process (boServer.ts and
// the Express controllers) may import 'sequelize' itself.
const MAIN_PROCESS_ONLY = new Set(['boServer.ts', 'background.ts']);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            return name === 'api' ? [] : sourceFiles(path);
        }
        return /\.(ts|vue)$/.test(name) ? [path] : [];
    });
}

describe('renderer imports', () => {
    it("never import 'sequelize' directly (it breaks the generated renderer module)", () => {
        const src = join(__dirname, '../../src');
        const offenders = sourceFiles(src)
            .filter(path => !MAIN_PROCESS_ONLY.has(relative(src, path)))
            .filter(path => /from\s+['"]sequelize['"]/.test(readFileSync(path, 'utf8')))
            .map(path => relative(src, path));
        expect(offenders).toEqual([]);
    });
});

// boServer.ts runs in the main process. Whatever it imports (through '@/...') loads there too, and
// two things must not: @electron/remote (renderer only, see boServer.ts's header comment), and
// electron-log - the renderer's electron-log requires it in the main process by itself, and with it
// already loaded at startup the renderer fails with an unhandled "An object could not be cloned"
// rejection at every start. Take a logger as a parameter instead (see Migrations.ts).
describe('modules loaded by the main process', () => {
    const src = join(__dirname, '../../src');

    function importedModules(file: string, seen = new Set<string>()): Set<string> {
        seen.add(file);
        const source = readFileSync(file, 'utf8');
        for (const [, target] of source.matchAll(/from\s+'@\/([^']+)'/g)) {
            const path = [join(src, target + '.ts'), join(src, target, 'index.ts')].find(candidate => {
                try {
                    return statSync(candidate).isFile();
                } catch {
                    return false;
                }
            });
            if (path && !seen.has(path)) {
                importedModules(path, seen);
            }
        }
        return seen;
    }

    it('do not load electron-log or @electron/remote', () => {
        const modules = importedModules(join(src, 'boServer.ts'));
        // The walk really follows the imports (Migrations.ts is imported by boServer.ts directly,
        // Config.class.ts too), so an empty result below means clean, not blind.
        expect(modules).toContain(join(src, 'class/Migrations.ts'));
        expect(modules.size).toBeGreaterThan(10);
        const offenders = [...modules]
            .filter(path => /from\s+['"](electron-log|@electron\/remote)['"]|import\s+\*\s+as\s+\w+\s+from\s+['"]electron-log['"]/
                .test(readFileSync(path, 'utf8')))
            .map(path => relative(src, path));
        expect(offenders).toEqual([]);
    });
});
