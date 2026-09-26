import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheBase, cacheKey, ensureDepsCache, findLockfile, projectHasVue } from '../../src/deps-cache';

const tmp = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-deps-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
};

describe('findLockfile', () => {
  test('prefers bun.lock, then npm, yarn, pnpm', () => {
    expect(findLockfile(tmp({ 'yarn.lock': '', 'package-lock.json': '{}' }))).toEndWith('package-lock.json');
    expect(findLockfile(tmp({ 'pnpm-lock.yaml': '', 'bun.lock': '' }))).toEndWith('bun.lock');
  });
  test('null without a lockfile', () => expect(findLockfile(tmp({ 'package.json': '{}' }))).toBeNull());
});

describe('cacheBase', () => {
  test('explicit override wins', () => expect(cacheBase({ VUE_PREVIEW_CACHE_DIR: '/c', XDG_CACHE_HOME: '/x' }, 'linux')).toBe('/c'));
  test('XDG_CACHE_HOME on Unix', () => expect(cacheBase({ XDG_CACHE_HOME: '/x' }, 'linux')).toBe(path.join('/x', 'vue-preview')));
  test('LOCALAPPDATA on Windows', () => expect(cacheBase({ LOCALAPPDATA: '/l', XDG_CACHE_HOME: '/x' }, 'win32')).toBe(path.join('/l', 'vue-preview')));
  test('~/.cache otherwise', () => expect(cacheBase({}, 'darwin')).toBe(path.join(os.homedir(), '.cache', 'vue-preview')));
});

describe('cacheKey', () => {
  const files = [
    { name: 'package.json', content: '{"a":1}' },
    { name: 'package-lock.json', content: '{}' },
  ];
  test('stable for the same inputs', () => expect(cacheKey(files, 'linux', 'x64', '1.4.2')).toBe(cacheKey(files, 'linux', 'x64', '1.4.2')));
  test('changes with lockfile, platform and installer version', () => {
    const base = cacheKey(files, 'linux', 'x64', '1.4.2');
    expect(cacheKey([files[0], { name: 'package-lock.json', content: '{ }' }], 'linux', 'x64', '1.4.2')).not.toBe(base);
    expect(cacheKey(files, 'win32', 'x64', '1.4.2')).not.toBe(base);
    expect(cacheKey(files, 'linux', 'x64', '1.4.3')).not.toBe(base);
  });
  test('file boundaries matter', () => {
    expect(cacheKey([{ name: 'a', content: 'bc' }], 'linux', 'x64', '1')).not.toBe(cacheKey([{ name: 'ab', content: 'c' }], 'linux', 'x64', '1'));
  });
});

describe('ensureDepsCache refuses what it cannot install', () => {
  const log = () => {};
  test('no lockfile', () => expect(() => ensureDepsCache(tmp({ 'package.json': '{}' }), log)).toThrow(/no lockfile/));
  test('no package.json', () => expect(() => ensureDepsCache(tmp({}), log)).toThrow(/no package.json/));
  test('workspaces', () => {
    const root = tmp({ 'package.json': '{"workspaces":["packages/*"]}', 'package-lock.json': '{}' });
    expect(() => ensureDepsCache(root, log)).toThrow(/workspaces/);
  });
});

test('projectHasVue is false without node_modules', () => expect(projectHasVue(tmp({ 'package.json': '{}' }))).toBe(false));
