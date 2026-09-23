import type Category from '@/model/Category.model';
import type {CarouselCategory, MergedCategory} from '@/types/CarouselCategory';

const TTL_PREFIX = /^TTL \* /;

/**
 * Icon key of a category: its name minus mame's "TTL * " prefix (discrete-logic games, e.g.
 * "TTL * Shooter" - same icon as the non-TTL category since it's the same kind of game), with
 * every run of separators turned into '_' and lowercased ("Ball & Paddle" -> "ball_paddle"). It
 * is both the CSS class the Home carousel maps to src/assets/categories/<key>.svg and the icon
 * file name the BO Categories tab looks up. The replace() needs /g: without it, only the first
 * run of separators became '_' and any later one (e.g. the second space in "Musical Instrument
 * Accessory") stayed literal, breaking the key.
 */
export function getCategoryIconKey(categoryName: string): string {
    return categoryName.replace(TTL_PREFIX, '').replace(/[\s\W]+/g, '_').toLowerCase();
}

/** Name a category is displayed under: mame's "TTL * " prefix dropped (see mergeTtlCategories()). */
export function getCategoryDisplayName(categoryName: string): string {
    return categoryName.replace(TTL_PREFIX, '');
}

/**
 * mame's genre.ini keeps its discrete-logic games (Pong...) in a "TTL * <genre>" category next to
 * the plain "<genre>" one. In the carousel that showed the same name and icon twice, so each pair
 * becomes one entry ("Ball & Paddle") holding the games of both. A "TTL * X" with no "X" of its
 * own is shown as plain "X" too. Categories without any TTL twin are returned untouched, and
 * entries stay sorted by (displayed) name like GameService.loadCategories() returns them.
 */
export function mergeTtlCategories(categories: Category[]): CarouselCategory[] {
    const groups = new Map<string, Category[]>();
    for (const category of categories) {
        const displayName = getCategoryDisplayName(category.name);
        groups.set(displayName, [...(groups.get(displayName) ?? []), category]);
    }

    const merged: Array<{name: string; entry: CarouselCategory}> = [];
    for (const [name, members] of groups) {
        if (members.length === 1 && members[0].name === name) {
            merged.push({name, entry: members[0]});
            continue;
        }
        const entry: MergedCategory = {
            id_category: members[0].id_category,
            name,
            categoryIds: members.map(member => member.id_category),
        };
        merged.push({name, entry});
    }
    // Plain comparison, like SQLite's default (binary) ORDER BY name.
    return merged.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(item => item.entry);
}
