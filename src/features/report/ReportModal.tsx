/*
 * 帳票・集計。移植元: legacy/index.html:1442-1470、:3583-3749
 *
 * 集計は domain/aggregate.ts に置き、この画面は結果を描くだけにしてある。
 * CSV も同じ関数の結果から組み立てるので、画面と CSV の数字がずれない。
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
import { hm, minutesOf, staffReport, summaryReport, userReport } from '../../domain/aggregate';
import { downloadCsv, toCsv } from '../../utils/csv';
import type { VisitRow } from '../../data/adapter';
import { StaleListNotice } from '../../components/StaleListNotice';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

function dowOf(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()] ?? '';
}

export function ReportModal() {
  const { panel, closePanel, visitRows, staff, date, notify, retry } = useCareStore();
  const [type, setType] = useState<'user' | 'staff' | 'summary'>('user');
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const [residentId, setResidentId] = useState('');
  const [staffId, setStaffId] = useState('');

  if (panel !== 'report') return null;

  const all = visitRows.status === 'ready' ? visitRows.data.rows : [];
  const accounts = staff.status === 'ready' ? staff.data : [];
  const residents = [...new Map(all.filter((r) => r.resident !== undefined)
    .map((r) => [r.resident?.residentId ?? '', r.resident])).entries()]
    .map(([id, r]) => ({ id, name: r?.name ?? id }));

  const inMonth = all.filter((r) => r.date.startsWith(month));
  const curResident = residentId || residents[0]?.id || '';
  const curStaff = staffId || accounts[0]?.staffId || '';

  /*
   * 帳票 CSV。legacy/index.html:3725-3745 の列をそのまま写す。
   *
   * 画面と同じ集計関数（domain/aggregate.ts）から組み立てるので、合計がずれない。
   * legacy との意図的な差が2つある（計画書 Q5）。
   *   - 職員別はキャンセルを除外する（legacy の CSV だけ含んでいて、画面と食い違っていた）
   *   - 0件なら中断する（legacy はヘッダ行だけのファイルを出す）
   */
  const exportCsv = () => {
    /*
     * 帳票は請求突合と実地指導に使う。「まだ読めていない」と「0件だった」を
     * 同じ文言で返すと、記録が無いことの証明として読めてしまう（:134-137 と同じ理由）
     */
    if (visitRows.status === 'loading') { notify('読み込み中です。少し待ってからもう一度お試しください。'); return; }
    if (visitRows.status === 'error') { notify('記録を読み取れていないため出力できません。再試行してください。'); return; }
    if (type === 'staff') {
      const agg = staffReport(inMonth.filter((r) => r.staffId === curStaff));
      if (agg.list.length === 0) { notify('出力するデータがありません'); return; }
      const head = ['日付', '曜日', '利用者', 'サービス種別', '予定', '実績', '提供分', '状態'];
      const body = agg.list.map((r) => [
        r.date, dowOf(r.date), r.resident?.name ?? r.visit.residentId, r.visit.serviceName,
        `${r.visit.startTime}-${r.visit.endTime}`,
        `${r.record?.actualStart ?? ''}-${r.record?.actualEnd ?? ''}`,
        minutesOf(r.record), deriveStatus(r.visit, r.record),
      ]);
      const name = accounts.find((a) => a.staffId === curStaff)?.name ?? curStaff;
      downloadCsv(`月間実績_${name}_${month}.csv`, toCsv([head, ...body]));
    } else if (type === 'user') {
      // 利用者別はキャンセルも行に出す（画面の表と同じ）
      const rows = inMonth.filter((r) => r.resident?.residentId === curResident);
      if (rows.length === 0) { notify('出力するデータがありません'); return; }
      const head = ['日付', '曜日', '予定', '実績', '提供分', 'サービス種別', '実施内容', '特記事項', '担当職員', '状態'];
      const body = rows.map((r) => [
        r.date, dowOf(r.date),
        `${r.visit.startTime}-${r.visit.endTime}`,
        `${r.record?.actualStart ?? ''}-${r.record?.actualEnd ?? ''}`,
        minutesOf(r.record), r.visit.serviceName, (r.record?.tasks ?? []).join('・'),
        r.record?.note ?? '', r.staffName, deriveStatus(r.visit, r.record),
      ]);
      const name = rows[0]?.resident?.name ?? curResident;
      downloadCsv(`サービス提供記録_${name}_${month}.csv`, toCsv([head, ...body]));
    } else {
      const agg = summaryReport(inMonth);
      if (agg.lines.length === 0) { notify('出力するデータがありません'); return; }
      const head = ['利用者', '要介護度', '訪問回数', '提供分', 'キャンセル', '未承認'];
      const body = agg.lines.map((b) => [b.name, b.careLevel, b.visits, b.minutes, b.cancelled, b.notApproved]);
      downloadCsv(`月間実績集計_${month}.csv`, toCsv([head, ...body]));
    }
    notify('CSVを出力しました');
  };

  return (
    <Modal
      title="帳票・集計"
      subtitle="印刷してそのまま実地指導・請求突合に使えます"
      onClose={closePanel}
      width={1000}
      footer={
        <>
          <button className="bt" onClick={exportCsv}>CSV出力</button>
          <div className="spacer"></div>
          {/* 読めていない状態のまま印刷させない。帳票は請求突合の証跡になる */}
          <button className="bt save" disabled={visitRows.status !== 'ready'}
            onClick={() => window.print()}>🖨 印刷 / PDF保存</button>
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

      {/*
        * 取得できていない状態で表を出すと「この月の記録はありません」になり、
        * 記録が無いことの証明として読めてしまう。帳票は請求突合に使うため、
        * 読めていないことは読めていないと出す。
        */}
      {visitRows.status !== 'ready' ? (
        <div className="sec">
          <div className="hempty">
            {visitRows.status === 'loading' ? '読み込んでいます…' : visitRows.message}
            {visitRows.status === 'error' && (
              <button className="chipbtn" style={{ marginLeft: 8 }} onClick={retry}>再試行</button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/*
            * 帳票は請求突合に使う。圏外で開くと、この端末が最後に通信できた時点の
            * 集計を「実績」として出してしまう。CSV に落とすと出所の情報が消えるため、
            * 画面の側で必ず断る。**`.rep` の外に置く。** `.rep` は overflow:auto
            * （styles.css:487）で、中に入れると表をスクロールした時点で断りが消える
            */}
          <StaleListNotice show={visitRows.data.fromCache} />
          <div className="rep">
            {type === 'user' && <UserReport rows={inMonth.filter((r) => r.resident?.residentId === curResident)} month={month} />}
            {type === 'staff' && <StaffReport rows={inMonth.filter((r) => r.staffId === curStaff)} month={month} />}
            {type === 'summary' && <SummaryReport rows={inMonth} month={month} />}
          </div>
        </>
      )}
    </Modal>
  );
}

function UserReport({ rows, month }: { rows: VisitRow[]; month: string }) {
  const agg = userReport(rows);
  const total = agg.totalMinutes;
  return (
    <>
      <div className="rhead"><div className="rt">訪問介護 サービス提供記録</div>
        <div className="rs">対象年月：{month}{'\u3000'}／{'\u3000'}利用者：{rows[0]?.resident?.name ?? '—'}</div></div>
      <div className="rsum">
        <span className="k">訪問回数<b>{agg.done.length}回</b></span>
        <span className="k">提供時間合計<b>{hm(total)}</b></span>
        <span className="k">キャンセル<b>{agg.cancelled}件</b></span>
        <span className="k">未承認<b>{agg.notApproved}件</b></span>
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
                  <td className="r">{minutesOf(r.record) || ''}</td>
                  <td>{r.visit.serviceName}</td>
                  <td>{(r.record?.tasks ?? []).join('・')}</td>
                  <td>{r.record?.note ?? ''}</td>
                  <td>{r.staffName}</td>
                  <td className="c">{st === '完了' ? r.record?.approvedByName ?? '✓' : ''}</td>
                </tr>
              );
            })}
        </tbody>
        <tfoot><tr><td colSpan={4}>合計</td><td className="r">{total}</td><td colSpan={5}>{hm(total)}／{agg.done.length}回</td></tr></tfoot>
      </table>
    </>
  );
}

function StaffReport({ rows, month }: { rows: VisitRow[]; month: string }) {
  // legacy/index.html:3644。職員別はキャンセルを除外する（aggregate 側で行っている）
  const agg = staffReport(rows);
  const tn = agg.visits;
  const tm = agg.totalMinutes;
  return (
    <>
      <div className="rhead"><div className="rt">職員別 月間実績集計</div>
        <div className="rs">対象年月：{month}{'\u3000'}／{'\u3000'}職員：{rows[0]?.staffName ?? '—'}</div></div>
      <div className="rsum">
        <span className="k">稼働日数<b>{agg.byDate.length}日</b></span>
        <span className="k">訪問件数<b>{tn}件</b></span>
        <span className="k">提供時間合計<b>{hm(tm)}</b></span>
        <span className="k">1件あたり平均<b>{agg.average}分</b></span>
      </div>
      <table className="rtable">
        <thead><tr><th>日</th><th>曜</th><th>件数</th><th>分</th><th>時間</th><th>訪問先</th></tr></thead>
        <tbody>
          {agg.byDate.length === 0
            ? <tr><td colSpan={6} className="c">この月の記録はありません</td></tr>
            : agg.byDate.map((d) => (
              <tr key={d.date}>
                <td className="c">{Number(d.date.slice(8))}</td><td className="c">{dowOf(d.date)}</td>
                <td className="r">{d.rows.length}</td><td className="r">{d.minutes}</td><td className="c">{hm(d.minutes)}</td>
                <td>{d.rows.map((r) => `${r.record?.actualStart || r.visit.startTime} ${r.resident?.name ?? ''}（${r.visit.serviceName}）`).join('、')}</td>
              </tr>
            ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>合計</td><td className="r">{tn}</td><td className="r">{tm}</td><td className="c">{hm(tm)}</td><td></td></tr></tfoot>
      </table>
    </>
  );
}

function SummaryReport({ rows, month }: { rows: VisitRow[]; month: string }) {
  const agg = summaryReport(rows);
  const tn = agg.visits;
  const tm = agg.totalMinutes;
  return (
    <>
      <div className="rhead"><div className="rt">月間 利用者別 実績集計（請求突合用）</div>
        <div className="rs">対象年月：{month}</div></div>
      <div className="rsum">
        <span className="k">利用者数<b>{agg.residents}名</b></span>
        <span className="k">訪問件数<b>{tn}件</b></span>
        <span className="k">提供時間合計<b>{hm(tm)}</b></span>
      </div>
      <table className="rtable">
        <thead><tr><th>利用者</th><th>要介護度</th><th>回数</th><th>分</th><th>時間</th><th>ｷｬﾝｾﾙ</th><th>未承認</th></tr></thead>
        <tbody>
          {agg.lines.length === 0
            ? <tr><td colSpan={7} className="c">この月の記録はありません</td></tr>
            : agg.lines.map((b) => (
              <tr key={b.residentId}>
                <td>{b.name}</td><td className="c">{b.careLevel || '—'}</td>
                <td className="r">{b.visits}</td><td className="r">{b.minutes}</td><td className="c">{hm(b.minutes)}</td>
                <td className="r">{b.cancelled || ''}</td>
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
