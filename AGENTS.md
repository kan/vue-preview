# AGENTS.md — vue-preview 開発ガイド

Vue SFC を「CSS インライン済みの 1 枚 HTML」にレンダリングする CLI（`vue-preview`）です。pike のエディタの Preview が使っています。`--json` の `html` / `deps` / `warnings` / `modules` / `inputs` は pike が読む契約なので、形を変えるときは DESIGN.md と pike 側もそろえます。新しい方式を試すときは、何が動いて何が動かないかを REPORT.md に残します。

| ドキュメント | 内容 |
| --- | --- |
| [README.md](README.md) | 利用者向けの概要と使い方 |
| [DESIGN.md](DESIGN.md) | 設計の前提、CLI と設定の仕様、処理の流れ |
| [REPORT.md](REPORT.md) | 検証項目 V1〜V14 の結果、ハマりどころ、計測値、今後の提案 |
| [CHANGELOG.md](CHANGELOG.md) | 版ごとの変更点。`## [Unreleased]` がそのまま次のリリースノートになる |

**設計や仕様を変えたら DESIGN.md を更新してください。検証で何かが分かったら REPORT.md に追記してください。**

## ディレクトリ構成

```
.
├── AGENTS.md / DESIGN.md / REPORT.md / README.md / CHANGELOG.md
├── .tagpr                    # tagpr の設定（下の「CI とリリース」）
├── docker-compose.yml        # app（node:22 + fixture-app）、bare（node_modules 無しの fixture-app）、bun（ビルド・テスト）
├── .github/workflows/        # ci.yml / release.yml / tagpr.yml / tagpr-label.yml / verify-lockfile.yml、actions.lock
├── scripts/                  # build.sh / test-unit.sh / e2e.sh / render.sh
│   └── tagpr/                # kan/tagpr-scripts の git subtree（編集しない）
├── dist/                     # ビルドしたバイナリ vue-preview-<target>（app / bare コンテナに /opt/vue-preview としてディレクトリでマウント）
├── out/                      # 生成した HTML / JSON の出力先（git 管理外）
├── report-assets/            # REPORT.md 用のスクリーンショット
├── tool/                     # vue-preview 本体（TypeScript / Bun）
│   ├── src/
│   │   ├── cli.ts                  # 引数処理、全体の流れ、計測
│   │   ├── config.ts               # vue-preview.config.json / tsconfig paths
│   │   ├── detect-config.ts        # 設定に無いキーを vite.config・index.html・アプリのエントリ（src/main.ts）から推測する
│   │   ├── text-scan.ts            # JS をテキストとして読む補助（括弧の対応・分割・コメントの除去）
│   │   ├── deps-cache.ts           # node_modules が無いときの依存キャッシュ（埋め込みの bun で install）
│   │   ├── load-project-modules.ts # プロジェクト（または依存キャッシュ）の node_modules からの解決・import
│   │   ├── compile.ts              # SFC のコンパイルと静的解析、Vue ヘルパーのシム
│   │   ├── ctx-proxy.ts            # テンプレートの値の解決
│   │   ├── placeholder.ts          # プレースホルダ
│   │   ├── i18n.ts                 # メッセージファイルの探索と読み込み、$t / useI18n() の t
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

- `tool/test/unit`: Vue に依存しない純粋なロジックのテストです。ファイル名は対象のモジュールに合わせます（`detect-config.test.ts` なら `detect-config.ts`）。
- `tool/test/e2e`: `scripts/e2e.sh` が `fixture-app` のコンポーネントをバイナリで描画し、`out/*.json` を検証します。REPORT.md の各 V の「根拠」にある e2e の確認が、ここのテストです。描き方の違うルート（設定ファイル無し、tsconfig 無し、node_modules 無しの `bare`）も `e2e.sh` が作ります。
- 挙動を変えたら、`fixture-app` にケースを足し、e2e の期待値を更新してください。エッジケースは `fixture-app/src/components/edge/` に置きます。
- 見た目の確認は、`out/*.html` と Vite の `compare.html` をブラウザで並べて行います（REPORT V6 を参照）。

## CI とリリース

| workflow | 起動 | 内容 |
| --- | --- | --- |
| `ci.yml` | push（main）、PR、`workflow_dispatch`（手で再実行するとき）、`workflow_call` | `unit`（単体テストと `verify-subtree.mjs`）と `e2e`（3 ターゲットのビルド → `npm ci` → e2e）。成果物として `out/` とバイナリ（`vue-preview-binaries`）をアップロードし、続いて `windows`（windows-latest で、node_modules の無い fixture-app を Windows 版で描画）を実行します |
| `release.yml` | `v*` タグでの `workflow_dispatch`（tagpr から）、`v*` タグの push（手で打ったとき） | タグの CHANGELOG の節を確かめ、`ci.yml` をタグで回し、e2e が作ったバイナリとそれぞれの `.sha256` で GitHub Release を作ります。本文は CHANGELOG のその版の節です。`-` を含むタグ（例: `v0.7.0-rc.1`）は prerelease になり、本文は `## [Unreleased]` です |
| `tagpr.yml` / `tagpr-label.yml` | push（main）、リリース PR のラベルの変更 | リリース PR を最新に保ち、マージされたらタグを打って `release.yml` を起動します（kan/tagpr-scripts の共通の workflow） |
| `verify-lockfile.yml` | push（main）、PR | `actions.lock` と各 workflow の `uses:` が食い違っていないかを確かめます |

- **action は完全な版のタグで書き（`actions/checkout@v7.0.1`）、`uses:` を変えたら `gh actions-lock` で `.github/workflows/actions.lock` を更新します。**
- バイナリの `--version` には ref の名前（リリースではタグ名）が埋め込まれます。版を持つファイルはありません（`tool/package.json` は `private` で版を持たない）。

### リリース手順

**リリースは tagpr のリリース PR をマージして始めます。** CHANGELOG の節の書き換えとタグは、リリース PR とワークフローが行います。**「CHANGELOG に vX.Y.Z を追加」のコミットを手で作らず、タグも手で打ちません**（プレリリースと、打ち直しを除く）。設定は `.tagpr` にあります。

1. **変更を入れる PR で CHANGELOG を書く。** 利用者に届く変更は、その PR で `CHANGELOG.md` の `## [Unreleased]` に足します。この節がそのまま GitHub のリリースノートになります。項目の中のリンクはインラインで書きます（参照形式のリンクの定義は節の外にあるので、リリースノートではリンクになりません）。末尾のリンク定義はリリース PR が版ごとに足すので、手で足しません。
2. **リリース PR を確かめる。**

   ```sh
   gh pr list --label tagpr --state open --json number,title,headRefName
   gh run list --workflow tagpr.yml --branch main -L 3
   ```

   - 最新の tagpr の run が success であること。失敗した run はリリース PR を draft にします。`release-prepare.mjs` の出力を読み、CHANGELOG を直す PR を main にマージすると作り直されます。
   - 版（PR のタイトル）が正しいこと。既定は patch で、前回のリリース以降にマージした PR が `enhancement` ラベルを持っていれば minor になります。手で変えるときはリリース PR に `tagpr:minor` / `tagpr:major` のラベルを付けます。`tagpr-label.yml` が作り直すので、その run が success になるのを待ってからマージします。
   - PR のタイトルの版と CHANGELOG の見出しの版が一致し、Files changed が `CHANGELOG.md`（見出しとリンク定義）だけであること。
   - 節を直すときは、リリース PR のブランチではなく main の `## [Unreleased]` を直します（ブランチは作り直すたびに main から作られる）。
   - リリース PR の CI は承認待ち（`action_required`）で止まることがあります（GITHUB_TOKEN が作った PR のため）。そのときは今の head の run を承認します。
3. **リリース PR をマージする。** `gh pr merge <番号> --squash --delete-branch`。マージの push で走る tagpr の run がタグを打ち、`release.yml` をそのタグで起動します。**タグが打たれるまで、main へほかの PR をマージしません。** run が落ちたときの復旧は、[scripts/tagpr/README.md](scripts/tagpr/README.md) の「The tagpr workflow」に従います。この repo の `release-workflow` は `release.yml` で、`push: tags` でも起動するので、手でタグを push したときは `gh workflow run` を重ねません（同じタグで 2 回走る）。
4. **Release を確かめる。** 3 つのバイナリと `.sha256` が載り、本文が `node scripts/tagpr/release-notes.mjs vX.Y.Z` の出力と同じであること。

プレリリースは、main のコミットに手でタグを打って push します（`git tag -a -m "Release v0.7.0-rc.1" v0.7.0-rc.1 && git push origin v0.7.0-rc.1`）。

### scripts/tagpr

[kan/tagpr-scripts](https://github.com/kan/tagpr-scripts) を git subtree で取り込んだものです。使い方は同梱の README.md にあります。

- **`scripts/tagpr/` の中は編集しません。** 直すときは kan/tagpr-scripts を直し、こちらへは次で取り込みます（subtree は `commit.gpgsign` を見ないので `-S` を付ける）。

  ```sh
  git subtree pull -S --prefix=scripts/tagpr https://github.com/kan/tagpr-scripts.git main --squash
  ```

- **同じ PR で、`tagpr.yml` と `tagpr-label.yml` の `uses: kan/tagpr-scripts/...@<SHA>` を上げます**。上げる先は、取り込んだ tagpr-scripts のコミットです（squash のコミットのメッセージにある `git-subtree-split` の SHA）。揃っているかは CI が `node scripts/tagpr/verify-subtree.mjs` で確かめます（`HEAD` を読むので、コミットした後に手でも走らせられる）。
- **取り込む PR はマージコミットでマージします。** squash すると、subtree が前回の取り込みを見つけられず、次の `git subtree pull` が失敗します。
- 取り込みは CHANGELOG に書きません（利用者に届く変更ではないため）。

## 作業ルール

- ホストに node_modules を作らない。依存の導入と実行はすべてコンテナ内で行う。
- `tool/package.json` に `vue` や `primevue` を依存として入れない（二重インスタンス検証の意味がなくなるため）。型定義が必要な場合は devDependencies に限定する。
- **ユーザーの SFC の script を実行する実装に逃げない。** どうしても必要に見える場合は、その理由を REPORT.md に記録して相談する。
- 想定した API が存在しない、または挙動が違う場合は、黙って別の方法に切り替えない。何が想定と違ったかを REPORT.md に記録してから、代替案を試す。
- スコープ外（DESIGN.md 末尾を参照）の事項は、必要だと判断しても REPORT.md に提案として書くだけにする。
- 小さくコミットする。
- **main へ直接 push しない。** ブランチを切って PR を作る。tagpr はマージされた PR からリリース PR を組み立てるので、直接 push した変更はリリースの確認から漏れる。利用者に届く変更を入れる PR では、`CHANGELOG.md` の `## [Unreleased]` に項目を足す（「CI とリリース」の「リリース手順」）。
