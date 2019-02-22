interface GameJSON {
    fullname: string;
    shortname: string;
    subname: string;
    year: number;
    manufacturer: string;
    parent: string;
    nplayers: Nplayers;
    categories: string[];
    romPath: string;
    hi: boolean;
}

interface Nplayers {
    sim: number;
    alt: number;
}

interface GameCategoryJSON {
    id: string;
    name: string;
}
