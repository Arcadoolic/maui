// The front's "Lite" mode, for hardware where Chromium composites in software (a Raspberry Pi 3
// kept two cores busy drawing an idle home screen, see docs/RASPBERRY-PI-LAG.md): same screen,
// without the animations, transitions, blurs and shadows. Electron-free: read by the renderer
// (App.vue) and by the BO (boServer.ts), each with its own way of asking Electron about the GPU.

export const UI_MODE_SETTINGS = ['auto', 'lite', 'full'] as const;
/** What the BO's MAUI tab stores: "auto" leaves the choice to the hardware. */
export type UiModeSetting = typeof UI_MODE_SETTINGS[number];
export type UiMode = 'lite' | 'full';

export interface UiModeHardware {
    totalMemBytes: number;
    // Electron's app.getGPUFeatureStatus().gpu_compositing ("enabled", "disabled_software"...);
    // undefined when it could not be read, which then decides nothing.
    gpuCompositing?: string;
}

// At or under this much memory, "auto" means Lite whatever the GPU says.
const LITE_MEMORY_BYTES = 2 * 1024 ** 3;

/** Anything but a known setting (older config file, hand edit) reads as "auto". */
export function parseUiModeSetting(value: unknown): UiModeSetting {
    return UI_MODE_SETTINGS.find(setting => setting === value) ?? 'auto';
}

export function resolveUiMode(setting: UiModeSetting, hardware: UiModeHardware): UiMode {
    if (setting !== 'auto') {
        return setting;
    }
    const softwareCompositing = hardware.gpuCompositing !== undefined && hardware.gpuCompositing !== 'enabled';
    return hardware.totalMemBytes <= LITE_MEMORY_BYTES || softwareCompositing ? 'lite' : 'full';
}
