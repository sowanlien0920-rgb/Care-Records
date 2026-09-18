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
 *
 * ── 版の履歴 ────────────────────────────────────────────
 * 1: Phase 1a。配信と実施記録の初版
 * 2: Phase 1b。VisitRecord に mood / memo を追加し、noteSource に 'template' を足した
 * 3: Phase 4。DispatchVisit と VisitRecord に serviceCode を追加した
 */
export const SCHEMA_VERSION = 3;

/**
 * YYYY-MM-DD。形だけでなく実在する日付かも見る。
 * 正規表現だけだと 2026-13-45 や 2026-02-30 が通ってしまう。
 */
export const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定する')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    if (y === undefined || m === undefined || d === undefined) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, '実在する日付を指定する');

/**
 * HH:mm。形だけでなく実在する時刻かも見る。
 * 正規表現だけだと 25:70 や 99:99 が通ってしまう。
 * 実績時間はサービス提供の根拠であり請求に直結するため、ここは緩めない。
 */
export const timeSchema = z.string()
  .regex(/^\d{2}:\d{2}$/, 'HH:mm 形式で指定する')
  .refine((v) => {
    const [h, m] = v.split(':').map(Number);
    return h !== undefined && m !== undefined && h < 24 && m < 60;
  }, '実在する時刻を指定する');

/** 実績時刻。未入力は空文字で表す。入っている場合は HH:mm として検証する */
export const optionalTimeSchema = z.union([z.literal(''), timeSchema]);

/** 訪問介護のサービス区分。legacy/index.html:1640 の SERVICES と一致させる */
/**
 * サービス種別。4値に畳んだもの。
 *
 * kpi-react の SERVICE_MASTER は算定区分ごとに40以上のコードを持つ
 * （身体介護01・夜 / 身体1生活2 / 障害・家事1.0 など）。それをこの4値へ
 * 対応付けたうえで、元のコードは serviceCode に残す。
 * 記載チェックや帳票はこの4値で判定し、算定区分の細かさは serviceCode で追う。
 */
export const serviceKindSchema = z.enum([
  '身体介護',
  '生活援助',
  '身体＋生活',
  '通院等乗降介助',
]);

/**
 * 実施記録の状態。legacy の status と一致させる。
 *
 * ── キャンセルの正は配信側にある ────────────────────────
 * キャンセルは DispatchVisit.cancelled（kpi-react のルート表由来）と
 * この 'キャンセル' の2箇所で表現しうる。正は配信側とする。
 * 訪問の中止は事業所の判断であり、ルート表で管理されるため。
 * 判定順は src/domain/visitStatus.ts の deriveStatus() に閉じてある。
 */
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
 * visitId は kpi-react が採番する。形は次のとおり（`utils/dispatch.js`）。
 *
 *   予定由来  `${date}#${residentId}#${rowId}`
 *   手動追加  `${date}#${visitKey}`（visitKey は `m_...` で氏名を含まない）
 *
 * **氏名を入れない。** 予定表の visitKey は `${routePlanId}#${rowId}` で、
 * routePlanId が `年月_氏名` になっている。そのまま使うと配信と実施記録の
 * doc ID に利用者氏名が載る。実施記録は完結の日から2年（自治体により5年）
 * 保存する法定文書であり、doc ID は後から変えられない。
 *
 * 日付を含めるのは、visitKey に日付が無く、同じ利用者の別日が衝突するため。
 */
export const dispatchVisitSchema = z.object({
  visitId: z.string().min(1),
  residentId: z.string().min(1),
  serviceName: serviceKindSchema,
  /**
   * kpi-react の算定コード。SERVICE_MASTER のキーそのもの（例: 身体介護01・夜）。
   * serviceName はこれを4値へ畳んだ結果であり、畳む前の区分をここに残す。
   *
   * 配信してよいと判断した根拠。サービス種別と提供時間帯は訪問介護計画書に
   * 載る情報であり、ヘルパーが「何をどの区分で提供するか」を知るのは正当である。
   * 受給資格や請求金額そのものは配信しない。
   *
   * 対応するコードが無い場合は空文字（「値がないは空文字」の扱い）。
   */
  serviceCode: z.string(),
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
 *
 * ── mood / memo は carerecords が書き、kpi-react は読まない ──
 * どちらも訪問先でヘルパーが観察・記入するもので、kpi-react 側に対応する
 * 項目が無い。Phase 4 でこのファイルを kpi-react へコピーしても、
 * kpi-react からは参照しない。逆向き（kpi-react が書く）は起こらない。
 */
export const visitRecordSchema = z.object({
  schemaVersion: z.number().int(),
  visitId: z.string().min(1),
  facilityId: z.string().min(1),
  date: dateSchema,
  staffId: z.string().min(1),
  residentId: z.string().min(1),
  serviceName: serviceKindSchema,
  /**
   * 算定コード。配信の値を写す。
   *
   * 配信ドキュメントは日単位で作り直されうるため、記録側に持たないと
   * 後から算定区分を追えなくなる。実施記録は完結の日から2年（自治体により
   * 5年）保存する法定文書であり、staffName を ID とは別に残すのと同じ理由で、
   * 記録単体で読める状態にしておく。
   */
  serviceCode: z.string(),

  /** 予定時刻。配信の値を写す。実績が予定枠を外れていないかの判定に使う */
  plannedStart: timeSchema,
  plannedEnd: timeSchema,
  /** 実績時刻。未入力は空文字。入力があれば HH:mm として検証する */
  actualStart: optionalTimeSchema,
  actualEnd: optionalTimeSchema,

  tasks: z.array(z.string()),
  vitals: vitalsSchema,
  /** 特記事項 */
  note: z.string(),
  /**
   * 特記事項をどう書いたか。legacy の noteSrc（一覧のアイコンが ✨ か 📝 かを決める）。
   *
   * 'template' は定型文生成（domain/noteBuilder.ts）が組み立てたもの。legacy は
   * AI 失敗時のフォールバックを 'fb' として別に持っていたが、フォールバックも
   * 定型文であることに変わりはないため 'template' に寄せる。
   * 運営指導では「AI が書いたか / 定型文が組み立てたか / 人が書いたか」の区別を
   * 記録から読めることが求められうるので、この3値は畳まない。
   */
  noteSource: z.enum(['ai', 'template', 'manual']).nullable(),

  /**
   * ご本人の様子。legacy の v.mood（:1861）。選択肢は domain/vocabulary.ts の MOOD_OPTIONS。
   * 未選択は空文字で表す（note / vitals と同じ「値がないは空文字」の扱い）。
   *
   * 選択肢を enum で縛らないのは、事業所ごとに語を足しうるため。
   * 値域の正は MOOD_OPTIONS 側に置き、契約は文字列として受ける。
   */
  mood: z.string(),
  /**
   * ヘルパーのメモ。legacy の v.memo（:1861）。特記事項そのものではなく、
   * 定型文生成（domain/noteBuilder.ts）の入力になる下書きにあたる。
   */
  memo: z.string(),
  status: visitStatusSchema,

  /**
   * 記録時点の職員名。staffId とは別に名前そのものを残す。
   * 記録は完結の日から2年（自治体により5年）保存する必要があり、
   * その間ずっと staffs コレクションから氏名を引けるとは限らない。
   * 記録単体で「誰が実施したか」を読めることが法定文書の要件になる。
   */
  staffName: z.string(),

  /**
   * どの版の訪問介護計画書に基づく記録か。
   * 記載チェックは計画書（短期目標・援助内容・サービス内容）に照らして判定する。
   * 版を残さないと、運営指導で計画書と記録の整合を問われたときに
   * 「どの計画に沿った記録か」を示せない。配信に版が無ければ null。
   */
  carePlanVersion: z.number().int().nullable(),

  /** 承認者。誰が承認したかは記録として残す必要がある（法定要件） */
  approvedBy: z.string().nullable(),
  /** 承認者の氏名。staffName と同じ理由で ID とは別に残す */
  approvedByName: z.string().nullable(),
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
 * 版を照合する。違反があれば返し、無ければ null。
 *
 * 入力がオブジェクトですらない場合（Firestore が文字列や配列を返した等）は
 * 版の問題ではなく形の問題なので、shape 違反として報告する。
 * schema-version 違反として報告すると、障害調査を誤った方向に導く。
 */
function checkSchemaVersion(input: unknown): ContractViolation | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { kind: 'shape', message: 'オブジェクトではありません' };
  }
  const actual = (input as Record<string, unknown>)['schemaVersion'];
  if (actual !== SCHEMA_VERSION) {
    return { kind: 'schema-version', expected: SCHEMA_VERSION, actual };
  }
  return null;
}

/**
 * 配信ドキュメントを検証して取り込む。
 *
 * schemaVersion の照合だけでは「版は正しいが形が違う」を検出できないため、
 * 版と形の両方を見る。型のコピーは kpi-react 側との同期漏れが起こりうるので、
 * ここでの実行時検証が実効的な安全網になる。
 */
export function parseDispatch(input: unknown): ParseResult<Dispatch> {
  const violation = checkSchemaVersion(input);
  if (violation !== null) return { ok: false, violation };
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, violation: { kind: 'shape', message: z.prettifyError(parsed.error) } };
  }
  return { ok: true, value: parsed.data };
}

/**
 * 実施記録を検証して取り込む。保存前と読み込み後の両方で通す。
 *
 * 記録は carerecords が書き kpi-react が読む双方向の契約なので、
 * 配信と同じく版と形の両方を見る。Phase 5 では同じ Firestore を
 * 複数端末・複数バージョンが触るため、版ズレは実際に起こりうる。
 */
export function parseVisitRecord(input: unknown): ParseResult<VisitRecord> {
  const violation = checkSchemaVersion(input);
  if (violation !== null) return { ok: false, violation };
  const parsed = visitRecordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, violation: { kind: 'shape', message: z.prettifyError(parsed.error) } };
  }
  return { ok: true, value: parsed.data };
}

/**
 * 実施記録を組み立てる唯一の入口。
 * SCHEMA_VERSION の打刻をここに閉じることで、呼び出し側の入れ忘れを型で防ぐ。
 */
export function buildVisitRecord(fields: Omit<VisitRecord, 'schemaVersion'>): VisitRecord {
  return { ...fields, schemaVersion: SCHEMA_VERSION };
}
