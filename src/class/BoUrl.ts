// Where the BO is reached from, as the front shows it (first-run screen, empty game list, the
// cabinet's back office key press). Electron-free.

// The port a browser uses when none is typed: also opened on a dedicated cabinet (boCore.ts),
// whose owner then only has an address to type. A desktop install keeps to BO_SERVER_PORT alone,
// port 80 being anyone's there.
export const CABINET_BO_PORT = 80;

export interface BoUrlContext {
    // A dedicated cabinet (KioskRestart.ts isKioskLayout()): its screen has no browser, the BO is
    // opened from another machine.
    cabinet: boolean;
    // This machine's address on the local network, null while it has none.
    lanAddress: string | null;
    // Whether CABINET_BO_PORT could be opened (it takes a system setting, see boCore.ts).
    onCabinetPort: boolean;
    port: number;
}

export function describeBoUrl(context: BoUrlContext): string {
    if (!context.cabinet || !context.lanAddress) {
        // On a desktop the BO is opened on the machine itself. A cabinet without a network has
        // nothing better to show.
        return `http://localhost:${context.port}`;
    }
    return context.onCabinetPort ? `http://${context.lanAddress}` : `http://${context.lanAddress}:${context.port}`;
}
