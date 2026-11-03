/**
 * 商品打印页（供应商平台-商品菜单）
 * 一期子页：①打印吊牌&条码 ②导入打印吊牌&条码；其余左子菜单项二期占位。
 * 打印复用项目多模板存储契约（print_template_list_<type> / print_template_<type>_<id>），
 * 预览走站内 iframe 弹窗（window.open 会被弹窗拦截器静默阻止）。
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import {
  Card, Menu, Input, Select, Button, Checkbox, InputNumber, Image, Modal,
  Table, Tabs, Space, Typography, message, Popconfirm, Dropdown, Empty, Tag, Tooltip,
} from 'antd';
import {
  PrinterOutlined, SettingOutlined, PlusOutlined, DeleteOutlined, SaveOutlined,
  ClearOutlined, SearchOutlined, EditOutlined, EyeOutlined, FileTextOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getDataOwner } from '../utils/brandAuth';
import { saveDataset } from '../utils/dataStore';
import { basicDataPages } from '../config/pageConfig';
import { getCurrentUserDisplayName } from '../utils/billLog';
import request from '../utils/request';
import { PRESET_PRINT_TEMPLATES, seedPresetPrintTemplates } from '../config/presetPrintTemplates';

// 成品列标题→数据键映射：建议零售价/其它属性1等列标题字段自动关联商品列表记录
const PRODUCT_LABEL_KEY: Record<string, string> = {};
try { (basicDataPages['finished-product']?.columns || []).forEach((c: any) => { PRODUCT_LABEL_KEY[String(c.title)] = String(c.key || c.dataIndex); }); } catch { /* ignore */ }

const { Text } = Typography;
const PRIMARY = '#1e4a7e';
const safeSetItem = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const loadJson = (k: string, d: any = []) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; }
};

const SUB_MENUS = [
  { key: 'print-tag', label: '打印吊牌&条码' },
  { key: 'import-print', label: '导入打印吊牌&条码' },
  { key: 'carton-spec', label: '箱规码打印' },
];

const TPL_TYPES = ['tag', 'barcode', 'wash', 'carton'] as const;
type TplType = typeof TPL_TYPES[number];
const TPL_LABEL: Record<string, string> = { tag: '吊牌', barcode: '商品条码', wash: '水洗标', carton: '箱唛' };
const TPL_PAPER: Record<string, { w: number; h: number }> = { tag: { w: 89, h: 127 }, barcode: { w: 50, h: 30 }, wash: { w: 76, h: 130 }, carton: { w: 102, h: 152 } };
const tplDataKey = (type: string, id: string) => id === 'default' ? `print_template_${type}` : `print_template_${type}_${id}`;
const loadTplList = (type: string): { id: string; name: string }[] => {
  const l = loadJson(`print_template_list_${type}`, null);
  if (Array.isArray(l) && l.length) return l;
  return [{ id: 'default', name: `${TPL_LABEL[type]}模板` }];
};
// 旧版模板元素坐标以像素存储（迁移逻辑与 ModuleChildPage migrateTplDataMm 同源）；预览侧同步迁移，避免编辑器未打开时读到未迁移旧数据
const migrateTplDataMm = (data: any): any => {
  if (!data || !Array.isArray(data.elements)) return data;
  const MM = 3.78;
  // ① 旧版像素数据（无标记）：一次性迁移 ÷3.78（字号 px→pt ×0.75）
  if (!data.mmFixed) {
    const elements = data.elements.map((e: any) => {
      const n: any = { ...e };
      if (typeof n.x === 'number') n.x = +(n.x / MM).toFixed(3);
      if (typeof n.y === 'number') n.y = +(n.y / MM).toFixed(3);
      if (e.type !== 'image') {
        if (typeof n.width === 'number') n.width = +(n.width / MM).toFixed(3);
        if (typeof n.height === 'number') n.height = +(n.height / MM).toFixed(3);
      }
      if (typeof n.fontSize === 'number') n.fontSize = +(n.fontSize * 0.75).toFixed(2);
      return n;
    });
    return { ...data, elements, tableFontSize: typeof data.tableFontSize === 'number' ? +(data.tableFontSize * 0.75).toFixed(2) : data.tableFontSize, mmFixed: true, mmSchema2: true };
  }
  // ② 过渡期损坏数据修复：有 mmFixed 无 mmSchema2 且包围盒明显偏小（两向均≤纸张40%）→ ×3.78 还原；否则仅补标记
  if (!data.mmSchema2) {
    const pw = Number(data.paperWidth) || 76;
    const ph = Number(data.paperHeight) || 130;
    let maxX = 0; let maxY = 0;
    data.elements.forEach((e: any) => {
      maxX = Math.max(maxX, (Number(e.x) || 0) + (Number(e.width) || 0));
      maxY = Math.max(maxY, (Number(e.y) || 0) + (Number(e.height) || 0));
    });
    if (data.elements.length && maxX <= pw * 0.4 && maxY <= ph * 0.4) {
      const elements = data.elements.map((e: any) => {
        const n: any = { ...e };
        if (typeof n.x === 'number') n.x = +(n.x * MM).toFixed(3);
        if (typeof n.y === 'number') n.y = +(n.y * MM).toFixed(3);
        if (e.type !== 'image') {
          if (typeof n.width === 'number') n.width = +(n.width * MM).toFixed(3);
          if (typeof n.height === 'number') n.height = +(n.height * MM).toFixed(3);
        }
        if (typeof n.fontSize === 'number') n.fontSize = +(n.fontSize * 1.3333).toFixed(2);
        return n;
      });
      return { ...data, elements, tableFontSize: typeof data.tableFontSize === 'number' ? +(data.tableFontSize * 1.3333).toFixed(2) : data.tableFontSize, mmFixed: true, mmSchema2: true };
    }
    return { ...data, mmSchema2: true };
  }
  return data;
};
const loadTpl = (type: string, id: string): any => {
  const raw = loadJson(tplDataKey(type, id), null);
  const data = migrateTplDataMm(raw);
  if (data && data !== raw) { try { localStorage.setItem(tplDataKey(type, id), JSON.stringify(data)); } catch { /* 忽略回写失败 */ } }
  return data;
};
// 编辑器最后保存的模板实例（由 PrintTemplateEditor.saveTemplate 写入）
const lastEditorTplId = (type: string): string | null => {
  try { const s = localStorage.getItem(`print_template_last_${type}`); if (!s) return null; return JSON.parse(s)?.id || null; } catch { return null; }
};

const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 生成真实可扫描的条形码 SVG
const buildBarcodeSvg = (code: string, heightMm: number = 15): string => {
  try {
    // CODE128 只支持 ASCII，非 ASCII 内容无法生成有效条码
    const isAscii = /^[\x00-\x7F]*$/.test(code || '');
    if (!isAscii) return '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, code || ' ', {
      format: 'CODE128',
      height: Math.round(heightMm * 3.78), // mm to px
      width: 2,
      displayValue: false,
      margin: 2,
      background: 'transparent',
      lineColor: '#000000',
    });
    // 保留完整 SVG（含 viewBox），固有 width/height 换成 100% 由外层毫米容器控尺寸
    return new XMLSerializer().serializeToString(svg).replace(/^<svg([^>]*)>/, (_m, a: string) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} width="100%" height="100%" preserveAspectRatio="none">`);
  } catch {
    return '';
  }
};
// 生成真实可扫描的二维码 data URL
const buildQrcodeDataUrl = async (text: string, sizePx: number = 200): Promise<string> => {
  try {
    return await QRCode.toDataURL(text || ' ', { width: sizePx, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  } catch {
    return '';
  }
};

interface GridRow {
  key: string; productCode: string; qty: number; styleCode: string; colorSpec: string;
  name: string; image?: string; attr1?: string; attr2?: string; attr3?: string; attr4?: string; attr5?: string;
}

const ProductPrintPage: React.FC = () => {
  const navigate = useNavigate();
  const owner = useMemo(() => getDataOwner(), []);
  const productKey = `pageData_basic-data_product-list_${owner}`;
  const importKey = `pageData_product_print_import_${owner}`;
  const customKey = `pageData_product_print_custom_contents_${owner}`;
  const settingsKey = `pageData_product_print_settings_${owner}`;

  const [activeSub, setActiveSub] = useState('print-tag');
  const [products, setProducts] = useState<any[]>([]);
  const reloadProducts = useCallback(() => { setProducts(loadJson(productKey, [])); }, [productKey]);
  useEffect(() => { reloadProducts(); }, [reloadProducts]);

  // ============ 子页A 状态 ============
  const [fType, setFType] = useState('all');
  const [fStyle, setFStyle] = useState(''); const [fName, setFName] = useState('');
  const [fBrand, setFBrand] = useState(''); const [fStatus, setFStatus] = useState('');
  const [fSup, setFSup] = useState(''); const [fSupCode, setFSupCode] = useState('');
  const [fCodeType, setFCodeType] = useState('productCode');
  const [fCodeMerge, setFCodeMerge] = useState('');
  const [fAux, setFAux] = useState(''); const [fSupCode2, setFSupCode2] = useState('');
  const [applied, setApplied] = useState<any>(null);
  const [scanDirect, setScanDirect] = useState(false);
  const [selCode, setSelCode] = useState('');
  const [selColor, setSelColor] = useState(''); const [selSpec, setSelSpec] = useState('');
  const [printKind, setPrintKind] = useState<TplType>('tag');
  const [multiInfo, setMultiInfo] = useState(false);
  const [tplIds, setTplIds] = useState<Record<string, string>>({ tag: 'default', barcode: 'default', wash: 'default', carton: 'default' });
  const [printer, setPrinter] = useState('默认使用模板设置的打印机');
  const [printerList, setPrinterList] = useState<{ name: string; isDefault: boolean }[]>([]);
  // 拉取本机已安装打印机（打印客户端在线时经服务端汇总；免鉴权接口按租户名查询）
  const reloadPrinters = useCallback(() => {
    const uname = localStorage.getItem('username') || '';
    const candidates = Array.from(new Set([getDataOwner(), uname].filter(Boolean))) as string[];
    // 兜底：打印客户端未在线时取服务端所在电脑的已安装打印机（浏览器同机即本机打印机）
    const fetchLocalPrinters = () => {
      request.get('/print/local-printers').then((res: any) => {
        const list = res?.data?.data?.printers;
        setPrinterList(Array.isArray(list) ? list : []);
      }).catch(() => setPrinterList([]));
    };
    const tryFetch = (i: number): void => {
      if (i >= candidates.length) { fetchLocalPrinters(); return; }
      request.get('/print/printers-public', { params: { owner: candidates[i] } }).then((res: any) => {
        const list = res?.data?.data?.printers;
        if (Array.isArray(list) && list.length) setPrinterList(list);
        else tryFetch(i + 1);
      }).catch(() => tryFetch(i + 1));
    };
    tryFetch(0);
  }, []);
  useEffect(() => { reloadPrinters(); }, [reloadPrinters]);
  const [qty1, setQty1] = useState(1);
  const [printTaskId, setPrintTaskId] = useState('');
  const [printLoading, setPrintLoading] = useState(false);
  const [customContents, setCustomContents] = useState<any[]>([]);
  const [selCustom, setSelCustom] = useState('');
  const [customModal, setCustomModal] = useState(false);
  const [attrModal, setAttrModal] = useState(false);
  const [attrForm, setAttrForm] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 系统预设模板：首次打开把内置预设写入本地（只补不覆写），新部署/新浏览器自带预设
  useEffect(() => { Object.keys(PRESET_PRINT_TEMPLATES).forEach(seedPresetPrintTemplates); }, []);
  useEffect(() => {
    setCustomContents(loadJson(customKey, []));
    const st = loadJson(settingsKey, {});
    if (st.printKind) setPrintKind(st.printKind);
    if (st.scanDirect) setScanDirect(true);
    if (st.multiInfo) setMultiInfo(true);
    if (st.printer) setPrinter(st.printer);
    // 模板选择：优先恢复上次选择；本页从未选过时跟随编辑器最后保存的实例（编辑器保存时也会同步写回本页设置，此处为双保险），最后才落列表首个
    const savedTpl = st.tplIds || {};
    const init: Record<string, string> = { tag: 'default', barcode: 'default', wash: 'default', carton: 'default' };
    (TPL_TYPES as readonly string[]).forEach(t => {
      const list = loadTplList(t);
      const val = savedTpl[t];
      if (val && (val === 'default' || list.some((x: any) => x.id === val))) { init[t] = val; return; }
      const last = lastEditorTplId(t);
      init[t] = last && list.some((x: any) => x.id === last) ? last : (list[0]?.id || 'default');
    });
    setTplIds(init);
  }, []);
  useEffect(() => {
    safeSetItem(settingsKey, JSON.stringify({ printKind, scanDirect, multiInfo, printer, tplIds }));
    saveDataset(settingsKey, JSON.stringify({ printKind, scanDirect, multiInfo, printer, tplIds }));
  }, [printKind, scanDirect, multiInfo, printer, tplIds, settingsKey]);

  const brands = useMemo(() => Array.from(new Set(products.map((p: any) => String(p.brand || '').trim()).filter(Boolean))) as string[], [products]);
  const filteredProducts = useMemo(() => {
    const a = applied || {};
    return products.filter((p: any) => {
      if (a.type && a.type !== 'all' && String(p.productType || '') !== a.type) return false;
      if (a.style && !String(p.styleCode || '').includes(a.style)) return false;
      if (a.name && !String(p.name || '').includes(a.name) && !String(p.shortName || '').includes(a.name)) return false;
      if (a.brand && String(p.brand || '') !== a.brand) return false;
      if (a.status && String(p.productStatus || '') !== a.status) return false;
      if (a.sup && !String(p.supplier || p.supplierName || '').includes(a.sup)) return false;
      if (a.supCode && !String(p.supplierProductCode || '').includes(a.supCode)) return false;
      if (a.code) {
        const cell = a.codeType === 'barcode' ? String(p.barcode || '') : String(p.productCode || '');
        if (!cell.includes(a.code)) return false;
      }
      if (a.codeMerge) {
        const q = String(a.codeMerge).toLowerCase();
        const hit = [p.productCode, p.barcode, p.nationalCode].some(v => String(v || '').toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (a.aux && !String(p.auxCode || p.nationalCode || '').includes(a.aux)) return false;
      if (a.supCode2 && !String(p.supplierProductCode || '').includes(a.supCode2)) return false;
      return true;
    });
  }, [products, applied]);

  const selProduct = useMemo(() => products.find((p: any) => p.productCode === selCode) || null, [products, selCode]);

  // 颜色/规格两级候选（货号选择栏两行级联）
  const colorOptions = useMemo(() => Array.from(new Set(filteredProducts.map((p: any) => String(p.color || '').trim()).filter(Boolean))) as string[], [filteredProducts]);
  const specOptions = useMemo(() => Array.from(new Set(filteredProducts.filter((p: any) => (p.color || '') === selColor).map((p: any) => String(p.spec || '').trim()))) as string[], [filteredProducts, selColor]);

  // 单/多件订单商品数：未发货销售订单聚合
  const orderStats = useMemo(() => {
    if (!selCode) return { orderCount: 0, totalQty: 0 };
    const orders: any[] = loadJson(`pageData_sales_order-manage_${owner}`, []);
    let orderCount = 0; let totalQty = 0;
    orders.forEach((o: any) => {
      if (['已发货', '已完成', '已取消'].includes(String(o.orderStatus || ''))) return;
      let items: any[] = [];
      try { items = typeof o.orderItems === 'string' ? JSON.parse(o.orderItems) : (o.orderItems || []); } catch { items = []; }
      const hit = items.filter((it: any) => it.productCode === selCode);
      if (hit.length) { orderCount += 1; totalQty += hit.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0); }
    });
    return { orderCount, totalQty };
  }, [selCode, owner]);

  const fieldVal = useCallback((p: any, field: string): string => {
    const extra: Record<string, string> = {
      '自定义打印内容': customContents.find((c: any) => c.name === selCustom)?.content || '',
      '单件订单商品数': String(orderStats.orderCount),
      '多件订单商品数': String(orderStats.totalQty),
    };
    if (extra[field] !== undefined) return extra[field];
    // 打印信息字段：预览/打印时刻动态解析
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const printDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const printTime = `${printDate} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const map: Record<string, string> = {
      '打印人': getCurrentUserDisplayName(), '操作人': getCurrentUserDisplayName(),
      '打印时间': printTime, '打印日期': printDate,
      '商品名称': p.name || p.shortName || '', '商品简称': p.shortName || p.name || '',
      '商品编码': p.productCode || '', '条形码': p.barcode || '', '出库单号': p.outboundNo || '', '联系电话': p.receiverPhone || p.phone || '', '颜色': p.color || '',
      '规格': p.spec || '', '款式编码': p.styleCode || '', '品牌': p.brand || '', '商品图片': p.image || (p.key ? localStorage.getItem(`prodImg_${owner}_${p.key}`) || '' : ''),
      // 成品列表图片列标题为“图片”，与“商品图片”同义，两个键都须命中同一取图逻辑
      '图片': p.image || (p.key ? localStorage.getItem(`prodImg_${owner}_${p.key}`) || '' : ''),
      '单位': p.unit || '', '基础售价': String(p.basePrice ?? ''), '库存': String(p.actualStock ?? 0),
    };
    if (map[field] !== undefined) return map[field];
    // 列标题字段回退：按成品列配置把标题翻译成数据键（建议零售价→retailPrice、其它属性1→otherProp1 等）
    const lk = PRODUCT_LABEL_KEY[field];
    if (lk && p[lk] != null && p[lk] !== '') return String(p[lk]);
    return p[field] != null ? String(p[field]) : '';
  }, [customContents, selCustom, orderStats]);

  // 预览/打印模板实例解析：以本页下拉所选为准（所见即所选）。
  // 编辑器保存的实例经 saveTemplate 同步写入本页设置（settings.tplIds），下拉显示值随之更新，不再运行时覆盖用户选择
  const resolveTplId = useCallback((type: TplType): string => tplIds[type] || 'default', [tplIds]);

  // 标签页 HTML 构建：有保存模板按元素渲染，无则默认版式
  const buildPages = useCallback(async (type: TplType, p: any, copies: number): Promise<string> => {
    const tid = resolveTplId(type);
    const tpl = loadTpl(type, tid);
    // 调试：打印实际加载的模板信息
    console.log(`[buildPages] type=${type}, tplId=${tid}, tpl=${JSON.stringify({ name: tpl?.templateName, elementsCount: tpl?.elements?.length, paperSize: `${tpl?.paperWidth}x${tpl?.paperHeight}` })}`);
    if (tpl?.elements) {
      console.log(`[buildPages] elements:`, tpl.elements.map((e: any) => ({ type: e.type, field: e.field, displayAs: e.displayAs, x: e.x, y: e.y })));
    }
    const pw = Number(tpl?.paperWidth) || TPL_PAPER[type].w;
    const ph = Number(tpl?.paperHeight) || TPL_PAPER[type].h;
    const onePage = async (): Promise<string> => {
      if (tpl && Array.isArray(tpl.elements) && tpl.elements.length > 0) {
        const innerParts: string[] = [];
        for (const el of tpl.elements) {
          const x = Number(el.x) || 0; const y = Number(el.y) || 0;
          const w = typeof el.width === 'number' && el.width > 0 ? el.width : null;
          const h = typeof el.height === 'number' && el.height > 0 ? el.height : null;
          const fs = Number(el.fontSize) || 12;
          // 与编辑器画布一致：旋转/镜像/删除线/黑反同步落地，避免预览与画布版式分叉
          const transforms: string[] = [];
          if (el.rotation) transforms.push(`rotate(${el.rotation}deg)`);
          if (el.mirrorX) transforms.push('scaleX(-1)');
          if (el.mirrorY) transforms.push('scaleY(-1)');
          const deco = [el.isUnderline ? 'underline' : '', el.isStrikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
          // 与编辑器画布一致：无 width 时用自然宽度（nowrap），避免整行宽盒造成错位间距
          const pos = `position:absolute;left:${x}mm;top:${y}mm;z-index:${el.zIndex || 0};${w ? `width:${w}mm;` : 'width:auto;white-space:nowrap;'}${h ? `height:${h}mm;` : ''}font-size:${fs}pt;font-family:${el.fontFamily || 'inherit'};font-weight:${el.isBold ? 'bold' : 'normal'};font-style:${el.isItalic ? 'italic' : 'normal'};text-decoration:${deco};text-align:${el.textAlign || 'left'};${el.color && !el.isBlackReverse ? `color:${el.color};` : ''}${transforms.length ? `transform:${transforms.join(' ')};` : ''}${el.isBlackReverse ? 'background:#000;color:#fff;' : ''}overflow:visible;`;
          const adj = '-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;';
          if (el.type === 'text') { innerParts.push(`<div style="${pos}">${esc(el.content || '')}</div>`); continue; }
          if (el.type === 'hline') { innerParts.push(`<div style="${pos}width:${w || 40}mm;height:${h || 1}mm;border-top:${el.borderWidth || 1}px solid ${el.borderColor || '#000'};"></div>`); continue; }
          if (el.type === 'vline') { innerParts.push(`<div style="${pos}width:${w || 1}mm;height:${h || 40}mm;border-left:${el.borderWidth || 1}px solid ${el.borderColor || '#000'};"></div>`); continue; }
          if (el.type === 'rect') { innerParts.push(`<div style="${pos}width:${w || 20}mm;height:${h || 10}mm;border:${el.borderWidth || 1}px solid ${el.borderColor || '#000'};box-sizing:border-box;"></div>`); continue; }
          if (el.type === 'ellipse') { innerParts.push(`<div style="${pos}width:${w || 20}mm;height:${h || 10}mm;border:${el.borderWidth || 1}px solid ${el.borderColor || '#000'};border-radius:50%;box-sizing:border-box;"></div>`); continue; }
          if (el.type === 'image') { innerParts.push(`<div style="${pos}">${el.content ? `<img src="${el.content}" style="width:${w || 30}mm;height:${h || 30}mm;object-fit:contain;" />` : ''}</div>`); continue; }
          const val = el.type === 'field' ? fieldVal(p, el.field || '') : (el.content || '');
          const isQr = el.type === 'qrcode' || el.displayAs === 'qrcode';
          const isBc = el.type === 'barcode' || el.displayAs === 'barcode';
          const isImg = el.displayAs === 'image';
          if (isImg) {
            innerParts.push(`<div style="${pos}">${val ? `<img src="${val}" style="width:${w || 30}mm;height:${h || 30}mm;object-fit:contain;" />` : ''}</div>`);
            continue;
          }
          if (isQr) {
            const qw = Math.round((w || 20) * 3.78); // mm to px
            const qrDataUrl = await buildQrcodeDataUrl(val || 'QR', qw);
            const showLabel = el.showLabel !== false; // 默认显示
            innerParts.push(`<div style="${pos}">${qrDataUrl ? `<img src="${qrDataUrl}" style="width:${w || 20}mm;height:${w || 20}mm;" />` : ''}${(val && showLabel) ? `<div style="text-align:center;font-size:8pt;">${esc(val)}</div>` : ''}</div>`);
            continue;
          }
          if (isBc) {
            const bh = h ? h * 0.7 : 15;
            const showLabel = el.showLabel !== false; // 默认显示
            const barcodeSvg = buildBarcodeSvg(val, bh);
            // 使用完整 SVG（含 viewBox），通过 style 控制显示尺寸
            const bcWidth = w || 30;
            innerParts.push(`<div style="${pos}">${barcodeSvg ? `<div style="width:${bcWidth}mm;height:${bh}mm;line-height:0;">${barcodeSvg}</div>` : ''}${showLabel ? `<div style="text-align:center;font-size:8pt;">${esc(val)}</div>` : ''}</div>`);
            continue;
          }
          if (el.type === 'table') {
            // 表格：按对应商品编码取商品字段信息（列名/列宽百分比跟随模板配置）
            const cols: string[] = Array.isArray(tpl.tableColumns) && tpl.tableColumns.length ? tpl.tableColumns : ['商品编码', '商品名称', '数量'];
            const cwArr: number[] = Array.isArray(tpl.columnWidths) && tpl.columnWidths.length === cols.length ? tpl.columnWidths : Array(cols.length).fill(Math.round(100 / cols.length));
            const tfs = Number(tpl.tableFontSize) || 9;
            const cellVal = (col: string): string => {
              const cl = col.toLowerCase();
              if (cl.includes('库位')) return '—';
              if (cl.includes('数量') || cl.includes('qty')) return String(copies || 1);
              const price = p.basePrice != null && p.basePrice !== '' ? Number(p.basePrice) : (p.price != null && p.price !== '' ? Number(p.price) : 0);
              if (cl.includes('单价') || cl.includes('price')) return price ? `¥${price.toFixed(2)}` : '—';
              if (cl.includes('小计') || cl.includes('total') || cl.includes('金额')) return price ? `¥${(price * (copies || 1)).toFixed(2)}` : '—';
              const v = fieldVal(p, col);
              return v !== '' ? v : '—';
            };
            const ths = cols.map((c, ci) => `<th style="border:1px solid #333;padding:1px 2px;background:#f0f5ff;font-weight:600;text-align:center;width:${cwArr[ci]}%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c)}</th>`).join('');
            const tds = cols.map(c => `<td style="border:1px solid #333;padding:1px 2px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(cellVal(c))}</td>`).join('');
            innerParts.push(`<div style="position:absolute;left:${x}mm;top:${y}mm;width:${w || 60}mm;font-size:${tfs}pt;font-family:${el.fontFamily || 'inherit'};-webkit-print-color-adjust:exact;print-color-adjust:exact;"><table style="border-collapse:collapse;width:100%;table-layout:fixed;word-break:break-all;"><thead><tr>${ths}</tr></thead><tbody><tr>${tds}</tr></tbody></table></div>`);
            continue;
          }
          const fnPrefix = el.type === 'field' && el.showFieldName && el.field ? `${esc(el.field)}：` : '';
          innerParts.push(`<div style="${pos}">${fnPrefix}${esc(val).replace(/\n/g, '<br>')}</div>`);
        }
        return `<div class="pg">${innerParts.join('')}</div>`;
      }
      if (type === 'barcode') {
        const bcCode = p.barcode || p.productCode || '';
        const bcSvg = buildBarcodeSvg(bcCode, 10);
        return `<div class="pg" style="display:flex;flex-direction:column;justify-content:center;align-items:center;padding:3mm;">${bcSvg ? `<div style="width:40mm;height:10mm;line-height:0;">${bcSvg}</div>` : ''}<div style="text-align:center;font-size:8pt;margin-top:1mm;">${esc(bcCode)}</div></div>`;
      }
      if (type === 'wash') {
        const custom = customContents.find((c: any) => c.name === selCustom)?.content || '';
        return `<div class="pg" style="padding:5mm;font-size:9pt;line-height:1.7;">
          <div style="font-size:11pt;font-weight:bold;">${esc(p.shortName || p.name || '')}</div>
          <div>商品编码：${esc(p.productCode || '')}</div>
          <div>颜色/规格：${esc(p.color || '')} / ${esc(p.spec || '')}</div>
          <div>款式：${esc(p.styleCode || '')}</div>
          ${custom ? `<div style="white-space:pre-wrap;margin-top:2mm;">${esc(custom)}</div>` : ''}
        </div>`;
      }
      if (type === 'carton') {
        const bcCode = p.barcode || p.productCode || '';
        const bcSvg = buildBarcodeSvg(bcCode, 12);
        return `<div class="pg" style="padding:6mm;font-size:10pt;line-height:1.8;text-align:center;">
          <div style="font-size:13pt;font-weight:bold;">${esc(p['商品名称'] || p.name || '')}</div>
          <div>商品编码：${esc(p['商品编码'] || p.productCode || '')}</div>
          <div>每箱数量：${esc(p['每箱数量'] ?? '')}</div>
          <div>外箱尺寸：${esc(p['外箱尺寸'] || '')}</div>
          <div>毛重/净重：${esc(p['毛重'] || '')} / ${esc(p['净重'] || '')}</div>
          <div style="margin-top:3mm;">${bcSvg ? `<div style="width:50mm;height:12mm;line-height:0;">${bcSvg}</div>` : ''}<div style="text-align:center;font-size:8pt;">${esc(bcCode)}</div></div>
        </div>`;
      }
      const custom = customContents.find((c: any) => c.name === selCustom)?.content || '';
      const bcCode = p.barcode || p.productCode || '';
      const bcSvg = buildBarcodeSvg(bcCode, 12);
      return `<div class="pg" style="padding:6mm;text-align:center;">
        <div style="font-size:13pt;font-weight:bold;">${esc(p.shortName || p.name || '')}</div>
        <div style="font-size:9pt;margin-top:2mm;">${esc(p.styleCode || '')} ${esc(p.color || '')} ${esc(p.spec || '')}</div>
        <div style="margin-top:3mm;">${bcSvg ? `<div style="width:50mm;height:12mm;line-height:0;">${bcSvg}</div>` : ''}<div style="text-align:center;font-size:8pt;">${esc(bcCode)}</div></div>
        ${multiInfo ? `<div style="font-size:8pt;margin-top:2mm;">单件订单：${orderStats.orderCount} 单 / 多件订单：${orderStats.totalQty} 件</div>` : ''}
        ${custom ? `<div style="font-size:8pt;margin-top:1mm;white-space:pre-wrap;">${esc(custom)}</div>` : ''}
        <div style="font-size:8pt;margin-top:2mm;">${esc(p.brand || '')}</div>
      </div>`;
    };
    const pages = await Promise.all(Array(Math.max(1, copies)).fill(0).map(() => onePage()));
    return pages.join('');
  }, [tplIds, fieldVal, customContents, selCustom, multiInfo, orderStats, resolveTplId]);

  const openPreview = useCallback(async (type: TplType, rows: { product: any; qty: number }[], title: string) => {
    if (!rows.length) { message.warning('没有可打印的商品'); return; }
    const pages = (await Promise.all(rows.map(r => buildPages(type, r.product, r.qty)))).join('');
    const tpl = loadTpl(type, resolveTplId(type));
    const pw = Number(tpl?.paperWidth) || TPL_PAPER[type].w;
    const ph = Number(tpl?.paperHeight) || TPL_PAPER[type].h;
    setPreviewTitle(title);
    // 屏幕预览：纸张外灰色底、纸张白色居中带阴影；打印时恢复纯白无阴影
    setPreviewHtml(`<html><head><meta charset="utf-8"><style>@page{size:${pw}mm ${ph}mm;margin:0;}body{margin:0;background:#8f9aa5;font-family:'Microsoft YaHei',sans-serif;}.pg{position:relative;z-index:0;width:${pw}mm;height:${ph}mm;page-break-after:always;overflow:hidden;box-sizing:border-box;background:#fff;box-shadow:0 1px 10px rgba(0,0,0,.35);margin:12px auto;}@media print{body{background:#fff;}.pg{margin:0;box-shadow:none;}}</style></head><body>${pages}</body></html>`);
    setPreviewVisible(true);
  }, [buildPages, resolveTplId]);

  const doPrintRow = async (type: TplType, copies: number) => {
    if (!selProduct) { message.warning('请先搜索并选择商品'); return; }
    const tpl = loadTpl(type, resolveTplId(type));
    const pw = Number(tpl?.paperWidth) || TPL_PAPER[type].w;
    const ph = Number(tpl?.paperHeight) || TPL_PAPER[type].h;
    setPrintLoading(true);
    try {
      // 1. 生成打印 HTML
      const pages = await buildPages(type, selProduct, copies);
      const html = `<html><head><meta charset="utf-8"><style>@page{size:${pw}mm ${ph}mm;margin:0;}body{margin:0;background:#fff;font-family:'Microsoft YaHei',sans-serif;}.pg{position:relative;z-index:0;width:${pw}mm;height:${ph}mm;page-break-after:always;overflow:hidden;box-sizing:border-box;background:#fff;margin:0;}</style></head><body>${pages}</body></html>`;
      // 2. 上传 HTML 到服务端，获取可访问 URL
      const renderRes = await request.post('/print/render', { html });
      const printUrl = renderRes?.data?.data?.url;
      if (!printUrl) { message.error('打印内容生成失败'); setPrintLoading(false); return; }
      // 3. 提交打印任务到打印客户端（静默打印，无弹窗）
      const printerName = printer === '默认使用模板设置的打印机' ? (tpl?.printerName || '') : printer;
      const username = localStorage.getItem('username') || '';
      const jobRes = await request.post('/print/job', { type: 'url', content: printUrl, printerName, copies, username });
      if (jobRes?.data?.code === 0) {
        const taskId = jobRes?.data?.data?.taskId || '';
        setPrintTaskId(taskId);
        message.success(`吊牌打印任务已提交（${copies} 份）`);
      } else {
        message.error(jobRes?.data?.message || '打印任务提交失败');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '打印失败';
      message.error(msg);
    } finally {
      setPrintLoading(false);
    }
  };

  // 取消当前打印任务
  const doCancelPrint = async () => {
    if (!printTaskId) { message.warning('没有正在进行的打印任务'); return; }
    const username = localStorage.getItem('username') || '';
    try {
      await request.post(`/print/job/${printTaskId}/cancel`, { username });
      message.success('取消指令已发送');
      setPrintTaskId('');
    } catch {
      message.error('取消失败');
    }
  };

  // 搜索：回车与搜索按钮共用
  const doSearch = () => {
    setApplied({ type: fType, style: fStyle.trim(), name: fName.trim(), brand: fBrand, status: fStatus, sup: fSup.trim(), supCode: fSupCode.trim(), codeType: fCodeType, code: '', codeMerge: fCodeMerge.trim(), aux: fAux.trim(), supCode2: fSupCode2.trim() });
    setSelColor(''); setSelSpec('');
  };

  // 扫码直打：勾选后在三个编码输入框回车（扫码枪自动回车）即匹配商品并执行一次打印吊牌
  const scanPrintFrom = (kind: 'merge' | 'aux' | 'sup') => {
    const val = (kind === 'merge' ? fCodeMerge : kind === 'aux' ? fAux : fSupCode2).trim();
    if (!scanDirect || !val) { doSearch(); return; }
    const lv = val.toLowerCase();
    const p = products.find((x: any) => (kind === 'merge'
      ? [x.productCode, x.barcode, x.nationalCode].some(v => String(v || '').toLowerCase().includes(lv))
      : kind === 'aux'
        ? [x.auxCode, x.nationalCode].some(v => String(v || '').toLowerCase().includes(lv))
        : String(x.supplierProductCode || '').toLowerCase().includes(lv)));
    if (!p) { message.warning('未匹配到商品，无法直接打印'); return; }
    setSelCode(p.productCode);
    setSelColor(String(p.color || '').trim()); setSelSpec(String(p.spec || '').trim());
    setTimeout(() => doPrintRow('tag', qty1), 100);
  };

  // 编辑商品属性：回写商品档案（本地+服务端同步）
  const saveAttrEdit = () => {
    if (!selProduct) return;
    const next = products.map((p: any) => (p.productCode === selProduct.productCode ? { ...p, ...attrForm } : p));
    setProducts(next);
    safeSetItem(productKey, JSON.stringify(next));
    saveDataset(productKey, JSON.stringify(next));
    setAttrModal(false);
    message.success('商品属性已保存');
  };

  // ============ 子页B 状态 ============
  const [importTab, setImportTab] = useState('purchase');
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [gridChecked, setGridChecked] = useState<string[]>([]);
  const [focusKey, setFocusKey] = useState('');
  const [pickVisible, setPickVisible] = useState(false);
  const [pickKw, setPickKw] = useState('');
  const [pickChecked, setPickChecked] = useState<string[]>([]);
  const [srcModal, setSrcModal] = useState<'' | 'purchase' | 'production' | 'file'>('');
  const [srcChecked, setSrcChecked] = useState<string[]>([]);
  const [fileText, setFileText] = useState('');
  const [batchVisible, setBatchVisible] = useState(false);
  const [batchQty, setBatchQty] = useState(1);

  // ============ 子页C：箱规码打印 ============
  const cartonKey = `pageData_product_print_carton_${owner}`;
  const [cartonGrid, setCartonGrid] = useState<any[]>([]);
  const [cartonChecked, setCartonChecked] = useState<string[]>([]);
  const [cartonQty, setCartonQty] = useState(1);
  useEffect(() => { setCartonGrid(loadJson(cartonKey, [])); }, [cartonKey]);
  const persistCarton = (rows: any[]) => {
    setCartonGrid(rows);
    safeSetItem(cartonKey, JSON.stringify(rows));
    saveDataset(cartonKey, JSON.stringify(rows));
  };
  const printCarton = () => {
    const rows = cartonChecked.length ? cartonGrid.filter(g => cartonChecked.includes(g.key)) : cartonGrid;
    if (!rows.length) { message.warning('没有可打印的箱规行'); return; }
    const payload = rows.map((r: any) => ({
      product: {
        '商品名称': r.name || '', '商品编码': r.productCode || '', '每箱数量': r.qtyPerCarton ?? '',
        '外箱尺寸': r.cartonSize || '', '毛重': r.gross || '', '净重': r.net || '',
        barcode: (products.find((p: any) => p.productCode === r.productCode) || {}).barcode || r.productCode || '',
      },
      qty: cartonQty,
    }));
    openPreview('carton', payload, `箱规码打印预览(${rows.length} 行)`);
  };

  useEffect(() => { setGrid(loadJson(importKey, [])); }, [importKey]);
  const persistGrid = (rows: GridRow[]) => {
    setGrid(rows);
    safeSetItem(importKey, JSON.stringify(rows));
    saveDataset(importKey, JSON.stringify(rows));
  };
  const genKey = () => `gr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const rowFromProduct = (p: any, qty: number): GridRow => ({
    key: genKey(), productCode: p.productCode || '', qty,
    styleCode: p.styleCode || '', colorSpec: [p.color, p.spec].filter(Boolean).join(':'),
    name: p.shortName || p.name || '', image: p.image || '',
    attr1: '', attr2: '', attr3: '', attr4: p.shoeSole || '', attr5: p.shoeUpper || '',
  });
  const appendRows = (rows: GridRow[]) => {
    if (!rows.length) { message.warning('没有可导入的行'); return; }
    persistGrid([...grid, ...rows]);
    message.success(`已导入 ${rows.length} 行`);
  };

  const purchaseRows = useMemo<any[]>(() => {
    if (srcModal !== 'purchase') return [];
    const list: any[] = loadJson(`pageData_production_purchase-requisition_${owner}`, []);
    return (Array.isArray(list) ? list : []).filter((r: any) => r.status === '待采购');
  }, [srcModal, owner]);
  // 生产订单导入：同一生产单号合并为一行展示（不拆分明细），勾选后导入该单号下全部商品明细
  const productionRows = useMemo<any[]>(() => {
    if (srcModal !== 'production') return [];
    const list: any[] = loadJson(`pageData_production_production-order_${owner}`, []);
    const out: any[] = [];
    (Array.isArray(list) ? list : []).forEach((po: any) => {
      let items: any[] = [];
      try { items = Array.isArray(po.planItems) ? po.planItems : JSON.parse(po.planItems || '[]'); } catch { items = []; }
      if (!items.length) return;
      const details = items.map((it: any) => ({ productCode: it.productCode || '', qty: Number(it.quantity) || 1, name: it.shortName || it.name || '' }));
      out.push({
        key: po.id, poId: po.id,
        itemCount: details.length,
        totalQty: details.reduce((s: number, d: any) => s + d.qty, 0),
        details,
        summary: details.map((d: any) => `${d.productCode}×${d.qty}`).join('，'),
      });
    });
    return out;
  }, [srcModal, owner]);

  const importFromSource = () => {
    if (srcModal === 'purchase') {
      const rows = purchaseRows.filter((r: any) => srcChecked.includes(r.key || r.id)).map((r: any) => {
        const p = products.find((x: any) => x.productCode === r.productCode);
        return p ? rowFromProduct(p, Number(r.needTotalQty || r.totalQty || r.planQty || r.quantity || 1)) : { ...rowFromProduct({ productCode: r.productCode }, 1), name: r.shortName || '' };
      });
      appendRows(rows);
    } else if (srcModal === 'production') {
      // 勾选生产单号：把该单号下的全部商品明细展开填充到打印列表
      const rows: GridRow[] = [];
      productionRows.filter(r => srcChecked.includes(r.key)).forEach((r: any) => {
        (r.details || []).forEach((d: any) => {
          const p = products.find((x: any) => x.productCode === d.productCode);
          rows.push(p ? rowFromProduct(p, d.qty) : { ...rowFromProduct({ productCode: d.productCode }, d.qty), name: d.name });
        });
      });
      appendRows(rows);
    } else if (srcModal === 'file') {
      const bad: string[] = [];
      const rows: GridRow[] = [];
      fileText.split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (!t) return;
        const parts = t.split(/[\s,，\t]+/);
        const code = (parts[0] || '').trim();
        const qty = Number(parts[1]) || 1;
        if (!code) { bad.push(`第${i + 1}行`); return; }
        const p = products.find((x: any) => x.productCode === code || x.barcode === code);
        if (!p) { bad.push(`第${i + 1}行(${code})`); return; }
        rows.push(rowFromProduct(p, qty));
      });
      if (bad.length) message.warning(`以下行无法导入：${bad.slice(0, 5).join('、')}${bad.length > 5 ? ' 等' : ''}`);
      appendRows(rows);
    }
    setSrcChecked([]); setFileText(''); setSrcModal('');
  };

  const printGrid = (type: TplType) => {
    const rows = (gridChecked.length ? grid.filter(g => gridChecked.includes(g.key)) : grid);
    if (!rows.length) { message.warning('没有可打印的行'); return; }
    const payload = rows.map(r => ({ product: products.find((p: any) => p.productCode === r.productCode) || { productCode: r.productCode, name: r.name }, qty: r.qty }));
    openPreview(type, payload, `${TPL_LABEL[type]}打印预览 - 导入清单(${rows.length} 行)`);
  };

  const gridColumns: any[] = [
    { title: '', key: 'idx', width: 36, align: 'center', render: (_: any, __: any, i: number) => i + 1 },
    { title: '图', key: 'img', width: 50, align: 'center', render: (_: any, r: GridRow) => r.image ? <Image src={r.image} width={32} height={32} style={{ objectFit: 'cover' }} /> : '—' },
    { title: '商品编码', dataIndex: 'productCode', width: 150, render: (v: string, r: GridRow) => <Input size="small" value={v} onChange={e => setGrid(prev => prev.map(x => {
      if (x.key !== r.key) return x;
      const nx = { ...x, productCode: e.target.value };
      const p = products.find((pp: any) => pp.productCode === e.target.value);
      if (p) { nx.styleCode = p.styleCode || ''; nx.colorSpec = [p.color, p.spec].filter(Boolean).join(':'); nx.name = p.shortName || p.name || ''; nx.image = p.image || ''; nx.attr4 = p.shoeSole || ''; nx.attr5 = p.shoeUpper || ''; }
      return nx;
    }))} /> },
    { title: '数量', dataIndex: 'qty', width: 80, align: 'center', render: (v: number, r: GridRow) => <InputNumber size="small" min={1} value={v} onChange={n => setGrid(prev => prev.map(x => x.key === r.key ? { ...x, qty: Number(n) || 1 } : x))} /> },
    { title: '款式编码', dataIndex: 'styleCode', width: 110, align: 'center' },
    { title: '颜色尺码', dataIndex: 'colorSpec', width: 110, align: 'center' },
    { title: '商品名', dataIndex: 'name', width: 130 },
    ...[1, 2, 3, 4, 5].map(n => ({
      title: n === 4 ? '鞋底材质' : n === 5 ? '鞋面材质' : `其它属性${n}`,
      dataIndex: `attr${n}`, width: 110,
      render: (v: string, r: GridRow) => <Input size="small" value={v || ''} onFocus={() => setFocusKey(r.key)} onChange={e => setGrid(prev => prev.map(x => x.key === r.key ? { ...x, [`attr${n}`]: e.target.value } : x))} />,
    })),
  ];

  const pickOptions = useMemo(() => {
    const q = pickKw.trim().toLowerCase();
    return products.filter((p: any) => !q || (p.productCode || '').toLowerCase().includes(q) || (p.styleCode || '').toLowerCase().includes(q) || (p.shortName || p.name || '').toLowerCase().includes(q));
  }, [products, pickKw]);

  const tplOptions = (type: TplType) => loadTplList(type).map(t => ({ value: t.id, label: t.name }));

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 0, background: '#fff' }}>
      {/* 左侧二级子菜单 */}
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid #e3e8ee', background: '#f7f9fc' }}>
        <Menu mode="inline" selectedKeys={[activeSub]} style={{ border: 'none', background: 'transparent' }}
          items={SUB_MENUS.map(m => ({ key: m.key, label: m.label }))}
          onClick={({ key }) => setActiveSub(key)} />
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: 12, overflowY: 'auto' }}>
        {activeSub === 'print-tag' && (
          <>
            {/* 筛选区 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Select size="small" style={{ width: 100 }} value={fType} onChange={setFType}
                options={[{ value: 'all', label: '所有类型' }, { value: '成品', label: '成品' }, { value: '半成品', label: '半成品' }, { value: '原材料', label: '原材料' }]} />
              <Input size="small" style={{ width: 130 }} placeholder="款式编码" value={fStyle} onChange={e => setFStyle(e.target.value)} onPressEnter={doSearch} />
              <Input size="small" style={{ width: 130 }} placeholder="商品名称" value={fName} onChange={e => setFName(e.target.value)} onPressEnter={doSearch} />
              <Select size="small" style={{ width: 120 }} placeholder="品牌" value={fBrand || undefined} allowClear onChange={v => setFBrand(v || '')} options={brands.map(b => ({ value: b, label: b }))} />
              <Select size="small" style={{ width: 110 }} placeholder="启用&备用" value={fStatus || undefined} allowClear onChange={v => setFStatus(v || '')} options={['启用', '备用', '停用'].map(s => ({ value: s, label: s }))} />
              <Input size="small" style={{ width: 130 }} placeholder="供应商名称" value={fSup} onChange={e => setFSup(e.target.value)} onPressEnter={doSearch} />
              <Input size="small" style={{ width: 130 }} placeholder="供应商商品编码" value={fSupCode} onChange={e => setFSupCode(e.target.value)} onPressEnter={doSearch} />
              <Button size="small" type="primary" icon={<SearchOutlined />} onClick={() => { doSearch(); message.info(`已查询，命中 ${filteredProducts.length} 个商品`); }}>搜索</Button>
              <Button size="small" onClick={() => { setFType('all'); setFStyle(''); setFName(''); setFBrand(''); setFStatus(''); setFSup(''); setFSupCode(''); setFCodeMerge(''); setFAux(''); setFSupCode2(''); setSelColor(''); setSelSpec(''); setApplied(null); }}>清空</Button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Select size="small" style={{ width: 130 }} value={fCodeType} onChange={setFCodeType} options={[{ value: 'productCode', label: '商品编码' }, { value: 'barcode', label: '条形码' }]} />
              <Input size="small" style={{ width: 220 }} placeholder="商品编码/条形码/国标码 合并搜索" value={fCodeMerge} onChange={e => setFCodeMerge(e.target.value)} onPressEnter={() => scanPrintFrom('merge')} />
              <Input size="small" style={{ width: 130 }} placeholder="辅助码" value={fAux} onChange={e => setFAux(e.target.value)} onPressEnter={() => scanPrintFrom('aux')} />
              <Input size="small" style={{ width: 150 }} placeholder="供应商商品编码" value={fSupCode2} onChange={e => setFSupCode2(e.target.value)} onPressEnter={() => scanPrintFrom('sup')} />
              <Checkbox checked={scanDirect} onChange={e => setScanDirect(e.target.checked)}>扫码直接打印</Checkbox>
              <Button size="small" type="link" icon={<SettingOutlined />} onClick={() => navigate('/settings/print-template?type=tag')}>吊牌条码打印设置</Button>
            </div>
            {/* 货号搜索：颜色/规格两行级联选择 */}
            <div style={{ background: '#fafafa', border: '1px solid #e3e8ee', padding: '12px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap', lineHeight: '28px', minWidth: 36 }}>货号</Text>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {colorOptions.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>（请先搜索，第一行选择颜色）</Text>}
                    {colorOptions.map(c => (
                      <Tag key={c} color={selColor === c ? 'blue' : undefined} style={{ cursor: 'pointer', margin: 0, fontSize: 13, padding: '3px 10px' }}
                        onClick={() => { setSelColor(c); setSelSpec(''); }}>{c}</Tag>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {selColor && specOptions.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>该颜色无规格可选</Text>}
                    {specOptions.map(s => (
                      <Tag key={s || 'default'} color={selSpec === s ? 'green' : undefined} style={{ cursor: 'pointer', margin: 0, fontSize: 13, padding: '3px 10px' }}
                        onClick={() => {
                          setSelSpec(s);
                          const p = filteredProducts.find((x: any) => (x.color || '') === selColor && (x.spec || '') === s);
                          if (p) {
                            setSelCode(p.productCode);
                            if (scanDirect) setTimeout(() => doPrintRow('tag', 1), 100);
                          }
                        }}>{s || '默认规格'}</Tag>
                    ))}
                    {selCode && <Text type="secondary" style={{ fontSize: 13, marginLeft: 10 }}>已选：{selCode}</Text>}
                  </div>
                </div>
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>候选 {filteredProducts.length} 个商品</Text>
              </div>
            </div>

            {/* 商品详细信息：横向展示在上（带表格边框） */}
            <div style={{ border: '1px solid #e3e8ee', background: '#fafafa', padding: 12, marginBottom: 10, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {(selProduct?.image || (selProduct?.key ? localStorage.getItem(`prodImg_${owner}_${selProduct.key}`) || '' : '')) ? <Image src={selProduct?.image || (selProduct?.key ? localStorage.getItem(`prodImg_${owner}_${selProduct.key}`) || '' : '')} width={184} height={184} style={{ objectFit: 'cover', border: '1px solid #e3e8ee', background: '#fff' }} />
                : <div style={{ width: 184, height: 184, background: '#fff', border: '1px solid #e3e8ee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bfbfbf', fontSize: 12 }}>暂无图片</div>}
              {(() => {
                const infoFields = [
                  { l: '商品名称', v: selProduct ? (selProduct.shortName || selProduct.name || '') : '' },
                  { l: '商品编码', v: selProduct?.productCode || '' },
                  { l: '款式编码', v: selProduct?.styleCode || '' },
                  { l: '库存数量', v: selProduct ? String(Number(selProduct.actualStock) || 0) : '' },
                  { l: '现有主仓可配货数', v: selProduct ? String(Number(selProduct.actualStock) || 0) : '' },
                  { l: '其他属性1', v: selProduct?.otherProp1 || '' },
                  { l: '其他属性2', v: selProduct?.otherProp2 || '' },
                  { l: '其他属性3', v: selProduct?.otherProp3 || '' },
                  { l: '鞋面材质', v: selProduct?.shoeUpper || '' },
                  { l: '鞋底材质', v: selProduct?.shoeSole || '' },
                  { l: '条形码', v: selProduct?.barcode || '' },
                  { l: '国标码', v: selProduct?.nationalCode || '' },
                  { l: '辅助码', v: selProduct?.auxCode || '' },
                  { l: '建议零售价', v: selProduct?.retailPrice != null && selProduct?.retailPrice !== '' ? `¥${Number(selProduct.retailPrice).toFixed(2)}` : '' },
                  { l: '产品种类', v: selProduct?.productType || '' },
                ];
                return (
                  <table style={{ borderCollapse: 'collapse', flex: 1, minWidth: 0, background: '#fff', tableLayout: 'fixed' }}>
                    <tbody>
                      {[0, 1, 2].map(r => (
                        <tr key={r}>
                          {infoFields.slice(r * 5, r * 5 + 5).map(f => (
                            <React.Fragment key={f.l}>
                              <td style={{ border: '1px solid #e3e8ee', background: '#fafafa', padding: '8px 10px', fontSize: 12, color: '#8c8c8c', width: 110, whiteSpace: 'nowrap' }}>{f.l}</td>
                              <td style={{ border: '1px solid #e3e8ee', padding: '8px 10px', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.v || '—'}</td>
                            </React.Fragment>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            {/* 打印控制栏：放下 */}
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                <Button size="small" icon={<EditOutlined />} disabled={!selProduct} onClick={() => { setAttrForm({ name: selProduct?.name || '', shortName: selProduct?.shortName || '', styleCode: selProduct?.styleCode || '', color: selProduct?.color || '', spec: selProduct?.spec || '', otherProp1: selProduct?.otherProp1 || '', otherProp2: selProduct?.otherProp2 || '', otherProp3: selProduct?.otherProp3 || '', shoeUpper: selProduct?.shoeUpper || '', shoeSole: selProduct?.shoeSole || '' }); setAttrModal(true); }}>编辑商品属性</Button>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <Select size="large" style={{ width: 220, height: 48 }} value={tplIds.tag} onChange={v => setTplIds(prev => ({ ...prev, tag: v }))} options={tplOptions('tag')} />
                <Select size="large" style={{ width: 280, height: 48 }} value={printer} onChange={setPrinter}
                  onDropdownVisibleChange={open => { if (open) reloadPrinters(); }}
                  options={[{ value: '默认使用模板设置的打印机', label: '默认使用模板设置的打印机' }, ...printerList.map((pl: any) => ({ value: pl.name, label: pl.name + (pl.isDefault ? '（系统默认）' : '') + (pl.clientName ? `（@${pl.clientName}）` : '') })), ...(printerList.length ? [] : [{ value: '__print_client_offline__', label: `（打印客户端未在线：请在接打印机的电脑启动讯能手打印客户端，并登录 ${window.location.origin}）`, disabled: true }])]} />
                <Text style={{ fontSize: 15 }}>打印数量:</Text>
                <InputNumber size="large" min={1} style={{ height: 48, width: 90 }} value={qty1} onChange={n => setQty1(Number(n) || 1)} />
                <Button size="large" type="primary" icon={<PrinterOutlined />} style={{ height: 48, fontSize: 16, padding: '0 28px' }} disabled={!selProduct || printLoading} loading={printLoading} onClick={() => doPrintRow('tag', qty1)}>打印吊牌</Button>
                <Button size="large" icon={<CloseOutlined />} style={{ height: 48, fontSize: 15 }} disabled={!printTaskId} onClick={doCancelPrint}>取消任务</Button>
                <Button size="large" icon={<EditOutlined />} style={{ height: 48, fontSize: 15 }} onClick={() => navigate('/settings/print-template?type=tag')}>编辑吊牌模板</Button>
                <Button size="large" icon={<EyeOutlined />} style={{ height: 48, fontSize: 15 }} disabled={!selProduct} onClick={() => doPrintRow('tag', qty1)}>打印预览</Button>
              </div>
            </div>
          </>
        )}

        {activeSub === 'import-print' && (
          <>
            <Tabs size="small" activeKey={importTab} onChange={setImportTab} items={[
              { key: 'purchase', label: '从采购单导入' },
              { key: 'production', label: '从生产订单导入' },
              { key: 'file', label: '从文件导入' },
              { key: 'free', label: '自由选择商品编码' },
            ]} style={{ marginBottom: 4 }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {importTab === 'purchase' && <Button size="small" icon={<PlusOutlined />} onClick={() => { setSrcChecked([]); setSrcModal('purchase'); }}>选择采购单行导入</Button>}
              {importTab === 'production' && <Button size="small" icon={<PlusOutlined />} onClick={() => { setSrcChecked([]); setSrcModal('production'); }}>选择生产订单明细导入</Button>}
              {importTab === 'file' && <Button size="small" icon={<FileTextOutlined />} onClick={() => { setFileText(''); setSrcModal('file'); }}>粘贴文件内容导入</Button>}
              {importTab === 'free' && <Button size="small" icon={<PlusOutlined />} onClick={() => { setPickChecked([]); setPickKw(''); setPickVisible(true); }}>选择商品导入</Button>}
              <Dropdown menu={{ items: loadTplList('tag').map(t => ({ key: t.id, label: t.name })), onClick: ({ key }) => { setTplIds(prev => ({ ...prev, tag: key })); printGrid('tag'); } }}>
                <Button size="small" icon={<PrinterOutlined />}>打印商品吊牌预览</Button>
              </Dropdown>
              <Dropdown menu={{ items: loadTplList('barcode').map(t => ({ key: t.id, label: t.name })), onClick: ({ key }) => { setTplIds(prev => ({ ...prev, barcode: key })); printGrid('barcode'); } }}>
                <Button size="small" icon={<PrinterOutlined />}>打印商品条码预览</Button>
              </Dropdown>
              <Dropdown menu={{ items: loadTplList('wash').map(t => ({ key: t.id, label: t.name })), onClick: ({ key }) => { setTplIds(prev => ({ ...prev, wash: key })); printGrid('wash'); } }}>
                <Button size="small" icon={<PrinterOutlined />}>打印商品水洗标预览</Button>
              </Dropdown>
              <Button size="small" icon={<PlusOutlined />} onClick={() => { setPickChecked([]); setPickKw(''); setPickVisible(true); }}>添加商品</Button>
              <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => { persistGrid(grid); message.success('已保存导入清单'); }}>保存</Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!gridChecked.length} onClick={() => { persistGrid(grid.filter(g => !gridChecked.includes(g.key))); setGridChecked([]); message.success('已删除勾选行'); }}>删除</Button>
              <Popconfirm title="确定清空全部导入行？" onConfirm={() => { persistGrid([]); setGridChecked([]); }}>
                <Button size="small" danger icon={<ClearOutlined />}>全部清除</Button>
              </Popconfirm>
              <Button size="small" icon={<SettingOutlined />} onClick={() => { setBatchQty(qty1); setBatchVisible(true); }}>批量打印设置</Button>
            </div>
            <Table bordered size="small" dataSource={grid} rowKey="key" pagination={false}
              scroll={{ y: 'calc(100vh - 360px)' }}
              rowSelection={{ selectedRowKeys: gridChecked, onChange: keys => setGridChecked(keys as string[]) }}
              rowClassName={(r: any) => (r.key === focusKey ? 'row-focus-yellow' : '')}
              columns={gridColumns}
              locale={{ emptyText: <Empty description="暂无导入行，请从上方导入或添加商品" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
            <style>{`.row-focus-yellow td { background: #fff3bf !important; }`}</style>
          </>
        )}

        {activeSub === 'carton-spec' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
              <Select size="small" style={{ width: 160 }} value={tplIds.carton} onChange={v => setTplIds(prev => ({ ...prev, carton: v }))} options={tplOptions('carton')} />
              <Text style={{ fontSize: 12 }}>打印数量:</Text>
              <InputNumber size="small" min={1} value={cartonQty} onChange={n => setCartonQty(Number(n) || 1)} />
              <Button size="small" icon={<PlusOutlined />} onClick={() => persistCarton([...cartonGrid, { key: genKey(), productCode: '', name: '', qtyPerCarton: 1, cartonSize: '', gross: '', net: '' }])}>添加行</Button>
              <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => { persistCarton(cartonGrid); message.success('已保存箱规行'); }}>保存</Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!cartonChecked.length} onClick={() => { persistCarton(cartonGrid.filter(g => !cartonChecked.includes(g.key))); setCartonChecked([]); message.success('已删除勾选行'); }}>删除</Button>
              <Popconfirm title="确定清空全部箱规行？" onConfirm={() => { persistCarton([]); setCartonChecked([]); }}>
                <Button size="small" danger icon={<ClearOutlined />}>全部清除</Button>
              </Popconfirm>
              <Button size="small" type="primary" icon={<PrinterOutlined />} onClick={printCarton}>打印预览</Button>
              <Button size="small" icon={<EditOutlined />} onClick={() => navigate('/settings/print-template?type=carton')}>编辑箱唛模板</Button>
            </div>
            <Table bordered size="small" dataSource={cartonGrid} rowKey="key" pagination={false}
              rowSelection={{ selectedRowKeys: cartonChecked, onChange: k => setCartonChecked(k as string[]) }}
              columns={[
                { title: '商品编码', dataIndex: 'productCode', width: 170, render: (v: string, r: any) => <Input size="small" value={v} onChange={e => { const code = e.target.value; const p = products.find((x: any) => x.productCode === code); setCartonGrid(prev => prev.map(x => x.key === r.key ? { ...x, productCode: code, name: p ? (p.shortName || p.name || '') : x.name } : x)); }} /> },
                { title: '商品名称', dataIndex: 'name', width: 170, render: (v: string, r: any) => <Input size="small" value={v} onChange={e => setCartonGrid(prev => prev.map(x => x.key === r.key ? { ...x, name: e.target.value } : x))} /> },
                { title: '每箱数量', dataIndex: 'qtyPerCarton', width: 90, align: 'center', render: (v: number, r: any) => <InputNumber size="small" min={1} value={v} onChange={n => setCartonGrid(prev => prev.map(x => x.key === r.key ? { ...x, qtyPerCarton: Number(n) || 1 } : x))} /> },
                { title: '外箱尺寸(长*宽*高cm)', dataIndex: 'cartonSize', width: 180, render: (v: string, r: any) => <Input size="small" value={v} onChange={e => setCartonGrid(prev => prev.map(x => x.key === r.key ? { ...x, cartonSize: e.target.value } : x))} /> },
                { title: '毛重(kg)', dataIndex: 'gross', width: 100, align: 'center', render: (v: string, r: any) => <Input size="small" value={v} onChange={e => setCartonGrid(prev => prev.map(x => x.key === r.key ? { ...x, gross: e.target.value } : x))} /> },
                { title: '净重(kg)', dataIndex: 'net', width: 100, align: 'center', render: (v: string, r: any) => <Input size="small" value={v} onChange={e => setCartonGrid(prev => prev.map(x => x.key === r.key ? { ...x, net: e.target.value } : x))} /> },
              ]}
              locale={{ emptyText: <Empty description="暂无箱规行，点击“添加行”录入" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </>
        )}
      </div>

      {/* 打印预览弹窗（iframe + 浏览器打印） */}
      <Modal title={previewTitle} open={previewVisible} onCancel={() => setPreviewVisible(false)} width={820} zIndex={1500}
        footer={<Space>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => { try { iframeRef.current?.contentWindow?.focus(); iframeRef.current?.contentWindow?.print(); } catch { message.error('打印失败'); } }}>打印</Button>
          <Button onClick={() => setPreviewVisible(false)}>关闭</Button>
        </Space>}>
        <iframe ref={iframeRef} title="print-preview" srcDoc={previewHtml} style={{ width: '100%', height: 480, border: '1px solid #e3e8ee' }} />
      </Modal>

      {/* 自定义内容维护弹窗 */}
      <Modal title="维护自定义打印内容" open={customModal} onCancel={() => setCustomModal(false)} footer={<Button onClick={() => setCustomModal(false)}>关闭</Button>} width={640}>
        <CustomContentEditor list={customContents} onChange={list => { setCustomContents(list); safeSetItem(customKey, JSON.stringify(list)); saveDataset(customKey, JSON.stringify(list)); }} />
      </Modal>

      {/* 商品选择弹窗（自由导入/添加商品） */}
      <Modal title="选择商品" open={pickVisible} onCancel={() => setPickVisible(false)} width={720}
        onOk={() => {
          const rows = pickChecked.map(code => products.find((p: any) => p.productCode === code)).filter(Boolean).map((p: any) => rowFromProduct(p, 1));
          appendRows(rows);
          setPickVisible(false);
        }} okText="导入">
        <Input size="small" placeholder="搜索商品编码/款式/名称" value={pickKw} onChange={e => setPickKw(e.target.value)} style={{ marginBottom: 8 }} />
        <Table bordered size="small" dataSource={pickOptions.slice(0, 100)} rowKey="productCode" pagination={false} scroll={{ y: 360 }}
          rowSelection={{ selectedRowKeys: pickChecked, onChange: keys => setPickChecked(keys as string[]) }}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', width: 150 },
            { title: '款式编码', dataIndex: 'styleCode', width: 110 },
            { title: '商品简称', dataIndex: 'shortName', width: 130 },
            { title: '颜色/规格', width: 120, render: (_: any, r: any) => `${r.color || ''}/${r.spec || ''}` },
          ]} />
      </Modal>

      {/* 来源导入弹窗 */}
      <Modal title={srcModal === 'purchase' ? '从采购单导入（待采购行）' : srcModal === 'production' ? '从生产订单导入（按生产单号合并，勾选后导入该单全部明细）' : '从文件导入（每行：商品编码 数量，空格隔开）'}
        open={!!srcModal} onCancel={() => setSrcModal('')} width={760} onOk={importFromSource} okText="导入">
        {srcModal === 'file' ? (
          <Input.TextArea rows={10} value={fileText} onChange={e => setFileText(e.target.value)} placeholder={'018-2-黄色-35 10\n018-2-黄色-36 16'} />
        ) : srcModal === 'purchase' ? (
          <Table bordered size="small" dataSource={purchaseRows} rowKey={(r: any) => r.key || r.id} pagination={false} scroll={{ y: 360 }}
            rowSelection={{ selectedRowKeys: srcChecked, onChange: keys => setSrcChecked(keys as string[]) }}
            columns={[
              { title: '申请单号', dataIndex: 'id', width: 140 },
              { title: '商品编码', dataIndex: 'productCode', width: 150 },
              { title: '商品简称', dataIndex: 'shortName', width: 120 },
              { title: '需求总数量', dataIndex: 'needTotalQty', width: 100, align: 'center' },
            ]}
            locale={{ emptyText: <Empty description="没有待采购的采购申请单行" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
        ) : (
          <Table bordered size="small" dataSource={productionRows} rowKey="key" pagination={false} scroll={{ y: 360 }}
            rowSelection={{ selectedRowKeys: srcChecked, onChange: keys => setSrcChecked(keys as string[]) }}
            columns={[
              { title: '生产单号', dataIndex: 'poId', width: 150 },
              { title: '明细数', dataIndex: 'itemCount', width: 70, align: 'center' },
              { title: '总数量', dataIndex: 'totalQty', width: 80, align: 'center' },
              { title: '商品明细（编码×数量）', dataIndex: 'summary', ellipsis: true, render: (v: string) => <Tooltip title={v}>{v}</Tooltip> },
            ]}
            locale={{ emptyText: <Empty description="没有生产订单计划明细" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
        )}
      </Modal>

      {/* 批量打印设置弹窗 */}
      <Modal title="批量打印设置" open={batchVisible} onCancel={() => setBatchVisible(false)} width={480}
        onOk={() => { setQty1(batchQty); setBatchVisible(false); message.success('批量打印数量已应用'); }} okText="应用">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><Text style={{ fontSize: 12 }}>吊牌模板</Text><Select size="small" style={{ width: '100%' }} value={tplIds.tag} onChange={v => setTplIds(prev => ({ ...prev, tag: v }))} options={tplOptions('tag')} /></div>
          <div><Text style={{ fontSize: 12 }}>条码模板</Text><Select size="small" style={{ width: '100%' }} value={tplIds.barcode} onChange={v => setTplIds(prev => ({ ...prev, barcode: v }))} options={tplOptions('barcode')} /></div>
          <div><Text style={{ fontSize: 12 }}>水洗标模板</Text><Select size="small" style={{ width: '100%' }} value={tplIds.wash} onChange={v => setTplIds(prev => ({ ...prev, wash: v }))} options={tplOptions('wash')} /></div>
          <div><Text style={{ fontSize: 12 }}>统一打印数量</Text><InputNumber size="small" min={1} value={batchQty} onChange={n => setBatchQty(Number(n) || 1)} /></div>
        </div>
      </Modal>

      {/* 编辑商品属性弹窗 */}
      <Modal title={`编辑商品属性 - ${selProduct?.productCode || ''}`} open={attrModal} onCancel={() => setAttrModal(false)} onOk={saveAttrEdit} width={640} okText="保存">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
          {[
            { k: 'name', l: '商品名称' }, { k: 'shortName', l: '商品简称' },
            { k: 'styleCode', l: '款式编码' }, { k: 'color', l: '颜色' },
            { k: 'spec', l: '规格' }, { k: 'otherProp1', l: '其他属性1' },
            { k: 'otherProp2', l: '其他属性2' }, { k: 'otherProp3', l: '其他属性3' },
            { k: 'shoeUpper', l: '鞋面材质' }, { k: 'shoeSole', l: '鞋底材质' },
          ].map(f => (
            <div key={f.k}>
              <Text style={{ fontSize: 12 }}>{f.l}</Text>
              <Input size="small" value={attrForm[f.k] || ''} onChange={e => setAttrForm(prev => ({ ...prev, [f.k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

// 自定义打印内容 CRUD
const CustomContentEditor: React.FC<{ list: any[]; onChange: (l: any[]) => void }> = ({ list, onChange }) => {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [editId, setEditId] = useState('');
  const save = () => {
    if (!name.trim() || !content.trim()) { message.warning('名称与内容均必填'); return; }
    if (editId) onChange(list.map(c => c.id === editId ? { ...c, name: name.trim(), content: content.trim() } : c));
    else onChange([...list, { id: `cc-${Date.now()}`, name: name.trim(), content: content.trim() }]);
    setName(''); setContent(''); setEditId('');
    message.success('已保存');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Table bordered size="small" dataSource={list} rowKey="id" pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name', width: 160 },
          { title: '内容', dataIndex: 'content', ellipsis: true },
          {
            title: '操作', width: 120, align: 'center', render: (_: any, r: any) => (
              <Space size={0}>
                <Button size="small" type="link" onClick={() => { setEditId(r.id); setName(r.name); setContent(r.content); }}>编辑</Button>
                <Button size="small" type="link" danger onClick={() => onChange(list.filter(c => c.id !== r.id))}>删除</Button>
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: <Empty description="暂无自定义内容" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
      <Input size="small" placeholder="名称" value={name} onChange={e => setName(e.target.value)} />
      <Input.TextArea rows={2} placeholder="内容（将作为「自定义打印内容」字段插入模板）" value={content} onChange={e => setContent(e.target.value)} />
      <Button size="small" type="primary" icon={<SaveOutlined />} onClick={save}>{editId ? '保存修改' : '新增'}</Button>
    </div>
  );
};

export default ProductPrintPage;
