import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Card, Table, Button, Space, Input, InputNumber, Modal, Tag, message, Image, Select, Radio, Empty, Row, Col, Tooltip, Pagination, Popover,
} from 'antd';
import {
  PlusOutlined, ShoppingCartOutlined, EyeOutlined, ToolOutlined, PictureOutlined, SnippetsOutlined, DeleteOutlined, EditOutlined, ShopOutlined,
  SearchOutlined, ReloadOutlined, CameraOutlined, CloseOutlined, MessageOutlined,
} from '@ant-design/icons';
import { compressImageFile } from '../utils/imageCompress';
import { safeSetItem } from '../utils/storageQuota';
import { flushDatasetUpload } from '../utils/serverSync';
import { computeSubjectFeatures, subjectSimilarity } from '../utils/imageSimilarity';
import { triggerOpenChat } from '../utils/chatSocket';
import type { MoldRecord, MoldSpec } from './MoldPage';

const PRIMARY = '#1e4a7e';

// ============ 类型定义 ============
export interface MoldListing {
  key: string;
  id: number;          // 货品ID（自增）
  moldKey: string;       // 关联 MoldRecord.key
  moldCode: string;
  moldName: string;
  spec: string;
  title: string;         // 标题
  mode: 'rent' | 'sell'; // 出租 or 出售
  rentPrice?: number;    // 每天租金
  sellPrice?: number;    // 出售价格
  images: string[];      // 上传的展示图片
  publisher: string;     // 发布人
  publisherCompany: string;
  createdAt: string;
  remark?: string;
  specs?: MoldSpec[];      // 规格明细与数量
  totalQuantity?: number;  // 模具数量总计
  dealt?: boolean;         // 成交标记（成交后模具管理列表按类型显示已出租/已出售）
}

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (!isSub) return localStorage.getItem('username') || '';
  return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
};

// 根据用户名实时解析公司名称
const resolveCompany = (username: string): string => {
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u?.companyName) return u.companyName;
    if (u?.displayName) return u.displayName;
  } catch { /* ignore */ }
  return '';
};

const STORAGE_KEY = () => `market_mold_listings`;
const CART_KEY = () => `mold_market_cart_${getDataOwner()}`;

/** 生成下一个模具货品ID */
const nextMoldId = (list: MoldListing[]): number => {
  const max = list.reduce((m: number, r: MoldListing) => Math.max(m, Number(r.id) || 0), 0);
  return max + 1;
};

// 模具租售图片存储：单独存储为 `mold_img_{listingKey}_{idx}` 键，避免列表 JSON 过大撑爆配额
const IMG_KEY = (listingKey: string, idx: number) => `mold_img_${listingKey}_${idx}`;

/** 将图片从 listing.images 写入独立存储键，listing 只保留引用键名 */
const extractImagesToKeys = (listing: MoldListing): MoldListing => {
  if (!listing.images || listing.images.length === 0) return listing;
  const keys: string[] = [];
  listing.images.forEach((dataUrl, idx) => {
    if (dataUrl.startsWith('data:')) {
      const k = IMG_KEY(listing.key, idx);
      try {
        localStorage.setItem(k, dataUrl);
        // 回读验证写入成功
        const verify = localStorage.getItem(k);
        if (verify === dataUrl) {
          keys.push(k);
        } else {
          keys.push(dataUrl); // 写入失败，保留原始数据
        }
      } catch {
        keys.push(dataUrl); // 配额不足，保留原始数据
      }
    } else {
      keys.push(dataUrl); // 已是引用键或外部 URL
    }
  });
  return { ...listing, images: keys };
};

/** 将图片引用键解析回实际图片数据 */
const resolveImageKeys = (listing: MoldListing): MoldListing => {
  if (!listing.images || listing.images.length === 0) return listing;
  const resolved = listing.images.map(ref => {
    if (ref.startsWith('data:') || ref.startsWith('http')) return ref;
    // 是引用键，读取实际数据
    try { return localStorage.getItem(ref) || ''; } catch { return ''; }
  }).filter(Boolean); // 过滤掉无法解析的空引用
  return { ...listing, images: resolved };
};

const MoldMarketTab: React.FC<{ onContact?: (username: string, subject: string) => void }> = ({ onContact }) => {
  const owner = getDataOwner();
  const username = localStorage.getItem('username') || '';
  const companyName = localStorage.getItem('companyName') || '';
  // 联系卖家：优先通过父组件切换到聊天标签页（ChatPage 挂载后才能消费打开请求），否则退化为缓冲触发
  const openChat = (target: string, subject: string) => {
    if (onContact) onContact(target, subject);
    else triggerOpenChat(target, subject);
  };

  const [listings, setListings] = useState<MoldListing[]>(() => {
    try {
      const raw: MoldListing[] = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]');
      return raw.map(resolveImageKeys);
    } catch { return []; }
  });

  // 数据迁移：将旧版内嵌图片提取到独立存储键，缩小列表 JSON 体积
  // 同时修复已损坏的引用键（键不存在时回退到无图）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY());
      if (!raw) return;
      const list: MoldListing[] = JSON.parse(raw);
      let changed = false;
      const migrated = list.map(l => {
        // 修复已损坏的键引用（mold_img_开头但 localStorage 中不存在）
        if (l.images && l.images.some(img => img.startsWith('mold_img_') && !localStorage.getItem(img))) {
          changed = true;
          return { ...l, images: l.images.filter(img => !img.startsWith('mold_img_') || localStorage.getItem(img)) };
        }
        // 内嵌大图提取到独立键
        if (raw.length > 200000 && l.images && l.images.some(img => img.startsWith('data:'))) {
          changed = true;
          return extractImagesToKeys(l);
        }
        return l;
      });
      if (changed) safeSetItem(STORAGE_KEY(), JSON.stringify(migrated));
    } catch { /* ignore */ }
  }, []);

  // ============ 添加模具弹窗 ============
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedMold, setSelectedMold] = useState<MoldRecord | null>(null);

  // 模式选择弹窗
  const [modeVisible, setModeVisible] = useState(false);
  const [mode, setMode] = useState<'rent' | 'sell'>('rent');
  const [rentPrice, setRentPrice] = useState<number>(0);
  const [sellPrice, setSellPrice] = useState<number>(0);
  const [listingRemark, setListingRemark] = useState('');
  const [listingTitle, setListingTitle] = useState('');

  // 图片上传
  const [listingImages, setListingImages] = useState<string[]>([]);
  const imgInputRef = useRef<HTMLInputElement>(null);
  // 拖拽排序
  const dragItemRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<MoldListing | null>(null);

  // 子视图：'market' 全部市场 | 'mine' 我的模具
  const [subView, setSubView] = useState<'market' | 'mine'>('market');

  // 搜索
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<string>('');
  const [imageSearchUrl, setImageSearchUrl] = useState('');
  const [imageSearchVisible, setImageSearchVisible] = useState(false);
  const [imgSimScores, setImgSimScores] = useState<Record<string, number>>({});

  // 编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [editingListing, setEditingListing] = useState<MoldListing | null>(null);
  const [editMode, setEditMode] = useState<'rent' | 'sell'>('rent');
  const [editRentPrice, setEditRentPrice] = useState<number>(0);
  const [editSellPrice, setEditSellPrice] = useState<number>(0);
  const [editRemark, setEditRemark] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const editImgInputRef = useRef<HTMLInputElement>(null);
  const editDragItemRef = useRef<number | null>(null);
  const [editDragOverIdx, setEditDragOverIdx] = useState<number | null>(null);

  const openEditListing = (listing: MoldListing) => {
    setEditingListing(listing);
    setEditMode(listing.mode);
    setEditRentPrice(listing.rentPrice || 0);
    setEditSellPrice(listing.sellPrice || 0);
    setEditRemark(listing.remark || '');
    setEditTitle(listing.title || '');
    setEditImages([...listing.images]);
    setEditVisible(true);
  };

  const handleSaveEdit = () => {
    if (!editingListing) return;
    if (!editTitle.trim()) { message.warning('请填写标题'); return; }
    if (!editImages || editImages.length === 0) { message.warning('请至少保留一张展示图片：模具无图片不能发布'); return; }
    if (editMode === 'rent' && !editRentPrice) { message.warning('请填写每天租金'); return; }
    if (editMode === 'sell' && !editSellPrice) { message.warning('请填写出售价格'); return; }
    const updated: MoldListing = {
      ...editingListing,
      mode: editMode,
      title: editTitle.trim(),
      rentPrice: editMode === 'rent' ? editRentPrice : undefined,
      sellPrice: editMode === 'sell' ? editSellPrice : undefined,
      remark: editRemark,
      images: editImages,
    };
    // 清理旧图片键
    for (let i = 0; i < 20; i++) {
      try { localStorage.removeItem(IMG_KEY(editingListing.key, i)); } catch { /* ignore */ }
    }
    // 重新从 localStorage 读取，避免陈旧 state 覆盖其他数据
    let currentListings: MoldListing[] = [];
    try { currentListings = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { /* ignore */ }
    const slimUpdated = extractImagesToKeys(updated);
    const next = currentListings.map(l => l.key === slimUpdated.key ? slimUpdated : l);
    const json = JSON.stringify(next);
    if (!safeSetItem(STORAGE_KEY(), json)) { message.error('存储空间不足，保存失败'); return; }
    flushDatasetUpload(STORAGE_KEY(), json);
    setListings(next.map(resolveImageKeys));
    message.success('已更新');
    setEditVisible(false);
  };

  const handleEditImageFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files) as File[];
    const newImgs: string[] = [];
    for (const f of arr) {
      try { const url = await compressImageFile(f); newImgs.push(url); } catch { /* skip */ }
    }
    if (newImgs.length) setEditImages(prev => [...prev, ...newImgs]);
  };

  const handleEditPasteImage = async () => {
    try {
      const items: any[] = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = (it.types || []).find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const url = await compressImageFile(blob);
          setEditImages(prev => [...prev, url]);
          message.success('已粘贴剪切板图片');
          return;
        }
      }
      message.warning('剪切板中未找到图片');
    } catch { message.warning('读取剪切板失败'); }
  };

  // 购物车
  const cartKey = CART_KEY();
  const [cart, setCart] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(cartKey) || '[]'); } catch { return []; }
  });

  // 加载模具列表
  const [molds, setMolds] = useState<MoldRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(`molds_${owner}`) || '[]'); } catch { return []; }
  });

  // 监听同步更新事件，确保跨浏览器数据实时刷新
  useEffect(() => {
    const handler = () => {
      try { setMolds(JSON.parse(localStorage.getItem(`molds_${owner}`) || '[]')); } catch { /* ignore */ }
      try {
        const raw: MoldListing[] = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]');
        setListings(raw.map(resolveImageKeys));
      } catch { /* ignore */ }
    };
    window.addEventListener('sync-data-updated', handler);
    return () => window.removeEventListener('sync-data-updated', handler);
  }, [owner]);

  // 每次打开弹窗时重新加载
  useEffect(() => {
    if (pickerVisible) {
      try { setMolds(JSON.parse(localStorage.getItem(`molds_${owner}`) || '[]')); } catch { /* ignore */ }
    }
  }, [pickerVisible, owner]);

  const filteredMolds = useMemo(() => {
    if (!pickerSearch.trim()) return molds;
    const q = pickerSearch.trim().toLowerCase();
    return molds.filter(r =>
      (r.moldCode || '').toLowerCase().includes(q) ||
      (r.moldName || '').toLowerCase().includes(q) ||
      (r.spec || '').toLowerCase().includes(q)
    );
  }, [molds, pickerSearch]);

  // 已发布的模具key集合
  const publishedMoldKeys = useMemo(() => new Set(listings.map(l => l.moldKey)), [listings]);

  // ============ 图片处理 ============
  const handleImageFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files) as File[];
    const newImgs: string[] = [];
    for (const f of arr) {
      try { const url = await compressImageFile(f); newImgs.push(url); } catch { /* skip */ }
    }
    if (newImgs.length) setListingImages(prev => [...prev, ...newImgs]);
  };

  const pasteImage = async () => {
    try {
      const items: any[] = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = (it.types || []).find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const url = await compressImageFile(blob);
          setListingImages(prev => [...prev, url]);
          message.success('已粘贴剪切板图片');
          return;
        }
      }
      message.warning('剪切板中未找到图片');
    } catch {
      message.warning('读取剪切板失败');
    }
  };

  // ============ 发布流程 ============
  const handleSelectMold = (mold: MoldRecord) => {
    setSelectedMold(mold);
    setPickerVisible(false);
    // 打开模式选择弹窗
    setMode('rent');
    setRentPrice(0);
    setSellPrice(0);
    setListingRemark('');
    // 标题默认取模具名称（不拼规格，规格不再进入标题）；发布时必填校验
    setListingTitle(mold.moldName || '');
    // 自动获取模具已有的图片
    setListingImages(mold.images && mold.images.length > 0 ? [...mold.images] : []);
    setModeVisible(true);
  };

  const handlePublish = () => {
    if (!selectedMold) return;
    if (!listingTitle.trim()) { message.warning('请填写标题'); return; }
    if (!listingImages || listingImages.length === 0) { message.warning('请至少上传一张展示图片：模具无图片不能发布'); return; }
    if (mode === 'rent' && !rentPrice) { message.warning('请填写每天租金'); return; }
    if (mode === 'sell' && !sellPrice) { message.warning('请填写出售价格'); return; }

    const newListing: MoldListing = {
      key: `ML-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      id: nextMoldId(listings),
      moldKey: selectedMold.key,
      moldCode: selectedMold.moldCode,
      moldName: selectedMold.moldName,
      spec: selectedMold.spec,
      title: listingTitle.trim(),
      mode,
      rentPrice: mode === 'rent' ? rentPrice : undefined,
      sellPrice: mode === 'sell' ? sellPrice : undefined,
      images: listingImages,
      publisher: username,
      publisherCompany: companyName,
      createdAt: new Date().toISOString().slice(0, 10),
      remark: listingRemark,
      specs: selectedMold.specs,
      totalQuantity: selectedMold.totalQuantity ?? (selectedMold.specs ? selectedMold.specs.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0) : undefined),
    };

    // 将图片写入独立存储键，listing JSON 只保留键引用（避免列表过大擑爆配额）
    const slimListing = extractImagesToKeys(newListing);

    // 重新从 localStorage 读取，避免陈旧 state 覆盖其他浏览器写入的新数据
    let currentListings: MoldListing[] = [];
    try { currentListings = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { /* ignore */ }
    const next = [slimListing, ...currentListings];
    const json = JSON.stringify(next);
    if (!safeSetItem(STORAGE_KEY(), json)) {
      message.error('存储空间不足，发布失败');
      return;
    }
    // 写后回读验证
    try {
      const verify = localStorage.getItem(STORAGE_KEY());
      if (verify !== json) {
        message.error('数据写入异常，请重试');
        return;
      }
    } catch { /* ignore */ }
    // 立即上传到服务端（不使用防抖），确保刷新前数据已同步
    flushDatasetUpload(STORAGE_KEY(), json);
    // 显示时解析图片键回实际数据
    setListings(next.map(resolveImageKeys));
    message.success(mode === 'rent' ? '模具出租信息已发布' : '模具出售信息已发布');
    setModeVisible(false);
    setSelectedMold(null);
  };

  const handleDelete = (key: string) => {
    // 清理该 listing 的图片存储键
    for (let i = 0; i < 20; i++) {
      try { localStorage.removeItem(IMG_KEY(key, i)); } catch { /* ignore */ }
    }
    // 重新从 localStorage 读取，避免陈旧 state 覆盖其他数据
    let currentListings: MoldListing[] = [];
    try { currentListings = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { /* ignore */ }
    const next = currentListings.filter(l => l.key !== key);
    const json = JSON.stringify(next);
    setListings(next.map(resolveImageKeys));
    safeSetItem(STORAGE_KEY(), json);
    flushDatasetUpload(STORAGE_KEY(), json);
    message.success('已删除');
  };

  const handleAddToCart = (key: string) => {
    if (cart.includes(key)) { message.info('已在购物车中'); return; }
    const next = [...cart, key];
    setCart(next);
    safeSetItem(cartKey, JSON.stringify(next));
    message.success('已加入购物车');
  };

  // 标记/取消成交：成交后模具管理列表按类型显示已出租/已出售
  const handleToggleDeal = (key: string) => {
    let currentListings: MoldListing[] = [];
    try { currentListings = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { /* ignore */ }
    const next = currentListings.map(l => l.key === key ? { ...l, dealt: !l.dealt } : l);
    const json = JSON.stringify(next);
    setListings(next.map(resolveImageKeys));
    safeSetItem(STORAGE_KEY(), json);
    flushDatasetUpload(STORAGE_KEY(), json);
    const target = next.find(l => l.key === key);
    message.success(target?.dealt ? `已标记成交（${target.mode === 'rent' ? '已出租' : '已出售'}）` : '已取消成交标记');
  };

  // 我的模具列表
  const myListings = useMemo(() => listings.filter(l => l.publisher === username), [listings, username]);

  // 图片搜索：当参考图片变化时异步计算相似度
  useEffect(() => {
    if (!imageSearchUrl) { setImgSimScores({}); return; }
    let cancelled = false;
    (async () => {
      const refFeat = await computeSubjectFeatures(imageSearchUrl);
      if (cancelled || refFeat.hist.length === 0) return;
      const scores: Record<string, number> = {};
      for (const item of listings) {
        if (cancelled) break;
        const src = item.images && item.images.length > 0 ? item.images[0] : '';
        if (!src) { scores[item.key] = 0; continue; }
        const feat = await computeSubjectFeatures(src);
        scores[item.key] = feat.hist.length === 0 ? 0 : subjectSimilarity(refFeat, feat);
      }
      if (!cancelled) setImgSimScores(scores);
    })();
    return () => { cancelled = true; };
  }, [imageSearchUrl, listings]);

  // 图片搜索弹窗打开时，监听全局粘贴事件，支持直接 Ctrl+V 粘贴
  useEffect(() => {
    if (!imageSearchVisible) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => { setImageSearchUrl(ev.target?.result as string); setImageSearchVisible(false); message.success('已加载粘贴图片'); };
            reader.readAsDataURL(file);
          }
          return;
        }
      }
      message.warning('剪切板中没有图片');
    };
    document.addEventListener('paste', handlePaste);
    return () => { document.removeEventListener('paste', handlePaste); };
  }, [imageSearchVisible]);

  // 从剪切板读取图片（供粘贴按钮调用）
  const handlePasteFromClipboard = async () => {
    try {
      const items = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = it.types.find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const reader = new FileReader();
          reader.onload = (ev) => { setImageSearchUrl(ev.target?.result as string); setImageSearchVisible(false); message.success('已加载粘贴图片'); };
          reader.readAsDataURL(blob);
          return;
        }
      }
      message.warning('剪切板中没有图片');
    } catch {
      message.warning('无法读取剪切板，请检查浏览器权限');
    }
  };

  // 搜索过滤 + 图片相似度排序
  const displayListings = useMemo(() => {
    let list = subView === 'mine' ? myListings : listings;
    // 类型筛选
    if (modeFilter) {
      list = list.filter(l => l.mode === modeFilter);
    }
    // 标题搜索
    if (appliedSearch) {
      const kw = appliedSearch.toLowerCase();
      list = list.filter(l =>
        (l.title || '').toLowerCase().includes(kw) ||
        (l.moldCode || '').toLowerCase().includes(kw) ||
        (l.moldName || '').toLowerCase().includes(kw) ||
        (l.spec || '').toLowerCase().includes(kw)
      );
    }
    // 图片搜索排序（得分高的排前面）
    if (imageSearchUrl && Object.keys(imgSimScores).length > 0) {
      list = [...list].sort((a, b) => (imgSimScores[b.key] || 0) - (imgSimScores[a.key] || 0));
    }
    return list;
  }, [subView, myListings, listings, appliedSearch, modeFilter, imageSearchUrl, imgSimScores]);

  // ============ 表格列（我的模具） ============
  const mineCols = [
    {
      title: '图片', dataIndex: 'images', key: 'images', width: 80, align: 'center' as const,
      render: (imgs: string[]) => imgs && imgs.length > 0
        ? <Image src={imgs[0]} width={50} height={50} style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} />
        : <span style={{ color: '#ccc' }}>无图</span>,
    },
    { title: '模具编号', dataIndex: 'moldCode', key: 'moldCode', width: 140, align: 'center' as const,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 600, color: PRIMARY }}>{v}</span> },
    { title: '模具名称', dataIndex: 'moldName', key: 'moldName', width: 140, align: 'center' as const },
    { title: '规格型号', dataIndex: 'spec', key: 'spec', width: 100, align: 'center' as const, render: (v: string) => v || '—' },
    {
      title: '类型', dataIndex: 'mode', key: 'mode', width: 80, align: 'center' as const,
      render: (v: string) => v === 'rent'
        ? <Tag style={{ background: '#1677ff', color: '#fff', border: 'none' }}>出租</Tag>
        : <Tag style={{ background: '#52c41a', color: '#fff', border: 'none' }}>出售</Tag>,
    },
    {
      title: '价格', key: 'price', width: 130, align: 'center' as const,
      render: (_: any, r: MoldListing) => r.mode === 'rent'
        ? <span style={{ color: '#1677ff', fontWeight: 600 }}>¥{r.rentPrice}/天</span>
        : <span style={{ color: '#52c41a', fontWeight: 600 }}>¥{r.sellPrice}</span>,
    },
    { title: '发布时间', dataIndex: 'createdAt', key: 'createdAt', width: 110, align: 'center' as const },
    {
      title: '操作', key: 'action', width: 220, align: 'center' as const,
      render: (_: any, r: MoldListing) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditListing(r)}>编辑</Button>
          <Button type="link" size="small" onClick={() => handleToggleDeal(r.key)}>{r.dealt ? '取消成交' : '标记成交'}</Button>
          <Button type="link" size="small" danger onClick={() => handleDelete(r.key)}>下架</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {subView === 'market' ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setPickerSearch(''); setPickerVisible(true); }}>添加模具</Button>
        ) : (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setPickerSearch(''); setPickerVisible(true); }}>发布模具</Button>
        )}
        <Button
          type={subView === 'mine' ? 'primary' : 'default'}
          ghost={subView === 'mine'}
          onClick={() => setSubView(subView === 'mine' ? 'market' : 'mine')}>
          {subView === 'mine' ? '← 返回市场' : '我的模具'}
        </Button>
        <span style={{ fontSize: 12, color: '#999' }}>
          {subView === 'mine' ? `我的发布 ${myListings.length} 条` : `共 ${listings.length} 条模具租/售信息 · 购物车 ${cart.length} 件`}
        </span>
      </div>

      {/* 搜索栏 */}
      {subView === 'market' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            placeholder="搜索标题/编号/名称/规格"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined style={{ color: '#999' }} />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onPressEnter={() => setAppliedSearch(searchInput)}
          />
          <Select
            placeholder="类型"
            allowClear
            style={{ width: 110 }}
            value={modeFilter || undefined}
            onChange={v => setModeFilter(v || '')}
            options={[
              { value: '', label: '全部' },
              { value: 'rent', label: '出租' },
              { value: 'sell', label: '出售' },
            ]}
          />
          <Popover
            trigger="hover"
            placement="bottomLeft"
            open={imageSearchVisible}
            onOpenChange={setImageSearchVisible}
            content={
              <div>
                <div
                  tabIndex={0}
                  style={{ width: 260, minHeight: 160, border: '2px dashed #d9d9d9', borderRadius: 8, padding: 12, textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (let i = 0; i < items.length; i++) {
                      if (items[i].type.startsWith('image/')) {
                        const file = items[i].getAsFile();
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => { setImageSearchUrl(ev.target?.result as string); setImageSearchVisible(false); message.success('已加载粘贴图片'); };
                          reader.readAsDataURL(file);
                        }
                        return;
                      }
                    }
                    message.warning('剪切板中没有图片');
                  }}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'image/*';
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => { setImageSearchUrl(ev.target?.result as string); setImageSearchVisible(false); message.success(`已加载图片：${file.name}`); };
                        reader.readAsDataURL(file);
                      }
                    };
                    input.click();
                  }}
                >
                  {imageSearchUrl ? (
                    <div>
                      <Image src={imageSearchUrl} width={200} height={140} style={{ objectFit: 'contain' }} preview={false} />
                      <div style={{ marginTop: 8, fontSize: 12, color: '#52c41a' }}>✓ 已加载参考图片</div>
                    </div>
                  ) : (
                    <div>
                      <CameraOutlined style={{ fontSize: 36, color: '#bbb', marginBottom: 8 }} />
                      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>点击选择图片 或 Ctrl+V 粘贴图片</div>
                      <div style={{ fontSize: 12, color: '#999' }}>支持 JPG / PNG / WebP，上传后自动识别相似模具</div>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 8, textAlign: 'center' }}>
                  <Button size="small" icon={<SnippetsOutlined />} onClick={(e) => { e.stopPropagation(); handlePasteFromClipboard(); }}>粘贴</Button>
                </div>
              </div>
            }
          >
            <Button icon={<CameraOutlined />} style={{ borderColor: imageSearchUrl ? '#1890ff' : undefined, color: imageSearchUrl ? '#1890ff' : undefined }}>
              {imageSearchUrl ? '已选图片' : '图片搜索'}
            </Button>
          </Popover>
          {imageSearchUrl && (
            <Tooltip title="清除参考图片">
              <Button type="text" icon={<CloseOutlined />} size="small" onClick={() => setImageSearchUrl('')} />
            </Tooltip>
          )}
          <Button type="primary" icon={<SearchOutlined />} onClick={() => setAppliedSearch(searchInput)}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setSearchInput(''); setAppliedSearch(''); setModeFilter(''); setImageSearchUrl(''); }}>重置</Button>
        </div>
      )}

      {/* 图片搜索参考区 */}
      {subView === 'market' && imageSearchUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 8, border: '1px solid #91d5ff' }}>
          <Image src={imageSearchUrl} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
          <span style={{ fontSize: 13, color: '#1890ff' }}>图片搜索已启用，结果按相似度排序</span>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setImageSearchUrl('')} />
        </div>
      )}

      {/* 市场视图 - 卡片网格 */}
      {subView === 'market' && (
        displayListings.length === 0 ? <Empty description={'暂无模具租/售信息，请点击添加模具发布'} /> : (
          <>
            <Row gutter={[12, 12]}>
              {displayListings.map(r => (
                <Col xs={12} sm={8} md={6} lg={5} xl={4} key={r.key}>
                  <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.3s', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(30,74,126,0.15)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
                  >
                    {/* 图片区 */}
                    <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#f5f5f5', position: 'relative', overflow: 'hidden' }}
                      onClick={() => { setDetailRecord(r); setDetailVisible(true); }}>
                      {r.images && r.images.length > 0
                        ? <Image src={r.images[0]} width={'100%'} height={'100%'} style={{ objectFit: 'cover', width: '100%', height: '100%' }} preview={false} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ToolOutlined style={{ fontSize: 48, color: '#d9d9d9' }} /></div>}
                      {/* 类型角标 */}
                      {r.mode === 'rent'
                        ? <div style={{ position: 'absolute', top: 8, left: 8, background: 'linear-gradient(135deg, #1677ff, #0958d9)', color: '#fff', fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 600 }}>出租</div>
                        : <div style={{ position: 'absolute', top: 8, left: 8, background: 'linear-gradient(135deg, #52c41a, #389e0d)', color: '#fff', fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 600 }}>出售</div>}
                      {/* 图片搜索相似度角标 */}
                      {imageSearchUrl && imgSimScores[r.key] !== undefined && (
                        <div style={{ position: 'absolute', top: 8, right: 8, background: imgSimScores[r.key] > 0.65 ? '#52c41a' : imgSimScores[r.key] > 0.45 ? '#faad14' : '#999', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                          {Math.round(imgSimScores[r.key] * 100)}% 相似
                        </div>
                      )}
                    </div>
                    {/* 信息区 */}
                    <div style={{ padding: '10px 12px 8px' }}>
                      <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                        货品ID: <span style={{ color: '#333', fontWeight: 500 }}>{r.id || '—'}</span>
                      </div>
                      {/* 标题 */}
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#222', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                        onClick={() => { setDetailRecord(r); setDetailVisible(true); }}
                        title={r.title || r.moldName}>
                        {r.title || r.moldName || '—'}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Tag color="blue" style={{ fontSize: 10, marginRight: 4, padding: '0 4px' }}>{r.moldCode}</Tag>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                        {r.mode === 'rent' ? (
                          <><span style={{ color: '#1677ff', fontSize: 11 }}>日租金</span><span style={{ color: '#1677ff', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>¥{r.rentPrice}</span><span style={{ color: '#999', fontSize: 12, marginLeft: 2 }}>/天</span></>
                        ) : (
                          <><span style={{ color: '#52c41a', fontSize: 11 }}>售价</span><span style={{ color: '#52c41a', fontSize: 20, fontWeight: 700, lineHeight: 1 }}>¥{r.sellPrice}</span></>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {resolveCompany(r.publisher) || r.publisherCompany || r.publisher}
                      </div>
                    </div>
                    {/* 底部操作区 */}
                    <div style={{ borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center' }}>
                      <div onClick={() => { setDetailRecord(r); setDetailVisible(true); }}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1890ff', fontSize: 12, transition: 'color 0.2s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#40a9ff')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#1890ff')}>
                        <EyeOutlined style={{ fontSize: 14 }} /><span>详情</span>
                      </div>
                      <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                      <div onClick={() => handleAddToCart(r.key)}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: cart.includes(r.key) ? '#fa8c16' : '#999', fontSize: 12, transition: 'color 0.2s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#fa8c16')}
                        onMouseLeave={e => (e.currentTarget.style.color = cart.includes(r.key) ? '#fa8c16' : '#999')}>
                        <ShoppingCartOutlined style={{ fontSize: 14 }} /><span>购物车</span>
                      </div>
                      {r.publisher !== getDataOwner() && (
                        <>
                          <div style={{ width: 1, height: 20, background: '#f0f0f0' }} />
                          <div onClick={(e) => { e.stopPropagation(); openChat(r.publisher, r.title || r.moldName || ''); }}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', cursor: 'pointer', color: '#1677ff', fontSize: 12, transition: 'color 0.2s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#4096ff')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#1677ff')}>
                            <MessageOutlined style={{ fontSize: 14 }} /><span>联系</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <Pagination total={displayListings.length} pageSize={20} showTotal={t => `共 ${t} 条`} />
            </div>
          </>
        )
      )}

      {/* 我的模具视图 - 表格 */}
      {subView === 'mine' && (
        <Table
          rowKey="key"
          bordered
          size="small"
          columns={mineCols}
          dataSource={myListings}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description={'您还没有发布任何模具'} /> }}
        />
      )}

      {/* ========== 选择模具弹窗 ========== */}
      <Modal
        title={<span style={{ color: PRIMARY }}><ToolOutlined style={{ marginRight: 8 }} />选择模具</span>}
        open={pickerVisible}
        onCancel={() => setPickerVisible(false)}
        footer={null}
        width={640}
        destroyOnClose
      >
        <Input placeholder="搜索模具编号/名称/规格" prefix={<ToolOutlined />} style={{ marginBottom: 10 }}
          value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} allowClear autoFocus />
        <Table
          rowKey="key"
          size="small"
          bordered
          columns={[
            { title: '图片', dataIndex: 'images', key: 'images', width: 60, align: 'center',
              render: (imgs: string[] | undefined) => imgs && imgs.length > 0
                ? <Image src={imgs[0]} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} />
                : <span style={{ color: '#ccc', fontSize: 11 }}>无图</span> },
            { title: '模具编号', dataIndex: 'moldCode', key: 'moldCode', width: 140,
              render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 600, color: PRIMARY }}>{v}</span> },
            { title: '模具名称', dataIndex: 'moldName', key: 'moldName', width: 140 },
            { title: '规格型号', dataIndex: 'spec', key: 'spec', width: 100, render: (v: string) => v || '—' },
            { title: '状态', key: 'publishStatus', width: 80, align: 'center',
              render: (_: any, r: MoldRecord) => {
                const isPublished = publishedMoldKeys.has(r.key);
                if (isPublished) return <Tag style={{ background: '#1677ff', color: '#fff', border: 'none' }}>已发布</Tag>;
                const colors: Record<string, string> = { '在用': 'green', '停用': 'orange', '报废': 'red' };
                return <Tag color={colors[r.status] || 'default'}>{r.status || '—'}</Tag>;
              } },
          ]}
          dataSource={filteredMolds}
          pagination={filteredMolds.length > 8 ? { pageSize: 8, showTotal: t => `共 ${t} 个` } : false}
          locale={{ emptyText: <Empty description="暂无模具，请先在模具管理中添加" /> }}
          onRow={(record) => {
            const isPublished = publishedMoldKeys.has(record.key);
            return {
              onClick: () => { if (!isPublished) handleSelectMold(record); },
              style: { cursor: isPublished ? 'not-allowed' : 'pointer', opacity: isPublished ? 0.6 : 1 },
            };
          }}
        />
      </Modal>

      {/* ========== 模式选择与填写弹窗 ========== */}
      <Modal
        title={<span><ToolOutlined style={{ marginRight: 8 }} />发布模具租/售</span>}
        open={modeVisible}
        onCancel={() => setModeVisible(false)}
        onOk={handlePublish}
        okText="发布"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        {selectedMold && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f6f8fa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
            <Space>
              {selectedMold.images && selectedMold.images.length > 0 && (
                <Image src={selectedMold.images[0]} width={45} height={45} style={{ objectFit: 'cover', borderRadius: 4 }} />
              )}
              <div>
                <div style={{ fontWeight: 600 }}>{selectedMold.moldCode} - {selectedMold.moldName}</div>
                <div style={{ fontSize: 12, color: '#999' }}>规格：{selectedMold.spec || '—'} · 状态：{selectedMold.status}</div>
              </div>
            </Space>
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8, fontWeight: 500 }}>发布方式：</span>
          <Radio.Group value={mode} onChange={e => setMode(e.target.value)}>
            <Radio.Button value="rent">出租</Radio.Button>
            <Radio.Button value="sell">出售</Radio.Button>
          </Radio.Group>
        </div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8, fontWeight: 500 }}><span style={{ color: '#ff4d4f' }}>*</span> 标题：</span>
          <Input style={{ width: 300 }} placeholder="请输入标题（必填）" value={listingTitle} onChange={e => setListingTitle(e.target.value)} maxLength={50} showCount />
        </div>
        {mode === 'rent' ? (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>每天租金（元）：</span>
            <InputNumber min={0} precision={2} style={{ width: 160 }} value={rentPrice} onChange={v => setRentPrice(Number(v) || 0)} placeholder="请输入日租金" />
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>出售价格（元）：</span>
            <InputNumber min={0} precision={2} style={{ width: 160 }} value={sellPrice} onChange={v => setSellPrice(Number(v) || 0)} placeholder="请输入出售价格" />
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <Input.TextArea rows={2} placeholder="备注说明（选填）" value={listingRemark} onChange={e => setListingRemark(e.target.value)} />
        </div>
        {/* 图片上传 */}
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500 }}><span style={{ color: '#ff4d4f' }}>*</span> 展示图片 <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>（必填：无图片不能发布，拖动可调整顺序）</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px dashed #d9d9d9', borderRadius: 8, background: '#fafafa', minHeight: 80, alignItems: 'flex-start' }}>
          {listingImages.map((img, idx) => (
            <div key={idx}
              draggable
              onDragStart={(e) => { dragItemRef.current = idx; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.style.opacity = '0.5'; }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx); }}
              onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; dragItemRef.current = null; setDragOverIdx(null); }}
              onDrop={() => {
                if (dragItemRef.current === null || dragItemRef.current === idx) { setDragOverIdx(null); return; }
                setListingImages(prev => {
                  const next = [...prev];
                  const [moved] = next.splice(dragItemRef.current!, 1);
                  next.splice(idx, 0, moved);
                  return next;
                });
                dragItemRef.current = null;
                setDragOverIdx(null);
              }}
              style={{ position: 'relative', width: 68, height: 68, cursor: 'grab', border: dragOverIdx === idx ? '2px solid #1677ff' : '2px solid transparent', borderRadius: 8, transition: 'border-color 0.2s' }}>
              <Image src={img} width={68} height={68} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} preview={false} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)', width: 20, height: 20, padding: 0 }}
                onClick={() => setListingImages(prev => prev.filter((_, i) => i !== idx))} />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            <Button icon={<PictureOutlined />} onClick={() => imgInputRef.current?.click()}>上传图片</Button>
            <Button icon={<SnippetsOutlined />} onClick={pasteImage}>粘贴</Button>
          </div>
          <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) { handleImageFiles(e.target.files); e.target.value = ''; } }} />
        </div>
      </Modal>

      {/* ========== 详情弹窗 ========== */}
      <Modal
        title="模具详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={
          detailRecord ? (
            <Space>
              <Button onClick={() => setDetailVisible(false)}>关闭</Button>
              <Button type="primary" icon={<ShoppingCartOutlined />}
                style={cart.includes(detailRecord.key) ? { background: '#fa8c16', borderColor: '#fa8c16', color: '#fff' } : {}}
                onClick={() => handleAddToCart(detailRecord.key)}>
                {cart.includes(detailRecord.key) ? '已在购物车' : '加入购物车'}
              </Button>
            </Space>
          ) : null
        }
        width={640}
        destroyOnClose
      >
        {detailRecord && (
          <div>
            {/* 产品链接 */}
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '8px 12px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#333', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {`${window.location.origin}/market/opportunity?tab=mold-market&productId=${detailRecord.id}`}
              </span>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  const link = `${window.location.origin}/market/opportunity?tab=mold-market&productId=${detailRecord.id}`;
                  navigator.clipboard.writeText(link).then(() => message.success('链接已复制'));
                }}
              >
                复制链接
              </Button>
            </div>
            {/* 图片展示 */}
            {detailRecord.images.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Image.PreviewGroup>
                  <Row gutter={[8, 8]}>
                    {detailRecord.images.map((img, idx) => (
                      <Col key={idx}>
                        <Image src={img} width={140} height={140} style={{ objectFit: 'cover', borderRadius: 8 }} />
                      </Col>
                    ))}
                  </Row>
                </Image.PreviewGroup>
              </div>
            )}
            {/* 详情信息 */}
            <Row gutter={[16, 12]}>
              <Col span={12}><span style={{ color: '#999' }}>模具编号：</span><strong>{detailRecord.moldCode}</strong></Col>
              <Col span={12}><span style={{ color: '#999' }}>模具名称：</span><span>{detailRecord.moldName}</span></Col>
              <Col span={12}><span style={{ color: '#999' }}>规格型号：</span><span>{detailRecord.spec || '—'}</span></Col>
              <Col span={12}>
                <span style={{ color: '#999' }}>类型：</span>
                {detailRecord.mode === 'rent'
                  ? <Tag style={{ background: '#1677ff', color: '#fff', border: 'none' }}>出租</Tag>
                  : <Tag style={{ background: '#52c41a', color: '#fff', border: 'none' }}>出售</Tag>}
              </Col>
              <Col span={12}>
                <span style={{ color: '#999' }}>价格：</span>
                {detailRecord.mode === 'rent'
                  ? <strong style={{ color: '#1677ff', fontSize: 16 }}>¥{detailRecord.rentPrice}/天</strong>
                  : <strong style={{ color: '#52c41a', fontSize: 16 }}>¥{detailRecord.sellPrice}</strong>}
              </Col>
              {/* 规格与数量明细 */}
              {detailRecord.specs && detailRecord.specs.length > 0 && detailRecord.specs.some((s: any) => s.specName) && (
                <Col span={24}>
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>规格明细与数量：</div>
                    <Table
                      size="small"
                      bordered
                      pagination={false}
                      rowKey={(s: any, idx?: number) => `${s.specName}-${idx}`}
                      dataSource={detailRecord.specs.filter((s: any) => s.specName)}
                      columns={[
                        { title: '规格型号', dataIndex: 'specName', key: 'specName', align: 'center' as const },
                        { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 120, align: 'center' as const, render: (v: number) => <span style={{ color: PRIMARY, fontWeight: 500 }}>× {v}</span> },
                      ]}
                      summary={() => (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0}><div style={{ textAlign: 'right' }}>模具数量总计：</div></Table.Summary.Cell>
                          <Table.Summary.Cell index={1}><strong style={{ color: PRIMARY, fontSize: 15 }}>{detailRecord.totalQuantity ?? (detailRecord.specs || []).reduce((sum: number, s: any) => sum + (Number(s.quantity) || 0), 0)}</strong></Table.Summary.Cell>
                        </Table.Summary.Row>
                      )}
                    />
                  </div>
                </Col>
              )}
              <Col span={12}>
                <span style={{ color: '#999' }}>发布人：</span><span>{resolveCompany(detailRecord.publisher) || detailRecord.publisherCompany || detailRecord.publisher}</span>
                {detailRecord.publisher !== getDataOwner() && (
                  <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => { setDetailVisible(false); openChat(detailRecord.publisher, detailRecord.title || detailRecord.moldName || ''); }} style={{ marginLeft: 8 }}>立即联系</Button>
                )}
              </Col>
              <Col span={12}><span style={{ color: '#999' }}>发布时间：</span><span>{detailRecord.createdAt}</span></Col>
              {detailRecord.remark && <Col span={24}><span style={{ color: '#999' }}>备注：</span><span>{detailRecord.remark}</span></Col>}
            </Row>
          </div>
        )}
      </Modal>

      {/* ========== 编辑弹窗 ========== */}
      <Modal
        title="编辑模具租/售"
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={handleSaveEdit}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        {editingListing && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f6f8fa', borderRadius: 8, border: '1px solid #e8e8e8' }}>
            <strong>{editingListing.moldCode} - {editingListing.moldName}</strong>
            <span style={{ marginLeft: 12, fontSize: 12, color: '#999' }}>规格：{editingListing.spec || '—'}</span>
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8, fontWeight: 500 }}>发布方式：</span>
          <Radio.Group value={editMode} onChange={e => setEditMode(e.target.value)}>
            <Radio.Button value="rent">出租</Radio.Button>
            <Radio.Button value="sell">出售</Radio.Button>
          </Radio.Group>
        </div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8, fontWeight: 500 }}><span style={{ color: '#ff4d4f' }}>*</span> 标题：</span>
          <Input style={{ width: 300 }} placeholder="请输入标题（必填）" value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={50} showCount />
        </div>
        {editMode === 'rent' ? (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>每天租金（元）：</span>
            <InputNumber min={0} precision={2} style={{ width: 160 }} value={editRentPrice} onChange={v => setEditRentPrice(Number(v) || 0)} />
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>出售价格（元）：</span>
            <InputNumber min={0} precision={2} style={{ width: 160 }} value={editSellPrice} onChange={v => setEditSellPrice(Number(v) || 0)} />
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <Input.TextArea rows={2} placeholder="备注说明（选填）" value={editRemark} onChange={e => setEditRemark(e.target.value)} />
        </div>
        {/* 图片编辑 */}
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500 }}><span style={{ color: '#ff4d4f' }}>*</span> 展示图片 <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>（必填：无图片不能发布，拖动可调整顺序）</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px dashed #d9d9d9', borderRadius: 8, background: '#fafafa', minHeight: 80, alignItems: 'flex-start' }}>
          {editImages.map((img, idx) => (
            <div key={idx}
              draggable
              onDragStart={(e) => { editDragItemRef.current = idx; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.style.opacity = '0.5'; }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setEditDragOverIdx(idx); }}
              onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; editDragItemRef.current = null; setEditDragOverIdx(null); }}
              onDrop={() => {
                if (editDragItemRef.current === null || editDragItemRef.current === idx) { setEditDragOverIdx(null); return; }
                setEditImages(prev => {
                  const next = [...prev];
                  const [moved] = next.splice(editDragItemRef.current!, 1);
                  next.splice(idx, 0, moved);
                  return next;
                });
                editDragItemRef.current = null;
                setEditDragOverIdx(null);
              }}
              style={{ position: 'relative', width: 68, height: 68, cursor: 'grab', border: editDragOverIdx === idx ? '2px solid #1677ff' : '2px solid transparent', borderRadius: 8, transition: 'border-color 0.2s' }}>
              <Image src={img} width={68} height={68} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} preview={false} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)', width: 20, height: 20, padding: 0 }}
                onClick={() => setEditImages(prev => prev.filter((_, i) => i !== idx))} />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            <Button icon={<PictureOutlined />} onClick={() => editImgInputRef.current?.click()}>上传图片</Button>
            <Button icon={<SnippetsOutlined />} onClick={handleEditPasteImage}>粘贴</Button>
          </div>
          <input ref={editImgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) { handleEditImageFiles(e.target.files); e.target.value = ''; } }} />
        </div>
      </Modal>
    </>
  );
};

export default MoldMarketTab;
