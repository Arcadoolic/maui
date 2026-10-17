import {describe, it, expect} from 'vitest';
import {FAIR_PLAY_ARGS, FAIR_PLAY_PLUGINS_OFF} from '@/class/FairPlay';

describe('FAIR_PLAY_ARGS', () => {
    it('turns off cheats, rewind, autosave, debugger and console, at real speed', () => {
        for (const option of ['-nocheat', '-norewind', '-noautosave', '-nodebug', '-noconsole', '-throttle']) {
            expect(FAIR_PLAY_ARGS).toContain(option);
        }
        expect(FAIR_PLAY_ARGS[FAIR_PLAY_ARGS.indexOf('-speed') + 1]).toBe('1.0');
    });

    it('turns off the plugins that cheat or play for the player, never the hiscore one', () => {
        const plugins = FAIR_PLAY_ARGS[FAIR_PLAY_ARGS.indexOf('-noplugin') + 1].split(',');
        expect(plugins).toEqual([...FAIR_PLAY_PLUGINS_OFF]);
        expect(plugins).toEqual(expect.arrayContaining(['cheat', 'cheatfind', 'autofire', 'inputmacro']));
        expect(plugins).not.toContain('hiscore');
    });
});
