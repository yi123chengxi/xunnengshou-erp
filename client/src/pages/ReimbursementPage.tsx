import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, DatePicker,
  Row, Col, Select, Tag, Statistic, Empty, Image, Tabs, Badge, Popconfirm, Tooltip,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined,
  DollarOutlined, PictureOutlined, SnippetsOutlined,
  FileTextOutlined, SearchOutlined, MergeCellsOutlined,
  ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  DownloadOutlined, EyeOutlined, PrinterOutlined, WalletOutlined, SettingOutlined, RedoOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { safeSetItem } from '../utils/storageQuota';
import { compressImageFile } from '../utils/imageCompress';
import { isAccountingMode, writeAutoEntries, loadSubjectOptions, subjectFilterOption } from '../utils/accountingBridge';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// 记账凭证表格单元格样式
const voucherTdHead: React.CSSProperties = {
  border: '1px solid #e8e8e8', padding: '8px 12px', background: '#f5f7fa',
  fontWeight: 600, fontSize: 13, color: '#5a6d85', width: 100, whiteSpace: 'nowrap',
};
const voucherTd: React.CSSProperties = {
  border: '1px solid #e8e8e8', padding: '8px 12px', fontSize: 13,
};

// 报销分类
const EXPENSE_CATEGORIES = [
  '差旅费', '交通费', '餐饮费', '办公用品', '通讯费', '招待费', '培训费', '维修费', '其他费用',
].map(v => ({ label: v, value: v }));

// 报销主分类（审核通过时选择，写入日常记账的分类字段）
const MAIN_EXPENSE_CATEGORIES = [
  '销售费用', '管理费用', '财务费用',
].map(v => ({ label: v, value: v }));

// 状态标签颜色
const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending_review: { color: 'orange', text: '待审核' },
  approved: { color: 'blue', text: '已通过' },
  rejected: { color: 'red', text: '已拒绝' },
  pending_payment: { color: 'cyan', text: '待支付' },
  paid: { color: 'green', text: '已支付' },
  cancelled: { color: 'default', text: '已取消' },
};

// 数据所有者
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// 本人垫付收款账户：每个子账号独立账户库（存储键按当前登录账号区分）
const getRecvAccountKey = (): string => `receiving_accounts_${localStorage.getItem('username') || getDataOwner() || 'admin'}`;
// 合并本浏览器所有账号的收款账户库（审核/查看其他子账号单据时解析展示用）
const loadAllReceivingAccounts = (): any[] => {
  const out: any[] = []; const seen = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('receiving_accounts_')) continue;
    try {
      (JSON.parse(localStorage.getItem(k) || '[]') as any[]).forEach(r => { if (r && r.key && !seen.has(r.key)) { seen.add(r.key); out.push(r); } });
    } catch { /* ignore */ }
  }
  return out;
};

// 当前用户名
const getCurrentUser = (): string => localStorage.getItem('username') || '';

// 显示姓名
const getDisplayName = (username?: string): string => {
  const name = username || getCurrentUser();
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === name);
    if (u?.displayName || u?.contactPerson || u?.name) return u.displayName || u.contactPerson || u.name;
  } catch { /* ignore */ }
  return name;
};

// 获取当前用户的分组名称（部门）
// 从账号管理的 accounts_<owner> 存储中读取当前用户的 group 字段
const getCurrentGroup = (): string => {
  try {
    const username = getCurrentUser();
    const owner = getDataOwner();
    const accounts = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
    const acc = accounts.find((a: any) => a.username === username);
    return acc?.group || '';
  } catch { /* ignore */ }
  return '';
};

// 报销单接口
interface ReimbursementRecord {
  key: string;
  reimbursementNo: string;    // 报销编号（自动生成，如 BX20261004001）
  title: string;              // 报销标题
  category: string;           // 费用分类
  amount: number;             // 报销金额
  description: string;        // 费用说明
  applicant: string;          // 申请人用户名
  applicantName: string;      // 申请人姓名
  department?: string;        // 部门（子账号分组名称）
  applyDate: string;          // 申请日期
  status: string;             // 状态
  receipts: string[];         // 发票/收据图片
  // 审核信息
  financeReviewer?: string;
  financeReviewDate?: string;
  financeComment?: string;
  mainCategory?: string;      // 审核时选择的主分类（销售费用/管理费用/财务费用）
  // 支付信息
  payDate?: string;
  payBankAccount?: string;
  payBankName?: string;
  payScreenshots?: string[];  // 支付截图
  payBatchKey?: string;       // 关联支付批次
  payRemark?: string;
  // 来源信息
  source?: string;            // 来源标识：'daily_book' 表示日常记账自动生成
  sourceBookKey?: string;     // 关联的日常记账记录key
  receivingAccount?: string;  // 收款账户（支付宝/银行账户/收款码）
  // 收款账户快照：审核/支付端在另一浏览器或账户库已删时仍能展示账户信息
  receivingAccountName?: string;
  receivingAccountNo?: string;
  receivingAccountType?: string;
  receivingAccountBank?: string;
  createdAt: string;
  updatedAt: string;
}

// 生成报销编号：BX + 日期 + 序号
const generateReimbursementNo = (list: ReimbursementRecord[]): string => {
  const now = dayjs();
  const prefix = `BX${now.format('YYYYMMDD')}`;
  // 找出当天已有的报销单，计算下一个序号
  const todayNos = list
    .filter(r => r.reimbursementNo && r.reimbursementNo.startsWith(prefix))
    .map(r => {
      const seq = parseInt(r.reimbursementNo.slice(-3), 10);
      return isNaN(seq) ? 0 : seq;
    });
  const nextSeq = todayNos.length > 0 ? Math.max(...todayNos) + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
};

// 支付批次接口
interface PaymentBatch {
  key: string;
  applicant: string;
  applicantName: string;
  totalAmount: number;
  recordKeys: string[];
  bankAccount: string;
  bankName: string;
  screenshots: string[];
  payDate: string;
  operator: string;
  remark: string;
}

/** 报销管理页面：申请→审核→支付全流程 */
const ReimbursementPage: React.FC = () => {
  const [records, setRecords] = useState<ReimbursementRecord[]>([]);
  const [payments, setPayments] = useState<PaymentBatch[]>([]);
  const [activeTab, setActiveTab] = useState('my');
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [dateRangeApplied, setDateRangeApplied] = useState<[string, string] | null>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  // 收款账户（与日常记账-本人垫付共用当前登录账号的独立账户库 receiving_accounts_<username>）
  const [receivingAccounts, setReceivingAccounts] = useState<any[]>([]);
  // 本浏览器全部账号收款账户合并列表（审核/查看其他子账号报销单时解析展示）
  const [allRecvAccounts, setAllRecvAccounts] = useState<any[]>([]);
  // 新增收款账户弹窗（与日常记账-本人垫付共用当前账号独立账户库）
  const [recvModalVisible, setRecvModalVisible] = useState(false);
  const [recvFormType, setRecvFormType] = useState<'支付宝' | '银行账户' | '收款码'>('支付宝');
  const [recvFormName, setRecvFormName] = useState('');
  const [recvFormAccount, setRecvFormAccount] = useState('');
  const [recvFormBank, setRecvFormBank] = useState('');
  const [recvFormImage, setRecvFormImage] = useState('');
  const receivingAccountOptions = useMemo(() => receivingAccounts.map((r: any) => ({
    label: `${r.type === '支付宝' ? '🟢' : r.type === '银行账户' ? '🏦' : '📱'} ${r.name} ${r.account}${r.bankName ? ` (${r.bankName})` : ''}`,
    value: r.key,
  })), [receivingAccounts]);

  // 新增/编辑弹窗
  const [applyVisible, setApplyVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<ReimbursementRecord | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formAmount, setFormAmount] = useState<number | undefined>(undefined);
  const [formDescription, setFormDescription] = useState('');
  const [formReceipts, setFormReceipts] = useState<string[]>([]);
  const [formReceivingAccount, setFormReceivingAccount] = useState('');  // 收款账户

  // 审核弹窗
  const [reviewVisible, setReviewVisible] = useState(false);
  const [reviewRecord, setReviewRecord] = useState<ReimbursementRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewMainCategory, setReviewMainCategory] = useState('');
  const [reviewDebit, setReviewDebit] = useState('');
  const [reviewCredit, setReviewCredit] = useState('银行存款');

  // 支付弹窗（单笔）
  const [payVisible, setPayVisible] = useState(false);
  const [payRecord, setPayRecord] = useState<ReimbursementRecord | null>(null);
  const [payBankKey, setPayBankKey] = useState('');
  const [payScreenshots, setPayScreenshots] = useState<string[]>([]);
  const [payRemark, setPayRemark] = useState('');

  // 合并支付弹窗
  const [batchPayVisible, setBatchPayVisible] = useState(false);
  const [batchApplicant, setBatchApplicant] = useState('');
  const [batchRecords, setBatchRecords] = useState<ReimbursementRecord[]>([]);
  const [batchBankKey, setBatchBankKey] = useState('');
  const [batchScreenshots, setBatchScreenshots] = useState<string[]>([]);
  const [batchRemark, setBatchRemark] = useState('');
  const [batchSelectedKeys, setBatchSelectedKeys] = useState<string[]>([]);

  // 待支付表格内复选框勾选状态（按申请人分组）
  const [payCheckKeys, setPayCheckKeys] = useState<Record<string, string[]>>({});

  // 负责人设置（与收/付申请同逻辑）：待审核/待支付标签页
  const [tabManagers, setTabManagers] = useState<Record<string, string[]>>({ review: [], payment: [] });
  const [managerModalTab, setManagerModalTab] = useState<string | null>(null);
  const [managerSelectedUsers, setManagerSelectedUsers] = useState<string[]>([]);
  const managersKey = `reimbursement_managers_${getDataOwner()}`;
  const isAdmin = localStorage.getItem('isSubAccount') !== 'true';

  // 记账凭证弹窗
  const [voucherVisible, setVoucherVisible] = useState(false);
  const [voucherRecord, setVoucherRecord] = useState<ReimbursementRecord | null>(null);

  // 每页条数受控状态（修复 showSizeChanger 无效）
  const [pageSizeMy, setPageSizeMy] = useState(15);
  const [pageSizeReview, setPageSizeReview] = useState(15);
  // 表格体滚动高度（动态测量，使横向滚动条固定在窗口底部）
  const [tableScrollY, setTableScrollY] = useState<number | string>('calc(100vh - 360px)');
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const storageKey = `reimbursement_${getDataOwner()}`;
  const paymentKey = `reimbursement_payments_${getDataOwner()}`;

  const load = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(`reimbursement_${getDataOwner()}`) || '[]')); } catch { setRecords([]); }
    try { setPayments(JSON.parse(localStorage.getItem(`reimbursement_payments_${getDataOwner()}`) || '[]')); } catch { setPayments([]); }
    // 加载负责人设置
    try {
      const mgrs = JSON.parse(localStorage.getItem(`reimbursement_managers_${getDataOwner()}`) || '{}');
      setTabManagers({ review: mgrs.review || [], payment: mgrs.payment || [] });
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 计算表格体滚动高度：使横向滚动条固定在窗口底部
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
    const t1 = setTimeout(calcTableScrollY, 200);
    const t2 = setTimeout(calcTableScrollY, 600);
    const onResize = () => setTimeout(calcTableScrollY, 50);
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', onResize); };
  }, [calcTableScrollY]);

  const saveRecords = useCallback((list: ReimbursementRecord[]) => {
    setRecords(list);
    safeSetItem(`reimbursement_${getDataOwner()}`, JSON.stringify(list));
  }, []);

  const savePayments = useCallback((list: PaymentBatch[]) => {
    setPayments(list);
    safeSetItem(`reimbursement_payments_${getDataOwner()}`, JSON.stringify(list));
  }, []);

  const loadBankAccounts = useCallback(() => {
    try { setBankAccounts(JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${getDataOwner()}`) || '[]')); } catch { setBankAccounts([]); }
  }, []);
  const loadReceivingAccounts = useCallback(() => {
    try { setReceivingAccounts(JSON.parse(localStorage.getItem(getRecvAccountKey()) || '[]')); } catch { setReceivingAccounts([]); }
    setAllRecvAccounts(loadAllReceivingAccounts());
  }, []);

  // 新增收款账户（报销弹窗入口）：保存写入当前账号独立账户库并自动选中
  const openRecvAddModal = useCallback(() => {
    setRecvFormType('支付宝'); setRecvFormName(''); setRecvFormAccount(''); setRecvFormBank(''); setRecvFormImage('');
    setRecvModalVisible(true);
  }, []);
  const handleSaveRecvAccount = useCallback(() => {
    if (!recvFormName.trim()) { message.warning('请输入账户名称'); return; }
    if (recvFormType === '收款码' && !recvFormImage) { message.warning('请上传收款码图片'); return; }
    if (recvFormType !== '收款码' && !recvFormAccount.trim()) { message.warning('请输入账号'); return; }
    const item: any = {
      key: `ra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: recvFormType,
      name: recvFormName.trim(),
      account: recvFormType === '收款码' ? (recvFormAccount.trim() || recvFormName.trim()) : recvFormAccount.trim(),
      bankName: recvFormType === '银行账户' ? recvFormBank.trim() : undefined,
      image: recvFormType === '收款码' ? recvFormImage : undefined,
    };
    const updated = [...receivingAccounts, item];
    setReceivingAccounts(updated);
    setAllRecvAccounts(prev => [...prev, item]);
    safeSetItem(getRecvAccountKey(), JSON.stringify(updated));
    setFormReceivingAccount(item.key);
    setRecvModalVisible(false);
    message.success('已新增收款账户并自动选中');
  }, [recvFormName, recvFormType, recvFormAccount, recvFormBank, recvFormImage, receivingAccounts]);
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
      message.warning('无法读取剪切板，请点击上传按钮选择图片');
    }
  }, []);
  useEffect(() => { loadBankAccounts(); loadReceivingAccounts(); }, [loadBankAccounts, loadReceivingAccounts]);

  // 银行账户下拉
  const bankAccountOptions = useMemo(() => bankAccounts
    .filter((b: any) => b.status !== '冻结' && b.status !== 'disabled')
    .map((b: any) => {
      const name = b.name || b.shortName || '';
      const no = String(b.bankAccountNo || '').replace(/\s/g, '');
      const masked = no.length <= 8 ? no : `${no.slice(0, 4)} **** **** ${no.slice(-4)}`;
      const bank = `${b.bankName || ''}${b.branchName ? `(${b.branchName})` : ''}`;
      return { label: `${name} ${bank} ${masked}`, value: b.key };
    }), [bankAccounts]);

  // 当前用户
  const currentUser = getCurrentUser();

  // ========== 负责人权限（与收/付申请同口径）==========
  const isTabManager = useCallback((tab: 'review' | 'payment'): boolean => {
    if (isAdmin) return true; // 管理员始终可操作
    const mgrs = tabManagers[tab] || [];
    if (mgrs.length === 0) return true; // 未设置负责人时，所有人都可操作
    return mgrs.includes(currentUser);
  }, [tabManagers, currentUser, isAdmin]);

  const saveManagers = useCallback((tab: string, users: string[]) => {
    const updated = { ...tabManagers, [tab]: users };
    setTabManagers(updated);
    safeSetItem(managersKey, JSON.stringify(updated));
    message.success('负责人已保存');
  }, [tabManagers, managersKey]);

  // 获取本租户用户列表（主账号 + 子账号，过滤掉其他租户）
  const allUserOptions = useMemo(() => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const owner = getDataOwner();
      const resolveOwner = (u: any): string => {
        if (!u.isSubAccount || !u.parentAccount) return u.username;
        const visited = new Set<string>();
        let cur = u.parentAccount;
        while (cur && !visited.has(cur)) {
          visited.add(cur);
          const parent = users.find((x: any) => x.username === cur);
          if (!parent || !parent.isSubAccount) return cur;
          cur = parent.parentAccount || '';
        }
        return cur || u.username;
      };
      return users
        .filter((u: any) => resolveOwner(u) === owner || u.username === owner)
        .map((u: any) => ({
          value: u.username,
          label: `${u.displayName || u.contactPerson || u.name || u.username} (${u.username})`,
        }));
    } catch { return []; }
  }, []);

  // 获取负责人显示名称
  const getManagerDisplayNames = useCallback((tab: string): string => {
    const mgrs = tabManagers[tab] || [];
    if (mgrs.length === 0) return '未设置';
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return mgrs.map((un: string) => {
        const u = users.find((x: any) => x.username === un);
        return u?.displayName || u?.contactPerson || u?.name || un;
      }).join('、');
    } catch { return mgrs.join('、'); }
  }, [tabManagers]);

  // 解析申请人的部门（优先取记录中的 department，否则动态查 accounts_<owner>）
  const resolveDept = useCallback((r: ReimbursementRecord): string => {
    if (r.department) return r.department;
    try {
      const owner = getDataOwner();
      const accounts = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
      const acc = accounts.find((a: any) => a.username === r.applicant);
      return acc?.group || '';
    } catch { /* ignore */ }
    return '';
  }, []);

  // 解析报销单的收款账户（手动申请取 receivingAccount；日常记账垫付来源回溯源单 advanceRecvAccount）
  const resolveRecvAccount = useCallback((r: ReimbursementRecord): any | null => {
    let key = r.receivingAccount || '';
    if (!key && r.source === 'daily_book' && r.sourceBookKey) {
      try {
        const books: any[] = JSON.parse(localStorage.getItem(`daily_bookkeeping_${getDataOwner()}`) || '[]');
        key = books.find((b: any) => b.key === r.sourceBookKey)?.advanceRecvAccount || '';
      } catch { /* ignore */ }
    }
    if (!key) return null;
    return receivingAccounts.find((x: any) => x.key === key) || allRecvAccounts.find((x: any) => x.key === key) || null;
  }, [receivingAccounts, allRecvAccounts]);
  // 收款账户信息渲染（含收款码图片）
  const recvAccountRender = (r: ReimbursementRecord) => {
    // 账户库缺失（跨浏览器未同步/账户已删）时回退到单据内快照
    const acc = resolveRecvAccount(r) || (r.receivingAccountName ? {
      name: r.receivingAccountName,
      account: r.receivingAccountNo || '',
      type: r.receivingAccountType || '',
      bankName: r.receivingAccountBank || '',
      image: '',
    } : null);
    if (!acc) return <span style={{ color: '#999' }}>—</span>;
    const icon = acc.type === '支付宝' ? '🟢' : acc.type === '银行账户' ? '🏦' : '📱';
    return (
      <div style={{ fontSize: 12 }}>
        <div>{icon} {acc.name}</div>
        <div style={{ fontSize: 11, color: '#888', wordBreak: 'break-all' }}>{acc.account}{acc.bankName ? ` (${acc.bankName})` : ''}</div>
        {acc.type === '收款码' && acc.image && (
          <Image src={acc.image} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4, marginTop: 2 }} />
        )}
      </div>
    );
  };

  // 各视图数据
  const myRecords = useMemo(() =>
    records.filter(r => r.applicant === currentUser)
      .filter(r => {
        if (searchApplied && !`${r.reimbursementNo}${r.title}${r.category}${r.description}`.toLowerCase().includes(searchApplied.toLowerCase())) return false;
        if (statusFilter && r.status !== statusFilter) return false;
        if (dateRangeApplied) {
          const d = r.applyDate || '';
          if (d < dateRangeApplied[0] || d > dateRangeApplied[1]) return false;
        }
        return true;
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [records, currentUser, searchApplied, statusFilter, dateRangeApplied]);

  const reviewRecords = useMemo(() =>
    records.filter(r => r.status === 'pending_review')
      .filter(r => {
        if (searchApplied && !`${r.reimbursementNo}${r.title}${r.category}${r.applicantName}${r.description}`.toLowerCase().includes(searchApplied.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
    [records, searchApplied]);

  const paymentRecords = useMemo(() =>
    records.filter(r => r.status === 'approved' || r.status === 'pending_payment')
      .filter(r => {
        if (searchApplied && !`${r.reimbursementNo}${r.title}${r.category}${r.applicantName}${r.description}`.toLowerCase().includes(searchApplied.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => (a.applicantName || '').localeCompare(b.applicantName || '')),
    [records, searchApplied]);

  // 汇总
  const stats = useMemo(() => {
    const myPending = records.filter(r => r.applicant === currentUser && r.status === 'pending_review').length;
    const myApproved = records.filter(r => r.applicant === currentUser && (r.status === 'approved' || r.status === 'pending_payment')).length;
    const myPaid = records.filter(r => r.applicant === currentUser && r.status === 'paid').reduce((s, r) => s + r.amount, 0);
    const totalPendingReview = records.filter(r => r.status === 'pending_review').length;
    const totalPendingPay = records.filter(r => r.status === 'approved' || r.status === 'pending_payment').reduce((s, r) => s + r.amount, 0);
    const totalPaidMonth = records.filter(r => r.status === 'paid' && r.payDate?.startsWith(dayjs().format('YYYY-MM')))
      .reduce((s, r) => s + r.amount, 0);
    return { myPending, myApproved, myPaid, totalPendingReview, totalPendingPay, totalPaidMonth };
  }, [records, currentUser]);

  // 待支付表格内勾选汇总
  const payCheckedRecords = useMemo(() => {
    const keys = new Set(Object.values(payCheckKeys).flat());
    return paymentRecords.filter(r => keys.has(r.key));
  }, [paymentRecords, payCheckKeys]);
  const payCheckedTotal = useMemo(() => payCheckedRecords.reduce((s, r) => s + r.amount, 0), [payCheckedRecords]);

  // 图片上传
  const handleUploadImage = useCallback((onComplete: (url: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = (ev: any) => {
      const files = ev.target?.files;
      if (!files) return;
      Array.from(files).forEach(async (file: any) => {
        if (file.size > 5 * 1024 * 1024) { message.warning(`图片 ${file.name} 超过5MB`); return; }
        const dataUrl = await compressImageFile(file);
        onComplete(dataUrl);
      });
    };
    input.click();
  }, []);

  const handlePasteImage = useCallback(async (onComplete: (url: string) => void) => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const dataUrl = await compressImageFile(blob);
          onComplete(dataUrl);
          message.success('已从剪切板粘贴图片');
          return;
        }
      }
      message.warning('剪切板中没有图片内容');
    } catch {
      message.warning('无法读取剪切板，请复制图片后重试');
    }
  }, []);

  // ==================== 申请操作 ====================
  const openApply = () => {
    setEditRecord(null);
    setFormTitle(''); setFormCategory(''); setFormAmount(undefined);
    setFormDescription(''); setFormReceipts([]);
    setFormReceivingAccount('');
    loadReceivingAccounts();
    setApplyVisible(true);
  };

  const openEditApply = (r: ReimbursementRecord) => {
    if (r.status !== 'pending_review') { message.warning('仅待审核状态可编辑'); return; }
    setEditRecord(r);
    setFormTitle(r.title); setFormCategory(r.category); setFormAmount(r.amount);
    setFormDescription(r.description); setFormReceipts([...(r.receipts || [])]);
    setFormReceivingAccount(r.receivingAccount || '');
    loadReceivingAccounts();
    setApplyVisible(true);
  };

  // 重新申请：被拒绝后原单预填再次提交（保存时状态重置为待审核、审核字段清空）
  const openReapply = (r: ReimbursementRecord) => {
    setEditRecord(r);
    setFormTitle(r.title); setFormCategory(r.category); setFormAmount(r.amount);
    setFormDescription(r.description); setFormReceipts([...(r.receipts || [])]);
    setFormReceivingAccount(r.receivingAccount || '');
    loadReceivingAccounts();
    setApplyVisible(true);
  };

  const handleApplySave = () => {
    if (!formTitle.trim()) { message.warning('请输入报销标题'); return; }
    if (!formCategory) { message.warning('请选择费用分类'); return; }
    if (!formAmount || formAmount <= 0) { message.warning('请输入大于0的报销金额'); return; }
    const now = new Date().toISOString();
    // 收款账户快照：写入当时选中的账户信息，供其他浏览器/账户库缺失时展示
    const recv = receivingAccounts.find((x: any) => x.key === formReceivingAccount)
      || allRecvAccounts.find((x: any) => x.key === formReceivingAccount);
    const keepSnapshot = !!editRecord && editRecord.receivingAccount === formReceivingAccount;
    const rec: ReimbursementRecord = {
      key: editRecord?.key || `reim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      reimbursementNo: editRecord?.reimbursementNo || generateReimbursementNo(records),
      title: formTitle.trim(),
      category: formCategory,
      amount: Number(formAmount),
      description: formDescription.trim(),
      applicant: currentUser,
      applicantName: getDisplayName(),
      department: getCurrentGroup(),
      applyDate: dayjs().format('YYYY-MM-DD'),
      status: 'pending_review',
      receipts: [...formReceipts],
      receivingAccount: formReceivingAccount || undefined,
      receivingAccountName: recv?.name || (keepSnapshot ? editRecord?.receivingAccountName : undefined),
      receivingAccountNo: recv?.account || (keepSnapshot ? editRecord?.receivingAccountNo : undefined),
      receivingAccountType: recv?.type || (keepSnapshot ? editRecord?.receivingAccountType : undefined),
      receivingAccountBank: recv?.bankName || (keepSnapshot ? editRecord?.receivingAccountBank : undefined),
      createdAt: editRecord?.createdAt || now,
      updatedAt: now,
    };
    saveRecords(editRecord ? records.map(r => r.key === rec.key ? rec : r) : [rec, ...records]);
    setApplyVisible(false);
    message.success(editRecord ? (editRecord.status === 'rejected' ? '已重新提交申请，等待审核' : '已保存修改') : '报销申请已提交');
  };

  const handleCancelApply = (r: ReimbursementRecord) => {
    saveRecords(records.map(x => x.key === r.key ? { ...x, status: 'cancelled', updatedAt: new Date().toISOString() } : x));
    message.success('已取消申请');
  };

  const handleDeleteApply = (r: ReimbursementRecord) => {
    saveRecords(records.filter(x => x.key !== r.key));
    message.success('已删除申请');
  };

  // ==================== 审核操作 ====================
  const openReview = (r: ReimbursementRecord, action: 'approve' | 'reject') => {
    setReviewRecord(r);
    setReviewAction(action);
    setReviewComment('');
    setReviewMainCategory('');
    setReviewDebit('');
    setReviewCredit('银行存款');
    setReviewVisible(true);
  };

  const handleReviewConfirm = () => {
    if (!reviewRecord) return;
    if (reviewAction === 'approve' && !isAccountingMode(getDataOwner()) && !reviewMainCategory) { message.warning('请选择主分类'); return; }
    const now = new Date().toISOString();
    const newStatus = reviewAction === 'approve' ? 'approved' : 'rejected';
    saveRecords(records.map(r => r.key === reviewRecord.key ? {
      ...r,
      status: newStatus,
      financeReviewer: getDisplayName(),
      financeReviewDate: dayjs().format('YYYY-MM-DD HH:mm'),
      financeComment: reviewComment.trim(),
      mainCategory: reviewAction === 'approve' ? reviewMainCategory : undefined,
      debitSubject: reviewAction === 'approve' ? (reviewDebit || (reviewRecord as any).debitSubject || '') : (reviewRecord as any).debitSubject,
      creditSubject: reviewAction === 'approve' ? (reviewCredit || '银行存款') : (reviewRecord as any).creditSubject,
      updatedAt: now,
    } : r));
    // 审核通过后自动生成记账凭证
    if (reviewAction === 'approve') {
      writeApprovalVoucher(reviewRecord, reviewMainCategory);
    }
    setReviewVisible(false);
    message.success(reviewAction === 'approve' ? '已通过该报销申请，已自动生成记账凭证' : '已拒绝该报销申请');
  };

  // ==================== 支付操作（单笔） ====================
  const openPay = (r: ReimbursementRecord) => {
    setPayRecord(r);
    setPayBankKey(''); setPayScreenshots([]); setPayRemark('');
    loadBankAccounts();
    setPayVisible(true);
  };

  const handlePayConfirm = () => {
    if (!payRecord) return;
    if (!payBankKey) { message.warning('请选择支付银行账户'); return; }
    if (payScreenshots.length === 0) { message.warning('请上传支付截图凭证'); return; }
    const bank = bankAccounts.find((b: any) => b.key === payBankKey);
    if (!bank) { message.error('未找到所选银行账户'); return; }
    const now = new Date().toISOString();
    const payDate = dayjs().format('YYYY-MM-DD');
    // 更新报销记录
    saveRecords(records.map(r => r.key === payRecord.key ? {
      ...r,
      status: 'paid',
      payDate,
      payBankAccount: bank.name || bank.shortName || '',
      payBankName: `${bank.bankName || ''}${bank.branchName ? `(${bank.branchName})` : ''}`,
      payScreenshots: [...payScreenshots],
      payRemark: payRemark.trim(),
      updatedAt: now,
    } : r));
    // 更新记账凭证
    const payVoucherNo = updateDailyBookkeeping(payRecord, bank, payDate);
    writeBankTransaction(bank, payRecord.amount, payDate, `报销支付-${payRecord.title}${payVoucherNo ? `（凭证${payVoucherNo}）` : ''}`, getDisplayName());
    // 会计账薄版本：支付后自动生成借贷两条会计分录（摘要含付款说明）
    if (isAccountingMode(getDataOwner())) {
      writeAutoEntries(getDataOwner(), {
        sourceKey: `reim-pay-${payRecord.key}`,
        debitSubject: (payRecord as any).debitSubject || (payRecord as any).mainCategory || '管理费用',
        creditSubject: (payRecord as any).creditSubject || '银行存款',
        amount: payRecord.amount,
        summary: `报销-${payRecord.title}${payRemark.trim() ? `（${payRemark.trim()}）` : ''}（支付）`,
        date: payDate,
        bookkeeper: getDisplayName(),
        auditor: payRecord.financeReviewer || getDisplayName(),
        cashier: getDisplayName(),
      });
    }
    setPayVisible(false);
    message.success('支付完成，已同步记账和银行账户');
  };

  // ==================== 合并支付 ====================

  // 从表格勾选触发合并支付
  const handleBatchPayFromChecked = () => {
    if (payCheckedRecords.length < 2) { message.warning('请至少勾选2笔报销'); return; }
    // 校验是否为同一申请人
    const applicants = Array.from(new Set(payCheckedRecords.map(r => r.applicant)));
    if (applicants.length > 1) { message.warning('合并支付仅支持同一申请人的多笔报销，当前勾选了不同申请人'); return; }
    const applicant = applicants[0];
    setBatchApplicant(applicant);
    setBatchRecords(applicantGroups[applicant] || []);
    setBatchSelectedKeys(payCheckedRecords.map(r => r.key));
    setBatchBankKey(''); setBatchScreenshots([]); setBatchRemark('');
    loadBankAccounts();
    setBatchPayVisible(true);
  };
  const openBatchPay = () => {
    // 找到有多个待支付的申请人
    const multiApplicants = Object.entries(applicantGroups).filter(([, recs]) => recs.length >= 2);
    if (multiApplicants.length === 0) {
      message.warning('当前没有同一申请人有2笔及以上待支付报销');
      return;
    }
    const [first] = multiApplicants[0];
    setBatchApplicant(first);
    setBatchRecords(applicantGroups[first]);
    setBatchSelectedKeys(applicantGroups[first].map(r => r.key));
    setBatchBankKey(''); setBatchScreenshots([]); setBatchRemark('');
    loadBankAccounts();
    setBatchPayVisible(true);
  };

  const handleBatchPayConfirm = () => {
    const selectedRecs = batchRecords.filter(r => batchSelectedKeys.includes(r.key));
    if (selectedRecs.length === 0) { message.warning('请至少选择一笔报销'); return; }
    if (!batchBankKey) { message.warning('请选择支付银行账户'); return; }
    if (batchScreenshots.length === 0) { message.warning('请上传支付截图凭证'); return; }
    const bank = bankAccounts.find((b: any) => b.key === batchBankKey);
    if (!bank) { message.error('未找到所选银行账户'); return; }
    const now = new Date().toISOString();
    const payDate = dayjs().format('YYYY-MM-DD');
    const totalAmount = selectedRecs.reduce((s, r) => s + r.amount, 0);
    const batchKey = `batch-${Date.now()}`;
    // 创建支付批次
    const batch: PaymentBatch = {
      key: batchKey,
      applicant: batchApplicant,
      applicantName: selectedRecs[0].applicantName,
      totalAmount,
      recordKeys: selectedRecs.map(r => r.key),
      bankAccount: bank.name || bank.shortName || '',
      bankName: `${bank.bankName || ''}${bank.branchName ? `(${bank.branchName})` : ''}`,
      screenshots: [...batchScreenshots],
      payDate,
      operator: getDisplayName(),
      remark: batchRemark.trim(),
    };
    savePayments([batch, ...payments]);
    // 更新所有选中报销记录
    saveRecords(records.map(r => {
      if (!batchSelectedKeys.includes(r.key)) return r;
      return {
        ...r,
        status: 'paid' as string,
        payDate,
        payBankAccount: bank.name || bank.shortName || '',
        payBankName: `${bank.bankName || ''}${bank.branchName ? `(${bank.branchName})` : ''}`,
        payScreenshots: [...batchScreenshots],
        payBatchKey: batchKey,
        payRemark: batchRemark.trim() || `合并支付 ${selectedRecs.length} 笔`,
        updatedAt: now,
      };
    }));
    // 为每笔报销更新记账凭证（收集凭证编号写入银行明细备注）
    const batchVoucherNos = selectedRecs.map(r => updateDailyBookkeeping(r, bank, payDate)).filter(Boolean);
    // 写入银行账户明细（合并为一笔）
    writeBankTransaction(bank, totalAmount, payDate, `报销合并支付-${selectedRecs.length}笔-${selectedRecs[0].applicantName}${batchVoucherNos.length ? `（凭证${batchVoucherNos.join('、')}）` : ''}`, getDisplayName());
    // 会计账薄版本：合并支付后为每笔报销分别自动生成借贷两条会计分录
    if (isAccountingMode(getDataOwner())) {
      selectedRecs.forEach(r => {
        writeAutoEntries(getDataOwner(), {
          sourceKey: `reim-pay-${r.key}`,
          debitSubject: (r as any).debitSubject || (r as any).mainCategory || '管理费用',
          creditSubject: (r as any).creditSubject || '银行存款',
          amount: r.amount,
          summary: `报销-${r.title}${batchRemark.trim() ? `（${batchRemark.trim()}）` : ''}（合并支付）`,
          date: payDate,
          bookkeeper: getDisplayName(),
          auditor: r.financeReviewer || getDisplayName(),
          cashier: getDisplayName(),
        });
      });
    }
    setBatchPayVisible(false);
    message.success(`已合并支付 ${selectedRecs.length} 笔共 ¥${totalAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`);
  };

  // ==================== 写入银行账户 ====================
  const writeBankTransaction = (bank: any, amount: number, payDate: string, remark: string, person: string) => {
    try {
      const baKey = `pageData_finance_bank-account_${getDataOwner()}`;
      const bas: any[] = JSON.parse(localStorage.getItem(baKey) || '[]');
      const i = bas.findIndex((b: any) => b.key === bank.key);
      if (i < 0) return;
      const nowTime = `${payDate} ${new Date().toTimeString().slice(0, 8)}`;
      const bal = Number(bas[i].balance) || 0;
      const nb = bal - amount;
      bas[i].transactions = [...(bas[i].transactions || []), {
        time: nowTime, type: 'out', amount, balanceAfter: nb, remark, person,
      }];
      bas[i].balance = nb;
      safeSetItem(baKey, JSON.stringify(bas));
    } catch { /* ignore */ }
  };

  // ==================== 写入日常记账 ====================

  /** 审核通过时自动生成记账凭证（待支付状态，尚无银行账户信息） */
  const writeApprovalVoucher = (rec: ReimbursementRecord, mainCategory?: string) => {
    // 日常记账自动生成的报销单不再回写日常记账（避免重复）
    if (rec.source === 'daily_book') return;
    try {
      const bkKey = `daily_bookkeeping_${getDataOwner()}`;
      const bks: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      // 防止重复生成
      if (bks.some((b: any) => b.key === `bk-reim-${rec.key}`)) return;
      const category = mainCategory ? `${mainCategory}-${rec.category}` : rec.category || '报销';
      // 生成凭证编号
      const d = dayjs().format('YYYY-MM-DD');
      const prefix = `PZ-${d.replace(/-/g, '')}`;
      const todayCount = bks.filter((b: any) => (b.voucherNo || '').startsWith(prefix)).length;
      const voucherNo = `${prefix}-${String(todayCount + 1).padStart(3, '0')}`;
      const bkRec = {
        key: `bk-reim-${rec.key}`,
        voucherNo,
        bookDate: dayjs().format('YYYY-MM-DD'),
        bookType: '支出',
        category,
        amount: rec.amount,
        counterparty: rec.applicantName,
        remark: `报销-${rec.title}（审核通过）`,
        person: getDisplayName(),
        auditor: getDisplayName(),  // 审核人即当前操作人
        cashier: '',                // 出纳在支付时填充
        payAccount: '',
        recvAccount: '',
        recvBank: '',
        payBank: '',
        image: rec.receipts?.[0] || '',
        createdAt: new Date().toISOString(),
      };
      bks.unshift(bkRec);
      safeSetItem(bkKey, JSON.stringify(bks));
    } catch { /* ignore */ }
  };

  /** 支付时更新已有记账凭证的银行账户和截图信息，返回凭证编号供银行明细备注使用 */
  const updateDailyBookkeeping = (rec: ReimbursementRecord, bank: any, payDate: string): string => {
    // 垫付来源报销：支付时将付款银行回写到来源日常记账记录
    if (rec.source === 'daily_book') {
      try {
        const bkKey = `daily_bookkeeping_${getDataOwner()}`;
        const bks: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
        const idx = bks.findIndex((b: any) => b.key === rec.sourceBookKey);
        if (idx >= 0) {
          bks[idx] = { ...bks[idx], payAccount: bank.name || bank.shortName || '', payBank: bank.bankName || '', cashier: getDisplayName() };
          safeSetItem(bkKey, JSON.stringify(bks));
          return bks[idx].voucherNo || '';
        }
      } catch { /* ignore */ }
      return '';
    }
    try {
      const bkKey = `daily_bookkeeping_${getDataOwner()}`;
      const bks: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const idx = bks.findIndex((b: any) => b.key === `bk-reim-${rec.key}`);
      if (idx >= 0) {
        // 更新已有凭证（如缺少凭证编号则补生成）
        if (!bks[idx].voucherNo) {
          const prefix = `PZ-${payDate.replace(/-/g, '')}`;
          const todayCount = bks.filter((b: any) => (b.voucherNo || '').startsWith(prefix)).length;
          bks[idx].voucherNo = `${prefix}-${String(todayCount + 1).padStart(3, '0')}`;
        }
        bks[idx] = {
          ...bks[idx],
          bookDate: payDate,
          category: rec.mainCategory ? `${rec.mainCategory}-${rec.category}` : bks[idx].category,
          payAccount: bank.name || bank.shortName || '',
          payBank: bank.bankName || '',
          image: rec.payScreenshots?.[0] || bks[idx].image || '',
          remark: `报销-${rec.title}`,
          auditor: rec.financeReviewer || bks[idx].auditor || getDisplayName(),  // 审核人
          cashier: getDisplayName(),  // 出纳即支付操作人
        };
      } else {
        // 兆底：如果审核时未生成凭证，则新建
        const prefix = `PZ-${payDate.replace(/-/g, '')}`;
        const todayCount = bks.filter((b: any) => (b.voucherNo || '').startsWith(prefix)).length;
        bks.unshift({
          key: `bk-reim-${rec.key}`,
          voucherNo: `${prefix}-${String(todayCount + 1).padStart(3, '0')}`,
          bookDate: payDate,
          bookType: '支出',
          category: rec.mainCategory ? `${rec.mainCategory}-${rec.category}` : rec.category || '报销',
          amount: rec.amount,
          counterparty: rec.applicantName,
          remark: `报销-${rec.title}`,
          person: getDisplayName(),
          auditor: rec.financeReviewer || getDisplayName(),  // 审核人
          cashier: getDisplayName(),  // 出纳即支付操作人
          payAccount: bank.name || bank.shortName || '',
          recvAccount: '',
          recvBank: '',
          payBank: bank.bankName || '',
          image: rec.payScreenshots?.[0] || '',
          createdAt: new Date().toISOString(),
        });
      }
      safeSetItem(bkKey, JSON.stringify(bks));
      return (idx >= 0 ? bks[idx].voucherNo : bks[0].voucherNo) || '';
    } catch { /* ignore */ }
    return '';
  };

  // ==================== 列定义 ====================
  const receiptRender = (imgs: string[]) => (
    imgs && imgs.length > 0 ? (
      <Space size={4} wrap>
        {imgs.map((img, idx) => (
          <Image key={idx} src={img} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} />
        ))}
      </Space>
    ) : <span style={{ color: '#ccc' }}>—</span>
  );

  const amountRender = (v: number, r: ReimbursementRecord) => (
    <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>
      ¥{(Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
    </Text>
  );

  const statusRender = (v: string) => {
    const s = STATUS_MAP[v] || { color: 'default', text: v };
    return <Tag color={s.color}>{s.text}</Tag>;
  };

  const myColumns: ColumnsType<ReimbursementRecord> = [
    { title: '序号', key: 'rowIndex', width: 50, align: 'center', render: (_v, _r, idx) => idx + 1 },
    { title: '报销编号', dataIndex: 'reimbursementNo', key: 'reimbursementNo', width: 140, align: 'center', render: (v: string) => v ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1677ff' }}>{v}</span> : '—' },
    { title: '申请日期', dataIndex: 'applyDate', key: 'applyDate', width: 100, align: 'center' },
    { title: '部门', dataIndex: 'department', key: 'department', width: 80, align: 'center', render: (_v: string, r: ReimbursementRecord) => {
      const dept = resolveDept(r);
      return dept ? <Tag color="blue">{dept}</Tag> : '—';
    } },
    { title: '报销标题', dataIndex: 'title', key: 'title', width: 150, ellipsis: true, render: (v: string) => <Text strong>{v}</Text> },
    { title: '费用分类', dataIndex: 'category', key: 'category', width: 85, align: 'center', render: (v: string) => <Tag>{v}</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, align: 'right', render: amountRender },
    { title: '费用说明', dataIndex: 'description', key: 'description', width: 150, ellipsis: true, render: (v: string) => v || '—' },
    { title: '发票/收据', dataIndex: 'receipts', key: 'receipts', width: 100, align: 'center', render: receiptRender },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center', render: statusRender },
    { title: '审核人', dataIndex: 'financeReviewer', key: 'financeReviewer', width: 80, align: 'center', render: (v: string) => v || '—' },
    { title: '审核意见', dataIndex: 'financeComment', key: 'financeComment', width: 120, ellipsis: true, render: (v: string, r: ReimbursementRecord) => (
      v ? <span style={{ color: r.status === 'rejected' ? '#f5222d' : undefined, fontWeight: r.status === 'rejected' ? 600 : undefined }}>{v}</span> : '—'
    ) },
    { title: '支付日期', dataIndex: 'payDate', key: 'payDate', width: 100, align: 'center', render: (v: string) => v || '—' },
    { title: '支付凭证', dataIndex: 'payScreenshots', key: 'payScreenshots', width: 100, align: 'center', render: (imgs: string[]) => receiptRender(imgs || []) },
    { title: '支付账户', dataIndex: 'payBankAccount', key: 'payBankAccount', width: 160, render: (v: string, r: ReimbursementRecord) => (
      v ? <div style={{ wordBreak: 'break-all' }}><div style={{ fontWeight: 500, fontSize: 12 }}>{v}</div><div style={{ fontSize: 11, color: '#888' }}>{r.payBankName}</div></div> : '—'
    ) },
    { title: '收款账户', dataIndex: 'receivingAccount', key: 'receivingAccount', width: 150, align: 'center', render: (v: string, r: ReimbursementRecord) => {
      if (!v && !r.receivingAccountName) return '—';
      const acc = receivingAccounts.find((x: any) => x.key === v)
        || allRecvAccounts.find((x: any) => x.key === v)
        || (r.receivingAccountName ? { name: r.receivingAccountName, account: r.receivingAccountNo || '', type: r.receivingAccountType || '' } : null);
      if (!acc) return <span style={{ color: '#999' }}>账户已删除</span>;
      const icon = acc.type === '支付宝' ? '🟢' : acc.type === '银行账户' ? '🏦' : '📱';
      return <span style={{ fontSize: 12 }}>{icon} {acc.name}<div style={{ fontSize: 11, color: '#888' }}>{acc.account}</div></span>;
    } },
    { title: '来源', key: 'source', width: 80, align: 'center', render: (_v, r: ReimbursementRecord) => (
      r.source === 'daily_book' ? <Tag color="purple">日常记账</Tag> : <Tag>手动申请</Tag>
    ) },
    { title: '操作', key: 'action', width: 130, align: 'center', fixed: 'right', render: (_v, r: ReimbursementRecord) => (
      <Space size={4} wrap>
        {r.status === 'pending_review' && r.source !== 'daily_book' && (
          <>
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEditApply(r)}>编辑</Button>
            <Popconfirm title="确定取消该申请？" onConfirm={() => handleCancelApply(r)}><Button size="small" type="link" danger>取消</Button></Popconfirm>
          </>
        )}
        {r.status === 'pending_review' && r.source === 'daily_book' && (
          <span style={{ color: '#999', fontSize: 11 }}>来源日常记账，请在日常记账中修改</span>
        )}
        {(r.status === 'approved' || r.status === 'paid') && (
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => { setVoucherRecord(r); setVoucherVisible(true); }}>凭证</Button>
        )}
        {(r.status === 'rejected' || r.status === 'cancelled') && (
          <Popconfirm title="确定删除该申请？" onConfirm={() => handleDeleteApply(r)}><Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
        )}
        {r.status === 'rejected' && (
          <Button size="small" type="link" icon={<RedoOutlined />} onClick={() => openReapply(r)}>重新申请</Button>
        )}
      </Space>
    ) },
  ];

  const reviewColumns: ColumnsType<ReimbursementRecord> = [
    { title: '序号', key: 'rowIndex', width: 50, align: 'center', render: (_v, _r, idx) => idx + 1 },
    { title: '报销编号', dataIndex: 'reimbursementNo', key: 'reimbursementNo', width: 140, align: 'center', render: (v: string) => v ? <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1677ff' }}>{v}</span> : '—' },
    { title: '申请日期', dataIndex: 'applyDate', key: 'applyDate', width: 100, align: 'center' },
    { title: '部门', dataIndex: 'department', key: 'department', width: 80, align: 'center', render: (_v: string, r: ReimbursementRecord) => {
      const dept = resolveDept(r);
      return dept ? <Tag color="blue">{dept}</Tag> : '—';
    } },
    { title: '申请人', dataIndex: 'applicantName', key: 'applicantName', width: 80, align: 'center' },
    { title: '报销标题', dataIndex: 'title', key: 'title', width: 150, ellipsis: true, render: (v: string) => <Text strong>{v}</Text> },
    { title: '费用分类', dataIndex: 'category', key: 'category', width: 85, align: 'center', render: (v: string) => <Tag>{v}</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, align: 'right', render: amountRender },
    { title: '费用说明', dataIndex: 'description', key: 'description', width: 160, ellipsis: true, render: (v: string) => v || '—' },
    { title: '发票/收据', dataIndex: 'receipts', key: 'receipts', width: 100, align: 'center', render: receiptRender },
    { title: '操作', key: 'action', width: 150, align: 'center', fixed: 'right', render: (_v, r: ReimbursementRecord) => (
      <Space size={4}>
        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => openReview(r, 'approve')}>通过</Button>
        <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReview(r, 'reject')}>拒绝</Button>
      </Space>
    ) },
  ];

  const paymentColumns: ColumnsType<ReimbursementRecord> = [
    { title: '序号', key: 'rowIndex', width: 50, align: 'center', render: (_v, _r, idx) => idx + 1 },
    { title: '申请日期', dataIndex: 'applyDate', key: 'applyDate', width: 100, align: 'center' },
    { title: '部门', dataIndex: 'department', key: 'department', width: 80, align: 'center', render: (_v: string, r: ReimbursementRecord) => {
      const dept = resolveDept(r);
      return dept ? <Tag color="blue">{dept}</Tag> : '—';
    } },
    { title: '申请人', dataIndex: 'applicantName', key: 'applicantName', width: 80, align: 'center' },
    { title: '报销标题', dataIndex: 'title', key: 'title', width: 150, ellipsis: true, render: (v: string) => <Text strong>{v}</Text> },
    { title: '费用分类', dataIndex: 'category', key: 'category', width: 85, align: 'center', render: (v: string) => <Tag>{v}</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, align: 'right', render: amountRender },
    { title: '收款账户', key: 'recvAccount', width: 150, render: (_v: any, r: ReimbursementRecord) => recvAccountRender(r) },
    { title: '费用说明', dataIndex: 'description', key: 'description', width: 160, ellipsis: true, render: (v: string) => v || '—' },
    { title: '发票/收据', dataIndex: 'receipts', key: 'receipts', width: 100, align: 'center', render: receiptRender },
    { title: '操作', key: 'action', width: 90, align: 'center', render: (_v, r: ReimbursementRecord) => (
      <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => openPay(r)}>支付</Button>
    ) },
  ];

  // 合并支付按申请人分组
  const applicantGroups = useMemo(() => {
    const groups: Record<string, ReimbursementRecord[]> = {};
    paymentRecords.forEach(r => {
      if (!groups[r.applicant]) groups[r.applicant] = [];
      groups[r.applicant].push(r);
    });
    return groups;
  }, [paymentRecords]);

  return (
    <div ref={tableWrapRef} style={{ padding: 16, height: '100%', overflow: 'hidden' }}>
      <Card style={{ display: 'flex', flexDirection: 'column', height: '100%' }} styles={{ body: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0, color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />报销管理</Title>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openApply}>申请报销</Button>
          </Space>
        </div>

        {/* 汇总统计 */}
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small" style={{ background: '#fffbe6', borderColor: '#ffe58f' }}>
              <Statistic title="我的待审核" value={stats.myPending} suffix="笔" valueStyle={{ color: '#d48806', fontSize: 18 }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small" style={{ background: '#e6f7ff', borderColor: '#91d5ff' }}>
              <Statistic title="我的待支付" value={stats.myApproved} suffix="笔" valueStyle={{ color: '#1890ff', fontSize: 18 }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
              <Statistic title="我的已报销" value={stats.myPaid} precision={2} prefix="¥" valueStyle={{ color: '#52c41a', fontSize: 18 }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small" style={{ background: '#fff1f0', borderColor: '#ffa39e' }}>
              <Statistic title="待审核总数" value={stats.totalPendingReview} suffix="笔" valueStyle={{ color: '#ff4d4f', fontSize: 18 }} prefix={<Badge count={stats.totalPendingReview > 0 ? stats.totalPendingReview : 0} size="small" offset={[4, 0]} />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small" style={{ background: '#f0f5ff', borderColor: '#adc6ff' }}>
              <Statistic title="待支付总额" value={stats.totalPendingPay} precision={2} prefix="¥" valueStyle={{ color: PRIMARY, fontSize: 18 }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="本月已支付" value={stats.totalPaidMonth} precision={2} prefix="¥" valueStyle={{ color: '#52c41a', fontSize: 18 }} />
            </Card>
          </Col>
        </Row>

        {/* 搜索栏 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Input placeholder="搜索编号/标题/分类/说明/申请人" allowClear style={{ width: 260 }} value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onPressEnter={() => setSearchApplied(searchInput)} />
          {activeTab === 'my' && (
            <Select placeholder="状态筛选" allowClear style={{ width: 120 }} value={statusFilter || undefined}
              onChange={v => setStatusFilter(v || '')}
              options={[
                { label: '待审核', value: 'pending_review' },
                { label: '已通过', value: 'approved' },
                { label: '已拒绝', value: 'rejected' },
                { label: '已支付', value: 'paid' },
                { label: '已取消', value: 'cancelled' },
              ]} />
          )}
          <DatePicker.RangePicker style={{ width: 240 }} value={dateRange as any}
            onChange={v => setDateRange(v as any)} />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => {
            setSearchApplied(searchInput);
            setDateRangeApplied(dateRange && dateRange[0] && dateRange[1] ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')] : null);
          }}>查询</Button>
          <Button onClick={() => { setSearchInput(''); setSearchApplied(''); setStatusFilter(''); setDateRange(null); setDateRangeApplied(null); }}>重置</Button>
          <Button icon={<DownloadOutlined />} onClick={() => {
            const headers = ['申请日期', '部门', '报销标题', '费用分类', '金额', '费用说明', '申请人', '状态', '审核人', '审核意见', '支付日期', '支付账户'];
            const rows = myRecords.map(r => [
              r.applyDate, r.department || '', r.title, r.category, String(r.amount), r.description, r.applicantName,
              STATUS_MAP[r.status]?.text || r.status, r.financeReviewer || '', r.financeComment || '',
              r.payDate || '', r.payBankAccount || '',
            ]);
            const csv = '\ufeff' + [headers, ...rows].map(line => line.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `报销记录_${new Date().toLocaleDateString('zh-CN')}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
            message.success('已导出');
          }}>导出</Button>
        </div>

        {/* 标签页 */}
        <Tabs
          activeKey={activeTab}
          onChange={v => { setActiveTab(v); setTimeout(calcTableScrollY, 80); }}
          items={[
            {
              key: 'my',
              label: <span><FileTextOutlined /> 我的申请</span>,
              children: (
                <Table
                  bordered
                  size="small"
                  rowKey="key"
                  scroll={{ x: 1950, y: tableScrollY }}
                  dataSource={myRecords}
                  columns={myColumns}
                  pagination={{ pageSize: pageSizeMy, showSizeChanger: true, showTotal: t => `共 ${t} 条`, onShowSizeChange: (_c, s) => setPageSizeMy(s) }}
                  locale={{ emptyText: <Empty description="暂无报销申请，点击「申请报销」开始" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                />
              ),
            },
            {
              key: 'review',
              label: <span><Badge count={reviewRecords.length} size="small" offset={[8, 0]}><ClockCircleOutlined /> 待审核</Badge></span>,
              children: (
                <div>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                    {isAdmin && <Tooltip title={`负责人：${getManagerDisplayNames('review')}`}>
                      <Button size="small" icon={<SettingOutlined />} onClick={() => { setManagerSelectedUsers(tabManagers.review || []); setManagerModalTab('review'); }}>负责人设置</Button>
                    </Tooltip>}
                  </div>
                  {isTabManager('review') ? (
                    <Table
                      bordered
                      size="small"
                      rowKey="key"
                      scroll={{ x: 1220, y: tableScrollY }}
                      dataSource={reviewRecords}
                      columns={reviewColumns}
                      pagination={{ pageSize: pageSizeReview, showSizeChanger: true, showTotal: t => `共 ${t} 条`, onShowSizeChange: (_c, s) => setPageSizeReview(s) }}
                      locale={{ emptyText: <Empty description="暂无待审核报销" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    />
                  ) : (
                    <Empty description="您不是该模块的负责人，无法操作此页面" />
                  )}
                </div>
              ),
            },
            {
              key: 'payment',
              label: <span><Badge count={paymentRecords.length} size="small" offset={[8, 0]}><DollarOutlined /> 待支付</Badge></span>,
              children: (
                <div>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text type="secondary">通过审核后，出纳可在此进行支付。勾选同一申请人的多笔可合并支付。</Text>
                    <Space>
                      {isAdmin && <Tooltip title={`负责人：${getManagerDisplayNames('payment')}`}>
                        <Button size="small" icon={<SettingOutlined />} onClick={() => { setManagerSelectedUsers(tabManagers.payment || []); setManagerModalTab('payment'); }}>负责人设置</Button>
                      </Tooltip>}
                      <Button icon={<MergeCellsOutlined />} onClick={openBatchPay}
                        disabled={!Object.values(applicantGroups).some(recs => recs.length >= 2)}>合并支付</Button>
                    </Space>
                  </div>
                  {isTabManager('payment') ? (
                    <>
                  {/* 按申请人分组显示，每组带复选框 */}
                  {Object.entries(applicantGroups).map(([applicant, recs]) => (
                    <Card key={applicant} size="small" style={{ marginBottom: 12 }}
                      title={<span><Text strong>{recs[0].applicantName}</Text> <Tag color="blue">{recs.length} 笔待支付</Tag>
                        <Text type="secondary" style={{ marginLeft: 12 }}>合计 ¥{recs.reduce((s, r) => s + r.amount, 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text></span>}>
                      <Table
                        bordered
                        size="small"
                        rowKey="key"
                        scroll={{ x: 980 }}
                        dataSource={recs}
                        columns={paymentColumns}
                        pagination={false}
                        rowSelection={{
                          selectedRowKeys: payCheckKeys[applicant] || [],
                          onChange: (keys) => setPayCheckKeys(prev => ({ ...prev, [applicant]: keys as string[] })),
                        }}
                      />
                    </Card>
                  ))}
                  {/* 勾选汇总浮动栏 */}
                  {payCheckedRecords.length > 0 && (
                    <div style={{
                      position: 'sticky', bottom: 0, zIndex: 10,
                      background: 'linear-gradient(90deg, #e6f7ff, #f0f5ff)',
                      border: '1px solid #91d5ff', borderRadius: 8,
                      padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
                    }}>
                      <Space size={16}>
                        <Text>已勾选 <Text strong style={{ color: PRIMARY }}>{payCheckedRecords.length}</Text> 笔</Text>
                        <Text>合计金额 <Text strong style={{ color: PRIMARY, fontSize: 18, fontFamily: 'monospace' }}>
                          ¥{payCheckedTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                        </Text></Text>
                        {payCheckedRecords.length > 0 && (() => {
                          const apps = Array.from(new Set(payCheckedRecords.map(r => r.applicant)));
                          if (apps.length > 1) return <Tag color="warning">包含不同申请人，合并支付需同一申请人</Tag>;
                          return <Tag color="success">{payCheckedRecords[0].applicantName}</Tag>;
                        })()}
                      </Space>
                      <Space>
                        <Button onClick={() => setPayCheckKeys({})}>清空勾选</Button>
                        <Button type="primary" icon={<MergeCellsOutlined />} style={{ color: '#fff' }}
                          disabled={payCheckedRecords.length < 2 || Array.from(new Set(payCheckedRecords.map(r => r.applicant))).length > 1}
                          onClick={handleBatchPayFromChecked}>
                          合并支付选中项
                        </Button>
                      </Space>
                    </div>
                  )}
                  {Object.keys(applicantGroups).length === 0 && (
                    <Empty description="暂无待支付报销" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                    </>
                  ) : (
                    <Empty description="您不是该模块的负责人，无法操作此页面" />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ==================== 申请报销弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />{editRecord ? (editRecord.status === 'rejected' ? '重新申请报销' : '编辑报销申请') : '申请报销'}</span>}
        open={applyVisible}
        onCancel={() => setApplyVisible(false)}
        onOk={handleApplySave}
        okText="提交"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        {/* 报销编号 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>报销编号</div>
          <Input
            value={editRecord?.reimbursementNo || ''}
            placeholder="提交后自动生成"
            disabled
            style={{ fontFamily: 'monospace', color: '#1677ff', background: '#f5f5f5' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>报销标题 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input placeholder="如：出差报销-北京客户拜访" value={formTitle} onChange={e => setFormTitle(e.target.value)} />
        </div>
        <Row gutter={12}>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>费用分类 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <Select style={{ width: '100%' }} placeholder="选择分类" value={formCategory || undefined}
              onChange={v => setFormCategory(v)} options={EXPENSE_CATEGORIES} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>报销金额 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="请输入金额"
              value={formAmount} onChange={v => setFormAmount(v === null ? undefined : v)} />
          </Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>费用说明</div>
          <Input.TextArea rows={3} placeholder="请详细描述费用用途、时间、参与人等" value={formDescription} onChange={e => setFormDescription(e.target.value)} />
        </div>
        {/* 收款账户选择 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>收款账户</span>
            <Button size="small" type="link" icon={<PlusOutlined />} onClick={openRecvAddModal}>新增收款账户</Button>
          </div>
          <Select
            style={{ width: '100%' }}
            value={formReceivingAccount || undefined}
            placeholder="选择收款账户（支付宝/银行账户/收款码）"
            showSearch
            filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            onChange={v => setFormReceivingAccount(v)}
            options={receivingAccountOptions}
            allowClear
            onClear={() => setFormReceivingAccount('')}
            notFoundContent={
              <div style={{ textAlign: 'center', padding: '12px' }}>
                <div style={{ color: '#999', marginBottom: 4 }}>暂无收款账户</div>
                <div style={{ fontSize: 12, color: '#bbb' }}>点击上方「新增收款账户」按键添加，或在「日常记账-本人垫付」中添加</div>
              </div>
            }
          />
          <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>报销支付时将转入此账户；账户库按子账号独立，与日常记账-本人垫付共用</div>
        </div>
        {/* 发票/收据上传 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>发票/收据</span>
            <Button size="small" icon={<SnippetsOutlined />} onClick={() => handlePasteImage(url => setFormReceipts(prev => [...prev, url]))}>粘贴剪切板</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {formReceipts.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={img} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 6 }} />
                <Button size="small" danger type="text" icon={<DeleteOutlined />}
                  onClick={() => setFormReceipts(prev => prev.filter((_, i) => i !== idx))}
                  style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </div>
            ))}
            <div
              style={{ width: 80, height: 80, border: '2px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
              onClick={() => handleUploadImage(url => setFormReceipts(prev => [...prev, url]))}
            >
              <div style={{ textAlign: 'center' }}>
                <PictureOutlined style={{ fontSize: 20 }} />
                <div style={{ fontSize: 10, marginTop: 2 }}>上传</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: '#999' }}>申请人：{getDisplayName()}（自动记录）</div>
      </Modal>

      {/* ==================== 新增收款账户弹窗（与日常记账-本人垫付共用账户库） ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><WalletOutlined style={{ marginRight: 8 }} />新增收款账户</span>}
        open={recvModalVisible}
        onCancel={() => setRecvModalVisible(false)}
        onOk={handleSaveRecvAccount}
        okText="保存"
        cancelText="取消"
        width={480}
        zIndex={1100}
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
                {t === '支付宝' ? '🟢' : t === '银行账户' ? '🏦' : '📱'} {t}
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
        {recvFormType === '收款码' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>收款码图片 <span style={{ color: '#ff4d4f' }}>*</span></span>
              <Button size="small" icon={<SnippetsOutlined />} onClick={handleRecvPasteImage}>粘贴剪切板</Button>
            </div>
            {recvFormImage ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={recvFormImage} width={150} height={150} style={{ objectFit: 'cover', borderRadius: 8 }} />
                <Button size="small" danger type="text" icon={<DeleteOutlined />}
                  onClick={() => setRecvFormImage('')}
                  style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </div>
            ) : (
              <div
                style={{ width: 150, height: 150, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; input.accept = 'image/*';
                  input.onchange = async (ev: any) => {
                    const file = ev.target?.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { message.warning('图片大小不能超过5MB'); return; }
                    const dataUrl = await compressImageFile(file);
                    setRecvFormImage(dataUrl);
                  };
                  input.click();
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <PictureOutlined style={{ fontSize: 22 }} />
                  <div style={{ fontSize: 11, marginTop: 4 }}>点击上传</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#999' }}>账户库按子账号独立，保存后自动选中并同步到「日常记账-本人垫付」</div>
      </Modal>

      {/* ==================== 审核弹窗 ==================== */}
      <Modal
        title={<span style={{ color: reviewAction === 'approve' ? '#52c41a' : '#ff4d4f' }}>
          {reviewAction === 'approve' ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />} {reviewAction === 'approve' ? '通过报销申请' : '拒绝报销申请'}
        </span>}
        open={reviewVisible}
        onCancel={() => setReviewVisible(false)}
        onOk={handleReviewConfirm}
        okText={reviewAction === 'approve' ? '确认通过' : '确认拒绝'}
        okButtonProps={{ danger: reviewAction === 'reject' }}
        cancelText="取消"
        width={480}
      >
        {reviewRecord && (
          <div style={{ background: '#fafafa', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}><Text type="secondary">申请人：</Text><Text>{reviewRecord.applicantName}</Text></Col>
              <Col span={12}><Text type="secondary">金额：</Text><Text strong style={{ color: PRIMARY }}>¥{reviewRecord.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text></Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={12}><Text type="secondary">分类：</Text><Text>{reviewRecord.category}</Text></Col>
              <Col span={12}><Text type="secondary">日期：</Text><Text>{reviewRecord.applyDate}</Text></Col>
            </Row>
            <div style={{ marginTop: 8 }}><Text type="secondary">标题：</Text><Text>{reviewRecord.title}</Text></div>
            {reviewRecord.description && <div style={{ marginTop: 8 }}><Text type="secondary">说明：</Text><Text>{reviewRecord.description}</Text></div>}
            {reviewRecord.receipts && reviewRecord.receipts.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">发票/收据：</Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {reviewRecord.receipts.map((img, idx) => (
                    <Image key={idx} src={img} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {reviewAction === 'approve' && (
          <div style={{ marginBottom: 12 }}>
            {!isAccountingMode(getDataOwner()) && (<>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>主分类 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Select style={{ width: '100%' }} placeholder="选择报销主分类（写入日常记账分类）"
                value={reviewMainCategory || undefined} onChange={v => setReviewMainCategory(v)}
                options={MAIN_EXPENSE_CATEGORIES} />
            </>)}
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>子分类：{reviewRecord?.category}（将写入记账备注）</div>
          </div>
        )}
        {reviewAction === 'approve' && isAccountingMode(getDataOwner()) && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>借方科目</div>
                <Select showSearch allowClear style={{ width: '100%' }} placeholder="请选择借方科目（默认空白）" value={reviewDebit || undefined}
                  onChange={v => setReviewDebit(v || '')} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>贷方科目</div>
                <Select showSearch style={{ width: '100%' }} value={reviewCredit} onChange={v => setReviewCredit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>说明与处理逻辑：贷方默认填充银行存款，借方需审核人员手动选择（默认空白，未选时支付时回退为管理费用）；出纳支付后系统按借/贷科目在「会计账薄-会计分录」生成 2 条分录，并将付款说明写入摘要。仅「会计账薄」开关开启时生效（开启时不再显示主分类）。</div>
          </div>
        )}
        <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>审核意见</div>
        <Input.TextArea rows={3} placeholder={reviewAction === 'approve' ? '可选填审核意见' : '请填写拒绝原因'}
          value={reviewComment} onChange={e => setReviewComment(e.target.value)} />
      </Modal>

      {/* ==================== 单笔支付弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />支付报销</span>}
        open={payVisible}
        onCancel={() => setPayVisible(false)}
        onOk={handlePayConfirm}
        okText="确认支付"
        cancelText="取消"
        width={560}
      >
        {payRecord && (
          <div style={{ background: '#fafafa', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}><Text type="secondary">申请人：</Text><Text>{payRecord.applicantName}</Text></Col>
              <Col span={12}><Text type="secondary">报销金额：</Text>
                <Text strong style={{ color: PRIMARY, fontSize: 18 }}>¥{payRecord.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={12}><Text type="secondary">标题：</Text><Text>{payRecord.title}</Text></Col>
              <Col span={12}><Text type="secondary">分类：</Text><Text>{payRecord.category}</Text></Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={24}><Text type="secondary">收款账户：</Text>{recvAccountRender(payRecord)}</Col>
            </Row>
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>支付银行账户 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Select style={{ width: '100%' }} placeholder="选择支付银行账户" value={payBankKey || undefined}
            onChange={v => setPayBankKey(v)} options={bankAccountOptions}
            showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>支付截图凭证 <span style={{ color: '#ff4d4f' }}>*</span></span>
            <Button size="small" icon={<SnippetsOutlined />} onClick={() => handlePasteImage(url => setPayScreenshots(prev => [...prev, url]))}>粘贴剪切板</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {payScreenshots.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={img} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 6 }} />
                <Button size="small" danger type="text" icon={<DeleteOutlined />}
                  onClick={() => setPayScreenshots(prev => prev.filter((_, i) => i !== idx))}
                  style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </div>
            ))}
            <div
              style={{ width: 80, height: 80, border: '2px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
              onClick={() => handleUploadImage(url => setPayScreenshots(prev => [...prev, url]))}
            >
              <div style={{ textAlign: 'center' }}>
                <PictureOutlined style={{ fontSize: 20 }} />
                <div style={{ fontSize: 10, marginTop: 2 }}>上传</div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>支付备注</div>
          <Input placeholder="可选填" value={payRemark} onChange={e => setPayRemark(e.target.value)} />
        </div>
      </Modal>

      {/* ==================== 合并支付弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><MergeCellsOutlined style={{ marginRight: 8 }} />合并支付</span>}
        open={batchPayVisible}
        onCancel={() => setBatchPayVisible(false)}
        onOk={handleBatchPayConfirm}
        okText="确认合并支付"
        cancelText="取消"
        width={680}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>选择申请人</div>
          <Select style={{ width: '100%' }} value={batchApplicant || undefined}
            onChange={v => {
              setBatchApplicant(v);
              const recs = paymentRecords.filter(r => r.applicant === v);
              setBatchRecords(recs);
              setBatchSelectedKeys(recs.map(r => r.key));
            }}
            options={Object.entries(applicantGroups).map(([k, recs]) => ({
              label: `${recs[0].applicantName}（${recs.length} 笔，合计 ¥${recs.reduce((s, r) => s + r.amount, 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}）`,
              value: k,
            }))} />
        </div>
        {/* 汇总金额 */}
        <div style={{ background: '#f0f5ff', borderRadius: 8, padding: 16, marginBottom: 12, textAlign: 'center' }}>
          <Text type="secondary">本次合并支付金额</Text>
          <div style={{ fontSize: 28, fontWeight: 700, color: PRIMARY, fontFamily: 'monospace' }}>
            ¥{batchRecords.filter(r => batchSelectedKeys.includes(r.key))
              .reduce((s, r) => s + r.amount, 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </div>
          <Text type="secondary">{batchSelectedKeys.length} 笔报销</Text>
        </div>
        {/* 选择要合并的报销 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>选择报销项（可取消勾选）</div>
          <Table
            bordered
            size="small"
            rowKey="key"
            dataSource={batchRecords}
            pagination={false}
            rowSelection={{
              selectedRowKeys: batchSelectedKeys,
              onChange: (keys) => setBatchSelectedKeys(keys as string[]),
            }}
            columns={[
              { title: '标题', dataIndex: 'title', key: 'title', width: 160 },
              { title: '分类', dataIndex: 'category', key: 'category', width: 80, render: (v: string) => <Tag>{v}</Tag> },
              { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right', render: amountRender },
              { title: '收款账户', key: 'recvAccount', width: 140, render: (_v: any, r: ReimbursementRecord) => recvAccountRender(r) },
              { title: '申请日期', dataIndex: 'applyDate', key: 'applyDate', width: 100 },
            ]}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>支付银行账户 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Select style={{ width: '100%' }} placeholder="选择支付银行账户" value={batchBankKey || undefined}
            onChange={v => setBatchBankKey(v)} options={bankAccountOptions}
            showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>支付截图凭证 <span style={{ color: '#ff4d4f' }}>*</span></span>
            <Button size="small" icon={<SnippetsOutlined />} onClick={() => handlePasteImage(url => setBatchScreenshots(prev => [...prev, url]))}>粘贴剪切板</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {batchScreenshots.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={img} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 6 }} />
                <Button size="small" danger type="text" icon={<DeleteOutlined />}
                  onClick={() => setBatchScreenshots(prev => prev.filter((_, i) => i !== idx))}
                  style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </div>
            ))}
            <div
              style={{ width: 80, height: 80, border: '2px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
              onClick={() => handleUploadImage(url => setBatchScreenshots(prev => [...prev, url]))}
            >
              <div style={{ textAlign: 'center' }}>
                <PictureOutlined style={{ fontSize: 20 }} />
                <div style={{ fontSize: 10, marginTop: 2 }}>上传</div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>支付备注</div>
          <Input placeholder="可选填" value={batchRemark} onChange={e => setBatchRemark(e.target.value)} />
        </div>
        {isAccountingMode(getDataOwner()) && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
            说明与处理逻辑：确认合并支付后，系统为勾选的每一笔报销分别按各自审核时确定的借/贷科目（借方回退为主分类/管理费用，贷方默认银行存款）在「会计账薄-会计分录」各生成 2 条分录，摘要含报销标题与支付备注；银行明细则合并为一笔支出。仅「会计账薄」开关开启时生效。
          </div>
        )}
      </Modal>

      {/* ==================== 记账凭证弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />记账凭证</span>}
        open={voucherVisible}
        onCancel={() => setVoucherVisible(false)}
        footer={[
          <Button key="print" icon={<PrinterOutlined />} onClick={() => {
            const w = window.open('', '_blank', 'width=800,height=600');
            if (!w || !voucherRecord) return;
            const r = voucherRecord;
            const statusText = STATUS_MAP[r.status]?.text || r.status;
            w.document.write(`<html><head><title>记账凭证</title><style>
              body{font-family:'Microsoft YaHei',sans-serif;padding:40px;color:#333}
              .title{text-align:center;font-size:22px;font-weight:700;margin-bottom:24px;letter-spacing:6px}
              .voucher-no{text-align:right;font-size:12px;color:#888;margin-bottom:12px}
              table{width:100%;border-collapse:collapse;margin:12px 0}
              th,td{border:1px solid #333;padding:8px 12px;font-size:13px}
              th{background:#f0f0f0;text-align:left;width:120px;font-weight:600}
              .amount{text-align:right;font-size:16px;font-weight:700;font-family:monospace}
              .footer{margin-top:32px;display:flex;justify-content:space-between;font-size:13px}
              .stamp{text-align:center;margin-top:8px;color:#1e4a7e;font-weight:600}
              img{max-width:120px;max-height:120px;border:1px solid #ddd;border-radius:4px;margin:4px}
            </style></head><body>
              <div class="title">记 账 凭 证</div>
              <div class="voucher-no">凭证编号：${r.key}</div>
              <table>
                <tr><th>报销标题</th><td colspan="3">${r.title}</td></tr>
                <tr><th>凭证日期</th><td>${r.payDate || dayjs().format('YYYY-MM-DD')}</td><th>申请日期</th><td>${r.applyDate}</td></tr>
                <tr><th>费用分类</th><td>${r.category}</td><th>收支类型</th><td>支出</td></tr>
                <tr><th>报销金额</th><td class="amount" colspan="3">¥${(r.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td></tr>
                <tr><th>申请人</th><td>${r.applicantName}</td><th>状态</th><td>${statusText}</td></tr>
                <tr><th>审核人</th><td>${r.financeReviewer || '—'}</td><th>审核日期</th><td>${r.financeReviewDate || '—'}</td></tr>
                ${r.financeComment ? `<tr><th>审核意见</th><td colspan="3">${r.financeComment}</td></tr>` : ''}
                ${r.payBankAccount ? `<tr><th>付款账户</th><td>${r.payBankAccount}</td><th>开户银行</th><td>${r.payBankName || ''}</td></tr>` : ''}
                <tr><th>费用说明</th><td colspan="3">${r.description || '—'}</td></tr>
                ${r.payRemark ? `<tr><th>支付备注</th><td colspan="3">${r.payRemark}</td></tr>` : ''}
              </table>
              ${r.receipts?.length ? '<div style="margin-top:12px"><strong>发票/收据：</strong><br/>' + r.receipts.map((img: string) => `<img src="${img}"/>`).join('') + '</div>' : ''}
              ${r.payScreenshots?.length ? '<div style="margin-top:12px"><strong>支付截图：</strong><br/>' + r.payScreenshots.map((img: string) => `<img src="${img}"/>`).join('') + '</div>' : ''}
              <div class="footer">
                <div><div class="stamp">制单人：${getDisplayName()}</div></div>
                <div><div class="stamp">审核人：${r.financeReviewer || '—'}</div></div>
                <div><div class="stamp">出纳：${r.status === 'paid' ? getDisplayName() : '—'}</div></div>
              </div>
            </body></html>`);
            w.document.close();
            w.print();
          }}>打印</Button>,
          <Button key="close" type="primary" onClick={() => setVoucherVisible(false)}>关闭</Button>,
        ]}
        width={680}
      >
        {voucherRecord && (() => {
          const r = voucherRecord;
          const statusInfo = STATUS_MAP[r.status] || { color: 'default', text: r.status };
          return (
            <div style={{ background: '#fafafa', borderRadius: 8, padding: 20 }}>
              {/* 凭证头部 */}
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 6, color: PRIMARY }}>记 账 凭 证</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>凭证编号：{r.key}</div>
              </div>
              {/* 凭证内容 */}
              <div style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...voucherTdHead }}>报销标题</td>
                      <td colSpan={3} style={{ ...voucherTd }}>{r.title}</td>
                    </tr>
                    <tr>
                      <td style={{ ...voucherTdHead }}>凭证日期</td>
                      <td style={{ ...voucherTd }}>{r.payDate || dayjs().format('YYYY-MM-DD')}</td>
                      <td style={{ ...voucherTdHead }}>申请日期</td>
                      <td style={{ ...voucherTd }}>{r.applyDate}</td>
                    </tr>
                    <tr>
                      <td style={{ ...voucherTdHead }}>费用分类</td>
                      <td style={{ ...voucherTd }}><Tag>{r.category}</Tag></td>
                      <td style={{ ...voucherTdHead }}>收支类型</td>
                      <td style={{ ...voucherTd }}><Tag color="red">支出</Tag></td>
                    </tr>
                    <tr>
                      <td style={{ ...voucherTdHead }}>报销金额</td>
                      <td colSpan={3} style={{ ...voucherTd, textAlign: 'right', fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: PRIMARY }}>
                        ¥{(r.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ ...voucherTdHead }}>申请人</td>
                      <td style={{ ...voucherTd }}>{r.applicantName}</td>
                      <td style={{ ...voucherTdHead }}>状态</td>
                      <td style={{ ...voucherTd }}><Tag color={statusInfo.color}>{statusInfo.text}</Tag></td>
                    </tr>
                    <tr>
                      <td style={{ ...voucherTdHead }}>审核人</td>
                      <td style={{ ...voucherTd }}>{r.financeReviewer || '—'}</td>
                      <td style={{ ...voucherTdHead }}>审核日期</td>
                      <td style={{ ...voucherTd }}>{r.financeReviewDate || '—'}</td>
                    </tr>
                    {r.financeComment && (
                      <tr>
                        <td style={{ ...voucherTdHead }}>审核意见</td>
                        <td colSpan={3} style={{ ...voucherTd }}>{r.financeComment}</td>
                      </tr>
                    )}
                    {r.payBankAccount && (
                      <tr>
                        <td style={{ ...voucherTdHead }}>付款账户</td>
                        <td style={{ ...voucherTd }}>{r.payBankAccount}</td>
                        <td style={{ ...voucherTdHead }}>开户银行</td>
                        <td style={{ ...voucherTd }}>{r.payBankName || '—'}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ ...voucherTdHead }}>费用说明</td>
                      <td colSpan={3} style={{ ...voucherTd }}>{r.description || '—'}</td>
                    </tr>
                    {r.payRemark && (
                      <tr>
                        <td style={{ ...voucherTdHead }}>支付备注</td>
                        <td colSpan={3} style={{ ...voucherTd }}>{r.payRemark}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* 附件区域 */}
              {((r.receipts?.length ?? 0) > 0 || (r.payScreenshots?.length ?? 0) > 0) && (
                <div style={{ marginTop: 16 }}>
                  {(r.receipts?.length ?? 0) > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text strong style={{ fontSize: 13 }}>发票/收据</Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {r.receipts.map((img, idx) => (
                          <Image key={idx} src={img} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                        ))}
                      </div>
                    </div>
                  )}
                  {(r.payScreenshots?.length ?? 0) > 0 && (
                    <div>
                      <Text strong style={{ fontSize: 13 }}>支付截图</Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {(r.payScreenshots || []).map((img, idx) => (
                          <Image key={idx} src={img} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* 签字区 */}
              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 8, minWidth: 120 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>制单人</Text>
                  <div style={{ fontWeight: 600, color: PRIMARY }}>{getDisplayName()}</div>
                </div>
                <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 8, minWidth: 120 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>审核人</Text>
                  <div style={{ fontWeight: 600, color: PRIMARY }}>{r.financeReviewer || '—'}</div>
                </div>
                <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 8, minWidth: 120 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>出纳</Text>
                  <div style={{ fontWeight: 600, color: PRIMARY }}>{r.status === 'paid' ? getDisplayName() : '—'}</div>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 负责人设置弹窗（与收/付申请同款） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><SettingOutlined style={{ marginRight: 8 }} />负责人设置 — {managerModalTab === 'review' ? '待审核' : '待支付'}</span>}
        open={!!managerModalTab}
        onCancel={() => setManagerModalTab(null)}
        onOk={() => {
          if (!managerModalTab) return;
          saveManagers(managerModalTab, managerSelectedUsers);
          setManagerModalTab(null);
        }}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
          设置该模块的操作负责人。设置后仅负责人可操作此页面，未设置时所有人都可操作。
        </div>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>选择负责人（可多选）</div>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="请选择负责人（不选表示所有人都可操作）"
          value={managerSelectedUsers}
          onChange={setManagerSelectedUsers}
          options={allUserOptions}
          showSearch
          filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        {managerSelectedUsers.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>当前负责人：</div>
            <Space wrap>
              {managerSelectedUsers.map((un: string) => {
                const opt = allUserOptions.find((o: any) => o.value === un);
                return <Tag key={un} closable onClose={() => setManagerSelectedUsers(prev => prev.filter((u: string) => u !== un))}>{opt?.label || un}</Tag>;
              })}
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ReimbursementPage;
