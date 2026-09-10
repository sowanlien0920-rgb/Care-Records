---
name: updating-contract
description: kpi-react との共有契約（src/types/contract.ts）を新規定義または変更する。「配信ドキュメントに項目を足したい」「実施記録の型を変えたい」「contract を更新して」のとき、および移行計画のステップ2を実行するときに使う。schemaVersion の更新規則、配信に載せてよい情報の線引き、kpi-react 側への同期手順を扱う。carerecords 固有の型（RecordPrefs など）はこのスキルの対象外で、src/types/local.ts に置く。
---

# updating-contract

`src/types/contract.ts` を変更する。

このファイルは carerecords の内部型ではなく、**kpi-react との契約**である。片側だけを変えると、Phase 4 以降に連携が静かに壊れる。しかも扱うのは訪問介護のサービス実施記録という法定文書なので、形のズレは不具合ではなく**運営指導での指摘・返還リスク**になる。

## 自律性レベル: Low

契約の変更は両システムに影響する。**変更内容を提示して確認を取ってから反映する。** 型の追加であっても勝手に決めない。

## 前提

- 契約の正は **carerecords 側**。`src/types/contract.ts` 1ファイルに集約する
  - kpi-react は JavaScript で型を著述できないため、TypeScript 側を正とする
- kpi-react へは **Phase 4 でコピー**し、JSDoc の `@type {import('./contract').Dispatch}` で参照させる
- npm パッケージ化・モノレポ化は採用しない（別オーナーのリポジトリ2つに対してコストが釣り合わない）
- 背景の全体像は `docs/plans/2026-09-10-carerecords-react-migration.md` を読む

## 契約に含まれるもの / 含まれないもの

| | 置き場所 |
|---|---|
| `Dispatch`（配信ドキュメント）、`VisitRecord`（実施記録）、`CarePlanSnapshot`、`ResidentRef`、`StaffRef`、`schemaVersion` | `src/types/contract.ts` |
| `RecordPrefs`（敬称・口調・長さ・記載スタイル・好み）、`Incident`、`AuditLog`、画面状態の型 | `src/types/local.ts` |

**判定基準。** kpi-react が読むか書くかするなら契約。carerecords の中だけで完結するなら local。

## 配信に載せてよい情報の線引き

`Dispatch` に項目を足すときは、必ずこの基準で判定する。

> **訪問介護計画書に載る情報 = 配信する / 請求・資格に関する情報 = 配信しない**

配信は、Phase 5 以降ヘルパーの端末に届く。ヘルパーは訪問介護計画書に沿って支援する義務があるため、**目標・援助内容・留意事項・ADL は見せるのが正しい**。一方、以下は訪問先で不要であり載せない。

- 生活保護受給状況、減額認定
- 障害者手帳・原爆手帳の有無
- 請求・給付管理に関する数値

判断に迷う項目が出たら、**推測で決めずに確認を取る**。

## 法定文書系は kpi-react が正

以下は kpi-react の `residentList` / `assessments` / `carePlans` が正であり、**carerecords からは書き込まない**。契約上も読み取り専用として扱う。

要介護度 / 世帯状況 / 障害高齢者の日常生活自立度 / 認知症高齢者の日常生活自立度 / 疾患 / 服薬 / ADL / コミュニケーション / 長期目標 / 短期目標 / 援助内容 / サービス内容 / 生活援助の算定理由 / 留意事項

とくに**訪問介護計画書（長期目標・短期目標・援助内容）は kpi-react が版管理している**。carerecords 側に編集手段を作ると、どちらが正か判定できなくなる。

## 手順

### 1. 変更の性質を判定する

| 性質 | schemaVersion |
|---|---|
| 項目の追加（省略可能） | 上げない。読み手が古くても動く |
| 項目の追加（必須） | **上げる** |
| 項目の削除・改名 | **上げる** |
| 型の変更（`string` → `number` 等） | **上げる** |
| 意味の変更（フィールド名は同じだが中身の解釈が変わる） | **上げる。最も見落としやすい** |

### 2. 影響を確認する

- carerecords 側: その型を参照している箇所を `grep` で洗い出す
- kpi-react 側: Phase 4 以降であれば、`saveVisitRoute()` 周辺の配信生成に影響する
  - kpi-react は `../kpi-react/` にある。読み取りのみ行い、変更しない

### 3. 変更内容を提示して確認を取る

以下を示す。

- 変更する型と、変更前 / 変更後
- `schemaVersion` を上げるか、その理由
- 配信に項目を足す場合、上記の線引きに照らした判定
- kpi-react 側に必要になる対応

**確認が取れるまで反映しない。**

### 4. 反映する

- `src/types/contract.ts` を更新する
- `schemaVersion` を上げた場合、`localAdapter` のモック生成も新しい版に合わせる
- ランタイム検証（読み込み時に `schemaVersion` を照合し、不一致なら警告）が機能することを確認する
  - 型のコピーは同期漏れが起きうる。**`schemaVersion` の照合が実効的な安全網になる**ため、これを外さない

### 5. kpi-react 側への同期を記録する

Phase 4 以降で kpi-react にコピーが存在する場合、同期が必要になったことを計画書に記録する。**この場では kpi-react を変更しない。**

## 併読する Craft Skills

- `designing-api-contracts` — スキーマを単一の源とする、後方互換性、バリデーション
- `reviewing-data-boundaries` — 配信に何を載せるかの判断

## やってはいけないこと

- **確認を取らずに契約を変更しない**
- **carerecords 固有の型を `contract.ts` に入れない。** `local.ts` に置く
- **法定文書系の項目に書き込み手段を作らない**
- **`schemaVersion` の更新を省かない。** とくに「意味だけ変えた」ケースを見落とさない
- **kpi-react を変更しない。** 影響の報告までにとどめる
- **配信に載せる情報を推測で決めない**
