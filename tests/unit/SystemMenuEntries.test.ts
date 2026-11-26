import {describe, it, expect} from 'vitest';
import {describeUpdateCheck, systemMenuEntries} from '@/class/SystemMenuEntries';

describe('systemMenuEntries', () => {
    it('restarts MAUI and shuts the system down on a dedicated cabinet', () => {
        expect(systemMenuEntries(true).map(entry => entry.label))
            .toEqual(['Check for MAUI update', 'Restart MAUI', 'Shut down system']);
    });

    it('only quits MAUI on a desktop', () => {
        expect(systemMenuEntries(false).map(entry => entry.label)).toEqual(['Check for MAUI update', 'Quit MAUI']);
    });
});

describe('describeUpdateCheck', () => {
    it('says what the check found', () => {
        expect(describeUpdateCheck({status: 'up-to-date'})).toBe('MAUI is up to date.');
        expect(describeUpdateCheck({status: 'bo-only', version: '2.23.0'})).toBe('MAUI 2.23.0 is out: update from the back office.');
        expect(describeUpdateCheck({status: 'manual', version: '2.23.0'}))
            .toBe('MAUI 2.23.0 is out: download it to update this computer.');
    });
});
