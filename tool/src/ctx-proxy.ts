// V2: the object returned from setup(). Every template identifier is looked up
// here (the template is compiled with all bindings routed through $setup).
import { createPlaceholder, type PlaceholderOptions } from './placeholder';
import type { CompiledSfc } from './compile';
import { UNKNOWN } from './compile';

export interface CtxSources {
  sfc: CompiledSfc;
  instance: any; // ComponentInternalInstance
  imports: Record<string, unknown>;
  fixture: Record<string, unknown> | null;
  placeholder: PlaceholderOptions;
}

const hyphenate = (s: string) => s.replace(/\B([A-Z])/g, '-$1').toLowerCase();

function clone<T>(v: T): T {
  return v === null || typeof v !== 'object' ? v : structuredClone(v);
}

export function createCtxProxy(src: CtxSources) {
  const { sfc, instance, imports, fixture } = src;
  const cache = new Map<string, unknown>();

  const wasPassed = (prop: string) => {
    const raw = instance.vnode.props ?? {};
    return prop in raw || hyphenate(prop) in raw;
  };

  /** Resolve a prop by its declared name. */
  const resolveProp = (prop: string, local: string): unknown => {
    // 1. value actually passed by the parent
    if (wasPassed(prop)) return instance.props[prop];
    // 3. fixture (root only) — by local name first, then prop name
    if (fixture && local in fixture) return fixture[local];
    if (fixture && prop in fixture) return fixture[prop];
    // 4. static default
    const info = sfc.props[prop];
    if (info && info.default !== UNKNOWN) return clone(info.default);
    if (info?.types.includes('Boolean')) return false; // Vue's absent-boolean casting
    // 5. placeholder
    return createPlaceholder(local === prop ? prop : `${local}`, src.placeholder);
  };

  let propsObject: any;
  const getPropsObject = (local: string) =>
    (propsObject ??= new Proxy(
      {},
      {
        get: (_t, k) => (typeof k === 'string' && !k.startsWith('__v') ? resolveProp(k, `${local}.${k}`) : undefined),
        has: (_t, k) => typeof k === 'string',
      },
    ));

  const resolve = (key: string): unknown => {
    const propName = key in sfc.props ? key : sfc.propAliases[key];
    if (propName && wasPassed(propName)) return instance.props[propName];
    if (sfc.propsObjectNames.includes(key)) return getPropsObject(key);
    // 2. resolved imports (child components, library values)
    if (key in imports) return imports[key];
    if (propName) return resolveProp(propName, key);
    // 3. fixture
    if (fixture && key in fixture) return fixture[key];
    // 4. static literals (`ref(false)`, `const labels = {...}`)
    if (key in sfc.literals) return clone(sfc.literals[key]);
    // 5. placeholder
    return createPlaceholder(key, src.placeholder);
  };

  return new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (typeof key !== 'string' || key.startsWith('__') || key === 'then') return undefined;
      if (key in target) return target[key]; // values assigned by the template (v-model etc.)
      if (!cache.has(key)) cache.set(key, resolve(key));
      return cache.get(key);
    },
    set(target, key, value) {
      if (typeof key === 'string') target[key] = value;
      return true;
    },
    has(_t, key) {
      return typeof key === 'string' && !key.startsWith('$') && !key.startsWith('__');
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key !== 'string' || key.startsWith('$') || key.startsWith('__')) return undefined;
      return { configurable: true, enumerable: true, writable: true, value: (this as any).get(target, key) };
    },
    ownKeys() {
      return [];
    },
  });
}
