// IndexedDB 产品原图存储
// localStorage 仅 ~5MB 容量，只存放压缩缩略图（列表小图用）；
// 原图（鼠标停留/点击放大用）存 IndexedDB，容量充裕且无配额溢出风险。

const DB_NAME = 'factory_erp_images';
const STORE = 'full_images';

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (!dbPromise) {
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
  }
  return dbPromise;
};

// 保存原图（key 沿用 localStorage 缩略图键名 prodImg_${owner}_${productKey}）
export const saveFullImage = (key: string, dataUrl: string): void => {
  openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(dataUrl, key); } catch { /* ignore */ }
  });
};

// 获取原图，不存在时返回 null（调用方回退到缩略图）
export const getFullImage = (key: string): Promise<string | null> =>
  new Promise((resolve) => {
    openDb().then((db) => {
      if (!db) { resolve(null); return; }
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(typeof req.result === 'string' ? (req.result as string) : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });

// 删除原图（与 localStorage 缩略图清理配套使用）
export const deleteFullImage = (key: string): void => {
  openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch { /* ignore */ }
  });
};

// 批量删除原图（单次事务，避免大量删除时反复开关事务）
export const batchDeleteFullImages = (keys: string[]): void => {
  if (keys.length === 0) return;
  openDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      keys.forEach(k => store.delete(k));
    } catch { /* ignore */ }
  });
};

// 列出 IndexedDB 中全部原图键（历史图片迁移用：localStorage 缩略图丢失时仍能找回原图）
export const listFullImageKeys = (): Promise<string[]> =>
  new Promise((resolve) => {
    openDb().then((db) => {
      if (!db) { resolve([]); return; }
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result || []).map(String));
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  });

// ============ 旧版共享图片库 prodImages/imgs（BOM/款式设计图，key 直接是货品 key，无账号前缀） ============
const LEGACY_DB = 'prodImages';
const LEGACY_STORE = 'imgs';
let legacyDbPromise: Promise<IDBDatabase | null> | null = null;
const openLegacyDb = (): Promise<IDBDatabase | null> => {
  if (legacyDbPromise) return legacyDbPromise;
  legacyDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(LEGACY_DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(LEGACY_STORE); } catch { /* ignore */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return legacyDbPromise;
};

/** 列出旧共享图片库的全部 key（BOM/款式图历史迁移用） */
export const listLegacyImageKeys = (): Promise<string[]> =>
  new Promise((resolve) => {
    openLegacyDb().then((db) => {
      if (!db) { resolve([]); return; }
      try {
        const req = db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result || []).map(String));
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  });

/** 读取旧共享图片库中的图片（不存在返回空串） */
export const getLegacyImage = (key: string): Promise<string> =>
  new Promise((resolve) => {
    openLegacyDb().then((db) => {
      if (!db) { resolve(''); return; }
      try {
        const req = db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE).get(key);
        req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '');
        req.onerror = () => resolve('');
      } catch { resolve(''); }
    });
  });
