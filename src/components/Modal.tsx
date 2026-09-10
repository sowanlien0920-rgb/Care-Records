/*
 * モーダルの共通土台。
 *
 * ── なぜ <dialog> を使わないか ──────────────────────────
 * ネイティブの <dialog> ならフォーカストラップと Esc が無料で付くが、
 * legacy の CSS は `.mask`（position:fixed / display:none）と
 * `.mask.on{display:flex}` に依存しており（styles.css:205-210）、
 * <dialog> の UA スタイルと ::backdrop がこれと衝突する。
 * CLAUDE.md の鉄則2（styles.css を書き換えない・DOM の入れ子を変えない）を
 * 優先し、div 構造のまま以下を自前で実装している。
 *   1. キーボードだけで操作できる（Tab / Shift+Tab / Esc）
 *   2. フォーカスが内部から出ない
 *   3. 閉じたときに開いた元のボタンへフォーカスを戻す
 *   4. role="dialog" / aria-modal / aria-labelledby で状態を伝える
 *
 * `.mask` は `.on` が無いと display:none のままなので必ず付ける。
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  title, subtitle, onClose, children, footer, width,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * モーダルの最大幅(px)。legacy は画面ごとに .modal へインラインで
   * `width:min(Npx,100%)` を指定していた。既定は styles.css:211 の 680px。
   * ここを省くと、行のグリッドにある 1fr 列が潰れて表示が崩れる。
   */
  width?: number;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 開いたときにフォーカスがあった要素。閉じたらここへ戻す
  const openerRef = useRef<Element | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    const root = modalRef.current;
    if (root === null) return [];
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    // 開いた直後は見出しではなく最初の操作要素に置く。入力がすぐ始められる
    const first = focusables()[0] ?? modalRef.current;
    first?.focus();

    const opener = openerRef.current;
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [focusables]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (firstEl === undefined || lastEl === undefined) return;
      // フォーカスを内部で循環させる
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, focusables]);

  return (
    <div
      className="mask on"
      // 背景のクリックで閉じる。中身のクリックでは閉じない
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        style={width === undefined ? undefined : { width: `min(${width}px,100%)` }}
      >
        <div className="modal-head">
          <div>
            <div className="t" id={titleId}>{title}</div>
            {subtitle !== undefined && <div className="s">{subtitle}</div>}
          </div>
          <button className="x" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer !== undefined && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
