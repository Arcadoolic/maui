// The volumes set in the BO's MAUI tab, Sounds group, in % (0 to 100): the games' (Config.gamesVolume)
// and MAUI's own sounds' (Config.uiSoundsVolume, UiSounds.ts). Both scale the amplitude: 50% is half
// of it, -6 dB.

// MAME's -volume, in decibels: from -96 (silent) to 12, 0 being its own level (checked against 0.289).
const MAME_MIN_DB = -96;

/** A volume from the BO's form or the config file: an integer from 0 to 100, else `fallback`. */
export function parseVolumePercent(value: unknown, fallback: number): number {
    const volume = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
    return Number.isInteger(volume) && volume >= 0 && volume <= 100 ? volume : fallback;
}

/**
 * MAME's options for the games' volume. None at 100%: MAME's own level, or the one mame.ini sets,
 * as before this setting.
 */
export function gameVolumeArgs(percent: number): string[] {
    if (percent >= 100) {
        return [];
    }
    const db = percent <= 0 ? MAME_MIN_DB : Math.max(MAME_MIN_DB, Math.round(20 * Math.log10(percent / 100)));
    return ['-volume', String(db)];
}
