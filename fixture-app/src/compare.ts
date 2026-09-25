// Comparison entry for V6: mounts one component with the same data as its
// *.preview.json fixture, using the real Vite + PrimeVue pipeline.
// Usage: http://localhost:5173/compare.html?c=UserTable
import { createApp, h } from 'vue';
import PrimeVue from 'primevue/config';
import preset from '@/pt/preset';
import 'primeicons/primeicons.css';
import '@/styles/main.css';

const components = import.meta.glob('./components/*.vue');
const fixtures = import.meta.glob('./components/*.preview.json', { eager: true, import: 'default' });

const name = new URLSearchParams(location.search).get('c') ?? 'UserPage';
const fixture = (fixtures[`./components/${name}.preview.json`] ?? {}) as Record<string, any>;

// UserPage loads its rows via fetch(); answer with the fixture rows.
window.fetch = async () => new Response(JSON.stringify(fixture.users ?? []));

const mod: any = await components[`./components/${name}.vue`]();
const declared = Object.keys(mod.default.props ?? {});
const props = Object.fromEntries(Object.entries(fixture).filter(([k]) => declared.includes(k)));
const app = createApp({ render: () => h(mod.default, props) });
app.use(PrimeVue, { unstyled: true, pt: preset });
app.mount('#app');
