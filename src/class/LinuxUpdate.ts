// How electron-builder names each arch in an AppImage's file name (electron-builder.yml's
// ${arch}): x64 becomes x86_64 there, arm64 stays as it is.
const APPIMAGE_ARCH_NAMES: Readonly<Record<string, string>> = {x64: 'x86_64', arm64: 'arm64'};

/** Among a release's asset names, the AppImage for this arch; null when there is none (an arch that is not built). */
export function findLinuxAppImage(assetNames: readonly string[], arch: string): string | null {
    const archName = APPIMAGE_ARCH_NAMES[arch];
    if (!archName) {
        return null;
    }
    return assetNames.find(name => name.endsWith(`-linux-${archName}.AppImage`)) ?? null;
}
