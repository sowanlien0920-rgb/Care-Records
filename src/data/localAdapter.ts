/*
 * DataAdapter の localStorage 実装。
 *
 * Phase 5 で firestoreAdapter に差し替える。UI からは見えない層なので、
 * ここでの都合（同期 API であること、キーの持ち方）を外へ漏らさない。
 *
 * legacy のキー（visitcare.records.v1 / visitcare.aicfg.v1 / visitcare.backup.*）
 * には触れない。移行対象の実データは存在しないと確認済みのため、
 * 新しいキーで独立して開始する。
 */
import { AdapterError, type BadgeCounts, type DataAdapter, type RecordListing } from './adapter';
import { MOCK_STAFF, mockDispatch, mockDispatchDates, mockSeedRecords } from './mock';
import { parseDispatch, parseVisitRecord, type Dispatch, type VisitRecord } from '../types/contract';
import {
  auditLogSchema, recordPrefsSchema, blankRecordPrefs,
  type AuditLog, type RecordPrefs, type StaffAccount,
} from '../types/local';
import { z } from 'zod';
import { iso } from '../utils/date';
import { recordOf, todoStage } from '../domain/visitStatus';

const NS = 'carerecords.v2';
const KEY = {
  records: `${NS}.visitRecords`,
  prefs: `${NS}.recordPrefs`,
  auditLogs: `${NS}.auditLogs`,
} as const;

// ヒヤリハットは統合先が未定のため、この層ではなく
// src/features/incident/incidentAdapter.ts が持つ（計画書 §2 の J）。

/**
 * localStorage の読み書きは、プライベートモードや容量超過で例外を投げる。
 * 「保存領域が使えない」は利用者に伝えるべき状態なので、握り潰さない。
 */
function readRaw(key: string): unknown {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    throw new AdapterError('storage', 'データの読み込みに失敗しました。ブラウザの設定を確認してください。', String(e));
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // 壊れた JSON は契約違反として扱う。握り潰すと欠落に気づけない
    throw new AdapterError('contract', '保存されているデータの形式が正しくありません。');
  }
}

function writeRaw(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    throw new AdapterError('storage', 'データの保存に失敗しました。保存容量を確認してください。', String(e));
  }
}

/** 配列を読み、各要素をスキーマで検証する。壊れた要素は落とさず失敗させる */
function readList<T>(key: string, schema: z.ZodType<T>): T[] {
  const raw = readRaw(key);
  if (raw === null) return [];
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) {
    throw new AdapterError('contract', '保存されているデータの形式が正しくありません。', z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/** 保存時にも検証する。書くときに弾けば、読むときに壊れているケースを減らせる */
function upsert<T extends Record<string, unknown>>(list: T[], item: T, idKey: keyof T): T[] {
  const i = list.findIndex((x) => x[idKey] === item[idKey]);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}

/**
 * 配信を契約に照らして検証する。
 *
 * Phase 5 では Firestore から来る外部入力になるため、この検証が唯一の防壁になる。
 * Phase 1a の時点でもモックをここに通しておくことで、モックが契約から乖離したら
 * その場で失敗する。計画書のリスク3（モックが Phase 4 の実データと乖離する）を
 * 実際に検出できる状態にしておくことが目的になる。
 */
function validateDispatch(raw: unknown): Dispatch {
  const parsed = parseDispatch(raw);
  if (parsed.ok) return parsed.value;
  if (parsed.violation.kind === 'schema-version') {
    throw new AdapterError(
      'contract',
      'この端末では読み込めない形式の予定です。アプリを最新版に更新してください。',
      `schemaVersion expected=${parsed.violation.expected} actual=${String(parsed.violation.actual)}`,
    );
  }
  throw new AdapterError('contract', '予定の形式が正しくありません。事業所に連絡してください。', parsed.violation.message);
}

/**
 * 保存済みの実施記録を読む。
 *
 * 1件でも壊れていたら全体を失敗させる、という扱いは取らない。
 * それをすると破損1件で全期間・全職員の記録が読めなくなり、
 * 保存領域の中身が変わらない以上、再試行しても復旧しない。
 * 読めた分・読めなかった分・書き戻し用の原文を分けて返す。
 */
function readRecords(): { records: VisitRecord[]; unreadable: RecordListing['unreadable']; unreadableRaw: unknown[] } {
  // 初回のみデモ用の記録を蒔く。Phase 5 では不要になる。
  // 「まだ何も保存していない」と「保存領域が読めない」を取り違えないよう、
  // readRaw が null を返したときだけ行う（例外は素通しする）
  if (readRaw(KEY.records) === null) {
    writeRaw(KEY.records, mockSeedRecords());
  }
  const all = readList(KEY.records, z.unknown());
  const records: VisitRecord[] = [];
  const unreadable: RecordListing['unreadable'] = [];
  const unreadableRaw: unknown[] = [];
  for (const raw of all) {
    const parsed = parseVisitRecord(raw);
    if (parsed.ok) {
      records.push(parsed.value);
      continue;
    }
    // visitId だけでも読めれば、どの訪問の記録が壊れているかを利用者に示せる
    const idOnly = z.object({ visitId: z.string().min(1) }).safeParse(raw);
    unreadable.push({
      visitId: idOnly.success ? idOnly.data.visitId : null,
      reason: parsed.violation.kind === 'shape' ? parsed.violation.message : 'schemaVersion 不一致',
    });
    unreadableRaw.push(raw);
  }
  return { records, unreadable, unreadableRaw };
}

export const localAdapter: DataAdapter = {
  async listStaff(): Promise<StaffAccount[]> {
    // Phase 5 で Firebase Auth + users/{uid} に置き換わる
    return MOCK_STAFF.filter((s) => s.active);
  },

  async getDispatch(date: string, staffId: string): Promise<Dispatch | null> {
    // Phase 4 までは kpi-react が配信を書き出さないため、モックで代替する。
    // Phase 5 では mockDispatch() を Firestore の dispatches/{date}_{staffId} の
    // 取得に差し替える。検証はこの境界に置いてあるので、差し替えても検証は残る。
    const raw = mockDispatch(date, staffId);
    // 配信が存在しないことは正常な結果であり、契約違反ではない
    if (raw === null) return null;
    return validateDispatch(raw);
  },

  async listRecords(date: string, staffId?: string): Promise<RecordListing> {
    const { records, unreadable } = readRecords();
    return {
      records: records.filter((r) => r.date === date && (staffId === undefined || r.staffId === staffId)),
      // 破損は日付・職員で絞り込めない（絞り込みに使う項目自体が読めないため）。
      // 隠すと欠落に気づけないので、スコープに関わらず全件を返す。
      unreadable,
    };
  },

  async saveRecord(record: VisitRecord): Promise<void> {
    const parsed = parseVisitRecord(record);
    if (!parsed.ok) {
      throw new AdapterError('contract', '記録の内容が正しくありません。入力を確認してください。',
        parsed.violation.kind === 'shape' ? parsed.violation.message : 'schemaVersion 不一致');
    }
    // 読めた記録だけを書き戻すと破損が消える。実施記録は法定文書であり、
    // 読めないからといって削除してよいものではないため、原文のまま持ち越す。
    const { records, unreadableRaw } = readRecords();
    const next = upsert(records, parsed.value, 'visitId');
    writeRaw(KEY.records, [...next, ...unreadableRaw]);
  },

  /**
   * バッジ件数。
   *
   * 統計とは数え方が違う点に注意する（legacy の非対称をそのまま写している）。
   *   統計   : 表示中の職員の、表示中の1日
   *   未完了 : ログイン中の職員の、今日以前すべて
   *   未承認 : 全職員・全期間
   * ログイン中の職員と表示中の職員は、サ責が他職員を表示したときに食い違う。
   */
  async getBadgeCounts(sessionStaffId: string): Promise<BadgeCounts> {
    const { records } = readRecords();
    const today = iso(new Date());

    // 未完了: legacy/index.html:3255-3258（todoMine）と同じ。今日を含む今日以前のみ
    let todo = 0;
    for (const date of mockDispatchDates()) {
      if (date > today) continue;
      const d = mockDispatch(date, sessionStaffId);
      if (d === null) continue;
      for (const v of d.visits) {
        if (todoStage(v, recordOf(v.visitId, records)) >= 0) todo += 1;
      }
    }

    // 未承認: legacy/index.html:3463（pendReady）と同じ。職員でも日付でも絞らない
    const pending = records.filter((r) => r.status === '済').length;

    return { todo, pending };
  },
  async getPrefs(residentId: string): Promise<RecordPrefs> {
    const raw = readRaw(KEY.prefs);
    if (raw === null) return blankRecordPrefs();
    const parsed = z.record(z.string(), recordPrefsSchema).safeParse(raw);
    if (!parsed.success) {
      throw new AdapterError('contract', '記録設定の形式が正しくありません。', z.prettifyError(parsed.error));
    }
    return parsed.data[residentId] ?? blankRecordPrefs();
  },

  async savePrefs(residentId: string, prefs: RecordPrefs): Promise<void> {
    const parsed = recordPrefsSchema.safeParse(prefs);
    if (!parsed.success) {
      throw new AdapterError('contract', '記録設定の内容が正しくありません。', z.prettifyError(parsed.error));
    }
    const raw = readRaw(KEY.prefs);
    const current = raw === null ? {} : z.record(z.string(), recordPrefsSchema).parse(raw);
    writeRaw(KEY.prefs, { ...current, [residentId]: parsed.data });
  },

  async listAuditLogs(): Promise<AuditLog[]> {
    return readList(KEY.auditLogs, auditLogSchema);
  },

  async appendAuditLog(log: AuditLog): Promise<void> {
    const parsed = auditLogSchema.safeParse(log);
    if (!parsed.success) {
      throw new AdapterError('contract', '変更履歴の記録に失敗しました。', z.prettifyError(parsed.error));
    }
    const all = readList(KEY.auditLogs, auditLogSchema);
    writeRaw(KEY.auditLogs, [...all, parsed.data]);
  },
};

export { KEY as LOCAL_STORAGE_KEYS };
