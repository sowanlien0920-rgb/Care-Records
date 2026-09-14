---
request: carerecords Phase 5a（Firebase Auth によるログインと firestoreAdapter への差し替え）を実装する
status: planning
created: 2026-09-14
review_required: yes
---

<!--
status の遷移:
  clarifying    → clarifying-requirements 実行中/完了
  investigating → investigating-codebase 実行中
  planning      → planning-feature 実行中
  implementing  → implementing-feature / modifying-feature 実行中
  reviewing     → reviewing-code 実行中(review_required: yes の場合のみ)
  verifying     → verifying-changes 実行中
  done          → 完了
-->

## 1. Request

```
Phase 5 の firestoreAdapter
```

（2026-09-14、選択肢からの指定。Auth のスロットル解除を待つ間の作業として選ばれた。）

Phase 1a の計画書（`2026-09-10-carerecords-react-migration.md:48-52`）にある Phase 5 の範囲は
**Firestore 接続 / Firebase Auth / PWA 化**の3つ。Hosting は 2026-09-14 に前倒しで済んでいる。

**本計画書は Firestore 接続と Firebase Auth のみを対象とし、PWA 化は含めない**（理由は `## 4` の
「範囲から外したもの」）。以降これを **Phase 5a** と呼ぶ。

## 2. Clarified Requirements

### 前提（すでに満たされている）

kpi-react 側は 2026-09-14 時点で以下がデプロイ済みである。carerecords が繋ぐ先は実在する。

| | 内容 |
|---|---|
| Phase 2 | Firestore セキュリティルール。`supervisor` / `helper` ロールを含む |
| Phase 3 | アカウント発行 UI。`users/{uid}` に `role` / `facilityId` / `staffId` / `loginId` / `canApprove` を書く |
| Phase 4 | 配信生成。`facilities/{fid}/dispatches/{date}_{staffId}` に契約版3 で書く |

### 未確定事項

**本計画書には、着手前に依頼者の判断が要る未確定が4件ある。** うち1件は計画そのものを左右する。

#### U1（最重要）. kpi-react のルールを変更してよいか

**現在のルールでは、carerecords の3つの経路が確実に弾かれる。**
`isKpiUser()`（`firestore.rules:122`）は `supervisor` / `helper` を含まないため、
ヘルパーとサ責は次を読み書きできない。

| 経路 | 現状 | 必要なもの |
|---|---|---|
| `listStaff()` | `facilities/{fid}/staffs` は `kpiCollections()` 側で `isKpiUser()` 必須 | ルール追加、または後述の代替 |
| `appendAuditLog()` / `listAuditLogs()` | `auditLogs` は `allow create: if isKpiUser()`（`:400`） | ルール追加 |
| `getPrefs()` / `savePrefs()` | `RecordPrefs` を置くコレクションが存在しない | コレクション新設 + ルール |

`CLAUDE.md` の例外は **Phase 3・4 の範囲に閉じており、Phase 5 は含まれない。**
ルールを触るには依頼者が例外を広げる必要がある。

**`listStaff()` だけは、ルールを変えずに済む代替がある。**
配信ドキュメント（`facilities/{fid}/dispatches`）は `{date}_{staffId}` で、`staffId` と
`staffName` を持つ。サ責は自施設の配信を全件読めるため、**配信から職員一覧を導出できる。**
ただし「その日に訪問が無い職員」は出てこないので、職員切替の選択肢が日によって変わる。

`auditLogs` と `RecordPrefs` には代替が無い。**ルールを広げないなら、この2つは
`localStorage` に残したままにするしかない**（アダプタが2つの保存先にまたがる形になる）。

#### U2. ヒヤリハットの統合先（Phase 1a の決定 J）

`incidentAdapter.ts` の冒頭のとおり保留のまま。`adapter.ts` は「Phase 5 までに決める」としている。
**Phase 5a では触らない**方針で計画したが、決めるなら今である。

#### U3. バッジの `pending` はロールによって意味が変わる

`adapter.ts` の `BadgeCounts.pending` は「全職員・全期間の『済』件数」だが、
ルール上ヘルパーは他人の `visitRecords` を読めない。**ヘルパーの端末では必ず0になるか、
権限エラーになる。** 「ヘルパーには出さない」「自分の分だけ数える」のどちらかに決める必要がある。

#### U4. 訪問先の電波が切れたときの挙動

Firestore のオフライン永続化を有効にするかどうか。有効にすると記録は端末に溜まって
後から同期されるが、**「保存した」と見えて実際は未送信**の状態が生まれる。
法定文書なので、どちらを取るかは運用の判断になる。**Phase 5a では既定（オフライン無効）で計画し、
PWA 化と併せて決める。**

### この前提で計画した

U1 は **「例外を広げてルールを変更できる」前提**で `## 4` を書いている。
広げられない場合、ステップ6 の内容が変わる（代替案を併記した）。
U2・U4 は範囲外、U3 はステップ5 で決める。

## 3. Existing System Investigation

`investigating-codebase` は実行していない。**2026-09-14 にこの計画のために直接読んで確認した**ため。
確認した事実だけを書く。

### carerecords 側

- **`firebase` への依存が無い**（`package.json`）。SDK の追加から始まる
- 永続化の境界は `src/data/adapter.ts`（158行）の `DataAdapter` 1枚。**Promise を返す設計になっており、
  同期前提の呼び出し元は存在しない**。差し替えの前提は守られている
- `AdapterError` は `kind` に `'network'` / `'forbidden'` を**すでに持っている**（Phase 5 用に用意済み）
- `VisitScope` が `{kind:'all'} | {kind:'staff'}` を呼び出し側に必ず選ばせる形になっている。
  ルールの scope とそのまま対応する
- 認証は `src/features/auth/StaffPicker.tsx`（98行）の簡易ログインのみ。
  セッションは `getSessionStaffId` / `saveSessionStaffId` でアダプタの裏にある
- ロール対応表 `toRuleRole()` が `src/types/local.ts` にあり、**日本語ロール → `facility` /
  `supervisor` / `helper` の変換はすでに存在する**。ルール側の3値と一致している
- ヒヤリハットは `incidentAdapter` として `DataAdapter` の外にある（保留を保つため）

### kpi-react 側（読み取りのみ）

| 対象 | 位置 | 内容 |
|---|---|---|
| 配信の書き出し先 | `src/hooks/useFirestore.js:1318-1323` | `facilities/{fid}/dispatches/{date}_{staffId}` |
| 配信の読み | `firestore.rules:318-320` | `isKpiUser() \|\| isSupervisor() \|\| (isHelper() && 自分の dispatchId)` |
| 実施記録 | `firestore.rules:355-381` | 承認は `canApprove()` を持つ者のみ。**承認者 ID は本人の staffId に固定** |
| ロール定義 | `firestore.rules:36-39` | `users/{uid}` に `role` / `facilityId` / `staffId` / `canApprove` |
| ログイン ID | `src/pages/AccountPage.jsx` | `toEmail(facilityId, seq)` / `toLoginId(facilityCode, seq)` |

**`toEmail()` と同じ変換が carerecords 側にも要る。** ヘルパーが入力するのはログイン ID であって
メールアドレスではないため、同じ規則でメールに戻してから `signInWithEmailAndPassword` に渡す。
規則が片方だけ変わるとログインできなくなるので、**契約と同じ扱いで同期させる必要がある**。

## 4. Implementation Plan

### 方針

**`DataAdapter` の実装を1つ増やすだけにする。インターフェースは変えない。**
`adapter.ts` の冒頭コメントが約束している形をそのまま実行する。UI とドメインには手を入れない。

`onSnapshot` による購読ではなく、**`getDocs` / `getDoc` の一回読みにする。**
理由は2つ。`DataAdapter` が `Promise` を返す形で確定しており、購読にすると
インターフェースごと変わって差し替えの意味が消えること。もう1つは、訪問先で使うアプリであり
画面を開いている間の常時接続が電池と通信量に直結すること。
リアルタイム性が要るのは承認待ちの通知くらいで、Phase 6 の範囲になる。

`firebase.js` を kpi-react からコピーしない。**carerecords は Auth と Firestore しか使わない**
（Storage・App Check・クロスプロジェクトは不要）。必要な初期化だけを書く。

### 範囲から外したもの

- **PWA 化**。オフライン永続化（U4）と一体で判断すべきで、「保存したのに送信されていない」の
  扱いを決めないまま入れると法定文書の記録として危うい。Phase 5b とする
- **ヒヤリハットの統合先**（U2）。`incidentAdapter` は `localStorage` のまま残す
- **kpi-react 側の実施記録の閲覧・承認画面**。Phase 6

### 変更対象ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `package.json` | 変更 | `firebase` を追加 |
| `.env.local` / `.env.example` | 新規 | Firebase の設定値。**リポジトリに実値を入れない** |
| `src/firebase.ts` | 新規 | 初期化。Auth と Firestore のみ |
| `src/data/firestoreAdapter.ts` | 新規 | `DataAdapter` の Firestore 実装 |
| `src/data/loginId.ts` | 新規 | ログイン ID ↔ メールの変換。kpi-react の `AccountPage.jsx` と同期させる |
| `src/features/auth/LoginForm.tsx` | 新規 | ログイン ID + パスワード。legacy の `.login` / `.lg-err` / `.lg-eye` を使う |
| `src/features/auth/StaffPicker.tsx` | 変更 | サ責の職員切替としてのみ残す（ログイン手段ではなくなる） |
| `src/store/CareStoreProvider.tsx` | 変更 | アダプタの選択、ログイン状態の保持、ロールの取得元を `users/{uid}` に |
| `src/data/adapter.ts` | 変更 | 変更なしで済むのが理想。必要なら U3 の結論のみ反映 |
| `firestore.indexes.json`（kpi-react） | 変更 | 横断クエリの複合インデックス |
| `firestore.rules`（kpi-react） | 変更 | **U1 の承認が前提。** `auditLogs` / `recordPrefs` / `staffs` 読み |

### データ構造の変更

**`migrating-database` は不要。** 移行すべき既存データが無い。
carerecords の `localStorage` にあるのは開発中に作った記録だけで、実運用の記録は存在しない
（Phase 1a の決定 G）。kpi-react 側の `dispatches` は Phase 4 が生成済みで、形は契約版3 に一致している。

`RecordPrefs` を Firestore に置く場合はコレクションの新設になるが、既存データの変換は伴わない。

### 実装順序

各ステップは単独でコミットできる。前が次の前提になる順に並べた。

| # | 内容 | 完了条件 |
|---|---|---|
| 1 | `firebase` 追加、`src/firebase.ts`、env の受け取り | `npm run build` が通る。実値をコミットしていない |
| 2 | `loginId.ts` と `LoginForm.tsx`。Auth でログインし `users/{uid}` からロールを取る | 発行済みアカウントで実際にログインでき、ロールに応じて画面が出し分かる |
| 3 | `firestoreAdapter` の配信読み（`getDispatch`）。`parseDispatch` を必ず通す | Phase 4 が書いた実データの配信が画面に出る |
| 4 | 実施記録の読み書き（`listRecords` / `saveRecord` / `deleteRecord`） | 記録が Firestore に保存され、承認がルールに弾かれない |
| 5 | 横断クエリ（`listVisitRows` / `getBadgeCounts`）とインデックス。**U3 をここで決める** | 未承認一覧・帳票がヘルパーとサ責の双方で破綻しない |
| 6 | 残る3経路（`listStaff` / `getPrefs` / `listAuditLogs`）。**U1 の結論で内容が変わる** | 全メソッドが Firestore 実装を持つ、または localStorage 据え置きの理由が書かれている |

ステップ6 は U1 が通らない場合、「`listStaff` は配信から導出、`prefs` と `auditLogs` は
`localStorage` 据え置き」に差し替える。**その場合アダプタが2つの保存先にまたがるため、
どのメソッドがどちらを見るかを `firestoreAdapter.ts` の冒頭に明記すること。**

### 適用する Craft Skills

| Skill | 適用する理由 |
|---|---|
| `reviewing-data-boundaries` | Firestore ↔ アプリの境界そのものが本体。ヘルパーに他人の記録を渡さないことがルールと実装の両方で成立している必要がある |
| `handling-async-states` | 全経路が通信になる。loading / error / empty / success に加え、`forbidden` と `network` を利用者に区別して見せる必要がある（`AdapterError` が既に分けている） |
| `designing-api-contracts` | ログイン ID ↔ メールの変換規則が kpi-react との新しい契約になる。片方だけ変わるとログインできなくなる |
| `writing-forms` | ログインフォーム。失敗時の入力保持、重複送信の防止、`auth/too-many-requests` を含むエラーの出し分け |
| `designing-ui-components` | ログイン画面は新規。ただし legacy の `.login` を使うため、鉄則2・5 に従い DOM 階層とクラス名を写す |

`choosing-rendering-strategy` は適用しない（Next.js 前提のスキルであり、本プロジェクトは Vite の SPA）。
`optimizing-performance` も適用しない（性能要件の提示が無い）。
`making-accessible` は適用しない（ログインは通常の入力とボタンのみ。モーダル等を新設しない）。

### Review Required: **yes**

理由。該当項目が多い。

- **認証の変更**（簡易ログイン → Firebase Auth）
- **認可・アクセス制御の変更**（ロールの取得元が `users/{uid}` になる。ルールも触る）
- **共通ユーティリティの変更**（`DataAdapter` は全画面が依存する）
- **セキュリティに関わる変更**（ヘルパーが他人の記録を読めないことの担保）

加えて `auditing-security` の対象でもある。Rules を変更する場合は
`security-auditor` を通すこと（ステップ6 の後）。

### リスク

| # | リスク | 対処 |
|---|---|---|
| 1 | **ルールに弾かれる経路が、実装しきってから判明する。** `isKpiUser()` の除外は今回1件見つけたが、他にもありうる | ステップごとに実データで通す。まとめて最後に確認しない。エミュレータ（`firestore` ポート 8085 が kpi-react に設定済み）でルールを先に試す |
| 2 | **`auth/too-many-requests`（2026-09-14 に発生中）が検証を止める。** ログイン実装の確認は Auth を叩く | ステップ1 と3以降は Auth に依存しない。**ステップ2 を解除後に回して他を先に進められる**ように順序を組んである |
| 3 | 訪問先の電波でのふるまいが未検証（U4） | Phase 5b に送る。5a では既定のまま |
| 4 | `getBadgeCounts` の `pending`（全職員・全期間）が、ヘルパーの権限では取得できない | U3 としてステップ5 で決める。**ルールに弾かれる前に、アプリ側でロールを見て経路を分ける** |
| 5 | ログイン ID ↔ メールの変換が kpi-react 側と静かにずれる | `contract.ts` と同じ扱いにし、`updating-contract` の同期手順に `loginId.ts` を加える |
| 6 | 実データで動かすため、**開発中の操作が本番の `visitRecords` に書かれる** | 検証用の施設・職員を決めてから着手する。これは着手前に依頼者と確認する |

## 5. Implementation Status

未着手。

## 6. Verification

未実施。

## 7. Result

未完了。
