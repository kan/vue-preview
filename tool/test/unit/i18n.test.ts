import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeConfig } from '../../src/detect-config';
import { createI18n, findMessageFiles, interpolate, loadMessages, lookup, messageFile, pickLocale } from '../../src/i18n';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vp-i18n-'));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

describe('messages', () => {
  const messages = { menu: { open: '開く' }, 'a.b': 'フラット', hello: 'こんにちは {name}', list: '{0} と {1}' };
  test('nested path first, then a flat key', () => {
    expect(lookup(messages, 'menu.open')).toBe('開く');
    expect(lookup(messages, 'a.b')).toBe('フラット');
    expect(lookup(messages, 'menu')).toBeUndefined(); // an object is not a message
    expect(lookup(messages, 'nope.x')).toBeUndefined();
  });
  test('named and list interpolation; unknown names stay', () => {
    expect(interpolate('こんにちは {name}', { name: 'Pike' })).toBe('こんにちは Pike');
    expect(interpolate('{0} と {1}', ['A', 'B'])).toBe('A と B');
    expect(interpolate('{ name } {other}', { name: 'x' })).toBe('x {other}');
    expect(interpolate('{name}', undefined)).toBe('{name}');
  });
  test('t: a missing key shows the key; the params object may follow a plural count', () => {
    const { t } = createI18n('ja', messages);
    expect(t('hello', { name: 'Pike' })).toBe('こんにちは Pike');
    expect(t('hello', 2, { name: 'Pike' })).toBe('こんにちは Pike');
    expect(t('missing.key')).toBe('missing.key');
  });
  test('plural forms (vue-i18n): 3 forms are 0 / 1 / other, 2 forms are 1 / other; {n} and {count} are the number', () => {
    const { t } = createI18n('en', { apples: 'no apples | one apple | {n} apples', cars: 'car | {count} cars' });
    expect([0, 1, 5].map((n) => t('apples', n))).toEqual(['no apples', 'one apple', '5 apples']);
    expect([1, 2].map((n) => t('cars', n))).toEqual(['car', '2 cars']);
    expect(t('apples', 5, { n: 'many' })).toBe('many apples');
  });
});

describe('locale', () => {
  test('the requested one, else ja, en, then the first found', () => {
    expect(pickLocale(['en', 'ja'], 'en')).toBe('en');
    expect(pickLocale(['en', 'ja'], 'fr')).toBe('ja');
    expect(pickLocale(['en', 'zh-TW'])).toBe('en');
    expect(pickLocale(['zh-TW', 'fr'])).toBe('zh-TW');
    expect(pickLocale([])).toBeUndefined();
  });
});

describe('message files', () => {
  test('locale-named files of the first directory that has any; index.js is not one', () => {
    const root = tmp();
    write(root, 'src/i18n/index.js', 'export default {}');
    write(root, 'src/i18n/ja.js', 'export const ja = {}');
    write(root, 'src/i18n/en.json', '{}');
    write(root, 'src/i18n/pt-BR.ts', 'export default {}');
    write(root, 'src/locales/fr.json', '{}');
    expect(findMessageFiles(root)).toEqual({ ja: 'src/i18n/ja.js', en: 'src/i18n/en.json', 'pt-BR': 'src/i18n/pt-BR.ts' });
    expect(findMessageFiles(tmp())).toEqual({});
  });
  test('JSON, a default export, an export named after the locale, the only export', async () => {
    const root = tmp();
    write(root, 'a.json', '{"k":"json"}');
    write(root, 'b.ts', 'export default { k: "default" }');
    write(root, 'c.js', 'export const other = {}; export const ja = { k: "named" }');
    write(root, 'd.ts', 'export const messages = { k: "only" }');
    write(root, 'e.ts', 'export const a = {}; export const b = {}');
    const k = async (f: string) => (await loadMessages(path.join(root, f), 'ja')).k;
    expect(await k('a.json')).toBe('json');
    expect(await k('b.ts')).toBe('default');
    expect(await k('c.js')).toBe('named');
    expect(await k('d.ts')).toBe('only');
    expect(await loadMessages(path.join(root, 'e.ts'), 'ja')).toEqual({});
  });
  test('detected into config.i18n with a {locale} pattern; an explicit null turns it off', () => {
    const root = tmp();
    write(root, 'src/locales/en.json', '{}');
    write(root, 'src/locales/ja.json', '{}');
    const { config, detected } = completeConfig(root, {});
    expect(config.i18n).toEqual({ locale: 'ja', messages: 'src/locales/{locale}' });
    expect(detected).toContain('i18n');
    expect(completeConfig(root, { i18n: null }).config.i18n).toBeNull();
    // only the locale written: the files are still found
    expect(completeConfig(root, { i18n: { locale: 'en' } }).config.i18n).toEqual({ locale: 'en', messages: 'src/locales/{locale}' });
  });
  test('a pattern without an extension finds each locale with its own; one with an extension is used as written', () => {
    const root = tmp();
    write(root, 'src/i18n/ja.ts', 'export default {}');
    write(root, 'src/i18n/en.json', '{}');
    const abs = (rel: string) => path.join(root, rel);
    expect(messageFile(root, 'src/i18n/{locale}', 'en')).toBe(abs('src/i18n/en.json'));
    expect(messageFile(root, 'src/i18n/{locale}', 'ja')).toBe(abs('src/i18n/ja.ts'));
    expect(messageFile(root, 'src/i18n/{locale}', 'fr')).toBe(abs('src/i18n/fr.json'));
    expect(messageFile(root, 'src/i18n/{locale}.ts', 'en')).toBe(abs('src/i18n/en.ts'));
  });
});
