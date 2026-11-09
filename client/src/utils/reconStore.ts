/**
 * 对账记录分平台独立存储（供应商平台 / 采购商平台各自独立"数据库"）。
 *
 * - recon_db_supplier_<username>：该账号以【供应商】身份参与的对账记录
 *   （自己发起的、或采购商发起的），为供应商平台对账管理的唯一数据源；
 * - recon_db_purchaser_<username>：该账号以【采购商】身份参与的对账记录
 *   （供应商发起的、或自己发起的），为采购商平台对账管理的唯一数据源。
 *
 * 两个键均为全局同步键（跨浏览器/跨租户同步）：任一端写入后，对方浏览器经
 * serverSync 拉取即可见；写入统一走 upsertRecords（按记录 key 覆盖、墓碑优先），
 * 只更新涉及的记录，不会抹掉键内其他对手方的记录，也不会复活已墓碑记录。
 *
 * 旧全局键 recon_records 仅作为存量迁移来源（migrateLegacyReconRecords 幂等迁移），
 * 迁移后所有读写均以分平台键为准。
 */

/** 分平台对账库键名 */
export const reconDbKey = (role: 'supplier' | 'purchaser', username: string): string =>
  `recon_db_${role}_${String(username || '').trim()}`;

const readUsers = (): any[] => {
  try {
    const u = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return Array.isArray(u) ? u : [];
  } catch { return []; }
};

/** 按公司全称/简称/编号反查注册账号 */
const userByCompany = (users: any[], name: string): any => {
  const n = String(name || '').trim();
  if (!n) return null;
  return users.find((u: any) => u && (
    String(u.companyName || '').trim() === n ||
    String(u.companyShortName || '').trim() === n ||
    String(u.companyNo || '').trim() === n)) || null;
};

/** 解析一条对账记录归属的两个分平台库（供应商侧账号 / 采购商侧账号） */
export const resolveRecordSides = (r: any): { sup: string; pur: string } => {
  if (!r || typeof r !== 'object') return { sup: '', pur: '' };
  const users = readUsers();
  let sup = String(r.supplierUsername || '').trim();
  if (!sup) sup = userByCompany(users, r.supplierName)?.username || '';
  let pur = String(r.customerUsername || '').trim();
  if (!pur) pur = userByCompany(users, r.customerName)?.username || '';
  if (!pur && r.customerNo) pur = userByCompany(users, r.customerNo)?.username || '';
  return { sup, pur };
};

/** 读取某账号某平台库的全量记录（含墓碑） */
export const loadRoleAll = (role: 'supplier' | 'purchaser', username: string): any[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(reconDbKey(role, username)) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

/** 读取某账号某平台库的存活记录（不含墓碑） */
export const loadRoleRecords = (role: 'supplier' | 'purchaser', username: string): any[] =>
  loadRoleAll(role, username).filter((r: any) => r && !r.delisted);

/**
 * 把记录写入其归属的分平台库（供应商侧 + 采购商侧同时落库，保证双端可见）。
 * 墓碑优先：库内已有同 key 墓碑时，存活版本不得复活它。
 */
export const upsertRecords = (records: any[]): void => {
  if (!Array.isArray(records) || records.length === 0) return;
  const plan = new Map<string, any[]>();
  records.forEach((r: any) => {
    if (!r || typeof r !== 'object' || !r.key) return;
    const { sup, pur } = resolveRecordSides(r);
    const put = (dbName: string) => {
      if (!dbName) return;
      const list = plan.get(dbName);
      if (list) list.push(r); else plan.set(dbName, [r]);
    };
    if (sup) put(reconDbKey('supplier', sup));
    if (pur) put(reconDbKey('purchaser', pur));
  });
  plan.forEach((incoming, dbName) => {
    let existing: any[] = [];
    try { existing = JSON.parse(localStorage.getItem(dbName) || '[]'); } catch { existing = []; }
    if (!Array.isArray(existing)) existing = [];
    const map = new Map<string, any>();
    existing.forEach((r: any) => { if (r && r.key) map.set(r.key, r); });
    let changed = false;
    incoming.forEach((inc: any) => {
      const ex = map.get(inc.key);
      // 墓碑优先：库内已完成的记录不被旧端存活版本复活
      if (ex && ex.delisted === true && inc.delisted !== true) return;
      if (ex && JSON.stringify(ex) === JSON.stringify(inc)) return;
      map.set(inc.key, inc);
      changed = true;
    });
    if (!changed) return;
    // 顺序：本次写入的记录置顶（与历史 unshift 语义一致），其余保持原顺序
    const seen = new Set<string>();
    const out: any[] = [];
    incoming.forEach((inc: any) => {
      if (seen.has(inc.key)) return;
      const cur = map.get(inc.key);
      if (cur) { out.push(cur); seen.add(inc.key); }
    });
    existing.forEach((r: any) => {
      const k = r && r.key;
      if (!k || seen.has(k)) return;
      const cur = map.get(k);
      if (cur) { out.push(cur); seen.add(k); }
    });
    try { localStorage.setItem(dbName, JSON.stringify(out)); } catch { /* ignore */ }
  });
};

/** 存量迁移：旧全局键 recon_records 的记录幂等迁入分平台库（墓碑优先，可重复执行） */
export const migrateLegacyReconRecords = (): void => {
  let legacy: any[] = [];
  try { legacy = JSON.parse(localStorage.getItem('recon_records') || '[]'); } catch { return; }
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  upsertRecords(legacy);
};

/** 本机全部对账库键（recon_db_* + 旧键）记录的并集（同 key 墓碑优先），供自愈/名称同步扫描 */
export const loadAllReconRecordsUnion = (): any[] => {
  const seen = new Map<string, any>();
  const push = (r: any) => {
    if (!r || !r.key) return;
    const ex = seen.get(r.key);
    if (!ex || (ex.delisted !== true && r.delisted === true)) seen.set(r.key, r);
  };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || (k !== 'recon_records' && k.indexOf('recon_db_') !== 0)) continue;
    let arr: any[] = [];
    try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch { continue; }
    if (Array.isArray(arr)) arr.forEach(push);
  }
  return Array.from(seen.values());
};
