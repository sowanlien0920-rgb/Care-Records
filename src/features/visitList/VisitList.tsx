/*
 * サービス実施一覧。移植元: legacy/index.html:861-879（パネル）、:1742-1784（renderRows）
 *
 * ── legacy の仕様として写しているもの ────────────────────
 * - ソートは予定開始時刻の昇順のみ。第2キーは無い（:1710）
 * - 絞り込みの「すべて」はキャンセルを含む（:1745）
 * - 絞り込みは統計・バッジに影響しない。切替時に再計算されるのは一覧だけ（:1803）
 * - 一括承認の対象はその日その職員の「済」全件で、絞り込みを無視する（:1824）
 * - CSV も絞り込みを無視して全状態を出す（:1833）
 * - 0件の文言は絞り込みの有無で変わらない（:1747）
 */
import { useState } from 'react';
import { useCareStore } from '../../store/useCareStore';
import { BulkNoteModal } from './BulkNoteModal';
import { deriveStatus, recordOf } from '../../domain/visitStatus';
import { minutesOf } from '../../domain/aggregate';
import { downloadCsv, toCsv } from '../../utils/csv';
import { canApprove } from '../../types/local';
import { toMin } from '../../utils/date';
import { Filters } from './Filters';
import { VisitRow } from './VisitRow';

export function VisitList() {
  const {
    dispatch, records, filter, retry, notify,
    stampStartAt, stampEndAt, approveVisit, approveAllToday, session, openRecord,
  } = useCareStore();

  const loading = dispatch.status === 'loading' || records.status === 'loading';
  const plan = dispatch.status === 'ready' ? dispatch.data : null;
  const recs = records.status === 'ready' ? records.data.records : [];
  const unreadable = records.status === 'ready' ? records.data.unreadable : [];

  // legacy/index.html:1710。予定開始の昇順。未入力は 00:00 と同じ扱いで先頭に来る
  const sorted = [...(plan?.visits ?? [])].sort((a, b) => (toMin(a.startTime) ?? 0) - (toMin(b.startTime) ?? 0));
  const visible = filter === 'all'
    ? sorted
    : sorted.filter((v) => deriveStatus(v, recordOf(v.visitId, recs)) === filter);

  const later = (name: string) => () => notify(`${name}は Phase 1c 以降で実装します`);

  /*
   * 日次の実施記録 CSV。legacy/index.html:1836-1847 の15列をそのまま写す。
   *
   * legacy は画面の絞り込みを無視してその日その職員の全件を出していたが、
   * 「画面に出ている行がそのまま出る」ほうが誤解が無い（計画書 Q5）。
   * 母集団は一覧が描いている visible そのものにしてある。
   */
  const exportCsv = () => {
    // 「まだ読めていない」を「0件だった」と同じ文言で返すと、出力漏れに気づけない
    if (loading) { notify('読み込み中です。少し待ってからもう一度お試しください。'); return; }
    if (dispatch.status === 'error' || records.status === 'error') {
      notify('記録を読み取れていないため出力できません。再試行してください。');
      return;
    }
    if (plan === null || visible.length === 0) { notify('出力するデータがありません'); return; }
    const head = ['日付', '職員', '利用者', 'サービス種別', '予定開始', '予定終了', '実績開始', '実績終了',
      '実施分', '状態', '体温', '血圧', '脈拍', '実施内容', '特記事項'];
    const body = visible.map((v) => {
      const rec = recordOf(v.visitId, recs);
      const resident = plan.residents.find((r) => r.residentId === v.residentId);
      const min = minutesOf(rec);
      return [
        plan.date, plan.staffName, resident?.name ?? v.residentId, v.serviceName,
        v.startTime, v.endTime, rec?.actualStart ?? '', rec?.actualEnd ?? '',
        // legacy の日次だけ「実績が揃わなければ空欄」。0 と書くと未実施に見える
        min || '', deriveStatus(v, rec),
        rec?.vitals.temperature ?? '', rec?.vitals.bloodPressure ?? '', rec?.vitals.pulse ?? '',
        (rec?.tasks ?? []).join('・'), rec?.note ?? '',
      ];
    });
    downloadCsv(`実施記録_${plan.staffName}_${plan.date}.csv`, toCsv([head, ...body]));
    notify('CSVを出力しました');
  };
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <>
    <div className="panel">
      <div className="panel-head">
        <h2>サービス実施一覧</h2>
        <span className="hint">未完＝登録なし ／ 済＝登録あり ／ 完了＝承認OK</span>
        <div className="spacer"></div>
        {/* legacy は .chipbtn.primary の青をインライン style で紫に上書きしている（:866） */}
        <button className="chipbtn primary" id="bulkBtn"
          style={{ background: 'linear-gradient(120deg,#6a4bd6,#2b7ee6)', boxShadow: '0 4px 12px rgba(90,70,210,.28)' }}
          onClick={() => setBulkOpen(true)}>✨ 特記事項を一括作成</button>
        {/* legacy/index.html:4240。承認権限のある職員にだけ出す */}
        {canApprove(session) && (
          <button className="chipbtn" id="approveAll" onClick={() => { void approveAllToday(); }}>一括承認</button>
        )}
        <button className="chipbtn" id="csvBtn" onClick={exportCsv}>CSV出力</button>
        <button className="chipbtn primary" id="addBtn" onClick={later('予定の追加')}>＋ 予定を追加</button>
      </div>

      <Filters />

      <div className="rows" id="rows">
        {loading && <div className="empty"><div className="ico">⏳</div><p>読み込んでいます…</p></div>}

        {dispatch.status === 'error' && (
          <div className="empty"><div className="ico">⚠️</div>
            <p>{dispatch.message}</p>
            <button className="chipbtn" onClick={retry}>再試行</button>
          </div>
        )}
        {records.status === 'error' && (
          <div className="empty"><div className="ico">⚠️</div>
            <p>{records.message}</p>
            <button className="chipbtn" onClick={retry}>再試行</button>
          </div>
        )}

        {/* 読み出せない記録は隠さない。法定文書なので欠落に気づけることを優先する */}
        {unreadable.length > 0 && (
          <div className="empty"><div className="ico">⚠️</div>
            <p>読み出せない記録が {unreadable.length} 件あります。事業所に連絡してください。</p>
          </div>
        )}

        {!loading && dispatch.status === 'ready' && records.status === 'ready' && visible.length === 0 && (
          // legacy/index.html:1747。絞り込み中でも文言は同じ
          <div className="empty"><div className="ico">🗓️</div>
            <p>該当する予定はありません。<br />「＋ 予定を追加」から登録できます。</p>
          </div>
        )}

        {!loading && plan !== null && visible.map((v) => (
          <VisitRow
            key={v.visitId}
            visit={v}
            record={recordOf(v.visitId, recs)}
            resident={plan.residents.find((r) => r.residentId === v.residentId)}
            onStart={() => { void stampStartAt(v.visitId); }}
            onEnd={() => { void stampEndAt(v.visitId); }}
            onApprove={() => { void approveVisit(v.visitId); }}
            onEdit={() => openRecord(v.visitId)}
          />
        ))}
      </div>
    </div>
    {/* legacy の #bulkMask（:989）。.mask は position:fixed なので置き場所は表示に影響しない */}
    {bulkOpen && <BulkNoteModal onClose={() => setBulkOpen(false)} />}
    </>
  );
}
