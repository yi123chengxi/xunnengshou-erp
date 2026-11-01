import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space,
  Select, Input, Tag, Tooltip, Empty, Modal, message, Form,
  Tabs, InputNumber, Divider, AutoComplete, Tree, Statistic, Upload, Image,
  Popconfirm, Checkbox, Popover,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ReloadOutlined, SaveOutlined,
  SearchOutlined, ApartmentOutlined, ExperimentOutlined,
  DollarOutlined, AppstoreOutlined, PictureOutlined, UploadOutlined, CloseCircleOutlined,
  CameraOutlined, CopyOutlined, EditOutlined, ToolOutlined, DatabaseOutlined, CheckCircleOutlined,
  PlusSquareOutlined, MinusSquareOutlined, DownOutlined, RightOutlined,
  ExclamationCircleOutlined, SettingOutlined, QuestionCircleOutlined, FileTextOutlined, UpOutlined, PrinterOutlined, DownloadOutlined,
} from '@ant-design/icons';
import type { ChildPageConfig } from '../config/pageConfig';
import { saveDataset } from '../utils/dataStore';
import { loadTenantUsers } from '../utils/tenantUsers';
import { safeSetItem } from '../utils/storageQuota';
import useResizableColumns from '../hooks/useResizableColumns';
import BatchAddProductModal from '../components/BatchAddProductModal';
import MoldPickerModal from '../components/MoldPickerModal';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// 六面图定义
const SIX_VIEWS = [
  { suffix: '', label: '正面图' },
  { suffix: '_side', label: '侧面图' },
  { suffix: '_back', label: '后视图' },
  { suffix: '_front2', label: '前视图' },
  { suffix: '_top', label: '俯视视图' },
  { suffix: '_bottom', label: '底花图' },
];

interface PlanDesignPageProps {
  pageConfig: ChildPageConfig | undefined;
  moduleKey: string;
}

// 获取数据所有者
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// BOM 存储 key
const getBomKey = (productKey: string): string => `bom_${productKey}_${getDataOwner()}`;

// IndexedDB 图片存储（替代 localStorage，容量可达500MB+）
export const imgDB = {
  _db: null as IDBDatabase | null,
  _init(): Promise<IDBDatabase> {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('prodImages', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('imgs'); };
        req.onsuccess = () => { this._db = req.result; resolve(this._db); };
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  },
  async get(key: string): Promise<string> {
    try {
      const db = await this._init();
      return new Promise((resolve) => {
        const tx = db.transaction('imgs', 'readonly');
        const req = tx.objectStore('imgs').get(key);
        req.onsuccess = () => resolve(req.result || '');
        req.onerror = () => resolve('');
      });
    } catch { return ''; }
  },
  async set(key: string, value: string): Promise<boolean> {
    try {
      const db = await this._init();
      return new Promise((resolve) => {
        const tx = db.transaction('imgs', 'readwrite');
        tx.objectStore('imgs').put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch { return false; }
  },
  async remove(key: string): Promise<void> {
    try {
      const db = await this._init();
      return new Promise((resolve) => {
        const tx = db.transaction('imgs', 'readwrite');
        tx.objectStore('imgs').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  },
};

// 保存图片到 IndexedDB + localStorage 双写（IndexedDB 容量大，localStorage 供市场页 imgOf 同步读取）
const saveImageToKeys = async (keys: string[], dataUrl: string): Promise<{ saved: number; failed: number }> => {
  if (!dataUrl || dataUrl.length < 50) {
    return { saved: 0, failed: keys.length };
  }
  const owner = getDataOwner();
  let saved = 0;
  let failed = 0;
  for (const key of keys) {
    const ok = await imgDB.set(key, dataUrl);
    if (ok) {
      try { localStorage.setItem(`prodImg_${owner}_${key}`, dataUrl); } catch { /* quota exceeded — IndexedDB 兆底 */ }
      saved++;
    } else {
      failed++;
    }
  }
  return { saved, failed };
};

// 删除多个 key 的图片
const removeImageFromKeys = async (keys: string[]): Promise<void> => {
  for (const key of keys) {
    await imgDB.remove(key);
  }
};

// 加载 BOM
const loadBom = (productKey: string): { semiProducts: any[]; rawMaterials: any[]; processes: any[] } => {
  try {
    const stored = localStorage.getItem(getBomKey(productKey));
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return { semiProducts: [], rawMaterials: [], processes: [] };
};

// 计算半成品有效价格（递归，支持循环引用检测）
const calcSemiEffectivePrice = (r: any, visited: Set<string> = new Set()): number => {
  if (visited.has(r.key)) return 0;
  visited.add(r.key);
  const storedPrice = Number(r.price) || 0;
  const subBom = loadBom(r.key);
  const semiCost = (subBom.semiProducts || []).reduce((s: number, i: any) => {
    if (visited.has(i.key)) return s;
    return s + calcSemiEffectivePrice(i, new Set(visited)) * (Number(i.qty) || 1);
  }, 0);
  const rawCost = (subBom.rawMaterials || []).reduce((s: number, i: any) => s + calcRawEffectivePrice(i) * (Number(i.qty) || 1), 0);
  const procCost = (subBom.processes || []).reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const bomCost = semiCost + rawCost + procCost;
  // 有子BOM时使用子BOM成本（storedPrice可能是旧的子BOM快照，避免双重计算）
  // 无子BOM时使用存储价格
  return bomCost > 0 ? bomCost : storedPrice;
};

// 计算 BOM 成本（使用递归计算半成品有效价格）
const calcBomCost = (bom: { semiProducts: any[]; rawMaterials: any[]; processes: any[] }): number => {
  const semiCost = (bom.semiProducts || []).reduce((s, i) => s + calcSemiEffectivePrice(i) * (Number(i.qty) || 1), 0);
  const rawCost = (bom.rawMaterials || []).reduce((s, i) => s + calcRawEffectivePrice(i) * (Number(i.qty) || 1), 0);
  const procCost = (bom.processes || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  return semiCost + rawCost + procCost;
};

// 原材料有效价格 = 自身单价 + 其子BOM工艺成本（原材料仅可添加工艺；工艺成本只计入当前添加它的BOM对象，不回写原材料成本价）
const calcRawEffectivePrice = (i: any): number => {
  const base = Number(i.price) || 0;
  let procCost = 0;
  try {
    const sub = loadBom(i.key);
    procCost = (sub.processes || []).reduce((s: number, p: any) => s + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);
  } catch { /* ignore */ }
  return base + procCost;
};

// 工序按优先级升序排序（1最高、99最低；未设置按99处理）
const sortProcs = (list: any[]): any[] => (list || []).slice().sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99));

// 生成唯一条形码（13位EAN）
const genBarcode = (prefix: string, offset: number): string => {
  const base = `690000${String(prefix).padStart(4, '0')}${String(offset).padStart(4, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
};

// 节点类型
type NodeType = 'style' | 'color-group' | 'variant' | 'bom-semi' | 'bom-raw' | 'bom-proc';

const PlanDesignPage: React.FC<PlanDesignPageProps> = ({ pageConfig, moduleKey }) => {
  // 物料清单列宽调整
  const { wrapColumns: wrapMaterialListCols } = useResizableColumns<any>('colWidths_materialList');
  // 数据状态
  const [finishedProducts, setFinishedProducts] = useState<any[]>([]);
  const [bomMap, setBomMap] = useState<Record<string, { semiProducts: any[]; rawMaterials: any[]; processes: any[] }>>({});

  // 选中节点
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // 左侧树面板可拖拽宽度
  const [treePanelWidth, setTreePanelWidth] = useState(380);
  const treePanelDragging = useRef(false);
  const treePanelContainerRef = useRef<HTMLDivElement>(null);

  // 研发产品树搜索筛选
  const [treeSearchText, setTreeSearchText] = useState('');
  const [treeStatusFilter, setTreeStatusFilter] = useState('');

  // BOM 编辑状态
  const [bomActiveTab, setBomActiveTab] = useState('semi');
  const [bomEditorExpandedBom, setBomEditorExpandedBom] = useState<Record<string, any>>({}); // 主编辑器展开的子BOM数据
  const [bomSemiProducts, setBomSemiProducts] = useState<any[]>([]);
  const [bomRawMaterials, setBomRawMaterials] = useState<any[]>([]);
  const [bomProcesses, setBomProcesses] = useState<any[]>([]);
  const bomLoadingRef = useRef(false); // 加载BOM时抑制自动保存

  // BOM 选择弹窗
  const [bomSelectVisible, setBomSelectVisible] = useState(false);
  const [bomSelectType, setBomSelectType] = useState<'semi' | 'raw' | 'process'>('semi');
  const [bomSelectData, setBomSelectData] = useState<any[]>([]);
  const [bomSelectKeys, setBomSelectKeys] = useState<React.Key[]>([]);
  const [bomSelectSearch, setBomSelectSearch] = useState('');
  const [bomSelectField, setBomSelectField] = useState('name');
  const [bomSelectAppliedSearch, setBomSelectAppliedSearch] = useState('');
  const [bomSelectAppliedField, setBomSelectAppliedField] = useState('name');
  // 新增半成品表单
  const [newSemiVisible, setNewSemiVisible] = useState(false);
  const [newSemiName, setNewSemiName] = useState('');
  const [newSemiCode, setNewSemiCode] = useState('');
  const [newSemiUnit, setNewSemiUnit] = useState('件');
  const [newSemiPrice, setNewSemiPrice] = useState<number | undefined>(undefined);
  const [newSemiStyleCode, setNewSemiStyleCode] = useState('');
  const [newSemiLevel, setNewSemiLevel] = useState('1');
    const [newSemiMoldNumber, setNewSemiMoldNumber] = useState('');
    const [newSemiMoldPickerVisible, setNewSemiMoldPickerVisible] = useState(false);
  const [newSemiBomItems, setNewSemiBomItems] = useState<any[]>([]); // 新半成品的物料清单
  const [newSemiBomMode, setNewSemiBomMode] = useState(false); // 新增半成品弹窗中打开BOM选择
  // 半成品编辑模式：正在编辑的记录key（复用新增半成品弹窗，提交时覆盖保存）
  const [semiEditKey, setSemiEditKey] = useState<string | null>(null);
  // 新增原材料/半成品弹窗：图片（base64）与拍照弹窗
  const [newRawImage, setNewRawImage] = useState('');
  const [newSemiImage, setNewSemiImage] = useState('');
  const [bomCamVisible, setBomCamVisible] = useState(false);
  const [bomCamTarget, setBomCamTarget] = useState<'raw' | 'semi'>('raw');
  const bomCamVideoRef = useRef<HTMLVideoElement | null>(null);
  const bomCamStreamRef = useRef<MediaStream | null>(null);
  // BOM 图片放大预览
  const [bomImgPreview, setBomImgPreview] = useState('');
  // 新增原材料表单
  const [newRawVisible, setNewRawVisible] = useState(false);
  // BOM 新增原材料：复用基础数据批量新增弹窗组件
  const [bomRawBatchVisible, setBomRawBatchVisible] = useState(false);
  const [newRawName, setNewRawName] = useState('');
  const [newRawStyleCode, setNewRawStyleCode] = useState('');
  const [newRawCode, setNewRawCode] = useState('');
  const [newRawSupplier, setNewRawSupplier] = useState('');
  const [newRawUnit, setNewRawUnit] = useState('');
    const [newRawMoldNumber, setNewRawMoldNumber] = useState('');
    const [newRawMoldPickerVisible, setNewRawMoldPickerVisible] = useState(false);
  const [newRawColor, setNewRawColor] = useState('');
  const [newRawSpec, setNewRawSpec] = useState('');
  const [newRawPrice, setNewRawPrice] = useState<number | undefined>(undefined);
  // 供应商选择弹窗（新增原材料弹窗内）
  const [rawSupplierPickVisible, setRawSupplierPickVisible] = useState(false);
  const [rawSupplierPickSearch, setRawSupplierPickSearch] = useState('');
  const [quickAddSupplierVisible, setQuickAddSupplierVisible] = useState(false);
  const [quickAddSupplierForm] = Form.useForm();
  // 新增工艺表单（复用生产工序新增弹窗布局）
  const [newProcVisible, setNewProcVisible] = useState(false);
  const [newProcId, setNewProcId] = useState('');
  const [newProcName, setNewProcName] = useState('');
  const [newProcType, setNewProcType] = useState<string | undefined>(undefined);
  const [newProcLaborPrice, setNewProcLaborPrice] = useState<number | undefined>(undefined);
  const [newProcTimeQuota, setNewProcTimeQuota] = useState<number | undefined>(undefined);
  const [newProcSetupTime, setNewProcSetupTime] = useState<number | undefined>(undefined);
  const [newProcEquipment, setNewProcEquipment] = useState('');
  const [newProcStatus, setNewProcStatus] = useState<string | undefined>(undefined);
  const [newProcPerson, setNewProcPerson] = useState<string | undefined>(undefined);
  const [newProcRemark, setNewProcRemark] = useState('');

  // 批量添加 BOM
  const [batchBomVisible, setBatchBomVisible] = useState(false);
  const [batchBomActiveTab, setBatchBomActiveTab] = useState('semi');
  const [batchSubBomTarget, setBatchSubBomTarget] = useState<any>(null); // 子BOM编辑目标半成品
  const [batchContextMenu, setBatchContextMenu] = useState<{ x: number; y: number; record: any } | null>(null);
  const [batchExpandedBom, setBatchExpandedBom] = useState<Record<string, any>>({}); // 展开的子BOM数据
  const [batchNestedExpanded, setBatchNestedExpanded] = useState<Record<string, any>>({}); // 展开明细内半成品嵌套展开的子BOM数据
  const [subBomNestedExpanded, setSubBomNestedExpanded] = useState<Record<number, Record<string, any>>>({}); // 子BOM编辑器栈的嵌套展开状态（按栈层级索引）
  // BOM表格字段配置
  const BOM_FIELD_OPTIONS = [
    { key: 'styleCode', label: '款式编码', defaultVisible: true },
    { key: 'shortName', label: '商品简称', defaultVisible: true },
    { key: 'code', label: '商品编码', defaultVisible: true },
    { key: 'color', label: '颜色', defaultVisible: false },
    { key: 'spec', label: '规格', defaultVisible: false },
    { key: 'image', label: '图片', defaultVisible: true },
    { key: 'supplierName', label: '供应商名称', defaultVisible: false },
    { key: 'level', label: '层级', defaultVisible: true },
    { key: 'unit', label: '单位', defaultVisible: true },
    { key: 'price', label: '成本价', defaultVisible: true },
    { key: 'qty', label: '数量', defaultVisible: true },
    { key: 'subtotal', label: '小计', defaultVisible: true },
  ];
  const [bomFieldConfigVisible, setBomFieldConfigVisible] = useState(false);
  const [bomFieldOrder, setBomFieldOrder] = useState<string[]>(BOM_FIELD_OPTIONS.map(f => f.key));
  const [bomFieldHidden, setBomFieldHidden] = useState<Set<string>>(new Set(BOM_FIELD_OPTIONS.filter(f => !f.defaultVisible).map(f => f.key)));
  // 原材料表格字段配置（半成品字段 + 原材料特有的“单位/生产数量”）
  const RAW_FIELD_OPTIONS = (() => {
    const base = BOM_FIELD_OPTIONS.map(f => {
      if (f.key === 'price') return { ...f, label: '单价' };
      return f;
    });
    // 在 qty 前插入 perMeterQty
    const idx = base.findIndex(f => f.key === 'qty');
    base.splice(idx, 0, { key: 'perMeterQty', label: '单位/生产数量', defaultVisible: true });
    return base;
  })();
  const [rawFieldConfigVisible, setRawFieldConfigVisible] = useState(false);
  const [rawFieldOrder, setRawFieldOrder] = useState<string[]>(RAW_FIELD_OPTIONS.map(f => f.key));
  const [rawFieldHidden, setRawFieldHidden] = useState<Set<string>>(new Set(RAW_FIELD_OPTIONS.filter(f => !f.defaultVisible).map(f => f.key)));
  // 子BOM编辑弹窗栈（复用批量添加BOM组件布局，每层位置错开显示，支持多层嵌套）
  const [subBomEditorStack, setSubBomEditorStack] = useState<any[]>([]);

  // 批量新增弹窗（复用成品列表的批量新增组件）
  const [batchAddVisible, setBatchAddVisible] = useState(false);

  // 供应商选项
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; supplierName: string; shortName: string }[]>([]);

  // 添加颜色弹窗
  const [addColorVisible, setAddColorVisible] = useState(false);
  const [addColorStyleCode, setAddColorStyleCode] = useState('');
  const [addColorName, setAddColorName] = useState('');
  const [addColorSpecs, setAddColorSpecs] = useState<string[]>(['']);
  const [addColorBasePrice, setAddColorBasePrice] = useState<number | undefined>(undefined);
  const [addColorShortName, setAddColorShortName] = useState('');
  const [addColorUnit, setAddColorUnit] = useState('件');
    const [addColorMoldNumber, setAddColorMoldNumber] = useState('');
    const [addColorMoldPickerVisible, setAddColorMoldPickerVisible] = useState(false);
  const [addColorImage, setAddColorImage] = useState('');

  // 物料清单弹窗
  const [materialListVisible, setMaterialListVisible] = useState(false);
  const [materialListSemi, setMaterialListSemi] = useState<any[]>([]);
  const [materialListRaw, setMaterialListRaw] = useState<any[]>([]);
  const [materialListProc, setMaterialListProc] = useState<any[]>([]);
  const MATERIAL_LIST_FIELDS = [
    { key: 'styleCode', label: '款式编码', defaultVisible: true },
    { key: 'shortName', label: '商品简称', defaultVisible: true },
    { key: 'code', label: '商品编码', defaultVisible: true },
    { key: 'color', label: '颜色', defaultVisible: false },
    { key: 'spec', label: '规格', defaultVisible: false },
    { key: 'level', label: '层级', defaultVisible: true },
    { key: 'unit', label: '单位', defaultVisible: true },
    { key: 'price', label: '单价', defaultVisible: true },
    { key: 'qty', label: '数量(合计)', defaultVisible: true },
    { key: 'count', label: '变体数', defaultVisible: true },
    { key: 'avgQty', label: '平均所需数量', defaultVisible: true },
    { key: 'subtotal', label: '小计(合计)', defaultVisible: true },
  ];
  const [materialListFieldOrder, setMaterialListFieldOrder] = useState<string[]>(MATERIAL_LIST_FIELDS.map(f => f.key));
  const [materialListFieldHidden, setMaterialListFieldHidden] = useState<Set<string>>(new Set(MATERIAL_LIST_FIELDS.filter(f => !f.defaultVisible).map(f => f.key)));
  const [materialListFieldConfigVisible, setMaterialListFieldConfigVisible] = useState(false);
  // 规格模版
  const [specTemplates, setSpecTemplates] = useState<{ name: string; specs: string[] }[]>(() => {
    try { return JSON.parse(localStorage.getItem('addColorSpecTemplates') || '[]'); } catch { return []; }
  });
  const [specTemplateModalVisible, setSpecTemplateModalVisible] = useState(false);
  const [specTemplateName, setSpecTemplateName] = useState('');
  // 变体图片上传弹窗
  const [variantImgUploadVisible, setVariantImgUploadVisible] = useState(false);
  const [variantImgUploadKey, setVariantImgUploadKey] = useState('');
  const [variantImgUploadCurrent, setVariantImgUploadCurrent] = useState('');
  const [variantImgUploadRefresh, setVariantImgUploadRefresh] = useState(0);
  const [variantImgUploadFromGallery, setVariantImgUploadFromGallery] = useState(false); // 是否从画廊（颜色级别）打开
  const [variantImgUploadSuffix, setVariantImgUploadSuffix] = useState(''); // 六面图后缀：'', '_side', '_back', '_front2', '_top', '_bottom'
  const [prodImgCache, setProdImgCache] = useState<Record<string, string>>({}); // 图片缓存（从 IndexedDB 加载）
  // 摄像头拍照目标: 'addColor' | 'variant'
  const [cameraTarget, setCameraTarget] = useState<'addColor' | 'variant'>('addColor');
  // 读取文件为 dataURL（Promise 包装，避免异步竞态）
  const readFileAsDataURL = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error('readFile failed'));
      r.readAsDataURL(blob);
    });
  }, []);

  // 压缩图片到合理大小（避免超出 localStorage 限制）
  const compressImage = useCallback((dataUrl: string, maxSize = 800, quality = 0.7): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
            else { width = Math.round(width * maxSize / height); height = maxSize; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
          }
          const result = canvas.toDataURL('image/jpeg', quality);
          // 验证压缩结果有效
          if (result && result.length > 100 && result.startsWith('data:')) {
            resolve(result);
          } else {
            // canvas 输出失败，尝试更小尺寸
            const smallCanvas = document.createElement('canvas');
            smallCanvas.width = 200;
            smallCanvas.height = 200;
            const sCtx = smallCanvas.getContext('2d');
            if (sCtx) {
              sCtx.fillStyle = '#FFFFFF';
              sCtx.fillRect(0, 0, 200, 200);
              sCtx.drawImage(img, 0, 0, 200, 200);
            }
            const fallback = smallCanvas.toDataURL('image/jpeg', 0.5);
            resolve(fallback && fallback.length > 100 ? fallback : dataUrl);
          }
        } catch (err) {
          console.error('[compressImage] canvas error:', err);
          resolve(dataUrl);
        }
      };
      img.onerror = () => {
        console.warn('[compressImage] img load failed, dataUrl length:', dataUrl?.length);
        // 图片加载失败，生成一个极小的占位图
        try {
          const c = document.createElement('canvas');
          c.width = 1; c.height = 1;
          const ctx = c.getContext('2d');
          if (ctx) { ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, 1, 1); }
          const placeholder = c.toDataURL('image/jpeg', 0.1);
          resolve(placeholder);
        } catch {
          resolve('');
        }
      };
      img.src = dataUrl;
    });
  }, []);

  // 摄像头拍照
  const [cameraVisible, setCameraVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openCamera = useCallback(async (target: 'addColor' | 'variant' = 'addColor') => {
    setCameraTarget(target);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCameraVisible(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); } }, 0);
    } catch { message.error('无法访问摄像头，请检查权限'); }
  }, []);
  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraVisible(false);
  }, []);
  const capturePhoto = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { message.warning('摄像头未就绪'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    const raw = canvas.toDataURL('image/png');
    const dataUrl = await compressImage(raw);
    if (cameraTarget === 'variant') {
      setVariantImgUploadCurrent(dataUrl);
    } else {
      setAddColorImage(dataUrl);
    }
    closeCamera();
    message.success('已拍摄图片');
  }, [closeCamera, cameraTarget, compressImage]);
  // 剪贴板粘贴监听（支持添加颜色和变体图片上传）
  useEffect(() => {
    if (!addColorVisible && !variantImgUploadVisible) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          (async () => {
            const raw = await readFileAsDataURL(file);
            const dataUrl = await compressImage(raw);
            if (variantImgUploadVisible) {
              setVariantImgUploadCurrent(dataUrl);
            } else {
              setAddColorImage(dataUrl);
            }
          })();
          message.success('图片已粘贴');
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addColorVisible, variantImgUploadVisible, compressImage, readFileAsDataURL]);

  // 左侧树面板拖拽调整宽度
  const handleTreePanelDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    treePanelDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!treePanelDragging.current) return;
      const container = treePanelContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = Math.max(260, Math.min(e.clientX - rect.left, rect.width - 300));
      setTreePanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (treePanelDragging.current) {
        treePanelDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 加载产品数据
  const loadProducts = useCallback(() => {
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    try {
      const stored = localStorage.getItem(plKey);
      if (stored) {
        const all = JSON.parse(stored);
        const finished = all.filter((p: any) => p.productType === '成品');
        setFinishedProducts(finished);
        // 加载所有 BOM
        const map: Record<string, any> = {};
        finished.forEach((p: any) => {
          map[p.key] = loadBom(p.key);
        });
        setBomMap(map);
      } else {
        setFinishedProducts([]);
        setBomMap({});
      }
    } catch { setFinishedProducts([]); setBomMap({}); }
  }, []);

  // 打开添加颜色弹窗
  const handleOpenAddColor = useCallback((styleCode: string, e?: React.MouseEvent) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    setAddColorStyleCode(styleCode);
    setAddColorName('');
    setAddColorSpecs(['']);
    setAddColorBasePrice(undefined);
    setAddColorImage('');
    const existing = finishedProducts.find(p => p.styleCode === styleCode);
    if (existing) {
      setAddColorShortName(existing.shortName || '');
      setAddColorUnit(existing.unit || '件');
      setAddColorBasePrice(Number(existing.suggestedPrice) || undefined);
    } else {
      setAddColorShortName('');
      setAddColorUnit('件');
    }
    setAddColorVisible(true);
  }, [finishedProducts]);

  // 确认添加颜色
  const handleConfirmAddColor = useCallback(async () => {
    if (!addColorStyleCode.trim()) { message.warning('款式编码不能为空'); return; }
    if (!addColorName.trim()) { message.warning('请输入颜色名称'); return; }
    const specs = addColorSpecs.filter(s => s.trim());
    if (specs.length === 0) { message.warning('请至少添加一种规格'); return; }
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    try {
      const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
      const newRecords = specs.map((spec, i) => {
        const productCode = `${addColorStyleCode.trim()}-${addColorName.trim()}-${spec}`;
        return {
          key: `ac-${Date.now()}-${i}`,
          productCode,
          name: '',
          shortName: addColorShortName || '',
          styleCode: addColorStyleCode.trim(),
          color: addColorName.trim(),
          spec,
          supplier: '',
          barcode: genBarcode(addColorStyleCode.trim(), Date.now() % 10000 + i),
          moldNumber: addColorMoldNumber.trim(),
          suggestedPrice: Number(addColorBasePrice) || 0,
          costPrice: 0,
          actualStock: 0,
          productType: '成品',
          unit: addColorUnit || '件',
          level: '0',
          status: '在售',
          suggestedRetailPrice: 0,
          productTags: '',
          createdAt: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
        };
      });
      const existingCodes = new Set(existing.map((p: any) => String(p.productCode || '').trim()));
      const conflicts = newRecords.filter(r => existingCodes.has(r.productCode));
      if (conflicts.length > 0) {
        message.error(`商品编码 ${conflicts.map(c => c.productCode).join(', ')} 已存在`);
        return;
      }
      const merged = [...newRecords, ...existing];
      const mergedJson = JSON.stringify(merged);
      safeSetItem(plKey, mergedJson);
      localStorage.setItem(`${plKey}_ts`, String(Date.now()));
      saveDataset(plKey, mergedJson);
      // 保存图片到 IndexedDB
      if (addColorImage) {
        const imgKeys = newRecords.map((rec: any) => rec.key);
        const { saved, failed } = await saveImageToKeys(imgKeys, addColorImage);
        if (failed > 0) {
          message.warning(`图片仅保存到 ${saved}/${newRecords.length} 个规格`);
        }
      }
      setAddColorVisible(false);
      setAddColorImage(''); setAddColorMoldNumber('');
      loadProducts();
      message.success(`成功添加 ${newRecords.length} 条产品（${addColorName}）`);
    } catch { message.error('保存失败'); }
  }, [addColorStyleCode, addColorName, addColorSpecs, addColorBasePrice, addColorShortName, addColorUnit, addColorMoldNumber, addColorImage, loadProducts]);

  // 加载供应商
  useEffect(() => {
    const owner = getDataOwner();
    const key = 'purchaser_suppliers_' + owner;
    try {
      const stored = localStorage.getItem(key);
      if (stored) setSupplierOptions(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // 初始加载
  useEffect(() => { loadProducts(); }, [loadProducts]);

  // 监听 localStorage 变化（当批量新增从外部保存后刷新）
  useEffect(() => {
    const interval = setInterval(() => { loadProducts(); }, 3000);
    return () => clearInterval(interval);
  }, [loadProducts]);

  // 按款式编码分组
  const styleGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    finishedProducts.forEach(p => {
      const sc = p.styleCode || '未分类';
      if (!groups[sc]) groups[sc] = [];
      groups[sc].push(p);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [finishedProducts]);

  // 构建 Tree 数据（按颜色分组）
  const treeData = useMemo(() => {
    return styleGroups.map(([styleCode, variants]) => {
      // 每个变体的成本从BOM动态计算
      const totalCost = variants.reduce((sum, v) => {
        const bom = bomMap[v.key] || { semiProducts: [], rawMaterials: [], processes: [] };
        return sum + calcBomCost(bom);
      }, 0);
      const avgCost = variants.length > 0 ? totalCost / variants.length : 0;
      // 按颜色分组
      const colorGroups: Record<string, any[]> = {};
      variants.forEach((v: any) => {
        const color = v.color || '未分类';
        if (!colorGroups[color]) colorGroups[color] = [];
        colorGroups[color].push(v);
      });
      const hasMultipleColors = Object.keys(colorGroups).length > 1;
      // 构建颜色组节点
      const colorChildren = Object.entries(colorGroups).map(([color, items]) => {
        const colorCost = items.reduce((sum, v) => {
          const bom = bomMap[v.key] || { semiProducts: [], rawMaterials: [], processes: [] };
          return sum + calcBomCost(bom);
        }, 0);
        const colorAvg = items.length > 0 ? colorCost / items.length : 0;
        const variantNodes = items.map((v: any) => {
          const bom = bomMap[v.key] || { semiProducts: [], rawMaterials: [], processes: [] };
          // BOM子节点名称显示优先级：商品简称 》 款式编码 》 名称 》 商品编码（均空时回退—）
          const bomLabel = (b: any) => b.shortName || b.styleCode || b.name || b.productCode || b.code || '—';
          const bomChildren: any[] = [
            ...(bom.semiProducts || []).map((b: any) => ({
              key: `${v.key}-semi-${b.key}`,
              title: `${bomLabel(b)} ×${b.qty || 1}`,
              type: 'bom-semi' as NodeType,
              isLeaf: true,
              data: b,
              parentKey: v.key,
            })),
            ...(bom.rawMaterials || []).map((b: any) => ({
              key: `${v.key}-raw-${b.key}`,
              title: `${bomLabel(b)} ×${b.qty || 1}`,
              type: 'bom-raw' as NodeType,
              isLeaf: true,
              data: b,
              parentKey: v.key,
            })),
            ...(bom.processes || []).map((b: any) => ({
              key: `${v.key}-proc-${b.key}`,
              title: `${b.name}`,
              type: 'bom-proc' as NodeType,
              isLeaf: true,
              data: b,
              parentKey: v.key,
            })),
          ];
          return {
            key: v.key,
            title: [v.shortName, v.spec].filter(Boolean).join('-') || v.productCode,
            type: 'variant' as NodeType,
            data: v,
            bom,
            children: bomChildren.length > 0 ? bomChildren : undefined,
          };
        });
        // 只有1个颜色且所有子项无颜色字段时，不显示颜色组，直接展开
        if (!hasMultipleColors && color === '未分类') {
          return variantNodes;
        }
        return [{
          key: `color-${styleCode}-${color}`,
          title: color,
          type: 'color-group' as NodeType,
          data: { color, items, avgCost: colorAvg, styleCode },
          children: variantNodes,
        }];
      }).flat();
      return {
        key: `style-${styleCode}`,
        title: styleCode,
        type: 'style' as NodeType,
        data: { styleCode, variants, avgCost },
        children: colorChildren,
      };
    });
  }, [styleGroups, bomMap]);

  // 研发产品树搜索过滤
  const filteredTreeData = useMemo(() => {
    const keyword = treeSearchText.trim().toLowerCase();
    if (!keyword && !treeStatusFilter) return treeData;
    return treeData.filter((node: any) => {
      // 货号搜索：匹配货号（title）或商品编码
      if (keyword) {
        const styleCode = String(node.title || '').toLowerCase();
        const productCodes = (node.data?.variants || []).map((v: any) => String(v.productCode || '').toLowerCase()).join(' ');
        const shortNames = (node.data?.variants || []).map((v: any) => String(v.shortName || '').toLowerCase()).join(' ');
        if (!styleCode.includes(keyword) && !productCodes.includes(keyword) && !shortNames.includes(keyword)) return false;
      }
      // 商品状态筛选：该货号下至少有一个变体匹配所选状态
      if (treeStatusFilter) {
        const hasMatch = (node.data?.variants || []).some((v: any) => v.productStatus === treeStatusFilter);
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [treeData, treeSearchText, treeStatusFilter]);

  // 研发完成：将货号所有产品状态改为在售，并触发成品市场自动上架
  const handleRdComplete = useCallback((styleCode: string) => {
    const group = styleGroups.find(([sc]) => sc === styleCode);
    if (!group) return;
    const [, variants] = group;
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    try {
      const all: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
      const variantKeys = new Set(variants.map((v: any) => v.key));
      let updatedCount = 0;
      const updated = all.map((p: any) => {
        if (variantKeys.has(p.key)) {
          updatedCount++;
          return { ...p, productStatus: '在售' };
        }
        return p;
      });
      const json = JSON.stringify(updated);
      safeSetItem(plKey, json);
      saveDataset(plKey, json);
      loadProducts();
      // 检查自动上架开关，若开启则触发成品市场扫描
      try {
        const cfg = JSON.parse(localStorage.getItem(`market_settings_${owner}`) || '{}');
        if (cfg.autoPublishOnSale === true) {
          window.dispatchEvent(new CustomEvent('product-status-updated'));
        }
      } catch { /* ignore */ }
      message.success(`货号 ${styleCode} 已完成研发，${updatedCount} 条产品状态已改为「在售」`);
    } catch { message.error('操作失败'); }
  }, [styleGroups, loadProducts]);

  // 选中节点处理
  const handleSelect = useCallback((keys: React.Key[], info: any) => {
    if (keys.length === 0) return;
    const key = String(keys[0]);
    const node = info.node;
    setSelectedKey(key);

    if (node.type === 'variant') {
      // 选中颜色子项：加载其 BOM 到编辑面板
      const product = node.data;
      setSelectedProduct(product);
      const bom = bomMap[product.key] || { semiProducts: [], rawMaterials: [], processes: [] };
      bomLoadingRef.current = true;
      setBomSemiProducts(bom.semiProducts || []);
      setBomRawMaterials(bom.rawMaterials || []);
      setBomProcesses(bom.processes || []);
      setBomActiveTab('semi');
    } else if (node.type === 'style' || node.type === 'color-group') {
      // 选中款式组或颜色组：显示款式组总览，不进入 BOM 编辑
      if (node.type === 'color-group') {
        // 颜色组：显示该颜色下的所有子项总览
        const { color, items, avgCost, styleCode } = node.data;
        setSelectedProduct({ styleCode, variants: items, avgCost, _isGroup: true, _colorGroup: color });
      } else {
        setSelectedProduct({ ...node.data, _isGroup: true });
      }
    } else {
      // 选中 BOM 子节点：定位到父产品并切换到对应 tab
      const parentKey = node.parentKey;
      const parent = finishedProducts.find(p => p.key === parentKey);
      if (parent) {
        setSelectedProduct(parent);
        setSelectedKey(parentKey);
        const bom = bomMap[parentKey] || { semiProducts: [], rawMaterials: [], processes: [] };
        bomLoadingRef.current = true;
        setBomSemiProducts(bom.semiProducts || []);
        setBomRawMaterials(bom.rawMaterials || []);
        setBomProcesses(bom.processes || []);
        if (node.type === 'bom-semi') setBomActiveTab('semi');
        else if (node.type === 'bom-raw') setBomActiveTab('raw');
        else setBomActiveTab('proc');
      }
    }
  }, [bomMap, finishedProducts]);

  // 物料清单：汇总当前层级下所有变体的BOM物料
  const handleOpenMaterialList = useCallback(() => {
    if (!selectedProduct) return;
    // 确定目标变体列表
    let targets: any[];
    if (selectedProduct._isGroup) {
      const variants = selectedProduct.variants || [];
      targets = selectedProduct._colorGroup
        ? variants.filter((v: any) => (v.color || '') === selectedProduct._colorGroup)
        : variants;
    } else {
      targets = [selectedProduct];
    }
    // 从产品列表回退查找字段
    const getProductField = (key: string, field: string): string => {
      try {
        const owner = getDataOwner();
        const plKey = `pageData_basic-data_product-list_${owner}`;
        const stored = localStorage.getItem(plKey);
        if (stored) {
          const products = JSON.parse(stored);
          const product = products.find((p: any) => p.key === key);
          return product?.[field] || '';
        }
      } catch {}
      return '';
    };
    const enrichRow = (row: any) => ({
      ...row,
      // 平均所需数量 = 数量(合计) / 变体数（规格数）
      avgQty: row.count ? Math.round(((row.qty || 0) / row.count) * 100000) / 100000 : (row.qty || 0),
      styleCode: getProductField(row.itemKey, 'styleCode') || row.styleCode || '',
      shortName: row.shortName || getProductField(row.itemKey, 'shortName') || '',
      code: row.code || getProductField(row.itemKey, 'code') || getProductField(row.itemKey, 'productCode') || row.itemKey.replace(/^(variant-|raw-)/, ''),
    });
    // 加载BOM数据
    const getBomForTarget = (t: any) => {
      if (bomMap[t.key]) return bomMap[t.key];
      try { const raw = localStorage.getItem(getBomKey(t.key)); if (raw) return JSON.parse(raw); } catch {}
      return { semiProducts: [], rawMaterials: [], processes: [] };
    };
    // 半成品汇总
    const semiAgg = new Map<string, any>();
    // 原材料汇总（包含所有层级的原材料）
    const rawAgg = new Map<string, any>();
    // 工艺汇总（包含所有层级的工艺）
    const procAgg = new Map<string, any>();
    const addItem = (agg: Map<string, any>, item: any) => {
      const k = item.key;
      if (agg.has(k)) {
        const existing = agg.get(k);
        existing.qty += (Number(item.qty) || 1);
        existing.count += 1;
        existing.subtotal += (Number(item.price) || 0) * (Number(item.qty) || 1);
      } else {
        agg.set(k, {
          key: `${item.key}_${Math.random().toString(36).slice(2,6)}`,
          itemKey: item.key,
          name: item.name || '',
          styleCode: item.styleCode || '',
          shortName: item.shortName || '',
          code: item.code || '',
          color: item.color || '',
          spec: item.spec || '',
          level: item.level || '',
          unit: item.unit || '',
          price: Number(item.price) || 0,
          qty: Number(item.qty) || 1,
          count: 1,
          subtotal: (Number(item.price) || 0) * (Number(item.qty) || 1),
        });
      }
    };
    // 递归遍历BOM树：收集所有半成品、原材料、工艺（允许同一半成品在不同父级中重复出现）
    const collectBomRecursive = (bomKey: string, depth: number) => {
      if (depth > 20) return; // 防止无限循环
      const bom = getBomForTarget({ key: bomKey });
      // 收集原材料
      (bom.rawMaterials || []).forEach((item: any) => addItem(rawAgg, item));
      // 收集工艺
      (bom.processes || []).forEach((item: any) => addItem(procAgg, item));
      // 收集半成品并递归（每个半成品都独立递归，不受visited限制）
      (bom.semiProducts || []).forEach((semi: any) => {
        addItem(semiAgg, semi);
        collectBomRecursive(semi.key, depth + 1);
      });
    };
    targets.forEach((t: any) => {
      collectBomRecursive(t.key, 0);
    });
    setMaterialListSemi(Array.from(semiAgg.values()).map(enrichRow));
    setMaterialListRaw(Array.from(rawAgg.values()).map(enrichRow));
    // 工艺清单：匹配生产工序表单，带出工序编号/名称/类型/工时定额
    let procList: any[] = [];
    try { procList = JSON.parse(localStorage.getItem(`pageData_basic-data_prod-process_${getDataOwner()}`) || '[]'); } catch { procList = []; }
    setMaterialListProc(Array.from(procAgg.values()).map(enrichRow).map((r: any) => {
      const proc = procList.find((p: any) => p.key === r.itemKey || p.id === r.itemKey || p.key === r.code || p.id === r.code);
      if (!proc) return r;
      return { ...r, name: proc.name || r.name || '', code: proc.id || r.code, procType: proc.type || '', timeQuota: proc.timeQuota ?? '' };
    }));
    setMaterialListVisible(true);
  }, [selectedProduct, bomMap]);

  // 保存 BOM（silent=true 时不显示成功提示，用于自动保存）
  const handleSaveBom = useCallback((silent?: boolean) => {
    if (!selectedProduct || selectedProduct._isGroup) return;
    const bom = { semiProducts: bomSemiProducts, rawMaterials: bomRawMaterials, processes: bomProcesses };
    // 保存到 localStorage
    try { localStorage.setItem(getBomKey(selectedProduct.key), JSON.stringify(bom)); } catch { /* ignore */ }
    // 计算成本
    const cost = calcBomCost(bom);
    // 更新产品列表中的成本价（成品 + BOM中的半成品）
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    try {
      const stored = localStorage.getItem(plKey);
      if (stored) {
        const all = JSON.parse(stored);
        // 更新成品成本价
        const updated = all.map((p: any) => p.key === selectedProduct.key ? { ...p, costPrice: cost.toFixed(2) } : p);
        // 同步更新BOM中半成品的成本价
        bomSemiProducts.forEach((semi: any) => {
          const semiCost = calcBomCost(loadBom(semi.key));
          for (let i = 0; i < updated.length; i++) {
            if (updated[i].key === semi.key) {
              updated[i] = { ...updated[i], costPrice: semiCost.toFixed(2) };
              break;
            }
          }
        });
        localStorage.setItem(plKey, JSON.stringify(updated));
      }
    } catch { /* ignore */ }
    // 刷新本地状态
    setBomMap(prev => ({ ...prev, [selectedProduct.key]: bom }));
    setFinishedProducts(prev => prev.map(p => p.key === selectedProduct.key ? { ...p, costPrice: cost.toFixed(2) } : p));
    if (!silent) message.success(`BOM 已保存，成本价：¥${cost.toFixed(2)}`);
  }, [selectedProduct, bomSemiProducts, bomRawMaterials, bomProcesses]);

  // 自动保存：BOM 数据变化后延迟 800ms 自动保存（加载时抑制）
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (bomLoadingRef.current) {
      bomLoadingRef.current = false;
      return;
    }
    if (!selectedProduct || selectedProduct._isGroup) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleSaveBom(true);
    }, 800);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [bomSemiProducts, bomRawMaterials, bomProcesses, selectedProduct, handleSaveBom]);

  // 打开 BOM 选择弹窗
  const handleOpenBomSelect = useCallback(async (type: 'semi' | 'raw' | 'process') => {
    setBomSelectType(type);
    setBomSelectKeys([]);
    setBomSelectSearch('');
    setBomSelectAppliedSearch('');
    setBomSelectAppliedField(bomSelectField);
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    // 先记录本地已有数据的 key，用于保护本地新建记录不被服务端旧数据覆盖
    let localKeys = new Set<string>();
    let data: any[] = [];
    try {
      const stored = localStorage.getItem(plKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          data = parsed;
          localKeys = new Set(parsed.map((p: any) => p.key).filter(Boolean));
        }
      }
    } catch { /* ignore */ }
    // 尝试从 IndexedDB 恢复更新的数据（安全：不涉及服务端拉取，不会触发 sync-data-updated）
    try {
      const { loadDataset } = await import('../utils/dataStore');
      const idb = await loadDataset(plKey);
      if (idb) {
        const lsTs = Number(localStorage.getItem(`${plKey}_ts`) || 0) || 0;
        if (idb.updatedAt > lsTs) {
          const idbList = JSON.parse(idb.json);
          if (Array.isArray(idbList) && idbList.length > data.length) {
            data = idbList;
          }
        }
      }
    } catch { /* ignore */ }
    const filterType = type === 'semi' ? '半成品' : type === 'raw' ? '原材料' : null;
    if (filterType) {
      data = data.filter((p: any) => {
        // 精确匹配 productType
        if (p.productType === filterType) return true;
        // 兼容：productType 缺失时，根据 level 推断（半成品=非0层）
        if (!p.productType && type === 'semi' && p.level && String(p.level) !== '0') return true;
        return false;
      });
    } else if (type === 'process') {
      // 从生产工序加载
      try {
        const procKey = `pageData_basic-data_prod-process_${owner}`;
        const procStored = localStorage.getItem(procKey);
        data = procStored ? JSON.parse(procStored) : [];
      } catch { data = []; }
    }
    setBomSelectData(data);
    setBomSelectVisible(true);
  }, []);

  // 确认添加 BOM 项
  const handleConfirmBomSelect = useCallback(() => {
    const selected = bomSelectData.filter((d: any) => bomSelectKeys.includes(d.key));
    if (selected.length === 0) { message.warning('请选择至少一项'); return; }

    // 在半成品的子BOM中添加半成品时：若添加项与被添加的半成品重复（同key/编码/名称）则提示不能添加
    if (bomSelectType === 'semi' && batchSubBomTarget) {
      const t: any = batchSubBomTarget;
      const dup = selected.find((s: any) =>
        s.key === t.key ||
        (t.code && (s.productCode === t.code || s.code === t.code)) ||
        (t.name && (s.shortName === t.name || s.name === t.name)));
      if (dup) {
        message.error(`不能添加：「${dup.shortName || dup.name || dup.productCode || dup.key}」与当前被添加的半成品「${t.name}」重复`);
        return;
      }
    }

    // 半成品BOM层级自动计算：根BOM=1级，子BOM=父级+1（仅对当前BOM有效，不影响半成品菜单下的层级）
    const _parentLevel = newSemiBomMode ? (Number(newSemiLevel) || 1) : (batchSubBomTarget ? (Number(batchSubBomTarget.level) || 1) : (subBomEditorStack.length > 0 ? (Number(subBomEditorStack[subBomEditorStack.length - 1].target?.level) || subBomEditorStack.length) : 0));
    const _bomDepth = _parentLevel + 1;

    const newItems = selected.map((item: any) => {
      if (bomSelectType === 'process') {
        return { key: item.key || item.id, name: item.processName || item.name, code: item.processCode || item.code || item.id || '', price: Number(item.price) || 0, qty: 1 };
      }
      // 半成品始终优先从子BOM计算成本价，子BOM为空时才使用产品列表中的costPrice
      let price = Number(item.costPrice) || 0;
      if (bomSelectType === 'semi') {
        const subBom = loadBom(item.key);
        const calc = (items: any[]) => items.reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
        const bomCost = calc(subBom.semiProducts || []) + calc(subBom.rawMaterials || []) + calc(subBom.processes || []);
        if (bomCost > 0) price = bomCost;
      }
      // 半成品自动计算BOM层级（仅对当前BOM有效），原材料保留产品原有层级
      const bomLevel = bomSelectType === 'semi' ? String(_bomDepth) : (item.level || '');
      return { key: item.key, name: [item.shortName || item.name, item.color, item.spec].filter(Boolean).join('-'), shortName: item.shortName || item.name || '', styleCode: item.styleCode || '', code: item.productCode || item.code || '', productCode: item.productCode || '', color: item.color || '', spec: item.spec || '', image: item.image || '', supplierName: item.supplierName || '', level: bomLevel, unit: item.unit || '', price, qty: 1 };
    });

    // 新增半成品模式：添加到新半成品的物料清单
    if (newSemiBomMode) {
      const tagged = newItems.map((n: any) => ({ ...n, type: bomSelectType }));
      setNewSemiBomItems(prev => [...prev, ...tagged.filter((n: any) => !prev.some((p: any) => p.key === n.key && p.type === n.type))]);
      setBomSelectVisible(false);
      setNewSemiBomMode(false);
      message.success(`已添加 ${tagged.length} 项到物料清单`);
      return;
    }

    // 子BOM模式：添加到指定半成品的子BOM
    if (batchSubBomTarget) {
      const bomKey = getBomKey(batchSubBomTarget.key);
      let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
      try { const raw = localStorage.getItem(bomKey); if (raw) bom = JSON.parse(raw); } catch {}
      // 过滤掉自引用（不允许将自己添加到自己的子BOM中）
      const filteredItems = newItems.filter(n => n.key !== batchSubBomTarget.key);
      if (bomSelectType === 'semi') bom.semiProducts = [...(bom.semiProducts || []), ...filteredItems.filter(n => !(bom.semiProducts || []).some((e: any) => e.key === n.key))];
      else if (bomSelectType === 'raw') bom.rawMaterials = [...(bom.rawMaterials || []), ...filteredItems.filter(n => !(bom.rawMaterials || []).some((e: any) => e.key === n.key))];
      else bom.processes = [...(bom.processes || []), ...filteredItems.filter(n => !(bom.processes || []).some((e: any) => e.key === n.key))];
      try { localStorage.setItem(bomKey, JSON.stringify(bom)); } catch {}
      // 刷新展开数据，确保已展开的行能显示最新子BOM
      setBatchExpandedBom(prev => {
        if (prev[batchSubBomTarget.key]) {
          return { ...prev, [batchSubBomTarget.key]: bom };
        }
        return prev;
      });
      // 子BOM编辑弹窗打开中且目标一致时，同步刷新其顶层列表
      if (subBomEditorStack.length > 0 && subBomEditorStack[subBomEditorStack.length - 1].target?.key === batchSubBomTarget.key) {
        const topIdx = subBomEditorStack.length - 1;
        setSubBomEditorStack(prev => prev.map((lv, i) => i === topIdx
          ? { ...lv, semi: bom.semiProducts || [], raw: bom.rawMaterials || [], proc: bom.processes || [] }
          : lv));
      }
      setBomSelectVisible(false);
      setBatchSubBomTarget(null);
      message.success(`已为「${batchSubBomTarget.name}」添加 ${newItems.length} 项 BOM`);
      return;
    }

    if (bomSelectType === 'semi') setBomSemiProducts(prev => [...prev, ...newItems.filter(n => !prev.some(p => p.key === n.key))]);
    else if (bomSelectType === 'raw') setBomRawMaterials(prev => [...prev, ...newItems.filter(n => !prev.some(p => p.key === n.key))]);
    else setBomProcesses(prev => [...prev, ...newItems.filter(n => !prev.some(p => p.key === n.key))]);

    setBomSelectVisible(false);
    message.success(`已添加 ${newItems.length} 项`);
  }, [bomSelectData, bomSelectKeys, bomSelectType, batchSubBomTarget, newSemiBomMode, subBomEditorStack, newSemiLevel]);

  // BOM 选择弹窗：触发搜索
  const handleBomSelectSearch = useCallback(() => {
    setBomSelectAppliedSearch(bomSelectSearch);
    setBomSelectAppliedField(bomSelectField);
  }, [bomSelectSearch, bomSelectField]);

  // 打开半成品子BOM编辑（从批量BOM弹窗中触发）
  const handleOpenSubBom = useCallback((semiProduct: any, type: 'semi' | 'raw' | 'process') => {
    setBatchSubBomTarget(semiProduct);
    setBatchContextMenu(null);
    // 读取已有子BOM并预加载到选择列表
    const bomKey = getBomKey(semiProduct.key);
    try {
      const raw = localStorage.getItem(bomKey);
      if (raw) {
        const bom = JSON.parse(raw);
        if (type === 'semi') setBomSemiProducts(bom.semiProducts || []);
        else if (type === 'raw') setBomRawMaterials(bom.rawMaterials || []);
        else setBomProcesses(bom.processes || []);
      }
    } catch {}
    handleOpenBomSelect(type);
  }, []);

  // 打开子BOM编辑弹窗（复用批量添加BOM组件，位置错开）
  const handleOpenSubBomEditor = useCallback((record: any) => {
    let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
    try {
      const raw = localStorage.getItem(getBomKey(record.key));
      if (raw) bom = JSON.parse(raw);
    } catch {}
    const isRaw = String(record?.code || '').startsWith('RAW-');
    setSubBomEditorStack([{ target: record, tab: isRaw ? 'proc' : 'semi', semi: bom.semiProducts || [], raw: bom.rawMaterials || [], proc: bom.processes || [] }]);
  }, []);

  // 在编辑弹窗内再打开下一层子BOM编辑弹窗（复用同一组件）
  const handlePushSubBomEditor = useCallback((record: any) => {
    let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
    try {
      const raw = localStorage.getItem(getBomKey(record.key));
      if (raw) bom = JSON.parse(raw);
    } catch {}
    const isRaw = String(record?.code || '').startsWith('RAW-');
    setSubBomEditorStack(prev => [...prev, { target: record, tab: isRaw ? 'proc' : 'semi', semi: bom.semiProducts || [], raw: bom.rawMaterials || [], proc: bom.processes || [] }]);
  }, []);

  // 保存顶层子BOM编辑弹窗
  const handleSubBomEditorSave = useCallback(() => {
    const top = subBomEditorStack[subBomEditorStack.length - 1];
    if (!top) return;
    const bom = { semiProducts: top.semi, rawMaterials: top.raw, processes: top.proc };
    try { localStorage.setItem(getBomKey(top.target.key), JSON.stringify(bom)); } catch {}
    setBatchExpandedBom(prev => ({ ...prev, [top.target.key]: bom }));
    // 同步刷新主编辑器的展开状态（若在主编辑器中展开过该半成品）
    setBomEditorExpandedBom(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(top.target.key)) delete next[k];
      });
      if (Object.keys(next).length !== Object.keys(prev).length) return next;
      return prev;
    });
    // 触发半成品列表重新渲染以更新成本价（getSemiEffectivePrice 从 localStorage 重新读取）
    setBomSemiProducts(prev => prev.map(i => ({ ...i })));
    const newCost = calcBomCost(bom);
    const isRawTarget = String(top.target.code || '').startsWith('RAW-');
    // 半成品：同步更新产品列表中的 costPrice；原材料：不回写成本价（追加工序仅对当前BOM对象有效）
    if (!isRawTarget) {
      const owner = getDataOwner();
      const plKey = `pageData_basic-data_product-list_${owner}`;
      try {
        const stored = localStorage.getItem(plKey);
        if (stored) {
          const all = JSON.parse(stored);
          const updated = all.map((p: any) => p.key === top.target.key ? { ...p, costPrice: newCost.toFixed(2) } : p);
          localStorage.setItem(plKey, JSON.stringify(updated));
        }
      } catch {}
      message.success(`「${top.target.name}」的子BOM已保存，成本价：¥${newCost.toFixed(2)}`);
    } else {
      message.success(`「${top.target.name}」的子BOM已保存：追加工序成本 ¥${newCost.toFixed(2)} 仅计入当前BOM，原材料成本价保持不变`);
    }
    // 关闭顶层并刷新上一层的展开明细（若已展开该目标）
    setSubBomEditorStack(prev => {
      const next = prev.slice(0, -1);
      return next.map((l, i) => (i === next.length - 1 && l.expanded && l.expanded[top.target.key]
        ? { ...l, expanded: { ...l.expanded, [top.target.key]: bom } }
        : l));
    });
  }, [subBomEditorStack]);

  // 删除展开子BOM明细中的单项（批量BOM弹窗，同步持久化到 bom_ 存储）
  const handleDeleteBatchExpandedItem = useCallback((parentKey: string, category: string, itemKey: string) => {
    const sub = batchExpandedBom[parentKey];
    if (!sub) return;
    const next = {
      semiProducts: (sub.semiProducts || []).filter((i: any) => !(category === '半成品' && i.key === itemKey)),
      rawMaterials: (sub.rawMaterials || []).filter((i: any) => !(category === '原材料' && i.key === itemKey)),
      processes: (sub.processes || []).filter((i: any) => !(category === '工序' && i.key === itemKey)),
    };
    try { localStorage.setItem(getBomKey(parentKey), JSON.stringify(next)); } catch {}
    setBatchExpandedBom(prev => ({ ...prev, [parentKey]: next }));
    message.success('已删除');
  }, [batchExpandedBom]);

  // 切换展开明细内半成品的嵌套展开（加载其子BOM）
  const handleToggleBatchNestedExpand = useCallback((key: string) => {
    setBatchNestedExpanded(prev => {
      if (prev[key]) { const { [key]: _, ...rest } = prev; return rest; }
      let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
      try { const raw = localStorage.getItem(getBomKey(key)); if (raw) bom = JSON.parse(raw); } catch {}
      return { ...prev, [key]: bom };
    });
  }, []);

  // 递归渲染展开的子BOM明细（半成品可继续嵌套展开，每层向右缩进48px至父行名称列位置以区分层级）
  const renderBatchExpandedItems = (sub: any, depth: number, onDelete?: (category: string, itemKey: string) => void): any => {
    const allItems: { item: any; category: string }[] = [
      ...(sub.semiProducts || []).map((i: any) => ({ item: i, category: '半成品' })),
      ...(sub.rawMaterials || []).map((i: any) => ({ item: i, category: '原材料' })),
      ...sortProcs(sub.processes || []).map((i: any) => ({ item: i, category: '工序' })),
    ];
    if (allItems.length === 0) return <div style={{ padding: '8px 0', color: '#999', fontSize: 12 }}>暂无子BOM明细，点击"添加BOM"开始添加</div>;
    return (
      <div style={{ padding: depth === 0 ? '4px 0' : 0, marginLeft: depth === 0 ? 0 : depth * 48 }}>
        {allItems.map(({ item, category }, idx) => (
          <div key={item.key || idx}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px', fontSize: 12, borderLeft: '3px solid #e6f7ff', marginLeft: 8 }}>
              {category === '半成品' ? (
                <Button size="small" type="link" icon={batchNestedExpanded[item.key] ? <MinusSquareOutlined /> : <PlusSquareOutlined />} style={{ padding: '0 4px', minWidth: 'auto' }} onClick={() => handleToggleBatchNestedExpand(item.key)} />
              ) : <span style={{ width: 24, flexShrink: 0 }} />}
              <Tag color={category === '半成品' ? 'blue' : category === '原材料' ? 'green' : 'orange'} style={{ margin: 0, fontSize: 11 }}>{category}</Tag>
              <span style={{ fontWeight: 500 }}>{category === '工序' ? (item.name || '—') : (item.shortName || item.styleCode || item.name || item.productCode || item.code || '—')}</span>
              <span style={{ color: '#888' }}>{item.code || ''}</span>
              {item.level && <Tag color="cyan" style={{ margin: 0, fontSize: 10 }}>L{item.level}</Tag>}
              <span style={{ color: '#666' }}>¥{(Number(item.price) || 0).toFixed(2)} × {Number(item.qty) || 1}</span>
              <span style={{ color: '#389e0d', fontWeight: 500 }}>= ¥{((Number(item.price) || 0) * (Number(item.qty) || 1)).toFixed(2)}</span>
              {onDelete && <Button size="small" type="link" danger icon={<DeleteOutlined />} style={{ marginLeft: 'auto' }} onClick={() => onDelete(category, item.key)}>删除</Button>}
            </div>
            {category === '半成品' && batchNestedExpanded[item.key] && renderBatchExpandedItems(batchNestedExpanded[item.key], depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  // 切换展开/收起子BOM明细（右侧面板）
  const handleToggleExpand = useCallback((key: string) => {
    setBatchExpandedBom(prev => {
      if (prev[key]) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      // 加载子BOM数据
      let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
      try {
        const raw = localStorage.getItem(getBomKey(key));
        if (raw) bom = JSON.parse(raw);
      } catch {}
      return { ...prev, [key]: bom };
    });
  }, []);

  // 子BOM编辑弹窗成本合计（按层计算）
  const calcSubBomLevelCost = (lv: any) => {
    const calc = (items: any[]) => items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    return calc(lv.semi || []) + calc(lv.raw || []) + calc(lv.proc || []);
  };

  // 打开半成品编辑弹窗（复用新增半成品弹窗）：回显简称/款式编码/商品编码/层级/单位/成本价 + 图片 + 物料清单
  const openSemiEditForm = useCallback((rec: any) => {
    setSemiEditKey(rec.key);
    setNewSemiName(rec.shortName || rec.name || '');
    setNewSemiStyleCode(rec.styleCode || '');
    setNewSemiCode(rec.productCode || '');
    setNewSemiLevel(rec.level !== undefined && rec.level !== '' ? String(rec.level) : '1');
    setNewSemiUnit(rec.unit || '件');
    setNewSemiPrice(Number(rec.costPrice ?? rec.suggestedPrice) || undefined);
    setNewSemiImage('');
    imgDB.get(rec.key).then(v => { if (v) setNewSemiImage(v); });
    let items: any[] = [];
    try {
      const bom = JSON.parse(localStorage.getItem(getBomKey(rec.key)) || 'null');
      if (bom) {
        items = [
          ...(bom.semiProducts || []).map((i: any) => ({ ...i, type: 'semi' })),
          ...(bom.rawMaterials || []).map((i: any) => ({ ...i, type: 'raw' })),
          ...(bom.processes || []).map((i: any) => ({ ...i, type: 'process' })),
        ];
      }
    } catch { /* ignore */ }
    setNewSemiBomItems(items);
    setNewSemiVisible(true);
  }, []);

  // 复制并创建：复制勾选的半成品生成新半成品（含图片与物料清单），随后打开首个副本的编辑弹窗
  const handleCopyCreateSemi = useCallback(async () => {
    const sources = bomSelectData.filter(i => bomSelectKeys.includes(i.key));
    if (sources.length === 0) { message.warning('请先勾选要复制的半成品'); return; }
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    let productList: any[] = [];
    try { productList = JSON.parse(localStorage.getItem(plKey) || '[]'); } catch { /* ignore */ }
    const codes = new Set([...productList.map((p: any) => String(p.productCode || '').trim()), ...bomSelectData.map((p: any) => String(p.productCode || '').trim())].filter(Boolean));
    const now = new Date();
    const newRecords: any[] = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      let code = ''; let tries = 0;
      do { code = `SEMI-${String(Math.floor(100000 + Math.random() * 900000))}`; tries++; } while (codes.has(code) && tries < 100);
      if (codes.has(code)) { message.error('无法生成唯一编码，请重试'); return; }
      codes.add(code);
      const newKey = `semi-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      const baseName = src.shortName || src.name || '半成品';
      const rec: any = {
        ...src,
        key: newKey,
        productCode: code,
        shortName: `${baseName}-副本`,
        name: src.name ? `${baseName}-副本` : src.name,
        createdAt: now.toISOString().slice(0, 10),
        updatedAt: now.toISOString().slice(0, 10),
      };
      newRecords.push(rec);
      productList = [rec, ...productList];
      // 复制物料清单（子BOM）
      try {
        const storedBom = localStorage.getItem(getBomKey(src.key));
        if (storedBom) localStorage.setItem(getBomKey(newKey), storedBom);
      } catch { /* ignore */ }
      // 复制图片（IndexedDB + 缓存）
      try {
        const img = await imgDB.get(src.key);
        if (img) { await imgDB.set(newKey, img); setProdImgCache(prev => ({ ...prev, [newKey]: img })); }
      } catch { /* ignore */ }
    }
    const mergedJson = JSON.stringify(productList);
    safeSetItem(plKey, mergedJson);
    saveDataset(plKey, mergedJson);
    setBomSelectData(prev => [...newRecords, ...prev]);
    setBomSelectKeys(prev => [...prev, ...newRecords.map(r => r.key)]);
    message.success(`已复制创建 ${newRecords.length} 个新半成品，已打开编辑窗口，修改不同处后点“保存修改”`);
    openSemiEditForm(newRecords[0]);
  }, [bomSelectData, bomSelectKeys, openSemiEditForm]);

  // 新增半成品确认
  const handleConfirmNewSemi = useCallback(() => {
    if (!newSemiName.trim()) { message.warning('请输入名称'); return; }
    if (!newSemiStyleCode.trim()) { message.warning('请输入款式编码'); return; }
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    // 编辑模式（复制并创建/行内编辑）：覆盖保存已有半成品，不新建记录
    if (semiEditKey) {
      const editKey = semiEditKey;
      const editCode = newSemiCode.trim();
      if (!editCode) { message.warning('请输入商品编码'); return; }
      try {
        const existing0: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
        if ([...existing0, ...bomSelectData].some((p: any) => p.key !== editKey && String(p.productCode || '').trim() === editCode)) {
          message.error(`编码 ${editCode} 已存在，请重新生成`);
          return;
        }
        const updates: any = {
          productCode: editCode,
          shortName: newSemiName.trim(),
          styleCode: newSemiStyleCode.trim(),
          unit: newSemiUnit || '件',
          level: newSemiLevel.trim() || '1',
          costPrice: Number(newSemiPrice) || 0,
          updatedAt: new Date().toISOString().slice(0, 10),
        };
        const merged0 = existing0.map((p: any) => p.key === editKey ? { ...p, ...updates } : p);
        const json0 = JSON.stringify(merged0);
        safeSetItem(plKey, json0);
        saveDataset(plKey, json0);
        // 物料清单覆盖保存（清空则删除子BOM）
        if (newSemiBomItems.length > 0) {
          const bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
          newSemiBomItems.forEach((it: any) => {
            const item = { key: it.key, name: it.name, code: it.code || '', level: it.level || '', unit: it.unit || '', price: Number(it.price) || 0, qty: it.qty || 1 };
            if (it.type === 'semi') bom.semiProducts.push(item);
            else if (it.type === 'raw') bom.rawMaterials.push(item);
            else bom.processes.push(item);
          });
          try { localStorage.setItem(getBomKey(editKey), JSON.stringify(bom)); } catch {}
        } else {
          try { localStorage.removeItem(getBomKey(editKey)); } catch {}
        }
        // 图片：有则保存，清除则删除
        if (newSemiImage) { imgDB.set(editKey, newSemiImage); setProdImgCache(prev => ({ ...prev, [editKey]: newSemiImage })); }
        else { imgDB.remove(editKey); setProdImgCache(prev => { const n = { ...prev }; delete n[editKey]; return n; }); }
        setBomSelectData(prev => prev.map(p => p.key === editKey ? { ...p, ...updates } : p));
        // 同步已加入BOM列表中的名称/编码/价格
        setBomSemiProducts(prev => prev.map(p => p.key === editKey ? { ...p, name: newSemiName.trim(), shortName: newSemiName.trim(), code: editCode, unit: newSemiUnit || '件', price: Number(newSemiPrice) || p.price } : p));
        setSemiEditKey(null);
        setNewSemiVisible(false);
        setNewSemiName(''); setNewSemiCode(''); setNewSemiPrice(undefined); setNewSemiUnit('件'); setNewSemiMoldNumber('');
        setNewSemiStyleCode(''); setNewSemiLevel('1'); setNewSemiBomItems([]); setNewSemiImage('');
        message.success(`半成品「${newSemiName.trim()}」修改已保存`);
      } catch { message.error('保存失败'); }
      return;
    }
    try {
      // 写入前重新读取 localStorage，确保拿到最新数据（避免 pullAllDatasets 等异步操作覆盖）
      const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
      if (!newSemiCode.trim()) { message.warning('请输入商品编码'); return; }
      const code = newSemiCode.trim();
      // 去重检查：同时检查 localStorage 和 bomSelectData 中已有编码
      const allItems = [...existing, ...bomSelectData];
      if (allItems.some((p: any) => String(p.productCode || '').trim() === code)) {
        message.error(`编码 ${code} 已存在，请重新生成`);
        return;
      }
      // 使用更唯一的 key：结合时间戳和随机数，避免快速连续创建时 key 重复
      const uniqueKey = `semi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const record = {
        key: uniqueKey,
        productCode: code,
        name: '',
        shortName: newSemiName.trim(),
        styleCode: newSemiStyleCode.trim(),
        color: '',
        spec: '',
        supplier: '',
        barcode: '',
        moldNumber: newSemiMoldNumber.trim(),
        suggestedPrice: 0,
        costPrice: Number(newSemiPrice) || 0,
        actualStock: 0,
        productType: '半成品',
        unit: newSemiUnit || '件',
        level: (() => { const _al = subBomEditorStack.length > 0 ? String((Number(subBomEditorStack[subBomEditorStack.length - 1].target?.level) || subBomEditorStack.length) + 1) : (batchSubBomTarget ? String((Number(batchSubBomTarget.level) || 1) + 1) : '1'); return newSemiLevel.trim() || _al; })(),
        status: '在售',
        suggestedRetailPrice: 0,
        productTags: '',
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      // 合并时去重：确保新记录不会替换已有同 key 的记录
      const merged = [record, ...existing.filter((e: any) => e.key !== uniqueKey && e.productCode !== code)];
      const mergedJson = JSON.stringify(merged);
      // 写入 localStorage 并检查结果
      const writeOk = safeSetItem(plKey, mergedJson);
      if (writeOk) {
        localStorage.setItem(`${plKey}_ts`, String(Date.now()));
      }
      saveDataset(plKey, mergedJson);
      // 保存图片到 IndexedDB（key 与产品 key 一致，BOM 表格图片列可读取）
      if (newSemiImage) { imgDB.set(uniqueKey, newSemiImage); setProdImgCache(prev => ({ ...prev, [uniqueKey]: newSemiImage })); }
      if (newSemiBomItems.length > 0) {
        const bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
        newSemiBomItems.forEach((it: any) => {
          const item = { key: it.key, name: it.name, code: it.code || '', level: it.level || '', unit: it.unit || '', price: Number(it.price) || 0, qty: it.qty || 1 };
          if (it.type === 'semi') bom.semiProducts.push(item);
          else if (it.type === 'raw') bom.rawMaterials.push(item);
          else bom.processes.push(item);
        });
        try { localStorage.setItem(getBomKey(record.key), JSON.stringify(bom)); } catch {}
      }
      // 添加到当前列表并自动选中，同时刷新 bomSelectData 确保切换类型后不丢失
      setBomSelectData(prev => {
        // 去重：确保不会重复添加
        if (prev.some((p: any) => p.key === record.key)) return prev;
        return [record, ...prev];
      });
      setBomSelectKeys(prev => prev.includes(record.key) ? prev : [...prev, record.key]);
      // 非子BOM模式下，直接添加到批量BOM的半成品列表（自动计算BOM层级）
      if (!batchSubBomTarget) {
        const _newBomLevel = subBomEditorStack.length > 0 ? String((Number(subBomEditorStack[subBomEditorStack.length - 1].target?.level) || subBomEditorStack.length) + 1) : '1';
        const bomItem = { key: record.key, name: [record.shortName || record.name, record.color, record.spec].filter(Boolean).join('-'), shortName: record.shortName || '', styleCode: record.styleCode || '', code: record.productCode || '', level: _newBomLevel, unit: record.unit || '', price: Number(record.costPrice) || 0, qty: 1 };
        setBomSemiProducts(prev => prev.some(p => p.key === bomItem.key) ? prev : [...prev, bomItem]);
      }
      setNewSemiVisible(false);
      setNewSemiName(''); setNewSemiCode(''); setNewSemiPrice(undefined); setNewSemiUnit('件'); setNewSemiMoldNumber('');
      setNewSemiStyleCode(''); setNewSemiLevel('1'); setNewSemiBomItems([]); setNewSemiImage('');
      message.success(`半成品「${newSemiName.trim()}」已创建并选中`);
    } catch { message.error('创建失败'); }
  }, [newSemiName, newSemiCode, newSemiUnit, newSemiPrice, newSemiStyleCode, newSemiLevel, newSemiBomItems, bomSelectData, batchSubBomTarget, newSemiImage, subBomEditorStack, semiEditKey, newSemiMoldNumber]);

  // 随机生成半成品编码（确保不与全部商品及当前选择列表中已有编码重复）
  const generateRandomSemiCode = useCallback(() => {
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
    // 同时检查 bomSelectData 中已创建但可能尚未同步的记录
    const allItems = [...existing, ...bomSelectData];
    const existingCodes = new Set(allItems.map((p: any) => String(p.productCode || '').trim()).filter(Boolean));
    let code: string;
    let attempts = 0;
    do {
      code = `SEMI-${String(Math.floor(100000 + Math.random() * 900000))}`;
      attempts++;
    } while (existingCodes.has(code) && attempts < 100);
    if (existingCodes.has(code)) {
      message.error('无法生成唯一编码，请手动输入');
      return;
    }
    setNewSemiCode(code);
  }, [bomSelectData]);

  // 随机生成原材料编码（检查 localStorage 与 bomSelectData 防重复）
  const generateRandomRawCode = useCallback(() => {
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
    const allItems = [...existing, ...bomSelectData];
    const existingCodes = new Set(allItems.map((p: any) => String(p.productCode || '').trim()).filter(Boolean));
    let code: string;
    let attempts = 0;
    do {
      code = `RAW-${String(Math.floor(100000 + Math.random() * 900000))}`;
      attempts++;
    } while (existingCodes.has(code) && attempts < 100);
    if (existingCodes.has(code)) {
      message.error('无法生成唯一编码，请手动输入');
      return;
    }
    setNewRawCode(code);
  }, [bomSelectData]);

  // 随机生成款式编码
  const generateRandomRawStyleCode = useCallback(() => {
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
    const allItems = [...existing, ...bomSelectData];
    const existingCodes = new Set(allItems.map((p: any) => String(p.styleCode || '').trim()).filter(Boolean));
    let code: string;
    let attempts = 0;
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
      attempts++;
    } while (existingCodes.has(code) && attempts < 100);
    if (existingCodes.has(code)) {
      message.error('无法生成唯一款式编码，请手动输入');
      return;
    }
    setNewRawStyleCode(code);
  }, [bomSelectData]);

  // 新增原材料确认（采购价即成本价）
  const handleConfirmNewRaw = useCallback(() => {
    if (!newRawName.trim()) { message.warning('请输入商品简称'); return; }
    if (!newRawStyleCode.trim()) { message.warning('请输入款式编码'); return; }
    if (!newRawSupplier.trim()) { message.warning('请输入供应商'); return; }
    if (!newRawUnit.trim()) { message.warning('请输入单位'); return; }
    if (newRawPrice === undefined || newRawPrice === null) { message.warning('请输入采购价'); return; }
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    try {
      const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
      const code = newRawCode.trim() || `RAW-${Date.now()}`;
      const allItems = [...existing, ...bomSelectData];
      if (allItems.some((p: any) => String(p.productCode || '').trim() === code)) {
        message.error(`编码 ${code} 已存在，请重新生成`);
        return;
      }
      const uniqueKey = `raw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const record = {
        key: uniqueKey,
        productCode: code,
        name: '',
        shortName: newRawName.trim(),
        styleCode: newRawStyleCode.trim(),
        color: newRawColor.trim(),
        spec: newRawSpec.trim(),
        supplier: newRawSupplier.trim(),
        supplierName: newRawSupplier.trim(),
        barcode: '',
        moldNumber: newRawMoldNumber.trim(),
        suggestedPrice: 0,
        costPrice: Number(newRawPrice) || 0,
        actualStock: 0,
        productType: '原材料',
        unit: newRawUnit.trim(),
        level: '1',
        status: '在售',
        suggestedRetailPrice: 0,
        productTags: '',
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      const merged = [record, ...existing.filter((e: any) => e.key !== uniqueKey && e.productCode !== code)];
      const mergedJson = JSON.stringify(merged);
      const writeOk = safeSetItem(plKey, mergedJson);
      if (writeOk) {
        localStorage.setItem(`${plKey}_ts`, String(Date.now()));
      }
      saveDataset(plKey, mergedJson);
      // 保存图片到 IndexedDB（key 与产品 key 一致，BOM 表格图片列可读取）
      if (newRawImage) { imgDB.set(uniqueKey, newRawImage); setProdImgCache(prev => ({ ...prev, [uniqueKey]: newRawImage })); }
      setBomSelectData(prev => {
        if (prev.some((p: any) => p.key === record.key)) return prev;
        return [record, ...prev];
      });
      setBomSelectKeys(prev => prev.includes(record.key) ? prev : [...prev, record.key]);
      // 非子BOM/新半成品/子编辑模式下，直接添加到批量BOM的原材料列表
      if (!batchSubBomTarget && !newSemiBomMode && subBomEditorStack.length === 0) {
        const bomItem = { key: record.key, name: [record.shortName, record.color, record.spec].filter(Boolean).join('-'), shortName: record.shortName || '', styleCode: record.styleCode || '', code: record.productCode || '', level: record.level || '', unit: record.unit || '', price: Number(record.costPrice) || 0, qty: 1 };
        setBomRawMaterials(prev => prev.some(p => p.key === bomItem.key) ? prev : [...prev, bomItem]);
      }
      setNewRawVisible(false);
      setNewRawName(''); setNewRawStyleCode(''); setNewRawCode(''); setNewRawSupplier(''); setNewRawUnit(''); setNewRawPrice(undefined); setNewRawImage(''); setNewRawColor(''); setNewRawSpec(''); setNewRawMoldNumber('');
      message.success(`原材料「${newRawName.trim()}」已创建并选中`);
    } catch { message.error('创建失败'); }
  }, [newRawName, newRawStyleCode, newRawCode, newRawSupplier, newRawUnit, newRawPrice, bomSelectData, batchSubBomTarget, newSemiBomMode, subBomEditorStack, newRawImage, newRawColor, newRawSpec, newRawMoldNumber]);

  // 拍照弹窗：打开/关闭/拍摄
  const openBomCam = (target: 'raw' | 'semi') => { setBomCamTarget(target); setBomCamVisible(true); };
  const closeBomCam = useCallback(() => {
    setBomCamVisible(false);
    if (bomCamStreamRef.current) { bomCamStreamRef.current.getTracks().forEach(t => t.stop()); bomCamStreamRef.current = null; }
  }, []);
  useEffect(() => {
    if (!bomCamVisible) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      bomCamStreamRef.current = stream;
      if (bomCamVideoRef.current) bomCamVideoRef.current.srcObject = stream;
    }).catch(() => message.error('无法打开摄像头'));
    return () => { cancelled = true; };
  }, [bomCamVisible]);
  const captureBomCam = () => {
    const video = bomCamVideoRef.current;
    if (!video || !video.videoWidth) { message.warning('摄像头未就绪'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (bomCamTarget === 'raw') setNewRawImage(dataUrl); else setNewSemiImage(dataUrl);
    closeBomCam();
    message.success('已拍照');
  };

  // 图片上传槽（点击上传 / Ctrl+V 粘贴 / 拍照）
  const renderBomImgUpload = (value: string, setValue: (v: string) => void, target: 'raw' | 'semi') => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div
        tabIndex={0}
        style={{ width: 84, height: 84, border: '1px dashed #d9d9d9', borderRadius: 4, background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', outline: 'none', overflow: 'hidden' }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/*';
          input.onchange = (ev) => {
            const file = (ev.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = e => setValue(String(e.target?.result || ''));
            reader.readAsDataURL(file);
          };
          input.click();
        }}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (const it of Array.from(items) as DataTransferItem[]) {
            if (it.type.startsWith('image/')) {
              const blob = it.getAsFile();
              if (!blob) continue;
              const reader = new FileReader();
              reader.onload = e => setValue(String(e.target?.result || ''));
              reader.readAsDataURL(blob);
              break;
            }
          }
        }}
      >
        {value ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (
          <div style={{ color: '#999', fontSize: 11, textAlign: 'center' }}><PlusOutlined style={{ fontSize: 16 }} /><div>点击/粘贴</div></div>
        )}
      </div>
      <Space direction="vertical" size={4}>
        <Button size="small" icon={<CameraOutlined />} onClick={() => openBomCam(target)}>拍照</Button>
        <Button size="small" icon={<CopyOutlined />} onClick={async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const type = item.types.find(t => t.startsWith('image/'));
              if (type) {
                const blob = await item.getType(type);
                const reader = new FileReader();
                reader.onload = e => setValue(String(e.target?.result || ''));
                reader.readAsDataURL(blob);
                message.success('已粘贴剪切板图片');
                return;
              }
            }
            message.warning('剪切板中没有图片');
          } catch {
            message.warning('无法读取剪切板，请点击图片框后按 Ctrl+V 粘贴');
          }
        }}>粘贴</Button>
        {value && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setValue('')}>清除</Button>}
      </Space>
    </div>
  );

  // BOM 表格图片单元格：缩略图 + 悬停放大 + 点击预览
  const BomImageCell = ({ k }: { k: string }) => {
    const [src, setSrc] = useState<string>(() => prodImgCache[k] || '');
    useEffect(() => {
      if (src) return;
      let cancelled = false;
      imgDB.get(k).then(v => { if (!cancelled && v) setSrc(v); });
      return () => { cancelled = true; };
    }, [k]);
    if (!src) return <span style={{ color: '#bbb' }}>—</span>;
    return (
      <Popover content={<img src={src} alt="" style={{ width: 220, maxHeight: 220, objectFit: 'contain' }} />} trigger="hover" placement="right">
        <img src={src} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in', display: 'block' }} onClick={() => setBomImgPreview(src)} />
      </Popover>
    );
  };

  // 负责人选项（与生产工序新增弹窗一致）
  const getProcPersonOptions = useCallback(() => {
    const options: { label: string; value: string }[] = [];
    const seen = new Set<string>();
    try {
      // 租户隔离：仅本租户成员账号（主账号 + 归属子账号）
      const users = loadTenantUsers();
      users.forEach((u: any) => {
        const name = u.contactPerson || u.companyName || u.username;
        if (name && !seen.has(name)) { seen.add(name); options.push({ label: name, value: name }); }
      });
    } catch { /* ignore */ }
    try {
      const accounts = JSON.parse(localStorage.getItem('accounts_' + getDataOwner()) || '[]');
      accounts.forEach((a: any) => {
        const name = a.displayName || a.person || a.username;
        if (name && !seen.has(name)) { seen.add(name); options.push({ label: name, value: name }); }
      });
    } catch { /* ignore */ }
    return options;
  }, []);

  // 随机生成工序编号
  const generateRandomProcId = useCallback(() => {
    const owner = getDataOwner();
    const procKey = `pageData_basic-data_prod-process_${owner}`;
    let existing: any[] = [];
    try { existing = JSON.parse(localStorage.getItem(procKey) || '[]'); } catch { existing = []; }
    const existingIds = new Set(existing.map((p: any) => String(p.id || '').trim()).filter(Boolean));
    let code: string;
    let attempts = 0;
    do {
      code = `GX${String(Math.floor(10000 + Math.random() * 90000))}`;
      attempts++;
    } while (existingIds.has(code) && attempts < 100);
    if (existingIds.has(code)) {
      message.error('无法生成唯一编号，请手动输入');
      return;
    }
    setNewProcId(code);
  }, []);

  // 新增工艺确认（写入生产工序数据源）
  const handleConfirmNewProc = useCallback(() => {
    if (!newProcId.trim()) { message.warning('请输入工序编号'); return; }
    if (!newProcName.trim()) { message.warning('请输入工序名称'); return; }
    if (newProcLaborPrice === undefined || newProcLaborPrice === null) { message.warning('请输入工价'); return; }
    if (newProcTimeQuota === undefined || newProcTimeQuota === null) { message.warning('请输入工时定额'); return; }
    const owner = getDataOwner();
    const procKey = `pageData_basic-data_prod-process_${owner}`;
    try {
      const existing: any[] = JSON.parse(localStorage.getItem(procKey) || '[]');
      if (existing.some((p: any) => String(p.id || '').trim() === newProcId.trim())) {
        message.error(`工序编号 ${newProcId.trim()} 已存在，请重新生成`);
        return;
      }
      const uniqueKey = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date();
      const record = {
        key: uniqueKey,
        id: newProcId.trim(),
        name: newProcName.trim(),
        type: newProcType || '',
        laborPrice: Number(newProcLaborPrice) || 0,
        price: Number(newProcLaborPrice) || 0, // BOM选择弹窗价格列读取 price
        timeQuota: Number(newProcTimeQuota) || 0,
        setupTime: Number(newProcSetupTime) || 0,
        equipment: newProcEquipment.trim(),
        status: newProcStatus || 'pending',
        person: newProcPerson || '',
        remark: newProcRemark.trim(),
        date: now.toLocaleDateString('zh-CN').replace(/\//g, '-'),
        creator: localStorage.getItem('username') || 'admin',
        createdAt: now.toISOString().slice(0, 10),
        updatedAt: now.toISOString().slice(0, 10),
      };
      const merged = [record, ...existing.filter((e: any) => e.key !== uniqueKey && e.id !== record.id)];
      const mergedJson = JSON.stringify(merged);
      const writeOk = safeSetItem(procKey, mergedJson);
      if (writeOk) {
        localStorage.setItem(`${procKey}_ts`, String(Date.now()));
      }
      saveDataset(procKey, mergedJson);
      setBomSelectData(prev => {
        if (prev.some((p: any) => p.key === record.key)) return prev;
        return [record, ...prev];
      });
      setBomSelectKeys(prev => prev.includes(record.key) ? prev : [...prev, record.key]);
      setNewProcVisible(false);
      setNewProcId(''); setNewProcName(''); setNewProcType(undefined); setNewProcLaborPrice(undefined);
      setNewProcTimeQuota(undefined); setNewProcSetupTime(undefined); setNewProcEquipment('');
      setNewProcStatus(undefined); setNewProcPerson(undefined); setNewProcRemark('');
      message.success(`工序「${record.name}」已创建并选中`);
    } catch { message.error('创建失败'); }
  }, [newProcId, newProcName, newProcType, newProcLaborPrice, newProcTimeQuota, newProcSetupTime, newProcEquipment, newProcStatus, newProcPerson, newProcRemark]);

  // 批量添加 BOM 确认（合并追加模式，不覆盖已有BOM）
  const handleBatchBomConfirm = useCallback(() => {
    if (!selectedProduct || !selectedProduct._isGroup) return;
    const newSemi = bomSemiProducts;
    const newRaw = bomRawMaterials;
    const newProc = bomProcesses;
    const totalItems = newSemi.length + newRaw.length + newProc.length;
    if (totalItems === 0) { message.warning('请先添加 BOM 项目'); return; }
    // 确定目标变体
    const variants = selectedProduct.variants || [];
    const targets = selectedProduct._colorGroup
      ? variants.filter((v: any) => (v.color || '') === selectedProduct._colorGroup)
      : variants;
    if (targets.length === 0) { message.warning('没有找到目标变体'); return; }
    // 合并 BOM 到每个变体（追加而非替换）
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    let savedCount = 0;
    const mergedBomMap: Record<string, any> = {};
    try {
      const stored = localStorage.getItem(plKey);
      const all = stored ? JSON.parse(stored) : [];
      const updated = all.map((p: any) => {
        const isTarget = targets.some((t: any) => t.key === p.key);
        if (!isTarget) return p;
        // 读取已有 BOM
        let existing = { semiProducts: [], rawMaterials: [], processes: [] };
        try {
          const existRaw = localStorage.getItem(getBomKey(p.key));
          if (existRaw) existing = JSON.parse(existRaw);
        } catch { /* ignore */ }
        // 合并（去重）
        const merged = {
          semiProducts: [...(existing.semiProducts || []), ...newSemi.filter(n => !(existing.semiProducts || []).some((e: any) => e.key === n.key))],
          rawMaterials: [...(existing.rawMaterials || []), ...newRaw.filter(n => !(existing.rawMaterials || []).some((e: any) => e.key === n.key))],
          processes: [...(existing.processes || []), ...newProc.filter(n => !(existing.processes || []).some((e: any) => e.key === n.key))],
        };
        localStorage.setItem(getBomKey(p.key), JSON.stringify(merged));
        const cost = calcBomCost(merged);
        mergedBomMap[p.key] = merged;
        savedCount++;
        return { ...p, costPrice: cost.toFixed(2) };
      });
      localStorage.setItem(plKey, JSON.stringify(updated));
    } catch { /* ignore */ }
    // 更新状态
    setBomMap(prev => ({ ...prev, ...mergedBomMap }));
    setFinishedProducts(prev => prev.map(p => {
      const merged = mergedBomMap[p.key];
      if (!merged) return p;
      return { ...p, costPrice: calcBomCost(merged).toFixed(2) };
    }));
    setBatchBomVisible(false);
    message.success(`BOM 已追加到 ${savedCount} 个规格`);
  }, [selectedProduct, bomSemiProducts, bomRawMaterials, bomProcesses]);



  // 当前选中货号的所有图片（从 IndexedDB 缓存加载）
  const groupImages = useMemo(() => {
    if (!selectedProduct || !selectedProduct._isGroup) return [];
    return (selectedProduct.variants || []).map((v: any) => prodImgCache[v.key] || '');
  }, [selectedProduct, prodImgCache]);

  // 按颜色分组的图片映射（画廊用）
  const colorImageMap = useMemo(() => {
    if (!selectedProduct || !selectedProduct._isGroup) return [];
    const variants = selectedProduct.variants || [];
    const groups: Record<string, any[]> = {};
    variants.forEach((v: any) => {
      const c = v.color || '未分类';
      if (!groups[c]) groups[c] = [];
      groups[c].push(v);
    });
    return Object.entries(groups).map(([color, items]) => {
      let firstImg = '';
      let firstKey = '';
      for (const v of items) {
        const img = prodImgCache[v.key];
        if (img) { firstImg = img; firstKey = v.key; break; }
      }
      return { color, items, firstImg, firstKey };
    });
  }, [selectedProduct, prodImgCache]);

  // 从 IndexedDB 加载当前选中产品的所有图片到缓存
  useEffect(() => {
    if (!selectedProduct) return;
    const variants = selectedProduct.variants || [];
    if (variants.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const cache: Record<string, string> = {};
      for (const v of variants) {
        // 正面图
        const img = await imgDB.get(v.key);
        if (cancelled) return;
        if (img) cache[v.key] = img;
        // 六面图后缀
        for (const { suffix } of SIX_VIEWS) {
          if (suffix === '') continue;
          const viewImg = await imgDB.get(`${v.key}${suffix}`);
          if (cancelled) return;
          if (viewImg) cache[`${v.key}${suffix}`] = viewImg;
        }
      }
      if (!cancelled) setProdImgCache(cache);
    };
    load();
    return () => { cancelled = true; };
  }, [selectedProduct, variantImgUploadRefresh]);

  // 成本统计
  // 获取半成品的有效成本价（优先从子BOM动态计算，确保编辑子BOM后价格实时更新）
  function getSemiEffectivePrice(r: any, visited: Set<string> = new Set()): number {
    if (visited.has(r.key)) return 0; // 防止循环引用导致无限递归
    visited.add(r.key);
    const storedPrice = Number(r.price) || 0;
    const subBom = loadBom(r.key);
    // 计算子BOM成本：半成品使用递归计算有效价格，原材料和工艺直接使用 price
    const semiCost = (subBom.semiProducts || []).reduce((s: number, i: any) => {
      if (visited.has(i.key)) return s; // 跳过自引用
      return s + getSemiEffectivePrice(i, new Set(visited)) * (Number(i.qty) || 1);
    }, 0);
    const rawCost = (subBom.rawMaterials || []).reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    const procCost = (subBom.processes || []).reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    const bomCost = semiCost + rawCost + procCost;
    // 有子BOM时使用子BOM成本（storedPrice可能是旧的快照，避免双重计算）
    return bomCost > 0 ? bomCost : storedPrice;
  }

  const totalCost = useMemo(() => {
    const calc = (items: any[]) => items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    const semiCalc = bomSemiProducts.reduce((s, i) => s + getSemiEffectivePrice(i) * (Number(i.qty) || 1), 0);
    return semiCalc + calc(bomRawMaterials) + calc(bomProcesses);
  }, [bomSemiProducts, bomRawMaterials, bomProcesses]);

  // BOM 表格列（customSetters 供嵌套子BOM编辑弹窗复用，绑定各自的列表 state；customOpCol 供子BOM编辑器栈使用不同的操作列）
  const bomColumns = (type: 'semi' | 'raw' | 'process', customSetters?: Record<'semi' | 'raw' | 'process', (fn: any) => void>, customOpCol?: any) => {
    const setter = customSetters ? customSetters[type] : (type === 'semi' ? setBomSemiProducts : type === 'raw' ? setBomRawMaterials : setBomProcesses);
    // 加载完整产品列表（包含成品+半成品+原材料）用于字段回退查找
    const getProductField = (key: string, field: string): string => {
      try {
        const owner = getDataOwner();
        const plKey = `pageData_basic-data_product-list_${owner}`;
        const stored = localStorage.getItem(plKey);
        if (stored) {
          const products = JSON.parse(stored);
          const product = products.find((p: any) => p.key === key);
          return product?.[field] || '';
        }
      } catch {}
      return '';
    };
    // 匹配生产工序表单记录（多键：key/id/code/name），用于工序名称/工序编号回填
    const getProcRecord = (r: any): any => {
      try {
        const owner = getDataOwner();
        const stored = localStorage.getItem(`pageData_basic-data_prod-process_${owner}`);
        if (stored) {
          const procs = JSON.parse(stored);
          return procs.find((p: any) =>
            (r.key && (p.key === r.key || p.id === r.key)) ||
            (r.code && (p.key === r.code || p.id === r.code)) ||
            (r.name && p.name === r.name)) || null;
        }
      } catch {}
      return null;
    };
    // 定义所有可能的列
    const allCols: Record<string, any> = {
      styleCode: { title: '款式编码', dataIndex: 'styleCode', width: 110, render: (v: string, r: any) => {
        if (v) return v;
        return getProductField(r.key, 'styleCode') || '—';
      } },
      shortName: { title: '商品简称', dataIndex: 'shortName', width: 100, render: (v: string, r: any) => {
        if (v) return v;
        return getProductField(r.key, 'shortName') || '—';
      } },
      code: { title: '商品编码', dataIndex: 'code', width: 100, render: (v: string) => v || '—' },
      color: { title: '颜色', dataIndex: 'color', width: 60, render: (v: string, r: any) => {
        const val = v || getProductField(r.key, 'color');
        return val ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: val, border: '1px solid #d9d9d9' }} />
          <span>{val}</span>
        </div>
      ) : '—';
      } },
      spec: { title: '规格', dataIndex: 'spec', width: 60, render: (v: string, r: any) => v || getProductField(r.key, 'spec') || '—' },
      image: { title: '图片', dataIndex: 'image', width: 60, render: (_v: string, r: any) => <BomImageCell k={r.key} /> },
      supplierName: { title: '供应商名称', dataIndex: 'supplierName', width: 100, render: (v: string, r: any) => v || getProductField(r.key, 'supplierName') || '—' },
      level: type !== 'process' ? { title: '层级', dataIndex: 'level', width: 60, align: 'center' as const, render: (v: any) => v ? <Tag color="blue">{v}</Tag> : '—' } : null,
      unit: type !== 'process' ? { title: '单位', dataIndex: 'unit', width: 60, align: 'center' as const, render: (v: any) => v || '—' } : null,
      price: { title: type === 'semi' ? '成本价' : '单价', dataIndex: 'price', width: 90, render: (v: any, r: any) => {
        if (type === 'semi') return `¥${getSemiEffectivePrice(r).toFixed(2)}`;
        if (type === 'process') {
          // 工序单价可编辑：仅修改当前BOM条目的价格，不影响生产工序列表中的单价
          return (
            <InputNumber size="small" min={0} step={0.01} precision={2} value={Number(v) || 0} style={{ width: 80 }}
              onChange={val => setter((prev: any[]) => prev.map(i => i.key === r.key ? { ...i, price: val || 0 } : i))} />
          );
        }
        return `¥${(Number(v) || 0).toFixed(2)}`;
      } },
      perMeterQty: type === 'raw' ? {
        title: <Tooltip title="输入每单位可以生产的数量。比如皮料每米可以裁剪出50片，那就输入50即可自动计算本商品需要的数量">单位/生产数量 <QuestionCircleOutlined style={{ color: '#1890ff' }} /></Tooltip>, dataIndex: 'perMeterQty', width: 140,
        render: (v: any, r: any) => {
          return <InputNumber size="small" min={0} step={0.1} precision={5} value={v || undefined} style={{ width: 100 }} placeholder="选填"
            onChange={val => {
              const perMeter = val || 0;
              const newQty = perMeter > 0 ? 1 / perMeter : (Number(r.qty) || 0.00001);
              setter((prev: any[]) => prev.map(i => i.key === r.key ? { ...i, perMeterQty: perMeter, qty: perMeter > 0 ? newQty : (i.qty || 0.00001) } : i));
            }} />;
        },
      } : null,
      qty: {
        title: '数量', dataIndex: 'qty', width: 100,
        render: (v: any, r: any) => {
          return <InputNumber size="small" min={0.00001} step={0.1} precision={5} value={v} style={{ width: 80 }}
            onChange={val => setter((prev: any[]) => prev.map(i => i.key === r.key ? { ...i, qty: val || 0.00001 } : i))} />;
        },
      },
      subtotal: { title: '小计', width: 90, render: (_: any, r: any) => {
        const p = type === 'semi' ? getSemiEffectivePrice(r) : (Number(r.price) || 0);
        return `¥${(p * (Number(r.qty) || 1)).toFixed(2)}`;
      } },
    };
    // 序号列（固定在最前面）
    const indexCol = { title: '序号', width: 50, align: 'center' as const, render: (_: any, __: any, index: number) => index + 1 };
    // 操作列（添加BOM、展开、删除）- 优先使用自定义操作列
    const opCol = customOpCol || {
      title: '操作', width: 150, fixed: 'right' as const,
      render: (_: any, r: any) => {
        return (
          <Space size={4}>
            <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => handleOpenSubBomEditor(r)}>添加BOM</Button>
            <Button type="link" size="small" icon={batchExpandedBom[r.key] ? <MinusSquareOutlined /> : <PlusSquareOutlined />} onClick={() => handleToggleExpand(r.key)}>展开</Button>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => setter((prev: any[]) => prev.filter(i => i.key !== r.key))}>删除</Button>
          </Space>
        );
      },
    };
    // 半成品使用配置的字段顺序和可见性
    if (type === 'semi') {
      const cols = bomFieldOrder
        .filter(key => !bomFieldHidden.has(key) && allCols[key])
        .map(key => ({ ...allCols[key], key }));
      return [indexCol, ...cols, opCol];
    }
    // 原材料使用配置的字段顺序和可见性（与半成品相同配置）
    if (type === 'raw') {
      const cols = rawFieldOrder
        .filter(key => !rawFieldHidden.has(key) && allCols[key])
        .map(key => ({ ...allCols[key], key }));
      return [indexCol, ...cols, opCol];
    }
    // 工艺使用固定列（工序名称/工序编号：匹配生产工序列表对应工序内容）
    const procNameCol = { title: '工序名称', dataIndex: 'name', width: 100, render: (v: string, r: any) => v || getProcRecord(r)?.name || r.shortName || '—' };
    const processCodeCol = { title: '工序编号', dataIndex: 'code', width: 100, render: (v: string, r: any) => { const p = getProcRecord(r); if (p?.id) return p.id; if (v && !String(v).startsWith('proc-')) return v; return '—'; } };
    // 优先级：1-99可编辑，99最低；同一对象多个工序按此排序
    const priorityCol = { title: <Tooltip title="优先级1-99，数字越小越靠前，99最低；未设置按99处理">优先级 <QuestionCircleOutlined style={{ color: '#1890ff' }} /></Tooltip>, dataIndex: 'priority', width: 80, align: 'center' as const, render: (v: any, r: any) => (
      <InputNumber size="small" min={1} max={99} precision={0} value={v ?? undefined} placeholder="1-99" style={{ width: 60 }}
        onChange={val => setter((prev: any[]) => prev.map(i => i.key === r.key ? { ...i, priority: val ?? undefined } : i))} />
    ) };
    const result: any[] = [
      indexCol, procNameCol, processCodeCol, priorityCol,
      ...(allCols.level ? [allCols.level] : []),
      ...(allCols.unit ? [allCols.unit] : []),
      allCols.price,
      ...(allCols.perMeterQty ? [allCols.perMeterQty] : []),
      allCols.qty, allCols.subtotal,
      opCol,
    ];
    return result;
  };

  // 树节点自定义渲染
  const titleRender = (nodeData: any) => {
    const { type, data, title, bom } = nodeData;
    if (type === 'style') {
      const cost = data.avgCost || 0;
      // 统计该货号下所有变体的商品状态
      const statusColorMap: Record<string, string> = { '在售': '#52c41a', '开发': '#13c2c2', '预售': '#1890ff', '停产': '#f5222d', '下架': '#8c8c8c' };
      const statusCounts: Record<string, number> = {};
      (data.variants || []).forEach((v: any) => {
        const s = v.productStatus;
        if (s) statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      const statusTags = Object.entries(statusCounts).map(([s, cnt]) => (
        <Tag key={s} color={statusColorMap[s] || '#8c8c8c'} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>{s}{cnt > 1 ? ` ${cnt}` : ''}</Tag>
      ));
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <ApartmentOutlined style={{ color: PRIMARY, fontSize: 15 }} />
          <Text strong style={{ fontSize: 13, color: PRIMARY }}>货号：{title}</Text>
          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{data.variants?.length || 0} 款</Tag>
          {statusTags}
          {cost > 0 && <Text style={{ fontSize: 11, color: '#8c8c8c' }}>均价 ¥{cost.toFixed(2)}</Text>}
          <Tooltip title="添加颜色">
            <Button type="link" size="small" icon={<PlusOutlined />} style={{ fontSize: 11, padding: '0 4px', color: PRIMARY }}
              onClick={(e) => handleOpenAddColor(title, e)}>添加颜色</Button>
          </Tooltip>
        </div>
      );
    }
    if (type === 'color-group') {
      const color = data.color || '';
      const count = data.items?.length || 0;
      const avgCost = data.avgCost || 0;
      const colorMap: Record<string, string> = { '黑色': '#333', '白色': '#f0f0f0', '红色': '#ff4d4f', '蓝色': '#1890ff', '绿色': '#52c41a', '黄色': '#faad14', '紫色': '#722ed1', '粉色': '#eb2f96', '橙色': '#fa8c16' };
      const bgColor = colorMap[color] || '#d9d9d9';
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: bgColor, border: '1px solid #d9d9d9', flexShrink: 0 }} />
          <Text strong style={{ fontSize: 12 }}>{title}</Text>
          <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>{count} 款</Tag>
          {avgCost > 0 && <Text style={{ fontSize: 10, color: '#8c8c8c' }}>均价 ¥{avgCost.toFixed(2)}</Text>}
        </div>
      );
    }
    if (type === 'variant') {
      const cost = bom ? calcBomCost(bom) : (Number(data.costPrice) || 0);
      const bomCount = (bom?.semiProducts?.length || 0) + (bom?.rawMaterials?.length || 0) + (bom?.processes?.length || 0);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
          {data.color && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: data.color === '黑色' ? '#333' : data.color === '白色' ? '#f0f0f0' : data.color === '红色' ? '#ff4d4f' : data.color === '蓝色' ? '#1890ff' : data.color === '绿色' ? '#52c41a' : '#d9d9d9', border: '1px solid #d9d9d9', flexShrink: 0 }} />}
          <Text style={{ fontSize: 12, fontWeight: 500 }}>{title}</Text>
          {cost > 0 && <Tag color="green" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>¥{cost.toFixed(2)}</Tag>}
          {bomCount > 0 && <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }} color="purple">{bomCount} BOM</Tag>}
        </div>
      );
    }
    // BOM 子节点
    const typeColors: Record<string, string> = { 'bom-semi': 'cyan', 'bom-raw': 'orange', 'bom-proc': 'geekblue' };
    const typeLabels: Record<string, string> = { 'bom-semi': '半成品', 'bom-raw': '原材料', 'bom-proc': '工序' };
    const subtotal = (Number(data.price) || 0) * (Number(data.qty) || 1);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
        <Tag color={typeColors[type]} style={{ margin: 0, fontSize: 10, lineHeight: '15px', padding: '0 3px' }}>{typeLabels[type]}</Tag>
        <Text style={{ fontSize: 11 }}>{title}</Text>
        {subtotal > 0 && <Text style={{ fontSize: 10, color: '#8c8c8c' }}>¥{subtotal.toFixed(2)}</Text>}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ExperimentOutlined style={{ fontSize: 20, color: PRIMARY }} />
          <Title level={5} style={{ margin: 0, color: PRIMARY }}>新款研发</Title>
          <Tag color="blue">{finishedProducts.length} 款</Tag>
          <Tag color="green">{styleGroups.length} 货号</Tag>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setBatchAddVisible(true)}>新增研发产品</Button>
          <Tooltip title="刷新数据"><Button icon={<ReloadOutlined />} onClick={loadProducts} /></Tooltip>
        </Space>
      </div>

      {/* 主内容区 */}
      <div ref={treePanelContainerRef} style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden', minHeight: 0 }}>
        {/* 左侧树形导图 */}
        <Card
          title={<span style={{ fontSize: 13 }}><AppstoreOutlined style={{ marginRight: 6 }} />研发产品树</span>}
          style={{ width: treePanelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          bodyStyle={{ padding: '8px 4px', flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
          size="small"
        >
          {/* 搜索筛选栏 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexShrink: 0, padding: '0 2px' }}>
            <Input
              size="small"
              placeholder="搜索货号/编码"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              allowClear
              value={treeSearchText}
              onChange={e => setTreeSearchText(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Select
              size="small"
              placeholder="状态"
              allowClear
              value={treeStatusFilter || undefined}
              onChange={v => setTreeStatusFilter(v || '')}
              style={{ width: 90, flexShrink: 0 }}
              options={[
                { label: '全部', value: '' },
                { label: '在售', value: '在售' },
                { label: '开发', value: '开发' },
                { label: '预售', value: '预售' },
                { label: '停产', value: '停产' },
                { label: '下架', value: '下架' },
              ]}
            />
          </div>
          {filteredTreeData.length === 0 ? (
            <Empty description={treeData.length === 0 ? '暂无研发产品，请点击「新增研发产品」' : '无匹配结果'} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
          ) : (
            <Tree
              treeData={filteredTreeData}
              selectedKeys={selectedKey ? [selectedKey] : []}
              onSelect={handleSelect}
              titleRender={titleRender}
              showLine
              blockNode
              style={{ fontSize: 12 }}
            />
          )}
          {/* 货号图片展示区 */}
          {selectedProduct && selectedProduct._isGroup && !selectedProduct._colorGroup && (() => {
            const variants = selectedProduct.variants || [];
            const localColorImages: { color: string; img: string }[] = [];
            const seenColors = new Set<string>();
            variants.forEach((v: any) => {
              if (seenColors.has(v.color)) return;
              seenColors.add(v.color);
              const img = prodImgCache[v.key];
              if (img) localColorImages.push({ color: v.color || '未分类', img });
            });
            if (localColorImages.length === 0) return null;
            return (
              <div style={{ marginTop: 12, padding: '8px', borderTop: '1px solid #f0f0f0' }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: '#8c8c8c' }}>货号图片</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {localColorImages.map((item, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <img src={item.img} alt={item.color} style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 4, border: '1px solid #eee', display: 'block', background: '#fafafa' }} />
                      <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>{item.color}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>

        {/* 可拖拽分隔线 */}
        <div
          onMouseDown={handleTreePanelDragStart}
          style={{
            width: 6,
            cursor: 'col-resize',
            background: '#f0f0f0',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s',
            position: 'relative',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#d9d9d9'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f0f0f0'; }}
        >
          <div style={{ width: 2, height: 32, background: '#bfbfbf', borderRadius: 1 }} />
        </div>

        {/* 右侧 BOM 编辑面板 */}
        <Card
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          bodyStyle={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
          size="small"
          title={selectedProduct ? (
            selectedProduct._isGroup ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>货号总览：{selectedProduct.styleCode}{selectedProduct._colorGroup ? ` > ${selectedProduct._colorGroup}` : ''}（{selectedProduct.variants?.length || 0} 款）</span>
                <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => handleOpenAddColor(selectedProduct.styleCode)}>添加颜色</Button>
                {selectedProduct._isGroup && (
                  <Button type="link" size="small" icon={<ApartmentOutlined />} onClick={() => {
                    // 回显已添加的 BOM：只加载所有目标变体中共同的BOM项（交集）
                    const variants = selectedProduct.variants || [];
                    const targets = selectedProduct._colorGroup
                      ? variants.filter((v: any) => (v.color || '') === selectedProduct._colorGroup)
                      : variants;
                    // 计算所有目标变体的BOM交集
                    const getBomForTarget = (t: any) => {
                      if (bomMap[t.key]) return bomMap[t.key];
                      try {
                        const raw = localStorage.getItem(getBomKey(t.key));
                        if (raw) return JSON.parse(raw);
                      } catch {}
                      return { semiProducts: [], rawMaterials: [], processes: [] };
                    };
                    if (targets.length > 0) {
                      const firstBom = getBomForTarget(targets[0]);
                      const commonSemi = (firstBom.semiProducts || []).filter((item: any) =>
                        targets.slice(1).every((t: any) => {
                          const bom = getBomForTarget(t);
                          return (bom.semiProducts || []).some((e: any) => e.key === item.key);
                        })
                      );
                      const commonRaw = (firstBom.rawMaterials || []).filter((item: any) =>
                        targets.slice(1).every((t: any) => {
                          const bom = getBomForTarget(t);
                          return (bom.rawMaterials || []).some((e: any) => e.key === item.key);
                        })
                      );
                      const commonProc = (firstBom.processes || []).filter((item: any) =>
                        targets.slice(1).every((t: any) => {
                          const bom = getBomForTarget(t);
                          return (bom.processes || []).some((e: any) => e.key === item.key);
                        })
                      );
                      setBomSemiProducts(commonSemi);
                      setBomRawMaterials(commonRaw);
                      setBomProcesses(commonProc);
                    } else {
                      setBomSemiProducts([]);
                      setBomRawMaterials([]);
                      setBomProcesses([]);
                    }
                    setBatchBomActiveTab('semi'); setBatchBomVisible(true);
                  }}>添加BOM</Button>
                )}
                {selectedProduct._isGroup && (
                  <Button type="link" size="small" icon={<FileTextOutlined />} onClick={handleOpenMaterialList}>物料清单</Button>
                )}
                {selectedProduct._isGroup && !selectedProduct._colorGroup && (
                  <Tooltip title="点击研发完成产品将转成在售状态">
                  <Button size="small" type="primary" icon={<CheckCircleOutlined />} style={{ background: '#52c41a', borderColor: '#52c41a' }}
                    onClick={() => handleRdComplete(selectedProduct.styleCode)}>研发完成</Button>
                </Tooltip>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectedProduct.color && (
                  <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: selectedProduct.color, border: '1px solid #d9d9d9' }} />
                )}
                <Text strong style={{ fontSize: 13 }}>{[selectedProduct.shortName || selectedProduct.name, selectedProduct.color, selectedProduct.spec].filter(Boolean).join('-')}</Text>
                <Tag color="blue" style={{ margin: 0 }}>{selectedProduct.productCode}</Tag>
                <Tag style={{ margin: 0 }}>层级 {selectedProduct.level || '0'}</Tag>
              </div>
            )
          ) : <span style={{ fontSize: 13, color: '#8c8c8c' }}>请在左侧选择产品</span>}
          extra={selectedProduct && !selectedProduct._isGroup && (
            <Space>
              <Tag color="green" style={{ margin: 0 }}><DollarOutlined /> 成本：¥{totalCost.toFixed(2)}</Tag>
              <Button size="small" icon={<FileTextOutlined />} onClick={handleOpenMaterialList}>物料清单</Button>
            </Space>
          )}
        >
          {!selectedProduct ? (
            <Empty description="请在左侧树中选择一个颜色子项进行 BOM 编辑" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 60 }} />
          ) : selectedProduct._isGroup ? (
            // 货号总览
            <div>
              {/* 图片展示 + 统计同行 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, padding: '6px 8px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                {/* 左侧：按颜色展示图片 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#595959' }}>产品图片</span>
                    <Space size={4}>
                      <Button size="small" icon={<CameraOutlined />} onClick={() => {
                        const variants = selectedProduct.variants || [];
                        const target = variants.find((v: any) => !prodImgCache[v.key]) || variants[0];
                        if (!target) return;
                        const img = prodImgCache[target.key] || '';
                        setVariantImgUploadKey(target.key); setVariantImgUploadCurrent(img); setVariantImgUploadFromGallery(true); setVariantImgUploadVisible(true);
                      }}>拍照</Button>
                      <Tooltip title="也可以直接 Ctrl+V 粘贴图片">
                        <Button size="small" icon={<CopyOutlined />} onClick={async () => {
                          const variants = selectedProduct.variants || [];
                          const target = variants.find((v: any) => !prodImgCache[v.key]) || variants[0];
                          if (!target) return;
                          try {
                            const items = await navigator.clipboard.read();
                            for (const item of items) {
                              const imgType = item.types.find(t => t.startsWith('image/'));
                              if (imgType) {
                                const blob = await item.getType(imgType);
                                const raw = await readFileAsDataURL(blob);
                                const dataUrl = await compressImage(raw);
                                const targetColor = target.color || '';
                                const sameColor = (selectedProduct.variants || []).filter((vv: any) => (vv.color || '') === targetColor);
                                const keys = sameColor.map((vv: any) => vv.key);
                                const { saved, failed } = await saveImageToKeys(keys, dataUrl);
                                setProdImgCache(prev => {
                                  const next = { ...prev };
                                  keys.forEach((k: string) => { if (saved > 0) next[k] = dataUrl; });
                                  return next;
                                });
                                setVariantImgUploadRefresh(prev => prev + 1);
                                if (saved > 0) {
                                  if (failed > 0) {
                                    message.warning(`图片仅粘贴到 ${saved}/${keys.length} 个规格`);
                                  } else {
                                    message.success(`图片已粘贴到 ${target.color || '未分类'}（${saved} 个规格）`);
                                  }
                                } else {
                                  message.error('图片保存失败');
                                }
                                return;
                              }
                            }
                            message.warning('剪贴板中没有图片');
                          } catch { message.info('无法读取剪贴板，请使用 Ctrl+V 粘贴'); }
                        }}>粘贴</Button>
                      </Tooltip>
                    </Space>
                  </div>
                  {selectedProduct._colorGroup ? (() => {
                    const firstKey = (selectedProduct.variants || [])[0]?.key || '';
                    if (!firstKey) return null;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {SIX_VIEWS.map(({ suffix, label }) => {
                          const cacheKey = `${firstKey}${suffix}`;
                          const img = prodImgCache[cacheKey] || '';
                          return (
                            <div key={suffix || 'front'} style={{ textAlign: 'center', position: 'relative' }}>
                              <div style={{ position: 'relative', width: 150, height: 150, overflow: 'hidden', border: img ? '1px solid #eee' : '1px dashed #d9d9d9', borderRadius: 4, background: '#fff' }}>
                                {img ? (
                                  <>
                                    <Image src={img} alt={label} width={150} height={150} style={{ objectFit: 'contain', display: 'block', background: '#fafafa' }} preview={{ src: img, imageRender: () => (<img src={img} alt={label} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }} />) }} />
                                    <Tooltip title="更换图片">
                                      <Button type="text" size="small" icon={<EditOutlined />}
                                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.85)', borderRadius: '50%', width: 24, height: 24, padding: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.2)', zIndex: 10 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setVariantImgUploadKey(firstKey);
                                          setVariantImgUploadSuffix(suffix);
                                          setVariantImgUploadCurrent(img);
                                          setVariantImgUploadFromGallery(false);
                                          setVariantImgUploadVisible(true);
                                        }} />
                                    </Tooltip>
                                  </>
                                ) : (
                                  <div style={{ width: 150, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                    onClick={() => {
                                      setVariantImgUploadKey(firstKey);
                                      setVariantImgUploadSuffix(suffix);
                                      setVariantImgUploadCurrent(img);
                                      setVariantImgUploadFromGallery(false);
                                      setVariantImgUploadVisible(true);
                                    }}>
                                    <PlusOutlined style={{ fontSize: 20, color: '#bfbfbf' }} />
                                  </div>
                                )}
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 11, textAlign: 'center', padding: '2px 0', lineHeight: '16px', zIndex: 5 }}>
                                  {label}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })() : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {colorImageMap.map(({ color, items, firstImg, firstKey }) => {
                        const colorMap: Record<string, string> = { '黑色': '#333', '白色': '#f0f0f0', '红色': '#ff4d4f', '蓝色': '#1890ff', '绿色': '#52c41a', '黄色': '#faad14', '紫色': '#722ed1', '粉色': '#eb2f96', '橙色': '#fa8c16' };
                        const dotColor = colorMap[color] || '#d9d9d9';
                        if (firstImg) {
                          return (
                            <div key={color} style={{ textAlign: 'center', position: 'relative' }}>
                              <div style={{ position: 'relative', width: 150, height: 150, overflow: 'hidden', border: '1px solid #eee', borderRadius: 4 }}>
                                <Image src={firstImg} alt={color} width={150} height={150} style={{ objectFit: 'contain', display: 'block', background: '#fafafa' }} preview={{ src: firstImg, imageRender: () => (<img src={firstImg} alt={color} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }} />) }}
                                  onError={(e) => { console.error('[gallery] img load failed, src length:', firstImg?.length); }} />
                                <Tooltip title="更换图片">
                                  <Button type="text" size="small" icon={<EditOutlined />}
                                    style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.85)', borderRadius: '50%', width: 24, height: 24, padding: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.2)', zIndex: 10 }}
                                    onClick={(e) => { e.stopPropagation(); setVariantImgUploadKey(firstKey); setVariantImgUploadCurrent(firstImg); setVariantImgUploadFromGallery(true); setVariantImgUploadVisible(true); }} />
                                </Tooltip>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor, border: '1px solid #d9d9d9', flexShrink: 0 }} />
                                <span style={{ fontSize: 10, color: '#8c8c8c' }}>{color}（{items.length}）</span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={color} style={{ textAlign: 'center', cursor: 'pointer' }}
                            onClick={() => { const target = items[0]; setVariantImgUploadKey(target.key); setVariantImgUploadCurrent(''); setVariantImgUploadFromGallery(true); setVariantImgUploadVisible(true); }}>
                            <div style={{ width: 150, height: 150, border: '1px dashed #d9d9d9', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                              <PlusOutlined style={{ fontSize: 20, color: '#bfbfbf' }} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor, border: '1px solid #d9d9d9', flexShrink: 0 }} />
                              <span style={{ fontSize: 10, color: '#8c8c8c' }}>{color}（{items.length}）</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  )}
                </div>
                {/* 右侧：统计卡片 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, minWidth: 130 }}>
                  <Card size="small" style={{ textAlign: 'right' }}><Statistic title="款式总数" value={selectedProduct.variants?.length || 0} suffix="款" valueStyle={{ fontSize: 18 }} /></Card>
                  <Card size="small" style={{ textAlign: 'right' }}><Statistic title="平均成本" value={selectedProduct.avgCost || 0} precision={2} prefix="¥" valueStyle={{ fontSize: 18, color: PRIMARY }} /></Card>
                </div>
              </div>
              <Table
                key={`variants-${variantImgUploadRefresh}`}
                bordered
                size="small"
                dataSource={selectedProduct.variants || []}
                rowKey="key"
                pagination={false}
                columns={[
                  { title: '图片', width: 60, render: (_: any, r: any) => {
                    const img = prodImgCache[r.key] || '';
                    if (img) {
                      return (
                        <div style={{ position: 'relative', width: 40, height: 40, cursor: 'pointer' }}
                          onClick={() => { setVariantImgUploadKey(r.key); setVariantImgUploadCurrent(img); setVariantImgUploadFromGallery(false); setVariantImgUploadVisible(true); }}>
                          <img src={img} alt="" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4, display: 'block', border: '1px solid #eee', background: '#fafafa' }}
                            onError={(e) => { console.error('[table] img load failed for key:', r.key, 'src length:', img?.length); (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', borderRadius: 4, display: 'none', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}
                            className="img-hover-overlay">
                            更换
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ width: 40, height: 40, border: '1px dashed #d9d9d9', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#fafafa' }}
                        onClick={() => { setVariantImgUploadKey(r.key); setVariantImgUploadCurrent(''); setVariantImgUploadFromGallery(false); setVariantImgUploadVisible(true); }}>
                        <PlusOutlined style={{ fontSize: 14, color: '#bfbfbf' }} />
                      </div>
                    );
                  } },
                  { title: '颜色', dataIndex: 'color', width: 80, render: (v: string) => v ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: v, border: '1px solid #d9d9d9' }} />{v}</div> : '—' },
                  { title: '规格', dataIndex: 'spec', width: 80 },
                  { title: '商品编码', dataIndex: 'productCode', width: 140 },
                  { title: '成本价', dataIndex: 'costPrice', width: 100, render: (_: any, r: any) => {
                    const subBom = loadBom(r.key);
                    const dynamicCost = calcBomCost(subBom);
                    const displayCost = dynamicCost > 0 ? dynamicCost : (Number(r.costPrice) || 0);
                    return `¥${displayCost.toFixed(2)}`;
                  } },
                  { title: 'BOM', width: 80, render: (_: any, r: any) => { const b = bomMap[r.key]; const c = b ? (b.semiProducts?.length || 0) + (b.rawMaterials?.length || 0) + (b.processes?.length || 0) : 0; return c > 0 ? <Tag color="purple">{c} 项</Tag> : <Tag>无</Tag>; }},
                  { title: '操作', width: 80, render: (_: any, r: any) => <Button type="link" size="small" onClick={() => { setSelectedProduct(r); setSelectedKey(r.key); const bom = bomMap[r.key] || { semiProducts: [], rawMaterials: [], processes: [] }; setBomSemiProducts(bom.semiProducts || []); setBomRawMaterials(bom.rawMaterials || []); setBomProcesses(bom.processes || []); }}>编辑 BOM</Button> },
                ]}
              />
            </div>
          ) : (
            // 变体 BOM 编辑面板
            <div style={{ flex: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedProduct.shortName || selectedProduct.name} - {selectedProduct.color} {selectedProduct.spec}</div>
                <Space>
                  <Button size="small" icon={<FileTextOutlined />} onClick={handleOpenMaterialList}>物料清单</Button>
                  <Button type="primary" size="small" onClick={() => { handleSaveBom(); message.success('BOM 已保存'); }}>保存 BOM</Button>
                </Space>
              </div>
              <Tabs
                activeKey={batchBomActiveTab}
                onChange={setBatchBomActiveTab}
                items={[
                  {
                    key: 'semi', label: `半成品 (${bomSemiProducts.length})`,
                    children: (
                      <div onContextMenu={e => e.preventDefault()}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => handleOpenBomSelect('semi')}>添加半成品</Button>
                          <Button size="small" icon={<SettingOutlined />} onClick={() => setBomFieldConfigVisible(true)}>字段</Button>
                        </div>
                        <Table
                          bordered size="small" rowKey="key"
                          dataSource={bomSemiProducts}
                          columns={bomColumns('semi')}
                          pagination={false}
                          scroll={{ y: 360 }}
                          rowClassName={() => 'bom-row'}
                          expandable={{
                            expandedRowKeys: Object.keys(batchExpandedBom),
                            expandedRowRender: (record: any) => {
                              const sub = batchExpandedBom[record.key];
                              if (!sub) return null;
                              return renderBatchExpandedItems(sub, 0, (category, itemKey) => handleDeleteBatchExpandedItem(record.key, category, itemKey));
                            },
                            expandIcon: () => null,
                            expandIconColumnIndex: -1,
                          }}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'raw', label: `原材料 (${bomRawMaterials.length})`,
                    children: (
                      <div onContextMenu={e => e.preventDefault()}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => handleOpenBomSelect('raw')}>添加原材料</Button>
                          <Button size="small" icon={<SettingOutlined />} onClick={() => setBomFieldConfigVisible(true)}>字段</Button>
                        </div>
                        <Table
                          bordered size="small" rowKey="key"
                          dataSource={bomRawMaterials}
                          columns={bomColumns('raw')}
                          pagination={false}
                          scroll={{ y: 360 }}
                          rowClassName={() => 'bom-row'}
                          expandable={{
                            expandedRowKeys: Object.keys(batchExpandedBom),
                            expandedRowRender: (record: any) => {
                              const sub = batchExpandedBom[record.key];
                              if (!sub) return null;
                              return renderBatchExpandedItems(sub, 0, (category, itemKey) => handleDeleteBatchExpandedItem(record.key, category, itemKey));
                            },
                            expandIcon: () => null,
                            expandIconColumnIndex: -1,
                          }}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'proc', label: `工序 (${bomProcesses.length})`,
                    children: (
                      <div onContextMenu={e => e.preventDefault()}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => handleOpenBomSelect('process')}>添加工序</Button>
                          <Button size="small" icon={<SettingOutlined />} onClick={() => setBomFieldConfigVisible(true)}>字段</Button>
                        </div>
                        <Table
                          bordered size="small" rowKey="key"
                          dataSource={sortProcs(bomProcesses)}
                          columns={bomColumns('process')}
                          pagination={false}
                          scroll={{ y: 360 }}
                          rowClassName={() => 'bom-row'}
                          expandable={{
                            expandedRowKeys: Object.keys(batchExpandedBom),
                            expandedRowRender: (record: any) => {
                              const sub = batchExpandedBom[record.key];
                              if (!sub) return null;
                              return renderBatchExpandedItems(sub, 0, (category, itemKey) => handleDeleteBatchExpandedItem(record.key, category, itemKey));
                            },
                            expandIcon: () => null,
                            expandIconColumnIndex: -1,
                          }}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </Card>
      </div>

      {/* 批量添加 BOM 弹窗 */}
      <Modal
        title={`批量添加 BOM${selectedProduct?._colorGroup ? ` — ${selectedProduct._colorGroup}` : ''}`}
        open={batchBomVisible}
        onCancel={() => { setBatchBomVisible(false); setBatchContextMenu(null); }}
        onOk={handleBatchBomConfirm}
        okText="应用到所有规格"
        width={1440}
        destroyOnClose
      >
        <div style={{ marginBottom: 8, padding: '6px 12px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6, fontSize: 12 }}>
          {selectedProduct?._colorGroup
            ? `将应用到「${selectedProduct._colorGroup}」的 ${(selectedProduct.variants || []).filter((v: any) => (v.color || '') === selectedProduct._colorGroup).length} 个规格`
            : `将应用到所有 ${(selectedProduct?.variants || []).length} 个规格`}
        </div>
        <Tabs
          activeKey={batchBomActiveTab}
          onChange={setBatchBomActiveTab}
          items={[
            {
              key: 'semi', label: `半成品 (${bomSemiProducts.length})`,
              children: (
                <div onContextMenu={e => e.preventDefault()}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => handleOpenBomSelect('semi')}>添加半成品</Button>
                    <Button size="small" icon={<SettingOutlined />} onClick={() => setBomFieldConfigVisible(true)}>字段</Button>
                  </div>
                  <Table bordered dataSource={bomSemiProducts} rowKey="key" size="small" pagination={false} scroll={{ y: 300 }}
                    columns={bomColumns('semi')}
                    expandable={{
                      expandedRowKeys: Object.keys(batchExpandedBom),
                      expandedRowRender: (record: any) => {
                        const sub = batchExpandedBom[record.key];
                        if (!sub) return null;
                        return renderBatchExpandedItems(sub, 0, (category, itemKey) => handleDeleteBatchExpandedItem(record.key, category, itemKey));
                      },
                      expandIcon: () => null,
                      expandIconColumnIndex: -1,
                    }}
                    onRow={(record) => ({
                      onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); setBatchContextMenu({ x: e.clientX, y: e.clientY, record }); },
                    })}
                    locale={{ emptyText: <Empty description="暂无半成品" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                </div>
              ),
            },
            {
              key: 'raw', label: `原材料 (${bomRawMaterials.length})`,
              children: (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => handleOpenBomSelect('raw')}>添加原材料</Button>
                    <Button size="small" icon={<SettingOutlined />} onClick={() => setRawFieldConfigVisible(true)}>字段</Button>
                  </div>
                  <Table bordered dataSource={bomRawMaterials} rowKey="key" size="small" pagination={false} scroll={{ y: 200 }} columns={bomColumns('raw')} locale={{ emptyText: <Empty description="暂无原材料" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                </div>
              ),
            },
            {
              key: 'proc', label: `工序 (${bomProcesses.length})`,
              children: (
                <div>
                  <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => handleOpenBomSelect('process')} style={{ marginBottom: 8 }}>添加工序</Button>
                  <Table bordered dataSource={sortProcs(bomProcesses)} rowKey="key" size="small" pagination={false} scroll={{ y: 200 }} columns={bomColumns('process')} locale={{ emptyText: <Empty description="暂无工序" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                </div>
              ),
            },
          ]}
        />
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Text strong>成本合计：¥{totalCost.toFixed(2)}</Text>
        </div>
      </Modal>

      {/* 子BOM编辑弹窗栈：复用批量添加BOM组件布局，每层位置错开以区分上下层弹窗，操作列可继续下钻 */}
      {subBomEditorStack.map((lv, idx) => {
        const setters = {
          semi: (fn: any) => setSubBomEditorStack(prev => prev.map((l, i) => i === idx ? { ...l, semi: fn(l.semi) } : l)),
          raw: (fn: any) => setSubBomEditorStack(prev => prev.map((l, i) => i === idx ? { ...l, raw: fn(l.raw) } : l)),
          process: (fn: any) => setSubBomEditorStack(prev => prev.map((l, i) => i === idx ? { ...l, proc: fn(l.proc) } : l)),
        };
        const opCol = {
          title: '操作', width: 200, align: 'center' as const,
          render: (_: any, record: any) => (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <Button size="small" type="link" icon={<ApartmentOutlined />} onClick={() => handlePushSubBomEditor(record)}>添加BOM</Button>
              <Button size="small" type="link" icon={(lv.expanded || {})[record.key] ? <MinusSquareOutlined /> : <PlusSquareOutlined />} onClick={() => {
                setSubBomEditorStack(prev => prev.map((l, i) => {
                  if (i !== idx) return l;
                  const expanded = { ...(l.expanded || {}) } as Record<string, any>;
                  if (expanded[record.key]) {
                    delete expanded[record.key];
                  } else {
                    let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
                    try { const raw = localStorage.getItem(getBomKey(record.key)); if (raw) bom = JSON.parse(raw); } catch {}
                    expanded[record.key] = bom;
                  }
                  return { ...l, expanded };
                }));
              }}>{(lv.expanded || {})[record.key] ? '收起' : '展开'}</Button>
              <Popconfirm
                title="确认删除"
                description={`确定要删除「${record.name || ''}」吗？`}
                onConfirm={() => {
                  setSubBomEditorStack(prev => prev.map((l, i) => {
                    if (i !== idx) return l;
                    return {
                      ...l,
                      semi: (l.semi || []).filter((it: any) => it.key !== record.key),
                      raw: (l.raw || []).filter((it: any) => it.key !== record.key),
                      proc: (l.proc || []).filter((it: any) => it.key !== record.key),
                    };
                  }));
                  message.success(`已删除「${record.name || ''}」`);
                }}
                okText="确定"
                cancelText="取消"
                okType="danger"
              >
                <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </div>
          ),
        };
        const deleteExpandedItem = (parentKey: string, category: string, itemKey: string) => {
          setSubBomEditorStack(prev => prev.map((l, i) => {
            if (i !== idx) return l;
            const sub = (l.expanded || {})[parentKey];
            if (!sub) return l;
            const next = {
              semiProducts: (sub.semiProducts || []).filter((it: any) => !(category === '半成品' && it.key === itemKey)),
              rawMaterials: (sub.rawMaterials || []).filter((it: any) => !(category === '原材料' && it.key === itemKey)),
              processes: (sub.processes || []).filter((it: any) => !(category === '工序' && it.key === itemKey)),
            };
            try { localStorage.setItem(getBomKey(parentKey), JSON.stringify(next)); } catch {}
            return { ...l, expanded: { ...(l.expanded || {}), [parentKey]: next } };
          }));
          message.success('已删除');
        };
        // 切换嵌套展开（使用顶层状态，按栈层级索引）
        const toggleNestedExpand = (itemKey: string) => {
          setSubBomNestedExpanded(prev => {
            const levelState = prev[idx] || {};
            if (levelState[itemKey]) {
              const { [itemKey]: _, ...rest } = levelState;
              return { ...prev, [idx]: rest };
            }
            // 加载子BOM数据
            let bom = { semiProducts: [] as any[], rawMaterials: [] as any[], processes: [] as any[] };
            try {
              const raw = localStorage.getItem(getBomKey(itemKey));
              if (raw) bom = JSON.parse(raw);
            } catch {}
            return { ...prev, [idx]: { ...levelState, [itemKey]: bom } };
          });
        };
        // 递归渲染展开的子BOM项（支持多级嵌套）
        const renderExpandedItems = (items: { item: any; category: string }[], depth: number = 0) => {
          // 每层展开内容向右缩进33个中文字的距离
          const indentEm = depth * 33;
          const levelNested = subBomNestedExpanded[idx] || {};
          return items.map(({ item, category }, i2) => {
            const isSemi = category === '半成品';
            const hasSubBom = isSemi && levelNested[item.key];
            const subBomData = hasSubBom ? levelNested[item.key] : null;
            return (
              <div key={item.key || i2}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px', fontSize: 12, borderLeft: '3px solid #e6f7ff', marginLeft: depth === 0 ? 8 : `calc(8px + ${indentEm}em)` }}>
                  {isSemi && (
                    <Button
                      size="small"
                      type="link"
                      icon={hasSubBom ? <MinusSquareOutlined /> : <PlusSquareOutlined />}
                      onClick={() => toggleNestedExpand(item.key)}
                      style={{ padding: '0 4px', minWidth: 'auto' }}
                    />
                  )}
                  <Tag color={category === '半成品' ? 'blue' : category === '原材料' ? 'green' : 'orange'} style={{ margin: 0, fontSize: 11 }}>{category}</Tag>
                  <span style={{ fontWeight: 500 }}>{item.name || '—'}</span>
                  <span style={{ color: '#888' }}>{item.code || ''}</span>
                  {item.level && <Tag color="cyan" style={{ margin: 0, fontSize: 10 }}>L{item.level}</Tag>}
                  {(() => {
                    const effectivePrice = isSemi ? getSemiEffectivePrice(item) : (Number(item.price) || 0);
                    return (
                      <>
                        <span style={{ color: '#666' }}>¥{effectivePrice.toFixed(2)} × {Number(item.qty) || 1}</span>
                        <span style={{ color: '#389e0d', fontWeight: 500 }}>= ¥{(effectivePrice * (Number(item.qty) || 1)).toFixed(2)}</span>
                      </>
                    );
                  })()}
                  <Button size="small" type="link" danger icon={<DeleteOutlined />} style={{ marginLeft: 'auto' }} onClick={() => deleteExpandedItem(item.key, category, item.key)}>删除</Button>
                </div>
                {hasSubBom && subBomData && (() => {
                  const subItems: { item: any; category: string }[] = [
                    ...(subBomData.semiProducts || []).map((i: any) => ({ item: i, category: '半成品' })),
                    ...(subBomData.rawMaterials || []).map((i: any) => ({ item: i, category: '原材料' })),
                    ...sortProcs(subBomData.processes || []).map((i: any) => ({ item: i, category: '工序' })),
                  ];
                  return subItems.length > 0 ? renderExpandedItems(subItems, depth + 1) : null;
                })()}
              </div>
            );
          });
        };
        const expandableCfg = {
          expandedRowKeys: Object.keys(lv.expanded || {}),
          expandedRowRender: (record: any) => {
            const sub = (lv.expanded || {})[record.key];
            if (!sub) return null;
            const allItems: { item: any; category: string }[] = [
              ...(sub.semiProducts || []).map((i: any) => ({ item: i, category: '半成品' })),
              ...(sub.rawMaterials || []).map((i: any) => ({ item: i, category: '原材料' })),
              ...sortProcs(sub.processes || []).map((i: any) => ({ item: i, category: '工序' })),
            ];
            if (allItems.length === 0) return <div style={{ padding: '8px 0', color: '#999', fontSize: 12 }}>暂无子BOM明细，点击"添加BOM"开始添加</div>;
            return (
              <div style={{ padding: '4px 0' }}>
                {renderExpandedItems(allItems, 0)}
              </div>
            );
          },
          expandIcon: () => null,
          expandIconColumnIndex: -1,
        };
        return (
          <Modal
            key={`${lv.target?.key || ''}-${idx}`}
            title={`添加 BOM — ${lv.target?.name || ''}`}
            open
            onCancel={() => setSubBomEditorStack(prev => prev.slice(0, idx))}
            onOk={handleSubBomEditorSave}
            okText="保存 BOM"
            cancelText="取消"
            width={1200}
            zIndex={1050 + idx * 5}
            style={{ top: 150 + idx * 36, transform: `translateX(${110 + idx * 50}px)` }}
            destroyOnClose
          >
            <div style={{ marginBottom: 8, padding: '6px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, fontSize: 12 }}>
              正在编辑「{lv.target?.name || ''}」{lv.target?.code ? `(${lv.target.code})` : ''} 的子BOM，保存后写入该{String(lv.target?.code || '').startsWith('RAW-') ? '原材料' : '半成品'}的物料清单{String(lv.target?.code || '').startsWith('RAW-') ? '，原材料仅可添加工序' : '；操作列“添加BOM”可继续下钻编辑下级物料'}
            </div>
            <Tabs
              activeKey={lv.tab}
              onChange={v => setSubBomEditorStack(prev => prev.map((l, i) => i === idx ? { ...l, tab: v } : l))}
              items={(() => {
                const isRawTarget = String(lv.target?.code || '').startsWith('RAW-');
                const allTabs = [
                  {
                    key: 'semi', label: `半成品 (${(lv.semi || []).length})`,
                    children: (
                      <div>
                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setBatchSubBomTarget(lv.target); handleOpenBomSelect('semi'); }} style={{ marginBottom: 8 }}>添加半成品</Button>
                        <Table bordered dataSource={lv.semi || []} rowKey="key" size="small" pagination={false} scroll={{ y: 260 }}
                          columns={bomColumns('semi', setters, opCol)}
                          expandable={expandableCfg}
                          locale={{ emptyText: <Empty description="暂无半成品" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                      </div>
                    ),
                  },
                  {
                    key: 'raw', label: `原材料 (${(lv.raw || []).length})`,
                    children: (
                      <div>
                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setBatchSubBomTarget(lv.target); handleOpenBomSelect('raw'); }} style={{ marginBottom: 8 }}>添加原材料</Button>
                        <Table bordered dataSource={lv.raw || []} rowKey="key" size="small" pagination={false} scroll={{ y: 220 }}
                          columns={bomColumns('raw', setters, opCol)}
                          expandable={expandableCfg}
                          locale={{ emptyText: <Empty description="暂无原材料" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                      </div>
                    ),
                  },
                  {
                    key: 'proc', label: `工序 (${(lv.proc || []).length})`,
                    children: (
                      <div>
                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setBatchSubBomTarget(lv.target); handleOpenBomSelect('process'); }} style={{ marginBottom: 8 }}>添加工序</Button>
                        <Table bordered dataSource={sortProcs(lv.proc || [])} rowKey="key" size="small" pagination={false} scroll={{ y: 220 }}
                          columns={bomColumns('process', setters, opCol)}
                          expandable={expandableCfg}
                          locale={{ emptyText: <Empty description="暂无工序" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                      </div>
                    ),
                  },
                ];
                // 原材料只允许添加工艺，隐藏半成品和原材料标签页
                return isRawTarget ? allTabs.filter(t => t.key === 'proc') : allTabs;
              })()}
            />
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <Text strong>成本合计：¥{calcSubBomLevelCost(lv).toFixed(2)}</Text>
            </div>
          </Modal>
        );
      })}

      {/* 批量BOM右键菜单 */}
      {batchContextMenu && (
        <div
          style={{ position: 'fixed', left: batchContextMenu.x, top: batchContextMenu.y, zIndex: 9999, background: '#fff', border: '1px solid #d9d9d9', borderRadius: 6, boxShadow: '0 3px 12px rgba(0,0,0,0.15)', padding: '4px 0', minWidth: 150 }}
          onClick={() => setBatchContextMenu(null)}
          onMouseLeave={() => setBatchContextMenu(null)}
        >
          <div style={{ padding: '4px 12px', fontSize: 12, color: '#999', borderBottom: '1px solid #f0f0f0', marginBottom: 2 }}>{batchContextMenu.record.name}</div>
          <div style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }} onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')} onClick={() => handleOpenSubBom(batchContextMenu.record, 'semi')}>
            <ApartmentOutlined style={{ marginRight: 8, color: '#1890ff' }} />添加半成品
          </div>
          <div style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }} onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')} onClick={() => handleOpenSubBom(batchContextMenu.record, 'raw')}>
            <DatabaseOutlined style={{ marginRight: 8, color: '#52c41a' }} />添加原材料
          </div>
          <div style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }} onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')} onClick={() => handleOpenSubBom(batchContextMenu.record, 'process')}>
            <ToolOutlined style={{ marginRight: 8, color: '#fa8c16' }} />添加工序
          </div>
        </div>
      )}

      {/* BOM 选择弹窗 */}
      <Modal
        title={`${batchSubBomTarget ? `为「${batchSubBomTarget.name}」` : newSemiBomMode ? '为新半成品' : ''}选择${bomSelectType === 'semi' ? '半成品' : bomSelectType === 'raw' ? '原材料' : '工序'}`}
        open={bomSelectVisible}
        onOk={handleConfirmBomSelect}
        onCancel={() => { setBomSelectVisible(false); setBatchSubBomTarget(null); setNewSemiBomMode(false); }}
        okText={`添加 (${bomSelectKeys.length})`}
        width={1000}
        zIndex={newSemiBomMode ? 1300 : 1100}
        destroyOnClose
      >
        {/* 子BOM/新半成品模式：类型切换按钮 */}
        {(batchSubBomTarget || newSemiBomMode) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <Button size="small" type={bomSelectType === 'semi' ? 'primary' : 'default'} icon={<ApartmentOutlined />} onClick={() => handleOpenBomSelect('semi')}>半成品</Button>
            <Button size="small" type={bomSelectType === 'raw' ? 'primary' : 'default'} icon={<DatabaseOutlined />} onClick={() => handleOpenBomSelect('raw')}>原材料</Button>
            <Button size="small" type={bomSelectType === 'process' ? 'primary' : 'default'} icon={<ToolOutlined />} onClick={() => handleOpenBomSelect('process')}>工序</Button>
          </div>
        )}
        {/* 工具栏：搜索 + 新增按钮 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          {bomSelectType !== 'process' && (
            <Select size="small" value={bomSelectField} onChange={v => setBomSelectField(v)} style={{ width: 90, flexShrink: 0 }}>
              <Select.Option value="name">名称</Select.Option>
              <Select.Option value="code">编码</Select.Option>
              <Select.Option value="color">颜色</Select.Option>
              <Select.Option value="spec">规格</Select.Option>
              <Select.Option value="level">层级</Select.Option>
            </Select>
          )}
          {bomSelectType === 'process' && (
            <Select size="small" value={bomSelectField} onChange={v => setBomSelectField(v)} style={{ width: 90, flexShrink: 0 }}>
              <Select.Option value="name">名称</Select.Option>
              <Select.Option value="code">编码</Select.Option>
            </Select>
          )}
          <Input
            size="small"
            prefix={<SearchOutlined />}
            placeholder="输入关键词搜索..."
            value={bomSelectSearch}
            onChange={e => setBomSelectSearch(e.target.value)}
            onPressEnter={handleBomSelectSearch}
            style={{ flex: 1 }}
            allowClear
          />
          <Button size="small" type="primary" icon={<SearchOutlined />} onClick={handleBomSelectSearch}>查询</Button>
          {bomSelectType === 'semi' && !newSemiBomMode && (
            <Button size="small" icon={<PlusOutlined />} onClick={() => {
              setNewSemiName(''); setNewSemiCode(''); setNewSemiPrice(undefined); setNewSemiUnit('件');
              // 自动计算BOM层级：子BOM编辑器中取父级+1，否则默认1级
              const _autoLevel = subBomEditorStack.length > 0 ? String((Number(subBomEditorStack[subBomEditorStack.length - 1].target?.level) || subBomEditorStack.length) + 1) : (batchSubBomTarget ? String((Number(batchSubBomTarget.level) || 1) + 1) : '1');
              setNewSemiStyleCode(''); setNewSemiLevel(_autoLevel); setNewSemiBomItems([]);
              setSemiEditKey(null); setNewSemiImage('');
              setNewSemiVisible(true);
            }}>新增半成品</Button>
          )}
          {bomSelectType === 'semi' && !newSemiBomMode && (
            <Tooltip title="复制勾选的半成品快速创建新半成品（含图片与物料清单），创建后弹窗编辑修改不同处">
              <Button size="small" icon={<CopyOutlined />} disabled={bomSelectKeys.length === 0} onClick={handleCopyCreateSemi}>复制并创建{bomSelectKeys.length > 0 ? `(${bomSelectKeys.length})` : ''}</Button>
            </Tooltip>
          )}
          {bomSelectType === 'raw' && (
            <Button size="small" icon={<PlusOutlined />} onClick={() => {
              setBomRawBatchVisible(true);
            }}>新增原材料</Button>
          )}
          {bomSelectType === 'process' && (
            <Button size="small" icon={<PlusOutlined />} onClick={() => {
              setNewProcId(''); setNewProcName(''); setNewProcType(undefined); setNewProcLaborPrice(undefined);
              setNewProcTimeQuota(undefined); setNewProcSetupTime(undefined); setNewProcEquipment('');
              setNewProcStatus(undefined); setNewProcPerson(undefined); setNewProcRemark('');
              setNewProcVisible(true);
            }}>新增工序</Button>
          )}
        </div>
        <Table
          bordered
          size="small"
          rowKey="key"
          dataSource={bomSelectData.filter((d: any) => {
            if (!bomSelectAppliedSearch.trim()) return true;
            const q = bomSelectAppliedSearch.toLowerCase();
            const field = bomSelectAppliedField;
            if (field === 'name') {
              return (d.shortName || d.name || d.processName || '').toLowerCase().includes(q);
            } else if (field === 'code') {
              return (d.productCode || d.processCode || d.code || '').toLowerCase().includes(q);
            } else if (field === 'color') {
              return (d.color || '').toLowerCase().includes(q);
            } else if (field === 'spec') {
              return (d.spec || '').toLowerCase().includes(q);
            } else if (field === 'level') {
              return String(d.level || '').includes(q);
            }
            return true;
          })}
          columns={bomSelectType === 'process' ? [
            { title: '工序名称', dataIndex: 'processName', render: (v: any, r: any) => v || r.name || '—' },
            { title: '工序编号', dataIndex: 'processCode', render: (v: any, r: any) => v || r.id || r.code || '—' },
            { title: '价格', dataIndex: 'price', width: 100, render: (v: any) => `¥${(Number(v) || 0).toFixed(2)}` },
          ] : [
            { title: '名称', dataIndex: 'shortName', render: (v: any, r: any) => v || r.name || '—' },
            { title: '编码', dataIndex: 'productCode', width: 120 },
            { title: '颜色', dataIndex: 'color', width: 80, render: (v: string) => v || '—' },
            { title: '规格', dataIndex: 'spec', width: 80, render: (v: string) => v || '—' },
            { title: '层级', dataIndex: 'level', width: 60, align: 'center' as const, render: (v: any) => v ? <Tag color="blue">{v}</Tag> : '—' },
            { title: '成本价', dataIndex: 'costPrice', width: 90, render: (v: any, r: any) => {
              // 半成品优先从子BOM计算成本价
              let price = Number(v) || 0;
              if (bomSelectType === 'semi') {
                const subBom = loadBom(r.key);
                const calc = (items: any[]) => items.reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
                const bomCost = calc(subBom.semiProducts || []) + calc(subBom.rawMaterials || []) + calc(subBom.processes || []);
                if (bomCost > 0) price = bomCost;
              }
              return `¥${price.toFixed(2)}`;
            } },
            { title: '操作', width: 70, align: 'center' as const, render: (_: any, r: any) => <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openSemiEditForm(r)}>编辑</Button> },
          ]}
          rowSelection={{
            selectedRowKeys: bomSelectKeys,
            onChange: (keys) => setBomSelectKeys(keys),
          }}
          scroll={{ y: 360 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
        />
      </Modal>

      {/* 新增半成品弹窗（布局参考设计图：商品简称/款式编码/商品编码 + 层级/添加BOM + 物料清单） */}
      <Modal
        title={semiEditKey ? '编辑半成品' : '新增半成品'}
        open={newSemiVisible}
        onOk={handleConfirmNewSemi}
        onCancel={() => { setSemiEditKey(null); setNewSemiVisible(false); setNewSemiBomItems([]); setNewSemiImage(''); setNewSemiMoldNumber(''); }}
        okText={semiEditKey ? '保存修改' : '创建'}
        cancelText="取消"
        width={960}
        zIndex={1200}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {semiEditKey && (
            <div style={{ padding: '6px 12px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6, fontSize: 12 }}>
              正在编辑半成品：修改不同处后点击“保存修改”覆盖保存（含图片与物料清单）
            </div>
          )}
          {/* 第一行：商品简称 / 款式编码 / 商品编码 */}
          <Row gutter={12}>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>商品简称 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input size="small" placeholder="商品简称" value={newSemiName} onChange={e => setNewSemiName(e.target.value)} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>款式编码 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input size="small" placeholder="款式编码" value={newSemiStyleCode} onChange={e => setNewSemiStyleCode(e.target.value)} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>商品编码 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Space.Compact style={{ width: '100%' }}>
                <Input size="small" placeholder="请输入商品编码" value={newSemiCode} onChange={e => setNewSemiCode(e.target.value)} style={{ flex: 1 }} />
                <Tooltip title="随机生成唯一编码">
                  <Button size="small" icon={<ReloadOutlined />} onClick={generateRandomSemiCode} />
                </Tooltip>
              </Space.Compact>
            </Col>
          </Row>
          {/* 第二行：层级 / 单位 / 成本价 / 添加BOM */}
          <Row gutter={12} align="bottom">
            <Col span={6}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>层级</div>
              <Input size="small" placeholder="如：1" value={newSemiLevel} onChange={e => setNewSemiLevel(e.target.value)} />
            </Col>
            <Col span={4}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>单位</div>
              <Select size="small" value={newSemiUnit} onChange={v => setNewSemiUnit(v)} style={{ width: '100%' }}>
                <Select.Option value="件">件</Select.Option>
                <Select.Option value="米">米</Select.Option>
                <Select.Option value="个">个</Select.Option>
                <Select.Option value="双">双</Select.Option>
              </Select>
            </Col>
            <Col span={6}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>成本价</div>
              <InputNumber size="small" placeholder="成本价" value={newSemiPrice} onChange={v => setNewSemiPrice(v ?? undefined)} min={0} step={0.01} style={{ width: '100%' }} />
            </Col>
            <Col span={8} style={{ textAlign: 'right' }}>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setNewSemiBomMode(true); handleOpenBomSelect('semi'); }}>添加BOM</Button>
            </Col>
          </Row>
          {/* 模具编号 */}
          <Row gutter={12}>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>模具编号</div>
              <Input size="small" placeholder="点击选择模具" value={newSemiMoldNumber} readOnly
                onClick={() => setNewSemiMoldPickerVisible(true)} style={{ cursor: 'pointer' }} />
            </Col>
          </Row>
          {/* 图片上传（点击/粘贴/拍照） */}
          <Row gutter={12}>
            <Col span={24}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>图片（点击/粘贴/拍照）</div>
              {renderBomImgUpload(newSemiImage, setNewSemiImage, 'semi')}
            </Col>
          </Row>
          {/* 物料清单区域 */}
          <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, padding: 10, minHeight: 240, background: '#fafafa' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#1a2b45' }}>物料清单</div>
            <Table
              bordered
              size="small"
              rowKey={(r: any) => `${r.type}-${r.key}`}
              dataSource={newSemiBomItems}
              pagination={false}
              scroll={{ y: 200 }}
              columns={[
                { title: '名称', dataIndex: 'name', render: (v: string) => v || '—' },
                { title: '编码', dataIndex: 'code', width: 100, render: (v: string) => v || '—' },
                { title: '类型', dataIndex: 'type', width: 70, align: 'center' as const, render: (t: string) => <Tag color={t === 'semi' ? 'blue' : t === 'raw' ? 'green' : 'orange'}>{t === 'semi' ? '半成品' : t === 'raw' ? '原材料' : '工序'}</Tag> },
                { title: '层级', dataIndex: 'level', width: 50, align: 'center' as const, render: (v: any) => v || '—' },
                { title: '单价', dataIndex: 'price', width: 80, render: (v: any) => `¥${(Number(v) || 0).toFixed(2)}` },
                { title: '单位/生产数量', dataIndex: 'perMeterQty', width: 110, render: (v: any, r: any, idx: number) => (
                  <InputNumber size="small" min={0} step={0.1} precision={5} value={v || undefined} style={{ width: 90 }} placeholder="选填"
                    onChange={val => {
                      const perMeter = val || 0;
                      const newQty = perMeter > 0 ? 1 / perMeter : (Number(r.qty) || 1);
                      setNewSemiBomItems(prev => prev.map((item, i) => i === idx ? { ...item, perMeterQty: perMeter, qty: perMeter > 0 ? newQty : (item.qty || 1) } : item));
                    }} />
                ) },
                { title: '数量', dataIndex: 'qty', width: 90, render: (v: any, _: any, idx: number) => (
                  <InputNumber size="small" min={0.00001} step={0.1} precision={5} value={v || 1} style={{ width: 75 }}
                    onChange={val => setNewSemiBomItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: val || 1 } : item))} />
                ) },
                { title: '小计', width: 80, render: (_: any, r: any) => `¥${((Number(r.price) || 0) * (Number(r.qty) || 1)).toFixed(2)}` },
                { title: '操作', width: 100, align: 'center' as const, render: (_: any, r: any, idx: number) => (
                  <Space size="small">
                    {(r.type === 'semi' || r.type === 'raw') && (
                      <Tooltip title="添加工序">
                        <Button size="small" type="link" icon={<ToolOutlined />} style={{ color: '#fa8c16', padding: '0 4px' }}
                          onClick={() => { setNewSemiBomMode(true); handleOpenBomSelect('process'); }} />
                      </Tooltip>
                    )}
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setNewSemiBomItems(prev => prev.filter((_, i) => i !== idx))} />
                  </Space>
                ) },
              ]}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'暂无物料，点击“添加BOM”按钮添加'} /> }}
            />
          </div>
        </div>
      </Modal>

      {/* 新增原材料弹窗（布局参考设计图：商品简称/款式编码/商品编码 + 供应商/单位/采购价） */}
      <Modal
        title="新增原材料"
        open={newRawVisible}
        onOk={handleConfirmNewRaw}
        onCancel={() => { setNewRawVisible(false); setNewRawMoldNumber(''); }}
        okText="创建"
        cancelText="取消"
        width={760}
        zIndex={newSemiBomMode ? 1400 : 1200}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row gutter={12}>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>商品简称 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input size="small" placeholder="商品简称" value={newRawName} onChange={e => setNewRawName(e.target.value)} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>款式编码 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Space.Compact style={{ width: '100%' }}>
                <Input size="small" placeholder="款式编码" value={newRawStyleCode} onChange={e => setNewRawStyleCode(e.target.value)} style={{ flex: 1 }} />
                <Tooltip title="随机生成款式编码">
                  <Button size="small" icon={<ReloadOutlined />} onClick={generateRandomRawStyleCode} />
                </Tooltip>
              </Space.Compact>
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>商品编码 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Space.Compact style={{ width: '100%' }}>
                <Input size="small" placeholder="留空自动生成" value={newRawCode} onChange={e => setNewRawCode(e.target.value)} style={{ flex: 1 }} />
                <Tooltip title="随机生成唯一编码">
                  <Button size="small" icon={<ReloadOutlined />} onClick={generateRandomRawCode} />
                </Tooltip>
              </Space.Compact>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>供应商 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input size="small" placeholder="点击选择供应商" value={newRawSupplier} readOnly
                style={{ cursor: 'pointer' }}
                onClick={() => { setRawSupplierPickSearch(''); setRawSupplierPickVisible(true); }} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>单位 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <Input size="small" placeholder="如：米/件/个" value={newRawUnit} onChange={e => setNewRawUnit(e.target.value)} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>采购价 <span style={{ color: '#ff4d4f' }}>*</span></div>
              <InputNumber size="small" placeholder="采购价（即成本价）" value={newRawPrice} onChange={v => setNewRawPrice(v ?? undefined)} min={0} step={0.01} style={{ width: '100%' }} />
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>颜色</div>
              <Input size="small" placeholder="如：黑色/白色" value={newRawColor} onChange={e => setNewRawColor(e.target.value)} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>规格</div>
              <Input size="small" placeholder="如：1.4mm/50m卷" value={newRawSpec} onChange={e => setNewRawSpec(e.target.value)} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>模具编号</div>
              <Input size="small" placeholder="点击选择模具" value={newRawMoldNumber} readOnly
                onClick={() => setNewRawMoldPickerVisible(true)} style={{ cursor: 'pointer' }} />
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={24}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>图片（点击/粘贴/拍照）</div>
              {renderBomImgUpload(newRawImage, setNewRawImage, 'raw')}
            </Col>
          </Row>
        </div>
      </Modal>

      {/* 供应商选择弹窗（采购平台供应商列表） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><SearchOutlined style={{ marginRight: 8 }} />选择供应商（采购平台供应商列表）</span>}
        open={rawSupplierPickVisible}
        onCancel={() => setRawSupplierPickVisible(false)}
        footer={[<Button key="close" onClick={() => setRawSupplierPickVisible(false)}>关闭</Button>]}
        width={640}
        zIndex={newSemiBomMode ? 1500 : 1300}
        destroyOnClose
      >
        <Input.Search
          placeholder="搜索供应商名称/简称"
          allowClear
          value={rawSupplierPickSearch}
          onChange={e => setRawSupplierPickSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {supplierOptions.length === 0 ? (
          <Empty description="采购平台暂无供应商，请先通过下方按钮新增" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            bordered
            pagination={{ pageSize: 8, size: 'small' }}
            dataSource={supplierOptions.filter(s => {
              const q = rawSupplierPickSearch.trim();
              return !q || (s.supplierName || '').includes(q) || (s.shortName || '').includes(q);
            })}
            columns={[
              { title: '供应商名称', dataIndex: 'supplierName', key: 'supplierName' },
              { title: '简称', dataIndex: 'shortName', key: 'shortName', width: 120, render: (v: string) => v || '—' },
              {
                title: '操作', key: 'op', width: 80, render: (_: any, s: any) => (
                  <Button size="small" type="primary" onClick={() => {
                    setNewRawSupplier(s.supplierName);
                    setRawSupplierPickVisible(false);
                  }}>选择</Button>
                ),
              },
            ]}
            onRow={(s: any) => ({
              style: { cursor: 'pointer' },
              onClick: () => {
                setNewRawSupplier(s.supplierName);
                setRawSupplierPickVisible(false);
              },
            })}
          />
        )}
        <Divider style={{ margin: '8px 0 4px' }} />
        <div style={{ textAlign: 'center' }}>
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => { setQuickAddSupplierVisible(true); quickAddSupplierForm.resetFields(); }}>
            快速新增供应商
          </Button>
        </div>
      </Modal>

      {/* 新增供应商弹窗 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><PlusOutlined style={{ marginRight: 8 }} />新增供应商</span>}
        open={quickAddSupplierVisible}
        onCancel={() => { setQuickAddSupplierVisible(false); quickAddSupplierForm.resetFields(); }}
        onOk={() => {
          quickAddSupplierForm.validateFields().then(values => {
            const dataOwner = getDataOwner();
            const supplierKey = 'purchaser_suppliers_' + dataOwner;
            const now = new Date();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            const newSupplier: any = {
              id: `SP-${Date.now()}`,
              supplierName: values.supplierName.trim(),
              shortName: values.shortName?.trim() || '',
              contactPerson: values.contactPerson || '',
              contactPhone: values.contactPhone || '',
              email: values.email || '',
              province: values.province || '',
              city: values.city || '',
              district: values.district || '',
              address: values.address || '',
              cooperationStatus: 'pending',
              addedDate: dateStr,
              remark: values.remark || '',
            };
            try {
              const current = JSON.parse(localStorage.getItem(supplierKey) || '[]');
              localStorage.setItem(supplierKey, JSON.stringify([newSupplier, ...current]));
              const token = Array.from({ length: 32 }, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('');
              const username = localStorage.getItem('username') || 'admin';
              const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
              const currentUser = users.find((u: any) => u.username === username);
              const cooperationTokens: any[] = JSON.parse(localStorage.getItem('cooperation_tokens') || '[]');
              cooperationTokens.push({
                token,
                purchaserName: username,
                purchaserCompany: currentUser?.companyName || username,
                purchaserContact: currentUser?.contactPerson || '',
                purchaserPhone: currentUser?.phone || '',
                supplierName: values.supplierName.trim(),
                supplierId: newSupplier.id,
                purchaserSupplierEntryId: newSupplier.id,
                status: 'pending',
                createdAt: dateStr,
              });
              localStorage.setItem('cooperation_tokens', JSON.stringify(cooperationTokens));
              setSupplierOptions(prev => [...prev, newSupplier]);
              setNewRawSupplier(values.supplierName.trim());
              message.success(`供应商「${values.supplierName.trim()}」已添加，合作链接已生成`);
              setQuickAddSupplierVisible(false);
              quickAddSupplierForm.resetFields();
            } catch { message.error('创建失败'); }
          });
        }}
        okText="确认添加并生成合作链接"
        cancelText="取消"
        width={600}
        zIndex={1400}
        destroyOnClose
      >
        <Form form={quickAddSupplierForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="supplierName" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="请输入供应商全称" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="shortName" label="简称">
                <Input placeholder="供应商简称（选填）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactPerson" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contactPhone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="邮箱">
                <Input placeholder="邮箱地址" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="province" label="省">
                <Input placeholder="省份" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="city" label="市">
                <Input placeholder="城市" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="district" label="区">
                <Input placeholder="区/县" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="详细地址">
            <Input placeholder="详细地址" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息（选填）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新增工艺弹窗（复用生产工序新增弹窗布局：工序编号/名称/类型 + 工价/工时/准备时间 + 设备/状态/负责人 + 备注） */}
      <Modal
        title={<span style={{ color: PRIMARY }}><PlusOutlined style={{ marginRight: 8 }} />新增记录</span>}
        open={newProcVisible}
        onOk={handleConfirmNewProc}
        onCancel={() => setNewProcVisible(false)}
        okText="确认新增"
        cancelText="取消"
        width={760}
        zIndex={newSemiBomMode ? 1400 : 1200}
        destroyOnClose
      >
        <Row gutter={16}>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}><span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>工序编号</div>
            <Space.Compact style={{ width: '100%' }}>
              <Input size="small" placeholder="工序编号" value={newProcId} onChange={e => setNewProcId(e.target.value)} style={{ flex: 1 }} />
              <Tooltip title="随机生成唯一编号">
                <Button size="small" icon={<ReloadOutlined />} onClick={generateRandomProcId} />
              </Tooltip>
            </Space.Compact>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}><span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>工序名称</div>
            <Input size="small" placeholder="工序名称" value={newProcName} onChange={e => setNewProcName(e.target.value)} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>工序类型</div>
            <Select size="small" placeholder="选择类型" allowClear value={newProcType} onChange={v => setNewProcType(v)} style={{ width: '100%' }}
              options={[{ label: '自制', value: 'self' }, { label: '外协', value: 'outsource' }, { label: '检验', value: 'inspect' }, { label: '装配', value: 'assembly' }]} />
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}><span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>工价(元)</div>
            <InputNumber size="small" placeholder="工价(元)" value={newProcLaborPrice} onChange={v => setNewProcLaborPrice(v ?? undefined)} min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}><span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>工时定额(小时)</div>
            <InputNumber size="small" placeholder="工时定额(小时)" value={newProcTimeQuota} onChange={v => setNewProcTimeQuota(v ?? undefined)} min={0} style={{ width: '100%' }} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>准备时间(小时)</div>
            <InputNumber size="small" placeholder="准备时间(小时)" value={newProcSetupTime} onChange={v => setNewProcSetupTime(v ?? undefined)} min={0} style={{ width: '100%' }} />
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>设备要求</div>
            <Input size="small" placeholder="设备要求" value={newProcEquipment} onChange={e => setNewProcEquipment(e.target.value)} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>状态</div>
            <Select size="small" placeholder="选择状态" allowClear value={newProcStatus} onChange={v => setNewProcStatus(v)} style={{ width: '100%' }}
              options={[{ label: '已完成', value: 'completed' }, { label: '进行中', value: 'processing' }, { label: '待处理', value: 'pending' }, { label: '预警', value: 'warning' }, { label: '已取消', value: 'cancelled' }, { label: '已逾期', value: 'overdue' }]} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>负责人</div>
            <Select size="small" showSearch placeholder="选择负责人" allowClear value={newProcPerson} onChange={v => setNewProcPerson(v)} style={{ width: '100%' }}
              options={getProcPersonOptions()} />
          </Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#5a6d85' }}>备注</div>
          <Input.TextArea size="small" rows={2} placeholder="请输入备注信息" value={newProcRemark} onChange={e => setNewProcRemark(e.target.value)} />
        </div>
      </Modal>

      {/* 批量新增研发产品弹窗（复用成品列表的批量新增组件） */}
      <BatchAddProductModal
        open={batchAddVisible}
        onClose={() => setBatchAddVisible(false)}
        productType="成品"
        zIndex={1100}
        onCreated={() => {
          loadProducts();
        }}
      />

      {/* 添加颜色弹窗 */}
      <Modal
        title={`添加颜色 — 货号 ${addColorStyleCode}`}
        open={addColorVisible}
        onCancel={() => { setAddColorVisible(false); setAddColorImage(''); setAddColorMoldNumber(''); }}
        onOk={handleConfirmAddColor}
        okText="确认添加"
        width={560}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>款式编码</span>
            <Input value={addColorStyleCode} disabled style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}><span style={{ color: '#ff4d4f' }}>*</span> 颜色名称</span>
            <Input value={addColorName} onChange={e => setAddColorName(e.target.value)} placeholder="如：红色、黑色" style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>商品简称</span>
            <Input value={addColorShortName} onChange={e => setAddColorShortName(e.target.value)} placeholder="自动复用同款简称" style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>基础售价</span>
            <InputNumber value={addColorBasePrice} onChange={(v: number | null) => setAddColorBasePrice(v === null ? undefined : v)} min={0} precision={2} placeholder="复用同款售价" style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>模具编号</span>
            <Input value={addColorMoldNumber} onChange={e => setAddColorMoldNumber(e.target.value)} placeholder="点击选择模具" readOnly
              onClick={() => setAddColorMoldPickerVisible(true)} style={{ flex: 1, cursor: 'pointer' }} />
          </div>
          {/* 图片上传 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0, paddingTop: 4 }}>图片</span>
            <div style={{ flex: 1 }}>
              {addColorImage ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ position: 'relative', width: 72, height: 72 }}>
                    <img src={addColorImage} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 6, border: '1px solid #eee', display: 'block', background: '#fafafa' }} />
                    <Button size="small" type="text" danger icon={<DeleteOutlined />}
                      style={{ position: 'absolute', top: -10, right: -10, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.25)', width: 22, height: 22, padding: 0 }}
                      onClick={() => setAddColorImage('')} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Button size="small" icon={<CameraOutlined />} onClick={() => openCamera('addColor')}>拍照</Button>
                    <Button size="small" icon={<CopyOutlined />} onClick={async () => {
                      try {
                        const items = await navigator.clipboard.read();
                        for (const item of items) {
                          const imgType = item.types.find(t => t.startsWith('image/'));
                          if (imgType) {
                            const blob = await item.getType(imgType);
                            const raw = await readFileAsDataURL(blob);
                            const compressed = await compressImage(raw);
                            setAddColorImage(compressed);
                            message.success('图片已粘贴');
                            return;
                          }
                        }
                        message.warning('剪贴板中没有图片');
                      } catch { message.info('无法读取剪贴板，请使用 Ctrl+V 粘贴'); }
                    }}>粘贴</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Upload.Dragger
                    accept="image/*"
                    showUploadList={false}
                    customRequest={async ({ file }) => {
                      const raw = await readFileAsDataURL(file as File);
                      const compressed = await compressImage(raw);
                      setAddColorImage(compressed);
                    }}
                    style={{ width: '100%', maxWidth: 280 }}
                  >
                    <p style={{ color: '#bfbfbf', fontSize: 28, margin: '8px 0 4px' }}><UploadOutlined style={{ fontSize: 22 }} /></p>
                    <p style={{ fontSize: 12, color: '#8c8c8c' }}>点击或拖拽图片到这里上传</p>
                  </Upload.Dragger>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <Button size="small" icon={<CameraOutlined />} onClick={() => openCamera('addColor')}>拍照</Button>
                    <Tooltip title="也可以直接 Ctrl+V 粘贴图片">
                      <Button size="small" icon={<CopyOutlined />} onClick={async () => {
                        try {
                          const items = await navigator.clipboard.read();
                          for (const item of items) {
                            const imgType = item.types.find(t => t.startsWith('image/'));
                            if (imgType) {
                              const blob = await item.getType(imgType);
                              const raw = await readFileAsDataURL(blob);
                              const compressed = await compressImage(raw);
                              setAddColorImage(compressed);
                              message.success('图片已粘贴');
                              return;
                            }
                          }
                          message.warning('剪贴板中没有图片');
                        } catch { message.info('无法读取剪贴板，请使用 Ctrl+V 粘贴'); }
                      }}>粘贴</Button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* 规格 + 模版 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}><span style={{ color: '#ff4d4f' }}>*</span> 规格</span>
              <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => setAddColorSpecs(prev => [...prev, ''])}>添加规格</Button>
              {addColorSpecs.length > 1 && <Button size="small" type="link" danger onClick={() => setAddColorSpecs(prev => prev.slice(0, -1))}>删除末项</Button>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 78 }}>
              {addColorSpecs.map((spec, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Input value={spec} placeholder={`规格${idx + 1}`} style={{ width: 80 }}
                    onChange={e => setAddColorSpecs(prev => prev.map((s, i) => i === idx ? e.target.value : s))} />
                  {addColorSpecs.length > 1 && (
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}
                      onClick={() => setAddColorSpecs(prev => prev.filter((_, i) => i !== idx))} />
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* 规格模版 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>规格模版</span>
              <Button size="small" type="link" icon={<SaveOutlined />}
                onClick={() => { setSpecTemplateName(''); setSpecTemplateModalVisible(true); }}>保存为模版</Button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 78 }}>
              {specTemplates.length === 0 ? (
                <span style={{ fontSize: 12, color: '#bfbfbf' }}>暂无模版，添加规格后可保存为模版</span>
              ) : (
                specTemplates.map((tpl, idx) => (
                  <Tag key={idx} style={{ cursor: 'pointer', padding: '2px 8px' }}
                    onClick={() => setAddColorSpecs([...tpl.specs])}
                  >
                    {tpl.name}
                    <CloseCircleOutlined style={{ marginLeft: 4, color: '#bfbfbf' }}
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); const next = specTemplates.filter((_, i) => i !== idx); setSpecTemplates(next); try { localStorage.setItem('addColorSpecTemplates', JSON.stringify(next)); } catch {} }} />
                  </Tag>
                ))
              )}
            </div>
          </div>
          <div style={{ padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, fontSize: 12, color: '#389e0d' }}>
            将生成 {addColorSpecs.filter(s => s.trim()).length} 条新产品，格式：{addColorStyleCode || 'XXXX'}-{addColorName || '颜色'}-规格
          </div>
        </div>
      </Modal>

      {/* 保存规格模版弹窗 */}
      <Modal
        title="保存规格模版"
        open={specTemplateModalVisible}
        onCancel={() => setSpecTemplateModalVisible(false)}
        onOk={() => {
          const name = specTemplateName.trim();
          if (!name) { message.warning('请输入模版名称'); return; }
          const specs = addColorSpecs.filter(s => s.trim());
          if (specs.length === 0) { message.warning('当前没有规格，无法保存模版'); return; }
          const next = [...specTemplates, { name, specs }];
          setSpecTemplates(next);
          try { localStorage.setItem('addColorSpecTemplates', JSON.stringify(next)); } catch {}
          setSpecTemplateModalVisible(false);
          message.success(`模版“${name}”已保存`);
        }}
        okText="保存"
        width={360}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 60, textAlign: 'right', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>模版名称</span>
            <Input value={specTemplateName} onChange={e => setSpecTemplateName(e.target.value)} placeholder="如：鞋码模版、服装尺码" style={{ flex: 1 }} />
          </div>
          <div style={{ padding: '8px 12px', background: '#fafafa', borderRadius: 4, fontSize: 12 }}>
            当前规格：{addColorSpecs.filter(s => s.trim()).join('、') || '无'}
          </div>
        </div>
      </Modal>

      {/* 变体图片上传弹窗 */}
      <Modal
        title="上传图片"
        open={variantImgUploadVisible}
        onCancel={() => { setVariantImgUploadVisible(false); setVariantImgUploadCurrent(''); setVariantImgUploadFromGallery(false); }}
        onOk={async () => {
          if (variantImgUploadCurrent) {
            if (variantImgUploadFromGallery && selectedProduct?._isGroup) {
              // 画廊模式：填充到同颜色所有规格
              const currentVariant = (selectedProduct.variants || []).find((v: any) => v.key === variantImgUploadKey);
              const color = currentVariant?.color || '';
              const sameColor = (selectedProduct.variants || []).filter((v: any) => (v.color || '') === color);
              const keys = sameColor.map((v: any) => v.key);
              const { saved, failed } = await saveImageToKeys(keys, variantImgUploadCurrent);
              if (saved === 0) { message.error('图片保存失败'); return; }
              setProdImgCache(prev => {
                const next = { ...prev };
                keys.forEach((k: string) => { next[k] = variantImgUploadCurrent; });
                return next;
              });
              if (failed > 0) {
                message.warning(`图片仅保存到 ${saved}/${keys.length} 个规格`);
              } else {
                message.success(`图片已保存到 ${color}（${saved} 个规格）`);
              }
            } else {
              // 单个规格模式（含六面图后缀）
              const actualKey = variantImgUploadKey + variantImgUploadSuffix;
              const ok = await imgDB.set(actualKey, variantImgUploadCurrent);
              if (!ok) { message.error('图片保存失败'); return; }
              try { localStorage.setItem(`prodImg_${getDataOwner()}_${actualKey}`, variantImgUploadCurrent); } catch { /* quota exceeded — IndexedDB 兆底 */ }
              setProdImgCache(prev => ({ ...prev, [actualKey]: variantImgUploadCurrent }));
              message.success('图片已保存');
            }
          } else {
            if (variantImgUploadFromGallery && selectedProduct?._isGroup) {
              const currentVariant = (selectedProduct.variants || []).find((v: any) => v.key === variantImgUploadKey);
              const color = currentVariant?.color || '';
              const keys = (selectedProduct.variants || []).filter((v: any) => (v.color || '') === color).map((v: any) => v.key);
              await removeImageFromKeys(keys);
              setProdImgCache(prev => {
                const next = { ...prev };
                keys.forEach((k: string) => { delete next[k]; });
                return next;
              });
              message.info(`已清除 ${color} 所有规格的图片`);
            } else {
              const actualKey = variantImgUploadKey + variantImgUploadSuffix;
              await imgDB.remove(actualKey);
              setProdImgCache(prev => {
                const next = { ...prev };
                delete next[actualKey];
                return next;
              });
              message.info('已清除图片');
            }
          }
          setVariantImgUploadVisible(false);
          setVariantImgUploadCurrent('');
          setVariantImgUploadFromGallery(false);
          setVariantImgUploadRefresh(prev => prev + 1);
        }}
        okText="保存"
        width={480}
        destroyOnClose
      >
        <div style={{ padding: '0' }}>
          {variantImgUploadCurrent ? (
            <div style={{ position: 'relative', width: '100%', marginBottom: 12 }}>
              <img src={variantImgUploadCurrent} alt="" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', display: 'block' }} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(255,255,255,0.85)', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.25)', width: 28, height: 28, padding: 0 }}
                onClick={() => setVariantImgUploadCurrent('')} />
              {variantImgUploadFromGallery && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 12, textAlign: 'center', padding: '4px 0' }}>
                  保存后将填充到该颜色所有规格
                </div>
              )}
            </div>
          ) : (
            <Upload.Dragger
              accept="image/*"
              showUploadList={false}
              customRequest={async ({ file }) => {
                const raw = await readFileAsDataURL(file as File);
                const compressed = await compressImage(raw);
                setVariantImgUploadCurrent(compressed);
              }}
              style={{ marginBottom: 12 }}
            >
              <p style={{ color: '#bfbfbf', fontSize: 36, margin: '12px 0 4px' }}><UploadOutlined style={{ fontSize: 28 }} /></p>
              <p style={{ fontSize: 13, color: '#8c8c8c' }}>点击或拖拽图片到这里上传</p>
            </Upload.Dragger>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            <Button icon={<CameraOutlined />} onClick={() => openCamera('variant')}>拍照</Button>
            <Tooltip title="也可以直接 Ctrl+V 粘贴图片">
              <Button icon={<CopyOutlined />} onClick={async () => {
                try {
                  const items = await navigator.clipboard.read();
                  for (const item of items) {
                    const imgType = item.types.find(t => t.startsWith('image/'));
                    if (imgType) {
                      const blob = await item.getType(imgType);
                      const raw = await readFileAsDataURL(blob);
                      const compressed = await compressImage(raw);
                      setVariantImgUploadCurrent(compressed);
                      message.success('图片已粘贴');
                      return;
                    }
                  }
                  message.warning('剪贴板中没有图片');
                } catch { message.info('无法读取剪贴板，请使用 Ctrl+V 粘贴'); }
              }}>粘贴</Button>
            </Tooltip>
          </div>
        </div>
      </Modal>

      {/* 摄像头拍照弹窗 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><CameraOutlined style={{ marginRight: 8 }} />摄像头拍照</span>}
        open={cameraVisible} onCancel={closeCamera} width={480} destroyOnClose
        footer={[
          <Button key="cancel" onClick={closeCamera}>取消</Button>,
          <Button key="shot" type="primary" icon={<CameraOutlined />} onClick={capturePhoto}>拍照</Button>,
        ]}
      >
        <div style={{ textAlign: 'center' }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: 432, borderRadius: 8, background: '#000' }} />
        </div>
      </Modal>

      {/* BOM字段配置弹窗 */}
      <Modal
        title={<span><SettingOutlined style={{ marginRight: 8 }} />字段显示配置</span>}
        open={bomFieldConfigVisible}
        onOk={() => setBomFieldConfigVisible(false)}
        onCancel={() => setBomFieldConfigVisible(false)}
        okText="确定"
        cancelText="取消"
        width={420}
        zIndex={1100}
      >
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: 'block' }}>
            勾选需要显示的字段，拖动上下箭头调整显示顺序
          </Text>
          {bomFieldOrder.map((key, idx) => {
            const field = BOM_FIELD_OPTIONS.find(f => f.key === key);
            if (!field) return null;
            const isVisible = !bomFieldHidden.has(key);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Checkbox
                  checked={isVisible}
                  onChange={(e) => {
                    const newHidden = new Set(bomFieldHidden);
                    if (e.target.checked) newHidden.delete(key); else newHidden.add(key);
                    setBomFieldHidden(newHidden);
                  }}
                >
                  <span style={{ fontSize: 13 }}>{field.label}</span>
                </Checkbox>
                <div style={{ display: 'flex', gap: 2 }}>
                  <Button size="small" type="text" disabled={idx === 0} icon={<span style={{ fontSize: 12 }}>↑</span>}
                    onClick={() => {
                      const newOrder = [...bomFieldOrder];
                      [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                      setBomFieldOrder(newOrder);
                    }} />
                  <Button size="small" type="text" disabled={idx === bomFieldOrder.length - 1} icon={<span style={{ fontSize: 12 }}>↓</span>}
                    onClick={() => {
                      const newOrder = [...bomFieldOrder];
                      [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                      setBomFieldOrder(newOrder);
                    }} />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Button size="small" onClick={() => {
              setBomFieldOrder(BOM_FIELD_OPTIONS.map(f => f.key));
              setBomFieldHidden(new Set(BOM_FIELD_OPTIONS.filter(f => !f.defaultVisible).map(f => f.key)));
            }}>恢复默认</Button>
          </div>
        </div>
      </Modal>

      {/* 原材料字段显示配置弹窗 */}
      <Modal
        title={<span><SettingOutlined style={{ marginRight: 8 }} />原材料字段显示配置</span>}
        open={rawFieldConfigVisible}
        onOk={() => setRawFieldConfigVisible(false)}
        onCancel={() => setRawFieldConfigVisible(false)}
        okText="确定"
        cancelText="取消"
        width={420}
        zIndex={1100}
      >
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: 'block' }}>
            勾选需要显示的字段，拖动上下箭头调整显示顺序
          </Text>
          {rawFieldOrder.map((key, idx) => {
            const field = RAW_FIELD_OPTIONS.find(f => f.key === key);
            if (!field) return null;
            const isVisible = !rawFieldHidden.has(key);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Checkbox
                  checked={isVisible}
                  onChange={(e) => {
                    const newHidden = new Set(rawFieldHidden);
                    if (e.target.checked) newHidden.delete(key); else newHidden.add(key);
                    setRawFieldHidden(newHidden);
                  }}
                >
                  <span style={{ fontSize: 13 }}>{field.label}</span>
                </Checkbox>
                <div style={{ display: 'flex', gap: 2 }}>
                  <Button size="small" type="text" disabled={idx === 0} icon={<span style={{ fontSize: 12 }}>↑</span>}
                    onClick={() => {
                      const newOrder = [...rawFieldOrder];
                      [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                      setRawFieldOrder(newOrder);
                    }} />
                  <Button size="small" type="text" disabled={idx === rawFieldOrder.length - 1} icon={<span style={{ fontSize: 12 }}>↓</span>}
                    onClick={() => {
                      const newOrder = [...rawFieldOrder];
                      [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                      setRawFieldOrder(newOrder);
                    }} />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Button size="small" onClick={() => {
              setRawFieldOrder(RAW_FIELD_OPTIONS.map(f => f.key));
              setRawFieldHidden(new Set(RAW_FIELD_OPTIONS.filter(f => !f.defaultVisible).map(f => f.key)));
            }}>恢复默认</Button>
          </div>
        </div>
      </Modal>
      {/* 物料清单弹窗 */}
      <Modal
        title={
          <span style={{ color: PRIMARY }}>
            <FileTextOutlined style={{ marginRight: 8 }} />
            物料清单 — {selectedProduct?._isGroup ? (selectedProduct.styleCode + (selectedProduct._colorGroup ? ` > ${selectedProduct._colorGroup}` : '')) : (selectedProduct?.shortName || selectedProduct?.name || '')}
            <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>(半成品{materialListSemi.length} / 原材料{materialListRaw.length} / 工艺{materialListProc.length})</span>
          </span>
        }
        open={materialListVisible}
        onCancel={() => setMaterialListVisible(false)}
        footer={<Button onClick={() => setMaterialListVisible(false)}>关闭</Button>}
        width={1100}
        zIndex={1000}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" icon={<SettingOutlined />} onClick={() => setMaterialListFieldConfigVisible(true)}>字段显示配置</Button>
        </div>
        {(() => {
          const allCols: Record<string, any> = {
            styleCode: { title: '款式编码', dataIndex: 'styleCode', width: 110, align: 'center' as const, render: (v: string) => v || '—' },
            shortName: { title: '商品简称', dataIndex: 'shortName', width: 100, align: 'center' as const, render: (v: string) => v || '—' },
            code: { title: '商品编码', dataIndex: 'code', width: 120, align: 'center' as const, render: (v: string) => v || '—' },
            color: { title: '颜色', dataIndex: 'color', width: 70, align: 'center' as const, render: (v: string) => v || '—' },
            spec: { title: '规格', dataIndex: 'spec', width: 70, align: 'center' as const, render: (v: string) => v || '—' },
            level: { title: '层级', dataIndex: 'level', width: 60, align: 'center' as const, render: (v: any) => v ? <Tag color="blue">{v}</Tag> : '—' },
            unit: { title: '单位', dataIndex: 'unit', width: 60, align: 'center' as const, render: (v: string) => v || '—' },
            price: { title: '单价', dataIndex: 'price', width: 80, align: 'center' as const, render: (v: number) => `¥${(v || 0).toFixed(2)}` },
            qty: { title: '数量(合计)', dataIndex: 'qty', width: 100, align: 'center' as const, render: (v: number) => (v || 0).toFixed(5) },
            count: { title: '变体数', dataIndex: 'count', width: 80, align: 'center' as const, render: (v: number) => <Tag>{v}</Tag> },
            avgQty: { title: '平均所需数量', dataIndex: 'avgQty', width: 110, align: 'center' as const, render: (v: number) => (v || 0).toFixed(5) },
            subtotal: { title: '小计(合计)', dataIndex: 'subtotal', width: 110, align: 'center' as const, render: (v: number) => <Text style={{ fontFamily: 'monospace', fontWeight: 500 }}>¥{(v || 0).toFixed(2)}</Text> },
          };
          const buildCols = (overrides?: Record<string, any>, hiddenKeys?: string[], insertCols?: { key: string; col: any; after?: string }[]) => {
            const cols = materialListFieldOrder
              .filter(key => !materialListFieldHidden.has(key) && allCols[key] && !(hiddenKeys || []).includes(key))
              .map(key => ({ ...allCols[key], ...((overrides || {})[key] || {}), key }));
            (insertCols || []).forEach(({ key, col, after }) => {
              if (cols.some(c => c.key === key)) return;
              const idx = after ? cols.findIndex(c => c.key === after) : cols.length - 1;
              cols.splice(idx < 0 ? cols.length : idx + 1, 0, { ...col, key });
            });
            return wrapMaterialListCols(cols as any);
          };
          const renderTable = (data: any[], title: string, color: string, icon: string, overrides?: Record<string, any>, hiddenKeys?: string[], insertCols?: { key: string; col: any; after?: string }[]) => {
            const cols = buildCols(overrides, hiddenKeys, insertCols);
            const totalCost = data.reduce((sum: number, row: any) => sum + (row.subtotal || 0), 0);
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: PRIMARY }}>
                    {icon} {title} <Tag color={color} style={{ marginLeft: 4 }}>{data.length}</Tag>
                  </span>
                  <Space size={4}>
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => {
                      const header = cols.map((c: any) => c.title).join(',');
                      const rows = data.map((r: any) => cols.map((c: any) => {
                        const val = r[c.dataIndex];
                        if (c.dataIndex === 'price' || c.dataIndex === 'subtotal') return `¥${(Number(val) || 0).toFixed(2)}`;
                        if (c.dataIndex === 'qty' || c.dataIndex === 'avgQty') return (Number(val) || 0).toFixed(5);
                        return val ?? '';
                      }).join(','));
                      const csv = '\uFEFF' + [header, ...rows].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `${title}.csv`; a.click();
                      URL.revokeObjectURL(url);
                    }}>导出</Button>
                    <Button size="small" icon={<PrinterOutlined />} onClick={() => {
                      const w = window.open('', '_blank');
                      if (!w) return;
                      w.document.write(`<html><head><title>${title}</title><style>table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #333;padding:4px 6px;text-align:center}th{background:#f0f0f0}</style></head><body><h3>${title}</h3><table><thead><tr>${cols.map((c: any) => `<th>${c.title}</th>`).join('')}</tr></thead><tbody>${data.map((r: any) => `<tr>${cols.map((c: any) => `<td>${r[c.dataIndex] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table><p>合计：¥${totalCost.toFixed(2)}</p></body></html>`);
                      w.document.close(); w.print();
                    }}>打印</Button>
                  </Space>
                </div>
                <Table
                  bordered
                  dataSource={data}
                  columns={cols}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  scroll={{ y: 200 }}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={cols.length - 1} align="right">
                        <Text strong>合计：</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={cols.length - 1} align="center">
                        <Text strong style={{ fontFamily: 'monospace', color: '#722ed1' }}>¥{totalCost.toFixed(2)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </div>
            );
          };
          return (
            <>
              {renderTable(materialListSemi, '半成品清单', 'cyan', '🟢')}
              {renderTable(materialListRaw, '原材料清单', 'orange', '🟠')}
              {renderTable(materialListProc, '工艺清单', 'gold', '🟡', {
                code: { title: '工序编号' },
                shortName: { title: '工序名称', render: (v: string, r: any) => r.name || r.shortName || '—' },
              }, ['styleCode', 'level', 'unit'], [
                { key: 'procType', after: 'code', col: { title: '工序类型', dataIndex: 'procType', width: 90, align: 'center' as const, render: (v: string) => ({ self: '自制', outsource: '外协', inspect: '检验', assembly: '装配' } as Record<string, string>)[v] || v || '—' } },
                { key: 'timeQuota', after: 'procType', col: { title: '工时定额(小时)', dataIndex: 'timeQuota', width: 110, align: 'center' as const, render: (v: any) => (v === '' || v === undefined || v === null) ? '—' : String(v) } },
              ])}
            </>
          );
        })()}
      </Modal>
      {/* 物料清单字段配置弹窗 */}
      <Modal
        title="物料清单字段显示配置"
        open={materialListFieldConfigVisible}
        onCancel={() => setMaterialListFieldConfigVisible(false)}
        onOk={() => setMaterialListFieldConfigVisible(false)}
        zIndex={1100}
        width={400}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {materialListFieldOrder.map((key, idx) => {
            const field = MATERIAL_LIST_FIELDS.find(f => f.key === key);
            if (!field) return null;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#fafafa', borderRadius: 4 }}>
                <Checkbox
                  checked={!materialListFieldHidden.has(key)}
                  onChange={(e) => {
                    setMaterialListFieldHidden(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(key); else next.add(key);
                      return next;
                    });
                  }}
                >
                  {field.label}
                </Checkbox>
                <div style={{ flex: 1 }} />
                <Button size="small" type="text" disabled={idx === 0} onClick={() => {
                  setMaterialListFieldOrder(prev => {
                    const next = [...prev];
                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                    return next;
                  });
                }}><UpOutlined /></Button>
                <Button size="small" type="text" disabled={idx === materialListFieldOrder.length - 1} onClick={() => {
                  setMaterialListFieldOrder(prev => {
                    const next = [...prev];
                    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                    return next;
                  });
                }}><DownOutlined /></Button>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* BOM 新增弹窗：摄像头拍照 */}
      <Modal
        title="摄像头拍照"
        open={bomCamVisible}
        onCancel={closeBomCam}
        width={480}
        zIndex={1600}
        footer={[
          <Button key="c" onClick={closeBomCam}>取消</Button>,
          <Button key="s" type="primary" icon={<CameraOutlined />} onClick={captureBomCam}>拍照</Button>,
        ]}
      >
        <div style={{ textAlign: 'center' }}>
          <video ref={bomCamVideoRef} autoPlay playsInline style={{ width: '100%', maxWidth: 432, borderRadius: 8, background: '#000' }} />
        </div>
      </Modal>

      {/* BOM 图片放大预览 */}
      <Modal open={!!bomImgPreview} onCancel={() => setBomImgPreview('')} footer={null} width={640} centered zIndex={1700}>
        <img src={bomImgPreview} alt="图片预览" style={{ width: '100%', maxHeight: 520, objectFit: 'contain' }} />
      </Modal>

      {/* BOM 新增原材料：复用基础数据批量新增弹窗组件（原材料层级默认99） */}
      <BatchAddProductModal
        open={bomRawBatchVisible}
        onClose={() => setBomRawBatchVisible(false)}
        productType="原材料"
        defaultLevel="99"
        zIndex={newSemiBomMode ? 1400 : subBomEditorStack.length > 0 ? 1200 + subBomEditorStack.length * 10 : 1250}
        onCreated={(recs) => {
          setBomSelectData(prev => [...recs.filter((r: any) => !prev.some((p: any) => p.key === r.key)), ...prev]);
          setBomSelectKeys(prev => [...prev, ...recs.map((r: any) => r.key).filter((k: string) => !prev.includes(k))]);
          if (!batchSubBomTarget && !newSemiBomMode && subBomEditorStack.length === 0) {
            setBomRawMaterials(prev => [...prev, ...recs.filter((r: any) => !prev.some((p: any) => p.key === r.key)).map((r: any) => ({
              key: r.key, name: [r.shortName, r.color, r.spec].filter(Boolean).join('-'), shortName: r.shortName || '', styleCode: r.styleCode || '',
              code: r.productCode || '', level: r.level || '', unit: r.unit || '', price: Number(r.costPrice) || 0, qty: 1,
            }))]);
          }
        }}
      />

      {/* 添加颜色 - 模具选择弹窗 */}
      <MoldPickerModal
        open={addColorMoldPickerVisible}
        value={addColorMoldNumber}
        onSelect={(code) => { setAddColorMoldNumber(code); setAddColorMoldPickerVisible(false); }}
        onCancel={() => setAddColorMoldPickerVisible(false)}
      />
      {/* 新增半成品 - 模具选择弹窗（层级须高于半成品弹窗的 1200） */}
      <MoldPickerModal
        open={newSemiMoldPickerVisible}
        value={newSemiMoldNumber}
        onSelect={(code) => { setNewSemiMoldNumber(code); setNewSemiMoldPickerVisible(false); }}
        onCancel={() => setNewSemiMoldPickerVisible(false)}
        zIndex={1300}
      />
      {/* 新增原材料 - 模具选择弹窗（层级须高于原材料弹窗的 1200/1400） */}
      <MoldPickerModal
        open={newRawMoldPickerVisible}
        value={newRawMoldNumber}
        onSelect={(code) => { setNewRawMoldNumber(code); setNewRawMoldPickerVisible(false); }}
        onCancel={() => setNewRawMoldPickerVisible(false)}
        zIndex={newSemiBomMode ? 1500 : 1300}
      />
    </div>
  );
};

export default PlanDesignPage;
