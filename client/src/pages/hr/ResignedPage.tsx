/**
 * 离职人员页（人事管理 → 离职人员）
 * 与员工档案页互补：员工档案仅显示在职人员，本页显示已离职（账号停用）人员，
 * 提供离职原因/离职日期/离职时长查看与「复职」闭环操作。
 * 复职 = 恢复账号可用（accounts.status + registeredUsers.accountStatus）+ 最近一条生效离职记录标记 rehired，
 * 工资自复职日期起恢复计算（复职当日计薪）。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Modal, Form, Input, DatePicker, Space, Tag, message, Row, Col, Statistic, Tooltip } from 'antd';
import { UserDeleteOutlined, TeamOutlined, FileTextOutlined, RollbackOutlined, UserSwitchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  ResignationRecord, getDataOwner, loadResignations, applyDueResignations, rehireEmployee, resignStateOf,
} from './resignationStore';
import { loadChangeLog, appendChangeLog, getOperatorName } from './EmployeePage';
import type { EmployeeChangeLogEntry } from './EmployeePage';

const PRIMARY = '#1e4a7e';

interface ResignedView {
  username: string;
  id: string;
  name: string;
  department: string;
  role: string;
  hireDate: string;
  reason: string;
  resignDate: string;
  resignDays: number; // 离职时长（天）
  rec: ResignationRecord | null;
}

const roleMap: Record<string, string> = {
  super_admin: '超级管理员', admin: '管理员', user: '普通用户', viewer: '只读用户',
};

const loadAccounts = (): any[] => {
  try {
    const raw = localStorage.getItem(`accounts_${getDataOwner()}`);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

const ResignedPage: React.FC = () => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [resignations, setResignations] = useState<ResignationRecord[]>(loadResignations);
  const [rehireVisible, setRehireVisible] = useState(false);
  const [rehireTarget, setRehireTarget] = useState<ResignedView | null>(null);
  const [rehireForm] = Form.useForm();
  const [logVisible, setLogVisible] = useState(false);
  const [logScope, setLogScope] = useState('');
  const [logData, setLogData] = useState<EmployeeChangeLogEntry[]>([]);

  // 挂载时巡检到期待生效的离职计划（与员工档案页同口径）
  useEffect(() => {
    const applied = applyDueResignations();
    if (applied.length) {
      setResignations(loadResignations());
      setRefreshKey(k => k + 1);
    }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === `accounts_${getDataOwner()}`) setRefreshKey(k => k + 1);
      if (e.key === `hr_resignations_${getDataOwner()}`) setResignations(loadResignations());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 离职人员 = 子账号且账号已停用；离职信息取最近一条离职记录
  const resignedList: ResignedView[] = useMemo(() => {
    return loadAccounts()
      .filter((a: any) => a.accountType === '子账号' && a.status === 'disabled')
      .map((a: any) => {
        const rec = resignStateOf(resignations, a.username);
        const resignDate = rec && rec.status !== 'pending' ? rec.resignDate : '';
        return {
          username: a.username,
          id: a.id || '-',
          name: a.displayName || a.username,
          department: a.group || '-',
          role: roleMap[a.role] || a.role || '-',
          hireDate: a.date || '-',
          reason: rec && rec.status !== 'pending' ? rec.reason : '手动停用（账号管理）',
          resignDate: resignDate || '-',
          resignDays: resignDate ? dayjs().diff(dayjs(resignDate), 'day') : 0,
          rec: rec && rec.status !== 'pending' ? rec : null,
        };
      });
  }, [resignations, refreshKey]);

  const filteredData = useMemo(() => resignedList.filter(r =>
    !searchText || r.name.includes(searchText) || r.id.toLowerCase().includes(searchText.toLowerCase()) || r.username.includes(searchText)
  ), [resignedList, searchText]);

  const stats = useMemo(() => ({
    resigned: resignedList.length,
    thisMonth: resignedList.filter(r => r.resignDate !== '-' && dayjs(r.resignDate).format('YYYY-MM') === dayjs().format('YYYY-MM')).length,
    rehired: resignations.filter(r => r.status === 'rehired').length,
  }), [resignedList, resignations]);

  const openChangeLog = useCallback((username: string, name: string) => {
    setLogScope(name);
    setLogData(loadChangeLog().filter(x => x.username === username));
    setLogVisible(true);
  }, []);

  const openRehireModal = useCallback((r: ResignedView) => {
    setRehireTarget(r);
    rehireForm.resetFields();
    rehireForm.setFieldsValue({ rehireDate: dayjs() });
    setRehireVisible(true);
  }, [rehireForm]);

  const handleRehireConfirm = useCallback(() => {
    rehireForm.validateFields().then(values => {
      if (!rehireTarget) return;
      const rehireDate = values.rehireDate.format('YYYY-MM-DD');
      const note = values.note || '';
      rehireEmployee(rehireTarget.username, rehireDate, note);
      appendChangeLog([{
        key: `elog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username: rehireTarget.username, empName: rehireTarget.name, empId: rehireTarget.id,
        time: new Date().toLocaleString('zh-CN'),
        operator: getOperatorName(),
        source: '离职管理',
        changes: [{ field: '复职', old: `离职（${rehireTarget.resignDate}）`, new: `复职（${rehireDate}，账号已恢复可用，工资自复职日起计算）${note ? `；备注：${note}` : ''}` }],
      }]);
      setResignations(loadResignations());
      setRefreshKey(k => k + 1);
      setRehireVisible(false);
      message.success(`已复职：${rehireTarget.name} 的账号已恢复可用，自 ${rehireDate} 起恢复计薪`);
    }).catch(() => { /* 校验失败 */ });
  }, [rehireForm, rehireTarget]);

  const columns: ColumnsType<ResignedView> = useMemo(() => [
    { title: '工号', dataIndex: 'id', key: 'id', width: 100, align: 'center' },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 100, align: 'center' },
    { title: '账号', dataIndex: 'username', key: 'username', width: 120, align: 'center', render: (v: string) => <span style={{ color: '#888', fontSize: 12 }}>{v}</span> },
    { title: '部门', dataIndex: 'department', key: 'department', width: 100, align: 'center' },
    { title: '角色', dataIndex: 'role', key: 'role', width: 110, align: 'center' },
    { title: '入职日期', dataIndex: 'hireDate', key: 'hireDate', width: 110, align: 'center' },
    { title: '离职原因', dataIndex: 'reason', key: 'reason', width: 160, align: 'center',
      render: (v: string, r: ResignedView) => r.rec?.reasonNote
        ? <Tooltip title={r.rec.reasonNote}><span>{v}</span></Tooltip>
        : v,
    },
    { title: '离职日期', dataIndex: 'resignDate', key: 'resignDate', width: 110, align: 'center',
      render: (v: string) => v !== '-' ? <span style={{ color: '#ff4d4f' }}>{v}</span> : '-',
    },
    { title: '离职时长', key: 'duration', width: 100, align: 'center',
      render: (_: any, r: ResignedView) => r.resignDate !== '-' ? `${r.resignDays} 天` : '-',
    },
    { title: '操作', key: '_action', width: 150, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: ResignedView) => (
        <Space size={0}>
          <Tooltip title="恢复账号可用并自复职日期起恢复计薪">
            <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => openRehireModal(r)}>复职</Button>
          </Tooltip>
          <Tooltip title="查看信息变更日志（含离职/复职记录）">
            <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => openChangeLog(r.username, r.name)}>日志</Button>
          </Tooltip>
        </Space>
      ),
    },
  ], [openRehireModal, openChangeLog]);

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff', padding: '20px 28px', borderRadius: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}><UserDeleteOutlined style={{ marginRight: 8 }} />离职人员</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>离职人员账号已停用（无法登录），资料与HR档案保留；可在此办理复职</div>
        </div>
        <Tag icon={<UserSwitchOutlined />} color="processing" style={{ padding: '4px 12px', fontSize: 12 }}>在职人员请到「人事管理 → 员工档案」查看</Tag>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Statistic title="离职人数" value={stats.resigned} valueStyle={{ color: '#ff4d4f' }} prefix={<UserDeleteOutlined />} /></Card></Col>
        <Col span={8}><Card><Statistic title="本月离职" value={stats.thisMonth} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={8}><Card><Statistic title="累计复职" value={stats.rehired} valueStyle={{ color: '#52c41a' }} prefix={<TeamOutlined />} /></Card></Col>
      </Row>

      <Card bodyStyle={{ padding: '12px 16px' }} style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="搜索姓名/工号/账号" allowClear style={{ width: 220 }} onSearch={v => setSearchText(v)} onChange={e => { if (!e.target.value) setSearchText(''); }} />
        </Space>
      </Card>

      <Card bodyStyle={{ padding: 0 }}>
        <Table<ResignedView>
          columns={columns}
          dataSource={filteredData}
          rowKey="username"
          pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }}
          bordered
          size="middle"
          scroll={{ x: 1160 }}
          locale={{ emptyText: '暂无离职人员' }}
        />
      </Card>

      {/* 复职弹窗：复职日期 + 备注；确认后账号恢复可用、工资自复职日起计算 */}
      <Modal
        title={`复职 - ${rehireTarget?.name || ''}`}
        open={rehireVisible}
        onOk={handleRehireConfirm}
        onCancel={() => setRehireVisible(false)}
        okText="确认复职" cancelText="取消" width={440}
      >
        <Form autoComplete="off" form={rehireForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="rehireDate" label="复职日期" rules={[{ required: true, message: '请选择复职日期' }]}
            extra="复职后账号恢复可用（可登录），工资自复职日期起恢复计算（复职当日计薪）">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="备注（可选）">
            <Input.TextArea rows={2} placeholder="复职备注（如：返聘/调岗复职）" maxLength={100} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* 变更日志弹窗（单员工） */}
      <Modal
        title={`变更日志 - ${logScope}`}
        open={logVisible}
        onCancel={() => setLogVisible(false)}
        footer={[<Button key="close" onClick={() => setLogVisible(false)}>关闭</Button>]}
        width={780}
      >
        <Table<EmployeeChangeLogEntry>
          size="small" bordered rowKey="key" dataSource={logData}
          pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无变更日志' }}
          columns={[
            { title: '时间', dataIndex: 'time', key: 'time', width: 150 },
            { title: '操作人', dataIndex: 'operator', key: 'operator', width: 110 },
            { title: '来源', dataIndex: 'source', key: 'source', width: 90, align: 'center' as const,
              render: (v: string) => <Tag color={v === '账号同步' ? 'orange' : v === '档案建立' ? 'green' : v === '离职管理' ? 'red' : 'blue'}>{v}</Tag> },
            { title: '变更内容', key: 'changes',
              render: (_: any, r: EmployeeChangeLogEntry) => (
                <div style={{ fontSize: 12 }}>
                  {r.changes.map((c, i) => (
                    <div key={i}>
                      <span style={{ fontWeight: 600 }}>{c.field}</span>：
                      <span style={{ color: '#999' }}>{c.old}</span>
                      <span style={{ color: '#52c41a', margin: '0 4px' }}>→</span>
                      <span style={{ color: PRIMARY, fontWeight: 600 }}>{c.new}</span>
                    </div>
                  ))}
                </div>
              ) },
          ] as any}
        />
      </Modal>
    </div>
  );
};

export default ResignedPage;
