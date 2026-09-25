import {describe, it, expect} from 'vitest';
import {renderOnlineCard} from '@/class/OnlineBoCard';

const configured = {state: 'configured' as const, url: 'https://api.example.org', key: 'mk_7F3aQ9dLx2PzK8wR4mT6vYb1'};

describe('renderOnlineCard', () => {
    it('offers only the paste form when nothing is configured', () => {
        const html = renderOnlineCard({state: 'unconfigured'});
        expect(html).toContain('action="/maui/online/save"');
        expect(html).toContain('name="configuration"');
        expect(html).not.toContain('action="/maui/online/test"');
    });

    it('shows url and key, the test button, and a new paste form once configured', () => {
        const html = renderOnlineCard(configured);
        expect(html).toContain('https://api.example.org');
        expect(html).toContain('mk_7F3aQ9dLx2PzK8wR4mT6vYb1');
        expect(html).toContain('action="/maui/online/test"');
        expect(html).toContain('action="/maui/online/save"');
    });

    it('warns that the first successful test binds the credentials to this cabinet', () => {
        expect(renderOnlineCard(configured)).toMatch(/binds/);
    });

    it('never prefills the paste field', () => {
        const html = renderOnlineCard(configured);
        expect(html).toMatch(/<input[^>]*name="configuration"[^>]*value=""/);
    });

    it('escapes every value', () => {
        const html = renderOnlineCard(
            {state: 'configured', url: 'https://x.org/"><script>', key: '<b>k</b>'},
            {error: '<img src=x>', info: '"quoted"'},
        );
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<b>k</b>');
        expect(html).not.toContain('<img src=x>');
        expect(html).toContain('&lt;img src=x&gt;');
        expect(html).toContain('&quot;quoted&quot;');
    });

    it('offers only the reset for an unreadable settings file, no form that would overwrite it', () => {
        const html = renderOnlineCard({state: 'unreadable', message: 'Unreadable ONLINE settings file: /x/online.json'});
        expect(html).toContain('/x/online.json');
        expect(html).toContain('action="/maui/online/reset"');
        expect(html).not.toContain('action="/maui/online/save"');
        expect(html).not.toContain('action="/maui/online/test"');
    });

    it('shows the outcome flashes of a reset', () => {
        const html = renderOnlineCard({state: 'unconfigured'}, {info: 'Reset done.'});
        expect(html).toContain('Reset done.');
    });

    it('never offers the reset when the file is readable', () => {
        expect(renderOnlineCard(configured)).not.toContain('/maui/online/reset');
        expect(renderOnlineCard({state: 'unconfigured'})).not.toContain('/maui/online/reset');
    });

    it('renders info and error flashes', () => {
        const html = renderOnlineCard(configured, {info: 'Saved.', error: 'Nope.'});
        expect(html).toContain('class="info flash"');
        expect(html).toContain('class="error flash"');
    });
});
