import {describe, it, expect, vi} from 'vitest';
import {linkWithPin, registerOnline} from '@/class/OnlineRegistration';
import type {MauiApiClient, OnlinePlayer} from '@/class/MauiApiClient';

const player: OnlinePlayer = {id: '01a0f983-0000-7000-8000-00000000000a', pseudo3: 'ACE', isPublic: false, status: 'active'};
const rejected = (status: number, code: string, attemptsLeft?: number) =>
    ({kind: 'rejected' as const, status, code, ...(attemptsLeft === undefined ? {} : {attemptsLeft})});

function client(overrides: Partial<Record<'createPlayer' | 'linkPlayer', unknown>>): MauiApiClient {
    return overrides as unknown as MauiApiClient;
}

describe('registerOnline', () => {
    it('creates a private player, saves it and returns the PIN to show', async () => {
        const createPlayer = vi.fn(async () => ({kind: 'ok', value: {player, pin: '0042'}}));
        const save = vi.fn(async () => undefined);

        expect(await registerOnline(client({createPlayer}), 'ACE', save)).toEqual({kind: 'created', pin: '0042'});
        expect(createPlayer).toHaveBeenCalledWith('ACE', false);
        expect(save).toHaveBeenCalledWith(player);
    });

    it('asks for the PIN when the initials belong to another player', async () => {
        const save = vi.fn();
        const outcome = await registerOnline(client({createPlayer: async () => rejected(409, 'initials_taken')}), 'ACE', save);

        expect(outcome).toEqual({kind: 'pin_required'});
        expect(save).not.toHaveBeenCalled();
    });

    it('refuses the registration when MAUI-API cannot be reached', async () => {
        const outcome = await registerOnline(
            client({createPlayer: async () => ({kind: 'unavailable', reason: 'network'})}), 'ACE', vi.fn(),
        );

        expect(outcome).toEqual({kind: 'error', message: expect.stringMatching(/unreachable/i)});
    });
});

describe('linkWithPin', () => {
    it('links the player and saves it', async () => {
        const save = vi.fn(async () => undefined);

        expect(await linkWithPin(client({linkPlayer: async () => ({kind: 'ok', value: player})}), 'ACE', '1234', save))
            .toEqual({kind: 'linked'});
        expect(save).toHaveBeenCalledWith(player);
    });

    it('gives the attempts left after a wrong PIN', async () => {
        const outcome = await linkWithPin(client({linkPlayer: async () => rejected(403, 'pin_invalid', 2)}), 'ACE', '0000', vi.fn());

        expect(outcome).toEqual({kind: 'error', message: 'Wrong PIN, 2 tries left.', retry: true});
    });

    it('explains a locked or disabled player', async () => {
        const locked = await linkWithPin(client({linkPlayer: async () => rejected(423, 'player_locked')}), 'ACE', '0000', vi.fn());
        const disabled = await linkWithPin(client({linkPlayer: async () => rejected(403, 'player_disabled')}), 'ACE', '0000', vi.fn());

        expect(locked).toEqual({kind: 'error', message: expect.stringMatching(/new PIN/)});
        expect(disabled).toEqual({kind: 'error', message: expect.stringMatching(/disabled/)});
    });
});
