import {describe, it, expect} from 'vitest';
import {readdirSync} from 'fs';
import {join} from 'path';
import {
    BEAT_EM_UP, FIGHTING, ACTION_PLATFORMER, RUN_N_GUN, SHOOT_EM_UP, FIXED_SHOOTER, LIGHT_GUN,
    MULTIDIRECTIONAL_SHOOTER, RAIL_SHOOTER,
    getCatverGenre, parseCatverIni,
} from '@/class/CatverGenres';
import {getCategoryIconKey} from '@/class/CarouselCategories';

// Categories below are catver.ini 0.289's own (progettoSNAPS), for the sets named.
describe('getCatverGenre', () => {
    it('tells versus fighting games from beat \'em ups', () => {
        expect(getCatverGenre('Fighter / Versus', 'sf2')).toBe(FIGHTING);
        expect(getCatverGenre('Fighter / Versus Co-op', 'redearth')).toBe(FIGHTING);
        expect(getCatverGenre('Fighter / 2.5D', 'ffight')).toBe(BEAT_EM_UP);
        expect(getCatverGenre('Fighter / 2D', 'kungfum')).toBe(BEAT_EM_UP);
        expect(getCatverGenre('Fighter / Vertical', 'avengers')).toBe(BEAT_EM_UP);
    });

    it('splits shooters and platformers by subgenre', () => {
        expect(getCatverGenre('Platform / Fighter Scrolling', 'shinobi')).toBe(ACTION_PLATFORMER);
        expect(getCatverGenre('Platform / Shooter Scrolling', 'mslug')).toBe(RUN_N_GUN);
        expect(getCatverGenre('Shooter / Walking', 'commando')).toBe(RUN_N_GUN);
        expect(getCatverGenre('Shooter / Flying Horizontal', 'rtype')).toBe(SHOOT_EM_UP);
        expect(getCatverGenre('Shooter / Gallery', 'galaga')).toBe(FIXED_SHOOTER);
        expect(getCatverGenre('Shooter / Gun', 'opwolf')).toBe(LIGHT_GUN);
        expect(getCatverGenre('Shooter / Field', 'robotron')).toBe(MULTIDIRECTIONAL_SHOOTER);
        expect(getCatverGenre('Shooter / Flying (chase view)', 'sharrier')).toBe(RAIL_SHOOTER);
        expect(getCatverGenre('Shooter / Flying 1st Person', 'starwars')).toBe(RAIL_SHOOTER);
    });

    it('falls back to the plain genre for a subgenre without rule', () => {
        expect(getCatverGenre('Platform / Run Jump', 'dkong')).toBe('Platform');
        expect(getCatverGenre('Shooter / 3rd Person', 'cabal')).toBe('Shooter');
        expect(getCatverGenre('Shooter / Driving Vertical', 'spyhunt')).toBe('Shooter');
        expect(getCatverGenre('Maze / Collect', 'puckman')).toBe('Maze');
    });

    it('drops the Mature flag and the TTL prefix', () => {
        expect(getCatverGenre('Fighter / Versus * Mature *', 'mk2')).toBe(FIGHTING);
        expect(getCatverGenre('TTL * Driving / Race', 'gtrak10')).toBe('Driving');
        expect(getCatverGenre('TTL * Shooter / Gallery', 'spacewar')).toBe(FIXED_SHOOTER);
    });

    it('applies per-set overrides, clones included', () => {
        expect(getCatverGenre('Platform / Fighter Scrolling', 'vigilant')).toBe(BEAT_EM_UP);
        expect(getCatverGenre('Platform / Fighter Scrolling', 'drgninja')).toBe(BEAT_EM_UP);
        expect(getCatverGenre('Fighter / 3D', 'pstone2')).toBe(FIGHTING);
        expect(getCatverGenre('Platform / Shooter Scrolling', 'karnov')).toBe(ACTION_PLATFORMER);
        expect(getCatverGenre('Platform / Shooter Scrolling', 'willowu')).toBe(ACTION_PLATFORMER);
        expect(getCatverGenre('Shooter / Gallery', 'exerion')).toBe(SHOOT_EM_UP);
        expect(getCatverGenre('Fighter / 3D', 'spikeout')).toBe(BEAT_EM_UP);
    });
});

describe('parseCatverIni', () => {
    const content = [
        '\uFEFF[FOLDER_SETTINGS]',
        'RootFolderIcon mame',
        '',
        ';; catver.ini 0.289 ;;',
        '',
        '[Category]',
        'sf2=Fighter / Versus',
        'ffight=Fighter / 2.5D',
        'dino=Fighter / 2.5D',
        'dkong=Platform / Run Jump',
        '',
        '[VerAdded]',
        'sf2=0.36',
        '',
    ].join('\r\n');

    it('groups the [Category] section by MAUI genre, sorted by name', () => {
        const genres = parseCatverIni(content);

        expect(Object.keys(genres)).toEqual([BEAT_EM_UP, FIGHTING, 'Platform']);
        expect(Object.keys(genres[BEAT_EM_UP])).toEqual(['ffight', 'dino']);
        expect(genres[FIGHTING].sf2).toBe(true);
    });

    it('ignores every other section', () => {
        const genres = parseCatverIni(content);

        expect(Object.values(genres).some(roms => Object.values(roms).some(value => value !== true))).toBe(false);
        expect(Object.keys(genres)).not.toContain('0.36');
    });

    it('does not see inherited object keys as filed roms', () => {
        const genres = parseCatverIni(content);

        expect(genres[FIGHTING].constructor).toBeUndefined();
    });
});

describe('MAUI genre icons', () => {
    it('have their own icon file, named after the genre', () => {
        const icons = readdirSync(join(__dirname, '../../src/assets/categories'));
        for (const genre of [BEAT_EM_UP, ACTION_PLATFORMER, RUN_N_GUN, SHOOT_EM_UP, FIXED_SHOOTER, LIGHT_GUN,
            MULTIDIRECTIONAL_SHOOTER, RAIL_SHOOTER]) {
            expect(icons).toContain(`${getCategoryIconKey(genre)}.svg`);
        }
        expect(getCategoryIconKey(BEAT_EM_UP)).toBe('beat_em_up');
        expect(getCategoryIconKey(RUN_N_GUN)).toBe('run_n_gun');
    });

    it('keeps the boxing glove for Fighting', () => {
        expect(getCategoryIconKey(FIGHTING)).toBe('fighter');
        expect(getCategoryIconKey('Ball & Paddle')).toBe('ball_paddle');
    });
});
