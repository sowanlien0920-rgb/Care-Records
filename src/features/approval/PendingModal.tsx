/*
 * 未承認一覧。移植元: legacy/index.html:1394-1440（マークアップ）、:3457-3581
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * `.pend-head` と `.pend-row` は 36px 132px 104px 1fr 116px 132px の6カラムグリッド
 * （styles.css:425-427）で、**直下の子が span 6個ちょうど**であることに依存する。
 * チェックボックスをコンポーネントに切り出して div で包むと全カラムがずれる。
 * `.pend-row + .pend-row` は隣接兄弟で行間を作る（:432）。
 *
 * ── legacy の仕様として写しているもの ────────────────────
 * - 母集団は「完了でもキャンセルでもない」訪問（未完＋済）
 * - 期間は開始日の下限のみ。未来日は除外しない
 * - 「実績未入力」の行はチェックできない（disabled）
 * - 承認は confirm が先、権限確認が後
 * - CSV は現在の絞り込みを反映する（帳票側とは挙動が違う）
 */
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { canApprove } from '../../types/local';
import { deriveStatus } from '../../domain/visitStatus';
import { check, countNg } from '../../domain/compliance';
import { minutesOf } from '../../domain/aggregate';
import { downloadCsv, toCsv } from '../../utils/csv';
import { iso } from '../../utils/date';
import type { VisitRow } from '../../data/adapter';
import { StaleListNotice } from '../../components/StaleListNotice';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** legacy/index.html:3458-3461。過去なら正の日数 */
function dayDiff(dateStr: string): number {
  const a = new Date(`${iso(new Date())}T00:00:00`).getTime();
  const b = new Date(`${dateStr}T00:00:00`).getTime();
  return Math.round((a - b) / 86400000);
}

function dowOf(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()] ?? '';
}

export function PendingModal() {
  const { panel, closePanel, visitRows, staff, session, approveVisit, notify, openRecord, setDate, setStaffId, retry } = useCareStore();
  const [range, setRange] = useState('0');
  const [staffFilter, setStaffFilter] = useState('__all');
  const [kind, setKind] = useState('done');
  const [order, setOrder] = useState('old');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 承認中。確認文面が長くなったぶん、二度押しで承認が重なりやすい */
  const [busy, setBusy] = useState(false);

  if (panel !== 'pending') return null;

  const all = visitRows.status === 'ready' ? visitRows.data.rows : [];
  const accounts = staff.status === 'ready' ? staff.data : [];

  // legacy/index.html:3462。完了とキャンセルを除いたものが母集団
  const base = all.filter((r) => {
    const st = deriveStatus(r.visit, r.record);
    return st !== '完了' && st !== 'キャンセル';
  });

  const days = Number(range);
  let from = '0000-00-00';
  if (days > 0) { const d = new Date(); d.setDate(d.getDate() - days); from = iso(d); }

  const list = base.filter((r) => {
    if (r.date < from) return false;
    if (staffFilter !== '__all' && r.staffId !== staffFilter) return false;
    const st = deriveStatus(r.visit, r.record);
    if (kind === 'done' && st !== '済') return false;
    // legacy/index.html:3479。特記事項が「ある」ものを除外する。状態は見ない
    if (kind === 'nonote' && (r.record?.note ?? '').trim()) return false;
    return true;
  }).sort((a, b) => (a.date + a.visit.startTime + a.staffName).localeCompare(b.date + b.visit.startTime + b.staffName));
  if (order === 'new') list.reverse();

  const ready = list.filter((r) => deriveStatus(r.visit, r.record) === '済');
  const noNote = list.filter((r) => !(r.record?.note ?? '').trim()).length;
  const old7 = list.filter((r) => dayDiff(r.date) >= 7).length;

  /*
   * 記載チェックの要修正件数。legacy/index.html:3492 / :3504 / :3554 / :3577 が
   * 同じ式を使う。数えるのは「済」の記録の指摘の**件数**で、記録の数ではない。
   * 特記事項が空の記録は判定が warn 1件で打ち切られるため、ここでは 0 件になる
   * （legacy と同じ。`compliance.ts` のコメントを参照）
   */
  const ngOf = (r: VisitRow): number => (deriveStatus(r.visit, r.record) === '済' && r.record !== undefined
    ? countNg(check(r.record, r.resident?.carePlan))
    : 0);
  const ngTotal = list.reduce((a, r) => a + ngOf(r), 0);

  /*
   * 未送信の記録は選べない（Phase 5b）。
   *
   * この端末にしか無い記録に承認を付けても、届く先が無い。実施一覧の行では
   * 承認ボタンを「送信待ち」にして塞いであり（`visitList/VisitRow.tsx`）、
   * ここだけ承認できると画面によって可否が変わることになる。
   * legacy の「実績未入力の行はチェックできない」と同じ扱いにする。
   */
  const selectable = list.filter((r) => deriveStatus(r.visit, r.record) === '済' && !r.pending);
  const pendingCount = list.filter((r) => deriveStatus(r.visit, r.record) === '済' && r.pending).length;
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function approveSelected() {
    if (busy) return;
    const targets = selectable.filter((r) => selected.has(r.visit.visitId));
    if (targets.length === 0) { notify('承認する記録を選択してください'); return; }
    const noNoteN = targets.filter((r) => !(r.record?.note ?? '').trim()).length;
    // legacy/index.html:3554-3558。件数の単位が違う（未記入は記録数、要修正は指摘の件数）
    const ngN = targets.reduce((a, r) => a + ngOf(r), 0);
    let msg = `${targets.length}件を承認して「完了」にします。`;
    if (noNoteN) msg += `\n\n・特記事項が未記入：${noNoteN}件`;
    if (ngN) msg += `\n・記載チェックの要修正：${ngN}件`;
    if (noNoteN || ngN) msg += '\n\n内容を確認せずに承認すると、実地指導で指摘を受けるおそれがあります。';
    if (!window.confirm(`${msg}\n\n承認しますか？`)) return;
    if (!canApprove(session)) { notify('承認権限がありません。'); return; }
    setBusy(true);
    let done = 0;
    try {
      for (const t of targets) {
        if (await approveVisit(t.visit.visitId)) done += 1;
      }
    } finally {
      setBusy(false);
    }
    setSelected(new Set());
    // 承認できた件数だけを伝える。件数を偽ると、承認されていない記録が
    // 承認済みとして扱われ、請求前の確認をすり抜ける
    notify(done === targets.length
      ? `${done}件を承認しました（承認者：${session.name}）`
      : `${done}件を承認しました。${targets.length - done}件は承認できませんでした。`);
  }

  /*
   * 未承認一覧の CSV。legacy/index.html:3574-3578 の12列をそのまま写す。
   * 母集団は画面が描いている list そのもの（legacy も同じ）。
   */
  const exportCsv = () => {
    // 未承認の記録は請求前の確認に使う。「まだ読めていない」を0件と言わない
    if (visitRows.status === 'loading') { notify('読み込み中です。少し待ってからもう一度お試しください。'); return; }
    if (visitRows.status === 'error') { notify('記録を読み取れていないため出力できません。再試行してください。'); return; }
    if (list.length === 0) { notify('出力するデータがありません'); return; }
    const head = ['サービス提供日', '曜日', '経過日数', '担当職員', '利用者', 'サービス種別',
      '予定', '実績', '提供分', '状態', '特記事項', '要修正件数'];
    const body = list.map((r) => [
      r.date, dowOf(r.date), dayDiff(r.date), r.staffName,
      r.resident?.name ?? r.visit.residentId, r.visit.serviceName,
      `${r.visit.startTime}-${r.visit.endTime}`,
      `${r.record?.actualStart ?? ''}-${r.record?.actualEnd ?? ''}`,
      minutesOf(r.record), deriveStatus(r.visit, r.record), r.record?.note ?? '',
      // legacy は「済」以外を空欄にする（0 ではない）。判定していないことを 0 と書かない
      deriveStatus(r.visit, r.record) === '済' ? ngOf(r) : '',
    ]);
    downloadCsv(`未承認一覧_${iso(new Date())}.csv`, toCsv([head, ...body]));
    notify('CSVを出力しました');
  };

  const openFromRow = (r: VisitRow) => {
    // legacy/index.html:3545-3548。日付と職員を合わせてから記録を開く
    closePanel();
    setDate(r.date);
    setStaffId(r.staffId);
    openRecord(r.visit.visitId);
  };

  return (
    <Modal
      title="未承認の記録"
      subtitle="全職員・全期間の未承認記録をまとめて確認し、承認できます"
      onClose={closePanel}
      width={1060}
      footer={
        <>
          <span className="sumline">{selected.size}件を選択中</span>
          <div className="spacer"></div>
          <button className="bt" onClick={exportCsv}>CSV出力</button>
          <button className="bt save" disabled={busy} onClick={() => { void approveSelected(); }}>
            {busy ? '承認中…' : '選択した記録を承認'}</button>
        </>
      }
    >
      <div className="sec">
        <div className="grid4">
          <div className="fld"><label htmlFor="pRange">期間</label>
            <select id="pRange" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="0">すべて</option><option value="7">直近7日</option>
              <option value="30">直近30日</option><option value="90">直近90日</option>
            </select></div>
          <div className="fld"><label htmlFor="pStaffF">担当職員</label>
            <select id="pStaffF" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="__all">すべての職員</option>
              {accounts.map((a) => <option key={a.staffId} value={a.staffId}>{a.name}</option>)}
            </select></div>
          <div className="fld"><label htmlFor="pKind">対象</label>
            <select id="pKind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="done">承認待ち（実績入力済み）</option>
              <option value="all">未承認すべて（実績未入力を含む）</option>
              <option value="nonote">特記事項が未記入のもの</option>
            </select></div>
          <div className="fld"><label htmlFor="pOrder">並び順</label>
            <select id="pOrder" value={order} onChange={(e) => setOrder(e.target.value)}>
              <option value="old">古い順（滞留を優先）</option><option value="new">新しい順</option>
            </select></div>
        </div>
        <div className="rsum" id="pStats">
          <span className="k">承認待ち<b>{ready.length}件</b></span>
          <span className="k">実績未入力<b>{list.length - ready.length}件</b></span>
          <span className="k">特記事項が未記入<b>{noNote}件</b></span>
          <span className="k" style={old7 ? { background: '#fff8e8', borderColor: '#f2dfb4', color: '#8a6412' } : undefined}>
            7日以上経過<b>{old7}件</b></span>
          {/* legacy/index.html:3498。0件でなければ .lv-ng と同じ色にする */}
          <span className="k" style={ngTotal ? { background: '#fdecef', borderColor: '#f6c9d3', color: '#a3243c' } : undefined}>
            記載チェック要修正<b>{ngTotal}件</b></span>
          {/*
            未送信は選べないので、その件数を出しておかないと
            「承認待ちに出ているのにチェックできない」理由が分からない（Phase 5b）
          */}
          {pendingCount > 0 && (
            <span className="k" style={{ background: '#fff8e8', borderColor: '#f2dfb4', color: '#8a6412' }}>
              未送信（承認できません）<b>{pendingCount}件</b></span>
          )}
        </div>
      </div>

      <div className="sec">
        <h3>対象一覧 <span className="bchip">{list.length}件</span></h3>
        <StaleListNotice show={visitRows.status === 'ready' && visitRows.data.fromCache} />
        <div className="pend-head">
          <span><input type="checkbox" title="すべて選択"
            checked={selectable.length > 0 && selected.size === selectable.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.visit.visitId)) : new Set())} /></span>
          <span>サービス提供日</span><span>時間</span><span>利用者／サービス</span><span>担当職員</span><span>状態・チェック</span>
        </div>
        <div className="plist" style={{ maxHeight: 340 }}>
          {visitRows.status === 'loading' && <div className="hempty">読み込んでいます…</div>}
          {/* 取得の失敗を 0件として出すと、未承認が残っていても「ありません」と読める */}
          {visitRows.status === 'error' && (
            <div className="hempty">{visitRows.message}
              <button className="chipbtn" style={{ marginLeft: 8 }} onClick={retry}>再試行</button>
            </div>
          )}
          {visitRows.status === 'ready' && (list.length === 0
            ? <div className="hempty">条件に合う未承認の記録はありません</div>
            : list.map((r) => {
              const st = deriveStatus(r.visit, r.record);
              const d = dayDiff(r.date);
              const cls = d >= 14 ? 'ng' : d >= 7 ? 'warn' : '';
              const a = r.record?.actualStart ?? '';
              const b = r.record?.actualEnd ?? '';
              return (
                // 直下は span 6個。ラッパーを挟むとグリッドが崩れる
                <div className="pend-row" key={r.visit.visitId} onClick={() => openFromRow(r)}>
                  <span onClick={(e) => e.stopPropagation()}>
                    {/*
                      未送信も選べなくする（Phase 5b）。`selectable` から外しただけでは
                      チェックが入り「1件を選択中」と出るのに、承認を押すと
                      「承認する記録を選択してください」になる。選んで見えているものが
                      選ばれていない状態になるため、入力の側で塞ぐ。
                    */}
                    <input type="checkbox" checked={selected.has(r.visit.visitId)}
                      disabled={st !== '済' || r.pending}
                      title={st !== '済' ? '実績時間が未入力のため承認できません'
                        : r.pending ? 'この端末にだけ保存されています。電波が戻ると送信され、承認できるようになります'
                        : undefined}
                      onChange={() => toggle(r.visit.visitId)} />
                  </span>
                  <span className="dt">{r.date.replace(/-/g, '/')}（{dowOf(r.date)}）
                    {d > 0 && <i className={`age ${cls}`}>{d}日前</i>}</span>
                  <span className="tm">{a && b ? `${a}〜${b}` : `予 ${r.visit.startTime}〜`}</span>
                  <span><span className="nm">{r.resident?.name ?? r.visit.residentId} 様</span>
                    <span className="sv">{r.visit.serviceName}
                      {(r.record?.tasks.length ?? 0) > 0 ? `／${r.record?.tasks.slice(0, 3).join('・')}` : ''}</span></span>
                  <span className="stf">{r.staffName}</span>
                  <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span className={`badge ${st === '済' ? 'b-reg' : 'b-wait'}`}
                      style={{ minWidth: 46, fontSize: 11.5, padding: '4px 8px' }}>{st}</span>
                    {/* legacy/index.html:3504-3505。要修正が出ていれば「特記なし」は出さない */}
                    {ngOf(r) > 0
                      ? <span className="bchip ng">要修正{ngOf(r)}</span>
                      : !(r.record?.note ?? '').trim() && <span className="bchip">特記なし</span>}
                  </span>
                </div>
              );
            }))}
        </div>
      </div>
    </Modal>
  );
}
