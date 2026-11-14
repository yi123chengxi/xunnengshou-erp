import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Space, Tag, message, Row, Col, Statistic, Tooltip, Checkbox, Divider,
} from 'antd';
import { EditOutlined, UserOutlined, TeamOutlined, UserDeleteOutlined, InfoCircleOutlined, SettingOutlined, ArrowUpOutlined, ArrowDownOutlined, FileTextOutlined, ExportOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  ResignationRecord, loadResignations, saveResignations, applyDueResignations, setAccountStatus, resignStateOf, RESIGN_REASONS,
} from './resignationStore';
import { useDatasetSyncReload, applyIfChanged } from '../../utils/useDatasetSyncReload';

const PRIMARY = '#1e4a7e';

interface EmployeeProfile {
  username: string;
  gender: '男' | '女';
  idCard: string;
  position: string;
  phone: string;
  contractStart: string;
  contractEnd: string;
  baseSalary: number;
  allowance: number;
  performanceSalary: number;
  socialSecurityBase: number;
  housingFundBase: number;
  emergencyContact: string;
  emergencyPhone: string;
  bankAccountName: string;
  bankName: string;
  bankAccountNumber: string;
  updatedAt: string;
}

interface EmployeeView {
  username: string;
  id: string;
  name: string;
  department: string;
  role: string;
  hireDate: string;
  accountStatus: string;
  employeeStatus: '在职' | '离职';
  profile?: EmployeeProfile;
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

const getAccountsKey = () => `accounts_${getDataOwner()}`;
const getProfilesKey = () => `hr_employee_profiles_${getDataOwner()}`;
const getFieldConfigKey = () => `hr_employee_field_config_${getDataOwner()}`;
const getChangeLogKey = () => `hr_employee_changelog_${getDataOwner()}`;
const getSnapshotKey = () => `hr_employee_snapshot_${getDataOwner()}`;

// 员工信息变更日志条目（档案编辑/档案建立/账号同步/离职管理四类来源）
export interface EmployeeChangeLogEntry {
  key: string;
  username: string;
  empName: string;
  empId: string;
  time: string;
  operator: string;
  source: '档案建立' | '档案编辑' | '账号同步' | '离职管理';
  changes: { field: string; old: string; new: string }[];
}

export const loadChangeLog = (): EmployeeChangeLogEntry[] => {
  try {
    const raw = localStorage.getItem(getChangeLogKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};
const appendChangeLog = (entries: EmployeeChangeLogEntry[]) => {
  if (!entries.length) return;
  try {
    const next = [...entries, ...loadChangeLog()].slice(0, 1000);
    localStorage.setItem(getChangeLogKey(), JSON.stringify(next));
  } catch { /* ignore */ }
};
export { appendChangeLog };

// 操作人显示名（registeredUsers 三级回退，与全局口径一致）
export const getOperatorName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u?.displayName || u?.contactPerson || u?.name) return u.displayName || u.contactPerson || u.name;
  } catch { /* ignore */ }
  return username || '未知';
};

// 档案字段中文标签（diff 日志用）
const PROFILE_FIELD_LABELS: { key: keyof EmployeeProfile; label: string }[] = [
  { key: 'gender', label: '性别' }, { key: 'phone', label: '手机号' }, { key: 'idCard', label: '身份证号' },
  { key: 'position', label: '职位' }, { key: 'contractStart', label: '合同开始' }, { key: 'contractEnd', label: '合同到期' },
  { key: 'baseSalary', label: '基本工资' }, { key: 'allowance', label: '岗位津贴' }, { key: 'performanceSalary', label: '绩效工资' },
  { key: 'socialSecurityBase', label: '社保基数' }, { key: 'housingFundBase', label: '公积金基数' },
  { key: 'emergencyContact', label: '紧急联系人' }, { key: 'emergencyPhone', label: '紧急联系电话' },
  { key: 'bankAccountName', label: '账户名称' }, { key: 'bankName', label: '开户银行' }, { key: 'bankAccountNumber', label: '银行账号' },
];
// 账号侧字段中文标签（账号同步 diff 日志用）
const ACCOUNT_FIELD_LABELS: { key: keyof EmployeeView; label: string }[] = [
  { key: 'id', label: '工号' }, { key: 'name', label: '姓名' }, { key: 'department', label: '部门' },
  { key: 'role', label: '角色' }, { key: 'employeeStatus', label: '在职状态' }, { key: 'hireDate', label: '入职日期' },
];
const fmtLogVal = (v: any): string => (v === undefined || v === null || v === '' ? '—' : String(v));

// 所有可用字段定义
const ALL_FIELDS = [
  { key: 'id', label: '工号', group: '基本信息' },
  { key: 'name', label: '姓名', group: '基本信息' },
  { key: 'username', label: '账号', group: '基本信息' },
  { key: 'department', label: '部门', group: '基本信息' },
  { key: 'role', label: '角色', group: '基本信息' },
  { key: 'gender', label: '性别', group: '个人信息' },
  { key: 'phone', label: '手机号', group: '个人信息' },
  { key: 'idCard', label: '身份证号', group: '个人信息' },
  { key: 'position', label: '职位', group: '个人信息' },
  { key: 'hireDate', label: '入职日期', group: '工作信息' },
  { key: 'employeeStatus', label: '在职状态', group: '工作信息' },
  { key: 'baseSalary', label: '基本工资', group: '薪资信息' },
  { key: 'allowance', label: '岗位津贴', group: '薪资信息' },
  { key: 'performanceSalary', label: '绩效工资', group: '薪资信息' },
  { key: 'socialSecurityBase', label: '社保基数', group: '薪资信息' },
  { key: 'housingFundBase', label: '公积金基数', group: '薪资信息' },
  { key: 'contractStart', label: '合同开始', group: '合同信息' },
  { key: 'contractEnd', label: '合同到期', group: '合同信息' },
  { key: 'emergencyContact', label: '紧急联系人', group: '紧急联系' },
  { key: 'emergencyPhone', label: '紧急联系电话', group: '紧急联系' },
  { key: 'bankAccountName', label: '账户名称', group: '银行信息' },
  { key: 'bankName', label: '开户银行', group: '银行信息' },
  { key: 'bankAccountNumber', label: '银行账号', group: '银行信息' },
];

const DEFAULT_VISIBLE_FIELDS = ['id', 'name', 'username', 'department', 'role', 'position', 'baseSalary', 'hireDate', 'employeeStatus', 'contractEnd', 'bankAccountName', 'bankName', 'bankAccountNumber'];

const loadFieldConfig = (): string[] => {
  try {
    const raw = localStorage.getItem(getFieldConfigKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [...DEFAULT_VISIBLE_FIELDS];
};

const loadProfiles = (): EmployeeProfile[] => {
  try {
    const raw = localStorage.getItem(getProfilesKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

const loadAccounts = (): any[] => {
  try {
    const raw = localStorage.getItem(getAccountsKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

const roleMap: Record<string, string> = {
  super_admin: '超级管理员', admin: '管理员', user: '普通用户', viewer: '只读用户',
};

const EmployeePage: React.FC = () => {
  const [profiles, setProfiles] = useState<EmployeeProfile[]>(loadProfiles);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUsername, setEditingUsername] = useState('');
  const [form] = Form.useForm();
  const [searchText, setSearchText] = useState('');
  const [visibleFields, setVisibleFields] = useState<string[]>(loadFieldConfig);
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);
  // 变更日志弹窗：logScope 为空=全部员工，否则=指定 username
  const [logVisible, setLogVisible] = useState(false);
  const [logScope, setLogScope] = useState('');
  const [logData, setLogData] = useState<EmployeeChangeLogEntry[]>([]);
  // 离职管理：记录集 + 发起离职弹窗
  const [resignations, setResignations] = useState<ResignationRecord[]>(loadResignations);
  const [resignVisible, setResignVisible] = useState(false);
  const [resignTarget, setResignTarget] = useState<EmployeeView | null>(null);
  const [resignForm] = Form.useForm();

  // 同步落地/窗口重新可见时重读：员工列表由 accounts_ 实时映射，档案/离职/字段配置
  // 都是从落盘读一次就固定；不刷新的话另一端刚建的账号/补充的档案看不到，
  // 而本端保存一次档案又会拿陈旧档案表整表回写
  useDatasetSyncReload(() => {
    applyIfChanged(setProfiles, loadProfiles());
    applyIfChanged(setVisibleFields, loadFieldConfig());
    applyIfChanged(setResignations, loadResignations());
    setRefreshKey(k => k + 1);
  });

  // 到达离职日期自动停用账号：挂载时 + 每 60s 巡检一次，生效时记变更日志并刷新列表
  useEffect(() => {
    const runDue = () => {
      const applied = applyDueResignations();
      if (!applied.length) return;
      appendChangeLog(applied.map(r => ({
        key: `elog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username: r.username, empName: r.empName, empId: '',
        time: new Date().toLocaleString('zh-CN'),
        operator: '离职计划自动生效',
        source: '离职管理' as const,
        changes: [{ field: '在职状态', old: '在职', new: `离职生效（${r.resignDate}，账号已停用）` }],
      })));
      setResignations(loadResignations());
      setRefreshKey(k => k + 1);
      message.info(`离职计划生效：${applied.map(r => r.empName).join('、')} 的账号已停用`);
    };
    runDue();
    const timer = setInterval(runDue, 60000);
    return () => clearInterval(timer);
  }, []);

  // 监听 storage 事件以响应其他标签页的账号/离职记录变更
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === getAccountsKey()) setRefreshKey(k => k + 1);
      if (e.key === `hr_resignations_${getDataOwner()}`) setResignations(loadResignations());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 动态组装员工列表：accounts（基础信息）+ profiles（HR信息）
  const employees: EmployeeView[] = useMemo(() => {
    const accounts = loadAccounts();
    const subAccounts = accounts.filter((a: any) => a.accountType === '子账号');
    return subAccounts.map((a: any) => {
      const profile = profiles.find(p => p.username === a.username);
      return {
        username: a.username,
        id: a.id || '-',
        name: a.displayName || a.username,
        department: a.group || '-',
        role: roleMap[a.role] || a.role || '-',
        hireDate: a.date || '-',
        accountStatus: a.status || 'normal',
        employeeStatus: a.status === 'disabled' ? '离职' as const : '在职' as const,
        profile,
      };
    });
  }, [profiles, refreshKey]);

  useEffect(() => {
    localStorage.setItem(getProfilesKey(), JSON.stringify(profiles));
  }, [profiles]);

  // 账号侧变更自动记日志：与上次快照比对（工号/姓名/部门/角色/在职状态/入职日期），
  // 新增/删除账号也各记一条；首次无快照时仅初始化不 flood 日志
  useEffect(() => {
    try {
      const raw = localStorage.getItem(getSnapshotKey());
      const snap: Record<string, any> | null = raw ? JSON.parse(raw) : null;
      const cur: Record<string, any> = {};
      employees.forEach(e => {
        cur[e.username] = { id: e.id, name: e.name, department: e.department, role: e.role, employeeStatus: e.employeeStatus, hireDate: e.hireDate };
      });
      if (!snap) { localStorage.setItem(getSnapshotKey(), JSON.stringify(cur)); return; }
      const now = new Date().toLocaleString('zh-CN');
      const entries: EmployeeChangeLogEntry[] = [];
      const mk = (username: string, empName: string, empId: string, changes: EmployeeChangeLogEntry['changes']): EmployeeChangeLogEntry => ({
        key: `elog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username, empName, empId, time: now, operator: '账号管理同步', source: '账号同步', changes,
      });
      employees.forEach(e => {
        const old = snap[e.username];
        if (!old) {
          entries.push(mk(e.username, e.name, e.id, [{ field: '员工', old: '—', new: '新增员工（账号管理新建子账号）' }]));
          return;
        }
        const changes = ACCOUNT_FIELD_LABELS
          .map(f => ({ f, ov: fmtLogVal(old[f.key]), nv: fmtLogVal((e as any)[f.key]) }))
          .filter(x => x.ov !== x.nv)
          .map(x => ({ field: x.f.label, old: x.ov, new: x.nv }));
        if (changes.length) entries.push(mk(e.username, e.name, e.id, changes));
      });
      Object.keys(snap).forEach(u => {
        if (!cur[u]) entries.push(mk(u, snap[u]?.name || u, snap[u]?.id || '', [{ field: '员工', old: snap[u]?.name || u, new: '员工移除（账号已删除）' }]));
      });
      appendChangeLog(entries);
      localStorage.setItem(getSnapshotKey(), JSON.stringify(cur));
    } catch { /* ignore */ }
  }, [employees]);

  // 打开变更日志弹窗（指定员工或全部）
  const openChangeLog = useCallback((username?: string) => {
    const list = loadChangeLog();
    setLogScope(username || '');
    setLogData(username ? list.filter(x => x.username === username) : list);
    setLogVisible(true);
  }, []);

  // 保存字段显示配置
  useEffect(() => {
    localStorage.setItem(getFieldConfigKey(), JSON.stringify(visibleFields));
  }, [visibleFields]);

  const stats = useMemo(() => ({
    active: employees.filter(e => e.employeeStatus === '在职').length,
    resigned: employees.filter(e => e.employeeStatus === '离职').length,
    total: employees.length,
    thisMonth: employees.filter(e => {
      if (e.hireDate === '-') return false;
      const hireMonth = dayjs(e.hireDate).format('YYYY-MM');
      return hireMonth === dayjs().format('YYYY-MM');
    }).length,
  }), [employees]);

  // 本页仅显示在职人员；离职人员在「人事管理 → 离职人员」页查看与复职
  const filteredData = useMemo(() => {
    return employees.filter(e => {
      if (e.employeeStatus !== '在职') return false;
      const matchSearch = !searchText || e.name.includes(searchText) || e.id.toLowerCase().includes(searchText.toLowerCase()) || e.username.includes(searchText);
      return matchSearch;
    });
  }, [employees, searchText]);

  // 发起离职：选择离职原因与离职时间；到期（含当日及之前）自动停用账号
  const openResignModal = useCallback((emp: EmployeeView) => {
    setResignTarget(emp);
    resignForm.resetFields();
    setResignVisible(true);
  }, [resignForm]);

  const handleResignConfirm = useCallback(() => {
    resignForm.validateFields().then(values => {
      if (!resignTarget) return;
      const resignDate = values.resignDate.format('YYYY-MM-DD');
      const reason = values.reason === '其他' && values.reasonNote ? `其他：${values.reasonNote}` : values.reason;
      const immediate = resignDate <= dayjs().format('YYYY-MM-DD');
      const rec: ResignationRecord = {
        key: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username: resignTarget.username,
        empName: resignTarget.name,
        reason,
        reasonNote: values.reasonNote || '',
        resignDate,
        status: immediate ? 'effective' : 'pending',
        createdAt: new Date().toISOString(),
        operator: getOperatorName(),
        effectiveAt: immediate ? new Date().toISOString() : undefined,
      };
      if (immediate) setAccountStatus(resignTarget.username, 'disabled');
      saveResignations([...loadResignations(), rec]);
      appendChangeLog([{
        key: `elog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        username: resignTarget.username, empName: resignTarget.name, empId: resignTarget.id,
        time: new Date().toLocaleString('zh-CN'),
        operator: getOperatorName(),
        source: '离职管理',
        changes: [{ field: '离职', old: '—', new: `${immediate ? '离职立即生效' : '发起离职'}（原因：${reason}；离职日期：${resignDate}）` }],
      }]);
      setResignations(loadResignations());
      setRefreshKey(k => k + 1);
      setResignVisible(false);
      message.success(immediate
        ? `已办理离职：${resignTarget.name} 的账号已停用，资料与档案保留`
        : `已发起离职：将于 ${resignDate} 自动停用 ${resignTarget.name} 的账号`);
    }).catch(() => { /* 校验失败 */ });
  }, [resignForm, resignTarget]);

  const handleEditProfile = useCallback((emp: EmployeeView) => {
    setEditingUsername(emp.username);
    const p = emp.profile;
    form.setFieldsValue({
      gender: p?.gender,
      idCard: p?.idCard,
      position: p?.position,
      phone: p?.phone,
      contractStart: p?.contractStart ? dayjs(p.contractStart) : null,
      contractEnd: p?.contractEnd ? dayjs(p.contractEnd) : null,
      baseSalary: p?.baseSalary,
      allowance: p?.allowance,
      performanceSalary: p?.performanceSalary,
      socialSecurityBase: p?.socialSecurityBase,
      housingFundBase: p?.housingFundBase,
      emergencyContact: p?.emergencyContact,
      emergencyPhone: p?.emergencyPhone,
      bankAccountName: p?.bankAccountName,
      bankName: p?.bankName,
      bankAccountNumber: p?.bankAccountNumber,
    });
    setModalVisible(true);
  }, [form]);

  const handleSaveProfile = useCallback(() => {
    form.validateFields().then(values => {
      const profile: EmployeeProfile = {
        username: editingUsername,
        gender: values.gender,
        idCard: values.idCard || '',
        position: values.position || '',
        phone: values.phone || '',
        contractStart: values.contractStart ? values.contractStart.format('YYYY-MM-DD') : '',
        contractEnd: values.contractEnd ? values.contractEnd.format('YYYY-MM-DD') : '',
        baseSalary: values.baseSalary || 0,
        allowance: values.allowance || 0,
        performanceSalary: values.performanceSalary || 0,
        socialSecurityBase: values.socialSecurityBase || 0,
        housingFundBase: values.housingFundBase || 0,
        emergencyContact: values.emergencyContact || '',
        emergencyPhone: values.emergencyPhone || '',
        bankAccountName: values.bankAccountName || '',
        bankName: values.bankName || '',
        bankAccountNumber: values.bankAccountNumber || '',
        updatedAt: new Date().toISOString(),
      };
      setProfiles(prev => {
        const idx = prev.findIndex(p => p.username === editingUsername);
        if (idx >= 0) return prev.map((p, i) => i === idx ? profile : p);
        return [...prev, profile];
      });
      // 变更记录日志：与保存前档案逐字段 diff（首次保存记为档案建立）
      const prevProfile = profiles.find(p => p.username === editingUsername);
      const changes = PROFILE_FIELD_LABELS
        .map(f => ({ label: f.label, ov: fmtLogVal(prevProfile ? (prevProfile as any)[f.key] : ''), nv: fmtLogVal((profile as any)[f.key]) }))
        .filter(x => x.ov !== x.nv)
        .map(x => ({ field: x.label, old: x.ov, new: x.nv }));
      if (changes.length || !prevProfile) {
        const emp = employees.find(e => e.username === editingUsername);
        appendChangeLog([{
          key: `elog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          username: editingUsername,
          empName: emp?.name || editingUsername,
          empId: emp?.id || '',
          time: new Date().toLocaleString('zh-CN'),
          operator: getOperatorName(),
          source: prevProfile ? '档案编辑' : '档案建立',
          changes: changes.length ? changes : [{ field: '档案', old: '—', new: '建立HR档案（未填字段）' }],
        }]);
      }
      setModalVisible(false);
      message.success('档案已保存');
    }).catch(() => { /* 校验失败 */ });
  }, [form, editingUsername, profiles, employees]);

  // 所有可用列定义
  const allColumns: ColumnsType<EmployeeView> = useMemo(() => [
    { title: '工号', dataIndex: 'id', key: 'id', width: 100, align: 'center' },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 100, align: 'center',
      render: (v: string) => <span><UserOutlined style={{ marginRight: 6, color: PRIMARY }} />{v}</span>,
    },
    { title: '账号', dataIndex: 'username', key: 'username', width: 120, align: 'center', render: (v: string) => <span style={{ color: '#888', fontSize: 12 }}>{v}</span> },
    { title: '部门', dataIndex: 'department', key: 'department', width: 100, align: 'center' },
    { title: '角色', dataIndex: 'role', key: 'role', width: 110, align: 'center' },
    { title: '性别', key: 'gender', width: 70, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.gender || '-' },
    { title: '手机号', key: 'phone', width: 120, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.phone || '-' },
    { title: '身份证号', key: 'idCard', width: 160, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.idCard ? <span style={{ fontSize: 12 }}>{r.profile.idCard}</span> : '-' },
    { title: '职位', key: 'position', width: 100, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.position || '-' },
    { title: '入职日期', dataIndex: 'hireDate', key: 'hireDate', width: 110, align: 'center' },
    { title: '在职状态', dataIndex: 'employeeStatus', key: 'employeeStatus', width: 130, align: 'center',
      render: (v: string, r: EmployeeView) => {
        const rs = resignStateOf(resignations, r.username);
        return (
          <Space size={4}>
            {v === '在职' ? <Tag color="green">在职</Tag> : <Tag color="red">离职</Tag>}
            {rs && rs.status === 'pending' && <Tooltip title={`离职原因：${rs.reason}`}><Tag color="orange">待离职 {rs.resignDate}</Tag></Tooltip>}
          </Space>
        );
      },
    },
    { title: '基本工资', key: 'baseSalary', width: 110, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.baseSalary ? `¥${r.profile.baseSalary.toLocaleString()}` : '-',
    },
    { title: '岗位津贴', key: 'allowance', width: 110, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.allowance ? `¥${r.profile.allowance.toLocaleString()}` : '-',
    },
    { title: '绩效工资', key: 'performanceSalary', width: 110, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.performanceSalary ? `¥${r.profile.performanceSalary.toLocaleString()}` : '-',
    },
    { title: '社保基数', key: 'socialSecurityBase', width: 100, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.socialSecurityBase ? `¥${r.profile.socialSecurityBase.toLocaleString()}` : '-',
    },
    { title: '公积金基数', key: 'housingFundBase', width: 100, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.housingFundBase ? `¥${r.profile.housingFundBase.toLocaleString()}` : '-',
    },
    { title: '合同开始', key: 'contractStart', width: 110, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.contractStart || '-',
    },
    { title: '合同到期', key: 'contractEnd', width: 110, align: 'center',
      render: (_: any, r: EmployeeView) => {
        if (!r.profile?.contractEnd) return '-';
        const isExpired = dayjs(r.profile.contractEnd).isBefore(dayjs());
        return <span style={{ color: isExpired ? '#ff4d4f' : undefined }}>{r.profile.contractEnd}{isExpired && ' ⚠'}</span>;
      },
    },
    { title: '紧急联系人', key: 'emergencyContact', width: 110, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.emergencyContact || '-',
    },
    { title: '紧急联系电话', key: 'emergencyPhone', width: 120, align: 'center',
      render: (_: any, r: EmployeeView) => r.profile?.emergencyPhone || '-',
    },
    { title: '账户名称', key: 'bankAccountName', width: 110, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.bankAccountName || '-' },
    { title: '开户银行', key: 'bankName', width: 120, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.bankName || '-' },
    { title: '银行账号', key: 'bankAccountNumber', width: 160, align: 'center', render: (_: any, r: EmployeeView) => r.profile?.bankAccountNumber ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.profile.bankAccountNumber}</span> : '-' },
  ], []);

  // 根据可见字段过滤并按顺序排列列
  const columns = useMemo(() => {
    const filtered = visibleFields
      .map(key => allColumns.find(col => col.key === key))
      .filter(Boolean) as ColumnsType<EmployeeView>;
    // 操作列始终显示在最后
    const opCol: any = {
      title: '操作', key: '_action', width: 210, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: EmployeeView) => (
        <Space size={0}>
          <Tooltip title="补充/编辑HR档案">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditProfile(r)}>档案</Button>
          </Tooltip>
          <Tooltip title="查看信息变更日志">
            <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => openChangeLog(r.username)}>日志</Button>
          </Tooltip>
          {r.employeeStatus === '在职' && !(() => { const rs = resignStateOf(resignations, r.username); return rs && rs.status === 'pending'; })() && (
            <Tooltip title="选择离职原因与离职时间，到期自动停用账号">
              <Button type="link" size="small" danger icon={<ExportOutlined />} onClick={() => openResignModal(r)}>发起离职</Button>
            </Tooltip>
          )}
        </Space>
      ),
    };
    return [...filtered, opCol];
  }, [allColumns, visibleFields, handleEditProfile, openChangeLog, resignations, openResignModal]);

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff', padding: '20px 28px', borderRadius: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}><TeamOutlined style={{ marginRight: 8 }} />员工档案</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>员工数据来自账号管理，状态自动同步</div>
        </div>
        <Tag icon={<InfoCircleOutlined />} color="processing" style={{ padding: '4px 12px', fontSize: 12 }}>新增员工请到「系统设置 → 账号管理」新建子账号</Tag>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="在职人数" value={stats.active} valueStyle={{ color: '#52c41a' }} prefix={<UserOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="离职人数" value={stats.resigned} valueStyle={{ color: '#ff4d4f' }} prefix={<UserDeleteOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="总人数" value={stats.total} /></Card></Col>
        <Col span={6}><Card><Statistic title="本月新入职" value={stats.thisMonth} valueStyle={{ color: '#1677ff' }} /></Card></Col>
      </Row>

      <Card bodyStyle={{ padding: '12px 16px' }} style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="搜索姓名/工号/账号" allowClear style={{ width: 220 }} onSearch={v => setSearchText(v)} onChange={e => { if (!e.target.value) setSearchText(''); }} />
          <Button icon={<SettingOutlined />} onClick={() => setFieldConfigVisible(true)}>字段显示设置</Button>
          <Button icon={<FileTextOutlined />} onClick={() => openChangeLog()}>变更日志</Button>
        </Space>
      </Card>

      <Card bodyStyle={{ padding: 0 }}>
        <Table<EmployeeView>
          columns={columns}
          dataSource={filteredData}
          rowKey="username"
          pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条` }}
          bordered
          size="middle"
          scroll={{ x: 1960 }}
        />
      </Card>

      <Modal title={`HR档案 - ${employees.find(e => e.username === editingUsername)?.name || ''}`} open={modalVisible} onOk={handleSaveProfile} onCancel={() => setModalVisible(false)} okText="保存" cancelText="取消" width={600}>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="gender" label="性别">
                <Select placeholder="选择" options={[{ value: '男', label: '男' }, { value: '女', label: '女' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="手机号" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="position" label="职位">
                <Input placeholder="职位" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="idCard" label="身份证号">
            <Input placeholder="身份证号" maxLength={18} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contractStart" label="合同开始">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contractEnd" label="合同到期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="baseSalary" label="基本工资">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="元" prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="allowance" label="岗位津贴">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="元" prefix="¥" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="performanceSalary" label="绩效工资">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="元" prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="socialSecurityBase" label="社保基数">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="元" prefix="¥" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="housingFundBase" label="公积金基数">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="元" prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="emergencyContact" label="紧急联系人">
                <Input placeholder="姓名" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="emergencyPhone" label="紧急联系电话">
                <Input placeholder="电话" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="bankAccountName" label="账户名称">
                <Input placeholder="账户名称" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="bankName" label="开户银行">
                <Input placeholder="开户银行" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="bankAccountNumber" label="银行账号">
                <Input placeholder="银行账号" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 字段显示设置弹窗 */}
      <Modal
        title="字段显示设置"
        open={fieldConfigVisible}
        onOk={() => {
          setFieldConfigVisible(false);
          message.success('字段显示设置已保存');
        }}
        onCancel={() => setFieldConfigVisible(false)}
        okText="确定" cancelText="取消" width={600}
      >
        <div style={{ marginTop: 16, maxHeight: '60vh', overflowY: 'auto' }}>
          {(() => {
            const groups = Array.from(new Set(ALL_FIELDS.map(f => f.group)));
            return groups.map(group => (
              <div key={group} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: PRIMARY }}>{group}</div>
                {ALL_FIELDS.filter(f => f.group === group).map((f, idx) => {
                  const isChecked = visibleFields.includes(f.key);
                  const fieldIdx = visibleFields.indexOf(f.key);
                  return (
                    <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Checkbox
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setVisibleFields(prev => [...prev, f.key]);
                          } else {
                            setVisibleFields(prev => prev.filter(k => k !== f.key));
                          }
                        }}
                      >
                        {f.label}
                      </Checkbox>
                      {isChecked && (
                        <Space size={2}>
                          <Button
                            type="text" size="small" icon={<ArrowUpOutlined />}
                            disabled={fieldIdx <= 0}
                            onClick={() => {
                              if (fieldIdx <= 0) return;
                              const arr = [...visibleFields];
                              [arr[fieldIdx - 1], arr[fieldIdx]] = [arr[fieldIdx], arr[fieldIdx - 1]];
                              setVisibleFields(arr);
                            }}
                          />
                          <Button
                            type="text" size="small" icon={<ArrowDownOutlined />}
                            disabled={fieldIdx >= visibleFields.length - 1}
                            onClick={() => {
                              if (fieldIdx >= visibleFields.length - 1) return;
                              const arr = [...visibleFields];
                              [arr[fieldIdx], arr[fieldIdx + 1]] = [arr[fieldIdx + 1], arr[fieldIdx]];
                              setVisibleFields(arr);
                            }}
                          />
                        </Space>
                      )}
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <Space>
          <Button size="small" onClick={() => setVisibleFields([...DEFAULT_VISIBLE_FIELDS])}>恢复默认</Button>
          <Button size="small" onClick={() => setVisibleFields(ALL_FIELDS.map(f => f.key))}>全选</Button>
          <Button size="small" onClick={() => setVisibleFields([])}>全不选</Button>
        </Space>
      </Modal>

      {/* 员工信息变更日志弹窗（单员工或全部） */}
      <Modal
        title={logScope ? `变更日志 - ${employees.find(e => e.username === logScope)?.name || logScope}` : '员工变更日志（全部）'}
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
            ...(!logScope ? [{
              title: '员工', key: 'emp', width: 130,
              render: (_: any, r: EmployeeChangeLogEntry) => <span>{r.empName}<span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>{r.empId}</span></span>,
            }] : []),
            { title: '时间', dataIndex: 'time', key: 'time', width: 150 },
            { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
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

      {/* 发起离职弹窗：离职原因 + 离职时间；到达离职日期自动停用账号（资料/档案保留） */}
      <Modal
        title={`发起离职 - ${resignTarget?.name || ''}`}
        open={resignVisible}
        onOk={handleResignConfirm}
        onCancel={() => setResignVisible(false)}
        okText="确认发起" cancelText="取消" width={480}
      >
        <Form autoComplete="off" form={resignForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="reason" label="离职原因" rules={[{ required: true, message: '请选择离职原因' }]}>
            <Select placeholder="选择离职原因" options={RESIGN_REASONS.map(r => ({ value: r, label: r }))} />
          </Form.Item>
          <Form.Item name="reasonNote" label="补充说明（可选）">
            <Input.TextArea rows={2} placeholder="离职原因补充说明/交接备注" maxLength={100} showCount />
          </Form.Item>
          <Form.Item name="resignDate" label="离职时间" rules={[{ required: true, message: '请选择离职时间' }]}
            extra="到达离职日期后账号自动停用（无法登录），账号资料与HR档案保留；离职日期当天仍计薪，之后不再计算工资；选择当日或之前则立即生效">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EmployeePage;
