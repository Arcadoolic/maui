interface GameJSON {
    fullname: string;
    shortname: string;
    subname: string;
    year: number;
    manufacturer: string;
    parent: string;
    category: string;
    nplayers: string;
    categories: string[];
}

interface GameCategoryJSON {
    id: string;
    name: string;
}
