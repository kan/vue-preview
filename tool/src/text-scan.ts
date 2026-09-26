// Reading JavaScript source as text (app entry, vite.config) without running it (REPORT V8 / V9).
// Brackets are matched with quotes respected; this is not a parser, only enough for config literals.

/** Visit each character outside string literals, with the bracket depth before it. Return false to stop. */
function walk(text: string, start: number, visit: (i: number, ch: string, depth: number) => boolean | void) {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (visit(i, ch, depth) === false) return;
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
  }
}

/** The `{ ... }` / `[ ... ]` starting at `open` (an index of `{` or `[`), or null when it does not close. */
export function balancedBlock(text: string, open: number): string | null {
  let end = -1;
  walk(text, open, (i, ch, depth) => {
    if (depth === 1 && ')]}'.includes(ch)) {
      end = i;
      return false;
    }
  });
  return end < 0 ? null : text.slice(open, end + 1);
}

/** Split the inside of a `{...}` / `[...]` at top-level commas. */
export function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let start = 0;
  walk(inner, 0, (i, ch, depth) => {
    if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  });
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The contents of a `'...'` / `"..."` literal, or null when `s` is not exactly one. */
export function unquote(s: string): string | null {
  return /^(['"])([^'"]*)\1$/.exec(s.trim())?.[2] ?? null;
}

/** `key: value` of an object entry (the key unquoted), or null. */
export function objectEntry(part: string): [string, string] | null {
  const m = /^((['"])[^'"]+\2|[\w$@~./-]+)\s*:\s*([\s\S]+)$/.exec(part);
  return m ? [unquote(m[1]) ?? m[1], m[3].trim()] : null;
}

/**
 * Remove `/* ... *\/` and `//` comments outside string literals. **Strings must be skipped**:
 * globs such as `'src/**\/*'` in a vite config contain `/*`, and a regex-based strip would cut
 * everything up to the next `*\/` (REPORT V9).
 */
export function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += source[++i] ?? '';
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end - 1;
    } else {
      out += ch;
    }
  }
  return out;
}
