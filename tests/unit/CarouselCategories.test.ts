import {describe, it, expect} from 'vitest';
import type Category from '@/model/Category.model';
import {buildCarousel, getCategoryIconKey, mergeTtlCategories, type CarouselOptions} from '@/class/CarouselCategories';
import {
    ALL_GAMES_CATEGORY, HISCORES_ONLY_CATEGORY, BEAT_THIS_CATEGORY, isMergedCategory,
} from '@/types/CarouselCategory';

const category = (id: number, name: string) => ({id_category: id, name}) as unknown as Category;

describe('mergeTtlCategories', () => {
    it('merges a TTL category into its plain twin, keeping both ids', () => {
        const result = mergeTtlCategories([
            category(4, 'Ball & Paddle'),
            category(9, 'Maze'),
            category(50, 'TTL * Ball & Paddle'),
        ]);

        expect(result.map(entry => entry.name)).toEqual(['Ball & Paddle', 'Maze']);
        const ballPaddle = result[0];
        expect(isMergedCategory(ballPaddle) && ballPaddle.categoryIds).toEqual([4, 50]);
        expect(ballPaddle.id_category).toBe(4);
    });

    it('leaves a category without TTL twin untouched (same object)', () => {
        const maze = category(9, 'Maze');

        const result = mergeTtlCategories([maze]);

        expect(result).toEqual([maze]);
        expect(result[0]).toBe(maze);
    });

    it('shows a TTL category without plain twin under its plain name', () => {
        const result = mergeTtlCategories([category(50, 'TTL * Quiz')]);

        expect(result).toEqual([{id_category: 50, name: 'Quiz', categoryIds: [50]}]);
    });

    it('keeps entries sorted by displayed name, whatever the source order', () => {
        const result = mergeTtlCategories([
            category(1, 'Driving'),
            category(2, 'Shooter'),
            category(3, 'TTL * Ball & Paddle'),
            category(4, 'TTL * Shooter'),
        ]);

        expect(result.map(entry => entry.name)).toEqual(['Ball & Paddle', 'Driving', 'Shooter']);
    });

    it('does not touch a name that merely contains TTL', () => {
        const result = mergeTtlCategories([category(1, 'Settled * Games')]);

        expect(result.map(entry => entry.name)).toEqual(['Settled * Games']);
    });
});

describe('buildCarousel', () => {
    const everything: CarouselOptions = {
        showAllGames: true,
        showBeatThis: true,
        showHiscoresOnly: true,
        hasBeatThisGames: true,
        hasHiscoreGames: true,
    };
    const maze = category(9, 'Maze');

    it('puts "All Games", "Beat This!" and "Hiscores Only" before the genres', () => {
        expect(buildCarousel([maze], everything)).toEqual([
            ALL_GAMES_CATEGORY, BEAT_THIS_CATEGORY, HISCORES_ONLY_CATEGORY, maze,
        ]);
    });

    it('leaves out the categories hidden from the BO', () => {
        expect(buildCarousel([maze], {...everything, showAllGames: false})).toEqual([
            BEAT_THIS_CATEGORY, HISCORES_ONLY_CATEGORY, maze,
        ]);
        expect(buildCarousel([maze], {...everything, showBeatThis: false, showHiscoresOnly: false})).toEqual([
            ALL_GAMES_CATEGORY, maze,
        ]);
    });

    it('leaves out a category that would be empty', () => {
        expect(buildCarousel([maze], {...everything, hasBeatThisGames: false, hasHiscoreGames: false})).toEqual([
            ALL_GAMES_CATEGORY, maze,
        ]);
    });

    it('falls back on "All Games" rather than an empty carousel', () => {
        expect(buildCarousel([], {
            ...everything, showAllGames: false, hasBeatThisGames: false, hasHiscoreGames: false,
        })).toEqual([ALL_GAMES_CATEGORY]);
    });

    it('gives its three own entries ids that clash with nothing', () => {
        const ids = [ALL_GAMES_CATEGORY, BEAT_THIS_CATEGORY, HISCORES_ONLY_CATEGORY].map(entry => entry.id_category);
        expect(new Set(ids).size).toBe(3);
        expect(ids.every(id => id < 0)).toBe(true);
    });
});

describe('getCategoryIconKey', () => {
    it('gives "Beat This!" the key of its icon file, without its closing punctuation', () => {
        expect(getCategoryIconKey(BEAT_THIS_CATEGORY.name)).toBe('beat_this');
    });
});
