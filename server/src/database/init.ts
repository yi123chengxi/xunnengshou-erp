import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '172.30.52.13',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'erpuser',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'xinnengshu',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ============================================================
// 数据库表创建脚本
// 工厂生产管理系统 v1.0
// ============================================================

const createTablesSQL = `
-- ==========================================
-- 1. 基础数据模块
-- ==========================================

-- 用户/员工表
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  password VARCHAR(255) NOT NULL COMMENT '密码',
  real_name VARCHAR(50) NOT NULL COMMENT '真实姓名',
  role ENUM('admin','manager','finance','sales','purchase','production','warehouse','viewer') NOT NULL DEFAULT 'viewer' COMMENT '角色',
  phone VARCHAR(20) COMMENT '电话',
  email VARCHAR(100) COMMENT '邮箱',
  status TINYINT(1) DEFAULT 1 COMMENT '状态 1启用 0禁用',
  registered_username VARCHAR(50) COMMENT '所属注册账号（前端注册用户）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_registered (registered_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 客户表
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_code VARCHAR(30) NOT NULL UNIQUE COMMENT '客户编号',
  customer_name VARCHAR(100) NOT NULL COMMENT '客户名称',
  contact_person VARCHAR(50) COMMENT '联系人',
  phone VARCHAR(20) COMMENT '联系电话',
  email VARCHAR(100) COMMENT '邮箱',
  address VARCHAR(255) COMMENT '地址',
  balance DECIMAL(14,2) DEFAULT 0.00 COMMENT '账户余额(应收账款余额)',
  credit_limit DECIMAL(14,2) DEFAULT 0.00 COMMENT '信用额度',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户表';

-- 供应商表
CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_code VARCHAR(30) NOT NULL UNIQUE COMMENT '供应商编号',
  supplier_name VARCHAR(100) NOT NULL COMMENT '供应商名称',
  contact_person VARCHAR(50) COMMENT '联系人',
  phone VARCHAR(20) COMMENT '联系电话',
  email VARCHAR(100) COMMENT '邮箱',
  address VARCHAR(255) COMMENT '地址',
  balance DECIMAL(14,2) DEFAULT 0.00 COMMENT '账户余额(应付账款余额)',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应商表';

-- 产品/成品表
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_code VARCHAR(50) NOT NULL UNIQUE COMMENT '货号',
  product_name VARCHAR(100) NOT NULL COMMENT '产品名称',
  category VARCHAR(50) COMMENT '产品分类',
  unit VARCHAR(20) DEFAULT '件' COMMENT '单位',
  spec VARCHAR(100) COMMENT '规格型号',
  selling_price DECIMAL(14,2) DEFAULT 0.00 COMMENT '销售价',
  cost_price DECIMAL(14,2) DEFAULT 0.00 COMMENT '成本价',
  min_stock INT DEFAULT 0 COMMENT '最低库存',
  max_stock INT DEFAULT 0 COMMENT '最高库存',
  image_url VARCHAR(255) COMMENT '产品图片',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品表';

-- 原材料表
CREATE TABLE IF NOT EXISTS materials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_code VARCHAR(50) NOT NULL UNIQUE COMMENT '物料编码',
  material_name VARCHAR(100) NOT NULL COMMENT '物料名称',
  category VARCHAR(50) COMMENT '物料分类',
  unit VARCHAR(20) DEFAULT 'kg' COMMENT '单位',
  spec VARCHAR(100) COMMENT '规格型号',
  purchase_price DECIMAL(14,2) DEFAULT 0.00 COMMENT '采购价',
  min_stock INT DEFAULT 0 COMMENT '最低库存',
  max_stock INT DEFAULT 0 COMMENT '最高库存',
  supplier_id INT COMMENT '默认供应商',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='原材料表';

-- BOM 物料清单表
CREATE TABLE IF NOT EXISTS bom (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL COMMENT '成品ID',
  material_id INT NOT NULL COMMENT '原材料ID',
  quantity DECIMAL(12,4) NOT NULL COMMENT '用量',
  process_order INT DEFAULT 0 COMMENT '工序顺序',
  remark VARCHAR(255) COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='BOM物料清单';

-- ==========================================
-- 2. 销售订单模块
-- ==========================================

-- 销售订单主表
CREATE TABLE IF NOT EXISTS sales_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL UNIQUE COMMENT '订单编号',
  customer_id INT NOT NULL COMMENT '客户ID',
  order_date DATE NOT NULL COMMENT '订单日期',
  delivery_date DATE COMMENT '交货日期',
  total_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '订单总额',
  paid_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '已付金额',
  order_status ENUM('draft','confirmed','in_production','completed','delivered','cancelled') DEFAULT 'draft' COMMENT '订单状态',
  finance_status ENUM('pending','partial','paid') DEFAULT 'pending' COMMENT '财务状态',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='销售订单主表';

-- 销售订单明细表
CREATE TABLE IF NOT EXISTS sales_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL COMMENT '订单ID',
  product_id INT NOT NULL COMMENT '产品ID',
  quantity INT NOT NULL COMMENT '数量',
  unit_price DECIMAL(14,2) NOT NULL COMMENT '单价',
  total_price DECIMAL(14,2) NOT NULL COMMENT '小计',
  delivered_qty INT DEFAULT 0 COMMENT '已发货数量',
  remark VARCHAR(255) COMMENT '备注',
  FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='销售订单明细表';

-- 发货单
CREATE TABLE IF NOT EXISTS delivery_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_no VARCHAR(50) NOT NULL UNIQUE COMMENT '发货单号',
  order_id INT NOT NULL COMMENT '关联订单',
  customer_id INT NOT NULL COMMENT '客户ID',
  delivery_date DATE NOT NULL COMMENT '发货日期',
  total_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '发货金额',
  delivery_status ENUM('pending','shipped','signed') DEFAULT 'pending' COMMENT '发货状态',
  finance_status ENUM('unbilled','billed','reconciled') DEFAULT 'unbilled' COMMENT '财务对账状态',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发货单';

-- 发货单明细
CREATE TABLE IF NOT EXISTS delivery_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_id INT NOT NULL COMMENT '发货单ID',
  product_id INT NOT NULL COMMENT '产品ID',
  quantity INT NOT NULL COMMENT '发货数量',
  unit_price DECIMAL(14,2) NOT NULL COMMENT '单价',
  total_price DECIMAL(14,2) NOT NULL COMMENT '小计',
  FOREIGN KEY (delivery_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发货单明细';

-- ==========================================
-- 3. 生产管理模块
-- ==========================================

-- 生产工单
CREATE TABLE IF NOT EXISTS production_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  production_no VARCHAR(50) NOT NULL UNIQUE COMMENT '生产单号',
  order_id INT COMMENT '关联销售订单',
  product_id INT NOT NULL COMMENT '产品ID',
  planned_qty INT NOT NULL COMMENT '计划产量',
  completed_qty INT DEFAULT 0 COMMENT '已完成产量',
  start_date DATE COMMENT '计划开始日期',
  end_date DATE COMMENT '计划完成日期',
  actual_start_date DATE COMMENT '实际开始日期',
  actual_end_date DATE COMMENT '实际完成日期',
  status ENUM('planned','in_progress','completed','paused','cancelled') DEFAULT 'planned' COMMENT '状态',
  priority TINYINT DEFAULT 3 COMMENT '优先级 1最高 5最低',
  workshop VARCHAR(50) COMMENT '车间',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='生产工单';

-- 生产报工记录
CREATE TABLE IF NOT EXISTS production_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  production_id INT NOT NULL COMMENT '生产工单ID',
  record_date DATE NOT NULL COMMENT '报工日期',
  worker_id INT COMMENT '操作员',
  completed_qty INT NOT NULL COMMENT '完成数量',
  defect_qty INT DEFAULT 0 COMMENT '不良品数量',
  process_name VARCHAR(50) COMMENT '工序名称',
  remark VARCHAR(255) COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_id) REFERENCES production_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='生产报工记录';

-- ==========================================
-- 4. 采购管理模块
-- ==========================================

-- 采购订单
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_no VARCHAR(50) NOT NULL UNIQUE COMMENT '采购单号',
  supplier_id INT NOT NULL COMMENT '供应商ID',
  order_date DATE NOT NULL COMMENT '采购日期',
  expected_date DATE COMMENT '预计到货日期',
  total_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '采购总额',
  paid_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '已付金额',
  purchase_status ENUM('draft','confirmed','in_transit','received','cancelled') DEFAULT 'draft' COMMENT '采购状态',
  finance_status ENUM('pending','partial','paid') DEFAULT 'pending' COMMENT '付款状态',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购订单';

-- 采购订单明细
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL COMMENT '采购单ID',
  material_id INT NOT NULL COMMENT '物料ID',
  quantity DECIMAL(12,4) NOT NULL COMMENT '采购数量',
  unit_price DECIMAL(14,2) NOT NULL COMMENT '单价',
  total_price DECIMAL(14,2) NOT NULL COMMENT '小计',
  received_qty DECIMAL(12,4) DEFAULT 0 COMMENT '已收货数量',
  remark VARCHAR(255) COMMENT '备注',
  FOREIGN KEY (purchase_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购订单明细';

-- 收货单
CREATE TABLE IF NOT EXISTS receipt_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(50) NOT NULL UNIQUE COMMENT '收货单号',
  purchase_id INT NOT NULL COMMENT '关联采购单',
  supplier_id INT NOT NULL COMMENT '供应商ID',
  receipt_date DATE NOT NULL COMMENT '收货日期',
  total_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '收货金额',
  receipt_status ENUM('pending','received','inspected') DEFAULT 'pending' COMMENT '收货状态',
  finance_status ENUM('unbilled','billed','reconciled') DEFAULT 'unbilled' COMMENT '财务对账状态',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (purchase_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收货单';

-- 收货单明细
CREATE TABLE IF NOT EXISTS receipt_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NOT NULL COMMENT '收货单ID',
  material_id INT NOT NULL COMMENT '物料ID',
  quantity DECIMAL(12,4) NOT NULL COMMENT '收货数量',
  unit_price DECIMAL(14,2) NOT NULL COMMENT '单价',
  total_price DECIMAL(14,2) NOT NULL COMMENT '小计',
  FOREIGN KEY (receipt_id) REFERENCES receipt_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收货单明细';

-- ==========================================
-- 5. 库存管理模块
-- ==========================================

-- 产品库存
CREATE TABLE IF NOT EXISTS product_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL UNIQUE COMMENT '产品ID',
  quantity INT DEFAULT 0 COMMENT '库存数量',
  locked_qty INT DEFAULT 0 COMMENT '锁定数量(已下单未发货)',
  available_qty INT GENERATED ALWAYS AS (quantity - locked_qty) STORED COMMENT '可用库存',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品库存';

-- 原材料库存
CREATE TABLE IF NOT EXISTS material_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL UNIQUE COMMENT '物料ID',
  quantity DECIMAL(12,4) DEFAULT 0 COMMENT '库存数量',
  locked_qty DECIMAL(12,4) DEFAULT 0 COMMENT '锁定数量',
  available_qty DECIMAL(12,4) GENERATED ALWAYS AS (quantity - locked_qty) STORED COMMENT '可用库存',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='原材料库存';

-- 库存出入库记录
CREATE TABLE IF NOT EXISTS inventory_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_type ENUM('in','out','adjust') NOT NULL COMMENT '类型 入库/出库/调整',
  item_type ENUM('product','material') NOT NULL COMMENT '物品类型',
  item_id INT NOT NULL COMMENT '物品ID',
  quantity DECIMAL(12,4) NOT NULL COMMENT '数量',
  before_qty DECIMAL(12,4) DEFAULT 0 COMMENT '变更前数量',
  after_qty DECIMAL(12,4) DEFAULT 0 COMMENT '变更后数量',
  ref_type VARCHAR(30) COMMENT '关联单据类型',
  ref_no VARCHAR(50) COMMENT '关联单据号',
  operator_id INT COMMENT '操作人',
  remark VARCHAR(255) COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='库存出入库记录';

-- ==========================================
-- 6. 财务管理模块 ⭐
-- ==========================================

-- 客户账户(应收账款总览)
CREATE TABLE IF NOT EXISTS customer_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL UNIQUE COMMENT '客户ID',
  total_receivable DECIMAL(14,2) DEFAULT 0.00 COMMENT '应收账款总额',
  total_received DECIMAL(14,2) DEFAULT 0.00 COMMENT '已收总额',
  balance DECIMAL(14,2) DEFAULT 0.00 COMMENT '应收余额',
  last_reconciliation_date DATE COMMENT '最近对账日期',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户应收账户';

-- 供应商账户(应付账款总览)
CREATE TABLE IF NOT EXISTS supplier_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL UNIQUE COMMENT '供应商ID',
  total_payable DECIMAL(14,2) DEFAULT 0.00 COMMENT '应付账款总额',
  total_paid DECIMAL(14,2) DEFAULT 0.00 COMMENT '已付总额',
  balance DECIMAL(14,2) DEFAULT 0.00 COMMENT '应付余额',
  last_reconciliation_date DATE COMMENT '最近对账日期',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应商应付账户';

-- 应收账单(面向客户的账单)
CREATE TABLE IF NOT EXISTS receivable_bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_no VARCHAR(50) NOT NULL UNIQUE COMMENT '账单编号',
  customer_id INT NOT NULL COMMENT '客户ID',
  ref_type ENUM('delivery_order','sales_order','other') NOT NULL COMMENT '来源单据类型',
  ref_no VARCHAR(50) NOT NULL COMMENT '来源单据编号',
  bill_date DATE NOT NULL COMMENT '账单日期',
  due_date DATE COMMENT '到期日期',
  amount DECIMAL(14,2) NOT NULL COMMENT '账单金额',
  received_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '已收金额',
  bill_status ENUM('pending','confirmed','partial','paid','overdue') DEFAULT 'pending' COMMENT '账单状态',
  customer_status ENUM('unconfirmed','confirmed','disputed') DEFAULT 'unconfirmed' COMMENT '客户确认状态',
  reconciliation_status ENUM('unreconciled','reconciled','matched_amount_only','mismatch') DEFAULT 'unreconciled' COMMENT '对账状态',
  reconciliation_remark VARCHAR(500) COMMENT '对账备注',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_customer_status (customer_id, bill_status),
  INDEX idx_ref_no (ref_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应收账单';

-- 应收账单明细
CREATE TABLE IF NOT EXISTS receivable_bill_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_id INT NOT NULL COMMENT '账单ID',
  product_id INT NOT NULL COMMENT '产品ID',
  product_code VARCHAR(50) COMMENT '货号',
  product_name VARCHAR(100) COMMENT '产品名称',
  quantity INT NOT NULL COMMENT '数量',
  unit_price DECIMAL(14,2) NOT NULL COMMENT '单价',
  total_price DECIMAL(14,2) NOT NULL COMMENT '小计',
  FOREIGN KEY (bill_id) REFERENCES receivable_bills(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应收账单明细';

-- 应付账单(面向供应商的账单)
CREATE TABLE IF NOT EXISTS payable_bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_no VARCHAR(50) NOT NULL UNIQUE COMMENT '账单编号',
  supplier_id INT NOT NULL COMMENT '供应商ID',
  ref_type ENUM('receipt_order','purchase_order','other') NOT NULL COMMENT '来源单据类型',
  ref_no VARCHAR(50) NOT NULL COMMENT '来源单据编号',
  bill_date DATE NOT NULL COMMENT '账单日期',
  due_date DATE COMMENT '到期日期',
  amount DECIMAL(14,2) NOT NULL COMMENT '账单金额',
  paid_amount DECIMAL(14,2) DEFAULT 0.00 COMMENT '已付金额',
  bill_status ENUM('pending','confirmed','partial','paid','overdue') DEFAULT 'pending' COMMENT '账单状态',
  supplier_status ENUM('unconfirmed','confirmed','disputed') DEFAULT 'unconfirmed' COMMENT '供应商确认状态',
  reconciliation_status ENUM('unreconciled','reconciled','matched_amount_only','mismatch') DEFAULT 'unreconciled' COMMENT '对账状态',
  reconciliation_remark VARCHAR(500) COMMENT '对账备注',
  created_by INT COMMENT '创建人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_supplier_status (supplier_id, bill_status),
  INDEX idx_ref_no (ref_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应付账单';

-- 应付账单明细
CREATE TABLE IF NOT EXISTS payable_bill_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_id INT NOT NULL COMMENT '账单ID',
  material_id INT NOT NULL COMMENT '物料ID',
  material_code VARCHAR(50) COMMENT '物料编码',
  material_name VARCHAR(100) COMMENT '物料名称',
  quantity DECIMAL(12,4) NOT NULL COMMENT '数量',
  unit_price DECIMAL(14,2) NOT NULL COMMENT '单价',
  total_price DECIMAL(14,2) NOT NULL COMMENT '小计',
  FOREIGN KEY (bill_id) REFERENCES payable_bills(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='应付账单明细';

-- 客户对账记录表(记录每次对账的详细结果)
CREATE TABLE IF NOT EXISTS reconciliation_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reconciliation_type ENUM('receivable','payable') NOT NULL COMMENT '对账类型 应收/应付',
  party_id INT NOT NULL COMMENT '对方ID(客户或供应商)',
  party_type ENUM('customer','supplier') NOT NULL COMMENT '对方类型',
  our_bill_id INT NOT NULL COMMENT '我方账单ID',
  their_bill_no VARCHAR(50) COMMENT '对方账单编号',
  our_amount DECIMAL(14,2) NOT NULL COMMENT '我方金额',
  their_amount DECIMAL(14,2) COMMENT '对方金额',
  amount_match TINYINT(1) COMMENT '金额是否一致',
  detail_match TINYINT(1) COMMENT '明细是否一致',
  match_result ENUM('full_match','amount_match_only','mismatch','no_counterpart') NOT NULL COMMENT '对账结果',
  match_detail JSON COMMENT '对账明细差异JSON',
  reconciliation_date DATE NOT NULL COMMENT '对账日期',
  operator_id INT COMMENT '操作人',
  remark VARCHAR(500) COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES users(id),
  INDEX idx_party (party_id, party_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对账记录表';

-- 客户侧账单(客户在自己的后台看到的账单)
CREATE TABLE IF NOT EXISTS customer_side_bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL COMMENT '客户ID',
  our_bill_no VARCHAR(50) NOT NULL COMMENT '我方账单编号',
  customer_bill_no VARCHAR(50) COMMENT '客户方账单编号',
  amount DECIMAL(14,2) NOT NULL COMMENT '金额',
  bill_date DATE NOT NULL COMMENT '账单日期',
  status ENUM('pending_confirm','confirmed','reconciled','disputed') DEFAULT 'pending_confirm' COMMENT '状态',
  confirmed_at DATETIME COMMENT '确认时间',
  remark VARCHAR(500) COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_customer_bill (customer_id, our_bill_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户侧账单';

-- 供应商侧账单(供应商在自己的后台看到的账单)
CREATE TABLE IF NOT EXISTS supplier_side_bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL COMMENT '供应商ID',
  our_bill_no VARCHAR(50) NOT NULL COMMENT '我方账单编号',
  supplier_bill_no VARCHAR(50) COMMENT '供应商方账单编号',
  amount DECIMAL(14,2) NOT NULL COMMENT '金额',
  bill_date DATE NOT NULL COMMENT '账单日期',
  status ENUM('pending_confirm','confirmed','reconciled','disputed') DEFAULT 'pending_confirm' COMMENT '状态',
  confirmed_at DATETIME COMMENT '确认时间',
  remark VARCHAR(500) COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  INDEX idx_supplier_bill (supplier_id, our_bill_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应商侧账单';

-- 收款记录
CREATE TABLE IF NOT EXISTS payment_received (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(50) NOT NULL UNIQUE COMMENT '收款单号',
  customer_id INT NOT NULL COMMENT '客户ID',
  amount DECIMAL(14,2) NOT NULL COMMENT '收款金额',
  payment_method ENUM('cash','bank_transfer','check','other') DEFAULT 'bank_transfer' COMMENT '收款方式',
  payment_date DATE NOT NULL COMMENT '收款日期',
  bill_ids JSON COMMENT '核销账单ID列表',
  operator_id INT COMMENT '操作人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收款记录';

-- 付款记录
CREATE TABLE IF NOT EXISTS payment_made (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_no VARCHAR(50) NOT NULL UNIQUE COMMENT '付款单号',
  supplier_id INT NOT NULL COMMENT '供应商ID',
  amount DECIMAL(14,2) NOT NULL COMMENT '付款金额',
  payment_method ENUM('cash','bank_transfer','check','other') DEFAULT 'bank_transfer' COMMENT '付款方式',
  payment_date DATE NOT NULL COMMENT '付款日期',
  bill_ids JSON COMMENT '核销账单ID列表',
  operator_id INT COMMENT '操作人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='付款记录';

-- 资金流水
CREATE TABLE IF NOT EXISTS cash_flow (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flow_no VARCHAR(50) NOT NULL UNIQUE COMMENT '流水号',
  flow_type ENUM('income','expense') NOT NULL COMMENT '收支类型',
  category VARCHAR(30) COMMENT '类别',
  amount DECIMAL(14,2) NOT NULL COMMENT '金额',
  balance_after DECIMAL(14,2) NOT NULL COMMENT '变动后余额',
  ref_type VARCHAR(30) COMMENT '关联单据类型',
  ref_no VARCHAR(50) COMMENT '关联单据号',
  flow_date DATE NOT NULL COMMENT '日期',
  operator_id INT COMMENT '操作人',
  remark TEXT COMMENT '备注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资金流水';

-- ==========================================
-- 7. 系统日志
-- ==========================================

CREATE TABLE IF NOT EXISTS system_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT COMMENT '操作人',
  action VARCHAR(50) NOT NULL COMMENT '操作类型',
  module VARCHAR(30) NOT NULL COMMENT '模块',
  target_type VARCHAR(30) COMMENT '目标类型',
  target_id VARCHAR(50) COMMENT '目标ID',
  detail JSON COMMENT '操作详情',
  ip_address VARCHAR(50) COMMENT 'IP地址',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统操作日志';

-- ==========================================
-- 8. 注册用户表（对应前端 localStorage.registeredUsers）
-- ==========================================
CREATE TABLE IF NOT EXISTS registered_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '登录账号',
  password VARCHAR(255) NOT NULL COMMENT '密码',
  role VARCHAR(100) NOT NULL COMMENT '角色',
  company_name VARCHAR(100) COMMENT '公司名称',
  contact_person VARCHAR(50) COMMENT '联系人',
  phone VARCHAR(20) COMMENT '联系电话',
  email VARCHAR(100) COMMENT '电子邮箱',
  register_date DATE COMMENT '注册日期',
  status VARCHAR(20) DEFAULT '待审核' COMMENT '状态',
  trial_end_date DATE COMMENT '试用截止',
  authorized_until DATE COMMENT '授权至',
  deleted_at DATETIME COMMENT '数据清理时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='注册用户表';
`;

export async function initDatabase() {
  const statements = createTablesSQL
    .split(';')
    // 先剔除每段内的 -- 注释行再判空：按 ; 切分后段首常为注释，旧逻辑整段过滤导致 0 张表
    .map(s => s
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .trim())
    .filter(s => s.length > 0);

  for (const sql of statements) {
    try {
      await pool.execute(sql);
    } catch (error: any) {
      // 忽略已存在表的警告
      if (!error.message?.includes('already exists')) {
        console.warn('SQL执行警告:', error.message?.substring(0, 100));
      }
    }
  }
  console.log(`✅ 数据库表初始化完成 (共${statements.length}张表)`);
}

export default pool;
