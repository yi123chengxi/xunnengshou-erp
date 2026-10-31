import { useEffect, useRef, useState } from 'react';

/**
 * 表格贴窗底协同测高：动态测量表体可用高度（以所在 TabPane 容器底边为基准，
 * 禁止用 window.innerHeight——Tabs 容器 padding 会使 innerHeight 偏大），
 * 并把 .ant-table-body 的 min-height 锁为同值（min=max），使数据少时留白在表体内部、
 * 横向滚动条与分页器始终紧贴窗口底部；垂直滚动条只出现在表体内部。
 * 用法：wrapper div 挂 ref，Table 传 scroll={{ x, y: scrollY }}，分页保持默认底部位置。
 */
const useStickTableHeight = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState<number | string>(400);
  useEffect(() => {
    const calc = () => {
      if (!ref.current) return;
      const header = ref.current.querySelector('.ant-table-thead') as HTMLElement;
      if (!header) return;
      const bodyTop = header.getBoundingClientRect().bottom;
      const pane = ref.current.closest('.ant-tabs-tabpane') as HTMLElement;
      const bottom = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
      const available = Math.max(200, bottom - bodyTop - 52);
      setScrollY(available);
      const body = ref.current.querySelector('.ant-table-body') as HTMLElement;
      if (body) body.style.minHeight = `${available}px`;
    };
    const t1 = setTimeout(calc, 150);
    const t2 = setTimeout(calc, 500);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', calc); };
  }, []);
  return { ref, scrollY };
};

export default useStickTableHeight;
