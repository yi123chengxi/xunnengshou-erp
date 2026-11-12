import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Card, Row, Col, Typography, Statistic, Table, Input, Select, Button,
  Space, Tag, message, Modal, Form, Drawer, Descriptions, Dropdown,
  Popconfirm, DatePicker, Badge, Tooltip, Checkbox, Divider, Upload, Alert,
} from 'antd';
import { reloadAfterPull } from '../utils/serverSync';
import { validatePassword } from '../utils/passwordPolicy';
import { saveDataset } from '../utils/dataStore';
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  ExportOutlined,
  UserOutlined,
  UserAddOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  KeyOutlined,
  LockOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  CopyOutlined,
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  UploadOutlined,
  DownloadOutlined,
  MobileOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { modules } from '../layouts/MainLayout';
import { getAllRoles, permissionModules, getMergedPermissions } from '../config/permissions';
import * as XLSX from 'xlsx';
import PermEditor from '../components/PermEditor';
import { loadUserPermOverrides, saveUserPermOverrides, setPreviewUser, loadRolePermSettings, saveRolePermSettings } from '../utils/perm';
import type { PermTri } from '../config/permRegistry';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const PRIMARY = '#1e4a7e';

// 解析真正的数据归属账号（如 parentAccount 链追溯到主账号）
const resolveDataOwner = (): string => {
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

// 主账号注册时的联系人（主账号姓名固定为该值，不可修改）
const getRegisteredContact = (): string => {
  try {
    const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const owner = resolveDataOwner();
    const reg = regUsers.find((u: any) => u.username === owner && !u.isSubAccount) || regUsers.find((u: any) => u.username === owner);
    return reg?.contactPerson || '';
  } catch { return ''; }
};

// 账号数据 localStorage 持久化 key（按主账号隔离，子账号共享主账号数据）
const getAccountsStorageKey = () => 'accounts_' + resolveDataOwner();

// 从 localStorage 加载账号数据，无数据时用初始模拟数据
const loadAccountsFromStorage = (): AccountRecord[] => {
  try {
    const data = localStorage.getItem(getAccountsStorageKey());
    if (data) {
      const parsed = JSON.parse(data) as AccountRecord[];
      if (parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return initialAccounts;
};

interface AccountRecord {
  key: string;
  id: string;
  username: string;
  displayName: string;
  role: string;
  roles: string[]; // 多角色数组
  customPermissions?: string[]; // 独立分配的权限
  accountType: string;
  status: string;
  date: string;
  lastLogin: string;
  remark: string;
  person: string;
  notificationBlocked?: boolean; // 屏蔽弹窗通知
  group?: string; // 所属部门（原“分组”）
  phone?: string; // 手机号码（可用于登录；同号多账号时禁用手机号登录）
}

/** registeredUsers 写入并同步上传：仅 setItem 时手机号/角色等编辑只留本浏览器，
 * 其他设备（子账号登录端）拉取服务端旧副本会报「未绑定有效手机号」 */
const persistRegisteredUsers = (list: any[]) => {
  const json = JSON.stringify(list);
  localStorage.setItem('registeredUsers', json);
  // 上传权限收敛：仅主账号（管理员）会话可把账号注册表写入共享数据集；
  // 子账号/只读会话改动只留本地，收窄客户端越权写注册表（角色/状态/手机号）的攻击面
  try {
    if (localStorage.getItem('isSubAccount') === 'true' || localStorage.getItem('isViewOnly') === 'true') return;
  } catch { return; }
  saveDataset('registeredUsers', json);
};

// 分组数据持久化
export interface GroupRecord {
  name: string;
  permissions: string[]; // 组权限列表（与个人权限叠加）
}

// 账号导入行（预览校验结果）
interface ImportAccountRow {
  rowNo: number;
  group: string;
  username: string;
  displayName: string;
  password: string;
  remark: string;
  error: string;
}
const getGroupsStorageKey = () => 'account_groups_' + resolveDataOwner();
const loadGroups = (): GroupRecord[] => {
  try {
    const data = localStorage.getItem(getGroupsStorageKey());
    if (data) {
      const parsed = JSON.parse(data);
      // 向后兼容：旧数据为 string[]，迁移为 GroupRecord[]
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        return (parsed as string[]).map(name => ({ name, permissions: [] }));
      }
      return parsed as GroupRecord[];
    }
  } catch { /* ignore */ }
  return [];
};
const saveGroups = (groups: GroupRecord[]) => {
  localStorage.setItem(getGroupsStorageKey(), JSON.stringify(groups));
};


// 初始账号数据（仅保留主账号，子账号由管理员手动创建）
const initialAccounts: AccountRecord[] = [
  { key: '1', id: 'ACC-001', username: 'admin', displayName: '系统管理员', role: 'super_admin', roles: [], accountType: '主账号', status: 'normal', date: '2024-01-01', lastLogin: '2024-06-26', remark: '系统超级管理员', person: '管理员' },
];

const roleOptions = [
  { label: '超级管理员', value: 'super_admin' },
  { label: '管理员', value: 'admin' },
  { label: '普通用户', value: 'user' },
  { label: '只读用户', value: 'viewer' },
];


const roleColorMap: Record<string, string> = {
  super_admin: 'red',
  admin: 'blue',
  user: 'green',
  viewer: 'default',
};

const roleLabelMap: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  user: '普通用户',
  viewer: '只读用户',
};

// 独立权限选择器组件（最高权限编辑，可控制所有权限项包括角色预设）
const CustomPermSelector: React.FC<{
  value: string[];
  onChange: (perms: string[]) => void;
  roles: string[];
}> = ({ value, onChange, roles }) => {


  // 用 ref 跟踪最新 value，避免闭包问题
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const allPerms = new Set(value);
  const rolePerms = new Set(getMergedPermissions(roles || []));

  const togglePerm = (permKey: string, checked: boolean) => {

    const current = new Set(valueRef.current);
    if (checked) current.add(permKey);
    else current.delete(permKey);
    const result = Array.from(current);

    onChangeRef.current(result);
  };

  const toggleModule = (modPerms: string[], checked: boolean) => {
    const current = new Set(valueRef.current);
    modPerms.forEach(p => {
      if (checked) current.add(p);
      else current.delete(p);
    });
    onChangeRef.current(Array.from(current));
  };

  return (
    <div>
      <Form.Item label="独立权限配置" style={{ marginBottom: 0 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          <SafetyCertificateOutlined style={{ marginRight: 4, color: '#1677ff' }} />
          此处配置具有最高优先级，可覆盖角色预设权限
        </Text>
      </Form.Item>
      {permissionModules.map(mod => {
        const modPerms = mod.children.map(c => `${mod.key}/${c.key}`);
        const checkedCount = modPerms.filter(p => allPerms.has(p)).length;
        const allChecked = checkedCount === modPerms.length && modPerms.length > 0;
        const someChecked = checkedCount > 0 && checkedCount < modPerms.length;
        return (
          <div key={mod.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={(e) => toggleModule(modPerms, e.target.checked)}
              >
                <Text strong style={{ fontSize: 13 }}>{mod.label}</Text>
              </Checkbox>
              <Tag color="blue" style={{ marginLeft: 6 }}>{modPerms.length}</Tag>
            </div>
            <Row gutter={[8, 4]} style={{ marginLeft: 24 }}>
              {mod.children.map(child => {
                const permKey = `${mod.key}/${child.key}`;
                const isChecked = allPerms.has(permKey);
                const isFromRole = rolePerms.has(permKey);
                return (
                  <Col span={8} key={permKey}>
                    <Checkbox
                      checked={isChecked}
                      onChange={(e) => togglePerm(permKey, e.target.checked)}
                    >
                      {child.label}
                      {isFromRole && <Tag color="processing" style={{ fontSize: 10, marginLeft: 4, lineHeight: '16px', padding: '0 4px' }}>预设</Tag>}
                    </Checkbox>
                  </Col>
                );
              })}
            </Row>
            <Divider style={{ margin: '6px 0' }} />
          </div>
        );
      })}
    </div>
  );
};

const AccountManage: React.FC = () => {
  const { moduleKey = 'settings', childKey = 'account-manage' } = useParams<{ moduleKey: string; childKey: string }>();
  const navigate = useNavigate();

  const [dataSource, setDataSource] = useState<AccountRecord[]>(loadAccountsFromStorage);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 分组管理
  const [groups, setGroups] = useState<GroupRecord[]>(loadGroups);
  const [selectedGroup, setSelectedGroup] = useState<string>(''); // '' = 全部
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupForm] = Form.useForm();
  const [editingGroup, setEditingGroup] = useState<string>(''); // 编辑中的旧分组名
  const [groupPerms, setGroupPerms] = useState<string[]>([]); // 当前编辑分组的权限
  const [groupPermDraft, setGroupPermDraft] = useState<Record<string, PermTri>>({}); // 分组三态权限草稿（与个人同编辑器）

  // 登录日志弹窗
  const [logVisible, setLogVisible] = useState(false);
  const [loginLogs, setLoginLogs] = useState<any[]>([]);

  const handleViewLogs = useCallback(() => {
    try {
      const logs = JSON.parse(localStorage.getItem('login_audit_log') || '[]');
      setLoginLogs(logs);
    } catch { setLoginLogs([]); }
    setLogVisible(true);
  }, []);

  const handleClearLogs = useCallback(() => {
    Modal.confirm({
      title: '确认清除',
      content: '确定要清除所有登录日志吗',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        localStorage.removeItem('login_audit_log');
        setLoginLogs([]);
        message.success('登录日志已清除');
      },
    });
  }, []);

  // 详情抽屉
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AccountRecord | null>(null);

  // 编辑模态框
  const [editVisible, setEditVisible] = useState(false);
  const [editForm] = Form.useForm();

  // 新增子账号模态框
  const [addVisible, setAddVisible] = useState(false);
  const [addForm] = Form.useForm();

  // 重置密码模态框
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdForm] = Form.useForm();
  const [pwdAccount, setPwdAccount] = useState<AccountRecord | null>(null);

  // 权限展开状态（新建子账号弹窗的独立权限配置）
  const [addPermExpanded, setAddPermExpanded] = useState(false);
  // PERM_V2 个人三态覆写草稿
  const [overrideDraft, setOverrideDraft] = useState<Record<string, PermTri>>({});

  // 权限数据（完全由组件状态管理，不依赖 Form
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const editPermsRef = React.useRef<string[]>([]);
  const [addPerms, setAddPerms] = useState<string[]>([]);
  const addPermsRef = React.useRef<string[]>([]);
  const addGroupPermsRef = React.useRef<string[]>([]); // 新建窗自动继承的部门权限快照（切换部门时替换赋
  const copyFromRef = React.useRef<string>(''); // 复制建号源账号 username

  // 使用 Form.useWatch 获取当前角色（用于传递给权限选择器）
  const addWatchedRoles: string[] = Form.useWatch('roles', addForm) || [];

  // 同步 ref 到 state
  const updateEditPerms = (perms: string[]) => {

    editPermsRef.current = perms;
    setEditPerms(perms);
  };
  const updateAddPerms = (perms: string[]) => {
    addPermsRef.current = perms;
    setAddPerms(perms);
  };

  // 数据统计
  const stats = useMemo(() => {
    let todayLogs = 0;
    try {
      const today = new Date().toISOString().split('T')[0];
      const logs: any[] = JSON.parse(localStorage.getItem('login_audit_log') || '[]');
      todayLogs = logs.filter(l => l.time?.startsWith(today)).length;
    } catch { /* ignore */ }
    return {
      totalAccounts: dataSource.length,
      activeAccounts: dataSource.filter(a => a.status === 'normal').length,
      subAccounts: dataSource.filter(a => a.accountType === '子账号').length,
      todayLogs,
    };
  }, [dataSource]);

  // 数据变化时自动持久化到 localStorage
  useEffect(() => {
    localStorage.setItem(getAccountsStorageKey(), JSON.stringify(dataSource));
  }, [dataSource]);

  // 自动修正：主账号姓名固定为注册时的联系人（历史数据可能仍为“系统管理员”）
  useEffect(() => {
    const contact = getRegisteredContact();
    if (!contact) return;
    setDataSource(prev => {
      const changed = prev.some(a => a.accountType === '主账号' && a.displayName !== contact);
      if (!changed) return prev;
      return prev.map(a => (a.accountType === '主账号' ? { ...a, displayName: contact } : a));
    });
  }, []);

  // 自动修复：扫描 registeredUsers，修正所有子账号的 parentAccount 指向真正的主账号
  useEffect(() => {
    try {
      const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      let changed = false;
      regUsers.forEach((u: any) => {
        if (!u.isSubAccount || !u.parentAccount) return;
        let cur = u.parentAccount;
        const visited = new Set<string>();
        while (cur && !visited.has(cur)) {
          visited.add(cur);
          const p = regUsers.find((r: any) => r.username === cur);
          if (!p || !p.isSubAccount) break;
          cur = p.parentAccount || '';
        }
        if (cur && cur !== u.parentAccount) {
          u.parentAccount = cur;
          changed = true;
        }
      });
      if (changed) {
        persistRegisteredUsers(regUsers);
      }
    } catch { /* ignore */ }
  // eslint-disable-line
  }, []);

  // 筛选后的数据
  const filteredData = useMemo(() => {
    return dataSource.filter(item => {
      const matchSearch = !searchText ||
        item.username.toLowerCase().includes(searchText.toLowerCase()) ||
        item.displayName.includes(searchText) ||
        item.id.toLowerCase().includes(searchText.toLowerCase());
      const matchStatus = !statusFilter || item.status === statusFilter;
      const matchRole = !roleFilter || item.role === roleFilter;
      // 分组筛选：'' = 全部，__ungrouped__' = 未指定分组，其他 = 匹配分组名
      const matchGroup = !selectedGroup
        ? true
        : selectedGroup === '__ungrouped__'
          ? !item.group || item.group === ''
          : item.group === selectedGroup;
      return matchSearch && matchStatus && matchRole && matchGroup;
    });
  }, [dataSource, searchText, statusFilter, roleFilter, selectedGroup]);

  // 查看详情
  const handleView = useCallback((record: AccountRecord) => {
    setSelectedRecord(record);
    setDetailVisible(true);
  }, []);

  // 编辑账号
  const handleEdit = useCallback((record: AccountRecord) => {
    setSelectedRecord(record);
    // 如果 customPermissions 为空但有角色，合并角色权限作为初始值
    let initPerms = record.customPermissions || [];

    if (initPerms.length === 0 && record.roles && record.roles.length > 0) {
      initPerms = getMergedPermissions(record.roles);

    }
    editForm.setFieldsValue({
      displayName: record.displayName,
      roles: record.roles || [],
      remark: record.remark,
      phone: record.phone || '',
    });
    updateEditPerms(initPerms);
    setOverrideDraft(loadUserPermOverrides(record.username));

    setEditVisible(true);
  }, [editForm]);

  const handleEditConfirm = useCallback(() => {
    editForm.validateFields().then(values => {
      // 主账号姓名锁定为注册联系人，编辑窗口不可修改
      if (selectedRecord?.accountType === '主账号') {
        const contact = getRegisteredContact();
        if (contact) values.displayName = contact;
      }
      // 手机号码：同号多账号提示（同号并存时手机号登录将被禁用），并同步 registeredUsers 供手机号登录
      const inputPhone = String(values.phone || '').trim();
      if (inputPhone) {
        try {
          const regUsers0: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const dupPhones = regUsers0.filter((u: any) => u.username !== selectedRecord?.username && String(u.phone || '').trim() === inputPhone);
          if (dupPhones.length > 0) {
            message.warning(`注意：该手机号已绑定 ${dupPhones.length} 个其他账号；同一号码绑定多个租户/子账号时，手机号登录将被禁用，请使用用户名登录`);
          }
        } catch { /* ignore */ }
      }

      setDataSource(prev => {
        const updated = prev.map(item =>
          item.key === selectedRecord?.key
            ? {
                ...item,
                ...values,
                roles: values.roles || [],
                customPermissions: editPermsRef.current,
                remark: values.remark || '',
                group: values.group || '',
                phone: inputPhone,
              }
            : item
        );
        // 同步更新 registeredUsers 中的角色和权限（含手机号，供手机号登录校验）
        try {
          const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const idx = regUsers.findIndex((u: any) => u.username === selectedRecord?.username);
          if (idx >= 0) {
            regUsers[idx].roles = values.roles || [];
            regUsers[idx].customPermissions = editPermsRef.current;
            regUsers[idx].phone = inputPhone;
            // 权限编辑版本戳：子账号设备合并层按 _permTs 采纳服务端新版权限（防停留在新增时快照）
            regUsers[idx]._permTs = Date.now();
            persistRegisteredUsers(regUsers);
          }
        } catch { /* ignore */ }
        return updated;
      });
      if (selectedRecord) saveUserPermOverrides(selectedRecord.username, overrideDraft);
      message.success('账号信息更新成功');
      setEditVisible(false);
      updateEditPerms([]);
      editForm.resetFields();
    }).catch(() => { /* 校验失败：表单行内提示并滚动到首个错误项，不抛未处理异常 */ });
  }, [editForm, selectedRecord, overrideDraft]);

  // 删除账号
  const handleDelete = useCallback((record: AccountRecord) => {
    if (record.accountType === '主账号') {
      message.warning('主账号不可删除');
      return;
    }
    const currentUser = localStorage.getItem('username') || '';
    if (record.username === currentUser) {
      message.warning('不能删除当前登录的账号');
      return;
    }
    setDataSource(prev => prev.filter(item => item.key !== record.key));
    // 同步到 registeredUsers 中移除该子账号，使其无法再登录
    try {
      const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const updated = regUsers.filter((u: any) => u.username !== record.username);
      persistRegisteredUsers(updated);
    } catch { /* ignore */ }
    message.success(`账号 ${record.displayName} 已删除`);
  }, []);

  // 启用/禁用账号
  const handleToggleStatus = useCallback((record: AccountRecord) => {
    if (record.accountType === '主账号') {
      message.warning('主账号不可禁用');
      return;
    }
    const currentUser = localStorage.getItem('username') || '';
    if (record.username === currentUser) {
      message.warning('不能禁用当前登录的账号');
      return;
    }
    const newStatus = record.status === 'normal' ? 'disabled' : 'normal';
    setDataSource(prev =>
      prev.map(item =>
        item.key === record.key ? { ...item, status: newStatus } : item
      )
    );
    // 同步更新 registeredUsers 中的账号状态，禁用后无法登录
    try {
      const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const idx = regUsers.findIndex((u: any) => u.username === record.username);
      if (idx >= 0) {
        regUsers[idx].accountStatus = newStatus;
        persistRegisteredUsers(regUsers);
      }
    } catch { /* ignore */ }
    message.success(newStatus === 'normal' ? `账号 ${record.displayName} 已启用` : `账号 ${record.displayName} 已禁用`);
  }, []);

  // 切换屏蔽弹窗状态
  const handleToggleNotificationBlock = useCallback((record: AccountRecord) => {
    const newVal = !record.notificationBlocked;
    setDataSource(prev =>
      prev.map(item =>
        item.key === record.key ? { ...item, notificationBlocked: newVal } : item
      )
    );
    message.success(`账号 ${record.displayName} ${newVal ? '已屏蔽' : '已取消屏蔽'}弹窗通知`);
  }, []);

  // ========== 分组管理 ==========
  const handleAddGroup = useCallback(() => {
    setEditingGroup('');
    setGroupPerms([]);
    groupForm.resetFields();
    setGroupPermDraft({});
    setGroupModalVisible(true);
  }, [groupForm]);

  const handleEditGroup = useCallback((name: string) => {
    setEditingGroup(name);
    const grp = groups.find(g => g.name === name);
    setGroupPerms(grp?.permissions || []);
    groupForm.setFieldsValue({ name });
    const savedDraft = loadRolePermSettings()[`__group__${name}`] || {};
    const draft: Record<string, PermTri> = { ...savedDraft };
    (grp?.permissions || []).forEach((k: string) => { if (!draft[k]) draft[k] = 'allow'; });
    setGroupPermDraft(draft);
    setGroupModalVisible(true);
  }, [groupForm, groups]);

  const handleDeleteGroup = useCallback((name: string) => {
    Modal.confirm({
      title: `确认删除分组「{name}」？`,
      content: '删除后该分组下的账号将变为“未指定分组」',
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: () => {
        const newGroups = groups.filter(g => g.name !== name);
        setGroups(newGroups); saveGroups(newGroups);
        // 清除账号中的分组标记
        setDataSource(prev => prev.map(item =>
          item.group === name ? { ...item, group: '' } : item
        ));
        if (selectedGroup === name) setSelectedGroup('');
        message.success(`分组「{name}」已删除`);
      },
    });
  }, [groups, selectedGroup]);

  const handleGroupModalOk = useCallback(() => {
    groupForm.validateFields().then(values => {
      const newName = values.name.trim();
      if (!newName) return;
      // 三态编辑器中显式允许的菜单点同步为分组 legacy 权限清单
      const menuAllow = Object.keys(groupPermDraft).filter(k => groupPermDraft[k] === 'allow' && !k.startsWith('fn:') && !k.startsWith('field:'));
      if (editingGroup) {
        // 编辑模式：重命名分组
        if (newName !== editingGroup && groups.some(g => g.name === newName)) {
          message.warning('该分组名称已存在'); return;
        }
        const newGroups = groups.map(g =>
          g.name === editingGroup ? { name: newName, permissions: menuAllow } : g
        );
        setGroups(newGroups); saveGroups(newGroups);
        setDataSource(prev => prev.map(item =>
          item.group === editingGroup ? { ...item, group: newName } : item
        ));
        if (selectedGroup === editingGroup) setSelectedGroup(newName);
        message.success(`分组「{newName}」已保存`);
      } else {
        // 新增模式
        if (groups.some(g => g.name === newName)) {
          message.warning('该分组名称已存在'); return;
        }
        const newGroups = [...groups, { name: newName, permissions: menuAllow }];
        setGroups(newGroups); saveGroups(newGroups);
        message.success(`分组「{newName}」已创建`);
      }
      saveRolePermSettings(`__group__${newName}`, groupPermDraft);
      setGroupModalVisible(false); groupForm.resetFields(); setGroupPerms([]); setGroupPermDraft({});
    }).catch(() => { /* 校验失败：表单行内提交*/ });
  }, [editingGroup, groups, selectedGroup, groupForm, groupPerms, groupPermDraft]);

  // 重置密码
  const handleResetPwd = useCallback((record: AccountRecord) => {
    setPwdAccount(record);
    pwdForm.resetFields();
    setPwdVisible(true);
  }, [pwdForm]);

  const handlePwdConfirm = useCallback(() => {
    pwdForm.validateFields().then(values => {
      // 同步更新 registeredUsers 中的密码
      if (pwdAccount) {
        try {
          const registeredUsers: any[] = JSON.parse(
            localStorage.getItem('registeredUsers') || '[]'
          );
          const idx = registeredUsers.findIndex(
            (u: any) => u.username === pwdAccount.username
          );
          if (idx >= 0) {
            registeredUsers[idx].password = values.newPassword;
            persistRegisteredUsers(registeredUsers);
          }
        } catch { /* ignore */ }
      }
      message.success(`账号 ${pwdAccount?.displayName} 的密码已重置`);
      setPwdVisible(false);
      pwdForm.resetFields();
    }).catch(() => { /* 校验失败：表单行内提交*/ });
  }, [pwdForm, pwdAccount]);

  // 新建子账号
  const handleAdd = useCallback(() => {
    addForm.resetFields();
    updateAddPerms([]);
    addGroupPermsRef.current = [];
    copyFromRef.current = '';
    setAddVisible(true);
  }, [addForm]);

  // 复制账号：复用源账号的角色/独立权限/个人三态覆写/分组，快速创建新子账号
  const handleCopy = useCallback((record: AccountRecord) => {
    copyFromRef.current = record.username;
    addForm.resetFields();
    addForm.setFieldsValue({ roles: record.roles || [], group: record.group || '', remark: `复制自 ${record.displayName}` });
    updateAddPerms(record.customPermissions || []);
    addGroupPermsRef.current = [];
    setAddVisible(true);
    message.info(`已复制「${record.displayName}」的角色与权限，请为新账号填写用户名/姓名/密码`);
  }, [addForm]);

  const handleAddConfirm = useCallback(() => {
    addForm.validateFields().then(values => {
      // 校验用户名是否已存在（子账号列表 + 已注册账号）
      const inputUsername = values.username.trim();
      const existsInList = dataSource.some(
        (a) => a.username.toLowerCase() === inputUsername.toLowerCase()
      );
      if (existsInList) {
        message.error(`用户名「{inputUsername}」已存在，请换一个用户名`);
        return;
      }
      let registeredUsers: any[] = [];
      try {
        registeredUsers = JSON.parse(
          localStorage.getItem('registeredUsers') || '[]'
        );
        const existsInRegistered = registeredUsers.some(
          (u: any) => u.username?.toLowerCase() === inputUsername.toLowerCase()
        );
        if (existsInRegistered) {
          message.error(`用户名「{inputUsername}」已被注册，请换一个用户名`);
          return;
        }
      } catch { /* ignore */ }

      // 手机号码：必填 + 格式校验 + 同号多账号提示（同号并存时手机号登录将被禁用）
      const inputPhone = String(values.phone || '').trim();
      if (!inputPhone) {
        message.error('请输入手机号码（子账号必填，用于登录验证码接收）');
        return;
      }
      if (!/^1[3-9]\d{9}$/.test(inputPhone)) {
        message.error('手机号码格式不正确（须为 11 位有效手机号）');
        return;
      }
      if (inputPhone) {
        const dupPhones = registeredUsers.filter((u: any) => String(u.phone || '').trim() === inputPhone);
        if (dupPhones.length > 0) {
          message.warning(`注意：该手机号已绑定 ${dupPhones.length} 个其他账号；同一号码绑定多个租户/子账号时，手机号登录将被禁用，请使用用户名登录`);
        }
      }

      // 获取当前登录用户的角色信息，子账号继承主账号的角色信息
      const currentUsername = localStorage.getItem('username') || '';
      const currentUserRole = localStorage.getItem('userRole') || 'supplier';
      const isSub = localStorage.getItem('isSubAccount') === 'true';
      // 新创建的子账号的父账号应该是主账号，而不是当前登录的子账号
      const parentAccount = isSub
        ? (localStorage.getItem('parentAccount') || currentUsername)
        : currentUsername;
      const currentUser = registeredUsers.find((u: any) => u.username === currentUsername);

      const newKey = String(dataSource.length + 1);
      const newAccount: AccountRecord = {
        key: newKey,
        id: `ACC-${String(dataSource.length + 1).padStart(3, '0')}`,
        username: values.username,
        displayName: values.displayName,
        role: values.role,
        roles: values.roles || [],
        customPermissions: addPermsRef.current,
        accountType: '子账号',
        status: 'normal',
        date: new Date().toISOString().split('T')[0],
        lastLogin: '-',
        remark: values.remark || '',
        person: values.displayName,
        group: values.group || '',
        phone: inputPhone,
      };
      setDataSource(prev => [newAccount, ...prev]);

      // 同时写入 registeredUsers，使子账号可以登录
      registeredUsers.push({
        username: inputUsername,
        password: values.password,
        role: currentUserRole,
        roles: values.roles || [],
        customPermissions: addPermsRef.current,
        _permTs: Date.now(),
        companyName: currentUser?.companyName || currentUsername,
        contactPerson: values.displayName,
        email: '',
        phone: inputPhone,
        isSubAccount: true,
        parentAccount: parentAccount,  // 使用主账号作为父账号
        needsPasswordChange: true,
      });
      persistRegisteredUsers(registeredUsers);

      // 复制建号：同步复制源账号的个人三态覆写
      if (copyFromRef.current) {
        saveUserPermOverrides(inputUsername, loadUserPermOverrides(copyFromRef.current));
        copyFromRef.current = '';
      }

      message.success(`子账号「${values.displayName} 创建成功！初始密码为：${values.password}`);
      setAddVisible(false);
      updateAddPerms([]);
      addForm.resetFields();
    }).catch(() => { /* 校验失败：表单行内提示并滚动到首个错误项 */ });
  }, [addForm, dataSource.length]);

  // ==================== 账号导入 ====================
  const [importVisible, setImportVisible] = useState(false);
  const [importRows, setImportRows] = useState<ImportAccountRow[]>([]);

  // 下载导入模板
  const handleImportTemplate = useCallback(() => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['所属分组', '用户名', '姓名*', '初始密码', '备注'],
      ['销售部', 'zhangsan01', '张三', 'abc123456', '示例行可删除'],
    ]);
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '账号');
    XLSX.writeFile(wb, '账号导入模板.xlsx');
  }, []);

  // 解析导入文件：所属分组/用户名/姓名必填；权限自动继承分组；首登须改密
  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: any[] = ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
        const pick = (r: any, keys: string[]) => {
          for (const k of keys) { const v = r[k]; if (v !== undefined && String(v).trim() !== '') return String(v).trim(); }
          return '';
        };
        let registered: any[] = [];
        try { registered = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
        const seen = new Set<string>();
        const rows: ImportAccountRow[] = raw.map((r, i) => {
          const group = pick(r, ['所属分组', '所属分组', '分组', '所属部门']);
          const username = pick(r, ['用户名', '用户名', '账号']);
          const displayName = pick(r, ['姓名*', '姓名', '名称']);
          const password = pick(r, ['初始密码', '密码']) || 'Xns@2026init';
          const remark = pick(r, ['备注', '说明']);
          const row: ImportAccountRow = { rowNo: i + 2, group, username, displayName, password, remark, error: '' };
          if (!group) row.error = '缺少所属分组（必填）';
          else if (!groups.some(g => g.name === group)) row.error = `分组「{group}」不存在，请先在分组管理中创建`;
          if (!row.error) {
            if (!username) row.error = '缺少用户名（必填）';
            else if (!/^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(username)) row.error = '用户名须字母开头3-20位字母数字下划线';
            else if (seen.has(username.toLowerCase())) row.error = '文件内用户名重复';
            else if (dataSource.some(a => a.username.toLowerCase() === username.toLowerCase())) row.error = '用户名已存在于账号列表';
            else if (registered.some((u: any) => String(u.username || '').toLowerCase() === username.toLowerCase())) row.error = '用户名已被注册';
          }
          if (!row.error && !displayName) row.error = '缺少姓名（必填）';
          if (!row.error && !validatePassword(password, { username }).ok) row.error = validatePassword(password, { username }).message;
          if (!row.error) seen.add(username.toLowerCase());
          return row;
        }).filter(r => r.group || r.username || r.displayName || r.remark); // 忽略全空行
        if (!rows.length) { message.warning('未从文件中读取到有效账号行，请按模板填写'); return; }
        setImportRows(rows);
        setImportVisible(true);
      } catch {
        message.error('文件解析失败，请导入模板导出的 Excel/CSV 文件');
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // 阻止默认上传行为
  }, [groups, dataSource]);

  // 确认导入：批量创建子账号（权限继承分组、首登必须修改密码）
  const handleImportConfirm = useCallback(() => {
    const okRows = importRows.filter(r => !r.error);
    if (!okRows.length) { message.warning('没有可导入的账号数'); return; }
    const currentUsername = localStorage.getItem('username') || '';
    const currentUserRole = localStorage.getItem('userRole') || 'supplier';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    const parentAccount = isSub ? (localStorage.getItem('parentAccount') || currentUsername) : currentUsername;
    let registeredUsers: any[] = [];
    try { registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    const currentUser = registeredUsers.find((u: any) => u.username === currentUsername);
    let maxId = dataSource.reduce((m, a) => {
      const n = Number(String(a.id || '').replace('ACC-', ''));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const today = new Date().toISOString().split('T')[0];
    const newAccounts: AccountRecord[] = [];
    okRows.forEach(r => {
      maxId += 1;
      const groupPerms = groups.find(g => g.name === r.group)?.permissions || [];
      newAccounts.push({
        key: String(maxId),
        id: `ACC-${String(maxId).padStart(3, '0')}`,
        username: r.username,
        displayName: r.displayName,
        role: '',
        roles: [],
        customPermissions: groupPerms, // 权限自动继承所属分组
        accountType: '子账号',
        status: 'normal',
        date: today,
        lastLogin: '-',
        remark: r.remark || '账号导入',
        person: r.displayName,
        group: r.group,
      });
      registeredUsers.push({
        username: r.username,
        password: r.password,
        role: currentUserRole,
        roles: [],
        customPermissions: groupPerms,
        companyName: currentUser?.companyName || currentUsername,
        contactPerson: r.displayName,
        email: '',
        phone: '',
        isSubAccount: true,
        parentAccount,
        needsPasswordChange: true, // 首次登录必须修改密码
      });
    });
    persistRegisteredUsers(registeredUsers);
    setDataSource(prev => [...newAccounts, ...prev]);
    setImportVisible(false);
    setImportRows([]);
    message.success(`成功导入 ${newAccounts.length} 个账号：权限继承所属分组，首次登录须修改密码`);
  }, [importRows, groups, dataSource]);

  // 搜索和重置（查询时自动刷新表单数据）
  const handleSearch = useCallback(() => {
    reloadAfterPull(() => setDataSource(loadAccountsFromStorage())); // 查询时先本地重载再拉服务端
    message.info(`找到 ${filteredData.length} 条记录`);
  }, [filteredData.length]);

  const handleReset = useCallback(() => {
    setSearchText('');
    setStatusFilter('');
    setRoleFilter('');
  }, []);

  // 导出
  const handleExport = useCallback(() => {
    const headers = ['账号ID', '用户名', '姓名', '角色', '账号类型', '状态', '所属部门', '创建时间', '最近登录', '备注'];
    const rows = filteredData.map(item => [
      item.id, item.username, item.displayName,
      (item.roles || []).join('; ') || item.role,
      item.accountType,
      item.status === 'normal' ? '正常' : '禁用',
      item.group || '', item.date, item.lastLogin, item.remark,
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '账号管理_导出.csv';
    link.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  }, [filteredData]);

  // 批量操作
  const handleBatchAction = useCallback(({ key }: { key: string }) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择账号');
      return;
    }
    const currentUser = localStorage.getItem('username') || '';
    switch (key) {
      case 'batch-enable': {
        setDataSource(prev => prev.map(item =>
          selectedRowKeys.includes(item.key) && item.accountType !== '主账号'
            ? { ...item, status: 'normal' } : item
        ));
        // 同步 registeredUsers
        try {
          const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const targetUsernames = dataSource
            .filter(d => selectedRowKeys.includes(d.key) && d.accountType !== '主账号')
            .map(d => d.username);
          regUsers.forEach((u: any) => {
            if (targetUsernames.includes(u.username)) u.accountStatus = 'normal';
          });
          persistRegisteredUsers(regUsers);
        } catch { /* ignore */ }
        message.success(`已启用 ${selectedRowKeys.length} 个账号`);
        break;
      }
      case 'batch-disable': {
        setDataSource(prev => prev.map(item =>
          selectedRowKeys.includes(item.key) && item.accountType !== '主账号' && item.username !== currentUser
            ? { ...item, status: 'disabled' } : item
        ));
        // 同步 registeredUsers
        try {
          const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const targetUsernames = dataSource
            .filter(d => selectedRowKeys.includes(d.key) && d.accountType !== '主账号' && d.username !== currentUser)
            .map(d => d.username);
          regUsers.forEach((u: any) => {
            if (targetUsernames.includes(u.username)) u.accountStatus = 'disabled';
          });
          persistRegisteredUsers(regUsers);
        } catch { /* ignore */ }
        message.success(`已禁用 ${selectedRowKeys.length} 个账号`);
        break;
      }
      case 'batch-delete':
        Modal.confirm({
          title: '确认批量删除',
          icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
          content: `确定要删除选中的 ${selectedRowKeys.length} 个账号吗？主账号和当前登录账号不会被删除。`,
          okText: '确认删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => {
            // 找出将被删除的账号用户名
            const deleteTargets = dataSource.filter(
              item => selectedRowKeys.includes(item.key) && item.accountType !== '主账号' && item.username !== currentUser
            ).map(d => d.username);
            setDataSource(prev => prev.filter(item =>
              (!selectedRowKeys.includes(item.key) || item.accountType === '主账号' || item.username === currentUser)
            ));
            // 同步到 registeredUsers 中移除
            try {
              const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
              const updated = regUsers.filter((u: any) => !deleteTargets.includes(u.username));
              persistRegisteredUsers(updated);
            } catch { /* ignore */ }
            setSelectedRowKeys([]);
            message.success('批量删除完成');
          },
        });
        break;
    }
  }, [selectedRowKeys]);

  const batchMenuItems = [
    { key: 'batch-enable', icon: <CheckCircleOutlined />, label: '批量启用' },
    { key: 'batch-disable', icon: <StopOutlined />, label: '批量禁用' },
    { type: 'divider' as const },
    { key: 'batch-delete', icon: <DeleteOutlined />, label: '批量删除', danger: true },
  ];

  // 表格列定义
  const columns: ColumnsType<AccountRecord> = [
    { title: '账号ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '用户名', dataIndex: 'username', key: 'username', width: 110 },
    { title: '姓名', dataIndex: 'displayName', key: 'displayName', width: 120 },
    {
      title: '所属分组', dataIndex: 'group', key: 'group', width: 100,
      render: (g: string | undefined, record: AccountRecord) => {
        if (record.accountType === '主账号') return <Tag color="gold">-</Tag>;
        return g ? <Tag color="blue">{g}</Tag> : <Text type="secondary">未指定</Text>;
      },
    },
    {
      title: '权限角色', dataIndex: 'roles', key: 'roles', width: 180,
      render: (roles: string[], record) => {
        if (!roles || roles.length === 0) {
          // 无角色且无单独角色标签：导入账号等继承分组权限的回退显示
          if (!record.role && record.group) return <Tag color="cyan">继承「{record.group}」权限</Tag>;
          return <Tag color={roleColorMap[record.role] || 'default'}>{roleLabelMap[record.role] || record.role}</Tag>;
        }
        return (
          <Space size={[0, 4]} wrap>
            {roles.map(r => (
              <Tag key={r} color={r === '全部权限' ? 'gold' : r === '生产管理' ? 'blue' : r === '销售管理' ? 'green' : r === '财务管理' ? 'purple' : r === '采购管理' ? 'cyan' : 'default'}>{r}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '账号类型', dataIndex: 'accountType', key: 'accountType', width: 90,
      render: (type: string) => (
        <Tag color={type === '主账号' ? 'gold' : 'blue'}>{type}</Tag>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (status: string) => (
        <Badge
          status={status === 'normal' ? 'success' : 'error'}
          text={status === 'normal' ? '正常' : '禁用'}
        />
      ),
    },
    {
      title: '屏蔽弹窗', dataIndex: 'notificationBlocked', key: 'notificationBlocked', width: 90,
      render: (v: boolean | undefined, record: AccountRecord) => (
        <Tag
          color={v ? 'red' : 'green'}
          style={{ cursor: record.accountType !== '主账号' ? 'pointer' : 'default' }}
          onClick={() => {
            if (record.accountType === '主账号') { message.warning('主账号不可设置屏蔽'); return; }
            handleToggleNotificationBlock(record);
          }}
        >{v ? '是' : '否'}</Tag>
      ),
    },
    { title: '所属部门', dataIndex: 'group', key: 'group', width: 110, render: (v: string) => v || '无' },
    { title: '创建时间', dataIndex: 'date', key: 'date', width: 110 },
    {
      title: '最近登录', dataIndex: 'lastLogin', key: 'lastLogin', width: 110,
      render: (v: string) => v === '-' ? <Text type="secondary">从未登录</Text> : v,
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 160, ellipsis: true },
    {
      title: '操作', key: 'action', width: 260, fixed: 'right',
      render: (_, record) => (
        <Space size="small" wrap>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>查看</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          {record.accountType !== '主账号' && (
            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(record)}>复制</Button>
          )}
          {record.accountType !== '主账号' && (
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setPreviewUser(record.username); message.success(`已切换为「{record.displayName}」预览视角，页面顶部横幅可退出`); }}>预览视角</Button>
          )}
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => handleResetPwd(record)}>重置密码</Button>
          <Popconfirm
            title={record.status === 'normal' ? `确定要禁用 ${record.displayName} 吗？` : `确定要启用 ${record.displayName} 吗？`}
            onConfirm={() => handleToggleStatus(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger={record.status === 'normal'}
              icon={record.status === 'normal' ? <StopOutlined /> : <CheckCircleOutlined />}
            >
              {record.status === 'normal' ? '禁用' : '启用'}
            </Button>
          </Popconfirm>
          {record.accountType !== '主账号' && (
            <Popconfirm
              title={`确定要删除 ${record.displayName} 吗？`}
              description="删除后数据不可恢复"
              onConfirm={() => handleDelete(record)}
              okText="确认删除"
              okType="danger"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // 统计每个分组下的账号数量
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let ungrouped = 0;
    dataSource.forEach(item => {
      if (item.accountType === '主账号') return;
      if (item.group) { counts[item.group] = (counts[item.group] || 0) + 1; }
      else { ungrouped++; }
    });
    return { counts, ungrouped, total: dataSource.filter(d => d.accountType !== '主账号').length };
  }, [dataSource]);

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* ========== 左侧分组面板 ========== */}
      <Card
        style={{ width: 220, flexShrink: 0, height: 'fit-content' }}
        bodyStyle={{ padding: '12px 0' }}
        title={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <Text strong style={{ fontSize: 14 }}><TeamOutlined style={{ marginRight: 6 }} />分组</Text>
          <Button type="link" size="small" icon={<PlusOutlined />} onClick={handleAddGroup}>新建</Button>
        </div>}
      >
        <div
          onClick={() => setSelectedGroup('')}
          style={{
            padding: '8px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
            background: selectedGroup === '' ? '#e6f4ff' : 'transparent',
            borderLeft: selectedGroup === '' ? `3px solid ${PRIMARY}` : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          <Text>全部账号</Text>
          <Tag>{groupCounts.total}</Tag>
        </div>
        {groups.map(g => (
          <div
            key={g.name}
            onClick={() => setSelectedGroup(g.name)}
            style={{
              padding: '8px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: selectedGroup === g.name ? '#e6f4ff' : 'transparent',
              borderLeft: selectedGroup === g.name ? `3px solid ${PRIMARY}` : '3px solid transparent',
              transition: 'all 0.2s',
            }}
          >
            <Text style={{ flex: 1 }}>{g.name}</Text>
            <Space size={2}>
              <Tag>{groupCounts.counts[g.name] || 0}</Tag>
              <EditOutlined style={{ fontSize: 12, color: '#999', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleEditGroup(g.name); }} />
              <DeleteOutlined style={{ fontSize: 12, color: '#ff4d4f', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.name); }} />
            </Space>
          </div>
        ))}
        <div
          onClick={() => setSelectedGroup('__ungrouped__')}
          style={{
            padding: '8px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
            background: selectedGroup === '__ungrouped__' ? '#e6f4ff' : 'transparent',
            borderLeft: selectedGroup === '__ungrouped__' ? `3px solid ${PRIMARY}` : '3px solid transparent',
            transition: 'all 0.2s',
            borderTop: '1px solid #f0f0f0', marginTop: 4, paddingTop: 12,
          }}
        >
          <Text type="secondary">未指定分组</Text>
          <Tag>{groupCounts.ungrouped}</Tag>
        </div>
      </Card>

      {/* ========== 右侧主内容区 ========== */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>账号管理</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              管理系统账号，新建子账号并分配权限
            </Text>
          </div>
        </div>
        <Space>
          <Button ghost icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
          <Button ghost icon={<DownloadOutlined />} onClick={handleImportTemplate}>导入模板</Button>
          <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={handleImportFile}>
            <Button ghost icon={<UploadOutlined />}>导入账号</Button>
          </Upload>
          <Button type="primary" ghost icon={<UserAddOutlined />} onClick={handleAdd}>
            新建子账号
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="总账号数"
              value={stats.totalAccounts}
              prefix={<TeamOutlined style={{ fontSize: 20, color: PRIMARY }} />}
              valueStyle={{ color: '#1a2b45', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="启用账号"
              value={stats.activeAccounts}
              prefix={<CheckCircleOutlined style={{ fontSize: 20, color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="子账号数"
              value={stats.subAccounts}
              prefix={<UserAddOutlined style={{ fontSize: 20, color: '#1890ff' }} />}
              valueStyle={{ color: '#1890ff', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="今日操作记录"
              value={stats.todayLogs}
              prefix={<SettingOutlined style={{ fontSize: 20, color: '#faad14' }} />}
              suffix="条"
              valueStyle={{ color: '#faad14', fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 搜索筛选工具栏 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} sm={6}>
            <Input
              placeholder="搜索账号ID / 用户名 / 姓名"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="账号状态"
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v || '')}
              allowClear
              style={{ width: '100%' }}
            >
              <Option value="normal">正常</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="角色筛选"
              value={roleFilter || undefined}
              onChange={v => setRoleFilter(v || '')}
              allowClear
              style={{ width: '100%' }}
            >
              {roleOptions.map(opt => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={4}>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>查询</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            </Space>
          </Col>
          <Col xs={0} sm={6} style={{ textAlign: 'right' }}>
            <Space>
              <Button icon={<SafetyCertificateOutlined />} onClick={handleViewLogs}>登录日志</Button>
              <Dropdown menu={{ items: batchMenuItems, onClick: handleBatchAction }}>
                <Button icon={<SettingOutlined />}>批量操作</Button>
              </Dropdown>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 数据表格 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
            getCheckboxProps: (record) => ({
              disabled: record.accountType === '主账号',
            }),
          }}
          columns={columns}
          dataSource={filteredData}
          scroll={{ x: 1400 }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
          }}
          locale={{ emptyText: '暂无账号数据' }}
        />
      </Card>

      {/* 详情抽屉 */}
      <Drawer
        title={
          <Space>
            <UserOutlined style={{ color: PRIMARY }} />
            <span>账号详情</span>
          </Space>
        }
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        width={520}
        placement="right"
        extra={
          selectedRecord && (
            <Space>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => {
                  setDetailVisible(false);
                  handleEdit(selectedRecord);
                }}
              >
                编辑
              </Button>
            </Space>
          )
        }
      >
        {selectedRecord && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
                background: `linear-gradient(135deg, ${PRIMARY}, #4a90d9)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <UserOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <Title level={5} style={{ margin: 0 }}>{selectedRecord.displayName}</Title>
              <Text type="secondary">@{selectedRecord.username}</Text>
            </div>
            <Descriptions column={2} bordered size="small" labelStyle={{ fontWeight: 500 }}>
              <Descriptions.Item label="账号ID">{selectedRecord.id}</Descriptions.Item>
              <Descriptions.Item label="用户名">{selectedRecord.username}</Descriptions.Item>
              <Descriptions.Item label="姓名">{selectedRecord.displayName}</Descriptions.Item>
              <Descriptions.Item label="账号类型">
                <Tag color={selectedRecord.accountType === '主账号' ? 'gold' : 'blue'}>{selectedRecord.accountType}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="权限角色">
                {(selectedRecord.roles || []).length > 0
                  ? (selectedRecord.roles || []).map(r => (
                      <Tag key={r} color={r === '全部权限' ? 'gold' : r === '生产管理' ? 'blue' : r === '销售管理' ? 'green' : r === '财务管理' ? 'purple' : r === '采购管理' ? 'cyan' : 'default'}>{r}</Tag>
                    ))
                  : <Tag color={roleColorMap[selectedRecord.role] || 'default'}>
                      {roleLabelMap[selectedRecord.role] || selectedRecord.role}
                    </Tag>
                }
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge status={selectedRecord.status === 'normal' ? 'success' : 'error'}
                  text={selectedRecord.status === 'normal' ? '正常' : '禁用'} />
              </Descriptions.Item>
              <Descriptions.Item label="所属部门">{selectedRecord.group || '无'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{selectedRecord.date}</Descriptions.Item>
              <Descriptions.Item label="最近登录" span={2}>
                {selectedRecord.lastLogin === '-' ? '从未登录' : selectedRecord.lastLogin}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{selectedRecord.remark || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>

      {/* 编辑账号模态框 */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: PRIMARY }} />
            <span>编辑账号 - {selectedRecord?.displayName}</span>
          </Space>
        }
        open={editVisible}
        onCancel={() => { setEditVisible(false); updateEditPerms([]); editForm.resetFields(); }}
        onOk={handleEditConfirm}
        okText="保存修改"
        cancelText="取消"
        width={780}
      >
        <Form autoComplete="off" form={editForm} layout="vertical" scrollToFirstError style={{ marginTop: 16 }}
          onValuesChange={(changedValues) => {
            // 仅当用户手动更改角色时，合并新角色权限到独立权限）
            if (changedValues.roles) {
              const newRoles: string[] = changedValues.roles || [];
              if (newRoles.length > 0) {
                const newRolePerms = getMergedPermissions(newRoles);
                const current = editPermsRef.current;
                const existing = new Set(current);
                const toAdd = newRolePerms.filter(p => !existing.has(p));
                if (toAdd.length > 0) {
                  updateEditPerms(current.concat(toAdd));
                }
              }
            }
          }}
        >
          <Form.Item name="displayName" label={selectedRecord?.accountType === '主账号' ? '姓名（注册联系人，不可修改）' : '姓名'} rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" prefix={<UserOutlined />} disabled={selectedRecord?.accountType === '主账号'} />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号码"
            tooltip="选填；填写后该子账号可用手机号登录。若同一手机号同时绑定多个租户或多个子账号，手机号登录将被禁用，须使用用户名登录"
            rules={[
              { pattern: /^1[3-9]\d{9}$/, message: '请输入 11 位有效手机号）' },
            ]}
          >
            <Input placeholder="请输入手机号码（选填，可用于登录）" prefix={<MobileOutlined />} allowClear />
          </Form.Item>
          <Form.Item name="roles" label="权限角色" rules={[{ required: true, message: '请至少选择一个角色' }]}>
            <Select mode="multiple" placeholder="请选择角色（可多选）" allowClear>
              {getAllRoles().map(r => (
                <Option key={r.key} value={r.name}>{r.name}{r.isPreset ? ' (预设)' : ''}</Option>
              ))}
            </Select>
          </Form.Item>
          {/* 权限配置（单一区域）：左侧菜单复选框=菜单级授权（角色预设基础上追加），右侧三态=按键/字段细粒度覆写 */}
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              菜单前复选框＝该账号是否拥有此菜单：供应商菜单在角色预设基础上追加；采购商/加工厂平台菜单默认开放，取消勾选＝对该账号隐藏（写入禁止覆写）；右侧允许/禁止/继承为按键与字段的细粒度覆写（最高优先级）
            </Text>
            <div style={{ padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #d9d9d9' }}>
              <PermEditor scopes={['supplier', 'purchaser', 'factory']} value={overrideDraft} onChange={setOverrideDraft}
                pageChecks={editPerms} onPageChecksChange={updateEditPerms} />
            </div>
          </div>
          <Form.Item name="group" label="所属部门">
            <Select placeholder="请选择部门（可选）" allowClear>
              {groups.map(g => (
                <Option key={g.name} value={g.name}>{g.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注信息" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          <Space>
            <UserAddOutlined style={{ color: '#52c41a' }} />
            <span>新建子账号</span>
          </Space>
        }
        open={addVisible}
        onCancel={() => { setAddVisible(false); addForm.resetFields(); }}
        onOk={handleAddConfirm}
        okText="创建账号"
        cancelText="取消"
        width={560}
      >
        <div style={{
          background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8,
          padding: '10px 16px', marginBottom: 20, marginTop: 8,
        }}>
          <InfoCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
          <Text style={{ color: '#389e0d', fontSize: 13 }}>
            创建成功后，系统将自动生成初始密码，请提醒用户首次登录后修改密码
          </Text>
        </div>
        <Form autoComplete="off" form={addForm} layout="vertical" scrollToFirstError
          onValuesChange={(changedValues) => {
            if (changedValues.roles) {
              const newRoles: string[] = changedValues.roles || [];
              if (newRoles.length > 0) {
                const newRolePerms = getMergedPermissions(newRoles);
                const current = addPermsRef.current;
                const existing = new Set(current);
                const toAdd = newRolePerms.filter(p => !existing.has(p));
                if (toAdd.length > 0) {
                  updateAddPerms(current.concat(toAdd));
                }
              }
            }
            if (changedValues.group !== undefined) {
              // 选择所属部门后自动继承部门权限（切换部门时移除上次自动继承的部门权限）
              const grpName: string = changedValues.group || '';
              const newGroupPerms = groups.find(g => g.name === grpName)?.permissions || [];
              const prevSet = new Set(addGroupPermsRef.current);
              const kept = addPermsRef.current.filter(p => !prevSet.has(p));
              addGroupPermsRef.current = newGroupPerms;
              updateAddPerms(Array.from(new Set([...kept, ...newGroupPerms])));
            }
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="username"
                label="用户名"
                rules={[
                  { required: true, message: '请输入用户名' },
                  { pattern: /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/, message: '字母开头，4-20位字母数字下划线' },
                ]}
              >
                <Input placeholder="请输入用户名" prefix={<UserOutlined />} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="displayName"
                label="姓名"
                rules={[{ required: true, message: '请输入姓名' }]}
              >
                <Input placeholder="请输入姓名" prefix={<UserOutlined />} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="password"
                label="初始密码"
                rules={[
                  { required: true, message: '请设置初始密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value) return Promise.resolve();
                      const r = validatePassword(String(value), { username: String(getFieldValue('username') || '') });
                      return r.ok ? Promise.resolve() : Promise.reject(new Error(r.message));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="请设置初始密码（至少10位，12位以下需含字母+数字）" prefix={<LockOutlined />} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="confirmPassword"
                label="确认密码"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请确认密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="请再次输入密码" prefix={<LockOutlined />} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="phone"
                label="手机号码"
                tooltip="必填；用于新设备登录验证码接收与手机号登录。若同一手机号同时绑定多个租户或多个子账号，手机号登录将被禁用，须使用用户名登录"
                rules={[
                  { required: true, message: '请输入手机号码' },
                  { pattern: /^1[3-9]\d{9}$/, message: '请输入 11 位有效手机号）' },
                ]}
              >
                <Input placeholder="请输入手机号码（必填，用于登录验证码）" prefix={<MobileOutlined />} allowClear />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="roles" label="权限角色">
                <Select mode="multiple" placeholder="请选择角色（可多选，可选）" allowClear>
                  {getAllRoles().map(r => (
                    <Option key={r.key} value={r.name}>{r.name}{r.isPreset ? ' (预设)' : ''}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="group" label="所属部门" rules={[{ required: true, message: '请选择所属部门' }]}>
                <Select placeholder="请选择部门（自动继承部门权限）" allowClear>
                  {groups.map(g => (
                    <Option key={g.name} value={g.name}>{g.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          {/* 独立权限分配 */}
          <div style={{ marginBottom: 16 }}>
            <Button
              type="link"
              icon={addPermExpanded ? <LockOutlined /> : <SettingOutlined />}
              onClick={() => setAddPermExpanded(!addPermExpanded)}
              style={{ paddingLeft: 0, color: addPermExpanded ? PRIMARY : '#666' }}
            >
              {addPermExpanded ? '收起权限配置' : '展开独立权限配置'}
            </Button>
            {addPermExpanded && (
              <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #d9d9d9', maxHeight: 300, overflowY: 'auto' }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  此处设置的权限将在角色权限基础上额外追加，仅对此子账号生效
                </Text>
                <CustomPermSelector value={addPerms} onChange={updateAddPerms} roles={addWatchedRoles} />
              </div>
            )}
          </div>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="请输入备注信息（选填）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码模态框 */}
      <Modal
        title={
          <Space>
            <KeyOutlined style={{ color: '#faad14' }} />
            <span>重置密码 - {pwdAccount?.displayName}</span>
          </Space>
        }
        open={pwdVisible}
        onCancel={() => { setPwdVisible(false); pwdForm.resetFields(); }}
        onOk={handlePwdConfirm}
        okText="确认重置"
        cancelText="取消"
        width={450}
      >
        <div style={{
          background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8,
          padding: '10px 16px', marginBottom: 20, marginTop: 8,
        }}>
          <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
          <Text style={{ color: '#ad6800', fontSize: 13 }}>
            重置密码后，用户需使用新密码重新登录
          </Text>
        </div>
        <Form autoComplete="off" form={pwdForm} layout="vertical">
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value) return Promise.resolve();
                  const r = validatePassword(String(value), { username: pwdAccount?.username });
                  return r.ok ? Promise.resolve() : Promise.reject(new Error(r.message));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请输入新密码（至少10位，12位以下需含字母+数字）" prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" prefix={<LockOutlined />} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 登录日志弹窗 */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: PRIMARY }} />
            <span>登录日志（最近 100条）</span>
          </Space>
        }
        open={logVisible}
        onCancel={() => setLogVisible(false)}
        footer={<Button onClick={() => setLogVisible(false)}>关闭</Button>}
        width={700}
      >
        <div style={{ marginBottom: 12, textAlign: 'right' }}>
          <Button size="small" danger onClick={handleClearLogs} icon={<DeleteOutlined />}>清除日志</Button>
        </div>
        <Table
          dataSource={loginLogs}
          rowKey={(_, i) => String(i)}
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '时间', dataIndex: 'time', key: 'time', width: 160 },
            { title: '账号', dataIndex: 'username', key: 'username', width: 120 },
            {
              title: '结果', dataIndex: 'success', key: 'success', width: 80,
              render: (v: boolean) => v
                ? <Tag color="success">成功</Tag>
                : <Tag color="error">失败</Tag>,
            },
            { title: '详情', dataIndex: 'detail', key: 'detail' },
          ]}
          locale={{ emptyText: '暂无登录日志' }}
        />
      </Modal>

      {/* ========== 分组管理弹窗 ========== */}
      <Modal
        title={editingGroup ? '编辑分组' : '新建分组'}
        open={groupModalVisible}
        onCancel={() => { setGroupModalVisible(false); groupForm.resetFields(); setGroupPerms([]); }}
        onOk={handleGroupModalOk}
        okText={editingGroup ? '保存' : '创建'}
        cancelText="取消"
        width={980}
      >
        <Form autoComplete="off" form={groupForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="例如：仓库、客服、运营" maxLength={20} />
          </Form.Item>
        </Form>

        {/* 组权限配置（与个人覆写同款三态编辑器：左菜单右明细，菜单/按键/字段查看编辑） */}
        <div style={{
          padding: 12, background: '#f0f5ff', borderRadius: 8,
          border: '1px solid #adc6ff', marginBottom: 16,
        }}>
          <Text strong style={{ fontSize: 13, color: PRIMARY }}>
            <SafetyCertificateOutlined style={{ marginRight: 6 }} />
            分组权限配置
          </Text>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 12 }}>
            左侧菜单前复选框：勾选=组内成员拥有该页面权限，取消勾选=隐藏该页面（分组头复选框可整组切换）；
            点击菜单后右侧配置该菜单的进入/按键/字段（查看/编辑）权限；组权限低于个人显式覆写、高于角色层；组内成员自动生效。
          </div>
          <PermEditor scopes={['supplier', 'purchaser', 'factory']} value={groupPermDraft} onChange={setGroupPermDraft} menuCheckTri />
        </div>
      </Modal>

      {/* 账号导入预览弹窗 */}
      <Modal
        title={<Space><UploadOutlined style={{ color: '#1890ff' }} /><span>账号导入预览</span></Space>}
        open={importVisible}
        onCancel={() => { setImportVisible(false); setImportRows([]); }}
        onOk={handleImportConfirm}
        okText="确认导入"
        cancelText="取消"
        okButtonProps={{ disabled: !importRows.length || importRows.some(r => r.error) }}
        width={880}
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="所属分组、用户名、姓名为必填项；账号权限自动继承所属分组权限；导入账号首次登录必须修改密码"
          description={groups.length ? undefined : '当前尚无分组，请先在分组管理中创建分组后再导入'}
        />
        <Table size="small" bordered rowKey="rowNo" pagination={false} scroll={{ y: 320 }}
          columns={[
            { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 60 },
            { title: '所属分组', dataIndex: 'group', key: 'group', width: 110, render: (v: string) => v || <Text type="danger">缺失</Text> },
            { title: '用户名', dataIndex: 'username', key: 'username', width: 140 },
            { title: '姓名*', dataIndex: 'displayName', key: 'displayName', width: 100 },
            { title: '初始密码', key: 'password', width: 90, render: () => '••••••' },
            { title: '继承权限数', key: 'permCount', width: 90, render: (_: any, r: ImportAccountRow) => r.error ? '-' : `${(groups.find(g => g.name === r.group)?.permissions || []).length} 项` },
            { title: '校验结果', key: 'error', render: (_: any, r: ImportAccountRow) => r.error ? <Text type="danger">{r.error}</Text> : <Tag color="green">通过</Tag> },
          ]}
          dataSource={importRows}
          locale={{ emptyText: '暂无数据' }}
        />
      </Modal>

      </div>{/* 关闭右侧主内容区 */}
    </div>
  );
};

export default AccountManage;
