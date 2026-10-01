import {escapeHtml} from '@/class/EscapeHtml';
import type {OnlinePlayerStatus} from '@/class/MauiApiClient';
import type {RegistrationOutcome} from '@/class/OnlineRegistration';

// The ONLINE side of the BO's Players tab (maui-api docs/DECISIONS.md D48, D49), shown while ONLINE
// is on: each player's MAUI-API status, and the actions on it. A PIN is shown in the flash message
// of the action that produced it and never stored here; MAUI-API admins can read it back.

export interface OnlineUserView {
    id_user: number;
    pseudo_3: string;
    remote_id: string | null;
    is_public: boolean;
    online_status: OnlinePlayerStatus | null;
}

export function renderOnlinePlayerStatus(user: OnlineUserView): string {
    if (user.remote_id === null) {
        return '<span class="badge-no" title="Not in MAUI-API: no shared leaderboard">local only</span>';
    }
    switch (user.online_status) {
        case 'disabled':
            return '<span class="badge-no" title="Disabled by a MAUI-API administrator">✗ disabled</span>';
        case 'locked':
            return '<span class="badge-no" title="Too many wrong PINs: issue a new PIN">🔒 PIN locked</span>';
        default:
            return user.is_public
                ? '<span class="badge-yes" title="Scores in the shared leaderboards">✓ public</span>'
                : '<span class="badge-yes" title="Linked, scores kept out of the shared leaderboards">✓ private</span>';
    }
}

export function renderOnlinePlayerActions(user: OnlineUserView): string {
    const action = (path: string) => `/users/${user.id_user}/online/${path}`;
    if (user.remote_id === null) {
        return `
            <form method="post" action="${action('link')}" class="inline-form"
                title="Reserves these initials in MAUI-API, or links the player who has them elsewhere (PIN)">
                <input type="text" name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" size="4"
                    placeholder="PIN" aria-label="PIN, if these initials play on another cabinet">
                <button type="submit">Go ONLINE</button>
            </form>`;
    }
    if (user.online_status === 'disabled') {
        return '';
    }
    const pseudo = escapeHtml(user.pseudo_3);
    return `
        <form method="post" action="${action('public')}">
            <button type="submit">${user.is_public ? 'Make private' : 'Make public'}</button>
        </form>
        <form method="post" action="${action('pin')}"
            onsubmit="return confirm('Issue a new PIN for ${pseudo}? The current one stops working.')">
            <button type="submit">New PIN</button>
        </form>`;
}

/** Fields added to the "Add a player" form while ONLINE is on. */
export function renderCreateOnlineFields(): string {
    return `
        <label class="checkbox-row">
            <input type="checkbox" name="is_public">
            Public scores (shared leaderboards)
        </label>
        <label for="pin">PIN, only if these initials already play on another cabinet</label>
        <input type="text" id="pin" name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}">`;
}

export function describeOutcomeForBo(pseudo3: string, outcome: RegistrationOutcome): {info?: string; error?: string} {
    switch (outcome.kind) {
        case 'created':
            return {info: `Player "${pseudo3}" reserved in MAUI-API. PIN: ${outcome.pin}. Give it to the player: `
            + 'it is needed to play as them on another cabinet. If lost, a MAUI-API administrator can read it.'};
        case 'pin_required':
            return {error: `"${pseudo3}" already plays on another cabinet: enter their PIN to link them here.`};
        case 'linked':
            return {info: `Player "${pseudo3}" linked to this cabinet.`};
        case 'error':
            return {error: outcome.message};
    }
}
