// REPORT V16: variants from a Musea art file (`<Name>.art.vue`, vize). Each `<variant>` of the
// `<art>` block is a template that uses the component. The art's `<script setup>` is never
// executed: a variant becomes an in-memory SFC (the art with its `<art>` block replaced by
// `<template>`), compiled and resolved like any other SFC.
import fs from 'node:fs';
import path from 'node:path';
import { firstFile, isFile, projectPath } from './config';
import type { ProjectModules } from './load-project-modules';
import { stripComments } from './text-scan';

export interface ArtVariant {
  name: string;
  default: boolean;
  /** The variant's body: a template that uses the component. */
  template: string;
}

export interface Art {
  /** The component the art is for, as written: `defineArt('./X.vue')` or `<art component="./X.vue">`. */
  component: string | null;
  variants: ArtVariant[];
  /** The art's source before and after its `<art>` element (the component's import already added). */
  before: string;
  after: string;
}

/** Where the art file of an SFC lives: `<dir>/<Name>.art.vue`. */
export const artPathFor = (entry: string) => entry.replace(/\.vue$/, '.art.vue');

/** Musea's tag for a component path: the PascalCase file stem (`./status-badge.vue` -> `StatusBadge`). */
export function componentName(spec: string): string {
  const stem = path.basename(spec.split(/[?#]/, 1)[0]).replace(/\.[^.]*$/, '');
  return stem.replace(/(^|[-_.\s]+)(\w)/g, (_, __, c: string) => c.toUpperCase());
}

/** `defineArt('./X.vue', ...)` -> `{ source }`, `defineArt(X, ...)` -> `{ name }`. `code` has no comments. */
export function defineArtTarget(code: string): { source?: string; name?: string } {
  const source = code.match(/\bdefineArt\s*\(\s*(['"])([^'"]+)\1/);
  if (source) return { source: source[2] };
  const name = code.match(/\bdefineArt\s*\(\s*([A-Za-z_$][\w$]*)/);
  return name ? { name: name[1] } : {};
}

/**
 * Cut `source` around the `<art>` element at `artRange`, adding `importLine` at the start of
 * `<script setup>`'s content (`importAt`), or in a new `<script setup>` when there is none. The
 * new block takes `lang` (a plain `<script>`'s): compiler-sfc refuses two script languages.
 */
export function splitArt(source: string, artRange: [number, number], importAt: number | null, importLine: string | null, lang?: string) {
  const [start, end] = artRange;
  const before = source.slice(0, start);
  const after = source.slice(end);
  if (!importLine) return { before, after };
  if (importAt === null) return { before: `<script setup${lang ? ` lang="${lang}"` : ''}>\n${importLine}\n</script>\n${before}`, after };
  const insert = (text: string, at: number) => `${text.slice(0, at)}\n${importLine}\n${text.slice(at)}`;
  // `<script setup>` is either before or after the `<art>` element
  return importAt < start ? { before: insert(before, importAt), after } : { before, after: insert(after, importAt - end) };
}

/** The SFC source of one variant: the art with `<art>` replaced by the variant's template. */
export const variantSource = (art: Art, variant: ArtVariant) => `${art.before}<template>${variant.template}</template>${art.after}`;

/**
 * The component path as an import specifier. Musea resolves a path that is neither relative nor
 * absolute against the art file (`defineArt('X.vue')`); an alias (`@/...`) stays as written.
 */
export function componentSpec(spec: string, isProjectPath: (spec: string) => boolean): string {
  return spec.startsWith('.') || path.isAbsolute(spec) || isProjectPath(spec) ? spec : `./${spec}`;
}

/** Local names bound by the imports of `<script setup>` (any form: default, named, `default as`). */
function importedNames(mods: ProjectModules, content: string): Set<string> {
  try {
    const ast = mods.sfc.babelParse(content, { sourceType: 'module', plugins: ['typescript'] });
    return new Set(ast.program.body.flatMap((n: any) => (n.type === 'ImportDeclaration' ? n.specifiers.map((s: any) => s.local.name) : [])));
  } catch {
    return new Set(); // compileSfc reports the syntax error
  }
}

/** Read an art file. Problems come back as warnings (the component still renders without variants). */
export function parseArt(mods: ProjectModules, file: string, aliases: Record<string, string>): { art: Art | null; warnings: string[] } {
  const rel = mods.rel(file);
  const source = fs.readFileSync(file, 'utf8');
  const { descriptor, errors } = mods.sfc.parse(source, { filename: file });
  const warnings = errors.map((e) => `${rel}: parse: ${(e as Error).message}`);
  const block = descriptor.customBlocks.find((b) => b.type === 'art');
  if (!block) return { art: null, warnings: [...warnings, `${rel}: no <art> block`] };

  // `<variant>` elements: parse the block's content as a template to get their attributes and bodies
  const wrapped = `<template>${block.content}</template>`;
  const inner = mods.sfc.parse(wrapped, { filename: file });
  const variants: ArtVariant[] = [];
  for (const node of (inner.descriptor.template?.ast?.children ?? []) as any[]) {
    if (node.type !== 1 || node.tag !== 'variant') continue;
    const attr = (name: string) => node.props.find((p: any) => p.type === 6 && p.name === name);
    const name = attr('name')?.value?.content;
    if (!name) {
      warnings.push(`${rel}: <variant> without a name; skipped`);
      continue;
    }
    const kids = node.children as any[];
    const template = kids.length ? wrapped.slice(kids[0].loc.start.offset, kids[kids.length - 1].loc.end.offset) : '';
    variants.push({ name, default: !!attr('default'), template });
  }
  // Musea shows the first variant when none is marked default
  if (variants.length && !variants.some((v) => v.default)) variants[0].default = true;

  const setup = descriptor.scriptSetup;
  const code = stripComments(setup?.content ?? '');
  const target = defineArtTarget(code);
  const legacy = typeof block.attrs.component === 'string' ? block.attrs.component : undefined;
  const written = target.source ?? legacy;
  const component = written ? componentSpec(written, (s) => projectPath(s, file, aliases) !== null) : null;
  let importLine: string | null = null;
  if (!target.name) {
    // Musea imports the component by its file name; an art that imports it itself keeps its own import
    const tag = component && componentName(component);
    if (!tag) warnings.push(`${rel}: no defineArt() component; variants render as written`);
    else if (!/^[A-Za-z_$][\w$]*$/.test(tag)) warnings.push(`${rel}: '${tag}' (from ${component}) is not an identifier; import the component and pass it to defineArt()`);
    else if (!importedNames(mods, setup?.content ?? '').has(tag)) importLine = `import ${tag} from ${JSON.stringify(component)};`;
  }

  // the block's content sits right after the opening tag's `>` and right before `</art`
  const artRange: [number, number] = [source.lastIndexOf('<art', block.loc.start.offset), source.indexOf('>', block.loc.end.offset) + 1];
  const scriptLang = descriptor.script?.lang;
  const { before, after } = splitArt(source, artRange, setup ? setup.loc.start.offset : null, importLine, scriptLang);
  return { art: { component, variants, before, after }, warnings };
}

export interface ArtResolution {
  /** The art file next to the SFC, null without one (a dep when present). */
  file: string | null;
  /** For `--json`; null without an art file (or `<art>` block). */
  variants: { name: string; default: boolean }[] | null;
  /** The chosen variant as an in-memory SFC at the art file's path; null when the component renders by itself. */
  variantSfc: { file: string; source: string } | null;
  warnings: string[];
}

/**
 * The art file of `entry` and, when `variantName` is given, the SFC of that variant. Without an
 * art file or that variant the component renders by itself, with a warning.
 */
export function resolveArt(mods: ProjectModules, entry: string, variantName: string | undefined, aliases: Record<string, string>): ArtResolution {
  const artPath = artPathFor(entry);
  const file = isFile(artPath) ? artPath : null;
  const { art, warnings } = file ? parseArt(mods, file, aliases) : { art: null, warnings: [] };
  if (art?.component && file) {
    // the fixture is for `entry`: a variant of another component would not get it
    const named = path.isAbsolute(art.component) ? art.component : projectPath(art.component, file, aliases);
    const target = named && (firstFile([named, `${named}.vue`]) ?? named);
    if (target !== entry) warnings.push(`${mods.rel(file)}: defineArt() names ${art.component}, not ${mods.rel(entry)}; the fixture applies to ${mods.rel(entry)} only`);
  }
  let variantSfc: ArtResolution['variantSfc'] = null;
  if (variantName !== undefined) {
    const variant = art?.variants.find((v) => v.name === variantName);
    if (art && variant && file) variantSfc = { file, source: variantSource(art, variant) };
    else if (!file) warnings.push(`--variant ${variantName}: no art file ${mods.rel(artPath)}`);
    else if (art) warnings.push(`--variant ${variantName}: not in ${mods.rel(file)} (${art.variants.map((v) => v.name).join(', ')})`);
    else warnings.push(`--variant ${variantName}: ${mods.rel(file)} has no <art> block`);
  }
  return { file, variants: art ? art.variants.map((v) => ({ name: v.name, default: v.default })) : null, variantSfc, warnings };
}
