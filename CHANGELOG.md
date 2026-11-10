# Changelog

このプロジェクトの主な変更点を記録する。形式は
[Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

### Infrastructure

- リリースを [tagpr](https://github.com/Songmu/tagpr) で行うようにした。リリース PR をマージするとタグが打たれ、テストを通したバイナリが配布される。
- GitHub のリリースノートを、コミットの一覧から CHANGELOG.md のその版の節に変えた。

## [0.6.0] - 2026-09-26

### Added

- ルートの `index.html` にある `<link rel="stylesheet">` を、グローバル CSS として推測するようにした。`rel="alternate stylesheet"` とコメント内の link は除く。`/…` の href は Vite と同じく `public/` の下、無ければルートの下から読む。外部の CSS は取り込まず、warning に出す。

## [0.5.0] - 2026-09-26

### Added

- i18n に簡易対応した。`src/i18n` や `src/locales` などにあるロケール名のメッセージファイルを読み、`$t` と `useI18n()` の `t` を訳す。ロケールは `--locale`、設定の `i18n.locale`、`ja`、`en`、最初に見つかったものの順に選ぶ。
- `--json` の `inputs` で、ref などのリアクティブ API 以外の呼び出しから受け取った名前（`useI18n()` の `t`、ストアなど）に `origin: "call"` を付けるようにした。

## [0.4.0] - 2026-09-26

### Added

- `--json` に `inputs` を足した。ルートのコンポーネントの props と、描画中にテンプレートが使った識別子と、使った fixture を返す。
- グローバル登録（アプリのエントリの `app.component(...)`）と自動 import（`components.d.ts`）の子コンポーネントを解決するようにした。タグ名と SFC やパッケージの対応は、設定の `components` でも指定できる。

### Changed

- プレースホルダに参照式の末尾だけを表示し、ポイントすると全体が出るようにした。

## [0.3.0] - 2026-09-26

### Added

- `vue-preview.config.json` が無い、またはキーが足りないときに、アプリのエントリ（`src/main.{ts,js}`）から `globalCss`、`tailwind.entry`、`primevue` を推測するようにした。推測したキーは `--json` の `config.detected` に出る。
- tsconfig に paths が無いときに、`vite.config` の `resolve.alias` から `@` の alias を読むようにした。

## [0.2.0] - 2026-09-26

### Added

- プロジェクトに node_modules が無いときに、ロックファイルどおりの依存を `~/.cache/vue-preview/deps/` へ入れて使うようにした。ライブラリをどこから読んだかは `--json` の `modules` に出る。
- Windows（x64）と macOS（Apple Silicon）のバイナリを配布するようにした。

## [0.1.0] - 2026-09-25

### Added

- 最初のリリース。Vue SFC を、CSS をインライン化した 1 枚の HTML にレンダリングする。Linux（x64）のバイナリを配布する。

[0.6.0]: https://github.com/kan/vue-preview/releases/tag/v0.6.0
[0.5.0]: https://github.com/kan/vue-preview/releases/tag/v0.5.0
[0.4.0]: https://github.com/kan/vue-preview/releases/tag/v0.4.0
[0.3.0]: https://github.com/kan/vue-preview/releases/tag/v0.3.0
[0.2.0]: https://github.com/kan/vue-preview/releases/tag/v0.2.0
[0.1.0]: https://github.com/kan/vue-preview/releases/tag/v0.1.0
