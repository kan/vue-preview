// Fill in what vue-preview.config.json leaves out by reading the project statically
// (REPORT V8). Nothing here executes project code: the app entry (src/main.ts) is read
// as text. Explicit config keys always win.
import fs from 'node:fs';
import path from 'node:path';
import { type Config, firstFile, projectPath, readJson } from './config';
import { relPosix } from './load-project-modules';

const ENTRY_CANDIDATES = ['src/main.ts', 'src/main.js', 'src/main.mts', 'src/main.mjs'];
const SCRIPT_EXTS = ['', '.ts', '.js', '.mts', '.mjs', '/index.ts', '/index.js'];

export interface CompletedConfig {
  config: Config;
  /** Config keys that were inferred rather than written. */
  detected: string[];
  /** Files read to infer them (absolute); a change to them changes the output. */
  deps: string[];
}

/** The `{ ... }` starting at `open` (an index of `{`), braces balanced; strings are not special-cased. */
export function balancedBlock(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
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
 * `import 'spec'`. Comments are removed first so that commented-out imports do not count.
 */
export function entryImports(source: string): EntryImport[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /^\s*import\s+(?:([\w$]+)?\s*,?\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*(from)\s+)?['"]([^'"]+)['"]/gm;
  return [...code.matchAll(re)].map(([, name, from, spec]) => ({ name: name ?? null, spec, sideEffect: !from }));
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

/**
 * `explicit` completed from the app entry. `aliases` are the ones rendering uses
 * (`resolveAliases`), so that the entry's imports resolve the same way as components do.
 */
export function completeConfig(root: string, explicit: Config, aliases: Record<string, string>): CompletedConfig {
  const config: Config = { ...explicit };
  const detected: string[] = [];
  const deps: string[] = [];

  // only keys that are absent: `null` in the config means "explicitly off"
  const needs = (key: 'globalCss' | 'tailwind' | 'primevue') => config[key] === undefined;
  const entry = needs('globalCss') || needs('tailwind') || needs('primevue') ? firstFile(ENTRY_CANDIDATES.map((n) => path.join(root, n))) : null;
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
      const tw = css.find((c) => c.file && firstFile([c.file]) && /@import\s+['"]tailwindcss['"]/.test(fs.readFileSync(c.file, 'utf8')))?.file;
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
  return { config, detected, deps };
}

function dependsOn(manifest: string, name: string): boolean {
  try {
    const pkg = readJson(manifest);
    return !!(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}
