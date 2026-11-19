// TS types of the props declared by type (`defineProps<T>()`, `defineModel<T>()`), for `inputs`
// (REPORT V17). compileScript turns them into runtime types (`String`), which lose a union of
// literals; here they are read from the type declarations with compiler-sfc's
// resolveTypeElements (the API it exposes to language tools). Nothing is executed.
import fs from 'node:fs';
import type { ProjectModules } from './load-project-modules';

export type Literal = string | number | boolean;

export interface PropTsType {
  /** The type as written (`'a' | 'b'`, `User[]`); an imported name stays a name */
  tsType: string;
  /** The members of a union of literals, through type aliases */
  options?: Literal[];
}

/** How compiler-sfc reads files: compileScript, and the type resolution here */
export const typeFs = {
  fileExists: (f: string) => fs.existsSync(f),
  readFile: (f: string) => fs.readFileSync(f, 'utf8'),
  realpath: (f: string) => fs.realpathSync(f),
};

/** The prop a `defineModel()` call declares */
export const modelName = (call: any): string => (call.arguments[0]?.type === 'StringLiteral' ? call.arguments[0].value : 'modelValue');

/**
 * Follow type aliases of a scope (at most `depth` hops). Stops at the last name the scope does not
 * declare (an imported one), or at the first type that is not a plain name.
 */
function followAliases(node: any, lookup: (name: string) => any, depth = 5): any {
  for (let i = 0; i < depth && isPlainRef(node); i++) {
    const found = lookup(node.typeName.name);
    if (!found) return node;
    // the scope records an alias by its right-hand side
    node = found.type === 'TSTypeAliasDeclaration' ? found.typeAnnotation : found;
  }
  return isPlainRef(node) ? undefined : node; // a cycle, or too deep
}

/** The literal members of `node`, following type aliases of its scope. */
export function literalOptions(node: any, lookup: (name: string) => any): Literal[] | undefined {
  return unionLiterals(followAliases(node, lookup));
}

function unionLiterals(node: any): Literal[] | undefined {
  if (node?.type === 'TSParenthesizedType') node = node.typeAnnotation;
  if (node?.type !== 'TSUnionType') return undefined;
  const out: Literal[] = [];
  for (const t of node.types) {
    const lit = t.type === 'TSLiteralType' ? t.literal : null;
    if (lit?.type === 'StringLiteral' || lit?.type === 'NumericLiteral' || lit?.type === 'BooleanLiteral') out.push(lit.value);
    else if (lit?.type === 'UnaryExpression' && lit.operator === '-' && lit.argument.type === 'NumericLiteral') out.push(-lit.argument.value);
    else return undefined;
  }
  return out;
}

const isPlainRef = (node: any) => node?.type === 'TSTypeReference' && node.typeName.type === 'Identifier' && !node.typeParameters;

const member = (type: any) => ({ type: 'TSPropertySignature', key: { type: 'Identifier', name: 'model' }, typeAnnotation: { type: 'TSTypeAnnotation', typeAnnotation: type } });

/** The `defineProps<T>()` / `defineModel<T>()` calls at the top level of `<script setup>` */
function typedMacros(body: any[]): { call: any; type: any }[] {
  const out: { call: any; type: any }[] = [];
  const take = (e: any) => {
    while (e?.type === 'TSAsExpression' || e?.type === 'TSNonNullExpression' || e?.type === 'AwaitExpression') e = e.expression ?? e.argument;
    if (e?.type !== 'CallExpression' || e.callee.type !== 'Identifier') return;
    if (e.callee.name === 'withDefaults') return take(e.arguments[0]);
    const type = e.typeParameters?.params[0];
    if (type && (e.callee.name === 'defineProps' || e.callee.name === 'defineModel')) out.push({ call: e, type });
  };
  for (const stmt of body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type === 'ExpressionStatement') take(decl.expression);
    if (decl?.type === 'VariableDeclaration') decl.declarations.forEach((d: any) => take(d.init));
  }
  return out;
}

/**
 * Prop name -> TS type, for the props `<script setup>` declares by type. `ast` is compileScript's
 * `scriptSetupAst`, whose offsets are into `source` (the block's content). A declaration the resolver
 * cannot follow (a generic component, a type from a package it cannot read) gives nothing: the
 * runtime types in `inputs` stay.
 */
export function propTsTypes(
  mods: ProjectModules,
  file: string,
  setup: { content: string; ast: any[] },
  script: { content: string; ast: any[] } | null,
): { types: Record<string, PropTsType>; deps: Set<string> } {
  const { sfc } = mods;
  const out: Record<string, PropTsType> = {};
  const { content: source, ast } = setup;
  // compileScript's scope holds both scripts of the SFC under setup's offset, but the nodes of a
  // plain `<script>` are placed in its own content
  const inScript = new WeakSet<object>();
  const mark = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(mark);
    if (typeof n.type !== 'string') return;
    inScript.add(n);
    for (const k in n) if (k !== 'loc' && !k.startsWith('_')) mark(n[k]);
  };
  if (script) mark(script.ast);
  const deps = new Set<string>();
  const ctx: any = {
    filename: file,
    source,
    ast,
    options: { fs: typeFs },
    error: (msg: string) => {
      throw new Error(msg);
    },
    helper: (k: string) => `_${k}`,
    getString: (n: any) => source.slice(n.start, n.end),
    propsDestructuredBindings: {},
    isCE: false,
    deps, // files read to resolve imported types
  };
  const resolve = (type: any, scope?: any): Record<string, any> => {
    try {
      return sfc.resolveTypeElements(ctx, type, scope).props;
    } catch {
      return {};
    }
  };
  /** Strings of an alias the scope only imports: compiler-sfc expands `{ [K in T]: ... }` through imports */
  const importedOptions = (t: any, scope: any): Literal[] | undefined => {
    if (!isPlainRef(t) || !scope?.imports?.[t.typeName.name]) return undefined;
    const keys = Object.keys(resolve({ type: 'TSMappedType', typeParameter: { type: 'TSTypeParameter', name: 'K', constraint: t } }, scope));
    return keys.length ? keys : undefined;
  };
  const describe = (sig: any): PropTsType | null => {
    // a method (`onSave(id: string): void`) has its return type there; `types` says Function
    if (sig?.type !== 'TSPropertySignature') return null;
    const t = sig.typeAnnotation?.typeAnnotation;
    if (!t) return null;
    const scope = sig._ownerScope;
    let tsType: string;
    if (script && inScript.has(t)) tsType = script.content.slice(t.start, t.end);
    else {
      // defineProps' type was already resolved (and cached on the node) by compileScript, whose
      // scope holds the whole SFC: `offset` is where `<script setup>` starts in it
      const offset = scope?.offset ?? 0;
      tsType = (scope?.source ?? source).slice(t.start + offset, t.end + offset);
    }
    const end = followAliases(t, (name) => scope?.types?.[name]);
    return { tsType, options: unionLiterals(end) ?? importedOptions(end, scope) };
  };
  for (const { call, type } of typedMacros(ast)) {
    if (call.callee.name === 'defineProps') {
      for (const [name, sig] of Object.entries(resolve(type))) {
        const d = describe(sig);
        if (d) out[name] = d;
      }
    } else {
      // a lone type, resolved in the file's scope as the one member of a type literal
      const d = describe(resolve({ type: 'TSTypeLiteral', members: [member(type)] }).model);
      if (d) out[modelName(call)] = d;
    }
  }
  return { types: out, deps };
}
