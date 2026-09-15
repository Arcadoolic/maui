# Vue 2 to Vue 3 migration: port and cleanup (spec steps 3-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Vue-free service layer and all 12 SFC to Vue 3 `<script setup>`, wire the real
app through electron-vite, and delete the vue-cli/Vuex/decorator-library legacy, completing spec
steps 3-5.

**Architecture:** Bottom-up source conversion (leaves first, `App.vue`/`main.ts`/`router.ts` last),
matching the design's step 4 sequencing. The old `vue-cli` pipeline is already inoperable (Vue 3
was installed for the step-2 plumbing probe), so intermediate tasks are verified by typecheck and
lint only; the app becomes runnable again only once the final task rewires `main.ts`, `router.ts`,
`App.vue` and `electron.vite.config.ts` together.

**Tech Stack:** Vue 3.5, `<script setup>` + Composition API, `vue-router` 5, `mitt`, electron-vite
5 (already configured for the plumbing probe), TypeScript 5.9.

**Spec:** `docs/superpowers/specs/2026-09-10-vue3-migration-design.md`
**Prior decisions and findings:** `docs/DECISIONS.md`
**Current state:** `docs/PROGRESSION.md`

## Global Constraints

- Platform floor: macOS 15.1+ and Linux (Ubuntu 24.04+, Debian 13+). macOS has never been
  verified in this migration (Linux-only environment) - this plan does not close that gap, see
  DECISIONS.md.
- Never run two `just serve` / `just build` at once: both trigger `npm install`, and concurrent
  installs corrupt the native `sqlite3` rebuild.
- D2: `<script setup>` + composables for every ported component, no decorator library
  (`vue-class-component`/`vue-property-decorator` are Vue-2-only, removed at step 5).
- D3: delete Vuex; `src/services.ts` is a plain TS module, function-based accessors (not Vuex
  getters), see Task 1 for the exact API every later task must call by these names.
- D4: do not touch the Electron process model. `nodeIntegration: true`, `contextIsolation: false`,
  `sandbox: false`, `@electron/remote` all stay exactly as they are.
- **No new automated tests are added in this plan for services.ts, composables, or ported SFC.**
  This is a deliberate ruling, not an oversight: the design's own D5 already scoped
  characterization tests to the silent-failure surface (mame ini parsing, path resolution) and
  explicitly left `store.ts`, `boServer.ts` and the Vue layer untested, because their failure mode
  is loud (the app doesn't boot, or a visible action does nothing) rather than silent. Adding a
  new test framework (`@vue/test-utils`, a DOM environment) for this migration's port work would
  be scope beyond what the approved spec asked for. Verification for every task in this plan is
  `npx tsc --noEmit` + `npm run lint` (no new errors) plus, once the app is runnable again (Task
  12), the manual smoke path from spec step 4's exit criteria. The existing 51 Vitest
  characterization tests must stay green throughout (`npm test`).
- 4-space indent, single quotes, Conventional Commits (project-wide style, `eslint.config.js`).
- `tsc --noEmit` baseline going into this plan: **exactly 6 errors**, all in not-yet-ported Vue 2
  code (`src/ControllableVue.ts`, `src/EventBus.ts`, `src/main.ts` x2, `src/router.ts`,
  `src/store.ts`). Every task in this plan must leave that count unchanged until Task 12 (which
  replaces `main.ts`/`router.ts`, dropping the count to 3) and Task 13 (which deletes the
  remaining 3 dead files, dropping it to 0). Never suppress a real new error to hit these numbers;
  if a task introduces a genuine new error, fix the cause, don't hide it.

---

## Step 3: Vue-free layers

### Task 1: `src/services.ts` (replaces the Vuex store)

The plumbing probe (spec step 2) already proved `Category`/`Game`/`User`/`Hiscore` and
`sequelize-typescript` build and run correctly under electron-vite's swc transform, using these
same model files. This task only replaces the *wiring* (`src/store.ts`'s Vuex `Store` and its
`initServices` mutation) with a plain module: no class/model file changes are needed or expected.

**Files:**
- Create: `src/services.ts`
- No test file (see Global Constraints: services.ts is a like-for-like replacement of `store.ts`,
  which itself was never characterized - same risk profile, same ruling).

**Interfaces:**
- Produces (used by every task from Task 5 onward): `initServices(): void`,
  `getIsInit(): boolean`, `getConfiguration(): Config`, `getDatabase(): Database`,
  `getMameService(): MameService`, `getGameService(): GameService`,
  `getUserService(): UserService`, `getHiscoreService(): HiscoreService`, all named exports from
  `@/services`.

- [ ] **Step 1: Create `src/services.ts`**

```ts
import Config from '@/class/Config.class';
import Database from '@/class/Database.class';
import GameService from '@/class/GameService.class';
import MameService from '@/class/MameService.class';
import UserService from '@/class/UserService.class';
import HiscoreService from '@/class/HiscoreService.class';

// Replaces the Vuex store (src/store.ts, deleted at step 5 - see DECISIONS.md D3). Every
// `$store` access in the app was an imperative read inside a method: zero template bindings,
// zero computed, zero watch, so Vuex's reactivity bought nothing here. This is the same
// dependency-injection responsibility (build the services once, in order, hand them out), with
// no framework underneath.

const configuration = new Config();
const database = new Database();

let mameService: MameService | null = null;
let gameService: GameService | null = null;
let userService: UserService | null = null;
let hiscoreService: HiscoreService | null = null;
let isInit = false;

/**
 * Builds mameService/userService/hiscoreService/gameService in the same dependency order as the
 * old Vuex `initServices` mutation, exactly once. Called from Init.vue's onMounted once the
 * config file is confirmed to exist and be loaded.
 */
export function initServices(): void {
    if (isInit) {
        return;
    }
    mameService = new MameService(configuration);
    userService = new UserService(configuration);
    hiscoreService = new HiscoreService(mameService.iniPath, userService);
    gameService = new GameService(mameService, hiscoreService);
    isInit = true;
}

export function getIsInit(): boolean {
    return isInit;
}

export function getConfiguration(): Config {
    return configuration;
}

export function getDatabase(): Database {
    return database;
}

export function getMameService(): MameService {
    return mameService!;
}

export function getGameService(): GameService {
    return gameService!;
}

export function getUserService(): UserService {
    return userService!;
}

export function getHiscoreService(): HiscoreService {
    return hiscoreService!;
}
```

- [ ] **Step 2: Verify no regression**

Run: `npx tsc --noEmit`
Expected: exactly the same 6 pre-existing errors as the Global Constraints baseline, nothing new
from `services.ts`.

Run: `npm run lint`
Expected: 0 errors (warnings may shift by a small amount; no new error-level findings).

Run: `npm test`
Expected: 51 passed (unchanged - `services.ts` isn't imported by anything yet).

- [ ] **Step 3: Commit**

```bash
git add src/services.ts
git commit -m "feat(services): add services.ts, the plain-module replacement for the Vuex store"
```

---

## Step 4: components, bottom-up

### Task 2: shared infrastructure - `src/emitter.ts` and `src/composables/useControllable.ts`

Both are small, foundational, and needed by several later tasks (Champions, Hiscores, Init, Home
need the emitter; Home and userRegistration need the composable). Building them first means every
component task from here on only ever *consumes* these two files, never modifies them.

**Files:**
- Create: `src/emitter.ts`
- Create: `src/composables/useControllable.ts`

**Interfaces:**
- Produces: `emitter: Emitter<AppEvents>` from `@/emitter`, with `AppEvents` covering
  `'game-quit'` and `'hiscores-loaded'` (both no-payload events, called as `emitter.emit('game-quit')`
  / `emitter.emit('hiscores-loaded')`).
- Produces: `useControllable(): {onKeydown: (keyActions: KeyAction) => void, onKeyup: (keyActions: KeyAction) => void}`
  from `@/composables/useControllable`, where
  `type KeyAction = (e: Event, isGamepad: boolean) => void`.

- [ ] **Step 1: Add the `mitt` dependency**

```bash
npm install mitt@^3.0.1
```

- [ ] **Step 2: Create `src/emitter.ts`**

```ts
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
```

- [ ] **Step 3: Create `src/composables/useControllable.ts`**

```ts
import {onUnmounted} from 'vue';

export type KeyAction = (e: Event, isGamepad: boolean) => void;

/**
 * Combined keyboard + gamepad key handling, matching the gamepadKeydown/gamepadKeyup
 * CustomEvents Gamepads.class.ts dispatches. Replaces src/ControllableVue.ts: Vue 3 has no
 * idiomatic class inheritance for components (D2), so this is a composable instead -
 * `const {onKeydown, onKeyup} = useControllable()`.
 *
 * Ported bug fix (design doc D2 detail): the original ControllableVue.beforeDestroy() called
 * keydownHandler()/gamepadKeydownHandler() again to get "the" listener to remove, which returns a
 * brand-new closure every time - removeEventListener silently ignored it, so every mount/destroy
 * cycle leaked a full set of handlers still bound to the destroyed instance. This composable keeps
 * the exact bound function references from registration and removes those same references in
 * onUnmounted().
 */
export function useControllable() {
    const keyPressed: {[key: string]: boolean} = {};

    function keydownHandler(keyActions: KeyAction, isKeydown: boolean) {
        return (e: KeyboardEvent) => {
            if ((isKeydown && !keyPressed[e.key]) || (!isKeydown && keyPressed[e.key])) {
                keyPressed[e.key] = isKeydown;
                keyActions(e, false);
            }
        };
    }

    function gamepadKeydownHandler(keyActions: KeyAction, isKeydown: boolean) {
        return (e: Event) => {
            const key = (e as CustomEvent).detail.key;
            if ((isKeydown && !keyPressed[key]) || (!isKeydown && keyPressed[key])) {
                keyPressed[key] = isKeydown;
                keyActions(e, true);
            }
        };
    }

    let boundKeydownHandler: ((e: KeyboardEvent) => void) | undefined;
    let boundKeyupHandler: ((e: KeyboardEvent) => void) | undefined;
    let boundGamepadKeydownHandler: ((e: Event) => void) | undefined;
    let boundGamepadKeyupHandler: ((e: Event) => void) | undefined;

    function onKeydown(keyActions: KeyAction) {
        boundKeydownHandler = keydownHandler(keyActions, true);
        boundGamepadKeydownHandler = gamepadKeydownHandler(keyActions, true);
        window.addEventListener('keydown', boundKeydownHandler);
        window.addEventListener('gamepadKeydown', boundGamepadKeydownHandler);
    }

    function onKeyup(keyActions: KeyAction) {
        boundKeyupHandler = keydownHandler(keyActions, false);
        boundGamepadKeyupHandler = gamepadKeydownHandler(keyActions, false);
        window.addEventListener('keyup', boundKeyupHandler);
        window.addEventListener('gamepadKeyup', boundGamepadKeyupHandler);
    }

    onUnmounted(() => {
        if (boundKeydownHandler) {
            window.removeEventListener('keydown', boundKeydownHandler);
        }
        if (boundGamepadKeydownHandler) {
            window.removeEventListener('gamepadKeydown', boundGamepadKeydownHandler);
        }
        if (boundKeyupHandler) {
            window.removeEventListener('keyup', boundKeyupHandler);
        }
        if (boundGamepadKeyupHandler) {
            window.removeEventListener('gamepadKeyup', boundGamepadKeyupHandler);
        }
    });

    return {onKeydown, onKeyup};
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/emitter.ts src/composables/useControllable.ts
git commit -m "feat(vue3): add the mitt event emitter and useControllable composable"
```

---

### Task 3: trivial leaf components - `Loader.vue`, `Modal.vue`, `Gamepads.vue`

Batched: all three are small, self-contained, and use no service/emitter dependency. Templates
are unchanged for all three; only the `<script>` block is rewritten.

**Files:**
- Modify: `src/components/Loader.vue`
- Modify: `src/components/Modal.vue`
- Modify: `src/components/Gamepads.vue`

**Interfaces:**
- No new interfaces produced; both `Loader` and `Modal` keep their existing prop/slot contract
  (`Loader` takes `duration?: number`; `Modal` renders a default slot).

- [ ] **Step 1: Rewrite `src/components/Loader.vue`'s script block**

```vue
<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(defineProps<{duration?: number}>(), {duration: 2});

console.log(props.duration);

const leftPieStyle = computed(() => ({
    'animation-duration': ['-webkit-', props.duration / 2 + 's'],
}));

const rightPieStyle = computed(() => ({
    'animation-duration': ['-webkit-', props.duration / 2 + 's'],
    'animation-delay': ['-webkit-', props.duration / 2 + 's'],
}));
</script>
```

The template and `<style>` block are unchanged.

- [ ] **Step 2: Rewrite `src/components/Modal.vue`'s script block**

```vue
<script setup lang="ts">
import {onMounted, useTemplateRef} from 'vue';

const modalRef = useTemplateRef<HTMLDivElement>('modal');

onMounted(() => {
    const modal = modalRef.value!;
    modal.style.top = (window.innerHeight / 2) - (modal.clientHeight / 2) + 'px';
});
</script>
```

The template (`ref="modal"` stays the same string) and `<style>` block are unchanged.

- [ ] **Step 3: Rewrite `src/components/Gamepads.vue`'s script block**

```vue
<script setup lang="ts">
import {ref, onMounted} from 'vue';

const gamepadCount = ref(0);

onMounted(() => {
    window.addEventListener('gamepadCountUpdate', (e) => {
        gamepadCount.value = (e as CustomEvent).detail.gamepadCount;
    });
});
</script>
```

The template and `<style>` block are unchanged (`{{gamepadCount}}` still works: script-setup refs
auto-unwrap in the template).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Loader.vue src/components/Modal.vue src/components/Gamepads.vue
git commit -m "refactor(vue3): port Loader, Modal and Gamepads to script setup"
```

---

### Task 4: `src/components/Categories.vue`

No `$store`/EventBus dependency. `Categories` extends `ControllableVue` today but never calls
`onKeydown`/`onKeyup` anywhere in its body - the inheritance is vestigial. Drop it; no composable
needed.

**Files:**
- Modify: `src/components/Categories.vue`

**Interfaces:**
- Consumes: `Category` from `@/model/Category.model` (unchanged).
- Produces: same prop contract as before (`categories: Category[]`, `selectedCategoryIndex?: number`).

- [ ] **Step 1: Add a `:key` to the `v-for`**

Switching `eslint.config.js`'s Vue preset to the Vue 3 one in Task 12 turns on
`vue/require-v-for-key`. Add the key now, while touching this file, rather than as an unrelated
change later:

```html
<template>
    <div class="categories">
        <div class="category" :class="getCategoryClasses(0)"></div>
        <div
            class="category"
            v-for="(category, index) in categories"
            :key="category.id_category"
            :class="getCategoryClasses(index + 1)"
        ></div>
    </div>
</template>
```

- [ ] **Step 2: Rewrite the script block**

```vue
<script setup lang="ts">
import Category from '@/model/Category.model';

const props = withDefaults(defineProps<{
    categories: Category[];
    selectedCategoryIndex?: number;
}>(), {selectedCategoryIndex: 0});

function getCategoryClasses(index: number) {
    const catLen = props.categories.length + 1;
    let previous = props.selectedCategoryIndex - 1 === index;
    let previous2 = props.selectedCategoryIndex - 2 === index;
    let next2 = props.selectedCategoryIndex + 2 === index;
    if (props.selectedCategoryIndex === 0) {
        previous = index === catLen - 1;
        previous2 = index === catLen - 2;
    } else if (props.selectedCategoryIndex === 1) {
        previous2 = catLen - 1 === index;
    }

    let next = props.selectedCategoryIndex + 1 === index;
    if (props.selectedCategoryIndex === catLen - 1) {
        next = 0 === index;
        next2 = 1 === index;
    } else if (props.selectedCategoryIndex === catLen - 2) {
        next2 = 0 === index;
    }

    const classes: {[key: string]: boolean} = {
        selected: props.selectedCategoryIndex === index,
        previous,
        next,
        previous2,
        next2,
    };
    if (index > 0) {
        const classLogo = props.categories[index - 1].name.replace(/([\s\W]+)/, '_').toLowerCase();
        classes[classLogo] = true;
    }
    return classes;
}
</script>
```

The `<style scoped>` block is unchanged.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 4: Commit**

```bash
git add src/components/Categories.vue
git commit -m "refactor(vue3): port Categories to script setup"
```

---

### Task 5: `src/components/Champions.vue`

First component that needs `services.ts` (`getConfiguration`, `getUserService`) and the `emitter`.

**Files:**
- Modify: `src/components/Champions.vue`

**Interfaces:**
- Consumes: `getConfiguration()`, `getUserService()` from `@/services` (Task 1); `emitter` from
  `@/emitter` (Task 2).

- [ ] **Step 1: Add a `:key` to the `v-for`**

```html
<div v-for="(champion, index) of champions" :key="champion.id_hiscore" class="champion" :style="{right: (index * 10) + '%'}">
```

- [ ] **Step 2: Rewrite the script block**

```vue
<script setup lang="ts">
import {ref, watch, onMounted} from 'vue';
import Game from '@/model/Game.model';
import User from '@/model/User.model';
import Hiscore from '@/model/Hiscore.model';
import {join} from 'path';
import {format} from 'url';
import {emitter} from '@/emitter';
import {getConfiguration, getUserService} from '@/services';
import * as SequelizeTS from 'sequelize-typescript';

const Sequelize = SequelizeTS.Sequelize;

const props = defineProps<{game: Game}>();

const champions = ref<Hiscore[]>([]);
const loading = ref(true);
const avatars = ref<string[]>([]);

async function onGameChange() {
    loading.value = true;
    const result = await props.game.$get(
        'hiscores',
        {
            include: [{model: User}],
            attributes: {include: [[Sequelize.fn('MAX', Sequelize.col('score')), 'max_score']]},
            limit: 3,
            order: [['score', 'DESC']],
            group: ['user.id_user'],
        },
    ) as Hiscore[] || [];
    champions.value = result.reverse();
    loading.value = false;
}

function getAvatar(user: User) {
    if (avatars.value.indexOf(user.pseudo_3 + '.png') >= 0) {
        return format({
            pathname: join(getConfiguration().avatarsPath, user.pseudo_3 + '.png'),
            protocol: 'file',
            slashes: true,
        });
    }
    return false;
}

watch(() => props.game, onGameChange);

onMounted(async () => {
    avatars.value = getUserService().getAvatars();
    await onGameChange();

    // Preserved as-is: the original never called EventBus.$off here either. Not fixed in this
    // migration - out of scope (only the ControllableVue leak from D2 is an approved fix).
    emitter.on('game-quit', onGameChange);
    emitter.on('hiscores-loaded', onGameChange);
});
</script>
```

The `<style scoped>` block is unchanged.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 4: Commit**

```bash
git add src/components/Champions.vue
git commit -m "refactor(vue3): port Champions to script setup"
```

---

### Task 6: `src/components/Hiscores.vue`

Same shape as Champions. `Hiscores` extends `ControllableVue` today but never calls
`onKeydown`/`onKeyup` - drop the inheritance, no composable needed here either.

**Files:**
- Modify: `src/components/Hiscores.vue`

**Interfaces:**
- Consumes: `getConfiguration()`, `getUserService()` from `@/services`; `emitter` from `@/emitter`.

- [ ] **Step 1: Add a `:key` to the `v-for`**

```html
<div class="hiscore" :class="{first: index === 0}" v-for="(score, index) of scores" :key="score.id_hiscore">
```

- [ ] **Step 2: Rewrite the script block**

```vue
<script setup lang="ts">
import {ref, watch, onMounted} from 'vue';
import Game from '@/model/Game.model';
import Hiscore from '@/model/Hiscore.model';
import User from '@/model/User.model';
import {join} from 'path';
import {format} from 'url';
import {emitter} from '@/emitter';
import {getConfiguration, getUserService} from '@/services';

const props = defineProps<{game: Game}>();

const scores = ref<Hiscore[]>([]);
const loading = ref(true);
const avatars = ref<string[]>([]);

async function onGameChange() {
    loading.value = true;
    scores.value = await props.game.$get(
        'hiscores',
        {include: [{model: User}], limit: 10, order: [['score', 'DESC']], group: ['score', 'user.id_user']},
    ) as Hiscore[] || [];
    loading.value = false;
}

function getAvatar(user: User) {
    if (avatars.value.indexOf(user.pseudo_3 + '.png') >= 0) {
        return format({
            pathname: join(getConfiguration().avatarsPath, user.pseudo_3 + '.png'),
            protocol: 'file',
            slashes: true,
        });
    }
    return false;
}

watch(() => props.game, onGameChange);

onMounted(async () => {
    avatars.value = getUserService().getAvatars();
    await onGameChange();

    // Preserved as-is, same reasoning as Champions.vue: no EventBus.$off in the original either.
    emitter.on('game-quit', onGameChange);
});
</script>
```

The `<style scoped>` block is unchanged.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 4: Commit**

```bash
git add src/components/Hiscores.vue
git commit -m "refactor(vue3): port Hiscores to script setup"
```

---

### Task 7: `src/components/Games.vue`

Needs `services.ts` (`getMameService`, `getGameService`) and a template ref. `focused` prop is
declared but unused anywhere in the original script or template beyond its declaration, and no
caller (`Home.vue`) passes it - preserved as-is (dead prop kept, not this migration's job to prune
unrelated dead code).

**Files:**
- Modify: `src/components/Games.vue`

**Interfaces:**
- Consumes: `getMameService()`, `getGameService()` from `@/services`; `Champions.vue` (Task 5,
  unchanged prop contract: `game: Game`).

- [ ] **Step 1: Add a `:key` to the `v-for`**

```html
<li v-for="(game, index) in games" :key="game.id_game" :class="{selected: selectedGameIndex === index}">
```

- [ ] **Step 2: Rewrite the script block**

```vue
<script setup lang="ts">
import {ref, watch, useTemplateRef} from 'vue';
import Champions from '@/components/Champions.vue';
import Game from '@/model/Game.model';
import {join} from 'path';
import {format} from 'url';
import {getMameService, getGameService} from '@/services';

const props = withDefaults(defineProps<{
    games: Game[];
    selectedGameIndex?: number;
    focused?: boolean;
}>(), {selectedGameIndex: 0, focused: true});

const gameListRef = useTemplateRef<HTMLUListElement>('gameList');

const mameService = getMameService();
const gameService = getGameService();

const marqueesPath = ref(mameService.marqueePath);
const marquees = ref<string[]>(gameService.loadMarquees());
const flyersPath = ref(mameService.flyerPath);
const flyers = ref<string[]>(gameService.loadFlyers());
const logosPath = ref(mameService.logoPath);
const logos = ref<string[]>(gameService.loadLogos());

watch(() => props.selectedGameIndex, (val) => {
    if (gameListRef.value) {
        gameListRef.value.style.top = (-10 * val) + '%';
    }
});

function findMediaPath(dirPath: string, filenames: string[], romName: string): string | null {
    const i = filenames.indexOf(romName + '.png');
    return i < 0 ? null : join(dirPath, filenames[i]);
}

function toFileUrl(path: string): string {
    return format({pathname: path, protocol: 'file', slashes: true});
}

function getMarquee(romName: string) {
    const path = findMediaPath(marqueesPath.value, marquees.value, romName);
    return path ? `url(${toFileUrl(path)})` : '';
}

function getFlyer(romName: string) {
    const path = findMediaPath(flyersPath.value, flyers.value, romName);
    return path ? `url(${toFileUrl(path)})` : '';
}

function getLogo(romName: string) {
    const path = findMediaPath(logosPath.value, logos.value, romName);
    return path ? toFileUrl(path) : '';
}

/**
 * When a game has no marquee, show its (blurred) flyer with the logo overlaid on top instead -
 * only when both are actually available, otherwise fall back to the default marquee background
 * image from CSS.
 */
function hasFlyerLogoFallback(romName: string): boolean {
    return !findMediaPath(marqueesPath.value, marquees.value, romName)
        && !!findMediaPath(flyersPath.value, flyers.value, romName)
        && !!findMediaPath(logosPath.value, logos.value, romName);
}
</script>
```

The template (`ref="gameList"` string unchanged) and `<style scoped>` block are otherwise
unchanged.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 4: Commit**

```bash
git add src/components/Games.vue
git commit -m "refactor(vue3): port Games to script setup"
```

---

### Task 8: `src/components/userRegistration.vue`

First (and only, besides `Home.vue`) consumer of `useControllable()`.

**Files:**
- Modify: `src/components/userRegistration.vue`

**Interfaces:**
- Consumes: `useControllable()` from `@/composables/useControllable` (Task 2); `Modal.vue`
  (Task 3, unchanged, default slot).
- Produces: emits `quit` (unchanged event name, `Home.vue` listens to it in Task 11).

- [ ] **Step 1: Rewrite the script block**

```vue
<script setup lang="ts">
import {ref, computed} from 'vue';
import {useControllable} from '@/composables/useControllable';
import User from '@/model/User.model';
import Modal from '@/components/Modal.vue';

const emit = defineEmits<{quit: []}>();

const username = ref<{[key: number]: string}>({0: 'A', 1: 'A', 2: 'A'});
const selectedLetter = ref(0);
const success = ref(false);
const error = ref(false);
const loading = ref(false);
const pristine = ref(true);

const usernameString = computed(() => username.value[0] + username.value[1] + username.value[2]);

function nextLetter() {
    if (!loading.value) {
        username.value[selectedLetter.value] = username.value[selectedLetter.value] === 'Z' ? 'A' :
            String.fromCharCode(username.value[selectedLetter.value].charCodeAt(0) + 1);
    }
}

function previousLetter() {
    if (!loading.value) {
        username.value[selectedLetter.value] = username.value[selectedLetter.value] === 'A' ? 'Z' :
            String.fromCharCode(username.value[selectedLetter.value].charCodeAt(0) - 1);
    }
}

function nextSelectedLetter() {
    if (!loading.value) {
        selectedLetter.value = selectedLetter.value === 2 ? 0 : selectedLetter.value + 1;
    }
}

function previousSelectedLetter() {
    if (!loading.value) {
        selectedLetter.value = selectedLetter.value === 0 ? 2 : selectedLetter.value - 1;
    }
}

function addUser() {
    if (loading.value || pristine.value) {
        return;
    }
    error.value = false;
    loading.value = true;
    User.findOrCreate({where: {pseudo_3: usernameString.value}, defaults: {active: false}})
        .then(([user, created]) => {
            if (created) {
                success.value = true;
            } else if (user) {
                error.value = true;
            }
            loading.value = false;
        });
}

const {onKeydown, onKeyup} = useControllable();

onKeydown((e, isGamepad) => {
    const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
    switch (key) {
    case 'ArrowUp':
        previousLetter();
        break;
    case 'ArrowDown':
        nextLetter();
        break;
    case 'ArrowLeft':
        previousSelectedLetter();
        break;
    case 'ArrowRight':
        nextSelectedLetter();
        break;
    case 'KeyP':
        addUser();
        break;
    case 'Space':
        emit('quit');
        break;
    }
    pristine.value = false;
});

onKeyup(() => {
    // No-op: keyup is handled by the keydown listener above.
});
</script>
```

The template is unchanged.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 3: Commit**

```bash
git add src/components/userRegistration.vue
git commit -m "refactor(vue3): port userRegistration to script setup, use useControllable"
```

---

### Task 9: `src/views/Config.vue`

Trivial: `remote.shell.openExternal` and a computed URL string, no service dependency.

**Files:**
- Modify: `src/views/Config.vue`

- [ ] **Step 1: Rewrite the script block**

```vue
<script setup lang="ts">
import {BO_SERVER_PORT} from '@/boServerPort';
import * as remote from '@electron/remote';

const configUrl = `http://localhost:${BO_SERVER_PORT}`;

// Opened in the OS's default browser (not navigated to in this frameless kiosk window) - the
// whole point is to configure the app from a real browser, per the message above.
function openConfigUrl() {
    remote.shell.openExternal(configUrl);
}
</script>
```

The template and `<style scoped>` block are unchanged (the template's `{{ }}` bindings referenced
`configUrl` only through the anchor's `@click`, no other change needed).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 3: Commit**

```bash
git add src/views/Config.vue
git commit -m "refactor(vue3): port the Config view to script setup"
```

---

### Task 10: `src/views/Init.vue`

Needs `services.ts` (`initServices`, all the getters) and router navigation. **Do not use
`useRouter()`** here: that composable does not exist in `vue-router` 3 (the version still
installed until Task 12), so importing it now would break `tsc --noEmit` before Task 12 ever
runs. Import the router singleton directly instead - `import router from '@/router'` - which
exports the same `.push()`-bearing instance under both the current `vue-router` 3 and the
`vue-router` 5 Task 12 installs, so this file needs no changes when that dependency bump happens.

**Files:**
- Modify: `src/views/Init.vue`

**Interfaces:**
- Consumes: `getConfiguration()`, `getDatabase()`, `initServices()`, `getMameService()`,
  `getGameService()`, `getUserService()`, `getHiscoreService()` from `@/services`; `emitter` from
  `@/emitter`.

- [ ] **Step 1: Rewrite the script block**

```vue
<script setup lang="ts">
import * as remote from '@electron/remote';
import {ref, onMounted} from 'vue';
import router from '@/router';
import {emitter} from '@/emitter';
import {
    getConfiguration,
    getDatabase,
    initServices,
    getMameService,
    getGameService,
    getUserService,
    getHiscoreService,
} from '@/services';

const error = ref<string | null>(null);

remote.getCurrentWindow().setResizable(true);
remote.getCurrentWindow().setFullScreen(false);
remote.getCurrentWindow().setSize(346, 354);
remote.getCurrentWindow().center();

onMounted(async () => {
    const config = getConfiguration();
    const database = getDatabase();

    config.load();
    if (!config.loaded()) {
        // If no config or not valid, redirect to config page
        router.push({name: 'config'});
        return;
    }
    initServices();
    const mameService = getMameService();
    const gameService = getGameService();
    const userService = getUserService();
    const hiService = getHiscoreService();

    try {
        if (!database.exist()) {
            // Create database file if not existing
            await database.install();
        } else {
            await database.update();
        }

        // (Re)seed categories from genre.ini before syncing games below: it may have been added
        // (or replaced) after the database already existed, and games are synced with an
        // id_category that must already exist in this table (see Database.syncCategories()'s own
        // comment).
        await database.syncCategories(gameService);

        // Save new games
        const romList = mameService.getRomListFromFavorites();
        await gameService.saveGamesFromRomNames(romList);

        await userService.loadUsers();
        hiService.saveHiscores(await gameService.loadGames()).then(() => {
            emitter.emit('hiscores-loaded');
        });

        router.push({name: 'home'});
    } catch (e) {
        // e.g. Database.install() refusing to run because genre.ini hasn't been installed yet by
        // a starting pack import - stay on this screen with the message instead of silently
        // hanging on a blank splash.
        error.value = e instanceof Error ? e.message : 'Erreur inattendue au démarrage.';
    }
});
</script>
```

The template and `<style scoped>` block are unchanged.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 3: Commit**

```bash
git add src/views/Init.vue
git commit -m "refactor(vue3): port the Init view to script setup"
```

---

### Task 11: `src/views/Home.vue`

The largest view. Needs `services.ts`, `emitter`, `useControllable()`, and all the already-ported
child components. **Do not use `useRouter()`** - same reasoning as Task 10: that composable does
not exist in `vue-router` 3, still installed until Task 12. Import the router singleton directly:
`import router from '@/router'`.

**Files:**
- Modify: `src/views/Home.vue`

**Interfaces:**
- Consumes: `getIsInit()`, `getConfiguration()`, `getMameService()`, `getGameService()`,
  `getHiscoreService()` from `@/services`; `emitter` from `@/emitter`; `useControllable()` from
  `@/composables/useControllable`; `Categories`, `Games`, `Hiscores`, `UserRegistration`, `Loader`,
  `Modal` (all already ported, unchanged prop/emit contracts).

- [ ] **Step 1: Rewrite the script block**

The template is unchanged (still references `Categories`, `Games`, `Hiscores`, `user-registration`,
`loader`, `modal` exactly as before - all now script-setup components with the same prop names).

```vue
<script setup lang="ts">
import {ref, computed, onMounted} from 'vue';
import router from '@/router';
import Categories from '@/components/Categories.vue';
import Games from '@/components/Games.vue';
import Gamepads from '@/class/Gamepads.class';
import GameService from '@/class/GameService.class';
import Hiscores from '@/components/Hiscores.vue';
import {useControllable} from '@/composables/useControllable';
import * as remote from '@electron/remote';
import Game from '@/model/Game.model';
import Category from '@/model/Category.model';
import {join} from 'path';
import {format} from 'url';
import {emitter} from '@/emitter';
import {getIsInit, getConfiguration, getMameService, getGameService, getHiscoreService} from '@/services';
import * as Log from 'electron-log';
import UserRegistration from '@/components/userRegistration.vue';
import Loader from '@/components/Loader.vue';
import Modal from '@/components/Modal.vue';

let gameService: GameService;

const games = ref<Game[]>([]);
const selectedGameIndex = ref(0);

const categories = ref<Category[]>([]);
const selectedCategoryIndex = ref(0);
const hasPlayerInfo = ref(false);

const timeouts: {
    quit?: number,
    showGame?: number,
    showFlyer?: number,
    addPlayer?: number,
} = {};

const showHiscores = ref(false);
const flyersPath = ref('');
const flyers = ref<string[]>([]);
const flyer = ref('');

const showGames = ref(true);
const showTitle = ref(true);
const showFlyer = ref(true);
const showLoader = ref(false);
const showAddUser = ref(false);

const loaderDuration = ref(2);
const loaderTitle = ref('Button pressing');

const selectedGame = computed(() => games.value[selectedGameIndex.value] || null);

const category = computed(() => {
    if (selectedCategoryIndex.value) {
        return categories.value[selectedCategoryIndex.value - 1];
    }
    return {name: 'All Games'};
});

const hasCategories = computed(() => categories.value.length > 0);

function generateFlyerPath(): string {
    if (selectedGame.value) {
        const i = flyers.value.indexOf(selectedGame.value.romName + '.png');
        const path = i < 0 ? null : join(flyersPath.value, flyers.value[i]);
        if (!path) {
            return '';
        }
        return format({pathname: path, protocol: 'file', slashes: true});
    }
    return '';
}

function onGameChange(previous: boolean) {
    const showFlyerFn = () => {
        flyer.value = generateFlyerPath();
        showFlyer.value = true;
    };
    showFlyer.value = false;
    clearTimeout(timeouts.showFlyer);
    timeouts.showFlyer = window.setTimeout(showFlyerFn, 300);
    selectedGameIndex.value = previous ?
        ((selectedGameIndex.value <= 0) ? games.value.length - 1 : selectedGameIndex.value - 1) :
        ((selectedGameIndex.value >= games.value.length - 1) ? 0 : selectedGameIndex.value + 1);
}

function onCategoryChange(previous: boolean) {
    const showGameFn = async () => {
        games.value = (!selectedCategoryIndex.value) ? await gameService.loadGames() :
            await categories.value[selectedCategoryIndex.value - 1].$get('games') as Game[] || [];

        selectedGameIndex.value = 0;
        flyer.value = generateFlyerPath();

        showGames.value = true;
        showTitle.value = true;
        showFlyer.value = true;
    };
    showHiscores.value = false;
    showTitle.value = false;
    showFlyer.value = false;
    showGames.value = false;
    clearTimeout(timeouts.showGame);
    timeouts.showGame = window.setTimeout(showGameFn, 300);
    selectedCategoryIndex.value = previous ?
        ((selectedCategoryIndex.value <= 0) ? categories.value.length : selectedCategoryIndex.value - 1) :
        ((selectedCategoryIndex.value >= categories.value.length) ? 0 : selectedCategoryIndex.value + 1);
}

function startGame() {
    const mameService = getMameService();
    const hiService = getHiscoreService();
    const game = selectedGame.value;
    if (!game) {
        return;
    }
    mameService.startGame(game.romName).then(
        (gameProcess) => {
            gameProcess.on('close', () => {
                hiService.saveHiscores(game).then(() => {
                    emitter.emit('game-quit');
                });
            });
        },
        (err) => {
            Log.error('[Home] Error on game ' + game.id_game + ' launch.');
            Log.error(err);
        },
    );
}

function addPlayer() {
    loaderDuration.value = 2;
    showLoader.value = true;
    loaderTitle.value = 'Add new player ?';
    timeouts.addPlayer = window.setTimeout(() => {
        showLoader.value = false;
        showAddUser.value = true;
    }, 2000);
}

const {onKeydown, onKeyup} = useControllable();

function registerKeyMapping() {
    onKeydown((e, isGamepad) => {
        if (showAddUser.value) {
            return;
        }
        const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
        switch (key) {
        case 'ArrowUp':
            onGameChange(true);
            break;
        case 'ArrowDown':
            onGameChange(false);
            break;
        case 'ArrowLeft':
            if (hasCategories.value) {
                onCategoryChange(true);
            }
            break;
        case 'ArrowRight':
            if (hasCategories.value) {
                onCategoryChange(false);
            }
            break;
        case 'Space':
            showHiscores.value = !showHiscores.value;
            timeouts.quit = window.setTimeout(() => remote.app.quit(), 3000);
            break;
        case 'Enter':
            startGame();
            break;
        case 'KeyP':
            addPlayer();
            break;
        }
    });

    onKeyup((e, isGamepad) => {
        if (showAddUser.value) {
            return;
        }
        const key = isGamepad ? (e as CustomEvent).detail.key : (e as KeyboardEvent).code;
        switch (key) {
        case 'Space':
            clearTimeout(timeouts.quit);
            break;
        case 'KeyP':
            showLoader.value = false;
            clearTimeout(timeouts.addPlayer);
            break;
        }
    });
}

if (!getIsInit()) {
    router.push({name: 'init'});
} else {
    if (getConfiguration().fullscreen) {
        remote.getCurrentWindow().setFullScreen(true);
    } else if (process.env.NODE_ENV === 'development') {
        remote.getCurrentWindow().setSize(1280, 720);
        remote.getCurrentWindow().center();
    }

    const mameService = getMameService();
    gameService = getGameService();

    onMounted(async () => {
        categories.value = await gameService.loadCategories();
        games.value = await gameService.loadGames();
        hasPlayerInfo.value = !!mameService.nplayersIniPath;

        Gamepads.init();
        registerKeyMapping();

        flyersPath.value = mameService.flyerPath;
        flyers.value = gameService.loadFlyers();
        flyer.value = generateFlyerPath();
    });
}

onMounted(() => {
    if (getConfiguration().fullscreen) {
        remote.getCurrentWindow().setFullScreen(true);
    }
});
</script>
```

The template and `<style scoped>` block are unchanged.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - expected: same 6 pre-existing errors, nothing new.
Run: `npm run lint` - expected: 0 errors.
Run: `npm test` - expected: 51 passed.

- [ ] **Step 3: Commit**

```bash
git add src/views/Home.vue
git commit -m "refactor(vue3): port the Home view to script setup"
```

---

### Task 12: the flip - `App.vue`, `main.ts`, `router.ts`, `src/index.html`, `electron.vite.config.ts`, `background.ts`, dependency and script updates

This is the point where the app becomes runnable again for the first time since step 2. All the
pieces below are mutually dependent and can only be verified together, so they are one task.

**Files:**
- Modify: `src/App.vue`
- Modify: `src/main.ts`
- Modify: `src/router.ts`
- Create: `src/index.html`
- Modify: `electron.vite.config.ts`
- Modify: `src/background.ts`
- Modify: `package.json`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: everything produced by Tasks 1-11.

- [ ] **Step 1: Add `vue-router` 5, bump the dependency**

```bash
npm install vue-router@^5.3.1
```

- [ ] **Step 2: Rewrite `src/App.vue`**

```vue
<template>
    <div id="app">
        <router-view :focused="focused"></router-view>
    </div>
</template>

<script setup lang="ts">
import {ref, onMounted} from 'vue';
import * as remote from '@electron/remote';
import Gamepads from '@/class/Gamepads.class';

const focused = ref(true);

onMounted(() => {
    // Electron event
    remote.getCurrentWindow().on('blur', () => {
        Gamepads.stopGamepadsListeners();
        focused.value = false;
    });
    remote.getCurrentWindow().on('focus', () => {
        focused.value = true;
        Gamepads.init();
    });
});
</script>

<style src="./assets/font-awesome/css/all.min.css"></style>
<style>
    /* unchanged - copy verbatim from the current file */
</style>
```

The `<style>` blocks (font-awesome import, base CSS reset, font-face declarations) are copied
verbatim from the current `src/App.vue` - only the `<script>` block changes.

- [ ] **Step 3: Rewrite `src/router.ts`**

```ts
import {createRouter, createWebHashHistory} from 'vue-router';
import Home from './views/Home.vue';
import Init from './views/Init.vue';
import Config from '@/views/Config.vue';
import {getIsInit} from '@/services';

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            redirect: {name: 'init'},
        },
        {
            path: '/init',
            name: 'init',
            component: Init,
        },
        {
            path: '/home',
            name: 'home',
            component: Home,
        },
        {
            path: '/config',
            name: 'config',
            component: Config,
        },
    ],
});

// Home relies on the services module having been set up by Init's onMounted (services.ts's
// initServices()) - landing directly on /home with that not yet done (e.g. a dev-server full
// reload that keeps the current #/home hash instead of a hot patch) crashes Games.vue and
// friends. Send anything but /init and /config back through /init first.
router.beforeEach((to) => {
    if (to.name !== 'init' && to.name !== 'config' && !getIsInit()) {
        return {name: 'init'};
    }
});

export default router;
```

- [ ] **Step 4: Rewrite `src/main.ts`**

```ts
import {createApp} from 'vue';
import App from './App.vue';
import router from './router';

createApp(App).use(router).mount('#app');
```

- [ ] **Step 5: Create `src/index.html`**

Vite's renderer root needs its own `index.html` with a module script tag, replacing
`public/index.html`'s webpack-templated version:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <link rel="icon" href="/favicon.ico">
    <title>arcade2</title>
  </head>
  <body>
    <noscript>
      <strong>We're sorry but arcade2 doesn't work properly without JavaScript enabled. Please enable it to continue.</strong>
    </noscript>
    <div id="app"></div>
    <script type="module" src="/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Retarget `electron.vite.config.ts` at the real app**

Replace the `main.build.rollupOptions.input` and the whole `renderer` block (keep the existing
`swcOptions`/`alias` consts and their explanatory comments about decorator metadata and
`useDefineForClassFields` verbatim - they remain fully relevant, models still use decorators):

```ts
export default defineConfig({
    main: {
        plugins: [swcPlugin(swcOptions)],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/background.ts')},
            },
        },
    },
    renderer: {
        root: resolve(__dirname, 'src'),
        publicDir: resolve(__dirname, 'public'),
        plugins: [vue(), swcPlugin(swcOptions)],
        resolve: {alias},
        build: {
            rollupOptions: {
                input: {index: resolve(__dirname, 'src/index.html')},
            },
        },
    },
});
```

`publicDir` is set explicitly because `root` is no longer Vite's default: without it Vite would
look for a `public/` folder under `src/`, which doesn't exist, and `favicon.ico` would 404.

- [ ] **Step 7: Adapt `src/background.ts` for electron-vite**

`vue-cli-plugin-electron-builder/lib`'s `createProtocol`/`installVueDevtools` are webpack-specific
and don't work under electron-vite's build; `WEBPACK_DEV_SERVER_URL` becomes electron-vite's
`ELECTRON_RENDERER_URL` (already used by `src/probe/main.ts` since step 2). Production loading
switches from a custom `app://` protocol to `loadFile`, matching what the probe already does.

```ts
'use strict';

import {app, BrowserWindow} from 'electron';
import * as remoteMain from '@electron/remote/main';
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import {join} from 'path';
import {Server} from 'http';
import {startBoServer} from '@/boServer';
import {BO_SERVER_PORT} from '@/boServerPort';
import Config from '@/class/Config.class';

remoteMain.initialize();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;
let boServer: Server | undefined;

function loadPath(winVar: BrowserWindow, path: string) {
    if (process.env.ELECTRON_RENDERER_URL) {
        // Load the url of the dev server if in development mode
        winVar.loadURL(process.env.ELECTRON_RENDERER_URL + '#/' + path);
        if (!process.env.IS_TEST) {
            const config = new Config();
            config.load();
            if (config.openDevTools) {
                winVar.webContents.openDevTools();
            }
        }
    } else {
        winVar.loadFile(join(__dirname, '../renderer/index.html'), {hash: '/' + path});
    }
}

function createWindow(options: BrowserWindowConstructorOptions, path: string): BrowserWindow {
    // Create the browser window.
    let winVar: BrowserWindow | null = new BrowserWindow(options);
    remoteMain.enable(winVar.webContents);

    loadPath(winVar, path);

    winVar.on('closed', () => {
        winVar = null;
    });
    return winVar;
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    // if (win === null) {
    //     win = createMainWin();
    // }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
    win = createSplashWin();

    boServer = startBoServer(BO_SERVER_PORT, () => {
        if (win) {
            loadPath(win, 'init');
        }
    }, () => {
        // Unlike onConfigured() above (a route reload is enough after a normal config save), a
        // reset needs a real process restart: services.ts only ever builds its
        // MameService/GameService/... once (see services.ts's initServices()), so those would
        // keep serving stale data - parsed from the mame home files /reset just deleted - even
        // after reloading to /init and going through first-run setup again.
        //
        // app.relaunch() is NOT used here: under `electron-vite dev` the app is a child process
        // orchestrated by electron-vite's dev server, and relaunch()'s re-spawn doesn't reconnect
        // to that setup - the process just exits and nothing comes back. So the /reset response
        // tells the user to close and restart manually (`just serve` in dev; relaunching the
        // packaged app otherwise), and this just performs the actual exit.
        app.exit(0);
    });
});

app.on('will-quit', () => {
    boServer?.close();
});

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
    if (process.platform === 'win32') {
        process.on('message', data => {
            if (data === 'graceful-exit') {
                app.quit();
            }
        });
    } else {
        process.on('SIGTERM', () => {
            app.quit();
        });
    }
}

function createSplashWin() {
    return createWindow({
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
        },
        backgroundColor: '#000000',
        frame: false,
    }, 'init');
}
```

Note what was deliberately dropped, and why: `installVueDevtools()` (vue-cli-plugin-electron-builder-
specific, no electron-vite equivalent shipped in the version matrix - dropping the feature rather
than adding an unlisted dependency); the custom `app://` protocol registration
(`protocol.registerSchemesAsPrivileged`/`createProtocol`) - electron-vite's packaged output is
loaded with `loadFile` directly, the same way `src/probe/main.ts` already does, so the custom
protocol has no remaining purpose; the commented-out `api(...)` call and its now-unused `ipcMain`
import (the `src/api/*` files stay in the tree, per spec 2.5/step 3, but nothing wires them up -
unchanged from the file's current, already-disabled state).

- [ ] **Step 8: Update `package.json`**

Add `mitt` and bump `vue-router` (already done by Steps 1 and the earlier `mitt` install in Task
2). Repoint the two real entry-point scripts at electron-vite - this is what makes `just serve`/
`just build` work again:

```json
"electron:build": "electron-vite build && electron-builder --config electron-builder.yml",
"electron:serve": "electron-vite dev",
```

Leave `probe:dev`/`probe:build`/`probe:package` and the top-level `serve`/`build`
(`vue-cli-service`) scripts untouched for now - both get deleted in Task 13.

- [ ] **Step 9: Switch `eslint.config.js` to the Vue 3 preset**

```diff
- ...pluginVue.configs['flat/vue2-essential'],
+ ...pluginVue.configs['flat/essential'],
```

- [ ] **Step 10: Verify - typecheck, lint, unit tests**

Run: `npx tsc --noEmit`
Expected: exactly 3 errors remaining (`src/ControllableVue.ts`, `src/EventBus.ts`,
`src/store.ts` - the 3 files not yet deleted; `main.ts`'s 2 errors and `router.ts`'s 1 error are
gone, since those files were just rewritten).

Run: `npm run lint`
Expected: 0 errors.

Run: `npm test`
Expected: 51 passed.

- [ ] **Step 11: Manual smoke test (spec step 4's exit criteria)**

Run: `just serve` (never alongside another `just serve`/`just build`/`npm install`).

Walk the full path: first-run config screen (if no config file exists yet) or straight to the ROM
browser; a non-empty ROM list; categories (if a starting pack was imported); launching a game;
hiscores display; gamepad navigation (if a controller is connected) or keyboard navigation
otherwise. Confirm no doubled input when switching between Home's tabs or opening/closing
Hiscores/user registration repeatedly (this is the specific symptom the ControllableVue leak fix
targets - see DECISIONS.md D2 detail).

If a controller is available, specifically repeat "open user registration, cancel, open again,
register a player" several times in a row and confirm each key press produces exactly one action -
this is the regression the original leak caused.

- [ ] **Step 12: Commit**

```bash
git add src/App.vue src/main.ts src/router.ts src/index.html electron.vite.config.ts \
    src/background.ts package.json package-lock.json eslint.config.js
git commit -m "feat(vue3): wire the real app through electron-vite, drop vue-cli as the runtime path"
```

---

## Step 5: remove the legacy

### Task 13: delete vue-cli, Vuex, the decorator libraries, and the plumbing probe

Everything ported in Tasks 1-12 has an old counterpart still sitting in the tree, plus the
throwaway probe from spec step 2. This task removes all of it and re-verifies a clean baseline.

**Files:**
- Delete: `src/probe/` (5 files: `main.ts`, `probeDatabase.ts`, `Probe.vue`, `index.html`,
  `renderer.ts`)
- Delete: `src/store.ts`, `src/EventBus.ts`, `src/ControllableVue.ts`, `src/shims-tsx.d.ts`,
  `vue.config.js`, `public/index.html`
- Modify: `electron.vite.config.ts`
- Modify: `package.json`, `tsconfig.json`
- Modify: `vitest.config.ts` (conditionally, see Step 5 below)
- Modify: `docs/DECISIONS.md`, `docs/PROGRESSION.md`

**Note on `src/shims-vue.d.ts`:** the design doc's section 4 lists it as removed by this
migration. It is NOT deleted here. Spec step 2's plumbing probe already found that tsc needs this
file to resolve any `import Foo from './Foo.vue'` at all (there is no other type declaration for
the `.vue` extension), and rewrote its content to the Vue 3 `DefineComponent<{}, {}, any>` shape
instead of leaving the Vue 2 one. Deleting it now would break every `.vue` import in `tsc --noEmit`.
This is a correction to the design doc, recorded in `docs/DECISIONS.md` by this task's last step,
not a deviation to flag for approval - the original text was written before that finding existed.

- [ ] **Step 1: Delete the plumbing probe**

```bash
git rm -r src/probe
```

- [ ] **Step 2: Delete the superseded Vue 2 files**

```bash
git rm src/store.ts src/EventBus.ts src/ControllableVue.ts src/shims-tsx.d.ts vue.config.js public/index.html
```

- [ ] **Step 3: Remove the dev-inline decorator hazard comment from `electron.vite.config.ts`**

Remove the comment paragraph that begins "A related hazard the plumbing probe... found while
proving the above" (added in the original safety-net-and-plumbing plan's Task 8, documenting a
hazard the now-deleted `src/probe/` discovered). Keep the `swcOptions`/decorator-metadata/
`useDefineForClassFields` comments above it verbatim - those remain fully relevant; only the
probe-specific paragraph goes, since D2 already rules out any decorator declared inline in a
`<script setup>` block (confirmed true of every ported component in this plan: none declare a
decorated class).

- [ ] **Step 4: Remove the dead dependencies from `package.json`**

Remove from `dependencies`: `vue-class-component`, `vue-property-decorator`, `vuex`.
Remove from `devDependencies`: `@vue/cli-plugin-typescript`, `@vue/cli-service`,
`vue-cli-plugin-electron-builder`, `vue-template-compiler`.
Remove the `overrides.vuex` entry (no longer needed once `vuex` is gone).
Remove the scripts: `"serve": "vue-cli-service serve"`, `"build": "vue-cli-service build"`,
`"probe:dev"`, `"probe:build"`, `"probe:package"` (the probe they ran no longer exists).

Run: `npm install` to regenerate `package-lock.json`. Never hand-edit the lockfile (project
convention, see DECISIONS.md's rebase section) - if this produces conflicts or unexpected diffs,
resolve by re-running `npm install`, not by editing the file directly.

- [ ] **Step 5: Remove the now-unresolvable `types` entry from `tsconfig.json`**

```diff
-        "types": [
-            "webpack-env"
-        ],
```

`@types/webpack-env` was only ever available transitively through `@vue/cli-plugin-typescript`,
just removed. Nothing in the ported codebase uses `require.context`/`module.hot` or any other
webpack-env ambient type.

- [ ] **Step 6: Check whether the `@electron/remote` Vitest stub is still needed**

`tests/stubs/electron-remote.ts`'s comment says `Helpers.class.ts` imports `@electron/remote` at
module scope - that stopped being true before this plan started (verified: `grep -rn
"@electron/remote" src/class` finds nothing). Find out whether anything the test suite actually
imports still needs the stand-in:

Run: `git diff` is empty at this point for `vitest.config.ts` - now temporarily remove the
`'@electron/remote'` alias entry from `vitest.config.ts` and run `npm test`.

If all 51 tests still pass: the alias was dead. Delete `tests/stubs/electron-remote.ts` too, and
keep `vitest.config.ts` without that alias.

If any test now fails to resolve `@electron/remote`: revert the `vitest.config.ts` removal, and
instead fix the stub's comment to describe whichever file in the current import graph actually
needs it (find it with `grep -rn "@electron/remote" src/` and trace which test imports that file).

- [ ] **Step 7: Final verification**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm test`
Expected: 51 passed.

Run: `just build` (never alongside another `just serve`/`just build`/`npm install`), then launch
the packaged app from `dist_electron/linux-unpacked/` with `--no-sandbox` (the `chrome-sandbox`
packaging gap is a known, separately-tracked issue - see DECISIONS.md - not something this task
fixes). Confirm the window opens, the BO server answers on `http://localhost:3131`, and the app
reaches either the config screen or the ROM browser depending on whether a config file exists.

- [ ] **Step 8: Update `docs/DECISIONS.md` and `docs/PROGRESSION.md`**

In `docs/DECISIONS.md`, add an entry to "Findings during execution" recording the `shims-vue.d.ts`
correction (kept, not deleted, contradicting the original design list - see this task's note
above) and, if Step 6 found the `@electron/remote` stub still needed, what actually needs it now.

In `docs/PROGRESSION.md`: mark spec steps 3, 4 and 5 as **Done**; remove the "the app does not run
via `just serve` right now" paragraph (it does, again, as of Task 12); remove the `tsc`/`npm test`
baseline bullets that no longer apply (both are now clean/0-error); keep the two still-open gaps
(macOS 15.1+ never verified; `chrome-sandbox` missing from the Linux package) exactly as they are -
neither is closed by this plan.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(vue3): remove vue-cli, Vuex, the decorator libraries and the plumbing probe"
```

- [ ] **Step 10: Hand off**

This plan's SDD workspace (`.superpowers/sdd/2026-09-14-vue3-migration-port-and-cleanup/`) can be
deleted once the final whole-branch review (part of subagent-driven-development) is clean. Do not
merge or push without explicit confirmation - per this project's CLAUDE.md, every change goes on
its own branch cut from `refacto-2026` and every PR targets `refacto-2026`, never `develop`.
