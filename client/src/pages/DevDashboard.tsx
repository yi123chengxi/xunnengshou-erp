import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Typography, Table, Tag, Button, Space, message, Popconfirm, Descriptions, Modal, Input, Select, DatePicker, Alert, Progress, InputNumber, Slider, Checkbox, Tooltip, Dropdown, Form, List, Row, Col } from 'antd';
import { DeleteOutlined, UserOutlined, BankOutlined, PhoneOutlined, MailOutlined, SearchOutlined, ReloadOutlined, ExportOutlined, ClockCircleOutlined, CheckCircleOutlined, LockOutlined, CloudOutlined, SettingOutlined, PlusOutlined, EditOutlined, KeyOutlined, UserAddOutlined, RollbackOutlined, TeamOutlined, DownOutlined, FormOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate, useLocation } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import Logo from '../components/Logo';
import { getUserQuota, setUserQuota, formatStorageSize, getUsagePercent, getTotalStorageUsage, getAllQuotas, kbToGb, gbToKb, fetchAllServerUsage, getLocalUsageKB, sessionDataOwner } from '../utils/storageQuota';
import useStickTableHeight from '../hooks/useStickTableHeight';
import { getDevIdentity, loadGroups, saveGroups, loadGroupPerms, saveGroupPerms, applyGroupPermsToMembers, loadCustomerPerms, saveCustomerPerms, allPermKeys, buildPermTree, updateRegisteredUsers, getSubRole, loadDevSubAccounts, loadFollowups, addFollowup, loadCustomerLogs, addCustomerLog } from '../utils/devStore';
import { readDevPermSet, PERM_V2, PERM_V3, PERM_V3_DEFAULT_KEYS, PERM_V4, PERM_V4_DEFAULT_KEYS, PERM_V5, PERM_V5_DEFAULT_KEYS, PERM_V6, PERM_V6_DEFAULT_KEYS, PERM_V7, PERM_V7_DEFAULT_KEYS, PERM_V8, PERM_V8_DEFAULT_KEYS, PERM_V9, PERM_V9_DEFAULT_KEYS, PERM_V10, PERM_V10_DEFAULT_KEYS } from '../utils/devPerms';
import { loadDevDeny, saveDevDeny } from '../utils/perm';
import { CertBadge, fetchCertBatch } from '../components/EnterpriseCertModal';
import type { CertInfo } from '../components/EnterpriseCertModal';
import type { DevGroup, PermNode } from '../utils/devStore';

// 权限树叶子键提取
const leavesOf = (n: PermNode): string[] => (n.children && n.children.length) ? n.children.flatMap(c => leavesOf(c)) : [n.key];

const { Title, Text } = Typography;
const { Search } = Input;

const PRIMARY = '#1e4a7e';

// 注册用户接口
interface RegisteredUser {
  username: string;
  password: string;
  role: string;
  companyName: string;
  companyNo?: string;
  orderPrefix?: string;
  contactPerson: string;
  phone: string;
  email: string;
  registerDate: string;
  status: string;
  trialEndDate: string;
  authorizedUntil: string;
  isSubAccount?: boolean;
  parentAccount?: string;
  devOwner?: string;
  devOwnerName?: string;
  devClaimDate?: string;
  taxpayerCode?: string;
  legalPerson?: string;
  province?: string;
  city?: string;
  district?: string;
  addressDetail?: string;
  businessAddress?: string;
  wechatQr?: string;
}

const DevDashboard: React.FC = () => {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  // 各租户数据库用量（服务端增量计数器，字节）：列表/详情/配额弹窗共用
  const [serverUsageMap, setServerUsageMap] = useState<Record<string, number>>({});
  useEffect(() => { fetchAllServerUsage().then(m => setServerUsageMap(m)); }, []);
  // 租户总用量 KB = 本浏览器本地账本（仅当前会话租户） + 服务端数据库计数器
  const usedKBOf = (uname: string): number => {
    const local = uname && uname === sessionDataOwner() ? getLocalUsageKB(uname) : 0;
    return parseFloat((local + (serverUsageMap[uname] || 0) / 1024).toFixed(2));
  };
  const [filteredUsers, setFilteredUsers] = useState<RegisteredUser[]>([]);
  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<RegisteredUser | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  // 授权期限弹窗
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authTargetUser, setAuthTargetUser] = useState<RegisteredUser | null>(null);
  const [authorizedDate, setAuthorizedDate] = useState<Dayjs | null>(null);
  // 修改密码弹窗
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<RegisteredUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // 空间配额弹窗
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaTargetUser, setQuotaTargetUser] = useState<RegisteredUser | null>(null);
  const [quotaValue, setQuotaValue] = useState(1); // GB
  const navigate = useNavigate();

  // ===================== 开发者后台：身份 / 列表模式 / 客户分组 / 领取 / 软件权限 =====================
  const identity = getDevIdentity();
  const location = useLocation();
  const mode: 'all' | 'mine' | 'pool' = location.pathname.includes('/customers/mine') ? 'mine' : location.pathname.includes('/customers/pool') ? 'pool' : 'all';

  // 子账号角色：功能权限 gating + 数据范围（OWN/TEAM）
  const myRole = identity.isSub ? getSubRole(identity.user) : null;
  const permHas = (key: string) => !myRole || myRole.permissions.includes(key);

  // 客户分组（同一主开发者下共享）
  const [groups, setGroups] = useState<DevGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  // 当前页签模式下的客户集合（分组计数按当前页面口径显示）
  const modeUsers = useMemo(() => {
    if (mode === 'mine') return users.filter(u => u.devOwner === identity.user);
    if (mode === 'pool') return users.filter(u => !u.devOwner);
    return users;
  }, [users, mode, identity.user]);
  const reloadGroups = useCallback(() => { setGroups(loadGroups(identity.parent)); }, [identity.parent]);
  useEffect(() => { reloadGroups(); }, [reloadGroups]);

  // 分组新建/重命名弹窗
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<'create' | 'rename'>('create');
  const [groupModalTarget, setGroupModalTarget] = useState<DevGroup | null>(null);
  const [groupNameInput, setGroupNameInput] = useState('');

  const handleGroupModalOk = () => {
    const name = groupNameInput.trim();
    if (!name) { message.warning('请输入分组名称'); return; }
    if (groupModalMode === 'create') {
      if (groups.some(g => g.name === name)) { message.error('分组名称已存在'); return; }
      const next = [...groups, { id: `grp_${Date.now()}`, name, members: [] }];
      setGroups(next); saveGroups(identity.parent, next);
      message.success(`分组「${name}」已创建`);
    } else if (groupModalTarget) {
      const next = groups.map(g => g.id === groupModalTarget.id ? { ...g, name } : g);
      setGroups(next); saveGroups(identity.parent, next);
      message.success('分组已重命名');
    }
    setGroupModalVisible(false);
  };

  const handleDeleteGroup = (id: string) => {
    const target = groups.find(g => g.id === id);
    // 分组内包含客户时禁止删除
    if (target && target.members.length) {
      message.warning(`分组「${target.name}」内还有 ${target.members.length} 个客户，请先移出客户后再删除`);
      return;
    }
    const next = groups.filter(g => g.id !== id);
    setGroups(next); saveGroups(identity.parent, next);
    if (selectedGroup === id) setSelectedGroup('');
    message.success('分组已删除（客户与权限数据不受影响）');
  };

  // 客户分配分组：点击客户分组单元格下拉选择（替代原操作列分组按键/弹窗）
  const applyGroup = (rec: RegisteredUser, groupId: string) => {
    const next = groups.map(g => ({
      ...g,
      members: g.id === groupId
        ? Array.from(new Set([...g.members, rec.username]))
        : g.members.filter(m => m !== rec.username),
    }));
    setGroups(next); saveGroups(identity.parent, next);
    message.success(`已分配到分组「${next.find(g => g.id === groupId)?.name}」`);
  };
  const clearGroup = (rec: RegisteredUser) => {
    const next = groups.map(g => ({ ...g, members: g.members.filter(m => m !== rec.username) }));
    setGroups(next); saveGroups(identity.parent, next);
    message.success('已移出分组');
  };

  // 批量操作：复选框勾选 + 表格上方分配/领取按键
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchAssignVisible, setBatchAssignVisible] = useState(false);
  const [batchAssignOwner, setBatchAssignOwner] = useState<string>('');
  // 批量领取：勾选客户归属当前登录开发者
  const handleBatchClaim = () => {
    if (!selectedRowKeys.length) { message.warning('请先勾选要领取的客户'); return; }
    const selSet = new Set(selectedRowKeys);
    const ok = updateRegisteredUsers(list => list.map(u => selSet.has(u.username) ? { ...u, devOwner: identity.user, devOwnerName: identity.name, devClaimDate: dayjs().format('YYYY-MM-DD') } : u));
    if (!ok) { message.error('领取失败：本地存储写入未成功，请重试'); return; }
    selectedRowKeys.forEach(un => addCustomerLog(un, '领取客户', `负责人：${identity.name}`, identity.user, identity.name));
    refreshUsers();
    message.success(`已领取 ${selectedRowKeys.length} 个客户，负责人：${identity.name}`);
    setSelectedRowKeys([]);
  };
  // 批量分配候选人：主开发者 + 其下正常状态子账号
  const ownerOptions = useMemo(() => {
    const subs = loadDevSubAccounts().filter(s => s.status === 'normal' && s.parentDev === identity.parent);
    return [
      { value: identity.parent, name: identity.parent === 'dev' ? '主开发者' : identity.parent, label: `主开发者（${identity.parent}）` },
      ...subs.map(s => ({ value: s.username, name: s.displayName, label: `${s.displayName}（${s.username}）` })),
    ];
  }, [identity.parent]);
  const handleBatchAssignOk = () => {
    const target = ownerOptions.find(o => o.value === batchAssignOwner);
    if (!target) { message.warning('请选择要分配给的负责人'); return; }
    const selSet = new Set(selectedRowKeys);
    const ok = updateRegisteredUsers(list => list.map(u => selSet.has(u.username) ? { ...u, devOwner: target.value, devOwnerName: target.name, devClaimDate: dayjs().format('YYYY-MM-DD') } : u));
    if (!ok) { message.error('分配失败：本地存储写入未成功，请重试'); return; }
    selectedRowKeys.forEach(un => addCustomerLog(un, '分配负责人', `负责人：${target.name}`, identity.user, identity.name));
    refreshUsers();
    message.success(`已将 ${selectedRowKeys.length} 个客户分配给负责人「${target.name}」`);
    setBatchAssignVisible(false);
    setSelectedRowKeys([]);
  };
  // 批量退回公海：清空勾选客户的负责人归属（我的客户页）
  const handleBatchRelease = () => {
    if (!selectedRowKeys.length) { message.warning('请先勾选要退回公海的客户'); return; }
    const selSet = new Set(selectedRowKeys);
    const ok = updateRegisteredUsers(list => list.map(u => selSet.has(u.username) ? { ...u, devOwner: undefined, devOwnerName: undefined, devClaimDate: undefined } : u));
    if (!ok) { message.error('退回公海失败：本地存储写入未成功，请重试'); return; }
    selectedRowKeys.forEach(un => addCustomerLog(un, '退回公海', '负责人已清空', identity.user, identity.name));
    refreshUsers();
    message.success(`已将 ${selectedRowKeys.length} 个客户退回公海，负责人已清空`);
    setSelectedRowKeys([]);
  };

  // 写跟进弹窗
  const [followupVisible, setFollowupVisible] = useState(false);
  const [followupTarget, setFollowupTarget] = useState<RegisteredUser | null>(null);
  const [followupContent, setFollowupContent] = useState('');
  const openFollowup = (rec: RegisteredUser) => { setFollowupTarget(rec); setFollowupContent(''); setFollowupVisible(true); };
  const handleFollowupSave = () => {
    if (!followupTarget) return;
    if (!followupContent.trim()) { message.warning('请输入跟进内容'); return; }
    addFollowup(followupTarget.username, followupContent.trim(), identity.user, identity.name);
    message.success(`已保存客户「${followupTarget.companyName}」的跟进记录`);
    setFollowupVisible(false);
  };

  // 客户资料编辑弹窗（仅限基础联系方式/地址/公司名称等）
  const [editCustVisible, setEditCustVisible] = useState(false);
  const [editCustTarget, setEditCustTarget] = useState<RegisteredUser | null>(null);
  const [editCustForm] = Form.useForm();
  const EDIT_FIELDS: { key: string; label: string }[] = [
    { key: 'companyName', label: '公司名称' },
    { key: 'taxpayerCode', label: '纳税人识别号' },
    { key: 'legalPerson', label: '法人' },
    { key: 'contactPerson', label: '联系人' },
    { key: 'phone', label: '联系电话' },
    { key: 'email', label: '电子邮箱' },
    { key: 'province', label: '省份' },
    { key: 'city', label: '城市' },
    { key: 'district', label: '区县' },
    { key: 'addressDetail', label: '详细地址' },
  ];
  const openEditCustomer = (rec: RegisteredUser) => {
    setEditCustTarget(rec);
    editCustForm.setFieldsValue(Object.fromEntries(EDIT_FIELDS.map(f => [f.key, (rec as any)[f.key] || ''])));
    setEditCustVisible(true);
  };
  const handleEditCustSave = () => {
    if (!editCustTarget) return;
    editCustForm.validateFields().then(values => {
      const changes: string[] = [];
      EDIT_FIELDS.forEach(f => {
        const oldV = String((editCustTarget as any)[f.key] || '');
        const newV = String(values[f.key] ?? '').trim();
        if (oldV !== newV) changes.push(`${f.label}: ${oldV || '空'} → ${newV || '空'}`);
      });
      if (!changes.length) { message.info('未修改任何内容'); setEditCustVisible(false); return; }
      const ok = updateRegisteredUsers(list => list.map(u => u.username === editCustTarget.username ? { ...u, ...Object.fromEntries(EDIT_FIELDS.map(f => [f.key, String(values[f.key] ?? '').trim()])) } : u));
      if (!ok) { message.error('保存失败：本地存储写入未成功，请重试'); return; }
      addCustomerLog(editCustTarget.username, '编辑客户资料', changes.join('；'), identity.user, identity.name);
      refreshUsers();
      message.success('客户资料已保存');
      setEditCustVisible(false);
    }).catch(() => message.warning('请按表单提示完善后再保存'));
  };

  // 领取 / 释放客户（谁领取客户归属就归哪个子账号）
  const refreshUsers = () => {
    const data = JSON.parse(localStorage.getItem('registeredUsers') || '[]').filter((u: RegisteredUser) => !u.isSubAccount);
    setUsers(data);
  };
  // 跨标签页同步：其他页签改写 registeredUsers 时重载列表，避免负责人显示不一致
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'registeredUsers') refreshUsers();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // 租户企业认证状态（服务端权威）：列表加载后批量拉取徽章数据，供表格列与详情弹窗展示
  const [certMap, setCertMap] = useState<Record<string, CertInfo>>({});
  useEffect(() => {
    if (!users.length) { setCertMap({}); return; }
    let cancelled = false;
    fetchCertBatch(users.map(u => u.username)).then(m => { if (!cancelled) setCertMap(m || {}); });
    return () => { cancelled = true; };
  }, [users]);
  const handleClaim = (rec: RegisteredUser) => {
    const ok = updateRegisteredUsers(list => list.map(u => u.username === rec.username ? { ...u, devOwner: identity.user, devOwnerName: identity.name, devClaimDate: dayjs().format('YYYY-MM-DD') } : u));
    if (!ok) { message.error('领取失败：本地存储写入未成功（可能存储空间不足），请清理后重试'); return; }
    // 回读校验：确认负责人已落库，防止静默丢写导致列表不变更
    const verify = (JSON.parse(localStorage.getItem('registeredUsers') || '[]') as any[]).find(u => u.username === rec.username);
    if (!verify || !verify.devOwner) { message.error('领取失败：写入未生效，请重试'); refreshUsers(); return; }
    addCustomerLog(rec.username, '领取客户', `负责人：${identity.name}`, identity.user, identity.name);
    refreshUsers();
    message.success(`已领取客户「${rec.companyName}」，负责人：${identity.name}`);
  };
  const handleRelease = (rec: RegisteredUser) => {
    const ok = updateRegisteredUsers(list => list.map(u => u.username === rec.username ? { ...u, devOwner: undefined, devOwnerName: undefined, devClaimDate: undefined } : u));
    if (!ok) { message.error('释放失败：本地存储写入未成功，请重试'); return; }
    addCustomerLog(rec.username, '释放回公海', '负责人已清空', identity.user, identity.name);
    refreshUsers();
    message.success('已释放，客户回到公海');
  };

  // 软件菜单权限设置弹窗（客户单独 / 分组同步）
  const permTree = useMemo(() => buildPermTree(), []);
  const [permVisible, setPermVisible] = useState(false);
  const [permMode, setPermMode] = useState<'customer' | 'group'>('customer');
  const [permTargetUser, setPermTargetUser] = useState<RegisteredUser | null>(null);
  const [permTargetGroup, setPermTargetGroup] = useState<DevGroup | null>(null);
  const [permChecked, setPermChecked] = useState<string[]>([]);
  const [permNote, setPermNote] = useState<string>('');
  // PERM_V2：显式禁止页（优先于白名单，勾选也隐藏）
  const [permDenied, setPermDenied] = useState<string[]>([]);

  const openCustomerPerm = (rec: RegisteredUser) => {
    setPermMode('customer'); setPermTargetUser(rec); setPermTargetGroup(null);
    setPermDenied(loadDevDeny(rec.username));
    const saved = loadCustomerPerms(rec.username);
    // 旧版权限数据（未含采购商/加工厂控制）：两平台键默认补勾为全开放
    const rawSet = readDevPermSet(rec.username);
    const legacy = saved !== null && rawSet !== null && !rawSet.has(PERM_V2);
    const platformKeys = allPermKeys().filter(k => k.startsWith('purchaser/') || k.startsWith('factory/'));
    // 旧版数据（未含日常记账菜单控制）：日常记账键默认补勾
    const legacy3 = saved !== null && rawSet !== null && !rawSet.has(PERM_V3);
    const v3Keys = allPermKeys().filter(k => PERM_V3_DEFAULT_KEYS.includes(k));
    const checkedBase = saved ? (legacy ? Array.from(new Set([...saved, ...platformKeys])) : saved) : allPermKeys();
    const checked3 = legacy3 ? Array.from(new Set([...checkedBase, ...v3Keys])) : checkedBase;
    // 旧版数据（未含报销菜单控制）：报销键默认补勾
    const legacy4 = saved !== null && rawSet !== null && !rawSet.has(PERM_V4);
    const v4Keys = allPermKeys().filter(k => PERM_V4_DEFAULT_KEYS.includes(k));
    const checked4 = legacy4 ? Array.from(new Set([...checked3, ...v4Keys])) : checked3;
    // 旧版数据（未含人事管理/付款申请菜单控制）：对应键默认补勾
    const legacy5 = saved !== null && rawSet !== null && !rawSet.has(PERM_V5);
    const v5Keys = allPermKeys().filter(k => PERM_V5_DEFAULT_KEYS.includes(k));
    const checked = legacy5 ? Array.from(new Set([...checked4, ...v5Keys])) : checked4;
    // 旧版数据（未含其他货币资金/总账薄菜单控制）：对应键默认补勾
    const legacy6 = saved !== null && rawSet !== null && !rawSet.has(PERM_V6);
    const v6Keys = allPermKeys().filter(k => PERM_V6_DEFAULT_KEYS.includes(k));
    const checkedFinal = legacy6 ? Array.from(new Set([...checked, ...v6Keys])) : checked;
    // 旧版数据（未含简易账薄菜单控制）：对应键默认补勾
    const legacy7 = saved !== null && rawSet !== null && !rawSet.has(PERM_V7);
    const v7Keys = allPermKeys().filter(k => PERM_V7_DEFAULT_KEYS.includes(k));
    const checkedFinal7 = legacy7 ? Array.from(new Set([...checkedFinal, ...v7Keys])) : checkedFinal;
    // 旧版数据（未含财务管理全量菜单控制）：对应键默认补勾
    const legacy8 = saved !== null && rawSet !== null && !rawSet.has(PERM_V8);
    const v8Keys = allPermKeys().filter(k => PERM_V8_DEFAULT_KEYS.includes(k));
    const checkedFinal8 = legacy8 ? Array.from(new Set([...checkedFinal7, ...v8Keys])) : checkedFinal7;
    // 旧版数据（未含新款进度菜单控制）：对应键默认补勾
    const legacy9 = saved !== null && rawSet !== null && !rawSet.has(PERM_V9);
    const v9Keys = allPermKeys().filter(k => PERM_V9_DEFAULT_KEYS.includes(k));
    const checkedFinal9 = legacy9 ? Array.from(new Set([...checkedFinal8, ...v9Keys])) : checkedFinal8;
    // 旧版数据（未含品牌授权菜单控制）：对应键默认补勾
    const legacy10 = saved !== null && rawSet !== null && !rawSet.has(PERM_V10);
    const v10Keys = allPermKeys().filter(k => PERM_V10_DEFAULT_KEYS.includes(k));
    const checkedFinal10 = legacy10 ? Array.from(new Set([...checkedFinal9, ...v10Keys])) : checkedFinal9;
    setPermChecked(checkedFinal10);
    setPermNote(saved
      ? (legacy
        ? `当前已保存自定义权限（旧版数据）：勾选 ${saved.length} 个菜单；采购商/加工厂平台为新增控制项，已默认全勾选，保存后按新勾选生效`
        : `当前已保存自定义权限：勾选 ${saved.length} 个菜单（全部菜单共 ${allPermKeys().length} 个），以下为已保存的勾选状态`)
      : '当前客户未单独保存过权限，默认开放全部菜单；修改并保存后按保存的勾选生效');
    setPermVisible(true);
  };
  const openGroupPerm = (g: DevGroup) => {
    setPermMode('group'); setPermTargetGroup(g); setPermTargetUser(null);
    setPermDenied([]);
    setPermChecked(loadGroupPerms(g.id) ?? allPermKeys());
    setPermVisible(true);
  };
  const togglePerm = (key: string, on: boolean) => {
    setPermChecked(prev => on ? Array.from(new Set([...prev, key])) : prev.filter(k => k !== key));
  };
  const togglePermGroup = (keys: string[], on: boolean) => {
    setPermChecked(prev => on ? Array.from(new Set([...prev, ...keys])) : prev.filter(k => !keys.includes(k)));
  };
  const handlePermSave = () => {
    if (permMode === 'customer' && permTargetUser) {
      saveCustomerPerms(permTargetUser.username, permChecked);
      saveDevDeny(permTargetUser.username, permDenied);
      message.success(`已保存客户「${permTargetUser.companyName}」的软件权限（${permChecked.length} 个菜单，显式禁止 ${permDenied.length} 个）`);
    } else if (permMode === 'group' && permTargetGroup) {
      saveGroupPerms(permTargetGroup.id, permChecked);
      applyGroupPermsToMembers(permTargetGroup, permChecked);
      message.success(`分组权限已保存，并同步至组内 ${permTargetGroup.members.length} 个客户`);
    }
    setPermVisible(false);
  };

  // 检查开发者登录状态
  useEffect(() => {
    const devLoggedIn = localStorage.getItem('devLoggedIn');
    if (!devLoggedIn) {
      navigate('/xunnengs/entry-7x2qf9');
    }
  }, [navigate]);

  // 加载注册用户数据（仅主账号，不显示租户创建的子账号）
  useEffect(() => {
    const data = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const mainAccounts = data.filter((u: RegisteredUser) => !u.isSubAccount);
    setUsers(mainAccounts);
    setFilteredUsers(mainAccounts);
  }, []);

  // 筛选数据
  useEffect(() => {
    let filtered = users;
    // 列表模式：我的客户（我领取）/ 客户公海（未领取）/ 全部
    if (mode === 'mine') filtered = filtered.filter(u => u.devOwner === identity.user);
    if (mode === 'pool') filtered = filtered.filter(u => !u.devOwner);
    // 角色数据范围：OWN=仅本人+公海；TEAM=本人+绑定组员+公海
    if (myRole && myRole.dataScope === 'OWN') {
      filtered = filtered.filter(u => !u.devOwner || u.devOwner === identity.user);
    } else if (myRole && myRole.dataScope === 'TEAM') {
      const members = new Set((myRole.teamRels || []).find(t => t.leader === identity.user)?.members || []);
      filtered = filtered.filter(u => !u.devOwner || u.devOwner === identity.user || members.has(u.devOwner as string));
    }
    // 客户分组过滤
    if (selectedGroup) {
      const members = groups.find(g => g.id === selectedGroup)?.members || [];
      filtered = filtered.filter(u => members.includes(u.username));
    }

    if (searchText) {
      filtered = filtered.filter(u =>
        u.username.includes(searchText) ||
        u.companyName.includes(searchText) ||
        u.contactPerson.includes(searchText) ||
        u.phone.includes(searchText)
      );
    }

    if (roleFilter) {
      filtered = filtered.filter(u => u.role.includes(roleFilter));
    }

    if (statusFilter) {
      filtered = filtered.filter(u => u.status === statusFilter);
    }

    setFilteredUsers(filtered);
  }, [users, searchText, roleFilter, statusFilter, mode, selectedGroup, groups, identity.user, myRole]);

  // 查看用户详情（含跟进记录与客户日志）
  const [detailFollowups, setDetailFollowups] = useState<any[]>([]);
  const [detailLogs, setDetailLogs] = useState<any[]>([]);
  const handleViewDetail = (user: RegisteredUser) => {
    setSelectedUser(user);
    setDetailFollowups(loadFollowups(user.username).slice().reverse());
    setDetailLogs(loadCustomerLogs(user.username).slice().reverse());
    setDetailVisible(true);
  };

  // 审核用户
  const handleApprove = (username: string, status: string) => {
    if (status === '已审核') {
      // 审核通过时，打开授权期限设置弹窗
      const targetUser = users.find(u => u.username === username);
      if (targetUser) {
        setAuthTargetUser(targetUser);
        // 默认授权期限为当前试用期截止日期
        setAuthorizedDate(targetUser.trialEndDate ? dayjs(targetUser.trialEndDate) : dayjs().add(365, 'day'));
        setAuthModalVisible(true);
      }
      return;
    }
    // 拒绝等直接处理
    const newUsers = users.map(u => {
      if (u.username === username) {
        return { ...u, status };
      }
      return u;
    });
    localStorage.setItem('registeredUsers', JSON.stringify(newUsers));
    setUsers(newUsers);
    message.success(`已${status === '已拒绝' ? '拒绝' : ''}审核`);
  };

  // 打开修改密码弹窗
  const handleOpenPasswordModal = (user: RegisteredUser) => {
    setPasswordTargetUser(user);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordModalVisible(true);
  };

  // 确认修改密码
  const handleConfirmPassword = () => {
    if (!passwordTargetUser) return;
    if (!newPassword.trim()) {
      message.warning('请输入新密码');
      return;
    }
    if (newPassword.length < 6) {
      message.warning('密码长度不能少于6位');
      return;
    }
    if (!/^(?=.*[a-zA-Z])(?=.*\d)/.test(newPassword)) {
      message.warning('密码必须包含字母和数字');
      return;
    }
    if (newPassword !== confirmPassword) {
      message.warning('两次输入的密码不一致');
      return;
    }
    const newUsers = users.map(u => {
      if (u.username === passwordTargetUser.username) {
        return { ...u, password: newPassword };
      }
      return u;
    });
    localStorage.setItem('registeredUsers', JSON.stringify(newUsers));
    setUsers(newUsers);
    setPasswordModalVisible(false);
    setPasswordTargetUser(null);
    setNewPassword('');
    setConfirmPassword('');
    message.success(`已成功修改「${passwordTargetUser.username}」的登录密码`);
  };

  // 确认授权
  const handleConfirmAuth = () => {
    if (!authTargetUser || !authorizedDate) {
      message.warning('请选择授权截止日期');
      return;
    }
    const newUsers = users.map(u => {
      if (u.username === authTargetUser.username) {
        return { ...u, status: '已审核', authorizedUntil: authorizedDate.format('YYYY-MM-DD') };
      }
      return u;
    });
    localStorage.setItem('registeredUsers', JSON.stringify(newUsers));
    setUsers(newUsers);
    setAuthModalVisible(false);
    setAuthTargetUser(null);
    message.success(`已通过审核，授权至 ${authorizedDate.format('YYYY-MM-DD')}`);
  };

  // 导出数据
  const handleExport = () => {
    const dataStr = JSON.stringify(filteredUsers, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `注册用户_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    message.success('导出成功');
  };

  // 打开空间配额设置弹窗
  const handleOpenQuotaModal = (user: RegisteredUser) => {
    setQuotaTargetUser(user);
    setQuotaValue(kbToGb(getUserQuota(user.username)));
    setQuotaModalVisible(true);
  };

  // 确认空间配额调整
  const handleConfirmQuota = () => {
    if (!quotaTargetUser) return;
    if (quotaValue < 0.5) {
      message.warning('空间配额不能小于 0.5GB（512MB）');
      return;
    }
    const quotaKB = gbToKb(quotaValue);
    setUserQuota(quotaTargetUser.username, quotaKB);
    setQuotaModalVisible(false);
    setQuotaTargetUser(null);
    message.success(`已将「${quotaTargetUser.username}」的空间配额调整为 ${quotaValue} GB`);
    // 刷新数据以更新显示
    const data = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    setUsers(data);
    setFilteredUsers(data);
  };

  // 退出登录
  const handleLogout = () => {
    localStorage.removeItem('devLoggedIn');
    navigate('/xunnengs/entry-7x2qf9');
  };

  // 角色标签颜色
  const getRoleColor = (role: string) => {
    if (role.includes('supplier') && role.includes('purchaser')) return 'purple';
    if (role.includes('supplier')) return 'blue';
    if (role.includes('purchaser')) return 'green';
    return 'default';
  };

  const getRoleText = (role: string) => {
    if (role.includes('supplier') && role.includes('purchaser')) return '供应商+采购商';
    if (role.includes('supplier')) return '供应商';
    if (role.includes('purchaser')) return '采购商';
    return role;
  };

  // 表格列定义
  const columns: ColumnsType<RegisteredUser> = [
    { title: '登录账号', dataIndex: 'username', key: 'username', width: 120, render: (v: string, record: RegisteredUser) => <a onClick={() => handleViewDetail(record)} style={{ color: PRIMARY, fontWeight: 500 }}>{v}</a> },
    { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 200, render: (v: string, record: RegisteredUser) => <a onClick={() => handleViewDetail(record)} style={{ color: PRIMARY, fontWeight: 500 }}>{v}</a> },
    {
      title: '客户分组', key: 'groupName', width: 110,
      render: (_: any, record: RegisteredUser) => {
        const cur = groups.find(x => x.members.includes(record.username));
        // 无分组权限时仅展示
        if (!permHas('customers.group')) return cur ? <Tag color="cyan">{cur.name}</Tag> : '-';
        const items: any[] = [
          ...groups.map(g => ({ key: g.id, label: `${g.name}（${g.members.length}）` })),
          ...(cur ? [{ type: 'divider' as const, key: '__div' }, { key: '__clear', label: '移出分组' }] : []),
        ];
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items,
              selectedKeys: cur ? [cur.id] : [],
              onClick: ({ key }) => {
                if (key === '__clear') clearGroup(record);
                else if (key !== '__div') applyGroup(record, key);
              },
            }}
          >
            <a onClick={(e) => e.preventDefault()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              {cur ? <Tag color="cyan" style={{ marginRight: 0 }}>{cur.name}</Tag> : <Text type="secondary">-</Text>}
              <DownOutlined style={{ fontSize: 10, color: '#8c8c8c' }} />
            </a>
          </Dropdown>
        );
      },
    },
    {
      title: '负责人', key: 'devOwner', width: 130,
      render: (_: any, record: RegisteredUser) => record.devOwnerName ? (
        <span>
          <Tag color="purple">{record.devOwnerName}</Tag>
          <div style={{ fontSize: 11, color: '#999' }}>{record.devClaimDate}</div>
        </span>
      ) : <Text type="secondary">未领取</Text>,
    },
    { title: '公司编号', dataIndex: 'companyNo', key: 'companyNo', width: 100, render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '订单号前缀', dataIndex: 'orderPrefix', key: 'orderPrefix', width: 100, render: (v: string) => v ? <Tag color="green">{v}</Tag> : '-' },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 130,
      render: (role: string) => (
        <Tag color={getRoleColor(role)}>{getRoleText(role)}</Tag>
      ),
    },
    { title: '联系人', dataIndex: 'contactPerson', key: 'contactPerson', width: 100 },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: '电子邮箱', dataIndex: 'email', key: 'email', width: 180 },
    { title: '注册日期', dataIndex: 'registerDate', key: 'registerDate', width: 110 },
    {
      title: '试用截止',
      dataIndex: 'trialEndDate',
      key: 'trialEndDate',
      width: 110,
      render: (date: string) => date ? (
        <span style={{ color: dayjs(date).isBefore(dayjs()) ? '#ff4d4f' : '#faad14' }}>
          <ClockCircleOutlined style={{ marginRight: 4 }} />{date}
        </span>
      ) : '-',
    },
    {
      title: '授权至',
      dataIndex: 'authorizedUntil',
      key: 'authorizedUntil',
      width: 110,
      render: (date: string) => date ? (
        <Tag color={dayjs(date).isBefore(dayjs()) ? 'red' : 'green'}>
          <CheckCircleOutlined style={{ marginRight: 4 }} />{date}
        </Tag>
      ) : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => (
        <Tag color={status === '已审核' ? 'green' : status === '已拒绝' ? 'red' : 'orange'}>
          {status}
        </Tag>
      ),
    },
    {
      title: '认证状态',
      key: 'certStatus',
      width: 100,
      render: (_: any, record: RegisteredUser) => <CertBadge info={certMap[record.username] || null} showUncertified />,
    },
    {
      title: '空间使用',
      key: 'storageUsage',
      width: 160,
      render: (_, record) => {
        const used = usedKBOf(record.username);
        const quota = getUserQuota(record.username);
        const percent = getUsagePercent(used, quota);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={{ fontSize: 11, color: '#8b9db5' }}>{formatStorageSize(used)} / {formatStorageSize(quota)}</Text>
              <Text style={{ fontSize: 11, color: percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : '#52c41a' }}>
                {percent.toFixed(0)}%
              </Text>
            </div>
            <Progress
              percent={percent}
              size="small"
              showInfo={false}
              strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : PRIMARY}
              trailColor="#e8ecf1"
            />
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
          <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
            查看
          </Button>
          {!record.devOwner && permHas('customers.claim') && mode === 'pool' ? (
            <Button type="link" size="small" style={{ color: '#52c41a' }} icon={<UserAddOutlined />} onClick={() => handleClaim(record)}>
              领取
            </Button>
          ) : (record.devOwner && (record.devOwner === identity.user || identity.user === 'dev')) ? (
            <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => handleRelease(record)}>
              释放
            </Button>
          ) : null}
          {permHas('customers.perm') && (
            <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => openCustomerPerm(record)}>
              权限
            </Button>
          )}
          <Button type="link" size="small" icon={<CloudOutlined />} onClick={() => handleOpenQuotaModal(record)}>
            空间
          </Button>
          <Button type="link" size="small" icon={<LockOutlined />} onClick={() => handleOpenPasswordModal(record)}>
            改密
          </Button>
          {record.status === '待审核' && (
            <>
              <Button type="link" size="small" style={{ color: '#52c41a' }} onClick={() => handleApprove(record.username, '已审核')}>
                通过
              </Button>
              <Button type="link" size="small" danger onClick={() => handleApprove(record.username, '已拒绝')}>
                拒绝
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  // 我的客户页操作列：写跟进 / 编辑（编辑仅限基础联系方式与地址信息等）
  const mineActionColumn: ColumnsType<RegisteredUser>[number] = {
    title: '操作',
    key: 'mineAction',
    width: 160,
    fixed: 'right',
    render: (_: any, record: RegisteredUser) => (
      <Space size="small">
        <Button type="link" size="small" icon={<FormOutlined />} onClick={() => openFollowup(record)}>
          写跟进
        </Button>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditCustomer(record)}>
          编辑
        </Button>
      </Space>
    ),
  };

  const modeTitle = mode === 'mine' ? '我的客户' : mode === 'pool' ? '客户公海' : '全部客户';

  // 客户总订购空间：全部客户空间配额之和（含免费期默认赠送 10G 与已购加购）
  const totalQuotaKB = useMemo(() => users.reduce((s: number, u: any) => s + (getUserQuota(u.username) || 0), 0), [users]);
  // 表格贴窗底：动态测高 + body minHeight 锁死留白
  const stick = useStickTableHeight();

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左侧客户分组面板（角色无客户分组权限时隐藏） */}
        {permHas('customers.group') && (
        <Card
          size="small"
          title={<span><TeamOutlined style={{ marginRight: 6, color: PRIMARY }} />客户分组</span>}
          style={{ width: 'fit-content', minWidth: 170, flexShrink: 0 }}
          extra={<Button type="link" size="small" icon={<PlusOutlined />} onClick={() => { setGroupModalMode('create'); setGroupNameInput(''); setGroupModalVisible(true); }}>新建</Button>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              onClick={() => setSelectedGroup('')}
              style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', background: selectedGroup === '' ? '#e6f4ff' : 'transparent', border: `1px solid ${selectedGroup === '' ? '#91caff' : 'transparent'}`, borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ fontWeight: 600 }}>全部客户</span><Tag>{modeUsers.length}</Tag>
            </div>
            {groups.map((g, gi) => (
              <div
                key={g.id}
                onClick={() => setSelectedGroup(g.id)}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', background: selectedGroup === g.id ? '#e6f4ff' : 'transparent', border: `1px solid ${selectedGroup === g.id ? '#91caff' : 'transparent'}`, borderBottom: gi < groups.length - 1 ? '1px solid #f0f0f0' : 'none' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{g.name}</span><Tag color="cyan">{modeUsers.filter(u => g.members.includes(u.username)).length}</Tag>
                </div>
                <Space size={0} style={{ marginTop: 2 }}>
                  <Tooltip title="分组权限设置（保存后组内所有客户默认同步）">
                    <Button size="small" type="text" icon={<KeyOutlined />} onClick={e => { e.stopPropagation(); openGroupPerm(g); }} />
                  </Tooltip>
                  <Tooltip title="重命名">
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); setGroupModalMode('rename'); setGroupModalTarget(g); setGroupNameInput(g.name); setGroupModalVisible(true); }} />
                  </Tooltip>
                  {g.members.length ? (
                    <Tooltip title="分组内包含客户时不能删除">
                      <span><Button size="small" type="text" danger disabled icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} /></span>
                    </Tooltip>
                  ) : (
                    <Popconfirm title="删除该分组？" onConfirm={() => handleDeleteGroup(g.id)} okText="删除" cancelText="取消">
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                    </Popconfirm>
                  )}
                </Space>
              </div>
            ))}
            {!groups.length && <Text type="secondary" style={{ fontSize: 12 }}>暂无分组，点击右上角「新建」创建客户分组</Text>}
          </div>
        </Card>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '10px 24px' }}>
        <Title level={4} style={{ margin: 0 }}>{modeTitle}</Title>
      </Card>

      {/* 统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Card bodyStyle={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text type="secondary">总注册数</Text>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1a2b45' }}>{users.length}</div>
            </div>
            <UserOutlined style={{ fontSize: 32, color: PRIMARY, opacity: 0.3 }} />
          </div>
        </Card>
        <Card bodyStyle={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text type="secondary">待审核</Text>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#faad14' }}>
                {users.filter(u => u.status === '待审核').length}
              </div>
            </div>
            <UserOutlined style={{ fontSize: 32, color: '#faad14', opacity: 0.3 }} />
          </div>
        </Card>
        <Card bodyStyle={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text type="secondary">供应商</Text>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1890ff' }}>
                {users.filter(u => u.role.includes('supplier')).length}
              </div>
            </div>
            <BankOutlined style={{ fontSize: 32, color: '#1890ff', opacity: 0.3 }} />
          </div>
        </Card>
        <Card bodyStyle={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text type="secondary">采购商</Text>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>
                {users.filter(u => u.role.includes('purchaser')).length}
              </div>
            </div>
            <PhoneOutlined style={{ fontSize: 32, color: '#52c41a', opacity: 0.3 }} />
          </div>
        </Card>
        <Card bodyStyle={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text type="secondary">总存储用量</Text>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: PRIMARY }}>
                {formatStorageSize(getTotalStorageUsage())}
              </div>
            </div>
            <CloudOutlined style={{ fontSize: 32, color: PRIMARY, opacity: 0.3 }} />
          </div>
        </Card>
        <Card bodyStyle={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text type="secondary">总订购空间</Text>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#722ed1' }}>
                {formatStorageSize(totalQuotaKB)}
              </div>
            </div>
            <CloudOutlined style={{ fontSize: 32, color: '#722ed1', opacity: 0.3 }} />
          </div>
        </Card>
      </div>

      {/* 搜索筛选 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Search
            placeholder="搜索账号/公司/联系人/电话"
            allowClear
            style={{ width: 300 }}
            onSearch={setSearchText}
            onChange={e => setSearchText(e.target.value)}
          />
          <Select
            placeholder="角色筛选"
            allowClear
            style={{ width: 150 }}
            onChange={setRoleFilter}
          >
            <Select.Option value="supplier">供应商</Select.Option>
            <Select.Option value="purchaser">采购商</Select.Option>
          </Select>
          <Select
            placeholder="状态筛选"
            allowClear
            style={{ width: 150 }}
            onChange={setStatusFilter}
          >
            <Select.Option value="待审核">待审核</Select.Option>
            <Select.Option value="已审核">已审核</Select.Option>
            <Select.Option value="已拒绝">已拒绝</Select.Option>
          </Select>
          <Button icon={<ReloadOutlined />} onClick={() => { setSearchText(''); setRoleFilter(''); setStatusFilter(''); }}>
            重置
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出数据
          </Button>
          {permHas('customers.claim') && (
            <>
              <Button icon={<TeamOutlined />} disabled={!selectedRowKeys.length} onClick={() => { setBatchAssignOwner(''); setBatchAssignVisible(true); }}>
                分配{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
              </Button>
              {mode === 'pool' && (
                <Button type="primary" style={{ color: '#fff' }} icon={<UserAddOutlined />} disabled={!selectedRowKeys.length} onClick={handleBatchClaim}>
                  领取{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
                </Button>
              )}
              {mode === 'mine' && (
                <Button danger icon={<RollbackOutlined />} disabled={!selectedRowKeys.length} onClick={handleBatchRelease}>
                  退回公海{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>

      {/* 数据表格 */}
      <Card bodyStyle={{ padding: '0 24px' }}>
        <div ref={stick.ref}>
        <Table
          columns={mode === 'all' ? columns : mode === 'mine' ? [...columns.filter(c => c.key !== 'action'), mineActionColumn] : columns.filter(c => c.key !== 'action')}
          dataSource={filteredUsers}
          rowKey="username"
          bordered
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys as string[]),
          }}
          scroll={{ x: 1500, y: stick.scrollY }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
            style: { marginBottom: 0 },
          }}
          locale={{ emptyText: '暂无注册用户数据' }}
        />
        </div>
      </Card>

        </div>
      </div>

      {/* 用户详情弹窗 */}
      <Modal
        title="客户详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>关闭</Button>,
        ]}
        width={720}
      >
        {selectedUser && (() => {
          const used = usedKBOf(selectedUser.username);
          const quota = getUserQuota(selectedUser.username);
          const percent = getUsagePercent(used, quota);
          return (
            <>
            <Descriptions column={2} bordered size="small" style={{ marginTop: 16 }}>
              <Descriptions.Item label="登录账号">{selectedUser.username}</Descriptions.Item>
              <Descriptions.Item label="注册角色">
                <Tag color={getRoleColor(selectedUser.role)}>{getRoleText(selectedUser.role)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="公司名称" span={2}>{selectedUser.companyName}</Descriptions.Item>
              <Descriptions.Item label="公司编号">{selectedUser.companyNo || '-'}</Descriptions.Item>
              <Descriptions.Item label="订单号前缀">{selectedUser.orderPrefix || '-'}</Descriptions.Item>
              <Descriptions.Item label="联系人">{selectedUser.contactPerson}</Descriptions.Item>
              <Descriptions.Item label="联系电话">{selectedUser.phone}</Descriptions.Item>
              <Descriptions.Item label="电子邮箱" span={2}>{selectedUser.email}</Descriptions.Item>
              <Descriptions.Item label="纳税人识别号">{selectedUser.taxpayerCode || '-'}</Descriptions.Item>
              <Descriptions.Item label="法人">{selectedUser.legalPerson || '-'}</Descriptions.Item>
              <Descriptions.Item label="认证状态" span={2}>
                <CertBadge info={certMap[selectedUser.username] || null} showUncertified />
              </Descriptions.Item>
              <Descriptions.Item label="负责人">
                {selectedUser.devOwnerName ? (
                  <span>
                    <Tag color="purple">{selectedUser.devOwnerName}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}> 领取于 {selectedUser.devClaimDate || '-'}</Text>
                  </span>
                ) : <Text type="secondary">未领取</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="客户分组">
                {(() => { const g = groups.find(x => x.members.includes(selectedUser.username)); return g ? <Tag color="cyan">{g.name}</Tag> : '-'; })()}
              </Descriptions.Item>
              <Descriptions.Item label="所在地区" span={2}>
                {[selectedUser.province, selectedUser.city, selectedUser.district].filter(Boolean).join(' / ') || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="详细地址" span={2}>{selectedUser.addressDetail || '-'}</Descriptions.Item>
              <Descriptions.Item label="经营地址" span={2}>{selectedUser.businessAddress || '-'}</Descriptions.Item>
              {selectedUser.wechatQr && (
                <Descriptions.Item label="微信二维码" span={2}>
                  <img src={selectedUser.wechatQr} alt="微信二维码" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 4 }} />
                </Descriptions.Item>
              )}
              <Descriptions.Item label="注册日期">{selectedUser.registerDate}</Descriptions.Item>
              <Descriptions.Item label="试用截止">
                <span style={{ color: selectedUser.trialEndDate && dayjs(selectedUser.trialEndDate).isBefore(dayjs()) ? '#ff4d4f' : '#faad14' }}>
                  {selectedUser.trialEndDate || '-'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="授权至">
                {selectedUser.authorizedUntil ? (
                  <Tag color={dayjs(selectedUser.authorizedUntil).isBefore(dayjs()) ? 'red' : 'green'}>
                    {selectedUser.authorizedUntil}
                  </Tag>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={selectedUser.status === '已审核' ? 'green' : selectedUser.status === '已拒绝' ? 'red' : 'orange'}>
                  {selectedUser.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="空间配额" span={2}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CloudOutlined />
                  <span>{formatStorageSize(quota)}</span>
                  {mode !== 'mine' && (
                    <Button type="link" size="small" icon={<SettingOutlined />} onClick={() => { setDetailVisible(false); handleOpenQuotaModal(selectedUser); }}>
                      调整
                    </Button>
                  )}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="已使用" span={2}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text>{formatStorageSize(used)} / {formatStorageSize(quota)}</Text>
                    <Text style={{ color: percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : '#52c41a' }}>
                      {percent.toFixed(0)}%
                    </Text>
                  </div>
                  <Progress
                    percent={percent}
                    size="small"
                    showInfo={false}
                    strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : PRIMARY}
                  />
                </div>
              </Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 20 }}>
              <Text strong style={{ fontSize: 14 }}>跟进记录（{detailFollowups.length}）</Text>
              {detailFollowups.length ? (
                <List
                  size="small"
                  dataSource={detailFollowups}
                  renderItem={(it: any) => (
                    <List.Item style={{ display: 'block', padding: '8px 0' }}>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{it.content}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>{it.authorName} · {dayjs(it.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                    </List.Item>
                  )}
                />
              ) : <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无跟进记录</Text></div>}
            </div>
            <div style={{ marginTop: 16 }}>
              <Text strong style={{ fontSize: 14 }}>客户日志（{detailLogs.length}）</Text>
              {detailLogs.length ? (
                <List
                  size="small"
                  dataSource={detailLogs}
                  renderItem={(it: any) => (
                    <List.Item style={{ display: 'block', padding: '8px 0' }}>
                      <Tag color="blue" style={{ marginRight: 6 }}>{it.action}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>{it.operatorName} · {dayjs(it.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                      <div style={{ fontSize: 12, color: '#595959', whiteSpace: 'pre-wrap', marginTop: 2 }}>{it.detail}</div>
                    </List.Item>
                  )}
                />
              ) : <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无日志</Text></div>}
            </div>
            </>
          );
        })()}
      </Modal>

      {/* 授权期限设置弹窗 */}
      <Modal
        title="设置账号授权期限"
        open={authModalVisible}
        onCancel={() => {
          setAuthModalVisible(false);
          setAuthTargetUser(null);
        }}
        onOk={handleConfirmAuth}
        okText="确认授权"
        cancelText="取消"
        width={480}
      >
        {authTargetUser && (
          <div style={{ padding: '8px 0' }}>
            <Alert
              message={`正在为「${authTargetUser.companyName}」审核通过`}
              description="请设置该账号的授权使用期限，到期后账号将无法登录系统。"
              type="info"
              showIcon
              style={{ marginBottom: 20 }}
            />
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 20 }}>
              <Descriptions.Item label="登录账号">{authTargetUser.username}</Descriptions.Item>
              <Descriptions.Item label="公司名称">{authTargetUser.companyName}</Descriptions.Item>
              <Descriptions.Item label="注册日期">{authTargetUser.registerDate}</Descriptions.Item>
              <Descriptions.Item label="默认试用截止">
                <Tag color="orange">{authTargetUser.trialEndDate || '-'}</Tag>
              </Descriptions.Item>
            </Descriptions>
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>授权截止日期：</Text>
              <DatePicker
                style={{ width: '100%' }}
                value={authorizedDate}
                onChange={setAuthorizedDate}
                disabledDate={(current) => current && current.isBefore(dayjs(), 'day')}
                placeholder="请选择授权截止日期"
              />
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                授权日期不得早于今天，建议根据合同约定设置合理的授权期限。
              </Text>
            </div>
          </div>
        )}
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal
        title="修改登录密码"
        open={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false);
          setPasswordTargetUser(null);
          setNewPassword('');
          setConfirmPassword('');
        }}
        onOk={handleConfirmPassword}
        okText="确认修改"
        cancelText="取消"
        width={480}
      >
        {passwordTargetUser && (
          <div style={{ padding: '8px 0' }}>
            <Alert
              message={`正在为账号「${passwordTargetUser.username}」修改密码`}
              description="请设置新的登录密码，修改后用户需使用新密码登录系统。"
              type="info"
              showIcon
              style={{ marginBottom: 20 }}
            />
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 20 }}>
              <Descriptions.Item label="登录账号">{passwordTargetUser.username}</Descriptions.Item>
              <Descriptions.Item label="公司名称">{passwordTargetUser.companyName}</Descriptions.Item>
              <Descriptions.Item label="当前角色">
                <Tag color={getRoleColor(passwordTargetUser.role)}>{getRoleText(passwordTargetUser.role)}</Tag>
              </Descriptions.Item>
            </Descriptions>
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>新密码：</Text>
              <Input.Password
                placeholder="请输入新密码（字母+数字）"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <Text strong style={{ display: 'block', marginBottom: 8 }}>确认密码：</Text>
              <Input.Password
                placeholder="请再次输入新密码"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 空间配额设置弹窗 */}
      <Modal
        title="调整客户空间配额"
        open={quotaModalVisible}
        onCancel={() => {
          setQuotaModalVisible(false);
          setQuotaTargetUser(null);
        }}
        onOk={handleConfirmQuota}
        okText="确认调整"
        cancelText="取消"
        width={520}
      >
        {quotaTargetUser && (() => {
          const used = usedKBOf(quotaTargetUser.username);
          const quotaKB = gbToKb(quotaValue);
          const percent = getUsagePercent(used, quotaKB);
          return (
            <div style={{ padding: '8px 0' }}>
              <Alert
                message={`正在为「${quotaTargetUser.companyName || quotaTargetUser.username}」调整空间配额`}
                description="调整后客户可使用的最大数据库存储空间。当前已使用空间不会被清理。"
                type="info"
                showIcon
                style={{ marginBottom: 20 }}
              />
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 20 }}>
                <Descriptions.Item label="登录账号">{quotaTargetUser.username}</Descriptions.Item>
                <Descriptions.Item label="公司名称">{quotaTargetUser.companyName}</Descriptions.Item>
                <Descriptions.Item label="当前已使用">
                  <Text style={{ color: percent > 90 ? '#ff4d4f' : '#1a2b45' }}>
                    {formatStorageSize(used)}
                  </Text>
                </Descriptions.Item>
                <Descriptions.Item label="当前配额">
                  <Tag color="blue">{formatStorageSize(getUserQuota(quotaTargetUser.username))}</Tag>
                </Descriptions.Item>
              </Descriptions>

              <div style={{ marginBottom: 24 }}>
                <Text strong style={{ display: 'block', marginBottom: 12 }}>
                  新配额：<Tag color="orange" style={{ marginLeft: 8 }}>{quotaValue >= 1024 ? `${(quotaValue / 1024).toFixed(1)} TB` : `${quotaValue} GB`}</Tag>
                </Text>
                <Slider
                  min={0.5}
                  max={16384}
                  step={1}
                  value={quotaValue}
                  onChange={(val) => setQuotaValue(val)}
                  marks={{
                    0.5: '0.5G',
                    1: '1G',
                    10: '10G',
                    100: '100G',
                    512: '512G',
                    1024: '1T',
                    5120: '5T',
                    10240: '10T',
                    16384: '16T',
                  }}
                  tooltip={{ formatter: (val) => (val ?? 0) >= 1024 ? `${((val ?? 0) / 1024).toFixed(1)} TB` : `${val ?? 0} GB` }}
                />
                <div style={{ marginTop: 12 }}>
                  <InputNumber
                    min={0.5}
                    max={16384}
                    step={1}
                    value={quotaValue}
                    onChange={(val) => setQuotaValue(val || 0.5)}
                    addonAfter="GB"
                    style={{ width: '100%' }}
                    precision={1}
                  />
                </div>
              </div>

              <Card size="small" style={{ background: '#fafafa' }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>空间使用率</Text>
                    <Text style={{ fontSize: 12, color: percent > 90 ? '#ff4d4f' : '#52c41a' }}>
                      {percent.toFixed(0)}%
                    </Text>
                  </div>
                  <Progress
                    percent={percent}
                    size="small"
                    showInfo={false}
                    strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : PRIMARY}
                  />
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  快捷设置：
                  <Space size={4} style={{ marginLeft: 8 }}>
                    {[1, 10, 100, 512, 1024, 5120, 10240, 16384].map(q => (
                      <Tag
                        key={q}
                        color={quotaValue === q ? 'blue' : 'default'}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setQuotaValue(q)}
                      >
                        {q >= 1024 ? `${q / 1024}T` : `${q}G`}
                      </Tag>
                    ))}
                  </Space>
                </Text>
              </Card>
            </div>
          );
        })()}
      </Modal>

      {/* 批量分配负责人弹窗 */}
      <Modal
        title={`批量分配负责人（已选 ${selectedRowKeys.length} 个客户）`}
        open={batchAssignVisible}
        onOk={handleBatchAssignOk}
        onCancel={() => setBatchAssignVisible(false)}
        okText="分配"
        cancelText="取消"
        width={420}
        destroyOnClose
      >
        <Select
          style={{ width: '100%', marginTop: 12 }}
          placeholder="选择负责人（主开发者或子账号业务员）"
          value={batchAssignOwner || undefined}
          onChange={v => setBatchAssignOwner(v)}
          options={ownerOptions.map(o => ({ value: o.value, label: o.label }))}
        />
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>分配后所选客户的负责人统一变更为所选人员，并记录领取日期</Text>
        </div>
      </Modal>

      {/* 写跟进弹窗 */}
      <Modal
        title={`写跟进 - ${followupTarget?.companyName || ''}`}
        open={followupVisible}
        onOk={handleFollowupSave}
        onCancel={() => setFollowupVisible(false)}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Input.TextArea rows={4} value={followupContent} onChange={e => setFollowupContent(e.target.value)} placeholder="请输入跟进内容（沟通情况、待办事项等）" style={{ marginTop: 12 }} />
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>跟进记录将展示在客户详情中，并保留写跟进人与时间</Text>
        </div>
      </Modal>

      {/* 客户资料编辑弹窗（仅基础联系方式/地址/公司名称等） */}
      <Modal
        title={`编辑客户资料 - ${editCustTarget?.companyName || ''}`}
        open={editCustVisible}
        onOk={handleEditCustSave}
        onCancel={() => setEditCustVisible(false)}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form autoComplete="off" form={editCustForm} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '公司名称不能为空' }]}><Input placeholder="公司名称" /></Form.Item></Col>
            <Col span={12}><Form.Item name="taxpayerCode" label="纳税人识别号"><Input placeholder="纳税人识别号" /></Form.Item></Col>
            <Col span={12}><Form.Item name="legalPerson" label="法人"><Input placeholder="法人" /></Form.Item></Col>
            <Col span={12}><Form.Item name="contactPerson" label="联系人"><Input placeholder="联系人" /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="联系电话"><Input placeholder="联系电话" /></Form.Item></Col>
            <Col span={12}><Form.Item name="email" label="电子邮箱"><Input placeholder="电子邮箱" /></Form.Item></Col>
            <Col span={8}><Form.Item name="province" label="省份"><Input placeholder="省份" /></Form.Item></Col>
            <Col span={8}><Form.Item name="city" label="城市"><Input placeholder="城市" /></Form.Item></Col>
            <Col span={8}><Form.Item name="district" label="区县"><Input placeholder="区县" /></Form.Item></Col>
            <Col span={24}><Form.Item name="addressDetail" label="详细地址"><Input placeholder="详细地址" /></Form.Item></Col>
          </Row>
        </Form>
        <Alert type="info" showIcon message="仅可编辑客户基础联系方式与地址信息；保存后变更将记录到客户日志" />
      </Modal>

      {/* 分组新建/重命名弹窗 */}
      <Modal
        title={groupModalMode === 'create' ? '新建客户分组' : '重命名分组'}
        open={groupModalVisible}
        onOk={handleGroupModalOk}
        onCancel={() => setGroupModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={400}
        destroyOnClose
      >
        <Input placeholder="请输入分组名称（可自定义）" value={groupNameInput} onChange={e => setGroupNameInput(e.target.value)} style={{ marginTop: 12 }} />
      </Modal>

      {/* 软件菜单权限设置弹窗（客户单独 / 分组同步） */}
      <Modal
        title={permMode === 'customer' ? `软件权限设置 - ${permTargetUser?.companyName || ''}` : `分组权限设置 - ${permTargetGroup?.name || ''}（同步组内客户）`}
        open={permVisible}
        onOk={handlePermSave}
        onCancel={() => setPermVisible(false)}
        okText="保存"
        cancelText="取消"
        width={680}
        destroyOnClose
      >
        {permMode === 'group' && (
          <Alert message="保存后该权限默认同步至组下所有客户；仍可在列表中通过「权限」单独给某个客户增删菜单" type="info" showIcon style={{ marginBottom: 12 }} />
        )}
        {permMode === 'customer' && (
          <Alert message={permNote} type="info" showIcon style={{ marginBottom: 12 }} />
        )}
        <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {permTree.map(mod => {
            const modLeaves = leavesOf(mod);
            const checkedCount = modLeaves.filter(k => permChecked.includes(k)).length;
            return (
              <div key={mod.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px' }}>
                <Checkbox
                  checked={checkedCount === modLeaves.length && modLeaves.length > 0}
                  indeterminate={checkedCount > 0 && checkedCount < modLeaves.length}
                  onChange={e => togglePermGroup(modLeaves, e.target.checked)}
                >
                  <span style={{ fontWeight: 700 }}>{mod.label}</span>
                </Checkbox>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', paddingLeft: 24, marginTop: 4 }}>
                  {(mod.children || []).map((c: any) => {
                    const cLeaves = leavesOf(c);
                    const cChecked = cLeaves.filter(k => permChecked.includes(k)).length;
                    if (!c.children || !c.children.length) {
                      return (
                        <Checkbox key={c.key} checked={permChecked.includes(c.key)} onChange={e => togglePerm(c.key, e.target.checked)}>
                          {c.label}
                        </Checkbox>
                      );
                    }
                    return (
                      <div key={c.key} style={{ width: '100%' }}>
                        <Checkbox
                          checked={cChecked === cLeaves.length && cLeaves.length > 0}
                          indeterminate={cChecked > 0 && cChecked < cLeaves.length}
                          onChange={e => togglePermGroup(cLeaves, e.target.checked)}
                        >
                          <span style={{ fontWeight: 600 }}>{c.label}</span>
                        </Checkbox>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', paddingLeft: 24 }}>
                          {c.children.map((gchild: any) => (
                            <Checkbox key={gchild.key} checked={permChecked.includes(gchild.key)} onChange={e => togglePerm(gchild.key, e.target.checked)}>
                              {gchild.label}
                            </Checkbox>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {permMode === 'customer' && (
          <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 13 }}>显式禁止页 <span style={{ color: '#999', fontWeight: 400, fontSize: 12 }}>（优先级高于上方白名单：即使勾选也强制隐藏，用于单独封禁个别页面）</span></div>
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="选择需强制隐藏的页面"
              value={permDenied}
              onChange={v => setPermDenied(v)}
              options={permTree.flatMap((mod: any) => (mod.children || []).flatMap((c: any) => ((c.children && c.children.length)
                ? c.children.map((g: any) => ({ label: `${mod.label} / ${c.label} / ${g.label}`, value: g.key }))
                : [{ label: `${mod.label} / ${c.label}`, value: c.key }])))}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DevDashboard;
