import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import FieldConfigModal from '../components/FieldConfigModal';
import { API_BASE } from '../utils/apiBase';
import {
  Card, Table, Button, Space, Tag, message,
  Typography, Tooltip, Descriptions, Row, Col, Input, Select, Modal, Form, Image, Checkbox, InputNumber, Alert,
} from 'antd';
import {
  TeamOutlined,
  SearchOutlined,
  ReloadOutlined,
  EyeOutlined,
  PlusOutlined,
  EditOutlined,
  StopOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LinkOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  WalletOutlined,
  PictureOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import AsOfDebtModal from '../components/AsOfDebtModal';
import { CertBadge, fetchCertBatch } from '../components/EnterpriseCertModal';
import type { CertInfo } from '../components/EnterpriseCertModal';
import {
  ensureSupplierSummaryBuilt, loadSupplierSummary, verifySupplierSummary, repairSupplierSummary,
  recordSupplierPayment, loadSupplierPayments, startIdlePatrol, toYuan,
} from '../utils/paySummary';
import type { SupplierSummaryEntry } from '../utils/paySummary';
import { writeProductList, loadProductListLatest } from '../utils/dataStore';
import { reloadAfterPull } from '../utils/serverSync';
import {
  takePendingInvite, acceptCooperationInvite, rejectCooperationInvite, resolveUserByCompanyNo,
} from '../utils/cooperationInvite';
import type { CooperationInvitePayload } from '../utils/cooperationInvite';
import { dedupePurchaserSuppliers } from '../utils/cooperationDedupe';
import { loadSupplierFinishedProducts } from '../utils/supplierProducts';
import { findInviteRecord, markInviteUsed } from '../utils/inviteRegistry';
import { isAccountingMode, writeAutoEntries, loadSubjectOptions, subjectFilterOption } from '../utils/accountingBridge';
import { getCurrentUserDisplayName } from '../utils/billLog';
import { compressImageFile } from '../utils/imageCompress';
import { copyText } from '../utils/clipboard';

const { Text, Title } = Typography;
const { Option } = Select;

const PRIMARY = '#1e4a7e';
const STORAGE_KEY_PREFIX = 'purchaser_suppliers_';
const COOPERATION_APPLICATIONS_KEY = 'cooperation_applications';
const TOKEN_STORAGE_KEY = 'cooperation_tokens';

interface SupplierEntry {
  id: string;
  supplierName: string;
  shortName: string;
  contactPerson: string;
  contactPhone: string;
  email: string;
  legalPerson?: string;
  wechatQr?: string;
  businessAddress?: string;
  cooperationStatus: 'pending' | 'approved' | 'rejected' | 'terminating' | 'terminated';
  addedDate: string;
  cooperationDate?: string;
  cooperationToken?: string;
  remark: string;
  terminateApplyDate?: string;
  province?: string;
  city?: string;
  district?: string;
  address?: string;
  supplierNo?: string;
  orderPrefix?: string;
  accountName?: string;   // 收款账户名称
  bankName?: string;      // 开户银行
  branchName?: string;    // 支行名称
  bankAccountNo?: string; // 银行账户
  supplierUsername?: string; // 供应商账号（合作建立时落库）；公司名可能重名，跨账号匹配优先用账号
  supplierInitiated?: boolean; // 供应商主动发起合作标记（随同步键跨浏览器送达，待审核态依据）
  supplierInitiatedDate?: string;
}

const PurchaserSupplierList: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  // 数据归属账号：子账号使用主账号的 username，确保数据共享（与产品页面一致）
  const getDataOwner = () => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) {
      return localStorage.getItem('parentAccount') || username;
    }
    return username;
  };
  const storageKey = STORAGE_KEY_PREFIX + getDataOwner();

  const [dataSource, setDataSource] = useState<SupplierEntry[]>([]);
  const [searchText, setSearchText] = useState('');
  // 分字段搜索（拆分原单一关键字框）：联系人/联系电话/银行账户/法人代表/省/市/区/供应商编号
  const [searchContact, setSearchContact] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchBank, setSearchBank] = useState('');
  const [searchLegal, setSearchLegal] = useState('');
  const [searchProvince, setSearchProvince] = useState('');
  const [searchCity, setSearchCity] = useState('');
  const [searchDistrict, setSearchDistrict] = useState('');
  const [searchSupplierNo, setSearchSupplierNo] = useState('');
  // 双态搜索：列表过滤只读「已应用态」，回车或「查询」按钮把草稿态同步为应用态，避免逐键实时过滤
  const emptyAppliedSearch = { name: '', contact: '', phone: '', bank: '', legal: '', province: '', city: '', district: '', no: '' };
  const [appliedSearch, setAppliedSearch] = useState(emptyAppliedSearch);
  const applySearch = useCallback(() => {
    setAppliedSearch({
      name: searchText.trim(), contact: searchContact.trim(), phone: searchPhone.trim(),
      bank: searchBank.trim(), legal: searchLegal.trim(), province: searchProvince.trim(),
      city: searchCity.trim(), district: searchDistrict.trim(), no: searchSupplierNo.trim(),
    });
  }, [searchText, searchContact, searchPhone, searchBank, searchLegal, searchProvince, searchCity, searchDistrict, searchSupplierNo]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailSupplier, setDetailSupplier] = useState<SupplierEntry | null>(null);

  // 截止应付欠款查询：采购账单/付款台账按需加载（弹窗打开时才读）
  const [asOfOpen, setAsOfOpen] = useState(false);
  const asOfData = useMemo(() => {
    if (!asOfOpen) return { bills: [] as any[], pays: [] as any[] };
    const own = getDataOwner();
    let bills: any[] = []; let pays: any[] = [];
    try { const b = JSON.parse(localStorage.getItem(`purchaser_bills_${own}`) || '[]'); bills = Array.isArray(b) ? b : []; } catch { /* ignore */ }
    try { const p = JSON.parse(localStorage.getItem(`supplier_payments_${own}`) || '[]'); pays = Array.isArray(p) ? p : []; } catch { /* ignore */ }
    return { bills, pays };
  }, [asOfOpen]);

  // 新增供应商弹窗
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addForm] = Form.useForm();

  // 链接弹窗
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');

  // 供应商邀约合作受理弹窗（邀约落地页写入待受理邀约后本页弹出）
  const [invitePayload, setInvitePayload] = useState<CooperationInvitePayload | null>(null);

  // 编辑供应商弹窗
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  const [editingSupplier, setEditingSupplier] = useState<SupplierEntry | null>(null);

  // 终止合作确认弹窗
  const [terminateModalVisible, setTerminateModalVisible] = useState(false);
  const [terminateForm] = Form.useForm();
  const [terminatingSupplier, setTerminatingSupplier] = useState<SupplierEntry | null>(null);

  // 货品列表弹窗
  const [productListVisible, setProductListVisible] = useState(false);
  const [productListSupplier, setProductListSupplier] = useState<string>('');
  const [productListData, setProductListData] = useState<Record<string, any>[]>([]);

  // 货品列表弹窗 - 搜索状态（输入不触发，点击查询/回车才生效）
  const [plInputCode, setPlInputCode] = useState('');
  // 货品列表弹窗 - 勾选键（复制供应商货品用）
  const [plSelected, setPlSelected] = useState<React.Key[]>([]);
  // 采购金额/已付货款/应付欠款：增量聚合快照（列表 O(1) 读取，不做全量重算）
  const [paySummary, setPaySummary] = useState<Record<string, SupplierSummaryEntry>>({});
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  // 付货款弹窗（付款金额 + 付款银行账户 + 付款截图）
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [payTarget, setPayTarget] = useState<SupplierEntry | null>(null);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payBank, setPayBank] = useState<string>('');
  const [payShot, setPayShot] = useState<string>('');
  const [payDebit, setPayDebit] = useState<string>('应付账款');
  const [payCredit, setPayCredit] = useState<string>('银行存款');
  const payShotInputRef = useRef<HTMLInputElement | null>(null);
  // 申请付款弹窗（供应商货款 → 财务管理-付款申请）
  const [applyPayVisible, setApplyPayVisible] = useState(false);
  const [applyPayTarget, setApplyPayTarget] = useState<SupplierEntry | null>(null);
  const [applyPayAmount, setApplyPayAmount] = useState<number | null>(null);
  const [applyDebit, setApplyDebit] = useState<string>('应付账款');
  const [applyCredit, setApplyCredit] = useState<string>('银行存款');
  // 已付货款明细弹窗（付款台账）
  const [payDetailVisible, setPayDetailVisible] = useState(false);
  const [payDetailSupplier, setPayDetailSupplier] = useState<string>('');
  // 订单占用明细弹窗
  const [occVisible, setOccVisible] = useState(false);
  const [occSupplier, setOccSupplier] = useState<string>('');
  const supplierNamesRef = useRef<string[]>([]);
  const [plInputStyleCode, setPlInputStyleCode] = useState('');
  const [plInputBrand, setPlInputBrand] = useState('');
  const [plInputPriceMin, setPlInputPriceMin] = useState('');
  const [plInputPriceMax, setPlInputPriceMax] = useState('');
  const [plInputStatus, setPlInputStatus] = useState<string>('');
  // applied 状态（实际过滤用）
  const [plAppliedCode, setPlAppliedCode] = useState('');
  const [plAppliedStyleCode, setPlAppliedStyleCode] = useState('');
  const [plAppliedBrand, setPlAppliedBrand] = useState('');
  const [plAppliedPriceMin, setPlAppliedPriceMin] = useState('');
  const [plAppliedPriceMax, setPlAppliedPriceMax] = useState('');
  const [plAppliedStatus, setPlAppliedStatus] = useState<string>('');
  // 分页
  const [plPage, setPlPage] = useState(1);
  const [plPageSize, setPlPageSize] = useState(20);

  // 货品列表弹窗 - 查询
  const handlePlSearch = useCallback(() => {
    reloadAfterPull(() => reloadData()); // 查询时先本地重载再拉服务端，跨端新增数据立即可见
    setPlAppliedCode(plInputCode);
    setPlAppliedStyleCode(plInputStyleCode);
    setPlAppliedBrand(plInputBrand);
    setPlAppliedPriceMin(plInputPriceMin);
    setPlAppliedPriceMax(plInputPriceMax);
    setPlAppliedStatus(plInputStatus);
    setPlPage(1);
  }, [plInputCode, plInputStyleCode, plInputBrand, plInputPriceMin, plInputPriceMax, plInputStatus]);

  // 货品列表弹窗 - 重置
  const handlePlReset = useCallback(() => {
    setPlInputCode(''); setPlInputStyleCode(''); setPlInputBrand('');
    setPlInputPriceMin(''); setPlInputPriceMax(''); setPlInputStatus('');
    setPlAppliedCode(''); setPlAppliedStyleCode(''); setPlAppliedBrand('');
    setPlAppliedPriceMin(''); setPlAppliedPriceMax(''); setPlAppliedStatus('');
    setPlPage(1);
  }, []);

  // 货品列表弹窗 - 过滤后的数据
  const plFilteredData = useMemo(() => {
    let result = productListData;
    if (plAppliedCode) {
      const kw = plAppliedCode.toLowerCase();
      result = result.filter((r) => String(r.productCode || '').toLowerCase().includes(kw));
    }
    if (plAppliedStyleCode) {
      const kw = plAppliedStyleCode.toLowerCase();
      result = result.filter((r) => String(r.styleCode || '').toLowerCase().includes(kw));
    }
    if (plAppliedBrand) {
      const kw = plAppliedBrand.toLowerCase();
      result = result.filter((r) => String(r.brand || '').toLowerCase().includes(kw));
    }
    if (plAppliedPriceMin) {
      const min = Number(plAppliedPriceMin);
      if (!isNaN(min)) result = result.filter((r) => Number(r.suggestedPrice) >= min);
    }
    if (plAppliedPriceMax) {
      const max = Number(plAppliedPriceMax);
      if (!isNaN(max)) result = result.filter((r) => Number(r.suggestedPrice) <= max);
    }
    if (plAppliedStatus) {
      result = result.filter((r) => r.productStatus === plAppliedStatus);
    }
    return result;
  }, [productListData, plAppliedCode, plAppliedStyleCode, plAppliedBrand, plAppliedPriceMin, plAppliedPriceMax, plAppliedStatus]);

  // 显示字段控制
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);
  const ALL_FIELDS = [
    { key: 'supplierName', label: '供应商名称' },
    { key: 'certStatus', label: '认证状态' },
    { key: 'supplierNo', label: '供应商编号' },
    { key: 'orderPrefix', label: '单号前缀' },
    { key: 'shortName', label: '简称' },
    { key: 'contactPerson', label: '联系人' },
    { key: 'contactPhone', label: '联系电话' },
    { key: 'email', label: '电子邮箱' },
    { key: 'accountName', label: '账户名称' },
    { key: 'bankName', label: '开户银行' },
    { key: 'branchName', label: '支行名称' },
    { key: 'bankAccountNo', label: '银行账户' },
    { key: 'legalPerson', label: '法人代表' },
    { key: 'wechatQr', label: '微信加好友二维码' },
    { key: 'province', label: '省' },
    { key: 'city', label: '市' },
    { key: 'district', label: '区' },
    { key: 'address', label: '详细地址' },
    { key: 'cooperationStatus', label: '合作状态' },
    { key: 'cooperationDate', label: '合作日期' },
    { key: 'creditLimit', label: '信用额度(元)' },
    { key: 'purchaseAmount', label: '采购金额(元)' },
    { key: 'paidAmount', label: '已付货款(元)' },
    { key: 'dueAmount', label: '应付欠款(元)' },
    { key: 'remainingCredit', label: '剩余额度(元)' },
    { key: 'orderOccupation', label: '订单占用' },
    { key: 'productList', label: '货品列表' },
    { key: 'remark', label: '备注' },
  ];
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    let base: string[] | null = null;
    try {
      const saved = localStorage.getItem(`supplierFieldOrder_${getDataOwner()}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) base = arr;
      }
    } catch { /* ignore */ }
    const order = base || ALL_FIELDS.map(f => f.key);
    // 旧保存配置缺少新增金额字段：追加到末尾并默认显示
    ALL_FIELDS.forEach(f => { if (!order.includes(f.key)) order.push(f.key); });
    return order;
  });
  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    const def: Record<string, boolean> = {};
    ALL_FIELDS.forEach(f => { def[f.key] = true; });
    try {
      const saved = localStorage.getItem(`supplierFieldVisibility_${getDataOwner()}`);
      if (saved) return { ...def, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return def;
  });
  const saveFieldConfig = (order: string[] = fieldOrder, vis: Record<string, boolean> = fieldVisibility) => {
    localStorage.setItem(`supplierFieldOrder_${getDataOwner()}`, JSON.stringify(order));
    localStorage.setItem(`supplierFieldVisibility_${getDataOwner()}`, JSON.stringify(vis));
  };

  // 从 registeredUsers 获取供应商注册信息（联系人/电话/邮箱/法人/地址等）
  const resolveSupplierProfile = (companyName: string): Partial<SupplierEntry> => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === companyName);
      if (!u) return {};
      const result: Partial<SupplierEntry> = {};
      if (u.contactPerson) result.contactPerson = u.contactPerson;
      if (u.phone) result.contactPhone = u.phone;
      if (u.email) result.email = u.email;
      if (u.legalPerson) result.legalPerson = u.legalPerson;
      if (u.province) result.province = u.province;
      if (u.city) result.city = u.city;
      if (u.district) result.district = u.district;
      // 详细地址：优先用 addressDetail，其次用 businessAddress
      const addr = u.addressDetail || u.businessAddress || '';
      if (addr) result.address = addr;
      if (u.accountName) result.accountName = u.accountName;
      if (u.bankName) result.bankName = u.bankName;
      if (u.branchName) result.branchName = u.branchName;
      if (u.bankAccountNo) result.bankAccountNo = u.bankAccountNo;
      return result;
    } catch { /* ignore */ }
    return {};
  };

  // 解除后若已重新建立合作（存在比终止申请更新的合作申请），历史终止申请不得再把状态回滚为 terminated
  const hasNewerCooperationApp = (apps: any[], s: SupplierEntry, termApp: any): boolean => {
    const tTs = Date.parse(String(termApp.approveDate || termApp.applyDate || '').replace(/-/g, '/')) || 0;
    return apps.some((c: any) =>
      (c.type || 'cooperation') === 'cooperation' && !c.superseded &&
      (c.status === 'approved' || c.status === 'pending') &&
      c.purchaserUsername === username &&
      (c.purchaserSupplierEntryId === s.id || c.targetSupplierName === s.supplierName || c.targetSupplierId === s.id) &&
      ((Date.parse(String(c.approveDate || c.applyDate || '').replace(/-/g, '/')) || 0) > tTs));
  };

  // 加载并同步数据
  const reloadData = useCallback(() => {
    try {
      // 同源去重兜底：历史多写点+同步并集合并可能留下同供应商多 id 条目，加载时先合并
      dedupePurchaserSuppliers(username);
      const data: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
      let hasChange = false;
      const updated = data.map((s) => {
        // 1. 同步合作审批状态（排除已作废的申请）
        if (s.cooperationStatus === 'pending') {
          const approvedApp = apps.find(
            (app) => {
              if (app.purchaserUsername !== username || app.type !== 'cooperation' || app.status !== 'approved' || app.superseded) return false;
              if (app.purchaserSupplierEntryId && app.purchaserSupplierEntryId === s.id) return true;
              return app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id;
            }
          );
          if (approvedApp) {
            hasChange = true;
            const profile = resolveSupplierProfile(approvedApp.targetSupplierName || s.supplierName);
            return {
              ...s,
              ...profile,
              cooperationStatus: 'approved' as const,
              cooperationDate: approvedApp.applyDate?.split(' ')[0] || dayjs().format('YYYY-MM-DD'),
              supplierName: approvedApp.targetSupplierName || s.supplierName,
              statusTs: Date.now(),
              terminateAt: undefined,
              terminateBy: undefined,
            };
          }
        }
        // 1.5 自愈：已解除合作但存在比终止申请更新的已批准合作申请（如邀约链接受理后被历史终止申请回滚的残留）→ 恢复已合作
        if (s.cooperationStatus === 'terminated') {
          const termApp2 = apps.find((app: any) =>
            app.purchaserUsername === username &&
            (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id) &&
            app.type === 'terminate' && app.status === 'approved' && !app.superseded);
          const coopApp2 = apps.find((app: any) =>
            app.purchaserUsername === username &&
            (app.purchaserSupplierEntryId === s.id || app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id) &&
            (app.type || 'cooperation') === 'cooperation' && app.status === 'approved' && !app.superseded);
          const tTs2 = termApp2 ? (Date.parse(String(termApp2.approveDate || termApp2.applyDate || '').replace(/-/g, '/')) || 0) : 0;
          const cTs2 = coopApp2 ? (Date.parse(String(coopApp2.approveDate || coopApp2.applyDate || '').replace(/-/g, '/')) || 0) : 0;
          if (coopApp2 && cTs2 > tTs2) {
            hasChange = true;
            return { ...s, cooperationStatus: 'approved' as const, cooperationDate: (coopApp2.approveDate || coopApp2.applyDate || '').split(' ')[0] || s.cooperationDate, statusTs: Date.now(), terminateAt: undefined, terminateBy: undefined };
          }
        }
        // 2. 同步终止合作确认状态（采购商发起 → 供应商已同意，排除已作废的申请）
        if (s.cooperationStatus === 'terminating') {
          const terminateApp = apps.find(
            (app) =>
              app.purchaserUsername === username &&
              (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id) &&
              app.type === 'terminate' &&
              app.status === 'approved' &&
              !app.superseded
          );
          if (terminateApp && !hasNewerCooperationApp(apps, s, terminateApp)) {
            hasChange = true;
            return { ...s, cooperationStatus: 'terminated' as const, terminateApplyDate: undefined };
          }
        }
        // 2.5 同步供应商发起的终止合作申请：已合作 → 终止待确认（与合作申请页口径一致，双向显示解除申请中）
        if (s.cooperationStatus === 'approved') {
          const supPendingTerm = apps.find((app: any) =>
            app.purchaserUsername === username &&
            (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id) &&
            app.type === 'terminate' && app.supplierInitiated === true && app.status === 'pending' && !app.superseded);
          if (supPendingTerm) {
            hasChange = true;
            return { ...s, cooperationStatus: 'terminating' as const, terminateApplyDate: supPendingTerm.applyDate };
          }
        }
        // 3. 检测供应商发起的解除合作申请（排除已作废的申请）
        if (s.cooperationStatus === 'approved') {
          // 建立合作后自动获取供应商单号前缀
          if (!s.orderPrefix) {
            const p = resolveSupplierPrefix(s.supplierName);
            if (p) { hasChange = true; return { ...s, orderPrefix: p }; }
          }
          // 建立合作后自动同步供应商最新注册信息（联系人/电话/地址等）
          const profile = resolveSupplierProfile(s.supplierName);
          const needSync = Object.keys(profile).some(k => {
            const key = k as keyof SupplierEntry;
            return profile[key] && !s[key];
          });
          if (needSync) {
            hasChange = true;
            // 只填充空白字段，不覆盖采购商手动编辑的内容
            const merged: Partial<SupplierEntry> = {};
            Object.keys(profile).forEach(k => {
              const key = k as keyof SupplierEntry;
              if (profile[key] && !s[key]) (merged as any)[key] = profile[key];
            });
            return { ...s, ...merged };
          }
          const supplierTerminateApp = apps.find(
            (app) =>
              app.purchaserUsername === username &&
              (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id) &&
              app.type === 'terminate' &&
              app.supplierInitiated === true &&
              app.status === 'approved' &&
              !app.superseded
          );
          if (supplierTerminateApp && !hasNewerCooperationApp(apps, s, supplierTerminateApp)) {
            hasChange = true;
            return { ...s, cooperationStatus: 'terminated' as const };
          }
        }
        return s;
      });
      setDataSource(updated);
      if (hasChange) {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      }
    } catch { /* ignore */ }
  }, [storageKey, username]);

  // 首次加载 & 跨标签页/切换回页面自动同步
  useEffect(() => {
    reloadData();
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === COOPERATION_APPLICATIONS_KEY || e.key === 'cooperation_tokens' || e.key === 'registeredUsers') {
        reloadData();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') reloadData();
    };
    const handleCoopChange = () => reloadData();
    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('cooperation-applications-changed', handleCoopChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('cooperation-applications-changed', handleCoopChange);
    };
  }, [reloadData]);

  // 挂载时受理待处理的合作邀约：弹窗显示邀约公司信息（同意/拒绝）
  useEffect(() => {
    const p = takePendingInvite();
    if (!p) return;
    try {
      const list: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const sup = resolveUserByCompanyNo(p.no);
      const done = !!sup && list.some((s: any) => (s.supplierName === sup.companyName || String(s.supplierNo || '') === String(p.no)) && s.cooperationStatus === 'approved');
      if (done) { message.info('与该供应商已建立合作，无需重复处理邀约'); return; }
    } catch { /* ignore */ }
    setInvitePayload(p);
  }, []);

  // ========== 同意供应商邀约：立即建立合作 ==========
  const handleAcceptInvite = () => {
    if (!invitePayload) return;
    const code = (invitePayload as any).code as string | undefined;
    if (code) {
      const rec = findInviteRecord(code);
      if (rec?.usedAt) { message.error('该邀约链接已失效（一次性链接已被使用），请联系供应商重新生成'); setInvitePayload(null); return; }
    }
    const res = acceptCooperationInvite(invitePayload, getDataOwner());
    if (!res.ok) { message.error(res.msg); return; }
    // 一次性邀约码：同意即消耗、链接立即失效；并把客户行标识回写供应商侧绑定采购商卡片（供其客户列表升级对应客户行）
    if (code) {
      let myCompany = getDataOwner();
      try { const us = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); myCompany = us.find((u: any) => u.username === getDataOwner())?.companyName || myCompany; } catch { /* ignore */ }
      markInviteUsed(code, getDataOwner(), myCompany, 'approved');
      try {
        const sup = resolveUserByCompanyNo(invitePayload.no);
        const cid = (invitePayload as any).customerId;
        const cname = (invitePayload as any).customerName;
        if (sup && cid) {
          const bKey = 'boundPurchasers_' + sup.username;
          const bound: any[] = JSON.parse(localStorage.getItem(bKey) || '[]');
          const next = bound.map((bp: any) => (bp.purchaserUsername === getDataOwner() ? { ...bp, customerId: cid, customerName: cname || '' } : bp));
          localStorage.setItem(bKey, JSON.stringify(next));
        }
      } catch { /* ignore */ }
    }
    setInvitePayload(null);
    reloadData();
    message.success(res.msg);
  };

  // ========== 拒绝供应商邀约 ==========
  const handleRejectInvite = () => {
    if (!invitePayload) return;
    const code = (invitePayload as any).code as string | undefined;
    if (code) {
      const rec = findInviteRecord(code);
      if (rec?.usedAt) { message.error('该邀约链接已失效（一次性链接已被使用）'); setInvitePayload(null); return; }
    }
    const res = rejectCooperationInvite(invitePayload, getDataOwner());
    // 一次性邀约码：拒绝同样消耗链接
    if (code) {
      let myCompany = getDataOwner();
      try { const us = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); myCompany = us.find((u: any) => u.username === getDataOwner())?.companyName || myCompany; } catch { /* ignore */ }
      markInviteUsed(code, getDataOwner(), myCompany, 'rejected');
    }
    setInvitePayload(null);
    message.warning(res.msg);
  };

  // 邀约公司信息（按公司编号解析注册账号）
  const inviteSupplier = useMemo(() => (invitePayload ? resolveUserByCompanyNo(invitePayload.no) : null), [invitePayload]);

  // ========== 采购金额/已付货款/应付欠款：快照加载 + 事件自愈 + 空闲分片巡检 ==========
  const reloadPaySummary = useCallback(() => {
    ensureSupplierSummaryBuilt(getDataOwner());
    setPaySummary(loadSupplierSummary(getDataOwner()));
  }, []);
  const reloadBankAccounts = useCallback(() => {
    try { setBankAccounts(JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${getDataOwner()}`) || '[]')); } catch { setBankAccounts([]); }
  }, []);
  useEffect(() => {
    supplierNamesRef.current = dataSource.map(s => s.supplierName);
  }, [dataSource]);
  // 挂载即全量自愈：按本地账单/付款台账一次性校正全部供应商快照，
  // 立即修复历史跨端同步遗留的 0 污染快照（快照键已退出同步，各端由源数据本地重算）
  useEffect(() => {
    const names = dataSource.map(s => s.supplierName).filter(Boolean);
    if (!names.length) return;
    try {
      const fixed = verifySupplierSummary(getDataOwner(), names);
      if (fixed.length) reloadPaySummary();
    } catch { /* ignore */ }
  }, [dataSource, reloadPaySummary]);

  // 供应商认证状态批量查询（按 supplierUsername 查）
  const [supCertMap, setSupCertMap] = useState<Record<string, CertInfo>>({});
  useEffect(() => {
    let alive = true;
    const usernames = dataSource
      .map(s => String(s.supplierUsername || '').trim())
      .filter(Boolean);
    if (!usernames.length) { setSupCertMap({}); return; }
    fetchCertBatch(usernames).then(m => { if (alive) setSupCertMap(m); });
    return () => { alive = false; };
  }, [dataSource]);
  useEffect(() => {
    reloadPaySummary();
    reloadBankAccounts();
    const handlePayStorage = (e: StorageEvent) => {
      const k = e.key || '';
      if (k.includes('supplier_pay_summary_') || k.includes('supplier_payments_') || k.includes('purchaser_bills_')) reloadPaySummary();
      if (k.includes('pageData_finance_bank-account_')) reloadBankAccounts();
    };
    const handlePayVisibility = () => { if (document.visibilityState === 'visible') reloadPaySummary(); };
    window.addEventListener('storage', handlePayStorage);
    document.addEventListener('visibilitychange', handlePayVisibility);
    // 空闲分片巡检：每次浏览器空闲校验一个供应商的快照与台账，不一致自动修复（防余额漂移）
    const stopPatrol = startIdlePatrol({
      getNames: () => supplierNamesRef.current,
      verify: (name) => {
        const fixed = verifySupplierSummary(getDataOwner(), [name]);
        if (fixed.length) reloadPaySummary();
      },
    });
    return () => {
      window.removeEventListener('storage', handlePayStorage);
      document.removeEventListener('visibilitychange', handlePayVisibility);
      stopPatrol();
    };
  }, [reloadPaySummary, reloadBankAccounts]);

  // 付货款截图：点击选文件 / 弹窗内粘贴
  const handlePayShotFile = (file: File) => {
    if (!file.type.startsWith('image/')) { message.error('请选择图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return; }
    compressImageFile(file).then(dataUrl => setPayShot(dataUrl)).catch(() => message.error('图片处理失败'));
  };
  useEffect(() => {
    if (!payModalVisible) return;
    const onPaste = (e: Event) => {
      const cd = (e as any).clipboardData as DataTransfer | undefined;
      const arr = Array.from(cd?.items || []);
      for (const it of arr) if (it.type.startsWith('image/')) { const b = it.getAsFile(); if (b) { handlePayShotFile(b); break; } }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [payModalVisible]);

  // 付货款保存：原子写入（台账追加 + 快照增量 + 银行账户出账明细，异常整体回滚）
  const handlePaySubmit = () => {
    if (!payTarget) return;
    if (payAmount === null || !(payAmount > 0)) { message.warning('请输入大于 0 的付款金额'); return; }
    if (!payBank) { message.warning('请选择付款银行账户'); return; }
    let operator = username;
    try {
      const u = (JSON.parse(localStorage.getItem('registeredUsers') || '[]') as any[]).find(x => x.username === username);
      if (u?.displayName || u?.contactPerson || u?.name) operator = u.displayName || u.contactPerson || u.name;
    } catch { /* ignore */ }
    const res = recordSupplierPayment({
      owner: getDataOwner(), supplierName: payTarget.supplierName, amountYuan: payAmount,
      bankAccount: payBank, screenshot: payShot, operator,
    });
    if (!res.ok) { message.error(res.msg || '付款写入失败'); return; }
    // 会计账薄版本：自动生成借贷两条会计分录（摘要含供应商名称）
    if (isAccountingMode(getDataOwner())) {
      writeAutoEntries(getDataOwner(), {
        sourceKey: `sup-goods-pay-${payTarget.supplierName}-${Date.now()}`,
        debitSubject: payDebit || '应付账款',
        creditSubject: payCredit || '银行存款',
        amount: payAmount,
        summary: `支付${payTarget.supplierName}货款（应付账款）`,
        date: dayjs().format('YYYY-MM-DD'),
      });
    }
    setPayModalVisible(false);
    reloadPaySummary();
    message.success(`已向供应商「${payTarget.supplierName}」付款 ¥${Number(payAmount).toFixed(2)}，已写入银行账户明细与已付货款明细`);
  };

  // ========== 申请付款（供应商货款 → 财务管理-付款申请） ==========
  const handleApplyPaySubmit = () => {
    if (!applyPayTarget) return;
    if (applyPayAmount === null || !(applyPayAmount > 0)) { message.warning('请输入大于 0 的请求付款金额'); return; }
    if (!applyPayTarget.accountName || !applyPayTarget.bankAccountNo) { message.warning('供应商银行账户信息不完整，请先在编辑中补充'); return; }
    const owner = getDataOwner();
    const storeKey = `payment_requests_${owner}`;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { list = []; }
    const prefix = `FK${dayjs().format('YYYYMMDD')}`;
    const seqs = list.filter((r: any) => (r.requestNo || '').startsWith(prefix)).map((r: any) => parseInt(String(r.requestNo).slice(-3), 10) || 0);
    let applicantName = username;
    try {
      const u = (JSON.parse(localStorage.getItem('registeredUsers') || '[]') as any[]).find(x => x.username === username);
      if (u?.displayName || u?.contactPerson || u?.name) applicantName = u.displayName || u.contactPerson || u.name;
    } catch { /* ignore */ }
    const rec = {
      key: `payreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo: `${prefix}${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`,
      amount: Number(applyPayAmount),
      category: '应付账款-采购支出',
      description: `供应商货款-${applyPayTarget.supplierName}`,
      recvType: 'bank',
      recvAccountName: applyPayTarget.accountName,
      recvBankName: applyPayTarget.bankName || '',
      recvBranchName: applyPayTarget.branchName || '',
      recvBankAccount: applyPayTarget.bankAccountNo || '',
      source: 'supplier',
      supplierName: applyPayTarget.supplierName,
      debitSubject: applyDebit || '应付账款',
      creditSubject: applyCredit || '银行存款',
      status: 'pending_review',
      applicant: username,
      applicantName,
      applyDate: dayjs().format('YYYY-MM-DD'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(storeKey, JSON.stringify([rec, ...list]));
    setApplyPayVisible(false); setApplyPayTarget(null); setApplyPayAmount(null);
    message.success('付款申请已提交至「财务管理-收/付申请」，等待财务审核');
  };

  // 复制供应商货品：勾选的供应商成品写入本租户产品列表；供应商基础售价 → 本租户成本价；商品编码重复则跳过
  const handleCopySupplierProducts = async () => {
    const selSet = new Set(plSelected.map(String));
    const selected = productListData.filter(p => selSet.has(String(p.key || p.productCode)));
    if (!selected.length) { message.warning('请先勾选要复制的供应商货品'); return; }
    const owner = getDataOwner();
    const mine = await loadProductListLatest(owner);
    const existCodes = new Set(mine.map(p => String(p.productCode || '').trim()).filter(Boolean));
    let added = 0; let skipped = 0;
    const now = new Date().toISOString();
    const creator = getCurrentUserDisplayName();
    const additions: Record<string, any>[] = [];
    selected.forEach(p => {
      const code = String(p.productCode || '').trim();
      if (!code || existCodes.has(code)) { skipped += 1; return; }
      existCodes.add(code);
      additions.push({
        key: `pd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${added}`,
        productCode: code,
        styleCode: p.styleCode || '',
        shortName: p.shortName || '',
        productType: '成品',
        color: p.color || '',
        spec: p.spec || '',
        brand: p.brand || '',
        // 供应商基础售价写入本租户成本价
        costPrice: Number(p.suggestedPrice) || 0,
        suggestedPrice: 0,
        productStatus: p.productStatus || '在售',
        image: p.image || '',
        supplierName: productListSupplier,
        creator,
        createdAt: now,
      });
      added += 1;
    });
    if (!additions.length) { message.warning(`勾选的 ${skipped} 条货品在本商品列表中已存在（商品编码重复），未复制`); return; }
    writeProductList(owner, [...additions, ...mine]);
    setPlSelected([]);
    message.success(`已复制 ${added} 条供应商货品到本商品列表（基础售价已写入成本价）${skipped ? `，跳过重复编码 ${skipped} 条` : ''}`);
  };

  // 显示所有供应商（含待合作）
  const supplierList = useMemo(() => {
    return dataSource.filter(
      (s) => ['approved', 'pending', 'terminating', 'terminated'].includes(s.cooperationStatus)
    );
  }, [dataSource]);

  // 我司公司名（用于 boundPurchasers 账号级匹配）
  const myCompanyName = useMemo(() => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === username);
      return String(u?.companyName || username || '');
    } catch { return username; }
  }, [username]);

  // 解析供应商账号 owner：优先条目自带账号 → 其次在同名候选账号中按业务关系消歧 → 回退公司名首个匹配
  // 消歧信号（公司名可能重名，必须用账号/业务数据定位）：
  //   ① credit_adjustments_<账号> 含我司名的调整记录（已跨浏览器同步，最可靠）
  //   ② boundPurchasers_<账号> 绑定了我司（同浏览器）
  //   ③ customers_<账号> 含我司名档案（同浏览器）
  const resolveSupplierOwner = useCallback((supplierName: string, entry?: any): string => {
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
    if (entry?.supplierUsername && users.some((u: any) => u.username === entry.supplierUsername)) return entry.supplierUsername;
    const cands = users.filter((u: any) => (u.companyName || '') === supplierName);
    for (const c of cands) {
      try {
        const adjs: any[] = JSON.parse(localStorage.getItem('credit_adjustments_' + c.username) || '[]');
        if (Array.isArray(adjs) && myCompanyName && adjs.some((r: any) => r.customerName === myCompanyName)) return c.username;
      } catch { /* ignore */ }
      try {
        const bps: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + c.username) || '[]');
        if (Array.isArray(bps) && bps.some((b: any) => b.purchaserUsername === username || (myCompanyName && b.purchaserName === myCompanyName))) return c.username;
      } catch { /* ignore */ }
      try {
        const custs: any[] = JSON.parse(localStorage.getItem('customers_' + c.username) || '[]');
        if (Array.isArray(custs) && myCompanyName && custs.some((cc: any) => cc.name === myCompanyName)) return c.username;
      } catch { /* ignore */ }
    }
    return cands[0]?.username || '';
  }, [username, myCompanyName]);

  // 供应商发布的有效信用额度（published_credit_<供应商账号>，跨浏览器从服务端拉取）
  const [publishedCredit, setPublishedCredit] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const apiBase = API_BASE;
    const owners = dataSource.map((s) => ({ id: s.id, name: s.supplierName, entry: s }));
    Promise.all(owners.map(async ({ id, name, entry }) => {
      let users: any[] = [];
      try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
      // 候选账号：条目自带账号优先，其次同名公司名账号（公司名可能重名）
      const cands: any[] = [];
      if (entry?.supplierUsername) {
        const u = users.find((x: any) => x.username === entry.supplierUsername);
        if (u) cands.push(u);
      }
      users.filter((u: any) => (u.companyName || '') === name).forEach((u: any) => { if (!cands.some((c: any) => c.username === u.username)) cands.push(u); });
      // 逐个拉取发布额度，选「含我司记录」的那个账号（跨浏览器权威消歧）
      for (const c of cands) {
        try {
          const res = await fetch(`${apiBase}/sync/dataset?key=published_credit_${c.username}`);
          if (!res.ok) continue;
          const data = await res.json();
          const rows: any[] = JSON.parse(data?.json || '[]');
          const row = Array.isArray(rows) ? rows.find((r: any) => r.customerName === myCompanyName) : null;
          if (row) return { id, value: Number(row.effective) || 0 };
        } catch { /* ignore */ }
      }
      return { id, value: undefined as number | undefined };
    })).then((results) => {
      if (cancelled) return;
      const m: Record<string, number> = {};
      results.forEach((r) => { if (r.value !== undefined) m[r.id] = r.value; });
      setPublishedCredit(m);
    });
    return () => { cancelled = true; };
  }, [dataSource, myCompanyName]);

  // 信用额度(元)：供应商端「客户基础信息」中授予我司的有效信用额度（初始额度+调整净额，由供应商调整）
  const supplierCreditMap = useMemo(() => {
    const map: Record<string, number> = {};
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
    const me = users.find((u: any) => u.username === username);
    const myName = String(me?.companyName || username || '');
    dataSource.forEach((s) => {
      // 优先采用供应商发布的有效额度（跨浏览器权威值，与供应商端展示一致）
      if (publishedCredit[s.id] !== undefined) { map[s.id] = publishedCredit[s.id]; return; }
      const owner = resolveSupplierOwner(s.supplierName, s);
      if (!owner) { map[s.id] = 0; return; }
      let base = 0;
      try {
        const custs: any[] = JSON.parse(localStorage.getItem('customers_' + owner) || '[]');
        const bps: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + owner) || '[]');
        let adjId = '';
        let adjName = myName;
        const bp = bps.find((b: any) => b.purchaserUsername === username || (myName && b.purchaserName === myName));
        if (bp) {
          const linked = bp.customerId ? custs.find((c: any) => c.id === bp.customerId) : null;
          base = bp.credit !== undefined && bp.credit !== null ? Number(bp.credit) || 0 : Number(linked?.credit) || 0;
          adjId = bp.id || '';
          adjName = bp.purchaserName || myName;
        } else {
          const c = custs.find((c: any) => myName && c.name === myName);
          if (c) { base = Number(c.credit) || 0; adjId = c.id; adjName = c.name; }
        }
        const adjs: any[] = JSON.parse(localStorage.getItem('credit_adjustments_' + owner) || '[]');
        const net = adjs
          .filter((r: any) => (adjId && r.customerId === adjId) || (adjName && r.customerName === adjName))
          .reduce((sum: number, r: any) => sum + (r.type === 'increase' ? r.amount : -r.amount), 0);
        base = Math.round((base + net) * 100) / 100;
      } catch { /* ignore */ }
      map[s.id] = base;
    });
    return map;
  }, [dataSource, username, resolveSupplierOwner, publishedCredit]);

  // 订单占用金额：从 purchaser_pushed_orders 实时计算每个供应商的已推送订单总额
  const orderOccupationMap = useMemo(() => {
    const map: Record<string, number> = {};
    try {
      const pushed: any[] = JSON.parse(localStorage.getItem('purchaser_pushed_orders') || '[]');
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      pushed.filter(o => o.status === '已推送').forEach(o => {
        const su = users.find((u: any) => u.username === o.supplierUsername);
        const name = su?.companyName || o.supplierCompany || '';
        if (name) map[name] = (map[name] || 0) + (Number(o.totalAmount) || 0);
      });
    } catch { /* ignore */ }
    return map;
  }, []);

  // 获取指定供应商的占用订单明细
  const getOccupationOrders = useCallback((supplierName: string) => {
    try {
      const pushed: any[] = JSON.parse(localStorage.getItem('purchaser_pushed_orders') || '[]');
      const owner = resolveSupplierOwner(supplierName);
      return pushed.filter(o => o.status === '已推送' && (owner ? o.supplierUsername === owner : o.supplierCompany === supplierName));
    } catch { return []; }
  }, [resolveSupplierOwner]);

  // 统计卡：采购金额/已付金额/欠款总额 = 供应商列表对应字段数值总和（读增量快照汇总）
  const payTotals = useMemo(() => {
    let purchase = 0; let paid = 0;
    supplierList.forEach(s => {
      const e = paySummary[s.supplierName];
      purchase += e?.purchaseTotal || 0;
      paid += e?.paidTotal || 0;
    });
    return { purchase: toYuan(purchase), paid: toYuan(paid), due: toYuan(purchase - paid) };
  }, [supplierList, paySummary]);

  // 统计数据
  const stats = useMemo(() => {
    const approved = supplierList.filter((s) => s.cooperationStatus === 'approved').length;
    const pending = supplierList.filter((s) => s.cooperationStatus === 'pending').length;
    const terminating = supplierList.filter((s) => s.cooperationStatus === 'terminating').length;
    const terminated = supplierList.filter((s) => s.cooperationStatus === 'terminated').length;
    return { total: supplierList.length, approved, pending, terminating, terminated };
  }, [supplierList]);

  // 筛选数据
  const filteredData = useMemo(() => {
    let result = supplierList;
    if (statusFilter !== 'all') {
      result = result.filter((s) => s.cooperationStatus === statusFilter);
    }
    // 安全模糊匹配：画像字段可能为 undefined，统一转字符串且忽略大小写，
    // 避免直接 .includes 抛 TypeError 触发全局 ErrorBoundary（“页面资源加载失败”）
    const has = (val: any, kw: string) => !kw || String(val ?? '').toLowerCase().includes(kw.toLowerCase());
    const kwName = appliedSearch.name;
    const kwContact = appliedSearch.contact;
    const kwPhone = appliedSearch.phone;
    const kwBank = appliedSearch.bank;
    const kwLegal = appliedSearch.legal;
    const kwProv = appliedSearch.province;
    const kwCity = appliedSearch.city;
    const kwDist = appliedSearch.district;
    const kwNo = appliedSearch.no;
    if (kwName || kwContact || kwPhone || kwBank || kwLegal || kwProv || kwCity || kwDist || kwNo) {
      result = result.filter((s) =>
        (!kwName || has(s.supplierName, kwName) || has(s.shortName, kwName)) &&
        has(s.contactPerson, kwContact) &&
        has(s.contactPhone, kwPhone) &&
        (has(s.bankAccountNo, kwBank) || has(s.accountName, kwBank) || has(s.bankName, kwBank) || has(s.branchName, kwBank)) &&
        has(s.legalPerson, kwLegal) &&
        has(s.province, kwProv) &&
        has(s.city, kwCity) &&
        has(s.district, kwDist) &&
        has(s.supplierNo, kwNo)
      );
    }
    return result;
  }, [supplierList, statusFilter, appliedSearch]);

  // 查看详情
  const handleViewDetail = (record: SupplierEntry) => {
    setDetailSupplier(record);
    setDetailVisible(true);
  };

  // 生成随机 token
  const generateToken = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  // 新增供应商弹窗：省市区级联选项（预设省市区数据）
  const addProvince = Form.useWatch('province', addForm);
  const addCity = Form.useWatch('city', addForm);

  // 编辑供应商弹窗：省市区级联选项
  const editProvince = Form.useWatch('province', editForm);
  const editCity = Form.useWatch('city', editForm);

  // 供应商编号：解析对应供应商注册账号的公司编号
  const resolveSupplierNo = (name: string): string => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === name);
      if (u?.companyNo) return String(u.companyNo);
      if (u?.companyShortName) return String(u.companyShortName); // 老账号兼容：无 companyNo 时回退公司英文简称
    } catch { /* ignore */ }
    return '';
  };

  // 单号前缀：解析对应供应商注册账号的订单号前缀（建立合作后获取）
  const resolveSupplierPrefix = (name: string): string => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === name);
      if (u?.orderPrefix) return String(u.orderPrefix);
    } catch { /* ignore */ }
    return '';
  };

  // 微信加好友二维码：实时从供应商注册账号获取
  const resolveSupplierWechatQr = (name: string): string => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === name);
      if (u?.wechatQr) return String(u.wechatQr);
    } catch { /* ignore */ }
    return '';
  };

  // 解析供应商注册账号的 username（用于读取供应商自己的数据）
  const resolveSupplierUsername = (name: string): string => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === name);
      if (u?.username) return String(u.username);
    } catch { /* ignore */ }
    return '';
  };

  // 供应商货品计数跨浏览器取数：本地优先、缺失时服务端数据集兜底（避免生产环境计数恒 0）
  const [spProductCounts, setSpProductCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const entries = dataSource.filter(e => e && e.supplierName);
    if (entries.length === 0) return;
    Promise.all(entries.map(async e => {
      const owner = resolveSupplierUsername(e.supplierName);
      if (!owner) return null;
      const list = await loadSupplierFinishedProducts(owner);
      return { name: e.supplierName, count: list.length };
    })).then(res => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      res.forEach(r => { if (r) map[r.name] = r.count; });
      setSpProductCounts(prev => ({ ...prev, ...map }));
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [dataSource]);

  // 填写供应商编号 → 向对应供应商账号发起合作申请（新增/编辑窗口共用）
  const sendCooperationByNo = (entryId: string, noRaw: string): 'none' | 'notfound' | 'exists' | 'sent' => {
    const no = String(noRaw || '').trim();
    if (!no) return 'none';
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const supplierUser = users.find((u: any) => String(u.companyNo || '') === no || String(u.companyShortName || '') === no);
    if (!supplierUser) return 'notfound';
    const currentUser = users.find((u: any) => u.username === username);
    const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
    // 在途申请仅指 pending；历史 approved（含已解除合作后遗留）不算在途，下方统一作废后重新发起
    const exists = apps.some((a: any) => (a.type || 'cooperation') === 'cooperation' && !a.superseded && a.purchaserUsername === username && (a.purchaserSupplierEntryId === entryId || a.targetSupplierName === supplierUser.companyName) && a.status === 'pending');
    if (exists) return 'exists';
    // 作废旧的已批准合作申请（曾解除合作后重新申请）
    apps.forEach((a: any) => {
      if (a.purchaserUsername === username && (a.purchaserSupplierEntryId === entryId || a.targetSupplierName === supplierUser.companyName) && (a.type || 'cooperation') === 'cooperation' && a.status === 'approved') {
        a.superseded = true;
      }
    });
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    apps.push({
      applicationId: `COOP-NO-${Date.now()}`,
      purchaserUsername: username,
      purchaserCompanyName: currentUser?.companyName || username,
      purchaserCompanyId: currentUser?.companyId || '',
      purchaserContact: currentUser?.contactPerson || '',
      purchaserPhone: currentUser?.phone || '',
      targetSupplierName: supplierUser.companyName || '',
      targetSupplierId: supplierUser.companyId || supplierUser.username,
      purchaserSupplierEntryId: entryId,
      canDirectApprove: false,
      applyDate: now,
      status: 'pending',
      remark: `采购商「${currentUser?.companyName || username}」通过供应商编号 ${no} 申请合作`,
      type: 'cooperation',
      supplierInitiated: false,
    });
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));
    window.dispatchEvent(new Event('cooperation-applications-changed'));
    return 'sent';
  };

  // 新增供应商（与编辑窗口同一界面/功能：填写供应商编号可申请合作，不再生成邀约链接）
  const handleAddSupplier = () => {
    addForm.validateFields().then((values) => {
      // 供应商编号查重：编号已在供应商列表中存在则不允许保存
      const sno = String(values.supplierNo || '').trim();
      if (sno) {
        const existing: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const dup = existing.find((s) => (String(s.supplierNo || '').trim() || resolveSupplierNo(s.supplierName)) === sno);
        if (dup) {
          message.error(`供应商编号 ${sno} 已存在（供应商：${dup.supplierName}），不能重复保存`);
          return;
        }
      }
      const newSupplier: SupplierEntry = {
        id: `SP-${Date.now()}`,
        supplierName: values.supplierName,
        shortName: values.shortName || '',
        contactPerson: values.contactPerson || '',
        contactPhone: values.contactPhone || '',
        email: values.email || '',
        province: values.province || '',
        city: values.city || '',
        district: values.district || '',
        address: values.address || '',
        supplierNo: values.supplierNo || '',
        cooperationStatus: 'pending',
        addedDate: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        remark: values.remark || '',
      };

      // 保存到 purchaser_suppliers_xxx
      const allData: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = [newSupplier, ...allData];
      localStorage.setItem(storageKey, JSON.stringify(updated));
      reloadData();

      // 已解除合作的条目重新置为待合作（编号申请场景）
      const res = sendCooperationByNo(newSupplier.id, values.supplierNo);
      if (res === 'sent') {
        message.success(`供应商「${values.supplierName}」已添加，合作申请已发送，等待供应商确认`);
      } else if (res === 'notfound') {
        message.warning(`供应商「${values.supplierName}」已添加，但未找到编号对应的供应商账号，未发起合作申请`);
      } else if (res === 'exists') {
        message.success(`供应商「${values.supplierName}」已添加（该供应商的合作申请已存在，等待确认）`);
      } else {
        message.success(`供应商「${values.supplierName}」已添加`);
      }
      setAddModalVisible(false);
      addForm.resetFields();
    });
  };

  // 复制链接
  const copyLink = () => {
    copyText(generatedLink).then(
      ok => (ok ? message.success('链接已复制到剪贴板') : message.error('复制失败，请手动复制'))
    );
  };

  // ========== 编辑供应商 ==========
  const handleEdit = (record: SupplierEntry) => {
    setEditingSupplier(record);
    editForm.setFieldsValue({
      supplierName: record.supplierName,
      shortName: record.shortName,
      contactPerson: record.contactPerson,
      contactPhone: record.contactPhone,
      email: record.email,
      province: record.province || undefined,
      city: record.city || undefined,
      district: record.district || undefined,
      address: record.address || '',
      supplierNo: record.supplierNo || resolveSupplierNo(record.supplierName) || '',
      remark: record.remark,
      accountName: record.accountName || '',
      bankName: record.bankName || '',
      branchName: record.branchName || '',
      bankAccountNo: record.bankAccountNo || '',
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = () => {
    editForm.validateFields().then((values) => {
      if (!editingSupplier) return;
      const allData: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      // 供应商编号查重：排除自身后编号已存在则不允许保存
      const snoEdit = String(values.supplierNo || '').trim();
      if (snoEdit) {
        const dup = allData.find((s) => s.id !== editingSupplier.id && (String(s.supplierNo || '').trim() || resolveSupplierNo(s.supplierName)) === snoEdit);
        if (dup) {
          message.error(`供应商编号 ${snoEdit} 已存在（供应商：${dup.supplierName}），不能重复保存`);
          return;
        }
      }
      const updated = allData.map((s) =>
        s.id === editingSupplier.id
          ? { ...s, ...values }
          : s
      );
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setEditModalVisible(false);
      editForm.resetFields();
      reloadData();
      // 填写了供应商编号 → 向对应供应商账号发起合作申请
      const res = sendCooperationByNo(editingSupplier.id, values.supplierNo);
      if (res === 'sent') {
        // 已解除合作的条目重新置为待合作
        if (editingSupplier.cooperationStatus === 'terminated') {
          const all2: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
          localStorage.setItem(storageKey, JSON.stringify(all2.map((s) => (s.id === editingSupplier.id ? { ...s, cooperationStatus: 'pending' as const } : s))));
          reloadData();
        }
        message.success('供应商信息已更新，合作申请已发送，等待供应商确认');
      } else if (res === 'notfound') {
        message.warning('供应商信息已更新，但未找到编号对应的供应商账号，未发起合作申请');
      } else if (res === 'exists') {
        message.success('供应商信息已更新（该供应商的合作申请已存在，等待确认）');
      } else {
        message.success('供应商信息已更新');
      }
    });
  };

  // ========== 终止合作（采购商发起，需供应商同意）==========
  // 查找供应商对应的在途终止合作申请（双向：采购商发起/供应商发起）
  const pendingTerminateAppOf = useCallback((s: SupplierEntry): any => {
    try {
      const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
      return apps.find((app: any) =>
        app.type === 'terminate' && app.status === 'pending' && !app.superseded &&
        app.purchaserUsername === username &&
        (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id)) || null;
    } catch { return null; }
  }, [username]);

  // 撤回终止合作申请（采购商发起方）：申请置 rejected + 本侧条目回退已合作
  const handleWithdrawTerminate = (record: SupplierEntry) => {
    Modal.confirm({
      title: '撤回终止申请',
      content: `确定撤回与供应商「${record.supplierName}」的终止合作申请吗？撤回后双方恢复为已合作状态。`,
      okText: '确认撤回',
      cancelText: '取消',
      onOk: () => {
        const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
        const updated = apps.map((a: any) => (
          a.type === 'terminate' && a.status === 'pending' && !a.superseded && a.supplierInitiated !== true &&
          a.purchaserUsername === username &&
          (a.targetSupplierName === record.supplierName || a.targetSupplierId === record.id || a.purchaserSupplierEntryId === record.id)
            ? { ...a, status: 'rejected', remark: `发起方撤回：${a.remark || ''}` }
            : a
        ));
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updated));
        const allData: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const up = allData.map(s => (s.id === record.id ? { ...s, cooperationStatus: 'approved' as const, terminateApplyDate: undefined } : s));
        localStorage.setItem(storageKey, JSON.stringify(up));
        reloadData();
        window.dispatchEvent(new Event('cooperation-applications-changed'));
        message.success('已撤回终止合作申请，合作关系恢复为已合作');
      },
    });
  };

  const handleTerminate = (record: SupplierEntry) => {
    // 终止条件：应付欠款（采购金额-已付货款）必须为 0 才可发起
    const e0 = paySummary[record.supplierName];
    const due0 = Math.round(toYuan((e0?.purchaseTotal || 0) - (e0?.paidTotal || 0)) * 100) / 100;
    if (Math.abs(due0) > 0.001) {
      message.error(`供应商「${record.supplierName}」应付欠款 ¥${due0.toFixed(2)} 未结清，应付欠款为 0 时才可发起终止合作`);
      return;
    }
    setTerminatingSupplier(record);
    terminateForm.setFieldsValue({ supplierName: record.supplierName });
    setTerminateModalVisible(true);
  };

  const handleTerminateSubmit = () => {
    terminateForm.validateFields().then(() => {
      if (!terminatingSupplier) return;
      // 终止条件二次校验：应付欠款必须为 0
      const eDue = paySummary[terminatingSupplier.supplierName];
      const due = Math.round(toYuan((eDue?.purchaseTotal || 0) - (eDue?.paidTotal || 0)) * 100) / 100;
      if (Math.abs(due) > 0.001) {
        message.error(`供应商「${terminatingSupplier.supplierName}」应付欠款 ¥${due.toFixed(2)} 未结清，应付欠款为 0 时才可发起终止合作`);
        return;
      }
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

      // 1. 在 cooperation_applications 中创建终止申请
      const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
      // 作废旧的终止申请，避免 reloadData 误匹配
      apps.forEach((app) => {
        if (
          app.purchaserUsername === username &&
          (app.targetSupplierName === terminatingSupplier.supplierName || app.targetSupplierId === terminatingSupplier.id || app.purchaserSupplierEntryId === terminatingSupplier.id) &&
          app.type === 'terminate' &&
          app.status === 'approved'
        ) {
          app.superseded = true;
        }
      });
      apps.push({
        applicationId: `TERM-${Date.now()}`,
        purchaserUsername: username,
        purchaserCompanyName: (() => {
          const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const u = users.find((x: any) => x.username === username);
          return u?.companyName || username;
        })(),
        purchaserCompanyId: '',
        purchaserContact: '',
        purchaserPhone: '',
        targetSupplierName: terminatingSupplier.supplierName,
        targetSupplierId: terminatingSupplier.id,
        purchaserSupplierEntryId: terminatingSupplier.id,
        canDirectApprove: false,
        applyDate: now,
        status: 'pending',
        remark: `采购商申请终止与供应商「${terminatingSupplier.supplierName}」的合作`,
        type: 'terminate' as const,
        supplierInitiated: false,
      });
      localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));

      // 2. 更新供应商状态为 terminating
      const allData: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = allData.map((s) =>
        s.id === terminatingSupplier.id
          ? { ...s, cooperationStatus: 'terminating' as const, terminateApplyDate: now }
          : s
      );
      localStorage.setItem(storageKey, JSON.stringify(updated));

      setTerminateModalVisible(false);
      terminateForm.resetFields();
      window.dispatchEvent(new Event('cooperation-applications-changed'));
      reloadData();
      message.success('终止合作申请已发送，等待供应商确认');
    });
  };

  // ========== 删除供应商（仅已解除合作可删除）==========
  const handleDelete = (record: SupplierEntry) => {
    Modal.confirm({
      title: '确认删除供应商',
      content: `确定删除供应商「${record.supplierName}」吗？删除后数据将无法恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        // 防误删保护：对方（供应商账号）客户列表中已存在与本公司的订单历史时禁止删除，
        // 否则供应商端客户基础信息会同步失去该客户
        try {
          const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const supUser = users.find((u: any) => (u.companyName || '') === record.supplierName);
          const me = users.find((u: any) => u.username === (localStorage.getItem('username') || ''));
          const myCompany = me?.companyName || '';
          if (supUser && myCompany) {
            const orders: any[] = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${supUser.username}`) || '[]');
            if (orders.some((o: any) => (o.customerName || '') === myCompany)) {
              message.error(`供应商「${record.supplierName}」已存在与本公司的订单记录，禁止删除（如需停止合作请使用“终止合作”）`);
              return;
            }
          }
        } catch { /* ignore */ }
        const allData: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const updated = allData.filter((s) => s.id !== record.id);
        localStorage.setItem(storageKey, JSON.stringify(updated));
        reloadData();
        message.success(`供应商「${record.supplierName}」已删除`);
      },
    });
  };

  // ========== 邀约合作：弹窗提示（向供应商索要公司编号，填入供应商编号即可申请合作）==========
  const handleInviteCooperation = (record: SupplierEntry) => {
    Modal.info({
      title: '邀约合作说明',
      width: 520,
      okText: '知道了',
      content: (
        <div style={{ fontSize: 13, lineHeight: '24px' }}>
          <p>可向供应商「{record.supplierName}」索要其<Text strong>公司编号</Text>，在本供应商的编辑窗口中填写到<Text strong>「供应商编号」</Text>字段，保存后将自动向该供应商发起合作申请。</p>
          <p>供应商在供应商平台「客户管理-合作申请」中点击<Text strong>「同意合作」</Text>后，即可建立合作，供应商将自动添加到供应商列表中。</p>
        </div>
      ),
    });
  };

  // ========== 重新发起合作（已解除合作的供应商）==========
  const handleReInitiateCooperation = (record: SupplierEntry) => {
    const token = generateToken();
    const currentUser = (() => {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return users.find((u: any) => u.username === username);
    })();
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

    // 0. 作废旧的合作申请记录，避免 reloadData 误匹配
    const existingApps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
    existingApps.forEach((app) => {
      if (
        app.purchaserUsername === username &&
        (app.targetSupplierName === record.supplierName || app.targetSupplierId === record.id || app.purchaserSupplierEntryId === record.id) &&
        app.type === 'cooperation' &&
        app.status === 'approved'
      ) {
        app.superseded = true;
      }
    });
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(existingApps));

    // 1. 生成新的合作令牌
    const cooperationTokens: any[] = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '[]');
    cooperationTokens.push({
      token,
      purchaserName: username,
      purchaserCompany: currentUser?.companyName || username,
      purchaserContact: currentUser?.contactPerson || '',
      purchaserPhone: currentUser?.phone || '',
      supplierName: record.supplierName,
      supplierId: record.id,
      purchaserSupplierEntryId: record.id,
      status: 'pending',
      createdAt: now,
    });
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(cooperationTokens));

    // 2. 更新供应商状态为 pending
    const allData: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const updated = allData.map((s) =>
      s.id === record.id
        ? { ...s, cooperationStatus: 'pending' as const, cooperationToken: token, terminateAt: undefined, terminateBy: undefined, statusTs: Date.now() }
        : s
    );
    localStorage.setItem(storageKey, JSON.stringify(updated));

    // 3. 自动同步合作申请到供应商端（曾经合作过的供应商无需通过链接确认）
    const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
    apps.push({
      applicationId: `COOP-REINIT-${Date.now()}`,
      purchaserUsername: username,
      purchaserCompanyName: currentUser?.companyName || username,
      purchaserCompanyId: '',
      purchaserContact: currentUser?.contactPerson || '',
      purchaserPhone: currentUser?.phone || '',
      targetSupplierName: record.supplierName,
      targetSupplierId: record.id,
      purchaserSupplierEntryId: record.id,
      canDirectApprove: false,
      applyDate: now,
      status: 'pending',
      remark: `采购商「${currentUser?.companyName || username}」申请重新建立合作`,
      type: 'cooperation',
      supplierInitiated: false,
    });
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));
    window.dispatchEvent(new Event('cooperation-applications-changed'));

    // 4. 显示合作链接（作为备用方式）
    const link = `${window.location.origin}/cooperation-confirm/${token}`;
    setGeneratedLink(link);
    setLinkModalVisible(true);
    reloadData();
    message.success(`已向供应商「${record.supplierName}」发起合作邀请`);
  };

  // 状态配置
  const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
    approved: { color: 'success', text: '已合作', icon: <CheckCircleOutlined /> },
    pending: { color: 'processing', text: '待合作', icon: <ClockCircleOutlined /> },
    terminating: { color: 'warning', text: '解除申请中', icon: <ExclamationCircleOutlined /> },
    terminated: { color: 'default', text: '已解除合作', icon: <ClockCircleOutlined /> },
  };

  // 表格列定义（按 key 索引，支持动态显示/排序）
  const columnMap: Record<string, any> = {
    supplierName: { title: '供应商名称', dataIndex: 'supplierName', key: 'supplierName', width: 220, render: (text: string, record: SupplierEntry) => {
      const un = String(record.supplierUsername || '').trim();
      const certInfo = un ? supCertMap[un] : undefined;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Text strong>{text}</Text>
          {certInfo !== undefined && <CertBadge info={certInfo} />}
        </div>
      );
    } },
    certStatus: { title: '认证状态', key: 'certStatus', width: 100, render: (_: any, record: SupplierEntry) => {
      const un = String(record.supplierUsername || '').trim();
      const certInfo = un ? supCertMap[un] : undefined;
      return certInfo !== undefined ? <CertBadge info={certInfo} /> : <Tag style={{ fontSize: 11 }}>未认证</Tag>;
    } },
    supplierNo: { title: '供应商编号', key: 'supplierNo', width: 110, render: (_: any, record: SupplierEntry) => { const no = record.supplierNo || resolveSupplierNo(record.supplierName); return no ? <Tag color="blue">{no}</Tag> : '-'; } },
    orderPrefix: { title: '单号前缀', key: 'orderPrefix', width: 90, render: (_: any, record: SupplierEntry) => { const p = record.orderPrefix || resolveSupplierPrefix(record.supplierName); return p ? <Tag color="green">{p}</Tag> : '-'; } },
    shortName: { title: '简称', dataIndex: 'shortName', key: 'shortName', width: 100, render: (text: string) => text || '-' },
    contactPerson: { title: '联系人', dataIndex: 'contactPerson', key: 'contactPerson', width: 100 },
    contactPhone: { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 130 },
    email: { title: '电子邮箱', dataIndex: 'email', key: 'email', width: 160, render: (text: string) => text || '-' },
    legalPerson: { title: '法人代表', dataIndex: 'legalPerson', key: 'legalPerson', width: 100, render: (text: string) => text || '-' },
    wechatQr: { title: '微信加好友二维码', key: 'wechatQr', width: 90, align: 'center' as const, render: (_: any, record: SupplierEntry) => { const qr = record.wechatQr || resolveSupplierWechatQr(record.supplierName); return qr ? <Image src={qr} alt="微信加好友二维码" width={40} height={40} style={{ objectFit: 'contain', borderRadius: 4, cursor: 'pointer' }} preview={{ mask: '查看' }} /> : <Text type="secondary">-</Text>; } },
    province: { title: '省', dataIndex: 'province', key: 'province', width: 80, render: (text: string) => text || '-' },
    city: { title: '市', dataIndex: 'city', key: 'city', width: 80, render: (text: string) => text || '-' },
    district: { title: '区', dataIndex: 'district', key: 'district', width: 80, render: (text: string) => text || '-' },
    address: { title: '详细地址', dataIndex: 'address', key: 'address', width: 160, ellipsis: true, render: (text: string) => text ? <Tooltip title={text}><Text ellipsis>{text}</Text></Tooltip> : '-' },
    cooperationStatus: { title: <Tooltip title="当前与该供应商的合作状态：待合作/已合作/已终止等"><span>合作状态 <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, dataIndex: 'cooperationStatus', key: 'cooperationStatus', width: 140, render: (status: string) => { const conf = statusConfig[status] || { color: 'default', text: status, icon: null }; return <Tag icon={conf.icon} color={conf.color}>{conf.text}</Tag>; } },
    cooperationDate: { title: '合作日期', dataIndex: 'cooperationDate', key: 'cooperationDate', width: 120, render: (text: string) => text || '-' },
    // 信用额度 = 供应商端为我司设置的有效信用额度（含供应商调整）
    creditLimit: { title: <Tooltip title="供应商为我司设置的有效信用额度，含供应商侧额度调整，跨账号只读复刻"><span>信用额度(元) <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'creditLimit', width: 120, align: 'right' as const,
      render: (_: any, record: SupplierEntry) => { const v = supplierCreditMap[record.id] ?? 0; return <Text strong style={{ color: '#1890ff' }}>¥{v.toFixed(2)}</Text>; } },
    // 采购金额 = 采购账单中对应供应商的采购总额（读增量快照，O(1)）
    purchaseAmount: { title: <Tooltip title="采购账单中该供应商的采购总额累计，数据来源于采购账单明细"><span>采购金额(元) <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'purchaseAmount', width: 120, align: 'right' as const,
      render: (_: any, record: SupplierEntry) => { const v = toYuan(paySummary[record.supplierName]?.purchaseTotal || 0); return <Text strong>¥{v.toFixed(2)}</Text>; } },
    // 已付货款 = 付款台账累计（读快照）；点击明细查看付款记录
    paidAmount: { title: <Tooltip title="已通过付款台账支付给该供应商的累计金额，点击明细可查看付款记录"><span>已付货款(元) <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'paidAmount', width: 140, align: 'right' as const,
      render: (_: any, record: SupplierEntry) => { const v = toYuan(paySummary[record.supplierName]?.paidTotal || 0); return (
        <Space size={4}>
          <Text style={{ color: '#52c41a' }}>¥{v.toFixed(2)}</Text>
          <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12 }}
            onClick={() => { setPayDetailSupplier(record.supplierName); setPayDetailVisible(true); }}>明细</Button>
        </Space> ); } },
    // 应付欠款 = 采购金额 - 已付货款（快照直减，O(1)）
    dueAmount: { title: <Tooltip title="采购金额 - 已付货款，正数表示尚需支付，负数表示已超额付款"><span>应付欠款(元) <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'dueAmount', width: 120, align: 'right' as const,
      render: (_: any, record: SupplierEntry) => { const e = paySummary[record.supplierName]; const due = toYuan((e?.purchaseTotal || 0) - (e?.paidTotal || 0)); return <Text strong style={{ color: due > 0 ? '#f5222d' : '#52c41a' }}>¥{due.toFixed(2)}</Text>; } },
    // 剩余额度 = 信用额度 + 已付货款 - 采购金额 - 订单占用（负值红色）
    remainingCredit: { title: <Tooltip title="信用额度 + 已付货款 - 采购金额 - 订单占用，即当前可用信用余额，负值表示超额"><span>剩余额度(元) <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'remainingCredit', width: 120, align: 'right' as const,
      render: (_: any, record: SupplierEntry) => { const e = paySummary[record.supplierName]; const credit = supplierCreditMap[record.id] ?? 0; const due = toYuan((e?.purchaseTotal || 0) - (e?.paidTotal || 0)); const occ = orderOccupationMap[record.supplierName] ?? 0; const rem = Math.round((credit - due - occ) * 100) / 100; return <Text strong style={{ color: rem < 0 ? '#f5222d' : '#52c41a' }}>¥{rem.toFixed(2)}</Text>; } },
    // 订单占用 = 已推送未发货订单总额（点击显示明细）
    orderOccupation: { title: <Tooltip title="已推送给供应商但尚未发货的订单占用金额，点击可查看详情。发货后自动释放"><span>订单占用 <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'orderOccupation', width: 120, align: 'right' as const,
      render: (_: any, record: SupplierEntry) => { const occ = orderOccupationMap[record.supplierName] ?? 0; if (occ <= 0) return <Text style={{ color: '#999' }}>¥0.00</Text>; return <a style={{ color: '#1890ff', fontWeight: 600 }} onClick={() => { setOccSupplier(record.supplierName); setOccVisible(true); }}>¥{occ.toFixed(2)}</a>; } },
    productList: { title: <Tooltip title="该供应商发布的成品商品数量，点击查看完整商品列表"><span>货品列表 <InfoCircleOutlined style={{ color: '#bbb', fontSize: 12 }} /></span></Tooltip>, key: 'productList', width: 100, align: 'center' as const,
      render: (_: any, record: SupplierEntry) => {
        // 计数取跨浏览器取数结果（本地优先/服务端兜底），未取到前显示「查看」
        const count = spProductCounts[record.supplierName] ?? 0;
        return (
          <Button type="link" size="small" icon={<ShoppingCartOutlined />}
            onClick={() => {
              const productOwner = resolveSupplierUsername(record.supplierName) || getDataOwner();
              setProductListSupplier(record.supplierName);
              setProductListData([]);
              setPlSelected([]);
              setProductListVisible(true);
              // 跨浏览器取数：本地优先，缺失时服务端数据集兜底
              void loadSupplierFinishedProducts(productOwner).then(list => setProductListData(list));
            }}>
            {count > 0 ? <Tag color="blue">{count}</Tag> : '查看'}
          </Button>
        );
      }
    },
    accountName: { title: '账户名称', dataIndex: 'accountName', key: 'accountName', width: 140, render: (t: string) => t || '-' },
    bankName: { title: '开户银行', dataIndex: 'bankName', key: 'bankName', width: 140, render: (t: string) => t || '-' },
    branchName: { title: '支行名称', dataIndex: 'branchName', key: 'branchName', width: 120, render: (t: string) => t || '-' },
    bankAccountNo: { title: '银行账户', dataIndex: 'bankAccountNo', key: 'bankAccountNo', width: 180, render: (t: string) => t ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{t}</span> : '-' },
    remark: { title: '备注', dataIndex: 'remark', key: 'remark', width: 160, ellipsis: true, render: (text: string) => text ? <Tooltip title={text}><Text ellipsis>{text}</Text></Tooltip> : '-' },
  };

  // 操作列（始终固定在末尾）
  const actionColumn: any = {
    title: '操作', key: 'action', width: 240, fixed: 'right',
    render: (_: any, record: SupplierEntry) => {
      const isApproved = record.cooperationStatus === 'approved';
      const isTerminated = record.cooperationStatus === 'terminated';
      const isPending = record.cooperationStatus === 'pending';
      return (
        <Space size="small" wrap>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>查看</Button>
          {(isApproved || isPending) && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          )}
          <Button type="link" size="small" style={{ color: '#1890ff' }} icon={<DollarOutlined />}
            onClick={() => { setApplyPayTarget(record); setApplyPayAmount(null); setApplyDebit('应付账款'); setApplyCredit('银行存款'); setApplyPayVisible(true); }}>申请付款</Button>
          {!isApproved && (isPending && record.supplierInitiated === true ? (
            <Tag color="processing">供应商申请待审核</Tag>
          ) : (
            <Button type="link" size="small" style={{ color: '#52c41a' }} icon={<LinkOutlined />} onClick={() => handleInviteCooperation(record)}>邀约合作</Button>
          ))}
          {isApproved && <Button type="link" size="small" danger icon={<StopOutlined />} onClick={() => handleTerminate(record)}>终止合作</Button>}
          {(() => {
            const termApp = pendingTerminateAppOf(record);
            const inTerminate = record.cooperationStatus === 'terminating' || !!termApp;
            if (!inTerminate) return null;
            return (
              <>
                <Button type="link" size="small" disabled icon={<StopOutlined />}>解除申请中</Button>
                {termApp && termApp.supplierInitiated !== true && (
                  <Button type="link" size="small" style={{ color: '#faad14' }} onClick={() => handleWithdrawTerminate(record)}>撤回终止申请</Button>
                )}
              </>
            );
          })()}
          {isTerminated && (
            <>
              <Button type="link" size="small" style={{ color: '#52c41a' }} icon={<LinkOutlined />} onClick={() => handleReInitiateCooperation(record)}>发起合作</Button>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>删除</Button>
            </>
          )}
        </Space>
      );
    },
  };

  // 根据显示字段控制和排序构建最终列
  const columns: ColumnsType<SupplierEntry> = [
    ...fieldOrder.filter(k => fieldVisibility[k] && columnMap[k]).map(k => columnMap[k]),
    actionColumn,
  ];

  return (
    <div style={{ padding: '0' }}>
      {/* 页面头部 */}
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d6bc4 100%)`,
        color: '#fff',
        padding: '20px 28px',
        borderRadius: 12,
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TeamOutlined style={{ fontSize: 22, color: '#fff' }} />
          </div>
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>供应商列表</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              查看所有已建立合作关系的供应商信息，合作申请通过后供应商将出现在此列表中
            </Text>
          </div>
        </div>
        <Space>
          <Button ghost icon={<CalendarOutlined />} onClick={() => setAsOfOpen(true)}>
            截止应付欠款
          </Button>
          <Button ghost icon={<ReloadOutlined />} onClick={() => { reloadData(); message.success('已刷新'); }}>
            刷新
          </Button>
          <Button
            ghost
            type="primary"
            icon={<PlusOutlined />}
            style={{ color: '#fff' }}
            onClick={() => {
              addForm.resetFields();
              setAddModalVisible(true);
            }}
          >
            新增供应商
          </Button>
        </Space>
      </div>

      {/* 统计卡片（单行紧凑布局，行高约为原一半）：供应商总数 + 采购金额/已付金额/欠款总额（供应商列表对应字段总和） */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" hoverable bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'nowrap' }}><TeamOutlined style={{ fontSize: 13, marginRight: 4 }} />供应商总数</span>
              <Text strong style={{ color: PRIMARY, fontSize: 16 }}>{stats.total}</Text>
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" hoverable bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'nowrap' }}><DollarOutlined style={{ fontSize: 13, marginRight: 4 }} />采购金额(元)</span>
              <Text strong style={{ color: PRIMARY, fontSize: 16 }}>{payTotals.purchase.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" hoverable bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'nowrap' }}><DollarOutlined style={{ fontSize: 13, marginRight: 4 }} />已付金额(元)</span>
              <Text strong style={{ color: '#52c41a', fontSize: 16 }}>{payTotals.paid.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card size="small" hoverable bodyStyle={{ padding: '4px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'nowrap' }}><DollarOutlined style={{ fontSize: 13, marginRight: 4 }} />欠款总额(元)</span>
              <Text strong style={{ color: payTotals.due > 0 ? '#f5222d' : '#52c41a', fontSize: 16 }}>{payTotals.due.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 搜索与筛选 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 24px' }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={12} sm={3} md={2}>
            <Input
              placeholder="供应商名称/简称"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onPressEnter={applySearch}
              allowClear
            />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="联系人" value={searchContact} onChange={(e) => setSearchContact(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="联系电话" value={searchPhone} onChange={(e) => setSearchPhone(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="银行账户" value={searchBank} onChange={(e) => setSearchBank(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="法人代表" value={searchLegal} onChange={(e) => setSearchLegal(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="省" value={searchProvince} onChange={(e) => setSearchProvince(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="市" value={searchCity} onChange={(e) => setSearchCity(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="区" value={searchDistrict} onChange={(e) => setSearchDistrict(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Input placeholder="供应商编号" value={searchSupplierNo} onChange={(e) => setSearchSupplierNo(e.target.value)} onPressEnter={applySearch} allowClear />
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: '100%' }}
            >
              <Option value="all">全部状态</Option>
              <Option value="approved">已合作</Option>
              <Option value="pending">待合作</Option>
              <Option value="terminating">解除申请中</Option>
              <Option value="terminated">已解除合作</Option>
            </Select>
          </Col>
          <Col xs={12} sm={3} md={2}>
            <Space size={4}>
              <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>查询</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setSearchText(''); setSearchContact(''); setSearchPhone(''); setSearchBank(''); setSearchLegal(''); setSearchProvince(''); setSearchCity(''); setSearchDistrict(''); setSearchSupplierNo(''); setAppliedSearch(emptyAppliedSearch); setStatusFilter('all'); }}>
                重置
              </Button>
            </Space>
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Button icon={<SettingOutlined />} onClick={() => setFieldConfigVisible(true)}>显示字段</Button>
          </Col>
        </Row>
      </Card>

      {/* 数据表格 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          bordered
          scroll={{ x: 1200 }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
          }}
          locale={{ emptyText: '暂无已合作的供应商，请先在"合作申请"页面完成合作' }}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title={<span><EyeOutlined style={{ marginRight: 8 }} />供应商详情</span>}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={<Button onClick={() => setDetailVisible(false)}>关闭</Button>}
        width={560}
      >
        {detailSupplier && (
          <Descriptions column={2} bordered size="small" style={{ marginTop: 16 }}>
            <Descriptions.Item label="供应商名称" span={2}>{detailSupplier.supplierName}</Descriptions.Item>
            <Descriptions.Item label="供应商编号">{(detailSupplier as any).supplierNo || resolveSupplierNo(detailSupplier.supplierName) || '-'}</Descriptions.Item>
            <Descriptions.Item label="简称">{detailSupplier.shortName || '-'}</Descriptions.Item>
            <Descriptions.Item label="法人代表">{detailSupplier.legalPerson || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系人">{detailSupplier.contactPerson || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{detailSupplier.contactPhone || '-'}</Descriptions.Item>
            <Descriptions.Item label="电子邮箱" span={2}>{detailSupplier.email || '-'}</Descriptions.Item>
            <Descriptions.Item label="客户地址" span={2}>{[detailSupplier.province, detailSupplier.city, detailSupplier.district].filter(Boolean).join('') || '-'}</Descriptions.Item>
            <Descriptions.Item label="详细地址" span={2}>{detailSupplier.address || '-'}</Descriptions.Item>
            <Descriptions.Item label="微信加好友二维码" span={2}>
              {detailSupplier.wechatQr || resolveSupplierWechatQr(detailSupplier.supplierName) ? (
                <img src={detailSupplier.wechatQr || resolveSupplierWechatQr(detailSupplier.supplierName)} alt="微信加好友二维码" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, border: '1px solid #eee' }} />
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="合作状态">
              {(() => {
                const conf = statusConfig[detailSupplier.cooperationStatus];
                return conf ? <Tag icon={conf.icon} color={conf.color}>{conf.text}</Tag> : detailSupplier.cooperationStatus;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="合作日期">{detailSupplier.cooperationDate || '-'}</Descriptions.Item>
            <Descriptions.Item label="添加日期" span={2}>{detailSupplier.addedDate}</Descriptions.Item>
            {detailSupplier.remark && (
              <Descriptions.Item label="备注" span={2}>{detailSupplier.remark}</Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>

      {/* 新增供应商弹窗（与新增商品时供应商旁「新建」弹窗同一组件样式，省市区使用预设数据下拉） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><PlusOutlined style={{ marginRight: 8 }} />新增供应商</span>}
        open={addModalVisible}
        onCancel={() => { setAddModalVisible(false); addForm.resetFields(); }}
        onOk={handleAddSupplier}
        okText="确认添加"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <Form autoComplete="off" form={addForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="supplierName"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="请输入供应商企业名称" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="supplierNo"
                label={
                  <span>
                    供应商编号&nbsp;
                    <Tooltip title="填写供应商编号可以申请合作">
                      <InfoCircleOutlined style={{ color: '#faad14' }} />
                    </Tooltip>
                  </span>
                }
              >
                <Input placeholder="供应商公司编号（选填）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shortName" label="简称">
                <Input placeholder="供应商简称（选填）" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contactPerson" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactPhone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label="电子邮箱">
            <Input placeholder="电子邮箱（选填）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="province" label="省">
                <Select placeholder="省" allowClear showSearch options={getProvinceOptions()}
                  onChange={() => addForm.setFieldsValue({ city: undefined, district: undefined })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="city" label="市">
                <Select placeholder="市" allowClear showSearch options={getCityOptions(addProvince)}
                  onChange={() => addForm.setFieldsValue({ district: undefined })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="district" label="区">
                <Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(addProvince, addCity)} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="详细地址">
            <Input.TextArea placeholder="详细地址（选填）" rows={2} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="accountName" label="账户名称">
                <Input placeholder="收款账户名称（公司名/姓名）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankName" label="开户银行">
                <Input placeholder="如：中国工商银行" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branchName" label="支行名称">
                <Input placeholder="如：城东支行" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankAccountNo" label="银行账户">
                <Input placeholder="银行卡号" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="备注">
            <Input.TextArea placeholder="备注信息（选填）" rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑供应商弹窗（与新增供应商窗口一致） */}
      <Modal
        title={<span><EditOutlined style={{ marginRight: 8 }} />编辑供应商</span>}
        open={editModalVisible}
        onCancel={() => { setEditModalVisible(false); editForm.resetFields(); }}
        onOk={handleEditSubmit}
        okText="保存"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <Form autoComplete="off" form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="supplierName"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="请输入供应商企业名称" disabled={editingSupplier?.cooperationStatus === 'approved'} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="supplierNo"
                label={
                  <span>
                    供应商编号&nbsp;
                    <Tooltip title="填写供应商编号可以申请合作">
                      <InfoCircleOutlined style={{ color: '#faad14' }} />
                    </Tooltip>
                  </span>
                }
              >
                <Input placeholder="供应商公司编号（选填）" disabled={editingSupplier?.cooperationStatus === 'approved'} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shortName" label="简称">
                <Input placeholder="供应商简称（选填）" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contactPerson" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactPhone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label="电子邮箱">
            <Input placeholder="电子邮箱（选填）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="province" label="省">
                <Select placeholder="省" allowClear showSearch options={getProvinceOptions()}
                  onChange={() => editForm.setFieldsValue({ city: undefined, district: undefined })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="city" label="市">
                <Select placeholder="市" allowClear showSearch options={getCityOptions(editProvince)}
                  onChange={() => editForm.setFieldsValue({ district: undefined })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="district" label="区">
                <Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(editProvince, editCity)} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="详细地址">
            <Input.TextArea placeholder="详细地址（选填）" rows={2} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="accountName" label="账户名称" extra="默认同步供应商企业信息中维护的银行信息；手动修改后停止自动同步">
                <Input placeholder="收款账户名称（公司名/姓名）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankName" label="开户银行">
                <Input placeholder="如：中国工商银行" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branchName" label="支行名称">
                <Input placeholder="如：城东支行" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankAccountNo" label="银行账户">
                <Input placeholder="银行卡号" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="备注">
            <Input.TextArea placeholder="备注信息（选填）" rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 终止合作确认弹窗 */}
      <Modal
        title={
          <Space>
            <StopOutlined style={{ color: '#ff4d4f' }} />
            <span>申请终止合作</span>
          </Space>
        }
        open={terminateModalVisible}
        onCancel={() => { setTerminateModalVisible(false); terminateForm.resetFields(); }}
        onOk={handleTerminateSubmit}
        okText="确认发送申请"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={480}
      >
        <div style={{
          padding: '12px 16px', background: '#fff2e8',
          border: '1px solid #ffbb96', borderRadius: 6, marginBottom: 16, marginTop: 8,
        }}>
          终止合作需要供应商确认后方可生效。生效后供应商信息将保留，但双方数据联动将终止。
        </div>
        <Form autoComplete="off" form={terminateForm} layout="vertical">
          <Form.Item name="supplierName" label="终止对象">
            <Input disabled />
          </Form.Item>
        </Form>
      </Modal>

      {/* 合作链接弹窗 */}
      <Modal
        title={
          <Space>
            <LinkOutlined style={{ color: '#1890ff' }} />
            <span>合作邀约链接</span>
          </Space>
        }
        open={linkModalVisible}
        onCancel={() => setLinkModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setLinkModalVisible(false)}>关闭</Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={copyLink}
            style={{ border: 'none', background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)' }}
          >
            复制链接
          </Button>,
        ]}
        width={560}
      >
        <div style={{
          padding: '12px 16px', background: '#e6f7ff',
          border: '1px solid #91d5ff', borderRadius: 6, marginBottom: 16, marginTop: 8,
        }}>
          将该链接发送给供应商，供应商打开链接确认后即可建立合作关系。
          合作成功后供应商将自动出现在此列表中。
        </div>
        <div style={{
          padding: '16px 20px', background: '#fafafa',
          border: '1px solid #d9d9d9', borderRadius: 8,
          wordBreak: 'break-all', fontSize: 13,
          fontFamily: 'monospace', color: '#1890ff',
        }}>
          {generatedLink}
        </div>
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

      {/* 货品列表弹窗 */}
      <Modal
        title={<span><ShoppingCartOutlined style={{ marginRight: 8 }} />{productListSupplier} - 成品列表</span>}
        open={productListVisible}
        onCancel={() => { setProductListVisible(false); handlePlReset(); }}
        footer={<div style={{ textAlign: 'right' }}><Button onClick={() => { setProductListVisible(false); handlePlReset(); }}>关闭</Button></div>}
        width={960}
        destroyOnClose
      >
        {/* 搜索栏 */}
        <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
          <Row gutter={[12, 10]} align="middle">
            <Col xs={12} sm={6}>
              <Input
                placeholder="商品编码"
                value={plInputCode}
                onChange={(e) => setPlInputCode(e.target.value)}
                onPressEnter={handlePlSearch}
                allowClear
                size="small"
              />
            </Col>
            <Col xs={12} sm={6}>
              <Input
                placeholder="款式编码"
                value={plInputStyleCode}
                onChange={(e) => setPlInputStyleCode(e.target.value)}
                onPressEnter={handlePlSearch}
                allowClear
                size="small"
              />
            </Col>
            <Col xs={12} sm={5}>
              <Input
                placeholder="品牌"
                value={plInputBrand}
                onChange={(e) => setPlInputBrand(e.target.value)}
                onPressEnter={handlePlSearch}
                allowClear
                size="small"
              />
            </Col>
            <Col xs={12} sm={7}>
              <Space size={2} style={{ flexWrap: 'nowrap' }}>
                <span style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>基础售价</span>
                <Input
                  placeholder="最低"
                  value={plInputPriceMin}
                  onChange={(e) => setPlInputPriceMin(e.target.value)}
                  onPressEnter={handlePlSearch}
                  allowClear
                  size="small"
                  style={{ width: 72 }}
                />
                <span style={{ color: '#999' }}>~</span>
                <Input
                  placeholder="最高"
                  value={plInputPriceMax}
                  onChange={(e) => setPlInputPriceMax(e.target.value)}
                  onPressEnter={handlePlSearch}
                  allowClear
                  size="small"
                  style={{ width: 72 }}
                />
              </Space>
            </Col>
            <Col xs={12} sm={6}>
              <Select
                placeholder="商品状态"
                value={plInputStatus || undefined}
                onChange={(v) => setPlInputStatus(v || '')}
                allowClear
                size="small"
                style={{ width: '100%' }}
              >
                <Select.Option value="在售">在售</Select.Option>
                <Select.Option value="开发">开发</Select.Option>
                <Select.Option value="预售">预售</Select.Option>
                <Select.Option value="停产">停产</Select.Option>
                <Select.Option value="下架">下架</Select.Option>
              </Select>
            </Col>
            <Col xs={12} sm={6}>
              <Space>
                <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handlePlSearch}>查询</Button>
                <Button size="small" icon={<ReloadOutlined />} onClick={handlePlReset}>重置</Button>
                <Button type="primary" size="small" icon={<CopyOutlined />} disabled={plSelected.length === 0}
                  style={{ color: '#fff' }}
                  onClick={handleCopySupplierProducts}>复制供应商货品{plSelected.length ? `(${plSelected.length})` : ''}</Button>
              </Space>
            </Col>
          </Row>
        </div>
        <Table
          bordered
          dataSource={plFilteredData}
          rowKey={(r) => r.key || r.productCode || r.styleCode || Math.random().toString()}
          rowSelection={{ selectedRowKeys: plSelected, onChange: (keys) => setPlSelected(keys) }}
          pagination={{
            current: plPage,
            pageSize: plPageSize,
            total: plFilteredData.length,
            showSizeChanger: true,
            showQuickJumper: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            onChange: (page, pageSize) => { setPlPage(page); setPlPageSize(pageSize); },
          }}
          size="small"
          locale={{ emptyText: <Text type="secondary">该供应商暂无匹配的成品</Text> }}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 100,
              render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
            { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 100 },
            { title: '商品简称', dataIndex: 'shortName', key: 'shortName', width: 120,
              render: (v: string) => v || '-' },
            { title: '颜色', dataIndex: 'color', key: 'color', width: 80,
              render: (v: string) => v || '-' },
            { title: '规格', dataIndex: 'spec', key: 'spec', width: 100,
              render: (v: string) => v || '-' },
            { title: '品牌', dataIndex: 'brand', key: 'brand', width: 80,
              render: (v: string) => v || '-' },
            { title: '基础售价', dataIndex: 'suggestedPrice', key: 'suggestedPrice', width: 100, align: 'right' as const,
              render: (v: any) => {
                const n = Number(v);
                return n && !Number.isNaN(n) ? <Text strong style={{ color: '#52c41a' }}>¥{n.toFixed(2)}</Text> : '-';
              } },
            { title: '商品状态', dataIndex: 'productStatus', key: 'productStatus', width: 90,
              render: (v: string) => {
                const map: Record<string, { color: string; text: string }> = {
                  '在售': { color: 'success', text: '在售' },
                  '预售': { color: 'processing', text: '预售' },
                  '停产': { color: 'error', text: '停产' },
                  '下架': { color: 'default', text: '下架' },
                };
                const c = map[v] || { color: 'default', text: v || '-' };
                return <Tag color={c.color}>{c.text}</Tag>;
              }
            },
          ]}
        />
      </Modal>

      {/* 付货款弹窗：付款金额 + 付款银行账户 + 付款截图（点击/粘贴） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />付货款{payTarget ? ` - ${payTarget.supplierName}` : ''}</span>}
        open={payModalVisible}
        onCancel={() => setPayModalVisible(false)}
        onOk={handlePaySubmit}
        okText="确认付款"
        cancelText="取消"
        width={780}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>付款金额（元）*</Text>
            <InputNumber style={{ width: '100%' }} min={0.01} precision={2} addonBefore="¥" placeholder="请输入付款金额"
              value={payAmount} onChange={(v) => setPayAmount(v === null ? null : Number(v))} />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>付款银行账户 *</Text>
            <Select showSearch style={{ width: '100%' }} placeholder="选择付款银行账户（输入可检索）" value={payBank || undefined}
              onChange={(v) => setPayBank(v)} optionFilterProp="label"
              options={bankAccounts.map((b: any) => {
                const name = b.name || b.shortName || '';
                const no = String(b.bankAccountNo || '').replace(/\s/g, '');
                const masked = no.length <= 8 ? no : `${no.slice(0, 4)} **** **** ${no.slice(-4)}`;
                const bank = `${b.bankName || ''}${b.branchName ? `(${b.branchName})` : ''}`;
                return { value: name, label: `${name}　${bank}　${masked}` };
              })}
            />
          </div>
          {isAccountingMode(getDataOwner()) && (
            <div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>借方科目</Text>
                  <Select showSearch style={{ width: '100%' }} value={payDebit} onChange={v => setPayDebit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
                </div>
                <div style={{ flex: 1 }}>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>贷方科目</Text>
                  <Select showSearch style={{ width: '100%' }} value={payCredit} onChange={v => setPayCredit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
                </div>
              </div>
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
                说明与处理逻辑：确认付款后系统按借/贷科目自动在「会计账薄-会计分录」生成 2 条分录（借：{payDebit}、贷：{payCredit}，金额同付款金额），并在付款账户的银行明细中新增一条支出明细；摘要自动写明应付账款对应的供应商名称。借/贷科目均可手动修改。仅「会计账薄」开关开启时生效。
              </div>
            </div>
          )}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>付款截图（点击选择或粘贴）</Text>
            <input ref={payShotInputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePayShotFile(f); e.target.value = ''; }} />
            {payShot ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={payShot} width={120} height={90} style={{ objectFit: 'cover', borderRadius: 4 }} />
                <Button size="small" danger style={{ position: 'absolute', top: -10, right: -10 }} onClick={() => setPayShot('')}>删除</Button>
              </div>
            ) : (
              <div onClick={() => payShotInputRef.current?.click()}
                style={{ border: '1px dashed #d9d9d9', borderRadius: 6, padding: '18px 0', textAlign: 'center', color: '#8c8c8c', cursor: 'pointer' }}>
                <PictureOutlined style={{ marginRight: 6 }} />点击选择图片或粘贴截图
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 申请付款弹窗（供应商货款 → 财务管理-付款申请） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />申请付款{applyPayTarget ? ` - ${applyPayTarget.supplierName}` : ''}</span>}
        open={applyPayVisible}
        onCancel={() => { setApplyPayVisible(false); setApplyPayTarget(null); setApplyPayAmount(null); }}
        onOk={handleApplyPaySubmit}
        okText="提交申请"
        cancelText="取消"
        width={520}
      >
        {applyPayTarget && (
          <div>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="账户名称">{applyPayTarget.accountName || '—'}</Descriptions.Item>
              <Descriptions.Item label="开户银行">{applyPayTarget.bankName || '—'}</Descriptions.Item>
              <Descriptions.Item label="支行名称">{applyPayTarget.branchName || '—'}</Descriptions.Item>
              <Descriptions.Item label="银行账户">{applyPayTarget.bankAccountNo ? <span style={{ fontFamily: 'monospace' }}>{applyPayTarget.bankAccountNo}</span> : '—'}</Descriptions.Item>
            </Descriptions>
            {(!applyPayTarget.accountName || !applyPayTarget.bankAccountNo) && (
              <div style={{ marginBottom: 12, padding: '6px 10px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, fontSize: 12, color: '#874d00' }}>供应商银行账户信息不完整，请先点击「编辑」补充后再申请</div>
            )}
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>请求付款金额 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="请输入请求付款金额"
              value={applyPayAmount} onChange={v => setApplyPayAmount(v === null ? null : v)} />
            {isAccountingMode(getDataOwner()) && (
              <>
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ display: 'block', marginBottom: 6 }}>借方科目</Text>
                    <Select showSearch style={{ width: '100%' }} value={applyDebit} onChange={v => setApplyDebit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ display: 'block', marginBottom: 6 }}>贷方科目</Text>
                    <Select showSearch style={{ width: '100%' }} value={applyCredit} onChange={v => setApplyCredit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
                  </div>
                </div>
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
                  说明与处理逻辑：借/贷科目随申请单保存（默认借：应付账款、贷：银行存款），待审核通过且出纳支付后，系统按此科目在「会计账薄-会计分录」生成 2 条分录（摘要写明供应商名称），并在付款账户的银行明细中新增一条支出明细。科目均可手动修改。仅「会计账薄」开关开启时生效。
                </div>
              </>
            )}
            <div style={{ marginTop: 12, fontSize: 11, color: '#999' }}>提交后进入「财务管理-收/付申请」待审核；出纳支付后写入银行明细、日常记账与已付货款明细</div>
          </div>
        )}
      </Modal>

      {/* 已付货款明细弹窗：付款台账 + 重算修复 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><WalletOutlined style={{ marginRight: 8 }} />已付货款明细{payDetailSupplier ? ` - ${payDetailSupplier}` : ''}</span>}
        open={payDetailVisible}
        onCancel={() => setPayDetailVisible(false)}
        footer={[
          <Button key="repair" icon={<ReloadOutlined />} onClick={() => { repairSupplierSummary(getDataOwner(), [payDetailSupplier]); reloadPaySummary(); message.success('已按台账与采购账单重算完成'); }}>重算</Button>,
          <Button key="close" type="primary" onClick={() => setPayDetailVisible(false)}>关闭</Button>,
        ]}
        width={760}
      >
        <Table
          bordered
          size="small"
          rowKey={(r: any) => r.key}
          dataSource={loadSupplierPayments(getDataOwner(), payDetailSupplier)}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          locale={{ emptyText: '暂无付款记录' }}
          columns={[
            { title: '付款日期', dataIndex: 'payDate', key: 'payDate', width: 150, align: 'center' as const },
            { title: '付款金额(元)', dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const, render: (v: number) => <Text strong style={{ color: '#f5222d' }}>¥{Number(v || 0).toFixed(2)}</Text> },
            { title: '付款账户', dataIndex: 'bankAccount', key: 'bankAccount', width: 200, align: 'center' as const,
              render: (t: string, r: any) => {
                if (!t) return '-';
                // 账户名称 + 开户银行 + 脱敏银行账号（前后各留 4 位）；优先读台账留存值，回退实时回查银行账户
                const acc = bankAccounts.find((b: any) => (b.name || b.shortName || '') === t);
                const bank = r.bankName || acc?.bankName || '';
                const branch = !r.bankName && acc?.branchName ? `(${acc.branchName})` : '';
                const no = String(r.bankAccountNo || acc?.bankAccountNo || '').replace(/\s/g, '');
                const masked = no.length <= 8 ? no : `${no.slice(0, 4)} **** **** ${no.slice(-4)}`;
                return (
                  <div style={{ lineHeight: '18px' }}>
                    <div><Text strong>{t}</Text></div>
                    {(bank || masked) && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{bank}{branch}{masked ? ` ${masked}` : ''}</div>}
                  </div>
                );
              } },
            { title: '操作人', dataIndex: 'operator', key: 'operator', width: 90, align: 'center' as const, render: (t: string) => t || '-' },
            { title: '付款截图', dataIndex: 'screenshot', key: 'screenshot', width: 90, align: 'center' as const, render: (t: string) => t ? <Image src={t} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-' },
          ]}
        />
      </Modal>

      {/* 订单占用明细弹窗：显示该供应商所有已推送未发货订单 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />订单占用明细{occSupplier ? ` - ${occSupplier}` : ''}</span>}
        open={occVisible}
        onCancel={() => setOccVisible(false)}
        footer={<Button key="close" type="primary" onClick={() => setOccVisible(false)}>关闭</Button>}
        width={780}
      >
        <Table
          bordered
          size="small"
          rowKey={(r: any) => r.key}
          dataSource={getOccupationOrders(occSupplier)}
          pagination={false}
          locale={{ emptyText: '暂无占用订单' }}
          columns={[
            { title: '订单编号', dataIndex: 'id', key: 'id', width: 160, align: 'center' as const },
            { title: '货品明细', key: 'detail', width: 280, render: (_: any, r: any) => (
              <Text ellipsis style={{ maxWidth: 260 }}>{(r.items || []).map((x: any) => `${x.shortName}${x.color ? '-' + x.color : ''}${x.spec ? '-' + x.spec : ''}×${x.quantity}`).join('，')}</Text>
            ) },
            { title: '订单金额', dataIndex: 'totalAmount', key: 'totalAmount', width: 120, align: 'right' as const,
              render: (v: number) => <Text strong style={{ color: '#f5222d' }}>¥{Number(v || 0).toFixed(2)}</Text> },
            { title: '推送时间', dataIndex: 'pushTime', key: 'pushTime', width: 160, align: 'center' as const },
          ]}
          summary={(data) => {
            const arr = Array.from(data);
            const total = arr.reduce((sum: number, r: any) => sum + (Number(r.totalAmount) || 0), 0);
            return <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={2} align="right"><Text strong>占用合计</Text></Table.Summary.Cell><Table.Summary.Cell index={2} align="right"><Text strong style={{ color: '#f5222d' }}>¥{total.toFixed(2)}</Text></Table.Summary.Cell><Table.Summary.Cell index={3}><Text type="secondary">{arr.length} 笔</Text></Table.Summary.Cell></Table.Summary.Row>;
          }}
        />
      </Modal>

      {/* 截止应付欠款查询：账单截止日+付款截止日双时间筛选，旧欠残留/时点余额双模式 */}
      <AsOfDebtModal
        open={asOfOpen}
        onClose={() => setAsOfOpen(false)}
        title="截止应付欠款查询"
        nameLabel="供应商"
        debtLabel="截止应付欠款(元)"
        billLabel="采购账单"
        payLabel="付款"
        names={dataSource.map(s => s.supplierName)}
        bills={{
          list: asOfData.bills,
          name: (b: any) => String(b?.supplier || b?.supplierName || '').trim(),
          date: (b: any) => String(b?.date || b?.createTime || ''),
          amount: (b: any) => Number(b?.totalAmount) || 0,
          no: (b: any) => b?.outboundNo || b?.no || '',
        }}
        pays={{
          list: asOfData.pays,
          name: (p: any) => String(p?.supplierName || '').trim(),
          date: (p: any) => String(p?.payDate || p?.createdAt || ''),
          amount: (p: any) => Number(p?.amount) || 0,
          no: (p: any) => p?.key || '',
        }}
      />

      {/* 供应商邀约合作受理弹窗：显示邀约公司信息，同意后立即建立合作 */}
      <Modal
        title={<span><TeamOutlined style={{ marginRight: 8, color: '#1890ff' }} />供应商合作邀约</span>}
        open={!!invitePayload}
        onCancel={() => setInvitePayload(null)}
        footer={[
          <Button key="reject" danger onClick={handleRejectInvite}>拒绝</Button>,
          <Button key="accept" type="primary" icon={<CheckCircleOutlined />} onClick={handleAcceptInvite}>
            同意合作
          </Button>,
        ]}
        width={560}
      >
        {invitePayload && (
          <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="公司名称">{inviteSupplier?.companyName || '（未找到对应注册账号）'}</Descriptions.Item>
              <Descriptions.Item label="公司编号">{invitePayload.no}</Descriptions.Item>
              <Descriptions.Item label="联系人">{inviteSupplier?.contactPerson || '-'}</Descriptions.Item>
              <Descriptions.Item label="联系电话">{inviteSupplier?.phone || '-'}</Descriptions.Item>
              {invitePayload.bind === 1 && (
                <Descriptions.Item label="合作负责人">合作建立后绑定供应商负责人「{invitePayload.salesmanName || invitePayload.salesman}」</Descriptions.Item>
              )}
            </Descriptions>
            <Alert
              type="info"
              showIcon
              message="同意后将与该供应商立即建立合作关系并加入供应商列表；如列表中已有相同公司编号/名称的供应商，将自动更新该条目。"
            />
          </Space>
        )}
      </Modal>
    </div>
  );
};

export default PurchaserSupplierList;
