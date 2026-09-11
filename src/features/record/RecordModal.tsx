/*
 * 記録モーダル。移植元: legacy/index.html:883-987（マークアップ）、
 * :1856-1912（開く）、:1967-1978（collect）、:1994-2060（保存・承認・削除）
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * - `.sec > h3` は直接の子セレクタで、`::after` が見出しの罫線を作る（styles.css:228-232）。
 *   .sec と h3 の間にラッパーを挟むと罫線が消える
 * - `.chk input:checked + span` は隣接兄弟セレクタ（:255）。input の直後が span でないと
 *   チェックが視覚化されない。input は opacity:0 なので「押しても何も起きない」ように見える
 * - `#fNote` は ID セレクタで min-height:118px を上書きしている（:242）。id を外すと低くなる
 * - `.memowrap`（position:relative）の中に .memo と .micmini を置く（:318-321）
 * - `.fld label` / `.fld input|select|textarea` は子孫セレクタ（:235-241）
 *
 * ── legacy に無く、ここで足したもの ─────────────────────
 * legacy はフォーカス管理・キーボード操作・aria を一切実装していない。
 * Modal 側でフォーカストラップ・Esc・復帰・role="dialog" を実装し、
 * ここではフィールド単位のエラー表示と、失敗時に入力を失わないことを担保する。
 */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { blankRecordPrefs, canApprove, isSupervisor, type RecordPrefs } from '../../types/local';
import { newRecordFor, recordOf } from '../../domain/visitStatus';
import { clampToPlan, nowHM } from '../../domain/timeValidation';
import { check, outOfPlan, NO_ISSUE_FINDING, type Finding } from '../../domain/compliance';
import { generateNote } from '../../domain/noteBuilder';
import { useSpeechInput, SPEECH_UNSUPPORTED_HINT } from '../../hooks/useSpeechInput';
import { MOOD_DEFAULT, MOOD_OPTIONS, SERVICE_OPTIONS, TASK_OPTIONS } from '../../domain/vocabulary';
import { toMin } from '../../utils/date';
import type { ServiceKind, VisitRecord, VisitStatus } from '../../types/contract';

const STATUSES: VisitStatus[] = ['未完', '済', '完了', 'キャンセル'];

/** legacy/index.html:2399-2404 と同じ表示。レベルごとにアイコンと見出し語が決まる */
const LINT_VIEW = {
  ng: { cls: 'lv-ng', ic: '✕', label: '要修正' },
  warn: { cls: 'lv-warn', ic: '!', label: '確認' },
  ok: { cls: 'lv-ok', ic: '✓', label: '' },
} as const;

/**
 * 指摘1件。`.lintitem` の直下に `.ic` / `div` / `.fixbtn` を並べる（styles.css:348-360）。
 * `.fixbtn` は border-color を currentColor で取るため、色を決めている
 * `.lv-ng` / `.lv-warn` と同じ要素の子でないと枠線の色が変わる。
 */
function LintItem({ finding, onFix }: { finding: Finding; onFix?: () => void }) {
  const v = LINT_VIEW[finding.level];
  return (
    <div className={`lintitem ${v.cls}`}>
      <span className="ic">{v.ic}</span>
      {/* legacy は <b> と本文の間が全角スペース（:2402）。半角に変えると詰まって見える */}
      <div>{v.label && <b>{v.label}</b>}{v.label && '\u3000'}{finding.message}</div>
      {finding.fix !== undefined && onFix !== undefined && (
        <button className="fixbtn" onClick={onFix}>自動修正</button>
      )}
    </div>
  );
}

/**
 * 保存・生成・記載チェックに渡す前の整形。legacy/index.html:1967-1978 の collect と同じ。
 *
 * legacy は DOM から値を集める過程で trim し、様子は select の値を必ず書いていた。
 * 通さないと「メモの末尾に空白があるだけで定型文の文型が変わる」「画面には
 * 『いつもと変わりなし』が選ばれて見えるのに記録の様子は空のまま保存される」が起きる。
 */
function collect(d: VisitRecord): VisitRecord {
  return {
    ...d,
    mood: d.mood || MOOD_DEFAULT,
    memo: d.memo.trim(),
    note: d.note.trim(),
    vitals: {
      temperature: d.vitals.temperature.trim(),
      bloodPressure: d.vitals.bloodPressure.trim(),
      pulse: d.vitals.pulse.trim(),
    },
  };
}

type FieldKey = 'plan' | 'actual';
type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * エラーを1件消す。
 * tsconfig の exactOptionalPropertyTypes が有効なので、
 * `{...x, plan: undefined}` は「キーを消す」ではなく「undefined を代入」になり通らない。
 */
function clearError(errors: FieldErrors, key: FieldKey): FieldErrors {
  const next = { ...errors };
  delete next[key];
  return next;
}

export function RecordModal() {
  const {
    editingVisitId, closeRecord, dispatch, records, session, staff,
    saveRecord, deleteRecord, openResident, getPrefs, notify,
  } = useCareStore();

  const plan = dispatch.status === 'ready' ? dispatch.data : null;
  const recs = records.status === 'ready' ? records.data.records : [];
  const visit = plan?.visits.find((v) => v.visitId === editingVisitId) ?? null;
  const resident = plan?.residents.find((r) => r.residentId === visit?.residentId);

  // 下書きは「どの訪問を開いているか」をキーにして持つ。
  // effect の中で setState すると React 19 に弾かれるうえ、
  // 入力のたびに作り直して打ち込んだ内容が消える事故も起きやすい。
  const [edit, setEdit] = useState<{ key: string; draft: VisitRecord } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  /*
   * 記載チェックの結果。null は「まだ実行していない」。
   * legacy はモーダルを開くたびに #lintBox を空にする（:1881）ので、
   * 下書きと同じく「どの訪問を開いているか」をキーにして持ち、開き直しで消えるようにする。
   */
  const [lint, setLint] = useState<{ key: string; list: Finding[] } | null>(null);
  /*
   * 記録支援設定。法定文書ではないので carerecords が持つ（types/local.ts）。
   * 記録モーダルからは Phase 1a まで一度も読んでいなかったが、定型文生成が
   * 文体と分量をここから取る。取得できるまで ✨ は押せない
   */
  const [prefs, setPrefs] = useState<{ key: string; value: RecordPrefs } | null>(null);
  /** 文体・分量の一時変更。legacy も保存せず、その回の生成にだけ効く（:1877-1879 / :2722） */
  const [style, setStyle] = useState<{ key: string; tone: RecordPrefs['tone']; length: RecordPrefs['length'] } | null>(null);
  /** 生成前の本文。legacy の undoStack は1段だけ持つ（:2203） */
  const [undo, setUndo] = useState<{ key: string; note: string; source: VisitRecord['noteSource'] } | null>(null);
  /** 生成直後に出す出所バッジ。保存済みの記録から出すぶんは noteSource から導く */
  const [badge, setBadge] = useState<{ key: string; text: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const planRef = useRef<HTMLInputElement>(null);
  const actualRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const memoRef = useRef<HTMLInputElement>(null);
  // 特記事項とメモで1つの .mic-live を共有する（legacy:3242-3243）
  const speech = useSpeechInput();

  /*
   * 記録支援設定を取りに行く。ResidentModal.tsx:48-55 と同じ形にしてある。
   * クリーンアップで alive を落とさないと、利用者を切り替えた直後に
   * 前の利用者の設定が届いて上書きする
   */
  const residentId = visit?.residentId ?? null;
  useEffect(() => {
    if (residentId === null) return;
    let alive = true;
    // 失敗したら既定値で進む。ResidentModal.tsx:48-55 と同じ。
    // 握らないと prefs が null のままで、✨ が二度と押せなくなる
    void getPrefs(residentId)
      .then((p) => { if (alive) setPrefs({ key: residentId, value: p }); })
      .catch(() => { if (alive) setPrefs({ key: residentId, value: blankRecordPrefs() }); });
    return () => { alive = false; };
  }, [residentId, getPrefs]);

  /*
   * 閉じるときに、その回だけの状態を捨てる。
   *
   * legacy は openModal で #lintBox を空にし（:1881）、undoStack を捨て（:1889）、
   * バッジを保存済みの記録から出し直し（:1890-1895）、文体・分量を利用者の設定に
   * 戻す（:1878-1879）。このコンポーネントは閉じてもアンマウントされないため、
   * 残しておくと同じ訪問を開き直したときに前回の指摘や「元に戻す」が生きている。
   */
  const close = () => {
    setLint(null);
    setStyle(null);
    setUndo(null);
    setBadge(null);
    closeRecord();
  };

  if (editingVisitId === null || visit === null || plan === null) return null;

  // 関数の中から参照する分は const に取り出す。visit の絞り込みはクロージャまで届かない
  const visitKey = visit.visitId;
  const saved = recordOf(visitKey, recs);
  // キーが変われば保存済みの記録（無ければ配信からの初期値）に戻る
  const draft: VisitRecord = edit !== null && edit.key === editingVisitId
    ? edit.draft
    : saved ?? newRecordFor(visit, plan, resident);

  const set = <K extends keyof VisitRecord>(k: K, v: VisitRecord[K]) =>
    setEdit({ key: visit.visitId, draft: { ...draft, [k]: v } });
  const setDraft = (fn: (d: VisitRecord) => VisitRecord) =>
    setEdit({ key: visit.visitId, draft: fn(draft) });

  const findings = lint !== null && lint.key === editingVisitId ? lint.list : null;
  const loadedPrefs = prefs !== null && prefs.key === visit.residentId ? prefs.value : null;
  const tone = style !== null && style.key === editingVisitId ? style.tone : loadedPrefs?.tone ?? blankRecordPrefs().tone;
  const length = style !== null && style.key === editingVisitId ? style.length : loadedPrefs?.length ?? blankRecordPrefs().length;
  const undoable = undo !== null && undo.key === editingVisitId ? undo : null;
  /*
   * 出所バッジ。legacy/index.html:1890-1895 は保存済みの記録に対して
   * 「✨ AI作成（要確認）」「📄 定型文で作成（承認済）」を出し、生成直後は
   * 「📄 定型文で作成」に差し替える。手入力（manual / null）では出さない
   */
  const srcBadge = badge !== null && badge.key === editingVisitId
    ? badge.text
    // 保存済みの記録から出す。編集中の状態セレクトで（要確認）↔（承認済）が入れ替わらないようにする
    : saved !== undefined && saved.note && (saved.noteSource === 'ai' || saved.noteSource === 'template')
      ? `${saved.noteSource === 'ai' ? '✨ AI作成' : '📄 定型文で作成'}${saved.status === '完了' ? '（承認済）' : '（要確認）'}`
      : '';
  const wasApproved = saved?.status === '完了';
  const sup = isSupervisor(session);
  const frame = toMin(draft.plannedStart) !== null && toMin(draft.plannedEnd) !== null
    ? `予定枠 ${draft.plannedStart}〜${draft.plannedEnd}（${Math.max(0, (toMin(draft.plannedEnd) ?? 0) - (toMin(draft.plannedStart) ?? 0))}分）`
    : '予定時間が未入力です';
  const oop = outOfPlan(draft);

  /** legacy/index.html:1995-1999 と同じ検証と状態の自動遷移 */
  function validated(): { record: VisitRecord } | { errors: FieldErrors; focus: FieldKey } {
    const d = collect(draft);
    if (!d.plannedStart || !d.plannedEnd) {
      return { errors: { plan: '予定時間を入力してください' }, focus: 'plan' };
    }
    if ((toMin(d.plannedEnd) ?? 0) <= (toMin(d.plannedStart) ?? 0)) {
      return { errors: { plan: '予定終了は開始より後にしてください' }, focus: 'plan' };
    }
    if (d.actualStart && d.actualEnd && (toMin(d.actualEnd) ?? 0) <= (toMin(d.actualStart) ?? 0)) {
      return { errors: { actual: '実績終了は開始より後にしてください' }, focus: 'actual' };
    }
    // legacy/index.html:1999。キャンセル以外は実績の有無で状態が決まる。
    // 実績が揃えば「未完」を選んでいても「済」になり、欠ければ「完了」でも「未完」に落ちる
    const status: VisitStatus = d.status === 'キャンセル'
      ? 'キャンセル'
      : (d.actualStart && d.actualEnd) ? (d.status === '完了' ? '完了' : '済') : '未完';
    return { record: { ...d, status } };
  }

  async function submit(approving: boolean) {
    if (busy) return; // 重複送信の防止
    const v = validated();
    if ('errors' in v) {
      setErrors(v.errors);
      (v.focus === 'plan' ? planRef : actualRef).current?.focus();
      return;
    }
    let next = v.record;

    if (approving && (!next.actualStart || !next.actualEnd)) {
      setErrors({ actual: '実績時間の入力が必要です' });
      actualRef.current?.focus();
      return;
    }

    // legacy/index.html:2005-2014。予定枠外は権限が無ければ保存させない
    const bad = outOfPlan(next);
    if (bad && !approving) {
      if (!sup && !canApprove(session)) {
        // legacy/index.html:2007。保存を止めるときは記載チェックの結果も一緒に出す
        setLint({ key: next.visitId, list: check(next, resident?.carePlan) });
        setErrors({ actual: `実績時間は予定枠内で入力してください（${bad}）` });
        actualRef.current?.focus();
        return;
      }
      const ok = window.confirm(
        `実績時間が予定枠外です。\n\n${bad}\n\n訪問介護の実績は、計画に定めた予定時間の枠内で記録するのが原則です。\nサービス時間が変わった場合は、予定時間そのものの見直しをご検討ください。\n\nこのまま保存しますか？（変更履歴に残ります）`,
      );
      if (!ok) return;
    }

    /*
     * legacy/index.html:2030-2034。要修正があっても承認は続行できる。
     * 記載チェックは警告であって承認の要件ではない、という legacy の強制力をそのまま写す
     * （計画書 Q4）。ただし件数と全文は必ず見せる。
     */
    if (approving) {
      const list = check(next, resident?.carePlan);
      const ng = list.filter((f) => f.level === 'ng');
      if (ng.length > 0) {
        // legacy は renderLint() で DOM を書いてから confirm を出す（:2033-2034）。
        // state 更新はハンドラ終了後に反映されるため、そのままだと
        // ダイアログを閉じるまで #lintBox が空のままになる
        flushSync(() => { setLint({ key: next.visitId, list }); });
        const go = window.confirm(
          `記載チェックで${ng.length}件の要修正項目があります。\n\n・${ng.map((o) => o.message).join('\n・')}\n\nこのまま承認しますか？`,
        );
        if (!go) return;
      }
    }

    // 承認まわり。承認者は記録に残す（法定要件）
    if (approving) {
      if (!canApprove(session)) { notify('承認権限がありません。'); return; }
      next = { ...next, status: '完了', approvedBy: session.staffId, approvedByName: session.name, approvedAt: new Date().toISOString() };
    } else if (wasApproved && next.status !== '完了') {
      if (!canApprove(session)) { notify('承認済みの記録の変更は承認権限のある職員のみ行えます。'); return; }
      next = { ...next, approvedBy: null, approvedByName: null, approvedAt: null };
    } else if (!wasApproved && next.status === '完了') {
      if (!canApprove(session)) { notify('承認は承認権限のある職員のみ行えます。'); return; }
      next = { ...next, approvedBy: session.staffId, approvedByName: session.name, approvedAt: new Date().toISOString() };
    }

    setBusy(true);
    const ok = await saveRecord(next);
    setBusy(false);
    // 失敗しても閉じない。入力を失わせないため
    if (!ok) return;
    notify(approving ? `承認しました（承認者：${session?.name ?? ''}）` : '保存しました');
    close();
  }

  /*
   * 特記事項を作る。legacy/index.html:2731-2735 の定型文経路と同じ順序で、
   * 本文を入れ替え → 元に戻すを出す → バッジ → 記載チェック → トースト。
   *
   * legacy と違い noteSource に 'template' を書く。legacy の genBtn は
   * noteSrc を設定せず（:2720-2753）、保存して開き直すとバッジが消え、
   * 一覧でも手書き扱いになっていた（計画書 Q7）。
   */
  async function generate() {
    if (loadedPrefs === null || generating) return;
    setGenerating(true);
    try {
      const text = await generateNote({ record: collect(draft), plan: resident?.carePlan, prefs: { ...loadedPrefs, tone, length } });
      const next: VisitRecord = { ...draft, note: text, noteSource: 'template' };
      setUndo({ key: visitKey, note: draft.note, source: draft.noteSource });
      setEdit({ key: visitKey, draft: next });
      setBadge({ key: visitKey, text: '📄 定型文で作成' });
      setLint({ key: visitKey, list: check(next, resident?.carePlan) });
      notify('特記事項を作成しました');
    } catch {
      // 生成はローカルで完結するので通常は失敗しない。Phase 5 で外部呼び出しになる
      notify('特記事項を作成できませんでした。');
    } finally {
      setGenerating(false);
    }
  }

  const staffName = staff.status === 'ready'
    ? staff.data.find((s) => s.staffId === draft.staffId)?.name ?? draft.staffName
    : draft.staffName;

  return (
    <Modal
      title={`${resident?.name ?? visit.residentId} 様`}
      subtitle={`${draft.date} ／ 担当：${staffName}`}
      onClose={close}
      footer={
        <>
          <button className="bt del" disabled={busy} onClick={() => { void (async () => {
            if (saved === undefined) { notify('まだ記録がありません。'); return; }
            if (wasApproved && !canApprove(session)) { notify('承認済みの記録の削除は承認権限のある職員のみ行えます。'); return; }
            if (!window.confirm('この記録を削除します。よろしいですか？')) return;
            setBusy(true);
            const ok = await deleteRecord(visit.visitId);
            setBusy(false);
            if (ok) { notify('削除しました'); close(); }
          })(); }}>削除</button>
          <button className="bt" disabled={busy} onClick={() => {
            set('status', 'キャンセル');
            notify('状態をキャンセルにしました。保存で確定します');
          }}>キャンセル記録</button>
          <div className="spacer"></div>
          <button className="bt approve" disabled={busy} onClick={() => { void submit(true); }}>承認して完了</button>
          <button className="bt save" disabled={busy} onClick={() => { void submit(false); }}>
            {busy ? '保存中…' : '保存（済）'}
          </button>
        </>
      }
    >
      {/* 1. 基本情報 */}
      <div className="sec">
        <h3>基本情報</h3>
        <div className="grid2">
          <div className="fld"><label htmlFor="fUser">利用者</label>
            {/* 利用者と担当は配信で確定しているため変更できない。氏名ではなく ID で参照する */}
            <input id="fUser" value={resident?.name ?? visit.residentId} readOnly />
          </div>
          <div className="fld"><label htmlFor="fStaff">担当職員</label>
            <input id="fStaff" value={staffName} readOnly />
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="fld"><label htmlFor="fSvc">サービス種別</label>
            <select id="fSvc" value={draft.serviceName} onChange={(e) => set('serviceName', e.target.value as ServiceKind)}>
              {SERVICE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld"><label htmlFor="fStatus">状態</label>
            <select id="fStatus" value={draft.status} onChange={(e) => set('status', e.target.value as VisitStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="aihint" id="apprInfo" aria-live="polite">
          {draft.status === '完了'
            // legacy/index.html:1885 の文言をそのまま使う。全角スペースを含む
            ? `✅ 承認済み\u3000承認者：${draft.approvedByName ?? '（記録なし）'}${draft.approvedAt ? `\u3000${draft.approvedAt.slice(0, 16).replace('T', ' ')}` : ''}\u3000／\u3000承認済み記録の訂正・解除には承認権限が必要です。`
            : canApprove(session)
              ? '※ あなたは承認権限をもっています。内容を確認のうえ承認してください。'
              : '※「承認して完了」は承認権限のある職員のみ行えます。'}
        </div>
      </div>

      {/* 2. 予定時間 */}
      <div className="sec">
        <h3>予定時間</h3>
        <div className="grid2">
          <div className="fld"><label htmlFor="fPs">開始</label>
            <input id="fPs" type="time" ref={planRef} value={draft.plannedStart}
              aria-invalid={errors.plan !== undefined}
              aria-describedby={errors.plan !== undefined ? 'fPlanErr' : undefined}
              onChange={(e) => { set('plannedStart', e.target.value); setErrors((x) => clearError(x, 'plan')); }} />
          </div>
          <div className="fld"><label htmlFor="fPe">終了</label>
            <input id="fPe" type="time" value={draft.plannedEnd}
              onChange={(e) => { set('plannedEnd', e.target.value); setErrors((x) => clearError(x, 'plan')); }} />
          </div>
        </div>
        {errors.plan !== undefined && (
          <div className="aihint" id="fPlanErr" role="alert" style={{ color: '#a3243c', fontWeight: 700 }}>⚠ {errors.plan}</div>
        )}
      </div>

      {/* 3. 実績時間 */}
      <div className="sec">
        <h3>実績時間 <span className="pchip acc" id="planFrame">{frame}</span></h3>
        <div className="grid2">
          <div className="fld inline">
            <div style={{ flex: 1 }}><label htmlFor="fAs">開始</label>
              <input id="fAs" type="time" ref={actualRef} value={draft.actualStart}
                aria-invalid={errors.actual !== undefined}
                aria-describedby={errors.actual !== undefined ? 'fActErr' : undefined}
                onChange={(e) => { set('actualStart', e.target.value); setErrors((x) => clearError(x, 'actual')); }} />
            </div>
            <button className="nowbtn" onClick={() => {
              const raw = nowHM();
              const c = clampToPlan(draft.plannedStart, draft.plannedEnd, raw);
              set('actualStart', c);
              if (c !== raw) notify(`現在時刻 ${raw} は予定枠外のため ${c} で入力しました`);
            }}>現在</button>
          </div>
          <div className="fld inline">
            <div style={{ flex: 1 }}><label htmlFor="fAe">終了</label>
              <input id="fAe" type="time" value={draft.actualEnd}
                onChange={(e) => { set('actualEnd', e.target.value); setErrors((x) => clearError(x, 'actual')); }} />
            </div>
            <button className="nowbtn" onClick={() => {
              const raw = nowHM();
              const c = clampToPlan(draft.plannedStart, draft.plannedEnd, raw);
              set('actualEnd', c);
              if (c !== raw) notify(`現在時刻 ${raw} は予定枠外のため ${c} で入力しました`);
            }}>現在</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => {
            setDraft((d) => ({ ...d, actualStart: d.plannedStart, actualEnd: d.plannedEnd }));
            notify('予定時間を実績に反映しました');
          }}>予定どおりに入力</button>
          <button className="ghost" onClick={() => {
            setDraft((d) => ({ ...d, actualStart: '', actualEnd: '' }));
            notify('実績時間をクリアしました');
          }}>実績をクリア</button>
        </div>
        <div className="aihint" id="actHint" aria-live="polite">
          {errors.actual !== undefined
            ? <span id="fActErr" role="alert" style={{ color: '#a3243c', fontWeight: 700 }}>⚠ {errors.actual}</span>
            : oop
              ? <span style={{ color: '#a3243c', fontWeight: 700 }}>⚠ 予定枠外です（{oop}）。実績は訪問介護計画の予定枠内で記録します。</span>
              : `実績は予定枠 ${draft.plannedStart || '—'}〜${draft.plannedEnd || '—'} の範囲で入力してください。`}
        </div>
      </div>

      {/* 4. 実施内容 */}
      <div className="sec">
        {/*
          * 初期選択は newRecordFor が訪問介護計画から draft.tasks に入れている。
          * ここで plannedTasks へフォールバックすると、画面ではチェックが付いたまま
          * 保存された記録の実施内容が空になる（帳票の実施内容が空欄になる）。
          */}
        <h3>実施内容 {saved === undefined && (resident?.carePlan.plannedTasks.length ?? 0) > 0 && (
          <span className="srcbadge">📋 訪問介護計画の内容を初期選択しています</span>
        )}</h3>
        <div className="chips" id="fTasks">
          {TASK_OPTIONS.map((t) => (
            // input の直後が span であること。.chk input:checked+span が効かなくなる
            <label className="chk" key={t}>
              <input type="checkbox" value={t} checked={draft.tasks.includes(t)} onChange={(e) => {
                set('tasks', e.target.checked ? [...draft.tasks, t] : draft.tasks.filter((x) => x !== t));
              }} />
              <span>{t}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 5. バイタル */}
      <div className="sec">
        <h3>バイタル</h3>
        <div className="grid3">
          <div className="fld"><label htmlFor="fTemp">体温（℃）</label>
            <input id="fTemp" placeholder="36.5" inputMode="decimal" value={draft.vitals.temperature}
              onChange={(e) => set('vitals', { ...draft.vitals, temperature: e.target.value })} /></div>
          <div className="fld"><label htmlFor="fBp">血圧（mmHg）</label>
            <input id="fBp" placeholder="128/78" value={draft.vitals.bloodPressure}
              onChange={(e) => set('vitals', { ...draft.vitals, bloodPressure: e.target.value })} /></div>
          <div className="fld"><label htmlFor="fPulse">脈拍（回/分）</label>
            <input id="fPulse" placeholder="72" inputMode="numeric" value={draft.vitals.pulse}
              onChange={(e) => set('vitals', { ...draft.vitals, pulse: e.target.value })} /></div>
        </div>
      </div>

      {/* 6. 特記事項 */}
      <div className="sec">
        {/* legacy/index.html:945。.srcbadge は h3 の中に置く（.sec>h3 は直下子セレクタ） */}
        <h3>特記事項 {srcBadge && <span className="srcbadge" id="srcBadge">{srcBadge}</span>}</h3>
        <div className="profbar" id="profBar">
          {resident !== undefined && (
            <>
              {resident.carePlan.careLevel && <span className="pchip acc">{resident.carePlan.careLevel}</span>}
              <span className="pchip">{resident.carePlan.household}</span>
              {resident.carePlan.shortTermGoal && <span className="pchip">短期目標：{resident.carePlan.shortTermGoal}</span>}
              {resident.carePlan.caution && (
                <span className="pchip" style={{ background: '#fff5f8', borderColor: '#f6d6e5', color: '#b8437a' }}>⚠ {resident.carePlan.caution}</span>
              )}
              <button className="ghost" onClick={() => openResident(resident.residentId)}>利用者情報</button>
            </>
          )}
        </div>
        {/*
          * legacy/index.html:946-962。select は .aibar の直下に置く。
          * .aibar select（styles.css:263）が枠線と背景を与えており、
          * .fld の中に移すと見た目が変わる
          */}
        <div className="aibar">
          <select id="fMood" title="本人の様子" value={draft.mood || MOOD_DEFAULT}
            onChange={(e) => set('mood', e.target.value)}>
            {MOOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select id="fTone" title="文体" value={tone}
            onChange={(e) => setStyle({ key: visit.visitId, tone: e.target.value as RecordPrefs['tone'], length })}>
            <option value="polite">です・ます調</option>
            <option value="plain">である調（簡潔）</option>
          </select>
          <select id="fLen" title="分量" value={length}
            onChange={(e) => setStyle({ key: visit.visitId, tone, length: e.target.value as RecordPrefs['length'] })}>
            <option value="short">簡潔（1〜2文）</option>
            <option value="normal">標準（2〜3文）</option>
            <option value="long">詳しく（3〜4文）</option>
          </select>
          {/* .sp は .aibtn.busy のときだけ出る（styles.css:274-275）。span を外すとスピナーが消える */}
          <button className="aibtn" id="genBtn" disabled={loadedPrefs === null || generating}
            onClick={() => { void generate(); }}>
            <span className="sp"></span>✨ AIで文章作成
          </button>
          {/* .dot は .micbtn.rec のときだけ出る（styles.css:306-310）。span を外すと録音表示が消える */}
          {speech.supported ? (
            <button className={`micbtn${speech.listening === 'note' ? ' rec' : ''}`} id="micNote"
              aria-pressed={speech.listening === 'note'}
              onClick={() => speech.start({
                id: 'note',
                el: noteRef.current,
                // 音声で足したぶんも人が書いた本文として扱う
                onChange: (v) => setEdit({ key: visit.visitId, draft: { ...draft, note: v, noteSource: 'manual' } }),
              })}>
              <span className="dot"></span>{speech.listening === 'note' ? '■ 停止' : '🎤 音声入力'}
            </button>
          ) : (
            // legacy は黙って隠す（:3239）。理由が分からないと「壊れている」と見える（Q9）
            <span className="aihint">{SPEECH_UNSUPPORTED_HINT}</span>
          )}
          <button className="ghost" id="lintBtn" aria-controls="lintBox"
            onClick={() => setLint({ key: visit.visitId, list: check(collect(draft), resident?.carePlan) })}>📋 記載チェック</button>
          {/* legacy は undoStack があるときだけ表示する（:2734 / :2754-2759） */}
          {undoable !== null && (
            <button className="ghost" id="undoBtn" onClick={() => {
              setEdit({ key: visit.visitId, draft: { ...draft, note: undoable.note, noteSource: undoable.source } });
              setUndo(null);
              setBadge(null);
              notify('元に戻しました');
            }}>元に戻す</button>
          )}
        </div>
        {/* .micmini は position:absolute。.memowrap（position:relative）の直下に置く */}
        <div className="memowrap">
          <input className="memo" id="fMemo" ref={memoRef} placeholder="メモ（任意・箇条書き可）例：昼食を半分残された／左膝の痛みの訴えあり"
            value={draft.memo} onChange={(e) => set('memo', e.target.value)} />
          {speech.supported && (
            <button className={`micmini${speech.listening === 'memo' ? ' rec' : ''}`} id="micMemo" title="メモを音声入力"
              aria-pressed={speech.listening === 'memo'}
              onClick={() => speech.start({ id: 'memo', el: memoRef.current, onChange: (v) => set('memo', v) })}>🎤</button>
          )}
        </div>
        <div className="fld">
          <label htmlFor="fNote">特記事項</label>
          {/* id を外すと #fNote{min-height:118px}（styles.css:242）が効かなくなる */}
          <textarea id="fNote" ref={noteRef} placeholder="ご本人の状態、申し送り事項など" value={draft.note}
            onChange={(e) => {
              // 人が書いた本文であることを記録に残す。legacy は noteSrc を書く経路が
              // 一括作成と未完了一覧にしか無く、手入力は常に未設定のままだった
              setEdit({ key: visit.visitId, draft: { ...draft, note: e.target.value, noteSource: 'manual' } });
            }} />
        </div>
        {/* legacy/index.html:968。.on が無いと表示されない（鉄則5） */}
        <div className={`mic-live${speech.listening !== null ? ' on' : ''}`} id="micLive" aria-live="polite">
          <b>🎤 認識中…</b> {speech.heard
            ? (speech.interim ? <span className="it">{speech.interim}</span> : '話しかけてください。')
            : '話し終わると自動で入力されます。'}
          <span className="tip">終了するときはもう一度ボタンを押してください。{speech.heard ? '' : '誤認識はそのまま手で修正できます。'}</span>
        </div>
        {/*
          * legacy は .lint の直下に .lintitem を並べる（:2399-2404）。
          * 余分なラッパーを挟むと flex の gap が効かない。
          * aria-live は legacy に無いが、押した結果が画面のどこかに出たことを
          * 読み上げに伝えないと、キーボード操作では変化に気づけない
          */}
        <div className="lint" id="lintBox" aria-live="polite">
          {findings !== null && (findings.length === 0
            ? <LintItem finding={NO_ISSUE_FINDING} />
            // 指摘に安定した ID が無いのは legacy も同じ（data-fix は配列の添字、:2403）
            : findings.map((f, i) => (
              <LintItem key={`${f.level}-${i}`} finding={f} onFix={() => {
                const fix = f.fix;
                if (fix === undefined) return;
                const fixed = { ...draft, note: draft.note.replace(fix.pattern, fix.replacement) };
                setEdit({ key: visit.visitId, draft: fixed });
                setLint({ key: visit.visitId, list: check(fixed, resident?.carePlan) });
                notify('表現を修正しました');
                // 押したボタンは再判定で消える。行き先を決めないとフォーカスが body に落ちる
                noteRef.current?.focus();
              }} />
            )))}
        </div>
        {/* legacy/index.html:1897。AI に切り替えるのは Phase 5（決定 H）なので定型文側の文言を出す */}
        <div className="aihint" id="aiHint">定型文で作成します。⚙設定からClaude AIに切り替えられます。</div>
      </div>
    </Modal>
  );
}
