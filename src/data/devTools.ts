/*
 * 開発用のユーティリティ。
 *
 * CLAUDE.md の鉄則3「localStorage を直接触らない」に対する唯一の例外を、
 * ファイルとして分離してある。UI から import されたら、それはレビューで
 * 気づくべき違反であることが名前から分かるようにするため。
 */
import { LOCAL_STORAGE_KEYS } from './localAdapter';
import { INCIDENT_STORAGE_KEY } from '../features/incident/incidentAdapter';

/**
 * 保存済みデータを初期状態へ戻す。Phase 5 では不要になる。
 * ヒヤリハットは別の境界（incidentAdapter）にあるため、
 * DataAdapter のキーだけを消すと報告が残ったままになる。
 */
export function resetLocalData(): void {
  for (const k of [...Object.values(LOCAL_STORAGE_KEYS), INCIDENT_STORAGE_KEY]) {
    try {
      localStorage.removeItem(k);
    } catch {
      // 消せなくても致命的ではない
    }
  }
}
