interface GameJSON {
    fullname: string;
    shortname: string;
    subname: string;
    year: number;
    manufacturer: string;
    nplayers: Nplayers;
    category: string|null;
    romName: string;
    hi: boolean;
    parent: string|null;
}

interface Nplayers {
    sim: number;
    alt: number;
}

interface Hiscore {
    RANK: number;
    NAME: string;
    SCORE: number;
}

interface Hiscores {
    classic: Hiscore[][];
    advanced: Hiscore[][];
}

interface HiscoresJson {
    allTime: Hiscores;
    season: Hiscores;
}
