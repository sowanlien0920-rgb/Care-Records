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
import { AdapterError, type DataAdapter } from './adapter';
import { MOCK_STAFF, mockDispatch } from './mock';
import { parseVisitRecord, type Dispatch, type VisitRecord } from '../types/contract';
import {
  auditLogSchema, incidentSchema, recordPrefsSchema, blankRecordPrefs,
  type AuditLog, type Incident, type RecordPrefs, type StaffAccount,
} from '../types/local';
import { z } from 'zod';

const NS = 'carerecords.v2';
const KEY = {
  records: `${NS}.visitRecords`,
  prefs: `${NS}.recordPrefs`,
  incidents: `${NS}.incidents`,
  auditLogs: `${NS}.auditLogs`,
} as const;

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

export const localAdapter: DataAdapter = {
  async listStaff(): Promise<StaffAccount[]> {
    // Phase 5 で Firebase Auth + users/{uid} に置き換わる
    return MOCK_STAFF.filter((s) => s.active);
  },

  async getDispatch(date: string, staffId: string): Promise<Dispatch | null> {
    // Phase 4 までは kpi-react が配信を書き出さないため、モックで代替する。
    // Phase 5 では Firestore の dispatches/{date}_{staffId} を読み、
    // parseDispatch() で schemaVersion と形を検証してから返す。
    return mockDispatch(date, staffId);
  },

  async listRecords(date: string, staffId?: string): Promise<VisitRecord[]> {
    const all = readList(KEY.records, z.unknown());
    const records: VisitRecord[] = [];
    for (const raw of all) {
      const parsed = parseVisitRecord(raw);
      if (!parsed.ok) {
        throw new AdapterError('contract', '保存されている実施記録の形式が正しくありません。',
          parsed.violation.kind === 'shape' ? parsed.violation.message : 'schemaVersion 不一致');
      }
      records.push(parsed.value);
    }
    return records.filter((r) => r.date === date && (staffId === undefined || r.staffId === staffId));
  },

  async saveRecord(record: VisitRecord): Promise<void> {
    const parsed = parseVisitRecord(record);
    if (!parsed.ok) {
      throw new AdapterError('contract', '記録の内容が正しくありません。入力を確認してください。',
        parsed.violation.kind === 'shape' ? parsed.violation.message : 'schemaVersion 不一致');
    }
    const all = readList(KEY.records, z.unknown()) as VisitRecord[];
    writeRaw(KEY.records, upsert(all, parsed.value, 'visitId'));
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

  async listIncidents(): Promise<Incident[]> {
    return readList(KEY.incidents, incidentSchema);
  },

  async saveIncident(incident: Incident): Promise<void> {
    const parsed = incidentSchema.safeParse(incident);
    if (!parsed.success) {
      throw new AdapterError('contract', '報告の内容が正しくありません。入力を確認してください。', z.prettifyError(parsed.error));
    }
    const all = readList(KEY.incidents, incidentSchema);
    writeRaw(KEY.incidents, upsert(all, parsed.data, 'incidentId'));
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

/** 開発時にモックを初期状態へ戻す。Phase 5 では不要になる */
export function resetLocalData(): void {
  for (const k of Object.values(KEY)) {
    try {
      localStorage.removeItem(k);
    } catch {
      // 消せなくても致命的ではない
    }
  }
}
