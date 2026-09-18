/*
 * Firebase エミュレータに開発用のデータを流し込む。
 *
 * 計画書: docs/plans/2026-09-14-carerecords-phase5a-firestore.md
 *
 * 作るもの:
 *   - Auth のアカウント（管理者 / サ責 / ヘルパー3名）
 *   - users/{uid}          … ルールが読むロール情報（kpi-react の Phase 3 と同じ形）
 *   - facilities/{fid}     … facilityCode を持たせる。ログイン ID の組み立てに要る
 *   - facilities/{fid}/staffs/{staffId}
 *   - facilities/{fid}/dispatches/{date}_{staffId} … mock.ts が作る契約どおりの配信
 *
 * 使い方:
 *   1. npm run emulators   （auth 9099 / firestore 8085。ルールは kpi-react のものを適用）
 *   2. npm run seed        （別のターミナルで）
 *
 * 何度流しても結果が同じになるようにしてある（uid を固定し、set で上書きする）。
 *
 * ── 安全弁 ────────────────────────────────────────────────
 * このスクリプトは **本番に書いてはならない**。Admin SDK はセキュリティルールを
 * 迂回するため、接続先を間違えると本番の facilities 配下にモックが混ざる。
 * エミュレータのホストが localhost を指していることを実行前に検査し、
 * 1つでも満たさなければ何も書かずに終了する。
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  MOCK_FACILITY_ID,
  MOCK_STAFF,
  mockDispatch,
  mockDispatchDates,
} from '../src/data/mock';
import { toRuleRole } from '../src/types/local';
// 初期パスワードは kpi-react との契約。3か所目の写しを作らない
import { INITIAL_PASSWORD } from '../src/data/loginId';

const FACILITY_CODE = 'MOCK';
const EMULATOR_FIRESTORE = '127.0.0.1:8085';
const EMULATOR_AUTH = '127.0.0.1:9099';

function assertEmulator(): void {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= EMULATOR_FIRESTORE;
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??= EMULATOR_AUTH;

  const hosts = [
    ['FIRESTORE_EMULATOR_HOST', process.env['FIRESTORE_EMULATOR_HOST']],
    ['FIREBASE_AUTH_EMULATOR_HOST', process.env['FIREBASE_AUTH_EMULATOR_HOST']],
  ] as const;

  for (const [name, value] of hosts) {
    if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
      console.error(
        `${name} が localhost を指していません（${value ?? '未設定'}）。`
        + '\n本番に書き込む恐れがあるため中止します。',
      );
      process.exit(1);
    }
  }

  // 認証情報を要求されないようにする。エミュレータ相手なので中身は使われない
  if (!process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
    process.env['FIREBASE_CONFIG'] ??= '{}';
  }
}

/** pad は kpi-react の AccountPage.jsx:43 と同じ */
const pad = (n: number): string => String(n).padStart(3, '0');
const toEmail = (facilityId: string, seq: number): string =>
  `${facilityId}${pad(seq)}@kpi-system.internal`;
const toLoginId = (facilityCode: string, seq: number): string =>
  `${facilityCode}${pad(seq)}`;

async function main(): Promise<void> {
  assertEmulator();

  /*
   * 認証情報は渡さない。FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST が
   * 設定されていれば Admin SDK はエミュレータへ繋ぎ、資格情報を要求しない。
   * ダミーの鍵を渡すと逆に「鍵として不正」で落ちる。
   */
  const app = initializeApp({
    projectId: process.env['SEED_PROJECT_ID'] ?? 'kpi-system-a718f',
  });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fid = MOCK_FACILITY_ID;

  console.log(`エミュレータに seed します: ${fid}`);

  // ── 施設 ────────────────────────────────────────────────
  await db.doc(`facilities/${fid}`).set({
    name: 'モック訪問介護事業所',
    facilityCode: FACILITY_CODE,
    settings: { lastLoginNo: MOCK_STAFF.length },
  }, { merge: true });

  // ── 職員とアカウント ────────────────────────────────────
  const issued: Array<{ loginId: string; name: string; role: string }> = [];

  for (const [index, staff] of MOCK_STAFF.entries()) {
    const seq = index + 1;
    const email = toEmail(fid, seq);
    const loginId = toLoginId(FACILITY_CODE, seq);

    // 作り直しても同じ uid になるようにする。何度流しても結果が同じであること
    const uid = `seed-${staff.staffId}`;
    try {
      await auth.createUser({ uid, email, password: INITIAL_PASSWORD });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw err;
      await auth.updateUser(uid, { email, password: INITIAL_PASSWORD });
    }

    await db.doc(`users/${uid}`).set({
      role: toRuleRole(staff.role),
      facilityId: fid,
      staffId: staff.staffId,
      name: staff.name,
      loginId,
      loginNo: seq,
      canApprove: staff.canApprove,
    });

    await db.doc(`facilities/${fid}/staffs/${staff.staffId}`).set({
      /*
       * kpi-react は doc ID を `.id` に写さず、ドキュメント自身の `id` を読む
       * （useFirestore.js の staffs 購読が `d.data()` だけを渡している）。
       * これが無いと発行 UI が staffId を取れず、アカウントを発行できない。
       * 本番の職員レコードは `id` を持っているので、seed も同じ形にする。
       */
      id: staff.staffId,
      name: staff.name,
      role: staff.role,
    }, { merge: true });

    issued.push({ loginId, name: staff.name, role: toRuleRole(staff.role) });
  }

  // ── 配信 ────────────────────────────────────────────────
  let dispatchCount = 0;
  for (const date of mockDispatchDates()) {
    for (const staff of MOCK_STAFF) {
      const dispatch = mockDispatch(date, staff.staffId);
      if (!dispatch) continue;
      await db.doc(`facilities/${fid}/dispatches/${date}_${staff.staffId}`).set(dispatch);
      dispatchCount += 1;
    }
  }

  console.log(`\n配信 ${dispatchCount} 件を書きました（${mockDispatchDates().join(' / ')}）`);
  console.log(`\nログインできるアカウント（パスワードはいずれも ${INITIAL_PASSWORD}）:`);
  for (const a of issued) {
    console.log(`  ${a.loginId}  ${a.name}（${a.role}）`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
