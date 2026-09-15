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
