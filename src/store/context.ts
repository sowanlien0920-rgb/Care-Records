/*
 * Context の定義。
 * Provider コンポーネントと同じファイルに置くと Fast Refresh が効かなくなるため分けている。
 */
import { createContext } from 'react';
import type { AdapterError } from '../data/adapter';
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
  /** 表示中の職員。訪問介護員は自分から変更できない（ロール判定は画面側） */
  staffId: string | null;
  setStaffId: (staffId: string | null) => void;

  // ── サーバーデータ ────────────────────────────────────
  staff: Async<StaffAccount[]>;
  dispatch: Async<Dispatch | null>;
  records: Async<VisitRecord[]>;

  // ── 操作 ──────────────────────────────────────────────
  saveRecord: (record: VisitRecord) => Promise<boolean>;
  /** 失敗した取得をやり直す。error 表示から利用者が次の行動を取れるようにする */
  retry: () => void;

  /** 通知。legacy の toast() にあたる */
  notification: string | null;
  notify: (message: string) => void;
}

export const CareStoreContext = createContext<CareStore | null>(null);
