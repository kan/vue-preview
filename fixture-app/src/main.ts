import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Tag from 'primevue/tag';
import preset from '@/pt/preset';
import 'primeicons/primeicons.css';
import '@/styles/main.css';
import App from '@/App.vue';
import StatusBadge from '@/components/StatusBadge.vue';

const app = createApp(App);
app.use(PrimeVue, { unstyled: true, pt: preset });
// global registration with prefixed names (REPORT V10): components use <app-badge> / <pv-tag> without importing
app.component('app-badge', StatusBadge);
app.component('pv-tag', Tag);
app.mount('#app');
