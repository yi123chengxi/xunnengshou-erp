/**
 * 订单占用数工具：未发货订单（已付款/已审核待生产/已审核待财审/已审核待发货等）
 * 按商品编码汇总占用数量，并回写商品列表的 orderReserved 字段
 */
import { useEffect, useState } from 'react';
import { readProductListSync, writeProductList } from './dataStore';
import { buildCredIndex } from './nameSync';

export const ORDER_OCCUPY_EXCLUDE = ['待付款', '已发货', '已完成', '已取消'];

const orderKeyOf = (owner: string) => `pageData_sales_order-manage_${owner}`;

/** 读取订单快照（异常/非数组一律回空） */
const readOrders = (owner: string): any[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(orderKeyOf(owner)) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

/**
 * 订单是否处于占用态（未发货完成）。
 * 取消订单仅把 auditStatus 置为「已取消」而不改 orderStatus，旧判据只看 orderStatus
 * 会让已取消订单继续占用额度/库存数量（表现为占用值与明细对不上）；
 * orderStatus 为空串的脏行同样不计入，保持与既有排除口径一致。
 */
export const isOccupyingOrder = (o: any): boolean => {
  if (!o) return false;
  if (String(o.auditStatus || '').trim() === '已取消') return false;
  const st = String(o.orderStatus || '').trim();
  if (!st || ORDER_OCCUPY_EXCLUDE.includes(st)) return false;
  return true;
};

/**
 * 订单编号取号：取「全部已知 MC 号」的最大值 +1（MC000001 起）。
 * 取号集合必须含全量落盘数据：只按过滤/分页后的列表取号会取到重号，
 * 而 MC 号是订单主键（对账/回写/合并均按它查找），重号会直接串改他单数据。
 */
export const nextOrderIdFrom = (ids: any[]): string => {
  let maxNum = 0;
  (Array.isArray(ids) ? ids : []).forEach((raw: any) => {
    const m = /^MC(\d+)$/.exec(String(raw === undefined || raw === null ? '' : raw));
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return `MC${String(maxNum + 1).padStart(6, '0')}`;
};

/** 取号用的订单号集合：当前列表 id + 全量落盘订单 id */
export const collectOrderIdsForAlloc = (owner: string, listIds: any[] = []): string[] => {
  const ids: string[] = [];
  (Array.isArray(listIds) ? listIds : []).forEach((v: any) => ids.push(String(v === undefined || v === null ? '' : v)));
  readOrders(owner).forEach((r: any) => ids.push(String(r?.id ?? '')));
  return ids;
};

/** 余额支付判定（付款方式字段或订单标签含「余额支付」），只有余额支付才占用额度 */
export const isBalancePayOrder = (o: any): boolean =>
  String(o?.payMethod || '').trim() === '余额支付'
  || String(o?.orderTags || '').includes('余额支付')
  || String(o?.orderTag || '').includes('余额支付');

/** 订单快照是否已落地（键不存在=未加载，此时汇总结果为 0 不可信，调用方应保留上一次值或不渲染 0） */
export const ordersSnapshotLoaded = (owner: string): boolean => localStorage.getItem(orderKeyOf(owner)) !== null;

/** 汇总各商品编码的订单占用数量 */
export const buildOrderOccupiedMap = (owner: string, excludeOrderIds?: string[]): Record<string, number> => {
  const map: Record<string, number> = {};
  const ex = new Set(excludeOrderIds || []);
  try {
    readOrders(owner).forEach((o: any) => {
      if (!isOccupyingOrder(o)) return;
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
    // 订单快照缺失（未加载/被清理）时禁止回写：空汇总会把占用字段全量清 0，
    // 与实时汇总渲染交替出现“一会 0 一会占用数”的抖动
    if (!ordersSnapshotLoaded(owner)) return;
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

/**
 * 订单占用金额查询器（按主体身份键聚合）。
 *
 * 旧实现返回“名称→金额”的普通 map，调用方用客户档案名/列表展示名去硬查：
 * 只要订单里的名称快照与档案名不同源（改名滞后、快照名 vs 当前展示名、多余空白）就查不到 → 显示 0，
 * 而占用明细弹窗走的是身份键匹配（能查到），于是出现“有时候有数值有时候没有”的漂移。
 * 这里统一按身份键（账号 > 公司编号 > 改名链折叠名）聚合，查询侧同键归一，
 * 与明细弹窗、采购总额快照完全同源。
 */
export const createOccupiedAmountResolver = (owner: string): {
  /** 按一个或多个候选名称取占用金额：同一主体多别名只计一次，不同主体（多账号同名歧义）相加 */
  of: (...names: any[]) => number;
  /** 快照是否已加载：未加载时 of() 返回的 0 不可信，调用方应保留上一次值 */
  loaded: boolean;
} => {
  const idx = buildCredIndex();
  const byId = new Map<string, number>();
  readOrders(owner).forEach((o: any) => {
    if (!isOccupyingOrder(o) || !isBalancePayOrder(o)) return;
    const name = String(o?.customerName || '').trim();
    if (!name) return;
    const k = idx.identityOfName(name) || 'n:' + name;
    byId.set(k, Math.round(((byId.get(k) || 0) + (Number(o?.productAmount) || 0)) * 100) / 100);
  });
  const idOf = (n: any): string => {
    const s = String(n || '').trim();
    if (!s) return '';
    return idx.identityOfName(s) || 'n:' + s;
  };
  return {
    loaded: ordersSnapshotLoaded(owner),
    of: (...names: any[]) => {
      const seen = new Set<string>();
      let sum = 0;
      names.forEach(n => {
        const k = idOf(n);
        if (!k || seen.has(k)) return; // 同一主体的旧名/新名/快照名只计一次
        seen.add(k);
        sum += byId.get(k) || 0;
      });
      return Math.round(sum * 100) / 100;
    },
  };
};

/** 读取某客户占用中的订单明细列表（未发货的余额支付订单） */
export const getOrderOccupiedList = (owner: string, customerName: string): {
  orderId: string; orderStatus: string; amount: number; orderSource: string; payMethod: string; createTime: string;
}[] => {
  const rows: { orderId: string; orderStatus: string; amount: number; orderSource: string; payMethod: string; createTime: string }[] = [];
  const name = String(customerName || '').trim();
  if (!name) return rows;
  try {
    const idx = buildCredIndex();
    readOrders(owner).forEach((o: any) => {
      if (!isOccupyingOrder(o) || !isBalancePayOrder(o)) return;
      const rn = String(o?.customerName || '').trim();
      if (!idx.isSameParty(rn, name)) return; // 身份键归一：改名前的占用订单也列入当前客户明细
      rows.push({
        orderId: o.id || '',
        orderStatus: String(o.orderStatus || ''),
        amount: Number(o?.productAmount) || 0,
        orderSource: String(o?.orderSource || '') || '手工新增',
        payMethod: String(o?.payMethod || '') || '-',
        createTime: o.createTime || '',
      });
    });
  } catch { /* ignore */ }
  return rows.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
};

/**
 * 订单占用刷新信号：同文档 keep-alive 页签不会收到 storage 事件，
 * 订单写入（发货/新增/编辑/取消）、服务端拉取落地、页签回到前台都需重新取一次，
 * 否则会出现“订单已落库但客户列表的占用值仍是旧的（多为 0）”的持续漂移。
 */
export const useOrderOccupiedVersion = (): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    const onStorage = (e: StorageEvent) => { if (e.key && e.key.indexOf('pageData_sales_order-manage_') === 0) bump(); };
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener('order-data-updated', bump);
    window.addEventListener('sync-data-updated', bump);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('order-data-updated', bump);
      window.removeEventListener('sync-data-updated', bump);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return version;
};

/** 读取某商品编码的订单占用明细（占用中的订单列表，供弹窗展示） */
export const getOrderReservedDetail = (owner: string, productCode: string): {
  orderId: string; customerName: string; orderStatus: string; quantity: number; createTime: string;
}[] => {
  const rows: { orderId: string; customerName: string; orderStatus: string; quantity: number; createTime: string }[] = [];
  if (!productCode) return rows;
  try {
    readOrders(owner).forEach((o: any) => {
      if (!isOccupyingOrder(o)) return;
      let items: any[] = [];
      try { items = typeof o.orderItems === 'string' ? JSON.parse(o.orderItems) : (o.orderItems || []); } catch { items = []; }
      const qty = (Array.isArray(items) ? items : []).reduce((s: number, it: any) => (it?.productCode === productCode ? s + (Number(it.quantity) || 0) : s), 0);
      if (qty > 0) {
        rows.push({
          orderId: o.id || '',
          customerName: o.customerName || '',
          orderStatus: String(o.orderStatus || ''),
          quantity: qty,
          createTime: o.createTime || '',
        });
      }
    });
  } catch { /* ignore */ }
  return rows.sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
};
