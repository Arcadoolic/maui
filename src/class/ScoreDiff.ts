// What a game added to a hiscore table (maui-api Lot 2.3): the rows of `after` missing from
// `before`, compared by name and score. Ranks are ignored: a new score pushes the older ones down
// without making them new. Several identical rows count as many times as they appear.

export interface TableRow {
    rank: number;
    score: number;
    name: string;
}

const key = (row: TableRow) => `${row.name}\u0000${row.score}`;

export function newRows(before: TableRow[], after: TableRow[]): TableRow[] {
    const left = new Map<string, number>();
    for (const row of before) {
        left.set(key(row), (left.get(key(row)) ?? 0) + 1);
    }
    return after.filter(row => {
        const count = left.get(key(row)) ?? 0;
        if (count > 0) {
            left.set(key(row), count - 1);
            return false;
        }
        return true;
    });
}
