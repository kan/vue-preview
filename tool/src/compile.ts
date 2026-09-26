// V2: compile an SFC into a render function *without executing its script*.
// compileScript is used only to obtain binding metadata / import info; its
// generated code is statically analysed (never evaluated).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProjectModules } from './load-project-modules';
import { isPlaceholder } from './placeholder';

export const UNKNOWN = Symbol('unknown');

export interface PropInfo {
  types: string[]; // e.g. ['Boolean', 'String']
  default: unknown | typeof UNKNOWN;
}

export interface ImportInfo {
  source: string;
  imported: string; // 'default' | '*' | named
}

export interface CompiledSfc {
  file: string; // absolute
  rel: string; // root-relative
  id: string; // scope id without the data-v- prefix
  name: string;
  scoped: boolean;
  render: Function;
  props: Record<string, PropInfo>;
  emits: string[];
  bindings: Record<string, string>;
  imports: Record<string, ImportInfo>;
  /** local name -> prop name (defineModel refs, props aliases) */
  propAliases: Record<string, string>;
  /** local name bound to the whole props object (`const props = defineProps()`) */
  propsObjectNames: string[];
  /** statically evaluable initial values (`ref(1)`, `const x = {...}`) */
  literals: Record<string, unknown>;
  /** Names received from a call other than a reactivity API (`const { t } = useI18n()`). */
  fromCalls: Set<string>;
  /**
   * Names received from `useI18n()` (vue-i18n or a project's own): `const { t, locale: l } = useI18n()`
   * gives `{ t: 't', l: 'locale' }`, `const i18n = useI18n()` gives `{ i18n: 'object' }` (REPORT V13).
   */
  i18nBindings: Record<string, 't' | 'locale' | 'object'>;
  /** component tags used in the template */
  templateComponents: string[];
  styles: { css: string; scoped: boolean }[];
  warnings: string[];
}

const PROP_BINDING_TYPES = new Set(['props', 'props-aliased', 'data', 'options']);

export function scopeIdFor(rel: string) {
  return createHash('sha256').update(rel).digest('hex').slice(0, 8);
}

export function compileSfc(mods: ProjectModules, file: string): CompiledSfc {
  const { sfc } = mods;
  const rel = mods.rel(file);
  const source = fs.readFileSync(file, 'utf8');
  const warnings: string[] = [];
  const { descriptor, errors } = sfc.parse(source, { filename: file });
  for (const e of errors) warnings.push(`${rel}: parse: ${(e as Error).message}`);
  const id = scopeIdFor(rel);
  const scoped = descriptor.styles.some((s) => s.scoped);

  let bindings: Record<string, string> = {};
  let imports: Record<string, ImportInfo> = {};
  let props: Record<string, PropInfo> = {};
  let emits: string[] = [];
  const propAliases: Record<string, string> = {};
  const propsObjectNames: string[] = [];
  const literals: Record<string, unknown> = {};
  const fromCalls = new Set<string>();
  const i18nBindings: CompiledSfc['i18nBindings'] = {};

  if (descriptor.script || descriptor.scriptSetup) {
    const script = sfc.compileScript(descriptor, {
      id,
      inlineTemplate: false,
      fs: {
        fileExists: (f: string) => fs.existsSync(f),
        readFile: (f: string) => fs.readFileSync(f, 'utf8'),
        realpath: (f: string) => fs.realpathSync(f),
      },
    });
    bindings = { ...(script.bindings ?? {}) } as Record<string, string>;
    delete (bindings as any).__isScriptSetup;
    const aliases = (bindings as any).__propsAliases as Record<string, string> | undefined;
    delete (bindings as any).__propsAliases;
    if (aliases) Object.assign(propAliases, aliases);
    for (const [local, info] of Object.entries(script.imports ?? {})) {
      if ((info as any).isType) continue;
      imports[local] = { source: (info as any).source, imported: (info as any).imported };
    }
    const analysed = analyseGenerated(sfc, script.content, rel, warnings);
    props = analysed.props;
    emits = analysed.emits;
    const out = { propAliases, propsObjectNames, literals, fromCalls, i18nBindings };
    if (script.scriptSetupAst) analyseSetup(script.scriptSetupAst as any[], out);
    if (script.scriptAst) analyseSetup(script.scriptAst as any[], out);
  }

  // Route every binding through $setup so the ctx proxy decides the value
  // (props included: passed value -> fixture -> default -> placeholder).
  const templateBindings: Record<string, string> = {};
  for (const [k, t] of Object.entries(bindings)) {
    templateBindings[k] = PROP_BINDING_TYPES.has(t) ? 'setup-maybe-ref' : t;
  }

  const templateComponents = new Set<string>();
  let render: Function = () => null;
  if (descriptor.template) {
    const result = sfc.compileTemplate({
      source: descriptor.template.content,
      filename: file,
      id: `data-v-${id}`,
      // scope attributes are applied at runtime from __scopeId; the compiler's
      // scopeId option is module-mode only.
      scoped: false,
      slotted: descriptor.slotted,
      transformAssetUrls: false,
      compilerOptions: {
        mode: 'function',
        prefixIdentifiers: true,
        bindingMetadata: templateBindings as any,
        hoistStatic: false,
        cacheHandlers: false,
      },
    } as any);
    for (const e of result.errors) warnings.push(`${rel}: template: ${typeof e === 'string' ? e : e.message}`);
    collectComponents(result.ast, templateComponents);
    // Function-mode output: `const { ... } = Vue; return function render(...)`
    render = new Function('Vue', result.code)(renderHelpers(mods.vue));
  }

  const styles: CompiledSfc['styles'] = [];
  for (const style of descriptor.styles) {
    if (style.lang && !['css', 'postcss'].includes(style.lang)) {
      warnings.push(`${rel}: <style lang="${style.lang}"> is not supported; skipped`);
      continue;
    }
    const out = sfc.compileStyle({
      source: style.content,
      filename: file,
      id: `data-v-${id}`,
      scoped: !!style.scoped,
    });
    for (const e of out.errors) warnings.push(`${rel}: style: ${e.message}`);
    styles.push({ css: out.code, scoped: !!style.scoped });
  }

  return {
    file,
    rel,
    id,
    name: path.basename(file, '.vue'),
    scoped,
    render,
    props,
    emits,
    bindings,
    imports,
    propAliases,
    propsObjectNames,
    literals,
    fromCalls,
    i18nBindings,
    templateComponents: [...templateComponents],
    styles,
    warnings,
  };
}

// Placeholders are callable Proxies (typeof 'function'). Vue treats functions
// specially in two places that matter for templates, so the helpers handed to
// *our* render functions are shimmed (library components are untouched):
//  - renderList() only iterates arrays/strings/numbers/objects -> spread it
//  - SSR drops function-valued attributes -> stringify on plain elements
let helperCache: WeakMap<object, any> = new WeakMap();
function renderHelpers(vue: any) {
  if (helperCache.has(vue)) return helperCache.get(vue);
  const fixProps = (type: unknown, props: any) => {
    if (!props) return props;
    if (typeof type !== 'string') return coerceComponentProps(type, props);
    let out = props;
    for (const k in props) {
      if (k === 'class' || k === 'style' || /^on[A-Z]/.test(k) || !isPlaceholder(props[k])) continue;
      if (out === props) out = { ...props };
      out[k] = String(props[k]);
    }
    return out;
  };
  const wrapped = {
    ...vue,
    renderList: (src: any, fn: any, cache?: any, index?: number) => vue.renderList(isPlaceholder(src) ? [...src] : src, fn, cache, index),
    createElementVNode: (type: any, props: any, ...rest: any[]) => vue.createElementVNode(type, fixProps(type, props), ...rest),
    createElementBlock: (type: any, props: any, ...rest: any[]) => vue.createElementBlock(type, fixProps(type, props), ...rest),
    createVNode: (type: any, props: any, ...rest: any[]) => vue.createVNode(type, fixProps(type, props), ...rest),
    createBlock: (type: any, props: any, ...rest: any[]) => vue.createBlock(type, fixProps(type, props), ...rest),
  };
  helperCache.set(vue, wrapped);
  return wrapped;
}

/** Declared prop types of a component, following `extends` / `mixins` (PrimeVue uses BaseXxx). */
function declaredPropTypes(comp: any, out: Record<string, Function[]> = {}, depth = 0): Record<string, Function[]> {
  if (!comp || typeof comp !== 'object' || depth > 10) return out;
  declaredPropTypes(comp.extends, out, depth + 1);
  for (const m of comp.mixins ?? []) declaredPropTypes(m, out, depth + 1);
  const props = comp.props;
  if (props && !Array.isArray(props)) {
    for (const [k, v] of Object.entries<any>(props)) {
      const t = v && typeof v === 'object' && !Array.isArray(v) ? v.type : v;
      out[k] = (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'function');
    }
  }
  return out;
}

const propTypeCache = new WeakMap<object, Record<string, Function[]>>();
const camelize = (s: string) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/** Placeholders handed to (library) components are coerced to the declared prop type. */
function coerceComponentProps(type: any, props: any) {
  if (!type || typeof type !== 'object' || type.__vpOwn) return props;
  let types = propTypeCache.get(type);
  if (!types) propTypeCache.set(type, (types = declaredPropTypes(type)));
  let out = props;
  for (const k in props) {
    const v = props[k];
    if (!isPlaceholder(v)) continue;
    const t = types[camelize(k)];
    if (!t || t.length === 0 || t.includes(Function) || t.includes(Object)) continue;
    let nv: unknown = v;
    if (t.includes(Array)) nv = [...v];
    else if (t.includes(String)) nv = String(v);
    else if (t.includes(Number)) nv = 1;
    else if (t.includes(Boolean)) nv = true;
    if (nv !== v) {
      if (out === props) out = { ...props };
      out[k] = nv;
    }
  }
  return out;
}

function collectComponents(node: any, out: Set<string>) {
  if (!node) return;
  // ElementTypes.COMPONENT === 1
  if (node.type === 1 && node.tagType === 1) out.add(node.tag);
  for (const c of node.children ?? []) collectComponents(c, out);
  if (node.branches) for (const b of node.branches) collectComponents(b, out);
}

// ---------------------------------------------------------------------------
// Static analysis helpers (Babel AST). Nothing here evaluates user code.

function analyseGenerated(sfc: ProjectModules['sfc'], content: string, rel: string, warnings: string[]) {
  const props: Record<string, PropInfo> = {};
  let emits: string[] = [];
  let ast: any;
  try {
    ast = sfc.babelParse(content, { sourceType: 'module', plugins: ['typescript'] });
  } catch (e) {
    warnings.push(`${rel}: could not analyse compiled script: ${(e as Error).message}`);
    return { props, emits };
  }
  const exp = ast.program.body.find((n: any) => n.type === 'ExportDefaultDeclaration');
  let obj = exp?.declaration;
  if (obj?.type === 'CallExpression') obj = obj.arguments[0]; // _defineComponent({...})
  obj = unwrapExpression(obj);
  if (!obj || obj.type !== 'ObjectExpression') return { props, emits };
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty') continue;
    const key = keyName(p.key);
    if (key === 'props') collectProps(p.value, props);
    if (key === 'emits') emits = collectEmits(p.value);
  }
  return { props, emits };
}

function collectProps(node: any, out: Record<string, PropInfo>) {
  if (!node) return;
  if (node.type === 'CallExpression') {
    // _mergeModels(a, b) / _mergeDefaults(a, b)
    const callee = node.callee.name ?? '';
    if (/mergeDefaults/.test(callee) && node.arguments[1]?.type === 'ObjectExpression') {
      collectProps(node.arguments[0], out);
      for (const p of node.arguments[1].properties) {
        const k = keyName(p.key);
        if (k && out[k]) out[k].default = evalDefault(p.value ?? p);
      }
      return;
    }
    for (const a of node.arguments) collectProps(a, out);
    return;
  }
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements) if (el?.type === 'StringLiteral') out[el.value] = { types: [], default: UNKNOWN };
    return;
  }
  if (node.type !== 'ObjectExpression') return;
  for (const p of node.properties) {
    const k = keyName(p.key);
    if (!k || k.endsWith('Modifiers')) continue;
    const info: PropInfo = { types: [], default: UNKNOWN };
    const v = p.value;
    if (v?.type === 'ObjectExpression') {
      for (const q of v.properties) {
        const qk = keyName(q.key);
        if (qk === 'type') info.types = typeNames(q.value);
        if (qk === 'default') info.default = evalDefault(q.value ?? q);
      }
    } else {
      info.types = typeNames(v);
    }
    out[k] = info;
  }
}

function collectEmits(node: any): string[] {
  if (!node) return [];
  if (node.type === 'ArrayExpression') return node.elements.filter((e: any) => e?.type === 'StringLiteral').map((e: any) => e.value);
  if (node.type === 'ObjectExpression') return node.properties.map((p: any) => keyName(p.key)).filter(Boolean);
  if (node.type === 'CallExpression') return node.arguments.flatMap(collectEmits);
  return [];
}

function typeNames(node: any): string[] {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'ArrayExpression') return node.elements.flatMap(typeNames);
  return [];
}

function keyName(k: any): string | undefined {
  if (!k) return;
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'StringLiteral') return k.value;
}

function evalDefault(node: any): unknown {
  // `default: () => ({...})` / `default() { return ... }`
  if (node.type === 'ArrowFunctionExpression') {
    if (node.body.type !== 'BlockStatement') return evalLiteral(node.body);
    return returnOf(node.body);
  }
  if (node.type === 'ObjectMethod' || node.type === 'FunctionExpression') return returnOf(node.body);
  return evalLiteral(node);
}

function returnOf(block: any): unknown {
  const ret = block.body.find((s: any) => s.type === 'ReturnStatement');
  return ret?.argument ? evalLiteral(ret.argument) : UNKNOWN;
}

export function evalLiteral(node: any): unknown {
  if (!node) return UNKNOWN;
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NullLiteral':
      return null;
    case 'Identifier':
      return node.name === 'undefined' ? undefined : UNKNOWN;
    case 'TemplateLiteral':
      return node.expressions.length === 0 ? node.quasis.map((q: any) => q.value.cooked).join('') : UNKNOWN;
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') return -node.argument.value;
      if (node.operator === '!' ) {
        const v = evalLiteral(node.argument);
        return v === UNKNOWN ? UNKNOWN : !v;
      }
      return UNKNOWN;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return evalLiteral(node.expression);
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const el of node.elements) {
        const v = evalLiteral(el);
        if (v === UNKNOWN) return UNKNOWN;
        out.push(v);
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of node.properties) {
        if (p.type !== 'ObjectProperty' || p.computed) return UNKNOWN;
        const k = keyName(p.key) ?? (p.key.type === 'NumericLiteral' ? String(p.key.value) : undefined);
        const v = evalLiteral(p.value);
        if (k === undefined || v === UNKNOWN) return UNKNOWN;
        out[k] = v;
      }
      return out;
    }
  }
  return UNKNOWN;
}

/** The called function's name, or undefined when `n` is not a call: `ref(...)` and `Vue.ref(...)` are both `ref`. */
function calleeName(n: any): string | undefined {
  if (n?.type !== 'CallExpression') return undefined;
  const c = n.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && c.property.type === 'Identifier') return c.property.name;
}

/** Reactivity calls whose first argument is the initial value (`ref(false)`): read into `literals`. */
const LITERAL_CALLS = new Set(['ref', 'shallowRef', 'reactive', 'shallowReactive', 'readonly']);

/**
 * Calls whose result is the component's own state, not something handed over by a composable.
 * Any other call marks its names `fromCalls`. **An approximation**: a project's own state helper
 * (`useLocalStorage`) is marked too; the mark only lets callers tuck the names away.
 */
const STATE_CALLS = new Set([
  ...LITERAL_CALLS,
  'shallowReadonly', 'computed', 'toRef', 'toRefs', 'customRef', 'markRaw', 'toRaw', 'toValue', 'unref', 'useModel',
  'defineProps', 'withDefaults', 'defineModel',
]);

/** Strip type-only wrappers (`x!`, `x as T`, `x satisfies T`, `<T>x`) and `await`. */
function unwrapExpression(n: any): any {
  while (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'AwaitExpression'].includes(n?.type)) {
    n = n.type === 'AwaitExpression' ? n.argument : n.expression;
  }
  return n;
}

/** The local names a declarator pattern binds (`a`, `{ a, b: c, ...d }`, `[a, b]`). */
function patternNames(id: any): string[] {
  switch (id?.type) {
    case 'Identifier':
      return [id.name];
    case 'ObjectPattern':
      return id.properties.flatMap((p: any) => patternNames(p.type === 'RestElement' ? p.argument : p.value));
    case 'ArrayPattern':
      return id.elements.flatMap((e: any) => patternNames(e?.type === 'RestElement' ? e.argument : e));
    case 'AssignmentPattern':
      return patternNames(id.left);
    default:
      return [];
  }
}

/** What `analyseSetup` collects from `<script setup>` / `<script>` (fields of `CompiledSfc`). */
type SetupAnalysis = Pick<CompiledSfc, 'propAliases' | 'propsObjectNames' | 'literals' | 'fromCalls' | 'i18nBindings'>;

/** What `const <id> = useI18n()` binds: the `t` / `locale` members, or the whole object. */
function i18nNames(id: any): CompiledSfc['i18nBindings'] {
  if (id?.type === 'Identifier') return { [id.name]: 'object' };
  const out: CompiledSfc['i18nBindings'] = {};
  if (id?.type !== 'ObjectPattern') return out;
  for (const p of id.properties) {
    const key = p.type === 'ObjectProperty' && p.key.type === 'Identifier' ? p.key.name : undefined;
    const [local] = patternNames(p.value);
    if (local && (key === 't' || key === 'locale')) out[local] = key;
  }
  return out;
}

function analyseSetup(body: any[], out: SetupAnalysis) {
  for (const stmt of body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      const init = unwrapExpression(d.init);
      if (!init) continue;
      const callee = calleeName(init);
      // received from a call (`const { t } = useI18n()`, `const store = useStore()`, `await fetchX()`):
      // functions and stores a fixture can hardly give (REPORT V12)
      if (init.type === 'CallExpression' && !STATE_CALLS.has(callee ?? '')) patternNames(d.id).forEach((n) => out.fromCalls.add(n));
      if (callee === 'useI18n') Object.assign(out.i18nBindings, i18nNames(d.id));
      if (d.id.type !== 'Identifier') continue;
      const local = d.id.name;
      if (callee === 'defineProps' || (callee === 'withDefaults' && calleeName(init.arguments[0]) === 'defineProps')) {
        out.propsObjectNames.push(local);
      } else if (callee === 'defineModel') {
        const first = init.arguments[0];
        out.propAliases[local] = first?.type === 'StringLiteral' ? first.value : 'modelValue';
      } else if (callee && LITERAL_CALLS.has(callee)) {
        const v = init.arguments.length === 0 ? undefined : evalLiteral(init.arguments[0]);
        if (v !== UNKNOWN) out.literals[local] = v;
      } else if (decl.kind === 'const') {
        const v = evalLiteral(init);
        if (v !== UNKNOWN) out.literals[local] = v;
      }
    }
  }
}
