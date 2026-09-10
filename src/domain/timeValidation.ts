/*
 * 実績時間の検証と打刻。
 *
 * 移植元: legacy/index.html:3064-3149（実績時間は予定枠の中で）のうち、
 * 一覧の「開始」「終了」ボタンに必要な部分。記録モーダル側の検証は
 * ステップ5以降で追加する。
 *
 * 実績時間はサービス提供の根拠であり請求に直結するため、
 * 予定枠を外れた打刻を黙って通さないことがこのモジュールの目的になる。
 */
import { fmt, toMin } from '../utils/date';

/** 現在時刻を HH:mm で。legacy の nowHM() */
export function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 打刻を予定枠の中に丸める。legacy/index.html:3067-3073 の clampToPlan と同じ。
 * 予定が読めないときは打刻をそのまま返す。
 */
export function clampToPlan(planStart: string, planEnd: string, raw: string): string {
  const ps = toMin(planStart);
  const pe = toMin(planEnd);
  const r = toMin(raw);
  if (ps === null || pe === null || r === null) return raw;
  if (r < ps) return planStart;
  if (r > pe) return planEnd;
  return fmt(r);
}

export type StampResult =
  | { ok: true; time: string; raw: string; message: string }
  | { ok: false; message: string };

/**
 * 開始の打刻。legacy/index.html:3131-3139 の stampStart と同じ判定。
 *
 * 予定終了を過ぎていたら打刻させず、記録画面から実績時間を入力させる。
 * 予定枠内に丸めた場合はその旨を伝える（黙って書き換えない）。
 */
export function stampStart(planStart: string, planEnd: string, raw = nowHM()): StampResult {
  const r = toMin(raw);
  const pe = toMin(planEnd);
  if (r !== null && pe !== null && r > pe) {
    return {
      ok: false,
      message: `予定時間（${planStart}〜${planEnd}）を過ぎています。「記録」から実績時間を入力してください`,
    };
  }
  const time = clampToPlan(planStart, planEnd, raw);
  return {
    ok: true,
    time,
    raw,
    message: time !== raw ? `打刻 ${raw} は予定枠外のため ${time} で記録しました` : '開始時刻を記録しました',
  };
}

/**
 * 終了の打刻。legacy/index.html:3140-3147 の stampEnd と同じ判定。
 *
 * 開始と違い予定超過でも中断しない（予定終了に丸める）。
 * 実績開始より前にはならないよう揃える。
 */
export function stampEnd(planStart: string, planEnd: string, actualStart: string, raw = nowHM()): StampResult {
  let time = clampToPlan(planStart, planEnd, raw);
  const t = toMin(time);
  const as = toMin(actualStart);
  if (as !== null && t !== null && t < as) time = actualStart;
  return {
    ok: true,
    time,
    raw,
    message: time !== raw ? `打刻 ${raw} は予定枠外のため ${time} で記録しました` : '終了時刻を記録しました',
  };
}
