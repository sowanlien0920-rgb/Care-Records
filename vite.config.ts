import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 本番ビルドに必要な設定が揃っているかを、ビルド時に検査する。
 *
 * `src/firebase.ts` の `BACKEND` は本番では常に `firestore` になるため、
 * Firebase の設定が欠けたままビルドが通ると、配信されたアプリが
 * 起動時に例外を投げて白画面になる。何が足りないかは利用者にも伝わらない。
 *
 * それ以前に、以前はここに検査が無かったせいで **`VITE_BACKEND` を渡し忘れた
 * ビルドが「パスワード認証の無いアプリ」として本番に出ていた**
 * （`docs/security/2026-09-14-audit.md` の Critical / High 1）。
 * ビルドは成功し、警告も出なかった。検査をここに置くのは、
 * 「気づかないまま出る」経路を塞ぐのが目的になる。
 *
 * dev サーバーでは検査しない。Firebase を使わない `local` 構成でも
 * 立ち上がる必要がある（`.env.example` の VITE_BACKEND を参照）。
 */
function requireFirebaseEnv(mode: string): void {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  if (env['VITE_BACKEND'] !== 'firestore') {
    throw new Error(
      '本番ビルドには VITE_BACKEND=firestore が必要です'
      + `（現在: ${env['VITE_BACKEND'] ?? '未設定'}）。\n`
      + 'localStorage 版は開発専用で、本番では認証が行われません。\n'
      + '.env.local または CI の環境変数を確認してください。',
    );
  }

  const missing = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ].filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `本番ビルドに必要な Firebase の設定がありません: ${missing.join(', ')}\n`
      + '.env.example を参考に .env.local を作ってください。',
    );
  }

  // エミュレータ接続は import.meta.env.DEV でも塞いであるが、
  // 本番ビルドの入力に混ざっていること自体が取り違えの兆候になる
  if (env['VITE_USE_EMULATOR'] === '1') {
    throw new Error(
      'VITE_USE_EMULATOR=1 のまま本番ビルドしようとしています。'
      + 'エミュレータ用の設定を外してください。',
    );
  }
}

// legacy/ は移行元の単一HTML実装。突き合わせ用に残しているだけで、
// ビルド対象ではないため除外する。
export default defineConfig(({ command, mode }) => {
  if (command === 'build') requireFirebaseEnv(mode);

  return {
    plugins: [react()],
    server: { port: 5173 },
    build: { outDir: 'dist' },
  };
});
