import {describe, it, expect} from 'vitest';
import {readGameInfos} from '@/class/ScreenScraperClient.class';

describe('readGameInfos', () => {
    it('reads the publisher and developer of a jeuInfos answer', () => {
        expect(readGameInfos({
            editeur: {id: '79', text: 'SNK'},
            developpeur: {id: '1318', text: 'Nazca'},
        })).toEqual({publisher: 'SNK', publisherId: '79', developer: 'Nazca', developerId: '1318'});
    });

    it('leaves out what ScreenScraper does not know', () => {
        expect(readGameInfos({})).toEqual({publisher: null, publisherId: null, developer: null, developerId: null});
        expect(readGameInfos({editeur: {id: '', text: '  '}})).toMatchObject({publisher: null, publisherId: null});
    });
});
