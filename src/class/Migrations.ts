import {join, resolve as resolvePath} from 'path';
import * as SequelizeTS from 'sequelize-typescript';
const Sequelize = SequelizeTS.Sequelize;
type Sequelize = SequelizeTS.Sequelize;
import {Umzug, SequelizeStorage} from 'umzug';
import {isPackaged} from '@/isPackaged';

/**
 * Where the migration files sit. In production, migrations ship inside app.asar (electron-
 * builder's fixed archive name), not as an extraResources copy: they need to sit alongside
 * node_modules so a migration's own `require('bcryptjs')` (etc.) resolves - Node walks up from
 * the migration file's own directory to find node_modules, and a plain extraResources copy
 * outside the asar has no such ancestor.
 */
export function getMigrationsPath(): string {
    return isPackaged()
        ? join(process.resourcesPath!, 'app.asar', 'migrations')
        : resolvePath('./migrations');
}

/**
 * Where the migrations report to. Passed in rather than imported: boServer.ts (main process) imports
 * this file, and the main process must not load electron-log on its own - the renderer's
 * electron-log requires it there itself, and having it already loaded at startup made the renderer
 * fail with an unhandled "An object could not be cloned" rejection.
 */
export interface MigrationLogger {
    log(message: string): void;
    warn(message: string): void;
    error(...args: unknown[]): void;
}

/**
 * Applies every pending migration of `migrations/` to the database `sequelize` is connected to.
 *
 * Lives outside Database.class.ts (which pulls in GameService -> MameService -> Helpers'
 * @electron/remote import) so both the renderer (Database.update(), on every start) and the BO
 * server (boServer.ts: it has its own connection, and runs on a database an older version of the
 * app may have created) share the one implementation.
 */
export async function runMigrations(
    sequelize: Sequelize, logger: MigrationLogger = console, migrationsPath = getMigrationsPath(),
): Promise<string[]> {
    const queryInterface = sequelize.getQueryInterface();

    const umzug = new Umzug({
        // Same "SequelizeMeta" table and "name" column umzug 2 used, recording the full file
        // name (with its .js extension): databases already migrated by the previous version
        // keep their history instead of replaying every migration.
        storage: new SequelizeStorage({sequelize}),
        context: queryInterface,
        migrations: {
            glob: ['*.js', {cwd: migrationsPath}],
            // Migrations are plain `up(queryInterface, Sequelize)` modules written for
            // umzug 2's positional parameters: keep calling them that way.
            resolve: ({name, path}) => {
                const migration = require(path!);
                const oldStyleDone = () => {
                    throw new Error('Migration tried to use old style "done" callback.');
                };
                return {
                    name,
                    up: async () => migration.up(queryInterface, Sequelize, oldStyleDone),
                    down: async () => migration.down?.(queryInterface, Sequelize, oldStyleDone),
                };
            },
        },
        logger: undefined,
    });

    try {
        const applied = (await umzug.up()).map(migration => migration.name);
        for (const name of applied) {
            logger.log('[Database] Migration "' + name + '\' success.');
        }
        return applied;
    } catch (error) {
        // The renderer (Init.vue) and the BO server both migrate on start, in the same second:
        // the loser of that race fails on the winner's half-written state. Nothing left to apply
        // means the winner got it all done, which is all this call was after.
        if ((await umzug.pending()).length === 0) {
            logger.warn('[Database] Migration error ignored, nothing left to apply (applied by another process).');
            return [];
        }
        logger.error('[Migration] Error on migration.');
        logger.error(error);
        throw error;
    }
}
