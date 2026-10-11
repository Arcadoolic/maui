/**
 * The short title of a game, as the front shows it above its list: MAME's description without its
 * bracketed part ("Galaxian (Namco set 1)" -> "Galaxian") nor its subtitle ("Robotron: 2084" ->
 * "Robotron"), which is returned apart.
 */
export function splitGameTitle(description: string): {shortname: string; subname: string} {
    let shortname = description;
    let subname = '';
    const shortnameRegexp = /^(.[^(]*)/g.exec(description);
    if (shortnameRegexp) {
        shortname = shortnameRegexp[0].trim().replace(/&amp;/g, '&');
        const subnameRegexp = /^([^\-\/]*)(:\s+|\s+-\s+|\s+\/\s+)(.*)$/.exec(shortname);
        if (subnameRegexp) {
            shortname = subnameRegexp.splice(0, 3)[1];
            subname = subnameRegexp[0];
        }
    }
    return {shortname, subname};
}
