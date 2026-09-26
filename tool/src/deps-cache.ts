// Dependency cache: when `vue` does not resolve from the project (its node_modules
// only exists inside a container), install the project's
// locked dependencies into a per-lockfile cache directory with the bun that is
// embedded in this binary, and resolve libraries from there (REPORT V7).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFrom } from './load-project-modules';

/** Lockfiles bun can install from (it migrates the non-bun ones). First match wins. */
const LOCKFILES = ['bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'];

/** Set in the re-executed child: the cache directory whose node_modules is on NODE_PATH. */
export const DEPS_DIR_ENV = 'VUE_PREVIEW_DEPS_DIR';

const MARKER = '.vue-preview-ok';
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** True when `vue` resolves from the project root (the project has its own node_modules). */
export function projectHasVue(root: string): boolean {
  try {
    resolveFrom('vue', path.join(root, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

export function findLockfile(root: string): string | null {
  for (const name of LOCKFILES) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** `VUE_PREVIEW_CACHE_DIR`, else `%LOCALAPPDATA%\vue-preview` / `$XDG_CACHE_HOME/vue-preview` / `~/.cache/vue-preview`. */
export function cacheBase(env: Record<string, string | undefined> = process.env, platform: string = process.platform): string {
  if (env.VUE_PREVIEW_CACHE_DIR) return env.VUE_PREVIEW_CACHE_DIR;
  if (platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'vue-preview');
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'vue-preview');
}

/**
 * The cache key covers everything that changes what gets installed: the manifest,
 * the lockfile (and its format), registry settings, the platform (native optional
 * dependencies such as `@tailwindcss/oxide-*`) and the installer's version.
 */
export function cacheKey(files: { name: string; content: string | Buffer }[], platform: string, arch: string, bunVersion: string): string {
  const h = createHash('sha256');
  h.update(`${platform}-${arch}\0bun ${bunVersion}\0`);
  for (const f of files) {
    h.update(`${f.name}\0`);
    h.update(f.content);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Return a cache directory whose node_modules holds the project's locked
 * dependencies, installing them on first use. Throws with an explanation when
 * the project cannot be installed (no lockfile, workspaces, install failure).
 */
export function ensureDepsCache(root: string, log: (msg: string) => void): string {
  const manifest = path.join(root, 'package.json');
  if (!fs.existsSync(manifest)) throw new Error(`no node_modules and no package.json in ${root}`);
  const lockfile = findLockfile(root);
  if (!lockfile) {
    throw new Error(`no node_modules in ${root}, and no lockfile to install from (looked for ${LOCKFILES.join(', ')})`);
  }
  const npmrc = path.join(root, '.npmrc');
  const files = [manifest, lockfile, ...(fs.existsSync(npmrc) ? [npmrc] : [])].map((f) => ({ name: path.basename(f), content: fs.readFileSync(f) }));
  if (JSON.parse(files[0].content.toString()).workspaces) {
    throw new Error(`no node_modules in ${root}, and workspaces (monorepo) cannot be installed into the cache`);
  }

  const base = path.join(cacheBase(), 'deps');
  const dir = path.join(base, cacheKey(files, process.platform, process.arch, Bun.version));
  const marker = path.join(dir, MARKER);
  if (fs.existsSync(marker)) {
    touchIfStale(marker);
    return dir;
  }

  log(`vue-preview: installing dependencies from ${path.basename(lockfile)} into ${dir} (first run only)`);
  fs.mkdirSync(base, { recursive: true });
  const tmp = fs.mkdtempSync(`${dir}.tmp-`);
  try {
    for (const f of files) fs.writeFileSync(path.join(tmp, f.name), f.content);
    // In a compiled binary, BUN_BE_BUN=1 makes the executable behave as the bun CLI;
    // in development execPath is bun itself. --linker hoisted keeps npm's flat layout.
    const r = Bun.spawnSync([process.execPath, 'install', '--frozen-lockfile', '--ignore-scripts', '--linker', 'hoisted'], {
      cwd: tmp,
      env: { ...process.env, BUN_BE_BUN: '1' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (r.exitCode !== 0) {
      const out = `${r.stdout.toString()}\n${r.stderr.toString()}`.trim().split('\n').slice(-10).join('\n');
      throw new Error(
        `dependency install failed (exit ${r.exitCode}); only ${files.map((f) => f.name).join(', ')} are copied into the cache, ` +
          `so file:/link: dependencies and patches are not available:\n${out}`,
      );
    }
    fs.writeFileSync(path.join(tmp, MARKER), '');
    // a leftover without the marker (an interrupted prune) would make the rename fail forever
    if (fs.existsSync(dir) && !fs.existsSync(marker)) fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.renameSync(tmp, dir);
    } catch (e) {
      // another process finished the same install first: use theirs
      if (!fs.existsSync(marker)) throw e;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  prune(base, dir, log);
  return dir;
}

/** Record a use for `prune`, at most once a day (a metadata write on every render is not needed). */
function touchIfStale(file: string) {
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < 24 * 60 * 60 * 1000) return;
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {}
}

/** Remove cache entries (other lockfile versions, crashed installs) unused for 30 days. */
function prune(base: string, keep: string, log: (msg: string) => void) {
  const limit = Date.now() - PRUNE_AFTER_MS;
  for (const name of fs.readdirSync(base)) {
    const dir = path.join(base, name);
    if (dir === keep) continue;
    const marker = path.join(dir, MARKER);
    try {
      const used = fs.statSync(fs.existsSync(marker) ? marker : dir).mtimeMs;
      if (used >= limit) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      log(`vue-preview: removed unused dependency cache ${dir}`);
    } catch {}
  }
}
