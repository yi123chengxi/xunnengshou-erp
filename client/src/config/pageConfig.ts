/**
 * 页面配置：定义每个子功能页面的专属内容
 * 包含：模块间关联关系、页面特有功能、表单字段等
 */

// 状态类型
export type RecordStatus = 'completed' | 'processing' | 'pending' | 'warning' | 'cancelled' | 'overdue' | 'normal';

export interface ColumnConfig {
  title: string;
  dataIndex: string;
  key: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  type: 'text' | 'number' | 'money' | 'tag' | 'progress' | 'date' | 'link' | 'rate' | 'image' | 'boolean' | 'ellipsis';
  group?: string;
  defaultVisible?: boolean;
  fixed?: 'left' | 'right';
  sorter?: boolean;
}

export interface FilterConfig {
  type: 'input' | 'select' | 'dateRange' | 'date' | 'numberRange' | 'productCodePick';
  placeholder?: string;
  options?: { label: string; value: string }[];
  label: string;
}

export interface StatConfig {
  title: string;
  dataIndex: string;
  format?: 'number' | 'money' | 'percent' | 'count';
  prefix?: string;
  suffix?: string;
  color?: string;
}

export interface TabConfig {
  key: string;
  label: string;
  columns: ColumnConfig[];
  filters: FilterConfig[];
  // 表单类型：formula=公式计算模式, simple=简单金额模式
  formType?: 'formula' | 'simple';
}

export interface ChildPageConfig {
  // 页面标题
  title: string;
  // 页面描述
  description: string;
  // 关联的其他模块（体现业务流转关系）
  relatedModules: {
    moduleKey: string;
    moduleLabel: string;
    relation: string; // 关联说明
    childKey?: string;
  }[];
  // 统计卡片配置
  stats: StatConfig[];
  // 表格列配置
  columns: ColumnConfig[];
  // 筛选器配置
  filters: FilterConfig[];
  // 表格数据
  mockData: Record<string, any>[];
  // 列分组（用于显示字段调整）
  columnGroups?: string[];
  // 产品种类过滤（成品/半成品/原材料页面共享产品列表数据）
  productTypeFilter?: '成品' | '半成品' | '原材料';
  // Tab 配置（用于多 Tab 页面，如费用管理）
  tabs?: TabConfig[];
}

// 生成模拟数据
const generateData = (
  prefix: string,
  count: number,
  extra?: Record<string, any>[]
): Record<string, any>[] => {
  const statuses: RecordStatus[] = ['completed', 'processing', 'pending', 'warning', 'cancelled', 'overdue', 'normal'];
  const persons = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十'];
  const depts = ['制造一部', '制造二部', '品质部', '仓储部', '采购部', '销售部', '财务部'];

  const base = Array.from({ length: count }, (_, i) => ({
    key: `${prefix}-${i + 1}`,
    id: `${prefix.toUpperCase()}-${String(20240001 + i)}`,
    name: `${prefix}项目-${String(i + 1).padStart(3, '0')}`,
    status: statuses[i % statuses.length],
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

  return base;
};

// ============ 产品列表共享列配置 ============
const productListColumnGroups = ['基本信息', '价格', '规格属性', '库存', '销售统计', '其它'];
const productListColumns: ColumnConfig[] = [
  // 基本信息
  { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 120, type: 'text', group: '基本信息', defaultVisible: true, fixed: 'left' },
  { title: '图片', dataIndex: 'image', key: 'image', width: 70, type: 'image', group: '基本信息', defaultVisible: true, align: 'center' },
  { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 140, type: 'text', group: '基本信息', defaultVisible: true },
  { title: '主仓位', dataIndex: 'mainLocation', key: 'mainLocation', width: 100, type: 'text', group: '库存', defaultVisible: true },
  { title: '条形码', dataIndex: 'barcode', key: 'barcode', width: 140, type: 'text', group: '基本信息', defaultVisible: true },
  { title: '商品简称', dataIndex: 'shortName', key: 'shortName', width: 120, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '国标码', dataIndex: 'nationalCode', key: 'nationalCode', width: 130, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '辅助码', dataIndex: 'auxCode', key: 'auxCode', width: 130, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '模具编号', dataIndex: 'moldCode', key: 'moldCode', width: 120, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '商品标签', dataIndex: 'productTags', key: 'productTags', width: 120, type: 'tag', group: '基本信息', defaultVisible: false },
  { title: '商品属性', dataIndex: 'productAttrs', key: 'productAttrs', width: 120, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '商品状态', dataIndex: 'productStatus', key: 'productStatus', width: 90, type: 'tag', group: '基本信息', defaultVisible: true, align: 'center' },
  { title: '产品种类', dataIndex: 'productType', key: 'productType', width: 100, type: 'tag', group: '基本信息', defaultVisible: true, align: 'center' },
  { title: '层级', dataIndex: 'level', key: 'level', width: 70, type: 'number', group: '基本信息', defaultVisible: true, align: 'center' },
  { title: '单位', dataIndex: 'unit', key: 'unit', width: 70, type: 'text', group: '基本信息', defaultVisible: true, align: 'center' },
  { title: '供应商名称', dataIndex: 'supplierName', key: 'supplierName', width: 140, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '供应商编号', dataIndex: 'supplierCode', key: 'supplierCode', width: 120, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, type: 'text', group: '基本信息', defaultVisible: false },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 110, type: 'date', group: '基本信息', defaultVisible: false },
  { title: '修改时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 110, type: 'date', group: '基本信息', defaultVisible: false },
  // 价格
  { title: '基础售价', dataIndex: 'suggestedPrice', key: 'suggestedPrice', width: 100, type: 'money', group: '价格', defaultVisible: true, align: 'right', sorter: true },
  { title: '建议零售价', dataIndex: 'retailPrice', key: 'retailPrice', width: 110, type: 'money', group: '价格', defaultVisible: true, align: 'right', sorter: true },
  { title: '成本价', dataIndex: 'costPrice', key: 'costPrice', width: 100, type: 'money', group: '价格', defaultVisible: false, align: 'right', sorter: true },
  { title: '其它价格1', dataIndex: 'otherPrice1', key: 'otherPrice1', width: 100, type: 'money', group: '价格', defaultVisible: false, align: 'right' },
  // 规格属性
  { title: '颜色及规格', dataIndex: 'colorSpec', key: 'colorSpec', width: 120, type: 'text', group: '规格属性', defaultVisible: false },
  { title: '颜色', dataIndex: 'color', key: 'color', width: 80, type: 'text', group: '规格属性', defaultVisible: true },
  { title: '规格', dataIndex: 'spec', key: 'spec', width: 80, type: 'text', group: '规格属性', defaultVisible: true },
  { title: '品牌', dataIndex: 'brand', key: 'brand', width: 90, type: 'text', group: '规格属性', defaultVisible: true },
  { title: '分类', dataIndex: 'category', key: 'category', width: 100, type: 'tag', group: '规格属性', defaultVisible: true },
  { title: '重量', dataIndex: 'weight', key: 'weight', width: 80, type: 'text', group: '规格属性', defaultVisible: false },
  { title: '重量kg', dataIndex: 'weightKg', key: 'weightKg', width: 80, type: 'number', group: '规格属性', defaultVisible: false, align: 'right' },
  // 库存
  { title: '实际库存数', dataIndex: 'actualStock', key: 'actualStock', width: 100, type: 'number', group: '库存', defaultVisible: true, align: 'right', sorter: true },
  { title: '订单占用数', dataIndex: 'orderReserved', key: 'orderReserved', width: 100, type: 'number', group: '库存', defaultVisible: true, align: 'right' },
  { title: '可配货库存', dataIndex: 'allocatableStock', key: 'allocatableStock', width: 100, type: 'number', group: '库存', defaultVisible: true, align: 'right' },
  { title: '可用数', dataIndex: 'availableStock', key: 'availableStock', width: 80, type: 'number', group: '库存', defaultVisible: false, align: 'right' },
  { title: '仓库待发数', dataIndex: 'pendingShip', key: 'pendingShip', width: 110, type: 'number', group: '库存', defaultVisible: false, align: 'right' },
  { title: '补充仓位', dataIndex: 'suppWarehouse', key: 'suppWarehouse', width: 100, type: 'text', group: '库存', defaultVisible: false },
  { title: '库存同步', dataIndex: 'stockSync', key: 'stockSync', width: 90, type: 'boolean', group: '库存', defaultVisible: false, align: 'center' },
  { title: '库容下限', dataIndex: 'stockLower', key: 'stockLower', width: 90, type: 'number', group: '库存', defaultVisible: false, align: 'right' },
  { title: '库容上限', dataIndex: 'stockUpper', key: 'stockUpper', width: 90, type: 'number', group: '库存', defaultVisible: false, align: 'right' },
  { title: '标准装箱数量', dataIndex: 'stdBoxQty', key: 'stdBoxQty', width: 120, type: 'number', group: '库存', defaultVisible: false, align: 'right' },
  { title: '标准装箱体积', dataIndex: 'stdBoxVol', key: 'stdBoxVol', width: 120, type: 'text', group: '库存', defaultVisible: false, align: 'right' },
  // 销售统计
  { title: '昨天销量', dataIndex: 'yesterdaySales', key: 'yesterdaySales', width: 90, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '昨天实发量', dataIndex: 'yesterdayShipped', key: 'yesterdayShipped', width: 100, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '昨天退货量', dataIndex: 'yesterdayReturns', key: 'yesterdayReturns', width: 100, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '7天销量', dataIndex: 'week7Sales', key: 'week7Sales', width: 90, type: 'number', group: '销售统计', defaultVisible: false, align: 'right', sorter: true },
  { title: '7天实发量', dataIndex: 'week7Shipped', key: 'week7Shipped', width: 100, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '7天退货量', dataIndex: 'week7Returns', key: 'week7Returns', width: 100, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '15天销量', dataIndex: 'day15Sales', key: 'day15Sales', width: 90, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '15天实发量', dataIndex: 'day15Shipped', key: 'day15Shipped', width: 100, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  { title: '15天退货量', dataIndex: 'day15Returns', key: 'day15Returns', width: 100, type: 'number', group: '销售统计', defaultVisible: false, align: 'right' },
  // 其它
  { title: '备注', dataIndex: 'remark', key: 'remark', width: 150, type: 'ellipsis', group: '其它', defaultVisible: false },
  { title: '其它属性1', dataIndex: 'otherProp1', key: 'otherProp1', width: 100, type: 'text', group: '其它', defaultVisible: false },
  { title: '其它属性2', dataIndex: 'otherProp2', key: 'otherProp2', width: 100, type: 'text', group: '其它', defaultVisible: false },
  { title: '其它属性3', dataIndex: 'otherProp3', key: 'otherProp3', width: 100, type: 'text', group: '其它', defaultVisible: false },
  { title: '其它属性4', dataIndex: 'otherProp4', key: 'otherProp4', width: 100, type: 'text', group: '其它', defaultVisible: false },
  { title: '其它属性5', dataIndex: 'otherProp5', key: 'otherProp5', width: 100, type: 'text', group: '其它', defaultVisible: false },
];

// 产品列表共享筛选器
const productListFilters: FilterConfig[] = [
  { type: 'input', placeholder: '搜索款式编码/商品编码/名称', label: '搜索' },
  { type: 'select', options: [
    { label: '全部状态', value: '' },
    { label: '在售', value: '在售' },
    { label: '开发', value: '开发' },
    { label: '下架', value: '下架' },
    { label: '预售', value: '预售' },
  ], label: '商品状态' },
  { type: 'select', options: [
    { label: '全部分类', value: '' },
    { label: '电子产品', value: '电子产品' },
    { label: '服装配件', value: '服装配件' },
    { label: '五金工具', value: '五金工具' },
    { label: '包装材料', value: '包装材料' },
    { label: '家居用品', value: '家居用品' },
  ], label: '分类' },
  { type: 'select', options: [
    { label: '全部品牌', value: '' },
    { label: '自主品牌', value: '自主品牌' },
    { label: '代工品牌A', value: '代工品牌A' },
    { label: '代工品牌B', value: '代工品牌B' },
  ], label: '品牌' },
];

// ============ 1. 基础数据模块 ============
export const basicDataPages: Record<string, ChildPageConfig> = {
  'product-list': {
    title: '全部商品',
    description: '管理所有产品的基础信息，包括产品编码、名称、规格、分类、价格、库存和销售数据，是ERP系统的核心基础数据',
    relatedModules: [
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '产品用于生产工单创建' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '产品关联销售报价和订单' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '产品关联库存数量' },
    ],
    stats: [
      { title: '产品总数', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '本月新增', dataIndex: 'new', format: 'count', suffix: '个' },
      { title: '在售产品', dataIndex: 'active', format: 'count', suffix: '个' },
      { title: '库存预警', dataIndex: 'inactive', format: 'count', suffix: '个' },
    ],
    columnGroups: productListColumnGroups,
    columns: productListColumns,
    filters: productListFilters,
    mockData: [],
  },

  'product-bom': {
    title: '半成品',
    description: '管理半成品的产品信息，半成品是产品列表中的产品种类为半成品的记录',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '关联产品列表中的产品' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '半成品是生产过程中的中间产品' },
    ],
    stats: [
      { title: '半成品总数', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '本月新增', dataIndex: 'new', format: 'count', suffix: '个' },
      { title: '在售产品', dataIndex: 'active', format: 'count', suffix: '个' },
      { title: '库存预警', dataIndex: 'inactive', format: 'count', suffix: '个' },
    ],
    columnGroups: productListColumnGroups,
    columns: productListColumns,
    filters: productListFilters,
    mockData: [],
    productTypeFilter: '半成品',
  },

  'finished-product': {
    title: '成品',
    description: '管理成品的产品信息，成品是产品列表中的产品种类为成品的记录',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '关联半成品和原材料组成' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '成品关联销售报价和订单' },
    ],
    stats: [
      { title: '成品总数', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '本月新增', dataIndex: 'new', format: 'count', suffix: '个' },
      { title: '在售产品', dataIndex: 'active', format: 'count', suffix: '个' },
      { title: '库存预警', dataIndex: 'inactive', format: 'count', suffix: '个' },
    ],
    columnGroups: productListColumnGroups,
    // 成品专属字段：鞋面材质/鞋底材质（并入打印模板商品资料字段清单）
    columns: [...productListColumns,
      { title: '鞋面材质', dataIndex: 'shoeUpper', key: 'shoeUpper', width: 100, type: 'text', group: '规格属性', defaultVisible: true },
      { title: '鞋底材质', dataIndex: 'shoeSole', key: 'shoeSole', width: 100, type: 'text', group: '规格属性', defaultVisible: true },
    ],
    filters: productListFilters,
    mockData: [],
    productTypeFilter: '成品',
  },

  'raw-material': {
    title: '原材料',
    description: '管理原材料的产品信息，原材料是产品列表中的产品种类为原材料的记录',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '原材料是半成品和成品的组成基础' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '原材料驱动MRP运算和采购计划' },
    ],
    stats: [
      { title: '物料总数', dataIndex: 'total', format: 'count', suffix: '种' },
      { title: '本月新增', dataIndex: 'new', format: 'count', suffix: '种' },
      { title: '在售产品', dataIndex: 'active', format: 'count', suffix: '种' },
      { title: '库存预警', dataIndex: 'inactive', format: 'count', suffix: '种' },
    ],
    columnGroups: productListColumnGroups,
    columns: productListColumns,
    filters: productListFilters,
    mockData: [],
    productTypeFilter: '原材料',
  },

  'route-map': {
    title: '工艺路线图',
    description: '管理产品生产工艺路线，定义每道工序的顺序、工时、设备和质量要求',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '关联半成品确定加工对象' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '工艺路线用于生成生产工单工序' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '工序完成触发入库检验' },
    ],
    stats: [
      { title: '工艺路线总数', dataIndex: 'total', format: 'count', suffix: '条' },
      { title: '平均工序数', dataIndex: 'avgSteps', suffix: '道' },
      { title: '标准总工时', dataIndex: 'totalHours', suffix: '小时' },
      { title: '已优化路线', dataIndex: 'optimized', format: 'count', suffix: '条' },
    ],
    columns: [
      { title: '路线编号', dataIndex: 'id', key: 'id', width: 120, type: 'text' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'link' },
      { title: '工序数', dataIndex: 'stepCount', key: 'stepCount', width: 80, type: 'number', align: 'center' },
      { title: '标准工时(h)', dataIndex: 'stdHours', key: 'stdHours', width: 110, type: 'number', align: 'right' },
      { title: '关键设备', dataIndex: 'equipment', key: 'equipment', width: 120, type: 'text' },
      { title: '版本号', dataIndex: 'version', key: 'version', width: 80, type: 'text' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
      { title: '更新日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索路线编号/产品名', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '启用', value: 'completed' },
        { label: '优化中', value: 'processing' },
        { label: '停用', value: 'cancelled' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'prod-process': {
    title: '生产工序',
    description: '管理具体生产工序的定义，包括工序名称、工时定额、设备要求、质量标准等',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '工序属于工艺路线的子项' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '生产工单按工序拆分任务' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '外协工序产生采购需求' },
    ],
    stats: [
      { title: '工序总数', dataIndex: 'total', format: 'count', suffix: '道' },
      { title: '自制工序', dataIndex: 'selfMade', format: 'count', suffix: '道' },
      { title: '外协工序', dataIndex: 'outsource', format: 'count', suffix: '道' },
      { title: '检验工序', dataIndex: 'inspect', format: 'count', suffix: '道' },
    ],
    columns: [
      { title: '工序编号', dataIndex: 'id', key: 'id', width: 120, type: 'text' },
      { title: '工序名称', dataIndex: 'name', key: 'name', width: 130, type: 'text' },
      { title: '工序类型', dataIndex: 'type', key: 'type', width: 100, type: 'tag' },
      { title: '工价(元)', dataIndex: 'laborPrice', key: 'laborPrice', width: 100, type: 'money', align: 'right' },
      { title: '工时定额(小时)', dataIndex: 'timeQuota', key: 'timeQuota', width: 120, type: 'number', align: 'right' },
      { title: '准备时间(小时)', dataIndex: 'setupTime', key: 'setupTime', width: 120, type: 'number', align: 'right' },
      { title: '设备要求', dataIndex: 'equipment', key: 'equipment', width: 130, type: 'text' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索工序编号/名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '自制', value: 'self' },
        { label: '外协', value: 'outsource' },
        { label: '检验', value: 'inspect' },
        { label: '装配', value: 'assembly' },
      ], label: '类型' },
    ],
    mockData: [],
  },

  'plan-design': {
    title: '新款研发',
    description: '管理新款产品研发全流程，从立项、设计、打样到量产的完整研发管理',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '研发产出BOM和工艺路线' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '研发需求来自客户定制' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '新材料需启动采购流程' },
    ],
    stats: [
      { title: '研发项目总数', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '进行中', dataIndex: 'inProgress', format: 'count', suffix: '个' },
      { title: '已完成', dataIndex: 'completed', format: 'count', suffix: '个' },
      { title: '平均周期', dataIndex: 'avgDays', suffix: '天' },
    ],
    columns: [
      { title: '项目编号', dataIndex: 'id', key: 'id', width: 120, type: 'text' },
      { title: '项目名称', dataIndex: 'name', key: 'name', width: 150, type: 'text' },
      { title: '客户名称', dataIndex: 'customer', key: 'customer', width: 110, type: 'link' },
      { title: '研发阶段', dataIndex: 'stage', key: 'stage', width: 110, type: 'tag' },
      { title: '预算金额', dataIndex: 'amount', key: 'amount', width: 130, type: 'money', align: 'right' },
      { title: '进度', dataIndex: 'progress', key: 'progress', width: 110, type: 'progress' },
      { title: '截止日期', dataIndex: 'deadline', key: 'deadline', width: 110, type: 'date' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索项目编号/名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部阶段', value: '' },
        { label: '立项评审', value: 'req' },
        { label: '设计开发', value: 'concept' },
        { label: '打样测试', value: 'detail' },
        { label: '量产评审', value: 'review' },
        { label: '已完成', value: 'done' },
      ], label: '阶段' },
    ],
    mockData: [],
  },
};

// ============ 2. 客户管理模块 ============
export const customerPages: Record<string, ChildPageConfig> = {
  'customer-info': {
    title: '客户基础信息',
    description: '管理所有客户的基本档案信息，包括联系人、地址、信用等级、合作状态等',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '客户是销售订单的主体' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '客户关联应收账款' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '基础信息是RFM分析的数据源' },
    ],
    stats: [
      { title: '客户总数', dataIndex: 'total', format: 'count', suffix: '家' },
      { title: '本月新增', dataIndex: 'new', format: 'count', suffix: '家' },
      { title: '活跃客户', dataIndex: 'active', format: 'count', suffix: '家' },
      { title: 'VIP客户', dataIndex: 'vip', format: 'count', suffix: '家' },
    ],
    columns: [
      { title: '客户编码', dataIndex: 'id', key: 'id', width: 120, type: 'text' },
      { title: '客户名称', dataIndex: 'name', key: 'name', width: 150, type: 'text' },
      { title: '客户等级', dataIndex: 'level', key: 'level', width: 100, type: 'tag' },
      { title: '联系人', dataIndex: 'contact', key: 'contact', width: 90, type: 'text' },
      { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 120, type: 'text' },
      { title: '所在地区', dataIndex: 'region', key: 'region', width: 110, type: 'text' },
      { title: '信用额度(万)', dataIndex: 'credit', key: 'credit', width: 120, type: 'money', align: 'right' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
      { title: '创建日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索客户编码/名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部等级', value: '' },
        { label: 'VIP', value: 'vip' },
        { label: 'A级', value: 'A' },
        { label: 'B级', value: 'B' },
        { label: 'C级', value: 'C' },
      ], label: '等级' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '合作中', value: 'completed' },
        { label: '潜在', value: 'pending' },
        { label: '已终止', value: 'cancelled' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'bill-detail': {
    title: '账单明细',
    description: '显示客户的账单明细，基于销售订单与出库数据自动生成，支持查看货品明细、对账确认与差异说明',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '账单基于销售订单与出库数据生成' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '对账结果关联财务对账管理' },
    ],
    stats: [],
    columnGroups: ['基本信息', '金额', '对账'],
    columns: [
      { title: '订单编号', dataIndex: 'id', key: 'id', width: 140, type: 'text', group: '基本信息', defaultVisible: true },
      { title: '出库单号', dataIndex: 'outboundNo', key: 'outboundNo', width: 130, type: 'text', group: '基本信息', defaultVisible: true },
      { title: '辅助单据号', dataIndex: 'auxDocNo', key: 'auxDocNo', width: 130, type: 'text', group: '基本信息', defaultVisible: true },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 140, type: 'text', group: '基本信息', defaultVisible: true },
      { title: '出库日期', dataIndex: 'outboundDate', key: 'outboundDate', width: 110, type: 'date', group: '基本信息', defaultVisible: true },
      { title: '商品总数', dataIndex: 'totalCount', key: 'totalCount', width: 90, type: 'number', align: 'right', group: '基本信息', defaultVisible: true },
      { title: '货品明细', dataIndex: 'productDetail', key: 'productDetail', width: 200, type: 'ellipsis', group: '基本信息', defaultVisible: true },
      { title: '款式编码', dataIndex: 'styleCodeSummary', key: 'styleCodeSummary', width: 160, type: 'text', group: '基本信息', defaultVisible: true },
      { title: '商品总额', dataIndex: 'totalAmount', key: 'totalAmount', width: 120, type: 'money', align: 'right', group: '金额', defaultVisible: true },
      { title: '账单来源', dataIndex: 'billSource', key: 'billSource', width: 100, type: 'tag', group: '基本信息', defaultVisible: true },
      { title: '订单状态', dataIndex: 'orderStatus', key: 'orderStatus', width: 100, type: 'tag', group: '基本信息', defaultVisible: true },
      { title: '对账结果', dataIndex: 'reconResult', key: 'reconResult', width: 100, type: 'tag', group: '对账', defaultVisible: true },
      { title: '差异说明', dataIndex: 'diffDesc', key: 'diffDesc', width: 160, type: 'ellipsis', group: '对账', defaultVisible: true },
      { title: '供应商对账人', dataIndex: 'supplierReconPerson', key: 'supplierReconPerson', width: 110, type: 'text', group: '对账', defaultVisible: true },
      { title: '采购商对账人', dataIndex: 'purchaserReconPerson', key: 'purchaserReconPerson', width: 110, type: 'text', group: '对账', defaultVisible: true },
    ],
    filters: [
      { type: 'input', placeholder: '订单编号', label: '订单编号' },
      { type: 'input', placeholder: '出库单号', label: '出库单号' },
      { type: 'input', placeholder: '辅助单据号', label: '辅助单据号' },
      { type: 'input', placeholder: '客户名称', label: '客户名称' },
      { type: 'productCodePick', placeholder: '商品编码', label: '商品编码' },
      { type: 'productCodePick', placeholder: '款式编码', label: '款式编码' },
      { type: 'select', options: [
        { label: '全部来源', value: '' },
        { label: '订单', value: '订单' },
        { label: '手工', value: '手工' },
      ], label: '账单来源' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '待付款', value: '待付款' },
        { label: '待发货', value: '待发货' },
        { label: '已发货', value: '已发货' },
        { label: '已完成', value: '已完成' },
        { label: '已取消', value: '已取消' },
      ], label: '订单状态' },
      { type: 'input', placeholder: '供应商对账人', label: '供应商对账人' },
      { type: 'input', placeholder: '采购商对账人', label: '采购商对账人' },
      { type: 'select', options: [
        { label: '全部对账结果', value: '' },
        { label: '待对账', value: '待对账' },
        { label: '确认无误', value: '确认无误' },
      ], label: '对账结果' },
    ],
    mockData: [],
  },

  'customer-follow': {
    title: '客户跟进管理',
    description: '跟踪销售团队对客户的拜访和沟通记录，确保客户关系维护不遗漏',
    relatedModules: [
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '跟进记录关联客户基础信息' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '跟进结果可能转化为销售机会' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '客户需求可能触发方案设计' },
    ],
    stats: [
      { title: '跟进总数', dataIndex: 'total', format: 'count', suffix: '次' },
      { title: '今日待跟进', dataIndex: 'todayPending', format: 'count', suffix: '次' },
      { title: '本周已跟进', dataIndex: 'weekDone', format: 'count', suffix: '次' },
      { title: '超时未跟进', dataIndex: 'overdue', format: 'count', suffix: '次' },
    ],
    columns: [
      { title: '记录编号', dataIndex: 'id', key: 'id', width: 120, type: 'text' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 140, type: 'link' },
      { title: '跟进方式', dataIndex: 'method', key: 'method', width: 100, type: 'tag' },
      { title: '跟进内容', dataIndex: 'content', key: 'content', width: 200, type: 'text' },
      { title: '跟进结果', dataIndex: 'result', key: 'result', width: 100, type: 'tag' },
      { title: '跟进日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '下次跟进', dataIndex: 'nextDate', key: 'nextDate', width: 110, type: 'date' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索客户名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部方式', value: '' },
        { label: '电话', value: 'phone' },
        { label: '拜访', value: 'visit' },
        { label: '邮件', value: 'email' },
        { label: '展会', value: 'expo' },
      ], label: '方式' },
      { type: 'select', options: [
        { label: '全部结果', value: '' },
        { label: '有意向', value: 'interested' },
        { label: '需跟进', value: 'follow' },
        { label: '已成交', value: 'closed' },
        { label: '无意向', value: 'reject' },
      ], label: '结果' },
    ],
    mockData: [],
  },

  'rfm-analysis': {
    title: 'RFM模型分析',
    description: '基于最近消费时间(Recency)、消费频率(Frequency)、消费金额(Monetary)的客户价值分析模型',
    relatedModules: [
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '分析结果用于客户分群和画像' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '数据来源于销售订单记录' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '分析结果指导客户跟进策略' },
    ],
    stats: [
      { title: '分析客户数', dataIndex: 'total', format: 'count', suffix: '家' },
      { title: '高价值客户', dataIndex: 'highValue', format: 'count', suffix: '家' },
      { title: '流失风险客户', dataIndex: 'atRisk', format: 'count', suffix: '家' },
      { title: '平均客单价', dataIndex: 'avgPrice', format: 'money', prefix: '¥', suffix: '' },
    ],
    columns: [
      { title: '客户名称', dataIndex: 'name', key: 'name', width: 150, type: 'link' },
      { title: '最近消费(天)', dataIndex: 'recency', key: 'recency', width: 110, type: 'number', align: 'center' },
      { title: '消费频次', dataIndex: 'frequency', key: 'frequency', width: 100, type: 'number', align: 'center' },
      { title: '消费金额(万)', dataIndex: 'monetary', key: 'monetary', width: 120, type: 'money', align: 'right' },
      { title: 'R值评分', dataIndex: 'rScore', key: 'rScore', width: 90, type: 'number', align: 'center' },
      { title: 'F值评分', dataIndex: 'fScore', key: 'fScore', width: 90, type: 'number', align: 'center' },
      { title: 'M值评分', dataIndex: 'mScore', key: 'mScore', width: 90, type: 'number', align: 'center' },
      { title: 'RFM分类', dataIndex: 'rfmClass', key: 'rfmClass', width: 120, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索客户名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部分类', value: '' },
        { label: '高价值客户', value: 'high' },
        { label: '重要发展客户', value: 'develop' },
        { label: '重要保持客户', value: 'keep' },
        { label: '一般客户', value: 'normal' },
        { label: '流失风险', value: 'risk' },
      ], label: '分类' },
    ],
    mockData: [],
  },

  'customer-profile': {
    title: '客户画像',
    description: '基于客户行为数据构建360度客户视图，支持精准营销和个性化服务',
    relatedModules: [
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '画像基于RFM分析和跟进记录' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '画像指导销售策略制定' },
    ],
    stats: [
      { title: '已画像客户', dataIndex: 'total', format: 'count', suffix: '家' },
      { title: '标签总数', dataIndex: 'tags', format: 'count', suffix: '个' },
      { title: '行业分类', dataIndex: 'industries', format: 'count', suffix: '个' },
      { title: '本月更新', dataIndex: 'updated', format: 'count', suffix: '家' },
    ],
    columns: [
      { title: '客户名称', dataIndex: 'name', key: 'name', width: 150, type: 'link' },
      { title: '行业', dataIndex: 'industry', key: 'industry', width: 100, type: 'tag' },
      { title: '规模', dataIndex: 'scale', key: 'scale', width: 90, type: 'tag' },
      { title: '采购偏好', dataIndex: 'preference', key: 'preference', width: 120, type: 'text' },
      { title: '决策周期(天)', dataIndex: 'decideDays', key: 'decideDays', width: 110, type: 'number', align: 'center' },
      { title: '信用评分', dataIndex: 'creditScore', key: 'creditScore', width: 100, type: 'number', align: 'center' },
      { title: '画像完整度', dataIndex: 'completeness', key: 'completeness', width: 110, type: 'progress' },
      { title: '更新日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索客户名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部行业', value: '' },
        { label: '电子制造', value: '电子' },
        { label: '汽车', value: '汽车' },
        { label: '家电', value: '家电' },
        { label: '机械', value: '机械' },
        { label: '新能源', value: '新能源' },
      ], label: '行业' },
    ],
    mockData: [],
  },

  'customer-segment': {
    title: '客户分群',
    description: '按多维度将客户分为不同群体，支持差异化营销策略和资源配置',
    relatedModules: [
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '分群基于RFM分析和客户画像' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '分群结果用于制定差异化销售策略' },
    ],
    stats: [
      { title: '分群数量', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '覆盖客户', dataIndex: 'covered', format: 'count', suffix: '家' },
      { title: '未分组客户', dataIndex: 'ungrouped', format: 'count', suffix: '家' },
      { title: '策略执行率', dataIndex: 'execRate', format: 'percent', suffix: '%' },
    ],
    columns: [
      { title: '分群名称', dataIndex: 'name', key: 'name', width: 140, type: 'text' },
      { title: '客户数量', dataIndex: 'count', key: 'count', width: 90, type: 'number', align: 'center' },
      { title: '分群维度', dataIndex: 'dimension', key: 'dimension', width: 120, type: 'tag' },
      { title: '特征描述', dataIndex: 'feature', key: 'feature', width: 180, type: 'text' },
      { title: '营销策略', dataIndex: 'strategy', key: 'strategy', width: 150, type: 'text' },
      { title: '创建日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 90, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索分群名称', label: '搜索' },
      { type: 'select', options: [
        { label: '全部维度', value: '' },
        { label: '价值维度', value: '价值' },
        { label: '行业维度', value: '行业' },
        { label: '区域维度', value: '区域' },
        { label: '行为维度', value: '行为' },
      ], label: '维度' },
    ],
    mockData: [],
  },
};

// ============ 3. 销售管理模块 ============
export const salesPages: Record<string, ChildPageConfig> = {
  'order-manage': {
    title: '订单管理',
    description: '管理销售订单的全生命周期，包括订单创建、付款、发货、收货等环节，追踪订单状态、金额明细和收付款信息',
    relatedModules: [
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '订单关联客户基础信息' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '订单引用产品和货品信息' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '订单关联收付款和对账' },
    ],
    stats: [
      { title: '订单总数', dataIndex: 'totalOrders', format: 'count', suffix: '单' },
      { title: '待付款订单', dataIndex: 'pendingPay', format: 'count', suffix: '单' },
      { title: '货品总额', dataIndex: 'totalAmount', format: 'money', prefix: '¥' },
      { title: '已付金额', dataIndex: 'paidAmount', format: 'money', prefix: '¥' },
    ],
    columnGroups: ['订单信息', '货品信息', '金额信息', '收货信息', '其他信息'],
    columns: [
      { title: '订单编号', dataIndex: 'id', key: 'id', width: 140, type: 'text', fixed: 'left', group: '订单信息' },
      { title: '订单状态', dataIndex: 'orderStatus', key: 'orderStatus', width: 100, type: 'tag', group: '订单信息' },
      { title: '订单标签', dataIndex: 'orderTag', key: 'orderTag', width: 100, type: 'tag', group: '订单信息' },
      { title: '创建时间', dataIndex: 'createTime', key: 'createTime', width: 160, type: 'date', group: '订单信息' },
      { title: '付款时间', dataIndex: 'payTime', key: 'payTime', width: 160, type: 'date', group: '订单信息' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 140, type: 'link', group: '订单信息' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text', group: '订单信息' },
      { title: '货品总数', dataIndex: 'palletCount', key: 'palletCount', width: 90, type: 'number', align: 'right', group: '货品信息' },
      { title: '货品明细', dataIndex: 'productDetail', key: 'productDetail', width: 200, type: 'ellipsis', group: '货品信息' },
      { title: '货品总额', dataIndex: 'productAmount', key: 'productAmount', width: 120, type: 'money', align: 'right', group: '金额信息' },
      { title: '运费', dataIndex: 'freight', key: 'freight', width: 100, type: 'money', align: 'right', group: '金额信息' },
      { title: '已付金额', dataIndex: 'paidAmount', key: 'paidAmount', width: 120, type: 'money', align: 'right', group: '金额信息' },
      { title: '付款进度', dataIndex: 'payProgress', key: 'payProgress', width: 150, type: 'text', align: 'right', group: '金额信息' },
      { title: '付款方式', dataIndex: 'payMethod', key: 'payMethod', width: 110, type: 'tag', group: '金额信息' },
      { title: '收货名称', dataIndex: 'receiverName', key: 'receiverName', width: 110, type: 'text', group: '收货信息' },
      { title: '唛头', dataIndex: 'shippingMark', key: 'shippingMark', width: 120, type: 'text', group: '收货信息' },
      { title: '收货地址', dataIndex: 'receiverAddress', key: 'receiverAddress', width: 220, type: 'ellipsis', group: '收货信息' },
      { title: '买家留言', dataIndex: 'buyerMessage', key: 'buyerMessage', width: 160, type: 'ellipsis', group: '其他信息' },
      { title: '卖家留言', dataIndex: 'sellerMessage', key: 'sellerMessage', width: 160, type: 'ellipsis', group: '其他信息' },
      { title: '订单来源', dataIndex: 'orderSource', key: 'orderSource', width: 110, type: 'tag', group: '其他信息' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索订单编号', label: '搜索' },
      { type: 'input', placeholder: '客户名称', label: '客户名称' },
      { type: 'input', placeholder: '负责人', label: '负责人' },
      { type: 'input', placeholder: '款式编码', label: '款式编码' },
      { type: 'input', placeholder: '商品编码', label: '商品编码' },
      { type: 'input', placeholder: '收货名称', label: '收货名称' },
      { type: 'input', placeholder: '唛头', label: '唛头' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '待付款', value: '待付款' },
        { label: '部分付款', value: '部分付款' },
        { label: '已付款', value: '已付款' },
        { label: '已发货', value: '已发货' },
        { label: '已完成', value: '已完成' },
        { label: '已取消', value: '已取消' },
      ], label: '订单状态' },
      { type: 'select', options: [
        { label: '全部来源', value: '' },
        { label: '线上商城', value: '线上商城' },
        { label: '线下门店', value: '线下门店' },
        { label: '电话订购', value: '电话订购' },
        { label: '展会', value: '展会' },
        { label: '老客户介绍', value: '老客户介绍' },
        { label: '采购商推送', value: '采购商推送' },
      ], label: '订单来源' },
    ],
    mockData: Array.from({ length: 0 }, (_, i) => { // 演示数据已下线：生产环境不预置测试数据
      const orderStatuses = ['待付款', '已付款', '已发货', '已完成', '已取消'];
      const orderTags = ['VIP', '加急', '普通', '批发', '零售', '新品'];
      const payMethods = ['支付宝', '微信支付', '银行转账', '现金', '货到付款'];
      const orderSources = ['线上商城', '线下门店', '电话订购', '展会', '老客户介绍'];
      const customers = ['华为技术', '比亚迪', '格力电器', '三一重工', '宁德时代', '美的集团', '海尔智家', '小米科技'];
      const persons = ['张三', '李四', '王五', '赵六', '钱七'];
      const receivers = ['王经理', '张总', '李工', '赵总监', '陈总'];
      const addresses = ['广东省深圳市南山区科技园', '广东省深圳市宝安区福永街道', '珠海市香洲区格力工业园', '湖南省长沙市三一重工产业园', '福建省宁德市蕉城区新能源基地'];
      const details = ['精密主轴组件×2、传动齿轮箱×1', '自动化控制系统×1', '液压缸总成×3、检测传感器×5', '电气控制柜×1', '传动齿轮箱×2、精密主轴组件×1'];
      const buyerMsgs = ['请尽快发货', '需要开具增值税专用发票', '周末送货，提前电话联系', '', '易碎品请小心包装'];
      const sellerMsgs = ['已安排仓库备货', '', '客户已确认收货时间', '等待客户付款', ''];
      const orderStatus = orderStatuses[i % 5];
      const productAmount = Math.floor(Math.random() * 80000) + 5000;
      const freight = Math.floor(Math.random() * 500) + 20;
      // 通用状态映射（用于统计卡片）
      const statusMap: Record<string, RecordStatus> = {
        '待付款': 'pending', '已付款': 'processing', '已发货': 'processing', '已完成': 'completed', '已取消': 'cancelled',
      };
      return {
        key: `order-${i + 1}`,
        id: `SO${String(20240001 + i)}`,
        name: `订单-${i + 1}`,
        orderStatus,
        orderTag: orderTags[i % 6],
        createTime: `2024-0${(i % 6) + 1}-${String((i % 25) + 1).padStart(2, '0')} ${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 3) % 60).padStart(2, '0')}`,
        payTime: orderStatus === '待付款' ? '' : `2024-0${(i % 6) + 1}-${String((i % 25) + 2).padStart(2, '0')} ${String(9 + (i % 8)).padStart(2, '0')}:${String((i * 5) % 60).padStart(2, '0')}`,
        customerName: customers[i % 8],
        person: persons[i % 5],
        palletCount: Math.floor(Math.random() * 20) + 1,
        productDetail: details[i % 5],
        productAmount,
        freight,
        paidAmount: orderStatus === '待付款' ? 0 : productAmount + freight,
        payMethod: payMethods[i % 5],
        receiverName: receivers[i % 5],
        shippingMark: `SM-${String(24001 + i)}`,
        receiverAddress: addresses[i % 5],
        buyerMessage: buyerMsgs[i % 5],
        sellerMessage: sellerMsgs[i % 5],
        orderSource: orderSources[i % 5],
        amount: productAmount + freight,
        status: statusMap[orderStatus],
        quantity: 0,
        progress: 0,
        passRate: '',
        deliveryDays: 0,
        margin: '',
        remark: '',
        dept: '销售部',
      };
    }),
  },

  'quote-stats': {
    title: '报价统计',
    description: '统计分析销售报价数据，追踪报价转化率和报价趋势',
    relatedModules: [
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '报价关联客户基础信息' },
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '报价引用产品价格信息' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '报价转化后生成销售订单' },
    ],
    stats: [
      { title: '本月报价数', dataIndex: 'monthQuotes', format: 'count', suffix: '份' },
      { title: '转化率', dataIndex: 'convertRate', format: 'percent', suffix: '%' },
      { title: '报价总金额', dataIndex: 'totalAmount', format: 'money', prefix: '¥' },
      { title: '平均报价周期', dataIndex: 'avgDays', suffix: '天' },
    ],
    columns: [
      { title: '报价单号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 140, type: 'link' },
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 130, type: 'text' },
      { title: '报价金额', dataIndex: 'amount', key: 'amount', width: 130, type: 'money', align: 'right' },
      { title: '报价日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '有效期至', dataIndex: 'expireDate', key: 'expireDate', width: 110, type: 'date' },
      { title: '状态', dataIndex: 'status', key: 'status', width: 100, type: 'tag' },
      { title: '报价人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索报价单号/客户', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '已转化', value: 'completed' },
        { label: '待回复', value: 'pending' },
        { label: '已过期', value: 'overdue' },
        { label: '已拒绝', value: 'cancelled' },
      ], label: '状态' },
    ],
    mockData: [],
  },

  'order-profit': {
    title: '订单毛利率',
    description: '按订单维度计算和分析毛利率，识别高利润和低利润订单，辅助经营决策',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '产品成本来自BOM标准成本' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '材料成本受采购价格波动影响' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '毛利率是财务分析的核心指标' },
    ],
    stats: [
      { title: '平均毛利率', dataIndex: 'avgMargin', format: 'percent', suffix: '%' },
      { title: '高利润订单', dataIndex: 'highProfit', format: 'count', suffix: '单' },
      { title: '亏损订单', dataIndex: 'lossOrder', format: 'count', suffix: '单' },
      { title: '毛利总额', dataIndex: 'totalProfit', format: 'money', prefix: '¥' },
    ],
    columns: [
      { title: '订单编号', dataIndex: 'id', key: 'id', width: 130, type: 'text' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 130, type: 'link' },
      { title: '销售金额', dataIndex: 'salesAmount', key: 'salesAmount', width: 130, type: 'money', align: 'right' },
      { title: '成本金额', dataIndex: 'costAmount', key: 'costAmount', width: 130, type: 'money', align: 'right' },
      { title: '毛利额', dataIndex: 'profit', key: 'profit', width: 120, type: 'money', align: 'right' },
      { title: '毛利率', dataIndex: 'margin', key: 'margin', width: 100, type: 'rate', align: 'center' },
      { title: '订单日期', dataIndex: 'date', key: 'date', width: 110, type: 'date' },
      { title: '负责人', dataIndex: 'person', key: 'person', width: 90, type: 'text' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索订单编号/客户', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部', value: '' },
        { label: '高利润(>30%)', value: 'high' },
        { label: '正常(10-30%)', value: 'normal' },
        { label: '低利润(<10%)', value: 'low' },
        { label: '亏损', value: 'loss' },
      ], label: '利润率' },
    ],
    mockData: [],
  },

  'sales-analysis': {
    title: '销售经营分析',
    description: '多维度分析销售经营状况，包括趋势分析、同比环比、区域分析、产品线分析等',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '综合分析销售整体表现' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '客户维度贡献分析' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '销售收入是财务核心指标' },
    ],
    stats: [
      { title: '本月销售额', dataIndex: 'monthSales', format: 'money', prefix: '¥' },
      { title: '同比增长', dataIndex: 'yoyGrowth', format: 'percent', suffix: '%' },
      { title: '完成率', dataIndex: 'completionRate', format: 'percent', suffix: '%' },
      { title: '客单价', dataIndex: 'avgOrder', format: 'money', prefix: '¥' },
    ],
    columns: [
      { title: '分析维度', dataIndex: 'dimension', key: 'dimension', width: 110, type: 'tag' },
      { title: '分类名称', dataIndex: 'name', key: 'name', width: 140, type: 'text' },
      { title: '销售额(万)', dataIndex: 'salesAmount', key: 'salesAmount', width: 130, type: 'money', align: 'right' },
      { title: '订单数', dataIndex: 'orderCount', key: 'orderCount', width: 90, type: 'number', align: 'center' },
      { title: '占比', dataIndex: 'proportion', key: 'proportion', width: 100, type: 'progress' },
      { title: '同比增长', dataIndex: 'yoy', key: 'yoy', width: 100, type: 'rate', align: 'center' },
      { title: '环比增长', dataIndex: 'mom', key: 'mom', width: 100, type: 'rate', align: 'center' },
    ],
    filters: [
      { type: 'dateRange', placeholder: '', label: '日期' },
      { type: 'select', options: [
        { label: '全部维度', value: '' },
        { label: '按产品线', value: '产品线' },
        { label: '按区域', value: '区域' },
        { label: '按客户', value: '客户' },
        { label: '按销售员', value: '销售员' },
      ], label: '维度' },
    ],
    mockData: [],
  },

  'price-fluctuation': {
    title: '售价波动分析',
    description: '监控和分析产品销售价格的波动趋势，识别异常价格变动，辅助定价决策',
    relatedModules: [
      { moduleKey: 'basic-data', moduleLabel: '基础数据', relation: '价格波动参照产品标准定价' },
      { moduleKey: 'purchase', moduleLabel: '采购管理', relation: '采购成本波动影响销售定价' },
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '报价价格和成交价格对比分析' },
    ],
    stats: [
      { title: '价格波动产品', dataIndex: 'fluctuateCount', format: 'count', suffix: '个' },
      { title: '平均波动幅度', dataIndex: 'avgFluctuate', format: 'percent', suffix: '%' },
      { title: '上涨产品', dataIndex: 'upCount', format: 'count', suffix: '个' },
      { title: '下降产品', dataIndex: 'downCount', format: 'count', suffix: '个' },
    ],
    columns: [
      { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 140, type: 'link' },
      { title: '期初价格', dataIndex: 'startPrice', key: 'startPrice', width: 120, type: 'money', align: 'right' },
      { title: '期末价格', dataIndex: 'endPrice', key: 'endPrice', width: 120, type: 'money', align: 'right' },
      { title: '最高价', dataIndex: 'maxPrice', key: 'maxPrice', width: 120, type: 'money', align: 'right' },
      { title: '最低价', dataIndex: 'minPrice', key: 'minPrice', width: 120, type: 'money', align: 'right' },
      { title: '波动幅度', dataIndex: 'fluctuate', key: 'fluctuate', width: 100, type: 'rate', align: 'center' },
      { title: '波动趋势', dataIndex: 'trend', key: 'trend', width: 100, type: 'tag' },
    ],
    filters: [
      { type: 'input', placeholder: '搜索产品名称', label: '搜索' },
      { type: 'dateRange', placeholder: '', label: '分析周期' },
      { type: 'select', options: [
        { label: '全部趋势', value: '' },
        { label: '上涨', value: 'up' },
        { label: '下降', value: 'down' },
        { label: '稳定', value: 'stable' },
      ], label: '趋势' },
    ],
    mockData: [],
  },

  'sales-ranking': {
    title: '销售排行榜',
    description: '多维度销售排名，包括销售额排名、销量排名、利润排名、增长率排名等',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '综合排名反映销售整体表现' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '客户贡献排名' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '利润排名关联成本数据' },
    ],
    stats: [
      { title: '排行维度', dataIndex: 'dimensions', format: 'count', suffix: '个' },
      { title: 'TOP1销售额', dataIndex: 'top1', format: 'money', prefix: '¥' },
      { title: '上榜数量', dataIndex: 'total', format: 'count', suffix: '个' },
      { title: '更新时间', dataIndex: 'updateTime', suffix: '' },
    ],
    columns: [
      { title: '排名', dataIndex: 'rank', key: 'rank', width: 70, type: 'number', align: 'center' },
      { title: '名称', dataIndex: 'name', key: 'name', width: 150, type: 'link' },
      { title: '排名维度', dataIndex: 'dimension', key: 'dimension', width: 110, type: 'tag' },
      { title: '销售额(万)', dataIndex: 'amount', key: 'amount', width: 130, type: 'money', align: 'right' },
      { title: '同比增长', dataIndex: 'growth', key: 'growth', width: 100, type: 'rate', align: 'center' },
      { title: '市场份额', dataIndex: 'marketShare', key: 'marketShare', width: 110, type: 'progress' },
      { title: '上月排名', dataIndex: 'lastRank', key: 'lastRank', width: 90, type: 'number', align: 'center' },
    ],
    filters: [
      { type: 'select', options: [
        { label: '销售额排名', value: '销售额' },
        { label: '销量排名', value: '销量' },
        { label: '利润排名', value: '利润' },
        { label: '增长率排名', value: '增长率' },
      ], label: '排名维度' },
      { type: 'select', options: [
        { label: '产品维度', value: '产品' },
        { label: '客户维度', value: '客户' },
        { label: '销售员维度', value: '销售员' },
        { label: '区域维度', value: '区域' },
      ], label: '排行对象' },
    ],
    mockData: [],
  },

  'finance-audit': {
    title: '财务审核',
    description: '对销售订单的收款、开票、退款等财务事项进行审核，追踪审核状态、审核时效和通过率，保障订单财务合规',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '审核对象为销售订单及收付款单据' },
      { moduleKey: 'finance', moduleLabel: '财务管理', relation: '审核结果关联收付款和对账记录' },
      { moduleKey: 'customer', moduleLabel: '客户管理', relation: '审核参考客户信用等级和合作状态' },
    ],
    stats: [
      { title: '待审核单据', dataIndex: 'pendingAudit', format: 'count', suffix: '单' },
      { title: '今日已审核', dataIndex: 'todayAudited', format: 'count', suffix: '单' },
      { title: '待审金额', dataIndex: 'pendingAmount', format: 'money', prefix: '¥' },
      { title: '审核通过率', dataIndex: 'passRate', format: 'percent', suffix: '%' },
    ],
    columnGroups: ['审核信息', '订单信息', '收付款信息', '收货信息'],
    columns: [
      // 审核信息
      { title: '审核单号', dataIndex: 'id', key: 'id', width: 130, type: 'text', fixed: 'left', group: '审核信息' },
      { title: '关联订单号', dataIndex: 'orderId', key: 'orderId', width: 130, type: 'link', group: '审核信息' },
      { title: '审核类型', dataIndex: 'auditType', key: 'auditType', width: 100, type: 'tag', group: '审核信息' },
      { title: '审核状态', dataIndex: 'status', key: 'status', width: 100, type: 'tag', group: '审核信息' },
      { title: '提交时间', dataIndex: 'submitTime', key: 'submitTime', width: 160, type: 'date', group: '审核信息' },
      { title: '审核人', dataIndex: 'person', key: 'person', width: 90, type: 'text', group: '审核信息', defaultVisible: false },
      { title: '审核时间', dataIndex: 'auditTime', key: 'auditTime', width: 160, type: 'date', group: '审核信息', defaultVisible: false },
      { title: '审核意见', dataIndex: 'remark', key: 'remark', width: 180, type: 'ellipsis', group: '审核信息', defaultVisible: false },
      // 订单信息（与订单管理字段一致）
      { title: '订单状态', dataIndex: 'orderStatus', key: 'orderStatus', width: 100, type: 'tag', group: '订单信息' },
      { title: '订单标签', dataIndex: 'orderTag', key: 'orderTag', width: 100, type: 'tag', group: '订单信息', defaultVisible: false },
      { title: '创建时间', dataIndex: 'createTime', key: 'createTime', width: 160, type: 'date', group: '订单信息', defaultVisible: false },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 140, type: 'link', group: '订单信息' },
      { title: '负责人', dataIndex: 'orderPerson', key: 'orderPerson', width: 90, type: 'text', group: '订单信息' },
      { title: '货品总数', dataIndex: 'palletCount', key: 'palletCount', width: 90, type: 'number', align: 'right' as const, group: '订单信息', defaultVisible: false },
      { title: '货品明细', dataIndex: 'productDetail', key: 'productDetail', width: 200, type: 'ellipsis', group: '订单信息' },
      { title: '订单来源', dataIndex: 'orderSource', key: 'orderSource', width: 110, type: 'tag', group: '订单信息', defaultVisible: false },
      { title: '买家留言', dataIndex: 'buyerMessage', key: 'buyerMessage', width: 160, type: 'ellipsis', group: '订单信息', defaultVisible: false },
      { title: '卖家留言', dataIndex: 'sellerMessage', key: 'sellerMessage', width: 160, type: 'ellipsis', group: '订单信息', defaultVisible: false },
      // 收付款信息
      { title: '审核金额', dataIndex: 'amount', key: 'amount', width: 120, type: 'money', align: 'right' as const, group: '收付款信息' },
      { title: '货品总额', dataIndex: 'productAmount', key: 'productAmount', width: 120, type: 'money', align: 'right' as const, group: '收付款信息' },
      { title: '运费', dataIndex: 'freight', key: 'freight', width: 100, type: 'money', align: 'right' as const, group: '收付款信息', defaultVisible: false },
      { title: '已付金额', dataIndex: 'paidAmount', key: 'paidAmount', width: 120, type: 'money', align: 'right' as const, group: '收付款信息' },
      { title: '付款方式', dataIndex: 'payMethod', key: 'payMethod', width: 110, type: 'tag', group: '收付款信息' },
      { title: '付款时间', dataIndex: 'payTime', key: 'payTime', width: 160, type: 'date', group: '收付款信息', defaultVisible: false },
      { title: '付款账户', dataIndex: 'payAccount', key: 'payAccount', width: 180, type: 'text', group: '收付款信息' },
      { title: '付款截图', dataIndex: 'payScreenshot', key: 'payScreenshot', width: 80, type: 'text', align: 'center' as const, group: '收付款信息' },
      // 收货信息
      { title: '收货名称', dataIndex: 'receiverName', key: 'receiverName', width: 110, type: 'text', group: '收货信息', defaultVisible: false },
      { title: '唛头', dataIndex: 'shippingMark', key: 'shippingMark', width: 120, type: 'text', group: '收货信息', defaultVisible: false },
      { title: '收货地址', dataIndex: 'receiverAddress', key: 'receiverAddress', width: 220, type: 'ellipsis', group: '收货信息', defaultVisible: false },
    ],
    filters: [
      { type: 'input', placeholder: '搜索审核单号/订单号/客户', label: '搜索' },
      { type: 'select', options: [
        { label: '全部状态', value: '' },
        { label: '待审核', value: 'pending' },
        { label: '审核中', value: 'processing' },
        { label: '已通过', value: 'completed' },
        { label: '已驳回', value: 'cancelled' },
      ], label: '审核状态' },
      { type: 'select', options: [
        { label: '全部类型', value: '' },
        { label: '收款审核', value: '收款审核' },
        { label: '开票审核', value: '开票审核' },
        { label: '退款审核', value: '退款审核' },
        { label: '信用审核', value: '信用审核' },
      ], label: '审核类型' },
      { type: 'dateRange', placeholder: '', label: '提交时间' },
    ],
    mockData: Array.from({ length: 0 }, (_, i) => { // 演示数据已下线：生产环境不预置测试数据
      const auditTypes = ['收款审核', '开票审核', '退款审核', '信用审核'];
      const customers = ['华为技术', '比亚迪', '格力电器', '三一重工', '宁德时代', '美的集团'];
      const auditors = ['钱七', '周九', '吴十'];
      const statusList: RecordStatus[] = ['pending', 'processing', 'completed', 'completed', 'cancelled', 'pending', 'completed', 'processing', 'completed', 'pending', 'completed', 'completed'];
      const statusNames: Record<string, string> = { pending: '待审核', processing: '审核中', completed: '已通过', cancelled: '已驳回' };
      const s = statusList[i];
      return {
        key: `fa-${i + 1}`,
        id: `FA-${String(24101 + i)}`,
        orderId: `SO${String(20240001 + i)}`,
        name: `审核-${i + 1}`,
        auditType: auditTypes[i % 4],
        customerName: customers[i % 6],
        amount: Math.floor(Math.random() * 100000) + 5000,
        submitTime: `2024-0${(i % 6) + 1}-${String((i % 25) + 1).padStart(2, '0')} ${String(9 + (i % 8)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
        status: s,
        statusName: statusNames[s],
        person: s === 'pending' ? '' : auditors[i % 3],
        auditTime: s === 'pending' || s === 'processing' ? '' : `2024-0${(i % 6) + 1}-${String((i % 25) + 2).padStart(2, '0')} ${String(10 + (i % 6)).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}`,
        remark: s === 'cancelled' ? '金额与合同不符，请重新核对' : s === 'pending' ? '' : '审核无误，同意通过',
        pendingAudit: 3,
        todayAudited: 5,
        pendingAmount: 128600,
        passRate: 91.5,
        date: '',
        quantity: 0,
        progress: 0,
        deliveryDays: 0,
        margin: '',
        dept: '财务部',
      };
    }),
  },

  'print-picking': {
    title: '打单拣货',
    description: '对已审核的销售订单打印拣货单并安排仓库拣货，追踪拣货进度、库位分配和发货准备状态，衔接销售出库环节',
    relatedModules: [
      { moduleKey: 'sales', moduleLabel: '销售管理', relation: '拣货任务来源于已审核的销售订单' },
      { moduleKey: 'inventory', moduleLabel: '库存管理', relation: '拣货按库位分配并触发销售出库' },
      { moduleKey: 'production', moduleLabel: '生产管理', relation: '拣货完成后进入发货和销售出库统计' },
    ],
    stats: [
      { title: '待打单', dataIndex: 'pendingPrint', format: 'count', suffix: '单' },
      { title: '待拣货', dataIndex: 'pendingPick', format: 'count', suffix: '单' },
      { title: '今日已完成', dataIndex: 'todayDone', format: 'count', suffix: '单' },
      { title: '今日拣货件数', dataIndex: 'todayQuantity', format: 'count', suffix: '件' },
    ],
    columnGroups: ['拣货信息', '收货信息', '人员时间', '其他'],
    columns: [
      { title: '出库单号', dataIndex: 'id', key: 'id', width: 140, type: 'text', fixed: 'left', group: '拣货信息' },
      { title: '关联订单号', dataIndex: 'orderId', key: 'orderId', width: 130, type: 'link', group: '拣货信息' },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 140, type: 'link', group: '拣货信息' },
      { title: '订单标签', dataIndex: 'orderTag', key: 'orderTag', width: 150, type: 'tag', group: '拣货信息' },
      { title: '货品明细', dataIndex: 'productDetail', key: 'productDetail', width: 220, type: 'ellipsis', group: '拣货信息' },
      { title: '拣货数量', dataIndex: 'quantity', key: 'quantity', width: 90, type: 'number', align: 'right', group: '拣货信息' },
      { title: '库位', dataIndex: 'location', key: 'location', width: 100, type: 'text', group: '拣货信息' },
      { title: '拣货状态', dataIndex: 'status', key: 'status', width: 100, type: 'tag', group: '拣货信息' },
      { title: '拣货进度', dataIndex: 'progress', key: 'progress', width: 120, type: 'progress', group: '拣货信息' },
      { title: '订单打印状态', dataIndex: 'printStatus', key: 'printStatus', width: 110, type: 'tag', group: '拣货信息' },
      { title: '收货人', dataIndex: 'receiverName', key: 'receiverName', width: 100, type: 'text', group: '收货信息' },
      { title: '省', dataIndex: 'province', key: 'province', width: 80, type: 'text', group: '收货信息' },
      { title: '市', dataIndex: 'city', key: 'city', width: 80, type: 'text', group: '收货信息' },
      { title: '区', dataIndex: 'district', key: 'district', width: 80, type: 'text', group: '收货信息' },
      { title: '详细地址', dataIndex: 'receiverDetail', key: 'receiverDetail', width: 200, type: 'ellipsis', group: '收货信息' },
      { title: '打单人', dataIndex: 'printer', key: 'printer', width: 90, type: 'text', group: '人员时间' },
      { title: '拣货人', dataIndex: 'person', key: 'person', width: 90, type: 'text', group: '人员时间' },
      { title: '创建时间', dataIndex: 'createTime', key: 'createTime', width: 160, type: 'date', group: '人员时间' },
      { title: '驳回原因', dataIndex: 'rejectReason', key: 'rejectReason', width: 150, type: 'ellipsis', group: '其他' },
      { title: '备注', dataIndex: 'remark', key: 'remark', width: 150, type: 'ellipsis', group: '其他' },
    ],
    // 搜索栏已改为分字段搜索（客户/标签/款式/编码弹窗选择 + 地址三级联动 + 创建时间日期范围），原综合搜索/拣货状态/仓库三控件移除
    filters: [],
    mockData: Array.from({ length: 0 }, (_, i) => { // 演示数据已下线：生产环境不预置测试数据
      const customers = ['华为技术', '比亚迪', '格力电器', '三一重工', '宁德时代', '美的集团'];
      const details = ['精密主轴组件×2、传动齿轮箱×1', '自动化控制系统×1', '液压缸总成×3', '电气控制柜×1、检测传感器×2', '传动齿轮箱×2'];
      const locations = ['一号仓A-01', '一号仓B-03', '二号仓A-02', '成品仓C-01', '二号仓B-05'];
      const tags = ['加急', 'VIP', '普通', '批发', '当日发货', ''];
      const provinces = ['广东省', '浙江省', '江苏省', '北京市', '上海市', '山东省'];
      const cities = ['深圳市', '杭州市', '南京市', '北京市', '上海市', '济南市'];
      const districts = ['南山区', '余杭区', '江宁区', '朝阳区', '浦东新区', '历下区'];
      const addresses = ['科技园路10号', '未来科技城88号', '软件大道168号', '中关村大街1号', '张江高科技园区', '经十路500号'];
      const receivers = ['张经理', '李主管', '王采购', '赵总监', '陈助理', '刘专员'];
      const printStatuses = ['未打印', '已打印', '已打印', '未打印', '已打印', '未打印'];
      const statusList: RecordStatus[] = ['pending', 'processing', 'completed', 'completed', 'warning', 'pending', 'processing', 'completed', 'pending', 'completed', 'processing', 'completed'];
      const statusNames: Record<string, string> = { pending: '待打单', processing: '拣货中', completed: '已完成', warning: '异常' };
      const s = statusList[i];
      return {
        key: `pp-${i + 1}`,
        id: `PP-${String(25001 + i)}`,
        orderId: `SO${String(20240001 + i)}`,
        name: `拣货-${i + 1}`,
        customerName: customers[i % 6],
        orderTag: tags[i % 6],
        receiverName: receivers[i % 6],
        province: provinces[i % 6],
        city: cities[i % 6],
        district: districts[i % 6],
        receiverDetail: addresses[i % 6],
        printStatus: printStatuses[i % 6],
        productDetail: details[i % 5],
        quantity: Math.floor(Math.random() * 50) + 3,
        location: locations[i % 5],
        status: s,
        statusName: statusNames[s],
        progress: s === 'completed' ? 100 : s === 'processing' ? Math.floor(Math.random() * 60) + 30 : 0,
        printer: s === 'pending' ? '' : ['张三', '李四'][i % 2],
        person: s === 'pending' ? '' : ['王五', '赵六', '孙八'][i % 3],
        createTime: `2024-0${(i % 6) + 1}-${String((i % 25) + 1).padStart(2, '0')} ${String(8 + (i % 9)).padStart(2, '0')}:${String((i * 9) % 60).padStart(2, '0')}`,
        remark: s === 'warning' ? '库位缺货，待补货后继续拣货' : '',
        pendingPrint: 3,
        pendingPick: 3,
        todayDone: 5,
        todayQuantity: 218,
        amount: 0,
        date: '',
        passRate: '',
        deliveryDays: 0,
        margin: '',
        dept: '仓储部',
      };
    }),
  },
};

// 注意：由于文件长度限制，其余模块(生产管理、采购管理、库存管理、财务管理、经营看板)的配置
// 将在下一部分文件中定义
