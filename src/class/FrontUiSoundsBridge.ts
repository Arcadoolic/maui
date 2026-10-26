// The BO's MAUI tab sets the front's sounds (UiSounds.ts): the main process tells the window to
// read them again once saved, and plays the test sound there, on the cabinet, since the BO may be
// open on a phone.
export const UI_SOUNDS_CHANGED_CHANNEL = 'maui:ui-sounds-changed';
export const UI_SOUNDS_TEST_CHANNEL = 'maui:ui-sounds-test';

export interface FrontUiSounds {
    changed(): void;
    /** False when the front's window is not open. */
    test(volume: number): boolean;
}
