/**
 * localStorage 空间管理工具
 */
import request from './request';

const STORAGE_QUOTA_KEY = 'userStorageQuota'; // 每个用户的空间配额存储 key

export interface UserQuota {
  [username: string]: number; // 单位：KB，内部存储始终为KB
}

const BASE_QUOTA_KB = 2 * 1024 * 1024;      // 新注册账号默认 2GB
const CERTIFIED_QUOTA_KB = 10 * 1024 * 1024; // 企业认证（三要素+法人刷脸）通过后领取 10GB 永久空间

// 认证状态同步缓存：getUserQuota 为同步调用，而认证结果由服务端异步返回，
// 故在 fetchCertStatus/fetchCertBatch 拿到结果后写入此缓存供同步读取
const CERT_CACHE_KEY = 'cert_status_cache';
export function cacheCertStatus(username: string, status: string): void {
  if (!username) return;
  try {
    const m = JSON.parse(localStorage.getItem(CERT_CACHE_KEY) || '{}');
    m[username] = { status: status || '', ts: Date.now() };
    localStorage.setItem(CERT_CACHE_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}
export function isCertifiedCached(username: string): boolean {
  if (!username) return false;
  try {
    const m = JSON.parse(localStorage.getItem(CERT_CACHE_KEY) || '{}');
    return m[username]?.status === 'certified';
  } catch { return false; }
}

/**
 * 获取所有用户的空间配额
 */
export function getAllQuotas(): UserQuota {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_QUOTA_KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * 获取指定用户的空间配额（KB）
 */
export function getUserQuota(username: string): number {
  const quotas = getAllQuotas();
  // 默认 2GB；企业认证通过领取 10GB；已购/已分配更大配额不受影响
  const base = isCertifiedCached(username) ? CERTIFIED_QUOTA_KB : BASE_QUOTA_KB;
  return Math.max(quotas[username] || 0, base);
}

/** 已购/已分配配额（KB，不含免费赠送底座；开发者后台"总订购空间"只统计此部分） */
export function getPaidQuotaKB(username: string): number {
  return getAllQuotas()[username] || 0;
}

/** 免费赠送底座配额（KB：未认证 2GB / 认证 10GB；开发者后台"总赠送空间"统计此部分） */
export function getFreeBaseQuotaKB(username: string): number {
  return isCertifiedCached(username) ? CERTIFIED_QUOTA_KB : BASE_QUOTA_KB;
}

/**
 * 设置指定用户的空间配额（KB）
 */
export function setUserQuota(username: string, quotaKB: number): void {
  const quotas = getAllQuotas();
  quotas[username] = quotaKB;
  localStorage.setItem(STORAGE_QUOTA_KEY, JSON.stringify(quotas));
}

/**
 * 获取指定用户的本地存储用量（KB，增量账本口径）
 * localStorage 按浏览器隔离：仅当前登录租户有本地账本，其他租户本地计 0（数据库部分由服务端计数器另行叠加）
 */
export function getUserStorageUsage(username: string): number {
  const owner = sessionDataOwner();
  if (owner && username && username !== owner) return 0;
  return getLocalUsageKB(owner || username);
}

/**
 * 获取总 localStorage 使用量（KB）
 */
export function getTotalStorageUsage(): number {
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key) || '';
      totalBytes += (key.length + value.length) * 2;
    }
  }
  return parseFloat((totalBytes / 1024).toFixed(2));
}

/**
 * 格式化大小为可读字符串（支持 B/KB/MB/GB/TB）
 */
export function formatStorageSize(kb: number): string {
  if (kb < 1) {
    return `${(kb * 1024).toFixed(0)} B`;
  } else if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  } else if (kb < 1024 * 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  } else if (kb < 1024 * 1024 * 1024) {
    return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  }
  return `${(kb / 1024 / 1024 / 1024).toFixed(2)} TB`;
}

/**
 * KB 转 GB（保留2位小数）
 */
export function kbToGb(kb: number): number {
  return parseFloat((kb / 1024 / 1024).toFixed(2));
}

/**
 * GB 转 KB
 */
export function gbToKb(gb: number): number {
  return Math.round(gb * 1024 * 1024);
}

/**
 * 计算使用百分比
 */
export function getUsagePercent(used: number, quota: number): number {
  if (quota <= 0) return 0;
  return Math.min(100, parseFloat(((used / quota) * 100).toFixed(1)));
}

/**
 * 原生 setItem 引用（不受全局防护补丁影响，避免递归调用）
 */
const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;

/** 获取原生 setItem 引用（供跨浏览器同步等外部模块直接写入而不触发钩子） */
export function getOriginalSetItem(): (key: string, value: string) => void {
  return (key, value) => originalSetItem.call(localStorage, key, value);
}

// ============ 写入钩子：任何 localStorage 写入成功后回调（用于跨浏览器同步等） ============
export type SetItemHook = (key: string, value: string) => void;
const setItemHooks: SetItemHook[] = [];
export function registerSetItemHook(hook: SetItemHook): void {
  setItemHooks.push(hook);
}
function fireHooks(key: string, value: string): void {
  for (const h of setItemHooks) {
    try { h(key, value); } catch { /* ignore */ }
  }
}

/**
 * 紧急释放空间：配额溢出时按序清理，保证应用可用
 * 1) 剥离 pageData_ 中内嵌的旧版付款截图 dataURL（历史数据体积巨大；新版已按行单独存储）
 * 2) 删除超过 300KB 的旧版未压缩图片块（prodImg_/payShot_）
 * 3) 剥离商机市场列表中的内嵌图片（仅保留首张缩略图）
 * 4) 截断登录审计日志 login_audit_log 至最近 100 条
 */
export function emergencyFreeSpace(protectKey?: string): void {
  const set = (k: string, v: string) => { try { originalSetItem.call(localStorage, k, v); } catch { /* ignore */ } };
  const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
  // 绝对不可删除的认证/关键键（写入失败留痕也必须保住，否则取证链路本身会被清理掉）
  const CRITICAL = new Set(['username', 'isSubAccount', 'parentAccount', 'registeredUsers', WRITE_FAIL_LOG_KEY]);
  const isProtected = (k: string) => CRITICAL.has(k) || k === protectKey || k === `${protectKey}_ts` || k.startsWith('credit_adjustments_');
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      // 1) 剥离内嵌付款截图
      if (key.startsWith('pageData_') && raw.indexOf('"payScreenshot":"data:') >= 0) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const slim = list.map((it: any) => {
              if (it && typeof it.payScreenshot === 'string' && it.payScreenshot.startsWith('data:')) {
                const { payScreenshot: _shot, ...rest } = it;
                return rest;
              }
              return it;
            });
            set(key, JSON.stringify(slim));
            continue;
          }
        } catch { /* ignore */ }
      }
      // 2) 删除旧版未压缩图片块
      if ((key.startsWith('prodImg_') || key.startsWith('payShot_')) && raw.length > 300000) {
        del(key);
        continue;
      }
      // 3) 商机市场列表：剥离内嵌图片（仅保留首张）
      if (key === 'market_mold_listings' && raw.length > 500000) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const slim = list.map((it: any) => {
              if (it && Array.isArray(it.images) && it.images.length > 1) {
                return { ...it, images: [it.images[0]] };
              }
              if (it && Array.isArray(it.images) && it.images.length === 1 && typeof it.images[0] === 'string' && it.images[0].length > 200000) {
                return { ...it, images: [] };
              }
              return it;
            });
            set(key, JSON.stringify(slim));
            continue;
          }
        } catch { /* ignore */ }
      }
      // 4) 截断审计日志
      if (key === 'login_audit_log') {
        try {
          const logs = JSON.parse(raw);
          if (Array.isArray(logs) && logs.length > 100) set(key, JSON.stringify(logs.slice(-100)));
        } catch { /* ignore */ }
      }
    }
    // 5) 通用兜底：按体积降序删除 >100KB 的非关键可恢复键（服务端为数据源，本地缓存可重建）
    const sized = keys
      .map((k) => ({ k, size: (localStorage.getItem(k) || '').length }))
      .filter((e) => e.size > 100000 && !isProtected(e.k) && !e.k.endsWith('_ts'))
      .sort((a, b) => b.size - a.size);
    for (const e of sized) {
      del(e.k);
    }
  } catch { /* ignore */ }
}

// ============ 写入失败留痕与告警（杜绝“提示保存成功但实际未存”） ============
// 背景：全局 setItem 防护在“清理后仍写不进”时以前直接丢弃异常，调用方拿到 undefined、
// 页面照常弹“保存成功”，刷新后数据消失且无任何可查线索。现在：
// ① 写入环形留痕键（供开发现场/诊断导出取证）；② 广播事件供 UI 层当场提示；③ 函数仍返回 false。
// 有意保持“不抛异常”：招回 throw 会打挂全应用几十处调用点（包括表单提交中间态），属行为破坏性变更。
const WRITE_FAIL_LOG_KEY = 'storage_write_fail_log';
const WRITE_FAIL_LOG_MAX = 50;
export interface StorageWriteFailRecord { ts: number; key: string; size: number; stage: string; msg: string; }

function appendWriteFailRecord(rec: StorageWriteFailRecord): void {
  try {
    let list: StorageWriteFailRecord[] = [];
    try { const raw = localStorage.getItem(WRITE_FAIL_LOG_KEY); list = raw ? JSON.parse(raw) : []; } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list.push(rec);
    if (list.length > WRITE_FAIL_LOG_MAX) list = list.slice(-WRITE_FAIL_LOG_MAX);
    // 原生写入：不走防护补丁，避免递归与再次因配额满抛错
    originalSetItem.call(localStorage, WRITE_FAIL_LOG_KEY, JSON.stringify(list));
  } catch { /* 留痕键自己写不进：只能降级为控制台输出 */ }
}

/** 最近的数据写入失败记录（时间升序） */
export function getWriteFailures(): StorageWriteFailRecord[] {
  try {
    const raw = localStorage.getItem(WRITE_FAIL_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** 清空写入失败留痕（仅在确认已处理/已取证后调用） */
export function clearWriteFailures(): void {
  try { originalSetItem.call(localStorage, WRITE_FAIL_LOG_KEY, '[]'); } catch { /* ignore */ }
}

// 同一键 60s 内只广播一次：批量写失败时不能把屏幕刷满弹窗
let lastWriteFailNotify: { key: string; ts: number } = { key: '', ts: 0 };
function reportWriteFailure(key: string, size: number, stage: string, err: any): void {
  const msg = String((err && err.message) || err || 'QuotaExceededError').slice(0, 200);
  appendWriteFailRecord({ ts: Date.now(), key: String(key || ''), size: Number(size) || 0, stage, msg });
  try { console.warn('[storageQuota] 数据写入失败，本次修改未保存', { key, size, stage, msg }); } catch { /* ignore */ }
  const now = Date.now();
  if (lastWriteFailNotify.key === key && now - lastWriteFailNotify.ts < 60000) return;
  lastWriteFailNotify = { key, ts: now };
  try { window.dispatchEvent(new CustomEvent('storage-write-failed', { detail: { key, size, stage, msg } })); } catch { /* ignore */ }
}

/**
 * 安全 localStorage.setItem：配额溢出时自动紧急清理并重试，避免页面崩溃
 * @returns 写入是否落盘；false 时已记录留痕并广播 storage-write-failed，调用方不得当作成功提示
 */
export function safeSetItem(key: string, value: string): boolean {
  const oldLen = (localStorage.getItem(key) || '').length;
  try {
    originalSetItem.call(localStorage, key, value);
    fireHooks(key, value);
    notifyUsageWrite(key, oldLen, value.length);
    return true;
  } catch (err1) {
    emergencyFreeSpace(key);
    try {
      originalSetItem.call(localStorage, key, value);
      fireHooks(key, value);
      notifyUsageWrite(key, oldLen, value.length);
      return true;
    } catch (err2) {
      // 本地配额写不进时，同步上传钩子不能跟着断链：仍按内存中的最新值上传服务端，
      // 保证数据在其他端/换机后可恢复（本地显示由 IndexedDB 或服务端回灌兜底）
      fireHooks(key, value);
      reportWriteFailure(key, value.length, `safeSetItem(重试后仍失败;首次:${String((err1 as any)?.message || err1).slice(0, 60)})`, err2);
      return false;
    }
  }
}

/** 计算 localStorage 当前占用字节数（key+value 总长） */
export function localStorageUsage(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) total += k.length + (localStorage.getItem(k) || '').length;
    }
  } catch { /* ignore */ }
  return total;
}

/** 启动时主动配额清理：占用超过阈值（约4MB，Chrome 上限约5MB）时提前释放空间，
 * 避免后续关键写入（信用额度等）因配额满而静默失败 */
export function proactiveQuotaCleanup(thresholdBytes = 4 * 1024 * 1024): void {
  try {
    const usage = localStorageUsage();
    if (usage > thresholdBytes) {
      console.warn('[storageQuota] 占用过高(', Math.round(usage / 1024), 'KB)，启动主动清理');
      emergencyFreeSpace();
    }
  } catch { /* ignore */ }
}

/**
 * 全局 localStorage 配额防护补丁：安装后全应用任何 localStorage.setItem
 * 在配额溢出时自动紧急清理并重试；仍失败则放弃本次写入（保持页面可用），
 * 但不再静默：写入留痕键并广播 storage-write-failed 供 UI 提示，杜绝“看起来保存成功”
 */
let guardInstalled = false;
export function installStorageQuotaGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  Storage.prototype.setItem = function (key: string, value: string) {
    const oldLen = this === localStorage ? (localStorage.getItem(key) || '').length : -1;
    try {
      originalSetItem.call(this, key, value);
      if (this === localStorage) { fireHooks(key, value); notifyUsageWrite(key, oldLen, value.length); }
    } catch (err1) {
      try {
        emergencyFreeSpace();
        originalSetItem.call(this, key, value);
        if (this === localStorage) { fireHooks(key, value); notifyUsageWrite(key, oldLen, value.length); }
      } catch (err2) {
        // 清理后仍失败：放弃本次本地写入（保持页面可用），但同步钩子仍要触发一次，
        // 由上传链路把内存中的最新值送到服务端，避免“本地没存 + 服务端也没存”的双重丢失；
        // 同时留痕并对外告警
        if (this === localStorage) {
          fireHooks(key, value);
          reportWriteFailure(key, (value || '').length, `setItem(重试后仍失败;首次:${String((err1 as any)?.message || err1).slice(0, 60)})`, err2);
        }
      }
    }
  };
  // removeItem 同样维护增量账本（删除即减去旧体积）
  Storage.prototype.removeItem = function (key: string) {
    const oldLen = this === localStorage ? (localStorage.getItem(key) || '').length : -1;
    originalRemoveItem.call(this, key);
    if (this === localStorage && oldLen >= 0) notifyUsageWrite(key, oldLen, 0);
  };
}

// ============ 租户用量增量账本（本地 localStorage 部分） ============
const USAGE_LEDGER_KEY = 'storage_usage_ledger';
const LEDGER_RECONCILE_MS = 5 * 60 * 1000; // 超 5 分钟全量对账一次（兜底紧急清理等旁路写入的漂移）

/** 判断键是否属于指定租户数据（覆盖全部表单缓存 pageData_*_<owner>、图片 prodImg_<owner>_、设置键等） */
export function ownerKeyMatches(key: string, owner: string): boolean {
  if (!owner) return false;
  return key.endsWith(`_${owner}`) || key.includes(`_${owner}_`);
}

/** 当前会话数据归属租户（与 getDataOwner 同口径：子账号归父账号） */
export function sessionDataOwner(): string {
  try {
    if (localStorage.getItem('isSubAccount') === 'true') return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    return localStorage.getItem('username') || '';
  } catch { return ''; }
}

/** 全量扫描指定租户本地占用（字节，UTF-16 口径） */
export function fullScanLocalBytes(owner: string): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && ownerKeyMatches(k, owner)) total += (k.length + (localStorage.getItem(k) || '').length) * 2;
    }
  } catch { /* ignore */ }
  return total;
}

type LedgerMap = Record<string, { bytes: number; ts: number }>;
function readLedger(): LedgerMap {
  try { return JSON.parse(localStorage.getItem(USAGE_LEDGER_KEY) || '{}'); } catch { return {}; }
}
function writeLedger(m: LedgerMap): void {
  try { originalSetItem.call(localStorage, USAGE_LEDGER_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
/** 写入/删除钩子：按差值增量维护本地账本 */
export function notifyUsageWrite(key: string, oldLen: number, newLen: number): void {
  const owner = sessionDataOwner();
  if (!ownerKeyMatches(key, owner)) return;
  const delta = (newLen - oldLen) * 2;
  if (!delta) return;
  const m = readLedger();
  const e = m[owner] || { bytes: 0, ts: 0 };
  m[owner] = { bytes: Math.max(0, e.bytes + delta), ts: Date.now() };
  writeLedger(m);
}

/** 本地用量（KB）：优先读增量账本，缺失或超 5 分钟时全量对账一次 */
export function getLocalUsageKB(owner: string): number {
  if (!owner) return 0;
  const m = readLedger();
  const e = m[owner];
  if (!e || Date.now() - e.ts > LEDGER_RECONCILE_MS) {
    const bytes = fullScanLocalBytes(owner);
    m[owner] = { bytes, ts: Date.now() };
    writeLedger(m);
    return parseFloat((bytes / 1024).toFixed(2));
  }
  return parseFloat((e.bytes / 1024).toFixed(2));
}

// ============ 服务端数据库用量（增量计数器）与总分解 ============
let serverUsageCache: { owner: string; bytes: number; ts: number } | null = null;
/** 查询服务端数据库用量（字节）：读服务端 O(1) 增量计数器，30s 缓存 */
export async function fetchServerUsageBytes(owner: string, force = false): Promise<number> {
  if (!owner) return 0;
  if (!force && serverUsageCache && serverUsageCache.owner === owner && Date.now() - serverUsageCache.ts < 30000) return serverUsageCache.bytes;
  try {
    const res = await request.get('/sync/usage', { params: { owner } });
    const bytes = Number(res?.data?.data?.bytes) || 0;
    serverUsageCache = { owner, bytes, ts: Date.now() };
    return bytes;
  } catch {
    return serverUsageCache && serverUsageCache.owner === owner ? serverUsageCache.bytes : 0;
  }
}

/** 全部租户数据库用量映射（开发者后台列表用） */
export async function fetchAllServerUsage(): Promise<Record<string, number>> {
  try {
    const res = await request.get('/sync/usage-all');
    return res?.data?.data || {};
  } catch { return {}; }
}

export interface UsageBreakdown { localKB: number; serverKB: number; totalKB: number; }
let breakdownCache: { owner: string; data: UsageBreakdown; ts: number } | null = null;
/** 用量分解：本地表单缓存 + 服务端数据库，30s 缓存；更新后广播 storage-usage-updated 事件 */
export async function getUsageBreakdown(owner: string, force = false): Promise<UsageBreakdown> {
  if (!force && breakdownCache && breakdownCache.owner === owner && Date.now() - breakdownCache.ts < 30000) return breakdownCache.data;
  const localKB = getLocalUsageKB(owner);
  const serverBytes = await fetchServerUsageBytes(owner, force);
  const serverKB = parseFloat((serverBytes / 1024).toFixed(2));
  const data: UsageBreakdown = { localKB, serverKB, totalKB: parseFloat((localKB + serverKB).toFixed(2)) };
  breakdownCache = { owner, data, ts: Date.now() };
  try { window.dispatchEvent(new Event('storage-usage-updated')); } catch { /* ignore */ }
  return data;
}

/** 重新扫描：本地全量重扫 + 服务端全量重算（单遍聚合），返回最新分解 */
export async function rescanUsage(owner: string): Promise<UsageBreakdown> {
  const bytes = fullScanLocalBytes(owner);
  const m = readLedger();
  m[owner] = { bytes, ts: Date.now() };
  writeLedger(m);
  try { await request.post('/sync/usage-recompute', {}, { params: { owner } }); } catch { /* ignore */ }
  serverUsageCache = null;
  return getUsageBreakdown(owner, true);
}
