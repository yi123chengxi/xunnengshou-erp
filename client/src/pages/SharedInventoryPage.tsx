import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Spin, Tag, Row, Col, Empty, Drawer, Button, InputNumber, Modal, Form, Input, Select, message, Avatar, Divider, Popconfirm, Descriptions, Table, Space, Typography,
} from 'antd';
const { Text, Paragraph } = Typography;
import { ShopOutlined, ShoppingCartOutlined, LoginOutlined, LogoutOutlined, DeleteOutlined, ShareAltOutlined, CopyOutlined, PlusOutlined, MinusOutlined, UserOutlined, EnvironmentOutlined, PhoneOutlined, FileExcelOutlined, MessageOutlined } from '@ant-design/icons';
import { loadDataset, saveDataset } from '../utils/dataStore';
import { pullAllDatasets } from '../utils/serverSync';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import { connectChatWS, setGuestIdentity, sendMessage, onNewMessage, fetchHistory, httpMarkRead } from '../utils/chatSocket';

const PRIMARY = '#1e4a7e';
const SHARED_INVENTORY_KEY = 'market_shared_inventories';
const MARKET_KEY = 'market_publish_orders';  // 成品市场数据
const VISITOR_CART_KEY = 'market_visitor_cart';           // 访客购物车（按 shareCode 维度）
const CART_SHARES_KEY = 'market_visitor_cart_shares';      // 购物车分享记录
const TRADE_ORDERS_KEY = 'market_trade_orders';            // 成品市场成交订单

const safeJson = (k: string, d: any) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; }
};
const writeJson = (k: string, v: any) => {
  try { const j = JSON.stringify(v); localStorage.setItem(k, j); saveDataset(k, j); } catch { /* ignore */ }
};

/** localStorage 与 IndexedDB 按时间戳取较新者读取货盘数据 */
const loadSharedInventoriesLatest = async (): Promise<any[]> => {
  const key = SHARED_INVENTORY_KEY;
  let lsList: any[] = [];
  let lsTs = 0;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      lsTs = Number(localStorage.getItem(`${key}_ts`) || 0) || 1;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) lsList = parsed;
    }
  } catch { /* ignore */ }
  let chosen = lsList;
  try {
    const idb = await loadDataset(key);
    if (idb && idb.updatedAt > lsTs) {
      const parsed = JSON.parse(idb.json);
      if (Array.isArray(parsed)) chosen = parsed;
    }
  } catch { /* ignore */ }
  return chosen;
};

const imgOfVisitor = (p: any): string => {
  if (p.image) return String(p.image);
  try { return localStorage.getItem(`prodImg_${p.publisherUsername}_${p && p.key}`) || ''; } catch { return ''; }
};

/** 尺码范围格式化：连续整数段（如 35,36,37,38,39,40）显示为 35-40；非连续或含非数字则逗号拼接 */
const fmtSizeRange = (specs: string[]): string => {
  const cleaned = specs.map(s => String(s).trim()).filter(Boolean);
  if (cleaned.length === 0) return '—';
  const nums = cleaned.map(s => Number(s));
  if (nums.every(n => Number.isFinite(n))) {
    const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
    const consecutive = uniq.every((n, i) => i === 0 || n === uniq[i - 1] + 1);
    if (uniq.length > 1 && consecutive) return `${uniq[0]}-${uniq[uniq.length - 1]}`;
    return uniq.join(',');
  }
  return Array.from(new Set(cleaned)).join(',');
};

/** 分享链接 supplier 参数解析：参数为公司编号（companyNo/companyShortName），反查注册账号；兼容旧链接直接传账号 */
const resolveSupplierUsername = (param: string): string => {
  const p = String(param || '').trim();
  if (!p) return '';
  try {
    const users = safeJson('registeredUsers', []);
    if (!Array.isArray(users)) return p;
    const byNo = users.find((u: any) => (u.companyNo || u.companyShortName) === p);
    if (byNo) return byNo.username;
    const byName = users.find((u: any) => u.username === p);
    return byName ? byName.username : p;
  } catch { return p; }
};

const genCartShareCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'CART-';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
};

const genPoCode = () => {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `PO-MKT-${n}`;
};

interface CartItem {
  key: string;
  styleCode: string;
  shortName: string;
  productKey?: string;
  publisherUsername: string;
  publisherCompany: string;
  unit: string;
  price: number;
  qty: number;
  image: string;
  supplierName: string;
  color?: string;  // 颜色
  spec?: string;   // 规格/尺码
  productCode?: string;  // SKU编码
}

interface VisitorCart {
  shareCode: string;
  items: CartItem[];
  updatedAt: number;
}

const loadCart = (shareCode: string): VisitorCart => {
  const all = safeJson(VISITOR_CART_KEY, {});
  return all[shareCode] || { shareCode, items: [], updatedAt: 0 };
};
const saveCart = (cart: VisitorCart) => {
  const all = safeJson(VISITOR_CART_KEY, {});
  all[cart.shareCode] = { ...cart, updatedAt: Date.now() };
  writeJson(VISITOR_CART_KEY, all);
};

/**
 * 货盘公开分享页（独立网站页，无需登录）：
 * 供应商在商机市场「我的货盘」创建货盘并分享链接，采购商/任何访客打开链接即可查看货盘商品。
 * 访客/采购商可选商品加入购物车、分享购物车给供应商；登录后可生成订单。
 */
const SharedInventoryPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [inv, setInv] = useState<any>(null);
  const [market, setMarket] = useState<any[]>([]);  // 成品市场数据
  // 公司表头：供应商注册信息（微信二维码/地址/联系方式）与店铺横幅背景图
  const [supplierProfile, setSupplierProfile] = useState<any>(null);
  const [bannerImg, setBannerImg] = useState<string>('');

  // 登录态
  const [username, setUsername] = useState<string>(() => localStorage.getItem('username') || '');
  const [companyName, setCompanyName] = useState<string>(() => localStorage.getItem('companyName') || '');
  const refreshLogin = () => {
    setUsername(localStorage.getItem('username') || '');
    setCompanyName(localStorage.getItem('companyName') || '');
  };
  useEffect(() => {
    const onStorage = () => refreshLogin();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 购物车
  const shareCodeParam = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('code') || ''; } catch { return ''; }
  }, []);
  // 全量分享模式：?supplier=<公司编号> 打开时展示该供应商货盘中的全部商品（参数反查注册账号，不暴露账号）
  const supplierParam = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('supplier') || ''; } catch { return ''; }
  }, []);
  const supplierUser = useMemo(() => resolveSupplierUsername(supplierParam), [supplierParam]);
  const [cart, setCart] = useState<VisitorCart>(() => loadCart(shareCodeParam || (supplierUser ? `ALL-${supplierUser}` : '')));
  useEffect(() => { setCart(loadCart(shareCodeParam || (supplierUser ? `ALL-${supplierUser}` : ''))); }, [shareCodeParam, supplierUser]);
  const persistCart = (next: VisitorCart) => { saveCart(next); setCart(next); };

  const cartCount = cart.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const cartTotal = cart.items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await pullAllDatasets(); } catch { /* ignore */ }
      const code = shareCodeParam;
      const lists = await loadSharedInventoriesLatest();
      let found = code ? (lists || []).find((s: any) => s.shareCode === code.trim()) : null;
      // 加载成品市场数据
      let marketData: any[] = [];
      try {
        const raw = safeJson(MARKET_KEY, []);
        marketData = Array.isArray(raw) ? raw : [];
        if (!cancelled) setMarket(marketData);
      } catch { /* ignore */ }
      // 全量分享模式：无分享码且带 supplier 参数时，展示该供应商在成品市场的全部在售商品
      if (!found && supplierUser) {
        const sup = supplierUser;
        const prods = marketData.filter((r: any) => r.type === 'finished' && r.publisherUsername === sup);
        const products = prods.map((p: any) => ({
          ...p,
          image: p.image || (p.productKey ? localStorage.getItem(`prodImg_${sup}_${p.productKey}`) || '' : ''),
          supplierName: p.publisherCompany || p.supplierName || '',
        }));
        found = {
          id: '__all__', name: '全部商品', shareCode: `ALL-${sup}`,
          supplierUsername: sup, supplierName: prods[0]?.publisherCompany || '', products, isAllShare: true,
        };
      }
      // 加载货盘供应商的产品列表数据（用于详情弹窗的 SKU 变体）
      if (found && found.supplierUsername) {
        try {
          const productListKey = `pageData_basic-data_product-list_${found.supplierUsername}`;
          const productList = safeJson(productListKey, []);
          // 存储到全局变量供 openDetail 使用
          (window as any).__sharedInventoryProductList = productList;
        } catch { /* ignore */ }
        // 加载供应商公司注册信息（微信二维码/地址/联系方式，未完善字段不显示）
        try {
          const users = safeJson('registeredUsers', []);
          const u = Array.isArray(users) ? users.find((x: any) => x.username === found.supplierUsername) : null;
          if (!cancelled) setSupplierProfile(u || null);
        } catch { if (!cancelled) setSupplierProfile(null); }
        // 加载店铺横幅背景图（供应商在我的货盘上传，未上传时用系统默认背景）
        try {
          const bkey = `inventoryBanner_${found.supplierUsername}`;
          let b = localStorage.getItem(bkey) || '';
          if (!b) {
            const idb = await loadDataset(bkey);
            if (idb && idb.json) {
              try { const parsed = JSON.parse(idb.json); b = typeof parsed === 'string' ? parsed : ''; } catch { b = ''; }
            }
          }
          if (!cancelled) setBannerImg(b);
        } catch { if (!cancelled) setBannerImg(''); }
      } else if (!cancelled) {
        setSupplierProfile(null);
        setBannerImg('');
      }
      if (!cancelled) { setInv(found || null); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [shareCodeParam, supplierUser]);

  // 购物车抽屉
  const [cartOpen, setCartOpen] = useState(false);
  const [qtyModalOpen, setQtyModalOpen] = useState(false);
  const [qtyModalProduct, setQtyModalProduct] = useState<any>(null);
  const [qtyModalValue, setQtyModalValue] = useState<number>(1);

  // 产品详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<any>(null);
  const [detailVariants, setDetailVariants] = useState<any[]>([]);
  const [detailColor, setDetailColor] = useState<string>('');
  const [detailImg, setDetailImg] = useState<string>('');
  const [skuQty, setSkuQty] = useState<Record<string, number>>({});

  const openDetail = (p: any) => {
    setDetailProduct(p);
    setDetailColor('');
    setSkuQty({});
    // 从预加载的产品列表中查找变体（按 styleCode 匹配）
    try {
      const prods: any[] = (window as any).__sharedInventoryProductList || [];
      const vars = prods.filter(prod => prod.styleCode === p.styleCode);
      setDetailVariants(vars);
    } catch { /* ignore */ }
    // 设置主图
    setDetailImg(imgOfVisitor(p));
    setDetailOpen(true);
  };

  // 详情弹窗中确认加入购物车（处理SKU表格输入的数量）
  const handleConfirmAddSkusToCart = () => {
    const entries = Object.entries(skuQty).filter(([, q]) => (Number(q) || 0) > 0);
    if (!entries.length) {
      message.warning('请先在规格明细中输入采购数量');
      return;
    }
    // 构建新的购物车项列表
    const newItems: CartItem[] = [];
    entries.forEach(([variantKey, qty]) => {
      const v = detailVariants.find(x => x.key === variantKey);
      if (!v) return;
      const ci: CartItem = {
        key: `${detailProduct.key}_${v.productCode}`,
        styleCode: detailProduct.styleCode || '',
        shortName: detailProduct.shortName || '',
        productKey: v.productKey || detailProduct.productKey,
        publisherUsername: detailProduct.publisherUsername || '',
        publisherCompany: detailProduct.publisherCompany || '',
        unit: detailProduct.unit || '件',
        price: Number(v.suggestedPrice ?? detailProduct.targetPrice ?? detailProduct.price) || 0,
        qty: Number(qty) || 0,
        image: imgOfVisitor({ ...v, publisherUsername: detailProduct.publisherUsername, productKey: v.productKey || detailProduct.productKey }),
        supplierName: detailProduct.supplierName || detailProduct.publisherCompany || '',
        color: v.color || '',
        spec: v.spec || '',
        productCode: v.productCode || '',
      };
      newItems.push(ci);
    });
    // 一次性合并到购物车
    const next: VisitorCart = { ...cart, items: [...cart.items] };
    newItems.forEach(ci => {
      const existing = next.items.findIndex(i => i.key === ci.key);
      if (existing >= 0) {
        next.items[existing] = { ...next.items[existing], qty: next.items[existing].qty + ci.qty };
      } else {
        next.items.push(ci);
      }
    });
    persistCart(next);
    message.success(`已加入购物车：共 ${entries.length} 个规格`);
    setDetailOpen(false);
    setSkuQty({});
  };

  // 加入购物车
  const openAddQty = (p: any) => {
    setQtyModalProduct(p);
    setQtyModalValue(1);
    setQtyModalOpen(true);
  };
  const confirmAdd = () => {
    const p = qtyModalProduct;
    if (!p) return;
    const qty = Number(qtyModalValue) || 1;
    if (qty <= 0) { message.warning('请输入正确的数量'); return; }
    const ci: CartItem = {
      key: p.key, styleCode: p.styleCode || '', shortName: p.shortName || '',
      productKey: p.productKey, publisherUsername: p.publisherUsername || '',
      publisherCompany: p.publisherCompany || '', unit: p.unit || '件',
      price: Number(p.targetPrice ?? p.price) || 0, qty,
      image: imgOfVisitor(p),
      supplierName: p.supplierName || p.publisherCompany || '',
    };
    const existing = cart.items.findIndex(i => i.key === ci.key);
    const next: VisitorCart = { ...cart, items: [...cart.items] };
    if (existing >= 0) next.items[existing] = { ...next.items[existing], qty: next.items[existing].qty + qty };
    else next.items.push(ci);
    persistCart(next);
    message.success(`已加入购物车：${ci.shortName} × ${qty}`);
    setQtyModalOpen(false);
  };

  const updateQty = (key: string, qty: number) => {
    const items = cart.items.map(i => i.key === key ? { ...i, qty: Math.max(1, Number(qty) || 1) } : i);
    persistCart({ ...cart, items });
  };
  const removeItem = (key: string) => {
    persistCart({ ...cart, items: cart.items.filter(i => i.key !== key) });
  };

  // 结算
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutForm] = Form.useForm();
  const openCheckout = () => {
    if (!username) { message.warning('请先登录账号后再结算'); return; }
    if (cart.items.length === 0) { message.warning('购物车为空'); return; }
    // 预填地址
    try {
      const u = JSON.parse(localStorage.getItem(`userInfo_${username}`) || localStorage.getItem(`registeredUsers`) || '[]');
      const me = Array.isArray(u) ? u.find((x: any) => x.username === username) : u;
      if (me) checkoutForm.setFieldsValue({
        contactPerson: me.contactPerson || '',
        phone: me.phone || '',
        province: me.province,
        city: me.city,
        district: me.district,
        addressDetail: me.addressDetail || '',
        remark: '',
      });
    } catch { /* ignore */ }
    setCheckoutOpen(true);
  };

  const submitOrder = async () => {
    const v = await checkoutForm.validateFields().catch(() => null);
    if (!v) return;
    const poCode = genPoCode();
    const address = [v.province, v.city, v.district, v.addressDetail].filter(Boolean).join(' ');
    const order = {
      id: poCode,
      key: poCode,
      orderCode: poCode,
      orderSource: '货盘分享',
      purchaserUsername: username,
      purchaserCompany: companyName || username,
      supplierUsername: inv?.supplierUsername || cart.items[0]?.publisherUsername,
      supplierCompany: inv?.supplierName || cart.items[0]?.publisherCompany,
      items: cart.items.map(i => ({ ...i })),
      totalAmount: cartTotal,
      address, contactPerson: v.contactPerson, phone: v.phone, remark: v.remark,
      buyerMessage: v.remark || '货盘分享下单',
      shareCode: inv?.shareCode || '',
      status: '待确认', createdAt: new Date().toISOString(),
    };
    // 写入全局订单
    const trades = safeJson(TRADE_ORDERS_KEY, []);
    trades.unshift(order);
    writeJson(TRADE_ORDERS_KEY, trades);
    // 写入供应商侧订单（pageData_sales_order-manage_<owner>）
    try {
      const supplierOwner = order.supplierUsername;
      if (supplierOwner) {
        const orderKey = `pageData_sales_order-manage_${supplierOwner}`;
        const list = safeJson(orderKey, []);
        // 货品明细唯一读取源：同步写 orderItems（JSON 字符串）与 productDetail 摘要，避免订单详情无商品
        list.unshift({
          ...order, key: poCode,
          orderStatus: order.status || '待确认',
          orderItems: JSON.stringify((order.items || []).map((it: any) => ({
            productCode: it.productCode || it.styleCode || '', shortName: it.shortName || it.productName || '', styleCode: it.styleCode || '',
            color: it.color || '', spec: it.spec || '', quantity: Number(it.quantity ?? it.qty) || 0,
            price: Number(it.unitPrice ?? it.price) || 0, amount: Number(it.subtotal ?? it.amount) || 0, image: it.image || '',
          }))),
          productDetail: (order.items || []).map((it: any) => `${it.shortName || it.productName || ''}${it.color ? '-' + it.color : ''}${it.spec ? '-' + it.spec : ''}×${Number(it.quantity ?? it.qty) || 0}`).join('，'),
        });
        writeJson(orderKey, list);
      }
    } catch { /* ignore */ }
    message.success(`订单已生成：${poCode}，供应商将收到订单通知`);
    persistCart({ shareCode: cart.shareCode, items: [], updatedAt: Date.now() });
    setCheckoutOpen(false);
    setCartOpen(false);
  };

  // 分享购物车
  const [cartShareOpen, setCartShareOpen] = useState(false);
  const [cartShareCode, setCartShareCode] = useState('');
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [addressForm, setAddressForm] = useState({
    receiverName: '',
    phone: '',
    province: '',
    city: '',
    district: '',
    addressDetail: '',
  });

  const openCartShare = () => {
    if (cart.items.length === 0) { message.warning('购物车为空，无法分享'); return; }
    // 打开地址填写弹窗
    setAddressModalOpen(true);
  };

  const confirmShareWithAddress = () => {
    // 生成分享码并保存地址信息
    const code = genCartShareCode();
    const all = safeJson(CART_SHARES_KEY, []);
    all.unshift({
      shareCode: code,
      originalInventoryCode: inv?.shareCode || '',
      supplierUsername: inv?.supplierUsername || cart.items[0]?.publisherUsername || '',
      supplierCompany: inv?.supplierName || cart.items[0]?.publisherCompany || '',
      buyerLabel: username ? `${companyName || username}(${username})` : '未登录访客',
      items: cart.items.map(i => ({ ...i })),
      // 保存地址信息（非必填，可为空）
      receiverName: addressForm.receiverName || '',
      phone: addressForm.phone || '',
      province: addressForm.province || '',
      city: addressForm.city || '',
      district: addressForm.district || '',
      addressDetail: addressForm.addressDetail || '',
      createdAt: new Date().toISOString(),
    });
    writeJson(CART_SHARES_KEY, all);
    setCartShareCode(code);
    setAddressModalOpen(false);
    setCartShareOpen(true);
  };

  // 登录/退出
  const goLogin = () => { window.location.href = '/login'; };

  // ============ 联系按键与隐私遮罩 ============
  const ownerUsername = inv?.supplierUsername || '';
  const chatMe = username || (() => { try { return localStorage.getItem('guest_chat_username') || ''; } catch { return ''; } })();
  const chatConvId = chatMe && ownerUsername ? [chatMe, ownerUsername].sort().join('_') : '';
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  // 合作关系判定：未建立合作关系的采购商/访客隐藏联系方式中间部分与详细地址
  const isCooperative = useMemo(() => {
    const ownerU = inv?.supplierUsername || '';
    if (!ownerU || !username) return false;
    if (username === ownerU) return true;
    let myCompany = '';
    try {
      const us: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      myCompany = String((Array.isArray(us) ? us.find((x: any) => x.username === username) : null)?.companyName || '');
    } catch { /* ignore */ }
    try {
      const bp: any[] = JSON.parse(localStorage.getItem(`boundPurchasers_${ownerU}`) || '[]');
      if (Array.isArray(bp) && bp.some((b: any) => b.purchaserUsername === username || (myCompany && b.purchaserName === myCompany))) return true;
    } catch { /* ignore */ }
    try {
      const ps: any[] = JSON.parse(localStorage.getItem(`purchaser_suppliers_${username}`) || '[]');
      if (Array.isArray(ps) && ps.some((s: any) => s.supplierName === inv?.supplierName && s.cooperationStatus !== 'pending' && s.cooperationStatus !== 'terminated')) return true;
    } catch { /* ignore */ }
    return false;
  }, [inv, username]);

  // 联系按键：登录账号回主系统开会话；未注册账号生成临时身份在线沟通
  const openContact = useCallback(() => {
    const ownerU = inv?.supplierUsername || '';
    if (!ownerU) { message.warning('无法获取供应商信息，暂不能联系'); return; }
    if (username) {
      try { sessionStorage.setItem('open_chat_request', JSON.stringify({ username: ownerU, subject: inv?.supplierName || '' })); } catch { /* ignore */ }
      window.location.href = '/';
      return;
    }
    try {
      if (!localStorage.getItem('guest_chat_username')) setGuestIdentity(`临时访客-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
    } catch { /* ignore */ }
    connectChatWS();
    setChatOpen(true);
  }, [inv, username]);

  const loadChatHistory = useCallback(async () => {
    if (!chatConvId) return;
    const list = await fetchHistory(chatConvId);
    setChatMsgs([...list].sort((a: any, b: any) => (Number(a.ts) || 0) - (Number(b.ts) || 0)));
    httpMarkRead(chatConvId);
  }, [chatConvId]);

  useEffect(() => {
    if (!chatOpen || !chatConvId) return;
    loadChatHistory();
    const un = onNewMessage((m: any) => {
      const ownerU = inv?.supplierUsername || '';
      const me = username || localStorage.getItem('guest_chat_username') || '';
      if ((m.from === ownerU && m.to === me) || (m.from === me && m.to === ownerU)) {
        setChatMsgs(prev => (prev.some((x: any) => x.id && x.id === m.id) ? prev : [...prev, m]));
        if (m.from === ownerU) httpMarkRead(chatConvId);
      }
    });
    return un;
  }, [chatOpen, chatConvId, inv, username, loadChatHistory]);

  const sendChatMsg = useCallback(() => {
    const text = chatInput.trim();
    const ownerU = inv?.supplierUsername || '';
    if (!text || !ownerU) return;
    const cid = sendMessage(ownerU, text, inv?.supplierName || '');
    setChatMsgs(prev => [...prev, { id: cid, cid, from: chatMe, to: ownerU, content: text, msg_type: 'text', ts: Date.now() }]);
    setChatInput('');
  }, [chatInput, chatMe, inv]);
  const doLogout = () => {
    localStorage.removeItem('username');
    localStorage.removeItem('companyName');
    refreshLogin();
    message.success('已退出账号');
  };

  // 按供应商分组
  const cartBySupplier = useMemo(() => {
    const m: Record<string, CartItem[]> = {};
    cart.items.forEach(i => { (m[i.supplierName] = m[i.supplierName] || []).push(i); });
    return m;
  }, [cart]);

  // ============ 生成货盘表：按款式编码聚合颜色/尺码/材质/颜色图/库存，预览并下载 Excel ============
  const [goodsRows, setGoodsRows] = useState<any[]>([]);
  const [goodsTableOpen, setGoodsTableOpen] = useState(false);

  const buildGoodsRows = useCallback((): any[] => {
    const productList: any[] = (window as any).__sharedInventoryProductList || [];
    const supplier = inv?.supplierUsername || '';
    const seen = new Set<string>();
    const rows: any[] = [];
    (inv?.products || []).forEach((p: any) => {
      const sc = p.styleCode || '';
      if (!sc || seen.has(sc)) return;
      seen.add(sc);
      const vars = productList.filter((x: any) => x.styleCode === sc);
      const src = vars.length ? vars : [{ ...p }];
      const colors: string[] = Array.from(new Set(src.map((v: any) => String(v.color || '').trim()).filter(Boolean)));
      const specs: string[] = Array.from(new Set(src.map((v: any) => String(v.spec || '').trim()).filter(Boolean)));
      // 图片：每个颜色取该颜色首条变体图；无颜色时取款式主图
      const imgs: string[] = colors.length
        ? colors.map(c => { const v = src.find((x: any) => x.color === c); return imgOfVisitor({ ...v, publisherUsername: v?.publisherUsername || p.publisherUsername || supplier }); })
        : [imgOfVisitor({ ...p, publisherUsername: p.publisherUsername || supplier })];
      const stock = src.reduce((s: number, v: any) => s + (Number(v.actualStock) || 0), 0);
      rows.push({
        key: sc,
        styleCode: sc,
        colors: colors.join(',') || '—',
        sizes: fmtSizeRange(specs),
        upper: src[0]?.shoeUpper || p.shoeUpper || '—',
        sole: src[0]?.shoeSole || p.shoeSole || '—',
        imgs: imgs.filter(Boolean),
        stock,
      });
    });
    return rows;
  }, [inv]);

  /** 下载货盘表到本地：Excel 表格文件（.xls，内嵌图片，Excel/WPS 双击直接打开） */
  const downloadGoodsTable = useCallback((rows: any[]) => {
    const maxImgs = Math.max(1, ...rows.map(r => (r.imgs || []).length));
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = `<tr><th>款式编码</th><th>颜色</th><th>尺码</th><th>鞋面材质</th><th>鞋底材质</th><th colspan="${maxImgs}">图片</th><th>库存</th></tr>`;
    const body = rows.map(r => {
      const imgTds = Array.from({ length: maxImgs }, (_, i) => {
        const src = (r.imgs || [])[i] || '';
        // 图片必须同时写 width/height 属性：Excel/WPS 导入 HTML 时忽略 CSS 尺寸，
        // 只认属性值；否则图片以原始尺寸浮动渲染会跨行错位，导致图片与货号对不上
        return `<td style="text-align:center;vertical-align:middle;width:96px;">${src ? `<img src="${src}" width="90" height="90" style="width:90px;height:90px;object-fit:cover;" />` : ''}</td>`;
      }).join('');
      // 行高锁定 70pt（≈93px），保证每行图片完整落在本行内，与款式编码一一对应
      return `<tr style="height:70pt;"><td style="text-align:center;vertical-align:middle;">${esc(r.styleCode)}</td><td style="text-align:center;vertical-align:middle;">${esc(r.colors)}</td><td style="text-align:center;vertical-align:middle;">${esc(r.sizes)}</td><td style="text-align:center;vertical-align:middle;">${esc(r.upper)}</td><td style="text-align:center;vertical-align:middle;">${esc(r.sole)}</td>${imgTds}<td style="text-align:center;vertical-align:middle;">${r.stock}</td></tr>`;
    }).join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /><title>货盘表</title>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>货盘表</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>body{font-family:'Microsoft YaHei',sans-serif;padding:24px;}h2{text-align:center;letter-spacing:4px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #666;padding:8px 10px;font-size:13px;}th{background:#f0f4fa;}</style>
</head><body><h2>${esc(inv?.supplierName || '货盘表')}</h2>
<table>${head}${body}</table>
<div style="margin-top:12px;font-size:12px;color:#888;">生成时间：${new Date().toLocaleString('zh-CN')}　｜　讯能手 ERP · 货盘分享页</div>
</body></html>`;
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const fname = `货盘表_${String(inv?.supplierName || '货盘').replace(/[\\/:*?"<>|]/g, '')}_${stamp}.xls`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, [inv]);

  const handleGenGoodsTable = useCallback(() => {
    const rows = buildGoodsRows();
    if (rows.length === 0) { message.warning('货盘暂无商品，无法生成货盘表'); return; }
    setGoodsRows(rows);
    setGoodsTableOpen(true);
    downloadGoodsTable(rows);
    message.success(`货盘表已生成（${rows.length} 个款式）并开始下载 Excel`);
  }, [buildGoodsRows, downloadGoodsTable]);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* 页头（标题+右上角登录+购物车） */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '12px 24px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: PRIMARY, flex: 1 }}>
            <ShopOutlined style={{ marginRight: 8 }} />货盘展示
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* 购物车图标 + 角标 */}
            <Button
              type="text"
              icon={
                <span style={{ position: 'relative', display: 'inline-block' }}>
                  <ShoppingCartOutlined style={{ fontSize: 20 }} />
                  {cartCount > 0 && (
                    <span style={{ position: 'absolute', top: -8, right: -10, background: '#fa8c16', color: '#fff', borderRadius: 10, fontSize: 11, padding: '0 6px', minWidth: 18, textAlign: 'center', fontWeight: 600 }}>{cartCount}</span>
                  )}
                </span>
              }
              onClick={() => setCartOpen(true)}
              style={{ position: 'relative' }}
            >
              购物车
            </Button>
            {/* 登录/用户 */}
            {username ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: PRIMARY }} />
                <span style={{ fontSize: 13, color: '#333' }}>{companyName || username}</span>
                <Button type="text" size="small" icon={<LogoutOutlined />} onClick={doLogout}>退出</Button>
              </span>
            ) : (
              <Button type="primary" icon={<LoginOutlined />} onClick={goLogin}>登录账号</Button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 60, textAlign: 'center' }}>
            <Spin tip="正在加载货盘数据..." />
          </div>
        ) : !inv ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 60 }}>
            <Empty description="未找到该分享链接对应的货盘，链接可能已失效或货盘已被删除" />
          </div>
        ) : (
          <>
            {/* 公司名称表头：左 2/3 公司名称+背景图，右 1/3 微信二维码/公司地址/联系方式（未完善字段不显示） */}
            {(() => {
              const addrFull = supplierProfile ? (supplierProfile.businessAddress || [supplierProfile.province, supplierProfile.city, supplierProfile.district, supplierProfile.addressDetail].filter(Boolean).join(' ')) : '';
              // 未建立合作关系：隐藏详细地址（仅展示省市区）
              const addr = isCooperative ? addrFull : (supplierProfile ? [supplierProfile.province, supplierProfile.city, supplierProfile.district].filter(Boolean).join(' ') : '');
              const contact = supplierProfile?.contactPerson || '';
              const phoneRaw = supplierProfile?.phone || '';
              // 未建立合作关系：隐藏联系方式中间部分
              const phone = !isCooperative && phoneRaw && phoneRaw.length >= 7 ? `${phoneRaw.slice(0, 3)}****${phoneRaw.slice(-4)}` : phoneRaw;
              const wechat = supplierProfile?.wechatQr || '';
              const hasRight = true;
              return (
                <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', background: '#fff' }}>
                  {/* 左侧：公司名称大图（背景图或系统默认背景） */}
                  <div style={{ flex: hasRight ? 2 : 1, position: 'relative', minHeight: 150, background: bannerImg ? `url(${bannerImg}) center/cover no-repeat` : 'linear-gradient(135deg, #1e4a7e 0%, #2f6bab 55%, #5b9bd5 100%)', display: 'flex', alignItems: 'center', padding: '20px 32px', overflow: 'hidden' }}>
                    {bannerImg && <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,30,50,0.35)' }} />}
                    <div style={{ position: 'relative', color: '#fff', minWidth: 0 }}>
                      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, textShadow: '0 2px 8px rgba(0,0,0,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.supplierName || '—'}</div>
                      <div style={{ fontSize: 12, marginTop: 6, opacity: 0.92, textShadow: '0 1px 4px rgba(0,0,0,0.35)' }}>货盘：{inv.isAllShare ? '全部商品' : inv.name} ｜ 商品数量：{inv.products?.length || inv.productKeys?.length || 0} 件</div>
                    </div>
                  </div>
                  {/* 右侧：微信二维码 + 公司地址 + 联系方式 */}
                  {hasRight && (
                    <div style={{ flex: 1, padding: '14px 20px', display: 'flex', gap: 14, alignItems: 'center', background: '#fff' }}>
                      {wechat && (
                        <div style={{ textAlign: 'center', flexShrink: 0 }}>
                          <img src={wechat} alt="微信二维码" style={{ width: 88, height: 88, objectFit: 'contain', borderRadius: 6, border: '1px solid #eee' }} />
                          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>微信二维码</div>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#555' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Button type="primary" size="small" icon={<MessageOutlined />} onClick={openContact}>联系</Button>
                          {!isCooperative && <span style={{ fontSize: 11, color: '#999' }}>未建立合作关系，联系方式部分隐藏，可点击联系在线沟通</span>}
                        </div>
                        {addr && <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><EnvironmentOutlined style={{ color: PRIMARY, marginTop: 2 }} /><span>{addr}</span></div>}
                        {contact && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><UserOutlined style={{ color: PRIMARY }} /><span>{contact}</span></div>}
                        {phone && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><PhoneOutlined style={{ color: PRIMARY }} /><span>{phone}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 货盘信息 */}
            <div style={{ background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 12, padding: '12px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: PRIMARY }}>{inv.isAllShare ? '货盘：全部商品' : `货盘：${inv.name}`}</div>
                <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                  供应商：{inv.supplierName || '—'} ｜ 商品数量：{inv.products?.length || inv.productKeys?.length || 0} 件
                </div>
              </div>
              {/* 生成货盘表：按款式聚合颜色/尺码/材质/图片/库存并下载 Excel */}
              <Button type="primary" icon={<FileExcelOutlined />} onClick={handleGenGoodsTable}>生成货盘表</Button>
            </div>

            {/* 商品卡片网格 */}
            {(inv.products || []).length === 0 ? (
              <div style={{ background: '#fff', borderRadius: 12, padding: 60 }}>
                <Empty description="该货盘暂无商品" />
              </div>
            ) : (
              <Row gutter={[16, 16]}>
                {inv.products.map((p: any) => {
                  const imgSrc = imgOfVisitor(p);
                  return (
                    <Col key={p.key} xs={12} sm={8} md={6} lg={6} xl={4}>
                      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.3s', cursor: 'pointer' }}
                        onClick={() => openDetail(p)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
                      >
                        {/* 图片区：正方形（450×450） */}
                        <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', overflow: 'hidden' }}>
                          {imgSrc ? <img src={imgSrc} alt={p.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ShopOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                            </div>
                          )}
                        </div>
                        {/* 信息区 */}
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.shortName || '—'}
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            <Tag color="blue" style={{ fontSize: 11 }}>{p.styleCode}</Tag>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                            <span style={{ color: '#f5222d', fontSize: 11 }}>供货价</span>
                            <span style={{ color: '#f5222d', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>¥{Number(p.targetPrice ?? p.price) || 0}</span>
                            <span style={{ color: '#999', fontSize: 12, marginLeft: 2 }}>/{p.unit || '件'}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
                            {p.supplierName || p.publisherCompany || '—'}
                          </div>
                          {/* 加入购物车按钮 */}
                          <Button type="primary" block icon={<ShoppingCartOutlined />} onClick={() => openDetail(p)}>
                            加入购物车
                          </Button>
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            )}

            <div style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 24 }}>
              讯能手 ERP · 货盘公开分享页（此页面无需登录即可查看）
            </div>
          </>
        )}
      </div>

      {/* 在线沟通抽屉（未注册账号临时身份/登录账号均可用） */}
      <Drawer
        title={(<span><MessageOutlined style={{ color: PRIMARY, marginRight: 8 }} />在线沟通 · {inv?.supplierName || ''}</span>)}
        open={chatOpen} onClose={() => setChatOpen(false)} width={420}
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={chatInput} onChange={e => setChatInput(e.target.value)} onPressEnter={sendChatMsg} placeholder="输入消息，回车发送" />
              <Button type="primary" onClick={sendChatMsg}>发送</Button>
            </div>
            {!username && <div style={{ fontSize: 11, color: '#999' }}>当前身份：{chatMe || '临时访客'}（临时身份，注册登录后可延续会话）</div>}
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chatMsgs.length === 0 && <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: '24px 0' }}>暂无消息，开始沟通吧</div>}
          {chatMsgs.map((m: any, idx: number) => {
            const mine = m.from === chatMe;
            return (
              <div key={m.id || m.cid || `${m.ts}-${idx}`} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', background: mine ? PRIMARY : '#f0f0f0', color: mine ? '#fff' : '#333', padding: '8px 10px', borderRadius: 8, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.msg_type === 'image' ? <img src={m.content} alt="图片" style={{ maxWidth: 200 }} /> : m.content}
              </div>
            );
          })}
        </div>
      </Drawer>

      {/* 加入购物车数量弹窗 */}
      <Modal title="加入购物车" open={qtyModalOpen} onOk={confirmAdd} onCancel={() => setQtyModalOpen(false)} okText="加入" cancelText="取消" width={520}>
        {qtyModalProduct && (
          <div>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="商品简称">{qtyModalProduct.shortName || '—'}</Descriptions.Item>
              <Descriptions.Item label="商品编码">{qtyModalProduct.productCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="款式编码">{qtyModalProduct.styleCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="供应商">{qtyModalProduct.supplierName || qtyModalProduct.publisherCompany || '—'}</Descriptions.Item>
              <Descriptions.Item label="供货价"><span style={{ color: '#f5222d', fontWeight: 600 }}>¥{Number(qtyModalProduct.targetPrice ?? qtyModalProduct.price) || 0}</span>/{qtyModalProduct.unit || '件'}</Descriptions.Item>
            </Descriptions>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600 }}>采购数量：</span>
              <InputNumber min={1} value={qtyModalValue} onChange={v => setQtyModalValue(Number(v) || 1)} style={{ width: 120 }} />
              <span style={{ color: '#999' }}>{qtyModalProduct.unit || '件'}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* 购物车抽屉 */}
      <Drawer
        title={(<span><ShoppingCartOutlined style={{ color: PRIMARY, marginRight: 8 }} />购物车（{cartCount} 件）</span>)}
        open={cartOpen} onClose={() => setCartOpen(false)} width={460}
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>合计：</span><span style={{ color: '#f5222d', fontWeight: 700 }}>¥{cartTotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button icon={<ShareAltOutlined />} onClick={openCartShare} disabled={cart.items.length === 0}>分享给供应商</Button>
              <Button type="primary" block onClick={openCheckout}>去结算</Button>
            </div>
          </div>
        }
      >
        {cart.items.length === 0 ? (
          <Empty description="购物车为空" />
        ) : (
          Object.entries(cartBySupplier).map(([sup, items]) => (
            <div key={sup} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: PRIMARY }}>供应商：{sup}</div>
              {items.map(i => (
                <div key={i.key} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0f0', alignItems: 'center' }}>
                  <div style={{ width: 64, height: 64, background: '#f5f5f5', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                    {i.image ? <img src={i.image} alt={i.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShopOutlined style={{ color: '#d9d9d9' }} /></div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.shortName}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {i.productCode && <Tag color="default" style={{ fontSize: 10, marginRight: 4 }}>{i.productCode}</Tag>}
                      {i.color && <Tag color="default" style={{ fontSize: 10, marginRight: 4 }}>{i.color}</Tag>}
                      {i.spec && <Tag color="default" style={{ fontSize: 10 }}>{i.spec}</Tag>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <Button size="small" icon={<MinusOutlined />} onClick={() => updateQty(i.key, i.qty - 1)} />
                      <InputNumber size="small" min={1} value={i.qty} onChange={v => updateQty(i.key, Number(v) || 1)} style={{ width: 60 }} />
                      <Button size="small" icon={<PlusOutlined />} onClick={() => updateQty(i.key, i.qty + 1)} />
                      <Popconfirm title="确定删除该商品？" onConfirm={() => removeItem(i.key)} okText="删除" cancelText="取消">
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ color: '#f5222d', fontWeight: 700, fontSize: 13 }}>¥{i.price}<span style={{ color: '#999', fontWeight: 400, fontSize: 11 }}>/{i.unit}</span></div>
                    <div style={{ color: '#f5222d', fontWeight: 600, fontSize: 12, marginTop: 2 }}>小计：¥{(i.price * i.qty).toFixed(2)}</div>
                  </div>
                </div>
              ))}
              <div style={{ textAlign: 'right', fontSize: 12, color: '#555', paddingTop: 4 }}>
                小计：<span style={{ color: '#f5222d', fontWeight: 600 }}>¥{items.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2)}</span>
              </div>
            </div>
          ))
        )}
      </Drawer>

      {/* 结算弹窗 */}
      <Modal
        title="确认订单"
        open={checkoutOpen}
        onCancel={() => setCheckoutOpen(false)}
        onOk={submitOrder}
        okText="确认下单"
        cancelText="取消"
        width={640}
      >
        <Form form={checkoutForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>订单概要</div>
            <div style={{ fontSize: 12, color: '#666' }}>商品总数 {cartCount} 件 ｜ 订单金额 ¥{cartTotal.toFixed(2)}</div>
            <div style={{ marginTop: 6 }}>
              {cart.items.map(i => (
                <div key={i.key} style={{ fontSize: 12, color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{i.shortName} × {i.qty}</span>
                  <span>¥{(i.price * i.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="contactPerson" label="联系人" rules={[{ required: true, message: '请输入联系人' }]}><Input placeholder="请输入联系人" /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="联系电话" rules={[{ required: true, message: '请输入联系电话' }]}><Input placeholder="请输入联系电话" /></Form.Item></Col>
            <Col span={8}><Form.Item name="province" label="省份"><Select allowClear placeholder="省份" options={getProvinceOptions()} onChange={() => checkoutForm.setFieldsValue({ city: undefined, district: undefined })} /></Form.Item></Col>
            <Col span={8}>{(() => { const p = checkoutForm.getFieldValue('province'); return <Form.Item name="city" label="城市"><Select allowClear placeholder="城市" options={getCityOptions(p)} onChange={() => checkoutForm.setFieldsValue({ district: undefined })} /></Form.Item>; })()}</Col>
            <Col span={8}>{(() => { const c = checkoutForm.getFieldValue('city'); return <Form.Item name="district" label="区县"><Select allowClear placeholder="区县" options={getDistrictOptions(c)} /></Form.Item>; })()}</Col>
            <Col span={24}><Form.Item name="addressDetail" label="详细地址"><Input placeholder="街道、门牌号等" /></Form.Item></Col>
            <Col span={24}><Form.Item name="remark" label="备注（写入买家留言）"><Input.TextArea rows={2} placeholder="选填，如规格/颜色/交期等" maxLength={200} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 地址填写弹窗 */}
      <Modal
        title="收货地址（选填）"
        open={addressModalOpen}
        onCancel={() => setAddressModalOpen(false)}
        footer={[
          <Button key="skip" onClick={confirmShareWithAddress}>跳过</Button>,
          <Button key="submit" type="primary" onClick={confirmShareWithAddress}>确认分享</Button>,
        ]}
        width={520}
      >
        <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
          填写收货地址后，供应商生成订单时将自动填充。所有字段均为选填，可直接跳过。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>收件人</div>
            <Input
              placeholder="请输入收件人姓名"
              value={addressForm.receiverName}
              onChange={e => setAddressForm({ ...addressForm, receiverName: e.target.value })}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>联系电话</div>
            <Input
              placeholder="请输入联系电话"
              value={addressForm.phone}
              onChange={e => setAddressForm({ ...addressForm, phone: e.target.value })}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>省份</div>
              <Select
                placeholder="选择省份"
                allowClear
                value={addressForm.province || undefined}
                onChange={v => setAddressForm({ ...addressForm, province: v || '', city: '', district: '' })}
                options={getProvinceOptions()}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>城市</div>
              <Select
                placeholder="选择城市"
                allowClear
                value={addressForm.city || undefined}
                onChange={v => setAddressForm({ ...addressForm, city: v || '', district: '' })}
                options={getCityOptions(addressForm.province)}
                disabled={!addressForm.province}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>区县</div>
              <Select
                placeholder="选择区县"
                allowClear
                value={addressForm.district || undefined}
                onChange={v => setAddressForm({ ...addressForm, district: v || '' })}
                options={getDistrictOptions(addressForm.province, addressForm.city)}
                disabled={!addressForm.province || !addressForm.city}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>详细地址</div>
            <Input.TextArea
              placeholder="请输入详细地址（街道/门牌号等）"
              value={addressForm.addressDetail}
              onChange={e => setAddressForm({ ...addressForm, addressDetail: e.target.value })}
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {/* 购物车分享链接弹窗 */}
      <Modal
        title="购物车分享链接"
        open={cartShareOpen}
        onCancel={() => setCartShareOpen(false)}
        footer={<Button onClick={() => setCartShareOpen(false)}>关闭</Button>}
        width={520}
      >
        {cartShareCode && (() => {
          const link = `${window.location.origin}/shared/cart?code=${cartShareCode}`;
          return (
            <>
              <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ color: '#666', marginBottom: 6 }}>分享码</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: PRIMARY, letterSpacing: 1 }}>{cartShareCode}</div>
              </div>
              <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <div style={{ color: '#666', marginBottom: 6 }}>分享链接</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, color: PRIMARY }}>{link}</span>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(link); message.success('已复制'); }}>复制</Button>
                </div>
              </div>
              <div style={{ color: '#999', fontSize: 12 }}>
                将此链接发给供应商，供应商打开后可看到您选择的商品和数量，并可直接生成订单。
              </div>
            </>
          );
        })()}
      </Modal>

      {/* 产品详情弹窗 */}
      <Modal
        title="产品详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setDetailOpen(false)}>取消</Button>,
          <Button key="add" type="primary" icon={<ShoppingCartOutlined />} onClick={handleConfirmAddSkusToCart}>确认加入购物车</Button>,
        ]}
        width={780}
        destroyOnClose
      >
        {detailProduct && (() => {
          return (
            <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={9}>
                  <div style={{ height: 300, background: '#fafafa', border: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {detailImg ? <img src={detailImg} alt={detailProduct.shortName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ShopOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
                  </div>
                </Col>
                <Col span={15}>
                  <Paragraph strong style={{ fontSize: 16, marginBottom: 8 }}>{detailProduct.shortName}</Paragraph>
                  <Space style={{ marginBottom: 8 }}>
                    <Tag color="blue">{detailProduct.styleCode}</Tag>
                    <Tag color="green">在售</Tag>
                  </Space>
                  <div style={{ background: '#fafafa', padding: '8px 12px', marginBottom: 8 }}>
                    <Text strong style={{ color: '#f5222d', fontSize: 18 }}>供货价 ¥{Number(detailProduct.targetPrice ?? detailProduct.price) || 0} 起</Text>
                  </div>
                  <Descriptions size="small" column={2} bordered>
                    <Descriptions.Item label="款式编码">{detailProduct.styleCode || '—'}</Descriptions.Item>
                    <Descriptions.Item label="单位">{detailProduct.unit || '件'}</Descriptions.Item>
                    <Descriptions.Item label="总库存">{detailVariants.reduce((s: number, v: any) => s + (Number(v.actualStock) || 0), 0) || 0}</Descriptions.Item>
                    <Descriptions.Item label="供应商">{detailProduct.supplierName || detailProduct.publisherCompany || '—'}</Descriptions.Item>
                  </Descriptions>
                  {detailVariants.some(v => v.color) && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary">颜色：</Text>
                      <Space size={4} wrap>
                        <Tag color={!detailColor ? 'blue' : undefined} style={{ cursor: 'pointer' }} onClick={() => { setDetailColor(''); setDetailImg(imgOfVisitor(detailProduct)); }}>全部</Tag>
                        {Array.from(new Set(detailVariants.map(v => v.color).filter(Boolean))).map(c => (
                          <Tag key={c} color={detailColor === c ? 'blue' : undefined} style={{ cursor: 'pointer' }} onClick={() => { setDetailColor(c); const vv = detailVariants.find(x => x.color === c); if (vv) setDetailImg(imgOfVisitor({ ...vv, publisherUsername: detailProduct.publisherUsername })); }}>{c}</Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                </Col>
              </Row>
              <Paragraph strong style={{ marginBottom: 8 }}>规格明细（SKU）</Paragraph>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                <Table
                  rowKey={(x: any) => x.key}
                  bordered
                  size="small"
                  dataSource={detailVariants.filter(v => !detailColor || v.color === detailColor)}
                  columns={[
                    { key: 'color', title: '颜色', dataIndex: 'color', width: 100, align: 'center', render: (v: string) => v || '—' },
                    { key: 'spec', title: '尺码/规格', dataIndex: 'spec', width: 120, align: 'center', render: (v: string) => v || '—' },
                    { key: 'productCode', title: 'SKU编码', dataIndex: 'productCode', width: 160, align: 'center' },
                    { key: 'suggestedPrice', title: '供货价', dataIndex: 'suggestedPrice', width: 100, align: 'center', render: (v: number) => <Text strong style={{ color: '#f5222d' }}>¥{Number(v) || 0}</Text> },
                    { key: 'actualStock', title: '库存数', dataIndex: 'actualStock', width: 100, align: 'center', render: (v: number) => `${Number(v) || 0}` },
                    {
                      key: 'qty', title: '数量', width: 90, align: 'center',
                      render: (_: any, x: any) => (
                        <InputNumber controls={false} min={0} style={{ width: 64 }} placeholder="0" value={skuQty[x.key] ?? undefined}
                          onChange={v => setSkuQty(prev => ({ ...prev, [x.key]: Number(v) || 0 }))} />
                      ),
                    },
                    { key: 'productStatus', title: '状态', dataIndex: 'productStatus', width: 90, align: 'center', render: (v: string) => <Tag color={v === '在售' ? 'green' : 'default'}>{v || '—'}</Tag> },
                  ]}
                  pagination={false}
                  locale={{ emptyText: <Empty description="无规格明细" /> }}
                />
              </div>
            </>
          );
        })()}
      </Modal>

      {/* 货盘表预览弹窗（生成后自动下载 Excel，可再次下载） */}
      <Modal
        title={<span><FileExcelOutlined style={{ color: PRIMARY, marginRight: 8 }} />货盘表预览（{goodsRows.length} 个款式）</span>}
        open={goodsTableOpen}
        onCancel={() => setGoodsTableOpen(false)}
        footer={[
          <Button key="close" onClick={() => setGoodsTableOpen(false)}>关闭</Button>,
          <Button key="dl" type="primary" icon={<FileExcelOutlined />} onClick={() => { downloadGoodsTable(goodsRows); message.success('货盘表 Excel 已重新下载'); }}>下载到本地</Button>,
        ]}
        width={1000}
      >
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          <Table
            rowKey={(r: any) => r.key}
            bordered
            size="small"
            dataSource={goodsRows}
            pagination={false}
            columns={[
              { key: 'styleCode', title: '款式编码', dataIndex: 'styleCode', width: 110, align: 'center' },
              { key: 'colors', title: '颜色', dataIndex: 'colors', width: 140, align: 'center' },
              { key: 'sizes', title: '尺码', dataIndex: 'sizes', width: 100, align: 'center' },
              { key: 'upper', title: '鞋面材质', dataIndex: 'upper', width: 110, align: 'center' },
              { key: 'sole', title: '鞋底材质', dataIndex: 'sole', width: 110, align: 'center' },
              {
                key: 'imgs', title: '图片', align: 'center',
                render: (_: any, r: any) => (
                  <Space size={6} wrap>
                    {(r.imgs || []).length ? (r.imgs as string[]).map((src, i) => (
                      <img key={i} src={src} alt={`颜色图${i + 1}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }} />
                    )) : '—'}
                  </Space>
                ),
              },
              { key: 'stock', title: '库存', dataIndex: 'stock', width: 90, align: 'center' },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
};

export default SharedInventoryPage;
