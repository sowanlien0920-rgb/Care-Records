---
request: carerecords を単一HTMLから React + Vite + TypeScript に移行する（kpi-react 連携の Phase 1）
status: implementing
created: 2026-09-10
review_required: yes
---

## 1. Request

依頼者との対話で確定した依頼内容（原文）。

> carerecordsに下記のURLのファイルをクローンして
> https://github.com/sowanlien0920-rgb/Care-Records

> kpi-reactのfirebaseのデータベースとこのシステムのデータベースを共有したい
> 使用感としては予定表、ルート表、carerecordsを連携できるようにしていく想定にしている
> まずは可能かどうか検討しよう

> ヘルパー各自がスマホ・タブレットで、訪問先で入力
> kpi-reactでは他の情報を見られたくないので、ヘルパーにはこのcarerecordsだけ使用するようにしたい
> あくまでデータ連携が取れればいい
> 職員ごとの記録がいつようになるので、現在のkpireactとは認証やユーザーの管理方法が異なることも把握している

> まずcarerecordsを単一htmlからreact vite typescriptに変更した方がいいと思うがどうか？

> 着手しよう

### 全体構想における位置づけ

対話の結果、以下のフェーズ分割で合意した。本計画書は **Phase 1** のみを対象とする。

| Phase | 内容 | 対象リポジトリ |
|---|---|---|
| **1** | **carerecords を React + Vite + TS 化（localStorage のまま、新データモデル + アダプタ境界）** | **carerecords** |
| 2 | Firestore ルール作り直し + kpi-react 全経路の回帰確認 | kpi-react |
| 3 | ヘルパーアカウント基盤（`users` 拡張、発行UI） | kpi-react |
| 4 | 配信ドキュメント生成（`saveVisitRoute` に相乗り） | kpi-react |
| 5 | carerecords のアダプタを Firestore に差し替え + PWA + Hosting | carerecords |
| 6 | kpi-react 側に実施記録の閲覧・承認画面 | kpi-react |

Phase 1 と Phase 2 は独立しており並行できる。

## 2. Clarified Requirements

### 確定

**移行の形**

- carerecords を単一 HTML（`index.html` 4,457行）から React + Vite + TypeScript の構成に移行する
- Phase 1 の時点でバックエンドは **localStorage のまま**とする。Firestore 接続は Phase 5 で行う
- データ永続化は**アダプタ1枚の裏に隠す**。Phase 5 では `localAdapter` を `firestoreAdapter` に差し替えるだけで済む形にする
- CSS 731行は Tailwind 化せず、そのまま `styles.css` として持ち込む。見た目を変えないことで移植の突き合わせを可能にする
- 現行 `index.html` は削除せず、挙動の突き合わせ元としてリポジトリに残す（`c1ffb7d` でコミット済み）

**データモデル**

- Phase 1 の時点から**新データモデル**を採用する。現行の `db.visits`（予定と実績が同居）は使わない
- 「配信（dispatch）= 読み取り専用の予定」と「実施記録（visitRecord）= 書き込む実績」に分離する
- Phase 1 では配信データを localStorage 上のモックで生成する（Phase 4 で kpi-react が生成するものに置き換わる）
- 利用者・職員は**氏名文字列ではなく ID で参照する**（`residentId` / `staffId`）
  - kpi-react の `residentList` / `staffs` は既に `Date.now().toString()` の安定 ID を持つことを確認済み

**移植する資産（純粋ロジック、約870行）**

以下は `domain/` 配下の `.ts` としてほぼそのまま移植する。UI から独立している。

| 現行の位置 | 行数 | 移植先 |
|---|---|---|
| 記載チェック（実地指導対策） `index.html:2326-2800` | 474 | `domain/compliance.ts` |
| 特記事項の一括作成 `index.html:2800-2947` | 147 | `domain/noteBuilder.ts` |
| 帳票・集計 `index.html:3583-3751` | 168 | `domain/aggregate.ts` |
| 実績時間バリデーション `index.html:3064-3149` | 85 | `domain/timeValidation.ts` |

**消える／置き換わるもの（約520行）**

| 現行の位置 | 行数 | 理由 |
|---|---|---|
| 描画（手動 re-render） `index.html:1703-1788` | 85 | React が肩代わりする |
| データ層 `index.html:1638-1703` | 65 | アダプタに置き換わる |
| 職員アカウント・ログイン `index.html:4084-4457` | 373 | Phase 3 で Firebase Auth に置き換わる（※ Phase 1 での扱いは未確定、後述） |

**型定義**

- `Dispatch` / `VisitRecord` / `Resident` / `Staff` の型を定義し、kpi-react と共有する契約とする
- 実施記録は法定文書であり、スキーマの不一致は不具合ではなく運営指導での指摘リスクにあたる。型で防ぐことを移行の主目的の一つとする

### 決定済み（2026-09-10 追記）

**D. サービス提供責任者・管理者も carerecords を使う** → 確定

これにより以下が連動して確定した。

- **B. ヘッダーの職員切替は残す。** ただしロールで制御する
  - 訪問介護員: 自分の分のみ。切替不可
  - サービス提供責任者・管理者: 事業所内の全職員を切替可能
- **C. サ責向け機能は carerecords に残す。** 未承認一覧 / 一括承認 / 帳票・集計 / 利用者の経過記録 / CSV出力 はすべて移植対象とする

さらに全体構想が変わる。

- **Phase 6 の性格が変わる。** 承認を carerecords で完結させるなら、kpi-react 側に承認画面は要らない。kpi-react が必要とするのは「承認済み実績を月間帳票・給付管理（`serviceRecords` / `benefits`）に取り込む」ことだけになる。Phase 6 は「閲覧・承認画面の新設」から「承認済み実績の取り込み」に縮小する
- **Phase 2 のルールが3ロールになる。** `facility`（kpi-react 全権）/ `supervisor`（carerecords 系のみ全件 + 承認）/ `helper`（carerecords 系のうち自分の分のみ）。Phase 2 の工数は増える

**H. AI 特記事項は Cloud Functions 経由に変更する** → 確定（Blaze プランへの移行可能と確認済み）

- ブラウザからの直接呼び出しをやめ、API キーはサーバー側でのみ保持する
- **AI プロバイダは未定**（現行 Anthropic API。文章作成・添削の品質と利用制限から ChatGPT を検討中）
- ただし **Phase 1 の作業はブロックしない。** クライアントは `generateNote(input): Promise<string>` のインターフェースだけを知り、プロバイダの選定と切り替えは Functions 側に閉じる。決定を待たずに進められる

**J. ヒヤリハット・事故報告の統合先** → 保留のまま進める

- incident-report に寄せる方向だが未決定。incident-report は薬局・訪問看護など**他業種でも同一フォーマットの使用を想定**しており、訪問介護固有の作りを組み込んで1本化するのは難しい可能性がある
- **Phase 1 の作業はブロックしない。** ヒヤリハットの送信先をアダプタ境界（`incidentAdapter`）の裏に置き、Phase 1 では carerecords 内で完結する実装とする。統合先が決まった時点でアダプタを差し替える

**G. 実データは存在しない** → 確定（2026-09-10）

- 現行 `index.html` は実運用されておらず、移行が必要な実データはない
- 前提1 は正しいことが確認された。**Phase 1 にデータ移行要件は発生しない**
- バックアップ機能（JSON 書き出し・復元）は Phase 1 の移植対象から外す。Firestore 化後は端末ローカルのバックアップが意味を失うため

**L. サービス提供責任者用の個人アカウントを作成する** → 確定

- サ責には個人アカウントを発行する。承認者が誰かを記録に残せる（法定要件を満たす）
- kpi-react の「1施設 = 1アカウント」方式との関係整理が Phase 3 の作業に含まれる

**E. 利用者情報の正は項目で分ける** → 方針確定

`db.profiles` には性質の異なる2種類が混在していることが判明したため、項目単位で正を分ける。

**① 法定文書に属する情報 → kpi-react を正とする**

`care`（要介護度）/ `house`（世帯状況）/ `adlLv` / `demLv` / `disease` / `med` / `adl` / `comm` / `goalL`（長期目標）/ `goalS`（短期目標）/ `plan`（援助内容）/ `tasks`（サービス内容）/ `reason`（生活援助の算定理由）/ `caution`（留意事項）

- kpi-react の `residentList` / `assessments` / `carePlans` に既に存在する
- carerecords では**編集させない**。配信ドキュメント経由で受け取り、表示と判定に使うのみ
- これにより訪問介護計画書の二重管理が解消される

**② carerecords 固有の「記録作成の支援設定」→ carerecords が持つ**

`honor`（敬称）/ `tone`（口調）/ `len`（長さ）/ `style`（記載スタイル）/ `like`（好み・習慣）

- AI 特記事項生成のための設定であり、法定文書とは無関係。kpi-react に持つ理由がない

**この方針の帰結**

- `domain/compliance.ts` の入力は 2 つになる
  ```ts
  check(record: VisitRecord, plan: CarePlanSnapshot, prefs: RecordPrefs): Finding[]
  ```
- `CarePlanSnapshot` は配信ドキュメントに含める。kpi-react の `carePlans` / `assessments` / `residentList` から必要項目だけを抜き出した読み取り専用のスナップショット
- carerecords の利用者マスタ画面は「① は閲覧のみ / ② は編集可」に変わる
- **「ヘルパーに見せる情報の最小化」とのトレードオフは存在しない。** 訪問介護計画書はヘルパーが従うべき文書であり、目標・援助内容・留意事項・ADL は見せるのが正しい。一方、生活保護受給状況・減額認定・障害者手帳の有無（kpi-react の `assessments` にある）は訪問先で不要なので配信に載せない
- 線引き: **計画書に載る情報 = 配信する / 請求・資格に関する情報 = 配信しない**

### 決定済み（2026-09-10 追記・第2回）

**A. ヘルパーも予定を追加できる** → 確定

- 訪問介護員・サービス提供責任者ともに予定の追加を許可する
- 訪問先での予定外対応（緊急訪問）をその場で記録できる
- 配信ドキュメント由来の予定と区別するため、追加分は `source: 'manual'` として扱う
  - kpi-react の `visitRoutes` が既に `manual[]` で同じ区別をしている（`VisitRoutePage.jsx:804`）。概念を揃える

**F. Phase 1 は簡易ログインとする** → 確定

- 「職員を選ぶだけ」の簡易形とし、現行の localStorage 版アカウント管理 373行（`index.html:4084-4457`）は移植しない
- 本格的な認証は Phase 5 で Firebase Auth として実装する
- Phase 1 完了時点のアプリは単体では実運用に出せない。これは許容する

**I. 型定義は carerecords を正とし、コピー + ランタイム検証で同期する** → 確定（推奨案を採用）

- 契約の型は carerecords の **`src/types/contract.ts` 1ファイル**に集約する。TypeScript 側を型の正とする（kpi-react は JavaScript で型を著述できないため）
- kpi-react へは **Phase 4 でコピー**し、JSDoc の `@type {import('./contract').Dispatch}` で参照させる
- **npm パッケージ化・モノレポ化は採用しない。** 別オーナーのリポジトリ2つに対して、トークン管理や履歴統合のコストが規模に釣り合わない
- **ドリフト対策はビルド時ではなくランタイムで行う。** 配信ドキュメントに `schemaVersion` を持たせ、carerecords が読み込み時に検証して不一致なら警告する
  - 型のコピーは同期漏れが起きうる。`schemaVersion` は本番で実際に不一致を検出できるため、こちらが実効的な安全網になる
- **Phase 1 ではこの決定は作業に影響しない。** kpi-react はまだ何も書き出さないため、共有が必要になるのは Phase 4 から

**K. UI の作成を最優先とする** → 確定

- Phase 1 の完了条件は現行の機能パリティ（バックアップと法定文書系マスタ編集を除く）
- ただし**実装順序は UI を最優先**とする。画面が先に動く状態を作り、ドメインロジックは後から差し込む
- 早い段階で実物を触って確認できることを優先する

### 未確定(要確認)

なし。Phase 1 の着手に必要な確認事項はすべて決着した（2026-09-10）。

### 既存仕様との競合

調査の結果、carerecords と kpi-react の間に**3件の重複**が見つかった。うち2件は E の決定で解消し、1件はアダプタ境界で先送りする。

**① ヒヤリハット・事故報告が二重に存在する** → アダプタで吸収（保留）

- carerecords: `db.incidents`（`index.html:3875-4084`、209行）
- kpi-react: 別 Firebase プロジェクト `incident-report-f1bec` への接続を既に持ち（`src/firebase.js` の `incidentApp` / `incidentDb`）、`src/pages/AccidentManagementPage.jsx`（314行）で事故管理を提供

同じ事業所の事故報告が2系統に分かれる。運営指導では事故報告の一元管理が問われる。

ただし incident-report は薬局・訪問看護など**他業種でも同一フォーマットの使用を想定**しており、訪問介護固有の作りを組み込んで1本化するのは難しい可能性がある。

→ **Phase 1 は `incidentAdapter` の裏で carerecords 内完結の実装とし、統合先の決定は Phase 5 までに行う（J）。**

**② 利用者情報が二重に存在する** → E で解消

carerecords の `db.profiles`（`index.html:2212-2218`）と kpi-react のマスタ群が同じ情報を持つ。

| carerecords `db.profiles` | kpi-react |
|---|---|
| `care`（要介護度） | `residentList.careLevel` |
| `adl:{歩行,移乗,排泄,入浴,食事,更衣}` | `assessments`: `walking` / `toilet` / `bathing` / `dressing` / `eating` |
| `comm:['難聴あり','視力低下',...]` | `assessments`: `hearing` / `vision` / `communication` |
| `disease` / `med` | `assessments`: `infection` / `allergy` / `medication` |

**③ 訪問介護計画書が二重に存在する ← 最も重い** → E で解消

| carerecords `db.profiles` | kpi-react `carePlans` |
|---|---|
| `goalL`（長期目標） | 訪問介護計画書の長期目標 |
| `goalS`（短期目標） | 短期目標 |
| `plan`（援助内容） | 援助内容 |
| `tasks`（サービス内容） | 同上 |

kpi-react の `carePlans` は**版管理まで実装されている**（`useFirestore.js:1310-1320` で `_v${version}` を採番）。訪問介護計画書はサ責が作成し利用者の同意を得る**法定文書**であり、二重管理はどちらが正か判定できなくなる。運営指導で確実に問題になる。

→ **② ③ とも E の決定で解消。** 法定文書に属する情報は kpi-react を正とし、carerecords からは編集させない。依頼者からも「ここを修正可能にするとデータがぶれてしまう」として編集不可の方針が確認された。

### 対象外

- Firestore への接続そのもの（Phase 5）
- Firestore セキュリティルールの設計（Phase 2。kpi-react 側の作業として独立に進行）
- ヘルパーアカウントの発行 UI（Phase 3、kpi-react 側）
- 配信ドキュメントの生成ロジック（Phase 4、kpi-react 側）
- kpi-react 側の実施記録閲覧・承認画面（Phase 6）
- PWA 化・Firebase Hosting への配置（Phase 5）
- kpi-react 自体の TypeScript 化（現時点では計画に含めない）
- バックアップ機能（JSON 書き出し・復元）の移植（実データがなく、Firestore 化で不要になるため）
- carerecords からの利用者マスタ①（法定文書系）の編集機能（kpi-react を正とするため）

### 前提として置いたもの

以下は対話の中で妥当と判断して置いた前提であり、**誤っていれば計画が変わる**。

1. ~~**現行 `index.html` はまだ本番運用されておらず、移行が必要な実データは存在しない**~~
   → **2026-09-10 検証済み。実データなしと確認。前提ではなく確定事項になった（上記 G）**

2. **既存の見た目・操作感は維持する**（CSS 731行をそのまま持ち込む）
   → デザインを刷新したい意向があるなら、移植の進め方が変わる

3. **carerecords は独立したリポジトリのまま進める**（kpi-react とのモノレポ化は行わない）
   → 型共有の都合でモノレポ化が望ましいなら I の答えが変わる

4. **kpi-react 側の `residentList` / `staffs` の ID をそのまま利用者・職員の正の ID として使う**
   → kpi-react 内の月次帳票系（`routePlans` / `careSchedules` / `serviceRecords`）が氏名ベースの doc ID を使っている点は、配信ドキュメント方式によって迂回できるため Phase 1 では触らない

5. **Phase 1 の成果物は単体で完結したアプリであり、kpi-react への依存を持たない**
   → 配信データはモックで生成する。Phase 5 で実データに差し替える

6. **記載チェック・特記事項作成・集計・時間検証のロジックは現行の挙動が正しい**
   → 移植時に仕様を変更しない。ロジックの誤りが見つかった場合は別途課題として起票する

## 3. Existing System Investigation

対話の中で実施した調査結果を記録する（`investigating-codebase` 相当の内容を本スキル実行中に確認済み）。

### 関連ファイル

**carerecords（移行対象）** — `index.html` 4,457行の内訳

| 行 | 内容 | 移行先 |
|---|---|---|
| 42-543 | CSS 内の各セクション（ヘッダー / レイアウト / モーダル / AI / 音声入力 / 利用者マスタ / 学習結果 / ツールバー / 未承認一覧 / 未完了の訪問 / 帳票 / 経過記録 / 変更履歴 / 印刷 / ログイン） | `styles.css`（731行そのまま） |
| 810-1638 | HTML マークアップ | React コンポーネント |
| 1638-1703 | データ層（`load` / `save` / `seed`） | `data/localAdapter.ts` |
| 1703-1788 | 描画（手動 re-render） | **消える**（React が肩代わり） |
| 1788-2198 | 操作（イベントハンドラ） | `features/` 各所 |
| 2198-2205 | AI 特記事項の設定 | `features/record/` + Functions 呼び出し |
| 2205-2326 | 利用者マスタ画面 | `features/resident/`（法定文書系は閲覧のみに変更） |
| 2326-2800 | **記載チェック 474行** | `domain/compliance.ts` |
| 2800-2947 | **特記事項の一括作成 147行** | `domain/noteBuilder.ts` |
| 2947-2967 | 共通ヘルパー | `utils/` |
| 2967-2997 | 変更履歴 | `features/auditLog/` |
| 2997-3064 | バックアップ | **移植しない**（対象外） |
| 3064-3149 | **実績時間バリデーション 85行** | `domain/timeValidation.ts` |
| 3149-3457 | **音声入力 308行**（Web Speech API） | `hooks/useSpeech.ts` |
| 3457-3583 | 未承認一覧 | `features/approval/` |
| 3583-3751 | **帳票・集計 168行** | `domain/aggregate.ts` |
| 3751-3875 | 利用者の経過記録 | `features/timeline/` |
| 3875-4084 | ヒヤリハット・事故報告 | `features/incident/` + `incidentAdapter` |
| 4084-4457 | 職員アカウント・ログイン 373行 | **移植しない**（簡易ログインに置換） |

**kpi-react（Phase 1 では変更しないが、契約の相手方）**

| ファイル | 該当箇所 | 関係 |
|---|---|---|
| `src/hooks/useFirestore.js` | 173-238 | `serviceRecords` / `servicePlans` / `visitRoutes` / `routePlans` / `carePlans` / `careSchedules` / `assessments` の購読 |
| `src/hooks/useFirestore.js` | 1256-1266 | `saveVisitRoute()` — Phase 4 で配信生成を相乗りさせる箇所 |
| `src/hooks/useFirestore.js` | 1310-1320 | `saveCarePlan()` — 訪問介護計画書。版管理あり |
| `src/pages/VisitRoutePage.jsx` | 779-800 | `planVisits` 生成。`key: ${routePlanId}#${rowId}` が訪問の一意キー |
| `src/firebase.js` | 全体 | クロスプロジェクト接続の既存パターン（`incidentApp` / `incidentDb`） |

### データフロー

**現行**

```
localStorage['visitcare.records.v1']
  → load()  → グローバル db { visits, incidents, logs, accounts, profiles }
  → 各機能が db を直接読み書き
  → save() → localStorage
```

描画は各操作関数が手動で render 系を呼ぶ。画面状態は `cur { date, staff, filter, editId }` グローバルが保持する。

**Phase 1 で作る形**

```
localAdapter（モック配信を生成）
  → store  → React state
  → components
書き込みは store 経由のみ
```

**Phase 5 到達時**

```
Firestore: facilities/{fid}/dispatches/{date}_{staffId}   ← read（自分の分のみ）
           facilities/{fid}/visitRecords/{visitId}         ← read/write（自分の分のみ）
  → firestoreAdapter（localAdapter と同一インターフェース）
  → store → React state → components
```

### 呼び出し元・依存関係

- **グローバル `db`** を約150個の関数が直接参照している。これがアダプタ境界を設ける最大の理由
- **`profOf(name)`** が氏名文字列で `db.profiles` を引く。呼び出し元は 1877 / 1899 / 1933 / 2270 / 2313 / 2351 / 2456 / 2611 の8箇所
  - E の決定により、この関数は「配信由来の `CarePlanSnapshot`」と「carerecords 固有の `RecordPrefs`」の2つに分解される
- **`cur` グローバル**（`date` / `staff` / `filter` / `editId`）が画面状態を保持。React の state に置き換わる
- **記載チェックの依存**（E の決定で入力型が確定）

| 行 | 判定 | 読む項目 | 決定後の出所 |
|---|---|---|---|
| 2362 | 計画にないサービスの実施 | `tasks` | `CarePlanSnapshot` |
| 2368 | 同居家族ありでの生活援助の算定理由 | `house` / `reason` | `CarePlanSnapshot` |
| 2387 | 短期目標に沿った経過の記載 | `goalS` | `CarePlanSnapshot` |
| 2500 | 介助の程度と ADL の整合 | `adl` | `CarePlanSnapshot` |

- **AI 特記事項** は `index.html:2702` でブラウザから `api.anthropic.com/v1/messages` を直接呼び、キーを `localStorage['visitcare.aicfg.v1'].key` に保持している。H の決定により Cloud Functions 経由に変更する

### 既存の実装パターン

- kpi-react の `src/hooks/useFirestore.js` が「`onSnapshot` → `useState` → 画面」の形を確立している。Phase 5 で `firestoreAdapter` を書く際はこのパターンを踏襲できる
- kpi-react の `visitRoutes` は予定表由来と手動追加を `source: 'plan' | 'manual'` で区別している（`VisitRoutePage.jsx:804`）。A の決定で carerecords 側も同じ概念を使う
- kpi-react の `residentList` / `staffs` は doc ID が `Date.now().toString()` の安定 ID（`useFirestore.js:476` / `:1070`）。氏名ベースなのは月次帳票系（`routePlans` / `careSchedules` / `serviceRecords`）の doc ID のみ

### 影響範囲

- **carerecords: 全面。** 単一 HTML の構成そのものが変わる
- **kpi-react: Phase 1 では変更なし。** 影響が出るのは Phase 2 以降
- 現行 `index.html` は削除せず残す。挙動の突き合わせ元として使う

## 4. Implementation Plan

### 前提の確認

- 未確定事項はゼロ（`## 2` 参照）。この計画は確定した要件のみに基づく
- **`CLAUDE.md` が carerecords / kpi-react のいずれにも存在しない。** ステップ1で carerecords に新規作成し、以降のスキルが参照できるようにする
- 実データが存在しないため **`migrating-database` は不要**（後述）

### Phase 1 の分割

「UI の作成を最優先」（K）の方針に従い、Phase 1 を 2 段に分ける。

| | 内容 | 状態 |
|---|---|---|
| **Phase 1a** | 足場 + 型 + アダプタ + **UI 全画面**（モックデータで動く） | **本計画書の対象** |
| Phase 1b | ドメインロジック移植（`compliance` / `noteBuilder` / `aggregate` / `timeValidation`）+ 音声入力 + AI インターフェース | 別計画書 |

分割の理由。実装順序を6ステップ以内に収めるため、および UI が動く状態を先に確認できるようにするため。Phase 1a 完了時点で、画面はすべて存在しモックデータで操作できるが、記載チェックと特記事項の自動生成は未実装という状態になる。

### 方針

**1. Vite プロジェクトを carerecords のルートに新設し、現行実装は `legacy/` に退避する**

Vite はプロジェクトルートの `index.html` をエントリポイントとして要求するため、**現行の `index.html` と必ず衝突する**。

- `index.html` → `legacy/index.html`
- `build.js` → `legacy/build.js`
- `サーバーで起動.cmd` → `legacy/`
- `dist/` → `legacy/dist/`

移動であって削除ではない。挙動の突き合わせ元として全期間残す。`README.md` に legacy の位置づけを追記する。

**2. 状態管理は Context + カスタムフック。外部ライブラリを追加しない**

kpi-react が `useFirestore()` 1つで全データと操作関数を返すパターンを確立している（`src/hooks/useFirestore.js`）。carerecords も `useCareStore()` として同形にする。

理由。Phase 5 で `firestoreAdapter` に差し替える際、kpi-react と同じ形であれば実装を参照でき、学習コストがかからない。Zustand / Jotai 等を入れるほどの状態の複雑さはない（画面状態は `date` / `staff` / `filter` / `editId` の4つ）。

**3. アダプタは非同期インターフェースで定義する。localStorage 実装でも `Promise` を返す**

```ts
// src/data/adapter.ts
export interface DataAdapter {
  getDispatch(date: string, staffId: string): Promise<Dispatch | null>
  listRecords(date: string, staffId?: string): Promise<VisitRecord[]>
  saveRecord(record: VisitRecord): Promise<void>
  listResidents(): Promise<ResidentRef[]>
  getCarePlan(residentId: string): Promise<CarePlanSnapshot | null>
  getPrefs(residentId: string): Promise<RecordPrefs>
  savePrefs(residentId: string, prefs: RecordPrefs): Promise<void>
  // 以下は Phase 1b / Phase 5 で追加
}
```

理由。localStorage は同期 API だが、**同期で書くと Phase 5 で全呼び出し元を書き換えることになる**。最初から `Promise` にしておけば差し替えはアダプタ実装のみで済む。これがアダプタ境界を設ける目的そのものである。

**4. CSS は現行 731行をそのまま `src/styles.css` に移す。Tailwind を導入しない**

kpi-react は Tailwind v4 だが、carerecords は合わせない。理由は `## 2` の確定事項のとおり、見た目を変えないことで legacy との突き合わせを可能にするため。クラス名も現行のまま使う。

**5. 簡易ログインは「職員を選ぶだけ」。認証を実装しない**

`localStorage` に選択中の職員 ID を保持するのみ。ロール（訪問介護員 / サービス提供責任者 / 管理者）はモックデータ側で職員に付与し、画面の出し分けだけ Phase 1a で作っておく。Phase 5 で Firebase Auth に置き換わる際、ロール判定の呼び出し箇所を変えずに済む。

**6. モックデータは kpi-react の実データ構造に忠実に作る**

`localAdapter` が生成する配信ドキュメントは、Phase 4 で kpi-react が書き出すものと同じ形にする。`routePlans` / `visitRoutes` / `residentList` / `carePlans` / `assessments` の実際のフィールド（`## 3` で確認済み）を写す。

理由。ここが乖離すると Phase 5 の差し替えで UI 側の修正が発生し、アダプタ境界を設けた意味が失われる。

### 変更対象ファイル

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `index.html` | 移動 | → `legacy/index.html`。Vite のエントリと衝突するため |
| `build.js` | 移動 | → `legacy/build.js` |
| `サーバーで起動.cmd` | 移動 | → `legacy/サーバーで起動.cmd` |
| `dist/` | 移動 | → `legacy/dist/` |
| `README.md` | 変更 | legacy の位置づけと新構成の説明を追記 |
| `.gitignore` | 変更 | `node_modules/` `dist/` `.env` を追加 |
| `CLAUDE.md` | 新規 | プロジェクト固有の制約（スタック・ディレクトリ構造・状態管理方針・命名） |
| `package.json` | 新規 | React 19 / Vite / TypeScript |
| `vite.config.ts` | 新規 | |
| `tsconfig.json` | 新規 | `strict: true` |
| `eslint.config.js` | 新規 | kpi-react の設定を踏襲 |
| `index.html` | 新規 | Vite エントリ |
| `src/main.tsx` | 新規 | |
| `src/App.tsx` | 新規 | アプリシェル・画面切替 |
| `src/styles.css` | 新規 | legacy の CSS 731行をそのまま |
| `src/types/contract.ts` | 新規 | **kpi-react との共有契約**。`Dispatch` / `VisitRecord` / `CarePlanSnapshot` / `ResidentRef` / `StaffRef` / `schemaVersion` |
| `src/types/local.ts` | 新規 | carerecords 固有の型（`RecordPrefs` / `Incident` / `AuditLog`） |
| `src/data/adapter.ts` | 新規 | `DataAdapter` インターフェース |
| `src/data/localAdapter.ts` | 新規 | localStorage 実装 |
| `src/data/mock.ts` | 新規 | モック配信・利用者・職員の生成 |
| `src/store/CareStoreProvider.tsx` | 新規 | Context |
| `src/store/useCareStore.ts` | 新規 | データと操作関数を返すフック |
| `src/features/auth/StaffPicker.tsx` | 新規 | 簡易ログイン |
| `src/features/shell/Header.tsx` | 新規 | ヘッダー・職員切替・各種ボタン |
| `src/features/shell/DateBar.tsx` | 新規 | 日付ナビ |
| `src/features/shell/Toolbar.tsx` | 新規 | ツールバー（バッジ含む） |
| `src/features/shell/Stats.tsx` | 新規 | 統計5枠 |
| `src/features/visitList/VisitList.tsx` | 新規 | サービス実施一覧 |
| `src/features/visitList/VisitRow.tsx` | 新規 | 1件の行 |
| `src/features/visitList/Filters.tsx` | 新規 | すべて / 未完 / 済 / 完了 / キャンセル |
| `src/features/record/RecordModal.tsx` | 新規 | 記録モーダル（基本情報・バイタル・実施内容・特記事項） |
| `src/features/resident/ResidentModal.tsx` | 新規 | 利用者マスタ。**法定文書系は閲覧のみ**、記録支援設定のみ編集可 |
| `src/features/approval/PendingModal.tsx` | 新規 | 未承認一覧 |
| `src/features/report/ReportModal.tsx` | 新規 | 帳票・集計 |
| `src/features/timeline/TimelineModal.tsx` | 新規 | 利用者の経過記録 |
| `src/features/incident/IncidentModal.tsx` | 新規 | ヒヤリハット・事故報告 |
| `src/features/incident/incidentAdapter.ts` | 新規 | 送信先を差し替え可能にする境界（J の保留を吸収） |
| `src/components/Modal.tsx` | 新規 | モーダル共通。フォーカストラップ・Esc・スクロールロック |
| `src/utils/date.ts` | 新規 | legacy の `iso` / `addDays` / `toMin` / `fmt` |

新規 30ファイル前後、移動 4、変更 2。

### データ構造の変更

**あり。ただし `migrating-database` は不要。**

- 現行: `localStorage['visitcare.records.v1']` に `{ visits, incidents, logs, accounts, profiles }`
- 新: 配信（`Dispatch`）と実施記録（`VisitRecord`）を分離し、利用者情報は法定文書系（kpi-react が正）と記録支援設定（carerecords が持つ）に分割

`migrating-database` が不要な理由。**移行対象の実データが存在しないことを確認済み**（`## 2` の G）。現行 `index.html` は実運用されておらず、保持すべきデータがない。新しいキー（`carerecords.v2.*`）で新規に開始し、legacy のキーには触れない。

### 実装順序

Phase 1a の6ステップ。各ステップは単独でコミット可能。

1. **足場を作る**
   `legacy/` へ退避 → Vite + React 19 + TypeScript(strict) + ESLint を新設 → `src/styles.css` に CSS 731行を移植 → `CLAUDE.md` 新規作成 → `.gitignore` / `README.md` 更新
   完了条件: `npm run dev` で空のページが現行のフォントと配色で表示される

2. **契約とアダプタを定義する**
   `types/contract.ts` / `types/local.ts` / `data/adapter.ts` / `data/localAdapter.ts` / `data/mock.ts` / `store/`
   完了条件: 型チェックが通り、モック配信を `useCareStore()` 経由で取得できる

3. **アプリシェルと簡易ログイン**
   `StaffPicker` / `Header` / `DateBar` / `Toolbar` / `Stats`
   完了条件: 職員を選ぶと画面に入り、日付を移動でき、統計が配信件数を反映する

4. **サービス実施一覧**
   `VisitList` / `VisitRow` / `Filters`
   完了条件: 配信から生成した訪問が一覧表示され、5種のフィルタが効き、legacy と見た目が一致する

5. **記録モーダルと利用者マスタ**
   `components/Modal` / `RecordModal` / `ResidentModal`
   完了条件: 記録を入力して保存でき、再読込後も保持される。利用者マスタで法定文書系が閲覧のみになっている

6. **残りの画面**
   `PendingModal` / `ReportModal` / `TimelineModal` / `IncidentModal` / `incidentAdapter`
   完了条件: ツールバーの全ボタンが対応する画面を開く。集計値はステップ6時点では素朴な実装でよい（Phase 1b で `domain/aggregate.ts` に差し替える）

### リスク

**1. 現行の挙動を取りこぼす（最大のリスク）**
4,457行・約150関数を目視で移植する。条件分岐やエッジケースの見落としが起きる。
→ 対策: `legacy/index.html` を全期間残し、画面ごとに並べて突き合わせる。`画面キャプチャ/` のスクリーンショットも基準に使う。

**2. CSS はそのまま持ち込むが DOM 構造が変わると崩れる**
現行 CSS は具体的な要素の入れ子を前提にしたセレクタを含む可能性がある。React のコンポーネント分割で階層が変わると効かなくなる。
→ 対策: マークアップの入れ子とクラス名を legacy から機械的に写す。分割はコンポーネント境界のみで行い、DOM の階層は変えない。

**3. モックデータが Phase 4 の実データと乖離する**
乖離すると Phase 5 の差し替えで UI 修正が発生し、アダプタ境界の意味が失われる。
→ 対策: `## 3` で確認した kpi-react の実フィールドに忠実に作る。`schemaVersion` を最初から持たせる。

**4. 記録モーダルが大きい**
legacy では `index.html:884-1040` 付近に集中しており、基本情報・バイタル・実施内容・特記事項・記載チェック結果を1画面に持つ。分割設計が甘いと再現しづらく、Phase 1b でロジックを差し込む際に触りにくくなる。
→ 対策: セクション単位（基本情報 / バイタル / 実施内容 / 特記事項）でコンポーネントを分け、記載チェックの結果表示は最初から差し込み口（props）として空で用意しておく。

**5. `profOf()` の分解で挙動が変わる**
氏名で `profiles` を引く1関数を、`CarePlanSnapshot` と `RecordPrefs` の2つに分解する（`## 3` 参照）。8箇所の呼び出し元それぞれで、どちらを参照すべきかの判断を誤ると挙動が変わる。
→ 対策: Phase 1a では利用者マスタの表示のみ。判定ロジックを扱う Phase 1b で呼び出し元ごとに検証する。

**6. TypeScript strict による移植コストの増加**
legacy は暗黙の `null` / `undefined` や型の混在を含む。strict では通らない箇所が出る。
→ 対策: 受け入れる。ここで型を通すことが移行の目的の一つであり、緩めると Phase 4 以降の契約検証が効かなくなる。

**解消済みの懸念（記録）**
音声入力（Web Speech API）は secure context を要求するが、`localhost` は secure context として扱われるため Vite の dev server で動作する。legacy が `サーバーで起動.cmd` を必要としていた制約は、Vite 化により自然に解消する。

### 適用する Craft Skills

| Craft Skill | 適用理由 |
|---|---|
| `designing-ui-components` | 全画面を新規に作る。情報階層とコンポーネント責務の分割判断を伴う |
| `making-accessible` | モーダルが6種（記録 / 利用者マスタ / 未承認 / 帳票 / 経過記録 / ヒヤリハット）。フォーカストラップ、Esc、フィルタのボタン群、カスタム select を含む |
| `writing-forms` | 記録入力（バイタル・実施内容・特記事項）、利用者マスタの記録支援設定、ヒヤリハット報告。送信状態・重複送信防止・失敗時の入力保持を扱う |
| `handling-async-states` | アダプタを `Promise` ベースで定義するため、Phase 1a の時点から loading / error / empty / success の4状態が発生する |
| `designing-api-contracts` | `src/types/contract.ts` が kpi-react との契約そのもの。`schemaVersion` によるランタイム検証を含む |
| `reviewing-data-boundaries` | 配信ドキュメントに何を載せるかの決定（「計画書に載る情報 = 配信する / 請求・資格に関する情報 = 配信しない」）は境界設計にあたる。Phase 1a で契約を決めるため、ここで判断する |

適用しないもの。

- `choosing-rendering-strategy` — Next.js App Router 向け。本プロジェクトは Vite の SPA であり Server / Client 境界が存在しない
- `optimizing-performance` — 性能要件が仕様として存在せず、性能問題も観測されていない

### Review Required

**yes**

判断理由。以下の4項目に該当する。

1. **API contract の新規定義** — `src/types/contract.ts` は kpi-react との契約であり、誤ると Phase 4・5 で連携が成立しない
2. **複数画面に影響する変更** — 全画面が対象
3. **共通ユーティリティの新規作成** — アダプタ層と store は以降のすべての機能が依存する。ここの設計を誤ると Phase 5 の差し替えが成立しない
4. **重要な業務ロジックを扱う土台** — サービス実施記録は法定文書であり、記録の欠落や取り違えは運営指導での指摘・返還リスクに直結する

なお認証・認可の変更は Phase 1a には含まれない（簡易ログインのみ、認証は Phase 5）。DB スキーマの変更は形式上あるが、実データがないため移行リスクはない。

## 5. Implementation Status

Phase 1a の6ステップ。

- [x] **1. 足場を作る** — legacy 退避 / Vite + React 19 + TS(strict) / ESLint / CSS 729行移送 / CLAUDE.md / .gitignore / README
- [ ] 2. 契約とアダプタを定義する
- [ ] 3. アプリシェルと簡易ログイン
- [ ] 4. サービス実施一覧
- [ ] 5. 記録モーダルと利用者マスタ
- [ ] 6. 残りの画面

### 計画から外れた点

**1. `src/vite-env.d.ts` を追加した（計画の変更対象ファイル一覧に無かった）**

`import './styles.css'` が TS2307（モジュールが見つからない）で型チェックに失敗したため。Vite 標準の型参照ファイルであり、`/// <reference types="vite/client" />` の1行のみ。計画の意図から外れる変更ではないと判断して追加した。

**2. `tsconfig.json` を3ファイル構成にした**

計画では `tsconfig.json` 1ファイルとしていたが、Vite + React の標準構成に合わせて `tsconfig.json`（参照のみ）/ `tsconfig.app.json`（`src/`）/ `tsconfig.node.json`（`vite.config.ts`）に分けた。ブラウザ用と Node 用で `lib` が異なるため、1ファイルでは両方を正しく型付けできない。

**3. `typescript-eslint` を依存に追加した**

計画では「kpi-react の ESLint 設定を踏襲」としていたが、kpi-react は JavaScript のため TypeScript 用のパーサ・ルールを持っていない。TS を lint するために必要。

**4. CSS は 731行ではなく 729行だった**

計画書に 731行と記載していたが、`<style>` / `</style>` タグ自体を除いた実体は 729行（`legacy/index.html:8-736`）。移送内容に欠落はなく、波括弧の対応（423対423）とタグ混入なしを確認済み。

### 実装中に気づいた点

**`legacy/dist/app.html` が `.gitignore` の `dist/` に一致してしまう問題**

新しい Vite の出力先が `dist/` になるため `.gitignore` に `dist/` を追加したが、退避した `legacy/dist/app.html` も一致する。`!legacy/dist/` の除外を入れて追跡を維持している。**この否定パターンを消すと legacy の生成物が Git から外れるので、以降 `.gitignore` を触るときは注意する。**

**`*.tsbuildinfo` を `.gitignore` に追加した**

`tsc -b` が生成する増分ビルド情報がリポジトリ直下に出るため。計画には無かったが、ビルド成果物であり追跡すべきものではない。

**`npm run build` の出力先が `legacy/dist/` と紛らわしい**

ルートの `dist/` が新実装のビルド成果物、`legacy/dist/` が移行元の Artifact 用生成物。名前が同じで混同しやすい。手は付けていない。

## 6. Verification

<verifying-changes が埋める>

### 検証項目

### 検証結果

### verifying-changes 内で修正したもの

### 差し戻したもの

## 7. Result

<完了時に記入>

### 最終的に実装したもの

### 残課題

### 次にやるとよいこと
