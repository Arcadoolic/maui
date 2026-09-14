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
