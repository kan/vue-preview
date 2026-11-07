# セキュリティポリシー

## 脆弱性の報告

vue-preview に脆弱性を見つけたら、公開の Issue には書かず、GitHub の [Private vulnerability reporting](https://github.com/kan/vue-preview/security/advisories/new) から報告してください。報告の内容は、修正を公開するまでメンテナーにだけ見えます。

報告には次の内容を書いてください。

- 脆弱性の内容
- 再現の手順（再現に使う `.vue` ファイルや fixture があれば、それも）
- 想定される影響（読み書きできるファイル、外部への通信など）

受け取った報告は、できるだけ早く確認して返信します。

## 対象

対象は、このリポジトリのコードと、GitHub Releases で配る実行ファイル（`vue-preview-<os>-<arch>` と、その `.sha256`）です。修正は最新の版にだけ当てます。

次のものは、それぞれの報告先へお願いします。

- 対象プロジェクトの node_modules から読み込む Vue や PrimeVue などのライブラリの問題: それぞれのプロジェクト
- pike の Preview の問題: [kan/pike](https://github.com/kan/pike/security/policy)
