import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import preset from '@/pt/preset';
import 'primeicons/primeicons.css';
import '@/styles/main.css';
import App from '@/App.vue';

const app = createApp(App);
app.use(PrimeVue, { unstyled: true, pt: preset });
app.mount('#app');
