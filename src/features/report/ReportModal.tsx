/*
 * 帳票・集計。移植元: legacy/index.html:1442-1470、:3583-3749
 *
 * 集計は計画どおり素朴な実装にしてある（計画書 §4 のステップ6）。
 * Phase 1b で domain/aggregate.ts に差し替える。
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * `.rtable th,td` / `.rtable tr.cxl td` / `.rtable tfoot td`（styles.css:496-501）は
 * table の階層そのものに依存する。tbody / tfoot を省くと背景が効かない。
 *
 * ── legacy の仕様 ───────────────────────────────────────
 * - 利用者別はキャンセル・未完も行に出す。提供時間は実績が揃った分だけ加算
 * - 職員別はキャンセルを除外する
 * - `.grid4` に grid-template-columns をインラインで上書きしている
 */
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { deriveStatus } from '../../domain/visitStatus';
import { toMin } from '../../utils/date';
import type { VisitRow } from '../../data/adapter';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

function dowOf(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()] ?? '';
}

/** legacy/index.html:2953 の durOf。実績が揃っていなければ 0 */
function durOf(r: VisitRow): number {
  const s = toMin(r.record?.actualStart ?? '');
  const e = toMin(r.record?.actualEnd ?? '');
  return s !== null && e !== null && e > s ? e - s : 0;
}

/** legacy/index.html:2954 の hm */
function hm(min: number): string {
  return `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, '0')}分`;
}

export function ReportModal() {
  const { panel, closePanel, visitRows, staff, date, notify } = useCareStore();
  const [type, setType] = useState<'user' | 'staff' | 'summary'>('user');
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const [residentId, setResidentId] = useState('');
  const [staffId, setStaffId] = useState('');

  if (panel !== 'report') return null;

  const all = visitRows.status === 'ready' ? visitRows.data : [];
  const accounts = staff.status === 'ready' ? staff.data : [];
  const residents = [...new Map(all.filter((r) => r.resident !== undefined)
    .map((r) => [r.resident?.residentId ?? '', r.resident])).entries()]
    .map(([id, r]) => ({ id, name: r?.name ?? id }));

  const inMonth = all.filter((r) => r.date.startsWith(month));
  const curResident = residentId || residents[0]?.id || '';
  const curStaff = staffId || accounts[0]?.staffId || '';

  return (
    <Modal
      title="帳票・集計"
      subtitle="印刷してそのまま実地指導・請求突合に使えます"
      onClose={closePanel}
      width={1000}
      footer={
        <>
          <button className="bt" onClick={() => notify('CSV出力は Phase 1b で実装します')}>CSV出力</button>
          <div className="spacer"></div>
          <button className="bt save" onClick={() => window.print()}>🖨 印刷 / PDF保存</button>
        </>
      }
    >
      <div className="sec">
        <div className="grid4" style={{ gridTemplateColumns: '1.7fr 1fr 1.3fr 1.3fr' }}>
          <div className="fld"><label htmlFor="rType">帳票の種類</label>
            <select id="rType" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="user">利用者別 月間サービス提供記録</option>
              <option value="staff">職員別 月間実績集計</option>
              <option value="summary">月間 利用者別 実績集計（請求突合用）</option>
            </select></div>
          <div className="fld"><label htmlFor="rMonth">対象年月</label>
            <input id="rMonth" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          {type === 'user' && (
            <div className="fld"><label htmlFor="rUser">利用者</label>
              <select id="rUser" value={curResident} onChange={(e) => setResidentId(e.target.value)}>
                {residents.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></div>
          )}
          {type === 'staff' && (
            <div className="fld"><label htmlFor="rStaff">職員</label>
              <select id="rStaff" value={curStaff} onChange={(e) => setStaffId(e.target.value)}>
                {accounts.map((a) => <option key={a.staffId} value={a.staffId}>{a.name}</option>)}
              </select></div>
          )}
        </div>
      </div>

      <div className="rep">
        {type === 'user' && <UserReport rows={inMonth.filter((r) => r.resident?.residentId === curResident)} month={month} />}
        {type === 'staff' && <StaffReport rows={inMonth.filter((r) => r.staffId === curStaff)} month={month} />}
        {type === 'summary' && <SummaryReport rows={inMonth} month={month} />}
      </div>
    </Modal>
  );
}

function UserReport({ rows, month }: { rows: VisitRow[]; month: string }) {
  const done = rows.filter((r) => deriveStatus(r.visit, r.record) !== 'キャンセル');
  const total = done.reduce((a, r) => a + durOf(r), 0);
  const notApproved = done.filter((r) => deriveStatus(r.visit, r.record) !== '完了').length;
  return (
    <>
      <div className="rhead"><div className="rt">訪問介護 サービス提供記録</div>
        <div className="rs">対象年月：{month}{'\u3000'}／{'\u3000'}利用者：{rows[0]?.resident?.name ?? '—'}</div></div>
      <div className="rsum">
        <span className="k">訪問回数<b>{done.length}回</b></span>
        <span className="k">提供時間合計<b>{hm(total)}</b></span>
        <span className="k">キャンセル<b>{rows.length - done.length}件</b></span>
        <span className="k">未承認<b>{notApproved}件</b></span>
      </div>
      <table className="rtable">
        <thead><tr><th>日</th><th>曜</th><th>予定</th><th>実績</th><th>分</th><th>サービス種別</th><th>実施内容</th><th>特記事項</th><th>担当者</th><th>確認</th></tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={10} className="c">この月の記録はありません</td></tr>
            : rows.map((r) => {
              const st = deriveStatus(r.visit, r.record);
              const a = r.record?.actualStart ?? '';
              const b = r.record?.actualEnd ?? '';
              return (
                <tr key={r.visit.visitId} className={st === 'キャンセル' ? 'cxl' : undefined}>
                  <td className="c">{Number(r.date.slice(8))}</td><td className="c">{dowOf(r.date)}</td>
                  <td className="c">{r.visit.startTime}〜{r.visit.endTime}</td>
                  <td className="c">{st === 'キャンセル' ? 'キャンセル' : a && b ? `${a}〜${b}` : '—'}</td>
                  <td className="r">{durOf(r) || ''}</td>
                  <td>{r.visit.serviceName}</td>
                  <td>{(r.record?.tasks ?? []).join('・')}</td>
                  <td>{r.record?.note ?? ''}</td>
                  <td>{r.staffName}</td>
                  <td className="c">{st === '完了' ? r.record?.approvedByName ?? '✓' : ''}</td>
                </tr>
              );
            })}
        </tbody>
        <tfoot><tr><td colSpan={4}>合計</td><td className="r">{total}</td><td colSpan={5}>{hm(total)}／{done.length}回</td></tr></tfoot>
      </table>
    </>
  );
}

function StaffReport({ rows, month }: { rows: VisitRow[]; month: string }) {
  // legacy/index.html:3644。職員別はキャンセルを除外する
  const list = rows.filter((r) => deriveStatus(r.visit, r.record) !== 'キャンセル');
  const byDate = new Map<string, VisitRow[]>();
  list.forEach((r) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]));
  const tn = list.length;
  const tm = list.reduce((a, r) => a + durOf(r), 0);
  return (
    <>
      <div className="rhead"><div className="rt">職員別 月間実績集計</div>
        <div className="rs">対象年月：{month}{'\u3000'}／{'\u3000'}職員：{rows[0]?.staffName ?? '—'}</div></div>
      <div className="rsum">
        <span className="k">稼働日数<b>{byDate.size}日</b></span>
        <span className="k">訪問件数<b>{tn}件</b></span>
        <span className="k">提供時間合計<b>{hm(tm)}</b></span>
        <span className="k">1件あたり平均<b>{tn ? Math.round(tm / tn) : 0}分</b></span>
      </div>
      <table className="rtable">
        <thead><tr><th>日</th><th>曜</th><th>件数</th><th>分</th><th>時間</th><th>訪問先</th></tr></thead>
        <tbody>
          {byDate.size === 0
            ? <tr><td colSpan={6} className="c">この月の記録はありません</td></tr>
            : [...byDate.entries()].sort().map(([d, l]) => {
              const m = l.reduce((a, r) => a + durOf(r), 0);
              return (
                <tr key={d}>
                  <td className="c">{Number(d.slice(8))}</td><td className="c">{dowOf(d)}</td>
                  <td className="r">{l.length}</td><td className="r">{m}</td><td className="c">{hm(m)}</td>
                  <td>{l.map((r) => `${r.record?.actualStart || r.visit.startTime} ${r.resident?.name ?? ''}（${r.visit.serviceName}）`).join('、')}</td>
                </tr>
              );
            })}
        </tbody>
        <tfoot><tr><td colSpan={2}>合計</td><td className="r">{tn}</td><td className="r">{tm}</td><td className="c">{hm(tm)}</td><td></td></tr></tfoot>
      </table>
    </>
  );
}

function SummaryReport({ rows, month }: { rows: VisitRow[]; month: string }) {
  const ids = [...new Set(rows.map((r) => r.resident?.residentId ?? r.visit.residentId))];
  let tn = 0; let tm = 0;
  const body = ids.map((id) => {
    const rs = rows.filter((r) => (r.resident?.residentId ?? r.visit.residentId) === id);
    const list = rs.filter((r) => deriveStatus(r.visit, r.record) !== 'キャンセル');
    const m = list.reduce((a, r) => a + durOf(r), 0);
    const notApproved = list.filter((r) => deriveStatus(r.visit, r.record) !== '完了').length;
    tn += list.length; tm += m;
    return { id, name: rs[0]?.resident?.name ?? id, careLevel: rs[0]?.resident?.carePlan.careLevel ?? '—',
      n: list.length, m, cxl: rs.length - list.length, notApproved };
  });
  return (
    <>
      <div className="rhead"><div className="rt">月間 利用者別 実績集計（請求突合用）</div>
        <div className="rs">対象年月：{month}</div></div>
      <div className="rsum">
        <span className="k">利用者数<b>{ids.length}名</b></span>
        <span className="k">訪問件数<b>{tn}件</b></span>
        <span className="k">提供時間合計<b>{hm(tm)}</b></span>
      </div>
      <table className="rtable">
        <thead><tr><th>利用者</th><th>要介護度</th><th>回数</th><th>分</th><th>時間</th><th>ｷｬﾝｾﾙ</th><th>未承認</th></tr></thead>
        <tbody>
          {body.length === 0
            ? <tr><td colSpan={7} className="c">この月の記録はありません</td></tr>
            : body.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td><td className="c">{b.careLevel}</td>
                <td className="r">{b.n}</td><td className="r">{b.m}</td><td className="c">{hm(b.m)}</td>
                <td className="r">{b.cxl || ''}</td>
                <td className="r">{b.notApproved ? <b style={{ color: '#a3243c' }}>{b.notApproved}</b> : ''}</td>
              </tr>
            ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>合計</td><td className="r">{tn}</td><td className="r">{tm}</td><td className="c">{hm(tm)}</td><td colSpan={2}></td></tr></tfoot>
      </table>
      <div className="rs">※「未承認」が残っている場合は、請求前にサービス提供責任者の確認を行ってください。</div>
    </>
  );
}
