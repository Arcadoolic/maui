import Vue from 'vue';
import Router, {Route} from 'vue-router';
import Home from './views/Home.vue';
import Init from './views/Init.vue';
import store from '@/store';
import Config from '@/views/Config.vue';

Vue.use(Router);

const router = new Router({
    routes: [
        {
            path: '/',
            beforeEnter(to: Route, from: Route, next) {
                return next({name: 'init'});
            },
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

// Home relies on mameService/gameService/... having been set up by Init's mounted() hook
// (store's initServices mutation). Landing directly on /home with those still null - e.g. a
// dev-server full reload that keeps the current #/home hash instead of a hot patch - crashes
// Games.vue and friends. Send anything but /init and /config back through /init first.
router.beforeEach((to, from, next) => {
    if (to.name !== 'init' && to.name !== 'config' && !store.getters.isInit) {
        return next({name: 'init'});
    }
    next();
});

export default router;
