import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, Tabs, Badge,
  Row, Col, Select, Tag, Empty, Image, Descriptions, Tooltip,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CheckOutlined, CloseOutlined, DollarOutlined,
  PictureOutlined, SnippetsOutlined, BankOutlined, WalletOutlined, CheckCircleOutlined, SettingOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { flushDatasetUploadAsync } from '../utils/serverSync';
import { recordSupplierPayment, incrementCustomerReceived } from '../utils/paySummary';
import { sumPayRecords, installmentStatusOf } from '../utils/receiptWrite';
import { isNotificationTypeEnabled } from '../utils/pushNotification';
import { isAccountingMode, writeAutoEntries, loadSubjectOptions, subjectFilterOption } from '../utils/accountingBridge';
import { safeJson, buildAuthNo, defaultAuthFmt, authFmtKey, baKeys, publishAppMirror, refundReqKey, writeJson } from '../utils/brandAuth';
import type { BrandApplication, BrandRefundReq } from '../utils/brandAuth';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// 支出主分类/子分类（与日常记账预设口径一致）
const EXPENSE_MAIN = [
  { name: '销售费用', subs: ['采购支出', '差旅费', '运输费', '广告推广费'] },
  { name: '管理费用', subs: ['办公费用', '水电费', '工资社保', '税费'] },
  { name: '财务费用', subs: ['报销', '其他支出'] },
];

// 状态标签
const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending_review: { color: 'orange', text: '付款审核' },
  approved: { color: 'blue', text: '待支付' },
  rejected: { color: 'red', text: '已拒绝' },
  paid: { color: 'green', text: '已支付' },
  pending_confirm: { color: 'cyan', text: '待确认' },
  confirmed: { color: 'green', text: '已确认' },
};

interface PaymentRequestRec {
  key: string;
  requestNo: string;
  amount: number;
  category: string;            // 主分类-子分类
  description: string;         // 付款说明
  recvType: 'bank' | 'qrcode';
  recvAccountName: string;     // 收款账户名称
  debitSubject?: string;       // 会计账薄版本：借方科目
  creditSubject?: string;      // 会计账薄版本：贷方科目
  recvBankName?: string;       // 开户银行
  recvBranchName?: string;     // 支行名称
  recvBankAccount?: string;    // 银行账户
  recvQrcode?: string;         // 收款码图片
  source: 'manual' | 'supplier' | 'order-installment';
  supplierName?: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'paid' | 'pending_confirm' | 'confirmed';
  rejectReason?: string;
  applicant: string;
  applicantName: string;
  applyDate: string;
  reviewer?: string;
  reviewedAt?: string;
  payer?: string;
  paidAt?: string;
  payAccount?: string;
  payScreenshot?: string;
  linkedBookKey?: string;
  recordType?: 'payment' | 'receipt';
  payerName?: string;
  confirmedAt?: string;
  customerId?: string;
  recvBankKey?: string;
  confirmedBy?: string;
  orderId?: string;               // 分段付款尾款：关联订单号
  installRecordKey?: string;      // 分段付款尾款：关联分期明细 key
  brandAppKey?: string;           // 关联的品牌申请单 key
  brandAuthKey?: string;          // 关联的授权品牌登记单 key（品牌管理-授权品牌页保证金流程）
  brandRefundReqKey?: string;     // 退回时关联的 BrandRefundReq key
  createdAt: string;
  updatedAt: string;
}

// 生成申请编号：FK + 日期 + 序号
const generateRequestNo = (list: PaymentRequestRec[]): string => {
  const prefix = `FK${dayjs().format('YYYYMMDD')}`;
  const seqs = list.filter(r => r.requestNo && r.requestNo.startsWith(prefix))
    .map(r => parseInt(r.requestNo.slice(-3), 10) || 0);
  return `${prefix}${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`;
};

const getDisplayName = (): string => {
  try {
    const username = localStorage.getItem('username') || '';
    const u = (JSON.parse(localStorage.getItem('registeredUsers') || '[]') as any[]).find(x => x.username === username);
    return u?.displayName || u?.contactPerson || u?.name || username || '—';
  } catch { return '—'; }
};

/** 付款申请页面：申请→财务审核→出纳支付→写入日常记账/银行明细/供应商已付货款 */
const PaymentRequestPage: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  const getDataOwner = () => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) return localStorage.getItem('parentAccount') || username;
    return username;
  };
  const storageKey = `payment_requests_${getDataOwner()}`;
  const isAdmin = localStorage.getItem('isSubAccount') !== 'true';

  const [records, setRecords] = useState<PaymentRequestRec[]>([]);
  const [activeTab, setActiveTab] = useState('my');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);

  // 申请弹窗
  const [applyVisible, setApplyVisible] = useState(false);
  const [formAmount, setFormAmount] = useState<number | null>(null);
  const [formMainCat, setFormMainCat] = useState('');
  const [formSubCat, setFormSubCat] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formRecvType, setFormRecvType] = useState<'bank' | 'qrcode'>('bank');
  const [formRecvName, setFormRecvName] = useState('');
  const [formRecvBank, setFormRecvBank] = useState('');
  const [formRecvBranch, setFormRecvBranch] = useState('');
  const [formRecvAccount, setFormRecvAccount] = useState('');
  const [formRecvQrcode, setFormRecvQrcode] = useState('');

  // 审核/支付弹窗
  const [rejectTarget, setRejectTarget] = useState<PaymentRequestRec | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payTarget, setPayTarget] = useState<PaymentRequestRec | null>(null);
  const [payBankKey, setPayBankKey] = useState('');
  const [payShot, setPayShot] = useState('');
  // 会计账薄版本：审核弹窗（申请详情 + 借/贷科目）与申请弹窗借/贷科目
  const [approveTarget, setApproveTarget] = useState<PaymentRequestRec | null>(null);
  const [approveDebit, setApproveDebit] = useState('');
  const [approveCredit, setApproveCredit] = useState('银行存款');
  const [formDebit, setFormDebit] = useState('应付账款');
  const [formCredit, setFormCredit] = useState('银行存款');

  // 收款确认弹窗
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [receiptFormAmount, setReceiptFormAmount] = useState<number | null>(null);
  const [receiptFormPayer, setReceiptFormPayer] = useState('');
  const [receiptFormDesc, setReceiptFormDesc] = useState('');
  const [receiptFormCustomerName, setReceiptFormCustomerName] = useState('');
  const [receiptFormCustomerId, setReceiptFormCustomerId] = useState('');
  const [receiptFormBankKey, setReceiptFormBankKey] = useState('');
  const [receiptFormDebit, setReceiptFormDebit] = useState('银行存款');
  const [receiptFormCredit, setReceiptFormCredit] = useState('其他应收款');
  const [confirmReceiptBankKey, setConfirmReceiptBankKey] = useState('');
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string }[]>([]);
  const [confirmReceiptTarget, setConfirmReceiptTarget] = useState<PaymentRequestRec | null>(null);

  // 负责人设置
  const [tabManagers, setTabManagers] = useState<Record<string, string[]>>({ receipt: [], review: [], pay: [] });
  const [managerModalTab, setManagerModalTab] = useState<string | null>(null);
  const [managerSelectedUsers, setManagerSelectedUsers] = useState<string[]>([]);
  const managersKey = `payment_request_managers_${getDataOwner()}`;

  const load = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setRecords([]); }
    try {
      const bas = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${getDataOwner()}`) || '[]');
      setBankAccounts(bas.filter((b: any) => b.status !== 'disabled' || !b.status));
    } catch { setBankAccounts([]); }
    // 加载负责人设置
    try {
      const mgrs = JSON.parse(localStorage.getItem(managersKey) || '{}');
      setTabManagers({ receipt: mgrs.receipt || [], review: mgrs.review || [], pay: mgrs.pay || [] });
    } catch { /* ignore */ }
    // 加载客户列表（直接客户 + 合作采购商）
    try {
      const custs: any[] = JSON.parse(localStorage.getItem(`customers_${getDataOwner()}`) || '[]');
      const bp: any[] = JSON.parse(localStorage.getItem(`bound_purchasers_${getDataOwner()}`) || '[]');
      const ip: any[] = JSON.parse(localStorage.getItem(`independent_purchasers_${getDataOwner()}`) || '[]');
      const opts: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      custs.forEach((c: any) => { if (c.name && !seen.has(c.name)) { seen.add(c.name); opts.push({ id: c.id || '', name: c.name }); } });
      bp.forEach((p: any) => { if (p.purchaserName && !seen.has(p.purchaserName)) { seen.add(p.purchaserName); opts.push({ id: p.id || '', name: p.purchaserName }); } });
      ip.forEach((p: any) => { if (p.purchaserName && !seen.has(p.purchaserName)) { seen.add(p.purchaserName); opts.push({ id: p.id || '', name: p.purchaserName }); } });
      setCustomerOptions(opts);
    } catch { setCustomerOptions([]); }
  }, [storageKey]);
  useEffect(() => {
    load();
    const ownerOfKey = storageKey.replace(/^payment_requests_/, '');
    const onStorage = (e: StorageEvent) => { if (e.key === storageKey || (e.key || '').includes('pageData_finance_bank-account_') || e.key === managersKey) load(); };
    // 同标签页其他页面（如订单分期登记）写入收款确认单后即时刷新（本页被保活，不会重新挂载）
    const onLocalUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.owner && detail.owner !== ownerOfKey) return;
      if (detail.key && !String(detail.key).includes('payment_requests_')) return;
      load();
    };
    // 服务端同步完成 / 窗口重新聚焦 / 标签页切回时刷新，避免保活页面展示旧数据
    const onResume = () => load();
    const onVisibility = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('payment-requests-updated', onLocalUpdate);
    window.addEventListener('sync-data-updated', onResume);
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('payment-requests-updated', onLocalUpdate);
      window.removeEventListener('sync-data-updated', onResume);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, storageKey, managersKey]);

  // 兜底刷新：其他页面（品牌保证金等）写入收/付款申请时若未派发事件，定时比对存储原文自动重载
  const lastRawRef = useRef<string>('');
  useEffect(() => {
    try { lastRawRef.current = localStorage.getItem(storageKey) || ''; } catch { /* ignore */ }
    const timer = setInterval(() => {
      let raw = '';
      try { raw = localStorage.getItem(storageKey) || ''; } catch { return; }
      if (raw !== lastRawRef.current) {
        lastRawRef.current = raw;
        load();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [load, storageKey]);

  // ========== 系统级通知提醒 ==========
  const notifiedKey = `payment_notified_${getDataOwner()}`;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Web Push 订阅存在时由服务端推送统一弹窗，页内不再重复 Notification
  const pushSubRef = useRef<boolean | null>(null);

  const checkAndNotify = useCallback(() => {
    try {
      const allRecords: PaymentRequestRec[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const notified: string[] = JSON.parse(localStorage.getItem(notifiedKey) || '[]');
      const notifiedSet = new Set(notified);

      // 读取负责人设置，判断当前用户是否为各标签页负责人
      const mgrs: Record<string, string[]> = JSON.parse(localStorage.getItem(managersKey) || '{}');
      const isReceiptMgr = (mgrs.receipt || []).length === 0 || (mgrs.receipt || []).includes(username);
      const isReviewMgr  = (mgrs.review  || []).length === 0 || (mgrs.review  || []).includes(username);
      const isPayMgr     = (mgrs.pay     || []).length === 0 || (mgrs.pay     || []).includes(username);
      if (!isReceiptMgr && !isReviewMgr && !isPayMgr) return; // 当前用户不是任何标签页负责人
      // 弹窗设置开关：关闭后不再弹出收/付申请待处理提醒
      if (!isNotificationTypeEnabled('pay-request')) return;

      // 筛选待处理记录（仅当前用户负责的标签页）
      const pendingReceipts = isReceiptMgr ? allRecords.filter(r => (r as any).recordType === 'receipt' && r.status === 'pending_confirm') : [];
      const pendingReviews  = isReviewMgr  ? allRecords.filter(r => r.status === 'pending_review') : [];
      const pendingPayments = isPayMgr     ? allRecords.filter(r => r.status === 'approved') : [];

      const newReceipts = pendingReceipts.filter(r => !notifiedSet.has(r.key));
      const newReviews  = pendingReviews.filter(r => !notifiedSet.has(r.key));
      const newPayments = pendingPayments.filter(r => !notifiedSet.has(r.key));

      if (newReceipts.length + newReviews.length + newPayments.length === 0) return;
      // 已订阅 Web Push：服务端统一推送系统通知（关闭浏览器也能弹），页内仅记账去重
      if (pushSubRef.current === true) {
        const allNewKeys0 = [...newReceipts, ...newReviews, ...newPayments].map(r => r.key);
        safeSetItem(notifiedKey, JSON.stringify([...notified, ...allNewKeys0].slice(-500)));
        return;
      }
      if (Notification.permission !== 'granted') return;

      // 收款确认通知
      if (newReceipts.length > 0) {
        const n = new Notification('收/付申请 - 收款确认', {
          body: `有 ${newReceipts.length} 笔新收款待确认${newReceipts.length === 1 ? `：${newReceipts[0].payerName || ''} ¥${Number(newReceipts[0].amount).toFixed(2)}` : ''}`,
          icon: '/favicon.ico',
          tag: `receipt-${newReceipts.map(r => r.key).join(',')}`,
          requireInteraction: true,
        });
        n.onclick = () => { window.focus(); window.location.href = `/finance/payment-request?payreq=${encodeURIComponent(newReceipts[0].key)}&tab=receipt`; };
      }

      // 待审核通知
      if (newReviews.length > 0) {
        const n = new Notification('收/付申请 - 付款审核', {
          body: `有 ${newReviews.length} 笔付款申请待审核${newReviews.length === 1 ? `：${newReviews[0].description || ''} ¥${Number(newReviews[0].amount).toFixed(2)}` : ''}`,
          icon: '/favicon.ico',
          tag: `review-${newReviews.map(r => r.key).join(',')}`,
          requireInteraction: true,
        });
        n.onclick = () => { window.focus(); window.location.href = `/finance/payment-request?payreq=${encodeURIComponent(newReviews[0].key)}&tab=review`; };
      }

      // 待支付通知
      if (newPayments.length > 0) {
        const n = new Notification('收/付申请 - 待支付', {
          body: `有 ${newPayments.length} 笔付款申请待支付${newPayments.length === 1 ? `：${newPayments[0].description || ''} ¥${Number(newPayments[0].amount).toFixed(2)}` : ''}`,
          icon: '/favicon.ico',
          tag: `pay-${newPayments.map(r => r.key).join(',')}`,
          requireInteraction: true,
        });
        n.onclick = () => { window.focus(); window.location.href = `/finance/payment-request?payreq=${encodeURIComponent(newPayments[0].key)}&tab=pay`; };
      }

      // 更新已通知列表（保留最近500条，防止无限增长）
      const allNewKeys = [...newReceipts, ...newReviews, ...newPayments].map(r => r.key);
      const updatedNotified = [...notified, ...allNewKeys].slice(-500);
      safeSetItem(notifiedKey, JSON.stringify(updatedNotified));
    } catch { /* ignore */ }
  }, [storageKey, notifiedKey, managersKey, username]);

  useEffect(() => {
    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // 初始检查 + 定时轮询（每30秒）
    checkAndNotify();
    pollRef.current = setInterval(checkAndNotify, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkAndNotify]);

  // 数据变化时立即检查（storage事件触发）
  useEffect(() => {
    const onStorageNotify = (e: StorageEvent) => {
      if (e.key === storageKey) {
        setTimeout(checkAndNotify, 500); // 延迟确保数据已写入
      }
    };
    window.addEventListener('storage', onStorageNotify);
    return () => window.removeEventListener('storage', onStorageNotify);
  }, [checkAndNotify, storageKey]);

  // 检测 Web Push 订阅状态（订阅存在时页内不再重复弹窗）
  useEffect(() => {
    (async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        pushSubRef.current = !!sub;
      } catch { pushSubRef.current = false; }
    })();
  }, []);

  // ========== 通知点击深链：打开详情弹窗并可直接处理 ==========
  const openProcessRef = useRef<string | null>(null);
  const tryOpenProcess = useCallback(() => {
    const k = openProcessRef.current;
    if (!k) return;
    const rec = records.find(r => r.key === k);
    if (!rec) return;
    openProcessRef.current = null;
    if ((rec as any).recordType === 'receipt' && rec.status === 'pending_confirm') {
      setActiveTab('receipt');
      setConfirmReceiptBankKey('');
      setConfirmReceiptTarget(rec);
    } else if (rec.status === 'pending_review') {
      setActiveTab('review');
      setApproveDebit('');
      setApproveCredit('银行存款');
      setApproveTarget(rec);
    } else if (rec.status === 'approved') {
      setActiveTab('pay');
      setPayTarget(rec);
      setPayBankKey('');
      setPayShot('');
    } else {
      setActiveTab((rec as any).recordType === 'receipt' ? 'receipt' : 'pay');
    }
  }, [records]);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const k = params.get('payreq');
      if (k) openProcessRef.current = k;
    } catch { /* ignore */ }
    const onOpen = (e: any) => { openProcessRef.current = e?.detail?.key || null; };
    window.addEventListener('payreq-open-process', onOpen);
    return () => window.removeEventListener('payreq-open-process', onOpen);
  }, []);
  useEffect(() => { tryOpenProcess(); }, [tryOpenProcess]);

  const save = (list: PaymentRequestRec[]) => {
    setRecords(list);
    safeSetItem(storageKey, JSON.stringify(list));
  };

  // ========== 负责人权限 ==========
  const isTabManager = useCallback((tab: 'receipt' | 'review' | 'pay'): boolean => {
    if (isAdmin) return true; // 管理员始终可操作
    const mgrs = tabManagers[tab] || [];
    if (mgrs.length === 0) return true; // 未设置负责人时，所有人都可操作
    return mgrs.includes(username);
  }, [tabManagers, username, isAdmin]);

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
      // 解析每个子账号的最终主账号（支持多级子账号链路）
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

  // ========== 提交申请 ==========
  const handleApplySave = () => {
    if (formAmount === null || !(formAmount > 0)) { message.warning('请输入大于0的申请金额'); return; }
    if (!formMainCat || !formSubCat) { message.warning('请选择支出主分类与子分类'); return; }
    if (!formDesc.trim()) { message.warning('请输入付款说明'); return; }
    if (!formRecvName.trim()) { message.warning('请输入收款账户名称'); return; }
    if (formRecvType === 'bank' && !formRecvAccount.trim()) { message.warning('请输入收款银行账户'); return; }
    if (formRecvType === 'qrcode' && !formRecvQrcode) { message.warning('请上传收款码图片'); return; }
    const rec: PaymentRequestRec = {
      key: `payreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo: generateRequestNo(records),
      amount: Number(formAmount),
      category: `${formMainCat}-${formSubCat}`,
      description: formDesc.trim(),
      recvType: formRecvType,
      debitSubject: formDebit || '应付账款',
      creditSubject: formCredit || '银行存款',
      recvAccountName: formRecvName.trim(),
      recvBankName: formRecvType === 'bank' ? formRecvBank.trim() : undefined,
      recvBranchName: formRecvType === 'bank' ? formRecvBranch.trim() : undefined,
      recvBankAccount: formRecvType === 'bank' ? formRecvAccount.trim() : undefined,
      recvQrcode: formRecvType === 'qrcode' ? formRecvQrcode : undefined,
      source: 'manual',
      status: 'pending_review',
      applicant: username,
      applicantName: getDisplayName(),
      applyDate: dayjs().format('YYYY-MM-DD'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    save([rec, ...records]);
    setApplyVisible(false);
    resetApplyForm();
    message.success('付款申请已提交，等待财务审核');
  };
  const resetApplyForm = () => {
    setFormAmount(null); setFormMainCat(''); setFormSubCat(''); setFormDesc('');
    setFormRecvType('bank'); setFormRecvName(''); setFormRecvBank(''); setFormRecvBranch(''); setFormRecvAccount(''); setFormRecvQrcode('');
    setFormDebit('应付账款'); setFormCredit('银行存款');
  };

  // ========== 审核 ==========
  const handleApproveConfirm = () => {
    if (!approveTarget) return;
    save(records.map(r => r.key === approveTarget.key ? {
      ...r, status: 'approved' as const, reviewer: getDisplayName(), reviewedAt: new Date().toLocaleString('zh-CN'), updatedAt: new Date().toISOString(),
      debitSubject: approveDebit || r.debitSubject || '', creditSubject: approveCredit || '银行存款',
    } : r));
    setApproveTarget(null);
    message.success('审核通过，已转入待支付');
  };
  const handleRejectConfirm = () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { message.warning('请输入拒绝原因'); return; }
    save(records.map(r => r.key === rejectTarget.key ? {
      ...r, status: 'rejected' as const, rejectReason: rejectReason.trim(), reviewer: getDisplayName(), reviewedAt: new Date().toLocaleString('zh-CN'), updatedAt: new Date().toISOString(),
    } : r));
    setRejectTarget(null); setRejectReason('');
    message.success('已拒绝该付款申请');
  };

  // ========== 出纳支付 ==========
  const handlePayConfirm = () => {
    if (!payTarget) return;
    if (!payBankKey) { message.warning('请选择付款账户'); return; }
    const bank = bankAccounts.find(b => b.key === payBankKey);
    if (!bank) { message.error('未找到付款银行账户'); return; }
    const owner = getDataOwner();
    const payerName = getDisplayName();
    // 1. 银行出账：供应商来源走付货款原子写入（含已付货款台账+快照）；普通申请写出账流水
    if (payTarget.source === 'supplier' && payTarget.supplierName) {
      const res = recordSupplierPayment({
        owner, supplierName: payTarget.supplierName, amountYuan: payTarget.amount,
        bankAccount: bank.name, screenshot: payShot, operator: payerName,
      });
      if (!res.ok) { message.error(res.msg || '付款写入失败'); return; }
    } else {
      try {
        const bankStorageKey = `pageData_finance_bank-account_${owner}`;
        const accounts: any[] = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
        const acc = accounts.find((a: any) => a.key === bank.key);
        if (!acc) { message.error('银行账户数据中未找到该账户'); return; }
        const prevBalance = Number(acc.balance) || 0;
        acc.transactions = [...(acc.transactions || []), {
          key: `txn-payreq-${Date.now()}`, time: new Date().toLocaleString('zh-CN'), type: 'out',
          amount: payTarget.amount, balanceAfter: prevBalance - payTarget.amount,
          counterparty: payTarget.recvAccountName, orderNo: '', orderId: '',
          person: username || 'admin', remark: `付款申请 — ${payTarget.requestNo} ${payTarget.description}`,
        }];
        acc.balance = prevBalance - payTarget.amount;
        const json = JSON.stringify(accounts);
        safeSetItem(bankStorageKey, json);
      } catch (err) { message.error('写入银行流水失败：' + (err as Error).message); return; }
    }
    // 2. 日常记账（支出，幂等键 bk-pay-）——仅简易账薄开启时登记；会计账薄模式走会计分录联动
    const bookKey = `bk-pay-${payTarget.key}`;
    if (!isAccountingMode(owner)) {
      try {
        const bkKey = `daily_bookkeeping_${owner}`;
        const books: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
        if (!books.some(b => b.key === bookKey)) {
          const today = new Date().toISOString().slice(0, 10);
          const prefix = `PZ-${today.replace(/-/g, '')}`;
          const seqs = books.map(b => String(b.voucherNo || '')).filter(v => v.startsWith(prefix)).map(v => parseInt(v.slice(-3), 10) || 0);
          const rec: any = {
            key: bookKey,
            voucherNo: `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`,
            bookDate: today,
            bookType: '支出',
            category: payTarget.category,
            amount: Math.abs(Number(payTarget.amount)) || 0,
            counterparty: payTarget.supplierName || payTarget.recvAccountName || '',
            remark: `付款申请-${payTarget.requestNo}（支付）`,
            person: payerName,
            payAccount: bank.name || '',
            recvAccount: '',
            recvBank: '',
            payBank: bank.bankName || '',
            image: payShot || '',
            isPersonalAdvance: false,
            isReturn: false,
            advanceRecvAccount: '',
            linkedReimbursementKey: '',
            linkedPaymentRequestKey: payTarget.key,
            createdAt: new Date().toISOString(),
          };
          safeSetItem(bkKey, JSON.stringify([rec, ...books]));
        }
      } catch (err) { console.error('付款申请记账写入失败', err); }
    }
    // 3. 更新申请状态
    save(records.map(r => r.key === payTarget.key ? {
      ...r, status: 'paid' as const, payer: payerName, paidAt: new Date().toLocaleString('zh-CN'),
      payAccount: bank.name, payScreenshot: payShot || undefined, linkedBookKey: bookKey, updatedAt: new Date().toISOString(),
    } : r));
    setPayTarget(null); setPayBankKey(''); setPayShot('');
    // 会计账薄版本：支付后自动生成借贷两条会计分录（摘要=付款说明；保证金退回默认借方=其他应付款）
    if (isAccountingMode(getDataOwner())) {
      const isDepositRefund = payTarget.category === '保证金退回' || !!payTarget.brandAppKey || !!payTarget.brandAuthKey;
      writeAutoEntries(getDataOwner(), {
        sourceKey: `payreq-${payTarget.key}`,
        debitSubject: (payTarget as any).debitSubject || (isDepositRefund ? '其他应付款' : '应付账款'),
        creditSubject: (payTarget as any).creditSubject || '银行存款',
        amount: payTarget.amount,
        summary: payTarget.description || `付款申请-${payTarget.requestNo}`,
        date: dayjs().format('YYYY-MM-DD'),
        bookkeeper: getDisplayName(),
        auditor: payTarget.reviewer || getDisplayName(),
        cashier: getDisplayName(),
      });
    }
    message.success(`已支付 ¥${Number(payTarget.amount).toFixed(2)}，已写入日常记账与银行账户明细${payTarget.source === 'supplier' ? '与供应商已付货款明细' : ''}`);

    // 品牌保证金退回联动：付款申请支付成功后更新退回申请状态
    if (payTarget.brandRefundReqKey) {
      try {
        const K = baKeys(owner);
        const brandApps: BrandApplication[] = safeJson<BrandApplication[]>(K.apps, []);
        const reqs: BrandRefundReq[] = safeJson<BrandRefundReq[]>(refundReqKey(owner), []);
        const reqIdx = reqs.findIndex((q: BrandRefundReq) => q.key === payTarget.brandRefundReqKey);
        if (reqIdx >= 0) {
          const todayStr = dayjs().format('YYYY-MM-DD');
          const updatedReq: BrandRefundReq = {
            ...reqs[reqIdx],
            status: '已退回',
            refundShot: payShot || '',
            refundAt: todayStr,
            payBankName: bank.name || '',
            agentRecv: reqs[reqIdx].agentBank || '',
          };
          reqs[reqIdx] = updatedReq;
          writeJson(refundReqKey(owner), reqs);
          // 同步更新品牌申请单 depositState
          const appIdx = brandApps.findIndex((a: BrandApplication) => a.key === payTarget.brandAppKey);
          if (appIdx >= 0) {
            const updatedApp: BrandApplication = {
              ...brandApps[appIdx],
              depositState: '已退回',
              depositPaymentKey: payTarget.key,
              refundShot: payShot || '',
              refundAt: todayStr,
              refundPayBankName: bank.name || '',
            };
            brandApps[appIdx] = updatedApp;
            safeSetItem(K.apps, JSON.stringify(brandApps));
            const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            const ownerUser = users.find((x: any) => x.username === owner);
            publishAppMirror(updatedApp, ownerUser?.companyName || '', owner);
          }
        }
      } catch { /* ignore brand refund linking errors */ }
    } else if (payTarget.brandAppKey) {
      // 品牌方主动退保（无 BrandRefundReq，仅有 brandAppKey）：付款成功后更新申请单并创建退回记录供代理商确认
      try {
        const K = baKeys(owner);
        const brandApps: BrandApplication[] = safeJson<BrandApplication[]>(K.apps, []);
        const appIdx = brandApps.findIndex((a: BrandApplication) => a.key === payTarget.brandAppKey);
        if (appIdx >= 0) {
          const app = brandApps[appIdx];
          const todayStr = dayjs().format('YYYY-MM-DD');
          const updatedApp: BrandApplication = {
            ...app,
            depositState: '已退回',
            depositPaymentKey: payTarget.key,
            refundShot: payShot || '',
            refundAt: todayStr,
            refundPayBankName: bank.name || '',
          };
          brandApps[appIdx] = updatedApp;
          safeSetItem(K.apps, JSON.stringify(brandApps));
          const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const ownerUser = users.find((x: any) => x.username === owner);
          publishAppMirror(updatedApp, ownerUser?.companyName || '', owner);
          // 创建 BrandRefundReq 记录，供代理商侧显示"已退待确认"并确认到账
          if (app.agentUsername) {
            const reqs = safeJson<BrandRefundReq[]>(refundReqKey(owner), []);
            // 幂等：同一 appKey 只创建一条
            if (!reqs.some(r => r.appKey === app.key)) {
              const newReq: BrandRefundReq = {
                key: `BR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                appKey: app.key,
                brandOwner: owner,
                agentUsername: app.agentUsername,
                companyName: app.companyName || '',
                amount: String(app.deposit || ''),
                requestedAt: todayStr,
                status: '已退回',
                refundShot: payShot || '',
                refundAt: todayStr,
                payBankName: bank.name || '',
                agentRecv: app.refundAgentRecv || payTarget.recvAccountName || '',
                brandCompany: ownerUser?.companyName || '',
              };
              writeJson(refundReqKey(owner), [...reqs, newReq]);
            }
          }
        }
      } catch { /* ignore brand-initiated refund linking errors */ }
    }

    // 保证金退回 → 核销其他应付款台账（简易账薄模式下收款时写入的那条）
    if (payTarget.brandAppKey || payTarget.brandRefundReqKey || payTarget.category === '保证金退回') {
      try {
        const opKey = `other_payables_${owner}`;
        const opList: any[] = JSON.parse(localStorage.getItem(opKey) || '[]');
        // 优先按品牌申请单的 depositReceiptKey 匹配收款记录键，回退按对方+金额匹配
        const targetAppKey = payTarget.brandAppKey;
        let matchedIdx = -1;
        if (targetAppKey) {
          const brandApps: BrandApplication[] = safeJson<BrandApplication[]>(baKeys(owner).apps, []);
          const app = brandApps.find((a: BrandApplication) => a.key === targetAppKey);
          if (app?.depositReceiptKey) {
            matchedIdx = opList.findIndex((p: any) => p.key === `deposit-recv-${app.depositReceiptKey}`);
          }
        }
        if (matchedIdx < 0 && payTarget.brandAuthKey) {
          // 授权品牌登记单（我方收流程）：按登记单上的收款确认单键精确匹配其他应付款台账
          const authRecs: any[] = safeJson<any[]>(baKeys(owner).records, []);
          const arec = authRecs.find((x: any) => x.key === payTarget.brandAuthKey);
          if (arec?.depositReceiptKey) matchedIdx = opList.findIndex((p: any) => p.key === `deposit-recv-${arec.depositReceiptKey}`);
        }
        if (matchedIdx < 0) {
          // 回退匹配加往来方约束：退款收款方须与收款时登记的对方一致，避免同金额多品牌误核销
          const refundCounterparty = String(payTarget.recvAccountName || payTarget.payerName || '').trim();
          matchedIdx = opList.findIndex((p: any) =>
            p.category === '押金/保证金收取' &&
            (!refundCounterparty || String(p.counterparty || '').trim() === refundCounterparty) &&
            Math.abs((Number(p.amount) || 0) - (Number(payTarget.amount) || 0)) < 0.01 &&
            (Number(p.paidAmount) || 0) < (Number(p.amount) || 0)
          );
        }
        if (matchedIdx >= 0) {
          const rec = opList[matchedIdx];
          const paid = (Number(rec.paidAmount) || 0) + (Number(payTarget.amount) || 0);
          opList[matchedIdx] = {
            ...rec,
            paidAmount: Math.min(paid, Number(rec.amount) || 0),
            paidDate: dayjs().format('YYYY-MM-DD'),
            payImage: payShot || rec.payImage || '',
          };
          safeSetItem(opKey, JSON.stringify(opList));
        } else if (!isAccountingMode(owner)) {
          // 简易账薄模式下未匹配到待核销应付款：显式提示手动处理，避免静默漏核销
          message.warning('未匹配到待核销的其他应付款记录，如需核销请到 简易账薄→其他应付款 手动付款');
        }
      } catch { /* ignore payables update errors */ }
    }

    // 授权品牌登记联动：退款支付成功后将授权品牌页保证金状态置为已退回
    if (payTarget.brandAuthKey) {
      try {
        const K = baKeys(owner);
        const authRecs: any[] = safeJson<any[]>(K.records, []);
        const aIdx = authRecs.findIndex((x: any) => x.key === payTarget.brandAuthKey);
        if (aIdx >= 0) {
          authRecs[aIdx] = { ...authRecs[aIdx], depositStatus: 'returned', depositPaymentKey: payTarget.key };
          writeJson(K.records, authRecs);
        }
      } catch { /* ignore auth record update errors */ }
    }
  };

  // ========== 收款确认 ==========
  const handleAddReceipt = () => {
    if (!(receiptFormAmount && receiptFormAmount > 0)) { message.warning('请输入大于0的收款金额'); return; }
    if (!receiptFormCustomerName.trim()) { message.warning('请选择或输入客户名称'); return; }
    const rec: PaymentRequestRec = {
      key: `recvreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo: `SK${dayjs().format('YYYYMMDD')}${String(records.filter(r => r.requestNo?.startsWith('SK')).length + 1).padStart(3, '0')}`,
      amount: Number(receiptFormAmount),
      category: '收款',
      description: receiptFormDesc.trim() || '收款确认',
      recvType: 'bank',
      recvAccountName: receiptFormCustomerName.trim(),
      source: 'manual',
      status: 'pending_confirm',
      recordType: 'receipt',
      payerName: receiptFormCustomerName.trim(),
      recvBankKey: receiptFormBankKey || undefined,
      debitSubject: receiptFormDebit || '银行存款',
      creditSubject: receiptFormCredit || '其他应收款',
      customerId: customerOptions.find(c => c.name === receiptFormCustomerName.trim())?.id || '',
      applicant: username,
      applicantName: getDisplayName(),
      applyDate: dayjs().format('YYYY-MM-DD'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    save([rec, ...records]);
    setReceiptModalVisible(false);
    setReceiptFormAmount(null); setReceiptFormPayer(''); setReceiptFormDesc('');
    setReceiptFormCustomerName(''); setReceiptFormCustomerId(''); setReceiptFormBankKey('');
    message.success('收款记录已添加，等待确认到账');
  };

  const handleConfirmReceipt = (r: PaymentRequestRec) => {
    const owner = getDataOwner();
    const bankKey = r.recvBankKey || confirmReceiptBankKey;
    if (!bankKey) { message.warning('请选择收款银行账户'); return; }
    if (!r.payerName?.trim()) { message.warning('客户名称缺失，无法确认收款'); return; }
    const now = new Date();
    const nowStr = now.toISOString();
    const today = dayjs().format('YYYY-MM-DD');
    const nowTime = `${today} ${now.toTimeString().slice(0, 8)}`;
    const customerName = r.payerName.trim();

    // 品牌授权登记联动（授权品牌页）：区分我方收收取流程（分销商店铺+我方收）与公司内部店铺代付收回流程
    let authRec: any = null;
    if (r.brandAuthKey) {
      try { authRec = safeJson<any[]>(baKeys(owner).records, []).find((x: any) => x.key === r.brandAuthKey) || null; } catch { /* ignore */ }
    }
    const isRecvAuth = !!authRec && authRec.shopType === '分销商店铺' && authRec.depositTo === '我方收';

    // 1. 写入客户收款明细台账（customerReceipts_）
    try {
      const crKey = `customerReceipts_${owner}`;
      const crList: any[] = JSON.parse(localStorage.getItem(crKey) || '[]');
      const dayPrefix = `SK-${dayjs().format('YYYYMMDD')}-`;
      let seq = crList.filter((rr: any) => String(rr.receiptNo || '').startsWith(dayPrefix)).length + 1;
      let receiptNo = `${dayPrefix}${String(seq).padStart(3, '0')}`;
      while (crList.some((rr: any) => rr.receiptNo === receiptNo)) { seq += 1; receiptNo = `${dayPrefix}${String(seq).padStart(3, '0')}`; }
      const bankAcc = bankAccounts.find((b: any) => b.key === bankKey);
      crList.push({
        key: `RC-${Date.now()}`,
        receiptNo,
        customerId: r.customerId || '',
        customerName,
        amount: r.amount,
        account: bankAcc?.name || '',
        voucher: '',
        date: nowTime,
        source: '收/付申请确认',
      });
      safeSetItem(crKey, JSON.stringify(crList));
    } catch { /* ignore */ }

    // 2. 客户已收货款快照增量
    incrementCustomerReceived(owner, customerName, r.amount);

    // 3. 银行明细写入收入
    try {
      const baKey = `pageData_finance_bank-account_${owner}`;
      const bas: any[] = JSON.parse(localStorage.getItem(baKey) || '[]');
      const idx = bas.findIndex((b: any) => b.key === bankKey);
      if (idx >= 0) {
        const bal = Number(bas[idx].balance) || 0;
        const nb = bal + r.amount;
        bas[idx].transactions = [...(bas[idx].transactions || []), {
          key: `txn-${Date.now()}`,
          time: nowTime,
          type: 'in',
          amount: r.amount,
          balanceAfter: nb,
          counterparty: customerName,
          orderNo: r.requestNo,
          orderId: '',
          person: getDisplayName(),
          remark: `客户收款确认 — ${customerName}（${r.requestNo}）`,
        }];
        bas[idx].balance = nb;
        safeSetItem(baKey, JSON.stringify(bas));
      }
    } catch { /* ignore */ }

    // 4a. 会计账薄模式：生成2条会计分录（品牌保证金：借银行存款 贷其他应付款；普通收款：借银行存款 贷应收账款）
    if (isAccountingMode(owner)) {
      writeAutoEntries(owner, {
        sourceKey: `receipt-confirm-${r.key}`,
        debitSubject: r.debitSubject || '银行存款',
        creditSubject: r.creditSubject || ((r.brandAppKey || isRecvAuth) ? '其他应付款' : '其他应收款'),
        amount: r.amount,
        summary: (r.brandAppKey || r.brandAuthKey)
          ? `收到${customerName}品牌保证金（收款编号 ${r.requestNo}）`
          : r.orderId
            ? `订单 ${r.orderId} 分段付款收款（收款编号 ${r.requestNo}）`
            : `收到${customerName}货款（收款编号 ${r.requestNo}）`,
        date: today,
        bookkeeper: r.applicantName || getDisplayName(),
        auditor: r.applicantName || getDisplayName(),
        cashier: getDisplayName(),
      });
    }

    // 4b. 简易账薄模式：在日常记账中新增收入记录（品牌保证金分类=其他应付款，幂等键 bk-receipt-）
    if (!isAccountingMode(owner)) {
      const bookKey = `bk-receipt-${r.key}`;
      try {
        const bkKey = `daily_bookkeeping_${owner}`;
        const bkList: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
        if (!bkList.some((b: any) => b.key === bookKey)) {
          const prefix = `PZ-${today.replace(/-/g, '')}`;
          const seqs = bkList.map((b: any) => String(b.voucherNo || '')).filter((v: string) => v.startsWith(prefix)).map((v: string) => parseInt(v.slice(-3), 10) || 0);
          const bkRec = {
            key: bookKey,
            voucherNo: `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`,
            bookDate: today,
            bookType: '收入' as const,
            category: (r.brandAppKey || isRecvAuth) ? '其他应付款' : (r.brandAuthKey ? '其他应收款' : '主营业务收入-销售收入'),
            amount: r.amount,
            counterparty: customerName,
            remark: r.orderId ? `收款确认 — 订单 ${r.orderId} 分段付款收款（${r.requestNo}）` : `收款确认 — ${customerName}（${r.requestNo}）`,
            person: r.applicantName || getDisplayName(),
            recvAccount: bankAccounts.find((b: any) => b.key === bankKey)?.name || '',
            recvBank: bankAccounts.find((b: any) => b.key === bankKey)?.bankName || '',
            payAccount: '',
            payBank: '',
            image: '',
            isPersonalAdvance: false,
            isReturn: false,
            advanceRecvAccount: '',
            linkedReimbursementKey: '',
            department: '',
            auditor: r.applicantName || getDisplayName(),
            cashier: getDisplayName(),
            createdAt: nowStr,
          };
          safeSetItem(bkKey, JSON.stringify([bkRec, ...bkList]));
        }
      } catch { /* ignore */ }

      // 品牌保证金 → 同步写入其他应付款台账（待付状态，退回时核销）；授权品牌我方收流程同口径
      if (r.brandAppKey || isRecvAuth) {
        try {
          const opKey = `other_payables_${owner}`;
          const opList: any[] = JSON.parse(localStorage.getItem(opKey) || '[]');
          const payKey = `deposit-recv-${r.key}`;
          if (!opList.some((p: any) => p.key === payKey)) {
            const opRec = {
              key: payKey,
              payDate: today,
              counterparty: customerName,
              category: '押金/保证金收取',
              amount: Number(r.amount) || 0,
              dueDate: '',
              paidAmount: 0,
              paidDate: '',
              bankAccount: bankAccounts.find((b: any) => b.key === bankKey)?.name || '',
              remark: `品牌保证金 — ${customerName}（${r.requestNo}）`,
              createdAt: nowStr,
            };
            safeSetItem(opKey, JSON.stringify([opRec, ...opList]));
          }
        } catch { /* ignore */ }
      }
    }

    // 公司内部店铺代付收回收款：核销登记时写入的其他应收款台账（幂等）
    if (r.brandAuthKey && authRec && !isRecvAuth) {
      try {
        const orKey = `other_receivables_${owner}`;
        const orList: any[] = JSON.parse(localStorage.getItem(orKey) || '[]');
        const orIdx = orList.findIndex((x: any) => x.key === `deposit-pay-${authRec.key}`);
        if (orIdx >= 0 && (Number(orList[orIdx].receivedAmount) || 0) < (Number(orList[orIdx].amount) || 0)) {
          orList[orIdx] = { ...orList[orIdx], receivedAmount: Number(orList[orIdx].amount) || 0, receivedDate: today, bankAccount: bankAccounts.find((b: any) => b.key === bankKey)?.name || orList[orIdx].bankAccount || '' };
          safeSetItem(orKey, JSON.stringify(orList));
        }
      } catch { /* ignore */ }
    }

    // 品牌申请联动：收款确认后自动更新品牌申请单状态
    if (r.brandAppKey) {
      try {
        const K = baKeys(owner);
        const brandApps: BrandApplication[] = safeJson<BrandApplication[]>(K.apps, []);
        const appIdx = brandApps.findIndex((a: BrandApplication) => a.key === r.brandAppKey);
        if (appIdx >= 0) {
          const authFmt = safeJson<any>(authFmtKey(owner), null) || defaultAuthFmt(owner);
          const authNo = brandApps[appIdx].authNo || buildAuthNo(authFmt, owner, brandApps);
          const bankAcc = bankAccounts.find((b: any) => b.key === bankKey);
          const snapshot = [bankAcc?.name, bankAcc?.bankName, bankAcc?.branchName, bankAcc?.accountNo || bankAcc?.bankAccountNo].filter(Boolean).join(' / ');
          const updated: BrandApplication = {
            ...brandApps[appIdx],
            status: '已确认到账',
            authNo,
            confirmedAt: today,
            depositState: '已确认',
            recvBankKey: bankKey,
            recvBankSnapshot: snapshot,
          };
          brandApps[appIdx] = updated;
          safeSetItem(K.apps, JSON.stringify(brandApps));
          const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const ownerUser = users.find((x: any) => x.username === owner);
          publishAppMirror(updated, ownerUser?.companyName || '', owner);
        }
      } catch { /* ignore brand linking errors */ }
    }

    // 更新状态为已确认
    const confirmedBy = getDisplayName();
    // 分段付款尾款收款确认：回写订单分期明细（待确认→已确认）并计入累计已收、推进订单状态
    if (r.orderId) {
      try {
        const omKey = `pageData_sales_order-manage_${owner}`;
        const omList: any[] = JSON.parse(localStorage.getItem(omKey) || '[]');
        const ord = Array.isArray(omList) ? omList.find((o: any) => o.id === r.orderId || o.key === r.orderId) : null;
        if (ord) {
          const recs0: any[] = Array.isArray(ord.payRecords) ? ord.payRecords : [];
          // 关联键优先；历史确认单可能缺 installRecordKey，按金额在该订单待确认记录中唯一匹配兜底
          let targetKey = r.installRecordKey && recs0.some((x: any) => x.key === r.installRecordKey) ? r.installRecordKey : '';
          if (!targetKey) {
            const cands = recs0.filter((x: any) => x.status === 'pending_confirm' && Math.abs((Number(x.amount) || 0) - (Number(r.amount) || 0)) < 0.01);
            if (cands.length === 1) targetKey = cands[0].key;
          }
          if (targetKey) {
            const recs = recs0.map((x: any) => (x.key === targetKey
              ? { ...x, status: 'confirmed', confirmedAt: nowStr, confirmedBy }
              : x));
            const paidNow = sumPayRecords(recs);
            const patch: any = { payRecords: recs, paidAmount: paidNow };
            const stNow = installmentStatusOf(ord, Number(ord.productAmount) || 0, paidNow);
            if (stNow && stNow !== ord.orderStatus && (ord.orderStatus === '待付款' || ord.orderStatus === '部分付款')) {
              patch.orderStatus = stNow;
              if (stNow === '已付款') patch.payTime = nowStr;
            }
            const logs: any[] = (() => { try { return JSON.parse(ord.orderLog || '[]'); } catch { return []; } })();
            logs.push({ time: nowStr, action: '收款确认', operator: confirmedBy, detail: `分段付款收款 ¥${Number(r.amount).toFixed(2)} 收款确认，累计已收 ¥${paidNow.toFixed(2)}${patch.orderStatus ? `，订单状态变更为${patch.orderStatus}` : ''}` });
            const updatedOrd = { ...ord, ...patch, orderLog: JSON.stringify(logs) };
            const omJson = JSON.stringify(omList.map((o: any) => (o.id === ord.id ? updatedOrd : o)));
            safeSetItem(omKey, omJson);
            // IndexedDB 同步 + 立即上传：防止刷新或服务端拉取时用旧订单数据回灌覆盖
            saveDataset(omKey, omJson);
            void flushDatasetUploadAsync(omKey, omJson);
            // 同标签页通知订单管理页刷新内存快照（列表 + 已打开的订单详情）
            try { window.dispatchEvent(new CustomEvent('order-data-updated', { detail: { owner, key: omKey, orderId: ord.id } })); } catch { /* ignore */ }
            // 推送单回写：保持两端分期台账一致
            try {
              const pk = 'purchaser_pushed_orders';
              const pushed: any[] = JSON.parse(localStorage.getItem(pk) || '[]');
              const pJson = JSON.stringify(pushed.map((po: any) => po.id === ord.id ? { ...po, payRecords: recs, paidAmount: paidNow, ...(patch.orderStatus ? { orderStatus: patch.orderStatus } : {}) } : po));
              safeSetItem(pk, pJson);
              saveDataset(pk, pJson);
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    save(records.map(rec => rec.key === r.key ? {
      ...rec, status: 'confirmed' as const, confirmedAt: nowStr, confirmedBy, updatedAt: nowStr,
    } : rec));
    setConfirmReceiptTarget(null);
    setConfirmReceiptBankKey('');
    const modeLabel = isAccountingMode(owner) ? '会计分录' : '日常记账';
    message.success(`已确认收款 ¥${Number(r.amount).toFixed(2)}，已写入银行明细、客户已收货款及${modeLabel}`);
  };

  // ========== 列表 ==========
  const myRecords = useMemo(() => records.filter(r => r.applicant === username), [records, username]);
  const reviewRecords = useMemo(() => records.filter(r => r.status === 'pending_review'), [records]);
  const payRecords = useMemo(() => records.filter(r => r.status === 'approved'), [records]);
  const paidRecords = useMemo(() => records.filter(r => r.status === 'paid' && (r as any).recordType !== 'receipt'), [records]);

  // 收款确认列表
  const receiptPendingRecords = useMemo(() => records.filter(r => (r as any).recordType === 'receipt' && r.status === 'pending_confirm'), [records]);
  const receiptConfirmedRecords = useMemo(() => records.filter(r => (r as any).recordType === 'receipt' && r.status === 'confirmed'), [records]);

  // 收款确认列定义
  const receiptColumns: ColumnsType<PaymentRequestRec> = [
    { title: '序号', key: 'idx', width: 50, align: 'center', render: (_v, _r, idx) => idx + 1 },
    { title: '收款编号', dataIndex: 'requestNo', key: 'requestNo', width: 130, align: 'center', render: v => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</span> },
    { title: '登记日期', dataIndex: 'applyDate', key: 'applyDate', width: 100, align: 'center' },
    { title: '客户名称', dataIndex: 'payerName', key: 'payerName', width: 140, render: v => <Text strong>{v || '—'}</Text> },
    { title: '收款账户', key: 'bankAcc', width: 120, render: (_v, r) => { const b = bankAccounts.find((ba: any) => ba.key === r.recvBankKey); return b ? `${b.name}` : '—'; } },
    { title: '收款金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right', render: v => <Text strong style={{ color: '#52c41a' }}>¥{Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text> },
    { title: '说明', dataIndex: 'description', key: 'description', width: 200, ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, align: 'center', render: v => { const s = STATUS_MAP[v]; return s ? <Tag color={s.color}>{s.text}</Tag> : v; } },
    { title: '登记人', dataIndex: 'applicantName', key: 'applicantName', width: 90, align: 'center' },
    { title: '确认时间', dataIndex: 'confirmedAt', key: 'confirmedAt', width: 140, render: v => v ? dayjs(v).format('MM-DD HH:mm') : '—' },
    {
      title: '操作', key: 'action', width: 100, align: 'center', fixed: 'right' as const,
      render: (_v, r) => r.status === 'pending_confirm' ? (
        <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }}
          onClick={() => { setConfirmReceiptTarget(r); setConfirmReceiptBankKey(r.recvBankKey || ''); }}>确认到账</Button>
      ) : <Tag color="green">已确认</Tag>,
    },
  ];

  const recvSummary = (r: PaymentRequestRec) => r.recvType === 'bank'
    ? `${r.recvAccountName} ${r.recvBankAccount || ''}${r.recvBankName ? ` (${r.recvBankName})` : ''}`
    : `收款码 ${r.recvAccountName}`;

  const columns: ColumnsType<PaymentRequestRec> = [
    { title: '序号', key: 'idx', width: 50, align: 'center', render: (_v, _r, idx) => idx + 1 },
    { title: '申请编号', dataIndex: 'requestNo', key: 'requestNo', width: 130, align: 'center', render: v => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</span> },
    { title: '申请日期', dataIndex: 'applyDate', key: 'applyDate', width: 100, align: 'center' },
    { title: '分类', dataIndex: 'category', key: 'category', width: 140, align: 'center', render: v => <Tag color="orange">{v}</Tag> },
    { title: '申请金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right', render: v => <Text strong style={{ color: PRIMARY }}>¥{Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text> },
    { title: '收款方', key: 'recv', width: 200, render: (_v, r) => (
      <div>
        <div>{r.supplierName ? <Tag color="blue">{r.supplierName}</Tag> : r.recvAccountName}</div>
        <div style={{ fontSize: 11, color: '#999' }}>{recvSummary(r)}</div>
      </div>
    ) },
    { title: '付款说明', dataIndex: 'description', key: 'description', width: 180, ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, align: 'center', render: v => { const s = STATUS_MAP[v]; return s ? <Tag color={s.color}>{s.text}</Tag> : v; } },
    { title: '申请人', dataIndex: 'applicantName', key: 'applicantName', width: 90, align: 'center' },
    { title: '付款账户', dataIndex: 'payAccount', key: 'payAccount', width: 120, align: 'center', render: v => v || '—' },
    {
      title: '操作', key: 'action', width: 150, align: 'center', fixed: 'right' as const,
      render: (_v, r) => (
        <Space size={2} wrap>
          {activeTab === 'review' && r.status === 'pending_review' && (<>
            <Button type="link" size="small" icon={<CheckOutlined />} style={{ color: '#52c41a' }}
              onClick={() => { setApproveTarget(r); const isDr = r.category === '保证金退回' || !!(r as any).brandAppKey; setApproveDebit((r as any).debitSubject || (isDr ? '其他应付款' : '')); setApproveCredit((r as any).creditSubject || '银行存款'); }}>通过</Button>
            <Button type="link" size="small" danger icon={<CloseOutlined />} onClick={() => { setRejectTarget(r); setRejectReason(''); }}>拒绝</Button>
          </>)}
          {activeTab === 'pay' && r.status === 'approved' && (
            <Button type="link" size="small" icon={<DollarOutlined />} onClick={() => { setPayTarget(r); setPayBankKey(''); setPayShot(''); load(); }}>支付</Button>
          )}
          {r.payScreenshot ? (
            <Image src={r.payScreenshot} width={28} height={28} style={{ objectFit: 'cover', borderRadius: 4 }} />
          ) : null}
          {r.status === 'rejected' && r.rejectReason ? <Text type="danger" style={{ fontSize: 11 }}>{r.rejectReason}</Text> : null}
        </Space>
      ),
    },
  ];

  const tableProps = {
    columns,
    rowKey: 'key' as const,
    size: 'small' as const,
    bordered: true,
    pagination: { pageSize: 15, showTotal: (t: number) => `共 ${t} 条` },
    scroll: { x: 1400 },
    locale: { emptyText: <Empty description="暂无记录" /> },
  };

  return (
    <div style={{ padding: 16 }}>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0, color: PRIMARY }}><WalletOutlined style={{ marginRight: 8 }} />收/付申请</Title>
        </div>
        <Tabs activeKey={activeTab} onChange={setActiveTab} tabBarExtraContent={activeTab === 'my' ? (
          <Space>
            <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }} onClick={() => { setReceiptFormAmount(null); setReceiptFormPayer(''); setReceiptFormDesc(''); setReceiptFormCustomerName(''); setReceiptFormCustomerId(''); setReceiptFormBankKey(''); setReceiptFormDebit('银行存款'); setReceiptFormCredit('其他应收款'); setReceiptModalVisible(true); }}>新增收款</Button>
            <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16' }} onClick={() => { resetApplyForm(); setApplyVisible(true); }}>申请付款</Button>
          </Space>
        ) : null} items={[
          { key: 'my', label: `我的申请 (${myRecords.length})`, children: <Table {...tableProps} dataSource={myRecords} /> },
          { key: 'receipt', label: <Badge count={receiptPendingRecords.length} size="small" offset={[8, 0]}><span>收款确认</span></Badge>,
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Text type="secondary">记录预期收款，到账后点击“确认到账”完成确认。已确认 {receiptConfirmedRecords.length} 笔。</Text>
                    {isAdmin && <Tooltip title={`负责人：${getManagerDisplayNames('receipt')}`}>
                      <Button size="small" icon={<SettingOutlined />} onClick={() => { setManagerSelectedUsers(tabManagers.receipt || []); setManagerModalTab('receipt'); }}>负责人设置</Button>
                    </Tooltip>}
                  </Space>

                </div>
                {isTabManager('receipt') ? (
                  <Table {...tableProps} columns={receiptColumns} dataSource={[...receiptPendingRecords, ...receiptConfirmedRecords]} scroll={{ x: 1100 }} />
                ) : (
                  <Empty description="您不是该模块的负责人，无法操作此页面" />
                )}
              </div>
            ),
          },
          { key: 'review', label: <Badge count={reviewRecords.length} size="small" offset={[8, 0]}><span>付款审核</span></Badge>,
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {isAdmin && <Tooltip title={`负责人：${getManagerDisplayNames('review')}`}>
                    <Button size="small" icon={<SettingOutlined />} onClick={() => { setManagerSelectedUsers(tabManagers.review || []); setManagerModalTab('review'); }}>负责人设置</Button>
                  </Tooltip>}
                </div>
                {isTabManager('review') ? (
                  <Table {...tableProps} dataSource={reviewRecords} />
                ) : (
                  <Empty description="您不是该模块的负责人，无法操作此页面" />
                )}
              </div>
            ),
          },
          { key: 'pay', label: <Badge count={payRecords.length} size="small" offset={[8, 0]}><span>待支付</span></Badge>,
            children: (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {isAdmin && <Tooltip title={`负责人：${getManagerDisplayNames('pay')}`}>
                    <Button size="small" icon={<SettingOutlined />} onClick={() => { setManagerSelectedUsers(tabManagers.pay || []); setManagerModalTab('pay'); }}>负责人设置</Button>
                  </Tooltip>}
                </div>
                {isTabManager('pay') ? (
                  <Table {...tableProps} dataSource={payRecords} />
                ) : (
                  <Empty description="您不是该模块的负责人，无法操作此页面" />
                )}
              </div>
            ),
          },
          { key: 'paid', label: `已支付 (${paidRecords.length})`, children: <Table {...tableProps} dataSource={paidRecords} /> },
        ]} />
      </Card>

      {/* ==================== 申请付款弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />申请付款</span>}
        open={applyVisible}
        onCancel={() => setApplyVisible(false)}
        onOk={handleApplySave}
        okText="提交申请"
        cancelText="取消"
        width={620}
        destroyOnClose
      >
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>申请金额 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="请输入金额"
              value={formAmount} onChange={v => setFormAmount(v === null ? null : v)} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款方式 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button style={{ flex: 1, background: formRecvType === 'bank' ? PRIMARY : undefined, borderColor: formRecvType === 'bank' ? PRIMARY : undefined, color: formRecvType === 'bank' ? '#fff' : undefined }}
                icon={<BankOutlined />} onClick={() => setFormRecvType('bank')}>银行账户</Button>
              <Button style={{ flex: 1, background: formRecvType === 'qrcode' ? '#722ed1' : undefined, borderColor: formRecvType === 'qrcode' ? '#722ed1' : undefined, color: formRecvType === 'qrcode' ? '#fff' : undefined }}
                onClick={() => setFormRecvType('qrcode')}>收款码</Button>
            </div>
          </Col>
        </Row>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>支出分类 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {EXPENSE_MAIN.map(g => (
              <Button key={g.name} size="small"
                style={formMainCat === g.name ? { background: '#fa8c16', borderColor: '#fa8c16', color: '#fff', fontWeight: 600 } : undefined}
                onClick={() => { setFormMainCat(formMainCat === g.name ? '' : g.name); setFormSubCat(''); }}>{g.name}</Button>
            ))}
          </div>
          {formMainCat && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(EXPENSE_MAIN.find(g => g.name === formMainCat)?.subs || []).map(s => (
                <Button key={s} size="small"
                  style={formSubCat === s ? { background: PRIMARY, borderColor: PRIMARY, color: '#fff', fontWeight: 600 } : undefined}
                  onClick={() => setFormSubCat(formSubCat === s ? '' : s)}>{s}</Button>
              ))}
            </div>
          )}
          {!formMainCat && <div style={{ fontSize: 12, color: '#999' }}>请先选择主分类</div>}
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>付款说明 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input.TextArea rows={2} placeholder="如：采购一批包装袋款项" value={formDesc} onChange={e => setFormDesc(e.target.value)} />
        </div>
        {formRecvType === 'bank' ? (
          <Row gutter={12}>
            <Col span={12}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款账户名称 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input placeholder="如：某供应商公司名/姓名" value={formRecvName} onChange={e => setFormRecvName(e.target.value)} />
            </Col>
            <Col span={12}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>银行账户 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input placeholder="银行卡号" value={formRecvAccount} onChange={e => setFormRecvAccount(e.target.value)} />
            </Col>
            <Col span={12} style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>开户银行</div>
              <Input placeholder="如：中国工商银行" value={formRecvBank} onChange={e => setFormRecvBank(e.target.value)} />
            </Col>
            <Col span={12} style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>支行名称</div>
              <Input placeholder="如：城东支行" value={formRecvBranch} onChange={e => setFormRecvBranch(e.target.value)} />
            </Col>
          </Row>
        ) : (
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款账户名称 <span style={{ color: '#ff4d4f' }}>*</span></div>
            <Input placeholder="如：我的支付宝" value={formRecvName} onChange={e => setFormRecvName(e.target.value)} style={{ marginBottom: 8 }} />
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>收款码图片 <span style={{ color: '#ff4d4f' }}>*</span></span>
              <Button size="small" icon={<SnippetsOutlined />} onClick={async () => {
                try {
                  const items = await navigator.clipboard.read();
                  for (const item of items) {
                    const imageType = item.types.find(t => t.startsWith('image/'));
                    if (imageType) {
                      const blob = await item.getType(imageType);
                      const reader = new FileReader();
                      reader.onload = (e) => setFormRecvQrcode(e.target?.result as string);
                      reader.readAsDataURL(blob);
                      message.success('已从剪切板粘贴图片');
                      return;
                    }
                  }
                  message.warning('剪切板中没有图片内容');
                } catch { message.warning('无法读取剪切板，请点击上传'); }
              }}>粘贴剪切板</Button>
            </div>
            {formRecvQrcode ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Image src={formRecvQrcode} width={130} height={130} style={{ objectFit: 'cover', borderRadius: 8 }} />
                <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => setFormRecvQrcode('')}
                  style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </div>
            ) : (
              <div style={{ width: 130, height: 130, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; input.accept = 'image/*';
                  input.onchange = (ev: any) => {
                    const file = ev.target?.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { message.warning('图片大小不能超过5MB'); return; }
                    const reader = new FileReader();
                    reader.onload = (e) => setFormRecvQrcode(e.target?.result as string);
                    reader.readAsDataURL(file);
                  };
                  input.click();
                }}>
                <div style={{ textAlign: 'center' }}>
                  <PictureOutlined style={{ fontSize: 20 }} />
                  <div style={{ fontSize: 11, marginTop: 4 }}>点击上传</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 12, color: '#999' }}>申请人：{getDisplayName()}（自动记录）；财务审核通过后由出纳支付</div>
        {isAccountingMode(getDataOwner()) && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>借方科目</div>
                <Select showSearch style={{ width: '100%' }} value={formDebit} onChange={v => setFormDebit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>贷方科目</div>
                <Select showSearch style={{ width: '100%' }} value={formCredit} onChange={v => setFormCredit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>说明与处理逻辑：借/贷科目随申请单保存（默认借：应付账款、贷：银行存款），审核通过且出纳支付后自动生成 2 条会计分录（摘要=付款说明）并在付款账户新增银行明细。仅「会计账薄」开关开启时生效。</div>
          </div>
        )}
      </Modal>

      {/* ==================== 拒绝弹窗 ==================== */}
      <Modal title="拒绝付款申请" open={!!rejectTarget} onCancel={() => setRejectTarget(null)} onOk={handleRejectConfirm} okText="确认拒绝" cancelText="取消" width={420}>
        <div style={{ marginBottom: 8, fontSize: 12, color: '#5a6d85' }}>拒绝原因 <span style={{ color: '#ff4d4f' }}>*</span></div>
        <Input.TextArea rows={3} placeholder="请输入拒绝原因" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
      </Modal>

      {/* ==================== 审核通过弹窗（会计账薄版本：申请详情 + 借/贷科目） ==================== */}
      <Modal
        title={<span style={{ color: '#52c41a' }}><CheckOutlined style={{ marginRight: 8 }} />通过付款申请</span>}
        open={!!approveTarget}
        onCancel={() => setApproveTarget(null)}
        onOk={handleApproveConfirm}
        okText="确认通过"
        cancelText="取消"
        width={560}
        destroyOnClose
        footer={[
          <Button key="reject" danger onClick={() => { const t = approveTarget; setApproveTarget(null); if (t) { setRejectTarget(t); setRejectReason(''); } }}>拒绝</Button>,
          <Button key="cancel" onClick={() => setApproveTarget(null)}>取消</Button>,
          <Button key="ok" type="primary" onClick={handleApproveConfirm}>确认通过</Button>,
        ]}
      >
        {approveTarget && (
          <div>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="申请编号">{approveTarget.requestNo}</Descriptions.Item>
              <Descriptions.Item label="申请金额"><Text strong style={{ color: PRIMARY }}>¥{Number(approveTarget.amount).toFixed(2)}</Text></Descriptions.Item>
              <Descriptions.Item label="分类">{approveTarget.category}</Descriptions.Item>
              <Descriptions.Item label="申请人">{approveTarget.applicantName}</Descriptions.Item>
              <Descriptions.Item label="付款说明" span={2}>{approveTarget.description}</Descriptions.Item>
              <Descriptions.Item label="收款方" span={2}>{approveTarget.recvAccountName}{approveTarget.recvBankAccount ? ` ${approveTarget.recvBankAccount}` : ''}</Descriptions.Item>
            </Descriptions>
            {isAccountingMode(getDataOwner()) && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>借方科目 <span style={{ color: '#ff4d4f' }}>*</span></div>
                    <Select showSearch allowClear style={{ width: '100%' }} placeholder="请选择借方科目（需审核人员设置）" value={approveDebit || undefined}
                      onChange={v => setApproveDebit(v || '')} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>贷方科目</div>
                    <Select showSearch style={{ width: '100%' }} value={approveCredit} onChange={v => setApproveCredit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
                  </div>
                </div>
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
                  说明与处理逻辑：贷方默认为银行存款，借方由审核人员手动设置（默认空白）；出纳支付后系统按此借/贷科目在「会计账薄-会计分录」生成 2 条分录，并将付款说明写入摘要，同时在付款账户的银行明细中新增一条支出明细。仅「会计账薄」开关开启时生效。
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ==================== 支付弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />出纳支付</span>}
        open={!!payTarget}
        onCancel={() => setPayTarget(null)}
        onOk={handlePayConfirm}
        okText="确认支付"
        cancelText="取消"
        width={560}
      >
        {payTarget && (
          <div>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="申请编号">{payTarget.requestNo}</Descriptions.Item>
              <Descriptions.Item label="申请金额"><Text strong style={{ color: '#ff4d4f' }}>¥{Number(payTarget.amount).toFixed(2)}</Text></Descriptions.Item>
              <Descriptions.Item label="支出分类" span={2}><Tag color="orange">{payTarget.category}</Tag></Descriptions.Item>
              <Descriptions.Item label="付款说明" span={2}>{payTarget.description}</Descriptions.Item>
              {payTarget.supplierName && <Descriptions.Item label="供应商" span={2}><Tag color="blue">{payTarget.supplierName}</Tag></Descriptions.Item>}
              <Descriptions.Item label="收款方式">{payTarget.recvType === 'bank' ? '银行账户' : '收款码'}</Descriptions.Item>
              <Descriptions.Item label="账户名称">{payTarget.recvAccountName}</Descriptions.Item>
              {payTarget.recvType === 'bank' ? (<>
                <Descriptions.Item label="开户银行">{payTarget.recvBankName || '—'}</Descriptions.Item>
                <Descriptions.Item label="支行名称">{payTarget.recvBranchName || '—'}</Descriptions.Item>
                <Descriptions.Item label="银行账户" span={2}><span style={{ fontFamily: 'monospace' }}>{payTarget.recvBankAccount || '—'}</span></Descriptions.Item>
              </>) : (
                <Descriptions.Item label="收款码" span={2}>{payTarget.recvQrcode ? <Image src={payTarget.recvQrcode} width={90} height={90} style={{ objectFit: 'cover' }} /> : '—'}</Descriptions.Item>
              )}
            </Descriptions>
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>选择付款账户 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Select style={{ width: '100%' }} value={payBankKey || undefined} placeholder="选择付款银行账户"
                showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                onChange={v => setPayBankKey(v)}
                options={bankAccounts.map((b: any) => ({ label: `${b.name} - ${b.bankName || ''} ${b.balance !== undefined ? `(余额 ¥${Number(b.balance).toFixed(2)})` : ''}`, value: b.key }))} />
            </div>
            <div>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>支付截图（可选）</span>
                <Button size="small" icon={<SnippetsOutlined />} onClick={async () => {
                  try {
                    const items = await navigator.clipboard.read();
                    for (const item of items) {
                      const imageType = item.types.find(t => t.startsWith('image/'));
                      if (imageType) {
                        const blob = await item.getType(imageType);
                        const reader = new FileReader();
                        reader.onload = (e) => setPayShot(e.target?.result as string);
                        reader.readAsDataURL(blob);
                        message.success('已从剪切板粘贴图片');
                        return;
                      }
                    }
                    message.warning('剪切板中没有图片内容');
                  } catch { message.warning('无法读取剪切板，请点击上传'); }
                }}>粘贴剪切板</Button>
              </div>
              {payShot ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <Image src={payShot} width={90} height={90} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => setPayShot('')}
                    style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
                </div>
              ) : (
                <div style={{ width: 90, height: 90, border: '2px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'image/*';
                    input.onchange = (ev: any) => {
                      const file = ev.target?.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (e) => setPayShot(e.target?.result as string);
                      reader.readAsDataURL(file);
                    };
                    input.click();
                  }}>
                  <div style={{ textAlign: 'center' }}>
                    <PictureOutlined style={{ fontSize: 18 }} />
                    <div style={{ fontSize: 10, marginTop: 2 }}>上传</div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: '#999' }}>支付后将写入日常记账（{payTarget.category}）、付款账户银行明细{payTarget.source === 'supplier' ? '与供应商已付货款明细' : ''}</div>
          </div>
        )}
      </Modal>

      {/* ==================== 新增收款弹窗 ==================== */}
      <Modal
        title={<span style={{ color: '#52c41a' }}><CheckCircleOutlined style={{ marginRight: 8 }} />新增收款确认</span>}
        open={receiptModalVisible}
        onCancel={() => setReceiptModalVisible(false)}
        onOk={handleAddReceipt}
        okText="添加"
        cancelText="取消"
        width={480}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>客户名称 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Select showSearch allowClear style={{ width: '100%' }} placeholder="选择或输入客户名称"
            value={receiptFormCustomerName || undefined}
            onChange={v => { setReceiptFormCustomerName(v || ''); setReceiptFormCustomerId(v || ''); }}
            options={customerOptions.map(c => ({ label: c.name, value: c.name }))}
            filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款金额 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="请输入预期收款金额"
            value={receiptFormAmount} onChange={v => setReceiptFormAmount(v === null ? null : v)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款银行账户</div>
          <Select style={{ width: '100%' }} value={receiptFormBankKey || undefined} placeholder="选择收款入账银行账户"
            showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            onChange={v => setReceiptFormBankKey(v)}
            options={bankAccounts.map((b: any) => ({ label: `${b.name} - ${b.bankName || ''} ${b.balance !== undefined ? `(余额 ¥${Number(b.balance).toFixed(2)})` : ''}`, value: b.key }))} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款说明</div>
          <Input.TextArea rows={2} placeholder="如：某某订单货款" value={receiptFormDesc} onChange={e => setReceiptFormDesc(e.target.value)} />
        </div>
        {isAccountingMode(getDataOwner()) && (
          <div style={{ padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>借方科目</div>
                <Select showSearch style={{ width: '100%' }} value={receiptFormDebit} onChange={v => setReceiptFormDebit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85', fontWeight: 700 }}>贷方科目</div>
                <Select showSearch style={{ width: '100%' }} value={receiptFormCredit} onChange={v => setReceiptFormCredit(v)} options={loadSubjectOptions(getDataOwner())} filterOption={subjectFilterOption} />
              </div>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>登记后状态为"待确认"，到账后点击"确认到账"将自动写入银行明细、客户已收货款{isAccountingMode(getDataOwner()) ? '及会计分录' : '及日常记账'}。</div>
      </Modal>

      {/* ==================== 确认到账弹窗 ==================== */}
      <Modal
        title={<span style={{ color: '#52c41a' }}><CheckCircleOutlined style={{ marginRight: 8 }} />确认收款到账</span>}
        open={!!confirmReceiptTarget}
        onCancel={() => { setConfirmReceiptTarget(null); setConfirmReceiptBankKey(''); }}
        onOk={() => confirmReceiptTarget && handleConfirmReceipt(confirmReceiptTarget)}
        okText="确认已到账"
        cancelText="取消"
        width={520}
      >
        {confirmReceiptTarget && (
          <div>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="收款编号">{confirmReceiptTarget.requestNo}</Descriptions.Item>
              <Descriptions.Item label="收款金额"><Text strong style={{ color: '#52c41a', fontSize: 16 }}>¥{Number(confirmReceiptTarget.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text></Descriptions.Item>
              <Descriptions.Item label="客户名称" span={2}>{confirmReceiptTarget.payerName || confirmReceiptTarget.recvAccountName}</Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>{confirmReceiptTarget.description}</Descriptions.Item>
              <Descriptions.Item label="登记日期">{confirmReceiptTarget.applyDate}</Descriptions.Item>
              <Descriptions.Item label="登记人">{confirmReceiptTarget.applicantName}</Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>收款入账银行账户 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Select style={{ width: '100%' }} value={confirmReceiptBankKey || undefined} placeholder="选择收款入账银行账户"
                showSearch filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                onChange={v => setConfirmReceiptBankKey(v)}
                options={bankAccounts.map((b: any) => ({ label: `${b.name} - ${b.bankName || ''} ${b.balance !== undefined ? `(余额 ¥${Number(b.balance).toFixed(2)})` : ''}`, value: b.key }))} />
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, fontSize: 12, color: '#389e0d', lineHeight: 1.8 }}>
              确认后系统将自动执行以下操作：<br />
              1. 在对应银行账户新增一条收入明细<br />
              2. 在客户「{confirmReceiptTarget.payerName}」已收货款中新增记录<br />
              {isAccountingMode(getDataOwner())
                ? '3. 在会计分录中新增 2 条记录（借：银行存款 / 贷：应收账款）'
                : '3. 在日常记账中新增一条收入记录'}<br />
              记账人/审核人：{confirmReceiptTarget.applicantName}，出纳：{getDisplayName()}
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== 负责人设置弹窗 ==================== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><SettingOutlined style={{ marginRight: 8 }} />负责人设置 — {managerModalTab === 'receipt' ? '收款确认' : managerModalTab === 'review' ? '付款审核' : '待支付'}</span>}
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

export default PaymentRequestPage;
