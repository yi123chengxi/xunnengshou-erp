/**
 * 订单占用数工具：未发货订单（已付款/已审核待生产/已审核待财审/已审核待发货等）
 * 按商品编码汇总占用数量，并回写商品列表的 orderReserved 字段
 */
import { readProductListSync, writeProductList } from './dataStore';

export const ORDER_OCCUPY_EXCLUDE = ['待付款', '已发货', '已完成', '已取消'];

/** 汇总各商品编码的订单占用数量 */
export const buildOrderOccupiedMap = (owner: string, excludeOrderIds?: string[]): Record<string, number> => {
  const map: Record<string, number> = {};
  const ex = new Set(excludeOrderIds || []);
  try {
    const orders = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]');
    (Array.isArray(orders) ? orders : []).forEach((o: any) => {
      const st = String(o?.orderStatus || '');
      if (!st || ORDER_OCCUPY_EXCLUDE.includes(st)) return;
      if (o?.id && ex.has(o.id)) return;
      let items: any[] = [];
      try { items = typeof o.orderItems === 'string' ? JSON.parse(o.orderItems) : (o.orderItems || []); } catch { items = []; }
      (Array.isArray(items) ? items : []).forEach((it: any) => {
        const code = it?.productCode;
        if (!code) return;
        map[code] = (map[code] || 0) + (Number(it.quantity) || 0);
      });
    });
  } catch { /* ignore */ }
  return map;
};

/** 把订单占用数回写商品列表 orderReserved 字段（经 dataStore 通道落库，内容未变化时不写盘） */
export const syncOrderReserved = (owner: string): void => {
  try {
    const map = buildOrderOccupiedMap(owner);
    const list = readProductListSync(owner);
    if (!Array.isArray(list) || list.length === 0) return;
    let changed = false;
    const next = list.map((p: any) => {
      const occ = map[p?.productCode] || 0;
      if ((Number(p.orderReserved) || 0) !== occ) { changed = true; return { ...p, orderReserved: occ }; }
      return p;
    });
    if (changed) writeProductList(owner, next);
  } catch { /* ignore */ }
};

/** 汇总各客户的订单占用金额（未发货的余额支付订单的商品总额合计）
 * 口径：orderStatus 不在 ORDER_OCCUPY_EXCLUDE（即未发货完成）且付款方式为余额支付
 * （含采购商推送选余额支付的未发货订单 + 订单管理手工新增选余额支付的未发货订单） */
export const buildOrderOccupiedAmountMap = (owner: string): Record<string, number> => {
  const map: Record<string, number> = {};
  try {
    const orders = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]');
    (Array.isArray(orders) ? orders : []).forEach((o: any) => {
      const st = String(o?.orderStatus || '');
      if (!st || ORDER_OCCUPY_EXCLUDE.includes(st)) return; // 仅统计未发货完成
      const isBalance = o?.payMethod === '余额支付' || String(o?.orderTags || '').includes('余额支付') || String(o?.orderTag || '').includes('余额支付');
      if (!isBalance) return; // 推送与手工新增均须为余额支付才占用额度
      const name = String(o?.customerName || '').trim();
      if (!name) return;
      map[name] = Math.round(((map[name] || 0) + (Number(o?.productAmount) || 0)) * 100) / 100;
    });
  } catch { /* ignore */ }
  return map;
};

/** 读取某客户占用中的订单明细列表（未发货的采购商推送/余额支付订单） */
export const getOrderOccupiedList = (owner: string, customerName: string): {
  orderId: string; orderStatus: string; amount: number; orderSource: string; payMethod: string; createTime: string;
}[] => {
  const rows: { orderId: string; orderStatus: string; amount: number; orderSource: string; payMethod: string; createTime: string }[] = [];
  const name = String(customerName || '').trim();
  if (!name) return rows;
  try {
    const orders = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]');
    (Array.isArray(orders) ? orders : []).forEach((o: any) => {
      const st = String(o?.orderStatus || '');
      if (!st || ORDER_OCCUPY_EXCLUDE.includes(st)) return;
      const isBalance = o?.payMethod === '余额支付' || String(o?.orderTags || '').includes('余额支付') || String(o?.orderTag || '').includes('余额支付');
      if (!isBalance) return; // 推送与手工新增均须为余额支付才占用额度
      if (String(o?.customerName || '').trim() !== name) return;
      rows.push({
        orderId: o.id || '',
        orderStatus: st,
        amount: Number(o?.productAmount) || 0,
        orderSource: String(o?.orderSource || '') || '手工新增',
        payMethod: String(o?.payMethod || '') || '-',
        createTime: o.createTime || '',
      });
    });
  } catch { /* ignore */ }
  return rows.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
};

/** 读取某商品编码的订单占用明细（占用中的订单列表，供弹窗展示） */
export const getOrderReservedDetail = (owner: string, productCode: string): {
  orderId: string; customerName: string; orderStatus: string; quantity: number; createTime: string;
}[] => {
  const rows: { orderId: string; customerName: string; orderStatus: string; quantity: number; createTime: string }[] = [];
  if (!productCode) return rows;
  try {
    const orders = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]');
    (Array.isArray(orders) ? orders : []).forEach((o: any) => {
      const st = String(o?.orderStatus || '');
      if (!st || ORDER_OCCUPY_EXCLUDE.includes(st)) return;
      let items: any[] = [];
      try { items = typeof o.orderItems === 'string' ? JSON.parse(o.orderItems) : (o.orderItems || []); } catch { items = []; }
      const qty = (Array.isArray(items) ? items : []).reduce((s: number, it: any) => (it?.productCode === productCode ? s + (Number(it.quantity) || 0) : s), 0);
      if (qty > 0) {
        rows.push({
          orderId: o.id || '',
          customerName: o.customerName || '',
          orderStatus: st,
          quantity: qty,
          createTime: o.createTime || '',
        });
      }
    });
  } catch { /* ignore */ }
  return rows.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
};
