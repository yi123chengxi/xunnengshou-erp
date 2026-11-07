import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  Table, Button, Space, Input, InputNumber, Modal, Form, Row, Col, Tag, message, Popconfirm, Tooltip, AutoComplete, Image as AntdImage, Select, Card,
} from 'antd';
import { reloadAfterPull } from '../utils/serverSync';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined, ToolOutlined, PictureOutlined, SnippetsOutlined,
  SettingOutlined, UndoOutlined, EyeOutlined,
} from '@ant-design/icons';
import { compressImageFile } from '../utils/imageCompress';
import { safeSetItem } from '../utils/storageQuota';
import useResizableColumns from '../hooks/useResizableColumns';
import FieldConfigModal from '../components/FieldConfigModal';

const PRIMARY = '#1e4a7e';

export interface MoldSpec {
  specName: string;
  quantity: number;
}

export interface MoldRecord {
  key: string;
  moldCode: string;
  moldName: string;
  spec: string;
  status: string;
  remark: string;
  creator: string;
  createdAt: string;
  images?: string[];
  specs?: MoldSpec[];
  totalQuantity?: number;
}

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (!isSub) return localStorage.getItem('username') || '';
  return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
};

const genKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const getDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u?.displayName || u?.contactPerson || u?.name) return u.displayName || u.contactPerson || u.name;
  } catch { /* ignore */ }
  return username || '未知';
};

const STATUS_OPTS = ['在用', '停用', '报废'];

const emptyRecord = (): MoldRecord => ({
  key: '', moldCode: '', moldName: '', spec: '', status: '在用', remark: '', creator: '', createdAt: '', images: [], specs: [{ specName: '', quantity: 1 }], totalQuantity: 0,
});

const MoldPage: React.FC = () => {
  const owner = getDataOwner();
  const storageKey = `molds_${owner}`;

  const [records, setRecords] = useState<MoldRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  });
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<MoldRecord | null>(null);
  const [form] = Form.useForm();
  const [moldImages, setMoldImages] = useState<string[]>([]);
  const [moldSpecs, setMoldSpecs] = useState<MoldSpec[]>([{ specName: '', quantity: 1 }]);
  const imgInputRef = useRef<HTMLInputElement>(null);
  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<MoldRecord | null>(null);

  // 模具租/售市场发布状态（全局键 market_mold_listings，同步事件刷新）
  const [moldListings, setMoldListings] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('market_mold_listings') || '[]'); } catch { return []; }
  });
  useEffect(() => {
    const reloadListings = () => {
      try { setMoldListings(JSON.parse(localStorage.getItem('market_mold_listings') || '[]')); } catch { /* ignore */ }
    };
    window.addEventListener('sync-data-updated', reloadListings);
    return () => window.removeEventListener('sync-data-updated', reloadListings);
  }, []);
  // moldKey -> 发布/成交状态（任一记录成交即视为成交，成交类型取该条 mode）
  const publishStatusMap = useMemo(() => {
    const map: Record<string, { dealt: boolean; mode: string }> = {};
    moldListings.forEach((l: any) => {
      if (!l || !l.moldKey) return;
      const cur = map[l.moldKey] || { dealt: false, mode: l.mode };
      if (l.dealt) { cur.dealt = true; cur.mode = l.mode; }
      map[l.moldKey] = cur;
    });
    return map;
  }, [moldListings]);

  // ===================== 字段显示控制 =====================
  const MOLD_ALL_FIELDS = [
    { key: 'image', label: '主图' },
    { key: 'moldCode', label: '模具编号' },
    { key: 'moldName', label: '模具名称' },
    { key: 'spec', label: '规格型号' },
    { key: 'totalQuantity', label: '模具数量' },
    { key: 'status', label: '状态' },
    { key: 'publishStatus', label: '发布状态' },
    { key: 'remark', label: '备注' },
    { key: 'creator', label: '创建人' },
    { key: 'createdAt', label: '创建时间' },
  ];
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`moldFieldOrder_${owner}`);
      if (saved) { const arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length) { MOLD_ALL_FIELDS.forEach(f => { if (!arr.includes(f.key)) arr.push(f.key); }); return arr; } }
    } catch { /* ignore */ }
    return MOLD_ALL_FIELDS.map(f => f.key);
  });
  const [fieldVis, setFieldVis] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(`moldFieldVis_${owner}`);
      if (saved) { const d = JSON.parse(saved); MOLD_ALL_FIELDS.forEach(f => { if (d[f.key] === undefined) d[f.key] = true; }); return d; }
    } catch { /* ignore */ }
    const def: Record<string, boolean> = {}; MOLD_ALL_FIELDS.forEach(f => { def[f.key] = true; }); return def;
  });
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const saveFieldConfig = useCallback((o: string[], v: Record<string, boolean>) => {
    try { localStorage.setItem(`moldFieldOrder_${owner}`, JSON.stringify(o)); localStorage.setItem(`moldFieldVis_${owner}`, JSON.stringify(v)); } catch { /* ignore */ }
  }, [owner]);

  // ===================== 多字段搜索 =====================
  const [searchFields, setSearchFields] = useState({ moldCode: '', moldName: '', spec: '', status: '', creator: '' });
  const [appliedSearch, setAppliedSearch] = useState({ moldCode: '', moldName: '', spec: '', status: '', creator: '' });
  const handleSearch = useCallback(() => {
    // 查询时自动刷新表单数据（本地+服务端拉取）
    reloadAfterPull(() => { try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { /* ignore */ } });
    setAppliedSearch({ ...searchFields });
  }, [searchFields, storageKey]);
  const handleReset = useCallback(() => {
    const empty = { moldCode: '', moldName: '', spec: '', status: '', creator: '' };
    setSearchFields(empty); setAppliedSearch(empty);
  }, []);

  // ===================== 列宽拖拽 =====================
  const { wrapColumns } = useResizableColumns<MoldRecord>(`colWidths_mold_${owner}`);

  const handleImageFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files) as File[];
    const newImgs: string[] = [];
    for (const f of arr) {
      try {
        const url = await compressImageFile(f);
        newImgs.push(url);
      } catch { /* skip */ }
    }
    if (newImgs.length) setMoldImages(prev => [...prev, ...newImgs]);
  };

  const pasteImage = async () => {
    try {
      const items: any[] = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = (it.types || []).find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const url = await compressImageFile(blob);
          setMoldImages(prev => [...prev, url]);
          message.success('已粘贴剪切板图片');
          return;
        }
      }
      message.warning('剪切板中未找到图片');
    } catch {
      message.warning('读取剪切板失败');
    }
  };

  const save = (list: MoldRecord[]) => {
    setRecords(list);
    safeSetItem(storageKey, JSON.stringify(list));
  };

  const reload = () => {
    try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { /* ignore */ }
  };

  const openAdd = () => {
    setEditing(null);
    form.setFieldsValue({ ...emptyRecord(), creator: getDisplayName() });
    setMoldImages([]);
    setMoldSpecs([{ specName: '', quantity: 1 }]);
    setVisible(true);
  };

  const openEdit = (r: MoldRecord) => {
    setEditing(r);
    form.setFieldsValue(r);
    setMoldImages(r.images || []);
    setMoldSpecs(r.specs && r.specs.length > 0 ? r.specs : [{ specName: r.spec || '', quantity: 1 }]);
    setVisible(true);
  };

  const handleSave = () => {
    form.validateFields().then(v => {
      const today = new Date().toISOString().slice(0, 10);
      const totalQuantity = moldSpecs.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
      const specStr = moldSpecs.filter(s => s.specName).map(s => s.specName).join('、');
      if (editing) {
        const rec = { ...editing, ...v, spec: specStr || v.spec, images: moldImages, specs: moldSpecs, totalQuantity };
        save(records.map(r => r.key === editing.key ? rec : r));
        message.success('模具信息已更新');
      } else {
        const rec: MoldRecord = { key: genKey('ML'), ...v, spec: specStr || v.spec, images: moldImages, specs: moldSpecs, totalQuantity, createdAt: today };
        save([rec, ...records]);
        message.success('模具已新增');
      }
      setVisible(false);
    });
  };

  const handleDelete = (key: string) => {
    save(records.filter(r => r.key !== key));
    message.success('已删除');
  };

  const handleExport = () => {
    const headers = ['模具编号', '模具名称', '规格型号', '模具数量', '状态', '备注', '创建人', '创建时间'];
    const rows = records.map(r => [r.moldCode, r.moldName, r.spec, r.totalQuantity || '', r.status, r.remark, r.creator, r.createdAt]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `模具列表_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    message.success('导出成功');
  };

  const filtered = useMemo(() => {
    const { moldCode, moldName, spec, status, creator } = appliedSearch;
    return records.filter(r => {
      if (moldCode && !(r.moldCode || '').toLowerCase().includes(moldCode.toLowerCase())) return false;
      if (moldName && !(r.moldName || '').toLowerCase().includes(moldName.toLowerCase())) return false;
      if (spec && !(r.spec || '').toLowerCase().includes(spec.toLowerCase())) return false;
      if (status && !(r.status || '').includes(status)) return false;
      if (creator && !(r.creator || '').toLowerCase().includes(creator.toLowerCase())) return false;
      return true;
    });
  }, [records, appliedSearch]);

  const baseCols: ColumnsType<MoldRecord> = [
    {
      title: '主图', dataIndex: 'images', key: 'image', width: 80, align: 'center',
      render: (imgs: string[] | undefined) => imgs && imgs.length > 0
        ? <AntdImage src={imgs[0]} width={50} height={50} style={{ objectFit: 'cover', borderRadius: 4 }} />
        : <span style={{ color: '#ccc' }}>无图</span>,
    },
    { title: '模具编号', dataIndex: 'moldCode', key: 'moldCode', width: 150, align: 'center',
      render: (v: string, r: MoldRecord) => v
        ? <a style={{ fontFamily: 'monospace', fontWeight: 600, color: PRIMARY }} onClick={() => { setDetailRecord(r); setDetailVisible(true); }}>{v}</a>
        : '—' },
    { title: '模具名称', dataIndex: 'moldName', key: 'moldName', width: 160, align: 'center', render: v => v || '—' },
    { title: '规格型号', dataIndex: 'spec', key: 'spec', width: 130, align: 'center', render: v => v || '—' },
    { title: '模具数量', dataIndex: 'totalQuantity', key: 'totalQuantity', width: 90, align: 'center',
      render: (v: number | undefined, r: MoldRecord) => {
        const total = v ?? (r.specs ? r.specs.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0) : 0);
        return total > 0 ? <strong style={{ color: PRIMARY }}>{total}</strong> : <span style={{ color: '#ccc' }}>—</span>;
      },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center',
      render: v => {
        const colors: Record<string, string> = { '在用': 'green', '停用': 'orange', '报废': 'red' };
        return <Tag color={colors[v] || 'default'}>{v || '—'}</Tag>;
      },
    },
    {
      title: '发布状态', key: 'publishStatus', width: 100, align: 'center',
      render: (_v, r) => {
        const st = publishStatusMap[r.key];
        if (!st) return <span style={{ color: '#ccc' }}>未发布</span>;
        if (st.dealt) return st.mode === 'rent'
          ? <Tag color="blue">已出租</Tag>
          : <Tag color="green">已出售</Tag>;
        return <Tag color="cyan">已发布</Tag>;
      },
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 140, align: 'center', ellipsis: true, render: v => v ? <Tooltip title={v}>{v}</Tooltip> : '—' },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, align: 'center', render: v => v || '—' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 110, align: 'center', render: v => v || '—' },
    {
      title: '操作', key: 'action', width: 140, align: 'center',
      render: (_v, r) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" icon={<EyeOutlined />} onClick={() => { setDetailRecord(r); setDetailVisible(true); }}>详情</Button>
        </Space>
      ),
    },
  ];

  // 按字段顺序和可见性过滤列
  const cols = useMemo(() => {
    const colMap: Record<string, any> = {};
    baseCols.forEach(c => { colMap[c.key as string] = c; });
    const configured = fieldOrder.filter(k => fieldVis[k] && colMap[k]).map(k => colMap[k]);
    // 操作列固定末尾展示，不参与字段显示配置
    return [...configured, colMap['action']];
  }, [fieldOrder, fieldVis, publishStatusMap]);

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #1e4a7e, #2f6fb5)', borderRadius: 12, padding: '14px 20px', marginBottom: 16, color: '#fff' }}>
        <div>
          <ToolOutlined style={{ fontSize: 22, marginRight: 10 }} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>模具管理</span>
          <span style={{ fontSize: 12, marginLeft: 12, opacity: 0.8 }}>共 {records.length} 个模具</span>
        </div>
      </div>

      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增模具</Button>
        <Button icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示字段</Button>
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        <Button onClick={handleExport}>导出CSV</Button>
      </Space>

      {/* 搜索栏 */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '10px 16px' }}>
        <Row gutter={[8, 8]} align="middle" onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}>
          <Col><Input placeholder="模具编号" style={{ width: 130 }} value={searchFields.moldCode} onChange={e => setSearchFields(p => ({ ...p, moldCode: e.target.value }))} allowClear /></Col>
          <Col><Input placeholder="模具名称" style={{ width: 130 }} value={searchFields.moldName} onChange={e => setSearchFields(p => ({ ...p, moldName: e.target.value }))} allowClear /></Col>
          <Col><Input placeholder="规格型号" style={{ width: 120 }} value={searchFields.spec} onChange={e => setSearchFields(p => ({ ...p, spec: e.target.value }))} allowClear /></Col>
          <Col>
            <Select placeholder="状态" style={{ width: 100 }} allowClear value={searchFields.status || undefined}
              onChange={v => setSearchFields(p => ({ ...p, status: v || '' }))} options={STATUS_OPTS.map(s => ({ value: s, label: s }))} />
          </Col>
          <Col><Input placeholder="创建人" style={{ width: 100 }} value={searchFields.creator} onChange={e => setSearchFields(p => ({ ...p, creator: e.target.value }))} allowClear /></Col>
          <Col>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} style={{ color: '#fff' }}>查询</Button>
              <Button icon={<UndoOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Table rowKey="key" size="small" bordered columns={wrapColumns(cols)} dataSource={filtered}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }} />

      {/* 字段显示控制弹窗 */}
      <FieldConfigModal
        open={fieldCfgVisible}
        fields={MOLD_ALL_FIELDS}
        order={fieldOrder}
        visibility={fieldVis}
        onCancel={() => setFieldCfgVisible(false)}
        onSave={(o, v) => { setFieldOrder(o); setFieldVis(v); saveFieldConfig(o, v); setFieldCfgVisible(false); message.success('已保存'); }}
      />

      <Modal title={editing ? '编辑模具' : '新增模具'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={560} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="moldCode" label="模具编号" rules={[{ required: true, message: '请输入模具编号' }]}>
                <Input placeholder="如 M854900" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="moldName" label="模具名称">
                <Input placeholder="模具名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <AutoComplete options={STATUS_OPTS.map(s => ({ value: s }))} placeholder="选择状态"
                  filterOption={(input, option) => String(option?.value || '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <div style={{ marginBottom: 8, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>规格与数量</span>
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => setMoldSpecs(prev => [...prev, { specName: '', quantity: 1 }])}>添加规格</Button>
              </div>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px', background: '#fafafa' }}>
                {moldSpecs.map((s, idx) => (
                  <Row key={idx} gutter={8} align="middle" style={{ marginBottom: idx < moldSpecs.length - 1 ? 8 : 0 }}>
                    <Col flex="auto">
                      <Input placeholder="规格型号" value={s.specName} onChange={e => { const next = [...moldSpecs]; next[idx] = { ...next[idx], specName: e.target.value }; setMoldSpecs(next); }} />
                    </Col>
                    <Col flex="100px">
                      <InputNumber placeholder="数量" min={0} value={s.quantity} style={{ width: '100%' }} onChange={v => { const next = [...moldSpecs]; next[idx] = { ...next[idx], quantity: v || 0 }; setMoldSpecs(next); }} />
                    </Col>
                    <Col flex="32px">
                      {moldSpecs.length > 1 && (
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => setMoldSpecs(prev => prev.filter((_, i) => i !== idx))} />
                      )}
                    </Col>
                  </Row>
                ))}
                <div style={{ textAlign: 'right', marginTop: 8, padding: '4px 0', borderTop: '1px solid #f0f0f0', fontSize: 13, color: '#666' }}>
                  模具数量总计：<strong style={{ color: PRIMARY, fontSize: 15 }}>{moldSpecs.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)}</strong>
                </div>
              </div>
            </Col>
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="备注信息" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="creator" label="创建人">
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={24}>
              <div style={{ marginBottom: 8, fontSize: 14 }}>图片</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px dashed #d9d9d9', borderRadius: 8, background: '#fafafa', minHeight: 90, alignItems: 'flex-start' }}>
                {moldImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: 72, height: 72 }}>
                    <AntdImage src={img} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
                    <Button size="small" type="text" danger icon={<DeleteOutlined />}
                      style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)', width: 22, height: 22, padding: 0 }}
                      onClick={() => setMoldImages(prev => prev.filter((_, i) => i !== idx))} />
                  </div>
                ))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <Button icon={<PictureOutlined />} onClick={() => imgInputRef.current?.click()}>上传图片</Button>
                  <Button icon={<SnippetsOutlined />} onClick={pasteImage}>粘贴</Button>
                </div>
                <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.length) { handleImageFiles(e.target.files); e.target.value = ''; } }} />
              </div>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title="模具详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={<Button onClick={() => setDetailVisible(false)}>关闭</Button>}
        width={600}
        destroyOnClose
      >
        {detailRecord && (
          <div>
            {/* 图片展示 */}
            {detailRecord.images && detailRecord.images.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <AntdImage.PreviewGroup>
                  <Row gutter={[8, 8]}>
                    {detailRecord.images.map((img, idx) => (
                      <Col key={idx}>
                        <AntdImage src={img} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
                      </Col>
                    ))}
                  </Row>
                </AntdImage.PreviewGroup>
              </div>
            )}
            {/* 信息展示 */}
            <Row gutter={[16, 12]}>
              <Col span={12}><span style={{ color: '#999' }}>模具编号：</span><strong style={{ color: PRIMARY, fontFamily: 'monospace' }}>{detailRecord.moldCode}</strong></Col>
              <Col span={12}><span style={{ color: '#999' }}>模具名称：</span><span>{detailRecord.moldName || '—'}</span></Col>
              <Col span={12}><span style={{ color: '#999' }}>规格型号：</span><span>{detailRecord.spec || '—'}</span></Col>
              <Col span={12}>
                <span style={{ color: '#999' }}>状态：</span>
                {(() => {
                  const colors: Record<string, string> = { '在用': 'green', '停用': 'orange', '报废': 'red' };
                  return <Tag color={colors[detailRecord.status] || 'default'}>{detailRecord.status || '—'}</Tag>;
                })()}
              </Col>
              {/* 规格与数量明细 */}
              {detailRecord.specs && detailRecord.specs.length > 0 && detailRecord.specs.some(s => s.specName) && (
                <Col span={24}>
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>规格明细与数量：</div>
                    <Table
                      size="small"
                      bordered
                      pagination={false}
                      rowKey={(s: any, idx?: number) => `${s.specName}-${idx}`}
                      dataSource={detailRecord.specs.filter(s => s.specName)}
                      columns={[
                        { title: '规格型号', dataIndex: 'specName', key: 'specName', align: 'center' as const },
                        { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 120, align: 'center' as const, render: (v: number) => <span style={{ color: PRIMARY, fontWeight: 500 }}>× {v}</span> },
                      ]}
                      summary={() => (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0}><div style={{ textAlign: 'right' }}>模具数量总计：</div></Table.Summary.Cell>
                          <Table.Summary.Cell index={1}><strong style={{ color: PRIMARY, fontSize: 15 }}>{detailRecord.totalQuantity ?? (detailRecord.specs || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0)}</strong></Table.Summary.Cell>
                        </Table.Summary.Row>
                      )}
                    />
                  </div>
                </Col>
              )}
              <Col span={24}><span style={{ color: '#999' }}>备注：</span><span>{detailRecord.remark || '—'}</span></Col>
              <Col span={12}><span style={{ color: '#999' }}>创建人：</span><span>{detailRecord.creator || '—'}</span></Col>
              <Col span={12}><span style={{ color: '#999' }}>创建时间：</span><span>{detailRecord.createdAt || '—'}</span></Col>
            </Row>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default MoldPage;
