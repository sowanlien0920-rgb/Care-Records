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
import type { AuditLog, Incident, RecordPrefs, StaffAccount } from '../types/local';

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
  | 'forbidden';

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

export interface DataAdapter {
  // ── 職員（Phase 5 で Firebase Auth に置き換わる） ──────────
  listStaff(): Promise<StaffAccount[]>;

  // ── 配信（読み取り専用。kpi-react が正） ──────────────────
  /** 指定日・指定職員の配信。存在しなければ null（0件は empty であって error ではない） */
  getDispatch(date: string, staffId: string): Promise<Dispatch | null>;

  // ── 実施記録（carerecords が書く） ────────────────────────
  /** staffId を省略すると事業所全体。呼び出し側でロールを確認すること */
  listRecords(date: string, staffId?: string): Promise<VisitRecord[]>;
  saveRecord(record: VisitRecord): Promise<void>;

  // ── 記録支援設定（carerecords 固有） ──────────────────────
  getPrefs(residentId: string): Promise<RecordPrefs>;
  savePrefs(residentId: string, prefs: RecordPrefs): Promise<void>;

  // ── ヒヤリハット（統合先が未定。incidentAdapter で差し替える） ──
  listIncidents(): Promise<Incident[]>;
  saveIncident(incident: Incident): Promise<void>;

  // ── 変更履歴 ──────────────────────────────────────────────
  listAuditLogs(): Promise<AuditLog[]>;
  appendAuditLog(log: AuditLog): Promise<void>;
}
