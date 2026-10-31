import { useEffect, useRef } from 'react';

/**
 * 只读模式全局禁用 Hook
 * 自动禁用容器内所有的交互元素（button、input、select、a 等）
 * 使用方式：在布局 Content 区域容器上绑定 ref，并传入 isViewOnly 状态
 *
 *   const contentRef = useRef<HTMLDivElement>(null);
 *   useViewOnlyBlocker(contentRef, isViewOnly);
 *   <div ref={contentRef}>...
 */
export function useViewOnlyBlocker(
  containerRef: React.RefObject<HTMLElement | null>,
  isViewOnly: boolean,
) {
  const disabledElsRef = useRef<Set<HTMLElement>>(new Set());
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /** 禁用单个元素，记录原始状态 */
    const disableEl = (el: HTMLElement) => {
      if (disabledElsRef.current.has(el)) return;
      disabledElsRef.current.add(el);

      if (el.tagName === 'A') {
        // a 标签：记录原始 href 和 onclick，阻止跳转
        const a = el as HTMLAnchorElement;
        (a as any)._voOrigHref = a.href;
        (a as any)._voOrigOnclick = a.onclick;
        a.href = 'javascript:void(0)';
        a.onclick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          return false;
        };
      } else {
        // button/input/select/textarea：设置 disabled
        const elWithDisabled = el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        (el as any)._voOrigDisabled = elWithDisabled.disabled;
        elWithDisabled.disabled = true;
      }

      // 视觉样式：降低透明度
      el.style.opacity = '0.55';
      el.style.cursor = 'not-allowed';
      const origTitle = el.title || '';
      if (!origTitle.includes('只读模式')) {
        el.title = (origTitle ? origTitle + ' · ' : '') + '只读模式，无法操作';
      }
    };

    /** 恢复单个元素的原始状态 */
    const restoreEl = (el: HTMLElement) => {
      if (!disabledElsRef.current.has(el)) return;
      disabledElsRef.current.delete(el);

      if (el.tagName === 'A') {
        const a = el as HTMLAnchorElement;
        const origHref = (a as any)._voOrigHref;
        const origOnclick = (a as any)._voOrigOnclick;
        if (origHref) a.href = origHref;
        if (origOnclick) a.onclick = origOnclick;
      } else {
        const elWithDisabled = el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const orig = (el as any)._voOrigDisabled;
        elWithDisabled.disabled = orig ?? false;
      }

      el.style.opacity = '';
      el.style.cursor = '';
      el.title = (el.title || '').replace(/ · 只读模式，无法操作$/, '');
    };

    /** 查询并禁用容器内所有交互元素 */
    const disableAll = () => {
      if (!container) return;
      const selector = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]:not([href="javascript:void(0)"])',
      ].join(',');
      container.querySelectorAll<HTMLElement>(selector).forEach(disableEl);
    };

    /** 恢复所有已禁用元素的原始状态 */
    const restoreAll = () => {
      disabledElsRef.current.forEach(restoreEl);
      disabledElsRef.current.clear();
    };

    if (isViewOnly) {
      disableAll();

      // 监听 DOM 变化，自动禁用新加入的交互元素
      const observer = new MutationObserver(() => {
        if (container && isViewOnly) {
          disableAll();
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      observerRef.current = observer;
    } else {
      restoreAll();
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      restoreAll();
    };
  }, [containerRef, isViewOnly]);
}
