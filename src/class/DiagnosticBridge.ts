// The front's Diagnostic action (Hotkeys.ts, Home.vue): a function background.ts exposes as a
// global, reached through @electron/remote, as the shutdown is (KioskPowerBridge.ts). The main
// process gathers the game's files and sends them to MAUI-API (GameDiagnostic.ts).
export const DIAGNOSTIC_GLOBAL = 'mauiSendDiagnostic';

/** What the front shows: the diagnostic's id once sent, else why not. Never rejects. */
export type DiagnosticRequest = (romName: string) => Promise<{sent: true; id: string} | {sent: false; reason: string}>;
