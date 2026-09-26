#!/usr/bin/env bun
// vue-preview PoC: render a Vue SFC into a single self-contained HTML file.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEPS_DIR_ENV, ensureDepsCache, projectHasVue } from './deps-cache';
import { loadProjectModules, relPosix } from './load-project-modules';
import { ComponentGraph } from './resolve-components';
import { buildTailwind, inlineUrls, resolveCssEntry } from './css';
import { buildHtml } from './html';
import { loadConfig, readJson, resolveAliases } from './config';

declare const VUE_PREVIEW_VERSION: string;
const VERSION = typeof VUE_PREVIEW_VERSION === 'string' ? VUE_PREVIEW_VERSION : 'dev';

const USAGE = 'usage: vue-preview --version | vue-preview render <path> --root <dir> [--fixture <file>] [--json] [--out <file>] [--portal teleport|inline|off]';

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
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return;
  }
  const [cmd, target] = positionals;
  if (cmd !== 'render' || !target) {
    console.error(USAGE);
    process.exit(2);
  }
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, since: number) => (timings[name] = Math.round((performance.now() - since) * 10) / 10);

  const root = path.resolve(values.root ?? process.cwd());

  // --- dependency source -----------------------------------------------------
  // Without a usable node_modules in the project, install the locked dependencies
  // into the cache. NODE_PATH is only read at startup, so re-run ourselves with it
  // pointing there (REPORT V7); the child finds the directory in DEPS_DIR_ENV.
  const cacheDir = process.env[DEPS_DIR_ENV] || null;
  if (!cacheDir && !projectHasVue(root)) {
    try {
      process.exit(await rerunWithNodePath(ensureDepsCache(root, (m) => console.error(m))));
    } catch (e) {
      console.error(`vue-preview: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  const { config, file: configFile } = loadConfig(root);
  const warnings: string[] = [];
  const warn = (m: string) => void (warnings.includes(m) || warnings.push(m));
  const deps = new Set<string>();
  // libraries (the project's node_modules, or the dependency cache's) are not the project's files
  const addDep = (abs: string) => {
    if (!abs.split(/[\\/]/).includes('node_modules')) deps.add(relPosix(root, abs));
  };
  if (configFile) addDep(configFile);

  const aliases = resolveAliases(root, config);

  // --- module loading --------------------------------------------------------
  let t = performance.now();
  const mods = await loadProjectModules(root, cacheDir);
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
  timings['compile.sfc'] = Math.round(graph.time.sfcCompile * 10) / 10;
  timings['compile.packageImport'] = Math.round(graph.time.packageImport * 10) / 10;

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
  lap('ssr.firstRender', t);
  if (process.env.VUE_PREVIEW_BENCH_SSR) {
    // second render of the same app shape: JIT-warm SSR cost (resident-mode estimate)
    const t2 = performance.now();
    await ssr.renderToString(vue.createSSRApp(rootDef).use(primevue ?? (() => {}), { unstyled: true, pt }), {});
    lap('ssr.secondRender', t2);
  }
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
      tw.deps.forEach(addDep);
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
    ? JSON.stringify({ html, deps: [...deps].sort(), warnings, modules: mods.source, timings, tailwind: tailwindInfo, resolved: mods.resolved }, null, 2)
    : html;
  if (values.out) fs.writeFileSync(values.out, output);
  else process.stdout.write(output);
}

/** Run this same command again with `dir`'s node_modules on NODE_PATH; resolves to its exit code. */
async function rerunWithNodePath(dir: string): Promise<number> {
  // A compiled binary sees ['bun', '/$bunfs/root/…' (Windows: 'B:\~BUN\root\…'), ...args];
  // under `bun src/cli.ts` the script path must be passed again.
  const compiled = /\$bunfs|~BUN/.test(Bun.main);
  const cmd = [process.execPath, ...(compiled ? [] : [Bun.main]), ...Bun.argv.slice(2)];
  const nodePath = [path.join(dir, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  const child = Bun.spawn(cmd, {
    env: { ...process.env, NODE_PATH: nodePath, [DEPS_DIR_ENV]: dir },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  return child.exited;
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
