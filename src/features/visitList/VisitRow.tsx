/*
 * 一覧の1行。移植元: legacy/index.html:1765-1782
 *
 * ── DOM 構造を変えてはいけない理由 ──────────────────────
 * .row は grid-template-columns:78px 152px 1fr 210px 122px（styles.css:146）で、
 * **直下の子が5個であること**に依存している。ラッパーを1つ挟むだけで崩れる。
 * 第1カラムはクラスの無い裸の div で、これを省いて .badge を直下に置くと
 * カラムの対応がずれる。
 *
 * .times .t+.t（styles.css:170）は隣接兄弟セレクタ。2つの .t が同じ親の
 * 連続した兄弟でないと、2行目の margin-top が消える。
 *
 * .track-cell > .track の2重ラップも必要（.row のグリッド子は .track-cell 側で、
 * 900px 以下では .row .track-cell が display:none になる）。
 */
import type { DispatchVisit, ResidentBrief, VisitRecord, VisitStatus } from '../../types/contract';
import { deriveStatus, tasksOf } from '../../domain/visitStatus';
import { toMin } from '../../utils/date';

/** legacy/index.html:1704。一覧のバーは 05:00〜21:00 を 0〜100% にマップする */
const DAY_S = 5 * 60;
const DAY_E = 21 * 60;

function pct(m: number | null): number {
  // legacy は null を数値として扱い 0 に丸めていた（:1740）。同じ結果にする
  const v = m ?? 0;
  return Math.max(0, Math.min(100, ((v - DAY_S) / (DAY_E - DAY_S)) * 100));
}

/** legacy/index.html:1737-1739。未完と未知の状態はどちらも b-wait になる */
function badgeClass(s: VisitStatus): string {
  return s === '済' ? 'b-reg' : s === '完了' ? 'b-fin' : s === 'キャンセル' ? 'b-cxl' : 'b-wait';
}

export function VisitRow({
  visit, record, resident, onStart, onEnd, onApprove, onEdit,
}: {
  visit: DispatchVisit;
  record: VisitRecord | undefined;
  resident: ResidentBrief | undefined;
  onStart: () => void;
  onEnd: () => void;
  onApprove: () => void;
  onEdit: () => void;
}) {
  const status = deriveStatus(visit, record);
  const ps = toMin(visit.startTime);
  const pe = toMin(visit.endTime);
  const as = toMin(record?.actualStart ?? '');
  const ae = toMin(record?.actualEnd ?? '');
  const hasActual = as !== null && ae !== null && ae > as;

  // legacy/index.html:1754。実績が揃っていれば実績分、そうでなければ予定分
  const dur = hasActual ? ae - as : (pe ?? 0) - (ps ?? 0);
  const tasks = tasksOf(record, resident);

  // legacy/index.html:1761-1764。承認は「済」のときだけ。記録は常に出る
  const actual = record?.actualStart ?? '';
  const actualEnd = record?.actualEnd ?? '';
  const lead =
    status === '未完' && !actual ? <button className="mini go" data-go={visit.visitId} onClick={onStart}>開始</button>
    : status === '未完' && actual && !actualEnd ? <button className="mini stop" data-stop={visit.visitId} onClick={onEnd}>終了</button>
    : status === '済' ? <button className="mini ok" data-ok={visit.visitId} onClick={onApprove}>承認</button>
    : null;

  return (
    <div
      className={`row ${status === 'キャンセル' ? 'is-cxl' : ''}`}
      data-id={visit.visitId}
      // legacy/index.html:1820。ボタン以外をクリックすると記録画面が開く
      onClick={(e) => { if (!(e.target as HTMLElement).closest('.acts')) onEdit(); }}
    >
      {/* 第1カラム。クラスの無い裸の div は grid の対応上あえて残す */}
      <div><span className={`badge ${badgeClass(status)}`}>{status}</span></div>

      <div className="times">
        <div className="t"><span className="lab">予</span><span className="val">{visit.startTime} 〜 {visit.endTime}</span></div>
        {/* legacy/index.html:1758。開始だけ打刻済みでも「未記録」と出る */}
        <div className="t"><span className="lab act">実</span>
          {actual && actualEnd
            ? <span className="val">{actual} 〜 {actualEnd}</span>
            : <span className="val muted">未記録</span>}
        </div>
      </div>

      <div className="who">
        <div className="name">{resident?.name ?? visit.residentId}<span className="sama">様</span></div>
        <div className="meta">
          <span className="tag svc">{visit.serviceName}</span>
          {/* legacy/index.html:1775-1776。先頭3件のみ表示し、残りは +N に畳む */}
          {tasks.slice(0, 3).map((t) => <span className="tag" key={t}>{t}</span>)}
          {tasks.length > 3 && <span className="tag">+{tasks.length - 3}</span>}
        </div>
        {record?.note
          ? <div className="note">{record.noteSource === 'ai' ? '✨' : '📝'} {record.note}</div>
          : null}
      </div>

      <div className="track-cell">
        <div className="track">
          {/* 予定バーは常に出る。実績バーは実績が揃ったときだけ */}
          <div className="seg plan" style={{ left: `${pct(ps)}%`, width: `${Math.max(1.2, pct(pe) - pct(ps))}%` }}></div>
          {hasActual && (
            <div className={`seg act ${status === '完了' ? 'fin' : ''}`}
              style={{ left: `${pct(as)}%`, width: `${Math.max(1.2, pct(ae) - pct(as))}%` }}></div>
          )}
          <span className="dur">{dur}分</span>
        </div>
      </div>

      <div className="acts">
        {lead}
        <button className="mini" data-edit={visit.visitId} onClick={onEdit}>記録</button>
      </div>
    </div>
  );
}
