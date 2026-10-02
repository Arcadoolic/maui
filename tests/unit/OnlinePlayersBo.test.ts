import {describe, it, expect} from 'vitest';
import {
    describeOutcomeForBo, renderCreateOnlineFields, renderOnlinePlayerActions, renderOnlinePlayerStatus,
    type OnlineUserView,
} from '@/class/OnlinePlayersBo';

const local: OnlineUserView = {id_user: 3, pseudo_3: 'SAJ', remote_id: null, is_public: false, online_status: null};
const linked: OnlineUserView = {...local, remote_id: '01a0f983-0000-7000-8000-00000000000a', online_status: 'active'};

describe('renderOnlinePlayerStatus', () => {
    it('tells local-only, private, public, locked and disabled players apart', () => {
        expect(renderOnlinePlayerStatus(local)).toContain('local only');
        expect(renderOnlinePlayerStatus(linked)).toContain('private');
        expect(renderOnlinePlayerStatus(linked)).toContain('badge-warn');
        expect(renderOnlinePlayerStatus({...linked, is_public: true})).toContain('public');
        expect(renderOnlinePlayerStatus({...linked, is_public: true})).toContain('badge-yes');
        expect(renderOnlinePlayerStatus({...linked, online_status: 'locked'})).toContain('PIN locked');
        expect(renderOnlinePlayerStatus({...linked, online_status: 'disabled'})).toContain('disabled');
    });
});

describe('renderOnlinePlayerActions', () => {
    it('offers to reserve or link a local-only player, with an optional PIN', () => {
        const html = renderOnlinePlayerActions(local);
        expect(html).toContain('action="/users/3/online/link"');
        expect(html).toMatch(/<input[^>]*name="pin"[^>]*pattern="\[0-9\]\{4\}"/);
    });

    it('offers visibility and a new PIN for a linked player', () => {
        const html = renderOnlinePlayerActions(linked);
        expect(html).toContain('action="/users/3/online/public"');
        expect(html).toContain('Make public');
        expect(html).toContain('action="/users/3/online/pin"');
        expect(renderOnlinePlayerActions({...linked, is_public: true})).toContain('Make private');
    });

    it('colors the visibility button like the status it leads to', () => {
        expect(renderOnlinePlayerActions(linked)).toContain('icon-button icon-button-ok');
        expect(renderOnlinePlayerActions({...linked, is_public: true})).toContain('icon-button icon-button-warn');
        expect(renderOnlinePlayerActions(linked)).toContain('icon-button icon-button-accent');
    });

    it('offers nothing for a player disabled in MAUI-API', () => {
        expect(renderOnlinePlayerActions({...linked, online_status: 'disabled'})).toBe('');
    });
});

describe('renderCreateOnlineFields', () => {
    it('asks for the visibility and the PIN of initials already used elsewhere', () => {
        const html = renderCreateOnlineFields();
        expect(html).toContain('name="is_public"');
        expect(html).toContain('name="pin"');
    });
});

describe('describeOutcomeForBo', () => {
    it('shows the new PIN once', () => {
        expect(describeOutcomeForBo('SAJ', {kind: 'created', pin: '0042'}).info).toContain('0042');
    });

    it('asks for the PIN of initials taken', () => {
        expect(describeOutcomeForBo('SAJ', {kind: 'pin_required'}).error).toMatch(/PIN/);
    });

    it('confirms a link and passes errors through', () => {
        expect(describeOutcomeForBo('SAJ', {kind: 'linked'}).info).toContain('linked');
        expect(describeOutcomeForBo('SAJ', {kind: 'error', message: 'Wrong PIN.'}).error).toBe('Wrong PIN.');
    });
});
