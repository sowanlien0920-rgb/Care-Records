---
request: Phase 5b が持ち越したオフライン関連2件を塞ぐ
status: reviewing
created: 2026-09-15
review_required: yes
---

## 1. Request

```
重さの順で言えば 2 → 1a → 3 → 1b・4で実行して
```

（2026-09-15。`2026-09-14-carerecords-phase5b-pwa-offline.md` の `## 7`
「塞げていないもの（Phase 6 へ送る）」のうち、carerecords 側の2件を対象にする。）

- **1a**: セッションをまたいだ再送の失敗は誰も受け取れない（巻き戻しが無言で起きる）
- **1b**: キャッシュから返った一覧を「最新」として表示している

## 2. Clarified Requirements

### 確定

- **記録は法定文書である。** 「保存したはずの記録が消えている」ことに職員が気づけない
  状態を残さない（Phase 5b の U-a と同じ理由）
- **`DataAdapter` の境界を越えさせない。** 端末に何が溜まっているかは carerecords の
  端末の事情で、`VisitRecord`（kpi-react との契約）には混ぜない。
  `RecordListing.pendingVisitIds` と同じ扱いにする
- **`src/styles.css` を書き換えない。** 表示は legacy のクラスで組む（鉄則2・5）
- **`localStorage` を UI から直接触らない**（鉄則3）。端末ローカルの控えを持つなら
  アダプタの中に閉じる（`features/incident/incidentAdapter.ts` に前例がある）

### 現状の確認（2026-09-15 にコードで確認した）

- 失敗を画面に出すのは `firestoreAdapter.ts:152-156` の `pending.catch(...)` で、
  **`setDoc` が返した Promise を持っている主体がいる間しか効かない**。
  圏外で保存 → アプリを閉じる → 翌朝の起動で SDK が再送、の経路では誰も受け取れない
- `CareStoreProvider.tsx:487-501` の `waitForPendingWrites` は新しいセッションでも動く。
  未送信が残っていれば待って一覧を取り直すので、**巻き戻った行は画面から消える。
  消えるが、なぜ消えたかは誰も伝えない**
- `src/` 全体で `fromCache` の参照は**ゼロ**。`firestoreAdapter.ts:250` が見ているのは
  ドキュメント単位の `hasPendingWrites` だけで、一覧がキャッシュ由来かは判定していない

### 1b の見せ方（2026-09-16 に決めた）

Phase 5b の `## 7` は「直すと『この一覧は古いかもしれない』を全画面に出すことになり、
表示の設計から決め直しになる」と書いていた。**全画面には出さない**ことにした。

- **出す場所は実施一覧の1か所だけ。** Phase 5b が名指しした危うさは
  「圏外で日付を切り替えると古い内容が通常の一覧として出る」であり、そこを塞ぐ
- **閉じられるようにしない。** 圏外である間ずっと成り立つ事実で、閉じられると
  「古いかもしれない」という前提だけが消える。電波が戻って読み直せば自然に消える
- **信号は1つに寄せる。** `RecordListing.fromCache`（実施記録の読みがキャッシュ由来か）。
  圏外なら配信の読みも同じくキャッシュから返るため、これで足りる

### 対象外

- kpi-react 側の変更（1a・1b とも carerecords に閉じる）
- Service Worker の導入（Phase 5b の U-d で「入れない」と決めている）
- 未送信を抱えたままのログアウトを止めること（U-b の決定）

### 前提として置いたもの

1. **`waitForPendingWrites()` は書き込みが拒否されても resolve する。**
   SDK は職員が入れ替わったときだけ reject する。したがって「resolve したのに
   記録が無い」をもって巻き戻りと判定できる → 実装で確かめる
2. **端末ローカルの控えは `localStorage` でよい。** Phase 5b で IndexedDB が
   使えない端末には既に警告を出している（`CareStoreProvider.tsx:321`）

## 3. Existing System Investigation

### 関連ファイル

| ファイル | 役割 |
|---|---|
| `src/data/firestoreAdapter.ts:143-156` | `writeInBackground`。失敗を `onWriteFailure` へ流す |
| `src/data/firestoreAdapter.ts:383-400` | 記録の保存・削除の呼び出し |
| `src/data/firestoreAdapter.ts:576-578` | `waitForPendingWrites` |
| `src/data/firestoreAdapter.ts:245-250` | `hasPendingWrites` を拾う一回読み |
| `src/store/CareStoreProvider.tsx:288-307` | `onWriteFailure` → `pushAlert` + 一覧の取り直し |
| `src/store/CareStoreProvider.tsx:487-501` | 未送信が送られ終わったら取り直す |
| `src/features/visitList/VisitList.tsx:108-116` | `.warnbox`。職員が閉じるまで残る |

### 影響範囲

`writeInBackground` を通るのは4か所（記録の保存・削除、記録支援設定、変更履歴）。
1a で扱うのは**記録の保存・削除**に限る。設定と履歴は法定文書ではない。

## 4. Implementation Plan

### 方針（1a）

**端末に「送信中の控え」を持ち、次の起動で答え合わせをする。**

1. 記録の保存・削除を投げるとき、`localStorage` に控えを1件足す
   （`visitId` / 種別 / その書き込みが載せた `updatedAt`）
2. 同じセッションで成否が判明したら控えを消す（成功も失敗も）
3. 起動時に控えが残っていたら、`waitForPendingWrites()` の解決を待ってから
   サーバーの実物と突き合わせる
   - 保存の控え → その `visitId` が無い、または `updatedAt` が控えと違う → **巻き戻った**
   - 削除の控え → その `visitId` がまだ在る → **巻き戻った**
4. 巻き戻っていたら `onWriteFailure` と同じ経路で `.warnbox` に出す。
   突き合わせが終わったら控えを消す

**控えはアダプタの中に閉じる。** UI からは見えない。`localAdapter` では
送信という段階が無いので、この仕組みごと持たない。

### 変更対象ファイル

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `src/data/firestoreAdapter.ts` | 変更 | 控えの読み書き、`writeInBackground` への種別の受け渡し、`reconcileOutbox()` の追加 |
| `src/data/adapter.ts` | 変更 | `reconcileOutbox()` を `DataAdapter` に追加（`localAdapter` は何もしない実装） |
| `src/data/localAdapter.ts` | 変更 | `reconcileOutbox()` の空実装 |
| `src/store/CareStoreProvider.tsx` | 変更 | ログイン後に1度 `reconcileOutbox()` を呼ぶ |

### データ構造の変更

**あり（端末ローカルのみ）。** `localStorage` に新しいキーを1つ増やす。
Firestore のドキュメントは変えないため `migrating-database` は不要。
控えが読めない・壊れている場合は捨てて先へ進む（控えは記録そのものではない）。

### 実装順序

1. 控えの読み書きと `reconcileOutbox()` を `firestoreAdapter` に実装する
2. `DataAdapter` に追加し、`localAdapter` に空実装を置く
3. `CareStoreProvider` から起動時に呼ぶ
4. エミュレータで、圏外保存 → リロード → 権限拒否 の経路を再現して確認する

### リスク

1. **`waitForPendingWrites()` が拒否された書き込みでも resolve するかは未確認。**
   前提1。resolve しないなら答え合わせが始まらない。実装の中で確かめる
2. **控えが残り続ける。** 突き合わせの前にアプリを閉じると控えは残る。
   次の起動でやり直すので実害は無いが、増え続けないよう件数に上限を置く
3. **誤検知。** 別の端末が同じ記録を後から更新すると `updatedAt` が変わる。
   巻き戻っていないのに「送信できなかった」と出しうる。
   文言を「送信できたか確認できませんでした」に寄せ、断定しない

### 適用する Craft Skills

| Skill | 理由 |
|---|---|
| `handling-async-states` | 起動時の突き合わせは非同期。loading / error / empty / success を壊さない |
| `reviewing-data-boundaries` | 端末ローカルの控えに何を書くか。記録の中身を控えに持たない |

### Review Required: **yes**

法定文書の「保存できたか」を判定する処理であり、誤ると記録の欠落を見逃す側に倒れる。

## 5. Implementation Status

- [x] ステップ1. 控えの読み書きと `reconcileOutbox()` を `firestoreAdapter` に実装
- [x] ステップ2. `DataAdapter` に追加し、`localAdapter` に空実装を置く
- [x] ステップ3. `CareStoreProvider` から起動時に呼ぶ
- [x] ステップ4. エミュレータで確認（`## 6`）
- [x] **1b（キャッシュ由来の古い一覧）** — 実装・確認まで完了

### 振る舞いの変更

- **変更前**: 書き込みの失敗は `setDoc` が返した Promise の `.catch` でしか拾えず、
  アプリを閉じたあとの再送で拒否されると誰も受け取らなかった。
  記録は巻き戻り、職員には何も伝わらない
- **変更後**: 投げる前に端末へ控えを1件残し、成否が判明した時点で消す。
  起動時に控えが残っていたら、`waitForPendingWrites()` の解決を待ってから
  サーバーの実物と突き合わせ、食い違えば `.warnbox` に出す
- **影響**: `writeInBackground` を通る4か所のうち、控えを持つのは**記録の保存・削除だけ**。
  記録支援設定と変更履歴は法定文書ではないため対象外
- **既存データ**: Firestore のドキュメントは変えていない。増えたのは端末ローカルの
  `localStorage` キー1つ（`carerecords.outbox.v1`）。読めなければ捨てて進む

### 計画から外れた点

1. **権限で拒否された読み取りを「巻き戻った」側に寄せた。** 計画では
   `getDoc` で存在を見るだけのつもりだったが、**ヘルパーは存在しない記録の
   読み取りがルールで拒否される**（`resource.data.staffId == myStaffId()` を
   課しているため、`resource` が null だと評価できない）。つまり「消えた」と
   「読めない」が区別できない。記録は法定文書なので、判定が付かないものは
   職員に確認してもらう側へ倒した。通信の失敗だけは判定せず次の起動に回す
2. **文言を「保存した記録」から「行った記録の変更」に変えた。** 控えには削除も
   入るため、保存だけを指す言い方だと削除の巻き戻りで意味が合わない

### 1b の実装（2026-09-16）

- `RecordListing` に `fromCache` を足した（`adapter.ts`）。`pendingVisitIds` と同じく
  端末の事情であり、kpi-react と共有する契約には混ぜない
- `fetchRecords` が `snap.metadata.fromCache` を返すようにした（`firestoreAdapter.ts`）
- 実施一覧に断りを出す（`VisitList.tsx`）。`.warnbox` は legacy の既存クラスで、
  `styles.css` は1行も触っていない
- `localAdapter` は常に `false`

**塞げていないもの。** `listVisitRows`（未承認一覧・未完了の横断一覧）は
`VisitRow[]` を返す形で、`fromCache` を載せる場所が無い。返り値の形を変えると
呼び出し側に波及するため、今回は実施一覧に絞った。**サービス提供責任者が
圏外で未承認一覧を開くと、今も古い内容が通常の一覧として出る。**

### 実装中に気づいた点

**手を付けていない。**

- **前提1（`waitForPendingWrites()` は拒否されても resolve する）を直接は確かめられなかった。**
  ヘッドレスブラウザで圏外にしても、セッションを閉じる前に接続が戻って書き込みが
  通ってしまい、「拒否されたまま次の起動へ持ち越す」状態を作れなかった。
  代わりに**巻き戻ったあとの状態を直接作って** `reconcileOutbox` を検証した
  （`## 6`）。`waitForPendingWrites` 自体は Phase 5b で検証済み
- **控えは施設・職員で分けていない。** 別の職員が同じ端末でログインすると、
  前の職員の控えを突き合わせることになる。`requireProfile()` の `facilityId` で
  読むため他施設の記録は読めず、権限拒否として「確認できませんでした」に倒れる。
  誤検知の側に倒れるので実害は小さいが、正しくは uid で分ける

## 6. Verification

### 検証環境

Firebase エミュレータ（auth 9099 / firestore 8085、`kpi-react/firestore.rules` を適用）に
`npm run seed` を流し、carerecords を dev サーバーで起動してヘッドレスブラウザで操作した。

### 検証項目

- [x] **圏外で保存すると控えが残る**
  - ヘルパー（佐藤 健一）でログイン → ブラウザを圏外にして記録を保存。
    モーダルは **1,540ms** で閉じ、一覧に `未送信` が出た。
    `localStorage` の `carerecords.outbox.v1` に
    `[{"visitId":"2026-09-15-s002-00","kind":"save","updatedAt":"..."}]`
- [x] **巻き戻っていたら次の起動で知らせる**
  - 記録を消して（再送が権限で拒否され Firestore が巻き戻した状態）、控えを残したまま起動。
    `.warnbox` に「前回この端末で行った記録の変更1件が、送信できたか確認できませんでした。
    お手数ですが、該当の記録をご確認ください。」が出た。控えは空になった
- [x] **届いていたら何も言わない（誤検知しない）**
  - 記録が `updatedAt` 一致で存在する状態で同じ控えを置いて起動。
    `.warnbox` は**出ず**、控えだけが消えた
- [x] **削除の巻き戻りも拾う**
  - `kind: 'delete'` の控えを置き、記録が残っている状態で起動 → 知らせが出た
- [x] **キャッシュ由来の一覧に断りが出る（1b）**
  - ログイン直後（オンライン）: 断りは**出ない**
  - 圏外にして日付を切り替える: 「電波が届いていないため、この端末に残っている内容を
    表示しています。ほかの職員があとから付けた記録は含まれていません。」が出た
  - 電波を戻して読み直す: 断りは**消えた**
- [ ] **未承認一覧・未完了の横断一覧での断り** — **未実装**（`## 5` に理由）
- [ ] **拒否されたまま次の起動へ持ち越す経路の実地再現** — **未検証**
  - ヘッドレスブラウザでは、セッションを閉じる前に接続が戻って書き込みが通ってしまう。
    巻き戻ったあとの状態を直接作って `reconcileOutbox` を検証した

### 検証結果

- **type check**: 通過（`npm run typecheck`）
- **lint**: 通過（`npm run lint`。指摘ゼロ）
- **build**: 通過。ただし `.env.local` の `VITE_USE_EMULATOR=1` が
  `vite.config.ts:48` の安全弁に当たるため、一時的に `0` にして確認し、**元に戻した**
- **動作確認**: 7項目中5項目通過、1項目未実装、1項目未検証

### verifying-changes 内で修正したもの

該当なし（このスキルはまだ回していない。上は `modifying-feature` の中で行った確認）。

## 7. Result
