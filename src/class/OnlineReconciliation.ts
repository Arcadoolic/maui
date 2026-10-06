// Switching a cabinet to ONLINE with players created locally before (maui-api docs/DECISIONS.md
// D4, D48: initials are unique across the fleet). ONLINE only turns on once every active local
// player is in MAUI-API: reserved, linked to the player who has those initials elsewhere (PIN), or
// deactivated. While ONLINE is on, a local-only player cannot be activated again without going
// through MAUI-API first, so no score is ever attributed to initials someone else owns.

export interface ReconciledPlayer {
    pseudo_3: string;
    active: boolean;
    remote_id: string | null;
}

/** Why ONLINE cannot be turned on yet, or null when it can. */
export function playersBlockingOnline(players: ReconciledPlayer[]): string | null {
    const missing = players
        .filter(player => player.active && player.remote_id === null)
        .map(player => player.pseudo_3)
        .sort();
    if (missing.length === 0) {
        return null;
    }
    return `Before turning ONLINE on, every active player must be in MAUI-API. Not yet: ${missing.join(', ')}. `
        + 'In the Players tab, use "Go ONLINE" on each (with their PIN if their initials already play on '
        + 'another cabinet), or deactivate them.';
}

export function canActivateLocally(player: ReconciledPlayer, onlineEnabled: boolean): boolean {
    return !onlineEnabled || player.remote_id !== null;
}

/**
 * A player MAUI-API's admins disabled, while ONLINE is on: only they can enable them again, so the
 * BO neither activates nor deactivates them locally. In LOCAL mode, MAUI-API has no say.
 */
export function isDisabledUpstream(player: {online_status: string | null}, onlineEnabled: boolean): boolean {
    return onlineEnabled && player.online_status === 'disabled';
}

export interface Scorer {
    active: boolean;
    remote_id: string | null;
    online_status: string | null;
}

/**
 * Whether a score found under a player's initials is theirs: an active player, and in ONLINE mode
 * a player of MAUI-API that its admins have not disabled. A PIN lock only blocks linking to a new
 * cabinet, not playing on the cabinets already linked.
 */
export function canReceiveScores(player: Scorer, onlineEnabled: boolean): boolean {
    if (!player.active) {
        return false;
    }
    return !onlineEnabled || (player.remote_id !== null && player.online_status !== 'disabled');
}
