import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, DatePicker, InputNumber, Space, Tag, message, Row, Col, Statistic,
} from 'antd';
import { PlusOutlined, CheckOutlined, CloseOutlined, CalendarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useDatasetSyncReload, applyIfChanged } from '../../utils/useDatasetSyncReload';

const { RangePicker } = DatePicker;
const PRIMARY = '#1e4a7e';

interface LeaveRecord {
  key: string;
  employeeUsername: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
}

const LEAVE_TYPES = ['事假', '病假', '年假', '调休', '婚假', '产假', '丧假'];

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (!isSub) return localStorage.getItem('username') || '';
  let parent = localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  try {
    const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const p = regUsers.find((u: any) => u.username === parent);
      if (!p || !p.isSubAccount) break;
      parent = p.parentAccount || '';
    }
  } catch { /* ignore */ }
  return parent;
};

const getStorageKey = () => `hr_leaves_${getDataOwner()}`;
const getAccountsKey = () => `accounts_${getDataOwner()}`;

const loadLeaves = (): LeaveRecord[] => {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

const loadEmployees = (): { username: string; displayName: string }[] => {
  try {
    const raw = localStorage.getItem(getAccountsKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((a: any) => a.accountType === '子账号').map((a: any) => ({ username: a.username, displayName: a.displayName || a.username }));
    }
  } catch { /* ignore */ }
  return [];
};

// 审批人显示姓名：账号管理 displayName/person → registeredUsers displayName/contactPerson → 用户名
const resolveApproverName = (username: string): string => {
  if (!username) return '-';
  try {
    const arr = JSON.parse(localStorage.getItem(getAccountsKey()) || '[]');
    if (Array.isArray(arr)) {
      const acc = arr.find((a: any) => a.username === username);
      if (acc?.displayName) return acc.displayName;
      if (acc?.person) return acc.person;
    }
  } catch { /* ignore */ }
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((r: any) => r.username === username);
    if (u?.displayName) return u.displayName;
    if (u?.contactPerson) return u.contactPerson;
  } catch { /* ignore */ }
  return username;
};

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  approved: { color: 'green', text: '已通过' },
  rejected: { color: 'red', text: '已拒绝' },
};

const LeavePage: React.FC = () => {
  const [leaves, setLeaves] = useState<LeaveRecord[]>(loadLeaves);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employees, setEmployees] = useState<{ username: string; displayName: string }[]>(loadEmployees);

  // 同步落地/窗口重新可见时重读：本页有「leaves 一变就整表写盘」的副作用，
  // 保活期间只要拿陈旧快照做一次审批，就会把其他端刚提交的请假整份擦掉
  useDatasetSyncReload(() => {
    applyIfChanged(setLeaves, loadLeaves());
    applyIfChanged(setEmployees, loadEmployees());
  });

  useEffect(() => {
    localStorage.setItem(getStorageKey(), JSON.stringify(leaves));
  }, [leaves]);

  const stats = useMemo(() => {
    const approved = leaves.filter(l => l.status === 'approved');
    return {
      total: leaves.length,
      pending: leaves.filter(l => l.status === 'pending').length,
      approved: approved.length,
      totalDays: approved.reduce((s, l) => s + l.days, 0),
    };
  }, [leaves]);

  const filteredData = useMemo(() => {
    return leaves.filter(l => {
      const matchSearch = !searchText || l.employeeName.includes(searchText) || l.type.includes(searchText);
      const matchStatus = !statusFilter || l.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [leaves, searchText, statusFilter]);

  const handleAdd = useCallback(() => {
    form.resetFields();
    setModalVisible(true);
  }, [form]);

  const handleSave = useCallback(() => {
    form.validateFields().then(values => {
      const emp = employees.find(e => e.username === values.employeeUsername);
      const [start, end] = values.dateRange;
      const days = values.days || end.diff(start, 'day') + 1;
      const record: LeaveRecord = {
        key: `leave_${Date.now()}`,
        employeeUsername: values.employeeUsername,
        employeeName: emp?.displayName || values.employeeUsername,
        type: values.type,
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        days,
        reason: values.reason || '',
        status: 'pending',
        approvedBy: '',
        approvedAt: '',
        createdAt: new Date().toISOString(),
      };
      setLeaves(prev => [record, ...prev]);
      setModalVisible(false);
      message.success('请假申请已提交');
    }).catch(() => { /* 校验失败 */ });
  }, [form, employees]);

  const handleApprove = useCallback((key: string) => {
    const username = localStorage.getItem('username') || '';
    setLeaves(prev => prev.map(l => l.key === key ? { ...l, status: 'approved' as const, approvedBy: username, approvedAt: new Date().toISOString() } : l));
    message.success('已通过');
  }, []);

  const handleReject = useCallback((key: string) => {
    const username = localStorage.getItem('username') || '';
    setLeaves(prev => prev.map(l => l.key === key ? { ...l, status: 'rejected' as const, approvedBy: username, approvedAt: new Date().toISOString() } : l));
    message.success('已拒绝');
  }, []);

  const columns: ColumnsType<LeaveRecord> = useMemo(() => [
    { title: '员工', dataIndex: 'employeeName', width: 100, align: 'center' },
    { title: '请假类型', dataIndex: 'type', width: 90, align: 'center',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: '开始日期', dataIndex: 'startDate', width: 120, align: 'center' },
    { title: '结束日期', dataIndex: 'endDate', width: 120, align: 'center' },
    { title: '天数', dataIndex: 'days', width: 70, align: 'center' },
    { title: '事由', dataIndex: 'reason', width: 200, align: 'center', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 90, align: 'center',
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    { title: '审批人', dataIndex: 'approvedBy', width: 100, align: 'center', render: (v: string) => v ? resolveApproverName(v) : '-' },
    { title: '审批时间', dataIndex: 'approvedAt', width: 150, align: 'center',
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    { title: '申请时间', dataIndex: 'createdAt', width: 160, align: 'center',
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    { title: '操作', width: 140, align: 'center',
      render: (_: any, r: LeaveRecord) => r.status === 'pending' ? (
        <Space size="small">
          <Button type="link" size="small" icon={<CheckOutlined />} style={{ color: '#52c41a' }} onClick={() => handleApprove(r.key)}>通过</Button>
          <Button type="link" size="small" danger icon={<CloseOutlined />} onClick={() => handleReject(r.key)}>拒绝</Button>
        </Space>
      ) : <span style={{ color: '#999' }}>-</span>,
    },
  ], [handleApprove, handleReject]);

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff', padding: '20px 28px', borderRadius: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>请假管理</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>请假申请与审批管理</div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', fontWeight: 600 }}>新增请假</Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="总申请" value={stats.total} prefix={<CalendarOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="待审批" value={stats.pending} valueStyle={{ color: '#faad14' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已通过" value={stats.approved} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已批准总天数" value={stats.totalDays} suffix="天" /></Card></Col>
      </Row>

      <Card bodyStyle={{ padding: '12px 16px' }} style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="搜索员工/类型" allowClear style={{ width: 200 }} onSearch={v => setSearchText(v)} onChange={e => { if (!e.target.value) setSearchText(''); }} />
          <Select placeholder="状态筛选" allowClear style={{ width: 130 }} onChange={v => setStatusFilter(v || '')}>
            <Select.Option value="pending">待审批</Select.Option>
            <Select.Option value="approved">已通过</Select.Option>
            <Select.Option value="rejected">已拒绝</Select.Option>
          </Select>
        </Space>
      </Card>

      <Card bodyStyle={{ padding: 0 }}>
        <Table<LeaveRecord>
          columns={columns}
          dataSource={filteredData}
          rowKey="key"
          pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }}
          bordered
          size="middle"
          scroll={{ x: 1340 }}
        />
      </Card>

      <Modal title="新增请假申请" open={modalVisible} onOk={handleSave} onCancel={() => setModalVisible(false)} okText="提交" cancelText="取消" width={520}>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="employeeUsername" label="员工" rules={[{ required: true, message: '请选择员工' }]}>
            <Select showSearch placeholder="选择员工" optionFilterProp="label"
              options={employees.map(e => ({ value: e.username, label: e.displayName }))}
            />
          </Form.Item>
          <Form.Item name="type" label="请假类型" rules={[{ required: true, message: '请选择' }]}>
            <Select placeholder="选择请假类型" options={LEAVE_TYPES.map(t => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="dateRange" label="日期范围" rules={[{ required: true, message: '请选择' }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="days" label="天数">
            <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} placeholder="不填则按日期范围自动计算" />
          </Form.Item>
          <Form.Item name="reason" label="事由">
            <Input.TextArea rows={3} placeholder="请输入请假事由" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default LeavePage;
