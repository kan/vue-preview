// V3: recursive resolution of child components.
import fs from 'node:fs';
import path from 'node:path';
import { firstFile, projectPath } from './config';
import type { ProjectModules } from './load-project-modules';
import { compileSfc, type CompiledSfc } from './compile';
import { createCtxProxy } from './ctx-proxy';
import { createPlaceholder, type PlaceholderOptions } from './placeholder';

export interface ResolveOptions {
  aliases: Record<string, string>; // '@' -> absolute dir
  componentDirs: string[]; // absolute dirs
  /** Global / auto-imported components by PascalCase name -> config `components` value. */
  components: Record<string, string>;
  maxDepth: number;
  placeholder: PlaceholderOptions;
}

const BUILTIN_TAGS = new Set(['Transition', 'TransitionGroup', 'KeepAlive', 'Teleport', 'Suspense', 'component', 'slot', 'template']);
const PROP_TYPES: Record<string, unknown> = { Boolean, String, Number, Array, Object, Function, Date, Symbol };

/** `pv-button` / `PvButton` -> `PvButton`: the name components are looked up by. */
const pascal = (s: string) => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

export class ComponentGraph {
  readonly compiled = new Map<string, CompiledSfc>();
  readonly warnings: string[] = [];
  readonly deps = new Set<string>();
  readonly time = { sfcCompile: 0, packageImport: 0 };
  private defs = new Map<string, any>();
  /** `opts.components` keyed by PascalCase name. */
  private components: Record<string, string>;

  constructor(
    private mods: ProjectModules,
    private opts: ResolveOptions,
  ) {
    this.components = Object.fromEntries(Object.entries(opts.components).map(([tag, ref]) => [pascal(tag), ref]));
  }

  warn(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  stub(name: string, reason: string) {
    this.warn(`stub <${name}>: ${reason}`);
    const { h } = this.mods.vue;
    return {
      name: `Stub${name}`,
      inheritAttrs: false,
      setup(_: unknown, { slots }: any) {
        return () =>
          h(
            'div',
            {
              'data-vp-stub': name,
              title: reason,
              style: 'border:1px dashed #f59e0b;background:#fffbeb;color:#92400e;padding:4px 8px;margin:2px 0;font:12px/1.4 monospace;border-radius:4px',
            },
            [h('div', { style: 'font-weight:bold' }, `<${name}>`), slots.default?.()],
          );
      },
    };
  }


  async build(file: string, stack: string[] = [], fixture: Record<string, unknown> | null = null): Promise<any> {
    if (!fixture && this.defs.has(file)) return this.defs.get(file);
    const rel = this.mods.rel(file);
    if (stack.includes(file)) return this.stub(path.basename(file, '.vue'), `circular import (${[...stack, file].map((f) => this.mods.rel(f)).join(' -> ')})`);
    if (stack.length >= this.opts.maxDepth) return this.stub(path.basename(file, '.vue'), `max depth ${this.opts.maxDepth} exceeded at ${rel}`);

    let sfc = this.compiled.get(file);
    if (!sfc) {
      const t = performance.now();
      sfc = compileSfc(this.mods, file);
      this.time.sfcCompile += performance.now() - t;
      this.compiled.set(file, sfc);
      this.deps.add(rel);
      sfc.warnings.forEach((w) => this.warn(w));
    }
    const nextStack = [...stack, file];

    // 2. imports
    const imports: Record<string, unknown> = {};
    for (const [local, info] of Object.entries(sfc.imports)) {
      imports[local] = await this.resolveImport(local, info.source, info.imported, file, nextStack);
    }

    // template tags that are not bound by an import (globally registered / auto-imported)
    const components: Record<string, unknown> = {};
    const bound = new Set(Object.keys(sfc.bindings));
    for (const tag of sfc.templateComponents) {
      if (BUILTIN_TAGS.has(tag) || bound.has(tag) || bound.has(pascal(tag))) continue;
      components[tag] = await this.resolveGlobalTag(tag, file, nextStack);
    }

    const graph = this;
    const placeholder = this.opts.placeholder;
    const def: any = {
      name: sfc.name,
      __file: sfc.rel,
      __vpOwn: true, // our own SFC: placeholders are resolved by its ctx proxy
      __scopeId: sfc.scoped ? `data-v-${sfc.id}` : undefined,
      props: Object.fromEntries(
        Object.entries(sfc.props).map(([k, p]) => [k, { type: p.types.map((t) => PROP_TYPES[t]).filter(Boolean) as any[] }]),
      ),
      emits: sfc.emits,
      components,
      setup() {
        const instance = graph.mods.vue.getCurrentInstance();
        return createCtxProxy({ sfc: sfc!, instance, imports, fixture, placeholder });
      },
      render: sfc.render,
    };
    for (const p of Object.values(def.props) as any[]) if (p.type.length === 0) p.type = null;
    if (!fixture) this.defs.set(file, def);
    return def;
  }

  private async resolveImport(local: string, spec: string, imported: string, fromFile: string, stack: string[]) {
    const projectFile = projectPath(spec, fromFile, this.opts.aliases);
    if (projectFile) {
      const target = this.findFile(projectFile);
      if (!target) return this.stub(local, `cannot resolve '${spec}' from ${this.mods.rel(fromFile)}`);
      if (target.endsWith('.vue')) {
        if (imported !== 'default') {
          // named export from an SFC (types/consts from <script>) — not executed
          this.warn(`${this.mods.rel(fromFile)}: '${imported}' from ${spec} is script code; using placeholder`);
          return createPlaceholder(local, this.opts.placeholder);
        }
        return this.build(target, stack);
      }
      this.warn(`${this.mods.rel(fromFile)}: '${local}' comes from project script ${this.mods.rel(target)}; not executed, using placeholder`);
      return createPlaceholder(local, this.opts.placeholder);
    }
    // package import: load the real thing
    try {
      const t = performance.now();
      const mod = await this.mods.importFrom(spec, fromFile);
      this.time.packageImport += performance.now() - t;
      if (imported === '*') return mod;
      if (imported === 'default') return mod.default ?? mod;
      return mod[imported];
    } catch (e) {
      const looksLikeComponent = /^[A-Z]/.test(local);
      this.warn(`${this.mods.rel(fromFile)}: failed to import '${spec}': ${(e as Error).message.split('\n')[0]}`);
      return looksLikeComponent ? this.stub(local, `import '${spec}' failed`) : createPlaceholder(local, this.opts.placeholder);
    }
  }

  private findFile(p: string): string | null {
    return firstFile([p, `${p}.vue`, `${p}.ts`, `${p}.js`, path.join(p, 'index.vue'), path.join(p, 'index.ts'), path.join(p, 'index.js')]);
  }

  private async resolveGlobalTag(tag: string, fromFile: string, stack: string[]) {
    const name = pascal(tag);
    for (const dir of this.opts.componentDirs) {
      const f = path.join(dir, `${name}.vue`);
      if (fs.existsSync(f)) return this.build(f, stack);
    }
    // registered in main.ts (app.component) or auto-imported (components.d.ts), REPORT V10: an
    // import from the root (`./src/...` resolves against it) through the same path as any import
    const ref = this.components[name];
    if (ref) {
      const [spec, exportName = 'default'] = ref.split('#');
      const def = await this.resolveImport(name, spec, exportName, path.join(this.mods.root, 'package.json'), stack);
      // a configured component that is missing is a stub with the reason, not a silent fallback
      return def ?? this.stub(tag, `'${spec}' has no export '${exportName}'`);
    }
    // PrimeVue components registered globally (e.g. via a resolver plugin)
    try {
      const mod = await this.mods.importFrom(`primevue/${name.toLowerCase()}`, fromFile);
      if (mod?.default) return mod.default;
    } catch {}
    return this.stub(tag, `unresolved component in ${this.mods.rel(fromFile)}`);
  }
}
