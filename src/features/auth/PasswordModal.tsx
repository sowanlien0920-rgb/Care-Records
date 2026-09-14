/*
 * パスワードの変更。移植元: legacy/index.html:1266-1284（DOM）、:4247-4270（挙動）
 *
 * ── なぜ必要か ────────────────────────────────────────────
 * kpi-react が発行するアカウントは全員が初期パスワード `000000` で、
 * carerecords 側に変更手段が無かった（`docs/security/2026-09-14-audit.md` の High）。
 * ヘッダーの 🔑 は `notify('Phase 5 で実装します')` のスタブのままだった。
 *
 * ── legacy から変わるのは照合の中身だけ ──────────────────
 * legacy は `hashPw(入力, a.salt)` と `a.pw` を突き合わせていた（`:4263`）。
 * Firebase Auth では平文の保持も自前のハッシュも無いため、
 * `reauthenticateWithCredential` で本人確認してから `updatePassword` する。
 *
 * DOM・クラス名・要素の順序・エラー文言は legacy のまま（CLAUDE.md 鉄則2）。
 *   - `.fld` を経由しないと `.fld input{width:100%}`（styles.css）が当たらない
 *   - `pwMsg` は `.lintitem` と `.lv-ng` の2クラス同時指定。中身は
 *     `span.ic` と `div` の2要素で、`.lintitem .ic` が入れ子に依存している
 *   - `.modal-foot` の先頭は `div.spacer`（右寄せ）。ボタンは キャンセル → 変更する
 *   - `pwMsg` の表示は `on` ではなくインライン `display` の切替（legacy と同じ）
 *
 * ── legacy と変えた2点 ────────────────────────────────────
 * 1. 検査の順序。legacy は「現在のパスワード」を最初に見る（`:4263`）が、
 *    あちらは同期のハッシュ比較だった。こちらは通信になるため、
 *    手元で分かる3つ（長さ・一致・初期値）を先に見る。**文言は変えていない。**
 * 2. 二重送信の防止。legacy の `pwSave` には無い（`:4260`）。
 *    localStorage への同期書き込みと、Auth への通信では意味が違う。
 */
import { useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { Modal } from '../../components/Modal';
import { useCareStore } from '../../store/useCareStore';
import { auth, BACKEND } from '../../firebase';
import { INITIAL_PASSWORD } from '../../data/loginId';

/** legacy/index.html:4263-4266 の4つ。文言を変えない */
const MSG = {
  wrongCurrent: '現在のパスワードが正しくありません。',
  tooShort: '新しいパスワードは6文字以上で設定してください。',
  mismatch: '新しいパスワードが一致しません。',
  initial: '初期パスワードは使用できません。',
} as const;

function messageOf(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return MSG.wrongCurrent;
    case 'auth/weak-password':
      return MSG.tooShort;
    case 'auth/too-many-requests':
      return '試行の回数が多いため、一時的に変更できません。しばらく時間をおいてからお試しください。';
    case 'auth/network-request-failed':
      return '通信に失敗しました。電波の状況をご確認のうえ、もう一度お試しください。';
    case 'auth/requires-recent-login':
      return 'ログインし直してから、もう一度お試しください。';
    default:
      return 'パスワードを変更できませんでした。時間をおいてお試しください。';
  }
}

export function PasswordModal() {
  const {
    panel, closePanel, session, notify,
    passwordChangeRequired, setPasswordChangeRequired,
  } = useCareStore();

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * 強制モードでは、パネルが開いていなくても出す。legacy の openPw(true)（:4201）と
   * 同じで、変更するまで閉じられない。キャンセルも × も出さない（:4254 / :4259）。
   */
  const forced = passwordChangeRequired;
  if (panel !== 'password' && !forced) return null;

  const user = auth.currentUser;

  // localStorage 版にはパスワードそのものが無い。開けても何もできない
  if (BACKEND !== 'firestore' || user === null) {
    return (
      <Modal title="パスワードの変更" onClose={closePanel} width={460}>
        <div className="lintitem lv-ng"><span className="ic">✕</span>
          <div>この構成ではパスワードを変更できません。事業所にご確認ください。</div>
        </div>
      </Modal>
    );
  }

  const close = (): void => {
    // 強制モードの逃げ道は作らない
    if (forced) return;
    setOldPw(''); setNewPw(''); setNewPw2(''); setError('');
    closePanel();
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    // 手元で分かるものを先に見る。通信は本人確認の1回だけにする
    if (newPw.length < 6) { setError(MSG.tooShort); return; }
    if (newPw !== newPw2) { setError(MSG.mismatch); return; }
    if (newPw === INITIAL_PASSWORD) { setError(MSG.initial); return; }

    const email = user.email;
    if (email === null) { setError(messageOf('')); return; }

    setBusy(true);
    setError('');
    try {
      // 本人確認。legacy の hashPw 照合（:4263）にあたる
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, oldPw));
      await updatePassword(user, newPw);
      setPasswordChangeRequired(false);
      setOldPw(''); setNewPw(''); setNewPw2(''); setError('');
      closePanel();
      // legacy/index.html:4269 と同じ文言
      notify('パスワードを変更しました');
    } catch (err: unknown) {
      setError(messageOf(err instanceof FirebaseError ? err.code : ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="パスワードの変更"
      subtitle={forced
        // legacy/index.html:4251
        ? '初回ログインです。パスワードを変更してください。'
        // legacy/index.html:4252。「さん」の前は半角スペース1つ
        : `${session?.name ?? ''} さんのパスワードを変更します`}
      onClose={close}
      width={460}
      footer={(
        <>
          <div className="spacer"></div>
          {/* 強制モードではキャンセルを出さない（legacy/index.html:4254） */}
          {!forced && <button className="bt" type="button" onClick={close}>キャンセル</button>}
          <button className="bt save" type="button" disabled={busy} onClick={() => { void submit(); }}>
            変更する
          </button>
        </>
      )}
    >
      <div className="fld" style={{ marginBottom: 12 }}>
        <label htmlFor="pwOld">現在のパスワード</label>
        <input type="password" id="pwOld" autoComplete="current-password"
          value={oldPw} onChange={(e) => { setOldPw(e.target.value); }} />
      </div>
      <div className="fld" style={{ marginBottom: 12 }}>
        <label htmlFor="pwNew">新しいパスワード（6文字以上）</label>
        <input type="password" id="pwNew" autoComplete="new-password"
          value={newPw} onChange={(e) => { setNewPw(e.target.value); }} />
      </div>
      <div className="fld">
        <label htmlFor="pwNew2">新しいパスワード（確認）</label>
        <input type="password" id="pwNew2" autoComplete="new-password"
          value={newPw2} onChange={(e) => { setNewPw2(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </div>
      {/* legacy は style.display を直接切り替える（:4253 / :4257）。`on` ではない */}
      <div className="lintitem lv-ng" id="pwMsg" role="alert"
        style={{ display: error === '' ? 'none' : '', marginTop: 12 }}>
        <span className="ic">✕</span>
        <div id="pwMsgTxt">{error}</div>
      </div>
    </Modal>
  );
}
