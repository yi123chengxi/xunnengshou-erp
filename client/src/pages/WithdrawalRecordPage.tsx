import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, DatePicker,
  Row, Col, Select, Popconfirm, Tag, Upload, Image, Checkbox, notification, Tooltip, Descriptions, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ReloadOutlined, UploadOutlined,
  DollarOutlined, BankOutlined, ShopOutlined, CheckCircleOutlined,
  EditOutlined, UndoOutlined, SettingOutlined, CloseCircleOutlined,
  WalletOutlined, TeamOutlined, ClearOutlined, SendOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import useResizableColumns from '../hooks/useResizableColumns';
import FieldConfigModal from '../components/FieldConfigModal';
import { safeSetItem } from '../utils/storageQuota';
import { sendPushNotification, showNativeNotification, isNotificationBlocked, showTimedNotification, isNotificationTypeEnabled } from '../utils/pushNotification';
import { saveDataset } from '../utils/dataStore';
import { scopeShopRecords, canEditShopData } from '../utils/shopScope';
import { isAccountingMode, writeAutoEntries, removeAutoEntries, loadSubjectOptions } from '../utils/accountingBridge';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// 银行品牌颜色映射
const BANK_COLORS: Record<string, string> = {
  '工商银行': '#c4161c', '建设银行': '#0051a5', '农业银行': '#00843e', '中国银行': '#c4161c',
  '招商银行': '#c4161c', '交通银行': '#003d79', '邮储银行': '#007a3d', '浦发银行': '#003d79',
  '民生银行': '#009e4f', '光大银行': '#7b2d8b', '中信银行': '#c4161c', '华夏银行': '#c4161c',
  '平安银行': '#f58220', '兴业银行': '#003d79', '广发银行': '#c4161c', '台州银行': '#0051a5',
  '微信': '#07c160', '支付宝': '#1677ff',
};
const getBankColor = (bankName: string): string => {
  for (const [keyword, color] of Object.entries(BANK_COLORS)) {
    if (bankName.includes(keyword)) return color;
  }
  return '#1e4a7e';
};
const getBankShortName = (bankName: string): string => {
  // 取银行名称前2个字作为简称
  const name = bankName.replace(/[\(（].+?[\)）]/g, '').trim();
  return name.length >= 2 ? name.slice(0, 2) : name;
};
// 银行卡号脱敏
const maskBankAccount = (v: string): string => {
  const s = String(v).replace(/\s/g, '');
  if (s.length <= 8) return s;
  return s.slice(0, 4) + ' **** **** ' + s.slice(-4);
};

// ===================== 类型定义 =====================
interface WithdrawalRecord {
  key: string;
  shopId: string;
  shopName: string;
  amount: number;
  accountName: string;     // 账户名称
  bankName: string;        // 开户银行（含支行）
  bankAccountNo: string;   // 银行账号
  bankAccountKey: string;  // 关联银行账户 key
  bankPerson?: string;     // 银行卡负责人（引用银行账户列表的负责人）
  screenshot: string;      // base64 截图
  inputBy: string;
  createdAt: string;
  withdrawalDate: string;  // 提现日期
  confirmed: boolean;      // 是否已确认到账
  confirmedAt: string;     // 确认时间
}

interface ShopInfo {
  key: string;
  shopName: string;
  accountId: string;
  platform?: string;
  person?: string; // 负责人
}

interface BankAccount {
  key: string;
  name: string;
  bankName: string;
  branchName: string;
  bankAccountNo: string;
  accountType: string;
  person?: string; // 负责人
}

type RechargeStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

interface RechargeRecord {
  key: string;
  shopId: string;
  shopName: string;
  shopCode: string;          // 店铺编码
  platform: string;          // 所属平台
  amount: number;            // 充值金额
  qrcode: string;            // 充值二维码
  accountName: string;       // 账户名称
  bankName: string;          // 开户银行
  bankAccountNo: string;     // 银行账号
  applicant: string;         // 申请人
  operator: string;          // 操作人
  financePerson: string;     // 财务负责人
  status: RechargeStatus;    // 状态
  rejectReason?: string;     // 驳回原因
  paidAt?: string;            // 充值日期（确认支付时间）
  createdAt: string;
  updatedAt: string;
}

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

/** 根据用户名查找显示名称 */
const getDisplayName = (username: string): string => {
  if (!username) return '—';
  // 优先从当前账号的子账号列表中查找（accounts_${owner}），确保匹配本账号下的用户
  try {
    const owner = getDataOwner();
    const accounts = JSON.parse(localStorage.getItem('accounts_' + owner) || '[]');
    const acc = accounts.find((a: any) => a.username === username);
    if (acc) return acc.displayName || acc.person || username;
  } catch { /* ignore */ }
  // 回退到全局 registeredUsers
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const user = users.find((u: any) => u.username === username);
    if (user) return user.displayName || user.contactPerson || user.companyName || username;
  } catch { /* ignore */ }
  return username;
};

const fmt = (v: number | undefined | null) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ===================== 主组件 =====================
const WithdrawalRecordPage: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const storageKey = `withdrawal_record_${owner}`;
  const shopKey = `shop_info_${owner}`;
  const bankKey = `pageData_finance_bank-account_${owner}`;

  const [records, setRecords] = useState<WithdrawalRecord[]>([]);
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [searchText, setSearchText] = useState('');

  // 负责人控制：设置后仅负责人和管理员可看全部记录，其他成员仅可见自己创建的记录
  const [wdManagers, setWdManagers] = useState<string[]>([]);
  const [managerModalVisible, setManagerModalVisible] = useState(false);
  const [managerSelectedUsers, setManagerSelectedUsers] = useState<string[]>([]);
  const managersKey = `withdrawal_recharge_managers_${owner}`;
  const isAdmin = localStorage.getItem('isSubAccount') !== 'true';
  const currentUser = localStorage.getItem('username') || '';

  // 新增/编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingKey, setEditingKey] = useState<string>('');
  const [formShop, setFormShop] = useState<string>('');
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formBankKey, setFormBankKey] = useState<string>('');  // 选择的银行账户key
  const [formAccountName, setFormAccountName] = useState<string>('');
  const [formBankName, setFormBankName] = useState<string>('');
  const [formBankAccountNo, setFormBankAccountNo] = useState<string>('');
  const [formBankPerson, setFormBankPerson] = useState<string>('');  // 银行卡负责人（自动引用银行账户负责人）
  const [formScreenshot, setFormScreenshot] = useState<string>('');
  const [formWithdrawalDate, setFormWithdrawalDate] = useState<string>(dayjs().format('YYYY-MM-DD'));

  // 子标签页
  const [activeTab, setActiveTab] = useState<'withdrawal' | 'recharge'>('withdrawal');

  // ===================== 发起提现任务 =====================
  const [withdrawTaskVisible, setWithdrawTaskVisible] = useState(false);
  const [withdrawTaskSelected, setWithdrawTaskSelected] = useState<string[]>([]); // 选中的店铺key
  const taskStatusKey = `withdrawal_task_status_${owner}`;
  // 活跃的提现任务通知（店铺key → 店铺名称）
  const [activeTaskNotifs, setActiveTaskNotifs] = useState<Map<string, string>>(new Map());
  const taskNotifTimersRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map());

  // ===================== 充值记录状态 =====================
  const rechargeKey = `recharge_record_${owner}`;
  const [rechargeRecords, setRechargeRecords] = useState<RechargeRecord[]>([]);
  const [rechFieldOrder, setRechFieldOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem(`rechFieldOrder_${owner}`); if (s) { const arr = JSON.parse(s); if (Array.isArray(arr) && arr.length) { if (!arr.includes('paidAt')) arr.push('paidAt'); return arr; } } } catch {}
    return ['shopName', 'shopCode', 'platform', 'amount', 'qrcode', 'accountName', 'bankName', 'bankAccountNo', 'applicant', 'operator', 'financePerson', 'status', 'paidAt'];
  });
  const [rechFieldVis, setRechFieldVis] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem(`rechFieldVis_${owner}`); if (s) { const d = JSON.parse(s); if (d.paidAt === undefined) d.paidAt = true; return d; } } catch {}
    const d: Record<string, boolean> = {}; ['shopName','shopCode','platform','amount','qrcode','accountName','bankName','bankAccountNo','applicant','operator','financePerson','status','paidAt'].forEach(k => d[k] = true); return d;
  });
  const [rechFieldConfigVisible, setRechFieldConfigVisible] = useState(false);
  // 充值记录搜索状态
  const [rechSearch, setRechSearch] = useState({
    shopName: '', platform: '', bankAccountNo: '', applicant: '', operator: '', financePerson: '', paidAtStart: '', paidAtEnd: '', amountRange: '',
  });
  const [rechAppliedSearch, setRechAppliedSearch] = useState({
    shopName: '', platform: '', bankAccountNo: '', applicant: '', operator: '', financePerson: '', paidAtStart: '', paidAtEnd: '', amountRange: '',
  });
  const handleRechSearchApply = useCallback(() => {
    setRechAppliedSearch({ ...rechSearch });
  }, [rechSearch]);
  const handleRechSearchReset = useCallback(() => {
    const empty = { shopName: '', platform: '', bankAccountNo: '', applicant: '', operator: '', financePerson: '', paidAtStart: '', paidAtEnd: '', amountRange: '' };
    setRechSearch(empty);
    setRechAppliedSearch(empty);
  }, []);
  // 负责人可见范围：管理员/未设置负责人/负责人本人 看全部；其他成员仅看自己创建的记录
  const canViewAll = isAdmin || wdManagers.length === 0 || wdManagers.includes(currentUser);
  const scopedRecords = useMemo(() => scopeShopRecords(owner, shops, records), [owner, shops, records]);
  const baseRecords = useMemo(() => (canViewAll ? scopedRecords : scopedRecords.filter(r => r.inputBy === currentUser)), [scopedRecords, canViewAll, currentUser]);
  const scopedRechRecords = useMemo(() => scopeShopRecords(owner, shops, rechargeRecords), [owner, shops, rechargeRecords]);
  const baseRechRecords = useMemo(() => (canViewAll ? scopedRechRecords : scopedRechRecords.filter(r => r.applicant === currentUser)), [scopedRechRecords, canViewAll, currentUser]);

  // 充值记录搜索过滤
  const filteredRechRecords = useMemo(() => {
    const { shopName, platform, bankAccountNo, applicant, operator, financePerson, paidAtStart, paidAtEnd, amountRange } = rechAppliedSearch;
    return baseRechRecords.filter(r => {
      if (shopName && !String(r.shopName || '').toLowerCase().includes(shopName.toLowerCase())) return false;
      if (platform && !String(r.platform || '').toLowerCase().includes(platform.toLowerCase())) return false;
      if (bankAccountNo && !String(r.bankAccountNo || '').includes(bankAccountNo)) return false;
      if (applicant && !String(r.applicant || '').toLowerCase().includes(applicant.toLowerCase())) return false;
      if (operator && !String(r.operator || '').toLowerCase().includes(operator.toLowerCase())) return false;
      if (financePerson && !String(r.financePerson || '').toLowerCase().includes(financePerson.toLowerCase())) return false;
      if (paidAtStart || paidAtEnd) {
        const recDate = String(r.paidAt || '').substring(0, 10); // YYYY-MM-DD
        if (paidAtStart && recDate < paidAtStart) return false;
        if (paidAtEnd && recDate > paidAtEnd) return false;
      }
      // 金额区间解析：支持 100-5000, 100~5000, >1000, <500, >=1000, <=500, 1000 格式
      if (amountRange.trim()) {
        const amt = Number(r.amount) || 0;
        const rangeStr = amountRange.trim();
        // 匹配 >=, <=, >, < 格式
        const opMatch = rangeStr.match(/^([><]=?)\s*(\d+(?:\.\d+)?)$/);
        if (opMatch) {
          const op = opMatch[1];
          const val = Number(opMatch[2]);
          if (op === '>=' && amt < val) return false;
          if (op === '<=' && amt > val) return false;
          if (op === '>' && amt <= val) return false;
          if (op === '<' && amt >= val) return false;
        } else {
          // 匹配 100-5000 或 100~5000 格式
          const rangeMatch = rangeStr.match(/^(\d+(?:\.\d+)?)\s*[-~～]\s*(\d+(?:\.\d+)?)$/);
          if (rangeMatch) {
            const min = Number(rangeMatch[1]);
            const max = Number(rangeMatch[2]);
            if (amt < min || amt > max) return false;
          } else {
            // 匹配单个数字（精确匹配）
            const single = Number(rangeStr);
            if (!isNaN(single) && amt !== single) return false;
          }
        }
      }
      return true;
    });
  }, [baseRechRecords, rechAppliedSearch]);

  // 所属平台选项（从店铺数据中提取）
  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    shops.forEach(s => { if (s.platform) set.add(s.platform); });
    return Array.from(set).map(p => ({ label: p, value: p }));
  }, [shops]);
  // 银行账号选项（从银行账户数据中提取）
  const bankAccountOptions = useMemo(() => {
    return bankAccounts
      .filter((b: any) => b.bankAccountNo)
      .map((b: any) => ({
        label: `${b.name || ''} ${b.bankAccountNo}`,
        value: b.bankAccountNo,
      }));
  }, [bankAccounts]);
  const RECH_ALL_FIELDS = [
    { key: 'shopName', label: '店铺名称', width: 140 }, { key: 'shopCode', label: '店铺编码', width: 120 },
    { key: 'platform', label: '所属平台', width: 100 }, { key: 'amount', label: '充值金额', width: 110 },
    { key: 'qrcode', label: '充值二维码', width: 80 }, { key: 'accountName', label: '账户名称', width: 100 },
    { key: 'bankName', label: '开户银行', width: 180 }, { key: 'bankAccountNo', label: '银行账号', width: 180 },
    { key: 'applicant', label: '申请人', width: 80 }, { key: 'operator', label: '操作人', width: 80 },
    { key: 'financePerson', label: '财务负责人', width: 100 },
    { key: 'status', label: '状态', width: 90 },
    { key: 'paidAt', label: '充值日期', width: 140 },
  ];
  // 动态计算 scroll.x，确保表头与数据列对齐
  const rechScrollX = useMemo(() => {
    const visibleWidth = RECH_ALL_FIELDS
      .filter(f => rechFieldVis[f.key])
      .reduce((sum, f) => sum + (f.width || 100), 0);
    return visibleWidth + 200; // +200 为操作列
  }, [rechFieldVis]);
  const { wrapColumns: wrapRechCols } = useResizableColumns<RechargeRecord>(`colWidths_recharge_${owner}`);

  // 申请充值弹窗
  const [applyVisible, setApplyVisible] = useState(false);
  const [applyEditKey, setApplyEditKey] = useState<string | null>(null); // 编辑记录时的 key
  const [applyShop, setApplyShop] = useState<string>('');
  const [applyAmount, setApplyAmount] = useState<number>(0);
  const [applyQrcode, setApplyQrcode] = useState<string>('');
  const [applyFinancePerson, setApplyFinancePerson] = useState<string>('');
  const qrcodeFileRef = React.useRef<HTMLInputElement>(null);

  // 确认支付弹窗
  const [payVisible, setPayVisible] = useState(false);
  const [payRecord, setPayRecord] = useState<RechargeRecord | null>(null);
  const [payBankKey, setPayBankKey] = useState<string>('');

  // 驳回弹窗
  const [rejectVisible, setRejectVisible] = useState(false);
  const [rejectRecord, setRejectRecord] = useState<RechargeRecord | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejectReasons] = useState<string[]>(['金额不符', '信息有误', '暂不处理', '其他']);

  // ===================== 会计账薄联动状态 =====================
  const acctMode = isAccountingMode(owner);
  const [subjectOptions, setSubjectOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => { if (acctMode) setSubjectOptions(loadSubjectOptions(owner)); }, [acctMode, owner]);
  // #8 提现确认到账弹窗（会计模式）
  const [wdConfirmVisible, setWdConfirmVisible] = useState(false);
  const [wdConfirmRecord, setWdConfirmRecord] = useState<WithdrawalRecord | null>(null);
  const [wdDebit, setWdDebit] = useState<string>('银行存款');
  const [wdCredit, setWdCredit] = useState<string>('应收账款');
  // #9 充值确认支付借/贷（会计模式）
  const [rechDebit, setRechDebit] = useState<string>('销售费用');
  const [rechCredit, setRechCredit] = useState<string>('银行存款');

  // ===================== 数据加载 =====================
  const reload = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setRecords([]); }
    try { setShops(JSON.parse(localStorage.getItem(shopKey) || '[]')); } catch { setShops([]); }
    try { setBankAccounts(JSON.parse(localStorage.getItem(bankKey) || '[]')); } catch { setBankAccounts([]); }
    try { setRechargeRecords(JSON.parse(localStorage.getItem(rechargeKey) || '[]')); } catch { setRechargeRecords([]); }
    try { const m = JSON.parse(localStorage.getItem(managersKey) || '[]'); setWdManagers(Array.isArray(m) ? m : []); } catch { setWdManagers([]); }
  }, [storageKey, shopKey, bankKey, rechargeKey, managersKey]);
  useEffect(() => { reload(); }, [reload]);

  // 监听全局支付弹窗确认后的刷新事件
  useEffect(() => {
    const handleRechargeUpdated = () => { reload(); };
    window.addEventListener('recharge-record-updated', handleRechargeUpdated);
    return () => window.removeEventListener('recharge-record-updated', handleRechargeUpdated);
  }, [reload]);

  // 组件挂载时检查是否有待处理的充值通知跳转
  useEffect(() => {
    const pending = sessionStorage.getItem('navigate_recharge_tab');
    if (pending) {
      sessionStorage.removeItem('navigate_recharge_tab');
      setActiveTab('recharge');
    }
  }, []);

  // 页面加载时恢复通知 — 已移至 PurchaserLayout 全局处理，避免重复弹窗
  // （全局恢复确保任何页面加载/刷新时都能看到待处理通知）

  // ========== 提现任务通知轮询：每1分钟检查，已提现→终止，未提现→重新通知 ==========
  useEffect(() => {
    if (activeTaskNotifs.size === 0) return;
    const currentUser = localStorage.getItem('username') || '';
    const interval = setInterval(() => {
      const threeDaysAgo = dayjs().subtract(3, 'day').startOf('day');
      // 重新加载最新的提现记录
      let latestRecords: WithdrawalRecord[] = [];
      try { latestRecords = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { latestRecords = []; }
      const resolved: string[] = [];
      activeTaskNotifs.forEach((shopName, shopKey) => {
        const hasWithdrawn = latestRecords.some(r =>
          r.shopName === shopName && dayjs(r.createdAt).isAfter(threeDaysAgo)
        );
        if (hasWithdrawn) {
          // 已提现 → 终止，不再通知
          resolved.push(shopKey);
        } else {
          // 未提现 → 仅当前用户是负责人时才重新发送本地通知
          const shop = shops.find(s => s.key === shopKey);
          if (isNotificationTypeEnabled('withdraw-task') && shop?.person === currentUser) {
            const remindTitle = '提现任务提醒';
            const remindBody = `店铺「${shopName}」提现任务仍未完成，请及时处理`;
            const onClickHandler = () => {
              window.focus();
              sessionStorage.setItem('navigate_withdrawal_tab', '1');
              window.dispatchEvent(new CustomEvent('navigate-to-recharge'));
            };
            const nativeNotif = showNativeNotification(
              remindTitle, remindBody, onClickHandler,
              `withdraw-task-remind-${shopKey}-${Date.now()}`
            );
            if (!nativeNotif) {
              notification.warning({
                key: `withdraw-task-remind-${shopKey}-${Date.now()}`,
                message: remindTitle,
                description: remindBody,
                closeIcon: false,
                duration: 0,
                onClick: onClickHandler,
              });
            }
          }
        }
      });
      if (resolved.length > 0) {
        setActiveTaskNotifs(prev => {
          const next = new Map(prev);
          resolved.forEach(k => next.delete(k));
          return next;
        });
      }
    }, 60000); // 每1分钟检查一次
    return () => clearInterval(interval);
  }, [activeTaskNotifs, storageKey, shops]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      taskNotifTimersRef.current.forEach(t => clearTimeout(t));
    };
  }, []);

  const saveRecords = (list: WithdrawalRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(storageKey, json);
    safeSetItem(`${storageKey}_ts`, String(Date.now()));
    saveDataset(storageKey, json);
    setRecords(list);
  };

  const saveRechRecords = (list: RechargeRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(rechargeKey, json);
    safeSetItem(`${rechargeKey}_ts`, String(Date.now()));
    saveDataset(rechargeKey, json);
    setRechargeRecords(list);
  };

  // ========== 提现任务相关 ==========
  // 检查店铺最近3天是否有提现记录
  const getShopWithdrawStatus = useCallback((shopName: string): boolean => {
    const threeDaysAgo = dayjs().subtract(3, 'day').startOf('day');
    return records.some(r =>
      r.shopName === shopName && dayjs(r.createdAt).isAfter(threeDaysAgo)
    );
  }, [records]);

  // 发起提现任务
  const handleLaunchWithdrawTask = useCallback(() => {
    if (withdrawTaskSelected.length === 0) {
      message.warning('请至少选择一个店铺'); return;
    }
    const selectedShops = shops.filter(s => withdrawTaskSelected.includes(s.key));
    const newNotifs = new Map(activeTaskNotifs);
    const currentUser = localStorage.getItem('username') || '';
    // 为每个店铺发送通知
    selectedShops.forEach(shop => {
      newNotifs.set(shop.key, shop.shopName);
      // 检查弹窗设置开关
      if (isNotificationTypeEnabled('withdraw-task')) {
        const notifTitle = '提现任务通知';
        const notifBody = `店铺「${shop.shopName}」有新的提现任务，请及时处理`;
        const onClickHandler = () => {
          window.focus();
          sessionStorage.setItem('navigate_withdrawal_tab', '1');
          window.dispatchEvent(new CustomEvent('navigate-to-recharge'));
        };
        // 仅当当前用户是负责人时才显示本地通知（原生通知 + 页面内通知兆底）
        if (shop.person === currentUser) {
          const nativeNotif = showNativeNotification(
            notifTitle, notifBody, onClickHandler, `withdraw-task-${shop.key}`
          );
          if (!nativeNotif) {
            notification.warning({
              key: `withdraw-task-${shop.key}`,
              message: notifTitle,
              description: notifBody,
              closeIcon: false,
              duration: 0,
              onClick: onClickHandler,
            });
          }
        }
        // Web Push 推送（关闭浏览器也能收到，始终发送给负责人）
        const person = shop.person;
        if (person) {
          sendPushNotification(
            person, notifTitle, notifBody,
            { url: window.location.origin + '/purchaser/finance/shop-management' }
          );
        }
      }
    });
    setActiveTaskNotifs(newNotifs);
    // 保存任务状态
    try {
      const taskData: Record<string, string> = JSON.parse(localStorage.getItem(taskStatusKey) || '{}');
      selectedShops.forEach(shop => { taskData[shop.key] = dayjs().format('YYYY-MM-DD HH:mm'); });
      localStorage.setItem(taskStatusKey, JSON.stringify(taskData));
    } catch { /* ignore */ }
    message.success(`已向 ${selectedShops.length} 个店铺负责人发起提现任务`);
    setWithdrawTaskVisible(false);
    setWithdrawTaskSelected([]);
  }, [shops, withdrawTaskSelected, taskStatusKey, activeTaskNotifs]);

  // 清空提现任务状态
  const handleClearWithdrawTask = useCallback(() => {
    Modal.confirm({
      title: '确认清空提现状态？',
      content: '清空后所有店铺的提现状态将重置，可重新发起提现任务',
      okText: '确认清空', okType: 'danger', cancelText: '取消',
      onOk: () => {
        localStorage.removeItem(taskStatusKey);
        // 清除所有页面内通知、定时器和活跃通知状态
        activeTaskNotifs.forEach((_, shopKey) => {
          notification.destroy(`withdraw-task-${shopKey}`);
        });
        taskNotifTimersRef.current.forEach(t => clearTimeout(t));
        taskNotifTimersRef.current.clear();
        setActiveTaskNotifs(new Map());
        message.success('提现任务状态已清空');
      },
    });
  }, [taskStatusKey, activeTaskNotifs]);

  // 账号列表
  const [accounts, setAccounts] = useState<any[]>([]);
  const loadAccounts = useCallback(() => {
    try {
      const data = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
      setAccounts(data.filter((a: any) => a.status !== 'disabled'));
    } catch { setAccounts([]); }
  }, [owner]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ===================== 充值记录 CRUD =====================
  const handleApplyRecharge = () => {
    if (!applyShop) { message.warning('请选择店铺'); return; }
    if (!applyAmount || applyAmount <= 0) { message.warning('请输入充值金额'); return; }
    if (!applyFinancePerson) { message.warning('请选择财务负责人'); return; }
    const shop = shops.find(s => s.key === applyShop);
    const currentUser = localStorage.getItem('username') || '';

    if (applyEditKey) {
      // 编辑模式：查找原始记录判断状态
      const existingRec = rechargeRecords.find(r => r.key === applyEditKey);
      const isRejected = existingRec?.status === 'rejected';
      const updated = rechargeRecords.map(r => r.key === applyEditKey ? {
        ...r,
        shopId: applyShop, shopName: shop?.shopName || '', shopCode: shop?.accountId || '',
        platform: shop?.platform || '', amount: applyAmount, qrcode: applyQrcode,
        financePerson: applyFinancePerson,
        // 被驳回的记录重置为待审核，待审核记录保持原状态
        ...(isRejected ? { accountName: '', bankName: '', bankAccountNo: '', status: 'pending' as RechargeStatus, rejectReason: '' } : {}),
        operator: currentUser, updatedAt: new Date().toLocaleString('zh-CN'),
      } : r);
      saveRechRecords(updated);
      if (isRejected) {
        notification.destroy(`rech-rejected-${applyEditKey}`);
        // 清除已显示的驳回通知标记，以便再次驳回时可重新通知
        try {
          const rejKey = `rech_rejected_shown_${owner}`;
          const shown: string[] = JSON.parse(localStorage.getItem(rejKey) || '[]');
          localStorage.setItem(rejKey, JSON.stringify(shown.filter(k => k !== applyEditKey)));
        } catch {}
      }
      // 通知财务负责人（系统级通知 + Web Push，已屏蔽则跳过）
      if (applyFinancePerson && !isNotificationBlocked(applyFinancePerson)) {
        showNativeNotification(
          '【充值审批】' + (shop?.shopName || ''),
          `${shop?.shopName} ${isRejected ? '重新申请' : '更新'}充值 ¥${applyAmount.toFixed(2)}，请点击处理`,
          () => window.dispatchEvent(new CustomEvent('show-recharge-pay', { detail: { recordKey: applyEditKey } })),
          `rech-pending-${applyEditKey}`
        );
        sendPushNotification(
          applyFinancePerson,
          '【充值审批】' + (shop?.shopName || ''),
          `${isRejected ? '重新申请' : '更新'}充值 ¥${applyAmount.toFixed(2)}，请点击处理`,
          { recordKey: applyEditKey, url: window.location.origin + '/purchaser/finance/shop-management' }
        );
      }
      message.success(isRejected ? '已重新提交充值申请' : '充值记录已更新');
    } else {
      // 新增模式
      const rec: RechargeRecord = {
        key: `rech-${Date.now()}`,
        shopId: applyShop, shopName: shop?.shopName || '', shopCode: shop?.accountId || '',
        platform: shop?.platform || '', amount: applyAmount, qrcode: applyQrcode,
        accountName: '', bankName: '', bankAccountNo: '',
        applicant: currentUser, operator: currentUser,
        financePerson: applyFinancePerson, status: 'pending',
        createdAt: new Date().toLocaleString('zh-CN'), updatedAt: '',
      };
      saveRechRecords([rec, ...rechargeRecords]);
      // 通知财务负责人（系统级通知 + Web Push，已屏蔽则跳过）
      if (applyFinancePerson && !isNotificationBlocked(applyFinancePerson)) {
        showNativeNotification(
          '【充值审批】' + (shop?.shopName || ''),
          `${shop?.shopName} 申请充值 ¥${applyAmount.toFixed(2)}，请点击处理`,
          () => window.dispatchEvent(new CustomEvent('show-recharge-pay', { detail: { recordKey: rec.key } })),
          `rech-pending-${rec.key}`
        );
        sendPushNotification(
          applyFinancePerson,
          '【充值审批】' + (shop?.shopName || ''),
          `申请充值 ¥${applyAmount.toFixed(2)}，请点击处理`,
          { recordKey: rec.key, url: window.location.origin + '/purchaser/finance/shop-management' }
        );
      }
      message.success('充值申请已提交');
    }
    setApplyVisible(false); setApplyEditKey(null);
    setApplyShop(''); setApplyAmount(0); setApplyQrcode(''); setApplyFinancePerson('');
  };

  const handleConfirmPay = () => {
    if (!payRecord) return;
    if (!payBankKey) { message.warning('请选择付款银行账户'); return; }
    const bank = bankAccounts.find(b => b.key === payBankKey);

    // 写入银行账户支出明细
    try {
      const bankStorageKey = `pageData_finance_bank-account_${owner}`;
      const accounts: any[] = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
      const acc = accounts.find((a: any) => a.key === payBankKey);
      if (!acc) { message.error('银行账户数据中未找到该账户'); return; }

      const txns = Array.isArray(acc.transactions) ? acc.transactions : [];
      const prevBalance = Number(acc.balance) || 0;
      txns.push({
        key: `txn-rech-${Date.now()}`,
        time: new Date().toLocaleString('zh-CN'),
        type: 'out',
        amount: payRecord.amount,
        balanceAfter: prevBalance - payRecord.amount,
        counterparty: payRecord.shopName,
        orderNo: '',
        orderId: '',
        person: localStorage.getItem('username') || 'admin',
        remark: `充值支出 — ${payRecord.shopName} ${fmt(payRecord.amount)}`,
      });
      acc.transactions = txns;
      acc.balance = prevBalance - payRecord.amount;
      const json = JSON.stringify(accounts);
      safeSetItem(bankStorageKey, json);
      saveDataset(bankStorageKey, json);
      safeSetItem(`${bankStorageKey}_ts`, String(Date.now()));
    } catch (err) {
      message.error('写入银行流水失败：' + (err as Error).message);
      return;
    }

    const updated = rechargeRecords.map(r => r.key === payRecord.key ? {
      ...r, status: 'paid' as RechargeStatus, operator: localStorage.getItem('username') || '',
      accountName: bank?.name || '', bankName: `${bank?.bankName}${bank?.branchName ? '(' + bank.branchName + ')' : ''}`,
      bankAccountNo: bank?.bankAccountNo || '', paidAt: dayjs().format('YYYY-MM-DD HH:mm:ss'), updatedAt: new Date().toLocaleString('zh-CN'),
    } : r);
    saveRechRecords(updated);
    writeRechargeBookkeeping(payRecord, bank);
    // 会计账薄：写入两条自动分录（借：销售费用，贷：银行存款），摘要=店铺名称+推广广告费
    if (acctMode) {
      writeAutoEntries(owner, {
        sourceKey: `recharge-${payRecord.key}`,
        debitSubject: rechDebit || '销售费用',
        creditSubject: rechCredit || '银行存款',
        amount: Math.abs(Number(payRecord.amount)) || 0,
        summary: `${payRecord.shopName || ''}+推广广告费`,
      });
    }
    setPayVisible(false); setPayRecord(null);
    notification.destroy(`rech-notify-${payRecord.key}`);
    // 通知申请人“已支付”（5秒自动关闭，已屏蔽则跳过）
    if (payRecord.applicant && !isNotificationBlocked(payRecord.applicant)) {
      showTimedNotification(
        '【充值已支付】' + (payRecord.shopName || ''),
        `${payRecord.shopName} 充值 ${fmt(payRecord.amount)} 已由财务确认支付`,
        5000,
        `rech-paid-${payRecord.key}`
      );
    }
    message.success(`已确认支付 ${fmt(payRecord.amount)}，银行支出明细已记录，日常记账已生成`);
  };

  // 撤回充值
  const handleRevokeRech = useCallback((record: RechargeRecord) => {
    Modal.confirm({
      title: '确认撤回此充值记录？',
      content: '撤回后将还原充值状态为“待审核”，同时撤回对应的银行支出明细并清空充值日期。',
      okText: '确认撤回', okType: 'danger', cancelText: '取消',
      onOk: () => {
        // 1. 撤回银行流水：根据充值金额和店铺名称匹配
        try {
          const accounts: any[] = JSON.parse(localStorage.getItem(bankKey) || '[]');
          // 根据记录的bankName找到对应银行账户
          const acc = accounts.find((a: any) => {
            const fullBankName = `${a.bankName}${a.branchName ? '(' + a.branchName + ')' : ''}`;
            return fullBankName === record.bankName && a.bankAccountNo === record.bankAccountNo;
          });
          if (acc && Array.isArray(acc.transactions)) {
            // 查找对应的支出交易（按金额+店铺+备注匹配）
            const txIdx = acc.transactions.findIndex((tx: any) =>
              tx.type === 'out' &&
              Number(tx.amount) === Number(record.amount) &&
              (tx.counterparty === record.shopName || (tx.remark && tx.remark.includes(record.shopName))) &&
              tx.key && tx.key.startsWith('txn-rech-')
            );
            if (txIdx >= 0) {
              const prevBalance = Number(acc.balance) || 0;
              acc.transactions.splice(txIdx, 1);
              acc.balance = prevBalance + Number(record.amount);
              const json = JSON.stringify(accounts);
              safeSetItem(bankKey, json);
              saveDataset(bankKey, json);
              safeSetItem(`${bankKey}_ts`, String(Date.now()));
            }
          }
        } catch (err) {
          console.error('撤回银行流水失败', err);
        }
        // 2. 还原充值记录状态
        const updated = rechargeRecords.map(r => r.key === record.key ? {
          ...r, status: 'pending' as RechargeStatus,
          operator: '', accountName: '', bankName: '', bankAccountNo: '', paidAt: '',
          updatedAt: new Date().toLocaleString('zh-CN'),
        } : r);
        saveRechRecords(updated);
        voidRechargeBookkeeping(record);
        // 会计账薄：删除对应自动分录
        if (acctMode) { removeAutoEntries(owner, `recharge-${record.key}`); }
        message.success('已撤回充值记录，银行支出明细已还原，对应日常记账已作废');
      },
    });
  }, [bankKey, rechargeRecords, saveRechRecords]);

  const handleReject = () => {
    if (!rejectRecord) return;
    if (!rejectReason.trim()) { message.warning('请输入或选择驳回原因'); return; }
    const updated = rechargeRecords.map(r => r.key === rejectRecord.key ? {
      ...r, status: 'rejected' as RechargeStatus, rejectReason: rejectReason.trim(),
      operator: localStorage.getItem('username') || '', updatedAt: new Date().toLocaleString('zh-CN'),
    } : r);
    saveRechRecords(updated);
    setRejectVisible(false); setRejectRecord(null); setRejectReason('');
    notification.destroy(`rech-notify-${rejectRecord.key}`);
    // 通知申请人（系统级通知，已屏蔽则跳过）
    if (rejectRecord.applicant && !isNotificationBlocked(rejectRecord.applicant)) {
      showNativeNotification(
        '【充值被驳回】' + (rejectRecord.shopName || ''),
        `${rejectRecord.shopName} 的充值申请已被驳回，原因：${rejectReason.trim()}`,
        () => { sessionStorage.setItem('navigate_recharge_tab', '1'); window.dispatchEvent(new CustomEvent('navigate-to-recharge')); },
        `rech-rejected-${rejectRecord.key}`
      );
    }
    message.success('已驳回');
  };

  // 取消被驳回的充值申请
  const handleCancelRech = (rec: RechargeRecord) => {
    const updated = rechargeRecords.map(r => r.key === rec.key ? {
      ...r, status: 'cancelled' as RechargeStatus,
      operator: localStorage.getItem('username') || '', updatedAt: new Date().toLocaleString('zh-CN'),
    } : r);
    saveRechRecords(updated);
    notification.destroy(`rech-rejected-${rec.key}`);
    message.success('已取消该充值申请');
  };

  // 编辑充值记录（复用申请弹窗，支持待审核和被驳回记录）
  const handleRechEdit = (rec: RechargeRecord) => {
    setApplyEditKey(rec.key);
    setApplyShop(rec.shopId);
    setApplyAmount(rec.amount);
    setApplyQrcode(rec.qrcode);
    setApplyFinancePerson(rec.financePerson);
    setApplyVisible(true);
  };

  const saveRechFieldConfig = (order: string[] = rechFieldOrder, vis: Record<string, boolean> = rechFieldVis) => {
    localStorage.setItem(`rechFieldOrder_${owner}`, JSON.stringify(order));
    localStorage.setItem(`rechFieldVis_${owner}`, JSON.stringify(vis));
  };

  // 二维码上传
  const handleQrcodePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => setApplyQrcode(ev.target?.result as string);
        reader.readAsDataURL(file);
        e.preventDefault(); break;
      }
    }
  };
  const handleQrcodeUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => setApplyQrcode(ev.target?.result as string);
    reader.readAsDataURL(file);
    return false;
  };

  // ===================== 新增/删除 =====================
  const openCreate = () => {
    if (shops.length === 0) { message.warning('请先在“店铺列表”中添加店铺'); return; }
    setFormShop(shops[0].key);
    setFormAmount(0);
    setFormBankKey('');
    setFormAccountName('');
    setFormBankName('');
    setFormBankAccountNo('');
    setFormBankPerson('');
    setFormScreenshot('');
    setFormWithdrawalDate(dayjs().format('YYYY-MM-DD'));
    setIsEditing(false);
    setEditingKey('');
    setEditVisible(true);
  };
  
  const openEdit = (record: WithdrawalRecord) => {
    if (record.confirmed) { message.warning('已生效的记录不能编辑'); return; }
    setFormShop(record.shopId);
    setFormAmount(record.amount);
    setFormBankKey(record.bankAccountKey);
    setFormAccountName(record.accountName);
    setFormBankName(record.bankName);
    setFormBankAccountNo(record.bankAccountNo);
    setFormBankPerson(record.bankPerson || bankAccounts.find(b => b.key === record.bankAccountKey)?.person || '');
    setFormScreenshot(record.screenshot);
    setFormWithdrawalDate(record.withdrawalDate || dayjs(record.createdAt).format('YYYY-MM-DD'));
    setIsEditing(true);
    setEditingKey(record.key);
    setEditVisible(true);
  };

  const handleSave = () => {
    if (!formShop) { message.warning('请选择店铺'); return; }
    if (!formAmount || formAmount <= 0) { message.warning('请输入提现金额'); return; }
    if (!formAccountName) { message.warning('请选择银行账户'); return; }

    const shop = shops.find(s => s.key === formShop);
    if (isEditing) {
      // 编辑模式
      const updated = records.map(r => r.key === editingKey ? {
        ...r,
        shopId: formShop,
        shopName: shop?.shopName || r.shopName,
        amount: formAmount,
        accountName: formAccountName,
        bankName: formBankName,
        bankAccountNo: formBankAccountNo,
        bankAccountKey: formBankKey,
        bankPerson: formBankPerson,
        screenshot: formScreenshot,
        withdrawalDate: formWithdrawalDate,
      } : r);
      saveRecords(updated);
      setEditVisible(false);
      message.success('提现记录已更新');
    } else {
      // 新增模式
      const now = new Date().toLocaleString('zh-CN');
      const record: WithdrawalRecord = {
        key: `wd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        shopId: formShop,
        shopName: shop?.shopName || '',
        amount: formAmount,
        accountName: formAccountName,
        bankName: formBankName,
        bankAccountNo: formBankAccountNo,
        bankAccountKey: formBankKey,
        bankPerson: formBankPerson,
        screenshot: formScreenshot,
        inputBy: localStorage.getItem('username') || '',
        createdAt: now,
        withdrawalDate: formWithdrawalDate || dayjs().format('YYYY-MM-DD'),
        confirmed: false,
        confirmedAt: '',
      };
      saveRecords([record, ...records]);
      setEditVisible(false);
      message.success('提现记录已添加');
    }
  };

  const handleDelete = (key: string) => {
    saveRecords(records.filter(r => r.key !== key));
    message.success('记录已删除');
  };

  // ===================== 日常记账联动（确认到账→收入记账；撤回→作废） =====================
  const genBookVoucherNo = (books: any[], date: string): string => {
    const prefix = `PZ-${date.replace(/-/g, '')}`;
    const seqs = books.map(b => String(b.voucherNo || '')).filter(v => v.startsWith(prefix)).map(v => parseInt(v.slice(-3), 10) || 0);
    return `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`;
  };
  const writeWithdrawalBookkeeping = (record: WithdrawalRecord) => {
    try {
      const bkKey = `daily_bookkeeping_${owner}`;
      const books: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const bookKey = `bk-wd-${record.key}`;
      const today = new Date().toISOString().slice(0, 10);
      const bankAcc = bankAccounts.find(b => b.key === record.bankAccountKey) || bankAccounts.find(b => b.name === record.accountName);
      const existing = books.find(b => b.key === bookKey);
      if (existing) {
        // 撤回后再次确认：以最新提现内容覆盖原记账记录并恢复作废状态
        const merged = {
          ...existing,
          bookDate: today,
          amount: Math.abs(Number(record.amount)) || 0,
          counterparty: record.shopName || '',
          remark: `提现-${record.shopName || ''}（确认到账）`,
          recvAccount: record.accountName || '',
          recvBank: bankAcc?.bankName || '',
          image: record.screenshot || '',
          person: getDisplayName(localStorage.getItem('username') || ''),
          isVoided: false,
        };
        safeSetItem(bkKey, JSON.stringify(books.map(b => b.key === bookKey ? merged : b)));
        return;
      }
      const voucherNo = genBookVoucherNo(books, today);
      const rec: any = {
        key: bookKey,
        voucherNo,
        bookDate: today,
        bookType: '收入',
        category: '主营业务收入-销售收入',
        amount: Math.abs(Number(record.amount)) || 0,
        counterparty: record.shopName || '',
        remark: `提现-${record.shopName || ''}（确认到账）`,
        person: getDisplayName(localStorage.getItem('username') || ''),
        payAccount: '',
        recvAccount: record.accountName || '',
        recvBank: bankAcc?.bankName || '',
        payBank: '',
        image: record.screenshot || '',
        isPersonalAdvance: false,
        isReturn: false,
        advanceRecvAccount: '',
        linkedReimbursementKey: '',
        linkedWithdrawalKey: record.key,
        createdAt: new Date().toISOString(),
      };
      safeSetItem(bkKey, JSON.stringify([rec, ...books]));
    } catch (err) { console.error('提现记账写入失败', err); }
  };
  const voidWithdrawalBookkeeping = (record: WithdrawalRecord) => {
    try {
      const bkKey = `daily_bookkeeping_${owner}`;
      const books: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const bookKey = `bk-wd-${record.key}`;
      if (!books.some(b => b.key === bookKey && !b.isVoided)) return;
      safeSetItem(bkKey, JSON.stringify(books.map(b => b.key === bookKey ? { ...b, isVoided: true } : b)));
    } catch (err) { console.error('提现记账作废失败', err); }
  };

  // 充值确认支付→日常记账支出（销售费用-广告推广费）；撤回充值→作废
  const writeRechargeBookkeeping = (record: RechargeRecord, bank: any) => {
    try {
      const bkKey = `daily_bookkeeping_${owner}`;
      const books: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const bookKey = `bk-rech-${record.key}`;
      const today = new Date().toISOString().slice(0, 10);
      const existing = books.find(b => b.key === bookKey);
      if (existing) {
        // 撤回后再次确认支付：以最新充值内容覆盖原记账记录并恢复作废状态
        const merged = {
          ...existing,
          bookDate: today,
          amount: Math.abs(Number(record.amount)) || 0,
          counterparty: record.shopName || '',
          remark: `充值-${record.shopName || ''}（确认支付）`,
          payAccount: bank?.name || record.accountName || '',
          payBank: bank ? `${bank.bankName || ''}${bank.branchName ? '(' + bank.branchName + ')' : ''}` : (record.bankName || ''),
          person: getDisplayName(localStorage.getItem('username') || ''),
          isVoided: false,
        };
        safeSetItem(bkKey, JSON.stringify(books.map(b => b.key === bookKey ? merged : b)));
        return;
      }
      const rec: any = {
        key: bookKey,
        voucherNo: genBookVoucherNo(books, today),
        bookDate: today,
        bookType: '支出',
        category: '销售费用-广告推广费',
        amount: Math.abs(Number(record.amount)) || 0,
        counterparty: record.shopName || '',
        remark: `充值-${record.shopName || ''}（确认支付）`,
        person: getDisplayName(localStorage.getItem('username') || ''),
        payAccount: bank?.name || record.accountName || '',
        recvAccount: '',
        recvBank: '',
        payBank: bank ? `${bank.bankName || ''}${bank.branchName ? '(' + bank.branchName + ')' : ''}` : (record.bankName || ''),
        image: '',
        isPersonalAdvance: false,
        isReturn: false,
        advanceRecvAccount: '',
        linkedReimbursementKey: '',
        linkedRechargeKey: record.key,
        createdAt: new Date().toISOString(),
      };
      safeSetItem(bkKey, JSON.stringify([rec, ...books]));
    } catch (err) { console.error('充值记账写入失败', err); }
  };
  const voidRechargeBookkeeping = (record: RechargeRecord) => {
    try {
      const bkKey = `daily_bookkeeping_${owner}`;
      const books: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const bookKey = `bk-rech-${record.key}`;
      if (!books.some(b => b.key === bookKey && !b.isVoided)) return;
      safeSetItem(bkKey, JSON.stringify(books.map(b => b.key === bookKey ? { ...b, isVoided: true } : b)));
    } catch (err) { console.error('充值记账作废失败', err); }
  };

  // ===================== 确认到账 =====================
  const handleConfirmReceipt = (record: WithdrawalRecord) => {
    if (record.confirmed) { message.warning('该记录已确认到账'); return; }
    // 查找对应的银行账户
    const bankAcc = bankAccounts.find(b => b.key === record.bankAccountKey)
      || bankAccounts.find(b => b.name === record.accountName);
    if (!bankAcc) { message.error('未找到对应银行账户，请确认银行账户是否存在'); return; }

    // 写入银行流水
    try {
      const bankStorageKey = `pageData_finance_bank-account_${owner}`;
      const accounts: any[] = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
      const acc = accounts.find((a: any) => a.key === bankAcc.key);
      if (!acc) { message.error('银行账户数据中未找到该账户'); return; }

      const txns = Array.isArray(acc.transactions) ? acc.transactions : [];
      const prevBalance = Number(acc.balance) || 0;
      txns.push({
        key: `txn-wd-${Date.now()}`,
        time: new Date().toLocaleString('zh-CN'),
        type: 'in',
        amount: record.amount,
        balanceAfter: prevBalance + record.amount,
        counterparty: record.shopName,
        orderNo: '',
        orderId: '',
        person: localStorage.getItem('username') || 'admin',
        remark: `提现到账 — ${record.shopName} ${fmt(record.amount)}`,
      });
      acc.transactions = txns;
      acc.balance = prevBalance + record.amount;
      const json = JSON.stringify(accounts);
      safeSetItem(bankStorageKey, json);
      saveDataset(bankStorageKey, json);
      safeSetItem(`${bankStorageKey}_ts`, String(Date.now()));

      // 标记提现记录为已确认
      const updated = records.map(r =>
        r.key === record.key ? { ...r, confirmed: true, confirmedAt: new Date().toLocaleString('zh-CN') } : r
      );
      saveRecords(updated);
      writeWithdrawalBookkeeping(record);
      // 会计账薄：写入两条自动分录（借：银行存款，贷：应收账款）
      if (acctMode) {
        writeAutoEntries(owner, {
          sourceKey: `withdraw-${record.key}`,
          debitSubject: wdDebit || '银行存款',
          creditSubject: wdCredit || '应收账款',
          amount: Math.abs(Number(record.amount)) || 0,
          summary: `提现到账 — 店铺「${record.shopName || '-'}」${fmt(record.amount)}（收款账户：${record.accountName || '-'}）`,
        });
      }
      message.success(`已确认到账 ${fmt(record.amount)}，银行流水已记录，日常记账已生成`);
    } catch (err) {
      message.error('确认到账失败：' + (err as Error).message);
    }
  };

  // ===================== 撤回 =====================
  const handleRevoke = (record: WithdrawalRecord) => {
    if (!record.confirmed) { message.warning('该记录未确认，无需撤回'); return; }
    // 撤销银行流水
    try {
      const bankStorageKey = `pageData_finance_bank-account_${owner}`;
      const accounts: any[] = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
      const bankAcc = bankAccounts.find(b => b.key === record.bankAccountKey)
        || bankAccounts.find(b => b.name === record.accountName);
      if (bankAcc) {
        const acc = accounts.find((a: any) => a.key === bankAcc.key);
        if (acc) {
          // 删除对应的流水记录
          const txns = Array.isArray(acc.transactions) ? acc.transactions : [];
          acc.transactions = txns.filter((t: any) => !(t.key && t.key.startsWith('txn-wd-') && t.amount === record.amount && t.counterparty === record.shopName));
          // 回滚余额
          acc.balance = (Number(acc.balance) || 0) - record.amount;
          const json = JSON.stringify(accounts);
          safeSetItem(bankStorageKey, json);
          saveDataset(bankStorageKey, json);
          safeSetItem(`${bankStorageKey}_ts`, String(Date.now()));
        }
      }
      // 标记为未确认
      const updated = records.map(r =>
        r.key === record.key ? { ...r, confirmed: false, confirmedAt: '' } : r
      );
      saveRecords(updated);
      voidWithdrawalBookkeeping(record);
      // 会计账薄：删除对应自动分录
      if (acctMode) { removeAutoEntries(owner, `withdraw-${record.key}`); }
      message.success('已撤回，记录恢复为待确认状态，对应日常记账已作废');
    } catch (err) {
      message.error('撤回失败：' + (err as Error).message);
    }
  };

  // ===================== 截图上传 =====================
  const handleScreenshotPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          // 压缩图片
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxW = 800;
            const scale = Math.min(1, maxW / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            setFormScreenshot(canvas.toDataURL('image/jpeg', 0.7));
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
      }
    }
  }, []);

  const handleScreenshotUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 800;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setFormScreenshot(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    return false; // prevent default upload
  };

  // ===================== 过滤 =====================
  const filteredRecords = useMemo(() => {
    if (!searchText.trim()) return baseRecords;
    const q = searchText.toLowerCase();
    return baseRecords.filter(r =>
      r.shopName.toLowerCase().includes(q) ||
      r.accountName.toLowerCase().includes(q) ||
      r.bankName.toLowerCase().includes(q) ||
      r.bankAccountNo.toLowerCase().includes(q) ||
      r.inputBy.toLowerCase().includes(q)
    );
  }, [baseRecords, searchText]);

  // 汇总
  const totalAmount = useMemo(() => filteredRecords.reduce((s, r) => s + (r.amount || 0), 0), [filteredRecords]);

  // ========== 负责人设置（仅管理员可配置）==========
  const allUserOptions = useMemo(() => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
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
        .map((u: any) => ({ value: u.username, label: `${u.displayName || u.contactPerson || u.name || u.username} (${u.username})` }));
    } catch { return []; }
  }, [owner]);
  const managerDisplayNames = (): string => {
    if (wdManagers.length === 0) return '未设置（所有人可看全部）';
    return wdManagers.map(un => getDisplayName(un)).join('、');
  };
  const handleSaveManagers = () => {
    setWdManagers(managerSelectedUsers);
    safeSetItem(managersKey, JSON.stringify(managerSelectedUsers));
    setManagerModalVisible(false);
    message.success('负责人已保存');
  };

  // 列宽拖拽调整
  const { wrapColumns } = useResizableColumns<WithdrawalRecord>(`colWidths_withdrawal_${owner}`);

  // ===================== 银行账户选择 =====================
  const bankOptions = useMemo(() => {
    return bankAccounts.map(b => {
      const last4 = b.bankAccountNo ? '****' + String(b.bankAccountNo).slice(-4) : '';
      const branch = b.branchName ? `（${b.branchName}）` : '';
      return {
        value: b.key,
        label: `${b.name} - ${b.bankName}${branch} ${last4}`,
      };
    });
  }, [bankAccounts]);

  const handleBankSelect = useCallback((bankKey: string) => {
    setFormBankKey(bankKey);
    const bank = bankAccounts.find(b => b.key === bankKey);
    if (bank) {
      setFormAccountName(bank.name || '');
      setFormBankName(`${bank.bankName}${bank.branchName ? '（' + bank.branchName + '）' : ''}`);
      setFormBankAccountNo(bank.bankAccountNo || '');
      // 银行卡负责人：引用银行账户列表中的负责人字段
      setFormBankPerson(bank.person || '');
    }
  }, [bankAccounts]);

  // ===================== 表格列 =====================
  const columns: ColumnsType<WithdrawalRecord> = [
    { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 160, fixed: 'left', align: 'left' as const,
      render: (v: string) => <Text strong><ShopOutlined style={{ marginRight: 6, color: PRIMARY }} />{v}</Text> },
    { title: '提现金额', dataIndex: 'amount', key: 'amount', width: 130,
      render: (v: number) => <Text style={{ color: '#1e4a7e', fontWeight: 600 }}>{fmt(v)}</Text> },
    { title: '账户名称', dataIndex: 'accountName', key: 'accountName', width: 140, align: 'left' as const,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: '开户银行', dataIndex: 'bankName', key: 'bankName', width: 220, align: 'left' as const,
      render: (v: string, r: WithdrawalRecord) => {
        if (!v) return <Text type="secondary">—</Text>;
        const color = getBankColor(v);
        const short = getBankShortName(v);
        const matchedBank = bankAccounts.find(b => r.bankAccountNo && b.bankAccountNo === r.bankAccountNo);
        const accType = matchedBank?.accountType || '';
        const accTypeColor = accType === '基本账户' ? '#722ed1' : accType === '一般账户' ? '#52c41a' : accType === '个人账户' ? '#faad14' : accType === '支付宝' ? '#1677ff' : accType === '微信' ? '#07c160' : '';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: color,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>{short}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
              {accType && <Tag style={{ background: accTypeColor, color: '#fff', border: 'none', fontSize: 11, lineHeight: '18px', padding: '0 6px', marginTop: 2 }}>{accType}</Tag>}
            </div>
          </div>
        );
      }
    },
    { title: '银行账号', dataIndex: 'bankAccountNo', key: 'bankAccountNo', width: 180, align: 'left' as const,
      render: (v: string) => {
        if (!v) return <Text type="secondary">—</Text>;
        const s = String(v);
        const masked = s.length > 8 ? s.slice(0, 4) + '****'.repeat(Math.ceil((s.length - 8) / 4)).slice(0, s.length - 8) + s.slice(-4) : s;
        return <Text code style={{ fontSize: 13 }}>{masked}</Text>;
      } },
    { title: '银行卡负责人', dataIndex: 'bankPerson', key: 'bankPerson', width: 110, align: 'center' as const,
      render: (v: string, r: WithdrawalRecord) => {
        const person = v || bankAccounts.find(b => b.key === r.bankAccountKey)?.person || '';
        return person ? <Text>{person}</Text> : <Text type="secondary">—</Text>;
      } },
    { title: '提现截图', dataIndex: 'screenshot', key: 'screenshot', width: 100,
      render: (v: string) => v ? (
        <Image src={v} width={60} height={40} style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }}
          preview={{ mask: <span style={{ fontSize: 12 }}>查看</span> }} />
      ) : <Text type="secondary">—</Text> },
    { title: '操作人', dataIndex: 'inputBy', key: 'inputBy', width: 100,
      render: (v: string) => getDisplayName(v) },
    { title: '提现日期', dataIndex: 'withdrawalDate', key: 'withdrawalDate', width: 110, align: 'center' as const,
      render: (v: string, r: WithdrawalRecord) => v || dayjs(r.createdAt).format('YYYY-MM-DD') },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
    { title: '状态', key: 'status', width: 90, align: 'center',
      render: (_: any, r: WithdrawalRecord) => r.confirmed
        ? <Tag style={{ background: '#52c41a', color: '#fff', border: 'none' }}>已生效</Tag>
        : <Tag color="warning">待确认</Tag> },
    { title: '操作', key: 'action', width: 200, fixed: 'right' as const,
      render: (_: any, r: WithdrawalRecord) => {
        const editable = canEditShopData(owner, shops.find(s => s.shopName === r.shopName)?.person, r.inputBy);
        return (
        <Space size="small" wrap>
          {r.confirmed ? (
            <Popconfirm title="确认撤回此笔提现记录？" description="撤回后将恢复为待确认状态，并撤销银行流水"
              onConfirm={() => handleRevoke(r)} okText="确认撤回" cancelText="取消" disabled={!editable}>
              <Button type="link" size="small" icon={<UndoOutlined />} style={{ color: '#fa8c16' }} disabled={!editable}>撤回</Button>
            </Popconfirm>
          ) : (<>
            <Button type="link" size="small" icon={<EditOutlined />} disabled={!editable} onClick={() => openEdit(r)}>编辑</Button>
            {acctMode ? (
              <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }} disabled={!editable}
                onClick={() => { setWdConfirmRecord(r); setWdDebit('银行存款'); setWdCredit('应收账款'); setWdConfirmVisible(true); }}>确认到账</Button>
            ) : (
              <Popconfirm title="确认此笔提现已到账？" description="确认后将写入银行流水明细并更新账户余额"
                onConfirm={() => handleConfirmReceipt(r)} okText="确认到账" cancelText="取消" disabled={!editable}>
                <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }} disabled={!editable}>确认到账</Button>
              </Popconfirm>
            )}
            <Popconfirm title="确认删除此提现记录？" onConfirm={() => handleDelete(r.key)} okText="确认" cancelText="取消" disabled={!editable}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!editable}>删除</Button>
            </Popconfirm>
          </>)}
        </Space>
        );
      } },
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* 顶部子标签页 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <Space>
          <Button type={activeTab === 'withdrawal' ? 'primary' : 'default'} icon={<DollarOutlined />}
            style={activeTab === 'withdrawal' ? { color: '#fff' } : {}}
            onClick={() => setActiveTab('withdrawal')}>提现记录</Button>
          <Button type={activeTab === 'recharge' ? 'primary' : 'default'} icon={<WalletOutlined />}
            style={activeTab === 'recharge' ? { color: '#fff' } : {}}
            onClick={() => setActiveTab('recharge')}>充值记录</Button>
        </Space>
      </Card>

      {/* ============ 提现记录 ============ */}
      {activeTab === 'withdrawal' && (<>
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '10px 24px' }}>
        <Row justify="end" align="middle">
          <Col>
            <Space>
              {totalAmount > 0 && <Tag color="green">合计 {fmt(totalAmount)}</Tag>}
              <Input.Search
                placeholder="搜索店铺/银行/操作人"
                allowClear
                style={{ width: 200 }}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onSearch={v => setSearchText(v)}
              />
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button icon={<ClearOutlined />} onClick={handleClearWithdrawTask}>清空</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增记录</Button>
              <Button icon={<SendOutlined />} onClick={() => {
                setWithdrawTaskVisible(true);
                setWithdrawTaskSelected([]);
              }}>发起提现任务</Button>
              {isAdmin && <Tooltip title={`负责人：${managerDisplayNames()}`}>
                <Button icon={<TeamOutlined />} onClick={() => { setManagerSelectedUsers([...wdManagers]); setManagerModalVisible(true); }}>负责人设置</Button>
              </Tooltip>}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 表格 */}
      <Card bodyStyle={{ padding: 0 }} style={{ borderRadius: 8 }}>
        <Table<WithdrawalRecord>
          columns={wrapColumns(columns)}
          dataSource={filteredRecords}
          rowKey="key"
          bordered
          scroll={{ x: 1000, y: 'calc(100vh - 340px)' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
          size="middle"
          locale={{ emptyText: '暂无提现记录，请点击"新增记录"' }}
        />
      </Card>

      {/* 新增弹窗 */}
      <Modal
        title={<span><DollarOutlined style={{ marginRight: 8, color: PRIMARY }} />{isEditing ? '编辑提现记录' : '新增提现记录'}</span>}
        open={editVisible}
        onOk={handleSave}
        onCancel={() => setEditVisible(false)}
        okText="保存"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <div style={{ padding: '8px 0' }}>
          <Row gutter={16}>
            <Col span={12}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  <ShopOutlined style={{ marginRight: 4 }} />店铺名称 <Text type="danger">*</Text>
                </Text>
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择店铺"
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  value={formShop || undefined}
                  onChange={v => setFormShop(v)}
                  options={shops.map(s => ({ value: s.key, label: s.shopName }))}
                />
              </div>
            </Col>
            <Col span={12}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  <DollarOutlined style={{ marginRight: 4 }} />提现金额 <Text type="danger">*</Text>
                </Text>
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="输入金额"
                  value={formAmount || undefined}
                  onChange={v => setFormAmount(v || 0)}
                  min={0}
                  precision={2}
                  prefix="¥"
                  controls={false}
                />
              </div>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  提现日期
                </Text>
                <DatePicker
                  style={{ width: '100%' }}
                  value={formWithdrawalDate ? dayjs(formWithdrawalDate) : undefined}
                  onChange={v => setFormWithdrawalDate(v ? v.format('YYYY-MM-DD') : '')}
                  placeholder="选择提现日期"
                />
              </div>
            </Col>
          </Row>
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              <BankOutlined style={{ marginRight: 4 }} />选择银行账户 <Text type="danger">*</Text>
            </Text>
            <Select
              style={{ width: '100%' }}
              placeholder="选择银行账户，自动填充信息"
              value={formBankKey || undefined}
              onChange={handleBankSelect}
              options={bankOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label || '').toLowerCase().includes(input.toLowerCase())
              }
              notFoundContent={<Text type="secondary">暂无银行账户，请先在"银行账户"中添加</Text>}
            />
          </div>
          <Row gutter={12} style={{ marginBottom: 0 }}>
            <Col span={7}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  账户名称
                </Text>
                <Input
                  value={formAccountName}
                  readOnly
                  placeholder="自动填充"
                  style={{ background: '#f5f5f5' }}
                />
              </div>
            </Col>
            <Col span={7}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  开户银行
                </Text>
                <Input
                  value={formBankName}
                  readOnly
                  placeholder="自动填充"
                  style={{ background: '#f5f5f5' }}
                />
              </div>
            </Col>
            <Col span={5}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  银行账号
                </Text>
                <Input
                  value={formBankAccountNo ? (() => { const s = String(formBankAccountNo); return s.length > 8 ? s.slice(0, 4) + '****'.repeat(Math.ceil((s.length - 8) / 4)).slice(0, s.length - 8) + s.slice(-4) : s; })() : ''}
                  readOnly
                  placeholder="自动填充"
                  style={{ background: '#f5f5f5', fontFamily: 'monospace' }}
                />
              </div>
            </Col>
            <Col span={5}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 6 }}>
                  银行卡负责人
                </Text>
                <Input
                  value={formBankPerson}
                  readOnly
                  placeholder="引用银行账户负责人"
                  style={{ background: '#f5f5f5' }}
                />
              </div>
            </Col>
          </Row>
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              <UploadOutlined style={{ marginRight: 4 }} />提现截图
            </Text>
            {formScreenshot ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={formScreenshot} width={200} style={{ borderRadius: 6, border: '1px solid #eee' }} />
                <Button
                  type="text"
                  size="small"
                  danger
                  onClick={() => setFormScreenshot('')}
                  style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(255,255,255,0.8)' }}
                >
                  删除
                </Button>
              </div>
            ) : (
              <div
                onPaste={handleScreenshotPaste}
                tabIndex={0}
                style={{
                  border: '2px dashed #d9d9d9',
                  borderRadius: 8,
                  padding: 24,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: '#fafafa',
                  transition: 'border-color 0.3s',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = PRIMARY)}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#d9d9d9')}
              >
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={handleScreenshotUpload}
                >
                  <Button icon={<UploadOutlined />}>点击上传或粘贴截图</Button>
                </Upload>
                <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                  支持点击上传图片 或 Ctrl+V 粘贴截图
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
      </>)}

      {/* ============ 充值记录 ============ */}
      {activeTab === 'recharge' && (<>
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
        <Row gutter={[12, 10]} align="middle">
          <Col xs={24} sm={8} md={6} lg={4}><Input placeholder="店铺名称" allowClear value={rechSearch.shopName} onChange={e => setRechSearch(p => ({ ...p, shopName: e.target.value }))} onPressEnter={handleRechSearchApply} /></Col>
          <Col xs={12} sm={6} md={4} lg={3}>
            <Select placeholder="所属平台" allowClear showSearch style={{ width: '100%' }} value={rechSearch.platform || undefined} onChange={v => setRechSearch(p => ({ ...p, platform: v || '' }))} options={platformOptions} filterOption={(input, option) => String(option?.label || '').toLowerCase().includes(input.toLowerCase())} />
          </Col>
          <Col xs={12} sm={6} md={4} lg={3}>
            <Select placeholder="银行账号" allowClear showSearch style={{ width: '100%' }} value={rechSearch.bankAccountNo || undefined} onChange={v => setRechSearch(p => ({ ...p, bankAccountNo: v || '' }))} options={bankAccountOptions} filterOption={(input, option) => String(option?.label || '').toLowerCase().includes(input.toLowerCase())} />
          </Col>
          <Col xs={12} sm={6} md={4} lg={3}><Input placeholder="申请人" allowClear value={rechSearch.applicant} onChange={e => setRechSearch(p => ({ ...p, applicant: e.target.value }))} onPressEnter={handleRechSearchApply} /></Col>
          <Col xs={12} sm={6} md={4} lg={3}><Input placeholder="操作人" allowClear value={rechSearch.operator} onChange={e => setRechSearch(p => ({ ...p, operator: e.target.value }))} onPressEnter={handleRechSearchApply} /></Col>
          <Col xs={12} sm={6} md={4} lg={3}><Input placeholder="财务负责人" allowClear value={rechSearch.financePerson} onChange={e => setRechSearch(p => ({ ...p, financePerson: e.target.value }))} onPressEnter={handleRechSearchApply} /></Col>
          <Col xs={12} sm={8} md={6} lg={4}>
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              placeholder={['开始日期', '结束日期']}
              value={
                rechSearch.paidAtStart && rechSearch.paidAtEnd
                  ? [dayjs(rechSearch.paidAtStart), dayjs(rechSearch.paidAtEnd)]
                  : null
              }
              onChange={(dates) => {
                setRechSearch(p => ({
                  ...p,
                  paidAtStart: dates?.[0]?.format('YYYY-MM-DD') || '',
                  paidAtEnd: dates?.[1]?.format('YYYY-MM-DD') || '',
                }));
              }}
              onOpenChange={(open) => {
                if (!open && rechSearch.paidAtStart && rechSearch.paidAtEnd) {
                  handleRechSearchApply();
                }
              }}
            />
          </Col>
          <Col xs={12} sm={6} md={4} lg={3}><Input placeholder="金额区间 如100-5000" allowClear value={rechSearch.amountRange} onChange={e => setRechSearch(p => ({ ...p, amountRange: e.target.value }))} onPressEnter={handleRechSearchApply} /></Col>
          <Col>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleRechSearchApply}>搜索</Button>
              <Button onClick={handleRechSearchReset}>重置</Button>
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setApplyEditKey(null); setApplyShop(''); setApplyAmount(0); setApplyQrcode(''); setApplyFinancePerson(''); setApplyVisible(true); }}>申请充值</Button>
              <Button icon={<SettingOutlined />} onClick={() => setRechFieldConfigVisible(true)}>显示字段</Button>
              {isAdmin && <Tooltip title={`负责人：${managerDisplayNames()}`}>
                <Button icon={<TeamOutlined />} onClick={() => { setManagerSelectedUsers([...wdManagers]); setManagerModalVisible(true); }}>负责人设置</Button>
              </Tooltip>}
            </Space>
          </Col>
        </Row>
      </Card>
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<RechargeRecord> bordered size="middle" rowKey="key"
          dataSource={filteredRechRecords}
          scroll={{ x: rechScrollX, y: 'calc(100vh - 320px)' }}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无充值记录' }}
          columns={wrapRechCols([
            ...rechFieldOrder.filter(k => rechFieldVis[k]).map(k => {
              const map: Record<string, any> = {
                shopName: { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 140, align: 'center' as const },
                shopCode: { title: '店铺编码', dataIndex: 'shopCode', key: 'shopCode', width: 120, align: 'center' as const },
                platform: { title: '所属平台', dataIndex: 'platform', key: 'platform', width: 100, align: 'center' as const },
                amount: { title: '充值金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'center' as const, render: (v: number) => <Text strong style={{ color: PRIMARY }}>{fmt(v)}</Text> },
                qrcode: { title: '充值二维码', dataIndex: 'qrcode', key: 'qrcode', width: 80, align: 'center' as const, render: (v: string) => v ? <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} preview={{ mask: '查看' }} /> : '—' },
                accountName: { title: '账户名称', dataIndex: 'accountName', key: 'accountName', width: 100, align: 'center' as const },
                bankName: { title: '开户银行', dataIndex: 'bankName', key: 'bankName', width: 180, align: 'left' as const,
                  render: (v: string, r: RechargeRecord) => {
                    if (!v) return <Text type="secondary">—</Text>;
                    const color = getBankColor(v);
                    const short = getBankShortName(v);
                    // 通过银行账号匹配银行账户获取账户类型
                    const matchedBank = bankAccounts.find(b => r.bankAccountNo && b.bankAccountNo === r.bankAccountNo);
                    const accType = matchedBank?.accountType || '';
                    const accTypeColor = accType === '基本账户' ? '#722ed1' : accType === '一般账户' ? '#52c41a' : accType === '个人账户' ? '#faad14' : accType === '支付宝' ? '#1677ff' : accType === '微信' ? '#07c160' : '';
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', background: color,
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>{short}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
                          {accType && <Tag style={{ background: accTypeColor, color: '#fff', border: 'none', fontSize: 11, lineHeight: '18px', padding: '0 6px', marginTop: 2 }}>{accType}</Tag>}
                        </div>
                      </div>
                    );
                  }
                },
                bankAccountNo: { title: '银行账号', dataIndex: 'bankAccountNo', key: 'bankAccountNo', width: 180, align: 'center' as const,
                  render: (v: string) => {
                    if (!v) return <Text type="secondary">—</Text>;
                    return <Text code style={{ fontSize: 13, letterSpacing: 0.5 }}>{maskBankAccount(v)}</Text>;
                  }
                },
                applicant: { title: '申请人', dataIndex: 'applicant', key: 'applicant', width: 80, align: 'center' as const, render: (v: string) => getDisplayName(v) },
                operator: { title: '操作人', dataIndex: 'operator', key: 'operator', width: 80, align: 'center' as const, render: (v: string) => getDisplayName(v) },
                financePerson: { title: '财务负责人', dataIndex: 'financePerson', key: 'financePerson', width: 100, align: 'center' as const, render: (v: string) => getDisplayName(v) },
                status: { title: '状态', dataIndex: 'status', key: 'status', width: 90, align: 'center' as const, render: (v: RechargeStatus, r: RechargeRecord) => {
                  if (v === 'paid') return <Tag style={{ background: '#52c41a', color: '#fff', border: 'none' }}>已支付</Tag>;
                  if (v === 'rejected') return <Tooltip title={r.rejectReason}><Tag style={{ background: '#ff4d4f', color: '#fff', border: 'none' }}>已驳回</Tag></Tooltip>;
                  if (v === 'cancelled') return <Tag color="default">已取消</Tag>;
                  return <Tag color="warning">待审核</Tag>;
                }},
                paidAt: { title: '充值日期', dataIndex: 'paidAt', key: 'paidAt', width: 140, align: 'center' as const, render: (v: string) => v ? <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> : '—' },
              };
              return map[k];
            }).filter(Boolean),
            { title: '操作', key: 'action', width: 200, fixed: 'right' as const, align: 'center' as const,
              render: (_: any, r: RechargeRecord) => {
                const editable = canEditShopData(owner, shops.find(s => s.key === r.shopId || s.shopName === r.shopName)?.person, r.applicant);
                return (
                <Space size="small" wrap>
                  {r.status === 'pending' && (<>
                    <Button type="link" size="small" icon={<EditOutlined />} disabled={!editable} onClick={() => handleRechEdit(r)}>编辑</Button>
                    <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }} disabled={!editable} onClick={() => { setPayRecord(r); setPayBankKey(''); setRechDebit('销售费用'); setRechCredit('银行存款'); setPayVisible(true); }}>确认支付</Button>
                    <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={!editable} onClick={() => { setRejectRecord(r); setRejectReason(''); setRejectVisible(true); }}>驳回</Button>
                  </>)}
                  {r.status === 'paid' && (<>
                    <Button type="link" size="small" danger icon={<UndoOutlined />} disabled={!editable} onClick={() => handleRevokeRech(r)}>撤回</Button>
                  </>)}
                  {r.status === 'rejected' && (<>
                    <Button type="link" size="small" icon={<EditOutlined />} disabled={!editable} onClick={() => handleRechEdit(r)}>编辑</Button>
                    <Popconfirm title="确认取消此充值申请？" onConfirm={() => handleCancelRech(r)} okText="确认" cancelText="取消" disabled={!editable}>
                      <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={!editable}>取消</Button>
                    </Popconfirm>
                  </>)}
                </Space>
                );
              },
            },
          ] as any)} />
      </Card>
      </>)}

      {/* ============ 申请充值弹窗 ============ */}
      <Modal title={<span><WalletOutlined style={{ marginRight: 8, color: PRIMARY }} />{applyEditKey ? '编辑充值申请' : '申请充值'}</span>}
        open={applyVisible} onCancel={() => { setApplyVisible(false); setApplyEditKey(null); }} onOk={handleApplyRecharge}
        okText={applyEditKey ? '重新申请' : '确认申请'} cancelText="取消" width={520}>
        <div style={{ padding: '8px 0' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Text style={{ display: 'block', marginBottom: 4 }}>店铺名称 <Text type="danger">*</Text></Text>
              <Select value={applyShop || undefined} onChange={v => setApplyShop(v)} style={{ width: '100%' }}
                options={shops.map(s => ({ value: s.key, label: s.shopName }))} placeholder="选择店铺" />
            </Col>
            <Col span={12}>
              <Text style={{ display: 'block', marginBottom: 4 }}>店铺编号</Text>
              <Input value={shops.find(s => s.key === applyShop)?.accountId || ''} readOnly style={{ background: '#f5f5f5' }} />
            </Col>
          </Row>
          <Row gutter={16} style={{ marginTop: 12 }}>
            <Col span={12}>
              <Text style={{ display: 'block', marginBottom: 4 }}>所属平台</Text>
              <Input value={shops.find(s => s.key === applyShop)?.platform || ''} readOnly style={{ background: '#f5f5f5' }} />
            </Col>
            <Col span={12}>
              <Text style={{ display: 'block', marginBottom: 4 }}>充值金额 <Text type="danger">*</Text></Text>
              <InputNumber style={{ width: '100%' }} value={applyAmount || undefined} onChange={v => setApplyAmount(v || 0)}
                controls={false} precision={2} prefix="¥" placeholder="输入金额" />
            </Col>
          </Row>
          <div style={{ marginTop: 12 }}>
            <Text style={{ display: 'block', marginBottom: 4 }}>充值二维码</Text>
            <input ref={qrcodeFileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleQrcodeUpload(f); e.target.value = ''; }} />
            {applyQrcode ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={applyQrcode} width={120} style={{ borderRadius: 6, border: '1px solid #eee' }} />
                <Button type="text" size="small" danger onClick={() => setApplyQrcode('')}
                  style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.8)' }}>×</Button>
              </div>
            ) : (
              <div onClick={() => qrcodeFileRef.current?.click()} onPaste={handleQrcodePaste} tabIndex={0}
                style={{ width: 120, height: 120, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#fafafa' }}>
                <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
                  <UploadOutlined style={{ fontSize: 20, display: 'block', marginBottom: 4 }} />点击/粘贴
                </div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <Text style={{ display: 'block', marginBottom: 4 }}><TeamOutlined style={{ marginRight: 4 }} />财务负责人 <Text type="danger">*</Text></Text>
            <Select value={applyFinancePerson || undefined} onChange={v => setApplyFinancePerson(v)} style={{ width: '100%' }}
              showSearch optionFilterProp="label"
              options={accounts.map((a: any) => ({ value: a.username, label: `${a.displayName || a.person || a.username}` }))}
              placeholder="选择财务负责人" />
          </div>
        </div>
      </Modal>

      {/* ============ 确认到账弹窗（会计账薄模式：展示详情 + 借/贷科目） ============ */}
      <Modal title="确认到账" open={wdConfirmVisible} width={520}
        onCancel={() => setWdConfirmVisible(false)}
        onOk={() => { if (!wdConfirmRecord) return; handleConfirmReceipt(wdConfirmRecord); setWdConfirmVisible(false); setWdConfirmRecord(null); }}
        okText="确认到账" cancelText="取消" destroyOnClose>
        {wdConfirmRecord && (
          <div style={{ padding: '8px 0' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="店铺名称">{wdConfirmRecord.shopName}</Descriptions.Item>
              <Descriptions.Item label="提现金额"><Text strong style={{ color: PRIMARY }}>{fmt(wdConfirmRecord.amount)}</Text></Descriptions.Item>
              <Descriptions.Item label="收款账户">{wdConfirmRecord.accountName || '-'}</Descriptions.Item>
              <Descriptions.Item label="开户银行">{wdConfirmRecord.bankName || '-'}</Descriptions.Item>
              <Descriptions.Item label="操作人">{getDisplayName(wdConfirmRecord.inputBy)}</Descriptions.Item>
              <Descriptions.Item label="提现日期">{wdConfirmRecord.withdrawalDate || dayjs(wdConfirmRecord.createdAt).format('YYYY-MM-DD')}</Descriptions.Item>
            </Descriptions>
            <Row gutter={12} style={{ marginTop: 16 }}>
              <Col span={12}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>借方科目</Text>
                <Select style={{ width: '100%' }} showSearch value={wdDebit || undefined} placeholder="请选择借方科目"
                  options={subjectOptions} onChange={v => setWdDebit(v)}
                  filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
              </Col>
              <Col span={12}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>贷方科目</Text>
                <Select style={{ width: '100%' }} showSearch value={wdCredit || undefined} placeholder="请选择贷方科目"
                  options={subjectOptions} onChange={v => setWdCredit(v)}
                  filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
              </Col>
            </Row>
            <Alert type="info" showIcon style={{ marginTop: 16 }}
              message="说明与处理逻辑"
              description={<>确认到账后：① 向会计账薄的会计分录自动新增 2 条分录（借：<Text strong>{wdDebit || '银行存款'}</Text>，贷：<Text strong>{wdCredit || '应收账款'}</Text>），金额=提现金额；② 将该笔提现到账写入银行账户明细并更新余额；③ 生成对应日常记账。借/贷科目均可手动修改。若之后点击“撤回”，将自动删除该笔会计分录与银行明细。</>}
            />
          </div>
        )}
      </Modal>

      {/* ============ 确认支付弹窗 ============ */}
      <Modal title="确认支付" open={payVisible} onCancel={() => setPayVisible(false)} footer={null} width={500}>
        {payRecord && (
          <div style={{ padding: '8px 0' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="店铺名称">{payRecord.shopName}</Descriptions.Item>
              <Descriptions.Item label="充值金额"><Text strong style={{ color: PRIMARY }}>{fmt(payRecord.amount)}</Text></Descriptions.Item>
              <Descriptions.Item label="店铺编码">{payRecord.shopCode}</Descriptions.Item>
              <Descriptions.Item label="所属平台">{payRecord.platform}</Descriptions.Item>
              <Descriptions.Item label="申请人">{payRecord.applicant}</Descriptions.Item>
              <Descriptions.Item label="申请时间">{payRecord.createdAt}</Descriptions.Item>
            </Descriptions>
            {payRecord.qrcode && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>充值二维码</Text>
                <Image src={payRecord.qrcode} width={200} style={{ borderRadius: 8 }} />
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Text style={{ display: 'block', marginBottom: 4 }}>选择付款银行账户 <Text type="danger">*</Text></Text>
              <Select value={payBankKey || undefined} onChange={v => setPayBankKey(v)} style={{ width: '100%' }}
                options={bankOptions} placeholder="选择银行账户" showSearch
                filterOption={(input, option) => (option?.label || '').toLowerCase().includes(input.toLowerCase())} />
            </div>
            {acctMode && (<>
              <Row gutter={12} style={{ marginTop: 16 }}>
                <Col span={12}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>借方科目</Text>
                  <Select style={{ width: '100%' }} showSearch value={rechDebit || undefined} placeholder="请选择借方科目"
                    options={subjectOptions} onChange={v => setRechDebit(v)}
                    filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
                </Col>
                <Col span={12}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>贷方科目</Text>
                  <Select style={{ width: '100%' }} showSearch value={rechCredit || undefined} placeholder="请选择贷方科目"
                    options={subjectOptions} onChange={v => setRechCredit(v)}
                    filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
                </Col>
              </Row>
              <Alert type="info" showIcon style={{ marginTop: 16 }}
                message="说明与处理逻辑"
                description={<>点击“已支付”后：① 向会计账薄的会计分录自动新增 2 条分录（借：<Text strong>{rechDebit || '销售费用'}</Text>，贷：<Text strong>{rechCredit || '银行存款'}</Text>），金额=充值金额，摘要为“店铺名称+推广广告费”；② 将付款记录写入银行账号明细（支出）并更新余额；③ 生成对应日常记账。借/贷科目均可手动修改。若之后“撤回”，将自动删除该笔会计分录与银行明细。</>}
              />
            </>)}
            <Row justify="end" style={{ marginTop: 16 }}>
              <Space>
                <Button onClick={() => setPayVisible(false)}>取消</Button>
                <Button type="primary" onClick={handleConfirmPay}>已支付</Button>
              </Space>
            </Row>
          </div>
        )}
      </Modal>

      {/* ============ 驳回弹窗 ============ */}
      <Modal title="驳回充值申请" open={rejectVisible} onCancel={() => setRejectVisible(false)} onOk={handleReject}
        okText="确认驳回" cancelText="取消" width={420}>
        <div style={{ padding: '8px 0' }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>驳回原因 <Text type="danger">*</Text></Text>
          <Select value={rejectReason || undefined} onChange={v => setRejectReason(v)} style={{ width: '100%', marginBottom: 12 }}
            options={rejectReasons.map(r => ({ value: r, label: r }))} placeholder="选择驳回原因" />
          <Input.TextArea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
            placeholder="或输入自定义驳回原因" rows={3} />
        </div>
      </Modal>

      {/* ============ 字段配置弹窗（统一卡片式+拖动排序） ============ */}
      <FieldConfigModal
        open={rechFieldConfigVisible}
        fields={RECH_ALL_FIELDS}
        order={rechFieldOrder}
        visibility={rechFieldVis}
        onCancel={() => setRechFieldConfigVisible(false)}
        onSave={(o, v) => { setRechFieldOrder(o); setRechFieldVis(v); saveRechFieldConfig(o, v); setRechFieldConfigVisible(false); message.success('已保存'); }}
      />

      {/* ========== 发起提现任务弹窗 ========== */}
      <Modal
        title={<span><SendOutlined style={{ marginRight: 8 }} />发起提现任务</span>}
        open={withdrawTaskVisible}
        onCancel={() => { setWithdrawTaskVisible(false); setWithdrawTaskSelected([]); }}
        onOk={handleLaunchWithdrawTask}
        okText="发起任务" cancelText="取消"
        width={700}
        bodyStyle={{ padding: '16px 24px' }}
      >
        <Table<ShopInfo>
          rowKey="key"
          size="small"
          bordered
          pagination={false}
          scroll={{ y: 360 }}
          dataSource={shops}
          rowSelection={{
            selectedRowKeys: withdrawTaskSelected,
            onChange: (keys) => setWithdrawTaskSelected(keys as string[]),
            getCheckboxProps: (r) => {
              const hasRecent = getShopWithdrawStatus(r.shopName);
              return { disabled: hasRecent };
            },
          }}
          columns={[
            { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 180,
              render: (v: string) => <Text strong>{v}</Text> },
            { title: '负责人', dataIndex: 'person', key: 'person', width: 100, align: 'center' as const,
              render: (v: string) => v ? <Text>{v}</Text> : <Text type="secondary">—</Text> },
            { title: '提现情况', key: 'status', width: 120, align: 'center' as const,
              render: (_: any, r: ShopInfo) => {
                const hasRecent = getShopWithdrawStatus(r.shopName);
                return hasRecent
                  ? <Tag style={{ background: '#52c41a', color: '#fff', border: 'none', fontWeight: 500 }}>已提现</Tag>
                  : <Tag style={{ background: '#722ed1', color: '#fff', border: 'none', fontWeight: 500 }}>未提现</Tag>;
              } },
          ]}
        />
        <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
          * 已提现（最近3天有提现记录）的店铺不可重复发起任务
        </div>
      </Modal>

      {/* ========== 负责人设置弹窗 ========== */}
      <Modal
        title={<span><TeamOutlined style={{ marginRight: 8, color: PRIMARY }} />负责人设置 — 提现/充值</span>}
        open={managerModalVisible}
        onCancel={() => setManagerModalVisible(false)}
        onOk={handleSaveManagers}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
          设置提现/充值记录的查看负责人。设置后仅负责人和管理员可查看所有记录，其他成员只能看到自己创建的记录；未设置时所有人可看全部。
        </div>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>选择负责人（可多选）</div>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="请选择负责人（不选表示所有人可看全部）"
          value={managerSelectedUsers}
          onChange={setManagerSelectedUsers}
          options={allUserOptions}
          showSearch
          filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        {wdManagers.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#5a6d85' }}>当前负责人：{managerDisplayNames()}</div>
        )}
      </Modal>
    </div>
  );
};

export default WithdrawalRecordPage;
