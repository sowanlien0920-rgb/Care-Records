/*
 * ヘッダー。移植元: legacy/index.html:809-826
 *
 * DOM の入れ子とクラス名は legacy と同一にしてある。以下の CSS は
 * 子孫セレクタで書かれており、親が無いとスタイルが一切当たらない。
 *   .brand .logo / .brand small / .topbar .spacer
 *   .staff-pick .ava / .staff-pick select / .staff-pick select option
 *   .me .mn / .me .mr
 * とくに .ava と #staffSel には単独クラスの定義が無い（styles.css:62-70）。
 */
import { useEffect, useState } from 'react';
import { useCareStore } from '../../store/useCareStore';
import { isManager, isSupervisor } from '../../types/local';

/** legacy/index.html:4435-4439。表示は時分のみだが 1 秒ごとに更新する */
function useClock(): string {
  const [text, setText] = useState('');
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setText(`現在 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

export function Header() {
  const { session, staffId, setStaffId, staff, signOut, notify, openResident } = useCareStore();
  const clock = useClock();

  const accounts = staff.status === 'ready' ? staff.data : [];
  const shown = accounts.find((s) => s.staffId === staffId) ?? null;
  const mgr = isManager(session);
  const sup = isSupervisor(session);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">🏠</div>
        <div>訪問介護 サービス実施記録<small>HOME-VISIT CARE RECORD</small></div>
      </div>
      <div className="spacer"></div>
      <div className="staff-pick">
        {/* legacy/index.html:1720 と同じ。氏名の先頭1文字 */}
        <div className="ava" id="ava">{(shown?.name ?? '').slice(0, 1)}</div>
        <select
          id="staffSel"
          title="表示する職員"
          value={staffId ?? ''}
          // legacy/index.html:4242。訪問介護員は自分固定で切り替えられない
          disabled={!sup}
          onChange={(e) => setStaffId(e.target.value)}
        >
          {accounts.map((s) => (
            // legacy は option に value を持たせず氏名を値にしていたが、
            // 新モデルは ID 参照なので value に staffId を入れる
            <option key={s.staffId} value={s.staffId}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="me" id="meChip">
        <span className="mn" id="meName">{session?.name ?? ''}</span>
        <span className="mr" id="meRole">{session?.role ?? ''}</span>
      </div>
      <div className="today-label" id="clock">{clock}</div>
      {/* legacy/index.html:4236-4237。表示条件は applyPerms と同じ */}
      {mgr && (
        <button className="gear" id="accBtn" title="職員アカウント管理"
          onClick={() => notify('職員アカウント管理は Phase 5（Firebase Auth）で実装します')}>👥</button>
      )}
      <button className="gear" id="usrBtn" title="利用者マスタ"
        onClick={() => openResident(null)}>👤</button>
      {mgr && (
        <button className="gear" id="cfgBtn" title="設定"
          onClick={() => notify('設定は別の計画で実装します')}>⚙</button>
      )}
      <button className="gear" id="pwBtn" title="パスワード変更"
        onClick={() => notify('パスワード変更は Phase 5（Firebase Auth）で実装します')}>🔑</button>
      <button className="gear" id="outBtn" title="ログアウト"
        onClick={() => { if (window.confirm('ログアウトします。よろしいですか？')) signOut(); }}>⏻</button>
    </header>
  );
}
