import {describe, it, expect} from 'vitest';
import {sortByPublishedDesc, formatPublishedAt} from '@/class/ReleaseList';

describe('sortByPublishedDesc', () => {
    it('puts the most recently published first, whatever the input order', () => {
        const sorted = sortByPublishedDesc([
            {tag: 'a', publishedAt: '2026-09-18T18:52:26Z'},
            {tag: 'c', publishedAt: '2026-09-18T18:54:34Z'},
            {tag: 'b', publishedAt: '2026-09-18T18:53:01Z'},
            {tag: 'old', publishedAt: '2026-09-17T09:00:00Z'},
        ]);
        expect(sorted.map(entry => entry.tag)).toEqual(['c', 'b', 'a', 'old']);
    });

    it('orders builds published the same day by time, not by date', () => {
        const sorted = sortByPublishedDesc([
            {tag: 'morning', publishedAt: '2026-09-18T06:00:00Z'},
            {tag: 'evening', publishedAt: '2026-09-18T20:24:16Z'},
        ]);
        expect(sorted.map(entry => entry.tag)).toEqual(['evening', 'morning']);
    });

    it('does not mutate its input', () => {
        const input = [
            {tag: 'a', publishedAt: '2026-09-17T00:00:00Z'},
            {tag: 'b', publishedAt: '2026-09-18T00:00:00Z'},
        ];
        sortByPublishedDesc(input);
        expect(input.map(entry => entry.tag)).toEqual(['a', 'b']);
    });

    it('sorts an unparseable date last and keeps unparseable ones in their original order', () => {
        const sorted = sortByPublishedDesc([
            {tag: 'bad1', publishedAt: 'nope'},
            {tag: 'ok', publishedAt: '2026-09-18T00:00:00Z'},
            {tag: 'bad2', publishedAt: ''},
        ]);
        expect(sorted.map(entry => entry.tag)).toEqual(['ok', 'bad1', 'bad2']);
    });
});

describe('formatPublishedAt', () => {
    it('shows the time as well as the date', () => {
        const formatted = formatPublishedAt('2026-09-18T20:24:16Z');
        expect(formatted).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
    });

    it('tells apart two builds published seconds apart', () => {
        expect(formatPublishedAt('2026-09-18T18:53:01Z')).not.toBe(formatPublishedAt('2026-09-18T18:53:31Z'));
    });

    it('falls back to the raw value for an unparseable date', () => {
        expect(formatPublishedAt('nope')).toBe('nope');
    });
});
