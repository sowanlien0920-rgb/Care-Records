/*
 * Context の定義。
 * Provider コンポーネントと同じファイルに置くと Fast Refresh が効かなくなるため分けている。
 */
import { createContext } from 'react';
import type { AdapterError, BadgeCounts, RecordListing } from '../data/adapter';
import type { Dispatch, VisitRecord, VisitStatus } from '../types/contract';
import type { RecordPrefs, StaffAccount } from '../types/local';

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

export interface CareStore {
  // ── 画面状態 ──────────────────────────────────────────
  date: string;
  setDate: (date: string) => void;

  /**
   * ログイン中の職員。Phase 1a は簡易ログイン（職員を選ぶだけ）。
   * Phase 5 で Firebase Auth に置き換わる。
   */
  session: StaffAccount | null;
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

  // ── 操作 ──────────────────────────────────────────────
  saveRecord: (record: VisitRecord) => Promise<boolean>;
  /** 実施記録を削除する。配信（予定）は消えない */
  deleteRecord: (visitId: string) => Promise<boolean>;
  /** 記録支援設定の読み書き。法定文書系は kpi-react が正なのでここには含めない */
  getPrefs: (residentId: string) => Promise<RecordPrefs>;
  savePrefs: (residentId: string, prefs: RecordPrefs) => Promise<boolean>;
  /** 開始を打刻する。予定終了を過ぎていたら打刻せずメッセージだけ返す */
  stampStartAt: (visitId: string) => Promise<void>;
  /** 終了を打刻する。状態が「済」になる */
  stampEndAt: (visitId: string) => Promise<void>;
  /** 承認して「完了」にする。承認者を記録に残す（法定要件） */
  approveVisit: (visitId: string) => Promise<void>;
  /** その日の「済」をまとめて承認する。絞り込みの影響を受けない */
  approveAllToday: () => Promise<void>;
  /** 失敗した取得をやり直す。error 表示から利用者が次の行動を取れるようにする */
  retry: () => void;

  /** 通知。legacy の toast() にあたる */
  notification: string | null;
  notify: (message: string) => void;
}

export const CareStoreContext = createContext<CareStore | null>(null);
