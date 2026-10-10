import type Category from '@/model/Category.model';

/**
 * A category of the Home carousel that is not a row of the `category` table: its games are
 * computed when it is selected (see Home.vue's loadCategoryGames()), so it never needs
 * maintaining as games are added or removed.
 */
export interface DynamicCategory {
    id_category: number;
    name: string;
    dynamic: 'all' | 'hiscores' | 'beat-this';
}

/**
 * Several stored categories shown as one carousel entry, e.g. mame's "Ball & Paddle" and its
 * "TTL * Ball & Paddle" (discrete-logic games of the same kind). See mergeTtlCategories().
 */
export interface MergedCategory {
    // First of categoryIds: unique among carousel entries, used as the list key.
    id_category: number;
    name: string;
    categoryIds: number[];
}

export type CarouselCategory = Category | DynamicCategory | MergedCategory;

// Negative ids: can never clash with an autoincrement `category` primary key.
export const ALL_GAMES_CATEGORY: DynamicCategory = {
    id_category: -2,
    name: 'All Games',
    dynamic: 'all',
};

// The games players have a score on, the one scored on last first (LeaderboardSource.ts).
export const BEAT_THIS_CATEGORY: DynamicCategory = {
    id_category: -3,
    name: 'Beat This!',
    dynamic: 'beat-this',
};

export const HISCORES_ONLY_CATEGORY: DynamicCategory = {
    id_category: -1,
    name: 'Hiscores Only',
    dynamic: 'hiscores',
};

export function isDynamicCategory(category: CarouselCategory): category is DynamicCategory {
    return 'dynamic' in category;
}

export function isMergedCategory(category: CarouselCategory): category is MergedCategory {
    return 'categoryIds' in category;
}
