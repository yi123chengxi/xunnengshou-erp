/**
 * 库存变化日志工具函数
 * 共享存储键: stock_change_log_${owner}
 */

export interface StockLogEntry {
  id: string;
  productCode: string;
  productName: string;
  type: '入库' | '盘点' | '出库';
  changeQty: number;       // 入库正/出库负/盘点差值
  beforeStock: number;
  afterStock: number;
  relatedDocNo: string;
  operator: string;
  createTime: string;
  remark: string;
}

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

const getLogKey = (owner?: string): string => {
  const o = owner || getDataOwner();
  return `stock_change_log_${o}`;
};

/** 追加一条变化日志 */
export const appendStockLog = (entry: StockLogEntry, owner?: string): void => {
  const key = getLogKey(owner);
  try {
    const logs: StockLogEntry[] = JSON.parse(localStorage.getItem(key) || '[]');
    logs.unshift(entry);
    localStorage.setItem(key, JSON.stringify(logs));
  } catch { /* ignore */ }
};

/** 读取变化日志（可按商品编码过滤） */
export const getStockLogs = (productCode?: string, owner?: string): StockLogEntry[] => {
  const key = getLogKey(owner);
  try {
    const logs: StockLogEntry[] = JSON.parse(localStorage.getItem(key) || '[]');
    if (productCode) return logs.filter(l => l.productCode === productCode);
    return logs;
  } catch { return []; }
};

/** 更新商品列表 actualStock 并写日志（一步完成数据变更+日志记录） */
export const updateProductStock = (
  productCode: string,
  newStock: number,
  logMeta: {
    type: StockLogEntry['type'];
    changeQty: number;
    beforeStock: number;
    relatedDocNo: string;
    operator: string;
    remark?: string;
  },
  owner?: string,
): void => {
  const o = owner || getDataOwner();
  const productKey = `pageData_basic-data_product-list_${o}`;
  let productName = productCode;
  try {
    const list: any[] = JSON.parse(localStorage.getItem(productKey) || '[]');
    const idx = list.findIndex((p: any) => p.productCode === productCode);
    if (idx >= 0) {
      productName = list[idx].shortName || list[idx].name || productCode;
      list[idx] = { ...list[idx], actualStock: newStock };
      localStorage.setItem(productKey, JSON.stringify(list));
    }
  } catch { /* ignore */ }

  const entry: StockLogEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    productCode,
    productName,
    type: logMeta.type,
    changeQty: logMeta.changeQty,
    beforeStock: logMeta.beforeStock,
    afterStock: newStock,
    relatedDocNo: logMeta.relatedDocNo,
    operator: logMeta.operator,
    createTime: new Date().toLocaleString('zh-CN'),
    remark: logMeta.remark || '',
  };
  appendStockLog(entry, o);
};

/** 生成唯一单据号 */
export const generateDocNo = (prefix: string): string => {
  const ts = Date.now().toString().slice(-6);
  const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${ts}${rnd}`;
};
