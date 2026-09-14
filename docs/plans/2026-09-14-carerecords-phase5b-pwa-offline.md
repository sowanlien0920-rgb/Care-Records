---
request: carerecords Phase 5b（PWA 化とオフライン永続化）の要件を整理する
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
-->

## 1. Request

```
複数のルール変更などあった
今のままで実行可能か確認して
確認終了後は次のフェーズへ移行して
```

（2026-09-14。前段の「実行可能か」の確認結果は
`2026-09-14-carerecords-phase5a-firestore.md` の `## 6` に記録した。
ここでいう「次のフェーズ」は、移行計画
（`2026-09-10-carerecords-react-migration.md:37`）の Phase 5 のうち
**Phase 5a で範囲から外した PWA 化とオフライン永続化**にあたる。以降これを Phase 5b と呼ぶ。）

Phase 5a が持ち越した未確定は、計画書の U4-b にそのまま残っている。

```
#### U4-b. 訪問先の電波が切れたときの挙動

Firestore のオフライン永続化を有効にするかどうか。有効にすると記録は端末に溜まって
後から同期されるが、**「保存した」と見えて実際は未送信**の状態が生まれる。
法定文書なので、どちらを取るかは運用の判断になる。**Phase 5a では既定（オフライン無効）で計画し、
PWA 化と併せて決める。**
```

## 2. Clarified Requirements

### 確定

移行計画と Phase 5a の計画書から、すでに決まっているものだけを書く。

- **対象は carerecords のみ。** kpi-react 側の変更は含まない
  （Phase 3・4・5a のルール変更で認められた例外は、この範囲には及ばない）
- **`DataAdapter` の境界は変えない。** Phase 5a で全メソッドが Firestore 実装を持った。
  オフライン対応をアダプタの外（UI やドメイン）に染み出させない
- **記録は法定文書である。** 「保存したつもりで未送信」を、職員が気づけない形にしてはならない
  （`CLAUDE.md` の鉄則4 と同じ理由。どちらが正か判定できない状態を作らない）
- **`src/styles.css` を書き換えない。** 未送信の表示を足す場合も legacy のクラスで組む（鉄則2・5）

### 2026-09-14 に依頼者が決めたこと

| | 決定 |
|---|---|
| **U-a** | **案2。オフライン永続化を有効にし、端末に溜めて後で送る。** 圏外の訪問先でも記録を付けられるようにする。「未送信」を職員に見せる作りが必須になる |
| **U-d** | **manifest のみ。ホーム画面に追加できるところまで。** Service Worker は入れない |
| **U-g** | **スマホ実機の確認は完了条件に含めない。** エミュレータとブラウザの開発者ツールでのオフライン再現までを完了とし、実機は本番接続時にまとめて行う |
| **U-b** | **未送信は「行ごとの印」で見せる。** 実施一覧の当該行に出す。件数バッジは出さない。保存のたびの通知も出さない。**未送信が残っていてもログアウトは止めない** |
| **U-c** | **未送信のうちは承認に回らないことをヘルパー側で見せる。** サ責の端末には届いていないため、実態と表示を一致させる |
| **圏外起動の限界** | **了承済み。**「朝に事業所で開いて持ち歩く」使い方を前提に進める |

#### U-a と U-d の組み合わせには限界がある（着手前に共有しておく）

**Service Worker を入れないと、圏外では*アプリ自体が開かない*。**
オフライン永続化が効くのは「すでに開いているアプリが圏外に入った」場合だけで、
圏外で新しくアプリを起動する経路は塞がったままになる。
ブラウザの HTTP キャッシュで運よく立ち上がることはあるが、**当てにできない**。

この組み合わせで実際に守れる範囲は次のとおり。

| 場面 | 案2 + manifest のみ |
|---|---|
| 事業所で開いてから訪問先へ移動し、圏外で記録を付ける | **できる**（これが主たる利用場面なら足りる） |
| 圏外の訪問先でアプリを起動して記録を付ける | **できない**（起動時に画面を取りに行けない） |
| 圏外で付けた記録が電波復帰後に送られる | できる |

主たる利用場面が前者（朝に開いて持ち歩く）なら、この範囲で十分に意味がある。

### 未確定(要確認)

**なし。** 2026-09-14 に U-a〜U-g すべて確定した。

#### ただし、決定に伴って残る危うさ（実装時に計画へ持ち込む）

**未送信が残ったままログアウトできる。** U-b で「ログアウトを止めない」と決めたため、
未送信の記録を抱えたままログアウトすると、その記録は**送られないまま端末に残る**
（Firestore の永続キャッシュはサインアウトで到達できなくなる）。
件数バッジも出さないので、職員が未送信の存在に気づく経路は
**実施一覧の行の印だけ**になる。法定文書としてはここが一番弱い。

実装では、この前提でできる範囲の手当て（行の印を見落としにくくする、
ログアウト後に未送信が消えない形にできるか）を `planning-feature` で検討する。
それでも塞ぎきれないなら、決定の見直しを改めて提案する。

### 対象外

- **Service Worker とその更新の配布**（U-d の決定により）。入れない以上、
  「古い版が端末に残る」問題も起きない。圏外での起動もできない（上記の限界）
- **プッシュ通知**。Service Worker を前提とするため、U-d の決定で自動的に外れる。
  承認待ちの通知は移行計画どおり Phase 6
- **スマホ実機での確認**（U-g の決定により）。本番接続時にまとめて行う

- **kpi-react 側の実施記録の閲覧・承認画面**（Phase 6）
- **ヒヤリハットの統合先**（Phase 5a の U2。`incidentAdapter` は `localStorage` のまま）
- **App Check・実データでの確認・スマホ実機**（Phase 5a が本番接続時に残した3点）。
  Phase 5b の作業ではなく、本番に繋ぐときの確認事項として別に残っている

### 前提として置いたもの

- **「次のフェーズ」は Phase 5b（PWA + オフライン）である。** 移行計画の表では
  Phase 5 に PWA が含まれ、Phase 6 は kpi-react 側の画面になる。
  依頼者が Phase 6 を指しているなら、この計画書は破棄して kpi-react 側で立て直す
- **オフライン対応の手段は Firestore の永続キャッシュを第一候補とする。**
  自前のキューを `localStorage` に持つ形は、送信順・競合・重複の面倒を全部抱えることになり、
  アダプタ境界の内側に収まらない
- **現状はオフライン無効である**（`src/firebase.ts` は `getFirestore(app)` のまま。
  manifest も Service Worker も無い）。圏外では `AdapterError('network')` として
  「通信に失敗しました。電波の状況をご確認ください。」が出る

## 3. Existing System Investigation

`investigating-codebase` は実行していない。**2026-09-14 にこの計画のために直接読んで確認した**（Phase 5a と同じ扱い）。確認した事実だけを書く。

### 関連ファイル

| ファイル | 現状 |
|---|---|
| `src/firebase.ts` | `getFirestore(app)`。**オフライン永続化は無効**。`USING_EMULATOR` は `import.meta.env.DEV` と併せて判定している |
| `src/data/firestoreAdapter.ts` | 全経路が `getDocs` / `getDoc` の一回読み。書き込みは `setDoc` / `deleteDoc` を **`await` している** |
| `src/data/adapter.ts` | `RecordListing`（`records` / `unreadable`）と `VisitRow`（`visit` / `record` / `resident` ほか）。**どちらも carerecords 固有で、`contract.ts` ではない** |
| `src/features/visitList/VisitRow.tsx` | 1行の DOM。`.row` 直下は5個ちょうどでなければ崩れる（冒頭コメント）。`.who > .meta` には `.tag` が可変個並ぶ |
| `index.html` | `manifest` も `apple-touch-icon` も無い。`public/` ディレクトリも無い |
| `src/types/contract.ts` | kpi-react との共有。**`VisitRecord` に項目を足せない**（鉄則4・`updating-contract` の対象） |

### データフロー

`CareStoreProvider` の効果 → `adapter.listRecords` / `listVisitRows` → `VisitList` → `VisitRow`。
書き込みは `saveRecord` / `deleteRecord` / `savePrefs` / `appendAuditLog` と、
打刻・承認（`stampStartAt` / `stampEndAt` / `approveVisit` / `approveAllToday`。いずれも内部で `saveRecord` を通る）。

### 実装パターン

- 非同期の状態は `Async<T>`（`loading` / `error` / `ready`）と `Keyed<T>` で持つ
- 失敗は `AdapterError`（`kind`: `network` / `forbidden` / `contract` / `unknown`）に寄せ、`userMessage` を画面に出す
- **`localStorage` を直接触らない**（鉄則3）。`localAdapter` も同じ `DataAdapter` を実装している

### 影響範囲

- `DataAdapter` の戻り値に「未送信」を足すと、**`localAdapter` 側も追随が要る**（常に未送信なし）
- 行の表示を変えるので、実施一覧を出すすべての画面（当日一覧・未完了一覧）に及ぶ

## 4. Implementation Plan

### 方針

**3つを足すだけにする。アダプタ境界と `contract.ts` は変えない。**

1. **Firestore の永続キャッシュを有効にする**（`initializeFirestore` + `persistentLocalCache`）
2. **未送信を「行の印」として出す**（`hasPendingWrites` を読む）
3. **manifest を足す**（ホーム画面に追加できるところまで。Service Worker は入れない）

#### 書き込みを `await` し続けてはいけない

**これが Phase 5b の中心にある落とし穴になる。** Firestore の `setDoc` が返す Promise は
**サーバーに届いて初めて解決する**。永続化を有効にしても変わらない。
圏外で `await setDoc(...)` すると、**Promise は永久に解決せず、画面は「保存中」のまま固まる**。
オフラインで記録を付けられるようにする、という今回の目的がそのまま達成できない。

そこで書き込み経路は次の形にする。

- **ローカルへの反映をもって「保存できた」とする。** 永続キャッシュに書かれた時点で
  端末には残っており、電波復帰後に自動で送られる
- **サーバー確定の Promise は待たずに `.catch` だけ付ける。** 権限拒否など
  後から返る失敗は握り潰さず、そのときに職員へ通知する
- **`navigator.onLine` で分岐しない。** 地下や電波の弱い場所では `onLine` が `true` のまま
  通信できないことがあり、分岐の根拠にならない

#### 未送信の取り方

`hasPendingWrites`（`snapshot.metadata`）をそのまま使う。**購読を増やさない。**
一回読み（`getDocs`）の結果にもメタデータは付くため、Phase 5a の
「`onSnapshot` にしない」判断（`DataAdapter` が `Promise` を返す形）を崩さずに済む。

`VisitRecord` には足さない（kpi-react と共有する契約であり、送信状態は carerecords の端末の事情でしかない）。
`RecordListing` と `VisitRow`（どちらも `adapter.ts` の carerecords 固有型）に載せる。

#### 表示は既存のクラスで組む

`.who > .meta` に `.tag` を1つ足す（`<span className="tag">未送信</span>`）。
**`styles.css` を触らず、`.row` 直下の5個も変わらない**（鉄則2）。
`.meta` の `.tag` はもともと可変個並ぶので、階層も増えない。

承認（U-c）は、`済` かつ未送信の行で **`承認` ボタンを出さず「送信待ち」を出す**。
押せるのに押しても届かない状態を作らない。

### 変更対象ファイル

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `src/firebase.ts` | 変更 | `initializeFirestore` + `persistentLocalCache`（複数タブ対応）。IndexedDB が使えない端末では既定のメモリキャッシュへ落とす（落ちないこと） |
| `src/data/adapter.ts` | 変更 | `RecordListing` に未送信の `visitId`、`VisitRow` に `pending` を足す。`DataAdapter` のメソッド構成は変えない |
| `src/data/firestoreAdapter.ts` | 変更 | 読み: `hasPendingWrites` を拾う。書き: `saveRecord` / `deleteRecord` / `savePrefs` / `appendAuditLog` をローカル確定で返す形に |
| `src/data/localAdapter.ts` | 変更 | 新しい項目に追随（未送信は常になし） |
| `src/features/visitList/VisitRow.tsx` | 変更 | 未送信の `.tag` と、承認ボタンの出し分け |
| `src/features/visitList/VisitList.tsx` | 変更 | `pending` を `VisitRow` へ渡す |
| `src/features/shell/*`（未完了一覧） | 変更 | 同じ行を出している経路への追随 |
| `public/manifest.webmanifest` | 新規 | 名称・アイコン・`display: standalone`・`start_url` |
| `public/icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | 新規 | アイコン。**headless ブラウザで SVG から書き出す**（macOS の変換ツールに依存させない） |
| `index.html` | 変更 | `manifest` / `theme-color` / `apple-touch-icon` / `apple-mobile-web-app-*` |

### データ構造の変更

**`migrating-database` は不要。** Firestore のドキュメントの形は変わらない。
足すのは端末側のメタデータ（未送信か）だけで、保存されるものではない。
`contract.ts` も変えないため `updating-contract` も不要。

### 実装順序

| # | 内容 | 完了条件 |
|---|---|---|
| 1 | manifest とアイコン、`index.html` | ビルドが通り、ブラウザが manifest を読み込む（開発者ツールで確認）。**Service Worker は入れない** |
| 2 | 永続キャッシュの有効化（`src/firebase.ts`） | エミュレータで従来どおり動く。IndexedDB を塞いだ状態でも起動する |
| 3 | 書き込みをローカル確定で返す形に | **オフラインにして記録を保存しても画面が固まらない**。復帰後に Firestore へ届く |
| 4 | 未送信を `adapter.ts` と `firestoreAdapter` / `localAdapter` に載せる | 型チェックが通る。オンラインでは常に未送信なしになる |
| 5 | 行の印と承認の出し分け | オフラインで保存した行に「未送信」が出て、承認が「送信待ち」になる。復帰後に消える |

ステップ3 が本体である。1・2 は独立してコミットできる。

### リスク

| # | リスク | 対処 |
|---|---|---|
| 1 | **未送信のままログアウトすると記録が送られない。** U-b で「止めない」と決めたため、気づく手段は行の印だけになる | ステップ5 で印の見え方を確認する。塞ぎきれないと判断したら、決定の見直しを提案する（`## 2` に記載済み） |
| 2 | **圏外ではアプリが起動しない**（Service Worker なし） | 了承済み。「朝に開いて持ち歩く」前提。実装では変えられない |
| 3 | **`await` をやめた書き込みの失敗が、後から返る。** 権限拒否・契約違反は、保存の何秒も後に分かる | 職員が読んで消すまで残る `alerts` に出し、あわせて一覧を取り直す。**ただし塞げるのは同じセッションの中だけ**（次項） |
| 3b | **セッションをまたいだ再送の失敗は誰も受け取れない。** 圏外で保存 → アプリを閉じる → 翌朝の起動で SDK がキューを再送 → 権限拒否、の経路では `.catch` を付けた主体がもう居ない。**巻き戻しが無言で起きる** | 塞げていない。購読（`onSnapshot`）か、送信済みの突き合わせが要る。Phase 6 の検討事項として残す |
| 4 | 永続キャッシュは IndexedDB を使うため、プライベートブラウズや容量不足で有効化に失敗する | 失敗したらメモリキャッシュで起動する。**落とさない**。ステップ2 の完了条件に入れた |
| 5 | **オフラインの検証が実機なしになる**（U-g） | ブラウザの開発者ツールのオフライン再現とエミュレータ停止の両方で確認する。実機は本番接続時 |
| 6 | 複数タブで開かれると、永続キャッシュの排他で片方が動かなくなる旧実装がある | `persistentMultipleTabManager` を使う |

### 適用する Craft Skills

| Skill | 適用する理由 |
|---|---|
| `handling-async-states` | 「保存した」の意味が変わる。ローカル確定・未送信・送信済みの3つを、loading / error と混ぜずに見せる必要がある |
| `reviewing-data-boundaries` | 未送信の情報を `contract.ts` ではなく carerecords 固有型に載せる判断そのもの。kpi-react に端末の事情を漏らさない |
| `designing-ui-components` | 行に表示を1つ足す。legacy のクラスで組み、DOM 階層を変えない（鉄則2・5）判断を伴う |

`writing-forms` は適用しない（フォームを新設しない）。
`designing-api-contracts` も適用しない（`contract.ts` と kpi-react との契約は変えない）。
`choosing-rendering-strategy` は Next.js 前提のため適用しない。
`making-accessible` は適用しない（モーダル等を新設しない）。
`optimizing-performance` は適用しない（性能要件の提示が無い）。

### Review Required: **yes**

理由。

- **共通ユーティリティの変更**。`DataAdapter` と `src/firebase.ts` は全画面が依存する
- **書き込みの意味が変わる**。「保存できた」がサーバー到達を意味しなくなる。
  法定文書の記録なので、取り違えると「記録したのに残っていない」が起きる
- **複数画面に影響する**。実施一覧を出すすべての経路

認証・認可は変えないため `security-auditor` は不要と判断する
（ルールも kpi-react も触らない）。

## 5. Implementation Status

- [x] **ステップ1** — manifest とアイコン、`index.html`（2026-09-14）
- [x] **ステップ2** — 永続キャッシュの有効化（2026-09-14）
- [x] **ステップ3** — 書き込みをローカル確定で返す形に（2026-09-14）
- [x] **ステップ4** — 未送信を `adapter.ts` / 両アダプタに載せる（2026-09-14）
- [x] **ステップ5** — 行の印と承認の出し分け（2026-09-14）
- [x] **ステップ6** — 検証の差し戻し2件の修正（2026-09-14。計画の追加分）

### 各ステップの内容

| ファイル | 内容 |
|---|---|
| `public/icon.svg` | 新規。アイコンの実体。ヘッダーの `.brand .logo` と同じ見え方 |
| `public/icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | 新規。`icon.svg` から書き出したもの |
| `scripts/renderIcons.ts` | 新規。SVG から PNG を書き出す。**patchright は依存に足していない**（検証で使っているものを借り、無ければその旨を言って終わる） |
| `public/manifest.webmanifest` | 新規。`display: standalone`、maskable を含むアイコン3種 |
| `index.html` | manifest / theme-color / apple-touch-icon / `mobile-web-app-capable`（`apple-` 付きだけだと Chrome が非推奨を警告する） |
| `package.json` | `icons` スクリプトを追加 |
| `src/firebase.ts` | `initializeFirestore` + `persistentLocalCache`（`persistentMultipleTabManager`）。IndexedDB が使えないときはメモリキャッシュで起動する |
| `src/data/firestoreAdapter.ts` | `writeInBackground` / `onWriteFailure` を追加し、4つの書き込み経路を切り替え。読みは `hasPendingWrites` を拾う |
| `src/store/CareStoreProvider.tsx` | `onWriteFailure` を購読して `notify` に出す |
| `src/data/adapter.ts` | `RecordListing.pendingVisitIds` と `VisitRow.pending` |
| `src/data/localAdapter.ts` | 追随（送信という段階が無いので常に空） |
| `src/features/visitList/VisitRow.tsx` | `.meta` に `未送信` の `.tag`、`.acts` の承認を `送信待ち` に |
| `src/features/visitList/VisitList.tsx` | `pendingVisitIds` を行に渡す |

**ステップ6（検証の差し戻しを受けた修正）。**

| ファイル | 内容 |
|---|---|
| `src/data/adapter.ts` | `DataAdapter.waitForPendingWrites()` を追加 |
| `src/data/firestoreAdapter.ts` | `waitForPendingWrites(db)` をそのまま返す |
| `src/data/localAdapter.ts` | 追随（待つものが無いので即解決） |
| `src/store/CareStoreProvider.tsx` | 未送信があるあいだ `waitForPendingWrites()` を待ち、解決したら `reloadToken` を進める |
| `src/features/approval/PendingModal.tsx` | 未送信の行のチェックボックスを `disabled` にし、理由を `title` に置く |

### 振る舞いの変更（ステップ6）

**1. 未送信が送られ終わったら、操作しなくても一覧を取り直す。**

- 変更前: 電波が戻って書き込みが届いても、画面は取り直さない。行の「未送信」「送信待ち」は
  日付の操作・他の記録の保存・承認・再読込のいずれかまで残り、**その行だけ承認できない**
- 変更後: 未送信があるあいだ `waitForPendingWrites()` を待ち、解決したら `reloadToken` を進める。
  実施記録・横断一覧・バッジの3つが同時に取り直される
- 影響: 取り直しが1回増える経路ができた。購読（`onSnapshot`）は増やしていないので、
  Phase 5a の「訪問先で常時接続にしない」判断は保っている。
  待っても顔ぶれが変わらない場合は待ち直さない（取得 → 待つ → 取得、が回り続けるのを止める）

**2. 未承認一覧で、未送信の行にチェックが入らなくなった。**

- 変更前: `disabled` は実績未入力でしか立たず、未送信の行もチェックできた。
  「1件を選択中」と出るのに、承認を押すと「承認する記録を選択してください」になる
- 変更後: 未送信でも `disabled` にし、理由を `title` に置く。承認の対象から外す扱い（`selectable`）は変えていない
- 影響: 行の DOM は `input` の属性だけが変わる。`.pend-row` の span 6個の構成は変えていない（鉄則2）

### 計画から外れた点

**アイコンの書き出し方法を1つ増やした。** 計画では「headless ブラウザで書き出す」までしか
決めていなかった。`scripts/renderIcons.ts` と `npm run icons` を足し、
`public/icon.svg` を実体にした。手で PNG を描き直すと、次に色を変えるときに
どれが元だったか分からなくなるため。

**`index.html` に `mobile-web-app-capable` を足した。** `apple-` 付きだけでは
Chrome が非推奨の警告を出すことが、実際に動かして分かった。

### 実装中に気づいた点

**1. 未承認一覧（`PendingModal`）には未送信の印を入れていない。**
`.pend-row` は span 6個ちょうどのグリッド（`styles.css:425-427`）で、
印を足すと全カラムがずれる（鉄則2）。加えて、**あの画面はサ責のもので、
他人の未送信は原理的に見えない**（届いていないため）。自分の端末で保存した
サ責自身の記録だけが対象になるが、その場合は同じ端末なので承認しても筋は通る。
入れるなら `.pend-row` の作り直しが要るため、別の判断として残す。

**2. 未完了一覧（`TodoModal`）には要らない。**
未完了は「記録が無い」訪問で、圏外で保存した時点で「済」になり一覧から外れる。

**3. 打刻ボタンは予定時間を過ぎていると押せない**（`timeValidation.stampStart`、legacy の仕様）。
検証で「開始」を押しても何も起きず、一度これを疑った。legacy の仕様どおりなので触っていない（鉄則6）。

**4. 承認済み記録の上書きは Phase 5a から未解決のまま。** オフラインになっても
状況は変わらない（ルール側の話）。Phase 5a の計画書に記載済み。

## 6. Verification

### 検証環境

エミュレータ（auth 9099 / firestore 8085、`firestore.rules` は kpi-react の実体）と
dev サーバー（`VITE_BACKEND=firestore` / `VITE_USE_EMULATOR=1`）、
ヘッドレスブラウザ（patchright）の offline エミュレーションで確認した。
実機は U-g の決定どおり対象外。

### 検証項目（ステップ6 対応前）

**この一覧はステップ6 の修正を入れる前の記録である。** 末尾の2件の失敗は
ステップ6 で対応し、`### 再検証（ステップ6 対応後）` で結果を差し替えた。

- [x] **manifest がブラウザから読める**
  - `/manifest.webmanifest` が 200 / `application/manifest+json` で返る。`link[rel=manifest]`・
    `theme-color`・`apple-touch-icon`・`mobile-web-app-capable` が `index.html` にあり、
    `dist/` にも manifest とアイコン4種が出力される。JSON として妥当で、
    `id` / `display: standalone` / icons 3種（192・512・512 maskable）。PNG の実寸も宣言どおり
- [x] **Service Worker が入っていない**（U-d の決定どおり）
  - `navigator.serviceWorker.getRegistrations()` が 0 件。`src/` `index.html` `public/` に登録コードなし
- [x] **永続キャッシュが有効になっている**
  - IndexedDB に `firestore/[DEFAULT]/kpi-system-a718f/main` ができる
- [x] **複数タブで開いても動く**（`persistentMultipleTabManager`、リスク6）
  - 同じプロファイルで2枚目のタブを開くと、どちらも実施一覧を6行表示する
- [x] **圏外で保存しても画面が固まらない**（ステップ3の本体）
  - offline にしてから記録モーダルで保存 → **38ms でモーダルが閉じ**、「保存しました」が出る
- [x] **圏外で保存した行に「未送信」が出る**
  - `.meta` の先頭に `span.bchip.ng`「未送信」。`title` は「この端末にだけ保存されています…」
- [x] **承認ボタンが「送信待ち」になり、押せない**
  - `<span class="bchip">送信待ち</span>`。`button` ではないため押下経路が無い
- [x] **一括承認が未送信を対象から外す**（レビュー指摘5）
  - 「済」が未送信1件だけの状態で `#approveAll` を押すと、確認ダイアログを出さずに
    **「未送信の記録が 1 件あります。電波が戻ってから承認してください」**。行は「済」のまま
- [x] **未承認一覧の「すべて選択」が未送信を拾わない**（レビュー指摘5）
  - 4行のうち未送信の1行だけがチェックされない（`[true,true,false,true]`）。
    集計に「未送信（承認できません）1件」が出る
- [x] **電波が戻ると実際に Firestore へ届く**
  - 圏外で保存した記録が、復帰後に `visitRecords` と `auditLogs` の両方に入る
    （エミュレータを admin 権限の REST で確認。記録3件・変更履歴3件）
- [x] **権限拒否で巻き戻されたことが画面に出る**（要修正1・2。実装者が「コードの上でしか確かめていない」とした経路）
  - エミュレータのルールを一時的に「全書き込み拒否」に差し替えて再現した。
    保存直後は「保存しました」で行が「済」になり、数秒後に
    **`.warnbox` が2本**（「記録を送信できませんでした…（この操作を行う権限がありません…）」と
    「変更履歴を送信できませんでした…」）出て、**行が「済」→「未完」に戻る**。
    閉じるまで消えない。トースト1枠での取りこぼしは起きていない。
    ルールは検証後に元へ戻した（kpi-react の `firestore.rules` は未変更）
- [x] **回帰: `localStorage` 構成（`VITE_BACKEND=local`）で従来どおり動く**
  - Phase 1a の簡易ログインから実施一覧6行。未送信の印も警告も出ない（送信という段階が無い）
- [ ] **電波が戻っても「未送信」の印が自動では消えない**
  - **失敗。** offline を解除して45秒以上オンラインのまま置いても、行の「未送信」と「送信待ち」が残る。
    記録は Firestore に届いているのに、**その行だけ承認できないまま**になる。
    日付を動かす・他の記録を保存する・承認する・再読込のいずれかで一覧を取り直すと消える。
    サ責側の未承認一覧でも同じで、「未送信（承認できません）1件」が残り続ける。
    ステップ5 の完了条件「復帰後に消える」を満たしていない
- [ ] **未承認一覧で、未送信の行のチェックボックスが押せてしまう**
  - **失敗（軽微）。** `disabled` は `st !== '済'` だけで決まり、未送信では外れない（`PendingModal.tsx:259`）。
    チェックすると「1件を選択中」と出るが、承認を押すと **「承認する記録を選択してください」**。
    選んで見えているものが選ばれていない。承認されないこと自体は正しい
- [ ] **IndexedDB が使えない端末での警告**（要修正3）
  - **未検証。** `indexedDB.open` が投げる状態をヘッドレスブラウザで作れなかった
    （`addInitScript` が反映されず、新規プロファイルは Chrome の Local Network Access 制限で
    エミュレータへ届かない）。確認にはプライベートブラウズの実機が要る

### 検証中に観測したこと（失敗ではない）

**圏外ではツールバーのバッジが 0 になる。** 未完了・未承認の件数は `runAggregationQuery`（`count()`）で
引いており、これは永続キャッシュから返せない。圏外では取得が失敗して 0 が出る
（`Toolbar.tsx` の「バッジが読めないことは画面全体を止める理由にならない」の経路）。
一覧そのものはキャッシュから出るため、**件数だけが 0 で中身はある**という見え方になる。
Phase 5a から変わっていない挙動で、Phase 5b で増えた不具合ではない。

### 検証結果

- type check: 通過
- lint: 通過
- build: **通過**（`1,075.67 kB` / gzip `314.76 kB`）。
  ただし `.env.local` のままだと `VITE_USE_EMULATOR=1` をガードが検出して止まる。
  これは `vite.config.ts` の設計どおりで、`VITE_USE_EMULATOR=0` を渡して通した
- test: 該当なし（テストスクリプトが無い）

### verifying-changes 内で修正したもの

**なし。** 機械的検証がすべて通ったため、修正の必要が生じなかった。

### 検証で触った環境（元に戻した）

- エミュレータのルールを一時的に差し替え → **元のルールへ復元済み**。
  `firestore.rules`（kpi-react の実体）は未変更
- 検証で作った実施記録5件と変更履歴7件 → **削除済み**。エミュレータには検証前の2件だけが残る
- MOCK001 / MOCK002 のパスワードを強制変更で書き換え → `npm run seed` で `000000` に戻した

### 差し戻したもの

- **復帰後に「未送信」が消えない** → `modifying-feature`。
  一回読み（`getDocs`）のため、送信が完了しても一覧を取り直す契機が無い。
  Phase 5a の「`onSnapshot` にしない」判断（通信量・電池）と衝突するので、
  取り直しの契機をどう作るかは実装方針の選択になる
- **未承認一覧のチェックボックスが未送信でも押せる** → `modifying-feature`

**いずれも `## 5` のステップ6 で対応し、`### 再検証（ステップ6 対応後・2026-09-14）` で
2件とも通過を確認した。** 上の `[ ]` は対応前の記録としてそのまま残す。

### 実装者が確認したこと（検証ではない）

| 項目 | 結果 |
|---|---|
| 型チェック / Lint | 通る |
| 本番ビルド | 通る（1,074.42 kB / gzip 314.39 kB。Firestore の永続化ぶん増えた） |
| manifest の読み込み | ブラウザが `/manifest.webmanifest` を取得する |
| 永続化の有効化 | IndexedDB に `firestore/[DEFAULT]/kpi-system-a718f/main` ができる |
| **圏外での保存** | モーダルが閉じ、**画面が固まらない**（保存が返ってくる） |
| **未送信の印** | 行に「未送信」が出て、承認ボタンが「送信待ち」（押せない）になる |
| **復帰後の送信** | 電波を戻すと印が消え、承認ボタンに戻る |
| **実際に届いたか** | エミュレータの Firestore に `visitRecords` 1件と `auditLogs` 1件が入っていることを Admin SDK で確認 |

### コードレビューの指摘と対応（2026-09-14）

`reviewing-code`（`code-reviewer`）の結果。**要修正3件・推奨7件・提案4件。**

#### 要修正（3件とも対応した）

| # | 指摘 | 対応 |
|---|---|---|
| 1 | **巻き戻しが画面に反映されない。** 権限拒否で Firestore がローカルの書き込みを破棄しても、画面の一覧は保存直後のまま。消えた記録が「済」で残り続ける | 失敗時に `setReloadToken` を進めて取り直す（`CareStoreProvider.tsx`） |
| 2 | **失敗の通知が3秒のトースト1枠で、上書きと取りこぼしが構造的に起きる。** 記録と変更履歴の2本が同時に落ちると片方しか残らず、一括承認では最後の1件しか出ない。画面を見ていなければ消える | `alerts`（職員が閉じるまで残る `.warnbox`）を新設し、失敗はそちらへ。`notify` とは別枠にした |
| 3 | **IndexedDB のフォールバック検知が機能していない。** `initializeFirestore` は IndexedDB が使えないことを同期的に投げず、SDK が非同期に握ってメモリキャッシュへ落とす。`try/catch` では捕まらず、**永続化が効いていない端末と区別がつかないまま動く** | `offlineStorageAvailable` を追加。IndexedDB を実際に開けるか試し、開けない端末には「電波が切れている間の保存ができません」を出す |

#### 推奨（対応したもの）

| # | 指摘 | 対応 |
|---|---|---|
| 5 | 「未送信は承認に回さない」が実施一覧の行にしか効いておらず、**一括承認と未承認一覧からは承認できた** | `approveAllToday` と `PendingModal` の両方で未送信を対象から外し、件数と理由を出す。`VisitRow.pending` の読み手もこれで生まれた |
| 6 | `送信待ち` が `disabled` なボタンで、`.mini` の指定により**押せるように見える**（hover も効く） | `button` をやめ `.bchip` にした |
| 7 | `未送信` が介助内容と同じ灰色タグで、`+N` の後ろに埋もれる | `.bchip.ng`（赤系）にして `.meta` の先頭へ |
| 9 | `orientation: portrait` の固定。`.row` は横 620px 以上を要求するグリッドで、タブレットの横向きを塞ぐのは後退 | 落とした |
| 14 | manifest に `id` が無い | 足した |
| 4 | リスク3 の記述が実態と違う（`.catch` は同じセッションの中でしか効かない） | `## 4` のリスク表を直し、3b として分けた |

#### 対応しなかったもの（理由つき）

| # | 指摘 | 判断 |
|---|---|---|
| 8 | **キャッシュから返った一覧を「最新」として表示している**（`snap.metadata.fromCache` を捨てている）。圏外で日付を切り替えると、古い内容が通常の一覧として出る | **リスクとして残す。** 直すと「この一覧は古いかもしれない」を全画面に出すことになり、表示の設計から決め直しになる。Phase 5b の範囲を超える |
| 10 | Phase 5a の監査対応と 5b が同じ作業ツリーに混ざっており、5b だけを切り戻せない | **コミットの分け方は依頼者の判断。** こちらでは commit していない。分けるなら「監査対応」「manifest とアイコン」「オフライン書き込み」の3つになる |
| 11 | `splitRecords` は parse に失敗した記録の `pending` を捨てる | 破損した記録が未送信で残る経路は理屈の上のもの。表示の受け皿（`unreadable`）も別なので据え置く |
| 12・13 | `recordExists` の判定材料、`writeFailureHandler` の単一シングルトン | 現状の構成では問題にならない。提案として記録に残す |

**レビュー後に再確認したこと。** 圏外で保存 →「未送信」と「送信待ち」が出る／IndexedDB を開けない端末で警告バナーが出て、閉じると消える。

**未確認のまま。** 権限拒否で巻き戻される経路（要修正1・2 の本番）は、エミュレータで意図的に起こす手立てが無く、**コードの上でしか確かめていない**。

### 再検証（ステップ6 対応後・2026-09-14）

`verifying-changes` を実装者とは別に実行した。**ステップ6 で差し戻し2件を直した後の状態**を対象にする。

**検証環境。** 既に起動していたエミュレータ（auth 9099 / firestore 8085、`firestore.rules` は
kpi-react の実体への symlink・**未変更**）と dev サーバー（5173、`VITE_BACKEND=firestore` /
`VITE_USE_EMULATOR=1`）、ヘッドレスブラウザ（patchright）。実機は U-g の決定どおり対象外。

**この検証で分かった落とし穴。** `page.context().setOffline(true)` は
**ブラウザセッションへ接続し直すと解除される**。圏外の状態を作ってから別の呼び出しで
観測すると、その時点で電波が戻っており、何を測ったのか分からなくなる。
**圏外にする・保存する・復帰させる・観測する、を1回の呼び出しに収めた。**

#### 差し戻した2件（ステップ6 の対象）

- [x] **電波が戻ると「未送信」の印が自動で消える**（前回の失敗1）
  - 1回の呼び出しの中で、圏外 → 記録を保存（モーダルは **44ms** で閉じる）→
    行に `未送信` と `送信待ち` が出ることを確認 → `setOffline(false)` →
    **以降キーもマウスも一切触れずに2秒おきに観測**。
    **最初の観測（復帰から2秒）で `.bchip.ng` と `.acts .bchip` がどちらも 0 になり、
    先頭要素が `BUTTON`「承認」に戻った**（`.acts button` は 10 → 11）。
    復帰前に `window.__verifyMark` を置き、復帰後も残っていることで
    **ページの再読込ではない**ことを確かめた。日付の操作・再読込・他の記録の保存は行っていない
- [x] **未承認一覧で、未送信の行のチェックボックスが押せない**（前回の失敗2）
  - サ責（MOCK001）で圏外のまま未承認一覧を開き、3行のうち未送信の1行だけが
    `disabled=true`、`title` が「この端末にだけ保存されています。電波が戻ると送信され、
    承認できるようになります」。他の2行は `disabled=false`。
    JS から直接 `click()` してもチェックは入らない。
    集計行に **「未送信（承認できません）1件」** が出る。
    `.pend-row` 直下は **span 6個のまま**で、グリッドは崩れていない（鉄則2）

#### 併せて確認した回帰

- [x] **圏外で保存しても画面が固まらない**
  - モーダルが 44ms / 50ms で閉じ、「保存しました」。2回とも再現
- [x] **圏外で保存した記録が、復帰後に実際に Firestore へ届く**
  - `facilities/mock-facility/visitRecords` に2件、`auditLogs` に2件
    （エミュレータへ admin 権限の REST で確認）。検証後に削除済み
- [x] **すべて選択が未送信を拾わない**
  - 3行中2行だけがチェックされ、`0件を選択中` → **`2件を選択中`**
- [x] **一括承認が未送信を対象から外す**
  - 「済」が2件（うち未送信1件）の状態で `#approveAll` を押すと、
    確認は **「「済」1件を承認して完了にします」**、結果は「1件を承認しました」。
    未送信の行は「済」「送信待ち」のまま残った
- [x] **権限拒否の巻き戻しが画面に出る**（要修正1・2。ステップ6 が同じ `reloadToken` を触ったため再確認した）
  - **ルールは変更していない。** サ責でログインしたまま、エミュレータの
    `users/seed-s001.canApprove` を admin REST で `false` に落とし、
    セッションが持つ権限と食い違わせて承認を拒否させた。
    結果、トーストは「承認しました（完了）」だが、その後 **`.warnbox` が2本**
    （「記録を送信できませんでした…（この操作を行う権限がありません…）」と
    「変更履歴を送信できませんでした…」）出て、**行は「完了」に固定されず「済」のまま**。
    さらに10秒観測して `.warnbox` 2本・行数12 から動かないことを確認した
    （**取り直しが回り続けていない**）。`canApprove` は検証後に `true` へ戻した
- [x] **manifest と Service Worker がステップ6 で壊れていない**
  - `/manifest.webmanifest` が 200 / `application/manifest+json`、`id: "/"`、
    `display: standalone`、icons 3種、`orientation` の固定なし。
    `navigator.serviceWorker.getRegistrations()` は **0件**
- [x] **永続キャッシュが有効なまま**
  - IndexedDB に `firestore/[DEFAULT]/kpi-system-a718f/main` が存在する
- [x] **回帰: `localStorage` 構成（`VITE_BACKEND=local`）**
  - 別ポート（5180）で `VITE_BACKEND=local` の dev サーバーを起動して確認。
    Phase 1a の簡易ログインから実施一覧6行、承認は `BUTTON` のまま、
    `.bchip.ng` 0件、`.warnbox` 0件、記録の保存も「保存しました」。
    **未送信という概念が出てこない**（送信の段階が無いため正しい）
- [ ] **IndexedDB が使えない端末での警告**（要修正3）
  - **未検証のまま。** 前回に続いて再現できなかった。**原因は特定した。**
    ドライバの patchright は検出回避のため **document-start のスクリプト注入を無効化している**。
    `page.addInitScript()` も、CDP の `Page.addScriptToEvaluateOnNewDocument` を直接叩く経路も、
    **登録は成功するのに新しいドキュメントで実行されない**（注入した印が読めない）。
    アプリが起動する前に `indexedDB.open` を投げさせられないため、この経路には入れない。
    確認には**プライベートブラウズの実機**か、init script が効くドライバが要る。
    **U-g の決定（実機確認は完了条件に含めない／本番接続時にまとめて行う）を適用し、
    本番接続時の確認リストへ送った**（下の `## 7`）

### 再検証の結果

- type check: 通過
- lint: 通過
- build: 通過（`1,076.91 kB` / gzip `315.14 kB`）。
  `.env.local` の `VITE_USE_EMULATOR=1` はガードに止められるため `VITE_USE_EMULATOR=0` を渡した（`vite.config.ts` の設計どおり）
- test: 該当なし（テストスクリプトが無い）

**通過 11 / 12。残る1件は未検証（失敗ではない）で、U-g により本番接続時へ送る。**

### 再検証で修正したもの

**なし。** 機械的検証がすべて通り、差し戻した2件も直っていたため、手を入れる必要が生じなかった。

### 再検証で触った環境（すべて元に戻した）

- 検証で作った実施記録4件と変更履歴6件 → **削除済み**（検証前と同じ0件に戻した）
- MOCK001 / MOCK002 のパスワードを admin REST で `verify0914` に変更 → `npm run seed` で `000000` に戻した
- `users/seed-s001.canApprove` を `false` に落とした → **`true` へ復元済み**
- `VITE_BACKEND=local` の dev サーバー（5180）を起動 → **停止済み**。5173 のサーバーとエミュレータは起動したまま
- **`firestore.rules`（kpi-react の実体）は触っていない。** 権限拒否は
  ルールではなくエミュレータ上のユーザーデータで作った

### 再検証で気づいた点（ステップ6 とは別の話）

**未承認一覧の「N件を選択中」が、一覧から消えた記録を数え続ける。**
`PendingModal` は `<App>` に常設されていて閉じても unmount されず、
`selected` の `Set` が残る（`PendingModal.tsx:48`）。一方 `{selected.size}件を選択中`
（`:179`）は一覧の中身と突き合わせていない。未承認一覧で数件チェック → 閉じる →
実施一覧の一括承認で承認 → もう一度開く、の順で **実際に選ばれている数より多く出る**。
承認そのものは `selectable.filter(selected.has)`（`:110`）を通るので、
**一覧に無い記録が承認されることはない**。表示だけの問題である。
**ステップ6 が持ち込んだものではない**（今回の差分は `selectable` の条件・
チェックボックスの `disabled`・集計チップだけで、`selected` の扱いは変えていない）。
Phase 5b の範囲外として記録に残す。


## 7. Result

**Phase 5b（PWA 化とオフライン永続化）は完了とする（2026-09-14）。**

### 何ができるようになったか

- **圏外の訪問先で記録を付けられる。** Firestore の永続キャッシュを有効にし、
  書き込みはローカル確定で返す。圏外で保存してもモーダルは 50ms 以内に閉じ、画面は固まらない
- **未送信が職員に見える。** 実施一覧の行に `未送信`（`.bchip.ng`）が出て、承認は
  押せない `送信待ち` になる。一括承認・未承認一覧の両方でも承認の対象から外れる
- **電波が戻れば操作なしで解消する。** 送信が終わると一覧を取り直し、印が消えて承認できるようになる
- **送信に失敗したら気づける。** 権限拒否などで巻き戻ったときは、職員が閉じるまで残る
  `.warnbox` に出したうえで一覧を取り直す
- **ホーム画面に追加できる。** manifest とアイコン3種。Service Worker は U-d の決定どおり入れていない

### 本番接続時に確認すること（Phase 5a の3点に1つ足す）

Phase 5a が残した **App Check・実データの形・複合インデックス・スマホ実機**に加えて、

- **IndexedDB が使えない端末での警告**（レビュー要修正3）。プライベートブラウズの実機で、
  「この端末では電波が切れている間の保存ができません。」が出ることを確かめる。
  エミュレータとヘッドレスブラウザでは再現できない（`## 6` の再検証に理由を書いた）

### 塞げていないもの（Phase 6 へ送る）

- **セッションをまたいだ再送の失敗は誰も受け取れない**（`## 4` のリスク3b）。
  圏外で保存 → アプリを閉じる → 翌朝の起動で SDK が再送 → 権限拒否、の経路では
  `.catch` を付けた主体がもう居ない。**巻き戻しが無言で起きる**
- **キャッシュから返った一覧を「最新」として表示している**（レビュー指摘8）。
  圏外で日付を切り替えると古い内容が通常の一覧として出る。
  直すと「この一覧は古いかもしれない」を全画面に出すことになり、表示の設計から決め直しになる
- **未送信を抱えたままログアウトできる**（U-b の決定。`## 2` に記載済み）
