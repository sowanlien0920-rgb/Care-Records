/*
 * Firebase の初期化。
 *
 * ── 接続先 ────────────────────────────────────────────────
 * carerecords の Hosting は nursinglog だが、**繋ぐ先は kpi-system-a718f** である。
 * 配信（facilities/{fid}/dispatches）も職員アカウント（users/{uid}）も
 * kpi-react 側のプロジェクトにあり、carerecords はそこへ実施記録を書く。
 * ホスティングと認証・データが別プロジェクトにまたがることになる。
 *
 * ── kpi-react の firebase.js をコピーしない ──────────────
 * carerecords が使うのは Auth と Firestore だけになる。
 * Storage・Analytics・事故管理プロジェクトへのクロスアクセスは使わない。
 * 使わないものを初期化すると、バンドルが増えるうえに
 * 「どこに繋がっているか」を読み取るのが難しくなる。
 *
 * App Check は入れていない。kpi-system-a718f の Firestore が Enforce に
 * なっている場合は全リクエストが弾かれるため、そのときはここに足す
 * （計画書 `docs/plans/2026-09-14-carerecords-phase5a-firestore.md` の懸念2）。
 *
 * ── 設定値の扱い ──────────────────────────────────────────
 * VITE_ で始まる値はビルド時にバンドルへ埋め込まれ、ブラウザから読める。
 * Firebase の web 設定は公開前提なのでそれでよいが、秘密にすべき値を
 * .env に足さないこと。アクセス制御はルール側（kpi-react の firestore.rules）が担う。
 */
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

/**
 * どちらの永続化を使うか。
 *
 * Phase 5a の移行中は両方を残す。`localStorage` 側を消してしまうと、
 * Firestore 側で詰まったときに動かせるものが何も無くなる。
 *
 * **ただし本番ビルドは常に `firestore` にする。** 以前は既定が `local` で、
 * `VITE_BACKEND` を渡し忘れたビルドが「パスワード認証の無いアプリ」として
 * 本番に出ていた（`docs/security/2026-09-14-audit.md` の Critical / High 1）。
 * ビルドは成功し警告も出ないため、出るまで気づけない形になっていた。
 * `local` は開発時の逃げ道としてのみ残し、本番では選べなくする。
 *
 * 設定漏れは実行時ではなくビルド時に落とす（`vite.config.ts` の
 * `requireFirebaseEnv`）。実行時に落とすと本番が白画面になるだけで、
 * 何が足りないかが利用者にも開発者にも伝わらない。
 */
export const BACKEND: 'local' | 'firestore' = import.meta.env.DEV
  ? (import.meta.env.VITE_BACKEND === 'firestore' ? 'firestore' : 'local')
  : 'firestore';

/**
 * 設定を読む。
 *
 * 欠けたまま Firestore に繋がせない。`undefined` のまま initializeApp に渡すと
 * 認証だけが失敗する、読めるが書けない、といった形で症状が散らばり、
 * 原因が設定漏れだと気づくまで遠回りになる。
 *
 * `local` のときは検査しない。Firebase を一切使わない構成でも
 * アプリが起動しなくなるのを避けるため。
 */
function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    if (BACKEND === 'local') return '';
    throw new Error(
      `Firebase の設定 ${name} がありません。.env.example を参考に .env.local を作ってください。`,
    );
  }
  return value;
}

const firebaseConfig = {
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
};

export const app = initializeApp(firebaseConfig);

/**
 * 認証。
 *
 * 永続化は既定（`browserLocalPersistence`）のままにする。
 * kpi-react は `inMemoryPersistence` にしているが、あちらは事務所の共有端末で
 * 使う前提である。carerecords はヘルパー個人のスマホ・タブレットで訪問先から
 * 使うため、再読込のたびにログインし直す形にはできない
 * （`src/data/adapter.ts` の `getSessionStaffId` のコメントと同じ理由）。
 */
export const auth = getAuth(app);

/**
 * Firestore。**オフライン永続化を有効にしてある**（Phase 5b）。
 *
 * 訪問先で電波が切れても記録を付けられるようにするため、書き込みは
 * いったん端末（IndexedDB）に入り、復帰後に自動で送られる。
 * 未送信のあいだは `hasPendingWrites` が立つので、画面はそれを見て
 * 「未送信」を出す（`firestoreAdapter.ts`）。
 *
 * **「保存した」の意味が変わる。** サーバーに届いたことではなく、
 * 端末に残ったことを指すようになる。記録は法定文書なので、
 * 未送信を職員から見えなくしてはならない。
 *
 * `persistentMultipleTabManager` を使う。単一タブ用のまま2つ目のタブを
 * 開かれると、後から開いた側が永続化を得られず動かなくなる。
 *
 * **圏外で「アプリを起動する」ことはできない。** それには Service Worker が要る。
 * 入れない判断は依頼者と確認済み（計画書 U-d）。ここで効くのは、
 * すでに開いているアプリが圏外に入った場合になる。
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

/**
 * この端末で圏外の保存が成立するか。
 *
 * **`initializeFirestore` は IndexedDB が使えないことを投げない。** SDK は
 * 起動時に非同期で気づき、**黙ってメモリキャッシュに落として警告を出すだけ**になる
 * （`canFallbackFromIndexedDbError`）。try/catch では捕まらない。
 *
 * 落ちないのは良いが、**永続化が効いていない端末と効いている端末の区別が
 * つかないまま動く**のは困る。プライベートブラウズや容量不足の端末では、
 * 圏外で保存した記録は行に「未送信」が出るのにタブを閉じた時点で消える。
 * 法定文書の記録として、これがいちばん静かで見つけにくい失われ方になる。
 *
 * そこで IndexedDB を実際に開けるかを自分で試し、結果を画面に伝えられるようにする。
 * 開けたかどうかしか分からない（容量が尽きるのは後の話）ので、
 * **「使えない」は確実だが「使える」は見込みである**ことを前提に扱う。
 */
export const offlineStorageAvailable: Promise<boolean> = (async () => {
  if (BACKEND !== 'firestore') return false;
  if (typeof indexedDB === 'undefined') return false;
  return new Promise<boolean>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open('carerecords-offline-probe');
    } catch {
      // Safari のプライベートブラウズは open 自体を投げることがある
      resolve(false);
      return;
    }
    req.onsuccess = () => {
      req.result.close();
      // 試したものを残さない。次回の判定に影響させない
      try { indexedDB.deleteDatabase('carerecords-offline-probe'); } catch { /* 残っても害は無い */ }
      resolve(true);
    };
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  });
})();

/*
 * エミュレータ接続。
 *
 * 本番の Auth がスロットル（auth/too-many-requests）に当たって使えなくなったため、
 * 開発と検証はエミュレータで行う。エミュレータの Auth は回数制限が無く、
 * firestore.rules を実際に適用した状態で動くので、権限まわりも本番に触れずに試せる。
 *
 * `import.meta.env.DEV` を必ず併せて見る。**本番ビルドでこの分岐に入ると、
 * 動いているように見えて何も保存されない**ことになる。
 * 起動方法は README ではなく計画書
 * `docs/plans/2026-09-14-carerecords-phase5a-firestore.md` に書いてある。
 */
export const USING_EMULATOR =
  BACKEND === 'firestore'
  && import.meta.env.DEV
  && import.meta.env.VITE_USE_EMULATOR === '1';

if (USING_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  // 本番と取り違えたまま操作しないための表示。画面ではなくコンソールに出す
  console.info('[carerecords] Firebase エミュレータに接続しています（本番ではありません）');
}

/** 接続先の確認用。画面には出さない */
export const PROJECT_ID = firebaseConfig.projectId;
