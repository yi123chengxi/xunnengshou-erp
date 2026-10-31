import React, { useEffect, useMemo, useState } from 'react';
import {
  Spin, Tag, Row, Col, Empty, Button, message, Avatar, Descriptions,
} from 'antd';
import {
  ShopOutlined, LoginOutlined, LogoutOutlined, CopyOutlined, FileTextOutlined,
  ShoppingCartOutlined, UserOutlined, CheckCircleOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import { loadDataset, saveDataset } from '../utils/dataStore';
import { pullAllDatasets } from '../utils/serverSync';

const PRIMARY = '#1e4a7e';
const SHARED_INVENTORY_KEY = 'market_shared_inventories';
const CART_SHARES_KEY = 'market_visitor_cart_shares';
const TRADE_ORDERS_KEY = 'market_trade_orders';

interface CartItem {
  key: string;
  styleCode?: string;
  shortName?: string;
  productKey?: string;
  publisherUsername?: string;
  publisherCompany?: string;
  unit?: string;
  price: number;
  qty: number;
  image?: string;
  supplierName?: string;
}

interface CartShareRecord {
  shareCode: string;
  originalInventoryCode?: string;
  supplierUsername?: string;
  supplierCompany?: string;
  buyerLabel?: string;
  items: CartItem[];
  createdAt: string;
  // 收货地址信息（选填）
  receiverName?: string;
  phone?: string;
  province?: string;
  city?: string;
  district?: string;
  addressDetail?: string;
}

interface InventoryRecord {
  shareCode: string;
  name?: string;
  products?: any[];
  supplierUsername?: string;
  supplierName?: string;
  supplierCompany?: string;
}

const safeJson = (k: string, d: any) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; }
};
const writeJson = (k: string, v: any) => {
  try { const j = JSON.stringify(v); localStorage.setItem(k, j); saveDataset(k, j); } catch { /* ignore */ }
};

/** 按时间戳取较新者（localStorage vs IndexedDB） */
const loadListLatest = async (key: string): Promise<any[]> => {
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

const imgOf = (p: any): string => {
  if (p.image) return String(p.image);
  try { return localStorage.getItem(`prodImg_${p.publisherUsername}_${p.productKey}`) || ''; } catch { return ''; }
};

const genPoCode = () => {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `PO-MKT-${n}`;
};

/** 从 buyerLabel 解析出 username 与 companyName，格式如 "杭州讯想(visitor_xxx)" */
const parseBuyerLabel = (label: string): { company: string; username: string } => {
  if (!label) return { company: '未登录访客', username: '' };
  if (label === '未登录访客') return { company: '未登录访客', username: '' };
  const m = label.match(/^(.+?)\(([^)]+)\)$/);
  if (m) return { company: m[1].trim(), username: m[2].trim() };
  return { company: label, username: '' };
};

/**
 * 购物车分享公开页（独立网站页，供应商视角）：
 * 供应商打开访客/采购商分享的购物车链接即可看到商品明细和数量，
 * 登录后可一键生成订单（写入供应商订单管理与全局交易订单）。
 */
const SharedCartPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [shareRec, setShareRec] = useState<CartShareRecord | null>(null);
  const [inv, setInv] = useState<InventoryRecord | null>(null);

  // 登录态
  const [username, setUsername] = useState<string>(() => localStorage.getItem('username') || '');
  const [companyName, setCompanyName] = useState<string>(() => localStorage.getItem('companyName') || '');
  const [role, setRole] = useState<string>(() => localStorage.getItem('role') || '');

  const refreshLogin = () => {
    setUsername(localStorage.getItem('username') || '');
    setCompanyName(localStorage.getItem('companyName') || '');
    setRole(localStorage.getItem('role') || '');
  };

  useEffect(() => {
    const onStorage = () => refreshLogin();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const codeParam = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('code') || ''; } catch { return ''; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await pullAllDatasets(); } catch { /* ignore */ }
      const code = codeParam.trim();
      if (!code) { if (!cancelled) { setLoading(false); } return; }
      const list = await loadListLatest(CART_SHARES_KEY);
      const found = (list || []).find((s: any) => s.shareCode === code);
      if (!cancelled) {
        setShareRec(found || null);
        // 同时加载原货盘信息（用于显示货盘名称）
        if (found && found.originalInventoryCode) {
          const invList = await loadListLatest(SHARED_INVENTORY_KEY);
          const foundInv = (invList || []).find((x: any) => x.shareCode === found.originalInventoryCode);
          if (!cancelled) setInv(foundInv || null);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [codeParam]);

  const goLogin = () => { window.location.href = '/login'; };
  const doLogout = () => {
    localStorage.removeItem('username');
    localStorage.removeItem('companyName');
    localStorage.removeItem('role');
    refreshLogin();
    message.success('已退出账号');
  };

  // 商品合计
  const totalQty = shareRec?.items?.reduce((s, i) => s + (Number(i.qty) || 0), 0) || 0;
  const totalAmount = shareRec?.items?.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0) || 0;

  // 是否供应商登录
  const isSupplierLogged = !!(username && (role === 'supplier' || role === '' || !role));

  // 复制整段
  const [copyText, setCopyText] = useState('');
  const copyAll = () => {
    if (!shareRec) return;
    const lines = shareRec.items.map((i) => `${i.shortName || ''} (款号:${i.styleCode || '-'}) × ${i.qty}${i.unit || ''} = ¥${(Number(i.price) * Number(i.qty)).toFixed(2)}`);
    const text = `客户：${shareRec.buyerLabel || '未登录访客'}\n货盘：${inv?.name || '-'}\n订单编号：${genPoCode()}\n\n商品明细：\n${lines.join('\n')}\n\n合计：${totalQty} 件 / ¥${totalAmount.toFixed(2)}`;
    setCopyText(text);
    try { navigator.clipboard.writeText(text); message.success('已复制订单文本到剪贴板'); } catch { /* ignore */ }
  };

  // 一键生成订单
  const [creating, setCreating] = useState(false);
  const createOrderNow = async () => {
    if (!shareRec) return;
    if (!username) { message.warning('请先登录账号'); return; }
    setCreating(true);
    try {
      const buyer = parseBuyerLabel(shareRec.buyerLabel || '');
      // 验证当前账号就是购物车分享的目标供应商
      if (shareRec.supplierUsername && username !== shareRec.supplierUsername) {
        const ok = window.confirm(`该购物车原本是分享给供应商「${shareRec.supplierCompany || shareRec.supplierUsername}」的，您当前登录的是「${companyName || username}」，将以当前账号作为接收方。是否继续？`);
        if (!ok) { setCreating(false); return; }
      }
      // 同步拉一次订单编号（取最大序号避免冲突）
      const existing: any[] = safeJson(TRADE_ORDERS_KEY, []);
      let seq = existing.reduce((m: number, o: any) => { const n = Number(String(o.id || '').replace(/\D/g, '')); return isNaN(n) ? m : Math.max(m, n); }, 0);
      seq += 1;
      const oid = `PO-MKT-${String(seq).padStart(6, '0')}`;
      // 时间格式与订单管理一致（zh-CN 本地化字符串）
      const now = new Date().toLocaleString('zh-CN');

      // 从 items 转换
      const lineItems = (shareRec.items || []).map((i: any) => ({
        productKey: i.productKey || i.key,
        productCode: i.productCode || i.styleCode || '',
        shortName: i.shortName || '',
        styleCode: i.styleCode || '',
        color: i.color || '',
        spec: i.spec || '',
        unitPrice: Number(i.price) || 0,
        quantity: Number(i.qty) || 0,
        subtotal: (Number(i.price) || 0) * (Number(i.qty) || 0),
        image: i.image || imgOf(i),
        publisherUsername: i.publisherUsername || shareRec.supplierUsername,
      }));
      const total = lineItems.reduce((s: number, x: any) => s + x.subtotal, 0);

      const purchaserUsername = buyer.username || `visitor_${shareRec.shareCode}`;
      const purchaserCompany = buyer.company || '未登录访客';

      const order = {
        key: `trade_${Date.now()}_${username}`,
        id: oid,
        orderCode: oid,
        orderSource: '购物车分享',
        purchaserUsername,
        purchaserCompany,
        supplierUsername: username,
        supplierCompany: companyName || username,
        items: lineItems,
        totalAmount: total,
        totalQty,
        contactPerson: '',
        phone: '',
        remark: `由购物车分享链接生成（分享码 ${shareRec.shareCode}）`,
        buyerMessage: `由购物车分享链接生成（分享码 ${shareRec.shareCode}）`,
        shareCode: shareRec.shareCode,
        shareFromInventoryCode: shareRec.originalInventoryCode || '',
        status: '待确认',
        createdAt: now,
        createTime: now,
      };

      // 1. 写入全局交易订单
      const trades = safeJson(TRADE_ORDERS_KEY, []);
      trades.unshift(order);
      writeJson(TRADE_ORDERS_KEY, trades);
      // 派发事件通知市场订单页刷新
      try { window.dispatchEvent(new Event('market-orders-updated')); } catch { /* ignore */ }

      // 2. 写入供应商订单管理（pageData_sales_order-manage_<owner>）
      const orderKey = `pageData_sales_order-manage_${username}`;
      const olist = safeJson(orderKey, []);
      // 组装收货地址
      const addressParts = [shareRec.province, shareRec.city, shareRec.district, shareRec.addressDetail].filter(Boolean);
      const fullAddress = addressParts.join(' ');
      olist.unshift({
        key: order.key,
        id: oid,
        orderStatus: '待确认',
        customerName: purchaserCompany,
        person: shareRec.receiverName || '',
        orderItems: JSON.stringify(lineItems.map((x: any) => ({
          productCode: x.productCode || x.styleCode || '',
          shortName: x.shortName || '',
          styleCode: x.styleCode || '',
          color: x.color || '',
          spec: x.spec || '',
          quantity: x.quantity || 0,
          price: x.unitPrice || 0,
          amount: x.subtotal || 0,
          image: x.image || '',
        }))),
        productDetail: lineItems.map((x: any) => `${x.shortName}${x.color ? '-' + x.color : ''}${x.spec ? '-' + x.spec : ''}×${x.quantity}`).join('，'),
        palletCount: lineItems.length,
        productAmount: total,
        paidAmount: 0,
        payMethod: '',
        receiverName: shareRec.receiverName || '',
        receiverPhone: shareRec.phone || '',
        receiverAddress: fullAddress,
        province: shareRec.province || '',
        city: shareRec.city || '',
        district: shareRec.district || '',
        addressDetail: shareRec.addressDetail || '',
        orderSource: '购物车分享',
        createTime: now,
        buyerMessage: `由购物车分享链接生成（分享码 ${shareRec.shareCode}）`,
      });
      writeJson(orderKey, olist);

      message.success(`订单已生成：${oid}，请到「订单管理」确认`);
    } catch (e: any) {
      message.error('订单生成失败：' + (e?.message || String(e)));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* 页头 */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '12px 24px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: PRIMARY, flex: 1 }}>
            <ShoppingCartOutlined style={{ marginRight: 8 }} />购物车分享订单
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
            <Spin tip="正在加载购物车数据..." />
          </div>
        ) : !shareRec ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 60 }}>
            <Empty description="未找到该分享链接对应的购物车，链接可能已失效" />
          </div>
        ) : (
          <>
            {/* 购物车信息 */}
            <div style={{ background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 12, padding: '12px 20px', marginBottom: 16 }}>
              <Descriptions size="small" column={3} colon={false}>
                <Descriptions.Item label="客户">{shareRec.buyerLabel || '未登录访客'}</Descriptions.Item>
                <Descriptions.Item label="关联货盘">{inv?.name || '—'}</Descriptions.Item>
                <Descriptions.Item label="分享时间">{shareRec.createdAt ? new Date(shareRec.createdAt).toLocaleString() : '—'}</Descriptions.Item>
                <Descriptions.Item label="分享码">{shareRec.shareCode}</Descriptions.Item>
                <Descriptions.Item label="指定供应商">{shareRec.supplierCompany || shareRec.supplierUsername || '—'}</Descriptions.Item>
                <Descriptions.Item label="合计">{totalQty} 件 / <span style={{ color: '#f5222d', fontWeight: 700 }}>¥{totalAmount.toFixed(2)}</span></Descriptions.Item>
              </Descriptions>
            </div>

            {/* 收货地址信息（如果有） */}
            {(shareRec.receiverName || shareRec.phone || shareRec.province || shareRec.addressDetail) && (
              <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 12, padding: '12px 20px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: '#52c41a', fontSize: 14 }}>
                  <EnvironmentOutlined style={{ marginRight: 6 }} />收货地址
                </div>
                <Descriptions size="small" column={2} colon={false}>
                  {shareRec.receiverName && <Descriptions.Item label="收件人">{shareRec.receiverName}</Descriptions.Item>}
                  {shareRec.phone && <Descriptions.Item label="联系电话">{shareRec.phone}</Descriptions.Item>}
                  {(shareRec.province || shareRec.city || shareRec.district) && (
                    <Descriptions.Item label="地区">
                      {[shareRec.province, shareRec.city, shareRec.district].filter(Boolean).join(' / ')}
                    </Descriptions.Item>
                  )}
                  {shareRec.addressDetail && <Descriptions.Item label="详细地址" span={2}>{shareRec.addressDetail}</Descriptions.Item>}
                </Descriptions>
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ background: '#fff', borderRadius: 12, padding: '12px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button icon={<CopyOutlined />} onClick={copyAll}>复制订单文本</Button>
              {!username && (
                <span style={{ color: '#fa8c16', fontSize: 13 }}>
                  请先登录供应商账号再生成订单
                </span>
              )}
              {username && (
                <Button type="primary" icon={<CheckCircleOutlined />} loading={creating} onClick={createOrderNow}>
                  一键生成订单
                </Button>
              )}
            </div>

            {/* 商品明细 */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 12, color: PRIMARY, fontSize: 15 }}>
                <FileTextOutlined style={{ marginRight: 6 }} />商品明细（{(shareRec.items || []).length} 种）
              </div>
              {(shareRec.items || []).length === 0 ? (
                <Empty description="该购物车为空" />
              ) : (
                <Row gutter={[0, 12]}>
                  {shareRec.items.map((i: any, idx: number) => {
                    const imgSrc = i.image || imgOf(i);
                    return (
                      <Col key={`${i.key}-${idx}`} span={24}>
                        <div style={{ display: 'flex', gap: 16, padding: '12px 8px', borderBottom: '1px solid #f0f0f0', alignItems: 'center' }}>
                          <div style={{ width: 90, height: 90, background: '#f5f5f5', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                            {imgSrc ? (
                              <img src={imgSrc} alt={i.shortName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ShopOutlined style={{ fontSize: 32, color: '#d9d9d9' }} />
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 4 }}>
                              {i.shortName || '—'}
                            </div>
                            <div style={{ marginBottom: 6 }}>
                              <Tag color="blue" style={{ fontSize: 12 }}>款号：{i.styleCode || '—'}</Tag>
                              <Tag color="default" style={{ fontSize: 12 }}>规格：{i.unit || '件'}</Tag>
                            </div>
                            <div style={{ fontSize: 12, color: '#999' }}>{i.supplierName || i.publisherCompany || '—'}</div>
                          </div>
                          <div style={{ width: 120, textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: '#999' }}>单价</div>
                            <div style={{ color: '#f5222d', fontWeight: 600, fontSize: 16 }}>¥{Number(i.price) || 0}</div>
                          </div>
                          <div style={{ width: 100, textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: '#999' }}>数量</div>
                            <div style={{ fontWeight: 700, fontSize: 18 }}>×{Number(i.qty) || 0}</div>
                          </div>
                          <div style={{ width: 130, textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: '#999' }}>小计</div>
                            <div style={{ color: '#f5222d', fontWeight: 700, fontSize: 18 }}>
                              ¥{((Number(i.price) || 0) * (Number(i.qty) || 0)).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </Col>
                    );
                  })}
                </Row>
              )}
              {/* 合计行 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 8px 0', borderTop: '2px solid #f5222d', marginTop: 12 }}>
                <span style={{ fontSize: 14, color: '#333' }}>合计：</span>
                <span style={{ fontSize: 14 }}>共 {totalQty} 件</span>
                <span style={{ color: '#f5222d', fontWeight: 700, fontSize: 22 }}>¥{totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 24 }}>
              讯能手 ERP · 购物车分享订单页（此页面无需登录即可查看，登录后可一键生成订单）
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SharedCartPage;