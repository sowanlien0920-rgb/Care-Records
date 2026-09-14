/*
 * Firebase Auth のログイン画面。
 *
 * legacy/index.html:741-807 の `.login` をそのまま写している。
 * CSS が入れ子と順序に依存しているため、階層・クラス名・要素の順序を変えない
 * （CLAUDE.md 鉄則2）。とくに次の3つは、変えると見た目が壊れる。
 *
 *   - `.lgfield input:focus + .ic`（styles.css）は隣接兄弟。input の直後に
 *     svg.ic が無いと、フォーカス時のアイコン着色が効かない
 *   - `.lg-eye` の子 svg は `className="on"` / `"off"`。**`.lg-eye` 自身の状態クラス
 *     `on` と名前が同じ**で、`.lg-eye.on .on{display:none}` のように組み合わせて使う。
 *     子の className を整理すると目の切替が壊れる
 *   - `.lg-btn` の `span.sp`（スピナー）はテキストより前
 *
 * `.login` と `.lg-err` は既定が `display:none` で、`on` が無いと何も出ない（鉄則5）。
 *
 * ── legacy から変わるのは認証の中身だけ ──────────────────
 * legacy は `db.accounts` のハッシュと突き合わせていた（`index.html:4186-4203`）。
 * ここでは Firebase Auth に投げる。職員が入力するのはログイン ID なので、
 * `loginIdToEmail()` でメールに変換してから渡す。
 */
import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { auth } from '../../firebase';
import { loginIdToEmail } from '../../data/loginId';

/*
 * 曜日。TodoModal / ReportModal / PendingModal も同じものを各自で持っている。
 * ここでまとめると3画面の差分に巻き込まれるので、既存に倣って手元に置く。
 */
const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;

function dowOf(d: Date): string {
  return DOW[d.getDay()] ?? '';
}

/** legacy の renderLoginGreet()（`index.html:4204-4210`）と同じ分岐 */
function greetOf(hour: number): string {
  if (hour < 5) return 'お疲れさまです';
  if (hour < 11) return 'おはようございます';
  if (hour < 18) return 'こんにちは';
  return 'お疲れさまです';
}

function stampOf(now: Date): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  // 末尾は全角スペース1つ（legacy と同じ）。リテラルで置くと no-irregular-whitespace に当たる
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${dowOf(now)}）\u3000${hh}:${mm}`;
}

/**
 * Firebase のエラーを利用者に見せる文言にする。
 *
 * **どちらが間違っているかを言わない。** 職員 ID が実在するかどうかが
 * 分かる形にすると、総当たりの手がかりになる。legacy も同じ扱いだった
 * （`index.html:4191` と `:4196` が同じ文言）。
 */
function messageOf(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return '職員IDまたはパスワードが正しくありません。';
    case 'auth/user-disabled':
      return 'このアカウントは停止されています。管理者にご確認ください。';
    case 'auth/too-many-requests':
      return '試行の回数が多いため、一時的にログインできません。'
        + 'しばらく時間をおいてからお試しください。';
    case 'auth/network-request-failed':
      return '通信に失敗しました。電波の状況をご確認のうえ、もう一度お試しください。';
    default:
      return 'ログインできませんでした。時間をおいてお試しください。';
  }
}

export function LoginForm() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // legacy は 1秒間隔の setInterval で挨拶と時刻を更新する（`index.html:4435-4439`）
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(new Date()); }, 1000);
    return () => { window.clearInterval(timer); };
  }, []);

  /*
   * legacy の lgShake()（`index.html:4180-4185`）。
   * `void offsetWidth` で強制リフローしないと、同じ文言が続けて出たときに
   * アニメーションが再生されない。className を差し替えるだけでは足りない。
   */
  const shake = (message: string): void => {
    setError(message);
    const box = errorRef.current;
    if (!box) return;
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
  };

  const submit = async (): Promise<void> => {
    if (busy) return; // 重複送信の防止。連打で複数回サインインさせない
    const id = loginId.trim();
    if (!id || !password) {
      shake('職員IDとパスワードを入力してください。');
      return;
    }

    /*
     * 施設コードが対応表に無い場合も「ID かパスワードが違う」で返す。
     * 「その施設は存在しない」と伝えると、施設コードの総当たりができてしまう。
     */
    const email = loginIdToEmail(id);
    if (!email) {
      shake('職員IDまたはパスワードが正しくありません。');
      passwordRef.current?.focus();
      return;
    }

    setBusy(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // 成功後の画面遷移は onAuthStateChanged 側が行う。ここでは何もしない。
      // パスワードもクリアしない（このコンポーネントごと外れるため）
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : '';
      shake(messageOf(code));
      // 入力は消さない。書き直させないことを優先する
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onSubmitClick = (): void => { void submit(); };

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
          <h1 className="lg-title">訪問介護<br/>サービス実施記録</h1>
          <div className="lg-en">HOME-VISIT CARE RECORD</div>
          <p className="lg-lead">日々の訪問を、確かな記録に。<br/>現場の入力負担を減らし、記録の質を守ります。</p>
          <div className="lg-feats">
            <div className="lg-feat">
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8.2" stroke="currentColor" strokeWidth="1.6"/><path d="m6.4 10.2 2.5 2.5 4.7-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>ワンタップ打刻と、AIによる特記事項の作成</span>
            </div>
            <div className="lg-feat">
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8.2" stroke="currentColor" strokeWidth="1.6"/><path d="m6.4 10.2 2.5 2.5 4.7-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>実地指導に備える記載チェックと月間帳票</span>
            </div>
            <div className="lg-feat">
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8.2" stroke="currentColor" strokeWidth="1.6"/><path d="m6.4 10.2 2.5 2.5 4.7-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>職員ごとの権限管理と、すべての変更履歴</span>
            </div>
          </div>
          {/* legacy はここに事業所名を出すが、設定画面を移植していないため空にしてある */}
          <div className="lg-office" id="lgOffice"></div>
        </div>

        {/* フォーム面 */}
        <div className="lg-form">
          <div className="lg-greet"><span id="lgGreet">{greetOf(now.getHours())}</span><b>ログイン</b></div>
          <div className="lg-date" id="lgDate">{stampOf(now)}</div>
          <div className="lg-hr"></div>

          <div className="lgfield">
            <label htmlFor="lgId">職員ID</label>
            <input
              id="lgId"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="staff_id"
              value={loginId}
              aria-invalid={error !== ''}
              aria-describedby="lgErrTxt"
              onChange={(e) => { setLoginId(e.target.value); }}
              // legacy: ID 欄の Enter はログインせず、パスワード欄へ移るだけ（`:4219`）
              onKeyDown={(e) => { if (e.key === 'Enter') passwordRef.current?.focus(); }}
            />
            <svg className="ic" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="6.6" r="3.4" stroke="currentColor" strokeWidth="1.7"/><path d="M3.6 17c.5-3.4 3.2-5.4 6.4-5.4s5.9 2 6.4 5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
          </div>

          <div className="lgfield">
            <label htmlFor="lgPw">パスワード</label>
            <input
              type={reveal ? 'text' : 'password'}
              id="lgPw"
              ref={passwordRef}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              aria-invalid={error !== ''}
              aria-describedby="lgErrTxt"
              onChange={(e) => { setPassword(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
            <svg className="ic" viewBox="0 0 20 20" fill="none"><rect x="3.6" y="8.6" width="12.8" height="8.4" rx="2.2" stroke="currentColor" strokeWidth="1.7"/><path d="M6.8 8.6V6.4a3.2 3.2 0 0 1 6.4 0v2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            <button
              className={reveal ? 'lg-eye on' : 'lg-eye'}
              id="lgEye"
              type="button"
              title="パスワードを表示"
              onClick={() => {
                setReveal((v) => !v);
                passwordRef.current?.focus();
              }}
            >
              <svg className="on" viewBox="0 0 20 20" fill="none"><path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z" stroke="currentColor" strokeWidth="1.6"/><circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6"/></svg>
              <svg className="off" viewBox="0 0 20 20" fill="none"><path d="M1.8 10S4.8 4.6 10 4.6c1.4 0 2.6.4 3.7 1M18.2 10s-3 5.4-8.2 5.4c-1.5 0-2.8-.5-3.9-1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="m3 3 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>
          </div>

          <div className={error ? 'lg-err on' : 'lg-err'} id="lgErr" ref={errorRef} role="alert" aria-live="assertive">
            <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8.2" stroke="currentColor" strokeWidth="1.6"/><path d="M10 6v4.6M10 13.6v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
            <span id="lgErrTxt">{error}</span>
          </div>

          <button
            className={busy ? 'lg-btn busy' : 'lg-btn'}
            id="lgBtn"
            type="button"
            disabled={busy}
            onClick={onSubmitClick}
          >
            <span className="sp"></span>ログイン
          </button>
          <div className="lg-note" id="lgNote">パスワードが分からない場合は、管理者にリセットを依頼してください。</div>
          <div className="lg-foot">事業所内でのご利用を前提としたシステムです</div>
        </div>
      </div>
    </div>
  );
}
