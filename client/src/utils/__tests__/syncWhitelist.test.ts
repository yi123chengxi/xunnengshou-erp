// 财务域存储键同步白名单回归护栏：锁定「财务管理菜单下的数据必须跨端同步」这条契约。
// 历史缺陷：general_ledger_entries_ / general_ledger_closed_periods_ / ledger_summary_sources_ /
// invoice_apply_settings_ / bank_reconciliation_ / installment_posted_ 曾漏入 SYNC_PREFIXES，
// 这些键只存本机——在 A 电脑录入的会计账簿分录/开票设置，B 电脑登录同账号永远看不到。
import { isSyncKey } from '../serverSync';

const FINANCE_KEYS = [
  'reimbursement_owner1', 'receiving_accounts_owner1',
  'daily_bookkeeping_owner1', 'daily_book_categories_owner1', 'daily_book_main_categories_owner1',
  'general_ledger_subjects_owner1', 'general_ledger_entries_owner1', 'general_ledger_closed_periods_owner1',
  'ledger_summary_sources_owner1', 'ledger_auto_subjects_owner1', 'ledger_mode_owner1', 'ledger_period_amounts_owner1',
  'other_payables_owner1', 'other_receivables_owner1', 'customer_statements_owner1', 'autoReconSettings_owner1',
  'invoice_apply_requests_owner1', 'invoice_apply_settings_owner1', 'bank_reconciliation_owner1', 'installment_posted_owner1',
  'pageData_finance_bank-account_owner1',
];

describe('财务域同步白名单', () => {
  it('财务菜单全部存储键都纳入跨端同步白名单', () => {
    FINANCE_KEYS.forEach(k => expect(isSyncKey(k)).toBe(true));
  });

  it('本地派生快照键仍禁止跨端同步（防 0 快照覆盖他端正确值）', () => {
    expect(isSyncKey('customer_pay_summary_owner1')).toBe(false);
    expect(isSyncKey('supplier_pay_summary_owner1')).toBe(false);
  });

  it('仓库统计各存储键必须纳入跨端同步白名单（历史缺陷：只存本机致他端看不到新增）', () => {
    const WAREHOUSE_KEYS = [
      'ws_stock_owner1', 'ws_urgent_owner1', 'ws_pick_owner1',
      'ws_wage_owner1', 'ws_urgentWage_owner1', 'ws_pickWage_owner1',
      'ws_group_owner1', 'ws_note_owner1', 'ws_managers_owner1', 'ws_orderLabel_owner1',
    ];
    WAREHOUSE_KEYS.forEach(k => expect(isSyncKey(k)).toBe(true));
    // 提现任务状态必须同步：负责人电脑靠拉取该键才能弹出提现任务提醒
    expect(isSyncKey('withdrawal_task_status_owner1')).toBe(true);
    // 盘点任务状态必须同步（随 month_end_check_ 前缀入白名单）：负责人电脑靠拉取该键弹出盘点任务提醒
    expect(isSyncKey('month_end_check_task_status_owner1')).toBe(true);
  });
});
