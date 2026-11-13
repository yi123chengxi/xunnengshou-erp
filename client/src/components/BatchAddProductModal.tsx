import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal, Button, Input, InputNumber, message, Checkbox, Divider, AutoComplete, Table, Empty, Upload, Space, Select,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, PictureOutlined, SaveOutlined, CameraOutlined, CopyOutlined, UploadOutlined,
} from '@ant-design/icons';
import { saveDataset } from '../utils/dataStore';
import { safeSetItem } from '../utils/storageQuota';
import { saveFullImage } from '../utils/imageStore';
import { readScopedItem, writeScopedItem } from '../utils/scopedStorage';
import MoldPickerModal from './MoldPickerModal';

const PRIMARY = '#1e4a7e';

// 获取数据所有者（与主页面口径一致）
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// 条形码前缀基数：69 + 订单号前缀(4位) + 0000000
const getBarcodeBase = (): number => {
  let prefix = '0000';
  try {
    const username = localStorage.getItem('username');
    if (username) {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const user = users.find((u: any) => u.username === username);
      if (user?.orderPrefix) {
        const digits = String(user.orderPrefix).replace(/\D/g, '');
        if (digits) prefix = digits.padEnd(4, '0').slice(0, 4);
      }
    }
  } catch { /* ignore */ }
  return 6900000000000 + parseInt(prefix) * 10000000;
};

export interface BatchAddProductModalProps {
  open: boolean;
  onClose: () => void;
  /** 创建记录的产品种类 */
  productType?: '成品' | '半成品' | '原材料';
  /** 层级默认值（如原材料默认 99） */
  defaultLevel?: string;
  zIndex?: number;
  /** 创建成功回调（返回新记录数组） */
  onCreated?: (records: any[]) => void;
}

/** 批量新增产品弹窗（基础数据"批量新增"同款组件，供 BOM 等场景复用） */
const BatchAddProductModal: React.FC<BatchAddProductModalProps> = ({
  open, onClose, productType = '成品', defaultLevel = '', zIndex = 1000, onCreated,
}) => {
  const [batchStyleCode, setBatchStyleCode] = useState('');
  const [batchSupplier, setBatchSupplier] = useState('');
  const [batchBasePrice, setBatchBasePrice] = useState<number | undefined>(undefined);
  const [batchProductTags, setBatchProductTags] = useState('');
  const [batchShortName, setBatchShortName] = useState('');
  const [batchMoldNumber, setBatchMoldNumber] = useState('');
  const [moldPickerVisible, setMoldPickerVisible] = useState(false);
  const [batchUnit, setBatchUnit] = useState('');
  const [batchProductStatus, setBatchProductStatus] = useState('开发');
  const [batchLevel, setBatchLevel] = useState('');
  const [batchCostPrice, setBatchCostPrice] = useState<number | undefined>(undefined);
  const [batchShoeUpper, setBatchShoeUpper] = useState('');
  const [batchShoeSole, setBatchShoeSole] = useState('');
  const [batchColorChecked, setBatchColorChecked] = useState(true);
  const [batchColorValues, setBatchColorValues] = useState<string[]>(['']);
  const [batchColorImages, setBatchColorImages] = useState<string[]>(['']);
  const [batchSpecChecked, setBatchSpecChecked] = useState(true);
  const [batchSpecValues, setBatchSpecValues] = useState<string[]>(['']);
  const [batchPreviewItems, setBatchPreviewItems] = useState<any[]>([]);
  const [barcodeOffset, setBarcodeOffset] = useState(0);
  // 模版
  const [batchTemplates, setBatchTemplates] = useState<any[]>(() => {
    try { return JSON.parse(readScopedItem('batchAddTemplates') || '[]'); } catch { return []; }
  });
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSpecPreset, setTemplateSpecPreset] = useState('');
  const [templateColorPreset, setTemplateColorPreset] = useState('');
  // 供应商选择
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; supplierName: string; shortName: string }[]>([]);
  const [supplierPickVisible, setSupplierPickVisible] = useState(false);
  const [supplierPickSearch, setSupplierPickSearch] = useState('');
  // 标签选择
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagSelected, setTagSelected] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  // 颜色图片上传（含粘贴/拍照）
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadTarget, setUploadTarget] = useState(0);
  const [camVisible, setCamVisible] = useState(false);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const isRaw = productType === '原材料';
  const needLevel = productType === '半成品' || productType === '原材料';
  // 成品模式：单位字段替换为鞋底材质
  const isFinished = productType === '成品';

  // 打开时：加载供应商/自定义标签，层级取默认值
  useEffect(() => {
    if (!open) return;
    const owner = getDataOwner();
    try {
      const stored = localStorage.getItem('purchaser_suppliers_' + owner);
      if (stored) setSupplierOptions(JSON.parse(stored));
    } catch { /* ignore */ }
    try {
      const tags = localStorage.getItem(`custom_product_tags_${owner}`);
      if (tags) setCustomTags(JSON.parse(tags));
    } catch { /* ignore */ }
    setBatchLevel(defaultLevel);
  }, [open, defaultLevel]);

  // 生成预览（含条形码）
  const generateBatchPreview = useCallback(() => {
    const styleCode = batchStyleCode.trim();
    if (!styleCode) { setBatchPreviewItems([]); return; }
    const colorPairs = batchColorChecked
      ? batchColorValues.map((v, i) => ({ color: v, img: batchColorImages[i] || '' })).filter(p => p.color.trim())
      : [{ color: '', img: '' }];
    if (batchColorChecked && colorPairs.length === 0) { setBatchPreviewItems([]); return; }
    const specs = batchSpecChecked ? batchSpecValues.filter(v => v.trim()) : [''];
    if (batchSpecChecked && specs.length === 0) { setBatchPreviewItems([]); return; }
    const items: any[] = [];
    const barcodeBase = getBarcodeBase() + parseInt(styleCode.replace(/\D/g, '').slice(0, 6) || '0') * 1000 + barcodeOffset;
    colorPairs.forEach((p, ci) => {
      specs.forEach((spec, si) => {
        const parts = [styleCode];
        if (batchColorChecked) parts.push(p.color);
        if (batchSpecChecked) parts.push(spec);
        items.push({
          styleCode,
          productCode: parts.join('-'),
          color: batchColorChecked ? p.color : '',
          image: batchColorChecked ? p.img : '',
          spec: batchSpecChecked ? spec : '',
          supplier: batchSupplier.trim(),
          basePrice: batchBasePrice || 0,
          barcode: String(barcodeBase + ci * 100 + si).padStart(13, '0'),
          productTags: batchProductTags.trim(),
          shortName: batchShortName.trim(),
          moldNumber: batchMoldNumber.trim(),
          unit: batchUnit.trim(),
          costPrice: batchCostPrice || 0,
          shoeUpper: batchShoeUpper.trim(),
          shoeSole: batchShoeSole.trim(),
        });
      });
    });
    setBatchPreviewItems(items);
  }, [batchStyleCode, batchColorChecked, batchColorValues, batchColorImages, batchSpecChecked, batchSpecValues, batchSupplier, batchBasePrice, batchProductTags, barcodeOffset, batchShortName, batchMoldNumber, batchUnit, batchCostPrice, batchShoeUpper, batchShoeSole]);

  useEffect(() => {
    if (open) generateBatchPreview();
  }, [generateBatchPreview, open]);

  // 重新生成条形码（跳过重复）
  const regenerateBarcodes = useCallback(() => {
    const styleCode = batchStyleCode.trim();
    if (!styleCode) { message.warning('请先输入款式编码'); return; }
    const owner = getDataOwner();
    let existing: any[] = [];
    try { existing = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]'); } catch { /* ignore */ }
    const existingBarcodes = new Set(existing.map((p: any) => p.barcode).filter(Boolean));
    const colors = batchColorChecked ? batchColorValues.filter(v => v.trim()) : [''];
    const specs = batchSpecChecked ? batchSpecValues.filter(v => v.trim()) : [''];
    const totalItems = colors.length * specs.length;
    let offset = barcodeOffset;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const barcodeBase = getBarcodeBase() + parseInt(styleCode.replace(/\D/g, '').slice(0, 6) || '0') * 1000 + offset;
      let hasDuplicate = false;
      for (let ci = 0; ci < colors.length && !hasDuplicate; ci++) {
        for (let si = 0; si < specs.length && !hasDuplicate; si++) {
          if (existingBarcodes.has(String(barcodeBase + ci * 100 + si).padStart(13, '0'))) hasDuplicate = true;
        }
      }
      if (!hasDuplicate) { setBarcodeOffset(offset); message.success('已重新生成一组不重复的条形码'); return; }
      offset += totalItems;
    }
    message.error('无法生成不重复的条形码，请修改款式编码');
  }, [batchStyleCode, batchColorChecked, batchColorValues, batchSpecChecked, batchSpecValues, barcodeOffset]);

  // 关闭并重置
  const handleClose = useCallback(() => {
    setBatchPreviewItems([]);
    setBarcodeOffset(0);
    onClose();
  }, [onClose]);

  // 确认新增
  const handleConfirm = useCallback(() => {
    if (batchPreviewItems.length === 0) { message.warning('请先生成预览'); return; }
    if (!batchProductStatus) { message.error('请选择商品状态'); return; }
    if (isRaw && !batchSupplier.trim()) { message.error('原材料必须选择供应商'); return; }
    if (needLevel && !batchLevel.trim()) { message.error('必须填写层级'); return; }
    if (isRaw && !batchUnit.trim()) { message.error('原材料必须填写单位'); return; }
    if (isRaw && (!batchCostPrice || batchCostPrice <= 0)) { message.error('原材料必须填写成本价'); return; }
    const owner = getDataOwner();
    const plKey = `pageData_basic-data_product-list_${owner}`;
    try {
      const existing: any[] = JSON.parse(localStorage.getItem(plKey) || '[]');
      const existingBarcodes = new Set(existing.map((p: any) => p.barcode).filter(Boolean));
      const dupBarcodes = batchPreviewItems.filter(item => item.barcode && existingBarcodes.has(item.barcode));
      if (dupBarcodes.length > 0) { message.error(`条形码 ${dupBarcodes.map(d => d.barcode).join(', ')} 与已有产品重复，请修改款式编码后重试`); return; }
      const existingCodes = new Set(existing.map((p: any) => String(p.productCode || '').trim()).filter(Boolean));
      const dupCodes = batchPreviewItems.filter(item => existingCodes.has(String(item.productCode || '').trim()));
      if (dupCodes.length > 0) { message.error(`商品编码 ${dupCodes.map(d => d.productCode).join(', ')} 与已有产品重复，无法保存`); return; }
      const newRecords = batchPreviewItems.map((item, i) => ({
        key: `new-${Date.now()}-${i}`,
        productCode: item.productCode || '',
        name: '',
        shortName: item.shortName || '',
        styleCode: item.styleCode || '',
        color: item.color || '',
        image: item.image || '',
        spec: item.spec || '',
        supplier: item.supplier || '',
        supplierName: item.supplier || '',
        barcode: item.barcode || '',
        moldNumber: item.moldNumber || '',
        suggestedPrice: Number(item.basePrice) || 0,
        costPrice: Number(item.costPrice) || 0,
        actualStock: 0,
        productType,
        unit: item.unit || '件',
        level: batchLevel.trim() || defaultLevel || '0',
        productStatus: batchProductStatus,  // 用户选择的商品状态（必填）
        shoeUpper: item.shoeUpper || '',
        shoeSole: item.shoeSole || '',
        productTags: item.productTags || '',
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      }));
      const merged = [...newRecords, ...existing];
      // 颜色图片持久化（localStorage 缩略图 + IndexedDB 兜底）
      newRecords.forEach((rec: any) => {
        if (rec.image) {
          const imgKey = `prodImg_${owner}_${rec.key}`;
          try { saveFullImage(imgKey, rec.image); } catch { /* ignore */ }
          try { saveFullImage(`thumb_${imgKey}`, rec.image); } catch { /* ignore */ }
          safeSetItem(imgKey, rec.image);
        }
      });
      setBatchColorImages(['']);
      safeSetItem(plKey, JSON.stringify(merged));
      saveDataset(plKey, JSON.stringify(merged));
      safeSetItem(`${plKey}_ts`, String(Date.now()));
      setBatchPreviewItems([]);
      setBarcodeOffset(0);
      message.success(`成功新增 ${newRecords.length} 条产品`);
      if (onCreated) onCreated(newRecords);
      onClose();
    } catch { message.error('保存失败'); }
  }, [batchPreviewItems, isRaw, needLevel, batchSupplier, batchLevel, batchProductStatus, defaultLevel, productType, onCreated, onClose]);

  // 摄像头拍照
  const closeCam = useCallback(() => {
    setCamVisible(false);
    if (camStreamRef.current) { camStreamRef.current.getTracks().forEach(t => t.stop()); camStreamRef.current = null; }
  }, []);
  useEffect(() => {
    if (!camVisible) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      camStreamRef.current = stream;
      if (camVideoRef.current) camVideoRef.current.srcObject = stream;
    }).catch(() => message.error('无法打开摄像头'));
    return () => { cancelled = true; };
  }, [camVisible]);
  const captureCam = useCallback(() => {
    const video = camVideoRef.current;
    if (!video || !video.videoWidth) { message.warning('摄像头未就绪'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setBatchColorImages(prev => prev.map((v, j) => j === uploadTarget ? dataUrl : v));
    closeCam();
    message.success('已拍照');
  }, [uploadTarget, closeCam]);

  // 上传弹窗：粘贴剪切板图片
  useEffect(() => {
    if (!uploadVisible) return;
    const handlePaste = (e: Event) => {
      const items = (e as ClipboardEvent).clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = ev => {
            const dataUrl = String(ev.target?.result || '');
            setBatchColorImages(prev => prev.map((v, j) => j === uploadTarget ? dataUrl : v));
            message.success('已粘贴剪切板图片');
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [uploadVisible, uploadTarget]);

  const labelSpan = (text: string, required?: boolean, width = 60) => (
    <span style={{ width, textAlign: 'right', paddingRight: 6, fontSize: 13, fontWeight: 500, flexShrink: 0 }}>
      {required && <span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>}{text}
    </span>
  );

  return (
    <>
      <Modal
        title={<span style={{ color: PRIMARY }}><PlusOutlined style={{ marginRight: 8 }} />批量新增产品</span>}
        open={open}
        onCancel={handleClose}
        width={1080}
        zIndex={zIndex}
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={handleClose}>取消</Button>,
          <Button key="submit" type="primary" onClick={handleConfirm}>确认新增 {batchPreviewItems.length} 条</Button>,
        ]}
      >
        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            {/* 第一行 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', columnGap: 8, marginBottom: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('款式编码')}
                <Input value={batchStyleCode} onChange={e => setBatchStyleCode(e.target.value)} placeholder="如：5008" style={{ flex: 1, minWidth: 0 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('供应商', isRaw)}
                {isRaw ? (
                  <Input value={batchSupplier} readOnly placeholder="点击选择供应商" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => { setSupplierPickSearch(''); setSupplierPickVisible(true); }} />
                ) : (
                  <AutoComplete value={batchSupplier} onChange={v => setBatchSupplier(v)} placeholder="选择或输入供应商" style={{ flex: 1, minWidth: 0 }}
                    options={supplierOptions.map(s => ({ label: s.supplierName, value: s.supplierName }))}
                    filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())} />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('基础售价')}
                <InputNumber value={batchBasePrice} onChange={(v: number | null) => setBatchBasePrice(v === null ? undefined : v)} min={0} precision={2} placeholder="69" style={{ flex: 1, minWidth: 0, width: 'auto' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('成本价', isRaw, 72)}
                <InputNumber value={batchCostPrice} onChange={(v: number | null) => setBatchCostPrice(v === null ? undefined : v)} min={0} precision={2} placeholder="0.00" style={{ flex: 1, minWidth: 0, width: 'auto' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('商品标签')}
                <Input value={batchProductTags} placeholder="点击选择标签" readOnly style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => { setTagSelected(batchProductTags ? batchProductTags.split(',').filter(Boolean) : []); setTagSearch(''); setNewTagInput(''); setTagModalVisible(true); }} />
              </div>
            </div>
            {/* 第二行 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', columnGap: 8, marginBottom: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('商品简称')}
                <Input value={batchShortName} onChange={e => setBatchShortName(e.target.value)} placeholder="商品简称" style={{ flex: 1, minWidth: 0 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                {labelSpan('模具编号')}
                <Input value={batchMoldNumber} onChange={e => setBatchMoldNumber(e.target.value)} placeholder="点击选择模具" readOnly
                  onClick={() => setMoldPickerVisible(true)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} />
              </div>
              {isFinished ? (
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  {labelSpan('鞋底材质', false, 72)}
                  <Input value={batchShoeSole} onChange={e => setBatchShoeSole(e.target.value)} placeholder="如：橡胶/EVA" style={{ flex: 1, minWidth: 0, width: 'auto' }} />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  {labelSpan('单位', isRaw)}
                  <Input value={batchUnit} onChange={e => setBatchUnit(e.target.value)} placeholder="如：件、个" style={{ flex: 1, minWidth: 0 }} />
                </div>
              )}
              {needLevel ? (
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  {labelSpan('层级', true, 72)}
                  <Input value={batchLevel} onChange={e => setBatchLevel(e.target.value)} placeholder={defaultLevel ? `默认 ${defaultLevel}` : '如：0'} style={{ flex: 1, minWidth: 0 }} />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  {labelSpan('鞋面材质', false, 72)}
                  <Input value={batchShoeUpper} onChange={e => setBatchShoeUpper(e.target.value)} placeholder="如：真皮/网布" style={{ flex: 1, minWidth: 0, width: 'auto' }} />
                </div>
              )}
              {needLevel ? (
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  {labelSpan('鞋面材质', false, 72)}
                  <Input value={batchShoeUpper} onChange={e => setBatchShoeUpper(e.target.value)} placeholder="如：真皮/网布" style={{ flex: 1, minWidth: 0, width: 'auto' }} />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  {labelSpan('商品状态', true, 72)}
                  <Select value={batchProductStatus || undefined} onChange={v => setBatchProductStatus(v)} placeholder="请选择" style={{ flex: 1, minWidth: 0 }}
                    options={[
                      { label: '在售', value: '在售' },
                      { label: '开发', value: '开发' },
                      { label: '预售', value: '预售' },
                      { label: '停产', value: '停产' },
                      { label: '下架', value: '下架' },
                    ]} />
                </div>
              )}
            </div>
            {/* 颜色行 */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Checkbox checked={batchColorChecked} onChange={e => setBatchColorChecked(e.target.checked)} style={{ marginRight: 4 }} />
              <span style={{ width: 72, textAlign: 'right', paddingRight: 8, fontSize: 13, fontWeight: 500, flexShrink: 0 }}>颜色</span>
              {batchColorValues.map((color, idx) => (
                <div key={idx} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 4, opacity: batchColorChecked ? 1 : 0.5 }}>
                  {(batchColorImages[idx] || '') !== '' ? (
                    <div style={{ position: 'relative', width: 40, height: 40, marginRight: 6 }}>
                      <img src={batchColorImages[idx]} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee', display: 'block' }} />
                      <DeleteOutlined onClick={() => setBatchColorImages(prev => prev.map((v, j) => j === idx ? '' : v))}
                        style={{ position: 'absolute', top: -7, right: -7, background: '#fff', borderRadius: '50%', fontSize: 12, color: '#ff4d4f', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', cursor: 'pointer' }} />
                    </div>
                  ) : (
                    <div onClick={() => { if (!batchColorChecked) return; setUploadTarget(idx); setUploadVisible(true); }}
                      style={{ width: 40, height: 40, marginRight: 6, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bfbfbf', cursor: batchColorChecked ? 'pointer' : 'default', background: '#fafafa' }}>
                      <PictureOutlined style={{ fontSize: 16 }} />
                    </div>
                  )}
                  <Input value={color} onChange={e => setBatchColorValues(prev => prev.map((v, j) => j === idx ? e.target.value : v))}
                    placeholder={`颜色${idx + 1}`} disabled={!batchColorChecked}
                    style={{ width: 80, background: batchColorChecked ? undefined : '#f5f5f5' }} />
                </div>
              ))}
              {batchColorChecked && (
                <Button size="small" icon={<PlusOutlined />} onClick={() => { setBatchColorValues(prev => [...prev, '']); setBatchColorImages(prev => [...prev, '']); }} style={{ marginBottom: 4 }}>添加颜色</Button>
              )}
              {batchColorChecked && batchColorValues.length > 1 && (
                <Button size="small" danger onClick={() => { setBatchColorValues(prev => prev.slice(0, -1)); setBatchColorImages(prev => prev.slice(0, -1)); }} style={{ marginBottom: 4 }}>删除末项</Button>
              )}
            </div>
            {/* 规格行 */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Checkbox checked={batchSpecChecked} onChange={e => setBatchSpecChecked(e.target.checked)} style={{ marginRight: 4 }} />
              <span style={{ width: 72, textAlign: 'right', paddingRight: 8, fontSize: 13, fontWeight: 500, flexShrink: 0 }}>规格</span>
              {batchSpecValues.map((spec, idx) => (
                <Input key={idx} value={spec} onChange={e => setBatchSpecValues(prev => prev.map((v, j) => j === idx ? e.target.value : v))}
                  placeholder={`规格${idx + 1}`} disabled={!batchSpecChecked}
                  style={{ width: 80, marginRight: 8, marginBottom: 4, background: batchSpecChecked ? undefined : '#f5f5f5' }} />
              ))}
              {batchSpecChecked && (
                <Button size="small" icon={<PlusOutlined />} onClick={() => setBatchSpecValues(prev => [...prev, ''])} style={{ marginBottom: 4 }}>添加规格</Button>
              )}
              {batchSpecChecked && batchSpecValues.length > 1 && (
                <Button size="small" danger onClick={() => setBatchSpecValues(prev => prev.slice(0, -1))} style={{ marginBottom: 4 }}>删除末项</Button>
              )}
            </div>
            {/* 模版 + 重新生成 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Button size="small" icon={<SaveOutlined />} onClick={() => setTemplateModalVisible(true)}>新建模版</Button>
                {batchTemplates.map((tpl, idx) => (
                  <Button key={idx} size="small" type="link" onClick={() => {
                    if (tpl.colorValues?.length) { setBatchColorChecked(true); setBatchColorValues([...tpl.colorValues]); }
                    if (tpl.specValues?.length) { setBatchSpecChecked(true); setBatchSpecValues([...tpl.specValues]); }
                    message.success('已加载模版');
                  }}>{tpl.name}</Button>
                ))}
              </div>
              <Button type="primary" onClick={regenerateBarcodes} style={{ background: '#52c41a', borderColor: '#52c41a' }}>重新生成</Button>
            </div>
          </div>
          {/* 预览区域 */}
          {batchPreviewItems.length > 0 ? (
            <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 12, border: '1px solid #a5d6a7' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: '#2e7d32' }}>预览（共 {batchPreviewItems.length} 条）</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                <thead>
                  <tr style={{ background: '#c8e6c9' }}>
                    {['款式编码', '商品编码', '商品简称', '模具编号', ...(batchColorChecked ? ['颜色'] : []), ...(batchSpecChecked ? ['规格'] : []), '供应商', '基础售价', '成本价', '鞋面材质', ...(isFinished ? ['鞋底材质'] : ['单位']), '条形码'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #a5d6a7', textAlign: 'center' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batchPreviewItems.map((item, idx) => (
                    <tr key={idx} style={{ background: idx % 2 === 0 ? '#f1f8e9' : '#fff' }}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.styleCode}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.productCode}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.shortName || '—'}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.moldNumber || '—'}</td>
                      {batchColorChecked && <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.color}</td>}
                      {batchSpecChecked && <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.spec}</td>}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.supplier}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.basePrice}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.costPrice}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.shoeUpper || '—'}</td>
                      {isFinished ? (
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.shoeSole || '—'}</td>
                      ) : (
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center' }}>{item.unit || '—'}</td>
                      )}
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #e0e0e0', textAlign: 'center', fontFamily: 'monospace' }}>{item.barcode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: '#8c8c8c' }}>填写上方信息后自动生成预览</div>
          )}
        </div>
      </Modal>

      {/* 供应商选择弹窗（采购平台供应商列表） */}
      <Modal title="选择供应商（采购平台供应商列表）" open={supplierPickVisible} onCancel={() => setSupplierPickVisible(false)}
        footer={[<Button key="close" onClick={() => setSupplierPickVisible(false)}>关闭</Button>]} width={640} zIndex={zIndex + 100} destroyOnClose>
        <Input.Search placeholder="搜索供应商名称/简称" allowClear value={supplierPickSearch} onChange={e => setSupplierPickSearch(e.target.value)} style={{ marginBottom: 12 }} />
        {supplierOptions.length === 0 ? (
          <Empty description="采购平台暂无供应商" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table size="small" rowKey="id" bordered pagination={{ pageSize: 8, size: 'small' }}
            dataSource={supplierOptions.filter(s => {
              const q = supplierPickSearch.trim();
              return !q || (s.supplierName || '').includes(q) || (s.shortName || '').includes(q);
            })}
            columns={[
              { title: '供应商名称', dataIndex: 'supplierName', key: 'supplierName' },
              { title: '简称', dataIndex: 'shortName', key: 'shortName', width: 120, render: (v: string) => v || '—' },
              { title: '操作', key: 'op', width: 80, render: (_: any, s: any) => (
                <Button size="small" type="link" onClick={() => { setBatchSupplier(s.supplierName); setSupplierPickVisible(false); }}>选择</Button>
              ) },
            ]} />
        )}
      </Modal>

      {/* 商品标签选择弹窗 */}
      <Modal title="选择商品标签" open={tagModalVisible} onCancel={() => setTagModalVisible(false)} width={480} zIndex={zIndex + 100} destroyOnClose
        footer={[
          <Button key="c" onClick={() => setTagModalVisible(false)}>取消</Button>,
          <Button key="ok" type="primary" onClick={() => { setBatchProductTags(tagSelected.join(',')); setTagModalVisible(false); }}>确定</Button>,
        ]}>
        <Input.Search placeholder="搜索标签" allowClear value={tagSearch} onChange={e => setTagSearch(e.target.value)} style={{ marginBottom: 12 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {customTags.filter(t => !tagSearch.trim() || t.includes(tagSearch.trim())).map(t => (
            <Checkbox key={t} checked={tagSelected.includes(t)} onChange={e => setTagSelected(prev => e.target.checked ? [...prev, t] : prev.filter(x => x !== t))}>{t}</Checkbox>
          ))}
          {customTags.length === 0 && <Empty description="暂无自定义标签" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </div>
        <Space>
          <Input placeholder="新标签名称" value={newTagInput} onChange={e => setNewTagInput(e.target.value)} style={{ width: 180 }} />
          <Button size="small" icon={<PlusOutlined />} onClick={() => {
            const val = newTagInput.trim();
            if (!val) return;
            if (customTags.includes(val)) { message.warning('该标签已存在'); return; }
            const updated = [...customTags, val];
            setCustomTags(updated);
            try { localStorage.setItem(`custom_product_tags_${getDataOwner()}`, JSON.stringify(updated)); } catch { /* ignore */ }
            setNewTagInput('');
          }}>添加</Button>
        </Space>
      </Modal>

      {/* 模版管理弹窗 */}
      <Modal title="批量新增模版" open={templateModalVisible} onCancel={() => setTemplateModalVisible(false)} width={500} zIndex={zIndex + 100} footer={null} destroyOnClose>
        <div style={{ marginBottom: 12 }}>
          <Input placeholder="输入模版名称" value={templateName} onChange={e => setTemplateName(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ marginBottom: 8 }}>
            <Input placeholder="输入预设颜色，用逗号分隔，如：黑色,蓝色,白色" value={templateColorPreset} onChange={e => setTemplateColorPreset(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <Input placeholder="输入预设规格，用逗号分隔，如：35,36,37,38" value={templateSpecPreset} onChange={e => setTemplateSpecPreset(e.target.value)} style={{ width: '100%' }} />
          </div>
          <Button type="primary" size="small" onClick={() => {
            if (!templateName.trim()) { message.warning('请输入模版名称'); return; }
            const tpl = {
              name: templateName.trim(),
              colorValues: templateColorPreset.split(/[,，]/).map(s => s.trim()).filter(Boolean),
              specValues: templateSpecPreset.split(/[,，]/).map(s => s.trim()).filter(Boolean),
            };
            const updated = [...batchTemplates, tpl];
            setBatchTemplates(updated);
            writeScopedItem('batchAddTemplates', JSON.stringify(updated));
            setTemplateName(''); setTemplateSpecPreset(''); setTemplateColorPreset('');
            message.success('模版已保存');
          }}>保存当前为模版</Button>
        </div>
        <Divider style={{ margin: '12px 0' }} />
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {batchTemplates.map((tpl, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: '#fafafa', borderRadius: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>{tpl.name}</span>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => {
                const updated = batchTemplates.filter((_, i) => i !== idx);
                setBatchTemplates(updated);
                writeScopedItem('batchAddTemplates', JSON.stringify(updated));
              }} />
            </div>
          ))}
          {batchTemplates.length === 0 && <Empty description="暂无模版" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </div>
      </Modal>

      {/* 颜色图片上传弹窗（点击/拖拽/粘贴/拍照） */}
      <Modal title={`上传图片（颜色：${(batchColorValues[uploadTarget] || '').trim() || `颜色${uploadTarget + 1}`}）`} open={uploadVisible}
        onCancel={() => setUploadVisible(false)} width={480} zIndex={zIndex + 100} destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setUploadVisible(false)}>取消</Button>,
          <Button key="cam" icon={<CameraOutlined />} onClick={() => setCamVisible(true)}>拍照</Button>,
          <Button key="done" type="primary" onClick={() => setUploadVisible(false)}>完成</Button>,
        ]}>
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          {(batchColorImages[uploadTarget] || '') !== '' && (
            <div style={{ marginBottom: 12 }}>
              <img src={batchColorImages[uploadTarget]} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
              <div><Button size="small" danger type="link" icon={<DeleteOutlined />} onClick={() => setBatchColorImages(prev => prev.map((v, j) => j === uploadTarget ? '' : v))}>删除图片</Button></div>
            </div>
          )}
          <Upload.Dragger accept="image/*" maxCount={1} showUploadList={false}
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = e => setBatchColorImages(prev => prev.map((v, j) => j === uploadTarget ? String(e.target?.result || '') : v));
              reader.readAsDataURL(file);
              return false;
            }}
            style={{ padding: '16px 0' }}>
            <p style={{ fontSize: 40, color: PRIMARY, marginBottom: 8 }}><CameraOutlined /></p>
            <p style={{ fontSize: 14, color: '#1a2b45' }}>点击或拖拽图片到此区域</p>
            <p style={{ fontSize: 12, color: '#999' }}>支持 JPG、PNG、GIF 格式</p>
            <p style={{ fontSize: 12, color: PRIMARY, marginTop: 8 }}><CopyOutlined style={{ marginRight: 4 }} />也可以直接 Ctrl+V 粘贴剪贴板图片</p>
          </Upload.Dragger>
        </div>
      </Modal>

      {/* 摄像头拍照弹窗 */}
      <Modal title="摄像头拍照" open={camVisible} onCancel={closeCam} width={480} zIndex={zIndex + 200} destroyOnClose
        footer={[
          <Button key="c" onClick={closeCam}>取消</Button>,
          <Button key="s" type="primary" icon={<CameraOutlined />} onClick={captureCam}>拍照</Button>,
        ]}>
        <div style={{ textAlign: 'center' }}>
          <video ref={camVideoRef} autoPlay playsInline style={{ width: '100%', maxWidth: 432, borderRadius: 8, background: '#000' }} />
        </div>
      </Modal>

      <MoldPickerModal
        open={moldPickerVisible}
        value={batchMoldNumber}
        onSelect={(code) => { setBatchMoldNumber(code); setMoldPickerVisible(false); }}
        onCancel={() => setMoldPickerVisible(false)}
        zIndex={(zIndex || 1000) + 100}
      />
    </>
  );
};

export default BatchAddProductModal;
