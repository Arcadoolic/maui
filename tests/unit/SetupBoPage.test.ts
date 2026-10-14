import {describe, it, expect} from 'vitest';
import {renderSetupNavLabel, renderSetupPage, type SetupPageInput} from '@/class/SetupBoPage';
import {describeSetup, type SetupFacts} from '@/class/SetupSteps';

const FRESH: SetupFacts = {
    passwordChanged: true,
    mameReady: false,
    missingPlugins: [],
    disabledRequiredPlugins: ['hiscore'],
    pluginsFound: false,
    onlineActive: false,
    offlineChosen: false,
    missingConfPackFiles: ['genre.ini'],
    favoritesCount: 0,
};

function page(facts: SetupFacts, extra: Partial<SetupPageInput> = {}): string {
    return renderSetupPage({progress: describeSetup(facts), facts, mamePath: '', pluginsPath: '', ...extra});
}

describe('renderSetupPage', () => {
    it('shows the form of the current step only', () => {
        const html = page(FRESH);
        expect(html).toContain('action="/setup/mame"');
        expect(html).toContain('aria-current="step"');
        expect(html).not.toContain('action="/setup/online"');
        expect(html).not.toContain('action="/setup/plugins"');
        expect(html).not.toContain('action="/import/conf-pack"');
        expect(html).toContain('1 of\n            6 done');
    });

    it('brings the browsed folder back to the guide', () => {
        const html = page(FRESH, {mamePath: '/opt/mame'});
        expect(html).toContain('name="from" value="setup"');
        expect(html).toContain('formaction="/browse"');
        expect(html).toContain('value="/opt/mame"');
    });

    it('asks for the plugins folder when no plugin is found, a single button otherwise', () => {
        const mame = {...FRESH, mameReady: true};
        expect(page(mame)).toContain('No plugin found');
        const found = page({...mame, pluginsFound: true});
        expect(found).toContain('Switch on the plugins');
        expect(found).not.toContain('No plugin found');
    });

    it('streams the pack imports and brings them back here', () => {
        const html = page({...FRESH, mameReady: true, pluginsFound: true, disabledRequiredPlugins: [], onlineActive: true});
        expect(html).toMatch(/action="\/import\/conf-pack" data-stream>\s*<input type="hidden" name="from" value="setup">/);
    });

    it('says what to do by hand OFFLINE, and offers the way back to ONLINE', () => {
        const html = page({...FRESH, mameReady: true, pluginsFound: true, disabledRequiredPlugins: [], offlineChosen: true});
        expect(html).toContain('OFFLINE: copy catver.ini');
        expect(html).toContain('Connect to MAUI-API after all');
        expect(html).not.toContain('action="/import/starter-pack"');
    });

    it('says the cabinet is ready once finished', () => {
        const html = page({...FRESH, mameReady: true, pluginsFound: true, disabledRequiredPlugins: [], onlineActive: true,
            missingConfPackFiles: [], favoritesCount: 3});
        expect(html).toContain('Your cabinet is ready');
        expect(html).not.toContain('aria-current="step"');
    });

    it('shows the outcome on its step, escaped', () => {
        const html = page(FRESH, {message: {step: 'mame', error: 'No mame binary found in "<x>".'}});
        expect(html).toContain('No mame binary found in &quot;&lt;x&gt;&quot;.');
    });
});

describe('renderSetupNavLabel', () => {
    it('counts the steps done', () => {
        expect(renderSetupNavLabel(describeSetup(FRESH))).toBe('Getting started 1/6');
    });
});
