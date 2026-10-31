// 会计账薄桥接工具：账薄模式互斥开关 + 业务单据自动生成会计分录 + 银行账户明细写入
// 模式：'simple' 简易账薄版本（修改前行为）；'accounting' 会计账薄版本（启用借/贷科目与自动分录联动）

export type LedgerMode = 'simple' | 'accounting';

export const getLedgerMode = (owner: string): LedgerMode => {
  try {
    const v = localStorage.getItem(`ledger_mode_${owner}`);
    return v === 'accounting' ? 'accounting' : 'simple';
  } catch { return 'simple'; }
};

export const setLedgerMode = (owner: string, mode: LedgerMode): void => {
  try { localStorage.setItem(`ledger_mode_${owner}`, mode); } catch { /* ignore */ }
};

export const isAccountingMode = (owner: string): boolean => getLedgerMode(owner) === 'accounting';

// ==================== 会计分录自动写入 ====================

interface AutoEntryOpts {
  sourceKey: string;        // 业务来源幂等键（同键重写时先删旧分录）
  debitSubject: string;     // 借方科目名称
  creditSubject: string;    // 贷方科目名称
  amount: number;
  summary: string;          // 摘要
  date?: string;            // YYYY-MM-DD，默认当天
  bookkeeper?: string;      // 记账人
  auditor?: string;         // 审核人
  cashier?: string;         // 出纳
}

const loadJson = (key: string): any[] => {
  try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
};
const saveJson = (key: string, val: any[]): void => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
};

// 预置科目兜底（科目表未初始化时按名称解析）
const FALLBACK_SUBJECTS: Record<string, { code: string; category: string }> = {
  '库存现金': { code: '1001', category: 'asset' },
  '银行存款': { code: '1002', category: 'asset' },
  '其他货币资金': { code: '1012', category: 'asset' },
  '应收票据': { code: '1121', category: 'asset' },
  '应收账款': { code: '1122', category: 'asset' },
  '预付账款': { code: '1123', category: 'asset' },
  '原材料': { code: '1401', category: 'asset' },
  '库存商品': { code: '1405', category: 'asset' },
  '应付账款': { code: '2201', category: 'liability' },
  '预收账款': { code: '2202', category: 'liability' },
  '应付职工薪酬': { code: '2211', category: 'liability' },
  '应交税费': { code: '2221', category: 'liability' },
  '实收资本': { code: '4001', category: 'equity' },
  '本年利润': { code: '4103', category: 'equity' },
  '主营业务收入': { code: '6001', category: 'revenue' },
  '其他业务收入': { code: '6051', category: 'revenue' },
  '主营业务成本': { code: '6401', category: 'expense' },
  '销售费用': { code: '6601', category: 'expense' },
  '管理费用': { code: '6602', category: 'expense' },
  '财务费用': { code: '6603', category: 'expense' },
};

// ==================== 自动记账科目：自动创建 + 禁止改删 ====================

/** 自动记账使用过的科目名称名单（存储键 ledger_auto_subjects_<owner>）：命中名单的科目缺失时自动创建，且禁止修改/删除 */
export const loadAutoSubjectNames = (owner: string): string[] => {
  try { const v = JSON.parse(localStorage.getItem(`ledger_auto_subjects_${owner}`) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const saveAutoSubjectNames = (owner: string, names: string[]): void => {
  try { localStorage.setItem(`ledger_auto_subjects_${owner}`, JSON.stringify(names)); } catch { /* ignore */ }
};

/** 自动记账科目缺失时在科目表中创建：编码/类别优先取预置兑底，否则同类别最大编码+1 */
const ensureAutoSubject = (owner: string, name: string): void => {
  if (!name) return;
  const subjectKey = `general_ledger_subjects_${owner}`;
  const subjects = loadJson(subjectKey);
  const names = loadAutoSubjectNames(owner);
  if (!names.includes(name)) { names.push(name); saveAutoSubjectNames(owner, names); }
  if (subjects.some((s: any) => s.name === name)) return;
  const fb = FALLBACK_SUBJECTS[name];
  const category = fb?.category || 'asset';
  const maxCode = subjects.filter((s: any) => s.category === category).reduce((m: number, s: any) => Math.max(m, Number(s.code) || 0), 0);
  let code = fb?.code || '';
  if (!code || subjects.some((s: any) => s.code === code)) code = String(maxCode + 1);
  const direction = category === 'liability' || category === 'equity' || category === 'revenue' ? 'credit' : 'debit';
  subjects.push({
    key: `LS-AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    code, name, category, direction, parentId: '', auto: true,
  });
  saveJson(subjectKey, subjects);
};

export const resolveSubject = (owner: string, name: string): { code: string; name: string; category: string } => {
  const subjects = loadJson(`general_ledger_subjects_${owner}`);
  const hit = subjects.find((s: any) => s.name === name || s.code === name);
  if (hit) return { code: hit.code, name: hit.name, category: hit.category };
  const fb = FALLBACK_SUBJECTS[name];
  return { code: fb?.code || '', name, category: fb?.category || 'asset' };
};

// 科目下拉选项（供各弹窗借/贷 Select 使用）
export const loadSubjectOptions = (owner: string): { value: string; label: string }[] => {
  const subjects = loadJson(`general_ledger_subjects_${owner}`);
  if (subjects.length > 0) return subjects.map((s: any) => ({ value: s.name, label: `${s.code} ${s.name}` }));
  return Object.keys(FALLBACK_SUBJECTS).map(n => ({ value: n, label: `${FALLBACK_SUBJECTS[n].code} ${n}` }));
};

// 科目下拉快速检索：label 形如 "1002 银行存款"，同时匹配科目编号与名称
export const subjectFilterOption = (input: string, opt?: { label?: unknown }): boolean =>
  String((opt as { label?: unknown } | undefined)?.label ?? '').toLowerCase().includes(String(input || '').trim().toLowerCase());

const nextVoucherNo = (entries: any[], date: string): string => {
  const prefix = `PZ-${date.replace(/-/g, '')}`;
  const used = new Set(entries.map((e: any) => e.voucherNo).filter((v: string) => v && v.startsWith(prefix)));
  let n = used.size + 1;
  let no = `${prefix}-${String(n).padStart(3, '0')}`;
  while (used.has(no)) { n += 1; no = `${prefix}-${String(n).padStart(3, '0')}`; }
  return no;
};

/**
 * 写入一对自动会计分录（借方一条 + 贷方一条，共享凭证号）。
 * 同一 sourceKey 重复触发时先删除旧分录再写入（幂等）。
 * 返回凭证号；金额非法时返回空串不写入。
 */
export const writeAutoEntries = (owner: string, opts: AutoEntryOpts): string => {
  const amt = Math.abs(Number(opts.amount) || 0);
  if (amt <= 0 || !opts.debitSubject || !opts.creditSubject) return '';
  // 自动记账用到的科目：缺失时自动在科目表创建，并纳入禁止改删名单
  ensureAutoSubject(owner, opts.debitSubject);
  ensureAutoSubject(owner, opts.creditSubject);
  const entryKey = `general_ledger_entries_${owner}`;
  const entries = loadJson(entryKey);
  // 幂等：先移除同来源旧分录
  const cleaned = entries.filter((e: any) => e.autoSourceKey !== opts.sourceKey);
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const voucherNo = nextVoucherNo(cleaned, date);
  const d = resolveSubject(owner, opts.debitSubject);
  const c = resolveSubject(owner, opts.creditSubject);
  const base = {
    date, voucherNo, description: opts.summary,
    debitAmount: 0, creditAmount: 0,
    auto: true, autoSourceKey: opts.sourceKey,
    bookkeeper: opts.bookkeeper || '',
    auditor: opts.auditor || '',
    cashier: opts.cashier || '',
  };
  cleaned.unshift(
    { ...base, key: `auto-${opts.sourceKey}-dr`, subjectCode: d.code, subjectName: d.name, category: d.category, debitAmount: amt },
    { ...base, key: `auto-${opts.sourceKey}-cr`, subjectCode: c.code, subjectName: c.name, category: c.category, creditAmount: amt },
  );
  saveJson(entryKey, cleaned);
  return voucherNo;
};

/** 删除指定来源的自动分录（业务状态回退时调用），返回是否删除了分录 */
export const removeAutoEntries = (owner: string, sourceKey: string): boolean => {
  const entryKey = `general_ledger_entries_${owner}`;
  const entries = loadJson(entryKey);
  const kept = entries.filter((e: any) => e.autoSourceKey !== sourceKey);
  if (kept.length === entries.length) return false;
  saveJson(entryKey, kept);
  return true;
};

// ==================== 银行账户明细写入 ====================

/** 向银行账户追加一条收支明细并更新余额（账户不存在时返回 false） */
export const pushBankTransaction = (
  owner: string, accountName: string, type: 'in' | 'out', amount: number, remark: string, person?: string, time?: string,
): boolean => {
  const amt = Math.abs(Number(amount) || 0);
  if (!accountName || amt <= 0) return false;
  const baKey = `pageData_finance_bank-account_${owner}`;
  const bas = loadJson(baKey);
  const i = bas.findIndex((b: any) => (b.name || b.shortName || '') === accountName);
  if (i < 0) return false;
  const bal = Number(bas[i].balance) || 0;
  const nb = type === 'in' ? bal + amt : bal - amt;
  const nowTime = time || `${new Date().toISOString().slice(0, 10)} ${new Date().toTimeString().slice(0, 8)}`;
  bas[i].transactions = [...(bas[i].transactions || []), { time: nowTime, type, amount: amt, balanceAfter: nb, remark, person: person || '' }];
  bas[i].balance = nb;
  saveJson(baKey, bas);
  return true;
};

/** 删除指定账户中匹配备注+金额+方向的最近一条明细并回退余额（撤回场景） */
export const removeBankTransaction = (owner: string, accountName: string, type: 'in' | 'out', amount: number, remark: string): boolean => {
  const amt = Math.abs(Number(amount) || 0);
  const baKey = `pageData_finance_bank-account_${owner}`;
  const bas = loadJson(baKey);
  const i = bas.findIndex((b: any) => (b.name || b.shortName || '') === accountName);
  if (i < 0) return false;
  const txs: any[] = bas[i].transactions || [];
  for (let j = txs.length - 1; j >= 0; j--) {
    if (txs[j].type === type && Math.abs(Number(txs[j].amount) || 0) === amt && (txs[j].remark || '') === remark) {
      txs.splice(j, 1);
      bas[i].transactions = txs;
      bas[i].balance = type === 'in' ? (Number(bas[i].balance) || 0) - amt : (Number(bas[i].balance) || 0) + amt;
      saveJson(baKey, bas);
      return true;
    }
  }
  return false;
};
