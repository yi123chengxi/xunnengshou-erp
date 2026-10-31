import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Card, Row, Col, Typography, Statistic, Table, Input, Select, Button,
  Space, Tag, message, Modal, Form, Drawer, Descriptions, Dropdown,
  Popconfirm, DatePicker, Badge, Tooltip, Checkbox, Divider, Upload, Alert,
} from 'antd';
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
import { loadUserPermOverrides, saveUserPermOverrides, setPreviewUser } from '../utils/perm';
import type { PermTri } from '../config/permRegistry';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const PRIMARY = '#1e4a7e';

// 瑙ｆ瀽鐪熸鐨勬暟鎹綊灞炶处鍙凤紙娌?parentAccount 閾捐拷婧埌涓昏处鍙凤級
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

// 璐﹀彿鏁版嵁 localStorage 鎸佷箙鍖?key锛堟寜涓昏处鍙烽殧绂伙紝瀛愯处鍙峰叡浜富璐﹀彿鏁版嵁锛?
const getAccountsStorageKey = () => 'accounts_' + resolveDataOwner();

// 浠?localStorage 鍔犺浇璐﹀彿鏁版嵁锛屾棤鏁版嵁鏃剁敤鍒濆妯℃嫙鏁版嵁
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
  roles: string[]; // 澶氳鑹叉暟缁?
  customPermissions?: string[]; // 鐙珛鍒嗛厤鐨勬潈闄?
  accountType: string;
  status: string;
  date: string;
  lastLogin: string;
  remark: string;
  person: string;
  notificationBlocked?: boolean; // 灞忚斀寮圭獥閫氱煡
  group?: string; // 鎵€灞為儴闂紙鍘熲€滃垎缁勨€濓級
  phone?: string; // 鎵嬫満鍙风爜锛堝彲鐢ㄤ簬鐧诲綍锛涘悓鍙峰璐﹀彿鏃剁鐢ㄦ墜鏈哄彿鐧诲綍锛?
}

// 鍒嗙粍鏁版嵁鎸佷箙鍖?
export interface GroupRecord {
  name: string;
  permissions: string[]; // 缁勬潈闄愬垪琛紙涓庝釜浜烘潈闄愬彔鍔狅級
}

// 璐﹀彿瀵煎叆琛岋紙棰勮鏍￠獙缁撴灉锛?
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
      // 鍚戝悗鍏煎锛氭棫鏁版嵁涓?string[]锛岃縼绉讳负 GroupRecord[]
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


// 鍒濆璐﹀彿鏁版嵁锛堜粎淇濈暀涓昏处鍙凤紝瀛愯处鍙风敱绠＄悊鍛樻墜鍔ㄥ垱寤猴級
const initialAccounts: AccountRecord[] = [
  { key: '1', id: 'ACC-001', username: 'admin', displayName: '绯荤粺绠＄悊鍛?, role: 'super_admin', roles: [], accountType: '涓昏处鍙?, status: 'normal', date: '2024-01-01', lastLogin: '2024-06-26', remark: '绯荤粺瓒呯骇绠＄悊鍛?, person: '绠＄悊鍛? },
];

const roleOptions = [
  { label: '瓒呯骇绠＄悊鍛?, value: 'super_admin' },
  { label: '绠＄悊鍛?, value: 'admin' },
  { label: '鏅€氱敤鎴?, value: 'user' },
  { label: '鍙鐢ㄦ埛', value: 'viewer' },
];


const roleColorMap: Record<string, string> = {
  super_admin: 'red',
  admin: 'blue',
  user: 'green',
  viewer: 'default',
};

const roleLabelMap: Record<string, string> = {
  super_admin: '瓒呯骇绠＄悊鍛?,
  admin: '绠＄悊鍛?,
  user: '鏅€氱敤鎴?,
  viewer: '鍙鐢ㄦ埛',
};

// 鐙珛鏉冮檺閫夋嫨鍣ㄧ粍浠讹紙鏈€楂樻潈闄愮紪杈戯紝鍙帶鍒舵墍鏈夋潈闄愰」鍖呮嫭瑙掕壊棰勮锛?
const CustomPermSelector: React.FC<{
  value: string[];
  onChange: (perms: string[]) => void;
  roles: string[];
}> = ({ value, onChange, roles }) => {


  // 鐢?ref 璺熻釜鏈€鏂?value锛岄伩鍏嶉棴鍖呴棶棰?
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
      <Form.Item label="鐙珛鏉冮檺閰嶇疆" style={{ marginBottom: 0 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          <SafetyCertificateOutlined style={{ marginRight: 4, color: '#1677ff' }} />
          姝ゅ閰嶇疆鍏锋湁鏈€楂樹紭鍏堢骇锛屽彲瑕嗙洊瑙掕壊棰勮鏉冮檺
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
              <Tag color="blue" style={{ marginLeft: 6 }}>{modPerms.length}椤?/Tag>
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
                      {isFromRole && <Tag color="processing" style={{ fontSize: 10, marginLeft: 4, lineHeight: '16px', padding: '0 4px' }}>棰勮</Tag>}
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

  // 鍒嗙粍绠＄悊
  const [groups, setGroups] = useState<GroupRecord[]>(loadGroups);
  const [selectedGroup, setSelectedGroup] = useState<string>(''); // '' = 鍏ㄩ儴
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupForm] = Form.useForm();
  const [editingGroup, setEditingGroup] = useState<string>(''); // 缂栬緫涓殑鏃у垎缁勫悕
  const [groupPerms, setGroupPerms] = useState<string[]>([]); // 褰撳墠缂栬緫鍒嗙粍鐨勬潈闄?

  // 鐧诲綍鏃ュ織寮圭獥
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
      title: '纭娓呴櫎',
      content: '纭畾瑕佹竻闄ゆ墍鏈夌櫥褰曟棩蹇楀悧锛?,
      okText: '纭畾',
      cancelText: '鍙栨秷',
      onOk: () => {
        localStorage.removeItem('login_audit_log');
        setLoginLogs([]);
        message.success('鐧诲綍鏃ュ織宸叉竻闄?);
      },
    });
  }, []);

  // 璇︽儏鎶藉眽
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AccountRecord | null>(null);

  // 缂栬緫妯℃€佹
  const [editVisible, setEditVisible] = useState(false);
  const [editForm] = Form.useForm();

  // 鏂板瀛愯处鍙锋ā鎬佹
  const [addVisible, setAddVisible] = useState(false);
  const [addForm] = Form.useForm();

  // 閲嶇疆瀵嗙爜妯℃€佹
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdForm] = Form.useForm();
  const [pwdAccount, setPwdAccount] = useState<AccountRecord | null>(null);

  // 鏉冮檺灞曞紑鐘舵€?
  const [editPermExpanded, setEditPermExpanded] = useState(false);
  const [addPermExpanded, setAddPermExpanded] = useState(false);
  // PERM_V2 涓汉涓夋€佽鍐欒崏绋?
  const [overrideDraft, setOverrideDraft] = useState<Record<string, PermTri>>({});
  const [overrideExpanded, setOverrideExpanded] = useState(false);

  // 鏉冮檺鏁版嵁锛堝畬鍏ㄧ敱缁勪欢鐘舵€佺鐞嗭紝涓嶄緷璧?Form锛?
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const editPermsRef = React.useRef<string[]>([]);
  const [addPerms, setAddPerms] = useState<string[]>([]);
  const addPermsRef = React.useRef<string[]>([]);
  const addGroupPermsRef = React.useRef<string[]>([]); // 鏂板缓绐楄嚜鍔ㄧ户鎵跨殑閮ㄩ棬鏉冮檺蹇収锛堝垏鎹㈤儴闂ㄦ椂鏇挎崲锛?

  // 浣跨敤 Form.useWatch 鑾峰彇褰撳墠瑙掕壊锛堢敤浜庝紶閫掔粰鏉冮檺閫夋嫨鍣級
  const editWatchedRoles: string[] = Form.useWatch('roles', editForm) || [];
  const addWatchedRoles: string[] = Form.useWatch('roles', addForm) || [];

  // 鍚屾 ref 鍜?state
  const updateEditPerms = (perms: string[]) => {

    editPermsRef.current = perms;
    setEditPerms(perms);
  };
  const updateAddPerms = (perms: string[]) => {
    addPermsRef.current = perms;
    setAddPerms(perms);
  };

  // 鏁版嵁缁熻
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
      subAccounts: dataSource.filter(a => a.accountType === '瀛愯处鍙?).length,
      todayLogs,
    };
  }, [dataSource]);

  // 鏁版嵁鍙樺寲鏃惰嚜鍔ㄦ寔涔呭寲鍒?localStorage
  useEffect(() => {
    localStorage.setItem(getAccountsStorageKey(), JSON.stringify(dataSource));
  }, [dataSource]);

  // 鑷姩淇锛氭壂鎻?registeredUsers锛屼慨姝ｆ墍鏈夊瓙璐﹀彿鐨?parentAccount 鎸囧悜鐪熸鐨勪富璐﹀彿
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
        localStorage.setItem('registeredUsers', JSON.stringify(regUsers));
      }
    } catch { /* ignore */ }
  // eslint-disable-line
  }, []);

  // 绛涢€夊悗鐨勬暟鎹?
  const filteredData = useMemo(() => {
    return dataSource.filter(item => {
      const matchSearch = !searchText ||
        item.username.toLowerCase().includes(searchText.toLowerCase()) ||
        item.displayName.includes(searchText) ||
        item.id.toLowerCase().includes(searchText.toLowerCase());
      const matchStatus = !statusFilter || item.status === statusFilter;
      const matchRole = !roleFilter || item.role === roleFilter;
      // 鍒嗙粍绛涢€夛細'' = 鍏ㄩ儴锛?__ungrouped__' = 鏈寚瀹氬垎缁勶紝鍏朵粬 = 鍖归厤鍒嗙粍鍚?
      const matchGroup = !selectedGroup
        ? true
        : selectedGroup === '__ungrouped__'
          ? !item.group || item.group === ''
          : item.group === selectedGroup;
      return matchSearch && matchStatus && matchRole && matchGroup;
    });
  }, [dataSource, searchText, statusFilter, roleFilter, selectedGroup]);

  // 鏌ョ湅璇︽儏
  const handleView = useCallback((record: AccountRecord) => {
    setSelectedRecord(record);
    setDetailVisible(true);
  }, []);

  // 缂栬緫璐﹀彿
  const handleEdit = useCallback((record: AccountRecord) => {
    setSelectedRecord(record);
    // 濡傛灉 customPermissions 涓虹┖浣嗘湁瑙掕壊锛屽悎骞惰鑹叉潈闄愪綔涓哄垵濮嬪€?
    let initPerms = record.customPermissions || [];

    if (initPerms.length === 0 && record.roles && record.roles.length > 0) {
      initPerms = getMergedPermissions(record.roles);

    }
    editForm.setFieldsValue({
      displayName: record.displayName,
      roles: record.roles || [],
      remark: record.remark,
    });
    updateEditPerms(initPerms);
    setOverrideDraft(loadUserPermOverrides(record.username));

    // 濡傛灉璐﹀彿鏈夋潈闄愶紝鑷姩灞曞紑鏉冮檺閰嶇疆
    if (initPerms.length > 0) {
      setEditPermExpanded(true);
    }
    setEditVisible(true);
  }, [editForm]);

  const handleEditConfirm = useCallback(() => {
    editForm.validateFields().then(values => {


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
              }
            : item
        );
        // 鍚屾鏇存柊 registeredUsers 涓殑瑙掕壊鍜屾潈闄?
        try {
          const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const idx = regUsers.findIndex((u: any) => u.username === selectedRecord?.username);
          if (idx >= 0) {
            regUsers[idx].roles = values.roles || [];
            regUsers[idx].customPermissions = editPermsRef.current;
            localStorage.setItem('registeredUsers', JSON.stringify(regUsers));
          }
        } catch { /* ignore */ }
        return updated;
      });
      if (selectedRecord) saveUserPermOverrides(selectedRecord.username, overrideDraft);
      message.success('璐﹀彿淇℃伅鏇存柊鎴愬姛');
      setEditVisible(false);
      setEditPermExpanded(false);
      setOverrideExpanded(false);
      updateEditPerms([]);
      editForm.resetFields();
    }).catch(() => { /* 鏍￠獙澶辫触锛氳〃鍗曡鍐呮彁绀哄苟婊氬姩鍒伴涓敊璇」锛屼笉鎶涙湭澶勭悊寮傚父 */ });
  }, [editForm, selectedRecord, overrideDraft]);

  // 鍒犻櫎璐﹀彿
  const handleDelete = useCallback((record: AccountRecord) => {
    if (record.accountType === '涓昏处鍙?) {
      message.warning('涓昏处鍙蜂笉鍙垹闄?);
      return;
    }
    const currentUser = localStorage.getItem('username') || '';
    if (record.username === currentUser) {
      message.warning('涓嶈兘鍒犻櫎褰撳墠鐧诲綍鐨勮处鍙?);
      return;
    }
    setDataSource(prev => prev.filter(item => item.key !== record.key));
    // 鍚屾浠?registeredUsers 涓Щ闄よ瀛愯处鍙凤紝浣垮叾鏃犳硶鍐嶇櫥褰?
    try {
      const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const updated = regUsers.filter((u: any) => u.username !== record.username);
      localStorage.setItem('registeredUsers', JSON.stringify(updated));
    } catch { /* ignore */ }
    message.success(`璐﹀彿 ${record.displayName} 宸插垹闄);
  }, []);

  // 鍚敤/绂佺敤璐﹀彿
  const handleToggleStatus = useCallback((record: AccountRecord) => {
    if (record.accountType === '涓昏处鍙?) {
      message.warning('涓昏处鍙蜂笉鍙鐢?);
      return;
    }
    const currentUser = localStorage.getItem('username') || '';
    if (record.username === currentUser) {
      message.warning('涓嶈兘绂佺敤褰撳墠鐧诲綍鐨勮处鍙?);
      return;
    }
    const newStatus = record.status === 'normal' ? 'disabled' : 'normal';
    setDataSource(prev =>
      prev.map(item =>
        item.key === record.key ? { ...item, status: newStatus } : item
      )
    );
    // 鍚屾鏇存柊 registeredUsers 涓殑璐﹀彿鐘舵€侊紝绂佺敤鍚庢棤娉曠櫥褰?
    try {
      const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const idx = regUsers.findIndex((u: any) => u.username === record.username);
      if (idx >= 0) {
        regUsers[idx].accountStatus = newStatus;
        localStorage.setItem('registeredUsers', JSON.stringify(regUsers));
      }
    } catch { /* ignore */ }
    message.success(newStatus === 'normal' ? `璐﹀彿 ${record.displayName} 宸插惎鐢╜ : `璐﹀彿 ${record.displayName} 宸茬鐢╜);
  }, []);

  // 鍒囨崲灞忚斀寮圭獥鐘舵€?
  const handleToggleNotificationBlock = useCallback((record: AccountRecord) => {
    const newVal = !record.notificationBlocked;
    setDataSource(prev =>
      prev.map(item =>
        item.key === record.key ? { ...item, notificationBlocked: newVal } : item
      )
    );
    message.success(`璐﹀彿 ${record.displayName} ${newVal ? '宸插睆钄? : '宸插彇娑堝睆钄?}寮圭獥閫氱煡`);
  }, []);

  // ========== 鍒嗙粍绠＄悊 ==========
  const handleAddGroup = useCallback(() => {
    setEditingGroup('');
    setGroupPerms([]);
    groupForm.resetFields();
    setGroupModalVisible(true);
  }, [groupForm]);

  const handleEditGroup = useCallback((name: string) => {
    setEditingGroup(name);
    const grp = groups.find(g => g.name === name);
    setGroupPerms(grp?.permissions || []);
    groupForm.setFieldsValue({ name });
    setGroupModalVisible(true);
  }, [groupForm, groups]);

  const handleDeleteGroup = useCallback((name: string) => {
    Modal.confirm({
      title: `纭鍒犻櫎鍒嗙粍銆?{name}銆嶏紵`,
      content: '鍒犻櫎鍚庤鍒嗙粍涓嬬殑璐﹀彿灏嗗彉涓衡€滄湭鎸囧畾鍒嗙粍鈥?,
      okText: '纭鍒犻櫎', okType: 'danger', cancelText: '鍙栨秷',
      onOk: () => {
        const newGroups = groups.filter(g => g.name !== name);
        setGroups(newGroups); saveGroups(newGroups);
        // 娓呴櫎璐﹀彿涓殑鍒嗙粍鏍囪
        setDataSource(prev => prev.map(item =>
          item.group === name ? { ...item, group: '' } : item
        ));
        if (selectedGroup === name) setSelectedGroup('');
        message.success(`鍒嗙粍銆?{name}銆嶅凡鍒犻櫎`);
      },
    });
  }, [groups, selectedGroup]);

  const handleGroupModalOk = useCallback(() => {
    groupForm.validateFields().then(values => {
      const newName = values.name.trim();
      if (!newName) return;
      if (editingGroup) {
        // 缂栬緫妯″紡锛氶噸鍛藉悕鍒嗙粍
        if (newName !== editingGroup && groups.some(g => g.name === newName)) {
          message.warning('璇ュ垎缁勫悕绉板凡瀛樺湪'); return;
        }
        const newGroups = groups.map(g =>
          g.name === editingGroup ? { name: newName, permissions: groupPerms } : g
        );
        setGroups(newGroups); saveGroups(newGroups);
        setDataSource(prev => prev.map(item =>
          item.group === editingGroup ? { ...item, group: newName } : item
        ));
        if (selectedGroup === editingGroup) setSelectedGroup(newName);
        message.success(`鍒嗙粍銆?{newName}銆嶅凡淇濆瓨`);
      } else {
        // 鏂板妯″紡
        if (groups.some(g => g.name === newName)) {
          message.warning('璇ュ垎缁勫悕绉板凡瀛樺湪'); return;
        }
        const newGroups = [...groups, { name: newName, permissions: groupPerms }];
        setGroups(newGroups); saveGroups(newGroups);
        message.success(`鍒嗙粍銆?{newName}銆嶅凡鍒涘缓`);
      }
      setGroupModalVisible(false); groupForm.resetFields(); setGroupPerms([]);
    }).catch(() => { /* 鏍￠獙澶辫触锛氳〃鍗曡鍐呮彁绀?*/ });
  }, [editingGroup, groups, selectedGroup, groupForm, groupPerms]);

  // 閲嶇疆瀵嗙爜
  const handleResetPwd = useCallback((record: AccountRecord) => {
    setPwdAccount(record);
    pwdForm.resetFields();
    setPwdVisible(true);
  }, [pwdForm]);

  const handlePwdConfirm = useCallback(() => {
    pwdForm.validateFields().then(values => {
      // 鍚屾鏇存柊 registeredUsers 涓殑瀵嗙爜
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
            localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));
          }
        } catch { /* ignore */ }
      }
      message.success(`璐﹀彿 ${pwdAccount?.displayName} 鐨勫瘑鐮佸凡閲嶇疆`);
      setPwdVisible(false);
      pwdForm.resetFields();
    }).catch(() => { /* 鏍￠獙澶辫触锛氳〃鍗曡鍐呮彁绀?*/ });
  }, [pwdForm, pwdAccount]);

  // 鏂板缓瀛愯处鍙?
  const handleAdd = useCallback(() => {
    addForm.resetFields();
    updateAddPerms([]);
    addGroupPermsRef.current = [];
    setAddVisible(true);
  }, [addForm]);

  const handleAddConfirm = useCallback(() => {
    addForm.validateFields().then(values => {
      // 鏍￠獙鐢ㄦ埛鍚嶆槸鍚﹀凡瀛樺湪锛堝瓙璐﹀彿鍒楄〃 + 宸叉敞鍐岃处鍙凤級
      const inputUsername = values.username.trim();
      const existsInList = dataSource.some(
        (a) => a.username.toLowerCase() === inputUsername.toLowerCase()
      );
      if (existsInList) {
        message.error(`鐢ㄦ埛鍚嶃€?{inputUsername}銆嶅凡瀛樺湪锛岃鎹竴涓敤鎴峰悕`);
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
          message.error(`鐢ㄦ埛鍚嶃€?{inputUsername}銆嶅凡琚敞鍐岋紝璇锋崲涓€涓敤鎴峰悕`);
          return;
        }
      } catch { /* ignore */ }

      // 鎵嬫満鍙风爜锛氭牸寮忔牎楠?+ 鍚屽彿澶氳处鍙锋彁绀猴紙鍚屽彿骞跺瓨鏃舵墜鏈哄彿鐧诲綍灏嗚绂佺敤锛?
      const inputPhone = String(values.phone || '').trim();
      if (inputPhone && !/^1[3-9]\d{9}$/.test(inputPhone)) {
        message.error('鎵嬫満鍙风爜鏍煎紡涓嶆纭紙椤讳负 11 浣嶆湁鏁堟墜鏈哄彿锛?);
        return;
      }
      if (inputPhone) {
        const dupPhones = registeredUsers.filter((u: any) => String(u.phone || '').trim() === inputPhone);
        if (dupPhones.length > 0) {
          message.warning(`娉ㄦ剰锛氳鎵嬫満鍙峰凡缁戝畾 ${dupPhones.length} 涓叾浠栬处鍙凤紱鍚屼竴鍙风爜缁戝畾澶氫釜绉熸埛/瀛愯处鍙锋椂锛屾墜鏈哄彿鐧诲綍灏嗚绂佺敤锛岃浣跨敤鐢ㄦ埛鍚嶇櫥褰昤);
        }
      }

      // 鑾峰彇褰撳墠鐧诲綍鐢ㄦ埛鐨勮鑹蹭俊鎭紝瀛愯处鍙风户鎵夸富璐﹀彿鐨勮鑹?
      const currentUsername = localStorage.getItem('username') || '';
      const currentUserRole = localStorage.getItem('userRole') || 'supplier';
      const isSub = localStorage.getItem('isSubAccount') === 'true';
      // 鏂板垱寤虹殑瀛愯处鍙风殑鐖惰处鍙峰簲璇ユ槸涓昏处鍙凤紝鑰屼笉鏄綋鍓嶇櫥褰曠殑瀛愯处鍙?
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
        accountType: '瀛愯处鍙?,
        status: 'normal',
        date: new Date().toISOString().split('T')[0],
        lastLogin: '-',
        remark: values.remark || '',
        person: values.displayName,
        group: values.group || '',
        phone: inputPhone,
      };
      setDataSource(prev => [newAccount, ...prev]);

      // 鍚屾椂鍐欏叆 registeredUsers锛屼娇瀛愯处鍙峰彲浠ョ櫥褰?
      registeredUsers.push({
        username: inputUsername,
        password: values.password,
        role: currentUserRole,
        roles: values.roles || [],
        customPermissions: addPermsRef.current,
        companyName: currentUser?.companyName || currentUsername,
        contactPerson: values.displayName,
        email: '',
        phone: inputPhone,
        isSubAccount: true,
        parentAccount: parentAccount,  // 浣跨敤涓昏处鍙蜂綔涓虹埗璐﹀彿
        needsPasswordChange: true,
      });
      localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));

      message.success(`瀛愯处鍙?${values.displayName} 鍒涘缓鎴愬姛锛佸垵濮嬪瘑鐮佷负锛?{values.password}`);
      setAddVisible(false);
      updateAddPerms([]);
      addForm.resetFields();
    }).catch(() => { /* 鏍￠獙澶辫触锛氳〃鍗曡鍐呮彁绀哄苟婊氬姩鍒伴涓敊璇」 */ });
  }, [addForm, dataSource.length]);

  // ==================== 璐﹀彿瀵煎叆 ====================
  const [importVisible, setImportVisible] = useState(false);
  const [importRows, setImportRows] = useState<ImportAccountRow[]>([]);

  // 涓嬭浇瀵煎叆妯℃澘
  const handleImportTemplate = useCallback(() => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['鎵€灞炲垎缁?', '鐢ㄦ埛鍚?', '濮撳悕*', '鍒濆瀵嗙爜', '澶囨敞'],
      ['閿€鍞儴', 'zhangsan01', '寮犱笁', 'abc123456', '绀轰緥琛屽彲鍒犻櫎'],
    ]);
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '璐﹀彿');
    XLSX.writeFile(wb, '璐﹀彿瀵煎叆妯℃澘.xlsx');
  }, []);

  // 瑙ｆ瀽瀵煎叆鏂囦欢锛氭墍灞炲垎缁?鐢ㄦ埛鍚?濮撳悕蹇呭～锛涙潈闄愯嚜鍔ㄧ户鎵垮垎缁勶紱棣栫櫥椤绘敼瀵?
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
          const group = pick(r, ['鎵€灞炲垎缁?', '鎵€灞炲垎缁?, '鍒嗙粍', '鎵€灞為儴闂?]);
          const username = pick(r, ['鐢ㄦ埛鍚?', '鐢ㄦ埛鍚?, '璐﹀彿']);
          const displayName = pick(r, ['濮撳悕*', '濮撳悕', '鍚嶇О']);
          const password = pick(r, ['鍒濆瀵嗙爜', '瀵嗙爜']) || 'abc123456';
          const remark = pick(r, ['澶囨敞', '璇存槑']);
          const row: ImportAccountRow = { rowNo: i + 2, group, username, displayName, password, remark, error: '' };
          if (!group) row.error = '缂哄皯鎵€灞炲垎缁勶紙蹇呭～锛?;
          else if (!groups.some(g => g.name === group)) row.error = `鍒嗙粍銆?{group}銆嶄笉瀛樺湪锛岃鍏堝湪鍒嗙粍绠＄悊涓垱寤篳;
          if (!row.error) {
            if (!username) row.error = '缂哄皯鐢ㄦ埛鍚嶏紙蹇呭～锛?;
            else if (!/^[a-zA-Z][a-zA-Z0-9_]{3,19}$/.test(username)) row.error = '鐢ㄦ埛鍚嶉』瀛楁瘝寮€澶淬€?-20浣嶅瓧姣嶆暟瀛椾笅鍒掔嚎';
            else if (seen.has(username.toLowerCase())) row.error = '鏂囦欢鍐呯敤鎴峰悕閲嶅';
            else if (dataSource.some(a => a.username.toLowerCase() === username.toLowerCase())) row.error = '鐢ㄦ埛鍚嶅凡瀛樺湪浜庤处鍙峰垪琛?;
            else if (registered.some((u: any) => String(u.username || '').toLowerCase() === username.toLowerCase())) row.error = '鐢ㄦ埛鍚嶅凡琚敞鍐?;
          }
          if (!row.error && !displayName) row.error = '缂哄皯濮撳悕锛堝繀濉級';
          if (!row.error && !(password.length >= 6 && /[a-zA-Z]/.test(password) && /\d/.test(password))) row.error = '鍒濆瀵嗙爜鑷冲皯6浣嶄笖鍚瓧姣嶅拰鏁板瓧';
          if (!row.error) seen.add(username.toLowerCase());
          return row;
        }).filter(r => r.group || r.username || r.displayName || r.remark); // 蹇界暐鍏ㄧ┖琛?
        if (!rows.length) { message.warning('鏈粠鏂囦欢涓鍙栧埌鏈夋晥璐﹀彿琛岋紝璇锋寜妯℃澘濉啓'); return; }
        setImportRows(rows);
        setImportVisible(true);
      } catch {
        message.error('鏂囦欢瑙ｆ瀽澶辫触锛岃瀵煎叆妯℃澘瀵煎嚭鐨?Excel/CSV 鏂囦欢');
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // 闃绘榛樿涓婁紶琛屼负
  }, [groups, dataSource]);

  // 纭瀵煎叆锛氭壒閲忓垱寤哄瓙璐﹀彿锛堟潈闄愮户鎵垮垎缁勩€侀鐧诲繀椤讳慨鏀瑰瘑鐮侊級
  const handleImportConfirm = useCallback(() => {
    const okRows = importRows.filter(r => !r.error);
    if (!okRows.length) { message.warning('娌℃湁鍙鍏ョ殑璐﹀彿琛?); return; }
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
        customPermissions: groupPerms, // 鏉冮檺鑷姩缁ф壙鎵€灞炲垎缁?
        accountType: '瀛愯处鍙?,
        status: 'normal',
        date: today,
        lastLogin: '-',
        remark: r.remark || '璐﹀彿瀵煎叆',
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
        needsPasswordChange: true, // 棣栨鐧诲綍蹇呴』淇敼瀵嗙爜
      });
    });
    localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));
    setDataSource(prev => [...newAccounts, ...prev]);
    setImportVisible(false);
    setImportRows([]);
    message.success(`鎴愬姛瀵煎叆 ${newAccounts.length} 涓处鍙凤細鏉冮檺缁ф壙鎵€灞炲垎缁勶紝棣栨鐧诲綍椤讳慨鏀瑰瘑鐮乣);
  }, [importRows, groups, dataSource]);

  // 鎼滅储鍜岄噸缃紙鏌ヨ鏃惰嚜鍔ㄥ埛鏂拌〃鍗曟暟鎹級
  const handleSearch = useCallback(() => {
    setDataSource(loadAccountsFromStorage());
    message.info(`鎵惧埌 ${filteredData.length} 鏉¤褰昤);
  }, [filteredData.length]);

  const handleReset = useCallback(() => {
    setSearchText('');
    setStatusFilter('');
    setRoleFilter('');
  }, []);

  // 瀵煎嚭
  const handleExport = useCallback(() => {
    const headers = ['璐﹀彿ID', '鐢ㄦ埛鍚?, '濮撳悕', '瑙掕壊', '璐﹀彿绫诲瀷', '鐘舵€?, '鎵€灞為儴闂?, '鍒涘缓鏃堕棿', '鏈€杩戠櫥褰?, '澶囨敞'];
    const rows = filteredData.map(item => [
      item.id, item.username, item.displayName,
      (item.roles || []).join('; ') || item.role,
      item.accountType,
      item.status === 'normal' ? '姝ｅ父' : '绂佺敤',
      item.group || '', item.date, item.lastLogin, item.remark,
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '璐﹀彿绠＄悊_瀵煎嚭.csv';
    link.click();
    URL.revokeObjectURL(url);
    message.success('瀵煎嚭鎴愬姛');
  }, [filteredData]);

  // 鎵归噺鎿嶄綔
  const handleBatchAction = useCallback(({ key }: { key: string }) => {
    if (selectedRowKeys.length === 0) {
      message.warning('璇峰厛閫夋嫨璐﹀彿');
      return;
    }
    const currentUser = localStorage.getItem('username') || '';
    switch (key) {
      case 'batch-enable': {
        setDataSource(prev => prev.map(item =>
          selectedRowKeys.includes(item.key) && item.accountType !== '涓昏处鍙?
            ? { ...item, status: 'normal' } : item
        ));
        // 鍚屾 registeredUsers
        try {
          const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const targetUsernames = dataSource
            .filter(d => selectedRowKeys.includes(d.key) && d.accountType !== '涓昏处鍙?)
            .map(d => d.username);
          regUsers.forEach((u: any) => {
            if (targetUsernames.includes(u.username)) u.accountStatus = 'normal';
          });
          localStorage.setItem('registeredUsers', JSON.stringify(regUsers));
        } catch { /* ignore */ }
        message.success(`宸插惎鐢?${selectedRowKeys.length} 涓处鍙穈);
        break;
      }
      case 'batch-disable': {
        setDataSource(prev => prev.map(item =>
          selectedRowKeys.includes(item.key) && item.accountType !== '涓昏处鍙? && item.username !== currentUser
            ? { ...item, status: 'disabled' } : item
        ));
        // 鍚屾 registeredUsers
        try {
          const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const targetUsernames = dataSource
            .filter(d => selectedRowKeys.includes(d.key) && d.accountType !== '涓昏处鍙? && d.username !== currentUser)
            .map(d => d.username);
          regUsers.forEach((u: any) => {
            if (targetUsernames.includes(u.username)) u.accountStatus = 'disabled';
          });
          localStorage.setItem('registeredUsers', JSON.stringify(regUsers));
        } catch { /* ignore */ }
        message.success(`宸茬鐢?${selectedRowKeys.length} 涓处鍙穈);
        break;
      }
      case 'batch-delete':
        Modal.confirm({
          title: '纭鎵归噺鍒犻櫎',
          icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
          content: `纭畾瑕佸垹闄ら€変腑鐨?${selectedRowKeys.length} 涓处鍙峰悧锛熶富璐﹀彿鍜屽綋鍓嶇櫥褰曡处鍙蜂笉浼氳鍒犻櫎銆俙,
          okText: '纭鍒犻櫎',
          okType: 'danger',
          cancelText: '鍙栨秷',
          onOk: () => {
            // 鎵惧嚭灏嗚鍒犻櫎鐨勮处鍙风敤鎴峰悕
            const deleteTargets = dataSource.filter(
              item => selectedRowKeys.includes(item.key) && item.accountType !== '涓昏处鍙? && item.username !== currentUser
            ).map(d => d.username);
            setDataSource(prev => prev.filter(item =>
              (!selectedRowKeys.includes(item.key) || item.accountType === '涓昏处鍙? || item.username === currentUser)
            ));
            // 鍚屾浠?registeredUsers 涓Щ闄?
            try {
              const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
              const updated = regUsers.filter((u: any) => !deleteTargets.includes(u.username));
              localStorage.setItem('registeredUsers', JSON.stringify(updated));
            } catch { /* ignore */ }
            setSelectedRowKeys([]);
            message.success('鎵归噺鍒犻櫎瀹屾垚');
          },
        });
        break;
    }
  }, [selectedRowKeys]);

  const batchMenuItems = [
    { key: 'batch-enable', icon: <CheckCircleOutlined />, label: '鎵归噺鍚敤' },
    { key: 'batch-disable', icon: <StopOutlined />, label: '鎵归噺绂佺敤' },
    { type: 'divider' as const },
    { key: 'batch-delete', icon: <DeleteOutlined />, label: '鎵归噺鍒犻櫎', danger: true },
  ];

  // 琛ㄦ牸鍒楀畾涔?
  const columns: ColumnsType<AccountRecord> = [
    { title: '璐﹀彿ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '鐢ㄦ埛鍚?, dataIndex: 'username', key: 'username', width: 110 },
    { title: '濮撳悕', dataIndex: 'displayName', key: 'displayName', width: 120 },
    {
      title: '鎵€灞炲垎缁?, dataIndex: 'group', key: 'group', width: 100,
      render: (g: string | undefined, record: AccountRecord) => {
        if (record.accountType === '涓昏处鍙?) return <Tag color="gold">-</Tag>;
        return g ? <Tag color="blue">{g}</Tag> : <Text type="secondary">鏈寚瀹?/Text>;
      },
    },
    {
      title: '鏉冮檺瑙掕壊', dataIndex: 'roles', key: 'roles', width: 180,
      render: (roles: string[], record) => {
        if (!roles || roles.length === 0) {
          // 鏃犺鑹蹭笖鏃犲崟鐙鑹叉爣绛撅細瀵煎叆璐﹀彿绛夌户鎵垮垎缁勬潈闄愮殑鍥為€€鏄剧ず
          if (!record.role && record.group) return <Tag color="cyan">缁ф壙銆寋record.group}銆嶆潈闄?/Tag>;
          return <Tag color={roleColorMap[record.role] || 'default'}>{roleLabelMap[record.role] || record.role}</Tag>;
        }
        return (
          <Space size={[0, 4]} wrap>
            {roles.map(r => (
              <Tag key={r} color={r === '鍏ㄩ儴鏉冮檺' ? 'gold' : r === '鐢熶骇绠＄悊' ? 'blue' : r === '閿€鍞鐞? ? 'green' : r === '璐㈠姟绠＄悊' ? 'purple' : r === '閲囪喘绠＄悊' ? 'cyan' : 'default'}>{r}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '璐﹀彿绫诲瀷', dataIndex: 'accountType', key: 'accountType', width: 90,
      render: (type: string) => (
        <Tag color={type === '涓昏处鍙? ? 'gold' : 'blue'}>{type}</Tag>
      ),
    },
    {
      title: '鐘舵€?, dataIndex: 'status', key: 'status', width: 80,
      render: (status: string) => (
        <Badge
          status={status === 'normal' ? 'success' : 'error'}
          text={status === 'normal' ? '姝ｅ父' : '绂佺敤'}
        />
      ),
    },
    {
      title: '灞忚斀寮圭獥', dataIndex: 'notificationBlocked', key: 'notificationBlocked', width: 90,
      render: (v: boolean | undefined, record: AccountRecord) => (
        <Tag
          color={v ? 'red' : 'green'}
          style={{ cursor: record.accountType !== '涓昏处鍙? ? 'pointer' : 'default' }}
          onClick={() => {
            if (record.accountType === '涓昏处鍙?) { message.warning('涓昏处鍙蜂笉鍙缃睆钄?); return; }
            handleToggleNotificationBlock(record);
          }}
        >{v ? '鏄? : '鍚?}</Tag>
      ),
    },
    { title: '鎵€灞為儴闂?, dataIndex: 'group', key: 'group', width: 110, render: (v: string) => v || '鈥? },
    { title: '鍒涘缓鏃堕棿', dataIndex: 'date', key: 'date', width: 110 },
    {
      title: '鏈€杩戠櫥褰?, dataIndex: 'lastLogin', key: 'lastLogin', width: 110,
      render: (v: string) => v === '-' ? <Text type="secondary">浠庢湭鐧诲綍</Text> : v,
    },
    { title: '澶囨敞', dataIndex: 'remark', key: 'remark', width: 160, ellipsis: true },
    {
      title: '鎿嶄綔', key: 'action', width: 260, fixed: 'right',
      render: (_, record) => (
        <Space size="small" wrap>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>鏌ョ湅</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>缂栬緫</Button>
          {record.accountType !== '涓昏处鍙? && (
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setPreviewUser(record.username); message.success(`宸插垏鎹负銆?{record.displayName}銆嶉瑙堣瑙掞紝椤甸潰椤堕儴妯箙鍙€€鍑篳); }}>棰勮瑙嗚</Button>
          )}
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => handleResetPwd(record)}>閲嶇疆瀵嗙爜</Button>
          <Popconfirm
            title={record.status === 'normal' ? `纭畾瑕佺鐢?${record.displayName} 鍚楋紵` : `纭畾瑕佸惎鐢?${record.displayName} 鍚楋紵`}
            onConfirm={() => handleToggleStatus(record)}
            okText="纭"
            cancelText="鍙栨秷"
          >
            <Button
              type="link"
              size="small"
              danger={record.status === 'normal'}
              icon={record.status === 'normal' ? <StopOutlined /> : <CheckCircleOutlined />}
            >
              {record.status === 'normal' ? '绂佺敤' : '鍚敤'}
            </Button>
          </Popconfirm>
          {record.accountType !== '涓昏处鍙? && (
            <Popconfirm
              title={`纭畾瑕佸垹闄?${record.displayName} 鍚楋紵`}
              description="鍒犻櫎鍚庢暟鎹笉鍙仮澶?
              onConfirm={() => handleDelete(record)}
              okText="纭鍒犻櫎"
              okType="danger"
              cancelText="鍙栨秷"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>鍒犻櫎</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // 缁熻姣忎釜鍒嗙粍涓嬬殑璐﹀彿鏁伴噺
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let ungrouped = 0;
    dataSource.forEach(item => {
      if (item.accountType === '涓昏处鍙?) return;
      if (item.group) { counts[item.group] = (counts[item.group] || 0) + 1; }
      else { ungrouped++; }
    });
    return { counts, ungrouped, total: dataSource.filter(d => d.accountType !== '涓昏处鍙?).length };
  }, [dataSource]);

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* ========== 宸︿晶鍒嗙粍闈㈡澘 ========== */}
      <Card
        style={{ width: 220, flexShrink: 0, height: 'fit-content' }}
        bodyStyle={{ padding: '12px 0' }}
        title={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <Text strong style={{ fontSize: 14 }}><TeamOutlined style={{ marginRight: 6 }} />鍒嗙粍</Text>
          <Button type="link" size="small" icon={<PlusOutlined />} onClick={handleAddGroup}>鏂板缓</Button>
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
          <Text>鍏ㄩ儴璐﹀彿</Text>
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
          <Text type="secondary">鏈寚瀹氬垎缁?/Text>
          <Tag>{groupCounts.ungrouped}</Tag>
        </div>
      </Card>

      {/* ========== 鍙充晶涓诲唴瀹瑰尯 ========== */}
      <div style={{ flex: 1, minWidth: 0 }}>
      {/* 椤甸潰澶撮儴 */}
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
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>璐﹀彿绠＄悊</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              绠＄悊绯荤粺璐﹀彿锛屾柊寤哄瓙璐﹀彿骞跺垎閰嶆潈闄?
            </Text>
          </div>
        </div>
        <Space>
          <Button ghost icon={<ExportOutlined />} onClick={handleExport}>瀵煎嚭</Button>
          <Button ghost icon={<DownloadOutlined />} onClick={handleImportTemplate}>瀵煎叆妯℃澘</Button>
          <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={handleImportFile}>
            <Button ghost icon={<UploadOutlined />}>瀵煎叆璐﹀彿</Button>
          </Upload>
          <Button type="primary" ghost icon={<UserAddOutlined />} onClick={handleAdd}>
            鏂板缓瀛愯处鍙?
          </Button>
        </Space>
      </div>

      {/* 缁熻鍗＄墖 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="鎬昏处鍙锋暟"
              value={stats.totalAccounts}
              prefix={<TeamOutlined style={{ fontSize: 20, color: PRIMARY }} />}
              valueStyle={{ color: '#1a2b45', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="鍚敤璐﹀彿"
              value={stats.activeAccounts}
              prefix={<CheckCircleOutlined style={{ fontSize: 20, color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="瀛愯处鍙锋暟"
              value={stats.subAccounts}
              prefix={<UserAddOutlined style={{ fontSize: 20, color: '#1890ff' }} />}
              valueStyle={{ color: '#1890ff', fontSize: 22 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title="浠婃棩鎿嶄綔璁板綍"
              value={stats.todayLogs}
              prefix={<SettingOutlined style={{ fontSize: 20, color: '#faad14' }} />}
              suffix="鏉?
              valueStyle={{ color: '#faad14', fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 鎼滅储绛涢€夊伐鍏锋爮 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} sm={6}>
            <Input
              placeholder="鎼滅储璐﹀彿ID / 鐢ㄦ埛鍚?/ 濮撳悕"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="璐﹀彿鐘舵€?
              value={statusFilter || undefined}
              onChange={v => setStatusFilter(v || '')}
              allowClear
              style={{ width: '100%' }}
            >
              <Option value="normal">姝ｅ父</Option>
              <Option value="disabled">绂佺敤</Option>
            </Select>
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="瑙掕壊绛涢€?
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
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>鏌ヨ</Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>閲嶇疆</Button>
            </Space>
          </Col>
          <Col xs={0} sm={6} style={{ textAlign: 'right' }}>
            <Space>
              <Button icon={<SafetyCertificateOutlined />} onClick={handleViewLogs}>鐧诲綍鏃ュ織</Button>
              <Dropdown menu={{ items: batchMenuItems, onClick: handleBatchAction }}>
                <Button icon={<SettingOutlined />}>鎵归噺鎿嶄綔</Button>
              </Dropdown>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 鏁版嵁琛ㄦ牸 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
            getCheckboxProps: (record) => ({
              disabled: record.accountType === '涓昏处鍙?,
            }),
          }}
          columns={columns}
          dataSource={filteredData}
          scroll={{ x: 1400 }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `绗?${range[0]}-${range[1]} 鏉★紝鍏?${total} 鏉,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
          }}
          locale={{ emptyText: '鏆傛棤璐﹀彿鏁版嵁' }}
        />
      </Card>

      {/* 璇︽儏鎶藉眽 */}
      <Drawer
        title={
          <Space>
            <UserOutlined style={{ color: PRIMARY }} />
            <span>璐﹀彿璇︽儏</span>
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
                缂栬緫
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
              <Descriptions.Item label="璐﹀彿ID">{selectedRecord.id}</Descriptions.Item>
              <Descriptions.Item label="鐢ㄦ埛鍚?>{selectedRecord.username}</Descriptions.Item>
              <Descriptions.Item label="濮撳悕">{selectedRecord.displayName}</Descriptions.Item>
              <Descriptions.Item label="璐﹀彿绫诲瀷">
                <Tag color={selectedRecord.accountType === '涓昏处鍙? ? 'gold' : 'blue'}>{selectedRecord.accountType}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="鏉冮檺瑙掕壊">
                {(selectedRecord.roles || []).length > 0
                  ? (selectedRecord.roles || []).map(r => (
                      <Tag key={r} color={r === '鍏ㄩ儴鏉冮檺' ? 'gold' : r === '鐢熶骇绠＄悊' ? 'blue' : r === '閿€鍞鐞? ? 'green' : r === '璐㈠姟绠＄悊' ? 'purple' : r === '閲囪喘绠＄悊' ? 'cyan' : 'default'}>{r}</Tag>
                    ))
                  : <Tag color={roleColorMap[selectedRecord.role] || 'default'}>
                      {roleLabelMap[selectedRecord.role] || selectedRecord.role}
                    </Tag>
                }
              </Descriptions.Item>
              <Descriptions.Item label="鐘舵€?>
                <Badge status={selectedRecord.status === 'normal' ? 'success' : 'error'}
                  text={selectedRecord.status === 'normal' ? '姝ｅ父' : '绂佺敤'} />
              </Descriptions.Item>
              <Descriptions.Item label="鎵€灞為儴闂?>{selectedRecord.group || '鈥?}</Descriptions.Item>
              <Descriptions.Item label="鍒涘缓鏃堕棿">{selectedRecord.date}</Descriptions.Item>
              <Descriptions.Item label="鏈€杩戠櫥褰? span={2}>
                {selectedRecord.lastLogin === '-' ? '浠庢湭鐧诲綍' : selectedRecord.lastLogin}
              </Descriptions.Item>
              <Descriptions.Item label="澶囨敞" span={2}>{selectedRecord.remark || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>

      {/* 缂栬緫璐﹀彿妯℃€佹 */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: PRIMARY }} />
            <span>缂栬緫璐﹀彿 - {selectedRecord?.displayName}</span>
          </Space>
        }
        open={editVisible}
        onCancel={() => { setEditVisible(false); updateEditPerms([]); editForm.resetFields(); }}
        onOk={handleEditConfirm}
        okText="淇濆瓨淇敼"
        cancelText="鍙栨秷"
        width={780}
      >
        <Form form={editForm} layout="vertical" scrollToFirstError style={{ marginTop: 16 }}
          onValuesChange={(changedValues) => {
            // 浠呭綋鐢ㄦ埛鎵嬪姩鏇存敼瑙掕壊鏃讹紝鍚堝苟鏂拌鑹叉潈闄愬埌鐙珛鏉冮檺涓?
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
          <Form.Item name="displayName" label="濮撳悕" rules={[{ required: true, message: '璇疯緭鍏ュ鍚? }]}>
            <Input placeholder="璇疯緭鍏ュ鍚? prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="roles" label="鏉冮檺瑙掕壊" rules={[{ required: true, message: '璇疯嚦灏戦€夋嫨涓€涓鑹? }]}>
            <Select mode="multiple" placeholder="璇烽€夋嫨瑙掕壊锛堝彲澶氶€夛級" allowClear>
              {getAllRoles().map(r => (
                <Option key={r.key} value={r.name}>{r.name}{r.isPreset ? ' (棰勮)' : ''}</Option>
              ))}
            </Select>
          </Form.Item>
          {/* 鐙珛鏉冮檺鍒嗛厤 */}
          <div style={{ marginBottom: 16 }}>
            <Button
              type="link"
              icon={editPermExpanded ? <LockOutlined /> : <SettingOutlined />}
              onClick={() => setEditPermExpanded(!editPermExpanded)}
              style={{ paddingLeft: 0, color: editPermExpanded ? PRIMARY : '#666' }}
            >
              {editPermExpanded ? '鏀惰捣鏉冮檺閰嶇疆' : '灞曞紑鐙珛鏉冮檺閰嶇疆'}
            </Button>
            {editPermExpanded && editVisible && (
              <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #d9d9d9' }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  姝ゅ璁剧疆鐨勬潈闄愬皢鍦ㄨ鑹叉潈闄愬熀纭€涓婇澶栬拷鍔狅紝浠呭姝ゅ瓙璐﹀彿鐢熸晥
                </Text>
                <CustomPermSelector key={selectedRecord?.key || 'edit'} value={editPerms} onChange={updateEditPerms} roles={editWatchedRoles} />
              </div>
            )}
          </div>
          {/* PERM_V2 涓汉涓夋€佽鍐欙紙鏈€楂樹紭鍏堢骇锛?*/}
          <div style={{ marginBottom: 16 }}>
            <Button
              type="link"
              icon={overrideExpanded ? <LockOutlined /> : <SettingOutlined />}
              onClick={() => setOverrideExpanded(!overrideExpanded)}
              style={{ paddingLeft: 0, color: overrideExpanded ? PRIMARY : '#666' }}
            >
              {overrideExpanded ? '鏀惰捣涓汉缁嗙矑搴﹁鍐? : '灞曞紑涓汉缁嗙矑搴﹁鍐欙紙鍏佽/绂佹/缁ф壙锛?}
            </Button>
            {overrideExpanded && editVisible && (
              <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #d9d9d9', maxHeight: 400, overflowY: 'auto' }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  鏈€楂樹紭鍏堢骇锛氱姝㈢洿鎺ユ嫤鎴€佸厑璁哥洿鎺ユ斁琛岋紱缁ф壙=娌跨敤 寮€鍙戣€?gt;瑙掕壊&gt;榛樿 瑙ｆ瀽閾?
                </Text>
                <PermEditor scopes={['supplier', 'purchaser', 'factory']} value={overrideDraft} onChange={setOverrideDraft} />
              </div>
            )}
          </div>
          <Form.Item name="group" label="鎵€灞為儴闂?>
            <Select placeholder="璇烽€夋嫨閮ㄩ棬锛堝彲閫夛級" allowClear>
              {groups.map(g => (
                <Option key={g.name} value={g.name}>{g.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="澶囨敞">
            <Input.TextArea rows={3} placeholder="璇疯緭鍏ュ娉ㄤ俊鎭? />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={
          <Space>
            <UserAddOutlined style={{ color: '#52c41a' }} />
            <span>鏂板缓瀛愯处鍙?/span>
          </Space>
        }
        open={addVisible}
        onCancel={() => { setAddVisible(false); addForm.resetFields(); }}
        onOk={handleAddConfirm}
        okText="鍒涘缓璐﹀彿"
        cancelText="鍙栨秷"
        width={560}
      >
        <div style={{
          background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8,
          padding: '10px 16px', marginBottom: 20, marginTop: 8,
        }}>
          <InfoCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
          <Text style={{ color: '#389e0d', fontSize: 13 }}>
            鍒涘缓鎴愬姛鍚庯紝绯荤粺灏嗚嚜鍔ㄧ敓鎴愬垵濮嬪瘑鐮侊紝璇锋彁閱掔敤鎴烽娆＄櫥褰曞悗淇敼瀵嗙爜
          </Text>
        </div>
        <Form form={addForm} layout="vertical" scrollToFirstError
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
              // 閫夋嫨鎵€灞為儴闂ㄥ悗鑷姩缁ф壙閮ㄩ棬鏉冮檺锛堝垏鎹㈤儴闂ㄦ椂绉婚櫎涓婃鑷姩缁ф壙鐨勯儴闂ㄦ潈闄愶級
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
                label="鐢ㄦ埛鍚?
                rules={[
                  { required: true, message: '璇疯緭鍏ョ敤鎴峰悕' },
                  { pattern: /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/, message: '瀛楁瘝寮€澶达紝4-20浣嶅瓧姣嶆暟瀛椾笅鍒掔嚎' },
                ]}
              >
                <Input placeholder="璇疯緭鍏ョ敤鎴峰悕" prefix={<UserOutlined />} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="displayName"
                label="濮撳悕"
                rules={[{ required: true, message: '璇疯緭鍏ュ鍚? }]}
              >
                <Input placeholder="璇疯緭鍏ュ鍚? prefix={<UserOutlined />} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="password"
                label="鍒濆瀵嗙爜"
                rules={[
                  { required: true, message: '璇疯缃垵濮嬪瘑鐮? },
                  { min: 6, message: '瀵嗙爜鑷冲皯6浣? },
                  { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '瀵嗙爜蹇呴』鍖呭惈瀛楁瘝鍜屾暟瀛? },
                ]}
              >
                <Input.Password placeholder="璇疯缃垵濮嬪瘑鐮侊紙瀛楁瘝+鏁板瓧锛? prefix={<LockOutlined />} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="confirmPassword"
                label="纭瀵嗙爜"
                dependencies={['password']}
                rules={[
                  { required: true, message: '璇风‘璁ゅ瘑鐮? },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('涓ゆ杈撳叆鐨勫瘑鐮佷笉涓€鑷?));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="璇峰啀娆¤緭鍏ュ瘑鐮? prefix={<LockOutlined />} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="phone"
                label="鎵嬫満鍙风爜"
                tooltip="閫夊～锛涘～鍐欏悗璇ュ瓙璐﹀彿鍙敤鎵嬫満鍙风櫥褰曘€傝嫢鍚屼竴鎵嬫満鍙峰悓鏃剁粦瀹氬涓鎴锋垨澶氫釜瀛愯处鍙凤紝鎵嬫満鍙风櫥褰曞皢琚鐢紝椤讳娇鐢ㄧ敤鎴峰悕鐧诲綍"
                rules={[
                  { pattern: /^1[3-9]\d{9}$/, message: '璇疯緭鍏?11 浣嶆湁鏁堟墜鏈哄彿鐮? },
                ]}
              >
                <Input placeholder="璇疯緭鍏ユ墜鏈哄彿鐮侊紙閫夊～锛屽彲鐢ㄤ簬鐧诲綍锛? prefix={<MobileOutlined />} allowClear />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="roles" label="鏉冮檺瑙掕壊">
                <Select mode="multiple" placeholder="璇烽€夋嫨瑙掕壊锛堝彲澶氶€夛紝鍙€夛級" allowClear>
                  {getAllRoles().map(r => (
                    <Option key={r.key} value={r.name}>{r.name}{r.isPreset ? ' (棰勮)' : ''}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="group" label="鎵€灞為儴闂? rules={[{ required: true, message: '璇烽€夋嫨鎵€灞為儴闂? }]}>
                <Select placeholder="璇烽€夋嫨閮ㄩ棬锛堣嚜鍔ㄧ户鎵块儴闂ㄦ潈闄愶級" allowClear>
                  {groups.map(g => (
                    <Option key={g.name} value={g.name}>{g.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          {/* 鐙珛鏉冮檺鍒嗛厤 */}
          <div style={{ marginBottom: 16 }}>
            <Button
              type="link"
              icon={addPermExpanded ? <LockOutlined /> : <SettingOutlined />}
              onClick={() => setAddPermExpanded(!addPermExpanded)}
              style={{ paddingLeft: 0, color: addPermExpanded ? PRIMARY : '#666' }}
            >
              {addPermExpanded ? '鏀惰捣鏉冮檺閰嶇疆' : '灞曞紑鐙珛鏉冮檺閰嶇疆'}
            </Button>
            {addPermExpanded && (
              <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #d9d9d9', maxHeight: 300, overflowY: 'auto' }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  姝ゅ璁剧疆鐨勬潈闄愬皢鍦ㄨ鑹叉潈闄愬熀纭€涓婇澶栬拷鍔狅紝浠呭姝ゅ瓙璐﹀彿鐢熸晥
                </Text>
                <CustomPermSelector value={addPerms} onChange={updateAddPerms} roles={addWatchedRoles} />
              </div>
            )}
          </div>
          <Form.Item name="remark" label="澶囨敞">
            <Input.TextArea rows={2} placeholder="璇疯緭鍏ュ娉ㄤ俊鎭紙閫夊～锛? />
          </Form.Item>
        </Form>
      </Modal>

      {/* 閲嶇疆瀵嗙爜妯℃€佹 */}
      <Modal
        title={
          <Space>
            <KeyOutlined style={{ color: '#faad14' }} />
            <span>閲嶇疆瀵嗙爜 - {pwdAccount?.displayName}</span>
          </Space>
        }
        open={pwdVisible}
        onCancel={() => { setPwdVisible(false); pwdForm.resetFields(); }}
        onOk={handlePwdConfirm}
        okText="纭閲嶇疆"
        cancelText="鍙栨秷"
        width={450}
      >
        <div style={{
          background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8,
          padding: '10px 16px', marginBottom: 20, marginTop: 8,
        }}>
          <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
          <Text style={{ color: '#ad6800', fontSize: 13 }}>
            閲嶇疆瀵嗙爜鍚庯紝鐢ㄦ埛闇€浣跨敤鏂板瘑鐮侀噸鏂扮櫥褰?
          </Text>
        </div>
        <Form form={pwdForm} layout="vertical">
          <Form.Item
            name="newPassword"
            label="鏂板瘑鐮?
            rules={[
              { required: true, message: '璇疯緭鍏ユ柊瀵嗙爜' },
              { min: 6, message: '瀵嗙爜鑷冲皯6浣? },
              { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '瀵嗙爜蹇呴』鍖呭惈瀛楁瘝鍜屾暟瀛? },
            ]}
          >
            <Input.Password placeholder="璇疯緭鍏ユ柊瀵嗙爜锛堝瓧姣?鏁板瓧锛? prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="纭鏂板瘑鐮?
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '璇风‘璁ゆ柊瀵嗙爜' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('涓ゆ杈撳叆鐨勫瘑鐮佷笉涓€鑷?));
                },
              }),
            ]}
          >
            <Input.Password placeholder="璇峰啀娆¤緭鍏ユ柊瀵嗙爜" prefix={<LockOutlined />} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 鐧诲綍鏃ュ織寮圭獥 */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: PRIMARY }} />
            <span>鐧诲綍鏃ュ織锛堟渶杩?00鏉★級</span>
          </Space>
        }
        open={logVisible}
        onCancel={() => setLogVisible(false)}
        footer={<Button onClick={() => setLogVisible(false)}>鍏抽棴</Button>}
        width={700}
      >
        <div style={{ marginBottom: 12, textAlign: 'right' }}>
          <Button size="small" danger onClick={handleClearLogs} icon={<DeleteOutlined />}>娓呴櫎鏃ュ織</Button>
        </div>
        <Table
          dataSource={loginLogs}
          rowKey={(_, i) => String(i)}
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '鏃堕棿', dataIndex: 'time', key: 'time', width: 160 },
            { title: '璐﹀彿', dataIndex: 'username', key: 'username', width: 120 },
            {
              title: '缁撴灉', dataIndex: 'success', key: 'success', width: 80,
              render: (v: boolean) => v
                ? <Tag color="success">鎴愬姛</Tag>
                : <Tag color="error">澶辫触</Tag>,
            },
            { title: '璇︽儏', dataIndex: 'detail', key: 'detail' },
          ]}
          locale={{ emptyText: '鏆傛棤鐧诲綍鏃ュ織' }}
        />
      </Modal>

      {/* ========== 鍒嗙粍绠＄悊寮圭獥 ========== */}
      <Modal
        title={editingGroup ? '缂栬緫鍒嗙粍' : '鏂板缓鍒嗙粍'}
        open={groupModalVisible}
        onCancel={() => { setGroupModalVisible(false); groupForm.resetFields(); setGroupPerms([]); }}
        onOk={handleGroupModalOk}
        okText={editingGroup ? '淇濆瓨' : '鍒涘缓'}
        cancelText="鍙栨秷"
        width={600}
      >
        <Form form={groupForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="鍒嗙粍鍚嶇О" rules={[{ required: true, message: '璇疯緭鍏ュ垎缁勫悕绉? }]}>
            <Input placeholder="渚嬪锛氫粨搴撱€佸鏈嶃€佽繍钀? maxLength={20} />
          </Form.Item>
        </Form>

        {/* 缁勬潈闄愰厤缃?*/}
        <div style={{
          padding: 12, background: '#f0f5ff', borderRadius: 8,
          border: '1px solid #adc6ff', marginBottom: 16,
        }}>
          <Text strong style={{ fontSize: 13, color: PRIMARY }}>
            <SafetyCertificateOutlined style={{ marginRight: 6 }} />
            鍒嗙粍鏉冮檺閰嶇疆
          </Text>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 12 }}>
            缁勬潈闄愬皢涓庝釜浜烘潈闄愬彔鍔狅紝渚嬪锛氱粍璁锯€滃叏閮ㄥ晢鍝佲€濇潈闄愶紝涓汉璁锯€滄垚鍝佲€濇潈闄愶紝鍒欒鎴愬憳鎷ユ湁鈥滃叏閮ㄥ晢鍝?+ 鎴愬搧鈥濇潈闄?
          </div>
          <div style={{ maxHeight: 350, overflowY: 'auto', padding: '4px 0' }}>
            {permissionModules.map(mod => {
              const modPerms = mod.children.map(c => `${mod.key}/${c.key}`);
              const checkedCount = modPerms.filter(p => groupPerms.includes(p)).length;
              const allChecked = checkedCount === modPerms.length && modPerms.length > 0;
              const someChecked = checkedCount > 0 && checkedCount < modPerms.length;
              return (
                <div key={mod.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      onChange={(e) => {
                        const current = new Set(groupPerms);
                        modPerms.forEach(p => {
                          if (e.target.checked) current.add(p); else current.delete(p);
                        });
                        setGroupPerms(Array.from(current));
                      }}
                    >
                      <Text strong style={{ fontSize: 13 }}>{mod.label}</Text>
                    </Checkbox>
                    <Tag color="blue" style={{ marginLeft: 6 }}>{modPerms.length}椤?/Tag>
                  </div>
                  <Row gutter={[8, 2]} style={{ marginLeft: 24 }}>
                    {mod.children.map(child => {
                      const permKey = `${mod.key}/${child.key}`;
                      return (
                        <Col span={8} key={permKey}>
                          <Checkbox
                            checked={groupPerms.includes(permKey)}
                            onChange={(e) => {
                              const current = new Set(groupPerms);
                              if (e.target.checked) current.add(permKey); else current.delete(permKey);
                              setGroupPerms(Array.from(current));
                            }}
                          >
                            {child.label}
                          </Checkbox>
                        </Col>
                      );
                    })}
                  </Row>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* 璐﹀彿瀵煎叆棰勮寮圭獥 */}
      <Modal
        title={<Space><UploadOutlined style={{ color: '#1890ff' }} /><span>璐﹀彿瀵煎叆棰勮</span></Space>}
        open={importVisible}
        onCancel={() => { setImportVisible(false); setImportRows([]); }}
        onOk={handleImportConfirm}
        okText="纭瀵煎叆"
        cancelText="鍙栨秷"
        okButtonProps={{ disabled: !importRows.length || importRows.some(r => r.error) }}
        width={880}
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="鎵€灞炲垎缁勩€佺敤鎴峰悕銆佸鍚嶄负蹇呭～椤癸紱璐﹀彿鏉冮檺鑷姩缁ф壙鎵€灞炲垎缁勬潈闄愶紱瀵煎叆璐﹀彿棣栨鐧诲綍蹇呴』淇敼瀵嗙爜"
          description={groups.length ? undefined : '褰撳墠灏氭棤鍒嗙粍锛岃鍏堝湪鍒嗙粍绠＄悊涓垱寤哄垎缁勫悗鍐嶅鍏?}
        />
        <Table size="small" bordered rowKey="rowNo" pagination={false} scroll={{ y: 320 }}
          columns={[
            { title: '琛屽彿', dataIndex: 'rowNo', key: 'rowNo', width: 60 },
            { title: '鎵€灞炲垎缁?', dataIndex: 'group', key: 'group', width: 110, render: (v: string) => v || <Text type="danger">缂哄け</Text> },
            { title: '鐢ㄦ埛鍚?', dataIndex: 'username', key: 'username', width: 140 },
            { title: '濮撳悕*', dataIndex: 'displayName', key: 'displayName', width: 100 },
            { title: '鍒濆瀵嗙爜', key: 'password', width: 90, render: () => '鈥⑩€⑩€⑩€⑩€⑩€? },
            { title: '缁ф壙鏉冮檺鏁?, key: 'permCount', width: 90, render: (_: any, r: ImportAccountRow) => r.error ? '-' : `${(groups.find(g => g.name === r.group)?.permissions || []).length} 椤筦 },
            { title: '鏍￠獙缁撴灉', key: 'error', render: (_: any, r: ImportAccountRow) => r.error ? <Text type="danger">{r.error}</Text> : <Tag color="green">閫氳繃</Tag> },
          ]}
          dataSource={importRows}
          locale={{ emptyText: '鏆傛棤鏁版嵁' }}
        />
      </Modal>

      </div>{/* 鍏抽棴鍙充晶涓诲唴瀹瑰尯 */}
    </div>
  );
};

export default AccountManage;
