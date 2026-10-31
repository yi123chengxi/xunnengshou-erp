import React, { useState, useEffect } from 'react';
import {
  Card, Row, Col, Typography, Button, Space, Tag, Input, Modal, message, Empty,
  Alert, Popconfirm, Select, Divider,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, UpOutlined, DownOutlined,
  SaveOutlined, CloseOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { saveDataset } from '../../utils/dataStore';

const { Title, Text } = Typography;
const { TextArea } = Input;

// 统一蓝色系（与定制单 / 目标软件一致）
const PRIMARY = '#1e4a7e';
const PRIMARY_LIGHT = '#e8f4fc';
const BG_GRADIENT = 'linear-gradient(180deg, #f0f7ff 0%, #e8f0f9 100%)';

// ============================================================
// 类型定义（与 CustomOrderPage 完全一致，保证数据互通）
// ============================================================
type WorkflowNode = {
  name: string;
  icon: string;
  description?: string;
  estimatedDays?: number;
  requireLogisticsReceipt?: boolean;
};

type WorkflowTemplate = {
  id: string;
  name: string;
  industry: string;
  nodes: WorkflowNode[];
  isDefault?: boolean; // 系统预设
};

// 行业预设模板（首次进入无模板时自动种子）
export const INDUSTRY_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'preset-clothing', name: '服装定制', industry: '服装', isDefault: true,
    nodes: [
      { name: '接单确认', icon: '📋', description: '确认订单信息和客户需求' },
      { name: '面料采购', icon: '🧵', description: '采购面料和辅料' },
      { name: '打版裁剪', icon: '✂️', description: '制版、排版、裁剪' },
      { name: '缝制加工', icon: '🪡', description: '车缝、熨烫、整形' },
      { name: '质量检验', icon: '🔍', description: '成品质量检查' },
      { name: '包装发货', icon: '📦', description: '包装、贴标、发货', requireLogisticsReceipt: true },
    ],
  },
  {
    id: 'preset-furniture', name: '家具定制', industry: '家具', isDefault: true,
    nodes: [
      { name: '设计方案', icon: '📐', description: '确认设计方案和尺寸' },
      { name: '材料采购', icon: '🪵', description: '采购木材和五金配件' },
      { name: '木工加工', icon: '🔨', description: '切割、打磨、组装' },
      { name: '表面处理', icon: '🎨', description: '上漆、贴皮、抛光' },
      { name: '质量检验', icon: '🔍', description: '成品检查和功能测试' },
      { name: '物流配送', icon: '🚚', description: '包装、配送、安装', requireLogisticsReceipt: true },
    ],
  },
  {
    id: 'preset-electronics', name: '电子产品定制', industry: '电子', isDefault: true,
    nodes: [
      { name: '需求确认', icon: '📋', description: '确认产品规格和功能需求' },
      { name: 'PCB设计', icon: '💻', description: '电路设计和PCB布线' },
      { name: '元器件采购', icon: '🔌', description: '采购芯片和电子元器件' },
      { name: 'SMT贴片', icon: '⚙️', description: 'SMT贴片和焊接' },
      { name: '组装测试', icon: '🧪', description: '整机组装和功能测试' },
      { name: '质检包装', icon: '📦', description: '最终质检和包装发货', requireLogisticsReceipt: true },
    ],
  },
  {
    id: 'preset-system', name: '系统默认流程', industry: '系统默认', isDefault: true,
    nodes: [
      { name: '接单审核', icon: '📋', description: '审核订单信息' },
      { name: '物料准备', icon: '📦', description: '准备生产物料' },
      { name: '生产加工', icon: '⚙️', description: '产品加工制造' },
      { name: '质量检测', icon: '🔍', description: '成品质量检验' },
      { name: '包装发货', icon: '🚚', description: '包装并安排发货', requireLogisticsReceipt: true },
    ],
  },
];

// 生成唯一ID
function cuid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// 数据归属（与定制单 / 目标软件一致：子账号归属父账号）
function getDataOwner(): string {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  const owner = isSub
    ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || 'admin')
    : (localStorage.getItem('username') || 'admin');
  return owner;
}

// 存储键（与 CustomOrderPage 完全一致，保证定制单可选用此处维护的模板）
const tplKeyFor = (owner: string) => `pageData_production_custom-order-templates_${owner}`;
const defaultTplKeyFor = (owner: string) => `pageData_production_custom-order-default_${owner}`;

// ============================================================
// 主组件
// ============================================================
const WorkflowTemplatePage: React.FC = () => {
  const [owner] = useState<string>(() => getDataOwner());
  const tplKey = tplKeyFor(owner);
  const defaultTplKey = defaultTplKeyFor(owner);

  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [companyDefault, setCompanyDefault] = useState<string>('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // 编辑 / 新建表单状态
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editIndustry, setEditIndustry] = useState('');
  const [editNodes, setEditNodes] = useState<WorkflowNode[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const [messageApi, contextHolder] = message.useMessage();

  function persist(next: WorkflowTemplate[]) {
    setTemplates(next);
    try { localStorage.setItem(tplKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // ============================================================
  // 模板变更保护：修改/删除模板或切换公司默认时，把当前（变更前）模板节点快照为
  // 已引用该模板的存量订单的自定义节点，保证变更只影响新订单，不改变已有订单流程节点
  // ============================================================
  function writeDataset(key: string, list: any[]) {
    const json = JSON.stringify(list);
    try {
      localStorage.setItem(key, json);
      localStorage.setItem(`${key}_ts`, String(Date.now()));
      saveDataset(key, json);
    } catch { /* ignore */ }
  }

  // 当前生效的公司默认模板 id（与生产订单卡片视图的解析逻辑一致）
  function currentEffectiveDefaultId(): string {
    let defId = '';
    try { defId = localStorage.getItem(defaultTplKey) || ''; } catch { /* ignore */ }
    const eff = templates.length > 0 ? templates : INDUSTRY_TEMPLATES;
    if (!defId || !eff.some(t => t.id === defId)) {
      const d = eff.find(t => t.id === 'preset-system') || eff.find(t => t.isDefault) || eff[0];
      defId = d ? d.id : '';
    }
    return defId;
  }

  function snapshotTemplateToExistingOrders(templateId: string, oldNodes: WorkflowNode[], onlyDefaultBound = false): number {
    if (!templateId || !Array.isArray(oldNodes) || oldNodes.length === 0) return 0;
    const copyNodes = () => oldNodes.map(n => ({ ...n }));
    let count = 0;
    // 1) 定制单：引用该模板且尚未有自定义节点的订单 → 快照旧节点
    if (!onlyDefaultBound) {
      const coKey = `pageData_production_custom-order_${owner}`;
      try {
        const raw = localStorage.getItem(coKey);
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr) && arr.length > 0) {
          let changed = false;
          const next = arr.map((o: any) => {
            if (o && o.templateId === templateId && (!Array.isArray(o.customNodes) || o.customNodes.length === 0)) {
              changed = true; count++;
              return { ...o, customNodes: copyNodes() };
            }
            return o;
          });
          if (changed) writeDataset(coKey, next);
        }
      } catch { /* ignore */ }
    }
    // 2) 生产订单：卡片视图流程状态存于 record.wf，生效模板 = wf.templateId > 公司默认
    const poKey = `pageData_production_production-order_${owner}`;
    try {
      const raw = localStorage.getItem(poKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr) && arr.length > 0) {
        const defId = currentEffectiveDefaultId();
        let changed = false;
        const next = arr.map((r: any) => {
          if (!r) return r;
          const wf = r.wf && typeof r.wf === 'object' ? r.wf : {};
          const boundByDefault = onlyDefaultBound ? (wf.templateId == null) : true;
          const effId = wf.templateId ?? defId;
          if (boundByDefault && effId === templateId && (!Array.isArray(wf.customNodes) || wf.customNodes.length === 0)) {
            changed = true; count++;
            return { ...r, wf: { ...wf, customNodes: copyNodes() } };
          }
          return r;
        });
        if (changed) writeDataset(poKey, next);
      }
    } catch { /* ignore */ }
    return count;
  }

  // 加载数据：无模板时种子行业预设
  const loadData = () => {
    setLoading(true);
    try {
      const saved = localStorage.getItem(tplKey);
      let arr: WorkflowTemplate[] = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(arr) || arr.length === 0) {
        arr = INDUSTRY_TEMPLATES.map(t => ({ ...t, nodes: t.nodes.map(n => ({ ...n })) }));
        localStorage.setItem(tplKey, JSON.stringify(arr));
      }
      setTemplates(arr);
      setIndustries(Array.from(new Set([...arr.map(t => t.industry), '服装', '家具', '电子', '系统默认', '通用'])));
      setCompanyDefault(localStorage.getItem(defaultTplKey) || '');
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const onFocus = () => loadData();
    const onVisibility = () => { if (!document.hidden) loadData(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tplKey]);

  // 打开编辑
  function openEdit(t: WorkflowTemplate) {
    setEditing(t);
    setEditName(t.name);
    setEditIndustry(t.industry);
    setEditNodes(t.nodes.map(n => ({ ...n })));
  }

  // 打开新建
  function openAdd() {
    setEditing(null);
    setEditName('');
    setEditIndustry('通用');
    setEditNodes([{ name: '新节点', icon: '📋', description: '' }]);
    setShowAdd(true);
  }

  function closeForm() {
    setEditing(null);
    setShowAdd(false);
  }

  function addNode() {
    setEditNodes([...editNodes, { name: '新节点', icon: '📋', description: '' }]);
  }

  function removeNode(idx: number) {
    setEditNodes(editNodes.filter((_, i) => i !== idx));
  }

  function updateNode(idx: number, field: keyof WorkflowNode, value: string) {
    const next = [...editNodes];
    (next[idx] as any)[field] = value;
    setEditNodes(next);
  }

  function updateNodeDays(idx: number, val: number | undefined) {
    const next = [...editNodes];
    next[idx] = { ...next[idx], estimatedDays: val };
    setEditNodes(next);
  }

  function moveNode(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editNodes.length) return;
    const next = [...editNodes];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setEditNodes(next);
  }

  // 保存（新建或编辑）
  function save() {
    if (!editName.trim()) { messageApi.warning('请输入模板名称'); return; }
    if (editNodes.length === 0) { messageApi.warning('至少需要一个节点'); return; }

    // 最后一个节点强制设置“必须上传物流底单”标记
    const nodesToSave = editNodes.map((n, i) => ({
      ...n,
      requireLogisticsReceipt: i === editNodes.length - 1 ? true : undefined,
    }));

    if (editing) {
      // 先对存量订单快照变更前的流程节点：模板修改只影响新订单，不改变已有订单流程
      const oldTpl = templates.find(t => t.id === editing.id);
      let snapCount = 0;
      if (oldTpl && JSON.stringify(oldTpl.nodes) !== JSON.stringify(nodesToSave)) {
        snapCount = snapshotTemplateToExistingOrders(editing.id, oldTpl.nodes);
      }
      const next = templates.map(t => t.id === editing.id ? { ...t, name: editName.trim(), industry: editIndustry.trim(), nodes: nodesToSave } : t);
      persist(next);
      messageApi.success(snapCount > 0 ? `模板已保存，${snapCount} 个存量订单保留原流程，新订单将使用新模板` : '模板已保存');
    } else {
      const tpl: WorkflowTemplate = {
        id: cuid(),
        name: editName.trim(),
        industry: editIndustry.trim() || '通用',
        nodes: nodesToSave,
      };
      persist([...templates, tpl]);
      messageApi.success('模板已创建');
    }
    closeForm();
  }

  function setAsCompanyDefault(id: string) {
    // 切换默认前：把旧默认模板节点快照到尚未绑定模板的存量生产订单，保证切换默认不改变已有订单流程
    const oldDefId = currentEffectiveDefaultId();
    if (oldDefId && oldDefId !== id) {
      const oldTpl = templates.find(t => t.id === oldDefId);
      if (oldTpl) snapshotTemplateToExistingOrders(oldDefId, oldTpl.nodes, true);
    }
    setCompanyDefault(id);
    localStorage.setItem(defaultTplKey, id);
    const tpl = templates.find(t => t.id === id);
    messageApi.success(`已将「${tpl?.name || ''}」设为公司默认`);
  }

  function deleteTemplate(id: string) {
    // 删除前快照：引用该模板的存量订单保留当前流程，避免删除后回退到默认模板导致流程变化
    const tpl = templates.find(t => t.id === id);
    if (tpl) snapshotTemplateToExistingOrders(id, tpl.nodes);
    persist(templates.filter(t => t.id !== id));
    if (companyDefault === id) { setCompanyDefault(''); localStorage.removeItem(defaultTplKey); }
    messageApi.success('模板已删除');
  }

  const showForm = !!editing || showAdd;

  return (
    <div style={{ background: BG_GRADIENT, minHeight: '100vh', padding: 16 }}>
      {contextHolder}

      {/* 顶部标题栏 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={4} style={{ margin: 0, color: PRIMARY }}>生产流程模板管理</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>配置生产流程模板，创建定制单时可按行业选用</Text>
          </div>
          <Button type="primary" icon={<PlusOutlined />} style={{ background: PRIMARY }} onClick={openAdd}>
            新建模板
          </Button>
        </div>
      </Card>

      {/* 使用说明 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, background: PRIMARY_LIGHT, borderColor: '#c5dcf2', borderRadius: 8 }}
        message={
          <div style={{ fontSize: 13, color: '#0f3460', lineHeight: 1.8 }}>
            <div>1. 系统已预设服装、家具、电子行业的默认模板，可直接使用或在此基础上自定义；</div>
            <div>2. 每个模板包含一组生产节点，创建定制单选择模板后即可按节点推进生产进度；</div>
            <div>3. 点击「设为公司默认」可将该模板设为创建定制单时自动使用的默认流程。</div>
          </div>
        }
      />

      {loading ? (
        <Card><div style={{ textAlign: 'center', color: '#8b9db5', padding: '24px 0' }}>加载中...</div></Card>
      ) : templates.length === 0 ? (
        <Card><Empty description="暂无模板，点击右上角新建" /></Card>
      ) : (
        <Row gutter={[16, 16]}>
          {templates.map(t => {
            const nodeCount = t.nodes?.length || 0;
            return (
              <Col xs={24} sm={12} lg={8} xl={6} key={t.id}>
                <Card
                  size="small"
                  hoverable
                  style={{ borderRadius: 8, borderColor: companyDefault === t.id ? PRIMARY : '#d9e6f2', height: '100%' }}
                  styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text strong style={{ color: '#1f2d3d', fontSize: 15 }}>{t.name}</Text>
                    <Space size={4}>
                      {companyDefault === t.id && (
                        <Tag color="green" style={{ marginRight: 0 }}>公司默认</Tag>
                      )}
                      <Tag style={{ marginRight: 0, background: '#f0f2f5', border: 'none', color: '#666' }}>{t.industry}</Tag>
                    </Space>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
                    {nodeCount} 个生产节点{t.isDefault ? ' · 系统预设' : ''}
                  </Text>
                  {/* 节点预览 */}
                  <div style={{ flex: 1, marginBottom: 12 }}>
                    {t.nodes.slice(0, 4).map((n, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                        <span style={{ fontSize: 13 }}>{n.icon}</span>
                        <span style={{ fontSize: 12, color: '#4a5a6a' }}>{n.name}</span>
                        {n.estimatedDays ? (
                          <Tag style={{ marginLeft: 'auto', fontSize: 11, background: '#fff7e6', border: '1px solid #ffe58f', color: '#d48806' }}>
                            {n.estimatedDays}天
                          </Tag>
                        ) : null}
                      </div>
                    ))}
                    {nodeCount > 4 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>… 等 {nodeCount} 个节点</Text>
                    )}
                  </div>
                  {/* 操作 */}
                  <Space style={{ width: '100%' }} wrap>
                    {companyDefault !== t.id && (
                      <Button size="small" style={{ color: '#389e0d', borderColor: '#b7eb8f' }} onClick={() => setAsCompanyDefault(t.id)}>
                        设为公司默认
                      </Button>
                    )}
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(t)}>编辑</Button>
                    {!t.isDefault && (
                      <Popconfirm title="确定删除此模板？" onConfirm={() => deleteTemplate(t.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 新建 / 编辑弹窗 */}
      <Modal
        title={<span><SaveOutlined style={{ color: PRIMARY, marginRight: 8 }} />{editing ? '编辑模板' : '新建模板'}</span>}
        open={showForm}
        onCancel={closeForm}
        onOk={save}
        okText="保存"
        cancelText="取消"
        width={720}
        okButtonProps={{ style: { background: PRIMARY, borderColor: PRIMARY } }}
        destroyOnClose
      >
        <Row gutter={16}>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 13, color: '#666' }}>模板名称</div>
            <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="如：服装定制" />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontSize: 13, color: '#666' }}>所属行业</div>
            <Select
              style={{ width: '100%' }}
              value={editIndustry}
              onChange={setEditIndustry}
              placeholder="选择或输入行业"
              showSearch
              allowClear
              options={industries.map(i => ({ value: i, label: i }))}
              onSearch={v => v && setEditIndustry(v)}
            />
          </Col>
        </Row>

        <Divider style={{ margin: '16px 0 12px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text strong style={{ color: '#1f2d3d' }}>生产节点</Text>
          <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: PRIMARY, borderColor: PRIMARY, color: '#fff' }} onClick={addNode}>
            添加节点
          </Button>
        </div>

        <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
          {editNodes.map((node, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fafbfc', border: '1px solid #eef2f6', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              {/* 排序按钮 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                <Button size="small" type="text" icon={<UpOutlined />} disabled={i === 0} onClick={() => moveNode(i, -1)} />
                <Button size="small" type="text" icon={<DownOutlined />} disabled={i === editNodes.length - 1} onClick={() => moveNode(i, 1)} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <Input
                    value={node.icon}
                    onChange={e => updateNode(i, 'icon', e.target.value)}
                    style={{ width: 64, textAlign: 'center' }}
                    placeholder="图标"
                  />
                  <Input
                    value={node.name}
                    onChange={e => updateNode(i, 'name', e.target.value)}
                    placeholder="节点名称"
                    style={{ flex: 1, minWidth: 120 }}
                  />
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={node.estimatedDays ?? ''}
                    onChange={e => {
                      const v = e.target.value;
                      updateNodeDays(i, v === '' ? undefined : Number(v));
                    }}
                    style={{ width: 110, flexShrink: 0 }}
                    placeholder="预计用时"
                    title="预计用时（天），留空表示不限制"
                    addonAfter="天"
                  />
                </div>
                <TextArea
                  value={node.description}
                  onChange={e => updateNode(i, 'description', e.target.value)}
                  placeholder="节点描述（可选）"
                  autoSize={{ minRows: 1, maxRows: 2 }}
                  style={{ fontSize: 13 }}
                />
                {i === editNodes.length - 1 && (
                  <div style={{ marginTop: 6, background: '#fff7e6', border: '1px solid #ffe58f', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#d48806' }}>
                    📦 此节点为最后一步，完成时必须上传物流底单，否则无法完成全部流程
                  </div>
                )}
              </div>
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                style={{ marginTop: 4 }}
                onClick={() => removeNode(i)}
              />
            </div>
          ))}
          {editNodes.length === 0 && (
            <Empty description="暂无节点，点击上方添加" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '12px 0' }} />
          )}
        </div>
      </Modal>
    </div>
  );
};

export default WorkflowTemplatePage;
