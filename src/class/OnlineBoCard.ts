import {escapeHtml} from '@/class/EscapeHtml';
import type {BoMessage, OnlineView} from '@/class/OnlineSetup';

export interface OnlineCardMessages {
    error?: string;
    info?: string;
}

function renderFlashes({error, info}: OnlineCardMessages): string {
    return (error ? `<p class="error flash">${escapeHtml(error)}</p>` : '')
        + (info ? `<p class="info flash">${escapeHtml(info)}</p>` : '');
}

function renderCredentials(url: string, key: string): string {
    return `
            <dl>
                <dt>API URL</dt><dd><code>${escapeHtml(url)}</code></dd>
                <dt>Client key</dt><dd><code>${escapeHtml(key)}</code></dd>
                <dt>Token</dt><dd>Saved, never shown again.</dd>
            </dl>
            <form method="post" action="/maui/online/test">
                <p class="info">The first successful test binds these credentials to this cabinet: they
                are then refused on any other one until the administrator of MAUI-API resets the binding.</p>
                <button type="submit">Test connection</button>
            </form>`;
}

function renderEnabledForm(value: 'on' | 'off', label: string): string {
    return `
            <form method="post" action="/maui/online/enabled">
                <input type="hidden" name="enabled" value="${value}">
                <button type="submit">${label}</button>
            </form>`;
}

export interface OnlineCardSession {
    stopped: boolean;
    status: BoMessage;
}

// ONLINE switch and live status. Retry (a session restart, hence a new startup report) only once
// the session stopped: a transient error is already retried by the next heartbeat.
function renderSession(enabled: boolean, session?: OnlineCardSession): string {
    const statusLine = session
        ? `<p class="${session.status.level === 'error' ? 'error' : 'info'}">${escapeHtml(session.status.message)}</p>`
        : '';
    if (!enabled) {
        return statusLine + renderEnabledForm('on', 'Turn ONLINE on');
    }
    const retry = session?.stopped ? renderEnabledForm('on', 'Retry') : '';
    return statusLine + retry + renderEnabledForm('off', 'Turn ONLINE off');
}

// The URL only ever changes by pasting a whole MAUI1. string, never through a field of its own,
// and the field is never prefilled: the saved token must not come back into the page.
function renderPasteForm(replacing: boolean): string {
    return `
            <form method="post" action="/maui/online/save" novalidate>
                <label for="onlineConfiguration">${replacing ? 'Replace with a new configuration string' : 'Configuration string'}</label>
                <input type="text" id="onlineConfiguration" name="configuration" value="" autocomplete="off" spellcheck="false" placeholder="MAUI1.">
                <button type="submit">Save</button>
            </form>`;
}

export function renderOnlineCard(view: OnlineView, messages: OnlineCardMessages = {}, session?: OnlineCardSession): string {
    const intro = `
            <h2>Online (MAUI-API)</h2>
            <p>Connects this cabinet to a MAUI-API server: a startup report at launch, then a heartbeat
            every minute while ONLINE is on. Paste the configuration string (it starts with
            <code>MAUI1.</code>) shown once on the invitation page.</p>`;

    if (view.state === 'unreadable') {
        return `
        <section class="card">${intro}
            <p class="error flash">${escapeHtml(view.message)}</p>
            <form method="post" action="/maui/online/reset">
                <p class="info">Reset moves the damaged file aside and keeps this cabinet's identity when it
                can still be read from it. The configuration string must then be pasted again.</p>
                <button type="submit">Reset ONLINE settings</button>
            </form>
        </section>`;
    }

    if (view.state === 'unconfigured') {
        return `
        <section class="card">${intro}
            ${renderFlashes(messages)}
            ${renderPasteForm(false)}
        </section>`;
    }

    return `
        <section class="card">${intro}
            ${renderFlashes(messages)}
            ${renderSession(view.enabled, session)}
            ${renderCredentials(view.url, view.key)}
            ${renderPasteForm(true)}
        </section>`;
}
