/**
 * PERM_V2 三态权限编辑器（左菜单 + 右明细布局）
 * 左侧：系统菜单列表（按平台分组）；点击菜单后右侧展示该菜单的：
 *   ① 菜单进入权限（菜单点）② 按键权限（功能点 fn）③ 字段权限（字段点 field，查看/编辑双控）
 * 三态语义：允许/继承/禁止（inherit=不写入，沿 用户>分组>角色>默认 解析链下坠）
 * 供 角色管理 / 账号管理（个人覆写） / 账号管理（分组权限） 三入口复用
 * value: Record<pointKey, 'allow'|'deny'|'inherit'>
 */
import React, { useMemo, useState } from 'react';
import { Radio, Input, Space, Button, Tag, Typography, Empty, Checkbox } from 'antd';
import { SearchOutlined, AppstoreOutlined } from '@ant-design/icons';
import {
  PermScope, PermTri, menuGroupsOf, menuKeysOf, menuLabelOf,
  FN_ACTION_LABEL, FIELD_POINTS, FN_POINTS,
} from '../config/permRegistry';

const { Text } = Typography;

const SCOPE_LABEL: Record<PermScope, string> = {
  supplier: '供应商后台', purchaser: '采购商平台', factory: '加工厂平台', dev: '开发者后台',
};

interface Props {
  scopes: PermScope[];
  value: Record<string, PermTri>;
  onChange: (next: Record<string, PermTri>) => void;
  /** 菜单级授权清单（复选框勾选集）：传入时左侧供应商菜单前显示复选框，
   * 取代原“独立权限配置”区域（角色预设基础上额外追加，仅对该账号生效） */
  pageChecks?: string[];
  onPageChecksChange?: (next: string[]) => void;
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

const PermEditor: React.FC<Props> = ({ scopes, value, onChange, pageChecks, onPageChecksChange }) => {
  const [search, setSearch] = useState('');
  const allMenuKeys = useMemo(() => scopes.flatMap(s => menuKeysOf(s)), [scopes]);
  const [selMenu, setSelMenu] = useState<string>(allMenuKeys[0] || '');
  const activeMenu = allMenuKeys.includes(selMenu) ? selMenu : (allMenuKeys[0] || '');

  // 菜单级复选框（仅供应商菜单点参与 legacy 白名单解析）：勾选=追加授权
  const showPageChecks = pageChecks !== undefined && !!onPageChecksChange;
  const togglePage = (key: string, checked: boolean) => {
    const cur = new Set(pageChecks || []);
    if (checked) cur.add(key); else cur.delete(key);
    onPageChecksChange?.(Array.from(cur));
  };
  const toggleGroupPages = (keys: string[], checked: boolean) => {
    const cur = new Set(pageChecks || []);
    keys.forEach(k => { if (checked) cur.add(k); else cur.delete(k); });
    onPageChecksChange?.(Array.from(cur));
  };

  const set = (key: string, tri: PermTri) => {
    const next = { ...value };
    if (tri === 'inherit') delete next[key];
    else next[key] = tri;
    onChange(next);
  };
  const batch = (keys: string[], tri: PermTri) => {
    const next = { ...value };
    keys.forEach(k => { if (tri === 'inherit') delete next[k]; else next[k] = tri; });
    onChange(next);
  };

  const kw = search.trim().toLowerCase();
  const totalSet = Object.keys(value).filter(k => value[k] && value[k] !== 'inherit').length;

  // 每个菜单的已显式设置数（菜单点 + fn + field）
  const setCountOf = (mk: string): number => Object.keys(value).filter(k =>
    value[k] && value[k] !== 'inherit' && (k === mk || k.startsWith(`fn:${mk}:`) || k.startsWith(`field:${mk}:`))).length;

  // 当前菜单的字段点（按 group=页面 分组）
  const fieldGroups = useMemo(() => {
    const pts = FIELD_POINTS.filter(p => p.key.startsWith(`field:${activeMenu}:`));
    const filtered = pts.filter(p => !kw || p.label.toLowerCase().includes(kw));
    const map = new Map<string, typeof filtered>();
    filtered.forEach(p => {
      const arr = map.get(p.group) || [];
      arr.push(p);
      map.set(p.group, arr);
    });
    return Array.from(map.entries());
  }, [activeMenu, kw]);

  const fnRows = useMemo(() => FN_POINTS
    .filter(p => p.key.startsWith(`fn:${activeMenu}:`))
    .map(p => ({ action: p.key.slice(`fn:${activeMenu}:`.length), key: p.key })), [activeMenu]);
  const hasFnPoints = fnRows.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="搜索字段/按键名称" style={{ width: 220 }} value={search} onChange={e => setSearch(e.target.value)} />
        <Text type="secondary" style={{ fontSize: 12 }}>已显式设置 {totalSet} 项（继承=沿用 用户&gt;分组&gt;角色&gt;默认 解析链；红色禁止 / 绿色允许）</Text>
      </div>
      <div style={{ display: 'flex', gap: 12, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* 左侧菜单列表 */}
        <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid #f0f0f0', background: '#fafcfd', maxHeight: 460, overflowY: 'auto' }}>
          {scopes.flatMap(scope => menuGroupsOf(scope).map(g => {
            const items = g.items.filter(i => !kw || i.label.toLowerCase().includes(kw) || i.key.toLowerCase().includes(kw));
            if (kw && items.length === 0) return null;
            const groupChecks = showPageChecks && scope === 'supplier';
            const groupKeys = g.items.map(i => i.key);
            const checkedCount = groupKeys.filter(k => (pageChecks || []).includes(k)).length;
            return (
              <div key={`${scope}:${g.key}`}>
                <div style={{ padding: '6px 12px', background: '#f0f5ff', color: PRIMARY_BLUE, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {groupChecks && (
                    <span onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={checkedCount === groupKeys.length && groupKeys.length > 0}
                        indeterminate={checkedCount > 0 && checkedCount < groupKeys.length}
                        onChange={e => toggleGroupPages(groupKeys, e.target.checked)}
                      />
                    </span>
                  )}
                  <span>{SCOPE_LABEL[scope]} · {g.label}</span>
                </div>
                {items.map(i => {
                  const cnt = setCountOf(i.key);
                  const active = i.key === activeMenu;
                  const rowCheck = groupChecks;
                  return (
                    <div key={i.key} onClick={() => setSelMenu(i.key)}
                      style={{
                        padding: '6px 12px 6px 20px', cursor: 'pointer', fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                        background: active ? '#e6f4ff' : 'transparent',
                        borderRight: active ? `3px solid ${PRIMARY_BLUE}` : '3px solid transparent',
                        color: active ? PRIMARY_BLUE : undefined, fontWeight: active ? 600 : 400,
                      }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                        {rowCheck && (
                          <span onClick={e => e.stopPropagation()} title="勾选=该账号拥有此菜单（角色预设基础上追加）">
                            <Checkbox checked={(pageChecks || []).includes(i.key)} onChange={e => togglePage(i.key, e.target.checked)} />
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
                      </span>
                      {cnt > 0 && <Tag color="orange" style={{ marginRight: 0, fontSize: 11 }}>{cnt}</Tag>}
                    </div>
                  );
                })}
              </div>
            );
          }))}
        </div>
        {/* 右侧明细 */}
        <div style={{ flex: 1, minWidth: 0, maxHeight: 460, overflowY: 'auto', padding: '4px 8px 12px 4px' }}>
          {!activeMenu ? <Empty description="无菜单点" /> : (
            <div>
              {/* 菜单进入权限 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, marginBottom: 12 }}>
                <Space size={8}>
                  <AppstoreOutlined style={{ color: '#389e0d' }} />
                  <Text strong style={{ fontSize: 13 }}>菜单进入权限：{menuLabelOf(scopeOf(activeMenu, scopes), activeMenu)}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>禁止后该菜单隐藏且路由拦截</Text>
                </Space>
                <TriRadio value={value[activeMenu]} onChange={v => set(activeMenu, v)} />
              </div>
              {/* 按键权限 */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 13 }}>按键权限（工具栏/行操作）</Text>
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => batch(fnRows.map(r => r.key), 'allow')}>全允许</Button>
                    <Button size="small" type="link" onClick={() => batch(fnRows.map(r => r.key), 'inherit')}>全继承</Button>
                    <Button size="small" type="link" danger onClick={() => batch(fnRows.map(r => r.key), 'deny')}>全禁止</Button>
                  </Space>
                </div>
                {hasFnPoints ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px 16px' }}>
                    {fnRows.map(r => (
                      <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ fontSize: 13 }}>{FN_ACTION_LABEL[r.action as keyof typeof FN_ACTION_LABEL]}</Text>
                        <TriRadio value={value[r.key]} onChange={v => set(r.key, v)} />
                      </div>
                    ))}
                  </div>
                ) : <Text type="secondary" style={{ fontSize: 12 }}>该菜单暂无按键权限点</Text>}
              </div>
              {/* 字段权限（查看/编辑） */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 13 }}>字段权限（查看=列/表单可见；编辑=表单可修改）</Text>
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => batch(fieldGroups.flatMap(([, pts]) => pts.flatMap(p => [p.key])), 'allow')}>全允许</Button>
                    <Button size="small" type="link" onClick={() => batch(fieldGroups.flatMap(([, pts]) => pts.flatMap(p => [p.key])), 'inherit')}>全继承</Button>
                    <Button size="small" type="link" danger onClick={() => batch(fieldGroups.flatMap(([, pts]) => pts.flatMap(p => [p.key])), 'deny')}>全禁止</Button>
                  </Space>
                </div>
                {fieldGroups.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>该菜单暂无字段权限点（页面变更后重跑 client/scripts/gen-perm-points.js 重新扫描生成）</Text>
                ) : fieldGroups.map(([group, pts]) => (
                  <div key={group} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 600 }}>{group}（{pts.length / 2} 字段）</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '6px 20px' }}>
                      {pts.filter(p => p.key.endsWith(':view')).map(p => {
                        const dataIndex = p.key.slice(`field:${activeMenu}:`.length, -':view'.length);
                        const editKey = `field:${activeMenu}:${dataIndex}:edit`;
                        return (
                          <div key={p.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <Text style={{ fontSize: 13 }} ellipsis={{ tooltip: dataIndex }}>{p.label.replace('·查看', '')}</Text>
                            <Space size={4}>
                              <Text type="secondary" style={{ fontSize: 11 }}>查看</Text>
                              <TriRadio value={value[p.key]} onChange={v => set(p.key, v)} />
                              <Text type="secondary" style={{ fontSize: 11 }}>编辑</Text>
                              <TriRadio value={value[editKey]} onChange={v => set(editKey, v)} />
                            </Space>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PRIMARY_BLUE = '#1e4a7e';
const scopeOf = (menuKey: string, scopes: PermScope[]): PermScope =>
  scopes.find(s => menuKeysOf(s).includes(menuKey)) || 'supplier';

export default PermEditor;
