import type {ApiFailure, MauiApiClient, OnlinePlayer} from '@/class/MauiApiClient';

// Registering a player on the cabinet in ONLINE mode (maui-api docs/DECISIONS.md D4, D48): the
// initials are reserved in MAUI-API first, synchronously, so an unreachable API means no new
// player. Initials already taken lead to the PIN of that player, which links it to this cabinet.
// Players start private, unless the BO says otherwise.

export type RegistrationOutcome =
    | {kind: 'created'; pin: string}
    | {kind: 'pin_required'}
    | {kind: 'linked'}
    // `retry`: the same screen can be tried again (a wrong PIN with tries left).
    | {kind: 'error'; message: string; retry?: boolean};

/** Saves the local player for an API player (UserService.saveOnlineUser()). */
export type SaveOnlinePlayer = (player: OnlinePlayer) => Promise<unknown>;

function describe(failure: ApiFailure): RegistrationOutcome {
    if (failure.kind !== 'rejected') {
        return {kind: 'error', message: 'MAUI-API unreachable: try again later.'};
    }
    switch (failure.code) {
        case 'pin_invalid':
            return failure.attemptsLeft
                ? {kind: 'error', message: `Wrong PIN, ${failure.attemptsLeft} ${failure.attemptsLeft > 1 ? 'tries' : 'try'} left.`, retry: true}
                : {kind: 'error', message: 'Wrong PIN.', retry: true};
        case 'player_locked':
            return {kind: 'error', message: 'Too many wrong PINs: get a new PIN from a cabinet of this player.'};
        case 'player_disabled':
            return {kind: 'error', message: 'This player has been disabled: contact an administrator.'};
        case 'player_not_found':
            return {kind: 'error', message: 'Unknown player.'};
        default:
            return {kind: 'error', message: `MAUI-API refused the request (${failure.code}).`};
    }
}

export async function registerOnline(
    client: MauiApiClient, pseudo3: string, save: SaveOnlinePlayer, isPublic: boolean = false,
): Promise<RegistrationOutcome> {
    const result = await client.createPlayer(pseudo3, isPublic);
    if (result.kind === 'ok') {
        await save(result.value.player);
        return {kind: 'created', pin: result.value.pin};
    }
    if (result.kind === 'rejected' && result.code === 'initials_taken') {
        return {kind: 'pin_required'};
    }
    return describe(result);
}

export async function linkWithPin(
    client: MauiApiClient, pseudo3: string, pin: string, save: SaveOnlinePlayer,
): Promise<RegistrationOutcome> {
    const result = await client.linkPlayer(pseudo3, pin);
    if (result.kind === 'ok') {
        await save(result.value);
        return {kind: 'linked'};
    }
    return describe(result);
}
