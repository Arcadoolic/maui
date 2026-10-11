import {describe, it, expect} from 'vitest';
import {latestBestMessages, parseMessage, scoreEventMessages, type LocalScore} from '@/class/CabinetMessages';

describe('parseMessage', () => {
    it('splits a message on its bold parts', () => {
        expect(parseMessage('**NOB** takes 1st on **Bomb Jack**!')).toEqual([
            {text: 'NOB', strong: true},
            {text: ' takes 1st on ', strong: false},
            {text: 'Bomb Jack', strong: true},
            {text: '!', strong: false},
        ]);
    });

    it('leaves a message without bold, or with an unclosed marker, as written', () => {
        expect(parseMessage('MAUI 2.12.0 is available')).toEqual([{text: 'MAUI 2.12.0 is available', strong: false}]);
        expect(parseMessage('a ** b')).toEqual([{text: 'a ** b', strong: false}]);
        expect(parseMessage('')).toEqual([]);
    });

    it('interprets nothing else', () => {
        expect(parseMessage('<b>x</b> _y_ [z](http://z)')).toEqual([{text: '<b>x</b> _y_ [z](http://z)', strong: false}]);
    });
});

describe('latestBestMessages', () => {
    const score = (pseudo: string, romName: string, value: number, title = romName): LocalScore =>
        ({pseudo, romName, title, score: value});

    it('gives one message per player and game, for the best score, most recent pair first', () => {
        const messages = latestBestMessages([
            score('NOB', 'bombjack', 20000, 'Bomb Jack'),
            score('MAF', 'btime', 19300, 'Burger Time'),
            score('NOB', 'bombjack', 23070, 'Bomb Jack'),
            score('MAF', 'bombjack', 9000, 'Bomb Jack'),
        ], 10);

        expect(messages.map(message => message.text)).toEqual([
            '**NOB** — **Bomb Jack** — **23,070**',
            '**MAF** — **Burger Time** — **19,300**',
            '**MAF** — **Bomb Jack** — **9,000**',
        ]);
        expect(messages.every(message => message.kind === 'score')).toBe(true);
        expect(messages.map(message => message.romName)).toEqual(['bombjack', 'btime', 'bombjack']);
        expect(new Set(messages.map(message => message.id)).size).toBe(3);
    });

    it('keeps `limit` messages at most', () => {
        const scores = ['a', 'b', 'c'].map(romName => score('NOB', romName, 100));
        expect(latestBestMessages(scores, 2)).toHaveLength(2);
        expect(latestBestMessages(scores, 0)).toEqual([]);
        expect(latestBestMessages([], 5)).toEqual([]);
    });

    it('adds the score\'s suffix, and never lets a title close the bold', () => {
        expect(latestBestMessages([{...score('NOB', 'x', 5, 'A**B'), suffix: 'pts'}], 1)[0].text)
            .toBe('**NOB** — **AB** — **5 pts**');
    });
});

describe('scoreEventMessages', () => {
    it('keeps MAUI-API\'s sentences as they are, in the order given', () => {
        expect(scoreEventMessages([
            {id: 12, message: '**NOB** takes 1st on **Galaga**!', romname: 'galaga'},
            {id: 9, message: 'First blood on **Dig Dug**.'},
        ])).toEqual([
            {id: 'event/12', text: '**NOB** takes 1st on **Galaga**!', kind: 'score', romName: 'galaga'},
            {id: 'event/9', text: 'First blood on **Dig Dug**.', kind: 'score'},
        ]);
    });

    it('names the game by its short title, as the front does', () => {
        expect(scoreEventMessages([
            {id: 1, romname: 'galaxian', description: 'Galaxian (Namco set 1)',
                message: 'First blood on **Galaxian (Namco set 1)** by Namco: **NOB** sets the mark at **2,820**.'},
            {id: 2, romname: 'robotron', description: 'Robotron: 2084 (Release 5, solid blue label)',
                message: 'New leader on **Robotron: 2084 (Release 5, solid blue label)** by Williams: **STE** dethrones **SNO**.'},
            // A name with nothing to cut, and a sentence that does not hold the name as given.
            {id: 3, romname: 'mpatrol', description: 'Moon Patrol', message: '**NOB** opens the board on **Moon Patrol** by Irem.'},
            {id: 4, romname: 'dkong', description: 'Donkey Kong (US set 1)', message: '**NOB** is back.'},
        ]).map(message => message.text)).toEqual([
            'First blood on **Galaxian** by Namco: **NOB** sets the mark at **2,820**.',
            'New leader on **Robotron** by Williams: **STE** dethrones **SNO**.',
            '**NOB** opens the board on **Moon Patrol** by Irem.',
            '**NOB** is back.',
        ]);
    });
});
