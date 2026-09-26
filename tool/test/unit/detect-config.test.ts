import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeConfig, dtsComponents, entryComponents, entryImports, primeVueUse, viteAliases } from '../../src/detect-config';
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

describe('global and auto-imported components', () => {
  test('app.component registrations; commented ones do not count', () => {
    const src = "app.component('pv-button', Button);\n// app.component('old', Old);\napp.component(\"s-radio\", SRadio);\napp.component(Dyn.name, Dyn);";
    expect(entryComponents(src)).toEqual([
      { name: 'pv-button', ident: 'Button' },
      { name: 's-radio', ident: 'SRadio' },
    ]);
  });

  test('components.d.ts entries (default and named exports)', () => {
    const src = `declare module 'vue' {
  export interface GlobalComponents {
    AppHeader: typeof import('./src/components/AppHeader.vue')['default']
    'LazyThing': typeof import("../components/Thing.vue")['default']
    PButton: typeof import('primevue')['Button']
    RouterLink: typeof import('vue-router')['RouterLink']
  }
}`;
    expect(dtsComponents(src)).toEqual([
      { name: 'AppHeader', spec: './src/components/AppHeader.vue', exportName: 'default' },
      { name: 'LazyThing', spec: '../components/Thing.vue', exportName: 'default' },
      { name: 'PButton', spec: 'primevue', exportName: 'Button' },
      { name: 'RouterLink', spec: 'vue-router', exportName: 'RouterLink' },
    ]);
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

  test('stylesheets linked from index.html come before the entry imports; `/…` is public/', () => {
    const root = project({
      'index.html': `<head>
        <link href="/static/css/common.css" rel="stylesheet" type="text/css" />
        <link rel='preload stylesheet' href='theme.css?v=2'>
        <!-- <link rel="stylesheet" href="/old.css"> -->
        <link rel="icon" href="/favicon.ico">
        <link rel="alternate stylesheet" href="/dark.css" title="dark">
        <link rel="stylesheet" href="https://cdn.example.com/x.css">
      </head>`,
      'public/static/css/common.css': 'body{}',
      'theme.css': 'a{}',
      'src/main.js': "import './style.css';",
      'src/style.css': 'b{}',
    });
    const r = completeConfig(root, {});
    expect(r.config.globalCss).toEqual(['public/static/css/common.css', 'theme.css', 'src/style.css']);
    expect(r.deps).toEqual([path.join(root, 'index.html'), path.join(root, 'src/main.js')]);
    expect(r.warnings).toEqual(['index.html: external stylesheet not inlined: https://cdn.example.com/x.css']);
    // without an entry too
    fs.rmSync(path.join(root, 'src/main.js'));
    expect(completeConfig(root, {}).config.globalCss).toEqual(['public/static/css/common.css', 'theme.css']);
  });

  test('explicit keys win and are not read from the entry; null means off', () => {
    const root = project({
      'package.json': '{"dependencies":{"primevue":"^4"}}',
      'src/main.js': SITTER_LIKE,
      'src/assets/tailwind.css': '@import "tailwindcss";',
    });
    const r = completeConfig(root, { globalCss: [], tailwind: null, primevue: null, components: {} });
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

  test('components from app.component in the entry and from components.d.ts', () => {
    const root = project({
      'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      'src/main.ts': "import Tag from 'primevue/tag';\nimport SButton from '@/components/Button.vue';\nimport Box from './components/Box';\napp.component('pv-tag', Tag);\napp.component('s-button', SButton);\napp.component('s-box', Box);",
      'src/components/Button.vue': '<template><button /></template>',
      'src/components/Box/index.vue': '<template><div /></template>',
      'components.d.ts': "AutoCard: typeof import('./src/components/AutoCard.vue')['default']\nPButton: typeof import('primevue')['Button']",
      'src/components/AutoCard.vue': '<template><div /></template>',
    });
    const r = completeConfig(root, {});
    // project files are kept as written (extensions are filled in when a tag is resolved)
    expect(r.config.components).toEqual({
      AutoCard: './src/components/AutoCard.vue',
      PButton: 'primevue#Button',
      'pv-tag': 'primevue/tag',
      's-button': './src/components/Button.vue',
      's-box': './src/components/Box',
    });
    expect(r.detected).toContain('components');
    expect(r.deps).toContain(path.join(root, 'components.d.ts'));
    // an explicit value wins
    expect(completeConfig(root, { components: {} }).config.components).toEqual({});
  });

  test('nothing is checked on disk; an empty components.d.ts is still a dependency', () => {
    const root = project({ 'components.d.ts': "Foo: typeof import('./src/Missing.vue')['default']" });
    const r = completeConfig(root, {});
    expect(r.config.components).toEqual({ Foo: './src/Missing.vue' });
    expect(r.deps).toEqual([path.join(root, 'components.d.ts')]);
    const empty = project({ 'components.d.ts': 'export interface GlobalComponents {}' });
    expect(completeConfig(empty, {}).deps).toEqual([path.join(empty, 'components.d.ts')]);
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
