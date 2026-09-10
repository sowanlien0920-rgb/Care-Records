/*
 * 利用者マスタ。移植元: legacy/index.html:1049-1154、:2268-2299
 *
 * ── legacy から意図的に変えた点 ─────────────────────────
 * legacy はこの画面ですべての項目を編集できたが、新モデルでは
 * 法定文書に属する情報の正は kpi-react にある（CLAUDE.md 鉄則4）。
 *   要介護度 / 世帯状況 / ADL / 認知症自立度 / 疾患 / 服薬 /
 *   長期目標 / 短期目標 / 援助内容 / サービス内容 / 算定理由 / 留意事項
 * とくに訪問介護計画書は kpi-react が版管理しているため、こちらから
 * 編集できると「どちらが正か」が判定できなくなり、運営指導で問題になる。
 * よってこれらは閲覧のみとし、編集できるのは記録支援設定だけにしてある。
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * - `.sec > h3` は直接の子（styles.css:228-232）
 * - `.fld label` / `.fld input|select|textarea` は子孫（:235-241）
 * - `.chk input:checked + span` は隣接兄弟（:255）
 * - `.prow .nm` / `.prow .st` は子孫、`.prow.on` で選択状態（:342-350）
 */
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { isSupervisor, blankRecordPrefs, type RecordPrefs } from '../../types/local';
import type { ResidentBrief } from '../../types/contract';

const ADL_ITEMS = ['歩行', '移乗', '排泄', '入浴', '食事', '更衣'] as const;

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="fld">
      <label>{label}</label>
      {/* 法定文書に属する情報は kpi-react が正なので readOnly にする */}
      <input value={value || '—'} readOnly />
    </div>
  );
}

export function ResidentModal() {
  const { residentModalOpen, selectedResidentId, closeResident, openResident, dispatch, session, getPrefs, savePrefs, notify } = useCareStore();
  const plan = dispatch.status === 'ready' ? dispatch.data : null;
  const residents: ResidentBrief[] = plan?.residents ?? [];
  // 利用者を指定せずに開いた場合は先頭を選ぶ（legacy/index.html:2302 と同じ）
  const current = residents.find((r) => r.residentId === selectedResidentId) ?? residents[0] ?? null;

  const [prefs, setPrefs] = useState<RecordPrefs>(blankRecordPrefs());
  const [busy, setBusy] = useState(false);
  const sup = isSupervisor(session);

  useEffect(() => {
    if (current === null) return;
    let alive = true;
    getPrefs(current.residentId)
      .then((p) => { if (alive) setPrefs(p); })
      .catch(() => { if (alive) setPrefs(blankRecordPrefs()); });
    return () => { alive = false; };
  }, [current, getPrefs]);

  if (!residentModalOpen) return null;
  if (current === null) {
    return (
      <Modal title="利用者マスタ" onClose={closeResident}>
        <p className="hint">この日の配信に利用者が含まれていません。</p>
      </Modal>
    );
  }

  const cp = current.carePlan;

  return (
    <Modal
      title="利用者マスタ"
      subtitle="訪問介護計画に関する情報は kpi-react が正です。ここでは閲覧のみできます"
      onClose={closeResident}
      width={980}
      footer={
        <>
          <span style={{ fontSize: 12.5, color: 'var(--ink-sub)', fontWeight: 700 }}>{current.name} さんの情報</span>
          <div className="spacer"></div>
          {/* legacy/index.html:4241。保存はサービス提供責任者以上 */}
          {sup && (
            <button className="bt save" disabled={busy} onClick={() => { void (async () => {
              setBusy(true);
              const ok = await savePrefs(current.residentId, prefs);
              setBusy(false);
              if (ok) notify(`${current.name} さんの記録スタイルを保存しました`);
            })(); }}>{busy ? '保存中…' : '記録スタイルを保存'}</button>
          )}
        </>
      }
    >
      <div className="splitpane">
        <div>
          <div className="subhead">利用者を選択</div>
          <div className="plist" id="pList">
            {residents.map((r) => (
              <div
                key={r.residentId}
                className={`prow${r.residentId === current.residentId ? ' on' : ''}`}
                data-u={r.residentId}
                onClick={() => openResident(r.residentId)}
              >
                <span className="nm">{r.name}</span>
                <span className={`st${cpFilled(r) ? ' ok' : ''}`}>{cpFilled(r) ? '登録済' : '未登録'}</span>
              </div>
            ))}
          </div>
        </div>

        <div id="pForm">
          <div className="sec">
            <h3>基本情報</h3>
            <div className="grid4">
              <ReadOnly label="年齢" value={current.age} />
              <ReadOnly label="性別" value={current.sex} />
              <ReadOnly label="要介護度" value={cp.careLevel} />
              <ReadOnly label="世帯状況" value={cp.household} />
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <ReadOnly label="障害高齢者の日常生活自立度（寝たきり度）" value={cp.adlLevel} />
              <ReadOnly label="認知症高齢者の日常生活自立度" value={cp.dementiaLevel} />
            </div>
          </div>

          <div className="sec">
            <h3>心身の状況</h3>
            <div className="grid2">
              <ReadOnly label="主な疾患・既往歴" value={cp.disease} />
              <ReadOnly label="医療面での留意点" value={cp.medication} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-sub)', marginBottom: 8, fontWeight: 600 }}>
                ADL（できること／介助の程度）
              </label>
              <div className="adl">
                {ADL_ITEMS.map((a) => <ReadOnly key={a} label={a} value={cp.adl[a] ?? '—'} />)}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-sub)', marginBottom: 8, fontWeight: 600 }}>
                コミュニケーション上の配慮
              </label>
              <div className="chips">
                {cp.communication.length === 0
                  ? <span className="pchip">—</span>
                  : cp.communication.map((c) => <span className="pchip" key={c}>{c}</span>)}
              </div>
            </div>
          </div>

          <div className="sec">
            <h3>訪問介護計画</h3>
            <div className="aihint">
              訪問介護計画書は kpi-react で作成・版管理しています（現在 第{cp.planVersion ?? '—'}版）。変更はそちらで行ってください。
            </div>
            <div className="fld" style={{ marginBottom: 12 }}><label>長期目標（居宅サービス計画）</label>
              <input value={cp.longTermGoal || '—'} readOnly /></div>
            <div className="fld" style={{ marginBottom: 12 }}><label>短期目標</label>
              <input value={cp.shortTermGoal || '—'} readOnly /></div>
            <div className="fld" style={{ marginBottom: 12 }}><label>援助の方針・具体的援助内容</label>
              <textarea value={cp.supportPlan} readOnly /></div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-sub)', marginBottom: 8, fontWeight: 600 }}>
              計画に位置づけられたサービス内容
            </label>
            <div className="chips">
              {cp.plannedTasks.length === 0
                ? <span className="pchip">—</span>
                : cp.plannedTasks.map((t) => <span className="pchip" key={t}>{t}</span>)}
            </div>
            <div className="fld" style={{ marginTop: 14 }}><label>生活援助を算定する理由（同居家族がいる場合は必須）</label>
              <input value={cp.householdSupportReason || '—（独居のため理由記載不要）'} readOnly /></div>
          </div>

          <div className="sec">
            <h3>支援上の留意点</h3>
            <div className="fld" style={{ marginBottom: 12 }}><label>留意事項・禁忌</label>
              <input value={cp.caution || '—'} readOnly /></div>
            <div className="grid2">
              <div className="fld"><label htmlFor="pLike">好み・大切にしていること</label>
                <input id="pLike" value={prefs.likes} disabled={!sup}
                  onChange={(e) => setPrefs({ ...prefs, likes: e.target.value })} /></div>
              <ReadOnly label="キーパーソン・緊急連絡先" value={cp.family} />
            </div>
          </div>

          {/* ここだけが carerecords 固有で、編集できる */}
          <div className="sec">
            <h3>この利用者の記録スタイル</h3>
            <div className="grid3">
              <div className="fld"><label htmlFor="pHonor">敬称</label>
                <select id="pHonor" value={prefs.honorific} disabled={!sup}
                  onChange={(e) => setPrefs({ ...prefs, honorific: e.target.value })}>
                  <option value="様">様</option><option value="さん">さん</option>
                </select></div>
              <div className="fld"><label htmlFor="pTone">文体</label>
                <select id="pTone" value={prefs.tone} disabled={!sup}
                  onChange={(e) => setPrefs({ ...prefs, tone: e.target.value as RecordPrefs['tone'] })}>
                  <option value="polite">です・ます調</option><option value="plain">である調</option>
                </select></div>
              <div className="fld"><label htmlFor="pLen">分量</label>
                <select id="pLen" value={prefs.length} disabled={!sup}
                  onChange={(e) => setPrefs({ ...prefs, length: e.target.value as RecordPrefs['length'] })}>
                  <option value="short">簡潔</option><option value="normal">標準</option><option value="long">詳しく</option>
                </select></div>
            </div>
            <div className="fld" style={{ marginTop: 12 }}>
              <label htmlFor="pStyle">この利用者でよく使う言い回し・記録上の指示（任意）</label>
              <textarea id="pStyle" value={prefs.style} disabled={!sup}
                onChange={(e) => setPrefs({ ...prefs, style: e.target.value })} />
            </div>
            {!sup && <div className="aihint">記録スタイルの編集はサービス提供責任者以上が行えます。</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** legacy/index.html:2219 の hasProfile と同じ判定 */
function cpFilled(r: ResidentBrief): boolean {
  const c = r.carePlan;
  return Boolean(c.careLevel || c.shortTermGoal || c.supportPlan || c.plannedTasks.length);
}
