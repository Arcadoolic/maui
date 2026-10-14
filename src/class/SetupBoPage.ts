import {escapeHtml} from '@/class/EscapeHtml';
import type {SetupFacts, SetupProgress, SetupStep, SetupStepId} from '@/class/SetupSteps';

// The BO's "Getting started" page (/setup, Lot VI.2): the steps of a new cabinet's setup, and the
// form of the one to do now on the page itself. Its forms post to /setup/* (boServer.ts), and the
// two pack imports to their usual routes with from=setup, which bring the browser back here.

export interface SetupPageInput {
    progress: SetupProgress;
    facts: SetupFacts;
    // What the mame step's form shows: typed before an error, or brought back by /browse.
    mamePath: string;
    pluginsPath: string;
    // The outcome of the last action, shown on its step.
    message?: {step: SetupStepId; error?: string; info?: string};
}

const TITLES: Record<SetupStepId, string> = {
    account: 'BO account',
    mame: 'MAME',
    plugins: 'MAME plugins',
    online: 'ONLINE',
    confPack: 'Configuration pack',
    starterPack: 'Starter pack',
};

const WHY: Record<SetupStepId, string> = {
    account: 'Replace the default password: anyone on the network could sign in with it, and it also '
        + 'locks the credentials this back office keeps.',
    mame: 'Tell mame-awesome-ui where the mame binary is. Its configuration is created in ~/.mame '
        + 'the first time.',
    plugins: 'MAME\'s hiscore plugin saves the scores mame-awesome-ui reads: it must be switched on.',
    online: 'Connects the cabinet to MAUI-API: shared hiscores, players, and the game repository the '
        + 'packs below come from. Paste the configuration string given by MAUI-API\'s back office.',
    confPack: 'Genres, player counts and a corrected hiscore.dat, downloaded from the repository: the '
        + 'list of games is built from them.',
    starterPack: 'A few curated games to start with, downloaded from the repository. More can be added '
        + 'later from the Games tab.',
};

// OFFLINE, nothing is downloaded: what to do instead.
const BY_HAND: Partial<Record<SetupStepId, string>> = {
    confPack: 'OFFLINE: copy catver.ini, genre.ini and Multiplayer.ini into the folder categorypath '
        + 'points at in ~/.mame/ui.ini.',
    starterPack: 'OFFLINE: copy roms into mame\'s roms folder, and add them to the favorites from '
        + 'MAME\'s own menu.',
};

const STATE_LABELS: Record<SetupStep['state'], string> = {
    done: 'Done',
    current: 'To do now',
    todo: 'To do',
    blocked: 'Waiting',
    manual: 'By hand',
};

function renderMessage(input: SetupPageInput, step: SetupStepId): string {
    const message = input.message;
    if (!message || message.step !== step) {
        return '';
    }
    return (message.error ? `<p class="error flash">${escapeHtml(message.error)}</p>` : '')
        + (message.info ? `<p class="info flash">${escapeHtml(message.info)}</p>` : '');
}

// The Browse buttons go through /browse, which brings the chosen folder back to /setup (from=setup).
function renderPathField(name: 'mamePath' | 'pluginsPath', label: string, value: string): string {
    return `
                <label for="${name}">${label}</label>
                <div class="path-row">
                    <input type="text" id="${name}" name="${name}" value="${escapeHtml(value)}">
                    <button type="submit" name="target" value="${name}" formaction="/browse" formmethod="get">Browse</button>
                </div>`;
}

function renderAction(step: SetupStepId, input: SetupPageInput): string {
    switch (step) {
        case 'account':
            return '<p><a class="button-link" href="/account">Change the password</a></p>';
        case 'mame':
            return `
            <form method="post" action="/setup/mame" novalidate>
                <input type="hidden" name="from" value="setup">
                ${renderPathField('mamePath', 'Folder containing the mame binary', input.mamePath)}
                ${renderPathField('pluginsPath', 'MAME plugins folder (left empty: the "plugins" folder next to the binary, when there is one)', input.pluginsPath)}
                <div class="button-row"><button type="submit">Save</button></div>
            </form>`;
        case 'plugins':
            // No plugin at all: pluginspath is wrong, and only the folder can fix it.
            return input.facts.pluginsFound
                ? `
            <form method="post" action="/setup/plugins">
                <button type="submit">Switch on the plugins</button>
            </form>`
                : `
            <p class="error">No plugin found: point MAME at its plugins folder (the "plugins" folder next to the mame binary).</p>
            <form method="post" action="/setup/plugins" novalidate>
                <input type="hidden" name="from" value="setup">
                ${renderPathField('pluginsPath', 'MAME plugins folder', input.pluginsPath)}
                <div class="button-row"><button type="submit">Save and switch on the plugins</button></div>
            </form>`;
        case 'online':
            return `
            <form method="post" action="/setup/online">
                <label for="configuration">Configuration string</label>
                <input type="text" id="configuration" name="configuration" value="" autocomplete="off" spellcheck="false">
                <div class="button-row"><button type="submit">Connect</button></div>
            </form>
            <form method="post" action="/setup/offline">
                <input type="hidden" name="offline" value="on">
                <p class="info">No MAUI-API? The cabinet can stay OFFLINE: its scores stay on it, and the
                packs below are then installed by hand.</p>
                <button type="submit" class="secondary">Stay OFFLINE</button>
            </form>`;
        case 'confPack':
            return `
            <form method="post" action="/import/conf-pack" data-stream>
                <input type="hidden" name="from" value="setup">
                <button type="submit">Install the configuration pack</button>
            </form>`;
        case 'starterPack':
            return `
            <form method="post" action="/import/starter-pack" data-stream>
                <input type="hidden" name="from" value="setup">
                <button type="submit">Install the starter pack</button>
            </form>`;
    }
}

function renderStep(step: SetupStep, index: number, input: SetupPageInput): string {
    let body: string;
    if (step.state === 'current') {
        body = `<p>${escapeHtml(WHY[step.id])}</p>${renderMessage(input, step.id)}${renderAction(step.id, input)}`;
    } else if (step.state === 'manual') {
        body = `<p>${escapeHtml(BY_HAND[step.id] ?? '')}</p>`;
    } else if (step.state === 'todo') {
        body = `<p class="muted">${escapeHtml(WHY[step.id])}</p>`;
    } else {
        body = renderMessage(input, step.id);
    }
    // OFFLINE chosen: the way back to ONLINE stays offered.
    if (step.id === 'online' && step.state === 'done' && input.facts.offlineChosen && !input.facts.onlineActive) {
        body += `
            <form method="post" action="/setup/offline">
                <input type="hidden" name="offline" value="off">
                <p class="muted">The cabinet stays OFFLINE.</p>
                <button type="submit" class="secondary">Connect to MAUI-API after all</button>
            </form>`;
    }
    return `
        <li class="setup-step setup-${step.state}"${step.state === 'current' ? ' aria-current="step"' : ''}>
            <div class="setup-step-head">
                <span class="setup-number" aria-hidden="true">${step.state === 'done' ? '&#10003;' : index + 1}</span>
                <h3>${escapeHtml(TITLES[step.id])}</h3>
                <span class="setup-state">${STATE_LABELS[step.state]}</span>
            </div>
            ${body ? `<div class="setup-step-body">${body}</div>` : ''}
        </li>`;
}

export function renderSetupPage(input: SetupPageInput): string {
    const {progress} = input;
    const intro = progress.finished
        ? `<p class="info flash">Your cabinet is ready. Gamepads are set up from the MAME tab, the look of
            the cabinet from the MAUI tab.</p>`
        : `<p>The minimal setup of the cabinet, one step after the other: ${progress.completed} of
            ${progress.total} done. The other tabs stay open meanwhile.</p>`;
    return `
        <section class="card setup">
            <h2>Getting started</h2>
            ${intro}
            <ol class="setup-steps">
                ${progress.steps.map((step, index) => renderStep(step, index, input)).join('')}
            </ol>
        </section>
        <style>
            .setup-steps { list-style: none; margin: var(--space-3) 0 0; padding: 0; }
            .setup-step { border: 1px solid var(--border); border-radius: var(--radius-md);
                padding: var(--space-2) var(--space-3); margin-bottom: var(--space-2); }
            .setup-step-head { display: flex; align-items: center; gap: var(--space-2); }
            .setup-step-head h3 { margin: 0; flex: 1; font-size: 1em; }
            .setup-number { display: inline-flex; align-items: center; justify-content: center;
                width: 1.6em; height: 1.6em; border-radius: 50%; border: 1px solid var(--border);
                font-size: 0.9em; flex-shrink: 0; }
            .setup-state { font-size: 0.85em; color: var(--text-muted); }
            .setup-step-body { margin: var(--space-2) 0 var(--space-1) calc(1.6em + var(--space-2)); }
            .setup-step-body form + form { margin-top: var(--space-3); }
            .setup-step .muted { color: var(--text-muted); }
            .setup-done .setup-number { background: var(--success); border-color: var(--success); color: var(--bg); }
            .setup-done .setup-state { color: var(--success); }
            .setup-current { border-color: var(--accent); }
            .setup-current .setup-number { border-color: var(--accent); color: var(--accent); }
            .setup-current .setup-state { color: var(--accent); }
            .setup-blocked h3, .setup-blocked .setup-number { color: var(--text-muted); }
            .setup-manual .setup-state { color: var(--warn); }
            .setup-step button.secondary { color: var(--text); background-color: transparent;
                border: 1px solid var(--border); }
            .setup-step button.secondary:hover:not(:disabled) { background-color: var(--surface-inset); }
        </style>
    `;
}

/** "Getting started 3/6" in the BO's header, while the setup is not finished. */
export function renderSetupNavLabel(progress: SetupProgress): string {
    return `Getting started ${progress.completed}/${progress.total}`;
}
