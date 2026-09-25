#!/usr/bin/env bun
// vue-preview PoC: render a Vue SFC into a single self-contained HTML file.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadProjectModules } from './load-project-modules';
import { ComponentGraph } from './resolve-components';
import { buildTailwind, inlineUrls, resolveCssEntry } from './css';
import { buildHtml } from './html';

interface Config {
  aliases?: Record<string, string>;
  globalCss?: string[];
  tailwind?: { entry: string } | null;
  primevue?: { unstyled?: boolean; pt?: string; portal?: 'teleport' | 'inline' | 'off' } | null;
  componentDirs?: string[];
  placeholderIterations?: number;
  maxDepth?: number;
}

const USAGE = 'usage: vue-preview render <path> --root <dir> [--fixture <file>] [--json] [--out <file>] [--portal teleport|inline|off]';

function readJson(file: string) {
  // tsconfig allows comments / trailing commas
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    return new Function(`return (${text})`)();
  }
}

function aliasesFromTsconfig(root: string): Record<string, string> {
  const file = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(file)) return {};
  const tsconfig = readJson(file);
  const base = path.resolve(root, tsconfig.compilerOptions?.baseUrl ?? '.');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries<string[]>(tsconfig.compilerOptions?.paths ?? {})) {
    if (!k.endsWith('/*') || !v[0]?.endsWith('/*')) continue;
    out[k.slice(0, -2)] = path.resolve(base, v[0].slice(0, -2));
  }
  return out;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      fixture: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      portal: { type: 'string' },
      timings: { type: 'boolean', default: false },
    },
  });
  const [cmd, target] = positionals;
  if (cmd !== 'render' || !target) {
    console.error(USAGE);
    process.exit(2);
  }
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, since: number) => (timings[name] = Math.round((performance.now() - since) * 10) / 10);

  const root = path.resolve(values.root ?? process.cwd());
  const configFile = path.join(root, 'vue-preview.config.json');
  const config: Config = fs.existsSync(configFile) ? readJson(configFile) : {};
  const warnings: string[] = [];
  const warn = (m: string) => void (warnings.includes(m) || warnings.push(m));
  const deps = new Set<string>();
  const addDep = (abs: string) => deps.add(path.relative(root, abs));
  if (fs.existsSync(configFile)) addDep(configFile);

  const aliases = config.aliases
    ? Object.fromEntries(Object.entries(config.aliases).map(([k, v]) => [k, path.resolve(root, v)]))
    : aliasesFromTsconfig(root);

  // --- module loading --------------------------------------------------------
  let t = performance.now();
  const mods = await loadProjectModules(root);
  const { vue, ssr } = mods;
  let primevue: any = null;
  let pt: any = undefined;
  if (config.primevue) {
    primevue = (await mods.importFrom('primevue/config', path.join(root, 'package.json'))).default;
    if (config.primevue.pt) {
      const ptFile = path.resolve(root, config.primevue.pt);
      pt = (await import(ptFile)).default;
      addDep(ptFile);
    }
  }
  lap('loadModules', t);

  // --- compile ---------------------------------------------------------------
  t = performance.now();
  const entry = path.resolve(root, target);
  const fixtureFile = values.fixture
    ? path.resolve(root, values.fixture)
    : entry.replace(/\.vue$/, '.preview.json');
  let fixture: Record<string, unknown> = {};
  if (fs.existsSync(fixtureFile)) {
    fixture = readJson(fixtureFile);
    addDep(fixtureFile);
  } else if (values.fixture) {
    warn(`fixture not found: ${values.fixture}`);
  }
  const graph = new ComponentGraph(mods, {
    aliases,
    componentDirs: (config.componentDirs ?? []).map((d) => path.resolve(root, d)),
    maxDepth: config.maxDepth ?? 20,
    placeholder: { iterations: config.placeholderIterations ?? 3 },
  });
  const rootDef = await graph.build(entry, [], fixture);
  lap('compile', t);

  // --- SSR -------------------------------------------------------------------
  t = performance.now();
  const app = vue.createSSRApp(rootDef);
  app.config.warnHandler = (msg: string, _i: unknown, trace: string) => warn(`vue: ${msg}${trace ? ' ' + trace.trim().split('\n')[0] : ''}`);
  app.config.errorHandler = (err: unknown, _i: unknown, info: string) => warn(`vue error (${info}): ${(err as Error)?.stack?.split('\n').slice(0, 2).join(' | ') ?? err}`);
  if (primevue) {
    app.use(primevue, { unstyled: config.primevue?.unstyled ?? true, pt });
    const portalMode = (values.portal as string) ?? config.primevue?.portal ?? 'teleport';
    const Portal = (await mods.importFrom('primevue/portal', path.join(root, 'package.json'))).default;
    if (portalMode === 'teleport') {
      // PrimeVue's Portal renders nothing until mounted (client only). Pretend it is mounted
      // so it emits a real <Teleport>, whose content SSR collects in ctx.teleports.
      const origData = Portal.data;
      Portal.data = function () {
        return { ...(origData?.call(this) ?? {}), mounted: true };
      };
    } else if (portalMode === 'inline') {
      Portal.computed = { ...Portal.computed, inline: () => true };
    }
  }
  const ctx: any = {};
  const body = await ssr.renderToString(app, ctx);
  const teleports = Object.entries<string>(ctx.teleports ?? {})
    .map(([to, html]) => `<!-- teleport:${to} -->${html}`)
    .join('\n');
  lap('ssr', t);

  // --- CSS -------------------------------------------------------------------
  t = performance.now();
  const css: { label: string; css: string }[] = [];
  const twEntry = config.tailwind?.entry ? resolveCssEntry(mods, config.tailwind.entry) : null;
  for (const g of config.globalCss ?? []) {
    let file: string;
    try {
      file = resolveCssEntry(mods, g);
    } catch {
      warn(`globalCss not found: ${g}`);
      continue;
    }
    if (file === twEntry) continue; // compiled by Tailwind below
    css.push({ label: `global:${g}`, css: inlineUrls(fs.readFileSync(file, 'utf8'), path.dirname(file), warn) });
    addDep(file);
  }
  let tailwindInfo: any = null;
  if (twEntry) {
    const tw = await buildTailwind(mods, config.tailwind!.entry, body + teleports, warn);
    if (tw) {
      css.push({ label: 'tailwind', css: tw.css });
      tw.deps.filter((d) => !d.includes('node_modules')).forEach(addDep);
      tailwindInfo = { candidates: tw.candidates, extractor: tw.extractor };
    }
  }
  for (const s of graph.compiled.values()) {
    for (const st of s.styles) css.push({ label: `${s.scoped ? 'scoped' : 'sfc'}:${s.rel}`, css: st.css });
  }
  lap('css', t);

  graph.deps.forEach((d) => deps.add(d));
  graph.warnings.forEach(warn);
  const html = buildHtml({ title: `preview: ${target}`, css, body, teleports });
  lap('total', t0);

  if (values.timings) console.error(JSON.stringify({ timings, tailwind: tailwindInfo, resolved: mods.resolved }));
  const output = values.json
    ? JSON.stringify({ html, deps: [...deps].sort(), warnings, timings, tailwind: tailwindInfo, resolved: mods.resolved }, null, 2)
    : html;
  if (values.out) fs.writeFileSync(values.out, output);
  else process.stdout.write(output);
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
