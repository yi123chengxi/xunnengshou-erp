/**
 * 离职/复职管理共享存储与账号联动（hr_ 前缀自动纳入 serverSync 跨端同步）
 * 契约：
 *  - 离职记录独立存 hr_resignations_<owner>，不污染账号表业务字段；
 *  - 到达离职日期时由 applyDueResignations 统一把 accounts_<owner>.status 与
 *    registeredUsers[].accountStatus 置 disabled（与账号管理停用同口径，禁用后无法登录），
 *    账号资料/档案/日志全部保留；
 *  - 工资截断口径：离职日期当天仍计薪，(离职日期, 复职日期) 开区间内不计薪。
 */
import dayjs from 'dayjs';

export interface ResignationRecord {
  key: string;
  username: string;
  empName: string;
  reason: string;          // 离职原因（枚举或「其他」）
  reasonNote: string;      // 补充说明
  resignDate: string;      // YYYY-MM-DD 离职生效日期（当日仍计薪）
  status: 'pending' | 'effective' | 'rehired';
  createdAt: string;
  operator: string;
  effectiveAt?: string;    // 实际停用账号时间
  rehiredAt?: string;      // YYYY-MM-DD 复职日期（当日恢复计薪）
  rehireNote?: string;
}

export const getDataOwner = (): string => {
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

const getResignKey = () => `hr_resignations_${getDataOwner()}`;
const getAccountsKey = () => `accounts_${getDataOwner()}`;

export const loadResignations = (): ResignationRecord[] => {
  try {
    const raw = localStorage.getItem(getResignKey());
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch { /* ignore */ }
  return [];
};

export const saveResignations = (list: ResignationRecord[]) => {
  localStorage.setItem(getResignKey(), JSON.stringify(list));
};

// 账号停用/启用：与账号管理 handleToggleStatus 同口径（accounts.status + registeredUsers.accountStatus）
export const setAccountStatus = (username: string, status: 'normal' | 'disabled'): boolean => {
  try {
    const accounts: any[] = JSON.parse(localStorage.getItem(getAccountsKey()) || '[]');
    const idx = accounts.findIndex((a: any) => a.username === username);
    if (idx < 0) return false;
    accounts[idx].status = status;
    localStorage.setItem(getAccountsKey(), JSON.stringify(accounts));
  } catch { return false; }
  try {
    const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const ri = regUsers.findIndex((u: any) => u.username === username);
    if (ri >= 0) {
      regUsers[ri].accountStatus = status;
      localStorage.setItem('registeredUsers', JSON.stringify(regUsers));
    }
  } catch { /* ignore */ }
  return true;
};

// 到达离职日期的待生效记录：停用账号并置为已生效；返回本次生效的记录（供调用方记日志/刷新）
export const applyDueResignations = (): ResignationRecord[] => {
  const list = loadResignations();
  const today = dayjs().format('YYYY-MM-DD');
  const due = list.filter(r => r.status === 'pending' && r.resignDate <= today);
  if (!due.length) return [];
  due.forEach(r => {
    setAccountStatus(r.username, 'disabled');
    r.status = 'effective';
    r.effectiveAt = new Date().toISOString();
  });
  saveResignations(list);
  return due;
};

// 复职：恢复账号可用 + 最近一条已生效记录标记 rehired；返回更新后的记录
export const rehireEmployee = (username: string, rehireDate: string, note: string): ResignationRecord | null => {
  setAccountStatus(username, 'normal');
  const list = loadResignations();
  const recs = list.filter(r => r.username === username && r.status === 'effective');
  if (!recs.length) { saveResignations(list); return null; }
  // 取离职日期最近的一条生效记录闭环
  recs.sort((a, b) => (a.resignDate < b.resignDate ? 1 : -1));
  const rec = recs[0];
  rec.status = 'rehired';
  rec.rehiredAt = rehireDate;
  rec.rehireNote = note;
  saveResignations(list);
  return rec;
};

// 不计薪日判定：离职日期之后、复职日期之前（两端当日均计薪）
export const isUnpaidDay = (records: ResignationRecord[], username: string, dateStr: string): boolean =>
  records.some(r => r.username === username && (r.status === 'effective' || r.status === 'rehired')
    && dateStr > r.resignDate && dateStr < (r.status === 'rehired' ? (r.rehiredAt || '9999-12-31') : '9999-12-31'));

// 指定月份的计薪天数（0=整月不计薪，跳过该员工工资单）
export const paidDaysInMonth = (records: ResignationRecord[], username: string, monthStr: string): number => {
  const [y, m] = monthStr.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  let cnt = 0;
  for (let d = 1; d <= days; d++) {
    if (!isUnpaidDay(records, username, `${monthStr}-${String(d).padStart(2, '0')}`)) cnt++;
  }
  return cnt;
};

// 员工当前离职态：pending=待离职（仍在职）/ effective=已离职 / rehired=已复职 / null=无记录
export const resignStateOf = (records: ResignationRecord[], username: string): ResignationRecord | null => {
  const recs = records.filter(r => r.username === username);
  if (!recs.length) return null;
  return recs[recs.length - 1];
};

export const RESIGN_REASONS = ['个人原因', '家庭原因', '身体健康原因', '合同到期不续签', '协商解除', '辞退', '其他'];
