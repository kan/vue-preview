import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeConfig, entryImports, primeVueUse, viteAliases } from '../../src/detect-config';
import { balancedBlock, splitTopLevel } from '../../src/text-scan';

const SITTER_LIKE = `import { createApp } from 'vue';
import App from './App.vue';
import PrimeVue from 'primevue/config';
import ToastService from "primevue/toastservice";
import './assets/tailwind.css';
import './style.css';
import 'primeicons/primeicons.css';
import Aura from './presets/aura';

const app = createApp(App);
app.use(PrimeVue, {
    unstyled: true,
    pt: Aura,
    locale: { ...ja, noFileChosenMessage: '' },
    ripple: true,
});
app.use(ToastService);
`;

describe('reading the app entry', () => {
  test('default and side-effect imports', () => {
    const imp = (name: string | null, spec: string, sideEffect = false) => ({ name, spec, sideEffect });
    expect(entryImports(SITTER_LIKE)).toEqual([
      imp(null, 'vue'),
      imp('App', './App.vue'),
      imp('PrimeVue', 'primevue/config'),
      imp('ToastService', 'primevue/toastservice'),
      imp(null, './assets/tailwind.css', true),
      imp(null, './style.css', true),
      imp(null, 'primeicons/primeicons.css', true),
      imp('Aura', './presets/aura'),
    ]);
  });

  test('default plus named bindings; commented-out imports do not count', () => {
    const src = "import PrimeVue, { usePassThrough } from 'primevue/config';\n// import './old.css';\n/*\nimport './older.css';\n*/\nimport * as all from 'x';";
    expect(entryImports(src)).toEqual([
      { name: 'PrimeVue', spec: 'primevue/config', sideEffect: false },
      { name: null, spec: 'x', sideEffect: false },
    ]);
  });

  test('PrimeVue options: unstyled and the pt identifier', () => {
    expect(primeVueUse(SITTER_LIKE, 'PrimeVue')).toEqual({ unstyled: true, ptName: 'Aura' });
    expect(primeVueUse('app.use(PrimeVue, { unstyled: true, pt })', 'PrimeVue')).toEqual({ unstyled: true, ptName: 'pt' });
    expect(primeVueUse('app.use(PrimeVue)', 'PrimeVue')).toEqual({});
    expect(primeVueUse('app.use(PrimeVue, { theme: { preset: Aura } })', 'PrimeVue')).toEqual({ unstyled: undefined, ptName: undefined });
    expect(primeVueUse('app.use(Other)', 'PrimeVue')).toBeNull();
    // another identifier with the same prefix is not PrimeVue
    expect(primeVueUse('app.use(PrimeVueToast);\napp.use(PrimeVue, { unstyled: true })', 'PrimeVue')).toEqual({ unstyled: true, ptName: undefined });
  });

  test('balanced brackets, quotes respected', () => {
    expect(balancedBlock('x({ a: { b: 1 } }, 2)', 2)).toBe('{ a: { b: 1 } }');
    expect(balancedBlock("{ a: '}', b: [1] } tail", 0)).toBe("{ a: '}', b: [1] }");
    expect(splitTopLevel("a: f(1, 2), b: '1,2', c: [3, 4]")).toEqual(['a: f(1, 2)', "b: '1,2'", 'c: [3, 4]']);
  });
});

describe('vite.config aliases', () => {
  test('object form: path.resolve / fileURLToPath; package aliases are not ours', () => {
    const src = `import path from 'path';
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // alias: { '#old': './old' },
    alias: {
      '@': path.resolve(__dirname, './src'),
      '~assets': fileURLToPath(new URL('./src/assets/', import.meta.url)),
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
});`;
    expect(viteAliases(src)).toEqual({ '@': 'src', '~assets': 'src/assets' });
  });

  test('values without a readable literal are skipped, not taken from the next entry', () => {
    const src = "alias: { '@': srcDir, '~lib': path.resolve(__dirname, 'lib'), '#t': `${__dirname}/t`, '/x': '/abs' }";
    expect(viteAliases(src)).toEqual({ '~lib': 'lib', '/x': 'abs' });
  });

  test('array form; RegExp finds and variable replacements are skipped', () => {
    const src = `resolve: { alias: [ { find: '@', replacement: path.resolve(__dirname, 'src') }, { find: /^~/, replacement: '' }, { find: '#', replacement: dir }, { find: '~', replacement: './lib' } ] }`;
    expect(viteAliases(src)).toEqual({ '@': 'src', '~': 'lib' });
  });

  test('no alias', () => expect(viteAliases('export default { plugins: [] }')).toEqual({}));

  test('globs in strings are not comments', () => {
    // `'src/**/*'` contains `/*`: stripping it as a comment would swallow the alias block
    const src = `export default {
  optimizeDeps: { entries: ['index.html', 'src/**/*'] },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } }, // the alias
  test: { include: ['src/**/*.spec.js'] },
};`;
    expect(viteAliases(src)).toEqual({ '@': 'src' });
  });
});

describe('completeConfig', () => {
  const project = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-detect-'));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), content);
    }
    return root;
  };

  test('infers globalCss, the Tailwind entry and PrimeVue from src/main.js', () => {
    const root = project({
      'package.json': '{"dependencies":{"primevue":"^4"}}',
      'src/main.js': SITTER_LIKE,
      'src/assets/tailwind.css': '@import "tailwindcss";\n@plugin "tailwindcss-primeui";',
      'src/style.css': 'body{}',
      'src/presets/aura/index.js': 'export default {}',
    });
    const r = completeConfig(root, {});
    expect(r.config.globalCss).toEqual(['src/assets/tailwind.css', 'src/style.css', 'primeicons/primeicons.css']);
    expect(r.config.tailwind).toEqual({ entry: 'src/assets/tailwind.css' });
    expect(r.config.primevue).toEqual({ unstyled: true, pt: 'src/presets/aura/index.js' });
    expect(r.detected).toEqual(['globalCss', 'tailwind', 'primevue']);
    expect(r.deps).toEqual([path.join(root, 'src/main.js')]);
  });

  test('explicit keys win and are not read from the entry; null means off', () => {
    const root = project({
      'package.json': '{"dependencies":{"primevue":"^4"}}',
      'src/main.js': SITTER_LIKE,
      'src/assets/tailwind.css': '@import "tailwindcss";',
    });
    const r = completeConfig(root, { globalCss: [], tailwind: null, primevue: null });
    expect(r.config.tailwind).toBeNull();
    expect(r.config.primevue).toBeNull();
    expect(r.detected).toEqual([]);
    expect(r.deps).toEqual([]);
  });

  test('entry imports through a tsconfig alias', () => {
    const root = project({
      'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      'src/main.ts': "import PrimeVue from 'primevue/config';\nimport preset from '@/pt/preset';\nimport '@/styles/main.css';\napp.use(PrimeVue, { unstyled: true, pt: preset });",
      'src/pt/preset.ts': 'export default {}',
      'src/styles/main.css': "@import 'tailwindcss';",
    });
    const r = completeConfig(root, {});
    expect(r.config.tailwind).toEqual({ entry: 'src/styles/main.css' });
    expect(r.config.primevue).toEqual({ unstyled: true, pt: 'src/pt/preset.ts' });
  });

  test("PrimeVue in dependencies but not in the entry: installed with PrimeVue's defaults", () => {
    const root = project({ 'package.json': '{"dependencies":{"primevue":"^4"}}', 'src/main.ts': "import { createApp } from 'vue';" });
    const r = completeConfig(root, {});
    expect(r.config.primevue).toEqual({ unstyled: false });
    expect(r.detected).toEqual(['primevue']);
    // the entry and package.json decided it: editing either must re-render
    expect(r.deps).toEqual([path.join(root, 'src/main.ts'), path.join(root, 'package.json')]);
  });

  test('pt shorthand resolves to the import of that name', () => {
    const root = project({
      'src/main.js': "import PrimeVue from 'primevue/config';\nimport pt from './presets/lara';\napp.use(PrimeVue, { unstyled: true, pt });",
      'src/presets/lara/index.js': 'export default {}',
    });
    expect(completeConfig(root, {}).config.primevue).toEqual({ unstyled: true, pt: 'src/presets/lara/index.js' });
  });

  test('nothing to infer', () => {
    expect(completeConfig(project({ 'package.json': '{}' }), {}).detected).toEqual([]);
  });

  test('aliases: tsconfig paths first, then vite.config; the file read is a dependency', () => {
    const vite = "export default { resolve: { alias: { '@': path.resolve(__dirname, './src') } } }";
    const viaVite = project({ 'vite.config.mjs': vite });
    const r = completeConfig(viaVite, {});
    expect(r.aliases).toEqual({ '@': path.join(viaVite, 'src') });
    expect(r.config.aliases).toEqual({ '@': 'src' });
    expect(r.detected).toEqual(['aliases']);
    expect(r.deps).toEqual([path.join(viaVite, 'vite.config.mjs')]);

    const viaTs = project({ 'vite.config.mjs': vite, 'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["app/*"]}}}' });
    const t = completeConfig(viaTs, {});
    expect(t.aliases).toEqual({ '@': path.join(viaTs, 'app') });
    expect(t.detected).toEqual([]);
    expect(t.deps).toEqual([path.join(viaTs, 'tsconfig.json')]);

    expect(completeConfig(viaVite, { aliases: { '@': 'lib' } }).aliases).toEqual({ '@': path.join(viaVite, 'lib') });
  });
});
