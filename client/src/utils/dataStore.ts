/**
 * IndexedDB 数据集存储工具
 * localStorage 仅有约 5MB 容量，大批量数据（如导入数万条产品）写入会配额溢出而静默失败，
 * 刷新后数据丢失。IndexedDB 容量充足，作为可信存储；localStorage 仅作容量允许时的缓存，
 * 并以 `${key}_ts` 时间戳协调两份存储的新旧。
 */
import { canCacheDataset, tryCacheDataset } from './storageQuota';
const DB_NAME = 'factory_erp_data';
const STORE = 'datasets';

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export interface DatasetRecord {
  json: string;
  updatedAt: number;
}

/** 写入数据集（异步、容错） */
export const saveDataset = (key: string, json: string): void => {
  openDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put({ json, updatedAt: Date.now() }, key);
    } catch { /* ignore */ }
  });
};

/** 读取数据集（不存在或失败时返回 null） */
export const loadDataset = (key: string): Promise<DatasetRecord | null> => new Promise((resolve) => {
  openDb().then((db) => {
    if (!db) { resolve(null); return; }
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const r = req.result;
        resolve(r && typeof r.json === 'string' ? { json: r.json, updatedAt: Number(r.updatedAt) || 0 } : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
});

/**
 * 列出 IndexedDB 中全部数据集键。
 * 主存迁移后大表可能已不在 localStorage，首次上传服务端（迁移）必须以此为准。
 */
export const listDatasetKeys = (): Promise<string[]> => new Promise((resolve) => {
  openDb().then((db) => {
    if (!db) { resolve([]); return; }
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result || []).map(String));
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
});

/* ---------------- 产品列表共享读写助手 ---------------- */

export const productListKey = (owner: string) => `pageData_basic-data_product-list_${owner}`;

// 会话级内存缓存：避免渲染期间反复 JSON.parse 大块数据，同时让 localStorage 装不下的大数据也能被同步读取
let memProductList: { owner: string; list: Record<string, any>[] } | null = null;

export const setMemProductList = (owner: string, list: Record<string, any>[]): void => {
  memProductList = { owner, list };
};

/** 同步读取产品列表：优先会话缓存，否则 localStorage */
export const readProductListSync = (owner: string): Record<string, any>[] => {
  if (memProductList && memProductList.owner === owner) return memProductList.list;
  let list: Record<string, any>[] = [];
  try { list = JSON.parse(localStorage.getItem(productListKey(owner)) || '[]'); } catch { /* ignore */ }
  memProductList = { owner, list };
  return list;
};

/** 异步读取最新产品列表：localStorage 与 IndexedDB 按时间戳取较新者，并回填会话缓存 */
export const loadProductListLatest = async (owner: string): Promise<Record<string, any>[]> => {
  const key = productListKey(owner);
  let lsList: Record<string, any>[] = [];
  let lsTs = 0;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      lsTs = Number(localStorage.getItem(`${key}_ts`) || 0) || 1;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) lsList = parsed;
    }
  } catch { /* ignore */ }
  let chosen = lsList;
  try {
    const idb = await loadDataset(key);
    if (idb && idb.updatedAt > lsTs) {
      const parsed = JSON.parse(idb.json);
      if (Array.isArray(parsed) && parsed.length > 0) chosen = parsed;
    }
  } catch { /* ignore */ }
  memProductList = { owner, list: chosen };
  return chosen;
};

/** 写入产品列表：IndexedDB 可信存储；localStorage 仅在缓存预算允许时作缓存 */
export const writeProductList = (owner: string, list: Record<string, any>[]): void => {
  const key = productListKey(owner);
  memProductList = { owner, list };
  try {
    const json = JSON.stringify(list);
    saveDataset(key, json);
    if (canCacheDataset(key, json.length)) {
      tryCacheDataset(key, json);
      tryCacheDataset(`${key}_ts`, String(Date.now()));
    }
  } catch { /* ignore */ }
};

/**
 * 启动预热：把 IndexedDB 里的商品清单回灌到会话内存缓存。
 * 本地缓存被预算淘汰后，仪表盘/价格策略等页面的同步读取（readProductListSync）才有数据可用。
 */
export const hydrateProductListCache = async (owner: string): Promise<number> => {
  if (!owner) return 0;
  if (memProductList && memProductList.owner === owner && memProductList.list.length > 0) return memProductList.list.length;
  try {
    const idb = await loadDataset(productListKey(owner));
    if (!idb || !idb.json) return 0;
    const parsed = JSON.parse(idb.json);
    if (Array.isArray(parsed) && parsed.length > 0) {
      memProductList = { owner, list: parsed };
      return parsed.length;
    }
  } catch { /* ignore */ }
  return 0;
};
