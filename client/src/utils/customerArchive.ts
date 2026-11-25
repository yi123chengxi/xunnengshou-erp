/**
 * 客户归档登记册（customer_archive_<owner>）：
 * 供应商端「删除客户」改为「归档」后的显式用户意图登记。历史删除墓碑（customer_del_tomb_）
 * 的时间戳让位规则会把终止事件（statusTs/terminateAt 刷新）误判为重新合作而永久让位，
 * 且 reconcile 镜像补全 / 45s 水合回灌两个写点不认墓碑，导致删除后仍复活。
 * 归档语义不受任何状态时间戳干扰：
 * - 派生兜底补行前查归档册，命中即跳过；加载期 prune 剔除回流 bound 行；
 * - reconcile 镜像补全与水合回灌写镜像前按归档册过滤（filterArchivedBound）；
 * - 解除仅两条显式出口：用户点「恢复」（unarchiveParty）或新合作批准写点主动 unarchiveParty。
 * 键参与全局同步（serverSync SYNC_PREFIXES），服务端恒走记录级并集（MERGE_ALWAYS_PREFIXES），
 * 陈旧端整键上传不会抹掉新归档；归属为严格私有（syncGuard STRICT_PRIVATE_PREFIXES）。
 */
import { safeSetItem } from './storageQuota';
import { saveDataset } from './dataStore';
import { noFromUsername, uniqueCompanyRootByName } from './cooperationCred';
import { loadCustomerDelTombs } from './customerDelTomb';

export interface CustomerArchiveEntry {
  id: string;
  username: string;
  no: string;
  name: string;
  archivedAt: number;
  archivedBy: string;
  origin: 'manual' | 'delete-migrate';
  /** 归档时的行快照：恢复时回写 bound 镜像 / 直客档案 */
  snapshot?: { boundRow?: any; directProfile?: any };
}

/** 名称歧义表与账号→编号表（与 CustomerInfo partyCtx 同口径，一次构建复用） */
export interface ArchivePartyCtx { ambiguous?: Set<string>; noByUn?: Map<string, string> }

/** 待判定主体行（bound 行 / 合作申请 / 采购商目录条目统一字段口径） */
export interface ArchivePartyRow { purchaserUsername?: string; purchaserNo?: string; purchaserName?: string }

export const customerArchiveKey = (owner: string): string => `customer_archive_${owner}`;

export function loadCustomerArchives(owner: string): CustomerArchiveEntry[] {
  try {
    const raw = localStorage.getItem(customerArchiveKey(owner));
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((t: any) => t && typeof t === 'object' && Number(t.archivedAt) > 0);
  } catch { return []; }
}

function persistArchives(owner: string, list: CustomerArchiveEntry[]): void {
  const key = customerArchiveKey(owner);
  const json = JSON.stringify(list);
  const now = Date.now();
  safeSetItem(key, json);
  safeSetItem(`${key}_ts`, String(now));
  saveDataset(key, json);
}

/**
 * 登记归档：同一主体（账号/编号等值）已有条目时刷新 archivedAt 并合并快照，
 * 保证「归档→恢复→再归档」后时间戳与快照为最新。写入走 safeSetItem + _ts + saveDataset，
 * setItem 钩子负责防抖上传。
 */
export function appendCustomerArchive(
  owner: string,
  party: { username?: string; no?: string; name?: string; archivedBy?: string; origin?: 'manual' | 'delete-migrate'; snapshot?: { boundRow?: any; directProfile?: any } },
): void {
  const username = String(party.username || '').trim();
  const no = String(party.no || '').trim();
  const name = String(party.name || '').trim();
  if (!username && !no && !name) return;
  const list = loadCustomerArchives(owner);
  const now = Date.now();
  const hit = list.find(a => (username && a.username === username) || (no && a.no === no));
  if (hit) {
    hit.archivedAt = now;
    hit.username = username || hit.username;
    hit.no = no || hit.no;
    hit.name = name || hit.name;
    hit.archivedBy = party.archivedBy || hit.archivedBy;
    hit.origin = 'manual';
    if (party.snapshot) hit.snapshot = { ...hit.snapshot, ...party.snapshot };
  } else {
    list.push({
      id: `ca-${now}-${Math.random().toString(36).slice(2, 6)}`,
      username, no, name,
      archivedAt: now,
      archivedBy: String(party.archivedBy || ''),
      origin: party.origin || 'manual',
      ...(party.snapshot ? { snapshot: party.snapshot } : {}),
    });
  }
  persistArchives(owner, list);
}

/**
 * 归档条目 ↔ 主体行同一判定：账号等值 > 公司编号等值 > 名称全等且全库唯一主体命中
 * （与 CustomerInfo samePurchaserParty 同口径：同名两家公司时名称档不认，防连带误杀）。
 */
export function archiveMatchesParty(a: CustomerArchiveEntry, row: ArchivePartyRow, ctx?: ArchivePartyCtx): boolean {
  const noOfUn = (un: string) => (ctx?.noByUn ? (ctx.noByUn.get(un) || '') : noFromUsername(un));
  const ru = String(row?.purchaserUsername || '').trim();
  const au = String(a?.username || '').trim();
  if (ru && au && ru === au) return true;
  const rn = String(row?.purchaserNo || '').trim() || noOfUn(ru);
  const an = String(a?.no || '').trim() || noOfUn(au);
  if (rn && an) return rn === an;
  if (ru && au) return false;
  const nm = String(a?.name || '').trim();
  const rnm = String(row?.purchaserName || '').trim();
  if (!nm || nm !== rnm) return false;
  return ctx?.ambiguous ? !ctx.ambiguous.has(nm) : !!uniqueCompanyRootByName(nm);
}

/**
 * 活跃归档判定：命中主体即活跃，**不做时间戳让位**——
 * 终止完成 / reconcile 状态回写 / 水合回灌刷新的 statusTs/terminateAt 都不是重新合作，
 * 解除归档只能走 unarchiveParty 显式出口。
 */
export function archiveActiveForParty(archives: CustomerArchiveEntry[], row: ArchivePartyRow, ctx?: ArchivePartyCtx): boolean {
  if (!archives.length) return false;
  return archives.some(a => archiveMatchesParty(a, row, ctx));
}

/**
 * 加载期剪枝：剔除被归档命中的 bound 行（他端派生/水合复活回流），
 * removedKeys 含 key 与 id 两列（服务端真表按 key||id 匹配），回写后由 doPush 差集申报删除。
 */
export function pruneArchivedBound(bound: any[], archives: CustomerArchiveEntry[], ctx?: ArchivePartyCtx): { list: any[]; removedKeys: string[] } {
  if (!archives.length) return { list: bound, removedKeys: [] };
  const removedKeys: string[] = [];
  const list = (Array.isArray(bound) ? bound : []).filter((bp: any) => {
    if (!archives.some(a => archiveMatchesParty(a, bp, ctx))) return true;
    removedKeys.push(String(bp?.key || ''), String(bp?.id || ''));
    return false;
  });
  return { list, removedKeys: removedKeys.filter(Boolean) };
}

/**
 * 写点过滤（reconcile 镜像补全 / 水合回灌写镜像前）：按目标 owner 归档册剔除 bound 行。
 * 镜像缺行后 doPush 的 removedAgainst 差集自动申报 removedKeys，服务端真表同收敛。
 */
export function filterArchivedBound(bound: any[], owner: string, ctx?: ArchivePartyCtx): any[] {
  const list = Array.isArray(bound) ? bound : [];
  const archives = loadCustomerArchives(owner);
  if (!archives.length) return list;
  return list.filter((bp: any) => !archives.some(a => archiveMatchesParty(a, bp, ctx)));
}

/**
 * 解除归档（显式出口）：用户点「恢复」或新合作批准写点调用。
 * 优先按条目 id 精确解除；否则按凭证三档匹配主体。返回是否真的移除了条目。
 */
export function unarchiveParty(owner: string, party: { id?: string; username?: string; no?: string; name?: string }, ctx?: ArchivePartyCtx): boolean {
  const list = loadCustomerArchives(owner);
  const row: ArchivePartyRow = { purchaserUsername: party.username, purchaserNo: party.no, purchaserName: party.name };
  const kept = list.filter(a => {
    if (party.id && a.id === party.id) return false;
    return !archiveMatchesParty(a, row, ctx);
  });
  if (kept.length === list.length) return false;
  persistArchives(owner, kept);
  return true;
}

/**
 * 存量墓碑迁移：把 customer_del_tomb_ 条目转为归档条目（origin='delete-migrate'），
 * 使历史删除客户在归档语义下继续隐藏（含此前因让位规则复活的行）。
 * 哨兵存墓碑指纹（条数:最大 deletedAt）：他端墓碑经同步晚到时指纹变化会再次迁移，幂等不重复。
 * 哨兵键名故意避开 customer_archive_ 同步前缀（仅本机有效，跨端覆盖会误跳过迁移）。
 */
export function migrateTombsToArchive(owner: string): void {
  const tombs = loadCustomerDelTombs(owner);
  const fingerprint = `${tombs.length}:${tombs.reduce((m, t) => Math.max(m, Number(t.deletedAt) || 0), 0)}`;
  const sentinelKey = `cust_arch_migrated_${owner}`;
  try { if (localStorage.getItem(sentinelKey) === fingerprint) return; } catch { return; }
  if (tombs.length) {
    const list = loadCustomerArchives(owner);
    let changed = false;
    tombs.forEach(t => {
      const tu = String(t.username || '').trim();
      const tn = String(t.no || '').trim();
      const nm = String(t.name || '').trim();
      const hit = list.find(a => (tu && a.username === tu) || (tn && a.no === tn) || (!tu && !tn && nm && a.name === nm));
      if (hit) return;
      list.push({
        id: `ca-mig-${t.id}`,
        username: tu, no: tn, name: nm,
        archivedAt: Number(t.deletedAt) || Date.now(),
        archivedBy: '',
        origin: 'delete-migrate',
      });
      changed = true;
    });
    if (changed) persistArchives(owner, list);
  }
  try { safeSetItem(sentinelKey, fingerprint); } catch { /* ignore */ }
}