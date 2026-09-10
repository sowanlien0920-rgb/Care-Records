/*
 * ビルドスクリプト
 *   node build.js
 *
 * index.html から、Artifact（claude.ai の共有ページ）用の dist/app.html を生成します。
 * Artifact 側で <!doctype html><head>…</head><body> が自動的に付与されるため、
 * 外側のラッパータグを取り除いた本文だけを書き出します。
 * ローカルで使うファイルは index.html のままで変更ありません。
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const title = (src.match(/<title>([^<]*)<\/title>/) || [, '訪問介護 サービス実施記録'])[1];

let body = src
  .replace(/^[\s\S]*?<body>\s*/i, '')          // <body> より前を除去
  .replace(/\s*<\/body>[\s\S]*$/i, '');        // </body> 以降を除去

const head = src
  .slice(src.indexOf('<head>') + 6, src.indexOf('</head>'))
  .replace(/<meta[^>]*>\s*/gi, '')             // charset / viewport は Artifact 側が付与
  .replace(/<title>[\s\S]*?<\/title>\s*/i, '') // title は先頭に置き直す
  .trim();

const out = `<title>${title}</title>\n${head}\n\n${body}\n`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'app.html'), out);

console.log('dist/app.html を生成しました');
console.log('  タイトル : ' + title);
console.log('  サイズ   : ' + (out.length / 1024).toFixed(1) + ' KB');
console.log('  <style>  : ' + (out.includes('<style>') ? 'あり' : 'なし'));
console.log('  <script> : ' + (out.match(/<script>/g) || []).length + ' 個');
