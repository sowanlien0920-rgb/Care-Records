---
request: carerecords Phase 5a（Firebase Auth によるログインと firestoreAdapter への差し替え）を実装する
status: implementing
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

**2026-09-14、依頼者が例外を広げた。`auditLogs` と `RecordPrefs` の置き場のために
kpi-react の `firestore.rules` を変更してよい。** 以降この前提で進める。
`CLAUDE.md` の例外は Phase 3・4 に加えて **Phase 5a のうちルール変更に限り**解除された。

なお `listStaff()` には、ルールを変えずに済む代替もある。
配信ドキュメント（`facilities/{fid}/dispatches`）は `{date}_{staffId}` で、`staffId` と
`staffName` を持つ。サ責は自施設の配信を全件読めるため、**配信から職員一覧を導出できる。**
ただし「その日に訪問が無い職員」は出てこないので、職員切替の選択肢が日によって変わる。

`auditLogs` と `RecordPrefs` には代替が無いため、こちらはルールの変更で対応する。

#### U2. ヒヤリハットの統合先（Phase 1a の決定 J）

`incidentAdapter.ts` の冒頭のとおり保留のまま。`adapter.ts` は「Phase 5 までに決める」としている。
**Phase 5a では触らない**方針で計画したが、決めるなら今である。

#### U3. バッジの `pending` はロールによって意味が変わる

`adapter.ts` の `BadgeCounts.pending` は「全職員・全期間の『済』件数」だが、
ルール上ヘルパーは他人の `visitRecords` を読めない。**ヘルパーの端末では必ず0になるか、
権限エラーになる。** 「ヘルパーには出さない」「自分の分だけ数える」のどちらかに決める必要がある。

#### U4-a. 検証に使う施設（2026-09-14 に確定）

**「どの施設でも操作できるように」= 検証する依頼者自身が、という意味。**
依頼者は既存の全体管理者（`superAdmin` / `admin`）で入る。`isGlobalAdmin()` は
`inScope()` を素通りするため、**ルールの変更も検証用アカウントの新設も要らない。**

**ヘルパーとサ責は自施設のままとする。** `inScope()`（`firestore.rules:135`）の
`myFacility() == fid` は変えない。職員が施設をまたぐ話ではないことを確認済み。
兼務職員の要望が出た場合は `users/{uid}.facilityId` が単数であるところからの
設計見直しになるため、別の計画として扱う。

#### U4-b. 訪問先の電波が切れたときの挙動

Firestore のオフライン永続化を有効にするかどうか。有効にすると記録は端末に溜まって
後から同期されるが、**「保存した」と見えて実際は未送信**の状態が生まれる。
法定文書なので、どちらを取るかは運用の判断になる。**Phase 5a では既定（オフライン無効）で計画し、
PWA 化と併せて決める。**

### この前提で計画した

**U1 と U4-a は 2026-09-14 に確定した**（上記）。残る未確定は U2（ヒヤリハットの統合先。
本計画の範囲外）と U4-b（オフライン永続化。Phase 5b）、および U3（ステップ5 で決める）。
**着手を妨げる未確定は無い。**

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

### 開発と検証をエミュレータで行う（2026-09-14 に追加）

**`auth/too-many-requests` で本番の Auth が使えなくなったため、開発と検証を
Firebase エミュレータで行うことにした。** 依頼者の判断（2026-09-14）。

エミュレータの Auth はスロットルされないので、テスト用のヘルパー・サ責アカウントを
制限なく作れる。`firestore.rules` を実際に適用した状態で動くため、
**ステップ6 のルール変更も本番に触れずに検証できる。**

**リスク6（開発中の操作が本番の `visitRecords` に書かれる）はこれで消える。**

前提はすべて揃っている（2026-09-14 に確認）。

| | |
|---|---|
| firebase-tools | 15.12.0 |
| Java | OpenJDK 21.0.10（エミュレータの必須要件） |
| firestore エミュレータ | kpi-react の `firebase.json` にポート 8085 で設定済み |
| auth エミュレータ | 設定不要。`--only auth,firestore` で既定ポート（9099）で起動する |

**kpi-react の `firebase.json` は変更しない。** ルール（`firestore.rules`）以外に
kpi-react を触る必要は無い。エミュレータは kpi-react のディレクトリから起動する。

#### 限界（承知のうえで進める）

- **App Check の判定は先送りになる。** エミュレータでは App Check が掛からないため、
  `## 2` の懸念（Enforce なら弾かれる）は本番に繋ぐまで分からない
- **seed はモックデータである。** Phase 4 が実データで生成した配信との突き合わせは、
  本番に繋いだ時点で別途必要になる。`mock.ts` が実データと乖離していれば、
  そのぶんだけ本番での手戻りが残る（Phase 1a のリスク3 と同じ話）

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
| `firestore.rules`（kpi-react） | 変更 | `auditLogs` / `recordPrefs` / `staffs` 読み。**U1 で承認済み** |
| `src/firebase.ts` | 変更 | dev 時のエミュレータ接続（`VITE_USE_EMULATOR`）。**エミュレータ導入で追加** |
| `scripts/seedEmulator.mjs` | 新規 | エミュレータに職員アカウントと配信を流し込む。**同上** |
| `package.json` | 変更 | `firebase-admin`（devDependency）と `emulators` / `seed` スクリプト。**同上** |

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

ステップ6 は U1 が承認されたため、ルールを広げて3経路とも Firestore に置く。
ルールを触るので、このステップの後に `security-auditor` を通すこと。

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
| 6 | ~~実データで動かすため、開発中の操作が本番の `visitRecords` に書かれる~~ | **エミュレータの導入で解消した（2026-09-14）。** 開発中は本番に一切書かない。本番に繋ぐのはステップ6 の後 |
| 7 | **エミュレータで通ったものが本番で通るとは限らない。** App Check、実データの形、複合インデックスの有無は本番でしか確かめられない | エミュレータでの通過を「検証済み」と書かない。`## 6` で本番と分けて記録する |

## 5. Implementation Status

- [x] **ステップ1** — `firebase` の追加、`src/firebase.ts`、env の受け取り（2026-09-14）
- [x] **ステップ1b** — エミュレータ基盤（2026-09-14。計画の追加分）
- [x] **ステップ2** — `loginId.ts` と `LoginForm.tsx`（2026-09-14）
- [x] **ステップ3** — 配信の読み（`getDispatch`）（2026-09-14）
- [x] **ステップ4** — 実施記録の読み書き（2026-09-14）
- [x] **ステップ5** — 横断クエリ。U3 を決めた（2026-09-14）。**複合インデックスは未作成**
- [x] **ステップ6** — 残る3経路とルール変更（2026-09-14）。**ルールは未デプロイ**

### ステップ1 の内容

| ファイル | 内容 |
|---|---|
| `package.json` | `firebase@^12.19.0` を追加 |
| `.env.local` | 実値。`.gitignore` 済み。権限は 600 |
| `.env.example` | キー名のみ |
| `src/firebase.ts` | 初期化。`app` / `auth` / `db` / `PROJECT_ID` を export |

**env は4つに絞った**（`API_KEY` / `AUTH_DOMAIN` / `PROJECT_ID` / `APP_ID`）。
kpi-react の `.env` は14個あるが、Storage・Analytics・reCAPTCHA・事故管理プロジェクトは
carerecords では使わない。**使わない設定を持ち込むと、繋がっていない先に
繋がっているように読める。**

設定が欠けているときは `required()` が起動時に落とす。`undefined` のまま
`initializeApp` に渡すと「認証だけ失敗する」「読めるが書けない」のように症状が散らばり、
設定漏れだと気づくまで遠回りになる。

**永続化は既定（`browserLocalPersistence`）のままにした。** kpi-react は
`inMemoryPersistence` だが、あちらは事務所の共有端末が前提である。carerecords は
ヘルパー個人の端末で訪問先から使うため、再読込のたびのログインは成立しない
（`adapter.ts` の `getSessionStaffId` のコメントと同じ理由）。

### ステップ1b（エミュレータ基盤）の内容

| ファイル | 内容 |
|---|---|
| `firebase.emulators.json` | 新規。エミュレータ専用の設定 |
| `firestore.rules` | 新規。`../kpi-react/firestore.rules` への **symlink** |
| `scripts/seedEmulator.ts` | 新規。Admin SDK で seed する |
| `src/firebase.ts` | `VITE_USE_EMULATOR=1` のとき `connectAuthEmulator` / `connectFirestoreEmulator` |
| `package.json` | `firebase-admin` / `tsx`（devDependency）、`emulators` / `seed` スクリプト |

**`firebase.json` にエミュレータ設定を書かなかった。** そこに `firestore.rules` を書くと、
carerecords から `firebase deploy` を打ったときに **nursinglog へ kpi-system-a718f 用の
ルールを配ってしまう**。配布先を間違えると本番のアクセス制御が壊れる。
別ファイル（`firebase.emulators.json`）にしておけばその事故が起きない。

**ルールは symlink にした。** firebase-tools がプロジェクト外のパスを拒む
（`../kpi-react/firestore.rules is outside of project directory`）ため。
コピーすると kpi-react と carerecords にルールが2つ存在することになり、
どちらが正か分からなくなる。symlink なら実体は kpi-react 側の1つだけで済む。

**seed には安全弁を置いた。** Admin SDK はセキュリティルールを迂回するため、
接続先を間違えると本番の `facilities` 配下にモックが混ざる。
エミュレータのホストが localhost を指していることを検査し、
満たさなければ何も書かずに終了する。

動作を確認した（2026-09-14）。

```
配信 15 件（2026-09-13 / 2026-09-14 / 2026-09-15）
MOCK001 中山 理恵（supervisor）  MOCK002 佐藤 健一（helper）
MOCK003 鈴木 美咲（helper）      MOCK004 田中 陽子（helper）
MOCK005 大橋 直人（facility）    パスワードはいずれも 000000
```

### ステップ2〜6 の内容

| ファイル | 内容 |
|---|---|
| `src/data/loginId.ts` | 新規。ログイン ID ↔ メールの変換と施設コードの対応表 |
| `src/features/auth/LoginForm.tsx` | 新規。legacy の `.login`（`index.html:741-807`）を写した |
| `src/data/firestoreAdapter.ts` | 新規。`DataAdapter` の全メソッド |
| `src/store/CareStoreProvider.tsx` | `onAuthStateChanged` の購読、アダプタの選択 |
| `src/App.tsx` | 未ログイン時に出すものを backend で出し分け |
| `src/firebase.ts` | `BACKEND`（`VITE_BACKEND`）の追加 |
| `firestore.rules`（kpi-react） | `recordPrefs` / `auditLogs` / `staffs` 読み / **配信の get と list の分離** |

#### 決めたこと

**U3（バッジの `pending`）: 承認権限を持つ職員だけが数える。**
ルール上ヘルパーは他人の記録を読めず、全件を数えようとすると permission-denied になる。
画面側も未承認一覧のボタンを `canApprove` で出し分けており（`features/shell/Toolbar.tsx:36`）、
ヘルパーには元から表示されない。**数えずに 0 を返すのが実態と一致する。**

**carerecords の変更履歴は `facilities/{fid}/auditLogs` に置く。**
トップレベルの `auditLogs` は kpi-react の操作履歴で、形も用途も違う。
同じコレクションに混ぜると kpi-react の履歴画面に carerecords の行が混入する。

**職員の権限は `users/{uid}` からのみ取る。** `facilities/{fid}/staffs` は表示用のマスタで、
承認権限を持たない。`listStaff()` は自分自身の行だけ `users` の値で上書きし、
他の職員は承認権限なしとして返す。他人の `users` を読む権限は無く、
他人の承認権限を画面が使う箇所も無い。

### 実装中に気づいた点

**1. 接続先は Hosting のプロジェクトと違う。** carerecords の Hosting は `nursinglog` だが、
Auth と Firestore は `kpi-system-a718f` を見る。配信も職員アカウントもそちらにあるため。
**ホスティングと認証が別ドメインにまたがる**ことを `src/firebase.ts` の冒頭に明記した。

**2. App Check が Enforce なら全リクエストが弾かれる。** kpi-react の
`src/firebase.js:24` に「本番ではコンソールで Enforce に設定」とある。
コンソールの設定はコードから確認できない。**2026-09-14 時点で未確認のまま進めている。**
ステップ3 で初めて Firestore を読むので、弾かれるならそこで分かる。
その場合は `src/firebase.ts` に App Check を足し、reCAPTCHA のサイトキーに
carerecords のドメインを登録する必要がある。

**5. ヘルパーは配信を「1件取得」できても「一覧クエリ」ができなかった。**
**計画のリスク1 が実際に起きた。** ルールの `myDispatchId()`（`firestore.rules:320`）は
doc ID で判定しているが、**クエリに対するルールは「その絞り込みで返りうる全件が条件を満たすか」を
クエリの where だけから証明する必要があり、doc ID の形は where で絞れない。**
そのためヘルパーの `where('staffId','==',自分)` すら permission-denied になっていた。

**症状が出ない形で壊れていた。** `Toolbar.tsx:27` は取得できないとき 0 を表示するため、
未完了バッジが「0件」と出るだけで、エラーも警告も出なかった。
記録が1件も無い状態で 0 はおかしいと気づいて初めて分かった。

`allow read` を `allow get` と `allow list` に分けて直した。
get は doc ID（配信が無い日に resource が null になるため）、list は
`resource.data.staffId` で判定する。エミュレータで、絞り込み無しの全件取得が
ヘルパーに対して今も拒否されることを確認済み。

**エミュレータを入れていなければ、本番で初めて分かっていた。**

**4. ログイン ID からメールアドレスを導出できない。**
kpi-react の `toEmail(facilityId, seq)` は**施設 ID**、`toLoginId(facilityCode, seq)` は
**施設コード**を使う（`AccountPage.jsx:43-45`）。別の値なので、ログイン ID だけでは
メールを組み立てられない。対応表を引くには Firestore を読む必要があるが、
**ログイン前は未認証なので読めない。**

これは Phase 3 の時点で気づかれており、`AccountPage.jsx:38-42` に
「対応表は carerecords のバンドルに静的に持たせる」と方針が書かれている。
ステップ2 はこれに従う。**実際の施設コードと施設 ID の対応は依頼者から受け取る必要がある。**

**3. `src/firebase.ts` はまだどこからも import されていない。**
型チェック（`tsc -b`）の対象には入っているが、バンドルには含まれていない
（ビルド後のサイズがステップ1 の前後で 444.14 kB のまま変わらない）。
**実際に Firebase へ繋がることは、この時点では確認できていない。** ステップ2 以降で確認する。

## 6. Verification

**実装者による確認であり、`verifying-changes` の検証ではない。**
`## 5` のチェックと同じ扱いで読むこと。

### エミュレータで確認したこと（2026-09-14）

headless ブラウザで実際に操作した結果のみを書く。

| 項目 | 結果 |
|---|---|
| ログイン画面が出る | `.login` が `display:flex`（`on` が効いている） |
| 空のまま送信 | `.lg-err` に `on` が付き「職員IDとパスワードを入力してください。」 |
| 目のトグル | `#lgPw` の type が text になり `.lg-eye` に `on` |
| 誤ったパスワード | 「職員IDまたはパスワードが正しくありません。」。**入力したパスワードは消えない** |
| ヘルパー（MOCK002）でログイン | 佐藤 健一 / 訪問介護員。配信6件が表示。未完了 11 |
| ヘルパーの権限 | 未承認一覧ボタンと帳票ボタンが**出ない** |
| ログアウト | ログイン画面に戻る |
| サ責（MOCK001）でログイン | 中山 理恵 / サービス提供責任者。配信12件。未完了 23 / 未承認 0 |
| サ責の権限 | 未承認一覧・帳票の両ボタンが出る |
| コンソールエラー | 0件 |

ルールの効き方は Firestore のクエリを直接叩いて確認した。

| クエリ（ヘルパーとして） | 結果 |
|---|---|
| `dispatches` を `staffId == 自分` で絞る | 3件（通る） |
| `dispatches` を `staffId == 自分` + `date <= 今日` | 2件（通る） |
| **`dispatches` を絞り込み無しで全件** | **permission-denied（意図どおり拒否）** |
| `visitRecords` を `staffId == 自分` で絞る | 0件（記録が無いため。通る） |
| `staffs` | 5件（通る） |

### 未確認（本番でしか確かめられない）

- [ ] **App Check。** Enforce なら全リクエストが弾かれる。エミュレータでは掛からない
- [ ] **複合インデックス。** `staffId` + `date` の組み合わせで引いている。
      エミュレータはインデックスを要求しないため、**本番で
      「The query requires an index」になる可能性がある。** `firestore.indexes.json` は未作成
- [ ] **実データの形。** seed はモックであり、Phase 4 が実データで生成した配信では試していない
- [ ] **施設コードの対応表。** `loginId.ts` にはエミュレータ用の1件しか入っていない。
      本番の施設コード → 施設 ID を受け取るまで、本番ではログインできない
- [ ] スマホ実機

### 未実施

- 承認の経路（`canApprove` を持つ職員が承認したときにルールが承認者 ID を固定する部分）
- 記録の保存・削除を実際に行う操作（`saveRecord` / `deleteRecord` はコードのみ）
- 記録設定（`getPrefs` / `savePrefs`）と変更履歴の読み書き

## 7. Result

未完了。
