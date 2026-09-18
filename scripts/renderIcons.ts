/*
 * public/icon.svg から PWA 用の PNG を書き出す。
 *
 * macOS の変換ツール（sips / qlmanage）は SVG の扱いが端末によって違うため、
 * すでに検証で使っている headless ブラウザに描かせる。手元に何が入っているかに
 * 依存しない形にしてある。アイコンを変えるときは icon.svg だけ直してこれを走らせる。
 *
 *   npm run icons
 *
 * patchright は carerecords の依存ではない。アイコンの書き出しは1回走れば済む作業で、
 * そのためにブラウザ一式を package.json に入れると全員の install が重くなる。
 * 検証で使っているものを借り、無ければその旨を言って終わる
 * （PNG は commit 済みなので、無くても開発もビルドも止まらない）。
 */
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

interface Page {
  setContent(html: string): Promise<void>;
  screenshot(options: { omitBackground: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}
interface Browser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
}
interface LaunchOptions { headless: boolean; channel: string; args: string[] }
interface Chromium { launch(options: LaunchOptions): Promise<Browser> }

/** ホーム画面に置かれるもの。180 は iOS の apple-touch-icon */
const SIZES: Array<{ size: number; file: string }> = [
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
  { size: 180, file: 'apple-touch-icon.png' },
];

function loadChromium(): Chromium {
  const roots = globSync(`${homedir()}/.vscode/extensions/*dscodegpt*/standalone`)
    .map((dir) => `${dir}/`);
  roots.push(`${process.cwd()}/`);
  for (const root of roots) {
    try {
      const mod = createRequire(root)('patchright') as { chromium?: Chromium };
      if (mod.chromium) return mod.chromium;
    } catch { /* 次の候補へ */ }
  }
  throw new Error(
    'patchright が見つかりません。アイコンを作り直さないなら、'
    + 'public/*.png は commit 済みなのでこの script は不要です。\n'
    + `探した場所:\n  ${roots.join('\n  ')}`,
  );
}

const svg = readFileSync(resolve('public/icon.svg'), 'utf8');
// channel と args は browser-automation スキルの起動条件に合わせる。
// 既定のまま launch すると chrome-headless-shell を探しに行って落ちる
const browser = await loadChromium().launch({
  headless: true,
  channel: 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  for (const { size, file } of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    writeFileSync(resolve('public', file), await page.screenshot({ omitBackground: true }));
    await page.close();
    console.log(`public/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
