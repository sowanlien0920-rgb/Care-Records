/*
 * Context の定義。
 * Provider コンポーネントと同じファイルに置くと Fast Refresh が効かなくなるため分けている。
 */
import { createContext } from 'react';
import type { AdapterError, BadgeCounts, RecordListing, VisitRow } from '../data/adapter';
import type { Dispatch, VisitRecord, VisitStatus } from '../types/contract';
import type { Incident, RecordPrefs, StaffAccount } from '../types/local';

/** ツールバーから開く画面の種類 */
export type PanelKind = 'todo' | 'pending' | 'report' | 'timeline' | 'incident' | 'password';

/**
 * 非同期の4状態を型で表す。
 * success だけを実装して loading / error / empty を忘れることを防ぐため、
 * 画面側が status を分岐しないと data に触れない形にしてある。
 * （empty は error ではないので、ready かつ 0 件として表現する）
 */
export type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; kind: AdapterError['kind'] }
  | { status: 'ready'; data: T };

/**
 * 記録のうち、1項目だけを差し替えてよいフィールド。
 *
 * VisitRecord 全体を Partial で受けると、呼び出し側から visitId / schemaVersion /
 * approvedBy まで書き換えられる。承認は「誰がいつ承認したか」を残す法定要件のある
 * 操作なので、approveVisit を通さずに承認欄が書き換わる経路は作らない。
 * 対象を増やすときは、その項目を承認とは独立に上書きしてよいかを確かめる。
 */
export type RecordFieldPatch = Partial<Pick<VisitRecord, 'note' | 'noteSource' | 'mood' | 'memo'>>;

export interface CareStore {
  // ── 画面状態 ──────────────────────────────────────────
  date: string;
  setDate: (date: string) => void;

  /**
   * ログイン中の職員。Phase 1a は簡易ログイン（職員を選ぶだけ）。
   * Phase 5 で Firebase Auth に置き換わる。
   */
  session: StaffAccount | null;
  /**
   * 保存済みの職員選択を復元している最中か。
   * true の間は「未ログイン」と判定しない（職員選択が一瞬見えるのを防ぐ）。
   */
  sessionRestoring: boolean;
  /**
   * セッションを復元できなかった理由。復元できたときは null。
   *
   * `users/{uid}` 未作成・形式違反・ルールで拒否は、いずれも職員本人には
   * 直せない。ログイン画面に出さないと「パスワードを間違えた」としか見えず、
   * 同じ操作を繰り返すことになる（`docs/security/2026-09-14-audit.md`）。
   */
  sessionError: string | null;
  /**
   * 初期パスワードのままログインしたか。true の間は `PasswordModal` が
   * 強制モードで開き、変更するまで閉じられない（legacy の `mustChange`、
   * `index.html:4201`）。発行時の初期値は全アカウント共通のため、
   * 変えないまま使わせない導線がここにしか無い。
   */
  passwordChangeRequired: boolean;
  setPasswordChangeRequired: (required: boolean) => void;
  signIn: (staffId: string) => void;
  signOut: () => void;

  /**
   * 表示中の職員。サービス提供責任者以上は他職員に切り替えられる。
   * ログイン中の職員とは別物である点に注意する。統計は表示中の職員を、
   * 未完了バッジはログイン中の職員を数える（legacy の非対称をそのまま踏襲）。
   */
  staffId: string | null;
  setStaffId: (staffId: string) => void;

  /**
   * 一覧の絞り込み。'all' はキャンセルも含む（legacy/index.html:1745 と同じ）。
   * 統計とバッジはこの絞り込みの影響を受けない。
   */
  filter: VisitStatus | 'all';
  setFilter: (filter: VisitStatus | 'all') => void;

  /** 記録画面を開いている訪問。legacy の cur.editId にあたる */
  editingVisitId: string | null;
  openRecord: (visitId: string) => void;
  closeRecord: () => void;

  /**
   * 利用者マスタの開閉と、選択中の利用者。
   * 「開いているが利用者未指定（先頭を選ぶ）」を表せるよう、開閉と選択を分けている。
   */
  residentModalOpen: boolean;
  selectedResidentId: string | null;
  /** null を渡すと開いたうえで先頭の利用者を選ぶ */
  openResident: (residentId: string | null) => void;
  closeResident: () => void;

  // ── サーバーデータ ────────────────────────────────────
  staff: Async<StaffAccount[]>;
  dispatch: Async<Dispatch | null>;
  /** 読めた記録と、読み出せなかった記録。破損は隠さず利用者に見せる */
  records: Async<RecordListing>;
  /** ツールバーのバッジ件数 */
  badges: Async<BadgeCounts>;
  /** 日付・職員をまたぐ訪問と記録の一覧。未承認一覧・未完了・帳票・経過記録が使う */
  visitRows: Async<VisitRow[]>;

  // ── 操作 ──────────────────────────────────────────────
  saveRecord: (record: VisitRecord) => Promise<boolean>;
  /** 実施記録を削除する。配信（予定）は消えない */
  deleteRecord: (visitId: string) => Promise<boolean>;
  /**
   * 記録の一部だけを書き換える。記録がまだ無ければ配信から作る。
   * 未完了一覧の様子・メモのように、記録全体を組み立てずに1項目だけ保存する経路が使う。
   *
   * 戻り値は「保存できたか」。失敗の通知はここで出すので、
   * 呼び出し側は結果を見てから成功を伝える。
   */
  updateRecordFields: (visitId: string, patch: RecordFieldPatch) => Promise<boolean>;
  /** 記録支援設定の読み書き。法定文書系は kpi-react が正なのでここには含めない */
  getPrefs: (residentId: string) => Promise<RecordPrefs>;
  savePrefs: (residentId: string, prefs: RecordPrefs) => Promise<boolean>;

  /**
   * ヒヤリハット・事故報告。
   * 統合先が未定のため DataAdapter とは別の境界（incidentAdapter）に置いている。
   * 詳細は src/features/incident/incidentAdapter.ts を参照。
   */
  incidents: Async<Incident[]>;
  saveIncident: (incident: Incident) => Promise<boolean>;

  /** ツールバーから開く画面。null なら何も開いていない */
  panel: PanelKind | null;
  openPanel: (panel: PanelKind) => void;
  closePanel: () => void;
  /** 開始を打刻する。予定終了を過ぎていたら打刻せずメッセージだけ返す */
  stampStartAt: (visitId: string) => Promise<void>;
  /** 終了を打刻する。状態が「済」になる */
  stampEndAt: (visitId: string) => Promise<void>;
  /**
   * 承認して「完了」にする。承認者を記録に残す（法定要件）。
   * 戻り値は「保存できたか」。呼び出し側は結果を見てから通知する。
   */
  approveVisit: (visitId: string) => Promise<boolean>;
  /** その日の「済」をまとめて承認する。絞り込みの影響を受けない */
  approveAllToday: () => Promise<void>;
  /** 失敗した取得をやり直す。error 表示から利用者が次の行動を取れるようにする */
  retry: () => void;

  /** 通知。legacy の toast() にあたる */
  notification: string | null;
  notify: (message: string) => void;
}

export const CareStoreContext = createContext<CareStore | null>(null);
