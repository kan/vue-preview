import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractCandidatesFallback, inlineUrls } from '../../src/css';

describe('inlineUrls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-css-'));
  fs.mkdirSync(path.join(dir, 'fonts'));
  for (const ext of ['woff2', 'woff', 'ttf', 'eot']) fs.writeFileSync(path.join(dir, `fonts/i.${ext}`), ext);

  test('keeps only woff2 in @font-face and inlines it', () => {
    const css = `@font-face { font-family: 'i'; src: url('./fonts/i.eot'); src: url('./fonts/i.eot?#iefix') format('embedded-opentype'), url('./fonts/i.woff2') format('woff2'), url('./fonts/i.woff') format('woff'); }`;
    const warnings: string[] = [];
    const out = inlineUrls(css, dir, (m) => warnings.push(m));
    expect(out).toContain(`url(data:font/woff2;base64,${Buffer.from('woff2').toString('base64')}) format('woff2')`);
    expect(out).not.toContain('.eot');
    expect(out).not.toContain('font/woff;');
    expect(warnings).toEqual([]);
  });

  test('leaves data: urls alone and warns on missing / external', () => {
    const warnings: string[] = [];
    const out = inlineUrls(`a{background:url(data:x)} b{background:url(missing.png)} c{background:url(https://x.test/a.png)}`, dir, (m) => warnings.push(m));
    expect(out).toContain('url(data:x)');
    expect(warnings.length).toBe(2);
  });
});

describe('extractCandidatesFallback', () => {
  test('splits class attributes', () => {
    expect(extractCandidatesFallback('<div class="p-4  text-sm"><i class="pi pi-x"></i></div>')).toEqual(['p-4', 'text-sm', 'pi', 'pi-x']);
  });
});
