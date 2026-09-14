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
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

/**
 * どちらの永続化を使うか。
 *
 * Phase 5a の移行中は両方を残す。`localStorage` 側を消してしまうと、
 * Firestore 側で詰まったときに動かせるものが何も無くなる。
 * 既定は `local`。Firestore を使うときだけ明示的に切り替える。
 */
export const BACKEND: 'local' | 'firestore' =
  import.meta.env.VITE_BACKEND === 'firestore' ? 'firestore' : 'local';

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

export const db = getFirestore(app);

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
