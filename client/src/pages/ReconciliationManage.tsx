import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Card, Row, Col, Typography, Statistic, Table, Input, Select, Button,
  Space, Tag, message, Modal, Form, Descriptions, Dropdown,
  Popconfirm, Badge, Tooltip, Tabs, Steps, Divider, Alert, Result,
  InputNumber, DatePicker, Timeline, Popover, Checkbox, Upload, Image, Switch,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  ExportOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  SwapOutlined,
  FileTextOutlined,
  EyeOutlined,
  AuditOutlined,
  UserOutlined,
  ShopOutlined,
  DollarOutlined,
  DiffOutlined,
  CopyOutlined,
  SendOutlined,
  DownloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  MessageOutlined,
  SettingOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { useParams, useLocation } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { appendBillLogEntry } from '../utils/billLog';
import { compressImageFile } from '../utils/imageCompress';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;

const PRIMARY = '#1e4a7e';

// ==================== 类型定义 ====================

/** 对账类型 */
type ReconType = 'customer' | 'supplier';

/** 对账结果 */
type ReconResult = 'pending' | 'matched' | 'detail_diff' | 'amount_diff';

/** 对账明细项 */
interface ReconDetailItem {
  itemNo: string;       // 货号（商品编码）
  styleCode?: string;   // 款式编码
  itemName: string;     // 货品名称（货品简称）
  ourQty: number;       // 本方数量
  theirQty: number;     // 对方数量
  ourPrice: number;     // 本方单价
  theirPrice: number;   // 对方单价
  ourSubTotal: number;  // 本方小计
  theirSubTotal: number;// 对方小计
  match: boolean;       // 明细是否一致
}

/** 对账记录 */
interface ReconRecord {
  key: string;
  docNo: string;              // 单据编号
  reconType: ReconType;       // 对账类型
  counterparty: string;       // 对方名称（客户/供应商）
  counterpartyCode: string;   // 对方编码
  ourAmount: number;          // 本方金额
  theirAmount: number;        // 对方金额
  reconResult: ReconResult;   // 对账结果
  diffDesc: string;           // 差异说明
  date: string;               // 对账日期
  details: ReconDetailItem[]; // 明细
  ourEntryDate: string;       // 本方录入日期
  theirEntryDate: string;     // 对方入账日期
  confirmedBy?: string;       // 确认人
  confirmedAt?: string;       // 确认时间
  supplierUsername?: string;  // 供应商账号（发起方）
  supplierName?: string;      // 供应商公司名称
  customerUsername?: string;  // 采购商账号
  styleCompare?: { styleCode: string; ourQty: number; theirQty: number }[]; // 款式编码汇总核对
  matchedBillKey?: string;    // 已关联的采购账单 key
  orderNo?: string;           // 供应商账单明细行 id
  initiator?: 'supplier' | 'purchaser'; // 发起人：供应商 / 采购商
  customerName?: string;      // 采购商公司名称
  source?: 'bill' | 'entry';  // 来源：账单明细发起 / 手动录入
}

/** 对方反馈条目（全局共享，供应商/采购商完全同步） */
interface FeedbackEntry {
  id: string;
  side: 'supplier' | 'purchaser';
  author: string;
  reasons: string[];
  note: string;
  images: string[];
  time: string;
}

const FEEDBACK_KEY = 'recon_feedback';
const MISMATCH_REASONS = ['金额不一致', '款式数量不相等', '商品编码不一致', '单价不一致', '缺少明细项', '重复入账', '其他'];
const loadFeedbackThread = (docNo: string): FeedbackEntry[] => {
  try { const m = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}'); return Array.isArray(m[docNo]) ? m[docNo] : []; } catch { return []; }
};
const saveFeedbackThread = (docNo: string, entries: FeedbackEntry[]) => {
  try { const m = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}'); m[docNo] = entries; localStorage.setItem(FEEDBACK_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};
const getFeedbackSeen = (side: string, docNo: string): string => {
  try { const m = JSON.parse(localStorage.getItem('recon_feedback_seen_' + side) || '{}'); return m[docNo] || ''; } catch { return ''; }
};
const setFeedbackSeen = (side: string, docNo: string) => {
  try { const m = JSON.parse(localStorage.getItem('recon_feedback_seen_' + side) || '{}'); m[docNo] = new Date().toISOString(); localStorage.setItem('recon_feedback_seen_' + side, JSON.stringify(m)); } catch { /* ignore */ }
};

// ==================== 模拟数据 ====================

const initialReconData: ReconRecord[] = [];

// ==================== 辅助函数 ====================

const reconTypeLabel: Record<ReconType, string> = { customer: '客户对账', supplier: '供应商对账' };
const reconTypeColor: Record<ReconType, string> = { customer: 'blue', supplier: 'purple' };

const reconResultLabel: Record<ReconResult, string> = {
  pending: '对方未入账',
  matched: '金额一致',
  detail_diff: '金额一致/明细不一致',
  amount_diff: '金额不一致',
};
const reconResultColor: Record<ReconResult, string> = {
  pending: 'default',
  matched: 'green',
  detail_diff: 'orange',
  amount_diff: 'red',
};
const reconResultIcon: Record<ReconResult, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  matched: <CheckCircleOutlined />,
  detail_diff: <WarningOutlined />,
  amount_diff: <CloseCircleOutlined />,
};

/** 执行对账比对：以单据编号为基准，比对金额和明细 */
function performReconciliation(ourAmount: number, theirAmount: number, details: ReconDetailItem[]): {
  reconResult: ReconResult;
  diffDesc: string;
} {
  if (theirAmount === 0) {
    return { reconResult: 'pending', diffDesc: '对方尚未入账，等待确认' };
  }
  if (ourAmount === theirAmount) {
    const allMatch = details.every(d => d.match);
    if (allMatch) {
      return { reconResult: 'matched', diffDesc: '' };
    } else {
      return { reconResult: 'detail_diff', diffDesc: '金额一致，数量与货号不一致' };
    }
  }
  const diff = Math.abs(ourAmount - theirAmount);
  return {
    reconResult: 'amount_diff',
    diffDesc: `金额差异${diff.toLocaleString()}元，需人工核查`,
  };
}

// ==================== 组件 ====================

const ReconciliationManage: React.FC = () => {
  const { moduleKey = 'finance', childKey = 'reconciliation' } = useParams<{ moduleKey: string; childKey: string }>();
  const location = useLocation();
  // 采购商平台与供应商平台共用本页面，按路由区分角色
  const isPurchaser = location.pathname.startsWith('/purchaser');
  // 视角标签：记录中 ourX 存供应商（发起方）数据；采购商平台“本方”=采购商、“对方”=供应商，故标签互换
  const lblOur = isPurchaser ? '对方' : '本方';
  const lblTheir = isPurchaser ? '本方' : '对方';
  // 未入账提示随视角：our* 存供应商金额、their* 存采购商金额；供应商平台本方=供应商，采购商平台本方=采购商
  const zeroOurField = isPurchaser ? '对方未入账' : '本方未入账';
  const zeroTheirField = isPurchaser ? '本方未入账' : '对方未入账';
  // pending 未入账方随发起方：采购商发起→供应商未入账；供应商发起→采购商未入账
  const pendingLabel = (r: ReconRecord) => (r.initiator === 'purchaser' ? (isPurchaser ? '对方未入账' : '本方未入账') : (isPurchaser ? '本方未入账' : '对方未入账'));
  // 待入账标签随视角：供应商平台未入账方为采购商（对方）；采购商平台未入账方为采购商自己（本方）
  const resultLabel: Record<ReconResult, string> = { ...reconResultLabel, pending: isPurchaser ? '本方未入账' : '对方未入账' };

  // 当前登录账号名称（对账操作人，回写采购账单的采购商对账人字段）
  const operatorName = useMemo(() => {
    const uname = localStorage.getItem('username') || '';
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === uname);
      return u?.contactPerson || u?.companyName || uname;
    } catch { return uname; }
  }, []);

  const getOwner = useCallback(() => {
    const u = localStorage.getItem('username') || '';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || u) : u;
  }, []);

  // 实时同步开关（按平台+账号存储）：关闭时本方为响应方的对账记录仅本地保留，
  // 待本方对账完成或提交账目不符反馈后再同步给对方
  const realTimeSyncKey = `recon_realtime_sync_${isPurchaser ? 'purchaser' : 'supplier'}_${getOwner()}`;
  const [realTimeSync, setRealTimeSync] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(`recon_realtime_sync_${isPurchaser ? 'purchaser' : 'supplier'}_${getOwner()}`);
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const releasedSyncKeys = useRef<Set<string>>(new Set());
  const syncedReconRef = useRef<Record<string, ReconRecord>>({});
  const releaseSync = useCallback((key: string) => { releasedSyncKeys.current.add(key); }, []);

  // 自动对账开关（按平台+账号存储）：开启后对账结果完全一致（金额一致且明细全部一致）的单据自动完成对账，
  // 并在双方账单写明“自动核对（金额与明细完全一致）”；关闭则仍需人工确认
  const autoReconKey = `recon_auto_${isPurchaser ? 'purchaser' : 'supplier'}_${getOwner()}`;
  const [autoRecon, setAutoRecon] = useState<boolean>(() => {
    try { return localStorage.getItem(`recon_auto_${isPurchaser ? 'purchaser' : 'supplier'}_${getOwner()}`) === '1'; } catch { return false; }
  });

  // 采购账单读写与定位（先按已关联 key，再按单据编号）
  const loadBills = useCallback((): any[] => {
    try { const l = JSON.parse(localStorage.getItem('purchaser_bills_' + getOwner()) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
  }, [getOwner]);
  const saveBills = useCallback((list: any[]) => {
    localStorage.setItem('purchaser_bills_' + getOwner(), JSON.stringify(list));
  }, [getOwner]);
  const findBillIndex = useCallback((bills: any[], r: ReconRecord) => bills.findIndex(b =>
    (!!r.matchedBillKey && b.key === r.matchedBillKey) ||
    (!!b.outboundNo && String(b.outboundNo).trim() === String(r.docNo || '').trim())
  ), []);

  /** 对账完成：回传供应商账单明细“对账完成” + 采购商账单“已对账” + 双方对账管理自动移除该笔对账 */
  const completeRecon = useCallback((r: ReconRecord, action?: string, operatorName?: string) => {
    releaseSync(r.key);
    // 根据动作生成供应商侧/采购商侧差异说明
    const supDiff = action === 'entryByPurchaser' ? '本方未入账，按采方入账'
      : action === 'entryBySupplier' ? '按供方入账，采购商已确认'
      : action === 'mismatch' ? '账单不相符'
      : action === 'auto' ? '自动核对（金额与明细完全一致）'
      : '金额一致，双方对账完成';
    const purDiff = action === 'entryBySupplier' ? '按供方入账'
      : action === 'entryByPurchaser' ? '供应商按采方入账'
      : action === 'mismatch' ? '账单不相符'
      : action === 'auto' ? '自动核对（金额与明细完全一致）'
      : '金额一致，双方对账完成';
    // 日志动作标签
    const logAction = action === 'entryByPurchaser' ? '按采方入账'
      : action === 'entryBySupplier' ? '按供方入账'
      : action === 'mismatch' ? '账目不符'
      : action === 'confirmSupplier' ? '确认对账'
      : action === 'confirm' ? '确认对账'
      : action === 'auto' ? '自动核对'
      : '对账完成';
    const logDetail = supDiff;
    // 对账人：系统定时发起显示 '--'，否则显示操作人
    const isAuto = r.source === 'bill' && !action;
    const reconcilerDisplay = isAuto ? '--' : (operatorName || '--');
    const supReconPerson = (action === 'entryByPurchaser' || action === 'confirmSupplier' || action === 'auto') ? reconcilerDisplay : '';
    const purReconPerson = (action === 'confirm' || action === 'entryBySupplier' || action === 'mismatch' || action === 'auto') ? reconcilerDisplay : '';
    // 更新供应商账单明细
    try {
      const supOwner = r.supplierUsername || '';
      if (supOwner) {
        const key = `pageData_customer_bill-detail_${supOwner}`;
        const rows: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(rows)) {
          const idx = rows.findIndex(x => (!!r.orderNo && x.id === r.orderNo) || (!!x.outboundNo && String(x.outboundNo).trim() === String(r.docNo || '').trim()));
          if (idx >= 0) {
            const supResult = action === 'entryByPurchaser' ? '按采方入账' : '对账完成';
            rows[idx] = {
              ...rows[idx],
              reconResult: supResult,
              diffDesc: supDiff,
              supplierReconPerson: supReconPerson || rows[idx].supplierReconPerson || '',
              purchaserReconPerson: purReconPerson || rows[idx].purchaserReconPerson || '',
              billLog: appendBillLogEntry(rows[idx].billLog, logAction, operatorName, logDetail),
            };
            localStorage.setItem(key, JSON.stringify(rows));
          }
        }
      }
    } catch { /* ignore */ }
    // 更新采购商账单对账结果
    try {
      const purOwner = r.customerUsername || '';
      if (purOwner) {
        const key = `purchaser_bills_${purOwner}`;
        const bills: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(bills)) {
          const idx = bills.findIndex(b =>
            (r.matchedBillKey && b.key === r.matchedBillKey) ||
            (b.outboundNo && String(b.outboundNo).trim() === String(r.docNo || '').trim())
          );
          if (idx >= 0) {
            const cur = bills[idx].reconcileResult || '';
            const update: any = { diffNote: purDiff };
            if (!['按供方入账', '不相符'].includes(cur)) {
              update.reconcileResult = '已对账';
            }
            if (purReconPerson) update.purchaserReconciler = purReconPerson;
            if (supReconPerson) update.supplierReconciler = supReconPerson;
            update.billLog = appendBillLogEntry(bills[idx].billLog, logAction, operatorName, logDetail);
            bills[idx] = { ...bills[idx], ...update };
            localStorage.setItem(key, JSON.stringify(bills));
          }
        }
      }
    } catch { /* ignore */ }
    setDataSource(prev => prev.filter(x => x.key !== r.key));
  }, []);

  // ==================== 对方反馈 / 账单不符弹窗 / 明细显示字段 状态 ====================
  const mySide: 'supplier' | 'purchaser' = isPurchaser ? 'purchaser' : 'supplier';
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [feedbackReasons, setFeedbackReasons] = useState<string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackImage, setFeedbackImage] = useState('');
  const [, setFeedbackTick] = useState(0);
  const [mismatchVisible, setMismatchVisible] = useState(false);
  const [mismatchRecord, setMismatchRecord] = useState<ReconRecord | null>(null);
  const [mismatchReasons, setMismatchReasons] = useState<string[]>([]);
  const [mismatchNote, setMismatchNote] = useState('');
  const [mismatchImage, setMismatchImage] = useState('');
  const [detailFields, setDetailFields] = useState<Record<string, boolean>>({
    itemNo: true, productCode: true, itemName: true, ourQty: true, theirQty: true,
    ourPrice: true, theirPrice: true, ourSubTotal: true, theirSubTotal: true,
  });

  // 跨标签页同步对方反馈（effect 移至 selectedRecord 声明之后）

  // 对账记录共享存储（供应商发起 → 采购商平台可见）
  const [dataSource, setDataSource] = useState<ReconRecord[]>(() => {
    try {
      const raw = localStorage.getItem('recon_records');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr as ReconRecord[];
      }
    } catch { /* ignore */ }
    return initialReconData;
  });

  // 自动对账：开关开启时对“完全一致”单据自动完成（completeRecon 会移除记录并回写账单，dataSource 收敛后 effect 自然终止）
  useEffect(() => {
    if (!autoRecon) return;
    const targets = dataSource.filter(r => r.reconResult === 'matched');
    if (!targets.length) return;
    targets.forEach(r => completeRecon(r, 'auto', '系统自动核对'));
  }, [autoRecon, dataSource, completeRecon]);

  // 持久化对账记录（实时同步关闭时：本方为响应方的记录仅本地保留，释放后才写入共享存储）
  useEffect(() => {
    try {
      const gated = (r: ReconRecord) => (isPurchaser ? (r.initiator || 'supplier') === 'supplier' : r.initiator === 'purchaser');
      const out = realTimeSync
        ? dataSource
        : dataSource.map(r => (gated(r) && !releasedSyncKeys.current.has(r.key) && syncedReconRef.current[r.key]) ? syncedReconRef.current[r.key] : r);
      localStorage.setItem('recon_records', JSON.stringify(out));
      syncedReconRef.current = Object.fromEntries(out.map(r => [r.key, r]));
    } catch { /* ignore */ }
  }, [dataSource, realTimeSync, isPurchaser]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 详情抽屉
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ReconRecord | null>(null);

  // 跨标签页同步对方反馈
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FEEDBACK_KEY) {
        if (feedbackVisible && selectedRecord) setFeedbackEntries(loadFeedbackThread(selectedRecord.docNo));
        setFeedbackTick(t => t + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [feedbackVisible, selectedRecord]);

  // 剪切板粘贴图片 effect 移至 readImageFile 定义之后

  // 录入单据模态框
  const [entryVisible, setEntryVisible] = useState(false);
  const [entryForm] = Form.useForm();
  const [entryType, setEntryType] = useState<ReconType>('customer');

  // 手动对账
  const [manualReconVisible, setManualReconVisible] = useState(false);
  const [manualReconRecord, setManualReconRecord] = useState<ReconRecord | null>(null);

  // 手动关联采购账单（采购商平台：自动匹配不到时手动选择）
  const [linkVisible, setLinkVisible] = useState(false);
  const [linkRecord, setLinkRecord] = useState<ReconRecord | null>(null);
  const [linkBills, setLinkBills] = useState<any[]>([]);
  const [linkPick, setLinkPick] = useState<string>('');
  const emptyLinkSearch = { no: '', supplier: '', date: '', qty: '', amount: '' };
  const [linkSearch, setLinkSearch] = useState({ ...emptyLinkSearch });
  const [linkSearchApplied, setLinkSearchApplied] = useState({ ...emptyLinkSearch });

  // 当前角色可见的对账记录：供应商看自己发起的；采购商看发给自己的（含公司名兜底匹配）
  const myCompanyName = useMemo(() => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === getOwner());
      return u?.companyName || '';
    } catch { return ''; }
  }, [getOwner]);

  const roleData = useMemo(() => dataSource.filter(r => (isPurchaser
    ? r.customerUsername === getOwner() || (!r.customerUsername && !!myCompanyName && r.counterparty === myCompanyName)
    : r.supplierUsername === getOwner()
  )), [dataSource, isPurchaser, getOwner, myCompanyName]);

  // ==================== 统计 ====================
  const stats = useMemo(() => {
    const total = roleData.length;
    const pending = roleData.filter(r => r.reconResult === 'pending').length;
    const matched = roleData.filter(r => r.reconResult === 'matched').length;
    const detailDiff = roleData.filter(r => r.reconResult === 'detail_diff').length;
    const amountDiff = roleData.filter(r => r.reconResult === 'amount_diff').length;
    const rate = total > 0 ? Math.round(((matched) / total) * 100) : 0;
    return { total, pending, matched, detailDiff, amountDiff, rate };
  }, [roleData]);

  // ==================== 筛选 ====================
  const filteredData = useMemo(() => {
    // 角色过滤后的数据为基准（与统计/标签计数同口径）
    let data = roleData;
    // 客户对账→采购商发起；供应商对账→供应商发起（双平台统一按 initiator 区分）
    if (activeTab === 'customer') data = data.filter(r => (r.initiator || 'supplier') === 'purchaser');
    if (activeTab === 'supplier') data = data.filter(r => (r.initiator || 'supplier') !== 'purchaser');
    if (activeTab === 'pending') data = data.filter(r => r.reconResult === 'pending');
    if (activeTab === 'abnormal') data = data.filter(r => r.reconResult === 'detail_diff' || r.reconResult === 'amount_diff');

    return data.filter(item => {
      const matchSearch = !searchText ||
        item.docNo.toLowerCase().includes(searchText.toLowerCase()) ||
        item.counterparty.includes(searchText);
      const matchType = !typeFilter || (typeFilter === 'customer' ? (item.initiator || 'supplier') === 'purchaser' : (item.initiator || 'supplier') !== 'purchaser');
      const matchResult = !resultFilter || item.reconResult === resultFilter;
      return matchSearch && matchType && matchResult;
    });
  }, [roleData, activeTab, searchText, typeFilter, resultFilter, isPurchaser]);

  // 采购商平台：按单据编号自动匹配采购账单，核对明细与总金额（款式编码汇总核对数量）
  useEffect(() => {
    if (!isPurchaser) return;
    const owner = getOwner();
    let bills: any[] = [];
    try { bills = JSON.parse(localStorage.getItem('purchaser_bills_' + owner) || '[]'); } catch { /* ignore */ }
    if (!Array.isArray(bills)) bills = [];
    const billUpdates = new Map<string, { reconcileResult: string; diffNote: string; auxDocNo?: string }>();
    let changed = false;
    // 逐键更新映射：最终用函数式 setDataSource 应用，避免同提交内自动对账删除的记录被直接值覆盖复活
    const updMap = new Map<string, ReconRecord>();
    dataSource.forEach(r => {
      const mineByUser = r.customerUsername === owner;
      const mineByCompany = !r.customerUsername && !!myCompanyName && r.counterparty === myCompanyName;
      if ((!mineByUser && !mineByCompany) || r.source !== 'bill') return r;
      // 采购商发起的对账请求：供方数据未回填前不参与本方自动核对
      if (r.initiator === 'purchaser' && (Number(r.ourAmount) || 0) === 0) return r;
      // 对方校验：采购账单的供应商须与本对账记录的供应商一致，避免同号跨供应商误匹配
      const cpSupplier = String(r.supplierName || (r.initiator === 'purchaser' ? r.counterparty : '') || '').trim();
      const sameCp = (b: any) => !cpSupplier || String(b.supplier || '').trim() === cpSupplier;
      // 匹配采购账单：优先 matchedBillKey，其次单据编号 outboundNo，再次辅助单据号 auxDocNo（均需通过对方校验）
      const bill = (r.matchedBillKey ? bills.find(b => b.key === r.matchedBillKey && sameCp(b)) : undefined)
        || bills.find(b => sameCp(b) && b.outboundNo && String(b.outboundNo).trim() === String(r.docNo || '').trim())
        || bills.find(b => sameCp(b) && b.auxDocNo && String(b.auxDocNo).trim() === String(r.docNo || '').trim());
      if (!bill) {
        const upd: ReconRecord = { ...r, customerUsername: r.customerUsername || owner, matchedBillKey: undefined, theirAmount: 0, theirEntryDate: '-', reconResult: 'pending', diffDesc: '未匹配到采购账单，可手动关联单据' };
        if (JSON.stringify(upd) !== JSON.stringify(r)) { changed = true; return upd; }
        return r;
      }
      const billItems: any[] = Array.isArray(bill.items) ? bill.items : [];
      const theirAmount = Number(bill.totalAmount) || billItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
      // 商品级明细核对
      const theirByCode = new Map<string, { qty: number; price: number }>();
      billItems.forEach(it => {
        const code = String(it.productCode || '').trim() || String(it.styleCode || '').trim();
        if (!code) return;
        const cur = theirByCode.get(code) || { qty: 0, price: Number(it.unitPrice) || 0 };
        cur.qty += Number(it.quantity) || 0;
        theirByCode.set(code, cur);
      });
      const details: ReconDetailItem[] = (r.details || []).map(d => {
        const t = theirByCode.get(d.itemNo);
        const theirQty = t?.qty || 0;
        const theirPrice = t?.price || 0;
        return { ...d, theirQty, theirPrice, theirSubTotal: theirQty * theirPrice, match: theirQty === d.ourQty && theirPrice === d.ourPrice };
      });
      theirByCode.forEach((t, code) => {
        if (!(r.details || []).some(d => d.itemNo === code)) {
          details.push({ itemNo: code, itemName: '', styleCode: String(code).split('-')[0], ourQty: 0, theirQty: t.qty, ourPrice: 0, theirPrice: t.price, ourSubTotal: 0, theirSubTotal: t.qty * t.price, match: false });
        }
      });
      // 款式编码汇总核对：双方按款式汇总数量比对
      const ourStyle = new Map<string, number>();
      (r.styleCompare || []).forEach(s => ourStyle.set(s.styleCode, s.ourQty));
      const theirStyle = new Map<string, number>();
      billItems.forEach(it => {
        const sc = String(it.styleCode || '').trim() || String(it.productCode || '').split('-')[0] || '未知款式';
        theirStyle.set(sc, (theirStyle.get(sc) || 0) + (Number(it.quantity) || 0));
      });
      const styleUnion = new Set<string>(Array.from(ourStyle.keys()).concat(Array.from(theirStyle.keys())));
      const styleCompare = Array.from(styleUnion).map(sc => ({ styleCode: sc, ourQty: ourStyle.get(sc) || 0, theirQty: theirStyle.get(sc) || 0 }));
      const styleEqual = styleCompare.every(s => s.ourQty === s.theirQty);
      const amountEqual = Math.abs((r.ourAmount || 0) - theirAmount) < 0.01;
      const prodEqual = details.every(d => d.match);
      let reconResult: ReconResult;
      let diffDesc: string;
      if (amountEqual && styleEqual && prodEqual) {
        reconResult = 'matched';
        diffDesc = '';
      } else if (amountEqual) {
        reconResult = 'detail_diff';
        diffDesc = !styleEqual ? '款式数量不相等' : '金额一致，数量与货号不一致';
      } else {
        reconResult = 'amount_diff';
        diffDesc = `金额差异${Math.abs((r.ourAmount || 0) - theirAmount).toLocaleString()}元，需人工核查`;
        if (!styleEqual) diffDesc += '；款式数量不相等';
      }
      const upd: ReconRecord = { ...r, customerUsername: r.customerUsername || owner, matchedBillKey: bill.key, theirAmount, theirEntryDate: bill.date || '-', details, styleCompare, reconResult, diffDesc };
      billUpdates.set(bill.key, {
        reconcileResult: reconResult === 'matched' ? '一致' : '不一致',
        diffNote: diffDesc,
        auxDocNo: r.docNo || '',
      });
      if (JSON.stringify(upd) !== JSON.stringify(r)) { changed = true; updMap.set(r.key, upd); return upd; }
      return r;
    });
    // 核对结果回写采购账单（对账结果/差异说明）；终态（已对账/按供方入账/不相符）不被自动核对覆盖
    if (billUpdates.size > 0) {
      try {
        const finalStates = ['已对账', '按供方入账', '不相符', '已发起对账'];
        localStorage.setItem('purchaser_bills_' + owner, JSON.stringify(bills.map(b => {
          if (!billUpdates.has(b.key)) return b;
          if (finalStates.includes(String(b.reconcileResult || ''))) return b;
          return { ...b, ...billUpdates.get(b.key) };
        })));
      } catch { /* ignore */ }
    }
    if (changed) setDataSource(prev => prev.map(x => updMap.get(x.key) || x));
  }, [isPurchaser, dataSource, getOwner, myCompanyName]);

  // 供应商平台：采购商发起的对账请求，按单据编号匹配供应商账单明细自动回填供方数据并核对
  useEffect(() => {
    if (isPurchaser) return;
    const owner = getOwner();
    let rows: any[] = [];
    try { rows = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${owner}`) || '[]'); } catch { /* ignore */ }
    if (!Array.isArray(rows)) rows = [];
    const rowUpdates = new Map<string, { auxDocNo: string }>();
    let changed = false;
    // 逐键更新映射：函数式应用，保留同提交内自动对账的删除结果
    const updMap = new Map<string, ReconRecord>();
    dataSource.forEach(r => {
      if (r.initiator !== 'purchaser' || r.supplierUsername !== owner) return r;
      // 对方校验：供应商账单明细的采购商须与本对账记录的采购商一致，避免同号跨采购商误匹配
      const cpCustomer = String(r.customerName || '').trim();
      const sameCp = (x: any) => !cpCustomer || String(x.customerName || '').trim() === cpCustomer;
      // 匹配供应商账单明细：优先 orderNo/id，其次 outboundNo/docNo，再次辅助单据号 auxDocNo（均需通过对方校验）
      const row = rows.find(x => sameCp(x) && ((!!r.orderNo && x.id === r.orderNo) || (!!x.outboundNo && String(x.outboundNo).trim() === String(r.docNo || '').trim())))
        || rows.find(x => sameCp(x) && x.auxDocNo && String(x.auxDocNo).trim() === String(r.docNo || '').trim());
      if (!row) return r;
      const rowItems: any[] = Array.isArray(row.items) ? row.items : [];
      const ourByCode = new Map<string, { qty: number; price: number }>();
      rowItems.forEach(it => {
        const code = String(it.productCode || '').trim() || String(it.styleCode || '').trim();
        if (!code) return;
        const cur = ourByCode.get(code) || { qty: 0, price: Number(it.price) || 0 };
        cur.qty += Number(it.quantity) || 0;
        ourByCode.set(code, cur);
      });
      const details: ReconDetailItem[] = (r.details || []).map(d => {
        const o = ourByCode.get(d.itemNo);
        const ourQty = o?.qty || 0;
        const ourPrice = o?.price || 0;
        return { ...d, ourQty, ourPrice, ourSubTotal: ourQty * ourPrice, match: ourQty === d.theirQty && ourPrice === d.theirPrice };
      });
      ourByCode.forEach((o, code) => {
        if (!(r.details || []).some(d => d.itemNo === code)) {
          details.push({ itemNo: code, styleCode: String(code).split('-')[0], itemName: '', ourQty: o.qty, theirQty: 0, ourPrice: o.price, theirPrice: 0, ourSubTotal: o.qty * o.price, theirSubTotal: 0, match: false });
        }
      });
      const ourAmount = Math.round((Number(row.totalAmount) || rowItems.reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0)) * 100) / 100;
      const ourStyle = new Map<string, number>();
      rowItems.forEach(it => {
        const sc = String(it.styleCode || '').trim() || String(it.productCode || '').split('-')[0] || '未知款式';
        ourStyle.set(sc, (ourStyle.get(sc) || 0) + (Number(it.quantity) || 0));
      });
      const theirStyle = new Map<string, number>();
      details.forEach(d => {
        const sc = d.styleCode || String(d.itemNo || '').split('-')[0] || '未知款式';
        theirStyle.set(sc, (theirStyle.get(sc) || 0) + (Number(d.theirQty) || 0));
      });
      const styleUnion = new Set<string>(Array.from(ourStyle.keys()).concat(Array.from(theirStyle.keys())));
      const styleCompare = Array.from(styleUnion).map(sc => ({ styleCode: sc, ourQty: ourStyle.get(sc) || 0, theirQty: theirStyle.get(sc) || 0 }));
      const styleEqual = styleCompare.every(s => s.ourQty === s.theirQty);
      const amountEqual = Math.abs(ourAmount - (Number(r.theirAmount) || 0)) < 0.01;
      const prodEqual = details.every(d => d.match);
      let reconResult: ReconResult;
      let diffDesc: string;
      if (amountEqual && styleEqual && prodEqual) { reconResult = 'matched'; diffDesc = ''; }
      else if (amountEqual) { reconResult = 'detail_diff'; diffDesc = !styleEqual ? '款式数量不相等' : '金额一致，数量与货号不一致'; }
      else {
        reconResult = 'amount_diff';
        diffDesc = `金额差异${Math.abs(ourAmount - (Number(r.theirAmount) || 0)).toLocaleString()}元，需人工核查`;
        if (!styleEqual) diffDesc += '；款式数量不相等';
      }
      const upd: ReconRecord = { ...r, orderNo: row.id || r.orderNo, ourAmount, ourEntryDate: row.outboundDate || r.ourEntryDate, details, styleCompare, reconResult, diffDesc };
      rowUpdates.set(row.id || row.key, { auxDocNo: r.docNo || '' });
      if (JSON.stringify(upd) !== JSON.stringify(r)) { changed = true; updMap.set(r.key, upd); return upd; }
      return r;
    });
    // 辅助单据号回写供应商账单明细
    if (rowUpdates.size > 0) {
      try {
        localStorage.setItem(`pageData_customer_bill-detail_${owner}`, JSON.stringify(rows.map(row => {
          const upd = rowUpdates.get(row.id || row.key);
          return upd ? { ...row, ...upd } : row;
        })));
      } catch { /* ignore */ }
    }
    if (changed) setDataSource(prev => prev.map(x => updMap.get(x.key) || x));
  }, [isPurchaser, dataSource, getOwner]);

  // ==================== 操作函数 ====================

  /** 查看详情 */
  const handleView = useCallback((record: ReconRecord) => {
    setSelectedRecord(record);
    setDetailVisible(true);
  }, []);

  /** 采购商：确认入账（仅金额一致可确认；确认后采购账单对账结果→已对账） */
  const handleConfirmEntry = useCallback((r: ReconRecord) => {
    if (r.reconResult !== 'matched') {
      Modal.warning({
        title: '无法确认入账',
        content: `当前对账结果为“${resultLabel[r.reconResult]}”，仅“金额一致”的单据可确认无误；存在差异时请在查看明细中使用“按供方账单入账”或标记“账单不符”。`,
        centered: true,
        width: 400,
      });
      return;
    }
    Modal.confirm({
      title: '确认入账',
      content: '是否确认无误完成对账？',
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        const bills = loadBills();
        const idx = findBillIndex(bills, r);
        if (idx >= 0) {
          bills[idx] = { ...bills[idx], reconcileResult: '已对账', diffNote: '', purchaserReconciler: operatorName };
          saveBills(bills);
        }
        const now = new Date();
        const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setDataSource(prev => prev.map(x => (x.key === r.key ? { ...x, confirmedBy: operatorName, confirmedAt: nowStr } : x)));
        completeRecon(r, 'confirm', operatorName);
        message.success(`单据 ${r.docNo} 已完成对账，采购账单对账结果更新为"已对账"`);
      },
    });
  }, [resultLabel, loadBills, saveBills, findBillIndex, operatorName, completeRecon]);

  /** 采购商：账单不符 → 打开账目不符弹窗（原因选项+自定义+备注+图片） */
  const handleBillMismatch = useCallback((r: ReconRecord) => {
    setMismatchRecord(r);
    setMismatchReasons([]);
    setMismatchNote('');
    setMismatchImage('');
    setMismatchVisible(true);
  }, []);

  /** 账目不符弹窗提交：标记不相符 + 原因写入对方反馈（供应商同步可见） */
  const handleMismatchSubmit = useCallback(() => {
    if (!mismatchRecord) return;
    if (mismatchReasons.length === 0 && !mismatchNote.trim()) { message.warning('请选择不符原因或填写备注说明'); return; }
    const r = mismatchRecord;
    releaseSync(r.key);
    const bills = loadBills();
    const idx = findBillIndex(bills, r);
    const diffText = [mismatchReasons.join('、'), mismatchNote.trim()].filter(Boolean).join('：') || '账单不符';
    if (idx >= 0) {
      bills[idx] = { ...bills[idx], reconcileResult: '不相符', diffNote: diffText, purchaserReconciler: operatorName };
      saveBills(bills);
    }
    // 同步供应商账单明细差异说明与对账人
    try {
      const supOwner = r.supplierUsername || '';
      if (supOwner) {
        const key = `pageData_customer_bill-detail_${supOwner}`;
        const rows: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(rows)) {
          const sIdx = rows.findIndex(x => (!!r.orderNo && x.id === r.orderNo) || (!!x.outboundNo && String(x.outboundNo).trim() === String(r.docNo || '').trim()));
          if (sIdx >= 0) {
            rows[sIdx] = { ...rows[sIdx], reconResult: '不相符', diffDesc: diffText, purchaserReconPerson: operatorName };
            localStorage.setItem(key, JSON.stringify(rows));
          }
        }
      }
    } catch { /* ignore */ }
    const entries = loadFeedbackThread(r.docNo);
    entries.push({ id: `fb-${Date.now()}`, side: 'purchaser', author: operatorName, reasons: mismatchReasons, note: mismatchNote.trim(), images: mismatchImage ? [mismatchImage] : [], time: new Date().toISOString() });
    saveFeedbackThread(r.docNo, entries);
    setMismatchVisible(false);
    setFeedbackTick(t => t + 1);
    // 触发 gating effect 重新运行，将账目不符状态同步到对方
    setDataSource(prev => [...prev]);
    message.success(`单据 ${r.docNo} 已标记为"不相符"，不符原因已反馈给供应商`);
  }, [mismatchRecord, mismatchReasons, mismatchNote, mismatchImage, loadBills, saveBills, findBillIndex, operatorName]);

  // ==================== 对方反馈 ====================
  const readImageFile = useCallback((file: File, setter: (v: string) => void) => {
    compressImageFile(file).then(dataUrl => setter(dataUrl)).catch(() => message.error('图片处理失败'));
  }, []);

  // 剪切板粘贴图片：对方反馈/账目不符弹窗打开时 Ctrl+V 直接粘贴截图
  useEffect(() => {
    if (!feedbackVisible && !mismatchVisible) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            readImageFile(file, feedbackVisible ? setFeedbackImage : setMismatchImage);
            message.success('已粘贴剪切板图片');
          }
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste as EventListener);
    return () => window.removeEventListener('paste', onPaste as EventListener);
  }, [feedbackVisible, mismatchVisible, readImageFile]);

  const openFeedback = useCallback((r: ReconRecord) => {
    // 同步选中记录：弹窗标题/提交按钮依赖 selectedRecord（表格列入口未经过查看明细）
    setSelectedRecord(r);
    setFeedbackEntries(loadFeedbackThread(r.docNo));
    setFeedbackReasons([]);
    setFeedbackNote('');
    setFeedbackImage('');
    setFeedbackVisible(true);
    setFeedbackSeen(mySide, r.docNo);
    setFeedbackTick(t => t + 1);
  }, [mySide]);

  const submitFeedback = useCallback((r: ReconRecord) => {
    if (feedbackReasons.length === 0 && !feedbackNote.trim() && !feedbackImage) { message.warning('请填写反馈内容（原因/备注/图片任一）'); return; }
    releaseSync(r.key);
    const entries = loadFeedbackThread(r.docNo);
    entries.push({ id: `fb-${Date.now()}`, side: mySide, author: operatorName, reasons: feedbackReasons, note: feedbackNote.trim(), images: feedbackImage ? [feedbackImage] : [], time: new Date().toISOString() });
    saveFeedbackThread(r.docNo, entries);
    setFeedbackEntries(entries);
    setFeedbackReasons([]);
    setFeedbackNote('');
    setFeedbackImage('');
    setFeedbackSeen(mySide, r.docNo);
    setFeedbackTick(t => t + 1);
    // 触发 gating effect 重新运行，将反馈状态同步到对方
    setDataSource(prev => [...prev]);
    message.success('反馈已提交，对方平台同步可见');
  }, [feedbackReasons, feedbackNote, feedbackImage, mySide, operatorName]);

  const unseenFeedbackCount = useCallback((r: ReconRecord) => {
    const seen = getFeedbackSeen(mySide, r.docNo);
    return loadFeedbackThread(r.docNo).filter(e => e.side !== mySide && e.time > seen).length;
  }, [mySide]);

  /** 采购商：按供方账单入账（不一致→用供方明细覆盖采购账单明细；本方未入账→自动新增采购账单） */
  const handleEntryBySupplier = useCallback((r: ReconRecord) => {
    const supItems = (r.details || [])
      .filter(d => (Number(d.ourQty) || 0) > 0 || (Number(d.ourPrice) || 0) > 0)
      .map(d => ({
        styleCode: String(d.itemNo || '').split('-')[0],
        productCode: d.itemNo || '',
        color: '',
        spec: '',
        quantity: Number(d.ourQty) || 0,
        unitPrice: Number(d.ourPrice) || 0,
        amount: Number(d.ourSubTotal) || 0,
      }));
    if (supItems.length === 0) {
      // 采购商发起且对方未入账时，提示联系供应商关联账单
      if (r.initiator === 'purchaser' && r.reconResult === 'pending') {
        Modal.warning({
          title: '未查询到供应商账单',
          content: (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <span style={{ fontSize: 14, lineHeight: '24px' }}>未查询到供应商账单，请联系供应商关联账单后再操作。</span>
            </div>
          ),
          centered: true,
          width: 400,
          okText: '知道了',
        });
      } else {
        message.warning('供方账单中没有可入账的明细');
      }
      return;
    }
    const totalQty = supItems.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
    const bills = loadBills();
    const idx = findBillIndex(bills, r);
    if (idx >= 0) {
      bills[idx] = { ...bills[idx], items: supItems, totalQty, totalAmount: r.ourAmount, reconcileResult: '按供方入账', diffNote: '按供方入账', purchaserReconciler: operatorName };
      saveBills(bills);
      completeRecon(r, 'entryBySupplier', operatorName);
      message.success(`已按供方账单入账：采购账单 ${bills[idx].outboundNo || r.docNo} 的商品明细与金额已更新`);
    } else {
      const newBill: any = {
        key: `bill-recon-${Date.now()}`,
        outboundNo: r.docNo,
        prefix: '',
        supplier: r.counterparty,
        date: new Date().toISOString().slice(0, 10),
        items: supItems,
        images: [],
        purchaserImages: [],
        recorder: operatorName,
        totalQty,
        totalAmount: r.ourAmount,
        reconcileResult: '按供方入账',
        diffNote: '',
        supplierReconciler: r.supplierName || r.counterparty,
        purchaserReconciler: operatorName,
        supplierImages: [],
      };
      bills.push(newBill);
      saveBills(bills);
      setDataSource(prev => prev.map(x => (x.key === r.key ? { ...x, matchedBillKey: newBill.key } : x)));
      completeRecon(r, 'entryBySupplier', operatorName);
      message.success(`已按供方账单入账：采购账单 ${r.docNo} 已新增`);
    }
  }, [loadBills, saveBills, findBillIndex, operatorName, completeRecon]);

  /** 录入新单据 */
  const handleEntry = useCallback((type: ReconType) => {
    setEntryType(type);
    entryForm.resetFields();
    setEntryVisible(true);
  }, [entryForm]);

  const handleEntryConfirm = useCallback(() => {
    entryForm.validateFields().then(values => {
      const now = new Date().toISOString().split('T')[0];
      const newKey = String(Date.now());

      // 构建明细
      const details: ReconDetailItem[] = (values.items || []).map((item: any, idx: number) => ({
        itemNo: item.itemNo || `ITEM-${idx + 1}`,
        itemName: item.itemName || '',
        ourQty: item.ourQty || 0,
        theirQty: 0,
        ourPrice: item.ourPrice || 0,
        theirPrice: 0,
        ourSubTotal: (item.ourQty || 0) * (item.ourPrice || 0),
        theirSubTotal: 0,
        match: false,
      }));

      const ourAmount = details.reduce((sum, d) => sum + d.ourSubTotal, 0);
      const docPrefix = entryType === 'customer' ? 'SO' : 'PO';
      const docNum = String(Math.floor(Math.random() * 9000) + 1000);

      const newRecord: ReconRecord = {
        key: newKey,
        docNo: `${docPrefix}-${now.replace(/-/g, '')}-${docNum}`,
        reconType: entryType,
        counterparty: values.counterparty,
        counterpartyCode: entryType === 'customer' ? `CUST-${docNum}` : `SUPP-${docNum}`,
        initiator: mySide,
        ourAmount,
        theirAmount: 0,
        reconResult: 'pending',
        diffDesc: '等待对方入账',
        date: now,
        ourEntryDate: now,
        theirEntryDate: '-',
        details,
        source: 'entry',
        ...(entryType === 'customer' ? { supplierUsername: getOwner() } : { customerUsername: getOwner() }),
      };

      setDataSource(prev => [newRecord, ...prev]);
      message.success(`单据 ${newRecord.docNo} 已录入，等待${entryType === 'customer' ? '客户' : '供应商'}确认入账`);
      setEntryVisible(false);
      entryForm.resetFields();
    });
  }, [entryForm, entryType, getOwner]);

  /** 模拟客户/供应商入账 */
  const handleSimulateEntry = useCallback((record: ReconRecord) => {
    if (record.theirAmount > 0) {
      message.warning('该单据对方已入账，无需重复操作');
      return;
    }

    Modal.confirm({
      title: `模拟${record.reconType === 'customer' ? '客户' : '供应商'}入账`,
      icon: <SwapOutlined style={{ color: PRIMARY }} />,
      content: (
        <div>
          <p>将模拟 <strong>{record.counterparty}</strong> 对单据 <strong>{record.docNo}</strong> 进行入账操作。</p>
          <p>系统将自动以单据编号 <strong>{record.docNo}</strong> 进行金额比对。</p>
          <p style={{ color: '#666', fontSize: 13 }}>
            入账金额将参考本单金额（¥{record.ourAmount.toLocaleString()}），
            模拟场景下可能产生金额一致、金额差异、或明细差异三种结果。
          </p>
        </div>
      ),
      okText: '确认入账',
      cancelText: '取消',
      width: 520,
      onOk: () => {
        // 模拟：80%概率金额一致，10%金额差异，10%明细差异
        const rand = Math.random();
        let theirAmount: number;
        let updatedDetails: ReconDetailItem[];
        let reconResult: ReconResult;
        let diffDesc: string;

        if (rand < 0.7) {
          // 金额完全一致
          theirAmount = record.ourAmount;
          updatedDetails = record.details.map(d => ({
            ...d,
            theirQty: d.ourQty,
            theirPrice: d.ourPrice,
            theirSubTotal: d.ourSubTotal,
            match: true,
          }));
          reconResult = 'matched';
          diffDesc = '';
        } else if (rand < 0.85) {
          // 金额一致但明细不一致
          theirAmount = record.ourAmount;
          updatedDetails = record.details.map((d, i) => {
            if (i === record.details.length - 1) {
              const newQty = Math.max(1, d.ourQty - Math.floor(Math.random() * 5));
              return { ...d, theirQty: newQty, theirSubTotal: newQty * d.ourPrice, match: false };
            }
            return { ...d, theirQty: d.ourQty, theirPrice: d.ourPrice, theirSubTotal: d.ourSubTotal, match: true };
          });
          reconResult = 'detail_diff';
          diffDesc = '金额一致，数量与货号不一致';
        } else {
          // 金额不一致
          const variance = Math.floor(record.ourAmount * (0.02 + Math.random() * 0.08));
          theirAmount = record.ourAmount - variance;
          updatedDetails = record.details.map((d, i) => {
            if (i === 0) {
              const newPrice = Math.floor(d.ourPrice * 0.95);
              return { ...d, theirPrice: newPrice, theirSubTotal: d.ourQty * newPrice, match: false };
            }
            return { ...d, theirQty: d.ourQty, theirPrice: d.ourPrice, theirSubTotal: d.ourSubTotal, match: true };
          });
          reconResult = 'amount_diff';
          diffDesc = `金额差异${Math.abs(record.ourAmount - theirAmount).toLocaleString()}元，需人工核查`;
        }

        const now = new Date().toISOString();
        setDataSource(prev => prev.map(item =>
          item.key === record.key
            ? {
                ...item,
                theirAmount,
                details: updatedDetails,
                reconResult,
                diffDesc,
                theirEntryDate: now.split('T')[0],
                confirmedBy: reconResult === 'matched' ? '系统自动' : undefined,
                confirmedAt: reconResult === 'matched' ? now.replace('T', ' ').substring(0, 16) : undefined,
              }
            : item
        ));

        if (reconResult === 'matched') {
          message.success(`单据 ${record.docNo} 对账完成：金额一致，已自动确认入账`);
        } else if (reconResult === 'detail_diff') {
          message.warning(`单据 ${record.docNo}：金额一致，但明细不一致，请查看详情`);
        } else {
          message.error(`单据 ${record.docNo}：金额不一致，差异${Math.abs(record.ourAmount - theirAmount).toLocaleString()}元`);
        }
      },
    });
  }, []);

  /** 手动对账 */
  const handleManualRecon = useCallback((record: ReconRecord) => {
    setManualReconRecord(record);
    setManualReconVisible(true);
  }, []);

  /** 供应商：确认对账（仅金额一致可确认；确认后供应商账单明细→对账完成并移除对账记录） */
  const handleConfirmRecon = useCallback((r: ReconRecord) => {
    if (r.reconResult !== 'matched') {
      Modal.warning({
        title: '无法确认对账',
        content: `当前对账结果为“${r.reconResult === 'pending' ? pendingLabel(r) : reconResultLabel[r.reconResult]}”，仅“金额一致”的单据可确认无误；存在差异时请在查看明细中使用“按采购商账单入账”或标记“账目不符”。`,
        centered: true,
        width: 400,
      });
      return;
    }
    Modal.confirm({
      title: '确认对账',
      content: `确认单据 ${r.docNo} 与采购商账单金额（¥${(Number(r.theirAmount) || 0).toLocaleString()}）一致无误？确认后供应商账单明细将标记“对账完成”，并移除本条对账记录。`,
      okText: '确认对账',
      cancelText: '取消',
      centered: true,
      onOk: () => {
        completeRecon(r, 'confirmSupplier', operatorName);
        message.success(`单据 ${r.docNo} 已确认对账，供应商账单明细更新为"对账完成"`);
      },
    });
  }, [completeRecon, pendingLabel]);

  /** 供应商：按采购商账单入账（账目不一致/本方无账单时：按采购商账单数据更新或新增供应商账单明细，并标记“按采方入账”） */
  const handleEntryByPurchaser = useCallback((r: ReconRecord) => {
    Modal.confirm({
      title: '按采购商账单入账',
      content: `将按采购商账单（金额 ¥${(Number(r.theirAmount) || 0).toLocaleString()}）更新或新增供应商账单明细，对账结果标记为“按采方入账”。`,
      okText: '确认入账',
      cancelText: '取消',
      centered: true,
      onOk: () => {
        const owner = getOwner();
        const key = `pageData_customer_bill-detail_${owner}`;
        const items = (r.details || []).filter(d => String(d.itemNo || '').trim()).map(d => ({
          productCode: d.itemNo,
          styleCode: d.styleCode || String(d.itemNo || '').split('-')[0],
          quantity: Number(d.theirQty) || 0,
          price: Number(d.theirPrice) || 0,
        }));
        const totalQty = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        // 先完成对账（移除记录），再回写供应商账单明细为“按采方入账”
        completeRecon(r, 'entryByPurchaser', operatorName);
        // 同步更新采购商账单对账结果为“对账完成”
        try {
          const purOwner = r.customerUsername || '';
          if (purOwner) {
            const purKey = `purchaser_bills_${purOwner}`;
            const purBills: any[] = JSON.parse(localStorage.getItem(purKey) || '[]');
            if (Array.isArray(purBills)) {
              const purIdx = purBills.findIndex(b =>
                (r.matchedBillKey && b.key === r.matchedBillKey) ||
                (b.outboundNo && String(b.outboundNo).trim() === String(r.docNo || '').trim())
              );
              if (purIdx >= 0) {
                purBills[purIdx] = { ...purBills[purIdx], reconcileResult: '对账完成', diffNote: '供应商按采方入账', purchaserReconciler: operatorName };
                localStorage.setItem(purKey, JSON.stringify(purBills));
              }
            }
          }
        } catch { /* ignore */ }
        try {
          let rows: any[] = JSON.parse(localStorage.getItem(key) || '[]');
          if (!Array.isArray(rows)) rows = [];
          const idx = rows.findIndex(x => (!!r.orderNo && x.id === r.orderNo) || (!!x.outboundNo && String(x.outboundNo).trim() === String(r.docNo || '').trim()));
          if (idx >= 0) {
            rows[idx] = {
              ...rows[idx], items, totalQty,
              totalCount: totalQty,
              productDetail: items.map((i: any) => `${i.productCode || ''}×${i.quantity}`).join('，'),
              totalAmount: Number(r.theirAmount) || 0,
              reconResult: '按采方入账', diffDesc: '本方未入账，按采方入账',
              supplierReconPerson: operatorName,
              purchaserReconPerson: operatorName,
            };
          } else {
            rows.unshift({
              id: `SD-${Math.floor(10000000 + Math.random() * 89999999)}`,
              key: `SD-${Date.now()}`,
              _manual: true,
              outboundNo: r.docNo,
              outboundDate: today,
              date: today,
              createdAt: today,
              customerName: r.customerName || r.counterparty || '',
              items,
              totalCount: totalQty,
              productDetail: items.map((i: any) => `${i.productCode || ''}×${i.quantity}`).join('，'),
              totalAmount: Number(r.theirAmount) || 0,
              paidAmount: 0,
              receivableAmount: Number(r.theirAmount) || 0,
              reconResult: '按采方入账',
              diffDesc: '本方未入账，按采方入账',
              supplierReconPerson: operatorName,
              purchaserReconPerson: operatorName,
              confirmTime: '',
            });
          }
          localStorage.setItem(key, JSON.stringify(rows));
        } catch { /* ignore */ }
        setDetailVisible(false);
        message.success('已按采购商账单入账：供应商账单明细已更新/新增并标记“按采方入账”');
      },
    });
  }, [getOwner, completeRecon]);

  /** 打开手动关联单据弹窗（采购商平台：选择采购账单；供应商平台：选择未完成对账的供应商账单） */
  const handleOpenLink = useCallback((record: ReconRecord) => {
    let bills: any[] = [];
    if (isPurchaser) {
      try { bills = JSON.parse(localStorage.getItem('purchaser_bills_' + getOwner()) || '[]'); } catch { /* ignore */ }
      if (!Array.isArray(bills)) bills = [];
      // 已对账完成的账单（已对账/按供方入账）不显示在手动关联窗口中
      bills = bills.filter(b => !['已对账', '按供方入账', '已发起对账'].includes(String(b.reconcileResult || '')));
      // 对方校验：仅显示供应商与本对账记录一致的采购账单，避免手动关联到其它供应商的账单
      const cpSupplier = String(record.supplierName || (record.initiator === 'purchaser' ? record.counterparty : '') || '').trim();
      if (cpSupplier) bills = bills.filter(b => String(b.supplier || '').trim() === cpSupplier);
    } else {
      try { bills = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${getOwner()}`) || '[]'); } catch { /* ignore */ }
      if (!Array.isArray(bills)) bills = [];
      // 仅显示未完成对账的供应商账单
      bills = bills.filter(b => !['对账完成', '按采方入账'].includes(String(b.reconResult || '')));
      // 对方校验：仅显示采购商与本对账记录一致的供应商账单明细，避免手动关联到其它采购商的账单
      const cpCustomer = String(record.customerName || '').trim();
      if (cpCustomer) bills = bills.filter(b => String(b.customerName || '').trim() === cpCustomer);
    }
    setLinkBills(bills);
    setLinkSearch({ ...emptyLinkSearch });
    setLinkSearchApplied({ ...emptyLinkSearch });
    setLinkPick(record.matchedBillKey || record.orderNo || '');
    setLinkRecord(record);
    setLinkVisible(true);
  }, [getOwner, isPurchaser]);

  // 手动关联弹窗：按字段搜索过滤（点击查询后生效）
  const linkQtyOf = (b: any) => Number(b.totalQty) || (Array.isArray(b.items) ? b.items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0) : 0);
  const linkFilteredBills = useMemo(() => linkBills.filter(b => {
    const s = linkSearchApplied;
    if (s.no.trim() && !String(b.outboundNo || '').includes(s.no.trim()) && !String(b.id || '').includes(s.no.trim())) return false;
    if (s.supplier.trim() && !String(b.supplier || b.customerName || '').includes(s.supplier.trim())) return false;
    if (s.date.trim() && !String(b.date || '').includes(s.date.trim())) return false;
    if (s.qty.trim() && !String(linkQtyOf(b)).includes(s.qty.trim())) return false;
    if (s.amount.trim() && !String(Number(b.totalAmount) || 0).includes(s.amount.trim()) && !(Number(b.totalAmount) || 0).toFixed(2).includes(s.amount.trim())) return false;
    return true;
  }), [linkBills, linkSearchApplied]);

  /** 确认手动关联：关联后自动核对明细与总金额，并填充辅助单据号 */
  const handleLinkConfirm = useCallback(() => {
    if (!linkRecord || !linkPick) { message.warning(isPurchaser ? '请选择要关联的采购账单' : '请选择要关联的供应商账单'); return; }
    // 不调用 releaseSync，而是直接更新快照：关联变更保留，但后续自动核对结果仍受实时同步开关控制
    const updatedRecord = isPurchaser ? { ...linkRecord, matchedBillKey: linkPick } : { ...linkRecord, orderNo: linkPick };
    syncedReconRef.current[linkRecord.key] = updatedRecord;
    setDataSource(prev => prev.map(r => (r.key === linkRecord.key ? updatedRecord : r)));
    // 填充辅助单据号（重新关联时清除旧单号，写入新单号）
    try {
      if (isPurchaser) {
        // 采购商关联：将供应商单据编号写入采购账单的辅助单据号
        const owner = getOwner();
        const key = `purchaser_bills_${owner}`;
        const bills: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(bills)) {
          // 重新关联时：清除旧关联账单的辅助单据号
          const oldMatchedKey = linkRecord.matchedBillKey;
          if (oldMatchedKey && oldMatchedKey !== linkPick) {
            const oldIdx = bills.findIndex(b => b.key === oldMatchedKey);
            if (oldIdx >= 0) {
              bills[oldIdx] = { ...bills[oldIdx], auxDocNo: '' };
            }
          }
          // 写入新关联账单的辅助单据号，并存储供应商账单ID用于重新发起时恢复
          const idx = bills.findIndex(b => b.key === linkPick);
          if (idx >= 0) {
            bills[idx] = { ...bills[idx], auxDocNo: linkRecord.docNo || '', linkedSupplierBillId: linkRecord.orderNo || '' };
            localStorage.setItem(key, JSON.stringify(bills));
          }
        }
      } else {
        // 供应商关联：将采购商单据编号写入供应商账单明细的辅助单据号
        const owner = getOwner();
        const key = `pageData_customer_bill-detail_${owner}`;
        const rows: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(rows)) {
          // 重新关联时：清除旧关联账单的辅助单据号
          const oldLinkedId = linkRecord.orderNo;
          if (oldLinkedId && oldLinkedId !== linkPick) {
            const oldIdx = rows.findIndex(x => x.id === oldLinkedId);
            if (oldIdx >= 0) {
              rows[oldIdx] = { ...rows[oldIdx], auxDocNo: '' };
            }
          }
          // 写入新关联账单的辅助单据号，并存储采购商账单key用于重新发起时恢复
          const idx = rows.findIndex(x => x.id === linkPick);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], auxDocNo: linkRecord.docNo || '', matchedPurchaserBillKey: linkRecord.matchedBillKey || '' };
            localStorage.setItem(key, JSON.stringify(rows));
          }
        }
      }
    } catch { /* ignore */ }
    setLinkVisible(false);
    message.success('已关联单据，系统正在自动核对明细与总金额');
  }, [linkRecord, linkPick, isPurchaser, getOwner]);

  /** 导出 */
  const handleExport = useCallback(() => {
    const headers = ['单据编号', '对账类型', '对方名称', `${lblOur}金额`, `${lblTheir}金额`, '对账结果', '差异说明', '本方录入', '对方入账', '确认人', '确认时间'];
    const rows = filteredData.map(item => [
      item.docNo,
      reconTypeLabel[item.reconType],
      item.counterparty,
      item.ourAmount,
      item.theirAmount,
      item.reconResult === 'pending' ? pendingLabel(item) : resultLabel[item.reconResult],
      item.diffDesc,
      item.ourEntryDate,
      item.theirEntryDate,
      item.confirmedBy || '-',
      item.confirmedAt || '-',
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '对账管理_导出.csv';
    link.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  }, [filteredData, lblOur, lblTheir, resultLabel]);

  /** 重置 */
  const handleReset = useCallback(() => {
    setSearchText('');
    setTypeFilter('');
    setResultFilter('');
  }, []);

  // ==================== 表格列 ====================
  const columns: ColumnsType<ReconRecord> = [
    { title: '单据编号', dataIndex: 'docNo', key: 'docNo', width: 160, fixed: 'left' },
    {
      title: '对账类型', dataIndex: 'reconType', key: 'reconType', width: 100,
      render: (v: ReconType) => <Tag color={reconTypeColor[v]}>{reconTypeLabel[v]}</Tag>,
    },
    {
      title: '对方名称', dataIndex: 'counterparty', key: 'counterparty', width: 160,
      render: (v: string, r: ReconRecord) => {
        // 采购商平台对方=供应商；供应商平台对方=客户（采购商发起的请求显示采购商公司）
        const name = isPurchaser ? (r.supplierName || v) : (r.initiator === 'purchaser' ? (r.customerName || v) : v);
        return (
          <Space>
            {isPurchaser ? <ShopOutlined /> : <UserOutlined />}
            <span>{name}</span>
          </Space>
        );
      },
    },
    {
      // 发起方：供应商 / 采购商
      title: '发起方', key: 'initiator', width: 90, align: 'center',
      render: (_: unknown, r: ReconRecord) => {
        const ini = r.initiator || (r.source === 'bill' ? 'supplier' : '');
        return ini ? <Tag color={ini === 'supplier' ? 'gold' : 'blue'}>{ini === 'supplier' ? '供应商' : '采购商'}</Tag> : <Text type="secondary">-</Text>;
      },
    },
    {
      title: `${lblOur}金额`, dataIndex: 'ourAmount', key: 'ourAmount', width: 120, align: 'right',
      render: (v: number, r: ReconRecord) => (
        v === 0
          ? (r.initiator === 'purchaser' ? <span /> : <Text type="secondary">{zeroOurField}</Text>)
          : <Text style={{ fontFamily: 'monospace' }}>¥{v.toLocaleString()}</Text>
      ),
    },
    {
      title: `${lblTheir}金额`, dataIndex: 'theirAmount', key: 'theirAmount', width: 120, align: 'right',
      render: (v: number, r: ReconRecord) => (
        v === 0
          ? (r.initiator === 'supplier' ? <span /> : <Text type="secondary">{zeroTheirField}</Text>)
          : <Text style={{ fontFamily: 'monospace', color: v === r.ourAmount ? '#52c41a' : '#ff4d4f' }}>
              ¥{v.toLocaleString()}
            </Text>
      ),
    },
    {
      title: '对账结果', dataIndex: 'reconResult', key: 'reconResult', width: 180,
      render: (v: ReconResult, r: ReconRecord) => {
        const isPurple = !isPurchaser && v === 'pending' && r.initiator === 'purchaser';
        return (
          <Tag color={isPurple ? 'purple' : reconResultColor[v]} icon={reconResultIcon[v]}>
            {v === 'pending' ? pendingLabel(r) : resultLabel[v]}
          </Tag>
        );
      },
    },
    {
      title: '差异说明', dataIndex: 'diffDesc', key: 'diffDesc', width: 200, ellipsis: true,
      render: (v: string) => v ? <Text type={v.includes('一致') ? 'warning' : 'danger'}>{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      // 对方反馈独立列（差异说明右侧）：显示反馈条数，对方新增内容数量闪烁提示
      title: '对方反馈', key: 'feedback', width: 110, align: 'center',
      render: (_: unknown, record: ReconRecord) => {
        const count = loadFeedbackThread(record.docNo).length;
        const unseen = unseenFeedbackCount(record);
        return (
          <Badge count={unseen} className={unseen > 0 ? 'recon-badge-blink' : ''}>
            <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => openFeedback(record)}>
              {count > 0 ? `${count}条` : '查看'}
            </Button>
          </Badge>
        );
      },
    },
    { title: '本方录入', dataIndex: 'ourEntryDate', key: 'ourEntryDate', width: 100 },
    { title: '对方入账', dataIndex: 'theirEntryDate', key: 'theirEntryDate', width: 100 },
    {
      title: '操作', key: 'action', width: 220, fixed: 'right',
      render: (_, record) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', columnGap: 8, rowGap: 4, justifyContent: 'start' }}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>
            查看明细
          </Button>
          {/* 采购商平台：确认入账 / 账单不符 */}
          {isPurchaser && (
            <Button type="link" size="small" icon={<SafetyCertificateOutlined />} style={{ color: '#52c41a' }} onClick={() => handleConfirmEntry(record)}>
              确认入账
            </Button>
          )}
          {isPurchaser && record.initiator !== 'purchaser' && (
            <Button type="link" size="small" icon={<ExclamationCircleOutlined />} danger onClick={() => handleBillMismatch(record)}>
              账单不符
            </Button>
          )}
          {/* 采购商平台：供应商发起的对账未自动匹配到单据时，可手动关联（采购商发起的不需要） */}
          {isPurchaser && record.source === 'bill' && !record.matchedBillKey && record.initiator !== 'purchaser' && (
            <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => handleOpenLink(record)}>
              手动关联
            </Button>
          )}
          {/* 采购商平台：已手动关联后显示“重新关联”按键，可重新选择其他账单 */}
          {isPurchaser && record.source === 'bill' && record.matchedBillKey && record.initiator !== 'purchaser' && (
            <Button type="link" size="small" icon={<SwapOutlined />} style={{ color: '#1677ff' }} onClick={() => handleOpenLink(record)}>
              重新关联
            </Button>
          )}
          {/* 供应商平台：采购商发起的对账→确认对账 */}
          {!isPurchaser && record.initiator === 'purchaser' && (
            <Button type="link" size="small" icon={<SafetyCertificateOutlined />} style={{ color: '#52c41a' }} onClick={() => handleConfirmRecon(record)}>
              确认对账
            </Button>
          )}
          {/* 供应商平台：采购商发起的对账未关联供应商账单时，可手动关联 */}
          {!isPurchaser && record.initiator === 'purchaser' && !record.orderNo && (
            <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => handleOpenLink(record)}>
              手动关联
            </Button>
          )}
          {/* 供应商平台：已手动关联后显示“重新关联”按键 */}
          {!isPurchaser && record.initiator === 'purchaser' && record.orderNo && (
            <Button type="link" size="small" icon={<SwapOutlined />} style={{ color: '#1677ff' }} onClick={() => handleOpenLink(record)}>
              重新关联
            </Button>
          )}
          {/* 供应商平台：采购商发起的对账→账目不符（对方反馈弹窗） */}
          {!isPurchaser && record.initiator === 'purchaser' && (
            <Button type="link" size="small" icon={<ExclamationCircleOutlined />} danger onClick={() => openFeedback(record)}>
              账目不符
            </Button>
          )}
          {record.confirmedBy && (
            <Tag color="green" style={{ marginLeft: 8 }}>已确认</Tag>
          )}
        </div>
      ),
    },
  ];

  // ==================== 明细对账表格列 ====================
  const ourBg = '#e6f7ff'; // 本方列蓝色底色
  const theirBg = '#fff0f6'; // 对方列浅粉色底色
  const detailColumns: ColumnsType<ReconDetailItem> = [
    { title: '货号', dataIndex: 'itemNo', key: 'itemNo', width: 100, align: 'center', render: (_v: string, d: ReconDetailItem) => <Text style={{ fontFamily: 'monospace' }}>{d.styleCode || String(d.itemNo || '').split('-')[0]}</Text> },
    { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 120, align: 'center', render: (_v: unknown, d: ReconDetailItem) => <Text style={{ fontFamily: 'monospace' }}>{d.itemNo}</Text> },
    { title: '货品名称', dataIndex: 'itemName', key: 'itemName', width: 130, align: 'center', render: (v: string, d: ReconDetailItem) => v || d.itemNo || '-' },
    {
      title: `${lblOur}数量`, dataIndex: 'ourQty', key: 'ourQty', width: 90, align: 'center',
      onCell: () => ({ style: { background: ourBg } }),
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: `${lblTheir}数量`, dataIndex: 'theirQty', key: 'theirQty', width: 90, align: 'center',
      onCell: () => ({ style: { background: theirBg } }),
      render: (v: number, r: ReconDetailItem) => (
        <Text
          style={{
            fontFamily: 'monospace',
            color: v === r.ourQty ? undefined : '#ff4d4f',
            fontWeight: v === r.ourQty ? undefined : 'bold',
          }}
        >
          {selectedRecord?.reconResult === 'pending' ? '-' : v}
        </Text>
      ),
    },
    {
      title: `${lblOur}单价`, dataIndex: 'ourPrice', key: 'ourPrice', width: 100, align: 'center',
      onCell: () => ({ style: { background: ourBg } }),
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>¥{v.toLocaleString()}</Text>,
    },
    {
      title: `${lblTheir}单价`, dataIndex: 'theirPrice', key: 'theirPrice', width: 100, align: 'center',
      onCell: () => ({ style: { background: theirBg } }),
      render: (v: number, r: ReconDetailItem) => (
        <Text
          style={{
            fontFamily: 'monospace',
            color: v === r.ourPrice ? undefined : '#ff4d4f',
            fontWeight: v === r.ourPrice ? undefined : 'bold',
          }}
        >
          {selectedRecord?.reconResult === 'pending' ? '-' : `¥${v.toLocaleString()}`}
        </Text>
      ),
    },
    {
      title: `${lblOur}小计`, dataIndex: 'ourSubTotal', key: 'ourSubTotal', width: 110, align: 'center',
      onCell: () => ({ style: { background: ourBg } }),
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>¥{v.toLocaleString()}</Text>,
    },
    {
      title: `${lblTheir}小计`, dataIndex: 'theirSubTotal', key: 'theirSubTotal', width: 110, align: 'center',
      onCell: () => ({ style: { background: theirBg } }),
      render: (v: number, r: ReconDetailItem) => (
        <Text
          style={{
            fontFamily: 'monospace',
            color: v === r.ourSubTotal ? '#52c41a' : '#ff4d4f',
            fontWeight: v === r.ourSubTotal ? undefined : 'bold',
          }}
        >
          {selectedRecord?.reconResult === 'pending' ? '-' : `¥${v.toLocaleString()}`}
        </Text>
      ),
    },
    {
      title: '明细结果', dataIndex: 'match', key: 'match', width: 100, align: 'center',
      render: (v: boolean, _: ReconDetailItem) => {
        if (selectedRecord?.reconResult === 'pending') return <Tag>待入账</Tag>;
        return v
          ? <Tag color="green" icon={<CheckCircleOutlined />}>一致</Tag>
          : <Tag color="red" icon={<CloseCircleOutlined />}>不一致</Tag>;
      },
    },
  ];

  return (
    <div>
      {/* 对账流程说明 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Steps
              size="small"
              current={-1}
              items={[
                {
                  title: '录入单据',
                  description: '录入销售/采购单据',
                  icon: <FileTextOutlined />,
                },
                {
                  title: '对方入账',
                  description: '客户/供应商确认入账',
                  icon: <SwapOutlined />,
                },
                {
                  title: '自动比对',
                  description: '按单据编号比对金额',
                  icon: <DiffOutlined />,
                },
                {
                  title: '结果确认',
                  description: '确认或处理差异',
                  icon: <AuditOutlined />,
                },
              ]}
            />
          </Col>
          <Col>
            <div style={{
              background: '#f6ffed', borderRadius: 8, padding: '10px 16px',
              border: '1px solid #b7eb8f',
            }}>
              <InfoCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
              <Text style={{ color: '#389e0d', fontSize: 13 }}>
                对账规则：优先按单据编号匹配，比对同一单据金额是否一致。
                <br />金额一致但明细不一致时标注"金额一致，明细不一致"。
              </Text>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={4}>
          <Card bodyStyle={{ padding: '14px 18px' }} hoverable onClick={() => setActiveTab('all')}>
            <Statistic
              title={<Text style={{ fontSize: 12 }}>待对账单据</Text>}
              value={stats.pending}
              prefix={<ClockCircleOutlined style={{ fontSize: 18, color: '#8c8c8c' }} />}
              suffix={<Text style={{ fontSize: 12, color: '#999' }}>张</Text>}
              valueStyle={{ color: '#8c8c8c', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={5}>
          <Card bodyStyle={{ padding: '14px 18px' }} hoverable onClick={() => setActiveTab('all')}>
            <Statistic
              title={<Text style={{ fontSize: 12 }}>已对账一致</Text>}
              value={stats.matched}
              prefix={<CheckCircleOutlined style={{ fontSize: 18, color: '#52c41a' }} />}
              suffix={<Text style={{ fontSize: 12, color: '#999' }}>张</Text>}
              valueStyle={{ color: '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={5}>
          <Card bodyStyle={{ padding: '14px 18px' }} hoverable onClick={() => setActiveTab('abnormal')}>
            <Statistic
              title={<Text style={{ fontSize: 12 }}>明细差异</Text>}
              value={stats.detailDiff}
              prefix={<WarningOutlined style={{ fontSize: 18, color: '#faad14' }} />}
              suffix={<Text style={{ fontSize: 12, color: '#999' }}>张</Text>}
              valueStyle={{ color: '#faad14', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={5}>
          <Card bodyStyle={{ padding: '14px 18px' }} hoverable onClick={() => setActiveTab('abnormal')}>
            <Statistic
              title={<Text style={{ fontSize: 12 }}>金额差异</Text>}
              value={stats.amountDiff}
              prefix={<CloseCircleOutlined style={{ fontSize: 18, color: '#ff4d4f' }} />}
              suffix={<Text style={{ fontSize: 12, color: '#999' }}>张</Text>}
              valueStyle={{ color: '#ff4d4f', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={5}>
          <Card bodyStyle={{ padding: '14px 18px' }}>
            <Statistic
              title={<Text style={{ fontSize: 12 }}>对账完成率</Text>}
              value={stats.rate}
              prefix={<SafetyCertificateOutlined style={{ fontSize: 18, color: PRIMARY }} />}
              suffix="%"
              valueStyle={{ color: PRIMARY, fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 分类 Tab */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '0 24px' }}>
        <Tabs
          activeKey={activeTab}
          onChange={key => {
            setActiveTab(key);
            setTypeFilter('');
            setResultFilter('');
          }}
          style={{ marginBottom: -16 }}
          items={[
            { key: 'all', label: <Space><FileTextOutlined />全部 ({roleData.length})</Space> },
            { key: 'customer', label: <Space><UserOutlined />客户对账 ({roleData.filter(r => (r.initiator || 'supplier') === 'purchaser').length})</Space> },
            { key: 'supplier', label: <Space><ShopOutlined />供应商对账 ({roleData.filter(r => (r.initiator || 'supplier') !== 'purchaser').length})</Space> },
            { key: 'pending', label: <Space><ClockCircleOutlined />待入账 ({stats.pending})</Space> },
            { key: 'abnormal', label: <Space><WarningOutlined />异常单据 ({stats.detailDiff + stats.amountDiff})</Space> },
          ]}
        />
      </Card>

      {/* 搜索筛选 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} sm={6}>
            <Input
              placeholder="搜索单据编号/对方名称"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="对账类型"
              value={typeFilter || undefined}
              onChange={v => setTypeFilter(v || '')}
              allowClear
              style={{ width: '100%' }}
            >
              <Option value="customer">客户对账</Option>
              <Option value="supplier">供应商对账</Option>
            </Select>
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="对账结果"
              value={resultFilter || undefined}
              onChange={v => setResultFilter(v || '')}
              allowClear
              style={{ width: '100%' }}
            >
              <Option value="matched">金额一致</Option>
              <Option value="detail_diff">金额一致/明细不一致</Option>
              <Option value="amount_diff">金额不一致</Option>
              <Option value="pending">{resultLabel.pending}</Option>
            </Select>
          </Col>
          <Col xs={24} sm={4}>
            <Space>
              <Button type="primary" icon={<SearchOutlined />}>查询</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          <Col xs={0} sm={6} style={{ textAlign: 'right' }}>
            <Space>
              <Tooltip title="功能说明：开启后，对账结果完全一致（金额一致且明细全部一致）的单据将自动完成对账，并在双方账单写明“自动核对（金额与明细完全一致）”；关闭后仍需人工确认入账/确认对账。">
                <Space size={4} style={{ marginRight: 4, cursor: 'pointer' }}>
                  <Text style={{ fontSize: 13 }}>自动对账</Text>
                  <Switch size="small" checked={autoRecon}
                    onChange={v => {
                      setAutoRecon(v);
                      try { localStorage.setItem(autoReconKey, v ? '1' : '0'); } catch { /* ignore */ }
                      message.success(v ? '自动对账已开启：完全一致的单据将自动完成并在账单写明自动核对' : '自动对账已关闭：完全一致单据仍需人工确认');
                    }} />
                </Space>
              </Tooltip>
              <Tooltip title="功能说明：开启后，对方推送过来的账单（发起方为对方）的对账情况将实时同步给对方；关闭后，仅在本方对账完成或提交账目不符反馈后，才将本方对账情况同步给对方。">
                <Space size={4} style={{ marginRight: 4, cursor: 'pointer' }}>
                  <Text style={{ fontSize: 13 }}>实时同步</Text>
                  <Switch size="small" checked={realTimeSync}
                    onChange={v => {
                      setRealTimeSync(v);
                      try { localStorage.setItem(realTimeSyncKey, v ? '1' : '0'); } catch { /* ignore */ }
                      message.success(v ? '实时同步已开启：对方推送账单的对账情况将实时同步给对方' : '实时同步已关闭：仅本方对账完成或提交账目不符反馈后同步给对方');
                    }} />
                </Space>
              </Tooltip>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出报表</Button>
              <Dropdown menu={{
                items: [
                  { key: 'customer', icon: <UserOutlined />, label: '录入客户单据' },
                  { key: 'supplier', icon: <ShopOutlined />, label: '录入供应商单据' },
                ],
                onClick: ({ key }) => handleEntry(key as ReconType),
              }}>
                <Button type="primary" icon={<FileTextOutlined />}>录入新单据</Button>
              </Dropdown>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 数据表格 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
          }}
          columns={columns}
          dataSource={filteredData}
          scroll={{ x: 1400 }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
          }}
          locale={{ emptyText: '暂无对账数据' }}
        />
      </Card>

      {/* ============ 明细详情弹窗（屏幕居中显示，加宽） ============ */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <Space>
              <FileTextOutlined style={{ color: PRIMARY }} />
              <span>对账明细</span>
            </Space>
            {selectedRecord && (
              <Space>
                {/* 对方反馈（供应商/采购商完全同步；对方新增内容数量闪烁提示） */}
                <Badge count={unseenFeedbackCount(selectedRecord)} className={unseenFeedbackCount(selectedRecord) > 0 ? 'recon-badge-blink' : ''}>
                  <Button icon={<MessageOutlined />} onClick={() => openFeedback(selectedRecord)}>对方反馈</Button>
                </Badge>
                {/* 采购商：对账结果存在不一致/未入账时，可按供方账单入账 */}
                {isPurchaser && ['detail_diff', 'amount_diff', 'pending'].includes(selectedRecord.reconResult) && (
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => { handleEntryBySupplier(selectedRecord); setDetailVisible(false); }}
                  >
                    按供方账单入账
                  </Button>
                )}
                {/* 供应商：采购商发起的对账→确认对账 / 按采购商账单入账 */}
                {!isPurchaser && selectedRecord.initiator === 'purchaser' && (
                  <Button icon={<SafetyCertificateOutlined />} style={{ color: '#52c41a' }} onClick={() => handleConfirmRecon(selectedRecord)}>
                    确认对账
                  </Button>
                )}
                {!isPurchaser && selectedRecord.initiator === 'purchaser' && ['detail_diff', 'amount_diff', 'pending'].includes(selectedRecord.reconResult) && (
                  <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleEntryByPurchaser(selectedRecord)}>
                    按采购商账单入账
                  </Button>
                )}
              </Space>
            )}
          </div>
        }
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width={1100}
        centered
        footer={null}
        destroyOnClose
        bodyStyle={{ maxHeight: '72vh', overflowY: 'auto' }}
      >
        {selectedRecord && (
          <>
            {/* 对账概要 */}
            <Card size="small" style={{ marginBottom: 16 }} title={
              <Space>
                <FileTextOutlined />
                <span>对账概要</span>
              </Space>
            }>
              <Descriptions column={2} size="small" bordered>
                {(() => {
                  // 确定本方/对方单据编号
                  const docNo = selectedRecord.docNo || '';
                  const isSupplierInitiated = selectedRecord.initiator === 'supplier';
                  let ourDocNo = '';
                  let theirDocNo = '';
                  if (isPurchaser) {
                    // 采购商平台：本方=采购商，对方=供应商
                    if (isSupplierInitiated) {
                      theirDocNo = docNo; // 供应商发起，docNo是供应商单据编号
                      // 查找本方（采购商）单据编号
                      try {
                        const owner = getOwner();
                        const bills = JSON.parse(localStorage.getItem(`purchaser_bills_${owner}`) || '[]');
                        const bill = bills.find((b: any) => b.key === selectedRecord.matchedBillKey);
                        if (bill) ourDocNo = bill.outboundNo || '';
                      } catch { /* ignore */ }
                    } else {
                      ourDocNo = docNo; // 采购商发起，docNo是采购商单据编号
                      // 查找对方（供应商）单据编号
                      try {
                        const supOwner = selectedRecord.supplierUsername || '';
                        if (supOwner) {
                          const rows = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${supOwner}`) || '[]');
                          const row = rows.find((x: any) => x.id === selectedRecord.orderNo);
                          if (row) theirDocNo = row.outboundNo || row.id || '';
                        }
                      } catch { /* ignore */ }
                    }
                  } else {
                    // 供应商平台：本方=供应商，对方=采购商
                    if (isSupplierInitiated) {
                      ourDocNo = docNo; // 供应商发起，docNo是供应商单据编号
                      // 查找对方（采购商）单据编号
                      try {
                        const purOwner = selectedRecord.customerUsername || '';
                        if (purOwner && selectedRecord.matchedBillKey) {
                          const bills = JSON.parse(localStorage.getItem(`purchaser_bills_${purOwner}`) || '[]');
                          const bill = bills.find((b: any) => b.key === selectedRecord.matchedBillKey);
                          if (bill) theirDocNo = bill.outboundNo || '';
                        }
                      } catch { /* ignore */ }
                    } else {
                      theirDocNo = docNo; // 采购商发起，docNo是采购商单据编号
                      // 查找本方（供应商）单据编号
                      try {
                        const owner = getOwner();
                        const rows = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${owner}`) || '[]');
                        const row = rows.find((x: any) => x.id === selectedRecord.orderNo);
                        if (row) ourDocNo = row.outboundNo || row.id || '';
                      } catch { /* ignore */ }
                    }
                  }
                  return (
                    <>
                      <Descriptions.Item label="本方单据编号">
                        <Text strong>{ourDocNo || '-'}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="对方单据编号">
                        <Text strong>{theirDocNo || '-'}</Text>
                      </Descriptions.Item>
                    </>
                  );
                })()}
                <Descriptions.Item label="对账类型">
                  <Tag color={reconTypeColor[selectedRecord.reconType]}>
                    {reconTypeLabel[selectedRecord.reconType]}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="对方名称">{selectedRecord.counterparty}</Descriptions.Item>
                <Descriptions.Item label="对方编码">{selectedRecord.counterpartyCode}</Descriptions.Item>
                <Descriptions.Item label={`${lblOur}金额`}>
                  <Text strong style={{ fontFamily: 'monospace', color: selectedRecord.ourAmount === 0 ? '#999' : PRIMARY }}>
                    {selectedRecord.ourAmount === 0 ? zeroOurField : `¥${selectedRecord.ourAmount.toLocaleString()}`}
                  </Text>
                </Descriptions.Item>
                <Descriptions.Item label={`${lblTheir}金额`}>
                  <Text strong style={{
                    fontFamily: 'monospace',
                    color: selectedRecord.theirAmount === 0 ? '#999'
                      : selectedRecord.theirAmount === selectedRecord.ourAmount ? '#52c41a' : '#ff4d4f',
                  }}>
                    {selectedRecord.theirAmount === 0 ? zeroTheirField : `¥${selectedRecord.theirAmount.toLocaleString()}`}
                  </Text>
                </Descriptions.Item>
                <Descriptions.Item label="对账结果" span={2}>
                  {(() => {
                    const isPurple = !isPurchaser && selectedRecord.reconResult === 'pending' && selectedRecord.initiator === 'purchaser';
                    return (
                      <Tag color={isPurple ? 'purple' : reconResultColor[selectedRecord.reconResult]} icon={reconResultIcon[selectedRecord.reconResult]}>
                        {selectedRecord.reconResult === 'pending' ? pendingLabel(selectedRecord) : resultLabel[selectedRecord.reconResult]}
                      </Tag>
                    );
                  })()}
                  {selectedRecord.confirmedBy && (
                    <Tag color="green" style={{ marginLeft: 8 }}>已确认</Tag>
                  )}
                </Descriptions.Item>
                {selectedRecord.diffDesc && (
                  <Descriptions.Item label="差异说明" span={2}>
                    <Text type={selectedRecord.reconResult === 'detail_diff' ? 'warning' : 'danger'}>
                      {selectedRecord.diffDesc}
                    </Text>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="本方录入">{selectedRecord.ourEntryDate}</Descriptions.Item>
                <Descriptions.Item label="对方入账">
                  {selectedRecord.theirEntryDate === '-' ? <Text type="secondary">未入账</Text> : selectedRecord.theirEntryDate}
                </Descriptions.Item>
                {selectedRecord.confirmedBy && (
                  <>
                    <Descriptions.Item label="确认人">{selectedRecord.confirmedBy}</Descriptions.Item>
                    <Descriptions.Item label="确认时间">{selectedRecord.confirmedAt}</Descriptions.Item>
                  </>
                )}
              </Descriptions>
            </Card>

            {/* 金额对比 */}
            {selectedRecord.reconResult !== 'pending' && (
              <Card size="small" style={{ marginBottom: 16 }}>
                <Row gutter={24} justify="center" align="middle">
                  <Col style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{lblOur}金额</Text>
                    <div>
                      <Text strong style={{ fontSize: 20, fontFamily: 'monospace', color: selectedRecord.ourAmount === 0 ? '#999' : PRIMARY }}>
                        {selectedRecord.ourAmount === 0 ? zeroOurField : `¥${selectedRecord.ourAmount.toLocaleString()}`}
                      </Text>
                    </div>
                  </Col>
                  <Col>
                    {selectedRecord.ourAmount === selectedRecord.theirAmount
                      ? <CheckCircleOutlined style={{ fontSize: 28, color: '#52c41a' }} />
                      : <CloseCircleOutlined style={{ fontSize: 28, color: '#ff4d4f' }} />
                    }
                  </Col>
                  <Col style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{lblTheir}金额</Text>
                    <div>
                      <Text strong style={{
                        fontSize: 20, fontFamily: 'monospace',
                        color: selectedRecord.ourAmount === selectedRecord.theirAmount ? '#52c41a' : '#ff4d4f',
                      }}>
                        ¥{selectedRecord.theirAmount.toLocaleString()}
                      </Text>
                    </div>
                  </Col>
                </Row>
                {selectedRecord.ourAmount !== selectedRecord.theirAmount && (
                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <Tag color="red" style={{ fontSize: 13, padding: '4px 12px' }}>
                      差额：¥{Math.abs(selectedRecord.ourAmount - selectedRecord.theirAmount).toLocaleString()}
                    </Tag>
                  </div>
                )}
              </Card>
            )}

            {/* 明细比对表 */}
            <Card size="small" title={
              <Space>
                <DiffOutlined />
                <span>明细比对</span>
                {selectedRecord.reconResult === 'detail_diff' && (
                  <Tag color="orange">金额一致，明细不一致</Tag>
                )}
              </Space>
            }>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <Popover
                  trigger="click"
                  title="显示字段"
                  content={
                    <div style={{ width: 180 }}>
                      {([
                        { key: 'itemNo', label: '货号' },
                        { key: 'productCode', label: '商品编码' },
                        { key: 'itemName', label: '货品名称' },
                        { key: 'ourQty', label: `${lblOur}数量` },
                        { key: 'theirQty', label: `${lblTheir}数量` },
                        { key: 'ourPrice', label: `${lblOur}单价` },
                        { key: 'theirPrice', label: `${lblTheir}单价` },
                        { key: 'ourSubTotal', label: `${lblOur}小计` },
                        { key: 'theirSubTotal', label: `${lblTheir}小计` },
                      ] as { key: string; label: string }[]).map(f => (
                        <div key={f.key} style={{ padding: '2px 0' }}>
                          <Checkbox
                            checked={detailFields[f.key] !== false}
                            onChange={e => setDetailFields(prev => ({ ...prev, [f.key]: e.target.checked }))}
                          >
                            {f.label}
                          </Checkbox>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <Button size="small" icon={<SettingOutlined />}>显示字段</Button>
                </Popover>
              </div>
              <Table
                bordered
                columns={detailColumns.filter(c => detailFields[String(c.key)] !== false)}
                dataSource={selectedRecord.details}
                rowKey="itemNo"
                size="small"
                scroll={{ x: 800 }}
                pagination={false}
                summary={() => {
                  const ourTotal = selectedRecord.details.reduce((s, d) => s + d.ourSubTotal, 0);
                  const theirTotal = selectedRecord.details.reduce((s, d) => s + d.theirSubTotal, 0);
                  return (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ fontWeight: 'bold' }}>
                        <Table.Summary.Cell index={0} colSpan={3} align="center">合计</Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="center">
                          <div style={{ background: ourBg, padding: '4px 8px' }}>
                            <Text strong style={{ fontFamily: 'monospace' }}>{selectedRecord.details.reduce((s, d) => s + d.ourQty, 0)}</Text>
                          </div>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="center">
                          <div style={{ background: theirBg, padding: '4px 8px' }}>
                            <Text strong style={{ fontFamily: 'monospace' }}>{selectedRecord.reconResult === 'pending' ? '-' : selectedRecord.details.reduce((s, d) => s + d.theirQty, 0)}</Text>
                          </div>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="center">
                          <div style={{ background: ourBg, padding: '4px 8px' }}>-</div>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={6} align="center">
                          <div style={{ background: theirBg, padding: '4px 8px' }}>-</div>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="center">
                          <div style={{ background: ourBg, padding: '4px 8px' }}>
                            <Text strong style={{ fontFamily: 'monospace' }}>¥{ourTotal.toLocaleString()}</Text>
                          </div>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={8} align="center">
                          <div style={{ background: theirBg, padding: '4px 8px' }}>
                            <Text strong style={{
                              fontFamily: 'monospace',
                              color: ourTotal === theirTotal ? '#52c41a' : '#ff4d4f',
                            }}>
                              {selectedRecord.reconResult === 'pending' ? '-' : `¥${theirTotal.toLocaleString()}`}
                            </Text>
                          </div>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={9} align="center">
                          {selectedRecord.reconResult === 'matched' || (ourTotal === theirTotal && selectedRecord.reconResult !== 'pending')
                            ? <Tag color="green">一致</Tag>
                            : selectedRecord.reconResult === 'pending'
                              ? <Tag>待入账</Tag>
                              : <Tag color="red">差额¥{Math.abs(ourTotal - theirTotal).toLocaleString()}</Tag>
                          }
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    </Table.Summary>
                  );
                }}
              />
            </Card>

            {/* 款式编码汇总核对：双方按款式汇总数量比对 */}
            {selectedRecord.styleCompare && selectedRecord.styleCompare.length > 0 && (
              <Card size="small" style={{ marginTop: 16 }} title={
                <Space>
                  <DiffOutlined />
                  <span>款式编码汇总核对</span>
                  {selectedRecord.styleCompare.some(s => s.ourQty !== s.theirQty)
                    ? <Tag color="red">款式数量不相等</Tag>
                    : selectedRecord.reconResult !== 'pending' ? <Tag color="green">数量一致</Tag> : null}
                </Space>
              }>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="styleCode"
                  dataSource={selectedRecord.styleCompare}
                  columns={[
                    { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode' },
                    {
                      title: '供应商数量', dataIndex: 'ourQty', key: 'ourQty', align: 'right' as const,
                      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{v}</Text>,
                    },
                    {
                      title: '采购商数量', dataIndex: 'theirQty', key: 'theirQty', align: 'right' as const,
                      render: (v: number, s: any) => (
                        <Text style={{
                          fontFamily: 'monospace',
                          color: selectedRecord.reconResult === 'pending' ? undefined : v === s.ourQty ? '#52c41a' : '#ff4d4f',
                          fontWeight: v === s.ourQty ? undefined : 'bold',
                        }}>
                          {selectedRecord.reconResult === 'pending' ? '-' : v}
                        </Text>
                      ),
                    },
                    {
                      title: '核对结果', key: 'res', align: 'center' as const,
                      render: (_: any, s: any) => (
                        selectedRecord.reconResult === 'pending'
                          ? <Tag>待入账</Tag>
                          : s.ourQty === s.theirQty
                            ? <Tag color="green" icon={<CheckCircleOutlined />}>一致</Tag>
                            : <Tag color="red" icon={<CloseCircleOutlined />}>不相等</Tag>
                      ),
                    },
                  ]}
                />
              </Card>
            )}

            {/* 差异项高亮提示 */}
            {selectedRecord.reconResult === 'detail_diff' && (
              <Alert
                type="warning"
                message="金额一致，明细不一致"
                description="虽然单据总金额一致，但明细中数量、货号存在差异。红色标注的明细项与对方记录不一致，请核实具体差异原因。"
                style={{ marginTop: 16 }}
                showIcon
                icon={<ExclamationCircleOutlined />}
              />
            )}
            {selectedRecord.reconResult === 'amount_diff' && (
              <Alert
                type="error"
                message="金额不一致"
                description={`单据总金额存在差异，差额为 ${Math.abs(selectedRecord.ourAmount - selectedRecord.theirAmount).toLocaleString()} 元。红色标注的明细项价格或数量与对方记录不一致，需人工核查并处理。`}
                style={{ marginTop: 16 }}
                showIcon
                icon={<ExclamationCircleOutlined />}
              />
            )}
            {selectedRecord.reconResult === 'pending' && (
              <Alert
                type="info"
                message="等待对方入账"
                description={`单据已录入系统，等待${selectedRecord.reconType === 'customer' ? '客户' : '供应商'} ${selectedRecord.counterparty} 确认并入账。入账后将自动按单据编号 ${selectedRecord.docNo} 进行金额比对。`}
                style={{ marginTop: 16 }}
                showIcon
                icon={<ClockCircleOutlined />}
              />
            )}
          </>
        )}
      </Modal>

      {/* 闪烁提示样式：对方新增反馈时徽标闪烁 */}
      <style>{'@keyframes reconBadgeBlink{0%,100%{opacity:1}50%{opacity:.15}} .recon-badge-blink .ant-badge-count{animation:reconBadgeBlink 1s infinite;}'}</style>

      {/* ============ 对方反馈弹窗（供应商/采购商完全同步） ============ */}
      <Modal
        title={
          <Space>
            <MessageOutlined style={{ color: PRIMARY }} />
            <span>对方反馈{selectedRecord ? `（单据 ${selectedRecord.docNo}）` : ''}</span>
          </Space>
        }
        open={feedbackVisible}
        onCancel={() => setFeedbackVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setFeedbackVisible(false)}>关闭</Button>
            <Button type="primary" icon={<SendOutlined />} onClick={() => selectedRecord && submitFeedback(selectedRecord)}>提交反馈</Button>
          </Space>
        }
        width={760}
      >
        <div style={{ maxHeight: 340, overflow: 'auto', marginBottom: 12 }}>
          {feedbackEntries.length === 0 && <Text type="secondary">暂无反馈内容</Text>}
          {feedbackEntries.map(e => (
            <Card
              key={e.id}
              size="small"
              style={{ marginBottom: 8 }}
              title={
                <Space>
                  <Tag color={e.side === 'supplier' ? 'gold' : 'blue'}>{e.side === 'supplier' ? '供应商' : '采购商'}</Tag>
                  <Text strong>{e.author}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{e.time.replace('T', ' ').substring(0, 16)}</Text>
                </Space>
              }
            >
              {e.reasons.length > 0 && (
                <div style={{ marginBottom: 4 }}>{e.reasons.map(rs => <Tag key={rs} color="red">{rs}</Tag>)}</div>
              )}
              {e.note && <Paragraph style={{ marginBottom: 4, whiteSpace: 'pre-wrap' }}>{e.note}</Paragraph>}
              {e.images.length > 0 && (
                <Image.PreviewGroup items={e.images}>
                  <Space>{e.images.map((im, i) => <Image key={i} src={im} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Space>
                </Image.PreviewGroup>
              )}
            </Card>
          ))}
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">原因选项（可自定义添加，输入后回车）：</Text>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            placeholder="选择或输入自定义原因"
            value={feedbackReasons}
            onChange={setFeedbackReasons}
            options={MISMATCH_REASONS.map(r => ({ label: r, value: r }))}
          />
        </div>
        <Input.TextArea rows={2} placeholder="备注文字说明" value={feedbackNote} onChange={e => setFeedbackNote(e.target.value)} style={{ marginBottom: 8 }} />
        <Space>
          <Upload accept="image/*" showUploadList={false} beforeUpload={f => { readImageFile(f, setFeedbackImage); return false; }}>
            <Button icon={<PictureOutlined />}>上传图片</Button>
          </Upload>
          <Text type="secondary" style={{ fontSize: 12 }}>支持 Ctrl+V 粘贴剪切板图片</Text>
          {feedbackImage && <Image src={feedbackImage} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} />}
          {feedbackImage && <Button size="small" danger onClick={() => setFeedbackImage('')}>移除图片</Button>}
        </Space>
      </Modal>

      {/* ============ 账目不符弹窗（采购商：账单不符按键） ============ */}
      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            <span>账目不符{mismatchRecord ? `（单据 ${mismatchRecord.docNo}）` : ''}</span>
          </Space>
        }
        open={mismatchVisible}
        onCancel={() => setMismatchVisible(false)}
        onOk={handleMismatchSubmit}
        okText="确认标记不符"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        width={640}
      >
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="标记后采购账单对账结果更新为“不相符”，以下原因与说明将同步反馈给供应商" />
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">具体原因（可多选，可自定义添加，输入后回车）：</Text>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            placeholder="选择或输入自定义原因"
            value={mismatchReasons}
            onChange={setMismatchReasons}
            options={MISMATCH_REASONS.map(r => ({ label: r, value: r }))}
          />
        </div>
        <Input.TextArea rows={3} placeholder="备注文字说明" value={mismatchNote} onChange={e => setMismatchNote(e.target.value)} style={{ marginBottom: 8 }} />
        <Space>
          <Upload accept="image/*" showUploadList={false} beforeUpload={f => { readImageFile(f, setMismatchImage); return false; }}>
            <Button icon={<PictureOutlined />}>上传图片</Button>
          </Upload>
          <Text type="secondary" style={{ fontSize: 12 }}>支持 Ctrl+V 粘贴剪切板图片</Text>
          {mismatchImage && <Image src={mismatchImage} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} />}
          {mismatchImage && <Button size="small" danger onClick={() => setMismatchImage('')}>移除图片</Button>}
        </Space>
      </Modal>

      {/* ============ 录入单据模态框 ============ */}
      <Modal
        title={
          <Space>
            <FileTextOutlined style={{ color: PRIMARY }} />
            <span>录入{entryType === 'customer' ? '客户' : '供应商'}单据</span>
          </Space>
        }
        open={entryVisible}
        onCancel={() => { setEntryVisible(false); entryForm.resetFields(); }}
        onOk={handleEntryConfirm}
        okText="录入单据"
        cancelText="取消"
        width={700}
      >
        <div style={{
          background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 8,
          padding: '10px 16px', marginBottom: 20, marginTop: 8,
        }}>
          <InfoCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />
          <Text style={{ color: '#0050b3', fontSize: 13 }}>
            录入后单据状态为"等待对方入账"。{entryType === 'customer' ? '客户' : '供应商'}确认入账后，系统将自动以单据编号进行金额比对。
          </Text>
        </div>

        <Form autoComplete="off" form={entryForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="counterparty"
                label={entryType === 'customer' ? '选择客户' : '选择供应商'}
                rules={[{ required: true, message: `请选择${entryType === 'customer' ? '客户' : '供应商'}` }]}
              >
                <Select
                  placeholder={`请选择${entryType === 'customer' ? '客户' : '供应商'}`}
                  showSearch
                  optionFilterProp="children"
                >
                  {entryType === 'customer' ? (
                    <>
                      <Option value="华东科技有限公司">华东科技有限公司</Option>
                      <Option value="南方精密制造">南方精密制造</Option>
                      <Option value="西部电子股份">西部电子股份</Option>
                      <Option value="中联重科股份">中联重科股份</Option>
                      <Option value="长三角贸易集团">长三角贸易集团</Option>
                      <Option value="北京智能装备">北京智能装备</Option>
                      <Option value="深圳创新科技">深圳创新科技</Option>
                    </>
                  ) : (
                    <>
                      <Option value="北方钢铁集团">北方钢铁集团</Option>
                      <Option value="东南新材料公司">东南新材料公司</Option>
                      <Option value="华北机电设备">华北机电设备</Option>
                      <Option value="宝钢股份">宝钢股份</Option>
                      <Option value="西南铝业">西南铝业</Option>
                      <Option value="SKF中国">SKF中国</Option>
                      <Option value="西门子">西门子</Option>
                    </>
                  )}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="entryDate"
                label="单据日期"
                rules={[{ required: true, message: '请选择日期' }]}
                initialValue={new Date().toISOString().split('T')[0]}
              >
                <Input readOnly placeholder={new Date().toISOString().split('T')[0]} />
              </Form.Item>
            </Col>
          </Row>

          {/* 明细列表 */}
          <Form.Item label="单据明细" required>
            <Form.List name="items" initialValue={[{ itemNo: '', itemName: '', ourQty: 0, ourPrice: 0 }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }, index) => (
                    <Row key={key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                      <Col span={4}>
                        <Form.Item
                          {...rest}
                          name={[name, 'itemNo']}
                          rules={[{ required: true, message: '货号' }]}
                          noStyle
                        >
                          <Input placeholder="货号" size="small" />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item
                          {...rest}
                          name={[name, 'itemName']}
                          rules={[{ required: true, message: '名称' }]}
                          noStyle
                        >
                          <Input placeholder="货品名称" size="small" />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item
                          {...rest}
                          name={[name, 'ourQty']}
                          rules={[{ required: true, message: '数量' }]}
                          noStyle
                        >
                          <InputNumber placeholder="数量" min={1} size="small" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item
                          {...rest}
                          name={[name, 'ourPrice']}
                          rules={[{ required: true, message: '单价' }]}
                          noStyle
                        >
                          <InputNumber placeholder="单价" min={0} size="small" style={{ width: '100%' }} prefix="¥" />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          小计：¥{(
                            (entryForm.getFieldValue(['items', name, 'ourQty']) || 0) *
                            (entryForm.getFieldValue(['items', name, 'ourPrice']) || 0)
                          ).toLocaleString()}
                        </Text>
                      </Col>
                      <Col span={2}>
                        {fields.length > 1 && (
                          <Button type="link" danger size="small" onClick={() => remove(name)}>删除</Button>
                        )}
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add({ itemNo: '', itemName: '', ourQty: 0, ourPrice: 0 })} block size="small">
                    + 添加明细行
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Divider />
          <div style={{ textAlign: 'right' }}>
            <Text type="secondary">单据总金额：</Text>
            <Text strong style={{ fontSize: 18, fontFamily: 'monospace', color: PRIMARY }}>
              ¥{(
                (entryForm.getFieldValue('items') || []).reduce(
                  (sum: number, item: any) => sum + ((item?.ourQty || 0) * (item?.ourPrice || 0)), 0
                )
              ).toLocaleString()}
            </Text>
          </div>
        </Form>
      </Modal>

      {/* ============ 手动关联单据弹窗（采购商平台） ============ */}
      <Modal
        title={
          <Space>
            <LinkOutlined style={{ color: PRIMARY }} />
            <span>{isPurchaser ? '手动关联采购账单' : '手动关联供应商账单'}</span>
          </Space>
        }
        open={linkVisible}
        onCancel={() => setLinkVisible(false)}
        onOk={handleLinkConfirm}
        okText="确认关联"
        cancelText="取消"
        width={760}
      >
        <div style={{
          background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 8,
          padding: '10px 16px', marginBottom: 12, marginTop: 8,
        }}>
          <InfoCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />
          <Text style={{ color: '#0050b3', fontSize: 13 }}>
            {isPurchaser
              ? `未按单据编号「${linkRecord?.docNo}」自动匹配到采购账单，请手动选择要关联的账单，关联后系统将自动核对明细与总金额（款式编码汇总核对数量）。`
              : `采购商发起的对账未匹配到供应商账单，请手动选择未完成对账的账单进行关联，关联后系统将自动核对明细与总金额。`}
          </Text>
        </div>
        <Row gutter={8} style={{ marginBottom: 10 }}>
          <Col span={5}>
            <Input size="small" allowClear placeholder={isPurchaser ? '单据编号' : '出库单号/单据编号'} value={linkSearch.no} onChange={e => setLinkSearch(p => ({ ...p, no: e.target.value }))} />
          </Col>
          <Col span={4}>
            <Input size="small" allowClear placeholder={isPurchaser ? '供应商' : '采购商'} value={linkSearch.supplier} onChange={e => setLinkSearch(p => ({ ...p, supplier: e.target.value }))} />
          </Col>
          <Col span={4}>
            <Input size="small" allowClear placeholder="日期" value={linkSearch.date} onChange={e => setLinkSearch(p => ({ ...p, date: e.target.value }))} />
          </Col>
          <Col span={3}>
            <Input size="small" allowClear placeholder="数量" value={linkSearch.qty} onChange={e => setLinkSearch(p => ({ ...p, qty: e.target.value }))} />
          </Col>
          <Col span={4}>
            <Input size="small" allowClear placeholder="金额" value={linkSearch.amount} onChange={e => setLinkSearch(p => ({ ...p, amount: e.target.value }))} />
          </Col>
          <Col span={4}>
            <Space size={4}>
              <Button size="small" type="primary" icon={<SearchOutlined />} onClick={() => setLinkSearchApplied({ ...linkSearch })}>查询</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { setLinkSearch({ ...emptyLinkSearch }); setLinkSearchApplied({ ...emptyLinkSearch }); setLinkPick(''); }}>重置</Button>
            </Space>
          </Col>
        </Row>
        <Table
          size="small"
          rowKey={isPurchaser ? 'key' : 'id'}
          dataSource={linkFilteredBills}
          pagination={false}
          scroll={{ y: 320 }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: linkPick ? [linkPick] : [],
            onChange: keys => setLinkPick(String(keys[0] || '')),
          }}
          columns={isPurchaser ? [
            { title: '单据编号', dataIndex: 'outboundNo', key: 'outboundNo', width: 130 },
            { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 140, render: (v: string) => v || '-' },
            { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
            { title: '数量', dataIndex: 'totalQty', key: 'totalQty', width: 70, align: 'right' as const },
            {
              title: '采购金额', dataIndex: 'totalAmount', key: 'totalAmount', width: 110, align: 'right' as const,
              render: (v: number) => `¥${(Number(v) || 0).toFixed(2)}`,
            },
            {
              title: '关联状态', key: 'linkStatus', width: 90,
              render: (_: any, b: any) => {
                const linked = dataSource.some(r => r.matchedBillKey === b.key);
                return linked ? <Tag color="red" style={{ fontWeight: 500 }}>已关联</Tag> : <Text type="secondary">未关联</Text>;
              },
            },
          ] : [
            { title: '出库单号', dataIndex: 'outboundNo', key: 'outboundNo', width: 130 },
            { title: '单据编号', dataIndex: 'id', key: 'id', width: 110 },
            { title: '日期', dataIndex: 'date', key: 'date', width: 100 },
            { title: '数量', key: 'qty', width: 70, align: 'right' as const, render: (_: any, b: any) => linkQtyOf(b) },
            {
              title: '金额', dataIndex: 'totalAmount', key: 'totalAmount', width: 100, align: 'right' as const,
              render: (v: number) => `¥${(Number(v) || 0).toFixed(2)}`,
            },
            {
              title: '关联状态', key: 'linkStatus', width: 90,
              render: (_: any, b: any) => {
                const linked = dataSource.some(r => r.orderNo === b.id);
                return linked ? <Tag color="red" style={{ fontWeight: 500 }}>已关联</Tag> : <Text type="secondary">未关联</Text>;
              },
            },
          ]}
          locale={{ emptyText: '暂无采购账单' }}
        />
      </Modal>
    </div>
  );
};

export default ReconciliationManage;
