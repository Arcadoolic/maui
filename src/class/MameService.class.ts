import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import Helpers from '@/class/Helpers.class';
import Config from '@/class/Config.class';
import {parseMameIni, parseFavorites} from '@/class/MameIniParser';
import {execFileSync, ChildProcess, execFile} from 'child_process';

export default class MameService {
    public mameIni: { [key: string]: string[] } = {};
    public uiIni: { [key: string]: string[] } = {};
    public iniPath!: string;

    protected config!: Config;

    protected gameProcess: ChildProcess|null = null;

    /**
     * Load and parse mame.ini and ui.ini file
     * @param config
     * @throws
     */
    public constructor(config: Config) {
        this.config = config;
        // Force mame to read/write everything (ini files, cfg, nvram, snapshots, ...) from a
        // dedicated, stable directory instead of wherever it happens to be launched from.
        this.iniPath = Helpers.getMameHomePath();

        const uiIniPath = join(this.iniPath, 'ui.ini');
        if (!existsSync(uiIniPath)) {
            // -createconfig always writes mame.ini/ui.ini next to cwd, ignoring -inipath/-homepath,
            // so bootstrap the dedicated home directory by running it from there.
            execFileSync(this.mameBinary, ['-createconfig'], {cwd: this.iniPath});
            MameService.forceFullscreenDefault(join(this.iniPath, 'mame.ini'));
        }
        if (!existsSync(uiIniPath)) {
            throw new Error('File missing or failed parsing ' + uiIniPath);
        }

        const mameIniContent = execFileSync(
            this.mameBinary,
            ['-showconfig', ...this.mameHomeArgs],
            {cwd: this.iniPath},
        );
        this.mameIni = parseMameIni(mameIniContent.toString());

        const uiIniContent = readFileSync(uiIniPath, 'utf8');
        this.uiIni = parseMameIni(uiIniContent);
    }

    /**
     * `-createconfig`'s own default for `window` isn't guaranteed to be fullscreen (0) across
     * mame versions/platforms, so force it once, right after a fresh mame.ini is generated - a
     * new cabinet install then boots straight into fullscreen. Only runs on this
     * just-bootstrapped file: once mame.ini exists, this bootstrap branch never runs again, so a
     * later choice (e.g. the BO's "Configuration mame" tab) is never overwritten.
     */
    protected static forceFullscreenDefault(mameIniPath: string): void {
        if (!existsSync(mameIniPath)) {
            return;
        }
        const content = readFileSync(mameIniPath, 'utf8');
        const updated = /^window\s+\S+/m.test(content)
            ? content.replace(/^(window\s+)\S+/m, '$10')
            : `${content.replace(/\s*$/, '')}\nwindow                     0\n`;
        writeFileSync(mameIniPath, updated);
    }

    public get mameBinary() {
        return join(this.config.mamePath, this.config.mameBinaryName);
    }

    /**
     * CLI args forcing mame to use the dedicated home directory for both ini lookup
     * and everything it would otherwise write relative to its own cwd.
     */
    protected get mameHomeArgs(): string[] {
        return ['-inipath', this.iniPath, '-homepath', this.iniPath];
    }

    /**
     * Read, parse and extract romNames from mame favorites.ini file
     */
    public getRomListFromFavorites() {
        const favoritePath = Helpers.getFirstExistingDirectory(
            this.uiIni.ui_path,
            this.iniPath,
            'favorites.ini',
        );
        if (!favoritePath) {
            // No favorites.ini yet (e.g. fresh MAME install, no favorite added) - treat as empty list
            return [];
        }
        return parseFavorites(readFileSync(favoritePath, 'utf8'));
    }

    /**
     * Exec mame with param -lx to get game informations in XML
     * @param romName
     */
    public getGameInformation(romName: string) {
        const parser = new DOMParser();
        const xmlContent = execFileSync(
            this.mameBinary,
            ['-lx', romName, ...this.mameHomeArgs],
            {encoding: 'utf8', cwd: this.iniPath},
        );
        const xml = parser.parseFromString(xmlContent, 'text/xml');
        return {
            manufacturer: xml.getElementsByTagName('manufacturer')[0].innerHTML,
            year: parseInt(xml.getElementsByTagName('year')[0].innerHTML, 10),
            description: xml.getElementsByTagName('description')[0].innerHTML,
        };
    }

    /**
     * Return marquee path
     */
    public get marqueePath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.marquees_directory,
            this.iniPath,
        );
    }

    /**
     * Return flyer path
     */
    public get flyerPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.flyers_directory,
            this.iniPath,
        );
    }

    /**
     * Return logo ("wheel" art) path
     */
    public get logoPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.logos_directory,
            this.iniPath,
        );
    }

    /**
     * Path to genre.ini inside ui.ini's categorypath directory - the game categorization
     * dataset matching the installed mame version. Optional, like marquees/flyers/logos: null
     * until a starting pack import installs it (see boServer.ts's importStartingPack()); callers
     * (GameService.getGameCategories()) treat a missing file as "no categories" rather than
     * failing, which is how the UI falls back to a flat game list (see Home.vue).
     */
    public get genreIniPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.categorypath,
            this.iniPath,
            'genre.ini',
        );
    }

    /**
     * Path to Multiplayer.ini inside ui.ini's categorypath directory - the game player-count
     * dataset matching the installed mame version. Optional, same as genreIniPath: null until a
     * starting pack import installs it; Home.vue hides the player-count display entirely when
     * this is null, instead of showing a default value as if it were known.
     */
    public get nplayersIniPath() {
        return Helpers.getFirstExistingDirectory(
            this.uiIni.categorypath,
            this.iniPath,
            'Multiplayer.ini',
        );
    }

    /**
     * Start game on mame
     * @param romName
     */
    public startGame(romName: string): Promise<ChildProcess> {
        return new Promise(async (resolve, reject) => {
            await this.stopGame();
            this.gameProcess = execFile(this.mameBinary, ['-skip_gameinfo', romName, ...this.mameHomeArgs], {
                killSignal: 'SIGQUIT',
                cwd: this.iniPath,
            }, (error, stdout, stderr) => {
                if (error) {
                    return reject(error);
                }

                if (stderr) {
                    return reject(stderr);
                }
            });
            this.gameProcess.on('close', (e) => {
                this.gameProcess = null;
            });
            resolve(this.gameProcess);
        });
    }

    /**
     * Quit mame process
     */
    public async stopGame(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(this.gameProcess);
            if (!this.gameProcess) {
                return resolve();
            }
            this.gameProcess.kill('SIGQUIT');
            this.gameProcess.on('close', (e) => {
                return resolve();
            });
        });
    }

    /**
     *  Check if mame process is started
     */
    public get isGameStarted(): boolean {
        return (this.gameProcess !== null && this.gameProcess.pid !== 0 && !this.gameProcess.killed);
    }
}
