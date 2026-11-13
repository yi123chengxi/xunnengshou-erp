/**
 * 待上传任务持久化队列（断网/关页面/刷新都不丢）
 *
 * 背景：跨端同步原本只在内存里挂 800ms 防抖定时器，一旦离线、超时或页面在这 800ms 内被关掉，
 * 这次保存就彻底消失（本地配额满时更严重：本地没落盘 + 服务端也没收到 = 双重丢失）。
 *
 * 做法：每个业务键的最新待上传内容写进 IndexedDB（按 key 覆盖，只留最新一份），
 * 上传成功才出队；失败留在队列里按退避时间重试，联网/切回前台/定时器都会触发补传。
 */
const DB_NAME = 'factory_erp_sync';
const STORE = 'pending_uploads';
const DB_VERSION = 1;

export interface PendingUpload {
  /** 业务数据键（如 pageData_basic-data_product-list_xxx） */
  key: string;
  /** 最新待上传内容 */
  value: string;
  /** 数据写入时间戳（业务时间，用于服务端乐观并发与出队比对） */
  ts: number;
  /** 本次写入申报的删除行 id（服务端据此允许从「永不缩水键」移除） */
  removedIds?: string[];
  /** 已重试次数 */
  attempt: number;
  /** 下次允许尝试的时间戳 */
  nextAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
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

/** 入队（同键覆盖：只保留最新一次待上传内容） */
export function queuePut(item: PendingUpload): void {
  openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(item); } catch { /* ignore */ }
  });
}

/** 出队：仅当队列里的版本不新于本次已成功上传的版本时才删除（避免删掉更新的一次写入） */
export function queueDelete(key: string, uploadedTs?: number): void {
  openDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const cur = req.result as PendingUpload | undefined;
        if (!cur) return;
        if (uploadedTs !== undefined && cur.ts > uploadedTs) return;
        try { store.delete(key); } catch { /* ignore */ }
      };
    } catch { /* ignore */ }
  });
}

/** 全量待上传任务（按写入时间升序） */
export function queueAll(): Promise<PendingUpload[]> {
  return new Promise((resolve) => {
    openDb().then((db) => {
      if (!db) { resolve([]); return; }
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => {
          const list = (req.result || []) as PendingUpload[];
          resolve(list.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)));
        };
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  });
}

/** 待上传任务数量（开发者诊断/提示用） */
export function queueCount(): Promise<number> {
  return new Promise((resolve) => {
    openDb().then((db) => {
      if (!db) { resolve(0); return; }
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
        req.onsuccess = () => resolve(Number(req.result) || 0);
        req.onerror = () => resolve(0);
      } catch { resolve(0); }
    });
  });
}

/** 清空队列（仅在用户确认丢弃或数据已确认上云后调用） */
export function queueClear(): void {
  openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch { /* ignore */ }
  });
}
