// 账单/统计日期归一（纯函数，便于单测）
// 背景：订单行 outboundDate 可能是 '2026/11/11' 或带时间的字符串，统计时间范围用字符串比较筛选，
// 不归一则该行被整体排除，导致「列表汇总的采购总额」与「页面上可见账单行」口径不一致。
import dayjs from 'dayjs';

/** 归一为 YYYY-MM-DD；无法解析的值原样返回（空值返回空串），不抛异常 */
export const normBillDay = (v: any): string => {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = dayjs(s.replace(/\//g, '-'));
  return d.isValid() ? d.format('YYYY-MM-DD') : s;
};
