import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'http';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import {app as electronApp, nativeImage} from 'electron';
import Config from '@/class/Config.class';
import {runMigrations} from '@/class/Migrations';
import {OnlineSession} from '@/class/OnlineSession';
import {flushOutbox} from '@/class/ScoreOutbox';
import {ScoreCapture} from '@/class/ScoreCapture';
import type {FrontGameShower} from '@/class/FrontShowGameBridge';
import {SqliteLeaderboardStore, SqliteScoreStore} from '@/class/SqliteScoreStore';
import {LeaderboardSync} from '@/class/LeaderboardSync';
import {getOnlineAvatarsPath, onlineAvatarFile} from '@/class/OnlineAvatars';
import {avatarForUpload} from '@/class/AvatarForUpload';
import {syncPlayers} from '@/class/PlayerSync';
import {isOnlineActive} from '@/class/RepositoryAuth';
import {readMameVersion} from '@/class/MameVersion';
import {BoOnDemand, type BoApp} from '@/class/BoOnDemand';
import {CABINET_BO_PORT, describeBoUrl} from '@/class/BoUrl';
import {isKioskLayout} from '@/class/KioskRestart';
// Same *TS import shape as Database.class.ts, which is not imported: it pulls in
// GameService.class -> MameService.class -> Helpers.class.ts's @electron/remote import at module
// scope, which would break the main process. The models themselves are electron-free.
import * as SequelizeTS from 'sequelize-typescript';
const Sequelize = SequelizeTS.Sequelize;
type Sequelize = SequelizeTS.Sequelize;
import Category from '@/model/Category.model';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import BoUser from '@/model/BoUser.model';

// What the main process runs for as long as the application does: the database, the ONLINE
// session, the capture of the scores and the shared leaderboards. The BO itself (boServer.ts:
// express, its pages and everything they import) is another matter - nobody opens it for days on
// a cabinet that is set up, so it is only loaded by the first request that reaches its port and
// dropped again once left idle (BoOnDemand.ts). Its port stays open the whole time.

/**
 * Same directory MameService pins mame's ini/home to (see Helpers.getMameHomePath()) - a plain
 * ~/.mame, separate from ~/.mame-awesome-ui (this app's own config/database - see
 * Config.class.ts) since it belongs to mame itself, not to mame-awesome-ui. Duplicated here
 * rather than imported: Helpers.class.ts imports @electron/remote, which the main process cannot.
 */
export function getMameHomePath(): string {
    const homePath = join(os.homedir(), '.mame');
    if (!existsSync(homePath)) {
        mkdirSync(homePath, {recursive: true});
    }
    return homePath;
}

/**
 * Same fixed <home>/.mame-awesome-ui/mame-awesome-ui.sqlite path Database.class.ts uses (see
 * Config.class.ts's getAppDataPath() comment) - kept identical in dev and production. Ensures
 * the parent directory exists itself (sqlite won't create missing intermediate directories),
 * same as Config.class.ts/Database.class.ts's own constructors - doesn't rely on
 * getMameHomePath() having been called first to create it as a side effect.
 */
export function getDatabasePath(): string {
    const appDataPath = join(os.homedir(), '.mame-awesome-ui');
    if (!existsSync(appDataPath)) {
        mkdirSync(appDataPath, {recursive: true});
    }
    return join(appDataPath, 'mame-awesome-ui.sqlite');
}

/**
 * Creates the database if it doesn't exist yet and brings it up to date - what the renderer's
 * Database.install()/update() (Init.vue) does, but run by the main process as soon as the app
 * starts, before any window opens (see background.ts): on a first launch the BO login page is
 * reachable right away, and its bo_user table (created and seeded by a migration) must already
 * be there - Init.vue used to be the only one creating it, racing against the first sign-in.
 * Same base tables as Database.install()'s sync() (bo_user excluded, see its models comment),
 * created only when missing: also repairs a file left empty by a connection opened before any
 * table existed. Never rejects: a failure is logged and Init.vue then tries again itself.
 */
export async function bootstrapDatabase(sequelize: Sequelize): Promise<void> {
    try {
        const tables = await sequelize.getQueryInterface().showAllTables();
        if (!tables.includes('game')) {
            // One by one, referenced tables first (game -> category, hiscore -> game/user).
            for (const model of [Category, Game, User, Hiscore]) {
                await model.sync();
            }
        }
        await runMigrations(sequelize);
    } catch (error) {
        console.error('[boCore] Database bootstrap failed:', error);
    }
}

/** The PNG avatar of a local player and its SHA-256, for MAUI-API (PlayerSync.ts); null without one. */
export function readLocalAvatar(pseudo3: string): {png: Uint8Array; hash: string} | null {
    const file = join(new Config().avatarsPath, `${pseudo3}.png`);
    if (!existsSync(file)) {
        return null;
    }
    // A photo of several megabytes is scaled down first (AvatarForUpload.ts).
    return avatarForUpload(readFileSync(file), (png, width, height) => nativeImage
        .createFromBuffer(Buffer.from(png))
        .resize({width, height, quality: 'best'})
        .toPNG());
}

/** Makes `png` the avatar of a local player: the one of a player created on another cabinet (PlayerSync.ts). */
export function saveLocalAvatar(pseudo3: string, png: Uint8Array): void {
    const avatarsPath = new Config().avatarsPath;
    writeFileSync(join(avatarsPath, `${pseudo3}.png`), png);
    // The PNG replaces the generated default, which would only be left unused.
    rmSync(join(avatarsPath, `${pseudo3}.svg`), {force: true});
}

/**
 * Same sqlite connection Database.class.ts sets up (bootstrapped by bootstrapDatabase() above
 * rather than its install()/update()) - built directly here rather than importing
 * Database.class.ts, which pulls in GameService.class -> MameService.class ->
 * Helpers.class.ts's @electron/remote import at module scope.
 */
export function createSequelize(): Sequelize {
    return new Sequelize({
        dialect: 'sqlite',
        storage: getDatabasePath(),
        models: [Category, Game, User, Hiscore, BoUser],
        logging: false,
    });
}

/**
 * package.json's version plus, for develop builds, "+dev.<short sha>" (see
 * electron.vite.config.ts) - the same string as that build's GitHub prerelease tag, so it is both
 * what the BO header shows and what the releases list matches "version actuelle" against.
 */
export function getRunningVersion(): string {
    const suffix = typeof MAUI_BUILD_VERSION_SUFFIX === 'string' ? MAUI_BUILD_VERSION_SUFFIX : '';
    return electronApp.getVersion() + suffix;
}

/** What the BO's routes share with the rest of the main process. */
export interface BoCore {
    sequelize: Sequelize;
    online: OnlineSession;
    scores: ScoreCapture;
    scoreStore: SqliteScoreStore;
    leaderboards: LeaderboardSync;
    // PNGs MAUI-API refused (too big...): not sent again during this run.
    refusedAvatars: Set<string>;
}

export interface StartedCore extends BoCore {
    databaseReady: Promise<void>;
    bo: BoOnDemand;
    // Where the BO is reached from, as the front shows it (BoUrl.ts).
    getUrl(): string;
    // Closes the BO's port(s).
    close(): void;
}

// How often the idle BO is looked at (BoOnDemand.check()).
const IDLE_CHECK_MS = 60 * 1000;

/**
 * Starts what always runs, and opens the BO's port. `databaseReady` resolves once the database
 * exists and is migrated (see bootstrapDatabase()); BO requests arriving before wait for it.
 * `reloadFront`, `onReset` and `showGameOnFront` are handed to the BO when it is loaded (see createBoApp()).
 */
export function startCore(
    port: number, reloadFront: () => void, onReset: () => void, showGameOnFront: FrontGameShower,
): StartedCore {
    const refusedAvatars = new Set<string>();
    // Single connection for the application's lifetime: sequelize-typescript's static model
    // methods (User.findAll(), etc.) bind to whichever Sequelize instance last registered the
    // model, so this must not be recreated.
    const sequelize = createSequelize();
    const databaseReady = bootstrapDatabase(sequelize);
    // Lot 2.3: the scores of the games played, queued then sent to MAUI-API (ScoreCapture.ts).
    const scoreStore = new SqliteScoreStore(sequelize);
    // Lot 2.4: the shared leaderboards of the games with hiscores, for the front in ONLINE mode.
    const leaderboards = new LeaderboardSync({
        store: new SqliteLeaderboardStore(sequelize),
        avatars: {
            has: hash => existsSync(onlineAvatarFile(hash) ?? ''),
            save: (hash, png) => {
                const file = onlineAvatarFile(hash);
                if (file) {
                    mkdirSync(getOnlineAvatarsPath(), {recursive: true});
                    writeFileSync(file, png);
                }
            },
        },
        romnames: async () => (await Game.findAll({where: {hi: true}, attributes: ['romName']})).map(game => game.romName),
    });
    // Created here so the BO's Online routes can restart it; started and stopped by background.ts.
    const online = new OnlineSession({
        mauiVersion: getRunningVersion(),
        readMameVersion: () => {
            const config = new Config();
            config.load();
            return readMameVersion(config.mamePath && config.mameBinaryName
                ? join(config.mamePath, config.mameBinaryName)
                : '');
        },
        // Also sends the avatars MAUI-API does not have (maui-api D53), and takes those of the
        // players created on another cabinet (maui-api D56).
        syncPlayers: client => syncPlayers(client, readLocalAvatar, refusedAvatars, saveLocalAvatar),
        flushScores: client => flushOutbox(scoreStore, client),
        refreshLeaderboards: client => leaderboards.refresh(client),
    });
    const scores = new ScoreCapture({
        mameHome: getMameHomePath,
        enabled: isOnlineActive,
        players: () => User.findAll(),
        store: scoreStore,
        startupId: () => online.getStatus().startupId,
        flush: () => void online.flushScoresNow(),
        log: message => console.warn(message),
    });
    const core: BoCore = {sequelize, online, scores, scoreStore, leaderboards, refusedAvatars};

    const bo = new BoOnDemand({
        // A chunk of its own in the main process's build: express and the rest are not even read
        // from the disk before this.
        load: async (): Promise<BoApp> => {
            const {createBoApp} = await import('@/boServer');
            return createBoApp(core, databaseReady, reloadFront, onReset, showGameOnFront);
        },
        idleMs: () => {
            const config = new Config();
            config.load();
            return config.boIdleMinutes * 60 * 1000;
        },
        log: message => console.log(message),
    });
    const onRequest = (req: IncomingMessage, res: ServerResponse) => void bo.handle(req, res);
    const server = createServer(onRequest);
    // The BO is reachable from the whole LAN (no host argument): see its session guard.
    server.listen(port, () => {
        console.log(`BO port open on http://localhost:${port} (loaded by its first request)`);
    });
    // A dedicated cabinet also answers on port 80, so that its address is all there is to type.
    // An unprivileged process only gets that port where the system allows it (maui-cabinets sets
    // net.ipv4.ip_unprivileged_port_start): without it, or with the port taken, the BO's own port
    // is the only one and the URL shown says so.
    const cabinet = isKioskLayout(electronApp.isPackaged);
    let cabinetServer: Server | null = null;
    let onCabinetPort = false;
    if (cabinet) {
        cabinetServer = createServer(onRequest);
        cabinetServer.on('error', (error) => {
            onCabinetPort = false;
            console.warn(`BO not reachable on port ${CABINET_BO_PORT}, only on ${port}: ${error.message}`);
        });
        cabinetServer.listen(CABINET_BO_PORT, () => {
            onCabinetPort = true;
            console.log(`BO port open on port ${CABINET_BO_PORT} too`);
        });
    }
    const idleCheck = setInterval(() => bo.check(), IDLE_CHECK_MS);
    // Neither keeps the process alive, nor outlives the port.
    idleCheck.unref();
    server.on('close', () => clearInterval(idleCheck));
    return {
        ...core,
        databaseReady,
        bo,
        getUrl: () => describeBoUrl({cabinet, lanAddress: getLanAddress(), onCabinetPort, port}),
        close: () => {
            server.close();
            cabinetServer?.close();
        },
    };
}

/** This machine's address on the local network, for the BO's URL shown on the cabinet; null offline. */
function getLanAddress(interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string | null {
    for (const addresses of Object.values(interfaces)) {
        const found = addresses?.find(address => address.family === 'IPv4' && !address.internal);
        if (found) {
            return found.address;
        }
    }
    return null;
}
