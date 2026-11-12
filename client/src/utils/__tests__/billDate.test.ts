// 账单日期归一单测：回归护栏是「列表汇总与页面可见行口径一致」这一修复
import { normBillDay } from '../billDate';

describe('normBillDay 账单日期归一', () => {
  it('斜杠日期归一为横线 YYYY-MM-DD', () => {
    expect(normBillDay('2026/11/11')).toBe('2026-11-11');
    expect(normBillDay('2026/1/5')).toBe('2026-01-05');
  });

  it('带时间的字符串只保留日期部分', () => {
    expect(normBillDay('2026-11-11 18:30:00')).toBe('2026-11-11');
    expect(normBillDay('2026/11/11 09:00:00')).toBe('2026-11-11');
  });

  it('已归一的值保持幂等', () => {
    expect(normBillDay(normBillDay('2026/11/11'))).toBe('2026-11-11');
  });

  it('空值返回空串', () => {
    expect(normBillDay('')).toBe('');
    expect(normBillDay('   ')).toBe('');
    expect(normBillDay(null)).toBe('');
    expect(normBillDay(undefined)).toBe('');
  });

  it('无法解析的历史脏值原样返回且不抛异常', () => {
    expect(normBillDay('未发货')).toBe('未发货');
    expect(normBillDay('N/A')).toBe('N/A');
    expect(normBillDay('暂无')).toBe('暂无');
  });
});
