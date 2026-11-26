import {MameHiExtractor} from '@arcadoolic/mhiex';

// The games ranking several modes apart (magdrop2: Puzzle and VS CPU): mhiex names their mode
// tables. `default` is the one every game has; the others are among the extractor's extras.

export const DEFAULT_TABLE = 'default';

export interface ModeTable {
    id: string;
    label: string;
}

/** The mode tables of a game, `default` first; empty for a game with one table only. */
export function modeTables(romname: string): ModeTable[] {
    return Object.entries(new MameHiExtractor('').tables(romname))
        .map(([id, label]) => ({id, label}))
        .sort((a, b) => Number(b.id === DEFAULT_TABLE) - Number(a.id === DEFAULT_TABLE));
}

/** The mode tables besides `default`. */
export function otherTables(romname: string): string[] {
    return modeTables(romname).map(table => table.id).filter(id => id !== DEFAULT_TABLE);
}

/** What the local database's `extraName` holds for a table: empty for `default`. */
export function localTableName(table: string): string {
    return table === DEFAULT_TABLE ? '' : table;
}
