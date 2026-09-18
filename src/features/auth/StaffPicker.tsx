/*
 * 簡易ログイン。移植元のログイン画面は legacy/index.html:741-806
 *
 * Phase 1a は「職員を選ぶだけ」とし、ID・パスワード認証（legacy の 373行、
 * :4084-4457）は移植しない。Phase 5 で Firebase Auth に置き換わるため。
 * 見た目の枠（.login / .loginwrap / .lg-brand / .lg-form）は legacy を使い、
 * フォーム面の中身だけ職員一覧に差し替えている。
 */
import { useEffect, useState } from 'react';
import { useCareStore } from '../../store/useCareStore';
import { iso } from '../../utils/date';

const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** legacy/index.html:4204-4210 の renderLoginGreet と同じ */
function useGreeting(): { greet: string; date: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = now.getHours();
  const greet = h < 5 ? 'お疲れさまです' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'お疲れさまです';
  const dow = DOW[new Date(`${iso(now)}T00:00:00`).getDay()] ?? '';
  // legacy/index.html:4207 は日付と時刻の間に全角スペースを置く。文言は変えない
  const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${dow}）\u3000`
    + `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return { greet, date };
}

export function StaffPicker() {
  const { staff, signIn, retry, sessionRestoring } = useCareStore();
  const { greet, date } = useGreeting();

  // .login は display:none で、.on が付いたときだけ表示される（styles.css:537-546）。
  // legacy は classList.add('on') / remove('on') で出し入れしていた（:4161 / :4178 / :4453）が、
  // React では表示するときしかマウントしないため常に on を付ける
  return (
    <div className="login on" id="loginScreen">
      <div className="orb o1"></div><div className="orb o2"></div><div className="orb o3"></div>

      <div className="loginwrap">
        {/* ブランド面 */}
        <div className="lg-brand">
          <div className="sheen"></div>
          <div className="lg-mark">
            <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <path d="M7.5 21.8 24 7.5l16.5 14.3" stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M11.6 24.8V38a2.2 2.2 0 0 0 2.2 2.2h20.4a2.2 2.2 0 0 0 2.2-2.2V24.8" stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M24 35.4s-6.4-4.1-6.4-8.4a3.8 3.8 0 0 1 6.4-2.6 3.8 3.8 0 0 1 6.4 2.6c0 4.3-6.4 8.4-6.4 8.4Z" fill="currentColor"/>
            </svg>
          </div>
          <h1 className="lg-title">訪問介護<br />サービス実施記録</h1>
          <div className="lg-en">HOME-VISIT CARE RECORD</div>
          <p className="lg-lead">日々の訪問を、確かな記録に。<br />現場の入力負担を減らし、記録の質を守ります。</p>
          <div className="lg-office" id="lgOffice">事業所名は設定画面から登録できます</div>
        </div>

        {/* フォーム面 */}
        <div className="lg-form">
          <div className="lg-greet"><span id="lgGreet">{greet}</span><b>ログイン</b></div>
          <div className="lg-date" id="lgDate">{date}</div>
          <div className="lg-hr"></div>

          {/* 前回の職員選択を復元している間は、選び直しを促さない */}
          {(sessionRestoring || staff.status === 'loading') && (
            <div className="lg-note">職員を読み込んでいます…</div>
          )}

          {!sessionRestoring && staff.status === 'error' && (
            <>
              {/* .lg-err は .on が付いたときだけ表示される（styles.css:651-655） */}
              <div className="lg-err on">{staff.message}</div>
              <button className="lg-btn" type="button" onClick={retry}>再試行</button>
            </>
          )}

          {!sessionRestoring && staff.status === 'ready' && staff.data.length === 0 && (
            <div className="lg-note">
              職員が登録されていません。事業所の管理者に登録を依頼してください。
            </div>
          )}

          {!sessionRestoring && staff.status === 'ready' && staff.data.length > 0 && staff.data.map((s) => (
            <button key={s.staffId} className="lg-btn" type="button" onClick={() => signIn(s.staffId)}>
              {s.name}（{s.role}）
            </button>
          ))}

          <div className="lg-note" id="lgNote">
            Phase 1a の簡易ログインです。パスワード認証は Phase 5 で実装します。
          </div>
          <div className="lg-foot">事業所内でのご利用を前提としたシステムです</div>
        </div>
      </div>
    </div>
  );
}
