/*
 * アプリシェル。移植元: legacy/index.html:809-859
 *
 * ステップ3ではヘッダー・日付バー・ツールバー・統計まで。
 * サービス実施一覧はステップ4、記録モーダルはステップ5で作る。
 */
import { CareStoreProvider } from './store/CareStoreProvider';
import { useCareStore } from './store/useCareStore';
import { StaffPicker } from './features/auth/StaffPicker';
import { Header } from './features/shell/Header';
import { DateBar } from './features/shell/DateBar';
import { Toolbar } from './features/shell/Toolbar';
import { Stats } from './features/shell/Stats';

function Shell() {
  const { session, dispatch, records, notification, retry } = useCareStore();

  if (session === null) return <StaffPicker />;

  return (
    <>
      <Header />
      <div className="wrap">
        <DateBar />
        <Toolbar />
        <Stats />

        <div className="panel">
          <div className="panel-head">
            <h2>サービス実施一覧</h2>
            <span className="hint">未完＝登録なし ／ 済＝登録あり ／ 完了＝承認OK</span>
          </div>
          <div className="rows" id="rows">
            {/* 一覧はステップ4で実装する。取得の4状態はここで扱っておく */}
            {(dispatch.status === 'loading' || records.status === 'loading') && (
              <div className="empty">読み込んでいます…</div>
            )}
            {dispatch.status === 'error' && (
              <div className="empty">
                {dispatch.message}
                <div><button className="chipbtn" onClick={retry}>再試行</button></div>
              </div>
            )}
            {records.status === 'error' && (
              <div className="empty">
                {records.message}
                <div><button className="chipbtn" onClick={retry}>再試行</button></div>
              </div>
            )}
            {dispatch.status === 'ready' && dispatch.data === null && (
              <div className="empty">この日のこの職員あての予定はありません。</div>
            )}
            {dispatch.status === 'ready' && dispatch.data !== null && dispatch.data.visits.length === 0 && (
              <div className="empty">この日の訪問予定はありません。</div>
            )}
            {dispatch.status === 'ready' && dispatch.data !== null && dispatch.data.visits.length > 0 && (
              <div className="empty">一覧はステップ4で実装します（訪問 {dispatch.data.visits.length} 件）</div>
            )}
            {records.status === 'ready' && records.data.unreadable.length > 0 && (
              <div className="empty">
                読み出せない記録が {records.data.unreadable.length} 件あります。事業所に連絡してください。
              </div>
            )}
          </div>
        </div>
      </div>
      {notification !== null && <div className="toast on">{notification}</div>}
    </>
  );
}

export default function App() {
  return (
    <CareStoreProvider>
      <Shell />
    </CareStoreProvider>
  );
}
