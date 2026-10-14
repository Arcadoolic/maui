import {describe, it, expect} from 'vitest';
import {describeSetup, type SetupFacts, type SetupStepState} from '@/class/SetupSteps';

const NOTHING: SetupFacts = {
    passwordChanged: false,
    mameReady: false,
    missingPlugins: [],
    disabledRequiredPlugins: ['hiscore'],
    pluginsFound: false,
    onlineConfigured: false,
    offlineChosen: false,
    missingConfPackFiles: ['catver.ini', 'genre.ini', 'Multiplayer.ini'],
    favoritesCount: 0,
};

const READY: SetupFacts = {
    passwordChanged: true,
    mameReady: true,
    missingPlugins: [],
    disabledRequiredPlugins: [],
    pluginsFound: true,
    onlineConfigured: true,
    offlineChosen: false,
    missingConfPackFiles: [],
    favoritesCount: 12,
};

function states(facts: SetupFacts): Record<string, SetupStepState> {
    return Object.fromEntries(describeSetup(facts).steps.map(step => [step.id, step.state]));
}

describe('describeSetup', () => {
    it('starts with the BO account, everything else waiting for it', () => {
        expect(states(NOTHING)).toEqual({
            account: 'current', mame: 'blocked', plugins: 'blocked', online: 'blocked', confPack: 'blocked',
            starterPack: 'blocked',
        });
        expect(describeSetup(NOTHING)).toMatchObject({completed: 0, total: 6, finished: false});
    });

    it('goes on with mame, ONLINE being possible at the same time', () => {
        expect(states({...NOTHING, passwordChanged: true})).toEqual({
            account: 'done', mame: 'current', plugins: 'blocked', online: 'todo', confPack: 'blocked',
            starterPack: 'blocked',
        });
    });

    it('wants plugins found, all listed in plugin.ini, and those MAUI needs switched on', () => {
        const base = {...READY, favoritesCount: 0, missingConfPackFiles: ['genre.ini']};
        expect(states({...base, pluginsFound: false}).plugins).toBe('current');
        expect(states({...base, missingPlugins: ['autofire']}).plugins).toBe('current');
        expect(states({...base, disabledRequiredPlugins: ['hiscore']}).plugins).toBe('current');
        expect(states(base).plugins).toBe('done');
    });

    it('installs the configuration pack, then the starter pack, once ONLINE', () => {
        expect(states({...READY, missingConfPackFiles: ['genre.ini'], favoritesCount: 0})).toMatchObject({
            confPack: 'current', starterPack: 'blocked',
        });
        expect(states({...READY, favoritesCount: 0})).toMatchObject({confPack: 'done', starterPack: 'current'});
    });

    it('is finished when every step is done', () => {
        expect(describeSetup(READY)).toMatchObject({completed: 6, finished: true});
    });

    it('leaves the packs to install by hand when the cabinet stays OFFLINE, and is then finished', () => {
        const offline = {...READY, onlineConfigured: false, offlineChosen: true, missingConfPackFiles: ['genre.ini'], favoritesCount: 0};
        expect(states(offline)).toMatchObject({online: 'done', confPack: 'manual', starterPack: 'manual'});
        expect(describeSetup(offline)).toMatchObject({completed: 6, finished: true});
        // Installed by hand all the same: done.
        expect(states({...offline, missingConfPackFiles: [], favoritesCount: 3})).toMatchObject({
            confPack: 'done', starterPack: 'done',
        });
    });

    it('takes a configuration string pasted after choosing OFFLINE: the packs are back', () => {
        expect(states({...READY, offlineChosen: true, favoritesCount: 0}).starterPack).toBe('current');
    });

    it('marks one current step at most, the first one possible', () => {
        const progress = describeSetup({...NOTHING, passwordChanged: true});
        expect(progress.steps.filter(step => step.state === 'current')).toHaveLength(1);
    });
});
