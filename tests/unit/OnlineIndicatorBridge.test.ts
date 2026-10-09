import {describe, it, expect} from 'vitest';
import {badgeLabel, describeFrontIndicator, describeIdentity} from '@/class/OnlineIndicatorBridge';

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

describe('badgeLabel', () => {
    it('adds the cabinet and the environment, when known', () => {
        expect(badgeLabel('ONLINE', 'marvelous_mario \u2022 STG')).toBe('ONLINE \u2022 marvelous_mario \u2022 STG');
        expect(badgeLabel('OFFLINE', '')).toBe('OFFLINE');
    });
});

describe('describeIdentity', () => {
    it('names the cabinet alone in production', () => {
        expect(describeIdentity({cabinetName: 'marvelous_mario', environment: 'production'})).toBe('marvelous_mario');
    });

    it('adds the environment anywhere else', () => {
        expect(describeIdentity({cabinetName: 'marvelous_mario', environment: 'staging'})).toBe('marvelous_mario \u2022 STG');
        expect(describeIdentity({cabinetName: 'marvelous_mario', environment: 'local'})).toBe('marvelous_mario \u2022 LOCAL');
        expect(describeIdentity({cabinetName: 'marvelous_mario', environment: 'demo'})).toBe('marvelous_mario \u2022 DEMO');
    });

    it('leaves out the environment of a server that does not say', () => {
        expect(describeIdentity({cabinetName: 'marvelous_mario', environment: null})).toBe('marvelous_mario');
    });

    it('gives nothing while the cabinet is not known', () => {
        expect(describeIdentity(null)).toBe('');
    });
});
