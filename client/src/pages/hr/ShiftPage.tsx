import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, TimePicker, DatePicker, Switch, Space, Tag, message, Row, Col, Popconfirm, Select, Checkbox, Divider, Radio, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ClockCircleOutlined, TeamOutlined, EnvironmentOutlined, CalendarOutlined, DollarOutlined, ScheduleOutlined, CopyOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const PRIMARY = '#1e4a7e';

interface Shift {
  key: string;
  name: string;
  shiftType: 'fixed' | 'scheduled' | 'free';
  parentId?: string; // 父班次组的key，有值表示是子班次
  startTime: string;
  endTime: string;
  lateThreshold: number;
  isCrossDay: boolean;
  breakStart: string;
  breakEnd: string;
  isDefault: boolean;
  // 打卡人员
  assignedGroups: string[];
  assignedUsers: string[];
  // 休息日与假期
  restDays: number[]; // 0=周日, 1=周一, ..., 6=周六
  holidays: string[]; // YYYY-MM-DD 格式的日期列表
  // 打卡位置
  clockInLocation: string;
  clockInAddress: string;
  // 加班规则
  overtimeEnabled: boolean; // 是否启用加班计费
  standardHours: number; // 标准工作时长（小时）
  overtimeThreshold: number; // 加班起算小时数（超过标准工时多久算加班）
  workdayOvertimeRate: number; // 工作日加班费（元/小时）
  restDayOvertimeRate: number; // 休息日加班费（元/小时）
  holidayOvertimeRate: number; // 节假日加班费（元/小时）
  // 自由打卡
  requiredHours?: number; // 要求上班时长（小时），不满算早退
}

const SHIFT_TYPE_CONFIG: Record<string, { label: string; desc: string; tag: string }> = {
  fixed: { label: '固定时间上下班', desc: '所有人按照相同时间打卡，如朝九晚五', tag: '标准班' },
  scheduled: { label: '排班打卡', desc: '按排班结果或自选班次打卡，如三班倒', tag: '排班' },
  free: { label: '自由打卡', desc: '不固定时间，可随时打卡，适用于销售等', tag: '自由' },
};

// 中国法定节假日（2025-2026）
const STATUTORY_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': '元旦', '2025-01-28': '春节', '2025-01-29': '春节', '2025-01-30': '春节',
  '2025-01-31': '春节', '2025-02-01': '春节', '2025-02-02': '春节', '2025-02-03': '春节', '2025-02-04': '春节',
  '2025-04-04': '清明节', '2025-04-05': '清明节', '2025-04-06': '清明节',
  '2025-05-01': '劳动节', '2025-05-02': '劳动节', '2025-05-03': '劳动节', '2025-05-04': '劳动节', '2025-05-05': '劳动节',
  '2025-05-31': '端午节', '2025-06-01': '端午节', '2025-06-02': '端午节',
  '2025-10-01': '国庆节', '2025-10-02': '国庆节', '2025-10-03': '国庆节', '2025-10-04': '国庆节',
  '2025-10-05': '国庆节', '2025-10-06': '国庆节/中秋节', '2025-10-07': '国庆节',
  // 2026
  '2026-01-01': '元旦', '2026-01-02': '元旦', '2026-01-03': '元旦',
  '2026-02-16': '春节', '2026-02-17': '春节', '2026-02-18': '春节', '2026-02-19': '春节',
  '2026-02-20': '春节', '2026-02-21': '春节', '2026-02-22': '春节',
  '2026-04-05': '清明节', '2026-04-06': '清明节', '2026-04-07': '清明节',
  '2026-05-01': '劳动节', '2026-05-02': '劳动节', '2026-05-03': '劳动节', '2026-05-04': '劳动节', '2026-05-05': '劳动节',
  '2026-06-19': '端午节', '2026-06-20': '端午节', '2026-06-21': '端午节',
  '2026-09-25': '中秋节', '2026-09-26': '中秋节', '2026-09-27': '中秋节',
  '2026-10-01': '国庆节', '2026-10-02': '国庆节', '2026-10-03': '国庆节', '2026-10-04': '国庆节',
  '2026-10-05': '国庆节', '2026-10-06': '国庆节', '2026-10-07': '国庆节',
};

const HolidayManager: React.FC<{ value?: string[]; onChange?: (v: string[]) => void }> = ({ value = [], onChange }) => {
  const handleAdd = (d: any) => {
    if (!d) return;
    const dateStr = d.format('YYYY-MM-DD');
    if (!value.includes(dateStr)) {
      onChange?.([...value, dateStr].sort());
    }
  };
  const handleRemove = (dateStr: string) => {
    onChange?.(value.filter(d => d !== dateStr));
  };
  return (
    <div>
      <DatePicker onChange={handleAdd} style={{ width: '100%' }} placeholder="点击选择日期添加假期" />
      {value.length > 0 ? (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.sort().map(d => {
            const hol = STATUTORY_HOLIDAYS[d];
            return (
              <div key={d} style={{ display: 'inline-block', textAlign: 'center' }}>
                <Tag
                  closable
                  onClose={(e: any) => { e.preventDefault(); handleRemove(d); }}
                  style={{ margin: 0, padding: '4px 10px' }}
                >{d}</Tag>
                {hol && <div style={{ color: '#ff4d4f', fontSize: 11, marginTop: 2 }}>法定节假日·{hol}</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ color: '#999', fontSize: 12, marginTop: 8, textAlign: 'center' }}>暂无放假日期，点击上方日历添加</div>
      )}
    </div>
  );
};

const WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
];

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

const getStorageKey = () => `hr_shifts_${getDataOwner()}`;
const getGroupsKey = () => `account_groups_${getDataOwner()}`;
const getAccountsKey = () => `accounts_${getDataOwner()}`;

// 加载分组列表
const loadGroups = (): { name: string }[] => {
  try {
    const raw = localStorage.getItem(getGroupsKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map((g: any) => typeof g === 'string' ? { name: g } : { name: g.name }).filter((g: any) => g.name);
      }
    }
  } catch { /* ignore */ }
  return [];
};

// 加载人员列表（从accounts中读取）
const loadEmployees = (): { username: string; displayName: string; group: string }[] => {
  try {
    const raw = localStorage.getItem(getAccountsKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map((a: any) => ({ username: a.username, displayName: a.displayName || a.person || a.username, group: a.group || '' }));
    }
  } catch { /* ignore */ }
  return [];
};

const getScheduleKey = () => `hr_schedule_${getDataOwner()}`;

const SHIFT_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#f5222d'];

interface ScheduleData {
  [username: string]: { [dateKey: string]: string; };
}

const loadSchedule = (): ScheduleData => {
  try {
    const raw = localStorage.getItem(getScheduleKey());
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
};

const DEFAULT_SHIFT: Shift = {
  key: 'default',
  name: '标准班',
  shiftType: 'fixed',
  startTime: '08:00',
  endTime: '17:30',
  lateThreshold: 10,
  isCrossDay: false,
  breakStart: '12:00',
  breakEnd: '13:30',
  isDefault: true,
  assignedGroups: [],
  assignedUsers: [],
  restDays: [],
  holidays: [],
  clockInLocation: '',
  clockInAddress: '',
  overtimeEnabled: false,
  standardHours: 8,
  overtimeThreshold: 0,
  workdayOvertimeRate: 0,
  restDayOvertimeRate: 0,
  holidayOvertimeRate: 0,
  requiredHours: 8,
};

const loadShifts = (): Shift[] => {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr.map((s: any) => ({
        ...s,
        assignedGroups: s.assignedGroups || [],
        assignedUsers: s.assignedUsers || [],
        restDays: s.restDays || [],
        holidays: s.holidays || [],
        clockInLocation: s.clockInLocation || '',
        clockInAddress: s.clockInAddress || '',
        overtimeEnabled: s.overtimeEnabled || false,
        standardHours: s.standardHours || 8,
        overtimeThreshold: s.overtimeThreshold || 0,
        workdayOvertimeRate: s.workdayOvertimeRate || 0,
        restDayOvertimeRate: s.restDayOvertimeRate || 0,
        holidayOvertimeRate: s.holidayOvertimeRate || 0,
        requiredHours: s.requiredHours ?? 8,
        parentId: s.parentId || '',
      }));
    }
  } catch { /* ignore */ }
  return [{ ...DEFAULT_SHIFT }];
};

const ShiftTypeSelector: React.FC<{ value?: string; onChange?: (v: string) => void }> = ({ value = 'fixed', onChange }) => {
  const types = ['fixed', 'scheduled', 'free'] as const;
  const colorMap: Record<string, string> = { fixed: '#1677ff', scheduled: '#52c41a', free: '#722ed1' };
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {types.map(t => {
        const selected = value === t;
        const cfg = SHIFT_TYPE_CONFIG[t];
        return (
          <div
            key={t}
            onClick={() => onChange?.(t)}
            style={{
              flex: 1, padding: '12px 10px', borderRadius: 8, cursor: 'pointer',
              border: `2px solid ${selected ? colorMap[t] : '#d9d9d9'}`,
              background: selected ? `${colorMap[t]}10` : '#fff',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: selected ? colorMap[t] : '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {cfg.label}
              {selected && <span style={{ color: colorMap[t], fontSize: 16 }}>✓</span>}
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: '18px' }}>{cfg.desc}</div>
          </div>
        );
      })}
    </div>
  );
};

const ShiftPage: React.FC = () => {
  const [shifts, setShifts] = useState<Shift[]>(loadShifts);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [form] = Form.useForm();
  const watchShiftType = Form.useWatch('shiftType', form);
  const groups = useMemo(() => loadGroups(), []);
  const employees = useMemo(() => loadEmployees(), []);

  // ========== 排班设置状态 ==========
  const [schedule, setSchedule] = useState<ScheduleData>(loadSchedule);
  const [scheduleMonth, setScheduleMonth] = useState(dayjs().startOf('month'));
  const [schedulingMode, setSchedulingMode] = useState<'manual' | 'auto'>('manual');
  const [unassignedPolicy, setUnassignedPolicy] = useState<'self-select' | 'none'>('self-select');
  const [allowSwap, setAllowSwap] = useState(true);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ username: string; date: string } | null>(null);
  const [selectedShiftKey, setSelectedShiftKey] = useState('');
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [schedShiftModalVisible, setSchedShiftModalVisible] = useState(false);
  const [schedShiftEditingKey, setSchedShiftEditingKey] = useState('');
  const [schedShiftForm] = Form.useForm();
  const [currentScheduleGroupKey, setCurrentScheduleGroupKey] = useState('');

  const hasScheduledShifts = useMemo(() => shifts.some(s => s.shiftType === 'scheduled'), [shifts]);

  // 排班数据持久化
  useEffect(() => {
    localStorage.setItem(getScheduleKey(), JSON.stringify(schedule));
  }, [schedule]);

  useEffect(() => {
    localStorage.setItem(getStorageKey(), JSON.stringify(shifts));
  }, [shifts]);

  const handleAdd = useCallback(() => {
    setEditingKey('');
    form.resetFields();
    form.setFieldsValue({ shiftType: 'fixed', lateThreshold: 10, isCrossDay: false, assignedGroups: [], assignedUsers: [], restDays: [], holidays: [], clockInLocation: '', clockInAddress: '', overtimeEnabled: false, standardHours: 8, overtimeThreshold: 0, workdayOvertimeRate: 0, restDayOvertimeRate: 0, holidayOvertimeRate: 0 });
    setModalVisible(true);
  }, [form]);

  const handleEdit = useCallback((record: Shift) => {
    setEditingKey(record.key);
    form.setFieldsValue({
      ...record,
      shiftType: record.shiftType || 'fixed',
      startTime: record.startTime ? dayjs(record.startTime, 'HH:mm') : null,
      endTime: record.endTime ? dayjs(record.endTime, 'HH:mm') : null,
      breakStart: record.breakStart ? dayjs(record.breakStart, 'HH:mm') : null,
      breakEnd: record.breakEnd ? dayjs(record.breakEnd, 'HH:mm') : null,
      assignedGroups: record.assignedGroups || [],
      assignedUsers: record.assignedUsers || [],
      restDays: record.restDays || [],
      holidays: record.holidays || [],
      clockInLocation: record.clockInLocation || '',
      clockInAddress: record.clockInAddress || '',
      overtimeEnabled: record.overtimeEnabled || false,
      standardHours: record.standardHours || 8,
      overtimeThreshold: record.overtimeThreshold || 0,
      workdayOvertimeRate: record.workdayOvertimeRate || 0,
      restDayOvertimeRate: record.restDayOvertimeRate || 0,
      holidayOvertimeRate: record.holidayOvertimeRate || 0,
    });
    setModalVisible(true);
  }, [form]);

  const handleDelete = useCallback((key: string) => {
    setShifts(prev => prev.filter(s => s.key !== key));
    message.success('班次已删除');
  }, []);

  const handleSave = useCallback(() => {
    form.validateFields().then(values => {
      const type: 'fixed' | 'scheduled' | 'free' = values.shiftType || 'fixed';
      const assignedGroups: string[] = values.assignedGroups || [];
      const assignedUsers: string[] = values.assignedUsers || [];

      // 校验打卡人员是否已在其他班次中分配
      const otherShifts = shifts.filter(s => s.key !== editingKey && !s.parentId);
      const conflictGroups: string[] = [];
      const conflictUsers: string[] = [];
      const individualOverrideUsers: string[] = [];
      otherShifts.forEach(s => {
        // 分组冲突：当前选的分组在其他班次中也作为分组存在
        assignedGroups.forEach(g => { if (s.assignedGroups?.includes(g)) conflictGroups.push(g); });
        // 个人冲突：当前选的个人在其他班次中也作为个人存在
        assignedUsers.forEach(u => {
          if (s.assignedUsers?.includes(u)) {
            conflictUsers.push(u);
          } else if (s.assignedGroups?.some(g => {
            // 当前选的个人在其他班次的分组内 → 个人打卡优先，不阻止
            const groupMembers = employees.filter(e => e.group === g).map(e => e.username);
            return groupMembers.includes(u);
          })) {
            individualOverrideUsers.push(u);
          }
        });
      });
      if (conflictGroups.length > 0 || conflictUsers.length > 0) {
        const parts: string[] = [];
        if (conflictGroups.length > 0) parts.push(`分组「${Array.from(new Set(conflictGroups)).join('、')}」`);
        if (conflictUsers.length > 0) parts.push(`人员「${Array.from(new Set(conflictUsers)).map(u => employees.find(e => e.username === u)?.displayName || u).join('、')}」`);
        message.error(`${parts.join('和')}已在其他班次中分配，不能重复分配`);
        return;
      }
      if (individualOverrideUsers.length > 0) {
        const names = Array.from(new Set(individualOverrideUsers)).map(u => employees.find(e => e.username === u)?.displayName || u).join('、');
        message.warning(`人员「${names}」在其他班次的分组中已存在，打卡时优先使用个人指定的班次`);
      }

      const shift: Shift = {
        key: editingKey || `shift_${Date.now()}`,
        name: values.name,
        shiftType: type,
        startTime: values.startTime ? values.startTime.format('HH:mm') : (type === 'free' ? '00:00' : ''),
        endTime: values.endTime ? values.endTime.format('HH:mm') : (type === 'free' ? '23:59' : ''),
        lateThreshold: values.lateThreshold || 10,
        isCrossDay: values.isCrossDay || false,
        breakStart: values.breakStart ? values.breakStart.format('HH:mm') : '',
        breakEnd: values.breakEnd ? values.breakEnd.format('HH:mm') : '',
        isDefault: editingKey === 'default',
        assignedGroups,
        assignedUsers,
        restDays: values.restDays || [],
        holidays: values.holidays || [],
        clockInLocation: values.clockInLocation || '',
        clockInAddress: values.clockInAddress || '',
        overtimeEnabled: values.overtimeEnabled || false,
        standardHours: values.standardHours || 8,
        overtimeThreshold: values.overtimeThreshold || 0,
        workdayOvertimeRate: values.workdayOvertimeRate || 0,
        restDayOvertimeRate: values.restDayOvertimeRate || 0,
        holidayOvertimeRate: values.holidayOvertimeRate || 0,
      };
      if (editingKey) {
        setShifts(prev => prev.map(s => s.key === editingKey ? shift : s));
      } else {
        setShifts(prev => [...prev, shift]);
      }
      setModalVisible(false);
      message.success(editingKey ? '班次已更新' : '班次已添加');
    }).catch(() => { /* 校验失败 */ });
  }, [form, editingKey]);

  // 解析分组/人员数量显示
  const renderPersonnel = (_: any, r: Shift) => {
    const gCount = (r.assignedGroups || []).length;
    const uCount = (r.assignedUsers || []).length;
    if (gCount === 0 && uCount === 0) return <span style={{ color: '#999' }}>未分配</span>;
    const tags: React.ReactNode[] = [];
    r.assignedGroups?.forEach(g => tags.push(<Tag key={`g-${g}`} color="blue">{g}</Tag>));
    r.assignedUsers?.forEach(u => {
      const emp = employees.find(e => e.username === u);
      tags.push(<Tag key={`u-${u}`} color="green">{emp?.displayName || u}</Tag>);
    });
    return <Space size={2} wrap>{tags}</Space>;
  };

  // 解析休息日显示
  const renderRestDays = (_: any, r: Shift) => {
    const days = r.restDays || [];
    const hols = r.holidays || [];
    if (days.length === 0 && hols.length === 0) return <span style={{ color: '#999' }}>未设置</span>;
    const dayLabels = days.map(d => WEEKDAY_OPTIONS.find(w => w.value === d)?.label).filter(Boolean);
    return (
      <div>
        {dayLabels.length > 0 && <span>{dayLabels.join('、')}</span>}
        {hols.length > 0 && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{hols.length}个假期</div>}
      </div>
    );
  };

  // 解析打卡位置显示
  const renderLocation = (_: any, r: Shift) => {
    if (!r.clockInLocation) return <span style={{ color: '#999' }}>未设置</span>;
    return (
      <div>
        <div><EnvironmentOutlined style={{ color: '#52c41a', marginRight: 4 }} />{r.clockInLocation}</div>
        {r.clockInAddress && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{r.clockInAddress}</div>}
      </div>
    );
  };

  const columns: ColumnsType<Shift> = useMemo(() => [
    { title: '班次名称', dataIndex: 'name', width: 150, align: 'center',
      render: (v: string, r: Shift) => <span><ClockCircleOutlined style={{ marginRight: 6, color: PRIMARY }} />{v}{r.isDefault && <Tag color="blue" style={{ marginLeft: 8 }}>默认</Tag>}</span>,
    },
    { title: '班次类型', dataIndex: 'shiftType', width: 120, align: 'center',
      render: (v: string) => {
        const cfg = SHIFT_TYPE_CONFIG[v || 'fixed'];
        const colorMap: Record<string, string> = { fixed: 'blue', scheduled: 'green', free: 'purple' };
        return <Tag color={colorMap[v || 'fixed']}>{cfg.tag}</Tag>;
      },
    },
    { title: '上班时间', dataIndex: 'startTime', width: 100, align: 'center',
      render: (v: string, r: Shift) => r.shiftType === 'free' ? '-' : v,
    },
    { title: '下班时间', dataIndex: 'endTime', width: 100, align: 'center',
      render: (v: string, r: Shift) => r.shiftType === 'free' ? '-' : v,
    },
    { title: '迟到容忍(分钟)', dataIndex: 'lateThreshold', width: 130, align: 'center' },
    { title: '是否跨天', dataIndex: 'isCrossDay', width: 100, align: 'center',
      render: (v: boolean) => v ? <Tag color="orange">是</Tag> : <Tag>否</Tag>,
    },
    { title: '午休时间', width: 140, align: 'center',
      render: (_: any, r: Shift) => r.breakStart && r.breakEnd ? `${r.breakStart} - ${r.breakEnd}` : '-',
    },
    { title: '打卡人员', width: 200, align: 'center', render: renderPersonnel },
    { title: '休息日', width: 140, align: 'center', render: renderRestDays },
    { title: '打卡位置', width: 160, align: 'center', render: renderLocation },
    { title: '加班规则', width: 180, align: 'center',
      render: (_: any, r: Shift) => {
        if (!r.overtimeEnabled) return <span style={{ color: '#999' }}>未启用</span>;
        const rates: string[] = [];
        if (r.workdayOvertimeRate > 0) rates.push(`工作日 ¥${r.workdayOvertimeRate}/h`);
        if (r.restDayOvertimeRate > 0) rates.push(`休息日 ¥${r.restDayOvertimeRate}/h`);
        if (r.holidayOvertimeRate > 0) rates.push(`节假日 ¥${r.holidayOvertimeRate}/h`);
        return (
          <div style={{ fontSize: 11, lineHeight: '18px' }}>
            <Tag color="gold" style={{ marginBottom: 2 }}>标准{r.standardHours}h</Tag>
            {rates.map((t, i) => <div key={i} style={{ color: '#555' }}>{t}</div>)}
          </div>
        );
      },
    },
    { title: '操作', width: 120, align: 'center', fixed: 'right' as const,
      render: (_: any, r: Shift) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          {!r.isDefault && (
            <Popconfirm title="确定删除该班次？" onConfirm={() => handleDelete(r.key)} okText="确定" cancelText="取消">
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [handleEdit, handleDelete, employees]);

  const sectionStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: PRIMARY, margin: '16px 0 12px', display: 'flex', alignItems: 'center', gap: 6 };

  // ========== 排班操作函数 ==========
  const schedYear = scheduleMonth.year();
  const schedMonth = scheduleMonth.month();
  const schedDaysInMonth = scheduleMonth.daysInMonth();
  const schedDays = Array.from({ length: schedDaysInMonth }, (_, i) => i + 1);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  const getShiftInfo = useCallback((shiftKey: string) => {
    if (shiftKey === 'rest') return { name: '休息', color: '#d9d9d9', time: '' };
    const idx = shifts.findIndex(s => s.key === shiftKey);
    const shift = shifts[idx];
    if (!shift) return null;
    return { name: shift.name, color: SHIFT_COLORS[idx % SHIFT_COLORS.length], time: `${shift.startTime}-${shift.endTime}` };
  }, [shifts]);

  const handleCellClick = useCallback((username: string, day: number) => {
    if (schedulingMode !== 'manual') return;
    const dateKey = `${schedYear}-${String(schedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const currentAssignment = schedule[username]?.[dateKey] || '';
    setSelectedShiftKey(currentAssignment);
    setAssignTarget({ username, date: dateKey });
    setAssignModalVisible(true);
  }, [schedule, schedYear, schedMonth, schedulingMode]);

  const handleSaveAssignment = useCallback(() => {
    if (!assignTarget) return;
    setSchedule(prev => {
      const next = { ...prev };
      if (!next[assignTarget.username]) next[assignTarget.username] = {};
      if (selectedShiftKey) {
        next[assignTarget.username][assignTarget.date] = selectedShiftKey;
      } else {
        delete next[assignTarget.username][assignTarget.date];
      }
      return next;
    });
    setAssignModalVisible(false);
    message.success('排班已更新');
  }, [assignTarget, selectedShiftKey]);

  const handleCopyPrevMonth = useCallback(() => {
    const prevMonth = scheduleMonth.subtract(1, 'month');
    const prevPrefix = `${prevMonth.year()}-${String(prevMonth.month() + 1).padStart(2, '0')}`;
    const curPrefix = `${schedYear}-${String(schedMonth + 1).padStart(2, '0')}`;
    const prevDays = prevMonth.daysInMonth();
    setSchedule(prev => {
      const next = { ...prev };
      employees.forEach(e => {
        const prevData = prev[e.username];
        if (prevData) {
          if (!next[e.username]) next[e.username] = {};
          for (let d = 1; d <= schedDaysInMonth; d++) {
            const srcDay = ((d - 1) % prevDays) + 1;
            const srcKey = `${prevPrefix}-${String(srcDay).padStart(2, '0')}`;
            if (prevData[srcKey]) {
              next[e.username][`${curPrefix}-${String(d).padStart(2, '0')}`] = prevData[srcKey];
            }
          }
        }
      });
      return next;
    });
    message.success('已复制上月排班');
  }, [scheduleMonth, schedYear, schedMonth, schedDaysInMonth, employees]);

  const handleBatchAssign = useCallback((username: string, shiftKey: string) => {
    const curPrefix = `${schedYear}-${String(schedMonth + 1).padStart(2, '0')}`;
    setSchedule(prev => {
      const next = { ...prev };
      if (!next[username]) next[username] = {};
      for (let d = 1; d <= schedDaysInMonth; d++) {
        const date = dayjs(`${schedYear}-${schedMonth + 1}-${d}`);
        const dow = date.day();
        if (dow === 0 || dow === 6) {
          next[username][`${curPrefix}-${String(d).padStart(2, '0')}`] = 'rest';
        } else {
          next[username][`${curPrefix}-${String(d).padStart(2, '0')}`] = shiftKey;
        }
      }
      return next;
    });
    const emp = employees.find(e => e.username === username);
    message.success(`已为${emp?.displayName || username}批量排班`);
  }, [schedYear, schedMonth, schedDaysInMonth, employees]);

  const handleClearMonth = useCallback((username: string) => {
    const curPrefix = `${schedYear}-${String(schedMonth + 1).padStart(2, '0')}`;
    setSchedule(prev => {
      const next = { ...prev };
      if (next[username]) {
        const cleaned: Record<string, string> = {};
        Object.entries(next[username]).forEach(([k, v]) => {
          if (!k.startsWith(curPrefix)) cleaned[k] = v;
        });
        next[username] = cleaned;
      }
      return next;
    });
    message.success('已清除本月排班');
  }, [schedYear, schedMonth]);

  // ========== 排班打卡班次编辑 ==========
  const handleSchedShiftAdd = useCallback(() => {
    setSchedShiftEditingKey('');
    schedShiftForm.resetFields();
    schedShiftForm.setFieldsValue({ name: '', startTime: dayjs('09:00', 'HH:mm'), endTime: dayjs('17:00', 'HH:mm') });
    setSchedShiftModalVisible(true);
  }, [schedShiftForm]);

  const handleSchedShiftEdit = useCallback((s: Shift) => {
    setSchedShiftEditingKey(s.key);
    schedShiftForm.setFieldsValue({
      name: s.name,
      startTime: s.startTime ? dayjs(s.startTime, 'HH:mm') : undefined,
      endTime: s.endTime ? dayjs(s.endTime, 'HH:mm') : undefined,
      breakStart: s.breakStart ? dayjs(s.breakStart, 'HH:mm') : undefined,
      breakEnd: s.breakEnd ? dayjs(s.breakEnd, 'HH:mm') : undefined,
      lateThreshold: s.lateThreshold ?? 10,
    });
    setSchedShiftModalVisible(true);
  }, [schedShiftForm]);

  const handleSchedShiftSave = useCallback(async () => {
    try {
      const values = await schedShiftForm.validateFields();
      const owner = getDataOwner();
      const base: Shift = {
        key: schedShiftEditingKey || `shift_${Date.now()}`,
        name: values.name,
        shiftType: 'scheduled',
        parentId: currentScheduleGroupKey,
        startTime: values.startTime ? values.startTime.format('HH:mm') : '',
        endTime: values.endTime ? values.endTime.format('HH:mm') : '',
        lateThreshold: values.lateThreshold ?? 10,
        isCrossDay: false,
        breakStart: values.breakStart ? values.breakStart.format('HH:mm') : '',
        breakEnd: values.breakEnd ? values.breakEnd.format('HH:mm') : '',
        isDefault: false,
        assignedGroups: [], assignedUsers: [],
        restDays: [], holidays: [],
        clockInLocation: '', clockInAddress: '',
        overtimeEnabled: false, standardHours: 8, overtimeThreshold: 1,
        workdayOvertimeRate: 1.5, restDayOvertimeRate: 2, holidayOvertimeRate: 3,
      };
      const existing = shifts.find(s => s.key === base.key);
      const newShifts = existing ? shifts.map(s => s.key === base.key ? { ...existing, ...base } : s) : [...shifts, base];
      setShifts(newShifts);
      localStorage.setItem(`hr_shifts_${owner}`, JSON.stringify(newShifts));
      setSchedShiftModalVisible(false);
      message.success(schedShiftEditingKey ? '班次已更新' : '班次已添加');
    } catch { /* validation failed */ }
  }, [schedShiftEditingKey, shifts, schedShiftForm, currentScheduleGroupKey]);

  return (
    <div>
      {/* 新增班次按键 */}
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-start', gap: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} style={{ color: '#fff', fontWeight: 600 }}>新增班次</Button>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table<Shift>
          columns={columns}
          dataSource={shifts.filter(s => !s.parentId)}
          rowKey="key"
          pagination={false}
          bordered
          size="middle"
          scroll={{ x: 1820 }}
          style={{ borderRadius: 8 }}
        />
      </Card>

      {/* ========== 排班设置弹窗 ========== */}
      <Modal
        title="编辑排班"
        open={scheduleModalVisible}
        onCancel={() => setScheduleModalVisible(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setScheduleModalVisible(false)}>取消</Button>
            <Button type="primary" onClick={() => { setScheduleModalVisible(false); message.success('排班设置已保存'); }}>保存</Button>
          </div>
        }
        width="92vw"
        styles={{ body: { padding: '16px 20px', maxHeight: '80vh', overflowY: 'auto' } }}
      >
        {/* 排班配置区 */}
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>
            <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>排班方式</span>
            <Radio.Group value={schedulingMode} onChange={e => setSchedulingMode(e.target.value)} size="small" optionType="button" buttonStyle="solid">
              <Radio.Button value="manual">手动排班</Radio.Button>
              <Radio.Button value="auto">无需事先排班</Radio.Button>
            </Radio.Group>
          </span>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Checkbox checked={unassignedPolicy === 'self-select'} onChange={e => setUnassignedPolicy(e.target.checked ? 'self-select' : 'none')}>
            未排班时，成员自选班次
          </Checkbox>
          <Checkbox checked={allowSwap} onChange={e => setAllowSwap(e.target.checked)} style={{ marginLeft: 16 }}>
            成员可发起调班申请，审批通过后更改班次
          </Checkbox>
        </div>

        {/* 打卡班次管理 */}
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 12 }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: PRIMARY }}>配置班次</span>
            <Button size="small" icon={<PlusOutlined />} onClick={handleSchedShiftAdd}>添加</Button>
          </div>
          {shifts.filter(s => s.parentId === currentScheduleGroupKey).length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 13 }}>暂无排班班次，请点击“添加”创建</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: '6px 14px', textAlign: 'left', fontSize: 12, color: '#666', borderBottom: '1px solid #f0f0f0' }}>班次名称</th>
                  <th style={{ padding: '6px 14px', textAlign: 'left', fontSize: 12, color: '#666', borderBottom: '1px solid #f0f0f0' }}>上下班时间</th>
                  <th style={{ padding: '6px 14px', textAlign: 'right', fontSize: 12, color: '#666', borderBottom: '1px solid #f0f0f0' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {shifts.filter(s => s.parentId === currentScheduleGroupKey).map((s) => (
                  <tr key={s.key} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '8px 14px', fontSize: 13 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: SHIFT_COLORS[shifts.indexOf(s) % SHIFT_COLORS.length], marginRight: 8 }} />
                      {s.name}
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: 13, color: '#555' }}>{s.startTime}-{s.endTime}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <Button type="link" size="small" onClick={() => handleSchedShiftEdit(s)}>编辑</Button>
                      {!s.isDefault && (
                        <Popconfirm title="确定删除该班次？" onConfirm={() => handleDelete(s.key)} okText="确定" cancelText="取消">
                          <Button type="link" size="small" danger>删除</Button>
                        </Popconfirm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 日历排班表 - 仅手动排班模式显示 */}
        {schedulingMode === 'manual' && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8 }}>
          <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
            <Space>
              <ScheduleOutlined style={{ color: PRIMARY, fontSize: 14 }} />
              <span style={{ fontWeight: 600, fontSize: 13, color: PRIMARY }}>排班表</span>
            </Space>
            <Space>
              <Button size="small" icon={<LeftOutlined />} onClick={() => setScheduleMonth(m => m.subtract(1, 'month'))} />
              <span style={{ fontWeight: 600, fontSize: 13, minWidth: 80, textAlign: 'center' }}>{scheduleMonth.format('YYYY-MM')}</span>
              <Button size="small" icon={<RightOutlined />} onClick={() => setScheduleMonth(m => m.add(1, 'month'))} />
            </Space>
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyPrevMonth}>复制上月排班</Button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e8e8e8', position: 'sticky', left: 0, background: '#fafafa', zIndex: 2, minWidth: 70, fontSize: 12 }}>姓名</th>
                  {schedDays.map(d => {
                    const date = dayjs(`${schedYear}-${schedMonth + 1}-${d}`);
                    const dow = date.day();
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <th key={d} style={{ padding: '2px 0', textAlign: 'center', borderBottom: '2px solid #e8e8e8', minWidth: 32, fontSize: 11, background: isWeekend ? '#fff7e6' : undefined }}>
                        <div>{d}</div>
                        <div style={{ fontSize: 9, color: isWeekend ? '#fa8c16' : '#bbb' }}>{weekdays[dow]}</div>
                      </th>
                    );
                  })}
                  <th style={{ padding: '5px 3px', textAlign: 'center', borderBottom: '2px solid #e8e8e8', minWidth: 55, fontSize: 12 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr><td colSpan={schedDays.length + 2} style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 13 }}>请添加打卡人员（在班次编辑中设置打卡人员）</td></tr>
                ) : employees.map(emp => (
                  <tr key={emp.username} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '3px 8px', fontWeight: 500, fontSize: 12, position: 'sticky', left: 0, background: '#fff', zIndex: 1, borderRight: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{emp.displayName}</td>
                    {schedDays.map(d => {
                      const dateKey = `${schedYear}-${String(schedMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const assignment = schedule[emp.username]?.[dateKey] || '';
                      const info = assignment ? getShiftInfo(assignment) : null;
                      const date = dayjs(`${schedYear}-${schedMonth + 1}-${d}`);
                      const isWeekend = date.day() === 0 || date.day() === 6;
                      return (
                        <td key={d} onClick={() => handleCellClick(emp.username, d)}
                          style={{ width: 32, height: 26, textAlign: 'center', cursor: schedulingMode === 'manual' ? 'pointer' : 'default', background: isWeekend ? '#fff7e630' : undefined, borderRight: '1px solid #f5f5f5' }}>
                          {info ? (
                            <Tooltip title={`${info.name}${info.time ? ' ' + info.time : ''}`}>
                              <div style={{ width: 24, height: 18, margin: 'auto', borderRadius: 3, background: info.color + '20', color: info.color, fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                                {info.name.length > 2 ? info.name.slice(0, 2) : info.name}
                              </div>
                            </Tooltip>
                          ) : (
                            <span style={{ color: '#ddd', fontSize: 9 }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: '2px', textAlign: 'center' }}>
                      <Space size={0} direction="vertical" style={{ width: '100%' }}>
                        <Button type="link" size="small" style={{ fontSize: 10, padding: 0, height: 16 }} onClick={() => shifts.length > 0 && handleBatchAssign(emp.username, shifts.find(s => s.shiftType === 'scheduled')?.key || shifts[0].key)}>排满</Button>
                        <Button type="link" size="small" danger style={{ fontSize: 10, padding: 0, height: 16 }} onClick={() => handleClearMonth(emp.username)}>清除</Button>
                      </Space>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* 无需事先排班模式提示 */}
        {schedulingMode === 'auto' && (
        <div style={{ marginTop: 12, padding: '16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ScheduleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: '#389e0d' }}>自动匹配模式</span>
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
            • 员工上班打卡时，系统根据打卡时间自动匹配最近的班次<br />
            • 若打卡时间在某个班次的“可打卡时段”内，自动归入该班次<br />
            • 若打卡时间不在任何班次范围内，则记为“未排班”状态<br />
            • 无需手动为每天每个员工分配班次
          </div>
        </div>
        )}

        {/* 班次图例 */}
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#666' }}>班次：</span>
          <Tag style={{ background: '#d9d9d920', borderColor: '#d9d9d9', color: '#666' }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#d9d9d9', marginRight: 3 }} />休息
          </Tag>
          {shifts.filter(s => s.parentId === currentScheduleGroupKey).map((s, i) => (
            <Tag key={s.key} style={{ background: SHIFT_COLORS[i % SHIFT_COLORS.length] + '15', borderColor: SHIFT_COLORS[i % SHIFT_COLORS.length], color: SHIFT_COLORS[i % SHIFT_COLORS.length] }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: SHIFT_COLORS[i % SHIFT_COLORS.length], marginRight: 3 }} />
              {s.name} {s.startTime}-{s.endTime}
            </Tag>
          ))}
        </div>
      </Modal>

      {/* 排班分配弹窗 */}
      <Modal
        title={`排班 - ${assignTarget ? employees.find(e => e.username === assignTarget.username)?.displayName || '' : ''} (${assignTarget ? assignTarget.date.split('-').pop() : ''}日)`}
        open={assignModalVisible}
        onOk={handleSaveAssignment}
        onCancel={() => setAssignModalVisible(false)}
        okText="确定"
        cancelText="取消"
        width={380}
      >
        <div style={{ padding: '12px 0' }}>
          <div style={{ marginBottom: 10, color: '#666', fontSize: 13 }}>选择班次：</div>
          <Radio.Group value={selectedShiftKey} onChange={e => setSelectedShiftKey(e.target.value)} style={{ width: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Radio value=""><span style={{ color: '#999' }}>未排班</span></Radio>
              <Radio value="rest"><Tag color="default">休息</Tag></Radio>
              {shifts.filter(s => s.parentId === currentScheduleGroupKey).map((s, i) => (
                <Radio key={s.key} value={s.key}>
                  <Tag color={SHIFT_COLORS[i % SHIFT_COLORS.length]}>{s.name}</Tag>
                  <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>{s.startTime} - {s.endTime}</span>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>
      </Modal>

      <Modal
        title={editingKey ? '编辑班次' : '新增班次'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 16, maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 }}>
          {/* 班次类型 */}
          <Form.Item name="shiftType" label="班次类型" rules={[{ required: true, message: '请选择班次类型' }]}>
            <ShiftTypeSelector />
          </Form.Item>
          <Form.Item name="name" label="班次名称" rules={[{ required: true, message: '请输入班次名称' }]}>
            <Input placeholder="如：白班、夜班、长白班" />
          </Form.Item>

          {watchShiftType === 'fixed' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="startTime" label="上班时间" rules={[{ required: watchShiftType === 'fixed', message: '请选择' }]}>
                    <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="endTime" label="下班时间" rules={[{ required: watchShiftType === 'fixed', message: '请选择' }]}>
                    <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
          {watchShiftType === 'scheduled' && (
            <>
            <div style={{ fontSize: 12, color: '#1677ff', marginBottom: 12, padding: '8px 12px', background: '#e6f4ff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ScheduleOutlined />
                排班打卡的上下班时间在排班窗口中按日设置
              </span>
              <Button type="primary" size="small" icon={<ScheduleOutlined />} onClick={() => {
                if (!editingKey) { message.warning('请先保存再编辑班次'); return; }
                setCurrentScheduleGroupKey(editingKey); setScheduleModalVisible(true);
              }}>
                编辑班次
              </Button>
            </div>
            {/* 班次详情 - 显示该组的子班次 */}
            {editingKey && shifts.filter(s => s.parentId === editingKey).length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>班次详情：</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {shifts.filter(s => s.parentId === editingKey).map((s, i) => (
                    <Tag key={s.key} color={SHIFT_COLORS[i % SHIFT_COLORS.length]} style={{ margin: 0 }}>
                      {s.name} {s.startTime}-{s.endTime}
                    </Tag>
                  ))}
                </div>
              </div>
            )}
            {editingKey && shifts.filter(s => s.parentId === editingKey).length === 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fffbe6', borderRadius: 6, border: '1px solid #ffe58f', fontSize: 12, color: '#ad6800' }}>
                尚未配置班次，请点击“编辑班次”添加
              </div>
            )}
            </>
          )}
          {watchShiftType === 'fixed' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="breakStart" label="午休开始">
                    <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="breakEnd" label="午休结束">
                    <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="lateThreshold" label="迟到容忍(分钟)">
                    <InputNumber min={0} max={120} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="isCrossDay" label="是否跨天" valuePropName="checked">
                    <Switch checkedChildren="是" unCheckedChildren="否" />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
          {watchShiftType === 'free' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="lateThreshold" label="迟到容忍(分钟)">
                  <InputNumber min={0} max={120} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="requiredHours" label="上班时长(小时)" tooltip="不满此时长算早退">
                  <InputNumber min={1} max={24} style={{ width: '100%' }} placeholder="8" />
                </Form.Item>
              </Col>
            </Row>
          )}

          {/* ===== 打卡人员 ===== */}
          <Divider style={{ margin: '12px 0 4px' }} />
          <div style={sectionStyle}><TeamOutlined />打卡人员</div>
          <Form.Item name="assignedGroups" label="按分组" tooltip="选择账号管理中的分组，组内所有人员自动纳入此班次">
            <Select mode="multiple" allowClear placeholder="选择分组（可多选）" style={{ width: '100%' }}>
              {groups.map(g => <Select.Option key={g.name} value={g.name}>{g.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="assignedUsers" label="按个人" tooltip="单独添加人员到该班次">
            <Select mode="multiple" allowClear placeholder="选择人员（可多选）" style={{ width: '100%' }}
              filterOption={(input, option) => {
                const label = String(option?.label || '');
                return label.toLowerCase().includes(input.toLowerCase());
              }}
              options={employees.map(e => ({ value: e.username, label: `${e.displayName}（${e.username}）${e.group ? ` - ${e.group}` : ''}` }))}
            />
          </Form.Item>

          {/* ===== 休息日与假期 ===== */}
          <Divider style={{ margin: '12px 0 4px' }} />
          <div style={sectionStyle}><CalendarOutlined />休息日与假期</div>
          <Form.Item name="restDays" label="固定休息日" tooltip="休息日无需打卡">
            <Checkbox.Group options={WEEKDAY_OPTIONS} />
          </Form.Item>
          <Form.Item name="holidays" label="放假日期" tooltip="点击日历选择日期，法定节假日自动标注红色">
            <HolidayManager />
          </Form.Item>

          {/* ===== 打卡位置 ===== */}
          <Divider style={{ margin: '12px 0 4px' }} />
          <div style={sectionStyle}><EnvironmentOutlined />打卡位置</div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="clockInLocation" label="打卡地点名称">
                <Input placeholder="如：公司办公室、工厂车间" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="clockInAddress" label="详细地址">
                <Input placeholder="如：浙江省台州市椒江区XX路XX号" />
              </Form.Item>
            </Col>
          </Row>

          {/* ===== 加班规则 ===== */}
          <Divider style={{ margin: '12px 0 4px' }} />
          <div style={sectionStyle}><DollarOutlined />加班规则</div>
          <Form.Item name="overtimeEnabled" label="启用加班计费" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          {Form.useWatch('overtimeEnabled', form) && (
            <>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="standardHours" label="标准工时(小时/天)" tooltip="每天标准工作时长，超过此时间计算加班">
                    <InputNumber min={1} max={24} style={{ width: '100%' }} placeholder="8" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="overtimeThreshold" label="加班起算(小时)" tooltip="超过标准工时多久开始计算加班，按整小时计">
                    <InputNumber min={0} max={12} style={{ width: '100%' }} placeholder="0" />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12, padding: '8px 12px', background: '#f6f8fa', borderRadius: 6 }}>
                工作日加班：超过标准工时 + 起算小时后，按「工作日加班费」计费（按整小时计算）
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="workdayOvertimeRate" label="工作日加班费" tooltip="工作日超时加班，每小时费用">
                    <InputNumber min={0} style={{ width: '100%' }} placeholder="元/小时" prefix="¥" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="restDayOvertimeRate" label="休息日加班费" tooltip="休息日加班，每小时费用（通常为工作日1.5-2倍）">
                    <InputNumber min={0} style={{ width: '100%' }} placeholder="元/小时" prefix="¥" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="holidayOvertimeRate" label="节假日加班费" tooltip="法定节假日加班，每小时费用（通常为工作日3倍）">
                    <InputNumber min={0} style={{ width: '100%' }} placeholder="元/小时" prefix="¥" />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </Form>
      </Modal>

      {/* 排班打卡班次编辑弹窗 */}
      <Modal
        title={schedShiftEditingKey ? '编辑班次' : '添加班次'}
        open={schedShiftModalVisible}
        onOk={handleSchedShiftSave}
        onCancel={() => setSchedShiftModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form autoComplete="off" form={schedShiftForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="班次名称" rules={[{ required: true, message: '请输入班次名称' }, { max: 8, message: '不能超过8个字符' }]}>
            <Input placeholder="例：早班，不能超过8个字符" maxLength={8} />
          </Form.Item>

          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: '#333' }}>工作时间</div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="startTime" label="上班时间" rules={[{ required: true, message: '请选择' }]}>
                <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endTime" label="下班时间" rules={[{ required: true, message: '请选择' }]}>
                <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: '#333' }}>休息时间</div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="breakStart" label="休息开始">
                <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="breakEnd" label="休息结束">
                <TimePicker format="HH:mm" style={{ width: '100%' }} minuteStep={5} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="lateThreshold" label="迟到容忍(分钟)" tooltip="允许迟到的分钟数，超过则记为迟到">
            <InputNumber min={0} max={120} style={{ width: '100%' }} placeholder="如：10" />
          </Form.Item>

          <div style={{ fontSize: 12, color: '#888', padding: '8px 12px', background: '#f6f8fa', borderRadius: 6, marginTop: -8 }}>
            提示：排班打卡类型的班次时间会在排班表中按日分配给员工
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ShiftPage;
