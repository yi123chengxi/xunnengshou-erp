/**
 * 合作申请跨租户凭证工具
 *
 * 背景：cooperation_applications 是全局共享键（serverSync 里 keyOwner 返回 null，服务端按 id 并集合并），
 * 也就是说所有租户的浏览器里都持有同一份申请记录，"谁能看到哪一条"完全由前端自己判定。
 * 早期判定只用公司名称模糊匹配（includes 双向），后果是：
 *   1) 同一家公司注册多个账号时，N 个账号都会看到同一份申请，而且都能点同意；
 *   2) 名称互为子串的两家公司（如「XX 公司」与「XX 公司二分厂」）也会互相串数据。
 * 注册时生成的 companyNo（8 位字母数字，去重保证唯一；老账号无该字段时以 companyShortName 回退）
 * 既不随改名变化、也不依赖账号名，适合当跨租户身份凭证，因此本链路一律改按编号等值比较。
 *
 * 约束：companyName 既不唯一也不稳定，任何"按名称找账号"都必须做歧义判定（多命中即视为未知），
 * 宁可退回名称兜底也不能 find-first 挑一个租户，否则就是把 A 的申请认成 B 的。
 */

const APPLICATIONS_KEY = 'cooperation_applications';
const SUPPLIER_LIST_PREFIX = 'purchaser_suppliers_';

/** 当前账号的数据归属者（子账号归父账号），与页面 getDataOwner 口径一致 */
export const currentOwnerName = (): string => {
  try {
    if (localStorage.getItem('isSubAccount') === 'true') {
      return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    }
  } catch { /* ignore */ }
  return localStorage.getItem('username') || '';
};

const loadUsers = (): any[] => {
  try {
    const list = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 账号 → 公司编号（老账号无 companyNo 时回退 companyShortName，两者都没有则为空） */
export const noOfUser = (u: any): string => String(u?.companyNo || u?.companyShortName || '').trim();

/** 本方公司编号（解析不到返回空串，调用方须按空串走兜底而不是放行全部） */
export const myCompanyNo = (): string => noOfUser(loadUsers().find((u: any) => String(u?.username || '') === currentOwnerName()));

/** 按账号取编号 */
export const noFromUsername = (username: string): string => {
  const un = String(username || '').trim();
  if (!un) return '';
  return noOfUser(loadUsers().find((u: any) => String(u?.username || '') === un));
};

/** 按编号取账号：编号唯一，未命中返回空串 */
export const usernameFromNo = (no: string): string => {
  const n = String(no || '').trim();
  if (!n) return '';
  const hit = loadUsers().filter((u: any) => String(u?.companyNo || '').trim() === n || noOfUser(u) === n);
  return hit.length === 1 ? String(hit[0].username) : '';
};

/** 按公司名称取编号：仅在全库唯一命中时返回，同名多账号（歧义）返回空串，交由调用方兜底 */
export const noFromCompanyName = (name: string): string => {
  const n = String(name || '').trim();
  if (!n) return '';
  const hit = loadUsers().filter((u: any) => String(u?.companyName || '').trim() === n);
  return hit.length === 1 ? noOfUser(hit[0]) : '';
};

/** 解析任意"账号名/编号/公司名"混合值为公司编号（历史字段语义分裂专用） */
const resolveNo = (v: any): string => {
  const s = String(v || '').trim();
  if (!s) return '';
  const byUser = loadUsers().find((u: any) => String(u?.username || '') === s);
  if (byUser) return noOfUser(byUser);
  // s 本身可能就是编号（含老账号简称）
  const byNo = loadUsers().filter((u: any) => String(u?.companyNo || '').trim() === s || noOfUser(u) === s);
  if (byNo.length === 1) return s;
  return noFromCompanyName(s);
};

/** 对外暴露的宽松解析：不确定字段装的是账号、编号还是公司名时使用 */
export const noFromAny = (v: any): string => resolveNo(v);

/** 记录内供应商凭证：新数据读 targetSupplierNo，历史数据从 targetSupplierId（曾写账号/编号）、supplierUsername、公司名称逐个推导 */
export const supplierNoOf = (app: any): string => {
  const direct = String(app?.targetSupplierNo || '').trim();
  if (direct) return direct;
  return resolveNo(app?.supplierUsername) || resolveNo(app?.targetSupplierId) || noFromCompanyName(app?.targetSupplierName);
};

/** 记录内采购商凭证：新数据读 purchaserNo，历史数据从 purchaserUsername、purchaserCompanyName 推导 */
export const purchaserNoOf = (app: any): string => {
  const direct = String(app?.purchaserNo || '').trim();
  if (direct) return direct;
  return resolveNo(app?.purchaserUsername) || noFromCompanyName(app?.purchaserCompanyName);
};

/** 本账号是否该记录的目标供应商（编号等值优先；编号解析不到时才按名称全等兜底，绝不做子串匹配） */
export const amTargetSupplier = (app: any): boolean => {
  const mine = myCompanyNo();
  const theirs = supplierNoOf(app);
  if (mine && theirs) return theirs === mine;
  if (String(app?.targetSupplierName || '').trim() === '待供应商确认') return true;
  // 无任何可解析编号的历史记录：保持旧行为里"名称全等"这一档，放宽到子串就会重演串号问题
  const myName = String(loadUsers().find((u: any) => String(u?.username || '') === currentOwnerName())?.companyName || '').trim();
  return !!myName && !!app?.targetSupplierName && String(app.targetSupplierName).trim() === myName;
};

/** 本账号是否该记录的发起采购商：账号等值优先（采购商侧列表本就按账号分区），编号仅作历史无账号记录的兜底 */
export const amPurchaserOf = (app: any): boolean => {
  const owner = currentOwnerName();
  if (owner && String(app?.purchaserUsername || '') === owner) return true;
  const mine = myCompanyNo();
  return !!mine && purchaserNoOf(app) === mine;
};

/**
 * 判断某条申请是否指向"指定的那家供应商"（显式传参版）。
 * 页面里有些判定是在模块级函数中做的，归属者来自 getDataOwner() 而非当前登录态，
 * 不能复用 amTargetSupplier，因此这里把 owner / company / no 三个入参都交出去。
 * 优先级：供应商账号等值 > 公司编号等值 > 公司名全等（仅在两者都拿不到时兜底）。
 */
export const isTargetSupplierApp = (app: any, opts: { owner?: string; company?: string; no?: string } = {}): boolean => {
  const owner = String(opts.owner || '').trim();
  if (owner && String(app?.supplierUsername || '').trim() === owner) return true;
  const mine = String(opts.no || '').trim();
  const theirs = supplierNoOf(app);
  if (mine && theirs) return theirs === mine;
  const company = String(opts.company || '').trim();
  return !!company && String(app?.targetSupplierName || '').trim() === company;
};

/**
 * 合作申请是否指向采购商本地供应商列表里的某一条目。
 * 列表条目的 supplierName / 申请的 targetSupplierName 都可能重名或改名，因此仍以供应商编号等值优先，
 * 编号缺失才退回条目 id（历史 targetSupplierId 存的就是条目 id），最后才是公司名全等。
 */
export const appMatchesSupplierEntry = (app: any, entry: any): boolean => {
  const entryNo = String(entry?.supplierNo || '').trim()
    || noFromUsername(entry?.supplierUsername)
    || noFromCompanyName(entry?.supplierName);
  const appNo = String(app?.targetSupplierNo || '').trim() || supplierNoOf(app);
  if (entryNo && appNo) return appNo === entryNo;
  const eid = String(entry?.id || '').trim();
  if (eid && (String(app?.purchaserSupplierEntryId || '').trim() === eid || String(app?.targetSupplierId || '').trim() === eid)) return true;
  const en = String(entry?.supplierName || '').trim();
  return !!en && String(app?.targetSupplierName || '').trim() === en;
};

/** 目标供应商账号：优先记录内显式值，缺失时按编号本地解析（供跨租户分区键投递使用，避免直接拼语义分裂的 targetSupplierId） */
export const supplierUsernameOf = (app: any): string => {
  const explicit = String(app?.supplierUsername || '').trim();
  if (explicit && loadUsers().some((u: any) => String(u?.username || '') === explicit)) return explicit;
  const byId = String(app?.targetSupplierId || '').trim();
  if (byId && loadUsers().some((u: any) => String(u?.username || '') === byId)) return byId;
  return usernameFromNo(supplierNoOf(app));
};

/** 发起采购商账号：优先显式值，缺失时按编号解析 */
export const purchaserUsernameOf = (app: any): string => {
  const explicit = String(app?.purchaserUsername || '').trim();
  if (explicit) return explicit;
  return usernameFromNo(purchaserNoOf(app));
};

/**
 * 写入点统一补凭证：给一条申请记录补齐 targetSupplierNo / purchaserNo（只填空缺，不覆盖已有值）。
 * 编号来源：调用方显式传入 > 记录内账号/名称推导。
 */
export const withCooperationCreds = <T extends Record<string, any>>(app: T, hints?: { supplierNo?: string; purchaserNo?: string }): T => {
  const out: Record<string, any> = { ...app };
  if (!String(out.targetSupplierNo || '').trim()) {
    out.targetSupplierNo = String(hints?.supplierNo || '').trim()
      || resolveNo(out.supplierUsername) || resolveNo(out.targetSupplierId) || noFromCompanyName(out.targetSupplierName);
  }
  if (!String(out.purchaserNo || '').trim()) {
    out.purchaserNo = String(hints?.purchaserNo || '').trim()
      || resolveNo(out.purchaserUsername) || noFromCompanyName(out.purchaserCompanyName);
  }
  return out as T;
};

/** 从采购商自己的供应商列表条目里取该供应商编号（历史记录的 targetSupplierId 存的是条目 id，只能这样回捞） */
const supplierNoFromEntry = (purchaserUsername: string, entryId: string): string => {
  const pu = String(purchaserUsername || '').trim();
  const eid = String(entryId || '').trim();
  if (!pu || !eid) return '';
  try {
    const list = JSON.parse(localStorage.getItem(SUPPLIER_LIST_PREFIX + pu) || '[]');
    if (!Array.isArray(list)) return '';
    const hit = list.find((s: any) => String(s?.id || '') === eid);
    if (!hit) return '';
    return String(hit.supplierNo || '').trim() || resolveNo(hit.supplierUsername) || noFromCompanyName(hit.supplierName);
  } catch { return ''; }
};

/**
 * 存量数据一次性补凭证（幂等，只填空缺字段）。
 * 解析不到的保持为空 —— 这类记录继续按名称全等兜底可见，不做猜测式归户。
 */
export const migrateCooperationCreds = (): void => {
  try {
    const apps = JSON.parse(localStorage.getItem(APPLICATIONS_KEY) || '[]');
    if (!Array.isArray(apps) || !apps.length) return;
    let changed = 0;
    apps.forEach((a: any) => {
      if (!a || typeof a !== 'object') return;
      if (!String(a.targetSupplierNo || '').trim()) {
        const no = resolveNo(a.supplierUsername)
          || supplierNoFromEntry(a.purchaserUsername, a.targetSupplierId)
          || supplierNoFromEntry(a.purchaserUsername, a.purchaserSupplierEntryId)
          || resolveNo(a.targetSupplierId)
          || noFromCompanyName(a.targetSupplierName);
        if (no) { a.targetSupplierNo = no; changed++; }
      }
      if (!String(a.purchaserNo || '').trim()) {
        const no = resolveNo(a.purchaserUsername) || noFromCompanyName(a.purchaserCompanyName);
        if (no) { a.purchaserNo = no; changed++; }
      }
    });
    if (changed) localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(apps));
  } catch { /* ignore */ }
};

let migratedOnce = false;
/** 页面加载入口用：每次会话最多补写一次，避免在列表 render/轮询里反复整键重写 */
export const ensureCredsMigrated = (): void => {
  if (migratedOnce) return;
  migratedOnce = true;
  migrateCooperationCreds();
};
