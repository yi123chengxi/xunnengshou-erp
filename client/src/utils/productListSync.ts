/**
 * 商品清单（基础数据）「服务端为主、本地只放缓存」的提交与对账通道。
 *
 * 口径（用户明确要求）：
 * - 服务端数据库是商品清单的唯一权威源，IndexedDB 是本机可信兜底副本，localStorage 只是首屏缓存；
 * - 导入/新增当场立即上传服务端并等待确认，界面提示以「服务端是否已落库」为准；
 * - 上传没赶上（刷新、关页面、断网）时不丢：flushDatasetUploadAsync 每次都先把本次写入
 *   登记进 IndexedDB 待上传队列，联网/切回前台/30 秒轮询会自动补传直到服务端确认。
 *
 * 为什么单独成模块：ModuleChildPage 的通用持久化 effect 与商品清单各写入点都要走同一套
 * 「落地 → 立即上传 → 失败留队列」语义，且不能与 serverSync 形成循环依赖。
 */
import { productListKey, saveDataset, loadDataset, readFreshDataset, adoptProductList, setMemProductList } from './dataStore';
import { cacheDataset } from './storageQuota';
import { flushDatasetUploadAsync, fetchServerDataset, serverAvailable, noteServerVersion } from './serverSync';

export interface ProductListCommit {
  /** 本次落地的行数 */
  rows: number;
  /** 实际写入主存/服务端的序列化内容（与通用持久化 effect 同口径） */
  json: string;
  /** 序列化后的字节数（字符数，用于提示体积） */
  bytes: number;
  /** 是否成功写进 localStorage 缓存（大表放不下时为 false，属正常降级） */
  cached: boolean;
  /** 服务端是否已确认落库 */
  uploaded: boolean;
}

/**
 * 主存/服务端只存清单本体：base64 大图按既有口径剥离（图片走图片空间云端地址）。
 * 单独导出是为了让页面能算出与通用持久化 effect 完全一致的那份 json，
 * 提交后据此跳过 effect 的重复整键上传。
 */
export function buildStoredProductListJson(list: Record<string, any>[]): string {
  try { return JSON.stringify(stripStoredImages(Array.isArray(list) ? list : [])); } catch { return '[]'; }
}

const stripStoredImages = (list: Record<string, any>[]): Record<string, any>[] =>
  list.map((item: any) => {
    if (item && typeof item.image === 'string' && item.image.startsWith('data:') && item.key) {
      const { image: _img, ...rest } = item;
      return rest;
    }
    return item;
  });

const countRows = (json: string | null | undefined): number => {
  if (!json || json === '[]') return 0;
  try { const parsed = JSON.parse(json); return Array.isArray(parsed) ? parsed.length : 0; } catch { return 0; }
};

/**
 * 立即上传并在失败时退避重试（最多 3 次）。
 * 每次都失败也不算丢数据：待上传队列里仍持有这份最新值，由后台补传链路继续送。
 */
export async function uploadDatasetNow(key: string, json: string, attempts = 3): Promise<boolean> {
  const delays = [800, 2500];
  for (let i = 0; i < attempts; i++) {
    try {
      if (await flushDatasetUploadAsync(key, json)) return true;
    } catch { /* 网络异常按失败处理，继续重试 */ }
    if (i < attempts - 1) await new Promise<void>((r) => setTimeout(r, delays[i] || 3000));
  }
  return false;
}

/**
 * 商品清单权威提交：先落本机（IndexedDB 主存 + 尽力缓存 + 会话内存缓存），再立即上传服务端。
 * 缓存放不下时会删除该键的陈旧副本，避免刷新后页面直读 localStorage 拿到旧清单并回写覆盖。
 */
export async function commitProductList(owner: string, list: Record<string, any>[]): Promise<ProductListCommit> {
  const key = productListKey(owner);
  const rows = Array.isArray(list) ? list.length : 0;
  const json = buildStoredProductListJson(list);
  // 1) 本机可信副本：IndexedDB 容量充足，不受 localStorage 5MB 限制
  saveDataset(key, json);
  // 2) 会话内存缓存：仪表盘/价格策略等同步读取走这份，避免读到被缓存预算淘汰的空清单
  try { setMemProductList(owner, list || []); } catch { /* ignore */ }
  // 3) localStorage 尽力缓存（写入钩子会顺带刷新 ${key}_ts）
  const cached = cacheDataset(key, json);
  // 4) 立即上传并等待服务端确认（失败留在待上传队列后台补传）
  const uploaded = await uploadDatasetNow(key, json);
  return { rows, json, bytes: json.length, cached, uploaded };
}

export type ProductListReconcile =
  /** 服务端不可用或本地无结论：保持本机数据与页面现状 */
  | { status: 'skip' }
  /** 本机副本比服务端新（上次上传没赶上）：已补传，页面继续用本机数据 */
  | { status: 'uploaded'; rows: number }
  /** 服务端副本更新：已采用为本机权威副本，页面应据此重载 */
  | { status: 'server'; list: Record<string, any>[] };

// 每次页面加载只需对账一次（刷新/新开页面才是丢数据的场景），避免切标签反复整键拉取
const reconciledKeys = new Set<string>();

/** 重置对账标记（切换账号/租户时调用，保证新会话仍会回源一次） */
export function resetProductListReconcile(): void {
  reconciledKeys.clear();
}

// 采纳服务端副本：同时把 baseTs 对齐到刚读到的版本。
// 此后本端的修改是“基于服务端最新版本”的，PUT 才能走整键替换（删除行才不会被并集合并复活）；
// 反之，未采纳服务端副本的补传一律不对齐 baseTs，让服务端走并集保留本端未见过的行。
const adoptServerCopy = (owner: string, key: string, json: string, serverTs: number): Record<string, any>[] => {
  const list = adoptProductList(owner, json, serverTs);
  noteServerVersion(key, serverTs);
  return list;
};

/**
 * 挂载时对账：以版本时间戳在服务端与本机之间裁决谁是最新副本。
 * - 服务端较新 → 采用服务端（用户口径：以服务端数据库为主）；
 * - 本机较新（例如上一次上传没赶上就刷新了）→ 把本机副本补传服务端，页面数据不动；
 * - 服务端还没有这份清单 → 用本机数据建立权威副本（首次迁移/换机后首发）。
 * 两道防线（都是真实丢数据场景）：
 * 1) 服务端副本为空而本机有行时，不用空副本覆盖本机，改为把本机补传
 *    （与 pullAllDatasets 的「拒绝服务端空副本」同一口径）；
 * 2) 服务端只新出少量（多端时钟偏差 / 上传 ack 与服务端时间差）却比本机行数少时，
 *    本机这份很可能是“刚导入但没上传成功”的清单，不能拿旧服务端副本把它擦掉，
 *    改为补传本机；只有服务端明显更新（超过 TRUST_SHRINK_MS）才当作其他端的真实删除。
 */
const SKEW_MS = 60_000;
const TRUST_SHRINK_MS = 5 * 60_000;

export async function reconcileProductListWithServer(owner: string): Promise<ProductListReconcile> {
  if (!owner) return { status: 'skip' };
  const key = productListKey(owner);
  if (reconciledKeys.has(key)) return { status: 'skip' };
  if (!(await serverAvailable())) return { status: 'skip' };
  reconciledKeys.add(key);
  const rec = await fetchServerDataset(key);
  let localJson: string | null = null;
  try { localJson = await readFreshDataset(key); } catch { /* ignore */ }
  let localTs = 0;
  try { localTs = Number(localStorage.getItem(`${key}_ts`) || 0) || 0; } catch { /* ignore */ }
  try {
    const idb = await loadDataset(key);
    if (idb && idb.updatedAt > localTs) localTs = idb.updatedAt;
  } catch { /* ignore */ }
  const localRows = countRows(localJson);
  const pushLocal = async (): Promise<ProductListReconcile> => {
    if (localRows > 0 && localJson) {
      await uploadDatasetNow(key, localJson);
      return { status: 'uploaded', rows: localRows };
    }
    return { status: 'skip' };
  };
  if (!rec) {
    // 服务端尚无这份清单：本机有数据就上传建档，没有就什么都不做
    return pushLocal();
  }
  const serverTs = Number(rec.updatedAt) || 0;
  const serverRows = countRows(rec.json);
  if (serverTs > localTs) {
    if (localRows === 0) return { status: 'server', list: adoptServerCopy(owner, key, rec.json, serverTs) };
    if (serverRows === 0) return pushLocal();
    if (serverRows < localRows && serverTs <= localTs + TRUST_SHRINK_MS) return pushLocal();
    if (serverTs > localTs + SKEW_MS) return { status: 'server', list: adoptServerCopy(owner, key, rec.json, serverTs) };
    return { status: 'skip' };
  }
  if (localTs > serverTs) return pushLocal();
  return { status: 'skip' };
}
