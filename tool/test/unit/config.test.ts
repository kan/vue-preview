import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aliasesFromTsconfig, resolveAliases } from '../../src/config';

describe('aliases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-cfg-'));
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    `{
      // comments are allowed in tsconfig
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "~lib/*": ["lib/*"], "exact": ["x.ts"] } },
    }`,
  );

  test('reads tsconfig paths when config has no aliases', () => {
    expect(aliasesFromTsconfig(root)).toEqual({ '@': path.join(root, 'src'), '~lib': path.join(root, 'lib') });
    expect(resolveAliases(root, {})).toEqual(aliasesFromTsconfig(root));
  });

  test('config aliases win and are root-relative', () => {
    expect(resolveAliases(root, { aliases: { '@': 'app' } })).toEqual({ '@': path.join(root, 'app') });
  });
});
