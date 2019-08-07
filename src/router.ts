import Vue from 'vue';
import Router, {Route} from 'vue-router';
import Home from './views/Home.vue';
import Init from './views/Init.vue';
import store from '@/store';
import Config from '@/views/Config.vue';

Vue.use(Router);

export default new Router({
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
