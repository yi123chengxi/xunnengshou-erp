import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, DatePicker, Space, Tag, message, Row, Col, Statistic, Tooltip, Alert, Divider, Select,
} from 'antd';
import { SettingOutlined, DollarOutlined, DownloadOutlined, FileTextOutlined, InfoCircleOutlined, DatabaseOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getPfx } from '../../utils/devStore';
import { loadResignations, paidDaysInMonth, isUnpaidDay } from './resignationStore';

const PRIMARY = '#1e4a7e';

interface EmployeeProfile {
  username: string;
  baseSalary: number;
  allowance: number;
  performanceSalary: number;
  socialSecurityBase: number;
  housingFundBase: number;
  bankAccountName?: string;
  bankName?: string;
  bankAccountNumber?: string;
}

interface AttendanceRecord {
  key: string;
  date: string;
  employeeUsername: string;
  employeeName: string;
  clockIn?: string | null;
  clockOut?: string | null;
  workHours?: number;
  status: 'normal' | 'late' | 'early' | 'absent' | 'leave';
}

interface LeaveRecord {
  key: string;
  employeeUsername: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected';
  startDate: string;
}

interface SalaryRecord {
  key: string;
  month: string;
  employeeUsername: string;
  employeeName: string;
  baseSalary: number;
  allowance: number;
  performanceSalary: number;
  pieceworkWage: number;
  overtimePay: number;
  fullAttendanceBonus: number;
  grossPay: number;
  socialSecurity: number;
  housingFund: number;
  tax: number;
  lateDeduction: number;
  earlyDeduction: number;
  absentDeduction: number;
  leaveDeduction: number;
  otherDeduction: number;
  totalDeduction: number;
  netPay: number;
  attendanceDays: number;
  requiredDays: number;
  lateCount: number;
  earlyCount: number;
  leaveCount: number;
  status: 'draft' | 'confirmed' | 'paid';
  createdAt: string;
}

interface AttendanceDeductionRules {
  shiftKey: string; // 班次key，空串表示通用规则
  lateDeduction: number;
  lateThreshold: number;
  earlyDeduction: number;
  earlyThreshold: number;
  absentDeduction: number;
  leaveDeduction: number;
  fullAttendanceBonus: number;
  requiredDaysPerMonth: number;
  adjustmentDays: number; // 人工调整天数（弹性休息日）
  adjustmentSign: '+' | '-'; // 调整方向：+ 增加休息，- 减少休息
  updatedAt: string;
}

const DEFAULT_RULES: AttendanceDeductionRules = {
  shiftKey: '',
  lateDeduction: 50, lateThreshold: 10, earlyDeduction: 50, earlyThreshold: 10,
  absentDeduction: 200, leaveDeduction: 100, fullAttendanceBonus: 200, requiredDaysPerMonth: 26,
  adjustmentDays: 0, adjustmentSign: '-',
  updatedAt: '',
};

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

const getSalaryKey = () => `hr_salary_${getDataOwner()}`;
const getRulesKey = () => `hr_attendance_rules_${getDataOwner()}`;
const getAttendanceKey = () => `hr_attendance_${getDataOwner()}`;
const getLeavesKey = () => `hr_leaves_${getDataOwner()}`;
const getProfilesKey = () => `hr_employee_profiles_${getDataOwner()}`;
const getAccountsKey = () => `accounts_${getDataOwner()}`;
const getShiftsKey = () => `hr_shifts_${getDataOwner()}`;

// ============ 薪资数据来源配置（部门级：基本工资 + 绩效工资数据源） ============
interface SalarySourceCfg { key: string; dept: string; source: 'warehouse' | 'performance'; baseSalary: number; }
const getSourcesKey = () => `hr_salary_sources_${getDataOwner()}`;
const loadSources = (): SalarySourceCfg[] => {
  try {
    const raw = localStorage.getItem(getSourcesKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};
const SOURCE_OPTIONS = [
  { value: 'warehouse', label: '电商常用-仓库统计表-工资汇总-对应人员的薪资合计' },
  { value: 'performance', label: '电商管理-绩效考核-工资表-对应人员的应得薪资' },
];
// 部门清单：账号管理中的部门分组
const loadGroupNames = (): string[] => {
  try {
    const raw = localStorage.getItem(`account_groups_${getDataOwner()}`);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map((g: any) => g.name).filter(Boolean) : [];
  } catch { return []; }
};
// 源1：仓库统计-工资汇总（与 WarehouseStatsPage 工资汇总同口径：备货/急采/拣货/奖惩四表按人聚合）
const warehouseSalaryTotal = (owner: string, month: string, person: string): number => {
  const rd = (k: string): any[] => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const stock = rd(`ws_stock_${owner}`), urgent = rd(`ws_urgent_${owner}`), pick = rd(`ws_pick_${owner}`), note = rd(`ws_note_${owner}`);
  let total = 0;
  stock.forEach((r: any) => {
    if (r.month !== month) return;
    if (r.qcInspector === person) total += r.qcWage || 0;
    if (r.packer === person) total += r.packWage || 0;
    if (r.foreignTeam === person) total += r.commission || 0;
  });
  urgent.forEach((r: any) => {
    if (r.month !== month) return;
    if (r.inspector === person) total += r.wage || 0;
    if (r.packer === person) total += r.packWage || 0;
    if (r.foreignTeam === person) total += r.commission || 0;
  });
  pick.forEach((r: any) => {
    if (r.month !== month) return;
    if ((r.picker || r.creator) === person) total += r.wage || 0;
  });
  note.forEach((n: any) => {
    if (n.month !== month || n.person !== person) return;
    total += (n.type === 'punishment' ? -1 : 1) * (n.amount || 0);
  });
  return Math.round(total * 100) / 100;
};
// 源2：绩效考核-工资表（供应商平台已保存的历史薪资快照，取对应月份应得薪资）
const performanceEarned = (owner: string, month: string, person: string): number => {
  try {
    const raw = localStorage.getItem(`${getPfx('supplier')}salary_history_v1`);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return 0;
    const hits = arr.filter((h: any) => h.perfMonth === month);
    if (!hits.length) return 0;
    const latest = hits[hits.length - 1];
    const row = (latest.rows || []).find((r: any) => r.userName === person);
    return Math.round((Number(row?.earned) || 0) * 100) / 100;
  } catch { return 0; }
};

const loadRulesArray = (): AttendanceDeductionRules[] => {
  try {
    const raw = localStorage.getItem(getRulesKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      // 向后兼容：旧版是单对象，转为数组
      if (Array.isArray(parsed)) return parsed.map((r: any) => ({ ...DEFAULT_RULES, ...r, shiftKey: r.shiftKey || '' }));
      return [{ ...DEFAULT_RULES, ...parsed, shiftKey: parsed.shiftKey || '' }];
    }
  } catch { /* ignore */ }
  return [{ ...DEFAULT_RULES }];
};

const loadSalaryRecords = (): SalaryRecord[] => {
  try {
    const raw = localStorage.getItem(getSalaryKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

const SalaryPage: React.FC = () => {
  const [currentMonth, setCurrentMonth] = useState(dayjs());
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>(loadSalaryRecords);
  const [rulesArray, setRulesArray] = useState<AttendanceDeductionRules[]>(loadRulesArray);
  const [currentRuleShiftKey, setCurrentRuleShiftKey] = useState('');
  const [rulesVisible, setRulesVisible] = useState(false);
  const [rulesForm] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SalaryRecord | null>(null);
  // 薪资数据来源配置弹窗
  const [sourcesVisible, setSourcesVisible] = useState(false);
  const [sourcesDraft, setSourcesDraft] = useState<SalarySourceCfg[]>([]);
  const groupOptions = useMemo(() => loadGroupNames(), [sourcesVisible]);

  const monthStr = currentMonth.format('YYYY-MM');

  useEffect(() => {
    localStorage.setItem(getSalaryKey(), JSON.stringify(salaryRecords));
  }, [salaryRecords]);

  const monthRecords = useMemo(() => salaryRecords.filter(r => r.month === monthStr), [salaryRecords, monthStr]);

  const stats = useMemo(() => {
    const grossTotal = monthRecords.reduce((s, r) => s + r.grossPay, 0);
    const deductTotal = monthRecords.reduce((s, r) => s + r.totalDeduction, 0);
    const netTotal = monthRecords.reduce((s, r) => s + r.netPay, 0);
    return { grossTotal, deductTotal, netTotal, count: monthRecords.length };
  }, [monthRecords]);

  // 加载员工档案（用于显示银行信息）
  const profiles = useMemo((): EmployeeProfile[] => {
    try {
      const raw = localStorage.getItem(getProfilesKey());
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
    } catch { /* ignore */ }
    return [];
  }, []);

  // 当前选中的规则（根据 currentRuleShiftKey）
  const rules = useMemo(() => {
    return rulesArray.find(r => r.shiftKey === currentRuleShiftKey) || { ...DEFAULT_RULES, shiftKey: currentRuleShiftKey };
  }, [rulesArray, currentRuleShiftKey]);

  // 打开扣款规则弹窗
  const openRules = useCallback(() => {
    // 默认选中第一个规则
    const firstKey = rulesArray.length > 0 ? rulesArray[0].shiftKey : '';
    setCurrentRuleShiftKey(firstKey);
    const r = rulesArray.find(x => x.shiftKey === firstKey) || { ...DEFAULT_RULES, shiftKey: firstKey };
    rulesForm.setFieldsValue(r);
    setRulesVisible(true);
  }, [rulesForm, rulesArray]);

  // 切换班次时加载对应规则
  const handleShiftChange = useCallback((shiftKey: string) => {
    setCurrentRuleShiftKey(shiftKey);
    const r = rulesArray.find(x => x.shiftKey === shiftKey) || { ...DEFAULT_RULES, shiftKey };
    rulesForm.setFieldsValue(r);
  }, [rulesArray, rulesForm]);

  const saveRules = useCallback(() => {
    rulesForm.validateFields().then(values => {
      const updated: AttendanceDeductionRules = { ...values, shiftKey: currentRuleShiftKey, updatedAt: new Date().toISOString() };
      const newArray = [...rulesArray.filter(r => r.shiftKey !== currentRuleShiftKey), updated];
      setRulesArray(newArray);
      localStorage.setItem(getRulesKey(), JSON.stringify(newArray));
      setRulesVisible(false);
      message.success(`扣款规则已保存`);
    }).catch(() => { /* 校验失败 */ });
  }, [rulesForm, currentRuleShiftKey, rulesArray]);

  // 一键生成本月工资单
  const handleGenerate = useCallback(() => {
    // 离职/复职记录：工资截断口径——离职日期当天仍计薪，(离职, 复职) 开区间不计薪
    const resignations = loadResignations();
    const accounts = (() => {
      try {
        const raw = localStorage.getItem(getAccountsKey());
        // 与考勤打卡/补卡/统计同口径：全部在职账号（含主账号）均作为员工参与工资计算；
        // 已离职（停用）账号若当月仍有计薪天（离职日在当月内）也参与，离职次月起自动排除
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.filter((a: any) => a.status === 'normal' || paidDaysInMonth(resignations, a.username, monthStr) > 0); }
      } catch { /* ignore */ }
      return [];
    })();
    const profiles: EmployeeProfile[] = (() => {
      try {
        const raw = localStorage.getItem(getProfilesKey());
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
      } catch { /* ignore */ }
      return [];
    })();
    const attendance: AttendanceRecord[] = (() => {
      try {
        const raw = localStorage.getItem(getAttendanceKey());
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.filter((a: AttendanceRecord) => a.date.startsWith(monthStr)); }
      } catch { /* ignore */ }
      return [];
    })();
    const leaves: LeaveRecord[] = (() => {
      try {
        const raw = localStorage.getItem(getLeavesKey());
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.filter((l: LeaveRecord) => l.status === 'approved' && l.startDate.startsWith(monthStr)); }
      } catch { /* ignore */ }
      return [];
    })();
    // 加载班次数据
    const shifts: any[] = (() => {
      try {
        const raw = localStorage.getItem(getShiftsKey());
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.filter((s: any) => !s.parentId); }
      } catch { /* ignore */ }
      return [];
    })();

    if (accounts.length === 0) { message.warning('暂无在职员工，请先在账号管理中添加账号'); return; }

    // 查找员工所属班次
    const findShiftForEmployee = (username: string, userGroup: string) => {
      let shift = shifts.find(s => s.assignedUsers?.includes(username));
      if (!shift && userGroup) shift = shifts.find(s => s.assignedGroups?.includes(userGroup));
      if (!shift) shift = shifts.find((s: any) => s.isDefault) || shifts[0];
      return shift;
    };
    // 查找班次对应的扣款规则
    const findRulesForShift = (shiftKey: string): AttendanceDeductionRules => {
      return rulesArray.find(r => r.shiftKey === shiftKey) || { ...DEFAULT_RULES, shiftKey };
    };

    // 计算月应出勤天数：当月天数 - 休息日 - 放假日 - 人工调整天数
    const calcRequiredDays = (shift: any, shiftRules: AttendanceDeductionRules): number => {
      const [year, month] = monthStr.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const restDays: number[] = shift?.restDays || [];
      let restDayCount = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dayOfWeek = new Date(year, month - 1, d).getDay();
        if (restDays.includes(dayOfWeek)) restDayCount++;
      }
      const holidays: string[] = shift?.holidays || [];
      const holidayCount = holidays.filter((h: string) => h.startsWith(monthStr)).length;
      const adjDays = shiftRules.adjustmentDays || 0;
      return Math.max(1, daysInMonth - restDayCount - holidayCount - adjDays);
    };

    const newRecords: SalaryRecord[] = accounts.map((acc: any): SalaryRecord | null => {
      const profile = profiles.find(p => p.username === acc.username);
      // 主账号别名匹配：打卡记录记登录名（owner），而账号表主账号 username 可能为 admin 等历史值
      const ownerName = getDataOwner();
      const matchAtt = (a: AttendanceRecord) => a.employeeUsername === acc.username
        || (acc.accountType === '主账号' && a.employeeUsername === ownerName);
      // 计薪窗口：整月不计薪（离职次月及以后）跳过该员工；离职当月按计薪天数折算
      const [mY, mM] = monthStr.split('-').map(Number);
      const daysInMonth = new Date(mY, mM, 0).getDate();
      const paidDays = paidDaysInMonth(resignations, acc.username, monthStr);
      if (paidDays === 0) return null;
      const payRatio = paidDays / daysInMonth;
      const empAttendance = attendance.filter(a => matchAtt(a) && !isUnpaidDay(resignations, acc.username, a.date));
      const empLeaves = leaves.filter(l => l.employeeUsername === acc.username);

      // 查找该员工的班次及对应扣款规则
      const shift = findShiftForEmployee(acc.username, acc.group);
      const shiftRules = findRulesForShift(shift?.key || '');

      // 薪资数据来源：部门已配置时基本工资以配置为准、绩效工资取来源数据；未配置按员工档案默认计算；
      // 离职当月基本工资/岗位津贴/档案绩效工资按计薪天数折算，来源实发绩效（仓库汇总/绩效快照）不折算
      const srcCfg = loadSources().find(s => s.dept && s.dept === acc.group);
      const empName = acc.displayName || acc.username;
      const baseFull = srcCfg ? (Number(srcCfg.baseSalary) || 0) : (profile?.baseSalary || 0);
      const baseSalary = Math.round(baseFull * payRatio);
      const allowance = Math.round((profile?.allowance || 0) * payRatio);
      const performanceSalary = srcCfg
        ? (srcCfg.source === 'warehouse'
          ? warehouseSalaryTotal(getDataOwner(), monthStr, empName)
          : performanceEarned(getDataOwner(), monthStr, empName))
        : Math.round((profile?.performanceSalary || 0) * payRatio);
      // 迟到/早退与打卡数据关联：按员工所属班次的上下班时间与容忍分钟从打卡原始时间重新判定；
      // 当日无下班卡按早退计；自由打卡班次（无上下班时间）按要求工时判定；班次无时间配置时回退打卡落库状态
      const toMin = (t: string) => { const p = String(t || '').split(':'); return parseInt(p[0]) * 60 + (parseInt(p[1]) || 0); };
      const shiftStart = shift?.startTime ? toMin(shift.startTime) : null;
      const shiftEnd = shift?.endTime ? toMin(shift.endTime) : null;
      const threshold = Number(shift?.lateThreshold) || 0;
      const requiredHours = Number(shift?.requiredHours) || 0;
      const lateCount = empAttendance.filter(a => {
        if (shiftStart !== null && a.clockIn) return toMin(a.clockIn) > shiftStart + threshold;
        return a.status === 'late';
      }).length;
      const earlyCount = empAttendance.filter(a => {
        if (shiftEnd !== null) return !a.clockOut || toMin(a.clockOut) < shiftEnd - threshold;
        if (requiredHours > 0) return (Number(a.workHours) || 0) < requiredHours;
        return a.status === 'early';
      }).length;
      const leaveCount = empLeaves.reduce((s, l) => {
        // 请假天数仅计落在计薪窗口内的部分（离职日之后的请假不再扣款）
        let cnt = 0;
        for (let i = 0; i < l.days; i++) {
          const d = dayjs(l.startDate).add(i, 'day').format('YYYY-MM-DD');
          if (d.startsWith(monthStr) && !isUnpaidDay(resignations, acc.username, d)) cnt++;
        }
        return s + cnt;
      }, 0);
      const attendanceDays = empAttendance.filter(a => a.status !== 'absent').length;

      // 旷工推导：当月已过应出勤工作日（扣除班次休息日/放假日）− 打卡天数 − 批准请假天数 − 弹性休息天数，不足部分计旷工
      const calcElapsedWorkDays = (sh: any): number => {
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const nowM = dayjs().format('YYYY-MM');
        const lastDay = monthStr < nowM ? daysInMonth : (monthStr > nowM ? 0 : dayjs().date());
        const restDays: number[] = sh?.restDays || [];
        const holidays: string[] = sh?.holidays || [];
        let cnt = 0;
        for (let d = 1; d <= lastDay; d++) {
          const ds = `${monthStr}-${String(d).padStart(2, '0')}`;
          if (isUnpaidDay(resignations, acc.username, ds)) continue;
          if (restDays.includes(new Date(year, month - 1, d).getDay())) continue;
          if (holidays.some(h => h === `${monthStr}-${String(d).padStart(2, '0')}` || h === `${monthStr}-${d}`)) continue;
          cnt++;
        }
        return cnt;
      };
      const explicitAbsent = empAttendance.filter(a => a.status === 'absent').length;
      const derivedAbsent = Math.max(0, calcElapsedWorkDays(shift) - attendanceDays - leaveCount - (shiftRules.adjustmentDays || 0));
      const absentDays = explicitAbsent + derivedAbsent;

      const lateDed = lateCount * shiftRules.lateDeduction;
      const earlyDed = earlyCount * shiftRules.earlyDeduction;
      const absentDed = absentDays * shiftRules.absentDeduction;
      const leaveDed = leaveCount * shiftRules.leaveDeduction;

      const hasFullAttendance = lateCount === 0 && earlyCount === 0 && absentDays === 0 && leaveCount === 0;
      const fullBonus = hasFullAttendance ? shiftRules.fullAttendanceBonus : 0;

      const socialSecurity = profile?.socialSecurityBase ? Math.round(profile.socialSecurityBase * 0.105) : 0;
      const housingFund = profile?.housingFundBase ? Math.round(profile.housingFundBase * 0.07) : 0;

      const grossPay = baseSalary + allowance + fullBonus + performanceSalary;
      const totalDeduction = socialSecurity + housingFund + lateDed + earlyDed + absentDed + leaveDed;
      const netPay = grossPay - totalDeduction;

      return {
        key: `sal_${acc.username}_${monthStr}`,
        month: monthStr,
        employeeUsername: acc.username,
        employeeName: acc.displayName || acc.username,
        baseSalary, allowance, performanceSalary, pieceworkWage: 0, overtimePay: 0,
        fullAttendanceBonus: fullBonus, grossPay,
        socialSecurity, housingFund, tax: 0,
        lateDeduction: lateDed, earlyDeduction: earlyDed,
        absentDeduction: absentDed, leaveDeduction: leaveDed,
        otherDeduction: 0, totalDeduction, netPay,
        attendanceDays, requiredDays: calcRequiredDays(shift, shiftRules),
        lateCount, earlyCount, leaveCount,
        status: 'draft' as const,
        createdAt: new Date().toISOString(),
      };
    }).filter((r): r is SalaryRecord => r !== null);

    // 合并：替换同月旧记录
    setSalaryRecords(prev => {
      const otherMonths = prev.filter(r => r.month !== monthStr);
      return [...otherMonths, ...newRecords];
    });
    message.success(`已生成 ${newRecords.length} 条工资单`);
  }, [monthStr, rulesArray]);

  const handleExport = useCallback(() => {
    if (monthRecords.length === 0) { message.warning('暂无数据可导出'); return; }
    const headers = ['员工', '账户名称', '开户银行', '银行账号', '基本工资', '岗位津贴', '全勤奖', '绩效工资', '应发合计', '社保', '公积金', '迟到扣款', '早退扣款', '旷工扣款', '请假扣款', '扣款合计', '实发工资'];
    const rows = monthRecords.map(r => {
      const p = profiles.find(x => x.username === r.employeeUsername);
      return [r.employeeName, p?.bankAccountName || '', p?.bankName || '', p?.bankAccountNumber || '', r.baseSalary, r.allowance, r.fullAttendanceBonus, r.performanceSalary, r.grossPay, r.socialSecurity, r.housingFund, r.lateDeduction, r.earlyDeduction, r.absentDeduction, r.leaveDeduction, r.totalDeduction, r.netPay];
    });
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `工资表_${monthStr}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [monthRecords, monthStr, profiles]);

  const columns: ColumnsType<SalaryRecord> = useMemo(() => [
    { title: '员工', dataIndex: 'employeeName', width: 90, align: 'center', fixed: 'left' as const },
    { title: '账户名称', width: 110, align: 'center',
      render: (_: any, r: SalaryRecord) => profiles.find(p => p.username === r.employeeUsername)?.bankAccountName || '-',
    },
    { title: '开户银行', width: 120, align: 'center',
      render: (_: any, r: SalaryRecord) => profiles.find(p => p.username === r.employeeUsername)?.bankName || '-',
    },
    { title: '银行账号', width: 160, align: 'center',
      render: (_: any, r: SalaryRecord) => {
        const acc = profiles.find(p => p.username === r.employeeUsername)?.bankAccountNumber;
        return acc ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{acc}</span> : '-';
      },
    },
    { title: '基本工资', dataIndex: 'baseSalary', width: 100, align: 'center', render: (v: number) => v ? `¥${v.toLocaleString()}` : '-' },
    { title: '岗位津贴', dataIndex: 'allowance', width: 90, align: 'center', render: (v: number) => v ? `¥${v.toLocaleString()}` : '-' },
    { title: '全勤奖', dataIndex: 'fullAttendanceBonus', width: 80, align: 'center', render: (v: number) => v ? <span style={{ color: '#52c41a' }}>¥{v}</span> : '-' },
    { title: '绩效工资', dataIndex: 'performanceSalary', width: 90, align: 'center', render: (v: number) => v ? <span style={{ color: '#1890ff' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '应发合计', dataIndex: 'grossPay', width: 100, align: 'center', render: (v: number) => <strong>¥{v.toLocaleString()}</strong> },
    { title: '社保', dataIndex: 'socialSecurity', width: 80, align: 'center', render: (v: number) => v ? <span style={{ color: '#ff4d4f' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '公积金', dataIndex: 'housingFund', width: 80, align: 'center', render: (v: number) => v ? <span style={{ color: '#ff4d4f' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '迟到扣款', dataIndex: 'lateDeduction', width: 90, align: 'center', render: (v: number) => v ? <span style={{ color: '#fa8c16' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '早退扣款', dataIndex: 'earlyDeduction', width: 90, align: 'center', render: (v: number) => v ? <span style={{ color: '#fa8c16' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '旷工扣款', dataIndex: 'absentDeduction', width: 90, align: 'center', render: (v: number) => v ? <span style={{ color: '#ff4d4f' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '请假扣款', dataIndex: 'leaveDeduction', width: 90, align: 'center', render: (v: number) => v ? <span style={{ color: '#faad14' }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '扣款合计', dataIndex: 'totalDeduction', width: 100, align: 'center', render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>¥{v.toLocaleString()}</span> },
    { title: '实发工资', dataIndex: 'netPay', width: 110, align: 'center', render: (v: number) => <strong style={{ color: PRIMARY, fontSize: 14 }}>¥{v.toLocaleString()}</strong> },
    { title: '操作', width: 70, align: 'center', fixed: 'right' as const,
      render: (_: any, r: SalaryRecord) => (
        <Tooltip title="查看工资条">
          <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => { setSelectedRecord(r); setDetailVisible(true); }}>详情</Button>
        </Tooltip>
      ),
    },
  ], []);

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff', padding: '20px 28px', borderRadius: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}><DollarOutlined style={{ marginRight: 8 }} />工资计算</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>联动考勤数据自动计算工资</div>
        </div>
        <Space>
          <Button icon={<DatabaseOutlined />} onClick={() => { setSourcesDraft(loadSources()); setSourcesVisible(true); }} style={{ fontWeight: 600 }}>薪资数据来源</Button>
          <Button icon={<SettingOutlined />} onClick={openRules} style={{ fontWeight: 600 }}>扣款规则设置</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport} style={{ fontWeight: 600 }}>导出CSV</Button>
        </Space>
      </div>

      {/* 月份选择 + 统计 */}
      <Card bodyStyle={{ padding: '12px 16px' }} style={{ marginBottom: 16 }}>
        <Row align="middle" gutter={16}>
          <Col>
            <Space>
              <span style={{ fontWeight: 600 }}>月份：</span>
              <DatePicker picker="month" value={currentMonth} onChange={v => v && setCurrentMonth(v)} allowClear={false} />
            </Space>
          </Col>
          <Col flex="auto">
            <Row gutter={24} justify="end">
              <Col><Statistic title="应发总额" value={stats.grossTotal} prefix="¥" valueStyle={{ fontSize: 16, color: '#52c41a' }} /></Col>
              <Col><Statistic title="扣款总额" value={stats.deductTotal} prefix="¥" valueStyle={{ fontSize: 16, color: '#ff4d4f' }} /></Col>
              <Col><Statistic title="实发总额" value={stats.netTotal} prefix="¥" valueStyle={{ fontSize: 16, color: PRIMARY }} /></Col>
              <Col><Statistic title="人数" value={stats.count} valueStyle={{ fontSize: 16 }} /></Col>
            </Row>
          </Col>
          <Col>
            <Button type="primary" onClick={handleGenerate} style={{ fontWeight: 600 }}>一键生成本月工资单</Button>
          </Col>
        </Row>
      </Card>

      <Card bodyStyle={{ padding: 0 }}>
        <Table<SalaryRecord>
          columns={columns}
          dataSource={monthRecords}
          rowKey="key"
          pagination={false}
          bordered
          size="middle"
          scroll={{ x: 1500 }}
        />
      </Card>

      {/* 扣款规则设置弹窗 */}
      <Modal title="考勤扣款规则设置" open={rulesVisible} onOk={saveRules} onCancel={() => setRulesVisible(false)} okText="保存" cancelText="取消" width={600}>
        <Form autoComplete="off" form={rulesForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="选择班次" tooltip="针对不同班次分别设置扣款规则">
            <Select
              value={currentRuleShiftKey}
              onChange={handleShiftChange}
              style={{ width: '100%' }}
              placeholder="选择班次"
              options={(() => {
                try {
                  const raw = localStorage.getItem(getShiftsKey());
                  if (raw) {
                    const arr = JSON.parse(raw);
                    if (Array.isArray(arr)) {
                      return arr.filter((s: any) => !s.parentId).map((s: any) => ({ value: s.key, label: s.name }));
                    }
                  }
                } catch { /* ignore */ }
                return [];
              })()}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="lateDeduction" label="迟到扣款（元/次）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="earlyDeduction" label="早退扣款（元/次）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="absentDeduction" label="旷工扣款（元/天）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="leaveDeduction" label="请假扣款（元/天）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="fullAttendanceBonus" label="全勤奖金（元/月）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="月应出勤天数" tooltip="自动计算：当月天数 - 休息日 - 放假日 - 人工调整天数">
                <div style={{ padding: '4px 11px', background: '#f5f5f5', borderRadius: 6, color: '#666' }}>自动计算（生成工资单时按班次规则计算）</div>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="人工调整天数" tooltip="每个班次每月可额外休息的天数，时间自由选择，算全勤">
                <Input.Group compact>
                  <Form.Item name="adjustmentSign" noStyle>
                    <Select style={{ width: 70 }} options={[{ value: '-', label: '－' }, { value: '+', label: '＋' }]} />
                  </Form.Item>
                  <Form.Item name="adjustmentDays" noStyle>
                    <InputNumber min={0} max={10} style={{ width: 80 }} placeholder="0" />
                  </Form.Item>
                  <span style={{ padding: '4px 8px', color: '#666' }}>天</span>
                </Input.Group>
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Alert message="扣款规则将自动应用于工资计算，生成工资单时按此规则计算考勤相关扣款。" type="info" showIcon style={{ marginTop: 8 }} />
      </Modal>

      {/* 工资条详情弹窗 */}
      <Modal title={`工资条 - ${selectedRecord?.employeeName || ''} (${selectedRecord?.month || ''})`} open={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} width={500}>
        {selectedRecord && (
          <div style={{ padding: '16px 0' }}>
            <Row gutter={[16, 12]}>
              <Col span={12}><strong>基本工资：</strong>¥{selectedRecord.baseSalary.toLocaleString()}</Col>
              <Col span={12}><strong>岗位津贴：</strong>¥{selectedRecord.allowance.toLocaleString()}</Col>
              <Col span={12}><strong>全勤奖：</strong><span style={{ color: '#52c41a' }}>¥{selectedRecord.fullAttendanceBonus}</span></Col>
              <Col span={12}><strong>绩效工资：</strong><span style={{ color: '#1890ff' }}>¥{selectedRecord.performanceSalary.toLocaleString()}</span></Col>
              <Col span={12}><strong>应发合计：</strong><span style={{ fontWeight: 700, fontSize: 16 }}>¥{selectedRecord.grossPay.toLocaleString()}</span></Col>
            </Row>
            <Divider />
            <Row gutter={[16, 12]}>
              <Col span={12}><strong>社保：</strong><span style={{ color: '#ff4d4f' }}>-¥{selectedRecord.socialSecurity}</span></Col>
              <Col span={12}><strong>公积金：</strong><span style={{ color: '#ff4d4f' }}>-¥{selectedRecord.housingFund}</span></Col>
              <Col span={12}><strong>迟到扣款：</strong><span style={{ color: '#fa8c16' }}>-¥{selectedRecord.lateDeduction}</span></Col>
              <Col span={12}><strong>早退扣款：</strong><span style={{ color: '#fa8c16' }}>-¥{selectedRecord.earlyDeduction}</span></Col>
              <Col span={12}><strong>旷工扣款：</strong><span style={{ color: '#ff4d4f' }}>-¥{selectedRecord.absentDeduction}</span></Col>
              <Col span={12}><strong>请假扣款：</strong><span style={{ color: '#faad14' }}>-¥{selectedRecord.leaveDeduction}</span></Col>
            </Row>
            <Divider />
            <Row gutter={[16, 12]}>
              <Col span={12}><strong>扣款合计：</strong><span style={{ color: '#ff4d4f', fontWeight: 600 }}>¥{selectedRecord.totalDeduction.toLocaleString()}</span></Col>
              <Col span={12}><strong style={{ fontSize: 18, color: PRIMARY }}>实发工资：¥{selectedRecord.netPay.toLocaleString()}</strong></Col>
            </Row>
            <Divider />
            <Row gutter={[16, 8]}>
              <Col span={8}>出勤 {selectedRecord.attendanceDays}/{selectedRecord.requiredDays} 天</Col>
              <Col span={8}>迟到 {selectedRecord.lateCount} 次</Col>
              <Col span={8}>早退 {selectedRecord.earlyCount} 次</Col>
            </Row>
          </div>
        )}
      </Modal>
      {/* 薪资数据来源配置弹窗 */}
      <Modal title="薪资数据来源设置" open={sourcesVisible}
        onOk={() => {
          localStorage.setItem(getSourcesKey(), JSON.stringify(sourcesDraft));
          setSourcesVisible(false);
          message.success('薪资数据来源已保存，下次生成工资单时生效');
        }}
        onCancel={() => setSourcesVisible(false)} okText="保存" cancelText="取消" width={760}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="设置了薪资来源的部门：基本工资以本页配置为准，来源数据填充到「绩效工资」字段；其他字段计算规则不变。未设置的部门按员工档案默认计算。" />
        <Table size="small" bordered rowKey="key" pagination={false}
          dataSource={sourcesDraft}
          columns={[
            {
              title: '部门', dataIndex: 'dept', width: 200,
              render: (_: any, r: SalarySourceCfg) => (
                <Select size="small" style={{ width: '100%' }} placeholder="选择部门（账号管理部门分组）" value={r.dept || undefined}
                  options={groupOptions.map(g => ({ value: g, label: g }))}
                  onChange={v => setSourcesDraft(prev => prev.map(x => x.key === r.key ? { ...x, dept: v } : x))} />
              ),
            },
            {
              title: '薪资来源', dataIndex: 'source', width: 320,
              render: (_: any, r: SalarySourceCfg) => (
                <Select size="small" style={{ width: '100%' }} placeholder="下拉框选择数据来源" value={r.source || undefined}
                  options={SOURCE_OPTIONS}
                  onChange={v => setSourcesDraft(prev => prev.map(x => x.key === r.key ? { ...x, source: v } : x))} />
              ),
            },
            {
              title: '基本工资', dataIndex: 'baseSalary', width: 130,
              render: (_: any, r: SalarySourceCfg) => (
                <InputNumber size="small" min={0} style={{ width: '100%' }} placeholder="输入数字" value={r.baseSalary}
                  onChange={v => setSourcesDraft(prev => prev.map(x => x.key === r.key ? { ...x, baseSalary: Number(v) || 0 } : x))} />
              ),
            },
            {
              title: '操作', key: 'op', width: 70, align: 'center' as const,
              render: (_: any, r: SalarySourceCfg) => (
                <Button size="small" type="link" danger icon={<DeleteOutlined />}
                  onClick={() => setSourcesDraft(prev => prev.filter(x => x.key !== r.key))} />
              ),
            },
          ] as any}
          locale={{ emptyText: '暂无配置，点击下方按钮新增' }}
        />
        <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 12 }}
          onClick={() => setSourcesDraft(prev => [...prev, { key: `src-${Date.now()}`, dept: '', source: 'warehouse', baseSalary: 0 }])}>
          新增部门配置
        </Button>
      </Modal>
    </div>
  );
};

export default SalaryPage;
