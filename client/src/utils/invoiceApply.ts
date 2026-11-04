/**
 * 进项票开票申请共享工具：申请单收件箱（供应商侧）、合作供应商解析、跨租户推送、单号生成
 * 闭环链路：申请方（营业执照列表·申请开票）→ 推送 invoice_apply_requests_<供应商账号> →
 * 供应商（财务管理·开票申请）标记已开票 → 回写申请方 invoice_record_<申请方账号>.invoiceStatus
 */
import { safeSetItem } from './storageQuota';

export interface InvoiceApplyRequest {
  key: string;            // 与 applyNo 同值，作收件箱 rowKey
  applyNo: string;        // 申请单号 KP+YYYYMMDD+3位序号
  applicantUsername: string;   // 申请方账号（数据归属者）
  applicantCompany: string;    // 申请方公司名称
  supplierName: string;        // 开票供应商名称
  projectName: string;         // 项目名称
  amount: number;              // 发票金额
  quantity: number;            // 数量
  unitPrice: number;           // 单价
  months: string[];            // 申请时所选月份范围（空=全部）
  applyDate: string;           // 申请日期 YYYY-MM-DD
  status: '待开票' | '开票成功' | '已开票'; // 开票成功=供应商点开票完成同步的专属状态；已开票=申请方手动调整
  taxRate?: number;          // 税率（小规模 1%、一般纳税人 13%）
  invoiceImage?: string;     // 供应商开票完成后上传的发票图片
  remark?: string;
}

/** 状态归一：空值归为待开票，其余原样保留（待开票/已开票/开票成功） */
export const normInvoiceStatus = (s?: string): '待开票' | '开票成功' | '已开票' => (s === '开票成功' ? '开票成功' : s === '已开票' ? '已开票' : '待开票');

/** 发票是否已开完（开票成功=供应商同步 / 已开票=申请方手动） */
export const isInvoiceDone = (s?: string): boolean => normInvoiceStatus(s) !== '待开票';

/** 供应商侧开票申请收件箱存储键 */
export const invoiceApplyInboxKey = (owner: string) => `invoice_apply_requests_${owner}`;

export const readInbox = (owner: string): InvoiceApplyRequest[] => {
  try {
    const list = JSON.parse(localStorage.getItem(invoiceApplyInboxKey(owner)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const writeInbox = (owner: string, list: InvoiceApplyRequest[]): void => {
  const json = JSON.stringify(list);
  safeSetItem(invoiceApplyInboxKey(owner), json);
  safeSetItem(`${invoiceApplyInboxKey(owner)}_ts`, String(Date.now()));
};

/** 推送/更新一条申请到供应商收件箱（同单号覆盖，避免重复推送产生重复行） */
export const upsertInboxEntry = (supplierUsername: string, entry: InvoiceApplyRequest): void => {
  if (!supplierUsername) return;
  const list = readInbox(supplierUsername);
  const idx = list.findIndex(x => x.applyNo === entry.applyNo);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.unshift(entry);
  writeInbox(supplierUsername, list);
};

/** 同步申请状态到供应商收件箱（申请方改状态 / 供应商改状态双向共用） */
export const updateInboxStatus = (supplierUsername: string, applyNo: string, status: '待开票' | '开票成功' | '已开票'): boolean => {
  if (!supplierUsername || !applyNo) return false;
  const list = readInbox(supplierUsername);
  const idx = list.findIndex(x => x.applyNo === applyNo);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], status };
  writeInbox(supplierUsername, list);
  return true;
};

/**
 * 解析供应商合作状态与账号：
 * 合作判定取采购商平台供应商列表 purchaser_suppliers_<owner> 中 cooperationStatus==='approved' 的条目；
 * 账号优先取条目 supplierUsername，回退 registeredUsers 按公司名/简称匹配（排除本账号）
 */
export const resolveSupplier = (owner: string, supplierName: string): { username: string; cooperated: boolean } => {
  const name = String(supplierName || '').trim();
  if (!name) return { username: '', cooperated: false };
  let list: any[] = [];
  try { list = JSON.parse(localStorage.getItem(`purchaser_suppliers_${owner}`) || '[]'); } catch { /* ignore */ }
  const entry = list.find((s: any) => String(s.supplierName || '').trim() === name || String(s.shortName || '').trim() === name);
  const cooperated = !!entry && entry.cooperationStatus === 'approved';
  let username = String(entry?.supplierUsername || '').trim();
  if (!username) {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username !== owner && (String(x.companyName || '').trim() === name || String(x.companyShortName || '').trim() === name));
      if (u?.username) username = u.username;
    } catch { /* ignore */ }
  }
  return { username, cooperated };
};

/** 申请单号：KP+YYYYMMDD+3位序号（按申请方当日已有单号递增） */
export const nextApplyNo = (records: any[], dayjsFormat: string): string => {
  const prefix = `KP${dayjsFormat}`;
  let max = 0;
  (records || []).forEach((r: any) => {
    const no = String(r?.applyNo || '');
    if (no.startsWith(prefix)) {
      const seq = Number(no.slice(prefix.length));
      if (seq > max) max = seq;
    }
  });
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
};

/** 回写申请方开票记录中的开票状态（供应商侧标记开票完成时调用，闭环；可附带发票图片） */
export const syncApplicantRecordStatus = (applicantUsername: string, applyNo: string, status: '待开票' | '开票成功', image?: string): boolean => {
  if (!applicantUsername || !applyNo) return false;
  const key = `invoice_record_${applicantUsername}`;
  let list: any[] = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return false; }
  let hit = false;
  list = list.map((r: any) => {
    if (r?.source === 'apply' && r?.applyNo === applyNo && (r.invoiceStatus !== status || (image && r.image !== image))) {
      hit = true;
      return { ...r, invoiceStatus: status, image: image ? image : r.image };
    }
    return r;
  });
  if (!hit) return false;
  const json = JSON.stringify(list);
  safeSetItem(key, json);
  safeSetItem(`${key}_ts`, String(Date.now()));
  return true;
};
