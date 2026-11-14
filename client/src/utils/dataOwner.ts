/**
 * 数据归属账号（租户主账号）解析：全站页面共用同一口径。
 *
 * 背景：子账号与主账号共用同一套存储键（键后缀 = 主账号名），服务端 syncGuard 也
 * 只允许「自己 / 自己的主账号」读写这类严格私有键（报销、日常记账、客户等）。
 * 一旦子账号被误判成主账号（isSubAccount=false 或 parentAccount 为空），
 * 它写出的数据就会落进「自己用户名」的独立桶里：同企业的其他人（主账号、其他子账号、
 * 模块负责人）永远看不到这些单据，而它自己也只看到自己那一份——
 * 报销/付款申请页就表现为「负责人看不到其他人申请的记录」。
 *
 * 解析顺序（越靠前越权威）：
 * 1. JWT 里的 owner 声明（服务端 resolveOwner 沿 parentAccount 链追溯到真正的主账号）
 * 2. 本地 registeredUsers 的 parentAccount 链
 * 3. localStorage.parentAccount（登录时写入的一级父账号）
 * 都不可用时退回当前用户名（与历史行为一致，不会把主账号判成子账号）。
 */
import { API_BASE } from './apiBase';

const TOKEN_KEY = 'token';

export const getSessionUsername = (): string => {
  try { return localStorage.getItem('username') || ''; } catch { return ''; }
};

const safeGet = (key: string): string => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};

const safeSet = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* 配额满时忽略：不影响本次会话 */ }
};

const readRegisteredUsers = (): any[] => {
  try {
    const list = JSON.parse(safeGet('registeredUsers') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 沿 parentAccount 链追溯到真正的主账号（链上有环/账号缺失时停在当前节点） */
export const accountRootOf = (users: any[], username: string): string => {
  if (!username) return '';
  const byName = new Map<string, any>();
  users.forEach((u: any) => { if (u && u.username) byName.set(String(u.username), u); });
  const start = byName.get(username);
  if (!start || !start.isSubAccount) return username;
  let cur = String(start.parentAccount || '');
  const visited = new Set<string>([username]);
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const parent = byName.get(cur);
    if (!parent || !parent.isSubAccount) return cur;
    cur = String(parent.parentAccount || '');
  }
  return cur || start.parentAccount || username;
};

/** 读取 JWT 声明（不校验签名：只读取服务端已签发的内容，用户名对不上则整体作废） */
export const readTokenClaims = (token?: string): { username: string; owner: string } | null => {
  try {
    const tk = token !== undefined ? token : safeGet(TOKEN_KEY);
    const part = String(tk || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    let json = '';
    try {
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      json = new TextDecoder('utf-8').decode(bytes);
    } catch {
      json = decodeURIComponent(Array.prototype.map.call(bin, (c: string) =>
        `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`).join(''));
    }
    const payload = JSON.parse(json);
    return {
      username: String(payload?.username || ''),
      owner: String(payload?.owner || ''),
    };
  } catch { return null; }
};

/** 令牌里登记的主账号；令牌不属于该账号（切换账号后残留）时返回空串 */
export const readOwnerFromToken = (token: string, username: string): string => {
  const claims = readTokenClaims(token);
  if (!claims || !claims.username || !claims.owner) return '';
  if (username && claims.username !== username) return '';
  return claims.owner;
};

/** 仅本地可判定的归属账号（不回源服务端）：本会话服务端确认值 → JWT 声明 → parentAccount 链 → 当前用户名。
 *  记忆化：页面渲染期会高频调用（含 brandAuth 委托），令牌/账号/服务端确认不变时直接复用上次结果 */
let ownerCache: { sig: string; owner: string } | null = null;
/** 本会话经 /auth/me 服务端重算确认的归属（优先级高于本地令牌：
 *  令牌可能是子账号绑定父账号之前签发的陈旧令牌，owner=自己） */
let serverConfirmedOwner: { username: string; owner: string } | null = null;
export const getSessionOwner = (): string => {
  const me = getSessionUsername();
  if (!me) return '';
  const token = safeGet(TOKEN_KEY);
  const confirmed = serverConfirmedOwner && serverConfirmedOwner.username === me ? serverConfirmedOwner.owner : '';
  const sig = `${me}|${token}|${confirmed}`;
  if (ownerCache && ownerCache.sig === sig) return ownerCache.owner;
  let owner = confirmed;
  if (!owner) owner = readOwnerFromToken(token, me);
  if (!owner) {
    const root = accountRootOf(readRegisteredUsers(), me);
    owner = root || me;
  }
  ownerCache = { sig, owner };
  return owner;
};

/** 本企业成员清单：owner 自身 + 名下全部子账号（错桶修复遍历来源键用） */
export const tenantMembersOf = (owner: string): string[] => {
  if (!owner) return [];
  const users = readRegisteredUsers();
  const out = new Set<string>([owner]);
  users.forEach((u: any) => {
    if (!u || !u.username) return;
    if (accountRootOf(users, String(u.username)) === owner) out.add(String(u.username));
  });
  return Array.from(out);
};

/** 向服务端确认归属账号（历史令牌没有 owner 声明时兜底，4 秒超时） */
const fetchOwnerFromServer = async (): Promise<string> => {
  try {
    const token = safeGet(TOKEN_KEY);
    if (!token) return '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      if (!res.ok) return '';
      const j = await res.json().catch(() => null);
      const owner = String(j?.data?.owner || '');
      const username = String(j?.data?.username || '');
      return owner && (!username || username === getSessionUsername()) ? owner : '';
    } finally {
      clearTimeout(timer);
    }
  } catch { return ''; }
};

/**
 * 用服务端口径校正本地会话的 isSubAccount / parentAccount（幂等）。
 * 登录后、应用启动时各调用一次，确保后续所有页面的 getDataOwner() 命中企业主桶。
 * 返回校正后的归属账号。
 *
 * 服务端重算优先于本地令牌：/auth/me 的 owner 由服务端沿 registeredUsers 重算，
 * 而本地令牌可能是「子账号绑定父账号之前」签发的陈旧令牌（owner=自己）——
 * 若信任令牌会把子账号钉死成主账号整整一个有效期（7 天），期间订单/报销
 * 全部写进个人桶，主账号永远看不到（本次「子账号有订单主账号没有」的根因）。
 */
export const syncOwnerFromToken = async (): Promise<string> => {
  const me = getSessionUsername();
  if (!me) return '';
  const fromServer = await fetchOwnerFromServer();
  const fromToken = readOwnerFromToken(safeGet(TOKEN_KEY), me);
  const owner = fromServer || fromToken;
  if (fromServer) serverConfirmedOwner = { username: me, owner: fromServer };
  if (owner) {
    safeSet('isSubAccount', owner === me ? 'false' : 'true');
    safeSet('parentAccount', owner === me ? '' : owner);
    ownerCache = null; // 会话字段已校正：作废记忆化结果
    return owner;
  }
  return getSessionOwner();
};

/**
 * 把历史上误写入「子账号自己名下」的数据集并回企业主桶（幂等）。
 *
 * 只处理本企业成员的键（同租户），不会碰其他企业的数据；
 * 主桶已有的行优先（stranded 里的旧状态副本丢弃），迁移后清空 stranded 键并申报删除，
 * 避免服务端「永不缩水」并集把清空后的行复活。
 */
export const mergeStrandedTenantDataset = (
  canonicalKey: string,
  keyPrefix: string,
  deps: {
    safeSetItem: (key: string, value: string) => void;
    declareShrink: (key: string, removedIds: string[]) => void;
    flush: (key: string, json: string) => void;
  }
): boolean => {
  const owner = getSessionOwner();
  if (!owner) return false;
  const users = readRegisteredUsers();
  const members = new Set<string>([owner]);
  users.forEach((u: any) => {
    if (!u || !u.username) return;
    if (accountRootOf(users, String(u.username)) === owner) members.add(String(u.username));
  });
  const strandedKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(keyPrefix) || k === canonicalKey || k.endsWith('_ts')) continue;
      if (members.has(k.slice(keyPrefix.length))) strandedKeys.push(k);
    }
  } catch { return false; }
  if (strandedKeys.length === 0) return false;

  const parse = (key: string): any[] => {
    try {
      const list = JSON.parse(safeGet(key) || '[]');
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  };
  const idOf = (r: any): string => (r && (r.key || r.id)) ? String(r.key || r.id) : '';

  const merged = new Map<string, any>();
  parse(canonicalKey).forEach(r => { const id = idOf(r); if (id) merged.set(id, r); });
  const movedKeys = new Map<string, string[]>();
  let added = 0;
  strandedKeys.forEach(k => {
    const ids: string[] = [];
    parse(k).forEach(r => {
      const id = idOf(r);
      if (!id) return;
      ids.push(id);
      if (!merged.has(id)) { merged.set(id, r); added++; }
    });
    if (ids.length > 0) movedKeys.set(k, ids);
  });
  if (added === 0 && movedKeys.size === 0) return false;

  // 先落主桶并上传，再清空 stranded 键：即使上传失败，本地主桶仍持有全部行，由补传队列兜底
  if (added > 0) {
    const json = JSON.stringify(Array.from(merged.values()));
    deps.safeSetItem(canonicalKey, json);
    deps.flush(canonicalKey, json);
  }
  movedKeys.forEach((ids, k) => {
    deps.declareShrink(k, ids);
    deps.safeSetItem(k, '[]');
    deps.flush(k, '[]');
  });
  return true;
};
