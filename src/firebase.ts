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
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * 設定を読む。
 *
 * 欠けたまま起動させない。`undefined` のまま initializeApp に渡すと
 * 認証だけが失敗する、読めるが書けない、といった形で症状が散らばり、
 * 原因が設定漏れだと気づくまで遠回りになる。
 */
function required(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
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

/** 接続先の確認用。画面には出さない */
export const PROJECT_ID = firebaseConfig.projectId;
