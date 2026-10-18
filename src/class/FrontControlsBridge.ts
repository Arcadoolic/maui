// The BO's MAUI > Controls tab and the front (MauiControlsRuntime.ts): the main process asks the
// window to catch the next gamepad input pressed on the cabinet, and tells it to read
// maui-controls.json again once the BO changed it.
export const CAPTURE_PAD_CHANNEL = 'maui:capture-pad';
export const PAD_CAPTURED_CHANNEL = 'maui:pad-captured';
export const CONTROLS_CHANGED_CHANNEL = 'maui:controls-changed';
export const CANCEL_CAPTURE_CHANNEL = 'maui:cancel-capture';

/** A gamepad input caught by the front: a button, or an axis pushed one way. */
export interface PadCapture {
    // The layout of maui-controls.json the pad follows: its own, or "standard".
    layout: string;
    // The pad's name as the system gives it.
    padName: string;
    button?: number;
    axis?: number;
    direction?: 0 | 1;
}

/** The front's answer to CAPTURE_PAD_CHANNEL's `nonce`. */
export interface PadCaptureReply {
    nonce: string;
    capture?: PadCapture;
    // Why nothing was caught: no press in time, a game running...
    error?: string;
    // The BO's page caught the press itself (cancelCapture()).
    cancelled?: boolean;
}

export interface FrontControls {
    /** Resolves with what the front caught, or why it caught nothing. */
    capturePad: (timeoutMs: number) => Promise<PadCapture | {error: string} | {cancelled: true}>;
    controlsChanged: () => void;
    /** The BO's page caught the press itself: the front stops waiting for one. */
    cancelCapture: () => void;
}
