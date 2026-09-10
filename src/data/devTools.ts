/*
 * 開発用のユーティリティ。
 *
 * CLAUDE.md の鉄則3「localStorage を直接触らない」に対する唯一の例外を、
 * ファイルとして分離してある。UI から import されたら、それはレビューで
 * 気づくべき違反であることが名前から分かるようにするため。
 */
import { LOCAL_STORAGE_KEYS } from './localAdapter';

/** 保存済みデータを初期状態へ戻す。Phase 5 では不要になる */
export function resetLocalData(): void {
  for (const k of Object.values(LOCAL_STORAGE_KEYS)) {
    try {
      localStorage.removeItem(k);
    } catch {
      // 消せなくても致命的ではない
    }
  }
}
