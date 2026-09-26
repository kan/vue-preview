// Simple i18n (REPORT V13): translate `$t('key')` in templates and the `t` a component receives
// from `useI18n()` with the project's messages, for vue-i18n and hand-rolled i18n alike.
// Message modules (`src/i18n/ja.ts`) are imported, i.e. executed, like the PrimeVue pt preset:
// they are plain objects of strings in practice.
import fs from 'node:fs';
import path from 'node:path';
import { firstFile, readJson } from './config';

export interface I18n {
  locale: string;
  /** `t(key, params)`: the message for `key` with `{name}` / `{0}` filled in, or the key itself. */
  t: (key: unknown, ...args: unknown[]) => string;
}

const DIRS = ['src/i18n', 'src/locales', 'src/locale', 'src/lang', 'src/langs'];
const EXTS = ['.json', '.ts', '.js', '.mjs'];
/** Locales tried when none is configured: Japanese first (REPORT V13). */
const PREFERRED = ['ja', 'en'];

/** Message files by locale (`ja` -> `src/i18n/ja.ts`) found in the usual places. */
export function findMessageFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of DIRS) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      const ext = path.extname(name);
      const locale = path.basename(name, ext);
      // `index.js` (createI18n) and other modules are not message files
      if (EXTS.includes(ext) && /^[a-z]{2}([-_][A-Za-z]{2,4})?$/.test(locale) && !(locale in out)) out[locale] = `${dir}/${name}`;
    }
    if (Object.keys(out).length) return out;
  }
  return out;
}

/** The locale to use: the requested one if its messages exist, else ja, en, then the first found. */
export function pickLocale(available: string[], requested?: string): string | undefined {
  return [requested, ...PREFERRED].find((l) => l && available.includes(l)) ?? available[0];
}

/**
 * The messages file for `locale` from a `{locale}` pattern (absolute). A pattern without an
 * extension (what detection writes: locales of one directory may differ, `ja.ts` beside
 * `en.json`) takes the first of EXTS that exists; one with an extension is used as written.
 */
export function messageFile(root: string, pattern: string, locale: string): string {
  const file = path.resolve(root, pattern.replaceAll('{locale}', locale));
  if (EXTS.includes(path.extname(file))) return file;
  return firstFile(EXTS.map((e) => file + e)) ?? file + EXTS[0];
}

/** Load a message file: JSON as is; a module's default export, its export named after the locale, or its only export. */
export async function loadMessages(file: string, locale: string): Promise<Record<string, unknown>> {
  if (file.endsWith('.json')) return readJson(file);
  const mod = await import(file);
  const exports = Object.keys(mod).filter((k) => k !== '__esModule');
  const value = mod.default ?? mod[locale] ?? (exports.length === 1 ? mod[exports[0]] : undefined);
  return value && typeof value === 'object' ? value : {};
}

/** The message for `key`: a nested path (`a.b.c`) first, then a flat key (`'a.b.c': ...`). */
export function lookup(messages: Record<string, unknown>, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node === 'string') return node;
  const flat = messages[key];
  return typeof flat === 'string' ? flat : undefined;
}

/** Fill `{name}` from an object or `{0}` from an array (vue-i18n named / list interpolation). */
export function interpolate(message: string, params: unknown): string {
  if (!params || typeof params !== 'object') return message;
  return message.replace(/\{\s*([\w$]+)\s*\}/g, (m, name: string) => {
    const v = (params as Record<string, unknown>)[name];
    return v === undefined ? m : String(v);
  });
}

/**
 * vue-i18n's plural choice for `'none | one | {n} many'` (3 forms: 0, 1, other) or
 * `'one | many'` (2 forms: 1, other), with `{n}` / `{count}` filled with the number.
 */
function pluralize(message: string, n: number, params: unknown): [string, unknown] {
  const forms = message.split('|').map((s) => s.trim());
  if (forms.length < 2) return [message, params];
  const index = forms.length === 2 ? (n === 1 ? 0 : 1) : Math.min(Math.abs(n), 2);
  return [forms[index], { n, count: n, ...(params as object) }];
}

export function createI18n(locale: string, messages: Record<string, unknown>): I18n {
  return {
    locale,
    t: (key, ...args) => {
      const k = String(key);
      const message = lookup(messages, k);
      // a missing key shows the key itself (vue-i18n does the same)
      if (message === undefined) return k;
      const params = args.find((a) => a && typeof a === 'object');
      const n = args.find((a) => typeof a === 'number') as number | undefined;
      const [m, p] = n === undefined ? [message, params] : pluralize(message, n, params);
      return interpolate(m, p);
    },
  };
}
