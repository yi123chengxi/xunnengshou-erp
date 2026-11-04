import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, Select,
  Row, Col, Popconfirm, Tag, Image, Upload, DatePicker, Checkbox, Tooltip, notification,
  AutoComplete, Descriptions, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, PictureOutlined,
  ProfileOutlined, FileTextOutlined, BankOutlined, SearchOutlined, SettingOutlined,
  BarChartOutlined, ShopOutlined, QuestionCircleOutlined, ClearOutlined, SendOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import useResizableColumns from '../hooks/useResizableColumns';
import FieldConfigModal from '../components/FieldConfigModal';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { resolveSupplier, upsertInboxEntry, nextApplyNo } from '../utils/invoiceApply';
import InvoiceRecordPage from './InvoiceRecordPage';
import { sendPushNotification, showNativeNotification, isNotificationTypeEnabled } from '../utils/pushNotification';
import { compressImageFile } from '../utils/imageCompress';

// ===================== 销售额统计类型 =====================
interface SalesRecord {
  key: string;
  shopName: string;
  shopNo: string;
  companyName: string;
  month: string;
  salesAmount: number;
  createdAt: string;
}

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// 发票预览卡片样式（仿纸质发票排版）
const INV_CELL_LABEL: React.CSSProperties = { border: '1px solid #bfbfbf', padding: '6px 12px', fontWeight: 700, width: 130, background: '#fdf8e4' };
const INV_CELL_VALUE: React.CSSProperties = { border: '1px solid #bfbfbf', padding: '6px 12px', background: '#fdf8e4' };
const INV_TH: React.CSSProperties = { border: '1px solid #bfbfbf', padding: '6px 10px', background: '#dce6f1', fontWeight: 600, textAlign: 'center' };
const INV_TD: React.CSSProperties = { border: '1px solid #bfbfbf', padding: '6px 10px', textAlign: 'center' };

// 代账公司颜色池
const AC_COLORS = [
  '#fff7e6', '#e6f7ff', '#f6ffed', '#fff1f0', '#f9f0ff',
  '#e6fffb', '#fcffe6', '#fff0f6', '#f0f5ff', '#fff2e8',
];
const getAcColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AC_COLORS[Math.abs(hash) % AC_COLORS.length];
};

// ===================== 类型定义 =====================
interface BusinessLicense {
  key: string;
  companyName: string;
  taxpayerCode: string;
  legalPerson?: string;
  companyType?: string;
  vatRate?: number;
  accountingCompany?: string;
  remark?: string;
  storeCount?: number;
  storeSales?: number;
  inputInvoices?: string;
  outputInvoices?: string;
  image: string;
  createdAt: string;
}

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

// ===================== 横向标签页配置 =====================
const subTabs = [
  { key: 'license', label: '营业执照列表', icon: <ProfileOutlined /> },
  { key: 'invoice', label: '开票记录', icon: <FileTextOutlined /> },
  { key: 'sales', label: '销售额统计', icon: <BarChartOutlined /> },
];

// ===================== 主组件 =====================
const BusinessLicensePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('license');
  const owner = useMemo(() => getDataOwner(), []);
  const storageKey = `business_license_${owner}`;

  const [records, setRecords] = useState<BusinessLicense[]>([]);
  const [searchText, setSearchText] = useState('');
  const [invoiceRecords, setInvoiceRecords] = useState<any[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]); // 支持多月（季度）
  const [shops, setShops] = useState<any[]>([]);
  // 代账公司列表（持久化）
  const acStorageKey = `accounting_companies_${owner}`;
  const [accountingCompanies, setAccountingCompanies] = useState<string[]>([]);
  // 代账公司选择器弹窗
  const [acPickerVisible, setAcPickerVisible] = useState(false);
  const [acPickerTarget, setAcPickerTarget] = useState<'form' | 'search'>('form');
  const [acPickerSearch, setAcPickerSearch] = useState('');
  // 搜索栏代账公司筛选
  const [searchAcCompany, setSearchAcCompany] = useState('');
  // ===================== 进项票开票申请 =====================
  const [applyVisible, setApplyVisible] = useState(false);
  const [applyCompany, setApplyCompany] = useState('');
  const [applyAvailable, setApplyAvailable] = useState(0);
  const [applyMonthsSnap, setApplyMonthsSnap] = useState<string[]>([]);
  const [applyLimit, setApplyLimit] = useState<number>(300000);
  const [applyPriceMin, setApplyPriceMin] = useState<number>(0);
  const [applyPriceMax, setApplyPriceMax] = useState<number>(0);
  const [applyProjectName, setApplyProjectName] = useState('');
  const [applyProjectHistory, setApplyProjectHistory] = useState<string[]>([]);
  const [applyRatio, setApplyRatio] = useState<number>(90);
  // 申请方纳税人资质（预览发票抬头用）：识别码/类型/税率（小规模 1%、一般纳税人 13%）
  const [applyTaxpayerCode, setApplyTaxpayerCode] = useState('');
  const [applyCompanyType, setApplyCompanyType] = useState('小规模纳税人');
  const [applyTaxRate, setApplyTaxRate] = useState<number>(1);
  // 发票预览（拆分草稿 + 供应商选择）
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewDrafts, setPreviewDrafts] = useState<{ amount: number; unitPrice: number; quantity: number; supplier: string }[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<{ value: string; label: string }[]>([]);
  // ===================== 发起销售额统计任务 =====================
  const [salesTaskVisible, setSalesTaskVisible] = useState(false);
  const [salesTaskSelected, setSalesTaskSelected] = useState<string[]>([]);
  const [salesTaskMonths, setSalesTaskMonths] = useState<string[]>([]);
  const salesTaskStatusKey = `sales_task_status_${owner}`;

  // 生成最近12个月选项
  const recentMonthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const now = dayjs();
    for (let i = 0; i < 12; i++) {
      const m = now.subtract(i, 'month').format('YYYY-MM');
      opts.push({ value: m, label: m });
    }
    return opts;
  }, []);

  const handleLaunchSalesTask = useCallback(() => {
    if (salesTaskSelected.length === 0) {
      message.warning('请至少选择一个店铺'); return;
    }
    if (salesTaskMonths.length === 0) {
      message.warning('请至少选择一个统计月份'); return;
    }
    const selectedShops = shops.filter(s => salesTaskSelected.includes(s.key));
    const currentUser = localStorage.getItem('username') || '';
    const monthsLabel = salesTaskMonths.join('、');
    selectedShops.forEach(shop => {
      if (isNotificationTypeEnabled('sales-task')) {
        const notifTitle = '销售额统计任务通知';
        const notifBody = `店铺「${shop.shopName}」有新的销售额统计任务（${monthsLabel}），请及时处理`;
        const onClickHandler = () => { window.focus(); };
        if (shop.person === currentUser) {
          const nativeNotif = showNativeNotification(notifTitle, notifBody, onClickHandler, `sales-task-${shop.key}`);
          if (!nativeNotif) {
            notification.warning({
              key: `sales-task-${shop.key}`,
              message: notifTitle,
              description: notifBody,
              closeIcon: false,
              duration: 0,
              onClick: onClickHandler,
            });
          }
        }
        const person = shop.person;
        if (person) {
          sendPushNotification(person, notifTitle, notifBody, { url: window.location.origin + '/purchaser/finance/shop-management' });
        }
      }
    });
    // 保存任务状态
    try {
      const taskData: Record<string, string> = JSON.parse(localStorage.getItem(salesTaskStatusKey) || '{}');
      selectedShops.forEach(shop => { taskData[shop.key] = dayjs().format('YYYY-MM-DD HH:mm'); });
      localStorage.setItem(salesTaskStatusKey, JSON.stringify(taskData));
    } catch { /* ignore */ }
    message.success(`已向 ${selectedShops.length} 个店铺负责人发起销售额统计任务（${monthsLabel}）`);
    setSalesTaskVisible(false);
    setSalesTaskSelected([]);
    setSalesTaskMonths([]);
  }, [shops, salesTaskSelected, salesTaskStatusKey, salesTaskMonths]);

  // ===================== 数据加载 =====================
  const reload = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setRecords([]); }
    try { setInvoiceRecords(JSON.parse(localStorage.getItem(`invoice_record_${owner}`) || '[]')); } catch { setInvoiceRecords([]); }
    try { setShops(JSON.parse(localStorage.getItem(`shop_info_${owner}`) || '[]')); } catch { setShops([]); }
    try { setAccountingCompanies(JSON.parse(localStorage.getItem(acStorageKey) || '[]')); } catch { setAccountingCompanies([]); }
  }, [storageKey, owner, acStorageKey]);

  // 查询按钮触发：只有点击查询后才应用筛选条件
  const [appliedSearchText, setAppliedSearchText] = useState('');
  const [appliedSearchAcCompany, setAppliedSearchAcCompany] = useState('');
  const handleSearch = useCallback(() => {
    // 重读存储：开票记录等在「开票记录」标签页的增改不会同步到本页状态，查询时强制刷新进项票/销项票合计
    reload();
    setAppliedSearchText(searchText);
    setAppliedSearchAcCompany(searchAcCompany);
  }, [searchText, searchAcCompany, reload]);
  const handleReset = useCallback(() => {
    setSearchText('');
    setSearchAcCompany('');
    setSelectedMonths([]);
    setAppliedSearchText('');
    setAppliedSearchAcCompany('');
  }, []);
  // 店铺明细弹窗
  const [shopDetailVisible, setShopDetailVisible] = useState(false);
  const [shopDetailCompany, setShopDetailCompany] = useState('');

  // 显示字段控制
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);
  const ALL_FIELDS = [
    { key: 'companyName', label: '公司名称' },
    { key: 'taxpayerCode', label: '纳税人识别码' },
    { key: 'legalPerson', label: '法人代表' },
    { key: 'companyType', label: '公司类型' },
    { key: 'vatRate', label: '增值税税率' },
    { key: 'storeCount', label: '开店数量' },
    { key: 'accountingCompany', label: '代账公司' },
    { key: 'remark', label: '备注' },
    { key: 'storeSales', label: '店铺销售额' },
    { key: 'inputInvoices', label: '进项票' },
    { key: 'outputInvoices', label: '销项票' },
    { key: 'inputDiff', label: '进项差额' },
    { key: 'recentSales', label: '近12个月销售额' },
    { key: 'image', label: '图片' },
    { key: 'createdAt', label: '创建时间' },
  ];
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`bizLicenseFieldOrder_${owner}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) {
          // 补充新增字段（旧配置中不存在的）
          const allKeys = ALL_FIELDS.map(f => f.key);
          const newKeys = allKeys.filter(k => !arr.includes(k));
          return [...arr, ...newKeys];
        }
      }
    } catch { /* ignore */ }
    return ALL_FIELDS.map(f => f.key);
  });
  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    let def: Record<string, boolean> = {};
    try {
      const saved = localStorage.getItem(`bizLicenseFieldVisibility_${owner}`);
      if (saved) def = JSON.parse(saved);
    } catch { /* ignore */ }
    // 确保所有字段都有可见性设置（新增字段默认为 true）
    ALL_FIELDS.forEach(f => { if (def[f.key] === undefined) def[f.key] = true; });
    return def;
  });
  const saveFieldConfig = (order: string[] = fieldOrder, vis: Record<string, boolean> = fieldVisibility) => {
    localStorage.setItem(`bizLicenseFieldOrder_${owner}`, JSON.stringify(order));
    localStorage.setItem(`bizLicenseFieldVisibility_${owner}`, JSON.stringify(vis));
  };

  // 编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BusinessLicense | null>(null);
  const [formName, setFormName] = useState('');
  const [formTaxpayerCode, setFormTaxpayerCode] = useState('');
  const [formLegalPerson, setFormLegalPerson] = useState('');
  const [formCompanyType, setFormCompanyType] = useState<string>('');
  const [formVatRate, setFormVatRate] = useState<number | null>(null);
  const [formAccountingCompany, setFormAccountingCompany] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formImage, setFormImage] = useState('');

  // ===================== 数据加载挂载与切签重读 =====================
  useEffect(() => { reload(); }, [reload]);
  // 切回营业执照列表标签页时自动重读（开票记录标签页增改后无需换页面即可刷新合计）
  useEffect(() => { if (activeTab === 'license') reload(); }, [activeTab, reload]);

  // ===================== 销售额统计 =====================
  const salesKey = `sales_stats_${owner}`;
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  // 判断店铺在选中月份是否已有统计记录
  const getShopStatsStatus = useCallback((shopName: string): boolean => {
    if (salesTaskMonths.length === 0) return false;
    return salesTaskMonths.every(m =>
      salesRecords.some(r => r.shopName === shopName && r.month === m)
    );
  }, [salesTaskMonths, salesRecords]);
  // 店铺选择弹窗
  const [salesShopPickerVisible, setSalesShopPickerVisible] = useState(false);
  const [salesShopPickerSearch, setSalesShopPickerSearch] = useState('');
  // 新增/编辑弹窗
  const [salesEditVisible, setSalesEditVisible] = useState(false);
  const [salesEditingRecord, setSalesEditingRecord] = useState<SalesRecord | null>(null);
  const [salesFormShopName, setSalesFormShopName] = useState('');
  const [salesFormShopNo, setSalesFormShopNo] = useState('');
  const [salesFormCompanyName, setSalesFormCompanyName] = useState('');
  const [salesFormMonth, setSalesFormMonth] = useState('');
  const [salesFormAmount, setSalesFormAmount] = useState<number>(0);
  // 字段控制
  const [salesFieldConfigVisible, setSalesFieldConfigVisible] = useState(false);
  const SALES_ALL_FIELDS = [
    { key: 'shopName', label: '店铺名称' },
    { key: 'shopNo', label: '店铺编号' },
    { key: 'companyName', label: '公司名称' },
    { key: 'month', label: '月份' },
    { key: 'salesAmount', label: '销售额' },
  ];
  const [salesFieldOrder, setSalesFieldOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`salesFieldOrder_${owner}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) {
          const allKeys = SALES_ALL_FIELDS.map(f => f.key);
          const newKeys = allKeys.filter(k => !arr.includes(k));
          return [...arr, ...newKeys];
        }
      }
    } catch { /* ignore */ }
    return SALES_ALL_FIELDS.map(f => f.key);
  });
  const [salesFieldVisibility, setSalesFieldVisibility] = useState<Record<string, boolean>>(() => {
    let def: Record<string, boolean> = {};
    try {
      const saved = localStorage.getItem(`salesFieldVisibility_${owner}`);
      if (saved) def = JSON.parse(saved);
    } catch { /* ignore */ }
    SALES_ALL_FIELDS.forEach(f => { if (def[f.key] === undefined) def[f.key] = true; });
    return def;
  });
  const saveSalesFieldConfig = (order: string[] = salesFieldOrder, vis: Record<string, boolean> = salesFieldVisibility) => {
    localStorage.setItem(`salesFieldOrder_${owner}`, JSON.stringify(order));
    localStorage.setItem(`salesFieldVisibility_${owner}`, JSON.stringify(vis));
  };
  // 搜索
  const [salesSearchShopName, setSalesSearchShopName] = useState('');
  const [salesSearchShopNo, setSalesSearchShopNo] = useState('');
  const [salesSearchCompanyName, setSalesSearchCompanyName] = useState('');
  const [salesSearchMonth, setSalesSearchMonth] = useState('');
  // 已应用的搜索条件
  const [salesAppliedSearch, setSalesAppliedSearch] = useState({ shopName: '', shopNo: '', companyName: '', month: '' });
  const handleSalesSearch = useCallback(() => {
    setSalesAppliedSearch({
      shopName: salesSearchShopName,
      shopNo: salesSearchShopNo,
      companyName: salesSearchCompanyName,
      month: salesSearchMonth,
    });
  }, [salesSearchShopName, salesSearchShopNo, salesSearchCompanyName, salesSearchMonth]);

  // 加载销售额数据
  const reloadSales = useCallback(() => {
    try { setSalesRecords(JSON.parse(localStorage.getItem(salesKey) || '[]')); } catch { setSalesRecords([]); }
  }, [salesKey]);
  useEffect(() => { reloadSales(); }, [reloadSales]);

  const saveSalesRecords = (list: SalesRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(salesKey, json);
    safeSetItem(`${salesKey}_ts`, String(Date.now()));
    saveDataset(salesKey, json);
    setSalesRecords(list);
  };

  // 店铺选择确认
  const handleSalesShopSelect = (shop: any) => {
    setSalesFormShopName(shop.shopName || '');
    setSalesFormShopNo(shop.accountId || '');
    setSalesFormCompanyName(shop.companyName || '');
    setSalesShopPickerVisible(false);
  };

  const openSalesAdd = () => {
    setSalesEditingRecord(null);
    setSalesFormShopName(''); setSalesFormShopNo(''); setSalesFormCompanyName('');
    setSalesFormMonth(''); setSalesFormAmount(0);
    setSalesEditVisible(true);
  };

  const openSalesEdit = (r: SalesRecord) => {
    setSalesEditingRecord(r);
    setSalesFormShopName(r.shopName);
    setSalesFormShopNo(r.shopNo);
    setSalesFormCompanyName(r.companyName);
    setSalesFormMonth(r.month);
    setSalesFormAmount(r.salesAmount || 0);
    setSalesEditVisible(true);
  };

  const handleSalesSave = () => {
    if (!salesFormShopName.trim()) { message.warning('请选择店铺名称'); return; }
    if (!salesFormMonth) { message.warning('请选择月份'); return; }
    // 检查同一店铺同一月份是否已有记录
    const shopName = salesFormShopName.trim();
    const month = salesFormMonth;
    const duplicate = salesRecords.find(r =>
      r.shopName === shopName && r.month === month &&
      (!salesEditingRecord || r.key !== salesEditingRecord.key)
    );
    if (duplicate) {
      message.error(`该店铺「${shopName}」在 ${month} 月份已有销售记录（销售额 ¥${(duplicate.salesAmount || 0).toFixed(2)}），同一店铺每月只能填写一份记录`);
      return;
    }
    const list = [...salesRecords];
    const data = {
      shopName,
      shopNo: salesFormShopNo.trim(),
      companyName: salesFormCompanyName.trim(),
      month,
      salesAmount: salesFormAmount || 0,
    };
    if (salesEditingRecord) {
      const idx = list.findIndex(r => r.key === salesEditingRecord.key);
      if (idx >= 0) list[idx] = { ...list[idx], ...data };
    } else {
      list.push({ key: `ss-${Date.now()}`, ...data, createdAt: new Date().toLocaleString('zh-CN') });
    }
    saveSalesRecords(list);
    setSalesEditVisible(false);
    message.success(salesEditingRecord ? '记录已更新' : '记录已添加');
  };

  const handleSalesDelete = (key: string) => {
    saveSalesRecords(salesRecords.filter(r => r.key !== key));
    message.success('记录已删除');
  };

  // 销售额过滤
  const salesFiltered = useMemo(() => {
    let list = salesRecords;
    const s = salesAppliedSearch;
    if (s.shopName.trim()) {
      const q = s.shopName.toLowerCase();
      list = list.filter(r => r.shopName.toLowerCase().includes(q));
    }
    if (s.shopNo.trim()) {
      const q = s.shopNo.toLowerCase();
      list = list.filter(r => r.shopNo.toLowerCase().includes(q));
    }
    if (s.companyName.trim()) {
      const q = s.companyName.toLowerCase();
      list = list.filter(r => r.companyName.toLowerCase().includes(q));
    }
    if (s.month) {
      list = list.filter(r => r.month === s.month);
    }
    return list;
  }, [salesRecords, salesAppliedSearch]);

  // 按公司名称统计店铺数量和明细
  const shopStatsByCompany = useMemo(() => {
    const map: Record<string, { count: number; names: string[]; shops: any[] }> = {};
    shops.forEach((s: any) => {
      const company = s.companyName || '';
      if (!company) return;
      if (!map[company]) map[company] = { count: 0, names: [], shops: [] };
      map[company].count++;
      if (s.shopName) map[company].names.push(s.shopName);
      map[company].shops.push(s);
    });
    return map;
  }, [shops]);

  // 从开票记录计算每个公司的进项票/销售发票总额（按月份筛选；仅统计手工记录，开票申请记录由 applyStats 单独统计）
  const invoiceTotals = useMemo(() => {
    const map: Record<string, { input: number; output: number }> = {};
    invoiceRecords.forEach((inv: any) => {
      if (inv.source === 'apply') return;
      const company = inv.companyName || '';
      if (!company) return;
      // 按月份筛选
      if (selectedMonths.length > 0 && inv.date) {
        const invMonth = dayjs(inv.date).format('YYYY-MM');
        if (!selectedMonths.includes(invMonth)) return;
      }
      if (!map[company]) map[company] = { input: 0, output: 0 };
      const amount = Number(inv.amount) || 0;
      if (inv.invoiceType === '进项票') map[company].input += amount;
      else if (inv.invoiceType === '销售发票') map[company].output += amount;
    });
    return map;
  }, [invoiceRecords, selectedMonths]);

  // 开票申请统计（按公司）：申请发票额/待开票额/已开票额/消耗差额缺口（gapAmount，含按比例未实开部分）
  const applyStats = useMemo(() => {
    const map: Record<string, { applied: number; pending: number; issued: number; consumedGap: number }> = {};
    invoiceRecords.forEach((inv: any) => {
      if (inv.source !== 'apply' || inv.invoiceType !== '进项票') return;
      const company = inv.companyName || '';
      if (!company) return;
      const months: string[] = Array.isArray(inv.applyMonths) ? inv.applyMonths : [];
      if (selectedMonths.length > 0 && months.length > 0 && !months.some(m => selectedMonths.includes(m))) return;
      if (!map[company]) map[company] = { applied: 0, pending: 0, issued: 0, consumedGap: 0 };
      const amt = Number(inv.amount) || 0;
      const gap = Number(inv.gapAmount) || amt;
      map[company].applied += amt;
      map[company].consumedGap += gap;
      const stNorm = inv.invoiceStatus === '已开票' ? '开票成功' : (inv.invoiceStatus || '待开票');
      if (stNorm !== '开票成功') map[company].pending += amt;
      else map[company].issued += amt;
    });
    return map;
  }, [invoiceRecords, selectedMonths]);

  // ===================== 开票申请流程 =====================
  const applySettingsKey = `invoice_apply_settings_${owner}`;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const currentDisplayName = (): string => {
    const username = localStorage.getItem('username') || '';
    try {
      const accounts = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
      const account = accounts.find((a: any) => a.username === username);
      if (account?.displayName) return account.displayName;
    } catch { /* ignore */ }
    return username;
  };

  // 打开开票要求弹窗：回显上次记忆的设置与项目名称候选
  const openApplyModal = (company: string, available: number) => {
    if (available <= 0) { message.warning('当前时间范围内无可申请开票金额'); return; }
    let st: any = {};
    try { st = JSON.parse(localStorage.getItem(applySettingsKey) || '{}'); } catch { /* ignore */ }
    setApplyCompany(company);
    setApplyAvailable(available);
    setApplyMonthsSnap([...selectedMonths]);
    // 纳税人资质：从营业执照列表取识别码与公司类型，税率默认小规模 1%、一般纳税人 13%
    const lic = records.find(r => r.companyName === company);
    const ctype = String(lic?.companyType || '').trim();
    setApplyCompanyType(ctype || '小规模纳税人');
    setApplyTaxpayerCode(String(lic?.taxpayerCode || '').trim());
    setApplyTaxRate(ctype.includes('一般纳税人') ? 13 : 1);
    setApplyLimit(Number(st.limit) || 300000);
    setApplyPriceMin(Number(st.priceMin) || 0);
    setApplyPriceMax(Number(st.priceMax) || 0);
    setApplyProjectName(st.projectName || '');
    setApplyProjectHistory(Array.isArray(st.projectNames) ? st.projectNames : []);
    setApplyRatio(Number(st.ratio) > 0 ? Number(st.ratio) : 90);
    // 供应商候选：采购商平台供应商列表（合作中标记），预览中也可自由输入其他供应商名称
    let sup: any[] = [];
    try { sup = JSON.parse(localStorage.getItem(`purchaser_suppliers_${owner}`) || '[]'); } catch { /* ignore */ }
    setSupplierOptions(sup.filter((s: any) => s.supplierName)
      .map((s: any) => ({ value: s.supplierName, label: `${s.supplierName}${s.cooperationStatus === 'approved' ? '（合作中）' : ''}` })));
    setApplyVisible(true);
  };

  // 生成发票：按限额拆张（ceil），金额平均分配（末张补差），单价区间内随机→数量=金额/单价（正整数）再反算单价
  const handleGenerateInvoices = () => {
    if (!(applyLimit > 0)) { message.warning('请填写每张发票限额'); return; }
    if (!(applyPriceMin > 0) || applyPriceMax < applyPriceMin) { message.warning('请填写正确的单价区间（下限>0 且 上限≥下限）'); return; }
    if (!applyProjectName.trim()) { message.warning('请填写项目名称'); return; }
    if (!(applyRatio > 0) || applyRatio >= 100) { message.warning('开票比例须大于 0 且小于 100（100% 开票不合规）'); return; }
    const total = round2(round2(applyAvailable * applyRatio / 100));
    if (!(total > 0)) { message.warning('按比例生成的开票金额为 0，请检查开票比例'); return; }
    const n = Math.max(1, Math.ceil(total / applyLimit));
    const baseAmt = round2(total / n);
    const drafts: { amount: number; unitPrice: number; quantity: number; supplier: string }[] = [];
    for (let i = 0; i < n; i++) {
      const target = i === n - 1 ? round2(total - round2(baseAmt * (n - 1))) : baseAmt;
      let unitPrice = applyPriceMin >= applyPriceMax ? applyPriceMin : round2(applyPriceMin + Math.random() * (applyPriceMax - applyPriceMin));
      if (!(unitPrice > 0)) unitPrice = 1;
      // 发票语义：总价 = 数量 × 单价（数量向下取整保证不超目标额）
      const quantity = Math.max(1, Math.floor(target / unitPrice));
      const amount = round2(quantity * unitPrice);
      drafts.push({ amount, unitPrice, quantity, supplier: '' });
    }
    setPreviewDrafts(drafts);
    setPreviewVisible(true);
  };

  // 预览中手动调整：改数量/单价→总价=数量×单价恒等重算
  const updateDraft = (idx: number, patch: Partial<{ amount: number; unitPrice: number; quantity: number; supplier: string }>) => {
    setPreviewDrafts(prev => prev.map((d, i) => {
      if (i !== idx) return d;
      const next = { ...d, ...patch };
      if (patch.quantity !== undefined) next.quantity = Math.max(1, Math.round(patch.quantity));
      if (patch.unitPrice !== undefined) next.unitPrice = Math.max(0.01, round2(patch.unitPrice));
      next.amount = round2((next.quantity || 0) * (next.unitPrice || 0));
      return next;
    }));
  };

  // 确认申请：写开票记录（source=apply）+ 合作供应商推送收件箱 + 记忆设置
  const handleConfirmApply = () => {
    const sum = round2(previewDrafts.reduce((s, d) => s + (d.amount || 0), 0));
    if (previewDrafts.length === 0) { message.warning('请先生成发票'); return; }
    if (previewDrafts.some(d => !(d.amount > 0))) { message.warning('每张发票金额必须大于 0'); return; }
    if (previewDrafts.some(d => !(d.quantity > 0))) { message.warning('发票数量必须为正数'); return; }
    if (previewDrafts.some(d => !String(d.supplier || '').trim())) { message.warning('请为每张发票选择开票供应商'); return; }
    if (sum > round2(applyAvailable * applyRatio / 100) + 0.001) { message.warning(`发票金额合计 ¥${sum.toFixed(2)} 超过按比例生成金额 ¥${round2(applyAvailable * applyRatio / 100).toFixed(2)}（可申请 ¥${applyAvailable.toFixed(2)} × ${applyRatio}%）`); return; }
    // 记忆设置（限额/单价区间/项目名称历史）
    let st: any = {};
    try { st = JSON.parse(localStorage.getItem(applySettingsKey) || '{}'); } catch { /* ignore */ }
    const projectNames = Array.from(new Set([applyProjectName.trim(), ...(Array.isArray(st.projectNames) ? st.projectNames : [])])).filter(Boolean).slice(0, 10);
    safeSetItem(applySettingsKey, JSON.stringify({ limit: applyLimit, priceMin: applyPriceMin, priceMax: applyPriceMax, ratio: applyRatio, projectName: applyProjectName.trim(), projectNames }));
    // 写开票记录
    const recKey = `invoice_record_${owner}`;
    let recs: any[] = [];
    try { recs = JSON.parse(localStorage.getItem(recKey) || '[]'); } catch { recs = []; }
    const today = dayjs().format('YYYY-MM-DD');
    const creator = currentDisplayName();
    const myCompany = localStorage.getItem('companyName') || owner;
    const newRecs: any[] = [];
    let pushed = 0;
    previewDrafts.forEach(d => {
      const applyNo = nextApplyNo([...recs, ...newRecs], dayjs().format('YYYYMMDD'));
      const supplierName = String(d.supplier || '').trim();
      const { username, cooperated } = resolveSupplier(owner, supplierName);
      let pushStatus: '推送成功' | '待推送' = '待推送';
      // 已合作供应商：自动推送到对方「财务管理-开票申请」收件箱
      if (cooperated && username) {
        upsertInboxEntry(username, {
          key: applyNo, applyNo, applicantUsername: owner, applicantCompany: myCompany,
          supplierName, projectName: applyProjectName.trim(), amount: d.amount, quantity: d.quantity,
          unitPrice: d.unitPrice, months: applyMonthsSnap, applyDate: today, status: '待开票', remark: '', taxRate: applyTaxRate,
        });
        pushStatus = '推送成功';
        pushed++;
      }
      newRecs.push({
        key: `inv-${Date.now()}-${newRecs.length}`, companyName: applyCompany, invoiceType: '进项票',
        quantity: d.quantity, unitPrice: d.unitPrice, amount: d.amount, date: today, creator,
        remark: '开票申请生成', image: '', source: 'apply', applyNo, applyMonths: applyMonthsSnap,
        invoiceStatus: '待开票', invoiceSupplier: supplierName, supplierUsername: username,
        pushStatus, projectName: applyProjectName.trim(), gapAmount: round2(d.amount * 100 / applyRatio), taxRate: applyTaxRate, createdAt: new Date().toLocaleString('zh-CN'),
      });
    });
    const merged = [...recs, ...newRecs];
    const json = JSON.stringify(merged);
    safeSetItem(recKey, json);
    safeSetItem(`${recKey}_ts`, String(Date.now()));
    saveDataset(recKey, json);
    setInvoiceRecords(merged);
    setPreviewVisible(false);
    setApplyVisible(false);
    message.success(`已生成 ${newRecs.length} 张发票申请并计入开票记录${pushed > 0 ? `，其中 ${pushed} 张已推送合作供应商` : '（未合作供应商待推送）'}`);
  };

  // 最近12个月销售额统计（按公司名称）
  const recentSalesTotals = useMemo(() => {
    const map: Record<string, number> = {};
    const now = dayjs();
    const twelveMonthsAgo = now.subtract(11, 'month').startOf('month'); // 包含当前月共12个月
    salesRecords.forEach((r) => {
      if (!r.companyName || !r.month) return;
      const recordMonth = dayjs(r.month + '-01');
      if (recordMonth.isBefore(twelveMonthsAgo) || recordMonth.isAfter(now.endOf('month'))) return;
      if (!map[r.companyName]) map[r.companyName] = 0;
      map[r.companyName] += (r.salesAmount || 0);
    });
    return map;
  }, [salesRecords]);

  // 店铺销售额动态统计（根据选中的月份从销售额统计表中汇总）
  const storeSalesTotals = useMemo(() => {
    const map: Record<string, number> = {};
    salesRecords.forEach((r) => {
      if (!r.companyName || !r.month) return;
      // 如果有选中月份，只统计选中月份的数据；否则统计全部数据
      if (selectedMonths.length > 0 && !selectedMonths.includes(r.month)) return;
      if (!map[r.companyName]) map[r.companyName] = 0;
      map[r.companyName] += (r.salesAmount || 0);
    });
    return map;
  }, [salesRecords, selectedMonths]);

  const saveRecords = (list: BusinessLicense[]) => {
    const json = JSON.stringify(list);
    safeSetItem(storageKey, json);
    safeSetItem(`${storageKey}_ts`, String(Date.now()));
    saveDataset(storageKey, json);
    setRecords(list);
  };

  // ===================== CRUD =====================
  const openAdd = () => {
    setEditingRecord(null);
    setFormName(''); setFormTaxpayerCode(''); setFormCompanyType(''); setFormAccountingCompany('');
    setFormRemark(''); setFormImage(''); setFormVatRate(null); setFormLegalPerson('');
    setEditVisible(true);
  };

  const openEdit = (r: BusinessLicense) => {
    setEditingRecord(r);
    setFormName(r.companyName);
    setFormTaxpayerCode(r.taxpayerCode || '');
    setFormLegalPerson(r.legalPerson || '');
    setFormCompanyType(r.companyType || '');
    setFormVatRate(typeof r.vatRate === 'number' ? r.vatRate : null);
    setFormAccountingCompany(r.accountingCompany || '');
    setFormRemark(r.remark || '');
    setFormImage(r.image || '');
    setEditVisible(true);
  };

  // 级联改名：公司名称修改后，同步更新同租户其他业务数据集中对公司名称的引用（companyName/company 字段），
  // 使店铺列表/销售额统计/开票记录等关联数据自动跟随新名称，避免改名后关联断开仍显示旧名称
  const cascadeRenameCompany = useCallback((oldName: string, newName: string): number => {
    const COMPANY_FIELDS = ['companyName', 'company'];
    const renameIn = (node: any): boolean => {
      if (Array.isArray(node)) {
        let changed = false;
        node.forEach(it => { if (renameIn(it)) changed = true; });
        return changed;
      }
      if (node && typeof node === 'object') {
        let changed = false;
        Object.keys(node).forEach(k => {
          const v = (node as Record<string, any>)[k];
          if (typeof v === 'string' && COMPANY_FIELDS.includes(k) && v === oldName) {
            (node as Record<string, any>)[k] = newName; changed = true;
          } else if (renameIn(v)) changed = true;
        });
        return changed;
      }
      return false;
    };
    const suffix = `_${owner}`;
    let touched = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.endsWith(suffix) || key === storageKey || key.endsWith('_ts')) continue;
      let parsed: any;
      try { parsed = JSON.parse(localStorage.getItem(key) || ''); } catch { continue; }
      if (!renameIn(parsed)) continue;
      const json = JSON.stringify(parsed);
      safeSetItem(key, json);
      safeSetItem(`${key}_ts`, String(Date.now()));
      saveDataset(key, json);
      touched++;
    }
    return touched;
  }, [owner, storageKey]);

  const handleSave = () => {
    if (!formName.trim()) { message.warning('请输入公司名称'); return; }
    const list = [...records];
    const data = {
      companyName: formName.trim(),
      taxpayerCode: formTaxpayerCode.trim(),
      legalPerson: formLegalPerson.trim(),
      companyType: formCompanyType,
      vatRate: formVatRate === null ? undefined : formVatRate,
      accountingCompany: formAccountingCompany.trim(),
      remark: formRemark.trim(),
      image: formImage,
    };
    const oldName = editingRecord ? editingRecord.companyName : '';
    if (editingRecord) {
      const idx = list.findIndex(r => r.key === editingRecord.key);
      if (idx >= 0) list[idx] = { ...list[idx], ...data };
    } else {
      list.push({ key: `bl-${Date.now()}`, ...data, createdAt: new Date().toLocaleString('zh-CN') });
    }
    saveRecords(list);
    // 公司名称变更时级联更新其他页面的关联数据（店铺列表/销售额统计/开票记录等）
    if (editingRecord && oldName && data.companyName !== oldName) {
      const touched = cascadeRenameCompany(oldName, data.companyName);
      reload();
      reloadSales();
      if (touched > 0) message.info(`公司名称已修改，${touched} 个关联数据集已自动同步为新名称`);
    }
    setEditVisible(false);
    message.success(editingRecord ? '记录已更新' : '记录已添加');
  };

  const handleDelete = (key: string) => {
    saveRecords(records.filter(r => r.key !== key));
    message.success('记录已删除');
  };

  // 图片粘贴上传
  const handleImagePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (!blob) return;
        compressImageFile(blob).then(dataUrl => setFormImage(dataUrl)).catch(() => message.error('图片处理失败'));
        break;
      }
    }
  }, []);

  // ===================== 过滤 =====================
  const filtered = useMemo(() => {
    let list = records;
    if (appliedSearchText.trim()) {
      const q = appliedSearchText.toLowerCase();
      list = list.filter(r =>
        r.companyName.toLowerCase().includes(q) ||
        (r.taxpayerCode || '').toLowerCase().includes(q)
      );
    }
    if (appliedSearchAcCompany) {
      list = list.filter(r => r.accountingCompany === appliedSearchAcCompany);
    }
    return list;
  }, [records, appliedSearchText, appliedSearchAcCompany]);

  // 列宽拖拽
  const { wrapColumns } = useResizableColumns<BusinessLicense>(`colWidths_bizLicense_${owner}`);
  const { wrapColumns: wrapSalesColumns } = useResizableColumns<SalesRecord>(`colWidths_salesStats_${owner}`);

  // ===================== 表格列 =====================
  // 列标题带数据来源提示
  const tipTitle = (text: string, tip: string) => (
    <span>{text} <Tooltip title={tip}><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></span>
  );
  const columnMap: Record<string, any> = {
    companyName: { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 180, fixed: 'left' as const, align: 'center',
      render: (v: string) => <Text strong>{v}</Text> },
    taxpayerCode: { title: '纳税人识别码', dataIndex: 'taxpayerCode', key: 'taxpayerCode', width: 150, align: 'center',
      render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
    legalPerson: { title: '法人代表', dataIndex: 'legalPerson', key: 'legalPerson', width: 110, align: 'center',
      render: (v: string) => v ? <Text strong>{v}</Text> : <Text type="secondary">—</Text> },
    companyType: { title: '公司类型', dataIndex: 'companyType', key: 'companyType', width: 120, align: 'center',
      render: (v: string) => {
        if (!v) return <Text type="secondary">—</Text>;
        if (v === '小规模纳税人') return <Tag style={{ background: '#52c41a', color: '#fff', border: 'none', fontWeight: 500 }}>小规模纳税人</Tag>;
        if (v === '一般纳税人') return <Tag style={{ background: '#1677ff', color: '#fff', border: 'none', fontWeight: 500 }}>一般纳税人</Tag>;
        return <Tag>{v}</Tag>;
      } },
    vatRate: { title: '增值税税率', dataIndex: 'vatRate', key: 'vatRate', width: 110, align: 'center',
      render: (v: number) => typeof v === 'number' ? <Tag color="blue">{v}%</Tag> : <Text type="secondary">—</Text> },
    storeCount: { title: tipTitle('开店数量', '数据来源：店铺列表中公司名称匹配的店铺数量'), key: 'storeCount', width: 110, align: 'center',
      render: (_: any, r: BusinessLicense) => {
        const stats = shopStatsByCompany[r.companyName];
        const count = stats?.count || 0;
        if (count === 0) return <Text type="secondary">0</Text>;
        return (
          <Tag
            color="blue"
            style={{ cursor: 'pointer' }}
            onClick={() => { setShopDetailCompany(r.companyName); setShopDetailVisible(true); }}
          >{count} 家</Tag>
        );
      } },
    accountingCompany: { title: '代账公司', dataIndex: 'accountingCompany', key: 'accountingCompany', width: 140, align: 'center',
      render: (v: string) => {
        if (!v) return <Text type="secondary">—</Text>;
        return <Tag style={{ background: getAcColor(v), color: '#333', border: 'none', fontWeight: 500 }}>{v}</Tag>;
      } },
    remark: { title: '备注', dataIndex: 'remark', key: 'remark', width: 150, align: 'center',
      render: (v: string) => v ? <Text>{v}</Text> : <Text type="secondary">—</Text> },
    storeSales: { title: tipTitle('店铺销售额', '数据来源：销售额统计中对应月份该公司的销售额总和'), key: 'storeSales', width: 140, align: 'center' as const,
      render: (_: any, r: BusinessLicense) => {
        const total = storeSalesTotals[r.companyName] || 0;
        return total > 0 ? <Text strong>¥{total.toFixed(2)}</Text> : <Text type="secondary">—</Text>;
      } },
    inputInvoices: { title: tipTitle('进项票', '数据来源：开票记录中对应月份该公司的进项票金额总和（含已开票的开票申请）；按进项差额发起开票申请后，按所选时间范围显示开票中/开票完成'), dataIndex: 'companyName', key: 'inputInvoices', width: 160, align: 'center' as const,
      render: (v: string, r: BusinessLicense) => {
        const manual = invoiceTotals[v]?.input || 0;
        const st = applyStats[v];
        const applied = st?.applied || 0;
        const pending = st?.pending || 0;
        const issued = st?.issued || 0;
        const consumed = st?.consumedGap || 0;
        const totalInput = Math.round((manual + issued) * 100) / 100;
        const statusTag = pending > 0
          ? <Tag color="blue" style={{ margin: 0 }}>开票中</Tag>
          : consumed > 0 ? <Tag color="green" style={{ margin: 0 }}>开票完成</Tag> : null;
        return (
          <Tooltip title={consumed > 0 ? `已申请发票 ¥${applied.toFixed(2)}（待开票 ¥${pending.toFixed(2)}、已开票 ¥${issued.toFixed(2)}，消耗差额 ¥${consumed.toFixed(2)}）` : undefined}>
            <Space size={4} wrap style={{ justifyContent: 'center' }}>
              {totalInput > 0 ? <Text strong style={{ color: '#fa8c16' }}>¥{totalInput.toFixed(2)}</Text> : <Text type="secondary">—</Text>}
              {statusTag}
            </Space>
          </Tooltip>
        );
      } },
    outputInvoices: { title: tipTitle('销项票', '数据来源：开票记录中对应月份该公司的销售发票金额总和'), dataIndex: 'companyName', key: 'outputInvoices', width: 150, align: 'center' as const,
      render: (v: string, r: BusinessLicense) => {
        const total = invoiceTotals[v]?.output || 0;
        return total > 0 ? <Text strong style={{ color: '#f5222d' }}>¥{total.toFixed(2)}</Text> : <Text type="secondary">—</Text>;
      } },
    inputDiff: { title: tipTitle('进项差额', '计算公式：max(销项票, 店铺销售额) − 进项票；「申请开票」按差额扣除已申请金额后的剩余缺口生成开票申请'), key: 'inputDiff', width: 200, align: 'center' as const,
      render: (_: any, r: BusinessLicense) => {
        const inputTotal = invoiceTotals[r.companyName]?.input || 0;
        const outputTotal = invoiceTotals[r.companyName]?.output || 0;
        const sales = storeSalesTotals[r.companyName] || 0;
        const st = applyStats[r.companyName];
        const applied = st?.applied || 0;
        const pending = st?.pending || 0;
        const consumed = st?.consumedGap || 0;
        const hasData = !(inputTotal === 0 && outputTotal === 0 && sales === 0 && consumed === 0);
        const base = Math.max(outputTotal, sales);
        // 差额扣除全部已消耗缺口（含按比例未实开部分）；剩余可申请额度 = 剩余差额
        const diff = base - inputTotal - consumed;
        const remaining = Math.max(0, Math.round(diff * 100) / 100);
        const color = diff > 0 ? '#52c41a' : diff < 0 ? '#f5222d' : '#595959';
        return (
          <Space size={4} wrap style={{ justifyContent: 'center' }}>
            {hasData ? <Text strong style={{ color }}>¥{diff.toFixed(2)}</Text> : <Text type="secondary">—</Text>}
            <Tooltip title={consumed > 0 ? `已消耗差额 ¥${consumed.toFixed(2)}（已申请发票 ¥${applied.toFixed(2)}、待开票 ¥${pending.toFixed(2)}），剩余可申请 ¥${remaining.toFixed(2)}` : '按每张发票限额/开票比例/单价区间/项目名称生成开票申请'}>
              <Button type="link" size="small" icon={<SendOutlined />} disabled={remaining <= 0}
                onClick={() => openApplyModal(r.companyName, remaining)}>申请开票</Button>
            </Tooltip>
          </Space>
        );
      } },
    recentSales: { title: tipTitle('近12个月销售额', '数据来源：销售额统计中最近12个月该公司的销售额总和（小规模纳税人超450万显示异常）'), key: 'recentSales', width: 180, align: 'center' as const,
      render: (_: any, r: BusinessLicense) => {
        const total = recentSalesTotals[r.companyName] || 0;
        if (total === 0) return <Text type="secondary">—</Text>;
        // 小规模纳税人超过450万显示异常
        const isAbnormal = r.companyType === '小规模纳税人' && total > 4500000;
        return (
          <span style={{ whiteSpace: 'normal' }}>
            <Text strong style={{ color: isAbnormal ? '#f5222d' : '#722ed1' }}>¥{total.toFixed(2)}</Text>
            {isAbnormal && <Text style={{ color: '#f5222d', fontWeight: 700, marginLeft: 4 }}>异</Text>}
          </span>
        );
      } },
    image: { title: '图片', dataIndex: 'image', key: 'image', width: 80, align: 'center',
      render: (v: string) => v ? (
        <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }}
          preview={{ mask: <PictureOutlined /> }} />
      ) : <Text type="secondary">—</Text> },
    createdAt: { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160, align: 'center' },
  };
  const actionColumn = {
    title: '操作', key: 'action', width: 140, fixed: 'right' as const, align: 'center' as const,
    render: (_: any, r: BusinessLicense) => (
      <Space size="small">
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确认删除此记录？" onConfirm={() => handleDelete(r.key)} okText="确认" cancelText="取消">
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    ),
  };
  // 根据字段控制和排序构建最终列
  const columns: ColumnsType<BusinessLicense> = [
    ...fieldOrder.filter(k => fieldVisibility[k] && columnMap[k]).map(k => columnMap[k]),
    actionColumn,
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* 横向菜单栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: '#fff',
        borderRadius: 8,
        marginBottom: 16,
        padding: '0 12px',
        height: 42,
        borderBottom: '1px solid #e8ecf1',
        gap: 4,
      }}>
        {subTabs.map(tab => (
          <div
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              cursor: 'pointer',
              borderRadius: '6px 6px 0 0',
              fontSize: 14,
              whiteSpace: 'nowrap',
              background: activeTab === tab.key ? '#fff' : 'transparent',
              color: activeTab === tab.key ? PRIMARY : '#595959',
              fontWeight: activeTab === tab.key ? 600 : 400,
              borderBottom: activeTab === tab.key ? `2px solid ${PRIMARY}` : '2px solid transparent',
              transition: 'all 0.2s',
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </div>
        ))}
      </div>

      {/* 开票记录标签页 */}
      {activeTab === 'invoice' && <InvoiceRecordPage />}

      {/* 营业执照列表标签页 */}
      {activeTab === 'license' && (<>
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <PictureOutlined style={{ fontSize: 22, color: PRIMARY }} />
              <Title level={4} style={{ margin: 0, color: PRIMARY }}>营业执照列表</Title>
              <Tag color="blue">{records.length} 条记录</Tag>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              <Input.Search placeholder="搜索公司名称/识别码" value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onPressEnter={handleSearch}
                allowClear style={{ width: 220 }} />
              <Input
                readOnly value={searchAcCompany} placeholder="代账公司筛选"
                suffix={<SearchOutlined style={{ color: PRIMARY, cursor: 'pointer' }} />}
                onClick={() => { setAcPickerTarget('search'); setAcPickerVisible(true); setAcPickerSearch(''); }}
                allowClear style={{ width: 150, cursor: 'pointer' }}
                onChange={e => { if (!e.target.value) setSearchAcCompany(''); }}
              />
              <DatePicker picker="month" placeholder="选择月份筛选"
                value={selectedMonths.length === 1 ? dayjs(selectedMonths[0] + '-01') : null}
                onChange={(d) => setSelectedMonths(d ? [d.format('YYYY-MM')] : [])}
                allowClear style={{ width: 150 }} />
              <Button size="small" onClick={() => setSelectedMonths([dayjs().format('YYYY-MM')])}>本月</Button>
              <Button size="small" onClick={() => setSelectedMonths([dayjs().subtract(1, 'month').format('YYYY-MM')])}>上月</Button>
              {(() => {
                const year = dayjs().year();
                const quarters = [
                  { label: 'Q1', months: [`${year}-01`, `${year}-02`, `${year}-03`] },
                  { label: 'Q2', months: [`${year}-04`, `${year}-05`, `${year}-06`] },
                  { label: 'Q3', months: [`${year}-07`, `${year}-08`, `${year}-09`] },
                  { label: 'Q4', months: [`${year}-10`, `${year}-11`, `${year}-12`] },
                ];
                return quarters.map(q => {
                  const isActive = q.months.length === selectedMonths.length && q.months.every(m => selectedMonths.includes(m));
                  return (
                    <Button key={q.label} size="small" type={isActive ? 'primary' : 'default'}
                      onClick={() => setSelectedMonths(isActive ? [] : q.months)}>{q.label}</Button>
                  );
                });
              })()}
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} style={{ color: '#fff' }}>查询</Button>
              <Button icon={<ClearOutlined />} onClick={handleReset}>重置</Button>
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button icon={<SettingOutlined />} onClick={() => setFieldConfigVisible(true)}>显示字段</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <style>{`
          .biz-license-table .ant-table-cell { white-space: normal !important; word-break: break-all; overflow-wrap: anywhere; }
        `}</style>
        <div className="biz-license-table">
        <Table<BusinessLicense>
          bordered
          columns={wrapColumns(columns)}
          dataSource={filtered}
          rowKey="key"
          scroll={{ y: 'calc(100vh - 320px)' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条记录` }}
          size="middle"
          locale={{ emptyText: '暂无记录，请点击“新增”添加' }}
        />
        </div>
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal title={editingRecord ? '编辑营业执照' : '新增营业执照'} open={editVisible}
        onCancel={() => setEditVisible(false)} onOk={handleSave}
        okText={editingRecord ? '保存' : '添加'} cancelText="取消" width={560}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>公司名称 <Text type="danger">*</Text></Text></div>
          <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="请输入公司名称" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>纳税人识别码</Text></div>
          <Input value={formTaxpayerCode} onChange={e => setFormTaxpayerCode(e.target.value)} placeholder="请输入纳税人识号码" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>法人代表</Text></div>
          <Input value={formLegalPerson} onChange={e => setFormLegalPerson(e.target.value)} placeholder="请输入法人代表姓名" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>公司类型</Text></div>
          <Select
            value={formCompanyType || undefined}
            onChange={v => setFormCompanyType(v)}
            placeholder="请选择公司类型"
            allowClear
            style={{ width: '100%' }}
            options={[
              {
                value: '小规模纳税人',
                label: <span style={{ background: '#52c41a', color: '#fff', padding: '2px 10px', borderRadius: 4, fontSize: 13 }}>小规模纳税人</span>,
              },
              {
                value: '一般纳税人',
                label: <span style={{ background: '#1677ff', color: '#fff', padding: '2px 10px', borderRadius: 4, fontSize: 13 }}>一般纳税人</span>,
              },
            ]}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>增值税税率</Text></div>
          <InputNumber value={formVatRate} onChange={v => setFormVatRate(v === null || v === undefined ? null : Number(v))}
            min={0} max={100} precision={2} style={{ width: '100%' }} placeholder="请输入增值税税率（如 13）" suffix="%" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>代账公司</Text></div>
          <Input
            readOnly value={formAccountingCompany} placeholder="点击选择代账公司"
            suffix={<BankOutlined style={{ color: PRIMARY, cursor: 'pointer' }} />}
            onClick={() => { setAcPickerTarget('form'); setAcPickerVisible(true); setAcPickerSearch(''); }}
            style={{ cursor: 'pointer' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>备注</Text></div>
          <Input.TextArea value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="请输入备注信息" rows={3} />
        </div>
        <div style={{ marginBottom: 16 }} onPaste={handleImagePaste}>
          <div style={{ marginBottom: 6 }}><Text>图片 <Text type="secondary" style={{ fontSize: 12 }}>（支持粘贴 Ctrl+V）</Text></Text></div>
          {formImage ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Image src={formImage} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
              <Button size="small" danger type="text" icon={<DeleteOutlined />}
                onClick={() => setFormImage('')}
                style={{ position: 'absolute', top: -8, right: -8 }} />
            </div>
          ) : (
            <div style={{ width: 120, height: 120, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'image/*';
                input.onchange = async (ev: any) => {
                  const file = ev.target?.files?.[0];
                  if (!file) return;
                  compressImageFile(file).then(dataUrl => { setFormImage(dataUrl); }).catch(() => message.error('图片处理失败'));
                };
                input.click();
              }}>
              <div style={{ textAlign: 'center' }}>
                <PictureOutlined style={{ fontSize: 24 }} />
                <div style={{ fontSize: 12, marginTop: 4 }}>点击/粘贴</div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 代账公司选择器弹窗 */}
      <Modal
        title={<span><BankOutlined style={{ marginRight: 8 }} />{acPickerTarget === 'form' ? '选择代账公司' : '按代账公司筛选'}</span>}
        open={acPickerVisible}
        onCancel={() => setAcPickerVisible(false)}
        footer={null}
        width={480}
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <Input
            placeholder="搜索或输入新代账公司名称"
            value={acPickerSearch}
            onChange={e => setAcPickerSearch(e.target.value)}
            allowClear
            style={{ flex: 1 }}
          />
          <Button
            type="primary" icon={<PlusOutlined />}
            onClick={() => {
              const name = acPickerSearch.trim();
              if (!name) { message.warning('请输入代账公司名称'); return; }
              if (accountingCompanies.includes(name)) { message.warning('该公司已存在'); return; }
              const updated = [...accountingCompanies, name];
              setAccountingCompanies(updated);
              localStorage.setItem(acStorageKey, JSON.stringify(updated));
              message.success(`已添加「${name}」`);
              setAcPickerSearch('');
            }}
          >新增</Button>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {(() => {
            const filtered = acPickerSearch.trim()
              ? accountingCompanies.filter(c => c.toLowerCase().includes(acPickerSearch.toLowerCase()))
              : accountingCompanies;
            if (filtered.length === 0) {
              return <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>暂无代账公司，请在上方输入名称并点击“新增”</div>;
            }
            return filtered.map((name, idx) => {
              const isSelected = acPickerTarget === 'form'
                ? formAccountingCompany === name
                : searchAcCompany === name;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (acPickerTarget === 'form') {
                      setFormAccountingCompany(name);
                    } else {
                      setSearchAcCompany(name);
                    }
                    setAcPickerVisible(false);
                  }}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 6,
                    marginBottom: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: `1px solid ${isSelected ? PRIMARY : '#f0f0f0'}`,
                    background: isSelected ? '#f0f7ff' : '#fff',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f5f8ff'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isSelected ? '#f0f7ff' : '#fff'; }}
                >
                  <Text strong style={{ fontSize: 14 }}>{name}</Text>
                  <Space>
                    {isSelected && <Tag color="blue">已选</Tag>}
                    <Button size="small" type="text" danger icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        const updated = accountingCompanies.filter(c => c !== name);
                        setAccountingCompanies(updated);
                        localStorage.setItem(acStorageKey, JSON.stringify(updated));
                        // 如果删除的是当前已选的，清空选择
                        if (acPickerTarget === 'form' && formAccountingCompany === name) setFormAccountingCompany('');
                        if (acPickerTarget === 'search' && searchAcCompany === name) setSearchAcCompany('');
                      }}
                    />
                  </Space>
                </div>
              );
            });
          })()}
        </div>
        {acPickerTarget === 'search' && searchAcCompany && (
          <div style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => { setSearchAcCompany(''); setAcPickerVisible(false); }}>清除筛选</Button>
          </div>
        )}
        {acPickerTarget === 'form' && (
          <div style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => { setFormAccountingCompany(''); setAcPickerVisible(false); }}>清除选择</Button>
          </div>
        )}
      </Modal>

      {/* 显示字段控制弹窗（统一卡片式+拖动排序） */}
      <FieldConfigModal
        open={fieldConfigVisible}
        fields={ALL_FIELDS}
        order={fieldOrder}
        visibility={fieldVisibility}
        onCancel={() => setFieldConfigVisible(false)}
        onSave={(o, v) => { setFieldOrder(o); setFieldVisibility(v); saveFieldConfig(o, v); setFieldConfigVisible(false); message.success('已保存'); }}
      />

      {/* 店铺明细弹窗 */}
      <Modal
        title={<span><ProfileOutlined style={{ marginRight: 8 }} />店铺明细 — {shopDetailCompany}</span>}
        open={shopDetailVisible}
        onCancel={() => setShopDetailVisible(false)}
        footer={null}
        width={600}
      >
        <Table
          rowKey="key"
          size="small"
          bordered
          pagination={false}
          scroll={{ y: 360 }}
          dataSource={(shopStatsByCompany[shopDetailCompany]?.shops || []).map((s: any) => ({ ...s, key: s.key || s.shopName }))}
          columns={[
            { title: '店铺名称', dataIndex: 'shopName', key: 'shopName',
              render: (v: string) => <Text strong>{v}</Text> },
            { title: '所属平台', dataIndex: 'platform', key: 'platform',
              render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : <Text type="secondary">—</Text> },
            { title: '负责人', dataIndex: 'person', key: 'person',
              render: (v: string) => v ? <Text>{v}</Text> : <Text type="secondary">—</Text> },
          ]}
        />
      </Modal>
      </>)}

      {/* 销售额统计标签页 */}
      {activeTab === 'sales' && (<>
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <BarChartOutlined style={{ fontSize: 22, color: PRIMARY }} />
              <Title level={4} style={{ margin: 0, color: PRIMARY }}>销售额统计</Title>
              <Tag color="blue">{salesRecords.length} 条记录</Tag>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              <Button type="primary" icon={<PlusOutlined />} onClick={openSalesAdd}>新增记录</Button>
              <Button icon={<SendOutlined />} onClick={() => { setSalesTaskSelected([]); setSalesTaskMonths([]); setSalesTaskVisible(true); }}>发起销售额统计任务</Button>
              <Button icon={<SettingOutlined />} onClick={() => setSalesFieldConfigVisible(true)}>显示字段</Button>
              <Button icon={<ReloadOutlined />} onClick={reloadSales}>刷新</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <Space wrap>
          <Input placeholder="店铺名称" value={salesSearchShopName} onChange={e => setSalesSearchShopName(e.target.value)} allowClear style={{ width: 140 }} />
          <Input placeholder="店铺编号" value={salesSearchShopNo} onChange={e => setSalesSearchShopNo(e.target.value)} allowClear style={{ width: 130 }} />
          <Input placeholder="公司名称" value={salesSearchCompanyName} onChange={e => setSalesSearchCompanyName(e.target.value)} allowClear style={{ width: 140 }} />
          <DatePicker picker="month" placeholder="月份" value={salesSearchMonth ? dayjs(salesSearchMonth + '-01') : null}
            onChange={(d) => setSalesSearchMonth(d ? d.format('YYYY-MM') : '')} allowClear style={{ width: 130 }} />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSalesSearch} style={{ color: '#fff' }}>查询</Button>
        </Space>
      </Card>

      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<SalesRecord>
          bordered
          columns={wrapSalesColumns([
            ...salesFieldOrder.filter(k => salesFieldVisibility[k]).map(k => {
              const colMap: Record<string, any> = {
                shopName: { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 160, align: 'center' as const,
                  render: (v: string) => <Text strong>{v}</Text> },
                shopNo: { title: '店铺编号', dataIndex: 'shopNo', key: 'shopNo', width: 130, align: 'center' as const,
                  render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
                companyName: { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 160, align: 'center' as const },
                month: { title: '月份', dataIndex: 'month', key: 'month', width: 120, align: 'center' as const,
                  render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—</Text> },
                salesAmount: { title: '销售额', dataIndex: 'salesAmount', key: 'salesAmount', width: 140, align: 'center' as const,
                  render: (v: number) => v ? <Text strong style={{ color: '#1677ff' }}>¥{v.toFixed(2)}</Text> : <Text type="secondary">—</Text> },
              };
              return colMap[k];
            }).filter(Boolean),
            { title: '操作', key: 'action', width: 130, fixed: 'right' as const, align: 'center' as const,
              render: (_: any, r: SalesRecord) => (
                <Space size="small">
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openSalesEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除？" onConfirm={() => handleSalesDelete(r.key)} okText="确认" cancelText="取消">
                    <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ])}
          dataSource={salesFiltered}
          rowKey="key"
          scroll={{ y: 'calc(100vh - 380px)' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条记录` }}
          size="middle"
          locale={{ emptyText: '暂无记录，请点击“新增记录”添加' }}
        />
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal title={salesEditingRecord ? '编辑销售记录' : '新增销售记录'} open={salesEditVisible}
        onCancel={() => setSalesEditVisible(false)} onOk={handleSalesSave}
        okText={salesEditingRecord ? '保存' : '添加'} cancelText="取消" width={520}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>店铺名称 <Text type="danger">*</Text></Text></div>
          <Input readOnly value={salesFormShopName} placeholder="点击选择店铺"
            suffix={<ShopOutlined style={{ color: PRIMARY, cursor: 'pointer' }} />}
            onClick={() => { setSalesShopPickerVisible(true); setSalesShopPickerSearch(''); }}
            style={{ cursor: 'pointer' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>店铺编号</Text></div>
          <Input value={salesFormShopNo} readOnly placeholder="自动匹配" style={{ background: '#f5f5f5' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>公司名称</Text></div>
          <Input value={salesFormCompanyName} readOnly placeholder="自动匹配" style={{ background: '#f5f5f5' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>月份 <Text type="danger">*</Text></Text></div>
          <DatePicker picker="month" value={salesFormMonth ? dayjs(salesFormMonth + '-01') : null}
            onChange={(d) => setSalesFormMonth(d ? d.format('YYYY-MM') : '')}
            allowClear style={{ width: '100%' }} placeholder="请选择月份" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>销售额</Text></div>
          <InputNumber value={salesFormAmount} onChange={v => setSalesFormAmount(v || 0)} min={0} precision={2}
            style={{ width: '100%' }} placeholder="请输入销售额" prefix="¥" />
        </div>
      </Modal>

      {/* 店铺选择弹窗 */}
      <Modal
        title={<span><ShopOutlined style={{ marginRight: 8 }} />选择店铺</span>}
        open={salesShopPickerVisible}
        onCancel={() => setSalesShopPickerVisible(false)}
        footer={null}
        width={640}
      >
        <Input placeholder="搜索店铺名称" value={salesShopPickerSearch}
          onChange={e => setSalesShopPickerSearch(e.target.value)}
          allowClear style={{ marginBottom: 12 }} />
        <Table
          rowKey="key"
          size="small"
          bordered
          pagination={false}
          scroll={{ y: 360 }}
          dataSource={shops.filter((s: any) => {
            if (!salesShopPickerSearch.trim()) return true;
            const q = salesShopPickerSearch.toLowerCase();
            return (s.shopName || '').toLowerCase().includes(q) ||
              (s.companyName || '').toLowerCase().includes(q);
          })}
          onRow={(record: any) => ({
            onClick: () => handleSalesShopSelect(record),
            style: { cursor: 'pointer' },
          })}
          columns={[
            { title: '店铺名称', dataIndex: 'shopName', key: 'shopName',
              render: (v: string) => <Text strong>{v}</Text> },
            { title: '店铺编号', dataIndex: 'accountId', key: 'accountId',
              render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
            { title: '所属平台', dataIndex: 'platform', key: 'platform',
              render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : <Text type="secondary">—</Text> },
            { title: '公司名称', dataIndex: 'companyName', key: 'companyName' },
          ]}
        />
      </Modal>

      {/* 销售额字段控制弹窗（统一卡片式+拖动排序） */}
      <FieldConfigModal
        open={salesFieldConfigVisible}
        fields={SALES_ALL_FIELDS}
        order={salesFieldOrder}
        visibility={salesFieldVisibility}
        onCancel={() => setSalesFieldConfigVisible(false)}
        onSave={(o, v) => { setSalesFieldOrder(o); setSalesFieldVisibility(v); saveSalesFieldConfig(o, v); setSalesFieldConfigVisible(false); message.success('已保存'); }}
      />

      {/* ========== 发起销售额统计任务弹窗 ========== */}
      <Modal
        title={<span><SendOutlined style={{ marginRight: 8 }} />发起销售额统计任务</span>}
        open={salesTaskVisible}
        onCancel={() => { setSalesTaskVisible(false); setSalesTaskSelected([]); setSalesTaskMonths([]); }}
        onOk={handleLaunchSalesTask}
        okText="发起任务" cancelText="取消"
        width={780}
        bodyStyle={{ padding: '16px 24px' }}
      >
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8, fontSize: 13 }}>统计月份：</span>
          <Select
            mode="multiple"
            style={{ width: 360 }}
            placeholder="请选择要统计的月份（可多选）"
            value={salesTaskMonths}
            onChange={setSalesTaskMonths}
            options={recentMonthOptions}
            maxTagCount={4}
          />
        </div>
        <Table
          rowKey="key"
          size="small"
          bordered
          pagination={false}
          scroll={{ y: 320 }}
          dataSource={shops}
          rowSelection={{
            selectedRowKeys: salesTaskSelected,
            onChange: (keys) => setSalesTaskSelected(keys as string[]),
          }}
          columns={[
            { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 160,
              render: (v: string) => <Text strong>{v}</Text> },
            { title: '负责人', dataIndex: 'person', key: 'person', width: 90, align: 'center' as const,
              render: (v: string) => v ? <Text>{v}</Text> : <Text type="secondary">—</Text> },
            { title: '平台', dataIndex: 'brand', key: 'brand', width: 100, align: 'center' as const,
              render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
            { title: '统计', key: 'statsStatus', width: 90, align: 'center' as const,
              render: (_: any, r: any) => {
                if (salesTaskMonths.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>请选择月份</Text>;
                const hasRecord = getShopStatsStatus(r.shopName);
                return hasRecord
                  ? <Tag style={{ background: '#52c41a', color: '#fff', border: 'none', fontWeight: 500 }}>已统计</Tag>
                  : <Tag style={{ background: '#ff4d4f', color: '#fff', border: 'none', fontWeight: 500 }}>未统计</Tag>;
              } },
          ]}
        />
        <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
          * 选择店铺和月份后点击发起任务，将通知店铺负责人填写销售额数据。已统计表示该店铺对应月份已有销售额记录。
        </div>
      </Modal>
      </>)}

      {/* 开票申请 - 开票要求弹窗 */}
      <Modal title="开票申请 - 开票要求" open={applyVisible} onCancel={() => setApplyVisible(false)} width={560}
        footer={
          <Space>
            <Button onClick={() => setApplyVisible(false)}>取消</Button>
            <Button type="primary" onClick={handleGenerateInvoices}>生成发票</Button>
          </Space>
        }>
        <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="公司名称">{applyCompany || '—'}</Descriptions.Item>
          <Descriptions.Item label="月份范围">{applyMonthsSnap.length ? applyMonthsSnap.join('、') : '全部月份'}</Descriptions.Item>
          <Descriptions.Item label="可申请金额" span={2}>
            <Text strong style={{ color: '#fa8c16' }}>¥{applyAvailable.toFixed(2)}</Text>
          </Descriptions.Item>
        </Descriptions>
        <Row gutter={16}>
          <Col span={12}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6, minHeight: 22, lineHeight: '22px', whiteSpace: 'nowrap' }}><Text>开票比例 <Text type="secondary" style={{ fontSize: 12 }}>（%，100% 不合规）</Text></Text></div>
              <InputNumber value={applyRatio} onChange={v => setApplyRatio(v || 0)} min={1} max={99.99} precision={2}
                style={{ width: '100%' }} placeholder="如 90" />
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6, minHeight: 22, lineHeight: '22px', whiteSpace: 'nowrap' }}><Text>按比例生成开票金额 <Text type="secondary" style={{ fontSize: 12 }}>（可申请 × 比例）</Text></Text></div>
              <div style={{ width: '100%', height: 32, lineHeight: '30px', padding: '0 11px', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 6, color: '#52c41a', fontWeight: 600, overflow: 'hidden' }}>
                ¥{round2(applyAvailable * (applyRatio || 0) / 100).toFixed(2)}
              </div>
            </div>
          </Col>
        </Row>
        <div style={{ marginBottom: 12, color: '#999', fontSize: 12 }}>
          * 开票申请金额按比例生成，但进项差额按可申请金额全额扣除（比例未实开部分一并消耗，避免 100% 开票）
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>每张发票限额 <Text type="secondary" style={{ fontSize: 12 }}>（如 30 万：申请 90 万自动拆 3 张；80 万最少拆 3 张并平均分配，预览中可手动调整）</Text></Text></div>
          <InputNumber value={applyLimit} onChange={v => setApplyLimit(v || 0)} min={1} precision={2}
            style={{ width: '100%' }} placeholder="请输入每张发票限额" />
        </div>
        <Row gutter={16}>
          <Col span={12}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}><Text>单价区间下限 <Text type="secondary" style={{ fontSize: 12 }}>（元）</Text></Text></div>
              <InputNumber value={applyPriceMin} onChange={v => setApplyPriceMin(v || 0)} min={0} precision={2}
                style={{ width: '100%' }} placeholder="单价下限" />
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}><Text>单价区间上限 <Text type="secondary" style={{ fontSize: 12 }}>（元）</Text></Text></div>
              <InputNumber value={applyPriceMax} onChange={v => setApplyPriceMax(v || 0)} min={0} precision={2}
                style={{ width: '100%' }} placeholder="单价上限" />
            </div>
          </Col>
        </Row>
        <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
          * 发票数量 = 每张发票金额 ÷ 区间内随机单价（取正整数后反算单价），预览中可手动调整
        </div>
        <div>
          <div style={{ marginBottom: 6 }}><Text>项目名称 <Text type="secondary" style={{ fontSize: 12 }}>（人工填写，下次自动记忆）</Text></Text></div>
          <AutoComplete value={applyProjectName} onChange={v => setApplyProjectName(v)}
            options={applyProjectHistory.map(n => ({ value: n }))}
            placeholder="请输入项目名称"
            style={{ width: '100%' }}
            filterOption={(input, option) => String((option as any)?.value || '').toLowerCase().includes(input.toLowerCase())} />
        </div>
      </Modal>

      {/* 发票预览 - 确认申请弹窗 */}
      <Modal title="发票预览 - 确认申请" open={previewVisible} onCancel={() => setPreviewVisible(false)} width={960}
        footer={
          <Space>
            <Button onClick={() => setPreviewVisible(false)}>返回修改</Button>
            <Button type="primary" onClick={handleConfirmApply}>确认申请</Button>
          </Space>
        }>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message={`公司名称：${applyCompany}　项目名称：${applyProjectName}　发票类型：${applyCompanyType}（税率 ${applyTaxRate}%）　可申请金额：¥${applyAvailable.toFixed(2)}　开票比例：${applyRatio}%　生成开票金额：¥${round2(applyAvailable * applyRatio / 100).toFixed(2)}　月份范围：${applyMonthsSnap.length ? applyMonthsSnap.join('、') : '全部'}`}
          description="确认申请后写入开票记录（开票状态=待开票）；已合作供应商自动推送到对方「财务管理-开票申请」，未合作仅记录供应商名称（推送状态=待推送）；进项差额按可申请金额全额扣除，进项票显示开票中，已开票后申请金额计入进项票。" />
        <div style={{ maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
          {previewDrafts.map((d, i) => {
            const lineTotal = round2((d.quantity || 0) * (d.unitPrice || 0));
            return (
              <div key={i} style={{ border: '1px solid #8c8c8c', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#fafafa', borderBottom: '1px solid #8c8c8c', flexWrap: 'wrap' }}>
                  <Text strong>发票 {i + 1}</Text>
                  <Space size={4} wrap>
                    <Text type="secondary">开票供应商：</Text>
                    <AutoComplete value={d.supplier} onChange={v => updateDraft(i, { supplier: v })}
                      options={supplierOptions} placeholder="选择/输入供应商名称" style={{ width: 240 }}
                      filterOption={(input, option) => String((option as any)?.value || '').toLowerCase().includes(input.toLowerCase())} />
                  </Space>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={INV_CELL_LABEL}>公司名称：</td>
                      <td style={INV_CELL_VALUE}>{applyCompany || '—'}</td>
                    </tr>
                    <tr>
                      <td style={INV_CELL_LABEL}>纳税人识别码：</td>
                      <td style={INV_CELL_VALUE}>{applyTaxpayerCode || '—'}</td>
                    </tr>
                    <tr>
                      <td style={INV_CELL_LABEL}>发票类型：</td>
                      <td style={INV_CELL_VALUE}>{applyCompanyType}（税率 {applyTaxRate}%）</td>
                    </tr>
                  </tbody>
                </table>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...INV_TH, width: '34%' }}>规格名称</th>
                      <th style={{ ...INV_TH, width: '22%' }}>数量</th>
                      <th style={{ ...INV_TH, width: '22%' }}>单价</th>
                      <th style={{ ...INV_TH, width: '22%' }}>总价</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={INV_TD}>{applyProjectName || '—'}</td>
                      <td style={INV_TD}>
                        <InputNumber size="small" value={d.quantity} min={1} precision={0} style={{ width: 110 }}
                          onChange={v => updateDraft(i, { quantity: v || 1 })} />
                      </td>
                      <td style={INV_TD}>
                        <InputNumber size="small" value={d.unitPrice} min={0.01} precision={2} style={{ width: 110 }}
                          onChange={v => updateDraft(i, { unitPrice: v || 0 })} />
                      </td>
                      <td style={INV_TD}><Text strong>{lineTotal.toFixed(2)}</Text></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Text>合计金额：</Text>
          <Text strong style={{ color: '#f5222d', fontSize: 16, marginLeft: 8 }}>
            ¥{round2(previewDrafts.reduce((s, d) => s + (d.amount || 0), 0)).toFixed(2)}
          </Text>
          <Text type="secondary" style={{ marginLeft: 12 }}>/ 按比例生成 ¥{round2(applyAvailable * applyRatio / 100).toFixed(2)}（差额扣除 ¥{applyAvailable.toFixed(2)}）</Text>
        </div>
      </Modal>
    </div>
  );
};

export default BusinessLicensePage;
