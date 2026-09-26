// Configuration loading (vue-preview.config.json + tsconfig paths fallback). Keys the config
// leaves out are inferred in detect-config.ts.
import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  aliases?: Record<string, string>;
  globalCss?: string[];
  tailwind?: { entry: string } | null;
  primevue?: { unstyled?: boolean; pt?: string; portal?: 'teleport' | 'inline' | 'off' } | null;
  componentDirs?: string[];
  /**
   * Globally registered / auto-imported components: tag name -> `./root-relative.vue`, or a
   * package specifier (`primevue/dialog`, `pkg#NamedExport`). Looked up by PascalCase name.
   */
  components?: Record<string, string>;
  /**
   * Messages for `$t` / `useI18n().t` (REPORT V13): `messages` is a root-relative path where
   * `{locale}` stands for the locale (`src/i18n/{locale}.ts`; without an extension, each locale's
   * own is found), found like an absent `i18n` when left out; `--locale` overrides `locale`.
   */
  i18n?: { locale?: string; messages?: string } | null;
  placeholderIterations?: number;
  maxDepth?: number;
}

export const CONFIG_FILE = 'vue-preview.config.json';

export function readJson(file: string) {
  // tsconfig allows comments / trailing commas
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    return new Function(`return (${text})`)();
  }
}

export function loadConfig(root: string): { config: Config; file: string | null } {
  const file = path.join(root, CONFIG_FILE);
  return fs.existsSync(file) ? { config: readJson(file), file } : { config: {}, file: null };
}

/** `{ "@/*": ["src/*"] }` -> `{ "@": "<root>/src" }` */
export function aliasesFromTsconfig(root: string): Record<string, string> {
  const file = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(file)) return {};
  const tsconfig = readJson(file);
  const base = path.resolve(root, tsconfig.compilerOptions?.baseUrl ?? '.');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries<string[]>(tsconfig.compilerOptions?.paths ?? {})) {
    if (!k.endsWith('/*') || !v[0]?.endsWith('/*')) continue;
    out[k.slice(0, -2)] = path.resolve(base, v[0].slice(0, -2));
  }
  return out;
}

/** Aliases as absolute directories: the config's `aliases` (root-relative), else tsconfig `paths`. */
export function resolveAliases(root: string, config: Config): Record<string, string> {
  return config.aliases
    ? Object.fromEntries(Object.entries(config.aliases).map(([k, v]) => [k, path.resolve(root, v)]))
    : aliasesFromTsconfig(root);
}

/**
 * Map an import specifier to an absolute path if it points into the project (relative, or
 * through one of `aliases` — absolute dirs from `resolveAliases`); null for a package.
 */
export function projectPath(spec: string, fromFile: string, aliases: Record<string, string>): string | null {
  if (spec.startsWith('./') || spec.startsWith('../')) return path.resolve(path.dirname(fromFile), spec);
  for (const [alias, dir] of Object.entries(aliases)) {
    if (spec === alias || spec.startsWith(alias + '/')) return path.join(dir, spec.slice(alias.length));
  }
  return null;
}

/** Whether `f` exists and is a file (false for a path below a file too: ENOTDIR). */
export function isFile(f: string): boolean {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

/** The first candidate that exists and is a file. */
export function firstFile(candidates: string[]): string | null {
  return candidates.find(isFile) ?? null;
}

/** Vite's public directory (its default `publicDir`): served at `/`, so `/img/a.png` is `public/img/a.png`. */
const PUBLIC_DIR = 'public';

/** `https://…` and protocol-relative `//…` URLs: not a file of the project. */
export const isExternalUrl = (url: string) => /^(https?:)?\/\//i.test(url);

/**
 * The file a local URL (`?query` / `#hash` stripped) names, as Vite serves it: a root-absolute
 * one (`/static/a.css`) from the public directory first, then the project root (the root's
 * path when neither exists); a relative one from `baseDir` (the referring file's directory).
 */
export function resolveUrl(root: string, baseDir: string, url: string): string {
  const clean = url.split(/[?#]/)[0];
  if (!clean.startsWith('/')) return path.resolve(baseDir, clean);
  const rel = clean.replace(/^\/+/, '');
  const candidates = [path.join(root, PUBLIC_DIR, rel), path.join(root, rel)];
  return firstFile(candidates) ?? candidates[1];
}
