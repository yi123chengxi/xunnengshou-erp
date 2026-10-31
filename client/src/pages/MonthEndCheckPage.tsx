import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, DatePicker,
  Row, Col, Select, Popconfirm, Tag, Image, Checkbox, Upload, Progress, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  SearchOutlined, UploadOutlined, SettingOutlined, InfoCircleOutlined,
  SendOutlined, RollbackOutlined, ImportOutlined, DownloadOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx-js-style';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import useResizableColumns from '../hooks/useResizableColumns';
import FieldConfigModal from '../components/FieldConfigModal';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

// ===================== 类型定义 =====================
interface ShopInfo {
  key: string;
  shopName: string;
  accountId: string;
  platform?: string;
  person?: string;
  createdAt: string;
}

/** 平台人工单价配置：key=平台名称, value={ type: 'orders'|'qty', price: number } */
interface PlatformLaborConfig {
  type: 'orders' | 'qty';   // orders=按实发单数, qty=按实发数量
  price: number;             // 单价
}
const DEFAULT_PLATFORM_PRICING: Record<string, PlatformLaborConfig> = {
  '淘宝': { type: 'orders', price: 1 },
  '天猫': { type: 'orders', price: 1 },
  '1688': { type: 'orders', price: 1 },
  'Temu': { type: 'qty', price: 3 },
  '拼多多': { type: 'qty', price: 3 },
  '京东': { type: 'orders', price: 1.5 },
  '抖音': { type: 'orders', price: 1.5 },
  '快手': { type: 'orders', price: 1.5 },
};

interface MonthEndRecord {
  key: string;
  shopId: string;
  shopName: string;
  calcMonth: string;          // YYYY-MM
  currentBalance: number;     // 已到账金额
  pendingAmount: number;      // 待到账金额
  adFunds: number;            // 剩余推广费
  deposit: number;            // 保证金
  image?: string;             // 图片
  chargePerson?: string;       // 负责人（根据店铺名称匹配店铺列表中的负责人）
  createdAt: string;
  updatedAt: string;
  inputBy: string;
}

interface ShipRecord {
  key: string;
  shopName: string;
  shopId: string;
  chargePerson?: string;       // 负责人
  calcMonth: string;
  realOrders: number;      // 实发单数
  realQty: number;         // 实发数量
  returnOrders: number;    // 实退单数
  returnQty: number;       // 实退数量
  realCost: number;        // 实发成本
  realAmount: number;      // 实发金额
  freightCost: number;     // 运费支出
  returnCost: number;      // 实退成本
  laborCost: number;       // 发货费用
  createdAt: string;
  updatedAt: string;
}

interface ReturnRecord {
  key: string;
  shopName: string;
  shopId: string;
  chargePerson?: string;       // 负责人
  calcMonth: string;          // 确认月份 YYYY-MM（从最后确认日期提取）
  afterSalesNo: string;      // 售后单号
  onlineOrderNo: string;   // 线上订单号
  productCode: string;     // 商品编码
  costPrice: number;       // 成本价
  returnQty: number;       // 实退数量（总计）
  returnAmount: number;    // 实退成本金额（总计）
  items: { productCode: string; returnQty: number; returnAmount: number }[]; // 商品明细（合并显示）
  actualReceiptAmount: number; // 实际收货金额
  returnFee: number;           // 退货费用（自动计算：费用单价）
  confirmDate: string;     // 最后确认日期 YYYY-MM-DD（售后确认收到退货的日期）
  payDate: string;           // 订单支付日期 YYYY-MM-DD
  payMonth: string;          // 支付月份 YYYY-MM（从 payDate 自动提取）
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
  // 1. 从 registeredUsers 查找
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const user = users.find((u: any) => u.username === username);
    if (user) return user.displayName || user.contactPerson || user.companyName || username;
  } catch { /* ignore */ }
  // 2. 从 accounts_ 查找
  try {
    const owner = getDataOwner();
    const accounts = JSON.parse(localStorage.getItem('accounts_' + owner) || '[]');
    const acc = accounts.find((a: any) => a.username === username);
    if (acc) return acc.displayName || acc.person || username;
  } catch { /* ignore */ }
  return username;
};

const fmt = (v: number | undefined | null) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ===================== 主组件 =====================
const MonthEndCheckPage: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const shopKey = `shop_info_${owner}`;
  const checkKey = `month_end_check_${owner}`;
  const shipKey = `month_end_ship_${owner}`;
  const returnKey = `month_end_return_${owner}`;

  // 子标签页
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'ship' | 'return'>('summary');

  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [records, setRecords] = useState<MonthEndRecord[]>([]);
  const [shipRecords, setShipRecords] = useState<ShipRecord[]>([]);
  const [returnRecords, setReturnRecords] = useState<ReturnRecord[]>([]);
  const [filterShop, setFilterShop] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [searchText, setSearchText] = useState('');

  // 发货金额搜索
  const [shipSearchShopName, setShipSearchShopName] = useState('');
  const [shipSearchMonth, setShipSearchMonth] = useState('');
  const [shipSearchActive, setShipSearchActive] = useState(false);

  // 平台人工单价配置
  const pricingKey = `platform_labor_pricing_${owner}`;
  const [platformPricing, setPlatformPricing] = useState<Record<string, PlatformLaborConfig>>(() => {
    try { const s = localStorage.getItem(pricingKey); if (s) return JSON.parse(s); } catch {}
    return { ...DEFAULT_PLATFORM_PRICING };
  });
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [newPlatformName, setNewPlatformName] = useState('');
  const [newPlatformType, setNewPlatformType] = useState<'orders' | 'qty'>('orders');
  const [newPlatformPrice, setNewPlatformPrice] = useState<number>(0);
  const savePlatformPricing = (config: Record<string, PlatformLaborConfig>) => {
    setPlatformPricing(config);
    localStorage.setItem(pricingKey, JSON.stringify(config));
  };

  // 根据 shopId 获取平台
  const getShopPlatform = useCallback((shopId: string, shopName: string): string => {
    const shop = shops.find(s => s.key === shopId) || shops.find(s => s.shopName === shopName);
    return shop?.platform || '';
  }, [shops]);

  // 根据 shopId/shopName 获取店铺编号
  const getShopAccountId = useCallback((shopId: string, shopName: string): string => {
    const shop = shops.find(s => s.key === shopId) || shops.find(s => s.shopName === shopName);
    return shop?.accountId || '';
  }, [shops]);

  // 根据 shopId/shopName 获取店铺负责人
  const getShopPerson = useCallback((shopId: string, shopName: string): string => {
    const shop = shops.find(s => s.key === shopId) || shops.find(s => s.shopName === shopName);
    return shop?.person || '';
  }, [shops]);

  // 计算人工成本
  const calcLaborCost = useCallback((r: { shopId: string; shopName: string; realOrders: number; realQty: number }): number => {
    const platform = getShopPlatform(r.shopId, r.shopName);
    const config = platformPricing[platform];
    if (!config) return 0;
    const base = config.type === 'orders' ? (r.realOrders || 0) : (r.realQty || 0);
    return Math.round(base * config.price * 100) / 100;
  }, [getShopPlatform, platformPricing]);

  // 发货搜索过滤
  const filteredShipRecords = useMemo(() => {
    if (!shipSearchActive) return shipRecords;
    return shipRecords.filter(r => {
      if (shipSearchShopName && !r.shopName.toLowerCase().includes(shipSearchShopName.toLowerCase())) return false;
      if (shipSearchMonth && r.calcMonth !== shipSearchMonth) return false;
      return true;
    });
  }, [shipRecords, shipSearchActive, shipSearchShopName, shipSearchMonth]);

  // 新增/编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editRecord, setEditRecord] = useState<MonthEndRecord | null>(null);

  // ===================== 数据加载 =====================
  const reload = useCallback(() => {
    try { setShops(JSON.parse(localStorage.getItem(shopKey) || '[]')); } catch { setShops([]); }
    try { setRecords(JSON.parse(localStorage.getItem(checkKey) || '[]')); } catch { setRecords([]); }
    try { setShipRecords(JSON.parse(localStorage.getItem(shipKey) || '[]')); } catch { setShipRecords([]); }
    try { setReturnRecords(JSON.parse(localStorage.getItem(returnKey) || '[]')); } catch { setReturnRecords([]); }
  }, [shopKey, checkKey, shipKey, returnKey]);
  useEffect(() => { reload(); }, [reload]);

  const saveShipRecords = (list: ShipRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(shipKey, json); safeSetItem(`${shipKey}_ts`, String(Date.now()));
    saveDataset(shipKey, json); setShipRecords(list);
  };
  const saveReturnRecords = (list: ReturnRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(returnKey, json); safeSetItem(`${returnKey}_ts`, String(Date.now()));
    saveDataset(returnKey, json); setReturnRecords(list);
  };

  // ===================== 发货金额 CRUD =====================
  const [shipEditVisible, setShipEditVisible] = useState(false);
  const [shipIsCreating, setShipIsCreating] = useState(false);
  const [shipEdit, setShipEdit] = useState<ShipRecord | null>(null);
  const openShipCreate = () => {
    setShipEdit({ key: `ship-${Date.now()}`, shopName: shops[0]?.shopName || '', shopId: shops[0]?.key || '', chargePerson: shops[0]?.person || '', calcMonth: dayjs().format('YYYY-MM'), realOrders: 0, realQty: 0, returnOrders: 0, returnQty: 0, realCost: 0, realAmount: 0, freightCost: 0, returnCost: 0, laborCost: 0, createdAt: new Date().toLocaleString('zh-CN'), updatedAt: '' });
    setShipIsCreating(true); setShipEditVisible(true);
  };
  const openShipEdit = (r: ShipRecord) => { setShipEdit({ ...r }); setShipIsCreating(false); setShipEditVisible(true); };
  const updateShipField = (f: keyof ShipRecord, v: any) => {
    if (shipEdit) {
      const updated = { ...shipEdit, [f]: v };
      if (f === 'shopId') {
        const shop = shops.find(s => s.key === v);
        updated.shopName = shop?.shopName || '';
        updated.chargePerson = shop?.person || '';
      }
      setShipEdit(updated);
    }
  };
  const handleShipSave = () => {
    if (!shipEdit) return;
    const updated = { ...shipEdit, updatedAt: new Date().toLocaleString('zh-CN') };
    if (shipIsCreating) saveShipRecords([updated, ...shipRecords]);
    else saveShipRecords(shipRecords.map(r => r.key === updated.key ? updated : r));
    setShipEditVisible(false); message.success(shipIsCreating ? '发货记录已创建' : '发货记录已保存');
  };
  const handleShipDelete = (key: string) => { saveShipRecords(shipRecords.filter(r => r.key !== key)); message.success('已删除'); };

  // ===================== 退货费用设置 =====================
  const retFeeKey = `return_fee_unit_price_${owner}`;
  const retFeeModeKey = `return_fee_calc_mode_${owner}`;
  const [returnFeeUnitPrice, setReturnFeeUnitPrice] = useState<number>(() => {
    try { const v = localStorage.getItem(retFeeKey); if (v) return Number(v) || 0; } catch {}
    return 5;
  });
  const [returnFeeCalcMode, setReturnFeeCalcMode] = useState<'perOrder' | 'perQty'>(() => {
    try { const v = localStorage.getItem(retFeeModeKey); if (v === 'perQty') return 'perQty'; } catch {}
    return 'perOrder';
  });
  const [retFeeModalVisible, setRetFeeModalVisible] = useState(false);
  const [tempFeePrice, setTempFeePrice] = useState<number>(returnFeeUnitPrice);
  const [tempFeeMode, setTempFeeMode] = useState<'perOrder' | 'perQty'>(returnFeeCalcMode);
  const saveReturnFeeConfig = (price: number, mode: 'perOrder' | 'perQty') => {
    setReturnFeeUnitPrice(price);
    setReturnFeeCalcMode(mode);
    localStorage.setItem(retFeeKey, String(price));
    localStorage.setItem(retFeeModeKey, mode);
  };
  // 计算退货费用
  const calcReturnFee = useCallback((r: ReturnRecord): number => {
    if (returnFeeCalcMode === 'perQty') {
      return Math.round((Number(r.returnQty) || 0) * returnFeeUnitPrice * 100) / 100;
    }
    return returnFeeUnitPrice;
  }, [returnFeeCalcMode, returnFeeUnitPrice]);

  // ===================== 发货金额 - 退货费用设置 =====================
  const shipRetFeeKey = `ship_return_fee_unit_price_${owner}`;
  const shipRetFeeModeKey = `ship_return_fee_calc_mode_${owner}`;
  const [shipRetFeeUnitPrice, setShipRetFeeUnitPrice] = useState<number>(() => {
    try { const v = localStorage.getItem(shipRetFeeKey); if (v) return Number(v) || 0; } catch {}
    return 5;
  });
  const [shipRetFeeCalcMode, setShipRetFeeCalcMode] = useState<'perOrder' | 'perQty'>(() => {
    try { const v = localStorage.getItem(shipRetFeeModeKey); if (v === 'perQty') return 'perQty'; } catch {}
    return 'perOrder';
  });
  const [shipRetFeeModalVisible, setShipRetFeeModalVisible] = useState(false);
  const [tempShipFeePrice, setTempShipFeePrice] = useState<number>(shipRetFeeUnitPrice);
  const [tempShipFeeMode, setTempShipFeeMode] = useState<'perOrder' | 'perQty'>(shipRetFeeCalcMode);
  const saveShipReturnFeeConfig = (price: number, mode: 'perOrder' | 'perQty') => {
    setShipRetFeeUnitPrice(price);
    setShipRetFeeCalcMode(mode);
    localStorage.setItem(shipRetFeeKey, String(price));
    localStorage.setItem(shipRetFeeModeKey, mode);
  };
  const calcShipReturnFee = useCallback((r: ShipRecord): number => {
    if (shipRetFeeCalcMode === 'perQty') {
      return Math.round((Number(r.returnQty) || 0) * shipRetFeeUnitPrice * 100) / 100;
    }
    return Math.round((Number(r.returnOrders) || 0) * shipRetFeeUnitPrice * 100) / 100;
  }, [shipRetFeeCalcMode, shipRetFeeUnitPrice]);

  // ===================== 退货金额 CRUD =====================
  const [retEditVisible, setRetEditVisible] = useState(false);
  const [retIsCreating, setRetIsCreating] = useState(false);
  const [retEdit, setRetEdit] = useState<ReturnRecord | null>(null);
  const openRetCreate = () => {
    setRetEdit({ key: `ret-${Date.now()}`, shopName: shops[0]?.shopName || '', shopId: shops[0]?.key || '', chargePerson: shops[0]?.person || '', calcMonth: dayjs().format('YYYY-MM'), afterSalesNo: '', onlineOrderNo: '', productCode: '', costPrice: 0, returnQty: 0, returnAmount: 0, items: [], actualReceiptAmount: 0, returnFee: returnFeeUnitPrice, confirmDate: dayjs().format('YYYY-MM-DD'), payDate: '', payMonth: '', createdAt: new Date().toLocaleString('zh-CN'), updatedAt: '' });
    setRetIsCreating(true); setRetEditVisible(true);
  };
  const openRetEdit = (r: ReturnRecord) => { setRetEdit({ ...r }); setRetIsCreating(false); setRetEditVisible(true); };
  const updateRetField = (f: keyof ReturnRecord, v: any) => {
    if (!retEdit) return;
    const updated = { ...retEdit, [f]: v };
    if (f === 'shopId') {
      const shop = shops.find(s => s.key === v);
      updated.shopName = shop?.shopName || '';
      updated.chargePerson = shop?.person || '';
    }
    if (f === 'costPrice' || f === 'returnQty') updated.returnAmount = Math.round((Number(updated.costPrice) || 0) * (Number(updated.returnQty) || 0) * 100) / 100;
    if (f === 'payDate') {
      const v = String(updated.payDate || '').trim();
      if (v) {
        const m = dayjs(v).format('YYYY-MM');
        updated.payMonth = (m !== 'Invalid Date' && m.length === 7) ? m : '';
      } else {
        updated.payMonth = '';
      }
    }
    // 最后确认日期变更时，自动提取确认月份
    if (f === 'confirmDate' && v) {
      const m = dayjs(v).format('YYYY-MM');
      if (m !== 'Invalid Date' && m.length === 7) updated.calcMonth = m;
    }
    setRetEdit(updated);
  };
  const handleRetSave = () => {
    if (!retEdit) return;
    if (!retEdit.confirmDate) { message.warning('请选择最后确认日期'); return; }
    const updated = { ...retEdit, returnAmount: Math.round((Number(retEdit.costPrice) || 0) * (Number(retEdit.returnQty) || 0) * 100) / 100, updatedAt: new Date().toLocaleString('zh-CN') };
    if (retIsCreating) {
      // 新增时检查售后单号是否重复
      if (updated.afterSalesNo) {
        const existIdx = returnRecords.findIndex(r => r.afterSalesNo && r.afterSalesNo === updated.afterSalesNo);
        if (existIdx >= 0) {
          // 售后单号重复，更新已有记录
          const merged = { ...returnRecords[existIdx], ...updated, key: returnRecords[existIdx].key };
          saveReturnRecords(returnRecords.map((r, i) => i === existIdx ? merged : r));
          setRetEditVisible(false); message.success(`售后单号 ${updated.afterSalesNo} 已存在，已更新对应记录`);
          return;
        }
      }
      saveReturnRecords([updated, ...returnRecords]);
    } else {
      saveReturnRecords(returnRecords.map(r => r.key === updated.key ? updated : r));
    }
    setRetEditVisible(false); message.success(retIsCreating ? '退货记录已创建' : '退货记录已保存');
  };
  const handleRetDelete = (key: string) => { saveReturnRecords(returnRecords.filter(r => r.key !== key)); message.success('已删除'); };

  // ===================== 退货搜索 =====================
  // 退货搜索：草稿状态（输入时更新）+ 已应用状态（点查询/回车时生效）
  const [retDraftShopName, setRetDraftShopName] = useState('');
  const [retDraftAfterSalesNo, setRetDraftAfterSalesNo] = useState('');
  const [retDraftOnlineOrderNo, setRetDraftOnlineOrderNo] = useState('');
  const [retDraftPayMonth, setRetDraftPayMonth] = useState('');
  const [retDraftConfirmDateRange, setRetDraftConfirmDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [retAppliedShopName, setRetAppliedShopName] = useState('');
  const [retAppliedAfterSalesNo, setRetAppliedAfterSalesNo] = useState('');
  const [retAppliedOnlineOrderNo, setRetAppliedOnlineOrderNo] = useState('');
  const [retAppliedPayMonth, setRetAppliedPayMonth] = useState('');
  const [retAppliedConfirmDateRange, setRetAppliedConfirmDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [retSearchActive, setRetSearchActive] = useState(false);

  const handleRetSearch = () => {
    setRetAppliedShopName(retDraftShopName);
    setRetAppliedAfterSalesNo(retDraftAfterSalesNo);
    setRetAppliedOnlineOrderNo(retDraftOnlineOrderNo);
    setRetAppliedPayMonth(retDraftPayMonth);
    setRetAppliedConfirmDateRange(retDraftConfirmDateRange);
    setRetSearchActive(true);
  };
  const handleRetReset = () => {
    setRetDraftShopName(''); setRetDraftAfterSalesNo(''); setRetDraftOnlineOrderNo(''); setRetDraftPayMonth('');
    setRetDraftConfirmDateRange(null);
    setRetAppliedShopName(''); setRetAppliedAfterSalesNo(''); setRetAppliedOnlineOrderNo(''); setRetAppliedPayMonth('');
    setRetAppliedConfirmDateRange(null);
    setRetSearchActive(false);
  };

  const filteredReturnRecords = useMemo(() => {
    if (!retSearchActive) return returnRecords;
    return returnRecords.filter(r => {
      if (retAppliedShopName && !r.shopName.toLowerCase().includes(retAppliedShopName.toLowerCase())) return false;
      if (retAppliedAfterSalesNo && !r.afterSalesNo.toLowerCase().includes(retAppliedAfterSalesNo.toLowerCase())) return false;
      if (retAppliedOnlineOrderNo && !r.onlineOrderNo.toLowerCase().includes(retAppliedOnlineOrderNo.toLowerCase())) return false;
      if (retAppliedPayMonth && !(r.payMonth || '').includes(retAppliedPayMonth)) return false;
      if (retAppliedConfirmDateRange) {
        const [s, e] = retAppliedConfirmDateRange;
        const d = dayjs(r.confirmDate);
        if (!d.isValid() || d.isBefore(s, 'day') || d.isAfter(e, 'day')) return false;
      }
      return true;
    });
  }, [returnRecords, retSearchActive, retAppliedShopName, retAppliedAfterSalesNo, retAppliedOnlineOrderNo, retAppliedPayMonth, retAppliedConfirmDateRange]);

  const retSummary = useMemo(() => {
    let actualReceiptAmount = 0;
    let returnFee = 0;
    filteredReturnRecords.forEach(r => {
      actualReceiptAmount += Number(r.actualReceiptAmount) || 0;
      returnFee += calcReturnFee(r);
    });
    return { actualReceiptAmount: Math.round(actualReceiptAmount * 100) / 100, returnFee: Math.round(returnFee * 100) / 100 };
  }, [filteredReturnRecords, calcReturnFee]);

  // ===================== 字段显示控制 =====================
  const SHIP_ALL_FIELDS = [
    { key: 'shopName', label: '店铺名称' }, { key: 'shopId', label: '店铺编号' },
    { key: 'chargePerson', label: '负责人' },
    { key: 'calcMonth', label: '月份' }, { key: 'realOrders', label: '实发单数' },
    { key: 'realQty', label: '实发数量' }, { key: 'returnOrders', label: '实退单数' },
    { key: 'returnQty', label: '实退数量' },
    { key: 'realCost', label: '实发成本' },
    { key: 'realAmount', label: '实发金额' },
    { key: 'freightCost', label: '运费支出' }, { key: 'returnFee', label: '退货费用' }, { key: 'totalShipCost', label: '发货总成本' }, { key: 'returnCost', label: '实退成本' },
    { key: 'laborCost', label: '发货费用' },
    { key: 'platform', label: '所属平台' },
  ];
  const RET_ALL_FIELDS = [
    { key: 'shopName', label: '店铺名称' }, { key: 'shopId', label: '店铺编号' },
    { key: 'chargePerson', label: '负责人' },
    { key: 'calcMonth', label: '确认月份' }, { key: 'afterSalesNo', label: '售后单号' },
    { key: 'onlineOrderNo', label: '线上订单号' },
    { key: 'productCode', label: '商品编码' },
    { key: 'actualReceiptAmount', label: '实际收货金额' },
    { key: 'returnFee', label: '退货费用' },
    { key: 'confirmDate', label: '最后确认日期' },
    { key: 'payDate', label: '订单支付日期' },
    { key: 'payMonth', label: '支付月份' },
  ];
  const initFieldState = (fields: { key: string }[], prefix: string) => {
    const savedOrder = (() => { try { const s = localStorage.getItem(`${prefix}FieldOrder_${owner}`); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; } } catch {} return null; })();
    const savedVis = (() => { try { const s = localStorage.getItem(`${prefix}FieldVis_${owner}`); if (s) return JSON.parse(s); } catch {} return null; })();
    const order = savedOrder ? [...savedOrder, ...fields.map(f => f.key).filter(k => !savedOrder.includes(k))] : fields.map(f => f.key);
    const vis: Record<string, boolean> = savedVis ? { ...savedVis } : {};
    fields.forEach(f => { if (vis[f.key] === undefined) vis[f.key] = true; });
    return { order, vis };
  };
  const [shipFieldOrder, setShipFieldOrder] = useState(() => initFieldState(SHIP_ALL_FIELDS, 'ship').order);
  const [shipFieldVis, setShipFieldVis] = useState(() => initFieldState(SHIP_ALL_FIELDS, 'ship').vis);
  const [shipFieldConfigVisible, setShipFieldConfigVisible] = useState(false);
  const [retFieldOrder, setRetFieldOrder] = useState(() => initFieldState(RET_ALL_FIELDS, 'ret').order);
  const [retFieldVis, setRetFieldVis] = useState(() => initFieldState(RET_ALL_FIELDS, 'ret').vis);
  const [retFieldConfigVisible, setRetFieldConfigVisible] = useState(false);
  const saveShipFieldConfig = (order: string[] = shipFieldOrder, vis: Record<string, boolean> = shipFieldVis) => { localStorage.setItem(`shipFieldOrder_${owner}`, JSON.stringify(order)); localStorage.setItem(`shipFieldVis_${owner}`, JSON.stringify(vis)); };
  const saveRetFieldConfig = (order: string[] = retFieldOrder, vis: Record<string, boolean> = retFieldVis) => { localStorage.setItem(`retFieldOrder_${owner}`, JSON.stringify(order)); localStorage.setItem(`retFieldVis_${owner}`, JSON.stringify(vis)); };

  // 列宽拖拽
  const { wrapColumns: wrapShipCols } = useResizableColumns<ShipRecord>(`colWidths_ship_${owner}`);
  const { wrapColumns: wrapRetCols } = useResizableColumns<ReturnRecord>(`colWidths_ret_${owner}`);

  // ===================== 导入功能 =====================
  // 发货金额字段映射
  const SHIP_FIELD_MAP: Record<string, keyof ShipRecord> = {
    '店铺名称': 'shopName', '店铺编号': 'shopId', '负责人': 'chargePerson',
    '实发单数': 'realOrders', '实发数量': 'realQty',
    '实退单数': 'returnOrders', '实退数量': 'returnQty',
    '实发成本': 'realCost',
    '实发金额': 'realAmount',
    '运费支出': 'freightCost', '实退成本': 'returnCost',
  };
  // 退货金额字段映射
  const RET_FIELD_MAP: Record<string, keyof ReturnRecord> = {
    '店铺名称': 'shopName', '店铺编号': 'shopId', '负责人': 'chargePerson', '确认月份': 'calcMonth', '售后单号': 'afterSalesNo',
    '线上订单号': 'onlineOrderNo',
    '商品编码': 'productCode', '实退数量': 'returnQty',
    '实退成本金额': 'returnAmount', '实际收货金额': 'actualReceiptAmount',
    '最后确认日期': 'confirmDate',
    '订单支付日期': 'payDate',
  };

  // 发货导入状态
  const [shipImportVisible, setShipImportVisible] = useState(false);
  const [shipImportData, setShipImportData] = useState<any[]>([]);
  const [shipImportFileName, setShipImportFileName] = useState('');
  const [shipImportProgress, setShipImportProgress] = useState(0);
  const [shipImporting, setShipImporting] = useState(false);
  const [shipFieldMatch, setShipFieldMatch] = useState<Record<string, string>>({});
  const [shipImportMonth, setShipImportMonth] = useState<string>(dayjs().format('YYYY-MM'));

  // 退货导入状态
  const [retImportVisible, setRetImportVisible] = useState(false);
  const [retImportData, setRetImportData] = useState<any[]>([]);
  const [retImportFileName, setRetImportFileName] = useState('');
  const [retImportProgress, setRetImportProgress] = useState(0);
  const [retImporting, setRetImporting] = useState(false);
  const [retFieldMatch, setRetFieldMatch] = useState<Record<string, string>>({});

  // 通用解析文件
  const parseImportFile = (file: File, fieldMap: Record<string, string>, setData: (d: any[]) => void, setFileName: (n: string) => void, setMatch: (m: Record<string, string>) => void) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (rows.length === 0) { message.warning('文件中没有数据'); return; }
        const headers = Object.keys(rows[0]);
        // 自动匹配字段
        const autoMatch: Record<string, string> = {};
        headers.forEach(h => {
          const trimmed = h.trim();
          if (fieldMap[trimmed]) autoMatch[trimmed] = fieldMap[trimmed];
          else {
            // 模糊匹配
            const found = Object.entries(fieldMap).find(([label]) => label.includes(trimmed) || trimmed.includes(label));
            if (found) autoMatch[trimmed] = found[1];
          }
        });
        setMatch(autoMatch);
        setData(rows);
        setFileName(file.name);
        message.success(`解析成功，共 ${rows.length} 条数据`);
      } catch (err) {
        message.error('文件解析失败：' + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
    return false;
  };

  // 发货导入确认
  const handleShipImportConfirm = () => {
    if (shipImportData.length === 0) { message.warning('请先选择要导入的文件'); return; }
    if (!shipImportMonth) { message.warning('请选择导入月份'); return; }
    // 预校验：店铺名称必填
    const errors: string[] = [];
    shipImportData.forEach((row, idx) => {
      const mapped: any = {};
      Object.entries(row).forEach(([key, val]) => { mapped[shipFieldMatch[key.trim()] || key.trim()] = val; });
      const name = String(mapped.shopName || '').trim();
      if (!name) errors.push(`第${idx + 1}行：店铺名称为空`);
    });
    // 检查导入文件内部重复
    const importKeys = new Set<string>();
    shipImportData.forEach((row, idx) => {
      const mapped: any = {};
      Object.entries(row).forEach(([key, val]) => { mapped[shipFieldMatch[key.trim()] || key.trim()] = val; });
      const name = String(mapped.shopName || '').trim();
      const month = String(mapped.calcMonth || '').trim();
      if (name && month) {
        const uk = `${name}__${month}`;
        if (importKeys.has(uk)) errors.push(`第${idx + 1}行：与导入文件中其他行重复(${name}+${month})`);
        importKeys.add(uk);
      }
    });
    if (errors.length > 0) { Modal.error({ title: '导入校验失败', content: (<div style={{ maxHeight: 300, overflow: 'auto' }}>{errors.map((e, i) => <div key={i} style={{ color: '#f5222d', fontSize: 12, lineHeight: '20px' }}>{e}</div>)}</div>), width: 520 }); return; }
    // 检查与已有记录的重复情况（店铺+月份）
    const calcMonth = shipImportMonth;
    const duplicateShops: string[] = [];
    shipImportData.forEach(row => {
      const mapped: any = {};
      Object.entries(row).forEach(([key, val]) => { mapped[shipFieldMatch[key.trim()] || key.trim()] = val; });
      const name = String(mapped.shopName || '').trim();
      if (name && shipRecords.some(r => r.shopName === name && r.calcMonth === calcMonth)) {
        if (!duplicateShops.includes(name)) duplicateShops.push(name);
      }
    });
    if (duplicateShops.length > 0) {
      Modal.confirm({
        title: '数据已存在',
        content: (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <div style={{ marginBottom: 8 }}>检测到 <strong style={{ color: '#f5222d' }}>{duplicateShops.length}</strong> 条重复数据（{shipImportMonth} 月份已有以下店铺的发货记录）：</div>
            {duplicateShops.map((name, i) => <div key={i} style={{ color: '#fa8c16', fontSize: 12, lineHeight: '20px' }}>• {name}</div>)}
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>继续导入将覆盖已有数据，是否确认？</div>
          </div>
        ),
        width: 520,
        okText: '确认导入',
        cancelText: '取消',
        onOk: () => doShipImport(),
      });
      return;
    }
    doShipImport();
  };

  const doShipImport = () => {
    setShipImporting(true); setShipImportProgress(0);
    const total = shipImportData.length;
    let added = 0, updated = 0, skipped = 0;
    const skippedNames = new Set<string>();
    const existingRecords = [...shipRecords];
    const shopNameSet = new Set(shops.map(s => s.shopName.trim()));
    const processNext = (idx: number) => {
      if (idx >= total) {
        saveShipRecords(existingRecords);
        setShipImporting(false); setShipImportProgress(100);
        setShipImportVisible(false); setShipImportData([]); setShipImportFileName(''); setShipFieldMatch({});
        message.success(`导入完成：新增 ${added} 条，更新 ${updated} 条${skipped > 0 ? `，${skipped} 个店铺未导入（店铺列表中不存在：${Array.from(skippedNames).join('、')}）` : ''}`);
        return;
      }
      const row = shipImportData[idx];
      const mapped: any = {};
      Object.entries(row).forEach(([key, val]) => {
        const field = shipFieldMatch[key.trim()] || key.trim();
        mapped[field] = val;
      });
      const shopName = String(mapped.shopName || '').trim();
      const calcMonth = shipImportMonth;
      // 检查店铺是否在店铺列表中
      if (!shopNameSet.has(shopName)) {
        skipped++;
        skippedNames.add(shopName);
        setShipImportProgress(Math.round(((idx + 1) / total) * 100));
        setTimeout(() => processNext(idx + 1), 30);
        return;
      }
      const existingIdx = existingRecords.findIndex(r => r.shopName === shopName && r.calcMonth === calcMonth);
      if (existingIdx >= 0) {
        // 更新已有记录
        const rec = existingRecords[existingIdx];
        rec.shopId = String(mapped.shopId || rec.shopId);
        rec.realOrders = Number(mapped.realOrders) || rec.realOrders;
        rec.realQty = Number(mapped.realQty) || rec.realQty;
        rec.returnOrders = Number(mapped.returnOrders) || rec.returnOrders;
        rec.returnQty = Number(mapped.returnQty) || rec.returnQty;
        rec.realCost = Number(mapped.realCost) || rec.realCost;
        rec.realAmount = Number(mapped.realAmount) || rec.realAmount;
        rec.freightCost = Number(mapped.freightCost) || rec.freightCost;
        rec.returnCost = Number(mapped.returnCost) || rec.returnCost;
        rec.laborCost = Number(mapped.laborCost) || rec.laborCost;
        rec.updatedAt = new Date().toLocaleString('zh-CN');
        updated++;
      } else {
        // 新增记录
        existingRecords.unshift({
          key: `ship-${Date.now()}-${idx}`,
          shopName,
          shopId: String(mapped.shopId || ''),
          chargePerson: shops.find(s => s.shopName === shopName)?.person || '',
          calcMonth,
          realOrders: Number(mapped.realOrders) || 0,
          realQty: Number(mapped.realQty) || 0,
          returnOrders: Number(mapped.returnOrders) || 0,
          returnQty: Number(mapped.returnQty) || 0,
          realCost: Number(mapped.realCost) || 0,
          realAmount: Number(mapped.realAmount) || 0,
          freightCost: Number(mapped.freightCost) || 0,
          returnCost: Number(mapped.returnCost) || 0,
          laborCost: Number(mapped.laborCost) || 0,
          createdAt: new Date().toLocaleString('zh-CN'),
          updatedAt: '',
        });
        added++;
      }
      setShipImportProgress(Math.round(((idx + 1) / total) * 100));
      setTimeout(() => processNext(idx + 1), 30);
    };
    processNext(0);
  };

  // 退货导入确认
  const handleRetImportConfirm = () => {
    if (retImportData.length === 0) { message.warning('请先选择要导入的文件'); return; }
    // 预校验：售后单号必填，最后确认日期必填，店铺编号必填
    const errors: string[] = [];
    const importAfterSalesNos = new Set<string>();
    retImportData.forEach((row, idx) => {
      const mapped: any = {};
      Object.entries(row).forEach(([key, val]) => { mapped[retFieldMatch[key.trim()] || key.trim()] = val; });
      const sid = String(mapped.shopId || '').trim();
      const confirmDate = String(mapped.confirmDate || '').trim();
      const asn = String(mapped.afterSalesNo || '').trim();
      if (!asn) errors.push(`第${idx + 1}行：售后单号为空（必填）`);
      if (!sid) errors.push(`第${idx + 1}行：店铺编号为空`);
      if (!confirmDate) errors.push(`第${idx + 1}行：最后确认日期为空（必填）`);
      // 检查导入文件内部售后单号重复（多行同一售后单号是允许的，用于合并商品明细）
      if (asn) importAfterSalesNos.add(asn);
    });
    if (errors.length > 0) { Modal.error({ title: '导入校验失败', content: (<div style={{ maxHeight: 300, overflow: 'auto' }}>{errors.map((e, i) => <div key={i} style={{ color: '#f5222d', fontSize: 12, lineHeight: '20px' }}>{e}</div>)}</div>), width: 520 }); return; }
    // 检查与已有记录的售后单号重复情况
    const duplicateNos = Array.from(importAfterSalesNos).filter(no => returnRecords.some(r => r.afterSalesNo === no));
    if (duplicateNos.length > 0) {
      Modal.confirm({
        title: '售后单号已存在',
        content: (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <div style={{ marginBottom: 8 }}>以下 {duplicateNos.length} 个售后单号已存在，导入后将更新已有记录并合并商品明细：</div>
            {duplicateNos.map((no, i) => <div key={i} style={{ color: '#fa8c16', fontSize: 12, lineHeight: '20px' }}>• {no}</div>)}
          </div>
        ),
        width: 520,
        okText: '确认导入',
        cancelText: '取消',
        onOk: () => doRetImport(),
      });
      return;
    }
    doRetImport();
  };

  const doRetImport = () => {
    setRetImporting(true); setRetImportProgress(0);
    const total = retImportData.length;
    let added = 0, updated = 0;
    const existingRecords = [...returnRecords];
    const newRecords: ReturnRecord[] = [];
    const processNext = (idx: number) => {
      if (idx >= total) {
        saveReturnRecords([...newRecords, ...existingRecords]);
        setRetImporting(false); setRetImportProgress(100);
        setRetImportVisible(false); setRetImportData([]); setRetImportFileName(''); setRetFieldMatch({});
        message.success(`导入完成：新增 ${added} 条，更新 ${updated} 条退货记录`);
        return;
      }
      const row = retImportData[idx];
      const mapped: any = {};
      Object.entries(row).forEach(([key, val]) => {
        const field = retFieldMatch[key.trim()] || key.trim();
        mapped[field] = val;
      });
      const costPrice = Number(mapped.costPrice) || 0;
      const returnQty = Number(mapped.returnQty) || 0;
      // 从最后确认日期提取确认月份
      const confirmDateStr = String(mapped.confirmDate || '').trim();
      let calcMonth = String(mapped.calcMonth || '').trim();
      if (confirmDateStr) {
        const extractedMonth = dayjs(confirmDateStr).format('YYYY-MM');
        if (extractedMonth !== 'Invalid Date' && extractedMonth.length === 7) calcMonth = extractedMonth;
      }
      if (!calcMonth) calcMonth = dayjs().format('YYYY-MM');
      const afterSalesNo = String(mapped.afterSalesNo || '').trim();
      const productCode = String(mapped.productCode || '');
      const itemEntry = { productCode, returnQty, returnAmount: Math.round(costPrice * returnQty * 100) / 100 };
      // 从订单支付日期提取支付月份
      const payDateStr = String(mapped.payDate || '').trim();
      let payMonth = '';
      if (payDateStr) {
        const pm = dayjs(payDateStr).format('YYYY-MM');
        if (pm !== 'Invalid Date' && pm.length === 7) payMonth = pm;
      }
      const recordData: Partial<ReturnRecord> = {
        shopName: String(mapped.shopName || ''),
        shopId: String(mapped.shopId || ''),
        chargePerson: shops.find(s => s.shopName === String(mapped.shopName || '').trim())?.person || '',
        calcMonth,
        afterSalesNo,
        onlineOrderNo: String(mapped.onlineOrderNo || ''),
        productCode,
        costPrice,
        returnQty,
        returnAmount: Math.round(costPrice * returnQty * 100) / 100,
        items: [itemEntry],
        actualReceiptAmount: Number(mapped.actualReceiptAmount) || 0,
        returnFee: returnFeeUnitPrice,
        confirmDate: confirmDateStr,
        payDate: payDateStr,
        payMonth,
        updatedAt: new Date().toLocaleString('zh-CN'),
      };
      // 售后单号合并：如果已存在则将商品明细追加到 items
      if (afterSalesNo) {
        const existIdx = existingRecords.findIndex(r => r.afterSalesNo && r.afterSalesNo === afterSalesNo);
        if (existIdx >= 0) {
          const existing = existingRecords[existIdx];
          const existingItems = existing.items && existing.items.length > 0 ? existing.items : [{ productCode: existing.productCode, returnQty: existing.returnQty, returnAmount: existing.returnAmount }];
          existingRecords[existIdx] = {
            ...existing,
            ...recordData,
            items: [...existingItems, itemEntry],
            returnQty: (Number(existing.returnQty) || 0) + returnQty,
            returnAmount: Math.round(((Number(existing.returnAmount) || 0) + Math.round(costPrice * returnQty * 100) / 100) * 100) / 100,
          } as ReturnRecord;
          updated++;
          setRetImportProgress(Math.round(((idx + 1) / total) * 100));
          setTimeout(() => processNext(idx + 1), 30);
          return;
        }
        const batchIdx = newRecords.findIndex(r => r.afterSalesNo && r.afterSalesNo === afterSalesNo);
        if (batchIdx >= 0) {
          const batchRec = newRecords[batchIdx];
          const batchItems = batchRec.items && batchRec.items.length > 0 ? batchRec.items : [{ productCode: batchRec.productCode, returnQty: batchRec.returnQty, returnAmount: batchRec.returnAmount }];
          newRecords[batchIdx] = {
            ...batchRec,
            ...recordData,
            items: [...batchItems, itemEntry],
            returnQty: (Number(batchRec.returnQty) || 0) + returnQty,
            returnAmount: Math.round(((Number(batchRec.returnAmount) || 0) + Math.round(costPrice * returnQty * 100) / 100) * 100) / 100,
          } as ReturnRecord;
          updated++;
          setRetImportProgress(Math.round(((idx + 1) / total) * 100));
          setTimeout(() => processNext(idx + 1), 30);
          return;
        }
      }
      newRecords.push({
        key: `ret-${Date.now()}-${idx}`,
        ...recordData,
        createdAt: new Date().toLocaleString('zh-CN'),
      } as ReturnRecord);
      added++;
      setRetImportProgress(Math.round(((idx + 1) / total) * 100));
      setTimeout(() => processNext(idx + 1), 30);
    };
    processNext(0);
  };

  // 下载发货模板
  const downloadShipTemplate = () => {
    const headers = SHIP_ALL_FIELDS.filter(f => !['totalShipCost', 'laborCost', 'platform', 'calcMonth'].includes(f.key)).map(f => f.label);
    const sample = [['天猫旗舰店', 'SK001', '张三', 100, 500, 15000.00, 800.00, 200.00]];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '\u53d1\u8d27\u91d1\u989d');
    XLSX.writeFile(wb, '\u53d1\u8d27\u91d1\u989d\u5bfc\u5165\u6a21\u677f.xlsx');
  };

  // 下载退货模板
  const downloadRetTemplate = () => {
    const headers = RET_ALL_FIELDS.filter(f => f.key !== 'payMonth').map(f => f.label);
    const sample = [['天猫旗舰店', 'SK001', '张三', '2026-09', 'DD20260901001', 'SP001', 25.50, 3, 76.50, '2026-09-15', '2026-09-15']];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '\u9000\u8d27\u91d1\u989d');
    XLSX.writeFile(wb, '\u9000\u8d27\u91d1\u989d\u5bfc\u5165\u6a21\u677f.xlsx');
  };

  // 通用导入弹窗渲染
  const renderImportModal = (config: {
    visible: boolean; setVisible: (v: boolean) => void;
    title: string; allFields: { key: string; label: string }[];
    fieldMap: Record<string, string>;
    importData: any[]; setImportData: (d: any[]) => void;
    importFileName: string; setImportFileName: (n: string) => void;
    fieldMatch: Record<string, string>; setFieldMatch: (m: Record<string, string>) => void;
    progress: number; importing: boolean;
    onConfirm: () => void;
    onDownloadTemplate: () => void;
    extraContent?: React.ReactNode;
  }) => {
    const matchedCount = Object.values(config.fieldMatch).filter(Boolean).length;
    const totalFields = config.allFields.length;
    return (
      <Modal title={<span><ImportOutlined style={{ marginRight: 8, color: PRIMARY }} />{config.title}</span>}
        open={config.visible} onCancel={() => { if (!config.importing) { config.setVisible(false); config.setImportData([]); config.setImportFileName(''); config.setFieldMatch({}); } }}
        onOk={config.onConfirm} okText="确认导入" cancelText="取消" width={640}
        okButtonProps={{ loading: config.importing }}>
        <div style={{ padding: '8px 0' }}>
          {/* 模板下载 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>导入模板</Text>
            <Button icon={<DownloadOutlined />} onClick={config.onDownloadTemplate}>下载导入模板</Button>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>请先下载模板填写数据后再导入</Text>
          </div>
          {/* 额外内容（如月份选择） */}
          {config.extraContent}
          {/* 选择文件 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>选择文件</Text>
            <Upload accept=".xlsx,.xls,.csv" showUploadList={false} maxCount={1}
              beforeUpload={file => parseImportFile(file, config.fieldMap, config.setImportData, config.setImportFileName, config.setFieldMatch)}>
              <Button icon={<UploadOutlined />}>选择 Excel / CSV 文件</Button>
            </Upload>
            {config.importFileName && (
              <Text type="success" style={{ display: 'block', marginTop: 8 }}>✓ {config.importFileName}（{config.importData.length} 条数据）</Text>
            )}
          </div>
          {/* 字段匹配情况 */}
          {config.importData.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>字段匹配情况</Text>
              <div style={{ background: '#f6f8fa', borderRadius: 6, padding: '10px 14px' }}>
                <Row gutter={[8, 4]}>
                  {Object.keys(config.importData[0] || {}).map(header => {
                    const matched = config.fieldMatch[header.trim()];
                    const fieldLabel = config.allFields.find(f => f.key === matched)?.label;
                    return (
                      <Col span={12} key={header}>
                        <Space size={4}>
                          <span style={{ fontSize: 12, color: '#666' }}>{header}</span>
                          <span style={{ fontSize: 12, color: '#999' }}>→</span>
                          <Tag color={matched ? 'green' : 'default'} style={{ fontSize: 11 }}>
                            {fieldLabel || '未匹配'}
                          </Tag>
                        </Space>
                      </Col>
                    );
                  })}
                </Row>
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <Text type="secondary">已匹配 {matchedCount}/{totalFields} 个字段</Text>
                  <Progress percent={Math.round((matchedCount / totalFields) * 100)} size="small" style={{ width: 200, display: 'inline-block', marginLeft: 8 }} />
                </div>
              </div>
            </div>
          )}
          {/* 数据预览 */}
          {config.importData.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>数据预览（前5条）</Text>
              <Table size="small" bordered dataSource={config.importData.slice(0, 5)} rowKey={(_, i) => String(i)}
                scroll={{ x: 500 }} pagination={false}
                columns={Object.keys(config.importData[0] || {}).slice(0, 5).map(k => ({
                  title: k, dataIndex: k, key: k, width: 100, ellipsis: true,
                }))} />
            </div>
          )}
          {/* 导入进度 */}
          {config.importing && (
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>导入进度</Text>
              <Progress percent={config.progress} status={config.progress >= 100 ? 'success' : 'active'} />
            </div>
          )}
        </div>
      </Modal>
    );
  };

  const saveRecords = (list: MonthEndRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(checkKey, json);
    safeSetItem(`${checkKey}_ts`, String(Date.now()));
    saveDataset(checkKey, json);
    setRecords(list);
  };

  // ===================== 新增/编辑 =====================
  const openCreate = () => {
    if (shops.length === 0) { message.warning('请先在"店铺列表"中添加店铺'); return; }
    setEditRecord({
      key: `check-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      shopId: shops[0].key,
      shopName: shops[0].shopName,
      calcMonth: dayjs().format('YYYY-MM'),
      currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0,
      chargePerson: shops[0].person || '',
      createdAt: new Date().toLocaleString('zh-CN'), updatedAt: '',
      inputBy: localStorage.getItem('username') || '',
    });
    setIsCreating(true);
    setEditVisible(true);
  };

  const openEdit = (rec: MonthEndRecord) => {
    setEditRecord({ ...rec });
    setIsCreating(false);
    setEditVisible(true);
  };

  const updateField = (field: keyof MonthEndRecord, value: any) => {
    if (!editRecord) return;
    const updated = { ...editRecord, [field]: value };
    if (field === 'shopId') {
      const shop = shops.find(s => s.key === value);
      updated.shopName = shop?.shopName || '';
      updated.chargePerson = shop?.person || '';
    }
    setEditRecord(updated);
  };

  const handleSave = () => {
    if (!editRecord) return;
    if (!editRecord.shopId) { message.warning('请选择店铺'); return; }
    if (!editRecord.calcMonth) { message.warning('请选择月份'); return; }

    // 唯一性验证：同一店铺 + 同一月份 只能有一条记录
    const duplicate = records.find(r =>
      r.shopId === editRecord.shopId && r.calcMonth === editRecord.calcMonth && r.key !== editRecord.key
    );
    if (duplicate) {
      message.error(`该店铺在 ${editRecord.calcMonth} 月份已有盘点记录，不能重复新增`);
      return;
    }

    const updated = { ...editRecord, updatedAt: new Date().toLocaleString('zh-CN') };
    let list: MonthEndRecord[];
    if (isCreating) {
      list = [updated, ...records];
    } else {
      list = records.map(r => r.key === updated.key ? updated : r);
    }
    saveRecords(list);
    setEditVisible(false);
    message.success(isCreating ? '盘点记录已创建' : '盘点记录已保存');
  };

  const handleDelete = (key: string) => {
    saveRecords(records.filter(r => r.key !== key));
    message.success('记录已删除');
  };

  // 图片上传处理
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) { message.warning('请上传图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { message.warning('图片不能超过 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (editRecord) setEditRecord({ ...editRecord, image: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  // ===================== 过滤 =====================
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filterShop && r.shopId !== filterShop) return false;
      if (filterMonth && r.calcMonth !== filterMonth) return false;
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        if (!r.shopName.toLowerCase().includes(q) && !r.calcMonth.includes(q)) return false;
      }
      return true;
    });
  }, [records, filterShop, filterMonth, searchText]);

  // 汇总统计
  const summary = useMemo(() => {
    const total = filteredRecords.reduce((acc, r) => ({
      currentBalance: acc.currentBalance + (r.currentBalance || 0),
      pendingAmount: acc.pendingAmount + (r.pendingAmount || 0),
      adFunds: acc.adFunds + (r.adFunds || 0),
      deposit: acc.deposit + (r.deposit || 0),
    }), { currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0 });
    return total;
  }, [filteredRecords]);

  // 列宽拖拽调整
  const { wrapColumns } = useResizableColumns<MonthEndRecord>(`colWidths_monthEndCheck_${owner}`);

  // ===================== 表格列 =====================
  const columns: ColumnsType<MonthEndRecord> = [
    { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 160, fixed: 'left',
      render: (v: string) => <Text strong>{v}</Text> },
    { title: '负责人', dataIndex: 'chargePerson', key: 'chargePerson', width: 100, fixed: 'left',
      render: (v: string, r: MonthEndRecord) => v || getShopPerson(r.shopId, r.shopName) || <Text type="secondary">—</Text> },
    { title: '月份', dataIndex: 'calcMonth', key: 'calcMonth', width: 100, fixed: 'left',
      render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '已到账金额', dataIndex: 'currentBalance', key: 'currentBalance', width: 130, align: 'right',
      render: (v: number) => <Text style={{ color: '#1e4a7e' }}>{fmt(v)}</Text> },
    { title: '待到账金额', dataIndex: 'pendingAmount', key: 'pendingAmount', width: 130, align: 'right',
      render: (v: number) => <Text style={{ color: '#52c41a' }}>{fmt(v)}</Text> },
    { title: '剩余推广费', dataIndex: 'adFunds', key: 'adFunds', width: 130, align: 'right',
      render: (v: number) => <Text style={{ color: '#fa8c16' }}>{fmt(v)}</Text> },
    { title: '保证金', dataIndex: 'deposit', key: 'deposit', width: 120, align: 'right',
      render: (v: number) => <Text style={{ color: '#722ed1' }}>{fmt(v)}</Text> },
    { title: '图片', dataIndex: 'image', key: 'image', width: 80, align: 'center',
      render: (img: string) => img ? <Image src={img} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <Text type="secondary">—</Text> },
    { title: '录入人', dataIndex: 'inputBy', key: 'inputBy', width: 90,
      render: (v: string) => getDisplayName(v) },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 160,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '操作', key: 'action', width: 140, fixed: 'right',
      render: (_: any, r: MonthEndRecord) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除此盘点记录？" onConfirm={() => handleDelete(r.key)} okText="确认" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* 顶部子标签页 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <Space>
          <Button type={activeSubTab === 'summary' ? 'primary' : 'default'}
            style={activeSubTab === 'summary' ? { color: '#fff' } : {}}
            onClick={() => setActiveSubTab('summary')}>店铺资金</Button>
          <Tooltip title="按照发货时间在ERP内筛选之后导入">
            <Button type={activeSubTab === 'ship' ? 'primary' : 'default'} icon={<SendOutlined />}
              style={activeSubTab === 'ship' ? { color: '#fff' } : {}}
              onClick={() => setActiveSubTab('ship')}>发货金额</Button>
          </Tooltip>
          <Tooltip title="按照确认收货时间在ERP内筛选后导入。只要用于月底盘点资金计算公司月利润">
            <Button type={activeSubTab === 'return' ? 'primary' : 'default'} icon={<RollbackOutlined />}
              style={activeSubTab === 'return' ? { color: '#fff' } : {}}
              onClick={() => setActiveSubTab('return')}>退货金额</Button>
          </Tooltip>
        </Space>
      </Card>

      {/* ============ 汇总计算 ============ */}
      {activeSubTab === 'summary' && (<>
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '10px 24px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space wrap>
              <Select allowClear placeholder="选择店铺" style={{ width: 150 }} value={filterShop || undefined}
                onChange={v => setFilterShop(v || '')} options={shops.map(s => ({ value: s.key, label: s.shopName }))} />
              <DatePicker picker="month" placeholder="选择月份" value={filterMonth ? dayjs(filterMonth + '-01') : undefined}
                onChange={v => setFilterMonth(v ? v.format('YYYY-MM') : '')} style={{ width: 130 }} />
              <Input.Search placeholder="搜索" value={searchText} onChange={e => setSearchText(e.target.value)}
                allowClear style={{ width: 160 }} prefix={<SearchOutlined />} />
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增记录</Button>
              <Tag color="blue">{records.length} 条记录</Tag>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 汇总统计 */}
      {filteredRecords.length > 0 && (
        <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '10px 24px' }}>
          <Row gutter={24}>
            <Col span={6}><Text type="secondary">已到账合计：</Text><Text strong style={{ color: '#1e4a7e' }}>{fmt(summary.currentBalance)}</Text></Col>
            <Col span={6}><Text type="secondary">待到账合计：</Text><Text strong style={{ color: '#52c41a' }}>{fmt(summary.pendingAmount)}</Text></Col>
            <Col span={6}><Text type="secondary">推广费合计：</Text><Text strong style={{ color: '#fa8c16' }}>{fmt(summary.adFunds)}</Text></Col>
            <Col span={6}><Text type="secondary">保证金合计：</Text><Text strong style={{ color: '#722ed1' }}>{fmt(summary.deposit)}</Text></Col>
          </Row>
        </Card>
      )}

      {/* 主表格 */}
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<MonthEndRecord>
          bordered
          columns={wrapColumns(columns)}
          dataSource={filteredRecords}
          rowKey="key"
          scroll={{ x: 1300, y: 'calc(100vh - 360px)' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
          size="middle"
          locale={{ emptyText: '暂无盘点记录，请点击"新增记录"' }}
        />
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal title={isCreating ? '新增月末盘点记录' : '编辑月末盘点记录'} open={editVisible}
        onCancel={() => setEditVisible(false)} onOk={handleSave}
        okText="保存" cancelText="取消" width={600}>
        {editRecord && (
          <div>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Text style={{ display: 'block', marginBottom: 4 }}>店铺名称 <Text type="danger">*</Text></Text>
                <Select value={editRecord.shopId} onChange={v => updateField('shopId', v)} style={{ width: '100%' }}
                  options={shops.map(s => ({ value: s.key, label: s.shopName }))}
                  placeholder="选择店铺" />
              </Col>
              <Col span={8}>
                <Text style={{ display: 'block', marginBottom: 4 }}>负责人</Text>
                <Input value={editRecord.chargePerson || getShopPerson(editRecord.shopId, editRecord.shopName)} readOnly style={{ background: '#fafafa' }} placeholder="根据店铺自动匹配" />
              </Col>
              <Col span={8}>
                <Text style={{ display: 'block', marginBottom: 4 }}>月份 <Text type="danger">*</Text></Text>
                <DatePicker picker="month" value={editRecord.calcMonth ? dayjs(editRecord.calcMonth + '-01') : undefined}
                  onChange={v => updateField('calcMonth', v ? v.format('YYYY-MM') : '')} style={{ width: '100%' }} />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>已到账金额</Text>
                <InputNumber style={{ width: '100%' }} value={editRecord.currentBalance}
                  onChange={v => updateField('currentBalance', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>待到账金额</Text>
                <InputNumber style={{ width: '100%' }} value={editRecord.pendingAmount}
                  onChange={v => updateField('pendingAmount', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>剩余推广费</Text>
                <InputNumber style={{ width: '100%' }} value={editRecord.adFunds}
                  onChange={v => updateField('adFunds', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={12}>
                <Text style={{ display: 'block', marginBottom: 4 }}>保证金</Text>
                <InputNumber style={{ width: '100%' }} value={editRecord.deposit}
                  onChange={v => updateField('deposit', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
            </Row>
            {/* 图片上传 */}
            <div style={{ marginTop: 16 }}>
              <Text style={{ display: 'block', marginBottom: 4 }}>图片</Text>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
              <div
                onClick={() => fileInputRef.current?.click()}
                onPaste={(e) => {
                  e.preventDefault();
                  const cd = (e as any).clipboardData as DataTransfer | undefined;
                  const items = Array.from(cd?.items || []);
                  for (const it of items) {
                    if (it.type.startsWith('image/')) {
                      const f = it.getAsFile();
                      if (f) handleImageFile(f);
                      break;
                    }
                  }
                }}
                tabIndex={0}
                style={{ width: 100, height: 100, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', background: '#fafafa' }}>
                {editRecord.image ? (
                  <img src={editRecord.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
                    <UploadOutlined style={{ fontSize: 20, display: 'block', marginBottom: 4 }} />
                    点击/粘贴
                  </div>
                )}
              </div>
              {editRecord.image && (
                <Button type="link" size="small" danger onClick={() => setEditRecord(prev => prev ? { ...prev, image: '' } : prev)} style={{ padding: 0, marginTop: 4 }}>删除图片</Button>
              )}
            </div>
            {!isCreating && editRecord.createdAt && (
              <div style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
                创建时间：{editRecord.createdAt} | 录入人：{getDisplayName(editRecord.inputBy)}
              </div>
            )}
          </div>
        )}
      </Modal>
      </>)}

      {/* ============ 发货金额 ============ */}
      {activeSubTab === 'ship' && (<>
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>店铺名称</Text><Input allowClear placeholder="店铺名称" value={shipSearchShopName} onChange={e => setShipSearchShopName(e.target.value)} style={{ width: 140 }} /></div>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>月份</Text><DatePicker picker="month" value={shipSearchMonth ? dayjs(shipSearchMonth + '-01') : undefined} onChange={v => setShipSearchMonth(v ? v.format('YYYY-MM') : '')} style={{ width: 140 }} /></div>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} onClick={() => setShipSearchActive(true)}>查询</Button>
            <Button icon={<RollbackOutlined />} onClick={() => { setShipSearchShopName(''); setShipSearchMonth(''); setShipSearchActive(false); }}>重置</Button>
          </Space>
          <div style={{ borderLeft: '1px solid #f0f0f0', paddingLeft: 12, marginLeft: 'auto' }}>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openShipCreate}>新增记录</Button>
              <Button icon={<ImportOutlined />} onClick={() => setShipImportVisible(true)}>导入</Button>
              <Popconfirm title="确认清空所有发货数据？" onConfirm={() => { saveShipRecords([]); message.success('已清空所有发货记录'); }} okText="确认" cancelText="取消">
                <Button danger icon={<DeleteOutlined />}>清空数据</Button>
              </Popconfirm>
              <Button icon={<SettingOutlined />} onClick={() => setPricingModalVisible(true)}>发货费用配置</Button>
              <Button icon={<SettingOutlined />} onClick={() => { setTempShipFeePrice(shipRetFeeUnitPrice); setTempShipFeeMode(shipRetFeeCalcMode); setShipRetFeeModalVisible(true); }}>退货费用设置</Button>
              <Button icon={<SettingOutlined />} onClick={() => setShipFieldConfigVisible(true)}>显示字段</Button>
              <Tag color="blue">{filteredShipRecords.length} 条记录</Tag>
            </Space>
          </div>
        </div>
      </Card>
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<ShipRecord> bordered size="middle" rowKey="key"
          dataSource={filteredShipRecords}
          scroll={{ x: 1100, y: 'calc(100vh - 320px)' }}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无发货记录' }}
          columns={wrapShipCols([
            ...shipFieldOrder.filter(k => shipFieldVis[k]).map(k => {
              const map: Record<string, any> = {
                shopName: { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 150, align: 'center' as const },
                shopId: { title: <span>店铺编号 <Tooltip title="根据店铺列表自动匹配"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'shopId', width: 120, align: 'center' as const,
                  render: (_: any, r: ShipRecord) => { const id = getShopAccountId(r.shopId, r.shopName); return id || <Text type="secondary">—</Text>; } },
                chargePerson: { title: '负责人', dataIndex: 'chargePerson', key: 'chargePerson', width: 100, align: 'center' as const,
                  render: (v: string, r: ShipRecord) => v || getShopPerson(r.shopId, r.shopName) || <Text type="secondary">—</Text> },
                calcMonth: { title: '月份', dataIndex: 'calcMonth', key: 'calcMonth', width: 100, align: 'center' as const, render: (v: string) => <Tag color="blue">{v}</Tag> },
                realOrders: { title: '实发单数', dataIndex: 'realOrders', key: 'realOrders', width: 100, align: 'center' as const },
                realQty: { title: '实发数量', dataIndex: 'realQty', key: 'realQty', width: 100, align: 'center' as const },
                returnOrders: { title: '实退单数', dataIndex: 'returnOrders', key: 'returnOrders', width: 100, align: 'center' as const },
                returnQty: { title: '实退数量', dataIndex: 'returnQty', key: 'returnQty', width: 100, align: 'center' as const },
                realCost: { title: '实发成本', dataIndex: 'realCost', key: 'realCost', width: 110, align: 'center' as const, render: (v: number) => fmt(v) },
                realAmount: { title: <span>实发金额 <Tooltip title="实际发货订单的销售金额（建议按照发货时间导入）"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'realAmount', key: 'realAmount', width: 110, align: 'center' as const, render: (v: number) => <Text style={{ color: '#52c41a' }}>{fmt(v)}</Text> },
                freightCost: { title: '运费支出', dataIndex: 'freightCost', key: 'freightCost', width: 110, align: 'center' as const, render: (v: number) => fmt(v) },
                returnFee: { title: <span>退货费用 <Tooltip title="根据退货费用设置自动计算：实退单数(或实退数量) × 单价"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'returnFee', width: 110, align: 'center' as const,
                  render: (_: any, r: ShipRecord) => <Text style={{ color: '#fa8c16' }}>{fmt(calcShipReturnFee(r))}</Text> },
                totalShipCost: { title: <span>发货总成本 <Tooltip title="发货总成本 = 实发成本 + 运费支出 + 发货费用"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'totalShipCost', width: 120, align: 'center' as const, render: (_: any, r: ShipRecord) => fmt((Number(r.realCost) || 0) + (Number(r.freightCost) || 0) + calcLaborCost(r)) },
                returnCost: { title: '实退成本', dataIndex: 'returnCost', key: 'returnCost', width: 110, align: 'center' as const, render: (v: number) => fmt(v) },
                laborCost: { title: <span>发货费用 <Tooltip title="根据所属平台自动计算：淘宝/天猫/1688=实发单数×单价，Temu/拼多多=实发数量×单价"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'laborCost', width: 110, align: 'center' as const,
                  render: (_: any, r: ShipRecord) => { const v = calcLaborCost(r); return <Text style={{ color: '#fa8c16' }}>{fmt(v)}</Text>; } },
                platform: { title: <span>所属平台 <Tooltip title="数据源：店铺列表中的所属平台"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'platform', width: 100, align: 'center' as const,
                  render: (_: any, r: ShipRecord) => { const p = getShopPlatform(r.shopId, r.shopName); return p ? <Tag color="cyan">{p}</Tag> : <Text type="secondary">—</Text>; } },
              };
              return map[k];
            }).filter(Boolean),
            { title: '操作', key: 'action', width: 120, fixed: 'right' as const, align: 'center' as const,
              render: (_: any, r: ShipRecord) => (
                <Space size="small">
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openShipEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除？" onConfirm={() => handleShipDelete(r.key)} okText="确认" cancelText="取消">
                    <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ) },
          ] as any)}
          summary={() => {
            const data = filteredShipRecords;
            const sum = (field: string) => data.reduce((a, r) => a + (Number((r as any)[field]) || 0), 0);
            const platformCount: Record<string, number> = {};
            data.forEach(r => {
              const p = getShopPlatform(r.shopId, r.shopName) || '未分类';
              platformCount[p] = (platformCount[p] || 0) + 1;
            });
            const visibleKeys = shipFieldOrder.filter(k => shipFieldVis[k]);
            const cells: React.ReactNode[] = [];
            visibleKeys.forEach((k, idx) => {
              if (idx === 0) {
                cells.push(<Table.Summary.Cell index={idx} key={k}><Text strong>合计</Text></Table.Summary.Cell>);
              } else if (idx === 1 || idx === 2) {
                cells.push(<Table.Summary.Cell index={idx} key={k}></Table.Summary.Cell>);
              } else if (['realOrders', 'realQty', 'returnOrders', 'returnQty'].includes(k)) {
                cells.push(<Table.Summary.Cell index={idx} key={k}><Text strong>{sum(k).toLocaleString()}</Text></Table.Summary.Cell>);
              } else if (['realCost', 'realAmount', 'freightCost', 'returnCost'].includes(k)) {
                cells.push(<Table.Summary.Cell index={idx} key={k}><Text strong style={{ color: '#52c41a' }}>{fmt(sum(k))}</Text></Table.Summary.Cell>);
              } else if (k === 'returnFee') {
                cells.push(<Table.Summary.Cell index={idx} key={k}><Text strong style={{ color: '#fa8c16' }}>{fmt(data.reduce((a, r) => a + calcShipReturnFee(r), 0))}</Text></Table.Summary.Cell>);
              } else if (k === 'totalShipCost') {
                cells.push(<Table.Summary.Cell index={idx} key={k}><Text strong>{fmt(data.reduce((a, r) => a + (Number(r.realCost) || 0) + (Number(r.freightCost) || 0) + calcLaborCost(r), 0))}</Text></Table.Summary.Cell>);
              } else if (k === 'laborCost') {
                cells.push(<Table.Summary.Cell index={idx} key={k}><Text strong style={{ color: '#fa8c16' }}>{fmt(data.reduce((a, r) => a + calcLaborCost(r), 0))}</Text></Table.Summary.Cell>);
              } else if (k === 'platform') {
                cells.push(<Table.Summary.Cell index={idx} key={k}></Table.Summary.Cell>);
              } else {
                cells.push(<Table.Summary.Cell index={idx} key={k}></Table.Summary.Cell>);
              }
            });
            cells.push(<Table.Summary.Cell index={visibleKeys.length} key="action"></Table.Summary.Cell>);
            return <Table.Summary.Row style={{ background: '#fafafa' }}>{cells}</Table.Summary.Row>;
          }}
        />
      </Card>
      </>)}

      {/* ============ 退货金额 ============ */}
      {activeSubTab === 'return' && (<>
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>店铺名称</Text><Input allowClear placeholder="店铺名称" value={retDraftShopName} onChange={e => setRetDraftShopName(e.target.value)} onPressEnter={handleRetSearch} style={{ width: 140 }} /></div>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>售后单号</Text><Input allowClear placeholder="售后单号" value={retDraftAfterSalesNo} onChange={e => setRetDraftAfterSalesNo(e.target.value)} onPressEnter={handleRetSearch} style={{ width: 140 }} /></div>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>线上订单号</Text><Input allowClear placeholder="线上订单号" value={retDraftOnlineOrderNo} onChange={e => setRetDraftOnlineOrderNo(e.target.value)} onPressEnter={handleRetSearch} style={{ width: 140 }} /></div>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>支付月份</Text><DatePicker picker="month" value={retDraftPayMonth ? dayjs(retDraftPayMonth + '-01') : undefined} onChange={v => setRetDraftPayMonth(v ? v.format('YYYY-MM') : '')} style={{ width: 140 }} placeholder="支付月份" /></div>
          <div><Text style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 2 }}>最后确认日期</Text><DatePicker.RangePicker value={retDraftConfirmDateRange} onChange={v => setRetDraftConfirmDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)} style={{ width: 220 }} /></div>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleRetSearch}>查询</Button>
            <Button icon={<RollbackOutlined />} onClick={handleRetReset}>重置</Button>
          </Space>
          <div style={{ borderLeft: '1px solid #f0f0f0', paddingLeft: 12, marginLeft: 'auto' }}>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openRetCreate}>新增记录</Button>
              <Button icon={<ImportOutlined />} onClick={() => setRetImportVisible(true)}>导入</Button>
              <Button icon={<SettingOutlined />} onClick={() => { setTempFeePrice(returnFeeUnitPrice); setTempFeeMode(returnFeeCalcMode); setRetFeeModalVisible(true); }}>费用设置</Button>
              <Popconfirm title="确认清空所有退货数据？" onConfirm={() => { saveReturnRecords([]); message.success('已清空所有退货记录'); }} okText="确认" cancelText="取消">
                <Button danger icon={<DeleteOutlined />}>清空数据</Button>
              </Popconfirm>
              <Button icon={<SettingOutlined />} onClick={() => setRetFieldConfigVisible(true)}>显示字段</Button>
              <Tag color="blue">{filteredReturnRecords.length} 条记录</Tag>
            </Space>
          </div>
        </div>
      </Card>
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<ReturnRecord> bordered size="middle" rowKey="key"
          dataSource={filteredReturnRecords}
          scroll={{ x: 1300, y: 'calc(100vh - 380px)' }}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无退货记录' }}
          columns={wrapRetCols([
            ...retFieldOrder.filter(k => retFieldVis[k]).map(k => {
              const map: Record<string, any> = {
                shopName: { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 150, align: 'center' as const },
                shopId: { title: '店铺编号', dataIndex: 'shopId', key: 'shopId', width: 120, align: 'center' as const },
                chargePerson: { title: '负责人', dataIndex: 'chargePerson', key: 'chargePerson', width: 100, align: 'center' as const,
                  render: (v: string, r: ReturnRecord) => v || getShopPerson(r.shopId, r.shopName) || <Text type="secondary">—</Text> },
                calcMonth: { title: <span>确认月份 <Tooltip title="数据源：从最后确认日期中提取月份"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'calcMonth', key: 'calcMonth', width: 100, align: 'center' as const, render: (v: string) => <Tag color="blue">{v}</Tag> },
                afterSalesNo: { title: '售后单号', dataIndex: 'afterSalesNo', key: 'afterSalesNo', width: 140, align: 'center' as const, render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : <Text type="secondary">—</Text> },
                onlineOrderNo: { title: '线上订单号', dataIndex: 'onlineOrderNo', key: 'onlineOrderNo', width: 150, align: 'center' as const },
                productCode: { title: <span>商品编码 <Tooltip title="包含商品编码、实退数量、单价；多行时显示‘多’"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'productCode', width: 200, align: 'center' as const,
                  render: (_: any, r: ReturnRecord) => {
                    const items = r.items && r.items.length > 0 ? r.items : [{ productCode: r.productCode, returnQty: r.returnQty, returnAmount: r.returnAmount }];
                    if (items.length === 1) {
                      const it = items[0];
                      return <div style={{ fontSize: 12, lineHeight: '18px' }}><div>{it.productCode || '—'}</div><div style={{ color: '#888', fontSize: 11 }}>{it.returnQty} × ¥{fmt(it.returnAmount)}</div></div>;
                    }
                    const first = items[0];
                    return (
                      <Tooltip title={items.map((it, i) => <div key={i}>{it.productCode} ({it.returnQty} × ¥{fmt(it.returnAmount)})</div>)} overlayStyle={{ maxWidth: 360 }}>
                        <div style={{ cursor: 'pointer', fontSize: 12, lineHeight: '18px' }}>
                          <div>{first.productCode || '—'}</div>
                          <div style={{ color: '#888', fontSize: 11 }}>{first.returnQty} × ¥{fmt(first.returnAmount)}</div>
                          <Tag color="volcano" style={{ marginTop: 2, fontSize: 10 }}>多 ({items.length}行)</Tag>
                        </div>
                      </Tooltip>
                    );
                  } },
                actualReceiptAmount: { title: '实际收货金额', dataIndex: 'actualReceiptAmount', key: 'actualReceiptAmount', width: 120, align: 'center' as const, render: (v: number) => <Text style={{ color: '#1e4a7e' }}>{fmt(v)}</Text> },
                returnFee: { title: <span>退货费用 <Tooltip title="根据费用设置自动计算，可在费用设置中配置单价和计算方式"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'returnFee', width: 100, align: 'center' as const,
                  render: (_: any, r: ReturnRecord) => <Text style={{ color: '#fa8c16' }}>{fmt(calcReturnFee(r))}</Text> },
                confirmDate: { title: <span>最后确认日期 <Tooltip title="售后确认收到退货的日期"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'confirmDate', key: 'confirmDate', width: 130, align: 'center' as const, render: (v: string) => v ? <Tag color="orange">{v}</Tag> : <Text type="secondary">—</Text> },
                payDate: { title: <span>订单支付日期 <Tooltip title="订单实际付款的日期"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'payDate', key: 'payDate', width: 130, align: 'center' as const, render: (v: string) => v ? <Tag color="geekblue">{v}</Tag> : <Text type="secondary">—</Text> },
                payMonth: { title: <span>支付月份 <Tooltip title="从订单支付日期自动提取"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'payMonth', key: 'payMonth', width: 110, align: 'center' as const, render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—</Text> },
              };
              return map[k];
            }).filter(Boolean),
            { title: '操作', key: 'action', width: 120, fixed: 'right' as const, align: 'center' as const,
              render: (_: any, r: ReturnRecord) => (
                <Space size="small">
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openRetEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除？" onConfirm={() => handleRetDelete(r.key)} okText="确认" cancelText="取消">
                    <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ) },
          ] as any)} />
        {/* 搜索结果合计固定栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '8px 16px',
          borderTop: '2px solid #e8e8e8', background: '#fafafa',
        }}>
          <Text strong style={{ marginRight: 24 }}>搜索结果合计（{filteredReturnRecords.length} 条）</Text>
          <Space size={32}>
            <span><Text type="secondary">实际收货金额：</Text><Text strong style={{ color: '#1e4a7e', fontSize: 15 }}>¥{fmt(retSummary.actualReceiptAmount)}</Text></span>
            <span><Text type="secondary">退货费用：</Text><Text strong style={{ color: '#fa8c16', fontSize: 15 }}>¥{fmt(retSummary.returnFee)}</Text></span>
          </Space>
        </div>
      </Card>
      </>)}

      {/* ============ 发货金额弹窗 ============ */}
      <Modal title={shipIsCreating ? '新增发货记录' : '编辑发货记录'} open={shipEditVisible}
        onCancel={() => setShipEditVisible(false)} onOk={handleShipSave}
        okText="保存" cancelText="取消" width={520}>
        {shipEdit && (
          <div>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={8}><Text style={{ display: 'block', marginBottom: 4 }}>店铺名称</Text>
                <Select value={shipEdit.shopId} onChange={v => updateShipField('shopId', v)} style={{ width: '100%' }}
                  options={shops.map(s => ({ value: s.key, label: s.shopName }))} placeholder="选择店铺" />
              </Col>
              <Col span={8}><Text style={{ display: 'block', marginBottom: 4 }}>负责人</Text>
                <Input value={shipEdit.chargePerson || getShopPerson(shipEdit.shopId, shipEdit.shopName)} readOnly style={{ background: '#fafafa' }} placeholder="根据店铺自动匹配" />
              </Col>
              <Col span={8}><Text style={{ display: 'block', marginBottom: 4 }}>月份</Text>
                <DatePicker picker="month" value={shipEdit.calcMonth ? dayjs(shipEdit.calcMonth + '-01') : undefined}
                  onChange={v => updateShipField('calcMonth', v ? v.format('YYYY-MM') : '')} style={{ width: '100%' }} />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实发单数</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.realOrders} onChange={v => updateShipField('realOrders', v || 0)} controls={false} min={0} />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实发数量</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.realQty} onChange={v => updateShipField('realQty', v || 0)} controls={false} min={0} />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实退单数</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.returnOrders} onChange={v => updateShipField('returnOrders', v || 0)} controls={false} min={0} />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实退数量</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.returnQty} onChange={v => updateShipField('returnQty', v || 0)} controls={false} min={0} />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实发成本</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.realCost} onChange={v => updateShipField('realCost', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实发金额 <Tooltip title="实际发货订单的销售金额（建议按照发货时间导入）"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.realAmount} onChange={v => updateShipField('realAmount', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>运费支出</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.freightCost} onChange={v => updateShipField('freightCost', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实退成本</Text>
                <InputNumber style={{ width: '100%' }} value={shipEdit.returnCost} onChange={v => updateShipField('returnCost', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>发货费用 <Tooltip title="根据所属平台自动计算"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ color: '#fa8c16', fontSize: 16 }}>¥{fmt(calcLaborCost(shipEdit))}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>（{getShopPlatform(shipEdit.shopId, shipEdit.shopName) || '未设置平台'}自动计算）</Text>
                </div>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* ============ 退货金额弹窗 ============ */}
      <Modal title={retIsCreating ? '新增退货记录' : '编辑退货记录'} open={retEditVisible}
        onCancel={() => setRetEditVisible(false)} onOk={handleRetSave}
        okText="保存" cancelText="取消" width={520}>
        {retEdit && (
          <div>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={8}><Text style={{ display: 'block', marginBottom: 4 }}>店铺名称</Text>
                <Select value={retEdit.shopId} onChange={v => updateRetField('shopId', v)} style={{ width: '100%' }}
                  options={shops.map(s => ({ value: s.key, label: s.shopName }))} placeholder="选择店铺" />
              </Col>
              <Col span={8}><Text style={{ display: 'block', marginBottom: 4 }}>负责人</Text>
                <Input value={retEdit.chargePerson || getShopPerson(retEdit.shopId, retEdit.shopName)} readOnly style={{ background: '#fafafa' }} placeholder="根据店铺自动匹配" />
              </Col>
              <Col span={8}><Text style={{ display: 'block', marginBottom: 4 }}>售后单号 <Tooltip title="导入时若重复则更新已有记录"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <Input value={retEdit.afterSalesNo} onChange={e => updateRetField('afterSalesNo', e.target.value)} placeholder="请输入售后单号" />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>最后确认日期 <Text type="danger">*</Text> <Tooltip title="售后确认收到退货的日期"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <DatePicker value={retEdit.confirmDate ? dayjs(retEdit.confirmDate) : undefined}
                  onChange={v => updateRetField('confirmDate', v ? v.format('YYYY-MM-DD') : '')} style={{ width: '100%' }} placeholder="选择确认日期" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>确认月份 <Tooltip title="数据源：从最后确认日期中自动提取"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <Input value={retEdit.calcMonth} readOnly style={{ background: '#fafafa' }} />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>线上订单号</Text>
                <Input value={retEdit.onlineOrderNo} onChange={e => updateRetField('onlineOrderNo', e.target.value)} placeholder="请输入订单号" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>商品编码</Text>
                <Input value={retEdit.productCode} onChange={e => updateRetField('productCode', e.target.value)} placeholder="请输入商品编码" />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>成本价</Text>
                <InputNumber style={{ width: '100%' }} value={retEdit.costPrice} onChange={v => updateRetField('costPrice', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实退数量</Text>
                <InputNumber style={{ width: '100%' }} value={retEdit.returnQty} onChange={v => updateRetField('returnQty', v || 0)} controls={false} min={0} />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实退成本金额</Text>
                <InputNumber style={{ width: '100%', background: '#fafafa' }} value={retEdit.returnAmount} readOnly controls={false} precision={2} prefix="¥" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>实际收货金额</Text>
                <InputNumber style={{ width: '100%' }} value={retEdit.actualReceiptAmount} onChange={v => updateRetField('actualReceiptAmount', v || 0)} controls={false} precision={2} prefix="¥" />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>订单支付日期 <Tooltip title="订单实际付款的日期"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <DatePicker value={retEdit.payDate ? dayjs(retEdit.payDate) : undefined}
                  onChange={v => updateRetField('payDate', v ? v.format('YYYY-MM-DD') : '')} style={{ width: '100%' }} placeholder="选择支付日期" />
              </Col>
              <Col span={12}><Text style={{ display: 'block', marginBottom: 4 }}>支付月份 <Tooltip title="从订单支付日期自动提取，不可导入"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></Text>
                <Input value={retEdit.payMonth} readOnly style={{ background: '#fafafa' }} />
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* ============ 字段配置弹窗 ============ */}
      {(() => {
        const renderFieldConfig = (visible: boolean, setVisible: (v: boolean) => void, allFields: { key: string; label: string }[], fieldOrder: string[], setFieldOrder: (v: string[]) => void, fieldVis: Record<string, boolean>, setFieldVis: (v: Record<string, boolean>) => void, save: (o: string[], v: Record<string, boolean>) => void) => (
          <FieldConfigModal
            open={visible}
            fields={allFields}
            order={fieldOrder}
            visibility={fieldVis}
            onCancel={() => setVisible(false)}
            onSave={(o, v) => { setFieldOrder(o); setFieldVis(v); save(o, v); setVisible(false); message.success('已保存'); }}
          />
        );
        return (<>
          {renderFieldConfig(shipFieldConfigVisible, setShipFieldConfigVisible, SHIP_ALL_FIELDS, shipFieldOrder, setShipFieldOrder, shipFieldVis, setShipFieldVis, saveShipFieldConfig)}
          {renderFieldConfig(retFieldConfigVisible, setRetFieldConfigVisible, RET_ALL_FIELDS, retFieldOrder, setRetFieldOrder, retFieldVis, setRetFieldVis, saveRetFieldConfig)}
        </>);
      })()}

      {/* ============ 发货金额导入弹窗 ============ */}
      {renderImportModal({
        visible: shipImportVisible, setVisible: setShipImportVisible,
        title: '导入发货金额', allFields: SHIP_ALL_FIELDS.filter(f => !['totalShipCost', 'laborCost', 'platform', 'calcMonth'].includes(f.key)), fieldMap: SHIP_FIELD_MAP,
        importData: shipImportData, setImportData: setShipImportData,
        importFileName: shipImportFileName, setImportFileName: setShipImportFileName,
        fieldMatch: shipFieldMatch, setFieldMatch: setShipFieldMatch,
        progress: shipImportProgress, importing: shipImporting,
        onConfirm: handleShipImportConfirm, onDownloadTemplate: downloadShipTemplate,
        extraContent: (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>导入月份 <Text type="danger">*</Text></Text>
            <DatePicker picker="month" value={shipImportMonth ? dayjs(shipImportMonth + '-01') : undefined}
              onChange={v => setShipImportMonth(v ? v.format('YYYY-MM') : '')}
              style={{ width: 200 }} placeholder="请选择月份" />
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>必填，导入数据将关联此月份</Text>
          </div>
        ),
      })}

      {/* ============ 退货金额导入弹窗 ============ */}
      {renderImportModal({
        visible: retImportVisible, setVisible: setRetImportVisible,
        title: '导入退货金额', allFields: RET_ALL_FIELDS.filter(f => f.key !== 'payMonth'), fieldMap: RET_FIELD_MAP,
        importData: retImportData, setImportData: setRetImportData,
        importFileName: retImportFileName, setImportFileName: setRetImportFileName,
        fieldMatch: retFieldMatch, setFieldMatch: setRetFieldMatch,
        progress: retImportProgress, importing: retImporting,
        onConfirm: handleRetImportConfirm, onDownloadTemplate: downloadRetTemplate,
      })}

      {/* ============ 人工单价配置弹窗 ============ */}
      <Modal title={<span><SettingOutlined style={{ marginRight: 8, color: PRIMARY }} />发货费用配置</span>}
        open={pricingModalVisible} onCancel={() => setPricingModalVisible(false)}
        onOk={() => setPricingModalVisible(false)} okText="关闭" width={600}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>为不同平台配置发货费用计算方式。发货费用 = 实发单数(或实发数量) × 单价</div>
        <Table bordered size="small" dataSource={Object.entries(platformPricing).map(([platform, config]) => ({ key: platform, platform, ...config }))}
          pagination={false}
          columns={[
            { title: '平台', dataIndex: 'platform', key: 'platform', width: 120 },
            { title: '计算基数', key: 'type', width: 140,
              render: (_: any, r: any) => (
                <Select size="small" value={r.type} onChange={v => {
                  const next = { ...platformPricing, [r.platform]: { ...platformPricing[r.platform], type: v } };
                  savePlatformPricing(next);
                }} style={{ width: 120 }} options={[{ value: 'orders', label: '按实发单数' }, { value: 'qty', label: '按实发数量' }]} />
              ) },
            { title: '单价 (¥)', key: 'price', width: 120,
              render: (_: any, r: any) => (
                <InputNumber size="small" value={r.price} onChange={v => {
                  const next = { ...platformPricing, [r.platform]: { ...platformPricing[r.platform], price: Number(v) || 0 } };
                  savePlatformPricing(next);
                }} controls={false} precision={2} min={0} style={{ width: 100 }} prefix="¥" />
              ) },
            { title: '公式说明', key: 'formula', width: 180,
              render: (_: any, r: any) => <Text type="secondary" style={{ fontSize: 12 }}>{r.type === 'orders' ? '实发单数' : '实发数量'} × ¥{r.price}</Text> },
            { title: '操作', key: 'action', width: 60,
              render: (_: any, r: any) => (
                <Popconfirm title="确认删除？" onConfirm={() => {
                  const next = { ...platformPricing }; delete next[r.platform]; savePlatformPricing(next);
                }} okText="确认" cancelText="取消">
                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              ) },
          ]} />
        <div style={{ marginTop: 12 }}>
          <Space>
            <Input value={newPlatformName} onChange={e => setNewPlatformName(e.target.value)} placeholder="输入平台名称" style={{ width: 140 }} />
            <Select value={newPlatformType} onChange={v => setNewPlatformType(v)} style={{ width: 120 }}
              options={[{ value: 'orders', label: '按实发单数' }, { value: 'qty', label: '按实发数量' }]} />
            <InputNumber value={newPlatformPrice} onChange={v => setNewPlatformPrice(Number(v) || 0)} placeholder="单价" style={{ width: 100 }} controls={false} precision={2} min={0} prefix="¥" />
            <Button type="primary" onClick={() => {
              const name = newPlatformName.trim();
              if (!name) { message.warning('请输入平台名称'); return; }
              const next = { ...platformPricing, [name]: { type: newPlatformType, price: newPlatformPrice } };
              savePlatformPricing(next);
              setNewPlatformName(''); setNewPlatformPrice(0);
              message.success(`已添加 ${name}`);
            }}>添加平台</Button>
          </Space>
        </div>
      </Modal>

      {/* ============ 退货费用设置弹窗 ============ */}
      <Modal title={<span><SettingOutlined style={{ marginRight: 8, color: PRIMARY }} />退货费用设置</span>}
        open={retFeeModalVisible} onCancel={() => setRetFeeModalVisible(false)}
        onOk={() => { saveReturnFeeConfig(tempFeePrice, tempFeeMode); setRetFeeModalVisible(false); message.success('退货费用设置已保存'); }}
        okText="保存" cancelText="取消" width={420}>
        <div style={{ marginBottom: 16 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>计算方式</Text>
          <Select value={tempFeeMode} onChange={v => setTempFeeMode(v)} style={{ width: '100%' }}
            options={[
              { value: 'perOrder', label: '按笔计算（每笔退货固定费用）' },
              { value: 'perQty', label: '按数量计算（退货数量 × 单价）' },
            ]} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>费用单价</Text>
          <InputNumber style={{ width: '100%' }} value={tempFeePrice} onChange={v => setTempFeePrice(Number(v) || 0)}
            controls={false} precision={2} min={0} prefix="¥" />
          <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
            {tempFeeMode === 'perOrder'
              ? '每笔退货记录显示该固定费用金额。'
              : '退货费用 = 退货数量 × 单价，按商品数量计算。'}
          </div>
        </div>
      </Modal>

      {/* ============ 发货金额 - 退货费用设置弹窗 ============ */}
      <Modal title={<span><SettingOutlined style={{ marginRight: 8, color: PRIMARY }} />退货费用设置</span>}
        open={shipRetFeeModalVisible} onCancel={() => setShipRetFeeModalVisible(false)}
        onOk={() => { saveShipReturnFeeConfig(tempShipFeePrice, tempShipFeeMode); setShipRetFeeModalVisible(false); message.success('退货费用设置已保存'); }}
        okText="保存" cancelText="取消" width={420}>
        <div style={{ marginBottom: 16 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>计算方式</Text>
          <Select value={tempShipFeeMode} onChange={v => setTempShipFeeMode(v)} style={{ width: '100%' }}
            options={[
              { value: 'perOrder', label: '按实退单数计算（实退单数 × 单价）' },
              { value: 'perQty', label: '按实退数量计算（实退数量 × 单价）' },
            ]} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>费用单价</Text>
          <InputNumber style={{ width: '100%' }} value={tempShipFeePrice} onChange={v => setTempShipFeePrice(Number(v) || 0)}
            controls={false} precision={2} min={0} prefix="¥" />
          <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
            {tempShipFeeMode === 'perOrder'
              ? '退货费用 = 实退单数 × 单价'
              : '退货费用 = 实退数量 × 单价'}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MonthEndCheckPage;