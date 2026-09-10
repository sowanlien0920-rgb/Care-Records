import { useContext } from 'react';
import { CareStoreContext, type CareStore } from './context';

/**
 * アプリのデータと操作を取り出す。
 * UI は localStorage を直接触らず、必ずこれを経由する。
 */
export function useCareStore(): CareStore {
  const store = useContext(CareStoreContext);
  if (store === null) {
    throw new Error('useCareStore は CareStoreProvider の内側で使うこと');
  }
  return store;
}
