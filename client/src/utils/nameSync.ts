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
const NAME_FIELDS = ['customerName', 'supplierName', 'purchaserName', 'applicantCompany', 'counterparty', 'supplier', 'customer', 'companyName'];

// 需要名称同步的数据集（合作方镜像卡片 / 客户档案 / 双端账单 / 订单 / 开票 / 营业执照 / 对账记录）
const SWEEP_PREFIXES = [
  'purchaser_suppliers_', 'boundPurchasers_', 'customers_', 'purchaser_bills_',
  'pageData_customer_bill-detail_', 'pageData_sales_order-manage_',
  'invoice_record_', 'invoice_apply_requests_', 'business_license_',
];
const SWEEP_EXACT = ['recon_records'];

/** 全量名称同步修复：改名链改写 + 账号名快照修正 + 关联账号信息刷新 */
export const repairCounterpartyNames = (): void => {
  try {
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
    if (!Array.isArray(users) || !users.length) return;
    const u2c = new Map<string, any>();
    users.forEach(u => { if (u && u.username) u2c.set(String(u.username), u); });

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
          if (key.startsWith('customers_')) {
            if (pu.legalPerson && nr.legalPerson !== pu.legalPerson) { nr.legalPerson = pu.legalPerson; rc = true; }
            if (pu.businessAddress && nr.businessAddress !== pu.businessAddress) { nr.businessAddress = pu.businessAddress; rc = true; }
            if (pu.wechatQr && nr.wechatQr !== pu.wechatQr) { nr.wechatQr = pu.wechatQr; rc = true; }
          }
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
  } catch { /* ignore */ }
};
