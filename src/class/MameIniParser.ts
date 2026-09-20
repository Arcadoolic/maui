/**
 * Pure parsing helpers for the ini files mame produces or consumes.
 *
 * Extracted from MameService so they can be tested without a mame binary: the
 * MameService constructor shells out to `mame -showconfig`, which makes the
 * parsing unreachable from a test as long as it lives there.
 *
 * Behavior here is deliberately identical to the original, quirks included.
 */

/**
 * Parse the key/value output of `mame -showconfig` or a mame ini file.
 *
 * Every value is split on ';' because several mame settings are path lists.
 * A single value therefore still comes back as a one-element array.
 */
export function parseMameIni(fileContent: string): { [key: string]: string[] } {
    const regex = new RegExp(/^([a-z_]+)\s+(.+)$/);
    const result: { [key: string]: string[] } = {};

    fileContent.split('\n').forEach((line) => {
        if (line[0] === '#') { // Skip comments
            return;
        }
        const data = regex.exec(line.trim());
        if (data) {
            result[data[1]] = data[2].replace(/^"(.*)"$/, '$1').split(';');
        }
    });

    return result;
}

/**
 * Extract rom names from a mame favorites.ini file.
 *
 * Known defect, preserved deliberately: the regex carries the 'g' flag and is
 * reused across .test() calls, so lastIndex persists and every other entry is
 * dropped whenever two matching lines are adjacent. Real favorites.ini files
 * interleave rom names with metadata lines, which resets lastIndex and hides
 * the problem most of the time.
 *
 * This is the 'FIXME: Do not take first favorite' noted in MameService. It is
 * kept as-is so the Vue 3 migration can prove it changed nothing; fixing it is
 * a separate change with its own test update.
 */
export function parseFavorites(fileContent: string): string[] {
    const regexp = new RegExp(/^(?![0-9]$)[a-z0-9]+$/, 'gm');
    const result: string[] = [];
    const existing: { [key: string]: boolean } = {};

    fileContent.split('\n').forEach((line: string) => {
        line = line.trim();
        if (regexp.test(line) && !existing[line]) {
            existing[line] = true;
            result.push(line);
        }
    });

    return result;
}

// One machine entry in mame's own favorites.ini layout: 16 lines, the rom name on lines 1 and 8
// (same layout scripts/import-starting-pack.py's favorite_entry() writes).
const FAVORITE_ENTRY_LINES = 16;
const FAVORITE_ENTRY_ROM_NAME_OFFSET = 7;

/**
 * Removes one machine's whole 16-line entry from a mame favorites.ini file's content, leaving
 * every other byte (BOM, header, CRLF vs. LF line endings, the other entries) untouched.
 * `entry` is the removed block itself (16 lines, "\n"-joined whatever the file used, no trailing
 * newline) - kept by the caller so addFavorite() can put it back exactly as mame wrote it.
 *
 * Returns null - never a guess - when the entry can't be located with certainty (rom absent, or
 * its lines don't have the expected layout: rom name repeated 7 lines below, and a complete
 * 16-line block), so a caller never rewrites a favorites.ini it doesn't fully understand.
 */
export function removeFavorite(fileContent: string, romName: string): {content: string; entry: string} | null {
    const lines = fileContent.split('\n');
    const start = lines.findIndex((line, index) => line.trim() === romName
        && lines[index + FAVORITE_ENTRY_ROM_NAME_OFFSET]?.trim() === romName
        && index + FAVORITE_ENTRY_LINES <= lines.length);
    if (start < 0) {
        return null;
    }
    const entry = lines.splice(start, FAVORITE_ENTRY_LINES).map(line => line.replace(/\r$/, '')).join('\n');
    return {content: lines.join('\n'), entry};
}

/**
 * True when `entry` (as returned by removeFavorite()) is a complete 16-line favorites.ini block
 * for a plain rom name - guards addFavorite() against a hand-edited/corrupt saved entry.
 */
export function isFavoriteEntry(entry: string): boolean {
    const lines = entry.split('\n');
    const romName = lines[0]?.trim();
    return lines.length === FAVORITE_ENTRY_LINES
        && /^[a-z0-9]+$/.test(romName)
        && lines[FAVORITE_ENTRY_ROM_NAME_OFFSET].trim() === romName;
}

/** Whether `lines[index]` starts a complete favorites.ini block (see FAVORITE_ENTRY_LINES). */
function isFavoriteEntryAt(lines: string[], index: number): boolean {
    const romName = lines[index]?.trim();
    return !!romName
        && index + FAVORITE_ENTRY_LINES <= lines.length
        && lines[index + FAVORITE_ENTRY_ROM_NAME_OFFSET].trim() === romName;
}

// Plain code-unit comparison of the lowercased descriptions, not localeCompare: the lists this
// keeps in order (starting packs) sort that way, e.g. "S.T.U.N. Runner" before "Star Wars".
function compareDescriptions(a: string, b: string): number {
    const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Puts `entry` (see removeFavorite()) back into a mame favorites.ini file's content, in
 * alphabetical position: before the first existing entry whose description (its 2nd line, the
 * game name shown in the list) sorts after its own, or at the end if none does - so a favorite
 * removed from an alphabetical list returns to where it was. Everything else (BOM, header, other
 * entries, the file's own CRLF/LF line ending) is left untouched. An empty file gets mame's BOM +
 * header first.
 *
 * Returns null when the rom is already listed (nothing to add), or when `entry` isn't a valid
 * block (see isFavoriteEntry()).
 */
export function addFavorite(fileContent: string, entry: string): string | null {
    if (!isFavoriteEntry(entry)) {
        return null;
    }
    const entryLines = entry.split('\n');
    const romName = entryLines[0].trim();
    if (fileContent.split('\n').some(line => line.trim() === romName)) {
        return null;
    }
    const newline = fileContent.includes('\r\n') ? '\r\n' : '\n';

    const lines = fileContent.split('\n');
    const starts: number[] = [];
    let end = lines.findIndex((_, index) => isFavoriteEntryAt(lines, index));
    while (end >= 0 && isFavoriteEntryAt(lines, end)) {
        starts.push(end);
        end += FAVORITE_ENTRY_LINES;
    }
    const insertBefore = starts.find(start => compareDescriptions(lines[start + 1], entryLines[1]) > 0);
    if (insertBefore !== undefined) {
        lines.splice(insertBefore, 0, ...entryLines.map(line => line + (newline === '\r\n' ? '\r' : '')));
        return lines.join('\n');
    }

    // Goes last (or the file has no entry yet): appended to the text as it stands.
    let text = fileContent || '\ufeff[ROOT_FOLDER]\n[Favorite]\n\n'.replace(/\n/g, newline);
    if (!text.endsWith('\n')) {
        text += newline;
    }
    return text + entryLines.join(newline) + newline;
}
