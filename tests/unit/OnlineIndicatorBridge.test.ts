import {describe, it, expect} from 'vitest';
import {describeFrontIndicator} from '@/class/OnlineIndicatorBridge';

describe('describeFrontIndicator', () => {
    it('shows ONLINE while connected or retrying, OFFLINE when stopped or turned off', () => {
        expect(describeFrontIndicator('online')?.label).toBe('ONLINE');
        expect(describeFrontIndicator('unstable')?.label).toBe('ONLINE');
        expect(describeFrontIndicator('offline')?.label).toBe('OFFLINE');
        expect(describeFrontIndicator('off')?.label).toBe('OFFLINE');
    });

    it('shows nothing when ONLINE was never configured', () => {
        expect(describeFrontIndicator(null)).toBeNull();
    });
});
