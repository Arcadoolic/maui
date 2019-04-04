import Vue from 'vue';
import Router, {Route} from 'vue-router';
import Home from './views/Home.vue';
import Init from './views/Init.vue';
import store from '@/store';

Vue.use(Router);

export default new Router({
    mode: 'history',
    routes: [
        {
            path: '/init',
            name: 'init',
            component: Init,
            // beforeEnter(to: Route, from: Route, next) {
            //     if (!store.getters.isInit) {
            //         return next();
            //     }
            //     return next({name: 'home'});
            // },
        },
        {
            path: '/home',
            name: 'home',
            component: Home,
            // beforeEnter(to: Route, from: Route, next) {
            //     if (store.getters.isInit) {
            //         return next();
            //     }
            //     return next({name: 'init'});
            // },
        },
    ],
});
