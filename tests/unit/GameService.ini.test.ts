import {describe, it, expect, beforeAll} from 'vitest';
import {resolve} from 'path';
import GameService from '@/class/GameService.class';

// GameService reads public/data/*.ini through the ambient __static global that
// vue-cli-plugin-electron-builder injects via DefinePlugin. Vitest does not, so
// define it before any test calls the methods under test. GameService only
// reads __static inside method bodies, never at module scope, so a static
// import above is safe as long as this assignment runs before those methods
// are called, which beforeAll below guarantees.
//
// This is exactly the coupling the Vue 3 migration breaks: electron-vite has no
// __static. When src/staticPath.ts replaces it, this test is what proves the
// replacement resolves to the same files.
(globalThis as Record<string, unknown>).__static = resolve(__dirname, '../../public');

describe('GameService ini lookups', () => {
    let service: GameService;

    beforeAll(() => {
        // Neither method under test touches the injected services.
        service = new GameService(null as never, null as never);
    });

    it('loads the genre file and exposes the categories', () => {
        const categories = service.getGameCategories();
        expect(Object.keys(categories).length).toBeGreaterThan(0);
    });

    it('returns a 1-based category id, counting sections in file order', () => {
        // arkanoid sits under [Ball & Paddle], the first section, so id 1.
        expect(service.getGameCategoryId('arkanoid')).toBe(1);
        // academy sits under [Board Game], the second section, so id 2.
        expect(service.getGameCategoryId('academy')).toBe(2);
    });

    it('returns undefined for a rom in no category', () => {
        expect(service.getGameCategoryId('definitely-not-a-real-rom')).toBeUndefined();
    });

    it('reads the player counts for a known rom', () => {
        // arkanoid sits under [2P alt], which nplayersTranslation maps to alt 2.
        expect(service.getGameNplayers('arkanoid')).toEqual({sim: 0, alt: 2});
    });

    it('falls back to zeroes for a rom absent from nplayers.ini', () => {
        // Note this is the same shape as the '1P' translation, so this assertion
        // cannot distinguish "not found" from "found and single-player".
        expect(service.getGameNplayers('definitely-not-a-real-rom')).toEqual({sim: 0, alt: 0});
    });
});
