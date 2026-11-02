/**
 * 供应商银行账户信息 → 采购商供应商列表条目的自动同步：
 * - 真值源为供应商自身在 registeredUsers（全局同步键）中维护的收款信息
 *   （accountName/bankName/branchName/bankAccountNo，供应商「企业信息-银行与收款」保存）；
 * - 采购商侧供应商条目（purchaser_suppliers_<账号>）默认同步上述四字段；
 * - 以 bankSyncSig（四字段拼接签名）检测两类变更：
 *   ① 供应商侧改动（条目字段仍等于旧签名而供应商签名已变）→ 自动触发一次更新同步；
 *   ② 采购商手动修改（条目字段已不等于自身签名）→ 视为手动值，此后不再自动覆盖；
 * - 供应商尚未填写银行信息时不清空条目已有值。
 */
import { safeSetItem } from './storageQuota';

export const BANK_SYNC_FIELDS = ['accountName', 'bankName', 'branchName', 'bankAccountNo'] as const;

/** 银行四字段签名：用于检测供应商侧是否发生变更 */
export const bankSigOf = (u: any): string =>
  BANK_SYNC_FIELDS.map(f => String(u?.[f] || '').trim()).join('|');

/** 条目当前银行四字段签名（与 bankSigOf 同口径） */
const entrySigOf = (s: any): string =>
  BANK_SYNC_FIELDS.map(f => String(s?.[f] || '').trim()).join('|');

/**
 * 将供应商最新银行信息同步进采购商供应商列表条目。
 * 返回是否发生更新；调用方据此刷新界面。
 */
export const syncSupplierBankFields = (owner: string): boolean => {
  if (!owner) return false;
  const key = 'purchaser_suppliers_' + owner;
  let list: any[] = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return false; }
  if (!Array.isArray(list) || list.length === 0) return false;
  let users: any[] = [];
  try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { return false; }
  if (!Array.isArray(users)) return false;
  let changed = false;
  const next = list.map((s: any) => {
    if (!s) return s;
    const un = String(s.supplierUsername || '').trim();
    if (!un) return s;
    const u = users.find((x: any) => x.username === un);
    if (!u) return s;
    const supSig = bankSigOf(u);
    if (!supSig || supSig === '|||') return s; // 供应商尚未填写银行信息 → 不清空已有值
    const curSig = entrySigOf(s);
    const lastSig = String(s.bankSyncSig || '');
    // 采购商手动修改过（条目字段已偏离上次同步签名）→ 保留手动值，不再自动覆盖
    if (lastSig && curSig !== lastSig) return s;
    if (curSig === supSig && lastSig === supSig) return s; // 已同步且供应商未变更
    changed = true;
    return {
      ...s,
      accountName: String(u.accountName || '').trim(),
      bankName: String(u.bankName || '').trim(),
      branchName: String(u.branchName || '').trim(),
      bankAccountNo: String(u.bankAccountNo || '').trim(),
      bankSyncSig: supSig,
    };
  });
  if (changed) {
    safeSetItem(key, JSON.stringify(next));
  }
  return changed;
};

// ============ 全局监听器（应用启动时安装一次） ============
let watcherStarted = false;

/**
 * 安装银行信息自动同步全局监听：服务器同步落地（sync-data-updated）/页面恢复可见/
 * 跨标签页 registeredUsers 变更时各跑一次签名比对同步；有更新时派发列表刷新事件。
 * 供应商/加工厂账号无 purchaser_suppliers_ 键，同步函数直接返回 false，无副作用。
 */
export const startBankSyncWatcher = (): void => {
  if (watcherStarted) return;
  watcherStarted = true;
  const owner = (): string => {
    try {
      const username = localStorage.getItem('username') || '';
      const isSub = localStorage.getItem('isSubAccount') === 'true';
      return isSub ? (localStorage.getItem('parentAccount') || username) : username;
    } catch { return ''; }
  };
  const run = () => {
    try {
      const o = owner();
      if (!o) return;
      if (syncSupplierBankFields(o)) {
        // 复用列表页已有的刷新事件通道，通知供应商列表/合作申请等页面重载
        window.dispatchEvent(new Event('cooperation-applications-changed'));
      }
    } catch { /* ignore */ }
  };
  run();
  window.addEventListener('sync-data-updated', run);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key === 'registeredUsers') run(); });
};
