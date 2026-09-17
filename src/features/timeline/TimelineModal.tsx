/*
 * 利用者の経過記録。移植元: legacy/index.html:1472-1508、:3751-3875
 *
 * `.tlrow` は 104px 1fr の2カラムグリッドで、直下の子が2個であることに依存する
 * （styles.css:513-520）。`.tlrow:last-child` で最終行の境界線を消している。
 *
 * legacy の仕様として、キャンセルは除外し、未完・済・完了はすべて含む。
 * 並びは新しい順。まとめ生成（AI）は Phase 5（Cloud Functions 経由）で扱う。
 */
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { minutesOf } from '../../domain/aggregate';
import { deriveStatus } from '../../domain/visitStatus';
import { iso } from '../../utils/date';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function TimelineModal() {
  const { panel, closePanel, visitRows, notify, retry } = useCareStore();
  const [residentId, setResidentId] = useState('');
  const [range, setRange] = useState('3');

  if (panel !== 'timeline') return null;

  const all = visitRows.status === 'ready' ? visitRows.data.rows : [];
  const residents = [...new Map(all.filter((r) => r.resident !== undefined)
    .map((r) => [r.resident?.residentId ?? '', r.resident?.name ?? ''])).entries()];
  const cur = residentId || residents[0]?.[0] || '';
  const profile = all.find((r) => r.resident?.residentId === cur)?.resident;

  let from = '0000-00-00';
  if (Number(range) < 99) { const d = new Date(); d.setMonth(d.getMonth() - Number(range)); from = iso(d); }

  const list = all
    .filter((r) => (r.resident?.residentId ?? r.visit.residentId) === cur
      && r.date >= from
      && deriveStatus(r.visit, r.record) !== 'キャンセル')
    .sort((a, b) => (b.date + b.visit.startTime).localeCompare(a.date + a.visit.startTime));

  return (
    <Modal
      title="利用者の経過記録"
      subtitle="モニタリング・担当者会議の前にご活用ください"
      onClose={closePanel}
      width={860}
      footer={<><div className="spacer"></div><button className="bt" onClick={closePanel}>閉じる</button></>}
    >
      <div className="sec">
        <div className="grid3">
          <div className="fld"><label htmlFor="tlUser">利用者</label>
            <select id="tlUser" value={cur} onChange={(e) => setResidentId(e.target.value)}>
              {residents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></div>
          <div className="fld"><label htmlFor="tlRange">期間</label>
            <select id="tlRange" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="1">直近1か月</option><option value="3">直近3か月</option>
              <option value="6">直近6か月</option><option value="99">すべて</option>
            </select></div>
          <div className="fld"><label>&nbsp;</label>
            <button className="aibtn" style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => notify('経過のまとめは Phase 5（AI 接続）で実装します')}>
              <span className="sp"></span>✨ 経過をまとめる</button></div>
        </div>
        <div className="profbar" style={{ marginTop: 12 }}>
          {profile !== undefined && (
            <>
              {profile.carePlan.careLevel && <span className="pchip acc">{profile.carePlan.careLevel}</span>}
              {profile.age && <span className="pchip">{profile.age}歳 {profile.sex}</span>}
              <span className="pchip">{profile.carePlan.household}</span>
              {profile.carePlan.shortTermGoal && <span className="pchip">短期目標：{profile.carePlan.shortTermGoal}</span>}
            </>
          )}
        </div>
      </div>

      <div className="sec">
        <h3>サービス提供の記録 <span className="bchip">{list.length}件</span></h3>
        <div className="tl">
          {visitRows.status === 'loading' && <div className="tlempty">読み込んでいます…</div>}
          {/* 取得の失敗を「この期間の記録はありません」と出さない。
              経過記録はモニタリング・担当者会議の判断材料になる */}
          {visitRows.status === 'error' && (
            <div className="tlempty">{visitRows.message}
              <button className="bt" style={{ marginLeft: 8 }} onClick={retry}>再試行</button>
            </div>
          )}
          {visitRows.status === 'ready' && (list.length === 0
            ? <div className="tlempty">この期間の記録はありません</div>
            : list.map((r) => {
              const a = r.record?.actualStart || r.visit.startTime;
              const b = r.record?.actualEnd || r.visit.endTime;
              // 提供分数の式は帳票と1つにしてある。別々に書くと画面ごとに数字がずれる
              const min = minutesOf(r.record);
              const d = new Date(`${r.date}T00:00:00`);
              return (
                // 直下は div 2個。.tlrow の2カラムグリッドがこれに依存する
                <div className="tlrow" key={r.visit.visitId}>
                  <div className="d"><b>{r.date.slice(5).replace('-', '/')}（{DOW[d.getDay()] ?? ''}）</b> {a}〜{b}<br />{min}分</div>
                  <div className="n">
                    <div className="tg">
                      <span className="tag svc">{r.visit.serviceName}</span>
                      <span className="tag">{r.staffName}</span>
                      {r.record?.noteSource === 'ai' && <span className="bchip ai">AI作成</span>}
                    </div>
                    {r.record?.note
                      ? r.record.note
                      : <span style={{ color: '#a9bbd2' }}>特記事項の記載なし</span>}
                  </div>
                </div>
              );
            }))}
        </div>
      </div>
    </Modal>
  );
}
