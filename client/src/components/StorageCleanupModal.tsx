/**
 * 存储空间整理清理弹窗
 * 按页面清理，且所有页面均只清理关联图片，页面数据一律不删除
 * 产品列表为核心主数据，仅展示占用体积，不可勾选清理
 * 支持备份和恢复数据功能
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Modal, Button, Checkbox, Space, Alert, Progress, message, Tag, Divider, DatePicker, Typography, Tooltip, Upload } from 'antd';
import { DeleteOutlined, WarningOutlined, CheckCircleOutlined, CalendarOutlined, AppstoreOutlined, InfoCircleOutlined, PictureOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { formatStorageSize } from '../utils/storageQuota';
import dayjs, { Dayjs } from 'dayjs';

const { confirm } = Modal;
const { RangePicker } = DatePicker;
const { Text } = Typography;

// 页面映射表：键前缀 → 友好名称 + 说明 + 关联图片类型 + 依赖关系
interface PageInfo {
  name: string;
  description: string;
  imagePrefix?: string; // 关联的图片键前缀，无则为 undefined
  imageDescription?: string; // 图片说明
  dependsOn?: string[]; // 依赖的页面（清理这些页面会影响本页面）
  requiredBy?: string[]; // 被哪些页面依赖（清理本页面会影响这些页面）
  keyPrefixes?: string[]; // 自定义数据键前缀（拼接 owner 后缀，非 pageData_ 体系）
  hidden?: boolean; // 不在清理页面目录中显示（如全局共享键，按账号清理不安全）
  viewOnly?: boolean; // 仅在目录中展示占用体积，不可勾选清理（核心主数据页面）
  dataKeyPrefixes?: string[]; // 非 pageData_ 体系的业务数据键前缀（拼接 owner，如 purchaser_bills_ / ws_stock_）
  embeddedImageFields?: string[]; // 数据记录内嵌 base64 图片的字段名；清理时剥离图片保留记录
}

// 排除列表：这些页面不在清理选项中显示
const EXCLUDED_PAGES = new Set([
  'settings_production-fee',        // 生产工价
  'settings_print-template',        // 打印模板
  'sales_print-picking',            // 打印拣货
  'sales_price-fluctuation',        // 价格波动
  'sales_order-profit',             // 订单利润
  'sales_order-manage',             // 销售订单
  'production_custom-order-templates', // 自定义订单模板
  'production_custom-order-default',   // 自定义订单默认
  'inventory_prod-in-stats',        // 库存生产统计
  'finance_bank-account',           // 银行账户
  'basic-data_route-map',           // 工艺路线
  'basic-data_prod-process',        // 生产工序
]);

const PAGE_INFO_MAP: Record<string, PageInfo> = {
  'basic-data_product-list': {
    name: '产品列表',
    description: '商品资料中的产品数据（名称、规格、价格等）；仅展示占用，不可勾选清理（图片请走「产品图片」项）',
    imagePrefix: 'prodImg_',
    imageDescription: '产品图片（prodImg_ 前缀）',
    requiredBy: ['sales_order-manage', 'production_processing-order', 'production_production-order', 'customer_bill-detail'],
    viewOnly: true,
  },
  'product_images': {
    name: '产品图片',
    description: '商品资料中的产品图片（仅清理图片，产品数据保留）',
    imagePrefix: 'prodImg_',
    imageDescription: '产品图片（prodImg_ 前缀）',
  },
  'customer_customer-info': {
    name: '客户管理',
    description: '客户基础信息（直接客户 + 已绑定采购商）',
    keyPrefixes: ['customers_', 'boundPurchasers_'],
  },
  'purchaser_supplier-list': {
    name: '采购商供应商列表',
    description: '采购商平台的供应商条目与合作状态',
    keyPrefixes: ['purchaser_suppliers_'],
  },
  'mold_manage': {
    name: '模具管理',
    description: '模具台账数据',
    keyPrefixes: ['molds_'],
  },
  'basic-data_plan-design': {
    name: '新款进度',
    description: '新款研发进度数据',
    requiredBy: ['production_production-order'],
  },
  'basic-data_prod-process': {
    name: '生产工序',
    description: '生产工序模板数据',
    requiredBy: ['production_processing-order', 'production_production-order'],
  },
  'basic-data_route-map': {
    name: '工艺路线',
    description: '工艺路线模板数据',
    requiredBy: ['production_production-order'],
  },
  'sales_order-manage': {
    name: '销售订单',
    description: '订单管理中的销售订单数据',
    imagePrefix: 'payShot_',
    imageDescription: '订单付款截图（payShot_ 前缀）',
    dependsOn: ['basic-data_product-list'],
    requiredBy: ['customer_bill-detail', 'sales_finance-audit', 'sales_order-profit'],
  },
  'sales_finance-audit': {
    name: '财务审核',
    description: '订单财务审核数据',
    dependsOn: ['sales_order-manage'],
  },
  'sales_order-profit': {
    name: '订单利润',
    description: '订单利润分析数据',
    dependsOn: ['sales_order-manage'],
  },
  'sales_price-fluctuation': {
    name: '价格波动',
    description: '价格波动分析数据',
    dependsOn: ['sales_order-manage'],
  },
  'sales_print-picking': {
    name: '打印拣货',
    description: '打印拣货相关数据',
    dependsOn: ['sales_order-manage'],
  },
  'sales_sales-analysis': {
    name: '销售分析',
    description: '销售数据分析',
    dependsOn: ['sales_order-manage'],
  },
  'sales_sales-ranking': {
    name: '销售排名',
    description: '销售排名统计数据',
    dependsOn: ['sales_order-manage'],
  },
  'customer_bill-detail': {
    name: '账单明细',
    description: '客户对账管理中的账单明细数据',
    imagePrefix: 'payShot_',
    imageDescription: '账单付款截图（payShot_ 前缀）',
    dependsOn: ['sales_order-manage', 'basic-data_product-list'],
  },
  'customer_customer-segment': {
    name: '客户分群',
    description: '客户分群分析数据',
  },
  'customer_rfm-analysis': {
    name: 'RFM 分析',
    description: '客户 RFM 分析数据',
  },
  'finance_bank-account': {
    name: '银行账户',
    description: '财务管理中的银行账户数据',
    requiredBy: ['finance_payment-request'],
  },
  'finance_payment-request': {
    name: '付款申请',
    description: '收/付申请中的付款申请数据',
    dependsOn: ['finance_bank-account', 'sales_order-manage'],
    requiredBy: ['finance_general-ledger'],
  },
  'finance_general-ledger': {
    name: '总账簿',
    description: '会计账簿中的总账簿数据',
    dependsOn: ['finance_payment-request'],
  },
  'finance_simple-ledger': {
    name: '简易账本',
    description: '会计账簿中的简易账本数据',
  },
  'hr_salary': {
    name: '工资管理',
    description: '人事管理中的工资数据',
  },
  'hr_attendance': {
    name: '考勤管理',
    description: '人事管理中的考勤数据',
  },
  'warehouse': {
    name: '仓库管理',
    description: '仓库统计数据',
  },
  'purchase_bill': {
    name: '采购账单',
    description: '采购商账单记录；清理仅剥离账单内嵌图片，账单数据保留',
    dataKeyPrefixes: ['purchaser_bills_'],
    embeddedImageFields: ['images', 'supplierImages', 'purchaserImages'],
    imageDescription: '账单内嵌图片（images / supplierImages / purchaserImages 字段）',
  },
  'warehouse_stats': {
    name: '仓库统计',
    description: '仓库统计备货/配货/急采记录；清理仅剥离记录内嵌图片，记录数据保留',
    dataKeyPrefixes: ['ws_stock_', 'ws_pick_', 'ws_urgent_'],
    embeddedImageFields: ['image'],
    imageDescription: '记录内嵌图片（image 字段）',
  },
  'brand_auth': {
    name: '品牌授权',
    description: '品牌管理中的授权书数据',
  },
  'market': {
    name: '商机市场',
    description: '商机市场中的货盘数据（全局共享键，不按账号清理）',
    hidden: true,
  },
  'bom': {
    name: '物料清单',
    description: '新品研发中的 BOM 数据',
  },
  'contract_factory': {
    name: '加工合同',
    description: '合作申请中的加工合同数据',
  },
  'production_processing-order': {
    name: '加工订单',
    description: '生产模块中的加工订单数据',
    dependsOn: ['basic-data_product-list', 'basic-data_prod-process'],
  },
  'production_production-order': {
    name: '生产订单',
    description: '生产模块中的生产订单数据',
    dependsOn: ['basic-data_product-list', 'basic-data_prod-process', 'basic-data_route-map', 'basic-data_plan-design'],
    requiredBy: ['production_production-schedule'],
  },
  'production_production-schedule': {
    name: '生产排期',
    description: '生产排期计划数据',
    dependsOn: ['production_production-order'],
  },
  'production_custom-order-default': {
    name: '自定义订单默认',
    description: '自定义订单默认配置数据',
  },
  'production_custom-order-templates': {
    name: '自定义订单模板',
    description: '自定义订单模板数据',
  },
  'purchase_mps-stats': {
    name: 'MPS 统计',
    description: '采购 MPS 统计数据',
  },
  'production_purchase-requisition': {
    name: '采购申请',
    description: '采购申请单数据',
  },
  'settings_print-template': {
    name: '打印模板',
    description: '系统设置中的打印模板数据',
  },
  'settings_production-fee': {
    name: '生产工价',
    description: '系统设置中的生产工价数据',
  },
  'dashboard_arrival-remind': {
    name: '到货提醒',
    description: '首页到货提醒数据',
  },
  'dashboard_inventory-check-stats': {
    name: '盘点统计',
    description: '首页盘点统计数据',
  },
  'dashboard_order-exec-track': {
    name: '订单执行跟踪',
    description: '首页订单执行跟踪数据',
  },
};

interface StorageCleanupModalProps {
  open: boolean;
  onClose: () => void;
  onCleanupComplete?: () => void;
}

interface PageUsage {
  page: string;
  dataSize: number;
  imageSize: number;
  totalSize: number;
}

interface ScanResult {
  keys: string[];
  stripItems: { key: string; fields: string[] }[];
  totalSize: number;
  timeRange?: { from: string; to: string };
  pageBreakdown: {
    page: string;
    dataCount: number;
    dataSize: number;
    imageCount: number;
    imageSize: number;
    onlyImage: boolean;
  }[];
}

const StorageCleanupModal: React.FC<StorageCleanupModalProps> = ({ open, onClose, onCleanupComplete }) => {
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [availablePages, setAvailablePages] = useState<string[]>([]);
  const [pageUsageMap, setPageUsageMap] = useState<Map<string, PageUsage>>(new Map());

  const owner = useMemo(() => {
    return localStorage.getItem('username') || '';
  }, []);

  // 解析页面的自定义数据键（非 pageData_ 体系，拼接 owner 后缀，仅返回实际存在的）
  const resolveCustomKeys = useCallback((page: string): string[] => {
    return (PAGE_INFO_MAP[page]?.keyPrefixes || [])
      .map(pfx => pfx + owner)
      .filter(k => { try { return localStorage.getItem(k) !== null; } catch { return false; } });
  }, [owner]);

  // 扫描可用页面和使用量
  const scanAvailablePages = useCallback(() => {
    const pages = new Set<string>();
    const usageMap = new Map<string, PageUsage>();
    // 预置页面目录：所有未排除且未隐藏的页面都可选（无数据的显示「无数据」）
    Object.keys(PAGE_INFO_MAP).forEach(p => { if (!EXCLUDED_PAGES.has(p) && !PAGE_INFO_MAP[p].hidden) pages.add(p); });

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      
      const match = key.match(/^pageData_([^_]+(?:_[^_]+)?)_(.+)$/);
      if (match && match[2] === owner) {
        const page = match[1];
        // 过滤掉排除的页面
        if (EXCLUDED_PAGES.has(page)) continue;
        pages.add(page);

        // 计算页面数据大小
        const value = localStorage.getItem(key) || '';
        const size = (key.length + value.length) * 2;
        
        const existing = usageMap.get(page) || { page, dataSize: 0, imageSize: 0, totalSize: 0 };
        existing.dataSize += size;
        existing.totalSize += size;
        usageMap.set(page, existing);
      }

      // 计算图片大小
      if (key.startsWith('prodImg_') && key.includes(owner)) {
        // 找到对应的页面
        const pagesArray = Array.from(pages);
        for (const page of pagesArray) {
          if (PAGE_INFO_MAP[page]?.imagePrefix === 'prodImg_') {
            const value = localStorage.getItem(key) || '';
            const size = (key.length + value.length) * 2;
            const existing = usageMap.get(page) || { page, dataSize: 0, imageSize: 0, totalSize: 0 };
            existing.imageSize += size;
            existing.totalSize += size;
            usageMap.set(page, existing);
            break;
          }
        }
      }

      if (key.startsWith('payShot_') && key.includes(owner)) {
        // 找到对应的页面（销售订单或账单明细）
        const targetPages = ['sales_order-manage', 'customer_bill-detail'];
        for (const page of targetPages) {
          if (PAGE_INFO_MAP[page]?.imagePrefix === 'payShot_') {
            const value = localStorage.getItem(key) || '';
            const size = (key.length + value.length) * 2;
            const existing = usageMap.get(page) || { page, dataSize: 0, imageSize: 0, totalSize: 0 };
            existing.imageSize += size;
            existing.totalSize += size;
            usageMap.set(page, existing);
            break;
          }
        }
      }
    }

    // 自定义数据键（customers_/boundPurchasers_/purchaser_suppliers_/molds_ 等）计入对应页面用量
    pages.forEach(page => {
      resolveCustomKeys(page).forEach(k => {
        const value = localStorage.getItem(k) || '';
        const size = (k.length + value.length) * 2;
        const existing = usageMap.get(page) || { page, dataSize: 0, imageSize: 0, totalSize: 0 };
        existing.dataSize += size;
        existing.totalSize += size;
        usageMap.set(page, existing);
      });
      // 非 pageData_ 体系的业务数据键（采购账单/仓库统计等）计入对应页面用量
      (PAGE_INFO_MAP[page]?.dataKeyPrefixes || []).forEach(pfx => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(pfx) || !k.includes(owner)) continue;
          const value = localStorage.getItem(k) || '';
          const size = (k.length + value.length) * 2;
          const existing = usageMap.get(page) || { page, dataSize: 0, imageSize: 0, totalSize: 0 };
          existing.dataSize += size;
          existing.totalSize += size;
          usageMap.set(page, existing);
        }
      });
    });

    setAvailablePages(Array.from(pages).sort());
    setPageUsageMap(usageMap);
  }, [owner, resolveCustomKeys]);

  // 从关联业务数据中提取日期
  const extractDateFromBusinessData = useCallback((imageKey: string): string | null => {
    if (imageKey.startsWith('prodImg_')) {
      const match = imageKey.match(/^prodImg_([^_]+)_(.+)$/);
      if (match) {
        const recordKey = match[2];
        try {
          const products = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]');
          const product = products.find((p: any) => p.key === recordKey);
          if (product?.createdAt) return product.createdAt;
          if (product?.date) return product.date;
        } catch { /* ignore */ }
      }
    }

    if (imageKey.startsWith('payShot_')) {
      try {
        const orders = JSON.parse(localStorage.getItem(`pageData_sales_order-manage_${owner}`) || '[]');
        for (const order of orders) {
          if (order.payScreenshot === imageKey || order.payScreenshotKey === imageKey) {
            return order.createdAt || order.date || null;
          }
        }
      } catch { /* ignore */ }
    }

    return null;
  }, [owner]);

  // 弹窗打开时自动扫描可用页面
  useEffect(() => {
    if (open) {
      scanAvailablePages();
    }
  }, [open, scanAvailablePages]);

  // 扫描符合条件的键
  const scanKeys = useCallback(() => {
    if (selectedPages.length === 0) {
      message.warning('请至少选择一个页面');
      return;
    }

    setScanning(true);
    setScanResult(null);

    setTimeout(() => {
      const matchedKeys: string[] = [];
      const stripItems: { key: string; fields: string[] }[] = [];
      const stripKeys = new Set<string>();
      let totalSize = 0;
      const pageBreakdownMap = new Map<string, {
        dataCount: number;
        dataSize: number;
        imageCount: number;
        imageSize: number;
        onlyImage: boolean;
      }>();
      let minDate: string | null = null;
      let maxDate: string | null = null;

      let dateFrom: string | null = null;
      let dateTo: string | null = null;
      if (dateRange && dateRange[0] && dateRange[1]) {
        dateFrom = dateRange[0].format('YYYY-MM-DD');
        dateTo = dateRange[1].format('YYYY-MM-DD');
      }

      for (const page of selectedPages) {
        const pageInfo = PAGE_INFO_MAP[page];
        if (!pageInfo) continue;

        // 所有页面一律只清理图片：独立图片键删除 + 内嵌 base64 图片剥离，页面数据记录保留
        const stats = { dataCount: 0, dataSize: 0, imageCount: 0, imageSize: 0, onlyImage: true };

        // 1. 内嵌图片剥离（采购账单/仓库统计等：清空记录内 base64 图片字段，保留记录）
        const embFields = pageInfo.embeddedImageFields || [];
        if (embFields.length) {
          (pageInfo.dataKeyPrefixes || []).forEach(pfx => {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (!key || !key.startsWith(pfx) || !key.includes(owner)) continue;
              if (stripKeys.has(key)) continue;
              const raw = localStorage.getItem(key) || '';
              try {
                const parsed = JSON.parse(raw);
                const list: any[] = Array.isArray(parsed) ? parsed : [parsed];
                let cnt = 0, saved = 0;
                list.forEach((rec: any) => {
                  if (!rec || typeof rec !== 'object') return;
                  embFields.forEach(f => {
                    const v = rec[f];
                    if (Array.isArray(v)) v.forEach((s: any) => { if (typeof s === 'string' && s) { cnt++; saved += s.length * 2; } });
                    else if (typeof v === 'string' && v) { cnt++; saved += v.length * 2; }
                  });
                });
                if (cnt > 0) {
                  stripKeys.add(key);
                  stripItems.push({ key, fields: embFields });
                  stats.imageCount += cnt;
                  stats.imageSize += saved;
                  totalSize += saved;
                }
              } catch { /* ignore */ }
            }
          });
        }

        // 2. 清理关联独立图片键
        if (pageInfo.imagePrefix) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (!key.startsWith(pageInfo.imagePrefix)) continue;
            if (!key.includes(owner)) continue;

            const value = localStorage.getItem(key) || '';
            const size = (key.length + value.length) * 2;

            // 时间筛选
            if (dateFrom && dateTo) {
              const bizDate = extractDateFromBusinessData(key);
              if (bizDate) {
                const bizDateStr = dayjs(bizDate).format('YYYY-MM-DD');
                if (bizDateStr >= dateFrom && bizDateStr <= dateTo) {
                  matchedKeys.push(key);
                  totalSize += size;
                  stats.imageCount++;
                  stats.imageSize += size;
                  if (!minDate || bizDateStr < minDate) minDate = bizDateStr;
                  if (!maxDate || bizDateStr > maxDate) maxDate = bizDateStr;
                }
              }
            } else {
              matchedKeys.push(key);
              totalSize += size;
              stats.imageCount++;
              stats.imageSize += size;
            }
          }
        }

        pageBreakdownMap.set(page, stats);
      }

      const pageBreakdown = Array.from(pageBreakdownMap.entries()).map(([page, stats]) => ({
        page,
        ...stats,
      }));

      setScanResult({
        keys: matchedKeys,
        stripItems,
        totalSize,
        timeRange: minDate && maxDate ? { from: minDate, to: maxDate } : undefined,
        pageBreakdown,
      });
      setScanning(false);

      if (matchedKeys.length === 0) {
        message.info(dateFrom && dateTo ? '指定时间范围内未找到符合条件的数据' : '未找到符合条件的数据');
      }
    }, 300);
  }, [selectedPages, owner, dateRange, extractDateFromBusinessData]);

  // 执行清理
  const executeCleanup = useCallback(() => {
    if (!scanResult || scanResult.keys.length === 0) return;

    confirm({
      title: '确认清理',
      icon: <WarningOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <p>即将删除 <strong>{scanResult.keys.length}</strong> 个数据项，预计释放 <strong>{formatStorageSize(scanResult.totalSize / 1024)}</strong> 空间。</p>
          {scanResult.timeRange && (
            <p style={{ fontSize: 12, color: '#666' }}>
              时间范围：{scanResult.timeRange.from} 至 {scanResult.timeRange.to}
            </p>
          )}
          {scanResult.pageBreakdown.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {scanResult.pageBreakdown.map((b, i) => {
                const pageInfo = PAGE_INFO_MAP[b.page];
                return (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <Tag color="purple" style={{ fontSize: 11 }}>{pageInfo?.name || b.page}</Tag>
                    {!b.onlyImage && b.dataCount > 0 && (
                      <span style={{ marginLeft: 4 }}>数据 {b.dataCount} 项，{formatStorageSize(b.dataSize / 1024)}</span>
                    )}
                    {b.imageCount > 0 && (
                      <span style={{ marginLeft: 4, color: '#1890ff' }}>
                        图片 {b.imageCount} 项，{formatStorageSize(b.imageSize / 1024)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Alert
            type="warning"
            message="此操作不可恢复，清理后相关数据将无法恢复"
            style={{ marginTop: 12 }}
          />
        </div>
      ),
      okText: '确认清理',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setCleaning(true);

        try {
          for (const key of scanResult.keys) {
            localStorage.removeItem(key);
          }
          // 内嵌图片剥离：清空记录内 base64 图片字段，保留数据记录
          for (const op of (scanResult.stripItems || [])) {
            const raw = localStorage.getItem(op.key);
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              const isArr = Array.isArray(parsed);
              const list: any[] = isArr ? parsed : [parsed];
              list.forEach((rec: any) => {
                if (!rec || typeof rec !== 'object') return;
                op.fields.forEach(f => {
                  if (Array.isArray(rec[f])) rec[f] = [];
                  else if (typeof rec[f] === 'string') rec[f] = '';
                });
              });
              localStorage.setItem(op.key, JSON.stringify(isArr ? parsed : list[0]));
            } catch { /* ignore */ }
          }

          message.success(`清理完成，已释放 ${formatStorageSize(scanResult.totalSize / 1024)} 空间`);
          
          window.dispatchEvent(new Event('storage-usage-updated'));
          
          setSelectedPages([]);
          setDateRange(null);
          setScanResult(null);
          onCleanupComplete?.();
          
          setTimeout(() => {
            setCleaning(false);
            onClose();
          }, 1000);
        } catch (err) {
          message.error('清理失败：' + (err as Error).message);
          setCleaning(false);
        }
      },
    });
  }, [scanResult, onCleanupComplete, onClose]);

  // 备份数据
  const backupData = useCallback(() => {
    if (selectedPages.length === 0) {
      message.warning('请至少选择一个页面进行备份');
      return;
    }

    const backupData: Record<string, any> = {};
    const backupKeys: string[] = [];

    for (const page of selectedPages) {
      const pageInfo = PAGE_INFO_MAP[page];
      if (!pageInfo) continue;

      // 备份页面数据
      const pageDataKey = `pageData_${page}_${owner}`;
      const pageDataValue = localStorage.getItem(pageDataKey);
      if (pageDataValue) {
        backupData[pageDataKey] = JSON.parse(pageDataValue);
        backupKeys.push(pageDataKey);
      }

      // 备份自定义数据键
      resolveCustomKeys(page).forEach(k => {
        const v = localStorage.getItem(k);
        if (v) {
          try { backupData[k] = JSON.parse(v); } catch { backupData[k] = v; }
          backupKeys.push(k);
        }
      });

      // 备份非 pageData_ 体系业务数据键（采购账单/仓库统计等）
      (pageInfo.dataKeyPrefixes || []).forEach(pfx => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(pfx) || !k.includes(owner)) continue;
          const v = localStorage.getItem(k);
          if (v) {
            try { backupData[k] = JSON.parse(v); } catch { backupData[k] = v; }
            backupKeys.push(k);
          }
        }
      });

      // 备份关联图片
      if (pageInfo.imagePrefix) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (!key.startsWith(pageInfo.imagePrefix)) continue;
          if (!key.includes(owner)) continue;

          const value = localStorage.getItem(key);
          if (value) {
            backupData[key] = value;
            backupKeys.push(key);
          }
        }
      }
    }

    if (backupKeys.length === 0) {
      message.warning('所选页面没有可备份的数据');
      return;
    }

    // 创建备份文件
    const backup = {
      version: '1.0',
      backupTime: new Date().toISOString(),
      owner,
      pages: selectedPages,
      data: backupData,
      summary: {
        totalKeys: backupKeys.length,
        pages: selectedPages.map(page => {
          const pageInfo = PAGE_INFO_MAP[page];
          const usage = pageUsageMap.get(page);
          return {
            page,
            name: pageInfo?.name || page,
            dataSize: usage?.dataSize || 0,
            imageSize: usage?.imageSize || 0,
          };
        }),
      },
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storage_backup_${owner}_${dayjs().format('YYYYMMDD_HHmmss')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    message.success(`备份完成，已导出 ${backupKeys.length} 个数据项`);
  }, [selectedPages, owner, pageUsageMap, resolveCustomKeys]);

  // 恢复数据
  const restoreData = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target?.result as string);
        
        // 验证备份文件
        if (!backup.version || !backup.data || !backup.owner) {
          message.error('无效的备份文件格式');
          return;
        }

        if (backup.owner !== owner) {
          message.error(`备份文件属于账号 "${backup.owner}"，当前账号为 "${owner}"，无法恢复`);
          return;
        }

        // 确认恢复
        confirm({
          title: '确认恢复数据',
          icon: <WarningOutlined style={{ color: '#faad14' }} />,
          content: (
            <div>
              <p>即将从备份文件恢复 <strong>{Object.keys(backup.data).length}</strong> 个数据项。</p>
              <p style={{ fontSize: 12, color: '#666' }}>
                备份时间：{dayjs(backup.backupTime).format('YYYY-MM-DD HH:mm:ss')}
              </p>
              <p style={{ fontSize: 12, color: '#666' }}>
                备份页面：{backup.pages?.map((p: string) => PAGE_INFO_MAP[p]?.name || p).join('、')}
              </p>
              <Alert
                type="warning"
                message="恢复操作将覆盖当前数据，请确认是否继续"
                style={{ marginTop: 12 }}
              />
            </div>
          ),
          okText: '确认恢复',
          cancelText: '取消',
          onOk: () => {
            try {
              // 写入数据
              for (const [key, value] of Object.entries(backup.data)) {
                if (typeof value === 'string') {
                  localStorage.setItem(key, value);
                } else {
                  localStorage.setItem(key, JSON.stringify(value));
                }
              }

              message.success(`恢复完成，已导入 ${Object.keys(backup.data).length} 个数据项`);
              
              window.dispatchEvent(new Event('storage-usage-updated'));
              scanAvailablePages();
            } catch (err) {
              message.error('恢复失败：' + (err as Error).message);
            }
          },
        });
      } catch (err) {
        message.error('备份文件解析失败：' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  }, [owner, scanAvailablePages]);

  const handleClose = useCallback(() => {
    setSelectedPages([]);
    setDateRange(null);
    setScanResult(null);
    setScanning(false);
    setCleaning(false);
    onClose();
  }, [onClose]);

  return (
    <Modal
      title={
        <Space>
          <DeleteOutlined />
          <span>整理存储空间</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={720}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          取消
        </Button>,
        <Button
          key="backup"
          icon={<DownloadOutlined />}
          onClick={backupData}
          disabled={selectedPages.length === 0}
        >
          备份数据
        </Button>,
        <Button
          key="scan"
          type="primary"
          onClick={scanKeys}
          loading={scanning}
          disabled={selectedPages.length === 0 || cleaning}
        >
          扫描预览
        </Button>,
        <Button
          key="cleanup"
          danger
          type="primary"
          onClick={executeCleanup}
          loading={cleaning}
          disabled={!scanResult || scanResult.keys.length === 0}
        >
          执行清理
        </Button>,
      ]}
    >
      <Alert
        type="info"
        message="清理说明"
        description={
          <div>
            <p style={{ marginBottom: 4 }}>选择要清理的页面，<strong>所有页面均只清理图片，页面数据一律保留</strong>：</p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
              <li>独立图片键（产品图片 / 付款截图）：直接删除图片键</li>
              <li>内嵌图片（采购账单 / 仓库统计记录内的 base64 图片）：剥离图片字段，记录保留</li>
              <li>「产品列表」仅展示占用体积，不可勾选清理（其图片请走「产品图片」项）</li>
            </ul>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              <strong>备份功能：</strong>清理前可点击「备份数据」将选中页面的数据导出为 JSON 文件保存到本地电脑，以便后续恢复。
            </p>
          </div>
        }
        style={{ marginBottom: 16 }}
        showIcon
      />

      {/* 恢复数据按钮 */}
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        <Upload
          beforeUpload={(file) => {
            restoreData(file);
            return false;
          }}
          accept=".json"
          showUploadList={false}
        >
          <Button icon={<UploadOutlined />}>
            从备份恢复
          </Button>
        </Upload>
      </div>

      {/* 时间范围 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          <CalendarOutlined style={{ marginRight: 6 }} />
          时间范围（可选，仅对图片生效）：
        </div>
        <RangePicker
          value={dateRange}
          onChange={(dates) => setDateRange(dates as [Dayjs | null, Dayjs | null] | null)}
          style={{ width: '100%' }}
          placeholder={['开始日期', '结束日期']}
          disabled={scanning || cleaning}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          提示：基于关联业务数据的创建时间筛选。不选择则清理全部时间的数据。
        </Text>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* 页面列表 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>
          <AppstoreOutlined style={{ marginRight: 6 }} />
          选择要清理的页面：
        </div>
        <Checkbox.Group
          value={selectedPages}
          onChange={(vals) => setSelectedPages(vals as string[])}
          style={{ width: '100%' }}
          disabled={scanning || cleaning}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {availablePages.length === 0 ? (
              <Text type="secondary" style={{ padding: '8px 0' }}>
                暂无可清理的页面数据
              </Text>
            ) : (
              availablePages.map((page) => {
                const pageInfo = PAGE_INFO_MAP[page];
                const name = pageInfo?.name || page;
                const description = pageInfo?.description || '';
                const hasImage = !!pageInfo?.imagePrefix || !!(pageInfo?.embeddedImageFields || []).length;
                const imageDesc = pageInfo?.imageDescription || '';
                const depOn = (pageInfo?.dependsOn || []).filter(p => !EXCLUDED_PAGES.has(p));
                const viewOnly = !!pageInfo?.viewOnly; // 仅展示页面不可勾选清理
                const usage = pageUsageMap.get(page);

                return (
                  <div
                    key={page}
                    style={{
                      padding: '12px 14px',
                      border: '1px solid #d9d9d9',
                      borderRadius: 8,
                      background: selectedPages.includes(page) ? '#e6f7ff' : '#fafafa',
                      transition: 'all 0.3s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <Checkbox value={page} disabled={viewOnly} style={{ marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <Tag color="purple" style={{ fontSize: 12, margin: 0 }}>{name}</Tag>
                          {hasImage && (
                            <Tooltip title={imageDesc}>
                              <PictureOutlined style={{ color: '#1890ff', fontSize: 14 }} />
                            </Tooltip>
                          )}
                          {usage && usage.totalSize > 0 ? (
                            <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
                              {formatStorageSize(usage.totalSize / 1024)}
                            </Tag>
                          ) : (
                            <Tag style={{ fontSize: 11, margin: 0, color: '#8c8c8c' }}>无数据</Tag>
                          )}
                          {viewOnly && (
                            <Tag style={{ fontSize: 11, margin: 0, color: '#8c8c8c' }}>仅展示，不可清理</Tag>
                          )}
                          {hasImage && !viewOnly && (
                            <Text style={{ fontSize: 12, color: '#1890ff' }}>只清理图片，数据保留</Text>
                          )}
                        </div>
                        {description && (
                          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                            {description}
                            {hasImage && (
                              <span style={{ color: '#1890ff' }}> + {imageDesc}</span>
                            )}
                          </Text>
                        )}
                        {/* 依赖提示（数据不再清理，仅作信息展示） */}
                        {depOn.length > 0 && (
                          <div style={{ marginTop: 4, fontSize: 11 }}>
                            <Tooltip title={`本页面依赖以下页面的数据：${depOn.map(p => PAGE_INFO_MAP[p]?.name || p).join('、')}`}>
                              <Tag color="orange" style={{ fontSize: 10, margin: 0, cursor: 'help' }}>
                                依赖{depOn.length}个页面
                              </Tag>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </Space>
        </Checkbox.Group>
      </div>

      {scanning && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Progress type="circle" percent={100} status="active" />
          <div style={{ marginTop: 12, color: '#666' }}>正在扫描数据...</div>
        </div>
      )}

      {scanResult && !scanning && (
        <>
          <Divider />
          <Alert
            type={scanResult.keys.length > 0 ? 'success' : 'warning'}
            message={
              scanResult.keys.length > 0 ? (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <span>
                      找到 <strong>{scanResult.keys.length}</strong> 个数据项，预计释放{' '}
                      <strong>{formatStorageSize(scanResult.totalSize / 1024)}</strong> 空间
                    </span>
                  </Space>
                  {scanResult.timeRange && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      时间范围：{scanResult.timeRange.from} 至 {scanResult.timeRange.to}
                    </Text>
                  )}
                  {scanResult.pageBreakdown.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {scanResult.pageBreakdown.map((b, i) => {
                        const pageInfo = PAGE_INFO_MAP[b.page];
                        return (
                          <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                            <Tag color="purple" style={{ fontSize: 11 }}>{pageInfo?.name || b.page}</Tag>
                            {!b.onlyImage && b.dataCount > 0 && (
                              <span style={{ marginLeft: 4 }}>数据 {b.dataCount} 项，{formatStorageSize(b.dataSize / 1024)}</span>
                            )}
                            {b.imageCount > 0 && (
                              <span style={{ marginLeft: 4, color: '#1890ff' }}>
                                图片 {b.imageCount} 项，{formatStorageSize(b.imageSize / 1024)}
                              </span>
                            )}
                            {b.onlyImage && b.dataCount === 0 && b.imageCount === 0 && (
                              <Text type="secondary" style={{ marginLeft: 4 }}>（无关联图片）</Text>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Space>
              ) : (
                '未找到符合条件的数据'
              )
            }
            showIcon
          />
        </>
      )}

      {cleaning && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Progress type="circle" percent={100} status="active" />
          <div style={{ marginTop: 12, color: '#666' }}>正在清理数据...</div>
        </div>
      )}
    </Modal>
  );
};

export default StorageCleanupModal;
