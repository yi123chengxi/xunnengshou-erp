/**
 * 页面配置 Part 2：生产管理、采购管理、库存管理、财务管理、经营看板
 */

import { RecordStatus, ChildPageConfig } from './pageConfig';

const generateData2 = (
  prefix: string,
  count: number,
  extra?: Record<string, any>[]
): Record<string, any>[] => {
  const persons = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九'];
  const depts = ['制造一部', '制造二部', '品质部', '仓储部', '采购部', '销售部', '财务部'];

  return Array.from({ length: count }, (_, i) => ({
    key: `${prefix}-${i + 1}`,
    id: `${prefix}-${String(24001 + i)}`,
    name: `${prefix}项目-${String(i + 1).padStart(3, '0')}`,
    status: ['completed', 'processing', 'pending', 'warning', 'cancelled'][i % 5] as RecordStatus,
    amount: Math.floor(Math.random() * 800000) + 20000,
    quantity: Math.floor(Math.random() * 5000) + 100,
    date: `2024-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`,
    person: persons[i % persons.length],
    dept: depts[i % depts.length],
    progress: Math.floor(Math.random() * 100),
    passRate: (85 + Math.random() * 14.9).toFixed(1),
    deliveryDays: Math.floor(Math.random() * 30) + 1,
    margin: (Math.random() * 40 + 5).toFixed(1),
    remark: `备注信息-${i + 1}`,
    ...(extra?.[i] || {}),
  }));
};

// ============ 4. 生产管理模块 ============
export const productionPages: Record<string, ChildPageConfig> = {
  'production-order': {
    title: '生产订单',
    description: '集中管理生产订单，跟踪从接单排产、生产执行到完工入库的全流程',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '生产订单来源于销售订单' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '完工后触发成品入库' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '缺料时触发物料采购' },
    ],
    stats: [
      { title: '生产订单总数', dataIndex: 'total', format: 'count', suffix: '单' },
      { title: '生产中', dataIndex: 'inProgress', format: 'count', suffix: '单' },
      { title: '已完工', dataIndex: 'done', format: 'count', suffix: '单' },
      { title: '平均完工率', dataIndex: 'avgComplete', format: 'percent', suffix: '%' },
    ],
    columnGroups: ['订单信息', '货品信息', '生产信息'],
    columns: [
      { title: '生产单号', dataIndex: 'id', key: 'id', width: 130, type: 'text', group: '订单信息' },
      { title: '关联销售单号', dataIndex: 'salesOrderId', key: 'salesOrderId', width: 140, type: 'text', group: '订单信息' },
      { title: '订单数量', dataIndex: 'orderQty', key: 'orderQty', width: 90, type: 'number', align: 'right', group: '货品信息' },
      { title: '计划明细', dataIndex: 'productCode', key: 'productCode', width: 180, type: 'ellipsis', group: '货品信息' },
      { title: '订单明细', dataIndex: 'orderDetail', key: 'orderDetail', width: 180, type: 'ellipsis', group: '货品信息' },
      { title: '商品名称', dataIndex: 'productName', key: 'productName', width: 140, type: 'link', group: '货品信息' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 120, type: 'text', group: '订单信息' },
      { title: '计划数量', dataIndex: 'planQty', key: 'planQty', width: 90, type: 'number', align: 'right', group: '生产信息' },
      { title: '完工数量', dataIndex: 'doneQty', key: 'doneQty', width: 90, type: 'number', align: 'right', group: '生产信息' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress', group: '生产信息' },
      { title: '计划开工', dataIndex: 'startDate', key: 'startDate', width: 110, type: 'date', group: '生产信息' },
      { title: '计划完工', dataIndex: 'endDate', key: 'endDate', width: 110, type: 'date', group: '生产信息' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text', group: '订单信息' },
      { title: '订单标签', dataIndex: 'orderTag', key: 'orderTag', width: 150, type: 'tag', group: '订单信息' },
      { title: '生成状态', dataIndex: 'status', key: 'status', width: 110, type: 'tag', group: '订单信息' },
      { title: '物料清单', dataIndex: 'materialList', key: 'materialList', width: 90, type: 'tag', group: '生产信息' },
      { title: '加工清单', dataIndex: 'processList', key: 'processList', width: 90, type: 'tag', group: '生产信息' },
    ],
    // 搜索栏已改为状态快捷筛选 + 分字段搜索（生产单号/关联销售单号/商品/客户/标签/物料清单/加工清单/打印状态）
    filters: [],
    mockData: [],
  },

  'processing-order': {
    title: '加工订单',
    description: '由生产订单物料清单生成的半成品加工清单，按每双所需数量×计划生产数量汇总每种半成品的需求总量',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '由生产订单BOM半成品清单生成' },
    ],
    stats: [
      { title: '加工单总数', dataIndex: 'total', format: 'count', suffix: '单' },
    ],
    columns: [
      { title: '加工单号', dataIndex: 'id', key: 'id', width: 140, type: 'text' },
      { title: '来源生产单号', dataIndex: 'poId', key: 'poId', width: 140, type: 'text' },
      { title: '图片', dataIndex: 'image', key: 'image', width: 60, type: 'image' },
      { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 110, type: 'text' },
      { title: '商品简称', dataIndex: 'shortName', key: 'shortName', width: 110, type: 'text' },
      { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 130, type: 'text' },
      { title: '单位', dataIndex: 'unit', key: 'unit', width: 60, type: 'text' },
      { title: '每双所需数量', dataIndex: 'perPairQty', key: 'perPairQty', width: 110, type: 'number', align: 'right' },
      { title: '计划生产数量', dataIndex: 'planQty', key: 'planQty', width: 110, type: 'number', align: 'right' },
      { title: '需求总数量', dataIndex: 'totalQty', key: 'totalQty', width: 110, type: 'number', align: 'right' },
      { title: '单价', dataIndex: 'price', key: 'price', width: 90, type: 'money', align: 'right' },
      { title: '小计', dataIndex: 'subtotal', key: 'subtotal', width: 100, type: 'money', align: 'right' },
      { title: '加工厂名称', dataIndex: 'factoryName', key: 'factoryName', width: 140, type: 'text' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
      { title: '订单来源', dataIndex: 'orderSource', key: 'orderSource', width: 100, type: 'text' },
      { title: '市场发布', dataIndex: 'marketPublished', key: 'marketPublished', width: 90, type: 'text' },
      { title: '生成时间', dataIndex: 'createTime', key: 'createTime', width: 160, type: 'date' },
      { title: '操作人', dataIndex: 'operator', key: 'operator', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索加工单号/生产单号/商品编码', label: '搜索' },
    ],
    mockData: [],
  },

  'purchase-requisition': {
    title: '采购申请单',
    description: '由生产订单物料清单生成的原材料采购申请，按每双所需数量×计划生产数量汇总每种原材料的采购需求总量',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '由生产订单BOM原材料清单生成' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '申请清单用于指导原材料采购' },
    ],
    stats: [
      { title: '申请单总数', dataIndex: 'total', format: 'count', suffix: '单' },
    ],
    columnGroups: ['单据信息', '物料信息', '数量与金额', '其他'],
    columns: [
      { title: '申请单号', dataIndex: 'id', key: 'id', width: 150, type: 'text', group: '单据信息' },
      { title: '来源生产单号', dataIndex: 'poId', key: 'poId', width: 140, type: 'text', group: '单据信息' },
      { title: '明细数', dataIndex: 'itemCount', key: 'itemCount', width: 80, type: 'number', align: 'right', group: '单据信息' },
      { title: '订单状态', dataIndex: 'status', key: 'status', width: 100, type: 'tag', group: '单据信息' },
      { title: '打印状态', dataIndex: 'printStatus', key: 'printStatus', width: 90, type: 'tag', group: '单据信息' },
      { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 110, type: 'text', group: '物料信息' },
      { title: '商品简称', dataIndex: 'shortName', key: 'shortName', width: 110, type: 'text', group: '物料信息' },
      { title: '物料清单', dataIndex: 'productCode', key: 'productCode', width: 130, type: 'text', group: '物料信息' },
      { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 110, type: 'text', group: '物料信息' },
      { title: '单位', dataIndex: 'unit', key: 'unit', width: 60, type: 'text', group: '物料信息' },
      { title: '每双所需数量', dataIndex: 'perPairQty', key: 'perPairQty', width: 110, type: 'text', align: 'right', group: '数量与金额' },
      { title: '计划生产数量', dataIndex: 'planQty', key: 'planQty', width: 110, type: 'text', align: 'right', group: '数量与金额' },
      { title: '申请总数量', dataIndex: 'totalQty', key: 'totalQty', width: 110, type: 'number', align: 'right', group: '数量与金额' },
      { title: '单价', dataIndex: 'price', key: 'price', width: 90, type: 'text', align: 'right', group: '数量与金额' },
      { title: '小计', dataIndex: 'subtotal', key: 'subtotal', width: 100, type: 'money', align: 'right', group: '数量与金额' },
      { title: '生成时间', dataIndex: 'createTime', key: 'createTime', width: 160, type: 'date', group: '其他' },
      { title: '操作人', dataIndex: 'operator', key: 'operator', width: 90, type: 'text', group: '其他' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索申请单号/生产单号/商品编码', label: '搜索' },
    ],
    mockData: [],
  },

  'production-schedule': {
    title: '生产排期',
    description: '根据生产订单与交货期制定生产排期计划，明确排产数量、生产线、开工与完工时间',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '排期来源于生产订单' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '排期需匹配销售订单交期' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '物料库存影响排期安排' },
    ],
    stats: [
      { title: '排期总数', dataIndex: 'total', format: 'count', suffix: '单' },
      { title: '生产中', dataIndex: 'inProgress', format: 'count', suffix: '单' },
      { title: '已完工', dataIndex: 'done', format: 'count', suffix: '单' },
      { title: '异常排期', dataIndex: 'abnormal', format: 'count', suffix: '单' },
    ],
    columns: [
      { title: '排期编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '关联生产单号', dataIndex: 'productionOrderId', key: 'productionOrderId', width: 140, type: 'text' },
      { title: '关联销售单号', dataIndex: 'salesOrderId', key: 'salesOrderId', width: 140, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 140, type: 'link' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 120, type: 'text' },
      { title: '计划明细', dataIndex: 'planItems', key: 'planItems', width: 170, type: 'ellipsis' },
      { title: '排产数量', dataIndex: 'planQty', key: 'planQty', width: 90, type: 'number', align: 'right' },
      { title: '生产线', dataIndex: 'line', key: 'line', width: 100, type: 'tag' },
      { title: '计划开工', dataIndex: 'startDate', key: 'startDate', width: 110, type: 'date' },
      { title: '计划完工', dataIndex: 'endDate', key: 'endDate', width: 110, type: 'date' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索排期编号/产品/客户', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '待排产', value: 'pending' },
        { label: '生产中', value: 'processing' },
        { label: '已完工', value: 'completed' },
        { label: '异常', value: 'warning' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'delivery-remind': {
    title: '交货期提醒',
    description: '监控生产订单的交货期，提前预警即将到期和已逾期的订单，确保准时交付',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '提醒来源于生产工单交期' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '交期影响客户满意度和销售业绩' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '完工后触发入库流程' },
    ],
    stats: [
      { title: '待交付订单', dataIndex: 'pending', format: 'count', suffix: '单' },
      { title: '即将到期(3天)', dataIndex: 'dueSoon', format: 'count', suffix: '单' },
      { title: '已逾期', dataIndex: 'overdue', format: 'count', suffix: '单' },
      { title: '准时交付率', dataIndex: 'onTimeRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '工单编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 140, type: 'link' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 120, type: 'text' },
      { title: '订单数量', dataIndex: 'quantity', key: 'quantity', width: 90, type: 'number', align: 'right' },
      { title: '承诺交期', dataIndex: 'promiseDate', key: 'promiseDate', width: 110, type: 'date' },
      { title: '剩余天数', dataIndex: 'remainDays', key: 'remainDays', width: 90, type: 'number', align: 'center' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索工单编号/产品名', label: '搜索' },
      { type: 'select', options: [
        { label: '全部', value: '' },
        { label: '已逾期', value: 'overdue' },
        { label: '3天内到期', value: 'soon' },
        { label: '7天内到期', value: 'week' },
        { label: '正常', value: 'normal' },
      ], label: '交期状态' },
    ],
    mockData: [],
  },

  'order-track': {
    title: '订单执行跟踪',
    description: '实时跟踪生产订单在各工序的执行进度，包括开工、完工、质检等节点状态',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '跟踪工序参考工艺路线定义' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '完工后触发入库和质检' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '缺料时触发紧急采购' },
    ],
    stats: [
      { title: '进行中工单', dataIndex: 'inProgress', format: 'count', suffix: '单' },
      { title: '今日完工', dataIndex: 'todayDone', format: 'count', suffix: '单' },
      { title: '异常工单', dataIndex: 'abnormal', format: 'count', suffix: '单' },
      { title: '平均完工率', dataIndex: 'avgComplete', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '工单编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '当前工序', dataIndex: 'currentStep', key: 'currentStep', width: 120, type: 'tag' },
      { title: '计划数量', dataIndex: 'planQty', key: 'planQty', width: 90, type: 'number', align: 'right' },
      { title: '完工数量', dataIndex: 'doneQty', key: 'doneQty', width: 90, type: 'number', align: 'right' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '开工日期', dataIndex: 'startDate', key: 'startDate', width: 110, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索工单编号/产品', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '生产中', value: 'processing' },
        { label: '已暂停', value: 'pending' },
        { label: '异常', value: 'warning' },
        { label: '已完成', value: 'completed' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'sales-out-stats': {
    title: '销售出库统计',
    description: '统计生产完工后的销售出库情况，包括出库数量、金额、出库趋势等',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '出库对应销售订单的发货' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '出库扣减库存数量' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '出库确认收入，关联应收账款' },
    ],
    stats: [
      { title: '本月出库量', dataIndex: 'monthQty', format: 'count', suffix: '件' },
      { title: '出库金额', dataIndex: 'monthAmount', format: 'money', prefix: '¥' },
      { title: '出库单数', dataIndex: 'orderCount', format: 'count', suffix: '单' },
      { title: '待发货', dataIndex: 'pendingShip', format: 'count', suffix: '单' },
    ],
    columns: [
      { title: '出库单号', dataIndex: 'docNo', key: 'docNo', width: 150, type: 'text' },
      { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 140, type: 'text' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 130, type: 'text' },
      { title: '店铺', dataIndex: 'shopName', key: 'shopName', width: 120, type: 'text' },
      { title: '货品明细', dataIndex: 'productDetail', key: 'productDetail', width: 200, type: 'text' },
      { title: '出库数量', dataIndex: 'totalQty', key: 'totalQty', width: 90, type: 'number', align: 'right' },
      { title: '收货人', dataIndex: 'receiverName', key: 'receiverName', width: 100, type: 'text' },
      { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100, type: 'text' },
      { title: '出库日期', dataIndex: 'createTime', key: 'createTime', width: 160, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索出库单号/订单号/客户', label: '搜索' },
    ],
    mockData: [],
  },

  'product-sales-stats': {
    title: '产品销量统计',
    description: '按产品维度统计销售数量，分析产品畅销程度和销售趋势',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '销量统计关联产品基础信息' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '销量是销售分析的重要维度' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '销量趋势指导库存策略' },
    ],
    stats: [
      { title: '本月总销量', dataIndex: 'monthTotal', format: 'count', suffix: '件' },
      { title: '畅销品数量', dataIndex: 'hotProducts', format: 'count', suffix: '个' },
      { title: '滞销品数量', dataIndex: 'slowProducts', format: 'count', suffix: '个' },
      { title: '同比增长', dataIndex: 'yoyGrowth', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 140, type: 'link' },
      { title: '产品分类', dataIndex: 'category', key: 'category', width: 100, type: 'tag' },
      { title: '本月销量', dataIndex: 'monthQty', key: 'monthQty', width: 100, type: 'number', align: 'right' },
      { title: '上月销量', dataIndex: 'lastMonthQty', key: 'lastMonthQty', width: 100, type: 'number', align: 'right' },
      { title: '环比变化', dataIndex: 'mom', key: 'mom', width: 100, type: 'rate', align: 'center' },
      { title: '年度累计', dataIndex: 'yearTotal', key: 'yearTotal', width: 100, type: 'number', align: 'right' },
      { title: '销售排名', dataIndex: 'rank', key: 'rank', width: 80, type: 'number', align: 'center' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索产品名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部分类', value: '' },
        { label: '成品', value: 'finished' },
        { label: '半成品', value: 'semi' },
        { label: '零部件', value: 'parts' },
      ], label: '分类' },
    ],
    mockData: [],
  },

  'return-stats': {
    title: '退换货统计',
    description: '统计和分析产品退换货情况，识别质量问题产品，推动品质改善',
    relatedModules: [
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '退货入库影响库存数量' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '退货分析反馈到产品设计和工艺' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '退货原因关联客户满意度' },
    ],
    stats: [
      { title: '退货率', dataIndex: 'returnRate', format: 'percent', suffix: '%' },
      { title: '本月退货', dataIndex: 'monthReturns', format: 'count', suffix: '件' },
      { title: '退货金额', dataIndex: 'returnAmount', format: 'money', prefix: '¥' },
      { title: '换货数量', dataIndex: 'exchangeCount', format: 'count', suffix: '件' },
    ],
    columns: [
      { title: '退货单号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 120, type: 'text' },
      { title: '退货类型', dataIndex: 'returnType', key: 'returnType', width: 100, type: 'tag' },
      { title: '退货原因', dataIndex: 'reason', key: 'reason', width: 150, type: 'text' },
      { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80, type: 'number', align: 'right' },
      { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, type: 'money', align: 'right' },
      { title: '日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索退货单号/产品', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '退货', value: 'return' },
        { label: '换货', value: 'exchange' },
        { label: '维修', value: 'repair' },
      ], label: '类型' },
    ],
    mockData: [],
  },
};

// ============ 5. 采购管理模块 ============
export const purchasePages: Record<string, ChildPageConfig> = {
  'mps-stats': {
    title: 'MPS计划统计',
    description: '主生产计划(MPS)统计，根据销售预测和订单制定中长期生产计划，平衡产能与需求',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: 'MPS输入来源于销售预测和订单' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: 'MPS基于半成品BOM和工艺路线' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: 'MPS输出生产工单计划' },
    ],
    stats: [
      { title: '计划周期', dataIndex: 'planPeriod', suffix: '周' },
      { title: '计划产品数', dataIndex: 'productCount', format: 'count', suffix: '个' },
      { title: '产能利用率', dataIndex: 'capacityRate', format: 'percent', suffix: '%' },
      { title: '计划完成率', dataIndex: 'completionRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '计划编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 140, type: 'link' },
      { title: '计划周期', dataIndex: 'period', key: 'period', width: 110, type: 'text' },
      { title: '计划数量', dataIndex: 'planQty', key: 'planQty', width: 100, type: 'number', align: 'right' },
      { title: '已排产', dataIndex: 'scheduledQty', key: 'scheduledQty', width: 90, type: 'number', align: 'right' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '计划日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索计划编号/产品', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '已确认', value: 'completed' },
        { label: '执行中', value: 'processing' },
        { label: '草稿', value: 'pending' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'mrp-demand': {
    title: 'MRP需求统计',
    description: '物料需求计划(MRP)统计，根据BOM和MPS计算物料需求，生成采购建议',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: 'MRP基于半成品BOM展开物料需求' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: 'MRP输出采购建议和请购单' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: 'MRP扣减现有库存计算净需求' },
    ],
    stats: [
      { title: '需求物料数', dataIndex: 'materialCount', format: 'count', suffix: '种' },
      { title: '净需求量', dataIndex: 'netDemand', format: 'count', suffix: '件' },
      { title: '已转采购', dataIndex: 'purchased', format: 'count', suffix: '件' },
      { title: '需求满足率', dataIndex: 'fulfillRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '需求编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 140, type: 'link' },
      { title: '物料分类', dataIndex: 'category', key: 'category', width: 100, type: 'tag' },
      { title: '毛需求', dataIndex: 'grossDemand', key: 'grossDemand', width: 90, type: 'number', align: 'right' },
      { title: '库存可用', dataIndex: 'stockAvailable', key: 'stockAvailable', width: 90, type: 'number', align: 'right' },
      { title: '净需求', dataIndex: 'netDemand', key: 'netDemand', width: 90, type: 'number', align: 'right' },
      { title: '建议采购日期', dataIndex: 'suggestDate', key: 'suggestDate', width: 120, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索物料名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部分类', value: '' },
        { label: '原材料', value: 'raw' },
        { label: '外购件', value: 'purchased' },
        { label: '辅料', value: 'auxiliary' },
      ], label: '分类' },
    ],
    mockData: [],
  },

  'aps-schedule': {
    title: 'APS任务排产',
    description: '高级计划排程(APS)，基于产能约束和订单优先级进行精细化排产',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: 'APS基于MPS计划进行详细排产' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: 'APS排产参考工艺路线和工序工时' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: 'APS排产结果生成生产工单' },
    ],
    stats: [
      { title: '排产任务数', dataIndex: 'taskCount', format: 'count', suffix: '个' },
      { title: '设备利用率', dataIndex: 'machineRate', format: 'percent', suffix: '%' },
      { title: '排产周期', dataIndex: 'schedulePeriod', suffix: '天' },
      { title: '准时开工率', dataIndex: 'onStartRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '任务编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '排产设备', dataIndex: 'machine', key: 'machine', width: 120, type: 'text' },
      { title: '计划数量', dataIndex: 'planQty', key: 'planQty', width: 90, type: 'number', align: 'right' },
      { title: '计划开工', dataIndex: 'startDate', key: 'startDate', width: 110, type: 'date' },
      { title: '计划完工', dataIndex: 'endDate', key: 'endDate', width: 110, type: 'date' },
      { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, type: 'tag' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索任务编号/产品', label: '搜索' },
      { type: 'select', options: [
        { label: '全部优先级', value: '' },
        { label: '紧急', value: 'urgent' },
        { label: '高', value: 'high' },
        { label: '中', value: 'medium' },
        { label: '低', value: 'low' },
      ], label: '优先级' },
    ],
    mockData: [],
  },

  'plan-exec-stats': {
    title: '计划执行统计',
    description: '统计采购计划的执行情况，包括计划下达、到货、验收等各环节完成率',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '执行统计覆盖MRP和MPS的执行结果' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '到货验收后触发入库' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '验收后触发应付账款' },
    ],
    stats: [
      { title: '计划总数', dataIndex: 'totalPlans', format: 'count', suffix: '个' },
      { title: '执行率', dataIndex: 'execRate', format: 'percent', suffix: '%' },
      { title: '按时完成', dataIndex: 'onTime', format: 'count', suffix: '个' },
      { title: '延期', dataIndex: 'delayed', format: 'count', suffix: '个' },
    ],
    columns: [
      { title: '计划编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '计划类型', dataIndex: 'planType', key: 'planType', width: 100, type: 'tag' },
      { title: '计划内容', dataIndex: 'content', key: 'content', width: 150, type: 'text' },
      { title: '计划日期', dataIndex: 'planDate', key: 'planDate', width: 110, type: 'date' },
      { title: '实际日期', dataIndex: 'actualDate', key: 'actualDate', width: 110, type: 'date' },
      { title: '偏差天数', dataIndex: 'deviation', key: 'deviation', width: 90, type: 'number', align: 'center' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索计划编号', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '采购计划', value: 'purchase' },
        { label: '生产计划', value: 'production' },
        { label: '外协计划', value: 'outsource' },
      ], label: '类型' },
    ],
    mockData: [],
  },

  'plan-material-stats': {
    title: '计划用料统计',
    description: '统计生产计划的物料消耗情况，对比计划用料与实际用料，控制物料成本',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '计划用料基于BOM标准用量' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '用料统计关联库存出库记录' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '用料差异影响生产成本核算' },
    ],
    stats: [
      { title: '计划用料种类', dataIndex: 'materialTypes', format: 'count', suffix: '种' },
      { title: '计划总用量', dataIndex: 'planTotal', format: 'count', suffix: '件' },
      { title: '实际总用量', dataIndex: 'actualTotal', format: 'count', suffix: '件' },
      { title: '差异率', dataIndex: 'diffRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 140, type: 'link' },
      { title: '关联产品', dataIndex: 'productName', key: 'productName', width: 130, type: 'text' },
      { title: '计划用量', dataIndex: 'planUsage', key: 'planUsage', width: 100, type: 'number', align: 'right' },
      { title: '实际用量', dataIndex: 'actualUsage', key: 'actualUsage', width: 100, type: 'number', align: 'right' },
      { title: '差异', dataIndex: 'diff', key: 'diff', width: 90, type: 'number', align: 'right' },
      { title: '差异率', dataIndex: 'diffRate', key: 'diffRate', width: 90, type: 'rate', align: 'center' },
      { title: '统计周期', dataIndex: 'period', key: 'period', width: 110, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索物料名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部周期', value: '' },
        { label: '本周', value: 'week' },
        { label: '本月', value: 'month' },
        { label: '本季度', value: 'quarter' },
      ], label: '周期' },
    ],
    mockData: [],
  },
};

// ============ 6. 库存管理模块 ============
export const inventoryPages: Record<string, ChildPageConfig> = {
  'delivery-warning': {
    title: '交货期预警',
    description: '监控采购订单和委外加工的交货期，对即将到期和逾期的进行预警提示',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '预警来源于采购订单交期' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '物料延期影响生产计划执行' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '到货后触发入库检验流程' },
    ],
    stats: [
      { title: '预警总数', dataIndex: 'totalWarnings', format: 'count', suffix: '条' },
      { title: '已逾期', dataIndex: 'overdue', format: 'count', suffix: '条' },
      { title: '3天内到期', dataIndex: 'due3Days', format: 'count', suffix: '条' },
      { title: '7天内到期', dataIndex: 'due7Days', format: 'count', suffix: '条' },
    ],
    columns: [
      { title: '订单编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 130, type: 'link' },
      { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 120, type: 'text' },
      { title: '订单数量', dataIndex: 'quantity', key: 'quantity', width: 90, type: 'number', align: 'right' },
      { title: '承诺交期', dataIndex: 'promiseDate', key: 'promiseDate', width: 110, type: 'date' },
      { title: '剩余天数', dataIndex: 'remainDays', key: 'remainDays', width: 90, type: 'number', align: 'center' },
      { title: '预警级别', dataIndex: 'warnLevel', key: 'warnLevel', width: 100, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索订单编号/物料', label: '搜索' },
      { type: 'select', options: [
        { label: '全部级别', value: '' },
        { label: '紧急(已逾期)', value: 'urgent' },
        { label: '高(3天内)', value: 'high' },
        { label: '中(7天内)', value: 'medium' },
        { label: '正常', value: 'normal' },
      ], label: '预警级别' },
    ],
    mockData: [],
  },

  'task-exec-track': {
    title: '任务执行跟踪',
    description: '跟踪仓储任务的执行情况，包括入库、出库、盘点、移库等任务的进度',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '生产完工触发入库任务' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '销售出库触发拣货任务' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '采购到货触发入库检验' },
    ],
    stats: [
      { title: '待执行任务', dataIndex: 'pendingTasks', format: 'count', suffix: '个' },
      { title: '执行中', dataIndex: 'executing', format: 'count', suffix: '个' },
      { title: '今日完成', dataIndex: 'todayDone', format: 'count', suffix: '个' },
      { title: '异常任务', dataIndex: 'abnormal', format: 'count', suffix: '个' },
    ],
    columns: [
      { title: '任务编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '任务类型', dataIndex: 'taskType', key: 'taskType', width: 100, type: 'tag' },
      { title: '物料/产品', dataIndex: 'itemName', key: 'itemName', width: 130, type: 'link' },
      { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80, type: 'number', align: 'right' },
      { title: '仓库库位', dataIndex: 'location', key: 'location', width: 110, type: 'text' },
      { title: '创建时间', dataIndex: 'createTime', key: 'createTime', width: 110, type: 'date' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索任务编号', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '入库', value: 'inbound' },
        { label: '出库', value: 'outbound' },
        { label: '盘点', value: 'check' },
        { label: '移库', value: 'transfer' },
      ], label: '任务类型' },
    ],
    mockData: [],
  },

  'prod-daily-report': {
    title: '生产日报',
    description: '每日生产情况报告，包括产量、工时、设备运行、质量等关键生产指标',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '日报数据来源于生产工单执行' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '产量关联产品基础信息' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '完工产品触发入库' },
    ],
    stats: [
      { title: '今日产量', dataIndex: 'todayOutput', format: 'count', suffix: '件' },
      { title: '目标产量', dataIndex: 'targetOutput', format: 'count', suffix: '件' },
      { title: '达成率', dataIndex: 'achieveRate', format: 'percent', suffix: '%' },
      { title: '设备运行率', dataIndex: 'machineRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '日报编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '计划产量', dataIndex: 'planQty', key: 'planQty', width: 90, type: 'number', align: 'right' },
      { title: '实际产量', dataIndex: 'actualQty', key: 'actualQty', width: 90, type: 'number', align: 'right' },
      { title: '合格数', dataIndex: 'passQty', key: 'passQty', width: 80, type: 'number', align: 'right' },
      { title: '合格率', dataIndex: 'passRate', key: 'passRate', width: 90, type: 'rate', align: 'center' },
      { title: '生产日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '班组', dataIndex: 'team', key: 'team', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部班组', value: '' },
        { label: '甲班', value: 'A' },
        { label: '乙班', value: 'B' },
        { label: '丙班', value: 'C' },
      ], label: '班组' },
    ],
    mockData: [],
  },

  'pass-rate-stats': {
    title: '合格率统计',
    description: '统计各产品、各工序、各班组的质量合格率，识别质量问题点和改善方向',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '合格率参照工序质量标准' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '合格率是生产质量核心KPI' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '不合格品不入库，单独处理' },
    ],
    stats: [
      { title: '综合合格率', dataIndex: 'overallRate', format: 'percent', suffix: '%' },
      { title: '本月检验批次', dataIndex: 'totalBatches', format: 'count', suffix: '批' },
      { title: '不合格批次', dataIndex: 'failBatches', format: 'count', suffix: '批' },
      { title: '目标合格率', dataIndex: 'targetRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '检验批次', dataIndex: 'batchNo', key: 'batchNo', width: 120, type: 'text' },
      { title: '检验数量', dataIndex: 'checkQty', key: 'checkQty', width: 90, type: 'number', align: 'right' },
      { title: '合格数量', dataIndex: 'passQty', key: 'passQty', width: 90, type: 'number', align: 'right' },
      { title: '不合格数', dataIndex: 'failQty', key: 'failQty', width: 90, type: 'number', align: 'right' },
      { title: '合格率', dataIndex: 'passRate', key: 'passRate', width: 90, type: 'rate', align: 'center' },
      { title: '检验日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '检验员', dataIndex: 'inspector', key: 'inspector', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索产品名称', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部', value: '' },
        { label: '合格(>98%)', value: 'excellent' },
        { label: '正常(95-98%)', value: 'normal' },
        { label: '预警(<95%)', value: 'warning' },
      ], label: '合格率' },
    ],
    mockData: [],
  },

  'prod-in-stats': {
    title: '生产入库统计',
    description: '统计生产完工后的入库情况，包括入库数量、入库时间、入库仓库等',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '生产完工触发入库流程' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '入库更新库存数量' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '入库后产品可销售出库' },
    ],
    stats: [
      { title: '本月入库量', dataIndex: 'monthInQty', format: 'count', suffix: '件' },
      { title: '入库批次', dataIndex: 'inBatches', format: 'count', suffix: '批' },
      { title: '待入库量', dataIndex: 'pendingInQty', format: 'count', suffix: '件' },
      { title: '入库及时率', dataIndex: 'timelyRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '入库单号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 130, type: 'text' },
      { title: '入库数量', dataIndex: 'quantity', key: 'quantity', width: 90, type: 'number', align: 'right' },
      { title: '生产工单', dataIndex: 'woNo', key: 'woNo', width: 120, type: 'text' },
      { title: '入库仓库', dataIndex: 'warehouse', key: 'warehouse', width: 100, type: 'tag' },
      { title: '入库日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '经手人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索入库单号/产品', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部仓库', value: '' },
        { label: '成品仓A', value: 'A' },
        { label: '成品仓B', value: 'B' },
        { label: '半成品仓', value: 'C' },
      ], label: '仓库' },
    ],
    mockData: [],
  },
};

// ============ 7. 财务管理模块 ============
export const financePages: Record<string, ChildPageConfig> = {
  'bank-account': {
    title: '银行账户',
    description: '管理公司银行账户，维护账户余额，记录存入/支出等资金明细，随时掌握公司资金状况',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '销售回款存入银行账户' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '采购付款从银行账户支出' },
      { moduleKey: 'dashboard', moduleLabel: '经营看板', relation: '账户余额反映公司资金状况' },
    ],
    stats: [
      { title: '账户总数', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '总余额', dataIndex: 'totalBalance', format: 'money', prefix: '¥' },
      { title: '正常账户', dataIndex: 'normal', format: 'count', suffix: '个' },
      { title: '冻结账户', dataIndex: 'frozen', format: 'count', suffix: '个' },
    ],
    columnGroups: ['账户信息', '银行信息', '状态与人员'],
    columns: [
      { title: '账户名称', dataIndex: 'name', key: 'name', width: 160, type: 'text', group: '账户信息', defaultVisible: true },
      { title: '账户简称', dataIndex: 'shortName', key: 'shortName', width: 100, type: 'text', group: '账户信息', defaultVisible: true },
      { title: '开户银行', dataIndex: 'bankName', key: 'bankName', width: 160, type: 'text', group: '银行信息', defaultVisible: true },
      { title: '支行名称', dataIndex: 'branchName', key: 'branchName', width: 160, type: 'text', group: '银行信息', defaultVisible: true },
      { title: '银行账号', dataIndex: 'bankAccountNo', key: 'bankAccountNo', width: 180, type: 'text', group: '银行信息', defaultVisible: true },
      { title: '账户类型', dataIndex: 'accountType', key: 'accountType', width: 120, type: 'tag', group: '账户信息', defaultVisible: true },
      { title: '账户余额', dataIndex: 'balance', key: 'balance', width: 130, type: 'money', align: 'right', group: '账户信息', defaultVisible: true },
      { title: '账户状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag', group: '状态与人员', defaultVisible: true },
      { title: '开户日期', dataIndex: 'openDate', key: 'openDate', width: 110, type: 'date', group: '状态与人员', defaultVisible: true },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text', group: '状态与人员', defaultVisible: true },
      { title: 'U盾密码', dataIndex: 'uShieldPwd', key: 'uShieldPwd', width: 110, type: 'text', group: '状态与人员', defaultVisible: true },
      { title: '取款密码', dataIndex: 'withdrawPwd', key: 'withdrawPwd', width: 110, type: 'text', group: '状态与人员', defaultVisible: true },
    ],
    filters: [
      { type: 'input', placeholder: '搜索账户名称/开户银行/银行账号', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '正常', value: '正常' },
        { label: '冻结', value: '冻结' },
      ], label: '状态' },
    ],
    mockData: [
      {
        key: 'ba-1', id: 'BA-1001', name: '公司基本账户', shortName: '工行基本户', bankName: '中国工商银行', branchName: '城东支行',
        bankAccountNo: '6222020200112233',
        accountType: '基本存款账户', balance: 856000, status: '正常', openDate: '2020-05-12',
        person: '王五', date: '', progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '日常收支主账户',
        transactions: [
          { time: '2024-07-01 09:30:00', type: 'in', amount: 500000, balanceAfter: 500000, remark: '期初存入', person: '王五' },
          { time: '2024-07-15 14:20:00', type: 'in', amount: 456000, balanceAfter: 956000, remark: '销售回款', person: '王五' },
          { time: '2024-08-02 10:05:00', type: 'out', amount: 100000, balanceAfter: 856000, remark: '采购付款', person: '王五' },
        ],
      },
      {
        key: 'ba-2', id: 'BA-1002', name: '公司一般账户', shortName: '建行一般户', bankName: '中国建设银行', branchName: '高新支行',
        bankAccountNo: '6228480402564890',
        accountType: '一般存款账户', balance: 328500.5, status: '正常', openDate: '2021-03-08',
        person: '赵六', date: '', progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '',
        transactions: [
          { time: '2024-06-20 11:00:00', type: 'in', amount: 328500.5, balanceAfter: 328500.5, remark: '期初存入', person: '赵六' },
        ],
      },
      {
        key: 'ba-3', id: 'BA-1003', name: '专项资金账户', shortName: '农行专项户', bankName: '中国农业银行', branchName: '开发区支行',
        bankAccountNo: '6217001234567890',
        accountType: '专用存款账户', balance: 0, status: '冻结', openDate: '2019-11-26',
        person: '钱七', date: '', progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '项目专项资金',
        transactions: [],
      },
    ],
  },

  'purchase-demand': {
    title: '采购需求管理',
    description: '管理各部门提交的采购需求，包括需求审批、预算控制、需求合并等',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '审批后的需求生成采购订单' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '需求考虑现有库存量' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '需求参照BOM标准用料' },
    ],
    stats: [
      { title: '待审批需求', dataIndex: 'pendingApproval', format: 'count', suffix: '条' },
      { title: '本月需求总额', dataIndex: 'monthTotal', format: 'money', prefix: '¥' },
      { title: '预算使用率', dataIndex: 'budgetRate', format: 'percent', suffix: '%' },
      { title: '已转采购', dataIndex: 'converted', format: 'count', suffix: '条' },
    ],
    columns: [
      { title: '需求编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '需求部门', dataIndex: 'dept', key: 'dept', width: 110, type: 'tag' },
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 130, type: 'link' },
      { title: '需求数量', dataIndex: 'quantity', key: 'quantity', width: 90, type: 'number', align: 'right' },
      { title: '预算金额', dataIndex: 'amount', key: 'amount', width: 130, type: 'money', align: 'right' },
      { title: '需求日期', dataIndex: 'reqDate', key: 'reqDate', width: 110, type: 'date' },
      { title: '紧急程度', dataIndex: 'urgency', key: 'urgency', width: 90, type: 'tag' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索需求编号/物料', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '待审批', value: 'pending' },
        { label: '已审批', value: 'completed' },
        { label: '已驳回', value: 'cancelled' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'purchase-analysis': {
    title: '采购经营分析',
    description: '分析采购经营状况，包括采购成本、供应商绩效、采购效率等多维度分析',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '分析数据来源于采购订单和执行记录' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '采购成本影响产品毛利率' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '采购效率影响库存周转' },
    ],
    stats: [
      { title: '本月采购额', dataIndex: 'monthPurchase', format: 'money', prefix: '¥' },
      { title: '成本节约', dataIndex: 'costSaving', format: 'money', prefix: '¥' },
      { title: '供应商数', dataIndex: 'supplierCount', format: 'count', suffix: '家' },
      { title: '采购效率', dataIndex: 'efficiency', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '分析维度', dataIndex: 'dimension', key: 'dimension', width: 110, type: 'tag' },
      { title: '分类', dataIndex: 'category', key: 'category', width: 130, type: 'text' },
      { title: '采购额(万)', dataIndex: 'purchaseAmount', key: 'purchaseAmount', width: 130, type: 'money', align: 'right' },
      { title: '占比', dataIndex: 'proportion', key: 'proportion', width: 100, type: 'progress' },
      { title: '同比增长', dataIndex: 'yoy', key: 'yoy', width: 100, type: 'rate', align: 'center' },
      { title: '供应商数', dataIndex: 'supplierCount', key: 'supplierCount', width: 90, type: 'number', align: 'center' },
    ],
    filters: [
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部维度', value: '' },
        { label: '按物料类别', value: '物料' },
        { label: '按供应商', value: '供应商' },
        { label: '按部门', value: '部门' },
      ], label: '维度' },
    ],
    mockData: [],
  },

  'cost-fluctuation': {
    title: '成本波动分析',
    description: '监控和分析原材料及外购件的采购成本波动，识别成本异常，辅助成本控制',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '成本数据来源于采购价格记录' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '成本波动影响产品定价策略' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '标准成本是波动的参照基准' },
    ],
    stats: [
      { title: '成本波动物料', dataIndex: 'fluctuateItems', format: 'count', suffix: '种' },
      { title: '平均涨幅', dataIndex: 'avgIncrease', format: 'percent', suffix: '%' },
      { title: '成本影响额', dataIndex: 'costImpact', format: 'money', prefix: '¥' },
      { title: '降价物料', dataIndex: 'decreaseItems', format: 'count', suffix: '种' },
    ],
    columns: [
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 130, type: 'link' },
      { title: '标准成本', dataIndex: 'stdCost', key: 'stdCost', width: 120, type: 'money', align: 'right' },
      { title: '最新采购价', dataIndex: 'latestPrice', key: 'latestPrice', width: 120, type: 'money', align: 'right' },
      { title: '上月均价', dataIndex: 'lastMonthAvg', key: 'lastMonthAvg', width: 120, type: 'money', align: 'right' },
      { title: '环比变化', dataIndex: 'mom', key: 'mom', width: 100, type: 'rate', align: 'center' },
      { title: '同比变化', dataIndex: 'yoy', key: 'yoy', width: 100, type: 'rate', align: 'center' },
      { title: '趋势', dataIndex: 'trend', key: 'trend', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索物料名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部趋势', value: '' },
        { label: '持续上涨', value: 'up' },
        { label: '持续下降', value: 'down' },
        { label: '波动', value: 'fluctuate' },
        { label: '稳定', value: 'stable' },
      ], label: '趋势' },
    ],
    mockData: [],
  },

  'purchase-efficiency': {
    title: '采购效率分析',
    description: '分析采购全流程效率，包括需求响应、询价比价、订单下达、到货验收各环节时效',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '效率数据来源于采购流程各节点' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '采购效率影响库存周转速度' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '采购延迟影响生产计划执行' },
    ],
    stats: [
      { title: '平均采购周期', dataIndex: 'avgCycle', suffix: '天' },
      { title: '准时到货率', dataIndex: 'onTimeRate', format: 'percent', suffix: '%' },
      { title: '紧急采购占比', dataIndex: 'urgentRate', format: 'percent', suffix: '%' },
      { title: '询价平均天数', dataIndex: 'avgInquiry', suffix: '天' },
    ],
    columns: [
      { title: '采购订单', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 130, type: 'link' },
      { title: '需求响应(天)', dataIndex: 'reqResponse', key: 'reqResponse', width: 110, type: 'number', align: 'center' },
      { title: '询价比价(天)', dataIndex: 'inquiryDays', key: 'inquiryDays', width: 110, type: 'number', align: 'center' },
      { title: '审批(天)', dataIndex: 'approvalDays', key: 'approvalDays', width: 80, type: 'number', align: 'center' },
      { title: '交货(天)', dataIndex: 'deliveryDays', key: 'deliveryDays', width: 80, type: 'number', align: 'center' },
      { title: '总周期(天)', dataIndex: 'totalDays', key: 'totalDays', width: 100, type: 'number', align: 'center' },
      { title: '效率评级', dataIndex: 'efficiency', key: 'efficiency', width: 100, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索采购订单/物料', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
    ],
    mockData: [],
  },

  'purchase-in-stats': {
    title: '采购入库统计',
    description: '统计采购到货后的入库情况，包括到货数量、验收合格率、入库及时性等',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '入库对应采购订单的到货验收' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '入库更新库存数量和成本' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '入库后生成应付账款凭证' },
    ],
    stats: [
      { title: '本月入库量', dataIndex: 'monthInQty', format: 'count', suffix: '件' },
      { title: '入库金额', dataIndex: 'inAmount', format: 'money', prefix: '¥' },
      { title: '验收合格率', dataIndex: 'acceptRate', format: 'percent', suffix: '%' },
      { title: '待入库订单', dataIndex: 'pendingIn', format: 'count', suffix: '单' },
    ],
    columns: [
      { title: '入库单号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '物料名称', dataIndex: 'materialName', key: 'materialName', width: 130, type: 'link' },
      { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 120, type: 'text' },
      { title: '到货数量', dataIndex: 'arrivalQty', key: 'arrivalQty', width: 90, type: 'number', align: 'right' },
      { title: '合格数量', dataIndex: 'passQty', key: 'passQty', width: 90, type: 'number', align: 'right' },
      { title: '入库金额', dataIndex: 'amount', key: 'amount', width: 130, type: 'money', align: 'right' },
      { title: '入库日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索入库单号/物料', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
    ],
    mockData: [],
  },

  // 对账管理
  'reconciliation': {
    title: '对账管理',
    description: '客户对账与供应商对账，以单据编号为基准进行金额核对，支持自动比对与差异标注',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '客户对账基于销售订单和出库单据' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '供应商对账基于采购订单和入库单据' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '出入库单据是对账的核心凭证' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '对账结果关联客户信用和回款状态' },
    ],
    stats: [
      { title: '待对账单据', dataIndex: 'pendingRecon', format: 'count', suffix: '张' },
      { title: '已对账一致', dataIndex: 'matchedCount', format: 'count', suffix: '张' },
      { title: '对账差异', dataIndex: 'diffCount', format: 'count', suffix: '张' },
      { title: '对账完成率', dataIndex: 'reconRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '单据编号', dataIndex: 'docNo', key: 'docNo', width: 140, type: 'text' },
      { title: '对账类型', dataIndex: 'reconType', key: 'reconType', width: 100, type: 'tag' },
      { title: '对方名称', dataIndex: 'counterparty', key: 'counterparty', width: 150, type: 'text' },
      { title: '本方金额', dataIndex: 'ourAmount', key: 'ourAmount', width: 130, type: 'money', align: 'right' },
      { title: '对方金额', dataIndex: 'theirAmount', key: 'theirAmount', width: 130, type: 'money', align: 'right' },
      { title: '对账结果', dataIndex: 'reconResult', key: 'reconResult', width: 150, type: 'tag' },
      { title: '差异说明', dataIndex: 'diffDesc', key: 'diffDesc', width: 200, type: 'text' },
      { title: '对账日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索单据编号/对方名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '客户对账', value: 'customer' },
        { label: '供应商对账', value: 'supplier' },
      ], label: '对账类型' },
      { type: 'select', options: [
        { label: '全部结果', value: '' },
        { label: '金额一致', value: 'matched' },
        { label: '金额一致/明细不一致', value: 'detail_diff' },
        { label: '金额不一致', value: 'amount_diff' },
        { label: '对方未入账', value: 'pending' },
      ], label: '对账结果' },
      { type: 'dateRange', placeholder: '', label: '日期' },
    ],
    mockData: [
      { key: '1', docNo: 'SO-2024-00156', reconType: 'customer', counterparty: '华东科技有限公司', ourAmount: 128000, theirAmount: 128000, reconResult: 'matched', diffDesc: '', date: '2024-06-20', status: 'completed', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '2', docNo: 'SO-2024-00178', reconType: 'customer', counterparty: '南方精密制造', ourAmount: 96500, theirAmount: 96500, reconResult: 'detail_diff', diffDesc: '金额一致，数量与货号不一致', date: '2024-06-21', status: 'warning', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '3', docNo: 'PO-2024-00321', reconType: 'supplier', counterparty: '北方钢铁集团', ourAmount: 256000, theirAmount: 248000, reconResult: 'amount_diff', diffDesc: '金额差异8000元，需人工核查', date: '2024-06-22', status: 'warning', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '4', docNo: 'SO-2024-00192', reconType: 'customer', counterparty: '西部电子股份', ourAmount: 43500, theirAmount: 0, reconResult: 'pending', diffDesc: '对方尚未入账，等待客户确认', date: '2024-06-23', status: 'pending', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '5', docNo: 'PO-2024-00405', reconType: 'supplier', counterparty: '东南新材料公司', ourAmount: 182000, theirAmount: 182000, reconResult: 'matched', diffDesc: '', date: '2024-06-24', status: 'completed', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '6', docNo: 'SO-2024-00210', reconType: 'customer', counterparty: '中联重科股份', ourAmount: 789000, theirAmount: 0, reconResult: 'pending', diffDesc: '对方尚未入账，等待客户确认', date: '2024-06-25', status: 'pending', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '7', docNo: 'PO-2024-00456', reconType: 'supplier', counterparty: '华北机电设备', ourAmount: 345000, theirAmount: 345000, reconResult: 'detail_diff', diffDesc: '金额一致，数量与货号不一致', date: '2024-06-25', status: 'warning', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
      { key: '8', docNo: 'SO-2024-00234', reconType: 'customer', counterparty: '长三角贸易集团', ourAmount: 156000, theirAmount: 152500, reconResult: 'amount_diff', diffDesc: '金额差异3500元，需人工核查', date: '2024-06-26', status: 'warning', name: '', person: '', dept: '', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '', remark: '' },
    ],
  },
};

// ============ 8. 经营看板模块 ============
export const dashboardPages: Record<string, ChildPageConfig> = {
  'arrival-remind': {
    title: '到货期提醒',
    description: '监控所有采购订单和委外加工单的到货期，全视角预警即将到期和逾期的订单',
    relatedModules: [
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '到货提醒覆盖采购订单' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '物料延期影响生产计划' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '到货后进入入库流程' },
    ],
    stats: [
      { title: '待收货订单', dataIndex: 'pendingReceive', format: 'count', suffix: '单' },
      { title: '已逾期', dataIndex: 'overdue', format: 'count', suffix: '单' },
      { title: '今日预计到货', dataIndex: 'todayExpected', format: 'count', suffix: '单' },
      { title: '本周预计到货', dataIndex: 'weekExpected', format: 'count', suffix: '单' },
    ],
    columns: [
      { title: '订单编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '物料/产品', dataIndex: 'itemName', key: 'itemName', width: 130, type: 'link' },
      { title: '供应商/来源', dataIndex: 'source', key: 'source', width: 130, type: 'text' },
      { title: '订单数量', dataIndex: 'quantity', key: 'quantity', width: 90, type: 'number', align: 'right' },
      { title: '预计到货', dataIndex: 'expectedDate', key: 'expectedDate', width: 110, type: 'date' },
      { title: '剩余天数', dataIndex: 'remainDays', key: 'remainDays', width: 90, type: 'number', align: 'center' },
      { title: '预警级别', dataIndex: 'warnLevel', key: 'warnLevel', width: 100, type: 'tag' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索订单编号/物料', label: '搜索' },
      { type: 'select', options: [
        { label: '全部级别', value: '' },
        { label: '紧急(已逾期)', value: 'urgent' },
        { label: '高(3天内)', value: 'high' },
        { label: '中(7天内)', value: 'medium' },
        { label: '正常', value: 'normal' },
      ], label: '预警级别' },
    ],
    mockData: [],
  },

  'order-exec-track': {
    title: '订单执行跟踪',
    description: '全局订单执行进度看板，涵盖销售订单、生产工单、采购订单的执行状态',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '销售订单执行进度' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '生产工单执行进度' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '采购订单执行进度' },
    ],
    stats: [
      { title: '订单总数', dataIndex: 'totalOrders', format: 'count', suffix: '单' },
      { title: '正常执行', dataIndex: 'normalExec', format: 'count', suffix: '单' },
      { title: '延迟预警', dataIndex: 'delayWarning', format: 'count', suffix: '单' },
      { title: '已完成', dataIndex: 'completed', format: 'count', suffix: '单' },
    ],
    columns: [
      { title: '订单编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '订单类型', dataIndex: 'orderType', key: 'orderType', width: 100, type: 'tag' },
      { title: '关联对象', dataIndex: 'relatedTo', key: 'relatedTo', width: 130, type: 'link' },
      { title: '金额/数量', dataIndex: 'amount', key: 'amount', width: 120, type: 'money', align: 'right' },
      { title: '下单日期', dataIndex: 'orderDate', key: 'orderDate', width: 110, type: 'date' },
      { title: '预计完成', dataIndex: 'dueDate', key: 'dueDate', width: 110, type: 'date' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索订单编号', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '销售订单', value: 'sales' },
        { label: '生产工单', value: 'production' },
        { label: '采购订单', value: 'purchase' },
      ], label: '订单类型' },
    ],
    mockData: [],
  },

  'inventory-period': {
    title: '库存期初期末',
    description: '统计各仓库的期初库存、本期入库、本期出库、期末库存，掌握库存动态变化',
    relatedModules: [
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '库存变动数据来源于出入库记录' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '生产入库和领料出库' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '采购入库影响库存增加' },
    ],
    stats: [
      { title: '期初库存总额', dataIndex: 'beginTotal', format: 'money', prefix: '¥' },
      { title: '本期入库', dataIndex: 'periodIn', format: 'money', prefix: '¥' },
      { title: '本期出库', dataIndex: 'periodOut', format: 'money', prefix: '¥' },
      { title: '期末库存总额', dataIndex: 'endTotal', format: 'money', prefix: '¥' },
    ],
    columns: [
      { title: '物料/产品', dataIndex: 'itemName', key: 'itemName', width: 130, type: 'link' },
      { title: '仓库', dataIndex: 'warehouse', key: 'warehouse', width: 100, type: 'tag' },
      { title: '期初数量', dataIndex: 'beginQty', key: 'beginQty', width: 90, type: 'number', align: 'right' },
      { title: '期初金额', dataIndex: 'beginAmount', key: 'beginAmount', width: 120, type: 'money', align: 'right' },
      { title: '本期入库', dataIndex: 'inQty', key: 'inQty', width: 90, type: 'number', align: 'right' },
      { title: '本期出库', dataIndex: 'outQty', key: 'outQty', width: 90, type: 'number', align: 'right' },
      { title: '期末数量', dataIndex: 'endQty', key: 'endQty', width: 90, type: 'number', align: 'right' },
      { title: '期末金额', dataIndex: 'endAmount', key: 'endAmount', width: 120, type: 'money', align: 'right' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索物料/产品', label: '搜索' },
      { type: 'select', options: [
        { label: '全部仓库', value: '' },
        { label: '原材料仓', value: 'raw' },
        { label: '半成品仓', value: 'semi' },
        { label: '成品仓', value: 'finished' },
      ], label: '仓库' },
    ],
    mockData: [],
  },

  'inventory-warning': {
    title: '库存预警',
    description: '全视角库存预警看板，包括安全库存预警、超储预警、呆滞料预警等',
    relatedModules: [
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '预警来源于库存实时数据' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '低库存预警触发采购补货' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '库存不足影响生产计划' },
    ],
    stats: [
      { title: '预警总数', dataIndex: 'totalWarnings', format: 'count', suffix: '条' },
      { title: '低于安全库存', dataIndex: 'belowSafety', format: 'count', suffix: '种' },
      { title: '呆滞料(>90天)', dataIndex: 'slowMoving', format: 'count', suffix: '种' },
      { title: '超储物料', dataIndex: 'overStock', format: 'count', suffix: '种' },
    ],
    columns: [
      { title: '物料名称', dataIndex: 'itemName', key: 'itemName', width: 130, type: 'link' },
      { title: '当前库存', dataIndex: 'currentStock', key: 'currentStock', width: 90, type: 'number', align: 'right' },
      { title: '安全库存', dataIndex: 'safetyStock', key: 'safetyStock', width: 90, type: 'number', align: 'right' },
      { title: '最大库存', dataIndex: 'maxStock', key: 'maxStock', width: 90, type: 'number', align: 'right' },
      { title: '预警类型', dataIndex: 'warnType', key: 'warnType', width: 120, type: 'tag' },
      { title: '预警级别', dataIndex: 'warnLevel', key: 'warnLevel', width: 100, type: 'tag' },
      { title: '上次出入库', dataIndex: 'lastMoveDate', key: 'lastMoveDate', width: 110, type: 'date' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索物料名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '低于安全库存', value: 'safety' },
        { label: '呆滞预警', value: 'slow' },
        { label: '超储预警', value: 'over' },
      ], label: '预警类型' },
    ],
    mockData: [],
  },

  'inventory-check-stats': {
    title: '盘点统计',
    description: '统计各仓库的盘点结果，包括盘盈盘亏、盘点差异率、盘点覆盖率等',
    relatedModules: [
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '盘点更新库存账面数量' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '盘点差异影响资产核算' },
    ],
    stats: [
      { title: '盘点覆盖率', dataIndex: 'coverageRate', format: 'percent', suffix: '%' },
      { title: '盘盈金额', dataIndex: 'surplusAmount', format: 'money', prefix: '¥' },
      { title: '盘亏金额', dataIndex: 'shortageAmount', format: 'money', prefix: '¥' },
      { title: '差异率', dataIndex: 'diffRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '盘点单号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '仓库', dataIndex: 'warehouse', key: 'warehouse', width: 100, type: 'tag' },
      { title: '盘点类型', dataIndex: 'checkType', key: 'checkType', width: 100, type: 'tag' },
      { title: '盘点物料数', dataIndex: 'itemCount', key: 'itemCount', width: 100, type: 'number', align: 'center' },
      { title: '账面金额', dataIndex: 'bookAmount', key: 'bookAmount', width: 130, type: 'money', align: 'right' },
      { title: '实盘金额', dataIndex: 'actualAmount', key: 'actualAmount', width: 130, type: 'money', align: 'right' },
      { title: '差异金额', dataIndex: 'diffAmount', key: 'diffAmount', width: 120, type: 'money', align: 'right' },
      { title: '盘点日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索盘点单号', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部仓库', value: '' },
        { label: '原材料仓', value: 'raw' },
        { label: '半成品仓', value: 'semi' },
        { label: '成品仓', value: 'finished' },
      ], label: '仓库' },
    ],
    mockData: [],
  },
};

// ============ 9. 系统设置模块 ============
export const settingsPages: Record<string, ChildPageConfig> = {
  'account-manage': {
    title: '账号管理',
    description: '管理系统账号，支持新建子账号、分配角色权限、查看账号状态及操作日志',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '账号权限控制基础数据的查看和编辑范围' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '财务数据敏感度高，需通过账号权限进行访问控制' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '销售数据的查看和报价操作受账号角色控制' },
    ],
    stats: [
      { title: '总账号数', dataIndex: 'totalAccounts', format: 'count', suffix: '个' },
      { title: '启用账号', dataIndex: 'activeAccounts', format: 'count', suffix: '个' },
      { title: '子账号数', dataIndex: 'subAccounts', format: 'count', suffix: '个' },
      { title: '今日操作记录', dataIndex: 'todayLogs', format: 'count', suffix: '条' },
    ],
    columns: [
      { title: '账号ID', dataIndex: 'id', key: 'id', width: 110, type: 'text' },
      { title: '用户名', dataIndex: 'username', key: 'username', width: 120, type: 'text' },
      { title: '显示名称', dataIndex: 'displayName', key: 'displayName', width: 130, type: 'text' },
      { title: '角色', dataIndex: 'role', key: 'role', width: 100, type: 'tag' },
      { title: '账号类型', dataIndex: 'accountType', key: 'accountType', width: 100, type: 'tag' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
      { title: '所属部门', dataIndex: 'dept', key: 'dept', width: 120, type: 'text' },
      { title: '创建时间', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '最近登录', dataIndex: 'lastLogin', key: 'lastLogin', width: 110, type: 'date' },
      { title: '备注', dataIndex: 'remark', key: 'remark', width: 150, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索用户名/显示名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '正常', value: 'normal' },
        { label: '禁用', value: 'disabled' },
      ], label: '状态' },
      { type: 'select', options: [
        { label: '全部角色', value: '' },
        { label: '超级管理员', value: 'super_admin' },
        { label: '管理员', value: 'admin' },
        { label: '普通用户', value: 'user' },
        { label: '只读用户', value: 'viewer' },
      ], label: '角色' },
    ],
    mockData: [
      { key: '1', id: 'ACC-001', username: 'admin', displayName: '系统管理员', role: 'super_admin', accountType: '主账号', status: 'normal', dept: '信息部', date: '2024-01-01', lastLogin: '2024-06-26', remark: '系统超级管理员', person: '管理员', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '2', id: 'ACC-002', username: 'zhangsan', displayName: '张三', role: 'admin', accountType: '子账号', status: 'normal', dept: '制造一部', date: '2024-01-15', lastLogin: '2024-06-25', remark: '生产管理权限', person: '张三', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '3', id: 'ACC-003', username: 'lisi', displayName: '李四', role: 'user', accountType: '子账号', status: 'normal', dept: '销售部', date: '2024-02-20', lastLogin: '2024-06-24', remark: '销售数据查看', person: '李四', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '4', id: 'ACC-004', username: 'wangwu', displayName: '王五', role: 'user', accountType: '子账号', status: 'normal', dept: '采购部', date: '2024-03-10', lastLogin: '2024-06-23', remark: '采购管理权限', person: '王五', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '5', id: 'ACC-005', username: 'zhaoliu', displayName: '赵六', role: 'user', accountType: '子账号', status: 'disabled', dept: '仓储部', date: '2024-04-05', lastLogin: '2024-05-20', remark: '库存管理权限（已禁用）', person: '赵六', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '6', id: 'ACC-006', username: 'qianqi', displayName: '钱七', role: 'viewer', accountType: '子账号', status: 'normal', dept: '财务部', date: '2024-04-18', lastLogin: '2024-06-22', remark: '财务报表只读', person: '钱七', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '7', id: 'ACC-007', username: 'sunba', displayName: '孙八', role: 'admin', accountType: '子账号', status: 'normal', dept: '品质部', date: '2024-05-12', lastLogin: '2024-06-21', remark: '质量管理权限', person: '孙八', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
      { key: '8', id: 'ACC-008', username: 'zhoujiu', displayName: '周九', role: 'viewer', accountType: '子账号', status: 'normal', dept: '销售部', date: '2024-06-01', lastLogin: '2024-06-20', remark: '销售数据只读', person: '周九', amount: 0, quantity: 0, progress: 0, passRate: '', deliveryDays: 0, margin: '' },
    ],
  },

  // ============ 费用管理（合并生产管理费 + 发货快递费） ============
  'expense-fee': {
    title: '费用管理',
    description: '管理生产管理费用和发货快递费用，生产管理费自动计入成品成本价',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '生产管理费自动计入成品成本价，发货费关联产品发货信息' },
    ],
    stats: [
      { title: '费用项数', dataIndex: 'totalFees', format: 'count', suffix: '项' },
      { title: '启用项数', dataIndex: 'activeFees', format: 'count', suffix: '项' },
      { title: '费用总额', dataIndex: 'totalAmount', format: 'money', suffix: '元' },
      { title: '本月新增', dataIndex: 'monthNew', format: 'count', suffix: '项' },
    ],
    // 默认列（生产管理费），会被 tabs 中的活动 Tab 覆盖
    columns: [
      { title: '费用名称', dataIndex: 'name', key: 'name', width: 150, type: 'text', group: '基本信息' },
      { title: '计算方式', dataIndex: 'calcMode', key: 'calcMode', width: 100, type: 'tag', group: '基本信息', align: 'center' },
      { title: '年度总额', dataIndex: 'annualAmount', key: 'annualAmount', width: 120, type: 'number', group: '基本信息', align: 'right' },
      { title: '保底产量', dataIndex: 'baseQuantity', key: 'baseQuantity', width: 120, type: 'number', group: '基本信息', align: 'right' },
      { title: '单双成本', dataIndex: 'unitCost', key: 'unitCost', width: 110, type: 'number', group: '基本信息', align: 'right' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 80, type: 'tag', group: '基本信息', align: 'center' },
      { title: '备注', dataIndex: 'remark', key: 'remark', width: 180, type: 'text', group: '基本信息' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索费用名称', label: '搜索' },
    ],
    tabs: [
      {
        key: 'production-fee',
        label: '生产管理费',
        formType: 'formula' as const,
        columns: [
          { title: '费用名称', dataIndex: 'name', key: 'name', width: 150, type: 'text', group: '基本信息' },
          { title: '计算方式', dataIndex: 'calcMode', key: 'calcMode', width: 100, type: 'tag', group: '基本信息', align: 'center' },
          { title: '年度总额', dataIndex: 'annualAmount', key: 'annualAmount', width: 130, type: 'number', group: '基本信息', align: 'right' },
          { title: '保底产量(双)', dataIndex: 'baseQuantity', key: 'baseQuantity', width: 130, type: 'number', group: '基本信息', align: 'right' },
          { title: '单双成本', dataIndex: 'unitCost', key: 'unitCost', width: 120, type: 'number', group: '基本信息', align: 'right' },
          { title: '状态', dataIndex: 'status', key: 'status', width: 80, type: 'tag', group: '基本信息', align: 'center' },
          { title: '创建时间', dataIndex: 'date', key: 'date', width: 110, type: 'date', group: '基本信息' },
          { title: '备注', dataIndex: 'remark', key: 'remark', width: 180, type: 'text', group: '基本信息' },
        ],
        filters: [
          { type: 'input', placeholder: '搜索费用名称', label: '搜索' },
        ],
      },
      {
        key: 'logistics-fee',
        label: '物流费',
        formType: 'simple' as const,
        columns: [
          { title: '费用名称', dataIndex: 'name', key: 'name', width: 150, type: 'text', group: '基本信息' },
          { title: '费用金额', dataIndex: 'amount', key: 'amount', width: 120, type: 'number', group: '基本信息', align: 'right' },
          { title: '物流公司', dataIndex: 'expressCompany', key: 'expressCompany', width: 120, type: 'text', group: '基本信息' },
          { title: '适用地区', dataIndex: 'region', key: 'region', width: 120, type: 'text', group: '基本信息' },
          { title: '状态', dataIndex: 'status', key: 'status', width: 80, type: 'tag', group: '基本信息', align: 'center' },
          { title: '创建时间', dataIndex: 'date', key: 'date', width: 110, type: 'date', group: '基本信息' },
          { title: '备注', dataIndex: 'remark', key: 'remark', width: 200, type: 'text', group: '基本信息' },
        ],
        filters: [
          { type: 'input', placeholder: '搜索费用名称', label: '搜索' },
        ],
      },
    ],
    mockData: [],
  },
  'warehouse-manage': {
    title: '仓位管理',
    description: '管理仓库仓位分布，支持仓储类型切换、区位配置、仓位增删改查及仓内流程导航',
    relatedModules: [
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '仓位是库存管理的物理载体，库存数据与仓位绑定' },
    ],
    stats: [
      { title: '仓储类型', dataIndex: 'warehouseTypes', format: 'count', suffix: '个' },
      { title: '总区位数', dataIndex: 'totalZones', format: 'count', suffix: '个' },
      { title: '总仓位数', dataIndex: 'totalPositions', format: 'count', suffix: '个' },
      { title: '已用仓位', dataIndex: 'usedPositions', format: 'count', suffix: '个' },
    ],
    columns: [],
    filters: [],
    mockData: [],
  },
  'print-template': {
    title: '打印模板',
    description: '管理拣货单、吊牌、箱唛、唛头等打印模板，支持拖拽字段、设置纸张尺寸和打印方向',
    relatedModules: [],
    stats: [],
    columns: [],
    filters: [],
    mockData: [],
  },
};

// 导出所有页面配置的合并映射（暂时注释，因为变量作用域问题）
/*
export const getAllPageConfigs = (): Record<string, Record<string, ChildPageConfig>> => ({
  'basic-data': basicDataPages,
  customer: customerPages,
  sales: salesPages,
  production: productionPages,
  purchase: purchasePages,
  inventory: inventoryPages,
  finance: financePages,
  dashboard: dashboardPages,
  settings: settingsPages,
});
*/
