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
import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { canApprove, isSupervisor } from '../../types/local';
import { newRecordFor, recordOf } from '../../domain/visitStatus';
import { clampToPlan, nowHM } from '../../domain/timeValidation';
import { SERVICE_OPTIONS, TASK_OPTIONS } from '../../domain/vocabulary';
import { toMin } from '../../utils/date';
import type { ServiceKind, VisitRecord, VisitStatus } from '../../types/contract';

const STATUSES: VisitStatus[] = ['未完', '済', '完了', 'キャンセル'];

/** legacy/index.html:3074-3082 の outOfPlan */
function outOfPlan(r: VisitRecord): string {
  const ps = toMin(r.plannedStart);
  const pe = toMin(r.plannedEnd);
  if (ps === null || pe === null) return '';
  const as = toMin(r.actualStart);
  const ae = toMin(r.actualEnd);
  const bad: string[] = [];
  if (as !== null && as < ps) bad.push(`開始 ${r.actualStart} が予定 ${r.plannedStart} より前`);
  if (ae !== null && ae > pe) bad.push(`終了 ${r.actualEnd} が予定 ${r.plannedEnd} より後`);
  return bad.join('／');
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
    saveRecord, deleteRecord, openResident, notify,
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
  const planRef = useRef<HTMLInputElement>(null);
  const actualRef = useRef<HTMLInputElement>(null);

  if (editingVisitId === null || visit === null || plan === null) return null;

  const saved = recordOf(visit.visitId, recs);
  // キーが変われば保存済みの記録（無ければ配信からの初期値）に戻る
  const draft: VisitRecord = edit !== null && edit.key === editingVisitId
    ? edit.draft
    : saved ?? newRecordFor(visit, plan, resident);

  const set = <K extends keyof VisitRecord>(k: K, v: VisitRecord[K]) =>
    setEdit({ key: visit.visitId, draft: { ...draft, [k]: v } });
  const setDraft = (fn: (d: VisitRecord) => VisitRecord) =>
    setEdit({ key: visit.visitId, draft: fn(draft) });

  const wasApproved = saved?.status === '完了';
  const sup = isSupervisor(session);
  const frame = toMin(draft.plannedStart) !== null && toMin(draft.plannedEnd) !== null
    ? `予定枠 ${draft.plannedStart}〜${draft.plannedEnd}（${Math.max(0, (toMin(draft.plannedEnd) ?? 0) - (toMin(draft.plannedStart) ?? 0))}分）`
    : '予定時間が未入力です';
  const oop = outOfPlan(draft);

  /** legacy/index.html:1995-1999 と同じ検証と状態の自動遷移 */
  function validated(): { record: VisitRecord } | { errors: FieldErrors; focus: FieldKey } {
    const d = draft;
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
        setErrors({ actual: `実績時間は予定枠内で入力してください（${bad}）` });
        actualRef.current?.focus();
        return;
      }
      const ok = window.confirm(
        `実績時間が予定枠外です。\n\n${bad}\n\n訪問介護の実績は、計画に定めた予定時間の枠内で記録するのが原則です。\nサービス時間が変わった場合は、予定時間そのものの見直しをご検討ください。\n\nこのまま保存しますか？（変更履歴に残ります）`,
      );
      if (!ok) return;
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
    closeRecord();
  }

  const staffName = staff.status === 'ready'
    ? staff.data.find((s) => s.staffId === draft.staffId)?.name ?? draft.staffName
    : draft.staffName;

  return (
    <Modal
      title={`${resident?.name ?? visit.residentId} 様`}
      subtitle={`${draft.date} ／ 担当：${staffName}`}
      onClose={closeRecord}
      footer={
        <>
          <button className="bt del" disabled={busy} onClick={() => { void (async () => {
            if (saved === undefined) { notify('まだ記録がありません。'); return; }
            if (wasApproved && !canApprove(session)) { notify('承認済みの記録の削除は承認権限のある職員のみ行えます。'); return; }
            if (!window.confirm('この記録を削除します。よろしいですか？')) return;
            setBusy(true);
            const ok = await deleteRecord(visit.visitId);
            setBusy(false);
            if (ok) { notify('削除しました'); closeRecord(); }
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
        <h3>特記事項</h3>
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
        <div className="aibar">
          <button className="aibtn" onClick={() => notify('AIによる文章作成は Phase 1b で実装します')}>
            <span className="sp"></span>✨ AIで文章作成
          </button>
          <button className="micbtn" onClick={() => notify('音声入力は Phase 1b で実装します')}>
            <span className="dot"></span>🎤 音声入力
          </button>
          <button className="ghost" onClick={() => notify('記載チェックは Phase 1b で実装します')}>📋 記載チェック</button>
        </div>
        <div className="fld">
          <label htmlFor="fNote">特記事項</label>
          {/* id を外すと #fNote{min-height:118px}（styles.css:242）が効かなくなる */}
          <textarea id="fNote" placeholder="ご本人の状態、申し送り事項など" value={draft.note}
            onChange={(e) => set('note', e.target.value)} />
        </div>
        <div className="lint" id="lintBox"></div>
      </div>
    </Modal>
  );
}
