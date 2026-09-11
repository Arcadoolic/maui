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
