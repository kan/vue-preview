// Placeholder values: stand-ins for anything the tool cannot know statically.
import { escapeHtml } from './html';

export const PLACEHOLDER = Symbol.for('vue-preview.placeholder');

export interface PlaceholderOptions {
  iterations: number;
}

const passthroughKeys = new Set(['then', 'catch', 'finally', 'constructor', 'prototype', 'nodeType', 'render', 'setup', 'template']);

export function isPlaceholder(v: unknown): boolean {
  return (typeof v === 'function' || (typeof v === 'object' && v !== null)) && (v as any)[PLACEHOLDER] === true;
}

/**
 * A placeholder stringifies to its reference expression between two private-use characters, so
 * that the rendered HTML can be decorated afterwards (`decoratePlaceholders`): the full path
 * (`data[0].user.name`) is long, and only its last segment is shown (REPORT V11).
 */
const OPEN = '';
const CLOSE = '';
const MARKED = /([^]*)/g;

/** The last segment of a reference expression: `data[0].user.name` -> `name`, `row["a.b"]` -> `a.b`. */
export function shortExpr(expr: string): string {
  const quoted = /\["((?:[^"\\]|\\.)*)"\]$/.exec(expr);
  if (quoted) return quoted[1];
  return /([^.]+)$/.exec(expr)?.[1] ?? expr;
}

/** The style of the decorated span: the dotted underline says the full expression is on hover. */
export const PLACEHOLDER_CSS = '.vp-ph{border-bottom:1px dotted currentColor;cursor:help}';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const unescapeHtml = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
/** `{{ name }}` for an (unescaped) expression, escaped for HTML. */
const shortLabel = (expr: string) => `{{ ${escapeHtml(shortExpr(expr))} }}`;
const TAG_OR_MARKED = new RegExp(`<[^>]*>|${MARKED.source}`, 'g');

/**
 * Turn the marked placeholders in rendered HTML into `{{ name }}`. In text, a span whose
 * `title` holds the full expression (shown on hover). Where a span cannot go, the short form
 * only: inside a tag (an attribute value), in `<textarea>` (its content is text, not markup) and
 * in `<svg>` (an HTML span there is not drawn). The expression is escaped by SSR in text but not
 * through `v-html`, so it is unescaped and escaped again here.
 */
export function decoratePlaceholders(html: string): string {
  if (!html.includes(OPEN)) return html;
  let inTextarea = false;
  let svgDepth = 0;
  return html.replace(TAG_OR_MARKED, (m: string, marked: string | undefined) => {
    if (marked === undefined) {
      const [, closing, name = ''] = /^<(\/?)([\w-]+)/.exec(m) ?? [];
      const tag = name.toLowerCase();
      if (tag === 'textarea') inTextarea = !closing;
      if (tag === 'svg' && !m.endsWith('/>')) svgDepth += closing ? -1 : 1;
      return m.includes(OPEN) ? m.replace(MARKED, (_t, e: string) => shortLabel(unescapeHtml(e))) : m;
    }
    const expr = unescapeHtml(marked);
    return inTextarea || svgDepth > 0 ? shortLabel(expr) : `<span class="vp-ph" title="${escapeHtml(expr)}">${shortLabel(expr)}</span>`;
  });
}

/** The expressions of marked placeholders, without the marks. */
const stripMarks = (text: string) => text.replace(MARKED, '$1');

/** Plain `{{ full.expression }}` for text that is not HTML (warnings, tests). */
export function plainPlaceholders(text: string): string {
  return text.replace(MARKED, (_m, e: string) => `{{ ${e} }}`);
}

export function createPlaceholder(expr: string, opts: PlaceholderOptions): any {
  const label = `${OPEN}${expr}${CLOSE}`;
  const target = function placeholder() {};
  return new Proxy(target, {
    get(_t, key) {
      if (key === PLACEHOLDER) return true;
      if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? 1 : label);
      if (key === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < opts.iterations; i++) yield createPlaceholder(`${expr}[${i}]`, opts);
        };
      }
      if (typeof key === 'symbol') return undefined;
      if (key === 'toString' || key === 'toJSON') return () => label;
      if (key === 'valueOf') return () => label;
      if (key === 'length') return opts.iterations;
      // Vue / JS internals must not see a "truthy anything" here.
      if (key.startsWith('__v') || key.startsWith('__') || passthroughKeys.has(key)) return undefined;
      // indexed by another placeholder (`labels[key]`, both unknown): nest its expression, not its marks
      if (key.includes(OPEN)) return createPlaceholder(`${expr}[${stripMarks(key)}]`, opts);
      return createPlaceholder(/^[A-Za-z_$][\w$]*$/.test(key) ? `${expr}.${key}` : `${expr}[${JSON.stringify(key)}]`, opts);
    },
    apply(_t, _this, args) {
      return createPlaceholder(`${expr}(${args.length ? '…' : ''})`, opts);
    },
    construct() {
      return createPlaceholder(`new ${expr}()`, opts);
    },
    has() {
      return true;
    },
    set() {
      return true;
    },
  });
}
