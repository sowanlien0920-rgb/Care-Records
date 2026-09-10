/*
 * アプリ全体のデータと操作を保持する Context。
 *
 * kpi-react の useFirestore() が「購読 → useState → 画面」の形を確立しているので、
 * それと同形にしている（src/hooks/useFirestore.js）。Phase 5 で firestoreAdapter に
 * 差し替えるとき、実装を参照できるようにするため。
 *
 * UI から localStorage を直接触らせないことがこの層の目的になる。
 *
 * ── loading を state に持たない理由 ──────────────────────
 * 取得結果は「どの条件で取ったか」を表すキーと一緒に保持し、
 * いま必要なキーと一致しなければ loading とみなす。
 * effect の中で同期的に setState すると React 19 では余分な再描画を招き、
 * 条件が変わった直後に前の条件の結果が一瞬見えることもある。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AdapterError, type DataAdapter } from '../data/adapter';
import { CareStoreContext, type Async, type CareStore } from './context';
import { localAdapter } from '../data/localAdapter';
import { iso } from '../utils/date';
import type { Dispatch, VisitRecord } from '../types/contract';
import type { StaffAccount } from '../types/local';

/** 取得結果を、取得条件のキーと一緒に持つ */
type Keyed<T> = { key: string; result: Extract<Async<T>, { status: 'error' | 'ready' }> };

function toAsyncError(e: unknown): Extract<Async<never>, { status: 'error' }> {
  if (e instanceof AdapterError) {
    return { status: 'error', message: e.userMessage, kind: e.kind };
  }
  // 内部のエラー文言をそのまま利用者に見せない
  return { status: 'error', message: '予期しないエラーが発生しました。', kind: 'storage' };
}

/** キーが一致していれば結果を、していなければ loading を返す */
function resolve<T>(keyed: Keyed<T> | null, key: string): Async<T> {
  return keyed !== null && keyed.key === key ? keyed.result : { status: 'loading' };
}

export function CareStoreProvider({
  children,
  adapter = localAdapter,
}: {
  children: ReactNode;
  adapter?: DataAdapter;
}) {
  const [date, setDate] = useState(() => iso(new Date()));
  const [staffId, setStaffId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [staffKeyed, setStaffKeyed] = useState<Keyed<StaffAccount[]> | null>(null);
  const [dispatchKeyed, setDispatchKeyed] = useState<Keyed<Dispatch | null> | null>(null);
  const [recordsKeyed, setRecordsKeyed] = useState<Keyed<VisitRecord[]> | null>(null);

  const [notification, setNotification] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  const staffKey = `${reloadToken}`;
  const scopedKey = `${reloadToken}|${date}|${staffId ?? ''}`;

  // 職員一覧
  useEffect(() => {
    let alive = true;
    adapter.listStaff()
      .then((data) => { if (alive) setStaffKeyed({ key: staffKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setStaffKeyed({ key: staffKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, staffKey]);

  // 配信
  useEffect(() => {
    if (staffId === null) return;
    let alive = true;
    adapter.getDispatch(date, staffId)
      .then((data) => { if (alive) setDispatchKeyed({ key: scopedKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setDispatchKeyed({ key: scopedKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, date, staffId, scopedKey]);

  // 実施記録
  useEffect(() => {
    if (staffId === null) return;
    let alive = true;
    adapter.listRecords(date, staffId)
      .then((data) => { if (alive) setRecordsKeyed({ key: scopedKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setRecordsKeyed({ key: scopedKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, date, staffId, scopedKey]);

  const saveRecord = useCallback(async (record: VisitRecord): Promise<boolean> => {
    try {
      await adapter.saveRecord(record);
      const data = await adapter.listRecords(record.date, record.staffId);
      setRecordsKeyed({ key: `${reloadToken}|${record.date}|${record.staffId}`, result: { status: 'ready', data } });
      return true;
    } catch (e) {
      notify(e instanceof AdapterError ? e.userMessage : '保存に失敗しました。');
      return false;
    }
  }, [adapter, notify, reloadToken]);

  // 職員未選択のときは取得そのものが起きないので、待たせずに空を返す。
  // 毎描画で新しいオブジェクトを作ると Context の値が変わり全体が再描画されるため memo する。
  const staff = useMemo(() => resolve(staffKeyed, staffKey), [staffKeyed, staffKey]);
  const dispatch = useMemo<Async<Dispatch | null>>(
    () => (staffId === null ? { status: 'ready', data: null } : resolve(dispatchKeyed, scopedKey)),
    [staffId, dispatchKeyed, scopedKey],
  );
  const records = useMemo<Async<VisitRecord[]>>(
    () => (staffId === null ? { status: 'ready', data: [] } : resolve(recordsKeyed, scopedKey)),
    [staffId, recordsKeyed, scopedKey],
  );

  const value = useMemo<CareStore>(() => ({
    date, setDate,
    staffId, setStaffId,
    staff, dispatch, records,
    saveRecord, retry,
    notification, notify,
  }), [date, staffId, staff, dispatch, records, saveRecord, retry, notification, notify]);

  return <CareStoreContext.Provider value={value}>{children}</CareStoreContext.Provider>;
}
