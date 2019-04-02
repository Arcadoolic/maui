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
    parent: string;
}

interface Nplayers {
    sim: number;
    alt: number;
}
