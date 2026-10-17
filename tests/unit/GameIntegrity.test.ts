import {describe, it, expect} from 'vitest';
import {buildGameReport} from '@/class/GameIntegrity';

const facts = {sessionId: 'session-1', mauiVersion: '2.16.0', rom: 'good' as const};

describe('buildGameReport', () => {
    it('gives the cabinet\'s facts alone without the daemon\'s report', () => {
        expect(buildGameReport(null, facts)).toEqual({version: 1, session_id: 'session-1', maui_version: '2.16.0', rom: 'good'});
        expect(buildGameReport('{not json', facts)).toEqual({version: 1, session_id: 'session-1', maui_version: '2.16.0', rom: 'good'});
    });

    it('keeps what the API takes, and the cabinet\'s facts over the daemon\'s', () => {
        const report = buildGameReport(JSON.stringify({
            version: 7, session_id: 'forged', rom: 'bad', mame_version: '0.289', duration_s: 60, emulated_s: -3,
            options: {cheat: false, speed: 1.0, odd: 'x'},
            plugins: ['hiscore', 42, 'data'],
            dips: [{name: 'Lives', value: '5', default: '3'}, {name: 'Broken'}],
            events: {state_loads: 1, pauses: -2, note: 'x'},
            speed: {average_percent: 99.1},
            extra: true,
        }), facts);

        expect(report).toEqual({
            version: 1, session_id: 'session-1', maui_version: '2.16.0', rom: 'good', mame_version: '0.289', duration_s: 60,
            options: {cheat: false, speed: 1.0},
            plugins: ['hiscore', 'data'],
            dips: [{name: 'Lives', value: '5', default: '3'}],
            events: {state_loads: 1},
            speed: {average_percent: 99.1},
        });
    });

    it('stays within the API\'s limits', () => {
        const report = buildGameReport(JSON.stringify({
            plugins: Array.from({length: 100}, (_, i) => `p${i}${'x'.repeat(100)}`),
            dips: Array.from({length: 100}, () => ({name: 'n'.repeat(100), value: 'v', default: 'd'})),
        }), facts);

        expect(report.plugins).toHaveLength(64);
        expect(report.plugins?.every(name => name.length <= 64)).toBe(true);
        expect(report.dips).toHaveLength(64);
        expect(report.dips?.[0].name).toHaveLength(64);
    });
});
