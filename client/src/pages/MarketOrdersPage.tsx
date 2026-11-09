import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, Table, Tag, Typography, Empty, Input, Button, Modal, Descriptions, Image, InputNumber, Select, Space, message, Radio, Upload, Tooltip } from 'antd';
import { SearchOutlined, ReloadOutlined, EyeOutlined, PlusOutlined, SendOutlined, DeleteOutlined, UploadOutlined, FileTextOutlined, SettingOutlined, RollbackOutlined, EditOutlined, DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { isInstallmentOrder, depositAmountOf, sumPayRecords, mergePayRecords, payProgressText, postInstallmentEffects, postShipCostEntry, installmentStatusOf } from '../utils/receiptWrite';
import type { PayRecord } from '../utils/receiptWrite';
import { saveDataset } from '../utils/dataStore';
import { reloadAfterPull } from '../utils/serverSync';
import { loadSupplierProducts, loadSupplierFinishedProducts } from '../utils/supplierProducts';
import { QtyTemplateManagerModal, QtyFillConfirmModal, loadQtyTemplates, saveQtyTemplates, QtyTemplate } from '../components/QtyTemplateModals';
import FieldConfigModal, { FieldConfigItem } from '../components/FieldConfigModal';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const TRADE_KEY = 'market_trade_orders';
const PUSHED_KEY = 'purchaser_pushed_orders';

const loadJson = (k: string, d: any = []) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; }
};
const safeSetItem = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

interface OrderItem {
  productCode: string;
  shortName: string;
  styleCode: string;
  color: string;
  spec: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  image?: string;
  uid?: string;
}

// 货品明细可配置字段（显示/隐藏 + 顺序）
const ITEM_FIELD_DEFS: FieldConfigItem[] = [
  { key: 'image', label: '图片' },
  { key: 'productCode', label: '商品编码' },
  { key: 'shortName', label: '商品名称' },
  { key: 'styleCode', label: '款式编码' },
  { key: 'color', label: '颜色' },
  { key: 'spec', label: '规格' },
  { key: 'quantity', label: '数量' },
  { key: 'unitPrice', label: '单价' },
  { key: 'subtotal', label: '小计' },
];
const ITEM_FIELD_DEFAULT_ORDER = ITEM_FIELD_DEFS.map(f => f.key);
const genItemUid = () => `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// 订单列表可配置字段（显示/隐藏 + 顺序）
const ORDER_LIST_FIELD_DEFS: FieldConfigItem[] = [
  { key: 'id', label: '订单编号' },
  { key: 'supplier', label: '供应商' },
  { key: 'items', label: '货品数' },
  { key: 'detail', label: '货品明细' },
  { key: 'total', label: '订单金额' },
  { key: 'status', label: '订单状态' },
  { key: 'source', label: '订单来源' },
  { key: 'createTime', label: '下单时间' },
  { key: 'shippingMark', label: '唛头' },
  { key: 'creator', label: '创建人' },
  { key: 'payProgress', label: '付款进度' },
];
const ORDER_LIST_DEFAULT_ORDER = ORDER_LIST_FIELD_DEFS.map(f => f.key);
const ORDER_LIST_DEFAULT_WIDTH: Record<string, number> = { id: 140, supplier: 180, items: 80, detail: 260, total: 110, status: 100, source: 100, createTime: 160, shippingMark: 120, creator: 100, payProgress: 150 };

// 读取字段配置（顺序+显隐），含旧配置迁移补全
const loadFieldCfg = (key: string, defaultOrder: string[]) => {
  const vis: Record<string, boolean> = {};
  defaultOrder.forEach(k => { vis[k] = true; });
  let order = [...defaultOrder];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && Array.isArray(raw.order)) {
      order = raw.order.filter((k: string) => defaultOrder.includes(k));
      defaultOrder.forEach(k => { if (!order.includes(k)) order.push(k); });
    }
    if (raw && raw.visibility && typeof raw.visibility === 'object') {
      defaultOrder.forEach(k => { if (typeof raw.visibility[k] === 'boolean') vis[k] = raw.visibility[k]; });
    }
  } catch { /* ignore */ }
  return { order, visibility: vis };
};

// 可拖拽调宽的表头单元格（列宽自由调整）
const ResizableHeaderCell = (props: any) => {
  const { onResize, width, ...rest } = props;
  return (
    <th {...rest} style={{ ...rest.style, position: 'relative' }}>
      {rest.children}
      {onResize && width ? (
        <span
          onMouseDown={(e: any) => {
            e.preventDefault(); e.stopPropagation();
            const startX = e.pageX; const startW = width;
            const move = (ev: any) => onResize(Math.max(60, startW + ev.pageX - startX));
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
          }}
          style={{ position: 'absolute', top: 0, right: -4, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 6 }}
        />
      ) : null}
    </th>
  );
};

// 采购商平台 - 订单管理：成品市场下单生成的交易订单 + 手动新增订单（同步推送供应商订单管理）
const MarketOrdersPage: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  // 订单创建人：当前登录用户显示名（联系人 > 公司名 > 账号）
  const currentDisplayName = useMemo(() => {
    try {
      const u = JSON.parse(localStorage.getItem('registeredUsers') || '[]').find((x: any) => x.username === username);
      return u?.contactPerson || u?.companyName || username;
    } catch { return username; }
  }, [username]);
  const [orders, setOrders] = useState<any[]>([]);
  const [sKw, setSKw] = useState('');
  const [apKw, setApKw] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 新增订单弹窗
  const [addVisible, setAddVisible] = useState(false);
  const [addSupplier, setAddSupplier] = useState('');
  const [creditRefreshKey, setCreditRefreshKey] = useState(0); // 额度计算刷新触发器
  const [addItems, setAddItems] = useState<OrderItem[]>([]);
  const [addBuyerMessage, setAddBuyerMessage] = useState('');
  const [addShippingMark, setAddShippingMark] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const [addPayMethod, setAddPayMethod] = useState('余额支付');
  const [addDepositRatio, setAddDepositRatio] = useState(30);
  // 分段付款：登记本期付款弹窗
  const [payRegTarget, setPayRegTarget] = useState<any>(null);
  const [payRegAmount, setPayRegAmount] = useState<number | null>(null);
  const [payRegBank, setPayRegBank] = useState('');
  const [payRegShot, setPayRegShot] = useState('');
  const [addImages, setAddImages] = useState<string[]>([]);
  const [addReceiverName, setAddReceiverName] = useState('');
  const [addReceiverPhone, setAddReceiverPhone] = useState('');
  const [addProvince, setAddProvince] = useState('');
  const [addCity, setAddCity] = useState('');
  const [addDistrict, setAddDistrict] = useState('');
  const [addAddressDetail, setAddAddressDetail] = useState('');
  const [addSelectedBank, setAddSelectedBank] = useState('');
  const [addPayScreenshots, setAddPayScreenshots] = useState<string[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  // 供应商收款信息（银行转账时显示）
  const [addSupplierPayBankInfo, setAddSupplierPayBankInfo] = useState('');
  const [addSupplierPayQrImage, setAddSupplierPayQrImage] = useState('');
  const [addPayChannel, setAddPayChannel] = useState<'bank' | 'qr'>('bank');
  // 添加商品弹窗（选择供应商货品）
  const [pickProductVisible, setPickProductVisible] = useState(false);
  const [pickSearchKw, setPickSearchKw] = useState('');
  const [pickSelected, setPickSelected] = useState<React.Key[]>([]);
  // 数量模版
  const [qtyTemplates, setQtyTemplates] = useState<QtyTemplate[]>([]);
  const [qtyTemplateVisible, setQtyTemplateVisible] = useState(false);
  const [qtyFillVisible, setQtyFillVisible] = useState(false);
  const [qtyFillTemplate, setQtyFillTemplate] = useState<QtyTemplate | null>(null);
  const [qtyFillMultiplier, setQtyFillMultiplier] = useState(1);
  // 货品明细：行勾选 + 字段显示/顺序配置
  const [addItemSelected, setAddItemSelected] = useState<React.Key[]>([]);
  const [itemFieldConfigVisible, setItemFieldConfigVisible] = useState(false);
  const itemFieldKey = `marketOrderItemFields_${localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || username) : username}`;
  const [itemFieldCfg, setItemFieldCfg] = useState<{ order: string[]; visibility: Record<string, boolean> }>(() => loadFieldCfg(itemFieldKey, ITEM_FIELD_DEFAULT_ORDER));
  // 订单列表：字段显示/顺序配置 + 分字段搜索 + 列宽
  const listFieldKey = `marketOrderListFields_${localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || username) : username}`;
  const [listFieldCfg, setListFieldCfg] = useState<{ order: string[]; visibility: Record<string, boolean> }>(() => loadFieldCfg(listFieldKey, ORDER_LIST_DEFAULT_ORDER));
  const [listFieldConfigVisible, setListFieldConfigVisible] = useState(false);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...ORDER_LIST_DEFAULT_WIDTH });
  const [pageSize, setPageSize] = useState(20);
  // 表体高度：横向滚动条+页码钉在窗口底部，数据少时留白在表体内部（min-height 锁死）
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tbodyH, setTbodyH] = useState(320);
  const [rootH, setRootH] = useState<number | null>(null);
  const [padB, setPadB] = useState(0);
  useEffect(() => {
    const calc = () => {
      const wrap = tableWrapRef.current;
      if (!wrap) return;
      const body = wrap.querySelector('.ant-table-body') as HTMLElement | null;
      const top = body ? body.getBoundingClientRect().top : wrap.getBoundingClientRect().top + 55;
      // 视口基准：预留分页器 40（32 高 + 8 上边距），底部不留白，横向滚动条与页码紧贴窗口底部
      setTbodyH(Math.max(200, window.innerHeight - top - 40));
      // 根容器精确等于视口剩余高度，并用负外边距吃掉父级 Content 的底部内边距，消除页面级滚动条与底部空白行
      const root = rootRef.current;
      if (root) {
        const rTop = root.getBoundingClientRect().top;
        let pb = 0;
        const content = root.closest('.ant-layout-content') as HTMLElement | null;
        if (content) pb = parseFloat(getComputedStyle(content).paddingBottom) || 0;
        setPadB(pb);
        setRootH(Math.max(300, window.innerHeight - rTop + pb));
      }
    };
    calc();
    const t = setTimeout(calc, 300);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t); window.removeEventListener('resize', calc); };
  }, []);

  const reload = useCallback(() => {
    const all: any[] = loadJson(TRADE_KEY, []);
    const pushed: any[] = loadJson(PUSHED_KEY, []);
    const merged = [...all.filter(o => o.purchaserUsername === username || o.supplierUsername === username)];
    pushed.filter(o => o.purchaserUsername === username).forEach(o => {
      const idx = merged.findIndex(m => m.key === o.key);
      // 同 key 重复时（历史推送副本）以「已推送」版本为准，避免列表残留待推送旧态
      if (idx >= 0) { if (o.status === '已推送') merged[idx] = { ...merged[idx], ...o }; }
      else merged.push(o);
    });
    setOrders(merged);
  }, [username]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === TRADE_KEY || e.key === PUSHED_KEY) reload(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reload]);

  // 加载银行账户列表
  const reloadBankAccounts = useCallback(() => {
    const owner = localStorage.getItem('isSubAccount') === 'true'
      ? (localStorage.getItem('parentAccount') || username) : username;
    try { setBankAccounts(JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${owner}`) || '[]')); } catch { setBankAccounts([]); }
  }, [username]);

  useEffect(() => { reloadBankAccounts(); }, [reloadBankAccounts]);

  // 加载数量模版
  const dataOwner = useMemo(() => {
    return localStorage.getItem('isSubAccount') === 'true'
      ? (localStorage.getItem('parentAccount') || username) : username;
  }, [username]);

  useEffect(() => { setQtyTemplates(loadQtyTemplates(dataOwner)); }, [dataOwner]);

  const handleQtyTemplateChange = useCallback((list: QtyTemplate[]) => {
    setQtyTemplates(list);
    saveQtyTemplates(dataOwner, list);
  }, [dataOwner]);

  const openQtyFill = useCallback((t: QtyTemplate) => {
    setQtyFillTemplate(t);
    setQtyFillMultiplier(1);
    setQtyFillVisible(true);
    setQtyTemplateVisible(false);
  }, []);

  const confirmQtyFill = useCallback((mult: number) => {
    if (!qtyFillTemplate) return;
    // 填充数量模版仅作用于勾选行：未勾选时提示先勾选
    if (!addItemSelected.length) { message.warning('请先勾选需要填充数量的商品行'); return; }
    const sel = new Set(addItemSelected.map(String));
    let filled = 0;
    const updated = addItems.map(item => {
      if (!sel.has(String(item.uid || ''))) return item;
      const match = qtyFillTemplate.rows.find(r => r.spec === item.spec || item.productCode.includes(r.spec));
      if (match) {
        filled++;
        return { ...item, quantity: match.qty * (mult || 1) };
      }
      return item;
    });
    setAddItems(updated);
    setQtyFillVisible(false);
    message.success(`已填充 ${filled} 个勾选商品的数量`);
  }, [qtyFillTemplate, addItems, addItemSelected]);

  // 公司信息（默认填充收货地址）
  const companyInfo = useMemo(() => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const me = users.find(u => u.username === username);
      return {
        contactPerson: me?.contactPerson || '',
        phone: me?.phone || '',
        province: me?.province || '',
        city: me?.city || '',
        district: me?.district || '',
        addressDetail: me?.addressDetail || me?.businessAddress || me?.companyAddress || '',
      };
    } catch { return { contactPerson: '', phone: '', province: '', city: '', district: '', addressDetail: '' }; }
  }, [username]);

  // 供应商列表（仅显示已合作的供应商）
  const supplierOptions = useMemo(() => {
    try {
      const owner = localStorage.getItem('isSubAccount') === 'true'
        ? (localStorage.getItem('parentAccount') || username)
        : username;
      // 从采购商供应商列表获取已合作的供应商名称
      const supplierList: any[] = JSON.parse(localStorage.getItem(`purchaser_suppliers_${owner}`) || '[]');
      const approvedNames = new Set(
        supplierList.filter(s => s.cooperationStatus === 'approved').map(s => s.supplierName)
      );
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return users
        .filter(u => u.role === 'supplier' && u.username !== username && approvedNames.has(u.companyName))
        .map(u => ({
          value: u.username,
          label: u.companyName || u.username,
        }));
    } catch { return []; }
  }, [username]);

  // 供应商选择变化时加载其收款信息（银行账户 + 收款码）
  useEffect(() => {
    if (!addSupplier) {
      setAddSupplierPayBankInfo('');
      setAddSupplierPayQrImage('');
      setAddPayChannel('bank');
      return;
    }
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const supUser = users.find(u => u.username === addSupplier);
      setAddSupplierPayBankInfo(supUser?.payBankInfo || '');
      setAddSupplierPayQrImage(supUser?.payQrImage || '');
      // 默认勾选：有银行账户则选 bank，否则选 qr
      setAddPayChannel(supUser?.payBankInfo ? 'bank' : 'qr');
    } catch { /* ignore */ }
  }, [addSupplier]);

  // 当前供应商的商品列表（本地优先，缺失时服务端数据集兜底拉取，保证跨浏览器可见）
  const [supplierProducts, setSupplierProducts] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!addSupplier) { setSupplierProducts([]); return; }
    loadSupplierFinishedProducts(addSupplier)
      .then(list => { if (!cancelled) setSupplierProducts(list); })
      .catch(() => { if (!cancelled) setSupplierProducts([]); });
    return () => { cancelled = true; };
  }, [addSupplier]);

  const filteredProducts = useMemo(() => {
    if (!pickSearchKw.trim()) return supplierProducts;
    const kw = pickSearchKw.trim().toLowerCase();
    return supplierProducts.filter(p =>
      `${p.productCode || ''} ${p.shortName || ''} ${p.name || ''} ${p.styleCode || ''} ${p.color || ''} ${p.spec || ''}`.toLowerCase().includes(kw)
    );
  }, [supplierProducts, pickSearchKw]);

  const filtered = useMemo(() => {
    let list = orders;
    if (apKw.trim()) {
      const kw = apKw.trim().toLowerCase();
      list = list.filter(o => `${o.id} ${o.supplierCompany} ${o.purchaserCompany}`.toLowerCase().includes(kw));
    }
    // 分字段搜索（点击查询后生效）
    if (Object.values(appliedFilters).some(v => v && v.trim())) {
      list = list.filter(o => {
        const vals: Record<string, string> = {
          id: String(o.id || ''),
          supplier: `${o.supplierCompany || ''} ${o.purchaserCompany || ''}`,
          items: String((o.items || []).length),
          detail: (o.items || []).map((x: any) => `${x.shortName}${x.color ? '-' + x.color : ''}${x.spec ? '-' + x.spec : ''}×${x.quantity}`).join('，'),
          total: String(Number(o.totalAmount) || 0),
          status: String(o.status || ''),
          source: String(o.orderSource || '成品市场'),
          createTime: dayjs(o.createTime).format('YYYY-MM-DD HH:mm'),
          shippingMark: String(o.shippingMark || ''),
          creator: String(o.creator || ''),
        };
        return Object.keys(appliedFilters).every(k => {
          const fv = (appliedFilters[k] || '').trim();
          if (!fv) return true;
          return (vals[k] || '').toLowerCase().includes(fv.toLowerCase());
        });
      });
    }
    // 新订单默认显示在最上面
    return [...list].sort((a, b) => String(b.createTime || '').localeCompare(String(a.createTime || '')));
  }, [orders, apKw, appliedFilters]);

  const getSupplierOwner = (supplierUsername: string): string => supplierUsername;

  // 推送校验
  const validatePush = async (order: any): Promise<string | null> => {
    if (!order.supplierUsername) return '请先选择供应商';
    const supplierOwner = getSupplierOwner(order.supplierUsername);
    const supplierProductList = await loadSupplierProducts(supplierOwner);
    if (supplierProductList.length === 0) return `供应商 ${order.supplierCompany} 没有商品列表数据`;
    for (const item of (order.items || [])) {
      const prod = supplierProductList.find((p: any) => p.productCode === item.productCode);
      if (!prod) return `商品 ${item.productCode || item.shortName} 在供应商 ${order.supplierCompany} 商品列表中不存在，无法推送`;
      if (!prod.suggestedPrice || Number(prod.suggestedPrice) <= 0) return `商品 ${item.productCode || item.shortName} 未设置基础售价，无法推送`;
    }
    const credit = calcSupplierCredit(order.supplierUsername);
    const occupation = calcOccupation(order.supplierUsername);
    const e = getPaySummary(order.supplierUsername);
    const paidTotal = e?.paidTotal || 0;
    const purchaseTotal = e?.purchaseTotal || 0;
    const remYuan = credit - (purchaseTotal / 100) + (paidTotal / 100) - occupation;
    const remaining = Math.round(remYuan * 100) / 100;
    if (order.totalAmount > remaining) return `供应商剩余额度 ¥${remaining.toFixed(2)} 不足以支付本订单 ¥${order.totalAmount}，无法推送`;
    return null;
  };

  const calcSupplierCredit = (supplierUsername: string): number => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const me = users.find(u => u.username === username);
      const myName = String(me?.companyName || username || '');
      const custs: any[] = JSON.parse(localStorage.getItem('customers_' + supplierUsername) || '[]');
      const bps: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + supplierUsername) || '[]');
      let base = 0;
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
      const adjs: any[] = JSON.parse(localStorage.getItem('credit_adjustments_' + supplierUsername) || '[]');
      const net = adjs.filter((r: any) => (adjId && r.customerId === adjId) || (adjName && r.customerName === adjName))
        .reduce((sum: number, r: any) => sum + (r.type === 'increase' ? r.amount : -r.amount), 0);
      return Math.round((base + net) * 100) / 100;
    } catch { return 0; }
  };

  const calcOccupation = (supplierUsername: string): number => {
    const pushed: any[] = loadJson(PUSHED_KEY, []);
    return pushed.filter(o => o.supplierUsername === supplierUsername && o.status === '已推送')
      .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
  };

  const getPaySummary = (supplierUsername: string): { purchaseTotal: number; paidTotal: number } | null => {
    try {
      // 使用 dataOwner 而非 username，以支持子账号场景
      const owner = localStorage.getItem('isSubAccount') === 'true'
        ? (localStorage.getItem('parentAccount') || username) : username;
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const supUser = users.find(u => u.username === supplierUsername);
      // 候选供应商名称集合：注册公司名 + 采购商供应商列表名称（账单/快照的写入来源），防名称口径漂移
      const candidates = new Set<string>();
      if (supUser?.companyName) candidates.add(String(supUser.companyName).trim());
      candidates.add(String(supplierUsername).trim());
      const supList: any[] = JSON.parse(localStorage.getItem(`purchaser_suppliers_${owner}`) || '[]');
      supList.forEach((s: any) => {
        const nm = String(s?.supplierName || '').trim();
        if (!nm) return;
        const ru = users.find((u: any) => u.companyName === nm);
        if (ru?.username === supplierUsername || nm === String(supUser?.companyName || '').trim()) candidates.add(nm);
      });
      const names = Array.from(candidates);
      const matchName = (v: any) => names.some(n => String(v || '').trim() === n);

      // 1. 付款汇总快照（key 为采购商 owner，条目 key 为供应商名称）
      const raw = localStorage.getItem(`supplier_pay_summary_${owner}`);
      if (raw) {
        const summary = JSON.parse(raw);
        for (const n of names) if (summary[n]) return summary[n];
        const hitKey = Object.keys(summary).find(k => matchName(k));
        if (hitKey) return summary[hitKey];
      }
      // 2. 回退：直接从账单累加采购金额 + 从付款台账累加已付货款
      const bills: any[] = JSON.parse(localStorage.getItem(`purchaser_bills_${owner}`) || '[]');
      const pays: any[] = JSON.parse(localStorage.getItem(`supplier_payments_${owner}`) || '[]');
      let purchaseTotal = 0; let paidTotal = 0;
      bills.forEach(b => { if (matchName(b?.supplier) || matchName(b?.supplierName)) purchaseTotal += Math.round((Number(b.totalAmount) || 0) * 100); });
      pays.forEach(p => { if (matchName(p?.supplierName)) paidTotal += Math.round((Number(p?.amountCents ?? (Number(p?.amount) || 0) * 100)) || 0); });
      return { purchaseTotal, paidTotal };
    } catch { return null; }
  };

  // 推送执行
  const handlePush = async () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择需要推送的订单'); return; }
    const toPush = orders.filter(o => selectedRowKeys.includes(o.key) && o.status === '待推送');
    if (toPush.length === 0) { message.warning('选中的订单中没有可推送的（仅"待推送"状态可推送）'); return; }
    for (const order of toPush) {
      const err = await validatePush(order);
      if (err) { Modal.error({ title: '推送校验失败', content: `${order.id}: ${err}` }); return; }
    }
    Modal.confirm({
      title: '推送订单',
      content: `确定推送选中的 ${toPush.length} 条订单到对应供应商？推送后将从供应商信用额度中扣除相应金额。`,
      okText: '确定推送', cancelText: '取消',
      onOk: () => {
        const now = dayjs().format('YYYY-MM-DD HH:mm');
        const pushed: any[] = loadJson(PUSHED_KEY, []);
        toPush.forEach(order => {
          const supplierOwner = getSupplierOwner(order.supplierUsername);
          // 手动新增订单本体就在 PUSHED_KEY 中：原地更新状态，避免同 key 重复副本导致列表仍显待推送
          const existIdx = pushed.findIndex(p => p.key === order.key);
          const baseOrder = existIdx >= 0 ? pushed[existIdx] : order;
          // 推送日志：追加到订单 orderLog（供应商发货/状态同步等后续日志同键续写）
          const pushLogs: any[] = (() => { try { return JSON.parse(baseOrder.orderLog || '[]'); } catch { return []; } })();
          pushLogs.push({ time: new Date().toLocaleString('zh-CN'), action: '推送订单', operator: currentDisplayName, detail: `推送至供应商 ${order.supplierCompany || order.supplierUsername || ''}` });
          const pushedOrder = { ...baseOrder, status: '已推送', pushTime: now, orderLog: JSON.stringify(pushLogs) };
          if (existIdx >= 0) pushed[existIdx] = pushedOrder; else pushed.push(pushedOrder);
          const omKey = `pageData_sales_order-manage_${supplierOwner}`;
          let omList: any[] = [];
          try { omList = JSON.parse(localStorage.getItem(omKey) || '[]'); } catch { /* ignore */ }
          // 银行转账：货款尚未经供应商确认到账，先置待付款；由供应商侧自动生成收款确认单，确认到账后才写银行流水/分录并转为已付款
          const isBankTransfer = !isInstallmentOrder(order) && String(order.payMethod || '') === '银行转账';
          const supplierOrder = {
            key: `push_${order.key}`,
            id: order.id,
            customerName: order.purchaserCompany,
            // 余额支付直接已付款；分段付款保持待付款按分期台账收款；银行转账待确认到账
            orderStatus: isInstallmentOrder(order) || isBankTransfer ? '待付款' : '已付款',
            paidAmount: isInstallmentOrder(order) ? sumPayRecords(order.payRecords) : (isBankTransfer ? 0 : Number(order.totalAmount) || 0),
            auditStatus: isInstallmentOrder(order) || isBankTransfer ? '' : (String(order.payMethod || '余额支付') === '余额支付' ? '' : '待财务审核'),
            payConfirmed: isBankTransfer ? false : undefined,
            payPlan: isInstallmentOrder(order) ? 'installment' : 'full',
            depositRatio: order.depositRatio || 30,
            payRecords: order.payRecords || [],
            orderItems: JSON.stringify(order.items.map((it: OrderItem) => ({
              productCode: it.productCode, shortName: it.shortName, styleCode: it.styleCode,
              color: it.color, spec: it.spec, quantity: it.quantity, price: it.unitPrice, amount: it.amount,
            }))),
            productDetail: order.items.map((it: OrderItem) => `${it.shortName}${it.color ? '-' + it.color : ''}${it.spec ? '-' + it.spec : ''}×${it.quantity}`).join('，'),
            totalAmount: order.totalAmount,
            // 供应商端「货品总额/货品总数」列读 productAmount/palletCount，推送时必须写入否则显示 0
            productAmount: Number(order.totalAmount) || 0,
            palletCount: order.items.reduce((s: number, it: OrderItem) => s + (Number(it.quantity) || 0), 0),
            freight: 0,
            orderSource: '采购商推送',
            payMethod: order.payMethod || '余额支付',
            buyerMessage: order.buyerMessage || '',
            createTime: order.createTime,
            pushRef: `${order.key}@${username}`,
            purchaserUsername: order.purchaserUsername,
            receiverName: order.receiverName || '',
            receiverPhone: order.receiverPhone || '',
            province: order.province || '',
            city: order.city || '',
            district: order.district || '',
            receiverAddress: order.receiverAddress || order.address || '',
            addressDetail: order.addressDetail || '',
            // 供应商端「详细地址」列读 receiverDetail，推送时必须同步写入
            receiverDetail: order.addressDetail || order.receiverDetail || '',
            // 唛头：推送后对应供应商订单管理「唛头」列（shippingMark）
            shippingMark: order.shippingMark || '',
            // 付款账户：银行转账时写入勾选的收款账户信息，财务审核可见
            payAccount: order.payAccount || '',
            // 付款截图：取采购商上传的第一张付款截图，财务审核弹窗可见
            payScreenshot: (Array.isArray(order.payScreenshots) && order.payScreenshots.length > 0) ? order.payScreenshots[0] : '',
          };
          // 幂等：同一采购商订单重复推送时覆盖旧副本，避免供应商端出现重复订单
          omList = omList.filter((x: any) => x && x.id !== order.id);
          omList.push(supplierOrder);
          safeSetItem(omKey, JSON.stringify(omList));
        });
        safeSetItem(PUSHED_KEY, JSON.stringify(pushed));
        const all: any[] = loadJson(TRADE_KEY, []);
        const updated = all.map(o => toPush.find(p => p.key === o.key) ? { ...o, status: '已推送' } : o);
        safeSetItem(TRADE_KEY, JSON.stringify(updated));
        setSelectedRowKeys([]);
        reload();
        message.success(`已成功推送 ${toPush.length} 条订单`);
      },
    });
  };

  // 撤回推单：检查供应商端订单状态，仅“已付款/异常”可撤回
  const handleWithdrawPush = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择需要撤回的订单'); return; }
    const toWithdraw = orders.filter(o => selectedRowKeys.includes(o.key) && o.status === '已推送');
    if (toWithdraw.length === 0) { message.warning('选中的订单中没有可撤回的（仅“已推送”状态可撤回）'); return; }
    // 逐个检查供应商端订单状态
    const blocked: string[] = [];
    const allowed: any[] = [];
    toWithdraw.forEach(order => {
      const supplierOwner = getSupplierOwner(order.supplierUsername);
      let omList: any[] = [];
      try { omList = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${supplierOwner}`) || '[]'); } catch { omList = []; }
      const so = omList.find((r: any) => r.id === order.id);
      const supplierStatus = so?.auditStatus || so?.orderStatus || '';
      if (supplierStatus === '已付款' || supplierStatus === '异常') {
        allowed.push(order);
      } else {
        blocked.push(`${order.id}（供应商端状态：${supplierStatus || '未知'}）`);
      }
    });
    if (blocked.length > 0) {
      Modal.warning({
        title: '无法撤回',
        content: <>以下订单供应商端状态不允许撤回，<strong>请联系供应商操作</strong>：<br />{blocked.join('、')}</>,
      });
      if (allowed.length === 0) return;
    }
    Modal.confirm({
      title: '撤回推单',
      content: `确定撤回选中的 ${allowed.length} 条订单？撤回后订单状态恢复为“待推送”，供应商端对应订单将被删除。`,
      okText: '确定撤回', cancelText: '取消',
      onOk: () => {
        const now = dayjs().format('YYYY-MM-DD HH:mm');
        const pushed: any[] = loadJson(PUSHED_KEY, []);
        allowed.forEach(order => {
          const supplierOwner = getSupplierOwner(order.supplierUsername);
          // 1. 更新推送订单状态为“待推送”
          const existIdx = pushed.findIndex(p => p.key === order.key);
          if (existIdx >= 0) {
            const baseOrder = pushed[existIdx];
            const wLogs: any[] = (() => { try { return JSON.parse(baseOrder.orderLog || '[]'); } catch { return []; } })();
            wLogs.push({ time: new Date().toLocaleString('zh-CN'), action: '撤回推单', operator: currentDisplayName, detail: `撤回推送至供应商 ${order.supplierCompany || order.supplierUsername || ''}，释放额度占用 ¥${(Number(order.totalAmount) || 0).toFixed(2)}` });
            pushed[existIdx] = { ...baseOrder, status: '待推送', withdrawTime: now, orderLog: JSON.stringify(wLogs) };
          }
          // 2. 删除供应商端对应订单
          const omKey = `pageData_sales_order-manage_${supplierOwner}`;
          try {
            let omList: any[] = JSON.parse(localStorage.getItem(omKey) || '[]');
            omList = omList.filter((r: any) => r.id !== order.id);
            safeSetItem(omKey, JSON.stringify(omList));
          } catch { /* ignore */ }
          // 2b. 作废供应商侧该订单待确认的收款确认单，避免撤回后仍可确认到账（额度/应收随撤回同步回退）
          try {
            const prKey = `payment_requests_${supplierOwner}`;
            const prList: any[] = JSON.parse(localStorage.getItem(prKey) || '[]');
            let prChanged = false;
            const prNext = prList.map((r: any) => {
              if (!r || r.orderId !== order.id || r.status !== 'pending_confirm') return r;
              prChanged = true;
              return { ...r, status: 'rejected', rejectReason: '采购商撤回订单，收款作废', updatedAt: new Date().toISOString() };
            });
            if (prChanged) {
              const prJson = JSON.stringify(prNext);
              safeSetItem(prKey, prJson);
              saveDataset(prKey, prJson);
              safeSetItem(`${prKey}_ts`, String(Date.now()));
            }
          } catch { /* ignore */ }
        });
        safeSetItem(PUSHED_KEY, JSON.stringify(pushed));
        // 3. 更新 TRADE_KEY 中对应订单状态
        const all: any[] = loadJson(TRADE_KEY, []);
        const withdrawKeys = new Set(allowed.map(o => o.key));
        const updated = all.map(o => withdrawKeys.has(o.key) ? { ...o, status: '待推送' } : o);
        safeSetItem(TRADE_KEY, JSON.stringify(updated));
        setSelectedRowKeys([]);
        reload();
        message.success(`已成功撤回 ${allowed.length} 条订单`);
      },
    });
  };

  // 存量迁移 + 供应商发货实时同步：监听 sync-data-updated（60s 轮询拉取后派发），
  // 供应商端一旦发货，采购商端无需刷新页面即可同步状态并补建采购账单
  const syncSupplierShipStatus = useCallback(() => {
    try {
      const pushed: any[] = loadJson(PUSHED_KEY, []);
      const done = pushed.filter(o => o.status === '已推送' && o.purchaserUsername === username);
      if (!done.length) return;
      // 联动补偿：供应商端已发货时，同步采购商推送订单为已发货并补建采购账单（幂等：按 orderId 去重）
      const billsKey = `purchaser_bills_${username}`;
      let myBills: any[] = [];
      try { myBills = JSON.parse(localStorage.getItem(billsKey) || '[]'); if (!Array.isArray(myBills)) myBills = []; } catch { myBills = []; }
      let pushedChanged = false; let billsChanged = false;
      done.forEach(po => {
        const owner = getSupplierOwner(po.supplierUsername);
        if (!owner) return;
        let omList: any[] = [];
        try { omList = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]'); } catch { omList = []; }
        const so = omList.find((r: any) => r.id === po.id);
        // 供应商取消联动：同步推送订单为已取消，取消原因与日志写入订单日志（幂等）
        if (so && so.auditStatus === '已取消') {
          let chg = false;
          if (po.status !== '已取消') { po.status = '已取消'; chg = true; }
          if (so.cancelReason && po.cancelReason !== so.cancelReason) { po.cancelReason = so.cancelReason; chg = true; }
          if (so.cancelTime && po.cancelTime !== so.cancelTime) { po.cancelTime = so.cancelTime; chg = true; }
          const cLogs: any[] = (() => { try { return JSON.parse(po.orderLog || '[]'); } catch { return []; } })();
          if (!cLogs.some((l: any) => l.action === '供应商取消')) {
            cLogs.push({ time: so.cancelTime || new Date().toLocaleString('zh-CN'), action: '供应商取消', operator: po.supplierCompany || '供应商', detail: `供应商取消订单${so.cancelReason ? '，原因：' + so.cancelReason : ''}` });
            po.orderLog = JSON.stringify(cLogs);
            chg = true;
          }
          if (chg) pushedChanged = true;
          return;
        }
        // 分段付款：供应商登记的分期在采购商账套补记（借预付/贷银行+付款台账，幂等）
        if (isInstallmentOrder(po) && Array.isArray(po.payRecords)) {
          const ownerP = localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || username) : username;
          po.payRecords.forEach((rec: any) => {
            if (rec?.side === 'supplier' && rec.status !== 'pending_confirm') postInstallmentEffects({ owner: ownerP, side: 'purchaser', orderId: po.id, record: rec, counterparty: po.supplierCompany || '' });
          });
        }
        if (!so) return;
        if (so.orderStatus !== '已发货' && so.orderStatus !== '已完成') {
          // 供应商审核/安排生产节点跟随：已审核→已推送待发货，生产排期→已推送待生产（幂等）
          const targetStatus = so.auditStatus === '生产排期' ? '已推送待生产' : so.auditStatus === '已审核' ? '已推送待发货' : null;
          if (targetStatus && po.status !== targetStatus) {
            po.status = targetStatus;
            const act = so.auditStatus === '生产排期' ? '供应商安排生产' : '供应商审核';
            const aLogs: any[] = (() => { try { return JSON.parse(po.orderLog || '[]'); } catch { return []; } })();
            if (!aLogs.some((l: any) => l.action === act)) {
              aLogs.push({ time: new Date().toLocaleString('zh-CN'), action: act, operator: po.supplierCompany || '供应商', detail: so.auditStatus === '生产排期' ? '供应商已安排生产，订单状态同步为已推送待生产' : '供应商审核通过，订单状态同步为已推送待发货' });
              po.orderLog = JSON.stringify(aLogs);
            }
            pushedChanged = true;
          }
          return;
        }
        po.status = so.orderStatus === '已完成' ? '已完成' : '已发货';
        po.shipTime = so.shipTime || po.shipTime || '';
        if (so.orderStatus === '已完成') po.completeTime = so.completeTime || so.shipTime || po.shipTime || '';
        pushedChanged = true;
        // 分段付款：供应商发货后采购商结转 借库存商品/贷预付账款（会计账薄模式，sourceKey 幂等）
        if (isInstallmentOrder(po)) {
          const ownerShip = localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || username) : username;
          postShipCostEntry(ownerShip, po.id, sumPayRecords(po.payRecords) || Number(po.totalAmount) || 0, username);
        }
        // 订单日志：补记供应商发货痕迹（幂等）
        const poLogs: any[] = (() => { try { return JSON.parse(po.orderLog || '[]'); } catch { return []; } })();
        if (!poLogs.some((l: any) => l.action === '供应商发货')) {
          poLogs.push({ time: so.shipTime || new Date().toLocaleString('zh-CN'), action: '供应商发货', operator: po.supplierCompany || '供应商', detail: so.orderStatus === '已完成' ? '供应商已发货，交易完成' : '供应商平台已发货，订单状态同步为已发货' });
          po.orderLog = JSON.stringify(poLogs);
        }
        // 发货即完成：补记交易完成日志（幂等）
        if (so.orderStatus === '已完成' && !poLogs.some((l: any) => l.action === '交易完成')) {
          poLogs.push({ time: so.completeTime || so.shipTime || new Date().toLocaleString('zh-CN'), action: '交易完成', operator: po.supplierCompany || '供应商', detail: '供应商已发货，订单交易自动完成' });
          po.orderLog = JSON.stringify(poLogs);
        }
        if (!myBills.some((b: any) => b.orderId === po.id)) {
          const rawItems = Array.isArray(po.items) ? po.items : [];
          const billNo = `MC-PUSH-${dayjs().format('YYYYMMDD')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
          myBills.unshift({
            key: `pb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            no: billNo,
            outboundNo: billNo,
            date: (so.shipTime || '').slice(0, 10) || dayjs().format('YYYY-MM-DD'),
            supplier: po.supplierCompany || '',
            supplierName: po.supplierCompany || '',
            purchaserName: po.purchaserCompany || '',
            totalAmount: Number(po.totalAmount) || 0,
            totalQty: rawItems.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0),
            status: '待对账',
            reconcileResult: '',
            diffNote: '订单推送',
            items: rawItems.map((it: any) => ({
              key: `bd-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
              productCode: it.productCode || '', styleCode: it.styleCode || '', color: it.color || '', spec: it.spec || '',
              quantity: Number(it.quantity) || 0, unitPrice: Number(it.unitPrice) || 0,
              amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
            })),
            orderSource: '采购商推送',
            orderId: po.id,
            billSource: '订单发货',
            createTime: so.shipTime || '',
          });
          billsChanged = true;
        }
      });
      // 供应商取消订单联动：供应商端订单被取消时，采购商端推送订单自动恢复为“待推送”
      done.forEach(po => {
        if (po.status !== '已推送') return;
        const owner = getSupplierOwner(po.supplierUsername);
        if (!owner) return;
        let omList: any[] = [];
        try { omList = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]'); } catch { omList = []; }
        const so = omList.find((r: any) => r.id === po.id);
        if (!so || so.auditStatus !== '已取消') return;
        po.status = '待推送'; po.withdrawTime = new Date().toLocaleString('zh-CN'); pushedChanged = true;
        // 订单日志：补记供应商取消痕迹（幂等）
        const poLogs: any[] = (() => { try { return JSON.parse(po.orderLog || '[]'); } catch { return []; } })();
        if (!poLogs.some((l: any) => l.action === '供应商取消订单')) {
          poLogs.push({ time: new Date().toLocaleString('zh-CN'), action: '供应商取消订单', operator: po.supplierCompany || '供应商', detail: `供应商已取消订单 ${po.id}，采购商端状态自动恢复为“待推送”` });
          po.orderLog = JSON.stringify(poLogs);
        }
      });
      if (pushedChanged) safeSetItem(PUSHED_KEY, JSON.stringify(pushed));
      if (billsChanged) safeSetItem(billsKey, JSON.stringify(myBills));
      const byOwner: Record<string, any[]> = {};
      done.forEach(o => {
        const owner = getSupplierOwner(o.supplierUsername);
        if (!owner) return;
        (byOwner[owner] = byOwner[owner] || []).push(o);
      });
      Object.keys(byOwner).forEach(owner => {
        const omKey = `pageData_sales_order-manage_${owner}`;
        try {
          const omList: any[] = JSON.parse(localStorage.getItem(omKey) || '[]');
          let changed = false;
          const updated = omList.map((r: any) => {
            const src = byOwner[owner].find((p: any) => p.id === r.id);
            if (!src) return r;
            const patch: any = {};
            // 银行转账尚未确认到账时不自动转已付款（由供应商收款确认单驱动）
            const bankUnconfirmed = String(src.payMethod || '') === '银行转账' && src.payConfirmed !== true;
            if (r.orderStatus === '待付款' && !isInstallmentOrder(src) && !bankUnconfirmed) {
              patch.orderStatus = '已付款';
              patch.paidAmount = Number(src.totalAmount) || Number(r.totalAmount) || 0;
              patch.auditStatus = String(src.payMethod || '余额支付') === '余额支付' ? (r.auditStatus || '') : '待财务审核';
            }
            // 分段付款：推送单分期台账 union 合并到供应商本地订单；收满自动置已付款
            if (isInstallmentOrder(src)) {
              if (!isInstallmentOrder(r)) patch.payPlan = 'installment';
              // 「分段付款」标签强制保留（含存量补打）
              const tg0 = String(r.orderTag || '').split(',').filter(Boolean);
              const tgs0 = String(r.orderTags || '').split(',').filter(Boolean);
              let tagCh0 = false;
              if (!tg0.includes('分段付款')) { tg0.unshift('分段付款'); tagCh0 = true; }
              if (!tgs0.includes('分段付款')) { tgs0.unshift('分段付款'); tagCh0 = true; }
              if (tagCh0) { patch.orderTag = tg0.join(','); patch.orderTags = tgs0.join(','); }
              if (src.depositRatio && r.depositRatio !== src.depositRatio) patch.depositRatio = src.depositRatio;
              const mergedRecs = mergePayRecords(r.payRecords || [], src.payRecords || []);
              if (mergedRecs.length !== (r.payRecords || []).length) patch.payRecords = mergedRecs;
              const paidRecs = sumPayRecords(mergedRecs);
              if (Math.abs(paidRecs - (Number(r.paidAmount) || 0)) > 0.001) patch.paidAmount = paidRecs;
              const totRecs = Number(r.productAmount) || Number(src.totalAmount) || 0;
              // 分段付款状态推进：达定金→部分付款；收满→已付款
              const stNextRecs = installmentStatusOf(r, totRecs, paidRecs);
              if (stNextRecs && stNextRecs !== r.orderStatus && (r.orderStatus === '待付款' || r.orderStatus === '部分付款')) {
                patch.orderStatus = stNextRecs;
                if (stNextRecs === '已付款') patch.payTime = new Date().toLocaleString('zh-CN');
              }
            }
            // 历史推送订单补货品总额/货品总数（推送时未写导致供应商端显示 0）
            if (!(Number(r.productAmount) > 0) && (Number(src.totalAmount) > 0)) patch.productAmount = Number(src.totalAmount);
            // 历史推送订单补详细地址（供应商端「详细地址」列读 receiverDetail）
            if (!r.receiverDetail && (src.addressDetail || src.receiverDetail)) patch.receiverDetail = src.addressDetail || src.receiverDetail;
            if (!(Number(r.palletCount) > 0)) {
              let qty = 0;
              try { qty = (Array.isArray(src.items) ? src.items : JSON.parse(r.orderItems || '[]')).reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0); } catch { qty = 0; }
              if (qty > 0) patch.palletCount = qty;
            }
            if (!Object.keys(patch).length) return r;
            changed = true;
            return { ...r, ...patch };
          });
          if (changed) safeSetItem(omKey, JSON.stringify(updated));
        } catch { /* ignore */ }
      });
      if (pushedChanged || billsChanged) reload();
    } catch { /* ignore */ }
  }, [username, reload]);

  useEffect(() => {
    syncSupplierShipStatus();
    const onSync = () => syncSupplierShipStatus();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [syncSupplierShipStatus]);

  // 编辑入口：仅待推送订单可编辑，回填新增弹窗复用同一表单
  const openEdit = (r: any) => {
    if (r.status !== '待推送') { message.warning('仅"待推送"状态的订单可以编辑'); return; }
    resetAddForm();
    setEditingKey(r.key);
    setAddSupplier(r.supplierUsername || '');
    setAddItems((r.items || []).map((it: any) => ({ ...it, uid: it.uid || genItemUid() })));
    setAddBuyerMessage(r.buyerMessage || '');
    setAddShippingMark(r.shippingMark || '');
    setAddPayMethod(r.payMethod || '余额支付');
    setAddDepositRatio(r.depositRatio || 30);
    setAddImages(r.images || []);
    setAddReceiverName(r.receiverName || '');
    setAddReceiverPhone(r.receiverPhone || '');
    setAddProvince(r.province || ''); setAddCity(r.city || ''); setAddDistrict(r.district || '');
    setAddAddressDetail(r.addressDetail || '');
    setAddPayScreenshots(r.payScreenshots || []);
    setAddSelectedBank(r.selectedBank || '');
    setAddVisible(true);
  };

  // 新增订单
  const handleAddOrder = () => {
    if (!addSupplier) { message.warning('请选择供应商'); return; }
    if (addItems.length === 0) { message.warning('请添加商品'); return; }
    if (addPayMethod === '银行转账' && !addSelectedBank) { message.warning('请选择付款银行'); return; }
    const totalAmount = addItems.reduce((sum, it) => sum + (it.quantity * it.unitPrice), 0);
    const roundedAmount = Math.round(totalAmount * 100) / 100;
    const supplierOpt = supplierOptions.find(s => s.value === addSupplier);
    // 编辑模式：原地回写原订单（仅待推送可进入），追加编辑日志，不重复记账
    if (editingKey) {
      const patch: any = {
        supplierUsername: addSupplier,
        supplierCompany: supplierOpt?.label || addSupplier,
        items: addItems.map(it => ({ ...it, amount: it.quantity * it.unitPrice })),
        totalAmount: roundedAmount,
        payMethod: addPayMethod,
        payPlan: addPayMethod === '分段付款' ? 'installment' : 'full',
        depositRatio: addDepositRatio,
        buyerMessage: addBuyerMessage,
        shippingMark: addShippingMark.trim(),
        images: addImages,
        receiverName: addReceiverName,
        receiverPhone: addReceiverPhone,
        province: addProvince, city: addCity, district: addDistrict,
        receiverAddress: [addProvince, addCity, addDistrict, addAddressDetail].filter(Boolean).join(' '),
        addressDetail: addAddressDetail,
        address: [addProvince, addCity, addDistrict, addAddressDetail].filter(Boolean).join(' '),
        payScreenshots: addPayScreenshots,
        selectedBank: addSelectedBank,
      };
      const withLog = (rec: any) => {
        const logs: any[] = (() => { try { return JSON.parse(rec.orderLog || '[]'); } catch { return []; } })();
        logs.push({ time: new Date().toLocaleString('zh-CN'), action: '编辑订单', operator: currentDisplayName, detail: `编辑订单信息：供应商 ${patch.supplierCompany}，商品 ${addItems.length} 项，总额 ¥${roundedAmount.toFixed(2)}` });
        return { ...rec, ...patch, orderLog: JSON.stringify(logs) };
      };
      const pushed: any[] = loadJson(PUSHED_KEY, []);
      const idx = pushed.findIndex(p => p.key === editingKey);
      if (idx >= 0) {
        pushed[idx] = withLog(pushed[idx]);
        safeSetItem(PUSHED_KEY, JSON.stringify(pushed));
      } else {
        const all: any[] = loadJson(TRADE_KEY, []);
        const i2 = all.findIndex(o => o.key === editingKey);
        if (i2 >= 0) { all[i2] = withLog(all[i2]); safeSetItem(TRADE_KEY, JSON.stringify(all)); }
      }
      setAddVisible(false);
      setEditingKey('');
      resetAddForm();
      reload();
      message.success('订单修改已保存');
      return;
    }
    const now = dayjs().format('YYYY-MM-DD HH:mm');
    const id = `PO-${dayjs().format('YYYYMMDDHHmm')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const key = `push-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // 银行转账时根据勾选的收款方式写入 payAccount
    const payAccountText = addPayMethod === '银行转账'
      ? (addPayChannel === 'bank' ? (addSupplierPayBankInfo || '') : '收款码收款')
      : '';
    const newOrder = {
      key, id,
      purchaserUsername: username,
      purchaserCompany: (() => { try { const u = JSON.parse(localStorage.getItem('registeredUsers') || '[]').find((x: any) => x.username === username); return u?.companyName || username; } catch { return username; } })(),
      supplierUsername: addSupplier,
      supplierCompany: supplierOpt?.label || addSupplier,
      items: addItems.map(it => ({ ...it, amount: it.quantity * it.unitPrice })),
      totalAmount: roundedAmount,
      status: '待推送',
      payMethod: addPayMethod,
      payPlan: addPayMethod === '分段付款' ? 'installment' : 'full',
      depositRatio: addDepositRatio,
      payRecords: [],
      paidAmount: 0,
      buyerMessage: addBuyerMessage,
      shippingMark: addShippingMark.trim(),
      creator: currentDisplayName,
      orderLog: JSON.stringify([{ time: new Date().toLocaleString('zh-CN'), action: '创建订单', operator: currentDisplayName, detail: `采购商手动新增订单，商品 ${addItems.length} 项，总额 ¥${roundedAmount.toFixed(2)}` }]),
      images: addImages,
      receiverName: addReceiverName,
      receiverPhone: addReceiverPhone,
      province: addProvince,
      city: addCity,
      district: addDistrict,
      receiverAddress: [addProvince, addCity, addDistrict, addAddressDetail].filter(Boolean).join(' '),
      addressDetail: addAddressDetail,
      address: [addProvince, addCity, addDistrict, addAddressDetail].filter(Boolean).join(' '),
      payScreenshots: addPayScreenshots,
      selectedBank: addSelectedBank,
      payAccount: payAccountText,
      payChannel: addPayMethod === '银行转账' ? addPayChannel : undefined,
      orderSource: '手动新增',
      createTime: now,
    };
    const pushed: any[] = loadJson(PUSHED_KEY, []);
    pushed.push(newOrder);
    safeSetItem(PUSHED_KEY, JSON.stringify(pushed));

    // 银行转账：下单不再即时写银行流水/会计分录。订单推送后由供应商侧自动生成「收款确认单」，
    // 供应商财务在「财务管理 - 收/付申请 - 收款确认」确认到账时，才写入银行明细与会计分录（以银行流水为准）

    setAddVisible(false);
    resetAddForm();
    reload();
    message.success('订单创建成功，状态为"待推送"');
  };

  const resetAddForm = () => {
    setEditingKey('');
    setAddSupplier('');
    setAddItems([]);
    setAddItemSelected([]);
    setAddBuyerMessage('');
    setAddShippingMark('');
    setAddPayMethod('余额支付');
    setAddDepositRatio(30);
    setAddImages([]);
    setAddReceiverName(companyInfo.contactPerson);
    setAddReceiverPhone(companyInfo.phone);
    setAddProvince(companyInfo.province);
    setAddCity(companyInfo.city);
    setAddDistrict(companyInfo.district);
    setAddAddressDetail(companyInfo.addressDetail);
    setAddSelectedBank('');
    setAddPayScreenshots([]);
    setAddSupplierPayBankInfo('');
    setAddSupplierPayQrImage('');
    setAddPayChannel('bank');
  };

  // 打开选择商品弹窗
  const openPickProduct = () => {
    if (!addSupplier) { message.warning('请先选择供应商'); return; }
    setPickSearchKw('');
    setPickSelected([]);
    setPickProductVisible(true);
  };

  // 确认选择商品
  const confirmPickProducts = () => {
    const selected = filteredProducts.filter((_: any, i: number) => pickSelected.includes(String(i)));
    const newItems: OrderItem[] = selected.map((p: any) => ({
      productCode: p.productCode || '',
      shortName: p.shortName || p.name || '',
      styleCode: p.styleCode || '',
      color: p.color || '',
      spec: p.spec || '',
      quantity: 1,
      unitPrice: Number(p.suggestedPrice) || 0,
      amount: Number(p.suggestedPrice) || 0,
      image: p.image || p.imageKey || '',
      uid: genItemUid(),
    }));
    setAddItems(prev => [...prev, ...newItems]);
    setPickProductVisible(false);
    setPickSelected([]);
    message.success(`已添加 ${newItems.length} 个商品`);
  };

  // 手动添加空白行
  const addManualItem = () => {
    setAddItems(prev => [...prev, { productCode: '', shortName: '', styleCode: '', color: '', spec: '', quantity: 1, unitPrice: 0, amount: 0, uid: genItemUid() }]);
  };

  const updateAddItem = (idx: number, field: string, value: any) => {
    setAddItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      updated.amount = (updated.quantity || 0) * (updated.unitPrice || 0);
      return updated;
    }));
  };

  const removeAddItem = (idx: number) => {
    const uid = addItems[idx]?.uid;
    setAddItems(prev => prev.filter((_, i) => i !== idx));
    if (uid) setAddItemSelected(prev => prev.filter(k => String(k) !== String(uid)));
  };

  const addTotal = useMemo(() => addItems.reduce((sum, it) => sum + (it.quantity || 0) * (it.unitPrice || 0), 0), [addItems]);

  // 货品明细列：按字段配置的顺序+显隐动态生成（操作列固定末尾）
  const addItemColumns = useMemo(() => {
    const defs: Record<string, any> = {
      image: { title: '图片', width: 60, align: 'center', render: (_: any, r: OrderItem) => r.image ? <Image src={r.image} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—' },
      productCode: { title: '商品编码', width: 130, render: (_: any, r: OrderItem, idx: number) => <Input size="small" value={r.productCode} onChange={e => updateAddItem(idx, 'productCode', e.target.value)} placeholder="编码" /> },
      shortName: { title: '商品名称', width: 130, render: (_: any, r: OrderItem, idx: number) => <Input size="small" value={r.shortName} onChange={e => updateAddItem(idx, 'shortName', e.target.value)} placeholder="名称" /> },
      styleCode: { title: '款式编码', width: 100, render: (_: any, r: OrderItem, idx: number) => <Input size="small" value={r.styleCode} onChange={e => updateAddItem(idx, 'styleCode', e.target.value)} placeholder="款式" /> },
      color: { title: '颜色', width: 70, render: (_: any, r: OrderItem, idx: number) => <Input size="small" value={r.color} onChange={e => updateAddItem(idx, 'color', e.target.value)} placeholder="颜色" /> },
      spec: { title: '规格', width: 70, render: (_: any, r: OrderItem, idx: number) => <Input size="small" value={r.spec} onChange={e => updateAddItem(idx, 'spec', e.target.value)} placeholder="规格" /> },
      quantity: { title: '数量', width: 80, render: (_: any, r: OrderItem, idx: number) => <InputNumber size="small" min={1} value={r.quantity} onChange={v => updateAddItem(idx, 'quantity', v || 0)} /> },
      unitPrice: { title: '单价', width: 100, render: (_: any, r: OrderItem) => <span>¥{r.unitPrice.toFixed(2)}</span> },
      subtotal: { title: '小计', width: 90, render: (_: any, r: OrderItem) => <Text strong style={{ color: '#f5222d' }}>¥{(r.quantity * r.unitPrice).toFixed(2)}</Text> },
    };
    const cols = itemFieldCfg.order
      .filter(k => itemFieldCfg.visibility[k] !== false && defs[k])
      .map(k => defs[k]);
    cols.push({ title: '', width: 40, render: (_: any, r: OrderItem, idx: number) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeAddItem(idx)} /> });
    return cols;
  }, [itemFieldCfg, addItems]);

  // 保存货品明细字段配置（顺序+显隐）
  const saveItemFieldCfg = (order: string[], visibility: Record<string, boolean>) => {
    const next = { order, visibility };
    setItemFieldCfg(next);
    safeSetItem(itemFieldKey, JSON.stringify(next));
    setItemFieldConfigVisible(false);
  };

  // 当前供应商可用额度（与供应商列表剩余额度同公式）
  const supplierAvailableCredit = useMemo(() => {
    if (!addSupplier) return 0;
    // 1. 信用额度（从供应商的 boundPurchasers/customers 读取）
    const credit = calcSupplierCredit(addSupplier);
    // 2. 订单占用（已推送未发货订单总额）
    const occ = calcOccupation(addSupplier);
    // 3. 应付欠款 = 采购金额 - 已付货款（从付款汇总快照读取）
    const ps = getPaySummary(addSupplier);
    const due = ps ? (ps.purchaseTotal - ps.paidTotal) / 100 : 0;
    // 剩余额度 = 信用额度 - 应付欠款 - 订单占用
    return Math.round((credit - due - occ) * 100) / 100;
  }, [addSupplier, creditRefreshKey]);

  // 已用额度 = 采购金额 - 已付货款 + 订单占用
  const supplierUsedCredit = useMemo(() => {
    if (!addSupplier) return 0;
    const ps = getPaySummary(addSupplier);
    const due = ps ? (ps.purchaseTotal - ps.paidTotal) / 100 : 0;
    const occ = calcOccupation(addSupplier);
    return Math.round((due + occ) * 100) / 100;
  }, [addSupplier, creditRefreshKey]);

  // 图片粘贴处理
  const handleImagePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          if (dataUrl) {
            // 银行转账模式下粘贴到付款截图，否则粘贴到订单图片
            if (addPayMethod === '银行转账') {
              setAddPayScreenshots(prev => [...prev, dataUrl]);
            } else {
              setAddImages(prev => [...prev, dataUrl]);
            }
          }
        };
        reader.readAsDataURL(file);
      }
    }
  }, [addPayMethod]);

  // 图片上传
  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) setAddImages(prev => [...prev, dataUrl]);
    };
    reader.readAsDataURL(file);
    return false; // prevent default upload
  };

  // 订单列表列：按字段配置的顺序+显隐动态生成；全列居中；列宽可拖拽调整；操作列固定末尾
  const listColumns = useMemo(() => {
    const defs: Record<string, any> = {
      id: {
        key: 'id', title: '订单编号', dataIndex: 'id', align: 'center',
        render: (v: string, r: any) => (
          <Tooltip title="点击查看订单详情">
            <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontWeight: 600 }} onClick={() => setDetail(r)}>{v}</Button>
          </Tooltip>
        ),
      },
      supplier: {
        key: 'supplier', title: '供应商', dataIndex: 'supplierCompany', align: 'center',
        render: (v: string, r: any) => (r.purchaserUsername === username ? <Text strong>{v}</Text> : <Text strong>{r.purchaserCompany}</Text>),
      },
      items: { key: 'items', title: '货品数', align: 'center', render: (_: any, r: any) => (r.items || []).length },
      detail: {
        key: 'detail', title: '货品明细', align: 'center',
        render: (_: any, r: any) => (
          <Tooltip title="点击查看订单详情">
            <div style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
              <Paragraph ellipsis={{ rows: 1 }} style={{ marginBottom: 0, textAlign: 'center' }}>
                {(r.items || []).map((x: any) => `${x.shortName}${x.color ? '-' + x.color : ''}${x.spec ? '-' + x.spec : ''}×${x.quantity}`).join('，')}
              </Paragraph>
            </div>
          </Tooltip>
        ),
      },
      total: { key: 'total', title: '订单金额', align: 'center', render: (_: any, r: any) => <Text strong style={{ color: '#f5222d' }}>¥{Number(r.totalAmount) || 0}</Text> },
      status: {
        key: 'status', title: '订单状态', dataIndex: 'status', align: 'center',
        render: (v: string) => {
          const colorMap: Record<string, string> = { '待推送': 'orange', '已推送': 'blue', '已推送待发货': 'green', '已推送待生产': 'purple', '已发货': 'cyan', '已完成': 'green', '已取消': 'default' };
          return <Tag color={colorMap[v] || 'green'}>{v}</Tag>;
        },
      },
      source: { key: 'source', title: '订单来源', dataIndex: 'orderSource', align: 'center', render: (v: string) => <Tag color="purple">{v || '成品市场'}</Tag> },
      createTime: { key: 'createTime', title: '下单时间', align: 'center', render: (_: any, r: any) => dayjs(r.createTime).format('YYYY-MM-DD HH:mm') },
      shippingMark: { key: 'shippingMark', title: '唛头', dataIndex: 'shippingMark', align: 'center', render: (v: string) => v || '-' },
      creator: { key: 'creator', title: '创建人', dataIndex: 'creator', align: 'center', render: (v: string) => v || '-' },
      payProgress: {
        key: 'payProgress', title: '付款进度', align: 'center',
        render: (_: any, r: any) => {
          if (!isInstallmentOrder(r)) return <Text type="secondary">—</Text>;
          const total = Number(r.totalAmount) || 0;
          const paid = sumPayRecords(r.payRecords);
          const partial = paid > 0 && paid + 0.001 < total;
          return (
            <Space size={4}>
              <span style={{ fontSize: 12 }}>{payProgressText(paid, total)}</span>
              {partial && <Tag color="orange">部分付款</Tag>}
            </Space>
          );
        },
      },
    };
    const cols = listFieldCfg.order
      .filter(k => listFieldCfg.visibility[k] !== false && defs[k])
      .map(k => {
        const w = colWidths[k] || ORDER_LIST_DEFAULT_WIDTH[k] || 120;
        return {
          ...defs[k],
          width: w,
          onHeaderCell: () => ({ width: w, onResize: (nw: number) => setColWidths(prev => ({ ...prev, [k]: nw })) }),
        };
      });
    cols.push({
      key: 'action', title: '操作', width: colWidths.action || 140, align: 'center', fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>详情</Button>
          <Tooltip title={r.status === '待推送' ? '编辑订单' : '仅"待推送"状态的订单可编辑'}>
            <Button size="small" type="link" icon={<EditOutlined />} disabled={r.status !== '待推送'} onClick={() => openEdit(r)}>编辑</Button>
          </Tooltip>
          {isInstallmentOrder(r) && r.status !== '待推送' && (
            <Button size="small" type="link" icon={<DollarOutlined />} onClick={() => { setPayRegTarget(r); setPayRegAmount(null); setPayRegBank(''); setPayRegShot(''); }}>登记付款</Button>
          )}
        </Space>
      ),
    });
    return cols;
  }, [listFieldCfg, colWidths, username]);

  // 分段付款：登记本期付款（写入推送单分期台账 + 采购商账套联动：借预付/贷银行 + 付款台账/银行出账）
  const handlePayRegConfirm = () => {
    if (!payRegTarget) return;
    const owner = localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || username) : username;
    const total = Number(payRegTarget.totalAmount) || 0;
    const paid = sumPayRecords(payRegTarget.payRecords);
    const remain = Math.round((total - paid) * 100) / 100;
    if (remain <= 0) { message.warning('该订单货款已结清，无需再登记'); return; }
    if (!payRegBank) { message.warning('请选择付款银行账户'); return; }
    const deposit = depositAmountOf(payRegTarget, total);
    const suggest = paid <= 0 ? deposit : remain;
    const amt = Math.round((Number(payRegAmount) || 0) * 100) / 100 || suggest;
    if (amt <= 0) { message.warning('请输入本期付款金额'); return; }
    if (amt > remain + 0.001) { message.warning(`本期付款金额不能超过剩余欠款 ¥${remain.toFixed(2)}`); return; }
    const rec: PayRecord = {
      key: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toLocaleString('zh-CN'),
      amount: amt,
      account: payRegBank,
      screenshot: payRegShot,
      operator: username,
      side: 'purchaser',
    };
    const newRecords = mergePayRecords(payRegTarget.payRecords || [], [rec]);
    const newPaid = sumPayRecords(newRecords);
    // 回写推送单本体（分段台账唯一真值源，跨浏览器同步到供应商端）
    const pushed: any[] = loadJson(PUSHED_KEY, []);
    const updated = pushed.map((po: any) => {
      if (po.key !== payRegTarget.key) return po;
      const logs: any[] = (() => { try { return JSON.parse(po.orderLog || '[]'); } catch { return []; } })();
      logs.push({ time: rec.time, action: '登记付款', operator: currentDisplayName, detail: `分段付款登记本期付款 ¥${amt.toFixed(2)}（累计 ¥${newPaid.toFixed(2)}/总额 ¥${total.toFixed(2)}）` });
      return { ...po, payRecords: newRecords, paidAmount: newPaid, payPlan: 'installment', orderLog: JSON.stringify(logs) };
    });
    const json = JSON.stringify(updated);
    safeSetItem(PUSHED_KEY, json);
    try { saveDataset(PUSHED_KEY, json); } catch { /* ignore */ }
    postInstallmentEffects({ owner, side: 'purchaser', orderId: payRegTarget.id, record: rec, counterparty: payRegTarget.supplierCompany || '' });
    setPayRegTarget(null);
    reload();
    message.success(`已登记本期付款 ¥${amt.toFixed(2)}（累计 ¥${newPaid.toFixed(2)}/总额 ¥${total.toFixed(2)}）`);
  };

  // 横向滚动宽度 = 各列宽合计（含勾选列预留）：不用 max-content，否则列宽被内容撑开、拖拽调宽失效
  const scrollX = useMemo(() => {
    const sum = (listColumns as any[]).reduce((s, c) => s + (Number(c.width) || 120), 0);
    return sum + 60;
  }, [listColumns]);

  // 保存订单列表字段配置（顺序+显隐）
  const saveListFieldCfg = (order: string[], visibility: Record<string, boolean>) => {
    const next = { order, visibility };
    setListFieldCfg(next);
    safeSetItem(listFieldKey, JSON.stringify(next));
    setListFieldConfigVisible(false);
  };

  return (
    <div ref={rootRef} style={{ padding: '16px 16px 0', height: rootH ?? '100%', marginBottom: -padB, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ padding: '16px 16px 0', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {ORDER_LIST_FIELD_DEFS.filter(d => listFieldCfg.visibility[d.key] !== false).map(d => (
            <Input key={d.key} allowClear size="small" placeholder={`搜索${d.label}`}
              style={{ width: 140 }} value={fieldFilters[d.key] || ''}
              onChange={e => setFieldFilters(prev => ({ ...prev, [d.key]: e.target.value }))} />
          ))}
          <Button type="primary" icon={<SearchOutlined />} onClick={() => { reloadAfterPull(reload); setAppliedFilters({ ...fieldFilters }); }}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setFieldFilters({}); setAppliedFilters({}); setSKw(''); setApKw(''); }}>重置</Button>
          <Button icon={<SettingOutlined />} onClick={() => setListFieldConfigVisible(true)}>显示字段</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { resetAddForm(); setCreditRefreshKey(k => k + 1); setAddVisible(true); }}>新增</Button>
          <Button icon={<SendOutlined />} onClick={handlePush}>推送订单</Button>
          <Button icon={<RollbackOutlined />} onClick={handleWithdrawPush}>撤回推单</Button>
        </div>
        <div ref={tableWrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ['--mo-tbody-h' as any]: `${tbodyH}px` }}>
          <style>{`.mo-fixed-table .ant-table-body { min-height: var(--mo-tbody-h, 320px); }`}</style>
          <Table rowKey="key" bordered size="middle" columns={listColumns} dataSource={filtered}
            scroll={{ x: scrollX, y: tbodyH }} tableLayout="fixed" className="mo-fixed-table"
            style={{ flex: 1, minHeight: 0 }}
            components={{ header: { cell: ResizableHeaderCell } }}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, getCheckboxProps: (r: any) => ({ disabled: r.status !== '待推送' && r.status !== '已推送' }) }}
            pagination={{
              pageSize,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100', '200'],
              showTotal: t => `共 ${t} 条`,
              style: { margin: '8px 0 0' },
              onChange: (_p, size) => { if (size !== pageSize) setPageSize(size); },
            }} locale={{ emptyText: <Empty description="暂无订单" /> }} />
        </div>
      </Card>

      {/* 新增/编辑订单弹窗 */}
      <Modal title={editingKey ? '编辑采购订单' : '新增采购订单'} open={addVisible} onCancel={() => { setAddVisible(false); setEditingKey(''); }} onOk={handleAddOrder}
        okText={editingKey ? '保存修改' : '创建订单'} cancelText="取消" width={1000} style={{ top: 20 }}>
        <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: 8 }} onPaste={handleImagePaste} tabIndex={0}>
          {/* 供应商选择 */}
          <div style={{ marginBottom: 16 }}>
            <Space size={12}>
              <Text strong>供应商：</Text>
              <Select style={{ width: 300 }} placeholder="请选择供应商" value={addSupplier || undefined}
                options={supplierOptions} showSearch filterOption={(input, opt) => String(opt?.label || '').includes(input)}
                onChange={v => setAddSupplier(v)} />
            </Space>
          </div>

          {/* 收货地址 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>收货地址：</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <Input style={{ width: 140 }} placeholder="收件人" value={addReceiverName}
                onChange={e => setAddReceiverName(e.target.value)} />
              <Input style={{ width: 160 }} placeholder="联系电话" value={addReceiverPhone}
                onChange={e => setAddReceiverPhone(e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <Select style={{ width: 120 }} placeholder="省" value={addProvince || undefined}
                onChange={v => { setAddProvince(v || ''); setAddCity(''); setAddDistrict(''); }}
                options={getProvinceOptions()} allowClear showSearch
                filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
              <Select style={{ width: 120 }} placeholder="市" value={addCity || undefined}
                onChange={v => { setAddCity(v || ''); setAddDistrict(''); }}
                options={getCityOptions(addProvince)} disabled={!addProvince} allowClear showSearch
                filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
              <Select style={{ width: 120 }} placeholder="区" value={addDistrict || undefined}
                onChange={v => setAddDistrict(v || '')}
                options={getDistrictOptions(addProvince, addCity)} disabled={!addCity} allowClear showSearch
                filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
            </div>
            <Input style={{ width: 400 }} placeholder="详细地址" value={addAddressDetail}
              onChange={e => setAddAddressDetail(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <Text strong style={{ whiteSpace: 'nowrap' }}>唛头：</Text>
              <Input style={{ width: 400 }} placeholder="请输入唛头（Shipping Mark），推送后对应供应商订单唛头字段" value={addShippingMark}
                onChange={e => setAddShippingMark(e.target.value)} maxLength={100} />
            </div>
          </div>

          {/* 货品明细 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <Text strong style={{ fontSize: 14 }}>货品明细</Text>
              <Space wrap>
                {addItemSelected.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}>已勾选 {addItemSelected.length} 行</Text>}
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openPickProduct}>添加新的商品</Button>
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addManualItem}>手动添加</Button>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setQtyTemplateVisible(true)}>数量模版</Button>
                <Button size="small" icon={<SettingOutlined />} onClick={() => setItemFieldConfigVisible(true)}>显示字段</Button>
              </Space>
            </div>
            {qtyTemplates.length > 0 && (
              <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>模版：</Text>
                {qtyTemplates.map((t, i) => (
                  <Tag key={`qt-chip-${i}`} color="blue" style={{ cursor: 'pointer' }} onClick={() => openQtyFill(t)}>{t.name}</Tag>
                ))}
              </div>
            )}
            {addItems.length > 0 ? (
              <Table bordered size="small" dataSource={addItems} rowKey={(r: OrderItem) => r.uid || ''} pagination={false}
                rowSelection={{ selectedRowKeys: addItemSelected, columnWidth: 40, onChange: keys => setAddItemSelected(keys) }}
                columns={addItemColumns} />
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: '#999', border: '1px dashed #d9d9d9', borderRadius: 4 }}>
                暂无商品，点击"添加新的商品"按钮增加
              </div>
            )}
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <Text strong>商品总额：<Text style={{ color: '#f5222d', fontSize: 16 }}>¥{addTotal.toFixed(2)}</Text></Text>
            </div>
          </div>

          {/* 买家留言 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>买家留言：</Text>
            <TextArea rows={3} placeholder="请输入买家留言或特殊要求..." value={addBuyerMessage}
              onChange={e => setAddBuyerMessage(e.target.value)} maxLength={500} showCount />
          </div>

          {/* 图片上传 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>图片上传：</Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {addImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative', width: 72, height: 72 }}>
                  <Image src={img} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />}
                    style={{ position: 'absolute', top: -6, right: -6, padding: 0, width: 20, height: 20, fontSize: 12 }}
                    onClick={() => setAddImages(prev => prev.filter((_, i) => i !== idx))} />
                </div>
              ))}
              <Upload accept="image/*" showUploadList={false} beforeUpload={handleImageUpload}>
                <Button size="small" icon={<UploadOutlined />}>选择图片</Button>
              </Upload>
              <Text type="secondary" style={{ fontSize: 12 }}>或 Ctrl+V 粘贴图片</Text>
            </div>
          </div>

          {/* 付款方式 */}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>付款方式：</Text>
            <Radio.Group value={addPayMethod} onChange={e => setAddPayMethod(e.target.value)}>
              <Space>
                <Radio.Button value="银行转账">银行转账</Radio.Button>
                <Radio.Button value="余额支付">余额支付</Radio.Button>
                <Radio.Button value="分段付款">分段付款</Radio.Button>
              </Space>
            </Radio.Group>
            {addPayMethod === '分段付款' && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 12 }}>定金比例(%)：</Text>
                <InputNumber size="small" style={{ width: 90 }} min={1} max={100} precision={0} value={addDepositRatio} onChange={v => setAddDepositRatio(Number(v) || 30)} />
                <Text type="secondary" style={{ fontSize: 12 }}>定金 ¥{(Math.round(addItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0) * addDepositRatio) / 100).toFixed(2)}，尾款发货前结清（分段金额不入账单明细）</Text>
              </div>
            )}
            {addPayMethod === '余额支付' && addSupplier && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  供应商信用额度：¥{calcSupplierCredit(addSupplier).toFixed(2)} | 已用额度：¥{supplierUsedCredit.toFixed(2)} | 可用额度(同供应商列表剩余额度)：¥{supplierAvailableCredit.toFixed(2)}
                </Text>
              </div>
            )}
            {addPayMethod === '银行转账' && addSupplier && (
              <div style={{ marginTop: 12, padding: '12px 16px', background: '#fafafa', borderRadius: 6, border: '1px solid #e8e8e8' }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>供应商收款信息：</Text>
                {/* 收款银行账户 */}
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary">收款银行账户：</Text>
                  {addSupplierPayBankInfo ? (
                    <span style={{ whiteSpace: 'pre-wrap', marginLeft: 8 }}>{addSupplierPayBankInfo}</span>
                  ) : (
                    <Tag color="orange" style={{ marginLeft: 8 }}>未完善</Tag>
                  )}
                </div>
                {/* 收款码 */}
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary">收款码：</Text>
                  {addSupplierPayQrImage ? (
                    <Image src={addSupplierPayQrImage} alt="收款码" width={120} style={{ maxHeight: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid #eee', marginLeft: 8 }} />
                  ) : (
                    <Tag color="orange" style={{ marginLeft: 8 }}>未完善</Tag>
                  )}
                </div>
                {/* 勾选收款方式 */}
                <div>
                  <Text type="secondary">请选择收款方式：</Text>
                  <Radio.Group
                    style={{ marginLeft: 8 }}
                    value={addPayChannel}
                    onChange={e => setAddPayChannel(e.target.value)}
                  >
                    <Radio value="bank" disabled={!addSupplierPayBankInfo}>银行账户</Radio>
                    <Radio value="qr" disabled={!addSupplierPayQrImage}>收款码</Radio>
                  </Radio.Group>
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>（二者仅可勾选其一）</Text>
                </div>
              </div>
            )}
            {addPayMethod === '银行转账' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>付款银行：</Text>
                  <Select style={{ width: 400 }} placeholder="请选择付款银行" value={addSelectedBank || undefined}
                    showSearch filterOption={(input, opt) => String(opt?.label || '').includes(input)}
                    options={bankAccounts.map(b => ({
                      value: b.name || b.shortName,
                      label: `${b.name || b.shortName}（${b.bankName || ''} | 余额 ¥${(Number(b.balance) || 0).toFixed(2)}）`,
                    }))}
                    onChange={v => setAddSelectedBank(v)} />
                </div>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>付款截图：</Text>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {addPayScreenshots.map((img, idx) => (
                      <div key={idx} style={{ position: 'relative', width: 72, height: 72 }}>
                        <Image src={img} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />
                        <Button size="small" type="text" danger icon={<DeleteOutlined />}
                          style={{ position: 'absolute', top: -6, right: -6, padding: 0, width: 20, height: 20, fontSize: 12 }}
                          onClick={() => setAddPayScreenshots(prev => prev.filter((_, i) => i !== idx))} />
                      </div>
                    ))}
                    <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => {
                      const reader = new FileReader();
                      reader.onload = () => { if (typeof reader.result === 'string') setAddPayScreenshots(prev => [...prev, reader.result as string]); };
                      reader.readAsDataURL(file);
                      return false;
                    }}>
                      <Button size="small" icon={<UploadOutlined />}>选择图片</Button>
                    </Upload>
                    <Button size="small" onClick={() => {
                      navigator.clipboard.read().then(items => {
                        for (const item of items) {
                          const imgType = item.types.find(t => t.startsWith('image/'));
                          if (imgType) {
                            item.getType(imgType).then(blob => {
                              const reader = new FileReader();
                              reader.onload = () => { if (typeof reader.result === 'string') setAddPayScreenshots(prev => [...prev, reader.result as string]); };
                              reader.readAsDataURL(blob);
                            });
                            break;
                          }
                        }
                      }).catch(() => message.warning('无法读取剪贴板，请使用 Ctrl+V 粘贴'));
                    }}>📋 粘贴</Button>
                    <Text type="secondary" style={{ fontSize: 12 }}>或 Ctrl+V 粘贴图片</Text>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 选择供应商商品弹窗 */}
      <Modal title={`选择商品 - ${supplierOptions.find(s => s.value === addSupplier)?.label || ''}`}
        open={pickProductVisible} onCancel={() => setPickProductVisible(false)} onOk={confirmPickProducts}
        okText={`添加选中 (${pickSelected.length})`} cancelText="取消" width={900}>
        <div style={{ marginBottom: 8 }}>
          <Input placeholder="搜索商品编码/名称/款式/颜色" allowClear style={{ width: 300 }}
            value={pickSearchKw} onChange={e => setPickSearchKw(e.target.value)} />
        </div>
        <Table bordered size="small" dataSource={filteredProducts}
          rowKey={(_, i) => String(i)}
          rowSelection={{ selectedRowKeys: pickSelected, onChange: setPickSelected }}
          pagination={{ pageSize: 10, showTotal: t => `共 ${t} 个商品` }}
          locale={{ emptyText: addSupplier ? '该供应商暂无成品商品' : '请先选择供应商' }}
          columns={[
            { title: '图片', width: 60, align: 'center', render: (_: any, r: any) => (r.image || r.imageKey) ? <Image src={r.image || r.imageKey} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—' },
            { title: '商品编码', dataIndex: 'productCode', width: 130, align: 'center' },
            { title: '商品名称', width: 140, render: (_: any, r: any) => r.shortName || r.name || '—' },
            { title: '款式编码', dataIndex: 'styleCode', width: 100, align: 'center', render: (v: string) => v || '—' },
            { title: '颜色', dataIndex: 'color', width: 70, align: 'center', render: (v: string) => v || '—' },
            { title: '规格', dataIndex: 'spec', width: 70, align: 'center', render: (v: string) => v || '—' },
            { title: '基础售价', dataIndex: 'suggestedPrice', width: 100, align: 'right', render: (v: any) => v ? <Text style={{ color: '#f5222d' }}>¥{Number(v).toFixed(2)}</Text> : <Text type="secondary">未设置</Text> },
            { title: '可用库存', dataIndex: 'actualStock', width: 80, align: 'center', render: (v: any) => Number(v) || 0 },
          ]} />
      </Modal>

      {/* 订单详情弹窗 */}
      <Modal title={`订单详情 - ${detail?.id || ''}`} open={!!detail} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} width={900}>
        {detail && (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="供应商">{detail.supplierCompany}</Descriptions.Item>
              <Descriptions.Item label="采购商">{detail.purchaserCompany}</Descriptions.Item>
              <Descriptions.Item label="订单金额"><Text strong style={{ color: '#f5222d' }}>¥{Number(detail.totalAmount) || 0}</Text></Descriptions.Item>
              <Descriptions.Item label="订单状态"><Tag color={detail.status === '待推送' ? 'orange' : detail.status === '已推送' ? 'blue' : 'green'}>{detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="付款方式">{detail.payMethod || '—'}</Descriptions.Item>
              <Descriptions.Item label="下单时间">{dayjs(detail.createTime).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              {detail.pushTime && <Descriptions.Item label="推送时间">{detail.pushTime}</Descriptions.Item>}
              {detail.shipTime && <Descriptions.Item label="发货时间">{detail.shipTime}</Descriptions.Item>}
              {detail.status === '已取消' && <Descriptions.Item label="取消原因" span={2}>{detail.cancelReason || '—'}</Descriptions.Item>}
              {detail.contactPerson && <Descriptions.Item label="收货人">{detail.contactPerson} {detail.contactPhone}</Descriptions.Item>}
              {!detail.contactPerson && (detail.receiverName || detail.receiverPhone) && <Descriptions.Item label="收货人">{detail.receiverName || '—'} {detail.receiverPhone || ''}</Descriptions.Item>}
              {detail.address && <Descriptions.Item label="收货地址" span={2}>{detail.address}</Descriptions.Item>}
              <Descriptions.Item label="唛头">{detail.shippingMark || '—'}</Descriptions.Item>
              <Descriptions.Item label="创建人">{detail.creator || '—'}</Descriptions.Item>
              <Descriptions.Item label="备注/买家留言" span={2}>{detail.remark || detail.buyerMessage || '—'}</Descriptions.Item>
            </Descriptions>
            {/* 订单图片 */}
            {detail.images && detail.images.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary">订单图片：</Text>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {detail.images.map((img: string, idx: number) => (
                    <Image key={idx} src={img} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  ))}
                </div>
              </div>
            )}
            <Table rowKey={(x: any) => x.productCode + x.spec} bordered size="small" dataSource={detail.items || []}
              columns={[
                {
                  key: 'img', title: '图片', width: 70, align: 'center',
                  render: (_: any, x: any) => x.image ? <Image src={x.image} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—',
                },
                { key: 'shortName', title: '商品简称', dataIndex: 'shortName', width: 140, align: 'center' },
                { key: 'styleCode', title: '款式编码', dataIndex: 'styleCode', width: 110, align: 'center' },
                { key: 'color', title: '颜色', dataIndex: 'color', width: 90, align: 'center', render: (v: string) => v || '—' },
                { key: 'spec', title: '尺码/规格', dataIndex: 'spec', width: 100, align: 'center', render: (v: string) => v || '—' },
                { key: 'productCode', title: 'SKU编码', dataIndex: 'productCode', width: 150, align: 'center' },
                { key: 'unitPrice', title: '单价', dataIndex: 'unitPrice', width: 90, align: 'center', render: (v: number) => `¥${Number(v) || 0}` },
                { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 70, align: 'center' },
                { key: 'subtotal', title: '小计', dataIndex: 'subtotal', width: 100, align: 'center', render: (_: any, x: any) => <Text strong style={{ color: '#f5222d' }}>¥{((x.quantity || 0) * (x.unitPrice || 0)).toFixed(2)}</Text> },
              ]}
              pagination={false} />
            {detail.payShot && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">付款转账截图：</Text>
                <div style={{ marginTop: 6 }}><Image src={detail.payShot} width={160} /></div>
              </div>
            )}
            {/* 订单日志（参考供应商平台订单日志：创建/推送/发货等痕迹） */}
            <div style={{ marginTop: 12 }}>
              <div style={{ background: '#f0f5ff', borderRadius: 6, padding: '4px 12px', marginBottom: 6, color: '#1e4a7e', fontWeight: 600, fontSize: 13 }}>订单日志</div>
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(() => {
                  let logs: any[] = [];
                  try { logs = JSON.parse(detail.orderLog || '[]'); } catch { logs = []; }
                  if (!Array.isArray(logs) || logs.length === 0) return <Empty description="暂无操作记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
                  const colorOf = (a: string) => (a || '').includes('创建') ? '#fa8c16' : (a || '').includes('推送') ? '#1677ff' : (a || '').includes('发货') ? '#f5222d' : (a || '').includes('取消') ? '#8c8c8c' : '#52c41a';
                  return logs.map((log: any, i: number) => (
                    <div key={i} style={{ padding: '6px 8px', background: i % 2 === 0 ? '#fafafa' : '#fff', border: '1px solid #f0f0f0', borderRadius: 4, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colorOf(log.action || ''), fontWeight: 600 }}>{log.action}</Text>
                        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{log.operator || '-'}</Text>
                      </div>
                      {log.detail && <div style={{ color: '#595959', marginTop: 2, whiteSpace: 'pre-wrap' }}>{log.detail}</div>}
                      <div style={{ color: '#bfbfbf', fontSize: 11, marginTop: 2 }}>{log.time}</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* 数量模版管理弹窗 */}
      <QtyTemplateManagerModal
        open={qtyTemplateVisible}
        onClose={() => setQtyTemplateVisible(false)}
        templates={qtyTemplates}
        onChange={handleQtyTemplateChange}
        onPickTemplate={openQtyFill}
      />

      {/* 货品明细字段显示/顺序配置 */}
      <FieldConfigModal
        open={itemFieldConfigVisible}
        fields={ITEM_FIELD_DEFS}
        order={itemFieldCfg.order}
        visibility={itemFieldCfg.visibility}
        onSave={saveItemFieldCfg}
        onCancel={() => setItemFieldConfigVisible(false)}
        title="货品明细显示字段"
      />

      {/* 订单列表字段显示/顺序配置 */}
      <FieldConfigModal
        open={listFieldConfigVisible}
        fields={ORDER_LIST_FIELD_DEFS}
        order={listFieldCfg.order}
        visibility={listFieldCfg.visibility}
        onSave={saveListFieldCfg}
        onCancel={() => setListFieldConfigVisible(false)}
        title="订单列表显示字段"
      />

      {/* 分段付款：登记本期付款弹窗 */}
      <Modal
        open={!!payRegTarget}
        title={<span>登记本期付款{payRegTarget ? ` — ${payRegTarget.id}` : ''}</span>}
        onCancel={() => setPayRegTarget(null)}
        onOk={handlePayRegConfirm}
        okText="确认登记" cancelText="取消" width={480} destroyOnClose
      >
        {payRegTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
              订单总额 ¥{Number(payRegTarget.totalAmount || 0).toFixed(2)}｜累计已付 ¥{sumPayRecords(payRegTarget.payRecords).toFixed(2)}｜剩余欠款 ¥{(Math.round(((Number(payRegTarget.totalAmount) || 0) - sumPayRecords(payRegTarget.payRecords)) * 100) / 100).toFixed(2)}｜定金比例 {payRegTarget.depositRatio || 30}%<br />
              分段金额仅记订单分期台账，不写入账单明细；会计账薄开启时自动生成分录（借：预付账款／贷：银行存款），摘要为订单号。
            </div>
            <div>
              <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>本期付款金额（默认：{sumPayRecords(payRegTarget.payRecords) <= 0 ? '定金' : '剩余欠款'}）：</Text>
              <InputNumber style={{ width: '100%' }} min={0.01} precision={2} prefix="¥" value={payRegAmount}
                placeholder={(sumPayRecords(payRegTarget.payRecords) <= 0 ? depositAmountOf(payRegTarget, Number(payRegTarget.totalAmount) || 0) : Math.round(((Number(payRegTarget.totalAmount) || 0) - sumPayRecords(payRegTarget.payRecords)) * 100) / 100).toFixed(2)}
                onChange={v => setPayRegAmount(v as number | null)} />
            </div>
            <div>
              <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>付款银行账户：</Text>
              <Select style={{ width: '100%' }} showSearch allowClear placeholder="选择付款银行账户" value={payRegBank || undefined}
                options={bankAccounts.map((b: any) => ({ value: b.name || b.shortName, label: `${b.name || b.shortName}${b.bankName ? `（${b.bankName}）` : ''}` }))}
                onChange={v => setPayRegBank(v || '')} />
            </div>
            <div>
              <Upload accept="image/*" showUploadList={false} beforeUpload={(f: any) => { const rd = new FileReader(); rd.onload = () => setPayRegShot(String(rd.result)); rd.readAsDataURL(f); return false; }}>
                <Button size="small" icon={<UploadOutlined />}>{payRegShot ? '更换付款截图' : '上传付款截图（可选）'}</Button>
              </Upload>
            </div>
          </div>
        )}
      </Modal>

      {/* 数量模版填充确认弹窗 */}
      <QtyFillConfirmModal
        open={qtyFillVisible}
        template={qtyFillTemplate}
        multiplier={qtyFillMultiplier}
        onMultiplier={setQtyFillMultiplier}
        onClose={() => setQtyFillVisible(false)}
        onConfirm={confirmQtyFill}
      />
    </div>
  );
};

export default MarketOrdersPage;
