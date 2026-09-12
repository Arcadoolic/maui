import {Vue} from 'vue-property-decorator';

export default abstract class ControllableVue extends Vue {
    protected keyPressed: {[key: string]: boolean} = {};

    // Bound listener references, kept around so beforeDestroy() can remove the exact same
    // function it added - calling keydownHandler()/gamepadKeydownHandler() again there (as this
    // used to) returns a brand-new closure each time, which removeEventListener silently ignores
    // since it never matches what was actually registered. That leaked every handler this class
    // ever registered: each mount/destroy cycle of a ControllableVue-based view (switching Home's
    // tabs, opening/closing Hiscores or user registration) stacked another full set of live
    // keydown/keyup/gamepad handlers still bound to the destroyed instance, all firing alongside
    // the current one - the "several actions per single press" behaviour this is fixing.
    private boundKeydownHandler?: (e: KeyboardEvent) => void;
    private boundKeyupHandler?: (e: KeyboardEvent) => void;
    private boundGamepadKeydownHandler?: (e: Event) => void;
    private boundGamepadKeyupHandler?: (e: Event) => void;

    protected onKeydown(keyActions: (e: Event, isGamepad: boolean) => void) {
        this.boundKeydownHandler = this.keydownHandler(keyActions, true);
        this.boundGamepadKeydownHandler = this.gamepadKeydownHandler(keyActions, true);
        window.addEventListener('keydown', this.boundKeydownHandler);
        window.addEventListener('gamepadKeydown', this.boundGamepadKeydownHandler);
    }

    protected onKeyup(keyActions: (e: Event, isGamepad: boolean) => void) {
        this.boundKeyupHandler = this.keydownHandler(keyActions, false);
        this.boundGamepadKeyupHandler = this.gamepadKeydownHandler(keyActions, false);
        window.addEventListener('keyup', this.boundKeyupHandler);
        window.addEventListener('gamepadKeyup', this.boundGamepadKeyupHandler);
    }

    protected keydownHandler(keyActions?: (e: Event, isGamepad: boolean) => void, keyPressed?: boolean) {
        return (e: KeyboardEvent) => {
            if ((keyPressed && !this.keyPressed[e.key]) || (!keyPressed && this.keyPressed[e.key])) {
                if (keyPressed !== undefined) {
                    this.keyPressed[e.key] = keyPressed;
                }
                if (keyActions) {
                    keyActions(e as KeyboardEvent, false);
                }
            }
        };
    }

    protected gamepadKeydownHandler(keyActions?: (e: Event, isGamepad: boolean) => void, keyPressed?: boolean) {
        return (e) => {
            if ((keyPressed && !this.keyPressed[(e as CustomEvent).detail.key]) ||
                (!keyPressed && this.keyPressed[(e as CustomEvent).detail.key])) {
                if (keyPressed !== undefined) {
                    this.keyPressed[(e as CustomEvent).detail.key] = keyPressed;
                }
                if (keyActions) {
                    keyActions(e as KeyboardEvent, true);
                }
            }
        };
    }

    protected beforeDestroy() {
        if (this.boundKeydownHandler) {
            window.removeEventListener('keydown', this.boundKeydownHandler);
        }
        if (this.boundGamepadKeydownHandler) {
            window.removeEventListener('gamepadKeydown', this.boundGamepadKeydownHandler);
        }
        if (this.boundKeyupHandler) {
            window.removeEventListener('keyup', this.boundKeyupHandler);
        }
        if (this.boundGamepadKeyupHandler) {
            window.removeEventListener('gamepadKeyup', this.boundGamepadKeyupHandler);
        }
    }
}
