// V1: resolve and import libraries from the *target project's* node_modules
// at runtime so that there is exactly one Vue instance.
// V7: when the project has no node_modules, the libraries come from the
// dependency cache (deps-cache.ts) instead; its node_modules is also on NODE_PATH
// so that project files imported natively (the pt preset) resolve there too.
import path from 'node:path';

export interface ProjectModules {
  root: string;
  /** Where libraries are resolved from: the project itself, or the dependency cache directory. */
  source: { kind: 'project' } | { kind: 'cache'; dir: string };
  vue: typeof import('vue');
  sfc: typeof import('@vue/compiler-sfc');
  ssr: typeof import('@vue/server-renderer');
  resolved: Record<string, string>;
  /** Root-relative path with `/` separators (stable across OSes: scope ids hash it). */
  rel(file: string): string;
  /** Resolve a bare/relative specifier as if imported from `fromFile`. */
  resolve(spec: string, fromFile: string): string;
  importFrom(spec: string, fromFile: string): Promise<any>;
  optional<T = any>(spec: string): Promise<T | null>;
}

/** `file` relative to `root` with `/` separators. */
export function relPosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function resolveFrom(spec: string, fromFile: string): string {
  // Bun.resolveSync treats the 2nd arg as a directory when it ends with a separator.
  const dir = /[\\/]$/.test(fromFile) ? fromFile : path.dirname(fromFile) + path.sep;
  return Bun.resolveSync(spec, dir);
}

export async function loadProjectModules(root: string, cacheDir: string | null = null): Promise<ProjectModules> {
  const anchor = path.join(cacheDir ?? root, 'package.json');
  // Project files resolve relative to themselves; package specifiers that the
  // project cannot resolve fall back to the dependency cache.
  const resolve = cacheDir
    ? (spec: string, fromFile: string) => {
        try {
          return resolveFrom(spec, fromFile);
        } catch (e) {
          if (spec.startsWith('.') || path.isAbsolute(spec)) throw e;
          return resolveFrom(spec, anchor);
        }
      }
    : resolveFrom;
  const resolved: Record<string, string> = {};
  const load = async (spec: string) => {
    const p = resolveFrom(spec, anchor);
    resolved[spec] = p;
    return import(p);
  };
  const vue = await load('vue');
  const sfc = await load('@vue/compiler-sfc').catch(() => load('vue/compiler-sfc'));
  const ssr = await load('@vue/server-renderer').catch(() => load('vue/server-renderer'));

  // Single-instance check: 'vue' as seen from server-renderer and primevue must
  // be the same file (and hence the same module record) as ours.
  for (const lib of ['@vue/server-renderer', 'primevue/config']) {
    try {
      const libPath = resolveFrom(lib, anchor);
      resolved[`vue (from ${lib})`] = resolveFrom('vue', libPath);
    } catch {}
  }

  return {
    root,
    source: cacheDir ? { kind: 'cache', dir: cacheDir } : { kind: 'project' },
    vue,
    sfc,
    ssr,
    resolved,
    rel: (file) => relPosix(root, file),
    resolve,
    importFrom: (spec, fromFile) => import(resolve(spec, fromFile)),
    async optional(spec) {
      try {
        return await load(spec);
      } catch {
        return null;
      }
    },
  };
}
