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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AdapterError, type DataAdapter, type RecordListing } from '../data/adapter';
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
  // 内部のエラー文言をそのまま利用者に見せない。
  // 原因が特定できていないものを 'storage' に丸めると、kind を見て
  // 「ブラウザの保存設定を確認」といった案内を出す実装が後で入ったとき、
  // 無関係な原因に誤った対処を提示することになる。
  return { status: 'error', message: '予期しないエラーが発生しました。', kind: 'unknown' };
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
  const [recordsKeyed, setRecordsKeyed] = useState<Keyed<RecordListing> | null>(null);

  const [notification, setNotification] = useState<string | null>(null);
  // 通知を連続で出したとき、前のタイマーが後の通知を早期に消さないようにする。
  // アンマウント時に残ったタイマーが setState を呼ぶことも防ぐ。
  const notifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    if (notifyTimer.current !== null) clearTimeout(notifyTimer.current);
    setNotification(message);
    notifyTimer.current = setTimeout(() => setNotification(null), 3000);
  }, []);
  useEffect(() => () => {
    if (notifyTimer.current !== null) clearTimeout(notifyTimer.current);
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
    } catch (e) {
      notify(e instanceof AdapterError ? e.userMessage : '保存に失敗しました。');
      return false;
    }
    // 保存した記録のスコープと、いま画面が見ているスコープは一致しない場合がある。
    // サービス提供責任者が未承認一覧から他職員の記録を承認する場合など。
    // 保存側のキーでキャッシュを書くと、解決に使うキーと食い違って loading から
    // 抜けられなくなるため、再取得は必ず「いま表示しているスコープ」に対して行う。
    setReloadToken((n) => n + 1);
    return true;
  }, [adapter, notify]);

  // 職員未選択のときは取得そのものが起きないので、待たせずに空を返す。
  // 毎描画で新しいオブジェクトを作ると Context の値が変わり全体が再描画されるため memo する。
  const staff = useMemo(() => resolve(staffKeyed, staffKey), [staffKeyed, staffKey]);
  const dispatch = useMemo<Async<Dispatch | null>>(
    () => (staffId === null ? { status: 'ready', data: null } : resolve(dispatchKeyed, scopedKey)),
    [staffId, dispatchKeyed, scopedKey],
  );
  const records = useMemo<Async<RecordListing>>(
    () => (staffId === null
      ? { status: 'ready', data: { records: [], unreadable: [] } }
      : resolve(recordsKeyed, scopedKey)),
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
