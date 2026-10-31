/**
 * 客户采购价策略（一客一价）共享模块
 *
 * 存储键（均按 getDataOwner 隔离，且已加入 serverSync 同步白名单）：
 *   price_strategy_<owner>           策略列表 PriceStrategy[]
 *   price_strategy_settings_<owner>  全局取整/保底设置 PriceRoundSettings
 *
 * 取价口径：
 *   1. 命中集 = 启用 + 生效期内 + 适用端匹配 + 目标匹配（等级 / 采购商 / 采购商+商品）的策略；
 *   2. 排序：priority 升序（数字小优先级高）→ 模式高低（指定采购商及商品 > 按采购商 > 按等级）→ 更新时间新者；
 *   3. 行级商品规则优先于表头默认规则；公式模式按商品档案当前 costPrice/suggestedPrice 实时计算；
 *   4. 结果经全局取整规则处理，可选成本价保底；无命中返回 null（调用方回退默认价）。
 */
import { saveDataset } from './dataStore';

export type PriceMode = 'fixed' | 'cost_add' | 'cost_sub' | 'sale_add' | 'sale_sub' | 'discount';
export interface PriceRule { mode: PriceMode; value: number; }
export interface StrategyItem { productCode: string; productName?: string; styleCode?: string; rule: PriceRule; }
/** 策略模式：grade=按客户等级(低) / customer=按采购商(中) / customer_product=指定采购商及商品(高) */
export type StrategyMode = 'grade' | 'customer' | 'customer_product';

export interface PriceStrategy {
  id: string;
  name: string;
  mode: StrategyMode;
  priority: number;
  grades: string[];                          // mode=grade：客户等级（A/B/C/vip）
  customers: { code: string; name: string }[]; // mode=customer / customer_product
  items: StrategyItem[];                     // 商品级规则（行级覆盖表头规则）
  rule: PriceRule;                           // 表头默认计价规则
  effectiveStart?: string;                   // 'YYYY-MM-DD HH:mm:ss'
  effectiveEnd?: string;
  enabled: boolean;
  applyScope: 'all' | 'supplier' | 'purchaser'; // 适用端
  remark?: string;
  creator?: string; createdAt?: string;
  modifier?: string; updatedAt?: string;
}

export interface PriceRoundSettings { rounding: 'none' | 'int' | 'd1' | 'd2'; floorCost: boolean; }

export const STRATEGY_MODE_RANK: Record<StrategyMode, number> = { grade: 1, customer: 2, customer_product: 3 };
export const STRATEGY_MODE_LABEL: Record<StrategyMode, string> = { grade: '按客户等级', customer: '按采购商', customer_product: '指定采购商及商品' };
export const PRICE_MODE_LABEL: Record<PriceMode, string> = {
  fixed: '固定价', cost_add: '成本价+', cost_sub: '成本价-', sale_add: '基础售价+', sale_sub: '基础售价-', discount: '基础售价×%',
};

export const strategyKey = (owner: string) => `price_strategy_${owner}`;
export const strategySettingsKey = (owner: string) => `price_strategy_settings_${owner}`;

export function loadStrategies(owner: string): PriceStrategy[] {
  try {
    const l = JSON.parse(localStorage.getItem(strategyKey(owner)) || '[]');
    return Array.isArray(l) ? l : [];
  } catch { return []; }
}

export function saveStrategies(owner: string, list: PriceStrategy[]): void {
  try {
    localStorage.setItem(strategyKey(owner), JSON.stringify(list));
    saveDataset(strategyKey(owner), JSON.stringify(list));
  } catch { /* ignore */ }
}

export function loadRoundSettings(owner: string): PriceRoundSettings {
  try {
    const s = JSON.parse(localStorage.getItem(strategySettingsKey(owner)) || 'null');
    if (s && typeof s === 'object') return { rounding: s.rounding || 'd2', floorCost: Boolean(s.floorCost) };
  } catch { /* ignore */ }
  return { rounding: 'd2', floorCost: false };
}

export function saveRoundSettings(owner: string, s: PriceRoundSettings): void {
  try {
    localStorage.setItem(strategySettingsKey(owner), JSON.stringify(s));
    saveDataset(strategySettingsKey(owner), JSON.stringify(s));
  } catch { /* ignore */ }
}

const fmtNum = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};

/** 规则文案：固定¥28 / 成本价+2 / 基础售价-3 / 基础售价×95% */
export function ruleText(r?: PriceRule | null): string {
  if (!r) return '';
  if (r.mode === 'fixed') return `固定¥${fmtNum(Number(r.value) || 0)}`;
  if (r.mode === 'discount') return `基础售价×${fmtNum(Number(r.value) || 0)}%`;
  const base = r.mode.startsWith('cost') ? '成本价' : '基础售价';
  const sign = r.mode.endsWith('add') ? '+' : '-';
  return `${base}${sign}${fmtNum(Number(r.value) || 0)}`;
}

/** 策略状态：停用 / 未开始 / 已过期 / 生效中 */
export function strategyStatus(s: PriceStrategy, nowMs: number = Date.now()): '停用' | '未开始' | '已过期' | '生效中' {
  if (!s.enabled) return '停用';
  const st = s.effectiveStart ? new Date(s.effectiveStart.replace(/-/g, '/')).getTime() : 0;
  const en = s.effectiveEnd ? new Date(s.effectiveEnd.replace(/-/g, '/')).getTime() : Infinity;
  if (st && nowMs < st) return '未开始';
  if (nowMs > en) return '已过期';
  return '生效中';
}

export function isStrategyActive(s: PriceStrategy, nowMs: number = Date.now()): boolean {
  return strategyStatus(s, nowMs) === '生效中';
}

/** 按规则与商品档案价计算原始价（未取整） */
export function computeRulePrice(rule: PriceRule, product: any): number {
  const cost = Number(product?.costPrice) || 0;
  const sale = Number(product?.suggestedPrice ?? product?.basePrice) || 0;
  const v = Number(rule?.value) || 0;
  switch (rule?.mode) {
    case 'fixed': return v;
    case 'cost_add': return cost + v;
    case 'cost_sub': return cost - v;
    case 'sale_add': return sale + v;
    case 'sale_sub': return sale - v;
    case 'discount': return sale * v / 100;
    default: return sale;
  }
}

export function roundPrice(p: number, settings: PriceRoundSettings): number {
  let r = p;
  if (settings.rounding === 'int') r = Math.round(p);
  else if (settings.rounding === 'd1') r = Math.round(p * 10) / 10;
  else if (settings.rounding === 'd2') r = Math.round(p * 100) / 100;
  return Math.max(0, Math.round(r * 100) / 100);
}

export interface CustomerRef { code: string; name: string; grade: string; }

/** 订单/展示侧按客户名称反查客户编码与等级（直接客户档案 → 绑定采购商记录 → 名称兜底） */
export function resolveCustomerRef(owner: string, customerName: string): CustomerRef {
  const name = String(customerName || '').trim();
  if (!name) return { code: '', name: '', grade: '' };
  try {
    const customers: any[] = JSON.parse(localStorage.getItem(`customers_${owner}`) || '[]');
    const hit = (Array.isArray(customers) ? customers : []).find((c: any) => (c.name || '').trim() === name);
    if (hit) return { code: hit.id || '', name, grade: hit.level || '' };
  } catch { /* ignore */ }
  try {
    const uname = localStorage.getItem('username') || '';
    const bound: any[] = JSON.parse(localStorage.getItem(`boundPurchasers_${uname}`) || '[]');
    const bp = (Array.isArray(bound) ? bound : []).find((b: any) => (b.name || '').trim() === name || (b.companyName || '').trim() === name);
    if (bp) return { code: bp.customerId || bp.id || '', name, grade: bp.level || '' };
  } catch { /* ignore */ }
  return { code: '', name, grade: '' };
}

function matchTarget(s: PriceStrategy, ref: CustomerRef, productCode: string): boolean {
  if (s.mode === 'grade') return Boolean(ref.grade) && (s.grades || []).includes(ref.grade);
  const custHit = (s.customers || []).some(c => (ref.code && c.code === ref.code) || (ref.name && c.name === ref.name));
  if (!custHit) return false;
  if (s.mode === 'customer') return true;
  return (s.items || []).some(i => i.productCode === productCode);
}

export interface ResolveHit { price: number; strategy: PriceStrategy; rule: PriceRule; }

/** 解析客户+商品的策略价；无命中返回 null（调用方回退默认价） */
export function resolveCustomerPrice(
  owner: string,
  ref: CustomerRef,
  productCode: string,
  product: any,
  scope: 'supplier' | 'purchaser',
  nowMs: number = Date.now(),
): ResolveHit | null {
  const hits = loadStrategies(owner).filter(s =>
    isStrategyActive(s, nowMs) &&
    (s.applyScope === 'all' || s.applyScope === scope) &&
    matchTarget(s, ref, productCode));
  if (!hits.length) return null;
  // 排序：按客户等级规则恒为最低优先级（仅无采购商/指定商品规则命中时生效）→ priority 升序 → 模式高低 → 更新时间新者
  hits.sort((a, b) =>
    (a.mode === 'grade' ? 1 : 0) - (b.mode === 'grade' ? 1 : 0) ||
    (Number(a.priority) || 0) - (Number(b.priority) || 0) ||
    STRATEGY_MODE_RANK[b.mode] - STRATEGY_MODE_RANK[a.mode] ||
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const s = hits[0];
  const rule = (s.items || []).find(i => i.productCode === productCode)?.rule || s.rule;
  const settings = loadRoundSettings(owner);
  let price = roundPrice(computeRulePrice(rule, product), settings);
  if (settings.floorCost) {
    const cost = Number(product?.costPrice) || 0;
    if (price < cost) price = roundPrice(cost, settings);
  }
  return { price, strategy: s, rule };
}

/** 保存前冲突检测：同优先级且目标相交的其他生效策略（返回名称清单供告警） */
export function findConflicts(owner: string, draft: PriceStrategy): string[] {
  const out: string[] = [];
  const codes = new Set((draft.customers || []).map(c => c.code));
  const names = new Set((draft.customers || []).map(c => c.name));
  const itemCodes = new Set((draft.items || []).map(i => i.productCode));
  loadStrategies(owner).forEach(s => {
    if (s.id === draft.id || !isStrategyActive(s) || (Number(s.priority) || 0) !== (Number(draft.priority) || 0)) return;
    let targetHit = false;
    if (draft.mode === 'grade' || s.mode === 'grade') {
      targetHit = (s.grades || []).some(g => (draft.grades || []).includes(g));
      if (draft.mode !== 'grade' && s.mode !== 'grade') targetHit = false;
    }
    if (!targetHit) {
      targetHit = (s.customers || []).some(c => codes.has(c.code) || names.has(c.name));
    }
    if (!targetHit) return;
    // 商品范围相交：任一方为按采购商(全商品)即相交；否则看商品编码交集
    const productHit = s.mode === 'customer' || draft.mode === 'customer' ||
      (s.items || []).some(i => itemCodes.has(i.productCode));
    if (productHit) out.push(s.name);
  });
  return out;
}
