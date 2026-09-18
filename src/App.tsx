/*
 * アプリシェル。移植元: legacy/index.html:809-859
 *
 * ステップ3ではヘッダー・日付バー・ツールバー・統計まで。
 * サービス実施一覧はステップ4、記録モーダルはステップ5で作る。
 */
import { CareStoreProvider } from './store/CareStoreProvider';
import { useCareStore } from './store/useCareStore';
import { StaffPicker } from './features/auth/StaffPicker';
import { LoginForm } from './features/auth/LoginForm';
import { PasswordModal } from './features/auth/PasswordModal';
import { BACKEND } from './firebase';
import { Header } from './features/shell/Header';
import { DateBar } from './features/shell/DateBar';
import { Toolbar } from './features/shell/Toolbar';
import { Stats } from './features/shell/Stats';
import { VisitList } from './features/visitList/VisitList';
import { RecordModal } from './features/record/RecordModal';
import { ResidentModal } from './features/resident/ResidentModal';
import { PendingModal } from './features/approval/PendingModal';
import { TodoModal } from './features/todo/TodoModal';
import { IncidentModal } from './features/incident/IncidentModal';
import { ReportModal } from './features/report/ReportModal';
import { TimelineModal } from './features/timeline/TimelineModal';

function Shell() {
  const { session, notification } = useCareStore();

  /*
   * 未ログインのときに出すもの。
   * Firestore では Firebase Auth のログインフォーム、localStorage では
   * Phase 1a の簡易ログイン（職員を選ぶだけ）になる。
   */
  if (session === null) return BACKEND === 'firestore' ? <LoginForm /> : <StaffPicker />;

  return (
    <>
      <Header />
      <div className="wrap">
        <DateBar />
        <Toolbar />
        <Stats />

        <VisitList />
      </div>
      <RecordModal />
      <ResidentModal />
      <TodoModal />
      <PendingModal />
      <ReportModal />
      <TimelineModal />
      <IncidentModal />
      {/* 初期パスワードのままなら、ここが強制モードで開いて閉じられなくなる */}
      <PasswordModal />
      {/* 通知は live region にする。トーストだけだと読み上げに乗らない */}
      {notification !== null && <div className="toast on" role="status" aria-live="polite">{notification}</div>}
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
