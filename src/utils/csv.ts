/*
 * CSV の組み立てとダウンロード。
 *
 * legacy は4箇所に同じクォート関数を書いていた（`legacy/index.html:1837` / `:3057` /
 * `:3573` / `:3723`）。文字列としては同一だが、日次だけ `dl()` を使わず `revokeObjectURL`
 * も呼ばないなど、周辺が少しずつ違っていた。ここ1箇所にまとめる。
 *
 * ── 形式（legacy と同じ。請求突合で使うため変えない）──────
 * - UTF-8 + BOM（U+FEFF）。Excel が Shift_JIS と誤認しないようにするため
 * - 改行は CRLF。末尾には付けない
 * - **全フィールドを無条件でダブルクォートで囲む**。内部の `"` は `""` に倍化する。
 *   カンマ・改行の特別扱いが要らなくなる（RFC 4180 上も問題ない）
 * - null / undefined は空文字
 */

/** 1フィールド。legacy/index.html:1837 のクォート関数と同じ */
function quote(v: string | number | null | undefined): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

/** 行の配列を CSV 本文にする。先頭に BOM を付ける */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  // legacy は U+FEFF を生の文字で埋めていた（:1843 ほか）。見えない文字を
  // ソースに置くと編集で落ちるため、ここではエスケープで書く。出力は同じ
  return `\uFEFF${rows.map((r) => r.map(quote).join(',')).join('\r\n')}`;
}

/**
 * CSV をダウンロードさせる。legacy/index.html:2955-2959 の dl() と同じ。
 *
 * 3秒後に revokeObjectURL する。すぐに revoke するとブラウザによっては
 * 保存が始まる前に URL が無効になる。
 */
export function downloadCsv(filename: string, csv: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
