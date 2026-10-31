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

/** 当前节点超时判定（与 WorkflowOrderCard 同口径：节点预计天数 vs 实际停留天数；起点=上一节点推进记录时间，首节点=创建时间） */
export function poCurrentNodeOverdue(order: WfOrder, nodes: WfNode[]): PoNodeOverdue | null {
  if (order.status === 'COMPLETED') return null;
  const i = typeof order.currentStep === 'number' ? order.currentStep : 0;
  const node = nodes[i];
  if (!node) return null;
  const est = Number((node as any).estimatedDays) || 0;
  if (est <= 0) return null;
  let start: number;
  if (i === 0) start = new Date(order.createdAt).getTime() || Date.now();
  else {
    const prev = (order.records || []).filter((r: any) => r.stepIndex === i - 1);
    start = prev.length > 0 ? (new Date(prev[prev.length - 1].createdAt).getTime() || new Date(order.createdAt).getTime()) : (new Date(order.createdAt).getTime() || Date.now());
  }
  const actual = (Date.now() - start) / 86400000;
  if (actual <= est) return null;
  return { index: i, name: (node as any).name || `节点${i + 1}`, actualDays: actual, estimatedDays: est, overDays: Math.ceil(actual - est) };
}
