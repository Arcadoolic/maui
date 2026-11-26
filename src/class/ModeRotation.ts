import {computed, onUnmounted, ref, type ComputedRef} from 'vue';
import {modeTables, type ModeTable} from '@/class/ModeTables';

// A game with several mode tables shows them in turn. One clock for the whole front, so that the
// hiscores panel and the marquee's podium always show the same mode.

export const MODE_SHOWN_MS = 6000;

/** The table shown at `now`, null for a game with one table only. */
export function tableAt(tables: ModeTable[], now: number): ModeTable | null {
    return tables.length > 1 ? tables[Math.floor(now / MODE_SHOWN_MS) % tables.length] : null;
}

const turn = ref(0);
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * The mode table of `romname` to show now, null for a game with one table only. `pinned`: a table
 * to stay on (the one holding the score being revealed).
 */
export function useModeTable(romname: () => string, pinned: () => string | null = () => null): ComputedRef<ModeTable | null> {
    if (users++ === 0) {
        turn.value = Date.now();
        // Checked often, changes every MODE_SHOWN_MS.
        timer = setInterval(() => {
            turn.value = Date.now();
        }, 500);
    }
    onUnmounted(() => {
        if (--users === 0) {
            clearInterval(timer);
        }
    });
    const tables = computed(() => modeTables(romname()));
    return computed(() => {
        const kept = pinned();
        return tables.value.find(table => table.id === kept) ?? tableAt(tables.value, turn.value);
    });
}
