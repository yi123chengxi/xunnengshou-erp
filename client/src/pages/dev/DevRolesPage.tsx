import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, Select, Checkbox, message, Tag, Popconfirm, Tooltip, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import {
  loadDevRoles, saveDevRoles, loadDevSubAccounts, DEV_PERMISSION_GROUPS, ALL_DEV_PERMISSION_KEYS,
} from '../../utils/devStore';
import type { DevRole } from '../../utils/devStore';

const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316'];

const scopeLabel = (s: string) => s === 'ALL' ? '全部客户数据' : s === 'TEAM' ? '组员数据（组长可查看组员数据）' : '仅本人负责的数据';

// 开发者后台 - 系统设置 - 角色权限（参考 my-crm settings/roles：数据权限 + 功能权限 + 组长组员制）
const DevRolesPage: React.FC = () => {
  const [roles, setRoles] = useState<DevRole[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<DevRole | null>(null);
  const [form] = Form.useForm();
  const [formPerms, setFormPerms] = useState<string[]>([]);
  const [formScope, setFormScope] = useState<'ALL' | 'OWN' | 'TEAM'>('OWN');
  const [teamRels, setTeamRels] = useState<{ leader: string; members: string[] }[]>([]);
  const [expandedLeader, setExpandedLeader] = useState<string | null>(null);

  const subs = useMemo(() => loadDevSubAccounts(), [roles, modalVisible]);

  const load = useCallback(() => { setRoles(loadDevRoles()); }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: '', description: '', dataScope: 'OWN' });
    setFormPerms([...ALL_DEV_PERMISSION_KEYS]);
    setFormScope('OWN');
    setTeamRels([]);
    setModalVisible(true);
  };

  const openEdit = (r: DevRole) => {
    setEditing(r);
    form.setFieldsValue({ name: r.name, description: r.description || '', dataScope: r.dataScope });
    setFormPerms([...r.permissions]);
    setFormScope(r.dataScope);
    setTeamRels((r.teamRels || []).map(t => ({ ...t, members: [...t.members] })));
    setExpandedLeader(null);
    setModalVisible(true);
  };

  const handleSave = () => {
    form.validateFields().then(values => {
      const name = String(values.name || '').trim();
      if (!name) return;
      if (roles.some(r => r.name === name && r.id !== editing?.id)) { message.error('角色名称已存在'); return; }
      if (editing) {
        const next = roles.map(r => r.id === editing.id ? {
          ...r, name, description: values.description || '', dataScope: values.dataScope,
          permissions: formPerms, teamRels: values.dataScope === 'TEAM' ? teamRels : [],
        } : r);
        saveDevRoles(next);
        message.success(`角色「${name}」已保存`);
      } else {
        const entry: DevRole = {
          id: `role_${Date.now()}`, name, description: values.description || '',
          dataScope: values.dataScope, permissions: formPerms, teamRels: [],
        };
        saveDevRoles([...roles, entry]);
        message.success(`角色「${name}」已创建，可在账号管理中为子账号分配`);
      }
      setModalVisible(false);
      load();
    }).catch(() => message.warning('请完善角色名称'));
  };

  const handleDelete = (r: DevRole) => {
    const used = loadDevSubAccounts().some(s => s.roleId === r.id);
    if (used) { message.error('该角色下已有子账号，请先在账号管理中改派角色'); return; }
    saveDevRoles(roles.filter(x => x.id !== r.id));
    message.success('角色已删除');
    load();
  };

  // 组员绑定（每个组员只能绑定一个组长，重复绑定自动转移）
  const toggleMember = (leader: string, member: string) => {
    setTeamRels(prev => {
      const boundOther = prev.find(t => t.leader !== leader && t.members.includes(member));
      let next = prev.map(t => t.leader !== leader ? { ...t, members: t.members.filter(m => m !== member) } : { ...t });
      const mine = next.find(t => t.leader === leader);
      const target = mine || { leader, members: [] as string[] };
      if (!mine) next = [...next, target];
      if (boundOther) message.info(`已将组员转移至当前组长`);
      target.members = target.members.includes(member)
        ? target.members.filter(m => m !== member)
        : [...target.members, member];
      return next.map(t => t.leader === leader ? target : t);
    });
  };

  const roleUsers = (roleId: string) => subs.filter(s => s.roleId === roleId);

  const columns: any[] = [
    {
      title: '角色', key: 'name', width: 200, align: 'center',
      render: (_: any, r: DevRole, idx: number) => (
        <Space>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: COLORS[idx % COLORS.length], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{r.name[0]}</span>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
        </Space>
      ),
    },
    { title: '描述', dataIndex: 'description', width: 200, align: 'center', render: (v: string) => v || '—' },
    {
      title: '数据权限', dataIndex: 'dataScope', width: 200, align: 'center',
      render: (v: string) => <Tag color={v === 'TEAM' ? 'purple' : 'blue'}>数据权限: {scopeLabel(v)}</Tag>,
    },
    { title: '功能权限', key: 'perms', width: 120, align: 'center', render: (_: any, r: DevRole) => <Tag color="geekblue">{r.permissions.length} 项</Tag> },
    { title: '包含用户数', key: 'users', width: 110, align: 'center', render: (_: any, r: DevRole) => roleUsers(r.id).length },
    {
      title: '操作', key: 'action', width: 140, align: 'center',
      render: (_: any, r: DevRole) => (
        <Space size={4}>
          <Tooltip title="编辑"><Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)} /></Tooltip>
          <Popconfirm title="确定删除该角色？" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button size="small" type="link" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="角色权限"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增角色</Button>}
      >
        <Table rowKey="id" bordered size="middle" columns={columns} dataSource={roles} pagination={false}
          locale={{ emptyText: '暂无角色，点击「新增角色」创建（如：客服组、销售组）' }} />
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="角色组长制设置方法（参考 my-crm）"
          description={
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
              <li>创建组角色：角色名称取组名（如"腾辉组"），数据权限选择「组员数据（组长可查看组员数据）」后保存。</li>
              <li>绑定组长：在「账号管理」中将组长子账号的角色修改为该组角色。</li>
              <li>添加组员：编辑该组角色，在「组员管理」中展开组长，勾选需要绑定的组员；每个组员只能绑定一个组长。</li>
              <li>设置完成后，组长在客户管理中可查看自己及绑定组员领取的客户，实现按组隔离的数据权限。</li>
            </ol>
          }
        />
      </Card>

      <Modal
        title={editing ? `编辑角色 - ${editing.name}` : '新增角色'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]} style={{ width: 290 }}>
              <Input placeholder="如：客服一组" maxLength={20} />
            </Form.Item>
            <Form.Item name="dataScope" label="数据权限" style={{ width: 290 }}>
              <Select onChange={(v: any) => setFormScope(v)} options={[
                { value: 'ALL', label: '全部客户数据' },
                { value: 'OWN', label: '仅本人负责的数据' },
                { value: 'TEAM', label: '组员数据（组长可查看组员数据）' },
              ]} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input placeholder="角色描述（选填）" maxLength={50} />
          </Form.Item>
        </Form>

        {formScope === 'TEAM' && editing && (
          <div style={{ border: '1px solid #d3adf7', borderRadius: 8, padding: 12, background: '#f9f0ff', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#531dab', marginBottom: 8 }}><TeamOutlined style={{ marginRight: 6 }} />组员管理（为组长绑定组员）</div>
            {roleUsers(editing.id).length === 0 && <div style={{ fontSize: 12, color: '#999' }}>当前角色暂无用户，请先在「账号管理」中将子账号分配到此角色</div>}
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {roleUsers(editing.id).map(leader => {
                const rel = teamRels.find(t => t.leader === leader.username);
                const memberIds = rel?.members || [];
                const expanded = expandedLeader === leader.username;
                return (
                  <div key={leader.username} style={{ border: '1px solid #efdbff', borderRadius: 6, background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', cursor: 'pointer' }} onClick={() => setExpandedLeader(expanded ? null : leader.username)}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{leader.displayName}</span>
                      <span style={{ fontSize: 12, color: '#999' }}>{memberIds.length} 名组员 {expanded ? '▲' : '▼'}</span>
                    </div>
                    {expanded && (
                      <div style={{ padding: '0 10px 8px', borderTop: '1px solid #f5f0ff' }}>
                        <div style={{ fontSize: 11, color: '#999', margin: '6px 0' }}>选择该组长的组员（可多选，每个组员只能绑定一个组长）：</div>
                        <Space wrap size={4}>
                          {subs.filter(s => s.username !== leader.username).map(s => {
                            const selected = memberIds.includes(s.username);
                            const other = teamRels.find(t => t.leader !== leader.username && t.members.includes(s.username));
                            return (
                              <Tag key={s.username}
                                style={{ cursor: 'pointer', marginRight: 0 }}
                                color={selected ? 'purple' : other ? 'orange' : 'default'}
                                onClick={() => toggleMember(leader.username, s.username)}>
                                {s.displayName}{other ? `[${subs.find(x => x.username === other.leader)?.displayName || other.leader}]` : ''}
                              </Tag>
                            );
                          })}
                        </Space>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {formScope === 'TEAM' && !editing && (
          <div style={{ fontSize: 12, color: '#722ed1', marginBottom: 12 }}>保存后编辑该角色即可为组长绑定组员</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>功能权限</span>
          <Space size={8}>
            <Button type="link" size="small" onClick={() => setFormPerms([...ALL_DEV_PERMISSION_KEYS])}>全选</Button>
            <Button type="link" size="small" onClick={() => setFormPerms([])}>取消全选</Button>
          </Space>
        </div>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {DEV_PERMISSION_GROUPS.map(g => {
            const keys = g.items.map(i => i.key);
            const checkedCount = keys.filter(k => formPerms.includes(k)).length;
            return (
              <div key={g.group}>
                <Checkbox
                  checked={checkedCount === keys.length}
                  indeterminate={checkedCount > 0 && checkedCount < keys.length}
                  onChange={e => setFormPerms(prev => e.target.checked
                    ? Array.from(new Set([...prev, ...keys]))
                    : prev.filter(k => !keys.includes(k)))}
                >
                  <span style={{ fontWeight: 700 }}>{g.label}</span>
                </Checkbox>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px', paddingLeft: 24 }}>
                  {g.items.map(i => (
                    <Checkbox key={i.key} checked={formPerms.includes(i.key)}
                      onChange={e => setFormPerms(prev => e.target.checked ? [...prev, i.key] : prev.filter(k => k !== i.key))}>
                      {i.label}
                    </Checkbox>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};

export default DevRolesPage;
