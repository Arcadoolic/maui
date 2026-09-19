// Injected into the main-process bundle by electron.vite.config.ts (`define`): "+dev.<short sha>"
// for develop builds, "" otherwise. Not defined at all outside that bundle (e.g. under Vitest), so
// read it through getRunningVersion() in boServer.ts, which guards for that.
declare const MAUI_BUILD_VERSION_SUFFIX: string;

interface ControllerMapping {
    buttons: {[key: number]: string};
    axes: {[key: number]: {[value: number]: string}};
}

interface Nplayers {
    sim: number;
    alt: number;
}
