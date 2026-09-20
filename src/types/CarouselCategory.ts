import type Category from '@/model/Category.model';

/**
 * A category of the Home carousel that is not a row of the `category` table: its games are
 * computed when it is selected (see GameService.loadHiscoreGames()), so it never needs
 * maintaining as games are added or removed.
 */
export interface DynamicCategory {
    id_category: number;
    name: string;
    dynamic: 'hiscores';
}

export type CarouselCategory = Category | DynamicCategory;

// Negative id: can never clash with an autoincrement `category` primary key.
export const HISCORES_ONLY_CATEGORY: DynamicCategory = {
    id_category: -1,
    name: 'Hiscores Only',
    dynamic: 'hiscores',
};

export function isDynamicCategory(category: CarouselCategory): category is DynamicCategory {
    return 'dynamic' in category;
}
