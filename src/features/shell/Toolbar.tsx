/*
 * ツールバー。移植元: legacy/index.html:841-851
 *
 * .toolbar .sep と .toolbar .memo-note はどちらも子孫セレクタで、
 * 単独クラスの定義が無い（styles.css:415-416）。.sep の flex:1 が
 * 効かないと adminState / bkState が右端に寄らない。
 *
 * バッジの数え方が統計と非対称である点に注意（legacy の仕様をそのまま踏襲）。
 *   未完了 : ログイン中の職員の、今日以前すべて
 *   未承認 : 全職員・全期間の「済」件数
 */
import { useCareStore } from '../../store/useCareStore';
import { canApprove, isManager, isSupervisor } from '../../types/local';

function Badge({ id, count }: { id: string; count: number }) {
  // legacy/index.html:3262-3263。0 件でも要素は消さず zero クラスを付ける
  return <span className={`tbadge${count ? '' : ' zero'}`} id={id}>{count}</span>;
}

export function Toolbar() {
  const { session, badges, notify } = useCareStore();
  const mgr = isManager(session);
  const sup = isSupervisor(session);
  const approver = canApprove(session);

  // バッジが読めないことは画面全体を止める理由にならないので 0 を出す。
  // 読めなかったこと自体は通知で伝える経路をステップ6で用意する
  const counts = badges.status === 'ready' ? badges.data : { todo: 0, pending: 0 };
  const later = (name: string) => () => notify(`${name}はステップ6で実装します`);

  return (
    <div className="toolbar">
      {/* legacy/index.html:4238。todoBtn は明示的に常時表示 */}
      <button className="tbtn" id="todoBtn" onClick={later('未完了の訪問')}>
        📋 未完了の訪問 <Badge id="todoBadge" count={counts.todo} />
      </button>
      {approver && (
        <button className="tbtn" id="pendBtn" onClick={later('未承認一覧')}>
          🕓 未承認一覧 <Badge id="pendBadge" count={counts.pending} />
        </button>
      )}
      {sup && <button className="tbtn" id="repBtn" onClick={later('帳票・集計')}>📊 帳票・集計</button>}
      {sup && <button className="tbtn" id="tlBtn" onClick={later('利用者の経過記録')}>📖 利用者の経過記録</button>}
      {/* legacy では applyPerms の対象外で常時表示 */}
      <button className="tbtn" id="incBtn" onClick={later('ヒヤリハット・事故報告')}>⚠ ヒヤリハット・事故報告</button>
      {/* バックアップは移植しない（計画書 §2 の対象外）。管理者のみ表示だった枠は空ける */}
      {mgr && <div className="sep"></div>}
      {!mgr && <div className="sep"></div>}
      <span className="memo-note" id="bkState"></span>
    </div>
  );
}
