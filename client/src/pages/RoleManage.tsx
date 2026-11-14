import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Card, Row, Col, Typography, Table, Tag, Button, Space, Modal, Form, Input,
  message, Checkbox, Badge, Popconfirm, Divider, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined,
  SettingOutlined, CheckCircleOutlined, LockOutlined, SyncOutlined, InfoCircleOutlined, HistoryOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  permissionModules, presetRoles, RoleRecord, getRolesStorageKey,
  loadCustomRoles, getAllRoles, savePresetOverride, resetPresetOverride,
} from '../config/permissions';
import PermEditor from '../components/PermEditor';
import { loadRolePermSettings, saveRolePermSettings, loadPermAudit } from '../utils/perm';
import type { PermAuditEntry } from '../utils/perm';
import type { PermTri } from '../config/permRegistry';
import { useDatasetSyncReload, applyIfChanged } from '../utils/useDatasetSyncReload';

const { Title, Text } = Typography;
const PRIMARY = '#1e4a7e';

const RoleManage: React.FC = () => {
  const [customRoles, setCustomRoles] = useState<RoleRecord[]>(loadCustomRoles);
  // PERM_V2 三态覆写草稿（编辑弹窗内）
  const [roleTriDraft, setRoleTriDraft] = useState<Record<string, PermTri>>({});
  // 权限变更记录
  const [auditVisible, setAuditVisible] = useState(false);
  const [auditList, setAuditList] = useState<PermAuditEntry[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();

  // 所有角色 = 预设 + 自定义
  const allRoles = useMemo(() => [...presetRoles, ...customRoles], [customRoles]);

  // 同步落地/窗口重新可见时重读：角色表在别端新建/改权限后本端不刷新，
  // 本端再建一个角色就会拿陈旧自定义角色表整表回写，把别端刚建的角色抹掉
  useDatasetSyncReload(() => {
    // 角色编辑弹窗正在编辑时不覆盖，避免把填到一半的权限勾选冲掉
    if (!editVisible) applyIfChanged(setCustomRoles, loadCustomRoles());
  });

  // 持久化自定义角色
  const saveCustomRoles = useCallback((roles: RoleRecord[]) => {
    setCustomRoles(roles);
    localStorage.setItem(getRolesStorageKey(), JSON.stringify(roles));
  }, []);

  // 新建角色
  const handleAdd = useCallback(() => {
    addForm.resetFields();
    setAddVisible(true);
  }, [addForm]);

  const handleAddConfirm = useCallback(() => {
    addForm.validateFields().then(values => {
      const name = values.name.trim();
      if (allRoles.some(r => r.name === name)) {
        message.error(`角色名「${name}」已存在`);
        return;
      }
      const permissions: string[] = values.permissions || [];
      const newRole: RoleRecord = {
        key: `role-custom-${Date.now()}`,
        name,
        description: values.description || '',
        permissions,
        isPreset: false,
      };
      const updated = [...customRoles, newRole];
      saveCustomRoles(updated);
      message.success(`角色「${name}」创建成功`);
      setAddVisible(false);
      addForm.resetFields();
    });
  }, [addForm, customRoles, allRoles, saveCustomRoles]);

  // 编辑角色
  const handleEdit = useCallback((record: RoleRecord) => {
    setEditingRole(record);
    setRoleTriDraft(loadRolePermSettings()[record.key] || {});
    editForm.setFieldsValue({
      name: record.name,
      description: record.description,
      permissions: record.permissions,
    });
    setEditVisible(true);
  }, [editForm]);

  const handleEditConfirm = useCallback(() => {
    editForm.validateFields().then(values => {
      if (!editingRole) return;
      const name = values.name.trim();
      const permissions: string[] = values.permissions || [];

      if (editingRole.isPreset) {
        // 预设角色：保存覆盖配置到 localStorage
        savePresetOverride(editingRole.key, permissions);
        message.success(`预设角色「${name}」的权限已更新`);
      } else {
        // 自定义角色：直接更新
        if (name !== editingRole.name && allRoles.some(r => r.name === name)) {
          message.error(`角色名「${name}」已存在`);
          return;
        }
        const updated = customRoles.map(r =>
          r.key === editingRole.key
            ? { ...r, name, description: values.description || '', permissions }
            : r
        );
        saveCustomRoles(updated);
        message.success(`角色「${name}」已更新`);
      }
      saveRolePermSettings(editingRole.key, roleTriDraft);
      setEditVisible(false);
      editForm.resetFields();
      setEditingRole(null);
    });
  }, [editForm, editingRole, customRoles, allRoles, saveCustomRoles]);

  // 删除角色
  const handleDelete = useCallback((record: RoleRecord) => {
    const updated = customRoles.filter(r => r.key !== record.key);
    saveCustomRoles(updated);
    message.success(`角色「${record.name}」已删除`);
  }, [customRoles, saveCustomRoles]);

  // 重置预设角色
  const handleResetPreset = useCallback((record: RoleRecord) => {
    resetPresetOverride(record.key);
    message.success(`预设角色「${record.name}」已恢复默认配置`);
  }, []);

  // 渲染权限选择器（按模块分组的 Checkbox 树）
  const renderPermissionSelector = (fieldName: string = 'permissions') => (
    <Form.Item
      name={fieldName}
      label="权限配置"
      rules={[{ required: true, message: '请至少选择一个权限' }]}
    >
      <Checkbox.Group style={{ width: '100%' }}>
        {permissionModules.map(mod => {
          const modPerms = mod.children.map(c => `${mod.key}/${c.key}`);
          return (
            <div key={mod.key} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <Checkbox
                  indeterminate={false}
                  onChange={(e) => {
                    const form = addVisible ? addForm : editForm;
                    const currentPerms: string[] = form.getFieldValue('permissions') || [];
                    const otherPerms = currentPerms.filter(p => !modPerms.includes(p));
                    const newPerms = e.target.checked
                      ? [...otherPerms, ...modPerms]
                      : otherPerms;
                    form.setFieldsValue({ permissions: newPerms });
                  }}
                >
                  <Text strong style={{ fontSize: 14 }}>{mod.label}</Text>
                </Checkbox>
                <Tag color="blue" style={{ marginLeft: 8 }}>{modPerms.length}项</Tag>
              </div>
              <Row gutter={[8, 4]} style={{ marginLeft: 24 }}>
                {mod.children.map(child => (
                  <Col span={8} key={`${mod.key}/${child.key}`}>
                    <Checkbox value={`${mod.key}/${child.key}`}>
                      {child.label}
                    </Checkbox>
                  </Col>
                ))}
              </Row>
              <Divider style={{ margin: '8px 0' }} />
            </div>
          );
        })}
      </Checkbox.Group>
    </Form.Item>
  );

  // 表格列定义
  const columns: ColumnsType<RoleRecord> = [
    { title: '角色名称', dataIndex: 'name', key: 'name', width: 150 },
    {
      title: '类型', dataIndex: 'isPreset', key: 'type', width: 100,
      render: (isPreset: boolean) => (
        <Tag color={isPreset ? 'gold' : 'blue'}>{isPreset ? '预设' : '自定义'}</Tag>
      ),
    },
    {
      title: '权限数量', key: 'permCount', width: 100,
      render: (_, record) => (
        <Badge count={record.permissions.length} style={{ backgroundColor: PRIMARY }} />
      ),
    },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '操作', key: 'action', width: 220,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          {record.isPreset ? (
            <Popconfirm
              title={`确定恢复「${record.name}」的默认权限吗？`}
              description="恢复后所有修改将丢失"
              onConfirm={() => handleResetPreset(record)}
              okText="确认恢复"
              cancelText="取消"
            >
              <Button type="link" size="small" icon={<SyncOutlined />}>
                恢复默认
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title={`确定删除角色「${record.name}」吗？`}
              description="删除后已分配该角色的子账号将失去相关权限"
              onConfirm={() => handleDelete(record)}
              okText="确认删除"
              okType="danger"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 页面头部 */}
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`,
        color: '#fff', padding: '20px 28px', borderRadius: 12, marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SafetyCertificateOutlined style={{ fontSize: 22, color: '#fff' }} />
          </div>
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>角色管理</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              管理角色和权限配置，为子账号分配访问权限
            </Text>
          </div>
        </div>
        <Space>
          <Button icon={<HistoryOutlined />} onClick={() => { setAuditList(loadPermAudit()); setAuditVisible(true); }}>
            变更记录
          </Button>
          <Button type="primary" ghost icon={<PlusOutlined />} onClick={handleAdd}>
            新建角色
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SafetyCertificateOutlined style={{ fontSize: 28, color: PRIMARY }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>总角色数</Text>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#1a2b45' }}>{allRoles.length}</div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <LockOutlined style={{ fontSize: 28, color: '#faad14' }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>预设角色</Text>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#faad14' }}>{presetRoles.length}</div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SettingOutlined style={{ fontSize: 28, color: '#1890ff' }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>自定义角色</Text>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#1890ff' }}>{customRoles.length}</div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 角色列表 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        <Table
          columns={columns}
          dataSource={allRoles}
          rowKey="key"
          scroll={{ x: 800 }}
          size="middle"
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 个角色` }}
          locale={{ emptyText: '暂无角色' }}
        />
      </Card>

      {/* 新建角色弹窗 */}
      <Modal
        title={<span><PlusOutlined style={{ marginRight: 8, color: '#52c41a' }} />新建角色</span>}
        open={addVisible}
        onCancel={() => { setAddVisible(false); addForm.resetFields(); }}
        onOk={handleAddConfirm}
        okText="创建角色"
        cancelText="取消"
        width={700}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
      >
        <Form autoComplete="off" form={addForm} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
                <Input placeholder="请输入角色名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="角色描述">
                <Input placeholder="请输入角色描述（选填）" />
              </Form.Item>
            </Col>
          </Row>
          {renderPermissionSelector()}
        </Form>
      </Modal>

      {/* 编辑角色弹窗 */}
      <Modal
        title={<span><EditOutlined style={{ marginRight: 8, color: PRIMARY }} />编辑角色 - {editingRole?.name}</span>}
        open={editVisible}
        onCancel={() => { setEditVisible(false); editForm.resetFields(); setEditingRole(null); }}
        onOk={handleEditConfirm}
        okText="保存修改"
        cancelText="取消"
        width={700}
        bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
      >
        <Form autoComplete="off" form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
                <Input placeholder="请输入角色名称" disabled={editingRole?.isPreset} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="角色描述">
                <Input placeholder="请输入角色描述（选填）" disabled={editingRole?.isPreset} />
              </Form.Item>
            </Col>
          </Row>
          {editingRole?.isPreset && (
            <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>
              <Text style={{ color: '#d48806', fontSize: 12 }}>
                <InfoCircleOutlined style={{ marginRight: 6 }} />
                预设角色的名称和描述不可修改，仅可调整权限配置。点击“恢复默认”可还原初始权限。
              </Text>
            </div>
          )}
          {renderPermissionSelector()}
          {/* PERM_V2 三态细粒度覆写 */}
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <Text strong style={{ fontSize: 13 }}>细粒度控制（三态覆写）</Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '4px 0 8px' }}>允许/禁止为显式声明；继承=沿用 用户&gt;开发者&gt;角色&gt;默认 解析链。禁止优先于一切允许。</Text>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              <PermEditor scopes={['supplier']} value={roleTriDraft} onChange={setRoleTriDraft} />
            </div>
          </div>
        </Form>
      </Modal>
      {/* 权限变更记录 */}
      <Modal
        title={<span><HistoryOutlined style={{ marginRight: 8, color: PRIMARY }} />权限变更记录（最近 200 条）</span>}
        open={auditVisible}
        onCancel={() => setAuditVisible(false)}
        footer={<Button onClick={() => setAuditVisible(false)}>关闭</Button>}
        width={760}
      >
        <Table
          size="small"
          rowKey={(r: PermAuditEntry, i?: number) => `${r.time}-${i ?? 0}`}
          dataSource={auditList}
          pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }}
          columns={[
            { title: '时间', dataIndex: 'time', width: 160 },
            { title: '操作人', dataIndex: 'operator', width: 120 },
            { title: '动作', dataIndex: 'action', width: 180 },
            { title: '详情', dataIndex: 'detail', ellipsis: true },
          ]}
          locale={{ emptyText: '暂无变更记录' }}
        />
      </Modal>
    </div>
  );
};

export default RoleManage;
