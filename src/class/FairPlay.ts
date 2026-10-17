/**
 * MAME options added to every game the front launches (MameService.startGame()), so that a score
 * is made the way the arcade made it: no cheats, no rewind or saved state brought back, no
 * debugger nor Lua console, real speed, and none of the plugins that play for the player
 * (autofire, input macros) or find cheats. On the command line, they win over mame.ini and
 * plugin.ini - which a player can change from MAME's own menu (Plugin Options), effective at the
 * next launch. The hiscore plugin, and the BO's capture daemon (an -autoboot_script), are left
 * alone. MAME launched from the BO to set the controls doesn't get them.
 *
 * Not covered: saved states taken and loaded by hand (F7 / Shift+F7, keyboard only - no option
 * turns them off), and the DIP switches (lives, difficulty) set from MAME's menu.
 */
export const FAIR_PLAY_PLUGINS_OFF: readonly string[] = ['cheat', 'cheatfind', 'autofire', 'inputmacro', 'console'];

export const FAIR_PLAY_ARGS: readonly string[] = [
    '-nocheat',
    '-norewind',
    '-noautosave',
    '-nodebug',
    '-noconsole',
    '-throttle',
    '-speed', '1.0',
    '-noplugin', FAIR_PLAY_PLUGINS_OFF.join(','),
];
