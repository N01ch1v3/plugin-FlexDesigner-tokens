# セキュリティポリシー

## サポート対象バージョン

このプロジェクトは開発初期段階のため、**最新リリースのみ**をサポート対象とします。
古いバージョンへのセキュリティパッチのバックポートは行いません。

## 脆弱性の報告

脆弱性を発見した場合は、**公開の Issue を作成しないでください**。

代わりに GitHub の [Private vulnerability reporting](https://github.com/ShotaArima/plugin-FlexDesigner-tokens/security/advisories/new) から報告してください（リポジトリの **Security** タブ →
**Report a vulnerability**）。

報告には可能な範囲で以下を含めてください。

- 影響を受けるバージョン / OS
- 再現手順
- 想定される影響範囲

対応状況の目安をお約束できるものではありませんが、可能な限り速やかに確認します。

## トークンの取り扱いについて

このプラグインが Claude / Codex の認証情報に対して行うこと・行わないことの要約です。詳細は
[README.md](README.md#トークンの取り扱い) を参照してください。

- 読み取るのは **ローカルに保存済みの OAuth トークン**（macOS Keychain / `~/.claude/.credentials.json`）のみで、
  プラグイン自身が新規にパスワードや認証情報を要求することはありません
- トークンが失効している場合、`refreshToken` を使ったサイレント更新（案A）、または設定画面からの
  ブラウザ再ログイン（案B、プラグイン専用の資格情報として別途保存）のいずれかで補います
- トークンは **Anthropic への認証リクエストにのみ使用**し、ログ・設定ファイル・キーの描画内容には
  一切出力しません
- **第三者への送信は行いません**。ネットワーク通信は Anthropic の公式ドメイン（`api.anthropic.com` /
  `console.anthropic.com` / `claude.ai`）以外には行いません

## 非公式 API への依存について

Claude キーの機能は Anthropic が公開していない内部 API に依存しています（詳細は
[README.md](README.md) の該当セクションを参照）。Anthropic からの要請があった場合、該当機能は
予告なく無効化・変更する可能性があります。
