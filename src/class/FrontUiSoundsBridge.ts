import type {UiSoundToggle} from '@/class/UiSounds';

// The BO's MAUI > Sounds subtab sets the front's sounds (UiSounds.ts): the main process tells the
// window to read them again once saved, and plays a sound there when asked, on the cabinet, since
// the BO may be open on a phone.
export const UI_SOUNDS_CHANGED_CHANNEL = 'maui:ui-sounds-changed';
export const UI_SOUNDS_TEST_CHANNEL = 'maui:ui-sounds-test';

export interface FrontUiSounds {
    changed(): void;
    /** False when the front's window is not open. */
    test(volume: number, sound: UiSoundToggle): boolean;
}
