/*
 * 絞り込み。移植元: legacy/index.html:871-877、ハンドラは :1800-1804
 *
 * .fbtn.on（styles.css:140）が無いと選択状態が分からなくなる。
 * display は変わらないのでエラーも出ず、見た目だけ壊れる。
 *
 * legacy は初期の on を静的 HTML に直書きしており cur.filter と同期していなかった。
 * ここでは filter から導出するため、その不整合は起きない。
 */
import { useCareStore } from '../../store/useCareStore';
import type { VisitStatus } from '../../types/contract';

const OPTIONS: Array<{ value: VisitStatus | 'all'; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: '未完', label: '未完' },
  { value: '済', label: '済' },
  { value: '完了', label: '完了' },
  { value: 'キャンセル', label: 'キャンセル' },
];

export function Filters() {
  const { filter, setFilter } = useCareStore();
  return (
    <div className="filters" id="filters">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={`fbtn${filter === o.value ? ' on' : ''}`}
          data-f={o.value}
          onClick={() => setFilter(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
