import {chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync} from 'fs';
import {join} from 'path';
import * as os from 'os';
import {decryptSecret, encryptSecret, isEncryptedSecret} from '@/class/SecretBox';
import {parseUiModeSetting, type UiModeSetting} from '@/class/UiMode';
import {parseDisplayModeSetting, type DisplayModeSetting} from '@/class/DisplayMode';
import {parseUpdateChannel, type UpdateChannel} from '@/class/ReleaseList';
import {parseVideoOutputSetting} from '@/class/VideoOutput';
import {FOLLOW_SCREEN, parseAudioOutputSetting} from '@/class/AudioOutput';
import {DEFAULT_UI_SOUNDS_VOLUME, parseDisabledUiSounds, type UiSoundToggle} from '@/class/UiSounds';
import {parseVolumePercent} from '@/class/Volume';

// Held encrypted in the config file (see SecretBox.ts). Identifiers (ssDevId, ssUserId) stay in
// the clear: they are shown back in the BO forms, the passwords are not.
const SECRET_FIELDS = ['ssDevPassword', 'ssUserPassword'] as const;
const FILE_MODE = 0o600;

// This app's own state directory - separate from ~/.mame (see Helpers.getMameHomePath()),
// which belongs to mame itself, not to mame-awesome-ui. Config/DB live here rather than under
// NODE_ENV-dependent locations (Electron's userData in production, the repo root in dev):
// there's no upside to splitting an app's own state across two different places depending on
// how it's run, and using the same fixed path in dev and production keeps behavior identical
// between the two instead of only exercising the production path once packaged.
function getAppDataPath(): string {
    const path = join(os.homedir(), '.mame-awesome-ui');
    if (!existsSync(path)) {
        mkdirSync(path, {recursive: true});
    }
    return path;
}

// User avatars used to live wherever the BO's setup form pointed avatarsPath at, requiring it
// to be browsed to and created by hand before it could be used. Fixed under the app's own data
// directory instead, created eagerly like getAppDataPath() itself, so it always exists with
// zero setup.
function getAvatarsPath(): string {
    const path = join(getAppDataPath(), 'avatars');
    if (!existsSync(path)) {
        mkdirSync(path, {recursive: true});
    }
    return path;
}

export default class Config {
    public mamePath: string = '';
    public mameBinaryName: string =  '';
    public readonly avatarsPath: string = getAvatarsPath();

    // ScreenScraper API (screenscraper.fr) credentials, used to fetch marquees/artworks.
    public ssDevId: string = '';
    public ssDevPassword: string = '';
    public ssSoftName: string = '';
    public ssUserId: string = '';
    public ssUserPassword: string = '';

    // No starting-pack repository settings: its URL and credentials come from ONLINE mode (see
    // RepositoryAuth.ts). The repoUrl/repoUser/repoPassword keys of older files are dropped at the
    // next save().

    // Preferred bezel aspect ratio when fetching bezel artwork from ScreenScraper - 16:9 default
    // since new cabinet builds mostly use widescreen LCD monitors rather than 4:3 CRTs.
    public bezelAspect: '4:3' | '16:9' = '16:9';

    // Whether to auto-open Chromium DevTools on startup, in dev mode (electron:serve). Defaults
    // to false - opt in explicitly, either via the BO config form or by editing the config file.
    public openDevTools: boolean = false;

    // Whether Home.vue puts the window in full screen once launched - dev and production alike,
    // the BO setting is authoritative either way. Defaults to false (windowed): opted into from
    // the MAUI tab once the cabinet is set up. A config file saved before this default changed
    // holds an explicit true (save() always writes the key), so existing cabinets stay fullscreen.
    public fullscreen: boolean = false;

    // Whether the player is asked for a thumbs up / neutral / thumbs down once a game is quit
    // (Home.vue, see GameVote.ts). The vote can always be set from the BO, this only controls the
    // prompt on the cabinet itself.
    public voteEnabled: boolean = true;

    // Whether a thumbs down also takes the game out of mame's favorites (restorable from the BO's
    // "Removed" tab). Off = the game stays, and the BO's Votes tab just lists the ones that
    // weren't liked - what a cabinet builder sorting through a big imported game list wants
    // the other way round.
    public thumbsDownRemovesFavorite: boolean = true;

    // Whether the front offers a newer version of MAUI when it wakes up from idle (Home.vue,
    // FrontUpdate.ts): a player installs it with a thumbs up, without the BO. Off, only the BO's
    // Update card installs one.
    public frontUpdateEnabled: boolean = true;

    // Which versions are offered, on the front and in the idle band (ReleaseList.ts newestAbove()):
    // the releases, or the development builds too (Advanced configuration).
    public updateChannel: UpdateChannel = 'releases';

    // The carousel's categories that are not genres (CarouselCategories.ts buildCarousel()): every
    // game, the games players have a score on ("Beat This!"), and the games whose hiscores
    // can be extracted ("Hiscores Only").
    public showAllGamesCategory: boolean = true;
    public showBeatThisCategory: boolean = true;
    public showHiscoresOnlyCategory: boolean = true;

    // The front with or without its effects (UiMode.ts): "auto" picks Lite on weak hardware.
    public uiMode: UiModeSetting = 'auto';

    // The screen mode of a dedicated cabinet, set when the application starts (DisplayMode.ts):
    // "auto" keeps it at 1080 lines at most, 720 in Lite mode.
    public displayMode: DisplayModeSetting = 'auto';
    // The screen output (an xrandr name, VideoOutput.ts) and the sound output ("card,device",
    // AudioOutput.ts) of a dedicated cabinet; '' leaves them as the system set them.
    public videoOutput: string = '';
    // FOLLOW_SCREEN by default: the HDMI card of the screen output.
    public audioOutput: string = FOLLOW_SCREEN;

    // Minutes without a request before the BO is unloaded from memory (BoOnDemand.ts); its next
    // request loads it again. 0 keeps it loaded once it has been opened.
    public boIdleMinutes: number = 15;

    // The front shows its messages when nobody plays (IdleWatch.ts, MessageBand.vue), after this
    // many minutes without a key on the list of games.
    public frontIdleEnabled: boolean = true;
    public frontIdleMinutes: number = 2;
    // While idle, the list goes to the game each message is about (Home.vue onMessageShown()).
    public frontIdleShowsGames: boolean = true;
    // Left alone this many minutes more, the front falls asleep (IdleWatch.ts): a black screen, and
    // the screen switched off on a dedicated cabinet when frontSleepScreenOff (ScreenPower.ts). 0 =
    // never. Counted from the last key when the idle curtain is switched off.
    public frontSleepMinutes: number = 30;
    public frontSleepScreenOff: boolean = true;
    // How long the launch screen (Home.vue's startGame(), LaunchStage.vue) is shown before MAME is
    // started, the launch sound included, 0 to 30 seconds.
    public launchStageSeconds: number = 2;

    // The games' volume, 0 to 100 (Volume.ts gameVolumeArgs(), passed to MAME at each launch).
    public gamesVolume: number = 100;
    // The front's own sounds (UiSounds.ts): all of them, their volume (0 to 100), and the ones
    // switched off one by one in the BO's Sounds subtab.
    public uiSoundsEnabled: boolean = true;
    public uiSoundsVolume: number = DEFAULT_UI_SOUNDS_VOLUME;
    public uiSoundsDisabled: UiSoundToggle[] = [];

    // The front's ONLINE badge in the top right corner (OnlineBadge.vue): ONLINE / OFFLINE with its
    // dot, or the dot alone, more discreet.
    public onlineBadgeDotOnly: boolean = false;
    // The badge shows the machine's local address 10 seconds every minute (LocalAddress.ts),
    // unless the BO hides it.
    public onlineBadgeHideIp: boolean = false;

    // A player registering on the cabinet itself starts public, their scores in the shared
    // leaderboards (userRegistration.vue). Off by default: they start private, the BO makes them public.
    public cabinetPlayersPublic: boolean = false;

    // The setup guide was told the cabinet stays OFFLINE (SetupSteps.ts): its ONLINE step is done,
    // and the packs are left to install by hand.
    public setupOffline: boolean = false;

    public configPath!: string;
    protected _configLoaded: boolean = false;
    protected _plaintextSecrets: boolean = false;
    // The BO session's data key (see SecretBox.ts): with it, load() decrypts SECRET_FIELDS and
    // save() encrypts them. Without it (the front, a BO route that doesn't touch them), they are
    // carried as stored, so a load()/save() round trip never alters them.
    protected readonly dataKey: Buffer | null;

    public constructor(dataKey: Buffer | null = null) {
        this.configPath = join(getAppDataPath(), 'mame-awesome-ui-config.json');
        this.dataKey = dataKey;
    }

    public exist(): boolean {
        return existsSync(this.configPath);
    }

    public load(): boolean {
        if (existsSync(this.configPath)) {
            const configFile = JSON.parse(readFileSync(this.configPath, 'utf8'));

            this.mamePath = configFile.mamePath;
            this.mameBinaryName = configFile.mameBinaryName;

            this.ssDevId = configFile.ssDevId || '';
            this.ssDevPassword = configFile.ssDevPassword || '';
            this.ssSoftName = configFile.ssSoftName || '';
            this.ssUserId = configFile.ssUserId || '';
            this.ssUserPassword = configFile.ssUserPassword || '';

            this.bezelAspect = configFile.bezelAspect === '4:3' ? '4:3' : '16:9';

            this.openDevTools = configFile.openDevTools === true;
            this.fullscreen = configFile.fullscreen === true;
            this.voteEnabled = configFile.voteEnabled !== false;
            this.thumbsDownRemovesFavorite = configFile.thumbsDownRemovesFavorite !== false;
            this.frontUpdateEnabled = configFile.frontUpdateEnabled !== false;
            this.updateChannel = parseUpdateChannel(configFile.updateChannel);
            this.showAllGamesCategory = configFile.showAllGamesCategory !== false;
            this.showBeatThisCategory = configFile.showBeatThisCategory !== false;
            this.showHiscoresOnlyCategory = configFile.showHiscoresOnlyCategory !== false;
            this.uiMode = parseUiModeSetting(configFile.uiMode);
            this.displayMode = parseDisplayModeSetting(configFile.displayMode);
            this.videoOutput = parseVideoOutputSetting(configFile.videoOutput);
            this.audioOutput = parseAudioOutputSetting(configFile.audioOutput);
            this.boIdleMinutes = Number.isInteger(configFile.boIdleMinutes) && configFile.boIdleMinutes >= 0
                ? configFile.boIdleMinutes
                : 15;
            this.frontIdleEnabled = configFile.frontIdleEnabled !== false;
            this.frontIdleShowsGames = configFile.frontIdleShowsGames !== false;
            this.frontIdleMinutes = Number.isInteger(configFile.frontIdleMinutes) && configFile.frontIdleMinutes >= 1
                ? configFile.frontIdleMinutes
                : 2;
            this.frontSleepMinutes = Number.isInteger(configFile.frontSleepMinutes) && configFile.frontSleepMinutes >= 0
                ? configFile.frontSleepMinutes
                : 30;
            this.frontSleepScreenOff = configFile.frontSleepScreenOff !== false;
            this.launchStageSeconds = Number.isInteger(configFile.launchStageSeconds)
                && configFile.launchStageSeconds >= 0 && configFile.launchStageSeconds <= 30
                ? configFile.launchStageSeconds
                : 2;
            this.uiSoundsEnabled = configFile.uiSoundsEnabled !== false;
            this.gamesVolume = parseVolumePercent(configFile.gamesVolume, 100);
            this.uiSoundsVolume = parseVolumePercent(configFile.uiSoundsVolume, DEFAULT_UI_SOUNDS_VOLUME);
            this.uiSoundsDisabled = parseDisabledUiSounds(configFile.uiSoundsDisabled);
            this.onlineBadgeDotOnly = configFile.onlineBadgeDotOnly === true;
            this.onlineBadgeHideIp = configFile.onlineBadgeHideIp === true;
            this.cabinetPlayersPublic = configFile.cabinetPlayersPublic === true;
            this.setupOffline = configFile.setupOffline === true;

            this._plaintextSecrets = SECRET_FIELDS.some(field => this[field] !== '' && !isEncryptedSecret(this[field]));
            if (this.dataKey) {
                for (const field of SECRET_FIELDS) {
                    // A value encrypted with another key (a config imported from another cabinet,
                    // whose password differs) can't be recovered: read as unset, to re-enter.
                    if (isEncryptedSecret(this[field])) {
                        this[field] = decryptSecret(this.dataKey, this[field]) ?? '';
                    }
                }
            }

            this._configLoaded = true;
            return true;
        }
        return false;
    }

    public save() {
        const secrets = Object.fromEntries(SECRET_FIELDS.map(field => {
            const value = this[field];
            return [field, this.dataKey && value && !isEncryptedSecret(value)
                ? encryptSecret(this.dataKey, value)
                : value];
        }));
        writeFileSync(
            this.configPath,
            JSON.stringify({
                mamePath: this.mamePath,
                mameBinaryName: this.mameBinaryName,
                ssDevId: this.ssDevId,
                ssDevPassword: secrets.ssDevPassword,
                ssSoftName: this.ssSoftName,
                ssUserId: this.ssUserId,
                ssUserPassword: secrets.ssUserPassword,
                bezelAspect: this.bezelAspect,
                openDevTools: this.openDevTools,
                fullscreen: this.fullscreen,
                voteEnabled: this.voteEnabled,
                thumbsDownRemovesFavorite: this.thumbsDownRemovesFavorite,
                frontUpdateEnabled: this.frontUpdateEnabled,
                updateChannel: this.updateChannel,
                showAllGamesCategory: this.showAllGamesCategory,
                showBeatThisCategory: this.showBeatThisCategory,
                showHiscoresOnlyCategory: this.showHiscoresOnlyCategory,
                uiMode: this.uiMode,
                displayMode: this.displayMode,
                videoOutput: this.videoOutput,
                audioOutput: this.audioOutput,
                boIdleMinutes: this.boIdleMinutes,
                frontIdleEnabled: this.frontIdleEnabled,
                frontIdleMinutes: this.frontIdleMinutes,
                frontIdleShowsGames: this.frontIdleShowsGames,
                frontSleepMinutes: this.frontSleepMinutes,
                frontSleepScreenOff: this.frontSleepScreenOff,
                launchStageSeconds: this.launchStageSeconds,
                gamesVolume: this.gamesVolume,
                uiSoundsEnabled: this.uiSoundsEnabled,
                uiSoundsVolume: this.uiSoundsVolume,
                uiSoundsDisabled: this.uiSoundsDisabled,
                onlineBadgeDotOnly: this.onlineBadgeDotOnly,
                onlineBadgeHideIp: this.onlineBadgeHideIp,
                cabinetPlayersPublic: this.cabinetPlayersPublic,
                setupOffline: this.setupOffline,
            }),
            {mode: FILE_MODE},
        );
        // `mode` only applies when the file is created: tightens one written by an older MAUI.
        // A no-op on Windows beyond the read-only bit, where the profile directory's ACL applies.
        chmodSync(this.configPath, FILE_MODE);
    }

    /**
     * Whether the file, as last loaded, held a password in the clear (written by a MAUI older
     * than the encryption) - migrated by the BO at the next sign-in.
     */
    public hasPlaintextSecrets(): boolean {
        return this._plaintextSecrets;
    }

    public loaded() {
        return this._configLoaded;
    }

    /**
     * Delete the config file, if any, so the app falls back to first-run setup.
     */
    public delete(): void {
        if (existsSync(this.configPath)) {
            unlinkSync(this.configPath);
        }
        this._configLoaded = false;
    }
}
