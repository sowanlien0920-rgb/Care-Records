---
request: Phase 6。carerecords で承認済みになった実施記録を kpi-react の請求・帳票側へ取り込む
status: done
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

review_required は planning-feature が yes / no を判定する。
-->

## 1. Request

```
次のアクション実行
```

（2026-09-14。Phase 5b（PWA + オフライン永続化）の完了
（`2026-09-14-carerecords-phase5b-pwa-offline.md` の `## 7`）を受けて、
移行計画（`2026-09-10-carerecords-react-migration.md:37`）の**次のフェーズ = Phase 6**
に着手するものとして解釈した。**この解釈自体が確認事項になる**（`## 2` の U-0）。）

Phase 6 の内容は、移行計画で一度縮小されている。

```
- **Phase 6 の性格が変わる。** 承認を carerecords で完結させるなら、kpi-react 側に
  承認画面は要らない。kpi-react が必要とするのは「承認済み実績を月間帳票・給付管理
  （serviceRecords / benefits）に取り込む」ことだけになる。
  Phase 6 は「閲覧・承認画面の新設」から「承認済み実績の取り込み」に縮小する
                     ── 2026-09-10-carerecords-react-migration.md:127
```

## 2. Clarified Requirements

### 確定

移行計画・Phase 5a・Phase 5b の計画書から、すでに決まっているものだけを書く。

- **実施記録の正は carerecords 側にある。** `facilities/{fid}/visitRecords/{visitId}`、
  1訪問 = 1ドキュメント（`src/data/firestoreAdapter.ts:385`）
- **承認は carerecords で完結する。** kpi-react 側に承認画面は作らない（移行計画 `:127`）。
  承認済みは `approvedBy` / `approvedByName` / `approvedAt` が埋まり `status: '完了'`
  （`src/types/contract.ts:320`、`src/store/CareStoreProvider.tsx:671`）
- **kpi-react は `visitRecords` をすでに読める。** ルールは適用済みで、読み取り権限の
  追加は要らない（`../kpi-react/firestore.rules:562-565`。`isKpiUser()` を許可）
- **承認済みの記録は誰も削除できない。** 法定文書として確定するため
  （`../kpi-react/firestore.rules:594-597`）
- **carerecords 側のロールは請求系に触れない。** `supervisor` / `helper` は
  `benefits` / `serviceRecords` / `routePlans` を読み書きできない
  （`../kpi-react/firestore.rules:371` が `isKpiUser()` のみ）
- **法定文書に属する情報を carerecords から書き込まない**（`CLAUDE.md` 鉄則4）。
  ただし Phase 6 は「carerecords → kpi-react」の**逆向き**であり、鉄則が想定していない
  向きにあたる。`contract.ts:125` は請求・給付管理の数値を**配信に載せない**と定めているが、
  返す向きは未定義である

### 2026-09-14 に依頼者が決めたこと

| | 決定 |
|---|---|
| **U-0** | **Phase 6 に進む。** Phase 5b の持ち越し2件（セッションをまたいだ再送失敗・キャッシュ由来の古い一覧）は carerecords 側の別件として残す |
| **U-1** | **kpi-react のソース変更を Phase 6 の範囲で解除する。** Phase 3・4 と同じ形。この例外は Phase 6 の範囲に閉じる |
| **U-2** | **① `serviceRecords` を作り直す。** 既存の手入力（`benefits`）・利用票（`routePlans`）を一切壊さない。doc ID が `${month}_${氏名}` 固定の `setDoc` で冪等になる |
| **U-3** | **取り込み時に `SERVICE_MASTER[serviceCode]` を引いて固定する。** 提供票が `unitPrice` をコピーしているのと同じ作り。マスタ改定に過去月が追随しないことを受け入れる |
| **U-4** | **職員が月を選んで実行する。** 給付管理画面に取り込みの導線を置き、何件取り込むかを見せてから確定する。冪等なので何度押してもよい |
| **U-10** | **差分を見せるまで。** 取り込んだ実績と `benefits.actualUnits` の差を並べて出す。請求確定のブロック（FR-051）はしない |
| **U-9** | **`visitId` に氏名が入る件は今回は受け入れる。** 直すと既存の `dispatches` / `visitRecords` の ID が全部変わり移行が伴う。別の課題として下に残す |

#### U-2 と U-3 の組み合わせには限界がある（着手前に共有しておく）

**取り込んだ単位数は、請求の正にはならない。**

- `SERVICE_MASTER` は算定区分名 → 単位数の平坦なマップで、加算・減算・
  区分支給限度基準額の判定を持たない（`../kpi-react/src/constants.js:20-64`）
- 配信対象外の訪問（`身体日1.0・2人` 9件、`初回加算` / `他事業所` / `訪看*`）は
  実施記録が生まれないため、**取り込んだ合計は必ず `benefits.actualUnits` を下回る**
- したがって `serviceRecords` の単位数は**突合の材料**であって、請求額そのものではない。
  U-10 を「差分を見せるまで」に留めたのはこのため

この範囲で実際に守れるのは次のとおり。

| 場面 | ① + 単位数を取り込み時に固定 |
|---|---|
| 「いつ・誰が・何を実施したか」を kpi-react から日単位で読む | **できる**（現在はどこにも残っていない） |
| 記録が無いのに請求している月を見つける（FR-020） | **できる**（差分として出る） |
| 請求額を記録から算出する | **できない**（加算・限度額の判定が無い） |
| 配信対象外の訪問を実績に含める | **できない**（実施記録が生まれない） |

### 未確定(要確認)

決着していないものだけを残す。**いずれも `planning-feature` の中で決めてよい粒度にあたる。**

- [ ] **U-6. 取り込んだ値を `benefits` へ反映するか。** U-2 で ① を選んだため、
      既定では `benefits.actualUnits` を**上書きしない**（差分を見せるだけ）。
      職員が「この差分を反映する」を押せる導線まで作るかは未定
- [ ] **U-7. 実績時刻が空の記録をどう扱うか。** `actualStart` / `actualEnd` は空文字を許す
      （`src/types/contract.ts:283-284`）。U-3 の決定により**単位数には影響しない**
      （`serviceCode` から引くため）が、提供時間として何を出すかは決まっていない
- [ ] **U-8. キャンセルはどちらを正とするか。** 契約は配信側（`DispatchVisit.cancelled`）を
      正と定めている（`src/types/contract.ts:101-105`）。取り込みもこれに従う想定だが、
      `VisitRecord.status` の `'キャンセル'` とずれた場合の扱いが未定義
- [x] **U-11. 本番の `serviceRecords` に既存データがあるか。** 書き込み経路が
      2026-07-28 の導入時から存在しないため空と見ていた。**2026-09-17 に確認した結果、
      空ではなかった**（`## 6` の「U-11 の確認結果」）。`koharunosato` に 2026-06 の
      43件が氏名ベースの doc ID で残っている
- [ ] **U-12. 承認者を区別できない施設をどうするか。** `nanairo` の施設アカウント3件が
      同じ `staffId` を共有している（Phase 3 の残課題）。承認済み実績を取り込む以上、
      「誰が承認したか」は法定要件として問われる

### 別の課題として残したもの（Phase 6 では扱わない）

- **`visitId` に利用者氏名が入っている**（U-9 で受け入れ）。`contract.ts:192-194` は
  「Phase 4 では採番に置き換える」と書いているが、`../kpi-react/src/utils/dispatch.js:267` は
  置き換えていない。実データが入る前のほうが直すコストは低い
- **Phase 5b の持ち越し2件**（U-0）。セッションをまたいだ再送失敗が無言で巻き戻る件、
  キャッシュ由来の古い一覧を「最新」として出している件
- **Phase 4 の残課題**。`身体日1.0・2人` 9件が配信されない件、`CarePlanSnapshot` の空項目、
  `planVersion` が `null` の件

### 対象外

- **kpi-react 側の実施記録の閲覧・承認画面。** 移行計画 `:127` で縮小済み。承認は carerecords で完結する
- **carerecords 側の UI 変更。** 取り込みは kpi-react 側で実行する想定（U-2 の決定次第で変わる）
- **国保連への請求データ出力。** 既存の `benefits` も持っていない
- **`serviceRecords.services[]` の型の確定**（U-2 で ① を選ばない限り不要）
- **Phase 4 の残課題の解消。** `身体日1.0・2人` 9件が配信されない件、`CarePlanSnapshot` の
  空項目、`planVersion` が `null` の件は Phase 4 の運用課題として別に残っている
- **請求確定のブロック**（FR-051）。U-10 の決定で範囲外
- **実績時間からの算定区分の再判定**（U-3 の決定で範囲外）

### 前提として置いたもの

**誤っていれば計画が変わる。**

1. ~~**「次のアクション」= Phase 6 と解釈した。**~~ → **U-0 で確定**（2026-09-14）。
   Phase 5a・5b が残した本番接続時の確認（App Check・複合インデックス・実データの形・
   スマホ実機・IndexedDB 不可端末の警告）は未了のまま残る
2. **取り込みは kpi-react 側（`isKpiUser`）で実行する。** carerecords から請求系へ
   push する経路はルール上存在せず、作るならルール変更を伴う（`firestore.rules:371`）。
   U-4 で「職員が月を選んで実行」と決まったため、この前提は確定した
3. **本番の `serviceRecords` は空である。** 書き込み経路が 2026-07-28 の導入時から
   存在しないため。**本番未接続のため未確認** → **U-11**
4. **carerecords の Firestore 移行（Phase 5a）は完了しており、`visitRecords` は
   実際に書かれ始める。** ただし本番接続時の確認4件が未了であり、実データはまだ無い可能性がある

### 既存仕様との競合

調査で **4件**の競合・構造ギャップが見つかった。**うち2件は実装前に決着が要る。**

**① `serviceRecords` は死んだコレクションである** → U-2 で決着が要る

書き込み関数 `saveServiceRecords`（`../kpi-react/src/hooks/useFirestore.js:1281-1303`）は
存在するが、呼び出し元がゼロ。`App.jsx:372` が `BenefitPage` へ props で渡しているが、
`BenefitPage.jsx:77` の引数リストが受け取っておらず、ファイル全体に `serviceRecords` の
文字列が1件も無い。導入コミット（2026-07-28）から一度も画面に接続されていない。

移行計画は取り込み先として `serviceRecords` / `benefits` を名指ししているが、
**前者は「既存の仕組みに乗る」のではなく「実質ゼロから設計する」ことになる。**
`services[]` の要素の型を決めているコードも存在しない。

**② 「実施した」という事実が kpi-react のどこにも日単位で残っていない** → Phase 6 の意味そのもの

実績の受け皿は3つに分散しており、いずれも実施記録を入力にしていない。

| 受け皿 | 粒度 | 入り方 |
|---|---|---|
| `benefits.actualUnits` | 利用者 × 月 | 手入力 / 「月次訪問」Excel 取込 |
| `routePlans.rows[].actual` | 利用者 × 月ドキュメント内の 行 × 日 | 提供票 Excel 取込 / **時刻を変更した訪問だけ**自動で立つ |
| `records` | 施設 × 日（利用者の区別なし） | 手入力 |

とくに `syncActualToPlans`（`../kpi-react/src/pages/VisitRoutePage.jsx:1370-1410`）は
**時刻を変更していない訪問の実績マークを消す**挙動を持つ。U-2 で ③ を選ぶと、
Phase 6 が立てたマークを後のルート表保存が消す。**現行コードにそのまま存在する干渉である。**

**③ 利用者のキーが合わない** → U-2 に付随

`VisitRecord` は `residentId`（`residentList` の doc ID）で利用者を指すが、
`benefits.name` / `serviceRecords.residentName` / `routePlans.residentName` は**氏名文字列**。
Phase 4 の `resolveResident`（`../kpi-react/src/utils/dispatch.js:92-99`）の逆向きの
引き直しになる。Phase 4 の実データ検証では同姓同名0件だったが、構造としては保証がない。

一方、`visitId` を `#` で分割すると予定表の行に到達できる（`${date}#${routePlanId}#${rowId}`）。
これは設計意図ではなく副作用だが、U-2 で ③ を選ぶ場合は使える。
**手動追加の訪問（`visitKey = m_...`）は予定表に対応する行が無く、この経路では受けられない。**

**④ 取り込んだ実績は構造的に欠ける** → U-6・U-10 に影響

Phase 4 の残課題1 のとおり `身体日1.0・2人` 9件は配信されず、ヘルパー端末に出ないため
実施記録も生まれない。`初回加算` / `他事業所` / `訪看*` も配信対象外
（`../kpi-react/src/utils/dispatch.js:36-40`）。給付管理の `actualUnits` と突き合わせると
**必ず差が出る。** 突合の警告（U-10）を作るなら、この差を「異常」と出さない設計が要る。

**⑤ 承認者を区別できない施設がある**（Phase 3 の残課題）

`nanairo` の施設アカウント3件が同じ `staffId` を共有しており、承認者として区別できない
（`../kpi-react/docs/plans/2026-09-14-helper-account-phase3.md` の `## 8`）。
承認済み実績を取り込む以上、「誰が承認したか」が法定要件として問われる。

## 3. Existing System Investigation

<!-- code-investigator による調査（2026-09-14）。planning-feature の前に投入済み -->

### 取り込み先の候補（U-2 の4択）

| | 候補 | 粒度 | 冪等性 | 主な制約 |
|---|---|---|---|---|
| ① | `serviceRecords` | 利用者 × 月 | 冪等（doc ID `${month}_${氏名}` 固定の `setDoc`） | 画面が無い。`services[]` の型が未定義。doc ID に氏名が入り同姓同名が潰れる |
| ② | `benefits.actualUnits` | 利用者 × 月 | **冪等でない**（`${targetMonth}_${Date.now()}` で採番） | 単位数の算出が要る（U-3）。手入力・Excel 取込と衝突（U-6） |
| ③ | `routePlans.rows[].actual` | 行 × 日 | 冪等（日付キーへの代入） | `syncActualToPlans` が後から消す（競合②）。手動追加の訪問を受けられない |
| ④ | 新規コレクション | 自由 | 設計次第 | 画面・ルール・インデックスをすべて新設。既存帳票には繋がらない |

### 関連ファイル

**carerecords 側（読み取り元）**

| ファイル | 役割 |
|---|---|
| `src/types/contract.ts:248-328` | `VisitRecord`。Phase 6 の入力になる形。`SCHEMA_VERSION = 3` |
| `src/data/firestoreAdapter.ts:385` | `facilities/{fid}/visitRecords/{visitId}` への書き込み |
| `src/store/CareStoreProvider.tsx:665-677` | 承認。`approvedBy` / `approvedByName` / `approvedAt` を埋める |
| `src/domain/aggregate.ts:43-122` | 提供分数・利用者別/職員別/合計の集計。**carerecords 側の帳票** |

**kpi-react 側（書き込み先の候補）**

| ファイル | 役割 |
|---|---|
| `../kpi-react/src/hooks/useFirestore.js:1281-1303` | `saveServiceRecords`。**呼び出し元ゼロ** |
| `../kpi-react/src/hooks/useFirestore.js:1262-1279` | `saveBenefit`。ID 採番が非冪等 |
| `../kpi-react/src/pages/BenefitPage.jsx:56-177` | 給付管理のフォーム。`actualUnits` の手入力 |
| `../kpi-react/src/pages/BenefitPage.jsx:21-50, 109-139` | 「月次訪問」Excel 取込。`actualUnits` を上書き |
| `../kpi-react/src/pages/VisitRoutePage.jsx:1370-1410` | `syncActualToPlans`。実績マークの自動増減 |
| `../kpi-react/src/utils/dispatch.js:226-317` | Phase 4 の配信生成。`visitId = ${date}#${visitKey}` |
| `../kpi-react/src/constants.js:20-64` | `SERVICE_MASTER`。算定区分名 → 単位数の平坦なマップ 36件 |
| `../kpi-react/firestore.rules:371, 543-597` | 請求系は `isKpiUser()` のみ。`visitRecords` は kpi 側から読める |
| `../kpi-react/訪問介護記録調査/08_システム要件/system-requirements.md` | 記録と請求の突合要件（FR-020 / FR-034 / FR-051 / FR-091） |

### データフロー（現状）

```
kpi-react                                         carerecords
  routePlans（利用者×月・予定）
    └ VisitRoutePage（日次のルート表）
        └ saveVisitRoute ──► dispatches/{date}_{staffId} ──► 配信を読む
                                                                 │
                                                          記録を書く・承認する
                                                                 │
                                                          visitRecords/{visitId}
                                                                 │
  benefits.actualUnits ◄── 手入力 / Excel                        ×  ← ここが繋がっていない
  routePlans.rows[].actual ◄── Excel / 時刻変更のみ              ×     （Phase 6 の対象）
  serviceRecords ◄── 誰も書いていない                            ×
```

### 影響範囲

U-2 の決定で大きく変わるため、**確定は planning-feature に送る。** どの候補でも共通するのは
次の3点になる。

- kpi-react 側に `visitRecords` の購読または取得が新設される（現在ゼロ）
- 取り込み済みの管理を新規に設計する（既存スキーマにフィールドが無い）
- Firestore のインデックスが要る可能性がある（現在は `staffId + date` の1本のみ）

### 確認できなかったこと

1. 本番の `serviceRecords` にデータがあるか（本番未接続）
2. `serviceRecords.services[]` の要素の型（生成側のコードが存在しない）
3. `kpiName` フィールドの用途（参照箇所ゼロ）
4. 提供票 Excel 取込が実運用で使われているか
5. 給付管理の「月次訪問」Excel が誰からどう供給されるか
6. carerecords の `visitRecords` に実データが入り始めているか

## 4. Implementation Plan

<!-- U-0〜U-4・U-9・U-10 は決着済み。U-6〜U-8・U-11・U-12 をこの計画の中で決める -->

### 方針

**Phase 4 と対称の形で作る。** Phase 4 は「純粋関数（`utils/dispatch.js`）で組み立て →
`useFirestore.js` が書く → 画面が起動する」という三層だった。Phase 6 はその逆向きを、
同じ三層で作る。新しい流儀を持ち込まない。

```
Phase 4  routePlans ─► buildDispatches（純粋）─► saveVisitRoute ─► dispatches
Phase 6  visitRecords ─► buildServiceRecords（純粋）─► saveServiceRecords ─► serviceRecords
```

決定に対応する設計は次のとおり。

| 決定 | 設計 |
|---|---|
| U-2 ① | `serviceRecords` を利用者 × 月で作り直す。`benefits` も `routePlans` も**書かない** |
| U-3 | 取り込み時に `SERVICE_MASTER[serviceCode]` を引き、`unitPrice` として**ドキュメントに写す**。提供票（`servicePlans.rows[].unitPrice`）と同じ作り |
| U-4 | `BenefitPage` にサブタブ「実施記録」を足す。月を選ぶ → **プレビュー** → 確定。`setDoc` で冪等なので何度押してもよい |
| U-10 | 同じサブタブに、取り込んだ合計と `benefits.actualUnits` の差を並べる。**ブロックはしない** |

#### doc ID を `${month}_${residentId}` に変える

現行は `${month}_${residentName から空白除去}`（`../kpi-react/src/hooks/useFirestore.js:1285`）で、
**同姓同名が同一ドキュメントに潰れ、doc ID に利用者氏名が入る**。作り直す以上ここは直す。
`VisitRecord` は `residentId` を持っている（`src/types/contract.ts:255`）ので、
氏名への引き直しそのものが不要になる。

**U-9（`visitId` に氏名が入る件）とは別の話。** あちらは Phase 4 の採番で、直すと既存の
`dispatches` / `visitRecords` の ID が変わる。こちらは書き込み経路が存在しない
死んだコレクションなので、移行の相手がいない（**U-11 の確認が前提**）。

#### 取り込めなかった訪問を必ず見せる

Phase 4 の設計判断2（配信できなかった件数と理由を必ず画面に出す）をそのまま踏襲する。
**黙って落とすと、差分の原因を追えなくなる。** 落ちる理由は次の3つを想定する。

- `SERVICE_MASTER` に無い `serviceCode`（`身体日1.0・2人` のような手入力値）→ 単位数を引けない
- `residentId` が `residentList` に無い（利用者が削除された等）
- 承認されていない（`approvedAt` が `null`）→ そもそも対象外

#### 読み出しは購読しない

`visitRecords` は月あたり数千件になりうる。`onSnapshot` で常時購読せず、
**取り込みのときだけ `getDocs` で月の範囲を取る。** 条件は `date` の範囲のみとし、
承認済みの絞り込みはメモリ上で行う。`status` を条件に足すと複合インデックスが要る
（現在あるのは `staffId + date` の1本だけ）。

### 変更対象ファイル

**kpi-react 側のみ。carerecords 側の変更は無い**（`CLAUDE.md` の例外は Phase 6 の範囲で解除済み）。

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `../kpi-react/src/utils/serviceRecordImport.js` | 新規 | 純粋関数 `buildServiceRecords(visitRecords, residentList, month)`。単位数の引き当て・月次集計・落ちた訪問と理由を返す |
| `../kpi-react/src/hooks/useFirestore.js` | 変更 | `fetchApprovedVisitRecords(month)` を追加（`getDocs`、`date` 範囲）。`saveServiceRecords`（`:1281-1303`）を新しい形に作り直す。doc ID を `residentId` 基準へ |
| `../kpi-react/src/pages/BenefitPage.jsx` | 変更 | props に `serviceRecords` / `saveServiceRecords` / `fetchApprovedVisitRecords` を**受け取る**（`:77`。現在 `App.jsx:372` から渡っているのに捨てている）。サブタブ「実施記録」を追加（`:677-687` の並びに1つ足す）。プレビュー・確定・差分表示 |
| `../kpi-react/src/App.jsx` | 変更 | `fetchApprovedVisitRecords` を `BenefitPage` へ渡す（`:367-376`。他の2つは既に渡っている） |
| `../kpi-react/docs/plans/2026-09-14-record-import-phase6.md` | 新規 | kpi-react 側にも計画書の写しを置く（Phase 3・4 と同じ扱い） |

**変更しないもの。** `firestore.rules`（`serviceRecords` は `kpiCollections()` に含まれ
`isKpiUser()` で読み書きできる。`:244`・`:371`）、`firestore.indexes.json`（`date` 単独の
範囲条件は自動インデックスで足りる）、`src/types/contract.ts`（`VisitRecord` を読むだけ）、
`deleteServiceRecordsByMonth`（`:1305-`。取り込みのやり直しに使えるため残す）。

### データ構造の変更

**あり。** `serviceRecords` のドキュメントの形を作り直す。

```
facilities/{fid}/serviceRecords/{targetMonth}_{residentId}
  id            string    doc ID と同値
  schemaVersion number    ★ 新規。このドキュメントの版（1）
  targetMonth   string    YYYY-MM
  residentId    string    ★ 新規。VisitRecord.residentId
  residentName  string    取り込み時点の氏名（記録の staffName と同じ理由で残す）
  careLevel     string    residentList から写す
  services      [{ serviceCode, serviceName, unitPrice, count, dates: ['YYYY-MM-DD', ...] }]
                          ★ 要素の型を新規に定義する（現行は生成側が無く未定義）
  totalUnits    number    ★ 新規。Σ(unitPrice × count)
  visitCount    number    ★ 新規。取り込んだ訪問の件数
  sourceVisitIds string[] ★ 新規。取り込み元の visitId。突合と再取り込みの判定に使う
  importedAt    string    ★ 新規。ISO
  importedBy    string    ★ 新規。実行した職員の uid
  updatedAt     string
```

**削る。** `kpiName`（参照箇所ゼロ・用途不明）、`limitUnits`（`CARE_LEVEL_LIMITS` から
`careLevel` で引けるため保持しない）。

**`migrating-database` は原則不要。** 既存データが存在しないという前提に立つため
（書き込み経路が 2026-07-28 の導入時から無い）。**ただし U-11 が未確認であり、
ステップ1で本番に既存ドキュメントが見つかった場合は、この計画を止めて
`migrating-database` を先に実行する。**

### 実装順序

各ステップは単独でコミットできる粒度にした。

1. **U-11 を確認する。** 本番の `facilities/*/serviceRecords` にドキュメントがあるかを読み取りだけで確認する。
   **空でなければここで止め、`migrating-database` へ回す。** 併せて `visitRecords` に
   実データが入り始めているかも見る（Phase 5a の本番接続が未了のため、無い可能性がある）
2. **`serviceRecordImport.js` を作る。** 純粋関数のみ。Firestore にも React にも依存させない。
   入力は `visitRecords` / `residentList` / `month`、出力は `{ records, skipped }`。
   `skipped` は `{ visitId, reason }` の配列にする
3. **`useFirestore.js` に読み書きを足す。** `fetchApprovedVisitRecords(month)` の追加と
   `saveServiceRecords` の作り直し。画面からはまだ呼ばない
4. **`BenefitPage` に「実施記録」サブタブを足す。** props の受け取り漏れ（`:77`）を直し、
   月を選んでプレビューするところまで。取り込んだ件数・落ちた件数と理由を出す
5. **確定と差分表示を足す。** 取り込みの実行（`saveServiceRecords`）と、
   取り込んだ `totalUnits` と `benefits.actualUnits` の差を並べる表（U-10）
6. **エミュレータで通しで確認する。** carerecords で記録 → 承認 → kpi-react で取り込み → 差分表示。
   `verifying-changes` で行う

**U-6・U-7・U-8 はステップ2で決める。** いずれも `buildServiceRecords` の中の判断に閉じる。

- **U-6**: `benefits` は書かない。差分は**見せるだけ**にする（反映の導線は作らない）
- **U-7**: 実績時刻が空でも**取り込む**。単位数は `serviceCode` から引くため影響しない。
  提供時間は `services[].dates` に日付だけを残し、時刻は持たせない
- **U-8**: 契約どおり配信側（`DispatchVisit.cancelled`）を正とする。`VisitRecord.status` が
  `'キャンセル'` のものは取り込まず、`skipped` に理由付きで出す

### リスク

1. **取り込んだ合計は `benefits.actualUnits` と必ずずれる。** 配信対象外の訪問
   （`身体日1.0・2人` 9件、`初回加算` / `他事業所` / `訪看*`）は実施記録が生まれない
   （`../kpi-react/src/utils/dispatch.js:36-40`）。**差分を「異常」と読ませない見せ方**が要る。
   U-10 をブロックなしに留めたのはこのため
2. **`SERVICE_MASTER` の改定で過去月が変わらない代わりに、改定前後が混在する。**
   `unitPrice` をドキュメントに写す設計の裏返し。提供票が既に同じ性質を持っているので
   新しい問題ではないが、取り込み直すと値が変わる点は運用に伝える必要がある
3. **差分表示だけは氏名で突き合わせる。** `serviceRecords` は `residentId`、
   `benefits.name` は氏名文字列。Phase 4 の実データ検証では同姓同名0件だったが、
   **構造としては保証がない**。一致しなかった行は「対応する給付管理が無い」として出す
4. **`visitRecords` に実データがまだ無い可能性がある。** Phase 5a・5b の本番接続時の確認
   （App Check・複合インデックス・実データの形・スマホ実機・IndexedDB 不可端末）が未了。
   エミュレータで通せても、本番で動く保証はこの時点では無い
5. **承認者を区別できない施設がある**（U-12）。`nanairo` の施設アカウント3件が同じ `staffId`
   を共有している。取り込んだ実績から「誰が承認したか」を辿れない。**Phase 6 では直さないが、
   取り込み時に `approvedBy` を `sourceVisitIds` と併せて残せるようにしておく**
6. **kpi-react は JavaScript で型検査が無い。** `contract.ts` は参照用に置かれているだけで
   実行されない（`../kpi-react/src/types/contract.ts:8-10`）。`VisitRecord` の形が違っても
   実行時まで気づけない。`buildServiceRecords` の入口で最低限の形の検査を行う

### 適用する Craft Skills

| Skill | 理由 |
|---|---|
| `designing-api-contracts` | `serviceRecords` のドキュメントの形と `services[]` の要素の型を新規定義する。現行は生成側が存在せず型が決まっていない |
| `reviewing-data-boundaries` | 実施記録（法定文書）を請求側へ渡す境界にあたる。何を写し、何を落とし、どこで検証するかの判断を伴う |
| `handling-async-states` | 取り込みは `getDocs` → 集計 → `writeBatch` の非同期処理になる。loading / error / empty / success と重複実行の防止が要る |
| `designing-ui-components` | `BenefitPage` に新しいサブタブと、プレビュー・差分の表を足す |
| `making-accessible` | サブタブ（tabs）を1つ増やす。既存の2つ（`:677-687`）に合わせたキーボード操作とフォーカスの扱いが要る |

`choosing-rendering-strategy` は該当しない（kpi-react は Vite の SPA で Next.js ではない）。
`writing-forms` も該当しない（入力欄を持たず、既存の `benefitMonth` を使う）。
`optimizing-performance` も該当しない（性能要件は無い）。

### Review Required: **yes**

理由は3つ。

1. **DB スキーマの新規定義。** `serviceRecords` のドキュメントの形と `services[]` の要素の型を
   決める。一度書き始めると後から変えるのは高くつく
2. **重要な業務ロジック。** 取り込んだ実績は請求の突合に使われる。落ちた訪問を黙って
   落とすと、記録と請求の不一致（`FR-034`）を見逃す側に倒れる
3. **データ境界をまたぐ。** 法定文書である実施記録を、請求側のコレクションへ写す。
   `CLAUDE.md` の鉄則4 が想定していない向きの初めての実装にあたる

認証・認可の変更は無い（ルールを変えない）。複数画面にも影響しない（`BenefitPage` のみ）。

## 5. Implementation Status

- [x] **ステップ1. U-11 を確認する** — **2026-09-17 に実行した**（`## 6` の「U-11 の確認結果」）
- [x] ステップ2. `serviceRecordImport.js`（純粋関数）を作る
- [x] ステップ3. `useFirestore.js` に読み書きを足す
- [x] ステップ4. `BenefitPage` に「実施記録の取り込み」サブタブを足す
- [x] ステップ5. 確定と差分表示を足す
- [ ] ステップ6. エミュレータで通しで確認する — `verifying-changes` の担当

### ステップ1 を実行できなかった

本番の `serviceRecords` / `visitRecords` を読む Admin SDK スクリプトを用意したが、
**auto mode の分類器が本番読み取りを拒否した**（`[Production Reads]`）。回避はしていない。

スクリプトは scratchpad に置いてある（読み取りのみ。1バイトも書かない）。
許可が出れば `node <scratchpad>/check-phase6-preconditions.mjs` で確認できる。

**コード実装を先行させた判断。** ステップ1 は「新しい形を既存データの上に書き始めない」
ための門であり、書き込みは職員が画面で操作したときにしか起きない。
コードを書くこと自体は何も書き込まない。**ただしリリース前には必ず通す。**
非空だった場合、doc ID を氏名基準から `residentId` 基準へ変えたことが移行を伴う。

### コミット（すべて kpi-react の `feat/phase6-record-import` ブランチ）

```
a52c82d feat(phase6): 承認済み実施記録を月次のサービス実績へ畳む純粋関数を置く
fec966a feat(phase6): 実施記録の取得と月次実績の書き込みを useFirestore に足す
6d6712b feat(phase6): 給付管理に実施記録の取り込みタブを足す
1b0d36c docs: Phase 6（実施記録の取り込み）の計画書を kpi-react 側にも置く
```

kpi-react は `main` に居たため、作業用ブランチを切ってからコミットした。

### 計画から外れた点

1. **承認者（`approvedBy`）を `serviceRecords` へ写さなかった。** 計画のリスク5 は
   「`sourceVisitIds` と併せて残せるようにしておく」としていたが、`reviewing-data-boundaries`
   に従って二重に持たない形にした。承認済みの記録はルール上削除できないため
   （`firestore.rules:594-597`）、`sourceVisitIds` から確実に辿れる
2. **サブタブの3つを配列駆動に書き換え、`role="tablist"` を付けた。** 既存2つの markup にも
   手が入っている（振る舞いは変えていない）。タブが1つだけ正しく、残り2つが素の `<button>`
   という状態は `making-accessible` の観点で成立しないため
3. **`saveServiceRecords` の戻り値を `boolean` から `{ ok, count } | { ok, message }` に変えた。**
   失敗を `alert` で出すのをやめ、画面内に出して再試行させるため（`handling-async-states`）。
   呼び出し元がゼロだったので壊れる相手はいない
4. **月をまたいだプレビューの破棄を `useEffect` ではなく導出で行った。** ESLint の
   `react-hooks/set-state-in-effect` に当たったため。読んだ月を状態に持ち、表示側で
   今の月と突き合わせる。前の月の集計が一瞬でも新しい月のものとして見えることが無い

### 実装中に気づいた点

**手を付けていない。**

- **`useFirestore.js` に ESLint エラーが11件ある**（`no-irregular-whitespace` 4件、
  `no-dupe-keys` 7件）。すべて変更前から存在する。`no-dupe-keys` は hook の戻り値
  オブジェクトで同じキーを二度書いており、**後の定義が勝っている**。実害の有無は未確認
- **`BenefitPage.jsx` に `react-hooks/static-components` エラーがある**（レンダー中に
  コンポーネントを生成している）。変更前から存在する
- **`benefits` の doc ID は今も非冪等**（`${targetMonth}_${Date.now()}`）。
  Phase 6 は `benefits` を書かないため触れていないが、同じ利用者・同じ月の行は
  今も増えうる。画面側の `find` だけが重複を防いでいる
- **`syncActualToPlans` は時刻を変更していない訪問の実績マークを消す**
  （`VisitRoutePage.jsx:1390-1394`）。取り込み先に `routePlans` を選ばなかったので
  今回は無関係だが、利用票の実績が信用できない状態は残っている

### 振る舞いの変更（差し戻し対応・2026-09-15）

`## 6` の検証で見つかった1件を直した。コミット `aaafac5`。

- **変更前**: 取り込める記録が0件のとき、確定のボタンを出していなかった。
  `handleApplyImport` も `records.length === 0` で早期に返していた
- **変更後**: その月に取り込み済みの実績が残っているときに限り、
  「取り込み済みの◯名ぶんを削除する」を出す。押すと確認を挟んでその月を空にする
- **影響**: `saveServiceRecords` は空配列でも正しく動いていた（`keep` が空 →
  同月の既存を全削除）。**塞がっていたのは UI 側だけで、関数側は変えていない。**
  呼び出し元は `handleApplyImport` の1箇所のみで、他に影響しない
- **既存データ**: `serviceRecords` は派生データで、再取り込みで復元できる。
  ただし **U-11（本番が空か）が未確認**のため、全削除には `window.confirm` を挟んだ
  （`deleteServiceRecordsByMonth` と同じ流儀）
- **API 互換性**: 外部クライアントは無い

### コードレビューの指摘と対応（2026-09-14）

`code-reviewer` に独立してレビューさせた。**要修正3 / 推奨6 / 提案5。**
新規の ESLint エラーはゼロ（検出された19件はすべて変更前から存在する行）。

#### 要修正（3件とも対応した。コミット `f2edbba`）

1. **退去した利用者の承認済み記録が取り込めない。** 引き当てに `currentResidentList`
   を使っていたが、これは `departingResidents` に氏名がある利用者を落とす派生値だった。
   月の途中で退去・死亡した利用者の記録が全件「利用者マスタに該当なし」で消える。
   **請求はその月ぶん発生するのに実績だけが消え、突合が最も必要な場面で無力になる。**
   → 請求向けの母集団 `billableResidents`（在籍者 + 退所者）へ変えた。
   `useFirestore.js:476` に既にあり、どの画面からも使われていなかった
2. **給付管理にだけ在る利用者（記録ゼロ）が差分表に出ない。** `compareWithBenefits` が
   `records.map` だったため、実施記録が1件も無いのに `actualUnits` が入っている利用者
   —— まさに `FR-020` が探すもの —— が表に現れなかった。計画書 `## 2` の表は
   「できる」と書いており、**計画と実装が食い違っていた**。
   → 記録と給付管理の和集合で行を作るようにした
3. **再取り込みで対象外になったドキュメントが残り続ける。** `batch.set` だけで、
   前回書いた同月のドキュメントを消していなかった。承認前の記録が削除された・
   利用者が退去した・算定区分がマスタ外に直された場合、古い単位数と既に存在しない
   `sourceVisitIds` を指す実績が月次に残る。**「冪等」は書くだけでは成立しない。**
   → その月の実績を結果で置き換える形にした。併せて `writeBatch` の500件上限に
   当たらないよう分割した（分割した時点で全体の原子性は無くなるが、冪等なのでやり直せる）

#### 推奨（6件とも対応した）

- **単位数 0 の算定区分が静かに取り込まれていた。** `constants.js` の障害福祉サービス7件は
  値が `0` で、これは「単位数未登録」の置き値であって報酬0円ではない。訪問件数には乗って
  単位数には乗らず、差分表で加算の欠落と区別が付かなくなる → 理由付きで落とす
- **`schemaVersion` を検査していなかった。** コメントには「版を上げた事故をここで弾く」と
  書いてあるのに `REQUIRED_FIELDS` に入っておらず、**宣言した防御が実装されていなかった**
  → `ACCEPTED_VISIT_RECORD_VERSION = 3` と照合する
- **取得した記録をそのまま渡しており、`vitals` / `note` / `mood` / `memo` が
  給付管理側へ運ばれていた。** 契約は「`mood` / `memo` は kpi-react は読まない」と明記して
  いる。Firestore のクライアント SDK にフィールド射影が無い以上、取得の出口で絞るのが
  この境界での唯一の防御になる → 必要な7項目だけへ写す
- **`fetchApprovedVisitRecords` が承認で絞っていなかった**（絞りは `buildServiceRecords` 側）。
  名前を信じた次の人が未承認を実績として数える → `fetchVisitRecordsByMonth` へ改名
- **月を切り替えながら読み込むと応答が入れ違い、無反応になる。** 先に始めた読み込みが
  後から届いて上書きし、月が合わずに捨てられる → 通し番号で古い応答を捨てる
- **全件が同じ理由で落ちたときに誤った説明が出る。** 利用者マスタが未読込でも
  「承認が済んでいない記録は対象になりません」と出て、職員が承認状況を疑う
  → 落ちた理由が1種類なら、それを前面に出す
- **React の key の重複**（同姓同名 / `visitId` が空の記録が複数）→ `residentId` と添字へ

#### 対応しなかったもの（理由つき）

- **`benefits` の重複行を `find` が任意に拾う**（提案12）。`benefits` の doc ID が
  非冪等なのは Phase 6 の範囲外。**ヒット行数を差分表に出す**ことで、隠さない形にした
- **`useFirestore.js` の既存 ESLint エラー11件**（`no-irregular-whitespace` 6件、
  `no-dupe-keys` 5件）。すべて変更前から存在する。`no-dupe-keys` は hook の戻り値で
  同じキーを二度書いており後勝ちになっている。**実害の有無は未確認**
- **`BenefitPage.jsx` の `react-hooks/static-components`**。変更前から存在する

#### レビューで問題が無いと確認された箇所

`date` の範囲指定（`YYYY-MM-DD` 固定長の辞書順比較）、`firestore.rules` と
`firestore.indexes.json` を変更しない判断、doc ID を `residentId` 基準へ変えたこと、
重複実行の防止、loading / error / empty / success の4状態、`role="tablist"` 化が
既存の振る舞いを壊していないこと、計画外の変更が混ざっていないこと。

## 6. Verification

### 検証環境

Firebase エミュレータ（auth 9099 / firestore 8085、`kpi-react/firestore.rules` を適用）に、
carerecords の `npm run seed` で施設・職員5名・配信15件を流した。kpi-react 側の
`residentList` 8件と `benefits` 2件は検証用に別途用意した（うち1件は
**実施記録が1件も無いのに実績が入っている利用者**＝`FR-020` の検出対象）。

両アプリを dev サーバーで起動し、ヘッドレスブラウザで実際に操作した。
carerecords `localhost:5174` / kpi-react `localhost:5175`（`VITE_USE_EMULATOR=1`）。

### 検証項目

- [x] **kpi-react がエミュレータへ繋がる**
  - ログイン要求が `127.0.0.1:9099`（Auth エミュレータ）へ飛ぶことを確認。
    seed した職員5名がホーム画面に出た
- [x] **carerecords で記録を保存できる**
  - ヘルパー（佐藤 健一）でログイン → 上野山 正子の訪問を「予定どおりに入力」→ 保存。
    `済（登録あり）1件` / `実施時間 合計 8分` に変わった
- [x] **サービス提供責任者が承認できる**
  - 中山 理恵でログイン → 未承認一覧 → 選択して承認。エミュレータの実データで
    `status=完了` / `approvedAt=2026-09-15T07:00:14.106Z` / `approvedBy=s001（中山 理恵）`
- [x] **取り込みのプレビューが出る**
  - 給付管理 → 実施記録の取り込み → 読み込み。
    `取り込む利用者 1名` / `訪問 1件` / `合計単位 244`（`身体介護1` = 244 と一致）
- [x] **給付管理にだけ在る利用者が差分表に出る（要修正2）**
  - 3行すべて出た。`岩佐 久子: 記録なし / 5,000`、`記録ゼロ 三郎: 記録なし / 900`、
    `上野山 正子: 244 / 行なし`
- [x] **差が計算される**
  - 記録を1件足して再取り込みすると `岩佐 久子: 1訪問 / 179 / 5,000 / -4,821`
- [x] **取り込むとドキュメントが作られる**
  - `facilities/mock-facility/serviceRecords/2026-09_r005`。
    doc ID が `${month}_${residentId}` になっており、氏名が入っていない。
    `schemaVersion: 1` / `services: [{serviceCode:'身体介護1', unitPrice:244, count:1, dates:['2026-09-15']}]` /
    `totalUnits: 244` / `sourceVisitIds` / `importedAt` / `importedBy`
- [x] **再取り込みで対象外になった実績が消える（要修正3）**
  - 足した記録を削除して再取り込み →「1名ぶんのサービス実績を取り込みました
    **（対象外になった1件を削除）**」。`serviceRecords` が2件から1件に戻った
- [x] **全件が同じ理由で落ちたときの表示（推奨9）**
  - 承認を外すと「**1件すべてが「未承認」で対象外でした**」「・未承認: 1件」が出た。
    承認を疑わせる誤った説明は出ていない
- [x] **その月の対象が0件になったとき、取り込み済みの実績を消せる**
  - 当初**失敗**（下に詳述）。`modifying-feature` で直し、2026-09-15 に再検証して通過
- [ ] **`writeBatch` の分割（500件超）** — **未検証**。1施設・1か月で500件を超える
      利用者数を用意できていない
- [ ] **権限拒否時のエラー表示** — **未検証**。`isKpiUser` 以外で取り込みを試していない
- [x] **本番の `serviceRecords` が空か（U-11）** — **確認した（2026-09-17）。空ではない**

### U-11 の確認結果（2026-09-17）

本番（`kpi-system-a718f`）を Admin SDK の読み取り専用スクリプトで確認した。

**確認したパスの訂正。** `serviceRecords` はトップレベルではなく
`facilities/{facilityId}/serviceRecords` である（`useFirestore.js:244`）。
トップレベルの `serviceRecords` は存在せず、最初にそちらを見て「空」と誤認した。

| | |
|---|---|
| 存在する施設 | `koharunosato`（小春の里）のみ。他16施設は0件 |
| 件数 | 43件。すべて `targetMonth: '2026-06'` |
| doc ID | `2026-06_三尾義彦` のように**氏名ベース**。`residentId` は43件とも**無い** |
| `schemaVersion` | **無い**（Phase 6 以前の書き込み） |
| 持っているフィールド | `id` / `targetMonth` / `residentName` / `kpiName` / `careLevel` / `limitUnits` / `services[{name,planned,actual}]` / `updatedAt` |
| 同月の `benefits` | 41件（2026-06） |

**移行は要らない。ただし 2026-06 を取り込んではいけない。**
`saveServiceRecords` は `targetMonth == month` の既存ドキュメントを取り直し、
`keep`（`${month}_${residentId}` の集合）に無いものを削除する。旧43件は ID の形が
違うため必ず `keep` から外れ、**2026-06 を取り込んだ瞬間に43件とも削除される**。
そして実施記録は本番に0件なので、いま取り込むと `records` が空 = 新しい行は1件も
作られず、**43件が消えて0件になる**。`window.confirm` は挟んであるが、
取り込み UI は既に本番に出ており、この状態で誰かが 2026-06 を選べば起きる。

旧43件が持つ `kpiName` と `limitUnits` は新形式には無い。ただしこの2つを読む画面は
無く（`limitUnits` は `CARE_LEVEL_LIMITS` から再計算、`kpiName` は未参照）、
失われて困るのは `services[].planned` / `actual` の実績そのものである。

**控えを取った（2026-09-17）。** 43件を JSON に書き出し、件数と doc ID の一致を
読み直して照合した。`services[].actual` の合計は 3,865。

```
/Users/shimazaki/Desktop/Projects_Web/_backups/serviceRecords-koharunosato-2026-09-17.json
```

両リポジトリの外に置いてある（`Projects_Web/` は git 管理下ではない）。
利用者氏名を含むため、リポジトリに入れないこと。

**打ち手**: 2026-06 を取り込む必要が出るまでは触らない。`residentName` から
`residentId` を引いて新形式へ書き換える移行も可能だが、**その月の実施記録が
carerecords 側に無い以上、移行しても取り込みで消える**ため、移行の意味があるのは
実施記録が貯まってからである。

### 失敗: その月の対象が0件になると幽霊が残る

**要修正3 の直しが、全件が対象外になった場合だけ効かない。**

再現手順と観測。

1. 9月ぶんを取り込む → `serviceRecords/2026-09_r005`（`totalUnits: 244`）ができる
2. その記録の承認を外す（承認前の記録は削除もできる。`firestore.rules:594-597` は
   `approvedBy == null` のときだけ delete を許している）
3. 同じ月をもう一度読み込む

観測されたもの。

```
取り込み済み 1名（最終 2026/9/15 16:01:37）
2026年09月に取り込める実施記録はありませんでした。
1件すべてが「未承認」で対象外でした。
・未承認: 1件
```

**「取り込み済み 1名」と「取り込める実施記録はありません」が同じ画面に並ぶ。**
`serviceRecords/2026-09_r005` は `totalUnits: 244` のまま残り、`sourceVisitIds` は
もう承認済みではない記録を指している。

原因は、0件のときに確定のボタンごと出していないこと
（`BenefitPage.jsx` の empty 分岐）と、`handleApplyImport` が
`records.length === 0` で早期に返すこと。**削除は `saveServiceRecords` の中にあるので、
呼ばれなければ何も消えない。**

`deleteServiceRecordsByMonth` は残してあるが取り込みからは呼んでおらず、
`window.confirm` 付きの全削除なのでこの用途には使えない。

これは「0件の結果を確定させてよいか」という振る舞いの決めごとであり、
`verifying-changes` の範囲では直さない。

### 検証結果

- **build**: 通過（kpi-react `npm run build`）
- **lint**: 変更した4ファイルに**新規のエラーはゼロ**。リポジトリ全体では191件の指摘が
  出るが、すべて変更前から存在する
- **type check**: 該当なし（kpi-react は JavaScript。`contract.ts` は参照用で実行されない）
- **test**: 該当なし（このリポジトリに単体テストは無い。`test:rules` はルール専用で今回は対象外）
- **動作確認**: 9項目中7項目通過、1項目失敗、3項目未検証

### verifying-changes 内で修正したもの

**なし。**

### 差し戻したもの

- **その月の対象が0件になったときに取り込み済みの実績を消せない** → `modifying-feature`
  → **対応済み（コミット `aaafac5`）。下記のとおり再検証して通過した**

### 再検証（差し戻し対応後・2026-09-15）

エミュレータを作り直し、承認済みの記録1件を取り込んでから承認を外し、
同じ月をもう一度読み込んだ。

- [x] **警告と削除の導線が出る**
  - 「この月には取り込み済みのサービス実績が1名ぶん残っています。」
    「取り込んだあとに承認が取り消された、または記録が削除された可能性があります。」
    「取り込み済みの1名ぶんを削除する」
- [x] **確認を挟む**
  - 「2026年09月に取り込める承認済みの実施記録はありません。／
    取り込み済みのサービス実績1名ぶんを削除して、この月を空にします。／よろしいですか？」
- [x] **削除される**
  - 「✓ 取り込み済みのサービス実績1名ぶんを削除しました」。
    `serviceRecords` が **0件**になり、画面から「取り込み済み ◯名」の表示も消えた
- [x] **取り込み済みが無いときは導線を出さない**
  - 削除後の画面に警告ボックスも削除ボタンも出ていない

**build**: 通過。**lint**: 変更ファイルに新規エラーなし（宣言順で一度
`react-hooks/immutability` が出たため、`importedThisMonth` の宣言を
`handleApplyImport` の前へ移した）。

## 7. Result

**Phase 6（承認済み実施記録の取り込み）は完了とする（2026-09-15）。**
ただし**リリース前に U-11 の確認が必須**である（後述）。

### 何ができるようになったか

- **「いつ・誰が・何を実施したか」が kpi-react から日単位で読める。**
  これまで実績の受け皿は `benefits`（手入力 / Excel）・`routePlans.rows[].actual`
  （時刻を変更した訪問だけ）・`records`（施設 × 日の手入力）に分散しており、
  実施記録を入力にしたものは1つも無かった
- **給付管理の画面から、月を選んで取り込める。** 何名・何件・何単位を取り込むかを
  見てから確定する。doc ID が `${month}_${residentId}` 固定なので何度押してもよい
- **記録と請求の食い違いが表に出る。** 取り込んだ単位と `benefits.actualUnits` を
  並べ、**記録が1件も無いのに請求がある利用者**（`FR-020`）も行として出す
- **取り込めなかった訪問が理由つきで残る。** マスタ外の算定区分、単位数が未登録の
  算定区分、未承認、キャンセル、利用者マスタに無い、契約の版違い
- **取り込み直すと実態に合う。** 対象外になった実績は消える。その月の対象が
  全部消えた場合も、確認のうえ空にできる

### 実装したもの（すべて kpi-react。carerecords 側の変更はゼロ）

| ファイル | 種別 |
|---|---|
| `src/utils/serviceRecordImport.js` | 新規。集計・判定・突合の純粋関数 |
| `src/hooks/useFirestore.js` | `fetchVisitRecordsByMonth` 追加、`saveServiceRecords` 作り直し |
| `src/pages/BenefitPage.jsx` | props の受け取り漏れ修正、サブタブ「実施記録の取り込み」 |
| `src/App.jsx` | props を2本渡す |
| `src/firebase.js` | エミュレータ接続（計画外。`VITE_USE_EMULATOR=1` のときだけ） |

`firestore.rules` と `firestore.indexes.json` は**変更していない**。

### リリース前に必ずやること

- **U-11。確認済み（2026-09-17）。空ではなかった。** `koharunosato` に 2026-06 の43件が
  氏名ベースの doc ID で残っている（`## 6` の「U-11 の確認結果」）。移行は不要だが、
  **2026-06 を取り込むと43件が削除される**。実施記録が貯まるまでこの月に触らないこと
- Phase 5a・5b が残した本番接続時の確認（App Check・複合インデックス・実データの形・
  スマホ実機・IndexedDB 不可端末の警告）

### 残課題（Phase 6 では扱わなかった）

- **`writeBatch` の500件超の分割が未検証。** 実装はしたが、その規模を再現できていない
- **権限拒否時のエラー表示が未検証。** `isKpiUser` 以外で取り込みを試していない
- **承認者を区別できない施設がある**（U-12）。`nanairo` の施設アカウント3件が
  同じ `staffId` を共有している（Phase 3 の残課題）
- **`visitId` に利用者氏名が入っている**（U-9 で受け入れ）。実データが入る前のほうが
  直すコストは低い
- **`benefits` の doc ID が非冪等。** 同一利用者・同一月の行が増えうる。
  差分表にはヒット行数を出して隠さない形にした
- **`useFirestore.js` の既存 ESLint エラー11件。** とくに `no-dupe-keys` 5件は
  hook の戻り値で同じキーを二度書いており、実害の有無は未確認
- **Phase 5b の持ち越し2件**（セッションをまたいだ再送失敗が無言で巻き戻る、
  キャッシュ由来の古い一覧を「最新」として出している）

### 本番データでの試算（2026-09-17、取り込みは未実行）

承認済みの実施記録が本番に1件できたので、`buildServiceRecords` /
`compareWithBenefits` に**本番のデータをそのまま通して**、取り込みが何を作るかを
書き込みなしで確かめた。

```
実施記録 1 件 / 利用者 28 名 / benefits 0 件 / 既存 serviceRecords 0 件

[取り込まれる] 1 名
  安藤　惠美子（1779844496894_27）  訪問1件 / 209 単位
  services[0] = { serviceCode: '身体介護01・夜', serviceName: '身体介護',
                  unitPrice: 209, count: 1, dates: ['2026-09-17'] }
  sourceVisitIds = ['2026-09-17#1779844496894_27#imp_1084_vklri']
  doc id = 2026-09_1779844496894_27

[対象外] 0 件
[請求との差分] importedUnits=209 / actualUnits=null（benefits が無いため）
```

単位数は `SERVICE_MASTER['身体介護01・夜'] = 209` と一致する。`sourceVisitIds` から
元の実施記録まで辿れる。**doc id は `${month}_${residentId}` の新形式**である。

**この取り込みは安全に実行できる。** `koharunosato` の 2026-06 で警告した事故
（既存43件の削除）は別施設・別月の話であり、`cocolahineno` の `serviceRecords` は
0件、同月の `benefits` も0件のため、消える対象が存在しない。
