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
import { clearProfileCache, firestoreAdapter, onWriteFailure } from '../data/firestoreAdapter';
import { auth, BACKEND, offlineStorageAvailable } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
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

/**
 * 既定のアダプタを決める。
 *
 * Firestore 実装だけを静的に持ち、`localStorage` 実装は **開発時だけ**
 * 動的に読み込む。`localAdapter` は `src/data/mock.ts`（利用者の氏名・ふりがな・
 * 年齢・要介護度・世帯状況を持つ）を import しているため、静的 import のままだと
 * `VITE_BACKEND` の値に関わらずモックが本番バンドルに載り続けていた
 * （`docs/security/2026-09-14-audit.md` の Critical）。
 *
 * `import.meta.env.DEV` は本番ビルドで `false` に置換され、この分岐ごと消える。
 * 動的 import は別チャンクとしても出力されないため、モックは配信されない。
 * **この `if` を外すと、モックが再び本番に出るようになる。**
 *
 * 本番の `BACKEND` は常に `firestore`（`src/firebase.ts`）なので、
 * 本番では同期的に決まり、待ちは発生しない。
 */
function useResolvedAdapter(override: DataAdapter | undefined): DataAdapter | null {
  const [loaded, setLoaded] = useState<DataAdapter | null>(null);

  useEffect(() => {
    if (override !== undefined || BACKEND === 'firestore') return;
    let alive = true;
    if (import.meta.env.DEV) {
      void import('../data/localAdapter').then((m) => {
        if (alive) setLoaded(m.localAdapter);
      });
    }
    return () => { alive = false; };
  }, [override]);

  if (override !== undefined) return override;
  if (BACKEND === 'firestore') return firestoreAdapter;
  return loaded;
}

/**
 * アダプタが決まるまで中身を組み立てない。
 *
 * 中で null 検査を配り歩くと、取得の効果すべてに「まだ無い」経路が増える。
 * 決まってから下を作る方が、読む側にも渡す側にも分岐が残らない。
 */
export function CareStoreProvider({
  children,
  adapter,
}: {
  children: ReactNode;
  adapter?: DataAdapter;
}) {
  const resolved = useResolvedAdapter(adapter);
  // 開発時に localAdapter を読み込む一瞬だけ通る。本番では同期的に決まる
  if (resolved === null) return null;
  return <CareStore adapter={resolved}>{children}</CareStore>;
}

function CareStore({
  children,
  adapter,
}: {
  children: ReactNode;
  adapter: DataAdapter;
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
  /**
   * Firebase Auth のログイン状態が変わったことを伝えるトークン。
   *
   * localStorage 実装では「保存されている職員 ID」を1回読めば済んだが、
   * Firebase Auth では**ログインがこのコンポーネントの外で起きる**
   * （LoginForm が signInWithEmailAndPassword を呼ぶ）。
   * 購読しないと、ログインしても画面がログインフォームのまま変わらない。
   */
  const [authToken, setAuthToken] = useState(0);
  /**
   * Firebase Auth の復元が終わったか。
   *
   * `auth.currentUser` はマウント直後には必ず `null` になる。永続化の読み出しが
   * まだ終わっていないためで、未ログインを意味しない。ここを見ずに
   * `getSessionStaffId()` の結果を採用すると `sessionSlot` が
   * 「読んだが未ログイン」で確定し、**ログイン済みの職員が再読込するたびに
   * 操作可能なログイン画面が出る**（`docs/security/2026-09-14-audit.md`）。
   * そこで打ち込まれた入力は不要な再サインインになり、
   * `auth/too-many-requests` による締め出しを誘発する。
   */
  const [authResolved, setAuthResolved] = useState(BACKEND !== 'firestore');
  /**
   * Firebase Auth にサインイン中か。
   *
   * 未ログインのまま `listStaff()` を呼ぶと `users` を読む権限が無く、
   * その失敗が**誰も操作していないログイン画面に
   * 「ログインの有効期限が切れました」として出る**。初回の利用者には
   * 身に覚えのないエラーになり、再試行を押しても同じものが出続ける。
   * `local` 実装には認証が無いので、こちらは常にサインイン中として扱う。
   */
  const [signedIn, setSignedIn] = useState(BACKEND !== 'firestore');
  /** 直前の uid。初回発火を「職員の交代」と取り違えないために持つ */
  const lastUid = useRef<string | null>(null);
  /**
   * セッションを復元できなかった理由。
   *
   * `users/{uid}` 未作成・形式違反・ルールで拒否は、いずれも
   * `AdapterError.userMessage` に事業所へ伝えるべき文言が入っている。
   * 握り潰すと職員には「パスワードを間違えた」ようにしか見えず、
   * ログアウトボタンは `Shell` の中なので自力で抜ける手段も無くなる。
   */
  const [sessionError, setSessionError] = useState<string | null>(null);
  /** 初期パスワードのままログインした。`LoginForm` が立て、`PasswordModal` が降ろす */
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  /**
   * 職員が読んで消すまで残す知らせ（Phase 5b）。送信できなかった書き込みと、
   * 圏外の保存が成立しない端末であること。`notify` のトーストとは別に持つ
   * （理由は `store/context.ts` の `alerts`）。
   */
  const [alerts, setAlerts] = useState<string[]>([]);
  const pushAlert = useCallback((message: string) => {
    // 同じ失敗が続けて返ることがある。並べても職員にできることは増えない
    setAlerts((prev) => (prev.includes(message) ? prev : [...prev, message]));
  }, []);
  const dismissAlert = useCallback((index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index));
  }, []);

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
  // 未ログインのあいだは取りにいかないので、前の職員の一覧を残さず空で確定させる。
  // loading のままにすると sessionRestoring が下りず、ログイン画面が出ない
  const staff = useMemo<Async<StaffAccount[]>>(
    () => (signedIn ? resolve(staffKeyed, staffKey) : { status: 'ready', data: [] }),
    [staffKeyed, staffKey, signedIn],
  );

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

  /**
   * 保存領域の読み出しと職員一覧の照合が終わるまで、ログイン状態は判定できない。
   * Firestore では Auth の復元（`authResolved`）がその手前に1つ増える。
   */
  const sessionRestoring = !authResolved
    || sessionSlot === null
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
    // 未ログインでは読む先が無い。読みにいくと失敗がログイン画面に出る
    if (!signedIn) return;
    let alive = true;
    adapter.listStaff()
      .then((data) => { if (alive) setStaffKeyed({ key: staffKey, result: { status: 'ready', data } }); })
      .catch((e) => { if (alive) setStaffKeyed({ key: staffKey, result: toAsyncError(e) }); });
    return () => { alive = false; };
  }, [adapter, staffKey, signedIn]);

  /*
   * 前回のセッションで送りきれなかった書き込みの答え合わせ（`adapter.ts` の
   * `reconcileOutbox` の注記）。
   *
   * ログインが済んでから1度だけ走らせる。`onWriteFailure` の登録より後に
   * 呼ばれる必要があるが、effect の並び順ではなく `signedIn` の変化で決まるため、
   * 登録側（下の effect）は同じ描画で先に走る。
   *
   * 失敗しても握り潰してよい。**答え合わせができなかっただけで、記録は動かない。**
   * 控えは消していないので、次の起動でやり直される。
   */
  useEffect(() => {
    if (!signedIn) return;
    void adapter.reconcileOutbox().catch(() => { /* 次の起動でやり直す */ });
  }, [adapter, signedIn]);

  /*
   * 送信できなかった書き込みを職員に伝える（Phase 5b）。
   *
   * 圏外での保存は端末に入った時点で成功として返るため、権限拒否などは
   * その何秒も後に返る。**そのとき Firestore はローカルの書き込みを巻き戻す**ので、
   * 黙っていると「保存したはずの記録が消えている」ことになる。
   */
  useEffect(() => {
    if (BACKEND !== 'firestore') return;
    onWriteFailure((message) => {
      pushAlert(message);
      /*
       * **取り直しが要る。** 巻き戻された記録は端末にもサーバーにも無いのに、
       * 画面が持っている一覧は保存直後のまま（記録あり）になっている。
       * 取り直さないと、消えた記録が「済」のまま残り続ける。
       */
      setReloadToken((n) => n + 1);
    });
    return () => { onWriteFailure(null); };
  }, [pushAlert]);

  /*
   * 圏外の保存が成立しない端末であることを、圏外になる前に伝える（Phase 5b）。
   *
   * プライベートブラウズや容量不足では IndexedDB が開けず、SDK は黙って
   * メモリキャッシュに落ちる。そのまま圏外で保存すると行に「未送信」は出るが、
   * **タブを閉じた時点で記録ごと消える。**
   */
  useEffect(() => {
    if (BACKEND !== 'firestore') return;
    let alive = true;
    void offlineStorageAvailable.then((ok) => {
      if (!alive || ok) return;
      pushAlert('この端末では電波が切れている間の保存ができません。'
        + '電波が届く場所で記録してください。');
    });
    return () => { alive = false; };
  }, [pushAlert]);

  /*
   * Firebase Auth のログイン状態を購読する。
   *
   * 初回の復元（永続化されたセッションの読み出し）もここを通る。
   * 職員が変われば見えてよいものが変わるため、覚えている職員情報を捨て、
   * 職員一覧と取得中のものを全部取り直す。
   */
  useEffect(() => {
    if (BACKEND !== 'firestore') return;
    return onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      // 復元が済むまでは未ログインと判定させない
      setAuthResolved(true);
      setSignedIn(uid !== null);
      // 購読開始時にも必ず1回発火する。uid が変わっていないのにトークンを
      // 進めると、走り出したばかりの取得を全部やり直させることになる
      if (lastUid.current === uid) return;
      lastUid.current = uid;
      clearProfileCache();
      setSessionError(null);
      // 職員が変われば、前の職員に出していた強制変更は持ち越さない
      setPasswordChangeRequired(false);
      setAuthToken((n) => n + 1);
      setStaffToken((n) => n + 1);
      setReloadToken((n) => n + 1);
    });
  }, []);

  // 保存済みの職員選択を復元する。Firestore では Firebase Auth の永続化が担う
  useEffect(() => {
    // Auth の復元が済むまでは「未ログイン」と判定しない
    if (!authResolved) return;
    let alive = true;
    adapter.getSessionStaffId()
      .then((id) => {
        if (!alive) return;
        setSessionError(null);
        setSessionSlot({ staffId: id });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 復元できないことはログイン画面に戻す理由になるが、黙って戻さない。
        // 何が起きたかを見せないと、職員は同じ操作を繰り返すことになる
        setSessionError(e instanceof AdapterError ? e.userMessage : '職員の情報を読み込めませんでした。');
        setSessionSlot({ staffId: null });
      });
    return () => { alive = false; };
  }, [adapter, authToken, authResolved]);

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
      ? { status: 'ready', data: { records: [], unreadable: [], pendingVisitIds: [] } }
      : resolve(recordsKeyed, scopedKey)),
    [staffId, recordsKeyed, scopedKey],
  );
  const badges = useMemo<Async<BadgeCounts>>(
    () => (session === null
      ? { status: 'ready', data: { todo: 0, pending: 0 } }
      : resolve(badgesKeyed, badgeKey)),
    [session, badgesKeyed, badgeKey],
  );

  /*
   * 未送信が送られ終わったら、一覧を取り直す（Phase 5b）。
   *
   * 読みは一回読みなので、**電波が戻って SDK が送り終えても画面は気づかない**。
   * 記録は届いているのに行は「未送信」「送信待ち」のままで、その行だけ
   * 承認できない状態が残る（`adapter.ts` の `waitForPendingWrites` の注記）。
   *
   * 実施一覧と横断一覧の両方を見る。サービス提供責任者は未承認一覧から
   * 別の日の記録を扱うため、表示中の日付の外で溜まった書き込みもある。
   * `reloadToken` は実施記録・横断一覧・バッジの3つを同時に取り直すので、
   * 契機はここ1つで足りる。
   */
  const pendingSignature = [
    ...(records.status === 'ready' ? records.data.pendingVisitIds : []),
    ...(visitRows.status === 'ready'
      ? visitRows.data.filter((r) => r.pending).map((r) => r.visit.visitId)
      : []),
  ].sort().join(',');
  /** 待って取り直した顔ぶれ。同じものが残ったときに待ち直さないために持つ */
  const waitedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (pendingSignature === '') { waitedSignature.current = null; return; }
    /*
     * 待って取り直したのに同じ顔ぶれが残るなら、もう一度待っても変わらない。
     * 取得 → 未送信あり → 待つ → 取得、が途切れずに回り続けるのを止める。
     */
    if (waitedSignature.current === pendingSignature) return;
    waitedSignature.current = pendingSignature;
    let alive = true;
    adapter.waitForPendingWrites()
      .then(() => { if (alive) setReloadToken((n) => n + 1); })
      // 職員が入れ替わると reject する。そのときは authToken の側で取り直される
      .catch(() => { /* 取り直しの契機が1つ減るだけで、ほかに影響しない */ });
    return () => { alive = false; };
  }, [adapter, pendingSignature]);

  /**
   * 変更履歴を1件残す。legacy の `pushLog()`（`index.html:2968`）にあたる。
   *
   * 履歴が残せなくても、記録そのものの保存は巻き戻さない。法定文書の本体は
   * 実施記録の方であり、履歴が書けないことを理由に訪問先での記録を失わせる方が重い。
   * ただし**黙って落とさない**。残らなかったことに気づけないなら、
   * 履歴があるという前提そのものが崩れる。
   *
   * `message` に利用者の氏名を入れない。legacy は氏名を埋め込んでいたが
   * （`index.html:1982`）、改名しても履歴は書き換わらず古い氏名が残り続ける。
   * 参照は `targetId`（visitId）と `residentId` に寄せる。
   */
  const logChange = useCallback(async (
    category: string,
    targetId: string | null,
    message: string,
  ): Promise<void> => {
    try {
      await adapter.appendAuditLog({
        // 端末をまたいでも衝突しない程度の長さにする
        logId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        at: new Date().toISOString(),
        staffId: session?.staffId ?? null,
        category,
        targetId,
        message,
      });
    } catch {
      notify('操作は保存しましたが、変更履歴を残せませんでした。事業所にご連絡ください。');
    }
  }, [adapter, session, notify]);

  /**
   * その訪問の記録が既にあるか。履歴の `新規` と `更新` を分けるために見る。
   * 表示中の日付と、日付・職員をまたぐ一覧の両方を見る（`findTarget` と同じ理由）。
   */
  const recordExists = useCallback((visitId: string): boolean => {
    if (records.status === 'ready' && records.data.records.some((r) => r.visitId === visitId)) return true;
    return visitRows.status === 'ready'
      && visitRows.data.some((r) => r.visit.visitId === visitId && r.record !== undefined);
  }, [records, visitRows]);

  const saveRecord = useCallback(async (
    record: VisitRecord,
    /** 履歴の分類。省略すると記録の有無から `新規` / `更新` を決める */
    audit?: { category: string; message: string },
  ): Promise<boolean> => {
    const existed = recordExists(record.visitId);
    try {
      await adapter.saveRecord(record);
    } catch (e) {
      notify(e instanceof AdapterError ? e.userMessage : '保存に失敗しました。');
      return false;
    }
    void logChange(
      audit?.category ?? (existed ? '更新' : '新規'),
      record.visitId,
      audit?.message
        ?? `${record.serviceName} ${record.plannedStart}〜${record.plannedEnd}（利用者 ${record.residentId}）`,
    );
    // 保存した記録のスコープと、いま画面が見ているスコープは一致しない場合がある。
    // サービス提供責任者が未承認一覧から他職員の記録を承認する場合など。
    // 保存側のキーでキャッシュを書くと、解決に使うキーと食い違って loading から
    // 抜けられなくなるため、再取得は必ず「いま表示しているスコープ」に対して行う。
    setReloadToken((n) => n + 1);
    return true;
  }, [adapter, notify, logChange, recordExists]);

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
    /** 履歴の分類。打刻・承認は `更新` に丸めず、legacy と同じ粒度で残す */
    audit?: { category: string; message: string },
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

    return saveRecord({ ...next, updatedAt: new Date().toISOString() }, audit);
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
    }, { category: '更新', message: '開始時刻を記録' });
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
    }, { category: '更新', message: '終了時刻を記録（済）' });
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
    }), { category: '承認', message: `承認者：${me.name}` });
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
    // 削除は記録そのものが消えるため、履歴が唯一の痕跡になる
    void logChange('削除', visitId, '実施記録を削除');
    setReloadToken((n) => n + 1);
    return true;
  }, [adapter, notify, logChange]);

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
    /*
     * 未送信の記録は対象から外す（Phase 5b）。
     *
     * この端末にしか無い記録に承認を付けても、サ責の端末には届いていない。
     * 行の承認ボタンは「送信待ち」にして塞いであるのに、ここから一括で
     * 承認できると**画面によって承認できたりできなかったりする**ことになる。
     */
    const pending = new Set(records.status === 'ready' ? records.data.pendingVisitIds : []);
    // legacy/index.html:1824。対象はその日その職員の「済」。絞り込みは無視する
    const targets = list.filter((r) => ids.has(r.visitId) && r.status === '済' && !pending.has(r.visitId));
    if (targets.length === 0) {
      const waiting = list.filter((r) => ids.has(r.visitId) && r.status === '済' && pending.has(r.visitId)).length;
      notify(waiting > 0
        ? `未送信の記録が ${waiting} 件あります。電波が戻ってから承認してください`
        : '承認できる「済」の記録がありません');
      return;
    }
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
        void logChange('承認', r.visitId, `一括承認／承認者：${me.name}`);
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
  }, [adapter, session, records, dispatch, notify, logChange]);

  const value = useMemo<CareStore>(() => ({
    date, setDate,
    session, sessionRestoring, sessionError, signIn, signOut,
    passwordChangeRequired, setPasswordChangeRequired,
    alerts, dismissAlert,
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
       date, session, sessionRestoring, sessionError, signIn, signOut,
       passwordChangeRequired, alerts, dismissAlert, staffId, setStaffId, filter,
       editingVisitId, openRecord, closeRecord, residentModalOpen, selectedResidentId, openResident,
       closeResident, staff, dispatch, records, badges, visitRows,
       saveRecord, deleteRecord, updateRecordFields, getPrefs, savePrefs, incidents, saveIncident,
       panel, openPanel, closePanel, stampStartAt, stampEndAt, approveVisit,
       approveAllToday, retry, notification, notify
  ]);

  return <CareStoreContext.Provider value={value}>{children}</CareStoreContext.Provider>;
}
