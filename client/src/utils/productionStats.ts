/**
 * 待生产数据统计共享口径层
 * - 数据源全部来自本地存储原始键（生产订单/加工订单/采购申请单/生产排期/暂不生产/生产入库/商品主数据/流程模板），
 *   派生指标不落库，统计页与排期看板按同一函数重算，避免出现两个数
 * - 字段回退口径：生产订单实名字段为 planQuantity/completedQuantity/planStart/planEnd，
 *   历史数据可能写作 planQty/doneQty/startDate/endDate，一律多字段回退取值
 */
import {
  loadPoTemplates, poToWfOrder, poNodesOf, poNodeStay, poElapsedDays, poEstimatedTotalDays,
  poIsOverdue, poIsFinished, PO_DEFAULT_OVERDUE_DAYS, poCreatedTs,
} from './poWorkflow';
import type { PoWfData } from './poWorkflow';

const readList = (key: string): any[] => {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** 生产线单班次标准产量（排期看板维护）：{ 生产线名称: 每班次可产数量 } */
export const LINE_CAPACITY_KEY = (owner: string) => `production_line_capacity_${owner}`;
export const readLineCapacity = (owner: string): Record<string, number> => {
  try { const v = JSON.parse(localStorage.getItem(LINE_CAPACITY_KEY(owner)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
export const writeLineCapacity = (owner: string, map: Record<string, number>) => {
  try { localStorage.setItem(LINE_CAPACITY_KEY(owner), JSON.stringify(map)); } catch { /* ignore */ }
};

export const SHIFTS = ['morning', 'afternoon', 'evening'] as const;
export const SHIFT_LABEL: Record<string, string> = { morning: '上午', afternoon: '下午', evening: '晚上' };

export const PO_STATUS_LABEL: Record<string, string> = {
  pending: '待排产', processing: '生产中', completed: '已完成', warning: '异常', cancelled: '已取消',
  已拆分: '已拆分', 已完工: '已完成',
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => dayKey(new Date());
/** 取记录日期的 YYYY-MM-DD（兼容 ISO / zh-CN 斜杠串 / 已格式化串） */
const datePart = (v: any): string => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = new Date(s.replace(/\//g, '-')).getTime();
  return Number.isNaN(t) ? '' : dayKey(new Date(t));
};
const num = (v: any) => Number(v) || 0;
/** 本地日差（天）：b - a，入参 YYYY-MM-DD，无法解析返回 null */
const diffDays = (a: string, b: string): number | null => {
  const ta = a ? new Date(a.replace(/-/g, '/')).getTime() : NaN;
  const tb = b ? new Date(b.replace(/-/g, '/')).getTime() : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
};
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
/** 提取款式编码前缀（"8002-蓝色-35" → "8002"） */
const stylePrefix = (code: string): string => {
  const raw = String(code || '');
  const m = raw.match(/^[^-]+/);
  return m ? m[0] : raw;
};

/** 单个生产订单的统计行（所有派生值一次算清，页面只做展示与筛选） */
export interface PendingRow {
  key: string;
  id: string;
  record: any;
  status: string;
  statusLabel: string;
  productName: string;
  customerName: string;
  person: string;
  createTime: string;
  planQty: number;            // 计划数量（明细合计优先）
  doneQty: number;            // 完工数量
  pendingQty: number;         // 待生产数量 = max(0, 计划 - 完工)
  progress: number;           // 完工率 %
  scheduledQty: number;       // 已排期数量（排期记录合计）
  remainScheduleQty: number;  // 未排期数量 = max(0, 计划 - 已排期)，与排期看板"待排"同口径
  hasSchedule: boolean;
  deferred: boolean;          // 暂不生产
  elapsedDays: number;        // 已用时
  estDays: number;            // 节点预计用时合计（0=未维护）
  limitDays: number;          // 超期阈值 = estDays 或默认 7 天
  overdue: boolean;
  overDays: number;           // 超出阈值天数
  planEnd: string;
  dueInDays: number | null;   // 距计划完工天数（负数=已过期）
  hasCgsq: boolean;           // 已生成物料清单（采购申请单）
  hasJg: boolean;             // 已生成加工清单（加工订单）
  jgTotal: number;
  jgDone: number;
  jgOpenQty: number;          // 该单半成品未完成需求数量
  jgOpenAmount: number;       // 该单半成品未完成加工金额
  cgsqOpenCount: number;      // 该单未完结采购申请数
  nodeIndex: number;
  nodeName: string;           // 当前流程节点
  nodeStayDays: number;       // 当前节点停留天数
  nodeEstDays: number;        // 当前节点预计天数
  nodeOverDays: number;       // 当前节点超时天数（0=未超时）
  moldCodes: string;
  styleCodes: string[];
  completed: boolean;         // 真实完工（终结单中排除「已拆分」：拆分数量已转到子单，不算本单完工）
  completedAt: string;        // 完工日期（生产入库记录优先，回退订单更新时间）
  cycleDays: number | null;   // 完工周期 = 完工日 - 创建日
}

export interface NodeStat {
  index: number;
  name: string;
  count: number;
  qty: number;
  avgStayDays: number;
  estDays: number;
  overCount: number;
}
export interface DimStat { name: string; count: number; qty: number; overdueCount: number }
export interface StyleStat { styleCode: string; moldCode: string; qty: number; orderCount: number; colors: number; sizes: number }
export interface SpecStat { name: string; qty: number; orderCount: number }
export interface LineCapacityStat {
  line: string;
  standard: number;           // 维护的单班次标准产量
  avgShiftOutput: number;     // 近 14 天该线有排产班次的平均单班次产量
  usedCapacity: number;       // 实际参与计算的单班次产量
  scheduled7: number;         // 未来 7 天已排数量
  capacity7: number;          // 未来 7 天可排容量
}
export interface DayLoad { date: string; label: string; scheduled: number; capacity: number }

export interface ProductionSnapshot {
  owner: string;
  generatedAt: string;
  wfData: PoWfData;
  rows: PendingRow[];         // 全部生产订单（已按 PO- 前缀过滤脏行）
  pool: PendingRow[];         // 待生产池：未完工、未取消且待生产数量 > 0
  totals: {
    allCount: number;
    poolCount: number;
    pendingCount: number;     // 待排产
    processingCount: number;  // 生产中
    warningCount: number;     // 异常
    doneCount: number;
    poolQty: number;
    planQty: number;
    doneQty: number;
    scheduledQty: number;
    unscheduledQty: number;
    unscheduledCount: number;
    deferredCount: number;
    deferredQty: number;
    avgProgress: number;
  };
  bom: {
    noCgsqCount: number;
    noJgCount: number;
    readyCount: number;       // 清单齐套
    jgTotalCount: number;
    jgDoneCount: number;
    jgDoneRate: number;
    jgOpenCount: number;      // 待生产池内未完结加工单
    jgOpenQty: number;
    jgOpenAmount: number;
    cgsqOpenCount: number;
    cgsqOpenQty: number;
    blockedCount: number;     // 有前道阻塞（半成品未回厂或清单未生成）
  };
  risk: {
    overdueCount: number;
    overdueRate: number;
    avgOverDays: number;
    maxOverDays: number;
    nodeOverCount: number;
    dueSoonCount: number;     // 3 天内到期未完工
    planEndPassedCount: number; // 已过计划完工日期仍未完工
    noPlanEndCount: number;
  };
  nodes: NodeStat[];
  persons: DimStat[];
  styles: StyleStat[];
  colors: SpecStat[];
  sizes: SpecStat[];
  capacity: {
    lines: LineCapacityStat[];
    days: DayLoad[];
    capacity7: number;
    unscheduledQty: number;
    gap: number;              // 正数=容量缺口，负数=容量富余
    backlogDays: number | null;
    hasStandard: boolean;
    lineCount: number;
  };
  efficiency: {
    done30Count: number;
    done30Qty: number;
    avgCycleDays: number | null;
    completeRate: number;
    scheduleRate: number;     // 已排期数量 / 计划数量
  };
  /** 全部真实完工订单（含 30 天以外的历史单） */
  completedRows: PendingRow[];
  /** 近 30 天完工订单（完工效率指标与下钻同源） */
  done30Rows: PendingRow[];
  /** 待生产池内未完结加工单（半成品未回厂明细） */
  openJg: any[];
  /** 待生产池内未完结采购申请单 */
  openCgsq: any[];
}

/** 统计主入口：读取原始键并产出全部指标（纯函数式，页面每次刷新重算） */
export function loadProductionSnapshot(owner: string): ProductionSnapshot {
  const wfData = loadPoTemplates(owner);
  const rawOrders = readList(`pageData_production_production-order_${owner}`);
  const jgRows = readList(`pageData_production_processing-order_${owner}`);
  const cgsqRows = readList(`pageData_production_purchase-requisition_${owner}`);
  const schedules = readList(`pageData_production_production-schedule_${owner}`);
  const lines: string[] = (() => {
    const v = readList(`production_schedule_lines_${owner}`);
    return Array.isArray(v) && v.length ? v.map(String) : ['生产线1', '生产线2', '生产线3'];
  })();
  const deferredIds = new Set<string>(readList(`sb_deferred_${owner}`).map(String));
  const prodIn = readList(`pageData_inventory_prod-in-stats_${owner}`);
  const products = readList(`pageData_basic-data_product-list_${owner}`);
  const capacityMap = readLineCapacity(owner);

  // 关联索引
  const scheduledByPo = new Map<string, number>();
  schedules.forEach((s: any) => {
    const k = String(s.productionOrderId || '');
    if (!k) return;
    scheduledByPo.set(k, (scheduledByPo.get(k) || 0) + num(s.planQty));
  });
  const cgsqByPo = new Map<string, any[]>();
  cgsqRows.forEach((r: any) => {
    const k = String(r.poId || '');
    if (!k) return;
    const l = cgsqByPo.get(k) || []; l.push(r); cgsqByPo.set(k, l);
  });
  const jgByPo = new Map<string, any[]>();
  jgRows.forEach((r: any) => {
    const k = String(r.poId || '');
    if (!k) return;
    const l = jgByPo.get(k) || []; l.push(r); jgByPo.set(k, l);
  });
  const moldMap = new Map<string, string>();
  products.forEach((p: any) => {
    const mold = p.moldCode || '';
    if (!mold) return;
    [p.productCode, p.productName, p.shortName].forEach((k: any) => { if (k && !moldMap.has(k)) moldMap.set(String(k), mold); });
  });
  const inboundByPo = new Map<string, string>();
  prodIn.forEach((r: any) => {
    const k = String(r.woNo || '');
    if (!k) return;
    const d = datePart(r.date || r.createTime);
    if (d && d > (inboundByPo.get(k) || '')) inboundByPo.set(k, d);
  });

  // 订单行（同键混有 JG- 加工单脏行，按 PO- 前缀过滤）
  const rows: PendingRow[] = rawOrders
    .filter((o: any) => String(o.id || '').toUpperCase().startsWith('PO-'))
    .map((o: any): PendingRow => {
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
      const styleSet = new Set<string>();
      planItems.forEach((it: any) => {
        const code = it.styleCode || it.productCode || '';
        if (code) styleSet.add(stylePrefix(code));
        const mold = moldMap.get(String(it.productCode || '')) || moldMap.get(String(it.productName || '')) || '';
        if (mold) moldSet.add(mold);
      });
      if (!styleSet.size && o.productCode) styleSet.add(stylePrefix(String(o.productCode)));
      // 已拆分：数量已转至拆分出的子单，不算本单完工（否则会把拆分单当近 30 天完工量、并把默认今天当完工日）
      const isSplit = String(o.status || '') === '已拆分';
      const completed = poIsFinished(o) && !isSplit;
      // 完工日期回退只取记录自身的更新时间：poToWfOrder 的 updatedAt 缺失时会填当前时间，不能用作完工日
      const completedAt = inboundByPo.get(String(o.id))
        || (completed ? datePart(o.updateTime || o.wf?.updatedAt || '') : '');
      const cycleDays = completedAt && !Number.isNaN(createdTs) ? diffDays(datePart(o.createTime || o.createdAt), completedAt) : null;
      return {
        key: String(o.key || o.id),
        id: String(o.id || ''),
        record: o,
        status: String(o.status || 'pending'),
        statusLabel: PO_STATUS_LABEL[String(o.status)] || String(o.statusLabel || o.status || '待排产'),
        productName: o.productName || '',
        customerName: o.customerName || '',
        person: o.person || '',
        createTime: String(o.createTime || o.createdAt || ''),
        planQty: plan,
        doneQty: done,
        pendingQty: Math.max(0, plan - done),
        progress: plan > 0 ? Math.min(100, Math.round((done / plan) * 100)) : num(o.progress),
        scheduledQty: scheduled,
        remainScheduleQty: Math.max(0, plan - scheduled),
        hasSchedule: scheduled > 0,
        deferred: deferredIds.has(String(o.id)),
        elapsedDays: elapsed,
        estDays,
        limitDays,
        overdue: poIsOverdue(o, wfData),
        overDays: poIsOverdue(o, wfData) ? elapsed - limitDays : 0,
        planEnd: endStr,
        dueInDays: endStr && !poIsFinished(o) ? diffDays(todayKey(), endStr) : null,
        hasCgsq: (cgsqByPo.get(String(o.id)) || []).length > 0,
        hasJg: jgs.length > 0,
        jgTotal: jgs.length,
        jgDone: jgs.filter((r: any) => r.status === '已完成').length,
        jgOpenQty: jgOpen.reduce((s: number, r: any) => s + num(r.totalQty), 0),
        jgOpenAmount: jgOpen.reduce((s: number, r: any) => s + num(r.subtotal), 0),
        cgsqOpenCount: cgsqs.length,
        nodeIndex: stay ? stay.index : num(wfOrder.currentStep),
        nodeName: stay ? stay.name : (nodes[Math.min(wfOrder.currentStep, Math.max(0, nodes.length - 1))]?.name || ''),
        nodeStayDays: stay ? stay.actualDays : 0,
        nodeEstDays: stay ? stay.estimatedDays : 0,
        nodeOverDays: stay && stay.estimatedDays > 0 && stay.actualDays > stay.estimatedDays ? Math.ceil(stay.actualDays - stay.estimatedDays) : 0,
        moldCodes: Array.from(moldSet).join('、'),
        styleCodes: Array.from(styleSet),
        completed,
        completedAt,
        cycleDays,
      };
    });

  const pool = rows.filter(r => !poIsFinished(r.record) && r.status !== 'cancelled' && r.pendingQty > 0);
  const poolIds = new Set(pool.map(r => r.id));

  // A 待生产池总量
  const sum = (list: PendingRow[], f: (r: PendingRow) => number) => list.reduce((s, r) => s + f(r), 0);
  const totals = {
    allCount: rows.length,
    poolCount: pool.length,
    pendingCount: pool.filter(r => r.status === 'pending').length,
    processingCount: pool.filter(r => r.status === 'processing').length,
    warningCount: pool.filter(r => r.status === 'warning').length,
    doneCount: rows.filter(r => r.completed).length,
    poolQty: sum(pool, r => r.pendingQty),
    planQty: sum(pool, r => r.planQty),
    doneQty: sum(pool, r => r.doneQty),
    scheduledQty: sum(pool, r => Math.min(r.planQty, r.scheduledQty)),
    unscheduledQty: sum(pool, r => r.remainScheduleQty),
    unscheduledCount: pool.filter(r => r.remainScheduleQty > 0).length,
    deferredCount: pool.filter(r => r.deferred).length,
    deferredQty: sum(pool.filter(r => r.deferred), r => r.remainScheduleQty),
    avgProgress: pool.length ? Math.round(sum(pool, r => r.progress) / pool.length) : 0,
  };

  // B 齐套与前道阻塞
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

  // C 超期与交期风险
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

  // D 节点在制分布
  const nodeMap = new Map<number, { name: string; count: number; qty: number; stay: number; est: number; over: number }>();
  pool.forEach(r => {
    const cur = nodeMap.get(r.nodeIndex) || { name: r.nodeName || `节点${r.nodeIndex + 1}`, count: 0, qty: 0, stay: 0, est: 0, over: 0 };
    cur.name = r.nodeName || cur.name;
    cur.count += 1;
    cur.qty += r.pendingQty;
    cur.stay += r.nodeStayDays;
    cur.est = Math.max(cur.est, r.nodeEstDays);
    cur.over += r.nodeOverDays > 0 ? 1 : 0;
    nodeMap.set(r.nodeIndex, cur);
  });
  const nodes: NodeStat[] = Array.from(nodeMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, v]) => ({
      index, name: v.name, count: v.count, qty: v.qty,
      avgStayDays: v.count ? Math.round((v.stay / v.count) * 10) / 10 : 0,
      estDays: v.est, overCount: v.over,
    }));

  // F 结构维度
  const dimOf = (pick: (r: PendingRow) => string): DimStat[] => {
    const m = new Map<string, DimStat>();
    pool.forEach(r => {
      const k = pick(r) || '（未填写）';
      const cur = m.get(k) || { name: k, count: 0, qty: 0, overdueCount: 0 };
      cur.count += 1; cur.qty += r.pendingQty; cur.overdueCount += r.overdue ? 1 : 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.qty - a.qty);
  };
  const persons = dimOf(r => r.person);

  const styleMap = new Map<string, StyleStat & { orderIds: Set<string>; colorSet: Set<string>; sizeSet: Set<string> }>();
  const colorMap = new Map<string, SpecStat>();
  const sizeMap = new Map<string, SpecStat>();
  const UNFILLED = '（未填写）';
  pool.forEach(r => {
    const items: any[] = Array.isArray(r.record.planItems) ? r.record.planItems : [];
    // 无明细时用计划数量兼容（乘下方待产比例后即为待生产数量）
    const src = items.length ? items : [{ productCode: r.record.productCode || '', styleCode: '', color: '', spec: '', productionQty: r.planQty }];
    // 明细数量按计划口径，部分完工的单按待产比例折算，保证颜色/尺码/款式合计与「待生产总数量」对得上
    const ratio = r.planQty > 0 ? r.pendingQty / r.planQty : 1;
    src.forEach((it: any) => {
      const qty = Math.round(num(it.productionQty ?? it.quantity) * ratio);
      // 未填款式/颜色/尺码的明细归入「（未填写）」，避免结构图合计小于待生产总量而无法核对
      const code = stylePrefix(it.styleCode || it.productCode || r.record.productCode || '') || UNFILLED;
      const cur = styleMap.get(code) || { styleCode: code, moldCode: '', qty: 0, orderCount: 0, colors: 0, sizes: 0, orderIds: new Set<string>(), colorSet: new Set<string>(), sizeSet: new Set<string>() };
      cur.qty += qty;
      cur.orderIds.add(r.id);
      const mold = moldMap.get(String(it.productCode || '')) || (code !== UNFILLED ? (moldMap.get(code) || '') : '');
      if (mold && !cur.moldCode) cur.moldCode = mold;
      if (it.color) cur.colorSet.add(String(it.color));
      const sz = it.spec || it.size || '';
      if (sz) cur.sizeSet.add(String(sz));
      styleMap.set(code, cur);
      const acc = (m: Map<string, SpecStat>, key: string) => {
        const k = key || UNFILLED;
        const cur = m.get(k) || { name: k, qty: 0, orderCount: 0 };
        cur.qty += qty; cur.orderCount += 1;
        m.set(k, cur);
      };
      acc(colorMap, String(it.color || ''));
      acc(sizeMap, String(it.spec || it.size || ''));
    });
  });
  // 款式订单数：按订单集合去重统计，避免同单多明细重复计数
  const styles: StyleStat[] = Array.from(styleMap.values()).map(s => ({
    styleCode: s.styleCode,
    moldCode: s.moldCode,
    qty: s.qty,
    orderCount: s.orderIds.size,
    colors: s.colorSet.size,
    sizes: s.sizeSet.size,
  })).sort((a, b) => b.qty - a.qty);
  const toSpec = (m: Map<string, SpecStat>) => Array.from(m.values()).sort((a, b) => b.qty - a.qty);

  // E 产能负荷（未来 7 天）
  const today = new Date();
  const next7: string[] = Array.from({ length: 7 }, (_, i) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)));
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
  // 近 14 天单班次均产无论是否维护标准产量都算出来（供表内对照），采用产量优先标准产量
  const capOf = (line: string) => {
    const std = num(capacityMap[line]);
    const cell = stdAvg.get(line);
    const avg = cell && cell.cells.size > 0 ? Math.round(cell.qty / cell.cells.size) : 0;
    return { std, avg, use: std > 0 ? std : avg };
  };
  const linesStat: LineCapacityStat[] = lines.map(l => {
    const c = capOf(l);
    return {
      line: l,
      standard: c.std,
      avgShiftOutput: c.avg,
      usedCapacity: c.use,
      scheduled7: schedules.filter((s: any) => s.line === l && next7.includes(datePart(s.startDate))).reduce((s: number, x: any) => s + num(x.planQty), 0),
      capacity7: c.use * 3 * 7,
    };
  });
  const days: DayLoad[] = next7.map(d => {
    const wd = diffDays('1970-01-01', d);
    const weekCn = wd === null ? '' : WEEK_CN[(wd + 4) % 7];
    return {
      date: d,
      label: `${d.slice(5).replace('-', '/')} 周${weekCn}`,
      scheduled: schedules.filter((s: any) => datePart(s.startDate) === d).reduce((s: number, x: any) => s + num(x.planQty), 0),
      capacity: linesStat.reduce((s, l) => s + l.usedCapacity * 3, 0),
    };
  });
  const capacity7 = linesStat.reduce((s, l) => s + l.capacity7, 0);
  const dailyCapacity = linesStat.reduce((s, l) => s + l.usedCapacity * 3, 0);
  const recentDailyAvg = recent.reduce((s: number, x: any) => s + num(x.planQty), 0) / 14;
  const perDay = dailyCapacity > 0 ? dailyCapacity : recentDailyAvg;
  const capacity = {
    lines: linesStat,
    days,
    capacity7,
    unscheduledQty: totals.unscheduledQty,
    gap: Math.round(totals.unscheduledQty - capacity7),
    backlogDays: perDay > 0 ? Math.round((totals.unscheduledQty / perDay) * 10) / 10 : null,
    hasStandard,
    lineCount: lines.length,
  };

  // F4 完工效率（已拆分单不计入）
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

  return {
    owner,
    generatedAt: new Date().toLocaleString('zh-CN'),
    wfData,
    rows, pool, totals, bom, risk, nodes,
    persons, styles,
    colors: toSpec(colorMap),
    sizes: toSpec(sizeMap),
    capacity,
    efficiency,
    completedRows,
    done30Rows: done30,
    openJg: jgPoolOpen,
    openCgsq: cgsqPoolOpen,
  };
}
