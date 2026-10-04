import {execFile} from 'child_process';

const COMMAND_TIMEOUT_MS = 60_000;

/** What the installed MAME makes of a set: `problems` are its own lines, one per file at fault. */
export type RomVerdict = {status: 'good'} | {status: 'bad'; problems: string[]} | {status: 'unknown'};

/**
 * Parses the output of `mame -verifyroms <rom>...`: the files at fault of a set
 * (`dkong : c-2j.bpr (256 bytes) - NOT FOUND`), then its verdict (`romset dkong [parent] is bad`,
 * `is good`, or `is best available` when all that is missing has no known good dump). A name this
 * MAME does not have gives `No matching systems found for '<name>'`. A set whose zip is not in
 * the rompath gives no line at all, and is absent from the map.
 */
export function parseVerifyRoms(output: string): Map<string, RomVerdict> {
    const verdicts = new Map<string, RomVerdict>();
    const problems = new Map<string, string[]>();
    for (const line of output.split(/\r?\n/)) {
        const verdict = /^romset (\S+)(?: \[\S+\])? is (good|best available|bad)\s*$/.exec(line);
        if (verdict) {
            verdicts.set(verdict[1], verdict[2] === 'bad'
                ? {status: 'bad', problems: problems.get(verdict[1]) ?? []}
                : {status: 'good'});
            continue;
        }
        const unknown = /^No matching systems found for '(.+)'\s*$/.exec(line);
        if (unknown) {
            verdicts.set(unknown[1], {status: 'unknown'});
            continue;
        }
        const problem = /^(\S+)\s+: (.+?)\s*$/.exec(line);
        if (problem) {
            problems.set(problem[1], [...(problems.get(problem[1]) ?? []), problem[2]]);
        }
    }
    return verdicts;
}

/**
 * Asks the installed MAME to check the sets of `romNames` in its rompath (~0.05s for a few dozen
 * sets). Null when MAME could not be run: nothing can be said of the sets then.
 */
export function verifyRoms(mameBinary: string, iniPath: string, romNames: readonly string[]): Promise<Map<string, RomVerdict> | null> {
    if (!romNames.length) {
        return Promise.resolve(new Map());
    }
    return new Promise((resolve) => {
        execFile(
            mameBinary,
            ['-verifyroms', ...romNames, '-inipath', iniPath, '-homepath', iniPath],
            {encoding: 'utf8', cwd: iniPath, timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024},
            (error, stdout, stderr) => {
                // MAME exits non-zero as soon as one set is bad or unknown, having checked them all:
                // only a MAME that did not run (no exit code of its own) says nothing.
                if (error && typeof error.code !== 'number') {
                    resolve(null);
                    return;
                }
                resolve(parseVerifyRoms(`${stdout}\n${stderr}`));
            },
        );
    });
}
