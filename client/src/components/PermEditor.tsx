/**
 * PERM_V2 三态权限编辑器（菜单/功能/字段 三类权限点：允许/继承/禁止）
 * 供 角色管理 / 账号管理 / 开发者客户权限 三入口复用
 * value: Record<pointKey, 'allow'|'deny'|'inherit'>（inherit=不写入，沿解析链下坠）
 */
import React, { useMemo, useState } from 'react';
import { Collapse, Radio, Input, Space, Button, Tag, Typography, Empty, Tabs, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import {
  PermScope, PermTri, menuGroupsOf, menuKeysOf, menuLabelOf,
  FN_ACTIONS, FN_ACTION_LABEL, PRODUCT_FIELD_META, PRODUCT_PAGE_KEY,
} from '../config/permRegistry';

const { Text } = Typography;

const SCOPE_LABEL: Record<PermScope, string> = {
  supplier: '供应商后台', purchaser: '采购商平台', factory: '加工厂平台', dev: '开发者后台',
};

interface Props {
  scopes: PermScope[];
  value: Record<string, PermTri>;
  onChange: (next: Record<string, PermTri>) => void;
}

const TriRadio: React.FC<{ value?: PermTri; onChange: (v: PermTri) => void }> = ({ value, onChange }) => (
  <Radio.Group
    size="small"
    value={value || 'inherit'}
    onChange={e => onChange(e.target.value as PermTri)}
    optionType="button"
    buttonStyle="solid"
    options={[
      { label: '允许', value: 'allow' },
      { label: '继承', value: 'inherit' },
      { label: '禁止', value: 'deny' },
    ]}
  />
);

const PermEditor: React.FC<Props> = ({ scopes, value, onChange }) => {
  const [search, setSearch] = useState('');
  const [fnPage, setFnPage] = useState<string>(menuKeysOf('supplier')[0] || '');
  const set = (key: string, tri: PermTri) => {
    const next = { ...value };
    if (tri === 'inherit') delete next[key];
    else next[key] = tri;
    onChange(next);
  };
  const batchGroup = (keys: string[], tri: PermTri) => {
    const next = { ...value };
    keys.forEach(k => { if (tri === 'inherit') delete next[k]; else next[k] = tri; });
    onChange(next);
  };
  const kw = search.trim().toLowerCase();
  const totalSet = Object.keys(value).length;

  // ---------- 菜单页签 ----------
  const panels = useMemo(() => scopes.flatMap(scope => menuGroupsOf(scope).map(g => {
    const items = g.items.filter(i => !kw || i.label.toLowerCase().includes(kw) || i.key.toLowerCase().includes(kw));
    if (kw && items.length === 0) return null;
    const setCount = g.items.filter(i => value[i.key] && value[i.key] !== 'inherit').length;
    return {
      key: `${scope}:${g.key}`,
      label: (
        <Space size={8}>
          <Text strong style={{ fontSize: 13 }}>{SCOPE_LABEL[scope]} · {g.label}</Text>
          <Tag color="blue" style={{ marginRight: 0 }}>{g.items.length}项</Tag>
          {setCount > 0 && <Tag color="orange" style={{ marginRight: 0 }}>已设{setCount}</Tag>}
        </Space>
      ),
      extra: (
        <Space size={4} onClick={e => e.stopPropagation()}>
          <Button size="small" type="link" onClick={() => batchGroup(g.items.map(i => i.key), 'allow')}>全允许</Button>
          <Button size="small" type="link" onClick={() => batchGroup(g.items.map(i => i.key), 'inherit')}>全继承</Button>
          <Button size="small" type="link" danger onClick={() => batchGroup(g.items.map(i => i.key), 'deny')}>全禁止</Button>
        </Space>
      ),
      children: (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px 16px' }}>
          {items.map(i => (
            <div key={i.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 13 }} ellipsis={{ tooltip: i.key }}>{i.label}</Text>
              <TriRadio value={value[i.key]} onChange={v => set(i.key, v)} />
            </div>
          ))}
        </div>
      ),
    };
  })).filter(Boolean), [scopes, value, kw]);

  const defaultActive = useMemo(() => panels
    .filter((p: any) => p.key && (menuGroupsOf(p.key.split(':')[0] as PermScope).find(g => `${p.key.split(':')[0]}:${g.key}` === p.key)?.items || [])
      .some((i: any) => value[i.key] && value[i.key] !== 'inherit'))
    .map((p: any) => p.key), [panels, value]);

  // ---------- 功能页签 ----------
  const fnRows = FN_ACTIONS.map(a => ({ action: a, key: `fn:${fnPage}:${a}` }));
  // ---------- 字段页签（商品列表 view/edit） ----------
  const fieldGroups = useMemo(() => {
    const map = new Map<string, typeof PRODUCT_FIELD_META>();
    PRODUCT_FIELD_META.forEach(c => {
      if (kw && !c.title.toLowerCase().includes(kw) && !c.dataIndex.toLowerCase().includes(kw)) return;
      const arr = map.get(c.group || '其它') || [];
      arr.push(c);
      map.set(c.group || '其它', arr);
    });
    return Array.from(map.entries());
  }, [kw]);

  const tabItems = [
    {
      key: 'menu',
      label: `菜单权限${Object.keys(value).filter(k => !k.startsWith('fn:') && !k.startsWith('field:')).length ? ' *' : ''}`,
      children: panels.length === 0 ? <Empty description="无匹配菜单点" /> : (
        <Collapse items={panels as any} defaultActiveKey={kw ? panels.map((p: any) => p.key) : defaultActive} style={{ background: '#fafcfd' }} />
      ),
    },
    {
      key: 'fn',
      label: '功能权限',
      children: (
        <div>
          <Space style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>页面：</Text>
            <Select
              size="small"
              style={{ width: 260 }}
              showSearch
              value={fnPage}
              onChange={setFnPage}
              optionFilterProp="label"
              options={menuKeysOf('supplier').map(k => ({ label: menuLabelOf('supplier', k), value: k }))}
            />
            <Button size="small" type="link" onClick={() => batchGroup(fnRows.map(r => r.key), 'allow')}>全允许</Button>
            <Button size="small" type="link" onClick={() => batchGroup(fnRows.map(r => r.key), 'inherit')}>全继承</Button>
            <Button size="small" type="link" danger onClick={() => batchGroup(fnRows.map(r => r.key), 'deny')}>全禁止</Button>
          </Space>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px 16px' }}>
            {fnRows.map(r => (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 13 }}>{FN_ACTION_LABEL[r.action as keyof typeof FN_ACTION_LABEL]}</Text>
                <TriRadio value={value[r.key]} onChange={v => set(r.key, v)} />
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            控制该页工具栏/行操作按键（新增/编辑/删除/导入/导出/批量/显示字段/打印/审核）；禁止后按键隐藏。
          </Text>
        </div>
      ),
    },
    {
      key: 'field',
      label: '字段权限（商品列表）',
      children: (
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            查看=控制列表列/表单是否可见；编辑=控制新增/编辑表单中是否可修改（禁止编辑时控件禁用）。作用于 全部商品/成品/半成品/原材料。
          </Text>
          <Collapse
            style={{ background: '#fafcfd' }}
            items={fieldGroups.map(([group, cols]) => ({
              key: group,
              label: <Space size={8}><Text strong style={{ fontSize: 13 }}>{group}</Text><Tag color="blue" style={{ marginRight: 0 }}>{cols.length}字段</Tag></Space>,
              children: (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '6px 20px' }}>
                  {cols.map(c => (
                    <div key={c.dataIndex} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={{ fontSize: 13 }} ellipsis={{ tooltip: c.dataIndex }}>{c.title}</Text>
                      <Space size={4}>
                        <Text type="secondary" style={{ fontSize: 11 }}>查看</Text>
                        <TriRadio value={value[`field:${PRODUCT_PAGE_KEY}:${c.dataIndex}:view`]} onChange={v => set(`field:${PRODUCT_PAGE_KEY}:${c.dataIndex}:view`, v)} />
                        <Text type="secondary" style={{ fontSize: 11 }}>编辑</Text>
                        <TriRadio value={value[`field:${PRODUCT_PAGE_KEY}:${c.dataIndex}:edit`]} onChange={v => set(`field:${PRODUCT_PAGE_KEY}:${c.dataIndex}:edit`, v)} />
                      </Space>
                    </div>
                  ))}
                </div>
              ),
            }))}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="搜索菜单/字段名称或权限key" style={{ width: 240 }} value={search} onChange={e => setSearch(e.target.value)} />
        <Text type="secondary" style={{ fontSize: 12 }}>已显式设置 {totalSet} 项（继承=沿用 用户&gt;开发者&gt;角色&gt;默认 解析链）</Text>
      </div>
      <Tabs size="small" items={tabItems} />
    </div>
  );
};

export default PermEditor;
