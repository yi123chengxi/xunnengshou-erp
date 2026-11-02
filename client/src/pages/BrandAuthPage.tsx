import React, { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Form, Row, Col, Tag, message, Statistic, Image as AntdImage, Upload, Dropdown, AutoComplete, Popover, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, FileExcelOutlined, SearchOutlined, QuestionCircleOutlined, SettingOutlined,
  BookOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import ImageSlot from '../components/ImageSlot';
import FieldConfigModal from '../components/FieldConfigModal';
import { useColResize } from '../utils/colResize';
import useStickTableHeight from '../hooks/useStickTableHeight';
import {
  getDataOwner, baKeys, safeJson, writeJson, genKey, todayIso,
  BrandRecord, AUTH_STATUS_OPTS, DEPOSIT_TO_OPTS, SHOP_TYPE_OPTS,
} from '../utils/brandAuth';
import { loadTenantUsers, tenantUserDisplayName } from '../utils/tenantUsers';
import { OwnBrandEditor, type OwnBrand } from './OwnBrandPage';
import dayjs from 'dayjs';

const PRIMARY = '#1e4a7e';

const getDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u?.displayName || u?.contactPerson || u?.name) return u.displayName || u.contactPerson || u.name;
  } catch { /* ignore */ }
  return username || '未知';
};

const emptyRecord = (): BrandRecord => ({
  key: genKey('BR'), filler: '', brandName: '', authStatus: '已经提交给品牌方', companyName: '',
  depositRefunded: '', salesperson: '', shopName: '', authWechat: '', phone: '', depositTo: '品牌方',
  remark: '', platform: '', laierShot: '', brandShot: '', otherRemark: '', license: '', idcard: '',
  guarantee: '', fillTime: todayIso(), image: '', shopType: '分销商店铺', transferred: '', deposit: '',
});

const BrandAuthPage: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const owner = getDataOwner();
  // 表格贴窗底：表体动态测高 + min-height 锁死，横向滚动条/分页贴窗口底部
  const stick = useStickTableHeight();
  // 列宽自由调整：拖拽表头右边缘改宽，按账号持久化
  const { sized } = useColResize(`brandauth_cols_auth_${owner}`);
  // 显示字段设置：勾选显示+顺序调整，按账号持久化
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem(`brandauth_fieldorder_${owner}`); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; } } catch { /* ignore */ }
    return [];
  });
  const [fieldVis, setFieldVis] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem(`brandauth_fieldvis_${owner}`); if (s) { const d = JSON.parse(s); if (d && typeof d === 'object') return d; } } catch { /* ignore */ }
    return {};
  });
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const K = baKeys(owner);
  const [records, setRecords] = useState<BrandRecord[]>(() => safeJson<BrandRecord[]>(baKeys(getDataOwner()).records, []));
  // 按字段搜索：输入态与已应用态分离，回车/点查询才生效；重置清空全部筛选
  const EMPTY_BSEARCH = { brand: '', company: '', shop: '', salesperson: '', phone: '', platform: '' };
  const [bInput, setBInput] = useState({ ...EMPTY_BSEARCH });
  const [bApplied, setBApplied] = useState({ ...EMPTY_BSEARCH });
  const applySearch = () => { reload(); setBApplied({ ...bInput }); };
  const resetSearch = () => {
    setBInput({ ...EMPTY_BSEARCH }); setBApplied({ ...EMPTY_BSEARCH });
    setFStatus(''); setFDepositTo(''); setFDepStatus(''); setFShopType('');
  };
  const [fStatus, setFStatus] = useState('');
  const [fDepositTo, setFDepositTo] = useState('');
  const [fDepStatus, setFDepStatus] = useState('');
  const [fShopType, setFShopType] = useState('');
  const [customDepositTo, setCustomDepositTo] = useState<string[]>([]);
  const allDepositToOpts = useMemo(() => [...DEPOSIT_TO_OPTS, ...customDepositTo], [customDepositTo]);
  const salespersonOpts = useMemo(() =>
    loadTenantUsers().map(u => ({ value: tenantUserDisplayName(u), label: `${tenantUserDisplayName(u)}${u.isSubAccount ? '' : '（管理员）'}` })),
  []);
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<BrandRecord | null>(null);
  const [form] = Form.useForm();
  // 保证金退回图片弹窗
  const [depositReturnTarget, setDepositReturnTarget] = useState<BrandRecord | null>(null);
  const [depositReturnImages, setDepositReturnImages] = useState<string[]>([]);
  // 已申请状态弹窗（点击单元格打开：显示金额 + 上传图片 + 已退回按钮）
  const [depositAppliedModal, setDepositAppliedModal] = useState<BrandRecord | null>(null);
  const [depositAppliedImages, setDepositAppliedImages] = useState<string[]>([]);
  const [depositAppliedRemark, setDepositAppliedRemark] = useState('');
  // 保证金信息查看弹窗（已退回/已到账/待确认状态点击查看）
  const [depositViewModal, setDepositViewModal] = useState<BrandRecord | null>(null);

  // 品牌台账（授权品牌页独立，与自有品牌台账数据隔离）
  const authLedgerKey = `brandauth_auth_brandledger_${owner}`;
  const [ownBrands, setOwnBrands] = useState<OwnBrand[]>(() => safeJson<OwnBrand[]>(authLedgerKey, []));
  const [brandLedgerVisible, setBrandLedgerVisible] = useState(false);
  const brandNameOpts = useMemo(() =>
    ownBrands.map(b => ({ value: b.brandName, label: `${b.brandName}${b.trademarkNo ? ` (${b.trademarkNo})` : ''}` })),
  [ownBrands]);

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDepositReturnImages(prev => [...prev, reader.result as string]);
      }
    };
    reader.readAsDataURL(file);
  };
  const handlePasteImage = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (blob) handleImageFile(blob);
      }
    }
  };

  const reload = () => {
    setRecords(safeJson<BrandRecord[]>(K.records, []));
    setOwnBrands(safeJson<OwnBrand[]>(authLedgerKey, []));
  };
  useEffect(() => { reload(); }, [owner]);
  useEffect(() => {
    const onSync = () => reload();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [K.records]);

  const save = (list: BrandRecord[]) => { setRecords(list); writeJson(K.records, list); window.dispatchEvent(new Event('sync-data-updated')); };

  const filtered = useMemo(() => records.filter(r => {
    if (fStatus && r.authStatus !== fStatus) return false;
    if (fDepositTo && r.depositTo !== fDepositTo) return false;
    if (fDepStatus && (fDepStatus === 'none' ? !!r.depositStatus : (r.depositStatus || '') !== fDepStatus)) return false;
    if (fShopType && r.shopType !== fShopType) return false;
    const kw = (s: string) => s.trim().toLowerCase();
    const hit = (v: string | undefined, k: string) => !k || (v || '').toLowerCase().includes(k);
    if (!hit(r.brandName, kw(bApplied.brand))) return false;
    if (!hit(r.companyName, kw(bApplied.company))) return false;
    if (!hit(r.shopName, kw(bApplied.shop))) return false;
    if (!hit(r.salesperson, kw(bApplied.salesperson))) return false;
    if (!hit(r.phone, kw(bApplied.phone))) return false;
    if (!hit(r.platform, kw(bApplied.platform))) return false;
    return true;
  }).sort((a, b) => (b.fillTime || '').localeCompare(a.fillTime || '')), [records, bApplied, fStatus, fDepositTo, fDepStatus, fShopType]);

  const stats = useMemo(() => ({
    total: records.length,
    sent: records.filter(r => r.authStatus === '授权已发').length,
    submitted: records.filter(r => r.authStatus === '已经提交给品牌方').length,
    quit: records.filter(r => r.authStatus === '已退店').length,
    distributor: records.filter(r => r.shopType === '分销商店铺').length,
  }), [records]);

  const openAdd = () => { setEditing(null); form.setFieldsValue({ ...emptyRecord(), creator: getDisplayName() }); setVisible(true); };
  const openEdit = (r: BrandRecord) => { setEditing(r); form.setFieldsValue({ ...r }); setVisible(true); };
  const handleSave = () => {
    form.validateFields().then(v => {
      const rec: BrandRecord = { ...(editing || emptyRecord()), ...v, key: editing?.key || genKey('BR') };
      if (!editing) rec.creator = rec.creator || getDisplayName();
      if (!rec.fillTime) rec.fillTime = todayIso();
      const list = editing ? records.map(x => (x.key === editing.key ? rec : x)) : [rec, ...records];
      save(list);
      setVisible(false);
      message.success(editing ? '已保存' : '已新增');
    });
  };
  const handleDelete = (r: BrandRecord) => save(records.filter(x => x.key !== r.key));
  const quickSetAuthStatus = (r: BrandRecord, status: string) => {
    const list = records.map(x => x.key === r.key ? { ...x, authStatus: status } : x);
    save(list);
    message.success(`已更新为「${status}」`);
  };

  // ========== 保证金退回流程 ==========
  const handleDepositApply = (r: BrandRecord) => {
    const receiptKey = `ba-deposit-${r.key}`;
    const list = records.map(x => x.key === r.key
      ? { ...x, depositStatus: 'applied' as const, depositReceiptKey: receiptKey } : x);
    save(list);
    message.success('保证金退回已申请，请点击单元格上传图片并确认退回');
  };


  const handleDepositReturn = (r: BrandRecord) => {
    setDepositReturnTarget(r);
    setDepositReturnImages(r.depositReturnImages || []);
  };
  const confirmDepositReturn = () => {
    if (!depositReturnTarget) return;
    const list = records.map(x => x.key === depositReturnTarget.key
      ? { ...x, depositStatus: 'returned' as const, depositReturnImages } : x);
    save(list);
    setDepositReturnTarget(null);
    message.success('保证金已标记为已退回');
  };

  // 已申请状态：点击单元格打开弹窗
  const openDepositAppliedModal = (r: BrandRecord) => {
    setDepositAppliedModal(r);
    setDepositAppliedImages(r.depositReturnImages || []);
    setDepositAppliedRemark(r.depositRemark || '');
  };
  // 已申请状态弹窗中点击“已退回”：创建收款确认单 + 保存图片 + 更新状态
  const handleAppliedReturnConfirm = () => {
    if (!depositAppliedModal) return;
    const recOwner = getDataOwner();
    const username = localStorage.getItem('username') || '';
    const storageKey = `payment_requests_${recOwner}`;
    let payReqs: any[] = [];
    try { payReqs = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { /* ignore */ }
    const skPrefix = `SK${dayjs().format('YYYYMMDD')}`;
    const skSeqs = payReqs.filter((pr: any) => pr.requestNo?.startsWith(skPrefix)).map((pr: any) => parseInt(pr.requestNo.slice(-3), 10) || 0);
    const requestNo = `${skPrefix}${String((skSeqs.length ? Math.max(...skSeqs) : 0) + 1).padStart(3, '0')}`;
    const amount = Number(depositAppliedModal.deposit) || 0;
    const rec: any = {
      key: `recvreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo, amount, category: '保证金退回',
      description: `品牌保证金退回 — ${depositAppliedModal.companyName || depositAppliedModal.brandName}`,
      recvType: 'bank', recvAccountName: depositAppliedModal.companyName || '', source: 'manual',
      status: 'pending_confirm', recordType: 'receipt',
      payerName: depositAppliedModal.companyName || depositAppliedModal.brandName || '',
      applicant: username, applicantName: getDisplayName(),
      applyDate: dayjs().format('YYYY-MM-DD'),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      brandAuthKey: depositAppliedModal.key,
    };
    try {
      const updated = [rec, ...payReqs];
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch { /* ignore */ }
    const list = records.map(x => x.key === depositAppliedModal.key
      ? { ...x, depositStatus: 'pending_confirm' as const, depositReturnImages: depositAppliedImages, depositRemark: depositAppliedRemark } : x);
    save(list);
    setDepositAppliedModal(null);
    message.success('已标记为已退回：收款确认单已创建，等待财务确认到账');
  };
  
  // 已申请弹窗中单独保存备注（不触发退回）
  const handleSaveAppliedRemark = () => {
    if (!depositAppliedModal) return;
    const list = records.map(x => x.key === depositAppliedModal.key
      ? { ...x, depositReturnImages: depositAppliedImages, depositRemark: depositAppliedRemark } : x);
    save(list);
    message.success('备注已保存');
  };

  // ========== 同步保证金状态（收款确认后自动更新） ==========
  useEffect(() => {
    const syncDepositStatus = () => {
      const recOwner = getDataOwner();
      let payReqs: any[] = [];
      try { payReqs = JSON.parse(localStorage.getItem(`payment_requests_${recOwner}`) || '[]'); } catch { /* ignore */ }
      let updated = false;
      const newRecords = records.map(r => {
        if (!r.depositReceiptKey || r.depositStatus !== 'pending_confirm') return r;
        const linked = payReqs.find((pr: any) => pr.brandAuthKey === r.key && pr.recordType === 'receipt');
        if (linked?.status === 'confirmed') { updated = true; return { ...r, depositStatus: 'received' as const }; }
        return r;
      });
      if (updated) { setRecords(newRecords); writeJson(K.records, newRecords); }
    };
    syncDepositStatus();
    window.addEventListener('sync-data-updated', syncDepositStatus);
    window.addEventListener('storage', syncDepositStatus);
    return () => {
      window.removeEventListener('sync-data-updated', syncDepositStatus);
      window.removeEventListener('storage', syncDepositStatus);
    };
  }, [records, K.records]);

  // ============ Excel 导入/导出 ============
  const EXPORT_HEADERS = ['品牌名称', '是否授权', '公司名称', '业务员', '店铺名称', '授权人微信', '手机号码', '保证金去向', '保证金', '备注', '授权平台', '其他备注', '店铺类型'];
  const handleExport = () => {
    const rows = filtered.map(r => ({
      '品牌名称': r.brandName, '是否授权': r.authStatus, '公司名称': r.companyName,
      '业务员': r.salesperson, '店铺名称': r.shopName,
      '授权人微信': r.authWechat, '手机号码': r.phone, '保证金去向': r.depositTo, '保证金': r.deposit || '', '备注': r.remark,
      '授权平台': r.platform, '其他备注': r.otherRemark, '店铺类型': r.shopType,
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: EXPORT_HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '登记表');
    XLSX.writeFile(wb, `品牌授权登记表_${todayIso()}.xlsx`);
    message.success('已导出');
  };
  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const added: BrandRecord[] = rows.map(r => ({
          ...emptyRecord(),
          key: genKey('BR'),
          filler: String(r['填写人'] || ''), brandName: String(r['品牌名称'] || ''), authStatus: String(r['是否授权'] || '已经提交给品牌方'),
          companyName: String(r['公司名称'] || ''), depositRefunded: String(r['品牌方保证金是否退回'] || ''), salesperson: String(r['业务员'] || ''),
          shopName: String(r['店铺名称'] || ''), authWechat: String(r['授权人微信'] || ''), phone: String(r['手机号码'] || ''),
          depositTo: String(r['保证金交哪里'] || r['保证金去向'] || r['我方收'] || '品牌方'), remark: String(r['备注'] || ''), platform: String(r['授权平台'] || ''),
          otherRemark: String(r['其他备注'] || ''), fillTime: String(r['填写时间'] || todayIso()),
          shopType: String(r['单选'] || r['店铺类型'] || '分销商店铺'), transferred: String(r['单选 2'] || r['单选2'] || ''),
          deposit: String(r['保证金'] || ''),
        }));
        save([...added, ...records]);
        message.success(`已导入 ${added.length} 条`);
      } catch { message.error('导入失败，请检查文件格式'); }
    };
    reader.readAsArrayBuffer(file);
    return false;
  };

  const imgCol = (title: string, field: keyof BrandRecord, width = 90): ColumnsType<BrandRecord>[number] => ({
    title, dataIndex: field as string, key: field as string, width, align: 'center',
    render: (v: string) => (v ? <AntdImage src={v} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ color: '#ccc' }}>—</span>),
  });

  const columns: ColumnsType<BrandRecord> = [
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, align: 'center', render: (v: string, r: BrandRecord) => v || r.filler || '—' },
    { title: '品牌名称', dataIndex: 'brandName', key: 'brandName', width: 100, align: 'center', render: v => <Tag color="blue">{v || '—'}</Tag> },
    {
      title: '是否授权', dataIndex: 'authStatus', key: 'authStatus', width: 140, align: 'center',
      render: (v: string, r: BrandRecord) => (
        <Dropdown menu={{
          items: AUTH_STATUS_OPTS.map(opt => ({ key: opt, label: opt })),
          onClick: ({ key }) => quickSetAuthStatus(r, key),
        }} trigger={['click']}>
          <Button type="link" size="small">
            <Tag color={v === '授权已发' ? 'green' : v === '已退店' ? 'red' : 'orange'} style={{ cursor: 'pointer' }}>{v || '点击选择'}</Tag>
          </Button>
        </Dropdown>
      ),
    },
    { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 180, ellipsis: true },
    {
      title: <span>店铺类型 <Tooltip title="公司内部店铺：保证金由我方代付，系统自动登记其他应收款台账并记账；分销商店铺：保证金由分销商自行支付，系统仅记录状态不记账"><QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} /></Tooltip></span>,
      dataIndex: 'shopType', key: 'shopType', width: 110, align: 'center',
      render: v => <Tag color={v === '公司内部店铺' ? 'purple' : 'cyan'}>{v || '—'}</Tag>,
    },
    { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 170, ellipsis: true },
    { title: '授权平台', dataIndex: 'platform', key: 'platform', width: 90, align: 'center' },
    { title: '业务员', dataIndex: 'salesperson', key: 'salesperson', width: 90, align: 'center' },
    { title: '授权人微信', dataIndex: 'authWechat', key: 'authWechat', width: 110, ellipsis: true },
    { title: '手机号码', dataIndex: 'phone', key: 'phone', width: 130, align: 'center' },
    { title: '保证金去向', dataIndex: 'depositTo', key: 'depositTo', width: 120, align: 'center' },
    { title: <span>保证金 <Tooltip title="公司内部店铺：保证金标记退回时自动登记其他应收款台账并记账（简易/会计账薄均联动）；分销商店铺：仅变更保证金状态，不记账不生成收付款确认单"><QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} /></Tooltip></span>, dataIndex: 'deposit', key: 'deposit', width: 130, align: 'center',
      render: (v: string, r: BrandRecord) => {
        const amount = v || '0';
        const ds = r.depositStatus;
        if (!v && !ds) return <span style={{ color: '#ccc' }}>—</span>;
        const clickable = ['received', 'returned', 'pending_confirm', 'applied'].includes(ds || '');
        const tagColors: Record<string, string> = { received: 'green', returned: 'orange', pending_confirm: 'cyan', applied: 'orange' };
        const tagLabels: Record<string, string> = { received: '已到账', returned: '已退回', pending_confirm: '待确认', applied: '已申请' };
        return (
          <div style={clickable ? { cursor: 'pointer' } : undefined}
            onClick={clickable ? () => {
              if (ds === 'applied') openDepositAppliedModal(r);
              else setDepositViewModal(r);
            } : undefined}>
            <div style={{ fontWeight: 600 }}>{amount}</div>
            {ds && <Tag color={tagColors[ds] || 'default'} style={{ marginTop: 2 }}>{tagLabels[ds] || ds}</Tag>}
          </div>
        );
        // 无保证金状态：显示金额 + 去申请操作
        return (
          <div>
            <div style={{ fontWeight: 600 }}>{amount}</div>
            <Popover trigger="click" placement="bottom" content={
              <Space direction="vertical" size={4}>
                <Button type="link" size="small" onClick={() => handleDepositApply(r)}>已申请退回</Button>
                <Button type="link" size="small" onClick={() => handleDepositReturn(r)}>已退回</Button>
              </Space>
            }>
              <Button type="link" size="small" style={{ fontSize: 11, padding: '0 4px', height: 22 }}>去申请</Button>
            </Popover>
          </div>
        );
      },
    },
    imgCol('转我方截图', 'laierShot'),
    imgCol('转账品牌方截图', 'brandShot'),
    imgCol('营业执照', 'license'),
    imgCol('身份证', 'idcard'),
    imgCol('保证书', 'guarantee'),
    imgCol('图片', 'image'),
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 140, ellipsis: true },
    { title: '其他备注', dataIndex: 'otherRemark', key: 'otherRemark', width: 140, ellipsis: true },
    {
      title: '操作', key: 'action', width: 120, align: 'center', fixed: 'right',
      render: (_v, r) => (
        <Space size={0}>
          <Button type="link" size="small" style={{ padding: '0 4px' }} icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" style={{ padding: '0 4px' }} danger icon={<DeleteOutlined />}
            onClick={() => Modal.confirm({ title: '确定删除该授权记录？', content: r.companyName || r.brandName, onOk: () => handleDelete(r) })}>删除</Button>
        </Space>
      ),
    },
  ];

  // 显示字段设置：字段清单（不含操作列）+ 按顺序/勾选派生显示列
  const authFields = useMemo(() => columns
    .filter(c => c.key && c.key !== 'action')
    .map(c => ({ key: String(c.key), label: typeof c.title === 'string' ? c.title : String(c.key) })), [columns]);
  const authFieldVisResolved = useMemo(() => {
    const d: Record<string, boolean> = {};
    authFields.forEach(f => { d[f.key] = fieldVis[f.key] !== false; });
    return d;
  }, [authFields, fieldVis]);
  const visibleColumns = useMemo(() => {
    const byKey = new Map(columns.map(c => [String(c.key), c]));
    const allKeys = columns.filter(c => c.key && c.key !== 'action').map(c => String(c.key));
    const order = [...fieldOrder.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !fieldOrder.includes(k))];
    const list = order.filter(k => fieldVis[k] !== false).map(k => byKey.get(k)!).filter(Boolean);
    const actionCol = columns.find(c => c.key === 'action');
    return actionCol ? [...list, actionCol] : list;
  }, [columns, fieldOrder, fieldVis]);
  const saveFieldCfg = (order: string[], vis: Record<string, boolean>) => {
    setFieldOrder(order); setFieldVis(vis);
    try { localStorage.setItem(`brandauth_fieldorder_${owner}`, JSON.stringify(order)); localStorage.setItem(`brandauth_fieldvis_${owner}`, JSON.stringify(vis)); } catch { /* ignore */ }
    setFieldCfgVisible(false);
    message.success('字段设置已保存');
  };

  return (
    <div style={embedded ? { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { padding: 12 }}>
      <Row gutter={12} style={{ marginBottom: 12, background: '#f7f9fc', borderRadius: 6, padding: '8px 12px', flexShrink: 0 }}>
        <Col flex="1 1 140px"><Statistic title="总记录" value={stats.total} suffix="条" /></Col>
        <Col flex="1 1 140px"><Statistic title="授权已发" value={stats.sent} suffix="条" valueStyle={{ color: '#52c41a' }} /></Col>
        <Col flex="1 1 140px"><Statistic title="已提交品牌方" value={stats.submitted} suffix="条" valueStyle={{ color: '#fa8c16' }} /></Col>
        <Col flex="1 1 140px"><Statistic title="已退店" value={stats.quit} suffix="条" valueStyle={{ color: '#f5222d' }} /></Col>
        <Col flex="1 1 140px"><Statistic title="分销商店铺" value={stats.distributor} suffix="条" valueStyle={{ color: PRIMARY }} /></Col>
      </Row>

      <Space wrap style={{ marginBottom: 12, flexShrink: 0 }}>
        <Input placeholder="品牌名称" style={{ width: 130 }} value={bInput.brand} onPressEnter={applySearch} allowClear
          onChange={e => setBInput(s => ({ ...s, brand: e.target.value }))} />
        <Input placeholder="公司名称" style={{ width: 150 }} value={bInput.company} onPressEnter={applySearch} allowClear
          onChange={e => setBInput(s => ({ ...s, company: e.target.value }))} />
        <Input placeholder="店铺名称" style={{ width: 140 }} value={bInput.shop} onPressEnter={applySearch} allowClear
          onChange={e => setBInput(s => ({ ...s, shop: e.target.value }))} />
        <Input placeholder="业务员" style={{ width: 110 }} value={bInput.salesperson} onPressEnter={applySearch} allowClear
          onChange={e => setBInput(s => ({ ...s, salesperson: e.target.value }))} />
        <Input placeholder="手机号码" style={{ width: 120 }} value={bInput.phone} onPressEnter={applySearch} allowClear
          onChange={e => setBInput(s => ({ ...s, phone: e.target.value }))} />
        <Input placeholder="授权平台" style={{ width: 120 }} value={bInput.platform} onPressEnter={applySearch} allowClear
          onChange={e => setBInput(s => ({ ...s, platform: e.target.value }))} />
        <Select placeholder="是否授权" style={{ width: 150 }} value={fStatus || undefined} onChange={v => setFStatus(v || '')} allowClear options={AUTH_STATUS_OPTS.map(x => ({ value: x, label: x }))} />
        <Select placeholder="保证金去向" style={{ width: 150 }} value={fDepositTo || undefined} onChange={v => setFDepositTo(v || '')} allowClear options={allDepositToOpts.map(x => ({ value: x, label: x }))} />
        <Select placeholder="保证金状态" style={{ width: 130 }} value={fDepStatus || undefined} onChange={v => setFDepStatus(v || '')} allowClear
          options={[{ value: 'received', label: '已到账' }, { value: 'returned', label: '已退回' }, { value: 'pending_confirm', label: '待确认' }, { value: 'applied', label: '已申请' }, { value: 'none', label: '未登记' }]} />
        <Select placeholder="店铺类型" style={{ width: 150 }} value={fShopType || undefined} onChange={v => setFShopType(v || '')} allowClear options={SHOP_TYPE_OPTS.map(x => ({ value: x, label: x }))} />
        <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>查询</Button>
        <Button onClick={resetSearch}>重置</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增授权</Button>
        <Button icon={<BookOutlined />} onClick={() => setBrandLedgerVisible(true)}>品牌台账</Button>
        <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImport}>
          <Button icon={<FileExcelOutlined />}>导入Excel</Button>
        </Upload>
        <Button icon={<FileExcelOutlined />} onClick={handleExport}>导出Excel</Button>
        <Button icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示字段</Button>
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </Space>

      <div ref={stick.ref} style={{ flex: 1, minHeight: 0 }}>
        <Table rowKey="key" size="small" bordered columns={sized(visibleColumns)} dataSource={filtered}
          scroll={{ x: 2400, y: stick.scrollY }} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }} />
      </div>

      <Modal title={editing ? '编辑授权记录' : '新增授权记录'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={860} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={6}><Form.Item name="brandName" label="品牌名称" rules={[{ required: true, message: '必填' }]}><AutoComplete options={brandNameOpts} placeholder="选择或输入品牌名称" filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={6}><Form.Item name="shopType" label={<span>店铺类型 <Tooltip title="公司内部店铺：保证金由我方代付，标记退回时自动登记其他应收款台账并记账；分销商店铺：保证金由分销商自行支付，仅记录状态不记账"><QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} /></Tooltip></span>}><Select options={SHOP_TYPE_OPTS.map(x => ({ value: x, label: x }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="companyName" label="公司名称"><Input placeholder="被授权公司" /></Form.Item></Col>
            <Col span={6}><Form.Item name="salesperson" label="业务员"><AutoComplete options={salespersonOpts} placeholder="选择或输入" filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={6}><Form.Item name="authWechat" label="授权人微信"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="phone" label="手机号码"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="depositTo" label="保证金去向"><Select options={allDepositToOpts.map(x => ({ value: x, label: x }))} /></Form.Item></Col>
            <Col span={6}><Form.Item name="deposit" label={<span>保证金 <Tooltip title="公司内部店铺：标记退回时自动记账并登记其他应收款台账；分销商店铺：仅记录金额和状态，不参与记账"><QuestionCircleOutlined style={{ color: '#999', cursor: 'pointer' }} /></Tooltip></span>}><Input placeholder="如 5000" /></Form.Item></Col>
            <Col span={8}><Form.Item name="shopName" label="店铺名称"><Input placeholder="店铺名称" /></Form.Item></Col>
            <Col span={8}><Form.Item name="platform" label="授权平台"><Input placeholder="如 拼多多/抖音" /></Form.Item></Col>
            <Col span={24}>
              <Form.Item label="证照/截图图片">
                <Space size={16} wrap>
                  <div><div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>转我方截图</div><Form.Item name="laierShot" noStyle><ImageSlot tip="截图" /></Form.Item></div>
                  <div><div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>转账品牌方截图</div><Form.Item name="brandShot" noStyle><ImageSlot tip="截图" /></Form.Item></div>
                  <div><div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>营业执照</div><Form.Item name="license" noStyle><ImageSlot tip="执照" /></Form.Item></div>
                  <div><div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>身份证</div><Form.Item name="idcard" noStyle><ImageSlot tip="身份证" /></Form.Item></div>
                  <div><div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>保证书</div><Form.Item name="guarantee" noStyle><ImageSlot tip="保证书" /></Form.Item></div>
                  <div><div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>图片</div><Form.Item name="image" noStyle><ImageSlot tip="图片" /></Form.Item></div>
                </Space>
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item></Col>
            <Col span={12}><Form.Item name="otherRemark" label="其他备注"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 保证金退回图片上传弹窗 */}
      <Modal title="保证金退回 — 上传凭证" open={!!depositReturnTarget} onOk={confirmDepositReturn}
        onCancel={() => setDepositReturnTarget(null)} okText="确认退回" cancelText="取消" width={520} destroyOnClose>
        <div tabIndex={0} onPaste={handlePasteImage}
          style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 16, minHeight: 120, outline: 'none', cursor: 'pointer', background: '#fafafa' }}>
          <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>点击「粘贴」或 Ctrl+V 粘贴截图，也可点击下方按钮上传文件（最多5张）</div>
          <Space size={12} wrap>
            {depositReturnImages.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', width: 88, height: 88 }}>
                <AntdImage src={img} width={88} height={88} style={{ objectFit: 'cover', borderRadius: 4 }} />
                <Button type="text" danger size="small" icon={<DeleteOutlined />}
                  style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', width: 20, height: 20, minWidth: 20, padding: 0, fontSize: 10 }}
                  onClick={() => setDepositReturnImages(prev => prev.filter((_, i) => i !== idx))} />
              </div>
            ))}
            {depositReturnImages.length < 5 && (
              <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => { handleImageFile(file); return false; }}>
                <div style={{ width: 88, height: 88, border: '1px dashed #d9d9d9', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}>
                  <PlusOutlined style={{ fontSize: 18 }} />
                  <span style={{ fontSize: 11, marginTop: 4 }}>上传</span>
                </div>
              </Upload>
            )}
          </Space>
          <div style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => {
              const el = document.querySelector('[data-paste-zone]') as HTMLElement;
              if (el) el.focus();
              navigator.clipboard?.read?.().then(items => {
                for (const item of items) {
                  for (const type of item.types) {
                    if (type.startsWith('image/')) {
                      item.getType(type).then(blob => handleImageFile(blob as File));
                    }
                  }
                }
              }).catch(() => message.info('请使用 Ctrl+V 粘贴图片'));
            }}>粘贴</Button>
          </div>
        </div>
      </Modal>

      {/* 已申请状态弹窗：显示金额 + 上传图片 + 已退回按钮 */}
      <Modal title={`保证金退回 — ${depositAppliedModal?.companyName || depositAppliedModal?.brandName || ''}`}
        open={!!depositAppliedModal} onCancel={() => setDepositAppliedModal(null)}
        footer={[
          <Button key="saveRemark" onClick={handleSaveAppliedRemark}>保存备注</Button>,
          <Button key="return" type="primary" icon={<DeleteOutlined />} onClick={handleAppliedReturnConfirm}>已退回</Button>,
          <Button key="close" onClick={() => setDepositAppliedModal(null)}>关闭</Button>,
        ]} width={520} destroyOnClose>
        {depositAppliedModal && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14, color: '#666' }}>保证金金额：</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#f5222d' }}>¥{depositAppliedModal.deposit || '0'}</span>
            </div>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#888' }}>上传退回凭证图片（点击「粘贴」或 Ctrl+V 粘贴截图，最多5张）：</div>
            <div tabIndex={0} onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                  e.preventDefault();
                  const blob = items[i].getAsFile();
                  if (blob) {
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        setDepositAppliedImages(prev => prev.length < 5 ? [...prev, reader.result as string] : prev);
                      }
                    };
                    reader.readAsDataURL(blob);
                  }
                }
              }
            }}
              style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 16, minHeight: 120, outline: 'none', cursor: 'pointer', background: '#fafafa' }}>
              <Space size={12} wrap>
                {depositAppliedImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: 88, height: 88 }}>
                    <AntdImage src={img} width={88} height={88} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    <Button type="text" danger size="small" icon={<DeleteOutlined />}
                      style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', width: 20, height: 20, minWidth: 20, padding: 0, fontSize: 10 }}
                      onClick={() => setDepositAppliedImages(prev => prev.filter((_, i) => i !== idx))} />
                  </div>
                ))}
                {depositAppliedImages.length < 5 && (
                  <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        setDepositAppliedImages(prev => prev.length < 5 ? [...prev, reader.result as string] : prev);
                      }
                    };
                    reader.readAsDataURL(file);
                    return false;
                  }}>
                    <div style={{ width: 88, height: 88, border: '1px dashed #d9d9d9', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}>
                      <PlusOutlined style={{ fontSize: 18 }} />
                      <span style={{ fontSize: 11, marginTop: 4 }}>上传</span>
                    </div>
                  </Upload>
                )}
              </Space>
              <div style={{ marginTop: 8 }}>
                <Button size="small" onClick={() => {
                  navigator.clipboard?.read?.().then(items => {
                    for (const item of items) {
                      for (const type of item.types) {
                        if (type.startsWith('image/')) {
                          item.getType(type).then(blob => {
                            const reader = new FileReader();
                            reader.onload = () => {
                              if (typeof reader.result === 'string') {
                                setDepositAppliedImages(prev => prev.length < 5 ? [...prev, reader.result as string] : prev);
                              }
                            };
                            reader.readAsDataURL(blob as File);
                          });
                        }
                      }
                    }
                  }).catch(() => message.info('请使用 Ctrl+V 粘贴图片'));
                }}>粘贴</Button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>备注：</div>
              <Input.TextArea rows={3} placeholder="请输入备注信息" value={depositAppliedRemark}
                onChange={e => setDepositAppliedRemark(e.target.value)} />
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, fontSize: 12, color: '#d48806' }}>
              点击「已退回」将自动在收/付申请页面创建收款确认单，等待财务确认到账后保证金将显示为“已到账”。
            </div>
          </div>
        )}
      </Modal>

      {/* 保证金信息查看弹窗（已退回/已到账/待确认状态点击查看） */}
      <Modal title={`保证金信息 — ${depositViewModal?.companyName || depositViewModal?.brandName || ''}`}
        open={!!depositViewModal} onCancel={() => setDepositViewModal(null)}
        footer={[<Button key="close" onClick={() => setDepositViewModal(null)}>关闭</Button>]}
        width={520} destroyOnClose>
        {depositViewModal && (() => {
          const ds = depositViewModal.depositStatus;
          const tagColors: Record<string, string> = { received: 'green', returned: 'orange', pending_confirm: 'cyan' };
          const tagLabels: Record<string, string> = { received: '已到账', returned: '已退回', pending_confirm: '待确认' };
          const images = depositViewModal.depositReturnImages || [];
          const remark = depositViewModal.depositRemark || '';
          return (
            <div>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, color: '#666' }}>保证金金额：</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#f5222d' }}>¥{depositViewModal.deposit || '0'}</span>
                {ds && <Tag color={tagColors[ds] || 'default'} style={{ marginLeft: 8 }}>{tagLabels[ds] || ds}</Tag>}
              </div>
              {images.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>凭证图片：</div>
                  <Space size={8} wrap>
                    {images.map((img, idx) => (
                      <AntdImage key={idx} src={img} width={88} height={88} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ))}
                  </Space>
                </div>
              )}
              {remark && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#888' }}>备注：</div>
                  <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>{remark}</div>
                </div>
              )}
              {images.length === 0 && !remark && (
                <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: 24 }}>暂无上传凭证和备注信息</div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* 显示字段设置（勾选显示+上下箭头/拖动调序） */}
      <FieldConfigModal
        open={fieldCfgVisible}
        fields={authFields}
        order={fieldOrder}
        visibility={authFieldVisResolved}
        onSave={saveFieldCfg}
        onCancel={() => setFieldCfgVisible(false)}
        title="显示字段设置 - 授权品牌"
      />

      {/* 品牌台账 */}
      <Modal title="品牌台账" open={brandLedgerVisible} onCancel={() => setBrandLedgerVisible(false)} footer={null} width={900}>
        <OwnBrandEditor brands={ownBrands} onChange={(l) => { setOwnBrands(l); writeJson(authLedgerKey, l); window.dispatchEvent(new Event('sync-data-updated')); }} />
      </Modal>
    </div>
  );
};

export default BrandAuthPage;
