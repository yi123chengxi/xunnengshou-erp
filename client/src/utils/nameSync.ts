/**
 * 合作方公司名称变更传播与关联数据名称同步
 *
 * - recordCompanyRename：公司名称变更时追加全局改名记录（company_renames，跨浏览器同步），
 *   供各端把历史快照中的旧名称批量改写为新名称，避免改名后账单/对账/客户档案等数据联动断裂；
 * - repairCounterpartyNames：以 registeredUsers（全局同步键）为唯一可信来源，
 *   ① 按改名记录链（旧→新）改写各业务数据集内的名称快照字段；
 *   ② 把历史误存为账号名的名称快照修正为公司名称；
 *   ③ 按 supplierUsername / purchaserUsername 关联刷新合作卡片与客户档案的公司名称、联系人、电话、编号、法人、地址、微信码等信息；
 *   触发点：serverSync.pullAllDatasets 轮询、企业信息保存改名、企业认证通过回写公司名之后。
 */

const RENAME_KEY = 'company_renames';

export interface CompanyRename {
  key: string;
  username: string;
  oldName: string;
  newName: string;
  ts: number;
}

/** 记录一次公司名称变更（全局键，跨浏览器同步；同旧→新去重） */
export const recordCompanyRename = (username: string, oldName: string, newName: string): void => {
  const on = String(oldName || '').trim();
  const nn = String(newName || '').trim();
  if (!username || !on || !nn || on === nn) return;
  let list: CompanyRename[] = [];
  try { list = JSON.parse(localStorage.getItem(RENAME_KEY) || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (list.some(r => r && r.username === username && r.oldName === on && r.newName === nn)) return;
  list.push({ key: `${username}-${Date.now()}`, username, oldName: on, newName: nn, ts: Date.now() });
  try { localStorage.setItem(RENAME_KEY, JSON.stringify(list)); } catch { /* ignore */ }
};

// 业务数据集中的名称快照字段（按对手方/本公司公司名存储，改名时需同步改写）
const NAME_FIELDS = ['customerName', 'supplierName', 'purchaserName', 'applicantCompany', 'counterparty', 'supplier', 'customer', 'companyName', 'purchaserCompanyName', 'targetSupplierName'];

// 需要名称同步的数据集（合作方镜像卡片 / 客户档案 / 双端账单 / 订单 / 开票 / 营业执照 / 对账记录）
const SWEEP_PREFIXES = [
  'purchaser_suppliers_', 'boundPurchasers_', 'customers_', 'purchaser_bills_',
  'pageData_customer_bill-detail_', 'pageData_sales_order-manage_',
  'invoice_record_', 'invoice_apply_requests_', 'business_license_',
];
const SWEEP_EXACT = ['recon_records'];

/**
 * 解析某公司名称/账号的最新公司名称（注册账号表为唯一真源，其次按改名链归一取链尾）。
 * 用于列表展示：即使本地镜像/账单快照仍是旧名，也能显示改名后的公司全称。
 */
export const resolveLatestCompanyName = (name: string, username?: string): string => {
  const n = String(name || '').trim();
  const un = String(username || '').trim();
  let users: any[] = [];
  try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
  if (!Array.isArray(users)) users = [];
  let u = un ? users.find(x => x && x.username === un) : null;
  if (!u && n) {
    u = users.find(x => x && ((x.companyName || '').trim() === n || (x.companyShortName || '').trim() === n || (x.companyNo || '').trim() === n));
  }
  if (u && u.companyName) return String(u.companyName);
  let renames: any[] = [];
  try { renames = JSON.parse(localStorage.getItem(RENAME_KEY) || '[]'); } catch { renames = []; }
  const chain = new Map<string, string>();
  (Array.isArray(renames) ? renames : []).slice().sort((a, b) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0)).forEach(r => {
    const on = String(r?.oldName || '').trim();
    const nn = String(r?.newName || '').trim();
    if (!on || !nn || on === nn) return;
    chain.forEach((v, k) => { if (v === on) chain.set(k, nn); });
    chain.set(on, nn);
  });
  let t = n;
  let g = 0;
  while (chain.has(t) && g++ < 10) t = chain.get(t) as string;
  return t || n;
};

/** 全量名称同步修复：改名链改写 + 账号名快照修正 + 关联账号信息刷新；返回被改写的键 */
export const repairCounterpartyNames = (): string[] => {
  try {
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
    if (!Array.isArray(users) || !users.length) return [];
    const u2c = new Map<string, any>();
    users.forEach(u => { if (u && u.username) u2c.set(String(u.username), u); });
    // 名称/编号 → 账号 反查表（公司全称为准，兼容简称与编号）
    const name2u = new Map<string, any>();
    users.forEach(u => {
      if (!u) return;
      if (u.companyName) name2u.set(String(u.companyName), u);
      if (u.companyShortName) name2u.set(String(u.companyShortName), u);
      if (u.companyNo) name2u.set(String(u.companyNo), u);
    });

    // 改名链：按时间序折叠（A→B→C 折叠为 A→C、B→C）
    let renames: CompanyRename[] = [];
    try { renames = JSON.parse(localStorage.getItem(RENAME_KEY) || '[]'); } catch { renames = []; }
    const chain = new Map<string, string>();
    (Array.isArray(renames) ? renames : []).slice().sort((a, b) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0)).forEach(r => {
      const on = String(r?.oldName || '').trim();
      const nn = String(r?.newName || '').trim();
      if (!on || !nn || on === nn) return;
      chain.forEach((v, k) => { if (v === on) chain.set(k, nn); });
      chain.set(on, nn);
    });

    // 名称修正：命中改名链取最新名；历史误存账号名的按账号反查公司名
    const fix = (v: any): any => {
      if (typeof v !== 'string' || !v) return v;
      if (chain.has(v)) return chain.get(v);
      const u = u2c.get(v);
      if (u && u.companyName && u.companyName !== v) return u.companyName;
      return v;
    };
    // 按名称（含改名链）反查账号：名称快照 → 唯一凭证（账号/公司编号）
    const latestName = (n: string): string => {
      let t = String(n || '').trim();
      let guard = 0;
      while (chain.has(t) && guard++ < 10) t = chain.get(t) as string;
      return t;
    };
    const resolveUserByName = (n: string): any => {
      const t = String(n || '').trim();
      if (!t) return null;
      return name2u.get(t)
        || (chain.has(t) ? name2u.get(chain.get(t) as string) : null)
        // 反向兼容：快照已是新名、但账号里仍是旧名（另一端未刷新）时，按改名链归一后反查
        || users.find(u => u && u.companyName && latestName(u.companyName) === latestName(t))
        || null;
    };

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (SWEEP_EXACT.includes(k) || SWEEP_PREFIXES.some(p => k.startsWith(p))) keys.push(k);
    }
    const changed = new Set<string>();
    keys.forEach(key => {
      let list: any[] = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return; }
      if (!Array.isArray(list)) return;
      let ch = false;
      const next = list.map(rec => {
        if (!rec || typeof rec !== 'object') return rec;
        const nr: any = { ...rec };
        let rc = false;
        NAME_FIELDS.forEach(f => { const nv = fix(nr[f]); if (nv !== nr[f]) { nr[f] = nv; rc = true; } });
        // 合作凭证回填：仅存名称快照的历史记录按名称（含改名链）反查账号，
        // 补 purchaserUsername/supplierUsername/customerUsername + 公司编号，后续联动一律以凭证为准、不受改名影响
        const keyOwnerM = key.match(/^(?:purchaser_bills|pageData_customer_bill-detail|boundPurchasers|purchaser_suppliers)_(.+)$/);
        const keyOwner = keyOwnerM ? keyOwnerM[1] : '';
        if (!nr.purchaserUsername && typeof nr.purchaserName === 'string' && nr.purchaserName) {
          const u = resolveUserByName(nr.purchaserName);
          if (u && u.username !== keyOwner) { nr.purchaserUsername = u.username; if (!nr.purchaserNo && u.companyNo) nr.purchaserNo = u.companyNo; rc = true; }
        }
        if (!nr.supplierUsername && typeof nr.supplierName === 'string' && nr.supplierName) {
          const u = resolveUserByName(nr.supplierName);
          if (u && u.username !== keyOwner) { nr.supplierUsername = u.username; if (!nr.supplierNo && u.companyNo) nr.supplierNo = u.companyNo; rc = true; }
        }
        if (key.startsWith('pageData_customer_bill-detail_') && !nr.customerUsername && typeof nr.customerName === 'string' && nr.customerName) {
          const u = resolveUserByName(nr.customerName);
          if (u && u.username !== keyOwner) { nr.customerUsername = u.username; if (!nr.customerNo && u.companyNo) nr.customerNo = u.companyNo; rc = true; }
        }
        if (key.startsWith('purchaser_bills_') && !nr.supplierUsername && typeof nr.supplier === 'string' && nr.supplier) {
          const u = resolveUserByName(nr.supplier);
          if (u && u.username !== keyOwner) { nr.supplierUsername = u.username; rc = true; }
        }
        // 合作镜像卡片/客户档案：按关联账号刷新公司名称与联系信息等信息
        const su = nr.supplierUsername ? u2c.get(String(nr.supplierUsername)) : null;
        if (su) {
          if (su.companyName && nr.supplierName !== su.companyName) { nr.supplierName = su.companyName; rc = true; }
          if (su.contactPerson && nr.contactPerson !== su.contactPerson) { nr.contactPerson = su.contactPerson; rc = true; }
          if (su.phone && nr.contactPhone !== su.phone) { nr.contactPhone = su.phone; rc = true; }
          if (su.companyNo && nr.supplierNo !== su.companyNo) { nr.supplierNo = su.companyNo; rc = true; }
        }
        const pu = nr.purchaserUsername ? u2c.get(String(nr.purchaserUsername)) : null;
        if (pu) {
          if (pu.companyName && nr.purchaserName !== pu.companyName) { nr.purchaserName = pu.companyName; rc = true; }
          if (pu.companyName && key.startsWith('customers_') && nr.name !== pu.companyName) { nr.name = pu.companyName; rc = true; }
          if (pu.contactPerson && nr.purchaserContact !== pu.contactPerson) { nr.purchaserContact = pu.contactPerson; rc = true; }
          if (pu.phone && nr.purchaserPhone !== pu.phone) { nr.purchaserPhone = pu.phone; rc = true; }
          if (pu.companyNo && nr.purchaserNo !== pu.companyNo) { nr.purchaserNo = pu.companyNo; rc = true; }
          if (pu.companyName && nr.purchaserCompanyName && nr.purchaserCompanyName !== pu.companyName) { nr.purchaserCompanyName = pu.companyName; rc = true; }
          if (key.startsWith('customers_')) {
            if (pu.legalPerson && nr.legalPerson !== pu.legalPerson) { nr.legalPerson = pu.legalPerson; rc = true; }
            if (pu.businessAddress && nr.businessAddress !== pu.businessAddress) { nr.businessAddress = pu.businessAddress; rc = true; }
            if (pu.wechatQr && nr.wechatQr !== pu.wechatQr) { nr.wechatQr = pu.wechatQr; rc = true; }
          }
        }
        if (su && su.companyName && nr.targetSupplierName && nr.targetSupplierName !== su.companyName) { nr.targetSupplierName = su.companyName; rc = true; }
        // 客户名称按 customerUsername（公司编号/账号凭证）刷新：改名后账单快照与客户档案不再分叉
        const cu = nr.customerUsername ? u2c.get(String(nr.customerUsername)) : null;
        if (cu && cu.companyName && nr.customerName !== cu.companyName) { nr.customerName = cu.companyName; rc = true; }
        // 对账记录：双方名称与 counterparty 按凭证刷新（counterparty 语义=发起方的对手方）
        if (key === 'recon_records') {
          if (su && su.companyName && nr.supplierName !== su.companyName) { nr.supplierName = su.companyName; rc = true; }
          if (pu && pu.companyName && nr.customerName !== pu.companyName) { nr.customerName = pu.companyName; rc = true; }
          const cp = nr.initiator === 'purchaser' ? nr.supplierName : nr.customerName;
          if (cp && nr.counterparty !== cp) { nr.counterparty = cp; rc = true; }
        }
        if (rc) ch = true;
        return rc ? nr : rec;
      });
      if (ch) {
        try { localStorage.setItem(key, JSON.stringify(next)); changed.add(key); } catch { /* ignore */ }
      }
    });
    // 通知已挂载页面重读存储（账单/对账/客户列表立即呈现新名称）
    if (changed.size > 0) {
      try { window.dispatchEvent(new Event('sync-data-updated')); } catch { /* ignore */ }
    }
    return Array.from(changed);
  } catch { return []; }
};
