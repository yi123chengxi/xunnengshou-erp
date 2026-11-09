/**
 * 退货登记落库工具（供应商账单明细 / 采购商采购账单 双端共用）
 *
 * - buildSupplierReturnRow：供应商平台「账单明细」的负数退货行（_manual 行，重建账单时保留）；
 * - buildPurchaserReturnBill：采购商平台「采购账单」的负数退货单（billSource=退货登记）；
 * - writeReturnStockFlows：库存联动 —— 供应商侧退货仓入库（purchase_receiving_）、采购商侧退货出库（inventory_outbound_），
 *   并经 updateProductStock 同步实际库存与库存变化日志；按退货单号幂等，重复登记不重复写流水。
 */
import { updateProductStock } from './stockUtils';
import { appendRowsToRemoteKey } from './serverSync';
import type { ReturnRegisterPayload } from '../components/ReturnRegisterModal';

/** 按公司名称反查注册账号 username（registeredUsers 全量账号池） */
export const resolveUsernameByCompany = (companyName: string): string => {
  const name = String(companyName || '').trim();
  if (!name) return '';
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => String(x?.companyName || '').trim() === name);
    return u?.username || '';
  } catch { return ''; }
};

/** 当前数据归属账号的公司名称 */
export const getOwnCompanyName = (owner: string): string => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x?.username === owner);
    return u?.companyName || owner;
  } catch { return owner; }
};

const readList = (key: string): any[] => {
  try { const l = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
};

const negSupplierItems = (p: ReturnRegisterPayload) => p.items.map(it => ({
  productCode: it.productCode,
  productName: it.productName || '',
  color: it.color || '',
  spec: it.spec || '',
  quantity: -it.quantity,
  price: it.unitPrice,
  amount: -Math.round(it.quantity * it.unitPrice * 100) / 100,
}));

const negPurchaserItems = (p: ReturnRegisterPayload) => p.items.map(it => ({
  styleCode: String(it.productCode || '').split('-')[0],
  productCode: it.productCode,
  productName: it.productName || '',
  color: it.color || '',
  spec: it.spec || '',
  quantity: -it.quantity,
  unitPrice: it.unitPrice,
  amount: -Math.round(it.quantity * it.unitPrice * 100) / 100,
  productType: '',
}));

/** 供应商平台账单明细退货行（_manual 保留行：订单重建账单时不丢失） */
export const buildSupplierReturnRow = (p: ReturnRegisterPayload, opts: { customerName: string; counterpartyUsername: string; now: string }) => ({
  key: `bill-${p.returnNo}`,
  id: p.returnNo,
  _manual: true,
  outboundNo: p.returnNo,
  docType: 'return',
  returnNo: p.returnNo,
  linkedOutboundNo: p.linkedOutboundNo,
  returnReason: p.reason,
  customerName: opts.customerName,
  counterpartyUsername: opts.counterpartyUsername,
  outboundDate: p.date,
  createdAt: opts.now,
  totalCount: -p.totalQty,
  productDetail: p.items.map(it => `${it.productCode}×-${it.quantity}`).join('，'),
  totalAmount: -p.totalAmount,
  paidAmount: 0,
  billSource: '退货登记',
  orderStatus: '',
  reconResult: '待对账',
  diffDesc: '',
  supplierReconPerson: '',
  purchaserReconPerson: '',
  confirmTime: '',
  items: negSupplierItems(p),
});

/** 采购商平台采购账单退货单（负数账单，参与发起对账/会计分录冲抵） */
export const buildPurchaserReturnBill = (p: ReturnRegisterPayload, opts: { operator: string; supplierName: string; now: string }, billLog?: any) => ({
  key: `bill-${p.returnNo}`,
  outboundNo: p.returnNo,
  prefix: 'RT',
  supplier: opts.supplierName,
  date: p.date,
  items: negPurchaserItems(p),
  images: [],
  recorder: opts.operator,
  totalQty: -p.totalQty,
  totalAmount: -p.totalAmount,
  reconcileResult: '',
  diffNote: '',
  supplierReconciler: '',
  purchaserReconciler: '',
  supplierImages: [],
  purchaserImages: [],
  createdAt: opts.now,
  billSource: '退货登记',
  docType: 'return',
  returnNo: p.returnNo,
  linkedOutboundNo: p.linkedOutboundNo,
  returnReason: p.reason,
  billLog,
});

/** 库存联动：供应商退货仓入库 + 采购商退货出库（按退货单号幂等） */
export const writeReturnStockFlows = (p: ReturnRegisterPayload, opts: {
  supplierOwner: string; purchaserOwner: string; operator: string;
  supplierCompanyName: string; purchaserCompanyName: string;
}): void => {
  const now = new Date().toLocaleString('zh-CN');
  const readProducts = (owner: string) => readList(`pageData_basic-data_product-list_${owner}`);
  // 供应商侧：退货仓入库（purchase_receiving_ 流水 + 实际库存增加）
  if (opts.supplierOwner) {
    const recvKey = `purchase_receiving_${opts.supplierOwner}`;
    const recv = readList(recvKey);
    if (!recv.some((r: any) => r.key === p.returnNo || r.docNo === p.returnNo)) {
      const prods = readProducts(opts.supplierOwner);
      p.items.forEach(it => {
        const prod = prods.find((x: any) => x.productCode === it.productCode);
        const before = Number(prod?.actualStock) || 0;
        updateProductStock(it.productCode, before + it.quantity, {
          type: '入库', changeQty: it.quantity, beforeStock: before,
          relatedDocNo: p.returnNo, operator: opts.operator, remark: '退货入库（退货仓）',
        }, opts.supplierOwner);
      });
      void appendRowsToRemoteKey(recvKey, [{
        key: p.returnNo, docNo: p.returnNo, type: '退货入库', supplierName: opts.purchaserCompanyName,
        items: p.items.map(it => ({ productCode: it.productCode, productName: it.productName || '', unit: '', spec: it.spec || '', quantity: it.quantity, price: it.unitPrice, remark: '退货入库' })),
        operator: opts.operator, createTime: now, status: '已入库',
        remark: `退货入库（退货仓）${p.linkedOutboundNo ? ` 原单 ${p.linkedOutboundNo}` : ''}${p.reason ? ` 原因：${p.reason}` : ''}`,
      }], (r: any) => String(r?.key || r?.docNo || ''));
    }
  }
  // 采购商侧：退货出库（inventory_outbound_ 流水 + 实际库存扣减）
  if (opts.purchaserOwner) {
    const outKey = `inventory_outbound_${opts.purchaserOwner}`;
    const out = readList(outKey);
    if (!out.some((r: any) => r.key === p.returnNo || r.docNo === p.returnNo)) {
      const prods = readProducts(opts.purchaserOwner);
      p.items.forEach(it => {
        const prod = prods.find((x: any) => x.productCode === it.productCode);
        const before = Number(prod?.actualStock) || 0;
        updateProductStock(it.productCode, before - it.quantity, {
          type: '出库', changeQty: -it.quantity, beforeStock: before,
          relatedDocNo: p.returnNo, operator: opts.operator, remark: '退货出库至供应商',
        }, opts.purchaserOwner);
      });
      void appendRowsToRemoteKey(outKey, [{
        key: p.returnNo, docNo: p.returnNo, type: '退货出库',
        items: p.items.map(it => ({ productCode: it.productCode, productName: it.productName || '', unit: '', spec: it.spec || '', currentStock: Number(prodsFind(prods, it.productCode)) || 0, quantity: it.quantity, remark: '退货出库' })),
        operator: opts.operator, createTime: now, status: '已出库',
        remark: `退货出库至供应商 ${opts.supplierCompanyName}${p.linkedOutboundNo ? ` 原单 ${p.linkedOutboundNo}` : ''}${p.reason ? ` 原因：${p.reason}` : ''}`,
      }], (r: any) => String(r?.key || r?.docNo || ''));
    }
  }
};

const prodsFind = (prods: any[], code: string) => {
  const p = prods.find((x: any) => x.productCode === code);
  return p?.actualStock ?? 0;
};
