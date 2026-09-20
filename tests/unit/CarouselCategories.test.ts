import {describe, it, expect} from 'vitest';
import type Category from '@/model/Category.model';
import {mergeTtlCategories} from '@/class/CarouselCategories';
import {isMergedCategory} from '@/types/CarouselCategory';

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
