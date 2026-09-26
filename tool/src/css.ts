// V5: CSS collection and inlining (scoped, global, Tailwind v4, fonts).
import fs from 'node:fs';
import path from 'node:path';
import { isExternalUrl, resolveUrl } from './config';
import type { ProjectModules } from './load-project-modules';

const MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Keep only woff2 sources in @font-face when available (size), then inline url()s as data URIs.
 * A root-absolute url (`/img/a.png`) is looked up as Vite serves it from the project `root`.
 */
export function inlineUrls(css: string, baseDir: string, root: string, warn: (m: string) => void): string {
  css = css.replace(/@font-face\s*{[^}]*}/g, (block) => {
    if (!/\.woff2/.test(block)) return block;
    const srcs = [...block.matchAll(/url\([^)]*\.woff2[^)]*\)\s*format\([^)]*\)/g)].map((m) => m[0]);
    return block.replace(/\s*src\s*:[^;]*;/g, '').replace('{', `{\n  src: ${srcs.join(', ')};`);
  });
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, url: string) => {
    if (isExternalUrl(url)) warn(`external url kept in CSS: ${url}`);
    if (isExternalUrl(url) || /^(data:|#)/.test(url)) return whole;
    const file = resolveUrl(root, baseDir, url);
    if (!fs.existsSync(file)) {
      warn(`url not found: ${url} (from ${baseDir})`);
      return whole;
    }
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return `url(data:${mime};base64,${fs.readFileSync(file).toString('base64')})`;
  });
}

export function resolveCssEntry(mods: ProjectModules, entry: string): string {
  const local = path.resolve(mods.root, entry);
  if (fs.existsSync(local)) return local;
  return mods.resolve(entry, path.join(mods.root, 'package.json'));
}

export interface TailwindResult {
  css: string;
  candidates: number;
  extractor: string;
  deps: string[];
}

export async function buildTailwind(mods: ProjectModules, entry: string, html: string, warn: (m: string) => void): Promise<TailwindResult | null> {
  const twNode = await mods.optional('@tailwindcss/node');
  if (!twNode) {
    warn('@tailwindcss/node not found in project; Tailwind CSS skipped');
    return null;
  }
  const file = resolveCssEntry(mods, entry);
  const deps = new Set<string>([file]);
  const compiler = await twNode.compile(fs.readFileSync(file, 'utf8'), {
    base: path.dirname(file),
    from: file,
    onDependency: (d: string) => deps.add(d),
    shouldRewriteUrls: true,
  });

  let candidates: string[] = [];
  let extractor = 'oxide';
  try {
    const oxide = await mods.optional('@tailwindcss/oxide');
    if (!oxide) throw new Error('@tailwindcss/oxide not found');
    const scanner = new oxide.Scanner({ sources: [] });
    candidates = scanner.getCandidatesWithPositions({ content: html, extension: 'html' }).map((c: any) => c.candidate);
  } catch (e) {
    extractor = `fallback (${(e as Error).message.split('\n')[0]})`;
    candidates = extractCandidatesFallback(html);
  }
  const uniq = [...new Set(candidates)];
  let css: string = compiler.build(uniq);
  css = inlineUrls(css, path.dirname(file), mods.root, warn);
  return { css, candidates: uniq.length, extractor, deps: [...deps] };
}

/** Naive extractor: every whitespace-separated token inside class="" attributes. */
export function extractCandidatesFallback(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const tok of m[1].replace(/&amp;/g, '&').split(/\s+/)) if (tok) out.push(tok);
  }
  return out;
}
