/**
 * 供应商货品列表跨浏览器取数工具
 *
 * 背景：供应商的产品列表存于供应商自己的租户键 pageData_basic-data_product-list_<供应商账号>，
 * 该键为私有键——采购商浏览器只拉取本账号键，跨浏览器时本地读不到供应商数据，
 * 导致「供应商货品」页签/货品列表弹窗/推送校验在生产环境恒为空。
 * 本模块统一口径：本地命中（同浏览器或已镜像同步）直接返回；
 * 本地缺失时经 fetchServerDataset 从服务端数据集按需拉取（服务端 GET /sync/dataset 不限 owner）。
 */
import { fetchServerDataset } from './serverSync';
import { readFreshDataset, saveDatasetAt } from './dataStore';
import { uniqueUserByName, usernameFromNo } from './cooperationCred';

export const supplierProductKey = (owner: string): string => `pageData_basic-data_product-list_${owner}`;

/**
 * 按公司名解析供应商注册账号 username（读取供应商自有数据的钥匙）。
 * 只在全库唯一主体命中时返回：同名两家公司时返回空串，绝不 find-first。
 * 旧写法 users.find(x => x.companyName === name) 在同名多账号时永远取第一个，
 * 导致采购商供应商列表里两条同名卡片读到同一份商品（且可能是另一家公司的商品）。
 */
export const resolveSupplierUsernameByName = (name: string): string => {
  const u = uniqueUserByName(name);
  return u?.username ? String(u.username) : '';
};

/**
 * 按条目凭证解析供应商账号：自带账号 > 公司编号 > 名称唯一命中。
 * 读商品/成品一律走本函数（传整条供应商条目或账单行），不得只传公司名。
 */
export const resolveSupplierOwnerOfEntry = (entry: any): string => {
  const un = String(entry?.supplierUsername || '').trim();
  if (un) return un;
  const no = String(entry?.supplierNo || '').trim();
  if (no) {
    const byNo = usernameFromNo(no);
    if (byNo) return byNo;
  }
  return resolveSupplierUsernameByName(entry?.supplierName);
};

export const filterFinishedProducts = (list: any[]): any[] =>
  (Array.isArray(list) ? list : []).filter((p: any) => p && p.productType === '成品');

/** 仅读本地（同步渲染场景：计数兜底/同浏览器） */
export const loadLocalSupplierProducts = (owner: string): any[] => {
  if (!owner) return [];
  try {
    const list = JSON.parse(localStorage.getItem(supplierProductKey(owner)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const loadLocalSupplierFinished = (owner: string): any[] => filterFinishedProducts(loadLocalSupplierProducts(owner));

/** 全量产品列表：本地优先（localStorage → IndexedDB），缺失时服务端兜底拉取并落地 IDB（跨浏览器） */
export const loadSupplierProducts = async (owner: string): Promise<any[]> => {
  if (!owner) return [];
  const local = loadLocalSupplierProducts(owner);
  if (local.length > 0) return local;
  // 大表常装不进 localStorage（配额预算跳过/淘汰），跨端拉取落地也在 IDB：先快读本地主存
  try {
    const fresh = await readFreshDataset(supplierProductKey(owner));
    if (fresh) {
      const parsed = JSON.parse(fresh);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  try {
    // 数万条商品的大数据集在弱网下常超默认 5s 超时（表现为弹窗加载失败），放宽到 30s；
    // 拉成功后按服务端版本号落地 IDB，下次打开本地快读、离线也可用
    const rec = await fetchServerDataset(supplierProductKey(owner), 30000);
    if (rec && rec.json) {
      const list = JSON.parse(rec.json);
      if (Array.isArray(list)) {
        saveDatasetAt(supplierProductKey(owner), rec.json, rec.updatedAt);
        return list;
      }
    }
  } catch { /* ignore */ }
  return [];
};

/** 成品列表：本地优先，缺失时服务端兜底拉取（跨浏览器） */
export const loadSupplierFinishedProducts = async (owner: string): Promise<any[]> =>
  filterFinishedProducts(await loadSupplierProducts(owner));
