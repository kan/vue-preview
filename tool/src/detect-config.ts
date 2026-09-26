// Fill in what vue-preview.config.json leaves out by reading the project statically
// (REPORT V8 / V9). Nothing here executes project code: the app entry (src/main.ts) and
// vite.config are read as text. Explicit config keys always win.
import fs from 'node:fs';
import path from 'node:path';
import { aliasesFromTsconfig, type Config, firstFile, projectPath, readJson, resolveAliases } from './config';
import { findMessageFiles, pickLocale } from './i18n';
import { relPosix } from './load-project-modules';
import { balancedBlock, objectEntry, splitTopLevel, stripComments, unquote } from './text-scan';

const ENTRY_CANDIDATES = ['src/main.ts', 'src/main.js', 'src/main.mts', 'src/main.mjs'];
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];
const SCRIPT_EXTS = ['', '.ts', '.js', '.mts', '.mjs', '/index.ts', '/index.js'];
/** Where unplugin-vue-components and Nuxt write the list of auto-imported components. */
const DTS_CANDIDATES = ['components.d.ts', 'src/components.d.ts', 'types/components.d.ts', '.nuxt/components.d.ts'];

export interface CompletedConfig {
  config: Config;
  /** Import aliases as absolute directories (what rendering resolves with). */
  aliases: Record<string, string>;
  /** Config keys that were inferred rather than written. */
  detected: string[];
  /** Files read to decide the config (absolute); a change to them changes the output. */
  deps: string[];
}

export interface EntryImport {
  /** The default binding, if any. */
  name: string | null;
  spec: string;
  /** `import 'spec'` (no bindings at all). */
  sideEffect: boolean;
}

/**
 * The imports of an app entry with their default binding: `import X from`, `import X, { a } from`,
 * `import { a } from` (no default: `name` is null but it is not a side-effect import either) and
 * `import 'spec'`. Commented-out imports do not count.
 */
export function entryImports(source: string): EntryImport[] {
  const re = /^\s*import\s+(?:([\w$]+)?\s*,?\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*(from)\s+)?['"]([^'"]+)['"]/gm;
  return [...stripComments(source).matchAll(re)].map(([, name, from, spec]) => ({ name: name ?? null, spec, sideEffect: !from }));
}

export interface PrimeVueUse {
  unstyled?: boolean;
  /** Identifier passed as `pt:` (an import of the entry), if any. */
  ptName?: string;
}

/** `app.use(PrimeVue, { unstyled: true, pt: Aura, ... })` where `PrimeVue` is `ident`. */
export function primeVueUse(source: string, ident: string): PrimeVueUse | null {
  const m = new RegExp(`\\.use\\(\\s*${ident.replace(/\$/g, '\\$')}(?![\\w$])\\s*(,\\s*\\{)?`).exec(source);
  if (!m) return null;
  if (!m[1]) return {};
  const options = balancedBlock(source, m.index + m[0].length - 1) ?? '';
  const unstyled = /\bunstyled\s*:\s*(true|false)\b/.exec(options);
  // `pt: Aura`, or the shorthand `{ pt }`
  const pt = /(?:^|[{,\s])pt\s*(?::\s*([\w$]+)\s*)?[,}\n]/.exec(options);
  return { unstyled: unstyled ? unstyled[1] === 'true' : undefined, ptName: pt ? (pt[1] ?? 'pt') : undefined };
}

/** `app.component('s-button', SButton)` of an app entry (name as a string literal, value an identifier). */
export function entryComponents(source: string): { name: string; ident: string }[] {
  return [...stripComments(source).matchAll(/\.component\(\s*['"]([^'"]+)['"]\s*,\s*([\w$]+)\s*\)/g)].map(([, name, ident]) => ({ name, ident }));
}

/**
 * The components a generated `components.d.ts` declares:
 * `Button: typeof import('./src/components/Button.vue')['default']` (unplugin-vue-components,
 * Nuxt) and `PButton: typeof import('primevue')['Button']` (named exports of a package).
 */
export function dtsComponents(source: string): { name: string; spec: string; exportName: string }[] {
  const re = /['"]?([\w$-]+)['"]?\s*:\s*typeof\s+import\(\s*['"]([^'"]+)['"]\s*\)\s*\[\s*['"]([\w$]+)['"]\s*\]/g;
  return [...stripComments(source).matchAll(re)].map(([, name, spec, exportName]) => ({ name, spec, exportName }));
}

/**
 * The directory an alias value names, root-relative, or null when it is not a path we can
 * read. A plain string must start with `.` or `/` (`'vue/dist/vue.esm-bundler.js'` retargets a
 * package and is not ours); otherwise the value must build a path from a literal
 * (`path.resolve(__dirname, './src')`, `fileURLToPath(new URL('./src', import.meta.url))`).
 * Variables and template literals are skipped.
 */
function aliasTarget(value: string): string | null {
  let literal = unquote(value);
  if (literal !== null) {
    if (!/^[./]/.test(literal)) return null;
  } else if (/\b(?:resolve|join)\s*\(|fileURLToPath\s*\(|new\s+URL\s*\(/.test(value)) {
    literal = /['"]([^'"]*)['"]/.exec(value)?.[1] ?? null;
  }
  return literal === null ? null : literal.replace(/^\.?\//, '').replace(/\/$/, '') || '.';
}

/** `{ find: '@', replacement: ... }` of the array form, as `[key, value]`. RegExp finds give null. */
function arrayEntry(part: string): [string, string] | null {
  if (!part.startsWith('{')) return null;
  const fields = Object.fromEntries(splitTopLevel(part.slice(1, -1)).map(objectEntry).filter((e) => e !== null));
  const key = unquote(fields.find ?? '');
  return key && fields.replacement ? [key, fields.replacement] : null;
}

/**
 * `resolve.alias` of a vite config, read as text (never run): the object form
 * `{ '@': path.resolve(__dirname, './src') }` and the array form `[{ find: '@', replacement: ... }]`.
 * Returns targets relative to the config's directory. Entries whose target is not a readable
 * path (a package, a variable, a RegExp `find`) are skipped.
 */
export function viteAliases(source: string): Record<string, string> {
  const code = stripComments(source);
  const m = /\balias\s*:\s*([{[])/.exec(code);
  const block = m && balancedBlock(code, m.index + m[0].length - 1);
  if (!m || !block) return {};
  const out: Record<string, string> = {};
  for (const part of splitTopLevel(block.slice(1, -1))) {
    const [key, value] = (m[1] === '[' ? arrayEntry(part) : objectEntry(part)) ?? [];
    const target = value && aliasTarget(value);
    if (key && target) out[key] = target;
  }
  return out;
}

export function completeConfig(root: string, explicit: Config): CompletedConfig {
  const config: Config = { ...explicit };
  const detected: string[] = [];
  const deps: string[] = [];

  // aliases: the config's, else tsconfig `paths`, else vite.config `resolve.alias` (REPORT V9)
  if (config.aliases === undefined) {
    if (Object.keys(aliasesFromTsconfig(root)).length) {
      deps.push(path.join(root, 'tsconfig.json'));
    } else {
      const vite = firstFile(VITE_CONFIGS.map((n) => path.join(root, n)));
      const fromVite = vite ? viteAliases(fs.readFileSync(vite, 'utf8')) : {};
      if (vite && Object.keys(fromVite).length) {
        config.aliases = fromVite;
        detected.push('aliases');
        deps.push(vite);
      }
    }
  }
  const aliases = resolveAliases(root, config);

  // only keys that are absent: `null` in the config means "explicitly off"
  const needs = (key: 'globalCss' | 'tailwind' | 'primevue' | 'components' | 'i18n') => config[key] === undefined;

  // i18n messages in the usual places (`src/i18n/ja.ts`, `src/locales/en.json`): REPORT V13.
  // A config that gives only `locale` still has its messages found.
  if (needs('i18n') || (config.i18n && !config.i18n.messages)) {
    const files = findMessageFiles(root);
    const locale = pickLocale(Object.keys(files), config.i18n?.locale);
    if (locale) {
      // no extension: each locale's own is found when it is read (`messageFile`)
      config.i18n = { locale, ...config.i18n, messages: `${path.posix.dirname(files[locale])}/{locale}` };
      detected.push('i18n');
    }
  }

  const components: Record<string, string> = {};
  /**
   * The config `components` value for an import: `./root-relative` for a project file, else the
   * package specifier. **Nothing is checked on disk here** (a Nuxt d.ts lists hundreds of
   * components on every render); resolving the tag checks the one that is used.
   */
  const componentRef = (spec: string, from: string, exportName = 'default') => {
    const local = projectPath(spec, from, aliases);
    if (local) return `./${relPosix(root, local)}`;
    return exportName === 'default' ? spec : `${spec}#${exportName}`;
  };

  // auto-imported components (unplugin-vue-components / Nuxt) are listed in a generated d.ts
  if (needs('components')) {
    for (const dts of DTS_CANDIDATES.map((n) => path.join(root, n))) {
      const source = readIfExists(dts);
      if (source === null) continue;
      // a dependency even while empty: the dev server fills it in later
      deps.push(dts);
      for (const c of dtsComponents(source)) components[c.name] = componentRef(c.spec, dts, c.exportName);
    }
  }

  const entry =
    needs('globalCss') || needs('tailwind') || needs('primevue') || needs('components')
      ? firstFile(ENTRY_CANDIDATES.map((n) => path.join(root, n)))
      : null;
  if (entry) {
    // the entry decides the inferred keys, so a change to it (adding app.use(PrimeVue), a CSS
    // import) changes the output even when nothing could be inferred yet
    deps.push(entry);
    const source = fs.readFileSync(entry, 'utf8');
    const imports = entryImports(source);
    const css = imports.filter((i) => i.sideEffect && i.spec.endsWith('.css')).map((i) => ({ spec: i.spec, file: projectPath(i.spec, entry, aliases) }));

    if (needs('globalCss') && css.length) {
      config.globalCss = css.map((c) => (c.file ? relPosix(root, c.file) : c.spec));
      detected.push('globalCss');
    }
    if (needs('tailwind')) {
      const tw = css.find((c) => c.file && /@import\s+['"]tailwindcss['"]/.test(readIfExists(c.file) ?? ''))?.file;
      if (tw) {
        config.tailwind = { entry: relPosix(root, tw) };
        detected.push('tailwind');
      }
    }
    const primeIdent = imports.find((i) => i.spec === 'primevue/config' && i.name)?.name;
    const use = needs('primevue') && primeIdent ? primeVueUse(source, primeIdent) : null;
    if (use) {
      const ptSpec = use.ptName ? imports.find((i) => i.name === use.ptName)?.spec : undefined;
      const ptBase = ptSpec ? projectPath(ptSpec, entry, aliases) : null;
      const ptFile = ptBase ? firstFile(SCRIPT_EXTS.map((e) => ptBase + e)) : null;
      config.primevue = { unstyled: use.unstyled ?? false, ...(ptFile ? { pt: relPosix(root, ptFile) } : {}) };
      detected.push('primevue');
    }
    // app.component('s-button', SButton): the identifier's import says where it comes from
    if (needs('components')) {
      for (const r of entryComponents(source)) {
        const spec = imports.find((i) => i.name === r.ident)?.spec;
        if (spec) components[r.name] = componentRef(spec, entry);
      }
    }
  }
  if (Object.keys(components).length) {
    config.components = components;
    detected.push('components');
  }

  // PrimeVue is a dependency but the entry did not show how it is installed: install it with
  // PrimeVue's own defaults (styled, `unstyled: false`) anyway, so that its components can read
  // $primevue instead of failing.
  const manifest = path.join(root, 'package.json');
  if (needs('primevue') && dependsOn(manifest, 'primevue')) {
    config.primevue = { unstyled: false };
    detected.push('primevue');
    deps.push(manifest);
  }
  return { config, aliases, detected, deps };
}

/** The file's text, or null when it cannot be read (missing, a directory). */
function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function dependsOn(manifest: string, name: string): boolean {
  try {
    const pkg = readJson(manifest);
    return !!(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}
