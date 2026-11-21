/**
 * 显式删除申报登记表（「永不缩水键」防擦除不变量的客户端半边）。
 *
 * 服务端对账单/订单/合作镜像这类关键键只做「incoming 并集 + 仅按申报 removedIds 删除」，
 * 绝不整键替换——于是任何「本地副本少了某一行」的意外（陈旧镜像覆盖、同源去重、自愈重建）
 * 都会在服务端被并集保留，物理杜绝误擦除。代价是：合法的行移除必须显式申报，
 * 否则被删的行会被服务端并集复活（表现为删除后刷新又出现）。
 *
 * 因此约定：所有会减少行数的写操作，都必须在写 localStorage 之前调用 declareShrink(key, ids)。
 * 本模块独立于 serverSync：cooperationDedupe / cooperationReconcile 等自愈模块需要引用它，
 * 而 serverSync 已经 import 这些模块，直接从 serverSync 反向 import 会形成循环依赖。
 *
 * 申报分两层：
 * 1) 内存一次性申报（pendingRemovedIds）——随下一次上传消费，保持既有语义不变；
 * 2) 持久删除墓碑（localStorage）——刷新/关页面不丢，供所有「把行并回来」的路径判定
 *    某行是本端主动删除的陈旧残留而非意外丢失：拉取落地、查询回源并集、挂载时主存采纳、
 *    防旧覆盖合并、错桶归并。没有这一层时，删除一旦上传成功（申报被消费），任何一份
 *    仍含该行的陈旧副本都能把它永久复活（银行账户删除后复活的根因）。
 * 墓碑只压制「并回」，绝不压制本地真实存在的行：某行重新出现在待写入/待上传清单里时
 * 即刻作废其墓碑（见 pruneTombstonesByRows），因此重建同号数据不受影响。
 */
const pendingRemovedIds = new Map<string, string[]>();

// ============ 持久删除墓碑 ============
const TOMB_KEY = 'shrink_tombstones_v1';
/** 墓碑保留时长：足够跨过一次「另一端陈旧副本稍后上传」的窗口，又不至于永久锁死同号重建 */
const TOMB_TTL_MS = 7 * 24 * 3600 * 1000;
/** 单键墓碑上限（超出丢弃最旧，防止 localStorage 无限增长） */
const TOMB_MAX_PER_KEY = 300;
/** 墓碑键数上限 */
const TOMB_MAX_KEYS = 60;

type TombPayload = Record<string, Record<string, number>>;

const hasLS = (): boolean => {
  try { return typeof localStorage !== 'undefined' && !!localStorage; } catch { return false; }
};

function readTombs(): TombPayload {
  if (!hasLS()) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(TOMB_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as TombPayload : {};
  } catch { return {}; }
}

function writeTombs(tombs: TombPayload): void {
  if (!hasLS()) return;
  try {
    // 体积护栏：键数超限时先剔除整键最旧的；单键 id 超限时剔除时刻最旧的
    const keys = Object.keys(tombs);
    if (keys.length > TOMB_MAX_KEYS) {
      const latestOf = (k: string): number => Object.values(tombs[k] || {}).reduce((m, t) => Math.max(m, Number(t) || 0), 0);
      keys.sort((a, b) => latestOf(a) - latestOf(b)).slice(0, keys.length - TOMB_MAX_KEYS)
        .forEach(k => { delete tombs[k]; });
    }
    Object.keys(tombs).forEach(k => {
      const ids = Object.keys(tombs[k] || {});
      if (ids.length <= TOMB_MAX_PER_KEY) return;
      ids.sort((a, b) => (Number(tombs[k][a]) || 0) - (Number(tombs[k][b]) || 0))
        .slice(0, ids.length - TOMB_MAX_PER_KEY).forEach(id => { delete tombs[k][id]; });
    });
    localStorage.setItem(TOMB_KEY, JSON.stringify(tombs));
  } catch { /* 配额不足：墓碑是增强项，写不进只退化为「一次性申报」语义，不影响正确性 */ }
}

/** 登记某键本次被合法移除的行 id（须在写存储前调用） */
export function declareShrink(key: string, removedIds: string[]): void {
  if (!removedIds || removedIds.length === 0) return;
  const prev = pendingRemovedIds.get(key) || [];
  pendingRemovedIds.set(key, Array.from(new Set([...prev, ...removedIds])));
  recordTombstones(key, removedIds);
}

/** 写持久删除墓碑（declareShrink 已包含本动作；仅在需要单独补记时直接调用） */
export function recordTombstones(key: string, removedIds: string[]): void {
  if (!key || !removedIds || removedIds.length === 0 || !hasLS()) return;
  const tombs = readTombs();
  const cur = tombs[key] && typeof tombs[key] === 'object' ? tombs[key] : {};
  const at = Date.now();
  removedIds.forEach((raw) => {
    const id = String(raw || '');
    if (id) cur[id] = at;
  });
  tombs[key] = cur;
  writeTombs(tombs);
}

/** 某键当前仍然有效的墓碑 id（过期即失效） */
export function tombstoneIds(key: string): string[] {
  const tombs = readTombs();
  const map = tombs[key];
  if (!map || typeof map !== 'object') return [];
  const now = Date.now();
  const alive = Object.keys(map).filter(id => now - (Number(map[id]) || 0) <= TOMB_TTL_MS);
  if (alive.length !== Object.keys(map).length) {
    // 就地剪枝，避免过期墓碑长期占位
    const next: Record<string, number> = {};
    alive.forEach((id) => { next[id] = Number(map[id]) || 0; });
    tombs[key] = next;
    writeTombs(tombs);
  }
  return alive;
}

/**
 * 某键「已被本端删除」的 id 全集：未消费的一次性申报 + 有效墓碑。
 * 所有会把缺失行并回来的路径（拉取落地、查询回源、主存采纳、防旧覆盖、错桶归并）都用它判定。
 */
export function removedIdsFor(key: string): string[] {
  const pending = pendingRemovedIds.get(key) || [];
  return Array.from(new Set([...pending, ...tombstoneIds(key)]));
}

/**
 * removedIdsFor 的集合形态：逐行判定时先取一次集合再复用，
 * 避免每行都重新读 localStorage 并解析墓碑（订单/账单等千行清单上是主要开销）。
 */
export function removedIdSet(key: string): Set<string> {
  return new Set(removedIdsFor(key));
}

/** 行的主键身份（与服务端 idOf = key || id 同构） */
export const rowPrimaryId = (row: any): string => String(row?.key || row?.id || '');

/** 行身份：key 与 id 都参与（与删除申报/服务端合并口径一致） */
export const rowIdentities = (row: any): string[] =>
  Array.from(new Set([String(row?.key || ''), String(row?.id || '')].filter(Boolean)));

/**
 * 该行是否已被本端删除（命中申报/墓碑）。
 * 匹配只用行的主键（key 优先，与服务端 idOf = key || id 同构）：
 * 银行账户等行的 id 是用户填写的账户编号，按副身份匹配会误伤同号的不同账户。
 */
export function isRowRemoved(key: string, row: any, set?: Set<string>): boolean {
  const primary = rowPrimaryId(row);
  if (!primary) return false;
  return (set || removedIdSet(key)).has(primary);
}

/**
 * 作废重新出现在本地清单里的行墓碑（合法重建/他端已恢复）：
 * 墓碑只用于压制「陈旧副本把已删行并回来」，不得压制真实存在的行。
 */
export function pruneTombstonesByRows(key: string, rows: any[]): void {
  if (!key || !hasLS()) return;
  const tombs = readTombs();
  const map = tombs[key];
  if (!map || typeof map !== 'object') return;
  const present = new Set<string>();
  (rows || []).forEach((r) => {
    // 行重新出现时，它的主键与副身份都不应再当作已删除（旧副本可能缺 key，只有 id）
    rowIdentities(r).forEach((id) => present.add(id));
    const p = rowPrimaryId(r);
    if (p) present.add(p);
  });
  let changed = false;
  Object.keys(map).forEach((id) => {
    if (present.has(id)) { delete map[id]; changed = true; }
  });
  if (changed) {
    if (Object.keys(map).length === 0) delete tombs[key]; else tombs[key] = map;
    writeTombs(tombs);
  }
}

/** 取出并清空某键的申报（上传时调用，保证一次申报只随一次上传消费） */
export function takeRemovedIds(key: string): string[] | undefined {
  const ids = pendingRemovedIds.get(key);
  if (!ids || ids.length === 0) return undefined;
  pendingRemovedIds.delete(key);
  return ids;
}

/** 只读查看某键的申报（入持久化上传队列时拍快照，不消费） */
export function peekRemovedIds(key: string): string[] | undefined {
  const ids = pendingRemovedIds.get(key);
  return ids && ids.length > 0 ? ids.slice() : undefined;
}
