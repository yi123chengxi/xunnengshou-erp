import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, Select,
  Row, Col, Tag, Statistic, Form, Tabs, Checkbox, Tooltip, Empty, AutoComplete, Image as AntdImage, DatePicker, Descriptions,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined,
  PictureOutlined, SnippetsOutlined, UploadOutlined, DownloadOutlined, RocketOutlined,
  CameraOutlined, LinkOutlined, SettingOutlined, QuestionCircleOutlined, TeamOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx-js-style';
import { safeSetItem } from '../utils/storageQuota';
import { compressImageFile } from '../utils/imageCompress';
import { getCurrentUserDisplayName } from '../utils/billLog';
import { loadNonExclusiveBrands, isBrandMatch } from '../utils/listingStats';
import { loadTenantUsers, tenantUserDisplayName } from '../utils/tenantUsers';
import FieldConfigModal from '../components/FieldConfigModal';
import useResizableColumns from '../hooks/useResizableColumns';

const { Text } = Typography;
const { RangePicker } = DatePicker;
const PRIMARY = '#1e4a7e';

// 租户归属（子账号归父账号），与全项目 getDataOwner 口径一致
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

const safeJson = (k: string, d: any) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; }
};

// 中文日期（2026年4月20日）/标准日期统一解析为时间戳
const parseDate = (s: any): number => {
  const str = String(s || '').trim();
  if (!str) return 0;
  const m = str.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : 0;
};
const todayTs = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const fmtDate = (t: number) => (t ? dayjs(t).format('YYYY-MM-DD') : '');

// ===================== 数据类型 =====================
interface ProgressRec {
  key: string; styleCode: string; image: string; costPrice: number; craft: string; color: string;
  sizeRange: string; factory: string; brand: string; photoThenList: string; photoPlace: string; photoRemark?: string; genAt?: string;
  jstImported: boolean; createdAt: string; photoRecvDate: string; photoRecvStatus: string;
  photoPlanDate: string; arrivalStatus: string; arrivalDate: string; returnDate: string;
  platforms: string[]; listPlanDate: string; listDoneDate: string; remark: string; creator: string;
}
interface PhotoRec { key: string; styleCode: string; image: string; remark: string; creator: string; recvStatus: string; planListDate: string; createdAt: string; platforms: string[]; listedAt: string; listingShops?: string[]; listingScreenshots?: string[]; listingDetails?: Record<string, { images: string[]; listedAt: string }>; }
interface ArrivalRec { key: string; styleCode: string; image: string; date: string; creator: string; arrivalStatus: string; overdueDate: string; }
interface ListingRec {
  key: string; styleCode: string; platforms: string[]; dataComplete: string; image: string; images?: string[];
  soleThickness: string; boxWeight: string; boxVolume: string; bagWeight: string; upperHeight: string;
  upperMaterial: string; insoleMaterial: string; liningMaterial: string; creator: string; date: string; updatedAt: string; extra?: Record<string, string>;
}

const PLATFORM_OPTIONS = ['聚水潭', '1688', '网盘归档'];
// 上架进度「资料已完善」检测字段：全部有内容才判定已完善
const LISTING_CHECK_FIELDS = ['soleThickness', 'boxWeight', 'boxVolume', 'bagWeight', 'upperHeight', 'upperMaterial', 'insoleMaterial', 'liningMaterial'];
const BUILTIN_LABELS: Record<string, string> = { soleThickness: '鞋底厚度', boxWeight: '盒装重量', boxVolume: '盒装体积', bagWeight: '袋装重量', upperHeight: '鞋帮高度', upperMaterial: '鞋面材质', insoleMaterial: '鞋垫材质', liningMaterial: '鞋子内里' };
// 拍照公司底色轮询池
const COMPANY_BG = ['#e6f7ff', '#fff7e6', '#f6ffed', '#fff0f6', '#f9f0ff', '#e6fffb', '#fcffe6', '#ffe7ba', '#d9f7be', '#ffd6e7'];
// 码段预设 35-44 与解析/压缩显示
const PRESET_SIZES = Array.from({ length: 10 }, (_, i) => 35 + i);
const parseSizes = (s: string): number[] => {
  const out = new Set<number>();
  String(s || '').split(/[,，\s、]+/).filter(Boolean).forEach(tok => {
    const m = tok.match(/^(\d+)-(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); }
    else { const n = Number(tok); if (!Number.isNaN(n)) out.add(n); }
  });
  return Array.from(out).sort((a, b) => a - b);
};
const formatSizes = (s: string): string => {
  const arr = parseSizes(s); if (!arr.length) return String(s || '');
  const parts: string[] = []; let start = arr[0], prev = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    const cur = arr[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = cur;
  }
  return parts.join(',');
};
// 颜色标签编辑器：输入一个颜色点击添加，可逐个删除
const ColorTagsEditor: React.FC<{ value?: string; onChange?: (v: string) => void }> = ({ value, onChange }) => {
  const [input, setInput] = useState('');
  const colors = String(value || '').split(/[,，\s、]+/).filter(Boolean);
  const commit = (next: string[]) => onChange?.(next.join(' '));
  const add = () => { const c = input.trim(); if (!c) return; if (!colors.includes(c)) commit([...colors, c]); setInput(''); };
  return (<div>
    <Space wrap size={4} style={{ marginBottom: 4, minHeight: 22 }}>
      {colors.map(c => <Tag key={c} closable color="blue" onClose={() => commit(colors.filter(x => x !== c))}>{c}</Tag>)}
      {!colors.length && <span style={{ color: '#bbb', fontSize: 12 }}>逐个添加颜色</span>}
    </Space>
    <div style={{ display: 'flex', gap: 8 }}>
      <Input placeholder="输入颜色后点击添加" value={input} onChange={e => setInput(e.target.value)} onPressEnter={add} />
      <Button icon={<PlusOutlined />} onClick={add}>添加</Button>
    </div>
  </div>);
};
// 码段勾选编辑器：预设 35-44 点选，可新增自定义规格
const SizeCheckEditor: React.FC<{ value?: string; onChange?: (v: string) => void }> = ({ value, onChange }) => {
  const [input, setInput] = useState('');
  const selected = parseSizes(value || '');
  const extras = selected.filter(s => !PRESET_SIZES.includes(s));
  const opts = [...PRESET_SIZES, ...extras];
  const commit = (next: number[]) => onChange?.(next.sort((a, b) => a - b).join(','));
  const toggle = (n: number) => commit(selected.includes(n) ? selected.filter(x => x !== n) : [...selected, n]);
  const add = () => {
    const t = input.trim(); const n = Number(t);
    if (!t || Number.isNaN(n)) { message.warning('请输入数字规格'); return; }
    if (!selected.includes(n)) commit([...selected, n]);
    setInput('');
  };
  return (<div>
    <Space wrap size={4} style={{ marginBottom: 4 }}>
      {opts.map(n => { const on = selected.includes(n); return <Tag key={n} style={{ cursor: 'pointer', userSelect: 'none', marginInlineEnd: 0 }} color={on ? 'blue' : undefined} onClick={() => toggle(n)}>{on ? '✓ ' : ''}{n}</Tag>; })}
    </Space>
    <div style={{ display: 'flex', gap: 8 }}>
      <Input placeholder="新增规格 如 45" value={input} onChange={e => setInput(e.target.value)} onPressEnter={add} />
      <Button icon={<PlusOutlined />} onClick={add}>新增规格</Button>
    </div>
  </div>);
};
interface ListingFieldCfg { labels: Record<string, string>; hidden: string[]; }
// 生成表格预览列
const GEN_PREVIEW_COLS: ColumnsType<any> = [
  { title: '款式编码', dataIndex: '款式编码', width: 100 },
  { title: '商品编码', dataIndex: '商品编码', width: 160 },
  { title: '颜色及规格', dataIndex: '颜色及规格', width: 100 },
  { title: '国标码', dataIndex: '国标码', width: 140 },
  { title: '商品标签', dataIndex: '商品标签', width: 80 },
  { title: '分类', dataIndex: '分类', width: 90 },
  { title: '虚拟库存数', dataIndex: '虚拟库存数', width: 80 },
  { title: '品牌', dataIndex: '品牌', width: 80 },
  { title: '重量', dataIndex: '重量', width: 60 },
  { title: '长', dataIndex: '长', width: 50 },
  { title: '宽', dataIndex: '宽', width: 50 },
  { title: '高', dataIndex: '高', width: 50 },
  { title: '体积', dataIndex: '体积', width: 70 },
  { title: '供应商名称', dataIndex: '供应商名称', width: 100 },
  { title: '基础售价', dataIndex: '基础售价', width: 80 },
  { title: '成本价', dataIndex: '成本价', width: 70 },
  { title: '其它属性1', dataIndex: '其它属性1', width: 90 },
  { title: '其它属性2', dataIndex: '其它属性2', width: 80 },
  { title: '其它属性3', dataIndex: '其它属性3', width: 80 },
  { title: '其它属性4', dataIndex: '其它属性4', width: 90 },
  { title: '其它属性5', dataIndex: '其它属性5', width: 100 },
];
const readListingFieldCfg = (owner: string): ListingFieldCfg => ({ labels: safeJson(`newstyle_listing_labels_${owner}`, {}), hidden: safeJson(`newstyle_listing_hidden_${owner}`, []) });
const readExtraFields = (owner: string): string[] => safeJson(`newstyle_listing_extra_${owner}`, []);
const genKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
// 表头说明：有数据来源或需解释的字段加 ? 提示，降低学习成本
// React 元素被冻结不可挂属性，用 WeakMap 侧表存纯文本标题供显示字段弹窗回退取值
const HT_PLAIN = new WeakMap<object, string>();
const HT = (t: string, tip: string) => {
  const el = (<span>{t}<Tooltip title={tip}><span style={{ marginLeft: 2, color: '#bbb', cursor: 'help' }}>?</span></Tooltip></span>) as any;
  HT_PLAIN.set(el, t);
  return el;
};
const plainTitleOf = (title: any): string => (typeof title === 'string' ? title : (HT_PLAIN.get(title) ?? String(title)));

// 逾期判定：预计完成日已过且未完成（或实际完成晚于预计）
const listOverdueOf = (r: ProgressRec): boolean => {
  const plan = parseDate(r.listPlanDate);
  if (!plan) return false;
  if (r.listDoneDate) return parseDate(r.listDoneDate) > plan;
  return todayTs() > plan;
};

// ===================== 图片上传槽（点击/ Ctrl+V / 粘贴剪切板按键） =====================
const ImgSlot: React.FC<{ value: string; onChange: (v: string) => void; size?: number }> = ({ value, onChange, size = 84 }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [camVisible, setCamVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openCam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setCamVisible(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, 50);
    } catch { message.warning('无法打开摄像头，请检查浏览器权限'); }
  }, []);
  const closeCam = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamVisible(false);
  }, []);
  const shoot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { message.warning('摄像头未就绪'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    onChange(canvas.toDataURL('image/jpeg', 0.85));
    closeCam();
    message.success('已拍照上传');
  }, [onChange, closeCam]);
  const handleFile = useCallback(async (f: File) => {
    const data = await compressImageFile(f);
    if (data) onChange(data); else message.warning('图片处理失败');
  }, [onChange]);
  const handlePasteClipboard = useCallback(async () => {
    try {
      const items = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = it.types.find((t: string) => t.startsWith('image/'));
        if (type) { const blob = await it.getType(type); await handleFile(new File([blob], 'paste.png', { type })); return; }
      }
      message.warning('剪切板中没有图片');
    } catch { message.warning('无法读取剪切板，请检查浏览器权限'); }
  }, [handleFile]);
  return (
    <Space direction="vertical" size={4} align="start">
      {value ? (
        <div style={{ position: 'relative', width: size, height: size }}>
          <AntdImage src={value} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
          <Button size="small" danger type="text" style={{ position: 'absolute', top: -8, right: -8 }} icon={<DeleteOutlined />} onClick={() => onChange('')} />
        </div>
      ) : (
        <div tabIndex={0} onPaste={e => { const f = Array.from(e.clipboardData.files)[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
          style={{ width: size, height: size, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', fontSize: 11, lineHeight: '16px', textAlign: 'center', outline: 'none' }}>
          <PictureOutlined style={{ fontSize: 18, marginBottom: 2 }} />
          点击上传
          （可Ctrl+V）
        </div>
      )}
      <Space size={4}>
        <Button size="small" icon={<SnippetsOutlined />} onClick={handlePasteClipboard}>粘贴剪切板</Button>
        <Button size="small" icon={<CameraOutlined />} onClick={openCam}>拍照</Button>
      </Space>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
      <Modal title="拍照上传" open={camVisible} onCancel={closeCam} zIndex={1300} width={480}
        footer={<Space><Button onClick={closeCam}>取消</Button><Button type="primary" icon={<CameraOutlined />} onClick={shoot}>拍照</Button></Space>}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 6, background: '#000' }} />
      </Modal>
    </Space>
  );
};

// 多图上传槽：最多 max 张（点击/Ctrl+V/粘贴剪切板/多选文件）
const ImgMultiSlot: React.FC<{ value: string[]; onChange: (v: string[]) => void; max?: number; size?: number }> = ({ value, onChange, max = 5, size = 64 }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const addFile = useCallback(async (f: File) => {
    if (value.length >= max) { message.warning(`最多上传 ${max} 张图片`); return; }
    const d = await compressImageFile(f);
    onChange([...value, d]);
  }, [value, onChange, max]);
  const handlePasteClipboard = useCallback(async () => {
    try {
      const items = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = it.types.find((t: string) => t.startsWith('image/'));
        if (type) { const blob = await it.getType(type); await addFile(new File([blob], 'paste.png', { type })); return; }
      }
      message.warning('剪切板中没有图片');
    } catch { message.warning('无法读取剪切板，请检查浏览器权限'); }
  }, [addFile]);
  return (
    <Space direction="vertical" size={4} align="start">
      <Space wrap size={6}>
        {value.map((src, i) => (
          <div key={i} style={{ position: 'relative', width: size, height: size }}>
            <AntdImage src={src} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
            <Button size="small" danger type="text" style={{ position: 'absolute', top: -8, right: -8 }} icon={<DeleteOutlined />} onClick={() => onChange(value.filter((_x, j) => j !== i))} />
          </div>
        ))}
        {value.length < max && (
          <div tabIndex={0} onPaste={e => { const f = Array.from(e.clipboardData.files)[0]; if (f) addFile(f); }}
            onClick={() => fileRef.current?.click()}
            style={{ width: size, height: size, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', fontSize: 11, lineHeight: '16px', textAlign: 'center', outline: 'none' }}>
            <PictureOutlined style={{ fontSize: 18, marginBottom: 2 }} />
            点击上传
            （可Ctrl+V）
          </div>
        )}
      </Space>
      <Space size={6}>
        <Button size="small" icon={<SnippetsOutlined />} onClick={handlePasteClipboard}>粘贴剪切板</Button>
        <span style={{ fontSize: 12, color: '#999' }}>{value.length}/{max}</span>
      </Space>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { const fs = Array.from(e.target.files || []); fs.slice(0, max - value.length).forEach(addFile); e.target.value = ''; }} />
    </Space>
  );
};

// 表体高度视口锚定：横向滚动条固定在窗口最下方（表体顶边按文档坐标测量，预留分页器 44px）
const useFixedTableScroll = (dep?: any) => {
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(400);
  useEffect(() => {
    const calc = () => {
      const body = ref.current?.querySelector('.ant-table-body') as HTMLElement | null;
      if (!body) return;
      const top = body.getBoundingClientRect().top + window.pageYOffset;
      setY(Math.max(200, window.innerHeight - top - 44));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [dep]);
  return { ref, y };
};

// 预计上架完成派生：拍完上架=回传创建日+回传期限；到货上架=到货日(到货拍照任务表)+到货期限；只拍不上架=无期限
const photoModeOf = (progress: ProgressRec[], styleCode: string): string => progress.find(p => p.styleCode === styleCode)?.photoThenList || '拍完上架';
const latestArrivalDateOf = (arrivals: ArrivalRec[], styleCode: string): string => {
  const rs = arrivals.filter(a => a.styleCode === styleCode && a.date);
  if (!rs.length) return '';
  return [...rs].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].date;
};
const planDateOfPhoto = (r: PhotoRec, mode: string, arrivalDate: string, dlPhoto: number, dlArrival: number): string => {
  if (mode === '只拍不上架') return '';
  if (mode === '到货上架') return arrivalDate ? dayjs(arrivalDate).add(dlArrival, 'day').format('YYYY-MM-DD') : '';
  return r.createdAt ? dayjs(r.createdAt).add(dlPhoto, 'day').format('YYYY-MM-DD') : '';
};
const readDeadlines = (owner: string) => ({
  photo: Number(localStorage.getItem(`newstyle_photo_deadline_${owner}`)) || 3,
  arrival: Number(localStorage.getItem(`newstyle_arrival_deadline_${owner}`)) || 3,
  overdue: Number(localStorage.getItem(`newstyle_arrival_overdue_deadline_${owner}`)) || 7,
  photoOver: Number(localStorage.getItem(`newstyle_photo_overdue_deadline_${owner}`)) || 7,
});

// ===================== 子页签：外拍图片回传 =====================
const PhotoTab: React.FC<{ photos: PhotoRec[]; save: (l: PhotoRec[]) => void; styleCodes: string[]; owner: string; progress: ProgressRec[]; arrivals: ArrivalRec[]; listings: ListingRec[]; onOpenListing: (sc: string) => void; onConfigChange?: () => void; photoOnly?: boolean }> = ({ photos, save, styleCodes, owner, progress, arrivals, listings, onOpenListing, onConfigChange, photoOnly = false }) => {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<PhotoRec | null>(null);
  const [form] = Form.useForm();
  const [image, setImage] = useState('');
  // 设置：图片回传接收后到上架的时间期限（天）+ 到货后到上架的时间期限（天）
  const [deadline, setDeadline] = useState<number>(() => Number(localStorage.getItem(`newstyle_photo_deadline_${owner}`)) || 3);
  const [arrivalDeadline, setArrivalDeadline] = useState<number>(() => Number(localStorage.getItem(`newstyle_arrival_deadline_${owner}`)) || 3);
  const [setVisOpen, setSetVisOpen] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState<number>(deadline);
  const [arrivalDraft, setArrivalDraft] = useState<number>(arrivalDeadline);
  // 拍照期限：新增新款后多少天未收到图片则拍照逾期
  const [photoOverDeadline, setPhotoOverDeadline] = useState<number>(() => Number(localStorage.getItem(`newstyle_photo_overdue_deadline_${owner}`)) || 7);
  const [photoOverDraft, setPhotoOverDraft] = useState<number>(photoOverDeadline);
  // 上架平台清单（可自定义新增，持久化）
  const [platforms, setPlatforms] = useState<string[]>(() => safeJson(`newstyle_platforms_${owner}`, PLATFORM_OPTIONS));
  const [newPlatform, setNewPlatform] = useState('');
  // 上架弹窗
  const [listTarget, setListTarget] = useState<PhotoRec | null>(null);
  const [listChecked, setListChecked] = useState<string[]>([]);
  // 商品属性只读详情弹窗（photoOnly 模式下点击查看）
  const [detailListing, setDetailListing] = useState<ListingRec | null>(null);
  // 上架店铺弹窗（photoOnly 模式）
  const [shopListTarget, setShopListTarget] = useState<PhotoRec | null>(null);
  const [shopListChecked, setShopListChecked] = useState<string[]>([]);
  const [shopListDetails, setShopListDetails] = useState<Record<string, { images: string[]; listedAt: string }>>({});
  // 上架详情查看弹窗
  const [detailShop, setDetailShop] = useState<{ shopName: string; styleCode: string; images: string[]; listedAt: string; person?: string; brand?: string; isListed?: boolean } | null>(null);
  const [myShops, setMyShops] = useState<{ shopName: string; brand: string; person: string }[]>([]);
  // 负责人（管理员）设置：可查看全店店铺
  const [managers, setManagers] = useState<string[]>(() => safeJson(`newstyle_managers_${owner}`, [] as string[]));
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [managerDraft, setManagerDraft] = useState<string[]>([]);
  const isAdmin = useMemo(() => (localStorage.getItem('username') || '') === owner, [owner]);
  // 品牌台账中“是否专版”为“普通”的品牌集合（调用共享函数加载）
  const nonExclusiveBrands = useMemo(() => loadNonExclusiveBrands(owner), [owner]);
  // 品牌匹配：调用共享函数 isBrandMatch(recBrand, shopBrand, nonExclusiveBrands)
  const checkBrandMatch = useCallback((recBrand: string, shopBrand: string) =>
    isBrandMatch(recBrand, shopBrand, nonExclusiveBrands), [nonExclusiveBrands]);
  useEffect(() => {
    if (!photoOnly) return;
    try {
      const allShops: any[] = JSON.parse(localStorage.getItem(`shop_info_${owner}`) || '[]');
      const currentUser = getCurrentUserDisplayName();
      const username = localStorage.getItem('username') || '';
      const userIsAdmin = username === owner;
      const mgrs: string[] = safeJson(`newstyle_managers_${owner}`, [] as string[]);
      const userIsManager = mgrs.includes(currentUser);
      if (userIsAdmin || userIsManager) {
        // 管理员或负责人可看全部店铺
        setMyShops(allShops.map(s => ({ shopName: s.shopName || '', brand: s.brand || '', person: s.person || '' })).filter(s => s.shopName));
      } else {
        const mine = allShops.filter(s => s.person === currentUser).map(s => ({ shopName: s.shopName || '', brand: s.brand || '', person: s.person || '' })).filter(s => s.shopName);
        setMyShops(mine);
      }
    } catch { setMyShops([]); }
  }, [photoOnly, owner, managers]);
  const list = useMemo(() => photos.filter(r => !search.trim() || `${r.styleCode} ${r.creator}`.toLowerCase().includes(search.trim().toLowerCase())), [photos, search]);
  const { wrapColumns } = useResizableColumns<any>('newstyle_colw_photo');
  const { ref: areaRef, y: scrollY } = useFixedTableScroll(`${list.length}|${platforms.join()}`);
  // 上架逾期：按模式派生的预计上架完成已过且未上架任何平台
  const modeOf = (r: PhotoRec) => photoModeOf(progress, r.styleCode);
  const planOf = (r: PhotoRec) => planDateOfPhoto(r, modeOf(r), latestArrivalDateOf(arrivals, r.styleCode), deadline, arrivalDeadline);
  const listOverdueOfPhoto = (r: PhotoRec) => !(r.platforms || []).length && !r.listedAt && modeOf(r) !== '只拍不上架' && !!planOf(r) && todayTs() > parseDate(planOf(r));
  const openAdd = () => { setEditing(null); form.resetFields(); setImage(''); setVisible(true); };
  const handleSave = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const today = dayjs().format('YYYY-MM-DD');
    if (editing) {
      const base: PhotoRec = { ...editing, styleCode: String(v.styleCode || '').trim(), image, recvStatus: v.recvStatus || editing.recvStatus, remark: v.remark || '', createdAt: v.createdAt || editing.createdAt };
      const rec: PhotoRec = { ...base, planListDate: base.listedAt ? base.planListDate : planDateOfPhoto(base, photoModeOf(progress, base.styleCode), latestArrivalDateOf(arrivals, base.styleCode), deadline, arrivalDeadline) };
      save(photos.map(x => (x.key === editing.key ? rec : x)));
    } else {
      // 新增：图片接收状态默认已收到；预计上架完成按「何时上架」模式自动计算
      const base: PhotoRec = { key: genKey('nsp'), styleCode: String(v.styleCode || '').trim(), image, remark: '', creator: getCurrentUserDisplayName(), recvStatus: '已收到', planListDate: '', createdAt: today, platforms: [], listedAt: '' };
      const rec: PhotoRec = { ...base, planListDate: planDateOfPhoto(base, photoModeOf(progress, base.styleCode), latestArrivalDateOf(arrivals, base.styleCode), deadline, arrivalDeadline) };
      save([rec, ...photos]);
    }
    setVisible(false); message.success('已保存');
  };
  const openList = (r: PhotoRec) => { setListTarget(r); setListChecked(r.platforms || []); };
  const handleListSave = () => {
    if (!listTarget) return;
    const now = dayjs().format('YYYY-MM-DD');
    const rec: PhotoRec = { ...listTarget, platforms: listChecked, listedAt: listChecked.length ? (listTarget.listedAt || now) : '' };
    save(photos.map(x => (x.key === rec.key ? rec : x)));
    setListTarget(null); message.success('上架平台已保存');
  };
  // 上架店铺弹窗操作
  const openShopList = (r: PhotoRec) => {
    setShopListTarget(r);
    setShopListChecked(r.listingShops || []);
    setShopListDetails(r.listingDetails || {});
  };
  const handleShopListSave = () => {
    if (!shopListTarget) return;
    const now = dayjs().format('YYYY-MM-DD HH:mm');
    // 构建 listingDetails：对每个已勾选的店铺，保留其图片和上架时间
    const details: Record<string, { images: string[]; listedAt: string }> = {};
    shopListChecked.forEach(shopName => {
      const existing = shopListDetails[shopName];
      details[shopName] = {
        images: existing?.images || [],
        listedAt: existing?.listedAt || now,
      };
    });
    const rec: PhotoRec = { ...shopListTarget, listingShops: shopListChecked, listingDetails: details };
    save(photos.map(x => (x.key === rec.key ? rec : x)));
    setShopListTarget(null); message.success('上架店铺已保存');
  };
  const handleScreenshotUploadForShop = async (shopName: string, file: File) => {
    try {
      const dataUrl = await compressImageFile(file);
      setShopListDetails(prev => ({
        ...prev,
        [shopName]: {
          images: [...(prev[shopName]?.images || []), dataUrl],
          listedAt: prev[shopName]?.listedAt || dayjs().format('YYYY-MM-DD HH:mm'),
        },
      }));
    } catch {
      message.error('图片压缩失败');
    }
  };
  const addPlatform = () => {
    const p = newPlatform.trim();
    if (!p) { message.warning('请输入平台名称'); return; }
    if (platforms.includes(p)) { message.warning('平台已存在'); return; }
    const next = [...platforms, p];
    setPlatforms(next); safeSetItem(`newstyle_platforms_${owner}`, JSON.stringify(next)); setNewPlatform('');
    message.success(`已新增平台「${p}」，表单将显示对应字段`);
  };
  const platformCols: ColumnsType<PhotoRec> = platforms.map(p => ({
    title: p, key: `pf_${p}`, width: 90, align: 'center' as const,
    render: (_v: any, r: PhotoRec) => ((r.platforms || []).includes(p) ? <Tag color="green">已上架</Tag> : '—'),
  }));
  // 提示列标题辅助（仅在 photoOnly 模式显示问号提示）
  const HTp = (label: string, tip: string) => <span>{label} <Tooltip title={tip}><QuestionCircleOutlined style={{ color: '#999', fontSize: 12 }} /></Tooltip></span>;
  // 商品属性单元格式显示：与新款进度表主表同构（去登记/已完善/未完善，点击打开商品属性弹窗）
  const columns: ColumnsType<PhotoRec> = [
    { title: '序号', key: 'idx', width: 60, align: 'center', render: (_v, _r, i) => i + 1 },
    ...(photoOnly ? [{ title: HTp('货号', '来自新款进度主表单的货号，点击可查看对应主表单详情'), dataIndex: 'styleCode', key: 'styleCode', width: 130, align: 'center', render: (v: string) => <Text strong>{v}</Text> } as any] : [{ title: '关联货号', dataIndex: 'styleCode', key: 'styleCode', width: 130, align: 'center', render: (v: string) => <Text strong>{v}</Text> }]),
    ...(photoOnly ? [{ title: HTp('颜色', '源自主表单“颜色”字段，按关联货号匹配'), key: 'color', width: 100, align: 'center' as const, render: (_v: any, r: PhotoRec) => { const p = progress.find(x => x.styleCode === r.styleCode); return p?.color || '—'; } }] : []),
    ...(photoOnly ? [{ title: HTp('码段', '源自主表单“码段”字段，按关联货号匹配'), key: 'sizeRange', width: 120, align: 'center' as const, render: (_v: any, r: PhotoRec) => { const p = progress.find(x => x.styleCode === r.styleCode); return p?.sizeRange ? formatSizes(p.sizeRange) : '—'; } }] : []),
    ...(photoOnly ? [{ title: HTp('品牌', '源自主表单“品牌”字段，按关联货号匹配。匹配规则：货号品牌与店铺品牌一致（含双方均空）视为匹配；若店铺品牌在台账中“是否专版”为“普通”，则货号品牌为空时也视为匹配'), key: 'brand', width: 100, align: 'center' as const, render: (_v: any, r: PhotoRec) => { const p = progress.find(x => x.styleCode === r.styleCode); return p?.brand ? <Tag color="purple">{p.brand}</Tag> : '—'; } }] : []),
    { title: photoOnly ? HTp('图片', '新款回传图片，点击可放大查看') : '图片', dataIndex: 'image', key: 'image', width: 70, align: 'center', render: (v: string) => (v ? <AntdImage src={v} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—') },
    ...(!photoOnly ? [{ title: '图片接收状态', dataIndex: 'recvStatus', key: 'recvStatus', width: 110, align: 'center' as const, render: (v: string) => <Tag color={v === '已收到' ? 'blue' : 'default'}>{v || '未收到'}</Tag> }] : []),
    ...(!photoOnly ? [{ title: HT('何时上架', '源自主表单，决定预计上架完成的计算口径'), key: 'listMode', width: 100, align: 'center' as const, render: (_v: any, r: PhotoRec) => { const m = modeOf(r); return m ? <Tag color={m === '拍完上架' ? 'green' : m === '到货上架' ? 'blue' : 'default'}>{m}</Tag> : '—'; } }] : []),
    ...(!photoOnly ? [{
      title: HT('预计上架完成', '按期限设置自动推导：拍完上架=回传日+天数；到货上架=到货日+天数；绿色为实际上架时间'), dataIndex: 'planListDate', key: 'planListDate', width: 120, align: 'center' as const,
      render: (v: any, r: PhotoRec) => {
        // 上架完成后自动变为实际上架时间；超期未上架任何平台显示上架逾期；只拍不上架/待到货单独展示
        if (r.listedAt) return <Text strong style={{ color: '#52c41a' }}>{r.listedAt}</Text>;
        const mode = modeOf(r);
        if (mode === '只拍不上架') return <Tag>只拍不上架</Tag>;
        const plan = planOf(r);
        if (!plan) return <Tag color="orange">待到货</Tag>;
        if (listOverdueOfPhoto(r)) return <Tag color="red">上架逾期</Tag>;
        return plan;
      },
    }] : []),
    ...(!photoOnly ? platformCols : []),
    {
      title: HT('商品属性', '商品属性登记/完善状态，点击打开登记弹窗（与主表共用）'), key: 'listing', width: 100, align: 'center',
      render: (_v, r) => { const l = listings.find(x => x.styleCode === r.styleCode); const status = l ? (l.dataComplete === '资料已完善' ? <Tag color="green">已完善</Tag> : <Tag color="orange">未完善</Tag>) : <span style={{ color: '#999' }}>未登记</span>; return photoOnly ? <span style={{ cursor: l ? 'pointer' : 'default' }} onClick={() => l && setDetailListing(l)}>{status}</span> : <Button type="link" size="small" onClick={() => onOpenListing(r.styleCode)}>{status}</Button>; },
    },
    ...(!photoOnly ? [{ title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: (v: string) => v || '—' }] : []),
    ...(photoOnly ? [{
      title: HTp('负责店铺', '显示当前用户负责的店铺。配色规则：品牌匹配+已上架=绿色；品牌匹配+未上架=蓝色；品牌不匹配但已勾选上架=橙色；品牌不匹配且未上架=灰色。点击已上架的店铺名称可查看上架详情'), key: 'myShopList', width: 200, align: 'center' as const,
      render: (_v: any, r: PhotoRec) => {
        if (myShops.length === 0) return <Text type="secondary">暂无负责的店铺</Text>;
        const recBrand = (progress.find(x => x.styleCode === r.styleCode)?.brand || '').trim();
        const listedShops: string[] = r.listingShops || [];
        const details = r.listingDetails || {};
        return <Space wrap size={4}>{myShops.map(s => {
          const shopBrand = (s.brand || '').trim();
          const matched = checkBrandMatch(recBrand, shopBrand);
          const isListed = listedShops.includes(s.shopName);
          const openDetail = () => setDetailShop({ shopName: s.shopName, styleCode: r.styleCode, images: details[s.shopName]?.images || [], listedAt: details[s.shopName]?.listedAt || r.listedAt || '', person: s.person, brand: s.brand, isListed });
          if (matched && isListed) return <Tag key={s.shopName} color="green" style={{ cursor: 'pointer' }} onClick={openDetail}>{s.shopName}</Tag>;
          if (matched && !isListed) return <Tag key={s.shopName} color="blue" style={{ cursor: 'pointer' }} onClick={openDetail}>{s.shopName}</Tag>;
          if (!matched && isListed) return <Tag key={s.shopName} color="orange" style={{ cursor: 'pointer' }} onClick={openDetail}>{s.shopName}</Tag>;
          return <Tag key={s.shopName} style={{ background: '#f0f0f0', color: '#999', borderColor: '#d9d9d9', cursor: 'pointer' }} onClick={openDetail}>{s.shopName}</Tag>;
        })}</Space>;
      },
    }] : []),
    ...(photoOnly ? [{
      title: HTp('上架', '品牌匹配的店铺可上架：已上架显示绿色，未上架显示红色；品牌不匹配的显示灰色“品牌不符”。匹配规则同负责店铺列'), key: 'shopListing', width: 120, align: 'center' as const,
      render: (_v: any, r: PhotoRec) => {
        const recBrand = (progress.find(x => x.styleCode === r.styleCode)?.brand || '').trim();
        const matchedShops = myShops.filter(s => checkBrandMatch(recBrand, (s.brand || '').trim()));
        const listedShops = r.listingShops || [];
        const matchedListed = matchedShops.filter(s => listedShops.includes(s.shopName));
        const unmatchedCount = myShops.length - matchedShops.length;
        return (
          <div>
            {matchedListed.length > 0 && <div><Tag color="green">{matchedListed.length}店已上架</Tag></div>}
            {matchedShops.length > matchedListed.length && <div style={{ marginTop: 2 }}><Tag color="red">{matchedShops.length - matchedListed.length}店未上架</Tag></div>}
            {matchedShops.length === 0 && <div><Tag>无可匹配店铺</Tag></div>}
            {unmatchedCount > 0 && <div style={{ marginTop: 2 }}><Tag style={{ background: '#f0f0f0', color: '#999', borderColor: '#d9d9d9' }}>{unmatchedCount}店品牌不符</Tag></div>}
            <Button type="link" size="small" style={{ padding: 0, fontSize: 12, marginTop: 2 }} onClick={() => openShopList(r)}>管理上架</Button>
          </div>
        );
      },
    }] : []),
    // 创建时间和创建人放在最后（photoOnly 模式）
    ...(photoOnly ? [{ title: HTp('创建时间', '新款回传记录的创建时间，由系统自动生成'), dataIndex: 'createdAt', key: 'createdAt', width: 110, align: 'center' } as any] : [{ title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 110, align: 'center' }]),
    { title: photoOnly ? HTp('创建人', '新建回传记录时的操作人姓名') : '创建人', dataIndex: 'creator', key: 'creator', width: 100, align: 'center' },
    ...(!photoOnly ? [{
      title: '操作', key: 'op', width: 180, align: 'center' as const,
      render: (_v: any, r: PhotoRec) => (<Space size={2}>
        <Button type="link" size="small" style={{ color: '#52c41a' }} onClick={() => openList(r)}>上架</Button>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); form.setFieldsValue(r); setImage(r.image || ''); setVisible(true); }}>编辑</Button>
        <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => save(photos.filter(x => x.key !== r.key))}>删除</Button>
      </Space>),
    }] : []),
  ];
  return (
    <div ref={areaRef}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input placeholder="搜索货号/创建人" allowClear style={{ width: 200 }} value={search} onChange={e => setSearch(e.target.value)} prefix={<SearchOutlined />} />
        {!photoOnly && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增回传记录</Button>}
        {!photoOnly && <Button icon={<SettingOutlined />} onClick={() => { setDeadlineDraft(deadline); setArrivalDraft(arrivalDeadline); setPhotoOverDraft(photoOverDeadline); setSetVisOpen(true); }}>设置</Button>}
        {photoOnly && <Button icon={<TeamOutlined />} onClick={() => { setManagerDraft([...managers]); setManagerModalOpen(true); }}>负责人设置</Button>}
      </Space>
      <Table rowKey="key" bordered size="small" columns={wrapColumns(columns as any)} dataSource={list} scroll={{ x: 1500, y: scrollY }}
        pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }} locale={{ emptyText: <Empty description="暂无回传记录" /> }} />
      {/* 新增/编辑：新增仅保留关联货号+图片；编辑额外保留状态/备注/时间 */}
      <Modal title={editing ? '编辑回传图片' : '新增回传图片'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={520} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="styleCode" label="关联货号" rules={[{ required: true, message: '请选择或搜索货号' }]}>
                <Select showSearch placeholder="下拉选择或输入检索货号" options={styleCodes.map(c => ({ value: c, label: c }))}
                  filterOption={(input, option: any) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            {editing && (<Col span={12}><Form.Item name="recvStatus" label="图片接收状态"><Select options={[{ value: '未收到' }, { value: '已收到' }]} /></Form.Item></Col>)}
            {editing && (<Col span={12}><Form.Item name="createdAt" label="创建时间"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>)}
            {editing && (<Col span={12}><Form.Item name="remark" label="备注"><Input placeholder="选填" /></Form.Item></Col>)}
            <Col span={12}><Form.Item label="图片"><ImgSlot value={image} onChange={setImage} /></Form.Item></Col>
          </Row>
          {!editing && <div style={{ fontSize: 12, color: '#999' }}>新增默认：图片接收状态=已收到；预计上架完成按主表单「何时上架」自动计算：拍完上架=回传日+{deadline}天，到货上架=到货日+{arrivalDeadline}天（可在「设置」中调整）</div>}
        </Form>
      </Modal>
      {/* 期限设置 */}
      <Modal title="上架期限设置" open={setVisOpen} onOk={() => { setDeadline(deadlineDraft); setArrivalDeadline(arrivalDraft); setPhotoOverDeadline(photoOverDraft); safeSetItem(`newstyle_photo_deadline_${owner}`, String(deadlineDraft)); safeSetItem(`newstyle_arrival_deadline_${owner}`, String(arrivalDraft)); safeSetItem(`newstyle_photo_overdue_deadline_${owner}`, String(photoOverDraft)); setSetVisOpen(false); onConfigChange?.(); message.success(`期限已保存：回传后 ${deadlineDraft} 天 / 到货后 ${arrivalDraft} 天 / 拍照 ${photoOverDraft} 天`); }} onCancel={() => setSetVisOpen(false)} okText="保存" cancelText="取消" width={460}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6, color: '#666', fontSize: 13 }}>① 拍完上架：图片回传接收后到上架的时间期限（天），按「回传创建日 + 期限」计算预计上架完成。</div>
          <InputNumber min={1} max={365} value={deadlineDraft} onChange={v => setDeadlineDraft(Number(v) || 3)} addonAfter="天" style={{ width: 160 }} />
        </div>
        <div>
          <div style={{ marginBottom: 6, color: '#666', fontSize: 13 }}>② 到货上架：到货之后到上架的时间期限（天），按「到货款式表中对应货号的到货日期 + 期限」计算预计上架完成。</div>
          <InputNumber min={1} max={365} value={arrivalDraft} onChange={v => setArrivalDraft(Number(v) || 3)} addonAfter="天" style={{ width: 160 }} />
        </div>
        <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <div style={{ marginBottom: 6, color: '#666', fontSize: 13 }}>③ 拍照期限：主表单新增新款后开始计时，超过以下天数回传图片表中对应货号仍无记录或图片接收状态非「已收到」，则主表显示拍照逾期并计入统计卡。</div>
          <InputNumber min={1} max={365} value={photoOverDraft} onChange={v => setPhotoOverDraft(Number(v) || 7)} addonAfter="天" style={{ width: 160 }} />
        </div>
      </Modal>
      {/* 上架平台选择 */}
      <Modal title={`上架登记 - ${listTarget?.styleCode || ''}`} open={!!listTarget} onOk={handleListSave} onCancel={() => setListTarget(null)} okText="保存" cancelText="取消" width={560}>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>勾选已上架的平台；勾选保存后对应字段显示绿色「已上架」，预计上架完成自动变为本次上架时间。</div>
        <Checkbox.Group value={listChecked} onChange={v => setListChecked(v as string[])} style={{ marginBottom: 12 }}>
          <Space wrap>{platforms.map(p => (<Checkbox key={p} value={p}><Tag color={(listChecked || []).includes(p) ? 'green' : 'default'} style={{ marginRight: 0 }}>{p}</Tag></Checkbox>))}</Space>
        </Checkbox.Group>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <Input placeholder="新增上架平台名称" value={newPlatform} onChange={e => setNewPlatform(e.target.value)} style={{ width: 220 }} />
          <Button icon={<PlusOutlined />} onClick={addPlatform}>新增平台</Button>
          <span style={{ fontSize: 12, color: '#999' }}>新增的平台将作为字段显示在表格中</span>
        </div>
      </Modal>
      {/* 商品属性只读详情 */}
      <Modal title={`商品属性详情 - ${detailListing?.styleCode || ''}`} open={!!detailListing} onCancel={() => setDetailListing(null)} footer={<Button onClick={() => setDetailListing(null)}>关闭</Button>} width={560}>
        {detailListing && (
          <Descriptions column={2} bordered size="small" style={{ marginTop: 8 }}>
            {LISTING_CHECK_FIELDS.map(k => (
              <Descriptions.Item key={k} label={BUILTIN_LABELS[k]}>{(detailListing as any)[k] || '—'}</Descriptions.Item>
            ))}
            {detailListing.extra && Object.entries(detailListing.extra).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>{v || '—'}</Descriptions.Item>
            ))}
            <Descriptions.Item label="数据状态" span={2}>{detailListing.dataComplete === '资料已完善' ? <Tag color="green">已完善</Tag> : <Tag color="orange">未完善</Tag>}</Descriptions.Item>
            {(detailListing.images?.length || detailListing.image) && (
              <Descriptions.Item label="图片" span={2}>
                <Space wrap>{(detailListing.images?.length ? detailListing.images : (detailListing.image ? [detailListing.image] : [])).map((img, i) => <AntdImage key={i} src={img} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
      {/* 上架店铺弹窗 */}
      <Modal title={`上架店铺 - ${shopListTarget?.styleCode || ''}`} open={!!shopListTarget} onOk={handleShopListSave} onCancel={() => setShopListTarget(null)} okText="保存" cancelText="取消" width={640}>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>勾选已上架的店铺，并为每个店铺上传对应上架截图。</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6, fontWeight: 500 }}>我负责的店铺：</div>
          <Checkbox.Group value={shopListChecked} onChange={v => setShopListChecked(v as string[])}>
            <Space wrap>{myShops.map(s => (<Checkbox key={s.shopName} value={s.shopName}><Tag color={shopListChecked.includes(s.shopName) ? 'green' : 'default'} style={{ marginRight: 0 }}>{s.shopName}{s.brand ? <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>({s.brand})</span> : null}</Tag></Checkbox>))}</Space>
          </Checkbox.Group>
          {myShops.length === 0 && <div style={{ color: '#999', fontSize: 12 }}>暂无您负责的店铺，请先在店铺列表中设置负责人</div>}
        </div>
        {shopListChecked.length > 0 && (
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>各店铺上架截图：</div>
            {shopListChecked.map(shopName => {
              const shopDetail = shopListDetails[shopName] || { images: [], listedAt: '' };
              return (
                <div key={shopName} style={{ marginBottom: 12, padding: 8, background: '#fafafa', borderRadius: 6 }}>
                  <div style={{ marginBottom: 4, fontWeight: 500, fontSize: 13 }}>{shopName}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {shopDetail.images.map((img: string, i: number) => (
                      <div key={i} style={{ position: 'relative', width: 64, height: 64 }}>
                        <AntdImage src={img} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 4 }} />
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ position: 'absolute', top: -4, right: -4, background: '#fff', borderRadius: '50%', width: 18, height: 18, padding: 0, fontSize: 9 }}
                          onClick={() => setShopListDetails(prev => ({ ...prev, [shopName]: { ...prev[shopName], images: prev[shopName].images.filter((_: string, idx: number) => idx !== i) } }))} />
                      </div>
                    ))}
                  </div>
                  <Space size={4}>
                    <Button size="small" icon={<UploadOutlined />} onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
                      input.onchange = async (e: any) => { const files: FileList | null = e.target.files; if (files) { for (let i = 0; i < files.length; i++) { await handleScreenshotUploadForShop(shopName, files[i]); } } };
                      input.click();
                    }}>上传</Button>
                    <Button size="small" icon={<SnippetsOutlined />} onClick={async () => {
                      try {
                        const items = await (navigator as any).clipboard.read();
                        for (const it of items) {
                          const type = it.types.find((t: string) => t.startsWith('image/'));
                          if (type) { const blob = await it.getType(type); await handleScreenshotUploadForShop(shopName, new File([blob], 'paste.png', { type })); message.success('已粘贴'); return; }
                        }
                        message.warning('剪切板中没有图片');
                      } catch { message.warning('无法读取剪切板'); }
                    }}>粘贴</Button>
                  </Space>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
      {/* 上架详情查看弹窗 */}
      <Modal title="店铺详情" open={!!detailShop} onCancel={() => setDetailShop(null)} footer={null} width={540}>
        {detailShop && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 16 }}>
              <div>
                <span style={{ color: '#999', fontSize: 12 }}>店铺名称</span>
                <div><Tag color="blue" style={{ fontSize: 14, marginTop: 4 }}>{detailShop.shopName}</Tag></div>
              </div>
              <div>
                <span style={{ color: '#999', fontSize: 12 }}>店铺负责人</span>
                <div style={{ fontWeight: 500, marginTop: 4 }}>{detailShop.person || '—'}</div>
              </div>
              <div>
                <span style={{ color: '#999', fontSize: 12 }}>店铺品牌</span>
                <div style={{ fontWeight: 500, marginTop: 4 }}>{detailShop.brand || '—'}</div>
              </div>
              <div>
                <span style={{ color: '#999', fontSize: 12 }}>上架状态</span>
                <div style={{ marginTop: 4 }}>{detailShop.isListed ? <Tag color="green">已上架</Tag> : <Tag color="red">未上架</Tag>}</div>
              </div>
              <div>
                <span style={{ color: '#999', fontSize: 12 }}>货号</span>
                <div style={{ fontWeight: 500, marginTop: 4 }}>{detailShop.styleCode}</div>
              </div>
              <div>
                <span style={{ color: '#999', fontSize: 12 }}>上架时间</span>
                <div style={{ marginTop: 4 }}>{detailShop.listedAt || '—'}</div>
              </div>
            </div>
            {detailShop.isListed && (
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                <div style={{ color: '#999', marginBottom: 6, fontSize: 12 }}>上架截图：</div>
                {detailShop.images.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {detailShop.images.map((img: string, i: number) => (
                      <AntdImage key={i} src={img} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 6 }} />
                    ))}
                  </div>
                ) : <Text type="secondary">暂无上架截图</Text>}
              </div>
            )}
          </div>
        )}
      </Modal>
      {/* 负责人设置弹窗 */}
      <Modal title="负责人设置" open={managerModalOpen} onCancel={() => setManagerModalOpen(false)}
        onOk={isAdmin ? () => {
          setManagers(managerDraft);
          safeSetItem(`newstyle_managers_${owner}`, JSON.stringify(managerDraft));
          setManagerModalOpen(false);
          message.success('负责人设置已保存');
        } : undefined}
        okText="保存" cancelText="关闭" width={480}
        okButtonProps={{ disabled: !isAdmin }}>
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          设置负责人后，负责人可查看全店店铺（与管理员相同权限）。普通用户只能看到自己负责的店铺。
          {!isAdmin && <span style={{ color: '#fa8c16', display: 'block', marginTop: 4 }}>仅管理员可修改负责人设置</span>}
        </div>
        <div style={{ marginBottom: 6, fontWeight: 500 }}>负责人列表：</div>
        <Select mode="multiple" style={{ width: '100%' }} placeholder="选择负责人" value={managerDraft}
          onChange={v => setManagerDraft(v)}
          options={loadTenantUsers().map(u => { const name = tenantUserDisplayName(u); return { value: name, label: name }; })}
          disabled={!isAdmin} />
        {managerDraft.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Space wrap>{managerDraft.map(m => <Tag key={m} closable={isAdmin} onClose={() => setManagerDraft(prev => prev.filter(x => x !== m))}>{m}</Tag>)}</Space>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ===================== 子页签：到货拍照任务 =====================
const ArrivalTab: React.FC<{ arrivals: ArrivalRec[]; save: (l: ArrivalRec[]) => void; owner: string; styleCodes: string[]; onConfigChange?: () => void }> = ({ arrivals, save, owner, styleCodes, onConfigChange }) => {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<ArrivalRec | null>(null);
  const [form] = Form.useForm();
  const [image, setImage] = useState('');
  // 设置：新增新款后多少天未到货则主表显示到货逾期
  const [overdueDays, setOverdueDays] = useState<number>(() => Number(localStorage.getItem(`newstyle_arrival_overdue_deadline_${owner}`)) || 7);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [overdueDraft, setOverdueDraft] = useState<number>(overdueDays);
  const list = useMemo(() => arrivals.filter(r => !search.trim() || `${r.styleCode} ${r.creator}`.toLowerCase().includes(search.trim().toLowerCase())), [arrivals, search]);
  const { wrapColumns } = useResizableColumns<any>('newstyle_colw_arrival');
  const { ref: areaRef, y: scrollY } = useFixedTableScroll(list.length);
  const openAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ date: dayjs().format('YYYY-MM-DD'), arrivalStatus: '已到货' }); setImage(''); setVisible(true); };
  const handleSave = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const rec: ArrivalRec = { key: editing?.key || genKey('nsa'), styleCode: String(v.styleCode || '').trim(), image, date: v.date || dayjs().format('YYYY-MM-DD'), creator: editing?.creator || getCurrentUserDisplayName(), arrivalStatus: v.arrivalStatus || '已到货', overdueDate: v.overdueDate || '' };
    if (!rec.styleCode) { message.warning('请填写关联货号'); return; }
    save(editing ? arrivals.map(x => (x.key === editing.key ? rec : x)) : [rec, ...arrivals]);
    setVisible(false); message.success('已保存');
  };
  const columns: ColumnsType<ArrivalRec> = [
    { title: '序号', key: 'idx', width: 60, align: 'center', render: (_v, _r, i) => i + 1 },
    { title: '关联货号', dataIndex: 'styleCode', key: 'styleCode', width: 130, align: 'center', render: v => <Text strong>{v}</Text> },
    { title: '图片', dataIndex: 'image', key: 'image', width: 70, align: 'center', render: (v: string) => (v ? <AntdImage src={v} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—') },
    { title: '日期', dataIndex: 'date', key: 'date', width: 110, align: 'center' },
    { title: HT('到货情况', '新增默认已到货；超过到货逾期期限仍未到货时主表显示到货逾期'), dataIndex: 'arrivalStatus', key: 'arrivalStatus', width: 110, align: 'center', render: v => <Tag color={v === '已到货' ? 'green' : 'orange'}>{v || '未到货'}</Tag> },
    { title: '上架超时日期', dataIndex: 'overdueDate', key: 'overdueDate', width: 120, align: 'center', render: v => v || '—' },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 100, align: 'center' },
    {
      title: '操作', key: 'op', width: 120, align: 'center',
      render: (_v, r) => (<Space size={2}>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); form.setFieldsValue(r); setImage(r.image || ''); setVisible(true); }}>编辑</Button>
        <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => save(arrivals.filter(x => x.key !== r.key))}>删除</Button>
      </Space>),
    },
  ];
  return (
    <div ref={areaRef}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input placeholder="搜索货号/创建人" allowClear style={{ width: 200 }} value={search} onChange={e => setSearch(e.target.value)} prefix={<SearchOutlined />} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增到货款式</Button>
        <Button icon={<SettingOutlined />} onClick={() => { setOverdueDraft(overdueDays); setOverdueOpen(true); }}>设置</Button>
      </Space>
      <Table rowKey="key" bordered size="small" columns={wrapColumns(columns as any)} dataSource={list} scroll={{ x: 900, y: scrollY }}
        pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }} locale={{ emptyText: <Empty description="暂无到货款式" /> }} />
      <Modal title={editing ? '编辑到货款式' : '新增到货款式'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={520} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="styleCode" label="关联货号" rules={[{ required: true, message: '请选择或搜索货号' }]}>
                <Select showSearch placeholder="下拉选择或输入检索货号" options={styleCodes.map(c => ({ value: c, label: c }))}
                  filterOption={(input, option: any) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            {editing && (<Col span={12}><Form.Item name="date" label="日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>)}
            {editing && (<Col span={12}><Form.Item name="arrivalStatus" label="到货情况"><Select options={[{ value: '未到货' }, { value: '已到货' }]} /></Form.Item></Col>)}
            {editing && (<Col span={12}><Form.Item name="overdueDate" label="上架超时日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>)}
            <Col span={12}><Form.Item label="图片"><ImgSlot value={image} onChange={setImage} /></Form.Item></Col>
          </Row>
          {!editing && <div style={{ fontSize: 12, color: '#999' }}>新增默认：日期=今天，到货情况=已到货</div>}
        </Form>
      </Modal>
      {/* 到货逾期期限设置 */}
      <Modal title="到货逾期期限设置" open={overdueOpen} onOk={() => { setOverdueDays(overdueDraft); safeSetItem(`newstyle_arrival_overdue_deadline_${owner}`, String(overdueDraft)); setOverdueOpen(false); onConfigChange?.(); message.success(`期限已设置为 ${overdueDraft} 天`); }} onCancel={() => setOverdueOpen(false)} okText="保存" cancelText="取消" width={460}>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>主表单新增新款后，超过以下天数仍未到货的，主表「到货情况」显示红色「到货逾期」；直到「到货款式」中对应货号的到货情况变为已到货/已收到，该字段自动变更为已到货。</div>
        <InputNumber min={1} max={365} value={overdueDraft} onChange={v => setOverdueDraft(Number(v) || 7)} addonAfter="天" style={{ width: 160 }} />
      </Modal>
    </div>
  );
};

// ===================== 子页签：上架进度表 =====================
const ListingTab: React.FC<{ listings: ListingRec[]; save: (l: ListingRec[]) => void; styleCodes: string[]; owner: string; photos: PhotoRec[]; fieldCfg: ListingFieldCfg; onConfigChange?: () => void }> = ({ listings, save, styleCodes, owner, photos, fieldCfg, onConfigChange }) => {
  const [search, setSearch] = useState('');
  const [filterComplete, setFilterComplete] = useState('');
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<ListingRec | null>(null);
  const [form] = Form.useForm();
  const [images, setImages] = useState<string[]>([]);
  const list = useMemo(() => listings.filter(r => {
    if (search.trim() && !`${r.styleCode} ${r.creator}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filterComplete && r.dataComplete !== filterComplete) return false;
    return true;
  }), [listings, search, filterComplete]);
  const { wrapColumns } = useResizableColumns<any>('newstyle_colw_listing');
  const { ref: areaRef, y: scrollY } = useFixedTableScroll(list.length);
  // 数据是否完善自动判定：检测字段+自定义字段全部有内容=已完善
  const [extraFields, setExtraFields] = useState<string[]>(() => readExtraFields(owner));
  const [newField, setNewField] = useState('');
  const activeBuiltins = LISTING_CHECK_FIELDS.filter(k => !fieldCfg.hidden.includes(k));
  const labelOf = (k: string) => fieldCfg.labels[k] || BUILTIN_LABELS[k] || k;
  const completeOf = (vals: any) => ([...activeBuiltins, ...extraFields].every(k => String(vals?.[k] || '').trim()) ? '资料已完善' : '资料未完善');
  const addExtraField = () => {
    const f = newField.trim();
    if (!f) { message.warning('请输入字段名称'); return; }
    if (extraFields.includes(f) || LISTING_CHECK_FIELDS.includes(f)) { message.warning('字段已存在'); return; }
    const next = [...extraFields, f];
    setExtraFields(next); safeSetItem(`newstyle_listing_extra_${owner}`, JSON.stringify(next)); setNewField(''); onConfigChange?.();
    message.success(`已新增字段「${f}」`);
  };
  const openAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ dataComplete: '资料未完善' }); setImages([]); setVisible(true); };
  const handleSave = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const rec: ListingRec = {
      key: editing?.key || genKey('nsl'), styleCode: String(v.styleCode || '').trim(), platforms: editing?.platforms || [], dataComplete: completeOf(v),
      image: images[0] || '', images, soleThickness: v.soleThickness || '', boxWeight: v.boxWeight || '', boxVolume: v.boxVolume || '', bagWeight: v.bagWeight || '',
      upperHeight: v.upperHeight || '', upperMaterial: v.upperMaterial || '', insoleMaterial: v.insoleMaterial || '', liningMaterial: v.liningMaterial || '',
      extra: Object.fromEntries(extraFields.map(f => [f, String(v[f] || '')])),
      creator: editing?.creator || getCurrentUserDisplayName(), date: editing?.date || dayjs().format('YYYY-MM-DD'), updatedAt: dayjs().format('YYYY-MM-DD'),
    };
    if (!rec.styleCode) { message.warning('请填写货号'); return; }
    save(editing ? listings.map(x => (x.key === editing.key ? rec : x)) : [rec, ...listings]);
    setVisible(false); message.success('已保存');
  };
  const columns: ColumnsType<ListingRec> = [
    { title: '序号', key: 'idx', width: 60, align: 'center', render: (_v, _r, i) => i + 1 },
    { title: '货号', dataIndex: 'styleCode', key: 'styleCode', width: 130, align: 'center', render: v => <Text strong>{v}</Text> },
    { title: HT('上架平台', '外拍回传表「上架」动作勾选平台的并集'), key: 'platforms', width: 160, render: (_v, r) => { const set: string[] = []; photos.filter(p => p.styleCode === r.styleCode).forEach(p => (p.platforms || []).forEach(pl => { if (!set.includes(pl)) set.push(pl); })); return set.length ? set.map(p => <Tag key={p} color="blue" style={{ marginBottom: 2 }}>{p}</Tag>) : '—'; } },
    { title: HT('数据完善', '由商品属性全部字段是否填写自动判定，不可手工修改'), dataIndex: 'dataComplete', key: 'dataComplete', width: 110, align: 'center', render: v => <Tag color={v === '资料已完善' ? 'green' : 'orange'}>{v}</Tag> },
    { title: '图片', key: 'image', width: 80, align: 'center', render: (_v, r) => { const ims = r.images?.length ? r.images : (r.image ? [r.image] : []); return ims.length ? (<span style={{ position: 'relative', display: 'inline-block' }}><AntdImage src={ims[0]} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} />{ims.length > 1 && <Tag color="blue" style={{ position: 'absolute', top: -8, right: -14, padding: '0 4px', fontSize: 10, lineHeight: '16px' }}>+{ims.length - 1}</Tag>}</span>) : '—'; } },
    ...activeBuiltins.map((k: string) => ({ title: labelOf(k), dataIndex: k, key: k, width: 100, align: 'center' as const, render: (v: string) => v || '—' })),
    ...extraFields.map((f: string) => ({ title: f, key: `ex_${f}`, width: 100, align: 'center' as const, render: (_v: any, r: ListingRec) => r.extra?.[f] || '—' })),
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 100, align: 'center' },
    { title: '日期', dataIndex: 'date', key: 'date', width: 110, align: 'center' },
    {
      title: '操作', key: 'op', width: 120, align: 'center',
      render: (_v, r) => (<Space size={2}>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); form.setFieldsValue({ ...r, ...(r.extra || {}), dataComplete: completeOf({ ...r, ...(r.extra || {}) }) }); setImages(r.images?.length ? r.images : (r.image ? [r.image] : [])); setVisible(true); }}>编辑</Button>
        <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => save(listings.filter(x => x.key !== r.key))}>删除</Button>
      </Space>),
    },
  ];
  return (
    <div ref={areaRef}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input placeholder="搜索货号/创建人" allowClear style={{ width: 200 }} value={search} onChange={e => setSearch(e.target.value)} prefix={<SearchOutlined />} />
        <Select placeholder="完善状态" allowClear style={{ width: 140 }} value={filterComplete || undefined} onChange={v => setFilterComplete(v || '')} options={[{ value: '资料已完善' }, { value: '资料未完善' }]} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增商品属性</Button>
      </Space>
      <Table rowKey="key" bordered size="small" columns={wrapColumns(columns as any)} dataSource={list} scroll={{ x: 1500, y: scrollY }}
        pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }} locale={{ emptyText: <Empty description="暂无商品属性记录" /> }} />
      <Modal title={editing ? `编辑商品属性 - ${editing.styleCode}` : '新增商品属性'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={760} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 8 }} onValuesChange={(_c, all) => form.setFieldsValue({ dataComplete: completeOf(all) })}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="styleCode" label="货号" rules={[{ required: true, message: '请选择或搜索货号' }]}>
                <Select showSearch disabled={!!editing} placeholder="下拉选择或输入检索货号" options={styleCodes.map(c => ({ value: c, label: c }))}
                  filterOption={(input, option: any) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col span={8}><Form.Item name="dataComplete" label="数据是否完善（自动判定）"><Select disabled options={[{ value: '资料未完善' }, { value: '资料已完善' }]} /></Form.Item></Col>
            {activeBuiltins.map(k => (<Col span={6} key={k}><Form.Item name={k} label={labelOf(k)}><Input placeholder="选填" /></Form.Item></Col>))}
            {extraFields.map(f => (<Col span={6} key={f}><Form.Item name={f} label={f}><Input placeholder="选填" /></Form.Item></Col>))}
            <Col span={6}>
              <Form.Item label="新增字段">
                <Input placeholder="自定义字段名" value={newField} onChange={e => setNewField(e.target.value)} style={{ width: '100%', marginBottom: 4 }} />
                <Button block icon={<PlusOutlined />} onClick={addExtraField}>新增字段</Button>
              </Form.Item>
            </Col>
            <Col span={24}><Form.Item label="图片（最多5张）"><ImgMultiSlot value={images} onChange={setImages} max={5} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

// ===================== 主页面 =====================
const NewStyleProgressPage: React.FC<{ photoOnly?: boolean }> = ({ photoOnly = false }) => {
  const owner = useMemo(() => getDataOwner(), []);
  const K_PROGRESS = `newstyle_progress_${owner}`;
  const K_PHOTO = `newstyle_photo_${owner}`;
  const K_ARRIVAL = `newstyle_arrival_${owner}`;
  const K_LISTING = `newstyle_listing_${owner}`;

  const [activeTab, setActiveTab] = useState(photoOnly ? 'photo' : 'progress');
  const [progress, setProgress] = useState<ProgressRec[]>([]);
  const [photos, setPhotos] = useState<PhotoRec[]>([]);
  const [arrivals, setArrivals] = useState<ArrivalRec[]>([]);
  const [listings, setListings] = useState<ListingRec[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [brandRefreshTick, setBrandRefreshTick] = useState(0);
  // 监听其他页面的数据变更，实时更新品牌下拉选项
  useEffect(() => {
    const onSync = () => setBrandRefreshTick(t => t + 1);
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, []);
  // 字段显示配置：顺序+显隐（持久化 newstyle_fieldcfg_<owner>）
  const [fieldCfg, setFieldCfg] = useState<{ order: string[]; hidden: string[] }>(() => safeJson(`newstyle_fieldcfg_${owner}`, { order: [], hidden: [] }));
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const [mainPageSize, setMainPageSize] = useState(20);
  // 表体视口锚定（横向滚动条固定窗口最下方）+ 列宽拖拽持久化
  const { ref: tableAreaRef, y: tableScrollY } = useFixedTableScroll(`${activeTab}|${mainPageSize}|${refreshTick}|${fieldCfg.order.join(',')}|${fieldCfg.hidden.join(',')}`);
  const { wrapColumns: wrapProgressColumns } = useResizableColumns<any>(`newstyle_colw_progress_${owner}`);

  const reload = useCallback(() => {
    setProgress(safeJson(K_PROGRESS, []));
    setPhotos(safeJson(K_PHOTO, []));
    setArrivals(safeJson(K_ARRIVAL, []));
    setListings(safeJson(K_LISTING, []));
  }, [K_PROGRESS, K_PHOTO, K_ARRIVAL, K_LISTING]);
  useEffect(() => { reload(); }, [reload, refreshTick]);

  const saveProgress = useCallback((list: ProgressRec[]) => { setProgress(list); safeSetItem(K_PROGRESS, JSON.stringify(list)); }, [K_PROGRESS]);
  const savePhotos = useCallback((list: PhotoRec[]) => { setPhotos(list); safeSetItem(K_PHOTO, JSON.stringify(list)); }, [K_PHOTO]);
  const saveArrivals = useCallback((list: ArrivalRec[]) => { setArrivals(list); safeSetItem(K_ARRIVAL, JSON.stringify(list)); }, [K_ARRIVAL]);
  const saveListings = useCallback((list: ListingRec[]) => { setListings(list); safeSetItem(K_LISTING, JSON.stringify(list)); }, [K_LISTING]);

  // ---------- 筛选 ----------
  // 拆分搜索字段：输入态 + 已应用态（回车或点查询后才搜索）
  const emptyF = { code: '', cost: '', color: '', size: '', factory: '', brand: '', place: '', recv: '', platform: '', range: null as [string, string] | null };
  const [fIn, setFIn] = useState(emptyF);
  const [fAp, setFAp] = useState(emptyF);
  const applySearch = () => { reload(); setFAp({ ...fIn }); };
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  // 上架逾期点击筛选：限定货号集合（null=不限制）
  const [focusCodes, setFocusCodes] = useState<string[] | null>(null);
  const [focusLabel, setFocusLabel] = useState('上架逾期');
  // 品牌台账数据（合并授权品牌台账 + 自有品牌台账 + 已录入品牌，去重后扁平显示）
  const brandOpts = useMemo(() => {
    const ownBrands: { brandName?: string }[] = (() => { try { return JSON.parse(localStorage.getItem(`brandauth_own_${owner}`) || '[]'); } catch { return []; } })();
    const authLedger: { brandName?: string }[] = (() => { try { return JSON.parse(localStorage.getItem(`brandauth_auth_brandledger_${owner}`) || '[]'); } catch { return []; } })();
    const existingBrands = progress.map(r => r.brand).filter(Boolean) as string[];
    const allNames = new Set<string>();
    [...ownBrands.map(b => b.brandName), ...authLedger.map(b => b.brandName), ...existingBrands]
      .filter(Boolean).forEach(n => allNames.add(n!.trim()));
    return Array.from(allNames).map(n => ({ value: n, label: n }));
  }, [owner, progress, brandRefreshTick]);
  const craftOpts = useMemo(() => Array.from(new Set(progress.map(r => r.craft).filter(Boolean))).map(c => ({ value: c })), [progress]);
  const sizeRangeOpts = useMemo(() => Array.from(new Set(progress.map(r => r.sizeRange).filter(Boolean))).map(s => ({ value: s })), [progress]);

  const dupSet = useMemo(() => {
    const cnt: Record<string, number> = {};
    progress.forEach(r => { const c = (r.styleCode || '').trim(); if (c) cnt[c] = (cnt[c] || 0) + 1; });
    return new Set(Object.keys(cnt).filter(k => cnt[k] > 1));
  }, [progress]);

  // ---------- 跨表取数 helper（提前声明：拍照逾期判定与筛选依赖） ----------
  const photoStatusOf = useCallback((styleCode: string, fallback: string): string => {
    const rs = photos.filter(p => p.styleCode === styleCode);
    if (!rs.length) return fallback;
    const latest = [...rs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return latest.recvStatus || fallback;
  }, [photos]);
  const arrivalStatusOf = useCallback((styleCode: string, fallback: string): string => {
    const rs = arrivals.filter(a => a.styleCode === styleCode);
    if (!rs.length) return fallback;
    const latest = [...rs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    return latest.arrivalStatus || fallback;
  }, [arrivals]);
  // 主表「上架平台」取数：外拍图片回传页上架按键中勾选的平台并集
  const photoPlatformsOf = useCallback((styleCode: string): string[] => {
    const set: string[] = [];
    photos.filter(p => p.styleCode === styleCode).forEach(p => (p.platforms || []).forEach(pl => { if (!set.includes(pl)) set.push(pl); }));
    return set;
  }, [photos]);
  const deadlines = useMemo(() => readDeadlines(owner), [owner, refreshTick]);
  const arrivalDisplayOf = useCallback((r: ProgressRec): string => {
    const st = arrivalStatusOf(r.styleCode, r.arrivalStatus);
    if (st === '已到货' || st === '已收到') return st;
    if (parseDate(r.createdAt) > 0 && todayTs() - parseDate(r.createdAt) > deadlines.overdue * 86400000) return '到货逾期';
    return st || '未到货';
  }, [arrivalStatusOf, deadlines]);
  // 拍照逾期：新增新款超过拍照期限后，外拍回传表对应货号无记录或接收状态非已收到
  const isPhotoOverdue = useCallback((r: ProgressRec): boolean => {
    if (parseDate(r.createdAt) <= 0) return false;
    if (todayTs() - parseDate(r.createdAt) <= deadlines.photoOver * 86400000) return false;
    return photoStatusOf(r.styleCode, r.photoRecvStatus) !== '已收到';
  }, [photoStatusOf, deadlines]);
  const photoOverList = useMemo(() => progress.filter(isPhotoOverdue), [progress, isPhotoOverdue]);

  const filteredProgress = useMemo(() => progress.filter(r => {
    const lc = (s: string) => s.trim().toLowerCase();
    if (fAp.code && !String(r.styleCode || '').toLowerCase().includes(lc(fAp.code))) return false;
    if (fAp.cost && !String(r.costPrice ?? '').includes(fAp.cost.trim())) return false;
    if (fAp.color && !String(r.color || '').toLowerCase().includes(lc(fAp.color))) return false;
    if (fAp.size && !String(r.sizeRange || '').includes(fAp.size.trim())) return false;
    if (fAp.factory && !String(r.factory || '').toLowerCase().includes(lc(fAp.factory))) return false;
    if (fAp.brand && !String(r.brand || '').toLowerCase().includes(lc(fAp.brand))) return false;
    if (fAp.place && !String(r.photoPlace || '').toLowerCase().includes(lc(fAp.place))) return false;
    if (fAp.recv && photoStatusOf(r.styleCode, r.photoRecvStatus) !== fAp.recv) return false;
    if (fAp.platform && !photoPlatformsOf(r.styleCode).some(p => p.toLowerCase().includes(lc(fAp.platform)))) return false;
    if (fAp.range && ((r.createdAt || '') < fAp.range[0] || (r.createdAt || '') > fAp.range[1])) return false;
    if (onlyOverdue && !isPhotoOverdue(r) && !listOverdueOf(r)) return false;
    if (focusCodes && !focusCodes.includes(r.styleCode)) return false;
    return true;
  }), [progress, fAp, onlyOverdue, focusCodes, isPhotoOverdue, photoStatusOf, photoPlatformsOf]);

  // ---------- 统计（逾期拆分为拍照逾期/上架逾期；上架逾期来自外拍回传记录，按模式派生预计上架完成） ----------
  const photoListOver = useMemo(() => photos.filter(p => {
    if ((p.platforms || []).length || p.listedAt) return false;
    const mode = photoModeOf(progress, p.styleCode);
    if (mode === '只拍不上架') return false;
    const plan = planDateOfPhoto(p, mode, latestArrivalDateOf(arrivals, p.styleCode), deadlines.photo, deadlines.arrival);
    return !!plan && todayTs() > parseDate(plan);
  }), [photos, progress, arrivals, deadlines]);
  const stats = useMemo(() => ({
    total: progress.length,
    returned: progress.filter(r => r.returnDate).length,
    received: progress.filter(r => photoStatusOf(r.styleCode, r.photoRecvStatus) === '已收到').length,
    emptyCode: progress.filter(r => !String(r.styleCode || '').trim()).length,
    emptyCost: progress.filter(r => !(Number(r.costPrice) > 0)).length,
    arrived: progress.filter(r => { const st = arrivalStatusOf(r.styleCode, r.arrivalStatus); return st === '已到货' || st === '已收到'; }).length,
    arrivalOver: progress.filter(r => arrivalDisplayOf(r) === '到货逾期').length,
    complete: progress.filter(r => listings.find(l => l.styleCode === r.styleCode)?.dataComplete === '资料已完善').length,
    incomplete: progress.filter(r => (listings.find(l => l.styleCode === r.styleCode)?.dataComplete || '') !== '资料已完善').length,
    photoOver: photoOverList.length,
    listOver: progress.filter(listOverdueOf).length,
  }), [progress, listings, photoStatusOf, arrivalStatusOf, photoOverList, arrivalDisplayOf]);
  // 点击筛选货源：到货逾期/资料未完善
  const arrivalOverList = useMemo(() => progress.filter(r => arrivalDisplayOf(r) === '到货逾期'), [progress, arrivalDisplayOf]);
  const incompleteList = useMemo(() => progress.filter(r => (listings.find(l => l.styleCode === r.styleCode)?.dataComplete || '') !== '资料已完善'), [progress, listings]);

  // ---------- 去拍照：拍照公司登记 ----------
  const [photoCompanies, setPhotoCompanies] = useState<string[]>(() => safeJson(`newstyle_photo_companies_${owner}`, []));
  const [photoCompanyTarget, setPhotoCompanyTarget] = useState<ProgressRec | null>(null);
  const [photoCompanyPick, setPhotoCompanyPick] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [photoCompanyRemark, setPhotoCompanyRemark] = useState('');
  const [detailRec, setDetailRec] = useState<ProgressRec | null>(null);
  const openPhotoCompany = (r: ProgressRec) => { setPhotoCompanyTarget(r); setPhotoCompanyPick(r.photoPlace || ''); setNewCompany(''); setPhotoCompanyRemark(r.photoRemark || ''); };
  const addPhotoCompany = () => {
    const c = newCompany.trim();
    if (!c) { message.warning('请输入拍照公司名称'); return; }
    if (photoCompanies.includes(c)) { message.warning('拍照公司已存在'); return; }
    const next = [...photoCompanies, c];
    setPhotoCompanies(next); safeSetItem(`newstyle_photo_companies_${owner}`, JSON.stringify(next)); setNewCompany('');
    message.success(`已新增拍照公司「${c}」`);
  };
  const handlePhotoCompanySave = () => {
    if (!photoCompanyTarget) return;
    if (!photoCompanyPick) { message.warning('请选择拍照公司'); return; }
    saveProgress(progress.map(x => (x.key === photoCompanyTarget.key ? { ...x, photoPlace: photoCompanyPick, photoRemark: photoCompanyRemark } : x)));
    setPhotoCompanyTarget(null);
    message.success(`已登记拍照公司：${photoCompanyPick}`);
  };

  // ---------- 主表行高手动调节（全行同步，联动图片缩略图大小） ----------
  const [rowH, setRowH] = useState<number>(() => Number(localStorage.getItem(`newstyle_rowh_${owner}`) || 0) || 56);
  const imgSize = Math.max(28, rowH - 20);

  // ---------- 生成表格：勾选货号 + 参数弹窗 + 校验 + 导出 ----------
  const [genSelectedKeys, setGenSelectedKeys] = useState<string[]>([]);
  const [genVisible, setGenVisible] = useState(false);
  const [genParams, setGenParams] = useState({ markup: 5, tag: '', weight: '', len: '', wid: '', hei: '', attr4: '', attr5: '', virtualStock: '0', category: '', attr3: '', remark: '' });
  const buildGenRows = () => {
    const sel = progress.filter(r => genSelectedKeys.includes(r.key));
    const markup = Number(genParams.markup) || 0;
    return sel.flatMap(r => {
      // 长宽高优先解析商品属性「盒装体积」（如 28*16*11），未填/解析失败回退弹窗手填
      const bv = String(listings.find(l => l.styleCode === r.styleCode)?.boxVolume || '');
      const m = bv.match(/(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)/);
      const L = m ? Number(m[1]) : (Number(genParams.len) || 0);
      const W = m ? Number(m[2]) : (Number(genParams.wid) || 0);
      const H = m ? Number(m[3]) : (Number(genParams.hei) || 0);
      const vol = Math.round((L * W * H) / 1e6 * 1000) / 1000;
      const colors = String(r.color || '').split(/[,，\s、]+/).filter(Boolean);
      const sizes = parseSizes(r.sizeRange || '');
      return colors.flatMap(c => sizes.map(sz => ({
        款式编码: r.styleCode, 商品编码: `${r.styleCode}-${c}-${sz}`, 商品名称: r.styleCode, 颜色及规格: `${c},${sz}`,
        商品标签: genParams.tag, 国标码: `${r.styleCode}${c}${sz}`, 分类: genParams.category, 实盘库存: 0,
        虚拟库存数: genParams.virtualStock === '' ? '' : Number(genParams.virtualStock), 品牌: r.brand || '',
        重量: genParams.weight === '' ? '' : Number(genParams.weight), 长: L || '', 宽: W || '', 高: H || '', 体积: vol,
        供应商名称: r.factory || '', 基础售价: (Number(r.costPrice) || 0) + markup, 成本价: Number(r.costPrice) || 0,
        其它属性1: r.craft || '', 其它属性2: sz * 5 + 50, 其它属性3: genParams.attr3, 其它属性4: listings.find(l => l.styleCode === r.styleCode)?.upperMaterial || genParams.attr4, 其它属性5: genParams.attr5,
        备注: genParams.remark,
      })));
    });
  };
  const genPreviewRows = useMemo(() => (genVisible ? buildGenRows() : []), [genVisible, genParams, genSelectedKeys, progress, listings]);
  // 导出前置校验：成本价/货号/颜色/规格 任一为空则阻断
  const genInvalidList = useMemo(() => progress.filter(r => genSelectedKeys.includes(r.key)).map(r => {
    const miss: string[] = [];
    if (!String(r.styleCode || '').trim()) miss.push('货号');
    // 成本价空值落库为 0（表格显示—），故 0/空/非数字均视为未填
    if (!(Number(r.costPrice) > 0)) miss.push('成本价');
    if (!String(r.color || '').trim()) miss.push('颜色');
    if (!parseSizes(r.sizeRange || '').length) miss.push('规格');
    return miss.length ? { code: r.styleCode || '(空货号)', miss } : null;
  }).filter(Boolean) as { code: string; miss: string[] }[], [genSelectedKeys, progress]);
  const openGen = () => {
    if (!genSelectedKeys.length) { message.warning('请先勾选需要生成表格的货号'); return; }
    // 商品属性已完善时自动填充：盒装体积→长/宽/高，鞋面材质→其它属性4
    const firstListing = progress.filter(r => genSelectedKeys.includes(r.key)).map(r => listings.find(l => l.styleCode === r.styleCode)).find(l => l);
    if (firstListing) {
      const m = String(firstListing.boxVolume || '').match(/(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)/);
      const um = String(firstListing.upperMaterial || '').trim();
      setGenParams(p => ({ ...p, len: m ? m[1] : p.len, wid: m ? m[2] : p.wid, hei: m ? m[3] : p.hei, attr4: um || p.attr4 }));
    }
    setGenVisible(true);
  };
  const handleGenExport = () => {
    if (genInvalidList.length) { message.error(`存在字段为空的货号，不能导出：${genInvalidList.map(x => `${x.code}(缺${x.miss.join('/')})`).join('、')}`); return; }
    const rows = buildGenRows();
    if (!rows.length) { message.warning('无可生成行（颜色或码段为空）'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '商品表');
    XLSX.writeFile(wb, `商品表_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
    // 导出成功后自动记录勾选货号的生成表格状态
    const now = dayjs().format('YYYY-MM-DD HH:mm');
    saveProgress(progress.map(x => (genSelectedKeys.includes(x.key) ? { ...x, genAt: now } : x)));
    message.success(`已生成并导出 ${rows.length} 行，勾选货号已记录为已生成`);
    setGenVisible(false);
  };

  // ---------- 主表新增/编辑 ----------
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ProgressRec | null>(null);
  const [form] = Form.useForm();
  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ photoThenList: '拍完上架', sizeRange: PRESET_SIZES.join(',') });
    setEditVisible(true);
  };
  const openEdit = (r: ProgressRec) => {
    setEditing(r);
    form.setFieldsValue({ ...r, createdAt: r.createdAt ? dayjs(r.createdAt) : null });
    setEditVisible(true);
  };
  const handleSave = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const rec: ProgressRec = {
      key: editing?.key || genKey('ns'),
      styleCode: String(v.styleCode || '').trim(),
      image: v.image || '', costPrice: Number(v.costPrice) || 0, craft: v.craft || '', color: v.color || '',
      sizeRange: v.sizeRange || '', factory: v.factory || '', brand: v.brand || '',
      photoThenList: v.photoThenList || '', photoPlace: editing?.photoPlace || '', jstImported: editing?.jstImported ?? false,
      createdAt: editing?.createdAt || dayjs().format('YYYY-MM-DD'), photoRecvDate: editing?.photoRecvDate || '',
      photoRecvStatus: editing?.photoRecvStatus || '未收到', photoPlanDate: editing?.photoPlanDate || '',
      arrivalStatus: editing?.arrivalStatus || '未到货', arrivalDate: editing?.arrivalDate || '', returnDate: editing?.returnDate || '',
      platforms: editing?.platforms || [], listPlanDate: editing?.listPlanDate || '', listDoneDate: editing?.listDoneDate || '',
      remark: v.remark || '', creator: editing?.creator || getCurrentUserDisplayName(),
    };
    if (!rec.styleCode) { message.warning('请填写货号'); return; }
    saveProgress(editing ? progress.map(x => (x.key === editing.key ? rec : x)) : [rec, ...progress]);
    setEditVisible(false);
    message.success(editing ? '已保存修改' : '新款已登记');
  };
  const handleDelete = (r: ProgressRec) => {
    saveProgress(progress.filter(x => x.key !== r.key));
    message.success('已删除');
  };

  // ---------- 关联弹窗（外拍回传 / 到货任务，按货号） ----------
  const [relStyle, setRelStyle] = useState('');
  const [relType, setRelType] = useState<'photo' | 'arrival'>('photo');
  const relRecords = useMemo(() => ((relType === 'photo' ? photos : arrivals) as any[]).filter((x: any) => x.styleCode === relStyle), [relType, photos, arrivals, relStyle]);
  const [relAddVisible, setRelAddVisible] = useState(false);
  const [relForm] = Form.useForm();
  const [relImage, setRelImage] = useState('');
  const openRel = (styleCode: string, type: 'photo' | 'arrival') => { setRelStyle(styleCode); setRelType(type); };
  const handleRelAdd = async () => {
    const v = await relForm.validateFields().catch(() => null);
    if (!v) return;
    const now = dayjs().format('YYYY-MM-DD');
    if (relType === 'photo') {
      const rec: PhotoRec = { key: genKey('nsp'), styleCode: relStyle, image: relImage, remark: v.remark || '', creator: getCurrentUserDisplayName(), recvStatus: v.recvStatus || '未收到', planListDate: v.planListDate || '', createdAt: now, platforms: [], listedAt: '' };
      savePhotos([rec, ...photos]);
    } else {
      const rec: ArrivalRec = { key: genKey('nsa'), styleCode: relStyle, image: relImage, date: v.date || now, creator: getCurrentUserDisplayName(), arrivalStatus: v.arrivalStatus || '已到货', overdueDate: v.overdueDate || '' };
      saveArrivals([rec, ...arrivals]);
    }
    setRelAddVisible(false); setRelImage(''); relForm.resetFields();
    message.success('任务已登记');
  };
  const handleRelDelete = (key: string) => {
    if (relType === 'photo') savePhotos(photos.filter(x => x.key !== key));
    else saveArrivals(arrivals.filter(x => x.key !== key));
    message.success('已删除');
  };

  // ---------- 商品属性（原上架进度）编辑 ----------
  const [listVisible, setListVisible] = useState(false);
  const [listForm] = Form.useForm();
  const [listImages, setListImages] = useState<string[]>([]);
  const [listStyle, setListStyle] = useState('');
  // 自定义属性字段（租户级持久化，与上架进度表页签共享）
  const [extraFields, setExtraFields] = useState<string[]>(() => readExtraFields(owner));
  const [listNewField, setListNewField] = useState('');
  // 内置字段管理：改名 labels / 删除 hidden（租户级持久化）
  const [listFieldCfg, setListFieldCfg] = useState<ListingFieldCfg>(() => readListingFieldCfg(owner));
  useEffect(() => { setListFieldCfg(readListingFieldCfg(owner)); setExtraFields(readExtraFields(owner)); }, [owner, refreshTick]);
  const activeBuiltins = useMemo(() => LISTING_CHECK_FIELDS.filter(k => !listFieldCfg.hidden.includes(k)), [listFieldCfg]);
  const labelOf = useCallback((k: string) => listFieldCfg.labels[k] || BUILTIN_LABELS[k] || k, [listFieldCfg]);
  const completeListOf = (vals: any) => ([...activeBuiltins, ...extraFields].every(k => String(vals?.[k] || '').trim()) ? '资料已完善' : '资料未完善');
  const addListExtraField = () => {
    const f = listNewField.trim();
    if (!f) { message.warning('请输入字段名称'); return; }
    if (extraFields.includes(f) || LISTING_CHECK_FIELDS.includes(f)) { message.warning('字段已存在'); return; }
    const next = [...extraFields, f];
    setExtraFields(next); safeSetItem(`newstyle_listing_extra_${owner}`, JSON.stringify(next)); setListNewField('');
    message.success(`已新增字段「${f}」`);
  };
  // 字段管理：改名/删除自定义字段（同步迁移已存属性值与当前弹窗表单值）
  const [fieldMgrVisible, setFieldMgrVisible] = useState(false);
  const [mgrDraft, setMgrDraft] = useState<Record<string, string>>({});
  const persistExtra = (next: string[]) => { setExtraFields(next); safeSetItem(`newstyle_listing_extra_${owner}`, JSON.stringify(next)); };
  const migrateExtra = (oldKey: string, newKey: string | null) => {
    saveListings(listings.map(l => {
      if (!l.extra || !(oldKey in l.extra)) return l;
      const extra = { ...l.extra };
      const val = extra[oldKey];
      delete extra[oldKey];
      if (newKey) extra[newKey] = val;
      return { ...l, extra };
    }));
  };
  const remapListForm = (oldKey: string, newKey: string | null) => {
    const vals = listForm.getFieldsValue();
    if (!(oldKey in vals)) return;
    const v = vals[oldKey];
    delete vals[oldKey];
    if (newKey) vals[newKey] = v;
    listForm.setFieldsValue(vals);
  };
  const applyRenameField = (old: string) => {
    const nm = String(mgrDraft[old] ?? '').trim();
    if (!nm || nm === old) { message.warning('请输入新的字段名称'); return; }
    if (extraFields.includes(nm) || LISTING_CHECK_FIELDS.includes(nm)) { message.warning('字段名称已存在'); return; }
    persistExtra(extraFields.map(x => (x === old ? nm : x)));
    migrateExtra(old, nm); remapListForm(old, nm);
    setMgrDraft(d => { const nd = { ...d }; delete nd[old]; nd[nm] = nm; return nd; });
    message.success(`字段已改名为「${nm}」`);
  };
  const applyDeleteField = (old: string) => {
    persistExtra(extraFields.filter(x => x !== old));
    migrateExtra(old, null); remapListForm(old, null);
    setMgrDraft(d => { const nd = { ...d }; delete nd[old]; return nd; });
    message.success(`字段「${old}」已删除`);
  };
  // 内置字段：改名（仅显示名）/删除（隐藏可恢复）
  const saveListFieldCfg = (next: ListingFieldCfg) => {
    setListFieldCfg(next);
    safeSetItem(`newstyle_listing_labels_${owner}`, JSON.stringify(next.labels));
    safeSetItem(`newstyle_listing_hidden_${owner}`, JSON.stringify(next.hidden));
  };
  const applyRenameBuiltin = (k: string) => {
    const nm = String(mgrDraft[k] ?? '').trim();
    if (!nm || nm === labelOf(k)) { message.warning('请输入新的字段名称'); return; }
    if ([...activeBuiltins.map(x => labelOf(x)), ...extraFields].includes(nm)) { message.warning('字段名称已存在'); return; }
    saveListFieldCfg({ ...listFieldCfg, labels: { ...listFieldCfg.labels, [k]: nm } });
    message.success(`字段已改名为「${nm}」`);
  };
  const applyHideBuiltin = (k: string) => { saveListFieldCfg({ ...listFieldCfg, hidden: [...listFieldCfg.hidden, k] }); message.success(`字段「${labelOf(k)}」已删除（可在字段管理中恢复）`); };
  const restoreBuiltin = (k: string) => { saveListFieldCfg({ ...listFieldCfg, hidden: listFieldCfg.hidden.filter(x => x !== k) }); message.success('字段已恢复'); };
  const openListing = (styleCode: string) => {
    const exist = listings.find(l => l.styleCode === styleCode);
    setListStyle(styleCode);
    const base = exist ? { ...exist, ...(exist.extra || {}) } : { styleCode };
    listForm.setFieldsValue({ ...base, dataComplete: completeListOf(base), date: exist?.date || dayjs().format('YYYY-MM-DD') });
    setListImages(exist?.images?.length ? exist.images : (exist?.image ? [exist.image] : []));
    setListVisible(true);
  };
  const handleListSave = async () => {
    const v = await listForm.validateFields().catch(() => null);
    if (!v) return;
    const now = dayjs().format('YYYY-MM-DD');
    const exist = listings.find(l => l.styleCode === listStyle);
    const rec: ListingRec = {
      key: exist?.key || genKey('nsl'), styleCode: listStyle, platforms: exist?.platforms || [], dataComplete: completeListOf(v),
      image: listImages[0] || '', images: listImages, soleThickness: v.soleThickness || '', boxWeight: v.boxWeight || '', boxVolume: v.boxVolume || '',
      bagWeight: v.bagWeight || '', upperHeight: v.upperHeight || '', upperMaterial: v.upperMaterial || '',
      insoleMaterial: v.insoleMaterial || '', liningMaterial: v.liningMaterial || '',
      extra: Object.fromEntries(extraFields.map(f => [f, String(v[f] || '')])),
      creator: exist?.creator || getCurrentUserDisplayName(), date: exist?.date || now, updatedAt: now,
    };
    saveListings(exist ? listings.map(x => (x.key === exist.key ? rec : x)) : [rec, ...listings]);
    setListVisible(false);
    message.success('商品属性已保存');
  };

  // ---------- Excel 导入 / 导出 ----------
  const importRef = useRef<HTMLInputElement>(null);
  const cnDate = (v: any): string => {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''; }
    const s = String(v).trim();
    const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
  };
  const handleImportFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rowsOf = (name: string) => { const ws = wb.Sheets[name]; return ws ? (XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[]) : []; };
      // 主表
      const pRows = [...rowsOf('主表单'), ...rowsOf('新款进度表')];
      const pNew: ProgressRec[] = pRows.map((r: any) => ({
        key: genKey('ns'), styleCode: String(r['货号'] || '').trim(), image: '', costPrice: Number(r['成本价']) || 0,
        craft: String(r['制作工艺'] || ''), color: String(r['颜色'] || ''), sizeRange: String(r['码段'] || ''),
        factory: String(r['工厂名称'] || ''), brand: String(r['品牌'] || ''), photoThenList: String((r['何时上架'] ?? r['拍照是否上架']) || ''),
        photoPlace: String(r['拍照地'] || ''), jstImported: String(r['资料是否导入聚水潭'] || '').includes('✅'),
        createdAt: cnDate(r['创建时间']), photoRecvDate: cnDate(r['图片接收']), photoRecvStatus: String((r['图片接收状态'] ?? r['图片接受状态']) || '') || '未收到',
        photoPlanDate: cnDate(r['拍摄预计完成']), arrivalStatus: String(r['到货情况'] || '') || '未到货', arrivalDate: cnDate(r['到货情况 （引用）'] || ''),
        returnDate: cnDate(r['图片回传']), platforms: String(r['上架平台'] || '').split(/[,，]/).map((s: string) => s.trim()).filter(Boolean),
        listPlanDate: cnDate(r['预计上架完成时间(图回传)']), listDoneDate: cnDate(r['上架完成时间（按到货）']),
        remark: String(r['备注'] || ''), creator: String(r['创建人'] || '') || '导入',
      })).filter((r: ProgressRec) => r.styleCode);
      // 外拍回传
      const phRows = [...rowsOf('回传图片'), ...rowsOf('外拍图片回传')];
      const phNew: PhotoRec[] = phRows.map((r: any) => ({
        key: genKey('nsp'), styleCode: String(r['关联'] || '').trim(), image: '', remark: String(r['备注'] || ''),
        creator: String(r['创建人'] || '') || '导入', recvStatus: String((r['图片接收状态'] ?? r['图片接受状态']) || '') || '未收到',
        planListDate: cnDate(r['预计上架完成时间']), createdAt: cnDate(r['创建时间']), platforms: [], listedAt: '',
      })).filter((r: PhotoRec) => r.styleCode);
      // 到货任务
      const arRows = [...rowsOf('到货款式'), ...rowsOf('到货拍照任务表')];
      const arNew: ArrivalRec[] = arRows.map((r: any) => ({
        key: genKey('nsa'), styleCode: String(r['关联'] || '').trim(), image: '', date: cnDate(r['日期']),
        creator: String(r['创建人'] || '') || '导入', arrivalStatus: String(r['到货情况'] || ''), overdueDate: cnDate(r['上架超时日期']),
      })).filter((r: ArrivalRec) => r.styleCode);
      // 上架进度
      const liRows = [...rowsOf('商品属性'), ...rowsOf('上架进度表')];
      const liNew: ListingRec[] = liRows.map((r: any) => ({
        key: genKey('nsl'), styleCode: String(r['货号'] || '').trim(),
        platforms: String(r['上架平台'] || '').split(/[,，]/).map((s: string) => s.trim()).filter(Boolean),
        dataComplete: String(r['数据是否完善'] || '') || '资料未完善', image: '',
        soleThickness: String(r['鞋底厚度'] || ''), boxWeight: String(r['盒装重量'] || ''), boxVolume: String(r['盒装体积'] || ''),
        bagWeight: String(r['袋装重量'] || ''), upperHeight: String(r['鞋帮高度'] || ''), upperMaterial: String(r['鞋面材质'] || ''),
        insoleMaterial: String(r['鞋垫材质'] || ''), liningMaterial: String(r['鞋子内里'] || ''),
        creator: String(r['创建人'] || '') || '导入', date: cnDate(r['日期']), updatedAt: cnDate(r['最后编辑时间']),
      })).filter((r: ListingRec) => r.styleCode);
      // 按货号去重合并（已有货号跳过）
      const existP = new Set(progress.map(x => x.styleCode));
      const existPh = new Set(photos.map(x => `${x.styleCode}|${x.createdAt}`));
      const existAr = new Set(arrivals.map(x => `${x.styleCode}|${x.date}`));
      const existLi = new Set(listings.map(x => x.styleCode));
      const mP = pNew.filter(r => !existP.has(r.styleCode));
      const mPh = phNew.filter(r => !existPh.has(`${r.styleCode}|${r.createdAt}`));
      const mAr = arNew.filter(r => !existAr.has(`${r.styleCode}|${r.date}`));
      const mLi = liNew.filter(r => !existLi.has(r.styleCode));
      saveProgress([...mP, ...progress]);
      savePhotos([...mPh, ...photos]);
      saveArrivals([...mAr, ...arrivals]);
      saveListings([...mLi, ...listings]);
      message.success(`导入完成：新款 ${mP.length} 条、外拍回传 ${mPh.length} 条、到货任务 ${mAr.length} 条、商品属性 ${mLi.length} 条（重复已跳过）`);
    } catch (e) {
      message.error('导入失败：请确认是企业微信导出的 xlsx 文件');
    }
  };
  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    const pRows = progress.map(r => ({
      重复: dupSet.has(r.styleCode) ? '❗️重复' : '', 货号: r.styleCode, 图片: '', 成本价: r.costPrice, 制作工艺: r.craft,
      颜色: r.color, 码段: r.sizeRange, 工厂名称: r.factory, 品牌: r.brand, 何时上架: r.photoThenList, 拍照地: r.photoPlace, 生成表格: r.genAt ? `已生成 ${r.genAt}` : '',
      资料是否导入聚水潭: r.jstImported ? '✅' : '', 创建时间: r.createdAt, 图片接收: r.photoRecvDate,
      拍照是否逾期: isPhotoOverdue(r) ? '逾期' : '', 图片接收状态: r.photoRecvStatus, 拍摄预计完成: r.photoPlanDate,
      到货情况: r.arrivalStatus, 图片回传: r.returnDate, 上架是否逾期: listOverdueOf(r) ? '逾期' : '',
      上架平台: (r.platforms || []).join(','), 备注: r.remark, 创建人: r.creator,
      预计上架完成时间: r.listPlanDate, 上架完成时间: r.listDoneDate,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pRows), '主表单');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(photos.map(r => ({ 创建时间: r.createdAt, 关联: r.styleCode, 图片: '', 备注: r.remark, 创建人: r.creator, 图片接收状态: r.recvStatus, 预计上架完成时间: r.listedAt || planDateOfPhoto(r, photoModeOf(progress, r.styleCode), latestArrivalDateOf(arrivals, r.styleCode), deadlines.photo, deadlines.arrival), 上架平台: (r.platforms || []).join(',') }))), '回传图片');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(arrivals.map(r => ({ 关联: r.styleCode, 图片: '', 日期: r.date, 创建人: r.creator, 到货情况: r.arrivalStatus, 上架超时日期: r.overdueDate }))), '到货款式');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(listings.map(r => ({ 货号: r.styleCode, 上架平台: (r.platforms || []).join(','), 数据是否完善: r.dataComplete, 图片: '', [labelOf('soleThickness')]: r.soleThickness, [labelOf('boxWeight')]: r.boxWeight, [labelOf('boxVolume')]: r.boxVolume, [labelOf('bagWeight')]: r.bagWeight, [labelOf('upperHeight')]: r.upperHeight, [labelOf('upperMaterial')]: r.upperMaterial, [labelOf('insoleMaterial')]: r.insoleMaterial, [labelOf('liningMaterial')]: r.liningMaterial, 创建人: r.creator, 日期: r.date, 最后编辑时间: r.updatedAt }))), '商品属性');
    XLSX.writeFile(wb, `新款进度表_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`);
    message.success('已导出 Excel（四个工作表）');
  };

  // ---------- 主表列 ----------
  const listingOf = useCallback((sc: string) => listings.find(l => l.styleCode === sc), [listings]);
  const progressColumns: ColumnsType<ProgressRec> = [
    { title: '序号', key: 'idx', width: 60, align: 'center', render: (_v, _r, i) => i + 1 },
    {
      title: '货号', dataIndex: 'styleCode', key: 'styleCode', width: 130, align: 'center',
      render: (v, r) => (<span>{dupSet.has(v) && <Tooltip title="货号重复"><Tag color="red" style={{ marginRight: 4 }}>❗重复</Tag></Tooltip>}<Text strong style={{ cursor: 'pointer', color: PRIMARY }} onClick={() => setDetailRec(r)}>{v}</Text></span>),
    },
    { title: '图片', dataIndex: 'image', key: 'image', width: 80, align: 'center', render: (v: string) => (v ? <AntdImage src={v} width={imgSize} height={imgSize} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—') },
    { title: '成本价', dataIndex: 'costPrice', key: 'costPrice', width: 90, align: 'right', render: v => (v ? `¥${v}` : '—') },
    { title: '颜色', dataIndex: 'color', key: 'color', width: 110, ellipsis: true, render: v => v || '—' },
    { title: '码段', dataIndex: 'sizeRange', key: 'sizeRange', width: 90, align: 'center', render: v => formatSizes(v) || '—' },
    { title: '工厂名称', dataIndex: 'factory', key: 'factory', width: 100, ellipsis: true, render: v => v || '—' },
    { title: '品牌', dataIndex: 'brand', key: 'brand', width: 90, align: 'center', render: v => v || '—' },
    {
      title: HT('拍照地', '「去拍照」登记的拍照公司；点击色块可改选；备注可记录快递单号'), dataIndex: 'photoPlace', key: 'photoPlace', width: 110, align: 'center',
      render: (v, r) => {
        // 已选拍照公司：按公司显示固定底色，不再显示去拍照按键；未选：显示去拍照按键
        if (v) {
          const known = Array.from(new Set([...photoCompanies, ...progress.map(x => x.photoPlace).filter(Boolean)]));
          const idx = Math.max(0, known.indexOf(v));
          const bg = COMPANY_BG[idx % COMPANY_BG.length];
          return (<div>
            <div onClick={() => openPhotoCompany(r)} title="点击修改拍照公司" style={{ background: bg, borderRadius: 4, padding: '2px 6px', color: '#333', cursor: 'pointer' }}>{v}</div>
            {r.photoRemark && <div style={{ fontSize: 11, color: '#999', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.photoRemark}>{r.photoRemark}</div>}
          </div>);
        }
        return <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#722ed1' }} icon={<CameraOutlined />} onClick={() => openPhotoCompany(r)}>去拍照</Button>;
      },
    },
    { title: HT('何时上架', '拍完上架=回传日+上架期限；到货上架=到货日+上架期限；只拍不上架无期限'), dataIndex: 'photoThenList', key: 'photoThenList', width: 110, align: 'center', render: v => (v ? <Tag color={v === '拍完上架' ? 'green' : v === '到货上架' ? 'blue' : 'default'}>{v}</Tag> : '—') },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 110, align: 'center', render: v => v || '—' },
    {
      title: HT('图片接收状态', '引用「回传图片」表对应货号最新一条回传记录的接收状态'), dataIndex: 'photoRecvStatus', key: 'photoRecvStatus', width: 110, align: 'center',
      render: (v, r) => { const st = photoStatusOf(r.styleCode, v); return <Tag color={st === '已收到' ? 'blue' : 'default'}>{st || '未收到'}</Tag>; },
    },
    {
      title: HT('拍照逾期', '新增新款后超过拍照期限天仍未收到图片则判定拍照逾期'), key: 'photoOver', width: 90, align: 'center',
      render: (_v, r) => (isPhotoOverdue(r) ? <Tag color="red">逾期</Tag> : <Tag color="green">正常</Tag>),
    },
    {
      title: HT('到货情况', '引用到货拍照任务表：已登记到货；超期限未到货判定到货逾期'), dataIndex: 'arrivalStatus', key: 'arrivalStatus', width: 100, align: 'center',
      render: (v, r) => { const st = arrivalDisplayOf(r); return <Tag color={st === '已到货' || st === '已收到' ? 'green' : st === '到货逾期' ? 'red' : 'orange'}>{st}</Tag>; },
    },
    {
      title: '外拍回传', key: 'relPhoto', width: 90, align: 'center',
      render: (_v, r) => { const n = photos.filter(x => x.styleCode === r.styleCode).length; return <Button type="link" size="small" icon={<CameraOutlined />} onClick={() => openRel(r.styleCode, 'photo')}>{n} 条</Button>; },
    },
    {
      title: '到货任务', key: 'relArr', width: 90, align: 'center',
      render: (_v, r) => { const n = arrivals.filter(x => x.styleCode === r.styleCode).length; return <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => openRel(r.styleCode, 'arrival')}>{n} 条</Button>; },
    },
    {
      title: HT('商品属性', '商品属性登记与完善状态，点击单元格登记/编辑'), key: 'listing', width: 110, align: 'center',
      render: (_v, r) => { const l = listingOf(r.styleCode); return <Button type="link" size="small" onClick={() => openListing(r.styleCode)}>{l ? (l.dataComplete === '资料已完善' ? <Tag color="green">已完善</Tag> : <Tag color="orange">未完善</Tag>) : '登记'}</Button>; },
    },
    {
      title: HT('生成表格', '勾选货号点「生成表格」导出后自动记录为已生成'), key: 'genStatus', width: 100, align: 'center',
      render: (_v, r) => (r.genAt ? <Tooltip title={`生成时间：${r.genAt}`}><Tag color="green">已生成</Tag></Tooltip> : <Tag>未生成</Tag>),
    },
    {
      title: HT('上架逾期', '超过预计上架完成且未上架任何平台'), key: 'listOver', width: 90, align: 'center',
      render: (_v, r) => (listOverdueOf(r) ? <Tag color="red">逾期</Tag> : <Tag color="green">正常</Tag>),
    },
    { title: HT('上架平台', '回传表「上架」动作勾选平台的并集'), key: 'platforms', width: 150, render: (_v, r) => { const ps = photoPlatformsOf(r.styleCode); return ps.length ? ps.map(p => <Tag key={p} color="blue" style={{ marginBottom: 2 }}>{p}</Tag>) : '—'; } },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, align: 'center', render: v => v || '—' },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: v => v || '—' },
    {
      title: '操作', key: 'action', width: 150, align: 'center', fixed: 'right',
      render: (_v, r) => (
        <Space size={0}>
          <Button type="link" size="small" style={{ padding: '0 4px' }} icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" style={{ padding: '0 4px' }} danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({ title: '确定删除该新款记录？', content: r.styleCode, onOk: () => handleDelete(r) })}>删除</Button>
        </Space>
      ),
    },
  ];

  // ---------- 主表列按字段配置组装（顺序+显隐）+ 列宽拖拽；操作列固定末尾 ----------
  const baseCols = progressColumns.filter(c => c.key !== 'action');
  const actionCol = progressColumns.find(c => c.key === 'action');
  const allFieldKeys = baseCols.map(c => String(c.key));
  const fullOrder = [...fieldCfg.order.filter(k => allFieldKeys.includes(k)), ...allFieldKeys.filter(k => !fieldCfg.order.includes(k))];
  const finalProgressCols = wrapProgressColumns([
    ...fullOrder.filter(k => !fieldCfg.hidden.includes(k)).map(k => baseCols.find(c => String(c.key) === k)!).filter(Boolean),
    ...(actionCol ? [actionCol] : []),
  ] as any);

  return (
    <div style={{ padding: 8 }}>
      {!photoOnly && (
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
        <Row gutter={[12, 12]}>
          <Col flex="1 1 140px"><Statistic title="新款总数" value={stats.total} suffix="款" /></Col>
          <Col flex="1 1 140px" style={{ cursor: 'pointer' }} onClick={() => { setFocusCodes(Array.from(new Set(progress.filter(r => !String(r.styleCode || '').trim()).map(r => r.styleCode)))); setFocusLabel('货号为空'); setActiveTab('progress'); }}>
            <Statistic title={<span>货号为空<Tooltip title="统计货号字段为空的记录，点击筛选对应行"><span style={{ marginLeft: 4, color: '#999', fontSize: 11 }}>点击筛选</span></Tooltip></span>} value={stats.emptyCode} suffix="款" valueStyle={{ color: '#f5222d' }} />
          </Col>
          <Col flex="1 1 140px" style={{ cursor: 'pointer' }} onClick={() => { setFocusCodes(Array.from(new Set(progress.filter(r => !(Number(r.costPrice) > 0)).map(r => r.styleCode)))); setFocusLabel('成本价为空'); setActiveTab('progress'); }}>
            <Statistic title={<span>成本价为空<Tooltip title="统计成本价为空或为 0 的货号，点击筛选对应行"><span style={{ marginLeft: 4, color: '#999', fontSize: 11 }}>点击筛选</span></Tooltip></span>} value={stats.emptyCost} suffix="款" valueStyle={{ color: '#fa8c16' }} />
          </Col>
          <Col flex="1 1 140px" style={{ cursor: 'pointer' }} onClick={() => { setFocusCodes(Array.from(new Set(arrivalOverList.map(p => p.styleCode)))); setFocusLabel('到货逾期'); setActiveTab('progress'); }}>
            <Statistic title={<span>到货逾期<Tooltip title="点击筛选新款进度表中对应逾期货号"><span style={{ marginLeft: 4, color: '#999', fontSize: 11 }}>点击筛选</span></Tooltip></span>} value={stats.arrivalOver} suffix="款" valueStyle={{ color: '#f5222d' }} />
          </Col>
          <Col flex="1 1 140px" style={{ cursor: 'pointer' }} onClick={() => { setFocusCodes(Array.from(new Set(incompleteList.map(p => p.styleCode)))); setFocusLabel('资料未完善'); setActiveTab('progress'); }}>
            <Statistic title={<span>资料未完善<Tooltip title="点击筛选新款进度表中对应货号"><span style={{ marginLeft: 4, color: '#999', fontSize: 11 }}>点击筛选</span></Tooltip></span>} value={stats.incomplete} suffix="款" valueStyle={{ color: '#fa8c16' }} />
          </Col>
          <Col flex="1 1 140px" style={{ cursor: 'pointer' }} onClick={() => { setFocusCodes(Array.from(new Set(photoOverList.map(p => p.styleCode)))); setFocusLabel('拍照逾期'); setActiveTab('progress'); }}>
            <Statistic title={<span>拍照逾期<Tooltip title="点击筛选新款进度表中对应逾期货号"><span style={{ marginLeft: 4, color: '#999', fontSize: 11 }}>点击筛选</span></Tooltip></span>} value={stats.photoOver} suffix="款" valueStyle={{ color: '#fa8c16' }} />
          </Col>
          <Col flex="1 1 140px" style={{ cursor: 'pointer' }} onClick={() => { setFocusCodes(Array.from(new Set(photoListOver.map(p => p.styleCode)))); setFocusLabel('上架逾期'); setActiveTab('progress'); }}>
            <Statistic title={<span>上架逾期<Tooltip title="点击筛选新款进度表中对应逾期货号"><span style={{ marginLeft: 4, color: '#999', fontSize: 11 }}>点击筛选</span></Tooltip></span>} value={photoListOver.length} suffix="款" valueStyle={{ color: '#f5222d' }} />
          </Col>
        </Row>
      </Card>
      )}

      <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: 12 }}>
        <div ref={tableAreaRef}>
        {!photoOnly && (
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          { key: 'progress', label: '主表单' },
          { key: 'photo', label: `回传图片(${photos.length})` },
          { key: 'arrival', label: `到货款式(${arrivals.length})` },
          { key: 'listing', label: `商品属性(${listings.length})` },
        ]} style={{ marginBottom: 8 }} />
        )}

        {activeTab === 'progress' && (
          <>
            <Space wrap style={{ marginBottom: 8 }}>
              <Input placeholder="货号" allowClear style={{ width: 110 }} value={fIn.code} onChange={e => setFIn(p => ({ ...p, code: e.target.value }))} onPressEnter={applySearch} />
              <Input placeholder="成本价" allowClear style={{ width: 90 }} value={fIn.cost} onChange={e => setFIn(p => ({ ...p, cost: e.target.value }))} onPressEnter={applySearch} />
              <Input placeholder="颜色" allowClear style={{ width: 100 }} value={fIn.color} onChange={e => setFIn(p => ({ ...p, color: e.target.value }))} onPressEnter={applySearch} />
              <Input placeholder="码段" allowClear style={{ width: 90 }} value={fIn.size} onChange={e => setFIn(p => ({ ...p, size: e.target.value }))} onPressEnter={applySearch} />
              <Input placeholder="工厂名称" allowClear style={{ width: 110 }} value={fIn.factory} onChange={e => setFIn(p => ({ ...p, factory: e.target.value }))} onPressEnter={applySearch} />
              <Input placeholder="品牌" allowClear style={{ width: 100 }} value={fIn.brand} onChange={e => setFIn(p => ({ ...p, brand: e.target.value }))} onPressEnter={applySearch} />
              <Input placeholder="拍照地" allowClear style={{ width: 100 }} value={fIn.place} onChange={e => setFIn(p => ({ ...p, place: e.target.value }))} onPressEnter={applySearch} />
              <Select placeholder="图片接收状态" allowClear style={{ width: 120 }} value={fIn.recv || undefined} onChange={v => setFIn(p => ({ ...p, recv: v || '' }))} options={[{ value: '已收到' }, { value: '未收到' }]} />
              <Input placeholder="上架平台" allowClear style={{ width: 100 }} value={fIn.platform} onChange={e => setFIn(p => ({ ...p, platform: e.target.value }))} onPressEnter={applySearch} />
              <RangePicker allowClear style={{ width: 240 }} placeholder={['创建开始', '创建结束']}
                value={fIn.range ? [dayjs(fIn.range[0]), dayjs(fIn.range[1])] : null}
                onChange={(_d, ds) => { const rg = (ds && ds[0] ? [ds[0], ds[1]] : null) as [string, string] | null; setFIn(p => ({ ...p, range: rg })); setFAp(p => ({ ...p, range: rg })); }} />
              <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>查询</Button>
              <Checkbox checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)}>只看逾期</Checkbox>
              {focusCodes && <Tag color="red" closable onClose={() => setFocusCodes(null)}>{focusLabel}筛选：{focusCodes.length} 个货号</Tag>}
            </Space>
            <Space wrap style={{ marginBottom: 12 }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增新款</Button>
              <Button icon={<UploadOutlined />} onClick={() => importRef.current?.click()}>导入Excel</Button>
              <Button icon={<DownloadOutlined />} onClick={handleExport}>导出Excel</Button>
              <Button icon={<RocketOutlined />} onClick={openGen}>生成表格{genSelectedKeys.length ? `(${genSelectedKeys.length})` : ''}</Button>
              <Button icon={<ReloadOutlined />} onClick={() => setRefreshTick(t => t + 1)}>刷新</Button>
              <Button icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示字段</Button>
              <span style={{ marginLeft: 8, color: '#666', fontSize: 12 }}>行高</span>
              <InputNumber min={40} max={200} step={4} value={rowH} onChange={v => { const n = Number(v) || 56; setRowH(n); localStorage.setItem(`newstyle_rowh_${owner}`, String(n)); }} style={{ width: 64 }} />
              <input ref={importRef} type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
            </Space>
            <style>{`.ns-rowh .ant-table-tbody > tr > td { height: ${rowH}px; }`}</style>
            <div className="ns-rowh">
            <Table rowKey="key" bordered size="small" columns={finalProgressCols} dataSource={filteredProgress}
              rowSelection={{ selectedRowKeys: genSelectedKeys, onChange: keys => setGenSelectedKeys(keys as string[]) }}
              scroll={{ x: 2200, y: tableScrollY }} pagination={{ pageSize: mainPageSize, showSizeChanger: true, showTotal: t => `共 ${t} 条`, onChange: (_p, ps) => setMainPageSize(ps) }}
              locale={{ emptyText: <Empty description="暂无新款记录，可新增或导入Excel" /> }} />
            </div>
          </>
        )}
        {activeTab === 'photo' && <PhotoTab photos={photos} save={savePhotos} styleCodes={progress.map(p => p.styleCode).filter(Boolean)} owner={owner} progress={progress} arrivals={arrivals} listings={listings} onOpenListing={openListing} onConfigChange={() => setRefreshTick(t => t + 1)} photoOnly={photoOnly} />}
        {activeTab === 'arrival' && <ArrivalTab arrivals={arrivals} save={saveArrivals} owner={owner} styleCodes={progress.map(p => p.styleCode).filter(Boolean)} onConfigChange={() => setRefreshTick(t => t + 1)} />}
        {activeTab === 'listing' && <ListingTab listings={listings} save={saveListings} styleCodes={progress.map(p => p.styleCode).filter(Boolean)} owner={owner} photos={photos} fieldCfg={listFieldCfg} onConfigChange={() => setRefreshTick(t => t + 1)} />}
        </div>
      </Card>

      {/* 新增/编辑新款 */}
      <Modal title={editing ? `编辑新款 - ${editing.styleCode}` : '新增新款'} open={editVisible} onOk={handleSave} onCancel={() => setEditVisible(false)} okText="保存" cancelText="取消" width={860} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="styleCode" label="货号" rules={[{ required: true, message: '请输入货号' }]}><Input placeholder="如 NBL-0406" /></Form.Item></Col>
            <Col span={6}><Form.Item name="brand" label="品牌"><AutoComplete placeholder="下拉选择或输入新增" options={brandOpts}
                      filterOption={(input, option: any) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
                      notFoundContent={<div style={{ padding: '8px 4px', color: '#888', fontSize: 12 }}>
                        {brandOpts.length === 0
                          ? <span>暂无品牌数据，请先在 <Text strong style={{ color: '#1677ff' }}>电商常用 → 品牌管理 → 授权品牌/自有品牌 → 品牌台账</Text> 中添加品牌</span>
                          : <span>未找到匹配品牌，可手动输入或前往 <Text strong style={{ color: '#1677ff' }}>品牌管理 → 品牌台账</Text> 添加</span>}
                      </div>}
                      /></Form.Item></Col>
            <Col span={6}><Form.Item name="factory" label="工厂名称"><Input placeholder="如 丰鹏" /></Form.Item></Col>
            <Col span={6}><Form.Item name="costPrice" label="成本价"><InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="0.00" /></Form.Item></Col>
            <Col span={6}><Form.Item name="color" label="颜色"><ColorTagsEditor /></Form.Item></Col>
            <Col span={6}><Form.Item name="sizeRange" label="码段"><SizeCheckEditor /></Form.Item></Col>
            <Col span={6}><Form.Item name="craft" label="制作工艺"><AutoComplete placeholder="下拉选择或输入新增" options={craftOpts} filterOption={(input, option: any) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={6}><Form.Item name="photoThenList" label="何时上架"><Select options={[{ value: '拍完上架' }, { value: '到货上架' }, { value: '只拍不上架' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="remark" label="备注"><Input.TextArea rows={1} placeholder="选填" /></Form.Item></Col>
            <Col span={6}><Form.Item name="image" label="款式图片"><ImgSlot value={form.getFieldValue('image') || ''} onChange={v => form.setFieldsValue({ image: v })} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 货号详情弹窗：点击货号展示该货号所有字段内容 */}
      <Modal title={`货号详情 - ${detailRec?.styleCode || ''}`} open={!!detailRec} onCancel={() => setDetailRec(null)} footer={[<Button key="close" onClick={() => setDetailRec(null)}>关闭</Button>]} width={760}>
        {detailRec && (<Descriptions bordered size="small" column={2} style={{ marginTop: 8 }}>
          <Descriptions.Item label="货号">{detailRec.styleCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="成本价">{detailRec.costPrice ? `¥${detailRec.costPrice}` : '—'}</Descriptions.Item>
          <Descriptions.Item label="颜色">{detailRec.color || '—'}</Descriptions.Item>
          <Descriptions.Item label="码段">{formatSizes(detailRec.sizeRange) || '—'}</Descriptions.Item>
          <Descriptions.Item label="工厂名称">{detailRec.factory || '—'}</Descriptions.Item>
          <Descriptions.Item label="品牌">{detailRec.brand || '—'}</Descriptions.Item>
          <Descriptions.Item label="制作工艺">{detailRec.craft || '—'}</Descriptions.Item>
          <Descriptions.Item label="何时上架">{detailRec.photoThenList || '—'}</Descriptions.Item>
          <Descriptions.Item label="拍照地">{detailRec.photoPlace || '—'}{detailRec.photoRemark ? `（备注：${detailRec.photoRemark}）` : ''}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{detailRec.createdAt || '—'}</Descriptions.Item>
          <Descriptions.Item label="图片接收状态">{photoStatusOf(detailRec.styleCode, detailRec.photoRecvStatus) || '未收到'}</Descriptions.Item>
          <Descriptions.Item label="拍照逾期">{isPhotoOverdue(detailRec) ? <Tag color="red">逾期</Tag> : <Tag color="green">正常</Tag>}</Descriptions.Item>
          <Descriptions.Item label="到货情况">{arrivalDisplayOf(detailRec)}</Descriptions.Item>
          <Descriptions.Item label="上架逾期">{listOverdueOf(detailRec) ? <Tag color="red">逾期</Tag> : <Tag color="green">正常</Tag>}</Descriptions.Item>
          <Descriptions.Item label="商品属性">{(() => { const l = listingOf(detailRec.styleCode); return l ? <Tag color={l.dataComplete === '资料已完善' ? 'green' : 'orange'}>{l.dataComplete}</Tag> : '未登记'; })()}</Descriptions.Item>
          <Descriptions.Item label="上架平台">{(() => { const ps = photoPlatformsOf(detailRec.styleCode); return ps.length ? ps.map(p => <Tag key={p} color="blue">{p}</Tag>) : '—'; })()}</Descriptions.Item>
          <Descriptions.Item label="生成表格">{detailRec.genAt ? <Tag color="green">已生成 {detailRec.genAt}</Tag> : <Tag>未生成</Tag>}</Descriptions.Item>
          <Descriptions.Item label="创建人">{detailRec.creator || '—'}</Descriptions.Item>
          <Descriptions.Item label="回传记录">{photos.filter(p => p.styleCode === detailRec.styleCode).length} 条</Descriptions.Item>
          <Descriptions.Item label="到货任务">{arrivals.filter(a => a.styleCode === detailRec.styleCode).length} 条</Descriptions.Item>
          <Descriptions.Item label="备注" span={2}>{detailRec.remark || '—'}</Descriptions.Item>
          <Descriptions.Item label="款式图片" span={2}>{detailRec.image ? <AntdImage src={detailRec.image} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 6 }} /> : '—'}</Descriptions.Item>
        </Descriptions>)}
      </Modal>

      {/* 关联任务弹窗 */}
      <Modal title={`${relType === 'photo' ? '回传图片' : '到货款式'} - ${relStyle}`} open={!!relStyle} onCancel={() => setRelStyle('')} footer={[
        <Button key="close" onClick={() => setRelStyle('')}>关闭</Button>,
        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => { relForm.resetFields(); setRelImage(''); setRelAddVisible(true); }}>新增任务</Button>,
      ]} width={820}>
        <Table rowKey="key" bordered size="small" pagination={false} dataSource={relRecords}
          columns={((relType === 'photo' ? [
            { title: '创建时间', dataIndex: 'createdAt', width: 110, align: 'center' },
            { title: '图片', dataIndex: 'image', width: 70, align: 'center', render: (v: string) => (v ? <AntdImage src={v} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—') },
            { title: '图片接收状态', dataIndex: 'recvStatus', width: 110, align: 'center', render: (v: string) => <Tag color={v === '已收到' ? 'blue' : 'default'}>{v || '未收到'}</Tag> },
            { title: '预计上架完成', dataIndex: 'planListDate', width: 120, align: 'center', render: (v: string) => v || '—' },
            { title: '创建人', dataIndex: 'creator', width: 100, align: 'center' },
            { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string) => v || '—' },
          ] : [
            { title: '日期', dataIndex: 'date', width: 110, align: 'center' },
            { title: '图片', dataIndex: 'image', width: 70, align: 'center', render: (v: string) => (v ? <AntdImage src={v} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—') },
            { title: '到货情况', dataIndex: 'arrivalStatus', width: 110, align: 'center', render: (v: string) => <Tag color={v === '已到货' ? 'green' : 'orange'}>{v || '未到货'}</Tag> },
            { title: '上架超时日期', dataIndex: 'overdueDate', width: 120, align: 'center', render: (v: string) => v || '—' },
            { title: '创建人', dataIndex: 'creator', width: 100, align: 'center' },
          ] as any).concat([{
            title: '操作', key: 'op', width: 80, align: 'center',
            render: (_v: any, r: any) => <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleRelDelete(r.key)}>删除</Button>,
          }] as any))}
          locale={{ emptyText: <Empty description="暂无任务记录" /> }} />
      </Modal>

      {/* 关联任务新增 */}
      <Modal title={relType === 'photo' ? `新增外拍回传 - ${relStyle}` : `新增到货任务 - ${relStyle}`} open={relAddVisible} onOk={handleRelAdd} onCancel={() => setRelAddVisible(false)} okText="保存" cancelText="取消" width={560} destroyOnClose>
        <Form autoComplete="off" form={relForm} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            {relType === 'photo' ? (
              <>
                <Col span={8}><Form.Item name="recvStatus" label="图片接收状态" initialValue="未收到"><Select options={[{ value: '未收到' }, { value: '已收到' }]} /></Form.Item></Col>
                <Col span={8}><Form.Item name="planListDate" label="预计上架完成"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>
                <Col span={8}><Form.Item name="remark" label="备注"><Input placeholder="选填" /></Form.Item></Col>
              </>
            ) : (
              <>
                <Col span={8}><Form.Item name="arrivalStatus" label="到货情况" initialValue="已到货"><Select options={[{ value: '未到货' }, { value: '已到货' }]} /></Form.Item></Col>
                <Col span={8}><Form.Item name="date" label="日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>
                <Col span={8}><Form.Item name="overdueDate" label="上架超时日期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>
              </>
            )}
            <Col span={12}><Form.Item label="图片"><ImgSlot value={relImage} onChange={setRelImage} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 上架进度编辑 */}
      <Modal title={`商品属性 - ${listStyle}`} open={listVisible} onOk={handleListSave} onCancel={() => setListVisible(false)} okText="保存" cancelText="取消" width={760} destroyOnClose>
        <Form autoComplete="off" form={listForm} layout="vertical" style={{ marginTop: 8 }} onValuesChange={(_c, all) => listForm.setFieldsValue({ dataComplete: completeListOf(all) })}>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="dataComplete" label="数据是否完善（自动判定）"><Select disabled options={[{ value: '资料未完善' }, { value: '资料已完善' }]} /></Form.Item></Col>
            <Col span={8}><Form.Item name="date" label="日期（自动记录）"><Input disabled /></Form.Item></Col>
            {activeBuiltins.map(k => (<Col span={6} key={k}><Form.Item name={k} label={labelOf(k)}><Input placeholder="选填" /></Form.Item></Col>))}
            {extraFields.map(f => (<Col span={6} key={f}><Form.Item name={f} label={f}><Input placeholder="选填" /></Form.Item></Col>))}
            <Col span={6}>
              <Form.Item label="新增字段">
                <Input placeholder="自定义字段名" value={listNewField} onChange={e => setListNewField(e.target.value)} style={{ width: '100%', marginBottom: 4 }} />
                <Button block icon={<PlusOutlined />} onClick={addListExtraField} style={{ marginBottom: 4 }}>新增字段</Button>
                <Button block icon={<SettingOutlined />} onClick={() => { setMgrDraft(Object.fromEntries([...activeBuiltins.map(k => [k, labelOf(k)] as [string, string]), ...extraFields.map(f => [f, f] as [string, string])])); setFieldMgrVisible(true); }}>字段管理</Button>
              </Form.Item>
            </Col>
            <Col span={24}><Form.Item label="图片（最多5张）"><ImgMultiSlot value={listImages} onChange={setListImages} max={5} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 生成表格：参数填写 + 预览 + 导出 */}
      <Modal title={`生成表格 - 已勾选 ${genSelectedKeys.length} 个货号`} open={genVisible} onOk={handleGenExport} onCancel={() => setGenVisible(false)} okText="确认生成并导出" cancelText="取消" width={960} okButtonProps={{ disabled: genInvalidList.length > 0 }}>
        <Row gutter={[12, 8]}>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>加价数值（基础售价=成本价+加价）</div><InputNumber min={0} precision={2} style={{ width: '100%' }} value={genParams.markup} onChange={v => setGenParams(p => ({ ...p, markup: Number(v) || 0 }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>商品标签</div><Input placeholder="如 单鞋" value={genParams.tag} onChange={e => setGenParams(p => ({ ...p, tag: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>虚拟库存数</div><Input placeholder="如 500" value={genParams.virtualStock} onChange={e => setGenParams(p => ({ ...p, virtualStock: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>分类</div><Input placeholder="如 平底休闲鞋" value={genParams.category} onChange={e => setGenParams(p => ({ ...p, category: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>重量</div><Input placeholder="如 0.8" value={genParams.weight} onChange={e => setGenParams(p => ({ ...p, weight: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>长</div><Input placeholder="如 28" value={genParams.len} onChange={e => setGenParams(p => ({ ...p, len: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>宽</div><Input placeholder="如 21" value={genParams.wid} onChange={e => setGenParams(p => ({ ...p, wid: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>高</div><Input placeholder="如 11" value={genParams.hei} onChange={e => setGenParams(p => ({ ...p, hei: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>其它属性4（鞋面材质自动填充）</div><Input placeholder="如 皮面" value={genParams.attr4} onChange={e => setGenParams(p => ({ ...p, attr4: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>其它属性5</div><Input placeholder="如 女式休闲鞋" value={genParams.attr5} onChange={e => setGenParams(p => ({ ...p, attr5: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>其它属性3</div><Input placeholder="如 T95" value={genParams.attr3} onChange={e => setGenParams(p => ({ ...p, attr3: e.target.value }))} /></Col>
          <Col span={6}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>备注</div><Input placeholder="选填" value={genParams.remark} onChange={e => setGenParams(p => ({ ...p, remark: e.target.value }))} /></Col>
        </Row>
        {genInvalidList.length > 0 && <div style={{ margin: '8px 0 0', padding: '6px 10px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4, color: '#cf1322', fontSize: 12 }}>以下货号字段为空，补齐前不能导出：{genInvalidList.map(x => `${x.code}（缺${x.miss.join('/')}）`).join('、')}</div>}
        <div style={{ margin: '10px 0 6px', color: '#666', fontSize: 12 }}>预览（共 {genPreviewRows.length} 行，按勾选货号的颜色×规格展开；长/宽/高优先取商品属性「盒装体积」（如 28*16*11）解析，未填则以弹窗手填为准；体积=长×宽×高÷1,000,000 自动计算；其它属性1=制作工艺；其它属性2=尺码×5+50 自动换算；其它属性4=商品属性中的鞋面材质；供应商名称=工厂名称）：</div>
        <Table rowKey={(r: any) => r['商品编码']} bordered size="small" columns={GEN_PREVIEW_COLS} dataSource={genPreviewRows.slice(0, 200)} scroll={{ x: 1800, y: 320 }} pagination={false} locale={{ emptyText: <Empty description="无预览行" /> }} />
      </Modal>

      {/* 去拍照：拍照公司选择/新增 */}
      <Modal title={`去拍照 - ${photoCompanyTarget?.styleCode || ''}`} open={!!photoCompanyTarget} onOk={handlePhotoCompanySave} onCancel={() => setPhotoCompanyTarget(null)} okText="保存" cancelText="取消" width={560}>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>点击选择拍照公司（登记后写入该款式的拍照地字段，底色与主表一致）：</div>
        <Space wrap size={8} style={{ marginBottom: 4 }}>
          {photoCompanies.map((c, i) => {
            const active = photoCompanyPick === c;
            return (
              <div key={c} onClick={() => setPhotoCompanyPick(active ? '' : c)}
                style={{ background: COMPANY_BG[i % COMPANY_BG.length], border: active ? '2px solid #722ed1' : '1px solid #d9d9d9', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontWeight: active ? 600 : 400, color: '#333' }}>
                {active ? '✓ ' : ''}{c}
              </div>
            );
          })}
          {photoCompanies.length === 0 && <div style={{ color: '#999', fontSize: 12 }}>暂无拍照公司，请先在下方新增</div>}
        </Space>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <Input placeholder="新增拍照公司名称" value={newCompany} onChange={e => setNewCompany(e.target.value)} style={{ width: 220 }} />
          <Button icon={<PlusOutlined />} onClick={addPhotoCompany}>新增拍照公司</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>备注（快递单号等）</div>
          <Input placeholder="如 快递单号 SF1234567890" value={photoCompanyRemark} onChange={e => setPhotoCompanyRemark(e.target.value)} />
        </div>
      </Modal>

      {/* 字段管理：内置+自定义字段改名/删除 */}
      <Modal title="字段管理" open={fieldMgrVisible} onCancel={() => setFieldMgrVisible(false)} width={520}
        footer={<Button type="primary" onClick={() => setFieldMgrVisible(false)}>完成</Button>}>
        <div style={{ marginBottom: 6, color: '#666', fontSize: 13 }}>内置字段</div>
        {activeBuiltins.map(k => (
          <Space key={k} style={{ display: 'flex', marginBottom: 8 }}>
            <Tag color="blue" style={{ marginRight: 0 }}>内置</Tag>
            <Input value={mgrDraft[k] ?? labelOf(k)} onChange={e => setMgrDraft(d => ({ ...d, [k]: e.target.value }))} style={{ width: 180 }} />
            <Button onClick={() => applyRenameBuiltin(k)}>改名</Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => applyHideBuiltin(k)}>删除</Button>
          </Space>
        ))}
        {listFieldCfg.hidden.length > 0 && (<>
          <div style={{ margin: '8px 0 6px', color: '#666', fontSize: 13 }}>已删除的内置字段</div>
          {listFieldCfg.hidden.map(k => (
            <Space key={k} style={{ display: 'flex', marginBottom: 8 }}>
              <Tag style={{ marginRight: 0 }}>已删除</Tag>
              <span style={{ width: 180, color: '#999', display: 'inline-block' }}>{listFieldCfg.labels[k] || BUILTIN_LABELS[k]}</span>
              <Button icon={<PlusOutlined />} onClick={() => restoreBuiltin(k)}>恢复</Button>
            </Space>
          ))}
        </>)}
        <div style={{ margin: '8px 0 6px', color: '#666', fontSize: 13 }}>自定义字段</div>
        {extraFields.length === 0 && <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>暂无自定义字段</div>}
        {extraFields.map(f => (
          <Space key={f} style={{ display: 'flex', marginBottom: 8 }}>
            <Tag color="green" style={{ marginRight: 0 }}>自定义</Tag>
            <Input value={mgrDraft[f] ?? f} onChange={e => setMgrDraft(d => ({ ...d, [f]: e.target.value }))} style={{ width: 180 }} />
            <Button onClick={() => applyRenameField(f)}>改名</Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => applyDeleteField(f)}>删除</Button>
          </Space>
        ))}
        <div style={{ fontSize: 12, color: '#999' }}>内置字段改名仅改显示名称（已存数据不变）；删除内置字段=从表单与表格隐藏（已存数据保留，可恢复）；删除自定义字段会同步清除各货号已存的对应属性值。</div>
      </Modal>

      {/* 显示字段设置：勾选显隐 + 拖动/箭头调整顺序（持久化） */}
      <FieldConfigModal
        open={fieldCfgVisible}
        fields={baseCols.map(c => ({ key: String(c.key), label: plainTitleOf(c.title) }))}
        order={fullOrder}
        visibility={Object.fromEntries(fullOrder.map(k => [k, !fieldCfg.hidden.includes(k)]))}
        onCancel={() => setFieldCfgVisible(false)}
        onSave={(order, vis) => {
          const hidden = order.filter(k => !vis[k]);
          setFieldCfg({ order, hidden });
          safeSetItem(`newstyle_fieldcfg_${owner}`, JSON.stringify({ order, hidden }));
          setFieldCfgVisible(false);
          message.success('字段显示配置已应用');
        }}
      />
    </div>
  );
};

// ===================== 首页看板数据导出（供应商/采购商首页共用，与本页统计同口径） =====================
export interface NewstyleBoardStats {
  total: number; emptyCode: number; emptyCost: number; arrivalOver: number;
  incomplete: number; photoOver: number; listOver: number;
}
export interface NewstyleBoard { stats: NewstyleBoardStats; rows: any[]; }

/** 读取新款进度四表并按本页同口径计算看板统计（逾期/未完善判定与本页完全一致） */
export function computeNewstyleBoard(owner: string): NewstyleBoard {
  const progress: ProgressRec[] = safeJson(`newstyle_progress_${owner}`, []);
  const photos: PhotoRec[] = safeJson(`newstyle_photo_${owner}`, []);
  const arrivals: ArrivalRec[] = safeJson(`newstyle_arrival_${owner}`, []);
  const listings: any[] = safeJson(`newstyle_listing_${owner}`, []);
  const deadlines = readDeadlines(owner);
  const photoStatusOf = (styleCode: string, fallback: string): string => {
    const rs = photos.filter(p => p.styleCode === styleCode);
    if (!rs.length) return fallback;
    const latest = [...rs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return latest.recvStatus || fallback;
  };
  const arrivalStatusOf = (styleCode: string, fallback: string): string => {
    const rs = arrivals.filter(a => a.styleCode === styleCode);
    if (!rs.length) return fallback;
    const latest = [...rs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    return latest.arrivalStatus || fallback;
  };
  const arrivalDisplayOf = (r: ProgressRec): string => {
    const st = arrivalStatusOf(r.styleCode, r.arrivalStatus);
    if (st === '已到货' || st === '已收到') return st;
    if (parseDate(r.createdAt) > 0 && todayTs() - parseDate(r.createdAt) > deadlines.overdue * 86400000) return '到货逾期';
    return st || '未到货';
  };
  const isPhotoOverdue = (r: ProgressRec): boolean => {
    if (parseDate(r.createdAt) <= 0) return false;
    if (todayTs() - parseDate(r.createdAt) <= deadlines.photoOver * 86400000) return false;
    return photoStatusOf(r.styleCode, r.photoRecvStatus) !== '已收到';
  };
  // 上架逾期（与本页统计卡同口径：外拍回传记录派生预计上架完成已过且未上架任何平台）
  const photoListOver = photos.filter(p => {
    if ((p.platforms || []).length || p.listedAt) return false;
    const mode = photoModeOf(progress, p.styleCode);
    if (mode === '只拍不上架') return false;
    const plan = planDateOfPhoto(p, mode, latestArrivalDateOf(arrivals, p.styleCode), deadlines.photo, deadlines.arrival);
    return !!plan && todayTs() > parseDate(plan);
  });
  const listOverCodes = new Set(photoListOver.map(p => p.styleCode));
  const stats: NewstyleBoardStats = {
    total: progress.length,
    emptyCode: progress.filter(r => !String(r.styleCode || '').trim()).length,
    emptyCost: progress.filter(r => !(Number(r.costPrice) > 0)).length,
    arrivalOver: progress.filter(r => arrivalDisplayOf(r) === '到货逾期').length,
    incomplete: progress.filter(r => (listings.find((l: any) => l.styleCode === r.styleCode)?.dataComplete || '') !== '资料已完善').length,
    photoOver: progress.filter(isPhotoOverdue).length,
    listOver: photoListOver.length,
  };
  const rows = [...progress].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(r => ({
    ...r,
    boardArrival: arrivalDisplayOf(r),
    boardPhotoOver: isPhotoOverdue(r),
    boardListOver: listOverCodes.has(r.styleCode),
    boardIncomplete: (listings.find((l: any) => l.styleCode === r.styleCode)?.dataComplete || '') !== '资料已完善',
  }));
  return { stats, rows };
}

export default NewStyleProgressPage;
