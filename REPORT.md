# vue-preview PoC 検証レポート

検証日: 2026-09-25
検証環境: Linux x64 / Docker 29.3 / `node:22`（Debian）/ `oven/bun:1`（Bun 1.4.2）

| パッケージ | バージョン（fixture-app にインストール） |
| --- | --- |
| vue / @vue/compiler-sfc / @vue/server-renderer | 3.5.43 |
| primevue | 4.5.5（unstyled + pt） |
| tailwindcss / @tailwindcss/node / @tailwindcss/oxide | 4.3.3 |
| primeicons | 7.0.0 |
| vite / @vitejs/plugin-vue | 7.3.6 / 6.0.9 |

## サマリ

| 項目 | 結果 | 一言 |
| --- | --- | --- |
| V1 バイナリからのモジュール読み込み | **条件付きで成立** | `--compile-autoload-package-json` を付けてビルドすれば成立する。付けないとネストした依存を解決できない |
| V2 script を実行しないテンプレート SSR | **成立** | 全 binding を `$setup` に寄せ、ctx Proxy で値を供給する。プレースホルダ用に Vue ヘルパーを 2 系統シムした |
| V3 子コンポーネントの再帰解決 | **成立** | 相対 / `@/` / パッケージ import、名前付き slot、循環検知、深さ上限、スタブ化を確認 |
| V4 PrimeVue v4 unstyled + pt の SSR | **条件付きで成立** | DataTable は問題なし。Dialog は Portal が SSR で空になるため、Portal にパッチを当てる必要がある |
| V5 CSS インライン化 | **成立** | scoped / global / Tailwind v4（oxide ネイティブも可）/ primeicons の data URI 化 |
| V6 出力とパフォーマンス | **成立** | 外部リクエスト 0 件。Vite との画素差分は 0〜0.04%。1 回あたり約 0.6〜1.0 秒 |

結論として、この方式は成立します。前提から外れた点は 2 つあります。

1. `bun build --compile` にフラグを 1 つ追加する必要がある（V1）。
2. PrimeVue の Portal を実行時にパッチする必要がある（V4）。

どちらも回避策が確立しており、設計の根幹は変わりません。

---

## 実行方法

```sh
docker compose up -d app
docker compose exec app npm install          # node_modules は named volume の中だけ
./build.sh                                   # = docker compose run --rm bun bun build src/cli.ts --compile --compile-autoload-package-json ...
docker compose exec app /opt/vue-preview/vue-preview render src/components/UserPage.vue --root /app --json > out/UserPage.json
./render.sh src/components/UserPage.vue      # 補助: JSON と HTML を out/ に書き出し、warnings/deps/timings を表示
```

- AGENTS.md 記載の `docker-compose.yml` をそのまま使っています。検証サンドボックスではコンテナの外部通信にホストのプロキシが必要だったため、`docker-compose.override.yml`（git 管理外）で `network_mode: host`、`HTTPS_PROXY`、CA を追加しました。通常の環境ではこのファイルは不要です。
- 比較用の Vite dev サーバは `docker compose exec app npx vite --host 0.0.0.0` で起動し、`http://localhost:5173/compare.html?c=UserTable` を開きます（`src/compare.ts` が fixture と同じデータで 1 コンポーネントをマウントします）。

CLI（PoC 版）の追加オプション:
- `--portal teleport|inline|off`: V4 の Portal の扱い（既定は teleport）
- `--timings`: 計測値を stderr に出す（`--json` の出力には常に `timings` を含める）
- JSON 出力には、仕様の `html` / `deps` / `warnings` に加えて、`timings` / `tailwind` / `resolved`（解決したモジュールパス）を含めています。

---

## V1: コンパイル済みバイナリからプロジェクトのモジュールを読み込めるか

**結果: 条件付きで成立**（`bun build --compile --compile-autoload-package-json` が必須）

### 根拠
- `Bun.resolveSync(spec, "<root>/")` で解決し、動的 `import()` で読み込めました。`vue` は `/app/node_modules/vue/index.mjs`（ESM 条件）に解決されます。

  ```json
  "vue": "/app/node_modules/vue/index.mjs",
  "@vue/compiler-sfc": "/app/node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js",
  "@vue/server-renderer": "/app/node_modules/@vue/server-renderer/index.js",
  "vue (from @vue/server-renderer)": "/app/node_modules/vue/index.mjs",
  "vue (from primevue/config)": "/app/node_modules/vue/index.mjs"
  ```
- **Vue は単一インスタンス**
  - ツール、`@vue/server-renderer`、`primevue` の 3 か所から `vue` を解決すると、同じファイルになりました。
  - プローブで比べた結果、ツールが import した `vue` と primevue 側から解決した `vue` は、モジュール名前空間オブジェクトとして同一でした（`===` が true）。
  - `createSSRApp(...).use(PrimeVue, { unstyled: true, pt })` のあと、PrimeVue 内部の `inject` 経由で `$primevue.config.pt` が参照され、pt のクラスが出力 HTML に反映されました。インスタンスが二重なら `getCurrentInstance()` が別物になり、ここは機能しません。
- `fixture-app/src/pt/preset.ts`（TS）は、バイナリから `import("/app/src/pt/preset.ts")` で直接読み込めました。Bun が実行時にトランスパイルします。

### ハマりどころ（想定との違い）
- **`--compile` の既定ビルドでは、ネストした依存の bare specifier を解決できない。**
  - トップレベルの `Bun.resolveSync('vue', root)` は成功します。ところが `vue` の読み込み中に `compiler-core` が `require('@babel/parser')` した時点で `Cannot find module` になりました。`primevue/datatable` → `@primeuix/utils` も同じ失敗です。
  - 同じコードを `bun run` で実行すると成功します。したがって問題はコンパイル済みバイナリに固有です。
  - 原因: `bun build --help` によると `--compile-autoload-package-json` の既定値が **false** で、スタンドアロン実行ファイルは実行時に package.json を読みません。そのため `exports` / `main` を解いてパッケージを特定できていませんでした。
  - `--compile-autoload-package-json` を付けてビルドすると、すべて解決できました。`NODE_PATH` を指定しても効果はありませんでした。
  - 代替案（ツールを npm パッケージとして node / bun で実行する）は、今回は不要になりました。
- `vue/index.js` は `process.env.NODE_ENV` で dev / prod ビルドを切り替えます。バイナリでは未設定なので、**dev ビルド**（警告あり）が読み込まれます。警告は `app.config.warnHandler` で `warnings` に集約しています。
- バイナリのサイズは約 81 MB（Bun ランタイム込み）です。

### 計測値
- `loadModules`（vue, compiler-sfc, server-renderer, primevue/config, pt preset）: warm で約 90〜105 ms、drop_caches 後で約 130〜160 ms。

---

## V2: script を実行せずにテンプレートだけを SSR できるか

**結果: 成立**

### 方式
1. `parse` → `compileScript(descriptor, { inlineTemplate: false, fs })` で次を得ます。生成コードは**実行しません**。
   - `bindings`（bindingMetadata）
   - `imports`（ローカル名 → source / imported）
   - props 宣言: 生成コード中の `props: {...}` を Babel AST で静的解析します。`type` と、リテラルの `default` だけを取り出します。`_mergeDefaults` / `_mergeModels` にも対応しています。
   - `scriptSetupAst` から、`defineModel` のローカル名 → prop 名と、`const props = defineProps()` のローカル名
2. `compileTemplate` は非 inline で呼び、`compilerOptions: { mode: 'function', prefixIdentifiers: true, bindingMetadata }` を渡します。
   - 生成されるのは `const {...} = Vue; return function render(_ctx, _cache, $props, $setup, ...)` という形です。`new Function('Vue', code)(vue)` で render 関数を取り出すので、一時ファイルは要りません。
   - **bindingMetadata のうち `props` / `props-aliased` / `data` / `options` は `setup-maybe-ref` に書き換えます。** こうするとテンプレートからの参照がすべて `$setup.x` になり、ctx Proxy が値の出どころを一元的に決められます。
3. `setup()` から ctx Proxy を返します。値の解決順は次のとおりです。
   1. 親から実際に渡された props（`vnode.props` にキーがある場合だけ `instance.props` を採用）
   2. 解決済みの import（子コンポーネント、ライブラリの値）
   3. fixture（ルートコンポーネントのみ）
   4. `defineProps` のデフォルト値（リテラルのみ）。Boolean 型でデフォルトがない場合は `false`（Vue の Boolean キャストに合わせる）
   5. **（追加）静的リテラルの初期値**: `ref(false)`、`ref([])`、`const labels = { ... }` のように、リテラルとして静的に評価できるもの。これはスコープの拡張です。StatusBadge の `icons[status]` のようなラベル表や、`dialogVisible = ref(false)` を再現するために入れました。
   6. プレースホルダ
4. `$props.x` の代わりに `props.x`（`const props = defineProps()`）と書かれていても、同じ順序で解決します。

### プレースホルダ
`placeholder.ts`: 関数を target にした Proxy です。
- 文字列化すると `{{ order.items[0].name }}` のような参照式になります。
- プロパティアクセスを連鎖でき、呼び出すと `{{ formatYen(…) }}` を返します。
- `Symbol.iterator` で 3 件を返します。
- `Symbol.toPrimitive('number')` は 1 です。
- `length` は 3 です。
- `then` / `__v*` / `constructor` などは `undefined` を返します。これを怠ると Vue が Promise や ref と誤認します。

### 根拠
- `StatusBadge` / `UserTable` / `EditDialog` / `UserPage` / `edge/PlaceholderDemo` の `<script setup>` には、先頭で `throw` する副作用を仕込んであります。それでも全画面を描画できました。
- `edge/PlaceholderDemo.vue` では、実行されると throw するプロジェクト内 TS（`src/utils/format.ts`）を import しています。これも実行されず、プレースホルダ化と warning の記録を確認しました。
- `v-if` / `v-else-if` / `v-else`、`v-for`（fixture の配列、プレースホルダの 3 件）、補間、`v-bind`（属性、`:class` のオブジェクト構文、テンプレートリテラル）、`v-model`（代入は ctx 側で受けて捨てる）が破綻しないことを確認しました。

![PlaceholderDemo](report-assets/PlaceholderDemo.preview.png)

### ハマりどころ
- **setup の戻り値に `then` があると Promise 扱いされる。** ctx Proxy が `then` にプレースホルダを返していたため、Vue が async setup と判定して落ちました。`then` は `undefined` を返すように修正しました。
- **関数型のプレースホルダは、Vue の 2 か所で別扱いされる。**
  - `renderList()` は関数を反復しないので、`v-for` が 0 件になりました。
  - SSR は関数値の属性を捨てるので、`:data-x="foo"` が消えました。
  - 対策として、**ツールがコンパイルした render 関数に渡す `Vue` だけ**をシムしました。`renderList` はプレースホルダを配列に展開し、`createElementVNode` 系は要素の属性値を文字列化します。ライブラリのコンポーネントには影響しません。
- **ライブラリのコンポーネントにプレースホルダを渡すと壊れることがある。** DataTable の `:value` にプレースホルダを渡すと型エラーの警告が出て、行が描画されませんでした。
  - 対策として、`createVNode` のシムで、渡し先コンポーネントの props 宣言（`extends` / `mixins` をたどる）を見て変換します。Array なら 3 件の配列、String なら文字列、Number なら 1、Boolean なら true です。
  - これでプレースホルダのみでも DataTable に 3 行が出ます。ただし `rowData`（Object 型）のように変換しない prop については、dev の型警告が残ります。
- `compileTemplate` の `scopeId` オプションは module モード専用です（function モードでは警告が出る）。scoped の `data-v-*` は、コンポーネントに `__scopeId` を持たせれば実行時に付与されるので、コンパイラ側には渡していません。
- `transformAssetUrls` は無効にしています（`<img src="./x.png">` は import 文に変換されるため）。画像アセットのインライン化は未対応です。

### 計測値
- 6 SFC（UserPage 一式）の `compileSfc` 合計: 約 110 ms（初回呼び出しの JIT 込み）

---

## V3: 子コンポーネントの再帰解決

**結果: 成立**

### 根拠
- `UserPage` の構成は `PageLayout`（`@/`）、`UserTable`（`@/`）、`EditDialog`（`./`）、`AppButton`（`@/volt`）で、さらに `StatusBadge`（`./` と `@/` の両方から import）を含みます。これらを再帰的に V2 と同じ方式でコンパイルして供給しました。`deps` にもすべて記録されます。
- パッケージからの import（`primevue/datatable` / `column` / `dialog` / `inputtext` / `button`）は、プロジェクトの node_modules から本物を読み込んでいます。
- 名前付き slot は親のコンテキストで描画されました。
  - `PageLayout` の `#actions` / 既定 / `#footer`
  - DataTable の `Column #body="{ data }"` の中の `StatusBadge` / `AppButton`
  - `Dialog #footer`
- 循環参照: `edge/CircularA → CircularB → CircularA` を検知してスタブ化し、次の warning を記録しました。
  `stub <CircularA>: circular import (src/components/edge/CircularA.vue -> src/components/edge/CircularB.vue -> src/components/edge/CircularA.vue)`
- 深さの上限は `maxDepth`（既定 20。設定で変更可）です。超えた場合もスタブになります。
- 解決できないもの（`edge/Unresolved.vue`）:
  - 存在しない `./DoesNotExist.vue` → スタブ（既定 slot の中身も表示）と warning
  - import もグローバル登録もない `<FancyWidget>` → スタブと warning
  - import のない `<Tag>` → `primevue/tag` として自動解決しました。PrimeVue をグローバル登録や resolver で使うプロジェクトを想定した補助です。
- `componentDirs` を指定すると、import されていないタグを `<dir>/<PascalName>.vue` から探します。

### ハマりどころ
- 同じ SFC を複数の場所から import しても、コンパイルと定義は 1 回だけです（ファイルパスでキャッシュ）。ルートだけは fixture を持つので、キャッシュしません。
- `import UserTable, { type User } from '...vue'` のような型 import は `isType` で除外しています。SFC の `<script>` の名前付き値 export は script コードなので実行せず、プレースホルダにします。
- 再帰コンポーネント（ツリー表示など、自分自身を import するもの）も循環としてスタブになります。プレースホルダの配列は常に 3 件なので、再帰を許すと停止しません。これは仕様上の制約です。

---

## V4: PrimeVue v4 unstyled + pt の SSR

**結果: 条件付きで成立**（Dialog などの Portal 系は、Portal へのパッチが必要）

### 根拠
- `createSSRApp(root).use(PrimeVue, { unstyled: true, pt })` で描画しました（pt は `src/pt/preset.ts` を実行して取得）。
- `UserTable.vue`（DataTable）では、fixture の 4 行が描画されました。`tableContainer` / `table` / `thead` / `bodyRow` / `column.headerCell` / `column.bodyCell` など、pt 由来の Tailwind クラスが HTML に出力されます。
- `EditDialog.vue`（Dialog、fixture で `visible: true`）が描画されました。`renderToString` の `ssrContext.teleports['body']` から取り出し、`</body>` の直前に差し込んでいます。
- Volt 風ラッパー: `src/volt/AppButton.vue` は PrimeVue Button をプロジェクト内 SFC でラップし、独自の `pt` と `ptOptions` を持たせたものです。ツールでは V2 の方式でコンパイルされ、中身の Button は本物が使われます。どちらも問題なく描画されました。

### ハマりどころ（想定どおりの問題）
- **PrimeVue の Portal は、マウント後にしか描画しない実装。** `primevue/portal/index.mjs` の該当部分:

  ```js
  data() { return { mounted: false } },
  mounted() { this.mounted = isClient() },
  render: inline ? renderSlot(...) : mounted ? h(Teleport, { to: appendTo }, ...) : createCommentVNode()
  ```

  SSR では `mounted` フックが走らないので、Dialog は `<!---->` になります。`--portal off` で出力が空になることも確認しました。
- 回避策を 2 つ試し、どちらも成立しました（Portal は Dialog から `components: { Portal }` でローカル登録されているため、`app.component` による差し替えは効きません。モジュールの default export を直接書き換えています）。
  1. **teleport（既定）**: `Portal.data` をラップして `mounted: true` で始めます。実際に `<Teleport to="body">` が生成され、SSR の `teleports` から取り出して body 末尾に差し込みます。ブラウザでの配置に近い結果になります。
  2. **inline**: `Portal.computed.inline` を常に true にします。`appendTo: "self"` と同じ扱いで、その場に描画されます。コンポーネント単位で `appendTo="self"` を書かせる必要はありません。
- Dialog の中身の表示判定は `data.containerVisible = this.visible` なので、初期値の時点で `visible: true` が反映されます。`Transition` は SSR では子要素をそのまま出すので、追加対応は不要でした。
- fixture 側で見つけた不具合: 当初 `AppButton` に `ptOptions: { mergeProps: true }` を付けていたため、グローバル pt の `text-white` と自前の `text-slate-700` がマージされ、「キャンセル」ボタンの文字が白地に白で見えなくなっていました。**Vite でも同じ見た目だった**ので、プレビューは実物どおりです。fixture の方を `mergeProps: false` に直しました。
- 出力には PrimeVue 由来の属性（`data-pc-*`、`data-p-*`、`pcN`）と、SSR のハイドレーション用コメント（`<!--[-->`）が大量に含まれます。見た目には影響しません。

---

## V5: CSS のインライン化

**結果: 成立**

### 根拠
- **scoped CSS**:
  - `compileStyle({ id: 'data-v-<hash>', scoped: true })` で生成しました。ハッシュはルート相対パスの sha256 の先頭 8 桁です。
  - コンポーネント定義に `__scopeId` を持たせ、描画された要素に `data-v-7100860d` などが付くことを確認しました。
  - slot に渡した中身には、Vue SSR の仕様どおり `data-v-xxx-s` も付きます。
- **グローバル CSS**: 設定の `globalCss` を読み込みます。
  - パッケージ指定（`primeicons/primeicons.css`）にも対応しました。fixture-app の `main.ts` は `import 'primeicons/primeicons.css'` していますが、ツールは `main.ts` を実行しないので、設定に列挙する方式にしています。
  - `tailwind.entry` と同じファイルは、Tailwind の出力と重複するのでスキップします。
- **Tailwind v4**:
  - `@tailwindcss/node` の `compile(css, { base, from, onDependency })` → `build(candidates)` で生成しました。インストール済み 4.3.3 の `index.d.ts` で API を確認しています。
  - 想定との違いは、`onDependency` が**必須**だった点だけです。
  - `@import "tailwindcss"` と `@theme` による独自色（`bg-brand-500`）、`@apply` も正しく展開されました。
- **oxide（ネイティブバインディング）はバイナリから読み込めました。**
  - `@tailwindcss/oxide` → `@tailwindcss/oxide-linux-x64-gnu` の `.node` を `import()` できます。
  - `new Scanner({ sources: [] }).getCandidatesWithPositions({ content: html, extension: 'html' })` で、出力 HTML からクラス候補を抽出しました（UserPage で 150 候補）。
  - 念のため、oxide が使えない場合は `class="..."` を分割する自前の抽出にフォールバックします。
- **primeicons**:
  - `url()` を data URI に置き換えました。
  - `@font-face` に woff2 がある場合は woff2 だけを残します。eot / ttf / svg / woff をすべて埋めると約 800 KB 増えるためです。
  - スクリーンショットでもアイコンが表示されています。

### 計測値
- `css`（Tailwind のコンパイル・生成、primeicons の読み込み・インライン化、scoped の結合）: 約 105〜170 ms
- 出力サイズ（UserPage）: HTML 全体で 90 KB。内訳は primeicons（woff2 の data URI 込み）64 KB、Tailwind 11 KB、scoped 0.6 KB です。

---

## V6: 出力とパフォーマンス

**結果: 成立**

### 外部リソース
`out/*.html` を Playwright（Chromium）の `file://` で開き、`request` イベントを数えました。

| 画面 | preview のリクエスト数 | Vite dev のリクエスト数 |
| --- | --- | --- |
| UserTable | **0** | 28 |
| EditDialog | **0** | 28 |
| UserPage | **0** | 34 |

### Vite dev サーバとの見た目の差分
スクリーンショットは 1100×700 です。差分はブラウザの canvas で画素単位に比較しました。

| 画面 | 差分画素 | 内容 |
| --- | --- | --- |
| UserTable | 0（0%） | 完全一致 |
| UserPage | 0（0%） | 完全一致 |
| EditDialog | 309（0.04%） | Vite 側だけ、Dialog 表示後に閉じるボタンへフォーカスが移ってリングが出る（クライアント側の挙動）。それ以外は一致 |

| preview（vue-preview） | Vite dev |
| --- | --- |
| ![](report-assets/UserTable.preview.png) | ![](report-assets/UserTable.vite.png) |
| ![](report-assets/EditDialog.preview.png) | ![](report-assets/EditDialog.vite.png) |
| ![](report-assets/UserPage.preview.png) | ![](report-assets/UserPage.vite.png) |

Vite 側の比較ページ（`compare.html`）は fixture の値を props として渡します。`UserPage` は `fetch` をモックして fixture の `users` を返します。この条件で、プレビューと Vite が同じ状態を描画することを確認しました。

### 実行時間
`docker compose exec app /opt/vue-preview/vue-preview render src/components/UserPage.vue --root /app --json` を計測しました。「cold」は各回の前に `echo 3 > /proc/sys/vm/drop_caches` でページキャッシュを捨てています。

| | wall（compose exec 込み） | 内部合計 | loadModules | compile | ssr | css |
| --- | --- | --- | --- | --- | --- | --- |
| cold #1 | 977 ms | 613 | 161 | 173 | 119 | 158 |
| cold #2 | 937 ms | 587 | 130 | 176 | 119 | 161 |
| cold #3 | 839 ms | 558 | 140 | 167 | 107 | 143 |
| cold #4 | 913 ms | 616 | 143 | 190 | 110 | 173 |
| cold #5 | 870 ms | 565 | 132 | 178 | 106 | 148 |
| warm（5 回の範囲） | 610–666 ms | 430–473 | 89–106 | 138–151 | 96–103 | 106–135 |

- さらに細かい内訳（warm）:
  - compile のうち SFC コンパイルが約 110 ms、PrimeVue コンポーネントの import が約 30 ms
  - SSR は 1 回目が約 97 ms、同じアプリの 2 回目が約 40 ms
- `docker compose exec` 自体のオーバーヘッドは約 50〜100 ms です（`docker exec` 直叩きでは 556〜579 ms）。
- 内部合計と wall の差は、残りの 150〜250 ms 程度です。これは 81 MB バイナリの起動とコンテナ exec によるものです。

### 常駐モード（`serve`）の判断材料
- 毎回かかる固定費はおよそ次のとおりです。
  - プロセス起動と exec: 約 150〜250 ms
  - モジュール読み込み: 約 100〜160 ms
  - コンパイラと SSR の JIT ウォームアップ: SFC コンパイル約 110 ms のうち大半と、SSR の約 60 ms
  - Tailwind のコンパイラ初期化
- 常駐して変更があった SFC だけを再コンパイルすれば、1 回あたり **100 ms 前後**まで下がる見込みです。SSR の 2 回目は 40 ms で、SFC 単位のキャッシュも効きます。
- 保存のたびにプレビューを更新する用途なら、常駐は**あった方がよい**です。一方、手動で開く用途なら 1 秒弱で実用範囲です。まず単発の CLI で統合し、必要に応じて `serve` を足すのが妥当です（提案。スコープ外のため未実装）。

---

## 既知の制約・提案（スコープ外のため記録のみ）

- **script を実行しないことの限界**:
  - computed / 関数呼び出しの結果は、fixture で与えない限りプレースホルダになります（例: `activeCount`）。
  - UserPage の fixture には、`users` と `activeCount` を両方書く必要があります。
  - `onMounted` などのライフサイクルで取得するデータは、fixture で与えるのが前提です。
- **プレースホルダの限界**:
  - プレースホルダをキーにしたオブジェクト参照（`labels[status]`）は `undefined` になります。
  - `===` による比較は常に false になるので、`v-if="mode === 'edit'"` は v-else 側に倒れます。
- `<style lang="scss">` などのプリプロセッサは未対応です（warning でスキップ）。`transformAssetUrls` を無効にしているので、画像も表示されません。
- `main.ts` の `app.use()` / `app.component()` / `app.provide()` は再現しません。PrimeVue 以外のプラグイン（i18n、router、pinia）を使うテンプレートは、`$t` などがプレースホルダになります。設定でプラグインの「プレビュー用初期化モジュール」を指定できるようにする案が考えられます。
- Portal へのパッチは PrimeVue の内部実装（`data.mounted` / `computed.inline`）に依存します。PrimeVue の更新で壊れる可能性があるので、バージョンを固定するか、壊れたことを検知する仕組みが必要です。
- 出力を小さくするなら、`data-pc-*` 属性とハイドレーション用コメントの除去、primeicons の未使用グリフのサブセット化が効きます。
- ツールは dev ビルドの Vue を使います。prop の型警告などが `warnings` に入るのは利点ですが、プレースホルダ起因の型警告はノイズになり得ます。

## ファイル

- `tool/src/`
  - `cli.ts`: 全体の流れと計測
  - `load-project-modules.ts`: V1
  - `compile.ts`: V2（静的解析と Vue ヘルパーのシム）
  - `ctx-proxy.ts` / `placeholder.ts`: V2
  - `resolve-components.ts`: V3
  - `css.ts`: V5
  - `html.ts`
- `fixture-app/src/components/`: 検証対象の画面
  - `edge/`: プレースホルダ、循環参照、未解決コンポーネントの検証用
- `fixture-app/src/compare.ts` / `compare.html`: V6 の比較用エントリ
- `report-assets/`: スクリーンショット
- `build.sh` / `render.sh`: ビルドと実行の補助スクリプト
