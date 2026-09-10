/*
 * Context の定義。
 * Provider コンポーネントと同じファイルに置くと Fast Refresh が効かなくなるため分けている。
 */
import { createContext } from 'react';
import type { AdapterError, BadgeCounts, RecordListing } from '../data/adapter';
import type { Dispatch, VisitRecord } from '../types/contract';
import type { StaffAccount } from '../types/local';

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

  // ── サーバーデータ ────────────────────────────────────
  staff: Async<StaffAccount[]>;
  dispatch: Async<Dispatch | null>;
  /** 読めた記録と、読み出せなかった記録。破損は隠さず利用者に見せる */
  records: Async<RecordListing>;
  /** ツールバーのバッジ件数 */
  badges: Async<BadgeCounts>;

  // ── 操作 ──────────────────────────────────────────────
  saveRecord: (record: VisitRecord) => Promise<boolean>;
  /** 失敗した取得をやり直す。error 表示から利用者が次の行動を取れるようにする */
  retry: () => void;

  /** 通知。legacy の toast() にあたる */
  notification: string | null;
  notify: (message: string) => void;
}

export const CareStoreContext = createContext<CareStore | null>(null);
