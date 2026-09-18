/*
 * 記録に使う語彙。
 *
 * サービス種別は契約（contract.ts の serviceKindSchema）が正で、ここでは
 * 選択肢としての並びを取り出すだけにする。実施内容は契約上ただの文字列配列
 * （`tasks: z.array(z.string())`）なので、選択肢の実体はここが唯一の持ち場になる。
 *
 * ── なぜ1箇所に置くか ───────────────────────────────────
 * 実施内容は Phase 1b の記載チェックが訪問介護計画の plannedTasks と
 * 突き合わせる対象になる。モックと入力欄で別々に定義していると、
 * 片方だけ直した時点で突き合わせが静かにずれる。
 *
 * 移植元: legacy/index.html:1640-1642 の SERVICES / TASKS
 */
import { serviceKindSchema, type ServiceKind } from '../types/contract';

/** legacy/index.html:1640 の SERVICES */
export const SERVICE_OPTIONS: readonly ServiceKind[] = serviceKindSchema.options;

/** legacy/index.html:1641 の TASKS */
export const TASK_OPTIONS: readonly string[] = [
  '排泄介助', '食事介助', '入浴介助', '清拭・整容', '更衣介助', '服薬確認',
  '体位変換', '移動・移乗', '調理', '掃除', '洗濯', '買い物', '見守り', '記録・連絡',
];

/**
 * ご本人の様子。legacy/index.html:1643-1644 の MOODS。
 *
 * 契約（VisitRecord.mood）は z.string() で受ける。事業所ごとに語を足しうるため
 * enum で縛らず、選択肢の正をここに置く。定型文生成の文面分岐（legacy の
 * MOOD_PHRASE、:2431）もこの並びに対応する。
 */
const MOODS = [
  'いつもと変わりなし',
  '体調良好・表情明るい',
  'やや元気がない',
  '痛みの訴えあり',
  '発熱・体調不良',
  '食欲低下',
  '睡眠不足の訴え',
  'ヒヤリハットあり',
] as const;

export const MOOD_OPTIONS: readonly string[] = MOODS;

/**
 * 未選択（空文字）のときに選択欄へ出す既定値。
 * legacy も保存値が無いときは先頭を選ばせている（`v.mood||MOODS[0]`、:1875 / :3305）。
 * 記録側は空文字のまま保持し、「未記入」と「いつもと変わりなしを選んだ」を潰さない。
 */
export const MOOD_DEFAULT: string = MOODS[0];
