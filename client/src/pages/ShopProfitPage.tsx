import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Space, Tag, message, Typography, Modal, Input, InputNumber, DatePicker,
  Row, Col, Select, Popconfirm, Divider, Tooltip, Descriptions, Badge, Upload,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined, DollarOutlined,
  ShopOutlined, CalculatorOutlined, ReloadOutlined, FileExcelOutlined,
  WalletOutlined, InfoCircleOutlined, SearchOutlined, ClearOutlined, CheckCircleOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import useResizableColumns from '../hooks/useResizableColumns';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { reloadAfterPull } from '../utils/serverSync';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// ===================== 类型定义 =====================
interface ShopInfo {
  key: string;
  shopName: string;
  accountId: string;
  platform?: string;
  companyName?: string;
  person?: string;
  createdAt: string;
}

const PLATFORMS = [
  '淘宝', '天猫', '京东', '拼多多', '抖音', '抖音电商', '快手', '快手电商', '小红书',
  '唯品会', '得物', '苏宁易购', '美团', '饿了么', '1688', '闲鱼', '微店', '有赞', '微盟',
  '亚马逊', 'Shopee', 'Lazada', '速卖通', 'eBay', 'Wish', 'Temu', 'TikTok Shop',
  '微信视频号', '百度电商', '哔哩哔哩', 'SHEIN',
];

interface MonthEndRecord {
  key: string;
  shopId: string;
  shopName: string;
  calcMonth: string;
  currentBalance: number;
  pendingAmount: number;
  adFunds: number;
  deposit: number;
  image?: string;
  createdAt: string;
  updatedAt: string;
  inputBy: string;
}

interface ShipRecord {
  key: string;
  shopName: string;
  shopId: string;
  calcMonth: string;
  realOrders: number;
  realQty: number;
  realCost: number;
  realAmount: number;
  freightCost: number;
  returnCost: number;
  returnAmount: number;
  createdAt: string;
  updatedAt: string;
}

interface ReturnRecord {
  key: string;
  shopName: string;
  shopId: string;
  calcMonth: string;
  actualReceiptAmount: number;
  returnFee: number;
  payMonth: string;
}

interface WithdrawalRecord {
  key: string;
  shopId: string;
  shopName: string;
  amount: number;
  withdrawalDate: string;
  createdAt?: string;
  confirmed: boolean;
}

interface AdRecharge {
  key: string;
  date: string;
  amount: number;
  remark: string;
}

interface ProfitRecord {
  key: string;
  shopId: string;
  shopName: string;
  calcMonth: string;          // YYYY-MM
  currentBalance: number;     // 店铺剩余已到账资金
  pendingAmount: number;      // 待到账金额
  adFunds: number;            // 剩余推广费余额
  deposit: number;            // 保证金
  withdrawAmount: number;     // 本月提现金额
  shippingCost: number;       // 发货成本（聚水潭导入）
  realAmount: number;          // 实发金额（月末盘点 > 发货金额）
  refundAmount: number;       // 实退成本（按订单发货时间统计）
  refundAmountByConfirm: number; // 退货金额（按确认收货时间统计）
  returnFee: number;           // 退货费用（月末盘点 > 退货金额 > 退货费用之和，按支付月份匹配）
  taxPayable?: number;         // 应交税费（派生：（实发金额−退货金额）×店铺对应公司增值税税率）
  adRecharges: AdRecharge[];  // 充值推广费记录列表
  prevBalance: number;        // 上月已到账（快照）
  prevPending: number;        // 上月待到账（快照）
  prevDeposit: number;        // 上月保证金（快照）
  prevAdFunds: number;        // 上月剩余推广费（快照）
  manualAdjustment: number;   // 手动修正金额
  manualAdjustmentRemark: string;
  profit: number;             // 利润（系统计算）
  status: number;             // 0-草稿 1-已录入 2-已确认
  inputBy: string;
  inputAt: string;
  createdAt: string;
  updatedAt: string;
}

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

const fmt = (v: number | undefined | null) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const statusMap: Record<number, { text: string; color: string }> = {
  0: { text: '草稿', color: 'default' },
  1: { text: '已录入', color: 'processing' },
  2: { text: '已确认', color: 'success' },
};

/** 利润计算：使用实退成本 */
const calcProfit = (r: Partial<ProfitRecord>): number => {
  const curNet = (r.currentBalance || 0) + (r.pendingAmount || 0) + (r.adFunds || 0)
    + (r.withdrawAmount || 0) + (r.deposit || 0);
  const prevNet = (r.prevBalance || 0) + (r.prevPending || 0) + (r.prevDeposit || 0) + (r.prevAdFunds || 0);
  const totalRecharge = (r.adRecharges || []).reduce((s, x) => s + (x.amount || 0), 0);
  return Math.round((curNet - prevNet - (r.shippingCost || 0) + (r.refundAmount || 0) - (r.returnFee || 0) - (r.taxPayable || 0) - totalRecharge + (r.manualAdjustment || 0)) * 100) / 100;
};

/** 盘点差额计算：使用实发金额替换发货成本，使用退货金额（收货时间）替换实退成本 */
const calcInventoryDiff = (r: Partial<ProfitRecord>): number => {
  const curNet = (r.currentBalance || 0) + (r.pendingAmount || 0) + (r.adFunds || 0)
    + (r.withdrawAmount || 0) + (r.deposit || 0);
  const prevNet = (r.prevBalance || 0) + (r.prevPending || 0) + (r.prevDeposit || 0) + (r.prevAdFunds || 0);
  const totalRecharge = (r.adRecharges || []).reduce((s, x) => s + (x.amount || 0), 0);
  return Math.round((curNet - prevNet - (r.realAmount || 0) + (r.refundAmountByConfirm || 0) - totalRecharge + (r.manualAdjustment || 0)) * 100) / 100;
};

const emptyRecord = (shopId: string, shopName: string, calcMonth: string): ProfitRecord => ({
  key: `profit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  shopId, shopName, calcMonth,
  currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0, withdrawAmount: 0,
  shippingCost: 0, realAmount: 0, refundAmount: 0, refundAmountByConfirm: 0, returnFee: 0, adRecharges: [],
  prevBalance: 0, prevPending: 0, prevDeposit: 0, prevAdFunds: 0,
  manualAdjustment: 0, manualAdjustmentRemark: '',
  profit: 0, status: 0,
  inputBy: '', inputAt: '', createdAt: new Date().toLocaleString('zh-CN'), updatedAt: '',
});

import { scopeShops, canEditShopData } from '../utils/shopScope';

// ===================== 主组件 =====================
const ShopProfitPage: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const shopKey = `shop_info_${owner}`;
  const profitKey = `shop_profit_${owner}`;
  const checkKey = `month_end_check_${owner}`;
  const shipKey = `month_end_ship_${owner}`;
  const withdrawKey = `withdrawal_record_${owner}`;
  const rechargeRecordKey = `recharge_record_${owner}`;
  const returnKey = `month_end_return_${owner}`;

  const [shops, setShops] = useState<ShopInfo[]>([]);
  // 营业执照列表（取公司增值税税率）
  const licenses = useMemo(() => {
    try { const arr = JSON.parse(localStorage.getItem(`business_license_${owner}`) || '[]'); return Array.isArray(arr) ? arr : []; } catch { return []; }
  }, [owner]);
  // 应交税费 =（实发金额 − 退货金额（收货时间））× 店铺对应公司的增值税税率；公司未设税率时为 0
  const calcTaxPayable = useCallback((r: Partial<ProfitRecord>): number => {
    const shop = shops.find(s => s.key === r.shopId);
    const lic = licenses.find((l: any) => l.companyName && l.companyName === shop?.companyName);
    if (typeof lic?.vatRate !== 'number') return 0;
    return Math.round(((r.realAmount || 0) - (r.refundAmountByConfirm || 0)) * lic.vatRate) / 100;
  }, [shops, licenses]);
  const [records, setRecords] = useState<ProfitRecord[]>([]);
  const [monthEndRecords, setMonthEndRecords] = useState<MonthEndRecord[]>([]);
  const [shipRecords, setShipRecords] = useState<ShipRecord[]>([]);
  const [withdrawalRecords, setWithdrawalRecords] = useState<WithdrawalRecord[]>([]);
  const [extRechargeRecords, setExtRechargeRecords] = useState<any[]>([]);
  const [returnRecords, setReturnRecords] = useState<ReturnRecord[]>([]);
  const [filterShop, setFilterShop] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [searchPerson, setSearchPerson] = useState<string>('');
  const [searchPlatform, setSearchPlatform] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(20);
  // 已应用的筛选条件（点击查询后才生效）
  const [appliedFilterShop, setAppliedFilterShop] = useState<string>('');
  const [appliedFilterMonth, setAppliedFilterMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [appliedSearchPerson, setAppliedSearchPerson] = useState<string>('');
  const [appliedSearchPlatform, setAppliedSearchPlatform] = useState<string>('');
  const handleSearch = useCallback(() => {
    reloadAfterPull(reload); // 查询时自动刷新表单数据（本地+服务端拉取）
    setAppliedFilterShop(filterShop);
    setAppliedFilterMonth(filterMonth);
    setAppliedSearchPerson(searchPerson);
    setAppliedSearchPlatform(searchPlatform);
  }, [filterShop, filterMonth, searchPerson, searchPlatform]);
  const handleReset = useCallback(() => {
    setFilterShop('');
    setFilterMonth('');
    setSearchPerson('');
    setSearchPlatform('');
    setAppliedFilterShop('');
    setAppliedFilterMonth('');
    setAppliedSearchPerson('');
    setAppliedSearchPlatform('');
  }, []);

  // 店铺管理弹窗
  const [shopModalVisible, setShopModalVisible] = useState(false);
  const [editingShop, setEditingShop] = useState<ShopInfo | null>(null);
  const [shopFormName, setShopFormName] = useState('');
  const [shopFormId, setShopFormId] = useState('');

  // 记录编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<ProfitRecord | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // 充值推广费弹窗
  const [rechargeVisible, setRechargeVisible] = useState(false);
  const [rechargeTarget, setRechargeTarget] = useState<string>('');
  const [rechargeAmount, setRechargeAmount] = useState<number>(0);
  const [rechargeDate, setRechargeDate] = useState(dayjs());
  const [rechargeRemark, setRechargeRemark] = useState('');

  // 导入弹窗
  const [importVisible, setImportVisible] = useState(false);
  const [importData, setImportData] = useState<any[][]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importShipCol, setImportShipCol] = useState<number>(-1);
  const [importRefundCol, setImportRefundCol] = useState<number>(-1);
  const importFileRef = useRef<HTMLInputElement>(null);

  // ===================== 数据加载 =====================
  const reload = useCallback(() => {
    try { setShops(JSON.parse(localStorage.getItem(shopKey) || '[]')); } catch { setShops([]); }
    try { setRecords(JSON.parse(localStorage.getItem(profitKey) || '[]')); } catch { setRecords([]); }
    try { setMonthEndRecords(JSON.parse(localStorage.getItem(checkKey) || '[]')); } catch { setMonthEndRecords([]); }
    try { setShipRecords(JSON.parse(localStorage.getItem(shipKey) || '[]')); } catch { setShipRecords([]); }
    try { setWithdrawalRecords(JSON.parse(localStorage.getItem(withdrawKey) || '[]')); } catch { setWithdrawalRecords([]); }
    try { setExtRechargeRecords(JSON.parse(localStorage.getItem(rechargeRecordKey) || '[]')); } catch { setExtRechargeRecords([]); }
    try { setReturnRecords(JSON.parse(localStorage.getItem(returnKey) || '[]')); } catch { setReturnRecords([]); }
  }, [shopKey, profitKey, checkKey, shipKey, withdrawKey, rechargeRecordKey, returnKey]);
  useEffect(() => { reload(); }, [reload]);
  // 同步落地/窗口重新可见时重载：避免长期挂载页面拿陈旧店铺/利润快照整表回写，抹掉别端刚新增的记录
  useEffect(() => {
    const onSync = () => reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('sync-data-updated', onSync);
    window.addEventListener('focus', onSync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('sync-data-updated', onSync);
      window.removeEventListener('focus', onSync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  const saveShops = (list: ShopInfo[]) => {
    const json = JSON.stringify(list);
    safeSetItem(shopKey, json);
    safeSetItem(`${shopKey}_ts`, String(Date.now()));
    saveDataset(shopKey, json);
    setShops(list);
  };
  const saveRecords = (list: ProfitRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(profitKey, json);
    safeSetItem(`${profitKey}_ts`, String(Date.now()));
    saveDataset(profitKey, json);
    setRecords(list);
  };

  // ===================== 店铺 CRUD =====================
  const openShopModal = (shop?: ShopInfo) => {
    setEditingShop(shop || null);
    setShopFormName(shop?.shopName || '');
    setShopFormId(shop?.accountId || '');
    setShopModalVisible(true);
  };
  const handleSaveShop = () => {
    if (!shopFormName.trim()) { message.warning('请输入店铺名称'); return; }
    const list = [...shops];
    if (editingShop) {
      const idx = list.findIndex(s => s.key === editingShop.key);
      if (idx >= 0) { list[idx] = { ...list[idx], shopName: shopFormName.trim(), accountId: shopFormId.trim() }; }
    } else {
      list.push({ key: `shop-${Date.now()}`, shopName: shopFormName.trim(), accountId: shopFormId.trim(), createdAt: new Date().toLocaleString('zh-CN') });
    }
    saveShops(list);
    setShopModalVisible(false);
    message.success(editingShop ? '店铺已更新' : '店铺已添加');
  };
  const handleDeleteShop = (key: string) => {
    saveShops(shops.filter(s => s.key !== key));
    message.success('店铺已删除');
  };

  // ===================== 记录 CRUD =====================
  const openCreate = () => {
    if (shops.length === 0) { message.warning('请先添加店铺'); return; }
    const month = filterMonth || dayjs().format('YYYY-MM');
    const sid = filterShop || shops[0].key;
    const sname = shops.find(s => s.key === sid)?.shopName || '';
    const rec = emptyRecord(sid, sname, month);
    // 自动填充上月快照：优先从利润表记录，回退到月末盘点记录
    const prevMonth = dayjs(month + '-01').subtract(1, 'month').format('YYYY-MM');
    const prev = records.find(r => r.shopId === sid && r.calcMonth === prevMonth);
    const prevCheck = monthEndRecords.find(r => r.shopId === sid && r.calcMonth === prevMonth);
    const prevSrc = prev || prevCheck;
    if (prevSrc) {
      rec.prevBalance = prevSrc.currentBalance;
      rec.prevPending = prevSrc.pendingAmount;
      rec.prevDeposit = prevSrc.deposit;
      rec.prevAdFunds = prevSrc.adFunds;
    }
    rec.inputBy = localStorage.getItem('username') || '';
    setEditRecord(rec);
    setIsCreating(true);
    setEditVisible(true);
  };

  const openEdit = (rec: ProfitRecord) => {
    const updated = { ...rec };
    // 动态刷新上月快照：优先从利润表记录，回退到月末盘点记录
    const prevMonth = dayjs(rec.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
    const prev = records.find(r => r.shopId === rec.shopId && r.calcMonth === prevMonth);
    const prevCheck = monthEndRecords.find(r => r.shopId === rec.shopId && r.calcMonth === prevMonth);
    const prevSrc = prev || prevCheck;
    if (prevSrc) {
      updated.prevBalance = prevSrc.currentBalance;
      updated.prevPending = prevSrc.pendingAmount;
      updated.prevDeposit = prevSrc.deposit;
      updated.prevAdFunds = prevSrc.adFunds;
    }
    setEditRecord(updated);
    setIsCreating(false);
    setEditVisible(true);
  };

  const handleSaveRecord = () => {
    if (!editRecord) return;
    const profit = calcProfit(editRecord);
    const updated = { ...editRecord, profit, updatedAt: new Date().toLocaleString('zh-CN') };
    let list: ProfitRecord[];
    if (isCreating) {
      list = [updated, ...records];
    } else {
      list = records.map(r => r.key === updated.key ? updated : r);
    }
    saveRecords(list);
    setEditVisible(false);
    message.success(isCreating ? '记录已创建' : '记录已保存');
  };

  const handleDeleteRecord = (key: string) => {
    saveRecords(records.filter(r => r.key !== key));
    message.success('记录已删除');
  };

  const handleStatusChange = (key: string, status: number) => {
    // 检查记录是否已存在于 records 中
    const existing = records.find(r => r.key === key);
    if (existing) {
      // 已有记录，直接更新状态
      saveRecords(records.map(r => r.key === key ? { ...r, status, updatedAt: new Date().toLocaleString('zh-CN') } : r));
    } else {
      // 自动生成的记录（未保存），从 displayRecords 中找到并保存为新记录
      const displayRec = displayRecords.find(r => r.key === key);
      if (displayRec) {
        const newRec = { ...displayRec, status, updatedAt: new Date().toLocaleString('zh-CN') };
        saveRecords([newRec, ...records]);
      }
    }
    message.success(statusMap[status]?.text || '状态已更新');
  };

  // ===================== 修正字段行内编辑 =====================
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null);
  const [adjustingValue, setAdjustingValue] = useState<number>(0);
  const adjustingRef = useRef<any>(null);

  const startAdjust = (r: ProfitRecord) => {
    setAdjustingKey(r.key);
    setAdjustingValue(r.manualAdjustment || 0);
    setTimeout(() => adjustingRef.current?.focus(), 50);
  };
  const confirmAdjust = () => {
    if (!adjustingKey) return;
    saveRecords(records.map(r => r.key === adjustingKey ? { ...r, manualAdjustment: Number(adjustingValue) || 0, updatedAt: new Date().toLocaleString('zh-CN') } : r));
    setAdjustingKey(null);
    message.success('修正金额已更新');
  };

  // ===================== 充值推广费 =====================
  const openRecharge = (recordKey: string) => {
    setRechargeTarget(recordKey);
    setRechargeAmount(0);
    setRechargeDate(dayjs());
    setRechargeRemark('');
    setRechargeVisible(true);
  };
  const handleAddRecharge = () => {
    if (!rechargeAmount || rechargeAmount <= 0) { message.warning('请输入充值金额'); return; }
    const rec = records.find(r => r.key === rechargeTarget);
    if (!rec) return;
    const newRecharge: AdRecharge = {
      key: `recharge-${Date.now()}`,
      date: rechargeDate.format('YYYY-MM-DD'),
      amount: rechargeAmount,
      remark: rechargeRemark,
    };
    const updated = { ...rec, adRecharges: [...rec.adRecharges, newRecharge], updatedAt: new Date().toLocaleString('zh-CN') };
    updated.profit = calcProfit({ ...updated, taxPayable: calcTaxPayable(updated) });
    saveRecords(records.map(r => r.key === updated.key ? updated : r));
    setRechargeVisible(false);
    message.success('充值记录已添加');
  };

  // ===================== 聚水潭 Excel 导入 =====================
  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        if (data.length < 2) { message.warning('表格数据不足'); return; }
        setImportHeaders(data[0] as string[]);
        setImportData(data.slice(1) as any[][]);
        // 自动猜测列
        const hdrs = (data[0] as string[]).map(h => String(h || '').toLowerCase());
        const shipIdx = hdrs.findIndex(h => h.includes('发货') || h.includes('运费') || h.includes('物流'));
        const refundIdx = hdrs.findIndex(h => h.includes('退货') || h.includes('退款') || h.includes('售后'));
        setImportShipCol(shipIdx >= 0 ? shipIdx : -1);
        setImportRefundCol(refundIdx >= 0 ? refundIdx : -1);
        setImportVisible(true);
      } catch { message.error('Excel 解析失败，请检查文件格式'); }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleApplyImport = () => {
    if (importShipCol < 0 && importRefundCol < 0) { message.warning('请至少选择一个导入列'); return; }
    const targetRecord = editRecord;
    if (!targetRecord) { setImportVisible(false); return; }
    let totalShip = 0;
    let totalRefund = 0;
    importData.forEach(row => {
      if (importShipCol >= 0) totalShip += Number(row[importShipCol]) || 0;
      if (importRefundCol >= 0) totalRefund += Number(row[importRefundCol]) || 0;
    });
    const updated = { ...targetRecord, shippingCost: Math.round(totalShip * 100) / 100, refundAmount: Math.round(totalRefund * 100) / 100, refundAmountByConfirm: targetRecord.refundAmountByConfirm || 0 };
    updated.profit = calcProfit({ ...updated, taxPayable: calcTaxPayable(updated) });
    setEditRecord(updated);
    setImportVisible(false);
    message.success(`已导入：发货成本 ${fmt(totalShip)}，退货金额 ${fmt(totalRefund)}`);
  };

  // ===================== 自动生成所有店铺的月度记录 =====================
  const displayRecords = useMemo(() => {
    const month = appliedFilterMonth || dayjs().format('YYYY-MM');
    // 获取所有店铺，为每个店铺生成或查找记录
    const result: ProfitRecord[] = [];
    scopeShops(owner, shops).forEach(shop => {
      if (appliedFilterShop && shop.key !== appliedFilterShop) return;
      // 负责人筛选
      if (appliedSearchPerson.trim()) {
        const q = appliedSearchPerson.trim().toLowerCase();
        if (!(shop.person || '').toLowerCase().includes(q)) return;
      }
      // 所属平台筛选
      if (appliedSearchPlatform.trim()) {
        const q = appliedSearchPlatform.trim().toLowerCase();
        if (!(shop.platform || '').toLowerCase().includes(q)) return;
      }
      // 查找已有的记录
      let rec = records.find(r => r.shopId === shop.key && r.calcMonth === month);
      if (!rec) {
        // 自动生成空记录
        rec = emptyRecord(shop.key, shop.shopName, month);
        // 自动填充上月快照：优先从利润表记录，回退到月末盘点记录
        const prevMonth = dayjs(month + '-01').subtract(1, 'month').format('YYYY-MM');
        const prev = records.find(r => r.shopId === shop.key && r.calcMonth === prevMonth);
        const prevCheck = monthEndRecords.find(r => r.shopId === shop.key && r.calcMonth === prevMonth);
        const prevSrc = prev || prevCheck;
        if (prevSrc) {
          rec.prevBalance = prevSrc.currentBalance;
          rec.prevPending = prevSrc.pendingAmount;
          rec.prevDeposit = prevSrc.deposit;
          rec.prevAdFunds = prevSrc.adFunds;
        }
      }
      // 从月末盘点店铺资金获取本月数据
      const checkRec = monthEndRecords.find(r => r.shopId === shop.key && r.calcMonth === month);
      if (checkRec) {
        rec.currentBalance = checkRec.currentBalance;
        rec.pendingAmount = checkRec.pendingAmount;
        rec.adFunds = checkRec.adFunds;
        rec.deposit = checkRec.deposit;
      }
      // 从月末盘点发货金额获取发货总成本（实发成本 + 运费支出），优先按 shopId 匹配，回退按 shopName 匹配
      const shipRec = shipRecords.find(r => r.shopId === shop.key && r.calcMonth === month)
        || shipRecords.find(r => r.shopName === shop.shopName && r.calcMonth === month);
      if (shipRec) {
        rec.shippingCost = Math.round(((shipRec.realCost || 0) + (shipRec.freightCost || 0)) * 100) / 100;
        rec.realAmount = Math.round((shipRec.realAmount || 0) * 100) / 100;
        rec.refundAmount = Math.round((shipRec.returnCost || 0) * 100) / 100;
      }
      // 从月末盘点退货金额获取退货金额（收货时间）= 对应店铺+月份的“实际收货金额”总和
      const matchingReturns = returnRecords.filter(r =>
        (r.shopId === shop.key || r.shopName === shop.shopName) && r.calcMonth === month
      );
      rec.refundAmountByConfirm = Math.round(matchingReturns.reduce((s, r) => s + (r.actualReceiptAmount || 0), 0) * 100) / 100;
      // 从月末盘点退货金额获取退货费用 = 对应店铺+支付月份的“退货费用”总和
      const matchingReturnFees = returnRecords.filter(r =>
        (r.shopId === shop.key || r.shopName === shop.shopName) && (r.payMonth || r.calcMonth) === month
      );
      rec.returnFee = Math.round(matchingReturnFees.reduce((s, r) => s + (r.returnFee || 0), 0) * 100) / 100;
      // 从提现记录计算提现金额（已生效且提现日期在对应月份）
      const withdrawTotal = withdrawalRecords
        .filter(w => {
          if (w.shopId !== shop.key || !w.confirmed) return false;
          // 优先使用 withdrawalDate，如果不存在则回退到 createdAt
          const dateStr = w.withdrawalDate || w.createdAt || '';
          // 处理多种日期格式：YYYY-MM-DD 或 YYYY/MM/DD 或中文格式
          const normalized = dateStr.replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
          // 提取年月部分并匹配
          const yearMonth = normalized.substring(0, 7); // YYYY-MM
          return yearMonth === month;
        })
        .reduce((sum, w) => sum + (w.amount || 0), 0);
      rec.withdrawAmount = Math.round(withdrawTotal * 100) / 100;
      result.push(rec);
    });
    return result;
  }, [shops, records, monthEndRecords, shipRecords, returnRecords, withdrawalRecords, appliedFilterShop, appliedFilterMonth, appliedSearchPerson]);

  const totalRecharge = (recharges: AdRecharge[]) => recharges.reduce((s, x) => s + (x.amount || 0), 0);

  // 从充值记录中获取对应店铺+对应月份的充值推广费总和（按充值日期匹配，仅已支付）
  const getExtRechargeTotal = useCallback((shopId: string, calcMonth: string, shopName?: string): number => {
    return extRechargeRecords
      .filter((r: any) => {
        if (r.status !== 'paid' || !r.paidAt) return false;
        // 匹配店铺：shopId 或 shopName 任一匹配即可
        const matchShop = r.shopId === shopId || r.shopName === shopName || (shopName && r.shopName === shopId) || (r.shopName && r.shopName === shopId);
        if (!matchShop) return false;
        // 匹配月份：paidAt 前7位 === calcMonth (YYYY-MM)
        const paidMonth = String(r.paidAt).substring(0, 7);
        return paidMonth === calcMonth;
      })
      .reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
  }, [extRechargeRecords]);

  // 列宽拖拽调整
  const { wrapColumns } = useResizableColumns<ProfitRecord>(`colWidths_shopProfit_${owner}`);

  // 字段数据源提示图标
  const srcTip = (text: string) => <Tooltip title={`数据源：${text}`}><InfoCircleOutlined style={{ color: '#bbb', marginLeft: 4, fontSize: 12 }} /></Tooltip>;

  // ===================== 表格列 =====================
  const columns: ColumnsType<ProfitRecord> = [
    { title: <span>店铺{srcTip('店铺列表中的店铺名称')}</span>, dataIndex: 'shopName', key: 'shopName', width: 120, fixed: 'left', render: (v: string) => <Text strong>{v}</Text> },
    { title: <span>所属平台{srcTip('店铺列表中配置的平台信息')}</span>, key: 'platform', width: 100, align: 'center' as const,
      render: (_: any, r: ProfitRecord) => {
        const shop = shops.find(s => s.key === r.shopId);
        return shop?.platform ? <Tag>{shop.platform}</Tag> : <Text type="secondary">—</Text>;
      } },
    { title: <span>负责人{srcTip('店铺列表中配置的负责人')}</span>, key: 'person', width: 80, align: 'center' as const,
      render: (_: any, r: ProfitRecord) => {
        const shop = shops.find(s => s.key === r.shopId);
        return shop?.person ? <Tag>{shop.person}</Tag> : <Text type="secondary">—</Text>;
      } },
    { title: <span>月份{srcTip('手动选择或录入的月份')}</span>, dataIndex: 'calcMonth', key: 'calcMonth', width: 90, fixed: 'left' },
    {
      title: <span style={{ color: PRIMARY }}>本月数据</span>,
      children: [
        { title: <span>已到账{srcTip('月末盘点 > 店铺资金 > 已到账金额')}</span>, dataIndex: 'currentBalance', key: 'currentBalance', width: 100, align: 'right', render: (v: number) => fmt(v) },
        { title: <span>待到账{srcTip('月末盘点 > 店铺资金 > 待到账金额')}</span>, dataIndex: 'pendingAmount', key: 'pendingAmount', width: 100, align: 'right', render: (v: number) => <span style={{ color: '#52c41a' }}>+{fmt(v)}</span> },
        { title: <span>剩余推广费{srcTip('月末盘点 > 店铺资金 > 剩余推广费')}</span>, dataIndex: 'adFunds', key: 'adFunds', width: 100, align: 'right', render: (v: number) => <span style={{ color: '#52c41a' }}>+{fmt(v)}</span> },
        { title: <span>保证金{srcTip('月末盘点 > 店铺资金 > 保证金')}</span>, dataIndex: 'deposit', key: 'deposit', width: 90, align: 'right', render: (v: number) => <span style={{ color: '#52c41a' }}>+{fmt(v)}</span> },
        { title: <span>提现金额{srcTip('提现/充值记录中该店铺该月份已确认的提现总额')}</span>, dataIndex: 'withdrawAmount', key: 'withdrawAmount', width: 100, align: 'right',
          render: (v: number) => <Tag color="red" style={{ fontWeight: 600 }}>{fmt(v)}</Tag> },
      ],
    },
    {
      title: <span style={{ color: '#fa8c16' }}>发货退货</span>,
      children: [
        { title: <span>发货成本{srcTip('月末盘点 > 发货金额 > 发货总成本（实发成本 + 运费支出）')}</span>, dataIndex: 'shippingCost', key: 'shippingCost', width: 100, align: 'right', render: (v: number) => fmt(v) },
        { title: <span>实发金额{srcTip('月末盘点 > 发货金额 > 实发金额')}</span>, dataIndex: 'realAmount', key: 'realAmount', width: 100, align: 'right', render: (v: number) => <span style={{ color: '#52c41a' }}>{fmt(v)}</span> },
        { title: <span>实退成本{srcTip('数据来源：月末盘点 > 发货金额 > 实退成本。导入时按照发货时间筛选店铺的数据，计算利润尽量在第二个月15号左右进行计算，比如筛选这笔订单9月份发货的，10月份退款的也会计算在内')}</span>, dataIndex: 'refundAmount', key: 'refundAmount', width: 100, align: 'right', render: (v: number) => <span style={{ color: '#52c41a' }}>+{fmt(v)}</span> },
        { title: <span>退货金额（收货时间）{srcTip('数据来源：月末盘点 > 退货金额 > 实际收货金额（对应店铺对应月份的数据总和）')}</span>, dataIndex: 'refundAmountByConfirm', key: 'refundAmountByConfirm', width: 120, align: 'right', render: (v: number) => <span style={{ color: '#52c41a' }}>+{fmt(v)}</span> },
        { title: <span>充值推广费{srcTip('充值推广费记录中该店铺该月份已支付的充值总额')}</span>, key: 'totalRecharge', width: 120, align: 'right',
          render: (_: any, r: ProfitRecord) => {
            const extTotal = getExtRechargeTotal(r.shopId, r.calcMonth, r.shopName);
            const t = extTotal > 0 ? extTotal : totalRecharge(r.adRecharges);
            return <span style={{ color: '#ff4d4f', cursor: 'pointer' }} onClick={() => openRecharge(r.key)}>−{fmt(t)} {r.adRecharges.length > 0 && <Badge count={r.adRecharges.length} size="small" style={{ marginLeft: 2 }} />}</span>;
          },
        },
      ],
    },
    {
      title: <span style={{ color: '#c0392b' }}>费用</span>,
      children: [
        { title: <span>退货费用{srcTip('数据来源：月末盘点 > 退货金额 > 退货费用（对应店铺 + 支付月份匹配的数据总和）')}</span>, dataIndex: 'returnFee', key: 'returnFee', width: 100, align: 'right', render: (v: number) => <span style={{ color: '#ff4d4f' }}>−{fmt(v)}</span> },
        { title: <span>应交税费{srcTip('自动计算：（实发金额 − 退货金额（收货时间））× 店铺对应公司的增值税税率（营业执照列表字段）；计算利润时扣除')}</span>, key: 'taxPayable', width: 110, align: 'right',
          render: (_: any, r: ProfitRecord) => {
            const shop = shops.find(s => s.key === r.shopId);
            const lic = licenses.find((l: any) => l.companyName && l.companyName === shop?.companyName);
            if (typeof lic?.vatRate !== 'number') return <Text type="secondary">—</Text>;
            return <span style={{ color: '#ff4d4f' }}>−{fmt(calcTaxPayable(r))}</span>;
          } },
      ],
    },
    {
      title: <span style={{ color: '#722ed1' }}>上月快照</span>,
      children: [
        { title: <span>已到账{srcTip('上月利润表或月末盘点的自动快照')}</span>, key: 'prevBalance', width: 90, align: 'right',
          render: (_: any, r: ProfitRecord) => { const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM'); const p = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm); return <Text type="secondary">{p ? fmt(p.currentBalance) : fmt(r.prevBalance)}</Text>; } },
        { title: <span>待到账{srcTip('上月利润表或月末盘点的自动快照')}</span>, key: 'prevPending', width: 90, align: 'right',
          render: (_: any, r: ProfitRecord) => { const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM'); const p = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm); return <Text type="secondary">{p ? fmt(p.pendingAmount) : fmt(r.prevPending)}</Text>; } },
        { title: <span>保证金{srcTip('上月利润表或月末盘点的自动快照')}</span>, key: 'prevDeposit', width: 90, align: 'right',
          render: (_: any, r: ProfitRecord) => { const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM'); const p = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm); return <Text type="secondary">{p ? fmt(p.deposit) : fmt(r.prevDeposit)}</Text>; } },
        { title: <span>剩余推广费{srcTip('上月利润表或月末盘点的自动快照')}</span>, key: 'prevAdFunds', width: 100, align: 'right',
          render: (_: any, r: ProfitRecord) => { const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM'); const p = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm); return <Text type="secondary">{p ? fmt(p.adFunds) : fmt(r.prevAdFunds)}</Text>; } },
      ],
    },
    { title: <span>修正{srcTip('点击单元格可手动输入修正金额')}</span>, dataIndex: 'manualAdjustment', key: 'manualAdjustment', width: 100, align: 'right',
      render: (v: number, r: ProfitRecord) => {
        if (adjustingKey === r.key) {
          return (
            <Space size={4}>
              <InputNumber ref={adjustingRef} size="small" style={{ width: 72 }} value={adjustingValue} onChange={val => setAdjustingValue(Number(val) || 0)}
                onPressEnter={confirmAdjust} controls={false} />
              <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} onClick={confirmAdjust} />
            </Space>
          );
        }
        return (
          <div onClick={() => startAdjust(r)} style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 4, border: '1px dashed transparent', transition: 'all 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.border = '1px dashed #bbb')}
            onMouseLeave={e => (e.currentTarget.style.border = '1px dashed transparent')}>
            {v ? <Tag color={v > 0 ? 'green' : 'red'}>{v > 0 ? '+' : ''}{fmt(v)}</Tag> : <Text type="secondary" style={{ fontSize: 12 }}>点击输入</Text>}
          </div>
        );
      } },
    { title: <span>利润{srcTip('系统自动计算：本月净资产 − 上月净资产 − 发货成本 + 实退成本 − 退货费用 − 应交税费 − 充值推广费 ± 修正')}</span>, key: 'profit', width: 120, align: 'right', fixed: 'right',
      render: (_: any, r: ProfitRecord) => {
        const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
        const prev = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm);
        const dynR = prev ? { ...r, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds } : r;
        const extTotal = getExtRechargeTotal(r.shopId, r.calcMonth, r.shopName);
        const profitR0 = extTotal > 0 ? { ...dynR, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : dynR;
        const profitR = { ...profitR0, taxPayable: calcTaxPayable(profitR0) };
        const p = calcProfit(profitR);
        return <Text strong style={{ fontSize: 15, color: p >= 0 ? '#52c41a' : '#ff4d4f' }}>{p >= 0 ? '+' : ''}{fmt(p)}</Text>;
      },
    },
    { title: <span>盘点差额{srcTip('系统自动计算：本月净资产 − 上月净资产 − 实发金额 + 退货金额（收货时间）− 充值推广费 ± 修正')}</span>, key: 'inventoryDiff', width: 120, align: 'right', fixed: 'right',
      render: (_: any, r: ProfitRecord) => {
        const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
        const prev = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm);
        const dynR = prev ? { ...r, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds } : r;
        const extTotal = getExtRechargeTotal(r.shopId, r.calcMonth, r.shopName);
        const profitR = extTotal > 0 ? { ...dynR, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : dynR;
        const d = calcInventoryDiff(profitR);
        return <Text strong style={{ fontSize: 15, color: d >= 0 ? '#1890ff' : '#ff4d4f' }}>{d >= 0 ? '+' : ''}{fmt(d)}</Text>;
      },
    },
    { title: <span>状态{srcTip('单据当前状态：草稿 / 已确认')}</span>, dataIndex: 'status', key: 'status', width: 80, align: 'center', fixed: 'right',
      render: (v: number) => <Tag color={statusMap[v]?.color} style={v === 2 ? { background: '#f6ffed', borderColor: '#b7eb8f', color: '#389e0d' } : {}}>{statusMap[v]?.text || '未知'}</Tag> },
    { title: '操作', key: 'action', width: 120, fixed: 'right',
      render: (_: any, r: ProfitRecord) => {
        const editable = canEditShopData(owner, shops.find(s => s.key === r.shopId || s.shopName === r.shopName)?.person, r.inputBy);
        return (
        <Space size="small">
          {r.status < 2 && (
            <Popconfirm title="确认此条记录？" onConfirm={() => handleStatusChange(r.key, 2)} okText="确认" cancelText="取消" disabled={!editable}>
              <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }} disabled={!editable}>确认</Button>
            </Popconfirm>
          )}
          {r.status >= 2 && (
            <Popconfirm title="撤回确认？" onConfirm={() => handleStatusChange(r.key, 0)} okText="确认" cancelText="取消" disabled={!editable}>
              <Button type="link" size="small" icon={<UndoOutlined />} style={{ color: '#fa8c16' }} disabled={!editable}>撤回</Button>
            </Popconfirm>
          )}
        </Space>
        );
      },
    },
  ];

  // ===================== 更新编辑记录字段 =====================
  const updateField = (field: keyof ProfitRecord, value: any) => {
    if (!editRecord) return;
    const updated = { ...editRecord, [field]: value };
    // 店铺变更时同步 shopName
    if (field === 'shopId') {
      updated.shopName = shops.find(s => s.key === value)?.shopName || '';
    }
    updated.profit = calcProfit({ ...updated, taxPayable: calcTaxPayable(updated) });
    setEditRecord(updated);
  };

  // ===================== 渲染 =====================
  return (
    <div style={{ padding: 0 }}>
      {/* 顶部标题和工具栏 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <CalculatorOutlined style={{ fontSize: 22, color: PRIMARY }} />
              <Title level={4} style={{ margin: 0, color: PRIMARY }}>月利润表</Title>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              <Select allowClear showSearch placeholder="选择店铺" style={{ width: 160 }} value={filterShop || undefined}
                onChange={v => setFilterShop(v || '')}
                filterOption={(input, option) =>
                  String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
                }
                options={shops.map(s => ({ value: s.key, label: s.shopName }))} />
              <DatePicker picker="month" placeholder="选择月份" value={filterMonth ? dayjs(filterMonth + '-01') : undefined}
                onChange={v => setFilterMonth(v ? v.format('YYYY-MM') : '')} style={{ width: 140 }} />
              <Input placeholder="负责人" value={searchPerson} onChange={e => setSearchPerson(e.target.value)}
                onPressEnter={handleSearch} allowClear style={{ width: 120 }} />
              <Select allowClear showSearch placeholder="所属平台" style={{ width: 140 }} value={searchPlatform || undefined}
                onChange={v => setSearchPlatform(v || '')}
                filterOption={(input, option) =>
                  String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
                }
                options={PLATFORMS.map(p => ({ value: p, label: p }))} />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} style={{ color: '#fff' }}>查询</Button>
              <Button icon={<ClearOutlined />} onClick={handleReset}>重置</Button>
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 主表格 */}
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <style>{`
          .profit-table .ant-table-cell { white-space: normal !important; word-break: break-all; overflow-wrap: anywhere; }
        `}</style>
        <div className="profit-table">
        <Table<ProfitRecord>
          bordered
          columns={wrapColumns(columns)}
          dataSource={displayRecords}
          rowKey="key"
          scroll={{ x: 1760, y: 'calc(100vh - 380px)' }}
          pagination={{ pageSize: pageSize, showSizeChanger: true, onShowSizeChange: (current, size) => setPageSize(size), showTotal: t => `共 ${t} 条` }}
          size="middle"
          locale={{ emptyText: '暂无记录' }}
          summary={() => {
            if (displayRecords.length === 0) return null;
            const sum = (field: keyof ProfitRecord) => displayRecords.reduce((s, r) => s + (Number(r[field]) || 0), 0);
            const sumRecharge = displayRecords.reduce((s, r) => {
              const extTotal = getExtRechargeTotal(r.shopId, r.calcMonth, r.shopName);
              return s + (extTotal > 0 ? extTotal : totalRecharge(r.adRecharges));
            }, 0);
            const totalProfit = displayRecords.reduce((s: number, r: ProfitRecord) => {
              const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
              const prev = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm);
              const dynR = prev ? { ...r, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds } : r;
              const extTotal = getExtRechargeTotal(r.shopId, r.calcMonth, r.shopName);
              const profitR0 = extTotal > 0 ? { ...dynR, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : dynR;
              const profitR = { ...profitR0, taxPayable: calcTaxPayable(profitR0) };
              return s + calcProfit(profitR);
            }, 0);
            const sumStyle: React.CSSProperties = { fontWeight: 600, fontSize: 12 };
            const sumReturnFee = sum('returnFee');
            const sumTax = displayRecords.reduce((s, r) => s + calcTaxPayable(r), 0);
            const sumManualAdj = sum('manualAdjustment');
            return (
              <Table.Summary.Row style={{ background: '#fafafa' }}>
                <Table.Summary.Cell index={0} colSpan={4} align="right">
                  <Text strong style={{ fontSize: 13 }}>合计</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <Text style={sumStyle}>{fmt(sum('currentBalance'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <Text style={{ ...sumStyle, color: '#52c41a' }}>+{fmt(sum('pendingAmount'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  <Text style={{ ...sumStyle, color: '#52c41a' }}>+{fmt(sum('adFunds'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">
                  <Text style={{ ...sumStyle, color: '#52c41a' }}>+{fmt(sum('deposit'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right">
                  <Tag color="red" style={{ fontWeight: 600 }}>{fmt(sum('withdrawAmount'))}</Tag>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} align="right">
                  <Text style={sumStyle}>{fmt(sum('shippingCost'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={10} align="right">
                  <Text style={{ ...sumStyle, color: '#52c41a' }}>{fmt(sum('realAmount'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={11} align="right">
                  <Text style={{ ...sumStyle, color: '#52c41a' }}>+{fmt(sum('refundAmount'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={12} align="right">
                  <Text style={{ ...sumStyle, color: '#52c41a' }}>+{fmt(sum('refundAmountByConfirm'))}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={13} align="right">
                  <Text style={{ ...sumStyle, color: '#ff4d4f' }}>−{fmt(sumRecharge)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={14} align="right">
                  <Text style={{ ...sumStyle, color: '#ff4d4f' }}>−{fmt(sumReturnFee)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={15} align="right">
                  <Text style={{ ...sumStyle, color: '#ff4d4f' }}>−{fmt(sumTax)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={16} colSpan={4} />
                <Table.Summary.Cell index={20} align="right">
                  <Text style={sumStyle}>{sumManualAdj ? (sumManualAdj > 0 ? '+' : '') + fmt(sumManualAdj) : '—'}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={21} align="right">
                  <Text strong style={{ fontSize: 15, color: totalProfit >= 0 ? '#52c41a' : '#ff4d4f' }}>
                    {totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={22} align="right">
                  {(() => {
                    const totalInvDiff = displayRecords.reduce((s: number, r: ProfitRecord) => {
                      const pm = dayjs(r.calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
                      const prev = records.find(x => x.shopId === r.shopId && x.calcMonth === pm) || monthEndRecords.find(x => x.shopId === r.shopId && x.calcMonth === pm);
                      const dynR = prev ? { ...r, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds } : r;
                      const extTotal = getExtRechargeTotal(r.shopId, r.calcMonth, r.shopName);
                      const profitR = extTotal > 0 ? { ...dynR, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : dynR;
                      return s + calcInventoryDiff(profitR);
                    }, 0);
                    return <Text strong style={{ fontSize: 15, color: totalInvDiff >= 0 ? '#1890ff' : '#ff4d4f' }}>{totalInvDiff >= 0 ? '+' : ''}{fmt(totalInvDiff)}</Text>;
                  })()}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={23} colSpan={2} />
              </Table.Summary.Row>
            );
          }}
        />
        </div>
      </Card>

      {/* 利润计算公式说明 */}
      <div style={{
        marginTop: 16, padding: '12px 20px', background: '#f6f8fa',
        borderRadius: 8, border: '1px solid #e8e8e8',
      }}>
        <Text strong style={{ fontSize: 13, color: '#1e4a7e' }}>
          <InfoCircleOutlined style={{ marginRight: 6 }} />
          利润计算公式
        </Text>
        <div style={{ marginTop: 8, fontSize: 13, color: '#555', lineHeight: '22px' }}>
          <div style={{ marginBottom: 4 }}>
            <Text strong>本月净资产</Text> = 已到账 + 待到账 + 剩余推广费 + 提现金额 + 保证金
          </div>
          <div style={{ marginBottom: 4 }}>
            <Text strong>上月净资产</Text> = 上月已到账 + 上月待到账 + 上月保证金 + 上月剩余推广费
          </div>
          <div style={{ marginBottom: 4 }}>
            <Text strong>充值推广费合计</Text> = 本月所有充值推广费金额之和
          </div>
          <div style={{
            marginTop: 8, padding: '8px 12px', background: '#fff', borderRadius: 6,
            border: '1px solid #d9d9d9', fontWeight: 600, fontSize: 14, color: '#1e4a7e',
          }}>
            利润 = 本月净资产 − 上月净资产 − 发货成本 + 实退成本 − 退货费用 − 应交税费 − 充值推广费合计 ± 手动调整
          </div>
          <div style={{
            marginTop: 8, padding: '8px 12px', background: '#fff', borderRadius: 6,
            border: '1px solid #d9d9d9', fontWeight: 600, fontSize: 14, color: '#1890ff',
          }}>
            盘点差额 = 本月净资产 − 上月净资产 − 实发金额 + 退货金额（收货时间）− 充值推广费合计 ± 手动调整
          </div>
        </div>
      </div>
      <Modal title="店铺管理" open={shopModalVisible} onCancel={() => setShopModalVisible(false)} onOk={handleSaveShop}
        okText={editingShop ? '保存' : '添加'} cancelText="取消" width={520}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}><Text>店铺名称 <Text type="danger">*</Text></Text></div>
          <Input value={shopFormName} onChange={e => setShopFormName(e.target.value)} placeholder="如：天猫旗舰店" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}><Text>ERP店铺ID</Text></div>
          <Input value={shopFormId} onChange={e => setShopFormId(e.target.value)} placeholder="聚水潭/ERP中的店铺标识（选填）" />
        </div>
        <Divider style={{ margin: '12px 0' }} />
        <div style={{ maxHeight: 240, overflow: 'auto' }}>
          {shops.map(s => (
            <Row key={s.key} justify="space-between" align="middle" style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <Col><Text strong>{s.shopName}</Text> {s.accountId && <Text type="secondary">({s.accountId})</Text>}</Col>
              <Col>
                <Space>
                  <Button type="link" size="small" onClick={() => openShopModal(s)}>编辑</Button>
                  <Popconfirm title="确认删除？" onConfirm={() => handleDeleteShop(s.key)} okText="确认" cancelText="取消">
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              </Col>
            </Row>
          ))}
          {shops.length === 0 && <Text type="secondary">暂无店铺，请在上方添加</Text>}
        </div>
      </Modal>

      {/* ========= 新增/编辑记录弹窗 ========= */}
      <Modal title={isCreating ? '新增月度利润记录' : '编辑月度利润记录'} open={editVisible} onCancel={() => setEditVisible(false)}
        onOk={handleSaveRecord} okText="保存" cancelText="取消" width={780}>
        {editRecord && (
          <div>
            {/* 基本信息 */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>店铺 <Text type="danger">*</Text></Text>
                <Select value={editRecord.shopId} onChange={v => updateField('shopId', v)} style={{ width: '100%' }}
                  options={shops.map(s => ({ value: s.key, label: s.shopName }))} />
              </Col>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>计算月份 <Text type="danger">*</Text></Text>
                <DatePicker picker="month" value={editRecord.calcMonth ? dayjs(editRecord.calcMonth + '-01') : undefined}
                  onChange={v => updateField('calcMonth', v ? v.format('YYYY-MM') : '')} style={{ width: '100%' }} />
              </Col>
            </Row>

            {/* 本月数据 */}
            <Card size="small" title={<span><DollarOutlined style={{ marginRight: 6 }} />本月数据（手动填写）</span>} style={{ marginBottom: 12 }}>
              <Row gutter={[12, 12]}>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>已到账资金</Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.currentBalance} onChange={v => updateField('currentBalance', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>待到账金额</Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.pendingAmount} onChange={v => updateField('pendingAmount', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>剩余推广费</Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.adFunds} onChange={v => updateField('adFunds', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>保证金</Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.deposit} onChange={v => updateField('deposit', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#c00', fontWeight: 600 }}>本月提现金额</Text>
                  <InputNumber style={{ width: '100%', borderColor: '#ff4d4f' }} value={editRecord.withdrawAmount} onChange={v => updateField('withdrawAmount', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
              </Row>
            </Card>

            {/* 发货退货 */}
            <Card size="small" title={<span><FileExcelOutlined style={{ marginRight: 6 }} />本月发货和退货</span>}
              extra={<Button type="link" size="small" icon={<ImportOutlined />} onClick={() => setImportVisible(true)}>从聚水潭导入</Button>}>
              <Row gutter={[12, 12]}>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>发货成本</Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.shippingCost} onChange={v => updateField('shippingCost', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={8}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>实发金额 <Tooltip title="月末盘点 > 发货金额 > 实发金额"><InfoCircleOutlined style={{ color: '#999', marginLeft: 2 }} /></Tooltip></Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.realAmount} onChange={v => updateField('realAmount', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>实退成本 <Tooltip title="数据来源：月末盘点 > 发货金额 > 实退成本。导入时按照发货时间筛选店铺的数据，计算利润尽量在第二个月15号左右进行计算，比如筛选这笔订单9月份发货的，10月份退款的也会计算在内"><InfoCircleOutlined style={{ color: '#999', marginLeft: 2 }} /></Tooltip></Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.refundAmount} onChange={v => updateField('refundAmount', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>退货费用 <Tooltip title="数据来源：月末盘点 > 退货金额 > 退货费用（对应店铺 + 支付月份匹配的数据总和）"><InfoCircleOutlined style={{ color: '#999', marginLeft: 2 }} /></Tooltip></Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.returnFee} onChange={v => updateField('returnFee', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>退货金额（收货时间） <Tooltip title="数据来源：月末盘点 > 退货金额 > 实际收货金额（对应店铺对应月份的数据总和）"><InfoCircleOutlined style={{ color: '#999', marginLeft: 2 }} /></Tooltip></Text>
                  <InputNumber style={{ width: '100%' }} value={editRecord.refundAmountByConfirm} onChange={v => updateField('refundAmountByConfirm', v || 0)} controls={false} precision={2} prefix="¥" /></Col>
                <Col span={8}>
                  <Text style={{ display: 'block', fontSize: 12, color: '#888' }}>充值推广费（总和）</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong style={{ color: '#ff4d4f', fontSize: 16 }}>¥{fmt(totalRecharge(editRecord.adRecharges))}</Text>
                    <Button type="link" size="small" onClick={() => openRecharge(editRecord!.key)}>管理充值</Button>
                  </div>
                </Col>
              </Row>
            </Card>

            {/* 上月快照 */}
            <Card size="small" title={<span style={{ color: '#722ed1' }}>上月数据（自动快照）</span>} style={{ marginBottom: 12, marginTop: 12, background: '#faf5ff' }}>
              <Row gutter={[12, 12]}>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>已到账资金</Text>
                  <Text strong style={{ fontSize: 16 }}>{fmt(editRecord.prevBalance)}</Text></Col>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>待到账</Text>
                  <Text strong style={{ fontSize: 16 }}>{fmt(editRecord.prevPending)}</Text></Col>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>保证金</Text>
                  <Text strong style={{ fontSize: 16 }}>{fmt(editRecord.prevDeposit)}</Text></Col>
                <Col span={6}><Text style={{ display: 'block', fontSize: 12, color: '#888' }}>剩余推广费</Text>
                  <Text strong style={{ fontSize: 16 }}>{fmt(editRecord.prevAdFunds)}</Text></Col>
              </Row>
            </Card>

            {/* 修正 */}
            <Row gutter={16} style={{ marginBottom: 12, marginTop: 12 }}>
              <Col span={8}>
                <Text style={{ display: 'block', marginBottom: 4 }}>手动修正金额（选填）</Text>
                <InputNumber style={{ width: '100%' }} value={editRecord.manualAdjustment} onChange={v => updateField('manualAdjustment', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={16}>
                <Text style={{ display: 'block', marginBottom: 4 }}>修正原因备注</Text>
                <Input value={editRecord.manualAdjustmentRemark} onChange={e => updateField('manualAdjustmentRemark', e.target.value)} placeholder="选填" />
              </Col>
            </Row>

            {/* 利润计算结果 */}
            <Card style={{ background: '#e6f7ff', border: '2px solid #1890ff', textAlign: 'center' }}>
              <Text style={{ fontSize: 14, color: '#666' }}>利润（系统自动计算）</Text>
              <div style={{ fontSize: 28, fontWeight: 700, color: editRecord.profit >= 0 ? '#52c41a' : '#ff4d4f', marginTop: 4 }}>
                {editRecord.profit >= 0 ? '+' : ''}{fmt(editRecord.profit)}
              </div>
              <Tooltip title="利润 = 本月净余额 − 上月净余额 − 发货成本 + 实退成本 − 充值推广费 + 修正">
                <Text type="secondary" style={{ fontSize: 11, cursor: 'help' }}><InfoCircleOutlined /> 利润公式说明</Text>
              </Tooltip>
            </Card>

            {/* 盘点差额计算结果 */}
            <Card style={{ background: '#e6f7ff', border: '2px solid #1890ff', textAlign: 'center', marginTop: 8 }}>
              <Text style={{ fontSize: 14, color: '#666' }}>盘点差额（系统自动计算）</Text>
              <div style={{ fontSize: 28, fontWeight: 700, color: calcInventoryDiff(editRecord) >= 0 ? '#1890ff' : '#ff4d4f', marginTop: 4 }}>
                {calcInventoryDiff(editRecord) >= 0 ? '+' : ''}{fmt(calcInventoryDiff(editRecord))}
              </div>
              <Tooltip title="盘点差额 = 本月净余额 − 上月净余额 − 实发金额 + 退货金额（收货时间）− 充值推广费 + 修正">
                <Text type="secondary" style={{ fontSize: 11, cursor: 'help' }}><InfoCircleOutlined /> 盘点差额公式说明</Text>
              </Tooltip>
            </Card>
          </div>
        )}
      </Modal>

      {/* ========= 聚水潭导入弹窗 ========= */}
      <Modal title="导入聚水潭数据" open={importVisible} onCancel={() => setImportVisible(false)} onOk={handleApplyImport}
        okText="应用导入" cancelText="取消" width={640}>
        <div style={{ marginBottom: 12 }}>
          <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={(file) => { handleImportFile(file); return false; }}
            maxCount={1}>
            <Button icon={<FileExcelOutlined />}>选择 Excel 文件</Button>
          </Upload>
        </div>
        {importHeaders.length > 0 && (
          <>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>发货成本列</Text>
                <Select style={{ width: '100%' }} value={importShipCol >= 0 ? importShipCol : undefined} placeholder="选择列"
                  onChange={v => setImportShipCol(v)} options={importHeaders.map((h, i) => ({ value: i, label: `${h || '(空)'} (第${i + 1}列)` }))} allowClear />
              </Col>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>退货金额列</Text>
                <Select style={{ width: '100%' }} value={importRefundCol >= 0 ? importRefundCol : undefined} placeholder="选择列"
                  onChange={v => setImportRefundCol(v)} options={importHeaders.map((h, i) => ({ value: i, label: `${h || '(空)'} (第${i + 1}列)` }))} allowClear />
              </Col>
            </Row>
            <Text type="secondary">预览前 5 行（共 {importData.length} 行）：</Text>
            <Table bordered size="small" scroll={{ x: 500 }} pagination={false} style={{ marginTop: 8 }}
              dataSource={importData.slice(0, 5).map((row, i) => ({ _key: i, ...Object.fromEntries(row.map((v, j) => [`c${j}`, v])) }))}
              columns={importHeaders.map((h, i) => ({
                title: h || `列${i + 1}`, dataIndex: `c${i}`, key: `c${i}`, width: 120,
                render: (v: any) => v !== undefined ? String(v) : '',
              }))} />
          </>
        )}
      </Modal>

      {/* ========= 充值推广费弹窗 ========= */}
      <Modal title="充值推广费" open={rechargeVisible} onCancel={() => setRechargeVisible(false)} onOk={handleAddRecharge}
        okText="添加充值" cancelText="取消" width={480}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>充值金额 <Text type="danger">*</Text></Text>
            <InputNumber style={{ width: '100%' }} value={rechargeAmount} onChange={v => setRechargeAmount(v || 0)} controls={false} precision={2} prefix="¥" /></Col>
          <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>充值日期</Text>
            <DatePicker style={{ width: '100%' }} value={rechargeDate} onChange={v => v && setRechargeDate(v)} /></Col>
        </Row>
        <div style={{ marginBottom: 12 }}>
          <Text style={{ display: 'block', marginBottom: 4 }}>备注（选填）</Text>
          <Input value={rechargeRemark} onChange={e => setRechargeRemark(e.target.value)} placeholder="如：支付宝转账" />
        </div>
        {(() => {
          const rec = records.find(r => r.key === rechargeTarget);
          if (!rec || rec.adRecharges.length === 0) return null;
          return (
            <>
              <Divider>历史充值记录（合计 ¥{fmt(totalRecharge(rec.adRecharges))}）</Divider>
              <Table bordered size="small" pagination={false} dataSource={rec.adRecharges} rowKey="key"
                columns={[
                  { title: '日期', dataIndex: 'date', key: 'date', width: 100 },
                  { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, align: 'right', render: (v: number) => `¥${fmt(v)}` },
                  { title: '备注', dataIndex: 'remark', key: 'remark' },
                ]} />
            </>
          );
        })()}
      </Modal>
    </div>
  );
};

export default ShopProfitPage;
