import {Vue} from 'vue-property-decorator';

export default abstract class ControllableVue extends Vue {
    protected keyPressed: {[key: string]: boolean} = {};

    protected onKeydown(keyActions: (e: Event, isGamepad: boolean) => void) {
        window.addEventListener('keydown', this.keydownHandler(keyActions, true));
        window.addEventListener('gamepadKeydown', this.gamepadKeydownHandler(keyActions, true));
    }

    protected onKeyup(keyActions: (e: Event, isGamepad: boolean) => void) {
        window.addEventListener('keyup',  this.keydownHandler(keyActions, false));
        window.addEventListener('gamepadKeyup', this.gamepadKeydownHandler(keyActions, false));
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
        window.removeEventListener('keydown', this.keydownHandler());
        window.removeEventListener('gamepadKeydown', this.gamepadKeydownHandler());
        window.removeEventListener('keyup',  this.keydownHandler());
        window.removeEventListener('gamepadKeyup', this.gamepadKeydownHandler());
    }
}
