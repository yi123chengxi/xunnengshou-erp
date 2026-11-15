/**
 * 写兜底层（write-behind）：MySQL 写入失败（数据库主机磁盘满/锁等待等）时，
 * 数据集写入先落应用服务器本地磁盘（server/data/writebehind/<key>.json）并立即对外服务
 * （登录校验第三源、/sync/dataset 读、/sync/meta 版本表都经 store 门面看到兜底副本），
 * 后台回放任务在 DB 恢复后按 ts 升序写回 MySQL 并删除本地文件。
 *
 * 目的：DB 故障期间建号/登录/跨端同步不再瘫痪——写请求返回成功且数据不丢，
 * 而不是 500 后由各浏览器本地副本各自发散（历史事故：新账号登不上、订单桶分裂）。
 *
 * 约束：单 PM2 实例部署（内存索引与磁盘一致）；多实例部署需先改共享存储。
 * 目录位于 server/data/ 下，server-update.sh 的 rsync --exclude data 保证部署不丢。
 */
import fs from 'fs';
import path from 'path';

export interface WriteBehindEntry {
  key: string;
  json: string;
  owner: string;
  updated_at: number;
  savedAt: number;
  /** 删除兜底：DB 故障期间的 deleteDataset 以墓碑表达，回放时重放删除 */
  tombstone?: boolean;
}

const DIR = path.resolve(__dirname, '../../data/writebehind');

let cache: Map<string, WriteBehindEntry> | null = null;

function ensureLoaded(): Map<string, WriteBehindEntry> {
  if (cache) return cache;
  cache = new Map();
  try {
    fs.mkdirSync(DIR, { recursive: true });
    for (const f of fs.readdirSync(DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as WriteBehindEntry;
        if (e && e.key) cache.set(e.key, e);
      } catch { /* 坏文件跳过，回放不影响其余键 */ }
    }
    if (cache.size > 0) console.warn(`[writeBehind] 已从磁盘加载 ${cache.size} 个兜底数据集（DB 恢复后自动回放）`);
  } catch (err: any) {
    console.error('[writeBehind] 兜底目录初始化失败:', err.message);
  }
  return cache;
}

const safeName = (key: string): string => key.replace(/[^A-Za-z0-9_.-]/g, '_');

/** 原子写：先 tmp 再 rename，避免进程崩溃留下半截文件 */
function writeEntry(e: WriteBehindEntry): void {
  const m = ensureLoaded();
  m.set(e.key, e);
  const file = path.join(DIR, `${safeName(e.key)}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(e), 'utf8');
  fs.renameSync(tmp, file);
}

export function wbPut(key: string, json: string, owner: string, ts: number): void {
  writeEntry({ key, json, owner, updated_at: ts, savedAt: Date.now() });
}

export function wbTombstone(key: string, ts: number): void {
  writeEntry({ key, json: '', owner: '', updated_at: ts, savedAt: Date.now(), tombstone: true });
}

export function wbGet(key: string): WriteBehindEntry | undefined {
  return ensureLoaded().get(key);
}

export function wbAll(): WriteBehindEntry[] {
  return [...ensureLoaded().values()];
}

export function wbRemove(key: string): void {
  const m = ensureLoaded();
  if (!m.has(key)) return;
  m.delete(key);
  try { fs.unlinkSync(path.join(DIR, `${safeName(key)}.json`)); } catch { /* ignore */ }
}

let lastFailLogAt = 0;
/** 写失败节流日志（1 分钟一条）：避免故障期间每次 PUT 都刷错误日志 */
export function wbNoteWriteFail(key: string, err: any): void {
  const now = Date.now();
  if (now - lastFailLogAt < 60_000) return;
  lastFailLogAt = now;
  console.error(`[writeBehind] MySQL 写入失败，已落磁盘兜底 key=${key}: ${err && err.message ? err.message : err}`);
}

/**
 * 回放调度：启动 15s 后首跑、之后每 5 分钟一轮；按 ts 升序写回底层驱动，
 * 成功即删本地兜底文件，失败静默等下一轮（DB 仍不可写时不刷日志）。
 * 直接注入底层驱动（非包装后的 store），避免回放写入再次落入兜底形成递归。
 */
export function startWriteBehindReplay(driver: {
  forceUpsertDataset: (key: string, json: string, owner: string, ts: number) => Promise<any>;
  deleteDataset: (key: string) => Promise<any>;
}): void {
  const tick = async () => {
    const entries = wbAll().sort((a, b) => a.updated_at - b.updated_at);
    if (entries.length === 0) return;
    for (const e of entries) {
      try {
        if (e.tombstone) await driver.deleteDataset(e.key);
        else await driver.forceUpsertDataset(e.key, e.json, e.owner, e.updated_at);
        wbRemove(e.key);
        console.warn(`[writeBehind] 回放成功 key=${e.key} ts=${e.updated_at}`);
      } catch { /* DB 仍不可用，下一轮重试 */ }
    }
  };
  setTimeout(() => { void tick(); }, 15_000);
  setInterval(() => { void tick(); }, 5 * 60_000);
}
