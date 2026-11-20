/**
 * 小程序工作台看板口径层（网页版 client/src/utils/productionStats.ts + poWorkflow.ts 的服务端移植）
 * - 数据源是同批 dataset 键（客户端 localStorage 原样同步入库），派生指标不落库，
 *   公式与网页版逐条对齐，保证手机看板与「生产管理-待生产数据统计」页永远同值
 * - 字段回退口径同样保留：生产订单实名字段 planQuantity/completedQuantity/planEnd，
 *   历史数据可能写作 planQty/doneQty/endDate；同键混入的 JG- 加工单脏行按 PO- 前缀过滤
 */
import { store } from '../database/store';

async function readRows(key: string): Promise<any[]> {
  try {
    const row = await store.getDataset(key);
    const parsed = row ? JSON.parse(row.dataset_json || '[]') : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function readJson(key: string): Promise<any> {
  try {
    const row = await store.getDataset(key);
    return row ? JSON.parse(row.dataset_json || 'null') : null;
  } catch {
    return null;
  }
}

// ===================== 日期/数值工具（与 productionStats 同名同实现） =====================
const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = (): string => dayKey(new Date());
/** 取记录日期的 YYYY-MM-DD（兼容 ISO / zh-CN 斜杠串 / 已格式化串） */
const datePart = (v: any): string => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = new Date(s.replace(/\//g, '-')).getTime();
  return Number.isNaN(t) ? '' : dayKey(new Date(t));
};
const num = (v: any): number => Number(v) || 0;
/** 本地日差（天）：b - a，入参 YYYY-MM-DD，无法解析返回 null */
const diffDays = (a: string, b: string): number | null => {
  const ta = a ? new Date(a.replace(/-/g, '/')).getTime() : NaN;
  const tb = b ? new Date(b.replace(/-/g, '/')).getTime() : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
};
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
/** 提取款式编码前缀（"8002-蓝色-35" → "8002"） */
const stylePrefix = (code: any): string => {
  const raw = String(code || '');
  const m = raw.match(/^[^-]+/);
  return m ? m[0] : raw;
};
const PO_STATUS_LABEL: Record<string, string> = {
  pending: '待排产', processing: '生产中', completed: '已完成', warning: '异常', cancelled: '已取消',
  已拆分: '已拆分', 已完工: '已完成',
};
const PO_DEFAULT_OVERDUE_DAYS = 7;

// ===================== 流程模板与工作流映射（poWorkflow 移植） =====================
/** 内置预设流程模板（网页版 WorkflowTemplatePage.INDUSTRY_TEMPLATES；租户无自存模板时回退） */
const INDUSTRY_TEMPLATES: any[] = [
  { id: 'preset-clothing', name: '服装定制', nodes: [{ name: '接单确认' }, { name: '面料采购' }, { name: '打版裁剪' }, { name: '缝制加工' }, { name: '质量检验' }, { name: '包装发货' }] },
  { id: 'preset-furniture', name: '家具定制', nodes: [{ name: '设计方案' }, { name: '材料采购' }, { name: '木工加工' }, { name: '表面处理' }, { name: '质量检验' }, { name: '物流配送' }] },
  { id: 'preset-electronics', name: '电子产品定制', nodes: [{ name: '需求确认' }, { name: 'PCB设计' }, { name: '元器件采购' }, { name: 'SMT贴片' }, { name: '组装测试' }, { name: '质检包装' }] },
  { id: 'preset-system', name: '系统默认流程', nodes: [{ name: '接单审核' }, { name: '物料准备' }, { name: '生产加工' }, { name: '质量检测' }, { name: '包装发货' }] },
];

interface WfData { templates: any[]; defaultTemplateId: string }

async function loadPoTemplates(owner: string): Promise<WfData> {
  const tpls = await readRows(`pageData_production_custom-order-templates_${owner}`);
  const effective = tpls.length > 0 ? tpls : INDUSTRY_TEMPLATES;
  // 默认模板键是客户端裸字符串键（同步后为 JSON 字符串），解析失败时按同规则兜底
  let defaultId = '';
  try {
    const raw = await store.getDataset(`pageData_production_custom-order-default_${owner}`);
    const parsed = raw ? JSON.parse(raw.dataset_json || '""') : '';
    defaultId = typeof parsed === 'string' ? parsed : '';
  } catch { /* ignore */ }
  if (!defaultId || !effective.some((t: any) => t.id === defaultId)) {
    const d = effective.find((t: any) => t.id === 'preset-system') || effective.find((t: any) => t.isDefault) || effective[0];
    defaultId = d ? String(d.id) : '';
  }
  return { templates: effective, defaultTemplateId: defaultId };
}

/** 生产订单记录 → 工作流视图（poToWfOrder 的同口径子集，只取统计所需字段） */
function poToWfOrder(record: any, data: WfData): any {
  const st = String(record.status || 'pending');
  const wf = record.wf || {};
  const tpl = data.templates.find((t: any) => t.id === (wf.templateId ?? data.defaultTemplateId));
  const nodes: any[] = (Array.isArray(wf.customNodes) && wf.customNodes.length > 0)
    ? wf.customNodes
    : (tpl && Array.isArray(tpl.nodes) && tpl.nodes.length > 0 ? tpl.nodes : []);
  const fallbackStep = st === 'processing' ? 1 : 0;
  let currentStep = typeof wf.currentStep === 'number' ? wf.currentStep : fallbackStep;
  if (st === 'completed') {
    const len = nodes.length || 4;
    currentStep = currentStep >= len ? currentStep : len;
  }
  const status = typeof wf.status === 'string'
    ? wf.status
    : (st === 'completed' ? 'COMPLETED' : st === 'warning' ? 'ABNORMAL' : 'IN_PROGRESS');
  return {
    currentStep, status, nodes,
    records: Array.isArray(wf.records) ? wf.records : [],
    createdAt: wf.createdAt || record.createTime || new Date().toISOString(),
  };
}
function poNodesOf(order: any, templates: any[]): any[] {
  if (Array.isArray(order.customNodes) && order.customNodes.length > 0) return order.customNodes;
  if (Array.isArray(order.nodes) && order.nodes.length > 0) return order.nodes;
  const tpl: any = templates.find((t: any) => t.id === order.templateId);
  return tpl && Array.isArray(tpl.nodes) && tpl.nodes.length > 0 ? tpl.nodes : [];
}
/** 当前节点停留情况：起点=上一节点推进记录时间，首节点=创建时间；已完成返回 null */
function poNodeStay(order: any, nodes: any[]): { index: number; name: string; actualDays: number; estimatedDays: number } | null {
  if (order.status === 'COMPLETED') return null;
  const i = typeof order.currentStep === 'number' ? order.currentStep : 0;
  const node = nodes[i];
  if (!node) return null;
  let start: number;
  if (i === 0) start = new Date(order.createdAt).getTime() || Date.now();
  else {
    const prev = (order.records || []).filter((r: any) => r.stepIndex === i - 1);
    start = prev.length > 0
      ? (new Date(prev[prev.length - 1].createdAt).getTime() || new Date(order.createdAt).getTime())
      : (new Date(order.createdAt).getTime() || Date.now());
  }
  return { index: i, name: node.name || `节点${i + 1}`, actualDays: (Date.now() - start) / 86400000, estimatedDays: Number(node.estimatedDays) || 0 };
}
/** 订单创建时间戳：兼容 ISO / toLocaleString('zh-CN') 斜杠串 / 纯日期串 */
function poCreatedTs(record: any): number {
  for (const v of [record?.createTime, record?.createdAt, record?.wf?.createdAt, record?.date, record?.orderDate]) {
    if (!v) continue;
    const t = new Date(String(v)).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return NaN;
}
const dayStart = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
/** 已用时（天）：创建日 → 今日的自然日差，当天创建为 0 */
function poElapsedDays(record: any): number {
  const ts = poCreatedTs(record);
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000));
}
function poEstimatedTotalDays(record: any, data: WfData): number {
  const order = poToWfOrder(record, data);
  return poNodesOf(order, data.templates).reduce((s: number, n: any) => s + (Number(n?.estimatedDays) || 0), 0);
}
/** 订单是否已终结（完工/已拆分）：终结单不再判超期 */
function poIsFinished(record: any): boolean {
  const st = String(record?.status || '');
  return st === 'completed' || st === '已完工' || st === '已拆分' || Number(record?.progress) >= 100;
}
function poIsOverdue(record: any, data: WfData): boolean {
  if (poIsFinished(record)) return false;
  const est = poEstimatedTotalDays(record, data);
  return poElapsedDays(record) > (est > 0 ? est : PO_DEFAULT_OVERDUE_DAYS);
}

// ===================== 待生产统计快照 =====================
/** 单个生产订单统计行（内部结构：planItems/record 仅参与计算，不下发手机端） */
interface StatRow {
  key: string; id: string; record: any; status: string; statusLabel: string;
  productName: string; customerName: string; person: string; createTime: string;
  planQty: number; doneQty: number; pendingQty: number; progress: number;
  scheduledQty: number; remainScheduleQty: number; deferred: boolean;
  elapsedDays: number; estDays: number; limitDays: number; overdue: boolean; overDays: number;
  planEnd: string; dueInDays: number | null;
  hasCgsq: boolean; hasJg: boolean; jgTotal: number; jgDone: number;
  jgOpenQty: number; jgOpenAmount: number; cgsqOpenCount: number;
  nodeIndex: number; nodeName: string; nodeStayDays: number; nodeEstDays: number; nodeOverDays: number;
  moldCodes: string; completed: boolean; completedAt: string; cycleDays: number | null;
}

/** 待生产数据统计主入口：公式与 loadProductionSnapshot 一一对应 */
export async function loadPendingStats(owner: string): Promise<any> {
  const wfData = await loadPoTemplates(owner);
  const [rawOrders, jgRows, cgsqRows, schedules, lineRows, deferredRows, prodIn, products, capacityRaw] = await Promise.all([
    readRows(`pageData_production_production-order_${owner}`),
    readRows(`pageData_production_processing-order_${owner}`),
    readRows(`pageData_production_purchase-requisition_${owner}`),
    readRows(`pageData_production_production-schedule_${owner}`),
    readRows(`production_schedule_lines_${owner}`),
    readRows(`sb_deferred_${owner}`),
    readRows(`pageData_inventory_prod-in-stats_${owner}`),
    readRows(`pageData_basic-data_product-list_${owner}`),
    readJson(`production_line_capacity_${owner}`),
  ]);
  const lines: string[] = Array.isArray(lineRows) && lineRows.length ? lineRows.map(String) : ['生产线1', '生产线2', '生产线3'];
  const capacityMap: Record<string, number> = capacityRaw && typeof capacityRaw === 'object' && !Array.isArray(capacityRaw) ? capacityRaw : {};
  const deferredIds = new Set(deferredRows.map((v: any) => String(typeof v === 'object' && v !== null ? (v.id || v.value || '') : v)));

  const scheduledByPo = new Map<string, number>();
  schedules.forEach((s: any) => {
    const k = String(s.productionOrderId || '');
    if (!k) return;
    scheduledByPo.set(k, (scheduledByPo.get(k) || 0) + num(s.planQty));
  });
  const groupByPo = (rows: any[]): Map<string, any[]> => {
    const m = new Map<string, any[]>();
    rows.forEach((r: any) => {
      const k = String(r.poId || '');
      if (!k) return;
      const l = m.get(k) || [];
      l.push(r);
      m.set(k, l);
    });
    return m;
  };
  const cgsqByPo = groupByPo(cgsqRows);
  const jgByPo = groupByPo(jgRows);
  const moldMap = new Map<string, string>();
  products.forEach((p: any) => {
    const mold = p.moldCode || '';
    if (!mold) return;
    [p.productCode, p.productName, p.shortName].forEach((k: any) => { if (k && !moldMap.has(String(k))) moldMap.set(String(k), mold); });
  });
  const inboundByPo = new Map<string, string>();
  prodIn.forEach((r: any) => {
    const k = String(r.woNo || '');
    if (!k) return;
    const d = datePart(r.date || r.createTime);
    if (d && d > (inboundByPo.get(k) || '')) inboundByPo.set(k, d);
  });

  const rows: StatRow[] = rawOrders
    .filter((o: any) => String(o.id || '').toUpperCase().startsWith('PO-'))
    .map((o: any): StatRow => {
      const wfOrder = poToWfOrder(o, wfData);
      const nodes = poNodesOf(wfOrder, wfData.templates);
      const stay = poNodeStay(wfOrder, nodes);
      const planItems: any[] = Array.isArray(o.planItems) ? o.planItems : [];
      const plan = planItems.length > 0
        ? planItems.reduce((s: number, it: any) => s + num(it.productionQty ?? it.quantity), 0)
        : num(o.planQuantity ?? o.planQty);
      const done = num(o.completedQuantity ?? o.doneQty);
      const scheduled = scheduledByPo.get(String(o.id)) || 0;
      const estDays = poEstimatedTotalDays(o, wfData);
      const limitDays = estDays > 0 ? estDays : PO_DEFAULT_OVERDUE_DAYS;
      const elapsed = poElapsedDays(o);
      const endStr = datePart(o.planEnd ?? o.endDate);
      const createdTs = poCreatedTs(o);
      const jgs = jgByPo.get(String(o.id)) || [];
      const cgsqs = (cgsqByPo.get(String(o.id)) || []).filter((r: any) => r.status === '待采购' || !r.status);
      const jgOpen = jgs.filter((r: any) => r.status !== '已完成' && r.status !== '已拆分');
      const moldSet = new Set<string>();
      planItems.forEach((it: any) => {
        const mold = moldMap.get(String(it.productCode || '')) || moldMap.get(String(it.productName || '')) || '';
        if (mold) moldSet.add(mold);
      });
      // 已拆分：数量已转至子单，不算本单完工（与网页版同口径，否则完工率/平均周期虚高）
      const isSplit = String(o.status || '') === '已拆分';
      const completed = poIsFinished(o) && !isSplit;
      // 完工日期回退只取记录自身的更新时间：wf.updatedAt 缺失时会被填成当前时间，不能当完工日
      const completedAt = inboundByPo.get(String(o.id))
        || (completed ? datePart(o.updateTime || o.wf?.updatedAt || '') : '');
      const cycleDays = completedAt && !Number.isNaN(createdTs) ? diffDays(datePart(o.createTime || o.createdAt), completedAt) : null;
      const overdue = poIsOverdue(o, wfData);
      return {
        key: String(o.key || o.id), id: String(o.id || ''), record: o,
        status: String(o.status || 'pending'),
        statusLabel: PO_STATUS_LABEL[String(o.status)] || String(o.statusLabel || o.status || '待排产'),
        productName: o.productName || '', customerName: o.customerName || '', person: o.person || '',
        createTime: String(o.createTime || o.createdAt || ''),
        planQty: plan, doneQty: done, pendingQty: Math.max(0, plan - done),
        progress: plan > 0 ? Math.min(100, Math.round((done / plan) * 100)) : num(o.progress),
        scheduledQty: scheduled, remainScheduleQty: Math.max(0, plan - scheduled),
        deferred: deferredIds.has(String(o.id)),
        elapsedDays: elapsed, estDays, limitDays, overdue, overDays: overdue ? elapsed - limitDays : 0,
        planEnd: endStr, dueInDays: endStr && !poIsFinished(o) ? diffDays(todayKey(), endStr) : null,
        hasCgsq: (cgsqByPo.get(String(o.id)) || []).length > 0, hasJg: jgs.length > 0,
        jgTotal: jgs.length, jgDone: jgs.filter((r: any) => r.status === '已完成').length,
        jgOpenQty: jgOpen.reduce((s: number, r: any) => s + num(r.totalQty), 0),
        jgOpenAmount: jgOpen.reduce((s: number, r: any) => s + num(r.subtotal), 0),
        cgsqOpenCount: cgsqs.length,
        nodeIndex: stay ? stay.index : num(wfOrder.currentStep),
        nodeName: stay ? stay.name : (nodes[Math.min(wfOrder.currentStep, Math.max(0, nodes.length - 1))]?.name || ''),
        nodeStayDays: stay ? stay.actualDays : 0,
        nodeEstDays: stay ? stay.estimatedDays : 0,
        nodeOverDays: stay && stay.estimatedDays > 0 && stay.actualDays > stay.estimatedDays ? Math.ceil(stay.actualDays - stay.estimatedDays) : 0,
        moldCodes: Array.from(moldSet).join('、'),
        completed, completedAt, cycleDays,
      };
    });

  const pool = rows.filter(r => !poIsFinished(r.record) && r.status !== 'cancelled' && r.pendingQty > 0);
  const poolIds = new Set(pool.map(r => r.id));
  const sum = (list: StatRow[], f: (r: StatRow) => number) => list.reduce((s, r) => s + f(r), 0);

  const totals = {
    allCount: rows.length, poolCount: pool.length,
    pendingCount: pool.filter(r => r.status === 'pending').length,
    processingCount: pool.filter(r => r.status === 'processing').length,
    warningCount: pool.filter(r => r.status === 'warning').length,
    doneCount: rows.filter(r => r.completed).length,
    poolQty: sum(pool, r => r.pendingQty),
    planQty: sum(pool, r => r.planQty),
    doneQty: sum(pool, r => r.doneQty),
    planQtyAll: sum(rows, r => r.planQty),
    scheduledQty: sum(pool, r => Math.min(r.planQty, r.scheduledQty)),
    unscheduledQty: sum(pool, r => r.remainScheduleQty),
    unscheduledCount: pool.filter(r => r.remainScheduleQty > 0).length,
    deferredCount: pool.filter(r => r.deferred).length,
    deferredQty: sum(pool.filter(r => r.deferred), r => r.remainScheduleQty),
    avgProgress: pool.length ? Math.round(sum(pool, r => r.progress) / pool.length) : 0,
  };

  const jgPoolOpen = jgRows.filter((r: any) => poolIds.has(String(r.poId || '')) && r.status !== '已完成' && r.status !== '已拆分');
  const cgsqPoolOpen = cgsqRows.filter((r: any) => poolIds.has(String(r.poId || '')) && (r.status === '待采购' || !r.status));
  const bom = {
    noCgsqCount: pool.filter(r => !r.hasCgsq).length,
    noJgCount: pool.filter(r => !r.hasJg).length,
    readyCount: pool.filter(r => r.hasCgsq && (!r.hasJg || r.jgDone === r.jgTotal)).length,
    jgTotalCount: jgRows.filter((r: any) => r.status !== '已拆分').length,
    jgDoneCount: jgRows.filter((r: any) => r.status === '已完成').length,
    jgDoneRate: (() => {
      const t = jgRows.filter((r: any) => r.status !== '已拆分').length;
      return t ? Math.round((jgRows.filter((r: any) => r.status === '已完成').length / t) * 100) : 0;
    })(),
    jgOpenCount: jgPoolOpen.length,
    jgOpenQty: jgPoolOpen.reduce((s: number, r: any) => s + num(r.totalQty), 0),
    jgOpenAmount: jgPoolOpen.reduce((s: number, r: any) => s + num(r.subtotal), 0),
    cgsqOpenCount: cgsqPoolOpen.length,
    cgsqOpenQty: cgsqPoolOpen.reduce((s: number, r: any) => s + num(r.totalQty), 0),
    blockedCount: pool.filter(r => !r.hasCgsq || !r.hasJg || r.jgDone < r.jgTotal).length,
  };

  const overdueRows = pool.filter(r => r.overdue);
  const risk = {
    overdueCount: overdueRows.length,
    overdueRate: pool.length ? Math.round((overdueRows.length / pool.length) * 100) : 0,
    avgOverDays: overdueRows.length ? Math.round(sum(overdueRows, r => r.overDays) / overdueRows.length * 10) / 10 : 0,
    maxOverDays: overdueRows.reduce((m, r) => Math.max(m, r.overDays), 0),
    nodeOverCount: pool.filter(r => r.nodeOverDays > 0).length,
    dueSoonCount: pool.filter(r => r.dueInDays !== null && r.dueInDays >= 0 && r.dueInDays <= 3).length,
    planEndPassedCount: pool.filter(r => r.dueInDays !== null && r.dueInDays < 0).length,
    noPlanEndCount: pool.filter(r => !r.planEnd).length,
  };

  const nodeMap = new Map<number, { name: string; count: number; qty: number; stay: number; est: number; over: number }>();
  pool.forEach(r => {
    const cur = nodeMap.get(r.nodeIndex) || { name: r.nodeName || `节点${r.nodeIndex + 1}`, count: 0, qty: 0, stay: 0, est: 0, over: 0 };
    cur.name = r.nodeName || cur.name;
    cur.count += 1; cur.qty += r.pendingQty; cur.stay += r.nodeStayDays;
    cur.est = Math.max(cur.est, r.nodeEstDays); cur.over += r.nodeOverDays > 0 ? 1 : 0;
    nodeMap.set(r.nodeIndex, cur);
  });
  const nodes = Array.from(nodeMap.entries()).sort((a, b) => a[0] - b[0]).map(([index, v]) => ({
    index, name: v.name, count: v.count, qty: v.qty,
    avgStayDays: v.count ? Math.round((v.stay / v.count) * 10) / 10 : 0,
    estDays: v.est, overCount: v.over,
  }));

  const dimOf = (pick: (r: StatRow) => string) => {
    const m = new Map<string, { name: string; count: number; qty: number; overdueCount: number }>();
    pool.forEach(r => {
      const k = pick(r) || '（未填写）';
      const cur = m.get(k) || { name: k, count: 0, qty: 0, overdueCount: 0 };
      cur.count += 1; cur.qty += r.pendingQty; cur.overdueCount += r.overdue ? 1 : 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.qty - a.qty);
  };
  const persons = dimOf(r => r.person);

  // 结构维度：明细数量按计划口径，部分完工的单按待产比例折算，未填归入「（未填写）」兜底桶
  const UNFILLED = '（未填写）';
  const styleMap = new Map<string, { styleCode: string; moldCode: string; qty: number; orderIds: Set<string>; colorSet: Set<string>; sizeSet: Set<string> }>();
  const colorMap = new Map<string, { name: string; qty: number; orderCount: number }>();
  const sizeMap = new Map<string, { name: string; qty: number; orderCount: number }>();
  pool.forEach(r => {
    const items: any[] = Array.isArray(r.record.planItems) ? r.record.planItems : [];
    const src = items.length ? items : [{ productCode: r.record.productCode || '', styleCode: '', color: '', spec: '', productionQty: r.planQty }];
    const ratio = r.planQty > 0 ? r.pendingQty / r.planQty : 1;
    src.forEach((it: any) => {
      const qty = Math.round(num(it.productionQty ?? it.quantity) * ratio);
      const code = stylePrefix(it.styleCode || it.productCode || r.record.productCode || '') || UNFILLED;
      const cur = styleMap.get(code) || { styleCode: code, moldCode: '', qty: 0, orderIds: new Set<string>(), colorSet: new Set<string>(), sizeSet: new Set<string>() };
      cur.qty += qty;
      cur.orderIds.add(r.id);
      const mold = moldMap.get(String(it.productCode || '')) || (code !== UNFILLED ? (moldMap.get(code) || '') : '');
      if (mold && !cur.moldCode) cur.moldCode = mold;
      if (it.color) cur.colorSet.add(String(it.color));
      const sz = it.spec || it.size || '';
      if (sz) cur.sizeSet.add(String(sz));
      styleMap.set(code, cur);
      const acc = (m: Map<string, { name: string; qty: number; orderCount: number }>, k0: string) => {
        const k = k0 || UNFILLED;
        const cur2 = m.get(k) || { name: k, qty: 0, orderCount: 0 };
        cur2.qty += qty; cur2.orderCount += 1;
        m.set(k, cur2);
      };
      acc(colorMap, String(it.color || ''));
      acc(sizeMap, String(it.spec || it.size || ''));
    });
  });
  const styles = Array.from(styleMap.values())
    .map(s => ({ styleCode: s.styleCode, moldCode: s.moldCode, qty: s.qty, orderCount: s.orderIds.size, colors: s.colorSet.size, sizes: s.sizeSet.size }))
    .sort((a, b) => b.qty - a.qty);
  const toSpec = (m: Map<string, { name: string; qty: number; orderCount: number }>) => Array.from(m.values()).sort((a, b) => b.qty - a.qty);

  // 产能负荷（未来 7 天）
  const today = new Date();
  const next7 = Array.from({ length: 7 }, (_, i) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)));
  const d14 = dayKey(new Date(today.getTime() - 13 * 86400000));
  const recent = schedules.filter((s: any) => { const d = datePart(s.startDate); return d >= d14 && d <= todayKey(); });
  const stdAvg = new Map<string, { qty: number; cells: Set<string> }>();
  schedules.forEach((s: any) => {
    const d = datePart(s.startDate);
    const ln = String(s.line || '');
    if (!ln || d < d14 || d > todayKey()) return;
    const cur = stdAvg.get(ln) || { qty: 0, cells: new Set<string>() };
    cur.qty += num(s.planQty);
    cur.cells.add(`${d}|${s.shift || ''}`);
    stdAvg.set(ln, cur);
  });
  const hasStandard = lines.some(l => num(capacityMap[l]) > 0);
  const capOf = (line: string) => {
    const std = num(capacityMap[line]);
    const cell = stdAvg.get(line);
    const avg = cell && cell.cells.size > 0 ? Math.round(cell.qty / cell.cells.size) : 0;
    return { std, avg, use: std > 0 ? std : avg };
  };
  const linesStat = lines.map(l => {
    const c = capOf(l);
    return {
      line: l, standard: c.std, avgShiftOutput: c.avg, usedCapacity: c.use,
      scheduled7: schedules.filter((s: any) => s.line === l && next7.includes(datePart(s.startDate))).reduce((s: number, x: any) => s + num(x.planQty), 0),
      capacity7: c.use * 3 * 7,
    };
  });
  const days = next7.map(d => {
    const wd = diffDays('1970-01-01', d);
    const weekCn = wd === null ? '' : WEEK_CN[(wd + 4) % 7];
    return {
      date: d, label: `${d.slice(5).replace('-', '/')} 周${weekCn}`,
      scheduled: schedules.filter((s: any) => datePart(s.startDate) === d).reduce((s: number, x: any) => s + num(x.planQty), 0),
      capacity: linesStat.reduce((s, l) => s + l.usedCapacity * 3, 0),
    };
  });
  const capacity7 = linesStat.reduce((s, l) => s + l.capacity7, 0);
  const dailyCapacity = linesStat.reduce((s, l) => s + l.usedCapacity * 3, 0);
  const recentDailyAvg = recent.reduce((s: number, x: any) => s + num(x.planQty), 0) / 14;
  const perDay = dailyCapacity > 0 ? dailyCapacity : recentDailyAvg;
  const capacity = {
    lines: linesStat, days, capacity7,
    unscheduledQty: totals.unscheduledQty,
    gap: Math.round(totals.unscheduledQty - capacity7),
    backlogDays: perDay > 0 ? Math.round((totals.unscheduledQty / perDay) * 10) / 10 : null,
    hasStandard, lineCount: lines.length,
  };

  // 完工效率（已拆分单不计入）
  const completedRows = rows.filter(r => r.completed);
  const cycles = completedRows.map(r => r.cycleDays).filter((v): v is number => v !== null);
  const cutoff = dayKey(new Date(today.getTime() - 29 * 86400000));
  const done30 = completedRows.filter(r => r.completedAt && r.completedAt >= cutoff);
  const efficiency = {
    done30Count: done30.length,
    done30Qty: sum(done30, r => r.doneQty || r.planQty),
    avgCycleDays: cycles.length ? Math.round((cycles.reduce((s, v) => s + v, 0) / cycles.length) * 10) / 10 : null,
    completeRate: rows.length ? Math.round((completedRows.length / rows.length) * 100) : 0,
    scheduleRate: totals.planQty > 0 ? Math.round((totals.scheduledQty / totals.planQty) * 100) : 0,
  };

  // 今日完工（完工日为今天的真实完工单）：工作台「今日生产数量」指标
  const td = todayKey();
  const doneToday = completedRows.filter(r => r.completedAt === td);

  // 下发精简明细：待生产池按待生产数量降序取前 20，另附超期 Top 10
  const brief = (r: StatRow) => ({
    id: r.id, productName: r.productName, customerName: r.customerName, statusLabel: r.statusLabel,
    nodeName: r.nodeName, pendingQty: r.pendingQty, remainScheduleQty: r.remainScheduleQty,
    progress: r.progress, elapsedDays: r.elapsedDays, limitDays: r.limitDays, overdue: r.overdue,
    planEnd: r.planEnd, hasCgsq: r.hasCgsq, jgDone: r.jgDone, jgTotal: r.jgTotal, person: r.person,
  });
  const poolSorted = [...pool].sort((a, b) => b.pendingQty - a.pendingQty);

  return {
    generatedAt: new Date().toLocaleString('zh-CN'),
    totals, bom, risk, nodes,
    persons: persons.slice(0, 12),
    styles: styles.slice(0, 10),
    colors: toSpec(colorMap).slice(0, 12),
    sizes: toSpec(sizeMap).slice(0, 12),
    capacity, efficiency,
    doneTodayQty: sum(doneToday, r => r.doneQty || r.planQty),
    doneTodayCount: doneToday.length,
    poolTop: poolSorted.slice(0, 20).map(brief),
    overdueTop: overdueRows.sort((a, b) => b.overDays - a.overDays).slice(0, 10).map(brief),
  };
}

// ===================== 销售 / 银行流水指标 =====================
/** 订单是否「已付款完成」：已付款/已发货/已完成（发货与完成都算），部分付款需已收金额结清 */
const PAID_STATUSES = ['已付款', '已发货', '已完成'];
function isPaidOrder(r: any): boolean {
  const st = String(r.orderStatus || '').trim();
  if (st === '已取消' || st === '待付款') return false;
  if (PAID_STATUSES.includes(st)) return true;
  if (st === '部分付款') {
    const total = num(r.productAmount ?? r.totalAmount ?? r.amount);
    return total > 0 && num(r.paidAmount) + 0.01 >= total;
  }
  // 历史手工单可能没有中文状态：按付款时间 + 已收金额推断（与网页版首页销售额口径一致）
  return !!r.payTime && num(r.paidAmount) > 0;
}
const orderAmountOf = (r: any): number => num(r.productAmount ?? r.totalAmount ?? r.amount);
const orderQtyOf = (r: any): number => {
  if (Array.isArray(r.orderItems)) return r.orderItems.reduce((s: number, it: any) => s + num(it.quantity), 0);
  if (typeof r.orderItems === 'string' && r.orderItems.trim().startsWith('[')) {
    try { return (JSON.parse(r.orderItems) || []).reduce((s: number, it: any) => s + num(it.quantity), 0); } catch { /* fallthrough */ }
  }
  return num(r.palletCount ?? r.totalQty);
};

/** 销售指标：今日/本月「新增且已付款完成」的订单数、件数、金额（口径含已发货/已完成） */
export async function loadSalesMetrics(owner: string): Promise<any> {
  const rows = await readRows(`pageData_sales_order-manage_${owner}`);
  const ymd = todayKey();
  const ym = ymd.slice(0, 7);
  const acc = (f: (r: any) => boolean) => {
    const hit = rows.filter((r: any) => f(r) && isPaidOrder(r));
    return {
      count: hit.length,
      qty: hit.reduce((s: number, r: any) => s + orderQtyOf(r), 0),
      amount: Math.round(hit.reduce((s: number, r: any) => s + orderAmountOf(r), 0) * 100) / 100,
    };
  };
  const dayOf = (r: any) => datePart(r.createTime || r.createdAt || r.date || '');
  return {
    today: acc(r => dayOf(r) === ymd),
    month: acc(r => dayOf(r).slice(0, 7) === ym),
    allCount: rows.length,
  };
}

/** 银行流水指标：今日/本月收入与支出合计、账户余额合计（口径同银行账户页「交易流水」页签） */
export async function loadBankMetrics(owner: string): Promise<any> {
  const rows = await readRows(`pageData_finance_bank-account_${owner}`);
  const ymd = todayKey();
  const ym = ymd.slice(0, 7);
  let todayIn = 0; let todayOut = 0; let monthIn = 0; let monthOut = 0;
  rows.forEach((acc: any) => {
    const txns = Array.isArray(acc.transactions) ? acc.transactions : [];
    txns.forEach((t: any) => {
      const d = datePart(t.time || t.date || '');
      if (!d) return;
      const isIn = t.type === 'in' || t.type === '收入' || t.type === 'income';
      const amt = num(t.amount);
      if (d === ymd) { if (isIn) todayIn += amt; else todayOut += amt; }
      if (d.slice(0, 7) === ym) { if (isIn) monthIn += amt; else monthOut += amt; }
    });
  });
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    todayIncome: round(todayIn), todayExpense: round(todayOut),
    monthIncome: round(monthIn), monthExpense: round(monthOut),
    balanceTotal: round(rows.reduce((s: number, r: any) => s + num(r.balance), 0)),
    accountCount: rows.length,
  };
}
