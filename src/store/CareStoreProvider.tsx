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
import { AdapterError, type BadgeCounts, type DataAdapter, type RecordListing } from '../data/adapter';
import { CareStoreContext, type Async, type CareStore } from './context';
import { localAdapter } from '../data/localAdapter';
import { iso } from '../utils/date';
import { newRecordFor, recordOf } from '../domain/visitStatus';
import { stampEnd, stampStart } from '../domain/timeValidation';
import { canApprove, type RecordPrefs } from '../types/local';
import type { Dispatch, VisitRecord, VisitStatus } from '../types/contract';
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
  const [session, setSession] = useState<StaffAccount | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [filter, setFilter] = useState<VisitStatus | 'all'>('all');
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [residentModalOpen, setResidentModalOpen] = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [staffKeyed, setStaffKeyed] = useState<Keyed<StaffAccount[]> | null>(null);
  const [dispatchKeyed, setDispatchKeyed] = useState<Keyed<Dispatch | null> | null>(null);
  const [recordsKeyed, setRecordsKeyed] = useState<Keyed<RecordListing> | null>(null);
  const [badgesKeyed, setBadgesKeyed] = useState<Keyed<BadgeCounts> | null>(null);

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
  // バッジはログイン中の職員が基準で、日付には依存しない
  const badgeKey = `${reloadToken}|${session?.staffId ?? ''}`;

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

  // バッジ
  useEffect(() => {
    const me = session?.staffId;
    if (me === undefined) return;
    let alive = true;
    adapter.getBadgeCounts(me)
      .then((data) => { if (alive) setBadgesKeyed({ key: badgeKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setBadgesKeyed({ key: badgeKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, session, badgeKey]);

  const signIn = useCallback((id: string) => {
    const found = staffKeyed?.result.status === 'ready'
      ? staffKeyed.result.data.find((s) => s.staffId === id) ?? null
      : null;
    setSession(found);
    // ログイン直後は自分の担当を表示する。legacy/index.html:4165 と同じ
    setStaffId(found?.staffId ?? null);
  }, [staffKeyed]);

  const signOut = useCallback(() => {
    setSession(null);
    setStaffId(null);
  }, []);


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
  const badges = useMemo<Async<BadgeCounts>>(
    () => (session === null
      ? { status: 'ready', data: { todo: 0, pending: 0 } }
      : resolve(badgesKeyed, badgeKey)),
    [session, badgesKeyed, badgeKey],
  );

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

  /**
   * 記録を1件書き換える。存在しなければ配信から作る。
   * 一覧の打刻・承認はすべてここを通す。
   */
  const mutateRecord = useCallback(async (
    visitId: string,
    change: (record: VisitRecord) => VisitRecord | { error: string },
  ): Promise<void> => {
    const plan = dispatchKeyed?.result.status === 'ready' ? dispatchKeyed.result.data : null;
    const list = recordsKeyed?.result.status === 'ready' ? recordsKeyed.result.data.records : [];
    if (plan === null) { notify('予定を読み込めていません。'); return; }
    const visit = plan.visits.find((v) => v.visitId === visitId);
    if (visit === undefined) { notify('対象の訪問が見つかりません。'); return; }

    const current = recordOf(visitId, list)
      ?? newRecordFor(visit, plan, plan.residents.find((r) => r.residentId === visit.residentId));
    const next = change(current);
    if ('error' in next) { notify(next.error); return; }

    const ok = await saveRecord({ ...next, updatedAt: new Date().toISOString() });
    if (ok) setReloadToken((n) => n + 1);
  }, [dispatchKeyed, recordsKeyed, notify, saveRecord]);

  const stampStartAt = useCallback(async (visitId: string) => {
    await mutateRecord(visitId, (r) => {
      const res = stampStart(r.plannedStart, r.plannedEnd);
      if (!res.ok) return { error: res.message };
      notify(res.message);
      return { ...r, actualStart: res.time };
    });
  }, [mutateRecord, notify]);

  const stampEndAt = useCallback(async (visitId: string) => {
    await mutateRecord(visitId, (r) => {
      const res = stampEnd(r.plannedStart, r.plannedEnd, r.actualStart);
      if (!res.ok) return { error: res.message };
      notify(res.message);
      // legacy/index.html:3144。終了の打刻で状態が「済」になる
      return { ...r, actualEnd: res.time, status: '済' as const };
    });
  }, [mutateRecord, notify]);

  const approveVisit = useCallback(async (visitId: string) => {
    const me = session;
    // legacy は権限が無いとき代理承認者の認証モーダルを出す（requireAdmin、:4306）。
    // Phase 1a は簡易ログインのため、その導線はステップ6以降で用意する
    if (!canApprove(me)) { notify('承認権限がありません。'); return; }
    await mutateRecord(visitId, (r) => ({
      ...r,
      status: '完了' as const,
      approvedBy: me.staffId,
      approvedByName: me.name,
      approvedAt: new Date().toISOString(),
    }));
    notify('承認しました（完了）');
  }, [mutateRecord, session, notify]);

  const deleteRecord = useCallback(async (visitId: string): Promise<boolean> => {
    try {
      await adapter.deleteRecord(visitId);
    } catch (e) {
      notify(e instanceof AdapterError ? e.userMessage : '削除に失敗しました。');
      return false;
    }
    setReloadToken((n) => n + 1);
    return true;
  }, [adapter, notify]);

  const getPrefs = useCallback((residentId: string) => adapter.getPrefs(residentId), [adapter]);

  const savePrefs = useCallback(async (residentId: string, prefs: RecordPrefs): Promise<boolean> => {
    try {
      await adapter.savePrefs(residentId, prefs);
      return true;
    } catch (e) {
      notify(e instanceof AdapterError ? e.userMessage : '保存に失敗しました。');
      return false;
    }
  }, [adapter, notify]);

  const openRecord = useCallback((visitId: string) => setEditingVisitId(visitId), []);
  const closeRecord = useCallback(() => setEditingVisitId(null), []);
  const openResident = useCallback((residentId: string | null) => {
    setSelectedResidentId(residentId);
    setResidentModalOpen(true);
  }, []);
  const closeResident = useCallback(() => setResidentModalOpen(false), []);

  const approveAllToday = useCallback(async () => {
    const me = session;
    if (!canApprove(me)) { notify('承認権限がありません。'); return; }
    const list = recordsKeyed?.result.status === 'ready' ? recordsKeyed.result.data.records : [];
    const plan = dispatchKeyed?.result.status === 'ready' ? dispatchKeyed.result.data : null;
    const ids = new Set(plan?.visits.map((v) => v.visitId) ?? []);
    // legacy/index.html:1824。対象はその日その職員の「済」。絞り込みは無視する
    const targets = list.filter((r) => ids.has(r.visitId) && r.status === '済');
    if (targets.length === 0) { notify('承認できる「済」の記録がありません'); return; }
    if (!window.confirm(`「済」${targets.length}件を承認して完了にします。よろしいですか？`)) return;

    // legacy は全件で同じタイムスタンプを使う（:1828）
    const at = new Date().toISOString();
    for (const r of targets) {
      await adapter.saveRecord({
        ...r, status: '完了', approvedBy: me.staffId, approvedByName: me.name, approvedAt: at,
        updatedAt: at,
      });
    }
    setReloadToken((n) => n + 1);
    notify(`${targets.length}件を承認しました（承認者：${me.name}）`);
  }, [adapter, session, recordsKeyed, dispatchKeyed, notify]);

  const value = useMemo<CareStore>(() => ({
    date, setDate,
    session, signIn, signOut,
    staffId, setStaffId,
    filter, setFilter,
    editingVisitId, openRecord, closeRecord,
    residentModalOpen, selectedResidentId, openResident, closeResident,
    staff, dispatch, records, badges,
    saveRecord, deleteRecord, getPrefs, savePrefs,
    stampStartAt, stampEndAt, approveVisit, approveAllToday,
    retry,
    notification, notify,
  }), [date, session, signIn, signOut, staffId, filter,
       editingVisitId, openRecord, closeRecord, residentModalOpen, selectedResidentId, openResident, closeResident,
       staff, dispatch, records, badges,
       saveRecord, deleteRecord, getPrefs, savePrefs,
       stampStartAt, stampEndAt, approveVisit, approveAllToday,
       retry, notification, notify]);

  return <CareStoreContext.Provider value={value}>{children}</CareStoreContext.Provider>;
}
