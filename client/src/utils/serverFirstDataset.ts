/**
 * 通用数据集键「服务端为主、本地只读缓存」对账通道（与模具管理 / 商品清单同语义）。
 *
 * 口径（用户明确要求，全基础数据域统一）：
 * - 服务端数据库（dataset_store / MySQL）是唯一权威源；IndexedDB 是本机可信兜底副本，
 *   localStorage 只是首屏缓存；
 * - 挂载时对账：服务端副本更新 → 采纳为本机权威副本（回写 IDB+LS 缓存并对齐 baseTs）；
 *   本机副本更新（上次上传没赶上）→ 补传服务端，页面数据不动；服务端空副本不得擦除本机有行数据；
 * - 服务端不可达 → 返回 offline，调用方提示「当前为离线缓存」，继续用本机副本。
 *
 * 与 productListSync 的关系：商品清单有额外的行数裁决/图片剥离/会话内存缓存等特化逻辑，
 * 保留专用模块；本模块服务其余数组/映射类数据集键（生产工序、子BOM、打印模板、
 * 图片绑定表、模具租售市场等），逻辑为其通用化子集。
 */
import { saveDatasetAt, loadDataset, readFreshDataset } from './dataStore';
import { cacheDataset } from './storageQuota';
import { fetchServerDataset, serverAvailable, noteServerVersion, flushDatasetUploadAsync, isSyncKey, isNeverShrinkKey } from './serverSync';

export type ServerFirstResult =
  /** 服务端不可达：调用方应提示离线缓存并继续用本机副本 */
  | { status: 'offline' }
  /** 无需动作（已对账过 / 两端一致） */
  | { status: 'skip' }
  /** 本机副本较新：已补传服务端，页面数据不动 */
  | { status: 'uploaded' }
  /** 服务端副本更新：已采纳为本机权威副本，页面应据此重载 */
  | { status: 'server'; json: string };

// 每次页面加载只对账一次（刷新/新开页面才是丢数据的场景），避免切标签反复整键拉取
const reconciled = new Set<string>();

/** 重置对账标记（切换账号/租户时调用，保证新会话仍会回源一次） */
export function resetServerFirstReconcile(): void {
  reconciled.clear();
}

/** 行数口径：数组取 length，映射取键数，标量视为 1 行（空值 0 行） */
const countRows = (json: string | null | undefined): number => {
  if (!json) return 0;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length;
    return 1;
  } catch { return 0; }
};

// 多端时钟偏差容忍：服务端仅新出一点点且行数更少时，不信任其删除语义
const SKEW_MS = 60_000;
const TRUST_SHRINK_MS = 5 * 60_000;

/**
 * 挂载时对账：以版本时间戳在服务端与本机之间裁决谁是最新副本。
 * 两道防线（真实丢数据场景）：
 * 1) 服务端副本为空而本机有行 → 不采纳空副本，改为补传本机；
 * 2) 服务端只新出少量却比本机行数少 → 本机很可能是「刚写入但没上传成功」的副本，
 *    补传本机；只有服务端明显更新（超过 TRUST_SHRINK_MS）才当作其他端的真实删除。
 */
export async function reconcileServerFirst(key: string): Promise<ServerFirstResult> {
  if (!key || key.endsWith('_ts') || reconciled.has(key)) return { status: 'skip' };
  if (!(await serverAvailable())) return { status: 'offline' };
  reconciled.add(key);
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
  const pushLocal = async (): Promise<ServerFirstResult> => {
    if (localRows > 0 && localJson) {
      await flushDatasetUploadAsync(key, localJson).catch(() => false);
      return { status: 'uploaded' };
    }
    return { status: 'skip' };
  };
  if (!rec) return pushLocal();
  const serverTs = Number(rec.updatedAt) || 0;
  const serverRows = countRows(rec.json);
  const adopt = (): ServerFirstResult => {
    // 采纳服务端副本：按原版本号落地，baseTs 对齐后本端修改才走整键替换（删除不被并集复活）
    try { saveDatasetAt(key, rec.json, serverTs); } catch { /* ignore */ }
    try { cacheDataset(key, rec.json); } catch { /* ignore */ }
    try { noteServerVersion(key, serverTs); } catch { /* ignore */ }
    return { status: 'server', json: rec.json };
  };
  if (serverTs > localTs) {
    if (localRows === 0) return serverRows > 0 ? adopt() : { status: 'skip' };
    if (serverRows === 0) return pushLocal();
    if (serverRows < localRows && serverTs <= localTs + TRUST_SHRINK_MS) return pushLocal();
    if (serverTs > localTs + SKEW_MS) return adopt();
    return { status: 'skip' };
  }
  if (localTs > serverTs) return pushLocal();
  return { status: 'skip' };
}

/** 权威提交：先落本机（IDB 主存 + 尽力缓存），再立即上传并等待服务端确认 */
export async function commitServerFirst(key: string, json: string): Promise<{ cached: boolean; uploaded: boolean }> {
  try { saveDatasetAt(key, json, Date.now()); } catch { /* ignore */ }
  let cached = false;
  try { cached = cacheDataset(key, json); } catch { /* ignore */ }
  const uploaded = await flushDatasetUploadAsync(key, json).catch(() => false);
  return { cached, uploaded };
}

// 专用通道键：永不缩水键走行级并集语义（整键采纳会破坏删除申报）、追加型全局键/
// 商品清单（自有 reconcile 通道）不参与通用整键对账
// （credit_adjustments_ 已迁 /api/customer/* 权威真表，isSyncKey=false 自动跳过本通道）
const UPLOAD_ONLY_PREFIXES: string[] = [];
const APPEND_ONLY_GLOBAL_KEYS = ['market_trade_orders', 'purchaser_pushed_orders'];

/** 判定某键是否跳过通用服务端为主对账 */
export function shouldSkipServerFirst(key: string): boolean {
  if (!key || key.endsWith('_ts')) return true;
  if (!isSyncKey(key)) return true;
  if (isNeverShrinkKey(key)) return true;
  if (UPLOAD_ONLY_PREFIXES.some(p => key.startsWith(p))) return true;
  if (APPEND_ONLY_GLOBAL_KEYS.includes(key)) return true;
  if (key.startsWith('pageData_basic-data_product-list_')) return true;
  return false;
}

/**
 * 全键对账扫描：枚举本机全部参与同步的数据集键逐个对账（登录后空闲期调用）。
 * 使独立页面（财务/人事/开发者后台/平台页等）无需逐页接线即获得服务端为主语义；
 * 返回采纳服务端副本的键数，调用方据此广播重载事件。
 */
export async function reconcileAllLocalDatasets(onOffline?: () => void): Promise<number> {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !shouldSkipServerFirst(k)) keys.push(k);
    }
  } catch { return 0; }
  let adopted = 0;
  let offlineNoted = false;
  for (const k of keys) {
    const res = await reconcileServerFirst(k);
    if (res.status === 'offline') {
      if (!offlineNoted) { offlineNoted = true; try { onOffline?.(); } catch { /* ignore */ } }
    } else if (res.status === 'server') {
      adopted++;
    }
  }
  return adopted;
}
