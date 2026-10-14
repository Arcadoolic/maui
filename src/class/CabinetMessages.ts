/**
 * The messages a cabinet shows while nobody plays (MessageBand.vue, Home.vue): the score events
 * of the fleet, in MAUI-API's own sentences - the ones the Discord bot announces and the hiscores
 * front lists. A cabinet that cannot read them (OFFLINE, MAUI-API unreachable, nothing recent)
 * falls back on its own latest best scores, read from its database.
 */

import {splitGameTitle} from '@/class/GameTitle';

export interface BandMessage {
    // Stable for one message: the band tells a new list from the same one read again.
    id: string;
    // Plain text; **bold** marks what the band highlights. Nothing else is interpreted.
    text: string;
    kind: 'score' | 'system';
    // The game the message is about, when it is about one: the front goes to it (Home.vue).
    romName?: string;
    // Shown once, when the band comes on; the band then goes round the others only.
    once?: boolean;
}

/**
 * A newer release of MAUI (UpdateWatch.ts): the first message of each idle band. Short enough to
 * stop in its middle: in the band's Arcade font, about 42 characters fit in 90% of its width.
 */
export function updateNoticeMessage(version: string): BandMessage {
    return {
        id: `maui-update-${version}`,
        text: `MAUI **${plain(version)}** is out: update from the BO`,
        kind: 'system',
        once: true,
    };
}

export interface MessageSegment {
    text: string;
    strong: boolean;
}

/** Splits a message on its **bold** parts. A lone or unclosed marker stays as written. */
export function parseMessage(text: string): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let rest = text;
    for (;;) {
        const match = /\*\*(.+?)\*\*/.exec(rest);
        if (!match) {
            break;
        }
        if (match.index > 0) {
            segments.push({text: rest.slice(0, match.index), strong: false});
        }
        segments.push({text: match[1], strong: true});
        rest = rest.slice(match.index + match[0].length);
    }
    if (rest) {
        segments.push({text: rest, strong: false});
    }
    return segments;
}

/**
 * MAUI-API's score events (MauiApiClient.getScoreEvents()) as messages, in the order given. Its
 * sentence names the game as MAME does ("Galaxian (Namco set 1)"): on the cabinet it is given the
 * short title the front shows above its list ("Galaxian").
 */
export function scoreEventMessages(
    events: readonly {id: number; message: string; romname?: string; description?: string}[],
): BandMessage[] {
    return events.map(event => ({
        id: `event/${event.id}`,
        text: event.description
            ? event.message.replaceAll(`**${event.description}**`, () => `**${plain(splitGameTitle(event.description!).shortname)}**`)
            : event.message,
        kind: 'score',
        ...(event.romname ? {romName: event.romname} : {}),
    }));
}

/** A score of the cabinet's own table, as HiscoreService.loadLatestBests() reads it. */
export interface LocalScore {
    pseudo: string;
    romName: string;
    title: string;
    score: number;
    suffix?: string | null;
}

/**
 * One message per player and game, for the best of the scores given, in the order the pairs first
 * come (the caller gives the most recent scores first), `limit` at most.
 */
export function latestBestMessages(scores: readonly LocalScore[], limit: number): BandMessage[] {
    const bests = new Map<string, LocalScore>();
    for (const score of scores) {
        const key = `${score.pseudo}/${score.romName}`;
        const best = bests.get(key);
        if (!best) {
            bests.set(key, score);
        } else if (score.score > best.score) {
            // In place: the pair keeps the position of its most recent score.
            bests.set(key, score);
        }
    }
    return [...bests.values()].slice(0, Math.max(0, limit)).map(best => ({
        id: `local/${best.pseudo}/${best.romName}/${best.score}`,
        text: `**${plain(best.pseudo)}** — **${plain(best.title)}** — **${best.score.toLocaleString('en-US')}${best.suffix ? ' ' + plain(best.suffix) : ''}**`,
        kind: 'score',
        romName: best.romName,
    }));
}

// A title holding the marker itself would close the bold early.
function plain(text: string): string {
    return text.replace(/\*\*/g, '');
}
