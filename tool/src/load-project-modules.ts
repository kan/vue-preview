// V1: resolve and import libraries from the *target project's* node_modules
// at runtime so that there is exactly one Vue instance.
import path from 'node:path';

export interface ProjectModules {
  root: string;
  vue: typeof import('vue');
  sfc: typeof import('@vue/compiler-sfc');
  ssr: typeof import('@vue/server-renderer');
  resolved: Record<string, string>;
  /** Resolve a bare/relative specifier as if imported from `fromFile`. */
  resolve(spec: string, fromFile: string): string;
  importFrom(spec: string, fromFile: string): Promise<any>;
  optional<T = any>(spec: string): Promise<T | null>;
}

function resolveFrom(spec: string, fromFile: string): string {
  // Bun.resolveSync treats the 2nd arg as a directory when it ends with '/'.
  const dir = fromFile.endsWith('/') ? fromFile : path.dirname(fromFile) + '/';
  return Bun.resolveSync(spec, dir);
}

export async function loadProjectModules(root: string): Promise<ProjectModules> {
  const anchor = path.join(root, 'package.json');
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
    vue,
    sfc,
    ssr,
    resolved,
    resolve: resolveFrom,
    importFrom: (spec, fromFile) => import(resolveFrom(spec, fromFile)),
    async optional(spec) {
      try {
        return await load(spec);
      } catch {
        return null;
      }
    },
  };
}
