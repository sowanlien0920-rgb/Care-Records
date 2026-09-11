/*
 * 帳票の集計。
 *
 * ── なぜ切り出すか ──────────────────────────────────────
 * 画面と CSV が同じ数字を出すことが要件になる（計画書 Q5）。集計をコンポーネントの
 * 中に書くと、CSV を組み立てるフッタからは子コンポーネントのローカル変数が見えず、
 * 同じ式を2回書くことになる。書いた瞬間に「画面の合計と CSV の合計がずれる」事故を
 * 構造的に許してしまうため、集計はここ1箇所に閉じる。
 *
 * 提供分数の式も、ReportModal / TimelineModal / visitStatus の3箇所に同じものが
 * 散っていたので minutesOf() に一本化する。
 *
 * ── キャンセルの扱いは帳票ごとに違う（legacy のまま）──────
 * 利用者別 … 行には出すが、回数・提供時間には数えない
 * 職員別   … そもそも行から除外する（legacy/index.html:3644）
 * 集計     … 行に「ｷｬﾝｾﾙ」列として件数だけ出し、回数・時間には数えない
 *
 * 移植元: legacy/index.html:2953-2954（durOf / hm）、:3583-3749（帳票3種）
 */
import type { DispatchVisit, ResidentBrief, VisitRecord } from '../types/contract';
import { deriveStatus } from './visitStatus';
import { toMin } from '../utils/date';

/**
 * 集計に要る1行ぶん。`VisitRow`（data/adapter.ts）がこの形を満たす。
 * 永続化の型を domain から参照しないために、必要な項目だけを構造で受ける。
 */
export type ReportRow = {
  date: string;
  staffId: string;
  staffName: string;
  visit: DispatchVisit;
  record: VisitRecord | undefined;
  resident: ResidentBrief | undefined;
};

/**
 * 提供分数。実績が揃っていなければ 0。legacy/index.html:2953 の durOf と同じ。
 *
 * 「終了が開始より後」でなければ 0 にするのは legacy どおり。日をまたぐ訪問は
 * 0 分として扱われるが、ここで直すと帳票と請求の突合が legacy と合わなくなる。
 */
export function minutesOf(record: VisitRecord | undefined): number {
  const s = toMin(record?.actualStart ?? '');
  const e = toMin(record?.actualEnd ?? '');
  return s !== null && e !== null && e > s ? e - s : 0;
}

/** 分を「N時間MM分」にする。legacy/index.html:2954 の hm と同じ */
export function hm(min: number): string {
  return `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, '0')}分`;
}

function isCancelled(r: ReportRow): boolean {
  return deriveStatus(r.visit, r.record) === 'キャンセル';
}

/** 利用者別 月間サービス提供記録 */
export type UserReport = {
  /** 表に出す行。キャンセルも含む */
  rows: ReportRow[];
  /** 集計対象（キャンセルを除く） */
  done: ReportRow[];
  totalMinutes: number;
  cancelled: number;
  notApproved: number;
};

export function userReport(rows: ReportRow[]): UserReport {
  const done = rows.filter((r) => !isCancelled(r));
  return {
    rows,
    done,
    totalMinutes: done.reduce((a, r) => a + minutesOf(r.record), 0),
    cancelled: rows.length - done.length,
    notApproved: done.filter((r) => deriveStatus(r.visit, r.record) !== '完了').length,
  };
}

/** 職員別 月間実績集計。日ごとにまとめる */
export type StaffReport = {
  list: ReportRow[];
  /** 日付の昇順。legacy は Map の並びをそのままソートしている */
  byDate: { date: string; rows: ReportRow[]; minutes: number }[];
  visits: number;
  totalMinutes: number;
  /** 1件あたり平均（分）。0件なら 0 */
  average: number;
};

export function staffReport(rows: ReportRow[]): StaffReport {
  const list = rows.filter((r) => !isCancelled(r));
  const map = new Map<string, ReportRow[]>();
  for (const r of list) map.set(r.date, [...(map.get(r.date) ?? []), r]);
  const byDate = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rs]) => ({ date, rows: rs, minutes: rs.reduce((a, r) => a + minutesOf(r.record), 0) }));
  const visits = list.length;
  const totalMinutes = list.reduce((a, r) => a + minutesOf(r.record), 0);
  return { list, byDate, visits, totalMinutes, average: visits ? Math.round(totalMinutes / visits) : 0 };
}

/** 月間 利用者別 実績集計（請求突合用）の1行 */
export type SummaryLine = {
  residentId: string;
  name: string;
  /** 未登録は空文字。表示側で「—」に倒す。CSV は legacy どおり空欄のまま出す */
  careLevel: string;
  visits: number;
  minutes: number;
  cancelled: number;
  notApproved: number;
};

export type SummaryReport = {
  lines: SummaryLine[];
  residents: number;
  visits: number;
  totalMinutes: number;
};

export function summaryReport(rows: ReportRow[]): SummaryReport {
  const ids = [...new Set(rows.map((r) => r.resident?.residentId ?? r.visit.residentId))];
  const lines = ids.map((id) => {
    const rs = rows.filter((r) => (r.resident?.residentId ?? r.visit.residentId) === id);
    const list = rs.filter((r) => !isCancelled(r));
    return {
      residentId: id,
      name: rs[0]?.resident?.name ?? id,
      careLevel: rs[0]?.resident?.carePlan.careLevel ?? '',
      visits: list.length,
      minutes: list.reduce((a, r) => a + minutesOf(r.record), 0),
      cancelled: rs.length - list.length,
      notApproved: list.filter((r) => deriveStatus(r.visit, r.record) !== '完了').length,
    };
  });
  return {
    lines,
    residents: ids.length,
    visits: lines.reduce((a, b) => a + b.visits, 0),
    totalMinutes: lines.reduce((a, b) => a + b.minutes, 0),
  };
}
