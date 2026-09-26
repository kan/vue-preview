// End-to-end assertions on the JSON written by scripts/e2e.sh
// (the binary is run inside the node:22 app container against fixture-app).
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectModules } from '../../src/load-project-modules';

const OUT = process.env.VUE_PREVIEW_OUT ?? '/out';
interface Result {
  html: string;
  deps: string[];
  warnings: string[];
  modules: ProjectModules['source'];
  config: { file: string | null; detected: string[] };
}
const load = (name: string): Result => JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), 'utf8'));

describe('UserTable (DataTable + pt + fixture)', () => {
  const r = load('UserTable');
  test('no warnings', () => expect(r.warnings).toEqual([]));
  test('fixture rows are rendered', () => {
    for (const name of ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 次郎']) expect(r.html).toContain(name);
    expect(r.html).toContain('全 4 件');
  });
  test('pt classes and Tailwind CSS', () => {
    expect(r.html).toContain('class="w-full border-separate border-spacing-0 text-sm"');
    expect(r.html).toMatch(/\.bg-brand-500\s*{/);
  });
  test('scoped style attributes', () => expect(r.html).toMatch(/class="badge badge--invited" data-v-[0-9a-f]{8}/));
  test('deps are root-relative', () => {
    expect(r.deps).toEqual(
      expect.arrayContaining([
        'src/components/UserTable.vue',
        'src/components/StatusBadge.vue',
        'src/volt/AppButton.vue',
        'src/components/UserTable.preview.json',
        'src/pt/preset.ts',
        'src/styles/main.css',
      ]),
    );
    for (const d of r.deps) expect(path.isAbsolute(d)).toBe(false);
  });
});

describe('EditDialog (Dialog via Portal/Teleport)', () => {
  const r = load('EditDialog');
  test('dialog content is appended to body from ssrContext.teleports', () => {
    const tail = r.html.slice(r.html.indexOf('<!-- teleport:body -->'));
    expect(tail).toContain('ユーザー編集');
    expect(tail).toContain('value="山田 太郎"');
  });
});

describe('UserPage (nested components, named slots)', () => {
  const r = load('UserPage');
  test('no warnings', () => expect(r.warnings).toEqual([]));
  test('named slots rendered in parent context', () => {
    expect(r.html).toContain('有効ユーザー 1 名');
    expect(r.html).toContain('エクスポート');
    expect(r.html).toContain('最終更新:');
  });
  test('self-contained: fonts inlined, no external urls', () => {
    expect(r.html).toContain('data:font/woff2;base64,');
    const external = [...r.html.matchAll(/(?:src|href)="(https?:[^"]+)"|url\((['"]?)(https?:[^)'"]+)/g)];
    expect(external).toEqual([]);
  });
});

describe('edge cases', () => {
  test('script is not executed; placeholders iterate and stringify', () => {
    const r = load('PlaceholderDemo');
    // text: the last segment, with the full expression on hover; attributes: the last segment
    expect(r.html).toContain('<span class="vp-ph" title="order.items[2].name">{{ name }}</span>');
    expect(r.html).toContain('data-order="{{ id }}"');
    expect(r.html).not.toMatch(/[]/);
    expect(r.warnings.some((w) => w.includes("'formatYen'") && w.includes('not executed'))).toBe(true);
  });
  test('circular imports become a stub', () => {
    const r = load('CircularA');
    expect(r.html).toContain('data-vp-stub="CircularA"');
    expect(r.warnings.some((w) => w.includes('circular import'))).toBe(true);
  });
  test('unresolved components become stubs', () => {
    const r = load('Unresolved');
    expect(r.html).toContain('data-vp-stub="Missing"');
    expect(r.html).toContain('data-vp-stub="FancyWidget"');
    expect(r.warnings.filter((w) => w.startsWith('stub <')).length).toBe(2);
  });
});

describe('globally registered components (app.component in src/main.ts)', () => {
  for (const name of ['GlobalRegistered', 'noconfig-GlobalRegistered']) {
    const r = load(name);
    test(`${name}: a project SFC and a package component render instead of stubs`, () => {
      expect(r.html).not.toContain('data-vp-stub');
      expect(r.html).toContain('招待中'); // StatusBadge via <app-badge status="invited">
      expect(r.html).toContain('global-tag'); // primevue/tag via <pv-tag>
      expect(r.warnings).toEqual([]);
    });
  }
});

describe('inferred config (no vue-preview.config.json)', () => {
  for (const name of ['UserPage', 'UserTable']) {
    const r = load(`noconfig-${name}`);
    const explicit = load(name);
    test(`${name}: settings are read from src/main.ts`, () => {
      expect(r.config).toEqual({ file: null, detected: ['globalCss', 'tailwind', 'primevue', 'components'] });
      expect(r.deps).toContain('src/main.ts');
    });
    test(`${name}: renders like the explicit config`, () => {
      expect(r.warnings).toEqual(explicit.warnings);
      // same markup; the order of the inlined CSS follows the entry's imports instead
      const body = (html: string) => html.slice(html.indexOf('<body'));
      expect(body(r.html)).toBe(body(explicit.html));
      expect(r.html).toMatch(/\.bg-brand-500\s*{/);
      expect(r.html).toContain('data:font/woff2;base64,');
    });
  }
});

describe('alias from vite.config (no config file, no tsconfig)', () => {
  const r = load('viteonly-UserPage');
  const inferred = load('noconfig-UserPage');
  test('`@` imports resolve through resolve.alias', () => {
    expect(r.warnings).toEqual([]);
    expect(r.deps).toContain('vite.config.ts');
  });
  test('renders like the tsconfig-based run', () => expect(r.html).toBe(inferred.html));
});

describe('dependency cache (no node_modules in the project)', () => {
  for (const name of ['UserPage', 'UserTable']) {
    const project = load(name);
    const cached = load(`bare-${name}`);
    test(`${name}: libraries come from the cache`, () => {
      expect(project.modules).toEqual({ kind: 'project' });
      expect(cached.modules.kind).toBe('cache');
    });
    test(`${name}: same HTML as with the project's node_modules`, () => expect(cached.html).toBe(project.html));
    test(`${name}: same warnings and deps`, () => {
      expect(cached.warnings).toEqual(project.warnings);
      expect(cached.deps).toEqual(project.deps);
    });
  }
});
