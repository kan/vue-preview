# AGENTS.md — vue-preview 開発ガイド

Vue SFC を「CSS インライン済みの 1 枚 HTML」にレンダリングする CLI（`vue-preview`）です。現在は PoC 段階です。優先するのはコード品質より「何が動いて何が動かないか」を明らかにすることです。

| ドキュメント | 内容 |
| --- | --- |
| [README.md](README.md) | 利用者向けの概要と使い方 |
| [DESIGN.md](DESIGN.md) | 設計の前提、CLI と設定の仕様、処理の流れ |
| [REPORT.md](REPORT.md) | 検証項目 V1〜V11 の結果、ハマりどころ、計測値、今後の提案 |

**設計や仕様を変えたら DESIGN.md を更新してください。検証で何かが分かったら REPORT.md に追記してください。**

## ディレクトリ構成

```
.
├── AGENTS.md / DESIGN.md / REPORT.md / README.md
├── docker-compose.yml        # app（node:22 + fixture-app）、bare（node_modules 無しの fixture-app）、bun（ビルド・テスト）
├── .github/workflows/ci.yml  # unit / build + e2e / Windows / タグでリリース
├── scripts/                  # build.sh / test-unit.sh / e2e.sh / render.sh
├── dist/                     # ビルドしたバイナリ vue-preview-<target>（app / bare コンテナに /opt/vue-preview としてディレクトリでマウント）
├── out/                      # 生成した HTML / JSON の出力先（git 管理外）
├── report-assets/            # REPORT.md 用のスクリーンショット
├── tool/                     # vue-preview 本体（TypeScript / Bun）
│   ├── src/
│   │   ├── cli.ts                  # 引数処理、全体の流れ、計測
│   │   ├── config.ts               # vue-preview.config.json / tsconfig paths
│   │   ├── detect-config.ts        # 設定に無いキーを vite.config とアプリのエントリ（src/main.ts）から推測する
│   │   ├── text-scan.ts            # JS をテキストとして読む補助（括弧の対応・分割・コメントの除去）
│   │   ├── deps-cache.ts           # node_modules が無いときの依存キャッシュ（埋め込みの bun で install）
│   │   ├── load-project-modules.ts # プロジェクト（または依存キャッシュ）の node_modules からの解決・import
│   │   ├── compile.ts              # SFC のコンパイルと静的解析、Vue ヘルパーのシム
│   │   ├── ctx-proxy.ts            # テンプレートの値の解決
│   │   ├── placeholder.ts          # プレースホルダ
│   │   ├── resolve-components.ts   # 子コンポーネントの再帰解決、スタブ
│   │   ├── css.ts                  # Tailwind / global / scoped / url() のインライン化
│   │   └── html.ts
│   └── test/
│       ├── unit/             # Vue なしで動く単体テスト（bun test）
│       └── e2e/              # scripts/e2e.sh が出力した JSON への検証
└── fixture-app/              # 検証対象の Vue プロジェクト（PrimeVue v4 unstyled + pt + Tailwind v4）
    ├── vue-preview.config.json
    ├── compare.html / src/compare.ts   # Vite で同じ画面を表示する比較用エントリ
    └── src/components/       # UserPage / UserTable / EditDialog / PageLayout / StatusBadge、edge/（エッジケース）
```

## 開発コマンド

すべてのコマンドは docker compose 経由で実行します。**ホストで `npm install` / `bun install` はしないでください。**

```sh
docker compose up -d app
docker compose exec app npm ci                        # fixture-app の依存（named volume に入る）

scripts/test-unit.sh                                  # 単体テスト（bun コンテナ）
VERSION=dev scripts/build.sh                          # dist/vue-preview-{linux-x64,windows-x64.exe,darwin-arm64} をビルド（bun コンテナ）
TARGETS=linux-x64 scripts/build.sh                    # 一部のターゲットだけビルド
scripts/e2e.sh                                        # fixture-app を実際に描画して検証（build の後に実行）

scripts/render.sh src/components/UserPage.vue         # out/UserPage.{json,html} を生成し、warnings/deps/timings を表示
docker compose exec app /opt/vue-preview/vue-preview-linux-x64 render src/components/UserPage.vue --root /app --json

docker compose exec app npx vite --host 0.0.0.0       # 比較用: http://localhost:5173/compare.html?c=UserTable
```

- ビルドには `--compile-autoload-package-json` が必須です（`scripts/build.sh` に含まれています）。外すと、実行時にネストした依存を解決できなくなります。依存キャッシュを `NODE_PATH` で解決するときも同じです。
- 依存キャッシュ（REPORT V7）は、install のためにネットワークへ出ます。`bare` コンテナのキャッシュは named volume `bare_cache` に残ります。作り直すときは `docker compose --profile bare down -v` で消してください。
- コンテナから外部に出るのにプロキシが必要な環境（クラウドのサンドボックスなど）では、`docker-compose.override.yml`（git 管理外）で `network_mode: host`、`HTTPS_PROXY`、CA 証明書を追加してください。

## テスト

- `tool/test/unit`: Vue に依存しない純粋なロジック（プレースホルダ、リテラル評価、CSS の url 置換、設定、依存キャッシュのキーと置き場）のテストです。
- `tool/test/e2e`: `scripts/e2e.sh` が `fixture-app` のコンポーネントをバイナリで描画し、`out/*.json` を検証します。対象は次のとおりです。
  - fixture の反映、pt クラス、scoped 属性、Teleport、外部 URL がないこと
  - script を実行していないこと、循環参照、スタブ
  - `bare` コンテナ（node_modules 無し）が依存キャッシュを使って描いた HTML が、プロジェクトの node_modules で描いた HTML と一致すること
- 挙動を変えたら、`fixture-app` にケースを足し、e2e の期待値を更新してください。エッジケースは `fixture-app/src/components/edge/` に置きます。
- 見た目の確認は、`out/*.html` と Vite の `compare.html` をブラウザで並べて行います（REPORT V6 を参照）。

## CI とリリース

- `.github/workflows/ci.yml`
  - push（main）と PR: `unit`（単体テスト）と `e2e`（3 ターゲットのビルド → `npm ci` → e2e）を実行します。成果物として `out/` とバイナリをアップロードします。続いて `windows`（windows-latest で、node_modules の無い fixture-app を Windows 版で描画）を実行します。
  - `v*` タグの push: 上記が通ったら、3 つのバイナリとそれぞれの `.sha256` を GitHub Release に添付します。`-` を含むタグ（例: `v0.2.0-rc.1`）は prerelease になります。
- リリース手順: `git tag v0.1.0 && git push origin v0.1.0`。バイナリの `--version` にはタグ名が埋め込まれます。
  - タグを push できない環境（Claude Code on the web のセッションなど）では、CI を `workflow_dispatch` で実行し、`release_tag` に `v0.1.0` を指定します。テストが通ると、実行したコミットにタグが作られ、リリースが公開されます。

## 作業ルール

- ホストに node_modules を作らない。依存の導入と実行はすべてコンテナ内で行う。
- `tool/package.json` に `vue` や `primevue` を依存として入れない（二重インスタンス検証の意味がなくなるため）。型定義が必要な場合は devDependencies に限定する。
- **ユーザーの SFC の script を実行する実装に逃げない。** どうしても必要に見える場合は、その理由を REPORT.md に記録して相談する。
- 想定した API が存在しない、または挙動が違う場合は、黙って別の方法に切り替えない。何が想定と違ったかを REPORT.md に記録してから、代替案を試す。
- スコープ外（DESIGN.md 末尾を参照）の事項は、必要だと判断しても REPORT.md に提案として書くだけにする。
- 小さくコミットする。
