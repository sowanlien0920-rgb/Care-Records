/*
 * 「この一覧はキャッシュから返っていて古いかもしれない」の断り。
 *
 * **文言を1箇所に置く。** 同じ意味の断りを5画面が出すため、書き写すと
 * 少しずつ言い回しがずれる。ずれた文言は「別のことを言っている」と読まれる。
 *
 * **閉じるボタンを付けない。** 圏外である間ずっと成り立つ事実であり、
 * 閉じられると「古いかもしれない」という前提だけが消える。
 * 電波が戻って読み直せば、この行は自然に消える
 * （`features/visitList/VisitList.tsx` の同じ断りと同じ扱い）。
 *
 * `.warnbox` は legacy の既存クラス（`styles.css:291`）で、CSS は足していない。
 */
export function StaleListNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="warnbox" style={{ marginBottom: 10 }}>
      電波が届いていないため、この端末に残っている内容を表示しています。
      ほかの職員があとから付けた記録は含まれていません。
    </div>
  );
}
