import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { Quasar } from 'quasar';
import '@quasar/extras/mdi-v7/mdi-v7.css';
import 'quasar/src/css/index.sass';
import App from './App.vue';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(Quasar, {
    plugins: {}, // import Quasar plugins and add here
});
app.mount('#app');
