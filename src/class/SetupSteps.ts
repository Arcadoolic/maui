// The steps of a new cabinet's setup (Lot VI), from what can be read of it: shown by the BO's
// "Getting started" page and on the cabinet's own screen until they are done. Pure, so that the
// order and the blocking rules are tested without a cabinet.

export type SetupStepId = 'account' | 'mame' | 'plugins' | 'online' | 'confPack' | 'starterPack';

// done: nothing left to do. current: the one to do now (one at most). todo: can be done, after
// the current one. blocked: waits for an earlier step. manual: OFFLINE, to install by hand (the
// packs are only downloaded from the repository ONLINE).
export type SetupStepState = 'done' | 'current' | 'todo' | 'blocked' | 'manual';

export interface SetupFacts {
    // The BO's default password was replaced (bo_user.secretsKey is set at the first sign-in with
    // another password).
    passwordChanged: boolean;
    // The mame binary is configured and found.
    mameReady: boolean;
    // Plugins found in mame's plugins folder that plugin.ini does not list, and the plugins
    // mame-awesome-ui needs that it does not switch on.
    missingPlugins: string[];
    disabledRequiredPlugins: string[];
    // At least one plugin found in mame's plugins folder: none means pluginspath is wrong.
    pluginsFound: boolean;
    // ONLINE is on (a configuration string pasted and switched on: the repository is only reached
    // then), or the BO was told to stay OFFLINE.
    onlineActive: boolean;
    offlineChosen: boolean;
    // Files of the configuration pack not installed yet (ConfPack.ts).
    missingConfPackFiles: string[];
    favoritesCount: number;
}

export interface SetupStep {
    id: SetupStepId;
    state: SetupStepState;
}

export interface SetupProgress {
    steps: SetupStep[];
    // Steps done or left to do by hand, out of all of them.
    completed: number;
    total: number;
    // Nothing left that the guide can do.
    finished: boolean;
}

interface StepRule {
    id: SetupStepId;
    done: (facts: SetupFacts) => boolean;
    requires: SetupStepId[];
    // Only possible ONLINE: left to do by hand when the cabinet stays OFFLINE.
    onlineOnly?: boolean;
}

const RULES: StepRule[] = [
    {id: 'account', done: facts => facts.passwordChanged, requires: []},
    {id: 'mame', done: facts => facts.mameReady, requires: ['account']},
    {
        id: 'plugins',
        done: facts => facts.pluginsFound && !facts.missingPlugins.length && !facts.disabledRequiredPlugins.length,
        requires: ['mame'],
    },
    {id: 'online', done: facts => facts.onlineActive || facts.offlineChosen, requires: ['account']},
    {id: 'confPack', done: facts => !facts.missingConfPackFiles.length, requires: ['mame', 'online'], onlineOnly: true},
    {id: 'starterPack', done: facts => facts.favoritesCount > 0, requires: ['confPack'], onlineOnly: true},
];

export function describeSetup(facts: SetupFacts): SetupProgress {
    const offline = facts.offlineChosen && !facts.onlineActive;
    const states = new Map<SetupStepId, SetupStepState>();
    let current = false;
    for (const rule of RULES) {
        let state: SetupStepState;
        if (rule.done(facts)) {
            state = 'done';
        } else if (rule.requires.some(id => states.get(id) !== 'done' && states.get(id) !== 'manual')) {
            state = 'blocked';
        } else if (offline && rule.onlineOnly) {
            state = 'manual';
        } else if (!current) {
            state = 'current';
            current = true;
        } else {
            state = 'todo';
        }
        states.set(rule.id, state);
    }
    const steps = RULES.map(rule => ({id: rule.id, state: states.get(rule.id) as SetupStepState}));
    const completed = steps.filter(step => step.state === 'done' || step.state === 'manual').length;
    return {steps, completed, total: steps.length, finished: completed === steps.length};
}
