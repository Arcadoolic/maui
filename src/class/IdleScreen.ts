/**
 * What an idle cabinet shows (Config.frontIdleScreen, the BO's MAUI card): its band of messages
 * (MessageBand.vue), the champions of the day (ChampionsScreen.vue, maui-api D101), or either,
 * drawn each time it turns idle. Without MAUI-API's champions (OFFLINE, none yet), the band.
 */
export const IDLE_SCREEN_SETTINGS = ['messages', 'champions', 'random'] as const;
export type IdleScreenSetting = typeof IDLE_SCREEN_SETTINGS[number];
export type IdleScreen = Exclude<IdleScreenSetting, 'random'>;

export const IDLE_SCREEN_LABELS: Record<IdleScreenSetting, string> = {
    messages: 'The latest best scores (band of messages)',
    champions: 'The champions of the day (ONLINE only)',
    random: 'Either, drawn each time',
};

export function parseIdleScreenSetting(value: unknown): IdleScreenSetting {
    return IDLE_SCREEN_SETTINGS.includes(value as IdleScreenSetting) ? value as IdleScreenSetting : 'messages';
}

/** The screen for this time: the setting's, or drawn for `random`. */
export function pickIdleScreen(setting: IdleScreenSetting, random: () => number = Math.random): IdleScreen {
    if (setting !== 'random') {
        return setting;
    }
    return random() < 0.5 ? 'messages' : 'champions';
}
