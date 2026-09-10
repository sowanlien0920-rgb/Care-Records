import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// legacy/ は移行元の単一HTML実装。突き合わせ用に残しているだけで、
// ビルド対象ではないため除外する。
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
});
