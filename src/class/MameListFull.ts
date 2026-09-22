/**
 * Parses `mame -listfull <rom>...`'s stdout: a `Name:  Description:` header, then one
 * `<romname>  "<description>"` line per machine (unknown names only produce a "No matching
 * systems found" line, skipped like the header). Returns the description by rom name.
 */
export function parseListFull(stdout: string): Map<string, string> {
    const descriptions = new Map<string, string>();
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^(\S+)\s+"(.*)"\s*$/.exec(line);
        if (match && match[2]) {
            descriptions.set(match[1], match[2]);
        }
    }
    return descriptions;
}
