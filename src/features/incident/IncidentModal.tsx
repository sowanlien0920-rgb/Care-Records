/*
 * ヒヤリハット・事故報告。移植元: legacy/index.html:1510-1593、:3875-4084
 *
 * 一覧とフォームが同一モーダル内に同居し、切り替わる（legacy は style.display）。
 * 保存先は incidentAdapter の裏にあり、DataAdapter とは別経路になっている。
 * 統合先（incident-report に寄せるか carerecords 内に残すか）が未定のため、
 * その決定を先送りできる形を保つのが目的（計画書 §2 の J）。
 */
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { iso } from '../../utils/date';
import { nowHM } from '../../domain/timeValidation';
import type { Incident } from '../../types/local';

const KINDS = ['転倒', '転落', 'ずり落ち', '誤薬・服薬忘れ', '誤嚥・むせこみ', '皮膚剥離・打撲', '異食', '物品の破損・紛失', '行方不明・所在不明', 'その他'];
const PLACES = ['居室', '廊下', 'トイレ', '浴室', '台所', '玄関', '屋外', 'その他'];

function blank(staffId: string): Incident {
  return {
    incidentId: `i${Math.random().toString(36).slice(2, 10)}`,
    date: iso(new Date()),
    staffId,
    residentId: null,
    kind: 'ヒヤリハット',
    place: '居室',
    summary: '',
    response: '',
    cause: '',
    prevention: '',
    reportedAt: nowHM(),
  };
}

export function IncidentModal() {
  const { panel, closePanel, incidents, saveIncident, session, dispatch, notify } = useCareStore();
  const [form, setForm] = useState<Incident | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (panel !== 'incident') return null;

  const list = incidents.status === 'ready'
    ? [...incidents.data].sort((a, b) => (b.date + b.reportedAt).localeCompare(a.date + a.reportedAt))
    : [];
  const residents = dispatch.status === 'ready' ? dispatch.data?.residents ?? [] : [];
  const set = <K extends keyof Incident>(k: K, v: Incident[K]) =>
    setForm((f) => (f === null ? f : { ...f, [k]: v }));

  async function submit() {
    if (form === null || busy) return;
    // legacy/index.html:4041。発生状況だけが必須
    if (!form.summary.trim()) { setError('発生状況を入力してください'); return; }
    setBusy(true);
    const ok = await saveIncident(form);
    setBusy(false);
    if (!ok) return; // 失敗しても入力を残す
    notify('報告書を保存しました');
    setForm(null);
  }

  return (
    <Modal
      title={form === null ? 'ヒヤリハット・事故報告書' : form.kind === '事故' ? '事故報告書' : 'ヒヤリハット報告書'}
      subtitle="発生後、速やかに事業所・関係機関へ報告してください"
      onClose={closePanel}
      width={820}
      footer={form === null ? undefined : (
        <>
          <button className="bt" onClick={() => { setForm(null); setError(null); }}>一覧へ戻る</button>
          <div className="spacer"></div>
          <button className="bt save" disabled={busy} onClick={() => { void submit(); }}>
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      )}
    >
      {form === null ? (
        <div className="sec">
          <h3>登録済みの報告 <span className="bchip">{list.length}件</span></h3>
          <div className="plist" style={{ maxHeight: 180 }}>
            {incidents.status === 'loading' && <div className="hempty">読み込んでいます…</div>}
            {incidents.status === 'error' && <div className="hempty">{incidents.message}</div>}
            {incidents.status === 'ready' && list.length === 0 && <div className="hempty">登録された報告はありません</div>}
            {list.map((x) => (
              <div className="prow" key={x.incidentId} onClick={() => { setForm(x); setError(null); }}>
                <span className="nm">{x.date} {x.reportedAt}{'\u3000'}{residents.find((r) => r.residentId === x.residentId)?.name ?? '利用者未選択'}</span>
                {/* legacy/index.html:3891。ヒヤリハット側に .ok（緑）が付く */}
                <span className={`st${x.kind !== '事故' ? ' ok' : ''}`}>{x.kind}・{x.place}</span>
              </div>
            ))}
          </div>
          <button className="chipbtn primary" style={{ marginTop: 12 }}
            onClick={() => { setForm(blank(session?.staffId ?? '')); setError(null); }}>＋ 新規に報告書を作成</button>
        </div>
      ) : (
        <>
          <div className="sec">
            <h3>発生状況</h3>
            <div className="grid4">
              <div className="fld"><label htmlFor="iDate">発生日</label>
                <input id="iDate" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
              <div className="fld"><label htmlFor="iTime">発生時刻</label>
                <input id="iTime" type="time" value={form.reportedAt} onChange={(e) => set('reportedAt', e.target.value)} /></div>
              <div className="fld"><label htmlFor="iLevel">区分</label>
                <select id="iLevel" value={form.kind} onChange={(e) => set('kind', e.target.value as Incident['kind'])}>
                  <option value="ヒヤリハット">ヒヤリハット（事故に至らず）</option>
                  <option value="事故">事故</option>
                </select></div>
              <div className="fld"><label htmlFor="iPlace">発生場所</label>
                <select id="iPlace" value={form.place} onChange={(e) => set('place', e.target.value)}>
                  {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <div className="fld"><label htmlFor="iUser">利用者</label>
                {/* 氏名ではなく ID で参照する */}
                <select id="iUser" value={form.residentId ?? ''} onChange={(e) => set('residentId', e.target.value || null)}>
                  <option value="">—</option>
                  {residents.map((r) => <option key={r.residentId} value={r.residentId}>{r.name}</option>)}
                </select></div>
              <div className="fld"><label htmlFor="iKindDetail">種別</label>
                <select id="iKindDetail" defaultValue={KINDS[0]}
                  onChange={() => notify('種別の保存は Phase 1b で契約に追加します')}>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select></div>
            </div>
          </div>

          <div className="sec">
            <h3>報告書の作成</h3>
            <div className="aibar">
              <button className="aibtn" onClick={() => notify('AIによる報告書作成は Phase 1b で実装します')}>
                <span className="sp"></span>✨ AIで報告書を作成
              </button>
              <button className="ghost" onClick={() => notify('記載チェックは Phase 1b で実装します')}>📋 記載チェック</button>
            </div>
            <div className="fld" style={{ marginBottom: 12 }}>
              <label htmlFor="iSituation">発生状況（5W1Hで具体的に）</label>
              <textarea id="iSituation" style={{ minHeight: 88 }} value={form.summary}
                aria-invalid={error !== null} aria-describedby={error !== null ? 'iErr' : undefined}
                onChange={(e) => { set('summary', e.target.value); setError(null); }} />
              {error !== null && <div id="iErr" role="alert" className="aihint" style={{ color: '#a3243c', fontWeight: 700 }}>⚠ {error}</div>}
            </div>
            <div className="fld" style={{ marginBottom: 12 }}><label htmlFor="iResponse">発生時の対応</label>
              <textarea id="iResponse" value={form.response} onChange={(e) => set('response', e.target.value)} /></div>
            <div className="fld" style={{ marginBottom: 12 }}><label htmlFor="iCause">発生原因の分析</label>
              <textarea id="iCause" value={form.cause} onChange={(e) => set('cause', e.target.value)} /></div>
            <div className="fld"><label htmlFor="iPrevent">再発防止策</label>
              <textarea id="iPrevent" value={form.prevention} onChange={(e) => set('prevention', e.target.value)} /></div>
            <div className="lint"></div>
          </div>
        </>
      )}
    </Modal>
  );
}
