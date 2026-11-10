import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Space, Tag, message, Typography, Modal, Input, InputNumber, DatePicker,
  Row, Col, Image, Popover, Empty, Upload, Select, Descriptions, Checkbox, AutoComplete, Alert, Dropdown,
  Radio, Tooltip,
} from 'antd';
import {
  PlusOutlined, FileTextOutlined, PictureOutlined, DeleteOutlined, TeamOutlined, ReloadOutlined,
  CameraOutlined, CopyOutlined, EditOutlined, EyeOutlined, SettingOutlined, ShopOutlined,
  SearchOutlined, ShoppingCartOutlined, SwapOutlined, UndoOutlined, ClockCircleOutlined,
  MenuOutlined, DownloadOutlined, FileExcelOutlined, RollbackOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import useResizableColumns from '../hooks/useResizableColumns';
import FieldConfigModal from '../components/FieldConfigModal';
import { appendBillLogEntry, readBillLog, billLogColor, resolveOperatorName, diffBillRecords, PURCHASER_BILL_FIELD_MAP, getCurrentUserDisplayName } from '../utils/billLog';
import { refreshSupplierPurchase } from '../utils/paySummary';
import { isAccountingMode, writeAutoEntries, removeAutoEntries, loadSubjectOptions } from '../utils/accountingBridge';
import { downloadBillExportCsv, BillItemExportRow, loadExportFieldCfg, loadProductMasterMap, resolveItemColorSpec } from '../utils/billItemsExport';
import BillExportFieldModal from '../components/BillExportFieldModal';
import ReturnRegisterModal from '../components/ReturnRegisterModal';
import type { ReturnRegisterPayload } from '../components/ReturnRegisterModal';
import { buildPurchaserReturnBill, writeReturnStockFlows, getOwnCompanyName } from '../utils/returnRegister';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { reloadAfterPull, appendRowsToRemoteKey, declareShrink } from '../utils/serverSync';
import { compressImageFile } from '../utils/imageCompress';
import { loadSupplierFinishedProducts } from '../utils/supplierProducts';
import { loadRoleRecords, loadRoleAll, upsertRecords, loadAllReconRecordsUnion } from '../utils/reconStore';
import { resolveLatestCompanyName } from '../utils/nameSync';

const { Text } = Typography;
const PRIMARY = '#1890ff';

// 明细行是否有效（有编码/数量/单价任一即保留，避免丢失数据）
const hasData = (it: BillItem) => (it.styleCode || '').trim() || (it.productCode || '').trim() || (Number(it.quantity) || 0) > 0 || (Number(it.unitPrice) || 0) > 0;

// 对账完成终态（对账完成/已对账/按供方入账）
const RECON_DONE = ['对账完成', '已对账', '按供方入账'];
// 对账记录列表中是否存在供应商发起的记录（凭证优先；单号回退仅当同号唯一，防同号重复误判）
const matchSupplierRecon = (list: any[], b: { key: string; outboundNo: string }) => {
  const base = (x: any) => (x.initiator || (x.source === 'bill' ? 'supplier' : '')) === 'supplier' &&
    // 对方主体校验：同号跨供应商不误匹配（凭证优先，名称精确兜底）
    (!x.supplierName || !(b as any).supplier || String(x.supplierName).trim() === String((b as any).supplier).trim() || (!!x.supplierUsername && x.supplierUsername === (b as any).supplierUsername));
  if (list.some((x: any) => base(x) && ((!!x.orderNo && x.orderNo === b.key) || (!!x.matchedBillKey && x.matchedBillKey === b.key)))) return true;
  const byDoc = list.filter((x: any) => base(x) && !!b.outboundNo && String(x.docNo || '').trim() === String(b.outboundNo).trim());
  return byDoc.length === 1;
};
// 对账记录列表中是否存在采购商发起的记录（凭证优先；单号回退仅当同号唯一）
const matchPurchaserRecon = (list: any[], b: { key: string; outboundNo: string }) => {
  const base = (x: any) => x.source === 'bill' && x.initiator === 'purchaser' &&
    (!x.supplierName || !(b as any).supplier || String(x.supplierName).trim() === String((b as any).supplier).trim() || (!!x.supplierUsername && x.supplierUsername === (b as any).supplierUsername));
  if (list.some((x: any) => base(x) && ((!!x.orderNo && x.orderNo === b.key) || (!!x.matchedBillKey && x.matchedBillKey === b.key)))) return true;
  const byDoc = list.filter((x: any) => base(x) && !!b.outboundNo && String(x.docNo || '').trim() === String(b.outboundNo).trim());
  return byDoc.length === 1;
};

/** 账单创建时间（毫秒）：createdAt 优先（兼容 'YYYY/M/D HH:mm:ss' 与 ISO），缺失时回退 key 内时间戳、账单日期；用于列表按最新创建排前 */
const billCreatedMs = (b: any): number => {
  const raw = String(b?.createdAt || '');
  if (raw) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
    const m = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  const km = String(b?.key || '').match(/(\d{13})/);
  if (km) return Number(km[1]);
  const dm = String(b?.date || '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (dm) return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])).getTime();
  return 0;
};

// 默认5行空明细
const emptyRows = (): BillItem[] => Array.from({ length: 5 }, () => ({ styleCode: '', productCode: '', color: '', spec: '', quantity: 0, unitPrice: 0, amount: 0, productType: '' }));

/** 合并相同商品编码的明细行（数量求和，单价取第一条，金额重算） */
const mergeDuplicateItems = (items: BillItem[]): BillItem[] => {
  const map = new Map<string, BillItem>();
  const order: string[] = [];
  items.forEach(it => {
    const code = (it.productCode || '').trim();
    if (!code) { // 空编码行保留
      const key = `__empty_${Date.now()}_${Math.random()}`;
      map.set(key, { ...it });
      order.push(key);
      return;
    }
    if (map.has(code)) {
      const existing = map.get(code)!;
      existing.quantity += Number(it.quantity) || 0;
      existing.amount = Math.round(existing.quantity * existing.unitPrice * 100) / 100;
    } else {
      map.set(code, {
        ...it,
        quantity: Number(it.quantity) || 0,
        amount: Math.round((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) * 100) / 100,
      });
      order.push(code);
    }
  });
  return order.map(k => map.get(k)!);
};

/** 合并重复编码并返回被合并的编码列表（用于提示/高亮） */
const mergeWithDuplicateInfo = (items: BillItem[]): { merged: BillItem[]; dupCodes: string[] } => {
  const countMap = new Map<string, number>();
  items.forEach(it => {
    const code = (it.productCode || '').trim();
    if (code) countMap.set(code, (countMap.get(code) || 0) + 1);
  });
  const dupCodes = Array.from(countMap.entries()).filter(([, c]) => c > 1).map(([code]) => code);
  return { merged: mergeDuplicateItems(items), dupCodes };
};

interface BillItem { styleCode: string; productCode: string; color: string; spec: string; quantity: number; unitPrice: number; amount: number; productType?: string; }
interface BillRecord {
  key: string;
  outboundNo: string;
  prefix: string;
  supplier: string;
  date: string;
  items: BillItem[];
  images: string[];
  recorder: string;
  totalQty: number;
  totalAmount: number;
  reconcileResult: string;
  diffNote: string;
  supplierReconciler: string;
  purchaserReconciler: string;
  supplierImages: string[];
  purchaserImages: string[];
  createdAt: string;
  auxDocNo?: string;
  linkedSupplierBillId?: string;
  billSource?: string; // 账单来源：手工新增 / 订单发货 / 退货登记
  docType?: 'outbound' | 'return'; // 单据类型：return=退货登记负数账单
  returnNo?: string;
  linkedOutboundNo?: string;
  returnReason?: string;
}

const PurchaserBillPage: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  const getDataOwner = () => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) return localStorage.getItem('parentAccount') || username;
    return username;
  };
  const storageKey = 'purchaser_bills_' + getDataOwner();
  const supplierStorageKey = 'purchaser_suppliers_' + getDataOwner();

  // 字段显示控制
  const BILL_ALL_FIELDS = [
    { key: 'outboundNo', label: '出库单号' },
    { key: 'auxDocNo', label: '辅助单据号' },
    { key: 'date', label: '日期' },
    { key: 'styleCode', label: '款式编号' },
    { key: 'productCode', label: '商品编码' },
    { key: 'qty', label: '数量' },
    { key: 'amount', label: '采购金额' },
    { key: 'supplier', label: '供应商' },
    { key: 'billSource', label: '账单来源' },
    { key: 'reconcileResult', label: '对账结果' },
    { key: 'diffNote', label: '差异说明' },
    { key: 'supplierReconciler', label: '供应商对账人' },
    { key: 'purchaserReconciler', label: '采购商对账人' },
    { key: 'supplierImages', label: '供应商图片' },
    { key: 'purchaserImages', label: '采购商图片' },
  ];
  const [billFieldOrder, setBillFieldOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`billFieldOrder_${getDataOwner()}`);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) {
          // 迁移：补齐新增字段（如账单来源），剔除已废弃字段
          const known = arr.filter((k: string) => BILL_ALL_FIELDS.some(f => f.key === k));
          BILL_ALL_FIELDS.forEach(f => { if (!known.includes(f.key)) known.push(f.key); });
          return known;
        }
      }
    } catch { /* ignore */ }
    return BILL_ALL_FIELDS.map(f => f.key);
  });
  const [billFieldVisibility, setBillFieldVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(`billFieldVisibility_${getDataOwner()}`);
      if (saved) {
        const obj = JSON.parse(saved);
        BILL_ALL_FIELDS.forEach(f => { if (typeof obj[f.key] !== 'boolean') obj[f.key] = true; });
        return obj;
      }
    } catch { /* ignore */ }
    const def: Record<string, boolean> = {};
    BILL_ALL_FIELDS.forEach(f => { def[f.key] = true; });
    return def;
  });
  const [billFieldConfigVisible, setBillFieldConfigVisible] = useState(false);
  // 导出字段设置弹窗（两种导出模式分别配置）
  const [billExportFieldVisible, setBillExportFieldVisible] = useState(false);
  const saveBillFieldConfig = (order: string[] = billFieldOrder, vis: Record<string, boolean> = billFieldVisibility) => {
    localStorage.setItem(`billFieldOrder_${getDataOwner()}`, JSON.stringify(order));
    localStorage.setItem(`billFieldVisibility_${getDataOwner()}`, JSON.stringify(vis));
  };

  // 列宽可拖拽调整
  const { wrapColumns } = useResizableColumns<BillRecord>(`colWidths_purchaserBill_${getDataOwner()}`);

  const [bills, setBills] = useState<BillRecord[]>([]);
  // 对账记录（判断供应商是否已发起对账）
  const [reconRecords, setReconRecords] = useState<any[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 采购账单搜索（点击查询后生效）
  const emptyPSearch = { no: '', date: '', style: '', code: '', supplier: '', qty: '', amount: '', recon: '' };
  const [pSearch, setPSearch] = useState({ ...emptyPSearch });
  const [pSearchApplied, setPSearchApplied] = useState({ ...emptyPSearch });

  // 新建单据弹窗
  const [createVisible, setCreateVisible] = useState(false);
  const [outboundNo, setOutboundNo] = useState('');
  const [prefix, setPrefix] = useState('');
  const [supplier, setSupplier] = useState('');
  const [billDate, setBillDate] = useState(dayjs());
  const [items, setItems] = useState<BillItem[]>(emptyRows());
  // 新建弹窗：明细行勾选状态 + 批量填充
  const [checkedRows, setCheckedRows] = useState<Set<number>>(new Set());
  const [batchQty, setBatchQty] = useState<number | null>(null);
  const [batchPrice, setBatchPrice] = useState<number | null>(null);
  const [billImage, setBillImage] = useState('');
  // 新建弹窗：出库单号下拉候选（对账管理中供应商发起的对账单）
  const [createReconOptions, setCreateReconOptions] = useState<{ value: string; label: any }[]>([]);
  const loadCreateReconOptions = useCallback(() => {
    const owner = getDataOwner();
    let list: any[] = [];
    // 采购商平台独立对账库：本账号以采购商身份参与的记录（含供应商发起）
    try { list = loadRoleRecords('purchaser', owner); } catch { list = []; }
    const recs = (Array.isArray(list) ? list : []).filter((r: any) => !r.delisted && (r.initiator || 'supplier') === 'supplier' && r.docNo && (!r.customerUsername || r.customerUsername === owner));
    setCreateReconOptions(recs.map((r: any) => ({
      value: r.docNo,
      label: (
        <span>{r.docNo}<span style={{ color: '#8c8c8c', marginLeft: 8, fontSize: 11 }}>{r.supplierName || r.counterparty || ''}　¥{Number(r.ourAmount || 0).toFixed(2)}</span></span>
      ),
    })));
    return recs;
  }, [getDataOwner]);

  // 重复编码高亮（红色字体，保存后恢复）
  const [highlightCodes, setHighlightCodes] = useState<Set<string>>(new Set());
  const flashHighlight = useCallback((codes: string[]) => {
    if (codes.length === 0) return;
    setHighlightCodes(new Set(codes));
  }, []);

  // 供应商选择弹窗
  const [supplierPickVisible, setSupplierPickVisible] = useState(false);
  // 图片上传弹窗
  const [imageUpVisible, setImageUpVisible] = useState(false);
  // 摄像头拍照弹窗
  const [cameraVisible, setCameraVisible] = useState(false);
  // 图片目标（新建/编辑）
  const [imageTarget, setImageTarget] = useState<'create' | 'edit'>('create');
  const [editImage, setEditImage] = useState('');
  // 供应商选择目标
  const [supplierPickTarget, setSupplierPickTarget] = useState<'create' | 'edit'>('create');
  // 编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [eOutboundNo, setEOutboundNo] = useState('');
  const [ePrefix, setEPrefix] = useState('');
  const [eSupplier, setESupplier] = useState('');
  const [eDate, setEDate] = useState(dayjs());
  const [eItems, setEItems] = useState<BillItem[]>(emptyRows());
  // 编辑弹窗：明细行勾选状态 + 批量填充
  const [eCheckedRows, setECheckedRows] = useState<Set<number>>(new Set());
  const [eBatchQty, setEBatchQty] = useState<number | null>(null);
  const [eBatchPrice, setEBatchPrice] = useState<number | null>(null);

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailBill, setDetailBill] = useState<BillRecord | null>(null);
  // 详情弹窗货品明细视图：按商品编码（默认明细）/ 按款式编码（汇总）
  const [detailItemView, setDetailItemView] = useState<'productCode' | 'styleCode'>('productCode');
  // 货品明细弹窗（点击商品编码单元格打开）
  const [billItemDetailVisible, setBillItemDetailVisible] = useState(false);
  const [billItemDetail, setBillItemDetail] = useState<BillRecord | null>(null);
  // 款式编码数量明细弹窗（点击款式编号单元格打开）
  const [styleQtyDetailVisible, setStyleQtyDetailVisible] = useState(false);
  const [styleQtyDetail, setStyleQtyDetail] = useState<{ bill: BillRecord | null; entries: [string, number][] }>({ bill: null, entries: [] });

  // 采购明细显示控制
  const [billDisplayVisible, setBillDisplayVisible] = useState(false);
  const [billDisplay, setBillDisplay] = useState(() => {
    try {
      const saved = localStorage.getItem(`billItemDisplay_${username}`);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { showStyleCode: true, showProductCode: true, showProductType: true, showColor: false, showSpec: false, showQty: true, showPrice: true, showAmount: true };
  });

  // 添加商品弹窗（默认显示自己的成品，可切换供应商货品）
  const [addProductVisible, setAddProductVisible] = useState(false);
  const [addProductTarget, setAddProductTarget] = useState<'create' | 'edit'>('create');
  const [addProductTab, setAddProductTab] = useState<'own' | 'supplier' | 'raw'>('own');
  // 添加商品弹窗：勾选状态 & 数量
  const [addCheckedKeys, setAddCheckedKeys] = useState<Set<string>>(new Set());
  const [addQtyMap, setAddQtyMap] = useState<Record<string, number>>({});
  // 数量模版弹窗
  const [qtyTemplateVisible, setQtyTemplateVisible] = useState(false);
  const [qtyTemplateName, setQtyTemplateName] = useState('');
  const [qtyTemplateRows, setQtyTemplateRows] = useState<{ spec: string; qty: number }[]>([{ spec: '', qty: 0 }]);
  // 加载已保存的数量模版
  const [qtyTemplates, setQtyTemplates] = useState<{ name: string; rows: { spec: string; qty: number }[] }[]>(() => {
    try {
      const saved = localStorage.getItem(`billQtyTemplates_${username}`);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [];
  });

  // 拖拽排序状态
  const [dragTplIdx, setDragTplIdx] = useState<number | null>(null);

  /** 应用数量模版（共享逻辑：填充到当前明细行或添加商品弹窗） */
  const applyQtyTemplate = useCallback((t: { name: string; rows: { spec: string; qty: number }[] }) => {
    let filled = 0;
    if (addProductVisible && addCheckedKeys.size > 0) {
      const currentList = addProductTab === 'own' ? ownProducts : addProductTab === 'raw' ? rawProducts : supplierProducts;
      const newQtyMap = { ...addQtyMap };
      addCheckedKeys.forEach(k => {
        const prod = currentList.find((p: any) => p.key === k);
        if (!prod) return;
        const match = t.rows.find(r => r.spec && prod.spec && String(prod.spec).trim() === String(r.spec).trim());
        if (match) { newQtyMap[k] = match.qty; filled++; }
      });
      setAddQtyMap(newQtyMap);
    }
    if (!addProductVisible || addCheckedKeys.size === 0) {
      if (createVisible) {
        setItems(prev => prev.map(it => {
          const match = t.rows.find(r => r.spec && it.spec && String(it.spec).trim() === String(r.spec).trim());
          if (match) { filled++; const amt = Math.round(match.qty * it.unitPrice * 100) / 100; return { ...it, quantity: match.qty, amount: amt }; }
          return it;
        }));
      } else if (editKey) {
        setEItems(prev => prev.map(it => {
          const match = t.rows.find(r => r.spec && it.spec && String(it.spec).trim() === String(r.spec).trim());
          if (match) { filled++; const amt = Math.round(match.qty * it.unitPrice * 100) / 100; return { ...it, quantity: match.qty, amount: amt }; }
          return it;
        }));
      }
    }
    message.success(`已应用模版「${t.name}」，填充 ${filled} 条`);
  }, [addProductVisible, addCheckedKeys, addProductTab, addQtyMap, createVisible, editKey]);

  /** 模版拖拽排序 */
  const handleTplReorder = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const arr = [...qtyTemplates];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    setQtyTemplates(arr);
    localStorage.setItem(`billQtyTemplates_${username}`, JSON.stringify(arr));
  }, [qtyTemplates, username]);

  /** 删除模版 */
  const removeQtyTemplate = useCallback((idx: number) => {
    const arr = qtyTemplates.filter((_, i) => i !== idx);
    setQtyTemplates(arr);
    localStorage.setItem(`billQtyTemplates_${username}`, JSON.stringify(arr));
  }, [qtyTemplates, username]);

  // 数量模版填充确认弹窗（点击模版后先确认倍数再填充）
  const [qtyFillVisible, setQtyFillVisible] = useState(false);
  const [qtyFillMultiplier, setQtyFillMultiplier] = useState<number>(1);
  const [qtyFillTemplate, setQtyFillTemplate] = useState<{ name: string; rows: { spec: string; qty: number }[] } | null>(null);
  const openQtyFill = useCallback((t: { name: string; rows: { spec: string; qty: number }[] }) => {
    setQtyFillTemplate(t); setQtyFillMultiplier(1); setQtyFillVisible(true);
  }, []);
  const confirmQtyFill = useCallback(() => {
    if (!qtyFillTemplate) return;
    const mult = qtyFillMultiplier || 1;
    applyQtyTemplate({ ...qtyFillTemplate, rows: qtyFillTemplate.rows.map(r => ({ ...r, qty: r.qty * mult })) });
    setQtyFillVisible(false);
  }, [qtyFillTemplate, qtyFillMultiplier, applyQtyTemplate]);

  /** 内联模版标签渲染（可拖拽排序，点击快速填充） */
  const renderInlineTemplates = () => {
    if (qtyTemplates.length === 0) return null;
    return (
      <>
        {qtyTemplates.map((t, i) => (
          <Tag
            key={`${t.name}-${i}`}
            color="blue"
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragTplIdx(i); }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={e => { e.preventDefault(); if (dragTplIdx !== null) handleTplReorder(dragTplIdx, i); setDragTplIdx(null); }}
            onDragEnd={() => setDragTplIdx(null)}
            style={{
              cursor: 'grab',
              opacity: dragTplIdx === i ? 0.4 : 1,
              userSelect: 'none',
              padding: '1px 6px',
              fontSize: 11,
              lineHeight: '20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
            }}
            onClick={() => openQtyFill(t)}
            onClose={(e: any) => { e.preventDefault(); e.stopPropagation(); removeQtyTemplate(i); }}
            closable
          >
            <MenuOutlined style={{ fontSize: 9, color: '#bbb', marginRight: 2 }} />
            {t.name}
          </Tag>
        ))}
      </>
    );
  };

  // 当前录入人显示名称
  const getRecorderName = () => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === username);
      if (u) return u.contactPerson || u.companyName || username;
    } catch { /* ignore */ }
    return username;
  };

  // 合作供应商列表（已合作）+ 单号前缀（来自供应商列表/注册账号）
  const resolvePrefix = (name: string): string => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === name);
      if (u?.orderPrefix) return String(u.orderPrefix);
    } catch { /* ignore */ }
    return '';
  };
  const supplierOptions = useMemo(() => {
    try {
      const data: any[] = JSON.parse(localStorage.getItem(supplierStorageKey) || '[]');
      return data.filter(s => s.cooperationStatus === 'approved')
        .map(s => ({ name: s.supplierName as string, prefix: (s.orderPrefix || resolvePrefix(s.supplierName)) as string }));
    } catch { return []; }
  }, [supplierStorageKey, createVisible]);

  // 搜索栏供应商下拉选项（账单中出现过的 + 已合作供应商）
  const supplierSearchOptions = useMemo(() => {
    const set = new Set<string>();
    bills.forEach(b => { if (b.supplier) set.add(b.supplier); });
    supplierOptions.forEach(o => { if (o.name) set.add(o.name); });
    return Array.from(set).map(n => ({ value: n, label: n }));
  }, [bills, supplierOptions]);

  // 解析供应商注册账号的 username（用于读取供应商自己的产品数据）
  const resolveSupplierUsername = (name: string): string => {
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.companyName === name);
      if (u?.username) return String(u.username);
    } catch { /* ignore */ }
    return '';
  };

  // 加载供应商的成品产品列表（从供应商自己的账号读取；本地缺失时服务端兜底拉取，保证跨浏览器可见）
  const [supplierProducts, setSupplierProducts] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    const currentSupplier = addProductTarget === 'create' ? supplier : eSupplier;
    if (!currentSupplier) { setSupplierProducts([]); return; }
    const productOwner = resolveSupplierUsername(currentSupplier) || getDataOwner();
    loadSupplierFinishedProducts(productOwner)
      .then(list => { if (!cancelled) setSupplierProducts(list); })
      .catch(() => { if (!cancelled) setSupplierProducts([]); });
    return () => { cancelled = true; };
  }, [addProductVisible, addProductTab, supplier, eSupplier, addProductTarget]);

  // 供应商货品搜索状态（输入不触发，点击查询/回车才生效）
  const [spInputCode, setSpInputCode] = useState('');
  const [spInputStyleCode, setSpInputStyleCode] = useState('');
  const [spInputBrand, setSpInputBrand] = useState('');
  const [spInputPriceMin, setSpInputPriceMin] = useState('');
  const [spInputPriceMax, setSpInputPriceMax] = useState('');
  const [spInputStatus, setSpInputStatus] = useState<string>('');
  const [spAppliedCode, setSpAppliedCode] = useState('');
  const [spAppliedStyleCode, setSpAppliedStyleCode] = useState('');
  const [spAppliedBrand, setSpAppliedBrand] = useState('');
  const [spAppliedPriceMin, setSpAppliedPriceMin] = useState('');
  const [spAppliedPriceMax, setSpAppliedPriceMax] = useState('');
  const [spAppliedStatus, setSpAppliedStatus] = useState<string>('');
  const [spPage, setSpPage] = useState(1);
  const [spPageSize, setSpPageSize] = useState(20);

  const handleSpSearch = useCallback(() => {
    reloadAfterPull(reload); // 查询时先本地重载再拉服务端，跨端新增账单立即可见
    setSpAppliedCode(spInputCode); setSpAppliedStyleCode(spInputStyleCode);
    setSpAppliedBrand(spInputBrand); setSpAppliedPriceMin(spInputPriceMin);
    setSpAppliedPriceMax(spInputPriceMax); setSpAppliedStatus(spInputStatus);
    setSpPage(1);
  }, [spInputCode, spInputStyleCode, spInputBrand, spInputPriceMin, spInputPriceMax, spInputStatus]);

  const handleSpReset = useCallback(() => {
    setSpInputCode(''); setSpInputStyleCode(''); setSpInputBrand('');
    setSpInputPriceMin(''); setSpInputPriceMax(''); setSpInputStatus('');
    setSpAppliedCode(''); setSpAppliedStyleCode(''); setSpAppliedBrand('');
    setSpAppliedPriceMin(''); setSpAppliedPriceMax(''); setSpAppliedStatus('');
    setSpPage(1);
  }, []);

  const spFilteredData = useMemo(() => {
    let result = supplierProducts;
    if (spAppliedCode) { const kw = spAppliedCode.toLowerCase(); result = result.filter((r: any) => String(r.productCode || '').toLowerCase().includes(kw)); }
    if (spAppliedStyleCode) { const kw = spAppliedStyleCode.toLowerCase(); result = result.filter((r: any) => String(r.styleCode || '').toLowerCase().includes(kw)); }
    if (spAppliedBrand) { const kw = spAppliedBrand.toLowerCase(); result = result.filter((r: any) => String(r.brand || '').toLowerCase().includes(kw)); }
    if (spAppliedPriceMin) { const min = Number(spAppliedPriceMin); if (!isNaN(min)) result = result.filter((r: any) => Number(r.suggestedPrice) >= min); }
    if (spAppliedPriceMax) { const max = Number(spAppliedPriceMax); if (!isNaN(max)) result = result.filter((r: any) => Number(r.suggestedPrice) <= max); }
    if (spAppliedStatus) { result = result.filter((r: any) => r.productStatus === spAppliedStatus); }
    return result;
  }, [supplierProducts, spAppliedCode, spAppliedStyleCode, spAppliedBrand, spAppliedPriceMin, spAppliedPriceMax, spAppliedStatus]);

  // 供应商货品详情弹窗
  const [spDetailVisible, setSpDetailVisible] = useState(false);
  const [spDetailSupplier, setSpDetailSupplier] = useState('');
  const [spDetailData, setSpDetailData] = useState<any[]>([]);
  // 详情弹窗搜索
  const [spdInputCode, setSpdInputCode] = useState('');
  const [spdInputStyleCode, setSpdInputStyleCode] = useState('');
  const [spdInputBrand, setSpdInputBrand] = useState('');
  const [spdInputPriceMin, setSpdInputPriceMin] = useState('');
  const [spdInputPriceMax, setSpdInputPriceMax] = useState('');
  const [spdInputStatus, setSpdInputStatus] = useState<string>('');
  const [spdAppliedCode, setSpdAppliedCode] = useState('');
  const [spdAppliedStyleCode, setSpdAppliedStyleCode] = useState('');
  const [spdAppliedBrand, setSpdAppliedBrand] = useState('');
  const [spdAppliedPriceMin, setSpdAppliedPriceMin] = useState('');
  const [spdAppliedPriceMax, setSpdAppliedPriceMax] = useState('');
  const [spdAppliedStatus, setSpdAppliedStatus] = useState<string>('');
  const [spdPage, setSpdPage] = useState(1);
  const [spdPageSize, setSpdPageSize] = useState(20);

  const handleSpdSearch = useCallback(() => {
    reloadAfterPull(reload); // 查询时先本地重载再拉服务端，跨端新增账单立即可见
    setSpdAppliedCode(spdInputCode); setSpdAppliedStyleCode(spdInputStyleCode);
    setSpdAppliedBrand(spdInputBrand); setSpdAppliedPriceMin(spdInputPriceMin);
    setSpdAppliedPriceMax(spdInputPriceMax); setSpdAppliedStatus(spdInputStatus);
    setSpdPage(1);
  }, [spdInputCode, spdInputStyleCode, spdInputBrand, spdInputPriceMin, spdInputPriceMax, spdInputStatus]);

  const handleSpdReset = useCallback(() => {
    setSpdInputCode(''); setSpdInputStyleCode(''); setSpdInputBrand('');
    setSpdInputPriceMin(''); setSpdInputPriceMax(''); setSpdInputStatus('');
    setSpdAppliedCode(''); setSpdAppliedStyleCode(''); setSpdAppliedBrand('');
    setSpdAppliedPriceMin(''); setSpdAppliedPriceMax(''); setSpdAppliedStatus('');
    setSpdPage(1);
  }, []);

  const spdFilteredData = useMemo(() => {
    let result = spDetailData;
    if (spdAppliedCode) { const kw = spdAppliedCode.toLowerCase(); result = result.filter((r: any) => String(r.productCode || '').toLowerCase().includes(kw)); }
    if (spdAppliedStyleCode) { const kw = spdAppliedStyleCode.toLowerCase(); result = result.filter((r: any) => String(r.styleCode || '').toLowerCase().includes(kw)); }
    if (spdAppliedBrand) { const kw = spdAppliedBrand.toLowerCase(); result = result.filter((r: any) => String(r.brand || '').toLowerCase().includes(kw)); }
    if (spdAppliedPriceMin) { const min = Number(spdAppliedPriceMin); if (!isNaN(min)) result = result.filter((r: any) => Number(r.suggestedPrice) >= min); }
    if (spdAppliedPriceMax) { const max = Number(spdAppliedPriceMax); if (!isNaN(max)) result = result.filter((r: any) => Number(r.suggestedPrice) <= max); }
    if (spdAppliedStatus) { result = result.filter((r: any) => r.productStatus === spdAppliedStatus); }
    return result;
  }, [spDetailData, spdAppliedCode, spdAppliedStyleCode, spdAppliedBrand, spdAppliedPriceMin, spdAppliedPriceMax, spdAppliedStatus]);

  // 加载自己的成品列表
  const ownProducts = useMemo(() => {
    try {
      const owner = getDataOwner();
      const allProducts = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]');
      return allProducts.filter((p: any) => p.productType === '成品');
    } catch { return []; }
  }, [addProductVisible, addProductTab]);

  // 加载自己的原材料列表
  const rawProducts = useMemo(() => {
    try {
      const owner = getDataOwner();
      const allProducts = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]');
      return allProducts.filter((p: any) => p.productType === '原材料');
    } catch { return []; }
  }, [addProductVisible, addProductTab]);

  const reload = useCallback(() => {
    try {
      let list: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(list)) list = [];
      // 闭环自愈：供应商确认/按采方入账后对账记录已打完成墓碑，但采购账单可能仍停在“已发起对账”
      // （对方浏览器回写未覆盖本端 / 开放页签陈旧）。此处按完成墓碑把在途账单收敛到终态并落库。
      try {
        const all = loadAllReconRecordsUnion();
        const tombs = all.filter((t: any) => t && t.delisted === true && t.withdrawn !== true &&
          (String(t.supResult || '') !== '' || String(t.reconResult || '') === 'matched' || !!t.confirmedAt));
        const alive = all.filter((t: any) => t && !t.delisted);
        if (tombs.length) {
          let ch = false;
          list = list.map((b: any) => {
            const cur = String(b?.reconcileResult || '');
            if (RECON_DONE.includes(cur) || cur === '不相符') return b;
            const byKeyT = (x: any) => (x.matchedBillKey && x.matchedBillKey === b.key) || (x.orderNo && x.orderNo === b.key);
            const byDocT = (x: any) => !!x.docNo && !!b.outboundNo && String(x.docNo).trim() === String(b.outboundNo).trim();
            // 同号消歧：本账号下该出库单号重复时不用 docNo 回退（避免两张同号单都被收敛），仅认凭证
            const dupDoc = !!b.outboundNo && list.filter((y: any) => String(y?.outboundNo || '').trim() === String(b.outboundNo).trim()).length > 1;
            const hitT = (x: any) => byKeyT(x) || (!dupDoc && byDocT(x));
            // 新周期保护：仍存在存活对账记录（完成后重新发起）→ 不收敛
            if (alive.some(hitT)) return b;
            const t = tombs.find(hitT);
            if (!t) return b;
            ch = true;
            return {
              ...b,
              reconcileResult: String(t.supResult || '') === '不相符' ? '不相符' : '已对账',
              diffNote: t.supDiff || b.diffNote || '',
              supplierReconciler: b.supplierReconciler || t.supPerson || '',
              purchaserReconciler: b.purchaserReconciler || t.purPerson || '',
            };
          });
          if (ch) localStorage.setItem(storageKey, JSON.stringify(list));
        }
      } catch { /* ignore */ }
      setBills(list);
    } catch { setBills([]); }
    try { setReconRecords(loadRoleRecords('purchaser', getDataOwner())); } catch { setReconRecords([]); }
  }, [storageKey]);
  useEffect(() => { reload(); }, [reload]);
  // 开放页签实时收敛：同步完成（含自愈回写）或其他标签页写入本账单键时重载，避免显示陈旧对账结果
  useEffect(() => {
    const onUpd = () => reload();
    const onStorage = (e: StorageEvent) => { if (e.key === storageKey) reload(); };
    window.addEventListener('sync-data-updated', onUpd);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('sync-data-updated', onUpd); window.removeEventListener('storage', onStorage); };
  }, [reload, storageKey]);

  // ==== 会计账薄联动：对账结果变更为终态时自动生成会计分录（借：原材料/自定义科目，贷：应付账款）====
  const [acctDebitSubject, setAcctDebitSubject] = useState<string>(() => {
    try { return localStorage.getItem(`purchbill_debit_subject_${getDataOwner()}`) || '原材料'; } catch { return '原材料'; }
  });
  const [acctSubjectModalVisible, setAcctSubjectModalVisible] = useState(false);
  const [acctSubjectDraft, setAcctSubjectDraft] = useState<string>('原材料');
  const [acctSubjectOptions, setAcctSubjectOptions] = useState<{ value: string; label: string }[]>([]);
  const acctMode = isAccountingMode(getDataOwner());
  // 记录上一次对账结果，仅状态发生变更时触发写入/删除（首次挂载只记录不写入）
  const prevReconRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const owner = getDataOwner();
    if (!isAccountingMode(owner)) { prevReconRef.current = {}; return; }
    const next: Record<string, string> = {};
    bills.forEach(b => { next[b.key] = String(b.reconcileResult || ''); });
    const prev = prevReconRef.current;
    if (Object.keys(prev).length > 0) {
      const IN = ['对账完成', '已对账', '按供方入账'];
      bills.forEach(b => {
        const cur = String(b.reconcileResult || '');
        const old = prev[b.key] || '';
        if (cur === old) return;
        const srcKey = `purchbill-recon-${b.key}`;
        if (IN.includes(cur) && !IN.includes(old)) {
          let debit = '原材料';
          try { debit = localStorage.getItem(`purchbill_debit_subject_${owner}`) || '原材料'; } catch { /* 兜底原材料 */ }
          const voucherNo = writeAutoEntries(owner, {
            sourceKey: srcKey,
            debitSubject: debit,
            creditSubject: '应付账款',
            amount: Number(b.totalAmount) || 0,
            summary: `采购供应商「${b.supplier || '-'}」原材料（单据${b.outboundNo || b.key}）对账结果：${cur === '已对账' ? '对账完成' : cur}`,
          });
          // 统计留痕：把自动生成的会计凭证号写入账单日志，建立“对账完成 → 会计凭证”审计链
          if (voucherNo) {
            try {
              const raw = JSON.parse(localStorage.getItem(storageKey) || '[]');
              if (Array.isArray(raw)) {
                const bi = raw.findIndex((x: any) => x.key === b.key);
                if (bi >= 0) {
                  raw[bi] = { ...raw[bi], billLog: appendBillLogEntry(raw[bi].billLog, '生成会计凭证', undefined, `对账完成自动生成会计凭证 ${voucherNo}（借：${debit}／贷：应付账款）`)};
                  localStorage.setItem(storageKey, JSON.stringify(raw));
                }
              }
            } catch { /* ignore */ }
          }
        } else if (!IN.includes(cur) && IN.includes(old)) {
          removeAutoEntries(owner, srcKey);
        }
      });
    }
    prevReconRef.current = next;
  }, [bills, getDataOwner]);

  // 出库单号变更 → 自动识别前缀 + 自动匹配供应商（仅在本租户供应商列表中查找）
  const handleOutboundChange = (val: string) => {
    setOutboundNo(val);
    const p = String(val || '').split('-')[0] || '';
    setPrefix(p);
    // 仅在当前租户的已合作供应商列表中按单号前缀匹配
    const matched = supplierOptions.find(o => String(o.prefix || '') === String(p));
    if (matched) setSupplier(matched.name);
  };

  // 明细行更新
  const updateItem = (idx: number, patch: Partial<BillItem>) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      next.amount = Math.round((Number(next.quantity) || 0) * (Number(next.unitPrice) || 0) * 100) / 100;
      return next;
    }));
  };

  const totalQty = useMemo(() => items.reduce((s, it) => s + (Number(it.quantity) || 0), 0), [items]);
  const totalAmount = useMemo(() => Math.round(items.reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100) / 100, [items]);

  const resetCreate = () => {
    setOutboundNo(''); setPrefix(''); setSupplier(''); setBillDate(dayjs());
    setItems(emptyRows());
    setBillImage('');
  };

  // 保存单据
  const handleSave = () => {
    if (!outboundNo.trim()) { message.warning('请填写出库单号'); return; }
    // 源头防重：同供应商下出库单号已存在时强提示；若已对账完成则禁止新增
    // （避免新增账单复用历史已对账单号，被旧对账证据经单号回写感染为「自动对账完成」）
    try {
      let existBills: any[] = [];
      try { const arr = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(arr)) existBills = arr; } catch { existBills = []; }
      const noTrim = String(outboundNo).trim();
      const supTrim = String(supplier || '').trim();
      const dups = existBills.filter((b: any) => String(b?.outboundNo || '').trim() === noTrim &&
        (!supTrim || String(b?.supplier || '').trim() === supTrim));
      if (dups.length) {
        const doneBill = dups.find((b: any) => RECON_DONE.includes(String(b?.reconcileResult || '')) || String(b?.reconcileResult || '') === '不相符');
        if (doneBill) { message.error(`出库单号 ${noTrim} 在该供应商下已存在且已对账完成，不能重复新增；如需再次对账请先在原账单撤回对账`); return; }
        message.warning(`出库单号 ${noTrim} 在该供应商下已存在 ${dups.length} 张账单，继续新增将产生同号账单，对账时需手动关联`);
      }
    } catch { /* ignore */ }
    const validItems = mergeDuplicateItems(items.filter(hasData));
    const rec: BillRecord = {
      key: `bill-${Date.now()}`,
      outboundNo: outboundNo.trim(),
      prefix,
      supplier,
      date: billDate ? billDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      items: validItems,
      images: billImage ? [billImage] : [],
      recorder: getRecorderName(),
      totalQty,
      totalAmount,
      reconcileResult: '',
      diffNote: '',
      supplierReconciler: '',
      purchaserReconciler: '',
      supplierImages: [],
      purchaserImages: billImage ? [billImage] : [],
      billSource: '手工新增',
      createdAt: new Date().toLocaleString('zh-CN'),
      billLog: appendBillLogEntry(undefined, '创建账单'),
    } as any;
    const all: BillRecord[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const updated = [rec, ...all];
    localStorage.setItem(storageKey, JSON.stringify(updated));
    // 供应商采购金额快照：单对象增量重算（避免列表全量遍历）
    refreshSupplierPurchase(getDataOwner(), [supplier]);
    reload();
    setCreateVisible(false);
    resetCreate();
    setHighlightCodes(new Set());
    message.success('采购账单已保存');
  };

  // ============ 退货登记：负数退货账单 + 镜像同步供应商平台 + 库存出入库联动 ============
  const [returnVisible, setReturnVisible] = useState(false);
  const returnCounterpartyOptions = useMemo(() => {
    if (!returnVisible) return [];
    // 仅当前租户的供应商：取本采购商供应商列表（purchaser_suppliers_<owner>），
    // 账号优先用条目上的 supplierUsername，缺失时按公司名反查（同名账号用绑定关系消歧）
    const owner = getDataOwner();
    const out: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    try {
      const list: any[] = JSON.parse(localStorage.getItem(`purchaser_suppliers_${owner}`) || '[]');
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      list.forEach((s: any) => {
        if (!s) return;
        let un = String(s.supplierUsername || '');
        if (!un) {
          const name = String(s.supplierName || '');
          if (!name) return;
          const cands = users.filter((u: any) => String(u.companyName || '') === name);
          un = (cands.length === 1 ? cands[0] : cands.find((c: any) => {
            try {
              const b: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + c.username) || '[]');
              return b.some((bp: any) => bp.purchaserUsername === owner);
            } catch { return false; }
          }))?.username || '';
        }
        if (!un || seen.has(un)) return;
        seen.add(un);
        out.push({ value: un, label: String(s.supplierName || un) });
      });
    } catch { /* ignore */ }
    return out;
  }, [returnVisible]);
  const returnLinkedOptions = useMemo(() => bills.filter(b => (b as any).docType !== 'return' && b.outboundNo).map(b => ({
    value: b.outboundNo,
    label: `${b.outboundNo}（${b.supplier || '-'} ¥${Number(b.totalAmount || 0).toFixed(2)}）`,
    items: (b.items || []).map(it => ({ productCode: it.productCode, productName: (it as any).productName || '', color: it.color, spec: it.spec, quantity: it.quantity, unitPrice: it.unitPrice })),
  })), [bills]);

  /** 退货登记提交：本端负数账单 → 镜像供应商账单明细 → 库存联动（本端退货出库/供方退货仓入库） */
  const handleReturnRegister = (p: ReturnRegisterPayload) => {
    const owner = getDataOwner();
    const all: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (all.some(b => b.outboundNo === p.returnNo || (b as any).returnNo === p.returnNo)) { message.warning(`退货单 ${p.returnNo} 已登记，请勿重复提交`); return; }
    const now = new Date().toLocaleString('zh-CN');
    const operator = getCurrentUserDisplayName();
    const rec = buildPurchaserReturnBill(p, { operator, supplierName: p.counterpartyName, now },
      appendBillLogEntry(undefined, '退货登记', undefined, p.linkedOutboundNo ? `关联原出库单号 ${p.linkedOutboundNo}` : '')) as unknown as BillRecord;
    localStorage.setItem(storageKey, JSON.stringify([rec, ...all]));
    // 不再即时镜像写供应商账单明细：退货与正常账单一致走对账管理流程，
    // 对方负数退货行由对账完成（completeRecon）时在本端自建（避免跨端整键覆盖擦除对方数据）
    // 库存联动：采购商侧退货出库 + 供应商侧退货仓入库
    writeReturnStockFlows(p, {
      supplierOwner: p.counterpartyUsername, purchaserOwner: owner, operator,
      supplierCompanyName: p.counterpartyName, purchaserCompanyName: getOwnCompanyName(owner),
    });
    refreshSupplierPurchase(owner, [p.counterpartyName]);
    reload();
    setReturnVisible(false);
    message.success(`退货单 ${p.returnNo} 已登记：负数退货账单已生成并同步至供应商平台`);
  };

  // 当前图片（新建/编辑）
  const currentImage = imageTarget === 'create' ? billImage : editImage;
  const setCurrentImage = (v: string) => { if (imageTarget === 'create') setBillImage(v); else setEditImage(v); };
  const openImageModal = (t: 'create' | 'edit') => { setImageTarget(t); setImageUpVisible(true); };

  // 图片上传（单张，校验类型/大小）
  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) { message.error('请选择图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return; }
    compressImageFile(file).then(dataUrl => setCurrentImage(dataUrl)).catch(() => message.error('图片处理失败'));
  };

  // 弹窗打开时监听粘贴图片
  useEffect(() => {
    if (!imageUpVisible) return;
    const onPaste = (e: Event) => {
      const cd = (e as any).clipboardData as DataTransfer | undefined;
      const arr = Array.from(cd?.items || []);
      for (const it of arr) if (it.type.startsWith('image/')) { const b = it.getAsFile(); if (b) { handleImageFile(b); break; } }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [imageUpVisible]);

  // 摄像头拍照
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCameraVisible(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); } }, 0);
    } catch { message.error('无法访问摄像头，请检查权限'); }
  };
  const closeCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraVisible(false);
  };
  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { message.warning('摄像头未就绪'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    setCurrentImage(canvas.toDataURL('image/png'));
    closeCamera();
    message.success('已拍摄图片');
  };

  // ============ 编辑 ============
  const openEdit = (r: BillRecord) => {
    setEditKey(r.key);
    setEOutboundNo(r.outboundNo); setEPrefix(r.prefix); setESupplier(r.supplier);
    setEDate(r.date ? dayjs(r.date) : dayjs());
    setEItems(r.items && r.items.length ? r.items.map(x => ({ ...x })) : emptyRows());
    setEditImage(r.purchaserImages?.[0] || '');
    setEditVisible(true);
  };
  const handleEditOutboundChange = (val: string) => {
    setEOutboundNo(val);
    const p = String(val || '').split('-')[0] || '';
    setEPrefix(p);
    // 仅在当前租户的已合作供应商列表中按单号前缀匹配
    const matched = supplierOptions.find(o => String(o.prefix || '') === String(p));
    if (matched) setESupplier(matched.name);
  };
  const updateEditItem = (idx: number, patch: Partial<BillItem>) => {
    setEItems(prev => prev.map((it, i) => { if (i !== idx) return it; const next = { ...it, ...patch }; next.amount = Math.round((Number(next.quantity) || 0) * (Number(next.unitPrice) || 0) * 100) / 100; return next; }));
  };
  const eTotalQty = useMemo(() => eItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0), [eItems]);
  const eTotalAmount = useMemo(() => Math.round(eItems.reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100) / 100, [eItems]);
  const handleEditSave = () => {
    if (!eOutboundNo.trim()) { message.warning('请填写出库单号'); return; }
    const all: BillRecord[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const validItems = mergeDuplicateItems(eItems.filter(hasData));
    const oldRec = all.find(b => b.key === editKey);
    const newFields: any = {
      outboundNo: eOutboundNo.trim(), prefix: ePrefix, supplier: eSupplier,
      date: eDate ? eDate.format('YYYY-MM-DD') : oldRec?.date,
      items: validItems, totalQty: eTotalQty, totalAmount: eTotalAmount,
    };
    const diffDetail = oldRec ? diffBillRecords(oldRec, newFields, PURCHASER_BILL_FIELD_MAP, ['key', 'images', 'purchaserImages']) : '';
    const updated = all.map(b => b.key === editKey ? {
      ...b,
      outboundNo: eOutboundNo.trim(), prefix: ePrefix, supplier: eSupplier,
      date: eDate ? eDate.format('YYYY-MM-DD') : b.date,
      items: validItems, totalQty: eTotalQty, totalAmount: eTotalAmount,
      // 对账相关字段保留原值，不在编辑弹窗中修改
      // reconcileResult / diffNote / supplierReconciler / purchaserReconciler 保持原值
      images: editImage ? [editImage] : [], purchaserImages: editImage ? [editImage] : [],
      ...(diffDetail ? { billLog: appendBillLogEntry((b as any).billLog, '编辑账单', undefined, diffDetail) } : {}),
    } : b);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    // 供应商采购金额快照：编辑可能改供应商/金额，新旧供应商均单对象重算
    refreshSupplierPurchase(getDataOwner(), Array.from(new Set([oldRec?.supplier, eSupplier].filter((s): s is string => !!s))));
    reload(); setEditVisible(false); setHighlightCodes(new Set()); message.success('采购账单已更新');
  };
  const openDetail = (r: BillRecord) => { setDetailBill(r); setDetailItemView('productCode'); setDetailVisible(true); };

  // 搜索过滤后的账单列表（点击查询后按已应用的搜索条件过滤，最新创建的账单排在最上面）
  // 若仅按账单日期排序，同一天的多条会受存储/同步顺序影响，刚新增的不一定在首位，故以创建时间倒序为主
  const filteredBills = useMemo(() => bills.filter(b => {
    const s = pSearchApplied;
    if (s.no.trim() && !String(b.outboundNo || '').includes(s.no.trim())) return false;
    if (s.date.trim() && !String(b.date || '').includes(s.date.trim())) return false;
    if (s.style.trim()) {
      const styles = (b.items || []).map(i => i.styleCode).filter(Boolean).join(',');
      if (!styles.includes(s.style.trim())) return false;
    }
    if (s.code.trim()) {
      const codes = (b.items || []).map(i => i.productCode).filter(Boolean).join(',');
      if (!codes.includes(s.code.trim())) return false;
    }
    if (s.supplier.trim() && !String(b.supplier || '').includes(s.supplier.trim())) return false;
    if (s.recon === '已对账' && !RECON_DONE.includes(String(b.reconcileResult || ''))) return false;
    if (s.recon === '未对账' && RECON_DONE.includes(String(b.reconcileResult || ''))) return false;
    if (s.qty.trim() && !String(Number(b.totalQty) || 0).includes(s.qty.trim())) return false;
    if (s.amount.trim() && !String(Number(b.totalAmount) || 0).includes(s.amount.trim()) && !(Number(b.totalAmount) || 0).toFixed(2).includes(s.amount.trim())) return false;
    return true;
  }).sort((a, b) => billCreatedMs(b) - billCreatedMs(a)), [bills, pSearchApplied]);

  // 导出明细：按商品编码（逐行）/ 按款式编码（款式汇总，单价取平均价）
  const handleBillExport = useCallback((mode: 'product' | 'style') => {
    const rows: BillItemExportRow[] = [];
    const master = loadProductMasterMap(getDataOwner()); // 颜色/规格/名称回退源
    filteredBills.forEach(b => {
      (b.items || []).forEach(it => {
        const qty = Number(it.quantity) || 0;
        const price = Number(it.unitPrice) || 0;
        if (!qty && !price && !(Number(it.amount) || 0)) return;
        rows.push({
          billNo: b.outboundNo || '',
          date: b.date || '',
          counterparty: b.supplier || '',
          auxDocNo: b.auxDocNo || '',
          reconResult: b.reconcileResult || '',
          diffDesc: b.diffNote || '',
          supplierReconPerson: b.supplierReconciler || '',
          purchaserReconPerson: b.purchaserReconciler || '',
          totalCount: Number(b.totalQty) || 0,
          totalAmount: Number(b.totalAmount) || 0,
          styleCode: it.styleCode || String(it.productCode || '').split('-')[0] || '',
          productCode: it.productCode || '',
          ...resolveItemColorSpec(it, master),
          productType: it.productType || '',
          quantity: qty,
          price,
          amount: Number(it.amount) || Math.round(qty * price * 100) / 100,
        });
      });
    });
    const n = downloadBillExportCsv(rows, mode, '采购账单', loadExportFieldCfg('purchaserBill_' + getDataOwner(), mode));
    if (!n) { message.warning('当前筛选下无可导出的明细数据'); return; }
    message.success(`已导出 ${n} 行（${mode === 'product' ? '按商品编码逐行' : '按款式编码汇总，单价为平均价'}）`);
  }, [filteredBills]);

  /** 发起对账（单条/批量）：生成对账请求写入共享存储，供应商平台对账管理显示 */
  const initiateReconForBills = (list: BillRecord[]) => {
    const uname = localStorage.getItem('username') || '';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    const owner = isSub ? (localStorage.getItem('parentAccount') || uname) : uname;
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    const me = users.find((x: any) => x.username === owner);
    const myCompanyName = me?.companyName || me?.contactPerson || owner;
    let reconList: any[] = [];
    try { reconList = loadRoleRecords('purchaser', owner); } catch { reconList = []; }
    if (!Array.isArray(reconList)) reconList = [];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let added = 0;
    let skipped = 0;
    const initiatedKeys: string[] = [];
    list.forEach(b => {
      // 供应商为空时不能发起对账
      if (!b.supplier || !String(b.supplier).trim()) { skipped += 1; return; }
      // 已对账完成或供应商已发起对账的账单不再发起
      if (RECON_DONE.includes(String(b.reconcileResult || '')) || matchSupplierRecon(reconList, b)) { skipped += 1; return; }
      // 按凭证（本方账单 key）去重：同号重复的两张账单各自持有唯一 key，允许分别发起；
      // 不再按 docNo 去重，否则第二张同号单会被误判“已发起”而无法发起
      if (reconList.some((r: any) => r.source === 'bill' && r.initiator === 'purchaser' && (r.orderNo === b.key || (!!r.matchedBillKey && r.matchedBillKey === b.key)))) { skipped += 1; return; }
      const supUser = users.find((x: any) => x.companyName === b.supplier) || users.find((x: any) => x.companyName === resolveLatestCompanyName(b.supplier || '', ''));
      // 重新发起对账时恢复旧的关联状态（orderNo 使用之前关联的供应商账单ID）
      const orderNo = b.linkedSupplierBillId || b.key;
      reconList.unshift({
        key: `recon-pbill-${b.key}-${Date.now()}-${added}`,
        docNo: b.outboundNo,
        orderNo,
        reconType: 'customer',
        counterparty: b.supplier || '',
        counterpartyCode: supUser?.companyNo || supUser?.companyShortName || '',
        supplierUsername: supUser?.username || '',
        supplierName: b.supplier || '',
        customerUsername: owner,
        customerName: myCompanyName,
        initiator: 'purchaser',
        ourAmount: 0,
        theirAmount: Number(b.totalAmount) || 0,
        reconResult: 'pending',
        diffDesc: '等待供应商响应核对',
        date: today,
        ourEntryDate: '-',
        theirEntryDate: today,
        details: (b.items || []).filter(i => (i.productCode || i.styleCode || '').trim()).map((i, idx: number) => ({
          itemNo: i.productCode || `ITEM-${idx + 1}`,
          styleCode: i.styleCode || String(i.productCode || '').split('-')[0],
          itemName: '',
          ourQty: 0,
          theirQty: Number(i.quantity) || 0,
          ourPrice: 0,
          theirPrice: Number(i.unitPrice) || 0,
          ourSubTotal: 0,
          theirSubTotal: Math.round((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0) * 100) / 100,
          match: false,
        })),
        styleCompare: [],
        source: 'bill',
      });
      initiatedKeys.push(b.key);
      added += 1;
    });
    if (added === 0) { message.warning(skipped > 0 ? '所选账单已对账完成、供应商为空或供应商已发起对账，不能发起对账' : '没有可发起对账的账单'); return; }
    // 分平台库落库：同时写入本账号采购商库与供应商侧库（墓碑优先）
    upsertRecords(reconList);
    // 发起后账单对账结果置为"已发起对账" + 记录日志
    const allBills: BillRecord[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    localStorage.setItem(storageKey, JSON.stringify(allBills.map(b => initiatedKeys.includes(b.key) ? {
      ...b,
      reconcileResult: '已发起对账',
      purchaserReconciler: getCurrentUserDisplayName(),
      billLog: appendBillLogEntry((b as any).billLog, '发起对账', undefined, `出库单号 ${b.outboundNo} 已发送至供应商对账管理`),
    } : b)));
    reload();
    message.success(`已对 ${added} 条账单发起对账，对账请求已发送至供应商平台${skipped > 0 ? `，跳过 ${skipped} 条（已对账完成或供应商已发起对账）` : ''}`);
  };

  /** 撤回对账：本账单的采购商发起对账记录打墓碑（防旧端复活）并还原对账结果 */
  const withdrawRecon = (r: BillRecord) => {
    const uname0 = localStorage.getItem('username') || '';
    const owner0 = localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || uname0) : uname0;
    let list: any[] = [];
    try { list = loadRoleAll('purchaser', owner0); } catch { list = []; }
    // 撤回校验：对方（供应商）已确认/完成的对账不可撤回，避免回滚对方已入账结果、造成状态不一致
    const matchedAlive = list.filter((x: any) => x.source === 'bill' && x.initiator === 'purchaser' && !x.delisted && matchPurchaserRecon([x], r));
    const doneByCp = matchedAlive.find((x: any) => String(x.reconResult || '') === 'matched' || String(x.supResult || '').trim() !== '' || !!x.confirmedAt);
    if (doneByCp) {
      message.error('供应商已完成/确认该对账，无法撤回；请刷新后按对账完成结果处理');
      return;
    }
    const tombRecs: any[] = [];
    const remain = list.map((x: any) => {
      if (x.source === 'bill' && x.initiator === 'purchaser' && !x.delisted && matchPurchaserRecon([x], r)) {
        const t = { ...x, delisted: true, delistedAt: new Date().toISOString(), withdrawn: true };
        tombRecs.push(t);
        return t;
      }
      return x;
    });
    upsertRecords(remain);
    // 闭环：供应商侧镜像状态回滚（“已发起对账”行还原待对账、清辅助单据号、补日志）
    tombRecs.forEach((m: any) => {
      const su = String(m.supplierUsername || '');
      if (!su) return;
      const rk = `pageData_customer_bill-detail_${su}`;
      let rows: any[] = [];
      try { rows = JSON.parse(localStorage.getItem(rk) || '[]'); } catch { return; }
      if (!Array.isArray(rows)) return;
      let ch = false;
      const nextRows = rows.map((row: any) => {
        const hit = (m.orderNo && row.id === m.orderNo) || (!!m.docNo && !!row.outboundNo && String(m.docNo).trim() === String(row.outboundNo).trim());
        if (!hit) return row;
        ch = true;
        const base: any = { ...row, auxDocNo: row.auxDocNo === m.docNo ? '' : row.auxDocNo };
        if (String(row.reconResult || '') === '已发起对账') { base.reconResult = '待对账'; base.diffDesc = ''; base.purchaserReconPerson = ''; base.supplierReconPerson = ''; }
        base.billLog = appendBillLogEntry(row.billLog, '撤回对账', undefined, '采购商撤回对账，供应商账单状态已还原');
        return base;
      });
      if (ch) { try { localStorage.setItem(rk, JSON.stringify(nextRows)); } catch { /* ignore */ } }
    });
    const all: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    // 撤回即取消对账请求：无条件还原为未对账（不再仅限“已发起对账”），
    // 避免陈旧终态值残留后被 reload/同步重建读回“对账完成”
    localStorage.setItem(storageKey, JSON.stringify(all.map(b => b.key === r.key ? {
      ...b,
      reconcileResult: '',
      purchaserReconciler: '',
      diffNote: '',
      billLog: appendBillLogEntry(b.billLog, '撤回对账'),
    } : b)));
    reload();
    message.success('已撤回对账请求');
  };

  const columnMap: Record<string, any> = {
    outboundNo: { title: '出库单号', dataIndex: 'outboundNo', key: 'outboundNo', width: 150, align: 'center' as const, render: (t: string, r: BillRecord) => (<Space size={4}>{(r as any).docType === 'return' && <Tag color="red" style={{ marginRight: 0 }}>退货</Tag>}<Text strong>{t}</Text><Button type="link" size="small" style={{ padding: 0, height: 'auto' }} icon={<EyeOutlined />} onClick={() => openDetail(r)}>详</Button></Space>) },
    auxDocNo: { title: '辅助单据号', dataIndex: 'auxDocNo', key: 'auxDocNo', width: 140, align: 'center' as const, render: (t: string) => t || '-' },
    date: { title: '日期', dataIndex: 'date', key: 'date', width: 110, align: 'center' as const },
    styleCode: { title: '款式编号', key: 'styleCode', width: 140, align: 'center' as const, render: (_: any, r: BillRecord) => {
      // 按款式编码汇总数量：8002*数量（存量明细缺 styleCode 时回退商品编码前缀）
      const qtyMap = new Map<string, number>();
      r.items.forEach(i => { const sc = String(i.styleCode || '').trim() || String(i.productCode || '').split('-')[0]; if (!sc) return; qtyMap.set(sc, (qtyMap.get(sc) || 0) + (Number(i.quantity) || 0)); });
      const entries = Array.from(qtyMap.entries());
      if (entries.length === 0) return '-';
      // 最多显示一行：首个款式汇总，多个款式时后面显示“多”标记；点击打开款式数量明细
      return (
        <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}
          onClick={() => { setStyleQtyDetail({ bill: r, entries }); setStyleQtyDetailVisible(true); }}>
          <span style={{ fontSize: 12 }}>{entries[0][0]}*{entries[0][1]}</span>
          {entries.length > 1 && <span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '0 6px', borderRadius: 4, lineHeight: '18px', flexShrink: 0 }}>多</span>}
        </div>
      );
    } },
    productCode: { title: '商品编码', key: 'productCode', width: 160, align: 'center' as const, render: (_: any, r: BillRecord) => {
      const codes = r.items.map(i => i.productCode).filter(Boolean);
      if (codes.length === 0) return '-';
      // 最多显示一行：首个编码，多个编码时后面显示“多”标记；点击打开货品明细
      return (
        <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}
          onClick={() => { setBillItemDetail(r); setBillItemDetailVisible(true); }}>
          <Tag color="blue" style={{ margin: 0, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{codes[0]}</Tag>
          {codes.length > 1 && <span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '0 6px', borderRadius: 4, lineHeight: '18px', flexShrink: 0 }}>多</span>}
        </div>
      );
    } },
    qty: { title: '数量', dataIndex: 'totalQty', key: 'qty', width: 80, align: 'center' as const },
    amount: { title: '采购金额', dataIndex: 'totalAmount', key: 'amount', width: 100, align: 'center' as const, render: (v: any) => <Text style={{ color: '#f5222d' }}>¥{Number(v || 0).toFixed(2)}</Text> },
    supplier: { title: '供应商', dataIndex: 'supplier', key: 'supplier', width: 140, align: 'center' as const, render: (t: string) => t || '-' },
    reconcileResult: { title: '对账结果', dataIndex: 'reconcileResult', key: 'reconcileResult', width: 90, align: 'center' as const, render: (t: string, r: BillRecord) => { const val = t || (matchPurchaserRecon(reconRecords, r) ? '已发起对账' : ''); const displayVal = val === '已对账' ? '对账完成' : val; return val ? <Tag color={val === '已发起对账' ? 'blue' : val === '一致' || val === '已对账' || val === '对账完成' || val === '按供方入账' ? 'green' : val === '不相符' ? 'red' : 'orange'}>{displayVal}</Tag> : '-'; } },
    diffNote: { title: '差异说明', dataIndex: 'diffNote', key: 'diffNote', width: 120, align: 'center' as const, ellipsis: true, render: (t: string) => t || '-' },
    supplierReconciler: { title: '供应商对账人', dataIndex: 'supplierReconciler', key: 'supplierReconciler', width: 110, align: 'center' as const, render: (t: string) => t || '-' },
    purchaserReconciler: { title: '采购商对账人', dataIndex: 'purchaserReconciler', key: 'purchaserReconciler', width: 110, align: 'center' as const, render: (t: string) => t || '-' },
    supplierImages: { title: '供应商图片', dataIndex: 'supplierImages', key: 'supplierImages', width: 90, align: 'center' as const, render: (imgs: string[]) => imgs?.length ? <Image.PreviewGroup items={imgs}><Image src={imgs[0]} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /></Image.PreviewGroup> : '-' },
    purchaserImages: { title: '采购商图片', dataIndex: 'purchaserImages', key: 'purchaserImages', width: 90, align: 'center' as const, render: (imgs: string[]) => imgs?.length ? <Image.PreviewGroup items={imgs}><Image src={imgs[0]} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /></Image.PreviewGroup> : '-' },
    billSource: {
      title: '账单来源', dataIndex: 'billSource', key: 'billSource', width: 100, align: 'center' as const,
      render: (t: string, r: BillRecord) => {
        // 存量数据无来源字段：按出库单号前缀/推送标记回退判定（MC-PUSH- 或采购商推送订单生成 = 订单发货）
        const auto = String(r.outboundNo || (r as any).no || '').startsWith('MC-PUSH-') || (r as any).orderSource === '采购商推送' || !!(r as any).orderId;
        const src = t || (auto ? '订单发货' : '手工新增');
        if (src === '退货登记') return <Tag color="red">{src}</Tag>;
        return <Tag color={src === '订单发货' ? 'blue' : 'green'}>{src}</Tag>;
      },
    },
  };
  const actionColumn = { title: '操作', key: 'action', width: 210, fixed: 'right' as const, align: 'center' as const, render: (_: any, r: BillRecord) => {
    // 已对账/对账完成/按供方入账的账单锁定：隐藏编辑与删除，仅可查看
    const locked = RECON_DONE.includes(r.reconcileResult);
    // 采购商已发起对账（状态标记或存在采购商发起记录）
    const initiated = r.reconcileResult === '已发起对账' || matchPurchaserRecon(reconRecords, r);
    // 对账完成/供应商已发起/本方已发起：移除"发起对账"按键
    const hideInitiate = locked || initiated || matchSupplierRecon(reconRecords, r);
    // 账单来源为"订单发货"的不可删除（系统自动生成）
    const isAutoBill = r.billSource === '订单发货' || String(r.outboundNo || (r as any).no || '').startsWith('MC-PUSH-') || (r as any).orderSource === '采购商推送' || !!(r as any).orderId;
    return (
      <Space size={4} wrap style={{ justifyContent: 'center' }}>
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)}>查看</Button>
        {!hideInitiate && <Button type="link" size="small" icon={<SwapOutlined />} style={{ color: '#722ed1' }} onClick={() => initiateReconForBills([r])}>发起对账</Button>}
        {initiated && !locked && <Button type="link" size="small" icon={<UndoOutlined />} style={{ color: '#fa8c16' }} onClick={() => withdrawRecon(r)}>撤回对账</Button>}
        {!locked && !initiated && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>}
        {!locked && !initiated && !isAutoBill && <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => { declareShrink(storageKey, [r.key]); const all = bills.filter(b => b.key !== r.key); localStorage.setItem(storageKey, JSON.stringify(all));
                  // 闭环：删除账单同时墓碑化关联的存活对账记录（撤回语义），避免对方平台残留孤儿在途对账
                  try {
                    const uname0 = localStorage.getItem('username') || '';
                    const owner0 = localStorage.getItem('isSubAccount') === 'true' ? (localStorage.getItem('parentAccount') || uname0) : uname0;
                    const rl0 = loadRoleAll('purchaser', owner0);
                    const rm0 = rl0.map((x: any) => (!x.delisted && x.source === 'bill' && ((r.outboundNo && String(x.docNo || '').trim() === String(r.outboundNo).trim()) || x.orderNo === r.key || x.matchedBillKey === r.key)) ? { ...x, delisted: true, delistedAt: new Date().toISOString(), withdrawn: true } : x);
                    upsertRecords(rm0);
                  } catch { /* ignore */ }
                  // 桥时序：删除账单同时清理其可能残留的自动会计分录（防止孤儿凭证导致账实不平）
                  try { removeAutoEntries(getDataOwner(), `purchbill-recon-${r.key}`); } catch { /* ignore */ }
                  refreshSupplierPurchase(getDataOwner(), [r.supplier]); reload(); message.success('已删除'); }}>删除</Button>}
      </Space>
    );
  } };
  const columns: ColumnsType<BillRecord> = wrapColumns([
    ...billFieldOrder.filter(k => billFieldVisibility[k] && columnMap[k]).map(k => columnMap[k]),
    actionColumn,
  ] as any);

  return (
    <div>
      {/* 头部 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        {/* 搜索栏：按字段创建搜索框，点击查询后生效 */}
        <Row gutter={[8, 8]} style={{ padding: '16px 0 0' }} align="middle">
          <Col xs={12} sm={3}><Input size="small" allowClear placeholder="出库单号" value={pSearch.no} onChange={e => setPSearch(p => ({ ...p, no: e.target.value }))} /></Col>
          <Col xs={12} sm={3}><DatePicker size="small" style={{ width: '100%' }} allowClear placeholder="日期" value={pSearch.date ? dayjs(pSearch.date) : null} onChange={d => setPSearch(p => ({ ...p, date: d ? d.format('YYYY-MM-DD') : '' }))} /></Col>
          <Col xs={12} sm={3}><Input size="small" allowClear placeholder="款式编号" value={pSearch.style} onChange={e => setPSearch(p => ({ ...p, style: e.target.value }))} /></Col>
          <Col xs={12} sm={3}><Input size="small" allowClear placeholder="商品编码" value={pSearch.code} onChange={e => setPSearch(p => ({ ...p, code: e.target.value }))} /></Col>
          <Col xs={12} sm={3}>
            <Select size="small" style={{ width: '100%' }} allowClear showSearch placeholder="供应商"
              value={pSearch.supplier || undefined} options={supplierSearchOptions}
              onChange={v => setPSearch(p => ({ ...p, supplier: v || '' }))}
              filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
          </Col>
          <Col xs={8} sm={2}><Input size="small" allowClear placeholder="数量" value={pSearch.qty} onChange={e => setPSearch(p => ({ ...p, qty: e.target.value }))} /></Col>
          <Col xs={8} sm={2}><Input size="small" allowClear placeholder="采购金额" value={pSearch.amount} onChange={e => setPSearch(p => ({ ...p, amount: e.target.value }))} /></Col>
          <Col xs={8} sm={2}>
            <Select size="small" style={{ width: '100%' }} allowClear placeholder="对账结果"
              value={pSearch.recon || undefined}
              options={[{ value: '已对账', label: '对账完成' }, { value: '未对账', label: '未对账' }]}
              onChange={v => setPSearch(p => ({ ...p, recon: v || '' }))} />
          </Col>
          <Col xs={8} sm={3}>
            <Space size={4}>
              <Button size="small" type="primary" icon={<SearchOutlined />} onClick={() => { reloadAfterPull(reload); setPSearchApplied({ ...pSearch }); }}>查询</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { setPSearch({ ...emptyPSearch }); setPSearchApplied({ ...emptyPSearch }); }}>重置</Button>
            </Space>
          </Col>
        </Row>
        {/* 批量发起对账（靠左对齐）+ 新建单据/显示字段 */}
        <div style={{ padding: '10px 0 12px', display: 'flex', justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button type="primary" icon={<SwapOutlined />} style={{ color: '#fff' }} disabled={selectedRowKeys.length === 0}
            onClick={() => initiateReconForBills(bills.filter(b => selectedRowKeys.includes(b.key)))}>
            批量发起对账{selectedRowKeys.length > 0 ? ` (${selectedRowKeys.length})` : ''}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { resetCreate(); setCreateVisible(true); }}>新建单据</Button>
            <Button icon={<RollbackOutlined />} style={{ color: '#cf1322', borderColor: '#cf1322' }} onClick={() => setReturnVisible(true)}>退货登记</Button>
          <Button icon={<SettingOutlined />} onClick={() => setBillFieldConfigVisible(true)}>显示字段</Button>
          <Dropdown trigger={['click']} menu={{
            items: [
              { key: 'product', label: '按商品编码导出', icon: <FileExcelOutlined /> },
              { key: 'style', label: '按款式编码导出（汇总）', icon: <FileExcelOutlined /> },
            ],
            onClick: ({ key }) => handleBillExport(key as 'product' | 'style'),
          }}>
            <Button icon={<DownloadOutlined />}>导出</Button>
          </Dropdown>
          <Button icon={<SettingOutlined />} onClick={() => setBillExportFieldVisible(true)}>导出字段</Button>
          {acctMode && (
            <Button icon={<SettingOutlined />} onClick={() => { setAcctSubjectDraft(acctDebitSubject); setAcctSubjectOptions(loadSubjectOptions(getDataOwner())); setAcctSubjectModalVisible(true); }}>
              设置借方科目
            </Button>
          )}
          {acctMode && <Text style={{ fontSize: 12, color: '#8c8c8c' }}>当前借方科目：<Text strong style={{ color: PRIMARY }}>{acctDebitSubject}</Text></Text>}
        </div>
        {acctMode && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="会计账薄已开启：采购账单对账结果变更为“对账完成 / 按供方入账”时，自动在会计分录中生成两条对应分录"
            description={<>处理逻辑：对账结果变更为上述终态时，自动新增 2 条会计分录（借：<Text strong>{acctDebitSubject}</Text>，贷：<Text strong>应付账款</Text>），金额=采购金额，摘要写明供应商名称与出库单号；对账结果变更为其他状态（如未对账/已发起对账）时，自动删除该账单已生成的分录。借方科目可通过"设置借方科目"按键修改（默认原材料）。</>}
          />
        )}
        <Table bordered columns={columns} dataSource={filteredBills} rowKey="key" scroll={{ x: 1400 }} size="middle"
          rowSelection={{ selectedRowKeys, onChange: keys => setSelectedRowKeys(keys) }}
          pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }} locale={{ emptyText: '暂无采购账单，点击“新建单据”录入' }} />
      </Card>

      {/* 页面底部：账单来源与账单对账等功能说明 */}
      <div style={{ marginTop: 12, padding: '10px 14px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.9 }}>
        <div style={{ fontWeight: 600, color: '#1a2b45', marginBottom: 4 }}>账单来源与对账功能说明</div>
        <div>1、账单来源：<Tag color="green" style={{ marginRight: 4 }}>手工新增</Tag>本页「新建单据」手工录入的账单；<Tag color="blue" style={{ marginRight: 4 }}>订单发货</Tag>供应商在供应商平台发货时自动写入的账单（出库单号前缀 MC-PUSH-），与供应商发货订单联动生成。</div>
        <div>2、账单对账：勾选账单后点击「发起对账 / 批量发起对账」，账单发送至供应商平台对账管理，按出库单号自动匹配核对；发起后对账结果显示蓝色「已发起对账」标签，对账完成前可「撤回对账」；已对账完成/按供方入账或供应商已发起对账的账单不可重复发起。</div>
        <div>3、结果状态与联动：对账结果状态为 未对账、已发起对账、对账完成、按供方入账、不相符，可用搜索栏「对账结果」筛选；会计账薄开启时，对账结果变更为 对账完成/按供方入账 等终态自动生成 2 条会计分录，变更回其他状态时自动删除。</div>
        <div>4、退货登记：点击「退货登记」生成负数退货账单（账单来源=<Tag color="red" style={{ marginRight: 4 }}>退货登记</Tag>，单号 RT- 前缀），自动镜像同步至供应商平台账单明细；库存联动：本侧退货出库、供应商侧退货仓入库；退货账单与正常账单走相同对账流程，对账完成后会计分录按负数冲抵。</div>
      </div>

      {/* 新建单据弹窗 */}
      <Modal title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />新建采购账单</span>}
        open={createVisible} onCancel={() => setCreateVisible(false)} onOk={handleSave}
        okText="保存单据" cancelText="取消" width={860} destroyOnClose>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={7}>
            <Text style={{ fontSize: 12 }}>出库单号</Text>
            <AutoComplete
              value={outboundNo}
              onChange={v => handleOutboundChange(v)}
              placeholder="如 100-20260105126（点击可选供应商对账单）"
              onFocus={() => loadCreateReconOptions()}
              onDropdownVisibleChange={open => { if (open) loadCreateReconOptions(); }}
              options={createReconOptions}
              filterOption={(input, option) => String((option as any)?.value || '').toLowerCase().includes(input.trim().toLowerCase())}
              onSelect={(v: string) => {
                handleOutboundChange(v);
                const recs = loadCreateReconOptions();
                const rec = recs.find((r: any) => r.docNo === v);
                if (!rec) return;
                const rows: BillItem[] = (rec.details || []).map((d: any) => ({
                  styleCode: d.styleCode || String(d.itemNo || '').split('-')[0],
                  productCode: d.itemNo || '',
                  color: '', spec: '',
                  quantity: Number(d.ourQty) || 0,
                  unitPrice: Number(d.ourPrice) || 0,
                  amount: Math.round((Number(d.ourQty) || 0) * (Number(d.ourPrice) || 0) * 100) / 100,
                }));
                if (rows.length > 0) {
                  setItems(rows.length >= 5 ? rows : [...rows, ...emptyRows().slice(rows.length)]);
                  setCheckedRows(new Set(rows.map((_, i) => i)));
                }
                if (rec.supplierName) setSupplier(rec.supplierName);
                message.success(`已填充供应商对账单「${v}」的 ${rows.length} 条明细`);
              }}
              style={{ width: '100%' }}
            />
          </Col>
          <Col span={5}>
            <Text style={{ fontSize: 12 }}>单号前缀</Text>
            <Input value={prefix} readOnly style={{ background: '#fafafa' }} placeholder="自动识别" />
          </Col>
          <Col span={6}>
            <Text style={{ fontSize: 12 }}>供应商</Text>
            <Input value={supplier} readOnly placeholder="点击选择供应商" onClick={() => { setSupplierPickTarget('create'); setSupplierPickVisible(true); }}
              suffix={<TeamOutlined style={{ color: PRIMARY }} />} style={{ cursor: 'pointer' }} />
          </Col>
          <Col span={6}>
            <Text style={{ fontSize: 12 }}>日期</Text>
            <DatePicker value={billDate} onChange={d => setBillDate(d || dayjs())} style={{ width: '100%' }} />
          </Col>
        </Row>

        <div style={{ marginTop: 12 }}>
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false}
            dataSource={items}
            columns={[
              { title: <Checkbox checked={items.length > 0 && checkedRows.size === items.length} indeterminate={checkedRows.size > 0 && checkedRows.size < items.length} onChange={e => { if (e.target.checked) setCheckedRows(new Set(items.map((_, i) => i))); else setCheckedRows(new Set()); }} />, key: 'ck', width: 36, align: 'center' as const, render: (_: any, __: any, i: number) => <Checkbox checked={checkedRows.has(i)} onChange={e => { const s = new Set(checkedRows); if (e.target.checked) s.add(i); else s.delete(i); setCheckedRows(s); }} /> },
              billDisplay.showStyleCode && { title: '款式编号', key: 's', width: 110, render: (_: any, __: any, i: number) => <Input size="small" value={items[i].styleCode} onChange={e => updateItem(i, { styleCode: e.target.value })} /> },
              billDisplay.showProductCode && { title: '商品编码', key: 'p', width: 120, render: (_: any, __: any, i: number) => <Input size="small" value={items[i].productCode} onChange={e => updateItem(i, { productCode: e.target.value })} style={highlightCodes.has(items[i].productCode) ? { color: '#f5222d', fontWeight: 600 } : undefined} /> },
              billDisplay.showProductType && { title: '产品种类', key: 'pt', width: 80, render: (_: any, __: any, i: number) => <Input size="small" value={items[i].productType || ''} onChange={e => updateItem(i, { productType: e.target.value })} /> },
              billDisplay.showColor && { title: '颜色', key: 'c', width: 80, render: (_: any, __: any, i: number) => <Input size="small" value={items[i].color} onChange={e => updateItem(i, { color: e.target.value })} /> },
              billDisplay.showSpec && { title: '规格', key: 'sp', width: 90, render: (_: any, __: any, i: number) => <Input size="small" value={items[i].spec} onChange={e => updateItem(i, { spec: e.target.value })} /> },
              billDisplay.showQty && { title: '数量', key: 'q', width: 80, render: (_: any, __: any, i: number) => <InputNumber size="small" controls={false} min={0} value={items[i].quantity} onChange={v => updateItem(i, { quantity: Number(v) || 0 })} style={{ width: '100%' }} /> },
              billDisplay.showPrice && { title: '单价', key: 'u', width: 90, render: (_: any, __: any, i: number) => <InputNumber size="small" controls={false} min={0} precision={2} value={items[i].unitPrice} onChange={v => updateItem(i, { unitPrice: Number(v) || 0 })} style={{ width: '100%' }} /> },
              billDisplay.showAmount && { title: '金额', key: 'a', width: 90, render: (_: any, __: any, i: number) => <Text style={{ color: '#f5222d' }}>{Number(items[i].amount || 0).toFixed(2)}</Text> },
              { title: '', key: 'op', width: 40, render: (_: any, __: any, i: number) => <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => { setItems(prev => prev.length > 1 ? prev.filter((_, x) => x !== i) : prev); setCheckedRows(prev => { const s = new Set<number>(); prev.forEach(v => { if (v < i) s.add(v); else if (v > i) s.add(v - 1); }); return s; }); }} /> },
            ].filter(Boolean) as any}
          />
          {/* 批量填充 */}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: '#888' }}>勾选 {checkedRows.size} 行</Text>
            <Space size={4}>
              <Text style={{ fontSize: 12 }}>批量数量</Text>
              <InputNumber size="small" controls={false} min={0} placeholder="数量" value={batchQty ?? undefined} onChange={v => setBatchQty(v != null ? Number(v) : null)} style={{ width: 80 }} />
            </Space>
            <Space size={4}>
              <Text style={{ fontSize: 12 }}>批量单价</Text>
              <InputNumber size="small" controls={false} min={0} precision={2} placeholder="单价" value={batchPrice ?? undefined} onChange={v => setBatchPrice(v != null ? Number(v) : null)} style={{ width: 90 }} />
            </Space>
            <Button size="small" type="primary" disabled={checkedRows.size === 0 || (batchQty == null && batchPrice == null)} style={{ color: '#fff' }} onClick={() => {
              setItems(prev => prev.map((it, idx) => {
                if (!checkedRows.has(idx)) return it;
                const q = batchQty != null ? batchQty : it.quantity;
                const p = batchPrice != null ? batchPrice : it.unitPrice;
                return { ...it, quantity: q, unitPrice: p, amount: Math.round(q * p * 100) / 100 };
              }));
              setBatchQty(null); setBatchPrice(null);
              message.success(`已填充 ${checkedRows.size} 行`);
            }}>填充</Button>
          </div>
          <Space style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setItems(prev => [...prev, { styleCode: '', productCode: '', color: '', spec: '', quantity: 0, unitPrice: 0, amount: 0, productType: '' }])}>添加明细行</Button>
            <Button size="small" icon={<ShopOutlined />} onClick={() => { setAddProductTarget('create'); setAddProductTab('own'); setAddProductVisible(true); }}>添加商品</Button>
            <Button size="small" icon={<SwapOutlined />} onClick={() => {
              const merged = mergeDuplicateItems(items.filter(hasData));
              if (merged.length < items.filter(hasData).length) {
                setItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                setCheckedRows(new Set());
                message.success(`已汇总，合并重复商品编码，当前 ${merged.length} 行`);
              } else {
                message.info('没有重复的商品编码需要汇总');
              }
            }}>汇总</Button>
            <Button size="small" icon={<FileTextOutlined />} onClick={() => setQtyTemplateVisible(true)}>数量模版</Button>
            {renderInlineTemplates()}
            <a onClick={() => setBillDisplayVisible(true)} style={{ color: PRIMARY, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${PRIMARY}`, borderRadius: 3, padding: '0 3px', lineHeight: '18px', display: 'inline-flex', alignItems: 'center' }}>显</a>
          </Space>
        </div>

        {/* 图片上传 + 录入员 + 总数量 + 总金额 */}
        <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* 图片上传 - 左侧 */}
          <div
            onClick={() => openImageModal('create')}
            onPaste={(e) => { const cd = (e as any).clipboardData as DataTransfer | undefined; const arr = Array.from(cd?.items || []); for (const it of arr) if (it.type.startsWith('image/')) { const b = it.getAsFile(); if (b) { handleImageFile(b); break; } } }}
            tabIndex={0}
            style={{ width: 84, height: 84, minWidth: 84, border: '2px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', background: '#fafafa' }}>
            {billImage ? (
              <img src={billImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
                <PlusOutlined style={{ fontSize: 18, display: 'block', marginBottom: 2 }} />点击/粘贴
              </div>
            )}
          </div>
          {/* 录入员 */}
          <div><Text type="secondary">录入员：</Text><Text strong>{getRecorderName()}</Text></div>
          {/* 弹簧：将总数量/总金额推到右侧对齐表格列 */}
          <div style={{ flex: 1 }} />
          {/* 总数量 + 总金额 靠右对齐 */}
          <div style={{ display: 'flex', gap: 40, alignItems: 'center' }}>
            <div><Text type="secondary">总数量：</Text><Text strong style={{ color: PRIMARY }}>{totalQty}</Text></div>
            <div><Text type="secondary">总金额：</Text><Text strong style={{ color: '#f5222d' }}>¥{totalAmount.toFixed(2)}</Text></div>
          </div>
        </div>
      </Modal>

      {/* 供应商选择弹窗 */}
      <Modal title="选择供应商" open={supplierPickVisible} onCancel={() => setSupplierPickVisible(false)} footer={null} width={420}>
        {supplierOptions.length === 0 ? (
          <Empty description="暂无已合作供应商" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {supplierOptions.map(o => (
              <Button key={o.name} block onClick={() => { if (supplierPickTarget === 'create') setSupplier(o.name); else setESupplier(o.name); setSupplierPickVisible(false); }}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}>
                {o.name}{o.prefix ? <Tag color="green" style={{ marginLeft: 8 }}>{o.prefix}</Tag> : null}
              </Button>
            ))}
          </div>
        )}
      </Modal>

      {/* 图片上传弹窗（单张，参考批量修改图片组件 + 拍照） */}
      <Modal title={<span style={{ color: PRIMARY }}><PictureOutlined style={{ marginRight: 8 }} />图片上传</span>}
        open={imageUpVisible} onCancel={() => setImageUpVisible(false)} width={480} destroyOnClose
        footer={[
          <Button key="camera" icon={<CameraOutlined />} onClick={openCamera}>拍照</Button>,
          <Button key="cancel" onClick={() => setImageUpVisible(false)}>取消</Button>,
          <Button key="ok" type="primary" onClick={() => setImageUpVisible(false)}>完成</Button>,
        ]}>
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          {currentImage && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <div style={{ position: 'relative', width: 72, height: 72 }}>
                <img src={currentImage} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee', display: 'block' }} />
                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                  style={{ position: 'absolute', top: -10, right: -10, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.25)', width: 22, height: 22, padding: 0 }}
                  onClick={() => setCurrentImage('')} />
              </div>
            </div>
          )}
          <Upload.Dragger accept="image/*" maxCount={1} showUploadList={false}
            beforeUpload={(file) => { handleImageFile(file); return false; }}
            style={{ padding: '20px 0' }}>
            <p style={{ fontSize: 48, color: PRIMARY, marginBottom: 8 }}><CameraOutlined /></p>
            <p style={{ fontSize: 14, color: '#1a2b45' }}>点击或拖拽图片到此区域</p>
            <p style={{ fontSize: 12, color: '#999' }}>支持 JPG、PNG、GIF 格式，最大 2MB</p>
            <p style={{ fontSize: 12, color: PRIMARY, marginTop: 8 }}><CopyOutlined style={{ marginRight: 4 }} />也可以直接 Ctrl+V 粘贴剪贴板图片</p>
          </Upload.Dragger>
          <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>仅可上传一张图片，重复上传将覆盖。</div>
        </div>
      </Modal>

      {/* 摄像头拍照弹窗 */}
      <Modal title={<span style={{ color: PRIMARY }}><CameraOutlined style={{ marginRight: 8 }} />摄像头拍照</span>}
        open={cameraVisible} onCancel={closeCamera} width={480} destroyOnClose
        footer={[
          <Button key="cancel" onClick={closeCamera}>取消</Button>,
          <Button key="shot" type="primary" icon={<CameraOutlined />} onClick={capturePhoto}>拍照</Button>,
        ]}>
        <div style={{ textAlign: 'center' }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: 432, borderRadius: 8, background: '#000' }} />
        </div>
      </Modal>

      {/* 编辑采购账单弹窗 */}
      <Modal title={<span style={{ color: PRIMARY }}><EditOutlined style={{ marginRight: 8 }} />编辑采购账单</span>}
        open={editVisible} onCancel={() => setEditVisible(false)} onOk={handleEditSave}
        okText="保存修改" cancelText="取消" width={900} destroyOnClose>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={7}><Text style={{ fontSize: 12 }}>出库单号</Text><Input value={eOutboundNo} onChange={e => handleEditOutboundChange(e.target.value)} /></Col>
          <Col span={5}><Text style={{ fontSize: 12 }}>单号前缀</Text><Input value={ePrefix} readOnly style={{ background: '#fafafa' }} /></Col>
          <Col span={6}><Text style={{ fontSize: 12 }}>供应商</Text><Input value={eSupplier} readOnly onClick={() => { setSupplierPickTarget('edit'); setSupplierPickVisible(true); }} suffix={<TeamOutlined style={{ color: PRIMARY }} />} style={{ cursor: 'pointer' }} /></Col>
          <Col span={6}><Text style={{ fontSize: 12 }}>日期</Text><DatePicker value={eDate} onChange={d => setEDate(d || dayjs())} style={{ width: '100%' }} /></Col>
        </Row>

        <div style={{ marginTop: 12 }}>
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={eItems}
            columns={[
              { title: <Checkbox checked={eItems.length > 0 && eCheckedRows.size === eItems.length} indeterminate={eCheckedRows.size > 0 && eCheckedRows.size < eItems.length} onChange={e => { if (e.target.checked) setECheckedRows(new Set(eItems.map((_, i) => i))); else setECheckedRows(new Set()); }} />, key: 'ck', width: 36, align: 'center' as const, render: (_: any, __: any, i: number) => <Checkbox checked={eCheckedRows.has(i)} onChange={e => { const s = new Set(eCheckedRows); if (e.target.checked) s.add(i); else s.delete(i); setECheckedRows(s); }} /> },
              billDisplay.showStyleCode && { title: '款式编号', key: 's', width: 110, render: (_: any, __: any, i: number) => <Input size="small" value={eItems[i].styleCode} onChange={e => updateEditItem(i, { styleCode: e.target.value })} /> },
              billDisplay.showProductCode && { title: '商品编码', key: 'p', width: 120, render: (_: any, __: any, i: number) => <Input size="small" value={eItems[i].productCode} onChange={e => updateEditItem(i, { productCode: e.target.value })} style={highlightCodes.has(eItems[i].productCode) ? { color: '#f5222d', fontWeight: 600 } : undefined} /> },
              billDisplay.showProductType && { title: '产品种类', key: 'pt', width: 80, render: (_: any, __: any, i: number) => <Input size="small" value={eItems[i].productType || ''} onChange={e => updateEditItem(i, { productType: e.target.value })} /> },
              billDisplay.showColor && { title: '颜色', key: 'c', width: 80, render: (_: any, __: any, i: number) => <Input size="small" value={eItems[i].color} onChange={e => updateEditItem(i, { color: e.target.value })} /> },
              billDisplay.showSpec && { title: '规格', key: 'sp', width: 90, render: (_: any, __: any, i: number) => <Input size="small" value={eItems[i].spec} onChange={e => updateEditItem(i, { spec: e.target.value })} /> },
              billDisplay.showQty && { title: '数量', key: 'q', width: 80, render: (_: any, __: any, i: number) => <InputNumber size="small" controls={false} min={0} value={eItems[i].quantity} onChange={v => updateEditItem(i, { quantity: Number(v) || 0 })} style={{ width: '100%' }} /> },
              billDisplay.showPrice && { title: '单价', key: 'u', width: 90, render: (_: any, __: any, i: number) => <InputNumber size="small" controls={false} min={0} precision={2} value={eItems[i].unitPrice} onChange={v => updateEditItem(i, { unitPrice: Number(v) || 0 })} style={{ width: '100%' }} /> },
              billDisplay.showAmount && { title: '金额', key: 'a', width: 90, render: (_: any, __: any, i: number) => <Text style={{ color: '#f5222d' }}>{Number(eItems[i].amount || 0).toFixed(2)}</Text> },
              { title: '', key: 'op', width: 40, render: (_: any, __: any, i: number) => <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => { setEItems(prev => prev.length > 1 ? prev.filter((_, x) => x !== i) : prev); setECheckedRows(prev => { const s = new Set<number>(); prev.forEach(v => { if (v < i) s.add(v); else if (v > i) s.add(v - 1); }); return s; }); }} /> },
            ].filter(Boolean) as any} />
          {/* 批量填充 */}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: '#888' }}>勾选 {eCheckedRows.size} 行</Text>
            <Space size={4}>
              <Text style={{ fontSize: 12 }}>批量数量</Text>
              <InputNumber size="small" controls={false} min={0} placeholder="数量" value={eBatchQty ?? undefined} onChange={v => setEBatchQty(v != null ? Number(v) : null)} style={{ width: 80 }} />
            </Space>
            <Space size={4}>
              <Text style={{ fontSize: 12 }}>批量单价</Text>
              <InputNumber size="small" controls={false} min={0} precision={2} placeholder="单价" value={eBatchPrice ?? undefined} onChange={v => setEBatchPrice(v != null ? Number(v) : null)} style={{ width: 90 }} />
            </Space>
            <Button size="small" type="primary" disabled={eCheckedRows.size === 0 || (eBatchQty == null && eBatchPrice == null)} style={{ color: '#fff' }} onClick={() => {
              setEItems(prev => prev.map((it, idx) => {
                if (!eCheckedRows.has(idx)) return it;
                const q = eBatchQty != null ? eBatchQty : it.quantity;
                const p = eBatchPrice != null ? eBatchPrice : it.unitPrice;
                return { ...it, quantity: q, unitPrice: p, amount: Math.round(q * p * 100) / 100 };
              }));
              setEBatchQty(null); setEBatchPrice(null);
              message.success(`已填充 ${eCheckedRows.size} 行`);
            }}>填充</Button>
          </div>
          <Space style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setEItems(prev => [...prev, { styleCode: '', productCode: '', color: '', spec: '', quantity: 0, unitPrice: 0, amount: 0, productType: '' }])}>添加明细行</Button>
            <Button size="small" icon={<ShopOutlined />} onClick={() => { setAddProductTarget('edit'); setAddProductTab('own'); setAddProductVisible(true); }}>添加商品</Button>
            <Button size="small" icon={<SwapOutlined />} onClick={() => {
              const merged = mergeDuplicateItems(eItems.filter(hasData));
              if (merged.length < eItems.filter(hasData).length) {
                setEItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                setECheckedRows(new Set());
                message.success(`已汇总，合并重复商品编码，当前 ${merged.length} 行`);
              } else {
                message.info('没有重复的商品编码需要汇总');
              }
            }}>汇总</Button>
            <Button size="small" icon={<FileTextOutlined />} onClick={() => setQtyTemplateVisible(true)}>数量模版</Button>
            {renderInlineTemplates()}
          </Space>
        </div>
        {/* 图片上传 - 移到货品明细下方 */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
          <Button icon={<PictureOutlined />} onClick={() => openImageModal('edit')}>图片上传{editImage ? '（1）' : ''}</Button>
          {editImage && <img src={editImage} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }} />}
        </div>
        <Row gutter={16} style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <Col span={8}><Text type="secondary">录入员：</Text><Text strong>{(bills.find(b => b.key === editKey)?.recorder) || getRecorderName()}</Text></Col>
          <Col span={8}><Text type="secondary">总数量：</Text><Text strong style={{ color: PRIMARY }}>{eTotalQty}</Text></Col>
          <Col span={8}><Text type="secondary">总金额：</Text><Text strong style={{ color: '#f5222d' }}>¥{eTotalAmount.toFixed(2)}</Text></Col>
        </Row>
      </Modal>

      {/* 采购账单详情弹窗 */}
      <Modal title={<span style={{ color: PRIMARY }}><EyeOutlined style={{ marginRight: 8 }} />采购账单详情{detailBill ? ` - ${detailBill.outboundNo}` : ''}</span>}
        open={detailVisible} onCancel={() => setDetailVisible(false)} footer={[<Button key="close" onClick={() => setDetailVisible(false)}>关闭</Button>]} width={1000}>
        {detailBill && (
          <div>
            <Descriptions column={2} bordered size="small" style={{ marginBottom: 12 }}>
              <Descriptions.Item label="出库单号">{detailBill.outboundNo}</Descriptions.Item>
              <Descriptions.Item label="单号前缀">{detailBill.prefix || '-'}</Descriptions.Item>
              <Descriptions.Item label="供应商">{detailBill.supplier || '-'}</Descriptions.Item>
              <Descriptions.Item label="日期">{detailBill.date}</Descriptions.Item>
              <Descriptions.Item label="对账结果">{detailBill.reconcileResult || '-'}</Descriptions.Item>
              <Descriptions.Item label="差异说明">{detailBill.diffNote || '-'}</Descriptions.Item>
              <Descriptions.Item label="供应商对账人">{detailBill.supplierReconciler || '-'}</Descriptions.Item>
              <Descriptions.Item label="采购商对账人">{detailBill.purchaserReconciler || '-'}</Descriptions.Item>
              <Descriptions.Item label="录入员">{detailBill.recorder}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{detailBill.createdAt}</Descriptions.Item>
              <Descriptions.Item label="总数量">{detailBill.totalQty}</Descriptions.Item>
              <Descriptions.Item label="采购金额"><Text style={{ color: '#f5222d' }}>¥{Number(detailBill.totalAmount || 0).toFixed(2)}</Text></Descriptions.Item>
            </Descriptions>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <Radio.Group size="small" value={detailItemView} onChange={e => setDetailItemView(e.target.value)} optionType="button" buttonStyle="solid">
                <Radio.Button value="productCode">按商品编码</Radio.Button>
                <Radio.Button value="styleCode">按款式编码</Radio.Button>
              </Radio.Group>
            </div>
            {detailItemView === 'productCode' ? (
              <Table size="small" rowKey={(_, i) => String(i)} pagination={false} bordered dataSource={detailBill.items}
                columns={[
                  { title: <div style={{ textAlign: 'center' }}>款式编号</div>, dataIndex: 'styleCode', key: 's', align: 'center' as const },
                  { title: <div style={{ textAlign: 'center' }}>商品编码</div>, dataIndex: 'productCode', key: 'p', align: 'center' as const },
                  { title: <div style={{ textAlign: 'center' }}>产品种类</div>, dataIndex: 'productType', key: 'pt', align: 'center' as const, render: (v: string) => v ? <Tag color={v === '原材料' ? 'orange' : 'blue'}>{v}</Tag> : '-' },
                  { title: <div style={{ textAlign: 'center' }}>数量</div>, dataIndex: 'quantity', key: 'q', align: 'center' as const },
                  { title: <div style={{ textAlign: 'center' }}>单价</div>, dataIndex: 'unitPrice', key: 'u', align: 'center' as const },
                  { title: <div style={{ textAlign: 'center' }}>金额</div>, dataIndex: 'amount', key: 'a', align: 'center' as const, render: (v: any) => <Text style={{ color: '#f5222d' }}>{Number(v || 0).toFixed(2)}</Text> },
                ] as any} />
            ) : (() => {
              // 按款式编码汇总：数量/金额求和，单价=金额/数量（平均价），并列出该款式包含的商品编码
              const styleOf = (it: any) => String(it?.styleCode || String(it?.productCode || '').split('-')[0] || '未知款式');
              const grouped = new Map<string, { styleCode: string; quantity: number; amount: number; codes: string[] }>();
              (detailBill.items || []).forEach((it: any) => {
                const sc = styleOf(it);
                const qty = Number(it.quantity) || 0;
                const amt = Number(it.amount) || Math.round(qty * (Number(it.unitPrice) || 0) * 100) / 100;
                const cur = grouped.get(sc);
                if (cur) {
                  cur.quantity += qty;
                  cur.amount += amt;
                  if (it.productCode && !cur.codes.includes(String(it.productCode))) cur.codes.push(String(it.productCode));
                } else {
                  grouped.set(sc, { styleCode: sc, quantity: qty, amount: amt, codes: it.productCode ? [String(it.productCode)] : [] });
                }
              });
              const styleRows = Array.from(grouped.values()).map((g, i) => ({
                ...g,
                key: `style-${i}`,
                price: g.quantity > 0 ? Math.round((g.amount / g.quantity) * 100) / 100 : 0,
              }));
              return (
                <Table size="small" rowKey="key" pagination={false} bordered dataSource={styleRows}
                  columns={[
                    { title: <div style={{ textAlign: 'center' }}>款式编码</div>, dataIndex: 'styleCode', key: 'sc', align: 'center' as const },
                    { title: <div style={{ textAlign: 'center' }}>包含商品</div>, dataIndex: 'codes', key: 'codes', align: 'center' as const, render: (codes: string[]) => (
                      <Tooltip title={codes.join('、')}><Text style={{ fontSize: 12 }}>{codes.length > 2 ? `${codes.slice(0, 2).join('、')}等${codes.length}项` : codes.join('、')}</Text></Tooltip>
                    ) },
                    { title: <div style={{ textAlign: 'center' }}>数量</div>, dataIndex: 'quantity', key: 'q', align: 'center' as const },
                    { title: <div style={{ textAlign: 'center' }}>单价</div>, dataIndex: 'price', key: 'u', align: 'center' as const, render: (v: number) => Number(v || 0).toFixed(2) },
                    { title: <div style={{ textAlign: 'center' }}>金额</div>, dataIndex: 'amount', key: 'a', align: 'center' as const, render: (v: number) => <Text style={{ color: '#f5222d' }}>{Number(v || 0).toFixed(2)}</Text> },
                  ] as any} />
              );
            })()}
            {/* 对账明细对比：当账单已关联对账记录时显示本方/对方商品数量、单价、金额对比 */}
            {(() => {
              const recon = reconRecords.find((r: any) =>
                (r.matchedBillKey && r.matchedBillKey === detailBill.key) ||
                (r.orderNo && r.orderNo === detailBill.key) ||
                (detailBill.outboundNo && String(r.docNo || '').trim() === String(detailBill.outboundNo).trim())
              );
              if (!recon || !Array.isArray(recon.details) || recon.details.length === 0) return null;
              return (
                <div style={{ marginTop: 16 }}>
                  <Text strong style={{ color: PRIMARY, fontSize: 14, marginBottom: 8, display: 'block' }}>对账明细对比</Text>
                  <Table size="small" rowKey={(_, i) => `recon-${i}`} pagination={false} bordered
                    dataSource={recon.details}
                    columns={[
                      { title: <div style={{ textAlign: 'center' }}>商品编码</div>, dataIndex: 'itemNo', key: 'code', align: 'center' as const, width: 120 },
                      { title: <div style={{ textAlign: 'center' }}>款式编码</div>, dataIndex: 'styleCode', key: 'style', align: 'center' as const, width: 80 },
                      { title: <div style={{ textAlign: 'center' }}>本方数量</div>, dataIndex: 'ourQty', key: 'oq', align: 'center' as const, width: 80, render: (v: number, row: any) => <Text style={{ color: v === row.theirQty ? undefined : '#f5222d' }}>{v}</Text> },
                      { title: <div style={{ textAlign: 'center' }}>对方数量</div>, dataIndex: 'theirQty', key: 'tq', align: 'center' as const, width: 80, render: (v: number, row: any) => <Text style={{ color: v === row.ourQty ? undefined : '#f5222d' }}>{v}</Text> },
                      { title: <div style={{ textAlign: 'center' }}>本方单价</div>, dataIndex: 'ourPrice', key: 'op', align: 'center' as const, width: 80, render: (v: number, row: any) => <Text style={{ color: v === row.theirPrice ? undefined : '#f5222d' }}>{Number(v || 0).toFixed(2)}</Text> },
                      { title: <div style={{ textAlign: 'center' }}>对方单价</div>, dataIndex: 'theirPrice', key: 'tp', align: 'center' as const, width: 80, render: (v: number, row: any) => <Text style={{ color: v === row.ourPrice ? undefined : '#f5222d' }}>{Number(v || 0).toFixed(2)}</Text> },
                      { title: <div style={{ textAlign: 'center' }}>本方金额</div>, dataIndex: 'ourSubTotal', key: 'os', align: 'center' as const, width: 90, render: (v: number) => <Text style={{ color: '#f5222d' }}>{Number(v || 0).toFixed(2)}</Text> },
                      { title: <div style={{ textAlign: 'center' }}>对方金额</div>, dataIndex: 'theirSubTotal', key: 'ts', align: 'center' as const, width: 90, render: (v: number) => <Text style={{ color: '#f5222d' }}>{Number(v || 0).toFixed(2)}</Text> },
                      { title: <div style={{ textAlign: 'center' }}>核对结果</div>, key: 'match', align: 'center' as const, width: 80, render: (_: any, row: any) => row.match ? <Tag color="green">一致</Tag> : <Tag color="red">不一致</Tag> },
                    ] as any} />
                </div>
              );
            })()}
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col span={24}>
                <Text type="secondary">采购商图片（仅自己可见）：</Text>
                {detailBill.purchaserImages?.length ? (
                  <Image.PreviewGroup items={detailBill.purchaserImages}>
                    {detailBill.purchaserImages.map((s, i) => <Image key={i} src={s} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4, marginRight: 4 }} />)}
                  </Image.PreviewGroup>
                ) : '-'}
              </Col>
            </Row>
            {/* 账单日志 */}
            {(() => {
              const logs = readBillLog(detailBill);
              if (logs.length === 0) return null;
              return (
                <Card size="small" style={{ marginTop: 16 }} title={<Space><ClockCircleOutlined /><span>账单日志</span></Space>}>
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {logs.map((log, i) => (
                      <div key={i} style={{ padding: '6px 8px', background: i % 2 === 0 ? '#fafafa' : '#fff', border: '1px solid #f0f0f0', borderRadius: 4, fontSize: 12, marginBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: billLogColor(log.action), fontWeight: 600 }}>{log.action}</Text>
                          <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{resolveOperatorName(log.operator)}</Text>
                        </div>
                        {log.detail && <div style={{ color: '#595959', marginTop: 2, whiteSpace: 'pre-wrap' }}>{log.detail}</div>}
                        <div style={{ color: '#bfbfbf', fontSize: 11, marginTop: 2 }}>{log.time}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* 采购明细显示控制弹窗 */}
      <Modal title="采购明细显示控制" open={billDisplayVisible}
        onOk={() => { setBillDisplayVisible(false); localStorage.setItem(`billItemDisplay_${username}`, JSON.stringify(billDisplay)); }}
        onCancel={() => setBillDisplayVisible(false)}
        okText="确定" cancelText="取消" width={320}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { key: 'showStyleCode', label: '款式编号' },
            { key: 'showProductCode', label: '商品编码' },
            { key: 'showProductType', label: '产品种类' },
            { key: 'showColor', label: '颜色' },
            { key: 'showSpec', label: '规格' },
            { key: 'showQty', label: '数量' },
            { key: 'showPrice', label: '单价' },
            { key: 'showAmount', label: '金额' },
          ].map(item => (
            <Checkbox key={item.key} checked={(billDisplay as any)[item.key]}
              onChange={e => setBillDisplay((prev: any) => ({ ...prev, [item.key]: e.target.checked }))}>
              {item.label}
            </Checkbox>
          ))}
        </div>
      </Modal>

      {/* 添加商品弹窗（默认自己的成品，可切换供应商货品） */}
      <Modal title={<span style={{ color: PRIMARY }}><ShopOutlined style={{ marginRight: 8 }} />添加商品</span>}
        open={addProductVisible} onCancel={() => { setAddProductVisible(false); setAddCheckedKeys(new Set()); setAddQtyMap({}); handleSpReset(); }} footer={null} width={960} destroyOnClose>
        {/* 标签切换：我的成品 / 供应商货品 / 数量模版 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #f0f0f0', paddingBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button type={addProductTab === 'own' ? 'primary' : 'default'} ghost={addProductTab === 'own'} onClick={() => { setAddProductTab('own'); setAddCheckedKeys(new Set()); setAddQtyMap({}); }}>
            我的成品
          </Button>
          <Button type={addProductTab === 'raw' ? 'primary' : 'default'} ghost={addProductTab === 'raw'} onClick={() => { setAddProductTab('raw'); setAddCheckedKeys(new Set()); setAddQtyMap({}); }}>
            原材料
          </Button>
          <Button type={addProductTab === 'supplier' ? 'primary' : 'default'} ghost={addProductTab === 'supplier'}
            disabled={!(addProductTarget === 'create' ? supplier : eSupplier)}
            onClick={() => { setAddProductTab('supplier'); setAddCheckedKeys(new Set()); setAddQtyMap({}); handleSpReset(); }}>
            供应商货品{!(addProductTarget === 'create' ? supplier : eSupplier) ? '（请先选择供应商）' : ''}
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => setQtyTemplateVisible(true)}>数量模版</Button>
          {renderInlineTemplates()}
          {addProductTab === 'supplier' && (addProductTarget === 'create' ? supplier : eSupplier) && (
            <Button icon={<EyeOutlined />} onClick={() => {
              const cs = addProductTarget === 'create' ? supplier : eSupplier;
              const productOwner = resolveSupplierUsername(cs) || getDataOwner();
              setSpDetailSupplier(cs);
              setSpDetailData([]);
              setSpDetailVisible(true);
              handleSpdReset();
              // 跨浏览器取数：本地优先，缺失时服务端数据集兜底
              void loadSupplierFinishedProducts(productOwner).then(list => setSpDetailData(list));
            }}>查看供应商全部货品</Button>
          )}
          {addCheckedKeys.size > 0 && (
            <Button type="primary" onClick={() => {
              const currentList = addProductTab === 'own' ? ownProducts : (addProductTab === 'raw' ? rawProducts : (addProductTab === 'supplier' ? spFilteredData : supplierProducts));
              const newItems: BillItem[] = [];
              addCheckedKeys.forEach(k => {
                const prod = currentList.find((p: any) => p.key === k);
                if (!prod) return;
                const qty = Number(addQtyMap[k]) || 1;
                const price = (addProductTab === 'own' || addProductTab === 'raw')
                  ? (Number(prod.costPrice) || Number(prod.basePrice) || 0)
                  : (Number(prod.suggestedPrice) || Number(prod.basePrice) || 0);
                const pType = addProductTab === 'own' ? '成品' : addProductTab === 'raw' ? '原材料' : (prod.productType || '成品');
                const item: BillItem = { styleCode: prod.styleCode || '', productCode: prod.productCode || '', color: prod.color || '', spec: prod.spec || '', quantity: qty, unitPrice: price, amount: 0, productType: pType };
                item.amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
                newItems.push(item);
              });
              if (newItems.length === 0) return;
              const currentItems = (addProductTarget === 'create' ? items : eItems).filter(hasData);
              const { merged, dupCodes } = mergeWithDuplicateInfo([...currentItems, ...newItems]);
              if (addProductTarget === 'create') setItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
              else setEItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
              if (dupCodes.length > 0) {
                Modal.warning({
                  title: '已存在相同商品编码，已汇总显示',
                  centered: true,
                  width: 420,
                  content: (
                    <div style={{ minHeight: 80, paddingTop: 8 }}>
                      <div style={{ marginBottom: 8, color: '#888' }}>以下商品编码已自动合并数量：</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {dupCodes.map(c => <Tag key={c} color="red">{c}</Tag>)}
                      </div>
                    </div>
                  ),
                  okText: '知道了',
                });
                flashHighlight(dupCodes);
              } else {
                message.success(`已添加 ${newItems.length} 件商品`);
              }
              setAddCheckedKeys(new Set()); setAddQtyMap({});
              setAddProductVisible(false);
            }}>批量添加选中 ({addCheckedKeys.size})</Button>
          )}
        </div>

        {/* 我的成品标签页 */}
        {addProductTab === 'own' && (() => {
          if (ownProducts.length === 0) return <Empty description='暂无成品数据' />;
          return (
            <Table size="small" rowKey="key" pagination={{ pageSize: 8, showTotal: (t: number) => `共 ${t} 件商品` }}
              dataSource={ownProducts}
              rowSelection={{
                selectedRowKeys: Array.from(addCheckedKeys),
                onChange: (keys) => setAddCheckedKeys(new Set(keys as string[])),
              }}
              columns={[
                { title: '数量', key: 'qty', width: 80, render: (_: any, r: any) => (
                  <InputNumber size="small" controls={false} min={0} style={{ width: '100%' }}
                    disabled={!addCheckedKeys.has(r.key)}
                    value={addQtyMap[r.key] ?? (addCheckedKeys.has(r.key) ? 1 : '')}
                    onChange={v => setAddQtyMap(prev => ({ ...prev, [r.key]: Number(v) || 0 }))} />
                )},
                { title: '商品编码', dataIndex: 'productCode', key: 'pc', width: 110 },
                { title: '商品名称', dataIndex: 'name', key: 'name', width: 120, render: (v: string) => <Text strong>{v}</Text> },
                { title: '款式编码', dataIndex: 'styleCode', key: 'sc', width: 90 },
                { title: '颜色', dataIndex: 'color', key: 'color', width: 60 },
                { title: '规格', dataIndex: 'spec', key: 'spec', width: 70 },
                { title: '成本价', dataIndex: 'costPrice', key: 'costPrice', width: 80, render: (v: number) => <Text style={{ color: '#f5222d' }}>¥{Number(v || 0).toFixed(2)}</Text> },
                { title: '操作', key: 'op', width: 70, render: (_: any, r: any) => (
                  <Button type="primary" size="small" onClick={() => {
                    const qty = Number(addQtyMap[r.key]) || 1;
                    const newItem: BillItem = { styleCode: r.styleCode || '', productCode: r.productCode || '', color: r.color || '', spec: r.spec || '', quantity: qty, unitPrice: Number(r.costPrice) || Number(r.basePrice) || 0, amount: 0, productType: '成品' };
                    newItem.amount = Math.round(newItem.quantity * newItem.unitPrice * 100) / 100;
                    const currentItems = (addProductTarget === 'create' ? items : eItems).filter(hasData);
                    const { merged, dupCodes } = mergeWithDuplicateInfo([...currentItems, newItem]);
                    if (addProductTarget === 'create') setItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                    else setEItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                    setAddProductVisible(false);
                    if (dupCodes.length > 0) {
                      Modal.warning({
                        title: '已存在相同商品编码，已汇总显示',
                        centered: true,
                        width: 420,
                        content: (
                          <div style={{ minHeight: 80, paddingTop: 8 }}>
                            <div style={{ marginBottom: 8, color: '#888' }}>以下商品编码已自动合并数量：</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {dupCodes.map(c => <Tag key={c} color="red">{c}</Tag>)}
                            </div>
                          </div>
                        ),
                        okText: '知道了',
                      });
                      flashHighlight(dupCodes);
                    } else { message.success(`已添加 ${r.name || r.productCode}`); }
                  }}>添加</Button>
                ) },
              ] as any} />
          );
        })()}

        {/* 原材料标签页 */}
        {addProductTab === 'raw' && (() => {
          if (rawProducts.length === 0) return <Empty description='暂无原材料数据' />;
          return (
            <Table size="small" rowKey="key" pagination={{ pageSize: 8, showTotal: (t: number) => `共 ${t} 件商品` }}
              dataSource={rawProducts}
              rowSelection={{
                selectedRowKeys: Array.from(addCheckedKeys),
                onChange: (keys) => setAddCheckedKeys(new Set(keys as string[])),
              }}
              columns={[
                { title: '数量', key: 'qty', width: 80, render: (_: any, r: any) => (
                  <InputNumber size="small" controls={false} min={0} style={{ width: '100%' }}
                    disabled={!addCheckedKeys.has(r.key)}
                    value={addQtyMap[r.key] ?? (addCheckedKeys.has(r.key) ? 1 : '')}
                    onChange={v => setAddQtyMap(prev => ({ ...prev, [r.key]: Number(v) || 0 }))} />
                )},
                { title: '商品编码', dataIndex: 'productCode', key: 'pc', width: 110 },
                { title: '商品名称', dataIndex: 'name', key: 'name', width: 120, render: (v: string) => <Text strong>{v}</Text> },
                { title: '款式编码', dataIndex: 'styleCode', key: 'sc', width: 90 },
                { title: '颜色', dataIndex: 'color', key: 'color', width: 60 },
                { title: '规格', dataIndex: 'spec', key: 'spec', width: 70 },
                { title: '成本价', dataIndex: 'costPrice', key: 'costPrice', width: 80, render: (v: number) => <Text style={{ color: '#f5222d' }}>¥{Number(v || 0).toFixed(2)}</Text> },
                { title: '操作', key: 'op', width: 70, render: (_: any, r: any) => (
                  <Button type="primary" size="small" onClick={() => {
                    const qty = Number(addQtyMap[r.key]) || 1;
                    const newItem: BillItem = { styleCode: r.styleCode || '', productCode: r.productCode || '', color: r.color || '', spec: r.spec || '', quantity: qty, unitPrice: Number(r.costPrice) || Number(r.basePrice) || 0, amount: 0, productType: '原材料' };
                    newItem.amount = Math.round(newItem.quantity * newItem.unitPrice * 100) / 100;
                    const currentItems = (addProductTarget === 'create' ? items : eItems).filter(hasData);
                    const { merged, dupCodes } = mergeWithDuplicateInfo([...currentItems, newItem]);
                    if (addProductTarget === 'create') setItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                    else setEItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                    setAddProductVisible(false);
                    if (dupCodes.length > 0) {
                      Modal.warning({
                        title: '已存在相同商品编码，已汇总显示',
                        centered: true,
                        width: 420,
                        content: (
                          <div style={{ minHeight: 80, paddingTop: 8 }}>
                            <div style={{ marginBottom: 8, color: '#888' }}>以下商品编码已自动合并数量：</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {dupCodes.map(c => <Tag key={c} color="red">{c}</Tag>)}
                            </div>
                          </div>
                        ),
                        okText: '知道了',
                      });
                      flashHighlight(dupCodes);
                    } else { message.success(`已添加 ${r.name || r.productCode}`); }
                  }}>添加</Button>
                ) },
              ] as any} />
          );
        })()}

        {/* 供应商货品标签页：搜索栏 + 表格 */}
        {addProductTab === 'supplier' && (() => {
          const cs = addProductTarget === 'create' ? supplier : eSupplier;
          if (!cs) return <Empty description='请先选择供应商' />;
          if (supplierProducts.length === 0) return <Empty description='该供应商暂无成品数据' />;
          return (
            <>
              {/* 搜索栏 */}
              <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                <Row gutter={[10, 8]} align="middle">
                  <Col xs={12} sm={5}>
                    <Input placeholder="商品编码" value={spInputCode} onChange={e => setSpInputCode(e.target.value)} onPressEnter={handleSpSearch} allowClear size="small" />
                  </Col>
                  <Col xs={12} sm={5}>
                    <Input placeholder="款式编码" value={spInputStyleCode} onChange={e => setSpInputStyleCode(e.target.value)} onPressEnter={handleSpSearch} allowClear size="small" />
                  </Col>
                  <Col xs={12} sm={4}>
                    <Input placeholder="品牌" value={spInputBrand} onChange={e => setSpInputBrand(e.target.value)} onPressEnter={handleSpSearch} allowClear size="small" />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Space size={2} style={{ flexWrap: 'nowrap' }}>
                      <span style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>基础售价</span>
                      <Input placeholder="最低" value={spInputPriceMin} onChange={e => setSpInputPriceMin(e.target.value)} onPressEnter={handleSpSearch} allowClear size="small" style={{ width: 72 }} />
                      <span style={{ color: '#999' }}>~</span>
                      <Input placeholder="最高" value={spInputPriceMax} onChange={e => setSpInputPriceMax(e.target.value)} onPressEnter={handleSpSearch} allowClear size="small" style={{ width: 72 }} />
                    </Space>
                  </Col>
                  <Col xs={12} sm={4}>
                    <Select placeholder="商品状态" value={spInputStatus || undefined} onChange={v => setSpInputStatus(v || '')} allowClear size="small" style={{ width: '100%' }}>
                      <Select.Option value="在售">在售</Select.Option>
                      <Select.Option value="开发">开发</Select.Option>
                      <Select.Option value="预售">预售</Select.Option>
                      <Select.Option value="停产">停产</Select.Option>
                      <Select.Option value="下架">下架</Select.Option>
                    </Select>
                  </Col>
                  <Col xs={12} sm={4}>
                    <Space>
                      <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handleSpSearch}>查询</Button>
                      <Button size="small" icon={<ReloadOutlined />} onClick={handleSpReset}>重置</Button>
                    </Space>
                  </Col>
                </Row>
              </div>
              <Table size="small" rowKey="key"
                dataSource={spFilteredData}
                pagination={{
                  current: spPage, pageSize: spPageSize, total: spFilteredData.length,
                  showSizeChanger: true, showQuickJumper: true, pageSizeOptions: ['10', '20', '50', '100'],
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                  onChange: (page, pageSize) => { setSpPage(page); setSpPageSize(pageSize); },
                }}
                rowSelection={{
                  selectedRowKeys: Array.from(addCheckedKeys),
                  onChange: (keys) => setAddCheckedKeys(new Set(keys as string[])),
                }}
                locale={{ emptyText: '暂无匹配的成品' }}
                columns={[
                  { title: '数量', key: 'qty', width: 80, render: (_: any, r: any) => (
                    <InputNumber size="small" controls={false} min={0} style={{ width: '100%' }}
                      disabled={!addCheckedKeys.has(r.key)}
                      value={addQtyMap[r.key] ?? (addCheckedKeys.has(r.key) ? 1 : '')}
                      onChange={v => setAddQtyMap(prev => ({ ...prev, [r.key]: Number(v) || 0 }))} />
                  )},
                  { title: '商品编码', dataIndex: 'productCode', key: 'pc', width: 110, render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
                  { title: '款式编码', dataIndex: 'styleCode', key: 'sc', width: 90 },
                  { title: '商品简称', dataIndex: 'shortName', key: 'shortName', width: 100, render: (v: string) => v || '-' },
                  { title: '颜色', dataIndex: 'color', key: 'color', width: 60, render: (v: string) => v || '-' },
                  { title: '规格', dataIndex: 'spec', key: 'spec', width: 70, render: (v: string) => v || '-' },
                  { title: '品牌', dataIndex: 'brand', key: 'brand', width: 70, render: (v: string) => v || '-' },
                  { title: '基础售价', dataIndex: 'suggestedPrice', key: 'price', width: 90, align: 'right' as const,
                    render: (v: any) => { const n = Number(v); return n > 0 ? <Text strong style={{ color: '#52c41a' }}>¥{n.toFixed(2)}</Text> : '-'; } },
                  { title: '商品状态', dataIndex: 'productStatus', key: 'productStatus', width: 80,
                    render: (v: string) => {
                      const map: Record<string, { color: string; text: string }> = { '在售': { color: 'success', text: '在售' }, '开发': { color: 'cyan', text: '开发' }, '预售': { color: 'processing', text: '预售' }, '停产': { color: 'error', text: '停产' }, '下架': { color: 'default', text: '下架' } };
                      const c = map[v] || { color: 'default', text: v || '-' };
                      return <Tag color={c.color}>{c.text}</Tag>;
                    } },
                  { title: '操作', key: 'op', width: 70, render: (_: any, r: any) => (
                    <Button type="primary" size="small" onClick={() => {
                      const qty = Number(addQtyMap[r.key]) || 1;
                      const price = Number(r.suggestedPrice) || 0;
                      const newItem: BillItem = { styleCode: r.styleCode || '', productCode: r.productCode || '', color: r.color || '', spec: r.spec || '', quantity: qty, unitPrice: price, amount: 0 };
                      newItem.amount = Math.round(newItem.quantity * newItem.unitPrice * 100) / 100;
                      const currentItems = (addProductTarget === 'create' ? items : eItems).filter(hasData);
                      const { merged, dupCodes } = mergeWithDuplicateInfo([...currentItems, newItem]);
                      if (addProductTarget === 'create') setItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                      else setEItems([...merged, ...emptyRows().slice(0, Math.max(0, 5 - merged.length))]);
                      setAddProductVisible(false);
                      if (dupCodes.length > 0) {
                        Modal.warning({
                          title: '已存在相同商品编码，已汇总显示',
                          centered: true,
                          width: 420,
                          content: (
                            <div style={{ minHeight: 80, paddingTop: 8 }}>
                              <div style={{ marginBottom: 8, color: '#888' }}>以下商品编码已自动合并数量：</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {dupCodes.map(c => <Tag key={c} color="red">{c}</Tag>)}
                              </div>
                            </div>
                          ),
                          okText: '知道了',
                        });
                        flashHighlight(dupCodes);
                      } else { message.success(`已添加 ${r.productCode || r.styleCode}`); }
                    }}>添加</Button>
                  ) },
                ] as any} />
            </>
          );
        })()}
      </Modal>

      {/* 数量模版弹窗 */}
      <Modal title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />数量模版</span>}
        open={qtyTemplateVisible} onCancel={() => setQtyTemplateVisible(false)} footer={null} width={520} zIndex={1100}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>设置规格对应的数量模版，在添加商品时可快速填充</div>
        {/* 已保存的模版列表 */}
        {qtyTemplates.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 13 }}>已保存模版：</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {qtyTemplates.map((t, i) => (
                <Tag key={i} closable color="blue"
                  onClose={(e: any) => { e.preventDefault(); removeQtyTemplate(i); }}
                  onClick={() => { openQtyFill(t); setQtyTemplateVisible(false); }}
                  style={{ cursor: 'pointer', padding: '2px 8px' }}>{t.name}</Tag>
              ))}
            </div>
          </div>
        )}
        {/* 新建模版 */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>新建模版：</Text>
            <Input size="small" placeholder="模版名称" value={qtyTemplateName} onChange={e => setQtyTemplateName(e.target.value)} style={{ width: 160 }} />
          </Space>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {qtyTemplateRows.map((row, i) => (
              <Space key={i} size={4}>
                <Input size="small" placeholder="规格" value={row.spec} onChange={e => { const arr = [...qtyTemplateRows]; arr[i] = { ...arr[i], spec: e.target.value }; setQtyTemplateRows(arr); }} style={{ width: 120 }} />
                <InputNumber size="small" controls={false} min={0} placeholder="数量" value={row.qty || undefined} onChange={v => { const arr = [...qtyTemplateRows]; arr[i] = { ...arr[i], qty: Number(v) || 0 }; setQtyTemplateRows(arr); }} style={{ width: 100 }} />
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setQtyTemplateRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)} />
              </Space>
            ))}
          </div>
          <Space style={{ marginTop: 8 }}>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setQtyTemplateRows(prev => [...prev, { spec: '', qty: 0 }])}>添加行</Button>
            <Button size="small" type="primary" disabled={!qtyTemplateName.trim() || qtyTemplateRows.some(r => !r.spec.trim())}
              onClick={() => {
                const newT = { name: qtyTemplateName.trim(), rows: qtyTemplateRows.filter(r => r.spec.trim()) };
                const arr = [...qtyTemplates, newT];
                setQtyTemplates(arr);
                localStorage.setItem(`billQtyTemplates_${username}`, JSON.stringify(arr));
                setQtyTemplateName(''); setQtyTemplateRows([{ spec: '', qty: 0 }]);
                message.success(`模版「${newT.name}」已保存`);
              }}>保存模版</Button>
          </Space>
        </div>
      </Modal>

      {/* 数量模版填充确认弹窗 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />填充确认</span>}
        open={qtyFillVisible}
        onCancel={() => setQtyFillVisible(false)}
        onOk={confirmQtyFill}
        okText="确认填充"
        cancelText="取消"
        width={420}
        centered
        zIndex={1200}
      >
        {qtyFillTemplate && (
          <div style={{ padding: '8px 0', minHeight: 120 }}>
            <div style={{ marginBottom: 12, fontSize: 14 }}>模版：<Text strong>{qtyFillTemplate.name}</Text></div>
            <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '12px 16px', marginBottom: 16 }}>
              {qtyFillTemplate.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 13 }}>
                  <span>规格 {r.spec}</span>
                  <span>{r.qty} × <Text strong style={{ color: PRIMARY }}>{qtyFillMultiplier}</Text> = <Text strong style={{ color: '#f5222d' }}>{r.qty * (qtyFillMultiplier || 1)}</Text></span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text>填充倍数：</Text>
              <InputNumber size="small" min={1} precision={0} value={qtyFillMultiplier} onChange={v => setQtyFillMultiplier(Number(v) || 1)} style={{ width: 100 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>（实际数量 = 模版数量 × 倍数）</Text>
            </div>
          </div>
        )}
      </Modal>

      {/* 显示字段控制弹窗（统一卡片式+拖动排序） */}
      <FieldConfigModal
        open={billFieldConfigVisible}
        fields={BILL_ALL_FIELDS}
        order={billFieldOrder}
        visibility={billFieldVisibility}
        onCancel={() => setBillFieldConfigVisible(false)}
        onSave={(o, v) => { setBillFieldOrder(o); setBillFieldVisibility(v); saveBillFieldConfig(o, v); setBillFieldConfigVisible(false); message.success('已保存'); }}
      />

      {/* 设置借方默认科目弹窗（会计账薄模式） */}
      <Modal title="设置借方默认科目" open={acctSubjectModalVisible} width={420}
        onCancel={() => setAcctSubjectModalVisible(false)}
        onOk={() => {
          const val = (acctSubjectDraft || '').trim();
          if (!val) { message.warning('请选择借方科目'); return; }
          try { localStorage.setItem(`purchbill_debit_subject_${getDataOwner()}`, val); } catch { /* ignore */ }
          setAcctDebitSubject(val);
          setAcctSubjectModalVisible(false);
          message.success(`借方默认科目已设置为：${val}`);
        }}
        okText="保存" cancelText="取消" destroyOnClose>
        <div style={{ padding: '8px 0' }}>
          <Text style={{ fontSize: 12, color: '#8c8c8c', display: 'block', marginBottom: 8 }}>
            采购账单对账完成自动生成分录时使用的借方科目（贷方固定为应付账款），默认：原材料
          </Text>
          <Select style={{ width: '100%' }} showSearch value={acctSubjectDraft || undefined}
            placeholder="请选择借方科目" options={acctSubjectOptions} onChange={v => setAcctSubjectDraft(v)}
            filterOption={(input, opt) => String(opt?.label || '').includes(input)} />
        </div>
      </Modal>

      {/* 供应商货品详情弹窗（与供应商列表的货品弹窗一样的内容） */}
      <Modal
        title={<span><ShoppingCartOutlined style={{ marginRight: 8 }} />{spDetailSupplier} · 成品列表</span>}
        open={spDetailVisible}
        onCancel={() => { setSpDetailVisible(false); handleSpdReset(); }}
        footer={<div style={{ textAlign: 'right' }}><Button onClick={() => { setSpDetailVisible(false); handleSpdReset(); }}>关闭</Button></div>}
        width={960}
        destroyOnClose
      >
        {/* 搜索栏 */}
        <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
          <Row gutter={[10, 8]} align="middle">
            <Col xs={12} sm={5}>
              <Input placeholder="商品编码" value={spdInputCode} onChange={e => setSpdInputCode(e.target.value)} onPressEnter={handleSpdSearch} allowClear size="small" />
            </Col>
            <Col xs={12} sm={5}>
              <Input placeholder="款式编码" value={spdInputStyleCode} onChange={e => setSpdInputStyleCode(e.target.value)} onPressEnter={handleSpdSearch} allowClear size="small" />
            </Col>
            <Col xs={12} sm={4}>
              <Input placeholder="品牌" value={spdInputBrand} onChange={e => setSpdInputBrand(e.target.value)} onPressEnter={handleSpdSearch} allowClear size="small" />
            </Col>
            <Col xs={12} sm={6}>
              <Space size={2} style={{ flexWrap: 'nowrap' }}>
                <span style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>基础售价</span>
                <Input placeholder="最低" value={spdInputPriceMin} onChange={e => setSpdInputPriceMin(e.target.value)} onPressEnter={handleSpdSearch} allowClear size="small" style={{ width: 72 }} />
                <span style={{ color: '#999' }}>~</span>
                <Input placeholder="最高" value={spdInputPriceMax} onChange={e => setSpdInputPriceMax(e.target.value)} onPressEnter={handleSpdSearch} allowClear size="small" style={{ width: 72 }} />
              </Space>
            </Col>
            <Col xs={12} sm={4}>
              <Select placeholder="商品状态" value={spdInputStatus || undefined} onChange={v => setSpdInputStatus(v || '')} allowClear size="small" style={{ width: '100%' }}>
                <Select.Option value="在售">在售</Select.Option>
                <Select.Option value="开发">开发</Select.Option>
                <Select.Option value="预售">预售</Select.Option>
                <Select.Option value="停产">停产</Select.Option>
                <Select.Option value="下架">下架</Select.Option>
              </Select>
            </Col>
            <Col xs={12} sm={4}>
              <Space>
                <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handleSpdSearch}>查询</Button>
                <Button size="small" icon={<ReloadOutlined />} onClick={handleSpdReset}>重置</Button>
              </Space>
            </Col>
          </Row>
        </div>
        <Table
          bordered
          dataSource={spdFilteredData}
          rowKey={(r: any) => r.key || r.productCode || r.styleCode || Math.random().toString()}
          pagination={{
            current: spdPage, pageSize: spdPageSize, total: spdFilteredData.length,
            showSizeChanger: true, showQuickJumper: true, pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            onChange: (page, pageSize) => { setSpdPage(page); setSpdPageSize(pageSize); },
          }}
          size="small"
          locale={{ emptyText: <Text type="secondary">该供应商暂无匹配的成品</Text> }}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 100,
              render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
            { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 100 },
            { title: '商品简称', dataIndex: 'shortName', key: 'shortName', width: 120,
              render: (v: string) => v || '-' },
            { title: '颜色', dataIndex: 'color', key: 'color', width: 80,
              render: (v: string) => v || '-' },
            { title: '规格', dataIndex: 'spec', key: 'spec', width: 100,
              render: (v: string) => v || '-' },
            { title: '品牌', dataIndex: 'brand', key: 'brand', width: 80,
              render: (v: string) => v || '-' },
            { title: '基础售价', dataIndex: 'suggestedPrice', key: 'suggestedPrice', width: 100, align: 'right' as const,
              render: (v: any) => { const n = Number(v); return n > 0 ? <Text strong style={{ color: '#52c41a' }}>¥{n.toFixed(2)}</Text> : '-'; } },
            { title: '商品状态', dataIndex: 'productStatus', key: 'productStatus', width: 90,
              render: (v: string) => {
                const map: Record<string, { color: string; text: string }> = {
                  '在售': { color: 'success', text: '在售' },
                  '开发': { color: 'cyan', text: '开发' },
                  '预售': { color: 'processing', text: '预售' },
                  '停产': { color: 'error', text: '停产' },
                  '下架': { color: 'default', text: '下架' },
                };
                const c = map[v] || { color: 'default', text: v || '-' };
                return <Tag color={c.color}>{c.text}</Tag>;
              }
            },
          ]}
        />
      </Modal>

      {/* 货品明细弹窗（点击商品编码单元格打开） */}
      <Modal
        title={<span><FileTextOutlined style={{ marginRight: 8 }} />货品明细{billItemDetail ? ` - ${billItemDetail.outboundNo}` : ''}</span>}
        open={billItemDetailVisible}
        onCancel={() => setBillItemDetailVisible(false)}
        footer={<Button onClick={() => setBillItemDetailVisible(false)}>关闭</Button>}
        width={760}
      >
        {billItemDetail && (
          <Table
            bordered
            size="small"
            dataSource={billItemDetail.items}
            rowKey={(_, i) => String(i)}
            pagination={billItemDetail.items.length > 10 ? { pageSize: 10, showTotal: (t: number) => `共 ${t} 条` } : false}
            columns={[
              { title: '序号', key: 'seq', width: 50, align: 'center' as const, render: (_: any, __: any, i: number) => i + 1 },
              { title: '款式编号', dataIndex: 'styleCode', key: 'styleCode', width: 100 },
              { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 130, render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
              { title: '颜色', dataIndex: 'color', key: 'color', width: 70, render: (v: string) => v || '-' },
              { title: '规格', dataIndex: 'spec', key: 'spec', width: 70, render: (v: string) => v || '-' },
              { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 70, align: 'right' as const },
              { title: '单价', dataIndex: 'unitPrice', key: 'unitPrice', width: 80, align: 'right' as const, render: (v: number) => <Text>¥{Number(v || 0).toFixed(2)}</Text> },
              { title: '金额', dataIndex: 'amount', key: 'amount', width: 90, align: 'right' as const, render: (v: number) => <Text style={{ color: '#f5222d' }}>¥{Number(v || 0).toFixed(2)}</Text> },
            ]}
          />
        )}
      </Modal>

      {/* 款式编码数量明细弹窗（点击款式编号单元格打开） */}
      <Modal
        title={<span><FileTextOutlined style={{ marginRight: 8 }} />款式编码数量明细{styleQtyDetail.bill ? ` - ${styleQtyDetail.bill.outboundNo}` : ''}</span>}
        open={styleQtyDetailVisible}
        onCancel={() => setStyleQtyDetailVisible(false)}
        footer={<Button onClick={() => setStyleQtyDetailVisible(false)}>关闭</Button>}
        width={420}
      >
        <Table
          bordered
          size="small"
          rowKey="styleCode"
          pagination={false}
          dataSource={styleQtyDetail.entries.map(([styleCode, qty]) => ({ styleCode, qty }))}
          columns={[
            { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', align: 'center' as const },
            { title: '数量', dataIndex: 'qty', key: 'qty', align: 'center' as const },
          ]}
          summary={(data) => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><Text strong>合计</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1}><Text strong>{data.reduce((s, d) => s + d.qty, 0)}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Modal>

      {/* 导出字段设置（按商品编码/按款式编码分别配置） */}
      <BillExportFieldModal open={billExportFieldVisible} scope={'purchaserBill_' + getDataOwner()} onClose={() => setBillExportFieldVisible(false)} />

      {/* 退货登记：负数退货账单 + 镜像供应商平台 + 库存联动 */}
      <ReturnRegisterModal open={returnVisible} onClose={() => setReturnVisible(false)} side="purchaser"
        counterpartyOptions={returnCounterpartyOptions} linkedBillOptions={returnLinkedOptions}
        onSubmit={handleReturnRegister} />
    </div>
  );
};

export default PurchaserBillPage;
