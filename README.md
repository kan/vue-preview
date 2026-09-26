# vue-preview

Vue SFC を簡易レンダリングし、**CSS をすべてインライン化した 1 枚の HTML** を出力する CLI です（PoC）。
ADE「pike」から外部ツールとして呼び出し、人間向けのプレビューに使うことを想定しています。

- ユーザーの `<script>` / `<script setup>` は**実行しません**。値は fixture（`*.preview.json`）とプレースホルダ（`{{ user.name }}`）から供給します。
- `vue` や `primevue` などのライブラリは、**対象プロジェクトの node_modules** から実行時に読み込みます。node_modules が無いときは、ロックファイルどおりの版を自前のキャッシュへ入れて使います。
- 対象: Vue 3.5 / PrimeVue v4（unstyled + pass-through）/ Tailwind CSS v4 / primeicons
- 出力された HTML は外部リソースを一切読み込みません。フォントも data URI で埋め込んでいます。

| vue-preview の出力 | Vite dev サーバ |
| --- | --- |
| ![](report-assets/UserPage.preview.png) | ![](report-assets/UserPage.vite.png) |

> [!NOTE]
> これは方式検証用のプロトタイプです。何が動いて何が動かないかは [REPORT.md](REPORT.md) にまとめています。

## インストール

[Releases](../../releases) から、使う環境の単一バイナリをダウンロードしてください。node や npm は要りません。

| ファイル | 環境 |
| --- | --- |
| `vue-preview-linux-x64` | glibc の x86_64 Linux（WSL、公式 `node` イメージなど） |
| `vue-preview-windows-x64.exe` | Windows（x64） |
| `vue-preview-darwin-arm64` | macOS（Apple Silicon） |

```sh
chmod +x vue-preview-linux-x64
./vue-preview-linux-x64 --version
```

PATH の通ったディレクトリに `vue-preview`（Windows は `vue-preview.exe`）という名前で置くと、`vue-preview` で呼べます。

Docker で使う場合は、バイナリを**ディレクトリごと**マウントします。ファイル単位でマウントすると、バイナリを置き換えたときにコンテナ側が古い実体を掴み続けます。

```yaml
services:
  app:
    image: node:22
    volumes:
      - ./my-app:/app
      - ./bin:/opt/vue-preview:ro
```

## 使い方

```sh
vue-preview render src/components/UserPage.vue --root /app > UserPage.html
vue-preview render src/components/UserPage.vue --root /app --json --out UserPage.json
```

| オプション | 説明 |
| --- | --- |
| `<path>` | 描画する SFC（`--root` からの相対パス） |
| `--root <dir>` | プロジェクトルート（`package.json` と `vue-preview.config.json` がある場所）。省略時はカレントディレクトリ |
| `--fixture <file>` | fixture の JSON。省略時は `<name>.preview.json` を探し、なければプレースホルダだけで描画する |
| `--json` | `{ html, deps, warnings, modules, ... }` を出力する。`deps` は出力に影響したファイルのルート相対パス、`modules` はライブラリの出どころ |
| `--out <file>` | stdout の代わりにファイルへ書き出す |
| `--portal teleport\|inline\|off` | PrimeVue の Dialog などの描画方法（既定 `teleport`） |

### fixture

ルートコンポーネントの props や setup 内の変数に入れる値を、名前をキーにして書きます。

```json
// src/components/UserTable.preview.json
{
  "rows": [
    { "id": 1, "name": "山田 太郎", "email": "taro@example.com", "status": "active" }
  ]
}
```

fixture にない値は、次の順で補われます。

1. `defineProps` のデフォルト値
2. `ref(false)` のように静的に読み取れる初期値
3. プレースホルダ

### 設定ファイル `vue-preview.config.json`

```json
{
  "aliases": { "@": "src" },
  "globalCss": ["src/styles/main.css", "primeicons/primeicons.css"],
  "tailwind": { "entry": "src/styles/main.css" },
  "primevue": { "unstyled": true, "pt": "src/pt/preset.ts" },
  "componentDirs": []
}
```

`aliases` を省略すると、tsconfig の `paths` から読み取ります。各キーの詳細は [DESIGN.md](DESIGN.md#設定ファイル-vue-previewconfigjsonルート直下) を参照してください。

設定ファイルは無くてもかまいません。書いていないキーは、アプリのエントリ（`src/main.ts` / `src/main.js`）を読んで推測します。`main.ts` は実行しません。

- `globalCss`：エントリで import している CSS
- `tailwind`：そのうち `@import "tailwindcss"` を含むもの
- `primevue`：`app.use(PrimeVue, { unstyled, pt })` の指定。依存に primevue があれば、エントリに無くても PrimeVue の既定（`unstyled: false`）で入れる

推測で足りないとき（`pt` をエントリの外で組み立てている、など）は、そのキーだけを設定ファイルに書いてください。

### node_modules が無いプロジェクト

node_modules がコンテナの中にしか無いプロジェクトも、ホストから描画できます。ルートで `vue` を解決できないとき、vue-preview はロックファイル（`package-lock.json` / `bun.lock` / `yarn.lock` / `pnpm-lock.yaml`）どおりの依存をキャッシュへ入れて使います。

- 初回だけ install の時間がかかります（数秒〜数十秒）。このとき stderr に 1 行出します。2 回目以降はキャッシュを使います。
- 置き場は `~/.cache/vue-preview`（Windows は `%LOCALAPPDATA%\vue-preview`）です。`VUE_PREVIEW_CACHE_DIR` で変えられます。30 日使われなかった版は自動で消します。
- レジストリの設定は、ルートの `.npmrc` を使います。
- ロックファイルが無いプロジェクトと、monorepo（package.json に `workspaces` があるもの）は未対応です。エラーで終わります。
- キャッシュへコピーするのは package.json・ロックファイル・`.npmrc` だけです。`file:` / `link:` の依存と patches を使うプロジェクトでは install が失敗します。

## 制約

主なものを挙げます。詳細は [REPORT.md](REPORT.md#既知の制約提案スコープ外のため記録のみ) を参照してください。

- computed や関数の結果、`onMounted` で取得するデータは、fixture で与えない限りプレースホルダになります。
- `main.ts` の `app.use()` は再現しません。PrimeVue 以外のプラグイン（i18n、router、pinia など）には未対応です。
- `<style lang="scss">` などのプリプロセッサと、画像アセットには未対応です。
- 自分自身を import する再帰コンポーネントは、循環参照としてスタブ表示になります。

## 開発

開発環境・テスト・リリース手順は [AGENTS.md](AGENTS.md)、設計は [DESIGN.md](DESIGN.md) を参照してください。

```sh
docker compose up -d app && docker compose exec app npm ci
scripts/test-unit.sh && scripts/build.sh && scripts/e2e.sh
```
