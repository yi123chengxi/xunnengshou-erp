import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Space, Tag, message, Row, Col, Statistic, Tooltip, Checkbox, Divider,
} from 'antd';
import { EditOutlined, UserOutlined, TeamOutlined, UserDeleteOutlined, InfoCircleOutlined, SettingOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

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
  const [statusFilter, setStatusFilter] = useState('');
  const [visibleFields, setVisibleFields] = useState<string[]>(loadFieldConfig);
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);

  // 监听 storage 事件以响应其他标签页的账号变更
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === getAccountsKey()) setRefreshKey(k => k + 1);
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

  const filteredData = useMemo(() => {
    return employees.filter(e => {
      const matchSearch = !searchText || e.name.includes(searchText) || e.id.toLowerCase().includes(searchText.toLowerCase()) || e.username.includes(searchText);
      const matchStatus = !statusFilter || e.employeeStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [employees, searchText, statusFilter]);

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
      setModalVisible(false);
      message.success('档案已保存');
    }).catch(() => { /* 校验失败 */ });
  }, [form, editingUsername]);

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
    { title: '在职状态', dataIndex: 'employeeStatus', key: 'employeeStatus', width: 90, align: 'center',
      render: (v: string) => v === '在职' ? <Tag color="green">在职</Tag> : <Tag color="red">离职</Tag>,
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
      title: '操作', key: '_action', width: 80, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: EmployeeView) => (
        <Tooltip title="补充/编辑HR档案">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditProfile(r)}>档案</Button>
        </Tooltip>
      ),
    };
    return [...filtered, opCol];
  }, [allColumns, visibleFields, handleEditProfile]);

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
          <Select placeholder="状态筛选" allowClear style={{ width: 120 }} onChange={v => setStatusFilter(v || '')}>
            <Select.Option value="在职">在职</Select.Option>
            <Select.Option value="离职">离职</Select.Option>
          </Select>
          <Button icon={<SettingOutlined />} onClick={() => setFieldConfigVisible(true)}>字段显示设置</Button>
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
          scroll={{ x: 1830 }}
        />
      </Card>

      <Modal title={`HR档案 - ${employees.find(e => e.username === editingUsername)?.name || ''}`} open={modalVisible} onOk={handleSaveProfile} onCancel={() => setModalVisible(false)} okText="保存" cancelText="取消" width={600}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
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
    </div>
  );
};

export default EmployeePage;
