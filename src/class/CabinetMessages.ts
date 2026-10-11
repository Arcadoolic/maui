/**
 * The messages a cabinet shows while nobody plays (MessageBand.vue, Home.vue): the score events
 * of the fleet, in MAUI-API's own sentences - the ones the Discord bot announces and the hiscores
 * front lists. A cabinet that cannot read them (OFFLINE, MAUI-API unreachable, nothing recent)
 * falls back on its own latest best scores, read from its database.
 */

export interface BandMessage {
    // Stable for one message: the band tells a new list from the same one read again.
    id: string;
    // Plain text; **bold** marks what the band highlights. Nothing else is interpreted.
    text: string;
    kind: 'score' | 'system';
    // The game the message is about, when it is about one: the front goes to it (Home.vue).
    romName?: string;
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

/** MAUI-API's score events (MauiApiClient.getScoreEvents()) as messages, in the order given. */
export function scoreEventMessages(events: readonly {id: number; message: string; romname?: string}[]): BandMessage[] {
    return events.map(event => ({
        id: `event/${event.id}`, text: event.message, kind: 'score',
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
