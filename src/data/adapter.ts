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
import type { Dispatch, VisitRecord } from '../types/contract';
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

export interface DataAdapter {
  // ── 職員（Phase 5 で Firebase Auth に置き換わる） ──────────
  listStaff(): Promise<StaffAccount[]>;

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

  // ── 記録支援設定（carerecords 固有） ──────────────────────
  getPrefs(residentId: string): Promise<RecordPrefs>;
  savePrefs(residentId: string, prefs: RecordPrefs): Promise<void>;

  // ── 変更履歴 ──────────────────────────────────────────────
  listAuditLogs(): Promise<AuditLog[]>;
  appendAuditLog(log: AuditLog): Promise<void>;
}
