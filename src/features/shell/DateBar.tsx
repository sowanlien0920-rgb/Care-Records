/*
 * 日付バー。移植元: legacy/index.html:830-839、renderHeader は :1713-1721
 *
 * .date-center .big / .sub / .dow-sat / .dow-sun と
 * .datebar input[type=date] はいずれも子孫セレクタ。
 * とくに input は要素型セレクタでもあるので type="date" を変えると壊れる。
 */
import { useCareStore } from '../../store/useCareStore';
import { addDays, iso } from '../../utils/date';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function DateBar() {
  const { date, setDate, staffId, staff } = useCareStore();

  const shownName = staff.status === 'ready'
    ? staff.data.find((s) => s.staffId === staffId)?.name ?? ''
    : '';

  const d = new Date(`${date}T00:00:00`);
  const valid = !Number.isNaN(d.getTime());
  const dow = valid ? DOW[d.getDay()] ?? '' : '';
  // legacy/index.html:1716。日曜と土曜だけ色を変える。平日は空の class 属性
  const cls = !valid ? '' : d.getDay() === 0 ? 'dow-sun' : d.getDay() === 6 ? 'dow-sat' : '';

  return (
    <div className="datebar">
      <button className="navbtn" id="prevBtn" onClick={() => setDate(addDays(date, -1))}>◀ 昨日</button>
      <div className="date-center">
        <div className="big" id="dTitle">
          {/* legacy/index.html:1717。年はゼロ埋めせず、月日は2桁。年月日の後に半角スペース */}
          {valid
            ? <>{d.getFullYear()}年 {String(d.getMonth() + 1).padStart(2, '0')}月 {String(d.getDate()).padStart(2, '0')}日 <span className={cls}>（{dow}）</span></>
            : '—'}
        </div>
        <div className="sub" id="dSub">{shownName} さんの担当スケジュール</div>
      </div>
      <button className="navbtn" id="nextBtn" onClick={() => setDate(addDays(date, 1))}>明日 ▶</button>
      <input
        type="date"
        id="dateInp"
        value={date}
        // legacy は値を検証せずそのまま代入していたため、日付をクリアすると
        // Invalid Date になっていた（legacy/index.html:1798）。空は無視する
        onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
      />
      <button className="btn-today" id="todayBtn" onClick={() => setDate(iso(new Date()))}>今日</button>
    </div>
  );
}
