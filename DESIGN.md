# DESIGN.md — vue-preview の設計

Vue SFC を受け取り、簡易レンダリングした「CSS インライン済みの 1 枚 HTML」を出力する CLI ツールです。最終的には ADE「pike」から外部ツールとして呼ばれ、人間向けのプレビューに使われます。

現在は **方式検証の PoC** 段階です。各方式が成立するかどうかの結果は [REPORT.md](REPORT.md) にまとめています。

## 設計の前提

- ツールは TypeScript で書き、`bun build --compile` で単一バイナリにする。
  - `--compile-autoload-package-json` が必須です。これがないと、実行時にプロジェクトの node_modules のネストした依存を解決できません（REPORT V1）。
- ツールは **ユーザーの `<script>` / `<script setup>` を実行しない**。テンプレートだけを render 関数にコンパイルし、値は fixture とプレースホルダから供給する。
- `vue` / `@vue/compiler-sfc` / `@vue/server-renderer` / `primevue` / `@tailwindcss/node` などのライブラリは、**対象プロジェクトの node_modules から実行時に読み込む**。Vue の二重インスタンスを避けるためです。
  - 実行してよいのは、ライブラリと PrimeVue の pt 定義ファイルだけです。
- SSR（`renderToString`）で HTML を生成し、次の CSS をすべてインライン化した 1 枚 HTML を出す。
  - scoped CSS
  - グローバル CSS
  - Tailwind が生成する CSS
  - アイコンフォント
- 対象プロジェクトは **PrimeVue v4 / unstyled モード + pass-through(pt) + Tailwind CSS v4** を想定する。
- node_modules はホストに存在せず、**公式 node イメージ（Debian 系）のコンテナ内にだけ存在する**。
  - ツールのバイナリは、ホストからディレクトリごと bind mount してコンテナ内で実行する。
  - ファイル単位でマウントすると、バイナリを置き換えたときにコンテナ側が古い実体を掴み続けます。
- ツールが扱うパスは、入出力ともに **プロジェクトルート相対** で統一する。

## CLI

```
vue-preview render <path> --root <dir> [--fixture <file>] [--json] [--out <file>]
                          [--portal teleport|inline|off] [--timings]
vue-preview --version
```

- `<path>` は `--root` からの相対パスで指定する。
- fixture は `--fixture` で指定する。
  - 省略時は `<name>.preview.json` を探す。
  - 見つからなければプレースホルダだけで描画する。
- 出力は、通常は HTML を stdout に出す。`--out` を指定した場合はファイルに書く。
- `--json` を指定すると、次の形式で出力する。

  ```json
  {
    "html": "...",
    "deps": ["src/components/UserPage.vue", "..."],
    "warnings": ["..."],
    "timings": { "loadModules": 0, "compile": 0, "ssr": 0, "css": 0, "total": 0 },
    "tailwind": { "candidates": 0, "extractor": "oxide" },
    "resolved": { "vue": "/app/node_modules/vue/index.mjs" }
  }
  ```

  - `deps`: 出力に影響したファイル（SFC、CSS、pt 定義、fixture、設定）のルート相対パス。
  - `html` / `deps` / `warnings` が契約です。それ以外は PoC の計測用です。
- `--portal`: PrimeVue の Portal の扱い（後述）。既定は `teleport`。
- `--timings`: 計測値を stderr に出す。

## 設定ファイル `vue-preview.config.json`（ルート直下）

```json
{
  "aliases": { "@": "src" },
  "globalCss": ["src/styles/main.css", "primeicons/primeicons.css"],
  "tailwind": { "entry": "src/styles/main.css" },
  "primevue": { "unstyled": true, "pt": "src/pt/preset.ts", "portal": "teleport" },
  "componentDirs": [],
  "placeholderIterations": 3,
  "maxDepth": 20
}
```

| キー | 説明 |
| --- | --- |
| `aliases` | import エイリアス → ルート相対ディレクトリ。省略時は tsconfig の `compilerOptions.paths`（`"@/*": ["src/*"]` 形式）から読み取る |
| `globalCss` | インライン化する CSS。ルート相対パスかパッケージ指定。`tailwind.entry` と同じファイルは Tailwind 側で処理する |
| `tailwind.entry` | Tailwind v4 のエントリ CSS（`@import "tailwindcss"` を含むもの） |
| `primevue.pt` | pt 定義モジュール（default export）。TS のまま import する |
| `primevue.portal` | `teleport` / `inline` / `off`。`--portal` で上書きできる |
| `componentDirs` | import されていないタグ名を `<dir>/<PascalName>.vue` から探す |
| `placeholderIterations` | プレースホルダを反復したときの要素数 |
| `maxDepth` | 子コンポーネント解決の深さの上限 |

`main.ts` は実行しません。そこで import している CSS（例: `primeicons/primeicons.css`）は、`globalCss` に列挙してください。

## 処理の流れ

```
cli.ts
 ├─ load-project-modules.ts  ルートの node_modules から vue / compiler-sfc / server-renderer を解決・import
 ├─ resolve-components.ts    ルート SFC から import を再帰的にたどってコンポーネント定義を組み立てる
 │   ├─ compile.ts           parse → compileScript（静的解析のみ）→ compileTemplate（function モード）→ compileStyle
 │   └─ ctx-proxy.ts         setup() が返す Proxy。テンプレートの識別子の値を決める
 │       └─ placeholder.ts   未知の値の代役
 ├─ createSSRApp + PrimeVue（unstyled + pt）→ renderToString（teleports を回収）
 ├─ css.ts                   global / Tailwind（oxide で候補抽出）/ scoped、url() を data URI に置換
 └─ html.ts                  1 枚の HTML に組み立てる
```

### SFC のコンパイル（`compile.ts`）

- `compileScript` は、bindingMetadata・import 情報・props 宣言を得るためだけに使います。**生成コードは実行しません。** props の `type` と、リテラルの `default` は Babel AST から静的に読み取ります。
- `compileTemplate` は非 inline・`mode: 'function'` でコンパイルし、`new Function('Vue', code)` で render 関数を得ます。
- bindingMetadata の `props` / `props-aliased` / `data` / `options` は `setup-maybe-ref` に書き換えます。こうすると、テンプレートからの参照がすべて `$setup.x` 経由になり、ctx Proxy が値を決められます。
- render 関数に渡す `Vue` は、次の 2 点を補正したシムです。
  - プレースホルダを `renderList` で反復できるようにする。
  - 要素の属性やライブラリコンポーネントの props に渡すプレースホルダを、宣言された型へ変換する。

### 値の解決順（`ctx-proxy.ts`）

1. 親から実際に渡された props（`vnode.props` にキーがある場合のみ）
2. 解決済みの import（子コンポーネント、ライブラリの値）
3. fixture の値（ルートコンポーネントのみ）
4. `defineProps` / `defineModel` のデフォルト値（リテラルのみ）。Boolean 型でデフォルトがない場合は `false`
5. 静的に評価できるリテラルの初期値（`ref(false)`、`const labels = { ... }`）
6. プレースホルダ

### プレースホルダ（`placeholder.ts`）

- 文字列化すると `{{ foo.bar }}` のように参照式を返す。
- プロパティアクセスを連鎖できる。
- 関数として呼び出せる。戻り値もプレースホルダ。
- `Symbol.iterator` で N 個（既定 3）のプレースホルダ要素を返す。`length` も N。
- `Symbol.toPrimitive` の number ヒントでは 1 を返す。
- `then` / `__v*` などには `undefined` を返す。Promise や Vue 内部の値と誤認させないためです。

### 子コンポーネントの解決（`resolve-components.ts`）

- 相対 import とエイリアス経由の `.vue` は、再帰的に同じ方式でコンパイルする。
- パッケージからの import は本物を読み込む。
- プロジェクト内の `.ts` / `.js` は実行せず、プレースホルダにして warning を出す。
- import されていないタグは、次の順に探す。
  1. `componentDirs`
  2. `primevue/<name>`
  3. どちらにもなければスタブ
- 循環参照と深さの上限超過はスタブにして、warning に記録する。
- スタブは `data-vp-stub="<Name>"` を持つ破線の箱として描画し、既定 slot の中身も表示する。

### PrimeVue の Portal

PrimeVue の Portal は `mounted` になるまで何も描画しません。そのため、そのままでは SSR で Dialog などが空になります。そこで、`primevue/portal` の default export を実行時に書き換えます。

| モード | 動作 |
| --- | --- |
| `teleport`（既定） | `data.mounted` を最初から true にする。`<Teleport>` の中身を `ssrContext.teleports` から回収し、body 末尾に差し込む |
| `inline` | `computed.inline` を常に true にする（`appendTo: "self"` と同じ扱い） |
| `off` | 書き換えない（Portal の中身は描画されない） |

### CSS（`css.ts`）

- scoped: `compileStyle` にルート相対パスのハッシュ（`data-v-xxxxxxxx`）を渡し、コンポーネントに `__scopeId` を持たせる。
- Tailwind v4: `@tailwindcss/node` の `compile(css, { base, from, onDependency })` → `build(candidates)` で生成する。
  - 候補は、出力 HTML から `@tailwindcss/oxide` の `Scanner.getCandidatesWithPositions` で抽出する。
  - oxide が使えない場合は、class 属性を分割する方式にフォールバックする。
- `url()` は data URI に置き換える。`@font-face` に woff2 があれば woff2 だけを残す。

## スコープ外（提案として REPORT.md に記録）

- pike との統合、常駐モード（`serve`）、`inspect` サブコマンド
- Windows / WSL / musl 向けのビルド
- PrimeVue の styled mode、v3 対応
- Chart などクライアント専用コンポーネントの対応（プレースホルダ表示で可）
