import Vue from 'vue';
import Router from 'vue-router';
import Home from './views/Home.vue';
import Init from './views/Init.vue';

Vue.use(Router);

export default new Router({
    routes: [
        {
            path: '/',
            name: 'init',
            component: Init,
        },
        {
            path: '/home',
            name: 'home',
            component: Home,
        },
    ],
});
