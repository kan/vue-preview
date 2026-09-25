# AGENTS.md — vue-preview 技術検証プロジェクト

## このプロジェクトの目的

Vue SFC を受け取り、簡易レンダリングした「CSS インライン済みの 1 枚 HTML」を出力する CLI ツール（仮称 `vue-preview`）の **方式が成立するかを検証する PoC** です。最終的には ADE「pike」から外部ツールとして呼ばれ、人間向けのプレビューに使われます。

このリポジトリで作るのは製品ではなく検証です。コード品質より「何が動いて何が動かないか」を明らかにすることを優先してください。最終成果物は動くプロトタイプと `REPORT.md`（検証結果）です。

## 前提となる設計（検証対象）

- ツールは TypeScript で書き、`bun build --compile` で単一バイナリにする。
- ツールは **ユーザーの `<script>` / `<script setup>` を実行しない**。テンプレートだけを render 関数にコンパイルし、値は「fixture → プレースホルダ」から供給する。
- `vue` / `@vue/compiler-sfc` / `@vue/server-renderer` / `primevue` などのライブラリは、**対象プロジェクトの node_modules から実行時に読み込む**（Vue の二重インスタンスを避けるため）。ライブラリと PrimeVue の pt 定義ファイルは実行してよい。
- SSR（`renderToString`）で HTML を生成し、scoped CSS・グローバル CSS・Tailwind 生成 CSS・アイコンフォントをすべてインライン化した 1 枚 HTML を出す。
- 対象プロジェクトは **PrimeVue v4 / unstyled モード + pass-through(pt) + Tailwind CSS v4** を想定する。
- node_modules はホストに存在せず、**公式 node イメージ（Debian 系）のコンテナ内にだけ存在する**。ツールのバイナリはホストからディレクトリごと bind mount してコンテナ内で実行する。
- ツールが扱うパスは入出力ともに **プロジェクトルート相対** で統一する。

## ディレクトリ構成

```
.
├── AGENTS.md
├── REPORT.md                 # 検証結果（エージェントが作成・更新）
├── docker-compose.yml
├── dist/                     # ビルドしたバイナリ（app コンテナに /opt/vue-preview としてマウント）
├── out/                      # 生成した HTML の出力先
├── tool/                     # vue-preview 本体（TS）
│   ├── package.json          # ツール自身の依存は最小限。vue 等はここに入れない
│   └── src/
│       ├── cli.ts
│       ├── load-project-modules.ts
│       ├── compile.ts
│       ├── ctx-proxy.ts
│       ├── resolve-components.ts
│       ├── css.ts
│       └── html.ts
└── fixture-app/              # 検証対象の Vue プロジェクト
    ├── package.json
    ├── tsconfig.json         # "@/*" → "src/*" の paths を設定
    ├── vite.config.ts        # 比較用に dev サーバを起動できる状態にしておく
    ├── vue-preview.config.json
    └── src/
        ├── main.ts           # app.use(PrimeVue, { unstyled: true, pt: preset })
        ├── pt/preset.ts      # pt 定義（main.ts から切り出したもの）
        ├── styles/main.css   # @import "tailwindcss"; など
        └── components/
            ├── UserTable.vue          # DataTable を使う
            ├── UserTable.preview.json # fixture（rows の配列など）
            ├── EditDialog.vue         # Dialog を使う（visible は fixture で制御）
            ├── EditDialog.preview.json
            ├── PageLayout.vue         # 名前付き slot を持つ自作コンポーネント
            ├── UserPage.vue           # PageLayout + UserTable + EditDialog を組み合わせる
            └── StatusBadge.vue        # scoped style と primeicons を使う小さな子
```

`fixture-app` は、PrimeVue を多用する実務プロダクトを模した構成にしてください。自作コンポーネントのネスト、`@/` エイリアスによる import、名前付き slot、`v-if` / `v-else`、`v-for`、scoped style、pt による Tailwind クラス付与を必ず含めます。

## 実行環境

すべてのコマンドは docker compose 経由で実行し、ホストで `npm install` はしないでください。

```yaml
# docker-compose.yml（目安）
services:
  app:
    image: node:22
    working_dir: /app
    volumes:
      - ./fixture-app:/app
      - app_node_modules:/app/node_modules
      - ./dist:/opt/vue-preview:ro
      - ./out:/out
    command: sleep infinity
  bun:
    image: oven/bun:1
    working_dir: /tool
    volumes:
      - ./tool:/tool
      - ./dist:/dist
    profiles: [build]
volumes:
  app_node_modules:
```

- 依存の導入: `docker compose exec app npm install`
- ビルド: `docker compose run --rm bun bun build src/cli.ts --compile --target=bun-linux-x64 --outfile /dist/vue-preview`
- 実行: `docker compose exec app /opt/vue-preview/vue-preview render src/components/UserPage.vue --root /app --json > out/UserPage.json`

`dist/` はファイル単位ではなく、ディレクトリとしてマウントしてください。バイナリを置き換えたときに、コンテナ側が古い実体を掴み続けるのを避けるためです。

## CLI インターフェース（PoC 版）

```
vue-preview render <path> --root <dir> [--fixture <file>] [--json] [--out <file>]
```

- `<path>` は `--root` からの相対パスで指定する。
- fixture は `--fixture` で指定する。省略時は `<name>.preview.json` を探し、なければプレースホルダだけで描画する。
- 出力は、通常は HTML を stdout に出す。`--json` 指定時は `{ "html": string, "deps": string[], "warnings": string[] }` を出す。`deps` は出力に影響したファイルのルート相対パス（SFC、CSS、pt 定義、fixture）。

設定ファイル `vue-preview.config.json`（ルート直下）:

```json
{
  "aliases": { "@": "src" },
  "globalCss": ["src/styles/main.css"],
  "tailwind": { "entry": "src/styles/main.css" },
  "primevue": { "unstyled": true, "pt": "src/pt/preset.ts" },
  "componentDirs": []
}
```

`aliases` は省略可能です。省略時は tsconfig の `paths` から読み取ってください。

## 検証項目

各項目について、`REPORT.md` に **結果（成立 / 条件付きで成立 / 不成立）・根拠・ハマりどころ・計測値** を記録してください。想定した API が存在しない、または挙動が違う場合は、黙って別の方法に切り替えずに、何が想定と違ったかを記録したうえで代替案を試してください。

### V1: コンパイル済みバイナリからプロジェクトのモジュールを読み込めるか

- `Bun.resolveSync(spec, root)` などを使い、ESM の条件でルートの node_modules から `vue`、`@vue/compiler-sfc`、`@vue/server-renderer`、`primevue` を解決し、動的 `import()` できるか。
- **Vue が単一インスタンスになっているか** を確認する。ツールが読み込んだ `vue` と、PrimeVue が内部で import する `vue` が同一モジュールであること（例: `createSSRApp` 経由で PrimeVue の provide/inject が正しく機能すること、解決パスが一致すること）。
- `fixture-app/src/pt/preset.ts`（TS ファイル）を、バイナリから直接 import できるか。

### V2: script を実行せずにテンプレートだけを SSR できるか

- `parse` → `compileScript`（bindingMetadata と import 情報を得るためだけに使い、生成コードは実行しない）→ `compileTemplate`（inline モードを使わず、`_ctx` / `$setup` 経由で値を参照する形）という流れで render 関数を得る。
- render 関数に渡す ctx を Proxy で構成する。値の解決順は次のとおり。
  1. 親から実際に渡された props / attrs / slots（インスタンス側の値）
  2. 解決済みの import（子コンポーネントなど）
  3. fixture の値（ルートコンポーネントのみ）
  4. `defineProps` のデフォルト値（リテラルだけ静的に取れれば十分）
  5. プレースホルダ
- プレースホルダの Proxy に持たせる振る舞い:
  - 文字列化すると `{{ foo.bar }}` のように参照式を返す。
  - プロパティアクセスを連鎖できる。
  - 関数として呼び出せる。戻り値もプレースホルダ。
  - `Symbol.iterator` で N 個（既定は 3）のプレースホルダ要素を返す。
  - `Symbol.toPrimitive` の number ヒントでは 1 を返す。
- `v-if` / `v-else`、`v-for`、補間、`v-bind` が破綻せずに描画されることを確認する。
- ユーザーの script が実行されていないことを確認する。script 内に副作用（`throw` など）を仕込んで、描画が通ることを見る。

### V3: 子コンポーネントの再帰解決

- 相対 import と `@/` エイリアスで import された `.vue` を再帰的に V2 と同じ方式でコンパイルし、親に供給する。
- パッケージからの import（`primevue/datatable` など）は本物を読み込む。
- 名前付き slot の中身が、親のコンテキストで描画されること。
- 循環参照を検知すること。再帰の深さに上限を設けること。
- 解決できないコンポーネントは、名前付きの箱（スタブ）として描画し、`warnings` に記録する。

### V4: PrimeVue v4 unstyled + pt の SSR

- `createSSRApp` に `app.use(PrimeVue, { unstyled: true, pt })` を適用して描画する。
- `UserTable.vue`（DataTable）で、fixture の行データが描画され、pt 由来の Tailwind クラスが出力 HTML に含まれること。
- `EditDialog.vue`（Dialog、fixture で `visible: true`）が描画されること。Teleport の中身は `renderToString` の ssrContext（`teleports`）から取り出して、body 末尾に差し込む。
  - **要注意**: PrimeVue の Portal がマウント後にしか描画しない実装になっていると、SSR では空になる可能性がある。その場合は実装を調べて理由を記録し、`appendTo: "self"` 相当の回避策が取れるか試す。
- PrimeVue の Volt のように、PrimeVue をラップした SFC をプロジェクト内に置く構成でも通るか（余力があれば `fixture-app` に 1 つ追加する）。

### V5: CSS のインライン化

- scoped CSS: `compileStyle` にコンポーネントの id を渡してスコープ付き CSS を生成し、描画結果の要素に `data-v-*` 属性が付くこと。
- グローバル CSS: 設定の `globalCss` を読み込んでインライン化する。
- Tailwind v4: 出力 HTML からクラス候補を抽出し、`@tailwindcss/node` の `compile(css, { base })` が返すコンパイラの `build(candidates)` で CSS を生成する。API は実際にインストールされたバージョンのソースで確認すること。ネイティブバインディング（oxide）がバイナリから読み込めるかも併せて確認し、読み込めない場合は候補抽出を自前で行う方針で進める。
- primeicons: CSS 内のフォント URL を data URI に置き換えて、アイコンが表示されること。

### V6: 出力とパフォーマンス

- 生成した HTML を `out/` に保存し、ホストのブラウザで開いて、外部リソースなしで表示できること（ネットワークリクエストが 0 であること）。
- 比較用に `fixture-app` の Vite dev サーバで同じ画面を表示し、見た目の差分を `REPORT.md` に記述する（可能ならスクリーンショットを並べる）。
- `docker compose exec` 経由の 1 回の実行時間を計測する（コールドで 5 回）。内訳として、モジュール読み込み・コンパイル・SSR・CSS 生成の時間を分けて計測し、常駐モード（`serve`）の必要性を判断する材料にする。

## スコープ外

以下はこの PoC では扱いません。必要だと判断した場合も、`REPORT.md` に提案として書くだけにしてください。

- pike との統合、常駐モード（`serve`）、`inspect` サブコマンド
- Windows / WSL / musl 向けのビルド
- PrimeVue の styled mode、v3 対応
- Chart などクライアント専用コンポーネントの対応（プレースホルダ表示で可）

## 作業ルール

- ホストに node_modules を作らない。依存の導入と実行はすべてコンテナ内で行う。
- `tool/package.json` に `vue` や `primevue` を依存として入れない（二重インスタンス検証の意味がなくなるため）。型定義が必要な場合は devDependencies に限定する。
- ユーザーの SFC の script を実行する実装に逃げない。どうしても必要に見える場合は、その理由を `REPORT.md` に記録して相談する。
- 検証項目は V1 から順に進める。V1 が不成立なら、以降に進む前に原因と代替案（例: ツールを npm パッケージとして node で実行する）を記録する。
- 小さくコミットし、各検証項目の完了時に `REPORT.md` を更新する。
