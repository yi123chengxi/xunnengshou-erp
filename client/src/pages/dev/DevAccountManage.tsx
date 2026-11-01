import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, message, Tag, Popconfirm, Tooltip, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, LockOutlined, StopOutlined, CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { loadDevSubAccounts, saveDevSubAccounts, getDevIdentity, loadDevRoles } from '../../utils/devStore';
import type { DevSubAccount } from '../../utils/devStore';

// 开发者后台 - 系统设置 - 账号管理：为开发者平台单独创建子账号，供开发者业务员使用
const DevAccountManage: React.FC = () => {
  const identity = getDevIdentity();
  const [dataSource, setDataSource] = useState<DevSubAccount[]>([]);
  const [roles, setRoles] = useState<ReturnType<typeof loadDevRoles>>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [form] = Form.useForm();
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<DevSubAccount | null>(null);
  const [pwdForm] = Form.useForm();

  const load = useCallback(() => {
    // 主开发者看全部子账号；子账号仅看同主开发者下的
    const list = loadDevSubAccounts().filter(s => identity.user === 'dev' || s.parentDev === identity.parent);
    setDataSource(list);
    setRoles(loadDevRoles());
  }, [identity.user, identity.parent]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = useCallback(() => {
    form.validateFields().then(values => {
      const username = String(values.username || '').trim();
      let registered: any[] = [];
      try { registered = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
      if (registered.some(u => u.username === username) || username === 'dev') {
        message.error(`账号「${username}」与客户账号或主开发者冲突，请更换`);
        return;
      }
      if (loadDevSubAccounts().some(s => s.username === username)) {
        message.error(`子账号「${username}」已存在`);
        return;
      }
      const entry: DevSubAccount = {
        key: `devsub_${Date.now()}`,
        username,
        password: values.password,
        displayName: values.displayName || username,
        status: 'normal',
        createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
        parentDev: identity.parent,
      };
      const next = [...loadDevSubAccounts(), entry];
      saveDevSubAccounts(next);
      load();
      setAddVisible(false);
      form.resetFields();
      message.success(`子账号「${entry.displayName}」已创建，可用于开发者后台登录`);
    }).catch(() => {
      message.warning('请按照表单提示完善账号/密码/姓名后再保存');
    });
  }, [form, load, identity.parent]);

  const handleToggle = useCallback((rec: DevSubAccount) => {
    const next = loadDevSubAccounts().map(s => s.key === rec.key ? { ...s, status: s.status === 'normal' ? 'disabled' as const : 'normal' as const } : s);
    saveDevSubAccounts(next);
    load();
    message.success(rec.status === 'normal' ? `已禁用子账号「${rec.displayName}」` : `已启用子账号「${rec.displayName}」`);
  }, [load]);

  const handleDelete = useCallback((rec: DevSubAccount) => {
    saveDevSubAccounts(loadDevSubAccounts().filter(s => s.key !== rec.key));
    load();
    message.success(`已删除子账号「${rec.displayName}」`);
  }, [load]);

  const handleResetPwd = useCallback(() => {
    pwdForm.validateFields().then(values => {
      if (!pwdTarget) return;
      const next = loadDevSubAccounts().map(s => s.key === pwdTarget.key ? { ...s, password: values.password } : s);
      saveDevSubAccounts(next);
      load();
      setPwdVisible(false);
      pwdForm.resetFields();
      message.success('密码已重置');
    });
  }, [pwdForm, pwdTarget, load]);

  const handleAssignRole = useCallback((rec: DevSubAccount, roleId: string | undefined) => {
    saveDevSubAccounts(loadDevSubAccounts().map(s => s.key === rec.key ? { ...s, roleId } : s));
    load();
    const roleName = roles.find(r => r.id === roleId)?.name;
    message.success(roleName ? `已将「${rec.displayName}」的角色设置为「${roleName}」` : `已清除「${rec.displayName}」的角色`);
  }, [load, roles]);

  const columns: any[] = [
    { title: '登录账号', dataIndex: 'username', width: 140, align: 'center' },
    { title: '姓名', dataIndex: 'displayName', width: 120, align: 'center' },
    {
      title: '角色', key: 'role', width: 150, align: 'center',
      render: (_: any, r: DevSubAccount) => (
        <Select
          size="small"
          style={{ width: 130 }}
          placeholder="未分配"
          allowClear
          value={r.roleId || undefined}
          onChange={(v: string | undefined) => handleAssignRole(r, v)}
          options={roles.map(x => ({ value: x.id, label: x.name }))}
        />
      ),
    },
    { title: '归属主开发者', dataIndex: 'parentDev', width: 130, align: 'center' },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, align: 'center' },
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center',
      render: (v: string) => v === 'normal' ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag>,
    },
    {
      title: '操作', key: 'action', width: 220, align: 'center',
      render: (_: any, r: DevSubAccount) => (
        <Space size={4}>
          <Tooltip title="重置密码">
            <Button size="small" type="link" icon={<LockOutlined />} onClick={() => { setPwdTarget(r); setPwdVisible(true); }} />
          </Tooltip>
          {r.status === 'normal' ? (
            <Tooltip title="禁用">
              <Button size="small" type="link" danger icon={<StopOutlined />} onClick={() => handleToggle(r)} />
            </Tooltip>
          ) : (
            <Tooltip title="启用">
              <Button size="small" type="link" style={{ color: '#52c41a' }} icon={<CheckOutlined />} onClick={() => handleToggle(r)} />
            </Tooltip>
          )}
          <Popconfirm title={`确认删除子账号「${r.displayName}」？`} onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除">
              <Button size="small" type="link" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="账号管理 - 开发者子账号"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setAddVisible(true); }}>创建子账号</Button>}
      >
        <p style={{ color: '#999', fontSize: 12, marginTop: 0 }}>
          为开发者平台单独创建的子账号，供开发者业务员登录开发者后台使用（登录入口：开发者登录页）。子账号领取客户后，客户归属该子账号。
        </p>
        <Table rowKey="key" bordered size="middle" columns={columns} dataSource={dataSource}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无子账号，点击「创建子账号」添加' }} />
      </Card>

      <Modal title="创建开发者子账号" open={addVisible} onOk={handleAdd} onCancel={() => setAddVisible(false)} okText="创建" cancelText="取消" width={440} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="username" label="登录账号" rules={[
            { required: true, message: '请输入登录账号' },
            { pattern: /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/, message: '字母开头，4-20位字母数字下划线' },
          ]}>
            <Input placeholder="请输入子账号登录账号" />
          </Form.Item>
          <Form.Item name="password" label="登录密码" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少6位' }]}>
            <Input.Password placeholder="请输入登录密码" />
          </Form.Item>
          <Form.Item name="displayName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="业务员姓名（显示为负责人）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`重置密码 - ${pwdTarget?.displayName || ''}`} open={pwdVisible} onOk={handleResetPwd} onCancel={() => setPwdVisible(false)} okText="保存" cancelText="取消" width={400} destroyOnClose>
        <Form autoComplete="off" form={pwdForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少6位' }]}>
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DevAccountManage;
