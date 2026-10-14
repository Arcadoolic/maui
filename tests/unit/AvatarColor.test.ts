import {describe, it, expect} from 'vitest';
import {AVATAR_COLORS, avatarColor} from '@/class/AvatarColor';

describe('avatarColor', () => {
    it('gives a player the same color every time, whatever the case', () => {
        expect(avatarColor('NOB')).toBe(avatarColor('NOB'));
        expect(avatarColor('nob')).toBe(avatarColor('NOB'));
        expect(AVATAR_COLORS).toContain(avatarColor('NOB'));
    });

    it('spreads players over the palette', () => {
        const players = ['AAA', 'NOB', 'JMB', 'ZZZ', 'KEN', 'RYU', 'CHN', 'GUY', 'ROB', 'TOM', 'ANA', 'LEO'];
        expect(new Set(players.map(avatarColor)).size).toBeGreaterThanOrEqual(6);
    });

    it('has a color for no initials at all', () => {
        expect(AVATAR_COLORS).toContain(avatarColor(''));
    });
});
