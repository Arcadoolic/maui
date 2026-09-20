/**
 * Calls `onParentGone` once the process that started this one is gone.
 *
 * Under `electron-vite dev` Electron is a child of the dev server. Kill the dev server without a
 * signal Electron would act on (SIGKILL, only the `just`/`npm` wrapper killed, terminal closed) and
 * the child is left running as an orphan, still holding the BO's port 3131: the BO stays reachable
 * and the next `just serve` cannot bind it. An orphan is re-parented, so `process.ppid` changes;
 * that is what is polled here, since no signal is delivered in those cases.
 *
 * Returns a function that stops the watch.
 */
export function exitWhenParentGone(onParentGone: () => void, intervalMs: number = 1000): () => void {
    const originalParentPid = process.ppid;
    const timer = setInterval(() => {
        if (process.ppid !== originalParentPid) {
            clearInterval(timer);
            onParentGone();
        }
    }, intervalMs);
    // Never the reason the process stays alive.
    timer.unref();
    return () => clearInterval(timer);
}
