import {describe, it, expect} from 'vitest';
import {canActivateLocally, canReceiveScores, playersBlockingOnline} from '@/class/OnlineReconciliation';

const player = (pseudo3: string, active: boolean, remoteId: string | null) =>
    ({pseudo_3: pseudo3, active, remote_id: remoteId});

describe('playersBlockingOnline', () => {
    it('lets ONLINE on when every active player is in MAUI-API', () => {
        expect(playersBlockingOnline([player('NOB', true, 'id-1'), player('OLD', false, null)])).toBeNull();
        expect(playersBlockingOnline([])).toBeNull();
    });

    it('names the active players missing from MAUI-API and says what to do', () => {
        const message = playersBlockingOnline([player('SKI', true, null), player('NOB', true, 'id-1'), player('SAJ', true, null)]);
        expect(message).toMatch(/SAJ, SKI/);
        expect(message).toMatch(/Go ONLINE/);
        expect(message).toMatch(/deactivate/i);
    });
});

describe('canActivateLocally', () => {
    it('refuses to activate a local-only player while ONLINE is on', () => {
        expect(canActivateLocally(player('SAJ', false, null), true)).toBe(false);
    });

    it('allows it for a linked player, or in LOCAL mode', () => {
        expect(canActivateLocally(player('NOB', false, 'id-1'), true)).toBe(true);
        expect(canActivateLocally(player('SAJ', false, null), false)).toBe(true);
    });
});

describe('canReceiveScores', () => {
    const scorer = (overrides: Partial<{active: boolean; remote_id: string | null; online_status: string | null}>) =>
        ({active: true, remote_id: 'id-1', online_status: 'active', ...overrides} as Parameters<typeof canReceiveScores>[0]);

    it('gives scores to active players only, ONLINE or not', () => {
        expect(canReceiveScores(scorer({}), false)).toBe(true);
        expect(canReceiveScores(scorer({active: false}), false)).toBe(false);
        expect(canReceiveScores(scorer({remote_id: null, online_status: null}), false)).toBe(true);
    });

    it('in ONLINE mode, only to players active in MAUI-API too', () => {
        expect(canReceiveScores(scorer({}), true)).toBe(true);
        expect(canReceiveScores(scorer({remote_id: null, online_status: null}), true)).toBe(false);
        expect(canReceiveScores(scorer({online_status: 'disabled'}), true)).toBe(false);
        expect(canReceiveScores(scorer({online_status: 'locked'}), true)).toBe(true);
    });
});
