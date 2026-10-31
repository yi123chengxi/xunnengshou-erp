/**
 * 账单明细导出共享工具（采购商「采购账单」与供应商「账单明细」同口径复用）：
 * - 按商品编码：每条明细一行，携带账单级全部字段与明细级全部字段；
 * - 按款式编码：以日期+款式编码汇总并按单据号分组（同一单据内同款式汇总一行；不同单据/不同日期分行），单价=金额/数量（平均价），不含商品编码字段；
 * - 两种模式各自的导出字段可配置（loadExportFieldCfg/saveExportFieldCfg + BillExportFieldModal），未配置时默认全字段；
 * 导出为带 BOM 的 CSV（Excel 直接打开不乱码）。
 */
export interface BillItemExportRow {
  billNo: string;
  date: string;
  counterparty: string;
  styleCode: string;
  productCode: string;
  quantity: number;
  price: number;
  amount: number;
  // 账单级字段（可选：两平台字段名差异由调用方映射）
  auxDocNo?: string;          // 辅助单据号（采购商）
  billSource?: string;        // 账单来源（供应商）
  orderStatus?: string;       // 订单状态（供应商）
  reconResult?: string;       // 对账结果
  diffDesc?: string;          // 差异说明
  supplierReconPerson?: string;  // 供应商对账人
  purchaserReconPerson?: string; // 采购商对账人
  totalCount?: number;        // 账单商品总数
  totalAmount?: number;       // 账单商品总额
  // 明细级字段
  productName?: string;       // 商品名称/简称
  color?: string;             // 颜色
  spec?: string;              // 规格
  productType?: string;       // 商品类型
}

export type BillExportMode = 'product' | 'style';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const normDate = (d: string) => (d || '').slice(0, 10).replace(/\//g, '-');

// 导出字段定义（key=数据键，label=CSV 表头；顺序即导出列顺序）
export const PRODUCT_EXPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'billNo', label: '出库单号' },
  { key: 'date', label: '日期' },
  { key: 'counterparty', label: '对方' },
  { key: 'auxDocNo', label: '辅助单据号' },
  { key: 'billSource', label: '账单来源' },
  { key: 'orderStatus', label: '订单状态' },
  { key: 'reconResult', label: '对账结果' },
  { key: 'diffDesc', label: '差异说明' },
  { key: 'supplierReconPerson', label: '供应商对账人' },
  { key: 'purchaserReconPerson', label: '采购商对账人' },
  { key: 'totalCount', label: '账单商品总数' },
  { key: 'totalAmount', label: '账单商品总额' },
  { key: 'styleCode', label: '款式编码' },
  { key: 'productCode', label: '商品编码' },
  { key: 'productName', label: '商品名称' },
  { key: 'color', label: '颜色' },
  { key: 'spec', label: '规格' },
  { key: 'productType', label: '商品类型' },
  { key: 'quantity', label: '数量' },
  { key: 'price', label: '单价' },
  { key: 'amount', label: '金额' },
];

export const STYLE_EXPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'date', label: '日期' },
  { key: 'styleCode', label: '款式编码' },
  { key: 'quantity', label: '数量' },
  { key: 'amount', label: '金额' },
  { key: 'avgPrice', label: '平均单价' },
  { key: 'bills', label: '关联单号' },
  { key: 'counterparty', label: '对方' },
];

export const exportFieldsOf = (mode: BillExportMode) => (mode === 'product' ? PRODUCT_EXPORT_FIELDS : STYLE_EXPORT_FIELDS);

/** 从“款式-颜色-规格”形商品编码解析颜色/规格（如 7508-黑色-39 → 黑色 / 39） */
export const parseColorSpecFromCode = (code: string): { color: string; spec: string } => {
  const parts = String(code || '').trim().split('-');
  if (parts.length < 3) return { color: '', spec: '' };
  return { color: parts.slice(1, -1).join('-'), spec: parts[parts.length - 1] };
};

/** 商品主数据索引（颜色/规格/名称回退源） */
export const loadProductMasterMap = (owner: string): Map<string, any> => {
  const map = new Map<string, any>();
  try {
    const list = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]');
    (Array.isArray(list) ? list : []).forEach((p: any) => { if (p?.productCode) map.set(String(p.productCode), p); });
  } catch { /* ignore */ }
  return map;
};

/** 导出行颜色/规格/名称解析：明细自身字段 → 商品主数据 → 编码解析（存量账单明细常缺 color/spec，避免导出空白列） */
export const resolveItemColorSpec = (it: any, master?: Map<string, any>) => {
  const prod = master?.get(String(it?.productCode || ''));
  const parsed = parseColorSpecFromCode(it?.productCode || '');
  return {
    color: it?.color || prod?.color || parsed.color,
    spec: it?.spec || prod?.spec || parsed.spec,
    productName: it?.shortName || it?.productName || prod?.shortName || prod?.name || '',
  };
};

// ============ 导出字段配置持久化（按 页面scope + 模式 分别保存） ============
const cfgKey = (scope: string, mode: BillExportMode) => `billExportFields_${scope}_${mode}`;

/** 读取已保存的导出字段 key 列表；未配置返回 null（调用方按全字段处理） */
export const loadExportFieldCfg = (scope: string, mode: BillExportMode): string[] | null => {
  try {
    const raw = localStorage.getItem(cfgKey(scope, mode));
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch { return null; }
};

export const saveExportFieldCfg = (scope: string, mode: BillExportMode, fields: string[]) => {
  localStorage.setItem(cfgKey(scope, mode), JSON.stringify(fields));
};

/** 按导出口径构建数据行（key 化） */
export const buildBillKeyedRows = (rows: BillItemExportRow[], mode: BillExportMode): Record<string, any>[] => {
  if (mode === 'product') {
    return rows.map(r => ({
      billNo: r.billNo,
      date: normDate(r.date),
      counterparty: r.counterparty,
      auxDocNo: r.auxDocNo || '',
      billSource: r.billSource || '',
      orderStatus: r.orderStatus || '',
      reconResult: r.reconResult || '',
      diffDesc: r.diffDesc || '',
      supplierReconPerson: r.supplierReconPerson || '',
      purchaserReconPerson: r.purchaserReconPerson || '',
      totalCount: r.totalCount ?? '',
      totalAmount: r.totalAmount != null ? round2(r.totalAmount) : '',
      styleCode: r.styleCode,
      productCode: r.productCode,
      productName: r.productName || '',
      color: r.color || '',
      spec: r.spec || '',
      productType: r.productType || '',
      quantity: r.quantity,
      price: round2(r.price),
      amount: round2(r.amount),
    }));
  }
  // 按款式编码：以日期+款式编码汇总并按单据号分组（同单据内同款式汇总；不同单据/不同日期不汇总）；不含商品编码字段
  const map = new Map<string, { style: string; date: string; party: string; billNo: string; qty: number; amount: number }>();
  rows.forEach(r => {
    const style = (r.styleCode || '').trim() || '-';
    const date = normDate(r.date); // 归一到日（采购商日期可能带时分秒/斜杠分隔）
    const party = r.counterparty || '';
    const billNo = r.billNo || '';
    const k = `${date}||${party}||${billNo}||${style}`;
    const cur = map.get(k) || { style, date, party, billNo, qty: 0, amount: 0 };
    cur.qty += Number(r.quantity) || 0;
    cur.amount += Number(r.amount) || 0;
    map.set(k, cur);
  });
  return Array.from(map.values())
    .sort((a, b) => b.date.localeCompare(a.date) || a.billNo.localeCompare(b.billNo) || a.party.localeCompare(b.party) || a.style.localeCompare(b.style))
    .map(v => ({
      date: v.date,
      styleCode: v.style,
      quantity: v.qty,
      amount: round2(v.amount),
      avgPrice: v.qty ? round2(v.amount / v.qty) : 0,
      bills: v.billNo,
      counterparty: v.party,
    }));
};

/** 按字段配置把 key 行转为带中文表头的行（未传 fields 或为空=全字段） */
export const buildBillExportRows = (rows: BillItemExportRow[], mode: BillExportMode, fields?: string[] | null): Record<string, any>[] => {
  const keyed = buildBillKeyedRows(rows, mode);
  const defs = exportFieldsOf(mode);
  const sel = fields && fields.length ? defs.filter(d => fields.includes(d.key)) : defs;
  if (!sel.length) return [];
  return keyed.map(r => {
    const out: Record<string, any> = {};
    sel.forEach(d => { out[d.label] = r[d.key]; });
    return out;
  });
};

/** 生成并下载 CSV；返回导出行数（0 表示无数据） */
export const downloadBillExportCsv = (rows: BillItemExportRow[], mode: BillExportMode, filePrefix: string, fields?: string[] | null): number => {
  const data = buildBillExportRows(rows, mode, fields);
  if (!data.length) return 0;
  const headers = Object.keys(data[0]);
  const esc = (v: any) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '\uFEFF' + [headers.join(','), ...data.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const ts = new Date();
  const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filePrefix}-${mode === 'product' ? '按商品编码' : '按款式编码'}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); // 延后撤销：同步 revoke 可能导致 Chrome 尚未读取 blob 即被撤销而下载丢失
  return data.length;
};
