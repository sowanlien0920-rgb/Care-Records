/*
 * 未完了の訪問（マイタスク）。移植元: legacy/index.html:1345-1392、:3246-3455
 *
 * ── DOM を変えてはいけない箇所 ──────────────────────────
 * `.todo-head` / `.todo-row` は 118px 108px 1fr 104px 108px 200px の6カラムグリッド
 * （styles.css:452-454）。直下の子が span 6個であることに依存する。
 * ステージ2の行だけ `.todo-inline` が**7番目の子**として付き、`grid-column:1/-1`
 * でグリッドに直接参加する（:480）。フラグメントや div で包むと折り返さない。
 * `.todo-row + .todo-row` は隣接兄弟で行間を作る（:459）。
 *
 * ── legacy の仕様 ───────────────────────────────────────
 * ステージ判定は status を見るのは最初の1行だけで、あとは実績と特記事項の
 * 有無で決まる（legacy/index.html:3248-3254）。「済」でも特記事項が空なら
 * ステージ2として未完了に残る。
 * バッジは常に「自分の担当・本日まで」固定で、この画面の絞り込みと連動しない。
 */
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { isSupervisor } from '../../types/local';
import { todoStage } from '../../domain/visitStatus';
import { iso } from '../../utils/date';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;
const LABEL = ['未着手', '対応中', '記録未完成'] as const;

function dowOf(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()] ?? '';
}

export function TodoModal() {
  const {
    panel, closePanel, visitRows, session, notify,
    openRecord, setDate, setStaffId, stampStartAt, stampEndAt,
  } = useCareStore();
  const sup = isSupervisor(session);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [range, setRange] = useState<'today' | 'only' | 'all'>('today');
  const [kind, setKind] = useState<'all' | '0' | '1' | '2'>('all');

  if (panel !== 'todo') return null;

  const all = visitRows.status === 'ready' ? visitRows.data : [];
  const today = iso(new Date());
  // legacy/index.html:3349-3350。サ責以外は自分固定
  const effScope = sup ? scope : 'me';

  const list = all.filter((r) => {
    const st = todoStage(r.visit, r.record);
    if (st < 0) return false;
    if (kind !== 'all' && st !== Number(kind)) return false;
    if (effScope === 'me' && r.staffId !== session?.staffId) return false;
    if (range === 'today' && r.date > today) return false;
    if (range === 'only' && r.date !== today) return false;
    return true;
  }).sort((a, b) => (a.date + a.visit.startTime).localeCompare(b.date + b.visit.startTime));

  const counts = [0, 0, 0];
  list.forEach((r) => { const st = todoStage(r.visit, r.record); if (st >= 0 && st <= 2) counts[st] = (counts[st] ?? 0) + 1; });
  const late = list.filter((r) => r.date < today).length;

  return (
    <Modal
      title="未完了の訪問"
      subtitle={`${session ? `${session.name} さん` : ''}／終了まで済んでいない訪問をこの画面から記録できます`}
      onClose={closePanel}
      width={1060}
      footer={
        <>
          <span className="sumline">{list.length ? 'この画面から打刻・記録の作成ができます。' : ''}</span>
          <div className="spacer"></div>
          <button className="bt" onClick={closePanel}>閉じる</button>
        </>
      }
    >
      <div className="sec">
        <div className="grid4">
          <div className="fld"><label htmlFor="tScope">対象</label>
            <select id="tScope" value={effScope} disabled={!sup} onChange={(e) => setScope(e.target.value as 'me' | 'all')}>
              <option value="me">自分の担当</option><option value="all">全職員</option>
            </select></div>
          <div className="fld"><label htmlFor="tRange">期間</label>
            <select id="tRange" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="today">本日まで（積み残しを含む）</option>
              <option value="only">本日のみ</option>
              <option value="all">すべて（今後の予定も含む）</option>
            </select></div>
          <div className="fld"><label htmlFor="tKind">状態</label>
            <select id="tKind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">すべての未完了</option>
              <option value="0">未着手（実績なし）</option>
              <option value="1">対応中（終了時刻が未入力）</option>
              <option value="2">記録未完成（特記事項なし）</option>
            </select></div>
          <div className="fld"><label>&nbsp;</label>
            <button className="ghost" style={{ width: '100%' }} onClick={() => notify('最新の状態に更新しました')}>最新の状態に更新</button></div>
        </div>
        <div className="rsum">
          <span className="k">未着手<b>{counts[0]}件</b></span>
          <span className="k">対応中<b>{counts[1]}件</b></span>
          <span className="k">記録未完成<b>{counts[2]}件</b></span>
          <span className="k" style={late ? { background: '#fff8e8', borderColor: '#f2dfb4', color: '#8a6412' } : undefined}>
            前日以前の積み残し<b>{late}件</b></span>
        </div>
      </div>

      <div className="sec">
        <h3>対象一覧 <span className="bchip">{list.length}件</span></h3>
        <div className="todo-head">
          <span>サービス提供日</span><span>時間</span><span>利用者／サービス</span>
          <span>担当職員</span><span>状態</span><span style={{ textAlign: 'right' }}>操作</span>
        </div>
        <div className="plist" style={{ maxHeight: 380 }}>
          {list.length === 0
            ? <div className="todo-empty"><div className="ico">✓</div>
                未完了の訪問はありません。<br />本日分の記録はすべて終了しています。</div>
            : list.map((r) => {
              const st = todoStage(r.visit, r.record);
              const a = r.record?.actualStart ?? '';
              const b = r.record?.actualEnd ?? '';
              const open = () => { closePanel(); setDate(r.date); setStaffId(r.staffId); openRecord(r.visit.visitId); };
              return (
                <div className={`todo-row ${r.date < today ? 'late' : ''}`} key={r.visit.visitId}>
                  <span className="dt">{r.date.replace(/-/g, '/')}（{dowOf(r.date)}）</span>
                  <span className="tm">{a ? `${a}〜${b || '—'}` : `予 ${r.visit.startTime}〜${r.visit.endTime}`}</span>
                  <span><span className="nm">{r.resident?.name ?? r.visit.residentId} 様</span>
                    <span className="sv">{r.visit.serviceName}
                      {(r.record?.tasks.length ?? 0) > 0 ? `／${r.record?.tasks.slice(0, 3).join('・')}` : ''}</span></span>
                  <span className="stf">{r.staffName}</span>
                  <span><span className={`tchip t${st}`}>{LABEL[st] ?? ''}</span></span>
                  <span className="todo-act">
                    {st === 0 && <button className="mini go" onClick={() => { void stampStartAt(r.visit.visitId); }}>開始</button>}
                    {st === 1 && <button className="mini stop" onClick={() => { void stampEndAt(r.visit.visitId); }}>終了</button>}
                    {st === 2 && (
                      <button className="mini" style={{ background: 'linear-gradient(120deg,#6a4bd6,#2b7ee6)', color: '#fff', border: 0 }}
                        onClick={() => notify('特記事項の自動作成は Phase 1b で実装します')}>✨ 特記事項</button>
                    )}
                    <button className="mini" onClick={open}>記録</button>
                  </span>
                  {/* ステージ2の行だけ 7番目の子として付く。grid-column:1/-1 で折り返す */}
                  {st === 2 && (
                    <div className="todo-inline">
                      <select title="ご本人の様子" defaultValue="いつもと変わりなし"
                        onChange={() => notify('ご本人の様子の保存は Phase 1b で実装します')}>
                        <option>いつもと変わりなし</option><option>体調良好・表情明るい</option>
                        <option>やや元気がない</option><option>痛みの訴えあり</option>
                      </select>
                      <div className="memowrap">
                        <input className="memo" placeholder="メモ（任意）例：昼食を半分残された／膝の痛みの訴えあり"
                          onChange={() => { /* Phase 1b でメモを保存する */ }} />
                        <button className="micmini" title="メモを音声入力"
                          onClick={() => notify('音声入力は Phase 1b で実装します')}>🎤</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </Modal>
  );
}
