/**
 * progettoSNAPS' catver.ini (https://www.progettosnaps.net/catver/) files every machine as
 * "<genre> / <subgenre>" in its [Category] section (e.g. "sf2=Fighter / Versus",
 * "ffight=Fighter / 2.5D"), where genre.ini only has the genre ("Fighter" for both). Its genres
 * are the same as genre.ini's; the subgenres are what lets the carousel tell a versus fighting
 * game from a beat 'em up. Used raw they are too many (300+, most with a handful of machines),
 * so the rules below regroup them into a few MAUI genres; any other category falls back to its
 * plain catver genre, i.e. the same category genre.ini gives it.
 */

const TTL_PREFIX = /^TTL \* /;
const MATURE_SUFFIX = /\s*\* Mature \*$/;

export const FIGHTING = 'Fighting';
export const BEAT_EM_UP = 'Beat \'em Up';
export const ACTION_PLATFORMER = 'Action Platformer';
export const RUN_N_GUN = 'Run \'n Gun';
export const SHOOT_EM_UP = 'Shoot \'em Up';
export const FIXED_SHOOTER = 'Fixed Shooter';
export const LIGHT_GUN = 'Light Gun';
export const MULTIDIRECTIONAL_SHOOTER = 'Multidirectional Shooter';
export const RAIL_SHOOTER = 'Rail Shooter';

/** catver "<genre> / <subgenre>" (TTL prefix and Mature flag dropped) -> MAUI genre. */
const SUBGENRE_RULES = new Map<string, string>([
    // Street Fighter, King of Fighters, Mortal Kombat, Tekken, Virtua Fighter...
    ['Fighter / Versus', FIGHTING],
    // Red Earth, Warzard, Mega Man: The Power Battle: versus fights against a boss series.
    ['Fighter / Versus Co-op', FIGHTING],
    // CPS3 bootleg sets bundling the Street Fighter III games.
    ['Fighter / Compilation', FIGHTING],
    // Shinobi, Rastan, Ghosts'n Goblins, Altered Beast...
    ['Platform / Fighter Scrolling', ACTION_PLATFORMER],
    ['Platform / Fighter', ACTION_PLATFORMER],
    // Metal Slug, Contra, Sunset Riders / Commando, Ikari Warriors, Mercs.
    ['Platform / Shooter Scrolling', RUN_N_GUN],
    ['Shooter / Walking', RUN_N_GUN],
    // R-Type, 1942, Gradius, DoDonPachi, Silkworm, In the Hunt...
    ['Shooter / Flying', SHOOT_EM_UP],
    ['Shooter / Flying Horizontal', SHOOT_EM_UP],
    ['Shooter / Flying Vertical', SHOOT_EM_UP],
    ['Shooter / Flying Diagonal', SHOOT_EM_UP],
    ['Shooter / Misc. Horizontal', SHOOT_EM_UP],
    ['Shooter / Misc. Vertical', SHOOT_EM_UP],
    // Space Invaders, Galaxian, Galaga.
    ['Shooter / Gallery', FIXED_SHOOTER],
    // Operation Wolf, Time Crisis, House of the Dead.
    ['Shooter / Gun', LIGHT_GUN],
    ['Shooter / Light Gun', LIGHT_GUN],
    ['Shooter / Rifle', LIGHT_GUN],
    // Asteroids, Robotron: 2084, Smash T.V., Time Pilot, Bosconian: free movement on an open field.
    ['Shooter / Field', MULTIDIRECTIONAL_SHOOTER],
    // Space Harrier, After Burner, Star Wars, Gyruss: flying into the screen.
    ['Shooter / Flying (chase view)', RAIL_SHOOTER],
    ['Shooter / Flying 1st Person', RAIL_SHOOTER],
]);

/**
 * catver genre -> MAUI genre, for a subgenre no rule above maps. Every other "Fighter" subgenre
 * (2.5D: Final Fight, Double Dragon, TMNT; 2D: Kung-Fu Master; Vertical: Avengers; 3D: Spikeout)
 * is a beat 'em up.
 */
const GENRE_DEFAULTS = new Map<string, string>([
    ['Fighter', BEAT_EM_UP],
]);

/** Sets (clones included) catver files under a subgenre that doesn't match how they play. */
const ROM_OVERRIDES = new Map<string, string>([
    // Beat 'em ups filed under "Platform / Fighter Scrolling".
    ...['vigilant', 'vigilanta', 'vigilantb', 'vigilantbl', 'vigilantc', 'vigilantd', 'vigilantg', 'vigilanto',
        'baddudes', 'drgninja', 'drgninjab', 'drgninjab2', 'drgninjam',
        'spidman', 'spidmanj', 'spidmanu',
    ].map(romName => [romName, BEAT_EM_UP] as [string, string]),
    // Action platformers filed under "Platform / Shooter Scrolling" with the run 'n guns.
    ...['karnov', 'karnova', 'karnovj', 'karnovjbl',
        'willow', 'willowj', 'willowu', 'willowuo',
        'maglord', 'maglordh',
        'wiz', 'wizt', 'wizta',
    ].map(romName => [romName, ACTION_PLATFORMER] as [string, string]),
    // Scrolling shoot 'em ups filed under "Shooter / Gallery" with the fixed shooters.
    ...['exerion', 'exerionb', 'exerionb2', 'exerionba', 'exeriont', 'fcombat',
    ].map(romName => [romName, SHOOT_EM_UP] as [string, string]),
    // Power Stone is a versus fighting game, filed under "Fighter / 3D" with the 3D beat 'em ups.
    ...['pstone', 'pstone2', 'pstone2b'].map(romName => [romName, FIGHTING] as [string, string]),
]);

/**
 * Icon of a MAUI genre whose name doesn't give its icon file (see getCategoryIconKey()): every
 * other one has its own src/assets/categories/<key>.svg ("Beat 'em Up" -> beat_em_up.svg).
 * Fighting keeps the boxing glove catver's parent "Fighter" genre already had.
 */
export const GENRE_ICON_KEYS = new Map<string, string>([
    [FIGHTING, 'fighter'],
]);

/**
 * MAUI genre of a machine from its catver.ini category ("Fighter / Versus * Mature *"). The
 * discrete-logic "TTL * " prefix is dropped (same kind of game, see mergeTtlCategories()), so
 * "TTL * Driving / Race" lands in plain "Driving".
 */
export function getCatverGenre(catverCategory: string, romName: string): string {
    const override = ROM_OVERRIDES.get(romName);
    if (override) {
        return override;
    }
    const category = catverCategory.trim().replace(MATURE_SUFFIX, '').replace(TTL_PREFIX, '');
    const rule = SUBGENRE_RULES.get(category);
    if (rule) {
        return rule;
    }
    const genre = category.split(' / ')[0].trim();
    return GENRE_DEFAULTS.get(genre) ?? genre;
}

/**
 * Parses catver.ini's [Category] section into the shape GameService reads genre.ini as: one
 * entry per MAUI genre (sorted by name, so the positional ids Database.syncCategories() derives
 * don't depend on the file's line order), each holding its rom names. Every other section
 * ([VerAdded]...) is ignored.
 */
export function parseCatverIni(content: string): {[genre: string]: {[romName: string]: boolean}} {
    const genres = new Map<string, {[romName: string]: boolean}>();
    let inCategorySection = false;
    for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith('[')) {
            inCategorySection = line === '[Category]';
            continue;
        }
        const separator = line.indexOf('=');
        if (!inCategorySection || line.startsWith(';') || separator <= 0) {
            continue;
        }
        const romName = line.slice(0, separator).trim();
        const genre = getCatverGenre(line.slice(separator + 1), romName);
        if (!genres.has(genre)) {
            // No prototype: a rom named e.g. "constructor" must not look already filed.
            genres.set(genre, Object.create(null));
        }
        genres.get(genre)![romName] = true;
    }
    const sorted: {[genre: string]: {[romName: string]: boolean}} = {};
    for (const genre of [...genres.keys()].sort()) {
        sorted[genre] = genres.get(genre)!;
    }
    return sorted;
}
