// Stand-in for @electron/remote, which only exists inside an Electron renderer.
// Helpers.class.ts imports it at module scope, so any test importing Helpers (or
// MameService, which imports Helpers) needs this to resolve.
export const app = {
    getPath(name: string): string {
        return `/tmp/mame-awesome-ui-test/${name}`;
    },
};
