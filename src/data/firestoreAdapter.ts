/*
 * DataAdapter の Firestore 実装。
 *
 * 計画書: docs/plans/2026-09-14-carerecords-phase5a-firestore.md
 *
 * ── 置き場所 ──────────────────────────────────────────────
 *   facilities/{fid}/dispatches/{date}_{staffId}   kpi-react が書く（Phase 4）。読み取りのみ
 *   facilities/{fid}/visitRecords/{visitId}        carerecords が書く
 *   facilities/{fid}/recordPrefs/{residentId}      carerecords が書く（Phase 5a で新設）
 *   facilities/{fid}/auditLogs/{logId}             carerecords が書く（Phase 5a で新設）
 *   users/{uid}                                    ロールと施設。Phase 3 が書く
 *
 * **`facilities/{fid}/staffs` は読まない。** あちらは kpi-react の職員マスタで、
 * 雇用形態・入職日・退職日・**退職理由**・休職状況・保有資格・勤務希望まで入っている
 * （`kpi-react/src/pages/StaffPage.jsx:41-60`）。carerecords が要るのは氏名とロールの
 * 2つだけなのに、Firestore のクライアント SDK はドキュメント単位でしか絞れないため、
 * read を開けると全部見えてしまう（`docs/security/2026-09-14-audit.md` の High）。
 * 氏名とロールは `users/{uid}` にもあり、あちらは人事情報を持たない。
 *
 * **トップレベルの `auditLogs` には書かない。** あちらは kpi-react の変更履歴で、
 * 形も用途も違う。同じコレクションに混ぜると kpi-react の履歴画面に
 * carerecords の行が混入する。施設配下に分けておく。
 *
 * ── 購読ではなく一回読みにしている ────────────────────────
 * `DataAdapter` が Promise を返す形で確定しているため、onSnapshot にすると
 * インターフェースごと変わり、差し替えの意味が消える。加えて訪問先で使うアプリで、
 * 画面を開いている間の常時接続は電池と通信量に直結する。
 *
 * ── 書き込みはサーバー到達を待たない（Phase 5b）────────────
 * `setDoc` が返す Promise は**サーバーに届いて初めて解決する**。オフライン永続化を
 * 有効にしても変わらないため、圏外で `await` すると Promise は解決せず
 * **画面が「保存中」のまま固まる**。訪問先で記録を付けられるようにする、という
 * Phase 5b の目的がそのまま達成できない。
 *
 * そこで書き込みは**端末に入った時点で成功として返す**（`writeInBackground`）。
 * 永続キャッシュに入っていれば電波復帰後に自動で送られ、それまでは
 * `hasPendingWrites` が立つので画面に「未送信」が出る。
 *
 * **後から返る失敗を握り潰さない。** 権限拒否などはサーバーが見たときに初めて分かり、
 * そのとき Firestore はローカルの書き込みを**巻き戻す**。黙っていると
 * 「保存したはずの記録が消える」ことになるため、`onWriteFailure` で画面に伝える。
 *
 * ── 権限はここで担保しない ────────────────────────────────
 * 絞り込みはクエリとルールの両方で行うが、**最終的な防壁はルール側**にある
 * （kpi-react の firestore.rules）。ここでの絞り込みは通信量と表示のためであり、
 * これを外しても他人の記録が読めてはならない。
 */
import {
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs,
  query, setDoc, waitForPendingWrites, where, type QueryConstraint,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { signOut } from 'firebase/auth';
import { z } from 'zod';
import { auth, db } from '../firebase';
import {
  AdapterError, type BadgeCounts, type DataAdapter, type RecordListing,
  type VisitRow, type VisitScope,
} from './adapter';
import { parseDispatch, parseVisitRecord, type Dispatch, type VisitRecord } from '../types/contract';
import {
  auditLogSchema, blankRecordPrefs, recordPrefsSchema,
  type AuditLog, type RecordPrefs, type StaffAccount,
} from '../types/local';
import { iso } from '../utils/date';
import { recordOf, todoStage } from '../domain/visitStatus';

/**
 * 署名済みの職員。`users/{uid}` が正であり、ルールもここを見て判定する。
 * 施設内の `staffs` は表示用のマスタで、権限の根拠にはしない。
 */
const profileSchema = z.object({
  facilityId: z.string().min(1),
  staffId: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['facility', 'supervisor', 'helper']),
  canApprove: z.boolean().default(false),
});
type Profile = z.infer<typeof profileSchema> & { uid: string };

/** ルールのロール → 画面に出す日本語ロール。`toRuleRole()` の逆写像になる */
const RULE_TO_ROLE = {
  facility: '管理者',
  supervisor: 'サービス提供責任者',
  helper: '訪問介護員',
} as const;

/**
 * Firestore の失敗を AdapterError に寄せる。
 *
 * `permission-denied` を 'unknown' に丸めない。利用者にとって
 * 「権限が無い」と「一時的に繋がらない」は取るべき行動が違う
 * （前者は事業所に連絡、後者は再試行）。
 */
function wrap(e: unknown, userMessage: string): AdapterError {
  if (e instanceof AdapterError) return e;
  const code = e instanceof FirebaseError ? e.code : '';
  if (code === 'permission-denied') {
    return new AdapterError('forbidden', 'この操作を行う権限がありません。事業所にご確認ください。', code);
  }
  if (code === 'unauthenticated') {
    return new AdapterError('forbidden',
      'ログインの有効期限が切れました。もう一度ログインしてください。', code);
  }
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'cancelled') {
    return new AdapterError('network', '通信に失敗しました。電波の状況をご確認ください。', code);
  }
  /*
   * 複合インデックスが無いときに返る。開発者にしか直せないので、
   * 利用者に「再試行」を促しても意味が無い。'unknown' に丸めると
   * 「予期しないエラー」になり、原因の切り分けができなくなる。
   */
  if (code === 'failed-precondition') {
    return new AdapterError('contract',
      'この一覧をこの端末から取得できません。事業所にご連絡ください。', code);
  }
  return new AdapterError('unknown', userMessage, code || String(e));
}

/**
 * 後から返る書き込みの失敗を画面に伝える口。
 *
 * アダプタは通知の手段を持たない（持たせると UI に依存して差し替えられなくなる）。
 * `CareStoreProvider` がここに1つだけ登録する。
 */
type WriteFailureHandler = (message: string) => void;
let writeFailureHandler: WriteFailureHandler | null = null;

export function onWriteFailure(handler: WriteFailureHandler | null): void {
  writeFailureHandler = handler;
}

/**
 * 端末に書けた時点で成功として返し、サーバー確定は待たない。
 *
 * `navigator.onLine` では分岐しない。地下や電波の弱い訪問先では
 * `onLine` が true のまま通信できないことがあり、判断の根拠にならない。
 * オンラインなら数十ミリ秒で送られ、圏外なら溜まる。どちらも同じ経路でよい。
 *
 * 同期的に投げる失敗（値の形が Firestore で扱えない等）はここで捕まえて投げ直す。
 * 保存した本人がその場で直せるのはこちらだけになる。
 */
function writeInBackground(
  run: () => Promise<void>, userMessage: string, failureMessage: string,
): void {
  let pending: Promise<void>;
  try {
    pending = run();
  } catch (e) {
    throw wrap(e, userMessage);
  }
  pending.catch((e: unknown) => {
    const err = wrap(e, userMessage);
    console.error('[carerecords] 送信できませんでした', err);
    writeFailureHandler?.(`${failureMessage}（${err.userMessage}）`);
  });
}

/*
 * 署名済み職員の情報は1回の操作中に何度も要る（ほぼ全メソッドが facilityId を使う）。
 * uid ごとに覚えておき、uid が変われば捨てる。ログアウト → 別の職員でログイン、を
 * 跨いで古い施設を掴んだままにしないため。
 */
let cachedProfile: Profile | null = null;

async function requireProfile(): Promise<Profile> {
  const user = auth.currentUser;
  if (!user) {
    throw new AdapterError('forbidden', 'ログインの有効期限が切れました。もう一度ログインしてください。');
  }
  if (cachedProfile && cachedProfile.uid === user.uid) return cachedProfile;

  let snap;
  try {
    snap = await getDoc(doc(db, 'users', user.uid));
  } catch (e) {
    throw wrap(e, '職員の情報を読み込めませんでした。');
  }
  if (!snap.exists()) {
    // アカウントは作れたが users が書けなかった場合にここへ来る。
    // 「パスワードが違う」と区別して、事業所が原因を追えるようにする
    throw new AdapterError('forbidden',
      'このアカウントには職員の情報が登録されていません。事業所にご連絡ください。');
  }
  const parsed = profileSchema.safeParse(snap.data());
  if (!parsed.success) {
    throw new AdapterError('contract', '職員の情報の形式が正しくありません。事業所にご連絡ください。',
      z.prettifyError(parsed.error));
  }
  cachedProfile = { ...parsed.data, uid: user.uid };
  return cachedProfile;
}

/** ログアウト時に呼ぶ。呼ばないと次の職員が前の施設を見る */
export function clearProfileCache(): void {
  cachedProfile = null;
}

function validateDispatch(raw: unknown): Dispatch {
  const parsed = parseDispatch(raw);
  if (parsed.ok) return parsed.value;
  if (parsed.violation.kind === 'schema-version') {
    throw new AdapterError('contract',
      'この端末では読み込めない形式の予定です。アプリを最新版に更新してください。',
      `schemaVersion expected=${parsed.violation.expected} actual=${String(parsed.violation.actual)}`);
  }
  throw new AdapterError('contract', '予定の形式が正しくありません。事業所に連絡してください。',
    parsed.violation.message);
}

/**
 * 読んだ記録の1件。
 *
 * `pending` は「この端末で書いたが、まだサーバーに届いていない」という意味になる
 * （Phase 5b）。圏外で保存したものと、送信の途中のものが該当する。
 */
interface RawRecord { data: unknown; pending: boolean }

/** 読めた記録と読めなかった記録を分ける。localAdapter と同じ扱いにする */
function splitRecords(raws: RawRecord[]): {
  records: VisitRecord[];
  unreadable: RecordListing['unreadable'];
  pendingVisitIds: string[];
} {
  const records: VisitRecord[] = [];
  const unreadable: RecordListing['unreadable'] = [];
  const pendingVisitIds: string[] = [];
  for (const raw of raws) {
    const parsed = parseVisitRecord(raw.data);
    if (parsed.ok) {
      records.push(parsed.value);
      if (raw.pending) pendingVisitIds.push(parsed.value.visitId);
      continue;
    }
    const idOnly = z.object({ visitId: z.string().min(1) }).safeParse(raw.data);
    unreadable.push({
      visitId: idOnly.success ? idOnly.data.visitId : null,
      reason: parsed.violation.kind === 'shape' ? parsed.violation.message : 'schemaVersion 不一致',
    });
  }
  return { records, unreadable, pendingVisitIds };
}

/*
 * 未送信かどうかは一回読みの結果にも付いてくる（`metadata.hasPendingWrites`）。
 * 購読を増やさずに取れるので、Phase 5a の「onSnapshot にしない」判断は崩れない。
 */
async function fetchRecords(fid: string, constraints: QueryConstraint[]): Promise<RawRecord[]> {
  const snap = await getDocs(query(collection(db, 'facilities', fid, 'visitRecords'), ...constraints));
  return snap.docs.map((d) => ({ data: d.data(), pending: d.metadata.hasPendingWrites }));
}

export const firestoreAdapter: DataAdapter = {
  /**
   * 職員一覧。職員切替の選択肢と、ログイン中の職員の判定に使う。
   *
   * 読む先は `users`。kpi-react の `staffs` には人事情報が入っており、
   * 氏名とロールのために開けるには広すぎる（このファイル冒頭の注記を参照）。
   * `users` は `{role, facilityId, staffId, name, loginId, loginNo, canApprove}` だけで、
   * ちょうど `StaffAccount` に必要なものが揃っている。
   *
   * **訪問介護員は自分の1件しか返さない。** 職員切替は
   * サービス提供責任者以上のものであり（`features/shell/Header.tsx` の `disabled={!sup}`）、
   * ヘルパーが他人の一覧を必要とする画面は無い。読まなければ漏れない。
   *
   * 承認権限も `users` から取れるようになった。以前は他人を一律 `canApprove: false` と
   * していたが、これは `staffs` にその情報が無かったための埋め合わせだった。
   *
   * 無効化されたアカウントは `users` のドキュメントごと消える
   * （kpi-react の `AccountPage.jsx` の `handleRevoke`）ため、
   * `leaveDate` / `transferDate` による絞り込みは要らない。
   */
  async listStaff(): Promise<StaffAccount[]> {
    const me = await requireProfile();
    const mine: StaffAccount = {
      staffId: me.staffId,
      name: me.name,
      role: RULE_TO_ROLE[me.role],
      canApprove: me.canApprove,
      active: true,
    };
    if (me.role === 'helper') return [mine];

    let snap;
    try {
      snap = await getDocs(query(
        collection(db, 'users'),
        // 絞り込みは kpi-react の AccountPage.jsx:75-79 と同じ形にする。
        // facilityId と role の両方で絞らないとルールが通らない
        where('facilityId', '==', me.facilityId),
        where('role', 'in', ['supervisor', 'helper']),
      ));
    } catch (e) {
      throw wrap(e, '職員の一覧を読み込めませんでした。');
    }

    const staff: StaffAccount[] = [];
    for (const d of snap.docs) {
      const parsed = profileSchema.safeParse(d.data());
      // 形が違う1件で一覧全体を落とさない。実施記録と同じ扱いにする
      if (!parsed.success) continue;
      // 自分は users の自分の行（requireProfile が読んだもの）で入れる
      if (parsed.data.staffId === me.staffId) continue;
      staff.push({
        staffId: parsed.data.staffId,
        name: parsed.data.name,
        role: RULE_TO_ROLE[parsed.data.role],
        canApprove: parsed.data.canApprove,
        active: true,
      });
    }
    staff.push(mine);
    // 施設アカウント（管理者）は role の絞り込みに入らないため、自分以外は並ばない。
    // 並び順は staffId で固定する。Firestore の返す順に任せると画面が毎回変わる
    staff.sort((a, b) => a.staffId.localeCompare(b.staffId));
    return staff;
  },

  /**
   * ログイン中の職員。
   *
   * localAdapter は localStorage を見ていたが、ここでは Firebase Auth が正になる。
   * 未ログインは異常ではないので、例外ではなく null を返す。
   */
  async getSessionStaffId(): Promise<string | null> {
    if (!auth.currentUser) return null;
    const me = await requireProfile();
    return me.staffId;
  },

  async saveSessionStaffId(staffId: string | null): Promise<void> {
    if (staffId === null) {
      clearProfileCache();
      try {
        await signOut(auth);
      } catch (e) {
        throw wrap(e, 'ログアウトに失敗しました。');
      }
      return;
    }
    /*
     * Firebase Auth では「誰としてログインしているか」を後から差し替えられない。
     * 他人の staffId を渡された場合、黙って無視すると別人として記録を書きかねないので、
     * 明示的に弾く。職員切替は表示の切替であって、ログインの切替ではない。
     */
    const me = await requireProfile();
    if (me.staffId !== staffId) {
      throw new AdapterError('forbidden', '他の職員としてログインし直すことはできません。');
    }
  },

  async getDispatch(date: string, staffId: string): Promise<Dispatch | null> {
    const me = await requireProfile();
    let snap;
    try {
      snap = await getDoc(doc(db, 'facilities', me.facilityId, 'dispatches', `${date}_${staffId}`));
    } catch (e) {
      throw wrap(e, '予定を読み込めませんでした。');
    }
    // 配信が無いことは正常な結果であり、契約違反でも権限の問題でもない
    if (!snap.exists()) return null;
    return validateDispatch(snap.data());
  },

  async listRecords(date: string, staffId?: string): Promise<RecordListing> {
    const me = await requireProfile();
    const constraints: QueryConstraint[] = [where('date', '==', date)];
    if (staffId !== undefined) constraints.push(where('staffId', '==', staffId));
    try {
      return splitRecords(await fetchRecords(me.facilityId, constraints));
    } catch (e) {
      throw wrap(e, '記録を読み込めませんでした。');
    }
  },

  async saveRecord(record: VisitRecord): Promise<void> {
    const me = await requireProfile();
    const parsed = parseVisitRecord(record);
    if (!parsed.ok) {
      throw new AdapterError('contract', '記録の内容が正しくありません。入力を確認してください。',
        parsed.violation.kind === 'shape' ? parsed.violation.message : 'schemaVersion 不一致');
    }
    writeInBackground(
      () => setDoc(
        doc(db, 'facilities', me.facilityId, 'visitRecords', parsed.value.visitId),
        parsed.value,
      ),
      '記録を保存できませんでした。',
      '記録を送信できませんでした。もう一度保存してください。',
    );
  },

  async deleteRecord(visitId: string): Promise<void> {
    const me = await requireProfile();
    writeInBackground(
      () => deleteDoc(doc(db, 'facilities', me.facilityId, 'visitRecords', visitId)),
      '記録を削除できませんでした。',
      '記録の削除を送信できませんでした。もう一度お試しください。',
    );
  },

  async listVisitRows(scope: VisitScope, range): Promise<VisitRow[]> {
    const me = await requireProfile();
    const dispatchConstraints: QueryConstraint[] = [];
    const recordConstraints: QueryConstraint[] = [];
    if (scope.kind === 'staff') {
      dispatchConstraints.push(where('staffId', '==', scope.staffId));
      recordConstraints.push(where('staffId', '==', scope.staffId));
    }
    if (range?.from !== undefined) {
      dispatchConstraints.push(where('date', '>=', range.from));
      recordConstraints.push(where('date', '>=', range.from));
    }
    if (range?.to !== undefined) {
      dispatchConstraints.push(where('date', '<=', range.to));
      recordConstraints.push(where('date', '<=', range.to));
    }

    try {
      const [dispatchSnap, recordRaws] = await Promise.all([
        getDocs(query(collection(db, 'facilities', me.facilityId, 'dispatches'), ...dispatchConstraints)),
        fetchRecords(me.facilityId, recordConstraints),
      ]);
      const { records, pendingVisitIds } = splitRecords(recordRaws);
      const pending = new Set(pendingVisitIds);

      const rows: VisitRow[] = [];
      for (const d of dispatchSnap.docs) {
        // 壊れた配信で一覧全体を落とさない。読めたものだけ並べる
        const parsed = parseDispatch(d.data());
        if (!parsed.ok) continue;
        const dispatch = parsed.value;
        for (const v of dispatch.visits) {
          rows.push({
            facilityId: dispatch.facilityId,
            date: dispatch.date,
            staffId: dispatch.staffId,
            staffName: dispatch.staffName,
            visit: v,
            record: recordOf(v.visitId, records),
            resident: dispatch.residents.find((r) => r.residentId === v.residentId),
            pending: pending.has(v.visitId),
          });
        }
      }
      return rows;
    } catch (e) {
      throw wrap(e, '一覧を読み込めませんでした。');
    }
  },

  /**
   * バッジ件数。
   *
   * **未承認は承認権限を持つ職員だけが数える。**
   * ルール上ヘルパーは他人の記録を読めないため、全件を数えようとすると
   * permission-denied になる。画面側も未承認一覧のボタンを
   * `canApprove` で出し分けており（`features/shell/Toolbar.tsx`）、
   * ヘルパーには表示されない。数えずに 0 を返すのが実態と一致する。
   */
  async getBadgeCounts(sessionStaffId: string): Promise<BadgeCounts> {
    const me = await requireProfile();
    const today = iso(new Date());

    try {
      // 未完了: 自分の、今日以前の配信。legacy の todoMine と同じ母集団
      const [dispatchSnap, recordRaws] = await Promise.all([
        getDocs(query(
          collection(db, 'facilities', me.facilityId, 'dispatches'),
          where('staffId', '==', sessionStaffId),
          where('date', '<=', today),
        )),
        fetchRecords(me.facilityId, [
          where('staffId', '==', sessionStaffId),
          where('date', '<=', today),
        ]),
      ]);
      const { records } = splitRecords(recordRaws);

      let todo = 0;
      for (const d of dispatchSnap.docs) {
        const parsed = parseDispatch(d.data());
        if (!parsed.ok) continue;
        for (const v of parsed.value.visits) {
          if (todoStage(v, recordOf(v.visitId, records)) >= 0) todo += 1;
        }
      }

      if (!me.canApprove) return { todo, pending: 0 };

      // 未承認: 全職員・全期間。件数だけ要るので本体は取らない
      const pendingSnap = await getCountFromServer(query(
        collection(db, 'facilities', me.facilityId, 'visitRecords'),
        where('status', '==', '済'),
      ));
      return { todo, pending: pendingSnap.data().count };
    } catch (e) {
      throw wrap(e, '件数を読み込めませんでした。');
    }
  },

  async getPrefs(residentId: string): Promise<RecordPrefs> {
    const me = await requireProfile();
    let snap;
    try {
      snap = await getDoc(doc(db, 'facilities', me.facilityId, 'recordPrefs', residentId));
    } catch (e) {
      throw wrap(e, '記録設定を読み込めませんでした。');
    }
    // 未設定は正常。既定値を返す
    if (!snap.exists()) return blankRecordPrefs();
    const parsed = recordPrefsSchema.safeParse(snap.data());
    if (!parsed.success) {
      throw new AdapterError('contract', '記録設定の形式が正しくありません。', z.prettifyError(parsed.error));
    }
    return parsed.data;
  },

  async savePrefs(residentId: string, prefs: RecordPrefs): Promise<void> {
    const me = await requireProfile();
    const parsed = recordPrefsSchema.safeParse(prefs);
    if (!parsed.success) {
      throw new AdapterError('contract', '記録設定の内容が正しくありません。', z.prettifyError(parsed.error));
    }
    writeInBackground(
      () => setDoc(doc(db, 'facilities', me.facilityId, 'recordPrefs', residentId), parsed.data),
      '記録設定を保存できませんでした。',
      '記録設定を送信できませんでした。',
    );
  },

  async listAuditLogs(): Promise<AuditLog[]> {
    const me = await requireProfile();
    let snap;
    try {
      snap = await getDocs(collection(db, 'facilities', me.facilityId, 'auditLogs'));
    } catch (e) {
      throw wrap(e, '変更履歴を読み込めませんでした。');
    }
    const logs: AuditLog[] = [];
    for (const d of snap.docs) {
      const parsed = auditLogSchema.safeParse(d.data());
      // 履歴は読めた分だけ出す。1件の破損で履歴全体を隠すと、
      // 何が起きたかを追う手段そのものが無くなる
      if (parsed.success) logs.push(parsed.data);
    }
    return logs;
  },

  async appendAuditLog(log: AuditLog): Promise<void> {
    const me = await requireProfile();
    const parsed = auditLogSchema.safeParse(log);
    if (!parsed.success) {
      throw new AdapterError('contract', '変更履歴の記録に失敗しました。', z.prettifyError(parsed.error));
    }
    writeInBackground(
      () => setDoc(
        doc(db, 'facilities', me.facilityId, 'auditLogs', parsed.data.logId),
        // uid はルールが「本人が書いたこと」を検査するために要る
        { ...parsed.data, uid: me.uid },
      ),
      '変更履歴を保存できませんでした。',
      '変更履歴を送信できませんでした。',
    );
  },

  /**
   * 溜まっている書き込みが全部サーバーに届くまで待つ（Phase 5b）。
   *
   * 圏外なら電波が戻るまで解決しない。**前回の起動で溜めた書き込みも対象になる**ので、
   * 圏外で保存 → アプリを閉じる → 翌朝に開く、の経路でも取り直しが効く。
   *
   * 職員が入れ替わると reject する（SDK の仕様）。そのときは `authToken` の方で
   * 一覧ごと取り直されるため、呼び出し側は捨ててよい。
   */
  waitForPendingWrites(): Promise<void> {
    return waitForPendingWrites(db);
  },
};
