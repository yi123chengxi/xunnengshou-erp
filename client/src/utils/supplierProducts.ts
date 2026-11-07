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

export const supplierProductKey = (owner: string): string => `pageData_basic-data_product-list_${owner}`;

/** 按公司名解析供应商注册账号 username（读取供应商自有数据的钥匙） */
export const resolveSupplierUsernameByName = (name: string): string => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.companyName === name);
    if (u?.username) return String(u.username);
  } catch { /* ignore */ }
  return '';
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

/** 全量产品列表：本地优先，缺失时服务端兜底拉取（跨浏览器） */
export const loadSupplierProducts = async (owner: string): Promise<any[]> => {
  if (!owner) return [];
  const local = loadLocalSupplierProducts(owner);
  if (local.length > 0) return local;
  try {
    const rec = await fetchServerDataset(supplierProductKey(owner));
    if (rec && rec.json) {
      const list = JSON.parse(rec.json);
      if (Array.isArray(list)) return list;
    }
  } catch { /* ignore */ }
  return [];
};

/** 成品列表：本地优先，缺失时服务端兜底拉取（跨浏览器） */
export const loadSupplierFinishedProducts = async (owner: string): Promise<any[]> =>
  filterFinishedProducts(await loadSupplierProducts(owner));
