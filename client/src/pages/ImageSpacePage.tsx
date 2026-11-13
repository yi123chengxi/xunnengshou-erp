import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Drawer, Empty, Image as AntdImage, Input, message, Modal, Popconfirm, Segmented,
  Select, Space, Spin, Statistic, Tag, Tooltip, Progress, Badge,
} from 'antd';
import {
  CloudUploadOutlined, CopyOutlined, DeleteOutlined, EditOutlined, LinkOutlined, PictureOutlined,
  ReloadOutlined, SearchOutlined, TagsOutlined, ArrowRightOutlined, DatabaseOutlined, CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { copyText } from '../utils/clipboard';
import {
  absoluteImageUrl, deleteImage, getImageDetail, imageRefLink, listImages, listImageTags,
  prepareImageFile, updateImage, uploadImage, ImageAsset, ImageRef, PreparedImage,
} from '../utils/imageSpace';
import { migrateLocalImages, scanLocalImages, LocalImageCandidate } from '../utils/imageMigration';
import { sessionDataOwner } from '../utils/storageQuota';

const PRIMARY = '#1e4a7e';

// 列表项唯一键：全平台视图会混排多个租户，单用 id 可能撞键
const assetKey = (a: ImageAsset): string => `${a.owner}_${a.id}`;

const fmtSize = (bytes: number): string => {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
};

const fmtTime = (ts: number): string => {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const ImageSpacePage: React.FC = () => {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [tag, setTag] = useState<string>('');
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [items, setItems] = useState<ImageAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // 批量选择与删除
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  // 当前租户归属（与 /api/images 的服务端 owner 同口径：子账号归父账号）
  const myOwner = useMemo(() => sessionDataOwner(), []);
  // 「我的图片」视图全是本租户数据，直接可删；全平台视图才按 owner 区分（服务端只删本租户索引）
  const canDelete = useCallback((a: ImageAsset) => scope === 'mine' || !a.owner || a.owner === myOwner, [scope, myOwner]);

  // 上传
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; preview: string; name: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tagInput, setTagInput] = useState('');

  // 详情
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ImageAsset | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // 迁移
  const [localCandidates, setLocalCandidates] = useState<LocalImageCandidate[]>([]);
  const [migrateVisible, setMigrateVisible] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateDone, setMigrateDone] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listImages({ scope, q: appliedKeyword, tag: tag || undefined, limit: 500 });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      message.error(err?.message || '图片列表加载失败');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [scope, appliedKeyword, tag]);

  const loadTags = useCallback(async () => {
    try { setTags(await listImageTags()); } catch { /* 标签失败不影响主流程 */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadTags(); }, [loadTags]);

  // 本机历史图片探测（有才显示迁移入口）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await scanLocalImages();
        if (!cancelled) setLocalCandidates(list);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const openDetail = useCallback(async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const rec = await getImageDetail(id);
      setDetail(rec);
      setEditingName(rec.name || '');
    } catch (err: any) {
      message.error(err?.message || '图片详情加载失败');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleCopyLink = useCallback(async (asset: ImageAsset) => {
    const ok = await copyText(absoluteImageUrl(asset.url));
    if (ok) message.success('图片链接已复制');
    else message.warning('复制失败，请手动选择链接');
  }, []);

  const handleDelete = useCallback(async (asset: ImageAsset, force = false) => {
    try {
      await deleteImage(asset.id, force);
      message.success('图片已删除');
      if (detail?.id === asset.id) { setDetailOpen(false); setDetail(null); }
      void load();
      void loadTags();
    } catch (err: any) {
      if (err?.status === 409) {
        const refs: ImageRef[] = err?.data?.refs || [];
        Modal.confirm({
          title: '该图片仍被引用',
          content: (
            <div style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>以下位置正在使用这张图片，删除后这些位置会显示空图：</div>
              {refs.slice(0, 8).map(r => (
                <div key={r.key} style={{ color: '#666' }}>
                  · {r.moduleLabel || r.module}/{r.childLabel || r.childKey} · {r.recordName || r.recordKey}（{r.field}）
                </div>
              ))}
              {refs.length > 8 && <div style={{ color: '#999' }}>…… 共 {refs.length} 处</div>}
            </div>
          ),
          okText: '仍然删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => handleDelete(asset, true),
        });
        return;
      }
      message.error(err?.message || '删除失败');
    }
  }, [detail, load, loadTags]);

  // ============ 批量选择与删除 ============
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  // 列表刷新/筛选后剔除已不在列表中的选择，避免误删看不见的图片
  useEffect(() => {
    setSelectedKeys(prev => {
      if (prev.length === 0) return prev;
      const valid = new Set(items.map(assetKey));
      const next = prev.filter(k => valid.has(k));
      return next.length === prev.length ? prev : next;
    });
  }, [items]);

  // 切换视图或筛选条件时清空选择（避免把上一批筛选的图片误删）
  useEffect(() => { setSelectedKeys([]); }, [scope, appliedKeyword, tag]);

  const selectedAssets = useMemo(() => items.filter(a => selectedKeySet.has(assetKey(a))), [items, selectedKeySet]);
  const selectedSize = useMemo(() => selectedAssets.reduce((s, a) => s + (Number(a.size) || 0), 0), [selectedAssets]);
  // 全平台视图混有其他租户上传的图片，服务端只允许删除本租户索引，这里只勾选可删的
  const selectableAssets = useMemo(() => items.filter(canDelete), [items, canDelete]);

  const toggleSelect = useCallback((a: ImageAsset) => {
    const k = assetKey(a);
    setSelectedKeys(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(selectableAssets.map(assetKey));
  }, [selectableAssets]);

  const runBatchDelete = useCallback(async (force: boolean) => {
    if (selectedAssets.length === 0) return;
    setBatchDeleting(true);
    let ok = 0;
    const failed: string[] = [];
    const progressKey = 'image-batch-delete';
    message.loading({ content: `正在删除 0/${selectedAssets.length}`, key: progressKey, duration: 0 });
    // 逐张删除（服务端单删接口带引用校验），保证每张都能回溯失败原因
    for (const asset of selectedAssets) {
      try {
        await deleteImage(asset.id, force);
        ok++;
      } catch {
        failed.push(asset.name || asset.id);
      }
      message.loading({ content: `正在删除 ${ok + failed.length}/${selectedAssets.length}`, key: progressKey, duration: 0 });
    }
    message.destroy(progressKey);
    setBatchDeleting(false);
    setSelectedKeys([]);
    if (detail && selectedAssets.some(a => a.id === detail.id)) { setDetailOpen(false); setDetail(null); }
    if (ok > 0) message.success(`已删除 ${ok} 张图片`);
    if (failed.length > 0) {
      message.error(`${failed.length} 张删除失败（可能仍被引用或无权限）：${failed.slice(0, 3).join('、')}${failed.length > 3 ? ' 等' : ''}`);
    }
    void load();
    void loadTags();
  }, [selectedAssets, detail, load, loadTags]);

  const confirmBatchDelete = useCallback(() => {
    if (selectedAssets.length === 0) { message.warning('请先勾选要删除的图片'); return; }
    const refAssets = selectedAssets.filter(a => (a.refCount || 0) > 0);
    const refTotal = refAssets.reduce((s, a) => s + (a.refCount || 0), 0);
    const hasRef = refAssets.length > 0;
    Modal.confirm({
      title: `确认删除选中的 ${selectedAssets.length} 张图片？`,
      width: 560,
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: (
        <div style={{ fontSize: 13 }}>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            message="删除后不可恢复，请确认这些图片已不再使用"
            description={hasRef
              ? `选中的图片中有 ${refAssets.length} 张正被业务数据使用（共 ${refTotal} 处引用），删除后这些位置会显示空图。`
              : '选中的图片目前没有被任何业务数据引用。'}
          />
          {hasRef && (
            <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid #ffe58f', background: '#fffbe6', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              {refAssets.slice(0, 10).map(a => (
                <div key={assetKey(a)} style={{ color: '#ad6800', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  · {a.name}（{a.refCount} 处引用）
                </div>
              ))}
              {refAssets.length > 10 && <div style={{ color: '#d48806' }}>…… 其余 {refAssets.length - 10} 张</div>}
            </div>
          )}
          <div style={{ color: '#8c8c8c' }}>
            共 {selectedAssets.length} 张 · {fmtSize(selectedSize)}。可先点击图片查看「引用位置」，确认无影响后再删除。
          </div>
        </div>
      ),
      okText: hasRef ? '仍然删除' : '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => runBatchDelete(hasRef),
    });
  }, [selectedAssets, selectedSize, runBatchDelete]);

  // ============ 上传 ============
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 30);
    if (arr.length === 0) return;
    const next: Array<{ file: File; preview: string; name: string }> = [];
    for (const file of arr) {
      try {
        const prepared = await prepareImageFile(file);
        next.push({ file, preview: prepared.thumbDataUrl || prepared.dataUrl, name: file.name.replace(/\.[^.]+$/, '') });
      } catch (err: any) {
        message.error(`${file.name}：${err?.message || '读取失败'}`);
      }
    }
    setPendingFiles(prev => [...prev, ...next].slice(0, 50));
  }, []);

  const doUpload = useCallback(async () => {
    if (pendingFiles.length === 0) { message.warning('请先选择图片'); return; }
    setUploading(true);
    setUploadProgress(0);
    let ok = 0; let fail = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      const item = pendingFiles[i];
      try {
        const prepared: PreparedImage = await prepareImageFile(item.file);
        await uploadImage({
          ...prepared,
          name: item.name || '未命名图片',
          tags: uploadTags,
          ref: {
            module: 'basic-data', moduleLabel: '基础数据',
            childKey: 'image-space', childLabel: '图片空间',
            recordKey: '', recordName: '图片空间上传', field: 'upload',
          },
        });
        ok++;
      } catch (err: any) {
        fail++;
        if (fail === 1) message.error(err?.message || '部分图片上传失败');
      }
      setUploadProgress(Math.round(((i + 1) / pendingFiles.length) * 100));
    }
    setUploading(false);
    setPendingFiles([]);
    setUploadVisible(false);
    setUploadProgress(0);
    if (ok > 0) message.success(`成功上传 ${ok} 张图片${fail > 0 ? `，失败 ${fail} 张` : ''}`);
    void load();
    void loadTags();
  }, [pendingFiles, uploadTags, load, loadTags]);

  // ============ 迁移 ============
  const doMigrate = useCallback(async () => {
    setMigrating(true);
    setMigrateDone(0);
    try {
      const count = await migrateLocalImages((done, totalCount) => {
        setMigrateDone(Math.round((done / Math.max(1, totalCount)) * 100));
      });
      message.success(`历史图片迁移完成，共上传 ${count} 张`);
      setMigrateVisible(false);
      setLocalCandidates(await scanLocalImages());
      void load();
      void loadTags();
    } catch (err: any) {
      message.error(err?.message || '迁移失败');
    } finally {
      setMigrating(false);
      setMigrateDone(0);
    }
  }, [load, loadTags]);

  const handleSaveName = useCallback(async () => {
    if (!detail) return;
    setSavingName(true);
    try {
      const rec = await updateImage(detail.id, { name: editingName });
      setDetail(rec);
      message.success('已保存');
      void load();
    } catch (err: any) {
      message.error(err?.message || '保存失败');
    } finally {
      setSavingName(false);
    }
  }, [detail, editingName, load]);

  const totalSize = useMemo(() => items.reduce((s, x) => s + (Number(x.size) || 0), 0), [items]);

  return (
    <div style={{ padding: 16 }}>
      <Card
        size="small"
        style={{ marginBottom: 12, borderRadius: 8 }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontWeight: 700, color: PRIMARY, fontSize: 16 }}>
            <PictureOutlined style={{ marginRight: 6 }} />图片空间
          </span>
          <Tag color="blue">共 {total} 张 · {fmtSize(totalSize)}</Tag>
          <Segmented
            value={scope}
            onChange={v => setScope(v as 'mine' | 'all')}
            options={[{ label: '我的图片', value: 'mine' }, { label: '全平台图片', value: 'all' }]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按名称 / 标签 / 引用记录搜索"
            style={{ width: 260 }}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onPressEnter={() => setAppliedKeyword(keyword.trim())}
          />
          <Button onClick={() => setAppliedKeyword(keyword.trim())}>搜索</Button>
          <Select
            allowClear
            placeholder="按标签筛选"
            style={{ minWidth: 150 }}
            value={tag || undefined}
            onChange={v => setTag(v || '')}
            options={tags.map(t => ({ label: `${t.tag}（${t.count}）`, value: t.tag }))}
          />
          <div style={{ flex: 1 }} />
          {localCandidates.length > 0 && (
            <Tooltip title="把本机旧版图片（产品图/付款截图/模具图）一次性上传到云端图片空间">
              <Button icon={<DatabaseOutlined />} onClick={() => setMigrateVisible(true)}>
                迁移本机历史图片（{localCandidates.length}）
              </Button>
            </Tooltip>
          )}
          <Button icon={<CloudUploadOutlined />} type="primary" onClick={() => setUploadVisible(true)}>上传图片</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { void load(); void loadTags(); }}>刷新</Button>
        </div>
      </Card>

      {/* ============ 批量操作条（勾选后出现） ============ */}
      {(selectedAssets.length > 0 || batchDeleting) && (
        <Card
          size="small"
          style={{ marginBottom: 12, borderRadius: 8, background: '#f0f5ff', borderColor: '#adc6ff' }}
          bodyStyle={{ padding: '8px 16px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <Checkbox
              checked={selectableAssets.length > 0 && selectedAssets.length >= selectableAssets.length}
              indeterminate={selectedAssets.length > 0 && selectedAssets.length < selectableAssets.length}
              onChange={e => (e.target.checked ? selectAll() : setSelectedKeys([]))}
            >
              全选当前列表
            </Checkbox>
            <span style={{ fontSize: 13 }}>
              已选 <b style={{ color: PRIMARY }}>{selectedAssets.length}</b> 张 · {fmtSize(selectedSize)}
            </span>
            <Button size="small" onClick={() => setSelectedKeys([])}>取消选择</Button>
            <div style={{ flex: 1 }} />
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={batchDeleting}
              disabled={selectedAssets.length === 0}
              onClick={confirmBatchDelete}
            >
              批量删除{selectedAssets.length > 0 ? `（${selectedAssets.length}）` : ''}
            </Button>
          </div>
        </Card>
      )}

      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Card style={{ borderRadius: 8 }}>
            <Empty description={appliedKeyword || tag ? '没有符合条件的图片' : '图片空间还是空的，上传第一张图片吧'}>
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadVisible(true)}>上传图片</Button>
            </Empty>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 12 }}>
            {items.map(asset => {
              const k = assetKey(asset);
              const checked = selectedKeySet.has(k);
              const deletable = canDelete(asset);
              return (
              <Card
                key={k}
                hoverable
                size="small"
                style={{ borderRadius: 8, overflow: 'hidden', boxShadow: checked ? `0 0 0 2px ${PRIMARY}` : undefined }}
                bodyStyle={{ padding: 8 }}
                cover={
                  <div style={{ position: 'relative', height: 132, background: '#f5f6f8', cursor: 'pointer' }} onClick={() => openDetail(asset.id)}>
                    <img
                      src={absoluteImageUrl(asset.thumbUrl || asset.url)}
                      alt={asset.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = '0.15'; }}
                    />
                    {/* 批量勾选复选框：仅本账号上传的图片可删（全平台视图会混排其他租户图片） */}
                    <div
                      style={{
                        position: 'absolute', top: 6, left: 6, zIndex: 3,
                        background: 'rgba(255,255,255,0.92)', borderRadius: 4, padding: '0 4px',
                        lineHeight: '18px', boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      {deletable ? (
                        <Tooltip title={checked ? '取消选择' : '选择这张图片'}>
                          <Checkbox checked={checked} onChange={() => toggleSelect(asset)} />
                        </Tooltip>
                      ) : (
                        <Tooltip title="仅能删除本账号上传的图片">
                          <Checkbox disabled />
                        </Tooltip>
                      )}
                    </div>
                    {(asset.refCount || 0) > 0 && (
                      <Badge
                        count={asset.refCount}
                        style={{ position: 'absolute', top: 6, right: 6, background: PRIMARY }}
                        title={`被 ${asset.refCount} 处引用`}
                      />
                    )}
                  </div>
                }
                actions={[
                  <Tooltip title="复制链接" key="copy"><CopyOutlined onClick={() => void handleCopyLink(asset)} /></Tooltip>,
                  <Tooltip title="详情与引用" key="detail"><EditOutlined onClick={() => openDetail(asset.id)} /></Tooltip>,
                  <Popconfirm key="del" title="确认删除这张图片？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(asset)}>
                    <DeleteOutlined style={{ color: '#ff4d4f' }} />
                  </Popconfirm>,
                ]}
              >
                <Tooltip title={asset.name}>
                  <div style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
                </Tooltip>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{fmtSize(asset.size)} · {fmtTime(asset.createdAt).slice(0, 10)}</div>
              </Card>
              );
            })}
          </div>
        )}
      </Spin>

      {/* ============ 上传弹窗 ============ */}
      <Modal
        open={uploadVisible}
        title={<span style={{ color: PRIMARY }}><CloudUploadOutlined style={{ marginRight: 6 }} />上传图片到图片空间</span>}
        onCancel={() => { if (!uploading) { setUploadVisible(false); setPendingFiles([]); } }}
        width={720}
        footer={[
          <Button key="cancel" disabled={uploading} onClick={() => { setUploadVisible(false); setPendingFiles([]); }}>取消</Button>,
          <Button key="ok" type="primary" loading={uploading} onClick={doUpload} disabled={pendingFiles.length === 0}>
            上传 {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ''}
          </Button>,
        ]}
      >
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
          style={{ border: '1px dashed #bfbfbf', borderRadius: 8, padding: '22px 12px', textAlign: 'center', color: '#8c8c8c', cursor: 'pointer', background: '#fafafa' }}
        >
          <CloudUploadOutlined style={{ fontSize: 26, color: PRIMARY }} />
          <div style={{ marginTop: 6, fontSize: 13 }}>点击选择图片，或把图片拖到这里（支持多选，单张上限 20MB）</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }}
        />

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TagsOutlined style={{ color: PRIMARY }} />
          <span style={{ fontSize: 13 }}>统一标签：</span>
          <Input
            size="small"
            style={{ width: 180 }}
            placeholder="输入后回车添加，如 产品图"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onPressEnter={() => {
              const v = tagInput.trim();
              if (v && !uploadTags.includes(v)) setUploadTags([...uploadTags, v]);
              setTagInput('');
            }}
          />
          {uploadTags.map(t => <Tag key={t} closable onClose={() => setUploadTags(uploadTags.filter(x => x !== t))}>{t}</Tag>)}
        </div>

        {pendingFiles.length > 0 && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, maxHeight: 260, overflow: 'auto' }}>
            {pendingFiles.map((p, idx) => (
              <div key={`${p.name}_${idx}`} style={{ position: 'relative', border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
                <img src={p.preview} alt={p.name} style={{ width: '100%', height: 76, objectFit: 'cover', display: 'block' }} />
                <div style={{ fontSize: 11, padding: '2px 4px', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                {!uploading && (
                  <DeleteOutlined
                    onClick={() => setPendingFiles(list => list.filter((_, i) => i !== idx))}
                    style={{ position: 'absolute', top: 4, right: 4, color: '#ff4d4f', background: '#fff', borderRadius: '50%', padding: 2 }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {uploading && <Progress percent={uploadProgress} size="small" style={{ marginTop: 12 }} />}
      </Modal>

      {/* ============ 图片详情（含引用位置） ============ */}
      <Drawer
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        width={560}
        title={<span style={{ color: PRIMARY }}><PictureOutlined style={{ marginRight: 6 }} />图片详情</span>}
        destroyOnClose
      >
        {detailLoading || !detail ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <div>
            <div style={{ textAlign: 'center', background: '#f5f6f8', borderRadius: 8, padding: 8 }}>
              <AntdImage
                src={absoluteImageUrl(detail.url)}
                alt={detail.name}
                style={{ maxHeight: 300, maxWidth: '100%', objectFit: 'contain' }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>名称</div>
              <Space.Compact style={{ width: '100%' }}>
                <Input value={editingName} onChange={e => setEditingName(e.target.value)} maxLength={120} />
                <Button type="primary" loading={savingName} disabled={editingName === detail.name} onClick={handleSaveName}>保存</Button>
              </Space.Compact>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginTop: 14, fontSize: 13 }}>
              <div><span style={{ color: '#8c8c8c' }}>尺寸：</span>{detail.width || '-'} × {detail.height || '-'}</div>
              <div><span style={{ color: '#8c8c8c' }}>大小：</span>{fmtSize(detail.size)}</div>
              <div><span style={{ color: '#8c8c8c' }}>上传者：</span>{detail.uploader || detail.owner}</div>
              <div><span style={{ color: '#8c8c8c' }}>上传时间：</span>{fmtTime(detail.createdAt)}</div>
              <div style={{ gridColumn: '1 / span 2' }}><span style={{ color: '#8c8c8c' }}>图片 ID：</span>{detail.id}</div>
              <div style={{ gridColumn: '1 / span 2' }}>
                <span style={{ color: '#8c8c8c' }}>图片链接：</span>
                <a onClick={() => void handleCopyLink(detail)} style={{ wordBreak: 'break-all' }}>
                  <LinkOutlined /> {absoluteImageUrl(detail.url)}
                </a>
              </div>
              {detail.tags && detail.tags.length > 0 && (
                <div style={{ gridColumn: '1 / span 2' }}>
                  <span style={{ color: '#8c8c8c' }}>标签：</span>
                  {detail.tags.map(t => <Tag key={t} color="blue">{t}</Tag>)}
                </div>
              )}
            </div>

            <div style={{ marginTop: 18, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
              <div style={{ fontWeight: 600, color: PRIMARY, marginBottom: 8 }}>
                引用位置（{(detail.refs || []).length}）
              </div>
              {(detail.refs || []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无引用：这张图片还没有被任何业务数据使用" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(detail.refs || []).map(ref => {
                    const isUpload = ref.field === 'upload';
                    return (
                      <div key={ref.key} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 10px', background: '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Tag color="geekblue">{ref.moduleLabel || ref.module}</Tag>
                          {ref.childLabel || ref.childKey ? <Tag>{ref.childLabel || ref.childKey}</Tag> : null}
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{ref.recordName || ref.recordKey}</span>
                          <Tag color="default">{ref.field}</Tag>
                          {!isUpload && ref.recordKey && (
                            <Button
                              type="link"
                              size="small"
                              icon={<ArrowRightOutlined />}
                              href={imageRefLink(ref)}
                              style={{ padding: 0 }}
                            >
                              前往
                            </Button>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          {isUpload ? '图片空间上传' : `记录ID：${ref.recordKey}`} · {fmtTime(ref.at)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
              <Button icon={<CopyOutlined />} onClick={() => void handleCopyLink(detail)}>复制链接</Button>
              <Popconfirm
                title={(detail.refs || []).length > 0 ? `该图片被 ${detail.refs!.length} 处引用，删除后这些位置会显示空图，确认删除？` : '确认删除这张图片？'}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(detail, (detail.refs || []).length > 0)}
              >
                <Button danger icon={<DeleteOutlined />}>删除图片</Button>
              </Popconfirm>
            </div>
          </div>
        )}
      </Drawer>

      {/* ============ 历史图片迁移 ============ */}
      <Modal
        open={migrateVisible}
        title={<span style={{ color: PRIMARY }}><DatabaseOutlined style={{ marginRight: 6 }} />迁移本机历史图片</span>}
        onCancel={() => { if (!migrating) setMigrateVisible(false); }}
        width={620}
        footer={[
          <Button key="cancel" disabled={migrating} onClick={() => setMigrateVisible(false)}>取消</Button>,
          <Button key="ok" type="primary" loading={migrating} onClick={doMigrate}>
            开始迁移（{localCandidates.length} 张）
          </Button>,
        ]}
      >
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p style={{ marginBottom: 8 }}>
            检测到本机还有 <b style={{ color: PRIMARY }}>{localCandidates.length}</b> 张图片只存在当前电脑上
            （旧版产品图 / 付款截图 / 模具图 / 发包订单图 / BOM款式图）。迁移后会：上传到云端图片空间、在图片详情里登记原来的归属位置，
            其他电脑登录同一账号即可直接看到这些图片。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
            <Card size="small" bodyStyle={{ padding: 10 }}>
              <Statistic title="产品图" value={localCandidates.filter(x => x.kind === 'product').length} valueStyle={{ fontSize: 18 }} />
            </Card>
            <Card size="small" bodyStyle={{ padding: 10 }}>
              <Statistic title="付款截图" value={localCandidates.filter(x => x.kind === 'payment').length} valueStyle={{ fontSize: 18 }} />
            </Card>
            <Card size="small" bodyStyle={{ padding: 10 }}>
              <Statistic title="模具图" value={localCandidates.filter(x => x.kind === 'mold').length} valueStyle={{ fontSize: 18 }} />
            </Card>
            <Card size="small" bodyStyle={{ padding: 10 }}>
              <Statistic title="发包订单图" value={localCandidates.filter(x => x.kind === 'market').length} valueStyle={{ fontSize: 18 }} />
            </Card>
            <Card size="small" bodyStyle={{ padding: 10 }}>
              <Statistic title="BOM/款式图" value={localCandidates.filter(x => x.kind === 'bom').length} valueStyle={{ fontSize: 18 }} />
            </Card>
          </div>
          <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
            {localCandidates.slice(0, 50).map(c => (
              <div key={c.storageKey} style={{ fontSize: 12, color: '#666', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                <span style={{ color: '#aaa', flexShrink: 0 }}>{fmtSize(c.size)}</span>
              </div>
            ))}
            {localCandidates.length > 50 && <div style={{ fontSize: 12, color: '#aaa' }}>…… 其余 {localCandidates.length - 50} 张</div>}
          </div>
          {migrating && (
            <div style={{ marginTop: 10 }}>
              <Progress percent={migrateDone} size="small" />
              <div style={{ fontSize: 12, color: '#8c8c8c' }}><CheckCircleOutlined /> 迁移过程中请勿关闭页面</div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 12, color: '#999' }}>
            说明：迁移不会删除本机原图，确认云端可见后可自行清理浏览器缓存。
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ImageSpacePage;
