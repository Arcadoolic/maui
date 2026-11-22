import {existsSync} from 'fs';
import {join} from 'path';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import {type HiscoreReport, inspectHiscores, readHiscoreDatSizes, type StoredScore} from '@/class/HiscoreInspector';
import {getMameIniValue, resolveDirectoryPath} from '@/class/MameLocations';
import {buildDiagnosticBundle, type DiagnosticBundle} from '@/class/DiagnosticBundle';
import {recordSentDiagnostic} from '@/class/DiagnosticHistory';
import type {ApiFailure, MauiApiClient} from '@/class/MauiApiClient';
import {describeFailure} from '@/class/OnlineSetup';

/**
 * A diagnostic of a game (maui-api D92): what MAUI reads of its files, gathered and sent to MAUI-API.
 * From the BO's page of the game (boServer.ts), and from the front's Diagnostic action (Hotkeys.ts,
 * Home.vue, through background.ts's DIAGNOSTIC_GLOBAL): kept out of boServer.ts, which the front
 * does not load.
 */

/**
 * hiscore.dat the hiscore plugin reads (<pluginspath>/hiscore/hiscore.dat): it gives the size each
 * rom's .hi file should have, so the Hiscores page can flag a file written for another layout.
 */
export function getHiscoreDatPath(mameHome: string): string | null {
    const pluginsPath = getMameIniValue(join(mameHome, 'mame.ini'), 'pluginspath');
    if (!pluginsPath) {
        return null;
    }
    const path = join(resolveDirectoryPath(pluginsPath, mameHome), 'hiscore', 'hiscore.dat');
    return existsSync(path) ? path : null;
}

/** Scores stored in the database, by id_game, keyed the way inspectHiscores() matches them. */
export async function getStoredScores(idGame?: number): Promise<Map<number, StoredScore[]>> {
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

/** What MAUI reads of a game's files, against the players and the scores of the database. */
export async function inspectGameHiscores(mameHome: string, romName: string): Promise<{game: Game | null; report: HiscoreReport}> {
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
    return {game, report};
}

export function describeDiagnosticFailure(result: ApiFailure): string {
    if (result.kind === 'rejected' && result.code === 'insufficient_ability') {
        return 'MAUI-API does not take diagnostics from this cabinet yet (too old, or a token without diagnostics:write). Download the zip instead.';
    }
    if (result.kind === 'rejected' && result.errors) {
        return `MAUI-API refused the diagnostic: ${Object.values(result.errors).flat().join(' ')}`;
    }
    return `Not sent: ${describeFailure(result, 'MAUI-API')}`;
}

export interface GameDiagnosticRequest {
    mameHome: string;
    romName: string;
    comment: string;
    // null: the logs are not attached.
    logDir: string | null;
    versions: {maui: string; mhiex: string; mame: () => Promise<string>};
}

/** The game's diagnostic, ready to be sent or zipped, with what was read to make it. */
export async function buildGameDiagnostic(request: GameDiagnosticRequest): Promise<{
    game: Game | null; report: HiscoreReport; bundle: DiagnosticBundle;
}> {
    const {game, report} = await inspectGameHiscores(request.mameHome, request.romName);
    const bundle = buildDiagnosticBundle({
        romName: request.romName, comment: request.comment, inspection: report,
        versions: {maui: request.versions.maui, mhiex: request.versions.mhiex, mame: await request.versions.mame()},
        logDir: request.logDir,
    });
    return {game, report, bundle};
}

export type DiagnosticSent = {kind: 'sent'; id: string} | {kind: 'offline'} | {kind: 'failed'; reason: string};

/** Sends a diagnostic to MAUI-API and remembers it (DiagnosticHistory.ts). `client` null: not ONLINE. */
export async function sendDiagnostic(
    client: Pick<MauiApiClient, 'sendDiagnostic'> | null, bundle: DiagnosticBundle, withLogs: boolean, historyPath?: string,
): Promise<DiagnosticSent> {
    if (!client) {
        return {kind: 'offline'};
    }
    const result = await client.sendDiagnostic(bundle);
    if (result.kind !== 'ok') {
        return {kind: 'failed', reason: describeDiagnosticFailure(result)};
    }
    recordSentDiagnostic({
        romName: bundle.romName, id: result.value, sentAt: new Date().toISOString(), files: bundle.files.length,
        size: bundle.files.reduce((size, file) => size + file.content.length, 0), logs: withLogs,
    }, historyPath);
    return {kind: 'sent', id: result.value};
}
