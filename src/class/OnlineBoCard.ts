import {escapeHtml} from '@/class/EscapeHtml';
import type {OnlineView} from '@/class/OnlineSetup';

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

export function renderOnlineCard(view: OnlineView, messages: OnlineCardMessages = {}): string {
    const intro = `
            <h2>Online (MAUI-API)</h2>
            <p>Connects this cabinet to a MAUI-API server. Paste the configuration string (it starts
            with <code>MAUI1.</code>) shown once on the invitation page.</p>`;

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

    const configured = view.state === 'configured';
    return `
        <section class="card">${intro}
            ${renderFlashes(messages)}
            ${configured ? renderCredentials(view.url, view.key) : ''}
            ${renderPasteForm(configured)}
            <p class="info">ONLINE mode itself (startup report, heartbeat) comes in a later version:
            saving and testing here is all MAUI sends to MAUI-API for now.</p>
        </section>`;
}
