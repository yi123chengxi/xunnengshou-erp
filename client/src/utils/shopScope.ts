// 店铺管理「负责人设置」共享契约：
// - 负责人名单存 shopmgr_managers_<owner>（username 数组）；
// - 主账号（管理员）始终豁免；名单为空时所有人可见全部（向后兼容）；名单内负责人可看全部店铺；
// - 其余子账号仅可见 shop.person（显示名）为自己的店铺数据。
// 生效页面：店铺列表、月末盘点、月利润表、提现/充值。
import { safeSetItem } from './storageQuota';
import { getCurrentUserDisplayName } from './billLog';

export const shopManagersKey = (owner: string) => `shopmgr_managers_${owner}`;

export const loadShopManagers = (owner: string): string[] => {
  try {
    const m = JSON.parse(localStorage.getItem(shopManagersKey(owner)) || '[]');
    return Array.isArray(m) ? m : [];
  } catch { return []; }
};

export const saveShopManagers = (owner: string, list: string[]) => {
  const key = shopManagersKey(owner);
  const json = JSON.stringify(list);
  safeSetItem(key, json);
  safeSetItem(`${key}_ts`, String(Date.now()));
};

export const isShopScopeAdmin = (): boolean => localStorage.getItem('isSubAccount') !== 'true';

export const canViewAllShops = (owner: string): boolean => {
  if (isShopScopeAdmin()) return true;
  const mgrs = loadShopManagers(owner);
  if (mgrs.length === 0) return true;
  return mgrs.includes(localStorage.getItem('username') || '');
};

// 当前用户可见店铺（名单外子账号仅看自己负责的店铺）
export const scopeShops = <T extends { person?: string; key?: string; shopName?: string }>(owner: string, shops: T[]): T[] => {
  if (canViewAllShops(owner)) return shops;
  const me = getCurrentUserDisplayName();
  if (!me) return [];
  return shops.filter(s => (s.person || '') === me);
};

// 按可见店铺集合过滤店铺维度业务记录（shopId 优先匹配，缺失时按 shopName 匹配）
export const scopeShopRecords = <T extends { shopId?: string; shopName?: string }>(owner: string, shops: { key: string; shopName: string; person?: string }[], recs: T[]): T[] => {
  if (canViewAllShops(owner)) return recs;
  const visible = scopeShops(owner, shops);
  const ids = new Set(visible.map(s => s.key));
  const names = new Set(visible.map(s => s.shopName));
  return recs.filter(r => {
    if (r.shopId) return ids.has(r.shopId);
    return r.shopName ? names.has(r.shopName) : false;
  });
};
