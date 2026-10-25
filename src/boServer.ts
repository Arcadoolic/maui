import express, {Request, Response} from 'express';
import session from 'express-session';
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
    statfsSync, statSync, lstatSync,
} from 'fs';
import {join, dirname, sep, basename} from 'path';
import * as os from 'os';
import {randomBytes} from 'crypto';
import {ChildProcess, execFile, execFileSync, spawn} from 'child_process';
import {promisify} from 'util';
import {app as electronApp} from 'electron';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import Config from '@/class/Config.class';
import {BACKUP_PARTS, buildBackup, deleteBackupParts, parseBackupParts, restoreBackup, type BackupPartId} from '@/class/MauiBackup';
import {describeSetup, type SetupFacts, type SetupProgress, type SetupStepId} from '@/class/SetupSteps';
import {readSetupFacts} from '@/class/SetupFacts';
import {renderSetupNavLabel, renderSetupPage} from '@/class/SetupBoPage';
import {
    ensureFirstDirectory, getAvailablePlugins, getFirstExistingDirectory, getMameIniValue, getMameLocations,
    getMissingPlugins, repairPluginIni, resolveDirectoryPath, setMameIniValue, enableRequiredPlugins,
} from '@/class/MameLocations';
import {buildMameBackup, listMameBackupPaths, MAME_BACKUP_PARTS, parseMameBackupParts} from '@/class/MameBackup';
import ScreenScraperClient, {ScreenScraperCredentials} from '@/class/ScreenScraperClient.class';
import {
    addSeqAlternative, browserKeyTokens, browserMouseToken, describeSeqAlternative, parseInputDefaults, parseUiSeqs, removeSeqAlternative, removeTokenFromSeq,
    seqAlternativeKind, seqAlternatives, seqFromAlternatives, type InputDefaults,
} from '@/class/MameInputSeq';
import {parseListFull} from '@/class/MameListFull';
import {
    compareGameFields,
    gameFieldId,
    inputIconKey,
    parseGameFields,
    portTypePlayer,
    readGameCfgInputSeqs,
    removeGameCfgInputSeq,
    GAME_SEQ_TYPES,
    setGameCfgInputSeq,
    type GameField,
    type GameSeqType,
} from '@/class/MameCfg';
import {addFavorite} from '@/class/MameIniParser';
import {
    FavoritesCacheEntry, FavoritesCache, getFavoritesCachePath, readFavoritesCache,
    mergeFavoritesCache, readRemovedFavorites, writeRemovedFavorites, removeFavoriteFromDisk,
    readRomsInfosCache, saveRomInfos, getRomsInfosCachePath,
} from '@/class/FavoritesStore';
import {
    computeBiosSizes, computePackOwnership, groupSelectedGames, isPackFullyOwned, listPackGames, PackGameDetail,
    manifestEntrySizes, PackOwnership,
} from '@/class/PackOwnership';
import {importRepositoryPack, PackGameStore, PackImportTargets} from '@/class/PackImport';
import {verifyRoms} from '@/class/MameVerifyRoms';
import {currentScreenOutput, listScreenOutputs, parseVideoOutputSetting, type ScreenOutputInfo} from '@/class/VideoOutput';
import {
    applyAudioOutput, FOLLOW_SCREEN, listAudioDevices, parseAudioOutputSetting, resolveAudioOutput,
} from '@/class/AudioOutput';
import {
    downloadWindowsInstaller, findInstallAsset, installAppImage, isKioskInstall, isSelfUpdateCapable, isWindowsInstall,
    restartOnInstalledVersion, runWindowsInstaller, type UpdateProgress,
} from '@/class/SelfUpdate';
import {describeUpdateStep} from '@/class/UpdateScreen';
import {findIncompatibleGames, listMachines} from '@/class/RomsetCompatibility';
import {findTooSlowGames, isWeakHardware, parseForcedGames} from '@/class/GameSpeed';
import {decodeXmlEntities} from '@/class/XmlEntities';
import {canRestartKiosk, restartKiosk} from '@/class/KioskRestart';
import {chooseRelaunch, type RelaunchMode} from '@/class/AppRelaunch';
import {hasHiscoreExtraction} from '@/class/HiscoreSupport';
import {readMameVersion, UNKNOWN_MAME_VERSION} from '@/class/MameVersion';
import {
    describeSources, hexDump, type HiscoreReport, type HiscoreRowStatus, inspectHiscores, readHiscoreDatSizes,
    type StoredScore,
} from '@/class/HiscoreInspector';
import {getCategoryDisplayName, getCategoryIconKey} from '@/class/CarouselCategories';
import type {StartingPackManifest} from '@/types/StartingPackManifest';
import {ensureDefaultAvatar, isDefaultAvatar, resetToDefaultAvatar} from '@/class/DefaultAvatar';
import {
    findDeletedUser, listDeletedUsers, restoreDeletedUser, purgeDeletedUser, DeletedUserRow,
} from '@/class/UserReservation';
import {newPseudo3Error} from '@/class/Pseudo3';
import {findAvatarFile, avatarCacheBust} from '@/class/AvatarFiles';
import {Vote, VOTE_DOWN, VOTE_NEUTRAL, VOTE_UP, parseVote, voteFields} from '@/class/GameVote';
import {
    sortByPublishedDesc, formatPublishedAt, isOlderVersion, limitOlderReleases, MAUI_RELEASES_URL, parseUpdateChannel,
} from '@/class/ReleaseList';
import {parseGamepadIds} from '@/class/GamepadId';
import {readCtrlrMapDevices, setCtrlrMapDevice} from '@/class/MameCtrlr';
import {MAUI_KEYS, MAUI_CONTROL_CONTEXTS} from '@/class/MauiControls';
import {
    addInput, describeMauiInput, inputsOfKey, isDefaultKey, isHotkeyKey, keyOfInput, mauiInputId, parseMauiBindings,
    parseMauiInputId, removeInput, resetKey, serializeMauiBindings, type MauiBindings, type MauiInput,
} from '@/class/MauiControlBindings';
import {
    defaultHotkeys, HOTKEY_ACTION_LABELS, HOTKEY_ACTIONS, MAUI_KEY_REF, MAX_HOLD_MS, parseHotkey, sameHotkey, type Hotkey,
    type HotkeyAction,
} from '@/class/Hotkeys';
import {escapeHtml} from '@/class/EscapeHtml';
import {parseUiModeSetting, resolveUiMode, type UiMode} from '@/class/UiMode';
import {parseDisplayModeSetting} from '@/class/DisplayMode';
import {ICON_SVG_ATTRS, renderIconButton} from '@/class/BoIconButton';
import type {FrontGameShower} from '@/class/FrontShowGameBridge';
import type {FrontFavoritesNotifier} from '@/class/FrontFavoritesBridge';
import type {FrontControls} from '@/class/FrontControlsBridge';
import {badgeLabel, describeIdentity} from '@/class/OnlineIndicatorBridge';
import {
    describeFailure, describeOnlineStatus, getOnlineView, onlineIndicator, type OnlineIndicator, resetOnlineSettings, saveConfigurationString, setOnlineEnabled,
    testConnection,
} from '@/class/OnlineSetup';
import {OnlineSession} from '@/class/OnlineSession';
import {readCabinetTables} from '@/class/HiscoreBackfill';
import {describeFlush, queueScores} from '@/class/ScoreOutbox';
import {createOnlineClient} from '@/class/OnlineClient';
import {linkWithPin, registerOnline, type RegistrationOutcome} from '@/class/OnlineRegistration';
import {
    describeOutcomeForBo, renderCreateOnlineFields, renderOnlinePlayerActions, renderOnlinePlayerStatus,
    renderPinReveal, type OnlineBoMessage,
} from '@/class/OnlinePlayersBo';
import type {MauiApiClient, OnlinePlayer} from '@/class/MauiApiClient';
import {canActivateLocally, isDisabledUpstream, playersBlockingOnline} from '@/class/OnlineReconciliation';
import {
    describeRepositoryFailure, describeRepositoryResponse, isOnlineActive, resolveRepository,
    type RepositoryAccess,
} from '@/class/RepositoryAuth';
import {renderOnlineCard} from '@/class/OnlineBoCard';
import {findMameProcesses, isProcessAlive, readProcessArgs, stopMameProcesses} from '@/class/MameProcesses';
import {captureDirFromArgs, captureLaunchArgs, prepareCaptureDir} from '@/class/CaptureDaemon';
import {isSameOriginRequest} from '@/class/SameOrigin';
import {buildStarredFile, MAX_STARRED_FILE_BYTES, parseStarredFile} from '@/class/StarredGamesFile';
import {ONLY_LINK_REASON, renderNetworkCard} from '@/class/NetworkBoCard';
import {renderBluetoothCard} from '@/class/BluetoothBoCard';
import {
    pairBluetooth, readBluetoothState, removeBluetooth, scanBluetooth, setBluetoothPower,
    type BluetoothDevice, type BluetoothState,
} from '@/class/BluetoothControl';
import {connectWifi, forgetWifi, isWifiTheOnlyLink, readNetworkState, setWifiRadio, type NetworkState} from '@/class/WifiControl';
import {getStaticPath} from '@/staticPath';
import {
    getDatabasePath, getMameHomePath, getRunningVersion, type BoCore,
} from '@/boCore';
import type {BoApp} from '@/class/BoOnDemand';
// The models registered on boCore.ts's connection (see its comment on why Database.class.ts is
// not imported in the main process).
import Category from '@/model/Category.model';
import {CONF_PACK_FILENAME, STARTER_PACK_FILENAME, confPackVersion, getMissingConfPackFiles, isGamePack} from '@/class/ConfPack';
import {generateDataKey, unwrapDataKey, wrapDataKey} from '@/class/SecretBox';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import BoUser from '@/model/BoUser.model';
import {UniqueConstraintError, ValidationError} from 'sequelize';

// Augments express-session's own SessionData so req.session.boUserId/etc are typed, instead of
// stashing BO login state in a bespoke cookie/JWT scheme.
declare module 'express-session' {
    interface SessionData {
        boUserId?: number;
        boUsername?: string;
        // "Advanced configuration" mode (see POST /advanced): shows the sections an owner rarely
        // needs (ScreenScraper, Repository, Danger...). Off at every sign-in.
        boAdvanced?: boolean;
        // Data key of the config file's encrypted credentials (hex, see SecretBox.ts), unwrapped
        // at sign-in - the session store is in memory only, so it never reaches the disk.
        secretsKey?: string;
        // Signed in with the default password: every page but /account (and sign-out) redirects
        // there until it is changed, and the credentials stay locked meanwhile.
        mustChangePassword?: boolean;
    }
}

type Tab = 'setup' | 'mame' | 'screenscraper' | 'favorites' | 'users' | 'hiscores' | 'maui' | 'account';
// Who a page is rendered for: 'basic' leaves the Advanced configuration tabs/sections out (see
// POST /advanced), and null (signed out - the login page) gets no nav at all.
type Viewer = 'advanced' | 'basic' | null;
type PathField = 'mamePath' | 'pluginsPath';

interface ScreenScraperValues {
    ssDevId: string;
    ssDevPassword: string;
    ssSoftName: string;
    ssUserId: string;
    ssUserPassword: string;
    bezelAspect: '4:3' | '16:9';
}

// One entry per pack on repo.maui.afronob.com's index.json (generated on the repository side) -
// only the fields the picker actually displays are typed here, not the full manifest.
interface RepoPack {
    filename: string;
    size: number;
    mtime: number;
    generatedAt?: string;
    gameCount?: number;
    // Set by GET /import/from-url/packs: this pack's manifest compared with the roms already
    // installed. Absent when the manifest could not be fetched or holds nothing to compare.
    ownership?: PackOwnership;
    // Its games, for the expandable list (same manifest, same comparison).
    games?: PackGameDetail[];
    // Size of each BIOS/parent set the pack ships, by name (see computeBiosSizes()).
    biosSizes?: Record<string, number>;
}

const MAME_BINARY_NAMES = ['mame.exe', 'mame64.exe', 'mame'];

function findMameBinary(mamePath: string): string|null {
    for (const name of MAME_BINARY_NAMES) {
        if (existsSync(join(mamePath, name))) {
            return name;
        }
    }
    return null;
}

/**
 * Same bootstrap as MameService.class.ts's constructor: mame.ini/ui.ini don't exist until mame
 * writes them via -createconfig at least once. Duplicated here for the usual reason (importing
 * MameService.class.ts would pull in Helpers.class.ts's @electron/remote import) - without it,
 * the BO only ever sees mame.ini/ui.ini once the Electron kiosk window has reached /home at
 * least once (the only other place this bootstrap currently runs), leaving marquees/flyers/
 * favorites unresolvable and /import refusing to work if the BO is used to configure mame on
 * its own.
 */
function ensureMameConfigBootstrapped(mameBinary: string, iniPath: string): void {
    const uiIniPath = join(iniPath, 'ui.ini');
    if (existsSync(uiIniPath)) {
        return;
    }
    // -createconfig always writes mame.ini/ui.ini next to cwd, ignoring -inipath/-homepath, so
    // bootstrap the dedicated home directory by running it from there (same trick
    // MameService.class.ts uses).
    execFileSync(mameBinary, ['-createconfig'], {cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe']});
    if (!existsSync(uiIniPath)) {
        throw new Error(`"${uiIniPath}" not found after -createconfig.`);
    }
    // Same forcing as MameService.class.ts's constructor (the Electron app's own bootstrap
    // path) - see its forceFullscreenDefault() comment for why this can't be left to
    // -createconfig's own default. setMameIniValue() only touches this just-created mame.ini,
    // never a later user/BO preference.
    setMameIniValue(join(iniPath, 'mame.ini'), 'window', '0');
}





/**
 * Filenames currently sitting in Config's fixed avatarsPath (<home>/.mame-awesome-ui/avatars,
 * created eagerly by Config's constructor). Matches the "<pseudo_3>.png" lookup
 * UserService.class.ts/Champions.vue/Hiscores.vue use in the Electron app itself.
 */
function getAvatarFilenames(config: Config): string[] {
    return readdirSync(config.avatarsPath);
}


/**
 * Same ini-line parsing MameService uses for `-showconfig` output. Duplicated for the
 * same reason as getMameHomePath(): importing MameService.class.ts would pull in
 * Helpers.class.ts's @electron/remote import at module scope.
 */
function parseMameIniFile(fileContent: string): { [key: string]: string[] } {
    const target: { [key: string]: string[] } = {};
    const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
    fileContent.split('\n').forEach((line) => {
        if (line[0] === '#') {
            return;
        }
        const data = regex.exec(line.trim());
        if (data) {
            target[data[1]] = data[2].replace(/^"(.*)"$/, '$1').split(';');
        }
    });
    return target;
}


interface MameInfo {
    iniPath: string;
    mameIniPath: string;
    uiIniPath: string;
    pluginIniPath: string;
    romPath: string | null;
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    favoritesPath: string | null;
    genreIniPath: string | null;
    catverIniPath: string | null;
    nplayersIniPath: string | null;
    windowed: boolean;
    pluginsPath: string | null;
    missingPlugins: string[];
    // Full `-showconfig` output, kept around beyond the rompath it's parsed here for. Null
    // whenever -showconfig itself couldn't run (see the catch branch below).
    showConfig: { [key: string]: string[] } | null;
    error?: string;
}

function getMameInfo(config: Config): MameInfo {
    const iniPath = getMameHomePath();
    const mameIniPath = join(iniPath, 'mame.ini');
    const uiIniPath = join(iniPath, 'ui.ini');
    const pluginIniPath = join(iniPath, 'plugin.ini');
    const {
        marqueePath, flyerPath, logoPath, favoritesPath, genreIniPath, catverIniPath, nplayersIniPath,
    } = getMameLocations(iniPath);
    const windowed = getMameIniValue(mameIniPath, 'window') === '1';
    const pluginsPath = getMameIniValue(mameIniPath, 'pluginspath');
    const resolvedPluginsPath = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : null;
    const missingPlugins = getMissingPlugins(pluginIniPath, getAvailablePlugins(resolvedPluginsPath));

    if (!config.mamePath || !config.mameBinaryName) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: 'Configure the mame binary (Config tab) to see the roms path.',
        };
    }

    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: `The binary "${mameBinary}" was not found.`,
        };
    }

    try {
        const output = execFileSync(
            mameBinary,
            ['-showconfig', '-inipath', iniPath, '-homepath', iniPath],
            {cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe']},
        );
        const parsed = parseMameIniFile(output.toString());
        const romPath = ensureFirstDirectory(parsed.rompath, iniPath);
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: parsed,
        };
    } catch {
        return {
            iniPath, mameIniPath, uiIniPath, pluginIniPath, romPath: null, marqueePath, flyerPath, logoPath,
            favoritesPath, genreIniPath, catverIniPath, nplayersIniPath, windowed, pluginsPath, missingPlugins, showConfig: null,
            error: 'Unable to read the mame configuration ("-showconfig" failed).',
        };
    }
}

/**
 * Same favorites.ini parsing as MameService.getRomListFromFavorites(). Duplicated for the
 * same reason as the rest of this file: avoids importing MameService.class.ts, which pulls
 * in Helpers.class.ts's @electron/remote import at module scope.
 */
function getFavoriteRomNames(favoritesPath: string): string[] {
    const regexp = new RegExp(/^(?![0-9]$)[a-z0-9]+$/, 'gm');
    const lines = readFileSync(favoritesPath, 'utf8').split('\n');
    const romNames: string[] = [];
    const seen: { [key: string]: boolean } = {};
    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (regexp.test(line) && !seen[line]) {
            seen[line] = true;
            romNames.push(line);
        }
    });
    return romNames;
}

function extractXmlTagContent(xml: string, tagName: string): string | null {
    const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`).exec(xml);
    return match ? match[1] : null;
}

function extractXmlAttribute(xml: string, tagName: string, attributeName: string): string | null {
    const tagMatch = new RegExp(`<${tagName}\\b[^>]*>`).exec(xml);
    if (!tagMatch) {
        return null;
    }
    const attrMatch = new RegExp(`${attributeName}="([^"]*)"`).exec(tagMatch[0]);
    return attrMatch ? attrMatch[1] : null;
}

/**
 * `.zip` filenames (extension stripped) directly inside romPath, sorted for a stable <select>
 * order. Deliberately readdirSync, not Game.findAll(): renderForm()/its call sites are all
 * synchronous, and the rom dropdowns (see renderRomPicker()) only need romName, not Game's
 * fullname.
 */
function listRomNames(romPath: string): string[] {
    try {
        return readdirSync(romPath)
            .filter(name => name.toLowerCase().endsWith('.zip'))
            .map(name => name.slice(0, -4))
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

let romLabelsCache: {key: string; labels: Map<string, string>} | undefined;

/**
 * Game name (MAME's description, e.g. "Pac-Man (Midway)") by rom name, for the rom selects: one
 * `mame -listfull <rom>...` for the whole folder (~0.1s for a few hundred roms), remembered until
 * the rom list or binary changes since renderForm() runs on every request. A rom MAME doesn't
 * know (or a failing binary) is just absent from the map - callers fall back to the rom name.
 */
function getRomLabels(mameBinary: string, iniPath: string, romNames: string[]): Map<string, string> {
    const key = `${mameBinary}\n${romNames.join(',')}`;
    if (romLabelsCache?.key === key) {
        return romLabelsCache.labels;
    }
    let stdout = '';
    if (romNames.length) {
        try {
            stdout = execFileSync(
                mameBinary,
                ['-listfull', ...romNames, '-inipath', iniPath, '-homepath', iniPath],
                {encoding: 'utf8', cwd: iniPath, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 4 * 1024 * 1024},
            );
        } catch (error) {
            // MAME exits non-zero as soon as one name matches nothing (a stray zip) but still
            // lists the others - keep whatever it printed.
            const partial = (error as {stdout?: string | Buffer}).stdout;
            stdout = partial ? partial.toString() : '';
        }
    }
    const labels = parseListFull(stdout);
    romLabelsCache = {key, labels};
    return labels;
}

/**
 * Roms whose cfg/<rom>.cfg holds a key binding of its own (a standard <newseq>, see
 * MameCfg.ts) - what the rom pickers flag. Not "has a cfg file" as such: MAME writes one for
 * nearly every game ever launched (mixer settings alone), so that would mark almost every game.
 */
function listRomsWithInputCfg(iniPath: string, romNames: string[]): Set<string> {
    const withCfg = new Set<string>();
    for (const romName of romNames) {
        const cfgPath = getGameCfgPath(iniPath, romName);
        try {
            const xml = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
            if (xml && GAME_SEQ_TYPES.some(seqType => readGameCfgInputSeqs(xml, seqType).size)) {
                withCfg.add(romName);
            }
        } catch {
            // Unreadable cfg: just not flagged.
        }
    }
    return withCfg;
}

const INPUT_CFG_ICON = '\u{1F3AE}';
const INPUT_CFG_LEGEND = `${INPUT_CFG_ICON} = this game already has its own key configuration (<code>cfg/&lt;rom&gt;.cfg</code>).`;

/**
 * Searchable rom picker: a text field filtering a plain <select> (works without the script, just
 * unfiltered) of game names sorted alphabetically, each flagged with an icon when it has its own
 * input cfg. The script is self-contained (finds its picker through document.currentScript) since
 * several pickers can share the page. Typing turns the select into a short list box so the
 * matches are visible without opening it; every term must appear, accents and case ignored, in
 * the game name or its rom name.
 */
function renderRomPicker(
    selectId: string, romNames: string[], romLabels: Map<string, string>, withCfg: Set<string>, selectedRom?: string,
): string {
    const options = romNames
        .map(romName => ({romName, label: romLabels.get(romName) ?? romName}))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(({romName, label}) => `
            <option value="${escapeHtml(romName)}" data-search="${escapeHtml(`${label} ${romName}`)}"
                ${selectedRom === romName ? 'selected' : ''}>${withCfg.has(romName) ? `${INPUT_CFG_ICON} ` : ''}${escapeHtml(label)}</option>
        `).join('');

    return `
        <div class="rom-picker">
            <label for="${escapeHtml(selectId)}">Game</label>
            <input type="search" class="rom-search" placeholder="Search a game…" autocomplete="off"
                aria-label="Search a game">
            <select id="${escapeHtml(selectId)}" name="romName">${options}</select>
            <p class="info table-search-count rom-search-count" hidden></p>
            <p class="info">${INPUT_CFG_LEGEND}</p>
            <script>(function () {
                var root = document.currentScript.parentNode;
                var search = root.querySelector('.rom-search');
                var select = root.querySelector('select');
                var count = root.querySelector('.rom-search-count');
                // Last game really picked: kept across searches with no result, which empty the select.
                var chosen = select.value;
                var all = Array.prototype.map.call(select.options, function (option) {
                    return {option: option, haystack: fold(option.dataset.search || '')};
                });
                function fold(text) {
                    return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
                }
                function applySearch() {
                    var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                    var matches = all.filter(function (entry) {
                        return terms.every(function (term) { return entry.haystack.indexOf(term) >= 0; });
                    });
                    while (select.firstChild) { select.removeChild(select.firstChild); }
                    matches.forEach(function (entry) { select.appendChild(entry.option); });
                    if (matches.some(function (entry) { return entry.option.value === chosen; })) {
                        select.value = chosen;
                    } else if (matches.length) {
                        select.selectedIndex = 0;
                        chosen = select.value;
                    }
                    select.size = terms.length && matches.length > 1 ? Math.min(matches.length, 8) : 1;
                    count.hidden = terms.length === 0;
                    count.textContent = matches.length
                        ? matches.length + ' game(s) found out of ' + all.length + '.'
                        : 'No game matches this search.';
                }
                select.addEventListener('change', function () { chosen = select.value; });
                search.addEventListener('input', applySearch);
                search.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter') { event.preventDefault(); }
                });
            })();</script>
        </div>
    `;
}

interface GameXmlInfo {
    description: string | null;
    // The name of the separate BIOS set this game needs (mame -lx's `romof` attribute on
    // <machine>), e.g. "neogeo" - null when the game is self-contained.
    biosName: string | null;
    // Names of device romsets this game needs beyond its own zip and biosName's parent set,
    // e.g. "ym2413" for pang - null when the game is self-contained.
    deviceRoms: string[];
}

/**
 * `mame -lx <romName>` lists the target <machine> first, then one <machine isdevice="yes">
 * block per device it uses (device_ref on the target machine names them by tag). Most devices
 * (cpus, screen, speaker, ...) have no <rom> children and don't need a zip of their own - only
 * ones that do (e.g. ym2413's internal instrument ROM) are actual romset dependencies, distinct
 * from biosName's parent-set relationship (e.g. puckman -> pacman).
 */
function getDeviceRomNames(xmlContent: string): string[] {
    const machineBlocks = xmlContent.match(/<machine\b[^>]*>[\s\S]*?<\/machine>/g);
    if (!machineBlocks || machineBlocks.length < 2) {
        return [];
    }
    const [targetBlock, ...deviceBlocks] = machineBlocks;
    const refNames = [...targetBlock.matchAll(/<device_ref\b[^>]*\bname="([^"]*)"/g)].map(match => match[1]);

    const hasRomsByName = new Map<string, boolean>();
    for (const block of deviceBlocks) {
        const nameMatch = /^<machine\b[^>]*\bname="([^"]*)"/.exec(block);
        if (nameMatch) {
            // A ROM without a good dump (status="nodump", namco56's 56xx.bin) has no file to
            // ship: a device with only those needs no zip.
            hasRomsByName.set(nameMatch[1], [...block.matchAll(/<rom\b[^>]*>/g)]
                .some(match => !/\bstatus="nodump"/.test(match[0])));
        }
    }
    return refNames.filter(name => hasRomsByName.get(name));
}

const execFileAsync = promisify(execFile);

/**
 * Same per-rom lookup as MameService.getGameInformation(), but with regex tag/attribute
 * extraction instead of DOMParser: DOMParser is a browser global available in the renderer,
 * not in this main-process server. Asynchronous, not to block the main process meanwhile (the
 * front's IPC goes through it).
 */
async function readGameXmlInfo(mameBinary: string, iniPath: string, romName: string): Promise<GameXmlInfo> {
    try {
        const {stdout} = await execFileAsync(
            mameBinary,
            ['-lx', romName, '-inipath', iniPath, '-homepath', iniPath],
            {encoding: 'utf8', cwd: iniPath, maxBuffer: 64 * 1024 * 1024, windowsHide: true},
        );
        return parseGameXml(stdout);
    } catch {
        return {description: null, biosName: null, deviceRoms: []};
    }
}

function parseGameXml(xmlContent: string): GameXmlInfo {
    return {
        description: extractXmlTagContent(xmlContent, 'description'),
        biosName: extractXmlAttribute(xmlContent, 'machine', 'romof'),
        deviceRoms: getDeviceRomNames(xmlContent),
    };
}

interface FavoriteMediaStatus {
    hasMarquee: boolean;
    hasFlyer: boolean;
    hasLogo: boolean;
}

interface FavoriteRow extends FavoriteMediaStatus {
    romName: string;
    fullname: string;
    biosName: string | null;
    deviceRoms: string[];
    // False when this rom has no entry in the favorites cache yet (being resolved, see
    // updateFavoritesCache()) - fullname then just falls back to romName and biosName/deviceRoms
    // to empty.
    cached: boolean;
}

interface FavoritesInfo {
    rows: FavoriteRow[];
    error?: string;
    // Favorites whose names are being resolved in the background (see updateFavoritesCache()).
    resolving?: {done: number; total: number} | null;
    // Launch count per rom (see loadGameStats()); a rom absent from it, or no map at all (database
    // not migrated yet), shows no count.
    stats?: Map<string, GameStats>;
    // One-shot flash messages after a favorite was removed (POST /favorites/delete).
    notice?: string;
    warning?: string;
}

/**
 * What the database knows about a game (Game.play_count/vote and its category), for the
 * favorites and removed favorites lists. Soft-deleted games included: a game taken out of the
 * favorites (thumbs down, or removed from the BO) keeps its history.
 */
interface GameStats {
    romName: string;
    fullname: string;
    playCount: number;
    vote: Vote;
    // Starred: in the cabinet's "My favourites", and voted thumbs up.
    starred: boolean;
    // Scores of the cabinet's players saved for it (hiscore table).
    hasPlayerScores: boolean;
    // The game's carousel category (TTL twin merged, as displayed on the cabinet), null when
    // genre.ini doesn't know it.
    category: GameCategory | null;
}

interface GameCategory {
    name: string;
    iconKey: string;
}

/**
 * Every game's GameStats by rom name, or null when the database can't be read (no file yet, or
 * not migrated yet - same race as /login): callers then just leave
 * these columns out instead of breaking the whole Games tab.
 */
async function loadGameStats(): Promise<Map<string, GameStats> | null> {
    try {
        const games = await Game.findAll({
            attributes: ['id_game', 'romName', 'fullname', 'play_count', 'vote', 'starred', 'id_category'],
            paranoid: false,
        });
        const scoredGames = new Set((await Hiscore.findAll({attributes: ['id_game'], group: ['id_game'], raw: true}))
            .map(hiscore => hiscore.id_game));
        const categories = new Map((await Category.findAll()).map(category => [category.id_category, {
            name: getCategoryDisplayName(category.name),
            iconKey: getCategoryIconKey(category.name),
        }]));
        return new Map(games.map(game => [game.romName, {
            romName: game.romName,
            fullname: game.fullname || game.romName,
            playCount: game.play_count || 0,
            vote: parseVote(game.vote) ?? VOTE_NEUTRAL,
            starred: !!game.starred,
            hasPlayerScores: scoredGames.has(game.id_game),
            category: categories.get(game.id_category) ?? null,
        }]));
    } catch {
        return null;
    }
}

interface FavoritesContext {
    romNames: string[];
    mameBinary: string;
    iniPath: string;
    marqueePath: string | null;
    flyerPath: string | null;
    logoPath: string | null;
    // The .png files of each of the three folders, listed once: a check per favorite and per
    // folder costs too much on a cabinet's SD card.
    marqueeFiles: Set<string>;
    flyerFiles: Set<string>;
    logoFiles: Set<string>;
}

/** The names of a folder's files, lower-cased; none when there is no folder (or it is unreadable). */
function listFileNames(path: string | null): Set<string> {
    if (!path) {
        return new Set();
    }
    try {
        return new Set(readdirSync(path).map(name => name.toLowerCase()));
    } catch {
        return new Set();
    }
}

/**
 * Every cheap (fs/config) check getFavoritesInfo used to do up front, split out on its own so a
 * caller can start streaming a response immediately after this resolves, instead of only after
 * every favorite's slow `mame -lx` lookup (see resolveFavorites()) has also run.
 */
function getFavoritesContext(config: Config): FavoritesContext | {error: string} {
    const iniPath = getMameHomePath();
    const {marqueePath, flyerPath, logoPath, favoritesPath} = getMameLocations(iniPath);

    if (!favoritesPath) {
        return {error: 'No game in the list yet - add some from the MAME menu (Tab in game: Add to favorites).'};
    }

    const romNames = getFavoriteRomNames(favoritesPath);
    if (!romNames.length) {
        return {error: 'The favorites.ini file contains no favorites yet.'};
    }

    if (!config.mamePath || !config.mameBinaryName) {
        return {error: 'Configure the mame binary in the MAME tab to display the games\' names.'};
    }
    const mameBinary = join(config.mamePath, config.mameBinaryName);
    if (!existsSync(mameBinary)) {
        return {error: `The binary "${mameBinary}" was not found.`};
    }

    return {
        romNames, mameBinary, iniPath, marqueePath, flyerPath, logoPath,
        marqueeFiles: listFileNames(marqueePath),
        flyerFiles: listFileNames(flyerPath),
        logoFiles: listFileNames(logoPath),
    };
}

/**
 * Cheap (no `mame -lx`, folders listed once by getFavoritesContext()) marquee/flyer/logo presence
 * check for one favorite, so badges are always live even when the name/BIOS cache is stale.
 */
function getFavoriteMediaStatus(context: FavoritesContext, romName: string): FavoriteMediaStatus {
    const file = romName.toLowerCase() + '.png';
    return {
        hasMarquee: context.marqueeFiles.has(file),
        hasFlyer: context.flyerFiles.has(file),
        hasLogo: context.logoFiles.has(file),
    };
}

/**
 * A favorite's row, its fullname/biosName/deviceRoms from the favorites cache (no `mame -lx` call) -
 * falls back to the bare romName/null/empty when this rom isn't in the cache yet (cached: false).
 */
function favoriteRowFromCache(context: FavoritesContext, romName: string, cache: FavoritesCache | null): FavoriteRow {
    const entry = cache?.entries[romName];
    return {
        romName,
        fullname: entry?.fullname || romName,
        biosName: entry?.biosName ?? null,
        deviceRoms: entry?.deviceRoms ?? [],
        cached: !!entry,
        ...getFavoriteMediaStatus(context, romName),
    };
}

// `mame -version` of the binary, kept by its path and modification time: asked again once replaced.
let knownMameVersion: {binary: string; version: string} | null = null;

async function getMameVersion(mameBinary: string): Promise<string> {
    let binary: string;
    try {
        binary = `${mameBinary}:${statSync(mameBinary).mtimeMs}`;
    } catch {
        return UNKNOWN_MAME_VERSION;
    }
    if (knownMameVersion?.binary !== binary) {
        knownMameVersion = {binary, version: await readMameVersion(mameBinary)};
    }
    return knownMameVersion.version;
}

/**
 * Resolves these favorites' name/BIOS/devices (a `mame -lx` each, one after the other) and adds
 * them to the favorites cache, calling `onEntry` after each one so the caller can report progress.
 * `mameVersion`: given when these are all the favorites, resolved with that MAME.
 */
async function resolveFavorites(
    context: FavoritesContext, romNames: string[], mameVersion?: string,
    onEntry?: (romName: string, entry: FavoritesCacheEntry, index: number) => void,
): Promise<FavoritesCache> {
    const entries: { [romName: string]: FavoritesCacheEntry } = {};
    for (const [index, romName] of romNames.entries()) {
        const {description, biosName, deviceRoms} = await readGameXmlInfo(context.mameBinary, context.iniPath, romName);
        entries[romName] = {fullname: description || romName, biosName, deviceRoms};
        onEntry?.(romName, entries[romName], index);
    }
    return mergeFavoritesCache(entries, mameVersion);
}

// The favorites being resolved in the background (see updateFavoritesCache()), null when none are.
let favoritesResolution: {done: number; total: number} | null = null;

// At most this many favorites are resolved before the Games tab is shown; more go to the background.
const FAVORITES_RESOLVED_INLINE = 5;

/**
 * Brings the favorites cache up to date for the Games tab: the favorites it doesn't know yet
 * (added from MAME's own menu: a pack import resolves its own games) and, when the MAME version
 * changed, all of them again. A few are resolved before the page is shown; more in the background,
 * the page saying so and showing the names it has meanwhile.
 */
async function updateFavoritesCache(context: FavoritesContext): Promise<FavoritesCache | null> {
    const cache = readFavoritesCache();
    if (favoritesResolution) {
        return cache;
    }
    const mameVersion = await getMameVersion(context.mameBinary);
    const knownVersion = mameVersion === UNKNOWN_MAME_VERSION ? undefined : mameVersion;
    const outdated = !cache || (!!knownVersion && cache.mameVersion !== knownVersion);
    const romNames = outdated ? context.romNames : context.romNames.filter(romName => !cache.entries[romName]);
    const version = outdated ? knownVersion : undefined;
    if (!romNames.length) {
        return cache;
    }
    if (romNames.length <= FAVORITES_RESOLVED_INLINE) {
        return resolveFavorites(context, romNames, version);
    }
    const progress = {done: 0, total: romNames.length};
    favoritesResolution = progress;
    resolveFavorites(context, romNames, version, (_romName, _entry, index) => {
        progress.done = index + 1;
    }).catch(() => undefined).finally(() => {
        favoritesResolution = null;
    });
    return cache;
}

/**
 * After a starting pack import (ZIP upload or repository), which just rewrote favorites.ini:
 * resolves the new games' names/BIOS now, a progress bar on one line moving with each game (a
 * `mame -lx` each, seconds on a Raspberry Pi: without it the page seemed stuck). It stays on the
 * page, `finishImportProgress()` saying what comes next. The caller has already sent the response
 * head.
 */
async function streamFavoritesRefreshAfterImport(res: Response, config: Config): Promise<void> {
    const context = getFavoritesContext(config);
    if ('error' in context) {
        res.write(`<section class="card"><h2>Updating MAME Favorites…</h2>
            <p class="info">Favorites not updated: ${escapeHtml(context.error)}</p></section>`);
        return;
    }
    const cache = readFavoritesCache();
    const romNames = context.romNames.filter(romName => !cache?.entries[romName]);
    res.write(`
        <section class="card">
            <h2>Updating MAME Favorites…</h2>
            <div class="import-progress" id="favoritesUpdate">
                <div class="progress-label"><span data-label>Resolving the names of ${romNames.length} new game(s)…</span>
                    <span data-percent></span></div>
                <div class="progress-track"><div class="progress-fill${romNames.length ? '' : ' progress-done'}" data-fill
                    style="width: ${romNames.length ? 0 : 100}%"></div></div>
            </div>
            <script>
            window.mauiFavoritesUpdate = function (done, total, label, waiting) {
                var root = document.getElementById('favoritesUpdate');
                var fill = root.querySelector('[data-fill]');
                fill.style.width = (total ? 100 * done / total : 100) + '%';
                fill.classList.toggle('progress-indeterminate', !!waiting);
                fill.classList.toggle('progress-done', done >= total && !waiting);
                root.querySelector('[data-label]').textContent = label;
                root.querySelector('[data-percent]').textContent = total && !waiting ? done + ' / ' + total : '';
            };
            </script>
        </section>
    `);
    // Asked now, while the page waits anyway: the games list asks for it (updateFavoritesCache()).
    const mameVersion = await getMameVersion(context.mameBinary);
    if (!romNames.length) {
        return;
    }
    const update = (done: number, label: string): void => {
        res.write(`<script>mauiFavoritesUpdate(${done},${romNames.length},${JSON.stringify(label).replace(/</g, '\\u003c')})</script>`);
    };
    // A first cache holds every favorite: it is from this MAME.
    await resolveFavorites(context, romNames, cache || mameVersion === UNKNOWN_MAME_VERSION ? undefined : mameVersion,
        (romName, entry, index) => update(index + 1, entry.fullname));
    update(romNames.length, `${romNames.length} name(s) resolved`);
}

/** The favorites step's bar (streamFavoritesRefreshAfterImport()) saying what the page does next. */
function finishImportProgress(res: Response, label: string): void {
    res.write(`<script>window.mauiFavoritesUpdate && mauiFavoritesUpdate(1, 1, ${JSON.stringify(label)}, true)</script>`);
}

// The BO account's seeded password (see migrations/20260917061122-create-bo-user.js), public by
// definition: never accepted as a new password, and forced to be changed at sign-in.
const DEFAULT_BO_PASSWORD = 'puckman';
// The BO's only account (BoUser.model.ts): signing in asks for its password alone.
const BO_USERNAME = 'puckman';
// The wrapped data key (SecretBox.ts) can be brute-forced offline from a copy of the database,
// only the password's length and scrypt's cost stand in the way.
const MIN_BO_PASSWORD_LENGTH = 8;
// bcrypt cost of the BO password hash. A hash made with a lower one (older MAUI: 10) is redone at
// the next sign-in, while the password is at hand.
const BO_PASSWORD_BCRYPT_ROUNDS = 12;

// Development only: `MAIN_VITE_BO_NO_PASSWORD=1` in maui's .env (read by electron-vite) signs the BO
// in without its password, from this machine only. Never in a packaged build: import.meta.env.DEV
// is false there, and signInWithoutPassword() checks isPackaged again.
const DEV_NO_PASSWORD = import.meta.env.DEV && import.meta.env.MAIN_VITE_BO_NO_PASSWORD === '1';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Signs this request's session in as the BO account, without a password, when DEV_NO_PASSWORD
 * allows it. The credentials stay locked (no password to unwrap them with, see unlockSecrets()).
 */
async function signInWithoutPassword(req: Request): Promise<boolean> {
    if (!DEV_NO_PASSWORD || electronApp.isPackaged || !LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) {
        return false;
    }
    const boUser = await BoUser.findOne({where: {username: BO_USERNAME}}).catch(() => null);
    if (!boUser) {
        return false;
    }
    req.session.boUserId = boUser.id;
    req.session.boUsername = boUser.username;
    req.session.boAdvanced = false;
    return true;
}

function getSecretsKey(req: Request): Buffer | null {
    return req.session.secretsKey ? Buffer.from(req.session.secretsKey, 'hex') : null;
}

/**
 * Unlocks the config file's credentials for this session: unwraps boUser's data key with
 * `password` - or creates one (first sign-in since the encryption, or a key wrapped with another
 * password, e.g. a database imported from another cabinet: what it encrypted is then lost, to
 * re-enter) - then encrypts whatever password the config file still holds in the clear.
 */
async function unlockSecrets(req: Request, boUser: BoUser, password: string): Promise<void> {
    let dataKey = boUser.secretsKey ? unwrapDataKey(password, boUser.secretsKey) : null;
    if (!dataKey) {
        dataKey = generateDataKey();
        boUser.secretsKey = wrapDataKey(password, dataKey);
        await boUser.save();
    }
    req.session.secretsKey = dataKey.toString('hex');

    const config = new Config(dataKey);
    if (config.load() && config.hasPlaintextSecrets()) {
        config.save();
    }
}

/**
 * `value` attribute of a password field: never the stored password itself (it would sit in the
 * page source), only a hint that one is saved - an empty submission keeps it.
 */
function renderSavedPasswordAttributes(saved: string): string {
    return saved ? 'value="" placeholder="Saved - leave empty to keep it"' : 'value=""';
}

function hasScreenScraperCredentials(config: Config): boolean {
    return !!(config.ssDevId && config.ssDevPassword && config.ssSoftName
        && config.ssUserId && config.ssUserPassword);
}

interface DownloadSummary {
    alreadyComplete: number;
    downloaded: number;
    notFound: number;
    noMedia: number;
    // Games whose publisher/developer were written to roms-infos-cache.json.
    infosSaved: number;
    errors: string[];
    stoppedForQuota: boolean;
}

/**
 * Downloads the missing marquee/flyer/logo for every favorite that doesn't already have all
 * three, and records each game's publisher/developer in roms-infos-cache.json (see
 * saveRomInfos()) from the same ScreenScraper answer. Never re-fetches a game that already has
 * all three on disk and its infos cached - the ScreenScraper call is skipped entirely for those,
 * to keep API usage to the minimum needed.
 */
async function downloadMissingFavoriteMedia(
    credentials: ScreenScraperCredentials,
    marqueePath: string,
    flyerPath: string,
    logoPath: string,
    rows: ({romName: string} & FavoriteMediaStatus)[],
    onProgress: (line: string) => void = () => {},
): Promise<DownloadSummary> {
    const summary: DownloadSummary = {
        alreadyComplete: 0, downloaded: 0, notFound: 0, noMedia: 0, infosSaved: 0, errors: [],
        stoppedForQuota: false,
    };
    const client = new ScreenScraperClient(credentials);
    const cachedInfos = readRomsInfosCache()?.entries ?? {};

    for (const row of rows) {
        const mediaComplete = row.hasMarquee && row.hasFlyer && row.hasLogo;
        if (mediaComplete && cachedInfos[row.romName]) {
            summary.alreadyComplete++;
            onProgress(`${row.romName}: already complete, skipped.`);
            continue;
        }

        const result = await client.fetchGameMedia(row.romName);

        if (result.status === 'quota-exceeded') {
            summary.stoppedForQuota = true;
            summary.errors.push(`${row.romName}: ScreenScraper quota exceeded, processing stopped.`);
            onProgress(`${row.romName}: ScreenScraper quota exceeded, processing stopped.`);
            break;
        }
        if (result.status === 'not-found') {
            summary.notFound++;
            onProgress(`${row.romName}: not found on ScreenScraper.`);
            continue;
        }
        if (result.status === 'error') {
            summary.errors.push(`${row.romName}: ${result.message}`);
            onProgress(`${row.romName}: error (${result.message}).`);
            continue;
        }

        saveRomInfos(row.romName, result.infos);
        summary.infosSaved++;
        if (mediaComplete) {
            // Called only for the publisher/developer: the artwork was already all on disk.
            onProgress(`${row.romName}: publisher ${result.infos.publisher ?? 'unknown'} saved, `
                + 'artwork already complete.');
            continue;
        }

        const downloadedKinds: string[] = [];
        const failedKinds: string[] = [];
        if (!row.hasMarquee && result.media.marqueeUrl) {
            const download = await client.downloadMedia(
                result.media.marqueeUrl, join(marqueePath, row.romName + '.png'), 'marquee',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
                downloadedKinds.push('marquee');
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
                failedKinds.push('marquee');
            }
        }
        if (!row.hasFlyer && result.media.flyerUrl) {
            const download = await client.downloadMedia(
                result.media.flyerUrl, join(flyerPath, row.romName + '.png'), 'flyer',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
                downloadedKinds.push('flyer');
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
                failedKinds.push('flyer');
            }
        }
        if (!row.hasLogo && result.media.logoUrl) {
            const download = await client.downloadMedia(
                result.media.logoUrl, join(logoPath, row.romName + '.png'), 'logo',
            );
            if (download.status === 'ok') {
                summary.downloaded++;
                downloadedKinds.push('logo');
            } else {
                summary.errors.push(`${row.romName}: ${download.message}`);
                failedKinds.push('logo');
            }
        }

        if (!downloadedKinds.length && !failedKinds.length) {
            // Found on ScreenScraper, but no marquee/flyer/logo available for it (e.g. a
            // "notgame" driver entry like a BIOS/device, or media simply not uploaded yet).
            summary.noMedia++;
            onProgress(`${row.romName}: found, but no artwork available.`);
        } else {
            const parts: string[] = [];
            if (downloadedKinds.length) {
                parts.push(`${downloadedKinds.join(' and ')} downloaded`);
            }
            if (failedKinds.length) {
                parts.push(`${failedKinds.join(' and ')} failed`);
            }
            onProgress(`${row.romName}: ${parts.join(', ')}.`);
        }
    }

    return summary;
}

/** One import's block in a streamed page: its title, progress bar and log. */
interface ImportBlock {
    writeLine(line: string): void;
    progress(phase: 'download' | 'import', done: number, total: number): void;
    // Closes the block; `ok` paints the bar.
    close(ok: boolean): void;
}

/**
 * Opens an import's block in an already-`res.writeHead()`'d, already-headed HTML response.
 * hasDownload: the import has a download phase before its games are imported. Tabbed: one panel
 * of the tab card opened by renderImportTabsOpen() instead of a card of its own; `overall.index`
 * is its tab. Panels start hidden, mauiImportTabs.start() shows it.
 */
function openImportBlock(
    res: Response, title: string, hasDownload: boolean, overall?: {index: number; total: number}, tabbed = false,
): ImportBlock {
    const barId = `import-progress-${++importProgressCounter}`;
    const tab = tabbed && overall ? overall.index : null;
    if (tab !== null) {
        res.write(`<div class="import-panel" data-import-panel="${tab}" hidden><h3>${title}</h3>`
            + `${renderImportProgressBar(barId, hasDownload, overall)}${PROGRESS_LOG_OPEN}`
            + `<script>mauiImportTabs.start(${tab})</script>`);
    } else {
        res.write(`<section class="card"><h2>${title}</h2>${renderImportProgressBar(barId, hasDownload, overall)}`
            + PROGRESS_LOG_OPEN);
    }
    const closeBlock = tab !== null ? '</div>' : '</section>';
    const updateBar = (call: string): void => {
        res.write(`<script>mauiImportProgress.${call}</script>`);
    };
    // The page is the only place the log shows, and it goes with the tab: keep a copy on the console.
    console.log(`[boServer] Import: ${title}`);
    return {
        writeLine: (line) => {
            if (line.trim()) {
                console.log(`[boServer] Import: ${line.trim()}`);
                res.write(`<li>${escapeHtml(line)}</li>`);
            }
        },
        progress: (phase, done, total) => {
            updateBar(`update(${JSON.stringify(barId)},${JSON.stringify(phase)},${done},${total})`);
        },
        close: (ok) => {
            updateBar(`finish(${JSON.stringify(barId)},${ok})`);
            res.write(`</ul>${closeBlock}`);
            if (tab !== null) {
                res.write(`<script>mauiImportTabs.finish(${tab},${ok})</script>`);
            }
        },
    };
}

/** How Game/Category rows are written for a pack import (PackImport.ts has no database of its own). */
const packGameStore: PackGameStore = {
    async findOrCreateCategory(name) {
        // The default (paranoid) scope: a soft-deleted category of that name gets a fresh row.
        const [category, created] = await Category.findOrCreate({where: {name}});
        return {id: category.id_category, created};
    },
    async upsertGame(romName, fields) {
        // Soft-deleted rows included: the unique constraint still holds their romName.
        const existing = await Game.findOne({where: {romName}, paranoid: false});
        if (!existing) {
            await Game.create({romName, ...fields} as unknown as Game);
            return;
        }
        if (existing.isSoftDeleted()) {
            await existing.restore();
        }
        await existing.update(fields as unknown as Partial<Game>);
    },
};

/** Where a pack import writes, resolved from the mame configuration as it is now. */
function getPackImportTargets(config: Config): PackImportTargets {
    const mameInfo = getMameInfo(config);
    const iniPath = mameInfo.iniPath;
    const {uiIni, categoryDir} = getMameLocations(iniPath);
    // ui.ini over -showconfig, key by key: the directories ui.ini declares are its own.
    const resolvedIni: { [key: string]: string[] } = {...(mameInfo.showConfig ?? {}), ...uiIni};
    return {
        iniPath,
        romPath: mameInfo.romPath,
        marqueePath: mameInfo.marqueePath,
        flyerPath: mameInfo.flyerPath,
        logoPath: mameInfo.logoPath,
        categoryDir,
        directoryFor: iniKey => ensureFirstDirectory(resolvedIni[iniKey], iniPath),
        // Unlike MameLocations.favoritesPath, null until mame writes the file: a pack is
        // importable on a brand new install, which has no favorites.ini at all yet.
        favoritesPath: () => {
            const existing = uiIni.ui_path ? getFirstExistingDirectory(uiIni.ui_path, iniPath, 'favorites.ini') : null;
            if (existing) {
                return existing;
            }
            const directory = ensureFirstDirectory(uiIni.ui_path, iniPath);
            if (!directory) {
                throw new Error('ui_path not found in ui.ini.');
            }
            return join(directory, 'favorites.ini');
        },
        romsInfosCachePath: getRomsInfosCachePath(),
    };
}

/**
 * Imports the repository's configuration pack (a plain `folders/` ZIP, so the whole file) into
 * an already-headed streamed response.
 */
// The configuration pack version installed last (confPackVersion()), beside the favorites cache.
function getInstalledConfPackPath(): string {
    return join(dirname(getFavoritesCachePath()), 'conf-pack.json');
}

function readInstalledConfPackVersion(): string | null {
    try {
        const {version} = JSON.parse(readFileSync(getInstalledConfPackPath(), 'utf8')) as {version?: unknown};
        return typeof version === 'string' ? version : null;
    } catch {
        return null;
    }
}

/**
 * Installs the repository's configuration pack. `onlyWhenChanged` (before a game pack import):
 * not when the version installed last is the repository's and its files are in place - nothing
 * shows then. Resolves with whether its files are in place afterwards.
 */
async function runConfPackImport(
    res: Response, config: Config, repository: Extract<RepositoryAccess, {ok: true}>, onlyWhenChanged = false,
): Promise<boolean> {
    const version = confPackVersion(await fetchRepoManifest(repository.url, CONF_PACK_FILENAME, repository.headers));
    const installed = (): boolean => !getMissingConfPackFiles(getMameInfo(config)).length;
    if (onlyWhenChanged && version && version === readInstalledConfPackVersion() && installed()) {
        return true;
    }
    const ok = await runRepositoryImport(
        res, config, repository, `Updating the configuration pack… (${escapeHtml(CONF_PACK_FILENAME)})`, CONF_PACK_FILENAME,
    );
    if (ok && version) {
        writeFileSync(getInstalledConfPackPath(), JSON.stringify({version}));
    }
    return installed();
}

/**
 * Imports a pack of the repository, whole or only the games named in `only`, into an
 * already-headed streamed response - caller must have written the page head (renderPageHead()).
 * Whatever happens ends as lines in the import's own block, which this closes: the rest of the
 * page (and res.end()) is left to the caller. Resolves with whether the import went through.
 *
 * The import runs in the app (PackImport.ts) and needs the pack's manifest to say where its
 * files are, which the repository writes (maui-repository's generate-repo-manifests.py).
 */
async function runRepositoryImport(
    res: Response, config: Config, repository: Extract<RepositoryAccess, {ok: true}>, title: string, filename: string,
    only?: string[], overall?: {index: number; total: number}, tabbed = false,
    forcedSlow: ReadonlySet<string> = new Set(),
): Promise<boolean> {
    const block = openImportBlock(res, title, true, overall, tabbed);
    const mameBinary = config.mamePath && config.mameBinaryName ? join(config.mamePath, config.mameBinaryName) : '';
    let ok = false;
    try {
        ok = await importRepositoryPack({
            url: `${repository.url}/${filename}`,
            headers: repository.headers,
            companion: await fetchRepoManifest(repository.url, filename, repository.headers),
            only,
            targets: getPackImportTargets(config),
            store: packGameStore,
            reporter: {line: block.writeLine, progress: block.progress},
            precheckGames: async manifest => (await findPacksIncompatibleGames(config, [manifest]))[0],
            removedGames: () => new Set(readRemovedFavorites().map(item => item.romName)),
            tooSlowGames: manifest => findCabinetTooSlowGames(manifest, forcedSlow),
            verifyRoms: mameBinary && existsSync(mameBinary)
                ? romNames => verifyRoms(mameBinary, getMameInfo(config).iniPath, romNames)
                : undefined,
        });
    } catch (error) {
        block.writeLine(`Import failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
    }
    block.close(ok);
    return ok;
}

let importProgressCounter = 0;

/**
 * Opens the card that holds a multi-pack import: one tab per pack (all known up front, so the bar
 * is complete from the start - a pack's tab stays disabled until its import starts) and the
 * panels runImportScript() then streams into it (`tabbed`). The page follows the pack being
 * imported until the user picks a tab by hand. The caller closes it with '</div></section>'.
 */
function renderImportTabsOpen(packFilenames: string[]): string {
    // The tab only carries its number (the total is in the "Pack N of M" bar above); the pack's
    // name is in data-name, shown in that bar (mauiImportProgress) and as the tab's tooltip.
    const packName = (filename: string): string => escapeHtml(filename.replace(/\.zip$/i, ''));
    const tabs = packFilenames.map((filename, index) =>
        `<button type="button" class="import-tab" data-import-tab="${index}" data-name="${packName(filename)}"`
        + ` title="${packName(filename)}" disabled>${index + 1}</button>`).join('');
    return `
        <section class="card">
            <h2>Import from the repository</h2>
            <div class="progress-label"><span data-overall-label>Pack 1 of ${packFilenames.length} — ${packName(packFilenames[0])}</span></div>
            <div class="progress-track progress-track-thin"><div class="progress-fill" data-overall></div></div>
            <div class="import-tabs" role="tablist">${tabs}</div>
            <div class="import-panels">
        <script>
        window.mauiImportTabs = (function () {
            var picked = false;
            function tab(i) { return document.querySelector('[data-import-tab="' + i + '"]'); }
            function select(i) {
                // The panel shown next is shorter (a pack that just started): the page would shrink
                // under the reader and the browser scroll it up. The panels keep the tallest height.
                var panels = document.querySelector('.import-panels');
                if (panels) {
                    panels.style.minHeight = Math.max(panels.offsetHeight, parseFloat(panels.style.minHeight) || 0) + 'px';
                }
                Array.prototype.forEach.call(document.querySelectorAll('[data-import-tab]'), function (t) {
                    t.classList.toggle('active', t.dataset.importTab === String(i));
                });
                Array.prototype.forEach.call(document.querySelectorAll('[data-import-panel]'), function (panel) {
                    panel.hidden = panel.dataset.importPanel !== String(i);
                    // A hidden log can't scroll: put the newest lines back in view once shown.
                    Array.prototype.forEach.call(panel.querySelectorAll('.progress-log'), function (log) {
                        log.scrollTop = log.scrollHeight;
                    });
                });
            }
            document.addEventListener('click', function (event) {
                var target = event.target.closest ? event.target.closest('[data-import-tab]') : null;
                if (!target || target.disabled) { return; }
                picked = true;
                select(target.dataset.importTab);
            });
            return {
                start: function (i) {
                    tab(i).disabled = false;
                    tab(i).classList.add('running');
                    if (!picked) { select(i); }
                },
                finish: function (i, ok) {
                    tab(i).classList.remove('running');
                    tab(i).classList.add(ok ? 'done' : 'failed');
                }
            };
        })();
        </script>
    `;
}

/**
 * Progress bar(s) for one import run, driven by the `<script>mauiImportProgress.update(...)`
 * lines runImportScript() streams as the script reports its `@@PROGRESS` lines. Bar 1 is the
 * current pack (download, then games imported); the thinner "Pack N of M" bar of the whole batch
 * lives above the tabs (see renderImportTabsOpen()) and is the page's single [data-overall] element,
 * which this helper drives. The helper is (re)defined with each run: it is
 * idempotent, and a streamed page has no other single place to put it.
 */
function renderImportProgressBar(id: string, hasDownload: boolean, overall?: {index: number; total: number}): string {
    return `
        <div class="import-progress" id="${id}" data-download="${hasDownload ? '1' : '0'}"
            data-index="${overall ? overall.index : 0}" data-total="${overall ? overall.total : 1}">
            <div class="progress-label"><span data-label>Starting…</span><span data-percent></span></div>
            <div class="progress-track"><div class="progress-fill progress-indeterminate" data-fill></div></div>
        </div>
        <script>
        window.mauiImportProgress = window.mauiImportProgress || (function () {
            function size(bytes) {
                var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
                var i = 0;
                while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
                return bytes.toFixed(1) + ' ' + units[i];
            }
            function draw(root, label, fraction, overallFraction) {
                var fill = root.querySelector('[data-fill]');
                var known = fraction !== null;
                fill.classList.toggle('progress-indeterminate', !known);
                fill.style.width = known ? (fraction * 100).toFixed(1) + '%' : '';
                root.querySelector('[data-label]').textContent = label;
                root.querySelector('[data-percent]').textContent = known ? Math.round(fraction * 100) + '%' : '';
                var overall = document.querySelector('[data-overall]');
                if (overall && overallFraction !== null) { overall.style.width = (overallFraction * 100).toFixed(1) + '%'; }
                var overallLabel = document.querySelector('[data-overall-label]');
                if (overallLabel) {
                    var packTab = document.querySelector('[data-import-tab="' + root.dataset.index + '"]');
                    overallLabel.textContent = 'Pack ' + (Number(root.dataset.index) + 1) + ' of ' + root.dataset.total
                        + (packTab ? ' \u2014 ' + packTab.dataset.name : '');
                }
            }
            return {
                update: function (id, phase, done, total) {
                    var root = document.getElementById(id);
                    if (!root) { return; }
                    var hasDownload = root.dataset.download === '1';
                    var fraction = total > 0 ? Math.min(done / total, 1) : null;
                    var label = phase === 'download'
                        ? 'Downloading' + (total > 0 ? ' — ' + size(done) + ' / ' + size(total) : ' — ' + size(done))
                        : 'Importing games — ' + done + ' / ' + total;
                    // Download = first half of a pack's own progress, import = second half.
                    var packFraction = fraction === null ? null
                        : hasDownload ? (phase === 'download' ? fraction / 2 : 0.5 + fraction / 2) : fraction;
                    var index = Number(root.dataset.index), count = Number(root.dataset.total);
                    draw(root, label, fraction, packFraction === null ? null : (index + packFraction) / count);
                },
                finish: function (id, ok) {
                    var root = document.getElementById(id);
                    if (!root) { return; }
                    var fill = root.querySelector('[data-fill]');
                    fill.classList.remove('progress-indeterminate');
                    fill.style.width = '100%';
                    fill.classList.add(ok ? 'progress-done' : 'progress-failed');
                    root.querySelector('[data-label]').textContent = ok ? 'Done' : 'Finished with errors — see the log below';
                    root.querySelector('[data-percent]').textContent = '';
                    var overall = document.querySelector('[data-overall]');
                    var index = Number(root.dataset.index), count = Number(root.dataset.total);
                    if (overall) { overall.style.width = ((index + 1) / count * 100).toFixed(1) + '%'; }
                }
            };
        })();
        </script>
    `;
}

function renderPage(body: string, active: Tab, viewer: Viewer, hasSubtabs: boolean = false): string {
    return renderPageHead(active, viewer, hasSubtabs) + body + renderPageTail();
}

function getViewer(req: Request): Viewer {
    return req.session.boAdvanced ? 'advanced' : 'basic';
}

interface Subsection {
    // Short slug, also used as the URL hash so a subtab is directly linkable/bookmarkable and
    // survives a page reload (e.g. after a form POST re-renders the same tab).
    id: string;
    // Kept short - shown as the subtab's own label. The section's existing <h2> (inside html)
    // stays as the longer, fully descriptive heading; nothing about it changes.
    label: string;
    // Complete `<section class="card">...</section>` markup, exactly as a bare renderXCard()
    // call already produces - this just groups and gates visibility of what was previously
    // concatenated straight into the page body.
    html: string;
}

/**
 * Wraps 2+ cards for one primary tab behind a secondary "subtabs" row instead of one long
 * vertically-stacked page - one card's <h2> per subtab, but reachable through a short label
 * instead of scrolling. Client-side only (renderPageTail()'s script shows/hides
 * .subtab-panel elements; every panel is still fully rendered server-side, nothing is fetched
 * on demand) - a full page reload (e.g. after a form POST) still works exactly as before, it
 * just needs the right panel picked back out on load (see that script: URL hash first, then
 * this call's own defaultSectionId, then whichever panel has a message to show).
 * A single section is rendered bare, with no subtabs nav at all - nothing to switch between.
 *
 * defaultSectionId: which section a response is "about", set by the caller from whichever of
 * its own message params is actually filled in (see renderForm()'s own defaultSubtab logic for
 * the reasoning) - not inferred client-side from scanning for .flash content. A section with a
 * standing warning unrelated to what was just submitted (missing plugins...) can
 * carry a .flash of its own at the same time; without this, whichever of those happens to come
 * first in `sections` always wins over the section the just-submitted form actually belongs to.
 */
function renderSubtabbedPage(
    active: Tab, sections: Subsection[], viewer: Viewer, defaultSectionId?: string,
    // Markup shown at the right end of the subtabs row, whichever subtab is open (e.g. the MAME
    // tab's "Launch mame" button).
    navAction = '',
): string {
    if (sections.length <= 1) {
        return renderPage(sections.map(section => section.html).join(''), active, viewer);
    }
    // role="tablist"/"tab"/"tabpanel": unlike the primary nav (real page links), this switches
    // panels client-side within one page - the actual ARIA tabs pattern applies here.
    // aria-selected/tabindex are set to their real values by the tail script's activate(), once
    // it has picked which section to open - every link starts unselected/unreachable-by-Tab here
    // so a screen reader or keyboard user never sees two "tabs" claim to be selected at once
    // before that script runs.
    const nav = `
        <nav class="subtabs" role="tablist" data-default-subtab="${escapeHtml(defaultSectionId || '')}">
            ${sections.map(section => `
                <a href="#${escapeHtml(section.id)}" class="subtab-link" data-subtab="${escapeHtml(section.id)}"
                    role="tab" aria-selected="false" aria-controls="subtab-panel-${escapeHtml(section.id)}"
                    id="subtab-tab-${escapeHtml(section.id)}" tabindex="-1">
                    ${escapeHtml(section.label)}
                </a>
            `).join('')}
        </nav>
    `;
    const bar = navAction ? `<div class="subtabs-bar">${nav}<div class="subtabs-action">${navAction}</div></div>` : nav;
    const panels = sections.map(section => `
        <div class="subtab-panel" data-subtab-panel="${escapeHtml(section.id)}" role="tabpanel"
            id="subtab-panel-${escapeHtml(section.id)}" aria-labelledby="subtab-tab-${escapeHtml(section.id)}">${section.html}</div>
    `).join('');
    return renderPage(bar + panels, active, viewer, true);
}

/**
 * Head/style/header/nav prelude, split out from renderPage() so a route can stream a page in
 * chunks with res.write() (progress feedback for a long-running action) instead of building
 * the whole HTML string before sending anything.
 */
/**
 * Opening tag of a streamed progress log (a `<ul class="progress-log">` that gets one `<li>` per
 * line as the response is written - imports, favorites refresh, media download, self-update).
 * The list is a fixed-height scrollable box (see .progress-log), and a browser never scrolls
 * such a box by itself as content is appended: once the lines overflow it, the box just sat on
 * its first lines while the newest ones - the actual progress, e.g. "Downloaded: 84 MB" -
 * piled up out of sight below, so the log seemed frozen. The inline script keeps it pinned to the
 * bottom as lines arrive; a <script> is valid directly inside a <ul>.
 */
const PROGRESS_LOG_OPEN = '<ul class="progress-log"><script>(function () {'
    + 'var log = document.currentScript.parentNode;'
    + 'new MutationObserver(function () { log.scrollTop = log.scrollHeight; }).observe(log, {childList: true});'
    + '})();</script>';

/**
 * One primary nav link, with `aria-current="page"` alongside the `.active` class it always had -
 * these are real page-loaded links (not a JS tab widget), so a screen reader should hear "current
 * page" the same way a sighted user sees the underline, instead of nothing at all.
 */
/**
 * The setup guide's state (SetupSteps.ts), read from the files. A visitor signed in with the
 * default password is held on /account until it is changed (mustChangePassword), so everywhere
 * else the account step is done; /setup itself is told the truth.
 */
function readSetup(passwordChanged: boolean = true): {facts: SetupFacts; progress: SetupProgress} {
    const config = new Config();
    config.load();
    const facts = readSetupFacts({
        config, mameHomePath: getMameHomePath(), passwordChanged, onlineActive: isOnlineActive(),
    });
    return {facts, progress: describeSetup(facts)};
}

/** "Getting started 3/6" while the setup is not finished; on /setup itself whatever its state. */
function renderSetupNavTab(isActive: boolean): string {
    const {progress} = readSetup();
    if (progress.finished && !isActive) {
        return '';
    }
    return renderNavTabLink('/setup', progress.finished ? 'Getting started' : renderSetupNavLabel(progress), isActive);
}

function renderNavTabLink(href: string, label: string, isActive: boolean): string {
    return `<a href="${href}" class="${isActive ? 'active' : ''}"${isActive ? ' aria-current="page"' : ''}>${label}</a>`;
}

function renderPageHead(active: Tab, viewer: Viewer, hasSubtabs: boolean = false): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <!-- Without it a phone lays the page out at a ~980px desktop width and zooms out, so none
         of the max-width media queries below ever match. -->
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>mame-awesome-ui - Configuration</title>
    <style>
        /* Design tokens (Phase 0 of docs/BO-UX-REVAMP.md): every color/spacing/radius below is
           defined once here and referenced by var() everywhere else in this block, instead of
           the hex literals copy-pasted per render*() function that used to drift apart. */
        :root {
            --bg: #000000;
            /* Cards used to sit on rgba(0,0,0,0.55): fine over the darker parts of the tiled
               background photo, but text contrast could drop under WCAG AA over its brighter
               areas. Raised opacity is the actual accessibility fix; the two-tier surfaces let a
               page still show a little of the background through most cards while the login card
               (the very first thing an unauthenticated/non-technical visitor sees, nothing else
               on screen to anchor it) gets the more opaque one. */
            --surface: rgba(0, 0, 0, 0.82);
            --surface-strong: rgba(0, 0, 0, 0.9);
            --surface-inset: #111111;
            --border: #333333;
            --border-subtle: #222222;
            --text: #ffffff;
            --text-muted: #aaaaaa;
            /* Inactive menu entries (tabs, subtabs, player tabs): lighter than --text-muted, which
               read poorly as grey-on-grey over the translucent capsules. */
            --text-nav: #e0e0e0;
            --accent: #8ab4f8;
            --success: #6bff8a;
            --warn: #ffd166;
            --danger: #ff6b6b;
            --danger-strong: #c0392b;
            --radius-sm: 4px;
            --radius-md: 6px;
            --radius-lg: 8px;
            --space-1: 4px;
            --space-2: 8px;
            --space-3: 16px;
            --space-4: 24px;
            --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
        }
        html {
            min-height: 100%;
            background-color: var(--bg);
            background-image: url('/background.jpg');
            background-size: cover;
            background-repeat: repeat;
            background-position: 0 0;
            /* "cover" is sized on the page's height by default: while a streamed page (updates,
               imports, favorites refresh) keeps growing, the image kept zooming in. Fixed sizes it
               on the viewport instead, so it stays put whatever the page length. */
            background-attachment: fixed;
        }
        /* Visually hidden until focused: a keyboard/screen-reader user tabbing in from the
           address bar can jump straight past the nav to <main> instead of tabbing through every
           top-level tab link first. Sighted mouse users never see it. */
        .skip-link {
            position: absolute;
            top: -40px;
            left: 8px;
            z-index: 100;
            padding: 8px 16px;
            background-color: var(--text);
            color: var(--bg);
            border-radius: var(--radius-sm);
            text-decoration: none;
        }
        .skip-link:focus {
            top: 8px;
        }
        body {
            color: var(--text);
            font-family: sans-serif;
            box-sizing: border-box;
            /* Grows with the viewport (tables like Users/Favorites need the room) instead of
               a fixed 560px that forced .table-wrap's horizontal scrollbar on every page,
               but stays capped so text stays readable on wide desktop windows. */
            max-width: min(1100px, 96vw);
            margin: 0 auto;
            padding: 24px 16px 48px;
        }
        header {
            padding: 16px 0 24px;
            text-align: center;
        }
        header h1 {
            margin: 0;
            font-size: 1.4em;
            line-height: 0;
        }
        .header-home {
            display: inline-block;
        }
        .header-logo {
            width: min(360px, 90vw);
            height: auto;
        }
        /* Fixed top-right corner: the Advanced configuration switch, then the running version. */
        .top-right {
            position: fixed;
            top: 8px;
            right: 12px;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        /* On a phone the fixed corner would sit on top of the centered logo: back in the flow,
           right-aligned above the header instead. */
        @media (max-width: 600px) {
            .top-right {
                position: static;
                justify-content: flex-end;
                padding: 8px 12px 0;
            }
        }
        .app-version {
            color: #ff4d4d;
            font-size: 0.8em;
            font-weight: bold;
        }
        /* ONLINE / OFFLINE next to the version: a dot, haloed green while MAUI-API answers. */
        .online-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 0.8em;
            font-weight: bold;
            text-decoration: none;
        }
        .online-badge::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: currentColor;
        }
        .online-badge.online {
            color: var(--success);
        }
        .online-badge.online::before {
            box-shadow: 0 0 4px 2px rgba(107, 255, 138, 0.6);
            animation: online-halo 2s ease-in-out infinite;
        }
        .online-badge.offline {
            color: var(--danger);
        }
        /* Last heartbeat failed: amber and blinking until the next one gets through. */
        .online-badge.unstable {
            color: var(--warn);
            animation: online-blink 1s ease-in-out infinite;
        }
        /* ONLINE turned off: a hollow grey dot, nothing alarming. */
        .online-badge.off {
            color: var(--text-muted);
        }
        .online-badge.off::before {
            background-color: transparent;
            border: 1.5px solid currentColor;
            box-sizing: border-box;
        }
        @keyframes online-blink {
            50% {
                opacity: 0.25;
            }
        }
        @keyframes online-halo {
            50% {
                box-shadow: 0 0 8px 4px rgba(107, 255, 138, 0.25);
            }
        }
        @media (prefers-reduced-motion: reduce) {
            .online-badge.online::before, .online-badge.unstable {
                animation: none;
            }
        }
        /* Segmented-control look: a capsule holding every tab, the active one its own solid pill
           instead of an underline - same black/white/accent palette as everywhere else, just
           more depth (background + shadow) than a flat line ever gave it. */
        .tabs {
            display: inline-flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 2px;
            margin-top: 16px;
            padding: 4px;
            /* Opaque enough to read over the busy background image, unlike the former 6% white. */
            background-color: var(--surface-strong);
            border: 1px solid var(--border);
            border-radius: 999px;
            /* An inline-flex box (unlike a block-level flex one) shrinks to its content's width
               and is centered by header's own text-align: center - the capsule wraps snugly
               around the tabs instead of stretching edge to edge. max-width keeps a narrow
               viewport from overflowing before flex-wrap gets a chance to break it into rows. */
            max-width: 100%;
        }
        .tabs a {
            display: inline-block;
            padding: 8px 16px;
            color: var(--text-nav);
            text-decoration: none;
            border-radius: 999px;
            transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
        }
        .tabs a:hover {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .tabs a.active {
            color: var(--bg);
            background-color: var(--text);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        }
        .tabs a.active:hover {
            /* Already the strongest state on the bar - a hover background would just dim the
               solid pill for no reason. */
            background-color: var(--text);
        }
        /* A plain switch, not a tab - it changes which tabs/sections exist. */
        .advanced-toggle {
            margin: 0;
        }
        /* margin-top: overrides the generic "form > button:last-child" spacing, which pushed the
           button below the version next to it. */
        .advanced-toggle > button[type="submit"]:last-child {
            margin-top: 0;
            padding: 4px 12px;
            color: var(--text-nav);
            background-color: var(--surface-strong);
            border: 1px solid var(--border);
            border-radius: 999px;
            font-size: 0.85em;
        }
        .advanced-toggle > button[type="submit"]:hover:not(:disabled) {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .advanced-toggle > button[type="submit"][aria-pressed="true"] {
            color: var(--warn);
            border-color: var(--warn);
        }
        .card {
            background-color: var(--surface);
            border-radius: var(--radius-lg);
            padding: 24px 16px;
            margin-bottom: 24px;
        }
        .card h2 {
            margin-top: 0;
            font-size: 1.1em;
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
        }
        a {
            color: var(--accent);
        }
        label {
            display: block;
            margin-top: 16px;
        }
        /* Form controls don't inherit the page font by default: browsers give them their own
           system font at ~13.3px, so on form-heavy pages (My account, sign-in) the typed values
           and button labels came out visibly smaller than the labels/paragraphs around them. */
        input, select, textarea, button {
            font: inherit;
        }
        input, select {
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            margin-top: 4px;
            transition: outline-color 0.15s ease;
        }
        /* Safari draws a search field its own way (small, rounded) and ignores the padding above. */
        input[type="search"], select {
            -webkit-appearance: none;
            appearance: none;
            border: 1px solid #767676;
            border-radius: 4px;
            background-color: #ffffff;
            color: #000000;
        }
        /* Without its native look a select needs its own arrow. */
        select {
            padding-right: 32px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%23333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 10px center;
            background-size: 14px;
            cursor: pointer;
        }
        select:disabled {
            cursor: default;
            opacity: 0.6;
        }
        input:focus, select:focus {
            outline: 2px solid var(--accent);
            outline-offset: -1px;
        }
        button {
            padding: 8px 16px;
            color: #000000;
            background-color: #ffffff;
            border: none;
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: background-color 0.15s ease, opacity 0.15s ease;
        }
        button:hover:not(:disabled) {
            background-color: #dddddd;
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        /* Every interactive element gets a visible keyboard focus ring, not just input/select
           above: buttons and links used to have none at all, so tabbing through a page (or
           through the primary/sub tabs, both plain <a>) gave no indication of where focus was. */
        a:focus-visible, button:focus-visible, summary:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }
        /* Irreversible actions (Danger Zone "Delete the selection" buttons): previously the same
           plain white button as "Save", with nothing to tell them apart at a glance beyond the
           confirm() dialog that fires on click. Same shape/size as a normal button so it doesn't
           jump around the layout, distinct color so the destructive intent is visible before
           that dialog even appears. */
        button.button-danger {
            color: var(--text);
            background-color: var(--danger-strong);
        }
        button.button-danger:hover:not(:disabled) {
            background-color: #d84a3a;
        }
        form > button[type="submit"]:last-child {
            margin-top: 24px;
        }
        .error, .info, .warn {
            padding: 10px 14px;
            margin: 12px 0 0;
            border-radius: var(--radius-md);
            border-left: 3px solid currentColor;
        }
        .error {
            color: var(--danger);
            background-color: rgba(255, 107, 107, 0.12);
        }
        .info {
            color: var(--accent);
            background-color: rgba(138, 180, 248, 0.12);
        }
        .warn {
            color: var(--warn);
            background-color: rgba(255, 209, 102, 0.12);
        }
        /* Numbered steps in an info box: keeps room for the markers the .info padding would eat. */
        ol.info {
            padding-left: 34px;
        }
        ol.info li + li {
            margin-top: 6px;
        }
        .path-row {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .path-row input {
            margin-top: 0;
            /* An input's intrinsic width (~20 characters) is its flex min-width by default: on a
               phone it pushed the Browse button past the card's edge. */
            min-width: 0;
        }
        .path-row button {
            flex: 0 0 auto;
        }
        .plugins-path-field {
            transition: opacity 0.15s ease;
        }
        .plugins-path-field.is-disabled {
            opacity: 0.4;
        }
        .button-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 24px;
        }
        /* Subtabs on the left, the page's action (see renderSubtabbedPage()'s navAction) pinned to
           the right of the same row; wraps under them on a narrow screen. */
        /* Sticky: the MAME launch/close button stays in reach while scrolling a long subtab (the
           Controls tables especially). */
        .subtabs-bar {
            position: sticky;
            top: 0;
            z-index: 10;
            padding: 8px 0;
            background-color: var(--surface-strong);
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 8px 16px;
            margin: 4px 0 20px;
        }
        .subtabs-bar .subtabs {
            margin: 0;
        }
        .subtabs-action form > button[type="submit"]:last-child {
            margin-top: 0;
        }

        .launch-button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .launch-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        button.button-attention {
            color: #000000;
            background-color: var(--warn);
        }
        button.button-attention:hover:not(:disabled) {
            background-color: #ffe199;
        }
        .launch-logo {
            height: 20px;
            width: auto;
        }
        .checkbox-row {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-top: 16px;
        }
        .checkbox-row input {
            width: auto;
            margin-top: 3px;
        }
        /* Wraps everything after the checkbox in one flex item (an element like <code> inside
           otherwise-bare text would each become their own anonymous flex item, and the first
           text run wraps within its own narrowed box instead of flowing as one paragraph across
           the row - see the "Delete the whole ... directory" row this was written for). */
        .checkbox-row > span {
            flex: 1 1 auto;
            min-width: 0;
        }
        .hi-badge {
            margin-left: 6px;
            padding: 0 5px;
            border: 1px solid var(--success);
            border-radius: 3px;
            color: var(--success);
            font-size: 11px;
            vertical-align: middle;
        }
        .checkbox-row-detail {
            display: block;
            margin-top: 2px;
            color: var(--text-muted);
            font-size: 0.9em;
        }
        /* The MAUI card's groups of settings (renderMauiCard()), under one form and one Save. */
        .settings-group {
            min-width: 0;
            margin: 24px 0 0;
            padding: 0;
            border: none;
        }
        .settings-group:first-of-type {
            margin-top: 0;
        }
        .settings-group legend {
            padding: 0 0 6px;
            width: 100%;
            border-bottom: 1px solid var(--border);
            color: var(--text-muted);
            font-size: 0.85em;
            font-weight: bold;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }
        .settings-group input[type="number"] {
            max-width: 10em;
        }
        .settings-group + button[type="submit"] {
            margin-top: 24px;
        }
        .current-path {
            font-family: monospace;
            word-break: break-all;
            background-color: var(--surface-inset);
            padding: 8px;
        }
        .info-field {
            margin-top: 12px;
        }
        .info-field dt {
            font-size: 0.85em;
            color: var(--text-muted);
        }
        .info-field dd {
            margin: 4px 0 0;
            font-family: monospace;
            word-break: break-all;
            background-color: var(--surface-inset);
            padding: 8px;
        }
        .info-field dd ul {
            margin: 0;
            padding-left: 20px;
        }
        .button-link {
            display: inline-block;
            padding: 8px 16px;
            background-color: #ffffff;
            color: #000000;
            text-decoration: none;
            border-radius: 4px;
            transition: background-color 0.15s ease;
        }
        .button-link:hover {
            background-color: #dddddd;
        }
        .browse-list {
            list-style: none;
            padding: 0;
            margin: 16px 0;
            max-height: 400px;
            overflow-y: auto;
        }
        .browse-list li {
            padding: 6px 0;
            border-bottom: 1px solid var(--border-subtle);
        }
        .table-wrap {
            overflow-x: auto;
        }
        table.favorites-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85em;
        }
        table.favorites-table th,
        table.favorites-table td {
            text-align: left;
            padding: 6px 8px;
            border-bottom: 1px solid var(--border-subtle);
            white-space: nowrap;
        }
        /* Favorites / removed favorites: every column but the name has a fixed width, pinned to
           the right whatever the names are; the name gets what's left and is cut with an ellipsis
           (see .game-name-cell). min-width: below it the table scrolls (.table-wrap) instead of
           squeezing the name column to nothing. */
        table.favorites-table.fixed-columns {
            table-layout: fixed;
            min-width: 640px;
        }
        table.favorites-table.fixed-columns td {
            overflow: hidden;
            text-overflow: ellipsis;
        }
        table.favorites-table.fixed-columns .game-name-cell {
            max-width: none;
        }
        table.favorites-table.fixed-columns .romname-cell {
            display: flex;
            min-width: 0;
        }
        .col-romname { width: 130px; }
        .col-assets { width: 88px; }
        .col-date { width: 140px; }
        .col-published { width: 170px; }
        /* MAUI tab's releases: only some rows hold the install icon, all keep its height. */
        .update-table {
            margin-top: 16px;
        }
        .update-table td {
            height: 33px;
        }
        /* Three columns only: narrow enough for a phone without scrolling sideways. */
        .update-table table.favorites-table.fixed-columns {
            min-width: 340px;
        }
        .col-plays { width: 64px; }
        /* The vote buttons, then the row's own actions (see .row-actions). */
        .col-actions { width: 236px; }
        .col-actions-restore { width: 196px; }
        .col-action { width: 56px; }
        table.favorites-table th.center,
        table.favorites-table td.center {
            text-align: center;
        }
        .badge-yes {
            color: var(--success);
        }
        .badge-no {
            color: var(--danger);
        }
        .badge-deleted {
            color: var(--text-muted);
        }
        .badge-warn {
            color: var(--warn);
        }
        /* Hiscores page: raw file content */
        pre.hex-dump {
            margin: 0;
            padding: 8px;
            max-height: 360px;
            overflow: auto;
            background: var(--surface-inset);
            border-radius: var(--radius-sm);
            font-size: 12px;
            line-height: 1.4;
        }
        /* Deleted players, listed after the others in the same Players table (Advanced configuration only). */
        table.favorites-table tr.row-deleted td {
            opacity: 0.6;
        }
        table.favorites-table tr.row-deleted td:last-child {
            opacity: 1;
        }
        /* The player just created or given a new PIN (see renderUsersListCard()): an accent
           band that fades to a lasting tint, and their PIN under it. */
        table.favorites-table tr.row-highlight td {
            background-color: rgba(138, 180, 248, 0.16);
            animation: row-highlight-flash 2.4s ease-out;
        }
        table.favorites-table tr.row-highlight td:first-child {
            box-shadow: inset 4px 0 0 var(--accent);
        }
        @keyframes row-highlight-flash {
            0%, 30% { background-color: rgba(138, 180, 248, 0.45); }
            100% { background-color: rgba(138, 180, 248, 0.16); }
        }
        @media (prefers-reduced-motion: reduce) {
            table.favorites-table tr.row-highlight td { animation: none; }
        }
        table.favorites-table tr.row-pin td {
            background-color: rgba(138, 180, 248, 0.08);
            box-shadow: inset 4px 0 0 var(--accent);
        }
        .pin-reveal {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--space-2) var(--space-3);
            padding: var(--space-2) 0;
        }
        .pin-reveal-label {
            font-size: 1.1em;
        }
        .pin-digits {
            display: inline-flex;
            gap: var(--space-2);
        }
        .pin-digit {
            display: inline-block;
            min-width: 1.4em;
            padding: 6px 4px;
            border: 2px solid var(--warn);
            border-radius: var(--radius-md);
            background: var(--surface-inset);
            color: var(--warn);
            font-family: ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace;
            font-size: 2.2em;
            font-weight: bold;
            line-height: 1;
            text-align: center;
        }
        .pin-reveal-help {
            flex-basis: 100%;
            margin: 0;
            color: var(--text-muted);
        }
        .row-actions {
            display: inline-flex;
            gap: 8px;
        }
        /* An empty list's call to action (no player yet): stands out from the info notes. */
        .empty-callout {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px 24px;
            margin: 16px 0;
            padding: 16px 20px;
            border: 1px solid var(--warn);
            border-left-width: 4px;
            border-radius: 6px;
            background-color: rgba(255, 196, 0, 0.08);
        }
        .empty-callout p {
            margin: 0;
        }
        .button-link.button-link-attention {
            background-color: var(--warn);
        }
        .card-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
        }
        .row-actions .inline-form {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        /* Same height as the icon buttons beside it: the generic input padding and top margin
           made the row taller than the others. */
        .row-actions input[name="password"] {
            width: 14em;
            height: 32px;
            margin-top: 0;
            padding: 4px 6px;
        }
        .row-actions input[name="pin"] {
            width: 4.5em;
            height: 32px;
            margin-top: 0;
            padding: 4px 6px;
            text-align: center;
        }
        .asset-icons {
            display: inline-flex;
            gap: 8px;
            vertical-align: middle;
        }
        .asset-icon {
            display: inline-flex;
            cursor: help;
        }
        .asset-icon[data-preview] {
            cursor: zoom-in;
        }
        .asset-preview {
            position: fixed;
            z-index: 50;
            max-width: 240px;
            max-height: 180px;
            object-fit: contain;
            padding: 4px;
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
            pointer-events: none;
        }
        /* Icon-only submit button (favorites Remove/Restore): compact, outlined in its own color
           instead of the plain white button. The extra selector parts beat the generic
           "form > button[type=submit]:last-child" 24px top margin above, which would otherwise
           push it out of its table row's alignment. */
        form > button.icon-button[type="submit"]:last-child {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            /* Was padding: 5px (~26px total with the 16px icon) - under the ~40-44px touch
               target guideline, and this sits in dense table rows on a BO reachable from any
               phone/tablet on the LAN. Not raised all the way to 44px here: that would need
               revisiting row height/density across every table this appears in (Favorites,
               Players, removed-favorites...), left for the Phase 2 pass in
               docs/BO-UX-REVAMP.md. min-width/height (not just padding) keep it square even
               though the icon itself doesn't fill the box uniformly. */
            min-width: 32px;
            min-height: 32px;
            padding: 8px;
            margin-top: 0;
            color: var(--danger);
            background-color: transparent;
            border: 1px solid currentColor;
        }
        form > button.icon-button.icon-button-ok[type="submit"]:last-child {
            color: var(--success);
        }
        form > button.icon-button.icon-button-warn[type="submit"]:last-child {
            color: var(--warn);
        }
        form > button.icon-button.icon-button-accent[type="submit"]:last-child {
            color: var(--accent);
        }
        button.icon-button:hover:not(:disabled) {
            background-color: rgba(255, 255, 255, 0.12);
        }
        .avatar-thumb {
            display: block;
            width: 36px;
            height: 36px;
            object-fit: cover;
            border-radius: 4px;
        }
        .avatar-placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--border-subtle);
            color: #888888;
            font-size: 18px;
        }
        /* An avatar that can be changed: its actions (.avatar-actions) lie over the picture and
           show on hover or keyboard focus. */
        .avatar-edit {
            display: inline-block;
            vertical-align: middle;
            position: relative;
            border-radius: 4px;
        }
        .avatar-actions {
            position: absolute;
            inset: 0;
            display: flex;
            border-radius: 4px;
            overflow: hidden;
            background: rgba(0, 0, 0, 0.65);
            opacity: 0;
            transition: opacity 0.15s ease;
        }
        .avatar-edit:hover .avatar-actions, .avatar-edit:focus-within .avatar-actions {
            opacity: 1;
        }
        /* No hover on a touch screen: the actions stay shown, or a tap would hit one unseen. */
        @media (hover: none) {
            .avatar-actions {
                opacity: 1;
            }
        }
        .avatar-actions form {
            display: flex;
            flex: 1;
            margin: 0;
        }
        /* A <label> (change, around the file input) or a submit button (delete): the selector
           outweighs the generic label, button and "form > button[type=submit]:last-child" rules. */
        .avatar-actions form > .avatar-action:last-child {
            position: relative;
            display: flex;
            flex: 1;
            align-items: center;
            justify-content: center;
            min-width: 0;
            margin: 0;
            padding: 0;
            color: #ffffff;
            background: transparent;
            border: none;
            border-radius: 0;
            cursor: pointer;
        }
        .avatar-actions form > .avatar-action:last-child:hover {
            background: rgba(255, 255, 255, 0.18);
        }
        .avatar-actions form > .avatar-action-danger:last-child {
            color: var(--danger);
        }
        .avatar-action svg {
            width: 14px;
            height: 14px;
        }
        /* A bare avatar (deleted players, not uploadable): display: block ignores the cell's
           text-align, so it's centered by margin to line up with the .avatar-upload ones. */
        td.center > .avatar-thumb {
            margin: 0 auto;
        }
        .avatar-action input[type="file"] {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
        }
        .info-icon {
            display: inline-flex;
            vertical-align: middle;
            color: var(--accent);
            cursor: help;
        }
        /* Long game names are cut with an ellipsis instead of widening the table; the info icon
           stays visible after the cut text. */
        .vote-buttons {
            display: inline-flex;
            gap: 6px;
        }
        /* A games list row's buttons in one cell: its vote, a divider, then show / remove / restore. */
        .row-actions {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .row-actions form {
            margin: 0;
        }
        .row-actions .vote-buttons {
            gap: 4px;
            padding-right: 8px;
            border-right: 1px solid #444444;
        }
        /* Compact with a mouse; touch screens keep their finger-sized ones (pointer: coarse below). */
        @media (pointer: fine) {
            table.favorites-table .row-actions form > button.icon-button[type="submit"] {
                min-width: 28px;
                min-height: 28px;
                padding: 5px;
            }
        }
        /* The three vote icons of a row: unlike the single Remove/Restore button above (styled as a
           form's :last-child), each needs the icon-button look. The selected one is lit up in its
           own color, the others stay grey. */
        form.vote-buttons > button.icon-button[type="submit"] {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 32px;
            min-height: 32px;
            padding: 8px;
            margin-top: 0;
            color: #777777;
            background-color: transparent;
            border: 1px solid #444444;
        }
        form.vote-buttons > button.icon-button[aria-pressed="true"] {
            border-color: currentColor;
            background-color: rgba(255, 255, 255, 0.08);
        }
        form.vote-buttons > button.up[aria-pressed="true"] {
            color: var(--success);
        }
        form.vote-buttons > button.neutral[aria-pressed="true"] {
            color: var(--warn);
        }
        form.vote-buttons > button.down[aria-pressed="true"] {
            color: var(--danger);
        }
        form.vote-buttons > button.star[aria-pressed="true"] {
            color: #ffc400;
        }

        .game-name-cell {
            display: flex;
            align-items: center;
            gap: 6px;
            max-width: 360px;
        }
        .game-name-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .romname-cell {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .game-category-icon {
            flex: 0 0 auto;
            width: 20px;
            height: 20px;
        }
        .romname-cell .info-icon,
        .game-name-cell .info-icon,
        .game-name-cell .hiscore-icon {
            flex: 0 0 auto;
        }
        .hiscore-icon {
            display: inline-flex;
            color: #ffd700;
            cursor: help;
        }
        .found-icon {
            display: inline-flex;
            vertical-align: middle;
            flex-shrink: 0;
            margin-right: 6px;
        }
        .found-yes {
            color: var(--success);
        }
        .found-no {
            color: var(--danger);
        }
        .disk-bar-track {
            display: flex;
            height: 22px;
            margin: 8px 0;
            background-color: var(--surface-inset);
            border: 1px solid var(--border);
            border-radius: 11px;
            overflow: hidden;
        }
        .disk-bar-track.disk-bar-overflow {
            border-color: var(--danger);
            box-shadow: 0 0 0 1px var(--danger);
        }
        .disk-bar-used {
            background-color: #555555;
        }
        /* Roms already on disk: lighter neutral grey, so the coloured segments stay the "new" part. */
        .disk-bar-roms {
            background-color: #b5bcc4;
        }
        /* One coloured segment per ticked pack (background set inline); flex-shrink 0 so a
           selection larger than the disk overflows (clipped, red outline) instead of squeezing. */
        .disk-bar-seg {
            flex-shrink: 0;
            min-width: 3px;
            border-left: 1px solid #000000;
            transition: width 0.25s ease-out;
        }
        .disk-zoomed .disk-bar-track > .disk-bar-used,
        .disk-zoomed .disk-bar-track > .disk-bar-roms,
        .disk-zoomed .disk-legend-static {
            display: none;
        }
        .disk-zoom-note {
            margin: 0 0 4px;
            font-size: 0.85em;
            color: var(--accent);
        }
        .disk-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 16px;
            list-style: none;
            padding: 0;
            margin: 0 0 12px;
            font-size: 0.85em;
            color: #cccccc;
        }
        .pack-owned {
            opacity: 0.55;
        }
        /* Aligned under the pack name: checkbox (13px + gap) + swatch (12px + margins). */
        .pack-details {
            margin: 4px 0 0 44px;
            font-size: 0.9em;
        }
        .pack-details summary {
            cursor: pointer;
            color: var(--accent);
        }
        .pack-games {
            list-style: none;
            padding: 0;
            margin: 6px 0 0;
            max-height: 240px;
            overflow-y: auto;
        }
        .pack-game {
            display: flex;
            gap: 8px;
            padding: 2px 0;
        }
        /* Overrides the page-wide label/input styles (block, full width, top margin). */
        /* display: flex above would beat the UA rule for [hidden] (search filter). */
        .pack-game[hidden], .pack-row[hidden] {
            display: none;
        }
        .pack-search, .table-search {
            margin: 16px 0 0;
        }
        .table-search-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .table-search-controls input {
            flex: 1 1 240px;
        }
        .table-search-controls input, .table-search-controls select {
            margin-top: 0;
        }
        .table-search-controls select {
            width: auto;
            flex: 0 1 auto;
        }
        .table-search-filters {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            margin: 10px 0 8px;
        }
        /* A filter: a checkbox drawn as a pill, lit up while ticked. */
        .filter-chip {
            position: relative;
            display: inline-flex;
            align-items: center;
            padding: 4px 12px;
            border: 1px solid #555555;
            border-radius: 999px;
            font-size: 0.9em;
            color: #cccccc;
            cursor: pointer;
            user-select: none;
        }
        .filter-chip input {
            position: absolute;
            opacity: 0;
            width: 1px;
            height: 1px;
            margin: 0;
        }
        .filter-chip:has(input:checked) {
            border-color: var(--accent);
            background-color: rgba(255, 255, 255, 0.08);
            color: #ffffff;
        }
        .filter-chip:has(input:focus-visible) {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }
        /* Between two kinds of filters (players: status, then visibility). */
        .filter-chip-divider {
            width: 1px;
            height: 20px;
            background-color: #444444;
        }
        .filter-chip-count {
            margin-left: 4px;
            color: #888888;
        }
        .table-search-summary {
            margin-left: auto;
            font-size: 0.9em;
            color: #cccccc;
        }
        /* A sortable column's header: the header's own text, its arrow once sorted by it. */
        button.sort-header {
            padding: 0;
            margin: 0;
            color: inherit;
            font-weight: inherit;
            background: none;
            border: none;
            cursor: pointer;
        }
        button.sort-header:hover {
            text-decoration: underline;
        }
        th[aria-sort="ascending"] > button.sort-header::after {
            content: " ▲";
            font-size: 0.75em;
        }
        th[aria-sort="descending"] > button.sort-header::after {
            content: " ▼";
            font-size: 0.75em;
        }
        .table-pager {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 12px;
        }
        .table-pager label {
            margin-top: 0;
        }
        .table-pager select {
            width: auto;
            margin-top: 0;
        }
        .table-pager button {
            padding: 4px 12px;
        }
        .pack-search-count, .table-search-count {
            margin: 8px 0 0;
        }
        .pack-game-label {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin: 0;
            cursor: pointer;
        }
        .pack-game-label input {
            flex: 0 0 auto;
            width: auto;
            margin: 3px 0 0;
        }
        .pack-game-mark {
            flex: 0 0 14px;
            text-align: center;
            color: var(--text-muted);
        }
        .pack-game-installed .pack-game-mark {
            color: var(--success);
        }
        .pack-game-highlight {
            color: #f8eb48;
        }
        .pack-game-highlight .pack-game-mark {
            color: #f8eb48;
        }
        .pack-status {
            display: block;
            margin-top: 2px;
            font-size: 0.85em;
            color: var(--text-muted);
        }
        .pack-status-owned {
            color: var(--success);
        }
        .pack-status-update {
            color: #f8eb48;
        }
        .pack-status-incompatible,
        .pack-game-incompatible .pack-game-mark {
            color: var(--danger);
        }
        .pack-game-incompatible {
            opacity: 0.6;
        }
        button.pack-game-unlock {
            margin: 0;
            padding: 0;
            border: 0;
            background: none;
            font: inherit;
            line-height: inherit;
            cursor: pointer;
        }
        button.pack-game-unlock:hover {
            color: var(--text);
        }
        .pack-swatch {
            display: inline-block;
            flex: 0 0 auto;
            width: 12px;
            height: 12px;
            margin: 3px 6px 0 0;
            border-radius: 2px;
            vertical-align: baseline;
        }
        /* Out-ranks ".checkbox-row > span" (flex: 1 1 auto), which would stretch the swatch. */
        .checkbox-row > .pack-swatch {
            flex: 0 0 12px;
        }
        .disk-legend .pack-swatch {
            margin-top: 0;
            vertical-align: -1px;
        }
        dialog.modal {
            width: min(560px, 92vw);
            padding: 16px 20px 20px;
            color: var(--text);
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        }
        dialog.modal::backdrop {
            background-color: rgba(0, 0, 0, 0.6);
        }
        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
        .modal-header h3 {
            margin: 0;
        }
        button.modal-close {
            padding: 0 10px;
            font-size: 1.5em;
            line-height: 1.4;
            color: var(--text);
            background-color: transparent;
        }
        button.modal-close:hover:not(:disabled) {
            background-color: rgba(255, 255, 255, 0.12);
        }
        dialog.modal progress {
            width: 100%;
            margin-top: 16px;
        }
        p.modal-done {
            color: var(--success);
            font-weight: bold;
        }
        .progress-log {
            list-style: none;
            padding: 0;
            margin: 16px 0;
            max-height: 320px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 0.9em;
        }
        .import-progress {
            margin: 12px 0;
        }
        .progress-label {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin: 8px 0 4px;
            font-size: 0.9em;
            color: #cccccc;
        }
        .progress-track {
            height: 18px;
            background-color: var(--surface-inset);
            border: 1px solid var(--border);
            border-radius: 9px;
            overflow: hidden;
        }
        .progress-track-thin {
            height: 8px;
            border-radius: 4px;
        }
        .progress-fill {
            height: 100%;
            width: 0;
            background-color: var(--accent);
            transition: width 0.25s ease-out;
        }
        .progress-fill.progress-done {
            background-color: var(--success);
        }
        .progress-fill.progress-failed {
            background-color: var(--danger);
        }
        /* Total unknown (server sent no Content-Length): a sliding stripe instead of a bar that
           would sit at 0% and look frozen. */
        .progress-fill.progress-indeterminate {
            width: 100%;
            background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.35) 50%, transparent 100%);
            background-size: 40% 100%;
            background-repeat: no-repeat;
            animation: progress-slide 1.2s linear infinite;
        }
        @keyframes progress-slide {
            0% { background-position: -40% 0; }
            100% { background-position: 140% 0; }
        }
        .progress-log li {
            padding: 4px 0;
            border-bottom: 1px solid var(--border-subtle);
        }
        .progress-log li:last-child {
            animation: pulse 1s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        /* Present once a page has subtabs (see renderSubtabbedPage()) - the primary nav steps
           back (muted except the active tab) so the subtabs row below reads as the primary
           navigation for the page actually being looked at, without hiding the way back to the
           other top-level tabs. Dimmed only, not shrunk: a smaller font/padding here made the
           whole menu visibly jump in size between pages with subtabs and pages without
           (My account, single-section tabs). */
        .tabs.compact a:not(.active) {
            /* Muted color rather than opacity: 55% opacity over the capsule made the labels
               unreadable. */
            color: var(--text-muted);
        }
        .tabs.compact a:not(.active):hover {
            color: var(--text);
        }
        /* Multi-pack import (see renderImportTabsOpen()): one tab per pack, the pack's own
           progress in the panel below. Buttons, unlike the .tabs links, so the generic white
           button style is reset here. */
        .import-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin: 4px 0 16px;
            border-bottom: 1px solid var(--border);
        }
        .import-tab {
            padding: 6px 12px;
            color: var(--text-muted);
            background-color: transparent;
            border-radius: 0;
            border-bottom: 2px solid transparent;
            font-size: 0.85em;
        }
        .import-tab:hover:not(:disabled) {
            color: #ffffff;
            background-color: transparent;
        }
        .import-tab.active {
            color: #ffffff;
            border-bottom-color: var(--accent);
        }
        .import-tab.running::before { content: '\\25CF '; color: var(--accent); }
        .import-tab.done::before { content: '\\2713 '; color: var(--success); }
        .import-tab.failed::before { content: '\\2717 '; color: var(--danger); }
        .import-panel h3 {
            margin: 0 0 8px;
            font-size: 1em;
        }
        /* Same segmented-control family as .tabs above, one size down and left-aligned (it's a
           page's own secondary nav, not the site-wide one) - and its active pill is the accent
           color rather than plain white, so the two levels stay visually distinct: white pill =
           which top-level tab, blue pill = which subtab within it. Accent was already this row's
           "you are here" color before (the old underline), just applied to a filled pill now. */
        .subtabs {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 2px;
            margin: 4px 0 20px;
            padding: 3px;
            background-color: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-subtle);
            border-radius: 999px;
            animation: subtabs-slide-in 0.2s ease-out;
        }
        @keyframes subtabs-slide-in {
            from { opacity: 0; transform: translateX(-16px); }
            to { opacity: 1; transform: translateX(0); }
        }
        .subtabs a {
            display: inline-block;
            padding: 6px 14px;
            color: var(--text-nav);
            text-decoration: none;
            border-radius: 999px;
            font-size: 0.9em;
            transition: color 0.15s ease, background-color 0.15s ease;
        }
        .subtabs a:hover {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .subtabs a.active {
            color: var(--bg);
            background-color: var(--accent);
        }
        .subtabs a.active:hover {
            background-color: var(--accent);
        }
        /* Player switcher inside the Controls cards (see renderPlayerTabs()) - same pill look as
           .subtabs above, one level down. */
        .player-tabs {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 2px;
            margin: 16px 0 12px;
            padding: 3px;
            background-color: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-subtle);
            border-radius: 999px;
        }
        .player-tabs button {
            padding: 6px 14px;
            color: var(--text-nav);
            background-color: transparent;
            border-radius: 999px;
            font-size: 0.9em;
        }
        .player-tabs button:hover:not(:disabled) {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.08);
        }
        .player-tabs button.active, .player-tabs button.active:hover:not(:disabled) {
            color: var(--bg);
            background-color: var(--accent);
        }
        /* One small card per command in the Controls cards: as many per row
           as fit (2-3 on a desktop window), down to one per row on a phone. min(100%, ...) keeps
           a lone column from overflowing a screen narrower than the minimum. */
        .binding-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
            gap: 12px;
        }
        /* Values and buttons on the left, the command's icon and name on the right (spanning
           both rows), a flash message across the whole card under them. */
        .binding {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px 12px;
            align-content: start;
            padding: 12px;
            background-color: var(--surface-inset);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-md);
        }
        .binding > * {
            grid-column: 1;
        }
        .binding-label {
            grid-column: 2;
            grid-row: 1 / span 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            max-width: 96px;
            font-size: 0.8em;
            font-weight: bold;
            text-align: center;
            color: var(--text-muted);
        }
        .binding-icon {
            width: 64px;
            height: 64px;
        }
        .binding-values {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 4px 12px;
            margin: 0;
            font-size: 0.9em;
        }
        .binding-values dt {
            color: var(--text-muted);
        }
        .binding-values dd {
            margin: 0;
            /* Sequences like "KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT" have no natural
               break point. */
            overflow-wrap: anywhere;
        }
        .binding-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            align-self: start;
            gap: 8px;
        }
        .binding-actions > button[type="submit"]:last-child {
            margin-top: 0;
        }
        /* Hotkeys card: the step by step "Add a hotkey", one question per screen. */
        .hotkey-step {
            margin: 1em 0 0;
        }
        .hotkey-choices {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 0.5em 0 1em;
        }
        .hotkey-choices button {
            margin-top: 0;
            text-align: left;
        }
        .hotkey-choices button .checkbox-row-detail {
            display: block;
        }
        .hotkey-summary {
            font-size: 1.1em;
        }
        .binding .flash {
            grid-column: 1 / -1;
            margin: 0;
        }
        /* Controls card: what triggers an action, one pill per key/button, its device in front. */
        .control-form {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 0;
        }
        .control-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 0;
            padding: 0;
            list-style: none;
        }
        .control-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            max-width: 100%;
            padding: 2px 4px 2px 8px;
            font-size: 0.9em;
            background-color: rgba(255, 255, 255, 0.06);
            border: 1px solid var(--border-subtle);
            border-radius: 999px;
            overflow-wrap: anywhere;
        }
        .control-kind {
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
            color: var(--text-muted);
        }
        .control-chip-joystick .control-kind {
            color: var(--accent);
        }
        .control-chip-keyboard .control-kind {
            color: var(--warn);
        }
        .control-chips .control-remove {
            margin: 0;
            padding: 0 6px;
            line-height: 1.6;
            color: var(--text-muted);
            background-color: transparent;
            border-radius: 999px;
        }
        .control-chips .control-remove:hover:not(:disabled) {
            color: var(--text);
            background-color: rgba(255, 255, 255, 0.12);
        }
        .analog-devices {
            display: grid;
            gap: 12px;
            justify-items: start;
        }
        .analog-device {
            display: grid;
            grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
            gap: 12px;
            align-items: center;
            width: 100%;
            max-width: 600px;
        }
        @media (max-width: 600px) {
            .analog-device {
                grid-template-columns: 1fr;
                gap: 4px;
            }
        }
        .control-seq-title {
            margin: 0;
            font-size: 0.85em;
            font-weight: bold;
        }
        .control-form + .control-form {
            padding-top: 8px;
            border-top: 1px solid var(--border-subtle);
        }
        .control-layout {
            font-size: 0.85em;
            color: var(--text-muted);
        }
        .control-roles {
            grid-column: 1 / -1;
            font-size: 0.85em;
            color: var(--text-muted);
        }
        .control-roles ul {
            margin: 4px 0 0;
            padding-left: 18px;
        }
        .control-origin {
            margin: 0;
            font-size: 0.8em;
            color: var(--text-muted);
        }
        .control-none {
            font-size: 0.9em;
            font-style: italic;
            color: var(--text-muted);
        }
        .control-form button.listening {
            color: var(--bg);
            background-color: var(--warn);
        }
        .control-reread {
            margin-top: 16px;
        }
        /* Controls tab's "Detected devices": one card per device MAME reports, same inset look
           as the binding cards. */
        .device-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
            gap: 12px;
            margin-top: 16px;
        }
        .device {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px;
            background-color: var(--surface-inset);
            border: 1px solid var(--border-subtle);
            border-left: 4px solid var(--success);
            border-radius: var(--radius-md);
        }
        .device-header {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
        }
        .device-header h3 {
            flex: 1;
            margin: 0;
            font-size: 1.15em;
        }
        /* MAME's player-facing number for the device - the first thing to read on the card. */
        .device-joy {
            padding: 4px 10px;
            border-radius: var(--radius-sm);
            background-color: var(--accent);
            color: var(--bg);
            font-weight: bold;
            white-space: nowrap;
        }
        .device-pinned {
            padding: 2px 8px;
            border: 1px solid var(--success);
            border-radius: var(--radius-sm);
            color: var(--success);
            font-size: 0.8em;
        }
        .device-pin {
            align-items: center;
        }
        .device-pin-label {
            color: var(--text-muted);
            font-size: 0.9em;
        }
        .device-absent-title {
            margin: 24px 0 8px;
            font-size: 1em;
        }
        .device-absent {
            margin: 0;
            padding: 0;
            list-style: none;
        }
        .device-absent li {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
            padding: 8px 0;
            border-bottom: 1px solid var(--border-subtle);
        }
        .device-absent code {
            flex: 1;
            overflow-wrap: anywhere;
        }
        .device-absent form > button[type="submit"]:last-child {
            margin-top: 0;
        }
        .device details summary {
            cursor: pointer;
            color: var(--text-muted);
            font-size: 0.9em;
        }
        .device-items {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 8px;
            font-size: 0.85em;
        }
        .player-panel {
            display: none;
        }
        .player-panel.active {
            display: block;
        }
        .subtab-panel {
            display: none;
        }
        .subtab-panel.active {
            display: block;
        }
        /* Phones and small tablets (the BO is reachable from any device on the LAN). Kept last so
           it overrides the desktop rules above without raising their specificity. */
        @media (max-width: 600px) {
            body {
                max-width: none;
                padding: 8px 8px 32px;
            }
            header {
                padding: 8px 0 16px;
            }
            .card {
                padding: 16px 12px;
                margin-bottom: 16px;
            }
            /* Wrapped onto several rows, a 999px radius turns the capsules into lozenges with
               pinched ends: a plain rounded box reads better. */
            .tabs, .subtabs, .player-tabs {
                border-radius: var(--radius-lg);
            }
            .tabs {
                display: flex;
            }
            .tabs a {
                padding: 8px 12px;
            }
            .subtabs-bar {
                margin: 0 0 16px;
            }
            /* Paths, rom names, MAME sequences... have no natural break point and would widen
               the page past the screen. */
            code, .card p, .card li {
                overflow-wrap: anywhere;
            }
            .pack-details {
                margin-left: 24px;
            }
            .binding-icon {
                width: 48px;
                height: 48px;
            }
            .progress-log {
                max-height: 240px;
            }
        }
        /* Touch screens, whatever their width: finger-sized targets for the dense controls sized
           for a mouse above (see the .icon-button note). */
        @media (pointer: coarse) {
            form > button.icon-button[type="submit"]:last-child,
            form.vote-buttons > button.icon-button[type="submit"] {
                min-width: 40px;
                min-height: 40px;
            }
            .checkbox-row input, .pack-game-label input {
                width: 20px;
                height: 20px;
                margin-top: 0;
            }
            .table-pager button {
                padding: 8px 14px;
            }
        }
    </style>
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="top-right">
        ${viewer ? `<form method="post" action="/advanced" class="advanced-toggle">
            <button type="submit" aria-pressed="${viewer === 'advanced'}"
                title="${viewer === 'advanced' ? 'Hide' : 'Show'} ScreenScraper, Repository, Danger and the other rarely needed settings">
                Advanced configuration: ${viewer === 'advanced' ? 'on' : 'off'}
            </button>
        </form>` : ''}
        ${viewer ? renderOnlineBadge() : ''}
        <span class="app-version" title="Running version">v${escapeHtml(getRunningVersion())}</span>
    </div>
    <header>
        <h1><a class="header-home" href="/" title="Home"><img class="header-logo" src="/maui-logo.png" alt="mame-awesome-ui"></a></h1>
        ${viewer ? `<nav class="tabs${hasSubtabs ? ' compact' : ''}" aria-label="Primary">
            ${renderSetupNavTab(active === 'setup')}
            ${renderNavTabLink('/', 'MAME', active === 'mame')}
            ${renderNavTabLink('/favorites', 'Games', active === 'favorites')}
            ${renderNavTabLink('/users', 'Players', active === 'users')}
            ${viewer === 'advanced' ? renderNavTabLink('/hiscores', 'Hiscores', active === 'hiscores') : ''}
            ${viewer === 'advanced' ? renderNavTabLink('/screenscraper', 'ScreenScraper', active === 'screenscraper') : ''}
            ${renderNavTabLink('/maui', 'MAUI', active === 'maui')}
            ${renderNavTabLink('/account', 'My account', active === 'account')}
        </nav>` : ''}
    </header>
    <main id="main">
    `;
}

function renderPageTail(): string {
    return `
    </main>
    <script>
        // Most forms here are POSTs whose response is the exact same full-page HTML a GET would
        // render (see e.g. renderFavoritesTab()) - the server has no separate "fragment" vs
        // "whole page" response shape. That let every one of them respond in place instead of
        // navigating: intercept the submit, POST via fetch(), then replace the document with
        // whatever HTML comes back. The address bar never leaves the GET page it started on, so
        // refreshing afterward re-runs that GET, not the action - previously every action left
        // the browser sitting on its own POST URL, and a refresh there replayed it (a delete, a
        // vote, a save... whatever the last click was), because the server had no
        // Post/Redirect/Get in place. This fixes that for free, without touching any of those
        // handlers, since the response they already send is exactly what gets displayed either
        // way.
        //
        // Left alone (see the data-stream check below): forms whose POST response is a
        // multi-chunk res.write() stream the browser paints incrementally as it arrives (long
        // imports, favorites refresh, media download, self-update) - swapping those in only once
        // the whole fetch() resolves would throw away the "watch it happen live" log entirely.
        // Those still fully navigate, so they keep the older replay-on-refresh gap for now (see
        // docs/BO-UX-REVAMP.md) until they're worth teaching this same script to read
        // fetch()'s response body as a stream instead of a single text() blob.
        document.addEventListener('submit', function (event) {
            if (event.defaultPrevented) {
                return;
            }
            var form = event.target;
            var button = event.submitter; // null for a plain requestSubmit() with no argument.
            // A submitter's formmethod/formaction override the form's own - same resolution a
            // real submission would use (the Browse buttons rely on exactly this to GET /browse
            // instead of POSTing the form they sit in).
            var method = ((button && button.getAttribute('formmethod')) || form.getAttribute('method') || 'get')
                .toLowerCase();
            if (method !== 'post') {
                return; // A GET is always safe to reload - no need to intercept it.
            }
            var eligible = button && button.tagName === 'BUTTON' && !button.disabled;
            // An icon-only button has no text to relabel (assigning textContent would replace
            // its <svg> with a bare "…") - just disabling it is feedback enough.
            var relabel = eligible && !button.classList.contains('icon-button');
            var originalText = eligible ? button.textContent : null;

            if (form.hasAttribute('data-stream')) {
                // Real navigation is still happening (see the comment above the listener). The
                // mutation itself is deferred one tick instead of applied synchronously here:
                // Chrome submits a form on Enter by internally simulating a click on its default
                // button, and disabling that same button synchronously from within the 'submit'
                // event it's still in the middle of dispatching aborts that in-flight click, so
                // the submission silently never happens (keyboard-only "press Enter" submission
                // broke this way, reported against exactly this symptom on the login page - a
                // real pointer click isn't affected, its own default action already committed
                // before 'submit' fires). Deferring lets the browser finish submitting first
                // either way. No need to re-enable it afterward: the navigation this triggers
                // replaces the whole DOM.
                if (eligible) {
                    setTimeout(function () {
                        if (relabel) {
                            button.textContent = originalText + '…';
                        }
                        button.disabled = true;
                    }, 0);
                }
                return;
            }

            event.preventDefault();
            if (eligible) {
                if (relabel) {
                    button.textContent = originalText + '…';
                }
                button.disabled = true;
            }
            var action = (button && button.getAttribute('formaction')) || form.getAttribute('action') || location.href;
            // A <form> with no enctype (nearly all of them: login, favorites, users, saves...)
            // submits as application/x-www-form-urlencoded, which express.urlencoded() (the only
            // body parser mounted for those routes) expects - passing a FormData body to fetch()
            // always sends multipart/form-data instead, regardless of the form's own enctype,
            // which left req.body undefined on every route without its own multer instance (only
            // the handful of file-upload routes have one). URLSearchParams as the body keeps the
            // encoding those routes actually expect; only the enctype="multipart/form-data" forms
            // (the file uploads) still need a real FormData.
            var enctype = (button && button.getAttribute('formenctype')) || form.getAttribute('enctype') || '';
            var body;
            if (enctype === 'multipart/form-data') {
                body = new FormData(form);
                if (button && button.name) {
                    // Native submission includes the clicked submit button's own name/value
                    // (several forms tell apart which of theirs was pressed this way, e.g. the
                    // Browse buttons' "target" field) - FormData(form)/URLSearchParams alone
                    // don't add it.
                    body.append(button.name, button.value);
                }
            } else {
                body = new URLSearchParams();
                new FormData(form).forEach(function (value, key) {
                    if (typeof value === 'string') {
                        body.append(key, value);
                    }
                });
                if (button && button.name) {
                    body.append(button.name, button.value);
                }
            }
            var scrollY = window.scrollY;
            fetch(action, {method: 'POST', body: body})
                .then(function (response) {
                    // A handful of these (login, logout) res.redirect() elsewhere on
                    // success instead of responding in place - fetch() follows that transparently,
                    // so response.redirected/response.url say where it actually ended up. Those
                    // belong on the address bar for real (e.g. landing on "/" after signing in),
                    // unlike every in-place response above: a real navigation there also sidesteps
                    // the GET /login page's own gap (it doesn't redirect an already-authenticated
                    // visitor away by itself), and refreshing a real URL is always safe anyway.
                    if (response.redirected) {
                        location.href = response.url;
                        return null;
                    }
                    return response.text();
                })
                .then(function (html) {
                    if (html === null) {
                        return;
                    }
                    // Full-document replacement, not innerHTML: the response is a complete
                    // <!DOCTYPE html>...</html> page (styles, nav, every inline <script> below
                    // included), same as a real navigation would have rendered - this makes the
                    // browser parse it as one, scripts included, without ever changing the URL.
                    document.open();
                    document.write(html);
                    document.close();
                    window.scrollTo(0, scrollY);
                })
                .catch(function () {
                    if (eligible) {
                        button.disabled = false;
                        if (relabel) {
                            button.textContent = originalText;
                        }
                    }
                    alert('Could not reach the application - check your connection and try again.');
                });
        });

        // Subtabs (see renderSubtabbedPage()): every panel is already in the DOM, server-
        // rendered - this only shows/hides which one is visible, no fetch involved. Picks, in
        // order: the URL hash (so a subtab is linkable and survives a reload), else the section
        // the server says this response is about (data-default-subtab, set from whichever of
        // renderForm()'s own message params is actually filled in for this request - not every
        // section with a .flash: a standing warning elsewhere, e.g. "plugin.ini incomplete",
        // also carries one and would otherwise wrongly outrank the
        // section a just-submitted form actually belongs to, since it's earlier in the list),
        // else whichever panel has a .flash message anyway (only reached when the server didn't
        // say - e.g. an unrelated standing warning on first load), else the first panel.
        (function () {
            var panels = document.querySelectorAll('.subtab-panel');
            if (!panels.length) {
                return;
            }
            var links = document.querySelectorAll('.subtabs a');
            function activate(id) {
                panels.forEach(function (panel) {
                    panel.classList.toggle('active', panel.dataset.subtabPanel === id);
                });
                links.forEach(function (link) {
                    var selected = link.dataset.subtab === id;
                    link.classList.toggle('active', selected);
                    // Keeps the ARIA tab state (and Tab-key stops) in sync with which panel is
                    // actually visible - see renderSubtabbedPage()'s nav markup, which starts
                    // every link at aria-selected="false"/tabindex="-1" until this runs.
                    link.setAttribute('aria-selected', selected ? 'true' : 'false');
                    link.tabIndex = selected ? 0 : -1;
                });
            }
            links.forEach(function (link) {
                link.addEventListener('click', function (event) {
                    event.preventDefault();
                    activate(link.dataset.subtab);
                    history.replaceState(null, '', '#' + link.dataset.subtab);
                });
            });
            var hashId = location.hash.replace('#', '');
            var initial = hashId && document.querySelector(
                '.subtab-panel[data-subtab-panel="' + hashId.replace(/"/g, '') + '"]',
            ) ? hashId : null;
            var nav = document.querySelector('.subtabs');
            var defaultSubtab = nav ? nav.dataset.defaultSubtab : '';
            if (!initial && defaultSubtab) {
                initial = defaultSubtab;
            }
            if (!initial) {
                panels.forEach(function (panel) {
                    if (!initial && panel.querySelector('.flash')) {
                        initial = panel.dataset.subtabPanel;
                    }
                });
            }
            activate(initial || panels[0].dataset.subtabPanel);
        })();

        // A form POST replaces the whole page, and a browser opens the result at the top - however
        // far down the button that was just clicked sat. Remember the scroll position when a form
        // is submitted and put it back on the page that comes back, provided it is the same page
        // and subtab (a different one - a login redirect, an error landing elsewhere - makes the
        // old position meaningless). Read after the subtab script above: a hidden panel has no
        // height to scroll into. Kept for a couple of minutes at most (a capture waits up to 30s,
        // a MAME launch a few more), and consumed once.
        (function () {
            var KEY = 'boScrollRestore';
            function where() {
                var tab = document.querySelector('nav.tabs a.active');
                var subtab = document.querySelector('.subtabs a.active');
                return (tab ? tab.textContent : '') + '/' + (subtab ? subtab.dataset.subtab : '');
            }
            document.addEventListener('submit', function (event) {
                if (event.defaultPrevented) {
                    return;
                }
                try {
                    sessionStorage.setItem(KEY, JSON.stringify({y: window.scrollY, where: where(), at: Date.now()}));
                } catch (error) { /* storage blocked: the page just opens at the top */ }
            });
            try {
                var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
                sessionStorage.removeItem(KEY);
                if (saved && Date.now() - saved.at < 120000 && saved.where === where()) {
                    window.scrollTo(0, saved.y);
                }
            } catch (error) { /* nothing to restore */ }
        })();

        // The Controls card's "Add a key or mouse button": the next key pressed or mouse button
        // clicked in the page is sent as MAME's token for it (control-listen-codes, built from what
        // MAME listed). Clicking the same button again, or 15 seconds without a press, cancels.
        (function () {
            // MAME's tab gives its tokens; MAUI's tab takes the browser's own codes (data-control-listen="raw").
            var data = document.getElementById('control-listen-codes');
            var codes = data ? JSON.parse(data.textContent) : {keys: {}, mouse: []};
            var listening = null;
            function stop() {
                if (!listening) {
                    return;
                }
                clearTimeout(listening.timer);
                listening.button.classList.remove('listening');
                listening.button.textContent = listening.label;
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('mousedown', onMouse, true);
                // The menu a right click opens comes after its mousedown: still blocked a moment.
                setTimeout(function () {
                    document.removeEventListener('contextmenu', onContextMenu, true);
                }, 1000);
                listening = null;
            }
            function send(token, event) {
                event.preventDefault();
                event.stopPropagation();
                var form = listening.button.form;
                if (!token) {
                    listening.button.textContent = 'Not known to MAME - try another';
                    return;
                }
                var slot = listening.button.dataset.slot;
                stop();
                form.elements.code.value = token;
                // The Hotkeys card: which of its two keys was caught.
                if (slot && form.elements.slot) {
                    form.elements.slot.value = slot;
                }
                form.requestSubmit(form.querySelector('[data-control-add]'));
            }
            function onKey(event) {
                send(listening.raw ? 'key|' + event.code : codes.keys[event.code], event);
            }
            function onMouse(event) {
                if (event.target === listening.button) {
                    return; // its click handler cancels
                }
                send(listening.raw ? (event.button <= 4 ? 'mouse|' + event.button : '') : codes.mouse[event.button], event);
            }
            function onContextMenu(event) {
                event.preventDefault();
            }
            document.querySelectorAll('[data-control-listen]').forEach(function (button) {
                button.addEventListener('click', function () {
                    var again = listening && listening.button === button;
                    stop();
                    if (again) {
                        return;
                    }
                    listening = {
                        button: button, label: button.textContent, raw: button.dataset.controlListen === 'raw',
                        timer: setTimeout(stop, 15000),
                    };
                    button.classList.add('listening');
                    button.textContent = 'Press a key or click…';
                    document.addEventListener('keydown', onKey, true);
                    document.addEventListener('mousedown', onMouse, true);
                    // A right click opens no menu while listening.
                    document.addEventListener('contextmenu', onContextMenu, true);
                });
            });
        })();

        // MAUI's Controls card's "Add a gamepad button": while MAUI's window waits for the press
        // (the form's own POST), the page reads the gamepads too, the way Gamepads.captureNext()
        // does, and posts what it catches as \`add\`. Windows only hands an Xbox-type pad's presses
        // to the window in front, and the click just gave it to this page; a page opened on
        // another device sees no pad, the front then catches it. Only where the browser gives the
        // Gamepad API (localhost or HTTPS).
        (function () {
            var DEADZONE = 0.4;
            if (!navigator.getGamepads) {
                return;
            }
            function pads() {
                return Array.prototype.filter.call(navigator.getGamepads(), function (pad) {
                    return pad && pad.connected;
                });
            }
            function pressed(pad) {
                var inputs = [];
                pad.buttons.forEach(function (button, index) {
                    if (button.pressed) {
                        inputs.push('button|' + index);
                    }
                });
                pad.axes.forEach(function (value, index) {
                    if (Math.abs(value) > DEADZONE) {
                        inputs.push('axis|' + index + '|' + (value > 0 ? 1 : 0));
                    }
                });
                return inputs;
            }
            function key(pad) {
                return pad.index + '|' + pad.id;
            }
            document.querySelectorAll('[data-pad-listen]').forEach(function (button) {
                button.addEventListener('click', function () {
                    var form = button.form;
                    // What is held already only counts once released and pressed again.
                    var held = {};
                    pads().forEach(function (pad) {
                        held[key(pad)] = pressed(pad);
                    });
                    var deadline = Date.now() + 30000;
                    var timer = setInterval(function () {
                        if (Date.now() > deadline) {
                            clearInterval(timer);
                            return;
                        }
                        pads().some(function (pad) {
                            var now = pressed(pad);
                            var before = held[key(pad)] || [];
                            var fresh = now.filter(function (input) {
                                return before.indexOf(input) === -1;
                            })[0];
                            held[key(pad)] = now.filter(function (input) {
                                return before.indexOf(input) !== -1;
                            });
                            if (!fresh) {
                                return false;
                            }
                            clearInterval(timer);
                            // The layout the front would pick: "standard", else the pad's own.
                            form.elements.code.value = fresh + '|' + (pad.mapping === 'standard' ? 'standard' : pad.id);
                            if (button.dataset.slot && form.elements.slot) {
                                form.elements.slot.value = button.dataset.slot;
                            }
                            form.requestSubmit(form.querySelector('[data-control-add]'));
                            return true;
                        });
                    }, 16);
                });
            });
        })();

        // Player switchers of the Controls cards (see renderPlayerTabs()). Opens on the tab the
        // server asks for (data-active: the one holding the command just captured/reset), else
        // the last one picked in this card (kept across the page swaps every form submission
        // does), else the first.
        (function () {
            document.querySelectorAll('[data-player-tabs]').forEach(function (bar) {
                var card = bar.dataset.playerTabs;
                var key = 'boPlayerTab:' + card;
                var buttons = bar.querySelectorAll('[data-player-tab]');
                var panels = document.querySelectorAll('[data-player-panel^="' + card + ':"]');
                function activate(id) {
                    buttons.forEach(function (button) {
                        var selected = button.dataset.playerTab === id;
                        button.classList.toggle('active', selected);
                        button.setAttribute('aria-selected', selected ? 'true' : 'false');
                    });
                    panels.forEach(function (panel) {
                        panel.classList.toggle('active', panel.dataset.playerPanel === card + ':' + id);
                    });
                    try {
                        sessionStorage.setItem(key, id);
                    } catch (error) { /* storage blocked: back to the first tab next time */ }
                }
                buttons.forEach(function (button) {
                    button.addEventListener('click', function () {
                        activate(button.dataset.playerTab);
                    });
                });
                var saved = null;
                try {
                    saved = sessionStorage.getItem(key);
                } catch (error) { /* nothing remembered */ }
                var ids = Array.prototype.map.call(buttons, function (button) { return button.dataset.playerTab; });
                activate([bar.dataset.active, saved].find(function (id) { return id && ids.indexOf(id) !== -1; }) || ids[0]);
            });
        })();

        // While a MAME config session runs (the Controls tab marks it with data-mame-session),
        // ask the server every couple of seconds whether it's still alive, and reload the page
        // once it isn't - MAME can be closed from its own window, which the server-rendered
        // "Close MAME" buttons and "running" status would otherwise keep showing. The interval
        // handle lives on window, not in this closure: a form submission swaps the document in
        // place (document.write() above) without clearing the previous page's timers, so each
        // new page first stops the one before it.
        (function () {
            clearInterval(window.boMameSessionWatch);
            if (!document.querySelector('[data-mame-session="running"]')) {
                return;
            }
            window.boMameSessionWatch = setInterval(function () {
                fetch('/input-probe/mame/status')
                    .then(function (response) { return response.ok ? response.json() : null; })
                    .then(function (status) {
                        if (!status || status.running) {
                            return;
                        }
                        clearInterval(window.boMameSessionWatch);
                        // Same entry the scroll-restore script above reads, so the reloaded page
                        // opens where this one was; the hash keeps it on this subtab.
                        try {
                            var subtab = document.querySelector('.subtabs a.active');
                            var tab = document.querySelector('nav.tabs a.active');
                            sessionStorage.setItem('boScrollRestore', JSON.stringify({
                                y: window.scrollY,
                                where: (tab ? tab.textContent : '') + '/' + (subtab ? subtab.dataset.subtab : ''),
                                at: Date.now(),
                            }));
                            if (subtab) {
                                history.replaceState(null, '', '#' + subtab.dataset.subtab);
                            }
                        } catch (error) { /* the page just reloads at the top */ }
                        location.reload();
                    })
                    .catch(function () { /* server unreachable for now - try again next tick */ });
            }, 2000);
        })();
    </script>
</body>
</html>`;
}

function renderLoginPage(error?: string): string {
    return renderPage(`
        <section class="card">
            <h2>Sign in</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <!-- The password alone: the BO has one account (BO_USERNAME), nothing to pick. No
                 "required": /login answers a blank password with its own message (401). The
                 hidden username only helps password managers file the password under it. -->
            <form method="post" action="/login" id="loginForm">
                <input type="text" name="username" value="${BO_USERNAME}" autocomplete="username" hidden>
                <label for="password">Password</label>
                <input type="password" id="password" name="password" autocomplete="current-password" autofocus>
                <button type="submit">Sign in</button>
            </form>
            <!-- A password manager's menu in a field (an extension, Chrome's own suggestions) can
                 take Enter for itself, now and then, and the form is not sent: only a click on
                 the button was. Enter released in a field without the form having gone off in the
                 meantime sends it. Its keyup, since what takes the keydown may also stop it. The
                 time of the last submission is kept on window, which the page that answers it
                 shares (document.write()): its keyup must not send it again, empty. -->
            <script>(function () {
                var form = document.getElementById('loginForm');
                form.addEventListener('submit', function () {
                    window.boLoginSubmittedAt = Date.now();
                }, true);
                form.addEventListener('keyup', function (event) {
                    if (event.key !== 'Enter' || event.target.tagName !== 'INPUT'
                        || Date.now() - (window.boLoginSubmittedAt || 0) < 1000) {
                        return;
                    }
                    var button = form.querySelector('button[type="submit"]');
                    if (button && !button.disabled) {
                        form.requestSubmit(button);
                    }
                });
            })();</script>
        </section>
    `, 'mame', null);
}

function renderAccountPage(viewer: Viewer, mustChangePassword: boolean, error?: string, info?: string): string {
    return renderPage(`
        <section class="card">
            <h2>My account</h2>
            ${mustChangePassword ? `<p class="error flash">You are using the default password.
            Choose a new one to continue: it also encrypts the saved credentials.</p>` : ''}
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/account/password">
                <label for="currentPassword">Current password</label>
                <input type="password" id="currentPassword" name="currentPassword" required>
                <label for="newPassword">New password</label>
                <input type="password" id="newPassword" name="newPassword" required minlength="${MIN_BO_PASSWORD_LENGTH}">
                <label for="confirmPassword">Confirm the new password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required minlength="${MIN_BO_PASSWORD_LENGTH}">
                <button type="submit">Change password</button>
            </form>
        </section>
        <section class="card">
            <form method="post" action="/logout">
                <button type="submit">Sign out</button>
            </form>
        </section>
    `, 'account', viewer);
}

interface ConfigFormValues {
    mamePath: string;
}

/**
 * mame binary folder, then the mame.ini options: the plugins folder (pluginspath - the saved
 * value, or the one just picked with Browse) and fullscreen (window, inverted - same wording as
 * the MAUI tab's own fullscreen option). Those stay dimmed and
 * disabled while the binary folder is empty - mame.ini only exists once the binary is known (see
 * POST /save) - and are re-enabled as soon as something is typed into it.
 */
function renderConfigCard(
    values: ConfigFormValues, mameInfo: Pick<MameInfo, 'pluginsPath' | 'windowed'>, error?: string, info?: string,
): string {
    const {pluginsPath, windowed} = mameInfo;
    const pluginsDisabled = values.mamePath.trim() ? '' : ' disabled';
    return `
        <section class="card">
            <h2>Configuration</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/save" novalidate>
                <label for="mamePath">Folder containing the mame binary</label>
                <div class="path-row">
                    <input type="text" id="mamePath" name="mamePath" value="${escapeHtml(values.mamePath)}">
                    <button type="submit" name="target" value="mamePath" formaction="/browse" formmethod="get">Browse</button>
                </div>
                <div class="plugins-path-field${pluginsDisabled ? ' is-disabled' : ''}" id="pluginsPathField">
                    <label for="pluginsPath">MAME plugins folder (pluginspath)</label>
                    <div class="path-row">
                        <input type="text" id="pluginsPath" name="pluginsPath" value="${escapeHtml(pluginsPath || '')}"${pluginsDisabled}>
                        <button type="submit" name="target" value="pluginsPath" formaction="/browse" formmethod="get"${pluginsDisabled}>Browse</button>
                    </div>
                    <label class="checkbox-row">
                        <input type="checkbox" name="fullscreen" ${windowed ? '' : 'checked'}${pluginsDisabled}>
                        Launch MAME fullscreen (unchecked = windowed)
                    </label>
                </div>
                <script>(function () {
                    var mamePath = document.getElementById('mamePath');
                    var field = document.getElementById('pluginsPathField');
                    function sync() {
                        var disabled = !mamePath.value.trim();
                        field.classList.toggle('is-disabled', disabled);
                        field.querySelectorAll('input, button').forEach(function (control) { control.disabled = disabled; });
                    }
                    mamePath.addEventListener('input', sync);
                })();</script>
                <div class="button-row">
                    <button type="submit">Save</button>
                </div>
            </form>
        </section>
    `;
}

/**
 * Green check / red cross next to each MAME information field below, so a missing path/file
 * is visible at a glance instead of only readable from the "Not available"/"Not found" text
 * next to it (kept as well, for screen readers and anyone not distinguishing the colors).
 */
function renderFoundIcon(found: boolean): string {
    return found
        ? `<span class="found-icon found-yes" title="Found" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M3 8.5 L6.5 12 L13 4" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </span>`
        : `<span class="found-icon found-no" title="Not found" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </span>`;
}

function renderMameInfoCard(mameInfo: MameInfo, info?: string): string {
    // mameInfo.error means the binary isn't configured yet, or -showconfig failed against it -
    // every field/form below is resolved from that same -showconfig/ui.ini read, so none of it
    // is meaningful (or in some cases even present) until the binary's set and validated.
    if (mameInfo.error) {
        return `
            <section class="card">
                <h2>MAME information</h2>
                <p class="error flash">${escapeHtml(mameInfo.error)}</p>
            </section>
        `;
    }
    return `
        <section class="card">
            <h2>MAME information</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <dl>
                <div class="info-field">
                    <dt>MAME home folder (ini, cfg, nvram, snapshots...)</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.iniPath))}${escapeHtml(mameInfo.iniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>mame.ini file</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.mameIniPath))}${escapeHtml(mameInfo.mameIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>ui.ini file</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.uiIniPath))}${escapeHtml(mameInfo.uiIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>plugin.ini file</dt>
                    <dd>${renderFoundIcon(existsSync(mameInfo.pluginIniPath))}${escapeHtml(mameInfo.pluginIniPath)}</dd>
                </div>
                <div class="info-field">
                    <dt>Roms folder (rompath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.romPath)}${mameInfo.romPath
                        ? escapeHtml(mameInfo.romPath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Marquees folder (marquees_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.marqueePath)}${mameInfo.marqueePath
                        ? escapeHtml(mameInfo.marqueePath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Flyers folder (flyers_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.flyerPath)}${mameInfo.flyerPath
                        ? escapeHtml(mameInfo.flyerPath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Logos folder (logos_directory)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.logoPath)}${mameInfo.logoPath
                        ? escapeHtml(mameInfo.logoPath) : '<em>Not available</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Favorites file (favorites.ini)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.favoritesPath)}${mameInfo.favoritesPath
                        ? escapeHtml(mameInfo.favoritesPath)
                        : '<em>No favorites yet — add some from the MAME menu (Tab in game).</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Genres file (genre.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.genreIniPath)}${mameInfo.genreIniPath
                        ? escapeHtml(mameInfo.genreIniPath)
                        : '<em>Not found — import a starting pack (Import / Export tab) to '
                            + 'install it at the path given by categorypath in ui.ini.</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Subgenres file (catver.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.catverIniPath)}${mameInfo.catverIniPath
                        ? escapeHtml(mameInfo.catverIniPath) + ' <em>(used instead of genre.ini)</em>'
                        : '<em>Optional — add progettoSNAPS\' catver.ini at the path given by '
                            + 'categorypath in ui.ini for finer genres (Fighting, Beat \'em Up...).</em>'}</dd>
                </div>
                <div class="info-field">
                    <dt>Player count file (Multiplayer.ini, categorypath)</dt>
                    <dd>${renderFoundIcon(!!mameInfo.nplayersIniPath)}${mameInfo.nplayersIniPath
                        ? escapeHtml(mameInfo.nplayersIniPath)
                        : '<em>Not found — import a starting pack (Import / Export tab) to '
                            + 'install it at the path given by categorypath in ui.ini.</em>'}</dd>
                </div>
            </dl>
            ${mameInfo.missingPlugins.length ? `
                <form method="post" action="/mame-options/repair-plugins">
                    <p class="error flash">plugin.ini is incomplete: ${mameInfo.missingPlugins.length} plugin(s)
                    found in the plugins folder but missing from plugin.ini
                    (${escapeHtml(mameInfo.missingPlugins.join(', '))}).</p>
                    <button type="submit">Repair plugin.ini (add the missing plugins)</button>
                </form>
            ` : ''}
        </section>
    `;
}

/**
 * Directory mame's hiscore plugin writes .hi files into (the one @arcadoolic/mhiex reads from,
 * see HiscoreService.class.ts). Duplicated here rather than imported for the same
 * @electron/remote reason as the rest of this file's helpers.
 */
function getHiscorePath(iniPath: string): string {
    return join(iniPath, 'hiscore');
}

/**
 * Danger zone for MAME's own data (hiscores, roms/media - everything under mameInfo.iniPath and
 * the game media directories). Rendered on the "mame" tab, next to the MAME info this data
 * belongs to. Kept separate from renderMauiDangerZoneCard() below (mame-awesome-ui's own
 * config/database, on the "maui" tab) so each zone only ever deletes what its own tab is about.
 */
function renderMameDangerZoneCard(mameInfo: MameInfo, info?: string): string {
    // No apostrophes/accents in the JS string literals built in onsubmit/onchange below (same
    // pattern the user-delete confirm() already used): they're embedded in single-quoted JS
    // strings inside an HTML attribute, so keeping them plain ASCII avoids any escaping headache.
    return `
        <section class="card">
            <h2>Danger zone</h2>
            <p class="error">Targeted, irreversible deletions of MAME's own data. Each checkbox
            acts independently of the others - tick what you want to delete, then submit. The whole
            directory includes the three others: they are ticked while it is, and back as they were
            when it is unticked.
            Deleting the roms/media also deletes the roms themselves, not just the artwork.</p>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/reset" onsubmit="
                var items = [];
                if (this.deleteMameHome.checked) {
                    items.push('the whole .mame directory and its content (mame.ini/ui.ini configuration, roms, media, hiscores, cfg, nvram, snapshots...)');
                } else {
                    if (this.deleteHiscores.checked) items.push('the hiscores');
                    if (this.deleteGamesMedia.checked) items.push('the games roms and media (roms, marquees, flyers, logos)');
                    if (this.deleteFavorites.checked) items.push('the favorites file (favorites.ini)');
                }
                if (!items.length) { return true; }
                return confirm('Permanently delete ' + items.join(', ') + '? This cannot be undone.');
            ">
                <input type="hidden" name="zone" value="mame">
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteHiscores">
                    <span>Delete the hiscores (<code>${escapeHtml(getHiscorePath(mameInfo.iniPath))}</code>)</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteGamesMedia">
                    <span>Delete the games roms and media (roms, marquees, flyers, logos)</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteFavorites"${mameInfo.favoritesPath ? '' : ' disabled'}>
                    <span>Delete the favorites file${mameInfo.favoritesPath
                        ? ` (<code>${escapeHtml(mameInfo.favoritesPath)}</code>)`
                        : ' (no favorites.ini yet)'}</span>
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteMameHome" onchange="
                        var whole = this.checked;
                        [this.form.deleteHiscores, this.form.deleteGamesMedia, this.form.deleteFavorites].forEach(function (box) {
                            if (whole) {
                                box.dataset.ticked = box.checked ? '1' : '';
                                box.checked = true;
                            } else {
                                box.checked = box.dataset.ticked === '1';
                            }
                            box.disabled = whole;
                        });
                        this.form.deleteFavorites.disabled = whole || ${mameInfo.favoritesPath ? 'false' : 'true'};
                    ">
                        <span>
                            Delete the whole <code>${escapeHtml(mameInfo.iniPath)}</code> directory
                            <span class="checkbox-row-detail">Includes the options above, plus the
                            mame.ini/ui.ini configuration itself, cfg, nvram, snapshots... - MAME
                            will recreate it on its next launch.</span>
                        </span>
                </label>
                <button type="submit" class="button-danger">Delete the selection</button>
            </form>
        </section>
    `;
}

interface DeviceProbeRow {
    name: string;
    id: string;
    // "<item display name>=<MAME token>" pairs, e.g. "LB=BUTTON5" - kept as raw strings rather
    // than split further, this is a basic detection test, not a mapping UI yet.
    items: string[];
    // The number MAME gives the device in its input codes, e.g. "JOYCODE_1" - empty if unknown.
    joycode: string;
}

interface DeviceProbeState {
    result?: DeviceProbeRow[];
    error?: string;
    info?: string;
}

/**
 * Line-based parse of device-probe.lua's stdout, captured amid MAME's normal boot chatter (menu
 * hints, warnings, etc. on other lines - anything not starting with the marker is ignored).
 * Format, one line per device: MAUI_DEVICE_ROW|<device name>|<device id>|<name>=<token>,...|<JOYCODE_n>
 */
function parseDeviceProbeOutput(stdout: string): DeviceProbeRow[] {
    const rows: DeviceProbeRow[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.startsWith('MAUI_DEVICE_ROW|')) {
            continue;
        }
        const [, name, id, itemsRaw, joycode] = line.split('|');
        rows.push({
            name: name ?? '',
            id: id ?? '',
            items: itemsRaw ? itemsRaw.split(',').filter(Boolean) : [],
            joycode: /^JOYCODE_\d+$/.test(joycode?.trim() ?? '') ? joycode.trim() : '',
        });
    }
    // Same order as MAME's own "JOY 1", "JOY 2"... (unknown numbers last).
    return rows.sort((a, b) => joycodeNumber(a.joycode) - joycodeNumber(b.joycode));
}

function joycodeNumber(joycode: string): number {
    return Number(/^JOYCODE_(\d+)$/.exec(joycode)?.[1] ?? Infinity);
}

/**
 * The controller file (see MameCtrlr.ts) the Controls tab pins devices to their JOYCODE number
 * in: whichever one mame.ini's `ctrlr` already names, else "maui" (set in mame.ini on the first
 * pin, so every MAME launch - kiosk, BO probes and sessions - loads it). Resolved under the first
 * entry of `ctrlrpath`, relative to the mame home like every launch's cwd.
 */
const DEFAULT_CTRLR_NAME = 'maui';

function getCtrlrFile(mameInfo: MameInfo): {name: string; path: string; enabled: boolean} {
    const configured = getMameIniValue(mameInfo.mameIniPath, 'ctrlr')?.replace(/^"|"$/g, '') || '';
    const name = configured || DEFAULT_CTRLR_NAME;
    const ctrlrPath = mameInfo.showConfig?.ctrlrpath?.[0] || getMameIniValue(mameInfo.mameIniPath, 'ctrlrpath') || 'ctrlr';
    return {
        name,
        path: join(resolveDirectoryPath(ctrlrPath, mameInfo.iniPath), `${name}.cfg`),
        enabled: !!configured,
    };
}

/** Device id pinned to each JOYCODE number - only once mame.ini actually loads the file. */
function readPinnedDevices(mameInfo: MameInfo): Map<string, string> {
    const ctrlr = getCtrlrFile(mameInfo);
    return ctrlr.enabled && existsSync(ctrlr.path)
        ? readCtrlrMapDevices(readFileSync(ctrlr.path, 'utf8'))
        : new Map<string, string>();
}

function pinDevice(mameInfo: MameInfo, deviceId: string, joycode: string | null): void {
    const ctrlr = getCtrlrFile(mameInfo);
    const existing = existsSync(ctrlr.path) ? readFileSync(ctrlr.path, 'utf8') : undefined;
    mkdirSync(dirname(ctrlr.path), {recursive: true});
    writeFileSync(ctrlr.path, setCtrlrMapDevice(existing, deviceId, joycode), 'utf8');
    if (!ctrlr.enabled && !setMameIniValue(mameInfo.mameIniPath, 'ctrlr', ctrlr.name)) {
        throw new Error(`"${mameInfo.mameIniPath}" not found.`);
    }
}

/**
 * Boots `romName` headlessly just long enough for device-probe.lua to dump every joystick/gamepad
 * device MAME currently detects and exit the machine, then parses the captured stdout. Which rom is
 * booted doesn't matter (device detection isn't per-game), it's only needed because
 * -autoboot_script requires a running machine. -skip_gameinfo avoids an extra keypress-wait;
 * -video none/-sound none skip creating a window or touching the audio device entirely. timeout
 * is a hard backstop in case a driver never reaches "running" (bad rom, missing BIOS) - the Lua
 * script's own machine:exit() should fire in well under a second normally. killSignal SIGKILL
 * (not the default SIGTERM) because a hung mame process can ignore SIGTERM under some video
 * backends. maxBuffer covers MAME's boot-time stdout chatter.
 */
function runDeviceProbe(mameBinary: string, iniPath: string, romName: string): DeviceProbeRow[] {
    const stdout = execFileSync(
        mameBinary,
        [
            romName,
            '-video', 'none',
            '-sound', 'none',
            '-skip_gameinfo',
            '-autoboot_delay', '0',
            '-autoboot_script', join(getStaticPath(), 'lua', 'device-probe.lua'),
            '-inipath', iniPath,
            '-homepath', iniPath,
        ],
        {
            cwd: iniPath,
            encoding: 'utf8',
            timeout: 15000,
            killSignal: 'SIGKILL',
            maxBuffer: 4 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    return parseDeviceProbeOutput(stdout);
}

/**
 * Lists whatever joystick/gamepad devices MAME itself currently sees: its "JOY <n>" number, the
 * USB vendor/product IDs when the device id carries them (see GamepadId.ts), and the raw item
 * name=token pairs (e.g. "LT=SLIDER1") it would accept in a default.cfg <newseq>. Each device can
 * be pinned to a fixed JOY number (see MameCtrlr.ts), since MAME otherwise numbers them in
 * detection order, which follows plug/pairing order.
 */
function renderDeviceProbeCard(romNames: string[], pinned: Map<string, string>, state?: DeviceProbeState): string {
    if (!romNames.length) {
        return '';
    }
    const devices = state?.result ?? [];
    const pinnedJoycodeOf = (deviceId: string): string | undefined =>
        Array.from(pinned.entries()).find(([, device]) => device === deviceId)?.[0];
    const joyLabel = (joycode: string) => `JOY ${joycodeNumber(joycode)}`;
    // Enough JOY numbers for every detected device, and at least P1/P2 for a cabinet.
    const joycodes = Array.from({length: Math.max(2, devices.length)}, (_, i) => `JOYCODE_${i + 1}`);

    const cards = devices.map(device => {
        const ids = parseGamepadIds(device.id);
        const pinnedJoycode = pinnedJoycodeOf(device.id);
        // <mapdevice> matches by id: two identical pads can't be told apart.
        const ambiguous = devices.filter(other => other.id === device.id).length > 1;
        const idValues = ids ? `
            <dt>Vendor</dt>
            <dd><code>${escapeHtml(ids.vendorId)}</code>${ids.vendorName ? ` (${escapeHtml(ids.vendorName)})` : ''}</dd>
            <dt>Product</dt>
            <dd><code>${escapeHtml(ids.productId)}</code></dd>
            ${ids.bus ? `<dt>Bus</dt><dd>${escapeHtml(ids.bus)}</dd>` : ''}
        ` : `
            <dt>Vendor</dt>
            <dd class="info">Not reported by this driver</dd>
        `;
        const pinButtons = joycodes.map(joycode => `
            <button type="submit" name="joycode" value="${joycode}"${joycode === pinnedJoycode ? ' disabled' : ''}>${joyLabel(joycode)}</button>
        `).join('');
        return `
            <article class="device">
                <header class="device-header">
                    ${device.joycode ? `<span class="device-joy">${joyLabel(device.joycode)}</span>` : ''}
                    <h3>${escapeHtml(device.name) || 'Unnamed device'}</h3>
                    ${pinnedJoycode ? `<span class="device-pinned" title="Always ${joyLabel(pinnedJoycode)}, whatever the plug order">Pinned</span>` : ''}
                </header>
                <dl class="binding-values">
                    ${idValues}
                    <dt>MAME ID</dt>
                    <dd><code>${escapeHtml(device.id)}</code></dd>
                </dl>
                ${ambiguous ? `
                    <p class="info">Another detected device has the same MAME ID: MAME can't tell them apart,
                    so neither can be pinned (switch one to another mode, e.g. X-input vs. Switch).</p>
                ` : `
                    <form method="post" action="/input-probe/devices/pin" class="binding-actions device-pin">
                        <input type="hidden" name="deviceId" value="${escapeHtml(device.id)}">
                        <span class="device-pin-label">Pin as</span>
                        ${pinButtons}
                        ${pinnedJoycode ? '<button type="submit" name="joycode" value="">Unpin</button>' : ''}
                    </form>
                `}
                <details>
                    <summary>${device.items.length} buttons/axes</summary>
                    <div class="device-items">${device.items.map(item => `<code>${escapeHtml(item)}</code>`).join(' ')}</div>
                </details>
            </article>
        `;
    }).join('');

    // Pins whose device wasn't in this probe (unplugged, or other mode) - only known after a probe.
    const detectedIds = new Set(devices.map(device => device.id));
    const absentPins = state?.result
        ? Array.from(pinned.entries()).filter(([, deviceId]) => !detectedIds.has(deviceId))
        : [];
    const absentList = absentPins.length ? `
        <h3 class="device-absent-title">Pinned, not connected</h3>
        <ul class="device-absent">
            ${absentPins.map(([joycode, deviceId]) => `
                <li>
                    <span class="device-joy">${joyLabel(joycode)}</span>
                    <code>${escapeHtml(deviceId)}</code>
                    <form method="post" action="/input-probe/devices/pin">
                        <input type="hidden" name="deviceId" value="${escapeHtml(deviceId)}">
                        <button type="submit" name="joycode" value="">Unpin</button>
                    </form>
                </li>
            `).join('')}
        </ul>
    ` : '';

    return `
        <section class="card">
            <h2>Detected devices (MAME probe)</h2>
            <p class="info">Runs a rom in the background (no video or sound) just to ask MAME
            which joysticks/gamepads it currently detects, and under which name/token
            (<code>JOYCODE_&lt;n&gt;_&lt;token&gt;</code>) each of their buttons/axes is
            recognized. JOY 1 plays Player 1 and JOY 2 Player 2 by default; MAME numbers devices in
            detection order unless they're pinned.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            ${state?.info ? `<p class="info flash">${escapeHtml(state.info)}</p>` : ''}
            <form method="post" action="/input-probe/devices">
                <button type="submit">Detect gamepads</button>
            </form>
            ${state?.result ? (cards
                ? `<div class="device-grid">${cards}</div>`
                : '<p class="info flash">No joystick device detected.</p>') : ''}
            ${absentList}
        </section>
    `;
}

interface RemapAction {
    // MAME's own <port type="..."> value - see setDefaultCfgUiInput(). Also doubles as this
    // action's form/state identifier (see the "portType" hidden field and REMAP_ACTIONS_BY_TYPE
    // below), since it's already unique by construction (one cfg port per action).
    portType: string;
    label: string;
}

/**
 * Global (default.cfg, not per-game) actions offered on the Controls tab, grouped for display.
 * Grows over time (see renderControlsCard()'s own comment): MAME's system commands a cabinet
 * needs, then each player's coin, start, directions and buttons.
 */
const REMAP_GROUPS: { title: string; actions: RemapAction[] }[] = [
    {title: 'System', actions: [
        {portType: 'UI_CANCEL', label: 'Quit MAME'},
        {portType: 'UI_PAUSE', label: 'Pause'},
        {portType: 'UI_MENU', label: 'MAME menu'},
        {portType: 'SERVICE', label: 'Service mode'},
        {portType: 'UI_SOFT_RESET', label: 'Soft reset'},
        {portType: 'UI_RESET_MACHINE', label: 'Hard reset'},
    ]},
    {title: 'Player 1', actions: [
        {portType: 'COIN1', label: 'Insert coin'},
        {portType: 'START1', label: 'Start'},
        {portType: 'P1_JOYSTICK_UP', label: 'Up'},
        {portType: 'P1_JOYSTICK_RIGHT', label: 'Right'},
        {portType: 'P1_JOYSTICK_DOWN', label: 'Down'},
        {portType: 'P1_JOYSTICK_LEFT', label: 'Left'},
        {portType: 'P1_BUTTON1', label: 'Button 1'},
        {portType: 'P1_BUTTON2', label: 'Button 2'},
        {portType: 'P1_BUTTON3', label: 'Button 3'},
        {portType: 'P1_BUTTON4', label: 'Button 4'},
        {portType: 'P1_BUTTON5', label: 'Button 5'},
        {portType: 'P1_BUTTON6', label: 'Button 6'},
        {portType: 'P1_BUTTON7', label: 'Button 7'},
        {portType: 'P1_BUTTON8', label: 'Button 8'},
    ]},
    {title: 'Player 2', actions: [
        {portType: 'COIN2', label: 'Insert coin'},
        {portType: 'START2', label: 'Start'},
        {portType: 'P2_JOYSTICK_UP', label: 'Up'},
        {portType: 'P2_JOYSTICK_RIGHT', label: 'Right'},
        {portType: 'P2_JOYSTICK_DOWN', label: 'Down'},
        {portType: 'P2_JOYSTICK_LEFT', label: 'Left'},
        {portType: 'P2_BUTTON1', label: 'Button 1'},
        {portType: 'P2_BUTTON2', label: 'Button 2'},
        {portType: 'P2_BUTTON3', label: 'Button 3'},
        {portType: 'P2_BUTTON4', label: 'Button 4'},
        {portType: 'P2_BUTTON5', label: 'Button 5'},
        {portType: 'P2_BUTTON6', label: 'Button 6'},
        {portType: 'P2_BUTTON7', label: 'Button 7'},
        {portType: 'P2_BUTTON8', label: 'Button 8'},
    ]},
];

const REMAP_ACTIONS_BY_TYPE = new Map<string, RemapAction>(
    REMAP_GROUPS.flatMap(group => group.actions).map(action => [action.portType, action]),
);

interface RemapState {
    // Which action this state is about - renderControlsCard() only shows a flash message on the one
    // form just submitted, not every action's form at once. Empty for the card as a whole (reading
    // MAME's defaults).
    portType: string;
    error?: string;
    // The other actions the control just added also triggers.
    sharedWith?: string[];
    // In-game UI ports (see IN_GAME_UI_PORTS) the captured token was removed from because MAME
    // binds it to them by default - shown so the user knows why e.g. the menu key changed.
    releasedFrom?: string[];
}

/**
 * A running MAME the BO can capture presses through: its capture-daemon.lua directory, the game it
 * runs and what the BO changed meanwhile. Either the BO's own config session or a game launched
 * from MAUI (see AdoptedMame).
 */
interface CaptureTarget {
    dir: string;
    nonceCounter: number;
    // The rom MAME was launched with - the per-game remap card is only valid for that one game
    // (its fields dump, game-fields.txt, describes it and nothing else).
    romName: string;
    // Every cfg edit made while this MAME runs, replayed in order once it exits - see
    // applyCfgEdit().
    cfgEdits: (() => void)[];
    // A saved edit this MAME doesn't use yet (see hasPendingCfgEdits()).
    needsRelaunch: boolean;
}

interface MameConfigSession extends CaptureTarget {
    child: ChildProcess;
}

/**
 * A game launched from MAUI, which runs capture-daemon.lua too (MameService.startGame()): found
 * through its process arguments (findOtherMameTarget()) rather than started here, and watched
 * until it exits to replay the edits made meanwhile, like the BO's own session.
 */
interface AdoptedMame extends CaptureTarget {
    pid: number;
}

// Module-scope: at most one config session at a time, explicitly started/stopped by a BO user from
// the Controls tab (see startMameConfigSession()/stopMameConfigSession()/captureOnePress() below) -
// there's only one cabinet (one MAME window) to configure, so users signed in at the same time
// share it rather than each getting their own.
let mameConfigSession: MameConfigSession | undefined;
// Tells the front the session started or stopped (createBoApp() sets it): no sleep under a game.
let mameSessionChanged: (running: boolean) => void = () => undefined;

function isMameConfigSessionAlive(): boolean {
    return !!mameConfigSession && mameConfigSession.child.exitCode === null && !mameConfigSession.child.killed;
}

let adoptedMame: AdoptedMame | undefined;

/**
 * Picks up the capture-ready game MAUI is running, if any. Called wherever the Controls cards are
 * rendered or act, so the per-game card works on it without a launch from here.
 */
function refreshAdoptedMame(config: Config, romNames: string[]): void {
    if (isMameConfigSessionAlive() || (adoptedMame && isProcessAlive(adoptedMame.pid))) {
        return;
    }
    const known = new Set(romNames);
    for (const pid of findOtherMameProcesses(config)) {
        const args = readProcessArgs(pid);
        const dir = captureDirFromArgs(args);
        const romName = args.find(arg => known.has(arg));
        if (!dir || !romName) {
            continue;
        }
        const adopted: AdoptedMame = {pid, dir, romName, nonceCounter: 0, cfgEdits: [], needsRelaunch: false};
        const watch = setInterval(() => {
            if (isProcessAlive(pid)) {
                return;
            }
            clearInterval(watch);
            if (adoptedMame === adopted) {
                adoptedMame = undefined;
            }
            replayCfgEdits(adopted);
        }, 1000);
        adoptedMame = adopted;
        return;
    }
}

/** The MAME presses are captured through: the BO's own session first, else MAUI's game. */
function getCaptureTarget(): CaptureTarget | undefined {
    if (isMameConfigSessionAlive()) {
        return mameConfigSession;
    }
    return adoptedMame && isProcessAlive(adoptedMame.pid) ? adoptedMame : undefined;
}

// MAME has finished writing its own cfg files by now - see applyCfgEdit().
function replayCfgEdits(target: CaptureTarget): void {
    for (const edit of target.cfgEdits) {
        try {
            edit();
        } catch (error) {
            console.error('[boServer] Failed to replay a cfg edit after MAME exited:', error);
        }
    }
}

// Unique across BO restarts: a daemon still running from before would ignore a nonce it has seen.
function nextNonce(target: CaptureTarget): string {
    return `${Date.now()}-${++target.nonceCounter}`;
}

/**
 * Runs a cfg edit (default.cfg or cfg/<rom>.cfg) and, while a config session is running, records it
 * so it's replayed once that MAME exits. MAME keeps the input settings it loaded at startup in
 * memory and, on a normal exit (its window's close button, Esc...), rewrites its cfg files from
 * them - silently reverting every edit made in the meantime. Checked against 0.289: a default.cfg
 * edited mid-session was back to its startup content after a normal exit, kept as edited after a
 * SIGKILL. Replaying on exit makes both ways of closing MAME equivalent. Edits are replayed rather
 * than the files restored wholesale, so whatever else MAME saves on exit (mixer, counters, settings
 * changed from its own menus) is kept.
 */
function applyCfgEdit(edit: () => void, appliedLive = false): void {
    edit();
    const target = getCaptureTarget();
    if (target) {
        target.cfgEdits.push(edit);
        // Not applied live (see applyGameFieldLive()): the running MAME only picks it up at its
        // next start.
        target.needsRelaunch ||= !appliedLive;
    }
}

/**
 * Rebinds one of the running game's fields right away (capture-daemon.lua's apply.txt), so a
 * per-game capture/reset is usable without relaunching MAME - which then also keeps it when it
 * saves the game's cfg on exit. `seq` empty: back to the field's default. `seqType`: which of an
 * analog field's sequences. False when the daemon didn't confirm in time or failed (logged): the
 * edit then waits for MAME's next start.
 */
function applyGameFieldLive(field: GameField, seq: string, seqType: GameSeqType = 'standard'): boolean {
    const target = getCaptureTarget();
    if (!target) {
        return false;
    }
    const nonce = nextNonce(target);
    writeFileSync(join(target.dir, 'apply.txt'), `${nonce}|${field.tag}|${field.mask}|${seq}|${seqType}`, 'utf8');
    const appliedPath = join(target.dir, 'applied.txt');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && getCaptureTarget() === target) {
        if (existsSync(appliedPath)) {
            const [appliedNonce, result] = readFileSync(appliedPath, 'utf8').split('|');
            if (appliedNonce === nonce) {
                if (result?.trim() !== 'ok') {
                    console.error(`[boServer] Live rebind of ${field.tag}/${field.mask} failed: ${result}`);
                }
                return result?.trim() === 'ok';
            }
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    return false;
}

/**
 * Launches `romName` as a real, visible MAME window (not headless - see capture-daemon.lua's own
 * comment on why) and leaves it running until stopMameConfigSession() kills it. A no-op if a
 * session is already alive: only ever one at a time.
 *
 * This replaced a design that relaunched MAME headlessly for every single button capture: besides
 * the repeated ~1-2s boot cost, each relaunch re-enumerates joystick devices from scratch, and
 * with more than one controller connected MAME doesn't guarantee the same controller keeps the
 * same JOYCODE_<n> index between separate launches - two captures for the very same physical pad,
 * seconds apart, could resolve to different indices. One long-lived session fixes that: every
 * capture during it shares the same, single device enumeration.
 */
function startMameConfigSession(
    mameBinary: string,
    iniPath: string,
    romName: string,
    // The global remap card doesn't care which game the session runs (default.cfg is global), so
    // it keeps whatever is already running; the per-game card needs that very game, and restarts
    // the session on it if another one is running.
    switchRom = false,
): void {
    if (isMameConfigSessionAlive()) {
        if (!switchRom || mameConfigSession?.romName === romName) {
            return;
        }
        stopMameConfigSession();
    }

    const {dir, scriptPath} = prepareCaptureDir(getStaticPath());

    const child = spawn(
        mameBinary,
        [
            romName,
            '-skip_gameinfo',
            // -background_input among them: checked with a virtual uinput pad against 0.289, no
            // press seen unfocused without it (the click on "Add a gamepad button" gives the focus to
            // the browser when the BO runs on the same machine).
            ...captureLaunchArgs(scriptPath),
            '-inipath', iniPath,
            '-homepath', iniPath,
        ],
        {cwd: iniPath, stdio: ['ignore', 'ignore', 'pipe']},
    );
    child.stderr?.on('data', (chunk: Buffer) => {
        console.error('[boServer] mame config session stderr:', chunk.toString('utf8').trim());
    });
    const session: MameConfigSession = {child, dir, nonceCounter: 0, romName, cfgEdits: [], needsRelaunch: false};
    child.on('exit', () => {
        if (mameConfigSession === session) {
            mameConfigSession = undefined;
            mameSessionChanged(false);
        }
        replayCfgEdits(session);
        rmSync(dir, {recursive: true, force: true});
    });

    mameConfigSession = session;
    mameSessionChanged(true);
}

/**
 * MAME processes running the configured binary that aren't the BO's own config session: a game
 * launched from the MAUI front end or by hand. The launch button shows "Close MAME" for them too,
 * instead of offering to open a second MAME next to the one already on screen.
 */
function findOtherMameProcesses(config: Config): number[] {
    const sessionPid = isMameConfigSessionAlive() ? mameConfigSession?.child.pid : undefined;
    return findMameProcesses(config.mamePath ? join(config.mamePath, config.mameBinaryName) : '')
        .filter(pid => pid !== sessionPid);
}

function isAnyMameRunning(config: Config): boolean {
    return isMameConfigSessionAlive() || findOtherMameProcesses(config).length > 0;
}

/**
 * The game a MAME the BO didn't start is running (MAUI passes the rom name as a bare argument),
 * so the per-game card can open on it: the usual reason to go there is fixing the controls of the
 * game just played.
 */
function findOtherMameRom(config: Config, romNames: string[]): string | undefined {
    const known = new Set(romNames);
    for (const pid of findOtherMameProcesses(config)) {
        const rom = readProcessArgs(pid).find(arg => known.has(arg));
        if (rom) {
            return rom;
        }
    }
    return undefined;
}

/**
 * Cfg edits made during the running config session that it doesn't use yet: MAME reads its input
 * bindings once, at startup, and capture-daemon.lua only reports presses - it applies nothing.
 */
function hasPendingCfgEdits(): boolean {
    return !!getCaptureTarget()?.needsRelaunch;
}

/**
 * Warning shown on the Controls cards once a capture/reset is saved but not yet in effect in the
 * running MAME - the relaunch button itself sits at the top of the page (see renderForm()).
 */
function renderPendingRelaunchNotice(): string {
    if (!hasPendingCfgEdits()) {
        return '';
    }
    // MAUI's game isn't relaunched from here (that would end the player's game for a BO session):
    // the change is simply there next time it's played.
    return isMameConfigSessionAlive()
        ? `<p class="warn flash"><strong>Saved, not active yet:</strong> the running MAME keeps the
            controls it started with. Click <strong>Apply controls</strong> at the top of the page to
            try the new ones.</p>`
        : `<p class="warn flash"><strong>Saved, not active yet:</strong> the game being played keeps
            the controls it started with. <strong>Apply controls</strong> relaunches it with the new
            ones (ending the game in progress), else they apply the next time it's launched.</p>`;
}

/**
 * Kills whatever MAME is running - the BO's own config session and any MAME it didn't start - and
 * waits until it's gone, so a session started right after doesn't run next to it (and reads the
 * cfg files once the killed session's edits are replayed, see applyCfgEdit()).
 */
async function stopEveryMame(config: Config): Promise<void> {
    const session = isMameConfigSessionAlive() ? mameConfigSession : undefined;
    const sessionExited = session
        ? new Promise<void>(resolve => session.child.once('exit', () => resolve()))
        : Promise.resolve();
    stopMameConfigSession();
    await Promise.all([sessionExited, stopMameProcesses(findOtherMameProcesses(config))]);
    // MAUI's game is gone too: its edits are replayed now rather than by its watch (up to a second
    // later), so a MAME started right after reads them ("Apply controls" on the per-game card).
    if (adoptedMame && !isProcessAlive(adoptedMame.pid)) {
        const adopted = adoptedMame;
        adoptedMame = undefined;
        replayCfgEdits(adopted);
        adopted.cfgEdits = [];
    }
}

function stopMameConfigSession(): void {
    if (isMameConfigSessionAlive()) {
        // SIGKILL, not the default SIGTERM - confirmed by hand that a real windowed MAME process
        // just ignores SIGTERM outright (same "hung mame process can ignore SIGTERM under some
        // video backends" reason runDeviceProbe() already uses it for).
        mameConfigSession?.child.kill('SIGKILL');
    }
}

/**
 * Arms the running config session for one press and blocks - poll/sleep, same spirit as the
 * execFileSync-based probes elsewhere in this file, just spread across a loop instead of one
 * syscall - until it reports a result or CAPTURE_WAIT_MS runs out (generous: the user may need
 * to walk over to the cabinet's pad; the session runs with -background_input, see
 * startMameConfigSession(), so MAME doesn't need the focus). Returns the exact token MAME resolved the press to (e.g. "JOYCODE_1_BUTTON5"), null
 * if no session is running or nothing was captured in time. `axis`: waits for an axis moved
 * instead (a spinner, a mouse, a stick: e.g. "MOUSECODE_1_XAXIS"), for an analog control.
 */
function captureOnePress(axis = false): string | null {
    const session = getCaptureTarget();
    if (!session) {
        return null;
    }
    const nonce = nextNonce(session);
    writeFileSync(join(session.dir, 'request.txt'), axis ? `${nonce}|axis` : nonce, 'utf8');

    const CAPTURE_WAIT_MS = 30000;
    const resultPath = join(session.dir, 'result.txt');
    const deadline = Date.now() + CAPTURE_WAIT_MS;
    while (Date.now() < deadline) {
        if (getCaptureTarget() !== session) {
            return null;
        }
        if (existsSync(resultPath)) {
            const [resultNonce, token] = readFileSync(resultPath, 'utf8').split('|');
            if (resultNonce === nonce && token) {
                rmSync(resultPath, {force: true});
                return token.trim();
            }
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
    return null;
}

/**
 * UI ports that fire *during* a game (not just inside a MAME menu) and ship with a joystick
 * button in their defaults - so a button remapped for anything else would trigger them as well.
 * Menu navigation ports (UI_SELECT, UI_UP, ...) also default to joystick buttons but are only
 * live while a menu is open, and stripping those would cripple the pad inside MAME's own menus.
 */
const IN_GAME_UI_PORTS = ['UI_MENU'];

const UI_PORT_LABELS: Record<string, string> = {
    UI_MENU: 'the MAME configuration menu (Tab key)',
};

/**
 * MAME doesn't take a button away from another port when default.cfg gives it to a new one: the
 * press then feeds both. (Observed on 0.289: UI_CANCEL on JOYCODE_1_BUTTON9 also opened UI_MENU's
 * config menu, its default binding.) So for every IN_GAME_UI_PORTS entry other than `portType`
 * whose effective sequence holds `token` - default.cfg's override if any, else what MAME reported
 * at session start (capture-daemon.lua's ui-seqs.txt), else MAME's defaults when the Controls
 * card read them (`defaults`) - writes that sequence back without it. Returns the ports it changed.
 */
function releaseTokenFromInGameUiPorts(cfgPath: string, portType: string, token: string, defaults?: InputDefaults): string[] {
    const target = getCaptureTarget();
    const seqsPath = target ? join(target.dir, 'ui-seqs.txt') : undefined;
    const sessionSeqs = seqsPath && existsSync(seqsPath) ? parseUiSeqs(readFileSync(seqsPath, 'utf8')) : new Map<string, string>();
    const overrides = readDefaultCfgUiInputs(cfgPath);

    const released: string[] = [];
    for (const otherPort of IN_GAME_UI_PORTS) {
        const effective = overrides.get(otherPort) ?? sessionSeqs.get(otherPort) ?? defaults?.seqs.get(otherPort);
        if (otherPort === portType || !effective) {
            continue;
        }
        const stripped = removeTokenFromSeq(effective, token);
        // null: the token was the port's only binding - leave it rather than hand-write an empty
        // sequence (see setDefaultCfgUiInput()'s note on hand-written <newseq> values).
        if (stripped && stripped !== effective) {
            applyCfgEdit(() => setDefaultCfgUiInput(cfgPath, otherPort, stripped));
            released.push(otherPort);
        }
    }
    return released;
}

function getDefaultCfgPath(iniPath: string): string {
    return join(iniPath, 'cfg', 'default.cfg');
}

/**
 * Small hand-rolled edit of default.cfg's <input> block - not a general XML parser, and
 * deliberately not: MAME rewrites this file in its own canonical form on its next normal exit
 * regardless of the exact whitespace/attribute order used here. Only ever touches
 * <port type="..."><newseq type="standard">TOKEN</newseq></port> entries directly under
 * <system name="default"><input>, and only with `token` sourced from MAME's own
 * input:code_to_token() (see capture-daemon.lua) - never hand-guessed. That matters: MAME's cfg
 * loader was empirically observed to drop its *entire* <input> block (including an otherwise-valid
 * sibling entry) on the next boot after a single bad <newseq> token was written by hand.
 */
/**
 * Reads the <port type="..."><newseq type="standard">TOKEN</newseq></port> entries directly under
 * <system name="default"><input> - the same regex setDefaultCfgUiInput() below uses to avoid
 * clobbering them, exposed separately so renderControlsCard() can show what's actually persisted for
 * every action, not just whichever one a request just captured.
 */
function readDefaultCfgUiInputs(cfgPath: string): Map<string, string> {
    const ports = new Map<string, string>();
    if (!existsSync(cfgPath)) {
        return ports;
    }
    const inputBlockMatch = /<input>[\s\S]*?<\/input>/.exec(readFileSync(cfgPath, 'utf8'));
    if (!inputBlockMatch) {
        return ports;
    }
    const portRegex = /<port type="([^"]+)">\s*<newseq type="standard">([\s\S]*?)<\/newseq>\s*<\/port>/g;
    let match: RegExpExecArray | null;
    while ((match = portRegex.exec(inputBlockMatch[0])) !== null) {
        ports.set(match[1], match[2].trim());
    }
    return ports;
}

/**
 * Rewrites default.cfg's <input> block with exactly `ports` - shared by setDefaultCfgUiInput() and
 * removeDefaultCfgUiInput() below. An empty map drops the block altogether rather than leaving an
 * empty <input></input> behind.
 */
function writeDefaultCfgUiInputs(cfgPath: string, ports: Map<string, string>): void {
    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
    </system>
</mameconfig>
`;

    // Whole lines only (the block's own indentation and line break): matching from "<input>" to
    // the next non-blank character instead made every rewrite indent the block a bit further.
    const inputBlockMatch = /[ \t]*<input>[\s\S]*?<\/input>[ \t]*\n?/.exec(existing);

    const newInputBlock = !ports.size ? '' : '        <input>\n'
        + Array.from(ports.entries()).map(([type, seq]) => ''
            + `            <port type="${type}">\n`
            + '                <newseq type="standard">\n'
            + `                    ${seq}\n`
            + '                </newseq>\n'
            + '            </port>\n').join('')
        + '        </input>\n';

    const updated = inputBlockMatch
        ? existing.slice(0, inputBlockMatch.index) + newInputBlock + existing.slice(inputBlockMatch.index + inputBlockMatch[0].length)
        : existing.replace(/(<system name="default">\s*\n)/, `$1${newInputBlock}`);

    mkdirSync(dirname(cfgPath), {recursive: true});
    writeFileSync(cfgPath, updated, 'utf8');
}

function setDefaultCfgUiInput(cfgPath: string, portType: string, token: string): void {
    const ports = readDefaultCfgUiInputs(cfgPath);
    ports.set(portType, token);
    writeDefaultCfgUiInputs(cfgPath, ports);
}

/**
 * Drops `portType`'s override from default.cfg, so MAME falls back to its own default binding for
 * it. A no-op when there's no such override (nothing to rewrite).
 */
function removeDefaultCfgUiInput(cfgPath: string, portType: string): void {
    const ports = readDefaultCfgUiInputs(cfgPath);
    if (ports.delete(portType)) {
        writeDefaultCfgUiInputs(cfgPath, ports);
    }
}

/**
 * MAME's own bindings (before default.cfg) and the keyboard/mouse codes it knows, read by
 * input-defaults.lua (runInputDefaultsProbe() below) and kept in mame-input-defaults.json next to
 * MAUI's config: booting MAME for them takes seconds, and they only change with the MAME binary.
 */
interface InputDefaultsCache {
    binary: string;
    mtimeMs: number;
    seqs: Record<string, string>;
    codes: Record<string, string>;
}

function getInputDefaultsCachePath(): string {
    return join(dirname(new Config().configPath), 'mame-input-defaults.json');
}

function getBinaryMtime(mameBinary: string): number | undefined {
    try {
        return statSync(mameBinary).mtimeMs;
    } catch {
        return undefined;
    }
}

/** The cached defaults, undefined when missing or read from another (or since replaced) binary. */
function readInputDefaults(mameBinary: string): InputDefaults | undefined {
    const cachePath = getInputDefaultsCachePath();
    if (!existsSync(cachePath)) {
        return undefined;
    }
    try {
        const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as InputDefaultsCache;
        if (cache.binary !== mameBinary || cache.mtimeMs !== getBinaryMtime(mameBinary)) {
            return undefined;
        }
        return {seqs: new Map(Object.entries(cache.seqs)), codes: new Map(Object.entries(cache.codes))};
    } catch {
        return undefined;
    }
}

/**
 * Boots `romName` headlessly, like runDeviceProbe(), on an empty cfg directory: MAME then loads no
 * default.cfg, so the sequences input-defaults.lua prints are MAME's own (its Lua has no other way
 * to tell them once default.cfg changed one). Caches what it read, see readInputDefaults().
 */
function runInputDefaultsProbe(mameBinary: string, iniPath: string, romName: string): InputDefaults {
    const cfgDirectory = mkdtempSync(join(os.tmpdir(), 'maui-input-defaults-'));
    try {
        const stdout = execFileSync(
            mameBinary,
            [
                romName,
                '-video', 'none',
                '-sound', 'none',
                '-skip_gameinfo',
                '-autoboot_delay', '0',
                '-autoboot_script', join(getStaticPath(), 'lua', 'input-defaults.lua'),
                '-inipath', iniPath,
                '-homepath', iniPath,
                '-cfg_directory', cfgDirectory,
            ],
            {
                cwd: iniPath,
                encoding: 'utf8',
                timeout: 15000,
                killSignal: 'SIGKILL',
                maxBuffer: 4 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        const defaults = parseInputDefaults(stdout);
        if (!defaults.seqs.size) {
            throw new Error('MAME reported no input.');
        }
        const cache: InputDefaultsCache = {
            binary: mameBinary,
            mtimeMs: getBinaryMtime(mameBinary) ?? 0,
            seqs: Object.fromEntries(defaults.seqs),
            codes: Object.fromEntries(defaults.codes),
        };
        writeFileSync(getInputDefaultsCachePath(), JSON.stringify(cache), 'utf8');
        return defaults;
    } finally {
        rmSync(cfgDirectory, {recursive: true, force: true});
    }
}

/** What MAME uses for `portType`: default.cfg's sequence if it has one, else MAME's own. */
function getControlSeq(portType: string, persisted: Map<string, string>, defaults: InputDefaults): string {
    return persisted.get(portType) ?? defaults.seqs.get(portType) ?? '';
}

/**
 * Saves `seq` as `portType`'s binding in default.cfg, or drops its entry when `seq` is MAME's own
 * binding again: default.cfg then only holds what differs from MAME.
 */
function saveControlSeq(cfgPath: string, portType: string, seq: string, defaults: InputDefaults): void {
    const normalized = seqFromAlternatives(seqAlternatives(seq));
    const isDefault = normalized === seqFromAlternatives(seqAlternatives(defaults.seqs.get(portType) ?? ''));
    applyCfgEdit(() => isDefault
        ? removeDefaultCfgUiInput(cfgPath, portType)
        : setDefaultCfgUiInput(cfgPath, portType, normalized));
}

/** The other actions of the Controls card `alternative` already triggers. */
function findControlsSharing(
    portType: string, alternative: string, persisted: Map<string, string>, defaults: InputDefaults,
): string[] {
    return REMAP_GROUPS.flatMap(group => group.actions
        .filter(action => action.portType !== portType
            && seqAlternatives(getControlSeq(action.portType, persisted, defaults)).includes(alternative))
        .map(action => (group.title === 'System' ? action.label : `${group.title} ${action.label}`)));
}

const CONTROL_KIND_LABELS: Record<string, string> = {
    keyboard: 'Keyboard',
    mouse: 'Mouse',
    joystick: 'Gamepad',
    lightgun: 'Light gun',
    other: 'Other',
};

/**
 * What triggers an action, one pill per `OR` alternative of `seq` with its device in front and a
 * cross posting `remove` - shared by the global and per-game Controls cards, inside their form.
 */
function renderControlChips(seq: string, names: Map<string, string>): string {
    const chips = seqAlternatives(seq).map(alternative => {
        const kind = seqAlternativeKind(alternative);
        const label = describeSeqAlternative(alternative, names);
        return `
            <li class="control-chip control-chip-${kind}" title="${escapeHtml(alternative)}">
                <span class="control-kind">${escapeHtml(CONTROL_KIND_LABELS[kind])}</span>
                <span>${escapeHtml(label)}</span>
                <button type="submit" name="remove" value="${escapeHtml(alternative)}"
                    class="control-remove" aria-label="Remove ${escapeHtml(label)}">✕</button>
            </li>
        `;
    }).join('');
    return `
        <ul class="control-chips">
            ${chips || '<li class="control-none">No control: this action can\'t be used</li>'}
        </ul>
    `;
}

/**
 * The two ways to add a control: a gamepad press caught by MAME (`capture`), and a key or mouse
 * button caught by the page (renderPageTail()'s data-control-listen script, which posts `add` with
 * the token in `code`) - only offered once MAME's keys are known (`canListen`). `rawCodes`: the
 * page posts the browser's own codes ("key|KeyA", "mouse|2") instead of MAME tokens (MAUI's tab),
 * and also listens to the gamepads itself while the front catches the press (data-pad-listen).
 */
function renderControlAddButtons(captureDisabled: string, canListen: boolean, rawCodes = false): string {
    return `
        <div class="binding-actions">
            <button type="submit" name="action" value="capture"${captureDisabled}${rawCodes ? ' data-pad-listen' : ''}>Add a gamepad button</button>
            ${canListen ? `
                <button type="button" data-control-listen${rawCodes ? '="raw"' : ''}>Add a key or mouse button</button>
                <input type="hidden" name="code" value="">
                <button type="submit" name="action" value="add" hidden data-control-add></button>
            ` : ''}
        </div>
    `;
}

/**
 * Global controls: every REMAP_GROUPS action with everything that triggers it in MAME (keyboard
 * keys, mouse buttons, gamepad buttons and directions), MAME's own binding unless default.cfg
 * changed it. Each one can be removed (its cross), and new ones added - pressed while MAME runs
 * (captureOnePress() above, which adds to what is there instead of replacing it), or picked from
 * the keyboard keys and mouse buttons MAME itself listed. Written straight into default.cfg
 * (saveControlSeq() above). "Back to MAME's default" drops the action's entry again.
 * Groups/actions are meant to keep growing in REMAP_GROUPS - this only renders whatever's in it,
 * no other change needed to add more.
 */
function renderControlsCard(
    romNames: string[], persisted: Map<string, string>, defaults: InputDefaults | undefined, state?: RemapState,
): string {
    if (!romNames.length) {
        return '';
    }
    const cardError = state && !state.portType && state.error
        ? `<p class="error flash">${escapeHtml(state.error)}</p>` : '';
    if (!defaults) {
        return `
            <section class="card">
                <h2>Global controls</h2>
                <p class="info">Shows which keys, mouse buttons and gamepad buttons do what in MAME,
                for every game, and lets you add or remove them. MAUI first reads MAME's own
                controls: it starts MAME in the background (no window) for a few seconds, once for
                this MAME.</p>
                ${cardError}
                <form method="post" action="/input-probe/controls/defaults">
                    <button type="submit">Read MAME's controls</button>
                </form>
            </section>
        `;
    }
    const sessionRunning = !!getCaptureTarget();
    // A gamepad press is only seen by a running MAME; a key or a mouse button is taken by the page
    // itself, and removing needs nothing.
    const captureDisabled = sessionRunning ? '' : ' disabled title="Launch MAME first"';
    // What the page may send for a key or a mouse button: only tokens MAME itself listed.
    const listenKeys = Object.fromEntries(Object.entries(browserKeyTokens()).filter(([, token]) => defaults.codes.has(token)));
    const listenMouse = [0, 1, 2, 3, 4].map(button => browserMouseToken(button))
        .map(token => (token && defaults.codes.has(token) ? token : ''));

    const renderActionItems = (actions: RemapAction[]): string => actions
        .filter(action => defaults.seqs.has(action.portType))
        .map(action => {
            const actionState = state?.portType === action.portType ? state : undefined;
            return `
                <div class="binding">
                    ${renderBindingLabel(action.portType, action.label)}
                    <form method="post" action="/input-probe/remap" class="control-form">
                        <input type="hidden" name="portType" value="${escapeHtml(action.portType)}">
                        ${renderControlChips(getControlSeq(action.portType, persisted, defaults), defaults.codes)}
                        ${renderControlAddButtons(captureDisabled, true)}
                        ${persisted.has(action.portType) ? `
                            <div class="binding-actions">
                                <button type="submit" name="action" value="reset">Back to MAME's default</button>
                            </div>
                        ` : ''}
                    </form>
                    ${actionState?.error ? `<p class="error flash">${escapeHtml(actionState.error)}</p>` : ''}
                    ${actionState?.sharedWith?.length ? `
                        <p class="warn flash">Also used by ${escapeHtml(actionState.sharedWith.join(', '))}: it
                        triggers both. Remove it there if that isn't wanted.</p>
                    ` : ''}
                    ${actionState?.releasedFrom?.length ? `
                        <p class="info flash">This button was also bound to
                        ${escapeHtml(actionState.releasedFrom.map(port => UI_PORT_LABELS[port] ?? port).join(', '))} in
                        MAME - it was removed from there to avoid a double trigger.</p>
                    ` : ''}
                </div>
            `;
        }).join('');

    return `
        <section class="card">
            <h2>Global controls</h2>
            <p class="info">What triggers each MAME action, in every game (unless a game has its own
            controls, below). Each one is a key, a mouse button or a gamepad button: its
            <strong>✕</strong> removes it, and the others keep working.</p>
            <ul class="info">
                <li><strong>Add a gamepad button</strong>: launch MAME with the button at the top of
                the page first, then click and press the gamepad button (or push the direction)
                within 30 seconds - MAME picks it up even when its window is not the one in front.</li>
                <li><strong>Add a key or mouse button</strong>: click, then press the key or click
                the mouse button (anywhere in the page) on the keyboard and mouse of this computer.
                No need to launch MAME. Keys are named after their place on a US keyboard, the way
                MAME does: on an AZERTY keyboard, the A key shows as Q.</li>
                <li><strong>Back to MAME's default</strong> gives the action MAME's own controls again.</li>
            </ul>
            <p class="info">Saved at once in <code>default.cfg</code>; a running MAME uses the change
            from its next start.</p>
            ${cardError}
            ${renderPendingRelaunchNotice()}
            ${renderPlayerTabs('global', REMAP_GROUPS.map((group, index) => ({
                id: String(index),
                title: group.title,
                html: `<div class="binding-grid">${renderActionItems(group.actions)}</div>`,
            })), state?.portType ? String(REMAP_GROUPS.findIndex(group => group.actions.some(action => action.portType === state.portType))) : undefined)}
            <script type="application/json" id="control-listen-codes">${
                JSON.stringify({keys: listenKeys, mouse: listenMouse}).replace(/</g, '\\u003c')
            }</script>
            <form method="post" action="/input-probe/controls/defaults" class="control-reread">
                <button type="submit">Read MAME's controls again</button>
            </form>
        </section>
    `;
}

interface PlayerPanel {
    // Short slug, unique within the card - what the tab button and its panel are matched on.
    id: string;
    title: string;
    html: string;
}

/**
 * One tab per player (plus "System"/"Other" where there is one) instead of every player's table
 * stacked one after the other - the Controls cards grow long otherwise. Switched client side (see
 * renderPageTail()); `activeId` is the panel to open on, e.g. the one holding the command just
 * captured, so a capture on Player 2 doesn't land back on Player 1.
 */
function renderPlayerTabs(cardId: string, panels: PlayerPanel[], activeId?: string): string {
    return `
        <div class="player-tabs" role="tablist" data-player-tabs="${escapeHtml(cardId)}"
            ${activeId ? `data-active="${escapeHtml(activeId)}"` : ''}>
            ${panels.map(panel => `
                <button type="button" role="tab" data-player-tab="${escapeHtml(panel.id)}">${escapeHtml(panel.title)}</button>
            `).join('')}
        </div>
        ${panels.map(panel => `
            <div class="player-panel" role="tabpanel" data-player-panel="${escapeHtml(`${cardId}:${panel.id}`)}">${panel.html}</div>
        `).join('')}
    `;
}

/**
 * The device MAME reads each family of analog controls from (mame.ini's <family>_device): with
 * MAME's own default, `keyboard`, a spinner game like Arkanoid only moves with the arrow keys,
 * even though its dial is bound to the mouse's X axis - MAME doesn't read the mouse at all. USB
 * spinners and trackballs show up as a mouse. `mouse` here only enables it for the games that
 * have that kind of control, unlike mame.ini's `mouse 1` (every game).
 */
const ANALOG_DEVICE_OPTIONS: readonly {key: string; label: string; examples: string}[] = [
    {key: 'dial_device', label: 'Spinner (dial)', examples: 'Arkanoid, Tempest'},
    {key: 'trackball_device', label: 'Trackball', examples: 'Centipede, Marble Madness'},
    {key: 'paddle_device', label: 'Paddle', examples: 'Breakout, Super Breakout'},
];

const ANALOG_DEVICE_VALUES: readonly {value: string; label: string}[] = [
    {value: 'keyboard', label: 'Keyboard only (MAME default)'},
    {value: 'mouse', label: 'Mouse, USB spinner or trackball'},
    {value: 'joystick', label: 'Gamepad stick'},
];

interface AnalogDevicesState {
    error?: string;
    saved?: boolean;
}

function renderAnalogDevicesCard(romNames: string[], mameIniPath: string, state?: AnalogDevicesState): string {
    if (!romNames.length) {
        return '';
    }
    const rows = ANALOG_DEVICE_OPTIONS.map(option => {
        const current = getMameIniValue(mameIniPath, option.key) || 'keyboard';
        // A value set by hand that isn't one of ours stays selected rather than silently changed.
        const values = ANALOG_DEVICE_VALUES.some(value => value.value === current)
            ? ANALOG_DEVICE_VALUES
            : [...ANALOG_DEVICE_VALUES, {value: current, label: current}];
        return `
            <label class="analog-device">
                <span>${escapeHtml(option.label)} <span class="checkbox-row-detail">${escapeHtml(option.examples)}</span></span>
                <select name="${escapeHtml(option.key)}">
                    ${values.map(value => `
                        <option value="${escapeHtml(value.value)}"${value.value === current ? ' selected' : ''}>${escapeHtml(value.label)}</option>
                    `).join('')}
                </select>
            </label>
        `;
    }).join('');
    return `
        <section class="card">
            <h2>Spinner, trackball, paddle</h2>
            <p class="info">What MAME reads the analog controls of games like Arkanoid (spinner) or
            Centipede (trackball) from. With the keyboard, they only move with the arrow keys:
            pick <strong>Mouse</strong> for a mouse or a USB spinner or trackball (they show up as a
            mouse), only in the games that have such a control. Saved in <code>mame.ini</code>; a
            running MAME uses it from its next start.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            ${state?.saved ? '<p class="info flash">Saved.</p>' : ''}
            <form method="post" action="/input-probe/analog-devices" class="analog-devices">
                ${rows}
                <button type="submit">Save</button>
            </form>
        </section>
    `;
}

interface GameRemapState {
    // Which game/field this state is about - like RemapState, only that field's row shows the
    // flash message rather than every row at once.
    romName: string;
    fieldId?: string;
    error?: string;
    // The game's other commands the control just added also triggers.
    sharedWith?: string[];
    releasedFrom?: string[];
}

function getGameCfgPath(iniPath: string, romName: string): string {
    return join(iniPath, 'cfg', `${romName}.cfg`);
}

/**
 * The remappable fields of the game the config session is running, as dumped by
 * capture-daemon.lua at startup. undefined while there's no session, or while MAME is still
 * booting and hasn't written the dump yet.
 */
function readSessionGameFields(): GameField[] | undefined {
    const target = getCaptureTarget();
    if (!target) {
        return undefined;
    }
    const fieldsPath = join(target.dir, 'game-fields.txt');
    // Written just before game-fields.txt (absent with a daemon from before analog controls).
    const analogPath = join(target.dir, 'game-analog.txt');
    return existsSync(fieldsPath)
        ? parseGameFields(
            readFileSync(fieldsPath, 'utf8'),
            existsSync(analogPath) ? readFileSync(analogPath, 'utf8') : '',
        ).sort(compareGameFields)
        : undefined;
}

/**
 * Blocks (same poll/sleep spirit as captureOnePress()) until the freshly launched session has
 * dumped its game's fields, so the per-game card lists the commands right away instead of asking
 * the user to reload it. Gives up silently after `timeoutMs`: the card then says MAME is still
 * starting.
 */
function waitForSessionGameFields(timeoutMs: number): void {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && isMameConfigSessionAlive() && !readSessionGameFields()) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
}

/**
 * Which way an analog control's `increment`/`decrement` keys move it: MAME increments rightwards
 * on a horizontal axis (a spinner turned clockwise), downwards on a vertical one.
 */
function analogKeyDirection(portType: string, seqType: GameSeqType): string {
    const increment = seqType === 'increment';
    if (/_(?:V|Y)$/.test(portType)) {
        return increment ? 'down' : 'up';
    }
    if (/_(?:PEDAL\d?|Z)$/.test(portType)) {
        return increment ? 'more' : 'less';
    }
    return increment ? 'right' : 'left';
}

/** What a game's field uses for `seqType` without an entry of its own in the game's cfg. */
function getInheritedGameSeq(field: GameField, seqType: GameSeqType): string {
    return seqType === 'standard' ? field.defaultSeq : field.analog?.[seqType] ?? '';
}

function readGameCfgOverrides(cfgPath: string, seqType: GameSeqType = 'standard'): Map<string, string> {
    return existsSync(cfgPath) ? readGameCfgInputSeqs(readFileSync(cfgPath, 'utf8'), seqType) : new Map<string, string>();
}

function setGameCfgOverride(cfgPath: string, romName: string, field: GameField, token: string, seqType: GameSeqType = 'standard'): void {
    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : undefined;
    mkdirSync(dirname(cfgPath), {recursive: true});
    writeFileSync(cfgPath, setGameCfgInputSeq(existing, romName, field, token, seqType), 'utf8');
}

function removeGameCfgOverride(cfgPath: string, field: GameField, seqType: GameSeqType = 'standard'): void {
    if (!existsSync(cfgPath)) {
        return;
    }
    const existing = readFileSync(cfgPath, 'utf8');
    const updated = removeGameCfgInputSeq(existing, field, seqType);
    if (updated !== existing) {
        writeFileSync(cfgPath, updated, 'utf8');
    }
}

/**
 * Per-game controls - same pills as the global card above (renderControlChips(), add by gamepad
 * press or by key/mouse in the page, remove one), but written to cfg/<rom>.cfg instead of
 * default.cfg and applied live, so it only applies to that game and wins over the global
 * bindings. A command left with what it inherits loses its entry. The commands listed are the ones the
 * game really has (from the running MAME itself, see capture-daemon.lua's game-fields.txt), not a
 * fixed list: a 2-button game shows 2 buttons.
 */
function renderGameRemapCard(
    romNames: string[], romLabels: Map<string, string>, withCfg: Set<string>, iniPath: string, state?: GameRemapState,
    // A game running in a MAME the BO didn't start (launched from MAUI): picked by default.
    otherRom?: string,
    // MAME's key names and the keys the page may add (see the global card), once read.
    defaults?: InputDefaults,
): string {
    if (!romNames.length) {
        return '';
    }
    // The game MAME is running with the capture daemon - the BO's own session or MAUI's game
    // (see getCaptureTarget()): its commands are listed and rebound live.
    const targetRom = getCaptureTarget()?.romName;
    const fromMaui = !!targetRom && !isMameConfigSessionAlive();
    const selectedRom = state?.romName ?? targetRom ?? otherRom
        ?? [...romNames].sort((a, b) => (romLabels.get(a) ?? a).localeCompare(romLabels.get(b) ?? b))[0];
    const picker = renderRomPicker('gameRemapRomName', romNames, romLabels, withCfg, selectedRom);
    // Once a change is saved for the running game, relaunching it is what puts the change in effect
    // (see hasPendingCfgEdits()): the button says so and stands out, like the global "Apply controls".
    const applyPending = targetRom === selectedRom && hasPendingCfgEdits();
    const gameLaunchLabel = applyPending ? 'Apply controls'
        : selectedRom === targetRom || selectedRom === otherRom ? 'Relaunch MAME with this game' : 'Launch MAME with this game';

    const renderTable = (romName: string): string => {
        const fields = readSessionGameFields();
        if (!fields) {
            return `<p class="info flash">MAME is still starting <strong>${escapeHtml(romLabels.get(romName) ?? romName)}</strong> -
            click the button above again in a few seconds to show its commands.</p>`;
        }
        if (!fields.length) {
            return '<p class="info flash">This game exposes no remappable command (directions, buttons, coin, start, spinner...).</p>';
        }
        const cfgPath = getGameCfgPath(iniPath, romName);
        const overrides = new Map(GAME_SEQ_TYPES.map(seqType => [seqType, readGameCfgOverrides(cfgPath, seqType)]));
        const players = Array.from(new Set(fields.map(field => portTypePlayer(field.portType))));

        // One sequence of a command: the only one of a button, one of the three of an analog control.
        const renderSeqForm = (field: GameField, seqType: GameSeqType): string => {
            const id = gameFieldId(field);
            const override = overrides.get(seqType)?.get(id);
            const axis = !!field.analog && seqType === 'standard';
            const title = !field.analog ? '' : axis ? 'Movement (spinner, mouse, stick)'
                : `Keys: ${analogKeyDirection(field.portType, seqType)}`;
            return `
                <form method="post" action="/input-probe/game/remap" class="control-form">
                    <input type="hidden" name="romName" value="${escapeHtml(romName)}">
                    <input type="hidden" name="fieldId" value="${escapeHtml(id)}">
                    <input type="hidden" name="seqType" value="${seqType}">
                    ${title ? `<p class="control-seq-title">${title}</p>` : ''}
                    <p class="control-origin">${override !== undefined ? 'This game only' : 'From the global controls'}</p>
                    ${renderControlChips(override ?? getInheritedGameSeq(field, seqType), defaults?.codes ?? new Map<string, string>())}
                    ${axis ? `
                        <div class="binding-actions">
                            <button type="submit" name="action" value="capture-axis">Add a movement</button>
                        </div>
                    ` : renderControlAddButtons('', !!defaults)}
                    ${override !== undefined ? `
                        <div class="binding-actions">
                            <button type="submit" name="action" value="reset">Back to the global controls</button>
                        </div>
                    ` : ''}
                </form>
            `;
        };

        const renderItems = (playerFields: GameField[]): string => playerFields.map(field => {
            const id = gameFieldId(field);
            const rowState = state?.fieldId === id ? state : undefined;
            return `
                <div class="binding">
                    ${renderBindingLabel(field.portType, field.name || field.portType)}
                    ${(field.analog ? GAME_SEQ_TYPES : ['standard' as const]).map(seqType => renderSeqForm(field, seqType)).join('')}
                    ${rowState?.error ? `<p class="error flash">${escapeHtml(rowState.error)}</p>` : ''}
                    ${rowState?.sharedWith?.length ? `
                        <p class="warn flash">Also used by ${escapeHtml(rowState.sharedWith.join(', '))} in this game:
                        it triggers both. Remove it there if that isn't wanted.</p>
                    ` : ''}
                    ${rowState?.releasedFrom?.length ? `
                        <p class="info flash">This button was also bound by default to
                        ${escapeHtml(rowState.releasedFrom.map(port => UI_PORT_LABELS[port] ?? port).join(', '))} in
                        MAME - it was removed from there (globally) to avoid a double trigger.</p>
                    ` : ''}
                </div>
            `;
        }).join('');

        const stateField = fields.find(field => gameFieldId(field) === state?.fieldId);
        return renderPlayerTabs('game', players.map(player => ({
            id: String(player),
            title: player ? `Player ${player}` : 'Other',
            html: `<div class="binding-grid">${renderItems(fields.filter(field => portTypePlayer(field.portType) === player))}</div>`,
        })), stateField ? String(portTypePlayer(stateField.portType)) : undefined);
    };

    return `
        <section class="card">
            <h2>Per-game controls</h2>
            <p class="info">Changes what triggers a command in <strong>one game only</strong>
            (saved in <code>cfg/&lt;rom&gt;.cfg</code>); every other game keeps the global
            controls above.</p>
            ${targetRom && targetRom === selectedRom ? `
                <ol class="info">
                    <li>Below, each card is a command of this game, with what triggers it: <em>From the
                    global controls</em> as long as you haven't changed it for this game. Its
                    <strong>✕</strong> removes one, and the others keep working.</li>
                    <li><strong>Add a gamepad button</strong>: click, then press the button (or push the
                    direction) on the gamepad within 30 seconds - MAME picks it up even when its window
                    is not the one in front. <strong>Add a key or mouse button</strong>: click, then
                    press the key or click the mouse button in this page.</li>
                    <li>A spinner, trackball or paddle (Arkanoid's <em>Dial</em>...) has a
                    <strong>Movement</strong>: <strong>Add a movement</strong>, then wait a second
                    and turn the spinner, move the mouse or push the stick. Its keys move it each
                    way. MAME only reads the mouse or a USB spinner when the
                    <strong>Spinner, trackball, paddle</strong> card above says so.</li>
                    <li>Each change is saved and works in the running game at once.</li>
                    <li><strong>Back to the global controls</strong> drops what this game had of its
                    own for a command. ${fromMaui
                        ? 'Keep playing when you are done: the changes are kept.'
                        : `When you are done, close MAME with the button at the top of the page or
                        from its own window: either way keeps the changes.`}</li>
                </ol>
            ` : otherRom && otherRom === selectedRom ? `
                <p class="warn"><strong>${escapeHtml(romLabels.get(otherRom) ?? otherRom)}</strong> is
                running, launched from MAUI. Its controls can only be changed from a MAME started
                here: <strong>Relaunch MAME with this game</strong> closes the running game and
                reopens it ready for configuration. Relaunch it from MAUI once done.</p>
            ` : `
                <ol class="info">
                    <li>Search and pick the game below, then click <strong>Launch MAME with this
                    game</strong>: the game opens in a MAME window.</li>
                    <li>Its list of commands appears here, ready to be changed.</li>
                </ol>
            `}
            <form method="post" action="/input-probe/game/start">
                ${picker}
                <button type="submit"${applyPending ? ' class="button-attention"' : ''}>${gameLaunchLabel}</button>
            </form>
            ${targetRom === selectedRom ? renderPendingRelaunchNotice() : ''}
            ${targetRom ? `
                <p><strong>MAME:</strong> running ${escapeHtml(romLabels.get(targetRom) ?? targetRom)}${fromMaui ? ', launched from MAUI' : ''}</p>
            ` : ''}
            ${state?.error && !state.fieldId ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            ${targetRom && targetRom === selectedRom ? renderTable(targetRom) : ''}
        </section>
    `;
}

/**
 * Danger zone for mame-awesome-ui's own data (config file, database - see Config.class.ts /
 * Database.class.ts). Rendered on the "maui" tab. See renderMameDangerZoneCard() above for the
 * MAME-side counterpart on the "mame" tab.
 */
// What each Danger zone checkbox of the MAUI tab deletes: the parts of the export (MauiBackup.ts).
const MAUI_DELETIONS: readonly {part: BackupPartId; field: string; label: string}[] = [
    {part: 'config', field: 'deleteConfig', label: 'the configuration (mame-awesome-ui-config.json, removed favorites, MAUI controls)'},
    {part: 'database', field: 'deleteDatabase', label: 'the database (games, players, scores) and the players\' avatars'},
    {part: 'caches', field: 'deleteCaches', label: 'the ScreenScraper caches (favorites, publishers and developers)'},
    {
        part: 'online', field: 'deleteOnline',
        label: 'the ONLINE session (online.json): MAUI-API then sees a new machine, which needs a new configuration string',
    },
];

/** ~/.mame-awesome-ui as the Danger zone shows it. */
function getMauiHomeLabel(): string {
    return dirname(new Config().configPath);
}

function renderMauiDangerZoneCard(info?: string): string {
    return `
        <section class="card">
            <h2>Danger zone</h2>
            <p class="error">Targeted, irreversible deletions of mame-awesome-ui's own data
            (~/.mame-awesome-ui). Each checkbox acts independently of the others - tick what you want
            to delete, then submit. Deleting the configuration, the database or the ONLINE session
            then restarts the application.</p>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/reset" onsubmit="
                var items = [];
                var boxes = this.deleteMauiHome.checked ? [this.deleteMauiHome] : this.querySelectorAll('input[data-label]:checked');
                boxes.forEach(function (box) { items.push(box.dataset.label); });
                if (!items.length) { return true; }
                return confirm('Permanently delete ' + items.join(', ') + '? This cannot be undone.');
            ">
                <input type="hidden" name="zone" value="maui">
                ${MAUI_DELETIONS.map(deletion => `
                <label class="checkbox-row">
                    <input type="checkbox" name="${deletion.field}" data-label="${escapeHtml(deletion.label.split(' (')[0])}">
                    Delete ${escapeHtml(deletion.label)}
                </label>`).join('')}
                <label class="checkbox-row">
                    <input type="checkbox" name="deleteMauiHome" data-label="the whole ${escapeHtml(getMauiHomeLabel())} directory" onchange="
                        var whole = this.checked;
                        [${MAUI_DELETIONS.map(deletion => `this.form.${deletion.field}`).join(', ')}].forEach(function (box) {
                            if (whole) {
                                box.dataset.ticked = box.checked ? '1' : '';
                                box.checked = true;
                            } else {
                                box.checked = box.dataset.ticked === '1';
                            }
                            box.disabled = whole;
                        });
                    ">
                    <span>
                        Delete the whole <code>${escapeHtml(getMauiHomeLabel())}</code> directory
                        <span class="checkbox-row-detail">Includes the options above, plus anything else
                        left in it - the application starts again as on its first launch.</span>
                    </span>
                </label>
                <button type="submit" class="button-danger">Delete the selection</button>
            </form>
        </section>
    `;
}

function renderForm(
    values: ConfigFormValues,
    mameInfo: MameInfo,
    isAdvanced: boolean,
    error?: string,
    info?: string,
    mameInfoMessage?: string,
    importError?: string,
    dangerZoneInfo?: string,
    deviceProbeState?: DeviceProbeState,
    remapState?: RemapState,
    gameRemapState?: GameRemapState,
    exportError?: string,
    analogDevicesState?: AnalogDevicesState,
): string {
    // Loaded fresh rather than threaded through every renderForm() call site (there are many -
    // see /save, /mame-options/repair-plugins, /reset, etc.) purely for the repo card's
    // credential fields; a sync JSON read is cheap and every route already re-loads Config at
    // least once per request anyway.
    const config = new Config();
    config.load();

    // Controls first, the tab shown by default (everyday cabinet tuning); Config, set once, last.
    const sections: Subsection[] = [];
    // Import and the danger zone both act on paths resolved from the binary's own -showconfig/
    // ui.ini output (rompath, marquees/flyers/logos directories, categorypath...) - until it's
    // configured and validated (mameInfo.error unset), those paths don't exist, so none of these
    // sections have anything meaningful to show or act on.
    if (!mameInfo.error) {
        // Starting packs are MAME-only content (roms/artwork/favorites/categories/player
        // counts, all resolved from this same MAME install) - kept on this tab instead of
        // its own, next to the MAME info it depends on and updates.
        // Always shown, not part of Advanced configuration: gamepad setup is everyday cabinet
        // tuning (the actions spawn MAME on the machine hosting the BO and rewrite default.cfg,
        // game cfgs and the controller file - input bindings only, nothing destructive).
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romLabels = config.mamePath && config.mameBinaryName
            ? getRomLabels(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romNames)
            : new Map<string, string>();
        const withCfg = listRomsWithInputCfg(mameInfo.iniPath, romNames);
        refreshAdoptedMame(config, romNames);
        const inputDefaults = config.mamePath ? readInputDefaults(join(config.mamePath, config.mameBinaryName)) : undefined;
        sections.push({
            id: 'controls',
            label: 'Controls',
            html: renderControlsCard(
                romNames,
                readDefaultCfgUiInputs(getDefaultCfgPath(mameInfo.iniPath)),
                inputDefaults,
                remapState,
            )
                + renderAnalogDevicesCard(romNames, mameInfo.mameIniPath, analogDevicesState)
                + renderGameRemapCard(romNames, romLabels, withCfg, mameInfo.iniPath, gameRemapState,
                    findOtherMameRom(config, romNames), inputDefaults)
                + renderDeviceProbeCard(romNames, readPinnedDevices(mameInfo), deviceProbeState),
        });
        sections.push({
            id: 'import',
            label: 'Import / Export',
            html: renderImportSection(mameInfo, importError, exportError),
        });
        // Destructive/irreversible - only shown (and only actionable, see /reset) in Advanced configuration.
        if (isAdvanced) {
            sections.push({
                id: 'danger',
                label: 'Danger',
                html: renderMameDangerZoneCard(mameInfo, dangerZoneInfo),
            });
        }
    }
    // The MAME information (paths resolved from the binary) right under the form that sets it.
    sections.push({id: 'config', label: 'Config', html: renderConfigCard(values, mameInfo, error, info)
        + renderMameInfoCard(mameInfo, mameInfoMessage)});
    // Which of the params above is actually filled in tells us which section this specific
    // response is about - e.g. a POST to /reset only ever sets dangerZoneInfo, nothing
    // else, regardless of what other sections might separately have a standing .flash warning
    // of their own (missing plugins...) that would otherwise wrongly win just for
    // being earlier in `sections` (see renderPageTail()'s script). Most specific first.
    const defaultSubtab = dangerZoneInfo !== undefined ? 'danger'
        : importError !== undefined || exportError !== undefined ? 'import'
            : (deviceProbeState !== undefined || remapState !== undefined
                || gameRemapState !== undefined || analogDevicesState !== undefined) ? 'controls'
                : (mameInfoMessage !== undefined || error !== undefined || info !== undefined) ? 'config'
                    // Controls otherwise, even when Config holds a standing warning (missing plugins...).
                    : sections.some(section => section.id === 'controls') ? 'controls' : undefined;
    // Right of the subtabs (kept in view while scrolling, see .subtabs-bar): the one button that
    // launches/closes the shared MAME config session the Controls cards capture through - see
    // startMameConfigSession(). Shown to every signed-in user, like the Controls tab itself.
    // data-mame-session lets the page notice MAME being closed from its own window (see
    // renderPageTail()). A MAME the BO didn't start (a game launched from MAUI...) counts too:
    // closing it is what the button then offers.
    // Once a capture/reset is saved during the session, "Apply controls" comes first and stands
    // out: MAME only picks the change up at its next start (see hasPendingCfgEdits()).
    const mameRunning = isAnyMameRunning(config);
    const relaunchButton = isMameConfigSessionAlive() && hasPendingCfgEdits() ? `
        <form method="post" action="/input-probe/mame/restart">
            <button type="submit" class="launch-button button-attention">
                <img src="/mame-logo.svg" alt="" class="launch-logo">
                Apply controls
            </button>
        </form>
    ` : '';
    const launchButton = `
        <div class="launch-buttons">
            ${relaunchButton}
            <form method="post" action="/input-probe/mame/${mameRunning ? 'stop' : 'start'}"
                ${mameRunning ? 'data-mame-session="running"' : ''}>
                <button type="submit" class="launch-button">
                    <img src="/mame-logo.svg" alt="" class="launch-logo">
                    ${mameRunning ? 'Close MAME' : 'Launch MAME'}
                </button>
            </form>
        </div>
    `;
    return renderSubtabbedPage('mame', sections, isAdvanced ? 'advanced' : 'basic', defaultSubtab, launchButton);
}

interface GithubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GithubRelease {
    tag_name: string;
    name: string | null;
    body: string | null;
    published_at: string;
    prerelease: boolean;
    assets: GithubReleaseAsset[];
}

interface UpdateReleaseEntry {
    tagName: string;
    name: string;
    publishedAt: string;
    assetUrl: string | null;
    isCurrent: boolean;
    // A version under the running one: only installed in Advanced configuration.
    isOlder: boolean;
    isPrerelease: boolean;
}

interface UpdateInfo {
    capable: boolean;
    // The dedicated Linux layout only: there the new version waits for a restart of the session.
    // On Windows the installer restarts the application itself.
    canRestart: boolean;
    currentVersion: string;
    releases: UpdateReleaseEntry[];
    devBuilds: UpdateReleaseEntry[];
    releasesError?: string;
}


// The dedicated-system layout (KioskRestart.ts, SelfUpdate.ts).
function isKioskLayout(): boolean {
    return isKioskInstall();
}

// Where the MAUI tab offers the Network and Bluetooth cards (WifiControl.ts, BluetoothControl.ts):
// a dedicated cabinet, which has no other way to join a Wi-Fi or pair a gamepad than a keyboard or
// SSH. A desktop has its own settings for both; in development the cards show there too, to work
// on them.
function isNetworkControlHost(): boolean {
    return isKioskLayout() || (process.platform === 'linux' && process.env.NODE_ENV === 'development');
}

let releasesCache: {fetchedAt: number; releases: GithubRelease[]} | null = null;
const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000;

// Public GitHub Releases - no auth needed (repo is public), so this is safe to call for every
// viewer, Advanced configuration or not. Cached briefly so repeatedly loading the MAUI tab doesn't burn
// through the anonymous API's 60 req/h/IP rate limit. Includes both real releases (tagged on
// main by semantic-release) and dev prereleases (tagged on every push to develop by build.yml,
// see its "Publish develop prerelease" job) - GitHub's /releases endpoint returns both, told
// apart by the `prerelease` flag.
async function fetchGithubReleases(): Promise<GithubRelease[]> {
    if (releasesCache && Date.now() - releasesCache.fetchedAt < GITHUB_CACHE_TTL_MS) {
        return releasesCache.releases;
    }
    const response = await fetch(MAUI_RELEASES_URL, {
        headers: {Accept: 'application/vnd.github+json'},
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const releases = await response.json() as GithubRelease[];
    releasesCache = {fetchedAt: Date.now(), releases};
    return releases;
}

/**
 * Computes everything the "Update" subtab needs to render: the public releases list (any
 * BO role can see/install those), split into real releases and develop prereleases (the latter
 * only rendered in Advanced configuration, see renderUpdateCard()). Called by every route that (re-)renders
 * the MAUI page, same as getMameInfo() is recomputed fresh by every route touching the MAME tab.
 */
async function getUpdateInfo(): Promise<UpdateInfo> {
    const info: UpdateInfo = {
        capable: isSelfUpdateCapable(),
        canRestart: isKioskLayout(),
        currentVersion: getRunningVersion(),
        releases: [],
        devBuilds: [],
    };

    try {
        const releases = await fetchGithubReleases();
        const entries = releases.map((release): UpdateReleaseEntry => {
            const assetNames = release.assets.map(a => a.name);
            const assetName = findInstallAsset(assetNames);
            const asset = release.assets.find(a => a.name === assetName);
            return {
                tagName: release.tag_name,
                name: release.name || release.tag_name,
                publishedAt: release.published_at,
                assetUrl: asset ? asset.browser_download_url : null,
                isCurrent: release.tag_name === info.currentVersion,
                isOlder: isOlderVersion(release.tag_name, info.currentVersion),
                isPrerelease: release.prerelease,
            };
        });
        // Sorted here, not left in the API's order - see sortByPublishedDesc().
        info.releases = limitOlderReleases(
            sortByPublishedDesc(entries.filter(entry => !entry.isPrerelease)), info.currentVersion,
        );
        info.devBuilds = sortByPublishedDesc(entries.filter(entry => entry.isPrerelease));
    } catch (error) {
        info.releasesError = error instanceof Error ? error.message : 'unexpected error';
    }

    return info;
}

/**
 * The BO's block for an installation (SelfUpdate.ts): a progress bar over every step, the same
 * figures as the front's update screen (describeUpdateStep()), and a log line as each step starts
 * and ends, with its duration - the extraction alone takes a minute or more on a Raspberry Pi.
 * Writes the open card; `close()` ends it.
 */
function openUpdateBlock(res: Response, title: string): {
    progress: UpdateProgress; line: (text: string) => void; endStep: () => void; close: (ok: boolean) => void;
} {
    res.write(`
        <section class="card">
            <h2>${escapeHtml(title)}</h2>
            <div class="import-progress" id="updateProgress">
                <div class="progress-label"><span data-label>Starting…</span><span data-percent></span></div>
                <div class="progress-track"><div class="progress-fill progress-indeterminate" data-fill></div></div>
            </div>
            <script>
            window.mauiUpdateBar = function (percent, label, state) {
                var root = document.getElementById('updateProgress');
                var fill = root.querySelector('[data-fill]');
                fill.classList.toggle('progress-indeterminate', percent === null && !state);
                fill.classList.toggle('progress-done', state === 'done');
                fill.classList.toggle('progress-failed', state === 'failed');
                fill.style.width = (state ? 100 : percent === null ? 100 : percent) + '%';
                root.querySelector('[data-label]').textContent = label;
                root.querySelector('[data-percent]').textContent = percent === null || state ? '' : percent + '%';
            };
            </script>
            ${PROGRESS_LOG_OPEN}
    `);
    const line = (text: string): void => {
        console.log(`[boServer] Update: ${text}`);
        res.write(`<li>${escapeHtml(text)}</li>`);
    };
    const bar = (percent: number | null, label: string, state = ''): void => {
        res.write(`<script>mauiUpdateBar(${percent === null ? 'null' : percent},${JSON.stringify(label).replace(/</g, '\\u003c')},${JSON.stringify(state)})</script>`);
    };
    const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    const startedAt = Date.now();
    let current: {step: string; at: number; summary: string} | null = null;
    const seconds = (since: number): string => `${Math.max(1, Math.round((Date.now() - since) / 1000))} s`;
    // The step under way's summary line, once (the next step, the end).
    const endStep = (): void => {
        if (current?.summary) {
            line(`${current.summary} in ${seconds(current.at)}.`);
            current.summary = '';
        }
    };
    const progress: UpdateProgress = (step) => {
        if (current?.step !== step.step) {
            endStep();
            current = {step: step.step, at: Date.now(), summary: ''};
            if (step.step === 'download') {
                line(step.totalBytes ? `Downloading ${megabytes(step.totalBytes)}…` : 'Downloading…');
            } else if (step.step === 'extract') {
                line(step.totalEntries
                    ? `Extracting the new version (about ${step.totalEntries} files, as many as the installed one)…`
                    : 'Extracting the new version…');
            } else if (step.step === 'switch') {
                line('Switching versions: the running one is kept as ~/squashfs-root.old, for a manual rollback.');
            } else if (step.step === 'cleanup') {
                line('Removing the temporary files and the older backup…');
            }
        }
        if (step.step === 'download') {
            current.summary = `Downloaded ${megabytes(step.doneBytes)}`;
        } else if (step.step === 'extract') {
            current.summary = `Extracted ${step.entries} files`;
        } else if (step.step === 'cleanup') {
            current.summary = 'Removed';
        }
        const screen = describeUpdateStep(step);
        const label = screen.label.charAt(0) + screen.label.slice(1).toLowerCase();
        bar(screen.percent, `${label} — ${screen.detail}`);
    };
    return {
        progress,
        line,
        endStep,
        close: (ok) => {
            endStep();
            line(ok ? `Done in ${seconds(startedAt)}.` : `Stopped after ${seconds(startedAt)}.`);
            bar(100, ok ? 'Installed' : 'Failed — see the log below', ok ? 'done' : 'failed');
            res.write('</ul></section>');
        },
    };
}

/**
 * Windows: downloads the installer of the version picked and returns its path, or null after a
 * failure (reported in the block). The caller runs it once the page is sent: the installer closes
 * this very process.
 */
async function downloadWindowsInstallerLogged(res: Response, title: string, downloadUrl: string): Promise<string | null> {
    const block = openUpdateBlock(res, title);
    let installerPath: string | null = null;
    try {
        installerPath = await downloadWindowsInstaller(downloadUrl, block.progress);
        block.endStep();
        block.line('Starting the installer: the application closes, updates and reopens on the new version.');
    } catch (error) {
        block.line(`Failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
    }
    block.close(installerPath !== null);
    return installerPath;
}

/**
 * Dedicated Linux cabinet: installs the version into ~/squashfs-root (SelfUpdate.ts
 * installAppImage()), streaming its progress the same way as runImportScript() above - res must
 * already have its page head written. Whether it was installed.
 */
async function runUpdateInstall(res: Response, title: string, downloadUrl: string): Promise<boolean> {
    const block = openUpdateBlock(res, title);
    let installed = false;
    try {
        await installAppImage(downloadUrl, block.progress);
        block.endStep();
        block.line('Update installed. The previous version stays available in ~/squashfs-root.old '
            + 'while the new one is being validated.');
        installed = true;
    } catch (error) {
        block.line(`Failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
    }
    block.close(installed);
    return installed;
}

/**
 * `<script>` for a page shown while the process serving it is about to go down and come back
 * (a reset that closes the app, a kiosk session restart): it polls this same BO server until it
 * answers again, then goes to `backHref` - rather than relying on the user to come back on their
 * own once it is up.
 */
/**
 * What happens once the application closes after a Danger zone deletion or a MAUI import (onReset
 * in background.ts, which makes the same choice: AppRelaunch.ts), and the script that brings the
 * page back as soon as the server answers again.
 */
async function renderRelaunchNotice(what: string, backHref: string): Promise<string> {
    const mode = await chooseRelaunch({
        isPackaged: electronApp.isPackaged, kiosk: isKioskLayout(), canRestartKiosk,
        devRelaunchFile: process.env.MAUI_DEV_RELAUNCH_FILE,
    })
        .catch((): RelaunchMode => 'manual');
    const restart = mode === 'manual'
        ? '<p>The application will close in a moment. <strong>Relaunch it manually</strong> to '
            + `${what} (<code>just serve</code> in development) - reloading this page or the application `
            + 'is not enough: the screen keeps what it was built on in memory until the process has '
            + 'fully restarted.</p>'
        : `<p>The application restarts by itself in a moment to ${what}${mode === 'kiosk'
            ? ': the screen goes blank, then the cabinet comes back' : ''}.</p>`;
    return restart
        + '<p id="restart-wait-message" class="info">Waiting for the restart… this page will automatically '
        + 'take you back as soon as the server is available again.</p>'
        + renderRestartWaitScript(backHref);
}

function renderRestartWaitScript(backHref: string): string {
    // Only trusts a successful response *after* one has already failed: right after the page
    // loads the old process may still be up for a moment (the exit/restart is delayed so this
    // response can finish flushing), and an immediate success there would just bounce straight
    // back with nothing actually restarted yet.
    return `<script>${
        'var backHref = ' + JSON.stringify(backHref) + ';'
        + 'var sawDown = false;'
        // Where it stands and for how long, after the page's own message: a restart takes a while
        // on a Raspberry Pi, and a still page looked stuck.
        + 'var message = document.getElementById("restart-wait-message");'
        + 'var base = message ? message.textContent : "";'
        + 'var started = Date.now();'
        + 'var show = function (state) {'
        + 'if (message) { message.textContent = base + " " + state + " (" + Math.round((Date.now() - started) / 1000) + " s)"; }'
        + '};'
        + 'var poll = function () {'
        + 'fetch(backHref, {cache: "no-store", method: "HEAD"}).then(function () {'
        + 'if (sawDown) { show("Back up, opening the page."); window.location.href = backHref; }'
        + 'else { show("The running version is closing…"); setTimeout(poll, 1000); }'
        + '}).catch(function () { sawDown = true; show("Restarting…"); setTimeout(poll, 1000); });'
        + '};'
        + 'setTimeout(poll, 1000);'
    }</script>`;
}

const INSTALL_ICON_PATHS = '<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>';

function renderUpdateReleaseRow(
    release: UpdateReleaseEntry, capable: boolean, isAdvanced: boolean, confirmLabel: string,
): string {
    // What the row is, next to its name; the last column only ever holds the install icon.
    let status = '';
    let action = '';
    if (release.isCurrent) {
        status = '<span class="badge-yes">current version</span>';
    } else if (release.isOlder && !isAdvanced) {
        // Going back to an earlier version is refused by the route too (/maui/update/install).
        status = '<span class="badge-deleted" title="Installed in Advanced configuration only">earlier version</span>';
    } else if (!release.assetUrl) {
        status = '<span class="badge-warn">no artifact for this platform</span>';
    } else {
        action = `
            <form method="post" action="/maui/update/install" data-stream
                onsubmit="return confirm('${confirmLabel.replace('{tag}', escapeHtml(release.tagName))}')">
                <input type="hidden" name="tagName" value="${escapeHtml(release.tagName)}">
                ${renderIconButton(`Install version ${release.tagName}`, INSTALL_ICON_PATHS, 'accent', !capable)}
            </form>
        `;
    }
    return `
        <tr>
            <td>${escapeHtml(release.name)}${status ? ` ${status}` : ''}</td>
            <td>${escapeHtml(formatPublishedAt(release.publishedAt))}</td>
            <td class="center">${action}</td>
        </tr>
    `;
}

/** The releases as a table laid out like the favorites': the name takes what the fixed columns leave. */
function renderUpdateTable(rows: string, emptyLabel: string): string {
    return `
        <div class="table-wrap update-table">
            <table class="favorites-table fixed-columns">
                <colgroup>
                    <col>
                    <col class="col-published">
                    <col class="col-action">
                </colgroup>
                <thead>
                    <tr><th>Version</th><th>Published on</th><th class="center"></th></tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="3"><em>${emptyLabel}</em></td></tr>`}</tbody>
            </table>
        </div>
    `;
}

function renderUpdateCard(
    updateInfo: UpdateInfo, isAdvanced: boolean, installMessage?: string, installError?: string,
): string {
    // Dedicated cabinet: the session restarts once the version is installed (SelfUpdate.ts).
    // Windows: the installer closes the application and starts it again by itself.
    const afterInstall = updateInfo.canRestart
        ? 'MAUI restarts by itself on it once it is downloaded.'
        : 'The application closes and reopens on that version.';
    const confirmRelease = `Install version {tag}? ${afterInstall}`;
    const releaseRows = updateInfo.releases
        .map(release => renderUpdateReleaseRow(release, updateInfo.capable, isAdvanced, confirmRelease))
        .join('');

    const confirmDevBuild = `Install the development build {tag} (not promoted to main)? ${afterInstall}`;
    const devBuildRows = updateInfo.devBuilds
        .map(release => renderUpdateReleaseRow(release, updateInfo.capable, isAdvanced, confirmDevBuild))
        .join('');

    return `
        <section class="card">
            <h2>Update</h2>
            <p class="info">Currently installed version: <strong>${escapeHtml(updateInfo.currentVersion)}</strong></p>
            ${updateInfo.capable ? `<p class="info">Installing a version downloads it, then ${updateInfo.canRestart
                ? 'restarts MAUI by itself on it (the screen goes blank for a moment): any game in progress is closed'
                : 'closes the application, which reopens on it'}.</p>` : ''}
            ${updateInfo.canRestart ? `
                <form method="post" action="/maui/update/restart"
                    onsubmit="return confirm('Restart the application now? The screen goes blank for a moment, then it reopens on the version installed in ~/squashfs-root.')">
                    <button type="submit">Restart the application</button>
                </form>
                <p class="info">Relaunches the cabinet session on the version installed (an installation
                restarts it by itself; needed only when that restart failed). Any game in progress is closed.</p>
            ` : ''}
            ${!updateInfo.capable ? `
                <p class="error">Automatic installation is unavailable on this machine (expected, not in
                development: on Linux, the AppImage extracted in ~/squashfs-root - see
                docs/RASPBERRY-PI-DEPLOY.md; on Windows, the application installed by its installer, not
                the portable .exe of the earlier versions). Releases can still be browsed below.</p>
            ` : ''}
            ${installError ? `<p class="error flash">${escapeHtml(installError)}</p>` : ''}
            ${installMessage ? `<p class="info flash">${escapeHtml(installMessage)}</p>` : ''}
            ${updateInfo.releasesError
                ? `<p class="error">Unable to fetch the GitHub releases: ${escapeHtml(updateInfo.releasesError)}</p>`
                : renderUpdateTable(releaseRows, 'No release found.')}
        </section>
        ${isAdvanced ? `
            <section class="card">
                <h2>Development builds (unpublished)</h2>
                <p class="error">GitHub prereleases generated automatically on every push to
                develop (workflow "Build") - not yet promoted to main, meant for testing only.</p>
                ${!updateInfo.releasesError ? renderUpdateTable(devBuildRows, 'No build available.') : ''}
            </section>
        ` : ''}
    `;
}

/** The mode "auto" comes down to on this machine - what App.vue works out for the front. */
function getAutoUiMode(): UiMode {
    let gpuCompositing: string | undefined;
    try {
        gpuCompositing = (electronApp.getGPUFeatureStatus() as unknown as Record<string, string>).gpu_compositing;
    } catch {
        // Left undefined: the memory alone decides (UiMode.ts).
    }
    return resolveUiMode('auto', {totalMemBytes: os.totalmem(), gpuCompositing});
}

/**
 * The screen and sound outputs of a dedicated cabinet (VideoOutput.ts, AudioOutput.ts), as this
 * machine has them now. A saved output not found now (a screen unplugged) stays offered.
 */
function renderCabinetOutputSelects(config: Config): string {
    let outputs: ScreenOutputInfo[] = [];
    try {
        outputs = listScreenOutputs();
    } catch {
        // No X server reachable: Automatic only.
    }
    const devices = listAudioDevices();
    const option = (value: string, label: string, selected: boolean) =>
        `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const videoOptions = [
        option('', 'Automatic (as the system starts it)', config.videoOutput === ''),
        ...outputs.map(output => option(output.name,
            `${output.name} - ${output.connected ? 'screen connected' : 'nothing connected'}`, config.videoOutput === output.name)),
        ...(config.videoOutput && !outputs.some(output => output.name === config.videoOutput)
            ? [option(config.videoOutput, `${config.videoOutput} - not found now`, true)] : []),
    ].join('');
    // What "Same as the screen output" comes down to now, named like the other choices.
    const followed = resolveAudioOutput(FOLLOW_SCREEN, currentScreenOutput(config.videoOutput, outputs), devices);
    const followedLabel = devices.find(device => device.id === followed)?.label ?? 'the system default';
    const audioOptions = [
        option(FOLLOW_SCREEN, `Same as the screen output (now: ${followedLabel})`, config.audioOutput === FOLLOW_SCREEN),
        option('', 'System default (/etc/asound.conf)', config.audioOutput === ''),
        ...devices.map(device => option(device.id, `${device.label} (${device.id})`, config.audioOutput === device.id)),
        ...(config.audioOutput && config.audioOutput !== FOLLOW_SCREEN && !devices.some(device => device.id === config.audioOutput)
            ? [option(config.audioOutput, `${config.audioOutput} - not found now`, true)] : []),
    ].join('');
    return `
        <label for="videoOutput">Screen output <span class="checkbox-row-detail">The port the screen is plugged in. Applied the next time the cabinet starts; MAME follows it.</span></label>
        <select id="videoOutput" name="videoOutput">${videoOptions}</select>
        <label for="audioOutput">Sound output <span class="checkbox-row-detail">HDMI sound comes out of the screen (its speakers or its headphone socket). The next game uses it at once, MAUI's own sounds at its next start.</span></label>
        <select id="audioOutput" name="audioOutput">${audioOptions}</select>
    `;
}

/** The carousel categories switched on in the MAUI tab, to tell whether a save changed them. */
function shownCategories(config: Config): string {
    return [config.showAllGamesCategory, config.showBeatThisCategory, config.showHiscoresOnlyCategory].join();
}

/** One checkbox of the MAUI card: a short label, and what it does in smaller text below. */
function renderSettingCheckbox(name: string, checked: boolean, label: string, detail?: string): string {
    return `
                <label class="checkbox-row">
                    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
                    <span>${label}${detail ? ` <span class="checkbox-row-detail">${detail}</span>` : ''}</span>
                </label>`;
}

// One form and one Save for the whole card (POST /maui/save), its settings grouped by what they
// act on: the screen, the list of games, the idle cabinet, the players, this back office.
function renderMauiCard(config: Config, isAdvanced: boolean, info?: string): string {
    const autoUiMode = getAutoUiMode() === 'lite' ? 'Lite' : 'Full';
    return `
        <section class="card">
            <h2>mame-awesome-ui</h2>
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/maui/save">
                <fieldset class="settings-group">
                    <legend>Screen</legend>
                    ${renderSettingCheckbox('fullscreen', config.fullscreen, 'Fullscreen', 'Unticked, the front opens in a window.')}
                    <label for="uiMode">Interface</label>
                    <select id="uiMode" name="uiMode">
                        <option value="auto" ${config.uiMode === 'auto' ? 'selected' : ''}>Automatic (${autoUiMode} on this machine)</option>
                        <option value="lite" ${config.uiMode === 'lite' ? 'selected' : ''}>Lite - no animations, blurs or shadows, for a Raspberry Pi 3 and the like</option>
                        <option value="full" ${config.uiMode === 'full' ? 'selected' : ''}>Full</option>
                    </select>
                    ${isKioskLayout() ? `
                        <label for="displayMode">Screen mode <span class="checkbox-row-detail">Applied the next time the cabinet starts; MAME follows it.</span></label>
                        <select id="displayMode" name="displayMode">
                            <option value="auto" ${config.displayMode === 'auto' ? 'selected' : ''}>Automatic (1080p at most, 720p with the Lite interface)</option>
                            <option value="1080p" ${config.displayMode === '1080p' ? 'selected' : ''}>1080p</option>
                            <option value="720p" ${config.displayMode === '720p' ? 'selected' : ''}>720p</option>
                            <option value="native" ${config.displayMode === 'native' ? 'selected' : ''}>Leave the screen as it is</option>
                        </select>
                        ${renderCabinetOutputSelects(config)}
                    ` : ''}
                    ${renderSettingCheckbox('onlineBadgeDotOnly', config.onlineBadgeDotOnly, 'ONLINE badge: the dot alone',
                        'In the top right corner of the cabinet, without ONLINE / OFFLINE.')}
                    ${renderSettingCheckbox('onlineBadgeHideIp', config.onlineBadgeHideIp, 'ONLINE badge: hide the local IP address',
                        'Unticked, the badge shows the cabinet\'s address on the local network 10 seconds every minute, the Wi-Fi\'s first.')}
                    ${isAdvanced ? renderSettingCheckbox('openDevTools', config.openDevTools, 'Open DevTools on startup', 'Development mode.') : ''}
                </fieldset>
                <fieldset class="settings-group">
                    <legend>List of games</legend>
                    ${renderSettingCheckbox('showAllGamesCategory', config.showAllGamesCategory, 'Show the "All Games" category')}
                    ${renderSettingCheckbox('showBeatThisCategory', config.showBeatThisCategory, 'Show the "Beat This!" category',
                        'The games players have a score on, the one scored on last first.')}
                    ${renderSettingCheckbox('showHiscoresOnlyCategory', config.showHiscoresOnlyCategory, 'Show the "Hiscores Only" category',
                        'The games whose hiscores can be extracted.')}
                </fieldset>
                <fieldset class="settings-group">
                    <legend>When nobody plays</legend>
                    ${renderSettingCheckbox('frontIdleEnabled', config.frontIdleEnabled, 'Idle curtain',
                        'The cabinet shows the latest best scores of the fleet (its own while OFFLINE).')}
                    <label for="frontIdleMinutes">Minutes before the idle curtain comes down <span class="checkbox-row-detail">Without a key press on the list of games.</span></label>
                    <input type="number" id="frontIdleMinutes" name="frontIdleMinutes" min="1" max="120" step="1" value="${config.frontIdleMinutes}">
                    ${renderSettingCheckbox('frontIdleShowsGames', config.frontIdleShowsGames, 'Go to the games of the best scores',
                        'Behind the idle curtain, the list of games goes to the game each best score is about.')}
                    <label for="frontSleepMinutes">Minutes before the cabinet goes to sleep <span class="checkbox-row-detail">A black screen until the next key press, counted from the idle curtain, or from the last key press when the curtain is off. 0 = never.</span></label>
                    <input type="number" id="frontSleepMinutes" name="frontSleepMinutes" min="0" max="1440" step="1" value="${config.frontSleepMinutes}">
                    ${renderSettingCheckbox('frontSleepScreenOff', config.frontSleepScreenOff, 'Asleep, also switch the screen off',
                        'DPMS, dedicated cabinet only. Untick it if the screen does not come back on, or keeps showing "no signal".')}
                </fieldset>
                <fieldset class="settings-group">
                    <legend>Players and votes</legend>
                    ${renderSettingCheckbox('cabinetPlayersPublic', config.cabinetPlayersPublic, 'Players registered on the cabinet are public',
                        'Their scores go to the shared leaderboards. Unticked, they start private and the Players tab makes them public.')}
                    ${renderSettingCheckbox('voteEnabled', config.voteEnabled, 'Ask for a vote when a game is quit',
                        'Thumbs up / neutral / thumbs down. A neutral vote is asked again next time.')}
                    ${renderSettingCheckbox('thumbsDownRemovesFavorite', config.thumbsDownRemovesFavorite, 'A thumbs down removes the game from the list',
                        'Restorable from the Games tab\'s "Removed from the list".')}
                </fieldset>
                <fieldset class="settings-group">
                    <legend>Updates</legend>
                    ${renderSettingCheckbox('frontUpdateEnabled', config.frontUpdateEnabled, 'Offer newer versions on the cabinet',
                        'When it wakes up from idle, the cabinet asks whether to install the newer version: a thumbs up downloads it and restarts MAUI on it. Unticked, only the Update card below installs one.')}
                    ${isAdvanced ? `
                        <label for="updateChannel">Versions offered <span class="checkbox-row-detail">On the cabinet and in its idle messages.</span></label>
                        <select id="updateChannel" name="updateChannel">
                            <option value="releases" ${config.updateChannel === 'releases' ? 'selected' : ''}>Releases</option>
                            <option value="prereleases" ${config.updateChannel === 'prereleases' ? 'selected' : ''}>Releases and development builds (pre-releases)</option>
                        </select>
                    ` : ''}
                </fieldset>
                <fieldset class="settings-group">
                    <legend>Back office</legend>
                    <label for="boIdleMinutes">Minutes before this back office is unloaded from memory <span class="checkbox-row-detail">Without a request. It loads again at the next visit, which asks to sign in again. 0 = keep it loaded.</span></label>
                    <input type="number" id="boIdleMinutes" name="boIdleMinutes" min="0" max="1440" step="1" value="${config.boIdleMinutes}">
                </fieldset>
                <button type="submit">Save</button>
            </form>
        </section>
    `;
}

function renderMauiImportExportCard(error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>mame-awesome-ui import / export</h2>
            <p class="info">Backs up or restores the files of mame-awesome-ui
            (~/.mame-awesome-ui) - not the roms nor mame's own data.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="get" action="/maui/export">
                <label class="checkbox-row">
                    <input type="checkbox" name="config" checked>
                    Configuration (mame-awesome-ui-config.json, removed favorites)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="database" checked>
                    Database (games, players, scores) and the players' avatars
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="caches" checked>
                    ScreenScraper caches (favorites, publishers and developers)
                </label>
                <label class="checkbox-row">
                    <input type="checkbox" name="online">
                    ONLINE session (online.json): its token and this machine's identity - only to be
                    restored on this same machine, never on another cabinet
                </label>
                <button type="submit">Export</button>
            </form>
            <form method="post" action="/maui/import" enctype="multipart/form-data"
                onsubmit="return confirm('Overwrite the files this export holds? This cannot be undone.')">
                <label for="mauiImportFile">File to import (a .zip exported here, or a lone .json configuration or .sqlite/.db database)</label>
                <input type="file" id="mauiImportFile" name="file" accept=".json,.sqlite,.db,.zip" required>
                <button type="submit">Import</button>
            </form>
        </section>
    `;
}

interface MauiPageMessages {
    mauiInfo?: string;
    importExportError?: string;
    importExportInfo?: string;
    dangerZoneInfo?: string;
    updateInfoMessage?: string;
    updateInfoError?: string;
    onlineInfo?: string;
    onlineError?: string;
    backfillInfo?: string;
    backfillError?: string;
    networkInfo?: string;
    networkError?: string;
    // Look again at the Wi-Fi networks in range before rendering (seconds).
    networkRescan?: boolean;
    bluetoothInfo?: string;
    bluetoothError?: string;
    // What a search for Bluetooth devices just found.
    bluetoothFound?: BluetoothDevice[];
    controls?: MauiControlsState;
    hotkeys?: HotkeysState;
}

/** MAUI's keys as the MAUI > Controls tab shows them, one card each. */
const MAUI_ACTIONS: readonly {key: string; label: string; icon: string}[] = [
    {key: MAUI_KEYS.up, label: 'Up', icon: 'joystick_up'},
    {key: MAUI_KEYS.down, label: 'Down', icon: 'joystick_down'},
    {key: MAUI_KEYS.left, label: 'Left', icon: 'joystick_left'},
    {key: MAUI_KEYS.right, label: 'Right', icon: 'joystick_right'},
    {key: MAUI_KEYS.enter, label: 'Confirm', icon: 'confirm'},
    {key: MAUI_KEYS.space, label: 'Scores / back', icon: 'scores'},
    {key: MAUI_KEYS.p, label: 'New player', icon: 'new_player'},
];

function mauiActionLabel(key: string): string {
    return MAUI_ACTIONS.find(action => action.key === key)?.label ?? key;
}

/** maui-controls.json (MauiControlBindings.ts), next to MAUI's config like the other files of the tab. */
function getMauiControlsPath(): string {
    return join(dirname(new Config().configPath), 'maui-controls.json');
}

function readMauiBindings(): MauiBindings {
    const path = getMauiControlsPath();
    return parseMauiBindings(existsSync(path) ? readFileSync(path, 'utf8') : undefined);
}

interface MauiControlsState {
    // Which action's card shows the message.
    key: string;
    error?: string;
    info?: string;
}

/** A gamepad layout's name as a pill shows it: the pad's name, without its USB ids. */
function shortLayoutName(layout: string): string {
    return layout.replace(/\s*\(Vendor:.*$/, '');
}

/**
 * MAUI's controls, laid out like the MAME > Controls tab so that both read the same: one card per
 * MAUI key with every keyboard key, mouse button and gamepad input producing it as pills, each
 * removable, and the same two ways to add one - a gamepad press caught by MAUI's window on the
 * cabinet (FrontControlsBridge.ts), a key or a mouse button caught by this page. Saved in
 * maui-controls.json; what each key does on each screen comes from MauiControls.ts, which the
 * screens switch on too.
 */
function renderMauiControlsCard(bindings: MauiBindings, state?: MauiControlsState): string {
    const cards = MAUI_ACTIONS.map(action => {
        const actionState = state?.key === action.key ? state : undefined;
        const chips = inputsOfKey(bindings, action.key).map((input: MauiInput) => {
            const kind = input.device === 'pad' ? 'joystick' : input.device;
            const label = describeMauiInput(input);
            const layout = input.device === 'pad' && input.layout !== 'standard' ? shortLayoutName(input.layout) : '';
            return `
                <li class="control-chip control-chip-${kind}"${layout ? ` title="${escapeHtml(input.device === 'pad' ? input.layout : '')}"` : ''}>
                    <span class="control-kind">${escapeHtml(CONTROL_KIND_LABELS[kind])}</span>
                    <span>${escapeHtml(label)}${layout ? ` <span class="control-layout">${escapeHtml(layout)}</span>` : ''}</span>
                    <button type="submit" name="remove" value="${escapeHtml(mauiInputId(input))}"
                        class="control-remove" aria-label="Remove ${escapeHtml(label)}">✕</button>
                </li>
            `;
        }).join('');
        const roles = MAUI_CONTROL_CONTEXTS.flatMap(context => context.controls
            .filter(control => control.key === action.key)
            .map(control => `${context.title}: ${control.role}${control.longPressMs ? ` (held ${control.longPressMs / 1000} s)` : ''}`));
        return `
            <div class="binding">
                ${renderIconLabel(action.icon, action.label)}
                <form method="post" action="/maui/controls" class="control-form">
                    <input type="hidden" name="key" value="${escapeHtml(action.key)}">
                    <ul class="control-chips">
                        ${chips || '<li class="control-none">No control: this action can\'t be used</li>'}
                    </ul>
                    ${renderControlAddButtons('', true, true)}
                    ${isDefaultKey(bindings, action.key) ? '' : `
                        <div class="binding-actions">
                            <button type="submit" name="action" value="reset">Back to MAUI's default</button>
                        </div>
                    `}
                </form>
                ${actionState?.error ? `<p class="error flash">${escapeHtml(actionState.error)}</p>` : ''}
                ${actionState?.info ? `<p class="warn flash">${escapeHtml(actionState.info)}</p>` : ''}
                <details class="control-roles">
                    <summary>What it does</summary>
                    <ul>${roles.map(role => `<li>${escapeHtml(role)}</li>`).join('')}</ul>
                </details>
            </div>
        `;
    }).join('');

    return `
        <section class="card">
            <h2>MAUI controls</h2>
            <p class="info">What moves around MAUI on the cabinet (the game list, player creation,
            the vote after a game), not to be confused with the MAME &gt; Controls tab, which sets
            what the keys do in the games. Each action is triggered by a key, a mouse button or a
            gamepad button: its <strong>✕</strong> removes it, and the others keep working.</p>
            <ul class="info">
                <li><strong>Add a gamepad button</strong>: click, then press the button (or push the
                stick) on the cabinet within 30 seconds - MAUI's window catches it, and the press
                does nothing else meanwhile. When this page is open on the computer the gamepad is
                plugged in, the page catches it too. A pad with a layout of its own (named on its
                pills) gets the button for itself, any other pad for every pad without one.</li>
                <li><strong>Add a key or mouse button</strong>: click, then press the key or click
                the mouse button in this page. Keys are named after their place on a US keyboard:
                on an AZERTY keyboard, the A key shows as Q.</li>
                <li>A key or a button does one thing in MAUI: added to an action, it leaves the one
                it had.</li>
                <li><strong>Back to MAUI's default</strong> gives the action its controls of origin
                again. Every change is used by the cabinet at once.</li>
            </ul>
            <div class="binding-grid">${cards}</div>
        </section>
    `;
}

type HotkeyType = 'press' | 'hold' | 'combo';
type HotkeyStep = 'action' | 'type' | 'key1' | 'key2' | 'hold' | 'review';

/**
 * The hotkey being put together step by step in the Hotkeys card: each step's form carries what the
 * steps before chose, and the next step is whatever is still missing (nextHotkeyStep()).
 */
interface HotkeyDraft {
    action: string;
    type: string;
    keys: [string, string];
    holdSeconds: string;
}

interface HotkeysState {
    error?: string;
    info?: string;
    draft?: HotkeyDraft;
}

const EMPTY_HOTKEY_DRAFT: HotkeyDraft = {action: '', type: '', keys: ['', ''], holdSeconds: ''};

const HOTKEY_TYPES: readonly {value: HotkeyType; label: string; detail: string}[] = [
    {value: 'press', label: 'One key, pressed', detail: 'A button of its own on the cabinet, for instance.'},
    {value: 'hold', label: 'One key, held', detail: 'After 1 s held, a loader counts down the time below. Released early, the key does its own job.'},
    {value: 'combo', label: 'Two keys together', detail: 'At once or held, like Start + Select.'},
];

const HOTKEY_HOLD_CHOICES = ['1', '2', '3', '5'];

function nextHotkeyStep(draft: HotkeyDraft): HotkeyStep {
    if (!HOTKEY_ACTIONS.includes(draft.action as HotkeyAction)) {
        return 'action';
    }
    if (!HOTKEY_TYPES.some(type => type.value === draft.type)) {
        return 'type';
    }
    if (!draft.keys[0]) {
        return 'key1';
    }
    if (draft.type === 'combo' && !draft.keys[1]) {
        return 'key2';
    }
    if (draft.type !== 'press' && draft.holdSeconds === '') {
        return 'hold';
    }
    return 'review';
}

/** The draft one step back: what the last step chose is asked again. */
function previousHotkeyDraft(draft: HotkeyDraft): HotkeyDraft {
    const previous: HotkeyDraft = {...draft, keys: [...draft.keys]};
    if (draft.type !== 'press' && draft.holdSeconds !== '') {
        previous.holdSeconds = '';
    } else if (draft.keys[1]) {
        previous.keys[1] = '';
    } else if (draft.keys[0]) {
        previous.keys[0] = '';
    } else if (draft.type) {
        previous.type = '';
        previous.holdSeconds = '';
    } else {
        previous.action = '';
    }
    return previous;
}

/** The finished draft as a hotkey, null when something is missing or wrong. */
function draftHotkey(draft: HotkeyDraft): Hotkey | null {
    const seconds = draft.type === 'press' ? 0 : Number(draft.holdSeconds);
    return parseHotkey({
        action: draft.action,
        keys: draft.keys.filter(key => key !== ''),
        holdMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : -1,
    }, isHotkeyKey);
}

/** What a hotkey's key shows: a MAUI action ("Scores / back"), or an input and its device. */
function describeHotkeyKey(key: string): string {
    if (key.startsWith(MAUI_KEY_REF)) {
        return mauiActionLabel(key.slice(MAUI_KEY_REF.length));
    }
    const input = parseMauiInputId(key);
    if (!input) {
        return key;
    }
    const kind = input.device === 'pad' ? 'joystick' : input.device;
    const layout = input.device === 'pad' && input.layout !== 'standard' ? ` (${shortLayoutName(input.layout)})` : '';
    return `${CONTROL_KIND_LABELS[kind]} ${describeMauiInput(input)}${layout}`;
}

function describeHotkeyTrigger(hotkey: Hotkey): string {
    const two = hotkey.keys.length > 1;
    return hotkey.holdMs > 0 ? `${two ? 'held together' : 'held'} ${hotkey.holdMs / 1000} s` : (two ? 'together' : 'pressed');
}

/**
 * What saving this hotkey changes besides it: a single input pressed (not held) leaves the MAUI
 * action it had, a MAUI action pressed no longer does its own job on the list of games.
 */
function describeHotkeyTakeover(bindings: MauiBindings, hotkey: Hotkey): string | undefined {
    const [key] = hotkey.keys;
    if (hotkey.keys.length !== 1 || hotkey.holdMs !== 0) {
        return undefined;
    }
    if (key.startsWith(MAUI_KEY_REF)) {
        return `${describeHotkeyKey(key)} will trigger this hotkey instead of its own job on the list of games.`;
    }
    const input = parseMauiInputId(key);
    const taken = input ? keyOfInput(bindings, input) : '';
    return taken ? `${describeHotkeyKey(key)} does ${mauiActionLabel(taken)} today: it will only trigger this hotkey.` : undefined;
}

/** The choices of the steps before, carried along; `except` is the one this step asks. */
function renderHotkeyDraftFields(draft: HotkeyDraft, except: string[] = []): string {
    const fields: [string, string][] = [
        ['hotkeyAction', draft.action], ['type', draft.type], ['key1', draft.keys[0]], ['key2', draft.keys[1]],
        ['holdSeconds', draft.holdSeconds],
    ];
    return fields.filter(([name]) => !except.includes(name))
        .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join('');
}

function renderHotkeyStepBody(bindings: MauiBindings, draft: HotkeyDraft, step: HotkeyStep): string {
    switch (step) {
        case 'action':
            return `
                <p>What should the hotkey do?</p>
                <div class="hotkey-choices">
                    ${HOTKEY_ACTIONS.map(action => `<button type="submit" name="hotkeyAction" value="${action}">${escapeHtml(HOTKEY_ACTION_LABELS[action])}</button>`).join('')}
                </div>`;
        case 'type':
            return `
                <p>How is it triggered?</p>
                <div class="hotkey-choices">
                    ${HOTKEY_TYPES.map(type => `<button type="submit" name="type" value="${type.value}">${escapeHtml(type.label)}<span class="checkbox-row-detail">${escapeHtml(type.detail)}</span></button>`).join('')}
                </div>`;
        case 'key1':
        case 'key2': {
            const slot = step === 'key1' ? 1 : 2;
            const name = `key${slot}`;
            return `
                <p>${slot === 1 ? (draft.type === 'combo' ? 'First key' : 'The key') : `Second key, pressed with ${escapeHtml(describeHotkeyKey(draft.keys[0]))}`}:
                press it on the cabinet (or here for a key or a mouse button)…</p>
                <div class="binding-actions">
                    <button type="submit" name="action" value="capture${slot}" data-pad-listen data-slot="${slot}">Catch a gamepad button</button>
                    <button type="button" data-control-listen="raw" data-slot="${slot}">Catch a key or mouse button</button>
                </div>
                <p>…or pick a MAUI action, whatever control triggers it:</p>
                <div class="hotkey-choices">
                    ${MAUI_ACTIONS.filter(action => MAUI_KEY_REF + action.key !== draft.keys[0])
                        .map(action => `<button type="submit" name="${name}" value="${escapeHtml(MAUI_KEY_REF + action.key)}">${escapeHtml(action.label)}</button>`).join('')}
                </div>
                <input type="hidden" name="code" value="">
                <input type="hidden" name="slot" value="">
                <button type="submit" name="action" value="catch" hidden data-control-add></button>`;
        }
        case 'hold':
            return `
                <p>${draft.type === 'combo' ? 'Held together how long?' : 'Held how long, once held 1 s (a plain press stays a plain press)?'}</p>
                <div class="hotkey-choices">
                    ${draft.type === 'combo' ? '<button type="submit" name="holdSeconds" value="0">At once</button>' : ''}
                    ${HOTKEY_HOLD_CHOICES.map(seconds => `<button type="submit" name="holdSeconds" value="${seconds}">${seconds} s</button>`).join('')}
                </div>`;
        case 'review': {
            const hotkey = draftHotkey(draft);
            if (!hotkey) {
                return '<p class="error">Something is missing: go back a step.</p>';
            }
            const takeover = describeHotkeyTakeover(bindings, hotkey);
            return `
                <p class="hotkey-summary"><strong>${escapeHtml(HOTKEY_ACTION_LABELS[hotkey.action])}</strong>:
                ${hotkey.keys.map(key => escapeHtml(describeHotkeyKey(key))).join(' + ')}, ${escapeHtml(describeHotkeyTrigger(hotkey))}.</p>
                ${takeover ? `<p class="warn">${escapeHtml(takeover)}</p>` : ''}
                <div class="hotkey-choices">
                    <button type="submit" name="action" value="add">Save the hotkey</button>
                </div>`;
        }
    }
}

/** "Add a hotkey", one question per screen: action, kind, key(s), how long, then a summary. */
function renderHotkeyWizard(bindings: MauiBindings, draft: HotkeyDraft): string {
    const step = nextHotkeyStep(draft);
    const steps: HotkeyStep[] = ['action', 'type', 'key1',
        ...(draft.type === 'combo' ? ['key2' as const] : []),
        ...(draft.type && draft.type !== 'press' ? ['hold' as const] : []), 'review'];
    const asked: Record<HotkeyStep, string[]> = {
        action: ['hotkeyAction'], type: ['type', 'holdSeconds'], key1: ['key1'], key2: ['key2'], hold: ['holdSeconds'], review: [],
    };
    return `
        <form method="post" action="/maui/hotkeys" class="hotkey-step">
            <h3>Add a hotkey <span class="checkbox-row-detail">Step ${steps.indexOf(step) + 1} of ${draft.type ? steps.length : '4 to 6'}</span></h3>
            ${renderHotkeyDraftFields(draft, asked[step])}
            ${renderHotkeyStepBody(bindings, draft, step)}
            <div class="binding-actions">
                ${step === 'action' ? '' : '<button type="submit" name="action" value="back">Back</button>'}
                <button type="submit" name="action" value="cancel">Cancel</button>
            </div>
        </form>
    `;
}

/**
 * The front's hotkeys (Hotkeys.ts): each action of the list of games triggered by a key pressed,
 * a key held, or two keys together. A key is a MAUI action (whatever input produces it) or an input
 * caught here, a MAUI key or not.
 */
function renderHotkeysCard(bindings: MauiBindings, state?: HotkeysState): string {
    const rows = bindings.hotkeys.map((hotkey, index) => `
        <tr>
            <td>${escapeHtml(HOTKEY_ACTION_LABELS[hotkey.action])}</td>
            <td>${hotkey.keys.map(key => escapeHtml(describeHotkeyKey(key))).join(' + ')}</td>
            <td>${escapeHtml(describeHotkeyTrigger(hotkey))}</td>
            <td class="center">
                <form method="post" action="/maui/hotkeys">
                    <input type="hidden" name="index" value="${index}">
                    <button type="submit" name="action" value="remove" class="control-remove"
                        aria-label="Remove this hotkey">✕</button>
                </form>
            </td>
        </tr>
    `).join('');
    const isDefault = JSON.stringify(bindings.hotkeys) === JSON.stringify(defaultHotkeys());
    return `
        <section class="card">
            <h2>MAUI hotkeys</h2>
            <p class="info">Actions of the list of games triggered by one key pressed, one key held,
            or two keys together. A key is a MAUI action above (any of its controls) or a button
            caught on the cabinet, even one that does nothing else in MAUI, like Start or Select.
            A key a held or two-key hotkey uses still does its own job, once released or when no
            other key came - never when its hotkey went off.</p>
            ${state?.error ? `<p class="error flash">${escapeHtml(state.error)}</p>` : ''}
            ${state?.info ? `<p class="warn flash">${escapeHtml(state.info)}</p>` : ''}
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead><tr><th>Action</th><th>Keys</th><th>Trigger</th><th class="center"></th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="4"><em>No hotkey: these actions can\'t be used on the cabinet.</em></td></tr>'}</tbody>
                </table>
            </div>
            ${state?.draft ? renderHotkeyWizard(bindings, state.draft) : `
                <form method="post" action="/maui/hotkeys" class="hotkey-choices">
                    <button type="submit" name="action" value="start">Add a hotkey</button>
                    ${isDefault ? '' : '<button type="submit" name="action" value="reset">Back to MAUI\'s default hotkeys</button>'}
                </form>
            `}
        </section>
    `;
}

// Set once by startBoServer(); read by the MAUI page renderer, which runs outside its closure.
let onlineSession: OnlineSession | null = null;

interface OnlineBadge {
    indicator: OnlineIndicator;
    label: string;
    title: string;
}

/** The header badge's content (OnlineSetup.ts onlineIndicator()), null when ONLINE was never set up. */
function getOnlineBadge(): OnlineBadge | null {
    const status = onlineSession?.getStatus();
    const indicator = onlineIndicator(status);
    if (!indicator || !status) {
        return null;
    }
    // Followed by the cabinet's name and, outside production, MAUI-API's environment.
    const identity = describeIdentity(onlineSession?.getIdentity() ?? null);
    if (indicator === 'off') {
        return {indicator, label: badgeLabel('OFFLINE', identity), title: 'ONLINE is turned off: this cabinet plays LOCAL.'};
    }
    const view = getOnlineView();
    const message = view.state === 'configured' ? describeOnlineStatus(status, view.url).message : 'ONLINE settings unreadable.';
    return {
        indicator,
        label: badgeLabel(indicator === 'offline' ? 'OFFLINE' : 'ONLINE', identity),
        title: indicator === 'unstable' ? `MAUI-API not answering, retrying. ${message}` : message,
    };
}

/**
 * ONLINE / OFFLINE next to the version, linking to the MAUI > Online tab. Always rendered, hidden
 * when there is nothing to show, so that ONLINE_BADGE_SCRIPT can update it as the session goes.
 */
function renderOnlineBadge(): string {
    const badge = getOnlineBadge();
    return `<a class="online-badge ${badge?.indicator ?? ''}" href="/maui#online" title="${escapeHtml(badge?.title ?? '')}"`
        + `${badge ? '' : ' hidden'}>${badge?.label ?? ''}</a>`
        + ONLINE_BADGE_SCRIPT;
}

// The session changes behind the page (a heartbeat every minute): the badge asks for it again
// every few seconds instead of waiting for the next page load.
const ONLINE_BADGE_SCRIPT = `<script>(function () {
    var badge = document.currentScript.previousElementSibling;
    setInterval(function () {
        fetch('/maui/online/badge', {credentials: 'same-origin'})
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
                if (!data) { return; }
                badge.hidden = !data.indicator;
                badge.className = 'online-badge ' + (data.indicator || '');
                badge.textContent = data.label || '';
                badge.title = data.title || '';
            })
            .catch(function () {});
    }, 5000);
})();</script>`;

function renderOnlineSection(messages: MauiPageMessages): string {
    const view = getOnlineView();
    const status = onlineSession?.getStatus();
    const session = view.state === 'configured' && status
        ? {stopped: status.state === 'stopped', status: describeOnlineStatus(status, view.url)}
        : undefined;
    return renderOnlineCard(view, {error: messages.onlineError, info: messages.onlineInfo}, session)
        + (process.env.NODE_ENV === 'development' && onlineSession?.currentClient() ? renderScoresBackfillCard(messages) : '');
}

/** Development only (HiscoreBackfill.ts): fills MAUI-API with this cabinet's hiscores. */
function renderScoresBackfillCard(messages: MauiPageMessages): string {
    return `
        <section class="card">
            <h2>Send this cabinet's hiscores (development)</h2>
            ${messages.backfillError ? `<p class="error flash">${escapeHtml(messages.backfillError)}</p>` : ''}
            ${messages.backfillInfo ? `<p class="info flash">${escapeHtml(messages.backfillInfo)}</p>` : ''}
            <p>Reads every hiscore table of this cabinet (hiscore and nvram files) and sends the best score of
            each public player on each game to MAUI-API, through the same outbox as the scores of a game.
            MAUI-API only keeps personal bests: sending again changes nothing. To start over, run
            <code>php artisan dev:reset-scores</code> on MAUI-API, then send again.</p>
            <form method="post" action="/maui/online/backfill-scores">
                <button type="submit">Send the hiscores</button>
            </form>
        </section>`;
}

function renderMauiPage(
    config: Config, messages: MauiPageMessages = {}, isAdvanced: boolean = false,
    updateInfo?: UpdateInfo, network?: NetworkState | null, bluetooth?: BluetoothState | null,
): string {
    const sections: Subsection[] = [
        {id: 'general', label: 'General', html: renderMauiCard(config, isAdvanced, messages.mauiInfo)},
        {id: 'controls', label: 'Controls', html: renderMauiControlsCard(readMauiBindings(), messages.controls)
            + renderHotkeysCard(readMauiBindings(), messages.hotkeys)},
    ];
    if (network) {
        sections.push({
            id: 'network',
            label: 'Network',
            html: renderNetworkCard(network, {error: messages.networkError, info: messages.networkInfo}),
        });
    }
    if (bluetooth) {
        sections.push({
            id: 'bluetooth',
            label: 'Bluetooth',
            html: renderBluetoothCard(bluetooth, {
                error: messages.bluetoothError, info: messages.bluetoothInfo, found: messages.bluetoothFound,
            }),
        });
    }
    if (updateInfo) {
        sections.push({
            id: 'update',
            label: 'Update',
            html: renderUpdateCard(updateInfo, isAdvanced, messages.updateInfoMessage, messages.updateInfoError),
        });
    }
    // Import/export and the danger zone both act on the app's own config/database - only
    // shown (and only actionable, see /maui/export, /maui/import and /reset) in Advanced configuration.
    if (isAdvanced) {
        // Advanced configuration only, see POST /maui/online/*.
        sections.push({
            id: 'online',
            label: 'Online',
            html: renderOnlineSection(messages),
        });
        sections.push({
            id: 'import-export',
            label: 'Import/Export',
            html: renderMauiImportExportCard(messages.importExportError, messages.importExportInfo),
        });
        sections.push({id: 'danger', label: 'Danger', html: renderMauiDangerZoneCard(messages.dangerZoneInfo)});
    }
    // See renderForm()'s own defaultSubtab for why this is computed from which message was
    // actually passed for this response, not inferred client-side from scanning for .flash.
    const defaultSubtab = messages.dangerZoneInfo !== undefined ? 'danger'
        : (messages.onlineError ?? messages.onlineInfo ?? messages.backfillError ?? messages.backfillInfo) !== undefined ? 'online'
            : (messages.importExportError !== undefined || messages.importExportInfo !== undefined) ? 'import-export'
                : (messages.updateInfoMessage !== undefined || messages.updateInfoError !== undefined) ? 'update'
                    : (messages.networkError ?? messages.networkInfo) !== undefined || messages.networkRescan ? 'network'
                        : (messages.bluetoothError ?? messages.bluetoothInfo ?? messages.bluetoothFound) !== undefined ? 'bluetooth'
                            : messages.mauiInfo !== undefined ? 'general'
                                : messages.controls !== undefined ? 'controls'
                                    : undefined;
    return renderSubtabbedPage('maui', sections, isAdvanced ? 'advanced' : 'basic', defaultSubtab);
}

/**
 * Thin wrapper around renderMauiPage() that also computes UpdateInfo (see getUpdateInfo()) -
 * every route that re-renders the MAUI page needs it, same as every /mame-tab route re-resolves
 * MameInfo via getMameInfo(). Centralized here instead of repeated at each of the ~7 call sites.
 */
async function sendMauiPage(
    req: express.Request, res: Response, config: Config, messages: MauiPageMessages = {},
): Promise<void> {
    const isAdvanced = req.session.boAdvanced === true;
    const [updateInfo, network, bluetooth] = await Promise.all([
        getUpdateInfo(),
        isNetworkControlHost() ? readNetworkState(messages.networkRescan === true) : null,
        isNetworkControlHost() ? readBluetoothState() : null,
    ]);
    res.send(renderMauiPage(config, messages, isAdvanced, updateInfo, network, bluetooth));
}

function renderScreenScraperCard(values: ScreenScraperValues, error?: string, info?: string): string {
    return `
        <section class="card">
            <h2>ScreenScraper</h2>
            <p>Credentials used to fetch marquees, flyers and other artwork from
            <a href="https://www.screenscraper.fr" target="_blank" rel="noopener">screenscraper.fr</a>.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            <form method="post" action="/screenscraper/save" novalidate>
                <label for="ssUserId">User ID (ssid)</label>
                <input type="text" id="ssUserId" name="ssUserId" value="${escapeHtml(values.ssUserId)}" autocomplete="off">
                <label for="ssUserPassword">User password (sspassword)</label>
                <input type="password" id="ssUserPassword" name="ssUserPassword" ${renderSavedPasswordAttributes(values.ssUserPassword)} autocomplete="off">

                <label for="ssSoftName">Software name (softname)</label>
                <input type="text" id="ssSoftName" name="ssSoftName" value="${escapeHtml(values.ssSoftName)}" autocomplete="off">
                <label for="ssDevId">Developer ID (devid) — to be created on screenscraper.fr, the application provides no default value</label>
                <input type="text" id="ssDevId" name="ssDevId" value="${escapeHtml(values.ssDevId)}" autocomplete="off">
                <label for="ssDevPassword">Developer password (devpassword)</label>
                <input type="password" id="ssDevPassword" name="ssDevPassword" ${renderSavedPasswordAttributes(values.ssDevPassword)} autocomplete="off">

                <label for="bezelAspect">Bezel format (aspect_ratio of the target screen)</label>
                <select id="bezelAspect" name="bezelAspect">
                    <option value="16:9" ${values.bezelAspect === '16:9' ? 'selected' : ''}>16:9 (widescreen)</option>
                    <option value="4:3" ${values.bezelAspect === '4:3' ? 'selected' : ''}>4:3 (standard screen)</option>
                </select>
                <button type="submit">Save</button>
            </form>
        </section>
    `;
}

/**
 * Media-download trigger, moved here from the favorites tab (see renderFavoritesCard()) since
 * it's a ScreenScraper action, not a favorites-list concern - the favorites table stays there,
 * showing per-rom marquee/flyer/logo status, with a pointer back to this tab for the button.
 */
function renderScreenScraperDownloadCard(hasCreds: boolean, error?: string, summary?: DownloadSummary): string {
    if (!hasCreds) {
        return `
            <section class="card">
                <h2>Media download</h2>
                <p class="error flash">ScreenScraper credentials missing: fill them in (Credentials
                tab) before starting a download.</p>
            </section>
        `;
    }
    return `
        <section class="card">
            <h2>Media download</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${summary ? renderDownloadSummary(summary) : ''}
            <form method="post" action="/favorites/download-media" data-stream>
                <p class="info">Downloads the missing marquees/flyers/logos from ScreenScraper for all
                the games of the list. Synchronous processing, may take several minutes depending on the number of games
                (a delay is enforced between calls) - do not close this page during the download.</p>
                <button type="submit">Download the missing artwork</button>
            </form>
        </section>
    `;
}

function renderScreenScraperPage(
    values: ScreenScraperValues,
    hasCreds: boolean,
    error?: string,
    info?: string,
    downloadError?: string,
    summary?: DownloadSummary,
): string {
    // See renderForm()'s own defaultSubtab for why this is computed from which message was
    // actually passed for this response, not inferred client-side from scanning for .flash.
    const defaultSubtab = (downloadError !== undefined || summary !== undefined) ? 'download'
        : (error !== undefined || info !== undefined) ? 'credentials'
            : undefined;
    return renderSubtabbedPage('screenscraper', [
        {id: 'credentials', label: 'Credentials', html: renderScreenScraperCard(values, error, info)},
        {
            id: 'download',
            label: 'Download',
            html: renderScreenScraperDownloadCard(hasCreds, downloadError, summary),
        },
    ], 'advanced', defaultSubtab);
}

// 16x16 stroke icons (drawn with currentColor, so the caller's color class tints them). Each
// asset kind gets its own glyph: marquee = lit sign on a stand, flyer = folded sheet of paper,
// logo = star.
const ASSET_ICON_PATHS: { [kind: string]: string } = {
    Marquee: '<rect x="1.5" y="3" width="13" height="6" rx="1"/><path d="M8 9v3.5M5 13h6"/>',
    Flyer: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8.5h5M6 11h5"/>',
    // A title's letter on its baseline: a star would read as the vote's star (My favourites).
    Logo: '<path d="M4 12L8 2.5l4 9.5M5.5 8.5h5"/><path d="M2 14.5h12"/>',
};


/**
 * One asset (marquee/flyer/logo) presence icon: green when the file exists, red when it doesn't.
 * A missing one is also struck through, so the state doesn't rest on red vs. green alone. A
 * present one carries its image URL (data-preview, served by GET /media/...), shown as a
 * thumbnail following the mouse while hovered (see ASSET_PREVIEW_SCRIPT) - instead of the
 * tooltip, which would cover it.
 */
function renderAssetIcon(kind: 'Marquee' | 'Flyer' | 'Logo', found: boolean, romName: string): string {
    const label = `${kind}: ${found ? 'present' : 'missing'}`;
    const hover = found
        ? `data-preview="/media/${kind.toLowerCase()}/${encodeURIComponent(romName)}.png"`
        : `title="${label}"`;
    return `<span class="asset-icon ${found ? 'badge-yes' : 'badge-no'}" ${hover} role="img" aria-label="${label}">
        <svg ${ICON_SVG_ATTRS}>${ASSET_ICON_PATHS[kind]}${found ? '' : '<path d="M2 14L14 2"/>'}</svg>
    </span>`;
}

/**
 * Asset thumbnail that follows the mouse over any [data-preview] icon (see renderAssetIcon()):
 * one shared <img>, fixed-positioned next to the cursor and flipped to the other side of it near
 * the viewport's right/bottom edges. pointer-events: none, so it never steals the hover itself.
 */
const ASSET_PREVIEW_SCRIPT = `<img class="asset-preview" id="assetPreview" alt="" hidden>
            <script>(function () {
                var preview = document.getElementById('assetPreview');
                var OFFSET = 16;
                var last = null;
                function place(event) {
                    last = event;
                    var width = preview.offsetWidth;
                    var height = preview.offsetHeight;
                    var x = event.clientX + OFFSET;
                    var y = event.clientY + OFFSET;
                    if (x + width > window.innerWidth) { x = event.clientX - OFFSET - width; }
                    if (y + height > window.innerHeight) { y = event.clientY - OFFSET - height; }
                    preview.style.left = Math.max(0, x) + 'px';
                    preview.style.top = Math.max(0, y) + 'px';
                }
                document.addEventListener('mouseover', function (event) {
                    var icon = event.target.closest && event.target.closest('[data-preview]');
                    if (!icon) { return; }
                    preview.src = icon.dataset.preview;
                    preview.hidden = false;
                    place(event);
                });
                document.addEventListener('mousemove', function (event) {
                    if (!preview.hidden) { place(event); }
                });
                document.addEventListener('mouseout', function (event) {
                    var icon = event.target.closest && event.target.closest('[data-preview]');
                    if (icon && !icon.contains(event.relatedTarget)) {
                        preview.hidden = true;
                        preview.removeAttribute('src');
                    }
                });
                // The image is only sized once loaded: re-place it then, or it would overflow the
                // edge it was meant to flip away from.
                preview.addEventListener('load', function () {
                    if (last && !preview.hidden) { place(last); }
                });
            })();</script>`;


// A screen with a play mark: puts the front on the game.
const SHOW_ON_FRONT_ICON_PATHS = '<rect x="2" y="3" width="12" height="8.5" rx="1"/><path d="M6 14h4M7 6l2.5 1.3L7 8.6z"/>';
const EDIT_ICON_PATHS = '<path d="M11 2.5l2.5 2.5L6 12.5l-3.5 1 1-3.5z"/><path d="M9.5 4l2.5 2.5"/>';
const TRASH_ICON_PATHS = '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>';
const THUMB_UP_ICON_PATHS = '<path d="M5 7v6.5H2.5V7H5z"/>'
    + '<path d="M5 7l2.6-4.5c1.2 0 1.9 1 1.6 2.1L8.8 6.5h3.4c1 0 1.7.9 1.5 1.9l-.9 4c-.2.7-.8 1.1-1.5 1.1H5"/>';
const THUMB_DOWN_ICON_PATHS = `<g transform="rotate(180 8 8)">${THUMB_UP_ICON_PATHS}</g>`;
// Eyes are zero-length round-capped lines: dots that keep the stroke-only look of the other icons.
const STAR_ICON_PATHS = '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>';
const NEUTRAL_ICON_PATHS = '<circle cx="8" cy="8" r="6"/><path d="M5.5 10h5"/><path d="M6 6.5v.01M10 6.5v.01"/>';
const RESTORE_ICON_PATHS = '<path d="M3.5 8A4.5 4.5 0 1 1 5 11.3"/><path d="M3 4.5V8h3.5"/>';
const PLAY_ICON_PATHS = '<path d="M5 3l8 5-8 5z"/>';
const PAUSE_ICON_PATHS = '<path d="M5.5 3v10M10.5 3v10"/>';
const SYNC_ICON_PATHS = '<path d="M13 8a5 5 0 0 1-8.5 3.5M3 8a5 5 0 0 1 8.5-3.5"/><path d="M11.5 1.5v3h-3M4.5 14.5v-3h3"/>';

/**
 * Splits a MAME description ("Ghosts'n Goblins (World? set 1)", sometimes with several
 * parenthesized groups like "(Japan) (Alt)") into the plain name and the parenthesized
 * region/revision info (kept with their own parentheses, each group separate), so the table
 * can show the short name and move the (often long) extra info into a tooltip instead of
 * widening the column.
 */
function splitGameName(fullname: string): { name: string; extra: string | null } {
    const groups = fullname.match(/\([^)]*\)/g);
    if (!groups) {
        return {name: fullname, extra: null};
    }
    const name = fullname.slice(0, fullname.indexOf('(')).trim();
    return {name, extra: groups.join(' ')};
}

/**
 * Gold cup shown next to a game's name when mhiex can extract its hiscores (the "Hiscores Only"
 * carousel category, see hasHiscoreExtraction()).
 */
const HISCORE_CUP_ICON = `<span class="hiscore-icon" title="Hiscores can be extracted for this game (mhiex)">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2h8v4a4 4 0 0 1-8 0z" fill="currentColor"/>
            <path d="M4 3.5H2.25v1A2.5 2.5 0 0 0 4.5 7M12 3.5h1.75v1A2.5 2.5 0 0 1 11.5 7" fill="none"
                stroke="currentColor" stroke-width="1.25"/>
            <path d="M8 10v2.5M5.5 14h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    </span>`;

/** The (i) icon, its text shown as a tooltip on hover. */
function renderInfoIcon(text: string): string {
    return `<span class="info-icon" title="${escapeHtml(text)}">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="8" cy="4.5" r="1" fill="currentColor"/>
            <rect x="7.25" y="7" width="1.5" height="5" fill="currentColor"/>
        </svg>
    </span>`;
}

/**
 * Category icon ahead of a game's name, the category's name as its tooltip. `undefined` (a list
 * that shows no categories) renders nothing; `null` (a game genre.ini doesn't know) an empty slot
 * of the same width, so the names of a list stay aligned.
 */
function renderGameCategoryIcon(category: GameCategory | null | undefined): string {
    if (category === undefined) {
        return '';
    }
    if (!category) {
        return '<span class="game-category-icon" title="No category"></span>';
    }
    const iconKey = category.iconKey in CATEGORY_ICONS ? category.iconKey : '_default';
    return `<img class="game-category-icon" src="/category-icons/${escapeHtml(iconKey)}.svg"
        title="${escapeHtml(category.name)}" alt="${escapeHtml(category.name)}">`;
}

/**
 * Game name cell content. Pass `romName` to also flag (gold cup) a game whose hiscores can be
 * extracted, and `category` to lead with its category icon (see renderGameCategoryIcon()).
 */
function renderGameName(fullname: string, romName?: string, category?: GameCategory | null): string {
    const {name, extra} = splitGameName(fullname);
    return renderGameNameCell(name, extra, !!romName && hasHiscoreExtraction(romName), renderGameCategoryIcon(category));
}

/** renderGameName()'s markup, from its parts (also the favorites list's template, see renderFavoritesCard()). */
function renderGameNameCell(name: string, extra: string | null, hiscoreCup: boolean, categoryIcon: string): string {
    // The name is cut with an ellipsis by CSS (see .game-name-cell) when too long for the column;
    // its title carries the full text. The search matches data-search, not this markup.
    const nameHtml = `<span class="game-name-text" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    const infoIcon = extra ? renderInfoIcon(extra) : '';
    return `<span class="game-name-cell">${categoryIcon}${nameHtml}${infoIcon}${hiscoreCup ? HISCORE_CUP_ICON : ''}</span>`;
}

function renderDownloadSummary(summary: DownloadSummary): string {
    const parts = [
        `${summary.alreadyComplete} already complete`,
        `${summary.downloaded} file(s) downloaded`,
        `${summary.notFound} not found on ScreenScraper`,
        `${summary.noMedia} without available artwork`,
        `${summary.infosSaved} publisher/developer info(s) saved`,
        `${summary.errors.length} error(s)`,
    ];
    const errorsHtml = summary.errors.length
        ? `<ul>${summary.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
        : '';
    return `
        <p class="info flash">${escapeHtml(parts.join(' — '))}${summary.stoppedForQuota
            ? ' — stopped: ScreenScraper quota exceeded, try again later.'
            : ''}</p>
        ${errorsHtml}
    `;
}

/**
 * RomName cell content: the romName, followed - same as the name's region/revision info - by an
 * (i) whose tooltip lists its dependencies, instead of a whole column for them. The parent romset
 * (biosName, e.g. "pacman" for a puckman clone) and any device romsets (deviceRoms, e.g. "ym2413")
 * are distinct dependencies a favorite can be missing independently of each other, so both are
 * listed, each on its own line.
 */
function renderRomNameCell(row: FavoriteRow): string {
    return renderRomNameCellParts(row.romName, getRomDependencies(row));
}

/** The tooltip of a rom name's (i): its dependencies, one kind per line ('' for none). */
function getRomDependencies(row: FavoriteRow): string {
    return [
        ...(row.cached && row.biosName ? [`Bios: ${row.biosName}`] : []),
        ...(row.cached && row.deviceRoms.length ? [`Devices: ${row.deviceRoms.join(', ')}`] : []),
    ].join('\n');
}

function renderRomNameCellParts(romName: string, dependencies: string): string {
    return `<span class="romname-cell"><span class="game-name-text" title="${escapeHtml(romName)}">${escapeHtml(romName)}</span>${dependencies ? renderInfoIcon(dependencies) : ''}</span>`;
}

/**
 * What the favorites search matches a row against: the three searchable columns - rom name
 * (romName), name (the full description, including the parenthesized region/revision info that
 * the table only shows as a tooltip) and bios / devices (biosName and deviceRoms, the rom name's
 * own tooltip, see renderRomNameCell()). Not-yet-resolved favorites (no cache entry) only have their romName.
 */
function getFavoriteSearchText(row: FavoriteRow): string {
    if (!row.cached) {
        return row.romName;
    }
    return [row.romName, row.fullname, ...(row.biosName ? [row.biosName] : []), ...row.deviceRoms].join(' ');
}

/** The background resolution of the favorites' names (updateFavoritesCache()), followed by the list's script. */
function renderResolutionProgress(progress: {done: number; total: number}): string {
    return `
        <div class="import-progress" id="favoritesResolution">
            <div class="progress-label">
                <span>Updating the games' names from MAME: the list reloads once they are all in.</span>
                <span data-count>${progress.done} / ${progress.total}</span>
            </div>
            <div class="progress-track progress-track-thin">
                <div class="progress-fill" data-fill style="width: ${100 * progress.done / progress.total}%"></div>
            </div>
        </div>
    `;
}

const FAVORITES_PAGE_SIZES = [10, 30, 50, 100];
const FAVORITES_DEFAULT_PAGE_SIZE = 30;

// The placeholders of the favorites list's templates, replaced by each game's values in the browser
// (renderFavoritesCard()'s script). Letters and underscores only: escapeHtml() and
// encodeURIComponent() leave them as they are.
const FAVORITE_TOKENS = {
    rom: '__rom__', name: '__name__', extra: '__extra__', dependencies: '__dependencies__', category: '__category__',
};

/** One game of the favorites list, as its script gets it. */
interface FavoriteListGame {
    romName: string;
    // splitGameName()'s parts of the full name.
    name: string;
    extra: string | null;
    dependencies: string;
    cached: boolean;
    // getFavoriteSearchText(), accents and case folded.
    search: string;
    // Marquee, flyer, logo.
    assets: [boolean, boolean, boolean];
    playCount: number;
    // renderVoteForm()'s template key, null when the database doesn't know the game.
    vote: string | null;
    starred: boolean;
    // Its category's name, '' when genre.ini doesn't know it, undefined without a database.
    category: string | undefined;
    hiscores: boolean;
    playerScores: boolean;
}

function foldSearchText(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The favorites list's games and the templates its script builds their rows from: the markup of
 * renderGameName(), renderRomNameCell() and co. themselves, placeholders in place of a game's values.
 */
function buildFavoritesListData(rows: FavoriteRow[], stats: Map<string, GameStats> | undefined) {
    const {rom, name, extra, dependencies, category} = FAVORITE_TOKENS;
    const categoryIcons: Record<string, string> = {};
    const games: FavoriteListGame[] = rows.map(row => {
        const gameStats = stats?.get(row.romName);
        const gameCategory = stats ? gameStats?.category ?? null : undefined;
        if (gameCategory !== undefined) {
            categoryIcons[gameCategory?.name ?? ''] ??= renderGameCategoryIcon(gameCategory);
        }
        const parts = splitGameName(row.fullname);
        return {
            romName: row.romName,
            name: parts.name,
            extra: parts.extra,
            dependencies: getRomDependencies(row),
            cached: row.cached,
            search: foldSearchText(getFavoriteSearchText(row)),
            assets: [row.hasMarquee, row.hasFlyer, row.hasLogo],
            playCount: gameStats?.playCount ?? 0,
            vote: gameStats ? (gameStats.starred ? 'star' : String(gameStats.vote)) : null,
            starred: !!gameStats?.starred,
            category: gameCategory === undefined ? undefined : gameCategory?.name ?? '',
            hiscores: hasHiscoreExtraction(row.romName),
            playerScores: !!gameStats?.hasPlayerScores,
        };
    });
    const nameTemplate = (withExtra: boolean, hiscoreCup: boolean): string =>
        renderGameNameCell(name, withExtra ? extra : null, hiscoreCup, category);
    return {
        tokens: FAVORITE_TOKENS,
        games,
        templates: {
            // Keyed by "<has extra><has hiscores>".
            name: {
                '00': nameTemplate(false, false), '01': nameTemplate(false, true),
                '10': nameTemplate(true, false), '11': nameTemplate(true, true),
            },
            unresolvedName: `<em>${rom}</em>`,
            romName: [renderRomNameCellParts(rom, ''), renderRomNameCellParts(rom, dependencies)],
            assets: (['Marquee', 'Flyer', 'Logo'] as const).map(kind =>
                [renderAssetIcon(kind, false, rom), renderAssetIcon(kind, true, rom)]),
            votes: {
                star: renderVoteForm(rom, VOTE_UP, true),
                ...Object.fromEntries(([VOTE_UP, VOTE_NEUTRAL, VOTE_DOWN] as const)
                    .map(vote => [String(vote), renderVoteForm(rom, vote, false)])),
            },
            show: `<form method="post" action="/favorites/show">
                    <input type="hidden" name="romName" value="${rom}">
                    ${renderIconButton('Show on the cabinet', SHOW_ON_FRONT_ICON_PATHS, 'accent')}
                </form>`,
            remove: `<form method="post" action="/favorites/delete">
                    <input type="hidden" name="romName" value="${rom}">
                    ${renderIconButton('Remove from the list', TRASH_ICON_PATHS)}
                </form>`,
            categoryIcons,
        },
    };
}

/**
 * The favorites list (searchable, filterable by category, paginated client-side), followed by the
 * removed favorites in a card of their own.
 */
function renderFavoritesCard(favoritesInfo: FavoritesInfo, viewer: Viewer): string {
    const flash = `
        ${favoritesInfo.notice ? `<p class="info flash">${escapeHtml(favoritesInfo.notice)}</p>` : ''}
        ${favoritesInfo.warning ? `<p class="error flash">${escapeHtml(favoritesInfo.warning)}</p>` : ''}
    `;

    if (favoritesInfo.error) {
        return `
            <section class="card">
                <h2>List</h2>
                ${flash}
                <p class="info">${escapeHtml(favoritesInfo.error)}</p>
            </section>
        `;
    }

    // favorites.ini keeps mame's own order (new favorites are appended at the end), so the list is
    // sorted here, by name. A favorite not resolved yet has no name, its romName stands in
    // until it is (see updateFavoritesCache()).
    const sortedRows = [...favoritesInfo.rows].sort((a, b) => a.fullname.localeCompare(b.fullname));
    // undefined: no category known at all (database unreadable) - no icons, no category filter.
    const categoryOf = (row: FavoriteRow): GameCategory | null | undefined => favoritesInfo.stats
        ? favoritesInfo.stats.get(row.romName)?.category ?? null
        : undefined;
    const listData = buildFavoritesListData(sortedRows, favoritesInfo.stats);

    // Favorites removed from this list (removed-favorites.json), in their own table right after
    // it, newest first. A rom put back by another route (or by mame's own menu) since it was
    // removed is taken out again the next time MAUI starts (removeReturnedFavorites()): until
    // then it is in the list above - don't offer to restore what's already there.
    const current = new Set(favoritesInfo.rows.map(row => row.romName));
    const removed = readRemovedFavorites()
        .filter(item => !current.has(item.romName))
        .map(item => ({...item, fullname: item.cache?.fullname ?? item.fullname}))
        .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
    const removedRows = removed.map(item => {
        const row: FavoriteRow = {
            romName: item.romName, fullname: item.fullname, biosName: item.cache?.biosName ?? null,
            deviceRoms: item.cache?.deviceRoms ?? [], cached: !!item.cache,
            hasMarquee: false, hasFlyer: false, hasLogo: false,
        };
        const removedOn = new Date(item.removedAt).toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'short'});
        return `
        <tr>
            <td>${renderGameName(row.fullname, row.romName, categoryOf(row))}</td>
            <td>${renderRomNameCell(row)}</td>
            <td>${escapeHtml(removedOn)}</td>
            <td class="center">${favoritesInfo.stats?.get(row.romName)?.playCount || '<em>-</em>'}</td>
            <td class="center"><div class="row-actions">
                ${renderVoteCell(favoritesInfo.stats?.get(row.romName))}
                <form method="post" action="/favorites/restore">
                    <input type="hidden" name="romName" value="${escapeHtml(row.romName)}">
                    ${renderIconButton('Restore to the list', RESTORE_ICON_PATHS, 'ok')}
                </form>
            </div></td>
        </tr>`;
    }).join('');
    const removedCard = `
        <section class="card">
            <h2>Removed from the list (${removed.length})</h2>
            ${removed.length ? `
            <p class="info">"Restore" puts a removed game back into MAME's <code>favorites.ini</code> in
            alphabetical order, exactly as MAME had written it. Same precaution as for removal: not
            while a MAME game is open.</p>
            <div class="table-wrap">
                <table class="favorites-table fixed-columns">
                    <colgroup>
                        <col>
                        <col class="col-romname">
                        <col class="col-date">
                        <col class="col-plays">
                        <col class="col-actions-restore">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>RomName</th>
                            <th>Removed on</th>
                            <th class="center" title="Times the game was launched">Plays</th>
                            <th class="center">Vote / restore</th>
                        </tr>
                    </thead>
                    <tbody>${removedRows}</tbody>
                </table>
            </div>` : '<p class="info">No game removed from the list.</p>'}
        </section>
    `;

    // Category filter options: every category a favorite is in, with its favorite count, then the
    // favorites genre.ini doesn't know. Their value is data-category above ('' for none).
    const categoryCounts = new Map<string, number>();
    let uncategorizedCount = 0;
    for (const row of sortedRows) {
        const name = categoryOf(row)?.name;
        if (name) {
            categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + 1);
        } else {
            uncategorizedCount++;
        }
    }
    const categoryFilter = favoritesInfo.stats ? `
        <select id="favoritesCategory" aria-label="Filter the list by category">
            <option value="*">All categories (${sortedRows.length})</option>
            ${[...categoryCounts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) =>
                `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`).join('')}
            ${uncategorizedCount ? `<option value="">No category (${uncategorizedCount})</option>` : ''}
        </select>
    ` : '';

    // Filters a game must pass them all to be listed, each with the number of games it keeps.
    const countOf = (keep: (game: FavoriteListGame) => boolean): number => listData.games.filter(keep).length;
    const filters = [
        ...(favoritesInfo.stats ? [{id: 'favoritesStarred', label: 'Starred (My favourites)', count: countOf(game => game.starred)}] : []),
        {id: 'favoritesHiscores', label: 'Hiscores extractable', count: countOf(game => game.hiscores)},
        ...(favoritesInfo.stats ? [{id: 'favoritesPlayerScores', label: 'Players\' hiscores', count: countOf(game => game.playerScores)}] : []),
    ];

    return `
        <section class="card">
            <h2>List (${favoritesInfo.rows.length})</h2>
            ${flash}
            ${favoritesInfo.resolving ? renderResolutionProgress(favoritesInfo.resolving) : ''}
            <div class="table-search">
                <div class="table-search-controls">
                    <input type="search" id="favoritesSearch" placeholder="Search a name, rom name, bios or device…"
                        autocomplete="off" aria-label="Search the list">
                    ${categoryFilter}
                </div>
                <div class="table-search-filters">
                    ${filters.map(filter => `
                    <label class="filter-chip">
                        <input type="checkbox" id="${filter.id}">
                        <span>${escapeHtml(filter.label)} <span class="filter-chip-count">${filter.count}</span></span>
                    </label>`).join('')}
                    <span class="table-search-summary" id="favoritesSearchCount" aria-live="polite"></span>
                </div>
            </div>
            <div class="table-wrap">
                <table class="favorites-table fixed-columns" id="favoritesTable">
                    <colgroup>
                        <col>
                        <col class="col-romname">
                        <col class="col-assets">
                        <col class="col-plays">
                        <col class="col-actions">
                    </colgroup>
                    <thead>
                        <tr>
                            <th aria-sort="ascending"><button type="button" class="sort-header" data-sort="name">Name</button></th>
                            <th><button type="button" class="sort-header" data-sort="romName">RomName</button></th>
                            <th class="center" title="Marquee, flyer, logo">Assets</th>
                            <th class="center" title="Times the game was launched"><button type="button" class="sort-header" data-sort="playCount">Plays</button></th>
                            <th class="center">Vote / actions</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                <noscript><p class="info">The list needs JavaScript.</p></noscript>
            </div>
            <script type="application/json" id="favoritesData">${JSON.stringify(listData).replace(/</g, '\\u003c')}</script>
            <div class="table-pager" id="favoritesPager">
                <label for="favoritesPageSize">Per page</label>
                <select id="favoritesPageSize">
                    ${FAVORITES_PAGE_SIZES.map(size => `<option value="${size}"${size === FAVORITES_DEFAULT_PAGE_SIZE ? ' selected' : ''}>${size}</option>`).join('')}
                </select>
                <button type="button" id="favoritesPrevPage" aria-label="Previous page">‹</button>
                <span id="favoritesPageInfo" aria-live="polite"></span>
                <button type="button" id="favoritesNextPage" aria-label="Next page">›</button>
            </div>
            <script>(function () {
                // The games come as data (buildFavoritesListData()) and only the page shown is
                // turned into rows, from the server's own templates: hundreds of rows of forms and
                // icons are too much for a small machine to lay out, or to hide at each key typed.
                // Search: every term must appear (accents and case ignored) in a game's rom name,
                // name or bios / devices (its search, see getFavoriteSearchText()), and the game
                // must be in the chosen category ('*' for all) and pass every filter ticked. The
                // matches are then paginated.
                var data = JSON.parse(document.getElementById('favoritesData').textContent);
                var games = data.games;
                var templates = data.templates;
                var body = document.querySelector('#favoritesTable tbody');
                var search = document.getElementById('favoritesSearch');
                var category = document.getElementById('favoritesCategory');
                var filters = [
                    {box: document.getElementById('favoritesStarred'), keep: function (game) { return game.starred; }},
                    {box: document.getElementById('favoritesHiscores'), keep: function (game) { return game.hiscores; }},
                    {box: document.getElementById('favoritesPlayerScores'), keep: function (game) { return game.playerScores; }},
                ].filter(function (filter) { return filter.box; });
                var count = document.getElementById('favoritesSearchCount');
                var pageSize = document.getElementById('favoritesPageSize');
                var prev = document.getElementById('favoritesPrevPage');
                var next = document.getElementById('favoritesNextPage');
                var pageInfo = document.getElementById('favoritesPageInfo');
                var page = 0;
                // A form posted from the list (vote, remove) re-renders the whole page: its search,
                // category and page are stashed on submit and put back once, on that re-render only.
                var VIEW_KEY = 'bo.favorites.view';
                function keepView() {
                    try {
                        sessionStorage.setItem(VIEW_KEY, JSON.stringify({
                            search: search.value, category: category ? category.value : '*', page: page, sort: sort,
                            filters: filters.map(function (filter) { return filter.box.id; })
                                .filter(function (id) { return document.getElementById(id).checked; }),
                        }));
                    } catch (error) { /* storage blocked: the list just starts over */ }
                }
                document.getElementById('favoritesTable').addEventListener('submit', keepView);
                // While the names are resolved in the background (renderResolutionProgress()): its
                // progress every second, then the list again, with them, in the same view.
                var resolution = document.getElementById('favoritesResolution');
                if (resolution) {
                    var resolutionTimer = setInterval(function () {
                        fetch('/favorites/resolution', {headers: {'Accept': 'application/json'}})
                            .then(function (response) { return response.json(); })
                            .then(function (progress) {
                                if (!progress.total) {
                                    clearInterval(resolutionTimer);
                                    keepView();
                                    location.reload();
                                    return;
                                }
                                resolution.querySelector('[data-count]').textContent = progress.done + ' / ' + progress.total;
                                resolution.querySelector('[data-fill]').style.width = (100 * progress.done / progress.total) + '%';
                            })
                            .catch(function () { /* the next tick tries again */ });
                    }, 1000);
                }
                // The chosen page size is kept for this browser only (a convenience, not state).
                try {
                    var storedSize = localStorage.getItem('bo.favorites.pageSize');
                    if (storedSize && pageSize.querySelector('option[value="' + storedSize + '"]')) {
                        pageSize.value = storedSize;
                    }
                } catch (error) { /* storage blocked: default page size */ }
                function fold(text) {
                    return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
                }
                function escapeHtml(text) {
                    return String(text).replace(/[&<>"']/g, function (char) {
                        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char];
                    });
                }
                // Puts a game's values (already escaped) in a template, in place of its tokens.
                function fill(template, values) {
                    return Object.keys(values).reduce(function (html, token) {
                        return html.split(token).join(values[token]);
                    }, template);
                }
                function renderRow(game) {
                    var tokens = data.tokens;
                    var rom = {};
                    rom[tokens.rom] = escapeHtml(game.romName);
                    var name = {};
                    name[tokens.category] = templates.categoryIcons[game.category] || '';
                    name[tokens.extra] = escapeHtml(game.extra || '');
                    name[tokens.name] = escapeHtml(game.name);
                    var romCell = {};
                    romCell[tokens.rom] = rom[tokens.rom];
                    romCell[tokens.dependencies] = escapeHtml(game.dependencies);
                    var cells = [
                        game.cached
                            ? fill(templates.name[(game.extra ? '1' : '0') + (game.hiscores ? '1' : '0')], name)
                            : fill(templates.unresolvedName, rom),
                        fill(templates.romName[game.dependencies ? 1 : 0], romCell),
                        '<span class="asset-icons">' + game.assets.map(function (found, kind) {
                            return fill(templates.assets[kind][found ? 1 : 0], rom);
                        }).join('') + '</span>',
                        game.playCount ? String(game.playCount) : '<em>-</em>',
                        '<div class="row-actions">'
                            + (game.vote === null ? '<em>-</em>' : fill(templates.votes[game.vote], rom))
                            + fill(templates.show, rom) + fill(templates.remove, rom) + '</div>',
                    ];
                    return '<tr>' + cells.map(function (cell, index) {
                        return (index < 2 ? '<td>' : '<td class="center">') + cell + '</td>';
                    }).join('') + '</tr>';
                }
                // Sorted by a column header: the name (the server's order) and the rom name A to Z
                // first, the plays most first; a second click reverses it.
                var sort = {key: 'name', reversed: false};
                var headers = Array.prototype.slice.call(document.querySelectorAll('#favoritesTable .sort-header'));
                games.forEach(function (game, index) { game.order = index; });
                var SORTS = {
                    name: function (a, b) { return a.order - b.order; },
                    romName: function (a, b) { return a.romName.localeCompare(b.romName); },
                    playCount: function (a, b) { return b.playCount - a.playCount || a.order - b.order; },
                };
                function sorted(list) {
                    return list.slice().sort(function (a, b) {
                        return (sort.reversed ? -1 : 1) * SORTS[sort.key](a, b);
                    });
                }
                function showSort() {
                    headers.forEach(function (header) {
                        var on = header.dataset.sort === sort.key;
                        var ascending = (sort.key === 'playCount') === sort.reversed;
                        if (on) {
                            header.parentNode.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
                        } else {
                            header.parentNode.removeAttribute('aria-sort');
                        }
                    });
                }
                headers.forEach(function (header) {
                    header.addEventListener('click', function () {
                        sort = {key: header.dataset.sort, reversed: sort.key === header.dataset.sort && !sort.reversed};
                        applySearch();
                    });
                });
                function filtering() {
                    return search.value.trim() !== '' || (category && category.value !== '*')
                        || filters.some(function (filter) { return filter.box.checked; });
                }
                function render() {
                    var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                    var chosen = category ? category.value : '*';
                    var ticked = filters.filter(function (filter) { return filter.box.checked; });
                    var matches = sorted(games.filter(function (game) {
                        return terms.every(function (term) { return game.search.indexOf(term) >= 0; })
                            && (chosen === '*' || game.category === chosen)
                            && ticked.every(function (filter) { return filter.keep(game); });
                    }));
                    showSort();
                    var size = Number(pageSize.value);
                    var pages = Math.max(1, Math.ceil(matches.length / size));
                    page = Math.min(page, pages - 1);
                    body.innerHTML = matches.slice(page * size, (page + 1) * size).map(renderRow).join('');
                    pageInfo.textContent = 'Page ' + (page + 1) + ' / ' + pages;
                    prev.disabled = page === 0;
                    next.disabled = page >= pages - 1;
                    count.textContent = !filtering() ? ''
                        : matches.length ? matches.length + ' of ' + games.length + ' games'
                        : 'No game matches this search';
                }
                // A new search, category or page size starts over from the first page.
                function applySearch() {
                    page = 0;
                    render();
                }
                search.addEventListener('input', applySearch);
                if (category) { category.addEventListener('change', applySearch); }
                filters.forEach(function (filter) { filter.box.addEventListener('change', applySearch); });
                pageSize.addEventListener('change', function () {
                    try { localStorage.setItem('bo.favorites.pageSize', pageSize.value); } catch (error) { /* blocked */ }
                    applySearch();
                });
                prev.addEventListener('click', function () { page--; render(); });
                next.addEventListener('click', function () { page++; render(); });
                try {
                    var view = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
                    sessionStorage.removeItem(VIEW_KEY);
                    if (view) {
                        search.value = view.search || '';
                        if (category && category.querySelector('option[value="' + CSS.escape(view.category) + '"]')) {
                            category.value = view.category;
                        }
                        filters.forEach(function (filter) {
                            filter.box.checked = Array.isArray(view.filters) && view.filters.indexOf(filter.box.id) >= 0;
                        });
                        page = Number(view.page) || 0;
                        if (view.sort && SORTS[view.sort.key]) {
                            sort = {key: view.sort.key, reversed: !!view.sort.reversed};
                        }
                    }
                } catch (error) { /* storage blocked or unreadable: the list just starts over */ }
                render();
                search.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter') { event.preventDefault(); }
                });
            })();</script>
            <p class="info">Removing a game deletes its entry from MAME's <code>favorites.ini</code> (the
            roms and artwork stay on disk); it moves to "Removed from the list" below, from which it
            can be restored. The game leaves the cabinet's list at once, or as soon as the game
            being played on it is quit, and its vote is no longer asked.</p>
            ${ASSET_PREVIEW_SCRIPT}
            <p class="info">Assets: marquee, flyer and logo, in that order - green when the file is
            present (hover it to preview the image), red (struck through) when it is missing.${viewer === 'advanced'
                ? ' To download the missing artwork from ScreenScraper, use the button in the '
                    + '<a href="/screenscraper">ScreenScraper</a> tab.'
                : ''}</p>
            <p class="info">Vote: the one the players give on the cabinet once a game is quit (star,
            thumbs up, neutral or thumbs down), changeable here. A star is a thumbs up that also puts
            the game in the cabinet's "My favourites" category. Whether a thumbs down also removes the
            game from the list is set in the <a href="/maui">MAUI</a> tab.</p>
        </section>
        ${renderStarredCard(favoritesInfo)}
        ${removedCard}
    `;
}

/**
 * The cabinet's "My favourites" (the starred games, see GameVote.ts) to a file and back: for
 * another cabinet, or this one after a reinstall. An import adds stars, it never takes one away.
 */
function renderStarredCard(favoritesInfo: FavoritesInfo): string {
    const starred = favoritesInfo.rows.filter(row => favoritesInfo.stats?.get(row.romName)?.starred).length;
    return `
        <section class="card">
            <h2>My favourites (${starred})</h2>
            <p class="info">The games starred on the cabinet or above. Export them to a file, and import
            such a file here or on another cabinet: its games get a star (and a thumbs up) where the
            cabinet has them, the other games keep theirs. A game the cabinet doesn't have is left out.</p>
            ${starred ? `
            <form method="get" action="/favorites/starred/export">
                <button type="submit">Export</button>
            </form>` : ''}
            <form method="post" action="/favorites/starred/import" enctype="multipart/form-data">
                <label for="starredImportFile">File to import (a .json exported here)</label>
                <input type="file" id="starredImportFile" name="file" accept=".json" required>
                <button type="submit">Import</button>
            </form>
        </section>
    `;
}

interface FavoritesFlash {
    notice?: string;
    warning?: string;
}

// The star: a thumbs up that also puts the game in "My favourites" (GameVote.ts voteFields()).
const STAR_LABEL = 'Star (My favourites)';

const VOTE_LABELS: Record<Vote, string> = {
    [VOTE_UP]: 'Thumbs up',
    [VOTE_NEUTRAL]: 'Neutral',
    [VOTE_DOWN]: 'Thumbs down',
};

const VOTE_ICONS: Record<Vote, {cssClass: string, paths: string}> = {
    [VOTE_UP]: {cssClass: 'up', paths: THUMB_UP_ICON_PATHS},
    [VOTE_NEUTRAL]: {cssClass: 'neutral', paths: NEUTRAL_ICON_PATHS},
    [VOTE_DOWN]: {cssClass: 'down', paths: THUMB_DOWN_ICON_PATHS},
};

/**
 * A game's four vote buttons (star, thumbs up, neutral, thumbs down), the current one lit up,
 * posting to /votes/set.
 */
function renderVoteForm(romName: string, current: Vote, starred: boolean): string {
    const star = `
        <button type="submit" name="vote" value="star" class="icon-button star"
            aria-pressed="${starred}" title="${STAR_LABEL}" aria-label="${STAR_LABEL}">
            <svg ${ICON_SVG_ATTRS}>${STAR_ICON_PATHS}</svg>
        </button>
    `;
    const buttons = star + ([VOTE_UP, VOTE_NEUTRAL, VOTE_DOWN] as const).map(vote => `
        <button type="submit" name="vote" value="${vote}" class="icon-button ${VOTE_ICONS[vote].cssClass}"
            aria-pressed="${!starred && current === vote}" title="${VOTE_LABELS[vote]}" aria-label="${VOTE_LABELS[vote]}">
            <svg ${ICON_SVG_ATTRS}>${VOTE_ICONS[vote].paths}</svg>
        </button>
    `).join('');
    return `
        <form method="post" action="/votes/set" class="vote-buttons">
            <input type="hidden" name="romName" value="${escapeHtml(romName)}">
            ${buttons}
        </form>
    `;
}

/**
 * Vote cell of the favorites and removed favorites lists: the vote buttons, or '-' for a game the
 * database doesn't know (or no database at all) - /votes/set would have nothing to update.
 */
function renderVoteCell(stats: GameStats | undefined): string {
    return stats ? renderVoteForm(stats.romName, stats.vote, stats.starred) : '<em>-</em>';
}

// The Home carousel's category icons, embedded as text in this bundle (the BO has no access to
// the renderer's hashed asset files, and src/ is not shipped): keyed by file name without
// extension ("shooter", "_default"...), i.e. by getCategoryIconKey(), the same key the carousel
// derives its CSS class from.
const CATEGORY_ICONS: {[key: string]: string} = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/categories/*.svg', {query: '?raw', import: 'default', eager: true}))
        .map(([path, svg]) => [basename(path, '.svg'), svg as string]),
);

// The Controls tab's input icons (see src/assets/input-icons/LICENSE.txt), embedded the same way as
// CATEGORY_ICONS above: keyed by file name without extension, i.e. by inputIconKey().
const INPUT_ICONS: {[key: string]: string} = Object.fromEntries(
    Object.entries(import.meta.glob('./assets/input-icons/*.svg', {query: '?raw', import: 'default', eager: true}))
        .map(([path, svg]) => [basename(path, '.svg'), svg as string]),
);

/** Name of a command in the Controls cards, after its icon when it has one (see inputIconKey()). */
function renderBindingLabel(portType: string, label: string): string {
    return renderIconLabel(inputIconKey(portType), label);
}

function renderIconLabel(iconKey: string | undefined, label: string): string {
    const icon = iconKey && iconKey in INPUT_ICONS
        ? `<img class="binding-icon" src="/input-icons/${escapeHtml(iconKey)}.svg" alt="">`
        : '';
    return `<div class="binding-label">${icon}${escapeHtml(label)}</div>`;
}

/** Games tab: the favorites, then the removed ones (see renderFavoritesCard()). */
/** What the Games tab's Repository subtab shows (ONLINE mode only, see renderFavoritesPage()). */
interface RepoSection {
    mameInfo: MameInfo;
    packs?: RepoPack[];
    error?: string;
    info?: string;
    // Announced by MAUI-API, shown once the packs are loaded.
    url?: string;
}

/**
 * The Games tab: the favorites and, in ONLINE mode, the pack repository the games come
 * from (`repository`), as a second subtab - opened by default when a repository action set its
 * packs or a message.
 */
function renderFavoritesPage(favoritesInfo: FavoritesInfo, viewer: Viewer, repository?: RepoSection): string {
    const favoritesHtml = renderFavoritesCard(favoritesInfo, viewer);
    if (!repository) {
        return renderPage(favoritesHtml, 'favorites', viewer);
    }
    const {mameInfo, packs, error, info, url} = repository;
    // The repository's imports resolve every path from the MAME binary: nothing to act on until
    // it is configured (same gating as the MAME tab's Import section).
    const repositoryHtml = mameInfo.error
        ? `<section class="card"><h2>Starting pack repository</h2>
            <p class="error">${escapeHtml(mameInfo.error)}</p></section>`
        : renderRepoImportCard(mameInfo, packs, error, info, url);
    return renderSubtabbedPage('favorites', [
        {id: 'favorites', label: 'List', html: favoritesHtml},
        {id: 'repository', label: 'Repository', html: repositoryHtml},
    ], viewer, packs !== undefined || error !== undefined || info !== undefined ? 'repository' : undefined);
}

/**
 * The configuration pack (see ConfPack.ts): the category files the carousel needs. Shown outside
 * Advanced configuration too - without it the carousel has no genres. Downloaded from the pack
 * repository in ONLINE mode only (see RepositoryAuth.ts). There is no manual import: MAME experts
 * set the emulator up themselves, everyone else goes ONLINE.
 */
function renderConfPackCard(mameInfo: MameInfo): string {
    const online = isOnlineActive();
    const missing = getMissingConfPackFiles(mameInfo);
    const locked = online ? ' - the game packs of the repository stay locked until it is installed' : '';
    const status = missing.length
        ? `<p class="error">${renderFoundIcon(false)}Missing: ${missing.map(escapeHtml).join(', ')}${locked}.</p>`
        : `<p class="info">${renderFoundIcon(true)}Installed (catver.ini, genre.ini, Multiplayer.ini).</p>`;
    const action = online
        ? `<form method="post" action="/import/conf-pack" data-stream>
                <button type="submit">${missing.length ? 'Install' : 'Update'} the configuration pack</button>
            </form>`
        : '<p class="info"><em>Turn ONLINE mode on (MAUI tab) to download it.</em></p>';
    return `
        <section class="card">
            <h2>Configuration pack</h2>
            <p class="info">Genres (catver.ini, genre.ini) and player counts (Multiplayer.ini) the carousel is
            built from. Required: it is also reinstalled before every game pack import from the repository.</p>
            ${status}
            ${action}
        </section>
    `;
}

/**
 * The starter pack (see ConfPack.ts): a few curated games to start with, installed whole from the
 * repository in ONLINE mode, the configuration pack first (same as every import from there). No
 * network call to render it: the pack's content is only read on install.
 */
function renderStarterPackCard(): string {
    const action = isOnlineActive()
        ? `<form method="post" action="/import/starter-pack" data-stream>
                <button type="submit">Install the starter pack</button>
            </form>`
        : '<p class="info"><em>Turn ONLINE mode on (MAUI tab) to download it.</em></p>';
    return `
        <section class="card">
            <h2>Starter pack</h2>
            <p class="info">A selection of games to start with, downloaded from the repository with the
            configuration pack. Adds them to the list; other games are left untouched.</p>
            ${action}
        </section>
    `;
}

/**
 * The MAME tab's Import section, also re-rendered after each import. `error`: a failed
 * repository action.
 */
function renderImportSection(mameInfo: MameInfo, error?: string, exportError?: string): string {
    return (error ? `<p class="error flash">${escapeHtml(error)}</p>` : '')
        + renderConfPackCard(mameInfo)
        + renderStarterPackCard()
        + renderMameExportCard(exportError);
}

/** The light export of mame's own files (MameBackup.ts): never the roms nor the pictures. */
function renderMameExportCard(error?: string): string {
    return `
        <section class="card">
            <h2>Export MAME's configuration</h2>
            <p class="info">A small ZIP of what ~/.mame holds besides the games: without the roms,
            samples, pictures nor videos. Unzipped in ~/.mame, it puts each file back in place.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <form method="get" action="/mame/export">
                ${MAME_BACKUP_PARTS.map(part => `
                <label class="checkbox-row">
                    <input type="checkbox" name="${part.id}" checked>
                    ${escapeHtml(part.label)}
                </label>`).join('')}
                <button type="submit">Export</button>
            </form>
        </section>
    `;
}

function humanFileSize(bytes: number): string {
    let size = bytes;
    for (const unit of ['B', 'KiB', 'MiB', 'GiB']) {
        if (size < 1024) {
            return `${size.toFixed(1)} ${unit}`;
        }
        size /= 1024;
    }
    return `${size.toFixed(1)} TiB`;
}

interface DiskSpace {
    path: string;
    freeBytes: number;
    totalBytes: number;
    // st_dev of the nearest existing ancestor - two paths with the same value share a
    // filesystem (a pack is downloaded to the OS temp dir, then extracted to the roms dir).
    deviceId: number;
}

/**
 * Free space (available to a non-root user) on the filesystem holding `path`, or null when it
 * can't be determined. Walks up to the nearest existing ancestor first: the roms directory may
 * not be created yet on a fresh MAME home. statfsSync is cross-platform (Node >= 18.15).
 */
function getDiskSpace(path: string): DiskSpace | null {
    let probe = path;
    while (!existsSync(probe)) {
        const parent = dirname(probe);
        if (parent === probe) {
            return null;
        }
        probe = parent;
    }
    try {
        const stats = statfsSync(probe);
        return {
            path,
            freeBytes: stats.bavail * stats.bsize,
            totalBytes: stats.blocks * stats.bsize,
            deviceId: statSync(probe).dev,
        };
    } catch {
        return null;
    }
}

// Walking a big roms folder (thousands of zips, CHD subfolders) is not free, and the MAME tab
// re-renders on every action - remember the last result for a short while.
const DIRECTORY_SIZE_CACHE_MS = 30_000;
const directorySizeCache = new Map<string, {bytes: number; at: number}>();

/**
 * Total size of the regular files under `path` (recursive, symlinks not followed), 0 when it
 * does not exist. Unreadable entries are skipped rather than failing the whole card.
 */
function getDirectorySize(path: string): number {
    const cached = directorySizeCache.get(path);
    if (cached && Date.now() - cached.at < DIRECTORY_SIZE_CACHE_MS) {
        return cached.bytes;
    }
    let bytes = 0;
    const pending = [path];
    while (pending.length) {
        const dir = pending.pop() as string;
        let entries;
        try {
            entries = readdirSync(dir, {withFileTypes: true});
        } catch {
            continue;
        }
        for (const entry of entries) {
            const entryPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                pending.push(entryPath);
            } else if (entry.isFile()) {
                try {
                    bytes += lstatSync(entryPath).size;
                } catch {
                    // vanished between readdir and stat - ignore
                }
            }
        }
    }
    directorySizeCache.set(path, {bytes, at: Date.now()});
    return bytes;
}

/**
 * Combined size of the given folders, counting only those on the filesystem `deviceId` (the
 * bar is about that one disk) and never twice: a folder nested inside another listed one is
 * already part of it.
 */
function getInstalledContentBytes(paths: (string | null)[], deviceId: number): number {
    const onDisk = [...new Set(paths.filter((path): path is string => !!path))].filter(path => {
        try {
            return statSync(path).dev === deviceId;
        } catch {
            return false;
        }
    });
    return onDisk
        .filter(path => !onDisk.some(other => other !== path && path.startsWith(other.replace(/[\\/]+$/, '') + sep)))
        .reduce((total, path) => total + getDirectorySize(path), 0);
}

/**
 * Distinct, stable colour per pack (its index in the repository listing, not its tick order), so
 * the swatch beside a checkbox, its segment in the disk bar and its legend entry always match.
 * The golden angle spreads consecutive hues apart however many packs there are.
 */
function packColor(index: number): string {
    return `hsl(${Math.round((index * 137.508) % 360)}, 65%, 58%)`;
}

/**
 * Free-space block for the repository card: one bar over the total size of the disk holding the
 * roms - space already used in grey, then (filled in by the script in renderRepoPackPicker() as
 * games are ticked/unticked) one coloured segment per pack the selected games come from, with a
 * legend. A pack's segment is the extracted size of its selected games (rom zip + artwork, plus
 * each BIOS/parent set they need, once) +5% for filesystem block overhead, the same margin as the
 * import script's own preflight. Nothing is downloaded to a temporary file any more (the script
 * reads just what it needs from the pack with HTTP Range requests), so only this disk matters.
 */
function renderDiskSpaceInfo(mameInfo: MameInfo): string {
    const romPath = mameInfo.romPath;
    const roms = romPath ? getDiskSpace(romPath) : null;
    if (!roms) {
        return '';
    }
    const usedBytes = Math.max(0, roms.totalBytes - roms.freeBytes);
    // Part of the used space that is pack content already installed (roms + marquees/flyers/
    // logos, what a pack carries - its ini files are negligible), before any pack is added; the
    // rest being whatever else lives on the disk. Capped at the used total: these folders can
    // hold more than the filesystem reports as used (e.g. compressed/deduplicated storage).
    const romsBytes = Math.min(usedBytes, getInstalledContentBytes(
        [roms.path, mameInfo.marqueePath, mameInfo.flyerPath, mameInfo.logoPath], roms.deviceId,
    ));
    const otherBytes = usedBytes - romsBytes;
    const percentOf = (bytes: number): string => (
        roms.totalBytes > 0 ? Math.min(100, bytes / roms.totalBytes * 100) : 0
    ).toFixed(2);
    return `
        <div class="disk-space" data-total="${roms.totalBytes}" data-roms-free="${roms.freeBytes}">
            <p class="info">Disk space for the roms
            (<span class="current-path">${escapeHtml(roms.path)}</span>):
            <strong>${escapeHtml(humanFileSize(roms.freeBytes))}</strong> free of
            ${escapeHtml(humanFileSize(roms.totalBytes))}</p>
            <div class="disk-bar-track">
                <div class="disk-bar-used" style="width: ${percentOf(otherBytes)}%"
                    title="Other data: ${escapeHtml(humanFileSize(otherBytes))}"></div>
                <div class="disk-bar-roms" style="width: ${percentOf(romsBytes)}%"
                    title="Roms &amp; artwork already installed: ${escapeHtml(humanFileSize(romsBytes))}"></div>
            </div>
            <p class="disk-zoom-note" hidden></p>
            <ul class="disk-legend">
                <li class="disk-legend-static"><span class="pack-swatch disk-bar-used"></span>Other data
                    (${escapeHtml(humanFileSize(otherBytes))})</li>
                <li class="disk-legend-static"><span class="pack-swatch disk-bar-roms"></span>Roms &amp; artwork already installed
                    (${escapeHtml(humanFileSize(romsBytes))})</li>
            </ul>
            <p class="info disk-space-selection" hidden></p>
        </div>
    `;
}

/**
 * `<pack>.manifest.json` next to a pack's zip on the repository:
 * the list of its games, which is all that is needed to tell what is already installed without
 * downloading the pack. null on any failure (missing file, timeout, invalid JSON): the pack is
 * then simply listed without that comparison instead of failing the whole browse.
 */
async function fetchRepoManifest(
    repoUrl: string, packFilename: string, headers: Record<string, string>,
): Promise<StartingPackManifest | null> {
    if (!/^[\w.-]+\.zip$/.test(packFilename)) {
        return null;
    }
    try {
        const response = await fetch(`${repoUrl}/${packFilename.replace(/\.zip$/, '')}.manifest.json`, {
            headers,
            // The headers carry the cabinet token: never follow a redirect elsewhere.
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
        });
        return response.ok ? await response.json() as StartingPackManifest : null;
    } catch {
        return null;
    }
}

/**
 * The games of `manifests` the installed MAME cannot run with the sets of their pack, by game then
 * reason, one map per manifest; null for a manifest that does not describe its sets, and for all
 * when MAME cannot be asked. One `mame -listxml` for all the games: nothing is downloaded.
 */
async function findPacksIncompatibleGames(
    config: Config, manifests: readonly (StartingPackManifest | null)[],
): Promise<(Map<string, string> | null)[]> {
    const mameBinary = config.mamePath && config.mameBinaryName ? join(config.mamePath, config.mameBinaryName) : '';
    const described = manifests.filter(manifest => manifest?.romsets && Array.isArray(manifest.games)) as StartingPackManifest[];
    if (!described.length || !mameBinary || !existsSync(mameBinary)) {
        return manifests.map(() => null);
    }
    const romNames = [...new Set(described.flatMap(manifest => manifest.games.map(game => game.romName)))]
        .filter(romName => /^[\w.-]+$/.test(romName));
    const machines = await listMachines(mameBinary, getMameInfo(config).iniPath, romNames);
    return manifests.map(manifest => (machines ? findIncompatibleGames(manifest, machines) : null));
}

/**
 * The games of a pack this machine is too weak to run at full speed, by game then reason: none on
 * a machine that is no Raspberry Pi 3 or the like, nor for a manifest without speeds.
 */
function findCabinetTooSlowGames(
    manifest: StartingPackManifest | null, forced: ReadonlySet<string> = new Set(),
): Map<string, string> {
    return manifest && Array.isArray(manifest.games) && isWeakHardware(os.totalmem())
        ? findTooSlowGames(manifest, forced) : new Map();
}

const MISSING_GAMES_SHOWN = 4;

function renderPackOwnership(ownership: PackOwnership | undefined): string {
    if (!ownership) {
        return '';
    }
    if (isPackFullyOwned(ownership)) {
        return `<span class="pack-status pack-status-owned">Already installed (${ownership.total}/${ownership.total} roms)</span>`;
    }
    if (ownership.owned === 0) {
        return '<span class="pack-status">Not installed yet</span>';
    }
    // Some of it is installed, the rest is new to this machine: an updated pack, or a partial import.
    const shown = ownership.missing.slice(0, MISSING_GAMES_SHOWN).map(escapeHtml).join(', ');
    const more = ownership.missing.length > MISSING_GAMES_SHOWN
        ? ` and ${ownership.missing.length - MISSING_GAMES_SHOWN} more` : '';
    return `<span class="pack-status pack-status-update">Update available: ${ownership.missing.length} new game(s)
        (${ownership.owned}/${ownership.total} roms installed) - ${shown}${more}</span>`;
}

/** How many games of a pack are not offered because the installed MAME cannot run them. */
function renderPackIncompatible(pack: RepoPack): string {
    const count = (pack.games ?? []).filter(game => game.incompatibility && game.status !== 'installed').length;
    const tooSlow = (pack.games ?? []).filter(game => game.tooSlow && game.status !== 'installed').length;
    return (count
        ? `<span class="pack-status pack-status-incompatible">${count} game(s) not compatible with the installed MAME</span>`
        : '')
        + (tooSlow ? `<span class="pack-status pack-status-incompatible">${tooSlow} game(s) too slow on this cabinet</span>` : '');
}

const PACK_GAME_MARKS: {[status in PackGameDetail['status']]: {mark: string; title: string}} = {
    installed: {mark: '✓', title: 'Already installed'},
    new: {mark: '+', title: 'Not installed yet'},
    'no-rom': {mark: '·', title: 'No rom file of its own'},
};

/**
 * Expandable list of a pack's games. Each game that is not installed yet has its own checkbox
 * (`game`, value "<pack>|<romName>"): the import then takes only the ticked ones from that pack.
 * The same game listed by several packs is ticked everywhere at once (script in
 * renderRepoPackPicker()) and fetched from the first of them only. Rendered next to the pack's
 * <label>, never inside it: a click on a <summary> inside a <label> would also tick the pack's
 * checkbox. The "new" marks are only highlighted when part of the pack is already installed (an
 * update): for a pack never imported, every game being "new" is not worth a colour.
 */
function renderPackGames(pack: RepoPack, fullyOwned: boolean): string {
    if (!pack.games?.length) {
        return '';
    }
    const isUpdate = !!pack.ownership && pack.ownership.owned > 0 && !fullyOwned;
    const items = pack.games.map(game => {
        const {mark, title} = PACK_GAME_MARKS[game.status];
        // The publisher when the pack carries it (mame's manufacturer mixes studios and licensees).
        const studio = game.publisher ?? (game.manufacturer && decodeXmlEntities(game.manufacturer));
        const meta = [game.year, studio, game.categoryName]
            .filter((part): part is string => !!part).map(escapeHtml).join(' · ');
        const hasHi = hasHiscoreExtraction(game.romName);
        const label = `${escapeHtml(decodeXmlEntities(game.fullname))}${hasHi
            ? ' <span class="hi-badge" title="Hiscores can be extracted for this game (mhiex)">HI</span>' : ''}
            ${meta ? `<span class="checkbox-row-detail">${meta}</span>` : ''}`;
        const classes = `pack-game pack-game-${game.status}${game.status === 'new' && isUpdate ? ' pack-game-highlight' : ''}`;
        // What the search box looks in (folded and matched in the page, see renderRepoPackPicker()).
        const search = escapeHtml([
            decodeXmlEntities(game.fullname), game.romName, game.manufacturer && decodeXmlEntities(game.manufacturer),
            game.publisher, game.categoryName, game.year,
        ].filter(Boolean).join(' '));
        if (game.tooSlow && game.status !== 'installed') {
            // Not offered: this cabinet is too weak for it (PackImport's tooSlowGames), unless its
            // owner asks for it all the same. A click on the cross swaps it for the game's
            // checkbox, left unticked (script in renderRepoPackPicker()); until then both fields
            // are disabled, so neither is posted nor ticked by a pack box. `forceSlow` is what
            // lets the import take it.
            return `
                <li class="pack-game pack-game-incompatible pack-game-slow" data-search="${search}" data-hi="${hasHi ? '1' : '0'}"
                    title="${escapeHtml(`Too slow on this cabinet: ${game.tooSlow}.`)}">
                    <button type="button" class="pack-game-mark pack-game-unlock" data-rom="${escapeHtml(game.romName)}"
                        title="Offer it all the same" aria-label="${escapeHtml(`Offer ${decodeXmlEntities(game.fullname)} all the same`)}">✕</button>
                    <label class="pack-game-label">
                        <input type="checkbox" class="game-checkbox" name="game" disabled hidden
                            value="${escapeHtml(`${pack.filename}|${game.romName}`)}"
                            data-rom="${escapeHtml(game.romName)}" data-size="${game.size}"
                            data-bios="${escapeHtml(game.requiredRoms.join(' '))}">
                        <input type="hidden" name="forceSlow" value="${escapeHtml(game.romName)}" disabled>
                        <span>${label}<span class="checkbox-row-detail">Too slow on this cabinet (${escapeHtml(game.tooSlow)})</span></span>
                    </label>
                </li>
            `;
        }
        if (game.incompatibility && game.status !== 'installed') {
            // Not offered at all: the import would refuse it anyway (PackImport's precheckGames).
            return `
                <li class="pack-game pack-game-incompatible" data-search="${search}" data-hi="${hasHi ? '1' : '0'}"
                    title="${escapeHtml(`The installed MAME cannot run it: ${game.incompatibility}.`)}">
                    <span class="pack-game-mark">✕</span>
                    <span>${label}<span class="checkbox-row-detail">Not compatible with the installed MAME</span></span>
                </li>
            `;
        }
        if (game.status === 'installed' || fullyOwned) {
            return `
                <li class="${classes}" data-search="${search}" data-hi="${hasHi ? '1' : '0'}">
                    <span class="pack-game-mark" title="${title}">${mark}</span>
                    <span>${label}</span>
                </li>
            `;
        }
        return `
            <li class="${classes}" data-search="${search}" data-hi="${hasHi ? '1' : '0'}">
                <label class="pack-game-label">
                    <input type="checkbox" class="game-checkbox" name="game"
                        value="${escapeHtml(`${pack.filename}|${game.romName}`)}"
                        data-rom="${escapeHtml(game.romName)}" data-size="${game.size}"
                        data-bios="${escapeHtml(game.requiredRoms.join(' '))}">
                    <span>${label}</span>
                </label>
            </li>
        `;
    }).join('');
    return `
        <details class="pack-details">
            <summary>Games in this pack (${pack.games.length})</summary>
            <ul class="pack-games">${items}</ul>
        </details>
    `;
}

function renderRepoPackPicker(packs: RepoPack[]): string {
    if (!packs.length) {
        return '<p class="info flash">No pack available on this repository.</p>';
    }
    const rows = packs.map((pack, index) => {
        const details = [
            humanFileSize(pack.size),
            pack.gameCount !== undefined ? `${pack.gameCount} game(s)` : null,
            pack.generatedAt ? new Date(pack.generatedAt).toLocaleDateString('en-GB') : null,
        ].filter((part): part is string => part !== null).join(' — ');
        const color = packColor(index);
        // Everything in the pack is already installed: nothing to fetch, so it cannot be ticked.
        const owned = isPackFullyOwned(pack.ownership);
        // Without its manifest there is no list of games to pick from (the import needs the rom
        // names), so such a pack cannot be selected either.
        const unavailable = !pack.games?.length;
        return `
            <div class="pack-row" data-pack="${escapeHtml(pack.filename)}" data-color="${color}"
                data-bios-sizes="${escapeHtml(JSON.stringify(pack.biosSizes ?? {}))}">
            <label class="checkbox-row${owned || unavailable ? ' pack-owned' : ''}">
                <input type="checkbox" class="pack-toggle"${owned || unavailable ? ' disabled' : ''}>
                <span class="pack-swatch" style="background-color: ${color}"></span>
                <span>${escapeHtml(pack.filename)}<span class="checkbox-row-detail">${escapeHtml(details)}</span>
                    ${unavailable
                        ? '<span class="pack-status">Manifest unavailable - its games cannot be listed</span>'
                        : renderPackOwnership(pack.ownership) + renderPackIncompatible(pack)}</span>
            </label>
            ${renderPackGames(pack, owned)}
            </div>
        `;
    }).join('');
    // Submit stays disabled until at least one game is ticked (server re-checks either way).
    // The search box sits outside the form: Enter in it must not submit the import.
    return `
        <div class="pack-search">
            <input type="search" id="packSearch" placeholder="Search a game, studio or category…"
                autocomplete="off" aria-label="Search the games of the packs">
            <label class="checkbox-row">
                <input type="checkbox" id="packHiOnly">
                <span>Only games with hiscores extraction (<span class="hi-badge">HI</span>) not installed yet</span>
            </label>
            <p class="info pack-search-count" id="packSearchCount" hidden></p>
        </div>
        <form method="post" action="/import/from-url" data-stream
            onsubmit="return confirm('This overwrites the roms and media of the selected games, then adds them to your MAME favorites without touching yours. Only these games are fetched from their pack. Continue?')">
            <p class="info">Tick a pack for all its games not installed yet, or open it to pick games one by one.
            A game listed by several packs is fetched once. The hiscores box also ticks the games it shows.
            While a search or the hiscores filter is active, the pack boxes and "Select all" only act on the
            games shown; ticked games stay ticked when they are hidden. A game marked too slow for this cabinet
            can be taken all the same: click its cross, then tick it.</p>
            ${rows}
            <label class="checkbox-row">
                <input type="checkbox" id="packSelectAll">
                <span>Select all</span>
            </label>
            <button type="submit" id="packSubmit" disabled>Fetch and import</button>
        </form>
        <script>(function () {
            var rows = Array.prototype.slice.call(document.querySelectorAll('.pack-row'));
            var all = document.getElementById('packSelectAll');
            var submit = document.getElementById('packSubmit');
            var disk = document.querySelector('.disk-space');
            var summary = disk && disk.querySelector('.disk-space-selection');
            var track = disk && disk.querySelector('.disk-bar-track');
            var legend = disk && disk.querySelector('.disk-legend');
            var zoomNote = disk && disk.querySelector('.disk-zoom-note');
            var search = document.getElementById('packSearch');
            var searchCount = document.getElementById('packSearchCount');
            var hiOnly = document.getElementById('packHiOnly');
            // Below this share of the disk, the selection is a sliver of the full bar (700 MB on
            // a 1 TB disk): the bar then shows only the free space instead of the whole disk.
            var ZOOM_BELOW = 0.02;
            function formatSize(bytes) {
                var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
                var i = 0;
                while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
                return bytes.toFixed(1) + ' ' + units[i];
            }
            // Disabled: a game too slow for this cabinet, until its cross is clicked (see below).
            function gameBoxes(row) {
                return Array.prototype.slice.call(row.querySelectorAll('.game-checkbox:not([disabled])'));
            }
            var everyBox = Array.prototype.slice.call(document.querySelectorAll('.pack-row .game-checkbox'));
            function enabledBoxes() { return everyBox.filter(function (box) { return !box.disabled; }); }
            // What a pack box / "Select all" acts on: the games a search leaves showing.
            function isShown(box) { return !box.closest('li').hidden; }
            function shownBoxes(row) { return gameBoxes(row).filter(isShown); }
            // Adds one segment to the bar and its entry to the legend.
            function addPart(bytes, total, label, color) {
                var seg = document.createElement('div');
                seg.className = 'disk-bar-seg';
                seg.style.width = (bytes / total * 100).toFixed(2) + '%';
                seg.style.backgroundColor = color;
                seg.title = label + ': ' + formatSize(bytes);
                track.appendChild(seg);
                var item = document.createElement('li');
                item.className = 'disk-legend-part';
                var swatch = document.createElement('span');
                swatch.className = 'pack-swatch';
                swatch.style.backgroundColor = color;
                item.appendChild(swatch);
                item.appendChild(document.createTextNode(label + ' (' + formatSize(bytes) + ')'));
                legend.appendChild(item);
            }
            // A game listed by several packs is only fetched from the first one (in page order)
            // that has it ticked: the size and legend entry go to that pack alone.
            function selection() {
                var seen = {};
                return rows.map(function (row) {
                    var bios = {};
                    var biosSizes = JSON.parse(row.dataset.biosSizes || '{}');
                    var bytes = 0;
                    var games = 0;
                    gameBoxes(row).forEach(function (box) {
                        if (!box.checked || seen[box.dataset.rom]) { return; }
                        seen[box.dataset.rom] = true;
                        games++;
                        bytes += Number(box.dataset.size);
                        (box.dataset.bios || '').split(' ').forEach(function (name) {
                            if (name && !bios[name]) {
                                bios[name] = true;
                                bytes += Number(biosSizes[name] || 0);
                            }
                        });
                    });
                    return {name: row.dataset.pack.replace(/[.]zip$/, ''), color: row.dataset.color, games: games, bytes: bytes};
                });
            }
            function refresh() {
                rows.forEach(function (row) {
                    var boxes = shownBoxes(row);
                    var ticked = boxes.filter(function (box) { return box.checked; }).length;
                    var toggle = row.querySelector('.pack-toggle');
                    // Nothing it could tick: every game shown is installed or not offered.
                    toggle.disabled = boxes.length === 0;
                    toggle.checked = boxes.length > 0 && ticked === boxes.length;
                    toggle.indeterminate = ticked > 0 && ticked < boxes.length;
                });
                // The import takes every ticked game, shown or not.
                var pickedBoxes = enabledBoxes().filter(function (box) { return box.checked; });
                submit.disabled = pickedBoxes.length === 0;
                var shownAll = enabledBoxes().filter(isShown);
                all.checked = shownAll.length > 0 && shownAll.every(function (box) { return box.checked; });
                all.disabled = shownAll.length === 0;
                if (!summary) { return; }
                var total = Number(disk.dataset.total);
                var free = Number(disk.dataset.romsFree);
                var parts = selection().filter(function (part) { return part.games > 0; });
                var games = parts.reduce(function (sum, part) { return sum + part.games; }, 0);
                var fetched = parts.reduce(function (sum, part) { return sum + part.bytes; }, 0);
                // +5% for filesystem block overhead, like the import script's own preflight check.
                var needed = fetched * 1.05;
                var enough = needed <= free;

                Array.prototype.slice.call(track.querySelectorAll('.disk-bar-seg')).forEach(function (el) { el.remove(); });
                Array.prototype.slice.call(legend.querySelectorAll('.disk-legend-part')).forEach(function (el) { el.remove(); });
                // Zoomed: the bar spans the free space only (used segments hidden by CSS) and the
                // needed bytes are relative to it. Never when they do not fit - that overflow
                // has to show against the whole disk.
                var zoomed = needed > 0 && needed <= free && needed < total * ZOOM_BELOW;
                var scale = zoomed ? free : total;
                disk.classList.toggle('disk-zoomed', zoomed);
                zoomNote.hidden = !zoomed;
                zoomNote.textContent = 'Zoomed on the free space (' + formatSize(free)
                    + ') - the bar no longer shows the ' + formatSize(total) + ' disk as a whole.';
                if (scale > 0) {
                    parts.forEach(function (part) {
                        addPart(part.bytes * 1.05, scale, part.name + ', ' + part.games + ' game(s)', part.color);
                    });
                }
                track.classList.toggle('disk-bar-overflow', !enough);

                summary.hidden = games === 0;
                summary.className = 'disk-space-selection ' + (enough ? 'info' : 'error');
                summary.textContent = games + ' game(s) from ' + parts.length + ' pack(s): '
                    + formatSize(fetched) + ' to fetch, about ' + formatSize(needed)
                    + ' needed, ' + formatSize(Math.max(0, free - needed)) + ' left afterwards'
                    + (enough ? '.' : ' - not enough free disk space.');
            }
            // Ticking a game ticks the same game in every other pack that lists it.
            function mirror(box) {
                enabledBoxes().forEach(function (other) {
                    if (other.dataset.rom === box.dataset.rom) { other.checked = box.checked; }
                });
            }
            everyBox.forEach(function (box) {
                box.addEventListener('change', function () { mirror(box); refresh(); });
            });
            // The cross of a game too slow for this cabinet: a click swaps it for the game's
            // checkbox, unticked, in every pack that lists the game.
            Array.prototype.forEach.call(document.querySelectorAll('.pack-game-unlock'), function (cross) {
                cross.addEventListener('click', function () {
                    Array.prototype.forEach.call(document.querySelectorAll('.pack-game-unlock'), function (other) {
                        if (other.dataset.rom !== cross.dataset.rom) { return; }
                        var item = other.closest('li');
                        Array.prototype.forEach.call(item.querySelectorAll('input'), function (input) {
                            input.disabled = false;
                            input.hidden = false;
                        });
                        item.classList.remove('pack-game-incompatible');
                        other.remove();
                    });
                    refresh();
                });
            });
            rows.forEach(function (row) {
                row.querySelector('.pack-toggle').addEventListener('change', function (event) {
                    shownBoxes(row).forEach(function (box) { box.checked = event.target.checked; mirror(box); });
                    refresh();
                });
            });
            all.addEventListener('change', function () {
                enabledBoxes().filter(isShown).forEach(function (box) { box.checked = all.checked; mirror(box); });
                refresh();
            });

            // Search: every term must appear (accents and case ignored) in the game's name, rom
            // name, studio, category or year, or in its pack's name; with the hiscores box ticked
            // the game must also have an extractor (data-hi) and be one to install, see below. A pack with no match is hidden,
            // one with matches opens on them; clearing both puts the packs back as they were.
            function fold(text) {
                return text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
            }
            var openBeforeSearch = null;
            function applySearch() {
                var terms = fold(search.value).split(/\\s+/).filter(Boolean);
                var searching = terms.length > 0 || hiOnly.checked;
                if (searching && openBeforeSearch === null) {
                    openBeforeSearch = rows.map(function (row) {
                        var details = row.querySelector('.pack-details');
                        return details ? details.open : false;
                    });
                }
                var games = 0;
                var packs = 0;
                rows.forEach(function (row, index) {
                    var packName = fold(row.dataset.pack);
                    var shown = 0;
                    Array.prototype.forEach.call(row.querySelectorAll('.pack-game'), function (item) {
                        var haystack = packName + ' ' + fold(item.dataset.search || '');
                        // The hiscores box is a selection: it only leaves what it can tick, not the
                        // games already installed nor those this machine is not offered.
                        var match = terms.every(function (term) { return haystack.indexOf(term) >= 0; })
                            && (!hiOnly.checked || (item.dataset.hi === '1'
                                && !!item.querySelector('.game-checkbox:not([disabled])')));
                        item.hidden = !match;
                        if (match) { shown++; }
                    });
                    row.hidden = searching && shown === 0;
                    var details = row.querySelector('.pack-details');
                    if (details) {
                        details.open = searching ? shown > 0 : (openBeforeSearch ? openBeforeSearch[index] : details.open);
                    }
                    games += shown;
                    if (shown > 0) { packs++; }
                });
                if (!searching) { openBeforeSearch = null; }
                searchCount.hidden = !searching;
                searchCount.textContent = games
                    ? games + ' game(s) found in ' + packs + ' pack(s).'
                    : 'No game matches.';
                refresh();
            }
            search.addEventListener('input', applySearch);
            // The hiscores box also ticks what it leaves showing (the games with an extractor
            // this machine is offered), and unticking it takes back the ones it ticked itself.
            var tickedByHiOnly = [];
            hiOnly.addEventListener('change', function () {
                applySearch();
                if (hiOnly.checked) {
                    tickedByHiOnly = enabledBoxes().filter(function (box) { return isShown(box) && !box.checked; });
                    tickedByHiOnly.forEach(function (box) { box.checked = true; mirror(box); });
                } else {
                    tickedByHiOnly.forEach(function (box) { box.checked = false; mirror(box); });
                    tickedByHiOnly = [];
                }
                refresh();
            });
            search.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') { event.preventDefault(); }
            });
            refresh();
        })();</script>
    `;
}

/**
 * Browses the pack repository (GET /import/from-url/packs) and, once packs have been fetched, the
 * picker itself. ONLINE mode only (see RepositoryAuth.ts: the URL and the credentials come from
 * MAUI-API, nothing to set here), and Advanced configuration only, same gating as
 * renderMameDangerZoneCard() (see renderForm()): importing an arbitrary pack from the repository
 * is no less consequential than the manual upload form of the MAME tab. No network call to render
 * it, so the tab stays instant: the URL is shown once the packs are loaded.
 */
function renderRepoImportCard(
    mameInfo: MameInfo, packs?: RepoPack[], error?: string, info?: string, url?: string,
): string {
    return `
        <section class="card">
            <h2>Starting pack repository</h2>
            <p class="info">Browses the starting packs of the repository of MAUI-API and imports
            the games you pick.</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            ${url ? `<p class="info">Repository: ${escapeHtml(url)}</p>` : ''}
            ${renderDiskSpaceInfo(mameInfo)}
            ${getMissingConfPackFiles(mameInfo).length
                ? '<p class="info"><em>Install the configuration pack first (MAME > Import / Export tab) to browse the game packs.</em></p>'
                : `<form method="get" action="/import/from-url/packs">
                    <button type="submit">Browse available packs</button>
                </form>
                ${packs ? renderRepoPackPicker(packs) : ''}`}
        </section>
    `;
}

function renderUserStatusBadge(active: boolean): string {
    return active ? '<span class="badge-yes">✓ active</span>' : '<span class="badge-no">✗ inactive</span>';
}

function renderCreateUserCard(error?: string, online: boolean = false): string {
    return `
        <section class="card" id="add-player">
            <h2>Add a player</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <form method="post" action="/users/create">
                <label for="pseudo_3">Nickname, 3 letters (required, unique)</label>
                <input type="text" id="pseudo_3" name="pseudo_3" maxlength="3" required
                       pattern="[A-Za-z]{3}" title="3 letters, A to Z" style="text-transform: uppercase">
                <label for="realname">Name</label>
                <input type="text" id="realname" name="realname">
                <label for="email">Email</label>
                <input type="email" id="email" name="email">
                <label class="checkbox-row">
                    <input type="checkbox" name="active" checked>
                    Active
                </label>
                ${online ? renderCreateOnlineFields() : ''}
                <button type="submit">Create</button>
            </form>
        </section>
    `;
}

interface UsersListExtras {
    isAdvanced: boolean;
    deleted: DeletedUserRow[];
    // ONLINE on: new players go through MAUI-API (OnlinePlayersBo.ts).
    online?: boolean;
    // ONLINE configured, on or not: MAUI-API column and actions, to get the players ready before
    // turning it on (OnlineReconciliation.ts).
    onlineColumn?: boolean;
    // The player just created or given a new PIN: their row is highlighted and scrolled to, with
    // the PIN, if any, in a row of its own under it.
    highlight?: PlayerHighlight;
}

interface PlayerHighlight {
    id_user: number;
    pin?: string;
}

/**
 * Every player in one table: the active/inactive ones first, then - in Advanced configuration only,
 * who alone can restore or purge them - the deleted ones, dimmed, with their restore/purge
 * actions in place of the usual ones. A deleted player is only soft-deleted: the nickname stays
 * reserved and their scores stay in the database (hidden from the hiscore views), so restoring
 * brings all of it back.
 */
/** Whether a player's avatar is another cabinet's to change: linked here, created elsewhere. */
function isAvatarFromOrigin(user: {remote_id?: string | null; is_origin?: boolean}): boolean {
    return (user.remote_id ?? null) !== null && !user.is_origin;
}

function renderUsersListCard(
    users: User[], avatarFilenames: string[], error?: string, info?: string,
    extras: UsersListExtras = {isAdvanced: false, deleted: []},
): string {
    const avatarsPath = new Config().avatarsPath;
    const rows = users.map(user => {
        const avatarFilename = findAvatarFile(avatarFilenames, user.pseudo_3);
        const hasAvatar = avatarFilename !== undefined;
        const disabledUpstream = isDisabledUpstream({online_status: user.online_status ?? null}, !!extras.online);
        // A player created on another cabinet: its picture comes from MAUI-API (PlayerSync.ts) and
        // is only changed there (maui-api D56).
        const avatarFromOrigin = isAvatarFromOrigin(user);
        // Only a picture given to the player can be deleted: the generated default then comes back.
        const hasCustomAvatar = hasAvatar && !avatarFromOrigin && !isDefaultAvatar(avatarsPath, user.pseudo_3);
        // What the status filter goes by: disabled in MAUI-API counts as inactive.
        const status = user.active && !disabledUpstream ? 'active' : 'inactive';
        const highlighted = extras.highlight?.id_user === user.id_user;
        const pin = highlighted ? extras.highlight?.pin : undefined;
        return `
        <tr id="player-${user.id_user}" data-status="${status}" data-visibility="${user.is_public ? 'public' : 'private'}"${highlighted ? ' class="row-highlight"' : ''}>
            <td class="center">
                ${avatarFromOrigin ? `<span title="Changed from the cabinet this player was created on">${hasAvatar
                    ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename as string)}${avatarCacheBust(avatarsPath, avatarFilename as string)}" alt="">`
                    : '<span class="avatar-thumb avatar-placeholder">-</span>'}</span>` : `
                <div class="avatar-edit">
                    ${hasAvatar
                        ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename as string)}${avatarCacheBust(avatarsPath, avatarFilename as string)}" alt="">`
                        : '<span class="avatar-thumb avatar-placeholder">＋</span>'}
                    <div class="avatar-actions">
                        <form method="post" action="/users/${user.id_user}/avatar" enctype="multipart/form-data">
                            <label class="avatar-action" title="Change the avatar (PNG)">
                                <svg ${ICON_SVG_ATTRS}>${EDIT_ICON_PATHS}</svg>
                                <!-- requestSubmit(), not submit(): the latter bypasses the 'submit' event
                                entirely (a DOM quirk), which would skip the AJAX interception below and
                                leave the browser stuck on this POST's own URL (see renderPageTail()). -->
                                <input type="file" name="avatar" accept="image/png" aria-label="Change the avatar (PNG)" onchange="this.form.requestSubmit()">
                            </label>
                        </form>
                        ${hasCustomAvatar ? `<form method="post" action="/users/${user.id_user}/avatar/delete"
                            onsubmit="return confirm('Delete the avatar of ${escapeHtml(user.pseudo_3)}? The default one comes back.')">
                            <button type="submit" class="avatar-action avatar-action-danger" title="Delete the avatar" aria-label="Delete the avatar">
                                <svg ${ICON_SVG_ATTRS}>${TRASH_ICON_PATHS}</svg>
                            </button>
                        </form>` : ''}
                    </div>
                </div>`}
            </td>
            <td>${escapeHtml(user.pseudo_3)}</td>
            <td>${user.realname ? escapeHtml(user.realname) : '<em>-</em>'}</td>
            <td class="center">${disabledUpstream
                ? '<span class="badge-no" title="Disabled by a MAUI-API administrator: only they can enable this player again">✗ disabled in MAUI-API</span>'
                : renderUserStatusBadge(user.active)}</td>
            ${extras.onlineColumn ? `<td class="center">${renderOnlinePlayerStatus(user)}</td>` : ''}
            <td class="center">
                <div class="row-actions">
                    ${extras.onlineColumn ? renderOnlinePlayerActions(user) : ''}
                    ${disabledUpstream ? '' : `<form method="post" action="/users/${user.id_user}/toggle-active">
                        ${user.active
                            ? renderIconButton('Deactivate', PAUSE_ICON_PATHS, 'warn')
                            : renderIconButton('Activate', PLAY_ICON_PATHS, 'ok')}
                    </form>`}
                    <form method="post" action="/users/${user.id_user}/delete"
                        onsubmit="return confirm('Delete ${escapeHtml(user.pseudo_3)}? The nickname stays reserved; the player can be restored later in Advanced configuration.')">
                        ${renderIconButton('Delete player', TRASH_ICON_PATHS)}
                    </form>
                </div>
            </td>
        </tr>
        ${pin ? `<tr class="row-pin" data-status="${status}" data-visibility="${user.is_public ? 'public' : 'private'}">
            <td colspan="${extras.onlineColumn ? 6 : 5}">${renderPinReveal(user.pseudo_3, pin)}</td>
        </tr>` : ''}
    `;
    }).join('');

    const deleted = extras.isAdvanced ? extras.deleted : [];
    const activeCount = users.filter(user => user.active
        && !isDisabledUpstream({online_status: user.online_status ?? null}, !!extras.online)).length;
    // Filters: a player's status (active, inactive, deleted) and, ONLINE, its visibility in the
    // shared leaderboards. Within a kind any ticked value matches; every kind ticked must match.
    const allPlayers = [...users, ...deleted.map(item => item.user)];
    const publicCount = allPlayers.filter(user => user.is_public).length;
    const playerFilters = [
        {key: 'status', value: 'active', label: 'Active', count: activeCount},
        {key: 'status', value: 'inactive', label: 'Inactive', count: users.length - activeCount},
        ...(deleted.length ? [{key: 'status', value: 'deleted', label: 'Deleted', count: deleted.length}] : []),
        ...(extras.onlineColumn ? [
            {key: 'visibility', value: 'public', label: 'Public', count: publicCount},
            {key: 'visibility', value: 'private', label: 'Private', count: allPlayers.length - publicCount},
        ] : []),
    ];
    const deletedRows = deleted.map(({user, scoreCount}) => {
        const avatarFilename = findAvatarFile(avatarFilenames, user.pseudo_3);
        const deletedOn = new Date(user.deletionDate).toLocaleString('en-GB', {
            dateStyle: 'short', timeStyle: 'short',
        });
        return `
        <tr class="row-deleted" data-status="deleted" data-visibility="${user.is_public ? 'public' : 'private'}">
            <td class="center">${avatarFilename !== undefined
                ? `<img class="avatar-thumb" src="/avatars/${encodeURIComponent(avatarFilename)}${avatarCacheBust(avatarsPath, avatarFilename)}" alt="">`
                : '<span class="avatar-thumb avatar-placeholder">-</span>'}</td>
            <td>${escapeHtml(user.pseudo_3)}</td>
            <td>${user.realname ? escapeHtml(user.realname) : '<em>-</em>'}</td>
            <td class="center"><span class="badge-deleted" title="Deleted on ${escapeHtml(deletedOn)}, ${scoreCount} score(s) kept">🗑 deleted ${escapeHtml(deletedOn)} · ${scoreCount} score(s)</span></td>
            ${extras.onlineColumn ? '<td></td>' : ''}
            <td class="center">
                <div class="row-actions">
                    <form method="post" action="/users/${user.id_user}/restore"
                        onsubmit="return confirm('Restore ${escapeHtml(user.pseudo_3)} with ${scoreCount} score(s)? Only do it for the player who owns this nickname.')">
                        ${renderIconButton('Restore player', RESTORE_ICON_PATHS, 'ok')}
                    </form>
                    <form method="post" action="/users/${user.id_user}/purge"
                        onsubmit="return confirm('Permanently delete ${escapeHtml(user.pseudo_3)} and ${scoreCount} score(s) from the database? The nickname becomes free again. This cannot be undone.')">
                        ${renderIconButton('Delete permanently', TRASH_ICON_PATHS)}
                    </form>
                </div>
            </td>
        </tr>`;
    }).join('');

    return `
        <section class="card">
            <div class="card-heading">
                <h2>Players (${users.length}${deleted.length ? ` + ${deleted.length} deleted` : ''})</h2>
                <div class="row-actions">
                    ${extras.online ? `<form method="post" action="/users/online/sync">
                        ${renderIconButton('Sync with MAUI-API now', SYNC_ICON_PATHS, 'accent')}
                    </form>` : ''}
                    ${users.length ? '<a class="button-link" href="#add-player" data-add-player>Add player</a>' : ''}
                </div>
            </div>
            ${users.length ? '' : `<div class="empty-callout">
                <p><strong>No player yet.</strong> Add at least one: the cabinet only keeps the scores
                of its players, matched by their 3-letter nickname.</p>
                <a class="button-link button-link-attention" href="#add-player" data-add-player>Add player</a>
            </div>`}
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            ${info ? `<p class="info flash">${escapeHtml(info)}</p>` : ''}
            ${deleted.length ? `<p class="info">A deleted player's nickname stays reserved: nobody can
            register it, so nobody inherits their scores. Restoring brings the player back with their
            scores and avatar; only restore a player for the person who owns the nickname. Deleting
            permanently removes the player, their scores and their avatar from the database for good,
            and frees the nickname.</p>` : ''}
            ${users.length + deleted.length ? `<div class="table-search">
                <div class="table-search-filters" id="playersFilters">
                    ${playerFilters.map((filter, index) => `
                    ${index && filter.key !== playerFilters[index - 1].key ? '<span class="filter-chip-divider"></span>' : ''}
                    <label class="filter-chip">
                        <input type="checkbox" data-filter="${filter.key}" value="${filter.value}">
                        <span>${filter.label} <span class="filter-chip-count">${filter.count}</span></span>
                    </label>`).join('')}
                    <span class="table-search-summary" id="playersFilterCount" aria-live="polite"></span>
                </div>
            </div>` : ''}
            ${users.length + deleted.length ? `<div class="table-wrap">
                <table class="favorites-table" id="playersTable">
                    <thead>
                        <tr>
                            <th class="center">Avatar</th>
                            <th>Nickname</th>
                            <th>Name</th>
                            <th class="center">Status</th>
                            ${extras.onlineColumn ? '<th class="center">MAUI-API</th>' : ''}
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows + deletedRows}</tbody>
                </table>
            </div>` : ''}
            <script>(function () {
                // "Add player": down to the form at the end of the page, its nickname ready to type.
                document.querySelectorAll('[data-add-player]').forEach(function (link) {
                    link.addEventListener('click', function () {
                        setTimeout(function () { document.getElementById('pseudo_3').focus({preventScroll: true}); }, 0);
                    });
                });
            })();</script>
            <script>(function () {
                // Filters: rows are only hidden (their data-status, data-visibility), so their
                // buttons keep working. Every action re-renders the whole page: the choice is kept
                // for the browser session, or deactivating a player would drop back to them all.
                var filters = document.getElementById('playersFilters');
                if (!filters) { return; }
                var boxes = Array.prototype.slice.call(filters.querySelectorAll('input[data-filter]'));
                var count = document.getElementById('playersFilterCount');
                var rows = Array.prototype.slice.call(document.querySelectorAll('#playersTable tbody tr'));
                var FILTERS_KEY = 'bo.players.filters';
                function key(box) { return box.dataset.filter + ':' + box.value; }
                try {
                    var stored = JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '[]');
                    boxes.forEach(function (box) { box.checked = stored.indexOf(key(box)) >= 0; });
                } catch (error) { /* storage blocked: all the players are shown */ }
                function shows(row) {
                    var ticked = {};
                    boxes.forEach(function (box) {
                        if (box.checked) { (ticked[box.dataset.filter] = ticked[box.dataset.filter] || []).push(box.value); }
                    });
                    return Object.keys(ticked).every(function (kind) {
                        return ticked[kind].indexOf(row.dataset[kind]) >= 0;
                    });
                }
                // The player just created or given a PIN is always shown: filters that hide them
                // are cleared.
                var highlighted = document.querySelector('#playersTable tr.row-highlight');
                if (highlighted && !shows(highlighted)) {
                    boxes.forEach(function (box) { box.checked = false; });
                }
                function render() {
                    var shown = 0;
                    rows.forEach(function (row) {
                        row.hidden = !shows(row);
                        if (!row.hidden && !row.classList.contains('row-pin')) { shown++; }
                    });
                    var players = rows.filter(function (row) { return !row.classList.contains('row-pin'); }).length;
                    var filtering = boxes.some(function (box) { return box.checked; });
                    count.textContent = !filtering ? '' : shown ? shown + ' of ' + players + ' players' : 'No player matches';
                }
                boxes.forEach(function (box) {
                    box.addEventListener('change', function () {
                        try {
                            sessionStorage.setItem(FILTERS_KEY, JSON.stringify(boxes.filter(function (other) {
                                return other.checked;
                            }).map(key)));
                        } catch (error) { /* blocked */ }
                        render();
                    });
                });
                render();
            })();
            (function () {
                // After the page's own scroll restore (renderPageTail(), and the AJAX submit's
                // scrollTo() once the document is written), hence the timeout.
                var highlighted = document.querySelector('#playersTable tr.row-highlight');
                if (!highlighted) { return; }
                setTimeout(function () {
                    var pinRow = highlighted.nextElementSibling;
                    var target = pinRow && pinRow.classList.contains('row-pin') ? pinRow : highlighted;
                    target.scrollIntoView({block: 'center', behavior: 'smooth'});
                }, 0);
            })();</script>
        </section>
    `;
}

/**
 * hiscore.dat the hiscore plugin reads (<pluginspath>/hiscore/hiscore.dat): it gives the size each
 * rom's .hi file should have, so the Hiscores page can flag a file written for another layout.
 */
function getHiscoreDatPath(mameHome: string): string | null {
    const pluginsPath = getMameIniValue(join(mameHome, 'mame.ini'), 'pluginspath');
    if (!pluginsPath) {
        return null;
    }
    const path = join(resolveDirectoryPath(pluginsPath, mameHome), 'hiscore', 'hiscore.dat');
    return existsSync(path) ? path : null;
}

/** Scores stored in the database, by id_game, keyed the way inspectHiscores() matches them. */
async function getStoredScores(idGame?: number): Promise<Map<number, StoredScore[]>> {
    const hiscores = await Hiscore.findAll({
        ...(idGame !== undefined ? {where: {id_game: idGame}} : {}),
        include: [{model: User, attributes: ['pseudo_3']}],
    });
    const byGame = new Map<number, StoredScore[]>();
    for (const hiscore of hiscores) {
        if (!hiscore.user) {
            continue;
        }
        const scores = byGame.get(hiscore.id_game) || [];
        scores.push({pseudo3: hiscore.user.pseudo_3, rank: hiscore.rank, score: hiscore.score});
        byGame.set(hiscore.id_game, scores);
    }
    return byGame;
}

function formatDateTime(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 16);
}

const HISCORE_ROW_STATUS: Record<HiscoreRowStatus, (pseudo3: string) => string> = {
    saved: () => '<span class="badge-yes">✓ saved</span>',
    pending: pseudo3 => `<span class="badge-warn" title="Player ${escapeHtml(pseudo3)} exists: MAUI stores this score the next time it reads the file (at start-up, or when a game ends)">… not saved yet</span>`,
    ignored: pseudo3 => `<span class="badge-deleted" title="Scores are attributed to the player whose nickname is the first 3 letters of the name">no player ${escapeHtml(pseudo3)}</span>`,
    extra: () => '<span class="badge-deleted" title="MAUI only stores the main table">not stored</span>',
};

function renderHiscoreFileState(report: HiscoreReport): string {
    switch (report.state) {
        case 'no-file':
            return '<span class="badge-deleted">not played yet</span>';
        case 'error':
            return `<span class="badge-no" title="${escapeHtml(report.error || '')}">✗ unreadable</span>`;
        case 'unsupported':
            return '<span class="badge-deleted">no extractor</span>';
        default: {
            const latest = report.files.reduce((a, b) => (a.modified > b.modified ? a : b));
            const sizeIssue = report.files.some(f => f.expectedSize !== null && f.expectedSize !== f.size);
            return `<span class="badge-yes">✓</span> ${escapeHtml(formatDateTime(latest.modified))}`
            + (sizeIssue ? ' <span class="badge-no" title="The .hi file size does not match hiscore.dat">⚠ size</span>' : '');
        }
    }
}

interface HiscoreListEntry {
    game: Game;
    report: HiscoreReport;
}

/**
 * Every game with extractable hiscores: whether mame wrote its file yet, and what MAUI makes of
 * it (rows decoded by mhiex, rows attributed to a player, rows stored in the database).
 */
function renderHiscoresListPage(entries: HiscoreListEntry[], viewer: Viewer, mameHome: string, error?: string): string {
    const played = entries.filter(e => e.report.state !== 'no-file');
    const rows = entries.map(({game, report}) => {
        const main = report.tables[0]?.rows || [];
        const known = main.filter(r => r.status !== 'ignored').length;
        const saved = main.filter(r => r.status === 'saved').length;
        const pending = main.filter(r => r.status === 'pending').length;
        const hasData = report.state === 'ok';
        return `
        <tr>
            <td>${renderGameName(game.fullname || game.romName)}</td>
            <td><code>${escapeHtml(game.romName)}</code></td>
            <td>${escapeHtml(describeSources(report.sources))}</td>
            <td>${renderHiscoreFileState(report)}</td>
            <td class="center">${hasData ? main.length : ''}</td>
            <td class="center">${hasData ? known : ''}</td>
            <td class="center">${hasData ? `${saved}${pending ? ` <span class="badge-warn" title="Not saved yet">+${pending}</span>` : ''}` : ''}</td>
            <td class="center">${report.state === 'no-file' ? '' : `<a href="/hiscores/${encodeURIComponent(game.romName)}">Details</a>`}</td>
        </tr>`;
    }).join('');
    return renderPage(`
        <section class="card">
            <h2>Hiscores (${played.length} played / ${entries.length} games)</h2>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <p class="info">Games whose hiscores MAUI can read. Mame writes the scores to
            <code>${escapeHtml(join(mameHome, 'hiscore'))}</code> (or to the game's nvram), mhiex decodes them, and
            MAUI stores each row whose name starts with a player's nickname.</p>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead>
                        <tr>
                            <th>Game</th>
                            <th>Rom</th>
                            <th title="What mhiex reads the scores from">Source</th>
                            <th>File</th>
                            <th class="center" title="Rows of the main table decoded by mhiex">Rows</th>
                            <th class="center" title="Rows whose name matches a player">Players</th>
                            <th class="center" title="Rows stored in the database">Saved</th>
                            <th class="center"></th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="8"><em>No game with extractable hiscores</em></td></tr>'}</tbody>
                </table>
            </div>
        </section>
    `, 'hiscores', viewer);
}

/** One game: its files (with a hex dump), then every table mhiex decodes, row by row. */
function renderHiscoreDetailPage(game: Game | null, report: HiscoreReport, viewer: Viewer): string {
    const title = game ? (game.fullname || game.romName) : report.romName;
    const files = report.files.map(file => {
        const {lines, truncated} = hexDump(readFileSync(file.path));
        const sizeNote = file.expectedSize === null ? ''
            : file.expectedSize === file.size ? ' <span class="badge-yes">✓ matches hiscore.dat</span>'
                : ` <span class="badge-no">⚠ hiscore.dat expects ${file.expectedSize} bytes</span>`;
        return `
            <h3><code>${escapeHtml(file.name)}</code></h3>
            <p>${file.size} bytes${sizeNote} · modified ${escapeHtml(formatDateTime(file.modified))}</p>
            <pre class="hex-dump">${escapeHtml(lines.join('\n'))}${truncated ? '\n…' : ''}</pre>
        `;
    }).join('');
    const tables = report.tables.map(table => `
        <h3>${table.id === null ? 'Main table' : `Extra table: ${escapeHtml(table.id)}`}</h3>
        <div class="table-wrap">
            <table class="favorites-table">
                <thead><tr><th class="center">Rank</th><th>Score</th><th>Name</th><th>MAUI</th></tr></thead>
                <tbody>${table.rows.map(row => `
                    <tr>
                        <td class="center">${row.rank}</td>
                        <td>${escapeHtml(String(row.score))}</td>
                        <td><code>${escapeHtml(JSON.stringify(row.name))}</code></td>
                        <td>${HISCORE_ROW_STATUS[row.status](row.pseudo3)}</td>
                    </tr>`).join('') || '<tr><td colspan="4"><em>Empty</em></td></tr>'}
                </tbody>
            </table>
        </div>
    `).join('');
    let decoded: string;
    if (report.state === 'error') {
        decoded = `<p class="error flash">mhiex could not decode the file: ${escapeHtml(report.error || '')}</p>`;
    } else if (report.state === 'no-file') {
        decoded = '<p class="info">Mame has not written this game\'s hiscores yet: play it once.</p>';
    } else if (report.state === 'unsupported') {
        decoded = '<p class="info">mhiex has no extractor for this rom.</p>';
    } else {
        decoded = tables;
    }
    return renderPage(`
        <p><a href="/hiscores">← All hiscores</a></p>
        <section class="card">
            <h2>${escapeHtml(title)} <code>${escapeHtml(report.romName)}</code></h2>
            ${report.sources ? `<p>Read from: ${[
                report.sources.hi ? `<code>hiscore/${escapeHtml(report.romName)}.hi</code>${report.sources.hi === 'optional' ? ' (when it exists)' : ''}` : '',
                report.sources.nvram ? `<code>${escapeHtml(report.sources.nvram)}</code>` : '',
            ].filter(Boolean).join(' + ')}</p>` : ''}
            ${decoded}
        </section>
        <section class="card">
            <h2>Files</h2>
            ${files || '<p><em>No file</em></p>'}
        </section>
    `, 'hiscores', viewer);
}

function renderUsersPage(
    users: User[], avatarFilenames: string[], error?: string, info?: string, createError?: string,
    extras: UsersListExtras = {isAdvanced: false, deleted: []},
): string {
    // One page, no subtabs: every player (deleted ones included, see renderUsersListCard()) in a
    // single list, then the add form (#add-player, the list's "Add player" button).
    return renderPage(
        renderUsersListCard(users, avatarFilenames, error, info, extras) + renderCreateUserCard(createError, extras.online),
        'users',
        extras.isAdvanced ? 'advanced' : 'basic',
    );
}

/** The local columns of an API player (see PlayerSync.ts). */
function onlineUserFields(player: OnlinePlayer): Pick<User, 'remote_id' | 'is_public' | 'online_status'> {
    return {remote_id: player.id, is_public: player.isPublic, online_status: player.status};
}

/**
 * Friendly message for the common User.create() failure modes (unique pseudo_3,
 * length validators) instead of a raw Sequelize error dump.
 */
function describeUserError(error: unknown): string {
    if (error instanceof UniqueConstraintError) {
        return 'A player with this nickname already exists.';
    }
    if (error instanceof ValidationError) {
        return error.errors.map(e => e.message).join(' ');
    }
    return error instanceof Error ? error.message : 'Unexpected error.';
}

/**
 * `carried`: both Config fields as they were in the form when Browse was clicked, carried along
 * every link here so that choosing (or cancelling) one of them brings the page back with the other
 * one still filled in - it may not be saved yet (e.g. a first setup: binary folder picked, then the
 * plugins folder).
 */
function renderBrowsePage(
    target: PathField, currentDir: string, carried: Record<PathField, string>, viewer: Viewer,
    // Where the chosen folder is brought back: the MAME tab, or the setup guide.
    returnTo: '/' | '/setup' = '/',
): string {
    let entries: string[] = [];
    let error: string|undefined;
    try {
        entries = readdirSync(currentDir, {withFileTypes: true})
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        error = `Unable to read the folder "${currentDir}".`;
    }

    const parentDir = dirname(currentDir);
    const canGoUp = parentDir !== currentDir;
    // Empty fields are left out rather than carried as empty params: the page this returns to
    // treats a present-but-empty query param differently from an absent one (falls back to the
    // saved config/mame.ini value only when the param is absent).
    const query = (values: Record<PathField, string>) => (Object.keys(values) as PathField[])
        .filter(field => values[field])
        .map(field => `${field}=${encodeURIComponent(values[field])}`)
        .join('&');
    const carryQuery = query(carried);
    const fromQuery = returnTo === '/setup' ? '&from=setup' : '';
    const navLink = (dir: string) => `/browse?target=${target}&path=${encodeURIComponent(dir)}${carryQuery ? `&${carryQuery}` : ''}${fromQuery}`;
    const selectLink = (dir: string) => `${returnTo}?${query({...carried, [target]: dir})}`;

    const rows = entries.map(name => {
        const fullPath = join(currentDir, name);
        return `<li><a href="${navLink(fullPath)}">📁 ${escapeHtml(name)}</a></li>`;
    }).join('');

    return renderPage(`
        <section class="card">
            <h2>Choose a folder</h2>
            <p class="current-path">${escapeHtml(currentDir)}</p>
            ${error ? `<p class="error flash">${escapeHtml(error)}</p>` : ''}
            <p>
                <a class="button-link" href="${selectLink(currentDir)}">Choose this folder</a>
                ${canGoUp ? ` &nbsp; <a href="${navLink(parentDir)}">⬆ Parent folder</a>` : ''}
            </p>
            <ul class="browse-list">${rows || '<li><em>No subfolder</em></li>'}</ul>
            <p><a href="${returnTo}?${carryQuery}">Cancel</a></p>
        </section>
    `, 'mame', viewer);
}

/**
 * Guard of the /maui/online/* routes, which decide where the ONLINE token is sent: Advanced
 * configuration only, and same-origin only since the BO has no CSRF token (see SameOrigin.ts and
 * docs/DECISIONS.md). Sends the 403 itself; true means the caller must stop.
 */
function refuseOnlineRequest(req: Request, res: Response): boolean {
    if (!req.session.boAdvanced) {
        res.status(403).send('Available in Advanced configuration only.');
        return true;
    }
    if (!isSameOriginRequest({origin: req.get('origin'), referer: req.get('referer'), host: req.get('host')})) {
        res.status(403).send('Cross-site request refused.');
        return true;
    }
    return false;
}

/**
 * Guard of the /maui/network/* and /maui/bluetooth/* routes, which act on the cabinet's system
 * (and can cut it off its network): a dedicated cabinet only, and same-origin only (see refuseOnlineRequest()). Sends the 403 itself; true means
 * the caller must stop.
 */
function refuseCabinetSystemRequest(req: Request, res: Response): boolean {
    if (!isNetworkControlHost()) {
        res.status(403).send('Network settings unavailable on this machine.');
        return true;
    }
    if (!isSameOriginRequest({origin: req.get('origin'), referer: req.get('referer'), host: req.get('host')})) {
        res.status(403).send('Cross-site request refused.');
        return true;
    }
    return false;
}

/**
 * Builds the BO: called by boCore.ts when the first request reaches its port, on top of what the
 * main process already runs (`core`). `databaseReady` resolves once the database exists and is
 * migrated (see boCore.ts's bootstrapDatabase()); requests arriving before wait for it.
 */
export function createBoApp(
    core: BoCore, databaseReady: Promise<void>, reloadFront: () => void, onReset: () => void,
    showGameOnFront: FrontGameShower,
    frontControls: FrontControls,
    favoritesChanged: FrontFavoritesNotifier,
): BoApp {
    const {online, scoreStore} = core;
    onlineSession = online;
    mameSessionChanged = running => frontControls.mameSessionChanged(running);
    const app = express();
    app.use(express.urlencoded({extended: false}));
    // A fresh secret per server start (rather than a persisted one) invalidates every session on
    // restart - acceptable here since the BO already forces a full page reload/restart after any
    // action (/reset, /maui/import) that would matter, and avoids storing a secret on disk.
    app.use(session({
        secret: randomBytes(32).toString('hex'),
        resave: false,
        saveUninitialized: false,
        cookie: {maxAge: 7 * 24 * 60 * 60 * 1000},
    }));
    // The BO is reachable from the whole LAN (boCore.ts listens on every address), so every route
    // below this guard requires a logged-in session except the login page itself and the static
    // assets it needs (background/logo) to render.
    const PUBLIC_PATHS = new Set(['/login', '/background.jpg', '/mame-logo.svg', '/maui-logo.png']);
    app.use(async (req, res, next) => {
        if (PUBLIC_PATHS.has(req.path) || req.session.boUserId || await signInWithoutPassword(req)) {
            next();
            return;
        }
        res.redirect('/login');
    });
    const DEFAULT_PASSWORD_PATHS = new Set(['/account', '/account/password', '/logout']);
    app.use((req, res, next) => {
        if (!req.session.mustChangePassword || PUBLIC_PATHS.has(req.path) || DEFAULT_PASSWORD_PATHS.has(req.path)) {
            next();
            return;
        }
        res.redirect('/account');
    });
    // MAUI configuration import (/maui/import), read from req.file.buffer: memory storage (disk
    // storage has no buffer). An export is the config file and the SQLite database, a few MiB.
    const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 100 * 1024 * 1024}});
    const avatarUpload = multer({storage: multer.memoryStorage(), limits: {fileSize: 5 * 1024 * 1024}});
    const starredUpload = multer({storage: multer.memoryStorage(), limits: {fileSize: MAX_STARRED_FILE_BYTES, files: 1}});
    // Every route below reads the database sooner or later (the login page first): hold requests
    // until it exists, instead of failing on a missing table for the first second of a first launch.
    app.use((req, res, next) => {
        databaseReady.then(() => next());
    });

    app.get('/background.jpg', (req, res) => {
        res.sendFile('img/background.jpg', {root: getStaticPath()});
    });

    app.get('/category-icons/:key.svg', (req, res) => {
        const svg = CATEGORY_ICONS[req.params.key];
        if (!svg) {
            res.sendStatus(404);
            return;
        }
        res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    });

    app.get('/input-icons/:key.svg', (req, res) => {
        const svg = INPUT_ICONS[req.params.key];
        if (!svg) {
            res.sendStatus(404);
            return;
        }
        res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    });

    app.get('/maui-logo.png', (req, res) => {
        res.sendFile('img/maui-logo.png', {root: getStaticPath()});
    });

    app.get('/mame-logo.svg', (req, res) => {
        res.sendFile('img/mame-logo.svg', {root: getStaticPath()});
    });

    app.get('/login', (req, res) => {
        res.send(renderLoginPage());
    });

    app.post('/login', async (req, res) => {
        const password: string = req.body.password || '';
        let boUser: BoUser | null;
        try {
            boUser = await BoUser.findOne({where: {username: BO_USERNAME}});
        } catch {
            // The database bootstrap failed (see bootstrapDatabase(), logged at startup).
            res.status(503).send(renderLoginPage(
                'The database could not be initialized - restart the application, then retry.',
            ));
            return;
        }
        if (!boUser || !bcrypt.compareSync(password, boUser.passwordHash)) {
            res.status(401).send(renderLoginPage('Incorrect password.'));
            return;
        }
        if (bcrypt.getRounds(boUser.passwordHash) < BO_PASSWORD_BCRYPT_ROUNDS) {
            boUser.passwordHash = bcrypt.hashSync(password, BO_PASSWORD_BCRYPT_ROUNDS);
            await boUser.save();
        }
        req.session.boUserId = boUser.id;
        req.session.boUsername = boUser.username;
        req.session.boAdvanced = false;
        if (password === DEFAULT_BO_PASSWORD) {
            // Never unlock (hence never encrypt) the credentials with a public password.
            req.session.mustChangePassword = true;
            res.redirect('/account');
            return;
        }
        await unlockSecrets(req, boUser, password);
        res.redirect('/');
    });

    // Flips Advanced configuration for this session and goes back to the page it was toggled from
    // (an advanced-only page such as /screenscraper then redirects basic viewers to / by itself).
    app.post('/advanced', (req, res) => {
        req.session.boAdvanced = !req.session.boAdvanced;
        let back = '/';
        try {
            const referer = new URL(req.get('referer') || '', `http://${req.get('host')}`);
            // Same-origin paths only - never an open redirect.
            if (referer.host === req.get('host') && !referer.pathname.startsWith('//')) {
                back = referer.pathname + referer.search;
            }
        } catch {
            // Missing/malformed Referer: back to /.
        }
        res.redirect(back);
    });

    app.post('/logout', (req, res) => {
        req.session.destroy(() => res.redirect('/login'));
    });

    app.get('/account', async (req, res) => {
        const boUser = await BoUser.findByPk(req.session.boUserId);
        if (!boUser) {
            req.session.destroy(() => res.redirect('/login'));
            return;
        }
        res.send(renderAccountPage(getViewer(req), req.session.mustChangePassword === true));
    });

    app.post('/account/password', async (req, res) => {
        const boUser = await BoUser.findByPk(req.session.boUserId);
        if (!boUser) {
            req.session.destroy(() => res.redirect('/login'));
            return;
        }
        const currentPassword: string = req.body.currentPassword || '';
        const newPassword: string = req.body.newPassword || '';
        const confirmPassword: string = req.body.confirmPassword || '';
        const mustChange = req.session.mustChangePassword === true;
        const sendError = (status: number, error: string) => {
            res.status(status).send(renderAccountPage(getViewer(req), mustChange, error));
        };

        if (!bcrypt.compareSync(currentPassword, boUser.passwordHash)) {
            sendError(401, 'Incorrect current password.');
            return;
        }
        if (newPassword.length < MIN_BO_PASSWORD_LENGTH) {
            sendError(422, `The new password must be at least ${MIN_BO_PASSWORD_LENGTH} characters long.`);
            return;
        }
        if (newPassword === DEFAULT_BO_PASSWORD) {
            sendError(422, 'Choose a password other than the default one.');
            return;
        }
        if (newPassword !== confirmPassword) {
            sendError(422, 'The confirmation does not match the new password.');
            return;
        }

        // Same data key, re-wrapped with the new password: the config file stays as it is. Not
        // unlocked yet when signed in with the default password - unlocked here instead.
        const dataKey = getSecretsKey(req)
            ?? (boUser.secretsKey ? unwrapDataKey(currentPassword, boUser.secretsKey) : null)
            ?? generateDataKey();
        boUser.passwordHash = bcrypt.hashSync(newPassword, BO_PASSWORD_BCRYPT_ROUNDS);
        boUser.secretsKey = wrapDataKey(newPassword, dataKey);
        await boUser.save();
        req.session.mustChangePassword = false;
        await unlockSecrets(req, boUser, newPassword);
        // A new cabinet goes on with its setup.
        if (!readSetup().progress.finished) {
            res.redirect(303, '/setup');
            return;
        }
        res.send(renderAccountPage(getViewer(req), false, undefined, 'Password updated.'));
    });

    app.get('/', (req, res) => {
        // A new cabinet lands on its setup guide until it is done. Not when /browse brings a folder
        // back to the MAME tab (a query).
        if (!Object.keys(req.query).length && !readSetup().progress.finished) {
            res.redirect('/setup');
            return;
        }
        const config = new Config();
        config.load();
        const mamePath = typeof req.query.mamePath === 'string' ? req.query.mamePath : (config.mamePath || '');
        const mameInfo = getMameInfo(config);
        // Only set after browsing for the plugins folder (Config card) - not persisted until that
        // form is saved, same as mamePath above.
        if (typeof req.query.pluginsPath === 'string') {
            mameInfo.pluginsPath = req.query.pluginsPath;
        }
        res.send(renderForm(
            {mamePath}, mameInfo, req.session.boAdvanced === true,
        ));
    });

    // MAME tab > Import: the light export of ~/.mame (renderMameExportCard()).
    app.get('/mame/export', (req, res) => {
        const parts = parseMameBackupParts(MAME_BACKUP_PARTS.map(part => part.id).filter(id => req.query[id] === 'on'));
        const iniPath = getMameHomePath();
        const directory = (file: string, key: string, fallback: string) => resolveDirectoryPath(
            getMameIniValue(join(iniPath, file), key) ?? fallback, iniPath,
        );
        const zip = parts.length ? buildMameBackup(iniPath, listMameBackupPaths(iniPath, parts, {
            cfg: directory('mame.ini', 'cfg_directory', 'cfg'),
            ctrlr: directory('mame.ini', 'ctrlrpath', 'ctrlr'),
            nvram: directory('mame.ini', 'nvram_directory', 'nvram'),
            ui: directory('ui.ini', 'ui_path', 'ui'),
            categories: directory('ui.ini', 'categorypath', 'folders'),
            hiscore: getHiscorePath(iniPath),
        })) : null;
        if (!zip) {
            const config = new Config();
            config.load();
            const mameInfo = getMameInfo(config);
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, req.session.boAdvanced === true,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                parts.length ? 'Nothing to export: none of these files exists yet.' : 'Tick at least one box before exporting.',
            ));
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="mame-config-${date}.zip"`);
        res.send(zip);
    });

    // The setup guide (Lot VI.2, SetupBoPage.ts): the steps of a new cabinet's setup, the current
    // one's form on the page. Each action comes back here, which moves on to the next step.
    const sendSetupPage = (
        req: Request, res: Response,
        message?: {step: SetupStepId; error?: string; info?: string},
        typed: {mamePath?: string; pluginsPath?: string} = {},
    ) => {
        const config = new Config();
        config.load();
        const {facts, progress} = readSetup(req.session.mustChangePassword !== true);
        const iniPath = getMameHomePath();
        const pluginsPath = getMameIniValue(join(iniPath, 'mame.ini'), 'pluginspath');
        const queryValue = (name: string) => typeof req.query[name] === 'string' ? req.query[name] as string : undefined;
        res.status(message?.error ? 422 : 200).send(renderPage(renderSetupPage({
            progress, facts, message,
            mamePath: typed.mamePath ?? queryValue('mamePath') ?? config.mamePath ?? '',
            pluginsPath: typed.pluginsPath ?? queryValue('pluginsPath')
                ?? (pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : ''),
        }), 'setup', getViewer(req)));
    };

    app.get('/setup', (req, res) => sendSetupPage(req, res));

    app.post('/setup/mame', (req, res) => {
        const mamePath: string = (req.body.mamePath || '').trim();
        let pluginsPath: string = (req.body.pluginsPath || '').trim();
        // Left empty: the plugins folder mame ships next to its binary, when there is one.
        if (!pluginsPath && mamePath && existsSync(join(mamePath, 'plugins'))) {
            pluginsPath = join(mamePath, 'plugins');
        }
        const config = new Config();
        config.load();
        // A first setup launches MAME fullscreen; set up again, it keeps what mame.ini says.
        const windowed = getMameIniValue(join(getMameHomePath(), 'mame.ini'), 'window') === '1';
        const applied = applyMameConfig(config, mamePath, pluginsPath, windowed);
        if ('error' in applied) {
            sendSetupPage(req, res, {step: 'mame', error: applied.error}, {mamePath, pluginsPath});
            return;
        }
        // Init.vue then finds the configuration and goes on to the list of games.
        reloadFront();
        res.redirect(303, '/setup');
    });

    app.post('/setup/plugins', (req, res) => {
        const typedPath: string = (req.body.pluginsPath || '').trim();
        const iniPath = getMameHomePath();
        if (typedPath) {
            if (!existsSync(typedPath)) {
                sendSetupPage(req, res, {step: 'plugins', error: `The folder "${typedPath}" does not exist.`}, {pluginsPath: typedPath});
                return;
            }
            if (!savePluginsPath(typedPath).saved) {
                sendSetupPage(req, res, {step: 'plugins', error: 'mame.ini not found: save the MAME step first.'}, {pluginsPath: typedPath});
                return;
            }
        }
        const pluginsPath = getMameIniValue(join(iniPath, 'mame.ini'), 'pluginspath');
        const available = getAvailablePlugins(pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : null);
        if (!available.length) {
            sendSetupPage(req, res, {
                step: 'plugins', error: `No plugin found in "${typedPath || pluginsPath || ''}".`,
            }, {pluginsPath: typedPath});
            return;
        }
        const pluginIniPath = join(iniPath, 'plugin.ini');
        repairPluginIni(pluginIniPath, available);
        enableRequiredPlugins(pluginIniPath);
        res.redirect(303, '/setup');
    });

    // Not Advanced configuration only, unlike the MAUI > Online card: a new cabinet's owner is
    // guided here. Same-origin all the same (see refuseOnlineRequest()).
    app.post('/setup/online', async (req, res) => {
        if (!isSameOriginRequest({origin: req.get('origin'), referer: req.get('referer'), host: req.get('host')})) {
            res.status(403).send('Cross-site request refused.');
            return;
        }
        const input = typeof req.body.configuration === 'string' ? req.body.configuration : '';
        const outcome = saveConfigurationString(input);
        if (!outcome.ok) {
            sendSetupPage(req, res, {step: 'online', error: outcome.error});
            return;
        }
        // Checked before ONLINE is turned on: a wrong string or an unreachable MAUI-API is told here.
        const test = await testConnection();
        if (test.level !== 'info') {
            await online.restart();
            sendSetupPage(req, res, {step: 'online', error: `Configuration saved, but: ${test.message}`});
            return;
        }
        const blocking = playersBlockingOnline(await User.findAll());
        const enabled = blocking ? {level: 'error' as const, message: blocking} : setOnlineEnabled(true);
        await online.restart();
        if (enabled.level !== 'info') {
            sendSetupPage(req, res, {step: 'online', error: enabled.message});
            return;
        }
        res.redirect(303, '/setup');
    });

    // The end of the guide: the repository's packs, in Games > Repository. A link, not a form:
    // the BO's form script follows a redirect without its #repository, which picks the subtab.
    app.get('/setup/more-games', (req, res) => {
        res.redirect('/favorites#repository');
    });

    app.post('/setup/offline', (req, res) => {
        const config = new Config();
        config.load();
        config.setupOffline = req.body.offline === 'on';
        config.save();
        res.redirect(303, '/setup');
    });

    // The whole ScreenScraper tab is Advanced configuration only (its link is left out of the basic nav, see
    // renderPageHead()): the credentials it holds, and the media download it runs.
    app.get('/screenscraper', (req, res) => {
        if (!req.session.boAdvanced) {
            res.redirect('/');
            return;
        }
        const config = new Config();
        config.load();
        res.send(renderScreenScraperPage({
            ssDevId: config.ssDevId,
            ssDevPassword: config.ssDevPassword,
            ssSoftName: config.ssSoftName,
            ssUserId: config.ssUserId,
            ssUserPassword: config.ssUserPassword,
            bezelAspect: config.bezelAspect,
        }, hasScreenScraperCredentials(config)));
    });

    /**
     * Cache-backed favorites tab (see the comment inside), shared by GET /favorites and the
     * re-renders after POST /favorites/delete, /favorites/restore and /votes/set, `flash` being
     * that action's message.
     */
    const renderFavoritesTab = async (
        req: Request, flash: FavoritesFlash = {}, repository: Omit<RepoSection, 'mameInfo'> = {},
    ): Promise<string> => {
        const config = new Config();
        config.load();
        const context = getFavoritesContext(config);
        // Repository subtab: ONLINE mode only, like the routes below it (the repository's address
        // and credentials come from MAUI-API). With ONLINE off there is no subtab at all, the
        // Games tab is the favorites alone.
        const repositorySection = isOnlineActive()
            ? {mameInfo: getMameInfo(config), ...repository}
            : undefined;

        if ('error' in context) {
            return renderFavoritesPage({rows: [], error: context.error, ...flash}, getViewer(req), repositorySection);
        }

        // Reads names/BIOS from the favorites cache instead of resolving them live (each favorite
        // otherwise costs a `mame -lx` process spawn), so this tab loads at once whatever the
        // number of favorites; updateFavoritesCache() resolves those it lacks.
        const cache = await updateFavoritesCache(context);
        const rows = context.romNames.map(romName => favoriteRowFromCache(context, romName, cache));
        return renderFavoritesPage(
            {rows, resolving: favoritesResolution, stats: await loadGameStats() ?? undefined, ...flash},
            getViewer(req),
            repositorySection,
        );
    };

    // The favorites' names being resolved in the background, polled by the Games tab: {} once done.
    app.get('/favorites/resolution', (req, res) => {
        res.set('Cache-Control', 'no-store').json(favoritesResolution ?? {});
    });

    app.get('/favorites', async (req, res) => {
        // Where a repository import sends the page once it is through (POST /import/from-url).
        const imported = typeof req.query.imported === 'string' && /^\d{1,5}$/.test(req.query.imported)
            ? Number(req.query.imported) : 0;
        res.send(await renderFavoritesTab(req, imported
            ? {notice: `Import finished: ${imported} game${imported > 1 ? 's' : ''} asked for.`}
            : {}));
    });

    // Puts the cabinet's front on a favorite: its category, then the game (Home.vue).
    app.post('/favorites/show', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        if (!/^[a-z0-9]+$/.test(romName)) {
            res.status(422).send(await renderFavoritesTab(req, {warning: 'Invalid rom name.'}));
            return;
        }
        if (!showGameOnFront(romName)) {
            res.status(409).send(await renderFavoritesTab(req, {warning: 'The cabinet\'s screen is not open.'}));
            return;
        }
        res.send(await renderFavoritesTab(req, {
            notice: `The cabinet now shows "${romName}" (unless a game is being played, or the game is not in its list).`,
        }));
    });

    app.post('/favorites/delete', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        // Same character set as parseFavorites()/getFavoriteRomNames(): anything else can't be
        // a favorite this tab lists.
        if (!/^[a-z0-9]+$/.test(romName)) {
            res.status(422).send(await renderFavoritesTab(req, {warning: 'Invalid rom name.'}));
            return;
        }
        if (isMameConfigSessionAlive()) {
            res.status(409).send(await renderFavoritesTab(req, {
                warning: 'MAME is open (Controls tab): close it first, it would rewrite favorites.ini.',
            }));
            return;
        }

        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (!favoritesPath) {
            res.status(404).send(await renderFavoritesTab(req, {warning: 'No favorites.ini file found.'}));
            return;
        }

        if (removeFavoriteFromDisk(favoritesPath, romName) === null) {
            res.status(422).send(await renderFavoritesTab(req, {
                warning: `Unable to remove "${romName}": entry not found or unexpected favorites.ini format.`,
            }));
            return;
        }

        favoritesChanged();
        res.send(await renderFavoritesTab(req, {
            notice: `"${romName}" removed from the list and from the cabinet (it can be restored from "Removed from the list" below).`,
        }));
    });

    app.post('/favorites/restore', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        const removed = readRemovedFavorites();
        const item = removed.find(candidate => candidate.romName === romName);
        if (!item) {
            res.status(404).send(await renderFavoritesTab(req, {warning: `"${romName}" is not in "Removed from the list".`}));
            return;
        }
        if (isMameConfigSessionAlive()) {
            res.status(409).send(await renderFavoritesTab(req, {
                warning: 'MAME is open (Controls tab): close it first, it would rewrite favorites.ini.',
            }));
            return;
        }

        const {favoritesPath} = getMameLocations(getMameHomePath());
        if (!favoritesPath) {
            res.status(404).send(await renderFavoritesTab(req, {warning: 'No favorites.ini file found.'}));
            return;
        }

        const updated = addFavorite(readFileSync(favoritesPath, 'utf8'), item.entry);
        // null = already listed (put back by mame's own menu in the meantime) or a corrupt saved
        // entry - tell the two apart so the message is accurate.
        if (updated === null && !getFavoriteRomNames(favoritesPath).includes(romName)) {
            res.status(422).send(await renderFavoritesTab(req, {
                warning: `Unable to restore "${romName}": the saved entry is invalid.`,
            }));
            return;
        }
        if (updated !== null) {
            writeFileSync(favoritesPath, updated, 'utf8');
        }

        // Written after favorites.ini for the reverse reason of /favorites/delete: a failure here
        // leaves the favorite restored (and merely still listed as removed until this rom is seen
        // in favorites.ini - the favorites list hides it), never a favorite lost.
        writeRemovedFavorites(removed.filter(candidate => candidate.romName !== romName));
        if (item.cache) {
            const cache = readFavoritesCache();
            if (cache) {
                cache.entries[romName] = item.cache;
                writeFileSync(getFavoritesCachePath(), JSON.stringify(cache));
            }
        }

        favoritesChanged();
        res.send(await renderFavoritesTab(req, {
            notice: updated === null
                ? `"${romName}" was already in the list.`
                : `"${romName}" restored to the list.`,
        }));
    });

    app.post('/votes/set', async (req, res) => {
        const romName: string = (req.body.romName || '').trim();
        const starred = req.body.vote === 'star';
        const vote = starred ? VOTE_UP : parseVote(req.body.vote);
        if (!/^[a-z0-9]+$/.test(romName) || vote === null) {
            res.status(422).send(await renderFavoritesTab(req, {warning: 'Invalid vote.'}));
            return;
        }

        let updated: number;
        let wasStarred: boolean;
        try {
            // paranoid: false - a game already out of the favorites keeps its vote editable.
            wasStarred = !!(await Game.findOne({attributes: ['starred'], where: {romName}, paranoid: false}))?.starred;
            [updated] = await Game.update(voteFields(vote, starred), {where: {romName}, paranoid: false});
        } catch {
            res.status(503).send(await renderFavoritesTab(req, {
                warning: 'Database not ready yet - launch the application once, then retry.',
            }));
            return;
        }
        if (!updated) {
            res.status(404).send(await renderFavoritesTab(req, {warning: `Unknown game "${romName}".`}));
            return;
        }

        const label = starred ? STAR_LABEL : VOTE_LABELS[vote];
        const flash: FavoritesFlash = {notice: `Vote saved for "${romName}": ${label.toLowerCase()}.`};
        const config = new Config();
        config.load();
        const {favoritesPath} = getMameLocations(getMameHomePath());
        let frontTold = false;
        if (vote === VOTE_DOWN && config.thumbsDownRemovesFavorite && favoritesPath
            && getFavoriteRomNames(favoritesPath).includes(romName)) {
            if (isMameConfigSessionAlive()) {
                flash.warning = 'MAME is open (Controls tab): close it first, it would rewrite favorites.ini. '
                    + 'The game stays in the list for now.';
            } else if (removeFavoriteFromDisk(favoritesPath, romName)) {
                favoritesChanged();
                frontTold = true;
                flash.notice += ' Removed from the list and from the cabinet (restorable from "Removed from the list",'
                    + ' below the list).';
            } else {
                flash.warning = 'Unable to remove the game from favorites.ini: entry not found or unexpected format.';
            }
        }
        // Starred or not any more: the cabinet's "My favourites" follows (Home.vue rebuilds its carousel).
        if (wasStarred !== starred && !frontTold) {
            favoritesChanged();
        }
        res.send(await renderFavoritesTab(req, flash));
    });

    app.get('/favorites/starred/export', async (req, res) => {
        let games: Game[];
        try {
            games = await Game.findAll({attributes: ['romName', 'fullname'], where: {starred: true}, order: [['romName', 'ASC']]});
        } catch {
            res.status(503).send(await renderFavoritesTab(req, {
                warning: 'Database not ready yet - launch the application once, then retry.',
            }));
            return;
        }
        if (!games.length) {
            res.send(await renderFavoritesTab(req, {warning: 'No starred game to export.'}));
            return;
        }
        const now = new Date();
        res.set('Content-Type', 'application/json');
        res.set('Content-Disposition', `attachment; filename="maui-my-favourites-${now.toISOString().slice(0, 10)}.json"`);
        res.send(buildStarredFile(games.map(game => ({romName: game.romName, name: game.fullname || game.romName})), now));
    });

    app.post('/favorites/starred/import', starredUpload.single('file'), async (req, res) => {
        // It changes the cabinet's votes: same-origin only, the BO having no CSRF token (see
        // refuseOnlineRequest()).
        if (!isSameOriginRequest({origin: req.get('origin'), referer: req.get('referer'), host: req.get('host')})) {
            res.status(403).send('Cross-site request refused.');
            return;
        }
        if (!req.file || !req.file.originalname.toLowerCase().endsWith('.json')) {
            res.status(422).send(await renderFavoritesTab(req, {warning: 'Pick a .json file exported from "My favourites".'}));
            return;
        }
        let romNames: string[];
        try {
            romNames = parseStarredFile(req.file.buffer.toString('utf8'));
        } catch (error) {
            res.status(422).send(await renderFavoritesTab(req, {warning: `Import failed: ${(error as Error).message}`}));
            return;
        }

        let present: Game[];
        try {
            // The cabinet's games only (not those out of the favorites): a star is for its carousel.
            present = await Game.findAll({attributes: ['romName', 'starred'], where: {romName: romNames}});
            const added = present.filter(game => !game.starred).map(game => game.romName);
            if (added.length) {
                await Game.update(voteFields(VOTE_UP, true), {where: {romName: added}});
                favoritesChanged();
            }
            const missing = romNames.length - present.length;
            const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
            res.send(await renderFavoritesTab(req, {
                notice: `Import done: ${plural(added.length, 'game')} starred, `
                    + `${plural(present.length - added.length, 'game')} already starred`
                    + (missing ? `, ${plural(missing, 'game')} of the file not on this cabinet.` : '.'),
            }));
        } catch {
            res.status(503).send(await renderFavoritesTab(req, {
                warning: 'Database not ready yet - launch the application once, then retry.',
            }));
        }
    });

    /**
     * Renders the Players tab. The deleted players (Advanced configuration only) are loaded here, on
     * every render, so each route below keeps showing up-to-date deleted players without
     * having to pass it along.
     */
    const usersPage = async (
        req: Request, users: User[], avatarFilenames: string[], error?: string, info?: string,
        createError?: string, highlight?: PlayerHighlight,
    ): Promise<string> => {
        const isAdvanced = req.session.boAdvanced === true;
        const deleted = isAdvanced ? await listDeletedUsers().catch(() => []) : [];
        return renderUsersPage(users, avatarFilenames, error, info, createError, {
            isAdvanced, deleted, online: isOnlineActive(), onlineColumn: getOnlineView().state === 'configured',
            highlight,
        });
    };

    app.get('/users', async (req, res) => {
        const avatarFilenames = getAvatarFilenames(new Config());
        // Players as MAUI-API has them now (disabled, locked...), not as of the last periodic sync.
        await online.syncPlayersNow();
        try {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
            res.send(await usersPage(req, users, avatarFilenames));
        } catch {
            res.send(await usersPage(req, [], avatarFilenames, 'Database not found or not initialized yet - '
                + 'launch the application once before managing players.'));
        }
    });

    // Advanced configuration only: a diagnostic view (raw files, hex dumps) of what MAUI reads
    app.get('/hiscores', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.redirect('/');
            return;
        }
        const mameHome = getMameHomePath();
        try {
            const games = await Game.findAll({where: {hi: true}, order: ['romName']});
            const players = new Set((await User.findAll()).map(user => user.pseudo_3));
            const stored = await getStoredScores();
            const sizes = readHiscoreDatSizes(getHiscoreDatPath(mameHome));
            const entries: HiscoreListEntry[] = [];
            for (const game of games) {
                entries.push({game, report: await inspectHiscores(mameHome, game.romName, players, stored.get(game.id_game) || [], sizes)});
            }
            // Played games first, most recent file first
            const latest = (e: HiscoreListEntry) => Math.max(0, ...e.report.files.map(f => f.modified.getTime()));
            entries.sort((a, b) => latest(b) - latest(a));
            res.send(renderHiscoresListPage(entries, getViewer(req), mameHome));
        } catch {
            res.send(renderHiscoresListPage([], getViewer(req), mameHome, 'Database not found or not initialized yet - '
                + 'launch the application once to list the games.'));
        }
    });

    app.get('/hiscores/:romName', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.redirect('/');
            return;
        }
        const mameHome = getMameHomePath();
        const romName = String(req.params.romName);
        // Only a plain rom name: it becomes a path under the mame home directory
        if (!/^[a-z0-9_]+$/i.test(romName)) {
            res.status(404).send(renderPage('<section class="card"><p class="error">Unknown rom.</p></section>', 'hiscores', getViewer(req)));
            return;
        }
        let game: Game | null = null;
        let players = new Set<string>();
        let stored: StoredScore[] = [];
        try {
            game = await Game.findOne({where: {romName}});
            players = new Set((await User.findAll()).map(user => user.pseudo_3));
            if (game) {
                stored = (await getStoredScores(game.id_game)).get(game.id_game) || [];
            }
        } catch {
            // No database yet: the files and mhiex's decoding are still worth showing
        }
        const report = await inspectHiscores(mameHome, romName, players, stored, readHiscoreDatSizes(getHiscoreDatPath(mameHome)));
        res.send(renderHiscoreDetailPage(game, report, getViewer(req)));
    });

    app.post('/users/create', async (req, res) => {
        const pseudo3: string = (req.body.pseudo_3 || '').trim().toUpperCase();
        const realname: string = (req.body.realname || '').trim();
        const email: string = (req.body.email || '').trim();
        const active = req.body.active === 'on';
        const config = new Config();

        try {
            const pseudo3Error = newPseudo3Error(pseudo3);
            if (pseudo3Error) {
                const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
                res.status(422).send(await usersPage(
                    req, users, getAvatarFilenames(config), undefined, undefined, pseudo3Error,
                ));
                return;
            }
            // A deleted player's nickname stays reserved (see UserReservation.ts), whoever asks.
            if (await findDeletedUser(pseudo3)) {
                const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
                res.status(422).send(await usersPage(
                    req, users, getAvatarFilenames(config), undefined, undefined,
                    `The nickname "${pseudo3}" belongs to a deleted player and is reserved. That player `
                    + 'can be restored from the players list in Advanced configuration.',
                ));
                return;
            }
            const fields = {
                pseudo_3: pseudo3,
                ...(realname ? {realname} : {}),
                ...(email ? {email} : {}),
                active,
            };
            // ONLINE: the initials are reserved in MAUI-API first, or the player who has them
            // elsewhere is linked with their PIN (maui-api D4, D48); the local player only exists
            // once the API said yes. Checked locally first, so the API never reserves initials
            // this cabinet cannot store.
            const client = await createOnlineClient();
            let onlineMessage: OnlineBoMessage | undefined;
            if (client) {
                if (await User.findOne({where: {pseudo_3: pseudo3}})) {
                    throw new Error('A player with this nickname already exists.');
                }
                const pin = String(req.body.pin || '').trim();
                const save = (player: OnlinePlayer) => User.create({...fields, ...onlineUserFields(player)} as User);
                const outcome: RegistrationOutcome = pin
                    ? await linkWithPin(client, pseudo3, pin, save)
                    : await registerOnline(client, pseudo3, save, req.body.is_public === 'on');
                onlineMessage = describeOutcomeForBo(pseudo3, outcome);
                if (outcome.kind !== 'created' && outcome.kind !== 'linked') {
                    const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
                    res.status(422).send(await usersPage(
                        req, users, getAvatarFilenames(config), undefined, undefined, onlineMessage.error,
                    ));
                    return;
                }
            } else {
                await User.create(fields as User);
            }
            const created = await User.findOne({where: {pseudo_3: pseudo3}});
            // Every new player starts with a generated default avatar (see DefaultAvatar.ts); the
            // list below is read after this so it shows it. An avatar failing to write must not
            // turn a successful creation into an error page.
            try {
                ensureDefaultAvatar(config.avatarsPath, pseudo3);
            } catch (avatarError) {
                console.error(`[boServer] Default avatar for "${pseudo3}" failed:`, avatarError);
            }
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
            res.send(await usersPage(req,
                users, getAvatarFilenames(config), undefined, onlineMessage?.info ?? `Player "${pseudo3}" created.`,
                undefined, created ? {id_user: created.id_user, pin: onlineMessage?.pin} : undefined,
            ));
        } catch (error) {
            const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
            res.status(422).send(await usersPage(req, 
                users, getAvatarFilenames(config), undefined, undefined, describeUserError(error),
            ));
        }
    });

    // ONLINE actions on one player (OnlinePlayersBo.ts). Same-origin only: they act on MAUI-API
    // with the cabinet's credentials, and the BO has no CSRF token (see SameOrigin.ts).
    type OnlinePlayerHandler = (user: User, client: MauiApiClient, req: Request) => Promise<OnlineBoMessage>;
    const onlinePlayerAction = (handler: OnlinePlayerHandler) => async (req: Request, res: Response) => {
        if (!isSameOriginRequest({origin: req.get('origin'), referer: req.get('referer'), host: req.get('host')})) {
            res.status(403).send('Cross-site request refused.');
            return;
        }
        const user = await User.findByPk(String(req.params.id));
        const client = await createOnlineClient({requireEnabled: false});
        const message = !user
            ? {error: 'Unknown player.'}
            : !client
                ? {error: 'ONLINE is not configured.'}
                : await handler(user, client, req).catch((error: unknown) => ({
                    error: error instanceof Error ? error.message : String(error),
                }));
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.status(message.error ? 422 : 200).send(await usersPage(
            req, users, getAvatarFilenames(new Config()), message.error, message.info, undefined,
            user && message.pin ? {id_user: user.id_user, pin: message.pin} : undefined,
        ));
    };

    // Reserves a local-only player's initials, or links the player who has them elsewhere (PIN).
    app.post('/users/:id/online/link', onlinePlayerAction(async (user, client, req) => {
        const pin = String(req.body.pin || '').trim();
        const save = (player: OnlinePlayer) => user.update(onlineUserFields(player));
        return describeOutcomeForBo(user.pseudo_3, pin
            ? await linkWithPin(client, user.pseudo_3, pin, save)
            : await registerOnline(client, user.pseudo_3, save, !!user.is_public));
    }));

    app.post('/users/:id/online/public', onlinePlayerAction(async (user, client) => {
        if (!user.remote_id) {
            return {error: `"${user.pseudo_3}" is not in MAUI-API yet.`};
        }
        const result = await client.updatePlayer(user.remote_id, !user.is_public);
        if (result.kind !== 'ok') {
            return {error: `MAUI-API refused the change (${result.kind === 'rejected' ? result.code : result.kind}).`};
        }
        await user.update(onlineUserFields(result.value));
        return {info: `"${user.pseudo_3}" is now ${result.value.isPublic ? 'public' : 'private'}.`};
    }));

    app.post('/users/:id/online/pin', onlinePlayerAction(async (user, client) => {
        if (!user.remote_id) {
            return {error: `"${user.pseudo_3}" is not in MAUI-API yet.`};
        }
        const notOrigin = `"${user.pseudo_3}" was not created on this cabinet: a new PIN can only be issued from `
            + 'the cabinet they were created on, or by a MAUI-API administrator.';
        if (!user.is_origin) {
            return {error: notOrigin};
        }
        const result = await client.regeneratePin(user.remote_id);
        if (result.kind !== 'ok') {
            return {error: result.kind === 'rejected' && result.code === 'not_origin_cabinet'
                ? notOrigin
                : `MAUI-API refused the new PIN (${result.kind === 'rejected' ? result.code : result.kind}).`};
        }
        await user.update({online_status: 'active'});
        return {info: `New PIN for "${user.pseudo_3}": shown under their row.`, pin: result.value};
    }));

    // Same sync as opening the tab (GET /users), on demand, with its outcome.
    app.post('/users/online/sync', async (req, res) => {
        const outcome = await online.syncPlayersNow();
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(req, users, getAvatarFilenames(new Config()),
            outcome === 'ok' ? undefined : 'MAUI-API could not be reached: players shown as of the last sync.',
            outcome === 'ok' ? 'Players synced with MAUI-API.' : undefined));
    });

    app.post('/users/:id/toggle-active', async (req, res) => {
        const user = await User.findByPk(req.params.id);
        // While ONLINE is on, initials not reserved in MAUI-API may belong to someone else
        // (OnlineReconciliation.ts): the player goes ONLINE first, then can be activated.
        // A player disabled in MAUI-API is enabled again there only, by its admins.
        const onlineEnabled = isOnlineActive();
        const disabledUpstream = !!user && isDisabledUpstream({online_status: user.online_status ?? null}, onlineEnabled);
        const refused = disabledUpstream || (!!user && !user.active && !canActivateLocally(user, onlineEnabled));
        if (user && !refused) {
            user.active = !user.active;
            await user.save();
        }
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(req, 
            users, getAvatarFilenames(new Config()),
            disabledUpstream
                ? `"${user?.pseudo_3}" is disabled in MAUI-API: only its administrators can enable them again.`
                : refused ? `"${user?.pseudo_3}" is not in MAUI-API: use "Go ONLINE" first, then activate them.` : undefined,
            user && !refused ? `Player "${user.pseudo_3}" updated.` : undefined,
        ));
    });

    app.post('/users/:id/delete', async (req, res) => {
        const user = await User.findByPk(req.params.id);
        if (user) {
            // Soft delete (User is paranoid): the nickname stays reserved and the scores are kept,
            // hidden from the hiscore views, until the player is restored (Advanced configuration).
            await user.destroy();
        }
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()), undefined,
            user ? `Player "${user.pseudo_3}" deleted. The nickname stays reserved; it can be `
                + 'restored from the players list in Advanced configuration.' : undefined,
        ));
    });

    app.post('/users/:id/purge', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const purged = await purgeDeletedUser(String(req.params.id), new Config().avatarsPath);
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()),
            purged ? undefined : 'This player is not among the deleted players (already removed?).',
            purged ? `Player "${purged.user.pseudo_3}" permanently deleted, with ${purged.scoreCount} score(s).` : undefined,
        ));
    });

    app.post('/users/:id/restore', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const restored = await restoreDeletedUser(String(req.params.id));
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]});
        res.send(await usersPage(
            req, users, getAvatarFilenames(new Config()),
            restored ? undefined : 'This player is not among the deleted players (already restored?).',
            restored ? `Player "${restored.pseudo_3}" restored, with their scores.` : undefined,
        ));
    });

    app.post('/users/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
        // String(): with a middleware ahead of the handler @types/express 5 no longer infers the
        // route's params from the path, and req.params.id falls back to string | string[].
        const user = await User.findByPk(String(req.params.id));
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
        const config = new Config();

        if (!user) {
            res.status(404).send(await usersPage(req, users, getAvatarFilenames(config), 'Player not found.'));
            return;
        }
        if (isAvatarFromOrigin(user)) {
            res.status(403).send(await usersPage(
                req, users, getAvatarFilenames(config),
                `"${user.pseudo_3}" was created on another cabinet: the avatar is changed from that one.`,
            ));
            return;
        }
        if (!req.file) {
            res.status(422).send(
                await usersPage(req, users, getAvatarFilenames(config), 'No file sent.'),
            );
            return;
        }
        if (req.file.mimetype !== 'image/png') {
            res.status(422).send(await usersPage(req, 
                users, getAvatarFilenames(config), 'The avatar must be a PNG image.',
            ));
            return;
        }

        writeFileSync(join(config.avatarsPath, `${user.pseudo_3}.png`), req.file.buffer);
        res.send(await usersPage(req, 
            users, getAvatarFilenames(config), undefined, `Avatar updated for "${user.pseudo_3}".`,
        ));
    });

    // A favorite's marquee/flyer/logo, for the favorites list's hover previews (see
    // renderAssetIcon()). Read from the directories ui.ini points at, like the presence icons.
    app.get('/media/:kind/:file', (req, res) => {
        const {marqueePath, flyerPath, logoPath} = getMameLocations(getMameHomePath());
        const dirs: {[kind: string]: string | null} = {marquee: marqueePath, flyer: flyerPath, logo: logoPath};
        const dir = dirs[req.params.kind];
        // Same rom name character set as the favorites routes: no path separators, no dot dirs.
        if (!dir || !/^[a-z0-9_]+\.png$/.test(req.params.file)) {
            res.status(404).end();
            return;
        }
        // no-cache: revalidated (ETag) on every hover, so artwork re-downloaded from ScreenScraper
        // shows up without a stale copy. Served with a root for the same reason as /avatars below.
        res.sendFile(req.params.file, {root: dir, headers: {'Cache-Control': 'no-cache'}}, (error) => {
            if (error && !res.headersSent) {
                res.status(404).end();
            }
        });
    });

    // Deleting an avatar brings the player's generated default back (see DefaultAvatar.ts).
    app.post('/users/:id/avatar/delete', async (req, res) => {
        const user = await User.findByPk(req.params.id);
        const users = await User.findAll({order: [['pseudo_3', 'ASC']]}).catch(() => []);
        const config = new Config();

        if (!user) {
            res.status(404).send(await usersPage(req, users, getAvatarFilenames(config), 'Player not found.'));
            return;
        }
        if (isAvatarFromOrigin(user)) {
            res.status(403).send(await usersPage(
                req, users, getAvatarFilenames(config),
                `"${user.pseudo_3}" was created on another cabinet: the avatar is changed from that one.`,
            ));
            return;
        }
        const removed = resetToDefaultAvatar(config.avatarsPath, user.pseudo_3);
        res.send(await usersPage(
            req, users, getAvatarFilenames(config), undefined,
            removed ? `Avatar deleted for "${user.pseudo_3}".` : `"${user.pseudo_3}" already has the default avatar.`,
        ));
    });

    app.get('/avatars/:filename', (req, res) => {
        const config = new Config();
        // basename() strips any directory components (e.g. "../../etc/passwd") from the
        // user-controlled route param before it ever reaches the filesystem.
        const filename = basename(req.params.filename);
        if (!existsSync(join(config.avatarsPath, filename))) {
            res.status(404).end();
            return;
        }
        // Served with a `root`, not as an absolute path: Express 5's send() answers 404 for any
        // absolute path holding a dot directory, and the avatars live under ~/.mame-awesome-ui.
        // With a root only the part below it is checked. Same reason for res.download() below.
        res.sendFile(filename, {root: config.avatarsPath}, (error) => {
            if (error && !res.headersSent) {
                res.status(404).end();
            }
        });
    });

    app.post('/favorites/download-media', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config(getSecretsKey(req));
        config.load();
        const ssValues: ScreenScraperValues = {
            ssDevId: config.ssDevId,
            ssDevPassword: config.ssDevPassword,
            ssSoftName: config.ssSoftName,
            ssUserId: config.ssUserId,
            ssUserPassword: config.ssUserPassword,
            bezelAspect: config.bezelAspect,
        };
        const hasCreds = hasScreenScraperCredentials(config);
        const context = getFavoritesContext(config);

        if ('error' in context) {
            res.send(renderScreenScraperPage(ssValues, hasCreds, undefined, undefined, context.error));
            return;
        }

        // Only romName + media status is needed here (see downloadMissingFavoriteMedia() below) -
        // a cheap fs check, unlike resolveFavorites()'s `mame -lx` per rom, which this
        // route has no use for (progress lines below only ever print row.romName).
        const rows = context.romNames.map(romName => ({romName, ...getFavoriteMediaStatus(context, romName)}));

        if (!hasCreds) {
            res.send(renderScreenScraperPage(ssValues, false));
            return;
        }

        const {marqueePath, flyerPath, logoPath} = context;
        if (!marqueePath || !flyerPath || !logoPath) {
            res.send(renderScreenScraperPage(
                ssValues, hasCreds, undefined, undefined,
                'Marquees/flyers/logos folders not found - configure and validate the mame binary '
                    + '(MAME tab > Config).',
            ));
            return;
        }

        // Stream the page as favorites are processed instead of blocking on the whole batch:
        // each game appends a <li> the browser renders immediately, so long runs stay visible
        // instead of looking like the request (and the tab) hung.
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        // Disable Nagle's algorithm so each res.write() below reaches the browser as soon as
        // it's flushed, instead of being buffered and coalesced with the next one.
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('screenscraper', getViewer(req)));
        res.write(`
            <section class="card">
                <h2>Download in progress…</h2>
                ${PROGRESS_LOG_OPEN}
        `);

        try {
            const summary = await downloadMissingFavoriteMedia(
                {
                    devId: config.ssDevId,
                    devPassword: config.ssDevPassword,
                    softName: config.ssSoftName,
                    userId: config.ssUserId,
                    userPassword: config.ssUserPassword,
                },
                marqueePath,
                flyerPath,
                logoPath,
                rows,
                line => res.write(`<li>${escapeHtml(line)}</li>`),
            );

            res.write('</ul></section>');
            res.write(renderDownloadSummary(summary));
        } catch (error) {
            console.error('[boServer] ScreenScraper download failed:', error);
            res.write(`</ul><p class="error">${
                escapeHtml(error instanceof Error ? error.message : 'Unexpected error.')
            }</p>`);
        }

        res.write('<p><a class="button-link" href="/screenscraper">Back to ScreenScraper</a></p>');
        res.write(renderPageTail());
        res.end();
    });

    // Starting packs come from the repository only (MAME > Import, Games > Repository): kept as a
    // redirect rather than a 404 for anyone with the old standalone upload page bookmarked.
    app.get('/import', (req, res) => {
        res.redirect('/');
    });

    // Every route that downloads from the repository: ONLINE mode only (see RepositoryAuth.ts).
    // Hiding the buttons is not enough, an Advanced session can still post directly. Local check,
    // no network call; resolveRepository() then asks MAUI-API for the URL.
    const refuseOffline = (res: Response): boolean => {
        if (isOnlineActive()) {
            return false;
        }
        res.status(403).send('Available in ONLINE mode only.');
        return true;
    };

    // Proxied server-side (rather than the browser fetching index.json directly) so the cabinet
    // credentials never reach the browser at all.
    app.get('/import/from-url/packs', async (req, res) => {
        if (refuseOffline(res)) {
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);

        if (getMissingConfPackFiles(mameInfo).length) {
            res.status(422).send(await renderFavoritesTab(req, {}, {
                error: 'Install the configuration pack first (MAME > Import / Export tab).',
            }));
            return;
        }
        const repository = await resolveRepository();
        if (!repository.ok) {
            res.status(502).send(await renderFavoritesTab(req, {}, {error: describeRepositoryFailure(repository)}));
            return;
        }

        try {
            const response = await fetch(`${repository.url}/index.json`, {
                headers: repository.headers,
                // The headers carry the cabinet token: never follow a redirect elsewhere.
                redirect: 'error',
                signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) {
                throw new Error(await describeRepositoryResponse(response));
            }
            const data = await response.json() as {packs?: RepoPack[]};
            // The configuration pack has its own card (see renderConfPackCard()).
            const packs = (data.packs ?? []).filter(pack => isGamePack(pack.filename));
            const installedRoms = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
            const manifests = await Promise.all(
                packs.map(pack => fetchRepoManifest(repository.url, pack.filename, repository.headers)),
            );
            const incompatible = await findPacksIncompatibleGames(config, manifests);
            packs.forEach((pack, index) => {
                const manifest = manifests[index];
                // Per-game sizes for the disk bar: the manifest lists them, unless it is out of date.
                const entrySizes = manifestEntrySizes(manifest, pack.size);
                const tooSlow = findCabinetTooSlowGames(manifest);
                // Neither kind is offered below: they do not make the pack look incomplete.
                const notOffered = new Set([...tooSlow.keys(), ...(incompatible[index]?.keys() ?? [])]);
                pack.ownership = computePackOwnership(manifest, installedRoms, notOffered) ?? undefined;
                pack.games = listPackGames(manifest, installedRoms, entrySizes, pack.size).map(game => ({
                    ...game, incompatibility: incompatible[index]?.get(game.romName), tooSlow: tooSlow.get(game.romName),
                }));
                pack.biosSizes = computeBiosSizes(manifest, entrySizes);
            });
            res.send(await renderFavoritesTab(req, {}, {packs, url: repository.url}));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(502).send(await renderFavoritesTab(req, {}, {error: `Unable to reach the repository: ${message}`}));
        }
    });

    // The carousel needs the configuration pack to have genres, and the starter pack is what a new
    // cabinet starts with. The starter pack comes with the configuration pack, like every game
    // pack from the repository.
    const importFromRepository = (withStarterPack: boolean) => async (req: Request, res: Response) => {
        if (refuseOffline(res)) {
            return;
        }
        const config = new Config(getSecretsKey(req));
        config.load();
        const values: ConfigFormValues = {mamePath: config.mamePath || ''};
        const isAdvanced = req.session.boAdvanced === true;
        const mameInfo = getMameInfo(config);

        const fromSetup = req.body?.from === 'setup';
        const repository = await resolveRepository();
        if (!repository.ok) {
            if (fromSetup) {
                sendSetupPage(req, res, {step: withStarterPack ? 'starterPack' : 'confPack', error: describeRepositoryFailure(repository)});
                return;
            }
            res.status(502).send(renderForm(
                values, mameInfo, isAdvanced, undefined, undefined, undefined, describeRepositoryFailure(repository),
            ));
            return;
        }
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead(fromSetup ? 'setup' : 'mame', getViewer(req)));
        const confPackInstalled = await runConfPackImport(res, config, repository);
        if (withStarterPack) {
            if (!confPackInstalled) {
                res.write('<p class="error flash">The configuration pack could not be installed: starter pack not imported.</p>');
            } else {
                const title = `Starter pack import in progress… (${escapeHtml(STARTER_PACK_FILENAME)})`;
                await runRepositoryImport(res, config, repository, title, STARTER_PACK_FILENAME);
                await streamFavoritesRefreshAfterImport(res, config);
            }
        }

        if (fromSetup) {
            // The guide shows what is left; the import's log stays above for whoever reads it.
            res.write('<section class="card"><p><a class="button-link" href="/setup">Back to Getting started</a></p></section>');
        } else {
            const refreshedMameInfo = getMameInfo(config);
            res.write(renderConfigCard(values, refreshedMameInfo));
            res.write(renderMameInfoCard(refreshedMameInfo));
            if (!refreshedMameInfo.error) {
                res.write(renderImportSection(refreshedMameInfo));
            }
        }
        res.write(renderPageTail());
        res.end();

        // Back through Init.vue, which re-seeds the categories and re-syncs the games.
        reloadFront();
    };
    app.post('/import/conf-pack', importFromRepository(false));
    app.post('/import/starter-pack', importFromRepository(true));

    app.post('/import/from-url', async (req, res) => {
        if (refuseOffline(res)) {
            return;
        }
        const config = new Config();
        config.load();
        // One "<pack>.zip|<romName>" per ticked game, grouped by pack (a game listed by several
        // packs is kept for the first). urlencoded (extended: false) yields a string for one
        // ticked box, an array for several; anything malformed is refused (see the function).
        const selection = groupSelectedGames(req.body?.game);
        // The too slow games asked for all the same (see renderPackGames()).
        const forcedSlow = parseForcedGames(req.body?.forceSlow);

        if (selection && !selection.size) {
            res.status(422).send(await renderFavoritesTab(req, {}, {error: 'Tick at least one game to import.'}));
            return;
        }
        if (!selection) {
            res.status(422).send(await renderFavoritesTab(req, {}, {error: 'Invalid pack or game name.'}));
            return;
        }
        // Resolved once for the whole import: every pack below comes from the same repository.
        const repository = await resolveRepository();
        if (!repository.ok) {
            res.status(502).send(await renderFavoritesTab(req, {}, {error: describeRepositoryFailure(repository)}));
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('favorites', getViewer(req)));

        // Packs are imported one after the other (one progress card each): an import rewrites
        // favorites.ini and shared category files, so they must not overlap.
        // The configuration pack first when the repository's changed (see ConfPack.ts): game packs
        // no longer ship the category files, so this keeps them matching the repository's.
        if (!await runConfPackImport(res, config, repository, true)) {
            res.write('<p class="error flash">The configuration pack could not be installed: game packs not imported.</p>');
            res.write(renderPageTail());
            res.end();
            return;
        }

        // Several packs: one tab per pack instead of one card each (17 packs made a very long page).
        const tabbed = selection.size > 1;
        if (tabbed) {
            res.write(renderImportTabsOpen([...selection.keys()]));
        }
        let imported = true;
        for (const [index, [packFilename, romNames]] of [...selection.entries()].entries()) {
            const counter = selection.size > 1 ? `[${index + 1}/${selection.size}] ` : '';
            // Just these games are read from the pack (HTTP Range requests, no full download).
            imported = await runRepositoryImport(
                res,
                config,
                repository,
                `${counter}Import from the repository in progress… (${escapeHtml(packFilename)}, ${romNames.length} game(s))`,
                packFilename,
                romNames,
                {index, total: selection.size},
                tabbed,
                forcedSlow,
            ) && imported;
        }
        if (tabbed) {
            res.write('</div></section>');
        }

        await streamFavoritesRefreshAfterImport(res, config);

        if (imported) {
            // Back to the list of games, which now holds the new ones. replace(): this page is the
            // answer to a POST, and going back to the pack picker before it would show the games
            // just imported as still to download. A failed import stays here, with its log.
            const asked = [...selection.values()].reduce((total, romNames) => total + romNames.length, 0);
            finishImportProgress(res, 'Opening the games list…');
            res.write(`<script>location.replace('/favorites?imported=${asked}')</script>`);
        } else {
            // Not when leaving: it costs the server time the games list waits for.
            res.write(renderRepoImportCard(getMameInfo(config)));
        }
        res.write(renderPageTail());
        res.end();

        // Same as /import above.
        reloadFront();
    });

    app.get('/maui', async (req, res) => {
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config);
    });

    app.post('/maui/save', async (req, res) => {
        const config = new Config();
        config.load();
        // Advanced configuration option (see renderMauiCard()): the basic form has no such checkbox, which
        // must not read as "unchecked" and switch it off.
        if (req.session.boAdvanced === true) {
            config.openDevTools = req.body.openDevTools === 'on';
        }
        config.fullscreen = req.body.fullscreen === 'on';
        config.voteEnabled = req.body.voteEnabled === 'on';
        config.thumbsDownRemovesFavorite = req.body.thumbsDownRemovesFavorite === 'on';
        // Read again by the main process each time the front wakes up (FrontUpdate.ts): no reload.
        config.frontUpdateEnabled = req.body.frontUpdateEnabled === 'on';
        // Advanced configuration only, like the development builds it offers.
        if (req.session.boAdvanced === true) {
            config.updateChannel = parseUpdateChannel(req.body.updateChannel);
        }
        const previousCategories = shownCategories(config);
        config.showAllGamesCategory = req.body.showAllGamesCategory === 'on';
        config.showBeatThisCategory = req.body.showBeatThisCategory === 'on';
        config.showHiscoresOnlyCategory = req.body.showHiscoresOnlyCategory === 'on';
        const previousUiMode = config.uiMode;
        config.uiMode = parseUiModeSetting(req.body.uiMode);
        const boIdleMinutes = Number(req.body.boIdleMinutes);
        if (Number.isInteger(boIdleMinutes) && boIdleMinutes >= 0 && boIdleMinutes <= 1440) {
            config.boIdleMinutes = boIdleMinutes;
        }
        const frontIdleKey = () => `${config.frontIdleEnabled}/${config.frontIdleMinutes}/${config.frontIdleShowsGames}`
            + `/${config.frontSleepMinutes}/${config.frontSleepScreenOff}`;
        const previousFrontIdle = frontIdleKey();
        config.frontIdleEnabled = req.body.frontIdleEnabled === 'on';
        config.frontIdleShowsGames = req.body.frontIdleShowsGames === 'on';
        const frontIdleMinutes = Number(req.body.frontIdleMinutes);
        if (Number.isInteger(frontIdleMinutes) && frontIdleMinutes >= 1 && frontIdleMinutes <= 120) {
            config.frontIdleMinutes = frontIdleMinutes;
        }
        const frontSleepMinutes = Number(req.body.frontSleepMinutes);
        if (Number.isInteger(frontSleepMinutes) && frontSleepMinutes >= 0 && frontSleepMinutes <= 1440) {
            config.frontSleepMinutes = frontSleepMinutes;
        }
        config.frontSleepScreenOff = req.body.frontSleepScreenOff === 'on';
        const previousOnlineBadge = `${config.onlineBadgeDotOnly}/${config.onlineBadgeHideIp}`;
        config.onlineBadgeDotOnly = req.body.onlineBadgeDotOnly === 'on';
        config.onlineBadgeHideIp = req.body.onlineBadgeHideIp === 'on';
        // Read again by userRegistration.vue at each registration: no reload of the front.
        config.cabinetPlayersPublic = req.body.cabinetPlayersPublic === 'on';
        // Only offered on a dedicated cabinet (see renderMauiCard()): absent from the form elsewhere,
        // which must not reset it.
        if (typeof req.body.displayMode === 'string') {
            config.displayMode = parseDisplayModeSetting(req.body.displayMode);
        }
        if (typeof req.body.videoOutput === 'string') {
            config.videoOutput = parseVideoOutputSetting(req.body.videoOutput);
        }
        let audioError: string | undefined;
        if (typeof req.body.audioOutput === 'string') {
            const audioOutput = parseAudioOutputSetting(req.body.audioOutput);
            let outputs: ScreenOutputInfo[] = [];
            try {
                outputs = listScreenOutputs();
            } catch {
                // No xrandr answer: no screen output to follow.
            }
            try {
                // At once (the next game opens the sound device again), and even unchanged: the
                // screen output it follows may have changed.
                applyAudioOutput(resolveAudioOutput(audioOutput, currentScreenOutput(config.videoOutput, outputs), listAudioDevices()));
                config.audioOutput = audioOutput;
            } catch (error) {
                audioError = error instanceof Error ? error.message : String(error);
            }
        }
        config.save();
        if (config.uiMode !== previousUiMode || shownCategories(config) !== previousCategories
            || frontIdleKey() !== previousFrontIdle
            || `${config.onlineBadgeDotOnly}/${config.onlineBadgeHideIp}` !== previousOnlineBadge) {
            // The front decides its mode and its badge's look once, when it loads (App.vue), and
            // builds its carousel and starts its idle watch when Home.vue is mounted.
            reloadFront();
        }
        await sendMauiPage(req, res, config, {
            mauiInfo: audioError ? `Configuration saved, but not the sound output: ${audioError}` : 'Configuration saved.',
        });
    });

    app.post('/maui/online/save', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const input = typeof req.body.configuration === 'string' ? req.body.configuration : '';
        const outcome = saveConfigurationString(input);
        if (outcome.ok) {
            // New credentials: an ONLINE session still running would keep the old ones.
            await online.restart();
        }
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, outcome.ok
            ? {onlineInfo: 'Configuration saved. Use "Test connection" to check it.'}
            : {onlineError: outcome.error});
    });

    // Development only: renderScoresBackfillCard(). Same path as the scores of a game
    // (ScoreOutbox.ts): queued, then sent, which also fills the best cache.
    app.post('/maui/online/backfill-scores', async (req, res) => {
        if (process.env.NODE_ENV !== 'development') {
            res.sendStatus(404);
            return;
        }
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        if (!online.currentClient()) {
            await sendMauiPage(req, res, config, {backfillError: 'ONLINE is not running.'});
            return;
        }
        // MAUI-API may have been emptied (dev:reset-scores): let it decide again.
        await scoreStore.clearBests();
        const players = await User.findAll();
        let queued = 0;
        for (const table of await readCabinetTables(getMameHomePath())) {
            queued += (await queueScores(scoreStore, players, table.rows, {
                romname: table.romname, achievedAt: table.achievedAt, startupId: online.getStatus().startupId,
            })).length;
        }
        const summary = await online.flushScoresNow();
        const found = `${queued} score(s) of public players queued, `;
        const view = getOnlineView();
        await sendMauiPage(req, res, config, !summary || summary.failure
            ? {backfillError: `${found}not sent yet${summary?.failure
                ? `: ${describeFailure(summary.failure, view.state === 'configured' ? view.url : '')}` : ''}. `
                + 'They stay in the outbox for the next heartbeat.'}
            : {backfillInfo: found + describeFlush(summary)});
    });

    app.get('/maui/online/badge', (req, res) => {
        res.set('Cache-Control', 'no-store').json(getOnlineBadge() ?? {indicator: null});
    });

    app.post('/maui/online/enabled', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const enabling = req.body.enabled === 'on';
        // Every active player must be in MAUI-API before ONLINE turns on (OnlineReconciliation.ts).
        const blocking = enabling ? playersBlockingOnline(await User.findAll()) : null;
        const result = blocking ? {level: 'error' as const, message: blocking} : setOnlineEnabled(enabling);
        if (result.level === 'info') {
            await online.restart();
        }
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, result.level === 'info'
            ? {onlineInfo: result.message}
            : {onlineError: result.message});
    });

    app.post('/maui/online/test', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const result = await testConnection();
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, result.level === 'info'
            ? {onlineInfo: result.message}
            : {onlineError: result.message});
    });

    app.post('/maui/online/reset', async (req, res) => {
        if (refuseOnlineRequest(req, res)) {
            return;
        }
        const result = resetOnlineSettings();
        await online.restart();
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, result.level === 'info'
            ? {onlineInfo: result.message}
            : {onlineError: result.message});
    });

    // Backup/restore of mame-awesome-ui's own config/database - Advanced configuration only (see the "Import /
    // export mame-awesome-ui" card, hidden outside Advanced configuration in renderMauiPage()).
    app.get('/maui/export', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config();
        const partIds = parseBackupParts(BACKUP_PARTS.map(part => part.id).filter(id => req.query[id] === 'on'));

        if (!partIds.length) {
            config.load();
            await sendMauiPage(req, res, config, {importExportError: 'Tick at least one box before exporting.'});
            return;
        }

        const zip = buildBackup(dirname(config.configPath), partIds);
        if (!zip) {
            config.load();
            await sendMauiPage(req, res, config, {
                importExportError: 'Nothing to export: the selected files do not exist yet.',
            });
            return;
        }

        const date = new Date().toISOString().slice(0, 10);
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="mame-awesome-ui-export-${date}.zip"`);
        res.send(zip);
    });

    app.post('/maui/import', upload.single('file'), async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config();
        config.load();

        if (!req.file) {
            await sendMauiPage(req, res, config, {importExportError: 'No file provided.'});
            return;
        }

        const originalName = req.file.originalname.toLowerCase();
        const restored: string[] = [];

        try {
            if (originalName.endsWith('.zip')) {
                const parts = restoreBackup(dirname(config.configPath), req.file.buffer);
                if (!parts.length) {
                    await sendMauiPage(req, res, config, {
                        importExportError: 'The ZIP holds none of the files of mame-awesome-ui.',
                    });
                    return;
                }
                restored.push(...parts.map(part => part.label));
            } else if (originalName.endsWith('.json')) {
                // Throws on malformed JSON, caught below - avoids overwriting the current
                // config with a file the app would then fail to load on next start.
                JSON.parse(req.file.buffer.toString('utf8'));
                writeFileSync(config.configPath, req.file.buffer);
                restored.push('the configuration');
            } else if (originalName.endsWith('.sqlite') || originalName.endsWith('.db')) {
                // Same sqlite file header every real .sqlite file starts with - cheap sanity
                // check against uploading an unrelated file under this extension.
                if (req.file.buffer.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') {
                    await sendMauiPage(req, res, config, {
                        importExportError: 'This file does not look like a valid '
                            + 'sqlite database.',
                    });
                    return;
                }
                writeFileSync(getDatabasePath(), req.file.buffer);
                restored.push('the database');
            } else {
                await sendMauiPage(req, res, config, {
                    importExportError: 'Unrecognized format: use a .zip exported here, a .json or a .sqlite/.db.',
                });
                return;
            }
        } catch (error) {
            await sendMauiPage(req, res, config, {
                importExportError: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
            });
            return;
        }

        // Same reasoning as /reset's config/database branches: the renderer's long-lived Vuex
        // store instances (see store.ts's initServices) were built from the files just
        // overwritten, so only a full process restart picks up the import.
        res.send(renderPage(
            '<section class="card"><h2>Import complete</h2>'
            + `<p class="error">Restored: ${restored.join(', ')}.</p>`
            + await renderRelaunchNotice('take the imported files into account', '/maui')
            + '</section>',
            'maui', getViewer(req),
        ));

        setTimeout(onReset, 300);
    });

    // Not role-gated beyond being logged in for a real release - installing one of those onto
    // the device the BO itself runs on is exactly what a "user"-role account (e.g. puckman) is
    // meant to be able to do, same trust level as everything else on the "General" MAUI subtab.
    // A dev build (GitHub prerelease published from develop, see getUpdateInfo()) stays
    // Advanced configuration only even though the asset itself needs no auth to download - checked server-side
    // below, not just by hiding the row in renderUpdateCard(), since the tagName/assetUrl pair
    // is posted back by the client and could otherwise be forged by a "user"-role account.
    app.post('/maui/update/install', async (req, res) => {
        const config = new Config();
        config.load();
        const tagName = typeof req.body.tagName === 'string' ? req.body.tagName : '';
        const isAdvanced = req.session.boAdvanced === true;

        if (!isSelfUpdateCapable()) {
            await sendMauiPage(req, res, config, {updateInfoError: 'Installation unavailable on this machine.'});
            return;
        }

        const preUpdateInfo = await getUpdateInfo();
        if (!isAdvanced && preUpdateInfo.devBuilds.some(build => build.tagName === tagName)) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        // The file to fetch is the one GitHub lists for that version, not an address the form
        // sent: it is run on this machine.
        const target = [...preUpdateInfo.releases, ...preUpdateInfo.devBuilds]
            .find(release => release.tagName === tagName);
        // Same as the dev builds: the row offers nothing, and a forged form gets no further.
        if (!isAdvanced && target?.isOlder) {
            res.status(403).send('Going back to an earlier version is available in Advanced configuration only.');
            return;
        }
        const assetUrl = target?.assetUrl;
        if (!assetUrl) {
            await sendMauiPage(req, res, config, {updateInfoError: `Version ${tagName || '?'} has nothing to install on this machine.`});
            return;
        }

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.socket?.setNoDelay(true);
        res.write(renderPageHead('maui', getViewer(req)));
        const waitForNewVersion = '<section class="card"><p id="restart-wait-message" class="info">Waiting for the '
            + 'application to come back… this page will automatically take you back to the MAUI tab as soon as the '
            + `new version is running.</p>${renderRestartWaitScript('/maui')}</section>`;
        let installMessage: string | undefined;
        if (isWindowsInstall()) {
            const installerPath = await downloadWindowsInstallerLogged(res, `Installing version ${tagName}…`, assetUrl);
            if (installerPath) {
                res.write(waitForNewVersion);
                res.write(renderPageTail());
                res.end();
                // Delayed so this response finishes flushing: the installer closes this process.
                setTimeout(() => runWindowsInstaller(installerPath, onReset), 500);
                return;
            }
        } else if (await runUpdateInstall(res, `Installing version ${tagName}…`, assetUrl)) {
            // MAUI restarts by itself on the new version, as the confirmation said: the kiosk session
            // (X and MAUI, which ~/.xinitrc runs as its last command), not the machine.
            // Delayed so this response finishes flushing before the session goes down.
            if (await restartOnInstalledVersion(500)) {
                res.write('<section class="card"><h2>Restarting MAUI</h2><p class="info">The screen goes '
                    + 'blank for a moment, then MAUI comes back on the new version.</p></section>');
                res.write(waitForNewVersion);
                res.write(renderPageTail());
                res.end();
                return;
            }
            installMessage = 'MAUI cannot restart by itself (the sudo rule of docs/RASPBERRY-PI-DEPLOY.md '
                + '§5.7 is missing): restart the cabinet to run the new version.';
        }

        const updateInfo = await getUpdateInfo();
        res.write(renderMauiCard(config, isAdvanced));
        res.write(renderUpdateCard(updateInfo, isAdvanced, undefined, installMessage));
        if (isAdvanced) {
            res.write(renderMauiImportExportCard());
            res.write(renderMauiDangerZoneCard());
        }
        res.write(renderPageTail());
        res.end();
    });

    // Same access as the installation just above (any BO account): restarting only relaunches the
    // app on what ~/squashfs-root already holds, it changes nothing on disk. Refused unless this is
    // the dedicated Pi layout (isSelfUpdateCapable()) and sudo allows that one command without a
    // password (docs/RASPBERRY-PI-DEPLOY.md §5.7) - checked up front so a missing rule shows an
    // explanation instead of a page waiting for a restart that never comes.
    app.post('/maui/update/restart', async (req, res) => {
        const config = new Config();
        config.load();

        if (!isKioskLayout()) {
            await sendMauiPage(req, res, config, {updateInfoError: 'Restart unavailable on this machine.'});
            return;
        }
        if (!await canRestartKiosk()) {
            await sendMauiPage(req, res, config, {
                updateInfoError: 'The application cannot be restarted from here: the user is not allowed to '
                    + 'run the restart through sudo without a password (see docs/RASPBERRY-PI-DEPLOY.md §5.7).',
            });
            return;
        }

        res.send(renderPage(
            '<section class="card"><h2>Restarting the application</h2>'
            + '<p class="info">The screen goes blank for a moment, then the application reopens on the '
            + 'version installed in <code>~/squashfs-root</code>.</p>'
            + '<p id="restart-wait-message" class="info">Waiting for the restart… this page will '
            + 'automatically take you back to the MAUI tab as soon as the server is available again.</p>'
            + renderRestartWaitScript('/maui')
            + '</section>',
            'maui', getViewer(req),
        ));

        // Delayed so this response finishes flushing before the session - this process included -
        // goes down.
        setTimeout(restartKiosk, 500);
    });

    // The Network card (NetworkBoCard.ts). Any BO account, like the restart above: joining the
    // Wi-Fi is part of setting a cabinet up.
    app.post('/maui/network/scan', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        await sendMauiPage(req, res, config, {networkRescan: true});
    });

    app.post('/maui/network/radio', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        const on = req.body.wifi === 'on';
        try {
            const state = await readNetworkState();
            if (!on && state && isWifiTheOnlyLink(state)) {
                throw new Error(ONLY_LINK_REASON);
            }
            await setWifiRadio(on);
        } catch (error) {
            await sendMauiPage(req, res, config, {networkError: `Wi-Fi not switched ${on ? 'on' : 'off'}: ${(error as Error).message}`});
            return;
        }
        await sendMauiPage(req, res, config, {networkInfo: `Wi-Fi switched ${on ? 'on' : 'off'}.`, networkRescan: on});
    });

    // Answers once the cabinet joined the network or gave up (WifiControl.ts connectWifi(), half a
    // minute at most). Reached over the Wi-Fi being left, the answer never arrives.
    app.post('/maui/network/connect', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        const ssid = typeof req.body.ssid === 'string' ? req.body.ssid : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        try {
            await connectWifi(ssid, password);
        } catch (error) {
            await sendMauiPage(req, res, config, {networkError: `Not connected to ${ssid}: ${(error as Error).message}`});
            return;
        }
        await sendMauiPage(req, res, config, {networkInfo: `Connected to ${ssid}.`});
    });

    app.post('/maui/network/forget', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        const uuid = typeof req.body.uuid === 'string' ? req.body.uuid : '';
        try {
            const state = await readNetworkState();
            if (state && isWifiTheOnlyLink(state) && state.saved.some(profile => profile.uuid === uuid && profile.active)) {
                throw new Error(ONLY_LINK_REASON);
            }
            await forgetWifi(uuid);
        } catch (error) {
            await sendMauiPage(req, res, config, {networkError: `Network not forgotten: ${(error as Error).message}`});
            return;
        }
        await sendMauiPage(req, res, config, {networkInfo: 'Network forgotten.'});
    });

    // The Bluetooth card (BluetoothBoCard.ts), same access as the Network card. A search and a
    // pairing answer once done: ten seconds for the first, up to a minute for the second.
    app.post('/maui/bluetooth/power', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        const on = req.body.bluetooth === 'on';
        try {
            await setBluetoothPower(on);
        } catch (error) {
            await sendMauiPage(req, res, config, {bluetoothError: `Bluetooth not switched ${on ? 'on' : 'off'}: ${(error as Error).message}`});
            return;
        }
        await sendMauiPage(req, res, config, {bluetoothInfo: `Bluetooth switched ${on ? 'on' : 'off'}.`});
    });

    app.post('/maui/bluetooth/scan', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        try {
            await sendMauiPage(req, res, config, {bluetoothFound: await scanBluetooth()});
        } catch (error) {
            await sendMauiPage(req, res, config, {bluetoothError: `Search failed: ${(error as Error).message}`});
        }
    });

    app.post('/maui/bluetooth/pair', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        const address = typeof req.body.address === 'string' ? req.body.address : '';
        const name = typeof req.body.name === 'string' && req.body.name ? req.body.name : address;
        try {
            const device = await pairBluetooth(address);
            await sendMauiPage(req, res, config, {
                bluetoothInfo: device.connected
                    ? `${name} paired and connected.`
                    : `${name} paired. It connects at its next key press.`,
            });
        } catch (error) {
            await sendMauiPage(req, res, config, {bluetoothError: `${name} not paired: ${(error as Error).message}`});
        }
    });

    app.post('/maui/bluetooth/remove', async (req, res) => {
        if (refuseCabinetSystemRequest(req, res)) {
            return;
        }
        const config = new Config();
        config.load();
        const address = typeof req.body.address === 'string' ? req.body.address : '';
        try {
            await removeBluetooth(address);
        } catch (error) {
            await sendMauiPage(req, res, config, {bluetoothError: `Device not forgotten: ${(error as Error).message}`});
            return;
        }
        await sendMauiPage(req, res, config, {bluetoothInfo: 'Device forgotten.'});
    });

    app.post('/screenscraper/save', (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const values: ScreenScraperValues = {
            ssDevId: (req.body.ssDevId || '').trim(),
            ssDevPassword: (req.body.ssDevPassword || '').trim(),
            ssSoftName: (req.body.ssSoftName || '').trim(),
            ssUserId: (req.body.ssUserId || '').trim(),
            ssUserPassword: (req.body.ssUserPassword || '').trim(),
            bezelAspect: req.body.bezelAspect === '4:3' ? '4:3' : '16:9',
        };

        const config = new Config(getSecretsKey(req));
        config.load();
        config.ssDevId = values.ssDevId;
        // Password fields are never pre-filled (see renderSavedPasswordAttributes()): left empty
        // means unchanged.
        config.ssDevPassword = values.ssDevPassword || config.ssDevPassword;
        config.ssSoftName = values.ssSoftName;
        config.ssUserId = values.ssUserId;
        config.ssUserPassword = values.ssUserPassword || config.ssUserPassword;
        config.bezelAspect = values.bezelAspect;
        config.save();

        res.send(renderScreenScraperPage(
            {...values, ssDevPassword: config.ssDevPassword, ssUserPassword: config.ssUserPassword},
            hasScreenScraperCredentials(config), undefined, 'ScreenScraper configuration saved.',
        ));
    });

    app.get('/browse', (req, res) => {
        const target: PathField = req.query.target === 'pluginsPath' ? 'pluginsPath' : 'mamePath';
        const carried: Record<PathField, string> = {
            mamePath: typeof req.query.mamePath === 'string' ? req.query.mamePath : '',
            pluginsPath: typeof req.query.pluginsPath === 'string' ? req.query.pluginsPath : '',
        };
        const initialValue = carried[target];

        let currentDir = typeof req.query.path === 'string' && req.query.path ? req.query.path : initialValue;
        if (!currentDir || !existsSync(currentDir)) {
            const config = new Config();
            config.load();
            if (target === 'mamePath') {
                currentDir = config.mamePath || os.homedir();
            } else {
                const iniPath = getMameHomePath();
                const pluginsPath = getMameIniValue(join(iniPath, 'mame.ini'), 'pluginspath');
                currentDir = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : os.homedir();
            }
        }
        if (!existsSync(currentDir)) {
            currentDir = os.homedir();
        }

        res.send(renderBrowsePage(target, currentDir, carried, getViewer(req), req.query.from === 'setup' ? '/setup' : '/'));
    });

    /**
     * Checks and saves the folder of the mame binary (MAME tab's Config card, and the setup guide's
     * mame step): creates mame's configuration the first time, then writes pluginspath and the
     * window setting into mame.ini. Nothing is saved on an error.
     */
    const applyMameConfig = (
        config: Config, mamePath: string, pluginsPath: string, windowed: boolean,
    ): {error: string} | {plugins: {saved: boolean; pluginsAdded: number} | null} => {
        if (!existsSync(mamePath)) {
            return {error: `The folder "${mamePath}" does not exist.`};
        }
        const mameBinaryName = findMameBinary(mamePath);
        if (!mameBinaryName) {
            return {error: `No mame binary found in "${mamePath}".`};
        }
        try {
            ensureMameConfigBootstrapped(join(mamePath, mameBinaryName), getMameHomePath());
        } catch (error) {
            return {
                error: 'Failed to initialize mame ("-createconfig"): '
                    + `${error instanceof Error ? error.message : 'unexpected error'}.`,
            };
        }
        // mame.ini exists from here on (ensureMameConfigBootstrapped() above).
        const plugins = pluginsPath ? savePluginsPath(pluginsPath) : null;
        setMameIniValue(join(getMameHomePath(), 'mame.ini'), 'window', windowed ? '1' : '0');
        config.mamePath = mamePath;
        config.mameBinaryName = mameBinaryName;
        config.save();
        return {plugins};
    };

    app.post('/save', (req, res) => {
        const mamePath: string = (req.body.mamePath || '').trim();
        const pluginsPath: string = (req.body.pluginsPath || '').trim();
        // "Launch MAME fullscreen" checkbox: unchecked = windowed (mame.ini's window 1). Only
        // posted while the binary folder is filled in (disabled otherwise, see renderConfigCard()).
        const windowed = req.body.fullscreen !== 'on';
        const config = new Config();
        config.load();
        const isAdvanced = req.session.boAdvanced === true;
        // On an error below, the page comes back with what was typed in both fields.
        const typedMameInfo = () => {
            const mameInfo = getMameInfo(config);
            if (pluginsPath) {
                mameInfo.pluginsPath = pluginsPath;
            }
            if (mamePath) {
                mameInfo.windowed = windowed;
            }
            return mameInfo;
        };

        const applied = applyMameConfig(config, mamePath, pluginsPath, windowed);
        if ('error' in applied) {
            res.status(422).send(renderForm({mamePath}, typedMameInfo(), isAdvanced, applied.error));
            return;
        }
        const {plugins} = applied;

        res.send(renderPage(
            '<section class="card"><h2>Configuration saved</h2><p>'
            + 'The application restarts automatically.</p>'
            + (plugins?.pluginsAdded ? `<p>${plugins.pluginsAdded} plugin(s) initialized in plugin.ini.</p>` : '')
            + (plugins && !plugins.saved ? '<p class="error">The plugins folder could not be saved: mame.ini not found.</p>' : '')
            + '<p>Back to the MAME configuration in <span id="redirect-countdown">5</span> '
            + 'second(s)… <a href="/">Go now</a>.</p></section>'
            + '<script>'
            + 'var secondsLeft = 5;'
            + 'var countdownEl = document.getElementById("redirect-countdown");'
            + 'setInterval(function () {'
            + 'secondsLeft -= 1;'
            + 'countdownEl.textContent = Math.max(secondsLeft, 0);'
            + '}, 1000);'
            + 'setTimeout(function () { window.location.href = "/"; }, 5000);'
            + '</script>',
            'mame', getViewer(req),
        ));

        reloadFront();
    });

    /**
     * Writes pluginspath into mame.ini and, as soon as it points at a folder that actually has
     * plugins in it, initializes/completes plugin.ini right away instead of making the user click
     * the separate "Repair plugin.ini" button as a second step. saved: false when mame.ini
     * doesn't exist.
     */
    const savePluginsPath = (pluginsPath: string): {saved: boolean; pluginsAdded: number} => {
        const iniPath = getMameHomePath();
        const saved = setMameIniValue(join(iniPath, 'mame.ini'), 'pluginspath', pluginsPath);
        const availablePlugins = getAvailablePlugins(resolveDirectoryPath(pluginsPath, iniPath));
        const pluginsAdded = saved && availablePlugins.length
            ? repairPluginIni(join(iniPath, 'plugin.ini'), availablePlugins)
            : 0;
        return {saved, pluginsAdded};
    };

    app.post('/mame-options/repair-plugins', (req, res) => {
        const config = new Config();
        config.load();

        const iniPath = getMameHomePath();
        const mameIniPath = join(iniPath, 'mame.ini');
        const pluginIniPath = join(iniPath, 'plugin.ini');
        const pluginsPath = getMameIniValue(mameIniPath, 'pluginspath');
        const resolvedPluginsPath = pluginsPath ? resolveDirectoryPath(pluginsPath, iniPath) : null;
        const added = repairPluginIni(pluginIniPath, getAvailablePlugins(resolvedPluginsPath));

        res.send(renderForm(
            {mamePath: config.mamePath},
            getMameInfo(config), req.session.boAdvanced === true,
            undefined,
            undefined,
            added
                ? `${added} plugin(s) added to plugin.ini (mame default values).`
                : 'Nothing to repair: plugin.ini already contains all the detected plugins (or no plugin was found - check the plugins folder below).',
        ));
    });

    app.post('/input-probe/devices', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romName = romNames[0];

        if (mameInfo.error || !romName) {
            // Shouldn't normally be reachable - the form only renders once mameInfo.error is unset
            // and at least one rom exists, but the config could have changed underneath a stale
            // form submission (e.g. mamePath cleared in another tab/request).
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
            ));
            return;
        }

        try {
            const result = runDeviceProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
            res.send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, undefined, undefined, undefined, undefined,
                {result},
            ));
        } catch (error) {
            console.error('[boServer] Device probe failed:', error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderForm(
                {mamePath: config.mamePath}, mameInfo, isAdvanced,
                undefined, undefined, undefined, undefined, undefined,
                {error: `Device probe failed: ${message} (timeout, non-zero exit code, or binary not found).`},
            ));
        }
    });

    // Pins (or with an empty joycode, unpins) a detected device to a fixed JOY number in the
    // controller file (see getCtrlrFile()), then probes again so the cards show MAME's new numbering.
    app.post('/input-probe/devices/pin', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;
        const renderWith = (state: DeviceProbeState, status = 200) => res.status(status).send(renderForm(
            {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
            undefined, undefined, undefined, undefined, undefined,
            state,
        ));

        const deviceId = typeof req.body.deviceId === 'string' ? req.body.deviceId : '';
        const joycode = typeof req.body.joycode === 'string' ? req.body.joycode : '';
        const romName = mameInfo.romPath ? listRomNames(mameInfo.romPath)[0] : undefined;
        if (mameInfo.error || !romName || !config.mamePath || !config.mameBinaryName) {
            // Same "shouldn't normally be reachable" caveat as /input-probe/devices above.
            renderWith({error: 'No valid MAME configuration saved: unable to launch MAME.'}, 422);
            return;
        }
        if (!deviceId || (joycode && !/^JOYCODE_\d+$/.test(joycode))) {
            renderWith({error: 'Invalid device or JOY number.'}, 400);
            return;
        }

        try {
            pinDevice(mameInfo, deviceId, joycode || null);
        } catch (error) {
            console.error('[boServer] Device pin failed:', error);
            renderWith({error: `Could not write the controller file: ${error instanceof Error ? error.message : 'unexpected error'}.`}, 500);
            return;
        }
        const info = joycode
            ? `Pinned as JOY ${joycodeNumber(joycode)} (${getCtrlrFile(mameInfo).path}).`
            : 'Unpinned: MAME numbers this device in detection order again.';
        try {
            renderWith({result: runDeviceProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName), info});
        } catch (error) {
            console.error('[boServer] Device probe failed:', error);
            renderWith({info, error: `Device probe failed: ${error instanceof Error ? error.message : 'unexpected error'}.`}, 500);
        }
    });

    app.post('/input-probe/mame/start', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        // MAME only runs the capture script (-autoboot_script) once a machine is running - opened
        // on its own menu, with no rom, it never does (checked against 0.289) - so the session
        // needs a rom, any of them: default.cfg is global.
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        const romName = romNames[0];
        if (mameInfo.error || !romName) {
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
                mameInfo.error
                    ? 'No valid MAME configuration saved: unable to launch MAME.'
                    : 'No rom found in the roms folder - MAME needs at least one to launch.',
            ));
            return;
        }

        // A stale page (MAME launched from MAUI since it was rendered): re-rendered with "Close
        // MAME" rather than opening a second MAME.
        if (findOtherMameProcesses(config).length === 0) {
            startMameConfigSession(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
        }
        res.send(renderForm({mamePath: config.mamePath}, mameInfo, isAdvanced));
    });

    // Polled by the page while a config session runs (see renderPageTail()), so it notices MAME
    // being closed from its own window.
    app.get('/input-probe/mame/status', (req, res) => {
        const config = new Config();
        config.load();
        res.json({running: isAnyMameRunning(config)});
    });

    app.post('/input-probe/mame/stop', async (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        // Awaited so the page below no longer finds them and shows "Launch MAME". A game launched
        // from MAUI gets the same SIGQUIT as its own stopGame(), so MAUI still saves its hiscores.
        await stopEveryMame(config);

        res.send(renderForm({mamePath: config.mamePath}, mameInfo, isAdvanced));
    });

    // "Apply controls" (see renderForm()): same game, fresh start, so the saved bindings apply.
    app.post('/input-probe/mame/restart', async (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romName = isMameConfigSessionAlive() ? mameConfigSession?.romName : undefined;
        if (!romName || mameInfo.error) {
            res.send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }
        await stopEveryMame(config);
        startMameConfigSession(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
        waitForSessionGameFields(10000);
        res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName}));
    });

    // MAUI > Controls: add an input to one of MAUI's keys (a gamepad press caught by the front, a key
    // or mouse button caught by the page), remove one (a pill's cross posts `remove`), or reset.
    app.post('/maui/controls', async (req, res) => {
        const config = new Config();
        config.load();
        const key: string = (req.body.key || '').trim();
        const removed: string = typeof req.body.remove === 'string' ? req.body.remove : '';
        const action: string = removed ? 'remove' : (req.body.action || '').trim();
        const send = (controls: MauiControlsState) => sendMauiPage(req, res, config, {controls});
        if (!MAUI_ACTIONS.some(known => known.key === key) || !['capture', 'add', 'remove', 'reset'].includes(action)) {
            res.status(422);
            await send({key, error: 'Unknown action.'});
            return;
        }

        let bindings = readMauiBindings();
        let info: string | undefined;
        let caughtByPage = false;
        if (action === 'reset') {
            bindings = resetKey(bindings, key);
        } else if (action === 'remove') {
            const input = parseMauiInputId(removed);
            // Only an input the card showed for this key.
            if (!input || !inputsOfKey(bindings, key).some(shown => mauiInputId(shown) === removed)) {
                await send({key});
                return;
            }
            bindings = removeInput(bindings, input);
        } else {
            let input: MauiInput | undefined;
            if (action === 'add') {
                input = parseMauiInputId(String(req.body.code || ''));
                if (!input) {
                    await send({key, error: 'Not a key, a mouse button or a gamepad input.'});
                    return;
                }
                if (input.device === 'pad') {
                    // Caught by the page itself (the gamepad plugged in the computer it runs on):
                    // the front stops waiting once it is saved. The pad's own layout, as the front
                    // picks it, else the standard one: the page can't make up a layout.
                    caughtByPage = true;
                    input = {...input, layout: bindings.pads[input.layout] ? input.layout : 'standard'};
                }
            } else {
                const caught = await frontControls.capturePad(30000);
                // The page caught the press and posted it on its own: the card as it now is, the
                // browser showing whichever of both answers comes last.
                if ('cancelled' in caught) {
                    await send({key});
                    return;
                }
                if ('error' in caught) {
                    await send({key, error: caught.error});
                    return;
                }
                input = caught.axis !== undefined
                    ? {device: 'pad', layout: caught.layout, axis: caught.axis, direction: caught.direction ?? 0}
                    : {device: 'pad', layout: caught.layout, button: caught.button ?? 0};
            }
            const added = addInput(bindings, key, input);
            bindings = added.bindings;
            if (added.takenFrom) {
                info = `${describeMauiInput(input)} was used for ${mauiActionLabel(added.takenFrom)}: it now does ${mauiActionLabel(key)} only.`;
            }
        }
        try {
            writeFileSync(getMauiControlsPath(), serializeMauiBindings(bindings), 'utf8');
        } catch (error) {
            await send({key, error: `Saving failed: ${(error as Error).message}`});
            return;
        }
        frontControls.controlsChanged();
        if (caughtByPage) {
            frontControls.cancelCapture();
        }
        await send({key, info});
    });

    // The Hotkeys card (renderHotkeysCard()): its step by step "Add a hotkey" (each step posts the
    // draft, "catch" / "capture1|2" fill a key in with the input caught by the page, or by the front
    // within 30 s), then "add" saves it; "remove" and "reset" act on the list.
    app.post('/maui/hotkeys', async (req, res) => {
        const config = new Config();
        config.load();
        const action: string = typeof req.body.action === 'string' ? req.body.action : 'step';
        const field = (name: string): string => (typeof req.body[name] === 'string' ? req.body[name].trim() : '');
        const draft: HotkeyDraft = {
            action: field('hotkeyAction'),
            type: field('type'),
            keys: [field('key1'), field('key2')],
            holdSeconds: field('holdSeconds'),
        };
        // A key pressed, not held: nothing to ask about how long.
        if (draft.type === 'press') {
            draft.holdSeconds = '0';
        }
        const send = (hotkeys: HotkeysState) => sendMauiPage(req, res, config, {hotkeys});
        let bindings = readMauiBindings();
        let info: string | undefined;

        if (action === 'start') {
            await send({draft: EMPTY_HOTKEY_DRAFT});
            return;
        }
        if (action === 'cancel') {
            await send({});
            return;
        }
        if (action === 'back') {
            await send({draft: previousHotkeyDraft(draft)});
            return;
        }
        if (action === 'step') {
            if (draft.keys[1] && draft.keys[1] === draft.keys[0]) {
                draft.keys[1] = '';
                await send({draft, error: 'The second key must be another one.'});
                return;
            }
            await send({draft});
            return;
        }
        if (action === 'catch' || action === 'capture1' || action === 'capture2') {
            const slot = action === 'catch' ? Number(field('slot')) : Number(action.slice(-1));
            if (slot !== 1 && slot !== 2) {
                await send({draft, error: 'Unknown key.'});
                return;
            }
            let input: MauiInput | undefined;
            if (action === 'catch') {
                input = parseMauiInputId(field('code'));
                if (input?.device === 'pad') {
                    // Caught by the page itself: the front stops waiting.
                    input = {...input, layout: bindings.pads[input.layout] ? input.layout : 'standard'};
                    frontControls.cancelCapture();
                }
            } else {
                const caught = await frontControls.capturePad(30000);
                if ('cancelled' in caught) {
                    await send({draft});
                    return;
                }
                if ('error' in caught) {
                    await send({draft, error: caught.error});
                    return;
                }
                input = caught.axis !== undefined
                    ? {device: 'pad', layout: caught.layout, axis: caught.axis, direction: caught.direction ?? 0}
                    : {device: 'pad', layout: caught.layout, button: caught.button ?? 0};
            }
            if (!input) {
                await send({draft, error: 'Not a key, a mouse button or a gamepad input.'});
                return;
            }
            const id = mauiInputId(input);
            if (slot === 2 && id === draft.keys[0]) {
                await send({draft, error: 'The second key must be another one.'});
                return;
            }
            draft.keys[slot - 1] = id;
            await send({draft});
            return;
        }

        if (action === 'add') {
            const hotkey = draftHotkey(draft);
            if (!hotkey) {
                await send({draft, error: `A hotkey is an action, one or two different keys, and a hold of 0 to ${MAX_HOLD_MS / 1000} seconds.`});
                return;
            }
            if (bindings.hotkeys.some(known => sameHotkey(known, hotkey))) {
                await send({draft, error: 'This hotkey is already there.'});
                return;
            }
            info = describeHotkeyTakeover(bindings, hotkey);
            // One input pressed, not held: it only triggers the hotkey (an input does one thing).
            const input = hotkey.keys.length === 1 && hotkey.holdMs === 0 ? parseMauiInputId(hotkey.keys[0]) : undefined;
            if (input && keyOfInput(bindings, input)) {
                bindings = removeInput(bindings, input);
            }
            bindings = {...bindings, hotkeys: [...bindings.hotkeys, hotkey]};
        } else if (action === 'remove') {
            const index = Number(field('index'));
            if (!Number.isInteger(index) || index < 0 || index >= bindings.hotkeys.length) {
                await send({});
                return;
            }
            bindings = {...bindings, hotkeys: bindings.hotkeys.filter((_, at) => at !== index)};
        } else if (action === 'reset') {
            bindings = {...bindings, hotkeys: defaultHotkeys()};
        } else {
            res.status(422);
            await send({error: 'Unknown action.'});
            return;
        }
        try {
            writeFileSync(getMauiControlsPath(), serializeMauiBindings(bindings), 'utf8');
        } catch (error) {
            await send({draft, error: `Saving failed: ${(error as Error).message}`});
            return;
        }
        frontControls.controlsChanged();
        await send({info: info ? `Saved. ${info}` : 'Saved.'});
    });

    // The Spinner, trackball, paddle card: mame.ini's <family>_device values.
    app.post('/input-probe/analog-devices', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;
        const renderWith = (state: AnalogDevicesState, status = 200) => res.status(status).send(renderForm(
            {mamePath: config.mamePath}, mameInfo, isAdvanced,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            state,
        ));
        if (mameInfo.error) {
            res.status(422).send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }
        const changes = ANALOG_DEVICE_OPTIONS.map(option => [option.key, String(req.body[option.key] ?? '').trim()] as const);
        // Ours, or the value already there (kept by the card when set by hand).
        const invalid = changes.find(([key, value]) => !ANALOG_DEVICE_VALUES.some(known => known.value === value)
            && value !== getMameIniValue(mameInfo.mameIniPath, key));
        if (invalid) {
            renderWith({error: `Unknown device "${invalid[1]}".`}, 422);
            return;
        }
        for (const [key, value] of changes) {
            if (!setMameIniValue(mameInfo.mameIniPath, key, value)) {
                renderWith({error: `"${mameInfo.mameIniPath}" not found.`}, 500);
                return;
            }
        }
        renderWith({saved: true});
    });

    // Reads MAME's own controls for the Controls card (see runInputDefaultsProbe()).
    app.post('/input-probe/controls/defaults', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;
        const romName = mameInfo.romPath ? listRomNames(mameInfo.romPath)[0] : undefined;
        const renderWith = (remapState?: RemapState) => renderForm(
            {mamePath: config.mamePath}, mameInfo, isAdvanced,
            undefined, undefined, undefined, undefined, undefined,
            undefined,
            remapState ?? {portType: ''},
        );

        if (mameInfo.error || !romName) {
            // Same "stale form" case as /input-probe/devices.
            res.status(422).send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }
        try {
            runInputDefaultsProbe(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName);
            res.send(renderWith());
        } catch (error) {
            console.error('[boServer] Reading MAME\'s controls failed:', error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderWith({portType: '', error: `Reading MAME's controls failed: ${message}`}));
        }
    });

    // One action of the Controls card: add a control (pressed, or picked from MAME's keys and mouse
    // buttons), remove one (its cross posts `remove`), or go back to MAME's default.
    app.post('/input-probe/remap', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const portType: string = (req.body.portType || '').trim();
        const action = REMAP_ACTIONS_BY_TYPE.get(portType);
        const removed: string = typeof req.body.remove === 'string' ? req.body.remove.trim() : '';
        const formAction: string = removed ? 'remove' : (req.body.action || '').trim();
        const defaults = config.mamePath ? readInputDefaults(join(config.mamePath, config.mameBinaryName)) : undefined;

        if (mameInfo.error || !action || !['capture', 'add', 'remove', 'reset'].includes(formAction)) {
            // mameInfo.error: same "shouldn't normally be reachable" caveat as /input-probe/devices
            // above - the form only renders once mameInfo.error is unset. !action: portType isn't in
            // REMAP_ACTIONS_BY_TYPE - only reachable by posting outside the rendered form, since
            // every form's hidden portType field is one of ours.
            res.status(422).send(renderForm(
                {mamePath: config.mamePath || ''}, mameInfo, isAdvanced,
            ));
            return;
        }
        const renderWith = (remapState: RemapState, status = 200) => res.status(status).send(renderForm(
            {mamePath: config.mamePath}, mameInfo, isAdvanced,
            undefined, undefined, undefined, undefined, undefined,
            undefined,
            remapState,
        ));
        // The MAME binary changed since the page was rendered: its controls must be read again.
        if (!defaults) {
            renderWith({portType: '', error: 'MAME\'s controls must be read again first.'}, 409);
            return;
        }

        const cfgPath = getDefaultCfgPath(mameInfo.iniPath);
        try {
            const persisted = readDefaultCfgUiInputs(cfgPath);
            const current = getControlSeq(portType, persisted, defaults);

            if (formAction === 'reset') {
                applyCfgEdit(() => removeDefaultCfgUiInput(cfgPath, portType));
                renderWith({portType});
                return;
            }
            if (formAction === 'remove') {
                // Only what the card showed: a value posted from elsewhere changes nothing.
                if (seqAlternatives(current).includes(seqAlternatives(removed).join(' '))) {
                    saveControlSeq(cfgPath, portType, removeSeqAlternative(current, removed), defaults);
                }
                renderWith({portType});
                return;
            }

            let token: string | null;
            if (formAction === 'add') {
                const code: string = (req.body.code || '').trim();
                // Only a token MAME itself listed: one it doesn't know would make it drop the whole
                // <input> block of default.cfg.
                if (!defaults.codes.has(code)) {
                    renderWith({portType, error: 'MAME has no such key or mouse button.'});
                    return;
                }
                token = code;
            } else {
                // Only reachable from a page rendered before MAME was closed.
                if (!getCaptureTarget()) {
                    renderWith({portType, error: 'MAME is not running - click "Launch MAME" first.'});
                    return;
                }
                token = captureOnePress();
                if (!token) {
                    renderWith({portType, error: 'No press detected within the allotted time (30s) - try again ' +
                        '(is MAME still open? A key or a mouse button needs its window in front).'});
                    return;
                }
            }

            const sharedWith = findControlsSharing(portType, token, persisted, defaults);
            saveControlSeq(cfgPath, portType, addSeqAlternative(current, token), defaults);
            const releasedFrom = releaseTokenFromInGameUiPorts(cfgPath, portType, token, defaults);
            renderWith({
                portType,
                // Already told by releasedFrom: the action it was taken away from.
                sharedWith: sharedWith.filter(label => !releasedFrom.some(port => REMAP_ACTIONS_BY_TYPE.get(port)?.label === label)),
                releasedFrom,
            });
        } catch (error) {
            console.error(`[boServer] Controls ${formAction} failed for "${portType}":`, error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            renderWith({portType, error: `Saving failed: ${message}`}, 500);
        }
    });

    // Renders the whole page with only the per-game remap state set (renderForm() has a long
    // positional list - see /input-probe/remap above).
    const renderGameRemapPage = (config: Config, mameInfo: MameInfo, isAdvanced: boolean, gameRemapState: GameRemapState): string =>
        renderForm(
            {mamePath: config.mamePath}, mameInfo, isAdvanced,
            undefined, // error
            undefined, // info
            undefined, // mameInfoMessage
            undefined, // importError
            undefined, // dangerZoneInfo
            undefined, // deviceProbeState
            undefined, // remapState
            gameRemapState,
        );

    app.post('/input-probe/game/start', async (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romName: string = (req.body.romName || '').trim();
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        if (mameInfo.error || !romNames.includes(romName)) {
            // Same "shouldn't normally be reachable" caveat as /input-probe/devices above - the
            // form only renders once mameInfo.error is unset, with a select of the roms actually present.
            res.status(422).send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }

        // Always a fresh start, even on the game already running: that's how a capture made in it
        // takes effect (see hasPendingCfgEdits()), and a game launched from MAUI has no capture
        // script to talk to.
        await stopEveryMame(config);
        startMameConfigSession(join(config.mamePath, config.mameBinaryName), mameInfo.iniPath, romName, true);
        waitForSessionGameFields(10000);
        res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName}));
    });

    app.post('/input-probe/game/remap', (req, res) => {
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);
        const isAdvanced = req.session.boAdvanced === true;

        const romName: string = (req.body.romName || '').trim();
        const fieldId: string = (req.body.fieldId || '').trim();
        // A pill's cross posts `remove` (the alternative to drop) instead of an action.
        const removed: string = typeof req.body.remove === 'string' ? req.body.remove.trim() : '';
        const action: string = removed ? 'remove' : (req.body.action || '').trim();
        // Which of the command's sequences (the axis and the two keys of an analog control).
        const seqType = GAME_SEQ_TYPES.find(type => type === (req.body.seqType || 'standard'));
        const romNames = mameInfo.romPath ? listRomNames(mameInfo.romPath) : [];
        // romName is only ever used to build cfg/<romName>.cfg below, so it has to be one of the
        // roms actually present - never a client-supplied path fragment.
        if (mameInfo.error || !romNames.includes(romName) || !seqType
            || !['capture', 'capture-axis', 'add', 'remove', 'reset'].includes(action)) {
            res.status(422).send(renderForm({mamePath: config.mamePath || ''}, mameInfo, isAdvanced));
            return;
        }

        // The field is looked up in what MAME itself dumped for the running game: its tag/mask/
        // defvalue are what the cfg entry needs to be applied, and none of it comes from the client.
        refreshAdoptedMame(config, romNames);
        const field = getCaptureTarget()?.romName === romName
            ? readSessionGameFields()?.find(candidate => gameFieldId(candidate) === fieldId)
            : undefined;
        if (!field) {
            res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {
                romName,
                error: `MAME is not running with "${romName}" (or doesn't know this command) - launch it again below.`,
            }));
            return;
        }

        // An axis is only captured for an analog control's movement, and only an analog control
        // has keys of its own for each way: anything else was posted outside the card.
        const axis = !!field.analog && seqType === 'standard';
        if ((seqType !== 'standard' && !field.analog) || (action === 'capture-axis') !== (axis && action.startsWith('capture'))
            || (axis && action === 'add')) {
            res.status(422).send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName, fieldId, error: 'Not possible for this command.'}));
            return;
        }
        const defaults = config.mamePath ? readInputDefaults(join(config.mamePath, config.mameBinaryName)) : undefined;
        try {
            const cfgPath = getGameCfgPath(mameInfo.iniPath, romName);
            const overrides = readGameCfgOverrides(cfgPath, seqType);
            // What the command uses now: the game's own sequence, else what it inherits (the
            // global controls, as MAME reported them for this field when it started).
            const current = overrides.get(fieldId) ?? getInheritedGameSeq(field, seqType);
            const inherited = seqFromAlternatives(seqAlternatives(getInheritedGameSeq(field, seqType)));
            // Saves `seq` for this game, live in the running MAME too - or drops the game's own
            // entry when `seq` is what it inherits anyway.
            const save = (seq: string) => {
                const normalized = seqFromAlternatives(seqAlternatives(seq));
                if (normalized === inherited) {
                    const live = applyGameFieldLive(field, '', seqType);
                    applyCfgEdit(() => removeGameCfgOverride(cfgPath, field, seqType), live);
                } else {
                    const live = applyGameFieldLive(field, normalized, seqType);
                    applyCfgEdit(() => setGameCfgOverride(cfgPath, romName, field, normalized, seqType), live);
                }
            };

            if (action === 'reset') {
                const live = applyGameFieldLive(field, '', seqType);
                applyCfgEdit(() => removeGameCfgOverride(cfgPath, field, seqType), live);
                res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName, fieldId}));
                return;
            }
            if (action === 'remove') {
                // Only what the card showed: a value posted from elsewhere changes nothing.
                if (seqAlternatives(current).includes(seqAlternatives(removed).join(' '))) {
                    save(removeSeqAlternative(current, removed));
                }
                res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName, fieldId}));
                return;
            }

            let token: string | null;
            if (action === 'add') {
                const code: string = (req.body.code || '').trim();
                // Same rule as the global card: only a token MAME itself listed.
                token = defaults?.codes.has(code) ? code : null;
                if (!token) {
                    res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {
                        romName, fieldId, error: 'MAME has no such key or mouse button.',
                    }));
                    return;
                }
            } else {
                token = captureOnePress(axis);
                if (!token) {
                    res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {
                        romName, fieldId, error: axis
                            ? 'No movement detected within the allotted time (30s) - try again (turn the spinner, move the '
                                + 'mouse or push the stick well after clicking; is MAME still open?).'
                            : 'No press detected within the allotted time (30s) - try again '
                                + '(is the gamepad connected, and MAME still open?).',
                    }));
                    return;
                }
            }

            save(addSeqAlternative(current, token));
            if (axis) {
                // An axis triggers no other command: nothing shared, nothing to release.
                res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName, fieldId}));
                return;
            }
            // Every sequence of the game's other commands, its own or inherited.
            const allOverrides = new Map(GAME_SEQ_TYPES.map(type => [type, readGameCfgOverrides(cfgPath, type)]));
            const sharedWith = (readSessionGameFields() ?? [])
                .filter(other => gameFieldId(other) !== fieldId && GAME_SEQ_TYPES.some(type =>
                    seqAlternatives(allOverrides.get(type)?.get(gameFieldId(other)) ?? getInheritedGameSeq(other, type)).includes(token)))
                .map(other => other.name || other.portType);
            const releasedFrom = releaseTokenFromInGameUiPorts(getDefaultCfgPath(mameInfo.iniPath), field.portType, token, defaults);
            res.send(renderGameRemapPage(config, mameInfo, isAdvanced, {romName, fieldId, sharedWith, releasedFrom}));
        } catch (error) {
            console.error(`[boServer] Game controls ${action} failed for "${romName}" / "${field.portType}":`, error);
            const message = error instanceof Error ? error.message : 'unexpected error';
            res.status(500).send(renderGameRemapPage(config, mameInfo, isAdvanced, {
                romName,
                fieldId,
                error: `Saving failed: ${message}`,
            }));
        }
    });

    app.post('/reset', async (req, res) => {
        if (!req.session.boAdvanced) {
            res.status(403).send('Available in Advanced configuration only.');
            return;
        }
        const config = new Config();
        config.load();
        const mameInfo = getMameInfo(config);

        // Each danger-zone card (renderMameDangerZoneCard/renderMauiDangerZoneCard) posts its
        // own hidden "zone" field alongside only its own checkboxes - gating on it here means a
        // MAME-zone submission can only ever delete MAME's own data, and a maui-zone submission
        // only mame-awesome-ui's own, regardless of what a request might otherwise contain.
        const zone = req.body.zone === 'maui' ? 'maui' : 'mame';

        // deleteMameHome wipes mameInfo.iniPath (~/.mame) wholesale, which already contains
        // everything deleteHiscores/deleteGamesMedia/deleteFavorites would otherwise remove - so
        // those are skipped when it's checked, rather than redundantly rm'ing paths about to
        // disappear anyway (the danger-zone card's onchange also ticks+disables them when this
        // one is checked, purely to communicate that they're included).
        const deleteMameHome = zone === 'mame' && req.body.deleteMameHome === 'on';
        const deleteHiscores = zone === 'mame' && !deleteMameHome && req.body.deleteHiscores === 'on';
        const deleteGamesMedia = zone === 'mame' && !deleteMameHome && req.body.deleteGamesMedia === 'on';
        const deleteFavorites = zone === 'mame' && !deleteMameHome
            && req.body.deleteFavorites === 'on' && !!mameInfo.favoritesPath;
        // The whole ~/.mame-awesome-ui includes every part: its own checkbox greys theirs, which a
        // browser then leaves out of the form.
        const deleteMauiHome = zone === 'maui' && req.body.deleteMauiHome === 'on';
        const mauiParts = zone === 'maui' && !deleteMauiHome
            ? MAUI_DELETIONS.filter(deletion => req.body[deletion.field] === 'on').map(deletion => deletion.part)
            : [];

        const deleted: string[] = [];

        if (deleteMameHome) {
            try {
                rmSync(mameInfo.iniPath, {recursive: true, force: true});
                deleted.push(
                    `the whole ${mameInfo.iniPath} directory and its content (configuration, roms, media, `
                    + 'hiscores, cfg, nvram, snapshots...)',
                );
            } catch (error) {
                console.error(`[boServer] Failed to remove mame home directory "${mameInfo.iniPath}":`, error);
            }
        }

        if (deleteHiscores) {
            try {
                rmSync(getHiscorePath(mameInfo.iniPath), {recursive: true, force: true});
                deleted.push('the hiscores');
            } catch (error) {
                console.error('[boServer] Failed to remove hiscore directory:', error);
            }
        }

        if (deleteGamesMedia) {
            [mameInfo.romPath, mameInfo.marqueePath, mameInfo.flyerPath, mameInfo.logoPath].forEach((gamesPath) => {
                if (!gamesPath) {
                    return;
                }
                try {
                    rmSync(gamesPath, {recursive: true, force: true});
                } catch (error) {
                    console.error(`[boServer] Failed to remove games directory "${gamesPath}":`, error);
                }
            });
            deleted.push('the games roms and media (roms, marquees, flyers, logos)');
        }

        if (deleteFavorites) {
            try {
                // Cast: gated above on !!mameInfo.favoritesPath.
                rmSync(mameInfo.favoritesPath as string, {force: true});
                deleted.push('the favorites file (favorites.ini)');
            } catch (error) {
                console.error('[boServer] Failed to remove favorites.ini:', error);
            }
        }

        // Every file of each part ticked, as the export takes them (MauiBackup.ts).
        if (deleteMauiHome) {
            const mauiHome = dirname(config.configPath);
            try {
                rmSync(mauiHome, {recursive: true, force: true});
                deleted.push(`the whole ${mauiHome} directory and its content (configuration, database, avatars, `
                    + 'caches, ONLINE session...)');
            } catch (error) {
                console.error(`[boServer] Failed to remove mame-awesome-ui directory "${mauiHome}":`, error);
            }
        }

        let mauiDeleted: BackupPartId[] = [];
        if (mauiParts.length) {
            try {
                const parts = deleteBackupParts(dirname(config.configPath), mauiParts);
                mauiDeleted = parts.map(part => part.id);
                deleted.push(...parts.map(part => part.label));
            } catch (error) {
                console.error('[boServer] Failed to remove mame-awesome-ui files:', error);
            }
        }

        if (!deleted.length) {
            if (zone === 'mame') {
                res.send(renderForm(
                    {mamePath: config.mamePath || ''}, mameInfo, true,
                    undefined, undefined, undefined, undefined,
                    'No box ticked: nothing to delete.',
                ));
            } else {
                await sendMauiPage(req, res, config, {dangerZoneInfo: 'No box ticked: nothing to delete.'});
            }
            return;
        }

        // Config/database deletion invalidates the renderer's long-lived Vuex store instances
        // (see store.ts's initServices), same reason the previous all-in-one reset always
        // closed the app - only a full process restart clears that in-memory state. Hiscores
        // and media are just files/directories MameService/HiscoreService re-resolve on every
        // access, so those two don't need it. deleteMameHome does need it too: it takes
        // mame.ini/ui.ini down with it, and MameService's constructor only ever parses those
        // once, at app startup - a restart is what makes it re-bootstrap them from scratch.
        // The ONLINE session too: the running one keeps its credentials in memory.
        const needsRestart = deleteMameHome || deleteMauiHome
            || mauiDeleted.some(part => part === 'config' || part === 'database' || part === 'online');
        const backHref = zone === 'mame' ? '/' : '/maui';
        const deletedInfo = `Deleted: ${deleted.join(', ')}.`;

        // No restart needed (hiscores/games media/favorites) - land back on the zone's own page
        // with an inline message, same as every other action in the BO (renderForm/
        // renderMauiPage's own info params), instead of a dead-end page whose only affordance is
        // a "Retour" link. The dead-end + auto-reconnect page below is reserved for the case
        // where the process is actually about to exit and there's nothing else to show yet.
        if (!needsRestart) {
            if (zone === 'mame') {
                res.send(renderForm(
                    {mamePath: config.mamePath || ''}, mameInfo, true,
                    undefined, undefined, undefined, undefined, deletedInfo,
                ));
            } else {
                await sendMauiPage(req, res, config, {dangerZoneInfo: deletedInfo});
            }
            return;
        }

        res.send(renderPage(
            '<section class="card"><h2>Deletion complete</h2>'
            + `<p class="error">${deletedInfo}</p>`
            + await renderRelaunchNotice('complete the operation', backHref)
            + '</section>',
            zone, getViewer(req),
        ));

        // Closes the app, which comes back as renderRelaunchNotice() said (onReset in
        // background.ts). Delayed slightly so this response finishes flushing to the browser
        // before the process exits.
        setTimeout(onReset, 300);
    });

    return {
        handler: app,
        isBusy: () => isMameConfigSessionAlive() || (!!adoptedMame && isProcessAlive(adoptedMame.pid)),
        dispose: () => {
            // The sessions go with `app` itself; these are the module's own, which outlive it.
            romLabelsCache = undefined;
            releasesCache = null;
            directorySizeCache.clear();
        },
    };
}
