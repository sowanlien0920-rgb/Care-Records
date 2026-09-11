---
request: carerecords Phase 1b（記載チェック・特記事項の自動生成・音声入力・CSV）を実装する
status: implementing
created: 2026-09-11
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
Phase 1b（記載チェック・特記事項の自動生成・音声入力・CSV）
```

（2026-09-11、口頭。これが依頼文の全文である。）

### 依頼の背景として参照した既存の記述

Phase 1a の計画書 `docs/plans/2026-09-10-carerecords-react-migration.md` に、Phase 1b の
範囲がすでに記されている。依頼文の4項目はこれと**完全には一致しない**（§2 の決定済み Q1 で決着）。

- `:376` — 「Phase 1b: ドメインロジック移植（`compliance` / `noteBuilder` / `aggregate` / `timeValidation`）+ 音声入力 + AI インターフェース」
- `:963-970`（残課題） — 「ドメインロジックの移植: 記載チェック 474行 / 特記事項の一括作成 147行 / 帳票の集計 168行」「音声入力 308行」「AI 特記事項作成（Cloud Functions 経由。プロバイダ未定）」「CSV 出力（画面と母集団を揃えるかの判断を含む）」「変更履歴（`auditLog`）の表示」

## 2. Clarified Requirements

### 決定済み（2026-09-11・依頼者への確認で確定）

計画書の初版で挙げた未確定11件のうち、まず**6件が確定した**（Q1・Q2・Q3・Q4・Q5・Q9）。
**Q 番号は初版のまま据え置く**（以降のセクションからの参照を壊さないため）。
残る5件（Q6・Q7・Q8・Q10・Q11）は、`investigating-codebase` で `## 3` を埋めたうえで
**第2回の確認により全件確定した**（下の「決定済み（第2回）」を参照）。
**本計画書の未確定事項はゼロである。**

**Q1. 範囲 → 「依頼文の4項目 + 不可分なもの」で確定**

含める。
- 記載チェック（記録モーダル）/ 特記事項の自動生成 / 音声入力 / CSV
- **(f) 未完了一覧の「ご本人の様子」「メモ」の保存** — 定型文生成の入力そのものであり不可分
- **(d) 帳票の集計（`domain/aggregate.ts`）** — CSV と母集団を共有するため不可分

含めない（別計画書に回す）。
- (a) ヒヤリハットの記載チェック（`INC_RULES` は記録モーダルと別系統のため）
- (b) ヒヤリハットの AI 報告書作成 / (c) 経過記録のまとめ生成
- (e) 変更履歴（`auditLog`）の書き込みと表示
- (g) 予定の追加 / (h) ヒヤリハットの種別の保存

→ **帰結:** 変更履歴 CSV（CSV の4箇所目）は Phase 1b の対象外になる。CSV は
日次実施記録 / 未承認一覧 / 帳票3種 の**3経路**を実装する。
(a)(b)(c)(h) のスタブは通知のまま残るため、**通知文を「Phase 1b で実装します」から
実態に合うものへ直す必要がある**（(g) は現在「ステップ6で実装します」という誤った文言）。

**Q3. AI の実装範囲 → 「定型文のみ実装」で確定**

- `domain/noteBuilder.ts` に定型文生成（legacy の `localNote` 相当）を実装する。外部通信なしで完結する
- `generateNote(input): Promise<string>` は**インターフェースだけ用意**し、実接続は Phase 5
- 決定 H の「Phase 1 の作業はブロックしない」と、Phase 1 の「localStorage 完結」の両方に整合する
- → **帰結:** Phase 1b 完了時点で「✨ AIで文章作成」は定型文のみを出す。
  `#srcBadge` は `📄 定型文で作成` のみが出る状態になる。
  Cloud Functions の構築とプロバイダ選定は Phase 1b に含まれない

**Q4. 記載チェックの強制力 → 「legacy のまま（警告のみ）」で確定**

- 承認時に `ng` があれば `confirm` で件数と全文を出すが、**続行できる**
- 保存時には記載チェックを行わない（例外は「実績が予定枠外 × サ責でも承認者でもない」の保存中断のみ）
- 鉄則6 を適用する。legacy との突き合わせが成立し、移植の正しさを検証できる状態を優先する
- → **帰結:** 運営指導上のリスク（`ng` のまま承認された記録が残りうる）は残置する。
  `## 5` の「実装中に気づいた点」に記録し、後のフェーズで再検討する

**Q5. CSV の母集団と0件時の挙動 → 「揃える」で確定**

**この1件だけは鉄則6 を適用せず、legacy の挙動を意図的に変更する。**
帳票は請求突合に使うため、画面と CSV の数字が食い違うことが実害になりうるという判断。

- 職員別帳票 CSV もキャンセルを除外し、画面と母集団を合わせる（`legacy/index.html:3728` の挙動を変更）
- 0件時は**全経路で中断**に統一する（帳票の「BOM + ヘッダ行のみのファイルが出る」挙動を変更）
- 日次 CSV に画面のフィルタを効かせる（`cur.filter` を無視する挙動を変更）
- → **帰結:** この3点は legacy と突き合わせても一致しない。`parity-checker` に
  「意図的な差分」として申し送る必要がある。
  なお**行の粒度の差**（画面の職員別は1日1行の日次集約、CSV は1訪問1行）を
  どちらに寄せるかは、この決定では確定していない（`planning-feature` で詰める）

**Q2. 契約の変更 → 「`contract.ts` に追加」で確定**

- `visitRecordSchema` に `mood`（ご本人の様子）と `memo`（ヘルパーのメモ）を追加する
- **`schemaVersion` を上げる。** Zod の必須フィールド追加は既存レコードの読み出しを壊すため。
  実データは存在しない（Phase 1a 計画書の決定 G）ので、Phase 1a の `localStorage` は
  `resetLocalData()`（`src/data/devTools.ts`）で作り直せば済む
- 同じ訪問の情報を1ドキュメントに保つ。kpi-react は読まなくてよいが読める状態になるため、
  **契約のコメントに「carerecords が書き、kpi-react は読まない」と明記する**
- → **帰結:** 変更は `updating-contract` スキルの手順に従う（CLAUDE.md の指定）。
  Phase 5 でも書き込みは1経路のまま保たれる
- ~~**`noteEdited` は Q8 と不可分のため、ここでは決めない。**~~
  → **Q8 で決着した。過去記録への依存を採らないため `noteEdited` は不要になり、契約に追加しない。**
  版上げに含めるのは `mood` / `memo` / `noteSource` の値域変更（Q7）の3つで確定した

**Q9. 音声入力の対象端末 → 「混在」で確定。非対応時は理由を説明して代替を案内**

対象端末は Android スマホ（Chrome）/ iPhone・iPad（Safari）/ iPhone・iPad（Chrome アプリ）/
事務所の PC（Chrome・Edge）の**すべて**。

- → **帰結1: 音声入力は「使える端末と使えない端末が混在する」前提で作る。**
  iOS は Safari も Chrome アプリも中身が WebKit のため同じ制約を受け、
  `webkitSpeechRecognition` が存在しても実質動かないケースがある。
  **「動かない端末がある」ことを欠陥ではなく仕様として扱う**
- → **帰結2: legacy の「黙って非表示」は採らない。** ボタンは出さないが、
  「この端末では音声入力を使えません。キーボードのマイクをご利用ください」を一行出す。
  legacy にはこの文言が無いため**新規に起こす**
- → **帰結3:** 音声入力が使えない端末でも、記録の入力そのものは完結する必要がある。
  音声入力を前提にした導線（音声でしか入力できない欄）を作らない
- → **帰結4:** Phase 5 の配信先が HTTPS であることが前提になる（secure context 要求）

### 確定

依頼文の4項目を、legacy の実装と Phase 1a の到達点に照らして展開したもの。
**ここに挙げたのは「legacy にその実装が存在し、Phase 1a が意図的に先送りした」ことが
コードで確認できたものに限る。** 範囲そのものは「決定済み」の Q1 で確定している。

#### (1) 記載チェック

- `src/domain/compliance.ts` を新設し、判定を**純粋関数**として実装する
  - 計画書（Phase 1a）で予告済みの形: `check(record, plan, prefs): Finding[]`（`:141` 付近）
  - **純粋関数であることが必須要件になる。** legacy の `lintNote()` は記録モーダル専用ではなく、
    未承認一覧の統計（`legacy/index.html:3492`）・行表示（`:3504`）・一括承認の確認文面（`:3554`）・
    CSV の「要修正件数」列（`:3577`）の計算式に組み込まれている。純粋関数として切り出せないと
    これら4箇所が同時に成立しない
- 記録モーダルの判定項目は legacy と同一とする。内訳は以下で全17種
  - **正規表現ルール9件**（`legacy/index.html:2327-2346` の `LINT_RULES`）
    ng 6件（診断名の断定 / 医行為 / 服薬させる表現 / 日常生活の援助の範囲を超える行為 /
    本人以外への援助 / 尊厳を欠く表現）、warn 3件（徘徊 / してあげる / 推測・伝聞）
  - **自動修正（`.fixbtn`）を持つのは3件のみ**（服薬・徘徊・してあげる。`:2333` `:2341` `:2343`）
  - **本文が空のときは warn 1件を返して即 return し、以降の判定を一切行わない**（`:2354`）
  - 訪問介護計画との突き合わせ（`v.tasks` ⊄ `p.tasks` → ng。`:2361-2366`）
  - 生活援助の算定理由（生活援助 × 同居家族あり × 理由未登録 → ng。`:2368-2370`）
  - 予定枠との整合（`outOfPlan()` → ng。`:2372-2374` / `:3074-3082`）
  - 実績時間（未入力 → warn。予定との差 15分以上 → warn。`:2376-2382`）
  - 具体性（25文字未満 → warn。「特変なし」等の単独記載 → ng。**この2件は同時に立つ**。`:2384-2385`）
  - 短期目標への言及（目標登録済み ∧ 60文字超 ∧ **ここまでに ng が1件も無い** → warn。`:2387-2390`）
- 重大度は `ng` / `warn` / `ok` の3段階。描画クラスは `lv-ng` / `lv-warn` / `lv-ok`
- 描画先は `<div class="lint" id="lintBox">`。DOM は legacy と同一階層にする
  - `.lintitem .ic` / `.lintitem b` / `.lintitem .fixbtn` は子孫セレクタ（`src/styles.css:351-360`）
  - `.fixbtn` の `border:1px solid currentColor` と `color:inherit` は
    **親の `.lv-ng` / `.lv-warn` から継承した `color` に依存する**
- **判定結果は永続化しない。** legacy も保存しておらず、表示のたびに再計算している
- 強制力は legacy と同じにする（**Q4 で確定**。警告のみで、承認はブロックしない）
  - 保存時（`mSave`）は記載チェックを行わない。例外は「実績が予定枠外 × サ責でも承認者でもない」
    のときだけ保存を中断する（`legacy/index.html:2004-2010`）
  - 承認時（`mApprove`）は `ng` があれば `confirm` で件数と全文を出し、**続行できる**（`:2028-2038`）

#### (2) 特記事項の自動生成

- `src/domain/noteBuilder.ts` を新設し、**定型文生成**（legacy の `localNote()` 121行、
  `legacy/index.html:2451-2571`）を移植する。外部通信なしで完結する
  - 8ブロック構成（訪問 / 実施内容 / 介助の程度 / コミュニケーション配慮 / バイタル /
    本人の様子 / ヘルパーのメモ / 締め）
  - `tone`（`polite` / `plain`）で全文末が分岐、`len`（`short` / `normal` / `long`）で
    出すブロックが6箇所分岐する（`:2494` `:2511` `:2523` `:2551` `:2556` `:2561`）
- AI 生成はアダプタ境界の裏に置く。クライアントは `generateNote(input): Promise<string>` だけを知る
  - Phase 1a 計画書の決定 H（`:107`）で確定済み。プロバイダの選定と切り替えは Functions 側に閉じる
  - **legacy の API 実装は移植しない。** `legacy/index.html:2684-2716` の `callClaude()` は
    ブラウザから `api.anthropic.com` を直接叩き（`anthropic-dangerous-direct-browser-access: true`）、
    API キーを `localStorage`（`visitcare.aicfg.v1`）に平文保存している。決定 H はこれを否定している
- 生成の入口は3つあり、legacy では**意味論が違う**。この差を移植で再現するかは Q6
  | 入口 | legacy の挙動 |
  |---|---|
  | 記録モーダル `✨ AIで文章作成` | textarea に入れるだけ。**保存しない**。`元に戻す` で復帰可（`:2719-2759`） |
  | 未完了一覧 `✨ 特記事項` | `v.note` に代入し**即 `save()` + 変更履歴に記録**（`:3418-3446`） |
  | 一括作成 `✨ 特記事項を一括作成` | 1件ごとに**即 `save()`**。進捗バー・中断・並列実行あり（`:2904-2944`） |
- 生成元の表示を復活させる。`#srcBadge`（`.srcbadge`）に `✨ Claude AI で作成` /
  `📄 定型文で作成` / `📄 定型文で作成（AI失敗）` を出す（`legacy/index.html:2723`）
  - 契約の `VisitRecord.noteSource`（`'ai' | 'manual' | null`）は Phase 1a で用意済み。
    ただし legacy は `'ai'` / `'fb'`（AI失敗のフォールバック）/ `'local'`（定型文）の**3値**を持つ（`:2856-2874`）。
    契約は2値のため `'fb'` と `'local'` の区別が落ちる → **Q7 で決着。契約に `'template'` を足して
    3値にし、`'fb'` は `'template'` に寄せる**（Phase 1b では AI を呼ばないため `'fb'` は発生しない）

#### (3) 音声入力

- Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`）を使う。設定は legacy と同一
  - `lang='ja-JP'` / `continuous=true` / `interimResults=true`（`legacy/index.html:3202-3206`）
  - `maxAlternatives` は設定しない。結果は常に `r[0].transcript`
- 対象は4箇所。legacy と同じにする
  | # | 画面 | 入力欄 | ボタン |
  |---|---|---|---|
  | 1 | 記録モーダル 特記事項 | `#fNote`（textarea） | `.micbtn`（`🎤 音声入力`） |
  | 2 | 記録モーダル メモ | `#fMemo`（input） | `.micmini` |
  | 3 | ヒヤリハット 発生時のメモ | `#iMemo`（input） | `.micmini` |
  | 4 | 未完了一覧の各行（記録未完成の行のみ） | 行内メモ（input） | `.micmini` |
- 動作
  - **トグル**（押している間だけではない）。同じボタン再押下で停止、別ボタン押下で切り替え
  - **無音では止まらない。** `onend` で自動再開する（`legacy/index.html:3231-3233`）
  - 中間結果は `.mic-live` にのみ表示し、**入力欄には入れない**。確定結果だけを挿入する
  - 挿入は**置換ではなくカーソル位置への挿入**。textarea は区切りなし、input は `／` を挿入（`:3168-3180`）
  - 確定結果の末尾に句点を補う（`micPunct()`、`:3157-3162`）。**後処理はこれだけで、
    フィラー除去・用語変換の辞書は存在しない**
- `.mic-live` は `.on` が無いと表示されない（CLAUDE.md 鉄則5 の10種のうちの1つ）
- 認識中のエラー処理は legacy の文言をそのまま使う（`legacy/index.html:3219-3230`）
  - 非対応ブラウザはボタンを非表示にする（`:3239`）が、**legacy と違い理由を一行出す**（Q9 で確定）
  - `no-speech` は無視して自動再開に任せる。`not-allowed` / `service-not-allowed` /
    `audio-capture` / `network` は固定文言、それ以外は `音声入力エラー（${error}）`
- Phase 1a が省略した DOM を追加する（下記「前提として置いたもの」の3を参照）

#### (4) CSV 出力

- legacy の CSV は**4箇所**ある。うち**変更履歴を除く3経路が Phase 1b の対象**（Q1 で確定）
  | # | CSV | legacy | React の現状 |
  |---|---|---|---|
  | 1 | 日次 実施記録（15列） | `legacy/index.html:1833-1848` | `VisitList.tsx:52` にボタンあり。**通知が「ステップ6で実装します」のまま** |
  | 2 | 未承認一覧（12列） | `:3570-3581` | `PendingModal.tsx:123` にスタブ |
  | 3 | 帳票 3種（職員別8列 / 利用者別10列 / 集計6列） | `:3721-3749` | `ReportModal.tsx:69` にスタブ |
  | 4 | 変更履歴（6列） | `:3056-3062` | **画面ごと存在しない。Q1 で対象外に確定** |
- 形式は4箇所で共通。これは揃っているのでそのまま踏襲する
  - UTF-8 + **BOM**（U+FEFF）、改行 **CRLF**
  - **全フィールドを無条件でダブルクォートで囲む**。`"` は `""` に二重化。
    カンマ・改行は特別扱い不要（常にクォート済みのため RFC 4180 上問題にならない）
  - `null` / `undefined` は空文字
- ダウンロードは Blob + `a[download]`。legacy は `dl()`（`:2955-2959`）で3秒後に `revokeObjectURL`
- **母集団と0件時の挙動は legacy 内で不統一。Q5 で「揃える」と確定した**（legacy から意図的に変更する唯一の箇所）

#### (5) 全体に共通

- `src/styles.css` を書き換えない。DOM の入れ子を legacy に合わせる（CLAUDE.md 鉄則2）
- `localStorage` を直接触らない。`useCareStore()` とアダプタ境界を経由する（鉄則3）
- 法定文書に属する情報を carerecords から書き込まない（鉄則4）
- legacy のバグを移植のついでに直さない。気づいた点は `## 5` に記録する（鉄則6）
  - Q4（記載チェックの強制力）は**鉄則6 を適用**すると確定した
  - Q5（CSV の母集団・0件時）だけは**鉄則6 を適用せず、意図的に変更**すると確定した
  - **Q10・Q11 も鉄則6 を適用しないと確定した**（第2回。純粋関数化と自動修正の不整合を両方とも直す）

### 決定済み（2026-09-11・第2回。残る5件がすべて確定した）

`investigating-codebase` で React 側の影響範囲（`## 3`）を洗い出したうえで、依頼者に確認して確定した。
**これで本計画書の未確定事項はゼロになった。**

#### Q6. 生成した特記事項を即保存するか → 「legacy の差を再現。ただし行 DOM の手書き差し替えは再現しない」で確定

- 入口ごとの意味論は legacy のまま移植する
  - 記録モーダル `✨ AIで文章作成` — textarea に入れるだけ。**保存しない**。`元に戻す` で復帰できる
  - 未完了一覧 `✨ 特記事項` — `note` に代入して**即保存**
  - 一括作成 `✨ 特記事項を一括作成` — 1件ごとに**即保存**
  - 全経路を下書きに統一する案は、一括作成が「まとめて生成するが保存しない」となって
    機能として成立しないため採らない
- **`legacy/index.html:3427-3440` の「その行だけを緑の『作成しました』に手書きで差し替える」実装は
  再現しない。** 素直に再描画し、完了は `notify()` で伝える
  - legacy はこの差し替えのために `late` クラスが落ちる / 曜日と実施内容の表示が元の行と食い違う /
    件数表示 `#tCount` が更新されない、という副作用を抱えている。再現する価値がない
  - 生成で `note` が入るとステージが `-1` になって**行は一覧から消える**。これは
    `todoStage`（`src/domain/visitStatus.ts:30-37`）の正しい挙動であり、そのまま消してよい
- → **帰結:** 未完了一覧は「✨ を押す → 保存される → 行が消える → トーストで『作成しました』」になる。
  legacy と突き合わせると**行の見た目の遷移だけが一致しない**。`parity-checker` に意図的な差分として申し送る
- → **帰結:** 変更履歴（`auditLog`）への記録は Q1 で対象外に確定しているため、即保存の2経路でも書かない

#### Q7. `noteSource` の粒度 → 「契約に `'template'` を追加して3値にする」で確定

- `VisitRecord.noteSource` を `'ai' | 'template' | 'manual' | null` にする（`contract.ts:243`）
- **Q2 の版上げに同梱する。** `mood` / `memo` と同じ1回の `schemaVersion` 更新で済ませ、二重の版上げを避ける
- legacy の `'fb'`（AI 失敗 → 定型文で代替）は `'template'` に寄せる。Phase 1b では AI を呼ばないため
  `'fb'` が発生する経路自体が存在しない。Phase 5 で AI を実接続するときに、
  「AI 失敗のフォールバック」を区別する必要があるかを再検討する
- 表示の対応
  | 値 | 一覧アイコン（`VisitRow.tsx:95`） | `#srcBadge` |
  |---|---|---|
  | `'ai'` | ✨ | `✨ Claude AI で作成`（Phase 1b では出ない） |
  | `'template'` | ✨ | `📄 定型文で作成` |
  | `'manual'` / `null` | 📝 | 出さない |
- → **帰結: 手入力時に `'manual'` を書く実装も Phase 1b で新規に起こす。**
  現在 `noteSource` は読み手2箇所に対し**書き手が0箇所**で、手入力しても `null` のままになっている（`## 3`）
- → **帰結:** 運営指導の観点で「AI が書いた / 定型文が組み立てた / 人が書いた」の区別が記録に残る

#### Q8（後半）. 定型文生成の過去記録依存 → 「依存させない。純粋関数にする」で確定

**`domain/noteBuilder.ts` は当該訪問 + `CarePlanSnapshot` + `RecordPrefs` だけを入力に取る。**
`db.visits` の全走査に依存する legacy の3つの挙動は移植しない。

- 落とすもの: 文体のバリエーション（`noteVariant`、`:2443`）/ 直前の記録との書き出し重複回避
  （`:2463-2466`）/ 平常時体温との比較（`:2518-2535`）
- 採る理由
  - **同じ入力なら必ず同じ出力になる。** テストランナーが無い現状（`## 3`）でも検証できる唯一の形になる
  - Phase 5 で Firestore になっても、**1件の生成のためにその利用者の全記録を読まずに済む。**
    現在の `listVisitRows` は日付・職員で絞る前提で作られている（`adapter.ts:149`）
  - `noteEdited`（職員が生成文に手を入れたか）は legacy では `learnPhrases` の重み付けにしか
    使われていない。過去記録依存を採らない以上**不要になる**ので、**契約に追加しない**
- → **帰結:** 生成される文章は legacy より単調になる。`parity-checker` に意図的な差分として申し送る
- → **帰結:** Q2 の版上げに含めるのは `mood` / `memo` / `noteSource` の値域変更の3つで確定した
- **前半（外部 AI への送信範囲の妥当性）は Phase 5 への申し送りのまま据え置く。**
  Phase 1b では外部通信が発生しないため判断不要

#### Q10・Q11. 鉄則6 の適用 → 「両方とも直す」で確定

**Q10（`lintNote` の DOM 依存）— 純粋関数化する。DOM 依存は再現しない。**

- legacy の `lintNote(v)` は `$('mask').classList.contains('on')` と `$('fNote').value` を読むため
  （`legacy/index.html:2349-2350`）、記録モーダルが開いた状態で未承認一覧の統計・CSV が走ると
  **`note` が空の別レコードを、開いているモーダルの本文で判定する**
- `compliance.ts` は `check(record, plan, prefs): Finding[]` の純粋関数にする。
  これは確定事項(1) の必須要件であり、未承認一覧の統計・行表示・一括承認の確認文面・CSV の
  「要修正件数」の4箇所が同時に成立するための前提でもある
- 記録モーダルの「編集中の本文で判定する」挙動は、**モーダル側が `draft.note` を引数として渡す**ことで
  再現する（DOM を読むのではなく、state を渡す）

**Q11（自動修正ボタンの正規表現不整合）— 検出と置換の正規表現を揃える。**

- ルール3（服薬）: 検出 `薬を飲ませ` に対し置換は完全形のみ（`:2333`）
- ルール8（してあげる）: 検出 `してあげ(た|ました|る)` に対し置換は `してあげました` のみ（`:2343`）
- legacy のままだと「薬を飲ませて」「してあげる」等で**自動修正を押しても何も置換されず、
  同じ指摘が出続ける**。ユーザーには「ボタンが効かない」不具合として見える
- → 検出にマッチした文字列がそのまま置換対象になるよう揃える

→ **帰結:** Q5 に続き、鉄則6 を適用しない箇所が2件増えた。**意図的な差分は全部で5件**になる
（Q5 の3点 + Q6 の行 DOM + Q8 の生成文 + Q10 + Q11）。`parity-checker` への申し送りを
`## 5` に一覧としてまとめること

### 対象外

- **Firestore 接続**（Phase 5）。Phase 1b でも永続化は `localStorage` のまま
- **Firebase Auth / 本格的な認証**（Phase 5）。簡易ログインのまま（決定 F）
- **kpi-react 側の変更**（Phase 4 以降）。読み取りのみ、変更しない
- **バックアップ機能**（JSON 書き出し・復元）。Phase 1 の移植対象から外すと確定済み（決定 G）
  - ただし legacy の**変更履歴 CSV はバックアップモーダルの中にある**（`legacy/index.html:1622`）。
    Q1 で変更履歴は対象外に確定したため、**変更履歴 CSV も Phase 1b では作らない**
- **設定画面（`cfg`）の移植**。API キーをクライアントに持つ作りは決定 H が否定している。
  Q3 で「定型文のみ実装」と確定したため、**AI / 定型文の切り替え自体が Phase 1b では不要になった**
  （legacy の一括作成モーダルの `bStyle` / `bTone` / `bLen` / `bFallback` の扱いは `planning-feature` で詰める）
- **法定文書系マスタの編集**（鉄則4。kpi-react が正）
- **氏名文字列キーから ID 参照への移行**。Phase 1a で完了済み（新モデルは ID 参照）。
  legacy の `profOf(name)` / `v.user===name` 系はすべて移植先には持ち込まない
- **Firestore ルールの作り直し**（Phase 2）。Phase 1b と並行して進められるが別作業

### 前提として置いたもの

1. **Phase 1a の成果物には手を入れず、その上に積む。**
   Phase 1a は完了済みで、ブランチ `fix/phase1a-review-followup` の `b23f44c` まで
   コミットされ、作業ツリーはクリーンである。
   → 誤りなら（Phase 1a に差し戻しが要るなら）着手前に指摘が要る

2. **記載チェックの判定は、配信された `CarePlanSnapshot` を正として行う。**
   `carePlanSnapshotSchema`（`contract.ts:115-155`）は `plannedTasks` / `household` /
   `householdSupportReason` / `shortTermGoal` / `adl` / `caution` を既に持っており、
   legacy の `p.tasks` / `p.house` / `p.reason` / `p.goalS` / `p.adl` / `p.caution` に対応する。
   **Phase 1a が記載チェックのために用意した構造なので、これをそのまま使う**
   → 誤りなら契約の設計からやり直しになる

3. **Phase 1a が省略した DOM を Phase 1b で追加する必要がある。**
   記録モーダルの特記事項セクションで、legacy にあって React に無い要素を確認した。
   これらは「ロジックを差し込む」だけでは足りず、マークアップの追加を伴う。
   | 要素 | legacy | React の現状 |
   |---|---|---|
   | `#srcBadge`（`.srcbadge`） | `:945` | 無い（`.srcbadge` は別用途で `RecordModal.tsx:313` に1つある） |
   | `#fMood` / `#fTone` / `#fLen`（`.aibar select`） | `:948-957` | 無い（`.aibar` にボタン3つのみ） |
   | `#undoBtn`（元に戻す） | `:962` | 無い |
   | `.memowrap` + `#fMemo` + `#micMemo` | `:963-966` | **メモ欄ごと無い** |
   | `#micLive`（`.mic-live`） | `:968` | 無い |
   | `#aiHint` | `:970` | 無い（`.aihint` は別用途で3箇所に流用済み） |
   → 誤り（意図的に落としたもので復活させない）なら、対応する機能の要件が変わる

4. **`.lintitem` / `.lv-*` はグローバルなスタイルとして扱う。**
   legacy ではこの組が記載チェック以外に3箇所（承認者認証・パスワード変更・アカウント編集の
   エラー表示）で使われている。ただし**この3つはいずれも Phase 1a で移植していない**
   （簡易ログインのため）ので、現時点の React では記載チェック専用にできる。
   それでも `src/styles.css` を書き換えない鉄則2 により、クラス名は legacy のまま使う
   → 誤りではないと考えているが、将来 Phase 5 で認証系を作るときに再び共有になる

5. **音声入力の4箇所は共通の実装を使う。**
   legacy は `micStart()` に集約されており、欄ごとの差は「対象が textarea か input か」による
   区切り文字（`／`）の差だけである（`:3174`）。認識設定・エラー処理・後処理は4箇所で完全に共通
   → 誤りなら欄ごとの実装が要る

6. **CSV は `domain` に純粋関数として置き、ダウンロードは UI 側で行う。**
   legacy は4箇所それぞれにエスケープ関数をローカル定義しており（`esc` / `esc2` / `q` / `q`、
   実装は完全に同一）、共通化されていない。移植では1つにまとめる
   → 実装方針にあたるため `planning-feature` の領分だが、前提として置いた

7. **依頼文の「CSV」は legacy にある CSV 出力全体を指す。**
   4箇所のうちどれかだけ、という指定ではないと読んだ。ただし変更履歴 CSV は
   **→ Q1 で決着した。変更履歴 CSV は対象外、残る3経路が対象。この前提は解消済み**

8. **Phase 1a 計画書に記された行数は当てにしない。**
   調査で実測したところ、記載チェックは「474行」に対し記録モーダル側は87行（+ ヒヤリハット側24行 +
   CSS 14行）、音声入力は「308行」に対し約151行、特記事項生成は「147行」に対し
   定型文生成だけで121行 + プロンプト構築73行 + API 33行だった。
   **数え方が違うだけと思われるが、規模の見積もりには実測値を使う**
   → 行数は作業量の見積もりにのみ影響し、要件そのものには影響しない

### 既存仕様との競合

#### 競合1: 「Firestore 接続は Phase 5」と「AI は Cloud Functions 経由」

Phase 1 は「バックエンドは localStorage のまま」（`:50`）と確定しているが、
AI 特記事項は「Cloud Functions 経由」（決定 H）と確定している。
Phase 1b は AI 特記事項のクライアント側を作るフェーズなので、この2つが同じフェーズで衝突する。
→ **Q3 で解消した。** 定型文のみを実装し、`generateNote()` はインターフェースだけ用意する。
決定 H 自身の「Phase 1 の作業はブロックしない」に沿う形になった。
**帰結として、Phase 1b 完了時点で「✨ AIで文章作成」は定型文しか出さない。**

#### 競合2: 「legacy のバグを直さない」（鉄則6）と、純粋関数化・自動修正の不整合

鉄則6 は「仕様を変えると突き合わせが成立しなくなる」を理由にしている。
しかし Q10（`lintNote` の DOM 依存）は純粋関数化すれば必然的に挙動が変わり、
純粋関数化は確定事項(1)の必須要件である。Q11（自動修正の正規表現不整合）も、
移植するとユーザーから見て「ボタンが効かない」状態になる。
→ **Q4 は解消した**（鉄則6 を適用し、警告のみのまま移植する）。
**→ Q10・Q11 も解消した**（第2回。両方とも直す）。なお Q5（CSV）は鉄則6 を適用しないと決まったため、
**「鉄則6 を一律に適用する」という前提自体が、この計画書では成り立たない**。
適用するかどうかを項目ごとに判断する必要がある。

#### 競合3: 「日次 CSV は画面のフィルタを無視する」と Phase 1a の UI

legacy の日次 CSV は `cur.filter` を見ない（`dayVisits()` 直取り）。
Phase 1a は `VisitList.tsx` にフィルタを実装済みで、`filter` state を持っている。
「画面で見えているものが出る」という自然な期待と legacy の挙動が食い違う。
→ **Q5 で解消した。** 日次 CSV に画面のフィルタを効かせる（legacy の挙動を意図的に変更する）。

#### 競合なしを確認したもの

- **契約の `CarePlanSnapshot` は記載チェックの入力を満たしている**（前提2）。競合しない
- **`RecordPrefs`（`local.ts:47-60`）は legacy の5項目に対応している。**
  `honorific` / `tone` / `length` / `style` / `likes` = legacy の `honor` / `tone` / `len` / `style` / `like`。
  値域も legacy と一致（`tone: 'polite'|'plain'`、`length: 'short'|'normal'|'long'`）。競合しない
- **`DataAdapter` は記載チェック・CSV に必要なデータ経路を既に持っている。**
  `listVisitRows(scope, range)` / `getPrefs` / `listAuditLogs` / `appendAuditLog`。
  不足しているのは AI 生成の経路（`generateNote`）のみ。競合しない
- **`domain/vocabulary.ts` の `TASK_OPTIONS` 14項目が、記載チェックの計画突き合わせの対象になる。**
  Phase 1a のレビューで「片方だけ直すと突き合わせが静かにずれる」として1箇所にまとめ済み
  （`vocabulary.ts:9-13`）。**この対策は Phase 1b のためのものであり、意図どおり機能する**

## 3. Existing System Investigation

**調査範囲。** legacy 側（記載チェック / 特記事項生成 / 音声入力 / CSV）は本計画書の作成時に
読み取り済みで、結果は `## 2` に反映してある。ここで埋めたのは **React 側の影響範囲**のみ。
2体の読み取り専用エージェント（記録モーダル・音声入力・domain 層 / CSV・帳票集計・未完了一覧）で
分担し、件数は本体で数え直して確定させた。**コードは変更していない。**

### 関連ファイル

#### 変更対象になる画面（`src/features/`）

| ファイル | 行数 | 役割 | Phase 1b での位置づけ |
|---|---|---|---|
| `record/RecordModal.tsx` | 379 | **記録モーダルの全体。`src/features/record/` はこの1ファイルのみ。** セクション1〜6（基本情報 / 予定時間 / 実績時間 / 実施内容 / バイタル / 特記事項）と、フォーム state・検証・保存・承認・削除をすべて内包する | 記載チェック UI / 定型文生成 / 音声入力 / `#srcBadge` / メモ欄。**最も重い** |
| `todo/TodoModal.tsx` | 173 | 未完了の訪問。**`src/features/todo/` はこの1ファイルのみ** | mood・memo の保存 / 行内の音声入力 / ✨特記事項 |
| `report/ReportModal.tsx` | 248 | 帳票3種 + CSV スタブ。**`src/features/report/` はこの1ファイルのみ** | 集計の `aggregate.ts` への抽出 + CSV |
| `approval/PendingModal.tsx` | 212 | 未承認一覧。一括承認あり | CSV。承認時 `confirm` の文面の先例 |
| `visitList/VisitList.tsx` | 103 | サービス実施一覧 | 日次 CSV / 特記事項の一括作成 |
| `visitList/Filters.tsx` | 37 | 絞り込みボタン。`filter` は store 側 | CSV の母集団（読むだけ） |
| `incident/IncidentModal.tsx` | 181 | ヒヤリハット。一覧とフォームが同一モーダル内 | **音声入力だけが対象**（記載チェック・AI 報告書は Q1 で対象外） |

#### 境界と共通基盤

| ファイル | 行数 | 役割 |
|---|---|---|
| `src/store/context.ts` | 121 | `CareStore` インターフェース / `Async<T>` / `PanelKind` |
| `src/store/CareStoreProvider.tsx` | 468 | 実装。取得・保存・打刻・承認・通知 |
| `src/store/useCareStore.ts` | 14 | `useContext` の薄いラッパ。Provider 外で呼ぶと throw |
| `src/data/adapter.ts` | 158 | `DataAdapter` / `VisitRow` / `VisitScope` / `AdapterError`。`listVisitRows` の定義は `:149` |
| `src/data/localAdapter.ts` | 311 | `localStorage` 実装。`listVisitRows` は `:208-232` |
| `src/data/mock.ts` | 275 | モック配信・記録。**`mockDispatchDates()`（`:32-35`）が昨日・今日・明日の3日だけを返す** |
| `src/components/Modal.tsx` | 106 | モーダル土台。`footer` は `.modal-foot` に**データ状態に関係なく常時描画**（`:102`） |
| `src/types/contract.ts` | 351 | `visitRecordSchema`（`:219-271`）/ `carePlanSnapshotSchema`（`:115-155`）/ `SCHEMA_VERSION`（`:34`） |
| `src/types/local.ts` | 134 | `RecordPrefs`（`:52-62`）= 定型文生成の入力設定 |
| `src/utils/date.ts` | 32 | `iso` / `addDays` / `toMin` / `fmt` / `nowMin` |
| `src/styles.css` | 729 | **Phase 1b に必要な CSS は全部入っている**（後述） |

#### `src/domain/`（現在3ファイル。`compliance.ts` / `noteBuilder.ts` / `aggregate.ts` はいずれも存在しない）

| ファイル | 行数 | export |
|---|---|---|
| `timeValidation.ts` | 78 | `nowHM` / `clampToPlan` / `StampResult` / `stampStart` / `stampEnd` |
| `visitStatus.ts` | 127 | `deriveStatus` / `todoStage` / `totalMinutes` / `recordOf` / `RecordContext` / `newRecordFor` / `tasksOf` |
| `vocabulary.ts` | 24 | `SERVICE_OPTIONS` / `TASK_OPTIONS` |

### データフロー

**Server / Client 境界は存在しない**（Vite の SPA）。境界は**アダプタ境界（`DataAdapter`）と
Context 境界の2つだけ**で、どちらも `Promise` を返す。

#### 取得

```
localStorage / mock.ts
  └ localAdapter.listVisitRows(scope, range)   :208-232
  └ localAdapter.getDispatch(date, staffId)    :167-183
  └ localAdapter.listRecords(date, staffId)    :185-193
       ↓
CareStoreProvider
  ├ visitRows : Async<VisitRow[]>      ← listVisitRows(rowScope)      :189-196
  ├ dispatch  : Async<Dispatch|null>   ← getDispatch(date, staffId)   :160-167
  ├ records   : Async<RecordListing>   ← listRecords(date, staffId)   :170-177
  └ badges    : Async<BadgeCounts>                                    :199-207
       ↓ useCareStore()
  VisitList / Stats … dispatch + records（その日・その職員）
  TodoModal / PendingModal / ReportModal / TimelineModal / IncidentModal … visitRows
```

**`visitRows` は日付範囲を持たない。** `listVisitRows(rowScope)` は第2引数 `range` を
**渡さずに**呼ばれており（`CareStoreProvider.tsx:192`）、母集団は `mockDispatchDates()` が返す
**昨日・今日・明日の3日固定**（`mock.ts:32-35`、`localAdapter.ts:211`）。
→ **帰結: 月間帳票とその CSV は、現状どう作っても最大3日分にしかならない。**

`rowScope` は `CareStoreProvider.tsx:129-137` で決まる。`isSupervisor || canApprove` なら
`{kind:'all'}`、それ以外は `{kind:'staff', staffId: 自分}`。

#### 記録モーダルのフォーム state

```
state は useState 3つだけ。reducer は使っていない。すべて RecordModal 内のローカル。
  edit   : { key: string; draft: VisitRecord } | null   :72
  errors : FieldErrors                                   :73
  busy   : boolean                                       :74

draft の導出（:82-84）
  edit !== null && edit.key === editingVisitId ? edit.draft
                                               : saved ?? newRecordFor(visit, plan, resident)
  → 「開いている訪問 ID をキーにした下書き」。effect で setState していない（:69-71 に理由）

更新関数は2つ（:86-89）
  set(k, v)      … 1フィールド差し替え
  setDraft(fn)   … draft 全体を関数で差し替え
```

→ **定型文の流し込みも音声認識の確定テキストの追記も `set('note', …)` / `setDraft()` で書ける。
新しい state 機構は要らない。** `draft` はスプレッドで全フィールドを保持するため、
TodoModal で保存した `mood` / `memo` を記録モーダルで開いても消えない。

#### 保存

```
[保存(済)] :195 → submit(false)   /   [承認して完了] :194 → submit(true)
  1. busy ガード                                      RecordModal.tsx:119
  2. validated()                                      :120 → :99-116
       予定必須 / plannedEnd>plannedStart / actualEnd>actualStart / status の自動遷移
  3. 承認時のみ 実績必須                                :128-132
  4. outOfPlan(next)（ローカル関数 :32-42 = legacy:3074-3082）:135
       枠外 && 保存時 && 権限なし → 中断    :136-141
       枠外 && 保存時 && 権限あり → confirm :142-145
  5. 承認者スタンプ / 承認解除                          :149-158
  6. await saveRecord(next)                           :160-162
  7. 失敗なら閉じない                                   :164
       ↓
CareStoreProvider.saveRecord :250-263 → adapter.saveRecord → setReloadToken(n+1)
       ↓
localAdapter.saveRecord :195-205  parseVisitRecord()（zod）→ upsert → localStorage
```

**`setReloadToken` は `staffKey` / `scopedKey` / `rowsKey` / `badgeKey` すべてに載っている
（`:100` `:120` `:122` `:138`）。1回の保存で dispatch / records / visitRows / badges /
staff / incidents が全部取り直される。** → 未完了一覧の行内メモを1文字ごとに保存すると全件再取得が走る。

#### 記載チェック・音声入力の現状

**どちらも存在しない。** `src/` 配下に `SpeechRecognition` / `webkitSpeechRecognition` の
参照は0件、`.mic-live` の出現も0件、`.lintitem` / `.lv-*` / `.fixbtn` も0件。
`#lintBox` は**空の器だけ**が `RecordModal.tsx:375` にある（`IncidentModal.tsx:175` にも id 無しで1つ）。

### 呼び出し元・依存関係

#### domain の既存 export と呼び出し元

`timeValidation.ts`（import 元3ファイル）

| export | 定義 | 外部呼び出し | 内訳 |
|---|---|---|---|
| `nowHM()` | `:14` | **3箇所 / 2ファイル** | `RecordModal.tsx:267` `:279`、`IncidentModal.tsx:31` |
| `clampToPlan()` | `:23` | **2箇所 / 1ファイル** | `RecordModal.tsx:268` `:280` |
| `type StampResult` | `:33` | **0箇所** | 外部参照なし |
| `stampStart()` | `:43` | **1箇所** | `CareStoreProvider.tsx:325` |
| `stampEnd()` | `:67` | **1箇所** | `CareStoreProvider.tsx:337` |

`visitStatus.ts`（import 元10ファイル）

| export | 定義 | 外部呼び出し | 内訳 |
|---|---|---|---|
| `deriveStatus()` | `:20` | **15箇所 / 6ファイル**（本体で数え直して確定） | `VisitRow.tsx:46`、`VisitList.tsx:34`、`Stats.tsx:26`、`ReportModal.tsx:126/128/145/171/213/215`、`TimelineModal.tsx:37`、`PendingModal.tsx:54/65/73/77/179` |
| `todoStage()` | `:30` | **4箇所 / 2ファイル** | `TodoModal.tsx:50/60/128`、`localAdapter.ts:260` |
| `totalMinutes()` | `:46` | **1箇所** | `Stats.tsx:31` |
| `recordOf()` | `:55` | **7箇所 / 5ファイル** | `RecordModal.tsx:80`、`VisitList.tsx:34/92`、`Stats.tsx:26`、`localAdapter.ts:225/260`、`CareStoreProvider.tsx:279` |
| `type RecordContext` | `:73` | **1箇所** | `CareStoreProvider.tsx:46` |
| `newRecordFor()` | `:75` | **2箇所** | `RecordModal.tsx:84`、`CareStoreProvider.tsx:315` |
| `tasksOf()` | `:124` | **1箇所** | `VisitRow.tsx:55` |

`vocabulary.ts`（import 元2ファイル）

| export | 定義 | 外部呼び出し |
|---|---|---|
| `SERVICE_OPTIONS` | `:18` | **2箇所** `RecordModal.tsx:216`、`mock.ts:166` |
| `TASK_OPTIONS` | `:21` | **2箇所** `RecordModal.tsx:316`、`mock.ts:245`。**記載チェックが3箇所目になる**（`vocabulary.ts:9-11` が既にこれを想定して書かれている） |

→ **`compliance.ts` / `noteBuilder.ts` / `aggregate.ts` は新規追加であり、既存 domain 3ファイルは
1行も変更不要。`deriveStatus` の15箇所にも波及しない。**

#### `listVisitRows`

```ts
listVisitRows(scope: VisitScope, range?: { from?: string; to?: string }): Promise<VisitRow[]>   // adapter.ts:149
VisitScope = { kind: 'all' } | { kind: 'staff'; staffId: string }                               // adapter.ts:95-98
VisitRow   = { facilityId, date, staffId, staffName, visit, record?, resident? }                // adapter.ts:77-85
```

- **直接の呼び出し元は1箇所**（`CareStoreProvider.tsx:192`）。**`range` は一度も渡されたことがない**
- **`visitRows` を読む画面は5件**: `TodoModal.tsx:44` / `PendingModal.tsx:49` / `ReportModal.tsx:51` /
  `TimelineModal.tsx:25` / `IncidentModal.tsx:47-48`
- 実装の絞り込み（`localAdapter.ts:211-217`）: `range` は **date の文字列比較のみ**で両端を含む閉区間。
  月指定（`YYYY-MM`）は受け付けない。`scope` は職員でのみ効き、事業所での絞り込みは無い。
  記録は `readRecords()` で**全件**読んでから `recordOf` で突合（`:209` `:225`）
- → `range` を使い始める変更自体は1箇所に閉じるが、**母集団が変わるので上記5画面すべてに波及する**

#### フィルタ条件の所在（CSV の母集団を画面と揃えるために要る）

| 画面 | 条件 | 保持場所 | 画面が描画している配列 |
|---|---|---|---|
| VisitList | `filter` | **store**（`CareStoreProvider.tsx:71`、型 `context.ts:54`、UI `Filters.tsx:21-37`） | `visible`（`:32-34`） |
| PendingModal | `range` / `staffFilter` / `kind` / `order` / `selected` | **ローカル useState 5個**（`:41-45`） | `list`（`:62-71`） |
| ReportModal | `type` / `month` / `residentId` / `staffId` | **ローカル useState 4個**（`:44-47`） | `inMonth`（`:57`）+ 帳票別フィルタ（`:116-118`） |
| TodoModal | `scope` / `range` / `kind` | **ローカル useState 3個**（`:38-40`） | `list`（`:49-57`） |

→ **PendingModal / ReportModal のフィルタは store に無い。** Q5 の「画面と母集団を揃える」を
満たすには、CSV 生成をそのコンポーネント内（またはそこから呼ぶ純粋関数）で行うしかない。

#### `CareStore` が公開している API（`context.ts:23-119`、実装 `CareStoreProvider.tsx:444-465`）

書き込み系は8つ。`saveRecord` / `deleteRecord` / `savePrefs` / `saveIncident` /
`stampStartAt` / `stampEndAt` / `approveVisit` / `approveAllToday`。

**★ 1件の記録を部分更新する経路が公開されていない。** 「記録が無ければ配信から作り、
あれば1項目だけ差し替えて `updatedAt` を打つ」処理は `mutateRecord`
（`CareStoreProvider.tsx:304-320`、訪問の解決は `findTarget` `:272-295`）にあるが、
**`CareStore` に載っておらず、`stampStartAt` / `stampEndAt` / `approveVisit` の内部専用**。
TodoModal が持っているのは `VisitRow`（`record` は `undefined` でありうる）と
`saveRecord(record: VisitRecord)` だけなので、このままだと TodoModal 側で `newRecordFor` +
`RecordContext` を組み立て直すことになり、`mutateRecord` のロジック重複になる。
→ **mood / memo の保存には、`mutateRecord` 相当の公開（例 `updateRecordFields(visitId, patch)`）が要る。
変更先は `context.ts` と `CareStoreProvider.tsx:444-465` の2箇所。**

#### 契約まわりの参照

- **`VisitRecord` 型の参照は 30行 / 8ファイル**: `RecordModal.tsx`(7) / `visitStatus.ts`(7) /
  `adapter.ts`(4) / `CareStoreProvider.tsx`(4) / `localAdapter.ts`(4) / `mock.ts`(3) /
  `VisitRow.tsx`(2) / `context.ts`(2)
- **フィールド追加で必ず型エラーになる（= 漏れを型が検出する）のは2箇所**:
  `visitStatus.ts:81-114` の `newRecordFor()` と `mock.ts:234` の `buildVisitRecord({...})`。
  どちらも全フィールドを明示列挙している
- **`mood` / `memo` は現在どこにも無い。** `visitRecordSchema`（`:219-271`）のフィールドは24個で
  両方とも不在。`src/` 全体の `mood` の grep は0件、`memo` は CSS クラス（`.memo` / `.memowrap` /
  `.memo-note`）と `useMemo` のみ
- **`noteSource` は読み手2箇所・書き手0箇所。** 読み手は `VisitRow.tsx:95`（✨/📝 の出し分け）と
  `TimelineModal.tsx:104`（「AI作成」バッジ）。書いているのは `newRecordFor`（`visitStatus.ts:104`）と
  `mock.ts:249` の `null` だけで、**UI からは1箇所も書いていない**。
  → 手入力時に `'manual'` を書く実装も Phase 1b で初めて生まれる（Q7 と不可分）
- **`RecordPrefs` を読み書きしている UI は `ResidentModal.tsx` の1画面のみ**
  （`:44` `:51` `:53` `:82` `:186/191/195/200/208`）。
  **記録モーダルからは1箇所も読まれていない**（`getPrefs` / `RecordPrefs` の出現0件）。
  → 定型文生成は `RecordPrefs` を入力に取るのに、記録モーダルに取得経路が無い

#### スタブの棚卸し（**操作すると反応するもの18件 + 無言1件 + 静的文言1件**）

`VisitList.tsx:36` の `later(name)` が `${name}はステップ6で実装します` を出し、3ボタンで共有している。

| # | ファイル:行 | 文言 | 1b 対象 |
|---|---|---|---|
| 1 | `record/RecordModal.tsx:361` | AIによる文章作成は Phase 1b で実装します | ○ |
| 2 | `record/RecordModal.tsx:364` | 音声入力は Phase 1b で実装します | ○ |
| 3 | `record/RecordModal.tsx:367` | 記載チェックは Phase 1b で実装します | ○ |
| 4 | `todo/TodoModal.tsx:146` | 特記事項の自動作成は Phase 1b で実装します | ○ |
| 5 | `todo/TodoModal.tsx:154` | ご本人の様子の保存は Phase 1b で実装します | ○ |
| 6 | `todo/TodoModal.tsx:162` | 音声入力は Phase 1b で実装します | ○ |
| 7 | `todo/TodoModal.tsx:160` | **無言の no-op**（`onChange={() => { /* Phase 1b でメモを保存する */ }}`）。打っても何も起きず通知も出ない | ○ |
| 8 | `visitList/VisitList.tsx:47` | 特記事項の一括作成は**ステップ6**で実装します | ○（文言も誤り） |
| 9 | `visitList/VisitList.tsx:52` | CSV出力は**ステップ6**で実装します | ○（文言も誤り） |
| 10 | `report/ReportModal.tsx:69` | CSV出力は Phase 1b で実装します | ○ |
| 11 | `approval/PendingModal.tsx:123` | CSV出力は Phase 1b で実装します | ○ |
| 12 | `incident/IncidentModal.tsx:157` | AIによる報告書作成は Phase 1b で実装します | **×**（Q1 で対象外。文言の修正のみ） |
| 13 | `incident/IncidentModal.tsx:160` | 記載チェックは Phase 1b で実装します | **×**（同上） |
| 14 | `incident/IncidentModal.tsx:148` | 種別の保存は Phase 1b で契約に追加します | **×**（同上。なお対象は `local.ts:65-77` の `incidentSchema` であり `contract.ts` ではない） |
| 15 | `timeline/TimelineModal.tsx:61` | 経過のまとめは Phase 1b で実装します | **×**（同上） |
| 16 | `visitList/VisitList.tsx:53` | 予定の追加はステップ6で実装します | ×（文言の修正のみ） |
| 17 | `shell/Header.tsx:72` | 職員アカウント管理はステップ6以降で実装します | × |
| 18 | `shell/Header.tsx:78` | 設定はステップ6以降で実装します | × |
| 19 | `shell/Header.tsx:81` | パスワード変更は Phase 5（Firebase Auth）で実装します | × |
| 20 | `auth/StaffPicker.tsx:91` | （静的文言）Phase 1a の簡易ログインです。パスワード認証は Phase 5 で実装します。 | × |

→ **Phase 1b で実装に差し替わるのは #1〜#11 の11件。#12〜#16 の5件は文言の修正だけが残る**
（Q1 の「通知文を実態に合うものへ直す」に対応）。

コメント側の未処理も3件ある。`ReportModal.tsx:4-5`（「Phase 1b で domain/aggregate.ts に
差し替える」）、`TimelineModal.tsx:8`、`contract.ts:241`（「AI 生成を Phase 1b で入れるまでは
'manual' か null になる」）。

### 既存の実装パターン

#### domain 層のファイルの書き方（`compliance.ts` / `noteBuilder.ts` / `aggregate.ts` はこれに揃える）

- 冒頭は `/* … */` のブロックコメントで「見出し → 新旧モデルの差 → **移植元: legacy/index.html:NNNN-NNNN**」
  の順（`timeValidation.ts:1-10` / `visitStatus.ts:1-9` / `vocabulary.ts:1-15`）
- 関数単位でも `/** legacy/index.html:3067-3073 の clampToPlan と同じ。 */` のように
  **legacy の行番号 +「と同じ」**を書く（`timeValidation.ts:20-22` ほか、UI 側にも8箇所）
- 罫線つき小見出しは全角で `── 見出し ─────…`（6ファイルで使用）
- **型の置き場所**: kpi-react と共有するなら `contract.ts`、carerecords 内で完結するなら `local.ts`
  （判定基準は `local.ts:5-7` に明記）、**domain モジュールの中だけで意味を持つ型は domain 内で
  `export type`**。先例は `StampResult`（`timeValidation.ts:33-35`、判別可能ユニオン）と
  `RecordContext`（`visitStatus.ts:73`）。UI にしか出ない型はコンポーネント内（`FieldErrors` など）
- **domain 3ファイルは `react` を1行も import していない**。`localStorage` / `window` / `document` の
  参照も0件
- **時刻は既定引数で注入可能にする**のが既存の作法（`stampStart(…, raw = nowHM())`）。
  `nowHM()` / `newRecordFor()` は `new Date()` を内部で呼ぶため参照透過ではない

#### null 安全（`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 下の実書式）

- 結果は**判別可能ユニオンで返し、例外を投げない**。受け側は `'errors' in v` の形で絞り込む
  （`RecordModal.tsx:121`）
- キーを消すときは **`delete`**（`{...x, k: undefined}` は通らない）。`clearError`（`RecordModal.tsx:47-56`）が先例
- オプショナルの判定は `errors.plan !== undefined`。`if (errors.plan)` の形は使っていない
- 添字アクセスは必ず `?? フォールバック` か `undefined` チェック（`counts[st] ?? 0` など）
- 型ガード関数で null を除く（`canApprove`、`local.ts:127`）
- **失敗は `notify()` 一本。`alert` 0件、`console.error` 0件。** 境界の例外は `AdapterError` に統一し
  （`localAdapter.ts:178` `:197-199`）、UI は `e instanceof AdapterError ? e.userMessage : '…に失敗しました。'`
- 非同期の発火は `void`（`onClick={() => { void submit(true); }}`）
- `useEffect` の取得は `let alive = true` + クリーンアップ（計7箇所）
- **失敗しても入力を捨てない**（`RecordModal.tsx:163-164`、`IncidentModal.tsx:81`）

#### 集計・派生値の現状

- **切り出し済みの集計は `visitStatus.ts:46-52` の `totalMinutes(records: VisitRecord[])` ただ1つ。**
  入力が `VisitRecord[]` で、帳票が扱う `VisitRow[]` ではないため ReportModal からは使われていない
- **帳票3種の集計はすべて `ReportModal.tsx` 内にインライン。** 置き換え対象は**22箇所**
  （`durOf` `:31-35` / `hm` `:38-40` / 重複排除 `:53-56` / `inMonth` `:57` / 行フィルタ `:116-118` /
  `UserReport` の `done` `:126`・`total` `:127`・`notApproved` `:128`・`:153`・`:163` /
  `StaffReport` の `list` `:171`・`byDate` `:172-173`・`tn` `:174`・`tm` `:175`・平均 `:184`・`:192`・`:202` /
  `SummaryReport` の `ids` `:209`・`body` `:211-219`・合計 `:216`）
- **提供分数の式が3箇所に重複**（`ReportModal.tsx:31-35` / `TimelineModal.tsx:92-94` / `visitStatus.ts:46-52`）。
  曜日ヘルパー `DOW` は6ファイル、`dowOf()` は3ファイルに同一実装で散っている
- → **帳票 CSV は、footer のスコープから子コンポーネントのローカル変数（`done` / `tn` / `tm` など）が
  見えない。** 同じ式を footer 側に二重に書くと「画面の合計と CSV の合計がずれる」事故を構造的に許す。
  **`aggregate.ts` を新設すべき本質的な理由はここにある**

#### CSV に関係するもの

- **Blob ダウンロードの前例が React 側に1件も無い。** `blob` / `download` / `createObjectURL` /
  `encodeURI` の grep はコメントと CSV ボタンにしか当たらない。**Phase 1b が最初の実装になる**。
  印刷だけは前例があり `ReportModal.tsx:71` の `window.print()`
- ESLint に `react-refresh/only-export-components`（warn）。**`.tsx` にコンポーネント以外の関数を
  `export` すると警告になる**ため、CSV ビルダーと集計は `.ts` に置くのが既存方針と整合する
- CSV ボタンは**3経路とも `disabled` が無く、loading / error / 0件でも押せる**。
  `Modal.tsx:102` により footer はデータ状態に関係なく常に描画される

#### 命名・その他

- コメント・通知文・エラー文はすべて日本語（英語コメント0件）。関数名は英語の動詞句で、
  **legacy に名前があるならそのまま使う**（`nowHM` / `clampToPlan` / `todoStage` / `outOfPlan`）
- 定数は `SCREAMING_SNAKE`、コンポーネントは `PascalCase` の named export（`export default` は0件）
- コメントは「**こう書かないと何が壊れるか**」を書く文体（`RecordModal.tsx:5-12` の DOM 不変条件など）
- **テストが1件も無い。** `*.test.*` / `*.spec.*` は0件、vitest 未導入、`package.json` の scripts は
  `dev` / `build` / `lint` / `typecheck` / `preview` のみ。
  → **domain を純粋関数で書いても、現状それを固定する自動検証が無い**

#### DOM / CSS の制約（鉄則2 と鉄則5）

**CSS の追加・変更は一切不要。Phase 1b に必要なクラスは `styles.css` に全部入っている**
（`.micbtn:299` / `.memowrap:311` / `.micmini:313` / `.mic-live:320-327` / `.lint:347` /
`.lintitem:348-360` / `.lv-ng:353` / `.lv-warn:354` / `.lv-ok:355` / `.fixbtn:356-359` /
`.aibar:262` / `.aibar select:263` / `.aibtn:264-275` / `.srcbadge:285` /
`.todo-inline .memowrap .memo:479` / `.todo-inline .micmini:480`）。ただし以下の制約がある。

- **`.mic-live` は `display:none`。`.mic-live.on` でしか出ない**（鉄則5 の10種のひとつ）。
  付け忘れると無言で何も表示されない
- `.micmini` は `position:absolute`。**`.memowrap`（`position:relative`）の直下**に置く必要があり、
  input には `className="memo"` が要る（`padding-right:48px` を受けるため）
- 録音中は `.micbtn` / `.micmini` に `rec` を足す（`.dot` が `display:none` → `micpulse`）
- 生成中は `.aibtn` に `busy` を足す（`.sp` が出る。`:disabled` は `cursor:progress`）
- `.lint` の子は `.lintitem` + `.lv-ng` / `.lv-warn` / `.lv-ok` の併記。
  `.ic` / `b` / `.fixbtn`（`margin-left:auto`）を子に持つ
- **`.todo-row` の直下は span 6個**（`styles.css:452-454` の 6カラムグリッド）。
  ステージ2の行だけ7番目の子として `.todo-inline` が付き `grid-column:1/-1` で折り返す。
  **フラグメントや `div` で包むとグリッドが崩れる**（`TodoModal.tsx:4-9` に明記）

#### 記録モーダルの特記事項セクションの現状（`RecordModal.tsx:344-376`）

```jsx
<div className="sec">
  <h3>特記事項</h3>
  <div className="profbar" id="profBar"> … .pchip ×4 + .ghost「利用者情報」 </div>   {/* :347-357 */}
  <div className="aibar">                                                          {/* :360 */}
    <button className="aibtn"><span className="sp" />✨ AIで文章作成</button>        {/* :361-363 */}
    <button className="micbtn"><span className="dot" />🎤 音声入力</button>          {/* :364-366 */}
    <button className="ghost">📋 記載チェック</button>                               {/* :367 */}
  </div>
  <div className="fld"> <label htmlFor="fNote">特記事項</label>
    <textarea id="fNote" … /> </div>                                               {/* :369-374 */}
  <div className="lint" id="lintBox"></div>                                        {/* :375 空 */}
</div>
```

`## 2` の「前提として置いたもの 3」で挙げた**不足 DOM は、実際に不足していることを確認した**。
`#srcBadge` / `#fMood` / `#fTone` / `#fLen`（`.aibar select`）/ `#undoBtn` /
`.memowrap`+`#fMemo`+`#micMemo` / `#micLive` / `#aiHint` はいずれも特記事項セクションに無い。
`.srcbadge` は `RecordModal.tsx:313`（実施内容の別用途）に、`.aihint` は6箇所に流用済みで、
**どちらも特記事項セクションでは使われていない**。

#### 未完了一覧の mood / memo の現状（`TodoModal.tsx:150-165`）

- **入力欄は既に存在するが、値はどこにも保持されず捨てられている。**
  select は `defaultValue` の非制御で `onChange` は `notify` するだけ（`:153-157`）。
  input は `value` すら無い完全な非制御で、`onChange` は**空のコメントのみ**（`:159-160`）
- mood の4択（`いつもと変わりなし` / `体調良好・表情明るい` / `やや元気がない` / `痛みの訴えあり`）は
  `:155-156` の JSX リテラル直書き。`vocabulary.ts` にも `contract.ts` にも対応する定義が無い
- **ステージ2から抜ける条件は `record.note` が非空になること**（`todoStage`、`visitStatus.ts:30-37`）。
  **`mood` / `memo` を保存しても `note` が空のままなら行は消えない。**
  → mood/memo の保存と「行が消える/消えない」は独立している。Q6 の行 DOM 差し替えの議論とは別問題

### 影響範囲

#### 直接変更するファイル

| ファイル | 変更内容 |
|---|---|
| `features/record/RecordModal.tsx`（379行） | 特記事項セクションに不足 DOM を追加 / `#lintBox` へ `.lintitem` を描画 / `.aibtn`・`.micbtn`・記載チェックのスタブを実装へ / `submit(true)` に承認時の `confirm` / `noteSource` の書き込み / `RecordPrefs` の取得経路 |
| `features/todo/TodoModal.tsx`（173行） | mood・memo の制御コンポーネント化と保存 / 行内の音声入力 / ✨特記事項 |
| `features/report/ReportModal.tsx`（248行） | 集計22箇所を `aggregate.ts` 呼び出しへ / CSV / `:4-5` のコメント更新 |
| `features/approval/PendingModal.tsx` | CSV（`:123`）。`list`（`:62-71`）をそのまま流せば母集団は画面と揃う |
| `features/visitList/VisitList.tsx` | CSV と一括作成を `later()` から切り離す / `:9` のコメント修正（「CSV も絞り込みを無視して全状態を出す」は **Q5 の確定と矛盾する**） |
| `features/incident/IncidentModal.tsx` | 音声入力のみ追加。記載チェック・AI 報告書・種別は**通知文の修正だけ** |
| `store/context.ts` + `store/CareStoreProvider.tsx` | `mutateRecord` 相当の公開（2箇所）。記録モーダルが `RecordPrefs` を要るなら取得経路も |
| `types/contract.ts` | `visitRecordSchema` に `mood` / `memo` / （Q8 次第で `noteEdited`）を追加。`SCHEMA_VERSION`（`:34`）を上げる。**`updating-contract` スキルの手順に従う** |
| `domain/visitStatus.ts:81-114` | `newRecordFor()` に新フィールドの初期値（書かないと型エラー） |
| `data/mock.ts:234` | `buildVisitRecord({...})` に同上 |
| `vite-env.d.ts` または新規 `types/speech.d.ts` | **Web Speech API の ambient 宣言。TypeScript 5.9.3 の `lib.dom.d.ts` には `SpeechRecognitionAlternative` / `SpeechRecognitionResult` / `SpeechRecognitionResultList` しか無く、`SpeechRecognition` / `webkitSpeechRecognition` / `SpeechRecognitionEvent` / `SpeechRecognitionErrorEvent` / `SpeechGrammarList` が存在しない。`strict` 下では自前宣言が必須** |

#### 新規作成

- `src/domain/compliance.ts`（記載チェック）
- `src/domain/noteBuilder.ts`（定型文生成）
- `src/domain/aggregate.ts`（帳票集計）
- CSV のユーティリティ（BOM + CRLF + 全フィールドクォート + Blob ダウンロード）。
  `src/utils/csv.ts` か domain かは `planning-feature` で決める
- 音声入力のフック（`useSpeechRecognition` 相当）。**`src/hooks/` は存在しない**
  （現行は `components` / `data` / `domain` / `features` / `store` / `types` / `utils` の7ディレクトリ）。
  置き場所の判断が要る

#### 波及

- **`SCHEMA_VERSION` を上げると、既存の `carerecords.v2.visitRecords` は全件 `parseVisitRecord` で
  弾かれ `unreadable` に入る**（`localAdapter.ts:132-136`）。結果として `VisitList.tsx:75-79` に
  「読み出せない記録が N 件あります。事業所に連絡してください。」が出る。
  開発端末で必ず踏むため、`resetLocalData()`（`data/devTools.ts:16-24`）を実行する手順を
  実装順序に明記する必要がある。なお `localAdapter.ts:201-205` の `saveRecord` は
  **unreadable な原文を必ず書き戻す**ため、データは消えないが読めない状態が残り続ける
- **`mood` / `memo` を必須（`z.string()`）にするか省略可にするかで、版を上げる要否自体が変わる**
  （`contract.ts:31-33` の基準）。Q2 は「必須で追加し版を上げる」と読めるが、`updating-contract` で確定させる
- 影響を受ける画面は7つ: 実施一覧 / 未承認一覧 / 帳票 / 未完了 / 記録モーダル / ツールバーのバッジ /
  経過記録・ヒヤリハット（`visitRows` 経由）
- **集計置換で「画面の数字が変わらないこと」を検証する手段が無い**（テストランナー未導入）

### 分からなかったこと

1. **CSV の各列が React 側の既存フィールドで埋まるか未検証。** 列定義（日次15列 / 未承認12列 /
   帳票 8・10・6列）は legacy 側の調査で把握しているが、React 側のフィールドとの1対1の
   突き合わせはしていない。とくに `officeName`（`contract.ts:176`）/ `cancelReason`（`:184`）/
   `vitals`（`:236`）/ `carePlanVersion`（`:260`）が列に含まれるかは未確認。
   → `planning-feature` で列定義を確定させるときに潰す
2. **CSV のファイル名規則がコードからは決まらない。** React 側に前例が1件も無い
3. **0件時・loading 時の具体的な挙動が未決。** Q5 は「0件時は全経路で中断」と確定しているが、
   ボタンを `disabled` にするのか、押してから `notify` で止めるのかは決まっていない
4. **`listVisitRows` の `range` は一度も実行されたことがない。** 実装（`localAdapter.ts:212-213`）は
   あるが呼び出し元が0件。境界（from/to を含むか）は実装の文字列比較から読んだもので、
   実行して確かめたわけではない
5. **モックが3日分しかないことを Phase 1b でどう扱うか。** 月間帳票 CSV は現状どうやっても
   最大3日分になる。モックの制約として受け入れるのか、`mock.ts` を広げるのかは未決
6. **`aggregate.ts` の責務範囲が未決。** 帳票3種だけか、`Stats.tsx:26-31` / `PendingModal.tsx:73-75` /
   `TodoModal.tsx:59-61` の件数集計まで含めるか。提供分数の式が3箇所に重複している事実は確認済み
7. **`mood` の4択が legacy 由来の語彙か追えない。** `TodoModal.tsx:155-156` に直書きされているだけで、
   初出コミット `68dd9f0` 以降ずっと同じ形。契約に載せるなら値域の根拠が要る
8. **記録モーダルで `RecordPrefs` をどう取るかの前例が無い。** `getPrefs` は `Promise` を返し、
   現在の呼び出しは `ResidentModal.tsx:51` の1箇所のみ。同じことをすると「開いた直後は prefs 未取得」
   の状態が生まれるが、そのとき定型文ボタンを押せるべきかはコードからは決められない
9. **Web Speech API の実挙動は静的読解では追えない。** `continuous` / `interimResults` の扱い、
   `onerror` で来るエラーコード、iOS Safari での可否は実機でしか確認できない。
   型が `lib.dom.d.ts` に無いこと（TS 5.9.3）までは確認済み

**解消済み。** 調査の過程で「legacy 側の DOM の正確な位置が分からない」という報告が上がったが、
これは `## 2` の「前提として置いたもの 3」に legacy の行番号つきで既に記録してある
（`#srcBadge` `:945` / `.aibar select` `:948-957` / `#undoBtn` `:962` / `.memowrap`+`#fMemo` `:963-966` /
`#micLive` `:968` / `#aiHint` `:970`）。追加の `legacy-reader` は不要。

## 4. Implementation Plan

### 前提の確認

- **未確定事項はゼロ。** `## 2` の Q1〜Q11 はすべて確定している。この計画は確定した要件のみに基づく
- **React 側の調査は完了している**（`## 3`）。推測で立てた箇所は無い
- **`migrating-database` は不要。** 理由は「データ構造の変更」を参照
- Phase 1a の成果物（`b23f44c` まで）には手を入れず、その上に積む

### 方針

#### 全体

**「domain に純粋関数を置き、UI は呼ぶだけ」に徹する。** Phase 1a が UI を全部作り終えているため、
Phase 1b は「空いている穴にロジックを差し込む」作業になる。`## 3` で確認したとおり
CSS は1行も要らず、DOM の追加も記録モーダルの特記事項セクションに閉じている。

純粋関数化は好みではなく**必須要件**である。記載チェックは記録モーダル・未承認一覧の統計・
行表示・一括承認の確認文面・CSV の要修正件数の**5箇所で同じ判定を共有する**（`## 2` 確定(1)）。
帳票の集計は**画面と CSV が同じ数字を出す**ことが Q5 の要求そのものである（`## 3` の
「footer から子コンポーネントのローカル変数が見えない」問題）。どちらも共有できる形でしか成立しない。

#### 計画時に決めた事項（`## 3` の「分からなかったこと」への回答）

調査で「コードからは決められない」とされた9件のうち、7件をここで確定させる。
残る2件（実機でしか分からないもの）はリスクとして扱う。

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | CSV の列と React 側フィールドの対応 | **実装時に `legacy-reader` で列定義を写してから書く。** 埋まらない列が出たら `## 5` に記録して先へ進む | 推測で列を埋めると請求突合で使えない CSV になる。列は仕様であって設計事項ではない |
| 2 | CSV のファイル名規則 | **legacy の `dl()` 呼び出し4箇所から写す**（実装時に `legacy-reader` で確認）。写せない場合のみ `{帳票名}_{対象}_{日付|年月}.csv` | 事業所の運用で既にファイル名が定着している可能性がある。勝手に決めない |
| 3 | 0件時の挙動 | **ボタンは `disabled` にせず、押した時点で `notify('出力できる記録がありません')` を出して中断する** | `Modal.tsx:102` により footer はデータ状態を持たず常時描画される。`disabled` は理由が伝わらないが、通知なら伝わる。Q5 の「全経路で中断」を満たす |
| 4 | 帳票 CSV の行の粒度（Q5 で保留された点） | **CSV は1訪問1行（legacy どおり）。画面の職員別は日次集約のまま。ただし合計値は必ず一致させる** | CSV は請求突合の元データであり、粗くすると突合できない。Q5 の趣旨は「数字が食い違わないこと」なので、合計が一致すれば満たされる |
| 5 | モックが3日分しかない | **Phase 1b では広げない。** 月間帳票の検証は3日分で行い、制約として `## 5` に記録する | `mock.ts` を広げると Phase 1a で確認済みの統計・一覧の見え方が変わり、Phase 1a の突き合わせ結果が崩れる。CSV の正しさは `aggregate.ts` の単体で確かめるほうが確実 |
| 6 | `aggregate.ts` の責務範囲 | **帳票3種の集計 + 提供分数の式の一本化まで。** `Stats` / `PendingModal` / `TodoModal` の件数集計は今回触らない | 提供分数の式が3箇所に重複している（`## 3`）のは実害があるので潰す。件数集計まで広げると振る舞いを変えない保証が薄まる |
| 7 | `mood` の4択の置き場所 | **`domain/vocabulary.ts` に `MOOD_OPTIONS` として移す。** 契約側は `z.string()` で受ける | `TASK_OPTIONS` を1箇所にまとめたのと同じ理由。画面の選択肢と契約の値域が別々に定義されると静かにずれる。将来増えうるので enum では縛らない |
| 8 | 記録モーダルでの `RecordPrefs` の取り方 | **`useEffect` + `alive` フラグで取る**（`ResidentModal.tsx:48-55` と同型）。**未取得のうちは `.aibtn` を `disabled` にする** | 既存の唯一の前例に揃える。`.aibtn:disabled { cursor:progress }` が `styles.css:270` に既にあり、CSS を足さずに「取得待ち」を表現できる |
| 9 | 音声入力フックの置き場所 | **`src/hooks/useSpeechInput.ts` を新設する。** `CLAUDE.md` のディレクトリ一覧に1行追加する | React に依存するため `domain/` には置けない。`components/` は共通コンポーネントの置き場所であってフックではない。3つの feature（record / todo / incident）から使うため feature 配下にも置けない |

#### 記載チェック（`domain/compliance.ts`）

- `check(record, plan, prefs): Finding[]` の純粋関数にする。**DOM は一切読まない**（Q10）。
  記録モーダルは編集中の `draft` を引数として渡すことで「編集中の本文で判定する」を再現する
- `Finding` は domain 内で `export type` する（`StampResult` と同じ作法）。
  レベル（`ng` / `warn` / `ok`）・本文・`fix`（置換前後の正規表現）を持つ
- 判定順は legacy と同一にする。**本文が空なら warn 1件で即 return**（以降を評価しない）、
  短期目標への言及は**ここまでに `ng` が1件も無いときだけ**立つ、という順序依存があるため
- 自動修正は**検出と置換の正規表現を揃える**（Q11）
- 承認時は `ng` があれば `confirm` で件数と全文を出し、**続行できる**（Q4）。
  文面の作り方は `PendingModal.tsx:87-91`（未記入件数を文面に載せている）を先例にする

#### 定型文生成（`domain/noteBuilder.ts`）

- `buildNote(input): string` の純粋関数。**入力は当該訪問 + `CarePlanSnapshot` + `RecordPrefs` だけ**（Q8）
- 8ブロック構成と `tone` / `len` による分岐は legacy どおり移植する。
  **過去記録に依存する3つの挙動（文体バリエーション / 直前記録との重複回避 / 平常時体温比較）は移植しない**
- `generateNote(input): Promise<string>` は**インターフェースだけ**用意し、実装は `buildNote` を
  返すだけにする（Q3）。Phase 5 でここが Cloud Functions 呼び出しに差し替わる。
  **`DataAdapter` には載せない。** AI 生成は永続化ではなく、Phase 5 でも送信先が別になる
  （`incidentAdapter.ts:11-12` が同じ理由で `DataAdapter` と別経路にしてある）

#### 音声入力（`hooks/useSpeechInput.ts`）

- `src/types/speech.d.ts` に最小限の ambient 宣言を書く（`SpeechRecognition` /
  `webkitSpeechRecognition` / `SpeechRecognitionEvent` / `SpeechRecognitionErrorEvent`）。
  **TS 5.9.3 の `lib.dom.d.ts` には存在しない**（`## 3`）
- 4箇所で1つのフックを共有する。欄ごとの差は**区切り文字だけ**（textarea は無し、input は `／`）
- トグル / 無音で止まらない（`onend` で自動再開）/ 中間結果は `.mic-live` にのみ出す /
  確定結果はカーソル位置に挿入 / 末尾に句点を補う、は legacy どおり
- **非対応時はボタンを出さず、代わりに一行の案内を出す**（Q9。legacy には無い文言なので新規に起こす）
- `.mic-live` に `on` を付け忘れると無言で何も出ない（鉄則5）

#### CSV と集計

- `src/utils/csv.ts` に**エスケープと組み立てとダウンロード**を置く。
  `toCsv(rows: string[][]): string`（BOM + CRLF + 全フィールドを無条件でクォート）と
  `downloadCsv(filename, csv)`（Blob + `a[download]` + 3秒後に `revokeObjectURL`）。
  legacy が4箇所に同じエスケープ関数を書いていたのを1つにまとめる
- `src/domain/aggregate.ts` に**帳票3種の集計**を置く。`ReportModal` は結果を描画するだけにし、
  CSV は同じ関数の結果から組み立てる。**これで画面と CSV の数字がずれない**
- 日次 CSV は `VisitList` の `visible`（フィルタ適用後）を、未承認 CSV は `PendingModal` の
  `list`（絞り込み適用後）をそのまま使う。**どちらも画面が描画している配列そのもの**なので母集団が揃う（Q5）
- 職員別帳票 CSV もキャンセルを除外する（Q5。`legacy/index.html:3728` からの意図的な変更）
- `.ts` に置く理由: ESLint の `react-refresh/only-export-components` により、
  `.tsx` にコンポーネント以外を `export` すると警告になる（`## 3`）

#### 未完了一覧の mood / memo

- 制御コンポーネント化し、**保存は `onBlur` と select の `onChange` で行う。** 1文字ごとには保存しない
  - `saveRecord` 成功時の `setReloadToken` で dispatch / records / visitRows / badges / staff /
    incidents が**全部取り直される**（`## 3`）。打鍵ごとに保存すると毎回全件再取得が走る
- **`mutateRecord` 相当を `CareStore` に公開する**（`updateRecordFields(visitId, patch)`）。
  記録が無ければ配信から作り、あれば差し替えて `updatedAt` を打つロジックは
  `CareStoreProvider.tsx:304-320` に既にあり、TodoModal 側で組み立て直すと重複になる
- **mood / memo を保存しても、`note` が空なら行は一覧から消えない**（`todoStage` の仕様）。
  これは正しい挙動として受け入れる

### 変更対象ファイル

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `src/types/contract.ts` | 変更 | `visitRecordSchema` に `mood` / `memo` を追加、`noteSource` を `'ai'\|'template'\|'manual'\|null` に。`SCHEMA_VERSION`（`:34`）を上げる。**`updating-contract` スキルの手順に従う** |
| `src/types/speech.d.ts` | **新規** | Web Speech API の ambient 宣言 |
| `src/domain/compliance.ts` | **新規** | 記載チェック17種。`check()` と `Finding` |
| `src/domain/noteBuilder.ts` | **新規** | 定型文生成8ブロック。`buildNote()` と `generateNote()` |
| `src/domain/aggregate.ts` | **新規** | 帳票3種の集計 + `minutesOf()` |
| `src/domain/vocabulary.ts` | 変更 | `MOOD_OPTIONS` を追加 |
| `src/domain/visitStatus.ts` | 変更 | `newRecordFor()` に新フィールドの初期値。`totalMinutes()` は `aggregate.minutesOf()` を呼ぶ形に |
| `src/hooks/useSpeechInput.ts` | **新規**（ディレクトリごと） | 音声入力。4箇所で共有 |
| `src/utils/csv.ts` | **新規** | `toCsv()` / `downloadCsv()` |
| `src/data/mock.ts` | 変更 | `buildVisitRecord({...})`（`:234`）に新フィールド |
| `src/store/context.ts` | 変更 | `updateRecordFields` を `CareStore` に追加 |
| `src/store/CareStoreProvider.tsx` | 変更 | 同上を `value` に公開（`:444-465`） |
| `src/features/record/RecordModal.tsx` | 変更 | 不足 DOM の追加 / 記載チェックの描画と自動修正 / 定型文生成と `元に戻す` / `noteSource` の書き込み / 音声入力2箇所 / `RecordPrefs` の取得 / 承認時の `confirm` |
| `src/features/todo/TodoModal.tsx` | 変更 | mood・memo の保存 / 行内の音声入力 / ✨特記事項 |
| `src/features/visitList/VisitList.tsx` | 変更 | 日次 CSV / 特記事項の一括作成 / `:9` のコメント修正 / `later()` の整理 |
| `src/features/approval/PendingModal.tsx` | 変更 | 未承認 CSV |
| `src/features/report/ReportModal.tsx` | 変更 | 集計22箇所を `aggregate.ts` へ / 帳票 CSV / `:4-5` のコメント更新 |
| `src/features/incident/IncidentModal.tsx` | 変更 | 音声入力のみ追加。記載チェック・AI 報告書・種別は**通知文の修正だけ** |
| `src/features/timeline/TimelineModal.tsx` | 変更 | `:92-94` を `aggregate.minutesOf()` に。`:61` の通知文修正 |
| `CLAUDE.md` | 変更 | ディレクトリ一覧に `hooks/` を追加 |

**新規8件 / 変更12件。**

### データ構造の変更

**あり。ただし `migrating-database` は不要。**

- 変更内容: `visitRecordSchema` に `mood` / `memo` を追加し、`noteSource` の値域に `'template'` を足す。
  `SCHEMA_VERSION` を上げる
- **`migrating-database` が不要な理由: 実データが存在しない**（Phase 1a 計画書の決定 G）。
  移行すべき本番データが無く、開発端末の `localStorage` は作り直せば済む
- **代わりに必要な手順:** ステップ1の完了直後に `resetLocalData()`（`src/data/devTools.ts:16-24`）を
  実行する。**実行しないと既存の記録が全件 `unreadable` に落ち、`VisitList.tsx:75-79` に
  「読み出せない記録が N 件あります。事業所に連絡してください。」が出る**（`## 3`）。
  これは異常ではなく版上げの正しい結果なので、慌てて契約を戻さないこと
- 型エラーで漏れが検出されるのは `visitStatus.ts:81-114` と `mock.ts:234` の2箇所（全フィールド列挙）
- **`updating-contract` スキルの手順に従い、kpi-react 側への同期も扱う**（CLAUDE.md の指定）。
  `mood` / `memo` は carerecords が書き、kpi-react は読まない旨をコメントに明記する（Q2）

### 実装順序

各ステップは単独でコミットできる。前のステップが次の前提になる順に並べた。

| # | 内容 | 完了条件 | 主なファイル |
|---|---|---|---|
| **1** | **契約の版上げと境界の整備。** `mood` / `memo` / `noteSource` の値域を追加し、`SCHEMA_VERSION` を上げる。`newRecordFor` と `mock` を追随。`updateRecordFields` を `CareStore` に公開。`MOOD_OPTIONS` を追加。**完了直後に `resetLocalData()` を実行する** | `npm run build` が通り、アプリが起動して記録の保存・承認が従来どおり動く | `contract.ts` / `visitStatus.ts` / `mock.ts` / `context.ts` / `CareStoreProvider.tsx` / `vocabulary.ts` |
| **2** | **記載チェック。** `compliance.ts` を書き、記録モーダルの `#lintBox` に描画。自動修正ボタン。承認時の `confirm` | 17種すべてが legacy と同じ順序・同じ文言で出る。自動修正が実際に置換する | `domain/compliance.ts`（新規）/ `RecordModal.tsx` |
| **3** | **定型文生成。** `noteBuilder.ts` を書き、記録モーダルの不足 DOM（`#srcBadge` / `.aibar select` 3つ / `#undoBtn` / メモ欄 / `#aiHint`）を追加。`noteSource` の書き込み（生成時 `'template'` / 手入力時 `'manual'`）。`RecordPrefs` の取得 | ✨で定型文が入り、`元に戻す` で戻り、`#srcBadge` に `📄 定型文で作成` が出る | `domain/noteBuilder.ts`（新規）/ `RecordModal.tsx` |
| **4** | **未完了一覧と一括作成。** mood / memo の保存。行の ✨特記事項（即保存 → 再描画 → トースト）。実施一覧の ✨特記事項を一括作成（進捗・中断） | mood / memo が保存され再読込後も残る。一括作成が進捗を出し、中断できる | `TodoModal.tsx` / `VisitList.tsx` |
| **5** | **音声入力。** `speech.d.ts` と `useSpeechInput.ts` を書き、4箇所に接続。非対応時の案内文 | 対応端末でトグル動作し、`.mic-live` に中間結果が出て、確定分がカーソル位置に入る。非対応端末で案内が出る | `types/speech.d.ts`（新規）/ `hooks/useSpeechInput.ts`（新規）/ `RecordModal.tsx` / `TodoModal.tsx` / `IncidentModal.tsx` |
| **6** | **集計と CSV。** `aggregate.ts` に集計を移し、`ReportModal` を差し替え。`csv.ts` を書き、3経路に接続。提供分数の式を一本化。**残るスタブの通知文を実態に合わせる** | 帳票の画面表示が変わらない。3経路の CSV が出て、合計が画面と一致する。0件時は通知で中断する | `domain/aggregate.ts`（新規）/ `utils/csv.ts`（新規）/ `ReportModal.tsx` / `VisitList.tsx` / `PendingModal.tsx` / `TimelineModal.tsx` / `IncidentModal.tsx` |

**ステップ2・3・5 の完了直後に、それぞれ `parity-checker` で legacy と突き合わせる。**
ステップ6 は意図的な差分が最も多いため、突き合わせ前に差分一覧（下記）を渡すこと。

### 意図的な差分の一覧（`parity-checker` への申し送り）

legacy と一致しないことが**確定している**箇所。突き合わせで「抜け」として報告されるのを防ぐ。

| # | 箇所 | 差分 | 根拠 |
|---|---|---|---|
| 1 | 職員別帳票 CSV | キャンセルを除外する（legacy は含む） | Q5 |
| 2 | CSV 全経路 | 0件なら中断する（legacy の帳票はヘッダ行だけのファイルを出す） | Q5 |
| 3 | 日次 CSV | 画面のフィルタを効かせる（legacy は無視する） | Q5 |
| 4 | 未完了一覧の ✨特記事項 | 行 DOM を手書きで差し替えず、再描画してトーストで伝える | Q6 |
| 5 | 定型文の本文 | 過去記録に依存する3つの挙動を移植しないため、文章が単調になる | Q8 |
| 6 | 記載チェック | 純粋関数化により、モーダルが開いた状態で別レコードを判定する挙動が消える | Q10 |
| 7 | 自動修正ボタン | 検出と置換の正規表現を揃えるため、legacy では効かない入力でも置換される | Q11 |
| 8 | 音声入力 | 非対応端末に案内文を出す（legacy は黙って非表示） | Q9 |

### リスク

| # | リスク | 影響 | 対処 |
|---|---|---|---|
| 1 | **テストランナーが無い**（`## 3`）。記載チェック17種と集計22箇所を、自動検証なしで移植する | 判定漏れ・集計ずれが実装後に発見できない。とくに集計は「画面の数字が変わっていないこと」を確かめる手段が無い | ステップ6 の**着手前に現在の帳票の数字を控え、置換後に突き合わせる**。`parity-checker` を各ステップ直後に回す。**テスト導入自体は Phase 1b の範囲外**とし、`## 7` の残課題に記録する |
| 2 | **`SCHEMA_VERSION` 上げ後に `resetLocalData()` を忘れる** | 「読み出せない記録が N 件あります」が出続け、契約変更を疑って戻したくなる | ステップ1の完了条件に明記した。`## 5` にも実行した事実を記録する |
| 3 | **音声入力は実機でしか検証できない。** iOS は Safari も Chrome も WebKit のため `webkitSpeechRecognition` が存在しても実質動かないことがある（Q9） | 「対応しているのに動かない」端末が出る | Q9 の確定どおり**「動かない端末がある」を仕様として扱う。** 案内文を出し、音声入力なしで記録が完結することをステップ5の完了条件にする |
| 4 | **月間帳票が最大3日分しか無い**（`## 3`）。CSV を実データで十分に検証できない | 月をまたぐ集計・0件月の挙動が検証できない | `aggregate.ts` の入力を手で組み立てて確かめる。制約を `## 5` に記録する |
| 5 | **`RecordModal.tsx` が379行からさらに膨らむ。** ステップ2・3・5がすべてこの1ファイルに載る | 可読性が落ち、レビューが難しくなる | **DOM の階層とクラス名は変えない**（鉄則2）範囲でのみ分割する。判定・生成・音声入力のロジックは domain とフックに出し、モーダルには呼び出しだけを残す |
| 6 | **CSV の列定義を legacy から写す作業が残っている**（決定1・2） | 列が足りない / 順序が違う CSV が出ると請求突合で使えない | ステップ6の着手時に `legacy-reader` で4箇所の列定義とファイル名を読む。**推測で埋めない** |
| 7 | **意図的な差分が8件ある。** 申し送りを怠ると `parity-checker` が「移植漏れ」として報告する | 差し戻しの空振りが発生する | 上の一覧を `parity-checker` に毎回渡す |

### 適用する Craft Skills

| Skill | 適用理由 |
|---|---|
| `updating-contract`（プロジェクト固有） | `contract.ts` を変更する。CLAUDE.md の指定。**ステップ1で必須** |
| `porting-legacy-screen`（プロジェクト固有） | legacy からの移植が本体。`legacy-reader` → 機械的な移植 → `parity-checker` を1セットとして各ステップで回す |
| `designing-api-contracts` | `visitRecordSchema` の変更と、`generateNote()` / `updateRecordFields()` という新しい境界の定義を伴う |
| `handling-async-states` | 定型文生成（`Promise`）/ `RecordPrefs` の取得 / 一括作成の進捗と中断 / CSV の0件・失敗。**loading / error / empty / success の4状態を全経路で確認する** |
| `writing-forms` | 記録モーダルのメモ欄、未完了一覧の mood / memo、自動修正による本文の書き換え。**失敗しても入力を失わない**ことは既存の作法でもある |
| `making-accessible` | 音声入力のトグル状態（`.micbtn.rec`）、`.mic-live` の中間結果は**ライブリージョンとして読み上げられるべき**、自動修正ボタンのフォーカス、`confirm` 後のフォーカス復帰。既存の `Modal.tsx` がフォーカストラップと Esc を持つため、それを壊さないことも含む |
| `reviewing-data-boundaries` | `mood` / `memo` の追加が契約境界を越える。定型文生成が `CarePlanSnapshot`（疾患名・ADL・目標を含む）を読む。**鉄則4（法定文書は kpi-react が正）に抵触しないこと**を確認する必要がある |

**非該当と判断したもの。**

- `choosing-rendering-strategy` — Next.js ではなく Vite の SPA。Server / Client 境界が存在しない（`## 3`）
- `designing-ui-components` — 新しい画面を作らない。DOM の階層とクラス名は legacy 固定で、
  情報設計の判断余地が無い（鉄則2）
- `optimizing-performance` — 性能要件は仕様として存在しない。ただし
  「保存のたびに全件再取得」は実在の問題なので、**`onBlur` 保存という設計判断で回避する**（方針参照）

### Review Required

**`review_required: yes`**

判定理由。以下の5つに該当する。

1. **API contract の変更** — `visitRecordSchema` と `SCHEMA_VERSION`。kpi-react との共有契約であり、
   誤ると連携先に波及する
2. **共通ユーティリティの新設** — `compliance.ts` は5箇所、`aggregate.ts` は帳票と CSV、
   `csv.ts` は3経路、`useSpeechInput.ts` は4箇所から使われる
3. **複数画面に影響する変更** — 変更対象は7画面
4. **重要な業務ロジック** — 記載チェックは運営指導で指摘されるかどうかに直結する。
   `ng` のまま承認できる仕様（Q4）を残す以上、判定そのものの正しさが最後の砦になる
5. **`CareStore` の公開 API の追加** — `updateRecordFields` は記録の部分更新であり、
   誤ると承認済みの記録を壊しうる

`reviewing-data-boundaries` の観点（鉄則4 に抵触しないか）は、`reviewing-code` と
`auditing-security` のどちらでも扱えるが、**書き込み対象が契約に載る以上 `reviewing-code` で扱う**。

## 5. Implementation Status

実装順序（`## 4`）の6ステップに対応する。

- [x] **1. 契約の版上げと境界の整備**（`updating-contract` に従って実施）
- [x] **2. 記載チェック**
- [ ] 3. 定型文生成
- [ ] 4. 未完了一覧と一括作成
- [ ] 5. 音声入力
- [ ] 6. 集計と CSV

### ステップ1の内容（2026-09-11）

契約の変更は `updating-contract` の手順3に従い、**依頼者の承認を得てから反映した**。

| ファイル | 変更 |
|---|---|
| `src/types/contract.ts` | `SCHEMA_VERSION` 1 → 2（版の履歴をコメントに追加）。`visitRecordSchema` に `mood` / `memo`（ともに `z.string()`、未入力は空文字）。`noteSource` を `z.enum(['ai','template','manual']).nullable()` に。`visitRecordSchema` の見出しに「`mood` / `memo` は carerecords が書き、kpi-react は読まない」を明記 |
| `src/domain/vocabulary.ts` | `MOOD_OPTIONS`（legacy `MOODS` の8項目）と `MOOD_DEFAULT` を追加 |
| `src/domain/visitStatus.ts` | `newRecordFor()` に `mood: ''` / `memo: ''` |
| `src/data/mock.ts` | `buildVisitRecord({...})` に `mood: ''` / `memo: ''` |
| `src/store/context.ts` | `RecordFieldPatch` 型と `updateRecordFields(visitId, patch)` を `CareStore` に追加 |
| `src/store/CareStoreProvider.tsx` | `updateRecordFields` を既存 `mutateRecord` の薄い包みとして実装し `value` に公開 |

**`resetLocalData()` の実行**: 開発用ブラウザの `localStorage` は**依頼者の環境でのみ消せる**ため、
実装側からは実行していない（下の「実装中に気づいた点」2 を参照）。
headless ブラウザ（空のプロファイル = リセット後と同じ状態）で起動を確認し、
`schemaVersion: 2` の記録44件が再生成され、
「読み出せない記録が N 件あります」が出ないことを確認した。

### ステップ2の内容（2026-09-11）

`legacy-reader` で `LINT_RULES` / `lintNote()` / `renderLint()` / `outOfPlan()` /
`mSave` の枠外ガード / `mApprove` を読み取り、機械的に移植した。

| ファイル | 変更 |
|---|---|
| `src/domain/compliance.ts` | **新規。** `check(record, plan): Finding[]`（17種を legacy と同じ順序で判定）、`outOfPlan()`、`countNg()`、`Finding` / `NO_ISSUE_FINDING` |
| `src/features/record/RecordModal.tsx` | `LintItem` を追加して `#lintBox` を描画。記載チェックボタン / 自動修正 / 承認時の `confirm` / 保存時の枠外ガードで記載チェックを描画。ローカルの `outOfPlan` を `compliance.ts` へ移した |

**判定17種の内訳**（legacy と同じ順序）: 正規表現9件（ng 6・warn 3、うち自動修正つき3件）→
計画外サービス（ng）→ 生活援助の算定理由（ng）→ 予定枠外（ng）→ 実績時間の未入力/差15分（warn）→
25文字未満（warn）→「特変なし」単独（ng）→ 短期目標への言及（warn）。
本文が空なら warn 1件で即 return する順序依存も写した。

**動作確認**（headless ブラウザ、コンソールエラー0）:
空本文 → warn 1件 ／ 違反まみれの本文 → ng 3件 + warn 3件が legacy と同じ順序・文言で描画 ／
自動修正で本文が置換され再判定される ／ `.lintitem > .ic + div > b + 全角スペース + 本文` の
DOM が legacy と一致 ／ 問題なしのときは `.lv-ok` の1行。

### 計画から外れた点

**0. `check()` の引数から `prefs` を落とした。**
計画書は `check(record, plan, prefs)` としていたが、**legacy の記載チェックは prefs を1つも読まない**
（`legacy-reader` の報告: legacy 内に `prefs` という識別子自体が0件。文体・分量は定型文生成でのみ使う）。
読まないものを引数に取ると「設定で判定が変わる」と誤解されるため `check(record, plan)` にした。
`outOfPlan()` も `RecordModal.tsx` から `compliance.ts` へ移した（記載チェックと保存ガードの両方が使うため）。

**1. `MOOD_OPTIONS` を legacy どおり8項目にした（依頼者の判断で確定）。**
計画時に参照した `TodoModal.tsx:155-156` は先頭4項目しか描いていないが、legacy の
`MOODS`（`legacy/index.html:1643-1644`）と記録モーダルの `#fMood`（`:1875`）、
未完了一覧の行内 select（`:3305`）はいずれも8項目である。Phase 1a の4項目が移植時の
取りこぼしにあたる。**ステップ3・4 で `MOOD_OPTIONS` から描くと、未完了一覧の選択肢が
4→8 に増える。** これは legacy への復帰であり、意図的な差分ではない。

**2. `updateRecordFields` の patch を `Partial<VisitRecord>` にしなかった。**
`RecordFieldPatch = Partial<Pick<VisitRecord, 'note' | 'noteSource' | 'mood' | 'memo'>>` に絞った。
`reviewing-data-boundaries` の「クライアントから受け取った値をそのまま更新に使わない」に従い、
`visitId` / `schemaVersion` / `approvedBy` が `approveVisit` を経由せずに書き換わる経路を作らないため。
対象を増やすときは、その項目を承認と独立に上書きしてよいかを確かめる。

**3. `VisitRow.tsx` を計画書の変更対象ファイルに追加する（ステップ3で実施）。**
`VisitRow.tsx:95` は `noteSource === 'ai' ? '✨' : '📝'` のため、`'template'` が 📝 で出る。
Q7 の表は `'template'` → ✨ と決めているので、`'template'` を書き始めるステップ3で直す
（依頼者の判断で確定）。ステップ1の時点では誰も `'template'` を書かないため実害は無い。
なお `TimelineModal.tsx:104` の「AI作成」バッジは `'ai'` のままにする。定型文は AI 作成ではない。

### 実装中に気づいた点

**1. `mood` の初期値を legacy の `blank()` とは変えた（記録しておく）。**
legacy は新規予定の下書きにだけ `mood: MOODS[0]` を入れる（`:1861`）が、seed 済みの訪問は
`mood` を持たないまま打刻される（`:1687-1691`）。`newRecordFor()` は「打刻で作られる記録」に
あたるため `mood: ''` にした。帳票の「様子の傾向」は値があるものだけを数える（`:2130` / `:3790`）ので、
打刻しただけの記録に「いつもと変わりなし」が入ると、選んでいない様子が集計に載る。
表示側は `MOOD_DEFAULT` を既定として出す（legacy の `v.mood||MOODS[0]` と同じ）。

**2. `resetLocalData()` を呼び出す導線がアプリ内に無い。**
`src/data/devTools.ts` に export されているだけで、UI からも `window` からも呼べない
（`src/` 全体で呼び出し0件）。版を上げるたびに、開発者が自分のブラウザの devtools で
以下を実行する必要がある。Phase 5 までに開発用の導線を用意するか、
手順として `CLAUDE.md` に書くかを決めたほうがよい。

```js
['carerecords.v2.visitRecords','carerecords.v2.recordPrefs','carerecords.v2.auditLogs',
 'carerecords.v2.session','carerecords.v2.incidents'].forEach(k => localStorage.removeItem(k));
```

**3a. legacy の記載チェックには、移植しても再現できない副作用が3つある**（いずれも再現しない）。
- `runLint()` が `collect()` を呼ぶため、**「記載チェック」ボタンを押すだけでフォーム全項目が
  `cur.draft` に書き戻される**（`:2411`）。読み取りのつもりの操作が状態を変えていた
- 自動修正は `undoStack` を更新しない（`:2405-2409`）。自動修正のあとに「元に戻す」を押すと
  AI 生成前まで戻り、自動修正ごと巻き戻る。**ステップ3で `元に戻す` を実装するときに同じ形にしない**
- `renderLint()` は `esc()` を通さず `innerHTML` に埋めている（`:2402`）。同じ見た目を作る
  `incLint()`（`:4027`）は `esc()` を通しており、legacy 内で不統一。React では自動エスケープされる

**3b. 空本文の早期 return が ng 件数を 0 にする**（`:2354`、鉄則6 で写した）。
特記事項が空の記録は、計画外サービス・予定枠外・算定理由欠落があっても **ng 0件**として扱われる。
ステップ6 で未承認一覧の統計・行チップ・一括承認・CSV をこの判定に繋ぐと、
**「要修正0件」と「特記なし」が同時に出る**ことになる。legacy と同じ挙動だが、
運営指導の観点では「未記入の記録が最も危ない」ので、**Phase 2 以降で見直す候補として残す**。

**3c. `parity-checker` への申し送りは `## 4` の「意図的な差分の一覧」を使う。**
8件の一覧はそこにある。ステップ2・3・5・6 の突き合わせのたびに渡すこと。

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
