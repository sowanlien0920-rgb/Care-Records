/*
 * アプリシェル。
 *
 * ステップ2（契約とアダプタ定義）では、モック配信が useCareStore() 経由で
 * 取得できることを確認するためだけの中身を置いている。
 * 実際の画面はステップ3以降で組み立てる。
 */
import { CareStoreProvider } from './store/CareStoreProvider';
import { useCareStore } from './store/useCareStore';

function DispatchProbe() {
  const { staff, dispatch, records, staffId, setStaffId, date, retry } = useCareStore();

  if (staff.status === 'loading') return <p className="hint">職員を読み込んでいます…</p>;
  if (staff.status === 'error') {
    return (
      <div>
        <p className="hint">{staff.message}</p>
        <button className="chipbtn" onClick={retry}>再試行</button>
      </div>
    );
  }
  if (staff.data.length === 0) return <p className="hint">職員が登録されていません。</p>;

  if (staffId === null) {
    return (
      <div>
        <p className="hint">職員を選んでください（簡易ログインはステップ3で作る）</p>
        {staff.data.map((s) => (
          <button key={s.staffId} className="chipbtn" onClick={() => setStaffId(s.staffId)}>
            {s.name}（{s.role}）
          </button>
        ))}
      </div>
    );
  }

  if (dispatch.status === 'loading' || records.status === 'loading') {
    return <p className="hint">配信を読み込んでいます…</p>;
  }
  if (dispatch.status === 'error') {
    return (
      <div>
        <p className="hint">{dispatch.message}</p>
        <button className="chipbtn" onClick={retry}>再試行</button>
      </div>
    );
  }
  if (records.status === 'error') {
    return (
      <div>
        <p className="hint">{records.message}</p>
        <button className="chipbtn" onClick={retry}>再試行</button>
      </div>
    );
  }
  const plan = dispatch.data;
  if (plan === null) {
    return <p className="hint">{date} のこの職員あての配信はありません。</p>;
  }
  if (plan.visits.length === 0) {
    return <p className="hint">{date} の訪問予定はありません。</p>;
  }

  return (
    <div>
      <p className="hint">
        {plan.staffName} / {date} ／ 訪問 {plan.visits.length} 件 ／
        利用者 {plan.residents.length} 名 ／ 記録 {records.data.records.length} 件 ／
        schemaVersion {plan.schemaVersion}
        {records.data.unreadable.length > 0
          ? ` ／ 読み出せない記録 ${records.data.unreadable.length} 件`
          : ''}
      </p>
      {plan.visits.map((v) => {
        const resident = plan.residents.find((r) => r.residentId === v.residentId);
        return (
          <div key={v.visitId} className="pchip">
            {v.startTime}–{v.endTime} {resident?.name ?? v.residentId} / {v.serviceName}
            {v.source === 'manual' ? ' [追加]' : ''}
            {v.cancelled ? ' [中止]' : ''}
          </div>
        );
      })}
      <button className="chipbtn" onClick={() => setStaffId(null)}>職員を選び直す</button>
    </div>
  );
}

export default function App() {
  return (
    <CareStoreProvider>
      <div className="wrap">
        <div className="panel">
          <div className="panel-head">
            <h2>訪問介護 サービス実施記録</h2>
            <span className="hint">ステップ2：契約とアダプタの疎通確認</span>
          </div>
          <DispatchProbe />
        </div>
      </div>
    </CareStoreProvider>
  );
}
