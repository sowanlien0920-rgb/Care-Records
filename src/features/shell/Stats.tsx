/*
 * 統計5枠。移植元: legacy/index.html:853-859、renderStats は :1723-1735
 *
 * .stat .k / .stat .v / .stat .v small はいずれも子孫セレクタ。
 * とくに単位（件・分）は .stat > .v > small の3階層に依存している。
 * .stat は「stat」+ 種別クラスの2クラス指定で border-left の色が決まる。
 *
 * ── legacy の計算式をそのまま写している ──────────────────
 * 母集団は「表示中の日付 × 表示中の職員」。ログイン中の職員ではない。
 *   予定件数 : 全件。キャンセルも分母に含む
 *   未完/済/完了 : それぞれの状態の件数
 *   実施時間 : 状態で絞らない。キャンセルでも実績時刻があれば加算される
 * このため 未完+済+完了 は 予定件数 と一致しない（差がキャンセル件数）。
 * キャンセル件数を出す枠は legacy にも無い。仕様を変えないためそのままにする。
 */
import { useCareStore } from '../../store/useCareStore';
import { deriveStatus, recordOf, totalMinutes } from '../../domain/visitStatus';
import type { VisitStatus } from '../../types/contract';

export function Stats() {
  const { dispatch, records } = useCareStore();

  const visits = dispatch.status === 'ready' && dispatch.data !== null ? dispatch.data.visits : [];
  const recs = records.status === 'ready' ? records.data.records : [];

  const statuses: VisitStatus[] = visits.map((v) => deriveStatus(v, recordOf(v.visitId, recs)));
  const count = (s: VisitStatus) => statuses.filter((x) => x === s).length;

  // 実施時間は、この日この職員の訪問に紐づく記録だけを対象にする
  const visitIds = new Set(visits.map((v) => v.visitId));
  const minutes = totalMinutes(recs.filter((r) => visitIds.has(r.visitId)));

  return (
    <div className="stats">
      <div className="stat total"><div className="k">予定件数</div><div className="v"><span id="sTotal">{visits.length}</span><small>件</small></div></div>
      <div className="stat wait"><div className="k">未完（未登録）</div><div className="v"><span id="sWait">{count('未完')}</span><small>件</small></div></div>
      <div className="stat reg"><div className="k">済（登録あり）</div><div className="v"><span id="sReg">{count('済')}</span><small>件</small></div></div>
      <div className="stat fin"><div className="k">完了（承認OK）</div><div className="v"><span id="sFin">{count('完了')}</span><small>件</small></div></div>
      <div className="stat time"><div className="k">実施時間 合計</div><div className="v"><span id="sMin">{minutes}</span><small>分</small></div></div>
    </div>
  );
}
