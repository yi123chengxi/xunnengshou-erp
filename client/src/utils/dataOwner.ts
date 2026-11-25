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
import { isRowRemoved } from './shrinkRegistry';

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

/** 公司身份键：主账号行带 companyNo（子账号行通常为空）。
 *  同一家公司重复注册会得到不同 companyNo（真实数据：瑞安市莱库鞋业有限公司有
 *  yichengxi / yichengxi888 / yichengxi1101 三个互不隶属的主账号），
 *  因此「同为公司名」不代表同租户，只有身份键相等才代表同租户 */
const companyIdentityOf = (u: any): string => String((u && (u.companyNo || u.companyId)) || '').trim();

/** 两条账号行是否可能属于同一租户：身份键未知（历史子账号行不带编号）时保守放行，
 *  双方都带编号且不同 ⇒ 必然不同租户 */
export const sameTenantCompany = (a: any, b: any): boolean => {
  const ia = companyIdentityOf(a);
  const ib = companyIdentityOf(b);
  return !ia || !ib || ia === ib;
};

/** 沿 parentAccount 链追溯到真正的主账号（链上有环/账号缺失时停在当前节点）。
 *  脏链守卫：子账号行与链上任一父账号行各自带不同 companyNo 时，该隶属关系是脏数据
 *  （陈旧本地注册表被并进来的历史绑定），以本行为界自成租户——否则脏链会让
 *  tenantMembersOf/错桶归并把别家公司的数据并进本租户桶并排空来源桶 */
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
    if (!sameTenantCompany(start, byName.get(cur))) return username;
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
/** 上次经服务端重算确认的归属账号（按用户名持久化，跨刷新/换浏览器保留） */
const OWNER_ROOT_KEY = 'ownerRoot_';
export const getSessionOwner = (): string => {
  const me = getSessionUsername();
  if (!me) return '';
  const token = safeGet(TOKEN_KEY);
  const confirmed = serverConfirmedOwner && serverConfirmedOwner.username === me ? serverConfirmedOwner.owner : '';
  // 上次服务端重算的归属（持久化）：优先级高于 JWT owner 声明，填补刷新后
  // “serverConfirmedOwner 清零、/auth/me 尚未返回、令牌 owner 又是陈旧本人”的启动窗口——
  // 否则子账号在该窗口会退化成本人 username，读写 reimbursement_<子账号> 错桶键
  // （表现为同一条数据跨刷新时反复出现/消失）。ownerCache 每次刷新都是新 JS 上下文里的
  // null，首调即重算并命中该持久化值，从第一次渲染起就读对桶。
  const persisted = confirmed || safeGet(OWNER_ROOT_KEY + me);
  const sig = `${me}|${token}|${persisted}`;
  if (ownerCache && ownerCache.sig === sig) return ownerCache.owner;
  let owner = persisted;
  if (!owner) owner = readOwnerFromToken(token, me);
  // 刷新关键路径：serverConfirmedOwner（内存）已重置、/auth/me 尚未返回、令牌又缺少/陈旧 owner 声明时，
  // 必须回落到登录时持久化的 parentAccount 提示，否则子账号会被判成主账号（owner=自己），
  // 页面据此读写 reimbursement_<子账号> 等错桶键——表现为「刷新后数据消失，归属校正后又自动出现」。
  // 与 serverSync.currentOwner 同口径，保证「页面写出的键」与「同步层上传/拉取的键」始终一致。
  if (!owner && safeGet('isSubAccount') === 'true') owner = safeGet('parentAccount');
  if (!owner) {
    const root = accountRootOf(readRegisteredUsers(), me);
    owner = root || me;
  }
  // 自愈回写：全站仍有数十个页面各自用「全局 isSubAccount / parentAccount」推导桶名，
  // 这两个字段不按账号隔离，切换账号后残留的上家值会让页面直接读写别家公司的桶。
  // 统一口径每解析出一归属就同步一次，使旧读法天然跟随正确值（仅写会话字段，
  // ownerRoot_* 仍只落服务端确认值，避免本地推断被钉成启动窗口的权威来源）
  const wantSub = owner && owner !== me ? 'true' : 'false';
  const wantParent = owner && owner !== me ? owner : '';
  if (owner && (safeGet('isSubAccount') !== wantSub || safeGet('parentAccount') !== wantParent)) {
    safeSet('isSubAccount', wantSub);
    safeSet('parentAccount', wantParent);
  }
  ownerCache = { sig, owner };
  return owner;
};

/** 依据给定注册表解析 owner 名下成员（含 owner 自身），带跨公司身份键守卫 */
const membersFromRegistry = (users: any[], owner: string): string[] => {
  if (!owner) return [];
  const byName = new Map<string, any>();
  users.forEach((u: any) => { if (u && u.username) byName.set(String(u.username), u); });
  const ownerRow = byName.get(owner);
  const out = new Set<string>([owner]);
  users.forEach((u: any) => {
    if (!u || !u.username) return;
    const name = String(u.username);
    if (name === owner) return;
    if (accountRootOf(users, name) !== owner) return;
    if (!sameTenantCompany(ownerRow, u)) return;
    out.add(name);
  });
  return Array.from(out);
};

/** 本企业成员清单：owner 自身 + 名下全部子账号（错桶修复遍历来源键用） */
export const tenantMembersOf = (owner: string): string[] => membersFromRegistry(readRegisteredUsers(), owner);

// ============ 服务端权威注册表 ============
// 破坏性归并（把别的桶并进主桶并排空来源桶）绝不能依据本机那份可能陈旧/被污染的
// registeredUsers 判定成员：历史事故中一份脏隶属就让 A 公司的订单被并进 B 公司桶、
// 同时清空 A 公司桶。registeredUsers 是公开只读键，取服务端那份作唯一权威依据；
// 取不到时调用方必须放弃归并（归只是体验优化，不是正确性前提）。
let authRegistryCache: { at: number; users: any[] } | null = null;

export const fetchAuthoritativeRegistry = async (maxAgeMs = 5 * 60_000): Promise<any[] | null> => {
  if (authRegistryCache && Date.now() - authRegistryCache.at < maxAgeMs) return authRegistryCache.users;
  try {
    const token = safeGet(TOKEN_KEY);
    const res = await fetch(`${API_BASE}/sync/dataset?key=registeredUsers`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return authRegistryCache ? authRegistryCache.users : null;
    const j = await res.json().catch(() => null);
    let arr: any = Array.isArray(j) ? j : j?.json;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
    if (!Array.isArray(arr)) return authRegistryCache ? authRegistryCache.users : null;
    authRegistryCache = { at: Date.now(), users: arr };
    return arr;
  } catch {
    return authRegistryCache ? authRegistryCache.users : null;
  }
};

/** 以服务端权威注册表解析企业主成员；返回 null 表示无法确认（调用方应跳过破坏性归并） */
export const authoritativeTenantMembers = async (owner: string): Promise<string[] | null> => {
  if (!owner) return null;
  const users = await fetchAuthoritativeRegistry();
  if (!users) return null;
  const byName = new Map<string, any>();
  users.forEach((u: any) => { if (u && u.username) byName.set(String(u.username), u); });
  if (!byName.has(owner)) return null; // 本账号都不在服务端注册表里：无法可信地进归并
  return membersFromRegistry(users, owner);
};

/** 向服务端确认归属账号（历史令牌没有 owner 声明时兜底，1.5 秒超时：
 *  刷新关键路径上不应为一次校正空等过久，超时后回退令牌/本地链） */
const fetchOwnerFromServer = async (): Promise<string> => {
  try {
    const token = safeGet(TOKEN_KEY);
    if (!token) return '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
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
  if (fromServer) {
    serverConfirmedOwner = { username: me, owner: fromServer };
    // 持久化“上次服务端重算归属”，供下次刷新在 /auth/me 未返回的启动窗口直接命中正确归属，
    // 消除 owner 临时翻转造成的错桶读写（只落服务端确认值，不落可能陈旧的令牌值）
    safeSet(OWNER_ROOT_KEY + me, fromServer);
  }
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
  const members = new Set<string>(tenantMembersOf(owner));
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
  // 主桶已申报删除的行（含持久墓碑）不从错桶并回：错桶副本是子账号误写期间的旧状态，
  // 把主桶里已被用户删掉的行重新塞回去会让删除复活（银行账户删了刷新又出现的一条通路）
  strandedKeys.forEach(k => {
    const ids: string[] = [];
    parse(k).forEach(r => {
      const id = idOf(r);
      if (!id) return;
      ids.push(id);
      if (merged.has(id)) return;
      if (isRowRemoved(canonicalKey, r)) return;
      merged.set(id, r); added++;
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
