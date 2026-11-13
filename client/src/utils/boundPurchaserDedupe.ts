/**
 * 供应商侧客户列表（boundPurchasers_<供应商账号>）同源去重兜底（加载时自愈）。
 *
 * 历史写点会为同一采购商生成不同 id 的条目：
 * - 供应商审批合作 / 合作链接确认回写：`BIND-<Date.now()>`，且部分分支不写 purchaserUsername；
 * - 客户列表加载时的兜底派生（已批准申请补入、purchaser_suppliers_ 反向补入）与
 *   cooperationReconcile 镜像补全：`BIND-<采购商账号后 6 位>`。
 * 当本地副本陈旧（另一端的条目还没拉下来）或历史行缺 purchaserUsername、公司名与注册名不一致时，
 * 派生判定「不存在」又补一条；boundPurchasers_ 是服务端「永不缩水键」，过期并集合并会把新旧 id
 * 同时保留 → 客户基础信息里同一家公司显示两行，且只有生成过第二条记录的那个浏览器先看到。
 *
 * 本模块按「采购商账号 → 采购商编号(companyNo) → 全平台唯一公司名」归并：
 * - 主条目取带账号/编号且合作状态最靠后者（终止态单调，不可被重复条目里的已合作覆盖）；
 * - 其余条目的非空字段被吸收，合作起始日取最早值；
 * - 被合并掉的旧行先 declareShrink 申报（服务端按 key || id 匹配，两者都申报），否则下次拉取会复活。
 */
import { declareShrink } from './shrinkRegistry';
import { resolveLatestCompanyName } from './nameSync';

const BOUND_PREFIX = 'boundPurchasers_';
const STATUS_RANK: Record<string, number> = { terminated: 3, terminating: 2, approved: 1 };

const readRegisteredUsers = (): any[] => {
  try {
    const list = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 被合并行的主键：服务端永不缩水键按 key || id 匹配，能拿到的都申报，避免旧行被并集复活 */
const rowRefs = (row: any): string[] => {
  const refs: string[] = [];
  const k = String(row?.key || '').trim();
  const id = String(row?.id || '').trim();
  if (k) refs.push(k);
  if (id && id !== k) refs.push(id);
  return refs;
};

/** 合并同一采购商的重复绑定行；返回是否发生合并（已落盘并申报删除） */
export const dedupeBoundPurchasers = (owner: string): boolean => {
  try {
    if (!owner) return false;
    const storageKey = BOUND_PREFIX + owner;
    const list: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(list) || list.length < 2) return false;
    const users = readRegisteredUsers();
    const displayName = (b: any) => resolveLatestCompanyName(String(b?.purchaserName || ''), b?.purchaserUsername);
    const numberOf = (b: any) => {
      const direct = String(b?.purchaserNo || '').trim();
      if (direct) return direct.toUpperCase();
      const name = displayName(b);
      const u = users.find((x: any) =>
        (b?.purchaserUsername && x.username === b.purchaserUsername) ||
        (name && String(x.companyName || '').trim() === name));
      return String(u?.companyNo || '').trim().toUpperCase();
    };
    // 公司名重名计数：只有全平台唯一的公司名才可单独作为归并键
    const nameCount = new Map<string, number>();
    users.forEach((u: any) => {
      const n = String(u.companyName || '').trim();
      if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1);
    });
    // 缺 purchaserUsername 的历史行用「公司名 / 采购商编号」别名指向已带账号的同源条目；
    // 同一别名命中多个账号时判为歧义（null），不参与归并，避免把两家不同企业并成一行
    const alias = new Map<string, string | null>();
    const bindAlias = (k: string, un: string) => {
      if (!k) return;
      const prev = alias.get(k);
      if (prev === undefined) alias.set(k, un);
      else if (prev !== un) alias.set(k, null);
    };
    list.forEach((b: any) => {
      const un = String(b?.purchaserUsername || '').trim();
      if (!un) return;
      const name = displayName(b);
      if (name) bindAlias('c:' + name, un);
      const no = numberOf(b);
      if (no) bindAlias('n:' + no, un);
    });
    const keyOf = (b: any): string | null => {
      if (!b || typeof b !== 'object') return null;
      const un = String(b.purchaserUsername || '').trim();
      if (un) return 'u:' + un;
      const no = numberOf(b);
      if (no) {
        const via = alias.get('n:' + no);
        return via ? 'u:' + via : 'n:' + no;
      }
      const name = displayName(b);
      if (!name) return null;
      const viaName = alias.get('c:' + name);
      if (viaName) return 'u:' + viaName;
      if (nameCount.get(name) === 1) return 'c:' + name;
      return null; // 同名多家注册企业且无账号/编号：无法判定是否同一家，保守不合并
    };
    const groups = new Map<string, any[]>();
    list.forEach((b: any) => {
      const k = keyOf(b);
      if (!k) return;
      const g = groups.get(k);
      if (g) g.push(b); else groups.set(k, [b]);
    });
    const tsOf = (b: any) => Number(b?.statusTs || 0)
      || Date.parse(String(b?.bindDate || '').replace(/-/g, '/')) || 0;
    const weightOf = (b: any) =>
      (String(b?.purchaserUsername || '').trim() ? 4 : 0) +
      (numberOf(b) ? 2 : 0) +
      (STATUS_RANK[String(b?.status || '')] || 0) * 8;
    const mergedByGroup = new Map<any[], any>();
    const removedRefs: string[] = [];
    let changed = false;
    groups.forEach((g) => {
      if (g.length < 2) return;
      changed = true;
      const primary = g.slice().sort((a, b) => (weightOf(b) - weightOf(a)) || (tsOf(b) - tsOf(a)))[0];
      let statusSrc = primary;
      const merged: any = { ...primary };
      g.forEach((o) => {
        if (o === primary) return;
        removedRefs.push(...rowRefs(o));
        Object.keys(o).forEach((k) => {
          if (k === 'key' || k === 'id') return;
          if (k === 'status' || k === 'statusTs' || k === 'terminateAt' || k === 'terminateBy') return;
          const v = o[k];
          if (v !== undefined && v !== null && v !== '' && (merged[k] === undefined || merged[k] === null || merged[k] === '')) merged[k] = v;
        });
        // 合作起始日取最早值，保留真实建立时间
        if (o.bindDate && (!merged.bindDate || String(o.bindDate) < String(merged.bindDate))) merged.bindDate = o.bindDate;
        // 终止态单调：解除/解除中不得被重复条目里的已合作覆盖
        if ((STATUS_RANK[String(o.status || '')] || 0) > (STATUS_RANK[String(statusSrc.status || '')] || 0)) statusSrc = o;
      });
      merged.status = statusSrc.status;
      if (statusSrc.statusTs) merged.statusTs = statusSrc.statusTs;
      if (statusSrc.status === 'approved') { delete merged.terminateAt; delete merged.terminateBy; }
      else {
        if (statusSrc.terminateAt) merged.terminateAt = statusSrc.terminateAt; else delete merged.terminateAt;
        if (statusSrc.terminateBy) merged.terminateBy = statusSrc.terminateBy; else delete merged.terminateBy;
      }
      mergedByGroup.set(g, merged);
    });
    if (!changed) return false;
    // 按首次出现位置回填：同组只保留合并后的主条目，其余条目丢弃
    const written = new Set<any[]>();
    const next: any[] = [];
    list.forEach((b: any) => {
      const k = keyOf(b);
      const g = k ? groups.get(k) : null;
      if (!g || g.length < 2) { next.push(b); return; }
      if (written.has(g)) return;
      written.add(g);
      next.push(mergedByGroup.get(g));
    });
    declareShrink(storageKey, removedRefs);
    localStorage.setItem(storageKey, JSON.stringify(next));
    return true;
  } catch { return false; }
};
