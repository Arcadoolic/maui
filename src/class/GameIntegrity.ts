/**
 * The report on the game a score was made in (maui-api D87), joined to each score sent to
 * MAUI-API: what capture-daemon.lua saw of the game up to the score (its session-report.json),
 * plus what the cabinet knows itself - which game this is, its version, what MAME makes of the
 * ROM set. MAUI-API keeps it raw and judges it; nothing here decides whether a game was fair.
 * Electron-free, so it stays unit-testable.
 */
export type RomCheck = 'good' | 'bad' | 'unknown';

export interface GameIntegrityReport {
    version: number;
    session_id?: string;
    mame_version?: string;
    maui_version?: string;
    duration_s?: number;
    emulated_s?: number;
    options?: Record<string, boolean | number | null>;
    plugins?: string[];
    rom?: RomCheck;
    dips?: {name: string; value: string; default: string}[];
    events?: Record<string, number>;
    speed?: Record<string, number>;
}

export interface CabinetFacts {
    sessionId: string;
    mauiVersion: string;
    rom: RomCheck;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numbers(value: unknown): Record<string, number> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'number' && item >= 0)) as Record<string, number>;
}

/**
 * The game's report as capture-daemon.lua last wrote it, with the cabinet's own facts. Only the
 * parts MAUI-API's contract takes, and of the right type: MAUI-API refuses a whole batch of scores
 * over one malformed report. Without the daemon's file, the cabinet's facts alone.
 */
export function buildGameReport(daemonJson: string | null, facts: CabinetFacts): GameIntegrityReport {
    let daemon: Record<string, unknown> = {};
    if (daemonJson) {
        try {
            const parsed: unknown = JSON.parse(daemonJson);
            daemon = isRecord(parsed) ? parsed : {};
        } catch {
            daemon = {};
        }
    }
    const report: GameIntegrityReport = {
        version: 1,
        session_id: facts.sessionId,
        maui_version: facts.mauiVersion.slice(0, 32),
        rom: facts.rom,
    };
    if (typeof daemon.mame_version === 'string') {
        report.mame_version = daemon.mame_version.slice(0, 32);
    }
    for (const key of ['duration_s', 'emulated_s'] as const) {
        const value = daemon[key];
        if (typeof value === 'number' && value >= 0) {
            report[key] = value;
        }
    }
    if (isRecord(daemon.options)) {
        report.options = Object.fromEntries(Object.entries(daemon.options)
            .filter(([, value]) => typeof value === 'boolean' || typeof value === 'number')) as Record<string, boolean | number>;
    }
    if (Array.isArray(daemon.plugins)) {
        report.plugins = daemon.plugins.filter((name): name is string => typeof name === 'string')
            .map(name => name.slice(0, 64)).slice(0, 64);
    }
    if (Array.isArray(daemon.dips)) {
        report.dips = daemon.dips.filter(isRecord)
            .filter(dip => typeof dip.name === 'string' && typeof dip.value === 'string' && typeof dip.default === 'string')
            .map(dip => ({
                name: (dip.name as string).slice(0, 64),
                value: (dip.value as string).slice(0, 64),
                default: (dip.default as string).slice(0, 64),
            }))
            .slice(0, 64);
    }
    const events = numbers(daemon.events);
    if (events) {
        report.events = events;
    }
    const speed = numbers(daemon.speed);
    if (speed) {
        report.speed = speed;
    }
    return report;
}
