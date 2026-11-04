// 店铺管理「负责人设置」共享契约（查看/编辑权限分离 + 组长联动 + 编辑门控）：
// - 负责人名单存 shopmgr_managers_<owner>（{ username, view, edit } 数组；历史 string[] 兼容为 view/edit 均 true）；
// - 主账号（管理员）始终豁免；名单为空时所有人可见可编辑全部（向后兼容）；
// - 查看权限：可看全部店铺数据；组长（分组统计分组设置）额外可见本组组员的店铺；其余成员仅见自己负责的店铺；
// - 编辑权限：可编辑/删除他人店铺数据；仅查看权限者只能操作自己负责/创建的数据；
// 生效页面：店铺列表、月末盘点、月利润表、提现/充值。
import { safeSetItem } from './storageQuota';
import { getCurrentUserDisplayName } from './billLog';

export interface ShopManagerPerm { username: string; view: boolean; edit: boolean; }

interface OpsGroupDef { id: string; name: string; leader: string; members: string[]; }

const managersKey = (owner: string) => `shopmgr_managers_${owner}`;

export const getCurrentUsername = (): string => localStorage.getItem('username') || '';

export const isShopScopeAdmin = (): boolean => localStorage.getItem('isSubAccount') !== 'true';

// 读取负责人权限（历史 string[] 名单兼容为 view/edit 均 true）
export const loadShopManagerPerms = (owner: string): ShopManagerPerm[] => {
  try {
    const data = JSON.parse(localStorage.getItem(managersKey(owner)) || '[]');
    if (!Array.isArray(data)) return [];
    return data
      .map((d: any) => typeof d === 'string'
        ? { username: d, view: true, edit: true }
        : { username: String((d && d.username) || ''), view: !!(d && d.view), edit: !!(d && d.edit) })
      .filter(p => p.username);
  } catch { return []; }
};

export const saveShopManagerPerms = (owner: string, perms: ShopManagerPerm[]) => {
  const key = managersKey(owner);
  const json = JSON.stringify(perms);
  safeSetItem(key, json);
  safeSetItem(`${key}_ts`, String(Date.now()));
};

export const getShopManagerPerm = (owner: string, username: string): ShopManagerPerm | null =>
  loadShopManagerPerms(owner).find(p => p.username === username) || null;

// 查看权限：主账号 / 未设置负责人 / 勾选查看
export const canViewAllShops = (owner: string): boolean => {
  if (isShopScopeAdmin()) return true;
  const perms = loadShopManagerPerms(owner);
  if (perms.length === 0) return true;
  const p = perms.find(x => x.username === getCurrentUsername());
  return !!p && p.view;
};

// 编辑权限：主账号 / 未设置负责人 / 勾选编辑
export const canEditAllShops = (owner: string): boolean => {
  if (isShopScopeAdmin()) return true;
  const perms = loadShopManagerPerms(owner);
  if (perms.length === 0) return true;
  const p = perms.find(x => x.username === getCurrentUsername());
  return !!p && p.edit;
};

// 分组设置（业绩分析-分组统计）：合并多平台存储键
export const loadOpsGroups = (owner: string): OpsGroupDef[] => {
  const keys = ['dev_ops_groups', `supplier_analytics_${owner}_ops_groups`, `purchaser_analytics_${owner}_ops_groups`, `factory_analytics_${owner}_ops_groups`];
  const out: OpsGroupDef[] = [];
  const seen = new Set<string>();
  keys.forEach(k => {
    try {
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      if (Array.isArray(arr)) arr.forEach((g: any) => {
        if (g && g.id && !seen.has(g.id)) {
          seen.add(g.id);
          out.push({ id: g.id, name: g.name || '', leader: g.leader || '', members: Array.isArray(g.members) ? g.members : [] });
        }
      });
    } catch { /* ignore */ }
  });
  return out;
};

// 组长可查看的组员名单
export const getLeaderMemberNames = (owner: string, displayName: string): string[] =>
  loadOpsGroups(owner).filter(g => g.leader === displayName).reduce((a, g) => a.concat(g.members), [] as string[]);

// 当前用户可见店铺（查看权限→全部；否则自己 + 本组组员）
export const scopeShops = <T extends { person?: string }>(owner: string, shops: T[]): T[] => {
  if (canViewAllShops(owner)) return shops;
  const me = getCurrentUserDisplayName();
  const allowed = new Set<string>([me]);
  getLeaderMemberNames(owner, me).forEach(n => allowed.add(n));
  return shops.filter(s => allowed.has((s && s.person) || ''));
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

// 编辑门控：编辑权限→全部；否则仅本人负责/创建的记录
export const canEditShopData = (owner: string, person?: string, creator?: string): boolean => {
  if (canEditAllShops(owner)) return true;
  const me = getCurrentUserDisplayName();
  const username = getCurrentUsername();
  return (!!person && person === me) || (!!creator && (creator === me || creator === username));
};
