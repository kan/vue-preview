# DESIGN.md — vue-preview の設計

Vue SFC を受け取り、簡易レンダリングした「CSS インライン済みの 1 枚 HTML」を出力する CLI ツールです。最終的には ADE「pike」から外部ツールとして呼ばれ、人間向けのプレビューに使われます。

現在は **方式検証の PoC** 段階です。各方式が成立するかどうかの結果は [REPORT.md](REPORT.md) にまとめています。

## 設計の前提

- ツールは TypeScript で書き、`bun build --compile` で単一バイナリにする。
  - `--compile-autoload-package-json` が必須です。これがないと、実行時にプロジェクトの node_modules のネストした依存を解決できません（REPORT V1）。
- ツールは **ユーザーの `<script>` / `<script setup>` を実行しない**。テンプレートだけを render 関数にコンパイルし、値は fixture とプレースホルダから供給する。
- `vue` / `@vue/compiler-sfc` / `@vue/server-renderer` / `primevue` / `@tailwindcss/node` などのライブラリは、**対象プロジェクトの node_modules から実行時に読み込む**。Vue の二重インスタンスを避けるためです。
  - 実行してよいのは、ライブラリと PrimeVue の pt 定義ファイルだけです。
  - プロジェクトで `vue` を解決できないときは、**ロックファイルどおりの依存を依存キャッシュへ入れて、そこから読み込む**（後述。REPORT V7）。
- SSR（`renderToString`）で HTML を生成し、次の CSS をすべてインライン化した 1 枚 HTML を出す。
  - scoped CSS
  - グローバル CSS
  - Tailwind が生成する CSS
  - アイコンフォント
- 対象プロジェクトは **PrimeVue v4 / unstyled モード + pass-through(pt) + Tailwind CSS v4** を想定する。
- node_modules はホストに存在せず、**公式 node イメージ（Debian 系）のコンテナ内にだけ存在する**ことがある。
  - コンテナ内で実行するときは、ツールのバイナリをホストからディレクトリごと bind mount する。
  - ファイル単位でマウントすると、バイナリを置き換えたときにコンテナ側が古い実体を掴み続けます。
  - ホスト（pike のシェル）から実行するときは依存キャッシュを使う。ソースは bind mount でホストにもあるので、依存さえあれば描ける。
- バイナリは `linux-x64` / `windows-x64` / `darwin-arm64` の 3 つを配る（`scripts/build.sh`）。
- ツールが扱うパスは、入出力ともに **プロジェクトルート相対** で統一する。区切りは OS によらず `/`（scoped CSS の hash の入力にもなるため）。

## CLI

```
vue-preview render <path> [--root <dir>] [--fixture <file>] [--json] [--out <file>]
                          [--portal teleport|inline|off] [--timings]
vue-preview --version
```

- `<path>` は `--root` からの相対パスで指定する。`--root` を省略するとカレントディレクトリ。
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
    "modules": { "kind": "cache", "dir": "/root/.cache/vue-preview/deps/da28523b7762e04c" },
    "config": { "file": null, "detected": ["globalCss", "tailwind", "primevue"] },
    "inputs": {
      "props": [{ "name": "rows", "types": ["Array"] }, { "name": "compact", "types": ["Boolean"], "default": false }],
      "values": [{ "name": "mode" }, { "name": "open", "default": false }],
      "fixture": "src/components/UserTable.preview.json"
    },
    "timings": { "loadModules": 0, "compile": 0, "ssr": 0, "css": 0, "total": 0 },
    "tailwind": { "candidates": 0, "extractor": "oxide" },
    "resolved": { "vue": "/app/node_modules/vue/index.mjs" }
  }
  ```

  - `deps`: 出力に影響したファイル（SFC、CSS、pt 定義、fixture、設定）のルート相対パス。`node_modules` の中のファイル（プロジェクトのものも依存キャッシュのものも）は含めない。
  - `modules`: ライブラリの出どころ。`{ "kind": "project" }` か `{ "kind": "cache", "dir": ... }`。
  - `inputs`: fixture でルートコンポーネントに与えられるもの（REPORT V12）。呼び出し側（pike）は、これから値の入力フォームを作る。
    - `props`: 宣言された props。型と、静的に読めた既定値（`default`）。
    - `values`: props 以外にテンプレートが参照した識別子（import を除く）。描画中に記録するので、実際に使われた順に並ぶ。静的に読めた初期値（`ref(false)` など）があれば `default`。`<script setup>` で定義した関数（`setup-const` で静的な値でないもの）は JSON で与えられないので除く。
    - `fixture`: 使った fixture（ルート相対。ルートの外なら `../` で始まる）。無ければ null。
  - `html` / `deps` / `warnings` / `modules` / `inputs` が契約です。それ以外は PoC の計測用です。
- 依存キャッシュを初めて作るときは、その旨を stderr に 1 行出す（stdout は出力専用）。
- 依存を用意できないとき（ロックファイルが無い、workspaces、install の失敗）は、理由を stderr に出して終了コード 1 で終わる。
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
| `aliases` | import エイリアス → ルート相対ディレクトリ。省略時は tsconfig の `compilerOptions.paths`（`"@/*": ["src/*"]` 形式）から読み取り、それも無ければ vite.config の `resolve.alias` を**テキストとして**読む（オブジェクト形と、`find` が文字列の配列形。値の最初の文字列リテラルを置き換え先とする）。読んだ tsconfig / vite.config は `deps` に入る |
| `globalCss` | インライン化する CSS。ルート相対パスかパッケージ指定。`tailwind.entry` と同じファイルは Tailwind 側で処理する |
| `tailwind.entry` | Tailwind v4 のエントリ CSS（`@import "tailwindcss"` を含むもの） |
| `primevue.pt` | pt 定義モジュール（default export）。TS のまま import する |
| `primevue.portal` | `teleport` / `inline` / `off`。`--portal` で上書きできる |
| `componentDirs` | import されていないタグ名を `<dir>/<PascalName>.vue` から探す |
| `components` | グローバル登録や自動 import のコンポーネント。タグ名から、`./` で始まるルート相対の SFC か、パッケージ（`primevue/dialog`、名前付き export は `pkg#Name`）への対応。PascalCase にそろえて引く（`pv-button` と `PvButton` は同じ） |
| `placeholderIterations` | プレースホルダを反復したときの要素数 |
| `maxDepth` | 子コンポーネント解決の深さの上限 |

`main.ts` は実行しません。

### 設定の推測（`detect-config.ts`、REPORT V8）

設定ファイルに書かれていない（`undefined` の）キーは、vite.config（`aliases`）とアプリのエントリ（`src/main.{ts,js,mts,mjs}`）を**テキストとして読んで**推測します。読むときはコメントを除き、括弧の対応は文字列を飛ばして取ります（`text-scan.ts`）。`null` は「明示的に使わない」の意味なので推測しません。書いた値は常に推測より優先します。

| キー | 推測の仕方 |
| --- | --- |
| `globalCss` | エントリが副作用で import している `.css`（`import './style.css'`）を、並び順のまま |
| `tailwind.entry` | そのうち `@import "tailwindcss"` を含むローカルの CSS |
| `primevue` | エントリの `app.use(<primevue/config の import>, { ... })` から `unstyled` と `pt`。`pt` はその識別子の import 元のファイル（`index.js` などを補う。`{ pt }` の省略記法も読む）。エントリに無くても、package.json の依存に `primevue` があれば PrimeVue 本来の既定（`unstyled: false`）で入れる。入れないと、PrimeVue のコンポーネントが `$primevue` を読んで落ちる |
| `components` | `components.d.ts`（ルート、`src/`、`types/`、`.nuxt/` の下。unplugin-vue-components と Nuxt が生成する）の `Name: typeof import('...')['default']` と、エントリの `app.component('name', 識別子)`（識別子の import 元を辿る）。両方にあればエントリが優先 |

- エントリの相対 import と、alias（`aliases` か tsconfig の `paths`）経由の import を解決します。
- 読んだエントリは、何も推測できなかったときも `deps` に入ります（`app.use(PrimeVue, ...)` や CSS の import を足したら描き直せるように）。依存から PrimeVue を入れたときは `package.json` も入ります。推測したキーは `--json` の `config.detected` に出ます。
- コメントの中の import は数えません。`import X, { a } from` の形も読みます。

## 処理の流れ

```
cli.ts
 ├─ deps-cache.ts            ルートで vue を解決できなければ依存キャッシュを用意し、NODE_PATH 付きで自分を起動し直す
 ├─ detect-config.ts         設定ファイルに無いキーを vite.config（alias）と src/main.ts から推測する
 ├─ load-project-modules.ts  ルート（または依存キャッシュ）の node_modules から vue / compiler-sfc / server-renderer を解決・import
 ├─ resolve-components.ts    ルート SFC から import を再帰的にたどってコンポーネント定義を組み立てる
 │   ├─ compile.ts           parse → compileScript（静的解析のみ）→ compileTemplate（function モード）→ compileStyle
 │   └─ ctx-proxy.ts         setup() が返す Proxy。テンプレートの識別子の値を決める
 │       └─ placeholder.ts   未知の値の代役
 ├─ createSSRApp + PrimeVue（unstyled + pt）→ renderToString（teleports を回収）
 ├─ css.ts                   global / Tailwind（oxide で候補抽出）/ scoped、url() を data URI に置換
 └─ html.ts                  1 枚の HTML に組み立てる
```

### 依存キャッシュ（`deps-cache.ts`）

プロジェクトのルートで `vue` を解決できないとき（node_modules がコンテナの中にしか無い、など）に使います。

1. ルートのロックファイルを探す（`bun.lock` / `bun.lockb` / `package-lock.json` / `npm-shrinkwrap.json` / `yarn.lock` / `pnpm-lock.yaml` の順）。無ければエラー。package.json に `workspaces` があってもエラー。
2. package.json・ロックファイル・`.npmrc` の内容、OS と arch、bun の版からキーを作る。置き場は `<cache>/deps/<key>`。
   - `<cache>` は `VUE_PREVIEW_CACHE_DIR`、なければ Windows は `%LOCALAPPDATA%\vue-preview`、それ以外は `$XDG_CACHE_HOME/vue-preview`（既定 `~/.cache/vue-preview`）。
3. 完了の印（`.vue-preview-ok`）があれば、その mtime を更新して使う。無ければ一時ディレクトリへ 3 つのファイルをコピーする。そこで自分自身を `BUN_BE_BUN=1` の bun CLI として起動し、`install --frozen-lockfile --ignore-scripts --linker hoisted` を実行する。終わったら rename で置く。
   - rename に負けたとき（同時実行）は、先に置かれたほうを使う。
   - install のあと、30 日使われていないエントリを消す。
4. `NODE_PATH=<dir>/node_modules` と `VUE_PREVIEW_DEPS_DIR=<dir>` を付けて、同じ引数で自分を起動し直す。`NODE_PATH` は起動時にしか読まれないためです。
5. 起動し直したプロセスでは、ライブラリをキャッシュの package.json を起点に解決する。プロジェクトのファイルからの bare import は、まずそのファイルから解決し、解決できなければキャッシュから解決する。pt 定義のように native に import するファイルは、`NODE_PATH` で解決される。

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

- 文字列化すると、参照式（`foo.bar`）を私用領域の文字（U+E000 / U+E001）で挟んだ印を返す。SSR の後で `decoratePlaceholders` が印を置き換える（REPORT V11）。
  - テキストの中：`<span class="vp-ph" title="foo.bar">{{ bar }}</span>`（末尾だけを表示し、全体はホバーで出す。`.vp-ph` には点線の下線を付ける）
  - 属性値の中：`{{ bar }}`（要素を入れられないので末尾だけ）
  - 警告の文面：`{{ foo.bar }}`（全体）
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
  2. `components`（グローバル登録と自動 import。REPORT V10）
  3. `primevue/<name>`
  4. どれにもなければスタブ
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
- musl（Alpine）と linux-arm64 / darwin-x64 向けのビルド
- monorepo（workspaces）の依存キャッシュ
- PrimeVue の styled mode、v3 対応
- Chart などクライアント専用コンポーネントの対応（プレースホルダ表示で可）
