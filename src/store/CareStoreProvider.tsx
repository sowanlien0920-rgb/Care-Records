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
import { AdapterError, type BadgeCounts, type DataAdapter, type RecordListing, type VisitRow, type VisitScope } from '../data/adapter';
import { CareStoreContext, type Async, type CareStore, type PanelKind, type RecordFieldPatch } from './context';
import { localAdapter } from '../data/localAdapter';
import { iso } from '../utils/date';
import { newRecordFor, recordOf, type RecordContext } from '../domain/visitStatus';
import { stampEnd, stampStart } from '../domain/timeValidation';
import { canApprove, isSupervisor, type Incident, type RecordPrefs } from '../types/local';
import { localIncidentAdapter } from '../features/incident/incidentAdapter';
import type { Dispatch, DispatchVisit, ResidentBrief, VisitRecord, VisitStatus } from '../types/contract';
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

/** 打刻・承認の対象。記録が無ければ context から新しい記録を組み立てる */
interface MutationTarget {
  visit: DispatchVisit;
  record: VisitRecord | undefined;
  context: RecordContext;
  resident: ResidentBrief | undefined;
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
  /**
   * ログイン中の職員 ID の置き場。
   * null は「保存領域をまだ読んでいない」、{ staffId: null } は「読んだが未ログイン」。
   * 区別しないと、復元が終わる前に職員選択画面が一瞬見える。
   */
  const [sessionSlot, setSessionSlot] = useState<{ staffId: string | null } | null>(null);
  /** ヘッダーで切り替えた表示中の職員。切り替えていなければログイン中の職員を見る */
  const [pickedStaffId, setPickedStaffId] = useState<string | null>(null);
  const [filter, setFilter] = useState<VisitStatus | 'all'>('all');
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [residentModalOpen, setResidentModalOpen] = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [incidentsKeyed, setIncidentsKeyed] = useState<Keyed<Incident[]> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /** 職員一覧の再取得。retry() のときだけ進める */
  const [staffToken, setStaffToken] = useState(0);

  const [staffKeyed, setStaffKeyed] = useState<Keyed<StaffAccount[]> | null>(null);
  const [dispatchKeyed, setDispatchKeyed] = useState<Keyed<Dispatch | null> | null>(null);
  const [recordsKeyed, setRecordsKeyed] = useState<Keyed<RecordListing> | null>(null);
  const [badgesKeyed, setBadgesKeyed] = useState<Keyed<BadgeCounts> | null>(null);
  const [rowsKeyed, setRowsKeyed] = useState<Keyed<VisitRow[]> | null>(null);

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

  // 再試行は「取れなかったものを取り直す」操作なので、職員一覧も含めて全部取り直す
  const retry = useCallback(() => {
    setStaffToken((n) => n + 1);
    setReloadToken((n) => n + 1);
  }, []);

  /*
   * 職員一覧は記録の保存では変わらないので、記録の再取得とは別のトークンで持つ。
   *
   * reloadToken に載せると、記録を1件保存するたびに職員一覧が loading に戻り、
   * session（保存した ID と職員一覧から導く）が一瞬 null になる。
   * Shell は session === null を未ログインとして StaffPicker を返すため、
   * 開いているモーダルごと画面全体がアンマウントされる。
   * 未完了一覧の様子・メモの保存や、一括作成の進捗が消えるのはこれが原因だった。
   */
  const staffKey = `${staffToken}`;
  const staff = useMemo(() => resolve(staffKeyed, staffKey), [staffKeyed, staffKey]);

  /*
   * ログイン中の職員は「保存した ID」と「職員一覧」から導く。
   * 保存するのは ID だけにしてあるので、退職・権限変更が職員一覧に
   * 反映された時点で、古い権限のまま操作できる状態が残らない。
   */
  const session = useMemo<StaffAccount | null>(() => {
    const id = sessionSlot?.staffId ?? null;
    if (id === null || staff.status !== 'ready') return null;
    return staff.data.find((s) => s.staffId === id) ?? null;
  }, [sessionSlot, staff]);

  /** 保存領域の読み出しと職員一覧の照合が終わるまで、ログイン状態は判定できない */
  const sessionRestoring = sessionSlot === null
    || (sessionSlot.staffId !== null && staff.status === 'loading');

  const staffId = pickedStaffId ?? session?.staffId ?? null;

  const scopedKey = `${reloadToken}|${date}|${staffId ?? ''}`;
  // バッジはログイン中の職員が基準で、日付には依存しない
  const badgeKey = `${reloadToken}|${session?.staffId ?? ''}`;

  /*
   * 日付・職員をまたぐ一覧は「誰の分を読むか」で結果が変わる。
   * 訪問介護員は自分の分しか読めない（Phase 5 では Firestore ルールが弾く）ので、
   * 全職員分を取って画面側で隠す形にはしない。取らなければ漏れない。
   */
  const rowScope = useMemo<VisitScope | null>(() => {
    if (session === null) return null;
    // canApprove は null を除く型ガードのため、否定側で session が never に狭まる。
    // ID を先に取り出して、判定と値の取得を分けておく
    const { staffId: id } = session;
    return isSupervisor(session) || canApprove(session)
      ? { kind: 'all' }
      : { kind: 'staff', staffId: id };
  }, [session]);
  const rowsKey = `${reloadToken}|${rowScope === null ? '' : rowScope.kind === 'all' ? 'all' : rowScope.staffId}`;

  // 職員一覧
  useEffect(() => {
    let alive = true;
    adapter.listStaff()
      .then((data) => { if (alive) setStaffKeyed({ key: staffKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setStaffKeyed({ key: staffKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, staffKey]);

  // 保存済みの職員選択を復元する。Phase 5 では Firebase Auth の永続化に置き換わる
  useEffect(() => {
    let alive = true;
    adapter.getSessionStaffId()
      .then((id) => { if (alive) setSessionSlot({ staffId: id }); })
      // 復元できないことはログインを止める理由にならない。職員選択から始める
      .catch(() => { if (alive) setSessionSlot({ staffId: null }); });
    return () => { alive = false; };
  }, [adapter]);

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

  // ヒヤリハット。統合先が未定のため DataAdapter とは別経路で取る
  useEffect(() => {
    let alive = true;
    localIncidentAdapter.list()
      .then((data) => { if (alive) setIncidentsKeyed({ key: staffKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setIncidentsKeyed({ key: staffKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [staffKey]);

  // 日付・職員をまたぐ一覧
  useEffect(() => {
    if (rowScope === null) return;
    let alive = true;
    adapter.listVisitRows(rowScope)
      .then((data) => { if (alive) setRowsKeyed({ key: rowsKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setRowsKeyed({ key: rowsKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, rowScope, rowsKey]);

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
    setSessionSlot({ staffId: id });
    // ログイン直後は自分の担当を表示する。legacy/index.html:4165 と同じ
    setPickedStaffId(null);
    // 保存に失敗してもこの画面は使える。次回の再読込で選び直しになることだけ伝える
    void adapter.saveSessionStaffId(id).catch(() => notify('この端末ではログイン状態を保持できません。'));
  }, [adapter, notify]);

  const signOut = useCallback(() => {
    setSessionSlot({ staffId: null });
    setPickedStaffId(null);
    void adapter.saveSessionStaffId(null).catch(() => notify('ログイン状態の消去に失敗しました。'));
  }, [adapter, notify]);

  const setStaffId = useCallback((id: string) => setPickedStaffId(id), []);


  // 職員未選択のときは取得そのものが起きないので、待たせずに空を返す。
  // 毎描画で新しいオブジェクトを作ると Context の値が変わり全体が再描画されるため memo する。
  const incidents = useMemo(() => resolve(incidentsKeyed, staffKey), [incidentsKeyed, staffKey]);
  const visitRows = useMemo<Async<VisitRow[]>>(
    () => (rowScope === null ? { status: 'ready', data: [] } : resolve(rowsKeyed, rowsKey)),
    [rowScope, rowsKeyed, rowsKey],
  );
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
   * visitId から、打刻・承認の対象を解決する。
   *
   * 表示中の配信を先に見て、無ければ日付・職員をまたぐ一覧から探す。
   * 未承認一覧と未完了の訪問は別の日・別の職員の行を並べるため、
   * 表示中の配信だけを見ると、そこからの操作が黙って失敗する。
   */
  const findTarget = useCallback((visitId: string): MutationTarget | null => {
    const plan = dispatch.status === 'ready' ? dispatch.data : null;
    const visit = plan?.visits.find((v) => v.visitId === visitId);
    if (plan !== null && visit !== undefined) {
      const list = records.status === 'ready' ? records.data.records : [];
      return {
        visit,
        record: recordOf(visitId, list),
        // Dispatch は RecordContext の4項目をそのまま持つ
        context: plan,
        resident: plan.residents.find((r) => r.residentId === visit.residentId),
      };
    }
    const row = visitRows.status === 'ready'
      ? visitRows.data.find((r) => r.visit.visitId === visitId)
      : undefined;
    if (row === undefined) return null;
    return {
      visit: row.visit,
      record: row.record,
      context: { facilityId: row.facilityId, date: row.date, staffId: row.staffId, staffName: row.staffName },
      resident: row.resident,
    };
  }, [dispatch, records, visitRows]);

  /**
   * 記録を1件書き換える。存在しなければ配信から作る。
   * 一覧の打刻・承認はすべてここを通す。
   *
   * 戻り値は「保存できたか」。呼び出し側が結果を見ずに成功を通知すると、
   * 保存されていない打刻・承認が成功として利用者に伝わる。
   */
  const mutateRecord = useCallback(async (
    visitId: string,
    change: (record: VisitRecord) => VisitRecord | { error: string },
  ): Promise<boolean> => {
    const target = findTarget(visitId);
    if (target === null) {
      // 取得中と「本当に無い」を同じ文言にすると、待てば済むことが伝わらない
      const loading = dispatch.status === 'loading' || visitRows.status === 'loading';
      notify(loading ? '読み込み中です。少し待ってからもう一度お試しください。' : '対象の訪問が見つかりません。');
      return false;
    }
    const current = target.record ?? newRecordFor(target.visit, target.context, target.resident);
    const next = change(current);
    if ('error' in next) { notify(next.error); return false; }

    return saveRecord({ ...next, updatedAt: new Date().toISOString() });
  }, [findTarget, dispatch, visitRows, notify, saveRecord]);

  /*
   * 記録の一部だけを書き換える。打刻・承認と同じ mutateRecord を通すことで、
   * 「記録が無ければ配信から作る」「updatedAt を打つ」を重複して書かずに済ませる。
   */
  const updateRecordFields = useCallback(async (
    visitId: string,
    patch: RecordFieldPatch,
  ): Promise<boolean> => mutateRecord(visitId, (r) => ({ ...r, ...patch })), [mutateRecord]);

  const stampStartAt = useCallback(async (visitId: string) => {
    let message = '';
    const ok = await mutateRecord(visitId, (r) => {
      const res = stampStart(r.plannedStart, r.plannedEnd);
      if (!res.ok) return { error: res.message };
      message = res.message;
      return { ...r, actualStart: res.time };
    });
    // 保存できていない打刻を「記録しました」と伝えない
    if (ok) notify(message);
  }, [mutateRecord, notify]);

  const stampEndAt = useCallback(async (visitId: string) => {
    let message = '';
    const ok = await mutateRecord(visitId, (r) => {
      const res = stampEnd(r.plannedStart, r.plannedEnd, r.actualStart);
      if (!res.ok) return { error: res.message };
      message = res.message;
      // legacy/index.html:3144。終了の打刻で状態が「済」になる
      return { ...r, actualEnd: res.time, status: '済' as const };
    });
    if (ok) notify(message);
  }, [mutateRecord, notify]);

  const approveVisit = useCallback(async (visitId: string): Promise<boolean> => {
    const me = session;
    // legacy は権限が無いとき代理承認者の認証モーダルを出す（requireAdmin、:4306）。
    // Phase 1a は簡易ログインのため、その導線はステップ6以降で用意する
    if (!canApprove(me)) { notify('承認権限がありません。'); return false; }
    const ok = await mutateRecord(visitId, (r) => ({
      ...r,
      status: '完了' as const,
      approvedBy: me.staffId,
      approvedByName: me.name,
      approvedAt: new Date().toISOString(),
    }));
    // 承認は誰がいつ承認したかを残す法定要件のある操作になる。
    // 保存できていないのに「承認しました」と伝えると、承認漏れに気づけない
    if (ok) notify('承認しました（完了）');
    return ok;
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
  const openPanel = useCallback((p: PanelKind) => setPanel(p), []);
  const closePanel = useCallback(() => setPanel(null), []);

  const saveIncident = useCallback(async (incident: Incident): Promise<boolean> => {
    try {
      await localIncidentAdapter.save(incident);
    } catch (e) {
      notify(e instanceof AdapterError ? e.userMessage : '報告の保存に失敗しました。');
      return false;
    }
    setReloadToken((n) => n + 1);
    return true;
  }, [notify]);

  const openResident = useCallback((residentId: string | null) => {
    setSelectedResidentId(residentId);
    setResidentModalOpen(true);
  }, []);
  const closeResident = useCallback(() => setResidentModalOpen(false), []);

  const approveAllToday = useCallback(async () => {
    const me = session;
    if (!canApprove(me)) { notify('承認権限がありません。'); return; }
    const list = records.status === 'ready' ? records.data.records : [];
    const plan = dispatch.status === 'ready' ? dispatch.data : null;
    const ids = new Set(plan?.visits.map((v) => v.visitId) ?? []);
    // legacy/index.html:1824。対象はその日その職員の「済」。絞り込みは無視する
    const targets = list.filter((r) => ids.has(r.visitId) && r.status === '済');
    if (targets.length === 0) { notify('承認できる「済」の記録がありません'); return; }
    if (!window.confirm(`「済」${targets.length}件を承認して完了にします。よろしいですか？`)) return;

    // legacy は全件で同じタイムスタンプを使う（:1828）
    const at = new Date().toISOString();
    let done = 0;
    let failure: string | null = null;
    for (const r of targets) {
      try {
        await adapter.saveRecord({
          ...r, status: '完了', approvedBy: me.staffId, approvedByName: me.name, approvedAt: at,
          updatedAt: at,
        });
        done += 1;
      } catch (e) {
        // 途中で失敗しても、そこまでに承認できた分は残す。
        // 件数を偽らずに伝えることが、承認漏れに気づける唯一の手がかりになる
        failure = e instanceof AdapterError ? e.userMessage : '保存に失敗しました。';
        break;
      }
    }
    setReloadToken((n) => n + 1);
    notify(failure === null
      ? `${done}件を承認しました（承認者：${me.name}）`
      : `${done}件を承認しましたが、残り${targets.length - done}件は承認できませんでした。${failure}`);
  }, [adapter, session, records, dispatch, notify]);

  const value = useMemo<CareStore>(() => ({
    date, setDate,
    session, sessionRestoring, signIn, signOut,
    staffId, setStaffId,
    filter, setFilter,
    editingVisitId, openRecord, closeRecord,
    residentModalOpen, selectedResidentId, openResident, closeResident,
    staff, dispatch, records, badges, visitRows,
    saveRecord, deleteRecord, updateRecordFields, getPrefs, savePrefs,
    incidents, saveIncident,
    panel, openPanel, closePanel,
    stampStartAt, stampEndAt, approveVisit, approveAllToday,
    retry,
    notification, notify,
  }), [
       date, session, sessionRestoring, signIn, signOut, staffId, setStaffId, filter,
       editingVisitId, openRecord, closeRecord, residentModalOpen, selectedResidentId, openResident,
       closeResident, staff, dispatch, records, badges, visitRows,
       saveRecord, deleteRecord, updateRecordFields, getPrefs, savePrefs, incidents, saveIncident,
       panel, openPanel, closePanel, stampStartAt, stampEndAt, approveVisit,
       approveAllToday, retry, notification, notify
  ]);

  return <CareStoreContext.Provider value={value}>{children}</CareStoreContext.Provider>;
}
