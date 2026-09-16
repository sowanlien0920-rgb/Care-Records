# carerecords

訪問介護のサービス実施記録アプリ。ヘルパーがスマホ・タブレットで訪問先から入力し、
サービス提供責任者が承認する。

## いま何をしているか

単一HTML実装から React + Vite + TypeScript へ移行している最中である。

**着手前に `docs/plans/2026-09-10-carerecords-react-migration.md` を読むこと。**
全6フェーズの構想、確定した要件、既存システムとの重複3件、実装計画がすべてそこにある。

## スタック

| | |
|---|---|
| フレームワーク | React 19（Vite の SPA。Next.js ではない） |
| ビルド | Vite 8 |
| 言語 | TypeScript（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`） |
| スタイル | **素の CSS。`src/styles.css` 1ファイル**（Tailwind を導入しない） |
| 状態管理 | Context + `useCareStore()`。外部ライブラリを追加しない |
| 永続化 | `localStorage`（Phase 5 で Firestore に差し替える） |

## ディレクトリ

```
src/
  types/      contract.ts  ← kpi-react との共有契約。変更は updating-contract スキルで
              local.ts     ← carerecords 固有の型
  data/       adapter.ts / localAdapter.ts / mock.ts   ← 永続化の境界
  domain/     compliance.ts（記載チェック）/ noteBuilder.ts（定型文生成）/
              aggregate.ts（帳票の集計・提供分数）/ visitStatus.ts / timeValidation.ts / vocabulary.ts
              ← React に依存しない純粋関数だけを置く
  store/      CareStoreProvider.tsx / useCareStore.ts
  hooks/      useSpeechInput.ts   ← React に依存する共有ロジック。domain には置けない
  features/   auth / shell / visitList / record / resident / approval / report / timeline / incident
  components/ 共通コンポーネント
  utils/      date.ts / csv.ts
  styles.css  ← legacy から移した 729行。書き換えない
legacy/       ← 移行元の単一HTML実装。突き合わせ用。削除しない
画面キャプチャ/ ← 各画面のスクリーンショット。見た目の基準
docs/plans/   ← 計画書
```

## この プロジェクト固有の鉄則

**1. `legacy/` を削除しない。書き換えない。**
移行元の 4,457行が唯一の仕様書である。移植の取りこぼしはここでしか検出できない。

**2. `src/styles.css` を書き換えない。クラス名を変えない。DOM の入れ子を変えない。**
legacy の CSS をそのまま持ち込んでいる。効かないときは DOM 側を legacy に合わせる。
コンポーネント分割は自由だが、出力される HTML の階層は legacy と同一にする。

**3. `localStorage` を直接触らない。**
必ず `useCareStore()` を経由する。Phase 5 で Firestore に差し替えるとき、
アダプタ境界を守っていないと差し替えが成立しない。
アダプタは `localStorage` 実装でも `Promise` を返す。

**4. 法定文書に属する情報を carerecords から書き込まない。**
要介護度 / 世帯状況 / ADL / 長期目標 / 短期目標 / 援助内容 / サービス内容 /
生活援助の算定理由 / 留意事項などは kpi-react が正であり、こちらは閲覧のみ。
とくに訪問介護計画書は kpi-react が版管理している。二重管理にすると
どちらが正か判定できなくなり、運営指導で問題になる。

**5. `.on` が無いと表示されないクラスがある。**
legacy は `classList.add('on')` で表示を切り替えていた。該当するクラスは
`login` / `mask`（モーダル）/ `toast` / `fbtn`（フィルタの選択状態）/
`lg-err` / `lg-eye` / `acc-row` / `prow` / `okdot` / `mic-live` の10種。
既定が `display:none` のものは、`on` を付けないと**何も表示されないのに
コンソールエラーも出ない**。移植したのに真っ白なときは、まずこれを疑う。

**6. legacy のバグを移植のついでに直さない。**
計画書の `## 5` の「実装中に気づいた点」に記録して先に進む。
仕様を変えると突き合わせが成立しなくなる。

## 専用のエージェントとスキル

| | 用途 |
|---|---|
| `legacy-reader`（エージェント） | legacy の実装を読み取って報告する。**4,457行を自分で読まずにこれに委譲する** |
| `parity-checker`（エージェント） | 移植後と legacy を突き合わせ、抜けを報告する |
| `porting-legacy-screen`（スキル） | 1画面を移植する手順 |
| `updating-contract`（スキル） | `src/types/contract.ts` を変更する手順 |

## コマンド

```
npm run dev        開発サーバー（http://localhost:5173）
npm run build      型チェック + ビルド
npm run typecheck  型チェックのみ
npm run lint       ESLint
```

音声入力（Web Speech API）は secure context を要求するが、`localhost` は
secure context として扱われるため dev server で動作する。

## 連携先

kpi-react（`../kpi-react`、`github.com/Taka1523/kpi-react`）と Firestore を共有する予定。
予定表・ルート表から配信ドキュメントを受け取り、実施記録を返す。
**kpi-react は読み取りのみ行い、変更しない。**

**例外（2026-09-14 に依頼者が解除）。** Phase 3（ヘルパーアカウント基盤）の作業範囲に限り、
kpi-react のソースを変更してよい。計画書は
`../kpi-react/docs/plans/2026-09-14-helper-account-phase3.md`。
Phase 4（配信ドキュメント生成）も同様に解除した（2026-09-14）。計画書は
`../kpi-react/docs/plans/2026-09-14-dispatch-generation-phase4.md`。
Phase 6（承認済み実施記録の取り込み）も解除した（2026-09-14）。計画書は
`docs/plans/2026-09-14-carerecords-phase6-record-import.md`。
この例外は Phase 3・4・6 の範囲に閉じる。それ以外は従来どおり読み取りのみ。
