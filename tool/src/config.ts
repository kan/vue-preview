// Configuration loading (vue-preview.config.json + tsconfig paths fallback).
import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  aliases?: Record<string, string>;
  globalCss?: string[];
  tailwind?: { entry: string } | null;
  primevue?: { unstyled?: boolean; pt?: string; portal?: 'teleport' | 'inline' | 'off' } | null;
  componentDirs?: string[];
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

export function resolveAliases(root: string, config: Config): Record<string, string> {
  return config.aliases
    ? Object.fromEntries(Object.entries(config.aliases).map(([k, v]) => [k, path.resolve(root, v)]))
    : aliasesFromTsconfig(root);
}
