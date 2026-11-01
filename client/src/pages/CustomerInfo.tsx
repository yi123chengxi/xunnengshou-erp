import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Card, Row, Col, Typography, Table, Tag, Button, Space, Modal, Form, Input, InputNumber, Select, message, Badge, Tooltip, Tabs, Descriptions, Empty, Image, Radio, Alert, Checkbox,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  ExportOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
  UserOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  DisconnectOutlined,
  PictureOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  QuestionCircleOutlined,
  WalletOutlined,
  HistoryOutlined,
  FileTextOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { saveDataset } from '../utils/dataStore';
import AsOfDebtModal from '../components/AsOfDebtModal';
import EnterpriseCertModal, { CertBadge, fetchCertStatus, fetchCertBatch } from '../components/EnterpriseCertModal';
import type { CertInfo } from '../components/EnterpriseCertModal';
import { flushDatasetUpload, flushDatasetUploadAsync, ensureDatasetFromServer, mergeDatasetFromServer } from '../utils/serverSync';
import { safeSetItem } from '../utils/storageQuota';
import { isAccountingMode, writeAutoEntries, loadSubjectOptions, subjectFilterOption } from '../utils/accountingBridge';
import { loadTenantUsers } from '../utils/tenantUsers';
import { getProvinceOptions, getCityOptions, getDistrictOptions, CHINA_REGIONS } from '../utils/regions';
import {
  loadCustomerSummary, ensureCustomerSummaryBuilt, incrementCustomerReceived, refreshCustomerPurchase,
  verifyCustomerSummary, verifyCustomerPurchase, startIdlePatrol, toYuan,
} from '../utils/paySummary';
import type { CustomerSummaryEntry } from '../utils/paySummary';
import { buildOrderOccupiedAmountMap, getOrderOccupiedList } from '../utils/orderOccupied';
import { canFn, usePermTick } from '../utils/perm';
import { compressImageFile } from '../utils/imageCompress';
import { getCurrentUserDisplayName } from '../utils/billLog';
import { buildInviteLink } from '../utils/cooperationInvite';

const { Text } = Typography;
const { Option } = Select;

const PRIMARY = '#1e4a7e';
const COOPERATION_APPLICATIONS_KEY = 'cooperation_applications';

// 信用额度调整记录接口
interface CreditAdjustRecord {
  key: string;
  customerId: string;
  customerName: string;
  type: 'increase' | 'decrease';
  amount: number;
  date: string;
  remark?: string;
  operator?: string;
}

// 客户对账单记录（生成历史：用于本期区间起点计算与历史查看）
interface CustomerStatement {
  key: string;
  no: string;                 // 对账单编号
  customerId: string;
  customerName: string;
  createdAt: string;          // 生成时间
  periodFrom: string;         // 本期起点（上次生成时间，空=不限）
  periodTo: string;           // 本期终点（本次生成时间）
  cumulativeDebt: number;     // 累计欠款金额（应收欠款）
  openingDebt: number;        // 期初欠款 = 累计欠款 - 本期新增采购 + 本期新增收款
  newPurchaseAmount: number;  // 本期新增采购金额
  newPurchaseQty: number;     // 本期新增采购数量
  newReceiptAmount: number;   // 本期新增收款金额
  billCount: number;
  bills: { billNo: string; date: string; qty: number; amount: number }[];
  receipts: { receiptNo: string; date: string; amount: number }[];
  legalPerson: string;        // 法人代表（无则为空）
  contactPerson: string;
  contactPhone: string;
}

// 信用额度调整独立存储 key
const getCreditAdjustKey = () => 'credit_adjustments_' + getDataOwner();

// 从 localStorage 加载信用额度调整记录
const loadCreditAdjustments = (): CreditAdjustRecord[] => {
  try {
    const raw = localStorage.getItem(getCreditAdjustKey());
    return JSON.parse(raw || '[]');
  } catch { return []; }
};

// 保存信用额度调整记录（安全写入 + 等待服务端确认落库 + 回读校验）
const saveCreditAdjustments = async (records: CreditAdjustRecord[]) => {
  const key = getCreditAdjustKey();
  const json = JSON.stringify(records);
  // 使用 safeSetItem 保证写入成功（配额溢出时自动清理重试）
  safeSetItem(key, json);
  // 同步写入 _ts 时间戳，防止 pullAllDatasets 用服务端旧数据覆盖
  safeSetItem(`${key}_ts`, String(Date.now()));
  saveDataset(key, json);
  // 立即上传服务端并等待确认落库（确保服务端有数据后再返回）
  const uploaded = await flushDatasetUploadAsync(key, json);
  if (!uploaded) {
    // 服务端上传失败时降级为 fire-and-forget
    flushDatasetUpload(key, json);
    console.warn('[credit_adjust] 服务端上传失败，降级为异步上传');
  }
  // 回读校验：确认 localStorage 中的数据与写入一致
  try {
    const readback = localStorage.getItem(key);
    if (readback !== json) {
      console.warn('[credit_adjust] 回读校验不一致，重新写入');
      safeSetItem(key, json);
      safeSetItem(`${key}_ts`, String(Date.now()));
    }
  } catch { /* ignore */ }
};

// 计算客户的有效信用额度：初始额度 + 调整记录净额
const getEffectiveCredit = (customerId: string, customerName: string, baseCredit: number, adjustments: CreditAdjustRecord[]): number => {
  const netAdjust = adjustments
    .filter(r => r.customerId === customerId || r.customerName === customerName)
    .reduce((sum, r) => sum + (r.type === 'increase' ? r.amount : -r.amount), 0);
  return Math.round((baseCredit + netAdjust) * 100) / 100;
};

// 客户信息接口
interface CustomerRecord {
  key: string;
  id: string;
  name: string;
  level: string;
  contact: string;
  phone: string;
  region: string;
  credit: number;
  baseCredit?: number; // 原始基础额度（表格数据源中保留，避免被有效额度覆盖后二次叠加）
  status: string;
  date: string;
  type: 'direct' | 'purchaser'; // 直接客户或已合作的采购商
  bindStatus?: string; // 合作状态
  bindDate?: string; // 合作日期（可选）
  salesman?: string; // 业务员
  totalPurchase?: number; // 采购总额(元)：账单明细商品总额合计自动统计
  receivedPayment?: number; // 已收货款(元)：仅手工登记收款合计
  orderOccupied?: number; // 订单占用(元)：未发货的采购商推送/余额支付订单金额合计
  purchaserUsername?: string; // 采购商账号用户名（用于查找企业信息）
  legalPerson?: string; // 法人代表
  wechatQr?: string; // 微信二维码
  businessAddress?: string; // 经营地址
  email?: string; // 电子邮箱
  province?: string; // 省
  city?: string; // 市
  district?: string; // 区
  detailAddress?: string; // 详细地址
  purchaserNo?: string; // 采购商编号（采购商公司编号）
  remark?: string; // 备注（公司简称等）
}

// 绑定的采购商接口
interface BoundPurchaser {
  key: string;
  id: string;
  purchaserName: string;
  purchaserContact: string;
  purchaserPhone: string;
  bindDate: string;
  status: 'approved' | 'terminated' | 'terminating';
  customerId?: string; // 关联的直接客户ID（从邀约合作发起的）
  purchaserUsername?: string; // 采购商账号用户名（用于查找企业信息）
  legalPerson?: string; // 法人代表
  wechatQr?: string; // 微信二维码
  businessAddress?: string; // 经营地址
  email?: string; // 电子邮箱
  province?: string; // 省
  city?: string; // 市
  district?: string; // 区
  detailAddress?: string; // 详细地址
  salesman?: string; // 业务员（无关联客户档案的采购商行独立存储）
  level?: string; // 客户等级（无关联客户档案的采购商行独立存储）
}

// 初始演示数据已下线：生产环境不预置任何测试客户，新客户一律由用户自行录入
const initialCustomers: CustomerRecord[] = [];

// 遗留演示数据 ID（用于一次性清理历史 localStorage 中残留的 mock 数据）
const LEGACY_DEMO_CUSTOMER_IDS = new Set(['CUST-10001', 'CUST-10002', 'CUST-10003', 'CUST-10004', 'CUST-10005']);
const LEGACY_DEMO_BOUND_IDS = new Set(['BIND-001']);
const LEGACY_DEMO_BOUND_NAMES = new Set(['东莞精工制造采购部']);

// 模拟已绑定的采购商数据（已下线）
const initialBoundPurchasers: BoundPurchaser[] = [];

// 数据归属账号：子账号使用主账号的 username，确保数据共享
const getDataOwner = () => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// ============ 付款凭证上传组件（点击或 Ctrl+V 粘贴，自动压缩防止超出存储配额） ============
const ReceiptVoucherUpload: React.FC<{ value?: string; onChange?: (v: string) => void }> = ({ value, onChange }) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const readFile = (file: File) => {
    compressImageFile(file).then(compressed => {
      onChange?.(compressed);
    }).catch(() => message.error('图片处理失败'));
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) readFile(file);
        break;
      }
    }
  };
  return (
    <div onPaste={handlePaste} tabIndex={0} style={{ outline: 'none' }}>
      {value ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img src={value} alt="付款凭证" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid #d9d9d9', cursor: 'pointer' }}
            onClick={() => setPreviewVisible(true)} />
          <CloseCircleOutlined
            style={{ position: 'absolute', top: -6, right: -6, color: '#ff4d4f', fontSize: 16, cursor: 'pointer', background: '#fff', borderRadius: '50%' }}
            onClick={(e) => { e.stopPropagation(); onChange?.(''); }} />
          <Image src={value} style={{ display: 'none' }} preview={{ visible: previewVisible, onVisibleChange: setPreviewVisible, src: value }} />
        </div>
      ) : (
        <div
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = () => { const f = input.files?.[0]; if (f) readFile(f); };
            input.click();
          }}
          style={{ width: 96, height: 96, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#fafafa' }}
        >
          <PictureOutlined style={{ fontSize: 20, color: '#bbb' }} />
          <span style={{ fontSize: 10, color: '#bbb', marginTop: 4 }}>点击或Ctrl+V</span>
        </div>
      )}
    </div>
  );
};

// 从 localStorage 读取当前登录供应商的真实绑定数据（按数据归属账号隔离）
export const loadBoundPurchasersFromStorage = (): BoundPurchaser[] => {
  let bound: BoundPurchaser[] = [];
  try {
    const storageKey = 'boundPurchasers_' + getDataOwner();
    const data = localStorage.getItem(storageKey);
    if (data) {
      const parsed = JSON.parse(data) as BoundPurchaser[];
      if (Array.isArray(parsed)) bound = parsed.filter(b => !LEGACY_DEMO_BOUND_IDS.has(b.id) && !LEGACY_DEMO_BOUND_NAMES.has(b.purchaserName));
    }
  } catch { /* ignore */ }
  // 兜底合并：已批准的合作申请（防止个别批准路径未回写 boundPurchasers 导致客户缺失）
  try {
    const owner = getDataOwner();
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    const me = users.find((u: any) => u.username === owner);
    const myCompany = me?.companyName || owner;
    const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
    if (Array.isArray(apps)) {
      // 已批准解除申请对应的采购商名称
      const terminatedNames = new Set(
        apps
          .filter((a: any) => a.type === 'terminate' && a.status === 'approved' && (a.targetSupplierName === myCompany || a.supplierUsername === owner))
          .map((a: any) => a.purchaserCompanyName || a.purchaserUsername)
      );
      // 已有绑定记录同步解除状态
      bound = bound.map((bp: any) =>
        terminatedNames.has(bp.purchaserName) && bp.status !== 'terminated' ? { ...bp, status: 'terminated' } : bp
      );
      apps.forEach((a: any) => {
        if ((a.type || 'cooperation') !== 'cooperation' || a.status !== 'approved' || a.superseded) return;
        if (!(a.targetSupplierName === myCompany || a.supplierUsername === owner)) return;
        const name = a.purchaserCompanyName || a.purchaserUsername;
        if (!name) return;
        const exists = bound.some((bp: any) => bp.purchaserName === name || (bp.purchaserUsername && bp.purchaserUsername === a.purchaserUsername));
        if (exists) return;
        bound = [...bound, {
          key: `bp-app-${a.applicationId || name}`,
          id: a.customerId || `BIND-${String(a.applicationId || name).slice(-6)}`,
          purchaserName: name,
          purchaserContact: a.purchaserContact || '',
          purchaserPhone: a.purchaserPhone || '',
          bindDate: String(a.approveDate || a.applyDate || '').slice(0, 10),
          status: terminatedNames.has(name) ? 'terminated' : 'approved',
          purchaserUsername: a.purchaserUsername || '',
          salesman: a.salesmanName || '',
          province: (users.find((u: any) => u.username === a.purchaserUsername) as any)?.province || '',
          city: (users.find((u: any) => u.username === a.purchaserUsername) as any)?.city || '',
          district: (users.find((u: any) => u.username === a.purchaserUsername) as any)?.district || '',
          detailAddress: (users.find((u: any) => u.username === a.purchaserUsername) as any)?.detailAddress || '',
        } as BoundPurchaser];
      });
    }
  } catch { /* ignore */ }
  // 二级兜底：扫描采购商平台各 purchaser_suppliers_<账号> 列表，
  // 凡与本公司已建立合作（approved/terminated/terminating）的采购商账号，反向补入已绑定采购商，
  // 保证采购商供应商列表显示已合作时，供应商客户列表必然可见
  try {
    const owner = getDataOwner();
    let users2: any[] = [];
    try { users2 = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    const me2 = users2.find((u: any) => u.username === owner);
    const myCompany2 = me2?.companyName || owner;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('purchaser_suppliers_') !== 0) continue;
      const pUser = k.slice('purchaser_suppliers_'.length);
      if (!pUser || pUser === owner) continue;
      let list: any[] = [];
      try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch { continue; }
      if (!Array.isArray(list)) continue;
      list.forEach((s: any) => {
        if ((s.supplierName || '') !== myCompany2) return;
        const st = s.cooperationStatus || '';
        if (st !== 'approved' && st !== 'terminated' && st !== 'terminating') return;
        const pRec = users2.find((u: any) => u.username === pUser);
        const name = pRec?.companyName || pUser;
        const mappedStatus = st === 'approved' ? 'approved' : st === 'terminating' ? 'terminating' : 'terminated';
        const existIdx = bound.findIndex((bp: any) => bp.purchaserName === name || (bp.purchaserUsername && bp.purchaserUsername === pUser));
        if (existIdx >= 0) {
          // 采购商侧已解除/解除中时同步状态
          if (mappedStatus !== 'approved' && (bound[existIdx] as any).status === 'approved') {
            bound = bound.map((bp, bi) => (bi === existIdx ? { ...bp, status: mappedStatus } as BoundPurchaser : bp));
          }
          return;
        }
        bound = [...bound, {
          key: `bp-ps-${pUser}`,
          id: `BIND-${pUser.slice(-6) || String(Date.now()).slice(-6)}`,
          purchaserName: name,
          purchaserContact: pRec?.contactPerson || '',
          purchaserPhone: pRec?.phone || '',
          bindDate: String(s.cooperationDate || s.addedDate || '').slice(0, 10),
          status: mappedStatus,
          purchaserUsername: pUser,
          province: pRec?.province || '',
          city: pRec?.city || '',
          district: pRec?.district || '',
          detailAddress: pRec?.detailAddress || '',
        } as BoundPurchaser];
      });
    }
  } catch { /* ignore */ }
  if (bound.length > 0) return bound;
  return initialBoundPurchasers; // 无真实数据时用 demo
};

// 采购商发起的终止合作申请是否在途（双向同步显示“解除申请中”）
const hasPendingPurchaserTerminate = (bp: any): boolean => {
  try {
    const apps: any[] = JSON.parse(localStorage.getItem('cooperation_applications') || '[]');
    return apps.some((a: any) =>
      a.type === 'terminate' && a.status === 'pending' && !a.superseded && a.supplierInitiated !== true &&
      (a.purchaserCompanyName === bp.purchaserName || (bp.purchaserUsername && a.purchaserUsername === bp.purchaserUsername)));
  } catch { return false; }
};

// 合并直接客户和已绑定采购商（与客户列表页展示逻辑保持一致）
export const loadAllCustomersFromStorage = (): CustomerRecord[] => {
  const customers = loadCustomersFromStorage();
  const boundPurchasers = loadBoundPurchasersFromStorage();
  const associatedCustomerIds = new Set(
    boundPurchasers.filter(bp => bp.customerId).map(bp => bp.customerId!)
  );
  const directCustomers = customers.filter(c => !associatedCustomerIds.has(c.id));
  const purchaserCustomers: CustomerRecord[] = boundPurchasers.map((bp, i) => {
    const linkedDirect = bp.customerId ? customers.find(c => c.id === bp.customerId) : null;
    const isTerminated = bp.status === 'terminated';
    const isTerminating = bp.status === 'terminating' || hasPendingPurchaserTerminate(bp);
    return {
      key: bp.key || bp.id || `purchaser-key-${i}`,
      id: bp.id,
      name: bp.purchaserName,
      level: (bp as any).level || linkedDirect?.level || 'B',
      contact: bp.purchaserContact || linkedDirect?.contact || '',
      phone: bp.purchaserPhone || linkedDirect?.phone || '',
      region: linkedDirect?.region || '-',
      credit: (bp as any).credit !== undefined && (bp as any).credit !== null ? (bp as any).credit : (linkedDirect?.credit || 0),
      status: isTerminated ? 'terminated' : isTerminating ? 'terminating' : 'completed',
      date: bp.bindDate,
      type: 'purchaser' as const,
      bindStatus: isTerminated ? '已解除合作' : isTerminating ? '解除合作申请中' : '已合作',
      bindDate: bp.bindDate,
      salesman: (bp as any).salesman || linkedDirect?.salesman || '',
      purchaserUsername: bp.purchaserUsername || '',
      legalPerson: bp.legalPerson || '',
      wechatQr: bp.wechatQr || '',
      businessAddress: bp.businessAddress || '',
      email: bp.email || '',
      province: bp.province || linkedDirect?.province || '',
      city: bp.city || linkedDirect?.city || '',
      district: bp.district || linkedDirect?.district || '',
      detailAddress: bp.detailAddress || linkedDirect?.detailAddress || '',
    };
  });
  return [...directCustomers, ...purchaserCustomers];
};

// 采购商编号：优先记录值，其次按客户名称解析注册账号的公司编号
const resolvePurchaserNo = (record: CustomerRecord): string => {
  if (record.purchaserNo) return record.purchaserNo;
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => (x.companyName || '').trim() === (record.name || '').trim());
    if (u?.companyNo) return String(u.companyNo);
    if (u?.companyShortName) return String(u.companyShortName);
  } catch { /* ignore */ }
  return '';
};

// 直接客户 localStorage 持久化 key（按数据归属账号隔离）
const getCustomersStorageKey = () => 'customers_' + getDataOwner();

// 从 localStorage 加载直接客户数据，无数据时用初始模拟数据
export const loadCustomersFromStorage = (): CustomerRecord[] => {
  try {
    const data = localStorage.getItem(getCustomersStorageKey());
    if (data) {
      const parsed = JSON.parse(data) as CustomerRecord[];
      if (parsed.length > 0) return parsed.filter(c => !LEGACY_DEMO_CUSTOMER_IDS.has(c.id));
    }
  } catch { /* ignore */ }
  return initialCustomers;
};

// 显示客户详情弹窗（客户列表页“查看”按钮复用组件）
export const showCustomerDetail = (record: CustomerRecord) => {
  // 从账号信息（右上角）查找该企业的企业信息，记录字段作为备用
  let accountInfo: any = null;
  try {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const name = (record.name || '').trim();
    // 1. 确定采购商账号用户名：优先用记录中的 purchaserUsername，
    //    旧记录没有则通过合作申请记录（cooperation_applications）反查采购商用户名
    let purchaserUsername = record.purchaserUsername || '';
    if (!purchaserUsername && record.type === 'purchaser') {
      try {
        const apps = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
        const matchedApp = apps.find((a: any) =>
          (a.purchaserCompanyName || '').trim() === name || (a.purchaserName || '').trim() === name
        );
        purchaserUsername = matchedApp?.purchaserUsername || '';
      } catch { /* ignore */ }
    }
    // 2. 优先按采购商账号用户名精确查找，其次按公司名称/用户名/邮箱查找
    accountInfo = registeredUsers.find((u: any) => {
      if (purchaserUsername && u.username === purchaserUsername) return true;
      if (name && ((u.companyName || '').trim() === name || (u.username || '').trim() === name)) return true;
      if (record.email && u.email && u.email === record.email) return true;
      return false;
    }) || null;
  } catch { /* ignore */ }
  const legalPerson = accountInfo?.legalPerson || record.legalPerson || '';
  const wechatQr = accountInfo?.wechatQr || record.wechatQr || '';
  const businessAddress = accountInfo?.businessAddress || record.businessAddress || '';
  const email = accountInfo?.email || record.email || '';
  const contactPerson = record.contact || accountInfo?.contactPerson || '';
  const contactPhone = record.phone || accountInfo?.phone || '';
  Modal.info({
    title: '客户详情',
    content: (
      <Descriptions column={2} bordered size="small" style={{ marginTop: 16 }}>
        <Descriptions.Item label="客户编码">{record.id}</Descriptions.Item>
        <Descriptions.Item label="客户类型">
          <Tag color={record.type === 'direct' ? 'blue' : 'green'}>
            {record.type === 'direct' ? '直接客户' : '已绑定采购商'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="客户名称" span={2}>{record.name}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>{record.remark || '-'}</Descriptions.Item>
        <Descriptions.Item label="采购商编号">{resolvePurchaserNo(record) || '-'}</Descriptions.Item>
        <Descriptions.Item label="法人代表">{legalPerson || '-'}</Descriptions.Item>
        <Descriptions.Item label="联系人">{contactPerson || '-'}</Descriptions.Item>
        <Descriptions.Item label="联系电话">{contactPhone || '-'}</Descriptions.Item>
        <Descriptions.Item label="电子邮箱">{email || '-'}</Descriptions.Item>
        <Descriptions.Item label="经营地址" span={2}>{businessAddress || '-'}</Descriptions.Item>
        <Descriptions.Item label="客户地址" span={2}>{[record.province, record.city, record.district].filter(Boolean).join('') || '-'}</Descriptions.Item>
        <Descriptions.Item label="详细地址" span={2}>{record.detailAddress || '-'}</Descriptions.Item>
        <Descriptions.Item label="微信二维码" span={2}>
          {wechatQr ? (
            <img src={wechatQr} alt="微信二维码" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, border: '1px solid #eee' }} />
          ) : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="所在地区">{record.region}</Descriptions.Item>
        <Descriptions.Item label="信用额度">{record.credit}元</Descriptions.Item>
        <Descriptions.Item label="采购总额">{Number(record.totalPurchase) || 0}元</Descriptions.Item>
        <Descriptions.Item label="已收货款">{Number(record.receivedPayment) || 0}元</Descriptions.Item>
        <Descriptions.Item label="应收欠款">
          <Text strong style={{ color: (Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0) > 0 ? '#ff4d4f' : '#52c41a' }}>
            {Math.round(((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) * 100) / 100}元
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="剩余额度">
          <Text strong style={{ color: (Number(record.credit) || 0) - ((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) < 0 ? '#ff4d4f' : '#52c41a' }}>
            {Math.round(((Number(record.credit) || 0) - ((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0))) * 100) / 100}元
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="客户等级">
          <Tag color={record.level === 'vip' ? 'gold' : record.level === 'A' ? 'blue' : 'green'}>
            {record.level.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Badge status="success" text="合作中" />
        </Descriptions.Item>
        {record.bindDate && (
          <Descriptions.Item label="绑定日期" span={2}>{record.bindDate}</Descriptions.Item>
        )}
      </Descriptions>
    ),
    width: 600,
  });
};

const CustomerInfo: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerRecord[]>(loadCustomersFromStorage);
  const [boundPurchasers, setBoundPurchasers] = useState<BoundPurchaser[]>(loadBoundPurchasersFromStorage);
  const [searchText, setSearchText] = useState('');
  const [searchInput, setSearchInput] = useState('');  // 输入框即时值（回车/查询后才应用到 searchText）
  const [codeSearchText, setCodeSearchText] = useState('');  // 客户编号搜索
  const [codeSearchInput, setCodeSearchInput] = useState('');  // 客户编号输入即时值
  const [addressSearchText, setAddressSearchText] = useState('');  // 客户地址搜索
  const [addressSearchInput, setAddressSearchInput] = useState('');  // 客户地址输入即时值
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [salesmanFilter, setSalesmanFilter] = useState<string>('');  // 独立业务员筛选
  const [salesmanPickVisible, setSalesmanPickVisible] = useState(false);  // 业务员选择弹窗
  const [activeTab, setActiveTab] = useState('all');
  const navigate = useNavigate();

  // 表格体动态高度
  const tableCardRef = useRef<HTMLDivElement>(null);
  const [tableBodyHeight, setTableBodyHeight] = useState<number>(() => Math.max(window.innerHeight - 640, 300));
  useEffect(() => {
    const calcHeight = () => {
      if (tableCardRef.current) {
        const card = tableCardRef.current;
        const cardRect = card.getBoundingClientRect();
        const header = card.querySelector('.ant-table-header');
        const pagination = card.querySelector('.ant-pagination');
        const headerH = header ? (header as HTMLElement).offsetHeight : 0;
        const paginationH = pagination ? (pagination as HTMLElement).offsetHeight : 0;
        const h = cardRect.height - headerH - paginationH - 48; // 48px for card body padding
        if (h > 150 && Math.abs(h - tableBodyHeight) > 5) setTableBodyHeight(h);
      }
    };
    const timer = setTimeout(calcHeight, 150);
    const ro = new ResizeObserver(calcHeight);
    if (tableCardRef.current) ro.observe(tableCardRef.current);
    window.addEventListener('resize', calcHeight);
    return () => { clearTimeout(timer); ro.disconnect(); window.removeEventListener('resize', calcHeight); };
  }, [tableBodyHeight]);

  // 新增/编辑客户共用弹窗（editingCustomer 非空时为编辑模式）
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addForm] = Form.useForm();
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);

  // 业务员选择弹窗（账号管理-账号列表）
  const [salesmanSelectVisible, setSalesmanSelectVisible] = useState(false);
  const [salesmanTarget, setSalesmanTarget] = useState<{ mode: 'inline' | 'form'; customerId?: string; customerName?: string }>({ mode: 'inline' });

  // 邀约合作弹窗（生成邀约链接：仅携带公司编号，可勾选绑定负责人）
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteBind, setInviteBind] = useState(false);
  const inviteCompanyNo = useMemo(() => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return String(users.find((u: any) => u.username === getDataOwner())?.companyNo || '');
    } catch { return ''; }
  }, []);
  const inviteLink = useMemo(() => {
    if (!inviteModalVisible || !inviteCompanyNo) return '';
    return buildInviteLink({
      v: 1,
      no: inviteCompanyNo,
      bind: inviteBind ? 1 : 0,
      salesman: localStorage.getItem('username') || '',
      salesmanName: getCurrentUserDisplayName(),
      ts: Date.now(),
      r: Math.random().toString(36).slice(2, 8),
    });
  }, [inviteModalVisible, inviteBind, inviteCompanyNo]);
  const watchCredit = Form.useWatch('credit', addForm);
  const watchTotalPurchase = Form.useWatch('totalPurchase', addForm);
  const watchReceivedPayment = Form.useWatch('receivedPayment', addForm);
  const watchName = Form.useWatch('name', addForm);
  // 弹窗内订单占用：按客户名称实时汇总未发货订单金额
  const watchOrderOccupied = buildOrderOccupiedAmountMap(getDataOwner())[String(watchName || '').trim()] || 0;
  // 省市区级联（预设中国省市区数据）
  const watchProvince = Form.useWatch('province', addForm);
  const watchCity = Form.useWatch('city', addForm);

  // 解除合作弹窗
  const [terminateModalVisible, setTerminateModalVisible] = useState(false);
  const [terminatingCustomer, setTerminatingCustomer] = useState<CustomerRecord | null>(null);

  // 客户收款明细（新增收款登记，持久化到 localStorage）
  const [customerReceipts, setCustomerReceipts] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('customerReceipts_' + getDataOwner()) || '[]'); } catch { return []; }
  });
  // 客户对账单：生成历史与查看弹窗
  const [stmtList, setStmtList] = useState<CustomerStatement[]>(() => {
    try { const l = JSON.parse(localStorage.getItem('customer_statements_' + getDataOwner()) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
  });

  // 截止应收欠款查询：账单明细按需加载 + 客户ID→名称映射（收款台账归属用）
  const [asOfOpen, setAsOfOpen] = useState(false);
  const asOfBills = useMemo<any[]>(() => {
    if (!asOfOpen) return [];
    try { return JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${getDataOwner()}`) || '[]'); } catch { return []; }
  }, [asOfOpen]);
  const asOfIdName = useMemo(() => {
    const m: Record<string, string> = {};
    customers.forEach((c: any) => { m[c.id] = c.name; });
    return m;
  }, [customers]);

  // 对账单企业认证徽章：按客户名称查对应租户账号的认证状态
  const [stmtCert, setStmtCert] = useState<CertInfo | null>(null);
  const [stmtView, setStmtView] = useState<CustomerStatement | null>(null);
  useEffect(() => {
    let alive = true;
    if (!stmtView) { setStmtCert(null); return; }
    const rec = allCustomers.find((c: any) => c.name === stmtView.customerName);
    const un = (rec as any)?.purchaserUsername || '';
    if (!un) { setStmtCert(null); return; }
    fetchCertStatus(un).then(s => { if (alive) setStmtCert(s); });
    return () => { alive = false; };
  }, [stmtView]);
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [receiptCustomer, setReceiptCustomer] = useState<CustomerRecord | null>(null);
  const [receiptAmount, setReceiptAmount] = useState<number | null>(null);
  const [receiptBankKey, setReceiptBankKey] = useState('');
  const [receiptDetailVisible, setReceiptDetailVisible] = useState(false);
  const [receiptDetailCustomer, setReceiptDetailCustomer] = useState<CustomerRecord | null>(null);
  const [receiptDetailSearch, setReceiptDetailSearch] = useState('');  // 收款明细弹窗搜索关键字

  // 存量收款明细一次性回填编号（SK-YYYYMMDD-序号，互不重复）
  useEffect(() => {
    try {
      const key = 'customerReceipts_' + getDataOwner();
      const list: any[] = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(list) || list.length === 0 || !list.some(r => !r.receiptNo)) return;
      const seen = new Set<string>(list.map((r: any) => r.receiptNo).filter(Boolean));
      const final = list.map((r: any, i: number) => {
        if (r.receiptNo) return r;
        const d = String(r.date || '').slice(0, 10).replace(/-/g, '') || dayjs().format('YYYYMMDD');
        let no = `SK-${d}-${String(i + 1).padStart(3, '0')}`;
        while (seen.has(no)) no = `${no}B`;
        seen.add(no);
        return { ...r, receiptNo: no };
      });
      localStorage.setItem(key, JSON.stringify(final));
      setCustomerReceipts(final);
    } catch { /* ignore */ }
  }, []);

  // 信用额度调整
  const [creditAdjustments, setCreditAdjustments] = useState<CreditAdjustRecord[]>(loadCreditAdjustments);
  const [creditAdjustModalVisible, setCreditAdjustModalVisible] = useState(false);
  const [creditAdjustCustomer, setCreditAdjustCustomer] = useState<CustomerRecord | null>(null);
  const [creditAdjustForm] = Form.useForm();
  const [creditAdjustType, setCreditAdjustType] = useState<'increase' | 'decrease'>('increase');
  // 响应式监听调整金额：getFieldValue 不触发重渲染，会导致「调整后有效额度」预览不随输入更新
  const watchAdjustAmount = Form.useWatch('amount', creditAdjustForm);
  // 额度明细弹窗
  const [creditHistoryVisible, setCreditHistoryVisible] = useState(false);
  const [creditHistoryCustomer, setCreditHistoryCustomer] = useState<CustomerRecord | null>(null);
  // 订单占用明细弹窗
  const [occupiedDetailVisible, setOccupiedDetailVisible] = useState(false);
  const [occupiedDetailCustomer, setOccupiedDetailCustomer] = useState<CustomerRecord | null>(null);

  // 页面挂载时始终从服务端拉取额度调整记录并与本地合并（确保服务端数据不丢失）
  useEffect(() => {
    const key = getCreditAdjustKey();
    mergeDatasetFromServer(key).then((mergedJson) => {
      if (mergedJson) {
        try {
          const merged = JSON.parse(mergedJson);
          if (Array.isArray(merged)) {
            setCreditAdjustments(merged);
          }
        } catch { /* ignore */ }
      } else {
        // 服务端不可用，使用本地数据
      }
    });
    // 定时自检：每 30 秒从服务端合并额度数据（确保不丢失）
    const selfCheckInterval = setInterval(() => {
      const key = getCreditAdjustKey();
      mergeDatasetFromServer(key).then((mergedJson) => {
        if (mergedJson) {
          try {
            const merged = JSON.parse(mergedJson);
            if (Array.isArray(merged)) setCreditAdjustments(merged);
          } catch { /* ignore */ }
        }
      });
    }, 30000);
    return () => clearInterval(selfCheckInterval);
  }, []);

  // 数据刷新触发器：递增时强制 useMemo 重新计算（包括采购总额等从 localStorage 读取的字段）
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  // 采购总额/已收货款：增量聚合快照（列表 O(1) 读取，不再每次渲染全量遍历订单/收款台账）
  const [custSummary, setCustSummary] = useState<Record<string, CustomerSummaryEntry>>({});
  const idNameMapRef = useRef<Record<string, string>>({});
  const custNamesRef = useRef<string[]>([]);

  // 获取当前登录供应商的 storage key
  const getStorageKey = () => 'boundPurchasers_' + (localStorage.getItem('username') || '');

  // 从 localStorage 同步已绑定采购商到客户列表（使用合并加载器：存储 + 合作申请兜底 + 采购商侧供应商列表兜底）
  const syncBoundPurchasers = useCallback(() => {
    setBoundPurchasers(loadBoundPurchasersFromStorage());
  }, []);

  // 首次进入页面同步数据
  useEffect(() => {
    syncBoundPurchasers();
  }, [syncBoundPurchasers]);

  // 跨标签页监听：当其他标签页写入当前供应商的 boundPurchasers 时自动刷新
  useEffect(() => {
    const storageKey = getStorageKey();
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        syncBoundPurchasers();
      }
      // 账单明细或订单数据变更时，触发重新计算
      if (e.key?.includes('bill-detail') || e.key?.includes('order-manage')) {
        setDataRefreshKey(k => k + 1);
      }
      // 跨标签页订单变更：一次性单遍历刷新全部客户采购总额快照（仅跨页签写事件触发，非每次渲染）
      if (e.key?.includes('order-manage')) {
        const names = Array.from(new Set([...Object.values(idNameMapRef.current), ...Object.keys(loadCustomerSummary(getDataOwner()))]));
        refreshCustomerPurchase(getDataOwner(), names);
        setCustSummary(loadCustomerSummary(getDataOwner()));
      }
      // 收款台账/快照跨页签变更：重载快照
      if (e.key?.includes('customerReceipts_') || e.key?.includes('customer_pay_summary_')) {
        setCustSummary(loadCustomerSummary(getDataOwner()));
      }
      // 信用额度调整跨页签变更：重载调整记录
      if (e.key?.startsWith('credit_adjustments_')) {
        setCreditAdjustments(loadCreditAdjustments());
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncBoundPurchasers();
        setDataRefreshKey(k => k + 1);
        // 页面重新可见时从服务端合并额度调整记录
        const key = getCreditAdjustKey();
        mergeDatasetFromServer(key).then((mergedJson) => {
          if (mergedJson) {
            try {
              const merged = JSON.parse(mergedJson);
              if (Array.isArray(merged)) setCreditAdjustments(merged);
            } catch { /* ignore */ }
          }
        });
      }
    };
    const handleBoundChange = () => syncBoundPurchasers();
    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('bound-purchasers-changed', handleBoundChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('bound-purchasers-changed', handleBoundChange);
    };
  }, [syncBoundPurchasers]);

  // 监听自定义事件：当在绑定管理页面确认解绑后，自动刷新客户列表
  useEffect(() => {
    const handleUnbindSuccess = () => {
      syncBoundPurchasers();
    };
    window.addEventListener('supplier-unbind-success', handleUnbindSuccess);
    // 监听服务器同步和订单数据变更，触发采购总额重新计算
    const handleSyncOrUpdate = () => {
      setDataRefreshKey(k => k + 1);
      // 从服务端合并额度调整记录
      const key = getCreditAdjustKey();
      mergeDatasetFromServer(key).then((mergedJson) => {
        if (mergedJson) {
          try {
            const merged = JSON.parse(mergedJson);
            if (Array.isArray(merged)) setCreditAdjustments(merged);
          } catch { /* ignore */ }
        }
      });
    };
    window.addEventListener('sync-data-updated', handleSyncOrUpdate);
    return () => {
      window.removeEventListener('supplier-unbind-success', handleUnbindSuccess);
      window.removeEventListener('sync-data-updated', handleSyncOrUpdate);
    };
  }, [syncBoundPurchasers]);

  // 快照维护：客户ID→名称映射 + 一次性迁移构建 + 快照加载；空闲分片巡检防漂移
  useEffect(() => {
    const m: Record<string, string> = {};
    customers.forEach(c => { m[c.id] = c.name; });
    boundPurchasers.forEach(bp => { if (bp.id) m[bp.id] = bp.purchaserName; });
    idNameMapRef.current = m;
    ensureCustomerSummaryBuilt(getDataOwner(), m);
    setCustSummary(loadCustomerSummary(getDataOwner()));
  }, [customers, boundPurchasers]);
  useEffect(() => {
    custNamesRef.current = Array.from(new Set([...Object.values(idNameMapRef.current), ...Object.keys(custSummary)]));
  }, [custSummary, customers, boundPurchasers]);
  useEffect(() => {
    // 空闲分片巡检：每次浏览器空闲校验一个客户的采购总额/已收货款快照，不一致自动修复
    const stopPatrol = startIdlePatrol({
      getNames: () => custNamesRef.current,
      verify: (name) => {
        const f1 = verifyCustomerPurchase(getDataOwner(), [name]);
        const f2 = verifyCustomerSummary(getDataOwner(), [name], idNameMapRef.current);
        if (f1.length || f2.length) setCustSummary(loadCustomerSummary(getDataOwner()));
      },
    });
    return stopPatrol;
  }, []);

  // 合并客户和已绑定采购商的数据（用于显示）
  // 如果采购商关联了 customerId（从直接客户邀约合作），则更新该直接客户为合作采购商类型
  const allCustomers = useMemo(() => {
    // 采购总额/已收货款直接读增量快照（O(1)/行）；快照由写点增量维护 + 巡检自愈
    const sumOf = (name: string) => custSummary[String(name || '').trim()];
    const purchaseOf = (name: string) => toYuan(sumOf(name)?.purchaseTotal || 0);
    const receivedOf = (name: string) => toYuan(sumOf(name)?.receivedTotal || 0);
    // 订单占用：未发货的采购商推送/余额支付订单按客户名称汇总金额
    const occupiedMap = buildOrderOccupiedAmountMap(getDataOwner());
    const occupiedOf = (name: string) => occupiedMap[String(name || '').trim()] || 0;

    // 收集所有已绑定采购商关联的 customerId
    const associatedCustomerIds = new Set(
      boundPurchasers.filter(bp => bp.customerId).map(bp => bp.customerId!)
    );

    // 直接客户列表：过滤掉已升级为合作采购商的条目；采购总额/已收货款按账单明细自动统计；信用额度从独立数据库计算
    const directCustomers = customers
      .filter(c => !associatedCustomerIds.has(c.id))
      .map(c => ({ ...c, baseCredit: Number(c.credit) || 0, credit: getEffectiveCredit(c.id, c.name, Number(c.credit) || 0, creditAdjustments), totalPurchase: purchaseOf(c.name), receivedPayment: receivedOf(c.name), orderOccupied: occupiedOf(c.name) }));

    // 合作采购商列表：优先使用采购商真实信息，若关联了直接客户则补充地区/等级等字段
    const purchaserCustomers: CustomerRecord[] = boundPurchasers.map((bp, i) => {
      const linkedDirect = bp.customerId ? customers.find(c => c.id === bp.customerId) : null;
      const isTerminated = bp.status === 'terminated';
      const isTerminating = bp.status === 'terminating' || hasPendingPurchaserTerminate(bp);
      return {
        key: bp.key || bp.id || `purchaser-key-${i}`,
        id: bp.id,
        name: bp.purchaserName,
        level: (bp as any).level || linkedDirect?.level || 'B',
        contact: bp.purchaserContact || linkedDirect?.contact || '',
        phone: bp.purchaserPhone || linkedDirect?.phone || '',
        region: (bp as any).region || linkedDirect?.region || '-',
        baseCredit: (bp as any).credit !== undefined && (bp as any).credit !== null ? Number((bp as any).credit) || 0 : (Number(linkedDirect?.credit) || 0),
        credit: getEffectiveCredit(bp.id, bp.purchaserName, (bp as any).credit !== undefined && (bp as any).credit !== null ? Number((bp as any).credit) || 0 : (Number(linkedDirect?.credit) || 0), creditAdjustments),
        status: isTerminated ? 'terminated' : isTerminating ? 'terminating' : 'completed',
        date: bp.bindDate,
        type: 'purchaser' as const,
        bindStatus: isTerminated ? '已解除合作' : isTerminating ? '解除合作申请中' : '已合作',
        bindDate: bp.bindDate,
        salesman: (bp as any).salesman || linkedDirect?.salesman || '',
        purchaserUsername: bp.purchaserUsername || '',
        remark: (bp as any).remark || linkedDirect?.remark || '',
        legalPerson: bp.legalPerson || '',
        wechatQr: bp.wechatQr || '',
        businessAddress: bp.businessAddress || '',
        email: bp.email || '',
        province: bp.province || linkedDirect?.province || '',
        city: bp.city || linkedDirect?.city || '',
        district: bp.district || linkedDirect?.district || '',
        detailAddress: bp.detailAddress || linkedDirect?.detailAddress || '',
        totalPurchase: purchaseOf(bp.purchaserName),
        receivedPayment: receivedOf(bp.purchaserName),
        orderOccupied: occupiedOf(bp.purchaserName),
      };
    });
    return [...directCustomers, ...purchaserCustomers];
  }, [customers, boundPurchasers, custSummary, creditAdjustments, dataRefreshKey]);

  // 客户认证状态批量查询（按 purchaserUsername 查）
  const [custCertMap, setCustCertMap] = useState<Record<string, CertInfo>>({});
  useEffect(() => {
    let alive = true;
    const usernames = allCustomers
      .map(c => String((c as any).purchaserUsername || '').trim())
      .filter(Boolean);
    if (!usernames.length) { setCustCertMap({}); return; }
    fetchCertBatch(usernames).then(m => { if (alive) setCustCertMap(m); });
    return () => { alive = false; };
  }, [allCustomers]);

  // 发布本供应商展示的有效信用额度到同步键 published_credit_<owner>，
  // 供采购商跨浏览器只读（与本页「信用额度」列展示值完全一致，避免两端不一致）
  useEffect(() => {
    const owner = getDataOwner();
    const rows = allCustomers.map((c: CustomerRecord) => ({
      customerId: c.id,
      customerName: c.name,
      effective: getEffectiveCredit(c.id, c.name, Number(c.baseCredit) || 0, creditAdjustments),
    }));
    const key = `published_credit_${owner}`;
    const json = JSON.stringify(rows);
    safeSetItem(key, json);
    safeSetItem(`${key}_ts`, String(Date.now()));
    flushDatasetUploadAsync(key, json).catch(() => { /* ignore */ });
  }, [allCustomers, creditAdjustments]);

  // 筛选数据
  const filteredData = useMemo(() => {
    return allCustomers.filter(item => {
      const matchSearch = !searchText ||
        item.name.includes(searchText) ||
        item.contact.includes(searchText) ||
        (item.remark || '').includes(searchText);
      
      const matchCode = !codeSearchText || item.id.toLowerCase().includes(codeSearchText.toLowerCase());
      const matchAddress = !addressSearchText ||
        (item.region || '').includes(addressSearchText) ||
        (item.detailAddress || '').includes(addressSearchText);
      
      const matchLevel = !levelFilter || item.level === levelFilter;
      const matchType = !typeFilter || item.type === typeFilter;
      const matchSalesman = !salesmanFilter || (item.salesman || '') === salesmanFilter;
      
      // Tab筛选
      if (activeTab === 'direct' && item.type !== 'direct') return false;
      if (activeTab === 'purchaser' && item.type !== 'purchaser') return false;
      
      return matchSearch && matchCode && matchAddress && matchLevel && matchType && matchSalesman;
    });
  }, [allCustomers, searchText, codeSearchText, addressSearchText, levelFilter, typeFilter, salesmanFilter, activeTab]);

  // 业务员字段中已存在的业务员去重清单（供筛选弹窗选择）
  const salesmanOptions = useMemo(() => Array.from(new Set(allCustomers.map(c => c.salesman || '').filter(Boolean))), [allCustomers]);

  // 应收欠款总额（当前列表口径：各客户 采购总额-已收货款 之和）
  const totalDebt = useMemo(() => Math.round(filteredData.reduce((s, c) => s + ((Number(c.totalPurchase) || 0) - (Number(c.receivedPayment) || 0)), 0) * 100) / 100, [filteredData]);

  // 解除合作处理
  const handleTerminateCooperation = (record: CustomerRecord) => {
    // 终止条件：应收欠款（采购总额-已收货款）必须为 0 才可发起
    const debt = Math.round(((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) * 100) / 100;
    if (Math.abs(debt) > 0.001) {
      message.error(`客户「${record.name}」应收欠款 ¥${debt.toFixed(2)} 未结清，应收欠款为 0 时才可发起终止合作`);
      return;
    }
    setTerminatingCustomer(record);
    setTerminateModalVisible(true);
  };

  const confirmTerminateCooperation = () => {
    if (!terminatingCustomer) return;
    // 终止条件二次校验：应收欠款必须为 0
    const debt0 = Math.round(((Number(terminatingCustomer.totalPurchase) || 0) - (Number(terminatingCustomer.receivedPayment) || 0)) * 100) / 100;
    if (Math.abs(debt0) > 0.001) {
      message.error(`客户「${terminatingCustomer.name}」应收欠款 ¥${debt0.toFixed(2)} 未结清，应收欠款为 0 时才可发起终止合作`);
      return;
    }
    const storageKey = getStorageKey();
    const supplierUsername = localStorage.getItem('username') || '';
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentSupplier = registeredUsers.find((u: any) => u.username === supplierUsername);
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

    // 1. 查找该采购商的登录用户名（从合作申请记录中反查）
    const apps: any[] = JSON.parse(
      localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
    );
    const cooperationApp = apps.find(
      (app: any) =>
        app.type === 'cooperation' &&
        app.status === 'approved' &&
        app.targetSupplierName === currentSupplier?.companyName &&
        (app.purchaserCompanyName === terminatingCustomer.name || app.purchaserUsername === terminatingCustomer.id)
    );
    const purchaserUsername = cooperationApp?.purchaserUsername || '';

    // 2. 创建解除合作申请（需采购商同意）
    const terminateApp = {
      applicationId: `TERM-${Date.now()}`,
      purchaserUsername,
      purchaserCompanyName: terminatingCustomer.name,
      purchaserCompanyId: terminatingCustomer.id,
      purchaserContact: terminatingCustomer.contact || '',
      purchaserPhone: terminatingCustomer.phone || '',
      targetSupplierName: currentSupplier?.companyName || supplierUsername,
      targetSupplierId: supplierUsername,
      canDirectApprove: false,
      applyDate: now,
      status: 'pending',
      remark: `供应商「${currentSupplier?.companyName || supplierUsername}」申请解除与采购商「${terminatingCustomer.name}」的合作`,
      type: 'terminate' as const,
      supplierInitiated: true,
    };
    apps.push(terminateApp);
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));

    // 3. 更新供应商侧 boundPurchasers 状态为 "解除申请中"
    try {
      const boundData: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = boundData.map((bp) =>
        bp.purchaserName === terminatingCustomer.name
          ? { ...bp, status: 'terminating' as const }
          : bp
      );
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setBoundPurchasers(updated);
    } catch { /* ignore */ }

    // 触发自定义事件，通知合作申请页面刷新
    window.dispatchEvent(new Event('cooperation-applications-changed'));

    setTerminateModalVisible(false);
    setTerminatingCustomer(null);
    message.success(`已向采购商「${terminatingCustomer.name}」发送解除合作申请，等待对方确认`);
  };

  // 撤回解除合作申请（供应商发起方）：申请置 rejected + 本侧 boundPurchasers 回退已合作
  const handleWithdrawTerminate = (record: CustomerRecord) => {
    Modal.confirm({
      title: '撤回解除申请',
      content: `确定撤回与采购商「${record.name}」的终止合作申请吗？撤回后双方恢复为已合作状态。`,
      okText: '确认撤回',
      cancelText: '取消',
      onOk: () => {
        const apps: any[] = JSON.parse(localStorage.getItem('cooperation_applications') || '[]');
        const updated = apps.map((a: any) => (
          a.type === 'terminate' && a.status === 'pending' && !a.superseded && a.supplierInitiated === true &&
          (a.purchaserCompanyName === record.name || (record.purchaserUsername && a.purchaserUsername === record.purchaserUsername))
            ? { ...a, status: 'rejected', remark: `发起方撤回：${a.remark || ''}` }
            : a
        ));
        localStorage.setItem('cooperation_applications', JSON.stringify(updated));
        const storageKey = getStorageKey();
        try {
          const bound: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
          const up = bound.map((bp: any) => (bp.purchaserName === record.name && bp.status === 'terminating' ? { ...bp, status: 'approved' } : bp));
          localStorage.setItem(storageKey, JSON.stringify(up));
          setBoundPurchasers(up);
        } catch { /* ignore */ }
        window.dispatchEvent(new Event('cooperation-applications-changed'));
        message.success('已撤回终止合作申请，合作关系恢复为已合作');
      },
    });
  };

  // PERM_V2 功能点执行点（客户基础信息页）
  const permTick = usePermTick();
  const fnOk = (a: string) => canFn('supplier', 'customer/customer-info', a);

  // 删除客户
  const handleDeleteCustomer = (record: CustomerRecord) => {
    if (!fnOk('delete')) { message.warning('无删除权限'); return; }
    // 应收欠款不为 0 禁止删除（操作列已隐藏删除键，此处为深度防护）
    const debtNow = Math.round(((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) * 100) / 100;
    if (Math.abs(debtNow) > 0.001) {
      message.error(`客户「${record.name}」应收欠款 ¥${debtNow.toFixed(2)} 未结清，不能删除`);
      return;
    }
    // 防误删保护：客户已有订单或账单明细历史记录时禁止删除，避免历史数据失去客户归属
    const owner = getDataOwner();
    let hasHistory = false;
    try {
      const orders: any[] = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]');
      hasHistory = orders.some((o: any) => (o.customerName || '') === record.name);
    } catch { /* ignore */ }
    if (!hasHistory) {
      try {
        const bills: any[] = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${owner}`) || '[]');
        hasHistory = bills.some((b: any) => (b.customerName || b.customer || '') === record.name);
      } catch { /* ignore */ }
    }
    if (hasHistory) {
      message.error(`客户「${record.name}」已存在订单或账单记录，禁止删除（如需停止合作请使用“解除合作”）`);
      return;
    }
    if (record.type === 'purchaser') {
      // 已绑定的采购商：从 boundPurchasers 中移除
      const storageKey = getStorageKey();
      try {
        const boundData = localStorage.getItem(storageKey);
        if (boundData) {
          const boundPurchasers: any[] = JSON.parse(boundData);
          const filtered = boundPurchasers.filter(
            (bp) => bp.purchaserName !== record.name
          );
          localStorage.setItem(storageKey, JSON.stringify(filtered));
          setBoundPurchasers(filtered);
        }
      } catch { /* ignore */ }
    } else {
      // 直接客户：从 customers 中移除并持久化到 localStorage
      const updated = customers.filter((c) => c.id !== record.id);
      setCustomers(updated);
      localStorage.setItem(getCustomersStorageKey(), JSON.stringify(updated));
    }
    message.success(`客户「${record.name}」已删除，历史账单不受影响`);
  };

  // 本公司名称（对账单标题：本公司名称+对账单）
  const ourCompanyName = useMemo(() => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === getDataOwner());
      return u?.companyName || localStorage.getItem('companyName') || getDataOwner();
    } catch { return localStorage.getItem('companyName') || getDataOwner(); }
  }, [getDataOwner]);

  const loadStatements = useCallback((): CustomerStatement[] => {
    try { const l = JSON.parse(localStorage.getItem('customer_statements_' + getDataOwner()) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
  }, [getDataOwner]);

  // 生成对账单：本期区间=（上次生成日期, 今天]（按账单/收款日期归集，首次不限起点）
  const handleGenStatement = (record: CustomerRecord) => {
    const owner = getDataOwner();
    const list = loadStatements();
    const mine = list.filter(s => s.customerId === record.id || s.customerName === record.name);
    const prev = mine.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    const createdAt = new Date().toISOString();
    const today = dayjs().format('YYYY-MM-DD');
    const periodFromDate = prev ? dayjs(prev.createdAt).format('YYYY-MM-DD') : '';
    let billsAll: any[] = [];
    try { billsAll = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${owner}`) || '[]'); } catch { /* ignore */ }
    const bills = billsAll
      .filter((b: any) => (b.customerName || b.customer || '') === record.name)
      .filter((b: any) => {
        const d = String(b.outboundDate || b.date || '');
        if (!d || d > today) return false;
        return !periodFromDate || d > periodFromDate;
      })
      .map((b: any) => ({ billNo: b.outboundNo || b.id || '', date: String(b.outboundDate || b.date || ''), qty: Number(b.totalCount) || 0, amount: Number(b.totalAmount) || 0 }));
    const newPurchaseAmount = Math.round(bills.reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0) * 100) / 100;
    const newPurchaseQty = bills.reduce((s: number, b: any) => s + (Number(b.qty) || 0), 0);
    const receipts = customerReceipts
      .filter((r: any) => ((r.customerId && r.customerId === record.id) || (r.customerName || '') === record.name))
      .filter((r: any) => {
        const d = String(r.date || '');
        if (!d || d > today) return false;
        return !periodFromDate || d > periodFromDate;
      })
      .map((r: any) => ({ receiptNo: r.receiptNo || '-', date: String(r.date || ''), amount: Number(r.amount) || 0 }));
    const newReceiptAmount = Math.round(receipts.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) * 100) / 100;
    const cumulativeDebt = Math.round(((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) * 100) / 100;
    const openingDebt = Math.round((cumulativeDebt - newPurchaseAmount + newReceiptAmount) * 100) / 100;
    const seq = mine.filter(s => dayjs(s.createdAt).format('YYYY-MM-DD') === today).length + 1;
    const stmt: CustomerStatement = {
      key: `stmt-${Date.now()}`,
      no: `DZ-${record.id}-${dayjs().format('YYYYMMDD')}-${String(seq).padStart(2, '0')}`,
      customerId: record.id,
      customerName: record.name,
      createdAt,
      periodFrom: prev?.createdAt || '',
      periodTo: createdAt,
      cumulativeDebt,
      openingDebt,
      newPurchaseAmount,
      newPurchaseQty,
      newReceiptAmount,
      billCount: bills.length,
      bills,
      receipts,
      legalPerson: record.legalPerson || '',
      contactPerson: record.contact || '',
      contactPhone: record.phone || '',
    };
    const next = [...list, stmt];
    if (!safeSetItem(`customer_statements_${owner}`, JSON.stringify(next))) {
      message.error('对账单保存失败（可能存储空间不足），请清理后重试');
      return;
    }
    setStmtList(next);
    setStmtView(stmt);
    message.success(`对账单 ${stmt.no} 已生成，可截图发送沟通群确认`);
  };

  // 填写采购商编号 → 供应商主动发起合作申请，并在采购商平台生成待合作供应商条目
  const sendCooperationToPurchaserByNo = (noRaw: string): 'none' | 'notfound' | 'exists' | 'sent' => {
    const no = String(noRaw || '').trim();
    if (!no) return 'none';
    const myUsername = localStorage.getItem('username') || '';
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const purchaserUser = users.find((u: any) => String(u.companyNo || '') === no || String(u.companyShortName || '') === no);
    if (!purchaserUser) return 'notfound';
    const currentUser = users.find((u: any) => u.username === myUsername);
    const supplierCompany = currentUser?.companyName || myUsername;
    const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
    const exists = apps.some((a: any) => (a.type || 'cooperation') === 'cooperation' && !a.superseded && a.purchaserUsername === purchaserUser.username && a.targetSupplierName === supplierCompany && a.status !== 'rejected');
    if (exists) return 'exists';
    // 作废旧的已批准合作申请
    apps.forEach((a: any) => {
      if (a.purchaserUsername === purchaserUser.username && a.targetSupplierName === supplierCompany && (a.type || 'cooperation') === 'cooperation' && a.status === 'approved') a.superseded = true;
    });
    // 采购商平台供应商列表条目（待合作），已存在则复用
    const pKey = 'purchaser_suppliers_' + purchaserUser.username;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(pKey) || '[]'); } catch { /* ignore */ }
    let entry = list.find((s: any) => s.supplierName === supplierCompany);
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    if (!entry) {
      entry = {
        id: `SP-${Date.now()}`,
        supplierName: supplierCompany,
        shortName: '',
        contactPerson: currentUser?.contactPerson || '',
        contactPhone: currentUser?.phone || '',
        email: currentUser?.email || '',
        cooperationStatus: 'pending',
        addedDate: now,
        remark: '供应商通过采购商编号申请合作',
        // 供应商主动发起标记：随 purchaser_suppliers_ 同步键跨浏览器送达，采购商侧据此显示待审核
        supplierInitiated: true,
        supplierUsername: myUsername,
        supplierInitiatedDate: now,
      };
      list.unshift(entry);
    } else {
      // 复用已有条目：拒绝/终止后重新申请回退待确认，并刷新供应商主动发起标记
      // （cooperation_applications 不参与跨浏览器同步，标记必须落在条目上）
      const idx = list.findIndex((s: any) => s.supplierName === supplierCompany);
      entry = {
        ...entry,
        cooperationStatus: entry.cooperationStatus === 'rejected' || entry.cooperationStatus === 'terminated' ? 'pending' : entry.cooperationStatus,
        supplierInitiated: true,
        supplierUsername: myUsername,
        supplierInitiatedDate: now,
      };
      list[idx] = entry;
    }
    localStorage.setItem(pKey, JSON.stringify(list));
    apps.push({
      applicationId: `COOP-PNO-${Date.now()}`,
      purchaserUsername: purchaserUser.username,
      purchaserCompanyName: purchaserUser.companyName || '',
      purchaserCompanyId: purchaserUser.companyId || '',
      purchaserContact: purchaserUser.contactPerson || '',
      purchaserPhone: purchaserUser.phone || '',
      targetSupplierName: supplierCompany,
      targetSupplierId: entry.id,
      supplierUsername: myUsername,
      canDirectApprove: false,
      applyDate: now,
      status: 'pending',
      remark: `供应商「${supplierCompany}」通过采购商编号 ${no} 申请合作`,
      type: 'cooperation',
      supplierInitiated: true,
    });
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));
    window.dispatchEvent(new Event('cooperation-applications-changed'));
    return 'sent';
  };

  // 新增/编辑客户（共用同一窗口：editingCustomer 非空时保存修改，否则新建）
  const handleAddCustomer = () => {
    if (!fnOk(editingCustomer ? 'edit' : 'add')) { message.warning(editingCustomer ? '无编辑权限' : '无新增权限'); return; }
    addForm.validateFields().then((values) => {
      // 采购商编号查重：编号已在客户列表中存在（直接客户+已绑定采购商，排除编辑自身）则不允许保存
      const pno = String(values.purchaserNo || '').trim();
      if (pno) {
        const dup = loadAllCustomersFromStorage().find((c) => c.id !== (editingCustomer?.id || '') && resolvePurchaserNo(c) === pno);
        if (dup) {
          message.error(`采购商编号 ${pno} 已存在（客户：${dup.name}），不能重复保存`);
          return;
        }
      }
      if (editingCustomer) {
        const updatedCredit = values.credit !== undefined && values.credit !== '' && values.credit !== null
          ? Number(values.credit)
          : (editingCustomer.credit ?? 0);
        const buildUpdates = (old: any) => {
          const newProvince = values.province !== undefined ? values.province : (old.province || '');
          const newCity = values.city !== undefined ? values.city : (old.city || '');
          const newDistrict = values.district !== undefined ? values.district : (old.district || '');
          // 自动同步 region = 省+市+区，确保所在地区列与地址下拉框一致
          const autoRegion = [newProvince, newCity, newDistrict].filter(Boolean).join('') || old.region || '';
          return {
            ...old,
            name: values.name !== undefined && values.name !== '' ? values.name : old.name,
            level: values.level !== undefined && values.level !== '' ? values.level : old.level,
            contact: values.contact !== undefined && values.contact !== '' ? values.contact : old.contact,
            phone: values.phone !== undefined && values.phone !== '' ? values.phone : old.phone,
            region: autoRegion,
            credit: updatedCredit,
            salesman: values.salesman !== undefined && values.salesman !== '' ? values.salesman : old.salesman,
            province: newProvince,
            city: newCity,
            district: newDistrict,
            detailAddress: values.detailAddress !== undefined ? values.detailAddress : (old.detailAddress || ''),
            purchaserNo: values.purchaserNo !== undefined ? values.purchaserNo : (old.purchaserNo || ''),
            remark: values.remark !== undefined ? values.remark : (old.remark || ''),
          };
        };
        // 1. 尝试在直接客户列表中按 id 或 name 匹配并更新
        let found = false;
        let updated = customers.map((c) => {
          if (c.id === editingCustomer.id || c.name === editingCustomer.name) {
            found = true;
            return buildUpdates(c);
          }
          return c;
        });
        // 如果直接客户列表未匹配，从 localStorage 重新加载并尝试
        if (!found) {
          try {
            const stored: any[] = JSON.parse(localStorage.getItem(getCustomersStorageKey()) || '[]');
            const idx = stored.findIndex((c: any) => c.id === editingCustomer.id || c.name === editingCustomer.name);
            if (idx >= 0) {
              stored[idx] = buildUpdates(stored[idx]);
              localStorage.setItem(getCustomersStorageKey(), JSON.stringify(stored));
              updated = stored;
              found = true;
            }
          } catch { /* ignore */ }
        }
        setCustomers(updated);
        const custJson = JSON.stringify(updated);
        localStorage.setItem(getCustomersStorageKey(), custJson);
        saveDataset(getCustomersStorageKey(), custJson);
        // 2. 采购商客户：同步更新 boundPurchasers（按 id 或 name 匹配）
        if (editingCustomer.type === 'purchaser' || !found) {
          const bpKey = 'boundPurchasers_' + getDataOwner();
          try {
            const bound: any[] = JSON.parse(localStorage.getItem(bpKey) || '[]');
            let bpFound = false;
            const updatedBound = bound.map((bp: any) => {
              if (bp.id === editingCustomer.id || bp.purchaserName === editingCustomer.name) {
                bpFound = true;
                return {
                  ...bp,
                  purchaserName: values.name !== undefined && values.name !== '' ? values.name : bp.purchaserName,
                  purchaserContact: values.contact !== undefined && values.contact !== '' ? values.contact : bp.purchaserContact,
                  purchaserPhone: values.phone !== undefined && values.phone !== '' ? values.phone : bp.purchaserPhone,
                  province: values.province !== undefined ? values.province : (bp.province || ''),
                  city: values.city !== undefined ? values.city : (bp.city || ''),
                  district: values.district !== undefined ? values.district : (bp.district || ''),
                  detailAddress: values.detailAddress !== undefined ? values.detailAddress : (bp.detailAddress || ''),
                  credit: updatedCredit,
                  region: [values.province !== undefined ? values.province : (bp.province || ''), values.city !== undefined ? values.city : (bp.city || ''), values.district !== undefined ? values.district : (bp.district || '')].filter(Boolean).join('') || bp.region || '',
                  remark: values.remark !== undefined ? values.remark : (bp.remark || ''),
                };
              }
              return bp;
            });
            if (bpFound) {
              const bpJson = JSON.stringify(updatedBound);
              localStorage.setItem(bpKey, bpJson);
              saveDataset(bpKey, bpJson);
              setBoundPurchasers(updatedBound);
            } else {
              // localStorage 中未找到匹配记录（可能是兜底创建的内存条目），将编辑数据写入主存储
              const newProvince = values.province !== undefined ? values.province : '';
              const newCity = values.city !== undefined ? values.city : '';
              const newDistrict = values.district !== undefined ? values.district : '';
              const newBpEntry = {
                key: `bp-edit-${editingCustomer.id}`,
                id: editingCustomer.id,
                purchaserName: values.name !== undefined && values.name !== '' ? values.name : editingCustomer.name,
                purchaserContact: values.contact !== undefined && values.contact !== '' ? values.contact : (editingCustomer.contact || ''),
                purchaserPhone: values.phone !== undefined && values.phone !== '' ? values.phone : (editingCustomer.phone || ''),
                bindDate: editingCustomer.bindDate || '',
                status: 'approved' as const,
                purchaserUsername: (editingCustomer as any).purchaserUsername || '',
                remark: values.remark !== undefined ? values.remark : ((editingCustomer as any).remark || ''),
                province: newProvince,
                city: newCity,
                district: newDistrict,
                detailAddress: values.detailAddress !== undefined ? values.detailAddress : '',
                credit: updatedCredit,
                region: [newProvince, newCity, newDistrict].filter(Boolean).join(''),
              };
              bound.push(newBpEntry);
              const bpJson = JSON.stringify(bound);
              localStorage.setItem(bpKey, bpJson);
              saveDataset(bpKey, bpJson);
              syncBoundPurchasers();
            }
          } catch { /* ignore */ }
        }
        // 编辑完成后强制重新加载采购商数据，确保地址等字段同步
        if (editingCustomer.type === 'purchaser') syncBoundPurchasers();
        setAddModalVisible(false);
        addForm.resetFields();
        setEditingCustomer(null);
        // 仅当采购商编号有变更时才发送合作申请
        const oldPno = editingCustomer.purchaserNo || resolvePurchaserNo(editingCustomer) || '';
        const newPno = String(values.purchaserNo || '').trim();
        if (newPno && newPno !== oldPno) {
          const resE = sendCooperationToPurchaserByNo(newPno);
          message.success(resE === 'sent' ? '客户信息已更新，合作申请已发送，等待采购商确认' : resE === 'notfound' ? '客户信息已更新，但未找到编号对应的采购商账号，未发起合作申请' : resE === 'exists' ? '客户信息已更新（该采购商的合作申请已存在，等待确认）' : '客户信息已更新');
        } else {
          message.success('客户信息已更新');
        }
        return;
      }
      const newCustomer: CustomerRecord = {
        key: `direct-${Date.now()}`,
        id: `CUST-${Date.now()}`,
        name: values.name,
        level: values.level || 'B',
        contact: values.contact || '',
        phone: values.phone || '',
        region: [values.province, values.city, values.district].filter(Boolean).join('') || values.region || '',
        credit: values.credit !== undefined && values.credit !== '' && values.credit !== null ? Number(values.credit) : 0,
        status: 'completed',
        date: dayjs().format('YYYY-MM-DD'),
        type: 'direct',
        salesman: values.salesman || '',
        province: values.province || '',
        city: values.city || '',
        district: values.district || '',
        detailAddress: values.detailAddress || '',
        purchaserNo: values.purchaserNo || '',
        remark: values.remark || '',
      };
      setCustomers((prev) => {
        const updated = [newCustomer, ...prev];
        localStorage.setItem(getCustomersStorageKey(), JSON.stringify(updated));
        return updated;
      });
      setAddModalVisible(false);
      addForm.resetFields();
      const resA = sendCooperationToPurchaserByNo(values.purchaserNo);
      message.success(resA === 'sent' ? `客户「${values.name}」已添加，合作申请已发送，等待采购商确认` : resA === 'notfound' ? `客户「${values.name}」已添加，但未找到编号对应的采购商账号，未发起合作申请` : resA === 'exists' ? `客户「${values.name}」已添加（该采购商的合作申请已存在，等待确认）` : `客户「${values.name}」已添加，可以点击"邀约合作"按钮邀请采购商合作`);
    });
  };

  // 选择业务员（账号管理-账号列表，显示名称）
  const handlePickSalesman = (displayName: string) => {
    if (salesmanTarget.mode === 'form') {
      addForm.setFieldsValue({ salesman: displayName });
    } else if (salesmanTarget.customerId) {
      const tid = salesmanTarget.customerId;
      const tname = salesmanTarget.customerName || '';
      // 采购商行的业务员实际存于其关联的直接客户档案；无关联时回退按名称匹配
      const linkedId = boundPurchasers.find(b => b.id === tid)?.customerId || '';
      let hit = false;
      const updated = customers.map((c) => {
        if (c.id === tid || (linkedId && c.id === linkedId) || (tname && c.name === tname)) {
          hit = true;
          return { ...c, salesman: displayName };
        }
        return c;
      });
      if (hit) {
        setCustomers(updated);
        localStorage.setItem(getCustomersStorageKey(), JSON.stringify(updated));
        message.success(`业务员已更新为：${displayName}`);
      } else {
        // 无关联/同名客户档案：业务员独立存于绑定采购商记录
        const bpKey = 'boundPurchasers_' + getDataOwner();
        let bpHit = false;
        try {
          const arr: BoundPurchaser[] = JSON.parse(localStorage.getItem(bpKey) || '[]');
          const upd = arr.map(b => {
            if (b.id === tid || (tname && b.purchaserName === tname)) { bpHit = true; return { ...b, salesman: displayName }; }
            return b;
          });
          if (bpHit) {
            localStorage.setItem(bpKey, JSON.stringify(upd));
            setBoundPurchasers(upd);
          }
        } catch { /* ignore */ }
        if (bpHit) message.success(`业务员已更新为：${displayName}`);
        else message.warning('未找到匹配的客户档案，业务员未保存');
      }
    }
    setSalesmanSelectVisible(false);
  };

  // 客户等级行内下拉修改（直接客户写客户档案；采购商行写关联档案或绑定记录）
  const handleChangeLevel = (record: CustomerRecord, v: string) => {
    const tid = record.id;
    const tname = record.name || '';
    const linkedId = boundPurchasers.find(b => b.id === tid)?.customerId || '';
    let hit = false;
    const updated = customers.map((c) => {
      if (c.id === tid || (linkedId && c.id === linkedId) || (tname && c.name === tname)) {
        hit = true;
        return { ...c, level: v };
      }
      return c;
    });
    const label = v === 'vip' ? 'VIP' : `${v}级`;
    if (hit) {
      setCustomers(updated);
      localStorage.setItem(getCustomersStorageKey(), JSON.stringify(updated));
      message.success(`客户等级已更新为：${label}`);
      return;
    }
    const bpKey = 'boundPurchasers_' + getDataOwner();
    let bpHit = false;
    try {
      const arr: BoundPurchaser[] = JSON.parse(localStorage.getItem(bpKey) || '[]');
      const upd = arr.map(b => {
        if (b.id === tid || (tname && b.purchaserName === tname)) { bpHit = true; return { ...b, level: v }; }
        return b;
      });
      if (bpHit) {
        localStorage.setItem(bpKey, JSON.stringify(upd));
        setBoundPurchasers(upd);
      }
    } catch { /* ignore */ }
    if (bpHit) message.success(`客户等级已更新为：${label}`);
    else message.warning('未找到匹配的客户档案，等级未保存');
  };

  // 导出当前列表（CSV，带 BOM 保证 Excel 中文不乱码）
  const handleExport = () => {
    if (!fnOk('export')) { message.warning('无导出权限'); return; }
    if (filteredData.length === 0) { message.warning('当前列表无数据可导出'); return; }
    const levelText = (v: string) => (v === 'vip' ? 'VIP' : v ? `${v}级` : '');
    const headers = ['客户编码', '客户名称', '备注', '采购商编号', '客户类型', '客户等级', '联系人', '联系电话', '所在地区', '客户地址', '详细地址', '信用额度(元)', '采购总额(元)', '已收货款(元)', '应收欠款(元)', '剩余额度(元)', '订单占用(元)', '业务员', '状态', '创建日期'];
    const rows = filteredData.map(c => {
      const debt = Math.round(((Number(c.totalPurchase) || 0) - (Number(c.receivedPayment) || 0)) * 100) / 100;
      const rem = Math.round(((Number(c.credit) || 0) + (Number(c.receivedPayment) || 0) - (Number(c.totalPurchase) || 0) - (Number(c.orderOccupied) || 0)) * 100) / 100;
      return [
        c.id, c.name, c.remark || '-', c.purchaserNo || '-',
        c.type === 'direct' ? '直接客户' : '已合作采购商',
        levelText(c.level), c.contact, c.phone, c.region,
        [c.province, c.city, c.district].filter(Boolean).join(''),
        c.detailAddress,
        Number(c.credit) || 0, Number(c.totalPurchase) || 0, Number(c.receivedPayment) || 0, debt, rem,
        Number(c.orderOccupied) || 0,
        c.salesman || '',
        c.type === 'direct' ? '合作中' : (c.bindStatus || '已合作'),
        c.date,
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `客户基础信息_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${filteredData.length} 条客户记录`);
  };

  // 打开编辑弹窗（复用新增客户窗口，预填客户数据）
  const openEditModal = (record: CustomerRecord) => {
    if (!fnOk('edit')) { message.warning('无编辑权限'); return; }
    setEditingCustomer(record);
    addForm.resetFields();
    // 自动从 region 字段解析省市区（当 province/city/district 未单独存储时）
    let autoProvince = record.province || '';
    let autoCity = record.city || '';
    let autoDistrict = record.district || '';
    if (!autoProvince && record.region) {
      // 从 region 字符串中匹配省市区
      for (const prov of Object.keys(CHINA_REGIONS)) {
        if (record.region.startsWith(prov)) {
          autoProvince = prov;
          const cities = CHINA_REGIONS[prov];
          for (const city of Object.keys(cities)) {
            if (record.region.includes(city)) {
              autoCity = city;
              const districts = cities[city];
              for (const dist of districts) {
                if (record.region.includes(dist)) {
                  autoDistrict = dist;
                  break;
                }
              }
              break;
            }
          }
          break;
        }
      }
    }
    addForm.setFieldsValue({
      name: record.name,
      level: record.level,
      contact: record.contact,
      phone: record.phone,
      region: record.region,
      credit: record.credit,
      totalPurchase: record.totalPurchase || 0,
      receivedPayment: record.receivedPayment || 0,
      salesman: record.salesman || '',
      province: autoProvince,
      city: autoCity,
      district: autoDistrict,
      detailAddress: record.detailAddress || '',
      purchaserNo: record.purchaserNo || resolvePurchaserNo(record) || '',
      remark: record.remark || '',
    });
    setAddModalVisible(true);
  };

  // 邀约合作：弹窗提示（向采购商索要公司编号，填入采购商编号即可申请合作）
  const handleInviteCooperation = (record: CustomerRecord) => {
    Modal.info({
      title: '邀约合作说明',
      width: 520,
      okText: '知道了',
      content: (
        <div style={{ fontSize: 13, lineHeight: '24px' }}>
          <p>可向采购商「{record.name}」索要其<Text strong>公司编号</Text>，在本客户的编辑窗口中填写到<Text strong>「采购商编号」</Text>字段，保存后将自动向该采购商发起合作申请。</p>
          <p>采购商在采购平台「供应商-合作申请」中点击<Text strong>「同意合作」</Text>后，即可建立合作，采购商将自动添加到客户列表中。</p>
        </div>
      ),
    });
  };

  // 复制邀约链接
  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink).then(
      () => message.success('链接已复制到剪贴板'),
      () => message.error('复制失败，请手动复制')
    );
  };

  // 生成随机token
  const generateToken = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  // 查看详情
  const handleView = (record: CustomerRecord) => {
    showCustomerDetail(record);
  };

  // 收款账户下拉选项（财务管理-银行账户列表，可按名称/开户银行/账号/类型检索）
  const getBankAccountOptions = () => {
    let banks: any[] = [];
    try { banks = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${getDataOwner()}`) || '[]'); } catch { /* ignore */ }
    return banks.map((b: any) => {
      const name = b.name || b.accountName || b.id || '';
      const last4 = b.bankAccountNo ? '****' + String(b.bankAccountNo).slice(-4) : '';
      const searchText = `${name} ${b.bankName || ''} ${b.branchName || ''} ${b.bankAccountNo || ''} ${last4} ${b.accountType || ''}`.toLowerCase();
      return {
        value: name,
        searchText,
        label: (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 600 }}>{name || '—'}</span>
            <span style={{ color: '#888' }}>开户银行：{b.bankName || '—'}{b.branchName ? `（${b.branchName}）` : ''}</span>
            <span style={{ color: '#888' }}>尾号：{last4 || '—'}</span>
            <Tag color="blue" style={{ marginRight: 0 }}>{b.accountType || '—'}</Tag>
          </span>
        ),
      };
    });
  };

  // 新增收款：创建待确认记录到收/付申请-收款确认
  const handleSaveReceipt = () => {
    if (!receiptCustomer) return;
    if (!(receiptAmount && receiptAmount > 0)) { message.warning('请输入大于0的收款金额'); return; }
    const owner = getDataOwner();
    const prKey = `payment_requests_${owner}`;
    let prList: any[] = [];
    try { prList = JSON.parse(localStorage.getItem(prKey) || '[]'); } catch { prList = []; }
    const skPrefix = `SK${dayjs().format('YYYYMMDD')}`;
    const seqs = prList.filter((r: any) => r.requestNo?.startsWith(skPrefix)).map((r: any) => parseInt(String(r.requestNo).slice(-3), 10) || 0);
    const requestNo = `${skPrefix}${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`;
    const rec = {
      key: `recvreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo,
      amount: Number(receiptAmount),
      category: '收款',
      description: `客户${receiptCustomer.name}收款`,
      recvType: 'bank',
      recvAccountName: receiptCustomer.name,
      source: 'manual',
      status: 'pending_confirm',
      recordType: 'receipt',
      payerName: receiptCustomer.name,
      customerId: receiptCustomer.id || '',
      recvBankKey: receiptBankKey || undefined,
      applicant: localStorage.getItem('username') || '',
      applicantName: (() => { try { const un = localStorage.getItem('username') || ''; const u = (JSON.parse(localStorage.getItem('registeredUsers') || '[]') as any[]).find((x: any) => x.username === un); return u?.displayName || u?.contactPerson || u?.name || un || '—'; } catch { return '—'; } })(),
      applyDate: dayjs().format('YYYY-MM-DD'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    prList.unshift(rec);
    try { localStorage.setItem(prKey, JSON.stringify(prList)); } catch { /* ignore */ }
    setReceiptModalVisible(false);
    setReceiptAmount(null);
    setReceiptBankKey('');
    setReceiptCustomer(null);
    message.success('收款已提交到「收/付申请 - 收款确认」，确认到账后将自动写入银行明细、已收货款及记账');
  };
  
  // 信用额度调整：保存后更新客户信用额度
  const handleCreditAdjust = () => {
    creditAdjustForm.validateFields().then((values) => {
      if (!creditAdjustCustomer) return;
      const amount = Number(values.amount) || 0;
      if (amount <= 0) { message.warning('请输入大于0的金额'); return; }

      // 从独立数据库计算当前有效额度（baseCredit 保留原始基础额度，避免叠加已含调整的有效额度）
      // 注意：表格数据源会把 credit 覆盖为「有效额度」，故 baseCredit 已定义时绝不可回退用 credit，否则调整净额被二次叠加
      const baseCredit = creditAdjustCustomer.baseCredit !== undefined && creditAdjustCustomer.baseCredit !== null
        ? Number(creditAdjustCustomer.baseCredit) || 0
        : Number(creditAdjustCustomer.credit) || 0;
      const currentCredit = getEffectiveCredit(creditAdjustCustomer.id, creditAdjustCustomer.name, baseCredit, creditAdjustments);
      const newCredit = creditAdjustType === 'increase'
        ? Math.round((currentCredit + amount) * 100) / 100
        : Math.round((currentCredit - amount) * 100) / 100;

      // 获取当前操作人
      const username = localStorage.getItem('username') || '';

      // 追加调整记录到独立数据库
      const newRecord: CreditAdjustRecord = {
        key: `CA-${Date.now()}`,
        customerId: creditAdjustCustomer.id,
        customerName: creditAdjustCustomer.name,
        type: creditAdjustType,
        amount,
        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        remark: values.remark || '',
        operator: username,
      };
      const updatedRecords = [...creditAdjustments, newRecord];
      setCreditAdjustments(updatedRecords);
      saveCreditAdjustments(updatedRecords);

      setCreditAdjustModalVisible(false);
      creditAdjustForm.resetFields();
      setCreditAdjustCustomer(null);
      setCreditAdjustType('increase');
      message.success(`信用额度已${creditAdjustType === 'increase' ? '增加' : '削减'}，新额度：¥${newCredit}`);
    });
  };
  
  // 列标题 + "?"功能说明图标
  const headerWithTip = (label: string, tip: string) => (
    <span>
      {label}
      <Tooltip title={tip}>
        <QuestionCircleOutlined style={{ marginLeft: 4, color: '#8c8c8c', cursor: 'help' }} />
      </Tooltip>
    </span>
  );
  
  // 等级颜色映射
  const levelColorMap: Record<string, string> = {
    vip: 'gold',
    A: 'blue',
    B: 'green',
    C: 'default',
  };

  // 表格列定义
  const columns: ColumnsType<CustomerRecord> = [
    { title: '客户编码', dataIndex: 'id', key: 'id', width: 120 },
        {
          title: '客户名称', dataIndex: 'name', key: 'name', width: 220,
          render: (text: string, record: CustomerRecord) => {
            const un = String((record as any).purchaserUsername || '').trim();
            const certInfo = un ? custCertMap[un] : undefined;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span>{text}</span>
                {certInfo !== undefined && <CertBadge info={certInfo} />}
                {record.type === 'direct' && (
                  <Tooltip title="发送合作申请给该客户">
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, fontSize: 12, color: '#1890ff', height: 'auto' }}
                      onClick={() => handleInviteCooperation(record)}
                    >
                      邀约
                    </Button>
                  </Tooltip>
                )}
              </div>
            );
          },
        },
        {
          title: '备注', dataIndex: 'remark', key: 'remark', width: 120, ellipsis: true,
          render: (text: string) => text ? <Tooltip title={text}><span>{text}</span></Tooltip> : '-',
        },
    {
      title: '采购商编号',
      key: 'purchaserNo',
      width: 110,
      render: (_: unknown, record: CustomerRecord) => {
        const no = resolvePurchaserNo(record);
        return no ? <Tag color="blue">{no}</Tag> : '-';
      },
    },
    {
      title: '客户类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string, record) => {
        if (type === 'direct') {
          return <Tag color="blue">直接客户</Tag>;
        }
        if (record.bindStatus === '已解除合作') {
          return <Tag color="orange">合作过</Tag>;
        }
        return <Tag color="green">已合作采购商</Tag>;
      },
    },
    {
      title: '客户等级',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: string, record: CustomerRecord) => (
        <Select
          size="small"
          bordered={false}
          value={level || undefined}
          placeholder="—"
          style={{ width: '100%' }}
          popupMatchSelectWidth={false}
          onChange={v => handleChangeLevel(record, v)}
          options={['vip', 'A', 'B', 'C'].map(v => ({
            value: v,
            label: <Tag color={levelColorMap[v] || 'default'} style={{ marginRight: 0 }}>{v === 'vip' ? 'VIP' : v}</Tag>,
          }))}
        />
      ),
    },
    { title: '联系人', dataIndex: 'contact', key: 'contact', width: 100 },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 130 },
    {
      title: '所在地区', dataIndex: 'region', key: 'region', width: 100,
      render: (_: unknown, record: CustomerRecord) => {
        if (record.city) return record.city;
        const region = record.region || '';
        if (!region) return '-';
        for (const prov of Object.keys(CHINA_REGIONS)) {
          if (region.startsWith(prov)) {
            for (const city of Object.keys(CHINA_REGIONS[prov])) {
              if (region.includes(city)) return city;
            }
          }
        }
        return region;
      },
    },
    {
      title: '客户地址', key: 'customerAddress', width: 160, ellipsis: true,
      render: (_: unknown, record: CustomerRecord) => {
        const addr = [record.province, record.city, record.district].filter(Boolean).join('');
        return addr ? <Tooltip title={addr}><Text ellipsis style={{ maxWidth: 140 }}>{addr}</Text></Tooltip> : '-';
      },
    },
    {
      title: '详细地址', dataIndex: 'detailAddress', key: 'detailAddress', width: 180, ellipsis: true,
      render: (text: string) => text ? <Tooltip title={text}><Text ellipsis style={{ maxWidth: 160 }}>{text}</Text></Tooltip> : '-',
    },
        {
          title: headerWithTip('信用额度(元)', '有效额度 = 基础额度 + 增加调整 - 削减调整，点击额度数字可查看调整明细'),
          dataIndex: 'credit', key: 'credit', width: 150, align: 'right',
          render: (v: number, record: CustomerRecord) => {
            const effective = getEffectiveCredit(record.id, record.name, Number(record.baseCredit) || 0, creditAdjustments);
            return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              <Tooltip title="点击查看额度调整明细">
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, fontSize: 13, fontWeight: 600, color: '#722ed1', height: 'auto' }}
                  onClick={() => { setCreditHistoryCustomer(record); setCreditHistoryVisible(true); }}
                >
                  {effective}
                </Button>
              </Tooltip>
              <Tooltip title="增加或削减该客户的信用额度">
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, fontSize: 12, color: '#722ed1', height: 'auto' }}
                  icon={<WalletOutlined />}
                  onClick={() => {
                    setCreditAdjustCustomer(record);
                    creditAdjustForm.resetFields();
                    setCreditAdjustType('increase');
                    setCreditAdjustModalVisible(true);
                  }}
                >
                  调整额度
                </Button>
              </Tooltip>
            </div>
            );
          },
        },
    { title: headerWithTip('采购总额(元)', '按客户名称自动汇总：账单明细中余额支付订单的商品总额合计；账单未生成时按余额支付订单（排除待付款）统计'), dataIndex: 'totalPurchase', key: 'totalPurchase', width: 120, align: 'right', render: (v: number) => (Number(v) || 0) },
    {
      title: headerWithTip('已收货款(元)', '该客户手工登记的收款合计；点击列内“明细”可查看收款记录'), dataIndex: 'receivedPayment', key: 'receivedPayment', width: 140, align: 'right',
      render: (v: number, record: CustomerRecord) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
          <span>{Number(v) || 0}</span>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12, height: 'auto' }}
            onClick={() => { setReceiptDetailCustomer(record); setReceiptDetailSearch(''); setReceiptDetailVisible(true); }}>明细</Button>
        </div>
      ),
    },
    {
      title: headerWithTip('应收欠款(元)', '应收欠款 = 采购总额 - 已收货款；大于 0 显示红色，小于等于 0 显示绿色'), key: 'receivableDebt', width: 120, align: 'right',
      render: (_: unknown, record: CustomerRecord) => {
        const debt = Math.round(((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) * 100) / 100;
        return <Text strong style={{ color: debt > 0 ? '#ff4d4f' : '#52c41a' }}>{debt}</Text>;
      },
    },
    {
      title: headerWithTip('剩余额度(元)', '剩余额度 = 信用额度 + 已收货款 - 采购金额 - 订单占用；为负数（红色）时表示超出可用额度'), key: 'remainingCredit', width: 120, align: 'right',
      render: (_: unknown, record: CustomerRecord) => {
        const rem = Math.round(((Number(record.credit) || 0) + (Number(record.receivedPayment) || 0) - (Number(record.totalPurchase) || 0) - (Number(record.orderOccupied) || 0)) * 100) / 100;
        return <Text strong style={{ color: rem < 0 ? '#ff4d4f' : '#52c41a' }}>{rem}</Text>;
      },
    },
    {
      title: headerWithTip('订单占用(元)', '未发货完成的余额支付订单金额合计：采购商推送选余额支付的未发货订单 + 订单管理手工新增选余额支付的未发货订单；点击可查看占用订单明细'),
      dataIndex: 'orderOccupied', key: 'orderOccupied', width: 120, align: 'right',
      render: (v: number, record: CustomerRecord) => (
        <Tooltip title="点击查看占用订单明细">
          <Button type="link" size="small"
            style={{ padding: 0, fontSize: 13, fontWeight: 600, color: (Number(v) || 0) > 0 ? '#fa8c16' : '#999', height: 'auto' }}
            onClick={() => { setOccupiedDetailCustomer(record); setOccupiedDetailVisible(true); }}>
            {Number(v) || 0}
          </Button>
        </Tooltip>
      ),
    },
    {
      title: '业务员',
      dataIndex: 'salesman',
      key: 'salesman',
      width: 120,
      render: (text: string, record: CustomerRecord) => (
        <Input
          size="small"
          value={text || ''}
          placeholder="选择业务员"
          readOnly
          style={{ width: 100, fontSize: 12, cursor: 'pointer' }}
          onClick={() => { setSalesmanTarget({ mode: 'inline', customerId: record.id, customerName: record.name }); setSalesmanSelectVisible(true); }}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (_: string, record) => {
        if (record.type === 'purchaser') {
          if (record.bindStatus === '已解除合作') return <Badge status="warning" text="已解除合作" />;
          if (record.bindStatus === '解除合作申请中') return <Badge status="processing" text="解除申请中" />;
          return <Badge status="success" text="已合作" />;
        }
        return <Badge status="success" text="合作中" />;
      },
    },
    { title: '创建日期', dataIndex: 'date', key: 'date', width: 110 },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, record) => {
        // 应收欠款不为 0 时隐藏删除键，不能删除对应客户
        const debt = Math.round(((Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0)) * 100) / 100;
        const hasDebt = Math.abs(debt) > 0.001;
        return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 2px' }}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Button type="link" size="small" icon={<DollarOutlined />} style={{ color: '#52c41a' }}
            onClick={() => { setReceiptCustomer(record); setReceiptAmount(null); setReceiptBankKey(''); setReceiptModalVisible(true); }}>
            新增收款
          </Button>
          <Button type="link" size="small" onClick={() => navigate(`/customer/price-strategy?customer=${encodeURIComponent(record.id)}`)}>
            价格策略
          </Button>
          <Tooltip title="查看该客户的历史对账单">
            <Button type="link" size="small" icon={<FileTextOutlined />} style={{ color: '#722ed1' }} onClick={() => {
              const mine = stmtList.filter(s => s.customerId === record.id || s.customerName === record.name);
              if (!mine.length) {
                // 无历史对账单：构造空对账单占位对象，弹窗内可通过「生成对账单」按键生成
                setStmtView({
                  key: `draft-${record.id}-${Date.now()}`,
                  no: '',
                  customerId: record.id,
                  customerName: record.name,
                  createdAt: new Date().toISOString(),
                  periodFrom: '',
                  periodTo: dayjs().format('YYYY-MM-DD'),
                  cumulativeDebt: (Number(record.totalPurchase) || 0) - (Number(record.receivedPayment) || 0),
                  openingDebt: 0,
                  newPurchaseAmount: 0,
                  newPurchaseQty: 0,
                  newReceiptAmount: 0,
                  billCount: 0,
                  bills: [],
                  receipts: [],
                  legalPerson: record.legalPerson || '',
                  contactPerson: record.contact || '',
                  contactPhone: record.phone || '',
                });
                return;
              }
              const latest = mine.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
              setStmtView(latest);
            }}>
              查看对账单
            </Button>
          </Tooltip>
          {record.type === 'purchaser' && record.bindStatus === '已合作' && (
            <Button
              type="link"
              size="small"
              danger
              icon={<DisconnectOutlined />}
              onClick={() => handleTerminateCooperation(record)}
            >
              解除合作
            </Button>
          )}
          {record.type === 'purchaser' && record.bindStatus === '解除合作申请中' && (
            <>
              <Button type="link" size="small" disabled icon={<DisconnectOutlined />}>解除申请中</Button>
              {!hasPendingPurchaserTerminate(record) && (
                <Button type="link" size="small" style={{ color: '#faad14' }} onClick={() => handleWithdrawTerminate(record)}>撤回解除申请</Button>
              )}
            </>
          )}
          {record.type === 'purchaser' && record.bindStatus === '已解除合作' && (
            <Button
              type="link"
              size="small"
              style={{ color: '#1890ff' }}
              icon={<LinkOutlined />}
              onClick={() => handleInviteCooperation(record)}
            >
              重新合作
            </Button>
          )}
          {/* 应收欠款不为 0 或未解除合作的采购商不允许删除 */}
          {hasDebt ? null : record.type === 'purchaser' && (record.bindStatus === '已合作' || record.bindStatus === '解除合作申请中') ? null : (
            <Popconfirm
              title="确定删除该客户？"
              description="删除后该客户将从列表中移除，历史账单不受影响。"
              onConfirm={() => handleDeleteCustomer(record)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Tabs筛选 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '8px 24px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
          <Tabs
            className="ci-tabs-compact"
            activeKey={activeTab}
            onChange={setActiveTab}
            style={{ marginBottom: 0 }}
            items={[
              { key: 'all', label: `全部客户 (${allCustomers.length})` },
              { key: 'direct', label: `直接客户 (${customers.length})` },
              { key: 'purchaser', label: `已绑定采购商 (${boundPurchasers.length})` },
            ]}
          />
          <div style={{ fontSize: 13, height: 34, display: 'flex', alignItems: 'center' }}>
            应收欠款总额：
            <Text strong style={{ color: totalDebt > 0 ? '#ff4d4f' : '#52c41a', fontSize: 16 }}>
              ¥{totalDebt.toFixed(2)}
            </Text>
          </div>
        </div>
      </Card>

      {/* 搜索筛选 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', alignItems: 'center' }}>
            <Input
              placeholder="客户编号"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={codeSearchInput}
              onChange={e => setCodeSearchInput(e.target.value)}
              onPressEnter={() => setCodeSearchText(codeSearchInput.trim())}
              allowClear
              onClear={() => { setCodeSearchInput(''); setCodeSearchText(''); }}
              style={{ width: 170 }}
            />
            <Input
              placeholder="名称/联系人/备注"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onPressEnter={() => setSearchText(searchInput.trim())}
              allowClear
              onClear={() => { setSearchInput(''); setSearchText(''); }}
              style={{ width: 200 }}
            />
            <Input
              placeholder="客户地址"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={addressSearchInput}
              onChange={e => setAddressSearchInput(e.target.value)}
              onPressEnter={() => setAddressSearchText(addressSearchInput.trim())}
              allowClear
              onClear={() => { setAddressSearchInput(''); setAddressSearchText(''); }}
              style={{ width: 170 }}
            />
            <Input
              placeholder="业务员"
              readOnly
              value={salesmanFilter}
              suffix={salesmanFilter ? <CloseCircleOutlined style={{ color: '#bfbfbf' }} onClick={(e) => { e.stopPropagation(); setSalesmanFilter(''); }} /> : <UserOutlined style={{ color: '#bfbfbf' }} />}
              onClick={() => setSalesmanPickVisible(true)}
              style={{ width: 150, cursor: 'pointer' }}
            />
            <Select
              placeholder="客户等级"
              value={levelFilter || undefined}
              onChange={v => setLevelFilter(v || '')}
              allowClear
              style={{ width: 120 }}
            >
              <Option value="vip">VIP</Option>
              <Option value="A">A级</Option>
              <Option value="B">B级</Option>
              <Option value="C">C级</Option>
            </Select>
            <Select
              placeholder="客户类型"
              value={typeFilter || undefined}
              onChange={v => setTypeFilter(v || '')}
              allowClear
              style={{ width: 140 }}
            >
              <Option value="direct">直接客户</Option>
              <Option value="purchaser">已绑定采购商</Option>
            </Select>
            <Space size={8} wrap>
              <Button type="primary" icon={<SearchOutlined />} onClick={() => { setSearchText(searchInput.trim()); setCodeSearchText(codeSearchInput.trim()); setAddressSearchText(addressSearchInput.trim()); }}>查询</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setSearchInput(''); setSearchText(''); setCodeSearchInput(''); setCodeSearchText(''); setAddressSearchInput(''); setAddressSearchText(''); setLevelFilter(''); setTypeFilter(''); setSalesmanFilter(''); }}>
                重置
              </Button>
              <Button icon={<ExportOutlined />} onClick={handleExport} hidden={!fnOk('export')}>导出</Button>
              <Button icon={<CalendarOutlined />} onClick={() => setAsOfOpen(true)}>截止应收欠款</Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingCustomer(null);
                  addForm.resetFields();
                  setAddModalVisible(true);
                }}
              >
                新增客户
              </Button>
              <Button icon={<LinkOutlined />} onClick={() => { setInviteBind(false); setInviteModalVisible(true); }}>
                邀约合作
              </Button>
            </Space>
        </div>
      </Card>

      {/* 数据表格 */}
      <Card ref={tableCardRef} bodyStyle={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Table
          bordered
          columns={columns}
          dataSource={filteredData}
          scroll={{ x: 1400, y: tableBodyHeight }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
          }}
          locale={{ emptyText: '暂无客户数据' }}
        />
      </Card>

      {/* 邀约合作弹窗（生成邀约链接：仅携带公司编号，可勾选绑定负责人） */}
      <Modal
        title={<span><LinkOutlined style={{ marginRight: 8, color: '#1890ff' }} />邀约采购商合作</span>}
        open={inviteModalVisible}
        onCancel={() => setInviteModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setInviteModalVisible(false)}>关闭</Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            disabled={!inviteLink}
            onClick={() => {
              navigator.clipboard.writeText(inviteLink).then(
                () => message.success('邀约链接已复制到剪贴板'),
                () => message.error('复制失败，请手动复制'),
              );
            }}
          >
            复制链接
          </Button>,
        ]}
        width={560}
      >
        <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
          <Checkbox checked={inviteBind} onChange={(e) => setInviteBind(e.target.checked)}>
            绑定负责人（勾选后合作建立时默认绑定本账户「{getCurrentUserDisplayName()}」）
          </Checkbox>
          <Alert
            type="info"
            showIcon
            message={
              inviteLink
                ? `链接仅携带本公司编号「${inviteCompanyNo}」，不携带公司账户；采购商打开后进入供应商列表页，确认邀约信息并点击「同意合作」即立即建立合作。`
                : '当前账户未设置公司编号，无法生成邀约链接，请先在注册信息中完善公司编号'
            }
          />
          <Input.TextArea readOnly value={inviteLink} rows={3} style={{ fontSize: 12 }} />
        </Space>
      </Modal>

      {/* 新增/编辑客户共用弹窗 */}
      <Modal
        title={<span>{editingCustomer ? <EditOutlined style={{ marginRight: 8 }} /> : <PlusOutlined style={{ marginRight: 8 }} />}{editingCustomer ? `编辑客户 — ${editingCustomer.name}` : '新增客户'}</span>}
        open={addModalVisible}
        onCancel={() => { setAddModalVisible(false); addForm.resetFields(); setEditingCustomer(null); }}
        onOk={handleAddCustomer}
        okText={editingCustomer ? '保存修改' : '确认添加'}
        cancelText="取消"
        width={560}
      >
        <Form form={addForm} layout="vertical" style={{ marginTop: 16 }} autoComplete="off">
          <Form.Item
            name="name"
            label="客户名称"
            rules={[{ required: true, message: '请输入客户名称' }]}
          >
            <Input placeholder="请输入客户企业名称" autoComplete="off" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="purchaserNo"
                label={
                  <span>
                    采购商编号&nbsp;
                    <Tooltip title="填写采购商编号可以申请合作">
                      <InfoCircleOutlined style={{ color: '#faad14' }} />
                    </Tooltip>
                  </span>
                }
              >
                <Input placeholder="采购商公司编号（选填）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="level" label="客户等级" initialValue="B">
                <Select>
                  <Option value="vip">VIP</Option>
                  <Option value="A">A级</Option>
                  <Option value="B">B级</Option>
                  <Option value="C">C级</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="备注" extra="可填写公司简称等备注信息">
            <Input placeholder="公司简称或其他备注（选填）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contact" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="region" label="所在地区">
                <Input placeholder="所在地区" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="credit" label="信用额度(元)" extra="信用额度请通过操作列的“新增额度”按钮调整">
                <Input type="number" placeholder="信用额度" disabled style={{ color: '#000' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="totalPurchase" label="采购总额(元)" extra="自动统计：账单明细中该客户商品总额合计">
                <Input disabled placeholder="自动统计" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="receivedPayment" label="已收货款(元)" extra="自动统计：手工登记收款合计">
                <Input disabled placeholder="自动统计" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="应收欠款(元)">
                <Input disabled value={String(Math.round(((Number(watchTotalPurchase) || 0) - (Number(watchReceivedPayment) || 0)) * 100) / 100)} style={{ color: (Number(watchTotalPurchase) || 0) - (Number(watchReceivedPayment) || 0) > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 600 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="剩余额度(元)">
                <Input disabled value={String(Math.round(((Number(watchCredit) || 0) + (Number(watchReceivedPayment) || 0) - (Number(watchTotalPurchase) || 0) - (Number(watchOrderOccupied) || 0)) * 100) / 100)} style={{ color: (Number(watchCredit) || 0) + (Number(watchReceivedPayment) || 0) - (Number(watchTotalPurchase) || 0) - (Number(watchOrderOccupied) || 0) < 0 ? '#ff4d4f' : '#52c41a', fontWeight: 600 }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="province" label="省">
                <Select placeholder="省份" allowClear showSearch options={getProvinceOptions()}
                  onChange={() => addForm.setFieldsValue({ city: undefined, district: undefined })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="city" label="市">
                <Select placeholder="城市" allowClear showSearch options={getCityOptions(watchProvince)}
                  onChange={() => addForm.setFieldsValue({ district: undefined })} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="district" label="区">
                <Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(watchProvince, watchCity)} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="detailAddress" label="详细地址">
            <Input placeholder="街道、楼牌号等详细地址" />
          </Form.Item>
          <Form.Item name="salesman" label="业务员">
            <Input placeholder="点击选择业务员（账号列表）" readOnly style={{ cursor: 'pointer' }}
              onClick={() => { setSalesmanTarget({ mode: 'form' }); setSalesmanSelectVisible(true); }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 业务员选择弹窗（账号管理-账号列表） */}
      <Modal
        title={<span><UserOutlined style={{ marginRight: 8 }} />选择业务员 — 账号列表</span>}
        open={salesmanSelectVisible}
        onCancel={() => setSalesmanSelectVisible(false)}
        footer={null}
        width={440}
        destroyOnClose
      >
        {(() => {
          // 租户隔离：仅显示本公司成员账号（主账号 + 归属子账号），不混入其他租户
          const users = loadTenantUsers();
          if (users.length === 0) return <Empty description="本公司暂无成员账号，请先在账号管理-账号列表中添加子账号" />;
          return (
            <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {users.map((u: any) => {
                const displayName = u.contactPerson || u.companyName || u.username;
                return (
                  <div
                    key={u.username}
                    onClick={() => handlePickSalesman(displayName)}
                    style={{ padding: '8px 12px', border: '1px solid #e8e8e8', borderRadius: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}
                  >
                    <Text strong style={{ fontSize: 13 }}>{displayName}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>账号：{u.username}</Text>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Modal>

      {/* 业务员筛选选择弹窗（仅列出现有业务员字段中已存在的业务员） */}
      <Modal
        title="选择业务员"
        open={salesmanPickVisible}
        onCancel={() => setSalesmanPickVisible(false)}
        footer={null}
        width={360}
        destroyOnClose
      >
        {salesmanOptions.length === 0 ? (
          <Empty description="暂无业务员记录" />
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {salesmanOptions.map(n => (
              <div
                key={n}
                onClick={() => { setSalesmanFilter(n); setSalesmanPickVisible(false); }}
                style={{ padding: '8px 12px', border: '1px solid #e8e8e8', borderRadius: 6, cursor: 'pointer', background: salesmanFilter === n ? '#e6f4ff' : '#fff' }}
              >
                <Text strong style={{ fontSize: 13 }}>{n}</Text>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 解除合作确认弹窗 */}
      <Modal
        title={<span><DisconnectOutlined style={{ marginRight: 8, color: '#ff4d4f' }} />解除合作确认</span>}
        open={terminateModalVisible}
        onCancel={() => { setTerminateModalVisible(false); setTerminatingCustomer(null); }}
        onOk={confirmTerminateCooperation}
        okText="确认解除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={420}
      >
        <p style={{ fontSize: 15, margin: '16px 0 8px' }}>
          确定要解除与 <strong>「{terminatingCustomer?.name}」</strong> 的合作关系吗？
        </p>
        <p style={{ color: '#999', fontSize: 13 }}>解除后该采购商将从客户列表中移除，历史合作记录不受影响。</p>
      </Modal>

      {/* 新增收款弹窗 */}
      <Modal
        title={<span><DollarOutlined style={{ marginRight: 8, color: '#52c41a' }} />新增收款{receiptCustomer ? ` — ${receiptCustomer.name}` : ''}</span>}
        open={receiptModalVisible}
        onCancel={() => { setReceiptModalVisible(false); setReceiptAmount(null); setReceiptBankKey(''); setReceiptCustomer(null); }}
        onOk={handleSaveReceipt}
        okText="提交"
        cancelText="取消"
        width={420}
        destroyOnClose
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款金额(元) <span style={{ color: '#ff4d4f' }}>*</span></div>
          <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="请输入收款金额"
            value={receiptAmount} onChange={v => setReceiptAmount(v === null ? null : v)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款银行账户</div>
          <Select style={{ width: '100%' }} value={receiptBankKey || undefined} placeholder="选择收款入账银行账户" allowClear
            showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            onChange={v => setReceiptBankKey(v || '')}
            options={(() => {
              try {
                const banks: any[] = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${getDataOwner()}`) || '[]');
                return banks.filter((b: any) => b.status !== 'disabled').map((b: any) => ({
                  label: `${b.name} - ${b.bankName || ''} ${b.balance !== undefined ? `(余额 ¥${Number(b.balance).toFixed(2)})` : ''}`,
                  value: b.key,
                }));
              } catch { return []; }
            })()} />
        </div>
        <div style={{ marginTop: 16, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
          提交后收款记录将出现在「财务管理 - 收/付申请 - 收款确认」中，确认到账后将自动写入银行明细、客户已收货款及记账凭证。
        </div>
      </Modal>

      {/* 信用额度调整弹窗 */}
      <Modal
        title={<span><WalletOutlined style={{ marginRight: 8, color: '#722ed1' }} />调整信用额度{creditAdjustCustomer ? ` — ${creditAdjustCustomer.name}` : ''}</span>}
        open={creditAdjustModalVisible}
        onCancel={() => { setCreditAdjustModalVisible(false); creditAdjustForm.resetFields(); setCreditAdjustCustomer(null); }}
        onOk={handleCreditAdjust}
        okText="确认"
        cancelText="取消"
        width={440}
        destroyOnClose
      >
        <div style={{ marginTop: 16, marginBottom: 16, padding: '12px 16px', background: '#f6f6f6', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <Text style={{ fontSize: 13 }}>基础额度：</Text>
              <Text style={{ fontSize: 14 }}>¥{creditAdjustCustomer ? (Number(creditAdjustCustomer.baseCredit) || 0) : 0}</Text>
            </div>
            <div>
              <Text style={{ fontSize: 13 }}>有效额度：</Text>
              <Text strong style={{ fontSize: 16, color: '#722ed1' }}>¥{creditAdjustCustomer ? getEffectiveCredit(creditAdjustCustomer.id, creditAdjustCustomer.name, Number(creditAdjustCustomer.baseCredit) || 0, creditAdjustments) : 0}</Text>
            </div>
          </div>
        </div>
        <Form autoComplete="off" form={creditAdjustForm} layout="vertical">
          <Form.Item label="操作类型" style={{ marginBottom: 12 }}>
            <Radio.Group
              value={creditAdjustType}
              onChange={e => setCreditAdjustType(e.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="increase" style={{ color: creditAdjustType === 'increase' ? '#fff' : '#52c41a', borderColor: creditAdjustType === 'increase' ? '#52c41a' : '#d9d9d9', background: creditAdjustType === 'increase' ? '#52c41a' : '#fff' }}>增加额度</Radio.Button>
              <Radio.Button value="decrease" style={{ color: creditAdjustType === 'decrease' ? '#fff' : '#ff4d4f', borderColor: creditAdjustType === 'decrease' ? '#ff4d4f' : '#d9d9d9', background: creditAdjustType === 'decrease' ? '#ff4d4f' : '#fff' }}>削减额度</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="amount" label="调整金额(元)" rules={[{ required: true, message: '请输入调整金额' }]}>
            <InputNumber style={{ width: '100%' }} min={0.01} precision={2} prefix="¥" placeholder="请输入调整金额" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="调整原因（选填）" maxLength={100} />
          </Form.Item>
          <div style={{ padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 12, color: '#888' }}>
            {creditAdjustType === 'increase'
              ? `调整后有效额度：¥${Math.round(((creditAdjustCustomer ? getEffectiveCredit(creditAdjustCustomer.id, creditAdjustCustomer.name, Number(creditAdjustCustomer.baseCredit) || 0, creditAdjustments) : 0) + (Number(watchAdjustAmount) || 0)) * 100) / 100}`
              : `调整后有效额度：¥${Math.round(((creditAdjustCustomer ? getEffectiveCredit(creditAdjustCustomer.id, creditAdjustCustomer.name, Number(creditAdjustCustomer.baseCredit) || 0, creditAdjustments) : 0) - (Number(watchAdjustAmount) || 0)) * 100) / 100}`
            }
          </div>
        </Form>
      </Modal>

      {/* 额度调整明细弹窗 */}
      <Modal
        title={<span><HistoryOutlined style={{ marginRight: 8, color: '#722ed1' }} />额度调整明细{creditHistoryCustomer ? ` — ${creditHistoryCustomer.name}` : ''}</span>}
        open={creditHistoryVisible}
        onCancel={() => { setCreditHistoryVisible(false); setCreditHistoryCustomer(null); }}
        footer={[<Button key="close" onClick={() => { setCreditHistoryVisible(false); setCreditHistoryCustomer(null); }}>关闭</Button>]}
        width={680}
        destroyOnClose
      >
        {creditHistoryCustomer && (() => {
          const baseCredit = Number(creditHistoryCustomer.baseCredit) || 0;
          const effective = getEffectiveCredit(creditHistoryCustomer.id, creditHistoryCustomer.name, baseCredit, creditAdjustments);
          const records = creditAdjustments
            .filter(r => r.customerId === creditHistoryCustomer.id || r.customerName === creditHistoryCustomer.name)
            .sort((a, b) => b.date.localeCompare(a.date));
          return (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16, padding: '12px 16px', background: '#f6f6f6', borderRadius: 8 }}>
                <div><Text style={{ fontSize: 13 }}>基础额度：</Text><Text strong>¥{baseCredit}</Text></div>
                <div><Text style={{ fontSize: 13 }}>调整净额：</Text><Text strong style={{ color: effective - baseCredit >= 0 ? '#52c41a' : '#ff4d4f' }}>{effective - baseCredit >= 0 ? '+' : ''}{Math.round((effective - baseCredit) * 100) / 100}</Text></div>
                <div><Text style={{ fontSize: 13 }}>有效额度：</Text><Text strong style={{ fontSize: 16, color: '#722ed1' }}>¥{effective}</Text></div>
              </div>
              <Table
                bordered
                size="small"
                dataSource={records}
                rowKey="key"
                pagination={false}
                locale={{ emptyText: <Empty description="暂无调整记录" /> }}
                columns={[
                  { title: '时间', dataIndex: 'date', width: 160 },
                  { title: '类型', dataIndex: 'type', width: 80, align: 'center', render: (v: string) => <Tag color={v === 'increase' ? 'green' : 'red'}>{v === 'increase' ? '增加' : '削减'}</Tag> },
                  { title: '金额', dataIndex: 'amount', width: 100, align: 'right', render: (v: number, r: CreditAdjustRecord) => <Text strong style={{ color: r.type === 'increase' ? '#52c41a' : '#ff4d4f' }}>{r.type === 'increase' ? '+' : '-'}{v}</Text> },
                  { title: '操作人', dataIndex: 'operator', width: 100, render: (v: string) => v || '-' },
                  { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string) => v || '-' },
                ]}
              />
            </>
          );
        })()}
      </Modal>

      {/* 订单占用明细弹窗 */}
      <Modal
        title={<span>订单占用明细{occupiedDetailCustomer ? ` — ${occupiedDetailCustomer.name}` : ''}</span>}
        open={occupiedDetailVisible}
        onCancel={() => { setOccupiedDetailVisible(false); setOccupiedDetailCustomer(null); }}
        footer={[<Button key="close" onClick={() => { setOccupiedDetailVisible(false); setOccupiedDetailCustomer(null); }}>关闭</Button>]}
        width={780}
        destroyOnClose
      >
        {occupiedDetailCustomer && (() => {
          const rows = getOrderOccupiedList(getDataOwner(), occupiedDetailCustomer.name);
          const total = Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
          return (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16, padding: '12px 16px', background: '#f6f6f6', borderRadius: 8 }}>
                <div><Text style={{ fontSize: 13 }}>占用订单数：</Text><Text strong>{rows.length}</Text></div>
                <div><Text style={{ fontSize: 13 }}>占用金额合计：</Text><Text strong style={{ fontSize: 16, color: '#fa8c16' }}>¥{total}</Text></div>
              </div>
              <Table
                bordered
                size="small"
                dataSource={rows}
                rowKey="orderId"
                pagination={false}
                locale={{ emptyText: <Empty description="暂无占用订单" /> }}
                columns={[
                  { title: '订单编号', dataIndex: 'orderId', width: 160 },
                  { title: '订单状态', dataIndex: 'orderStatus', width: 110, align: 'center', render: (v: string) => <Tag color="orange">{v}</Tag> },
                  { title: '订单来源', dataIndex: 'orderSource', width: 110, align: 'center', render: (v: string) => <Tag color={v === '采购商推送' ? 'blue' : 'green'}>{v}</Tag> },
                  { title: '付款方式', dataIndex: 'payMethod', width: 100, align: 'center', render: (v: string) => v || '-' },
                  { title: '占用金额(元)', dataIndex: 'amount', width: 120, align: 'right', render: (v: number) => <Text strong style={{ color: '#fa8c16' }}>{Number(v) || 0}</Text> },
                  { title: '创建时间', dataIndex: 'createTime', ellipsis: true, render: (v: string) => v || '-' },
                ]}
              />
            </>
          );
        })()}
      </Modal>

      {/* 已收货款-收款明细弹窗 */}
      <Modal
        title={<span>收款明细{receiptDetailCustomer ? ` — ${receiptDetailCustomer.name}` : ''}</span>}
        open={receiptDetailVisible}
        onCancel={() => { setReceiptDetailVisible(false); setReceiptDetailCustomer(null); setReceiptDetailSearch(''); }}
        footer={[<Button key="close" onClick={() => { setReceiptDetailVisible(false); setReceiptDetailCustomer(null); setReceiptDetailSearch(''); }}>关闭</Button>]}
        width={780}
      >
        {(() => {
          const cust = receiptDetailCustomer;
          if (!cust) return null;
          const rows: any[] = [];
          // 手工登记收款（新增收款）
          customerReceipts
            .filter((r: any) => r.customerId === cust.id || r.customerName === cust.name)
            .forEach((r: any) => rows.push({ key: r.key, no: r.receiptNo || '-', date: r.date, amount: Number(r.amount) || 0, account: r.account || '-', voucher: r.voucher || '', source: '手工登记' }));
          // 账单明细列表：对应客户的已付金额记录（账单未生成时回退按订单统计）
          let billRows: any[] = [];
          try { billRows = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${getDataOwner()}`) || '[]'); } catch { /* ignore */ }
          const orderById = new Map<string, any>();
          try {
            const os: any[] = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${getDataOwner()}`) || '[]');
            (Array.isArray(os) ? os : []).forEach((o: any) => { if (o?.id) orderById.set(o.id, o); });
          } catch { /* ignore */ }
          const billList = Array.isArray(billRows) ? billRows : [];
          if (Array.isArray(billList) && billList.length > 0) {
            billList.forEach((b: any) => {
              const ord = orderById.get(b?.id) || null;
              const amt = Number(b?.paidAmount) || Number(ord?.paidAmount) || 0;
              if (b && String(b.customerName || '').trim() === String(cust.name || '').trim() && amt > 0) {
                rows.push({ key: `bill-${b.id}`, no: b.id, date: b.outboundDate || '-', amount: amt, account: ord?.payAccount || '-', voucher: ord?.payScreenshot || '', source: `账单明细（${b.id}）` });
              }
            });
          } else {
            orderById.forEach((o: any) => {
              if (o && o.orderStatus !== '待付款' && (Number(o.paidAmount) || 0) > 0 && String(o.customerName || '').trim() === String(cust.name || '').trim()) {
                rows.push({ key: `order-${o.id}`, no: o.id, date: o.payTime || o.date || '-', amount: Number(o.paidAmount) || 0, account: o.payAccount || '-', voucher: o.payScreenshot || '', source: `订单收款（${o.id}）` });
              }
            });
          }
          const total = rows.reduce((s, r) => s + r.amount, 0);
          // 按日期降序排列（最新记录在前）
          rows.sort((a, b) => {
            const da = dayjs(a.date).isValid() ? dayjs(a.date).valueOf() : 0;
            const db = dayjs(b.date).isValid() ? dayjs(b.date).valueOf() : 0;
            return db - da;
          });
          const kw = receiptDetailSearch.trim();
          const shown = kw ? rows.filter(r => [r.no, r.date, r.account, r.source, String(r.amount)].some(f => String(f || '').includes(kw))) : rows;
          const shownTotal = shown.reduce((s, r) => s + r.amount, 0);
          return (
            <>
              <Input
                placeholder="搜索编号/日期/收款账户/来源/金额"
                prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                value={receiptDetailSearch}
                onChange={e => setReceiptDetailSearch(e.target.value)}
                allowClear
                style={{ marginBottom: 12 }}
              />
              <Table
                size="small"
                dataSource={shown}
                pagination={false}
                columns={[
                  { title: '编号', dataIndex: 'no', key: 'no', width: 150 },
                  { title: '日期', dataIndex: 'date', key: 'date', width: 160 },
                  { title: '收款金额(元)', dataIndex: 'amount', key: 'amount', width: 120, align: 'right', render: (v: number) => <Text strong style={{ color: '#52c41a' }}>¥{(Number(v) || 0).toFixed(2)}</Text> },
                  { title: '收款账户', dataIndex: 'account', key: 'account', width: 150 },
                  { title: '付款凭证', dataIndex: 'voucher', key: 'voucher', width: 90, render: (v: string) => v ? <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-' },
                  { title: '来源', dataIndex: 'source', key: 'source' },
                ]}
                locale={{ emptyText: '暂无收款记录' }}
              />
              <div style={{ textAlign: 'right', marginTop: 12 }}>
                <Text strong>合计：¥{(kw ? shownTotal : total).toFixed(2)}</Text>
                {kw ? <Text type="secondary" style={{ marginLeft: 8 }}>（筛选 {shown.length}/{rows.length} 条）</Text> : null}
              </div>
            </>
          );
        })()}
      </Modal>

      {/* 客户对账单查看弹窗（生成后自动打开；可切换历史对账单） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />{ourCompanyName}对账单</span>}
        open={!!stmtView}
        onCancel={() => setStmtView(null)}
        footer={[<Button key="close" onClick={() => setStmtView(null)}>关闭</Button>]}
        width={860}
        centered
      >
        {stmtView && (() => {
          const hist = stmtList
            .filter(s => s.customerId === stmtView.customerId || s.customerName === stmtView.customerName)
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          return (
            <div>
              {hist.length > 1 ? (
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>历史对账单：</Text>
                  <Select size="small" style={{ width: 340 }} value={stmtView.key}
                    onChange={v => { const t = hist.find(x => x.key === v); if (t) setStmtView(t); }}>
                    {hist.map(h => <Option key={h.key} value={h.key}>{h.no}（{dayjs(h.createdAt).format('YYYY-MM-DD HH:mm')}）</Option>)}
                  </Select>
                  <Button size="small" icon={<FileTextOutlined />} style={{ color: '#fff', borderColor: '#722ed1', background: '#722ed1' }}
                    onClick={() => {
                      const rec = allCustomers.find((c: any) => c.id === stmtView.customerId || c.name === stmtView.customerName);
                      if (rec) handleGenStatement(rec);
                    }}>
                    生成对账单
                  </Button>
                </div>
              ) : (
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button size="small" icon={<FileTextOutlined />} style={{ color: '#fff', borderColor: '#722ed1', background: '#722ed1' }}
                    onClick={() => {
                      const rec = allCustomers.find((c: any) => c.id === stmtView.customerId || c.name === stmtView.customerName);
                      if (rec) handleGenStatement(rec);
                    }}>
                    生成对账单
                  </Button>
                  {!stmtView.no && <Text type="secondary" style={{ fontSize: 12 }}>该客户暂无对账单，点击上方按键生成第一期</Text>}
                </div>
              )}
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
                <Descriptions.Item label="对账单编号">{stmtView.no || <Text type="secondary">暂未生成</Text>}</Descriptions.Item>
                <Descriptions.Item label="生成时间">{stmtView.no ? dayjs(stmtView.createdAt).format('YYYY-MM-DD HH:mm') : <Text type="secondary">—</Text>}</Descriptions.Item>
                <Descriptions.Item label="客户公司名称" span={2}>{stmtView.customerName}<CertBadge info={stmtCert} /></Descriptions.Item>
                <Descriptions.Item label="法人代表">{stmtView.legalPerson || ''}</Descriptions.Item>
                <Descriptions.Item label="联系人/电话">{[stmtView.contactPerson, stmtView.contactPhone].filter(Boolean).join(' / ')}</Descriptions.Item>
                <Descriptions.Item label="对账期间" span={2}>
                  {stmtView.periodFrom ? `${dayjs(stmtView.periodFrom).format('YYYY-MM-DD')} ～ ${dayjs(stmtView.periodTo).format('YYYY-MM-DD')}` : `不限 ～ ${dayjs(stmtView.periodTo).format('YYYY-MM-DD')}`}
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>（按账单/收款日期归集）</Text>
                </Descriptions.Item>
                <Descriptions.Item label="累计欠款金额">
                  <Text strong style={{ color: stmtView.cumulativeDebt > 0 ? '#ff4d4f' : '#52c41a', fontSize: 16 }}>¥{stmtView.cumulativeDebt.toFixed(2)}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="期初欠款金额">¥{stmtView.openingDebt.toFixed(2)}</Descriptions.Item>
                <Descriptions.Item label="本期新增采购金额">¥{stmtView.newPurchaseAmount.toFixed(2)}</Descriptions.Item>
                <Descriptions.Item label="本期新增采购数量">{stmtView.newPurchaseQty}</Descriptions.Item>
                <Descriptions.Item label="本期新增收款金额">¥{stmtView.newReceiptAmount.toFixed(2)}</Descriptions.Item>
                <Descriptions.Item label="本期账单笔数">{stmtView.billCount} 笔</Descriptions.Item>
              </Descriptions>
              <Text strong style={{ fontSize: 13 }}>本期采购账单明细</Text>
              <Table size="small" bordered rowKey={(r: any) => r.billNo} style={{ marginTop: 6, marginBottom: 12 }}
                columns={[
                  { title: '出库单号', dataIndex: 'billNo', key: 'billNo' },
                  { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
                  { title: '商品总数量', dataIndex: 'qty', key: 'qty', width: 100, align: 'right' as const },
                  { title: '商品总额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const, render: (v: number) => `¥${(Number(v) || 0).toFixed(2)}` },
                ]}
                dataSource={stmtView.bills}
                pagination={false}
                scroll={{ y: 220 }}
                locale={{ emptyText: '本期无新增采购账单' }}
              />
              <Text strong style={{ fontSize: 13 }}>本期收款明细</Text>
              <Table size="small" bordered rowKey={(r: any) => r.receiptNo} style={{ marginTop: 6, marginBottom: 12 }}
                columns={[
                  { title: '收款单号', dataIndex: 'receiptNo', key: 'receiptNo' },
                  { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
                  { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const, render: (v: number) => `¥${(Number(v) || 0).toFixed(2)}` },
                ]}
                dataSource={stmtView.receipts}
                pagination={false}
                scroll={{ y: 160 }}
                locale={{ emptyText: '本期无新增收款' }}
              />
              <div style={{ background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#5a6d85', lineHeight: 1.9 }}>
                请客户核对以上对账信息（累计欠款 = 期初欠款 + 本期新增采购 − 本期新增收款）；无误请在沟通群或以文字回复确认，如有异议请于收到对账单 7 日内联系调整。
              </div>
              <Alert type="info" showIcon icon={<PictureOutlined />} style={{ marginTop: 12 }}
                message="可截图本对账单发送到沟通群（或客户个人）进行文字确认"
                description="客户文字确认无误后完成账单闭环；建议将确认截图与对账单一并归档，以免产生法律纠纷。" />
            </div>
          );
        })()}
      </Modal>

      {/* 截止应收欠款查询：账单截止日+收款截止日双时间筛选，旧欠残留/时点余额双模式 */}
      <AsOfDebtModal
        open={asOfOpen}
        onClose={() => setAsOfOpen(false)}
        title="截止应收欠款查询"
        nameLabel="客户"
        debtLabel="截止应收欠款(元)"
        billLabel="账单"
        payLabel="收款"
        names={allCustomers.map((c: any) => c.name)}
        bills={{
          list: asOfBills,
          name: (b: any) => String(b?.customerName || b?.customer || '').trim(),
          date: (b: any) => String(b?.outboundDate || b?.date || ''),
          amount: (b: any) => Number(b?.totalAmount) || 0,
          no: (b: any) => b?.outboundNo || b?.id || '',
        }}
        pays={{
          list: customerReceipts,
          name: (r: any) => String(r?.customerId ? (asOfIdName[r.customerId] || '') : (r?.customerName || '')).trim(),
          date: (r: any) => String(r?.date || ''),
          amount: (r: any) => Number(r?.amount) || 0,
          no: (r: any) => r?.receiptNo || '',
        }}
      />
    </div>
  );
};

export default CustomerInfo;
