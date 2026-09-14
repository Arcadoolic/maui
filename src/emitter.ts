import mitt from 'mitt';

// Replaces src/EventBus.ts (`new Vue()` used purely as an event bus - `$on`/`$off` are gone from
// the Vue 3 instance, so that pattern no longer works at all). Used for exactly 2 events, matching
// the design doc's own count (section 2.1): 'game-quit' (Home.vue emits, Champions.vue and
// Hiscores.vue listen) and 'hiscores-loaded' (Init.vue emits, Champions.vue listens). Neither
// event carries a payload.
export type AppEvents = {
    'game-quit': undefined;
    'hiscores-loaded': undefined;
};

export const emitter = mitt<AppEvents>();
