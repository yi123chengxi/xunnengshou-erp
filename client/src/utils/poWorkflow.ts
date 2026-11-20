/**
 * 生产订单 ↔ 工作流卡片 共享映射（ModuleChildPage 卡片视图 与 供应商首页生产看板 共用）
 * 工作流状态存于 record.wf，与生产订单记录一起持久化（pageData_production_production-order_<owner>）
 */
import { INDUSTRY_TEMPLATES } from '../pages/production/WorkflowTemplatePage';
import type {
  CustomOrder as WfOrder, WorkflowTemplate as WfTemplate, WorkflowNode as WfNode,
} from '../pages/production/CustomOrderPage';

export interface PoWfData { templates: WfTemplate[]; defaultTemplateId: string; }

/** 加载生产流程模板：优先租户自存模板，回退内置预设；默认模板 id 兜底 preset-system/isDefault/首个 */
export function loadPoTemplates(owner: string): PoWfData {
  let tpls: WfTemplate[] = [];
  let defaultId = '';
  try {
    const raw = localStorage.getItem(`pageData_production_custom-order-templates_${owner}`);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) tpls = arr;
  } catch { /* ignore */ }
  const effective: WfTemplate[] = tpls.length > 0 ? tpls : (INDUSTRY_TEMPLATES as WfTemplate[]);
  try { defaultId = localStorage.getItem(`pageData_production_custom-order-default_${owner}`) || ''; } catch { /* ignore */ }
  if (!defaultId || !effective.some((t: any) => t.id === defaultId)) {
    const d = effective.find((t: any) => t.id === 'preset-system') || effective.find((t: any) => t.isDefault) || effective[0];
    defaultId = d ? d.id : '';
  }
  return { templates: effective, defaultTemplateId: defaultId };
}

/** 生产订单记录 → 工作流卡片数据 */
export function poToWfOrder(record: any, data: PoWfData): WfOrder {
  const st = String(record.status || 'pending');
  const wf = record.wf || {};
  const tpl = data.templates.find((t: any) => t.id === (wf.templateId ?? data.defaultTemplateId));
  const nodes: WfNode[] = (Array.isArray(wf.customNodes) && wf.customNodes.length > 0)
    ? wf.customNodes
    : (tpl && Array.isArray(tpl.nodes) && tpl.nodes.length > 0 ? tpl.nodes : []);
  const fallbackStep = st === 'processing' ? 1 : 0;
  let currentStep = typeof wf.currentStep === 'number' ? wf.currentStep : fallbackStep;
  if (st === 'completed') {
    const len = nodes.length || 4;
    currentStep = currentStep >= len ? currentStep : len;
  }
  const wfStatus = typeof wf.status === 'string'
    ? wf.status
    : (st === 'completed' ? 'COMPLETED' : st === 'warning' ? 'ABNORMAL' : 'IN_PROGRESS');
  return {
    id: record.key || record.id,
    orderId: String(record.orderId || record.salesOrderId || ''),
    orderNo: record.id || record.orderId || '--',
    customerName: record.customerName || '',
    buyerContact: '',
    totalAmount: 0,
    owner: record.person || '',
    templateId: wf.templateId ?? data.defaultTemplateId ?? null,
    customNodes: Array.isArray(wf.customNodes) && wf.customNodes.length > 0 ? wf.customNodes : null,
    customRequirement: null,
    currentStep,
    status: wfStatus as WfOrder['status'],
    records: Array.isArray(wf.records) ? wf.records : [],
    // 计划明细透传给卡片（完成订单入库数量弹窗的默认值来源）
    planItems: Array.isArray(record.planItems) ? record.planItems : undefined,
    createdAt: wf.createdAt || record.createTime || new Date().toISOString(),
    updatedAt: wf.updatedAt || new Date().toISOString(),
  };
}

/** 工作流变更 → 生产订单记录补丁（同步状态/进度/wf 快照；持久化与业务联动由调用方负责） */
export function buildPoWfPatch(record: any, u: WfOrder, data: PoWfData): { next: any; progress: number; nodes: WfNode[] } {
  const tpl = data.templates.find((t: any) => t.id === u.templateId);
  const nodes: WfNode[] = (u.customNodes && u.customNodes.length > 0)
    ? u.customNodes
    : (tpl && Array.isArray(tpl.nodes) && tpl.nodes.length > 0 ? tpl.nodes : []);
  const len = nodes.length || 4;
  let nextStatus = String(record.status || 'pending');
  if (u.status === 'COMPLETED') nextStatus = 'completed';
  else if (u.status === 'ABNORMAL') nextStatus = 'warning';
  else if (u.currentStep > 0) nextStatus = 'processing';
  else nextStatus = 'pending';
  const progress = u.status === 'COMPLETED' ? 100 : Math.max(0, Math.min(100, Math.round((u.currentStep / len) * 100)));
  const next: any = {
    ...record,
    status: nextStatus,
    progress,
    wf: {
      currentStep: u.currentStep,
      status: u.status,
      records: u.records,
      customNodes: u.customNodes,
      templateId: u.templateId,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    },
    updateTime: new Date().toLocaleString('zh-CN'),
  };
  return { next, progress, nodes };
}

/** 计划数量 = 计划明细数量总和（回退 record.planQty/planQuantity） */
export function poPlanQty(record: any): number {
  const planItems: any[] = Array.isArray(record.planItems) ? record.planItems : [];
  return planItems.length > 0
    ? planItems.reduce((s: number, it: any) => s + (Number(it.productionQty ?? it.quantity) || 0), 0)
    : (Number(record.planQty ?? record.planQuantity) || 0);
}

/** 订单流程节点（customNodes 优先，否则关联模板 nodes） */
export function poNodesOf(order: WfOrder, templates: WfTemplate[]): WfNode[] {
  if (order.customNodes && order.customNodes.length > 0) return order.customNodes;
  const tpl = templates.find((t: any) => t.id === order.templateId);
  return tpl && Array.isArray(tpl.nodes) && tpl.nodes.length > 0 ? tpl.nodes : [];
}

export interface PoNodeOverdue { index: number; name: string; actualDays: number; estimatedDays: number; overDays: number; }
export interface PoNodeStay { index: number; name: string; actualDays: number; estimatedDays: number; }

/**
 * 当前节点停留情况（不做超时判定，供统计页算平均停留）：
 * 起点=上一节点推进记录时间，首节点=创建时间；订单已完成或无当前节点返回 null
 */
export function poNodeStay(order: WfOrder, nodes: WfNode[]): PoNodeStay | null {
  if (order.status === 'COMPLETED') return null;
  const i = typeof order.currentStep === 'number' ? order.currentStep : 0;
  const node = nodes[i];
  if (!node) return null;
  let start: number;
  if (i === 0) start = new Date(order.createdAt).getTime() || Date.now();
  else {
    const prev = (order.records || []).filter((r: any) => r.stepIndex === i - 1);
    start = prev.length > 0 ? (new Date(prev[prev.length - 1].createdAt).getTime() || new Date(order.createdAt).getTime()) : (new Date(order.createdAt).getTime() || Date.now());
  }
  return { index: i, name: (node as any).name || `节点${i + 1}`, actualDays: (Date.now() - start) / 86400000, estimatedDays: Number((node as any).estimatedDays) || 0 };
}

/** 当前节点超时判定（与 WorkflowOrderCard 同口径：节点预计天数 vs 实际停留天数；起点=上一节点推进记录时间，首节点=创建时间） */
export function poCurrentNodeOverdue(order: WfOrder, nodes: WfNode[]): PoNodeOverdue | null {
  const stay = poNodeStay(order, nodes);
  if (!stay || stay.estimatedDays <= 0) return null;
  if (stay.actualDays <= stay.estimatedDays) return null;
  return { index: stay.index, name: stay.name, actualDays: stay.actualDays, estimatedDays: stay.estimatedDays, overDays: Math.ceil(stay.actualDays - stay.estimatedDays) };
}

/** 生产订单整单超期的默认天数（流程模板未填预计用时时使用） */
export const PO_DEFAULT_OVERDUE_DAYS = 7;

const dayStart = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** 订单创建时间戳：兼容 ISO / toLocaleString('zh-CN') 斜杠串 / 纯日期串，无法解析返回 NaN */
export function poCreatedTs(record: any): number {
  for (const v of [record?.createTime, record?.createdAt, record?.wf?.createdAt, record?.date, record?.orderDate]) {
    if (!v) continue;
    const t = new Date(String(v)).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return NaN;
}

/** 已用时（天）：创建日 → 今日的自然日差，当天创建为 0；创建时间不可解析按 0 计 */
export function poElapsedDays(record: any): number {
  const ts = poCreatedTs(record);
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000));
}

/** 流程节点预计用时之和（天）：customNodes 优先，否则关联模板；无节点或均未填预计用时返回 0 */
export function poEstimatedTotalDays(record: any, data: PoWfData): number {
  const nodes = poNodesOf(poToWfOrder(record, data), data.templates);
  return nodes.reduce((s: number, n: any) => s + (Number(n?.estimatedDays) || 0), 0);
}

/** 订单是否已终结（完工/已拆分）：终结单不再判超期 */
export function poIsFinished(record: any): boolean {
  const st = String(record?.status || '');
  return st === 'completed' || st === '已完工' || st === '已拆分' || Number(record?.progress) >= 100;
}

/** 整单超期：已用时 > 节点预计用时之和（未填则按 PO_DEFAULT_OVERDUE_DAYS 天）；完工/已拆分不判超期 */
export function poIsOverdue(record: any, data: PoWfData): boolean {
  if (poIsFinished(record)) return false;
  const est = poEstimatedTotalDays(record, data);
  return poElapsedDays(record) > (est > 0 ? est : PO_DEFAULT_OVERDUE_DAYS);
}
