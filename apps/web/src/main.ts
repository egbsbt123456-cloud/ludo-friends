import {createApp} from 'vue';
import {createRouter,createWebHistory} from 'vue-router';
import App from './App.vue';
import Ludo from './pages/LudoPlay.vue';
import './style.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/',component:Ludo},{path:'/games/ludo',component:Ludo},{path:'/:pathMatch(.*)*',redirect:'/'}]});
createApp(App).use(router).mount('#app');
