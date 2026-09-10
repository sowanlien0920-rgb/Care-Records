/*
 * kpi-react との共有契約。
 *
 * このファイルは carerecords の内部型ではなく、kpi-react（予定表・ルート表）と
 * やり取りするデータの形そのものである。片側だけを変えると Phase 4 以降に
 * 連携が静かに壊れる。扱うのは訪問介護のサービス実施記録という法定文書なので、
 * 形のズレは不具合ではなく運営指導での指摘・返還リスクになる。
 *
 * 変更するときは必ず `updating-contract` スキルに従うこと。
 * 背景は docs/plans/2026-09-10-carerecords-react-migration.md を読む。
 *
 * ── 設計の前提 ──────────────────────────────────────────
 *
 * 1. スキーマを単一の源とする。型は z.infer で導出し、手で書かない。
 *    配信ドキュメントは Phase 5 で Firestore から来る「外部入力」であり、
 *    TypeScript の型は実行時に存在しないため、必ず parse を通す。
 *
 * 2. 「値がない」は null で表す。optional にしない。
 *    Firestore は undefined を保存時に落とし、JSON でも undefined は消える。
 *    null に統一しないと「未設定」と「キーが無い」が混ざる。
 *
 * 3. 利用者・職員は氏名ではなく ID で参照する。
 *    氏名は同姓同名・異体字（山﨑 / 山崎）・旧姓で静かに壊れる。
 *    kpi-react の residentList / staffs は Date.now() ベースの安定 ID を持つ。
 */
import { z } from 'zod';

/**
 * 契約の版。配信ドキュメントの読み込み時に照合する。
 *
 * 上げる: 必須項目の追加 / 項目の削除・改名 / 型の変更 / 意味の変更
 * 上げない: 省略可能な項目の追加
 */
export const SCHEMA_VERSION = 1;

/** YYYY-MM-DD */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定する');
/** HH:mm */
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm 形式で指定する');

/** 訪問介護のサービス区分。legacy/index.html:1640 の SERVICES と一致させる */
export const serviceKindSchema = z.enum([
  '身体介護',
  '生活援助',
  '身体＋生活',
  '通院等乗降介助',
]);

/** 実施記録の状態。legacy の status と一致させる */
export const visitStatusSchema = z.enum([
  '未完', // 記録が未登録
  '済', // 記録あり・未承認
  '完了', // 承認済み
  'キャンセル',
]);

/** ADL の介助度。legacy/index.html:2209 の ADL_DEG と一致させる */
export const adlDegreeSchema = z.enum(['自立', '見守り', '一部介助', '全介助']);

/** ADL の評価項目。legacy/index.html:2208 の ADL_ITEMS と一致させる */
export const adlItemSchema = z.enum(['歩行', '移乗', '排泄', '入浴', '食事', '更衣']);

/**
 * 訪問介護計画書のスナップショット。
 *
 * ── 正は kpi-react 側にある ──────────────────────────────
 * ここに載る情報は kpi-react の carePlans / assessments / residentList が正であり、
 * carerecords からは書き込まない。とくに訪問介護計画書（長期目標・短期目標・
 * 援助内容）は kpi-react が版管理している。二重管理にするとどちらが正か
 * 判定できなくなり、運営指導で問題になる。
 *
 * ── 何を載せ、何を載せないか ─────────────────────────────
 * 判定基準: 訪問介護計画書に載る情報 = 配信する
 *           請求・資格に関する情報   = 配信しない
 *
 * ヘルパーは訪問介護計画書に沿って支援する義務があるため、目標・援助内容・
 * 留意事項・ADL は見せるのが正しい。一方、以下は訪問先で不要なので載せない。
 *   - 生活保護受給状況（kpi-react: residentList.welfareStatus / assessments.welfareProtection）
 *   - 減額認定（assessments.reducedRate）
 *   - 障害者手帳・原爆手帳の有無（assessments.disabilityCard / atomicBombCard）
 *   - 請求・給付管理に関する数値（benefits / serviceRecords）
 *   - 生年月日・住所（legacy でも表示しておらず、訪問先で不要。age / sex のみ載せる）
 */
export const carePlanSnapshotSchema = z.object({
  /** 要介護度。kpi-react: residentList.careLevel */
  careLevel: z.string(),
  /** 世帯状況（例: 独居 / 同居家族あり（日中独居））。生活援助の算定判定に使う */
  household: z.string(),
  /** 生活援助の算定理由。同居家族ありのとき必須になる */
  householdSupportReason: z.string(),
  /** 家族構成（例: 長男（同居・日中就労）） */
  family: z.string(),

  /** 障害高齢者の日常生活自立度（J1 / A2 など） */
  adlLevel: z.string(),
  /** 認知症高齢者の日常生活自立度（Ⅰ / Ⅱa など） */
  dementiaLevel: z.string(),
  /** 項目ごとの介助度。記載チェックで実施内容との整合を見る */
  adl: z.partialRecord(adlItemSchema, adlDegreeSchema),
  /** コミュニケーション上の留意点 */
  communication: z.array(z.string()),

  disease: z.string(),
  medication: z.string(),

  /** 訪問介護計画書の長期目標 */
  longTermGoal: z.string(),
  /** 訪問介護計画書の短期目標。記載チェックで経過との整合を見る */
  shortTermGoal: z.string(),
  /** 援助の方針・具体的援助内容 */
  supportPlan: z.string(),
  /** 計画上のサービス内容。実施した内容がこれを外れていないかを見る */
  plannedTasks: z.array(z.string()),
  /** 留意事項・禁忌 */
  caution: z.string(),

  /** kpi-react の carePlans の版。どの版に基づく判定かを追える */
  planVersion: z.number().int().nullable(),
  planUpdatedAt: z.string().nullable(),
});

/** 配信に含める利用者。1日の訪問に登場する利用者だけを載せる */
export const residentBriefSchema = z.object({
  residentId: z.string().min(1),
  name: z.string().min(1),
  furigana: z.string(),
  age: z.string(),
  sex: z.string(),
  carePlan: carePlanSnapshotSchema,
});

/**
 * 配信される1件の訪問。
 *
 * visitId は kpi-react が採番する。現行の visitKey（`${routePlanId}#${rowId}`、
 * VisitRoutePage.jsx:781）をそのまま使うと doc ID に利用者氏名が入るため、
 * Phase 4 では採番に置き換える。
 */
export const dispatchVisitSchema = z.object({
  visitId: z.string().min(1),
  residentId: z.string().min(1),
  serviceName: serviceKindSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  /** 事業所名。kpi-react: routePlans.rows[].officeName */
  officeName: z.string(),
  /**
   * 予定表由来か、その場で追加されたものか。
   * kpi-react の visitRoutes が manual[] で同じ区別をしている（VisitRoutePage.jsx:804）。
   */
  source: z.enum(['plan', 'manual']),
  cancelled: z.boolean(),
  cancelReason: z.string(),
});

/**
 * 配信ドキュメント。1日 × 1職員 = 1ドキュメント。
 *
 * Phase 5 では facilities/{facilityId}/dispatches/{date}_{staffId} に置く。
 * ヘルパーが読めるのは自分の staffId のものだけで、routePlans / visitRoutes /
 * residentList には一切アクセスさせない。これが「kpi-react の他の情報を
 * 見せない」を成立させている仕組みそのものになる。
 */
export const dispatchSchema = z.object({
  schemaVersion: z.number().int(),
  facilityId: z.string().min(1),
  date: dateSchema,
  staffId: z.string().min(1),
  staffName: z.string(),
  visits: z.array(dispatchVisitSchema),
  residents: z.array(residentBriefSchema),
  generatedAt: z.string(),
});

/** バイタル。未測定は空文字で表す（legacy の temp / bp / pulse と同じ） */
export const vitalsSchema = z.object({
  temperature: z.string(),
  bloodPressure: z.string(),
  pulse: z.string(),
});

/**
 * サービス実施記録。carerecords が書き、kpi-react が読む。
 *
 * Phase 5 では facilities/{facilityId}/visitRecords/{visitId} に置く。
 * ヘルパーは自分の staffId のものだけ読み書きできる。
 */
export const visitRecordSchema = z.object({
  schemaVersion: z.number().int(),
  visitId: z.string().min(1),
  facilityId: z.string().min(1),
  date: dateSchema,
  staffId: z.string().min(1),
  residentId: z.string().min(1),
  serviceName: serviceKindSchema,

  /** 予定時刻。配信の値を写す。実績が予定枠を外れていないかの判定に使う */
  plannedStart: timeSchema,
  plannedEnd: timeSchema,
  /** 実績時刻。未入力は空文字 */
  actualStart: z.string(),
  actualEnd: z.string(),

  tasks: z.array(z.string()),
  vitals: vitalsSchema,
  /** 特記事項 */
  note: z.string(),
  status: visitStatusSchema,

  /** 承認者。誰が承認したかは記録として残す必要がある（法定要件） */
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),

  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ServiceKind = z.infer<typeof serviceKindSchema>;
export type VisitStatus = z.infer<typeof visitStatusSchema>;
export type AdlItem = z.infer<typeof adlItemSchema>;
export type AdlDegree = z.infer<typeof adlDegreeSchema>;
export type CarePlanSnapshot = z.infer<typeof carePlanSnapshotSchema>;
export type ResidentBrief = z.infer<typeof residentBriefSchema>;
export type DispatchVisit = z.infer<typeof dispatchVisitSchema>;
export type Dispatch = z.infer<typeof dispatchSchema>;
export type Vitals = z.infer<typeof vitalsSchema>;
export type VisitRecord = z.infer<typeof visitRecordSchema>;

/** 契約違反の内容。呼び出し側が利用者への表示を組み立てられる形にする */
export type ContractViolation =
  | { kind: 'schema-version'; expected: number; actual: unknown }
  | { kind: 'shape'; message: string };

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; violation: ContractViolation };

/**
 * 配信ドキュメントを検証して取り込む。
 *
 * schemaVersion の照合だけでは「版は正しいが形が違う」を検出できないため、
 * 版と形の両方を見る。型のコピーは kpi-react 側との同期漏れが起こりうるので、
 * ここでの実行時検証が実効的な安全網になる。
 */
export function parseDispatch(input: unknown): ParseResult<Dispatch> {
  const versioned = z.object({ schemaVersion: z.unknown() }).safeParse(input);
  const actual = versioned.success ? versioned.data.schemaVersion : undefined;
  if (actual !== SCHEMA_VERSION) {
    return { ok: false, violation: { kind: 'schema-version', expected: SCHEMA_VERSION, actual } };
  }
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, violation: { kind: 'shape', message: z.prettifyError(parsed.error) } };
  }
  return { ok: true, value: parsed.data };
}

/** 実施記録を検証して取り込む。保存前と読み込み後の両方で通す */
export function parseVisitRecord(input: unknown): ParseResult<VisitRecord> {
  const parsed = visitRecordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, violation: { kind: 'shape', message: z.prettifyError(parsed.error) } };
  }
  return { ok: true, value: parsed.data };
}
