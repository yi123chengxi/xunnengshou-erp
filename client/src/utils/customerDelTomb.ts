/**
 * 客户删除墓碑（customer_del_tomb_<owner>）：
 * 供应商端删除绑定采购商客户后，loadBoundPurchasersFromStorage 的两条派生兜底
 * （已批准合作申请 / 采购商侧供应商目录反向扫描）会按合作痕迹把已删行补回并回写真表，
 * 表现为「删除客户会复活」。墓碑登记被删主体凭证 + 删除时间戳：
 * - 派生兜底补行前查墓碑，命中活跃墓碑即跳过；
 * - 加载时 prune 掉他端派生复活回流的 bound 行，回写经钩子申报 removedKeys 跨端收敛；
 * - 删除后若建立更新的合作（来源时间戳 > deletedAt）墓碑自动让位，不阻断重新合作。
 * 键参与全局同步（serverSync SYNC_PREFIXES），服务端恒走记录级并集（MERGE_ALWAYS_PREFIXES），
 * 陈旧端整键上传不会抹掉新墓碑；归属为严格私有（syncGuard STRICT_PRIVATE_PREFIXES）。
 */
import { safeSetItem } from './storageQuota';
import { saveDataset } from './dataStore';
import { noFromUsername, uniqueCompanyRootByName } from './cooperationCred';

export interface CustomerDelTomb {
  id: string;
  username: string;
  no: string;
  name: string;
  deletedAt: number;
}

/** 名称歧义表与账号→编号表（与 CustomerInfo partyCtx 同口径，一次构建复用） */
export interface TombPartyCtx { ambiguous?: Set<string>; noByUn?: Map<string, string> }

/** 待判定主体行（bound 行 / 合作申请 / 采购商目录条目统一字段口径） */
export interface TombPartyRow { purchaserUsername?: string; purchaserNo?: string; purchaserName?: string }

export const customerDelTombKey = (owner: string): string => `customer_del_tomb_${owner}`;

export function loadCustomerDelTombs(owner: string): CustomerDelTomb[] {
  try {
    const raw = localStorage.getItem(customerDelTombKey(owner));
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((t: any) => t && typeof t === 'object' && Number(t.deletedAt) > 0);
  } catch { return []; }
}

/**
 * 登记删除墓碑：同一主体（账号/编号等值）已有墓碑时刷新 deletedAt，
 * 保证「删除→重新合作→再删除」后墓碑时间戳晚于中间那次合作，不会失效。
 * 写入走 safeSetItem + _ts + saveDataset，setItem 钩子负责防抖上传。
 */
export function appendCustomerDelTomb(owner: string, party: { username?: string; no?: string; name?: string }): void {
  const username = String(party.username || '').trim();
  const no = String(party.no || '').trim();
  const name = String(party.name || '').trim();
  if (!username && !no && !name) return;
  const tombs = loadCustomerDelTombs(owner);
  const now = Date.now();
  const hit = tombs.find(t => (username && t.username === username) || (no && t.no === no));
  if (hit) {
    hit.deletedAt = now;
    hit.username = username || hit.username;
    hit.no = no || hit.no;
    hit.name = name || hit.name;
  } else {
    tombs.push({ id: `cdt-${now}-${Math.random().toString(36).slice(2, 6)}`, username, no, name, deletedAt: now });
  }
  const key = customerDelTombKey(owner);
  const json = JSON.stringify(tombs);
  safeSetItem(key, json);
  safeSetItem(`${key}_ts`, String(now));
  saveDataset(key, json);
}

/**
 * 墓碑 ↔ 主体行同一判定：账号等值 > 公司编号等值 > 名称全等且全库唯一主体命中
 * （与 CustomerInfo samePurchaserParty 同口径：同名两家公司时名称档不认，防连带误杀）。
 */
export function tombMatchesParty(t: CustomerDelTomb, row: TombPartyRow, ctx?: TombPartyCtx): boolean {
  const noOfUn = (un: string) => (ctx?.noByUn ? (ctx.noByUn.get(un) || '') : noFromUsername(un));
  const ru = String(row?.purchaserUsername || '').trim();
  const tu = String(t?.username || '').trim();
  if (ru && tu && ru === tu) return true;
  const rn = String(row?.purchaserNo || '').trim() || noOfUn(ru);
  const tn = String(t?.no || '').trim() || noOfUn(tu);
  if (rn && tn) return rn === tn;
  if (ru && tu) return false;
  const nm = String(t?.name || '').trim();
  const rnm = String(row?.purchaserName || '').trim();
  if (!nm || nm !== rnm) return false;
  return ctx?.ambiguous ? !ctx.ambiguous.has(nm) : !!uniqueCompanyRootByName(nm);
}

/**
 * 活跃墓碑判定：命中主体且来源时间戳不晚于删除时间。
 * 来源时间戳缺失（0/NaN）按历史痕迹处理（活跃）；晚于 deletedAt 视为删除后重新建立的合作，墓碑让位。
 */
export function tombActiveForParty(tombs: CustomerDelTomb[], row: TombPartyRow, sourceDateMs: number | undefined, ctx?: TombPartyCtx): boolean {
  if (!tombs.length) return false;
  const ms = Number(sourceDateMs) || 0;
  return tombs.some(t => tombMatchesParty(t, row, ctx) && (!ms || ms <= t.deletedAt));
}

/** 本地日历日（YYYYMMDD 数值）：bindDate 只到日，与删除时刻比对同日须按本地时区归一 */
const localDay = (ms: number): number => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/**
 * 加载期剪枝：剔除被活跃墓碑命中的 bound 行（他端派生复活回流），
 * removedKeys 含 key 与 id 两列（服务端真表按 key||id 匹配），回写后由 doPush 差集申报删除。
 * 来源时刻取 bindDate 与 statusTs 的较晚者：重新合作写点会刷新 statusTs（毫秒级），
 * 而 bindDate 只到日——同日「先删除后重新合作」时单看 bindDate 会把新绑定误剪。
 * 无 statusTs 且 bindDate 与删除同日、状态为已合作的行同样让位（派生复活回流行不带 statusTs，
 * 且因删除前置守卫要求已解除合作，其状态必为已解除/终止中）。
 */
export function pruneTombstonedBound(bound: any[], tombs: CustomerDelTomb[], ctx?: TombPartyCtx): { list: any[]; removedKeys: string[] } {
  if (!tombs.length) return { list: bound, removedKeys: [] };
  const removedKeys: string[] = [];
  const list = (Array.isArray(bound) ? bound : []).filter((bp: any) => {
    const hits = tombs.filter(t => tombMatchesParty(t, bp, ctx));
    if (hits.length === 0) return true;
    const bindMs = Date.parse(String(bp?.bindDate || '').replace(/-/g, '/')) || 0;
    const statusTs = Number(bp?.statusTs) || 0;
    const ms = Math.max(bindMs, statusTs);
    const sameDayRecoop = !statusTs && bindMs > 0 && bp?.status === 'approved';
    const active = hits.some(t => (!ms || ms <= t.deletedAt) && !(sameDayRecoop && localDay(bindMs) === localDay(t.deletedAt)));
    if (!active) return true;
    removedKeys.push(String(bp?.key || ''), String(bp?.id || ''));
    return false;
  });
  return { list, removedKeys: removedKeys.filter(Boolean) };
}