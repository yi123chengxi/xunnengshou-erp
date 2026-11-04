import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, DatePicker,
  Row, Col, Select, Tag, Empty, Image, Popconfirm,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, DownloadOutlined, SearchOutlined,
  AccountBookOutlined, ArrowUpOutlined, ArrowDownOutlined, WalletOutlined,
  PictureOutlined, SnippetsOutlined, FundOutlined, CheckOutlined,
  EyeOutlined, FileTextOutlined, StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import useResizableColumns from '../hooks/useResizableColumns';
import { safeSetItem } from '../utils/storageQuota';
import { compressImageFile } from '../utils/imageCompress';
import { removeBankTransaction } from '../utils/accountingBridge';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

// 二级分类体系（主分类 → 子分类）
interface CategoryGroup { name: string; subs: string[]; }
const INCOME_HIERARCHY: CategoryGroup[] = [
  { name: '主营业务收入', subs: ['销售收入', '销售退货'] },
  { name: '其他业务收入', subs: ['其他收入'] },
  { name: '营业外收入', subs: [] },
];
const EXPENSE_HIERARCHY: CategoryGroup[] = [
  { name: '销售费用', subs: ['采购支出', '差旅费', '运输费', '广告推广费'] },
  { name: '管理费用', subs: ['办公费用', '水电费', '工资社保', '税费'] },
  { name: '财务费用', subs: ['报销', '其他支出'] },
];
// 兼容旧版扁平分类名称（映射到 主分类-子分类）
const LEGACY_CATEGORY_MAP: Record<string, string> = {};
INCOME_HIERARCHY.forEach(g => g.subs.forEach(s => { LEGACY_CATEGORY_MAP[s] = `${g.name}-${s}`; }));
EXPENSE_HIERARCHY.forEach(g => g.subs.forEach(s => { LEGACY_CATEGORY_MAP[s] = `${g.name}-${s}`; }));
// 全部子分类名称集合（用于类型切换时的过滤判断）
const ALL_INCOME_SUBS = INCOME_HIERARCHY.flatMap(g => g.subs);
const ALL_EXPENSE_SUBS = EXPENSE_HIERARCHY.flatMap(g => g.subs);

// 自定义主分类（含随机底色）
interface CustomMainCategory {
  name: string;
  color: string;
}
// 预置主分类颜色映射（收入=冷色调，支出=暖色调）
const PRESET_MAIN_COLORS: Record<string, string> = {
  '主营业务收入': '#52c41a', '其他业务收入': '#13c2c2', '营业外收入': '#2f54eb',
  '销售费用': '#fa8c16', '管理费用': '#722ed1', '财务费用': '#eb2f96',
};
// 冷色调颜色池（收入主分类用：绿/蓝/青）
const COOL_COLOR_POOL = [
  '#52c41a', '#13c2c2', '#2f54eb', '#36cfc9', '#597ef7', '#95de64',
  '#73d13d', '#1890ff', '#40a9ff', '#87e8de', '#5cdbd3', '#08979c',
];
// 暖色调颜色池（支出主分类用：橙/紫/红/粉）
const WARM_COLOR_POOL = [
  '#fa8c16', '#722ed1', '#eb2f96', '#f5222d', '#fa541c', '#faad14',
  '#b37feb', '#f759ab', '#ff85c0', '#ff7a45', '#ffc53d', '#cf1322',
];
const generateUniqueColor = (existingColors: string[], type?: string): string => {
  const pool = type === '收入' ? COOL_COLOR_POOL : type === '支出' ? WARM_COLOR_POOL : [...COOL_COLOR_POOL, ...WARM_COLOR_POOL];
  const available = pool.filter(c => !existingColors.includes(c));
  if (available.length > 0) return available[Math.floor(Math.random() * available.length)];
  // 所有预设色用完后，按色调生成随机 HSL 色
  const hue = type === '收入' ? Math.floor(Math.random() * 120 + 120)  // 120-240 冷色区间
    : type === '支出' ? Math.floor(Math.random() * 60 + 330) % 360    // 330-30 暖色区间
    : Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 55%)`;
};

interface BookRecord {
  key: string;
  voucherNo?: string;    // 凭证编号
  bookDate: string;      // 记账日期 YYYY-MM-DD
  bookType: '收入' | '支出';
  category: string;      // 分类
  amount: number;        // 金额
  counterparty: string;  // 收支对方
  remark: string;        // 记账说明
  person: string;        // 记账人
  payAccount?: string;   // 付款账户（支出/内部转账）
  recvAccount?: string;  // 收款账户（收入/内部转账）
  recvBank?: string;     // 收款银行（开户银行）
  payBank?: string;      // 付款银行（开户银行）
  image?: string;        // 图片（base64）
  isPersonalAdvance?: boolean;  // 本人垫付
  isReturn?: boolean;           // 收入退货（金额记负数）
  advanceRecvAccount?: string;  // 垫付收款账户
  linkedReimbursementKey?: string;  // 关联的报销单key
  isVoided?: boolean;    // 是否作废
  reversalOf?: string;   // 冲红的原始凭证key
  autoSourceKey?: string; // 自动记账来源幂等键（财审等业务联动写入，存在即系统来源）
  auditor?: string;      // 审核人
  cashier?: string;      // 出纳
  department?: string;   // 部门（子账号分组名称）
  createdAt: string;
}

// 收款账户类型（本人垫付）
interface ReceivingAccount {
  key: string;
  type: '支付宝' | '银行账户' | '收款码';  // 账户类型
  name: string;      // 账户名称/显示名
  account: string;   // 账号（收款码时可空）
  bankName?: string; // 银行名称（银行账户时）
  remark?: string;   // 备注
  image?: string;    // 收款码图片（base64）
}

// 数据所有者（子账号归集到主账号）
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// 本人垫付收款账户：每个子账号独立账户库（存储键按当前登录账号区分）
const getRecvAccountKey = (): string => `receiving_accounts_${localStorage.getItem('username') || getDataOwner() || 'admin'}`;

// 记账人显示名称：账号管理中的姓名（displayName > 联系人 > name），子账号同理
const getDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u?.displayName || u?.contactPerson || u?.name) return u.displayName || u.contactPerson || u.name;
  } catch { /* ignore */ }
  return username;
};

/** 日常记账：三平台共用的收支流水登记页（存储键 daily_bookkeeping_<owner>） */
const DailyBookkeepingPage: React.FC<{ flush?: boolean }> = ({ flush = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [records, setRecords] = useState<BookRecord[]>([]);
  const [bookPageSize, setBookPageSize] = useState(15);  // 每页显示条数（受控，showSizeChanger 切换生效）
  const [dkBodyHeight, setDkBodyHeight] = useState<number | undefined>(undefined);
  // 表体高度 = 表体顶边到窗口底边剩余空间（预留分页行），min=max 使横向滚动条始终固定在窗口最下方
  useEffect(() => {
    const calc = () => {
      const body = document.querySelector('.dk-main-table .ant-table-body') as HTMLElement | null;
      if (!body) return;
      const top = body.getBoundingClientRect().top;
      const h = Math.max(220, window.innerHeight - top - 84);
      body.style.minHeight = `${h}px`;
      setDkBodyHeight(h);
    };
    // 不用 ResizeObserver：回调内改高度会触发 RO loop 告警；表体顶边只随窗口宽度（筛选栏换行）变化，窗口 resize 重算即可
    const timer = setTimeout(calc, 150);
    const timer2 = setTimeout(calc, 600);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(timer); clearTimeout(timer2); window.removeEventListener('resize', calc); };
  }, []);
  // 搜索（输入态 + 已应用态）
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [typeInput, setTypeInput] = useState('');
  const [typeApplied, setTypeApplied] = useState('');
  const [rangeInput, setRangeInput] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [rangeApplied, setRangeApplied] = useState<[string, string] | null>(null);
  // 扩展搜索字段
  const [sMainCat, setSMainCat] = useState('');
  const [sMainCatApplied, setSMainCatApplied] = useState('');
  const [sSubCat, setSSubCat] = useState('');
  const [sSubCatApplied, setSSubCatApplied] = useState('');
  const [sAmount, setSAmount] = useState('');
  const [sAmountApplied, setSAmountApplied] = useState('');
  const [sRecvBank, setSRecvBank] = useState('');
  const [sRecvBankApplied, setSRecvBankApplied] = useState('');
  const [sPayBank, setSPayBank] = useState('');
  const [sPayBankApplied, setSPayBankApplied] = useState('');
  const [sPerson, setSPerson] = useState('');
  const [sPersonApplied, setSPersonApplied] = useState('');
  const [sRemark, setSRemark] = useState('');
  const [sRemarkApplied, setSRemarkApplied] = useState('');
  // 新增/编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<BookRecord | null>(null);
  const [formDate, setFormDate] = useState<dayjs.Dayjs | null>(dayjs());
  const [formType, setFormType] = useState<'' | '收入' | '支出' | '内部转账' | '冲红'>('');
  const [formCategory, setFormCategory] = useState('');
  const [formMainCategory, setFormMainCategory] = useState('');  // 选中的主分类
  const [formAmount, setFormAmount] = useState<number | undefined>(undefined);
  const [formCounterparty, setFormCounterparty] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formPayAccount, setFormPayAccount] = useState('');
  const [formRecvAccount, setFormRecvAccount] = useState('');
  // 自定义分类（持久化 daily_book_categories_<owner>）
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [catAddMode, setCatAddMode] = useState(false);
  const [catAddInput, setCatAddInput] = useState('');
  // 自定义主分类（持久化 daily_book_main_categories_<owner>）
  const [customMainCategories, setCustomMainCategories] = useState<CustomMainCategory[]>([]);
  const [mainCatAddMode, setMainCatAddMode] = useState(false);
  const [mainCatAddInput, setMainCatAddInput] = useState('');
  // 冲红凭证编号输入
  const [formReversalVoucherNo, setFormReversalVoucherNo] = useState('');
  // 银行账户列表（收款/付款账户下拉数据源）
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  // 图片上传
  const [formImage, setFormImage] = useState('');
  // 凭证详情弹窗
  const [voucherDetailVisible, setVoucherDetailVisible] = useState(false);
  const [voucherDetailRecord, setVoucherDetailRecord] = useState<BookRecord | null>(null);
  // 部门（账户管理分组名称）
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [formDepartment, setFormDepartment] = useState('');
  // 本人垫付相关
  const [formIsAdvance, setFormIsAdvance] = useState(false);  // 是否勾选本人垫付
  const [formIsReturn, setFormIsReturn] = useState(false);  // 收入退货标记（金额记负数、表单红色加粗）
  const [formAdvanceRecv, setFormAdvanceRecv] = useState('');  // 垫付收款账户key
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccount[]>([]);  // 收款账户列表
  const [recvModalVisible, setRecvModalVisible] = useState(false);  // 新增/编辑收款账户弹窗
  const [recvEditItem, setRecvEditItem] = useState<ReceivingAccount | null>(null);
  const [recvFormType, setRecvFormType] = useState<'支付宝' | '银行账户' | '收款码'>('支付宝');
  const [recvFormName, setRecvFormName] = useState('');
  const [recvFormAccount, setRecvFormAccount] = useState('');
  const [recvFormBank, setRecvFormBank] = useState('');
  const [recvFormRemark, setRecvFormRemark] = useState('');
  const [recvFormImage, setRecvFormImage] = useState('');  // 收款码图片

  // 从剪切板读取图片
  const handlePasteImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const dataUrl = await compressImageFile(blob);
          setFormImage(dataUrl);
          message.success('已从剪切板粘贴图片');
          return;
        }
      }
      message.warning('剪切板中没有图片内容');
    } catch {
      message.warning('无法读取剪切板，请复制图片后重试');
    }
  }, []);

  // 点击上传文件
  const handleUploadImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (ev: any) => {
      const file = ev.target?.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { message.warning('图片大小不能超过5MB'); return; }
      const dataUrl = await compressImageFile(file);
      setFormImage(dataUrl);
    };
    input.click();
  }, []);

  const storageKey = `daily_bookkeeping_${getDataOwner()}`;

  const load = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(`daily_bookkeeping_${getDataOwner()}`) || '[]')); } catch { setRecords([]); }
    try {
      const rawCats = JSON.parse(localStorage.getItem(`daily_book_categories_${getDataOwner()}`) || '[]');
      // 清理历史遗留的单独“退货”子分类（已被“销售退货”预设取代）
      const cleaned = rawCats.filter((c: string) => !c.endsWith('-退货'));
      if (cleaned.length !== rawCats.length) {
        safeSetItem(`daily_book_categories_${getDataOwner()}`, JSON.stringify(cleaned));
      }
      setCustomCategories(cleaned);
    } catch { setCustomCategories([]); }
    try { setCustomMainCategories(JSON.parse(localStorage.getItem(`daily_book_main_categories_${getDataOwner()}`) || '[]')); } catch { setCustomMainCategories([]); }
    try { setReceivingAccounts(JSON.parse(localStorage.getItem(getRecvAccountKey()) || '[]')); } catch { setReceivingAccounts([]); }
    // 加载账户管理分组作为部门选项
    try {
      const groupsKey = `account_groups_${getDataOwner()}`;
      const groupsData = JSON.parse(localStorage.getItem(groupsKey) || '[]');
      const names = Array.isArray(groupsData) ? groupsData.map((g: any) => typeof g === 'string' ? g : g.name).filter(Boolean) : [];
      setDepartmentOptions(names);
    } catch { setDepartmentOptions([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback((list: BookRecord[]) => {
    setRecords(list);
    safeSetItem(`daily_bookkeeping_${getDataOwner()}`, JSON.stringify(list));
  }, []);

  // 解析分类存储值：兼容“主分类-子分类”和旧版扁平名称
  const parseCategory = (stored: string): { main: string; sub: string } => {
    if (stored.includes('-')) {
      const idx = stored.indexOf('-');
      return { main: stored.slice(0, idx), sub: stored.slice(idx + 1) };
    }
    const mapped = LEGACY_CATEGORY_MAP[stored];
    if (mapped) {
      const idx = mapped.indexOf('-');
      return { main: mapped.slice(0, idx), sub: mapped.slice(idx + 1) };
    }
    return { main: '', sub: stored };
  };
  // 组合存储分类值
  const buildCategoryValue = (main: string, sub: string): string => main ? `${main}-${sub}` : sub;

  // 组合筛选
  const filtered = useMemo(() => {
    const kw = searchApplied.trim().toLowerCase();
    const amtStr = sAmountApplied.trim();
    let amtMin: number | null = null, amtMax: number | null = null, amtGt: number | null = null, amtLt: number | null = null;
    if (amtStr) {
      const rangeM = amtStr.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
      const gtM = amtStr.match(/^>=?\s*(\d+(?:\.\d+)?)$/);
      const ltM = amtStr.match(/^<=?\s*(\d+(?:\.\d+)?)$/);
      if (rangeM) { amtMin = parseFloat(rangeM[1]); amtMax = parseFloat(rangeM[2]); }
      else if (gtM) { amtGt = parseFloat(gtM[1]); if (amtStr.includes('>=')) amtMin = amtGt; }
      else if (ltM) { amtLt = parseFloat(ltM[1]); if (amtStr.includes('<=')) amtMax = amtLt; }
      else { const n = parseFloat(amtStr); if (!isNaN(n)) { amtMin = n; amtMax = n; } }
    }
    return records.filter(r => {
      if (kw && !`${r.category || ''}${r.counterparty || ''}${r.remark || ''}`.toLowerCase().includes(kw)) return false;
      if (typeApplied && r.bookType !== typeApplied) return false;
      if (rangeApplied) {
        const d = r.bookDate || '';
        if (d < rangeApplied[0] || d > rangeApplied[1]) return false;
      }
      if (sMainCatApplied) {
        const parsed = parseCategory(r.category || '');
        if (parsed.main !== sMainCatApplied) return false;
      }
      if (sSubCatApplied) {
        const parsed = parseCategory(r.category || '');
        if (parsed.sub !== sSubCatApplied) return false;
      }
      if (amtMin !== null || amtMax !== null) {
        const amt = Math.abs(Number(r.amount) || 0);
        if (amtMin !== null && amt < amtMin) return false;
        if (amtMax !== null && amt > amtMax) return false;
      }
      // 收款/付款银行筛选：下拉值为账户名称，需同时匹配账户名与开户银行（任选其一命中即可）
      if (sRecvBankApplied && !`${r.recvAccount || ''} ${r.recvBank || ''}`.toLowerCase().includes(sRecvBankApplied.toLowerCase())) return false;
      if (sPayBankApplied && !`${r.payAccount || ''} ${r.payBank || ''}`.toLowerCase().includes(sPayBankApplied.toLowerCase())) return false;
      if (sPersonApplied && !(r.person || '').toLowerCase().includes(sPersonApplied.toLowerCase())) return false;
      if (sRemarkApplied && !(r.remark || '').toLowerCase().includes(sRemarkApplied.toLowerCase())) return false;
      return true;
    }).slice().sort((a, b) => (b.bookDate || '').localeCompare(a.bookDate || ''));
  }, [records, searchApplied, typeApplied, rangeApplied, sMainCatApplied, sSubCatApplied, sAmountApplied, sRecvBankApplied, sPayBankApplied, sPersonApplied, sRemarkApplied]);

  // 汇总（排除作废记录）；负债类分类（其他应付款/其他应收款/保证金退回）属现金流非损益，不计入收入/支出合计
  const totals = useMemo(() => {
    const active = filtered.filter(r => !r.isVoided);
    const isLiab = (r: any) => ['其他应付款', '其他应收款', '保证金退回'].includes(String(r.category || ''));
    const inc = active.filter(r => r.bookType === '收入' && !isLiab(r)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const out = active.filter(r => r.bookType === '支出' && !isLiab(r)).reduce((s, r) => s + (Math.abs(Number(r.amount)) || 0), 0);
    return { inc, out, net: inc - out };
  }, [filtered]);

  const loadBankAccounts = useCallback(() => {
    try { setBankAccounts(JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${getDataOwner()}`) || '[]')); } catch { setBankAccounts([]); }
  }, []);
  // 页面加载时读取银行账户（表格收款/付款银行列回退解析用）
  useEffect(() => { loadBankAccounts(); }, [loadBankAccounts]);

  // 银行账户下拉选项：账户名称 + 开户银行 + 脱敏账号（前后各留4位）；值为账户名称
  const bankAccountOptions = useMemo(() => bankAccounts.map((b: any) => {
    const name = b.name || b.shortName || '';
    const no = String(b.bankAccountNo || '').replace(/\s/g, '');
    const masked = no.length <= 8 ? no : `${no.slice(0, 4)} **** **** ${no.slice(-4)}`;
    const bank = `${b.bankName || ''}${b.branchName ? `(${b.branchName})` : ''}`;
    return { label: `${name}　${bank}　${masked}`, value: name };
  }), [bankAccounts]);

  // 主分类引用科目汇总科目名称：打开弹窗时读取科目列表（收入→收入类别科目，支出→费用类别科目）
  const [ledgerSubjects, setLedgerSubjects] = useState<any[]>([]);
  useEffect(() => {
    if (!modalVisible) return;
    try { const list = JSON.parse(localStorage.getItem(`general_ledger_subjects_${getDataOwner()}`) || '[]'); setLedgerSubjects(Array.isArray(list) ? list : []); } catch { setLedgerSubjects([]); }
  }, [modalVisible]);

  // 全部分类 = 预设 + 科目名称 + 自定义
  // 搜索用：所有主分类选项（不分收支类型）
  const allMainCategories = useMemo(() => {
    const preset = [...INCOME_HIERARCHY, ...EXPENSE_HIERARCHY].map(g => g.name);
    const subjectNames = ledgerSubjects.filter((s: any) => s.category === 'revenue' || s.category === 'expense').map((s: any) => s.name);
    const custom = customMainCategories.map(c => c.name);
    return Array.from(new Set([...preset, ...subjectNames, ...custom]));
  }, [customMainCategories, ledgerSubjects]);
  // 搜索用：选中主分类后的子分类选项
  const searchSubCategories = useMemo(() => {
    if (!sMainCat) return [];
    const all = [...INCOME_HIERARCHY, ...EXPENSE_HIERARCHY, ...customMainCategories.map(c => ({ name: c.name, subs: [] as string[] }))];
    const group = all.find(g => g.name === sMainCat);
    const baseSubs = group ? group.subs : [];
    const customSubs = customCategories.filter(c => c.startsWith(`${sMainCat}-`)).map(c => c.replace(`${sMainCat}-`, ''));
    return Array.from(new Set([...baseSubs, ...customSubs])); // 预设与自定义同名去重
  }, [sMainCat, customMainCategories, customCategories]);
  // 当前类型的分类层级：主分类引用科目汇总科目名称（收入→收入类别，支出→费用类别），并兼容自定义主分类
  const currentHierarchy = useMemo((): CategoryGroup[] => {
    const presetSubs = (name: string): string[] => ([...INCOME_HIERARCHY, ...EXPENSE_HIERARCHY].find(g => g.name === name)?.subs || []);
    const subjectGroups: CategoryGroup[] = ledgerSubjects
      .filter((s: any) => (formType === '收入' ? s.category === 'revenue' : formType === '支出' ? s.category === 'expense' : (s.category === 'revenue' || s.category === 'expense')))
      .map((s: any) => ({ name: s.name, subs: presetSubs(s.name) }));
    const customGroups: CategoryGroup[] = customMainCategories
      .filter(c => !subjectGroups.some(g => g.name === c.name))
      .map(c => ({ name: c.name, subs: [] }));
    return [...subjectGroups, ...customGroups];
  }, [formType, customMainCategories, ledgerSubjects]);
  // 当前主分类下的子分类（含自定义分类）
  const currentSubCategories = useMemo(() => {
    if (!formMainCategory) return [];
    const group = currentHierarchy.find(g => g.name === formMainCategory);
    const baseSubs = group ? group.subs : [];
    // 自定义分类归属于当前主分类下
    const customSubs = customCategories.filter(c => c.startsWith(`${formMainCategory}-`)).map(c => c.replace(`${formMainCategory}-`, ''));
    return Array.from(new Set([...baseSubs, ...customSubs])); // 预设与自定义同名去重
  }, [currentHierarchy, formMainCategory, customCategories]);
  const handleAddCategory = () => {
    const name = catAddInput.trim();
    if (!name) { message.warning('请输入分类名称'); return; }
    // 分类名称不能与现有主分类或子分类重复
    const allMainNames = currentHierarchy.map(g => g.name);
    const allSubNames = currentHierarchy.flatMap(g => g.subs);
    if (allMainNames.includes(name) || allSubNames.includes(name)) { message.warning(`分类「${name}」已存在`); return; }
    const fullKey = formMainCategory ? `${formMainCategory}-${name}` : name;
    const updated = [...customCategories, fullKey];
    setCustomCategories(updated);
    safeSetItem(`daily_book_categories_${getDataOwner()}`, JSON.stringify(updated));
    setFormCategory(buildCategoryValue(formMainCategory, name));
    setCatAddMode(false);
    setCatAddInput('');
    message.success(`已新增分类「${name}」`);
  };
  // 新增主分类
  const handleAddMainCategory = () => {
    const name = mainCatAddInput.trim();
    if (!name) { message.warning('请输入主分类名称'); return; }
    const allMainNames = currentHierarchy.map(g => g.name);
    if (allMainNames.includes(name)) { message.warning(`主分类「${name}」已存在`); return; }
    const existingColors = [
      ...Object.values(PRESET_MAIN_COLORS),
      ...customMainCategories.map(c => c.color),
    ];
    const color = generateUniqueColor(existingColors, formType);
    const updated = [...customMainCategories, { name, color }];
    setCustomMainCategories(updated);
    safeSetItem(`daily_book_main_categories_${getDataOwner()}`, JSON.stringify(updated));
    setFormMainCategory(name);
    setFormCategory('');
    setMainCatAddMode(false);
    setMainCatAddInput('');
    message.success(`已新增主分类「${name}」`);
  };

  // 收款账户（本人垫付）相关操作
  const openRecvAddModal = () => {
    setRecvEditItem(null);
    setRecvFormType('支付宝');
    setRecvFormName('');
    setRecvFormAccount('');
    setRecvFormBank('');
    setRecvFormRemark('');
    setRecvFormImage('');
    setRecvModalVisible(true);
  };
  const openRecvEditModal = (item: ReceivingAccount) => {
    setRecvEditItem(item);
    setRecvFormType(item.type);
    setRecvFormName(item.name);
    setRecvFormAccount(item.account);
    setRecvFormBank(item.bankName || '');
    setRecvFormRemark(item.remark || '');
    setRecvFormImage(item.image || '');
    setRecvModalVisible(true);
  };
  // 收款码图片上传
  const handleRecvImageUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (ev: any) => {
      const file = ev.target?.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { message.warning('图片大小不能超过5MB'); return; }
      const dataUrl = await compressImageFile(file);
      setRecvFormImage(dataUrl);
    };
    input.click();
  }, []);
  const handleRecvPasteImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const dataUrl = await compressImageFile(blob);
          setRecvFormImage(dataUrl);
          message.success('已从剪切板粘贴图片');
          return;
        }
      }
      message.warning('剪切板中没有图片内容');
    } catch {
      message.warning('无法读取剪切板，请使用Ctrl+V或点击粘贴按钮');
    }
  }, []);
  const handleSaveRecvAccount = () => {
    if (!recvFormName.trim()) { message.warning('请输入账户名称'); return; }
    if (recvFormType === '收款码') {
      if (!recvFormImage) { message.warning('请上传收款码图片'); return; }
    } else {
      if (!recvFormAccount.trim()) { message.warning('请输入账号'); return; }
    }
    const item: ReceivingAccount = {
      key: recvEditItem?.key || `ra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: recvFormType,
      name: recvFormName.trim(),
      account: recvFormType === '收款码' ? (recvFormAccount.trim() || recvFormName.trim()) : recvFormAccount.trim(),
      bankName: recvFormType === '银行账户' ? recvFormBank.trim() : undefined,
      remark: recvFormRemark.trim() || undefined,
      image: recvFormType === '收款码' ? recvFormImage : undefined,
    };
    let updated: ReceivingAccount[];
    if (recvEditItem) {
      updated = receivingAccounts.map(r => r.key === recvEditItem.key ? item : r);
    } else {
      updated = [...receivingAccounts, item];
    }
    setReceivingAccounts(updated);
    safeSetItem(getRecvAccountKey(), JSON.stringify(updated));
    setFormAdvanceRecv(item.key);
    setRecvModalVisible(false);
    message.success(recvEditItem ? '已更新收款账户' : '已新增收款账户');
  };
  const handleDeleteRecvAccount = (item: ReceivingAccount) => {
    const updated = receivingAccounts.filter(r => r.key !== item.key);
    setReceivingAccounts(updated);
    safeSetItem(getRecvAccountKey(), JSON.stringify(updated));
    if (formAdvanceRecv === item.key) setFormAdvanceRecv('');
    message.success('已删除收款账户');
  };
  // 收款账户下拉选项
  const recvAccountOptions = useMemo(() => receivingAccounts.map(r => ({
    label: `${r.type === '支付宝' ? '🟢' : r.type === '银行账户' ? '🏦' : '📱'} ${r.name} ${r.account}${r.bankName ? ` (${r.bankName})` : ''}`,
    value: r.key,
  })), [receivingAccounts]);
  // 收款账户类型标签
  const recvTypeIcon = (t: string) => t === '支付宝' ? <span style={{ color: '#1677ff' }}>🟢</span> : t === '银行账户' ? <span>🏦</span> : <span>📱</span>;

  // 表格收款/付款银行单元格：账户名称 + 开户银行 + 脱敏账号（两行展示）
  const renderBankCell = (accountName: string, fallbackBank: string) => {
    if (!accountName) return <span style={{ color: '#bbb' }}>—</span>;
    const acc = bankAccounts.find((b: any) => (b.name || b.shortName || '') === accountName);
    const no = String(acc?.bankAccountNo || '').replace(/\s/g, '');
    const masked = no.length <= 8 ? no : `${no.slice(0, 4)} **** **** ${no.slice(-4)}`;
    return (
      <div style={{ lineHeight: 1.5 }}>
        <div style={{ fontWeight: 500 }}>{accountName}</div>
        <div style={{ fontSize: 11, color: '#888' }}>{acc?.bankName || fallbackBank || ''}{no ? ` ${masked}` : ''}</div>
      </div>
    );
  };

  // 生成凭证编号：PZ-YYYYMMDD-XXX
  const generateVoucherNo = useCallback((existingRecords: BookRecord[], date?: string): string => {
    const d = date || dayjs().format('YYYY-MM-DD');
    const prefix = `PZ-${d.replace(/-/g, '')}`;
    const todayCount = existingRecords.filter(r => (r.voucherNo || '').startsWith(prefix)).length;
    return `${prefix}-${String(todayCount + 1).padStart(3, '0')}`;
  }, []);

  // 已期末结转月份（简易账薄期末结转快照键 ledger_period_amounts_）：该月记录作废按键移除、且禁止新增记账
  const loadClosedMonths = (): string[] => {
    try { return Object.keys(JSON.parse(localStorage.getItem(`ledger_period_amounts_${getDataOwner()}`) || '{}')); } catch { return []; }
  };
  const [closedMonths, setClosedMonths] = useState<string[]>(loadClosedMonths);
  useEffect(() => {
    const refresh = () => setClosedMonths(loadClosedMonths());
    window.addEventListener('ledger-period-saved', refresh);
    return () => window.removeEventListener('ledger-period-saved', refresh);
  }, []);

  // 作废记录：同步作废银行账户中对应明细（按备注+金额+方向删除流水并回滚余额）
  const handleVoid = (r: BookRecord) => {
    const updated = records.map(rec => rec.key === r.key ? { ...rec, isVoided: true } : rec);
    save(updated);
    try {
      const owner = getDataOwner();
      const txRemark = r.reversalOf ? `冲红-${r.reversalOf}（凭证${r.voucherNo}）` : `日常记账-${r.category}${r.counterparty ? `-${r.counterparty}` : ''}（凭证${r.voucherNo}）`;
      const amt = Math.abs(Number(r.amount) || 0);
      // 与写入时口径一致：收款账户入账(in)、付款账户出账(out)，内部转账双向均回滚
      if (r.recvAccount) removeBankTransaction(owner, r.recvAccount, 'in', amt, txRemark);
      if (r.payAccount) removeBankTransaction(owner, r.payAccount, 'out', amt, txRemark);
    } catch { /* ignore */ }
    message.success(`凭证 ${r.voucherNo || r.key} 已作废，对应银行明细已同步作废`);
  };

  // 冲红自动填充
  const handleReversalFill = () => {
    const vNo = formReversalVoucherNo.trim();
    if (!vNo) { message.warning('请输入凭证编号'); return; }
    const original = records.find(r => r.voucherNo === vNo);
    if (!original) { message.warning(`未找到凭证编号为「${vNo}」的记录`); return; }
    if (original.isVoided) { message.warning('该凭证已作废，无法冲红'); return; }
    if (records.some(r => r.reversalOf === vNo)) { message.warning(`凭证 ${vNo} 已经冲红过，不能重复冲红`); return; }
    // 自动填充原始凭证内容，冲红用相反收支类型实现金额反转
    setFormCategory(original.category || '');
    const parsed = parseCategory(original.category || '');
    setFormMainCategory(parsed.main);
    setFormCounterparty(original.counterparty || '');
    setFormRemark(`冲红-${vNo}`);
    setFormAmount(Math.abs(Number(original.amount) || 0));  // 保持正数，由 bookType 反转实现冲红
    setFormPayAccount(original.payAccount || '');
    setFormRecvAccount(original.recvAccount || '');
    setFormImage(original.image || '');
    message.success(`已填充凭证 ${vNo} 的冲红内容（${original.bookType === '支出' ? '支出冲红→记为收入' : '收入冲红→记为支出'}）`);
  };

  const openAdd = () => {
    setEditRecord(null);
    setFormDate(dayjs());
    setFormType('');
    setFormCategory('');
    setFormMainCategory('');
    setFormAmount(undefined);
    setFormCounterparty('');
    setFormIsReturn(false);
    setFormRemark('');
    setFormPayAccount('');
    setFormRecvAccount('');
    setFormImage('');
    setFormIsAdvance(false);
    setFormAdvanceRecv('');
    setFormReversalVoucherNo('');
    // 自动填充当前用户部门
    try {
      const username = localStorage.getItem('username') || '';
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === username);
      setFormDepartment(u?.group || '');
    } catch { setFormDepartment(''); }
    setCatAddMode(false); setCatAddInput('');
    setMainCatAddMode(false); setMainCatAddInput('');
    loadBankAccounts();
    setModalVisible(true);
  };
  const openEdit = (r: BookRecord) => {
    setEditRecord(r);
    setFormDate(r.bookDate ? dayjs(r.bookDate) : dayjs());
    // 内部转账记录单独识别为“内部转账”类型
    if (r.category === '内部转账') {
      setFormType('内部转账');
      setFormCategory('内部转账');
      setFormMainCategory('');
    } else {
      setFormType(r.bookType);
      setFormCategory(r.category || '');
      // 解析主分类
      const parsed = parseCategory(r.category || '');
      setFormMainCategory(parsed.main);
    }
    setFormAmount(Math.abs(Number(r.amount) || 0));
    setFormCounterparty(r.counterparty || '');
    setFormRemark(r.remark || '');
    setFormPayAccount(r.payAccount || '');
    setFormRecvAccount(r.recvAccount || '');
    setFormImage(r.image || '');
    // 本人垫付字段恢复
    setFormIsAdvance(!!r.isPersonalAdvance);
    setFormIsReturn(!!r.isReturn);
    setFormAdvanceRecv(r.advanceRecvAccount || '');
    setFormReversalVoucherNo('');
    setFormDepartment(r.department || '');
    setCatAddMode(false); setCatAddInput('');
    setMainCatAddMode(false); setMainCatAddInput('');
    loadBankAccounts();
    setModalVisible(true);
  };

  // ==================== 报销单联动 ====================
  // 解析子分类名称（用于报销单标题）
  const getSubCategoryName = (stored: string): string => {
    const parsed = parseCategory(stored);
    return parsed.sub || stored;
  };
  // 自动生成报销申请单
  const createLinkedReimbursement = (rec: BookRecord): string => {
    const reimKey = `reim-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const bkKey = `reimbursement_${getDataOwner()}`;
    const reims: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
    const subCat = getSubCategoryName(rec.category);
    const reimRec = {
      key: reimKey,
      title: `${subCat}-${rec.counterparty || rec.remark || '垫付报销'}`,
      category: subCat,
      amount: Math.abs(Number(rec.amount)) || 0,
      description: rec.remark || `日常记账垫付-${subCat}`,
      applicant: localStorage.getItem('username') || '',
      applicantName: getDisplayName(),
      applyDate: rec.bookDate,
      status: 'pending_review',
      receipts: rec.image ? [rec.image] : [],
      source: 'daily_book',
      sourceBookKey: rec.key,
      receivingAccount: rec.advanceRecvAccount || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    reims.unshift(reimRec);
    safeSetItem(bkKey, JSON.stringify(reims));
    return reimKey;
  };
  // 同步更新关联的报销单
  const syncLinkedReimbursement = (rec: BookRecord) => {
    if (!rec.linkedReimbursementKey) return;
    const bkKey = `reimbursement_${getDataOwner()}`;
    try {
      const reims: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const subCat = getSubCategoryName(rec.category);
      const updated = reims.map((r: any) => r.key === rec.linkedReimbursementKey ? {
        ...r,
        title: `${subCat}-${rec.counterparty || rec.remark || '垫付报销'}`,
        category: subCat,
        amount: Math.abs(Number(rec.amount)) || 0,
        description: rec.remark || `日常记账垫付-${subCat}`,
        receipts: rec.image ? [rec.image] : r.receipts,
        updatedAt: new Date().toISOString(),
      } : r);
      safeSetItem(bkKey, JSON.stringify(updated));
    } catch { /* ignore */ }
  };
  // 删除关联的报销单
  const deleteLinkedReimbursement = (reimKey: string) => {
    const bkKey = `reimbursement_${getDataOwner()}`;
    try {
      const reims: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const updated = reims.filter((r: any) => r.key !== reimKey);
      safeSetItem(bkKey, JSON.stringify(updated));
    } catch { /* ignore */ }
  };

  const isTransfer = formType === '内部转账';
  const isReversal = formType === '冲红';
  const needRecv = formType === '收入' || isTransfer;
  const needPay = formType === '支出' || isTransfer;
  // 收入退货：金额记负数、从付款账户付出，不选公司收款账户
  const isIncomeReturn = formType === '收入' && formIsReturn;
  const actualNeedRecv = needRecv && !formIsAdvance && !isIncomeReturn;
  // 本人垫付时不需要选择公司付款账户；收入退货需选付款账户记录退款支出
  const actualNeedPay = (needPay || isIncomeReturn) && !formIsAdvance;
  // 付款账户必选：支出/内部转账/收入退货；普通收入可选
  const payRequired = actualNeedPay && (formType !== '收入' || formIsReturn);
  // 切换为非收入类型时重置退货标记
  useEffect(() => { if (formType !== '收入') setFormIsReturn(false); }, [formType]);
  const handleSave = () => {
    if (!formDate) { message.warning('请选择记账日期'); return; }
    if (!formType) { message.warning('请选择收支类型'); return; }
    if (!isTransfer && !isReversal && !formCategory) { message.warning('请选择分类'); return; }
    if (isReversal && !formReversalVoucherNo.trim()) { message.warning('请输入冲红凭证编号'); return; }
    if (isReversal && records.some(r => r.reversalOf === formReversalVoucherNo.trim())) { message.warning(`凭证 ${formReversalVoucherNo.trim()} 已经冲红过，不能重复冲红`); return; }
    if (formAmount === undefined || formAmount === null) { message.warning('请输入金额'); return; }
    if (!isReversal && Number(formAmount) <= 0) { message.warning('请输入大于0的金额'); return; }
    if (actualNeedRecv && !formRecvAccount) { message.warning('请选择收款账户'); return; }
    if (payRequired && !formPayAccount) { message.warning('请选择付款账户'); return; }
    // 本人垫付时校验收款账户
    if (formIsAdvance && !formAdvanceRecv) { message.warning('请选择垫付收款账户'); return; }
    // 冲红时确定原始记录的bookType
    const reversalOriginal = isReversal ? records.find(r => r.voucherNo === formReversalVoucherNo.trim()) : null;
    // 已期末结转月份禁止新增记账记录
    const saveMonth = formDate.format('YYYY-MM');
    if (closedMonths.includes(saveMonth)) {
      message.warning(`${saveMonth} 已期末结转，不能新增记账记录`);
      return;
    }
    const rec: BookRecord = {
      key: editRecord?.key || `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      voucherNo: editRecord?.voucherNo || generateVoucherNo(records, formDate.format('YYYY-MM-DD')),
      bookDate: formDate.format('YYYY-MM-DD'),
      bookType: (isTransfer ? '支出' : isReversal ? (reversalOriginal?.bookType === '支出' ? '收入' : '支出') : formType) as '收入' | '支出',
      category: formCategory,
      amount: isIncomeReturn ? -Math.abs(Number(formAmount)) : Number(formAmount),
      counterparty: formCounterparty.trim(),
      remark: formRemark.trim(),
      person: editRecord?.person || getDisplayName(),
      payAccount: actualNeedPay ? formPayAccount : (isReversal && reversalOriginal && reversalOriginal.bookType === '收入' ? (reversalOriginal.recvAccount || '') : ''),
      recvAccount: actualNeedRecv ? formRecvAccount : (isReversal && reversalOriginal && reversalOriginal.bookType === '支出' ? (reversalOriginal.payAccount || '') : ''),
      recvBank: actualNeedRecv ? (bankAccounts.find((b: any) => (b.name || b.shortName || '') === formRecvAccount)?.bankName || '') : (isReversal && reversalOriginal?.bookType === '支出' ? (reversalOriginal.payBank || '') : ''),
      payBank: actualNeedPay ? (bankAccounts.find((b: any) => (b.name || b.shortName || '') === formPayAccount)?.bankName || '') : (isReversal && reversalOriginal?.bookType === '收入' ? (reversalOriginal.recvBank || '') : ''),
      image: formImage || '',
      isPersonalAdvance: formIsAdvance,
      isReturn: isIncomeReturn,
      advanceRecvAccount: formIsAdvance ? formAdvanceRecv : '',
      linkedReimbursementKey: editRecord?.linkedReimbursementKey || '',
      reversalOf: isReversal ? formReversalVoucherNo.trim() : undefined,
      department: formType === '支出' ? formDepartment : '',
      createdAt: editRecord?.createdAt || new Date().toISOString(),
    };
    // 本人垫付：自动生成报销申请单
    if (formIsAdvance && !editRecord) {
      const reimKey = createLinkedReimbursement(rec);
      rec.linkedReimbursementKey = reimKey;
    }
    // 编辑时同步更新关联的报销单
    if (editRecord && rec.linkedReimbursementKey) {
      syncLinkedReimbursement(rec);
    }
    // 新增时同步写入银行账户明细（收入→收款账户入账；支出→付款账户出账；内部转账→双向）
    if (!editRecord) {
      try {
        const baKey = `pageData_finance_bank-account_${getDataOwner()}`;
        const bas: any[] = JSON.parse(localStorage.getItem(baKey) || '[]');
        const nowTime = `${rec.bookDate} ${new Date().toTimeString().slice(0, 8)}`;
        const txRemark = isReversal ? `冲红-${rec.reversalOf}（凭证${rec.voucherNo}）` : `日常记账-${rec.category}${rec.counterparty ? `-${rec.counterparty}` : ''}（凭证${rec.voucherNo}）`;
        let changed = false;
        const pushTx = (accountName: string, type: 'in' | 'out', amt?: number) => {
          const a = amt !== undefined ? amt : rec.amount;
          const i = bas.findIndex((b: any) => (b.name || b.shortName || '') === accountName);
          if (i < 0) return;
          const bal = Number(bas[i].balance) || 0;
          const nb = type === 'in' ? bal + a : bal - a;
          bas[i].transactions = [...(bas[i].transactions || []), { time: nowTime, type, amount: a, balanceAfter: nb, remark: txRemark, person: rec.person }];
          bas[i].balance = nb;
          changed = true;
        };
        if (rec.recvAccount) pushTx(rec.recvAccount, 'in', isReversal ? Math.abs(rec.amount) : undefined);
        if (rec.payAccount) pushTx(rec.payAccount, 'out', (isIncomeReturn || isReversal) ? Math.abs(rec.amount) : undefined);
        if (changed) safeSetItem(baKey, JSON.stringify(bas));
      } catch { /* ignore */ }
    }
    save(editRecord ? records.map(r => r.key === rec.key ? rec : r) : [rec, ...records]);
    setModalVisible(false);
    if (formIsAdvance && !editRecord) {
      message.success('已新增记账，并自动生成报销申请单');
    } else {
      message.success(editRecord ? '已保存修改' : '已新增记账');
    }
  };

  // 导出CSV
  const handleExport = () => {
    const headers = ['记账日期', '收支类型', '分类', '金额', '收支对方', '账户名称', '开户银行', '银行账号', '部门', '记账说明', '记账人'];
    const rows = filtered.map(r => {
      const accountName = r.bookType === '收入' ? (r.recvAccount || '') : (r.payAccount || '');
      const bankName = r.bookType === '收入' ? (r.recvBank || '') : (r.payBank || '');
      // 从bankAccounts列表中查找银行账号
      const bankAcc = accountName ? bankAccounts.find((b: any) => (b.name || b.shortName || '') === accountName) : null;
      const bankAccountNo = bankAcc?.bankAccountNo || '';
      return [r.bookDate, r.bookType, r.category, String(r.amount), r.counterparty, accountName, bankName, bankAccountNo, r.department || '', r.remark, r.person];
    });
    const csv = '\ufeff' + [headers, ...rows].map(line => line.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `日常记账_${new Date().toLocaleDateString('zh-CN')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success('已导出');
  };

  const { wrapColumns } = useResizableColumns('colWidths_dailyBookkeeping');
  const isReimbursement = (r: BookRecord) => r.key.startsWith('bk-reim-');
  const columns: ColumnsType<BookRecord> = wrapColumns([
    { title: '序号', key: 'rowIndex', width: 50, align: 'center', render: (_v: any, _r: any, idx: number) => idx + 1 },
    { title: '凭证编号', dataIndex: 'voucherNo', key: 'voucherNo', width: 140, align: 'center', render: (v: string, r: BookRecord) => {
      if (!v) return <span style={{ color: '#ccc' }}>—</span>;
      return <span style={{ fontSize: 11, color: r.isVoided ? '#bbb' : '#595959', fontFamily: 'monospace' }}>{v}</span>;
    } },
    { title: '记账日期', dataIndex: 'bookDate', key: 'bookDate', width: 100, align: 'center' },
    { title: '收支类型', dataIndex: 'bookType', key: 'bookType', width: 90, align: 'center', render: (v: string, r: BookRecord) => {
      if (r.reversalOf) return <Tag color="orange" style={{ marginRight: 0 }}>冲红</Tag>;
      return <Tag color={v === '收入' ? 'green' : 'red'} style={{ marginRight: 0 }}>{v}</Tag>;
    } },
    { title: '分类', dataIndex: 'category', key: 'category', width: 120, align: 'center', render: (v: string) => {
      if (!v) return '—';
      if (v === '内部转账') return <Tag color="blue">内部转账</Tag>;
      const parsed = parseCategory(v);
      if (parsed.main) {
        const mainColorMap: Record<string, string> = {
          ...PRESET_MAIN_COLORS,
          ...Object.fromEntries(customMainCategories.map(c => [c.name, c.color])),
        };
        const bgColor = mainColorMap[parsed.main] || '#999';
        return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: bgColor, color: '#fff', fontWeight: 500, fontSize: 12 }}>{parsed.main}</span>;
      }
      return v;
    } },
    { title: '子分类', dataIndex: 'category', key: 'subCategory', width: 100, align: 'center', render: (v: string) => {
      if (!v) return '—';
      if (v === '内部转账') return '—';
      const parsed = parseCategory(v);
      return parsed.sub || '—';
    } },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right', render: (v: number, r: BookRecord) => {
      const absAmt = Math.abs(Number(v) || 0);
      const color = Number(v) < 0 ? '#ff4d4f' : (r.bookType === '收入' ? '#52c41a' : '#ff4d4f');
      const sign = Number(v) < 0 ? '-' : (r.bookType === '收入' ? '+' : '-');
      return (
        <Text strong style={{ color, fontFamily: 'monospace' }}>
          {sign}¥{absAmt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
        </Text>
      );
    } },
    { title: '收支对方', dataIndex: 'counterparty', key: 'counterparty', width: 150, align: 'center', render: (v: string, r: BookRecord) => (
      r.isPersonalAdvance ? (
        <div>
          <Tag color="green">本人垫付</Tag>
          {r.linkedReimbursementKey && <div style={{ fontSize: 11, color: '#722ed1', marginTop: 2 }}>已生成报销单</div>}
        </div>
      ) : (v || '—')
    ) },
    { title: '部门', dataIndex: 'department', key: 'department', width: 80, align: 'center', render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '收款银行', dataIndex: 'recvBank', key: 'recvBank', width: 200, align: 'center', render: (v: string, r: BookRecord) => renderBankCell(r.recvAccount || '', v) },
    { title: '付款银行', dataIndex: 'payBank', key: 'payBank', width: 200, align: 'center', render: (v: string, r: BookRecord) => renderBankCell(r.payAccount || '', v) },
    { title: '记账说明', dataIndex: 'remark', key: 'remark', width: 220, render: (v: string) => v || '—' },
    { title: '图片', dataIndex: 'image', key: 'image', width: 70, align: 'center', render: (v: string) => (
      v ? <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} /> : <span style={{ color: '#ccc' }}>—</span>
    ) },
    { title: '记账人', dataIndex: 'person', key: 'person', width: 90, align: 'center', render: (v: string) => v || '—' },
    { title: '操作', key: 'action', width: 180, align: 'center', render: (_v: any, r: BookRecord) => {
      if (r.isVoided) return <span style={{ color: '#bbb', fontSize: 12 }}>已作废</span>;
      // 已期末结转月份：作废按键移除（仅保留查看凭证）
      const monthClosed = closedMonths.includes((r.bookDate || '').substring(0, 7));
      // 系统来源记录只读：仅“新增记账”手工创建的记录可作废；报销/提现/充值/付款申请/收款确认/财审等自动记账一律不作废（含旧数据无幂等键时按备注前缀兜底识别）
      const reimb = isReimbursement(r) || r.key.startsWith('bk-wd-') || r.key.startsWith('bk-rech-') || r.key.startsWith('bk-pay-') || r.key.startsWith('bk-receipt-') || r.key.startsWith('bk-orec') || r.key.startsWith('bk-opay') || !!r.autoSourceKey || /^(财务审核通过|收款确认|付款申请-|报销-|其他应收款|其他应付款)/.test(r.remark || '');
      return (
        <Space size={2} wrap>
          {r.voucherNo && (
            <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => { setVoucherDetailRecord(r); setVoucherDetailVisible(true); }}>查看凭证</Button>
          )}
          {!reimb && !monthClosed && (
            <Popconfirm title="确定作废该凭证？作废后不可恢复" onConfirm={() => handleVoid(r)}>
              <Button size="small" type="link" danger icon={<StopOutlined />}>作废</Button>
            </Popconfirm>
          )}
        </Space>
      );
    } },
  ] as any);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: flush ? 0 : 16 }}>
      <Card>
        {/* 汇总卡片（单行紧凑卡，内容左缩进）+ 操作按键置于记账笔数右侧 */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', marginBottom: 12, flexWrap: 'wrap' }}>
          <Card size="small" style={{ flex: 1, minWidth: 170, background: '#f6ffed', borderColor: '#b7eb8f' }} bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>收入合计</span>
              <Text strong style={{ color: '#52c41a', fontSize: 16 }}><ArrowUpOutlined style={{ marginRight: 4 }} />{totals.inc.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</Text>
            </div>
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 170, background: '#fff1f0', borderColor: '#ffa39e' }} bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>支出合计</span>
              <Text strong style={{ color: '#ff4d4f', fontSize: 16 }}><ArrowDownOutlined style={{ marginRight: 4 }} />{totals.out.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</Text>
            </div>
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 170, background: '#f0f5ff', borderColor: '#adc6ff' }} bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>收支结余</span>
              <Text strong style={{ color: totals.net >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 16 }}><WalletOutlined style={{ marginRight: 4 }} />{totals.net.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</Text>
            </div>
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 130 }} bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#888' }}>记账笔数</span>
              <Text strong style={{ color: PRIMARY, fontSize: 16 }}>{filtered.length} 笔</Text>
            </div>
          </Card>
          <Space style={{ display: 'flex', alignItems: 'center' }}>
            <Button icon={<FundOutlined />} onClick={() => {
              const p = location.pathname;
              if (p.startsWith('/purchaser/')) navigate('/purchaser/finance/daily-bookkeeping-stats');
              else if (p.startsWith('/factory/')) navigate('/factory/finance/daily-bookkeeping-stats');
              else navigate('/finance/daily-bookkeeping-stats');
            }}>统计分析</Button>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>导出</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增记账</Button>
          </Space>
        </div>

        {/* 搜索栏 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <Input placeholder="搜索分类/对方/说明" allowClear style={{ width: 180 }} value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onPressEnter={() => setSearchApplied(searchInput)} />
          <Select placeholder="收支类型" allowClear style={{ width: 100 }} value={typeInput || undefined}
            onChange={v => { setTypeInput(v || ''); }} options={[{ label: '收入', value: '收入' }, { label: '支出', value: '支出' }]} />
          <DatePicker.RangePicker style={{ width: 240 }} value={rangeInput as any}
            onChange={v => setRangeInput(v as any)} />
          <Select placeholder="分类" allowClear style={{ width: 130 }} value={sMainCat || undefined}
            onChange={v => { setSMainCat(v || ''); setSSubCat(''); }}
            options={allMainCategories.map(n => ({ label: n, value: n }))} />
          <Select placeholder="子分类" allowClear style={{ width: 120 }} value={sSubCat || undefined}
            onChange={v => setSSubCat(v || '')}
            options={searchSubCategories.map(n => ({ label: n, value: n }))} disabled={!sMainCat} />
          <Input placeholder="金额(如100-500)" allowClear style={{ width: 130 }} value={sAmount}
            onChange={e => setSAmount(e.target.value)} />
          <Select placeholder="收款银行" allowClear showSearch style={{ width: 160 }} value={sRecvBank || undefined}
            onChange={v => setSRecvBank(v || '')}
            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            options={bankAccountOptions} />
          <Select placeholder="付款银行" allowClear showSearch style={{ width: 160 }} value={sPayBank || undefined}
            onChange={v => setSPayBank(v || '')}
            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            options={bankAccountOptions} />
          <Input placeholder="记账人" allowClear style={{ width: 100 }} value={sPerson}
            onChange={e => setSPerson(e.target.value)} />
          <Input placeholder="记账说明" allowClear style={{ width: 130 }} value={sRemark}
            onChange={e => setSRemark(e.target.value)} />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => {
            setSearchApplied(searchInput);
            setTypeApplied(typeInput);
            setRangeApplied(rangeInput && rangeInput[0] && rangeInput[1] ? [rangeInput[0].format('YYYY-MM-DD'), rangeInput[1].format('YYYY-MM-DD')] : null);
            setSMainCatApplied(sMainCat);
            setSSubCatApplied(sSubCat);
            setSAmountApplied(sAmount);
            setSRecvBankApplied(sRecvBank);
            setSPayBankApplied(sPayBank);
            setSPersonApplied(sPerson);
            setSRemarkApplied(sRemark);
          }}>查询</Button>
          <Button onClick={() => {
            setSearchInput(''); setSearchApplied('');
            setTypeInput(''); setTypeApplied('');
            setRangeInput(null); setRangeApplied(null);
            setSMainCat(''); setSMainCatApplied('');
            setSSubCat(''); setSSubCatApplied('');
            setSAmount(''); setSAmountApplied('');
            setSRecvBank(''); setSRecvBankApplied('');
            setSPayBank(''); setSPayBankApplied('');
            setSPerson(''); setSPersonApplied('');
            setSRemark(''); setSRemarkApplied('');
          }}>重置</Button>
        </div>

        <Table
          bordered
          size="small"
          className="dk-main-table"
          rowKey="key"
          dataSource={filtered}
          columns={columns}
          scroll={{ x: 1910, y: dkBodyHeight || 'calc(100vh - 360px)' }}
          rowClassName={(r: BookRecord) => r.isVoided ? 'voided-row' : ''}
          pagination={{ pageSize: bookPageSize, showSizeChanger: true, onShowSizeChange: (_c, size) => setBookPageSize(size), showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description="暂无记账记录，点击「新增记账」开始记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
        {/* 作废行样式 + 滚动条样式 */}
        <style>{`
          .voided-row, .voided-row td {
            color: #bbb !important;
            text-decoration: line-through;
            background: #fafafa !important;
          }
          .voided-row .ant-tag { opacity: 0.5; }
          .dk-main-table .ant-table-body { overflow-x: scroll !important; }
          .voided-row .ant-btn-link { display: none; }
          .ant-table-body {
            overflow-x: auto !important;
            overflow-y: auto !important;
            scrollbar-width: thin;
            scrollbar-color: #bbb #f0f0f0;
          }
          .ant-table-body::-webkit-scrollbar { height: 8px; width: 8px; }
          .ant-table-body::-webkit-scrollbar-thumb { background: #bbb; border-radius: 4px; }
          .ant-table-body::-webkit-scrollbar-track { background: #f0f0f0; }
        `}</style>
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><AccountBookOutlined style={{ marginRight: 8 }} />{editRecord ? '编辑记账' : '新增记账'}</span>}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Row gutter={12}>
          <Col span={9}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>记账日期 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <DatePicker style={{ width: '100%' }} value={formDate} onChange={v => setFormDate(v)} />
          </Col>
          <Col span={15}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收支类型 <span style={{ color: '#ff4d4f' }}>*</span></div>
            {/* 横向展开快速选择：收入/支出/内部转账/冲红 */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button
                style={{ flex: 1, minWidth: 0, background: formType === '收入' ? '#52c41a' : undefined, borderColor: formType === '收入' ? '#52c41a' : undefined, color: formType === '收入' ? '#fff' : undefined, fontWeight: formType === '收入' ? 600 : 400 }}
                onClick={() => {
                  const next = formType === '收入' ? '' : '收入';
                  setFormType(next);
                  if (next) { setFormMainCategory(''); setFormCategory(''); }
                }}>收入</Button>
              <Button
                style={{ flex: 1, minWidth: 0, background: formType === '支出' ? '#ff4d4f' : undefined, borderColor: formType === '支出' ? '#ff4d4f' : undefined, color: formType === '支出' ? '#fff' : undefined, fontWeight: formType === '支出' ? 600 : 400 }}
                onClick={() => {
                  const next = formType === '支出' ? '' : '支出';
                  setFormType(next);
                  if (next) { setFormMainCategory(''); setFormCategory(''); }
                }}>支出</Button>
              <Button
                style={{ flex: 1, minWidth: 0, background: formType === '内部转账' ? '#1890ff' : undefined, borderColor: formType === '内部转账' ? '#1890ff' : undefined, color: formType === '内部转账' ? '#fff' : undefined, fontWeight: formType === '内部转账' ? 600 : 400 }}
                onClick={() => {
                  const next = formType === '内部转账' ? '' : '内部转账';
                  setFormType(next);
                  if (next) {
                    setFormMainCategory('');
                    setFormCategory('内部转账');
                  } else if (formCategory === '内部转账') {
                    setFormCategory('');
                  }
                }}>内部转账</Button>
              <Button
                style={{ flex: 1, minWidth: 0, background: formType === '冲红' ? '#fa8c16' : undefined, borderColor: formType === '冲红' ? '#fa8c16' : undefined, color: formType === '冲红' ? '#fff' : undefined, fontWeight: formType === '冲红' ? 600 : 400 }}
                onClick={() => {
                  const next = formType === '冲红' ? '' : '冲红';
                  setFormType(next);
                  if (next) {
                    setFormMainCategory('');
                    setFormCategory('');
                    setFormReversalVoucherNo('');
                  }
                }}>冲红</Button>
            </div>
          </Col>
        </Row>
        {/* 冲红凭证编号输入 */}
        {isReversal && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>冲红凭证编号 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input placeholder="输入原始凭证编号（如 PZ-20261004-001）" value={formReversalVoucherNo}
                onChange={e => setFormReversalVoucherNo(e.target.value)}
                onPressEnter={handleReversalFill} />
              <Button type="primary" onClick={handleReversalFill}>自动填充</Button>
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>输入凭证编号后点击“自动填充”，将自动复制该凭证内容并将金额取反</div>
          </div>
        )}
        {!isTransfer && !isReversal && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>分类 <span style={{ color: '#ff4d4f' }}>*</span></div>
          {/* 一级：主分类按钮 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: currentHierarchy.length > 0 ? 8 : 0 }}>
            {currentHierarchy.map(g => {
              const customMain = customMainCategories.find(c => c.name === g.name);
              const presetColor = PRESET_MAIN_COLORS[g.name];
              const mainColor = customMain?.color || presetColor;
              return (
                <Button key={g.name} size="small"
                  style={formMainCategory === g.name
                    ? { background: mainColor || (formType === '收入' ? '#52c41a' : formType === '支出' ? '#ff4d4f' : PRIMARY), borderColor: mainColor || (formType === '收入' ? '#52c41a' : formType === '支出' ? '#ff4d4f' : PRIMARY), color: '#fff', fontWeight: 600 }
                    : { borderColor: '#d9d9d9' }}
                  onClick={() => {
                    const next = formMainCategory === g.name ? '' : g.name;
                    setFormMainCategory(next);
                    setFormCategory(''); // 切换主分类时清空子分类
                  }}
                >{g.name}</Button>
              );
            })}
            {mainCatAddMode ? (
              <Space size={4}>
                <Input size="small" style={{ width: 120 }} autoFocus value={mainCatAddInput} placeholder="主分类名称"
                  onChange={e => setMainCatAddInput(e.target.value)} onPressEnter={handleAddMainCategory} />
                <Button size="small" type="primary" onClick={handleAddMainCategory}>确定</Button>
                <Button size="small" onClick={() => { setMainCatAddMode(false); setMainCatAddInput(''); }}>取消</Button>
              </Space>
            ) : (
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setMainCatAddMode(true)}>新增主分类</Button>
            )}
          </div>
          {/* 分割线：主分类与子分类之间 */}
          {formMainCategory && <div style={{ borderTop: '1px solid #e8e8e8', margin: '6px 0 8px' }} />}
          {/* 二级：子分类按钮（选中主分类后显示） */}
          {formMainCategory && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {currentSubCategories.map(sub => {
                const fullVal = buildCategoryValue(formMainCategory, sub);
                return (
                  <Button key={sub} size="small"
                    style={formCategory === fullVal
                      ? sub.includes('退货') ? { background: '#ff4d4f', borderColor: '#ff4d4f', color: '#fff', fontWeight: 600 } : { background: PRIMARY, borderColor: PRIMARY, color: '#fff', fontWeight: 600 }
                      : sub.includes('退货') ? { borderColor: '#ff4d4f', color: '#ff4d4f' } : undefined}
                    onClick={() => {
                      const next = formCategory === fullVal ? '' : fullVal;
                      setFormCategory(next);
                      // 子分类含“退货”时自动开启退货标记
                      setFormIsReturn(sub.includes('退货') && next !== '');
                    }}>{sub}</Button>
                );
              })}
              {catAddMode ? (
                <Space size={4}>
                  <Input size="small" style={{ width: 110 }} autoFocus value={catAddInput} placeholder="子分类名称"
                    onChange={e => setCatAddInput(e.target.value)} onPressEnter={handleAddCategory} />
                  <Button size="small" type="primary" onClick={handleAddCategory}>确定</Button>
                  <Button size="small" onClick={() => { setCatAddMode(false); setCatAddInput(''); }}>取消</Button>
                </Space>
              ) : (
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCatAddMode(true)}>新增子分类</Button>
              )}
            </div>
          )}
          {!formMainCategory && (
            <div style={{ fontSize: 12, color: '#999' }}>请先选择主分类</div>
          )}
        </div>
        )}
        {isTransfer && <div style={{ marginTop: 12, fontSize: 12, color: '#874d00', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, padding: '6px 10px' }}>内部转账：无需选择分类，付款账户与收款账户均为必选</div>}
        <Row gutter={12} style={{ marginTop: 12 }}>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>金额 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InputNumber className={formIsReturn ? 'return-amount-input' : undefined} style={{ flex: 1 }} min={isReversal ? undefined : 0} precision={2} prefix="¥" placeholder={isReversal ? '冲红金额为负数' : formIsReturn ? '请输入退货金额（保存后记为负数）' : '请输入金额'}
                value={formAmount} onChange={v => setFormAmount(v === null ? undefined : v)} />
              {formIsReturn && (
                <Button
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                    borderColor: formIsAdvance ? '#52c41a' : '#d9d9d9',
                    color: formIsAdvance ? '#52c41a' : undefined,
                    fontWeight: formIsAdvance ? 600 : 400,
                  }}
                  icon={formIsAdvance ? <CheckOutlined style={{ color: '#52c41a' }} /> : undefined}
                  onClick={() => {
                    setFormIsAdvance(!formIsAdvance);
                    if (!formIsAdvance) setFormCounterparty('本人垫付');
                    else setFormCounterparty('');
                  }}
                >本人垫付</Button>
              )}
            </div>
          </Col>
          <Col span={12} />
        </Row>
        {/* 支出时显示部门选择 */}
        {formType === '支出' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>部门</div>
            <Select
              style={{ width: '100%' }}
              value={formDepartment || undefined}
              placeholder="选择部门"
              allowClear
              showSearch
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              onChange={v => setFormDepartment(v || '')}
              options={departmentOptions.map(name => ({ label: name, value: name }))}
            />
          </div>
        )}
        {/* 本人垫付：收款账户选择 */}
        {formIsAdvance && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>收款账户 <span style={{ color: '#ff4d4f' }}>*</span></span>
              <Button size="small" type="link" icon={<PlusOutlined />} onClick={openRecvAddModal}>新增收款账户</Button>
            </div>
            <Select
              style={{ width: '100%' }}
              value={formAdvanceRecv || undefined}
              placeholder="点击选择收款账户（支付宝/银行账户/收款码）"
              showSearch
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              onChange={v => setFormAdvanceRecv(v)}
              options={recvAccountOptions}
              dropdownRender={(menu) => (
                <>
                  {receivingAccounts.length > 0 && (
                    <div style={{ padding: '4px 12px', fontSize: 12, color: '#888' }}>
                      已有 {receivingAccounts.length} 个收款账户
                    </div>
                  )}
                  {menu}
                  <div style={{ padding: '4px', borderTop: '1px solid #f0f0f0' }}>
                    <Button type="link" block icon={<PlusOutlined />} onClick={openRecvAddModal}>
                      新增收款账户
                    </Button>
                  </div>
                </>
              )}
              notFoundContent={
                <div style={{ textAlign: 'center', padding: '12px' }}>
                  <div style={{ color: '#999', marginBottom: 8 }}>暂无收款账户</div>
                  <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openRecvAddModal}>立即新增</Button>
                </div>
              }
            />
            {formAdvanceRecv && (() => {
              const selected = receivingAccounts.find(r => r.key === formAdvanceRecv);
              if (!selected) return null;
              return (
                <div style={{ marginTop: 6, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{recvTypeIcon(selected.type)} <strong>{selected.type}</strong>：{selected.name}</span>
                    <Space size={4}>
                      <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openRecvEditModal(selected)}>编辑</Button>
                      <Popconfirm title="确定删除该收款账户？" onConfirm={() => handleDeleteRecvAccount(selected)}>
                        <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>
                    </Space>
                  </div>
                  <div style={{ color: '#666', marginTop: 4 }}>账号：{selected.account}{selected.bankName ? ` (${selected.bankName})` : ''}</div>
                </div>
              );
            })()}
          </div>
        )}
        {actualNeedRecv && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款账户 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <Select style={{ width: '100%' }} value={formRecvAccount || undefined} placeholder="点击选择收款账户（可输入检索）"
              showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              onChange={v => setFormRecvAccount(v)} options={bankAccountOptions} />
          </div>
        )}
        {actualNeedPay && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>付款账户 {payRequired ? <span style={{ color: '#ff4d4f' }}>*</span> : <span style={{ fontSize: 11, color: '#999' }}>（可选）</span>}</div>
            <Select style={{ width: '100%' }} value={formPayAccount || undefined} placeholder="点击选择付款账户（可输入检索）"
              showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              onChange={v => setFormPayAccount(v)} options={bankAccountOptions} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>记账说明</div>
          <Input.TextArea rows={2} placeholder="备注说明" value={formRemark} onChange={e => setFormRemark(e.target.value)} />
        </div>
        {/* 图片上传 + 粘贴剪切板 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>图片</span>
            <Button size="small" icon={<SnippetsOutlined />} onClick={handlePasteImage}>粘贴剪切板</Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {formImage ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={formImage} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
                <Button size="small" danger type="text" icon={<DeleteOutlined />}
                  onClick={() => setFormImage('')}
                  style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </div>
            ) : (
              <div
                style={{ width: 120, height: 120, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', transition: 'border-color 0.2s' }}
                onClick={handleUploadImage}
                onMouseEnter={e => (e.currentTarget.style.borderColor = PRIMARY)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#d9d9d9')}
              >
                <div style={{ textAlign: 'center' }}>
                  <PictureOutlined style={{ fontSize: 24 }} />
                  <div style={{ fontSize: 12, marginTop: 4 }}>点击上传</div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: '#999' }}>记账人：{editRecord?.person || getDisplayName()}（自动记录）</div>
      </Modal>

      {/* 新增/编辑收款账户弹窗（本人垫付） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><WalletOutlined style={{ marginRight: 8 }} />{recvEditItem ? '编辑收款账户' : '新增收款账户'}</span>}
        open={recvModalVisible}
        onCancel={() => setRecvModalVisible(false)}
        onOk={handleSaveRecvAccount}
        okText="保存"
        cancelText="取消"
        width={480}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>账户类型 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['支付宝', '银行账户', '收款码'] as const).map(t => (
              <Button
                key={t}
                style={{
                  flex: 1,
                  background: recvFormType === t ? (t === '支付宝' ? '#1677ff' : t === '银行账户' ? PRIMARY : '#722ed1') : undefined,
                  borderColor: recvFormType === t ? (t === '支付宝' ? '#1677ff' : t === '银行账户' ? PRIMARY : '#722ed1') : undefined,
                  color: recvFormType === t ? '#fff' : undefined,
                  fontWeight: recvFormType === t ? 600 : 400,
                }}
                onClick={() => setRecvFormType(t)}
              >
                {recvTypeIcon(t)} {t}
              </Button>
            ))}
          </div>
        </div>
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={recvFormType === '收款码' ? 24 : 12}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>账户名称 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <Input placeholder="如：我的支付宝" value={recvFormName} onChange={e => setRecvFormName(e.target.value)} />
          </Col>
          {recvFormType !== '收款码' && (
            <Col span={12}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>账号 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input placeholder={recvFormType === '支付宝' ? '支付宝账号/手机号' : '银行卡号'} value={recvFormAccount} onChange={e => setRecvFormAccount(e.target.value)} />
            </Col>
          )}
        </Row>
        {recvFormType === '银行账户' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>开户银行</div>
            <Input placeholder="如：中国工商银行" value={recvFormBank} onChange={e => setRecvFormBank(e.target.value)} />
          </div>
        )}
        {/* 收款码：图片上传区域 */}
        {recvFormType === '收款码' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>收款码图片 <span style={{ color: '#ff4d4f' }}>*</span></span>
              <Button size="small" icon={<SnippetsOutlined />} onClick={handleRecvPasteImage}>粘贴剪切板</Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              {recvFormImage ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <Image src={recvFormImage} width={150} height={150} style={{ objectFit: 'cover', borderRadius: 8 }} />
                  <Button size="small" danger type="text" icon={<DeleteOutlined />}
                    onClick={() => setRecvFormImage('')}
                    style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
                </div>
              ) : (
                <div
                  style={{ width: 150, height: 150, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', transition: 'border-color 0.2s' }}
                  onClick={handleRecvImageUpload}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#722ed1')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#d9d9d9')}
                >
                  <div style={{ textAlign: 'center' }}>
                    <PictureOutlined style={{ fontSize: 28 }} />
                    <div style={{ fontSize: 12, marginTop: 4 }}>点击上传</div>
                    <div style={{ fontSize: 11, color: '#bbb' }}>或Ctrl+V粘贴</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>备注</div>
          <Input placeholder="备注说明（可选）" value={recvFormRemark} onChange={e => setRecvFormRemark(e.target.value)} />
        </div>
        {/* 已有收款账户列表 */}
        {receivingAccounts.length > 0 && (
          <div>
            <div style={{ marginBottom: 6, fontSize: 12, color: '#5a6d85' }}>已有收款账户 ({receivingAccounts.length})</div>
            <div style={{ maxHeight: 120, overflowY: 'auto' }}>
              {receivingAccounts.map(r => (
                <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                  <span>{recvTypeIcon(r.type)} {r.name} - {r.account}</span>
                  <Space size={2}>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openRecvEditModal(r)}>编辑</Button>
                    <Popconfirm title="确定删除？" onConfirm={() => handleDeleteRecvAccount(r)}>
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* 记账凭证详情弹窗 - 传统会计凭证格式 */}
      <Modal
        title={null}
        open={voucherDetailVisible}
        onCancel={() => setVoucherDetailVisible(false)}
        footer={[
          <Button key="print" icon={<DownloadOutlined />} onClick={() => {
            const w = window.open('', '_blank');
            if (!w || !voucherDetailRecord) return;
            const r = voucherDetailRecord;
            const parsed = parseCategory(r.category || '');
            const absAmt = Math.abs(Number(r.amount) || 0);
            const isDebit = r.bookType === '支出' || (parsed.sub || '').includes('退货') || (parsed.main || '').includes('退货');
            const amtStr = absAmt.toFixed(2);
            const [intPart, decPart] = amtStr.split('.');
            const digits = intPart.padStart(8, '0').split('');
            const jiao = decPart[0] || '0';
            const fen = decPart[1] || '0';
            const digitCells = (side: 'debit' | 'credit') => {
              const active = (side === 'debit') === isDebit;
              const vals = active ? [...digits, jiao, fen] : Array(10).fill('');
              return vals.map((v, i) => `<td style="border:1px solid #333;padding:6px 2px;text-align:center;width:28px;font-family:monospace">${v}</td>`).join('');
            };
            w.document.write(`<html><head><title>记账凭证 ${r.voucherNo || ''}</title><style>body{font-family:SimSun,serif;padding:30px 20px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #333;padding:6px;font-size:13px;text-align:center}.title{font-size:22px;font-weight:bold;text-align:center;letter-spacing:8px;margin-bottom:4px}.date-no{display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px}.sign-row{display:flex;justify-content:space-between;margin-top:16px;font-size:13px}</style></head><body><div class="title">记 账 凭 证</div><div class="date-no"><span>${r.bookDate.replace(/-/g, '年').replace(/年/, '年').replace(/(\d+)(\d{2})$/, '$1月$2日').replace(/月0/, '月').replace(/日0/, '日')}</span><span>记字第 ${r.voucherNo || ''} 号</span></div><table><tr><th rowspan="2" style="width:100px">摘 要</th><th rowspan="2" style="width:60px">一级科目</th><th rowspan="2" style="width:80px">二级科目</th><th colspan="10">借 方 金 额</th><th colspan="10">贷 方 金 额</th></tr><tr><td colspan="10" style="font-size:11px;padding:2px">千 百 十 万 千 百 十 元 角 分</td><td colspan="10" style="font-size:11px;padding:2px">千 百 十 万 千 百 十 元 角 分</td></tr><tr><td>${r.remark || '—'}</td><td>${parsed.main || '—'}</td><td>${parsed.sub || '—'}</td>${digitCells('debit')}${digitCells('credit')}</tr><tr style="font-weight:bold"><td colspan="3">合 计</td>${digitCells('debit')}${digitCells('credit')}</tr></table><div class="sign-row"><span>记账：${r.person || '______'}</span><span>审核：${r.auditor || '______'}</span><span>出纳：${r.cashier || '______'}</span></div></body></html>`);
            w.document.close(); w.print();
          }}>打印</Button>,
          <Button key="close" type="primary" onClick={() => setVoucherDetailVisible(false)}>关闭</Button>,
        ]}
        width={720}
      >
        {voucherDetailRecord && (() => {
          const r = voucherDetailRecord;
          const parsed = parseCategory(r.category || '');
          const absAmt = Math.abs(Number(r.amount) || 0);
          const isDebit = r.bookType === '支出' || (parsed.sub || '').includes('退货') || (parsed.main || '').includes('退货'); // 支出/退货→借方, 收入→贷方
          const amtStr = absAmt.toFixed(2);
          const [intPart, decPart] = amtStr.split('.');
          const paddedDigits = intPart.padStart(8, '0').split(''); // 千万 百万 十万 万 千 百 十 元
          const jiao = decPart[0] || '0';
          const fen = decPart[1] || '0';
          const allDigits = [...paddedDigits, jiao, fen]; // 10位
          const debitDigits = isDebit ? allDigits : Array(10).fill('');
          const creditDigits = !isDebit ? allDigits : Array(10).fill('');
          // 格式化日期为中文
          const dp = r.bookDate.split('-');
          const cnDate = `${dp[0]}年${parseInt(dp[1])}月${parseInt(dp[2])}日`;
          const digitHeaders = ['千', '百', '十', '万', '千', '百', '十', '元', '角', '分'];
          const dgStyle = 'border:1px solid #5a8a5a;padding:4px 1px;text-align:center;font-family:monospace;font-size:12px;width:26px;';
          const dgEmpty = 'border:1px solid #5a8a5a;padding:4px 1px;text-align:center;font-size:11px;color:#ccc;width:26px;';
          return (
            <div style={{ fontFamily: 'SimSun, serif', padding: '0 8px' }}>
              {/* 标题 */}
              <div style={{ textAlign: 'center', marginBottom: 2 }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 8, color: '#333' }}>记 账 凭 证</div>
              </div>
              {/* 日期 + 凭证编号 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: '#555' }}>
                <span>{cnDate}</span>
                <span>记字第 {r.voucherNo || '—'} 号</span>
              </div>
              {/* 主体凭证表格 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #5a8a5a' }}>
                <thead>
                  <tr style={{ background: '#eef7ee' }}>
                    <th rowSpan={2} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', width: 90, fontSize: 13 }}>摘 要</th>
                    <th rowSpan={2} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', width: 70, fontSize: 13 }}>会计科目</th>
                    <th rowSpan={2} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', width: 80, fontSize: 13 }}>明细科目</th>
                    <th colSpan={10} style={{ border: '1px solid #5a8a5a', padding: '4px 0', fontSize: 13, color: '#c00' }}>借 方 金 额</th>
                    <th colSpan={10} style={{ border: '1px solid #5a8a5a', padding: '4px 0', fontSize: 13, color: '#06c' }}>贷 方 金 额</th>
                  </tr>
                  <tr style={{ background: '#eef7ee' }}>
                    {digitHeaders.map((h, i) => <td key={`dh-${i}`} style={{ ...{ fontSize: 11, color: '#888', border: '1px solid #5a8a5a', padding: '2px 0', textAlign: 'center' } }}>{h}</td>)}
                    {digitHeaders.map((h, i) => <td key={`ch-${i}`} style={{ ...{ fontSize: 11, color: '#888', border: '1px solid #5a8a5a', padding: '2px 0', textAlign: 'center' } }}>{h}</td>)}
                  </tr>
                </thead>
                <tbody>
                  {/* 数据行 */}
                  <tr>
                    <td style={{ border: '1px solid #5a8a5a', padding: '8px 6px', fontSize: 13, verticalAlign: 'top' }}>
                      <div>{r.remark || '—'}</div>
                      {r.counterparty && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>对方: {r.counterparty}</div>}
                      {r.reversalOf && <div style={{ fontSize: 11, color: '#fa8c16', marginTop: 2 }}>冲红: {r.reversalOf}</div>}
                    </td>
                    <td style={{ border: '1px solid #5a8a5a', padding: '8px 4px', fontSize: 13, textAlign: 'center' }}>{parsed.main || '—'}</td>
                    <td style={{ border: '1px solid #5a8a5a', padding: '8px 4px', fontSize: 13, textAlign: 'center' }}>{parsed.sub || '—'}</td>
                    {debitDigits.map((d, i) => (
                      <td key={`d-${i}`} style={{ [isDebit ? 'border' : 'border']: '1px solid #5a8a5a', padding: '6px 1px', textAlign: 'center', fontFamily: 'monospace', fontSize: 13, fontWeight: isDebit ? 600 : 400, color: isDebit ? '#333' : '#ccc' }}>{d || ''}</td>
                    ))}
                    {creditDigits.map((d, i) => (
                      <td key={`c-${i}`} style={{ border: '1px solid #5a8a5a', padding: '6px 1px', textAlign: 'center', fontFamily: 'monospace', fontSize: 13, fontWeight: !isDebit ? 600 : 400, color: !isDebit ? '#333' : '#ccc' }}>{d || ''}</td>
                    ))}
                  </tr>
                  {/* 空行占位 */}
                  {[0, 1].map(n => (
                    <tr key={`empty-${n}`}>
                      <td style={{ border: '1px solid #5a8a5a', padding: '12px 6px' }}>&nbsp;</td>
                      <td style={{ border: '1px solid #5a8a5a', padding: '12px 4px' }}>&nbsp;</td>
                      <td style={{ border: '1px solid #5a8a5a', padding: '12px 4px' }}>&nbsp;</td>
                      {Array(20).fill(0).map((_, i) => <td key={i} style={{ border: '1px solid #5a8a5a', padding: '12px 1px' }}>&nbsp;</td>)}
                    </tr>
                  ))}
                  {/* 合计行 */}
                  <tr style={{ background: '#eef7ee', fontWeight: 700 }}>
                    <td colSpan={3} style={{ border: '1px solid #5a8a5a', padding: '6px 4px', fontSize: 13, textAlign: 'center' }}>合 计 金 额</td>
                    {debitDigits.map((d, i) => (
                      <td key={`sd-${i}`} style={{ border: '1px solid #5a8a5a', padding: '6px 1px', textAlign: 'center', fontFamily: 'monospace', fontSize: 13, color: isDebit ? '#c00' : '#ccc' }}>{d || ''}</td>
                    ))}
                    {creditDigits.map((d, i) => (
                      <td key={`sc-${i}`} style={{ border: '1px solid #5a8a5a', padding: '6px 1px', textAlign: 'center', fontFamily: 'monospace', fontSize: 13, color: !isDebit ? '#06c' : '#ccc' }}>{d || ''}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              {/* 附件 + 账户信息 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#666' }}>
                <span>收款账户: {r.recvAccount || '—'}{r.recvBank ? ` (${r.recvBank})` : ''}</span>
                <span>付款账户: {r.payAccount || '—'}{r.payBank ? ` (${r.payBank})` : ''}</span>
                <span>附件 {r.image ? '1' : '0'} 张</span>
              </div>
              {/* 附件图片 */}
              {r.image && (
                <div style={{ marginTop: 8 }}>
                  <Image src={r.image} width={120} style={{ borderRadius: 4, border: '1px solid #eee' }} />
                </div>
              )}
              {/* 签章区 */}
              <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 16, paddingTop: 12, borderTop: '2px solid #5a8a5a', fontSize: 13 }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#666' }}>记账：</span>
                  <span style={{ color: PRIMARY, fontWeight: 500 }}>{r.person || '______'}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#666' }}>审核：</span>
                  <span style={{ color: PRIMARY, fontWeight: 500 }}>{r.auditor || '______'}</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#666' }}>出纳：</span>
                  <span style={{ color: PRIMARY, fontWeight: 500 }}>{r.cashier || '______'}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};

export default DailyBookkeepingPage;
