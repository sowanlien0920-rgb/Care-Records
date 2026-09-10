/*
 * ヒヤリハット・事故報告の送信先。
 *
 * ── なぜ DataAdapter と分けているか ───────────────────────
 * 統合先が未定である（計画書 §2 の J）。
 *   - kpi-react は別プロジェクト incident-report-f1bec への接続を既に持つ
 *   - ただし incident-report は薬局・訪問看護など他業種でも同一フォーマットの
 *     使用を想定しており、訪問介護固有の作りを組み込んで1本化するのは
 *     難しい可能性がある
 *
 * DataAdapter に同居させると、Phase 5 で DataAdapter を firestoreAdapter に
 * 差し替えたとき、送信先も一緒に carerecords 側の Firestore に固定される。
 * 保留を保留のまま保つために、境界を独立させておく。
 */
import { AdapterError } from '../../data/adapter';
import { incidentSchema, type Incident } from '../../types/local';
import { z } from 'zod';

const KEY = 'carerecords.v2.incidents';

export interface IncidentAdapter {
  list(): Promise<Incident[]>;
  save(incident: Incident): Promise<void>;
}

/** carerecords 内で完結する実装。統合先が決まったら別実装に差し替える */
export const localIncidentAdapter: IncidentAdapter = {
  async list(): Promise<Incident[]> {
    let raw: string | null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      throw new AdapterError('storage', '報告の読み込みに失敗しました。', String(e));
    }
    if (raw === null) return [];
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new AdapterError('contract', '保存されている報告の形式が正しくありません。');
    }
    const parsed = z.array(incidentSchema).safeParse(parsedJson);
    if (!parsed.success) {
      throw new AdapterError('contract', '保存されている報告の形式が正しくありません。', z.prettifyError(parsed.error));
    }
    return parsed.data;
  },

  async save(incident: Incident): Promise<void> {
    const parsed = incidentSchema.safeParse(incident);
    if (!parsed.success) {
      throw new AdapterError('contract', '報告の内容が正しくありません。入力を確認してください。', z.prettifyError(parsed.error));
    }
    const all = await localIncidentAdapter.list();
    const i = all.findIndex((x) => x.incidentId === parsed.data.incidentId);
    const next = i < 0 ? [...all, parsed.data] : all.map((x, n) => (n === i ? parsed.data : x));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      throw new AdapterError('storage', '報告の保存に失敗しました。', String(e));
    }
  },
};
