import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, DatePicker, TimePicker, Space, Tag, message, Row, Col, Statistic, Calendar, Badge, Tooltip, Radio, Divider,
} from 'antd';
import {
  ClockCircleOutlined, CheckCircleOutlined, LoginOutlined, LogoutOutlined, PlusOutlined, BarChartOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useDatasetSyncReload, applyIfChanged } from '../../utils/useDatasetSyncReload';

const PRIMARY = '#1e4a7e';

interface AttendanceRecord {
  key: string;
  date: string;
  employeeUsername: string;
  employeeName: string;
  shiftKey: string;
  clockIn: string | null;
  clockOut: string | null;
  workHours: number;
  status: 'normal' | 'late' | 'early' | 'absent' | 'leave';
  source: 'web_simulate' | 'wechat';
  remark: string;
}

interface Shift {
  key: string;
  name: string;
  startTime: string;
  endTime: string;
  lateThreshold: number;
  isCrossDay: boolean;
  breakStart: string;
  breakEnd: string;
  isDefault: boolean;
}

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

const getStorageKey = () => `hr_attendance_${getDataOwner()}`;
const getShiftsKey = () => `hr_shifts_${getDataOwner()}`;
const getAccountsKey = () => `accounts_${getDataOwner()}`;
const getLeavesKey = () => `hr_leaves_${getDataOwner()}`;

const loadRecords = (): AttendanceRecord[] => {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

const loadShifts = (): Shift[] => {
  try {
    const raw = localStorage.getItem(getShiftsKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length > 0) return arr; }
  } catch { /* ignore */ }
  return [{ key: 'default', name: '标准班', startTime: '08:00', endTime: '17:30', lateThreshold: 10, isCrossDay: false, breakStart: '12:00', breakEnd: '13:30', isDefault: true }];
};

const loadEmployees = (): { username: string; displayName: string }[] => {
  try {
    const raw = localStorage.getItem(getAccountsKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map((a: any) => ({ username: a.username, displayName: a.displayName || a.person || a.username }));
    }
  } catch { /* ignore */ }
  return [];
};

// 根据用户名解析显示名称（兜底：accounts → registeredUsers → username）
const resolveDisplayName = (username: string): string => {
  if (!username) return '';
  // 先从 accounts 查找
  try {
    const owner = getDataOwner();
    const raw = localStorage.getItem(`accounts_${owner}`);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const acc = arr.find((a: any) => a.username === username);
        if (acc?.displayName) return acc.displayName;
        if (acc?.person) return acc.person;
      }
    }
  } catch { /* ignore */ }
  // 兜底：从 registeredUsers 查找
  try {
    const regUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = regUsers.find((r: any) => r.username === username);
    if (u?.contactPerson) return u.contactPerson;
    if (u?.displayName) return u.displayName;
  } catch { /* ignore */ }
  return username;
};

const statusMap: Record<string, { color: string; text: string }> = {
  normal: { color: 'green', text: '正常' },
  late: { color: 'orange', text: '迟到' },
  early: { color: 'gold', text: '早退' },
  absent: { color: 'red', text: '缺勤' },
  leave: { color: 'blue', text: '请假' },
};

const calcStatus = (clockIn: string | null, clockOut: string | null, shift: Shift): 'normal' | 'late' | 'early' | 'absent' => {
  if (!clockIn && !clockOut) return 'absent';
  let status: 'normal' | 'late' | 'early' = 'normal';
  if (clockIn) {
    const inMinutes = parseInt(clockIn.split(':')[0]) * 60 + parseInt(clockIn.split(':')[1]);
    const startMinutes = parseInt(shift.startTime.split(':')[0]) * 60 + parseInt(shift.startTime.split(':')[1]);
    if (inMinutes > startMinutes + shift.lateThreshold) status = 'late';
  }
  if (clockOut && status === 'normal') {
    const outMinutes = parseInt(clockOut.split(':')[0]) * 60 + parseInt(clockOut.split(':')[1]);
    const endMinutes = parseInt(shift.endTime.split(':')[0]) * 60 + parseInt(shift.endTime.split(':')[1]);
    if (outMinutes < endMinutes - shift.lateThreshold) status = 'early';
  }
  return status;
};

const calcWorkHours = (clockIn: string | null, clockOut: string | null): number => {
  if (!clockIn || !clockOut) return 0;
  const inMin = parseInt(clockIn.split(':')[0]) * 60 + parseInt(clockIn.split(':')[1]);
  const outMin = parseInt(clockOut.split(':')[0]) * 60 + parseInt(clockOut.split(':')[1]);
  return Math.max(0, Math.round((outMin - inMin) / 60 * 10) / 10);
};

const AttendancePage: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>(loadRecords);
  const [now, setNow] = useState(dayjs());
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [makeupVisible, setMakeupVisible] = useState(false);
  const [makeupForm] = Form.useForm();
  const [statsMode, setStatsMode] = useState<'day' | 'month'>('month');
  const [statsDate, setStatsDate] = useState(dayjs());
  const [shifts, setShifts] = useState<Shift[]>(loadShifts);
  const [employees, setEmployees] = useState<{ username: string; displayName: string }[]>(loadEmployees);
  // 同步落地/窗口重新可见时重读：保活页面只在挂载时读过一次快照，不刷新的话
  // 下一次整表回写会把其他端刚新增的打卡记录整份覆盖（跨端打卡/补卡丢失）
  useDatasetSyncReload(() => {
    applyIfChanged(setRecords, loadRecords());
    applyIfChanged(setShifts, loadShifts());
    applyIfChanged(setEmployees, loadEmployees());
  });
  const currentUsername = localStorage.getItem('username') || '';

  // 实时时钟
  useEffect(() => {
    const timer = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(getStorageKey(), JSON.stringify(records));
  }, [records]);

  const today = now.format('YYYY-MM-DD');
  const defaultShift = shifts.find(s => s.isDefault) || shifts[0];

  const todayRecords = useMemo(() => records.filter(r => r.date === today), [records, today]);
  const myToday = todayRecords.find(r => r.employeeUsername === currentUsername);

  const handleClockIn = useCallback(() => {
    const time = dayjs().format('HH:mm:ss');
    const emp = employees.find(e => e.username === currentUsername);
    const name = emp?.displayName || currentUsername;
    if (myToday?.clockIn) { message.warning('今日已打上班卡'); return; }
    if (myToday) {
      // 打下班卡
      const status = calcStatus(myToday.clockIn, time, defaultShift);
      setRecords(prev => prev.map(r => r.key === myToday.key ? { ...r, clockOut: time, workHours: calcWorkHours(r.clockIn, time), status } : r));
      message.success(`下班打卡成功：${time.slice(0, 5)}`);
    } else {
      // 新建记录打上班卡
      const status = calcStatus(time, null, defaultShift);
      const record: AttendanceRecord = {
        key: `att_${Date.now()}`,
        date: today,
        employeeUsername: currentUsername,
        employeeName: name,
        shiftKey: defaultShift.key,
        clockIn: time,
        clockOut: null,
        workHours: 0,
        status,
        source: 'web_simulate',
        remark: '',
      };
      setRecords(prev => [record, ...prev]);
      message.success(`上班打卡成功：${time.slice(0, 5)}`);
    }
  }, [currentUsername, employees, myToday, defaultShift, today]);

  const handleMakeup = useCallback(() => {
    makeupForm.validateFields().then(values => {
      const emp = employees.find(e => e.username === values.employeeUsername);
      const date = values.date.format('YYYY-MM-DD');
      const existing = records.find(r => r.date === date && r.employeeUsername === values.employeeUsername);
      if (existing) {
        const updated = { ...existing };
        if (values.clockIn) updated.clockIn = values.clockIn.format('HH:mm:ss');
        if (values.clockOut) updated.clockOut = values.clockOut.format('HH:mm:ss');
        updated.workHours = calcWorkHours(updated.clockIn, updated.clockOut);
        updated.status = calcStatus(updated.clockIn, updated.clockOut, defaultShift);
        updated.remark = values.remark || '';
        setRecords(prev => prev.map(r => r.key === existing.key ? updated : r));
      } else {
        const clockIn = values.clockIn ? values.clockIn.format('HH:mm:ss') : null;
        const clockOut = values.clockOut ? values.clockOut.format('HH:mm:ss') : null;
        const record: AttendanceRecord = {
          key: `att_${Date.now()}`,
          date,
          employeeUsername: values.employeeUsername,
          employeeName: emp?.displayName || values.employeeUsername,
          shiftKey: defaultShift.key,
          clockIn,
          clockOut,
          workHours: calcWorkHours(clockIn, clockOut),
          status: calcStatus(clockIn, clockOut, defaultShift),
          source: 'web_simulate',
          remark: values.remark || '',
        };
        setRecords(prev => [record, ...prev]);
      }
      setMakeupVisible(false);
      message.success('补卡成功');
    }).catch(() => { /* 校验失败 */ });
  }, [makeupForm, employees, records, defaultShift]);

  const monthRecords = useMemo(() => records.filter(r => r.date.startsWith(currentMonth.format('YYYY-MM'))), [records, currentMonth]);

  const stats = useMemo(() => {
    const mr = monthRecords;
    return {
      normal: mr.filter(r => r.status === 'normal').length,
      late: mr.filter(r => r.status === 'late').length,
      early: mr.filter(r => r.status === 'early').length,
      absent: mr.filter(r => r.status === 'absent').length,
    };
  }, [monthRecords]);

  const filteredData = useMemo(() => {
    return monthRecords.filter(r => {
      const matchSearch = !searchText || r.employeeName.includes(searchText);
      const matchStatus = !statusFilter || r.status === statusFilter;
      return matchSearch && matchStatus;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [monthRecords, searchText, statusFilter]);

  // 加载请假数据
  const leaves = useMemo(() => {
    try {
      const raw = localStorage.getItem(getLeavesKey());
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.filter((l: any) => l.status === 'approved'); }
    } catch { /* ignore */ }
    return [];
  }, []);

  // 考勤统计数据
  const statsData = useMemo(() => {
    const isMonth = statsMode === 'month';
    const dateStr = isMonth ? statsDate.format('YYYY-MM') : statsDate.format('YYYY-MM-DD');
    const filteredRecords = records.filter(r => r.date.startsWith(dateStr));
    const filteredLeaves = leaves.filter((l: any) => l.startDate?.startsWith(dateStr));

    // 按员工汇总
    const empMap = new Map<string, { name: string; normal: number; late: number; early: number; absent: number; leave: number; totalHours: number; days: number }>();
    employees.forEach(e => {
      empMap.set(e.username, { name: e.displayName, normal: 0, late: 0, early: 0, absent: 0, leave: 0, totalHours: 0, days: 0 });
    });

    filteredRecords.forEach(r => {
      const emp = empMap.get(r.employeeUsername);
      if (emp) {
        if (r.status === 'normal') emp.normal++;
        else if (r.status === 'late') emp.late++;
        else if (r.status === 'early') emp.early++;
        else if (r.status === 'absent') emp.absent++;
        else if (r.status === 'leave') emp.leave++;
        emp.totalHours += r.workHours || 0;
        emp.days++;
      }
    });

    // 请假天数
    filteredLeaves.forEach((l: any) => {
      const emp = empMap.get(l.employeeUsername);
      if (emp) emp.leave += (l.days || 1);
    });

    return Array.from(empMap.entries()).map(([username, data]) => ({
      key: username,
      username,
      ...data,
      avgHours: data.days > 0 ? Math.round(data.totalHours / data.days * 10) / 10 : 0,
    }));
  }, [records, leaves, employees, statsMode, statsDate]);

  // 日历单元格渲染
  const dateCellRender = useCallback((date: Dayjs) => {
    const dateStr = date.format('YYYY-MM-DD');
    const dayRecords = records.filter(r => r.date === dateStr);
    if (dayRecords.length === 0) return null;
    const hasLate = dayRecords.some(r => r.status === 'late');
    const hasEarly = dayRecords.some(r => r.status === 'early');
    const hasAbsent = dayRecords.some(r => r.status === 'absent');
    const color = hasAbsent ? 'red' : hasLate ? 'orange' : hasEarly ? 'gold' : 'green';
    return <Badge color={color} text={<span style={{ fontSize: 11 }}>{dayRecords.length}人</span>} />;
  }, [records]);

  const columns: ColumnsType<AttendanceRecord> = useMemo(() => [
    { title: '日期', dataIndex: 'date', width: 110, align: 'center' },
    { title: '员工', dataIndex: 'employeeUsername', width: 100, align: 'center',
      render: (username: string) => resolveDisplayName(username),
    },
    { title: '上班打卡', dataIndex: 'clockIn', width: 100, align: 'center',
      render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace' }}>{v.slice(0, 5)}</span> : <span style={{ color: '#ff4d4f' }}>未打卡</span>,
    },
    { title: '下班打卡', dataIndex: 'clockOut', width: 100, align: 'center',
      render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace' }}>{v.slice(0, 5)}</span> : <span style={{ color: '#999' }}>-</span>,
    },
    { title: '工时(h)', dataIndex: 'workHours', width: 80, align: 'center' },
    { title: '状态', dataIndex: 'status', width: 80, align: 'center',
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    { title: '来源', dataIndex: 'source', width: 80, align: 'center',
      render: (v: string) => v === 'wechat' ? <Tag color="green">小程序</Tag> : <Tag>网页</Tag>,
    },
    { title: '备注', dataIndex: 'remark', width: 160, align: 'center', ellipsis: true, render: (v: string) => v || '-' },
  ], []);

  // 考勤统计表格列
  const statsColumns: ColumnsType<any> = useMemo(() => [
    { title: '员工', dataIndex: 'name', width: 100, align: 'center', fixed: 'left' },
    { title: '正常', dataIndex: 'normal', width: 70, align: 'center', render: (v: number) => <span style={{ color: v > 0 ? '#52c41a' : '#ccc' }}>{v}</span> },
    { title: '迟到', dataIndex: 'late', width: 70, align: 'center', render: (v: number) => <span style={{ color: v > 0 ? '#faad14' : '#ccc' }}>{v}</span> },
    { title: '早退', dataIndex: 'early', width: 70, align: 'center', render: (v: number) => <span style={{ color: v > 0 ? '#fa8c16' : '#ccc' }}>{v}</span> },
    { title: '缺勤', dataIndex: 'absent', width: 70, align: 'center', render: (v: number) => <span style={{ color: v > 0 ? '#ff4d4f' : '#ccc' }}>{v}</span> },
    { title: '请假(天)', dataIndex: 'leave', width: 90, align: 'center', render: (v: number) => <span style={{ color: v > 0 ? '#1890ff' : '#ccc' }}>{v}</span> },
    { title: '打卡天数', dataIndex: 'days', width: 90, align: 'center' },
    { title: '平均工时(h)', dataIndex: 'avgHours', width: 110, align: 'center' },
  ], []);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '0 4px' }}>
      <div style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff', padding: '20px 28px', borderRadius: 12, marginBottom: 20 }}>
        <Row align="middle" justify="space-between">
          <Col>
            <div style={{ fontSize: 18, fontWeight: 600 }}><ClockCircleOutlined style={{ marginRight: 8 }} />考勤打卡</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>模拟打卡测试（正式版将接入微信小程序）</div>
          </Col>
          <Col>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'monospace' }}>{now.format('HH:mm:ss')}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{now.format('YYYY年MM月DD日 dddd')}</div>
            </div>
          </Col>
        </Row>
      </div>

      {/* 打卡区域 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 12, fontSize: 14, color: '#666' }}>上班打卡</div>
            <Button
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              onClick={handleClockIn}
              disabled={!!myToday?.clockIn}
              style={{ width: 180, height: 48, fontSize: 16, fontWeight: 600, borderRadius: 24 }}
            >
              {myToday?.clockIn ? `已打卡 ${myToday.clockIn.slice(0, 5)}` : '上班打卡'}
            </Button>
          </Card>
        </Col>
        <Col span={12}>
          <Card style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 12, fontSize: 14, color: '#666' }}>下班打卡</div>
            <Button
              type="primary"
              size="large"
              icon={<LogoutOutlined />}
              onClick={handleClockIn}
              disabled={!myToday?.clockIn || !!myToday?.clockOut}
              style={{ width: 180, height: 48, fontSize: 16, fontWeight: 600, borderRadius: 24, background: myToday?.clockIn && !myToday?.clockOut ? '#52c41a' : undefined }}
            >
              {myToday?.clockOut ? `已打卡 ${myToday.clockOut.slice(0, 5)}` : '下班打卡'}
            </Button>
          </Card>
        </Col>
      </Row>

      {/* 月度统计 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="本月正常" value={stats.normal} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="本月迟到" value={stats.late} valueStyle={{ color: '#faad14' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="本月早退" value={stats.early} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="本月缺勤" value={stats.absent} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
      </Row>

      {/* 日历 */}
      <Card title="月度考勤日历" bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 16 }}
        extra={<Space><Button size="small" onClick={() => setCurrentMonth(currentMonth.subtract(1, 'month'))}>上月</Button><span>{currentMonth.format('YYYY年MM月')}</span><Button size="small" onClick={() => setCurrentMonth(currentMonth.add(1, 'month'))}>下月</Button></Space>}>
        <Calendar fullscreen={false} value={currentMonth} onPanelChange={setCurrentMonth} cellRender={(date, info) => {
          if (info.type !== 'date') return info.originNode;
          return <div style={{ padding: '0 4px' }}>{dateCellRender(date as Dayjs)}</div>;
        }} />
      </Card>

      {/* 记录表格 */}
      <Card bodyStyle={{ padding: '12px 16px' }} style={{ marginBottom: 16 }}
        title="考勤记录"
        extra={<Space><Button icon={<PlusOutlined />} onClick={() => { makeupForm.resetFields(); setMakeupVisible(true); }}>补卡</Button><Input.Search placeholder="搜索员工" allowClear style={{ width: 160 }} onSearch={v => setSearchText(v)} onChange={e => { if (!e.target.value) setSearchText(''); }} /><Select placeholder="状态" allowClear style={{ width: 100 }} onChange={v => setStatusFilter(v || '')}>{Object.entries(statusMap).map(([k, v]) => <Select.Option key={k} value={k}>{v.text}</Select.Option>)}</Select></Space>}
      >
        <Table<AttendanceRecord>
          columns={columns}
          dataSource={filteredData}
          rowKey="key"
          pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }}
          bordered
          size="middle"
          scroll={{ x: 910 }}
        />
      </Card>

      {/* 考勤统计 */}
      <Card
        title={<span><BarChartOutlined style={{ marginRight: 8 }} />考勤统计</span>}
        bodyStyle={{ padding: '12px 16px' }}
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Radio.Group value={statsMode} onChange={e => setStatsMode(e.target.value)} size="small">
              <Radio.Button value="day">按日</Radio.Button>
              <Radio.Button value="month">按月</Radio.Button>
            </Radio.Group>
            {statsMode === 'day' ? (
              <DatePicker value={statsDate} onChange={d => d && setStatsDate(d)} allowClear={false} />
            ) : (
              <DatePicker value={statsDate} onChange={d => d && setStatsDate(d)} picker="month" allowClear={false} />
            )}
          </Space>
        }
      >
        <Table
          columns={statsColumns}
          dataSource={statsData}
          rowKey="key"
          pagination={false}
          bordered
          size="middle"
          scroll={{ x: 770 }}
          summary={() => {
            const totals = statsData.reduce((acc, r) => ({
              normal: acc.normal + r.normal,
              late: acc.late + r.late,
              early: acc.early + r.early,
              absent: acc.absent + r.absent,
              leave: acc.leave + r.leave,
              days: acc.days + r.days,
            }), { normal: 0, late: 0, early: 0, absent: 0, leave: 0, days: 0 });
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
                  <Table.Summary.Cell index={0} align="center">合计</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="center"><span style={{ color: '#52c41a' }}>{totals.normal}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="center"><span style={{ color: '#faad14' }}>{totals.late}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="center"><span style={{ color: '#fa8c16' }}>{totals.early}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="center"><span style={{ color: '#ff4d4f' }}>{totals.absent}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="center"><span style={{ color: '#1890ff' }}>{totals.leave}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="center">{totals.days}</Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="center">-</Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </Card>

      {/* 补卡弹窗 */}
      <Modal title="补卡" open={makeupVisible} onOk={handleMakeup} onCancel={() => setMakeupVisible(false)} okText="保存" cancelText="取消" width={480}>
        <Form autoComplete="off" form={makeupForm} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="employeeUsername" label="员工" rules={[{ required: true, message: '请选择' }]}>
                <Select showSearch placeholder="选择员工" optionFilterProp="label" options={employees.map(e => ({ value: e.username, label: e.displayName }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="clockIn" label="上班打卡时间">
                <TimePicker format="HH:mm:ss" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="clockOut" label="下班打卡时间">
                <TimePicker format="HH:mm:ss" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="补卡原因" rules={[{ required: true, message: '请填写补卡原因' }]}>
            <Input.TextArea rows={2} placeholder="请填写补卡原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AttendancePage;
