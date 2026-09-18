/*
 * 永続化の境界。
 *
 * Phase 5 では、この DataAdapter の実装を localAdapter から firestoreAdapter に
 * 差し替えるだけで Firestore 連携に移行できる。UI 側は一切変えない。
 * そのために守ること:
 *
 *   1. UI から localStorage を直接触らない。必ず useCareStore() を経由する
 *   2. localStorage は同期 API だが、ここでは Promise を返す。
 *      同期で書くと Phase 5 で全呼び出し元を書き換えることになり、
 *      境界を設けた意味が消える
 *   3. 「読めなかった」と「0件だった」を区別する。前者は error、後者は empty
 */
import type { Dispatch, DispatchVisit, ResidentBrief, VisitRecord } from '../types/contract';
import type { AuditLog, RecordPrefs, StaffAccount } from '../types/local';

/**
 * 取得・保存に失敗したときの理由。
 * 呼び出し側が「利用者に何を出し、次に何をさせるか」を決められる形にする。
 */
export type AdapterErrorKind =
  /** 保存領域が読めない・書けない（容量超過、プライベートモードなど） */
  | 'storage'
  /** 契約違反。schemaVersion 不一致、または形が違う */
  | 'contract'
  /** 通信の失敗。Phase 5 の firestoreAdapter で使う */
  | 'network'
  /** 権限がない。Phase 5 の Firestore ルールで弾かれた場合 */
  | 'forbidden'
  /** 原因を特定できないもの。他の kind に丸めない */
  | 'unknown';

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  /** 利用者に見せてよい説明。内部のエラー文言をそのまま出さない */
  readonly userMessage: string;

  constructor(kind: AdapterErrorKind, userMessage: string, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = 'AdapterError';
    this.kind = kind;
    this.userMessage = userMessage;
  }
}

/**
 * 実施記録の読み出し結果。
 * 破損した記録があっても、読めた分は返す。
 */
export interface RecordListing {
  records: VisitRecord[];
  /** 読み出せなかった記録。visitId が読めない場合は null が入る */
  unreadable: Array<{ visitId: string | null; reason: string }>;
  /**
   * この一覧が端末のキャッシュから返ってきたか。
   *
   * **圏外でも一覧は返る。** Firestore の永続キャッシュが前に読んだ内容を返すため、
   * 日付を切り替えても「その日の記録はこれです」と平然と出る。実際には
   * その端末が最後に通信できた時点の内容でしかなく、他の職員がその後に
   * 付けた記録は入っていない。**古いと分からないまま見えるのが危うい**ので、
   * 画面が「これは最新ではないかもしれない」と出せるようにする。
   *
   * `pendingVisitIds` と同じく carerecords の端末の事情であり、
   * kpi-react と共有する契約（`types/contract.ts`）には混ぜない。
   * `localStorage` 実装では常に false になる（キャッシュという段階が無い）。
   */
  fromCache: boolean;

  /**
   * まだ端末から送られていない記録の visitId（Phase 5b）。
   *
   * **`VisitRecord` には持たせない。** あちらは kpi-react と共有する契約
   * （`types/contract.ts`）で、送信できているかは carerecords の端末の事情でしかない。
   * 契約に混ぜると、kpi-react 側が読む記録に carerecords の端末状態が付いて回る。
   *
   * `localStorage` 実装では常に空になる（送信という段階が無い）。
   */
  pendingVisitIds: string[];
}

/**
 * 日付・職員をまたぐ一覧の読み出し結果。
 *
 * `RecordListing` と同じ形にしてある。**旗を別に持たせない。**
 * 行と「古いかもしれない」が別々に更新されると、新しい行に古い旗、
 * あるいはその逆の組み合わせが起こりうる。ひとつの取得結果に同梱すれば、
 * 画面が見ている行とその出所は必ず一致する。
 */
export interface VisitRowListing {
  rows: VisitRow[];
  /**
   * この一覧が端末のキャッシュから返ってきたか。意味は `RecordListing.fromCache` と同じ。
   *
   * ここは配信と実施記録の2つを読む。**どちらか一方でもキャッシュ由来なら true にする。**
   * 配信が新しくても記録が古ければ、承認の判断材料としては古い。
   */
  fromCache: boolean;
}

/**
 * ツールバーのバッジ件数。
 *
 * 配信は 1日 × 1職員 で取るが、バッジは日付をまたいで数える必要があるため
 * 取得経路を分ける。Phase 5 では Firestore のクエリになる。
 */
export interface BadgeCounts {
  /** 未完了の訪問。ログイン中の職員の、今日以前の、記録が完成していない訪問 */
  todo: number;
  /** 未承認。全職員・全期間の「済」件数 */
  pending: number;
}

/**
 * 配信された訪問と、それに対応する実施記録の組。
 * 未承認一覧・未完了の訪問・帳票・経過記録は、いずれも日付と職員をまたぐため、
 * 1日1職員で取る配信とは別の経路が要る。
 *
 * 打刻・承認はこの行からも記録を組み立てるため、facilityId を持たせている。
 * 表示中の配信に無い訪問（他日・他職員）を操作できるのはこれが理由になる。
 */
export interface VisitRow {
  facilityId: string;
  date: string;
  staffId: string;
  staffName: string;
  visit: DispatchVisit;
  record: VisitRecord | undefined;
  resident: ResidentBrief | undefined;
  /** 記録がまだ端末から送られていない（Phase 5b）。RecordListing の同名の項目と同じ意味 */
  pending: boolean;
}

/**
 * 誰の分を読むか。
 *
 * 省略可能な staffId にすると「渡し忘れ」が全職員分の取得になり、
 * その誤りが Phase 5 まで表面化しない（Firestore ルールで初めて弾かれる）。
 * ヘルパーが自分の分しか読めないことは訪問介護の情報の扱いとして必須なので、
 * 呼び出し側に必ず選ばせる形にしてある。
 */
export type VisitScope =
  /** 事業所全体。サービス提供責任者以上、または承認権限を持つ職員のみ成立する */
  | { kind: 'all' }
  | { kind: 'staff'; staffId: string };

export interface DataAdapter {
  // ── 職員（Phase 5 で Firebase Auth に置き換わる） ──────────
  listStaff(): Promise<StaffAccount[]>;

  /**
   * 選択中の職員 ID。Phase 1a の簡易ログインを再読込のあとも保つ。
   *
   * ヘルパーはスマホ・タブレットで訪問先から使うため、タブの再読込で
   * 職員選択に戻ると訪問のたびに選び直すことになる。
   * Phase 5 では Firebase Auth の永続化に置き換わるので、
   * UI から localStorage を触らずここに閉じておく。
   */
  getSessionStaffId(): Promise<string | null>;
  /** null を渡すとログアウト */
  saveSessionStaffId(staffId: string | null): Promise<void>;

  // ── 配信（読み取り専用。kpi-react が正） ──────────────────
  /** 指定日・指定職員の配信。存在しなければ null（0件は empty であって error ではない） */
  getDispatch(date: string, staffId: string): Promise<Dispatch | null>;

  // ── 実施記録（carerecords が書く） ────────────────────────
  /**
   * staffId を省略すると事業所全体。呼び出し側でロールを確認すること。
   *
   * 読めた記録と読めなかった記録を分けて返す。実施記録は法定文書であり、
   * 1件の破損で全件を読めなくするのも、破損を黙って捨てるのも取れない。
   * 読めた分は使わせ続け、読めなかった分は件数と visitId を利用者に見せる。
   */
  listRecords(date: string, staffId?: string): Promise<RecordListing>;
  saveRecord(record: VisitRecord): Promise<void>;
  /**
   * 実施記録を削除する。配信（予定）は kpi-react のものなので消えない。
   * 消えるのは carerecords が書いた記録だけになる。
   */
  deleteRecord(visitId: string): Promise<void>;

  /**
   * バッジ件数。sessionStaffId は「ログイン中の職員」であり、
   * 画面で表示中の職員とは異なりうる（サ責は他職員を表示できるため）。
   */
  getBadgeCounts(sessionStaffId: string): Promise<BadgeCounts>;

  /**
   * 訪問と記録を突き合わせた一覧。日付・職員をまたいで取る。
   *
   * Phase 5 では Firestore のクエリになる。scope を必須にしているのは
   * VisitScope のコメントのとおりで、`{ kind: 'all' }` は
   * サービス提供責任者以上、または承認権限を持つ職員でのみ成立する。
   */
  listVisitRows(scope: VisitScope, range?: { from?: string; to?: string }): Promise<VisitRowListing>;

  // ── 記録支援設定（carerecords 固有） ──────────────────────
  getPrefs(residentId: string): Promise<RecordPrefs>;
  savePrefs(residentId: string, prefs: RecordPrefs): Promise<void>;

  // ── 変更履歴 ──────────────────────────────────────────────
  listAuditLogs(): Promise<AuditLog[]>;
  appendAuditLog(log: AuditLog): Promise<void>;

  // ── 未送信（Phase 5b） ────────────────────────────────────
  /**
   * この端末に溜まっている書き込みが、すべてサーバーに届くまで待つ。
   *
   * **これが無いと「未送信」の印が消えない。** 読みは一回読み
   * （`listRecords` / `listVisitRows`）なので、電波が戻って SDK が
   * 溜めていた書き込みを送り終えても、**画面が取り直す契機が無い**。
   * 記録は届いているのに行は「未送信」「送信待ち」のままになり、
   * その行だけ承認できない状態が残る。
   *
   * 購読（`onSnapshot`）にすれば届くが、訪問先で画面を開いている間
   * ずっと接続することになる（このファイル冒頭と `firestoreAdapter` の
   * 注記を参照）。待つだけなら接続は増えない。
   *
   * 未送信が無ければ即座に解決する。`localStorage` 実装は送信という段階が
   * 無いので常に即解決になる。
   */
  waitForPendingWrites(): Promise<void>;

  /**
   * 前回のセッションで送りきれなかった書き込みの答え合わせをする。
   *
   * **`waitForPendingWrites()` では足りない。** 圏外で保存 → アプリを閉じる →
   * 翌朝の起動で SDK が再送 → 権限拒否、の経路では、書き込みの失敗を受け取る
   * `.catch` を付けた主体がもう居ない。Firestore はローカルの書き込みを
   * 黙って巻き戻すため、**職員には「保存したはずの記録が消えた」としか見えない**。
   * 記録は法定文書であり、消えたことに気づけない状態を残さない。
   *
   * ログインが済んだあとに1度だけ呼ぶ。巻き戻りが見つかれば
   * `onWriteFailure` と同じ経路で画面に出す。
   *
   * `localStorage` 実装は送信という段階が無いので何もしない。
   */
  reconcileOutbox(): Promise<void>;
}
