# 訪問介護 サービス実施記録

訪問介護のサービス実施記録を作成・管理するアプリです。
ヘルパーがスマホ・タブレットで訪問先から入力し、サービス提供責任者が承認します。

## 状態

単一 HTML 実装から **React + Vite + TypeScript へ移行中**です。

- 移行計画: [docs/plans/2026-09-10-carerecords-react-migration.md](docs/plans/2026-09-10-carerecords-react-migration.md)
- 現在: Phase 1a ステップ1（足場作り）完了

## 開発

```
npm install
npm run dev        # http://localhost:5173
npm run build      # 型チェック + ビルド
npm run lint
```

## `legacy/` について

`legacy/` は移行元の単一 HTML 実装です。**移植の突き合わせ元として残しており、削除しません。**

```
legacy/index.html          移行元の実装（4,457行）
legacy/build.js            Artifact 共有用の dist/app.html を生成していたスクリプト
legacy/サーバーで起動.cmd    ローカルサーバー起動用（音声入力のため localhost が必要だった）
legacy/dist/app.html       生成物
```

移行元は `localStorage` にデータを保存し、サーバーへの送信は行いません。
そのまま開いて動作を確認できます（音声入力を使う場合は `legacy/サーバーで起動.cmd` が必要）。

新しい実装では Vite の dev server が `localhost` で動くため、この制約はありません。

## 画面

`画面キャプチャ/` に各画面のスクリーンショットがあります。移植時の見た目の基準として使います。

## 主な機能

- サービス実施一覧 / 未完了の訪問の管理
- 記録画面（バイタル・実施内容・特記事項、音声入力対応）
- 承認フロー（未承認一覧）
- 利用者マスタ、月間帳票、ヒヤリハット報告
- 記載チェック（実地指導対策）
