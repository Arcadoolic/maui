import {escapeHtml} from '@/class/EscapeHtml';
import {SCAN_SECONDS, type BluetoothDevice, type BluetoothState} from '@/class/BluetoothControl';

// The MAUI tab's Bluetooth card, on a dedicated cabinet (BluetoothControl.ts).

export interface BluetoothCardMessages {
    error?: string;
    info?: string;
    // What the search just found; undefined when none was run for this page.
    found?: BluetoothDevice[];
}

function renderPaired(paired: BluetoothDevice[]): string {
    if (!paired.length) {
        return '<p class="info">No device paired yet.</p>';
    }
    const rows = paired.map(device => `
                    <tr>
                        <td>${escapeHtml(device.name || device.address)}</td>
                        <td>${device.connected ? 'Connected' : 'Not connected'}${device.battery !== null ? ` - battery ${device.battery}%` : ''}</td>
                        <td>
                            <form method="post" action="/maui/bluetooth/remove" class="inline-form"
                                onsubmit="return confirm('Forget this device? It will have to be paired again.')">
                                <input type="hidden" name="address" value="${escapeHtml(device.address)}">
                                <button type="submit" class="button-danger">Forget</button>
                            </form>
                        </td>
                    </tr>`).join('');
    return `
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead><tr><th>Device</th><th>State</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
}

function renderFoundRows(devices: BluetoothDevice[]): string {
    return devices.map(device => `
                    <tr>
                        <td>${escapeHtml(device.name)}</td>
                        <td><code>${escapeHtml(device.address)}</code></td>
                        <td>
                            <form method="post" action="/maui/bluetooth/pair" class="inline-form">
                                <input type="hidden" name="address" value="${escapeHtml(device.address)}">
                                <input type="hidden" name="name" value="${escapeHtml(device.name)}">
                                <button type="submit">Pair</button>
                            </form>
                        </td>
                    </tr>`).join('');
}

function renderFoundTable(devices: BluetoothDevice[]): string {
    return `
            <div class="table-wrap">
                <table class="favorites-table">
                    <thead><tr><th>Device</th><th>Address</th><th></th></tr></thead>
                    <tbody>${renderFoundRows(devices)}</tbody>
                </table>
            </div>`;
}

// Gamepads on top; what did not say what it is stays one click away, some pads only tell once paired.
function renderFound(found: BluetoothDevice[]): string {
    const gamepads = found.filter(device => device.gamepad);
    const others = found.filter(device => !device.gamepad);
    return (gamepads.length
        ? renderFoundTable(gamepads)
        : '<p class="info">No gamepad found. Check that it is in its pairing mode (its light blinks fast), then search again.</p>')
        + (others.length ? `
            <details>
                <summary>Other devices in range (${others.length})</summary>
                ${renderFoundTable(others)}
            </details>` : '');
}

function renderPowerForm(on: boolean): string {
    return `
            <form method="post" action="/maui/bluetooth/power">
                <input type="hidden" name="bluetooth" value="${on ? 'off' : 'on'}">
                <button type="submit">Turn Bluetooth ${on ? 'off' : 'on'}</button>
            </form>`;
}

function renderBody(state: BluetoothState, found?: BluetoothDevice[]): string {
    if (state.power === 'missing') {
        return '<p class="info">This cabinet has no Bluetooth adapter.</p>';
    }
    if (state.power === 'off') {
        return '<p class="info">Bluetooth is off.</p>' + renderPowerForm(false);
    }
    return `
            <h3>Paired devices</h3>
            <p class="info">A paired gamepad connects on its own when it is switched on.</p>
            ${renderPaired(state.paired)}
            <h3>Pair a gamepad</h3>
            <p class="info">Put the gamepad in its pairing mode first, then search: it takes ${SCAN_SECONDS} seconds.
            Pairing itself can take half a minute.</p>
            <form method="post" action="/maui/bluetooth/scan">
                <button type="submit">Search for gamepads</button>
            </form>
            ${found ? renderFound(found) : ''}
            <h3>Adapter</h3>
            ${renderPowerForm(true)}`;
}

export function renderBluetoothCard(state: BluetoothState, messages: BluetoothCardMessages = {}): string {
    return `
        <section class="card">
            <h2>Bluetooth gamepads</h2>
            ${messages.error ? `<p class="error flash">${escapeHtml(messages.error)}</p>` : ''}
            ${messages.info ? `<p class="info flash">${escapeHtml(messages.info)}</p>` : ''}
            ${renderBody(state, messages.found)}
        </section>`;
}
