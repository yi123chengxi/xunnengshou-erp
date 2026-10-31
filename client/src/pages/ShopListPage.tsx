import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, Select, AutoComplete,
  Row, Col, Popconfirm, Tag, Radio, Upload, Image, Divider,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ShopOutlined, ReloadOutlined,
  ImportOutlined, UploadOutlined, TeamOutlined, SearchOutlined, ClearOutlined,
  BankOutlined, PictureOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx-js-style';
import useResizableColumns from '../hooks/useResizableColumns';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';

const { Text, Title } = Typography;
const { TextArea } = Input;
const PRIMARY = '#1e4a7e';

// ===================== 电商平台列表（含 Logo 配色） =====================
const PLATFORM_COLORS = ['#FF5000', '#E4393C', '#C91623', '#E02E24', '#000000', '#FF4906', '#FE2C55',
  '#1BA784', '#F4A100', '#0099FF', '#FF6A00', '#FF6B35', '#1FB96E', '#3370FF', '#FF9900',
  '#EE4D2D', '#0F146D', '#FF4747', '#E53238', '#2FB7EC', '#F66B0E', '#07C160', '#306CF4', '#00A1D6',
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F59E0B', '#EF4444', '#3B82F6', '#10B981'];

const PLATFORMS = [
  { name: '淘宝', color: '#FF5000', abbr: '淘' },
  { name: '天猫', color: '#E4393C', abbr: '天' },
  { name: '京东', color: '#C91623', abbr: '京' },
  { name: '拼多多', color: '#E02E24', abbr: '拼' },
  { name: '抖音', color: '#000000', abbr: '抖' },
  { name: '抖音电商', color: '#000000', abbr: '抖' },
  { name: '快手', color: '#FF4906', abbr: '快' },
  { name: '快手电商', color: '#FF4906', abbr: '快' },
  { name: '小红书', color: '#FE2C55', abbr: '红' },
  { name: '唯品会', color: '#E4393C', abbr: '唯' },
  { name: '得物', color: '#1BA784', abbr: '得' },
  { name: '苏宁易购', color: '#F4A100', abbr: '苏' },
  { name: '美团', color: '#FFD100', abbr: '美' },
  { name: '饿了么', color: '#0099FF', abbr: '饿' },
  { name: '1688', color: '#FF6A00', abbr: '阿' },
  { name: '闲鱼', color: '#FFE033', abbr: '闲' },
  { name: '微店', color: '#FF6B35', abbr: '微' },
  { name: '有赞', color: '#1FB96E', abbr: '赞' },
  { name: '微盟', color: '#3370FF', abbr: '盟' },
  { name: '亚马逊', color: '#FF9900', abbr: '亚' },
  { name: 'Shopee', color: '#EE4D2D', abbr: 'S' },
  { name: 'Lazada', color: '#0F146D', abbr: 'L' },
  { name: '速卖通', color: '#FF4747', abbr: '速' },
  { name: 'eBay', color: '#E53238', abbr: 'e' },
  { name: 'Wish', color: '#2FB7EC', abbr: 'W' },
  { name: 'Temu', color: '#F66B0E', abbr: 'T' },
  { name: 'TikTok Shop', color: '#000000', abbr: 'T' },
  { name: '微信视频号', color: '#07C160', abbr: '视' },
  { name: '百度电商', color: '#306CF4', abbr: '百' },
  { name: '哔哩哔哩', color: '#00A1D6', abbr: 'B' },
];

const PlatformBadge: React.FC<{ name: string; extraPlatforms?: { name: string; color: string; abbr: string }[] }> = ({ name, extraPlatforms }) => {
  const all = extraPlatforms ? [...PLATFORMS, ...extraPlatforms] : PLATFORMS;
  const p = all.find(pl => pl.name === name);
  if (!p) {
    // 未找到时自动生成样式
    const abbr = name.charAt(0);
    const colorIdx = name.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % PLATFORM_COLORS.length;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 4, background: PLATFORM_COLORS[colorIdx], color: '#fff',
          fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>{abbr}</span>
        <span>{name}</span>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 4, background: p.color, color: '#fff',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>{p.abbr}</span>
      <span>{p.name}</span>
    </span>
  );
};

// ===================== 类型定义 =====================
interface ShopInfo {
  key: string;
  shopName: string;
  accountId: string;
  platform: string;
  brand: string;
  companyName: string;
  shopPhone: string;
  person: string;
  remark: string;
  shopPassword: string;
  createdAt: string;
}

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

// ===================== 主组件 =====================
const ShopListPage: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const storageKey = `shop_info_${owner}`;
  const licenseKey = `business_license_${owner}`;
  const platformKey = `custom_platforms_${owner}`;

  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  const [shopPage, setShopPage] = useState(1);
  const [shopPageSize, setShopPageSize] = useState(20);

  // 自定义平台
  const [customPlatforms, setCustomPlatforms] = useState<{ name: string; color: string; abbr: string }[]>([]);
  useEffect(() => {
    try { setCustomPlatforms(JSON.parse(localStorage.getItem(platformKey) || '[]')); } catch { setCustomPlatforms([]); }
  }, [platformKey]);
  const allPlatforms = useMemo(() => [...PLATFORMS, ...customPlatforms], [customPlatforms]);
  const [platformAddVisible, setPlatformAddVisible] = useState(false);
  const [newPlatformName, setNewPlatformName] = useState('');

  // 编辑弹窗
  const [editVisible, setEditVisible] = useState(false);

  // 品牌台账数据（合并授权品牌台账 + 自有品牌台账，去重后扁平显示）
  const [brandOptions, setBrandOptions] = useState<{ value: string; label: string }[]>([]);
  const refreshBrandOptions = useCallback(() => {
    const ownBrands: { brandName?: string }[] = (() => { try { return JSON.parse(localStorage.getItem(`brandauth_own_${owner}`) || '[]'); } catch { return []; } })();
    const authLedger: { brandName?: string }[] = (() => { try { return JSON.parse(localStorage.getItem(`brandauth_auth_brandledger_${owner}`) || '[]'); } catch { return []; } })();
    const allNames = new Set<string>();
    [...ownBrands.map(b => b.brandName), ...authLedger.map(b => b.brandName)]
      .filter(Boolean).forEach(n => allNames.add(n!.trim()));
    setBrandOptions(Array.from(allNames).map(n => ({ value: n, label: n })));
  }, [owner]);
  // 弹窗打开时刷新品牌数据
  useEffect(() => { if (editVisible) refreshBrandOptions(); }, [editVisible, refreshBrandOptions]);
  // 监听其他页面的数据变更，实时更新
  useEffect(() => {
    const onSync = () => refreshBrandOptions();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [refreshBrandOptions]);
  // 初始化时加载一次
  useEffect(() => { refreshBrandOptions(); }, [refreshBrandOptions]);
  const [editingShop, setEditingShop] = useState<ShopInfo | null>(null);
  const [formName, setFormName] = useState('');
  const [formId, setFormId] = useState('');
  const [formPlatform, setFormPlatform] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formPerson, setFormPerson] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formPassword, setFormPassword] = useState('');

  // 搜索
  const [searchShopName, setSearchShopName] = useState('');
  const [searchShopNo, setSearchShopNo] = useState('');
  const [searchCompanyName, setSearchCompanyName] = useState('');
  const [searchPerson, setSearchPerson] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchPlatform, setSearchPlatform] = useState('');
  // 已应用的搜索条件（点击查询后才生效）
  const [appliedSearch, setAppliedSearch] = useState({ shopName: '', shopNo: '', companyName: '', person: '', phone: '', platform: '' });
  const handleSearch = useCallback(() => {
    // 查询时自动刷新表单数据
    try { setShops(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setShops([]); }
    try {
      const licenses = JSON.parse(localStorage.getItem(licenseKey) || '[]');
      setCompanyNames(licenses.map((l: any) => l.companyName).filter(Boolean));
    } catch { setCompanyNames([]); }
    setAppliedSearch({
      shopName: searchShopName,
      shopNo: searchShopNo,
      companyName: searchCompanyName,
      person: searchPerson,
      phone: searchPhone,
      platform: searchPlatform,
    });
  }, [searchShopName, searchShopNo, searchCompanyName, searchPerson, searchPhone, searchPlatform, storageKey, licenseKey]);
  const handleReset = useCallback(() => {
    setSearchShopName(''); setSearchShopNo(''); setSearchCompanyName('');
    setSearchPerson(''); setSearchPhone(''); setSearchPlatform('');
    setAppliedSearch({ shopName: '', shopNo: '', companyName: '', person: '', phone: '', platform: '' });
  }, []);

  // 新增平台
  const handlePlatformAdd = useCallback(() => {
    const name = newPlatformName.trim();
    if (!name) { message.warning('请输入平台名称'); return; }
    // 检查是否已存在
    if (allPlatforms.find(p => p.name === name)) {
      message.warning(`平台“${name}”已存在`);
      setFormPlatform(name);
      setPlatformAddVisible(false);
      setNewPlatformName('');
      return;
    }
    const abbr = name.charAt(0);
    const colorIdx = name.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % PLATFORM_COLORS.length;
    const color = PLATFORM_COLORS[colorIdx];
    const newPlatform = { name, color, abbr };
    const updated = [...customPlatforms, newPlatform];
    setCustomPlatforms(updated);
    localStorage.setItem(platformKey, JSON.stringify(updated));
    setFormPlatform(name);
    setPlatformAddVisible(false);
    setNewPlatformName('');
    message.success(`平台“${name}”已添加`);
  }, [newPlatformName, allPlatforms, customPlatforms, platformKey]);

  // 营业执照新增弹窗
  const [licenseAddVisible, setLicenseAddVisible] = useState(false);
  const [licFormName, setLicFormName] = useState('');
  const [licFormTaxpayerCode, setLicFormTaxpayerCode] = useState('');
  const [licFormCompanyType, setLicFormCompanyType] = useState<string>('');
  const [licFormRemark, setLicFormRemark] = useState('');
  const [licFormImage, setLicFormImage] = useState('');

  const handleLicenseSave = useCallback(() => {
    if (!licFormName.trim()) { message.warning('请输入公司名称'); return; }
    try {
      const list = JSON.parse(localStorage.getItem(licenseKey) || '[]');
      const newRecord = {
        key: `bl-${Date.now()}`,
        companyName: licFormName.trim(),
        taxpayerCode: licFormTaxpayerCode.trim(),
        companyType: licFormCompanyType,
        accountingCompany: '',
        remark: licFormRemark.trim(),
        image: licFormImage,
        createdAt: new Date().toLocaleString('zh-CN'),
      };
      list.push(newRecord);
      localStorage.setItem(licenseKey, JSON.stringify(list));
      // 刷新公司名称列表并自动选中新公司
      setCompanyNames(list.map((l: any) => l.companyName).filter(Boolean));
      setFormCompany(licFormName.trim());
      setLicenseAddVisible(false);
      setLicFormName(''); setLicFormTaxpayerCode(''); setLicFormCompanyType('');
      setLicFormRemark(''); setLicFormImage('');
      message.success('营业执照已添加，已自动选择该公司');
    } catch {
      message.error('保存失败');
    }
  }, [licenseKey, licFormName, licFormTaxpayerCode, licFormCompanyType, licFormRemark, licFormImage]);

  // 导入弹窗
  const [importVisible, setImportVisible] = useState(false);
  const [importMode, setImportMode] = useState<'add' | 'update'>('add');
  const [matchField, setMatchField] = useState('shopName');
  const [importData, setImportData] = useState<any[]>([]);
  const [importFileName, setImportFileName] = useState('');

  // 负责人选择弹窗
  const [personPickerVisible, setPersonPickerVisible] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);

  // 加载账号列表
  const loadAccounts = useCallback(() => {
    try {
      const data = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
      setAccounts(data.filter((a: any) => a.status !== 'disabled'));
    } catch { setAccounts([]); }
  }, [owner]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ===================== 数据加载 =====================
  const reload = useCallback(() => {
    try { setShops(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setShops([]); }
    try {
      const licenses = JSON.parse(localStorage.getItem(licenseKey) || '[]');
      setCompanyNames(licenses.map((l: any) => l.companyName).filter(Boolean));
    } catch { setCompanyNames([]); }
  }, [storageKey, licenseKey]);
  useEffect(() => { reload(); }, [reload]);

  const saveShops = (list: ShopInfo[]) => {
    const json = JSON.stringify(list);
    safeSetItem(storageKey, json);
    safeSetItem(`${storageKey}_ts`, String(Date.now()));
    saveDataset(storageKey, json);
    setShops(list);
  };

  // ===================== CRUD =====================
  const resetForm = () => {
    setFormName(''); setFormId(''); setFormPlatform(''); setFormCompany('');
    setFormPhone(''); setFormPerson(''); setFormRemark(''); setFormPassword('');
  };

  const openAdd = () => {
    setEditingShop(null);
    resetForm();
    setEditVisible(true);
  };

  const openEdit = (shop: ShopInfo) => {
    setEditingShop(shop);
    setFormName(shop.shopName);
    setFormId(shop.accountId);
    setFormPlatform(shop.platform || '');
    setFormBrand(shop.brand || '');
    setFormCompany(shop.companyName || '');
    setFormPhone(shop.shopPhone || '');
    setFormPerson(shop.person || '');
    setFormRemark(shop.remark || '');
    setFormPassword(shop.shopPassword || '');
    setEditVisible(true);
  };

  const handleSave = () => {
    if (!formName.trim()) { message.warning('请输入店铺名称'); return; }
    const list = [...shops];
    const data = {
      shopName: formName.trim(),
      accountId: formId.trim(),
      platform: formPlatform,
      brand: formBrand.trim(),
      companyName: formCompany,
      shopPhone: formPhone.trim(),
      person: formPerson.trim(),
      remark: formRemark.trim(),
      shopPassword: formPassword.trim(),
    };
    // 店铺名称重复检查
    const dupName = list.find(s => s.shopName === data.shopName && (!editingShop || s.key !== editingShop.key));
    if (dupName) { message.warning(`店铺名称“${data.shopName}”已存在，请勿重复添加`); return; }
    // ERP店铺ID重复检查
    if (data.accountId) {
      const dupId = list.find(s => s.accountId === data.accountId && (!editingShop || s.key !== editingShop.key));
      if (dupId) { message.warning(`ERP店铺ID“${data.accountId}”已存在，请勿重复添加`); return; }
    }
    if (editingShop) {
      const idx = list.findIndex(s => s.key === editingShop.key);
      if (idx >= 0) list[idx] = { ...list[idx], ...data };
    } else {
      list.push({ key: `shop-${Date.now()}`, ...data, createdAt: new Date().toLocaleString('zh-CN') });
    }
    saveShops(list);
    setEditVisible(false);
    message.success(editingShop ? '店铺已更新' : '店铺已添加');
  };

  const handleDelete = (key: string) => {
    saveShops(shops.filter(s => s.key !== key));
    message.success('店铺已删除');
  };

  // ===================== 导入功能 =====================
  const MATCH_FIELD_OPTIONS = [
    { label: '店铺名称', value: 'shopName' },
    { label: 'ERP店铺ID', value: 'accountId' },
    { label: '店铺手机号', value: 'shopPhone' },
  ];

  const FIELD_MAP: Record<string, keyof ShopInfo> = {
    '店铺名称': 'shopName', 'ERP店铺ID': 'accountId', '所属平台': 'platform',
    '品牌': 'brand', '公司名称': 'companyName', '店铺手机号': 'shopPhone', '负责人': 'person',
    '备注': 'remark', '店铺登入密码': 'shopPassword',
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (rows.length === 0) { message.warning('文件中没有数据'); return; }
        // 映射中文表头到字段名
        const mapped = rows.map(row => {
          const item: any = {};
          Object.entries(row).forEach(([key, val]) => {
            const field = FIELD_MAP[key.trim()] || key.trim();
            item[field] = String(val ?? '').trim();
          });
          return item;
        });
        setImportData(mapped);
        setImportFileName(file.name);
        message.success(`解析成功，共 ${mapped.length} 条数据`);
      } catch (err) {
        message.error('文件解析失败：' + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
    return false;
  };

  const handleImportConfirm = () => {
    if (importData.length === 0) { message.warning('请先选择要导入的文件'); return; }
    const list = [...shops];
    let added = 0, updated = 0;

    if (importMode === 'add') {
      importData.forEach(row => {
        if (!row.shopName) { return; }
        // 店铺名称重复检查
        const dupName = list.find(s => s.shopName === row.shopName);
        if (dupName) { return; }
        // ERP店铺ID重复检查
        if (row.accountId) {
          const dupId = list.find(s => s.accountId === row.accountId);
          if (dupId) { return; }
        }
        list.push({
          key: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          shopName: row.shopName || '',
          accountId: row.accountId || '',
          platform: row.platform || '',
          brand: row.brand || '',
          companyName: row.companyName || '',
          shopPhone: row.shopPhone || '',
          person: row.person || '',
          remark: row.remark || '',
          shopPassword: row.shopPassword || '',
          createdAt: new Date().toLocaleString('zh-CN'),
        });
        added++;
      });
    } else {
      // 导入更新
      importData.forEach(row => {
        const matchVal = String(row[matchField] || '').trim();
        if (!matchVal) return;
        const idx = list.findIndex(s => String(s[matchField as keyof ShopInfo] || '').trim() === matchVal);
        if (idx >= 0) {
          const updates: any = {};
          Object.entries(row).forEach(([k, v]) => {
            if (k !== 'key' && k !== 'createdAt' && v !== '') updates[k] = v;
          });
          list[idx] = { ...list[idx], ...updates };
          updated++;
        }
      });
    }
    saveShops(list);
    setImportVisible(false);
    setImportData([]);
    setImportFileName('');
    if (importMode === 'add') {
      const skipped = importData.length - added;
      if (skipped > 0) {
        message.info(`导入完成：新增 ${added} 家店铺，跳过 ${skipped} 条（店铺名称或ERP店铺ID重复）`);
      } else {
        message.success(`新增 ${added} 家店铺`);
      }
    } else {
      message.success(`更新 ${updated} 家店铺`);
    }
  };

  // ===================== 过滤 =====================
  const filteredShops = useMemo(() => {
    let list = shops;
    const s = appliedSearch;
    if (s.shopName.trim()) {
      const q = s.shopName.toLowerCase();
      list = list.filter(r => r.shopName.toLowerCase().includes(q));
    }
    if (s.shopNo.trim()) {
      const q = s.shopNo.toLowerCase();
      list = list.filter(r => r.accountId.toLowerCase().includes(q));
    }
    if (s.companyName.trim()) {
      const q = s.companyName.toLowerCase();
      list = list.filter(r => (r.companyName || '').toLowerCase().includes(q));
    }
    if (s.person.trim()) {
      const q = s.person.toLowerCase();
      list = list.filter(r => (r.person || '').toLowerCase().includes(q));
    }
    if (s.phone.trim()) {
      const q = s.phone.toLowerCase();
      list = list.filter(r => (r.shopPhone || '').toLowerCase().includes(q));
    }
    if (s.platform.trim()) {
      const q = s.platform.toLowerCase();
      list = list.filter(r => (r.platform || '').toLowerCase().includes(q));
    }
    return list;
  }, [shops, appliedSearch]);

  // 列宽拖拽调整
  const { wrapColumns } = useResizableColumns<ShopInfo>(`colWidths_shopList_${owner}`);

  // ===================== 表格列 =====================
  const columns: ColumnsType<ShopInfo> = [
    { title: '序号', key: 'seq', width: 60, align: 'center' as const, fixed: 'left' as const,
      render: (_: any, __: any, index: number) => <Text type="secondary">{(shopPage - 1) * shopPageSize + index + 1}</Text> },
    { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 160, fixed: 'left' as const, align: 'left' as const,
      render: (v: string) => <Text strong><ShopOutlined style={{ marginRight: 6, color: PRIMARY }} />{v}</Text> },
    { title: 'ERP店铺ID', dataIndex: 'accountId', key: 'accountId', width: 130, align: 'left' as const,
      render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
    { title: '所属平台', dataIndex: 'platform', key: 'platform', width: 140,
      render: (v: string) => v ? <PlatformBadge name={v} extraPlatforms={customPlatforms} /> : <Text type="secondary">—</Text> },
    { title: '品牌', dataIndex: 'brand', key: 'brand', width: 120,
      render: (v: string) => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text> },
    { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 150,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '店铺手机号', dataIndex: 'shopPhone', key: 'shopPhone', width: 130,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '负责人', dataIndex: 'person', key: 'person', width: 100,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 160, ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '店铺登入密码', dataIndex: 'shopPassword', key: 'shopPassword', width: 130,
      render: (v: string) => v ? <Tag color="orange">••••••</Tag> : <Text type="secondary">—</Text> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
    { title: '操作', key: 'action', width: 140, fixed: 'right' as const,
      render: (_: any, r: ShopInfo) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除此店铺？" description="删除后相关数据不会自动删除"
            onConfirm={() => handleDelete(r.key)} okText="确认" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 弹窗表单字段
  const formFields = [
    { label: '店铺名称', required: true, node: (
      <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="如：天猫旗舰店、拼多多店铺A" />
    )},
    { label: 'ERP店铺ID', required: false, node: (
      <Input value={formId} onChange={e => setFormId(e.target.value)} placeholder="聚水潭/ERP中的店铺标识（选填）" />
    )},
    { label: '所属平台', required: false, node: (
      <Select value={formPlatform || undefined} onChange={v => setFormPlatform(v || '')} placeholder="请选择所属平台"
        allowClear showSearch filterOption={(input, option) =>
          String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
        }
        options={allPlatforms.map(p => ({
          value: p.name, label: p.name,
        }))}
        optionRender={(option) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlatformBadge name={String(option.value || '')} extraPlatforms={customPlatforms} />
          </span>
        )}
        dropdownRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: '4px 0' }} />
            <div style={{ padding: '4px 8px' }}>
              <Button type="link" icon={<PlusOutlined />} onClick={() => {
                setNewPlatformName('');
                setPlatformAddVisible(true);
              }}>新增平台</Button>
            </div>
          </>
        )}
        style={{ width: '100%' }}
      />
    )},
    { label: '品牌', required: false, node: (
      <AutoComplete value={formBrand} onChange={v => setFormBrand(v)} placeholder="请输入或选择品牌名称"
        options={brandOptions} filterOption={(input, option) =>
          String(option?.label || '').toLowerCase().includes(input.toLowerCase())
        }
        notFoundContent={<div style={{ padding: '8px 4px', color: '#888', fontSize: 12 }}>
          {brandOptions.length === 0
            ? <span>暂无品牌数据，请先在 <Text strong style={{ color: '#1677ff' }}>电商常用 → 品牌管理 → 授权品牌/自有品牌 → 品牌台账</Text> 中添加品牌</span>
            : <span>未找到匹配品牌，可手动输入或前往 <Text strong style={{ color: '#1677ff' }}>品牌管理 → 品牌台账</Text> 添加</span>}
        </div>}
        allowClear style={{ width: '100%' }} />
    )},
    { label: '公司名称', required: false, node: (
      <Select value={formCompany || undefined} onChange={v => setFormCompany(v || '')} placeholder="请选择公司名称"
        allowClear showSearch
        filterOption={(input, option) =>
          String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
        }
        options={companyNames.map(n => ({ value: n, label: n }))}
        style={{ width: '100%' }}
        notFoundContent={<Text type="secondary">暂无公司，请点击下方“新增”添加</Text>}
        dropdownRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: '4px 0' }} />
            <div style={{ padding: '4px 8px' }}>
              <Button type="link" icon={<PlusOutlined />} onClick={() => {
                setLicFormName(''); setLicFormTaxpayerCode(''); setLicFormCompanyType('');
                setLicFormRemark(''); setLicFormImage('');
                setLicenseAddVisible(true);
              }}>新增公司</Button>
            </div>
          </>
        )}
      />
    )},
    { label: '店铺手机号', required: false, node: (
      <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="请输入店铺手机号" />
    )},
    { label: '负责人', required: false, node: (
      <Input value={formPerson} readOnly placeholder="点击选择负责人" onClick={() => { loadAccounts(); setPersonPickerVisible(true); }}
        suffix={<TeamOutlined style={{ color: PRIMARY, cursor: 'pointer' }} />}
        style={{ cursor: 'pointer' }} />
    )},
    { label: '备注', required: false, node: (
      <TextArea value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="请输入备注信息" rows={2} />
    )},
    { label: '店铺登入密码', required: false, node: (
      <Input.Password value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder="请输入店铺登入密码" />
    )},
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* 顶部标题 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '16px 24px' }}>
        <Space>
          <ShopOutlined style={{ fontSize: 22, color: PRIMARY }} />
          <Title level={4} style={{ margin: 0, color: PRIMARY }}>店铺列表</Title>
          <Tag color="blue">{shops.length} 家店铺</Tag>
        </Space>
      </Card>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <Space wrap>
          <Input placeholder="店铺名称" value={searchShopName} onChange={e => setSearchShopName(e.target.value)}
            onPressEnter={handleSearch} allowClear style={{ width: 150 }} />
          <Input placeholder="店铺编号" value={searchShopNo} onChange={e => setSearchShopNo(e.target.value)}
            onPressEnter={handleSearch} allowClear style={{ width: 140 }} />
          <Input placeholder="公司名称" value={searchCompanyName} onChange={e => setSearchCompanyName(e.target.value)}
            onPressEnter={handleSearch} allowClear style={{ width: 150 }} />
          <Input placeholder="负责人" value={searchPerson} onChange={e => setSearchPerson(e.target.value)}
            onPressEnter={handleSearch} allowClear style={{ width: 120 }} />
          <Input placeholder="店铺手机号" value={searchPhone} onChange={e => setSearchPhone(e.target.value)}
            onPressEnter={handleSearch} allowClear style={{ width: 150 }} />
          <Select placeholder="所属平台" value={searchPlatform || undefined} onChange={v => setSearchPlatform(v || '')}
            allowClear showSearch style={{ width: 140 }}
            filterOption={(input, option) =>
              String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
            }
            options={allPlatforms.map(p => ({ value: p.name, label: p.name }))} />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} style={{ color: '#fff' }}>查询</Button>
          <Button icon={<ClearOutlined />} onClick={handleReset}>重置</Button>
          <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
          <Button icon={<ImportOutlined />} onClick={() => { setImportData([]); setImportFileName(''); setImportMode('add'); setMatchField('shopName'); setImportVisible(true); }}>导入</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增店铺</Button>
        </Space>
      </Card>

      {/* 主表格 */}
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<ShopInfo>
          bordered
          columns={wrapColumns(columns)}
          dataSource={filteredShops}
          rowKey="key"
          scroll={{ y: 'calc(100vh - 380px)' }}
          pagination={{ current: shopPage, pageSize: shopPageSize, showSizeChanger: true, showTotal: t => `共 ${t} 家店铺`,
                    onChange: (p, ps) => { setShopPage(p); if (ps) setShopPageSize(ps); } }}
          size="middle"
          locale={{ emptyText: '暂无店铺，请点击"新增店铺"添加' }}
        />
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal title={editingShop ? '编辑店铺' : '新增店铺'} open={editVisible}
        onCancel={() => setEditVisible(false)} onOk={handleSave}
        okText={editingShop ? '保存' : '添加'} cancelText="取消" width={520}>
        {formFields.map((f, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 6 }}>
              <Text>{f.label}{f.required && <Text type="danger"> *</Text>}</Text>
            </div>
            {f.node}
          </div>
        ))}
        {editingShop && (
          <div style={{ color: '#888', fontSize: 12 }}>创建时间：{editingShop.createdAt}</div>
        )}
      </Modal>
      {/* 导入弹窗 */}
      <Modal title={<span><ImportOutlined style={{ marginRight: 8, color: PRIMARY }} />导入店铺</span>}
        open={importVisible} onCancel={() => setImportVisible(false)} onOk={handleImportConfirm}
        okText="确认导入" cancelText="取消" width={600}>
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>导入模式</Text>
            <Radio.Group value={importMode} onChange={e => setImportMode(e.target.value)}>
              <Radio.Button value="add">导入新增</Radio.Button>
              <Radio.Button value="update">导入更新</Radio.Button>
            </Radio.Group>
          </div>
          {importMode === 'update' && (
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>匹配字段</Text>
              <Select value={matchField} onChange={v => setMatchField(v)} style={{ width: '100%' }}
                options={MATCH_FIELD_OPTIONS} placeholder="选择用于匹配的字段" />
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                导入数据将根据此字段匹配现有店铺，匹配到的记录将被更新
              </Text>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>选择文件</Text>
            <Upload accept=".xlsx,.xls,.csv" beforeUpload={handleImportFile} showUploadList={false}
              maxCount={1}>
              <Button icon={<UploadOutlined />}>选择 Excel / CSV 文件</Button>
            </Upload>
            {importFileName && (
              <Text type="success" style={{ display: 'block', marginTop: 8 }}>
                ✓ {importFileName}（{importData.length} 条数据）
              </Text>
            )}
          </div>
          {importData.length > 0 && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>数据预览（前5条）</Text>
              <Table size="small" bordered dataSource={importData.slice(0, 5)} rowKey={(_, i) => String(i)}
                scroll={{ x: 600 }} pagination={false}
                columns={[
                  { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 120, ellipsis: true },
                  { title: 'ERP店铺ID', dataIndex: 'accountId', key: 'accountId', width: 100, ellipsis: true },
                  { title: '所属平台', dataIndex: 'platform', key: 'platform', width: 80 },
                  { title: '品牌', dataIndex: 'brand', key: 'brand', width: 80 },
                  { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 100, ellipsis: true },
                  { title: '负责人', dataIndex: 'person', key: 'person', width: 80 },
                ]} />
            </div>
          )}
          <div style={{ background: '#f6f8fa', borderRadius: 6, padding: '10px 14px', marginTop: 12, fontSize: 12, color: '#666' }}>
            <b>支持的表头字段：</b>店铺名称、ERP店铺ID、所属平台、品牌、公司名称、店铺手机号、负责人、备注、店铺登入密码
          </div>
        </div>
      </Modal>

      {/* 负责人选择弹窗 */}
      <Modal title={<span><TeamOutlined style={{ marginRight: 8, color: PRIMARY }} />选择负责人</span>}
        open={personPickerVisible} onCancel={() => setPersonPickerVisible(false)} footer={null} width={480}>
        {accounts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#888' }}>暂无可用账号，请先在账号管理中添加</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
            {accounts.map((acc: any) => (
              <div key={acc.username || acc.id}
                onClick={() => {
                  setFormPerson(acc.displayName || acc.person || acc.username || '');
                  setPersonPickerVisible(false);
                }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${formPerson === (acc.displayName || acc.person) ? PRIMARY : '#f0f0f0'}`,
                  background: formPerson === (acc.displayName || acc.person) ? '#f0f7ff' : '#fff',
                }}>
                <div>
                  <Text strong style={{ fontSize: 14 }}>{acc.displayName || acc.person || acc.username}</Text>
                  {acc.group && <Tag style={{ marginLeft: 8 }}>{acc.group}</Tag>}
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{acc.username}</Text>
                  {acc.role && <Tag color="blue" style={{ marginLeft: 4 }}>{acc.role}</Tag>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 营业执照新增弹窗 */}
      <Modal title="新增营业执照" open={licenseAddVisible}
        onCancel={() => setLicenseAddVisible(false)} onOk={handleLicenseSave}
        okText="添加" cancelText="取消" width={560}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>公司名称 <Text type="danger">*</Text></Text></div>
          <Input value={licFormName} onChange={e => setLicFormName(e.target.value)} placeholder="请输入公司名称" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>纳税人识别码</Text></div>
          <Input value={licFormTaxpayerCode} onChange={e => setLicFormTaxpayerCode(e.target.value)} placeholder="请输入纳税人识别码" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>公司类型</Text></div>
          <Select
            value={licFormCompanyType || undefined}
            onChange={v => setLicFormCompanyType(v)}
            placeholder="请选择公司类型"
            allowClear
            style={{ width: '100%' }}
            options={[
              { value: '小规模纳税人', label: <span style={{ background: '#52c41a', color: '#fff', padding: '2px 10px', borderRadius: 4, fontSize: 13 }}>小规模纳税人</span> },
              { value: '一般纳税人', label: <span style={{ background: '#1677ff', color: '#fff', padding: '2px 10px', borderRadius: 4, fontSize: 13 }}>一般纳税人</span> },
            ]}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>备注</Text></div>
          <Input.TextArea value={licFormRemark} onChange={e => setLicFormRemark(e.target.value)} placeholder="请输入备注信息" rows={3} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>图片 <Text type="secondary" style={{ fontSize: 12 }}>（支持粘贴 Ctrl+V）</Text></Text></div>
          {licFormImage ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Image src={licFormImage} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
              <Button size="small" danger type="text" icon={<DeleteOutlined />}
                onClick={() => setLicFormImage('')}
                style={{ position: 'absolute', top: -8, right: -8 }} />
            </div>
          ) : (
            <div style={{ width: 120, height: 120, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (let i = 0; i < items.length; i++) {
                  if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    if (!blob) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => { setLicFormImage(ev.target?.result as string); };
                    reader.readAsDataURL(blob);
                    break;
                  }
                }
              }}
              tabIndex={0}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'image/*';
                input.onchange = (ev: any) => {
                  const file = ev.target?.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (e) => { setLicFormImage(e.target?.result as string); };
                  reader.readAsDataURL(file);
                };
                input.click();
              }}>
              <div style={{ textAlign: 'center' }}>
                <PictureOutlined style={{ fontSize: 24 }} />
                <div style={{ fontSize: 11, marginTop: 4 }}>点击或Ctrl+V</div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 新增平台弹窗 */}
      <Modal title="新增平台" open={platformAddVisible}
        onCancel={() => setPlatformAddVisible(false)} onOk={handlePlatformAdd}
        okText="添加" cancelText="取消" width={400}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>平台名称 <Text type="danger">*</Text></Text></div>
          <Input value={newPlatformName} onChange={e => setNewPlatformName(e.target.value)}
            placeholder="请输入平台名称" onPressEnter={handlePlatformAdd} />
        </div>
        <div style={{ color: '#999', fontSize: 12 }}>
          添加后将自动生成平台Logo（取名称首字为图标，随机配色）
        </div>
      </Modal>
    </div>
  );
};

export default ShopListPage;
