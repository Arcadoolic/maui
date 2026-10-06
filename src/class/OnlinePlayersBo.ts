import {renderIconButton} from '@/class/BoIconButton';
import {escapeHtml} from '@/class/EscapeHtml';
import type {OnlinePlayerStatus} from '@/class/MauiApiClient';
import type {RegistrationOutcome} from '@/class/OnlineRegistration';

// The ONLINE side of the BO's Players tab (maui-api docs/DECISIONS.md D48, D49, D54), shown while
// ONLINE is on: each player's MAUI-API status, and the actions on it. A PIN is shown in the flash
// message of the action that produced it and never stored here; MAUI-API admins can read it back.
// A new PIN is only offered on the cabinet the player was created on: MAUI-API refuses it elsewhere.

export interface OnlineUserView {
    id_user: number;
    pseudo_3: string;
    remote_id: string | null;
    is_public: boolean;
    online_status: OnlinePlayerStatus | null;
    // Created on this cabinet: the only one that may issue a new PIN (maui-api D54).
    is_origin: boolean;
}

export function renderOnlinePlayerStatus(user: OnlineUserView): string {
    if (user.remote_id === null) {
        return '<span class="badge-no" title="Not in MAUI-API: no shared leaderboard">local only</span>';
    }
    switch (user.online_status) {
        case 'disabled':
            return '<span class="badge-no" title="Disabled by a MAUI-API administrator">✗ disabled</span>';
        case 'locked':
            return `<span class="badge-no" title="Too many wrong PINs: ${user.is_origin
                ? 'issue a new PIN'
                : 'a new PIN must be issued from the cabinet this player was created on, or by a MAUI-API administrator'}">🔒 PIN locked</span>`;
        default:
            return user.is_public
                ? '<span class="badge-yes" title="Scores in the shared leaderboards">✓ public</span>'
                : '<span class="badge-warn" title="Linked, scores kept out of the shared leaderboards">✓ private</span>';
    }
}

// Same colors as the status badge each one leads to: green for public, amber for private.
const EYE_ICON_PATHS = '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>';
const EYE_OFF_ICON_PATHS = `${EYE_ICON_PATHS}<path d="M2.5 13.5l11-11"/>`;
const KEY_ICON_PATHS = '<circle cx="5" cy="11" r="3"/><path d="M7.2 8.8L14 2M11 5l2 2M12.5 3.5l1.5 1.5"/>';
const CLOUD_ICON_PATHS = '<path d="M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-.9 3.2 3.2 0 0 1 .2 6.9z"/>';

export function renderOnlinePlayerActions(user: OnlineUserView): string {
    const action = (path: string) => `/users/${user.id_user}/online/${path}`;
    if (user.remote_id === null) {
        return `
            <form method="post" action="${action('link')}" class="inline-form"
                title="Reserves these initials in MAUI-API, or links the player who has them elsewhere (PIN)">
                <input type="text" name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" size="4"
                    placeholder="PIN" aria-label="PIN, if these initials play on another cabinet">
                ${renderIconButton('Go ONLINE', CLOUD_ICON_PATHS, 'ok')}
            </form>`;
    }
    if (user.online_status === 'disabled') {
        return '';
    }
    const pseudo = escapeHtml(user.pseudo_3);
    return `
        <form method="post" action="${action('public')}">
            ${user.is_public
                ? renderIconButton('Make private', EYE_OFF_ICON_PATHS, 'warn')
                : renderIconButton('Make public', EYE_ICON_PATHS, 'ok')}
        </form>
        ${user.is_origin ? `<form method="post" action="${action('pin')}"
            onsubmit="return confirm('Issue a new PIN for ${pseudo}? The current one stops working.')">
            ${renderIconButton('New PIN', KEY_ICON_PATHS, 'accent')}
        </form>` : ''}`;
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
