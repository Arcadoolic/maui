import {writeFileSync} from 'fs';

export interface ScreenScraperCredentials {
    devId: string;
    devPassword: string;
    softName: string;
    userId: string;
    userPassword: string;
}

export type MediaType = 'marquee' | 'flyer';

export interface GameMediaResult {
    marqueeUrl: string | null;
    flyerUrl: string | null;
}

export type FetchGameMediaResult =
    | {status: 'found'; media: GameMediaResult}
    | {status: 'not-found'}
    | {status: 'quota-exceeded'; message: string}
    | {status: 'error'; message: string};

export type DownloadResult = {status: 'ok'} | {status: 'error'; message: string};

const API_BASE_URL = 'https://api.screenscraper.fr/api2/jeuInfos.php';
// Arcade/"Mame" system on ScreenScraper, confirmed via screenscraper.fr/romsinfos.php?plateforme=75.
const ARCADE_SYSTEME_ID = '75';
// World first, then Japan (confirmed as "jp", not "jap", against a real API response), then a
// reasonable Western fallback before giving up on region and taking whatever is available.
const REGION_PRIORITY = ['wor', 'jp', 'us', 'eu', 'ss'];
// Full-size cabinet marquee with region variants, not the regionless "marquee" or the
// "screenmarqueesmall" thumbnail. "flyer" is the arcade-specific flyer type (vs. "box-2D" used
// by non-arcade systems) - confirmed against a real jeuInfos.php response for "gng".
const MEDIA_TYPE: { [key in MediaType]: string } = {
    marquee: 'screenmarquee',
    flyer: 'flyer',
};

interface RawMedia {
    type?: string;
    region?: string;
    url?: string;
}

function pickBestMediaUrl(medias: RawMedia[], type: string): string | null {
    const candidates = medias.filter(media => media.type === type && media.url);
    for (const region of REGION_PRIORITY) {
        const match = candidates.find(media => media.region === region);
        if (match && match.url) {
            return match.url;
        }
    }
    return candidates.length ? candidates[0].url as string : null;
}

export default class ScreenScraperClient {
    protected credentials: ScreenScraperCredentials;
    protected throttleMs: number;
    protected lastCallAt = 0;

    public constructor(credentials: ScreenScraperCredentials, throttleMs = 1500) {
        this.credentials = credentials;
        this.throttleMs = throttleMs;
    }

    protected async throttle(): Promise<void> {
        const wait = this.throttleMs - (Date.now() - this.lastCallAt);
        if (wait > 0) {
            await new Promise(resolve => setTimeout(resolve, wait));
        }
        this.lastCallAt = Date.now();
    }

    public async fetchGameMedia(romName: string): Promise<FetchGameMediaResult> {
        await this.throttle();

        const params = new URLSearchParams({
            devid: this.credentials.devId,
            devpassword: this.credentials.devPassword,
            softname: this.credentials.softName,
            ssid: this.credentials.userId,
            sspassword: this.credentials.userPassword,
            output: 'json',
            systemeid: ARCADE_SYSTEME_ID,
            romnom: romName,
        });

        let res: Response;
        let text: string;
        try {
            res = await fetch(`${API_BASE_URL}?${params.toString()}`);
            text = await res.text();
        } catch (error) {
            return {status: 'error', message: error instanceof Error ? error.message : 'Erreur réseau.'};
        }

        // ScreenScraper's "rom not found" response: HTTP 404 with a plain-text body, not JSON.
        if (res.status === 404) {
            return {status: 'not-found'};
        }
        if (!res.ok) {
            return /quota|limite|threads/i.test(text)
                ? {status: 'quota-exceeded', message: text.slice(0, 200)}
                : {status: 'error', message: `HTTP ${res.status}: ${text.slice(0, 200)}`};
        }

        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            // ScreenScraper sometimes replies 200 with a plain-text error body (e.g. quota reached).
            return /quota|limite|threads/i.test(text)
                ? {status: 'quota-exceeded', message: text.slice(0, 200)}
                : {status: 'error', message: 'Réponse ScreenScraper illisible.'};
        }

        const jeu = json?.response?.jeu;
        if (!jeu) {
            return {status: 'not-found'};
        }

        const medias: RawMedia[] = jeu.medias || [];
        return {
            status: 'found',
            media: {
                marqueeUrl: pickBestMediaUrl(medias, MEDIA_TYPE.marquee),
                flyerUrl: pickBestMediaUrl(medias, MEDIA_TYPE.flyer),
            },
        };
    }

    public async downloadMedia(url: string, destinationPath: string, mediaType: MediaType): Promise<DownloadResult> {
        await this.throttle();

        try {
            const res = await fetch(url);
            if (!res.ok) {
                return {status: 'error', message: `Téléchargement ${mediaType} : HTTP ${res.status}`};
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            writeFileSync(destinationPath, buffer);
            return {status: 'ok'};
        } catch (error) {
            return {
                status: 'error',
                message: `Téléchargement ${mediaType} : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
            };
        }
    }
}
