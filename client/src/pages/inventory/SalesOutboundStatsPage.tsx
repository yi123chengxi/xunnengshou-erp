import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Tag, Tooltip,
  DatePicker, Select, Checkbox, Tabs, Dropdown, Statistic, Empty, Divider, Modal,
} from 'antd';
import {
  SearchOutlined, ExportOutlined, ReloadOutlined, DownOutlined,
  BarChartOutlined, ShopOutlined, UserOutlined, AppstoreOutlined,
  RiseOutlined, FilterOutlined, FileTextOutlined, AppstoreAddOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import FieldConfigModal, { FieldConfigItem } from '../../components/FieldConfigModal';
import { useDatasetSyncReload } from '../../utils/useDatasetSyncReload';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const PRIMARY = '#1e4a7e';

// 从商品编码中提取款式编码前缀（如 "5815-黑色-35" → "5815"）
const extractStylePrefix = (code: string): string => {
  if (!code) return '';
  const m = code.match(/^[^-]+/);
  return m ? m[0] : code;
};

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

/* ---------- 数据模型 ---------- */
interface SoItem {
  code: string;
  productName: string;
  styleCode: string;
  color: string;
  spec: string;
  unit: string;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  price?: number;
  unitPrice?: number;
}
interface SoRecord {
  key: string;
  docNo: string;
  orderId: string;
  customerName: string;
  shopName: string;
  receiverName: string;
  productDetail: string;
  totalQty: number;
  items: SoItem[];
  operator: string;
  createTime: string;
  status: string;
  remark: string;
}

/* ---------- 聚合行模型 ---------- */
interface ProductAggRow {
  key: string;
  styleCode: string;       // 款式编码
  productCode: string;     // 商品编码
  productName: string;     // 商品名称
  color: string;           // 颜色
  spec: string;            // 规格
  salesQty: number;        // 销售数量
  shippedQty: number;      // 实发数量
  orderCount: number;      // 销售单数
  outboundCount: number;   // 出库次数
  shops: string;           // 涉及店铺
  customers: string;       // 涉及客户
  amount: number;          // 销售金额
}
interface CustomerAggRow {
  key: string;
  customerName: string;
  orderCount: number;
  totalQty: number;
  amount: number;
  productCount: number;
}
interface ShopAggRow {
  key: string;
  shopName: string;
  orderCount: number;
  totalQty: number;
  amount: number;
  productCount: number;
  customerCount: number;
}
interface StyleCodeAggRow {
  key: string;
  styleCode: string;
  productCount: number;
  totalQty: number;
  shippedQty: number;
  orderCount: number;
  outboundCount: number;
  shops: string;
  customers: string;
  amount: number;
}

const STORAGE_KEY = (owner: string) => `sales_outbound_${owner}`;
const ORDER_KEY = (owner: string) => `pageData_sales_order-manage_${owner}`;

const loadOutboundData = (owner: string): SoRecord[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY(owner)) || '[]'); } catch { return []; }
};
const loadOrderData = (owner: string): any[] => {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY(owner)) || '[]'); } catch { return []; }
};

/**
 * 销售出库统计页面：按款式编码/客户/店铺多维度分析销售出库数据
 * - 左侧筛选面板（发货时间/商品编码/商品名称/店铺/品牌）
 * - 右侧数据区（汇总卡片 + 聚合表格 + 底部汇总行 + 导出）
 * - 三个页签：销售排行(商品) / 按客户统计 / 按店铺统计
 */
const SalesOutboundStatsPage: React.FC = () => {
  const owner = getDataOwner();
  const [allData, setAllData] = useState<SoRecord[]>(() => loadOutboundData(owner));
  const [allOrders, setAllOrders] = useState<any[]>(() => loadOrderData(owner));

  // 筛选条件
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs('2026-01-01'), dayjs()]);
  const [filterStyleCode, setFilterStyleCode] = useState('');
  const [filterProductCode, setFilterProductCode] = useState('');
  const [filterProductName, setFilterProductName] = useState('');
  const [filterShop, setFilterShop] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [splitCombo, setSplitCombo] = useState(true);
  const [activeTab, setActiveTab] = useState('product');
  const [dataSource, setDataSource] = useState<'outbound' | 'order'>('outbound');
  // 款式编码选择弹窗
  const [styleCodeModalVisible, setStyleCodeModalVisible] = useState(false);
  const [styleCodeSearch, setStyleCodeSearch] = useState('');
  const [selectedStyleCodes, setSelectedStyleCodes] = useState<string[]>(() =>
    filterStyleCode ? filterStyleCode.split(',').filter(Boolean) : []
  );
  // 商品编码选择弹窗
  const [productCodeModalVisible, setProductCodeModalVisible] = useState(false);
  const [productCodeSearch, setProductCodeSearch] = useState('');
  const [selectedProductCodes, setSelectedProductCodes] = useState<string[]>(() =>
    filterProductCode ? filterProductCode.split(',').filter(Boolean) : []
  );

  // 字段显示控制
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(`sos_fieldOrder_${owner}`) || '[]'); return Array.isArray(v) && v.length ? v : []; } catch { return []; }
  });
  const [fieldVis, setFieldVis] = useState<Record<string, boolean>>(() => {
    try { const v = JSON.parse(localStorage.getItem(`sos_fieldVis_${owner}`) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  });

  // 表格滚动条固定视口底部：测量 .ant-table-body 的 top，算出可用高度
  const [scrollY, setScrollY] = useState<number | string>('calc(100vh - 360px)');
  useEffect(() => {
    const recalc = () => {
      const body = document.querySelector('.ant-table-body') as HTMLElement | null;
      if (!body) return;
      const top = body.getBoundingClientRect().top;
      const h = Math.max(220, window.innerHeight - top - 44);
      setScrollY(h);
      body.style.minHeight = `${h}px`;
    };
    const t1 = setTimeout(recalc, 100);
    const t2 = setTimeout(recalc, 500);
    window.addEventListener('resize', recalc);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', recalc);
    };
  }, [activeTab, dataSource]);

  // 刷新数据
  const refresh = useCallback(() => {
    setAllData(loadOutboundData(owner));
    setAllOrders(loadOrderData(owner));
  }, [owner]);

  // 同步落地/窗口重新可见时重读：出货统计是实时聚合快照，不重读就会
  // 一直展示别端出库前的旧数字
  useDatasetSyncReload(refresh);

  // 加载成品列表（仅成品），提取款式编码和商品编码
  const productList = useMemo(() => {
    try {
      const all = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]');
      return (Array.isArray(all) ? all : []).filter((p: any) => p.productType === '成品');
    } catch { return []; }
  }, [owner]);

  const styleCodeList = useMemo(() => {
    const map = new Map<string, { styleCode: string; products: string[]; shortNames: string[] }>();
    productList.forEach((p: any) => {
      const sc = (p.styleCode || '').trim();
      if (!sc) return;
      const existing = map.get(sc);
      const name = p.shortName || p.name || '';
      const code = p.productCode || p.code || '';
      if (existing) {
        if (code && !existing.products.includes(code)) existing.products.push(code);
        if (name && !existing.shortNames.includes(name)) existing.shortNames.push(name);
      } else {
        map.set(sc, { styleCode: sc, products: code ? [code] : [], shortNames: name ? [name] : [] });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.styleCode.localeCompare(b.styleCode));
  }, [productList]);

  const productCodeList = useMemo(() => {
    const map = new Map<string, { productCode: string; styleCode: string; shortName: string }>();
    productList.forEach((p: any) => {
      const code = (p.productCode || p.code || '').trim();
      if (!code) return;
      if (!map.has(code)) {
        map.set(code, { productCode: code, styleCode: p.styleCode || '', shortName: p.shortName || p.name || '' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.productCode.localeCompare(b.productCode));
  }, [productList]);

  const filteredProductCodes = useMemo(() => {
    const q = productCodeSearch.trim().toLowerCase();
    if (!q) return productCodeList;
    return productCodeList.filter(p =>
      p.productCode.toLowerCase().includes(q) ||
      p.styleCode.toLowerCase().includes(q) ||
      p.shortName.toLowerCase().includes(q)
    );
  }, [productCodeList, productCodeSearch]);

  const filteredStyleCodes = useMemo(() => {
    const q = styleCodeSearch.trim().toLowerCase();
    if (!q) return styleCodeList;
    return styleCodeList.filter(s =>
      s.styleCode.toLowerCase().includes(q) ||
      s.shortNames.some(n => n.toLowerCase().includes(q)) ||
      s.products.some(p => p.toLowerCase().includes(q))
    );
  }, [styleCodeList, styleCodeSearch]);

  // 所有店铺选项（从数据中提取）
  const shopOptions = useMemo(() => {
    const shops = new Set<string>();
    allData.forEach(r => { if (r.shopName) shops.add(r.shopName); });
    return Array.from(shops).sort().map(s => ({ label: s, value: s }));
  }, [allData]);

  /* ========== 数据过滤 ========== */
  const filteredRecords = useMemo(() => {
    const start = dateRange[0].startOf('day');
    const end = dateRange[1].endOf('day');
    const qStyles = filterStyleCode.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const qProducts = filterProductCode.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const qName = filterProductName.trim().toLowerCase();
    const qShop = filterShop;
    const qCust = filterCustomer.trim().toLowerCase();
    const hasItemFilter = qStyles.length > 0 || qProducts.length > 0 || qName;
    return allData
      .filter(r => {
        const d = dayjs(r.createTime);
        if (!d.isValid() || d.isBefore(start) || d.isAfter(end)) return false;
        if (qShop && r.shopName !== qShop) return false;
        if (qCust && !(r.customerName || '').toLowerCase().includes(qCust)) return false;
        return true;
      })
      .map(r => {
        if (!hasItemFilter) return r;
        const items = Array.isArray(r.items) ? r.items : [];
        const matched = items.filter((it: SoItem) => {
          const styleOk = qStyles.length === 0 || qStyles.some(s => (it.styleCode || '').toLowerCase().includes(s));
          const productOk = qProducts.length === 0 || qProducts.some(p => (it.code || '').toLowerCase().includes(p));
          const nameOk = !qName || (it.productName || '').toLowerCase().includes(qName);
          return styleOk && productOk && nameOk;
        });
        if (matched.length === 0) return null;
        return { ...r, items: matched };
      })
      .filter(Boolean) as SoRecord[];
  }, [allData, dateRange, filterStyleCode, filterProductCode, filterProductName, filterShop, filterCustomer]);

  /* ========== 按商品聚合（销售排行） ========== */
  const productAggData = useMemo((): ProductAggRow[] => {
    const map = new Map<string, ProductAggRow>();
    filteredRecords.forEach(rec => {
      const items = Array.isArray(rec.items) ? rec.items : [];
      const expandItems = splitCombo ? items : [{ ...items[0], quantity: items.reduce((s, i) => s + (Number(i.quantity) || 0), 0), productName: items.map(i => i.productName).join('+') } as SoItem];
      expandItems.forEach((it: SoItem) => {
        if (!it) return;
        const styleCode = it.styleCode || extractStylePrefix(it.code) || '未知';
        const productCode = it.code || it.styleCode || '';
        const color = it.color || '';
        const spec = it.spec || '';
        const aggKey = `${styleCode}|${color}|${spec}`;
        const existing = map.get(aggKey);
        const qty = Number(it.quantity) || 0;
        const price = Number(it.price) || Number(it.unitPrice) || 0;
        if (existing) {
          existing.salesQty += qty;
          existing.shippedQty += qty;
          existing.amount += qty * price;
          if (!existing.shops.includes(rec.shopName || '')) existing.shops += `,${rec.shopName || ''}`;
          if (!existing.customers.includes(rec.customerName || '')) existing.customers += `,${rec.customerName || ''}`;
          existing.outboundCount += 1;
        } else {
          map.set(aggKey, {
            key: aggKey,
            styleCode,
            productCode,
            productName: it.productName || '',
            color,
            spec,
            salesQty: qty,
            shippedQty: qty,
            orderCount: 1,
            outboundCount: 1,
            shops: rec.shopName || '',
            customers: rec.customerName || '',
            amount: qty * price,
          });
        }
      });
    });
    // 按销售数量降序排列
    return Array.from(map.values()).sort((a, b) => b.salesQty - a.salesQty);
  }, [filteredRecords, splitCombo]);

  /* ========== 按客户聚合 ========== */
  const customerAggData = useMemo((): CustomerAggRow[] => {
    const map = new Map<string, CustomerAggRow>();
    filteredRecords.forEach(rec => {
      const name = rec.customerName || '未知客户';
      const existing = map.get(name);
      const items = Array.isArray(rec.items) ? rec.items : [];
      const qty = items.reduce((s: number, it: SoItem) => s + (Number(it.quantity) || 0), 0);
      const amt = items.reduce((s: number, it: SoItem) => s + (Number(it.quantity) || 0) * (Number(it.price) || Number(it.unitPrice) || 0), 0);
      const prodCount = new Set(items.map((it: SoItem) => it.styleCode || it.code)).size;
      if (existing) {
        existing.orderCount += 1;
        existing.totalQty += qty;
        existing.amount += amt;
        existing.productCount = Math.max(existing.productCount, prodCount);
      } else {
        map.set(name, { key: name, customerName: name, orderCount: 1, totalQty: qty, amount: amt, productCount: prodCount });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredRecords]);

  /* ========== 按店铺聚合 ========== */
  const shopAggData = useMemo((): ShopAggRow[] => {
    const map = new Map<string, ShopAggRow>();
    filteredRecords.forEach(rec => {
      const name = rec.shopName || '未知店铺';
      const existing = map.get(name);
      const items = Array.isArray(rec.items) ? rec.items : [];
      const qty = items.reduce((s: number, it: SoItem) => s + (Number(it.quantity) || 0), 0);
      const amt = items.reduce((s: number, it: SoItem) => s + (Number(it.quantity) || 0) * (Number(it.price) || Number(it.unitPrice) || 0), 0);
      const prodCount = new Set(items.map((it: SoItem) => it.styleCode || it.code)).size;
      const custSet = new Set<string>();
      custSet.add(rec.customerName || '');
      if (existing) {
        existing.orderCount += 1;
        existing.totalQty += qty;
        existing.amount += amt;
        existing.productCount += prodCount;
        existing.customerCount = Math.max(existing.customerCount, custSet.size);
      } else {
        map.set(name, { key: name, shopName: name, orderCount: 1, totalQty: qty, amount: amt, productCount: prodCount, customerCount: custSet.size });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredRecords]);

  /* ========== 按款式编码聚合（销售出库） ========== */
  const styleCodeAggData = useMemo((): StyleCodeAggRow[] => {
    const map = new Map<string, StyleCodeAggRow>();
    const productMap = new Map<string, Set<string>>();
    filteredRecords.forEach(rec => {
      const items = Array.isArray(rec.items) ? rec.items : [];
      items.forEach((it: SoItem) => {
        if (!it) return;
        const styleCode = it.styleCode || extractStylePrefix(it.code) || '未知';
        const existing = map.get(styleCode);
        const qty = Number(it.quantity) || 0;
        const price = Number(it.price) || Number(it.unitPrice) || 0;
        const productKey = it.code || it.styleCode || '';
        if (existing) {
          existing.totalQty += qty;
          existing.shippedQty += qty;
          existing.amount += qty * price;
          existing.outboundCount += 1;
          if (productKey) productMap.get(styleCode)?.add(productKey);
          if (!existing.shops.includes(rec.shopName || '')) existing.shops += `,${rec.shopName || ''}`;
          if (!existing.customers.includes(rec.customerName || '')) existing.customers += `,${rec.customerName || ''}`;
        } else {
          map.set(styleCode, {
            key: styleCode,
            styleCode,
            productCount: 1,
            totalQty: qty,
            shippedQty: qty,
            orderCount: 1,
            outboundCount: 1,
            shops: rec.shopName || '',
            customers: rec.customerName || '',
            amount: qty * price,
          });
          productMap.set(styleCode, new Set(productKey ? [productKey] : []));
        }
      });
    });
    return Array.from(map.values()).map(r => ({ ...r, productCount: productMap.get(r.styleCode)?.size || 1 })).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredRecords]);

  /* ========== 订单管理数据过滤（排除已取消） ========== */
  const filteredOrders = useMemo(() => {
    const start = dateRange[0].startOf('day');
    const end = dateRange[1].endOf('day');
    const qStyles = filterStyleCode.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const qProducts = filterProductCode.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const qName = filterProductName.trim().toLowerCase();
    const qShop = filterShop;
    const qCust = filterCustomer.trim().toLowerCase();
    const hasItemFilter = qStyles.length > 0 || qProducts.length > 0 || qName;
    return allOrders
      .filter((o: any) => {
        if (o.orderStatus === '已取消' || o.auditStatus === '已取消') return false;
        const d = dayjs(o.payTime || o.createTime);
        if (!d.isValid() || d.isBefore(start) || d.isAfter(end)) return false;
        if (qShop && o.shopName !== qShop && o.shop !== qShop) return false;
        if (qCust && !(o.customerName || '').toLowerCase().includes(qCust)) return false;
        return true;
      })
      .map((o: any) => {
        let items: any[] = [];
        try { items = JSON.parse(o.orderItems || '[]'); } catch { /* ignore */ }
        if (!hasItemFilter) return { ...o, _filteredItems: items };
        const matched = items.filter((it: any) => {
          const styleOk = qStyles.length === 0 || qStyles.some(s => (it.styleCode || '').toLowerCase().includes(s));
          const productOk = qProducts.length === 0 || qProducts.some(p => (it.productCode || '').toLowerCase().includes(p));
          const nameOk = !qName || (it.productName || '').toLowerCase().includes(qName);
          return styleOk && productOk && nameOk;
        });
        if (matched.length === 0) return null;
        return { ...o, _filteredItems: matched };
      })
      .filter(Boolean) as any[];
  }, [allOrders, dateRange, filterStyleCode, filterProductCode, filterProductName, filterShop, filterCustomer]);

  /* ========== 订单管理 - 按商品聚合 ========== */
  const orderProductAggData = useMemo((): ProductAggRow[] => {
    const map = new Map<string, ProductAggRow>();
    filteredOrders.forEach((ord: any) => {
      const items: any[] = ord._filteredItems || [];
      items.forEach((it: any) => {
        if (!it) return;
        const styleCode = it.styleCode || extractStylePrefix(it.productCode) || '未知';
        const productCode = it.productCode || it.styleCode || '';
        const color = it.color || '';
        const spec = it.spec || it.size || '';
        const aggKey = `${styleCode}|${color}|${spec}`;
        const existing = map.get(aggKey);
        const qty = Number(it.quantity) || 0;
        const price = Number(it.price) || Number(it.unitPrice) || 0;
        const shopName = ord.shopName || ord.shop || '';
        if (existing) {
          existing.salesQty += qty;
          existing.shippedQty += qty;
          existing.amount += qty * price;
          existing.orderCount += 1;
          if (!existing.shops.includes(shopName)) existing.shops += `,${shopName}`;
          if (!existing.customers.includes(ord.customerName || '')) existing.customers += `,${ord.customerName || ''}`;
        } else {
          map.set(aggKey, {
            key: aggKey,
            styleCode,
            productCode,
            productName: it.productName || '',
            color,
            spec,
            salesQty: qty,
            shippedQty: qty,
            orderCount: 1,
            outboundCount: 0,
            shops: shopName,
            customers: ord.customerName || '',
            amount: qty * price,
          });
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => b.salesQty - a.salesQty);
  }, [filteredOrders]);

  /* ========== 订单管理 - 按客户聚合 ========== */
  const orderCustomerAggData = useMemo((): CustomerAggRow[] => {
    const map = new Map<string, CustomerAggRow>();
    filteredOrders.forEach((o: any) => {
      const name = o.customerName || '未知客户';
      const existing = map.get(name);
      const items: any[] = o._filteredItems || [];
      const qty = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
      const amt = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.price) || Number(it.unitPrice) || 0), 0);
      const prodCount = new Set(items.map((it: any) => it.styleCode || it.productCode)).size;
      if (existing) {
        existing.orderCount += 1;
        existing.totalQty += qty;
        existing.amount += amt;
        existing.productCount = Math.max(existing.productCount, prodCount);
      } else {
        map.set(name, { key: name, customerName: name, orderCount: 1, totalQty: qty, amount: amt, productCount: prodCount });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredOrders]);

  /* ========== 订单管理 - 按店铺聚合 ========== */
  const orderShopAggData = useMemo((): ShopAggRow[] => {
    const map = new Map<string, ShopAggRow>();
    filteredOrders.forEach((o: any) => {
      const name = o.shopName || o.shop || '未知店铺';
      const existing = map.get(name);
      const items: any[] = o._filteredItems || [];
      const qty = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
      const amt = items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.price) || Number(it.unitPrice) || 0), 0);
      const prodCount = new Set(items.map((it: any) => it.styleCode || it.productCode)).size;
      const custSet = new Set<string>();
      custSet.add(o.customerName || '');
      if (existing) {
        existing.orderCount += 1;
        existing.totalQty += qty;
        existing.amount += amt;
        existing.productCount += prodCount;
        existing.customerCount += custSet.size;
      } else {
        map.set(name, { key: name, shopName: name, orderCount: 1, totalQty: qty, amount: amt, productCount: prodCount, customerCount: custSet.size });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredOrders]);

  /* ========== 订单管理 - 按款式编码聚合 ========== */
  const orderStyleCodeAggData = useMemo((): StyleCodeAggRow[] => {
    const map = new Map<string, StyleCodeAggRow>();
    const productMap = new Map<string, Set<string>>();
    filteredOrders.forEach((o: any) => {
      const items: any[] = o._filteredItems || [];
      const shopName = o.shopName || o.shop || '';
      items.forEach((it: any) => {
        if (!it) return;
        const styleCode = it.styleCode || extractStylePrefix(it.productCode) || '未知';
        const existing = map.get(styleCode);
        const qty = Number(it.quantity) || 0;
        const price = Number(it.price) || Number(it.unitPrice) || 0;
        const productKey = it.productCode || it.styleCode || '';
        if (existing) {
          existing.totalQty += qty;
          existing.shippedQty += qty;
          existing.amount += qty * price;
          existing.orderCount += 1;
          if (productKey) productMap.get(styleCode)?.add(productKey);
          if (!existing.shops.includes(shopName)) existing.shops += `,${shopName}`;
          if (!existing.customers.includes(o.customerName || '')) existing.customers += `,${o.customerName || ''}`;
        } else {
          map.set(styleCode, {
            key: styleCode,
            styleCode,
            productCount: 1,
            totalQty: qty,
            shippedQty: qty,
            orderCount: 1,
            outboundCount: 0,
            shops: shopName,
            customers: o.customerName || '',
            amount: qty * price,
          });
          productMap.set(styleCode, new Set(productKey ? [productKey] : []));
        }
      });
    });
    return Array.from(map.values()).map(r => ({ ...r, productCount: productMap.get(r.styleCode)?.size || 1 })).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredOrders]);

  /* ========== 订单管理汇总 ========== */
  const orderSummary = useMemo(() => {
    const totalQty = orderProductAggData.reduce((s, r) => s + r.salesQty, 0);
    const totalOrders = filteredOrders.length;
    const totalProducts = orderProductAggData.length;
    return { totalQty, totalOrders, totalProducts };
  }, [orderProductAggData, filteredOrders]);

  /* ========== 汇总统计 ========= */
  const summary = useMemo(() => {
    const isOrder = dataSource === 'order';
    const prodAgg = isOrder ? orderProductAggData : productAggData;
    const totalSalesQty = prodAgg.reduce((s, r) => s + r.salesQty, 0);
    const totalOrders = isOrder ? filteredOrders.length : filteredRecords.length;
    const totalAmount = prodAgg.reduce((s, r) => s + r.amount, 0);
    const totalProducts = prodAgg.length;
    return { totalSalesQty, totalOrders, totalAmount, totalProducts };
  }, [productAggData, filteredRecords, orderProductAggData, filteredOrders, dataSource]);

  /* ========== 导出 CSV ========== */
  const handleExport = useCallback((type: string) => {
    let header = '';
    let body = '';
    let filename = '';
    if (type === 'product') {
      header = '款式编码,商品编码,商品名称,颜色,规格,销售数量,实发数量,出库次数,涉及店铺,涉及客户\n';
      body = productAggData.map(r =>
        [r.styleCode, r.productCode, r.productName, r.color, r.spec, r.salesQty, r.shippedQty, r.outboundCount, r.shops, r.customers].join(',')
      ).join('\n');
      filename = `销售排行(商品)_${dayjs().format('YYYYMMDD')}.csv`;
    } else if (type === 'customer') {
      header = '客户名称,销售单数,销售数量,销售金额,涉及款式数\n';
      body = customerAggData.map(r =>
        [r.customerName, r.orderCount, r.totalQty, r.amount.toFixed(2), r.productCount].join(',')
      ).join('\n');
      filename = `按客户统计_${dayjs().format('YYYYMMDD')}.csv`;
    } else if (type === 'shop') {
      header = '店铺名称,销售单数,销售数量,销售金额,涉及款式数,涉及客户数\n';
      body = shopAggData.map(r =>
        [r.shopName, r.orderCount, r.totalQty, r.amount.toFixed(2), r.productCount, r.customerCount].join(',')
      ).join('\n');
      filename = `按店铺统计_${dayjs().format('YYYYMMDD')}.csv`;
    } else if (type === 'styleCode') {
      header = '款式编码,涉及商品数,销售数量,实发数量,出库次数,涉及店铺,涉及客户\n';
      body = styleCodeAggData.map(r =>
        [r.styleCode, r.productCount, r.totalQty, r.shippedQty, r.outboundCount, r.shops, r.customers].join(',')
      ).join('\n');
      filename = `款式编码统计_${dayjs().format('YYYYMMDD')}.csv`;
    } else if (type === 'order-product') {
      header = '款式编码,商品编码,商品名称,颜色,规格,订单数量,涉及订单数,涉及店铺,涉及客户\n';
      body = orderProductAggData.map(r =>
        [r.styleCode, r.productCode, r.productName, r.color, r.spec, r.salesQty, r.orderCount, r.shops, r.customers].join(',')
      ).join('\n');
      filename = `订单管理-商品统计_${dayjs().format('YYYYMMDD')}.csv`;
    } else if (type === 'order-customer') {
      header = '客户名称,订单数,订货数量,订货金额,涉及款式数\n';
      body = orderCustomerAggData.map(r =>
        [r.customerName, r.orderCount, r.totalQty, r.amount.toFixed(2), r.productCount].join(',')
      ).join('\n');
      filename = `订单管理-客户统计_${dayjs().format('YYYYMMDD')}.csv`;
    } else if (type === 'order-styleCode') {
      header = '款式编码,涉及商品数,订单数量,涉及订单数,涉及店铺,涉及客户\n';
      body = orderStyleCodeAggData.map(r =>
        [r.styleCode, r.productCount, r.totalQty, r.orderCount, r.shops, r.customers].join(',')
      ).join('\n');
      filename = `订单管理-款式编码统计_${dayjs().format('YYYYMMDD')}.csv`;
    } else {
      header = '店铺名称,订单数,订货数量,订货金额,涉及款式数,涉及客户数\n';
      body = orderShopAggData.map(r =>
        [r.shopName, r.orderCount, r.totalQty, r.amount.toFixed(2), r.productCount, r.customerCount].join(',')
      ).join('\n');
      filename = `订单管理-店铺统计_${dayjs().format('YYYYMMDD')}.csv`;
    }
    const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }, [productAggData, customerAggData, shopAggData, orderProductAggData, orderCustomerAggData, orderShopAggData, styleCodeAggData, orderStyleCodeAggData]);

  /* ========== 重置筛选 ========== */
  const handleReset = useCallback(() => {
    setDateRange([dayjs('2026-01-01'), dayjs()]);
    setFilterStyleCode('');
    setFilterProductCode('');
    setFilterProductName('');
    setFilterShop('');
    setFilterCustomer('');
    setSelectedStyleCodes([]);
    setSelectedProductCodes([]);
    setDataSource('outbound');
  }, []);

  /* ========== 表格列定义 ========== */
  const productColumns = useMemo(() => [
    { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 150,
      render: (v: string) => <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 130 },
    { title: '商品名称', dataIndex: 'productName', key: 'productName', width: 160, ellipsis: true },
    { title: '颜色', dataIndex: 'color', key: 'color', width: 80 },
    { title: '规格', dataIndex: 'spec', key: 'spec', width: 80 },
    { title: '销售数量', dataIndex: 'salesQty', key: 'salesQty', width: 100, align: 'right' as const,
      sorter: (a: ProductAggRow, b: ProductAggRow) => a.salesQty - b.salesQty,
      render: (v: number) => <Text strong style={{ color: '#f5222d', fontSize: 14 }}>{v.toLocaleString()}</Text> },
    { title: '实发数量', dataIndex: 'shippedQty', key: 'shippedQty', width: 100, align: 'right' as const },
    { title: '出库次数', dataIndex: 'outboundCount', key: 'outboundCount', width: 90, align: 'right' as const },
    { title: '涉及店铺', dataIndex: 'shops', key: 'shops', width: 140, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
    { title: '涉及客户', dataIndex: 'customers', key: 'customers', width: 140, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
  ], []);

  const customerColumns = useMemo(() => [
    { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 180,
      render: (v: string) => <Text strong style={{ color: PRIMARY }}>{v}</Text> },
    { title: '销售单数', dataIndex: 'orderCount', key: 'orderCount', width: 100, align: 'right' as const,
      sorter: (a: CustomerAggRow, b: CustomerAggRow) => a.orderCount - b.orderCount },
    { title: '销售数量', dataIndex: 'totalQty', key: 'totalQty', width: 110, align: 'right' as const,
      sorter: (a: CustomerAggRow, b: CustomerAggRow) => a.totalQty - b.totalQty,
      render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{v.toLocaleString()}</Text> },
    { title: '涉及款式数', dataIndex: 'productCount', key: 'productCount', width: 110, align: 'right' as const },
  ], []);

  const shopColumns = useMemo(() => [
    { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 160,
      render: (v: string) => <Text strong style={{ color: PRIMARY }}>{v || '未知店铺'}</Text> },
    { title: '销售单数', dataIndex: 'orderCount', key: 'orderCount', width: 100, align: 'right' as const,
      sorter: (a: ShopAggRow, b: ShopAggRow) => a.orderCount - b.orderCount },
    { title: '销售数量', dataIndex: 'totalQty', key: 'totalQty', width: 110, align: 'right' as const,
      sorter: (a: ShopAggRow, b: ShopAggRow) => a.totalQty - b.totalQty,
      render: (v: number) => <Text strong style={{ color: '#f5222d' }}>{v.toLocaleString()}</Text> },
    { title: '涉及款式数', dataIndex: 'productCount', key: 'productCount', width: 110, align: 'right' as const },
    { title: '涉及客户数', dataIndex: 'customerCount', key: 'customerCount', width: 110, align: 'right' as const },
  ], []);

  /* ========== 款式编码统计列定义 ========== */
  const styleCodeColumns = useMemo(() => [
    { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 150,
      render: (v: string) => <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: '涉及商品数', dataIndex: 'productCount', key: 'productCount', width: 110, align: 'right' as const,
      sorter: (a: StyleCodeAggRow, b: StyleCodeAggRow) => a.productCount - b.productCount },
    { title: '销售数量', dataIndex: 'totalQty', key: 'totalQty', width: 110, align: 'right' as const,
      sorter: (a: StyleCodeAggRow, b: StyleCodeAggRow) => a.totalQty - b.totalQty,
      render: (v: number) => <Text strong style={{ color: '#f5222d', fontSize: 14 }}>{v.toLocaleString()}</Text> },
    { title: '实发数量', dataIndex: 'shippedQty', key: 'shippedQty', width: 100, align: 'right' as const },
    { title: '出库次数', dataIndex: 'outboundCount', key: 'outboundCount', width: 90, align: 'right' as const },
    { title: '涉及店铺', dataIndex: 'shops', key: 'shops', width: 160, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
    { title: '涉及客户', dataIndex: 'customers', key: 'customers', width: 160, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
  ], []);

  const orderStyleCodeColumns = useMemo(() => [
    { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 150,
      render: (v: string) => <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: '涉及商品数', dataIndex: 'productCount', key: 'productCount', width: 110, align: 'right' as const,
      sorter: (a: StyleCodeAggRow, b: StyleCodeAggRow) => a.productCount - b.productCount },
    { title: '订单数量', dataIndex: 'totalQty', key: 'totalQty', width: 110, align: 'right' as const,
      sorter: (a: StyleCodeAggRow, b: StyleCodeAggRow) => a.totalQty - b.totalQty,
      render: (v: number) => <Text strong style={{ color: '#f5222d', fontSize: 14 }}>{v.toLocaleString()}</Text> },
    { title: '涉及订单数', dataIndex: 'orderCount', key: 'orderCount', width: 100, align: 'right' as const },
    { title: '涉及店铺', dataIndex: 'shops', key: 'shops', width: 160, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
    { title: '涉及客户', dataIndex: 'customers', key: 'customers', width: 160, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
  ], []);

  /* ========== 订单管理表格列定义 ========== */
  const orderProductColumns = useMemo(() => [
    { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 150,
      render: (v: string) => <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 130 },
    { title: '商品名称', dataIndex: 'productName', key: 'productName', width: 160, ellipsis: true },
    { title: '颜色', dataIndex: 'color', key: 'color', width: 80 },
    { title: '规格', dataIndex: 'spec', key: 'spec', width: 80 },
    { title: '订单数量', dataIndex: 'salesQty', key: 'salesQty', width: 100, align: 'right' as const,
      sorter: (a: ProductAggRow, b: ProductAggRow) => a.salesQty - b.salesQty,
      render: (v: number) => <Text strong style={{ color: '#f5222d', fontSize: 14 }}>{v.toLocaleString()}</Text> },
    { title: '涉及订单数', dataIndex: 'orderCount', key: 'orderCount', width: 100, align: 'right' as const },
    { title: '涉及店铺', dataIndex: 'shops', key: 'shops', width: 140, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
    { title: '涉及客户', dataIndex: 'customers', key: 'customers', width: 140, ellipsis: true,
      render: (v: string) => {
        const list = v.split(',').filter(Boolean);
        return list.length <= 2 ? v : <Tooltip title={v}>{list.slice(0, 2).join(', ')} <Tag>+{list.length - 2}</Tag></Tooltip>;
      } },
  ], []);

  /* ========== 字段显示控制派生 ========== */
  const allFieldItems: FieldConfigItem[] = useMemo(() => {
    const cols = dataSource === 'order' ? orderProductColumns : productColumns;
    return cols.map(c => ({ key: c.key, label: c.title as string }));
  }, [productColumns, orderProductColumns, dataSource]);

  const visibleProductColumns = useMemo(() => {
    const cols = dataSource === 'order' ? orderProductColumns : productColumns;
    const order = fieldOrder.length > 0 ? fieldOrder : cols.map(c => c.key);
    const vis = fieldVis;
    const ordered = [
      ...order.filter(k => cols.some(c => c.key === k) && vis[k] !== false),
      ...cols.filter(c => !order.includes(c.key) && vis[c.key] !== false).map(c => c.key),
    ];
    return ordered.map(k => cols.find(c => c.key === k)).filter(Boolean) as typeof productColumns;
  }, [productColumns, orderProductColumns, fieldOrder, fieldVis, dataSource]);

  const visibleCustomerColumns = useMemo(() => {
    const vis = fieldVis;
    return customerColumns.filter(c => vis[c.key] !== false);
  }, [customerColumns, fieldVis]);

  const visibleShopColumns = useMemo(() => {
    const vis = fieldVis;
    return shopColumns.filter(c => vis[c.key] !== false);
  }, [shopColumns, fieldVis]);

  /* ========== 汇总行渲染 ========== */
  const renderProductSummary = useCallback((pageData: readonly ProductAggRow[]) => {
    const totalSales = pageData.reduce((s, r) => s + r.salesQty, 0);
    const totalShipped = pageData.reduce((s, r) => s + r.shippedQty, 0);
    const totalOutbound = pageData.reduce((s, r) => s + r.outboundCount, 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 600 }}>
          <Table.Summary.Cell index={0} colSpan={5}>合计（{pageData.length} 款）</Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: '#f5222d' }}>{totalSales.toLocaleString()}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={6} align="right">{totalShipped.toLocaleString()}</Table.Summary.Cell>
          <Table.Summary.Cell index={7} align="right">{totalOutbound.toLocaleString()}</Table.Summary.Cell>
          <Table.Summary.Cell index={8}>—</Table.Summary.Cell>
          <Table.Summary.Cell index={9}>—</Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, []);

  const renderCustomerSummary = useCallback((pageData: readonly CustomerAggRow[]) => {
    const totalOrders = pageData.reduce((s, r) => s + r.orderCount, 0);
    const totalQty = pageData.reduce((s, r) => s + r.totalQty, 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>合计（{pageData.length} 客户）</Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">{totalOrders}</Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: '#f5222d' }}>{totalQty.toLocaleString()}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={3}>—</Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, []);

  const renderShopSummary = useCallback((pageData: readonly ShopAggRow[]) => {
    const totalOrders = pageData.reduce((s, r) => s + r.orderCount, 0);
    const totalQty = pageData.reduce((s, r) => s + r.totalQty, 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>合计（{pageData.length} 店铺）</Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">{totalOrders}</Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: '#f5222d' }}>{totalQty.toLocaleString()}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={3}>—</Table.Summary.Cell>
          <Table.Summary.Cell index={4}>—</Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, []);

  const renderOrderProductSummary = useCallback((pageData: readonly ProductAggRow[]) => {
    const totalSales = pageData.reduce((s, r) => s + r.salesQty, 0);
    const totalOrderCount = pageData.reduce((s, r) => s + r.orderCount, 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 600 }}>
          <Table.Summary.Cell index={0} colSpan={5}>合计（{pageData.length} 款）</Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: '#f5222d' }}>{totalSales.toLocaleString()}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={6} align="right">{totalOrderCount}</Table.Summary.Cell>
          <Table.Summary.Cell index={7}>—</Table.Summary.Cell>
          <Table.Summary.Cell index={8}>—</Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, []);

  /* ========== 款式编码统计汇总行 ========== */
  const renderStyleCodeSummary = useCallback((pageData: readonly StyleCodeAggRow[]) => {
    const totalQty = pageData.reduce((s, r) => s + r.totalQty, 0);
    const totalShipped = pageData.reduce((s, r) => s + r.shippedQty, 0);
    const totalProducts = pageData.reduce((s, r) => s + r.productCount, 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>合计（{pageData.length} 款）</Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">{totalProducts}</Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: '#f5222d' }}>{totalQty.toLocaleString()}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right">{totalShipped.toLocaleString()}</Table.Summary.Cell>
          <Table.Summary.Cell index={4}>—</Table.Summary.Cell>
          <Table.Summary.Cell index={5}>—</Table.Summary.Cell>
          <Table.Summary.Cell index={6}>—</Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, []);

  const renderOrderStyleCodeSummary = useCallback((pageData: readonly StyleCodeAggRow[]) => {
    const totalQty = pageData.reduce((s, r) => s + r.totalQty, 0);
    const totalOrders = pageData.reduce((s, r) => s + r.orderCount, 0);
    const totalProducts = pageData.reduce((s, r) => s + r.productCount, 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#f0f5ff', fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>合计（{pageData.length} 款）</Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">{totalProducts}</Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="right"><Text strong style={{ color: '#f5222d' }}>{totalQty.toLocaleString()}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right">{totalOrders}</Table.Summary.Cell>
          <Table.Summary.Cell index={4}>—</Table.Summary.Cell>
          <Table.Summary.Cell index={5}>—</Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  }, []);

  /* ========== 筛选面板 ========== */
  const filterPanel = (
    <div style={{ width: 260, flexShrink: 0, background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e8e8e8', overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text strong style={{ fontSize: 14, color: PRIMARY }}><FilterOutlined /> 筛选条件</Text>
        <Button type="link" size="small" onClick={handleReset} icon={<ReloadOutlined />}>重置</Button>
      </div>

      {/* 数据源切换 */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 4 }}>
        <Button
          type={dataSource === 'outbound' ? 'primary' : 'default'}
          size="small"
          icon={<ExportOutlined />}
          onClick={() => { setDataSource('outbound'); setActiveTab('product'); }}
          style={{ flex: 1, fontSize: 12 }}
        >销售出库</Button>
        <Button
          type={dataSource === 'order' ? 'primary' : 'default'}
          size="small"
          icon={<FileTextOutlined />}
          onClick={() => { setDataSource('order'); setActiveTab('product'); }}
          style={{ flex: 1, fontSize: 12 }}
        >订单管理</Button>
      </div>

      {/* 发货时间/付款时间 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4, fontWeight: 600 }}>{dataSource === 'order' ? '付款时间' : '发货时间'}</div>
        <RangePicker
          value={dateRange}
          onChange={(dates) => { if (dates && dates[0] && dates[1]) setDateRange([dates[0], dates[1]]); }}
          style={{ width: '100%' }}
          format="YYYY-MM-DD"
          size="small"
        />
      </div>

      {/* 商品信息 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4, fontWeight: 600 }}>款式编码</div>
        <div style={{ position: 'relative' }}>
          <Input
            readOnly
            placeholder="点击选择款式编码"
            value={filterStyleCode}
            onClick={() => {
              setSelectedStyleCodes(filterStyleCode ? filterStyleCode.split(',').filter(Boolean) : []);
              setStyleCodeSearch('');
              setStyleCodeModalVisible(true);
            }}
            size="small"
            allowClear
            prefix={<AppstoreAddOutlined style={{ color: PRIMARY, cursor: 'pointer' }} />}
            suffix={filterStyleCode ? <ReloadOutlined style={{ color: '#bbb', fontSize: 11, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setFilterStyleCode(''); setSelectedStyleCodes([]); }} /> : null}
            style={{ cursor: 'pointer', marginBottom: 6 }}
          />
          {filterStyleCode && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 2 }}>
              {filterStyleCode.split(',').filter(Boolean).map(code => (
                <Tag key={code} color="blue" style={{ margin: 0, fontSize: 11 }} closable onClose={() => {
                  const next = filterStyleCode.split(',').filter(Boolean).filter(c => c !== code);
                  setFilterStyleCode(next.join(','));
                  setSelectedStyleCodes(next);
                }}>{code}</Tag>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4, marginTop: 8, fontWeight: 600 }}>商品编码</div>
        <div style={{ position: 'relative' }}>
          <Input
            readOnly
            placeholder="点击选择商品编码"
            value={filterProductCode}
            onClick={() => {
              setSelectedProductCodes(filterProductCode ? filterProductCode.split(',').filter(Boolean) : []);
              setProductCodeSearch('');
              setProductCodeModalVisible(true);
            }}
            size="small"
            allowClear
            prefix={<AppstoreAddOutlined style={{ color: PRIMARY, cursor: 'pointer' }} />}
            suffix={filterProductCode ? <ReloadOutlined style={{ color: '#bbb', fontSize: 11, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setFilterProductCode(''); setSelectedProductCodes([]); }} /> : null}
            style={{ cursor: 'pointer', marginBottom: 6 }}
          />
          {filterProductCode && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 2 }}>
              {filterProductCode.split(',').filter(Boolean).map(code => (
                <Tag key={code} color="cyan" style={{ margin: 0, fontSize: 11 }} closable onClose={() => {
                  const next = filterProductCode.split(',').filter(Boolean).filter(c => c !== code);
                  setFilterProductCode(next.join(','));
                  setSelectedProductCodes(next);
                }}>{code}</Tag>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4, fontWeight: 600 }}>商品名称</div>
        <Input
          placeholder="包含商品名称"
          value={filterProductName}
          onChange={e => setFilterProductName(e.target.value)}
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        />
      </div>

      {/* 店铺 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4, fontWeight: 600 }}>店铺</div>
        <Select
          placeholder="全部店铺"
          value={filterShop || undefined}
          onChange={v => setFilterShop(v || '')}
          allowClear
          size="small"
          style={{ width: '100%' }}
          options={shopOptions}
        />
      </div>

      {/* 客户 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4, fontWeight: 600 }}>客户名称</div>
        <Input
          placeholder="搜索客户名称"
          value={filterCustomer}
          onChange={e => setFilterCustomer(e.target.value)}
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        />
      </div>

      {/* 组合商品拆分 */}
      <div style={{ marginBottom: 16, padding: '8px 10px', background: '#f6f8fa', borderRadius: 6 }}>
        <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 6, fontWeight: 600 }}>组合商品拆分</div>
        <Checkbox checked={splitCombo} onChange={e => setSplitCombo(e.target.checked)}>
          <span style={{ fontSize: 12 }}>拆分商品明细统计</span>
        </Checkbox>
      </div>

      {/* 查询按钮 */}
      <Button type="primary" icon={<SearchOutlined />} block onClick={refresh} style={{ marginTop: 8 }}>
        查询
      </Button>
    </div>
  );

  /* ========== 汇总卡片 ========== */
  const isOrderMode = dataSource === 'order';
  const summaryCards = (
    <Row gutter={12} style={{ marginBottom: 16 }}>
      <Col xs={6}>
        <Card size="small" bodyStyle={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>涉及款式</span>
            <Text strong style={{ color: '#722ed1', fontSize: 18 }}>{summary.totalProducts.toLocaleString()}</Text>
          </div>
        </Card>
      </Col>
      <Col xs={6}>
        <Card size="small" bodyStyle={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{isOrderMode ? '订单总数' : '出库单数'}</span>
            <Text strong style={{ color: '#1890ff', fontSize: 18 }}>{summary.totalOrders.toLocaleString()}</Text>
          </div>
        </Card>
      </Col>
      <Col xs={6}>
        <Card size="small" bodyStyle={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{isOrderMode ? '订货数量' : '销售数量'}</span>
            <Text strong style={{ color: '#f5222d', fontSize: 18 }}>{summary.totalSalesQty.toLocaleString()}</Text>
          </div>
        </Card>
      </Col>
      <Col xs={6}>
        <Card size="small" bodyStyle={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{isOrderMode ? '订货数量' : '实发数量'}</span>
            <Text strong style={{ color: '#52c41a', fontSize: 18 }}>{summary.totalSalesQty.toLocaleString()}</Text>
          </div>
        </Card>
      </Col>
    </Row>
  );

  /* ========== 页签内容 ========== */
  const curProductAgg = isOrderMode ? orderProductAggData : productAggData;
  const curCustomerAgg = isOrderMode ? orderCustomerAggData : customerAggData;
  const curShopAgg = isOrderMode ? orderShopAggData : shopAggData;
  const curStyleCodeAgg = isOrderMode ? orderStyleCodeAggData : styleCodeAggData;
  const curStyleCodeColumns = isOrderMode ? orderStyleCodeColumns : styleCodeColumns;
  const curStyleCodeSummary = isOrderMode ? renderOrderStyleCodeSummary : renderStyleCodeSummary;

  const tabItems = [
    {
      key: 'product',
      label: <span><AppstoreOutlined /> 商品统计</span>,
      children: (
        <div>
          {isOrderMode && (
            <div style={{ padding: '6px 12px', background: '#f6ffed', borderRadius: 6, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
              <Text strong style={{ color: '#389e0d' }}>订单总数：{orderSummary.totalOrders}</Text>
              <Text strong style={{ color: '#f5222d' }}>涉及商品：{orderSummary.totalProducts}</Text>
              <Text strong style={{ color: PRIMARY }}>订货总量：{orderSummary.totalQty.toLocaleString()}</Text>
              <Tag color="green">已排除已取消订单</Tag>
            </div>
          )}
          <Table
            bordered size="small"
            dataSource={curProductAgg}
            columns={visibleProductColumns}
            rowKey="key"
            scroll={{ x: 1300, y: scrollY }}
            pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: t => `共 ${t} 条` }}
            summary={isOrderMode ? renderOrderProductSummary : renderProductSummary}
            locale={{ emptyText: <Empty description="暂无数据，请调整筛选条件" /> }}
          />
        </div>
      ),
    },
    {
      key: 'styleCode',
      label: <span><FileTextOutlined /> 款式编码统计</span>,
      children: (
        <Table
          bordered size="small"
          dataSource={curStyleCodeAgg}
          columns={curStyleCodeColumns}
          rowKey="key"
          scroll={{ x: 1000, y: scrollY }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: t => `共 ${t} 条` }}
          summary={curStyleCodeSummary}
          locale={{ emptyText: <Empty description="暂无数据，请调整筛选条件" /> }}
        />
      ),
    },
    {
      key: 'customer',
      label: <span><UserOutlined /> 客户统计</span>,
      children: (
        <Table
          bordered size="small"
          dataSource={curCustomerAgg}
          columns={visibleCustomerColumns}
          rowKey="key"
          scroll={{ x: 800, y: scrollY }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: t => `共 ${t} 条` }}
          summary={renderCustomerSummary}
          locale={{ emptyText: <Empty description="暂无数据，请调整筛选条件" /> }}
        />
      ),
    },
    {
      key: 'shop',
      label: <span><ShopOutlined /> 店铺统计</span>,
      children: (
        <Table
          bordered size="small"
          dataSource={curShopAgg}
          columns={visibleShopColumns}
          rowKey="key"
          scroll={{ x: 800, y: scrollY }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: t => `共 ${t} 条` }}
          summary={renderShopSummary}
          locale={{ emptyText: <Empty description="暂无数据，请调整筛选条件" /> }}
        />
      ),
    },
  ];

  /* ========== 主渲染 ========== */
  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 'calc(100vh - 140px)' }}>
      {/* 左侧筛选面板 */}
      {filterPanel}

      {/* 右侧数据区 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 顶部操作栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ fontSize: 16, color: PRIMARY }}>{isOrderMode ? '订单管理统计' : '销售出库统计'}</Text>
            <Tag color="blue">{dateRange[0].format('YYYY-MM-DD')} ~ {dateRange[1].format('YYYY-MM-DD')}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>数据更新：{dayjs().format('YYYY-MM-DD')}</Text>
          </div>
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
            <Dropdown menu={{
              items: isOrderMode ? [
                { key: 'order-product', label: '导出商品统计', icon: <ExportOutlined /> },
                { key: 'order-styleCode', label: '导出款式编码统计', icon: <ExportOutlined /> },
                { key: 'order-customer', label: '导出客户统计', icon: <ExportOutlined /> },
                { key: 'order-shop', label: '导出店铺统计', icon: <ExportOutlined /> },
              ] : [
                { key: 'product', label: '导出商品统计', icon: <ExportOutlined /> },
                { key: 'styleCode', label: '导出款式编码统计', icon: <ExportOutlined /> },
                { key: 'customer', label: '导出客户统计', icon: <ExportOutlined /> },
                { key: 'shop', label: '导出店铺统计', icon: <ExportOutlined /> },
              ],
              onClick: ({ key }) => handleExport(key),
            }}>
              <Button size="small" icon={<ExportOutlined />}>导出EXCEL <DownOutlined /></Button>
            </Dropdown>
            <Button size="small" icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示字段</Button>
          </Space>
        </div>

        {/* 汇总卡片 */}
        {summaryCards}

        {/* 页签 + 表格 */}
        <Card bodyStyle={{ padding: '0 16px 16px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} style={{ flex: 1, minHeight: 0 }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          />
        </Card>
      </div>

      {/* 款式编码选择弹窗 */}
      <Modal
        title="选择款式编码"
        open={styleCodeModalVisible}
        onCancel={() => setStyleCodeModalVisible(false)}
        onOk={() => {
          setFilterStyleCode(selectedStyleCodes.join(','));
          setStyleCodeModalVisible(false);
        }}
        width={560}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          placeholder="搜索款式编码/商品名称/商品编码"
          value={styleCodeSearch}
          onChange={e => setStyleCodeSearch(e.target.value)}
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          style={{ marginBottom: 12 }}
        />
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <Table
            bordered size="small"
            dataSource={filteredStyleCodes}
            rowKey="styleCode"
            pagination={false}
            scroll={{ y: 360 }}
            rowSelection={{
              selectedRowKeys: selectedStyleCodes,
              onChange: (keys) => {
                const visibleKeys = new Set(filteredStyleCodes.map(r => r.styleCode));
                const preserved = selectedStyleCodes.filter(k => !visibleKeys.has(k));
                setSelectedStyleCodes([...preserved, ...(keys as string[])]);
              },
            }}
            columns={[
              {
                title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 140,
                render: (v: string) => <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{v}</Text>,
              },
              {
                title: '商品名称', dataIndex: 'shortNames', key: 'shortNames', width: 180, ellipsis: true,
                render: (v: string[]) => v.join(', ') || '—',
              },
              {
                title: '关联商品数', dataIndex: 'products', key: 'count', width: 90, align: 'center' as const,
                render: (v: string[]) => <Tag color="blue">{v.length}</Tag>,
              },
            ]}
            locale={{ emptyText: <Empty description="无匹配的款式编码" /> }}
          />
        </div>
        {selectedStyleCodes.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>已选：</Text>
            {selectedStyleCodes.map(code => (
              <Tag key={code} color="blue" closable onClose={() => setSelectedStyleCodes(prev => prev.filter(c => c !== code))}>
                {code}
              </Tag>
            ))}
          </div>
        )}
      </Modal>

      {/* 商品编码选择弹窗 */}
      <Modal
        title="选择商品编码"
        open={productCodeModalVisible}
        onCancel={() => setProductCodeModalVisible(false)}
        onOk={() => {
          setFilterProductCode(selectedProductCodes.join(','));
          setProductCodeModalVisible(false);
        }}
        width={560}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          placeholder="搜索商品编码/款式编码/商品名称"
          value={productCodeSearch}
          onChange={e => setProductCodeSearch(e.target.value)}
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          style={{ marginBottom: 12 }}
        />
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <Table
            bordered size="small"
            dataSource={filteredProductCodes}
            rowKey="productCode"
            pagination={false}
            scroll={{ y: 360 }}
            rowSelection={{
              selectedRowKeys: selectedProductCodes,
              onChange: (keys) => {
                const visibleKeys = new Set(filteredProductCodes.map(r => r.productCode));
                const preserved = selectedProductCodes.filter(k => !visibleKeys.has(k));
                setSelectedProductCodes([...preserved, ...(keys as string[])]);
              },
            }}
            columns={[
              {
                title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 160,
                render: (v: string) => <Text strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{v}</Text>,
              },
              {
                title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 120,
              },
              {
                title: '商品名称', dataIndex: 'shortName', key: 'shortName', width: 180, ellipsis: true,
                render: (v: string) => v || '—',
              },
            ]}
            locale={{ emptyText: <Empty description="无匹配的商品编码" /> }}
          />
        </div>
        {selectedProductCodes.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>已选：</Text>
            {selectedProductCodes.map(code => (
              <Tag key={code} color="cyan" closable onClose={() => setSelectedProductCodes(prev => prev.filter(c => c !== code))}>
                {code}
              </Tag>
            ))}
          </div>
        )}
      </Modal>

      {/* 字段显示设置弹窗 */}
      <FieldConfigModal
        open={fieldCfgVisible}
        fields={allFieldItems}
        order={fieldOrder}
        visibility={fieldVis}
        onSave={(order, vis) => {
          setFieldOrder(order);
          setFieldVis(vis);
          try { localStorage.setItem(`sos_fieldOrder_${owner}`, JSON.stringify(order)); } catch { /* ignore */ }
          try { localStorage.setItem(`sos_fieldVis_${owner}`, JSON.stringify(vis)); } catch { /* ignore */ }
          setFieldCfgVisible(false);
        }}
        onCancel={() => setFieldCfgVisible(false)}
      />
    </div>
  );
};

export default SalesOutboundStatsPage;
