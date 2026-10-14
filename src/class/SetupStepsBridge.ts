import type {SetupProgress} from '@/class/SetupSteps';

// The setup guide's steps are worked out in the main process (background.ts), which runs while the
// BO is not loaded; the front reads them through @electron/remote under this global name, like
// the ONLINE badge (OnlineIndicatorBridge.ts). Null until the first reading is done.
export const SETUP_PROGRESS_GLOBAL = 'mauiSetupProgress';

export type SetupProgressReader = () => SetupProgress | null;
