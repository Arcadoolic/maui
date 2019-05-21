<script lang="ts">
import {Vue} from 'vue-property-decorator';

export default abstract class ControllableVue extends Vue {
    protected keyPressed: {[key: string]: boolean} = {};

    protected onKeydown(keyActions: (e: Event, isGamepad: boolean) => void) {
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!this.keyPressed[e.key]) {
                this.keyPressed[e.key] = true;
                keyActions(e as KeyboardEvent, false);
            }
        });
        window.addEventListener('gamepadKeydown', (e) => {
            if (!this.keyPressed[(e as CustomEvent).detail.key]) {
                keyActions(e, true);
                this.keyPressed[(e as CustomEvent).detail.key] = true;
            }
        });
    }

    protected onKeyup(keyActions: (e: Event, isGamepad: boolean) => void) {
        window.addEventListener('keyup', (e) => {
            if (this.keyPressed[e.key]) {
                keyActions(e, false);
                this.keyPressed[e.key] = false;
            }
        });
        window.addEventListener('gamepadKeyup', (e) => {
            if (this.keyPressed[(e as CustomEvent).detail.key]) {
                keyActions(e, true);
                this.keyPressed[(e as CustomEvent).detail.key] = false;
            }
        });
    }

}
</script>