import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Row, Col, Select, Tag, Alert,
  DatePicker, Input, Modal, Form, InputNumber, Popconfirm, Tooltip, Divider, Statistic, Switch,
} from 'antd';
import {
  BookOutlined, SearchOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, DownloadOutlined, FundOutlined, SwapOutlined, CopyOutlined, WalletOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import DailyBookkeepingPage from './DailyBookkeepingPage';
import OtherReceivablesPanel from '../components/OtherReceivablesPanel';
import OtherPayablesPanel from '../components/OtherPayablesPanel';
import { getLedgerMode, setLedgerMode, loadAutoSubjectNames, type LedgerMode } from '../utils/accountingBridge';
import { readProductListSync } from '../utils/dataStore';
import useResizableColumns from '../hooks/useResizableColumns';
import { loadSupplierSummary, ensureSupplierSummaryBuilt, loadCustomerSummary, ensureCustomerSummaryBuilt, toYuan } from '../utils/paySummary';
import { safeSetItem } from '../utils/storageQuota';
import { copyText } from '../utils/clipboard';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const PRIMARY = '#1e4a7e';

// 数据隔离（与全局 getDataOwner 口径一致：子账号使用主账号的 username）
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) {
    return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  }
  return localStorage.getItem('username') || '';
};

// 记账人显示名称
const getDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u) return u.displayName || u.contactPerson || u.name || username;
  } catch { /* ignore */ }
  return username;
};

// 会计科目大类
const ACCOUNT_CATEGORIES = [
  { key: 'asset', label: '资产', color: '#1890ff' },
  { key: 'liability', label: '负债', color: '#fa8c16' },
  { key: 'equity', label: '所有者权益', color: '#722ed1' },
  { key: 'revenue', label: '收入', color: '#52c41a' },
  { key: 'expense', label: '费用', color: '#ff4d4f' },
];

// 默认科目表（预置常用科目）
const DEFAULT_SUBJECTS: LedgerSubject[] = [
  { key: 'LS-1001', code: '1001', name: '库存现金', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1002', code: '1002', name: '银行存款', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1012', code: '1012', name: '其他货币资金', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1121', code: '1121', name: '应收票据', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1122', code: '1122', name: '应收账款', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1123', code: '1123', name: '预付账款', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1401', code: '1401', name: '原材料', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1405', code: '1405', name: '库存商品', category: 'asset', direction: 'debit', parentId: '' },
  { key: 'LS-1601', code: '1601', name: '固定资产', category: 'asset', direction: 'debit', parentId: '' },

  { key: 'LS-2001', code: '2001', name: '短期借款', category: 'liability', direction: 'credit', parentId: '' },
  { key: 'LS-2201', code: '2201', name: '应付账款', category: 'liability', direction: 'credit', parentId: '' },
  { key: 'LS-2202', code: '2202', name: '预收账款', category: 'liability', direction: 'credit', parentId: '' },
  { key: 'LS-2211', code: '2211', name: '应付职工薪酬', category: 'liability', direction: 'credit', parentId: '' },
  { key: 'LS-2221', code: '2221', name: '应交税费', category: 'liability', direction: 'credit', parentId: '' },
  { key: 'LS-2501', code: '2501', name: '长期借款', category: 'liability', direction: 'credit', parentId: '' },

  { key: 'LS-4001', code: '4001', name: '实收资本', category: 'equity', direction: 'credit', parentId: '' },
  { key: 'LS-4002', code: '4002', name: '资本公积', category: 'equity', direction: 'credit', parentId: '' },
  { key: 'LS-4103', code: '4103', name: '本年利润', category: 'equity', direction: 'credit', parentId: '' },
  { key: 'LS-4104', code: '4104', name: '利润分配', category: 'equity', direction: 'credit', parentId: '' },

  { key: 'LS-6001', code: '6001', name: '主营业务收入', category: 'revenue', direction: 'credit', parentId: '' },
  { key: 'LS-6051', code: '6051', name: '其他业务收入', category: 'revenue', direction: 'credit', parentId: '' },
  { key: 'LS-6301', code: '6301', name: '营业外收入', category: 'revenue', direction: 'credit', parentId: '' },

  { key: 'LS-6401', code: '6401', name: '主营业务成本', category: 'expense', direction: 'debit', parentId: '' },
  { key: 'LS-6402', code: '6402', name: '其他业务成本', category: 'expense', direction: 'debit', parentId: '' },
  { key: 'LS-6601', code: '6601', name: '销售费用', category: 'expense', direction: 'debit', parentId: '' },
  { key: 'LS-6602', code: '6602', name: '管理费用', category: 'expense', direction: 'debit', parentId: '' },
  { key: 'LS-6603', code: '6603', name: '财务费用', category: 'expense', direction: 'debit', parentId: '' },
  { key: 'LS-6711', code: '6711', name: '营业外支出', category: 'expense', direction: 'debit', parentId: '' },
];

// 默认数据源预设（科目编码 → 数据源，仅简易账薄模式下首次打开时生效）
const DEFAULT_SOURCES: Record<string, { source: string }> = {
  '1001': { source: 'manual' },      // 库存现金 → 手动输入
  '1002': { source: 'bank' },        // 银行存款 → 银行账户余额
  '1012': { source: 'platform' },    // 其他货币资金 → 平台资金
  '1122': { source: 'ar' },          // 应收账款 → 应收账款
  '1123': { source: 'receivable' },  // 预付账款 → 其他应收款
  '1401': { source: 'raw' },         // 原材料 → 原材料
  '1405': { source: 'inventory' },   // 库存商品 → 库存商品
  '2201': { source: 'ap' },          // 应付账款 → 应付账款
  '2202': { source: 'payable' },     // 预收账款 → 其他应付款
  '2211': { source: 'salary' },      // 应付职工薪酬 → 应付工资
  '6001': { source: 'daily' },       // 主营业务收入 → 日常记账
  '6051': { source: 'daily' },       // 其他业务收入 → 日常记账
  '6301': { source: 'daily' },       // 营业外收入 → 日常记账
  '6401': { source: 'daily' },       // 主营业务成本 → 日常记账
  '6402': { source: 'daily' },       // 其他业务成本 → 日常记账
  '6601': { source: 'daily' },       // 销售费用 → 日常记账
  '6602': { source: 'daily' },       // 管理费用 → 日常记账
  '6603': { source: 'daily' },       // 财务费用 → 日常记账
  '6711': { source: 'daily' },       // 营业外支出 → 日常记账
};

interface LedgerSubject {
  key: string;
  code: string;
  name: string;
  category: string;
  direction: 'debit' | 'credit';
  parentId: string;
}

interface LedgerEntry {
  key: string;
  date: string;
  voucherNo: string;
  description: string;
  subjectCode: string;
  subjectName: string;
  debitAmount: number;
  creditAmount: number;
  category: string;
  auto?: boolean;
  bookkeeper?: string;
  auditor?: string;
  cashier?: string;
}

// 余额表行：每个科目在每个会计期间的余额快照
interface BalanceRow {
  subjectCode: string;
  subjectName: string;
  category: string;
  direction: 'debit' | 'credit';
  openingBalance: number;  // 上期金额（期初余额）
  periodDebit: number;     // 本期借方发生额
  periodCredit: number;    // 本期贷方发生额
  closingBalance: number;  // 期末余额
}

/** 日常记账记录分类取主分类（存储格式“主分类-子分类”或仅主分类） */
const dailyMainOf = (cat: string): string => {
  const s = String(cat || '');
  const i = s.indexOf('-');
  return i > 0 ? s.slice(0, i) : s;
};

const GeneralLedgerPage: React.FC<{ simple?: boolean }> = ({ simple = false }) => {
  const owner = useMemo(() => getDataOwner(), []);
  const subjectKey = `general_ledger_subjects_${owner}`;
  const entryKey = `general_ledger_entries_${owner}`;
  const closedPeriodKey = `general_ledger_closed_periods_${owner}`;

  const [subjects, setSubjects] = useState<LedgerSubject[]>([]);
  // 自动记账使用过的科目名单：命中者禁止修改/删除
  const [autoSubjectNames, setAutoSubjectNames] = useState<string[]>(() => loadAutoSubjectNames(owner));
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterSubject, setFilterSubject] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().startOf('month'), dayjs().endOf('month'),
  ]);
  const [selectedPeriod, setSelectedPeriod] = useState<dayjs.Dayjs>(dayjs());

  // 账薄模式互斥开关：简易账薄与会计账薄只能开启一个
  const [ledgerMode, setLedgerModeState] = useState<LedgerMode>(() => getLedgerMode(owner));
  const modeOn = simple ? ledgerMode === 'simple' : ledgerMode === 'accounting';
  const handleModeToggle = (checked: boolean) => {
    // 仅管理员可操作开关
    if (localStorage.getItem('isSubAccount') === 'true') {
      Modal.info({ title: '提示', content: '请联系企业管理员操作', centered: true });
      return;
    }
    if (!checked) { message.info('两个账薄互斥且必须开启一个：请通过另一个账薄页面的开关进行切换'); return; }
    if (modeOn) return;
    const target: LedgerMode = simple ? 'simple' : 'accounting';
    Modal.confirm({
      title: target === 'simple' ? '打开简易账薄' : '打开会计账薄',
      centered: true,
      content: target === 'simple'
        ? '打开简易账薄，将自动关闭会计账薄，会计账薄将无法使用，是否继续'
        : '打开会计账薄，将自动关闭简易账薄，简易账薄将无法使用，是否继续',
      okText: '继续',
      cancelText: '取消',
      onOk: () => {
        setLedgerMode(owner, target);
        setLedgerModeState(target);
        message.success(target === 'simple' ? '已切换到简易账薄版本' : '已切换到会计账薄版本（启用借贷科目与自动分录联动）');
      },
    });
  };

  // 科目弹窗
  const [subjectModalVisible, setSubjectModalVisible] = useState(false);
  const [editingSubject, setEditingSubject] = useState<LedgerSubject | null>(null);
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [subjectForm] = Form.useForm();
  // 科目弹窗内类别联动：日常记账数据源仅收入/费用类别可选
  const subjectCategoryWatch = Form.useWatch('category', subjectForm);

  // 分录弹窗
  const [entryModalVisible, setEntryModalVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);
  const [entryForm] = Form.useForm();

  // 冲红状态
  const [reversalMode, setReversalMode] = useState(false);
  const [reversalVoucherInput, setReversalVoucherInput] = useState('');
  const [reversalPreview, setReversalPreview] = useState<LedgerEntry[]>([]);
  const resetReversalState = () => {
    setReversalMode(false);
    setReversalVoucherInput('');
    setReversalPreview([]);
    try { entryForm.setFieldValue('reversalVoucherInput', ''); } catch { /* 表单销毁时忽略 */ }
  };

  // 凭证查看弹窗
  const [voucherModalVisible, setVoucherModalVisible] = useState(false);
  const [viewingVoucherNo, setViewingVoucherNo] = useState<string>('');

  // 已结账期间
  const [closedPeriods, setClosedPeriods] = useState<string[]>([]);

  // 加载数据
  const loadData = useCallback(() => {
    setAutoSubjectNames(loadAutoSubjectNames(owner));
    try {
      const rawSubjects = localStorage.getItem(subjectKey);
      if (rawSubjects) {
        setSubjects(JSON.parse(rawSubjects));
      } else {
        setSubjects(DEFAULT_SUBJECTS);
        localStorage.setItem(subjectKey, JSON.stringify(DEFAULT_SUBJECTS));
      }
    } catch { setSubjects(DEFAULT_SUBJECTS); }
    try {
      const rawEntries = localStorage.getItem(entryKey);
      if (rawEntries) setEntries(JSON.parse(rawEntries));
    } catch { /* ignore */ }
    try {
      const rawClosed = localStorage.getItem(closedPeriodKey);
      if (rawClosed) setClosedPeriods(JSON.parse(rawClosed));
    } catch { /* ignore */ }
  }, [subjectKey, entryKey, closedPeriodKey]);

  useEffect(() => { loadData(); }, [loadData]);

  const saveSubjects = (list: LedgerSubject[]) => {
    setSubjects(list);
    localStorage.setItem(subjectKey, JSON.stringify(list));
  };

  const saveEntries = (list: LedgerEntry[]) => {
    setEntries(list);
    localStorage.setItem(entryKey, JSON.stringify(list));
  };

  const saveClosedPeriods = (list: string[]) => {
    setClosedPeriods(list);
    localStorage.setItem(closedPeriodKey, JSON.stringify(list));
  };

  const fmt = (v: number) => (v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 生成凭证号（PZ-YYYYMMDD-XXX，按当日唯一凭证号数量递增）
  const generateVoucherNo = useCallback((existingEntries: LedgerEntry[], date?: string): string => {
    const d = date || dayjs().format('YYYY-MM-DD');
    const prefix = `PZ-${d.replace(/-/g, '')}`;
    const uniqueNos = new Set(
      existingEntries.filter(e => (e.voucherNo || '').startsWith(prefix)).map(e => e.voucherNo)
    );
    return `${prefix}-${String(uniqueNos.size + 1).padStart(3, '0')}`;
  }, []);

  // 查看凭证
  const openVoucherView = (voucherNo: string) => {
    setViewingVoucherNo(voucherNo);
    setVoucherModalVisible(true);
  };

  // 期末结转：将损益类科目结转至“本年利润”
  const handleClosePeriod = () => {
    // 简易模式：期末结转 = 保存本期金额快照（下月期初由此取数）；不写结转分录、不锁定期间
    if (simple) {
      const monthStr = selectedPeriod.format('YYYY-MM');
      const snap: Record<string, number> = {};
      periodBalanceRows.forEach(r => { snap[r.subjectCode] = sourceAmountMap[r.subjectCode] || 0; });
      const all = { ...periodAmountSnaps, [monthStr]: snap };
      setPeriodAmountSnaps(all);
      safeSetItem(periodSnapKey, JSON.stringify(all));
      // 通知日常记账页刷新已结转月份（移除作废按键/拦截新增）
      window.dispatchEvent(new CustomEvent('ledger-period-saved'));
      message.success(`已保存 ${monthStr} 本期金额，${selectedPeriod.add(1, 'month').format('YYYY-MM')} 的上期金额将由此取数`);
      return;
    }
    const period = selectedPeriod.format('YYYY-MM');
    if (closedPeriods.includes(period)) {
      message.warning(`${period} 已结账，请勿重复操作`);
      return;
    }

    // 获取当前期间的损益类科目余额
    const periodRows = periodBalanceRows.filter(r => r.category === 'revenue' || r.category === 'expense');
    if (periodRows.length === 0 || periodRows.every(r => Math.abs(r.closingBalance) < 0.01)) {
      message.warning('当前期间无损益类科目发生额，无需结转');
      return;
    }

    const profitCode = '4103'; // 本年利润
    const profitSub = subjects.find(s => s.code === profitCode);
    if (!profitSub) {
      message.error('缺少科目“本年利润”(4103)，请先在科目表中添加');
      return;
    }

    const closingEntries: LedgerEntry[] = [];
    const voucherNo = generateVoucherNo(entries, `${period}-28`);
    const closingDate = `${period}-28`; // 结转凭证日期取28号
    let totalRevenue = 0;
    let totalExpense = 0;

    // 收入类科目结转：借方冲减收入，贷方本年利润
    periodRows.filter(r => r.category === 'revenue' && Math.abs(r.closingBalance) >= 0.01).forEach(r => {
      const amt = r.closingBalance;
      totalRevenue += amt;
      closingEntries.push({
        key: `LE-${Date.now()}-close-${r.subjectCode}`,
        date: closingDate,
        voucherNo,
        description: `期末结转-${r.subjectName}`,
        subjectCode: r.subjectCode,
        subjectName: r.subjectName,
        debitAmount: amt,
        creditAmount: 0,
        category: 'revenue',
      });
    });

    // 费用类科目结转：借方本年利润，贷方冲减费用
    periodRows.filter(r => r.category === 'expense' && Math.abs(r.closingBalance) >= 0.01).forEach(r => {
      const amt = r.closingBalance;
      totalExpense += amt;
      closingEntries.push({
        key: `LE-${Date.now()}-close-${r.subjectCode}`,
        date: closingDate,
        voucherNo,
        description: `期末结转-${r.subjectName}`,
        subjectCode: r.subjectCode,
        subjectName: r.subjectName,
        debitAmount: 0,
        creditAmount: amt,
        category: 'expense',
      });
    });

    // 本年利润汇总行
    const netProfit = totalRevenue - totalExpense;
    if (Math.abs(netProfit) >= 0.01) {
      // 收入 > 费用时：贷方本年利润（利润增加）
      closingEntries.push({
        key: `LE-${Date.now()}-close-profit`,
        date: closingDate,
        voucherNo,
        description: '期末结转-本年利润',
        subjectCode: profitCode,
        subjectName: profitSub.name,
        debitAmount: netProfit > 0 ? 0 : Math.abs(netProfit),
        creditAmount: netProfit > 0 ? netProfit : 0,
        category: 'equity',
      });
    }

    if (closingEntries.length === 0) {
      message.warning('无有效损益数据需要结转');
      return;
    }

    const updated = [...entries, ...closingEntries];
    saveEntries(updated);
    const newClosed = [...closedPeriods, period];
    saveClosedPeriods(newClosed);
    message.success(`${period} 期末结转完成：收入 ¥${fmt(totalRevenue)}、费用 ¥${fmt(totalExpense)}、净利润 ¥${fmt(netProfit)}`);
  };

  // 年度结转：将本年利润结转至利润分配
  const handleYearEndClosing = () => {
    const year = selectedPeriod.format('YYYY');
    const decemberPeriod = `${year}-12`;

    if (!closedPeriods.includes(decemberPeriod)) {
      message.warning(`请先完成 ${year}年12月 的期末结转`);
      return;
    }

    const profitCode = '4103'; // 本年利润
    const distCode = '4104';   // 利润分配
    const profitSub = subjects.find(s => s.code === profitCode);
    const distSub = subjects.find(s => s.code === distCode);
    if (!profitSub || !distSub) {
      message.error('缺少科目“本年利润”(4103)或“利润分配”(4104)');
      return;
    }

    // 计算本年利润全年余额
    let yearProfit = 0;
    entries.forEach(e => {
      if (e.subjectCode === profitCode && e.date?.startsWith(year)) {
        yearProfit += (e.debitAmount || 0) - (e.creditAmount || 0);
      }
    });
    // 本年利润是贷方科目，正常余额为贷方（利润为正）
    // 但结转分录中借记本年利润=增加利润，贷记本年利润=减少利润
    // 全年净利润 = 贷方合计 - 借方合计 的负数（因为结转时借记收入贷记利润）
    // 实际：结转后本年利润余额 = sum(debit) - sum(credit)
    // 正数说明借方>贷方即费用>收入=亏损，负数说明盈利
    const netProfitForYear = -yearProfit; // 贷方科目：正余额=盈利

    if (Math.abs(netProfitForYear) < 0.01) {
      message.warning(`${year}年本年利润余额为零，无需年度结转`);
      return;
    }

    const closingDate = `${year}-12-31`;
    const voucherNo = generateVoucherNo(entries, closingDate);
    const yearEndEntries: LedgerEntry[] = [];

    if (netProfitForYear > 0) {
      // 盈利：借记本年利润，贷记利润分配
      yearEndEntries.push({
        key: `LE-${Date.now()}-yearend-profit`,
        date: closingDate,
        voucherNo,
        description: `${year}年度结转-本年利润转利润分配`,
        subjectCode: profitCode,
        subjectName: profitSub.name,
        debitAmount: netProfitForYear,
        creditAmount: 0,
        category: 'equity',
      });
      yearEndEntries.push({
        key: `LE-${Date.now()}-yearend-dist`,
        date: closingDate,
        voucherNo,
        description: `${year}年度结转-本年利润转利润分配`,
        subjectCode: distCode,
        subjectName: distSub.name,
        debitAmount: 0,
        creditAmount: netProfitForYear,
        category: 'equity',
      });
    } else {
      // 亏损：借记利润分配，贷记本年利润
      const lossAmt = Math.abs(netProfitForYear);
      yearEndEntries.push({
        key: `LE-${Date.now()}-yearend-dist`,
        date: closingDate,
        voucherNo,
        description: `${year}年度结转-本年利润转利润分配`,
        subjectCode: distCode,
        subjectName: distSub.name,
        debitAmount: lossAmt,
        creditAmount: 0,
        category: 'equity',
      });
      yearEndEntries.push({
        key: `LE-${Date.now()}-yearend-profit`,
        date: closingDate,
        voucherNo,
        description: `${year}年度结转-本年利润转利润分配`,
        subjectCode: profitCode,
        subjectName: profitSub.name,
        debitAmount: 0,
        creditAmount: lossAmt,
        category: 'equity',
      });
    }

    saveEntries([...entries, ...yearEndEntries]);
    message.success(`${year}年度结转完成：净利润 ¥${fmt(netProfitForYear)} 已转入利润分配`);
  };

  // 反结账
  const handleUnclosePeriod = () => {
    const period = selectedPeriod.format('YYYY-MM');
    if (!closedPeriods.includes(period)) {
      message.warning(`${period} 尚未结账`);
      return;
    }
    Modal.confirm({
      title: '反结账确认',
      content: `确定要反结账 ${period} 吗？这将删除该期间的结转分录并取消结账状态。`,
      okText: '确认反结账',
      cancelText: '取消',
      onOk: () => {
        // 删除结转分录（凭证号以结转日期的PZ开头，描述含“期末结转”）
        const remaining = entries.filter(e => {
          if (e.date?.startsWith(period) && e.description?.startsWith('期末结转-')) return false;
          return true;
        });
        saveEntries(remaining);
        saveClosedPeriods(closedPeriods.filter(p => p !== period));
        message.success(`${period} 已反结账`);
      },
    });
  };

  // ===================== 科目管理 =====================
  const openCreateSubject = () => {
    subjectForm.resetFields();
    subjectForm.setFieldsValue({ category: 'asset', direction: 'debit' });
    setEditingSubject(null);
    setIsCreatingSubject(true);
    setSubjectModalVisible(true);
  };

  const openEditSubject = (rec: LedgerSubject) => {
    if (isLockedSubject(rec)) { message.warning('自动记账使用的科目禁止修改'); return; }
    subjectForm.resetFields();
    subjectForm.setFieldsValue({
      code: rec.code, name: rec.name, category: rec.category,
      direction: rec.direction || ((rec.category === 'asset' || rec.category === 'expense') ? 'debit' : 'credit'),
      dataSource: summarySources[rec.code]?.source || undefined,
    });
    setEditingSubject(rec);
    setIsCreatingSubject(false);
    setSubjectModalVisible(true);
  };

  const handleSaveSubject = async () => {
    try {
      const values = await subjectForm.validateFields();
      // 余额方向：会计账薄由弹窗手选；简易账薄由科目类别派生（资产/费用=借方，其余=贷方）
      const dir: 'debit' | 'credit' = (!simple && values.direction) ? values.direction : ((values.category === 'asset' || values.category === 'expense') ? 'debit' : 'credit');
      if (isCreatingSubject) {
        const newSub: LedgerSubject = {
          key: `LS-${Date.now()}`,
          code: values.code,
          name: values.name,
          category: values.category,
          direction: dir,
          parentId: '',
        };
        saveSubjects([...subjects, newSub]);
        message.success('科目已添加');
      } else if (editingSubject) {
        const updated = subjects.map(s => s.key === editingSubject.key ? { ...s, name: values.name, category: values.category, direction: dir } : s);
        saveSubjects(updated);
        message.success('科目已更新');
      }
      // 数据源字段回写科目汇总配置（与汇总表数据源列同源，仅简易账薄弹窗含该字段）
      if (simple) {
        const code = values.code;
        const prevSrc = summarySources[code];
        const newSrc = values.dataSource || '';
        if (newSrc !== (prevSrc?.source || '')) {
          const next = { ...summarySources };
          if (newSrc) next[code] = { ...(prevSrc || {}), source: newSrc };
          else delete next[code];
          setSummarySources(next);
          safeSetItem(sourcesKey, JSON.stringify(next));
        }
      }
      setSubjectModalVisible(false);
    } catch { /* validation */ }
  };

  const handleDeleteSubject = (key: string) => {
    const rec = subjects.find(s => s.key === key);
    if (rec && isLockedSubject(rec)) { message.warning('自动记账使用的科目禁止删除'); return; }
    saveSubjects(subjects.filter(s => s.key !== key));
    message.success('科目已删除');
  };

  // ===================== 分录管理 =====================
  const openCreateEntry = () => {
    entryForm.resetFields();
    resetReversalState();
    const today = dayjs();
    const newVoucherNo = generateVoucherNo(entries, today.format('YYYY-MM-DD'));
    entryForm.setFieldsValue({ date: today, voucherNo: newVoucherNo });
    setEditingEntry(null);
    setIsCreatingEntry(true);
    setEntryModalVisible(true);
  };

  const openEditEntry = (rec: LedgerEntry) => {
    entryForm.setFieldsValue({
      date: dayjs(rec.date),
      voucherNo: rec.voucherNo,
      description: rec.description,
      debitSubjectCode: rec.debitAmount ? rec.subjectCode : undefined,
      creditSubjectCode: rec.creditAmount ? rec.subjectCode : undefined,
      amount: rec.debitAmount || rec.creditAmount || undefined,
    });
    setEditingEntry(rec);
    setIsCreatingEntry(false);
    setEntryModalVisible(true);
  };

  // 冲红：查询凭证
  const handleQueryReversal = () => {
    const vno = (entryForm.getFieldValue('reversalVoucherInput') || reversalVoucherInput || '').trim();
    if (!vno) { message.warning('请输入凭证号'); return; }
    const found = entries.filter(e => e.voucherNo === vno);
    if (found.length === 0) { message.warning(`未找到凭证号 ${vno} 的分录`); return; }
    if (found.some(e => e.description?.startsWith('冲红-'))) {
      message.warning(`凭证 ${vno} 已被冲红，不能重复冲红`); return;
    }
    setReversalVoucherInput(vno);
    setReversalPreview(found);
  };

  const handleSaveEntry = async () => {
    try {
      const values = await entryForm.validateFields();
      const debitSub = subjects.find(s => s.code === values.debitSubjectCode);
      const creditSub = subjects.find(s => s.code === values.creditSubjectCode);
      const dateStr = values.date.format('YYYY-MM-DD');
      const periodStr = dateStr.substring(0, 7);
      const voucherNo = values.voucherNo || '';
      const description = values.description || '';
      const amount = values.amount || 0;

      // 检查期间是否已结账
      if (isCreatingEntry && closedPeriods.includes(periodStr)) {
        message.error(`${periodStr} 已结账，不允许新增分录`);
        return;
      }

      if (isCreatingEntry) {
        const newEntries: LedgerEntry[] = [];
        // 借方分录
        if (values.debitSubjectCode && amount) {
          newEntries.push({
            key: `LE-${Date.now()}-D`,
            date: dateStr,
            voucherNo,
            description,
            subjectCode: values.debitSubjectCode,
            subjectName: debitSub?.name || '',
            debitAmount: amount,
            creditAmount: 0,
            category: debitSub?.category || '',
          });
        }
        // 贷方分录
        if (values.creditSubjectCode && amount) {
          newEntries.push({
            key: `LE-${Date.now()}-C`,
            date: dateStr,
            voucherNo,
            description,
            subjectCode: values.creditSubjectCode,
            subjectName: creditSub?.name || '',
            debitAmount: 0,
            creditAmount: amount,
            category: creditSub?.category || '',
          });
        }
        if (newEntries.length === 0) {
          message.warning('请至少填写借方或贷方科目及金额');
          return;
        }
        saveEntries([...entries, ...newEntries]);
        message.success(`已添加 ${newEntries.length} 条分录`);
      } else if (editingEntry) {
        // 编辑模式：更新当前分录
        const sub = editingEntry.debitAmount ? debitSub : creditSub;
        const updated = entries.map(e => e.key === editingEntry.key ? {
          ...e,
          date: dateStr,
          voucherNo,
          description,
          subjectCode: sub?.code || editingEntry.subjectCode,
          subjectName: sub?.name || editingEntry.subjectName,
          debitAmount: editingEntry.debitAmount ? amount : 0,
          creditAmount: editingEntry.creditAmount ? amount : 0,
          category: sub?.category || editingEntry.category,
        } : e);
        saveEntries(updated);
        message.success('分录已更新');
      }
      setEntryModalVisible(false);
      resetReversalState();
    } catch { /* validation */ }
  };

  // 冲红：确认执行反向记账
  const handleConfirmReversal = () => {
    if (reversalPreview.length === 0) { message.warning('请先查询凭证'); return; }
    const today = dayjs();
    const dateStr = today.format('YYYY-MM-DD');
    const periodStr = dateStr.substring(0, 7);
    if (closedPeriods.includes(periodStr)) {
      message.error(`${periodStr} 已结账，不允许冲红`); return;
    }
    const newVoucherNo = generateVoucherNo(entries, dateStr);
    const reversalEntries: LedgerEntry[] = reversalPreview.map(e => ({
      key: `LE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: dateStr,
      voucherNo: newVoucherNo,
      description: `冲红-${reversalVoucherInput}: ${e.description || ''}`,
      subjectCode: e.subjectCode,
      subjectName: e.subjectName,
      debitAmount: e.creditAmount || 0,
      creditAmount: e.debitAmount || 0,
      category: e.category,
    }));
    saveEntries([...entries, ...reversalEntries]);
    message.success(`冲红完成，已生成反向凭证 ${newVoucherNo}（${reversalEntries.length} 条分录）`);
    setEntryModalVisible(false);
    resetReversalState();
  };

  const handleDeleteEntry = (key: string) => {
    saveEntries(entries.filter(e => e.key !== key));
    message.success('分录已删除');
  };

  // ===================== 筛选 =====================
  const filteredEntries = useMemo(() => {
    let list = entries;
    if (filterCategory) list = list.filter(e => e.category === filterCategory);
    if (filterSubject) list = list.filter(e => e.subjectCode === filterSubject);
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(e =>
        e.description.toLowerCase().includes(q) ||
        e.voucherNo.toLowerCase().includes(q) ||
        e.subjectName.toLowerCase().includes(q)
      );
    }
    if (dateRange[0] && dateRange[1]) {
      const start = dateRange[0].format('YYYY-MM-DD');
      const end = dateRange[1].format('YYYY-MM-DD');
      list = list.filter(e => e.date >= start && e.date <= end);
    }
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, filterCategory, filterSubject, searchText, dateRange]);

  // 余额表计算：从分录中增量推导每个科目在每个期间的期初/发生/期末余额
  const balanceMap = useMemo(() => {
    // 收集所有期间（YYYY-MM）
    const periodSet = new Set<string>();
    entries.forEach(e => { if (e.date) periodSet.add(e.date.substring(0, 7)); });
    const allPeriods = Array.from(periodSet).sort();

    const result = new Map<string, Map<string, { openD: number; openC: number; pD: number; pC: number }>>();

    subjects.forEach(sub => {
      const periodsMap = new Map<string, { openD: number; openC: number; pD: number; pC: number }>();
      allPeriods.forEach(period => {
        periodsMap.set(period, { openD: 0, openC: 0, pD: 0, pC: 0 });
      });
      result.set(sub.code, periodsMap);
    });

    // 按期间累积
    const sortedPeriods = allPeriods;
    for (let i = 0; i < sortedPeriods.length; i++) {
      const period = sortedPeriods[i];
      // 从前期结转
      if (i > 0) {
        const prevPeriod = sortedPeriods[i - 1];
        subjects.forEach(sub => {
          const prev = result.get(sub.code)?.get(prevPeriod);
          const curr = result.get(sub.code)?.get(period);
          if (prev && curr) {
            curr.openD = prev.openD + prev.pD;
            curr.openC = prev.openC + prev.pC;
          }
        });
      }
      // 累加本期分录
      entries.forEach(e => {
        const ePeriod = e.date?.substring(0, 7);
        if (ePeriod === period && result.has(e.subjectCode)) {
          const m = result.get(e.subjectCode)?.get(period);
          if (m) {
            m.pD += e.debitAmount || 0;
            m.pC += e.creditAmount || 0;
          }
        }
      });
    }
    return result;
  }, [entries, subjects]);

  // 当前选择期间的余额表（显示所有科目）
  const periodBalanceRows: BalanceRow[] = useMemo(() => {
    const period = selectedPeriod.format('YYYY-MM');
    // 如果当前期间在 balanceMap 中没有数据，从上期结转
    const hasData = balanceMap.size > 0 && Array.from(balanceMap.values()).some(pm => pm.has(period));

    if (!hasData) {
      // 查找最近一期有数据的期间的期末余额作为本期期初
      const allPeriods = new Set<string>();
      balanceMap.forEach(pm => pm.forEach((_, p) => allPeriods.add(p)));
      const sortedPrevPeriods = Array.from(allPeriods).filter(p => p < period).sort();

      if (sortedPrevPeriods.length > 0) {
        // 找最近一期有数据的期间，累积其期末余额
        // 需要从最近一期累积到当前期间之前的所有期间
        const lastKnownPeriod = sortedPrevPeriods[sortedPrevPeriods.length - 1];
        // 先取最后一期的期末余额
        const baseBalances = new Map<string, { openD: number; openC: number }>();
        subjects.forEach(sub => {
          const data = balanceMap.get(sub.code)?.get(lastKnownPeriod);
          if (data) {
            baseBalances.set(sub.code, {
              openD: data.openD + data.pD,
              openC: data.openC + data.pC,
            });
          }
        });

        return subjects.map(sub => {
          const base = baseBalances.get(sub.code);
          const openD = base?.openD || 0;
          const openC = base?.openC || 0;
          const openingBalance = sub.direction === 'debit' ? openD - openC : openC - openD;
          return {
            subjectCode: sub.code,
            subjectName: sub.name,
            category: sub.category,
            direction: sub.direction,
            openingBalance,
            periodDebit: 0,
            periodCredit: 0,
            closingBalance: openingBalance,
          };
        }).sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
      }
    }

    return subjects.map(sub => {
      const data = balanceMap.get(sub.code)?.get(period);
      const openD = data?.openD || 0;
      const openC = data?.openC || 0;
      const pD = data?.pD || 0;
      const pC = data?.pC || 0;
      const openingBalance = sub.direction === 'debit' ? openD - openC : openC - openD;
      const closingBalance = sub.direction === 'debit' ? (openD + pD) - (openC + pC) : (openC + pC) - (openD + pD);
      return {
        subjectCode: sub.code,
        subjectName: sub.name,
        category: sub.category,
        direction: sub.direction,
        openingBalance,
        periodDebit: pD,
        periodCredit: pC,
        closingBalance,
      };
    }).sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
  }, [subjects, balanceMap, selectedPeriod]);

  // 分录汇总（会计分录标签页用）
  const summary = useMemo(() => {
    const totalDebit = filteredEntries.reduce((s, e) => s + (e.debitAmount || 0), 0);
    const totalCredit = filteredEntries.reduce((s, e) => s + (e.creditAmount || 0), 0);
    return { totalDebit, totalCredit, balance: totalDebit - totalCredit };
  }, [filteredEntries]);

  // 按类别汇总（余额表期末余额）
  const categoryTotals = useMemo(() => {
    const result: Record<string, number> = {};
    ACCOUNT_CATEGORIES.forEach(c => { result[c.key] = 0; });
    periodBalanceRows.forEach(r => {
      result[r.category] = (result[r.category] || 0) + r.closingBalance;
    });
    return result;
  }, [periodBalanceRows]);

  // 科目名称底色：与科目表类别同色实底 + 统一白色文字
  const renderSubjectName = (v: string, category?: string) => {
    const cat = ACCOUNT_CATEGORIES.find(c => c.key === category);
    if (!cat) return <Text strong>{v}</Text>;
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, background: cat.color, color: '#fff', fontWeight: 600, lineHeight: '20px' }}>
        {v}
      </span>
    );
  };

  // 科目表列
  // 自动记账科目锁定判定：名单命中或带 auto 标记（自动创建）
  const isLockedSubject = (s: LedgerSubject) => autoSubjectNames.includes(s.name) || (s as any).auto === true;
  const subjectColumns: ColumnsType<LedgerSubject> = [
    { title: '科目编码', dataIndex: 'code', key: 'code', width: 100, sorter: (a, b) => a.code.localeCompare(b.code) },
    { title: '科目名称', dataIndex: 'name', key: 'name', width: 160,
      render: (v: string, r: LedgerSubject) => renderSubjectName(v, r.category) },
    { title: '类别', dataIndex: 'category', key: 'category', width: 110, align: 'center',
      render: (v: string) => {
        const cat = ACCOUNT_CATEGORIES.find(c => c.key === v);
        return cat ? <Tag color={cat.color}>{cat.label}</Tag> : <Tag>{v}</Tag>;
      } },
    { title: '余额方向', dataIndex: 'direction', key: 'direction', width: 90, align: 'center',
      render: (v: string) => <Tag color={v === 'debit' ? 'blue' : 'orange'}>{v === 'debit' ? '借方' : '贷方'}</Tag> },
    { title: '操作', key: 'action', width: 120, align: 'center',
      render: (_: any, r: LedgerSubject) => (
        isLockedSubject(r) ? (
          <Tag color="default" title="自动记账使用的科目：禁止修改和删除" style={{ color: '#8c8c8c' }}>自动</Tag>
        ) : (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditSubject(r)}>编辑</Button>
          <Popconfirm title="确定删除此科目？" onConfirm={() => handleDeleteSubject(r.key)} okText="确认" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ) ) },
  ];

  // 分录列
  const entryColumns: ColumnsType<LedgerEntry> = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
    { title: '凭证号', dataIndex: 'voucherNo', key: 'voucherNo', width: 150,
      render: (v: string) => v ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <a onClick={(e) => { e.stopPropagation(); openVoucherView(v); }}
            style={{ color: PRIMARY, fontWeight: 500 }}>{v}</a>
          <CopyOutlined style={{ color: '#8c8c8c', cursor: 'pointer', fontSize: 13 }}
            onClick={(e) => { e.stopPropagation(); copyText(v).then(ok => (ok ? message.success('已复制凭证号') : message.error('复制失败，请手动复制'))); }} />
        </span>
      ) : <Text type="secondary">—</Text> },
    { title: '摘要', dataIndex: 'description', key: 'description', width: 180, ellipsis: true },
    { title: '科目编码', dataIndex: 'subjectCode', key: 'subjectCode', width: 90 },
    { title: '科目名称', dataIndex: 'subjectName', key: 'subjectName', width: 130,
      render: (v: string, r: LedgerEntry) => renderSubjectName(v, r.category) },
    { title: '借方金额', dataIndex: 'debitAmount', key: 'debitAmount', width: 120, align: 'right',
      render: (v: number) => v ? <Text style={{ color: '#1890ff', fontWeight: 600 }}>{fmt(v)}</Text> : <Text type="secondary">—</Text> },
    { title: '贷方金额', dataIndex: 'creditAmount', key: 'creditAmount', width: 120, align: 'right',
      render: (v: number) => v ? <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{fmt(v)}</Text> : <Text type="secondary">—</Text> },
    { title: '类别', dataIndex: 'category', key: 'category', width: 90, align: 'center',
      render: (v: string) => {
        const cat = ACCOUNT_CATEGORIES.find(c => c.key === v);
        return cat ? <Tag color={cat.color} style={{ fontSize: 11 }}>{cat.label}</Tag> : <Tag>{v || '—'}</Tag>;
      } },
    { title: '操作', key: 'action', width: 100, align: 'center', fixed: 'right' as const,
      render: (_: any, r: LedgerEntry) => {
        const period = r.date?.substring(0, 7) || '';
        if (closedPeriods.includes(period)) {
          return <Text type="secondary">已结账</Text>;
        }
        if ((r as any).auto) {
          return <Tag color="default" style={{ fontSize: 11 }}>自动</Tag>;
        }
        return (
          <Space size="small">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditEntry(r)}>编辑</Button>
            <Popconfirm title="确定删除此分录？" onConfirm={() => handleDeleteEntry(r.key)} okText="确认" cancelText="取消">
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        );
      } },
  ];

  // 净利润 = 收入 - 费用
  const netProfit = (categoryTotals['revenue'] || 0) - (categoryTotals['expense'] || 0);

  // 余额表列（科目汇总标签页用）；简易模式：数据源置于科目名称后、期末余额替换为环比差额
  const summaryMonthStr = selectedPeriod.format('YYYY-MM');
  const colCode = { title: '科目编码', dataIndex: 'subjectCode', key: 'subjectCode', width: 90 };
  const colName = { title: '科目名称', dataIndex: 'subjectName', key: 'subjectName', width: 140,
    render: (v: string, r: BalanceRow) => renderSubjectName(v, r.category) };
  const colCategory = { title: '类别', dataIndex: 'category', key: 'category', width: 90, align: 'center' as const,
    render: (v: string) => {
      const cat = ACCOUNT_CATEGORIES.find(c => c.key === v);
      return cat ? <Tag color={cat.color}>{cat.label}</Tag> : <Tag>{v}</Tag>;
    } };
  const colOpening = { title: simple ? '上期金额' : '期初余额', dataIndex: 'openingBalance', key: 'openingBalance', width: 120, align: 'right' as const,
    render: (v: number) => v ? <Text style={{ fontWeight: 600 }}>¥{fmt(v)}</Text> : <Text type="secondary">—</Text> };
  const colDataSource = { title: '数据源', key: 'dataSource', width: 190, align: 'center' as const,
    render: (_v: any, r: BalanceRow) => {
      const eff = srcDraft[r.subjectCode] ?? summarySources[r.subjectCode];
      return (
        <Space size={4}>
          <Select size="small" allowClear style={{ width: 118 }} placeholder="选择"
            value={eff?.source}
            onChange={v => {
              const saved = summarySources[r.subjectCode];
              const apply = () => setSrcDraft(prev => ({ ...prev, [r.subjectCode]: { source: v || '', manualMonths: eff?.manualMonths } }));
              // 已保存数据源被更换/删除：弹窗提醒后再生效
              if (saved?.source && (v || '') !== saved.source) {
                const oldLabel = SOURCE_OPTIONS.find(o => o.value === saved.source)?.label || saved.source;
                Modal.confirm({
                  title: v ? '更换数据源提醒' : '删除数据源提醒',
                  content: v
                    ? `该科目已保存数据源「${oldLabel}」，更换为「${SOURCE_OPTIONS.find(o => o.value === v)?.label || v}」后本期金额将按新数据源重新计算，是否继续？`
                    : `该科目已保存数据源「${oldLabel}」，删除后本期金额将清空，是否继续？`,
                  okText: '继续', cancelText: '取消', onOk: apply,
                });
              } else apply();
            }}
            options={SOURCE_OPTIONS.filter(o => o.value !== 'daily' || r.category === 'revenue' || r.category === 'expense')} />
          {srcDraft[r.subjectCode] && (
            <Button size="small" type="link" onClick={() => saveSourceRow(r.subjectCode)}>保存</Button>
          )}
        </Space>
      );
    } };
  // 数据源说明：选择数据源后展示取数来源口径
  const SOURCE_DESCS: Record<string, string> = {
    bank: '银行账户列表中所有银行账户的余额汇总',
    inventory: '成品列表中全部商品的实际库存 × 成本价总和',
    raw: '原材料列表中全部原材料的实际库存 × 成本价总和',
    semi: '半成品列表中全部半成品的实际库存 × 成本价总和',
    receivable: '简易账薄-其他应收款中未收余额（应收金额−已收金额）总和',
    payable: '简易账薄-其他应付款中未付余额（应付金额−已付金额）总和',
    platform: '店铺管理-月末盘点-店铺资金中所选月份的已到账+待到账+剩余推广费+保证金总和',
    ar: '客户基础信息所有客户的应收欠款（采购总额−已收货款）总和',
    ap: '采购商平台供应商列表的应付欠款（采购金额−已付货款）总和',
    salary: '人事管理-工资计算中所选月份的实发总额合计',
    daily: '日常记账中所选月份内主分类与本科目名称一致、且收支类型与科目类别（收入/费用）匹配的金额总和（不含已作废）',
    manual: '手动输入的金额，仅对所选月份有效',
  };
  const colSourceDesc = { title: '数据源说明', key: 'sourceDesc', width: 240, align: 'left' as const,
    render: (_v: any, r: BalanceRow) => {
      const eff = srcDraft[r.subjectCode] ?? summarySources[r.subjectCode];
      const desc = eff?.source ? (SOURCE_DESCS[eff.source] || '') : '';
      if (!desc) return <Text type="secondary">—</Text>;
      return <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: desc }}>{desc}</Text>;
    } };
  const colPeriodAmount = { title: '本期金额', key: 'periodAmount', width: 130, align: 'right' as const,
    render: (_v: any, r: BalanceRow) => {
      const eff = srcDraft[r.subjectCode] ?? summarySources[r.subjectCode];
      // 手动输入数据源：本期金额可编辑，且仅对所选月份有效（按月存储）
      if (eff?.source === 'manual') {
        return (
          <InputNumber size="small" style={{ width: 110 }} precision={2}
            value={eff.manualMonths?.[summaryMonthStr] ?? 0}
            onChange={v => setSrcDraft(prev => ({ ...prev, [r.subjectCode]: { ...eff, manualMonths: { ...(eff.manualMonths || {}), [summaryMonthStr]: Number(v) || 0 } } }))} />
        );
      }
      const amt = sourceAmountMap[r.subjectCode] || 0;
      return amt ? <Text strong style={{ color: PRIMARY }}>¥{fmt(amt)}</Text> : <Text type="secondary">—</Text>;
    } };
  // 环比差额 = 上期金额 − 本期金额
  const colMomDiff = { title: '环比差额', key: 'momDiff', width: 120, align: 'right' as const,
    render: (_v: any, r: BalanceRow) => {
      const diff = (Number(r.openingBalance) || 0) - (sourceAmountMap[r.subjectCode] || 0);
      return <Text strong style={{ color: diff >= 0 ? '#52c41a' : '#ff4d4f' }}>¥{fmt(diff)}</Text>;
    } };
  const summaryColumns: ColumnsType<BalanceRow> = simple
    ? [colCode, colName, colDataSource, colSourceDesc, colCategory, colOpening, colPeriodAmount, colMomDiff]
    : [colCode, colName, colCategory, colOpening,
      { title: '本期借方', dataIndex: 'periodDebit', key: 'periodDebit', width: 120, align: 'right' as const,
        render: (v: number) => v ? <Text style={{ color: '#1890ff', fontWeight: 600 }}>¥{fmt(v)}</Text> : <Text type="secondary">—</Text> },
      { title: '本期贷方', dataIndex: 'periodCredit', key: 'periodCredit', width: 120, align: 'right' as const,
        render: (v: number) => v ? <Text style={{ color: '#fa8c16', fontWeight: 600 }}>¥{fmt(v)}</Text> : <Text type="secondary">—</Text> },
      { title: '期末余额', dataIndex: 'closingBalance', key: 'closingBalance', width: 120, align: 'right' as const,
        render: (v: number) => <Text strong style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>¥{fmt(v)}</Text> },
    ];

  const [activeTab, setActiveTab] = useState<'entry' | 'subject' | 'summary' | 'receivable' | 'payable'>('entry');
  // 切换标签页时回读科目与自动记账锁定名单（其他页面自动创建的科目即时可见）
  useEffect(() => { loadData(); }, [activeTab, loadData]);

  // 简易账薄-科目汇总：数据源配置（按科目编码保存）
  const SOURCE_OPTIONS = [
    { value: 'bank', label: '银行账户余额' },
    { value: 'inventory', label: '库存商品' },
    { value: 'raw', label: '原材料' },
    { value: 'semi', label: '半成品' },
    { value: 'receivable', label: '其他应收款' },
    { value: 'payable', label: '其他应付款' },
    { value: 'platform', label: '平台资金' },
    { value: 'ar', label: '应收账款' },
    { value: 'ap', label: '应付账款' },
    { value: 'salary', label: '应付工资' },
    { value: 'daily', label: '日常记账' },
    { value: 'manual', label: '手动输入' },
  ];
  const sourcesKey = `ledger_summary_sources_${getDataOwner()}`;
  const [summarySources, setSummarySources] = useState<Record<string, { source: string; manualAmount?: number; manualMonths?: Record<string, number> }>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(sourcesKey) || '{}');
      // 旧版手动金额（不分月）迁移为仅当月有效
      const cur = dayjs().format('YYYY-MM');
      Object.values(parsed || {}).forEach((e: any) => {
        if (e && e.source === 'manual' && e.manualAmount != null && !e.manualMonths) {
          e.manualMonths = { [cur]: Number(e.manualAmount) || 0 };
          delete e.manualAmount;
        }
      });
      // 与默认预设合并：用户已配置的优先，未配置的科目自动补入默认数据源
      const merged = { ...DEFAULT_SOURCES };
      Object.entries(parsed || {}).forEach(([code, cfg]) => { merged[code] = cfg as any; });
      // 若有新增的默认项尚未保存，回写 localStorage 保持后续一致
      if (Object.keys(merged).length > Object.keys(parsed || {}).length) {
        safeSetItem(sourcesKey, JSON.stringify(merged));
      }
      return merged;
    } catch { return { ...DEFAULT_SOURCES }; }
  });
  const [srcDraft, setSrcDraft] = useState<Record<string, { source: string; manualAmount?: number; manualMonths?: Record<string, number> }>>({});
  // 刷新计数：点击刷新键强制重算数据源金额
  const [refreshTick, setRefreshTick] = useState(0);
  // 期末结转快照（简易模式）：按月份保存各科目本期金额；下月期初余额由此取数
  const periodSnapKey = `ledger_period_amounts_${getDataOwner()}`;
  const [periodAmountSnaps, setPeriodAmountSnaps] = useState<Record<string, Record<string, number>>>(() => {
    try { return JSON.parse(localStorage.getItem(periodSnapKey) || '{}'); } catch { return {}; }
  });
  const saveSourceRow = (code: string) => {
    const d = srcDraft[code];
    if (!d) return;
    const next = { ...summarySources, [code]: d };
    setSummarySources(next);
    safeSetItem(sourcesKey, JSON.stringify(next));
    setSrcDraft(prev => { const n = { ...prev }; delete n[code]; return n; });
    message.success('数据源已保存');
  };
  // 按数据源计算本期金额（平台资金/应付工资取当前选择月份）
  const sourceAmountMap = useMemo(() => {
    const owner = getDataOwner();
    const monthStr = selectedPeriod.format('YYYY-MM');
    const calc = (src: string): number => {
      switch (src) {
        case 'bank': {
          try { const bas: any[] = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${owner}`) || '[]'); return (Array.isArray(bas) ? bas : []).reduce((s, b) => s + (Number(b.balance) || 0), 0); } catch { return 0; }
        }
        case 'inventory': {
          // 成品列表口径：productType === '成品' 的实际库存 × 成本价总和
          try { return readProductListSync(owner).filter((p: any) => p.productType === '成品').reduce((s, p: any) => s + (Number(p.actualStock) || 0) * (Number(p.costPrice) || 0), 0); } catch { return 0; }
        }
        case 'raw': {
          try { return readProductListSync(owner).filter((p: any) => p.productType === '原材料').reduce((s, p: any) => s + (Number(p.actualStock) || 0) * (Number(p.costPrice) || 0), 0); } catch { return 0; }
        }
        case 'semi': {
          try { return readProductListSync(owner).filter((p: any) => p.productType === '半成品').reduce((s, p: any) => s + (Number(p.actualStock) || 0) * (Number(p.costPrice) || 0), 0); } catch { return 0; }
        }
        case 'receivable': {
          // 未收余额口径：应收金额 − 已收金额
          try { const rs: any[] = JSON.parse(localStorage.getItem(`other_receivables_${owner}`) || '[]'); return (Array.isArray(rs) ? rs : []).reduce((s, r) => s + ((Number(r.amount) || 0) - (Number(r.receivedAmount) || 0)), 0); } catch { return 0; }
        }
        case 'payable': {
          // 未付余额口径：应付金额 − 已付金额
          try { const ps: any[] = JSON.parse(localStorage.getItem(`other_payables_${owner}`) || '[]'); return (Array.isArray(ps) ? ps : []).reduce((s, r) => s + ((Number(r.amount) || 0) - (Number(r.paidAmount) || 0)), 0); } catch { return 0; }
        }
        case 'platform': {
          try { const cs: any[] = JSON.parse(localStorage.getItem(`month_end_check_${owner}`) || '[]'); return (Array.isArray(cs) ? cs : []).filter(r => r.calcMonth === monthStr).reduce((s, r) => s + (Number(r.currentBalance) || 0) + (Number(r.pendingAmount) || 0) + (Number(r.adFunds) || 0) + (Number(r.deposit) || 0), 0); } catch { return 0; }
        }
        case 'ar': {
          // 与客户基础信息口径一致：应收欠款取 customer_pay_summary 快照（采购−已收），记录字段为陈旧遗留
          try { ensureCustomerSummaryBuilt(owner, {}); const m = loadCustomerSummary(owner); return Object.values(m).reduce((s: number, e: any) => s + toYuan((e?.purchaseTotal || 0) - (e?.receivedTotal || 0)), 0); } catch { return 0; }
        }
        case 'ap': {
          try { ensureSupplierSummaryBuilt(owner); const m = loadSupplierSummary(owner); return Object.values(m).reduce((s: number, e: any) => s + toYuan((e?.purchaseTotal || 0) - (e?.paidTotal || 0)), 0); } catch { return 0; }
        }
        case 'salary': {
          try { const ss: any[] = JSON.parse(localStorage.getItem(`hr_salary_${owner}`) || '[]'); return (Array.isArray(ss) ? ss : []).filter(r => r.month === monthStr).reduce((s, r) => s + (Number(r.netPay) || 0), 0); } catch { return 0; }
        }
        default: return 0;
      }
    };
    const cache: Record<string, number> = {};
    const map: Record<string, number> = {};
    periodBalanceRows.forEach(r => {
      const eff = srcDraft[r.subjectCode] ?? summarySources[r.subjectCode];
      if (!eff || !eff.source) { map[r.subjectCode] = 0; return; }
      if (eff.source === 'manual') { map[r.subjectCode] = Number(eff.manualMonths?.[monthStr]) || 0; return; }
      if (eff.source === 'daily') {
        // 日常记账数据源：仅收入/费用类别科目可选；按科目名称匹配日常记账主分类、收支类型匹配科目类别
        const wantType = r.category === 'revenue' ? '收入' : r.category === 'expense' ? '支出' : '';
        if (!wantType) { map[r.subjectCode] = 0; return; }
        const ck = `daily|${wantType}|${r.subjectName}`;
        if (cache[ck] === undefined) {
          let sum = 0;
          try {
            const bs: any[] = JSON.parse(localStorage.getItem(`daily_bookkeeping_${owner}`) || '[]');
            sum = (Array.isArray(bs) ? bs : []).filter(b => !b.isVoided && b.bookType === wantType && String(b.bookDate || '').slice(0, 7) === monthStr && dailyMainOf(b.category) === r.subjectName)
              .reduce((s, b) => s + (Number(b.amount) || 0), 0);
          } catch { sum = 0; }
          cache[ck] = sum;
        }
        map[r.subjectCode] = cache[ck];
        return;
      }
      if (cache[eff.source] === undefined) cache[eff.source] = calc(eff.source);
      map[r.subjectCode] = cache[eff.source];
    });
    return map;
  }, [srcDraft, summarySources, selectedPeriod, periodBalanceRows, refreshTick]);
  // 简易模式上期金额：取上月期末结转保存的本期金额快照；未结转则为 0
  const prevMonthStr = selectedPeriod.subtract(1, 'month').format('YYYY-MM');
  const simpleBalanceRows: BalanceRow[] = useMemo(() => (simple
    ? periodBalanceRows.map(r => ({ ...r, openingBalance: periodAmountSnaps[prevMonthStr]?.[r.subjectCode] ?? 0 }))
    : periodBalanceRows), [simple, periodBalanceRows, periodAmountSnaps, prevMonthStr]);
  const [pageSizeEntry, setPageSizeEntry] = useState(20);
  const [pageSizeSubject, setPageSizeSubject] = useState(30);
  const [pageSizeSummary, setPageSizeSummary] = useState(15);
  const [tableScrollY, setTableScrollY] = useState<number | string>('calc(100vh - 360px)');
  const tableWrapRef = useRef<HTMLDivElement>(null);
  // 科目汇总表列宽拖拽自由调整（持久化）
  const { wrapColumns: wrapSummaryCols } = useResizableColumns<BalanceRow>(`colWidths_ledgerSummary_${getDataOwner()}`);

  const calcTableScrollY = useCallback(() => {
    if (!tableWrapRef.current) return;
    const tableBody = tableWrapRef.current.querySelector('.ant-table-body') as HTMLElement | null;
    if (!tableBody) return;
    const rect = tableBody.getBoundingClientRect();
    const paginationH = 56;
    const y = Math.max(220, window.innerHeight - rect.top - paginationH);
    setTableScrollY(y);
    tableBody.style.minHeight = `${y}px`;
  }, []);

  useEffect(() => {
    calcTableScrollY();
    const t1 = setTimeout(calcTableScrollY, 200);
    const t2 = setTimeout(calcTableScrollY, 600);
    window.addEventListener('resize', calcTableScrollY);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', calcTableScrollY); };
  }, [calcTableScrollY, activeTab]);

  return (
    <div ref={tableWrapRef} style={{ height: '100%', overflow: 'hidden', padding: 0 }}>
      {/* 顶部 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} styles={{ body: { padding: '16px 24px' } }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <BookOutlined style={{ fontSize: 22, color: PRIMARY }} />
              <Title level={4} style={{ margin: 0, color: PRIMARY }}>{simple ? '简易账薄' : '会计账薄'}</Title>
              <Switch checked={modeOn} onChange={handleModeToggle} checkedChildren="已开启" unCheckedChildren="未开启" />
              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{simple ? '开启简易账薄（关闭会计账薄）' : '开启会计账薄（关闭简易账薄）'}</span>
            </Space>
          </Col>
          {!simple && (
          <Col>
            <Space wrap>
              <RangePicker
                value={dateRange as [dayjs.Dayjs, dayjs.Dayjs]}
                onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
                style={{ width: 240 }}
              />
              <Select allowClear placeholder="科目类别" style={{ width: 120 }} value={filterCategory || undefined}
                onChange={v => setFilterCategory(v || '')}
                options={ACCOUNT_CATEGORIES.map(c => ({ value: c.key, label: c.label }))} />
              <Select allowClear showSearch placeholder="科目" style={{ width: 150 }} value={filterSubject || undefined}
                onChange={v => setFilterSubject(v || '')}
                filterOption={(input, option) =>
                  String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
                }
                options={subjects.map(s => ({ value: s.code, label: `${s.code} ${s.name}` }))} />
              <Input placeholder="搜索摘要/凭证号" value={searchText} onChange={e => setSearchText(e.target.value)}
                allowClear style={{ width: 140 }} prefix={<SearchOutlined />} />
              <Button icon={<ReloadOutlined />} onClick={loadData}>刷新</Button>
            </Space>
          </Col>
          )}
        </Row>
      </Card>

      {/* 标签页切换 */}
      <Card style={{ borderRadius: 8, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }} styles={{ body: { padding: '0 0 16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' } }}>
        <div style={{ padding: '12px 24px 0', display: 'flex', gap: 8, borderBottom: '1px solid #f0f0f0' }}>
          <Button type={activeTab === 'entry' ? 'primary' : 'default'}
            icon={<BookOutlined />} onClick={() => setActiveTab('entry')} style={activeTab === 'entry' ? { color: '#fff' } : undefined}>{simple ? '日常记账' : '会计分录'}</Button>
          {!simple && (
            <Button type={activeTab === 'subject' ? 'primary' : 'default'}
              icon={<FundOutlined />} onClick={() => setActiveTab('subject')} style={activeTab === 'subject' ? { color: '#fff' } : undefined}>科目表</Button>
          )}
          {simple && (
            <Button type={activeTab === 'receivable' ? 'primary' : 'default'}
              icon={<WalletOutlined />} onClick={() => setActiveTab('receivable')} style={activeTab === 'receivable' ? { color: '#fff' } : undefined}>其他应收款</Button>
          )}
          {simple && (
            <Button type={activeTab === 'payable' ? 'primary' : 'default'}
              icon={<WalletOutlined />} onClick={() => setActiveTab('payable')} style={activeTab === 'payable' ? { color: '#fff' } : undefined}>其他应付款</Button>
          )}
          <Button type={activeTab === 'summary' ? 'primary' : 'default'}
            icon={<DownloadOutlined />} onClick={() => setActiveTab('summary')} style={activeTab === 'summary' ? { color: '#fff' } : undefined}>科目汇总</Button>
        </div>

        <div style={{ padding: simple && activeTab === 'entry' ? 0 : '16px 24px' }}>
          {activeTab === 'entry' && (simple ? <DailyBookkeepingPage flush /> : (
            <>
              <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                <Col>
                  <Space>
                    <Text type="secondary">共 {filteredEntries.length} 条分录</Text>
                    <Divider type="vertical" />
                    <Text>借方合计: <Text strong style={{ color: '#1890ff' }}>¥{fmt(summary.totalDebit)}</Text></Text>
                    <Text>贷方合计: <Text strong style={{ color: '#fa8c16' }}>¥{fmt(summary.totalCredit)}</Text></Text>
                    <Text>差额: <Text strong style={{ color: Math.abs(summary.balance) < 0.01 ? '#52c41a' : '#ff4d4f' }}>¥{fmt(summary.balance)}</Text></Text>
                  </Space>
                </Col>
                <Col>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateEntry} style={{ color: '#fff' }}>新增分录</Button>
                </Col>
              </Row>
              <Table<LedgerEntry>
                bordered
                columns={entryColumns}
                dataSource={filteredEntries}
                rowKey="key"
                size="middle"
                scroll={{ x: 1100, y: tableScrollY }}
                pagination={{ pageSize: pageSizeEntry, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], onShowSizeChange: (_c, s) => setPageSizeEntry(s), showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无分录数据，请点击"新增分录"添加' }}
                summary={() => {
                  if (filteredEntries.length === 0) return null;
                  return (
                    <Table.Summary.Row style={{ background: '#fafafa' }}>
                      <Table.Summary.Cell index={0} colSpan={5} align="right">
                        <Text strong>合计</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong style={{ color: '#1890ff' }}>{fmt(summary.totalDebit)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="right">
                        <Text strong style={{ color: '#fa8c16' }}>{fmt(summary.totalCredit)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={7} colSpan={2} />
                    </Table.Summary.Row>
                  );
                }}
              />
            </>
          ))}

          {activeTab === 'receivable' && <OtherReceivablesPanel />}

          {activeTab === 'payable' && <OtherPayablesPanel />}

          {activeTab === 'subject' && (
            <>
              <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                <Col>
                  <Text type="secondary">共 {subjects.length} 个科目</Text>
                </Col>
                <Col>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateSubject} style={{ color: '#fff' }}>新增科目</Button>
                </Col>
              </Row>
              <Table<LedgerSubject>
                bordered
                columns={subjectColumns}
                dataSource={subjects}
                rowKey="key"
                size="middle"
                scroll={{ y: tableScrollY }}
                pagination={{ pageSize: pageSizeSubject, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], onShowSizeChange: (_c, s) => setPageSizeSubject(s), showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无科目' }}
              />
            </>
          )}

          {activeTab === 'summary' && (
            <>
              {/* 分类统计卡片 */}
              <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
                <Col span={5}>
                  <Card size="small" style={{ borderTop: '3px solid #1890ff' }}>
                    <Statistic title="总资产" value={categoryTotals['asset'] || 0} precision={2} prefix="¥"
                      valueStyle={{ color: '#1890ff', fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={5}>
                  <Card size="small" style={{ borderTop: '3px solid #fa8c16' }}>
                    <Statistic title="总负债" value={categoryTotals['liability'] || 0} precision={2} prefix="¥"
                      valueStyle={{ color: '#fa8c16', fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={5}>
                  <Card size="small" style={{ borderTop: '3px solid #722ed1' }}>
                    <Statistic title="所有者权益" value={categoryTotals['equity'] || 0} precision={2} prefix="¥"
                      valueStyle={{ color: '#722ed1', fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={5}>
                  <Card size="small" style={{ borderTop: '3px solid #52c41a' }}>
                    <Statistic title="总收入" value={categoryTotals['revenue'] || 0} precision={2} prefix="¥"
                      valueStyle={{ color: '#52c41a', fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col span={4}>
                  <Card size="small" style={{ borderTop: '3px solid #ff4d4f' }}>
                    <Statistic title="总费用" value={categoryTotals['expense'] || 0} precision={2} prefix="¥"
                      valueStyle={{ color: '#ff4d4f', fontWeight: 700 }} />
                  </Card>
                </Col>
              </Row>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={12}>
                  <Card size="small" style={{ borderTop: `3px solid ${netProfit >= 0 ? '#52c41a' : '#ff4d4f'}` }}>
                    <Statistic title="净利润（收入 − 费用）" value={netProfit} precision={2} prefix={netProfit >= 0 ? '+¥' : '-¥'}
                      valueStyle={{ color: netProfit >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700, fontSize: 20 }} />
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" style={{ borderTop: '3px solid #1890ff' }}>
                    <Statistic title="净资产（资产 − 负债）" value={(categoryTotals['asset'] || 0) - (categoryTotals['liability'] || 0)} precision={2} prefix="¥"
                      valueStyle={{ color: '#1890ff', fontWeight: 700, fontSize: 20 }} />
                  </Card>
                </Col>
              </Row>
              <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                <Col>
                  <Space>
                    <Text type="secondary">余额表（{selectedPeriod.format('YYYY-MM')}）</Text>
                    <DatePicker picker="month" value={selectedPeriod} onChange={v => { if (v) setSelectedPeriod(v); }}
                      style={{ width: 140 }} allowClear={false} />
                    {closedPeriods.includes(selectedPeriod.format('YYYY-MM')) && (
                      <Tag color="green" style={{ fontSize: 13, padding: '2px 8px' }}>已结账</Tag>
                    )}
                  </Space>
                </Col>
                <Col>
                  <Space>
                    {simple && <Button icon={<ReloadOutlined />} onClick={() => {
                      try { setSummarySources(JSON.parse(localStorage.getItem(sourcesKey) || '{}')); } catch { /* ignore */ }
                      loadData();
                      setRefreshTick(t => t + 1);
                      message.success('数据已刷新');
                    }}>刷新</Button>}
                    {simple && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateSubject} style={{ color: '#fff' }}>新增科目</Button>}
                    {closedPeriods.includes(selectedPeriod.format('YYYY-MM')) ? (
                      <Button danger onClick={handleUnclosePeriod}>反结账</Button>
                    ) : (
                      <>
                        <Button type="primary" onClick={handleClosePeriod}>期末结转</Button>
                        {!simple && <Button onClick={handleYearEndClosing}>年度结转</Button>}
                      </>
                    )}
                  </Space>
                </Col>
              </Row>
              <Table
                bordered
                columns={wrapSummaryCols(summaryColumns)}
                dataSource={simpleBalanceRows}
                rowKey="subjectCode"
                size="middle"
                scroll={{ x: simple ? 1150 : 900, y: tableScrollY }}
                pagination={{ pageSize: pageSizeSummary, showSizeChanger: true, pageSizeOptions: ['10', '15', '20', '50', '100'], onShowSizeChange: (_c, s) => setPageSizeSummary(s), showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无汇总数据' }}
                summary={() => {
                  if (simpleBalanceRows.length === 0) return null;
                  const totalOpen = simpleBalanceRows.reduce((s: number, r: BalanceRow) => s + r.openingBalance, 0);
                  // 简易模式列结构：编码|名称|数据源|数据源说明|类别|期初|本期金额|环比差额
                  if (simple) {
                    const totalAmt = simpleBalanceRows.reduce((s: number, r: BalanceRow) => s + (sourceAmountMap[r.subjectCode] || 0), 0);
                    const totalDiff = totalOpen - totalAmt;
                    return (
                      <Table.Summary.Row style={{ background: '#fafafa' }}>
                        <Table.Summary.Cell index={0} colSpan={5} align="right">
                          <Text strong>合计</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right">
                          <Text strong>¥{fmt(totalOpen)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="right">
                          <Text strong style={{ color: PRIMARY }}>¥{fmt(totalAmt)}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="right">
                          <Text strong style={{ color: totalDiff >= 0 ? '#52c41a' : '#ff4d4f' }}>¥{fmt(totalDiff)}</Text>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    );
                  }
                  const totalDebit = simpleBalanceRows.reduce((s: number, r: BalanceRow) => s + r.periodDebit, 0);
                  const totalCredit = simpleBalanceRows.reduce((s: number, r: BalanceRow) => s + r.periodCredit, 0);
                  const totalClose = simpleBalanceRows.reduce((s: number, r: BalanceRow) => s + r.closingBalance, 0);
                  return (
                    <Table.Summary.Row style={{ background: '#fafafa' }}>
                      <Table.Summary.Cell index={0} colSpan={3} align="right">
                        <Text strong>合计</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Text strong>¥{fmt(totalOpen)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Text strong style={{ color: '#1890ff' }}>¥{fmt(totalDebit)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong style={{ color: '#fa8c16' }}>¥{fmt(totalCredit)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="right">
                        <Text strong style={{ color: totalClose >= 0 ? '#52c41a' : '#ff4d4f' }}>¥{fmt(totalClose)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
              />
            </>
          )}
        </div>
      </Card>

      {/* 科目弹窗 */}
      <Modal
        title={`${simple ? '简易账薄' : '会计账薄'} - ${isCreatingSubject ? '新增科目' : '编辑科目'}`}
        open={subjectModalVisible}
        onOk={handleSaveSubject}
        onCancel={() => setSubjectModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={480}
        destroyOnClose
      >
        <Form autoComplete="off" form={subjectForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="选择已有科目（编辑/删除）">
            <Select allowClear showSearch optionFilterProp="label" placeholder="选择科目进行编辑或删除；清空则为新增"
              value={editingSubject?.key}
              onChange={key => {
                if (!key) { openCreateSubject(); return; }
                const rec = subjects.find(s => s.key === key);
                if (rec) openEditSubject(rec);
              }}
              options={subjects.map(s => ({ value: s.key, label: `${s.code} ${s.name}` }))} />
          </Form.Item>
          {editingSubject && !isLockedSubject(editingSubject) && (
            <div style={{ marginBottom: 12, textAlign: 'right' }}>
              <Popconfirm title={`删除科目 ${editingSubject.code} ${editingSubject.name}？`} description="删除后该科目的数据源配置将一并移除"
                okText="确认" cancelText="取消"
                onConfirm={() => {
                  const code = editingSubject.code;
                  handleDeleteSubject(editingSubject.key);
                  const next = { ...summarySources }; delete next[code];
                  setSummarySources(next); safeSetItem(sourcesKey, JSON.stringify(next));
                  setSubjectModalVisible(false);
                }}>
                <Button danger icon={<DeleteOutlined />}>删除该科目</Button>
              </Popconfirm>
            </div>
          )}
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="code" label="科目编码" rules={[{ required: true, message: '请输入编码' }]}>
                <Input placeholder="如 1001" disabled={!isCreatingSubject} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="name" label="科目名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如 库存现金" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category" label="科目类别" rules={[{ required: true, message: '请选择' }]}>
                <Select options={ACCOUNT_CATEGORIES.map(c => ({ value: c.key, label: c.label }))}
                  onChange={v => { if (!simple) subjectForm.setFieldsValue({ direction: (v === 'asset' || v === 'expense') ? 'debit' : 'credit' }); }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              {simple ? (
                <Form.Item name="dataSource" label="数据源">
                  <Select allowClear placeholder="选择数据源（可选）" options={SOURCE_OPTIONS.filter(o => o.value !== 'daily' || subjectCategoryWatch === 'revenue' || subjectCategoryWatch === 'expense')} />
                </Form.Item>
              ) : (
                <Form.Item name="direction" label="余额方向" rules={[{ required: true, message: '请选择' }]}>
                  <Select options={[{ value: 'debit', label: '借方' }, { value: 'credit', label: '贷方' }]} />
                </Form.Item>
              )}
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 分录弹窗 */}
      <Modal
        title={isCreatingEntry ? '新增分录' : '编辑分录'}
        open={entryModalVisible}
        onOk={handleSaveEntry}
        onCancel={() => { setEntryModalVisible(false); resetReversalState(); }}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form autoComplete="off" form={entryForm} layout="vertical" style={{ marginTop: 16 }}>
          {isCreatingEntry && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type={reversalMode ? 'primary' : 'default'}
                danger={!reversalMode}
                icon={<SwapOutlined />}
                onClick={() => { setReversalMode(!reversalMode); setReversalPreview([]); setReversalVoucherInput(''); try { entryForm.setFieldValue('reversalVoucherInput', ''); } catch { /* */ } }}
              >
                冲红
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>对已有凭证进行冲红（反向记账）</Text>
            </div>
          )}
          {isCreatingEntry && reversalMode && (
            <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, color: '#d46b08' }}>冲红模式：输入凭证号查询并冲红</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Form.Item name="reversalVoucherInput" noStyle>
                  <Input placeholder="输入凭证号，如 PZ-20261007-001" style={{ flex: 1 }} />
                </Form.Item>
                <Button type="primary" onClick={handleQueryReversal}>查询凭证</Button>
              </div>
              {reversalPreview.length > 0 && (
                <>
                  <Table
                    bordered size="small" pagination={false} dataSource={reversalPreview} rowKey="key"
                    columns={[
                      { title: '摘要', dataIndex: 'description', key: 'description', width: 160, ellipsis: true },
                      { title: '科目', key: 'subject', width: 120, render: (_: any, e: LedgerEntry) => `${e.subjectCode} ${e.subjectName}` },
                      { title: '借方', dataIndex: 'debitAmount', key: 'debitAmount', width: 90, align: 'right',
                        render: (v: number) => v ? <Text style={{ color: '#1890ff' }}>{fmt(v)}</Text> : '—' },
                      { title: '贷方', dataIndex: 'creditAmount', key: 'creditAmount', width: 90, align: 'right',
                        render: (v: number) => v ? <Text style={{ color: '#fa8c16' }}>{fmt(v)}</Text> : '—' },
                    ]}
                  />
                  <Button type="primary" danger style={{ marginTop: 8, width: '100%' }} onClick={handleConfirmReversal}>
                    确认冲红（生成反向分录）
                  </Button>
                </>
              )}
              <Alert type="warning" showIcon message="冲红将创建反向分录：原借方→新贷方，原贷方→新借方" style={{ marginTop: 8 }} />
            </div>
          )}
          {!reversalMode && (
            <>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="voucherNo" label="凭证号">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="摘要">
            <Input.TextArea rows={2} placeholder="业务说明（选填）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="debitSubjectCode" label="借方会计科目">
                <Select showSearch placeholder="搜索科目" allowClear
                  filterOption={(input, option) =>
                    String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={subjects.map(s => ({ value: s.code, label: `${s.code} ${s.name}` }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="creditSubjectCode" label="贷方会计科目">
                <Select showSearch placeholder="搜索科目" allowClear
                  filterOption={(input, option) =>
                    String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={subjects.map(s => ({ value: s.code, label: `${s.code} ${s.name}` }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
                <InputNumber style={{ width: '100%' }} precision={2} prefix="¥" placeholder="0.00" min={0} />
              </Form.Item>
            </Col>
          </Row>
            </>
          )}
        </Form>
      </Modal>

      {/* 查看凭证弹窗 */}
      <Modal
        title={null}
        open={voucherModalVisible}
        onCancel={() => setVoucherModalVisible(false)}
        footer={null}
        width={860}
        destroyOnClose
      >
        {(() => {
          const voucherEntries = entries.filter(e => e.voucherNo === viewingVoucherNo);
          if (voucherEntries.length === 0) return <Text type="secondary">未找到凭证数据</Text>;
          const first = voucherEntries[0];
          const dp = first.date.split('-');
          const cnDate = `${dp[0]}年${parseInt(dp[1])}月${parseInt(dp[2])}日`;
          const digitHeaders = ['千', '百', '十', '万', '千', '百', '十', '元', '角', '分'];
          const dgStyle: React.CSSProperties = { border: '1px solid #5a8a5a', padding: '4px 1px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, width: 26 };

          const formatAmount = (amt: number) => {
            if (!amt) return { digits: Array(10).fill(''), hasValue: false };
            const str = Math.abs(amt).toFixed(2);
            const [intPart, decPart = ''] = str.split('.');
            const paddedDigits = intPart.padStart(8, ' ').split('').map(c => c === ' ' ? '' : c);
            return { digits: [...paddedDigits, decPart[0] || '0', decPart[1] || '0'], hasValue: true };
          };

          let totalDebit = 0, totalCredit = 0;
          voucherEntries.forEach(e => { totalDebit += e.debitAmount || 0; totalCredit += e.creditAmount || 0; });
          const totalDebitFmt = formatAmount(totalDebit);
          const totalCreditFmt = formatAmount(totalCredit);

          return (
            <div style={{ fontFamily: 'SimSun, serif', padding: '0 8px' }}>
              <div style={{ textAlign: 'center', marginBottom: 2 }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 8, color: '#333' }}>记 账 凭 证</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: '#555' }}>
                <span>{cnDate}</span>
                <span>记字第 {viewingVoucherNo} 号</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #5a8a5a' }}>
                <thead>
                  <tr style={{ background: '#eef7ee' }}>
                    <th rowSpan={2} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', width: 100, fontSize: 13 }}>摘 要</th>
                    <th rowSpan={2} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', width: 70, fontSize: 13 }}>会计科目</th>
                    <th colSpan={10} style={{ border: '1px solid #5a8a5a', padding: '4px 0', fontSize: 13, color: '#c00' }}>借 方 金 额</th>
                    <th colSpan={10} style={{ border: '1px solid #5a8a5a', padding: '4px 0', fontSize: 13, color: '#06c' }}>贷 方 金 额</th>
                  </tr>
                  <tr style={{ background: '#eef7ee' }}>
                    {digitHeaders.map((h, i) => <td key={`dh-${i}`} style={{ fontSize: 11, color: '#888', border: '1px solid #5a8a5a', padding: '2px 0', textAlign: 'center' }}>{h}</td>)}
                    {digitHeaders.map((h, i) => <td key={`ch-${i}`} style={{ fontSize: 11, color: '#888', border: '1px solid #5a8a5a', padding: '2px 0', textAlign: 'center' }}>{h}</td>)}
                  </tr>
                </thead>
                <tbody>
                  {voucherEntries.map((e, idx) => {
                    const isDebit = !!(e.debitAmount && e.debitAmount > 0);
                    const amtFmt = formatAmount(isDebit ? e.debitAmount : e.creditAmount);
                    return (
                      <tr key={idx}>
                        <td style={{ border: '1px solid #5a8a5a', padding: '8px 6px', fontSize: 13 }}>{e.description || '—'}</td>
                        <td style={{ border: '1px solid #5a8a5a', padding: '8px 4px', fontSize: 13, textAlign: 'center' }}>{e.subjectCode} {e.subjectName}</td>
                        {amtFmt.digits.map((d: string, i: number) => (
                          <td key={`d-${i}`} style={{ ...dgStyle, fontWeight: isDebit ? 600 : 400, color: isDebit ? '#333' : '#ccc' }}>{isDebit ? d : ''}</td>
                        ))}
                        {amtFmt.digits.map((d: string, i: number) => (
                          <td key={`c-${i}`} style={{ ...dgStyle, fontWeight: !isDebit ? 600 : 400, color: !isDebit ? '#333' : '#ccc' }}>{!isDebit ? d : ''}</td>
                        ))}
                      </tr>
                    );
                  })}
                  {[0, 1].map(n => (
                    <tr key={`empty-${n}`}>
                      <td style={{ border: '1px solid #5a8a5a', padding: '12px 6px' }}>&nbsp;</td>
                      <td style={{ border: '1px solid #5a8a5a', padding: '12px 4px' }}>&nbsp;</td>
                      {Array(20).fill(0).map((_, i) => <td key={i} style={{ border: '1px solid #5a8a5a', padding: '12px 1px' }}>&nbsp;</td>)}
                    </tr>
                  ))}
                  <tr style={{ background: '#eef7ee', fontWeight: 700 }}>
                    <td colSpan={2} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', fontSize: 13, textAlign: 'center' }}>合 计 金 额</td>
                    {totalDebitFmt.digits.map((d: string, i: number) => (
                      <td key={`sd-${i}`} style={{ ...dgStyle, color: '#c00' }}>{d}</td>
                    ))}
                    {totalCreditFmt.digits.map((d: string, i: number) => (
                      <td key={`sc-${i}`} style={{ ...dgStyle, color: '#06c' }}>{d}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#666' }}>
                <span>附件 0 张</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 16, paddingTop: 12, borderTop: '2px solid #5a8a5a', fontSize: 13 }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#666' }}>记账：</span>
                  <span style={{ color: PRIMARY, fontWeight: 500 }}>{first.bookkeeper || getDisplayName()}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#666' }}>审核：</span>
                  <span style={{ fontWeight: 500 }}>{first.auditor || '______'}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#666' }}>出纳：</span>
                  <span style={{ fontWeight: 500 }}>{first.cashier || '______'}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};

export default GeneralLedgerPage;
