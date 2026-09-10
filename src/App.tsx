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
import { VisitList } from './features/visitList/VisitList';

function Shell() {
  const { session, notification } = useCareStore();

  if (session === null) return <StaffPicker />;

  return (
    <>
      <Header />
      <div className="wrap">
        <DateBar />
        <Toolbar />
        <Stats />

        <VisitList />
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
