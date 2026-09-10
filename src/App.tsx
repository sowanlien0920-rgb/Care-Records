/*
 * アプリシェル。
 * ステップ1（足場作り）では、legacy/index.html から移した styles.css が
 * 効いていることを確認するためだけの中身を置いている。
 * 実際の画面はステップ3以降で組み立てる。
 */
export default function App() {
  return (
    <div className="wrap">
      <div className="panel">
        <div className="panel-head">
          <h2>訪問介護 サービス実施記録</h2>
          <span className="hint">足場のみ。画面はステップ3以降で実装する</span>
        </div>
      </div>
    </div>
  );
}
