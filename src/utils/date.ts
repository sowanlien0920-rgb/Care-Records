/* legacy/index.html:1653-1657 の日付ヘルパーをそのまま移したもの */

/** Date を YYYY-MM-DD に。ローカルタイムゾーンで切る */
export function iso(d: Date | string): string {
  const z = new Date(d);
  z.setMinutes(z.getMinutes() - z.getTimezoneOffset());
  return z.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** HH:mm を 0時からの分数に。空文字は null */
export function toMin(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** 分数を HH:mm に */
export function fmt(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
