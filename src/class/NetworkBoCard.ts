import {escapeHtml} from '@/class/EscapeHtml';
import {isWifiTheOnlyLink, type NetworkLink, type NetworkState, type SavedWifi, type WifiNetwork} from '@/class/WifiControl';

// The MAUI tab's Network card, on a dedicated cabinet (WifiControl.ts).

export interface NetworkCardMessages {
    error?: string;
    info?: string;
}

export const ONLY_LINK_REASON = 'The Wi-Fi is all that connects this cabinet: plug in a network cable first.';

function renderLink(link: NetworkLink): string {
    const label = link.type === 'wifi' ? 'Wi-Fi' : 'Ethernet';
    const status = link.connected
        ? `Connected${link.type === 'wifi' && link.connection ? ` to <strong>${escapeHtml(link.connection)}</strong>` : ''}`
            + (link.address ? ` - <code>${escapeHtml(link.address)}</code>` : '')
        : 'Not connected';
    return `<dt>${label} (<code>${escapeHtml(link.device)}</code>)</dt><dd>${status}</dd>`;
}

function renderRadioForm(on: boolean, onlyLink: boolean): string {
    if (on && onlyLink) {
        return `<p class="info">${ONLY_LINK_REASON}</p>
            <button type="button" disabled>Turn Wi-Fi off</button>`;
    }
    return `
            <form method="post" action="/maui/network/radio">
                <input type="hidden" name="wifi" value="${on ? 'off' : 'on'}">
                <button type="submit">Turn Wi-Fi ${on ? 'off' : 'on'}</button>
            </form>`;
}

function renderNetworkAction(network: WifiNetwork, saved: SavedWifi[]): string {
    if (network.inUse) {
        return 'Connected';
    }
    // A saved network keeps its password, an open one has none.
    const needsPassword = network.security !== '' && !saved.some(profile => profile.ssid === network.ssid);
    return `
                            <form method="post" action="/maui/network/connect" class="inline-form">
                                <input type="hidden" name="ssid" value="${escapeHtml(network.ssid)}">
                                ${needsPassword ? `<input type="password" name="password" placeholder="Password" aria-label="Password for ${escapeHtml(network.ssid)}"
                                    minlength="8" maxlength="64" autocomplete="off" required>` : ''}
                                <button type="submit">Connect</button>
                            </form>`;
}

function renderNetworks(state: NetworkState): string {
    const rows = state.networks.map(network => `
                    <tr>
                        <td>${escapeHtml(network.ssid)}</td>
                        <td>${network.signal}%</td>
                        <td>${escapeHtml(network.security || 'Open')}</td>
                        <td><span class="row-actions">${renderNetworkAction(network, state.saved)}</span></td>
                    </tr>`).join('');
    return `
            <h3>Networks in range</h3>
            <form method="post" action="/maui/network/scan">
                <button type="submit">Scan again</button>
            </form>
            ${rows ? `
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead><tr><th>Network</th><th>Signal</th><th>Security</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>` : '<p class="info">No network found. A radio just switched on needs a few seconds: scan again.</p>'}`;
}

function renderSaved(state: NetworkState, onlyLink: boolean): string {
    if (!state.saved.length) {
        return '';
    }
    const rows = state.saved.map(profile => `
                    <tr>
                        <td>${escapeHtml(profile.ssid)}${profile.active ? ' <em>(in use)</em>' : ''}</td>
                        <td>${profile.active && onlyLink ? '' : `
                            <form method="post" action="/maui/network/forget" class="inline-form"
                                onsubmit="return confirm('Forget this network and its password?')">
                                <input type="hidden" name="uuid" value="${escapeHtml(profile.uuid)}">
                                <button type="submit" class="button-danger">Forget</button>
                            </form>`}</td>
                    </tr>`).join('');
    return `
            <h3>Saved networks</h3>
            <p class="info">The cabinet joins these on its own when they are in range.</p>
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead><tr><th>Network</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
}

function renderWifi(state: NetworkState): string {
    if (state.wifi === 'missing') {
        return '<p class="info">This cabinet has no Wi-Fi adapter.</p>';
    }
    if (state.wifi === 'blocked') {
        return '<p class="info">The Wi-Fi adapter is switched off by a hardware switch.</p>';
    }
    const onlyLink = isWifiTheOnlyLink(state);
    return renderRadioForm(state.wifi === 'on', onlyLink)
        + (state.wifi === 'on' ? renderNetworks(state) : '')
        + renderSaved(state, onlyLink);
}

export function renderNetworkCard(state: NetworkState, messages: NetworkCardMessages = {}): string {
    return `
        <section class="card">
            <h2>Network</h2>
            ${messages.error ? `<p class="error flash">${escapeHtml(messages.error)}</p>` : ''}
            ${messages.info ? `<p class="info flash">${escapeHtml(messages.info)}</p>` : ''}
            <p class="info">The cabinet's own connections. Joining another Wi-Fi from a page reached
            over the Wi-Fi changes the cabinet's address: this page stops answering, and the cabinet's
            screen shows the new address (back office key). A connection that fails puts the cabinet
            back on the network it was on.</p>
            ${state.links.length ? `<dl>${state.links.map(renderLink).join('')}</dl>` : '<p class="info">No network adapter found.</p>'}
            ${renderWifi(state)}
        </section>`;
}
