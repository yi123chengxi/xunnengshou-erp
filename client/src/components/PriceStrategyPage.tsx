/**
 * 采购价设置（客户采购价策略管理页）
 * 形态参照分销价策略列表：优先级说明条 + 三模式页签(低/中/高) + 筛选条 + 工具栏 + 策略列表 + 编辑弹窗(含商品明细行级规则)
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Card, Tabs, Tag, Table, Button, Space, Input, InputNumber, Select, Switch, Radio, Modal,
  message, Popconfirm, Tooltip, Typography, DatePicker, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SettingOutlined, CopyOutlined, EditOutlined, SearchOutlined, RedoOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { getDataOwner } from '../utils/brandAuth';
import { getCurrentUserDisplayName } from '../utils/billLog';
import { readProductListSync } from '../utils/dataStore';
import { loadAllCustomersFromStorage } from '../pages/CustomerInfo';
import {
  PriceStrategy, StrategyMode, PriceRule, StrategyItem, PriceRoundSettings,
  loadStrategies, saveStrategies, loadRoundSettings, saveRoundSettings,
  ruleText, strategyStatus, isStrategyActive, computeRulePrice, roundPrice, findConflicts,
  STRATEGY_MODE_LABEL, PRICE_MODE_LABEL,
} from '../utils/priceStrategy';
import { canFn, usePermTick } from '../utils/perm';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const TIME_FMT = 'YYYY-MM-DD HH:mm:ss';
const GRADE_LABEL = (v: string) => (v === 'vip' ? 'VIP' : v ? `${v}级` : v);
const GRADE_ORDER = ['vip', 'A', 'B', 'C'];
const GRADE_TAG_COLOR = (v: string) => (v === 'vip' ? 'gold' : v === 'A' ? 'blue' : 'green');

const emptyDraft = (): PriceStrategy => ({
  id: '', name: '', mode: 'customer', priority: 10, grades: [], customers: [], items: [],
  rule: { mode: 'sale_sub', value: 0 }, effectiveStart: '', effectiveEnd: '',
  enabled: true, applyScope: 'all', remark: '',
});

const PriceStrategyPage: React.FC = () => {
  const owner = getDataOwner();
  // PERM_V2 功能点执行点（采购价设置页）
  const permTick = usePermTick();
  const fnOk = (a: string) => canFn('supplier', 'customer/price-strategy', a);
  // 客户列表“价格策略”按钮跳转带入 ?customer=<编码>
  const [searchParams] = useSearchParams();
  const focusCustomer = searchParams.get('customer') || '';
  const [strategies, setStrategies] = useState<PriceStrategy[]>([]);
  const reload = useCallback(() => setStrategies(loadStrategies(owner)), [owner]);
  useEffect(() => { reload(); }, [reload]);

  const [modeTab, setModeTab] = useState<'all' | StrategyMode>('all');
  // 筛选：draft=录入态，applied=点击搜索后生效
  const emptyFilters = () => ({ name: '', valid: 'all', productCode: '', styleCode: '', priceMin: '' as string | number, priceMax: '' as string | number, customerText: '', customerName: '' });
  const [fDraft, setFDraft] = useState(emptyFilters);
  const [fApplied, setFApplied] = useState(emptyFilters);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [editVisible, setEditVisible] = useState(false);
  const [draft, setDraft] = useState<PriceStrategy>(emptyDraft());
  const [batchVisible, setBatchVisible] = useState(false);
  const [batchCodes, setBatchCodes] = useState<string[]>([]);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchRule, setBatchRule] = useState<PriceRule>({ mode: 'fixed', value: 0 });
  // 编辑弹窗商品明细：勾选批量改价 + 搜索
  const [itemChecked, setItemChecked] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemBatchRule, setItemBatchRule] = useState<PriceRule>({ mode: 'fixed', value: 0 });
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settings, setSettings] = useState<PriceRoundSettings>({ rounding: 'd2', floorCost: false });

  const customers = useMemo(() => loadAllCustomersFromStorage(), []);
  const customerOptions = useMemo(() => customers.map((c: any) => ({
    value: c.id || c.name, label: `${c.name || ''}${c.id ? `（${c.id}）` : ''}`, name: c.name || '', code: c.id || '',
  })), [customers]);
  const gradeOptions = useMemo(() => {
    const set = new Set<string>(['A', 'B', 'C', 'vip']);
    customers.forEach((c: any) => { if (c.level) set.add(c.level); });
    return Array.from(set).map(v => ({ value: v, label: GRADE_LABEL(v) }));
  }, [customers]);
  const products = useMemo(() => readProductListSync(owner), [owner]);

  // ============ 按客户等级矩阵（等级页签专用：全等级行 + 每等级一条统一规则） ============
  const gradeRows = useMemo(() => {
    const vals = Array.from(new Set([...GRADE_ORDER, ...gradeOptions.map(o => o.value)]));
    return vals.sort((a, b) => {
      const ia = GRADE_ORDER.indexOf(a); const ib = GRADE_ORDER.indexOf(b);
      return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || a.localeCompare(b);
    });
  }, [gradeOptions]);
  const [gradeDraft, setGradeDraft] = useState<Record<string, { rule: PriceRule; enabled: boolean } | null>>({});
  useEffect(() => {
    const init: Record<string, { rule: PriceRule; enabled: boolean } | null> = {};
    gradeRows.forEach(g => {
      const s = strategies.find(x => x.mode === 'grade' && (x.grades || []).includes(g));
      init[g] = s ? { rule: { ...s.rule }, enabled: s.enabled } : null;
    });
    setGradeDraft(init);
  }, [gradeRows, strategies]);
  const gradeExisting = useCallback((g: string) => strategies.some(s => s.mode === 'grade' && (s.grades || []).includes(g)), [strategies]);

  const saveGrade = (g: string) => {
    const d = gradeDraft[g];
    if (!d) { message.warning('请先设置价格规则'); return; }
    const now = dayjs().format(TIME_FMT);
    const who = getCurrentUserDisplayName();
    // 拆分语义：该等级从其他多等级策略中移除（移空则删），矩阵每等级唯一一条策略
    let list = loadStrategies(owner)
      .map(s => (s.mode === 'grade' && (s.grades || []).includes(g) ? { ...s, grades: (s.grades || []).filter(x => x !== g) } : s))
      .filter(s => s.mode !== 'grade' || (s.grades || []).length);
    const exist = list.find(s => s.mode === 'grade' && (s.grades || []).length === 1 && s.grades[0] === g);
    if (exist) {
      list = list.map(s => (s.id === exist.id ? { ...s, rule: { ...d.rule }, enabled: d.enabled, modifier: who, updatedAt: now } : s));
    } else {
      list.push({
        ...emptyDraft(), id: `ps${Date.now()}`, name: `等级价-${GRADE_LABEL(g)}`, mode: 'grade', grades: [g],
        priority: 900, rule: { ...d.rule }, enabled: d.enabled, applyScope: 'all',
        creator: who, createdAt: now, modifier: who, updatedAt: now,
      });
    }
    persist(list);
    message.success(`等级 ${GRADE_LABEL(g)} 采购价规则已保存`);
  };

  const clearGrade = (g: string) => {
    const list = loadStrategies(owner)
      .map(s => (s.mode === 'grade' && (s.grades || []).includes(g) ? { ...s, grades: (s.grades || []).filter(x => x !== g) } : s))
      .filter(s => s.mode !== 'grade' || (s.grades || []).length);
    persist(list);
    message.success(`等级 ${GRADE_LABEL(g)} 采购价规则已清除`);
  };
  const productOptions = useMemo(() => products.map((p: any) => ({
    value: p.productCode || '', label: `${p.productCode || ''} ${p.shortName || p.name || ''}`.trim(),
    productName: p.shortName || p.name || '', styleCode: p.styleCode || '',
  })).filter(o => o.value), [products]);
  const productByCode = useMemo(() => {
    const m = new Map<string, any>();
    products.forEach((p: any) => { if (p.productCode) m.set(p.productCode, p); });
    return m;
  }, [products]);
  // 批量弹窗商品列表：按搜索词过滤（编码/名称/简称/款式编码）
  const batchProducts = useMemo(() => {
    const t = batchSearch.trim();
    const list = products.filter((p: any) => p.productCode);
    if (!t) return list;
    return list.filter((p: any) =>
      String(p.productCode || '').includes(t) || String(p.name || '').includes(t) ||
      String(p.shortName || '').includes(t) || String(p.styleCode || '').includes(t));
  }, [products, batchSearch]);

  // 跳转聚焦：客户列表“价格策略”按钮带入客户编码/名称
  useEffect(() => {
    if (!focusCustomer) return;
    const hit = customers.find((c: any) => c.id === focusCustomer || c.name === focusCustomer);
    const text = hit ? (hit.name || hit.id) : focusCustomer;
    setFDraft(f => ({ ...f, customerText: text }));
    setFApplied(f => ({ ...f, customerText: text }));
  }, [focusCustomer]);

  const previewPrice = useCallback((s: PriceStrategy, productCode: string): number | null => {
    const prod = productByCode.get(productCode);
    if (!prod) return null;
    if (s.mode === 'customer_product' && !(s.items || []).some(i => i.productCode === productCode)) return null;
    if (s.mode === 'grade' || s.mode === 'customer') { /* 全商品策略可预览 */ }
    const rule = (s.items || []).find(i => i.productCode === productCode)?.rule || s.rule;
    const st = loadRoundSettings(owner);
    let p = roundPrice(computeRulePrice(rule, prod), st);
    if (st.floorCost) { const c = Number(prod.costPrice) || 0; if (p < c) p = roundPrice(c, st); }
    return p;
  }, [owner, productByCode]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const f = fApplied;
    const hasRange = f.priceMin !== '' || f.priceMax !== '';
    const list = strategies.filter(s => {
      if (modeTab !== 'all' && s.mode !== modeTab) return false;
      if (f.name && !(s.name || '').includes(f.name.trim())) return false;
      if (f.valid === 'valid' && !isStrategyActive(s, now)) return false;
      if (f.valid === 'invalid' && isStrategyActive(s, now)) return false;
      if (f.customerText) {
        const t = f.customerText.trim();
        const hit = (s.customers || []).some(c => (c.name || '').includes(t) || (c.code || '').includes(t));
        if (!hit) return false;
      }
      // 客户名称：快速搜索该客户拥有的策略（直接指定的采购商策略 + 其客户等级命中的等级策略）
      if (f.customerName) {
        const t = f.customerName.trim();
        const cust = customers.find((c: any) => (c.name || '') === t)
          || customers.find((c: any) => (c.name || '').includes(t) || (c.id || '') === t);
        const hitDirect = (s.customers || []).some(c => (c.name || '').includes(t) || (c.code || '').includes(t));
        const hitGrade = !!cust && !!cust.level && s.mode === 'grade' && (s.grades || []).includes(cust.level);
        if (!hitDirect && !hitGrade) return false;
      }
      if (f.productCode) {
        const t = f.productCode.trim();
        const hit = s.mode !== 'customer_product' || (s.items || []).some(i => (i.productCode || '').includes(t));
        if (!hit) return false;
      }
      if (f.styleCode) {
        const t = f.styleCode.trim();
        const hit = s.mode !== 'customer_product' || (s.items || []).some(i => {
          const sc = i.styleCode || productByCode.get(i.productCode)?.styleCode || '';
          return String(sc).includes(t);
        });
        if (!hit) return false;
      }
      if (hasRange) {
        const code = String(f.productCode || '').trim();
        if (!code) return true; // 价格区间需配合商品编码使用
        const p = previewPrice(s, code);
        if (p === null) return false;
        if (f.priceMin !== '' && p < Number(f.priceMin)) return false;
        if (f.priceMax !== '' && p > Number(f.priceMax)) return false;
      }
      return true;
    });
    return list.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
  }, [strategies, modeTab, fApplied, previewPrice, productByCode, customers]);

  const persist = (next: PriceStrategy[]) => { saveStrategies(owner, next); setStrategies(next); };

  // ============ 编辑弹窗 ============
  const openEdit = (s?: PriceStrategy) => {
    setDraft(s ? JSON.parse(JSON.stringify(s)) : emptyDraft());
    setItemChecked([]);
    setItemSearch('');
    setEditVisible(true);
  };

  const doSave = () => {
    const d = draft;
    if (!String(d.name || '').trim()) { message.warning('请填写策略名称'); return; }
    if (d.priority === null || d.priority === undefined || Number.isNaN(Number(d.priority))) { message.warning('请填写优先级'); return; }
    if (d.mode === 'grade' && !(d.grades || []).length) { message.warning('请选择客户等级'); return; }
    if (d.mode !== 'grade' && !(d.customers || []).length) { message.warning('请选择采购商'); return; }
    if (d.mode === 'customer_product' && !(d.items || []).length) { message.warning('请添加商品明细（批量新增/修改商品价格）'); return; }
    const now = dayjs().format(TIME_FMT);
    const who = getCurrentUserDisplayName();
    const list = loadStrategies(owner);
    if (d.id) {
      const next = list.map(s => (s.id === d.id ? { ...d, modifier: who, updatedAt: now } : s));
      persist(next);
    } else {
      const rec = { ...d, id: `ps${Date.now()}`, creator: who, createdAt: now, modifier: who, updatedAt: now };
      persist([...list, rec]);
    }
    setEditVisible(false);
    message.success('策略已保存');
  };

  const handleSave = () => {
    const conflicts = findConflicts(owner, draft);
    if (conflicts.length) {
      Modal.confirm({
        title: '存在同优先级冲突策略',
        content: `以下策略与当前策略优先级相同且目标相交，保存后同优先级将按“模式高低→更新时间新者”决出生效者：${conflicts.join('、')}`,
        okText: '仍要保存', cancelText: '返回修改', onOk: doSave,
      });
      return;
    }
    doSave();
  };

  const handleCopy = (s: PriceStrategy) => {
    const now = dayjs().format(TIME_FMT);
    const who = getCurrentUserDisplayName();
    const clone: PriceStrategy = {
      ...JSON.parse(JSON.stringify(s)), id: `ps${Date.now()}`, name: `${s.name}-副本`,
      creator: who, createdAt: now, modifier: who, updatedAt: now,
    };
    persist([...loadStrategies(owner), clone]);
    message.success(`已复制为「${clone.name}」`);
  };

  const handleDelete = (ids: string[]) => {
    if (!fnOk('delete')) { message.warning('无删除权限'); return; }
    const set = new Set(ids);
    persist(loadStrategies(owner).filter(s => !set.has(s.id)));
    setSelectedKeys([]);
    message.success(`已删除 ${ids.length} 条策略`);
  };

  // ============ 商品明细行级规则 ============
  const upsertItem = (code: string, patch: Partial<StrategyItem>) => {
    setDraft(d => ({
      ...d,
      items: (d.items || []).map(i => (i.productCode === code ? { ...i, ...patch } : i)),
    }));
  };
  const applyBatch = () => {
    if (!batchCodes.length) { message.warning('请选择商品'); return; }
    setDraft(d => {
      const items = [...(d.items || [])];
      batchCodes.forEach(code => {
        const opt = productOptions.find(o => o.value === code);
        const idx = items.findIndex(i => i.productCode === code);
        const rec: StrategyItem = {
          productCode: code, productName: opt?.productName || '', styleCode: opt?.styleCode || '',
          rule: { ...batchRule },
        };
        if (idx >= 0) items[idx] = { ...items[idx], rule: { ...batchRule } };
        else items.push(rec);
      });
      return { ...d, items };
    });
    setBatchVisible(false);
    setBatchCodes([]);
    message.success('已批量新增/修改商品价格');
  };

  // ============ 列表列 ============
  const columns: any[] = [
    { title: '序号', key: 'idx', width: 60, align: 'center', render: (_: any, __: any, i: number) => (page - 1) * pageSize + i + 1 },
    { title: '策略名称', dataIndex: 'name', key: 'name', width: 180, ellipsis: true },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80, align: 'center', sorter: (a: PriceStrategy, b: PriceStrategy) => (Number(a.priority) || 0) - (Number(b.priority) || 0) },
    { title: '适用端', dataIndex: 'applyScope', key: 'applyScope', width: 90, align: 'center', render: (v: string) => (v === 'supplier' ? '供应商下单' : v === 'purchaser' ? '采购商后台' : '全部') },
    { title: '指定客户等级', key: 'grades', width: 110, align: 'center', render: (_: any, r: PriceStrategy) => (r.grades || []).length ? (r.grades || []).map(GRADE_LABEL).join('、') : '-' },
    { title: '指定采购商', key: 'customers', width: 180, ellipsis: true, render: (_: any, r: PriceStrategy) => {
      const names = (r.customers || []).map(c => c.name || c.code).join('、');
      return names ? <Tooltip title={names}><span>{names}</span></Tooltip> : '-';
    } },
    { title: '指定商品', key: 'items', width: 90, align: 'center', render: (_: any, r: PriceStrategy) => {
      if (r.mode !== 'customer_product') return <Text type="secondary">全部商品</Text>;
      const codes = (r.items || []).map(i => i.productCode).join('、');
      return <Tooltip title={codes || '无'}><span>{(r.items || []).length}件</span></Tooltip>;
    } },
    { title: '价格规则', key: 'rule', width: 150, render: (_: any, r: PriceStrategy) => {
      const rowRules = Array.from(new Set((r.items || []).map(i => ruleText(i.rule))));
      const mixed = rowRules.length > 1;
      // 指定采购商及商品模式无默认规则行：仅展示行级规则摘要
      if (r.mode === 'customer_product') {
        if (!rowRules.length) return '-';
        return <span>{mixed ? `行级混合(${rowRules.length}种)` : rowRules[0]}</span>;
      }
      return <span>{ruleText(r.rule)}</span>;
    } },
    { title: '生效开始时间', dataIndex: 'effectiveStart', key: 'effectiveStart', width: 150, render: (v: string) => v || '-' },
    { title: '生效结束时间', dataIndex: 'effectiveEnd', key: 'effectiveEnd', width: 150, render: (v: string) => v || '-' },
    { title: '状态', key: 'status', width: 80, align: 'center', render: (_: any, r: PriceStrategy) => {
      const st = strategyStatus(r);
      const color = st === '生效中' ? 'green' : st === '未开始' ? 'blue' : st === '已过期' ? 'default' : 'red';
      return <Tag color={color}>{st}</Tag>;
    } },
    { title: '修改人', dataIndex: 'modifier', key: 'modifier', width: 90, render: (v: string) => v || '-' },
    { title: '修改时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 150, render: (v: string) => v || '-' },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: (v: string) => v || '-' },
    { title: '操作', key: 'op', width: 150, fixed: 'right' as const, render: (_: any, r: PriceStrategy) => (
      <Space size={4}>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { if (!fnOk('edit')) { message.warning('无编辑权限'); return; } openEdit(r); }}>编辑</Button>
        <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(r)}>复制</Button>
        <Popconfirm title={`删除策略「${r.name}」？`} onConfirm={() => handleDelete([r.id])}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删</Button>
        </Popconfirm>
      </Space>
    ) },
  ];

  const ruleEditor = (rule: PriceRule, onChange: (r: PriceRule) => void, product?: any) => (
    <Space size={4} wrap>
      <Select size="small" style={{ width: 118 }} value={rule.mode} onChange={v => onChange({ ...rule, mode: v })}
        options={Object.keys(PRICE_MODE_LABEL).map(k => ({ value: k, label: PRICE_MODE_LABEL[k as keyof typeof PRICE_MODE_LABEL] }))} />
      <InputNumber size="small" style={{ width: 74 }} min={0} value={rule.value} onChange={v => onChange({ ...rule, value: Number(v) || 0 })} />
      {product ? <Text type="secondary" style={{ fontSize: 12 }}>≈¥{roundPrice(computeRulePrice(rule, product), loadRoundSettings(owner)).toFixed(2)}</Text> : null}
    </Space>
  );

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={8} align="center">
          <Text strong style={{ fontSize: 15 }}>商品采购价设置</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            优先级说明：按客户等级设置采购价恒为最低优先级（仅无按采购商/指定采购商及商品规则命中时生效）；其余规则按优先级数字（越小越高）判断，优先级相同时按 指定采购商及商品 &gt; 按采购商 生效；商品行级规则优先于策略默认规则。
          </Text>
          <Button size="small" icon={<SettingOutlined />} onClick={() => { setSettings(loadRoundSettings(owner)); setSettingsVisible(true); }}>取整/保底规则</Button>
        </Space>
      </Card>

      <Card size="small" bodyStyle={{ padding: '8px 12px' }}>
        <Tabs
          activeKey={modeTab}
          onChange={k => { setModeTab(k as any); setPage(1); }}
          items={[
            { key: 'all', label: '全部' },
            { key: 'grade', label: <span>按客户等级设置采购价 <Tag color="orange">低</Tag></span> },
            { key: 'customer', label: <span>按采购商设置采购价 <Tag color="blue">中</Tag></span> },
            { key: 'customer_product', label: <span>指定采购商及商品设置采购价(特殊价格策略) <Tag color="red">高</Tag></span> },
          ]}
          style={{ marginBottom: 4 }}
        />
        {modeTab === 'grade' ? (
          <>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
              按客户等级设置统一采购价（适用于该等级客户的全部商品）；等级规则恒为最低优先级，仅当无“按采购商/指定采购商及商品”规则命中时生效。
            </Text>
            <Table
              rowKey="grade" size="small" bordered pagination={false}
              dataSource={gradeRows.map(g => ({ grade: g }))}
              columns={[
                { title: '客户等级', dataIndex: 'grade', width: 110, align: 'center', render: (g: string) => <Tag color={GRADE_TAG_COLOR(g)}>{GRADE_LABEL(g)}</Tag> },
                { title: '统一采购价规则', key: 'rule', width: 300, render: (_: any, r: any) => {
                  const d = gradeDraft[r.grade];
                  return d ? ruleEditor(d.rule, nr => setGradeDraft(m => ({ ...m, [r.grade]: { ...d, rule: nr } })))
                    : <Button size="small" onClick={() => setGradeDraft(m => ({ ...m, [r.grade]: { rule: { mode: 'sale_sub', value: 0 }, enabled: true } }))}>设置</Button>;
                } },
                { title: '启用', key: 'enabled', width: 70, align: 'center', render: (_: any, r: any) => {
                  const d = gradeDraft[r.grade];
                  return d ? <Switch size="small" checked={d.enabled} onChange={v => setGradeDraft(m => ({ ...m, [r.grade]: { ...d, enabled: v } }))} /> : '-';
                } },
                { title: '状态', key: 'st', width: 90, align: 'center', render: (_: any, r: any) => {
                  if (!gradeExisting(r.grade)) return gradeDraft[r.grade] ? <Tag color="blue">未保存</Tag> : <Tag>未设置</Tag>;
                  return <Tag color="green">已设置</Tag>;
                } },
                { title: '说明', key: 'desc', render: () => <Text type="secondary" style={{ fontSize: 12 }}>该等级客户全部商品适用；优先级恒最低</Text> },
                { title: '操作', key: 'op', width: 130, render: (_: any, r: any) => (
                  <Space size={4}>
                    <Button type="link" size="small" disabled={!gradeDraft[r.grade]} onClick={() => saveGrade(r.grade)}>保存</Button>
                    <Button type="link" size="small" danger disabled={!gradeExisting(r.grade)} onClick={() => clearGrade(r.grade)}>清除</Button>
                  </Space>
                ) },
              ]}
            />
          </>
        ) : (
          <>
        <Space wrap size={8} style={{ marginBottom: 10 }}>
          <Input placeholder="策略名称" style={{ width: 140 }} value={fDraft.name} onChange={e => setFDraft(f => ({ ...f, name: e.target.value }))} />
          <Select style={{ width: 130 }} value={fDraft.valid} onChange={v => setFDraft(f => ({ ...f, valid: v }))}
            options={[{ value: 'all', label: '全部状态' }, { value: 'valid', label: '仅生效中' }, { value: 'invalid', label: '仅无效' }]} />
          <Input placeholder="商品编码" style={{ width: 120 }} value={fDraft.productCode} onChange={e => setFDraft(f => ({ ...f, productCode: e.target.value }))} />
          <Input placeholder="款式编码" style={{ width: 120 }} value={fDraft.styleCode} onChange={e => setFDraft(f => ({ ...f, styleCode: e.target.value }))} />
          <InputNumber placeholder="采购价min" style={{ width: 100 }} value={fDraft.priceMin as any} onChange={v => setFDraft(f => ({ ...f, priceMin: v === null ? '' : v }))} />
          <InputNumber placeholder="采购价max" style={{ width: 100 }} value={fDraft.priceMax as any} onChange={v => setFDraft(f => ({ ...f, priceMax: v === null ? '' : v }))} />
          <Input placeholder="采购商名称/编码" style={{ width: 150 }} value={fDraft.customerText} onChange={e => setFDraft(f => ({ ...f, customerText: e.target.value }))} />
          <Tooltip title="按客户名称快速搜索该客户拥有的价格策略（含直接指定该客户的策略与其客户等级命中的等级策略）">
            <Input placeholder="客户名称" style={{ width: 140 }} allowClear value={fDraft.customerName} onChange={e => setFDraft(f => ({ ...f, customerName: e.target.value }))} onPressEnter={() => { setFApplied(fDraft); setPage(1); }} />
          </Tooltip>
          <Button type="primary" icon={<SearchOutlined />} onClick={() => { setFApplied(fDraft); setPage(1); }}>搜 索</Button>
          <Button icon={<RedoOutlined />} onClick={() => { setFDraft(emptyFilters()); setFApplied(emptyFilters()); setPage(1); }}>重 置</Button>
        </Space>
        <Space wrap size={8} style={{ marginBottom: 10 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { if (!fnOk('add')) { message.warning('无新增权限'); return; } openEdit(); }}>添加新策略</Button>
          <Popconfirm title={`删除选中的 ${selectedKeys.length} 条策略？`} disabled={!selectedKeys.length} onConfirm={() => handleDelete(selectedKeys.map(String))}>
            <Button danger icon={<DeleteOutlined />} disabled={!selectedKeys.length}>批量删除策略</Button>
          </Popconfirm>
        </Space>
        <Table
          rowKey="id" size="small" bordered scroll={{ x: 1900 }}
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: keys => setSelectedKeys(keys) }}
          columns={columns} dataSource={filtered}
          locale={{ emptyText: <Empty description="暂无价格策略，点击“添加新策略”创建" /> }}
          pagination={{
            current: page, pageSize, total: filtered.length, showSizeChanger: true,
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
          </>
        )}
      </Card>

      {/* ============ 策略编辑弹窗 ============ */}
      <Modal
        open={editVisible} title={draft.id ? `编辑策略：${draft.name}` : '添加新策略'} width={960}
        onCancel={() => setEditVisible(false)} onOk={handleSave} okText="保存" cancelText="取消" destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Space wrap size={10}>
            <span>策略名称<Input style={{ width: 200 }} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="如：采购商A基础价-1" /></span>
            <span>优先级<Tooltip title="数字越小优先级越高"><InputNumber style={{ width: 80 }} min={0} value={draft.priority} onChange={v => setDraft(d => ({ ...d, priority: Number(v) || 0 }))} /></Tooltip></span>
            <span>启用<Switch checked={draft.enabled} onChange={v => setDraft(d => ({ ...d, enabled: v }))} /></span>
            <span>适用端<Select style={{ width: 120 }} value={draft.applyScope} onChange={v => setDraft(d => ({ ...d, applyScope: v }))}
              options={[{ value: 'all', label: '全部' }, { value: 'supplier', label: '供应商下单' }, { value: 'purchaser', label: '采购商后台' }]} /></span>
          </Space>
          <Space wrap size={10}>
            <span>策略模式<Radio.Group value={draft.mode} onChange={e => setDraft(d => ({ ...d, mode: e.target.value }))}
              options={[
                { value: 'grade', label: `按客户等级(${STRATEGY_MODE_LABEL.grade})` },
                { value: 'customer', label: `按采购商(${STRATEGY_MODE_LABEL.customer})` },
                { value: 'customer_product', label: `指定采购商及商品(${STRATEGY_MODE_LABEL.customer_product})` },
              ]} /></span>
          </Space>
          <Space wrap size={10}>
            <span>生效期<RangePicker showTime style={{ width: 380 }}
              value={draft.effectiveStart && draft.effectiveEnd ? [dayjs(draft.effectiveStart), dayjs(draft.effectiveEnd)] : null}
              onChange={v => setDraft(d => ({ ...d, effectiveStart: v?.[0] ? v[0].format(TIME_FMT) : '', effectiveEnd: v?.[1] ? v[1].format(TIME_FMT) : '' }))} /></span>
          </Space>
          <Space wrap size={10}>
            {draft.mode === 'grade' && (
              <span>指定客户等级<Select mode="multiple" style={{ width: 260 }} value={draft.grades} onChange={v => setDraft(d => ({ ...d, grades: v }))} options={gradeOptions} placeholder="选择等级" /></span>
            )}
            {draft.mode !== 'grade' && (
              <span>指定采购商<Select mode="multiple" showSearch style={{ width: 360 }} optionFilterProp="label"
                value={(draft.customers || []).map(c => c.code || c.name)}
                onChange={vals => setDraft(d => ({
                  ...d,
                  customers: vals.map((v: string) => {
                    const opt = customerOptions.find(o => o.value === v);
                    return { code: opt?.code || v, name: opt?.name || v };
                  }),
                }))}
                options={customerOptions} placeholder="搜索并选择采购商（可多选）" /></span>
            )}
          </Space>
          {draft.mode !== 'customer_product' && (
            <Space wrap size={10}>
              <span>默认计价规则{ruleEditor(draft.rule, r => setDraft(d => ({ ...d, rule: r })))}</span>
              <Text type="secondary" style={{ fontSize: 12 }}>（商品行级规则可覆盖此默认规则；公式按商品档案当前成本价/基础售价实时计算）</Text>
            </Space>
          )}
          {draft.mode === 'customer_product' && (
            <div>
              <Space wrap style={{ marginBottom: 6 }} size={8}>
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setBatchVisible(true)}>批量新增/修改商品价格</Button>
                <Input size="small" placeholder="搜索商品编码/名称" style={{ width: 170 }} allowClear value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
                <Text type="secondary" style={{ fontSize: 12 }}>勾选批量规则</Text>
                {ruleEditor(itemBatchRule, setItemBatchRule)}
                <Button size="small" disabled={!itemChecked.length} onClick={() => {
                  const set = new Set(itemChecked);
                  setDraft(d => ({ ...d, items: (d.items || []).map(i => (set.has(i.productCode) ? { ...i, rule: { ...itemBatchRule } } : i)) }));
                  message.success(`已应用到勾选的 ${itemChecked.length} 件商品`);
                }}>应用到勾选({itemChecked.length})</Button>
                <Text type="secondary" style={{ fontSize: 12 }}>共 {(draft.items || []).length} 件商品</Text>
              </Space>
              <Table
                rowKey="productCode" size="small" bordered pagination={false}
                rowSelection={{ selectedRowKeys: itemChecked, onChange: keys => setItemChecked(keys.map(String)) }}
                dataSource={(draft.items || []).filter(i => {
                  const t = itemSearch.trim();
                  if (!t) return true;
                  const name = i.productName || productByCode.get(i.productCode)?.shortName || productByCode.get(i.productCode)?.name || '';
                  return String(i.productCode || '').includes(t) || String(name).includes(t);
                })}
                columns={[
                  { title: '商品编码', dataIndex: 'productCode', width: 140 },
                  { title: '商品名称', dataIndex: 'productName', width: 160, ellipsis: true, render: (v: string, r: StrategyItem) => v || productByCode.get(r.productCode)?.shortName || productByCode.get(r.productCode)?.name || '-' },
                  { title: '行级计价规则', key: 'rule', width: 260, render: (_: any, r: StrategyItem) => ruleEditor(r.rule, nr => upsertItem(r.productCode, { rule: nr }), productByCode.get(r.productCode)) },
                  { title: '操作', key: 'op', width: 70, render: (_: any, r: StrategyItem) => (
                    <Button type="link" size="small" danger onClick={() => setDraft(d => ({ ...d, items: (d.items || []).filter(i => i.productCode !== r.productCode) }))}>删除</Button>
                  ) },
                ]}
              />
            </div>
          )}
          <div><span>备注<Input style={{ width: 420 }} value={draft.remark || ''} onChange={e => setDraft(d => ({ ...d, remark: e.target.value }))} /></span></div>
        </Space>
      </Modal>

      {/* ============ 批量新增/修改商品价格 ============ */}
      <Modal open={batchVisible} title="批量新增/修改商品价格" width={780} onCancel={() => setBatchVisible(false)} onOk={applyBatch} okText="应用" cancelText="取消">
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Space wrap size={8}>
            <Input placeholder="搜索商品编码/名称/款式编码" style={{ width: 240 }} allowClear value={batchSearch} onChange={e => setBatchSearch(e.target.value)} />
            <Text type="secondary" style={{ fontSize: 12 }}>已勾选 {batchCodes.length} 件商品（跨页保留勾选）</Text>
          </Space>
          <Table
            rowKey="productCode" size="small" bordered scroll={{ y: 300 }}
            dataSource={batchProducts}
            rowSelection={{ selectedRowKeys: batchCodes, onChange: keys => setBatchCodes(keys.map(String)) }}
            pagination={{ pageSize: 8, size: 'small', showTotal: t => `共 ${t} 条` }}
            columns={[
              { title: '商品编码', dataIndex: 'productCode', width: 130 },
              { title: '商品名称', key: 'name', width: 170, ellipsis: true, render: (_: any, r: any) => r.shortName || r.name || '-' },
              { title: '款式编码', dataIndex: 'styleCode', width: 100, render: (v: string) => v || '-' },
              { title: '颜色/规格', key: 'cs', width: 110, render: (_: any, r: any) => [r.color, r.spec].filter(Boolean).join('/') || '-' },
              { title: '基础售价', dataIndex: 'suggestedPrice', width: 90, align: 'right', render: (v: any) => (v ? `¥${Number(v).toFixed(2)}` : '-') },
              { title: '成本价', dataIndex: 'costPrice', width: 90, align: 'right', render: (v: any) => (v ? `¥${Number(v).toFixed(2)}` : '-') },
            ]}
          />
          <div>计价规则{ruleEditor(batchRule, setBatchRule, batchCodes.length === 1 ? productByCode.get(batchCodes[0]) : undefined)}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>已存在于策略中的商品将覆盖其行级规则；新商品将追加。</Text>
        </Space>
      </Modal>

      {/* ============ 取整/保底规则 ============ */}
      <Modal open={settingsVisible} title="取整/保底规则（全局）" width={460} onCancel={() => setSettingsVisible(false)}
        onOk={() => { saveRoundSettings(owner, settings); setSettingsVisible(false); message.success('设置已保存'); }} okText="保存" cancelText="取消">
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>取整规则<Radio.Group value={settings.rounding} onChange={e => setSettings(s => ({ ...s, rounding: e.target.value }))}
            options={[{ value: 'none', label: '不取整' }, { value: 'int', label: '四舍五入整数' }, { value: 'd1', label: '保留1位' }, { value: 'd2', label: '保留2位' }]} /></div>
          <div>成本价保底<Switch checked={settings.floorCost} onChange={v => setSettings(s => ({ ...s, floorCost: v }))} />
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>算出价低于成本价时自动按成本价</Text></div>
        </Space>
      </Modal>
    </div>
  );
};

export default PriceStrategyPage;
