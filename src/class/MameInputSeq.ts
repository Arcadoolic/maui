/**
 * MAME input sequences as MAME itself prints them (input:seq_to_tokens()) and reads them back from
 * default.cfg's <newseq>: whitespace-separated codes, alternatives joined by the `OR` keyword, and
 * `NOT <code>` modifiers, e.g. "KEYCODE_TAB NOT KEYCODE_LALT NOT KEYCODE_RALT OR JOYCODE_1_BUTTON9".
 */

/**
 * Drops every `OR` alternative of `seq` that contains `token`, keeping the rest verbatim. Returns
 * `seq` unchanged if `token` isn't in it, and null if `token` was its only alternative (nothing
 * left to write back - the caller decides what that means).
 */
export function removeTokenFromSeq(seq: string, token: string): string | null {
    const alternatives = seq.trim().split(/\s+OR\s+/);
    const kept = alternatives.filter(alternative => !alternative.split(/\s+/).includes(token));
    if (kept.length === alternatives.length) {
        return seq;
    }
    return kept.length ? kept.join(' OR ') : null;
}

/**
 * Parses capture-daemon.lua's ui-seqs.txt, one `<PORT_TYPE>|<sequence>` line per input port (ports
 * with an empty default sequence are skipped - nothing there to conflict with).
 */
export function parseUiSeqs(content: string): Map<string, string> {
    const seqs = new Map<string, string>();
    for (const line of content.split(/\r?\n/)) {
        const separator = line.indexOf('|');
        if (separator <= 0) {
            continue;
        }
        const seq = line.slice(separator + 1).trim();
        if (seq) {
            seqs.set(line.slice(0, separator), seq);
        }
    }
    return seqs;
}
