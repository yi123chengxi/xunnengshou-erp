import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Form, Row, Col, Tag, message, Statistic, Image as AntdImage,
  DatePicker, Typography, Divider, Tooltip, AutoComplete, InputNumber, Switch, Descriptions, Upload, Radio, Checkbox, Card,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, LinkOutlined, CopyOutlined,
  FileProtectOutlined, PrinterOutlined, BankOutlined, SafetyCertificateOutlined, CheckCircleOutlined, PictureOutlined, RollbackOutlined,
  UploadOutlined, RedoOutlined, BarChartOutlined, TeamOutlined, ArrowLeftOutlined, SearchOutlined,
  CloseCircleOutlined, InboxOutlined, QuestionCircleOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import ImageSlot from '../components/ImageSlot';
import { compressImageFile, recompressDataUrl, OVERSIZE_DATAURL_CHARS } from '../utils/imageCompress';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import {
  getDataOwner, baKeys, safeJson, writeJson, genKey, todayCn, todayIso, genAuthNo, genShareCode, genAppNo,
  buildAuthNo, defaultAuthFmt, authFmtKey, AuthNoFmt,
  BrandApplication, BrandTemplate, RecvAccount, defaultTemplate, defaultAgreementTemplate, publishAgreement, agreementDocKey,
  AGENT_FIELDS, SYSTEM_FIELDS, buildCertValues, printHtml, publishCert, publishAppMirror,
  DEFAULT_CERT_STYLE, FONT_OPTIONS, CertStyle, bodyToHtml, substituteTokens, buildCertPageHtml,
  DEFAULT_WATERMARK, WatermarkCfg, buildWatermarkHtml, applyBlockTypography,
  SHOP_TYPES, shopTypeStyle,
  BrandRefundReq, fetchRefundReqs, refundReqKey,
  BrandMaterial, publishBrandMats,
  BrandRenewReq, fetchRenewReqs, renewReqKey,
  BrandSalesRecord, fetchSalesRecords,
  managersKey,
} from '../utils/brandAuth';
import { loadTenantUsers } from '../utils/tenantUsers';
import { pushBankTransaction, isAccountingMode, writeAutoEntries } from '../utils/accountingBridge';
import { useColResize } from '../utils/colResize';
import { copyText } from '../utils/clipboard';
import useStickTableHeight from '../hooks/useStickTableHeight';
import FieldConfigModal from '../components/FieldConfigModal';

const { Text } = Typography;
// A4 纸 @96dpi 像素尺寸（210×297mm），预览视窗等比缩放基准
const A4_W = 794;
const A4_H = 1123;

export interface OwnBrand { key: string; brandName: string; trademarkNo: string; category: string; signCompany: string; isExclusive?: string; materials?: BrandMaterial[]; }

// 预览用公司名称脱敏：隐藏中间部分（仅预览示例，不影响生成结果）
const maskCompanySample = (s: string): string => {
  const i = s.indexOf('(');
  const base = i >= 0 ? s.slice(0, i) : s;
  const suffix = i >= 0 ? s.slice(i) : '';
  if (base.length <= 4) return `${base.slice(0, 1)}***${suffix}`;
  return `${base.slice(0, 2)}***${base.slice(-2)}${suffix}`;
};

const readRecvDefault = (owner: string): RecvAccount => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const me = users.find(u => u.username === owner);
    if (me) {
      return {
        accountName: me.accountName || '', bankName: me.bankName || '', branchName: me.branchName || '',
        bankAccountNo: me.bankAccountNo || '', note: '',
      };
    }
  } catch { /* ignore */ }
  return { accountName: '', bankName: '', branchName: '', bankAccountNo: '', note: '' };
};
const readCompany = (owner: string): string => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return users.find(u => u.username === owner)?.companyName || '';
  } catch { return ''; }
};
const recvText = (r: RecvAccount): string =>
  [r.accountName, r.bankName, r.branchName, r.bankAccountNo].filter(Boolean).join(' / ');

const OwnBrandPage: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const owner = getDataOwner();
  // 表格贴窗底：表体动态测高 + min-height 锁死，横向滚动条/分页贴窗口底部
  const stick = useStickTableHeight();
  // 列宽自由调整：拖拽表头右边缘改宽，按账号+表格持久化
  const { sized: sizedOwn } = useColResize(`brandauth_cols_own_${owner}`);
  const { sized: sizedArch } = useColResize(`brandauth_cols_ownarch_${owner}`);
  const { sized: sizedAnaMonth } = useColResize(`brandauth_cols_anamonth_${owner}`);
  const { sized: sizedAnaRank } = useColResize(`brandauth_cols_anarank_${owner}`);
  const { sized: sizedAnaPerson } = useColResize(`brandauth_cols_anaperson_${owner}`);
  const { sized: sizedAnaBrand } = useColResize(`brandauth_cols_anabrand_${owner}`);
  const { sized: sizedAnaDetail } = useColResize(`brandauth_cols_anadetail_${owner}`);
  // 显示字段设置：勾选显示+顺序调整，按账号持久化
  const [ownFieldOrder, setOwnFieldOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem(`ownbrand_fieldorder_${owner}`); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; } } catch { /* ignore */ }
    return [];
  });
  const [ownFieldVis, setOwnFieldVis] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem(`ownbrand_fieldvis_${owner}`); if (s) { const d = JSON.parse(s); if (d && typeof d === 'object') return d; } } catch { /* ignore */ }
    return {};
  });
  const [ownFieldCfgVisible, setOwnFieldCfgVisible] = useState(false);
  const K = baKeys(owner);
  const [apps, setApps] = useState<BrandApplication[]>(() => safeJson<BrandApplication[]>(baKeys(getDataOwner()).apps, []));
  const [tpl, setTpl] = useState<BrandTemplate>(() => safeJson<BrandTemplate>(baKeys(getDataOwner()).tpl, defaultTemplate()));
  const [tplList, setTplList] = useState<BrandTemplate[]>([]);
  const [tplKey, setTplKey] = useState('');
  const [genTplKey, setGenTplKey] = useState('');
  // 模版编辑模式：cert=授权书模版，agr=协议书（销售保证书）模版；两套模版库独立存储
  const [tplMode, setTplMode] = useState<'cert' | 'agr'>('cert');
  const [agrTpl, setAgrTpl] = useState<BrandTemplate>(() => safeJson<BrandTemplate>(`brandauth_agrtpl_${getDataOwner()}`, defaultAgreementTemplate()));
  const [agrTplList, setAgrTplList] = useState<BrandTemplate[]>([]);
  const [agrTplKey, setAgrTplKey] = useState('');
  const [recv, setRecv] = useState<RecvAccount>(() => safeJson<RecvAccount>(baKeys(getDataOwner()).recv, readRecvDefault(getDataOwner())));
  const [ownBrands, setOwnBrands] = useState<OwnBrand[]>(() => safeJson<OwnBrand[]>(baKeys(getDataOwner()).own, []));
  const [fStatus, setFStatus] = useState('');
  // 保证金状态筛选（与保证金列显示口径同链）
  const [fDepState, setFDepState] = useState('');
  // 按字段搜索：输入态与已应用态分离，回车/点查询才生效
  const EMPTY_FSEARCH = { appNo: '', company: '', person: '', phone: '', tax: '', platform: '', authNo: '', shopType: '' };
  const [fInput, setFInput] = useState({ ...EMPTY_FSEARCH });
  const [fApplied, setFApplied] = useState({ ...EMPTY_FSEARCH });
  const applySearch = () => { reload(); setFApplied({ ...fInput }); };
  const resetSearch = () => { setFInput({ ...EMPTY_FSEARCH }); setFApplied({ ...EMPTY_FSEARCH }); };

  // 弹窗
  const [recvVisible, setRecvVisible] = useState(false);
  const [recvForm] = Form.useForm();
  const [tplVisible, setTplVisible] = useState(false);
  const [tplDraft, setTplDraft] = useState<BrandTemplate>(defaultTemplate());
  const [newCustom, setNewCustom] = useState('');
  const editorRef = useRef<any>(null);
  const [editorInitHtml, setEditorInitHtml] = useState('');
  // 记录编辑器内最后一次选区：工具栏下拉/取色器夺焦后仍能作用于原选区
  const savedRange = useRef<any>(null);
  // A4 等比预览视窗测量
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(0);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  // 模版载入后强制重新分页测量的触发器
  const [measureTick, setMeasureTick] = useState(0);
  const [ownVisible, setOwnVisible] = useState(false);
  const [certCfgVisible, setCertCfgVisible] = useState(false);
  const [certTarget, setCertTarget] = useState<BrandApplication | null>(null);
  const [certForm] = Form.useForm();
  const [certView, setCertView] = useState<BrandApplication | null>(null);
  const [linkVisible, setLinkVisible] = useState(false);
  const [upCertVisible, setUpCertVisible] = useState(false);
  const [upCertTarget, setUpCertTarget] = useState<BrandApplication | null>(null);
  const [upCertImage, setUpCertImage] = useState('');
  const [upCertAgent, setUpCertAgent] = useState('');
  const [editAppVisible, setEditAppVisible] = useState(false);
  const [editAppTarget, setEditAppTarget] = useState<BrandApplication | null>(null);
  const [editAppForm] = Form.useForm();
  const [detailApp, setDetailApp] = useState<BrandApplication | null>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [depositTarget, setDepositTarget] = useState<BrandApplication | null>(null);
  const [refundReqs, setRefundReqs] = useState<BrandRefundReq[]>([]);
  const [renewReqs, setRenewReqs] = useState<BrandRenewReq[]>([]);
  // 退回保证金详情弹窗（品牌方侧，保证金列已退回状态点击查看）
  const [refundDetailReq, setRefundDetailReq] = useState<BrandRefundReq | null>(null);
  // 退回申请驳回弹窗
  const [refundRejectTarget, setRefundRejectTarget] = useState<BrandRefundReq | null>(null);
  const [refundRejectReason, setRefundRejectReason] = useState('');
  // 品牌方主动退保申请弹窗（代理商未申请时品牌方主动发起）
  const [brandRefundTarget, setBrandRefundTarget] = useState<BrandApplication | null>(null);
  const [brandRefundBank, setBrandRefundBank] = useState('');
  const [brandRefundReason, setBrandRefundReason] = useState('');
  // 续签授权书上传模式（上传窗复用：renewMode 时置状态"续签成功"并更新有效期止）
  const [renewMode, setRenewMode] = useState(false);
  const [renewValidTo, setRenewValidTo] = useState<dayjs.Dayjs | null>(null);
  const [certImgView, setCertImgView] = useState<BrandApplication | null>(null);
  // 销售数据（代理商按月提交）：筛选月份/详情窗/分析面板
  const [salesRecords, setSalesRecords] = useState<BrandSalesRecord[]>([]);
  const [salesMonth, setSalesMonth] = useState<string>(dayjs().format('YYYY-MM'));
  // 统计卡点击筛选：''=全部，其余为各统计口径
  const [statFilter, setStatFilter] = useState<string>('');
  // 外部链接绑定负责人 + 负责人设置
  const [bindPic, setBindPic] = useState(false);
  const [picUser, setPicUser] = useState('');
  const [managersVisible, setManagersVisible] = useState(false);
  const [managersSel, setManagersSel] = useState<string[]>(() => safeJson<string[]>(managersKey(getDataOwner()), []));
  const [salesDetail, setSalesDetail] = useState<BrandSalesRecord | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [anaMode, setAnaMode] = useState<'month' | 'range'>('month');
  const [anaMonth, setAnaMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [anaRange, setAnaRange] = useState<[string, string]>([dayjs().startOf('year').format('YYYY-MM'), dayjs().format('YYYY-MM')]);
  // 分析子页：店铺搜索 + 排行口径
  const [anaShopSearch, setAnaShopSearch] = useState('');
  const [anaRankMetric, setAnaRankMetric] = useState<'amount' | 'qty' | 'score'>('amount');
  // 驳回/归档
  const [rejectTarget, setRejectTarget] = useState<BrandApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  // 授权编号格式设置
  const [authFmtVisible, setAuthFmtVisible] = useState(false);
  const [fmtDraft, setFmtDraft] = useState<AuthNoFmt>(() => defaultAuthFmt(getDataOwner()));
  const openAuthFmt = () => {
    setFmtDraft(safeJson<AuthNoFmt | null>(authFmtKey(owner), null) || defaultAuthFmt(owner));
    setAuthFmtVisible(true);
  };
  const saveAuthFmt = () => {
    writeJson(authFmtKey(owner), fmtDraft);
    setAuthFmtVisible(false);
    message.success('授权编号格式已保存，下次确认到账生成授权编号时生效');
  };

  const reload = () => {
    setApps(safeJson<BrandApplication[]>(K.apps, []));
    setTpl(safeJson<BrandTemplate>(K.tpl, defaultTemplate()));
    setRecv(safeJson<RecvAccount>(K.recv, readRecvDefault(owner)));
    setOwnBrands(safeJson<OwnBrand[]>(K.own, []));
    setBankAccounts(safeJson<any[]>(`pageData_finance_bank-account_${owner}`, []));
    fetchRefundReqs(owner).then(setRefundReqs).catch(() => { /* ignore */ });
    fetchRenewReqs(owner).then(setRenewReqs).catch(() => { /* ignore */ });
    fetchSalesRecords(owner).then(setSalesRecords).catch(() => { /* ignore */ });
    // 多模版列表：存量单模版迁移为「系统预设模版」
    const list0 = safeJson<BrandTemplate[]>(KTPLS, []);
    if (!list0.length) {
      const cur = safeJson<BrandTemplate>(K.tpl, defaultTemplate());
      const preset = { ...cur, key: cur.key || 'tpl-preset', name: cur.name || '系统预设模版' };
      writeJson(KTPLS, [preset]);
      setTplList([preset]); setTpl(preset); setTplKey(preset.key || 'tpl-preset');
    } else {
      setTplList(list0);
      const cur = safeJson<BrandTemplate>(K.tpl, defaultTemplate());
      const match = list0.find(x => x.key === cur.key) || list0[0];
      setTpl(match); setTplKey(match.key || '');
    }
    // 协议书模版列表：存量迁移为「系统预设协议书」；未发布过时同步发布一次到外部申请页
    const alist0 = safeJson<BrandTemplate[]>(KAGRTPLS, []);
    if (!alist0.length) {
      const acur = safeJson<BrandTemplate>(KAGRTPL, defaultAgreementTemplate());
      const apreset = { ...acur, key: acur.key || 'agr-preset', name: acur.name || '系统预设协议书' };
      writeJson(KAGRTPLS, [apreset]);
      setAgrTplList([apreset]); setAgrTpl(apreset); setAgrTplKey(apreset.key || 'agr-preset');
      if (!safeJson<any>(agreementDocKey(owner), null)) publishAgreement(owner, apreset.html || bodyToHtml(apreset.body));
    } else {
      setAgrTplList(alist0);
      const acur = safeJson<BrandTemplate>(KAGRTPL, defaultAgreementTemplate());
      const amatch = alist0.find(x => x.key === acur.key) || alist0[0];
      setAgrTpl(amatch); setAgrTplKey(amatch.key || '');
    }
  };
  useEffect(() => { reload(); }, [owner]);
  // 同步品牌方主动退保的付款状态：当申请单有 depositPaymentKey 但 depositState 仍为"已确认"时，检查付款申请是否已支付并回写状态
  useEffect(() => {
    const syncBrandRefundPayment = () => {
      const prList: any[] = safeJson<any[]>(`payment_requests_${owner}`, []);
      let updated = false;
      const newApps = apps.map(app => {
        if (!app.depositPaymentKey || app.depositState === '已退回') return app;
        const payRec = prList.find((pr: any) => pr.key === app.depositPaymentKey && pr.status === 'paid');
        if (payRec) {
          updated = true;
          return { ...app, depositState: '已退回' as const, refundAt: payRec.paidAt || todayIso() };
        }
        return app;
      });
      if (updated) saveApps(newApps);
      // 修复存量 BrandRefundReq 的 agentRecv 字段（品牌方主动退保时可能未写入代理商收款账户）
      try {
        const reqs = safeJson<BrandRefundReq[]>(refundReqKey(owner), []);
        let reqsUpdated = false;
        const fixedReqs = reqs.map(req => {
          if (req.agentRecv || req.status === '已申请' || req.status === '已驳回') return req;
          // 从申请单查找对应的付款申请，获取收款账户名
          const app = newApps.find(a => a.key === req.appKey);
          if (!app || !app.depositPaymentKey) return req;
          const payRec = prList.find((pr: any) => pr.key === app.depositPaymentKey);
          if (payRec && payRec.recvAccountName) {
            reqsUpdated = true;
            return { ...req, agentRecv: payRec.recvAccountName };
          }
          return req;
        });
        if (reqsUpdated) writeJson(refundReqKey(owner), fixedReqs);
      } catch { /* ignore */ }
    };
    syncBrandRefundPayment();
    window.addEventListener('storage', syncBrandRefundPayment);
    window.addEventListener('sync-data-updated', syncBrandRefundPayment);
    return () => {
      window.removeEventListener('storage', syncBrandRefundPayment);
      window.removeEventListener('sync-data-updated', syncBrandRefundPayment);
    };
  }, [apps, owner]);
  // 发布对外公开信息（公司名称+收款账户+自有品牌台账），供外部申请页展示；进入/切换账号时刷新
  const publishPub = (r: RecvAccount, brands: OwnBrand[]) => {
    writeJson(K.pub, [{
      key: 'pub', companyName: readCompany(owner), recv: r,
      brands: brands.map(b => ({ brandName: b.brandName, trademarkNo: b.trademarkNo, category: b.category, signCompany: b.signCompany || '' })),
    }]);
  };
  useEffect(() => {
    // 直接读 localStorage 最新值发布，避免 mount 时 state 尚未 reload 导致 brands 发空
    publishPub(safeJson<RecvAccount>(K.recv, readRecvDefault(owner)), safeJson<OwnBrand[]>(K.own, []));
  }, [owner]);
  useEffect(() => {
    const onSync = () => reload();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [K.apps]);
  // 存量申请回填申请编号（一次性）
  useEffect(() => {
    if (!apps.length || !apps.some(a => !a.appNo)) return;
    let list = [...apps];
    list = list.map(a => (a.appNo ? a : { ...a, appNo: genAppNo(list) }));
    saveApps(list);
  }, [apps]);

  const saveApps = (l: BrandApplication[]) => { setApps(l); writeJson(K.apps, l); };
  const KTPLS = `brandauth_tpls_${owner}`;
  const KAGRTPL = `brandauth_agrtpl_${owner}`;
  const KAGRTPLS = `brandauth_agrtpls_${owner}`;
  // 当前编辑模式下的模版库/选中键/预设键
  const tplKeyNow = tplMode === 'cert' ? tplKey : agrTplKey;
  const tplListNow = tplMode === 'cert' ? tplList : agrTplList;
  const presetKeyNow = tplMode === 'cert' ? 'tpl-preset' : 'agr-preset';
  const saveTpl = (t: BrandTemplate) => {
    const key = t.key || presetKeyNow;
    const rec = { ...t, key };
    if (tplMode === 'cert') {
      setTpl(t); writeJson(K.tpl, t);
      const list = tplList.some(x => x.key === key) ? tplList.map(x => (x.key === key ? rec : x)) : [...tplList, rec];
      setTplList(list); writeJson(KTPLS, list);
    } else {
      setAgrTpl(t); writeJson(KAGRTPL, t);
      const list = agrTplList.some(x => x.key === key) ? agrTplList.map(x => (x.key === key ? rec : x)) : [...agrTplList, rec];
      setAgrTplList(list); writeJson(KAGRTPLS, list);
      // 协议书保存即发布到外部申请页（查看/下载）
      publishAgreement(owner, rec.html || bodyToHtml(rec.body));
    }
  };
  const saveRecv = (r: RecvAccount) => {
    setRecv(r); writeJson(K.recv, r);
    // 同步对外公开信息（公司名称+收款账户+自有品牌台账），供外部申请页读取
    publishPub(r, ownBrands);
    message.success('收款账户已保存，并已同步到外部申请页');
  };

  // ============ 负责人可见性：管理员/负责人看全部，其余人仅看负责人为自己的申请 ============
  const meUsername = localStorage.getItem('username') || '';
  const isAdminAcc = localStorage.getItem('isSubAccount') !== 'true';
  const meDisp = useMemo(() => {
    try {
      const us: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = us.find(x => x.username === meUsername);
      return (u && (u.displayName || u.contactPerson || u.name)) || meUsername;
    } catch { return meUsername; }
  }, [meUsername]);
  // 本租户成员账号（管理员/主账号 + 子账号，负责人候选/绑定候选）
  const subUsers = useMemo(() => loadTenantUsers(), []);
  // 子账号姓名显示：displayName → contactPerson → name → username 逐级回退（registeredUsers 姓名实际多在 contactPerson）
  const nameOfU = (u: any): string => (u && (u.displayName || u.contactPerson || u.name)) || (u ? u.username : '');
  const visibleApps = useMemo(() => {
    const active = apps.filter(a => !a.archived);
    if (isAdminAcc || managersSel.includes(meUsername)) return active;
    // personInCharge 为空（外部链接未绑定负责人）则所有人可见
    return active.filter(a => !(a.personInCharge || '') || (a.personInCharge || '') === meDisp || (a.personInCharge || '') === meUsername);
  }, [apps, isAdminAcc, managersSel, meUsername, meDisp]);

  // 统计口径判定（统计卡与点击筛选共用同一谓词，保证卡上数字=筛选后行数）
  const matchStat = (a: BrandApplication, kind: string): boolean => {
    switch (kind) {
      case 'pending': return a.status === '待确认';
      // 待发放授权：统计授权书图未上传的申请（需上传授权书图发放给代理商）
      case 'certed': return !a.certImage;
      // 已发放授权：授权书图已上传（已发放给代理商）
      case 'issued': return !!a.certImage;
      // 待退保证金：与保证金列"已确认"显示口径一致（已确认到账且未退回，含代理商已申请退回但未完成）
      case 'depHold': return a.depositState === '已确认' || (a.depositState !== '已退回' && a.status !== '待确认');
      // 与保证金列显示口径一致：已退回状态优先显示"已退回"，仅未退回且存在已申请记录才计为待处理
      case 'refundReq': return a.depositState !== '已退回' && refundReqs.some(q => q.appKey === a.key && q.status === '已申请');
      case 'refunded': return a.depositState === '已退回';
      case 'renew': return renewReqs.some(q => q.appKey === a.key && q.status === '已申请');
      case 'nosales': return !salesRecords.some(s => s.appKey === a.key && s.month === salesMonth);
      default: return true;
    }
  };

  // 保证金状态标签：复刻保证金列渲染链（已退回 → 退回申请待处理 → 已确认(退款中/已确认到账) → 待确认）
  const depStateLabel = (a: BrandApplication): string => {
    if (a.depositState === '已退回') return '已退回';
    if (refundReqs.some(q => q.appKey === a.key && q.status === '已申请')) return '退回申请待处理';
    if (a.depositState === '已确认') return a.depositPaymentKey ? '退款中' : '已确认到账';
    return '待确认';
  };

  const filtered = useMemo(() => visibleApps.filter(a => {
    if (statFilter && !matchStat(a, statFilter)) return false;
    if (fStatus && a.status !== fStatus) return false;
    if (fDepState && depStateLabel(a) !== fDepState) return false;
    const kw = (s: string) => s.trim().toLowerCase();
    const hit = (v: string | undefined, k: string) => !k || (v || '').toLowerCase().includes(k);
    if (!hit(a.appNo, kw(fApplied.appNo))) return false;
    if (!hit(a.companyName, kw(fApplied.company))) return false;
    if (!hit(a.personInCharge, kw(fApplied.person))) return false;
    if (!hit(a.phone, kw(fApplied.phone))) return false;
    if (!hit(a.taxpayerCode, kw(fApplied.tax))) return false;
    if (!hit(a.platform, kw(fApplied.platform))) return false;
    if (!hit(a.authNo, kw(fApplied.authNo))) return false;
    if (fApplied.shopType && (a.shopType || '') !== fApplied.shopType) return false;
    return true;
  }).sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || '')), [visibleApps, fStatus, fDepState, fApplied, statFilter, refundReqs, renewReqs, salesRecords, salesMonth]);

  const stats = useMemo(() => ({
    total: visibleApps.length,
    pending: visibleApps.filter(a => matchStat(a, 'pending')).length,
    certed: visibleApps.filter(a => matchStat(a, 'certed')).length,
    issued: visibleApps.filter(a => matchStat(a, 'issued')).length,
    depHoldSum: visibleApps.filter(a => matchStat(a, 'depHold')).reduce((s, a) => s + (Number(a.deposit) || 0), 0),
    refundReq: visibleApps.filter(a => matchStat(a, 'refundReq')).length,
    refunded: visibleApps.filter(a => matchStat(a, 'refunded')).length,
    renew: visibleApps.filter(a => matchStat(a, 'renew')).length,
    nosales: visibleApps.filter(a => matchStat(a, 'nosales')).length,
  }), [visibleApps, refundReqs, renewReqs, salesRecords, salesMonth]);

  // ============ 保证金：确认到账 / 退回 ============
  const getDisplayName = (): string => {
    const username = localStorage.getItem('username') || '';
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === username);
      if (u) return u.displayName || u.contactPerson || u.name || username;
    } catch { /* ignore */ }
    return username;
  };
  const loadRefundReqs = () => { fetchRefundReqs(owner).then(setRefundReqs).catch(() => { /* ignore */ }); };
  const loadRenewReqs = () => { fetchRenewReqs(owner).then(setRenewReqs).catch(() => { /* ignore */ }); };
  // 待处理续签申请（授权书列显示"续签申请"入口）
  const pendingRenew = (a: BrandApplication | null) => !!a && renewReqs.some(q => q.appKey === a.key && q.status === '已申请');
  // 简易账薄-日常记账幂等写入（收入/支出）
  const writeDailyBook = (bookKey: string, type: '收入' | '支出', amount: number, counterparty: string, remark: string, accountName: string, bankName: string, image: string) => {
    try {
      const bkKey = `daily_bookkeeping_${owner}`;
      const bkList: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const cleaned = bkList.filter((b: any) => b.key !== bookKey);
      const today = todayIso();
      const prefix = `PZ-${today.replace(/-/g, '')}`;
      const seqs = cleaned.map((b: any) => String(b.voucherNo || '')).filter((v: string) => v.startsWith(prefix)).map((v: string) => parseInt(v.slice(-3), 10) || 0);
      const rec = {
        key: bookKey, voucherNo: `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`,
        bookDate: today, bookType: type, category: type === '收入' ? '其他业务收入-其他收入' : '财务费用-其他支出',
        amount, counterparty, remark, person: getDisplayName(),
        recvAccount: type === '收入' ? accountName : '', recvBank: type === '收入' ? bankName : '',
        payAccount: type === '支出' ? accountName : '', payBank: type === '支出' ? bankName : '',
        image: image || '', isPersonalAdvance: false, isReturn: false, advanceRecvAccount: '',
        linkedReimbursementKey: '', department: '', auditor: getDisplayName(), cashier: getDisplayName(),
        createdAt: new Date().toISOString(), autoSourceKey: bookKey,
      };
      writeJson(bkKey, [rec, ...cleaned]);
    } catch { /* ignore */ }
  };
  const openDeposit = (a: BrandApplication) => {
    setDepositTarget(a);
    const bas = safeJson<any[]>(`pageData_finance_bank-account_${owner}`, []);
    setBankAccounts(bas);
  };
  // 收款账户快照展示：优先按确认到账所选账户（recvBankKey）实时解析（账户改名后同步更新），无匹配回退确认时快照/提交时快照
  const recvSnapshotText = (a: BrandApplication | null): string => {
    if (!a) return '';
    if (a.recvBankKey) {
      const acc = bankAccounts.find((b: any) => b.key === a.recvBankKey);
      if (acc) return [acc.name || acc.shortName || '', acc.bankName || '', acc.branchName || '', acc.accountNo || acc.bankAccountNo || ''].filter(Boolean).join(' / ');
    }
    return a.recvBankSnapshot || a.recvSnapshot || '';
  };
  // 保证金退回审核：确认无误 → 自动在收/付申请待审核中新增付款申请
  const handleApproveRefund = (req: BrandRefundReq) => {
    const app = apps.find(a => a.key === req.appKey);
    if (!app) { message.warning('未找到关联申请单'); return; }
    const prKey = `payment_requests_${owner}`;
    const prList: any[] = safeJson<any[]>(prKey, []);
    const fkPrefix = `FK${dayjs().format('YYYYMMDD')}`;
    const fkSeq = prList.filter((r: any) => r.requestNo?.startsWith(fkPrefix)).length + 1;
    const paymentRec: any = {
      key: `payreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo: `${fkPrefix}${String(fkSeq).padStart(3, '0')}`,
      amount: Number(req.amount) || 0,
      category: '保证金退回',
      description: `品牌保证金退回 — ${req.companyName}`,
      recvType: 'bank',
      recvAccountName: req.agentBank || req.companyName,
      source: 'manual',
      status: 'pending_review',
      recordType: 'payment',
      brandAppKey: req.appKey,
      brandRefundReqKey: req.key,
      applicant: '',
      applicantName: getDisplayName(),
      applyDate: todayIso(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(prKey, [paymentRec, ...prList]);
    // 更新退回申请状态为“已退回”（品牌方已审核通过，等待付款）
    const updatedReqs = refundReqs.map(q => q.key === req.key ? { ...q, status: '已退回' as const } : q);
    setRefundReqs(updatedReqs);
    writeJson(refundReqKey(owner), updatedReqs);
    // 更新申请单 depositPaymentKey 和 depositState
    const updatedApp: BrandApplication = { ...app, depositPaymentKey: paymentRec.key, depositState: '已确认' as const };
    saveApps(apps.map(x => x.key === updatedApp.key ? updatedApp : x));
    // 同步退保状态到代理商后台
    publishAppMirror(updatedApp, readCompany(owner), owner);
    setDepositTarget(null);
    message.success('已审核通过：付款申请已添加到收/付申请待审核页面，支付后保证金将自动标记为成功退回');
  };
  // 品牌方主动退保：创建付款申请（代理商未申请时品牌方主动发起）
  const handleBrandInitRefund = () => {
    if (!brandRefundTarget) return;
    const bank = brandRefundBank.trim();
    if (!bank) { message.warning('请填写代理商收款账户'); return; }
    const prKey = `payment_requests_${owner}`;
    const prList: any[] = safeJson<any[]>(prKey, []);
    const fkPrefix = `FK${dayjs().format('YYYYMMDD')}`;
    const fkSeq = prList.filter((r: any) => r.requestNo?.startsWith(fkPrefix)).length + 1;
    const paymentRec: any = {
      key: `payreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      requestNo: `${fkPrefix}${String(fkSeq).padStart(3, '0')}`,
      amount: Number(brandRefundTarget.deposit) || 0,
      category: '保证金退回',
      description: `品牌方主动退保 — ${brandRefundTarget.companyName}`,
      recvType: 'bank',
      recvAccountName: bank,
      source: 'manual',
      status: 'pending_review',
      recordType: 'payment',
      brandAppKey: brandRefundTarget.key,
      applicant: '',
      applicantName: getDisplayName(),
      applyDate: todayIso(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJson(prKey, [paymentRec, ...prList]);
    const updatedApp: BrandApplication = { ...brandRefundTarget, depositPaymentKey: paymentRec.key, refundAgentRecv: bank };
    saveApps(apps.map(x => x.key === updatedApp.key ? updatedApp : x));
    publishAppMirror(updatedApp, readCompany(owner), owner);
    setDepositTarget(null);
    setBrandRefundTarget(null);
    setBrandRefundBank('');
    setBrandRefundReason('');
    message.success('付款申请已创建：已添加到收/付申请待审核页面，支付后保证金将自动标记为成功退回');
  };
  // 保证金退回审核：驳回 → 写入驳回原因并回传代理商
  const handleRejectRefundSubmit = () => {
    if (!refundRejectTarget) return;
    const reason = refundRejectReason.trim();
    if (!reason) { message.warning('请填写驳回原因'); return; }
    const updatedReqs = refundReqs.map(q => q.key === refundRejectTarget.key
      ? { ...q, status: '已驳回' as const, rejectReason: reason, rejectAt: todayIso() }
      : q);
    setRefundReqs(updatedReqs);
    writeJson(refundReqKey(owner), updatedReqs);
    setRefundRejectTarget(null);
    setRefundRejectReason('');
    message.success('已驳回该退回申请，代理商将收到通知');
  };
  // 驳回：仅限确认到账前；驳回后同步镜像，代理商侧可见原因并重新申请
  const confirmReject = () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) { message.warning('请填写驳回原因'); return; }
    const updated: BrandApplication = { ...rejectTarget, status: '已驳回', rejectReason: reason, rejectAt: todayIso() };
    saveApps(apps.map(x => (x.key === updated.key ? updated : x)));
    publishAppMirror(updated, readCompany(owner), owner);
    setRejectTarget(null);
    message.success('已驳回该申请，代理商可查看原因并重新申请');
  };
  // 归档条件：保证金已退回且授权有效期已过期
  const canArchive = (a: BrandApplication) => a.depositState === '已退回' && !!a.validTo && a.validTo < dayjs().format('YYYY-MM-DD');
  const doArchive = (a: BrandApplication) => {
    Modal.confirm({
      title: '归档该授权申请？',
      content: `${a.companyName}（${a.appNo || ''}）：保证金已退回且授权已到期，归档后移入"归档数据"子页`,
      okText: '归档',
      onOk: () => {
        const updated: BrandApplication = { ...a, archived: true, archivedAt: todayIso() };
        saveApps(apps.map(x => (x.key === updated.key ? updated : x)));
        message.success('已归档，可在"归档数据"子页查看');
      },
    });
  };


  // ============ 生成授权书 ============
  // 保证金门控：仅保证金状态=已确认才允许生成/续签/重新生成授权书（历史已确认但 depositState 为空的记录按状态兼容，与列"已确认"口径一致）
  const certDepositGate = (a: BrandApplication | null): boolean => {
    if (!a) return false;
    const confirmed = a.depositState === '已确认' || (a.depositState !== '已退回' && a.status !== '待确认');
    if (!confirmed) {
      message.warning(a.depositState === '已退回' ? '保证金已退回，不可生成/续签授权书' : '保证金确认到账后才可以生成/续签授权书');
      return false;
    }
    return true;
  };
  // 有效期快速选择：以有效期起为基准计算有效期止
  const setQuickValid = (kind: '3m' | '6m' | '1y' | 'ye') => {
    const from = certForm.getFieldValue('validFrom');
    const base = from ? dayjs(from) : dayjs();
    let to: dayjs.Dayjs;
    if (kind === '3m') to = base.add(3, 'month');
    else if (kind === '6m') to = base.add(6, 'month');
    else if (kind === '1y') to = base.add(1, 'year');
    else to = base.endOf('year'); // 本年（有效期起所在年）12月31日
    certForm.setFieldsValue({ validFrom: base, validTo: to });
  };
  const openCertCfg = (a: BrandApplication) => {
    if (!certDepositGate(a)) return;
    setCertTarget(a);
    setGenTplKey(tplKey || 'tpl-preset');
    const brand = ownBrands[0];
    certForm.setFieldsValue({
      brandName: a.brandName || brand?.brandName || '',
      trademarkNo: a.trademarkNo || brand?.trademarkNo || '',
      category: a.category || brand?.category || '25 类鞋子',
      shopName: a.shopName || '',
      // 有效期优先回显已有值（重新生成/续签入口不重置有效期），无则默认今日起一年
      validFrom: a.validFrom ? dayjs(a.validFrom) : dayjs(),
      validTo: a.validTo ? dayjs(a.validTo) : dayjs().add(1, 'year'),
    });
    setCertCfgVisible(true);
  };
  const handleGenCert = () => {
    if (!certTarget) return;
    // 提交时再校验保证金状态（防开窗后状态变化）：仅已确认可生成
    if (!certDepositGate(apps.find(x => x.key === certTarget.key) || certTarget)) return;
    certForm.validateFields().then(async v => {
      const gtpl = tplList.find(x => x.key === genTplKey) || tpl;
      const custom: Record<string, string> = {};
      (gtpl.customFields || []).forEach(cf => { custom[cf.label] = v[`cf_${cf.key}`] || ''; });
      const values = buildCertValues({
        ...certTarget,
        brandName: v.brandName, trademarkNo: v.trademarkNo, category: v.category, shopName: v.shopName,
        validFrom: v.validFrom ? dayjs(v.validFrom).format('YYYY 年 M 月 D 日') : '',
        validTo: v.validTo ? dayjs(v.validTo).format('YYYY 年 M 月 D 日') : '',
      }, (ownBrands.find(b => b.brandName === v.brandName)?.signCompany || '').trim() || readCompany(owner), custom);
      const innerHtml = substituteTokens(gtpl.html || bodyToHtml(gtpl.body), values);
      // 水印文字中的占位符同步渲染（旧默认旋转 -30 迁移为 -45）
      const wmCfg: WatermarkCfg = { ...DEFAULT_WATERMARK, ...(gtpl.watermark || {}) };
      if (gtpl.watermark?.rotate === -30) wmCfg.rotate = -45;
      const wmHtml = buildWatermarkHtml(substituteTokens(gtpl.watermark?.text || '', values), wmCfg);
      // 模版背景图为历史未压缩大图时先再压缩再嵌入，并就位修复模版库：防证书副本膨胀撑爆存储配额致写入被静默丢弃
      let bg = gtpl.bgImage || '';
      if (bg.length > OVERSIZE_DATAURL_CHARS) {
        bg = await recompressDataUrl(bg);
        const fixed: BrandTemplate = { ...gtpl, bgImage: bg };
        if (!gtpl.key || gtpl.key === tplKey) { setTpl(fixed); writeJson(K.tpl, fixed); }
        const nl = tplList.map(x => (x.key === fixed.key ? fixed : x));
        setTplList(nl); writeJson(KTPLS, nl);
      }
      const html = buildCertPageHtml(innerHtml, bg, gtpl.style, wmHtml);
      const updated: BrandApplication = {
        ...certTarget,
        brandName: v.brandName, trademarkNo: v.trademarkNo, category: v.category, shopName: v.shopName,
        // 表单有效期为空时保留原值，防止生成授权书后有效期被清空
        validFrom: v.validFrom ? dayjs(v.validFrom).format('YYYY-MM-DD') : (certTarget.validFrom || ''),
        validTo: v.validTo ? dayjs(v.validTo).format('YYYY-MM-DD') : (certTarget.validTo || ''),
        certHtml: html, certAt: todayCn(), status: '已生成授权书',
      };
      saveApps(apps.map(x => (x.key === updated.key ? updated : x)));
      // 写后回读校验：配额防护静默丢写时刷新会"清空"生成结果，此处检出并明确提示
      const persisted = safeJson<BrandApplication[]>(K.apps, []).some(x => x.key === updated.key && x.certAt === updated.certAt);
      publishAppMirror(updated, readCompany(owner), owner);
      setCertCfgVisible(false);
      if (persisted) message.success('授权书已生成，可点击"授权书"查看/打印');
      else message.error('授权书生成后本地保存失败（存储空间不足）：请压缩模版背景图或清理历史数据后重新生成');
    }).catch(() => { /* 行内提示必填项 */ });
  };

  // ============ 上传授权书图片 → 递送给代理商 ============
  const certLink = (a: BrandApplication) => `${window.location.origin}/brand-cert/${a.shareCode || ''}`;
  const openUpCert = (a: BrandApplication) => {
    setUpCertTarget(a);
    setUpCertImage(a.certImage || '');
    setUpCertAgent(a.agentUsername || '');
    setRenewMode(false);
    setUpCertVisible(true);
  };
  // 续签授权书：从生成授权书窗口进入上传窗的续签模式（新有效期止默认原止+1年）
  const openUpCertRenew = (a: BrandApplication) => {
    if (!certDepositGate(a)) return;
    setUpCertTarget(a);
    setUpCertImage('');
    setUpCertAgent(a.agentUsername || '');
    setRenewMode(true);
    setRenewValidTo(a.validTo ? dayjs(a.validTo).add(1, 'year') : dayjs().add(1, 'year'));
    setUpCertVisible(true);
  };
  const handleUpCert = () => {
    if (!upCertTarget) return;
    if (!upCertImage) { message.warning('请上传授权书图片'); return; }
    if (renewMode) {
      if (!renewValidTo) { message.warning('请选择新的有效期止'); return; }
      const updated: BrandApplication = {
        ...upCertTarget,
        certImage: upCertImage,
        certImageAt: todayIso(),
        shareCode: upCertTarget.shareCode || genShareCode(),
        agentUsername: upCertAgent.trim() || upCertTarget.agentUsername || '',
        // 续签更新有效期止；有效期止缺失时回退原值/新选日期，有效期起缺失时回退原值/今日
        validFrom: upCertTarget.validFrom || todayIso(),
        validTo: renewValidTo.format('YYYY-MM-DD'),
        status: '续签成功',
      };
      saveApps(apps.map(x => (x.key === updated.key ? updated : x)));
      publishCert(updated, readCompany(owner));
      publishAppMirror(updated, readCompany(owner), owner);
      // 续签申请闭环：待处理申请置"已续签"
      fetchRenewReqs(owner).then(l => {
        const nl = l.map(q => (q.appKey === updated.key && q.status === '已申请' ? { ...q, status: '已续签' as const, renewAt: todayIso() } : q));
        writeJson(renewReqKey(owner), nl);
        setRenewReqs(nl);
      }).catch(() => { /* ignore */ });
      setUpCertVisible(false);
      setRenewMode(false);
      message.success('续签授权书已上传并递送：代理商状态置为"续签成功"，有效期止已更新');
      return;
    }
    const updated: BrandApplication = {
      ...upCertTarget,
      certImage: upCertImage,
      certImageAt: todayIso(),
      shareCode: upCertTarget.shareCode || genShareCode(),
      agentUsername: upCertAgent.trim() || '',
      status: '授权书已发',
    };
    saveApps(apps.map(x => (x.key === updated.key ? updated : x)));
    publishCert(updated, readCompany(owner));
    publishAppMirror(updated, readCompany(owner), owner);
    setUpCertVisible(false);
    message.success('授权书已上传并递送：代理商后台/公开查询链接均可查看');
  };

  // ============ 编辑申请（代理商填错信息代改） ============
  const openEditApp = (a: BrandApplication) => {
    setEditAppTarget(a);
    setEditAppVisible(true);
    setTimeout(() => {
      editAppForm.setFieldsValue({
        companyName: a.companyName, taxpayerCode: a.taxpayerCode, legalPerson: a.legalPerson,
        phone: a.phone, address: a.address, platform: a.platform, platformUrl: a.platformUrl,
        deposit: a.deposit, brandName: a.brandName || undefined,
        personInCharge: a.personInCharge || undefined,
        province: a.province || undefined, city: a.city || undefined, district: a.district || undefined, shopName: a.shopName || '',
        shopId: a.shopId || '', shopType: a.shopType || undefined,
        payShot: a.payShot, businessLicense: a.businessLicense || '', idFront: a.idFront || '', idBack: a.idBack || '',
        agreementImage: a.agreementImage || '',
      });
    }, 0);
  };
  const handleEditApp = () => {
    if (!editAppTarget) return;
    editAppForm.validateFields().then(v => {
      const selBrand = ownBrands.find(b => b.brandName === v.brandName);
      const updated: BrandApplication = {
        ...editAppTarget,
        companyName: v.companyName?.trim() || '', taxpayerCode: v.taxpayerCode?.trim() || '',
        legalPerson: v.legalPerson?.trim() || '', phone: v.phone?.trim() || '',
        address: [v.province, v.city, v.district, v.address?.trim()].filter(Boolean).join(''),
        province: v.province || '', city: v.city || '', district: v.district || '',
        platform: v.platform?.trim() || '', platformUrl: v.platformUrl?.trim() || '',
        deposit: String(v.deposit ?? ''), brandName: v.brandName || '', shopName: v.shopName?.trim() || '',
        shopId: v.shopId?.trim() || '', shopType: v.shopType || '',
        personInCharge: v.personInCharge || '',
        trademarkNo: selBrand?.trademarkNo || editAppTarget.trademarkNo,
        category: selBrand?.category || editAppTarget.category,
        payShot: v.payShot || '', businessLicense: v.businessLicense || '', idFront: v.idFront || '', idBack: v.idBack || '',
        agreementImage: v.agreementImage || '',
      };
      saveApps(apps.map(x => (x.key === updated.key ? updated : x)));
      publishAppMirror(updated, readCompany(owner), owner);
      setEditAppVisible(false);
      message.success('申请信息已修改，并同步至代理商后台');
    }).catch(() => { /* 行内提示 */ });
  };

  // ============ 模版编辑器 ============
  const openTpl = (mode: 'cert' | 'agr') => {
    setTplMode(mode);
    loadTplIntoEditor(mode === 'cert' ? tpl : agrTpl);
    setTplVisible(true);
    setTimeout(() => { try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* ignore */ } }, 50);
  };
  // 将指定模版载入编辑器草稿
  const loadTplIntoEditor = (rec: BrandTemplate) => {
    const rawHtml = rec.html || bodyToHtml(rec.body);
    const html = applyBlockTypography(rawHtml, { ...DEFAULT_CERT_STYLE, ...(rec.style || {}) });
    // 旧默认旋转 -30 迁移为新标准 -45（45° 倾斜铺满）
    const wmMerged: WatermarkCfg = { ...DEFAULT_WATERMARK, ...(rec.watermark || {}) };
    if (rec.watermark?.rotate === -30) wmMerged.rotate = -45;
    setTplDraft({ ...rec, customFields: [...(rec.customFields || [])], style: { ...DEFAULT_CERT_STYLE, ...(rec.style || {}) }, watermark: wmMerged, html });
    setEditorInitHtml(html);
    // 切换模版（授权书↔协议书/下拉换模版）时先清空旧预览页，避免上一个模版的预览残留；
    // 并延迟触发一次重新分页测量（模态框开启动画期间首测可能读到旧 DOM）
    setPreviewPages([]);
    setTimeout(() => setMeasureTick(t => t + 1), 80);
    setSelImg(null);
  };
  const switchTpl = (key: string) => {
    const rec = tplListNow.find(x => x.key === key);
    if (!rec) return;
    if (tplMode === 'cert') { setTplKey(key); setTpl(rec); } else { setAgrTplKey(key); setAgrTpl(rec); }
    if (tplVisible) loadTplIntoEditor(rec);
  };
  const saveAsTpl = () => {
    const name = window.prompt('新模版名称', `模版${tplListNow.length + 1}`);
    if (!name?.trim()) return;
    const rec: BrandTemplate = { ...tplDraft, key: `${tplMode === 'cert' ? 'tpl' : 'agr'}-${Date.now()}`, name: name.trim(), updatedAt: todayIso() };
    const list = [...tplListNow, rec];
    if (tplMode === 'cert') {
      setTplList(list); writeJson(KTPLS, list);
      setTplKey(rec.key || ''); setTpl(rec); writeJson(K.tpl, rec);
    } else {
      setAgrTplList(list); writeJson(KAGRTPLS, list);
      setAgrTplKey(rec.key || ''); setAgrTpl(rec); writeJson(KAGRTPL, rec);
      publishAgreement(owner, rec.html || bodyToHtml(rec.body));
    }
    message.success(`已另存为模版「${rec.name}」`);
  };
  const newTpl = () => {
    const name = window.prompt('新空白模版名称', `空白模版${tplListNow.length + 1}`);
    if (!name?.trim()) return;
    const rec: BrandTemplate = { ...(tplMode === 'cert' ? defaultTemplate() : defaultAgreementTemplate()), key: `${tplMode === 'cert' ? 'tpl' : 'agr'}-${Date.now()}`, name: name.trim(), updatedAt: todayIso() };
    const list = [...tplListNow, rec];
    if (tplMode === 'cert') {
      setTplList(list); writeJson(KTPLS, list);
      setTplKey(rec.key || ''); setTpl(rec);
    } else {
      setAgrTplList(list); writeJson(KAGRTPLS, list);
      setAgrTplKey(rec.key || ''); setAgrTpl(rec);
    }
    loadTplIntoEditor(rec);
    message.success(`已创建空白模版「${rec.name}」，编辑后点"保存模版"`);
  };
  const deleteTpl = () => {
    if (tplKeyNow === presetKeyNow) { message.warning('系统预设模版不可删除'); return; }
    Modal.confirm({
      title: `删除模版「${tplDraft.name || tplKeyNow}」？`,
      content: '删除后可切换回系统预设模版',
      onOk: () => {
        const list = tplListNow.filter(x => x.key !== tplKeyNow);
        const preset = list.find(x => x.key === presetKeyNow) || list[0];
        if (tplMode === 'cert') {
          setTplList(list); writeJson(KTPLS, list);
          setTplKey(preset.key || ''); setTpl(preset); writeJson(K.tpl, preset);
        } else {
          setAgrTplList(list); writeJson(KAGRTPLS, list);
          setAgrTplKey(preset.key || ''); setAgrTpl(preset); writeJson(KAGRTPL, preset);
        }
        if (tplVisible) loadTplIntoEditor(preset);
        message.success('模版已删除');
      },
    });
  };
  const syncHtml = () => setTplDraft(d => ({ ...d, html: (editorRef.current?.innerHTML ?? d.html).replace(/outline:\s*[^;"]+;?/g, '') }));
  const fileImgRef = useRef<HTMLInputElement>(null);
  // 在光标处插入图片（随模版 html 保存，预览/生成/打印同步渲染）
  const insertImageHtml = (url: string) => {
    restoreRange();
    editorRef.current?.focus();
    const html = `<img src="${url}" style="max-width:100%;height:auto" />`;
    try { document.execCommand('insertHTML', false, html); } catch { /* ignore */ }
    syncHtml();
  };
  const onTplImgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { insertImageHtml(await compressImageFile(f)); } catch { message.error('图片读取失败'); }
  };
  const pasteImageToEditor = async () => {
    try {
      const items: any[] = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = (it.types || []).find((t: string) => t.startsWith('image/'));
        if (type) {
          insertImageHtml(await compressImageFile(await it.getType(type)));
          message.success('已插入剪切板图片');
          return;
        }
      }
      message.warning('剪切板中未找到图片');
    } catch { message.warning('读取剪切板失败，可用"插图"按钮选择图片文件'); }
  };
  // 选中图片并调整大小（宽度按容器百分比存储，预览/生成等比渲染）
  const [selImg, setSelImg] = useState<HTMLImageElement | null>(null);
  const [selImgW, setSelImgW] = useState(100);
  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') {
      if (selImg && selImg !== t) selImg.style.outline = '';
      const img = t as HTMLImageElement;
      img.style.outline = '2px solid #1890ff';
      const pw = editorRef.current?.clientWidth || img.width || 1;
      const cur = img.style.width.endsWith('%') ? parseFloat(img.style.width) : Math.min(100, Math.round((img.width / pw) * 100));
      setSelImg(img);
      setSelImgW(cur > 0 ? cur : 100);
    } else if (selImg) {
      selImg.style.outline = '';
      setSelImg(null);
    }
  };
  const applyImgWidth = (pct: number) => {
    if (!selImg) return;
    selImg.style.width = `${pct}%`;
    selImg.style.height = 'auto';
    setSelImgW(pct);
    syncHtml();
  };
  const resetImgSize = () => {
    if (!selImg) return;
    selImg.style.width = '';
    selImg.style.height = '';
    setSelImgW(100);
    syncHtml();
  };
  const restoreRange = () => {
    const sel = document.getSelection();
    if (sel && savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
  };
  // 收集与选区相交的段落块元素（collapsed 选区只返回光标所在的最内层块）
  // 注意：编辑器内容可能被 blockquote 包裹，需包含 blockquote；只取顶层块避免父子块重复应用
  const blocksInRange = (range: Range): HTMLElement[] => {
    const nodes: HTMLElement[] = [];
    const editor = editorRef.current;
    if (!editor) return nodes;
    // collapsed 选区（光标）对 intersectsNode 所有祖先都返回 true，需特殊处理
    if (range.collapsed) {
      const anc: any = range.commonAncestorContainer;
      const el = (anc.nodeType === 1 ? anc : anc.parentElement)?.closest?.('div,p,blockquote,h1,h2,h3,h4,h5,h6,li,td');
      if (el && editor.contains(el)) nodes.push(el);
      return nodes;
    }
    // 查询所有块级元素，但只保留顶层块（父节点不是同类块级元素的）
    const allBlocks = editor.querySelectorAll('div,p,blockquote,h1,h2,h3,h4,h5,h6,li,td');
    const topLevel: HTMLElement[] = [];
    allBlocks.forEach((el: any) => {
      const parent = el.parentElement;
      // 如果父节点也是块级元素且在编辑器内，说明 el 是嵌套块，跳过
      const parentIsBlock = parent && parent !== editor && parent.closest?.('div,p,blockquote,h1,h2,h3,h4,h5,h6,li,td');
      if (!parentIsBlock) topLevel.push(el);
    });
    topLevel.forEach((el: any) => {
      try { if (range.intersectsNode(el)) nodes.push(el); } catch { /* ignore */ }
    });
    return nodes;
  };
  // 选区对齐：对与选区相交的段落块设置 text-align（替代已废弃的 execCommand justify*）
  // 按钮通过 onMouseDown preventDefault 保持编辑器焦点，选区不丢失，直接取当前选区
  const applySelAlign = (align: 'left' | 'center' | 'right' | 'justify') => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) { message.info('请先选中要调整对齐的内容'); return; }
    const range = sel.getRangeAt(0);
    let blocks = blocksInRange(range);
    if (!blocks.length) {
      const anc: any = range.commonAncestorContainer;
      const el = (anc.nodeType === 1 ? anc : anc.parentElement)?.closest?.('div,p,blockquote,h1,h2,h3,h4,h5,h6,li,td');
      if (el && editorRef.current?.contains(el)) blocks = [el];
    }
    if (!blocks.length) { message.info('请先选中要调整对齐的内容'); return; }
    blocks.forEach(b => { b.style.textAlign = align; });
    syncHtml();
  };
  const execCmd = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    restoreRange();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* ignore */ }
    try { document.execCommand(cmd, false, val); } catch { /* ignore */ }
    syncHtml();
  };
  const insertToken = (token: string) => {
    editorRef.current?.focus();
    restoreRange();
    const span = `<span data-ph="${token}" contenteditable="false" style="color:#1677ff;background:#e6f0ff;border:1px solid #91bff5;border-radius:3px;padding:0 3px">{${token}}</span>`;
    try { document.execCommand('insertHTML', false, span); } catch { /* ignore */ }
    syncHtml();
  };
  // 选区行高：对与选区相交的段落块设置 line-height（InputNumber 通过 onFocus 保存选区）
  const applySelLineHeight = (v: number) => {
    restoreRange();
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) { message.info('请先选中要调整行高的内容'); return; }
    const range = sel.getRangeAt(0);
    let blocks = blocksInRange(range);
    if (!blocks.length) {
      const anc: any = range.commonAncestorContainer;
      const el = (anc.nodeType === 1 ? anc : anc.parentElement)?.closest?.('div,p,blockquote,h1,h2,h3,h4,h5,h6,li,td');
      if (el && editorRef.current?.contains(el)) blocks = [el];
    }
    if (!blocks.length) { message.info('请先选中要调整行高的内容'); return; }
    blocks.forEach(b => { b.style.lineHeight = String(v); });
    syncHtml();
  };
  // 选区字间距：将选区包入 span 设置 letter-spacing（保留内部既有格式，InputNumber 通过 onFocus 保存选区）
  const applySelLetterSpacing = (v: number) => {
    restoreRange();
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) { message.info('请先选中要调整字间距的内容'); return; }
    const range = sel.getRangeAt(0);
    if (range.collapsed) { message.info('请先选中要调整字间距的内容'); return; }
    const span = document.createElement('span');
    span.style.letterSpacing = `${v}px`;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch { /* ignore */ }
    syncHtml();
  };
  const addCustomField = () => {
    const label = newCustom.trim();
    if (!label) { message.warning('请输入自定义字段名称'); return; }
    if (tplDraft.customFields.some(c => c.label === label)) { message.warning('字段已存在'); return; }
    setTplDraft(d => ({ ...d, customFields: [...d.customFields, { key: genKey('CF'), label }] }));
    setNewCustom('');
  };
  const curStyle: CertStyle = { ...DEFAULT_CERT_STYLE, ...(tplDraft.style || {}) };
  // 水印配置与水印文本占位符插入
  const wm: WatermarkCfg = { ...DEFAULT_WATERMARK, ...(tplDraft.watermark || {}) };
  const setWm = (patch: Partial<WatermarkCfg>) => setTplDraft(d => ({ ...d, watermark: { ...DEFAULT_WATERMARK, ...(d.watermark || {}), ...patch } }));
  const wmInputRef = useRef<any>(null);
  const insertWmToken = (token: string) => {
    const el = wmInputRef.current?.input as HTMLInputElement | undefined;
    const tok = `{${token}}`;
    const cur = wm.text;
    if (el) {
      const s = el.selectionStart ?? cur.length;
      const e = el.selectionEnd ?? s;
      setWm({ text: cur.slice(0, s) + tok + cur.slice(e) });
      setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + tok.length; }, 0);
    } else {
      setWm({ text: cur + tok });
    }
  };
  // 预览容器宽度监听 → 计算 A4 缩放比
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const measure = () => setPreviewW(Math.max(0, el.clientWidth - 20));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tplVisible]);
  // 编辑器选区变化时留存 range（供工具栏夺焦后恢复）
  useEffect(() => {
    if (!tplVisible) return;
    const onSelChange = () => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0 && sel.anchorNode && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [tplVisible]);
  const pScale = previewW > 0 ? previewW / A4_W : 0.5;
  const sampleValues = useMemo(() => {
    const base: Record<string, string> = {
      '公司名称': maskCompanySample('瑞安市锋筆百货商行(个体工商户)'), '纳税人识别码': '92330381MA2XXXXX', '法人代表': '张三',
      '经营地址': '浙江省瑞安市xxx', '联系电话': '13800000000', '授权平台': '抖音', '授权平台网址': 'https://www.douyin.com',
      '保证金': '5000', '授权编号': 'SQ-SAMPLE-20260101-001', '品牌名称': '步步酷', '商标号': '37048309',
      '类目': '25 类鞋子', '店铺名称': '步步酷锋等鞋类专卖店', '有效期起': '2026 年 8 月 15 日', '有效期止': '2027 年 8 月 15 日',
      '落款公司': maskCompanySample(readCompany(owner) || '瑞安市诺莱德鞋业有限公司'), '落款日期': todayCn(),
      '品牌方公司': maskCompanySample(readCompany(owner) || '瑞安市诺莱德鞋业有限公司'), '授权方': '张三', '信用代码': '92330381MA2XXXXX',
      '店铺账号': 'bubu20260101', '店铺ID': 'bubu20260101', '店铺类型': '专卖店', '年费': '1000', '联系人': '张三', '授权日期': todayCn(), '注册商标号': '37048309',
    };
    (tplDraft.customFields || []).forEach(cf => { base[cf.label] = `【${cf.label}】`; });
    return base;
  }, [tplDraft.customFields, owner]);
  // A4 分页预览：按段落块切分为多页，每页固定 A4 纸比例（Word 多页视图）；
  // 协议书等长文不再把单张纸撑高变形，隐藏测量容器与可见页同源渲染保证切页高度准确
  useLayoutEffect(() => {
    let box = measureRef.current?.firstElementChild as HTMLElement | null;
    if (!box) { setPreviewPages([]); return; }
    // 段落块在内层 position:relative 包裹中（buildCertPageHtml 结构），下钻一层取真实段落
    const wrap = Array.from(box.children).find(c => (c as HTMLElement).style && (c as HTMLElement).style.position === 'relative') as HTMLElement | undefined;
    if (wrap && wrap.children.length) box = wrap;
    const root = box;
    const cs = getComputedStyle(measureRef.current?.firstElementChild as HTMLElement);
    const usable = A4_H - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const kids = Array.from(root.children) as HTMLElement[];
    const groups: HTMLElement[][] = [];
    let cur: HTMLElement[] = [];
    let cum = 0;
    kids.forEach(k => {
      const h = k.offsetHeight || 0;
      if (cur.length && cum + h > usable) { groups.push(cur); cur = []; cum = 0; }
      cur.push(k); cum += h;
    });
    if (cur.length || !groups.length) groups.push(cur);
    const next = groups.map(g => g.map(k => k.outerHTML).join(''));
    setPreviewPages(prev => (prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next));
  }, [tplDraft.html, tplDraft.style, tplVisible, tplMode, sampleValues, measureTick]);

  // ============ 收款账户 ============
  const openRecv = () => { recvForm.setFieldsValue(recv); setRecvVisible(true); };

  // 外部链接用公司编号（不暴露登录账号；无编号的老账号回退账号名）；勾选绑定负责人时携带 ?pic=<子账号>
  const companyCode = useMemo(() => {
    try {
      const us: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = us.find(x => x.username === owner);
      return (u && (u.companyNo || u.companyShortName)) || owner;
    } catch { return owner; }
  }, [owner]);
  const applyLink = `${window.location.origin}/brand-apply/${encodeURIComponent(companyCode)}${bindPic && picUser ? `?pic=${encodeURIComponent(picUser)}` : ''}`;

  const columns: ColumnsType<BrandApplication> = [
    {
      title: '申请编号', dataIndex: 'appNo', key: 'appNo', width: 150, align: 'center', fixed: 'left',
      render: (_v, r) => <Button type="link" size="small" onClick={() => { setBankAccounts(safeJson<any[]>(`pageData_finance_bank-account_${owner}`, [])); setDetailApp(r); }}>{r.appNo || '—'}</Button>,
    },
    { title: '申请时间', dataIndex: 'appliedAt', key: 'appliedAt', width: 110, align: 'center' },
    { title: '客户名称', key: 'customerName', width: 180, ellipsis: true, render: (_v, r) => (r.agentUsername ? readCompany(r.agentUsername) : '') || '—' },
    { title: '开店公司', dataIndex: 'companyName', key: 'companyName', width: 200, ellipsis: true },
    { title: '负责人', dataIndex: 'personInCharge', key: 'personInCharge', width: 100, align: 'center', render: v => v || '—' },
    { title: '纳税人识别码', dataIndex: 'taxpayerCode', key: 'taxpayerCode', width: 160, ellipsis: true },
    { title: '法人代表', dataIndex: 'legalPerson', key: 'legalPerson', width: 90, align: 'center' },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 120, align: 'center' },
    { title: '经营地址', dataIndex: 'address', key: 'address', width: 180, ellipsis: true },
    { title: '授权平台', dataIndex: 'platform', key: 'platform', width: 90, align: 'center' },
    { title: '平台网址', dataIndex: 'platformUrl', key: 'platformUrl', width: 150, ellipsis: true, render: v => (v ? <a href={v} target="_blank" rel="noreferrer">{v}</a> : '—') },
    {
      title: '保证金', key: 'deposit', width: 120, align: 'center',
      render: (_v, r) => {
        const req = refundReqs.find(q => q.appKey === r.key && q.status === '已申请');
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span>{r.deposit ? `¥${r.deposit}` : '—'}</span>
            {r.depositState === '已退回' ? (
              <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#52c41a', fontWeight: 600 }} onClick={() => {
                const q = refundReqs.find(x => x.appKey === r.key);
                if (q) setRefundDetailReq(q); else openDeposit(r);
              }}>成功退回{r.refundAt ? `（${r.refundAt}）` : ''}</Button>
            )
              : req ? <Button type="link" size="small" danger style={{ padding: 0, height: 'auto', fontWeight: 600, animation: 'pulse 1.5s infinite' }} onClick={() => openDeposit(r)}>退回申请待处理</Button>
              : r.depositState === '已确认' ? (r.depositPaymentKey
                ? <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#722ed1' }} onClick={() => openDeposit(r)}>退款中</Button>
                : <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#52c41a' }} onClick={() => openDeposit(r)}>已确认到账</Button>
              )
              : <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#fa8c16', fontWeight: 600 }} onClick={() => openDeposit(r)}>待确认</Button>}
          </div>
        );
      },
    },
    {
      title: '付款截图', dataIndex: 'payShot', key: 'payShot', width: 90, align: 'center',
      render: v => (v ? <AntdImage src={v} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'),
    },
    {
      title: '营业执照', dataIndex: 'businessLicense', key: 'businessLicense', width: 90, align: 'center',
      render: v => (v ? <AntdImage src={v} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'),
    },
    {
      title: '身份证正', dataIndex: 'idFront', key: 'idFront', width: 90, align: 'center',
      render: v => (v ? <AntdImage src={v} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'),
    },
    {
      title: '身份证反', dataIndex: 'idBack', key: 'idBack', width: 90, align: 'center',
      render: v => (v ? <AntdImage src={v} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'),
    },
    {
      title: '店铺类型', dataIndex: 'shopType', key: 'shopType', width: 90, align: 'center',
      render: v => (v ? <span style={shopTypeStyle(v)}>{v}</span> : '—'),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 110, align: 'center',
      render: (v, r) => <Tag color={v === '已生成授权书' ? 'green' : v === '已确认到账' ? 'blue' : v === '已驳回' ? 'red' : 'orange'}
        title={v === '已驳回' ? `驳回原因：${r.rejectReason || '—'}` : undefined}>{v}</Tag>,
    },
    { title: <span>授权编号 <Tooltip title="点击设置授权编号生成格式（前缀/中段/日期段/分隔符/流水位数）"><SettingOutlined style={{ color: '#1677ff' }} onClick={() => openAuthFmt()} /></Tooltip></span>, dataIndex: 'authNo', key: 'authNo', width: 170, align: 'center', render: v => (v ? <Tag color="purple">{v}</Tag> : '—') },
    { title: '品牌/商标', key: 'brand', width: 140, align: 'center', render: (_v, r) => (r.brandName ? `${r.brandName} / ${r.trademarkNo || '—'}` : '—') },
    { title: '有效期', key: 'valid', width: 180, align: 'center', render: (_v, r) => (r.validFrom ? `${r.validFrom} ~ ${r.validTo}` : '—') },
    {
      title: '销售数据', key: 'sales', width: 100, align: 'center',
      render: (_v, r) => {
        const rec = salesRecords.find(x => x.appKey === r.key && x.month === salesMonth);
        return rec
          ? <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#52c41a', fontWeight: 600 }} onClick={() => setSalesDetail(rec)}>已提交</Button>
          : <span style={{ color: '#999' }}>未提交</span>;
      },
    },
    {
      title: '授权书', key: 'cert', width: 110, align: 'center',
      render: (_v, r) => (pendingRenew(r)
        ? <Button type="link" size="small" danger icon={<RedoOutlined />} onClick={() => openCertCfg(r)}>续签申请</Button>
        : r.certHtml
          ? <Button type="link" size="small" icon={<FileProtectOutlined />} onClick={() => setCertView(r)}>查看</Button>
          : <Button type="link" size="small" icon={<SafetyCertificateOutlined />} onClick={() => openCertCfg(r)}>生成授权书</Button>),
    },
    {
      title: '授权书图', dataIndex: 'certImage', key: 'certImage', width: 110, align: 'center',
      render: (v, r) => (v
        ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setCertImgView(r)}><AntdImage src={v} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} /></Button>
        : <Button type="link" size="small" icon={<PictureOutlined />} onClick={() => openUpCert(r)}>上传授权书</Button>),
    },
    {
      title: '查询链接', key: 'share', width: 90, align: 'center',
      render: (_v, r) => (r.shareCode
        ? <Tooltip title={certLink(r)}><Button type="link" size="small" icon={<CopyOutlined />} onClick={() => { copyText(certLink(r)).then(ok => (ok ? message.success('查询链接已复制，可发给代理商') : message.error('复制失败，请手动复制'))); }}>复制</Button></Tooltip>
        : '—'),
    },
    {
      title: '操作', key: 'action', width: 170, align: 'center', fixed: 'right',
      render: (_v, r) => (
        <Space size={0}>
          <Button type="link" size="small" style={{ padding: '0 4px' }} icon={<EditOutlined />}
            disabled={r.depositState === '已确认' || r.depositState === '已退回'}
            title={r.depositState === '已确认' || r.depositState === '已退回' ? '保证金收款确认后不可修改' : undefined}
            onClick={() => openEditApp(r)}>编辑</Button>
          {r.status === '待确认' && (
            <Button type="link" size="small" style={{ padding: '0 4px' }} danger icon={<CloseCircleOutlined />}
              onClick={() => { setRejectTarget(r); setRejectReason(''); }}>驳回</Button>
          )}
          {canArchive(r) && (
            <Button type="link" size="small" style={{ padding: '0 4px' }} icon={<InboxOutlined />} onClick={() => doArchive(r)}>归档</Button>
          )}
        </Space>
      ),
    },
  ];

  // 显示字段设置：字段清单（不含操作列）+ 按顺序/勾选派生显示列
  const OWN_FIELD_LABELS: Record<string, string> = { authNo: '授权编号' };
  const ownFields = useMemo(() => columns
    .filter(c => c.key && c.key !== 'action')
    .map(c => ({ key: String(c.key), label: typeof c.title === 'string' ? c.title : (OWN_FIELD_LABELS[String(c.key)] || String(c.key)) })), [columns]);
  const ownFieldVisResolved = useMemo(() => {
    const d: Record<string, boolean> = {};
    ownFields.forEach(f => { d[f.key] = ownFieldVis[f.key] !== false; });
    return d;
  }, [ownFields, ownFieldVis]);
  const visibleColumns = useMemo(() => {
    const byKey = new Map(columns.map(c => [String(c.key), c]));
    const allKeys = columns.filter(c => c.key && c.key !== 'action').map(c => String(c.key));
    const order = [...ownFieldOrder.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !ownFieldOrder.includes(k))];
    const list = order.filter(k => ownFieldVis[k] !== false).map(k => byKey.get(k)!).filter(Boolean);
    const actionCol = columns.find(c => c.key === 'action');
    return actionCol ? [...list, actionCol] : list;
  }, [columns, ownFieldOrder, ownFieldVis]);
  const saveOwnFieldCfg = (order: string[], vis: Record<string, boolean>) => {
    setOwnFieldOrder(order); setOwnFieldVis(vis);
    try { localStorage.setItem(`ownbrand_fieldorder_${owner}`, JSON.stringify(order)); localStorage.setItem(`ownbrand_fieldvis_${owner}`, JSON.stringify(vis)); } catch { /* ignore */ }
    setOwnFieldCfgVisible(false);
    message.success('字段设置已保存');
  };

  // 销售数据分析派生：按月/时间范围过滤 → 汇总卡 + 按店铺 + 按月份两张统计表
  // 申请键 → 申请记录（负责人等关联字段）
  const appByKey = useMemo(() => new Map(apps.map(a => [a.key, a])), [apps]);
  const anaRows = useMemo(() => salesRecords.filter(r => (anaMode === 'month' ? r.month === anaMonth : r.month >= anaRange[0] && r.month <= anaRange[1])), [salesRecords, anaMode, anaMonth, anaRange]);
  const anaAmount = useMemo(() => anaRows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [anaRows]);
  const anaQty = useMemo(() => anaRows.reduce((s, r) => s + (Number(r.qty) || 0), 0), [anaRows]);
  const anaScore = anaRows.length ? anaRows.reduce((s, r) => s + (Number(r.score) || 0), 0) / anaRows.length : 0;
  const anaShopCount = useMemo(() => new Set(anaRows.map(r => r.appKey)).size, [anaRows]);
  const anaByShop = useMemo(() => {
    const m = new Map<string, BrandSalesRecord[]>();
    anaRows.forEach(r => { const l = m.get(r.appKey) || []; l.push(r); m.set(r.appKey, l); });
    return Array.from(m.entries()).map(([appKey, ls]) => ({
      appKey,
      shop: ls[0].shopName || ls[0].companyName || '—',
      company: ls[0].companyName || '—',
      brand: ls[0].brandName || '—',
      person: appByKey.get(appKey)?.personInCharge || '未指定',
      months: ls.length,
      qty: ls.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      amount: ls.reduce((s, x) => s + (Number(x.amount) || 0), 0),
      score: ls.reduce((s, x) => s + (Number(x.score) || 0), 0) / ls.length,
      lastMonth: ls.map(x => x.month).sort().slice(-1)[0] || '',
    }));
  }, [anaRows, appByKey]);
  // 按负责人统计（负责人取申请记录 personInCharge）
  const anaByPerson = useMemo(() => {
    const m = new Map<string, BrandSalesRecord[]>();
    anaRows.forEach(r => { const p = appByKey.get(r.appKey)?.personInCharge || '未指定'; const l = m.get(p) || []; l.push(r); m.set(p, l); });
    return Array.from(m.entries()).map(([person, ls]) => ({
      person,
      shops: new Set(ls.map(x => x.appKey)).size,
      records: ls.length,
      qty: ls.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      amount: ls.reduce((s, x) => s + (Number(x.amount) || 0), 0),
      score: ls.reduce((s, x) => s + (Number(x.score) || 0), 0) / ls.length,
    })).sort((a, b) => b.amount - a.amount);
  }, [anaRows, appByKey]);
  // 品牌统计
  const anaByBrand = useMemo(() => {
    const m = new Map<string, BrandSalesRecord[]>();
    anaRows.forEach(r => { const b = r.brandName || '未知'; const l = m.get(b) || []; l.push(r); m.set(b, l); });
    return Array.from(m.entries()).map(([brand, ls]) => ({
      brand,
      shops: new Set(ls.map(x => x.appKey)).size,
      records: ls.length,
      qty: ls.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      amount: ls.reduce((s, x) => s + (Number(x.amount) || 0), 0),
      score: ls.reduce((s, x) => s + (Number(x.score) || 0), 0) / ls.length,
    })).sort((a, b) => b.amount - a.amount);
  }, [anaRows]);
  // 店铺搜索过滤 + 销售排行
  const anaShopFiltered = useMemo(() => {
    const kw = anaShopSearch.trim().toLowerCase();
    if (!kw) return anaByShop;
    return anaByShop.filter(r => `${r.shop} ${r.company} ${r.brand} ${r.person}`.toLowerCase().includes(kw));
  }, [anaByShop, anaShopSearch]);
  const anaRank = useMemo(() => {
    const key = anaRankMetric;
    return [...anaShopFiltered].sort((a, b) => (b as any)[key] - (a as any)[key]).map((r, i) => ({ ...r, rank: i + 1 }));
  }, [anaShopFiltered, anaRankMetric]);
  // 店铺明细：当前时间范围内所有店铺的逐条提交记录（受店铺搜索过滤）
  const anaDetail = useMemo(() => {
    const kw = anaShopSearch.trim().toLowerCase();
    const rows = anaRows.map(r => ({ ...r, person: appByKey.get(r.appKey)?.personInCharge || '未指定' }));
    if (!kw) return rows;
    return rows.filter(r => `${r.shopName} ${r.companyName} ${r.brandName} ${r.person}`.toLowerCase().includes(kw));
  }, [anaRows, anaShopSearch, appByKey]);
  const anaByMonth = useMemo(() => {
    const m = new Map<string, BrandSalesRecord[]>();
    anaRows.forEach(r => { const l = m.get(r.month) || []; l.push(r); m.set(r.month, l); });
    return Array.from(m.entries()).map(([month, ls]) => ({
      month,
      shops: new Set(ls.map(x => x.appKey)).size,
      qty: ls.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      amount: ls.reduce((s, x) => s + (Number(x.amount) || 0), 0),
      score: ls.reduce((s, x) => s + (Number(x.score) || 0), 0) / ls.length,
    })).sort((a, b) => a.month.localeCompare(b.month));
  }, [anaRows]);

  const detailCur = detailApp ? (apps.find(a => a.key === detailApp.key) || detailApp) : null;
  const genTpl = tplList.find(x => x.key === genTplKey) || tpl;

  // ============ 销售数据分析子页：汇总 + 店铺统计/排行 + 负责人/品牌统计 + 月度趋势 ============
  if (showAnalysis) {
    return (
      <div style={{ padding: embedded ? 0 : 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => setShowAnalysis(false)}>返回列表</Button>
          <Text strong style={{ fontSize: 16 }}>销售数据分析</Text>
          <Radio.Group size="small" value={anaMode} onChange={e => setAnaMode(e.target.value)} optionType="button" buttonStyle="solid"
            options={[{ value: 'month', label: '按月' }, { value: 'range', label: '按时间范围' }]} />
          {anaMode === 'month'
            ? <DatePicker picker="month" size="small" allowClear={false} value={dayjs(anaMonth)} onChange={d => setAnaMonth(d ? d.format('YYYY-MM') : dayjs().format('YYYY-MM'))} />
            : <DatePicker.RangePicker picker="month" size="small" allowClear={false}
              value={[dayjs(anaRange[0]), dayjs(anaRange[1])]}
              onChange={v => { if (v && v[0] && v[1]) setAnaRange([v[0].format('YYYY-MM'), v[1].format('YYYY-MM')]); }} />}
          <Input.Search placeholder="店铺搜索（店铺/公司/品牌/负责人）" allowClear style={{ width: 260 }} value={anaShopSearch} onChange={e => setAnaShopSearch(e.target.value)} />
          <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        </Space>
        <Row gutter={12} style={{ marginBottom: 12, background: '#f7f9fc', borderRadius: 6, padding: '8px 12px' }}>
          <Col flex="1 1 120px"><Statistic title="提交店铺" value={anaShopCount} suffix="家" /></Col>
          <Col flex="1 1 120px"><Statistic title="提交记录" value={anaRows.length} suffix="条" /></Col>
          <Col flex="1 1 130px"><Statistic title="总销售额" value={anaAmount} suffix="元" valueStyle={{ color: '#52c41a' }} /></Col>
          <Col flex="1 1 120px"><Statistic title="总销售数量" value={anaQty} suffix="件" /></Col>
          <Col flex="1 1 120px"><Statistic title="平均店铺评分" value={anaScore} precision={2} /></Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} xl={14}>
            <Card size="small" title="月度趋势" style={{ marginBottom: 12 }}>
              <Table rowKey="month" size="small" bordered pagination={false} dataSource={anaByMonth}
                columns={sizedAnaMonth([
                  { title: '月份', dataIndex: 'month', key: 'month', width: 100, align: 'center' },
                  { title: '提交店铺数', dataIndex: 'shops', key: 'shops', width: 100, align: 'center' },
                  { title: '销售数量', dataIndex: 'qty', key: 'qty', width: 100, align: 'center' },
                  { title: '销售额', dataIndex: 'amount', key: 'amount', width: 120, align: 'center', render: (v: number) => `¥${v}` },
                  { title: '平均评分', dataIndex: 'score', key: 'score', width: 90, align: 'center', render: (v: number) => v.toFixed(2) },
                ] as any)} />
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card size="small" title="销售数据排行" style={{ marginBottom: 12 }}
              extra={<Select size="small" style={{ width: 110 }} value={anaRankMetric} onChange={v => setAnaRankMetric(v)}
                options={[{ value: 'amount', label: '按销售额' }, { value: 'qty', label: '按销售数量' }, { value: 'score', label: '按平均评分' }]} />}>
              <Table rowKey="appKey" size="small" bordered pagination={false} dataSource={anaRank}
                columns={sizedAnaRank([
                  { title: '名次', dataIndex: 'rank', key: 'rank', width: 60, align: 'center', render: (v: number) => (v <= 3 ? <Tag color={v === 1 ? 'gold' : v === 2 ? 'blue' : 'orange'}>{v}</Tag> : v) },
                  { title: '店铺名称', dataIndex: 'shop', key: 'shop', width: 140, ellipsis: true },
                  { title: '负责人', dataIndex: 'person', key: 'person', width: 80, align: 'center' },
                  { title: '销售数量', dataIndex: 'qty', key: 'qty', width: 80, align: 'center' },
                  { title: '销售额', dataIndex: 'amount', key: 'amount', width: 100, align: 'center', render: (v: number) => `¥${v}` },
                  { title: '平均评分', dataIndex: 'score', key: 'score', width: 80, align: 'center', render: (v: number) => v.toFixed(2) },
                ] as any)} />
            </Card>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} xl={12}>
            <Card size="small" title="按负责人统计" style={{ marginBottom: 12 }}>
              <Table rowKey="person" size="small" bordered pagination={false} dataSource={anaByPerson}
                columns={sizedAnaPerson([
                  { title: '负责人', dataIndex: 'person', key: 'person', width: 110, align: 'center' },
                  { title: '店铺数', dataIndex: 'shops', key: 'shops', width: 80, align: 'center' },
                  { title: '提交记录', dataIndex: 'records', key: 'records', width: 80, align: 'center' },
                  { title: '销售数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'center' },
                  { title: '销售额', dataIndex: 'amount', key: 'amount', width: 110, align: 'center', render: (v: number) => `¥${v}` },
                  { title: '平均评分', dataIndex: 'score', key: 'score', width: 80, align: 'center', render: (v: number) => v.toFixed(2) },
                ] as any)} />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="品牌统计" style={{ marginBottom: 12 }}>
              <Table rowKey="brand" size="small" bordered pagination={false} dataSource={anaByBrand}
                columns={sizedAnaBrand([
                  { title: '品牌', dataIndex: 'brand', key: 'brand', width: 110, align: 'center' },
                  { title: '店铺数', dataIndex: 'shops', key: 'shops', width: 80, align: 'center' },
                  { title: '提交记录', dataIndex: 'records', key: 'records', width: 80, align: 'center' },
                  { title: '销售数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'center' },
                  { title: '销售额', dataIndex: 'amount', key: 'amount', width: 110, align: 'center', render: (v: number) => `¥${v}` },
                  { title: '平均评分', dataIndex: 'score', key: 'score', width: 80, align: 'center', render: (v: number) => v.toFixed(2) },
                ] as any)} />
            </Card>
          </Col>
        </Row>
        <Card size="small" title="店铺统计（当前时间范围所有店铺明细）">
          <Table rowKey="key" size="small" bordered pagination={false} dataSource={anaDetail}
            columns={sizedAnaDetail([
              { title: '月份', dataIndex: 'month', key: 'month', width: 90, align: 'center' },
              { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 150, ellipsis: true, render: (v: any, r: any) => v || r.companyName || '—' },
              { title: '开店公司', dataIndex: 'companyName', key: 'companyName', width: 160, ellipsis: true },
              { title: '品牌', dataIndex: 'brandName', key: 'brandName', width: 90, align: 'center' },
              { title: '负责人', dataIndex: 'person', key: 'person', width: 90, align: 'center' },
              { title: '销售数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'center' },
              { title: '销售额', dataIndex: 'amount', key: 'amount', width: 110, align: 'center', render: (v: number) => `¥${v}` },
              { title: '店铺评分', dataIndex: 'score', key: 'score', width: 80, align: 'center', render: (v: number) => (Number(v) || 0).toFixed(2) },
              { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 150, align: 'center', render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—') },
            ] as any)} />
        </Card>
      </div>
    );
  }

  // ============ 归档数据子页：保证金已退回且授权已到期的申请 ============
  if (showArchive) {
    const archivedApps = apps.filter(a => a.archived);
    return (
      <div style={{ padding: embedded ? 0 : 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => setShowArchive(false)}>返回列表</Button>
          <Text strong style={{ fontSize: 16 }}>归档数据</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>保证金已退回且授权已到期的申请归档后在此查看</Text>
        </Space>
        <Table rowKey="key" size="small" bordered dataSource={archivedApps}
          columns={sizedArch([
            { title: '申请编号', dataIndex: 'appNo', key: 'appNo', width: 150, align: 'center', render: (v: string) => v || '—' },
            { title: '客户名称', key: 'customerName', width: 160, ellipsis: true, render: (_v: any, r: BrandApplication) => (r.agentUsername ? readCompany(r.agentUsername) : '') || '—' },
            { title: '开店公司', dataIndex: 'companyName', key: 'companyName', width: 200, ellipsis: true },
            { title: '法人代表', dataIndex: 'legalPerson', key: 'legalPerson', width: 90, align: 'center' },
            { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 120, align: 'center' },
            { title: '授权平台', dataIndex: 'platform', key: 'platform', width: 90, align: 'center' },
            { title: '状态', dataIndex: 'status', key: 'status', width: 100, align: 'center', render: (v: string) => <Tag color={v === '已驳回' ? 'red' : 'blue'}>{v}</Tag> },
            { title: '保证金', dataIndex: 'depositState', key: 'depositState', width: 90, align: 'center', render: (v: string) => v || '—' },
            { title: '有效期', key: 'valid', width: 200, align: 'center', render: (_v: any, r: BrandApplication) => (r.validFrom && r.validTo ? `${r.validFrom} ~ ${r.validTo}` : '—') },
            { title: '归档时间', dataIndex: 'archivedAt', key: 'archivedAt', width: 110, align: 'center', render: (v: string) => v || '—' },
          ] as any)}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }} />
      </div>
    );
  }

  return (
    <div style={embedded ? { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { padding: 12 }}>
      {/* 统计卡：数字即筛选口径，点击卡片自动筛选表格对应内容（再点取消） */}
      <Row gutter={8} style={{ marginBottom: 12, flexShrink: 0 }}>
        {([
          { k: '', t: '申请总数', v: stats.total, c: '#333' },
          { k: 'pending', t: '保证金待确认', v: stats.pending, c: '#fa8c16' },
          { k: 'refundReq', t: '退回申请待处理', v: stats.refundReq, c: '#f5222d' },
          { k: 'renew', t: '续签申请待处理', v: stats.renew, c: '#fa541c' },
          { k: 'refunded', t: '保证金已退回', v: stats.refunded, c: '#722ed1' },
          { k: 'certed', t: '待发放授权', v: stats.certed, c: '#faad14' },
          { k: 'issued', t: '已发放授权', v: stats.issued, c: '#52c41a' },
          { k: 'depHold', t: '待退保证金总额', v: stats.depHoldSum, c: '#f5222d', suf: '元' },
          { k: 'nosales', t: '本月销售未提交', v: stats.nosales, c: '#8c8c8c' },
        ] as { k: string; t: string; v: number; c: string; suf?: string }[]).map(s => (
          <Col flex="1 1 140px" key={s.k || 'total'}>
            <div onClick={() => setStatFilter(f => (f === s.k ? '' : s.k))}
              title={s.k ? '点击筛选对应申请' : '点击显示全部'}
              style={{ cursor: 'pointer', borderRadius: 6, padding: '6px 12px', marginBottom: 4, background: statFilter === s.k ? '#e6f4ff' : '#f7f9fc', border: statFilter === s.k ? '1px solid #1677ff' : '1px solid transparent' }}>
              <Statistic title={s.t} value={s.v} suffix={s.suf || '件'} valueStyle={{ color: s.c, fontSize: 22 }} />
            </div>
          </Col>
        ))}
      </Row>

      {/* 搜索行：按字段拆分，回车或点查询生效 */}
      <Space wrap style={{ marginBottom: 8, flexShrink: 0 }}>
        <Input placeholder="申请编号" style={{ width: 150 }} allowClear value={fInput.appNo} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, appNo: e.target.value }))} />
        <Input placeholder="开店公司" style={{ width: 170 }} allowClear value={fInput.company} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, company: e.target.value }))} />
        <Input placeholder="负责人" style={{ width: 110 }} allowClear value={fInput.person} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, person: e.target.value }))} />
        <Input placeholder="联系电话" style={{ width: 130 }} allowClear value={fInput.phone} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, phone: e.target.value }))} />
        <Input placeholder="纳税人识别码" style={{ width: 160 }} allowClear value={fInput.tax} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, tax: e.target.value }))} />
        <Input placeholder="授权平台" style={{ width: 110 }} allowClear value={fInput.platform} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, platform: e.target.value }))} />
        <Input placeholder="授权编号" style={{ width: 170 }} allowClear value={fInput.authNo} onPressEnter={applySearch}
          onChange={e => setFInput(s => ({ ...s, authNo: e.target.value }))} />
        <Select placeholder="店铺类型" style={{ width: 110 }} allowClear value={fInput.shopType || undefined}
          onChange={(v: string) => setFInput(s => ({ ...s, shopType: v || '' }))}
          options={SHOP_TYPES.map(x => ({ value: x, label: x }))} />
        <Select placeholder="状态" style={{ width: 130 }} value={fStatus || undefined} onChange={v => setFStatus(v || '')} allowClear
          options={['待确认', '已确认到账', '已生成授权书', '授权书已发', '续签成功', '已驳回'].map(x => ({ value: x, label: x }))} />
        <Select placeholder="保证金状态" style={{ width: 140 }} value={fDepState || undefined} onChange={v => setFDepState(v || '')} allowClear
          options={['已确认到账', '退款中', '退回申请待处理', '已退回', '待确认'].map(x => ({ value: x, label: x }))} />
        <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>查询</Button>
        <Button onClick={resetSearch}>重置</Button>
      </Space>
      {/* 其他功能按键：搜索框下方一行 */}
      <Space wrap style={{ marginBottom: 12, flexShrink: 0 }}>
        <Button type="primary" icon={<LinkOutlined />} onClick={() => setLinkVisible(true)}>外部申请链接</Button>
        <Button icon={<BankOutlined />} onClick={openRecv}>品牌方收款账户</Button>
        <Button icon={<EditOutlined />} onClick={() => openTpl('agr')}>协议书模版编辑</Button>
        <Button icon={<FileProtectOutlined />} onClick={() => openTpl('cert')}>授权书模版编辑</Button>
        <Button icon={<PlusOutlined />} onClick={() => setOwnVisible(true)}>自有品牌台账</Button>
        {isAdminAcc && <Button icon={<TeamOutlined />} onClick={() => setManagersVisible(true)}>负责人设置</Button>}
        <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>销售月份</span>
        <DatePicker picker="month" size="small" allowClear={false} value={dayjs(salesMonth)}
          onChange={d => setSalesMonth(d ? d.format('YYYY-MM') : dayjs().format('YYYY-MM'))} />
        <Button icon={<BarChartOutlined />} onClick={() => setShowAnalysis(s => !s)}>销售数据分析</Button>
        <Button icon={<InboxOutlined />} onClick={() => setShowArchive(true)}>归档数据</Button>
        <Button icon={<SettingOutlined />} onClick={() => setOwnFieldCfgVisible(true)}>显示字段</Button>
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </Space>

      <div ref={stick.ref} style={{ flex: 1, minHeight: 0 }}>
        <Table rowKey="key" size="small" bordered columns={sizedOwn(visibleColumns)} dataSource={filtered}
          scroll={{ x: 2290, y: stick.scrollY }} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无外部授权申请，可将"外部申请链接"发给代理商' }} />
      </div>

      {/* 外部申请链接：公司编号不暴露登录账号；可勾选绑定负责人（链接携带 ?pic） */}
      <Modal title="外部品牌授权申请链接" open={linkVisible} onCancel={() => setLinkVisible(false)} footer={null} width={560}>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>将此链接发给代理商/分销商，无需登录即可提交品牌授权申请，提交后自动出现在本页列表。</div>
        <Input.Group compact>
          <Input value={applyLink} readOnly style={{ width: 'calc(100% - 90px)' }} />
          <Button type="primary" icon={<CopyOutlined />} onClick={() => { copyText(applyLink).then(ok => (ok ? message.success('链接已复制') : message.error('复制失败，请手动复制'))); }}>复制</Button>
        </Input.Group>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Checkbox checked={bindPic} onChange={e => {
            setBindPic(e.target.checked);
            if (e.target.checked && !picUser) setPicUser(localStorage.getItem('isSubAccount') === 'true' ? meUsername : (subUsers[0]?.username || ''));
          }}>绑定负责人</Checkbox>
          {bindPic && (
            <Select size="small" style={{ width: 200 }} value={picUser || undefined} placeholder="选择负责人" onChange={v => setPicUser(v)}
              options={subUsers.map((u: any) => ({ value: u.username, label: `${nameOfU(u)}${u.isSubAccount ? '' : '（管理员）'}` }))} />
          )}
        </div>
        <div style={{ marginTop: 6, color: '#999', fontSize: 12 }}>勾选后代理商经此链接提交的申请，负责人自动登记为所选子账号姓名；链接中以公司编号代替登录账号。</div>
        <div style={{ marginTop: 12 }}>
          <Button icon={<LinkOutlined />} onClick={() => window.open(applyLink, '_blank')}>在新窗口打开预览</Button>
        </div>
      </Modal>

      {/* 负责人设置：仅管理员可配；负责人+管理员看全部，其余人仅看负责人为自己的申请 */}
      <Modal title="品牌管理负责人设置" open={managersVisible} onCancel={() => setManagersVisible(false)} width={480}
        onOk={() => { writeJson(managersKey(owner), managersSel); setManagersVisible(false); message.success('负责人已保存：仅负责人与管理员可查看全部申请，其他人仅可见负责人为自己的申请'); }}
        okText="保存" cancelText="取消">
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>设置品牌管理菜单的负责人；名单为空时所有账号可见全部信息，管理员（主账号）始终可见全部。</div>
        <Select mode="multiple" style={{ width: '100%' }} placeholder="选择负责人" value={managersSel} onChange={v => setManagersSel(v)}
          options={subUsers.map((u: any) => ({ value: u.username, label: `${nameOfU(u)}${u.isSubAccount ? '' : '（管理员）'}（${u.username}）` }))} />
      </Modal>

      {/* 驳回申请：填写驳回原因，同步镜像至代理商后台 */}
      <Modal open={!!rejectTarget} title={`驳回申请 - ${rejectTarget?.companyName || ''}`} okText="确认驳回" okButtonProps={{ danger: true }}
        onOk={confirmReject} onCancel={() => setRejectTarget(null)} cancelText="取消">
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>驳回后代理商后台状态显示"已驳回"，可查看原因并重新编辑申请信息再次提交。</div>
        <Input.TextArea rows={4} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="请填写驳回原因（必填）" maxLength={200} showCount />
      </Modal>

      {/* 授权编号格式设置：前缀/中段/日期段/分隔符/流水位数，实时预览 */}
      <Modal open={authFmtVisible} title="授权编号格式设置" okText="保存" onOk={saveAuthFmt}
        onCancel={() => setAuthFmtVisible(false)} cancelText="取消" width={560}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>前缀（如 SQ，留空则无）</div>
            <Input value={fmtDraft.prefix} onChange={e => setFmtDraft(s => ({ ...s, prefix: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>中段（公司/品牌缩写，留空则无）</div>
            <Input value={fmtDraft.mid} onChange={e => setFmtDraft(s => ({ ...s, mid: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>日期段格式</div>
            <Select style={{ width: '100%' }} value={fmtDraft.dateFmt} onChange={v => setFmtDraft(s => ({ ...s, dateFmt: v }))}
              options={[{ value: 'YYYYMMDD', label: '年月日（20261012）' }, { value: 'YYYYMM', label: '年月（202610）' }, { value: 'YYYY', label: '年（2026）' }, { value: '', label: '无日期段' }]} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>分隔符</div>
            <Select style={{ width: '100%' }} value={fmtDraft.sep} onChange={v => setFmtDraft(s => ({ ...s, sep: v }))}
              options={[{ value: '-', label: '横杠 -' }, { value: '_', label: '下划线 _' }, { value: '', label: '无分隔符' }]} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>流水号位数</div>
            <InputNumber min={2} max={6} style={{ width: '100%' }} value={fmtDraft.digits} onChange={v => setFmtDraft(s => ({ ...s, digits: Number(v) || 3 }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>格式预览（下一个编号示例）</div>
            <Input readOnly value={buildAuthNo(fmtDraft, owner, [])} style={{ color: '#722ed1', fontWeight: 600 }} />
          </div>
        </div>
        <div style={{ marginTop: 10, color: '#888', fontSize: 12 }}>说明：仅影响后续确认到账时新生成的授权编号，存量编号不变；流水号按同前缀已有编号自动递增。</div>
      </Modal>

      {/* 收款账户 */}
      <Modal title="品牌方收款账户" open={recvVisible} onCancel={() => setRecvVisible(false)} width={520}
        onOk={() => recvForm.validateFields().then(v => { saveRecv({ ...v }); setRecvVisible(false); })} okText="保存" cancelText="取消">
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>默认读取个人中心维护的银行账户，可在此修改；修改后同步展示给外部申请页的代理商。</div>
        <Form autoComplete="off" form={recvForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="accountName" label="户名"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="bankName" label="开户银行"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="branchName" label="开户支行"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="bankAccountNo" label="银行账号"><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="note" label="收款说明"><Input.TextArea rows={2} placeholder="如：请备注公司名称" /></Form.Item></Col>
          </Row>
        </Form>
        <Button size="small" onClick={() => { const d = readRecvDefault(owner); recvForm.setFieldsValue(d); message.info('已从个人中心同步'); }}>从个人中心同步</Button>
      </Modal>

      {/* 自有品牌台账 */}
      <Modal title="自有品牌台账" open={ownVisible} onCancel={() => setOwnVisible(false)} footer={null} width={900}>
        <OwnBrandEditor brands={ownBrands} onChange={(l) => { setOwnBrands(l); writeJson(K.own, l); publishPub(recv, l); publishBrandMats(owner, l); window.dispatchEvent(new Event('sync-data-updated')); }} />
      </Modal>

      {/* 模版编辑器（cert=授权书模版 / agr=协议书模版，界面功能共用） */}
      <Modal title={tplMode === 'agr' ? '协议书模版编辑（保存后发布到外部申请页下载）' : '授权书模版编辑'} open={tplVisible} onCancel={() => setTplVisible(false)} width={980}
        onOk={() => {
          (async () => {
            let draft = tplDraft;
            // 背景图超大时先再压缩再保存，防模版与证书副本膨胀撑爆存储配额致写入丢失
            if ((draft.bgImage || '').length > OVERSIZE_DATAURL_CHARS) {
              draft = { ...draft, bgImage: await recompressDataUrl(draft.bgImage) };
              setTplDraft(draft);
            }
            saveTpl({ ...draft, updatedAt: todayIso() });
            setTplVisible(false);
            message.success(tplMode === 'agr' ? '协议书模版已保存，并已发布到外部申请页' : '模版已保存');
          })();
        }} okText="保存模版" cancelText="取消">
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888' }}>当前模版</span>
          <Select size="small" style={{ width: 200 }} value={tplKeyNow || undefined} onChange={switchTpl}
            options={tplListNow.map(t => ({ value: t.key || '', label: t.key === presetKeyNow ? `${t.name || '系统预设模版'}（预设）` : (t.name || '未命名模版') }))} />
          <Button size="small" onClick={saveAsTpl}>另存为新模版</Button>
          <Button size="small" onClick={newTpl}>新建空白模版</Button>
          <Button size="small" danger disabled={tplKeyNow === presetKeyNow} onClick={deleteTpl}>删除当前模版</Button>
          <span style={{ fontSize: 12, color: '#aaa' }}>{tplMode === 'agr' ? '协议书模版：保存后外部申请页可查看/下载；下拉选择即载入' : '下拉选择即载入该模版；"保存模版"写回当前所选模版'}</span>
        </div>
        <Row gutter={12}>
          <Col span={13}>
            <div style={{ marginBottom: 6, color: '#666', fontSize: 12 }}>模版正文（Word 式编辑：选中文字后用工具栏加粗/居中/改字号等；点字段按钮在光标处插入占位符）：</div>
            <div style={{ border: '1px solid #d9d9d9', borderBottom: 'none', borderRadius: '6px 6px 0 0', padding: '6px 8px', background: '#fafafa', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <Button size="small" style={{ fontWeight: 700 }} title="加粗（选中后生效）" onClick={() => execCmd('bold')}>B</Button>
              <Button size="small" style={{ fontStyle: 'italic' }} title="斜体（选中后生效）" onClick={() => execCmd('italic')}>I</Button>
              <Button size="small" style={{ textDecoration: 'underline' }} title="下划线（选中后生效）" onClick={() => execCmd('underline')}>U</Button>
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <Select size="small" style={{ width: 92 }} placeholder="字体" value={undefined}
                onChange={v => execCmd('fontName', v)}
                options={FONT_OPTIONS.map(f => ({ value: f.value.split(',')[0].replace(/"/g, ''), label: f.label }))} />
              <Select size="small" style={{ width: 78 }} placeholder="字号" value={undefined}
                onChange={v => execCmd('fontSize', v)}
                options={[{ value: '2', label: '小' }, { value: '3', label: '正常' }, { value: '4', label: '大' }, { value: '5', label: '特大' }, { value: '6', label: '超大' }, { value: '7', label: '最大' }]} />
              <input type="color" title="文字颜色（选中后生效）" onChange={e => execCmd('foreColor', e.target.value)}
                style={{ width: 28, height: 24, border: '1px solid #d9d9d9', borderRadius: 4, padding: 1, background: '#fff' }} />
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <Button size="small" title="左对齐（选中段落）" onMouseDown={e => e.preventDefault()} onClick={() => applySelAlign('left')}>左</Button>
              <Button size="small" title="居中（选中段落）" onMouseDown={e => e.preventDefault()} onClick={() => applySelAlign('center')}>中</Button>
              <Button size="small" title="右对齐（选中段落）" onMouseDown={e => e.preventDefault()} onClick={() => applySelAlign('right')}>右</Button>
              <Button size="small" title="两端对齐（选中段落）" onMouseDown={e => e.preventDefault()} onClick={() => applySelAlign('justify')}>两端</Button>
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <span style={{ fontSize: 12, color: '#888' }}>行高</span>
              <InputNumber size="small" style={{ width: 62 }} min={1} max={4} step={0.25} title="选中段落的行高" onFocus={() => { const s = document.getSelection(); if (s && s.rangeCount > 0 && editorRef.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange(); }} onChange={v => applySelLineHeight(Number(v) || 2)} />
              <span style={{ fontSize: 12, color: '#888' }}>字间距</span>
              <InputNumber size="small" style={{ width: 62 }} min={0} max={10} step={0.5} title="选中文字的字间距" onFocus={() => { const s = document.getSelection(); if (s && s.rangeCount > 0 && editorRef.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange(); }} onChange={v => applySelLetterSpacing(Number(v) || 0)} />
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <Button size="small" title="增加缩进" onClick={() => execCmd('indent')}>增缩进</Button>
              <Button size="small" title="减少缩进" onClick={() => execCmd('outdent')}>减缩进</Button>
              <Button size="small" title="清除所选文字格式" onClick={() => execCmd('removeFormat')}>清格式</Button>
              <Divider type="vertical" style={{ margin: '0 2px' }} />
              <Button size="small" icon={<PictureOutlined />} title="在光标处插入图片（选择文件）" onClick={() => fileImgRef.current?.click()}>插图</Button>
              <Button size="small" title="在光标处插入剪切板图片" onClick={pasteImageToEditor}>粘贴图片</Button>
              <input ref={fileImgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onTplImgFile} />
              {selImg && (
                <>
                  <Divider type="vertical" style={{ margin: '0 2px' }} />
                  <span style={{ fontSize: 12, color: '#888' }}>图宽</span>
                  <InputNumber size="small" style={{ width: 60 }} min={5} max={100} step={5} value={selImgW} onChange={v => applyImgWidth(Number(v) || 100)} />
                  {[25, 50, 75, 100].map(p => <Button key={p} size="small" onClick={() => applyImgWidth(p)}>{p}%</Button>)}
                  <Button size="small" onClick={resetImgSize}>原尺寸</Button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', border: '1px solid #d9d9d9', borderTop: 'none', background: '#fafafa', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#888' }}>上边距</span>
              <InputNumber size="small" style={{ width: 64 }} min={0} max={300} step={10}
                value={curStyle.padTop}
                onChange={v => setTplDraft(d => ({ ...d, style: { ...DEFAULT_CERT_STYLE, ...(d.style || {}), padTop: Number(v) || 0 } as CertStyle }))} />
              <span style={{ fontSize: 12, color: '#888' }}>下边距</span>
              <InputNumber size="small" style={{ width: 64 }} min={0} max={300} step={10}
                value={curStyle.padBottom ?? curStyle.padTop}
                onChange={v => setTplDraft(d => ({ ...d, style: { ...DEFAULT_CERT_STYLE, ...(d.style || {}), padBottom: Number(v) || 0 } as CertStyle }))} />
              <span style={{ fontSize: 12, color: '#888' }}>左边距</span>
              <InputNumber size="small" style={{ width: 64 }} min={0} max={300} step={10}
                value={curStyle.padLeft ?? curStyle.padSide}
                onChange={v => setTplDraft(d => ({ ...d, style: { ...DEFAULT_CERT_STYLE, ...(d.style || {}), padLeft: Number(v) || 0 } as CertStyle }))} />
              <span style={{ fontSize: 12, color: '#888' }}>右边距</span>
              <InputNumber size="small" style={{ width: 64 }} min={0} max={300} step={10}
                value={curStyle.padRight ?? curStyle.padSide}
                onChange={v => setTplDraft(d => ({ ...d, style: { ...DEFAULT_CERT_STYLE, ...(d.style || {}), padRight: Number(v) || 0 } as CertStyle }))} />
              <span style={{ fontSize: 12, color: '#aaa' }}>正文与纸张四边留白（px），预览与生成同步生效，可避开背景图边框</span>
            </div>
            <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={syncHtml} onClick={onEditorClick}
              dangerouslySetInnerHTML={{ __html: editorInitHtml }}
              style={{
                border: '1px solid #d9d9d9', borderRadius: '0 0 6px 6px', minHeight: 280, maxHeight: 320, overflow: 'auto',
                padding: '10px 12px', background: '#fff', outline: 'none',
                fontFamily: curStyle.fontFamily, fontSize: curStyle.fontSize, lineHeight: curStyle.lineHeight,
                color: curStyle.color, letterSpacing: curStyle.letterSpacing,
              }} />
            <Divider orientation="left" style={{ margin: '8px 0' }}>插入代理商提交字段</Divider>
            <Space wrap size={4}>{AGENT_FIELDS.map(f => <Button key={f.token} size="small" onClick={() => insertToken(f.token)}>{'{'}{f.label}{'}'}</Button>)}</Space>
            <Divider orientation="left" style={{ margin: '8px 0' }}>插入系统字段</Divider>
            <Space wrap size={4}>{SYSTEM_FIELDS.map(f => <Button key={f.token} size="small" onClick={() => insertToken(f.token)}>{'{'}{f.label}{'}'}</Button>)}</Space>
            <Divider orientation="left" style={{ margin: '8px 0' }}>自定义字段</Divider>
            <Space wrap size={4}>
              {tplDraft.customFields.map(cf => <Button key={cf.key} size="small" color="purple" variant="outlined" onClick={() => insertToken(cf.label)}>{'{'}{cf.label}{'}'}</Button>)}
            </Space>
            <Space style={{ marginTop: 8 }}>
              <Input placeholder="新自定义字段名" style={{ width: 160 }} value={newCustom} onChange={e => setNewCustom(e.target.value)} />
              <Button size="small" icon={<PlusOutlined />} onClick={addCustomField}>新增字段</Button>
              {tplDraft.customFields.length > 0 && (
                <Button size="small" danger onClick={() => setTplDraft(d => ({ ...d, customFields: d.customFields.slice(0, -1) }))}>删除最后一个</Button>
              )}
            </Space>
            <Divider orientation="left" style={{ margin: '8px 0' }}>背景图</Divider>
            <ImageSlot value={tplDraft.bgImage} onChange={v => setTplDraft(d => ({ ...d, bgImage: v }))} size={90} tip="背景图" />
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>上传后作为授权书底图（如带公司抬头的信纸）</Text>
            <Divider orientation="left" style={{ margin: '8px 0' }}>水印设置</Divider>
            <Row gutter={[8, 8]} align="middle">
              <Col span={4}><div style={{ fontSize: 12, color: '#888' }}>启用</div><Switch checked={wm.enabled} onChange={v => setWm({ enabled: v })} /></Col>
              <Col span={5}><div style={{ fontSize: 12, color: '#888' }}>字号</div><InputNumber size="small" style={{ width: '100%' }} min={10} max={72} value={wm.fontSize} onChange={v => setWm({ fontSize: Number(v) || 26 })} /></Col>
              <Col span={5}><div style={{ fontSize: 12, color: '#888' }}>透明度</div><InputNumber size="small" style={{ width: '100%' }} min={0.02} max={1} step={0.02} value={wm.opacity} onChange={v => setWm({ opacity: Number(v) || 0.14 })} /></Col>
              <Col span={5}><div style={{ fontSize: 12, color: '#888' }}>旋转</div><InputNumber size="small" style={{ width: '100%' }} min={-90} max={90} value={wm.rotate} onChange={v => setWm({ rotate: Number(v) || 0 })} /></Col>
              <Col span={5}><div style={{ fontSize: 12, color: '#888' }}>颜色</div><input type="color" value={wm.color} onChange={e => setWm({ color: e.target.value })} style={{ width: '100%', height: 24, border: '1px solid #d9d9d9', borderRadius: 4, padding: 1, background: '#fff' }} /></Col>
              <Col span={24}>
                <div style={{ fontSize: 12, color: '#888' }}>水印文字（可插入字段占位符，生成授权书时渲染为实际值）</div>
                <Input ref={wmInputRef} value={wm.text} onChange={e => setWm({ text: e.target.value })} placeholder="如 {公司名称} · {授权编号}" />
              </Col>
              <Col span={24}>
                <Space wrap size={4}>
                  {[...AGENT_FIELDS, ...SYSTEM_FIELDS].map(f => <Button key={f.token} size="small" onClick={() => insertWmToken(f.token)}>{'{'}{f.label}{'}'}</Button>)}
                </Space>
              </Col>
            </Row>
          </Col>
          <Col span={11}>
            <div style={{ marginBottom: 6, color: '#666', fontSize: 12 }}>实时预览（A4 纸等比多页视窗 · 示例数据）：</div>
            <div ref={previewWrapRef} style={{ width: '100%', height: 620, overflow: 'auto', background: '#e8ebf0', borderRadius: 6, padding: 10 }}>
              {previewPages.map((pg, i) => (
                <div key={i} style={{ width: A4_W * pScale, height: A4_H * pScale, margin: '0 auto', marginBottom: 12, position: 'relative' }}>
                  <div style={{ width: A4_W, height: A4_H, overflow: 'hidden', transform: `scale(${pScale})`, transformOrigin: 'top left', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,.18)' }}>
                    <div dangerouslySetInnerHTML={{ __html: buildCertPageHtml(pg, tplDraft.bgImage, tplDraft.style, buildWatermarkHtml(substituteTokens(wm.text, sampleValues), wm)) }} />
                  </div>
                </div>
              ))}
            </div>
            {/* 隐藏测量容器：与可见页同源渲染，供分页高度计算 */}
            <div ref={measureRef} style={{ position: 'absolute', left: -99999, top: 0, width: A4_W, visibility: 'hidden', pointerEvents: 'none' }}
              dangerouslySetInnerHTML={{ __html: buildCertPageHtml(substituteTokens(tplDraft.html || '', sampleValues), '', tplDraft.style, '') }} />
          </Col>
        </Row>
      </Modal>

      {/* 生成授权书配置 */}
      <Modal title={`生成授权书 - ${certTarget?.companyName || ''}`} open={certCfgVisible} onCancel={() => setCertCfgVisible(false)} width={640}
        footer={[
          ...(pendingRenew(certTarget) ? [
            <Button key="renew" type="primary" danger icon={<RedoOutlined />} onClick={() => { const t = certTarget; if (t) { setCertCfgVisible(false); openUpCertRenew(t); } }}>续签授权书</Button>,
          ] : []),
          <Button key="gen" type="primary" icon={<SafetyCertificateOutlined />} onClick={handleGenCert}>生成授权书</Button>,
          <Button key="cancel" onClick={() => setCertCfgVisible(false)}>取消</Button>,
        ]}>
        <Form autoComplete="off" form={certForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="生成模版">
                <Select value={genTplKey || undefined} onChange={v => setGenTplKey(v)}
                  options={tplList.map(t => ({ value: t.key || '', label: t.key === 'tpl-preset' ? `${t.name || '系统预设模版'}（预设）` : (t.name || '未命名模版') }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="brandName" label="品牌名称" rules={[{ required: true, message: '必填' }]}>
                <AutoComplete placeholder="选择自有品牌或输入新品牌" options={ownBrands.map(b => ({ value: b.brandName, label: b.brandName }))}
                  filterOption={(i, o: any) => String(o?.value || '').toLowerCase().includes(i.toLowerCase())} />
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="trademarkNo" label="注册商标号" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 37048309" /></Form.Item></Col>
            <Col span={12}><Form.Item name="category" label="类目" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 25 类鞋子" /></Form.Item></Col>
            <Col span={12}><Form.Item name="shopName" label="店铺名称" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="validFrom" label="有效期起"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="validTo" label="有效期止"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={24}>
              <Space size={4} style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#888' }}>有效期快捷（按有效期起计算）：</span>
                <Button size="small" onClick={() => setQuickValid('3m')}>3个月</Button>
                <Button size="small" onClick={() => setQuickValid('6m')}>半年</Button>
                <Button size="small" onClick={() => setQuickValid('1y')}>1年</Button>
                <Button size="small" onClick={() => setQuickValid('ye')}>本年底</Button>
              </Space>
            </Col>
            {genTpl.customFields.map(cf => (
              <Col span={12} key={cf.key}><Form.Item name={`cf_${cf.key}`} label={`自定义-${cf.label}`}><Input /></Form.Item></Col>
            ))}
          </Row>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>授权编号 {certTarget?.authNo || '（未确认到账，暂无编号）'} 将自动填入模版 {'{授权编号}'} 处。</Text>
      </Modal>

      {/* 授权书预览/打印 */}
      <Modal title={`授权书 - ${certView?.companyName || ''}`} open={!!certView} onCancel={() => setCertView(null)} width={820}
        footer={[
          <Button key="regen" icon={<SafetyCertificateOutlined />} onClick={() => { const t = certView; setCertView(null); if (t) openCertCfg(t); }}>重新生成</Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => certView && printHtml(certView.certHtml)}>打印</Button>,
          <Button key="close" onClick={() => setCertView(null)}>关闭</Button>,
        ]}>
        <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'auto', maxHeight: '65vh', background: '#fff' }}
          dangerouslySetInnerHTML={{ __html: certView?.certHtml || '' }} />
      </Modal>

      {/* 上传授权书图片 → 递送代理商（renewMode=续签授权书） */}
      <Modal title={`${renewMode ? '续签授权书' : '上传授权书'} - ${upCertTarget?.companyName || ''}`} open={upCertVisible} onCancel={() => { setUpCertVisible(false); setRenewMode(false); }} width={520}
        onOk={handleUpCert} okText={renewMode ? '上传续签授权书并递送' : '上传并递送'} cancelText="取消">
        {renewMode ? (
          <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>上传续签盖章授权书图片（支持 Ctrl+V 粘贴）。上传后状态置为"续签成功"，有效期止更新为下方新日期，并递送代理商后台/公开查询链接。</div>
        ) : (
          <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>上传盖章授权书图片（支持 Ctrl+V 粘贴）。上传后状态置为"授权书已发"，并递送：① 若绑定代理商采购商账号，进入其后台"我的授权书"；② 生成公开查询链接。</div>
        )}
        <ImageSlot value={upCertImage} onChange={setUpCertImage} size={120} tip={renewMode ? '续签授权书' : '授权书'} />
        {renewMode && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 4, color: '#666', fontSize: 12 }}>新有效期止（代理商侧到期时间同步更新）：</div>
            <DatePicker style={{ width: '100%' }} value={renewValidTo} onChange={v => setRenewValidTo(v)} />
          </div>
        )}
        <Divider style={{ margin: '12px 0' }} />
        <div style={{ marginBottom: 4, color: '#666', fontSize: 12 }}>绑定代理商采购商账号（选填，填写其登录 username）：</div>
        <Input value={upCertAgent} onChange={e => setUpCertAgent(e.target.value)} placeholder="代理商采购商账号 username" allowClear />
        {upCertTarget?.shareCode && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>公开查询链接（无需登录）：</Text>
            <Input.Group compact style={{ marginTop: 4 }}>
              <Input readOnly value={certLink(upCertTarget)} style={{ width: 'calc(100% - 70px)' }} />
              <Button icon={<CopyOutlined />} onClick={() => { navigator.clipboard?.writeText(certLink(upCertTarget!)); message.success('已复制'); }}>复制</Button>
            </Input.Group>
          </div>
        )}
      </Modal>

      {/* 编辑申请（代理商填错信息代改） */}
      <Modal title={`编辑申请 - ${editAppTarget?.companyName || ''}`} open={editAppVisible} onCancel={() => setEditAppVisible(false)} width={760}
        onOk={handleEditApp} okText="保存" cancelText="取消">
        <Form autoComplete="off" form={editAppForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="companyName" label="开店公司" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="taxpayerCode" label="纳税人识别码" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="legalPerson" label="法人代表" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="联系电话" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="province" label="省份"><Select placeholder="省份" allowClear showSearch options={getProvinceOptions()} onChange={() => editAppForm.setFieldsValue({ city: undefined, district: undefined })} /></Form.Item></Col>
            <Col span={8}><Form.Item name="city" label="城市"><Select placeholder="城市" allowClear showSearch options={getCityOptions(editAppForm.getFieldValue('province'))} onChange={() => editAppForm.setFieldsValue({ district: undefined })} /></Form.Item></Col>
            <Col span={8}><Form.Item name="district" label="县区"><Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(editAppForm.getFieldValue('province'), editAppForm.getFieldValue('city'))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="address" label="经营地址（详细）" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="shopName" label="店铺名称"><Input placeholder="生成授权书时自动带入" /></Form.Item></Col>
            <Col span={8}>
              <Form.Item name="personInCharge" label="负责人">
                <Select placeholder="负责人" allowClear
                  options={subUsers.map((u: any) => ({ value: nameOfU(u), label: `${nameOfU(u)}${u.isSubAccount ? '' : '（管理员）'}` }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="shopType" label="店铺类型">
                <Select placeholder="选择店铺类型" allowClear
                  options={SHOP_TYPES.map(t => ({ value: t, label: <span style={shopTypeStyle(t)}>{t}</span> }))} />
              </Form.Item>
            </Col>
            <Col span={8}><Form.Item name="shopId" label="店铺ID"><Input placeholder="店铺账号名/ID" /></Form.Item></Col>
            <Col span={12}><Form.Item name="platform" label="授权平台" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="platformUrl" label="授权平台网址"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="deposit" label="保证金（元）" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="brandName" label="申请品牌"><Select allowClear placeholder="选择品牌" options={ownBrands.map(b => ({ value: b.brandName, label: b.trademarkNo ? `${b.brandName}（商标号 ${b.trademarkNo}）` : b.brandName }))} /></Form.Item></Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}><Form.Item name="payShot" label="付款截图" rules={[{ required: true, message: '请上传' }]}><ImageSlot size={72} tip="付款截图" /></Form.Item></Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}><Form.Item name="businessLicense" label="营业执照" rules={[{ required: true, message: '请上传' }]}><ImageSlot size={72} tip="营业执照" /></Form.Item></Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}><Form.Item name="idFront" label="身份证正面" rules={[{ required: true, message: '请上传' }]}><ImageSlot size={72} tip="身份证正面" /></Form.Item></Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}><Form.Item name="idBack" label="身份证反面" rules={[{ required: true, message: '请上传' }]}><ImageSlot size={72} tip="身份证反面" /></Form.Item></Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}><Form.Item name="agreementImage" label="协议书"><ImageSlot size={72} tip="协议书" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* 申请详情（点击申请编号） */}
      <Modal title={`申请详情 - ${detailApp?.appNo || ''}`} open={!!detailApp} onCancel={() => setDetailApp(null)} width={880}
        footer={[<Button key="close" onClick={() => setDetailApp(null)}>关闭</Button>]}>
        {detailCur && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="申请编号">{detailCur.appNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="申请时间">{detailCur.appliedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="客户名称">{detailCur.agentUsername ? readCompany(detailCur.agentUsername) : '—'}</Descriptions.Item>
            <Descriptions.Item label="开店公司" span={2}>{detailCur.companyName || '—'}</Descriptions.Item>
            <Descriptions.Item label="负责人">{detailCur.personInCharge || '—'}</Descriptions.Item>
            <Descriptions.Item label="纳税人识别码">{detailCur.taxpayerCode || '—'}</Descriptions.Item>
            <Descriptions.Item label="法人代表">{detailCur.legalPerson || '—'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{detailCur.phone || '—'}</Descriptions.Item>
            <Descriptions.Item label="经营地址" span={2}>{detailCur.address || '—'}</Descriptions.Item>
            <Descriptions.Item label="授权平台">{detailCur.platform || '—'}</Descriptions.Item>
            <Descriptions.Item label="授权平台网址">{detailCur.platformUrl || '—'}</Descriptions.Item>
            <Descriptions.Item label="保证金">
              {detailCur.deposit ? `¥${detailCur.deposit}` : '—'}
              <span style={{ marginLeft: 8 }}>
                {detailCur.depositState === '已退回' ? <Tag style={{ margin: 0 }}>已退回</Tag>
                  : refundReqs.find(q => q.appKey === detailCur.key)?.status === '已申请'
                    ? <Button type="link" size="small" danger style={{ padding: 0, height: 'auto', fontWeight: 600 }} onClick={() => openDeposit(detailCur)}>已申请</Button>
                    : (detailCur.depositState === '已确认' || detailCur.status !== '待确认')
                      ? <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#52c41a' }} onClick={() => openDeposit(detailCur)}>已确认</Button>
                      : <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#fa8c16', fontWeight: 600 }} onClick={() => openDeposit(detailCur)}>待确认</Button>}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="状态">{detailCur.status}</Descriptions.Item>
            <Descriptions.Item label="申请品牌">{detailCur.brandName || '—'}</Descriptions.Item>
            <Descriptions.Item label="注册商标号">{detailCur.trademarkNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="类目">{detailCur.category || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺名称">{detailCur.shopName || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺ID">{detailCur.shopId || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺类型">{detailCur.shopType ? <span style={shopTypeStyle(detailCur.shopType)}>{detailCur.shopType}</span> : '—'}</Descriptions.Item>
            <Descriptions.Item label="授权编号">{detailCur.authNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="确认到账时间">{detailCur.confirmedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="有效期">{detailCur.validFrom ? `${detailCur.validFrom} 至 ${detailCur.validTo}` : '—'}</Descriptions.Item>
            <Descriptions.Item label="绑定代理商账号">{detailCur.agentUsername || '—'}</Descriptions.Item>
            <Descriptions.Item label="收款账户快照" span={2}>{recvSnapshotText(detailCur) || '—'}</Descriptions.Item>
            <Descriptions.Item label="付款截图">{detailCur.payShot ? <AntdImage src={detailCur.payShot} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}</Descriptions.Item>
            <Descriptions.Item label="营业执照">{detailCur.businessLicense ? <AntdImage src={detailCur.businessLicense} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}</Descriptions.Item>
            <Descriptions.Item label="身份证正面">{detailCur.idFront ? <AntdImage src={detailCur.idFront} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}</Descriptions.Item>
            <Descriptions.Item label="身份证反面">{detailCur.idBack ? <AntdImage src={detailCur.idBack} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}</Descriptions.Item>
            <Descriptions.Item label="协议书">{detailCur.agreementImage ? <AntdImage src={detailCur.agreementImage} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}</Descriptions.Item>
            <Descriptions.Item label="授权书图">
              {detailCur.certImage
                ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setCertImgView(detailCur)}><AntdImage src={detailCur.certImage} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} /></Button>
                : <Button type="link" size="small" icon={<PictureOutlined />} onClick={() => openUpCert(detailCur)}>上传授权书</Button>}
            </Descriptions.Item>
            <Descriptions.Item label="授权书">
              {detailCur.certHtml
                ? <Space size={0}>
                    <Button type="link" size="small" icon={<FileProtectOutlined />} onClick={() => setCertView(detailCur)}>查看</Button>
                    <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => printHtml(detailCur.certHtml!)}>打印</Button>
                  </Space>
                : <Button type="link" size="small" icon={<SafetyCertificateOutlined />} onClick={() => openCertCfg(detailCur)}>生成授权书</Button>}
            </Descriptions.Item>
            <Descriptions.Item label="公开查询链接" span={2}>{detailCur.shareCode ? certLink(detailCur) : '—'}</Descriptions.Item>
            {detailCur.remark ? <Descriptions.Item label="备注" span={2}>{detailCur.remark}</Descriptions.Item> : null}
          </Descriptions>
        )}
      </Modal>

      {/* 保证金：查看详情 + 退回申请审核 */}
      <Modal title={`保证金 - ${depositTarget?.companyName || ''}`} open={!!depositTarget} onCancel={() => setDepositTarget(null)} width={640}
        footer={(() => {
          if (!depositTarget) return [<Button key="close" onClick={() => setDepositTarget(null)}>关闭</Button>];
          const req = refundReqs.find(q => q.appKey === depositTarget.key && q.status === '已申请');
          if (req) {
            return [
              <Button key="approve" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleApproveRefund(req)}>确认无误</Button>,
              <Button key="reject" danger icon={<CloseCircleOutlined />} onClick={() => { setRefundRejectTarget(req); setRefundRejectReason(''); }}>驳回</Button>,
              <Button key="close" onClick={() => setDepositTarget(null)}>关闭</Button>,
            ];
          }
          // 已确认到账且无代理方退回申请且无已有付款申请：显示"申请退保"按钮
          if (depositTarget.depositState === '已确认' && !depositTarget.depositPaymentKey) {
            return [
              <Button key="refund" type="primary" danger onClick={() => { setBrandRefundTarget(depositTarget); setBrandRefundBank(depositTarget.refundAgentRecv || ''); setBrandRefundReason(''); }}>申请退保</Button>,
              <Button key="close" onClick={() => setDepositTarget(null)}>关闭</Button>,
            ];
          }
          return [<Button key="close" onClick={() => setDepositTarget(null)}>关闭</Button>];
        })()}>
        {depositTarget && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="申请编号">{depositTarget.appNo || '—'}</Descriptions.Item>
              <Descriptions.Item label="保证金金额">{depositTarget.deposit ? `¥${depositTarget.deposit}` : '—'}</Descriptions.Item>
              <Descriptions.Item label="当前状态" span={2}>
                {depositTarget.depositState === '已退回' ? `成功退回${depositTarget.refundAt ? `（${depositTarget.refundAt}）` : ''}`
                  : depositTarget.depositState === '已确认' && depositTarget.depositPaymentKey ? <span style={{ color: '#722ed1' }}>退款中（付款申请已创建，等待支付成功后自动标记为成功退回）</span>
                  : depositTarget.depositState === '已确认' ? `已确认到账（${depositTarget.confirmedAt || ''}）· 授权编号 ${depositTarget.authNo || '—'}`
                  : depositTarget.status === '待确认' ? <span>待确认 <span style={{ color: '#fa8c16', fontSize: 12 }}>（请前往 财务管理 → 收/付申请 → 收款确认 Tab 中确认到账）</span></span> : depositTarget.status}
              </Descriptions.Item>
              <Descriptions.Item label="付款截图" span={2}>{depositTarget.payShot ? <AntdImage src={depositTarget.payShot} width={90} height={90} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}</Descriptions.Item>
              {(() => {
                const req = refundReqs.find(q => q.appKey === depositTarget.key);
                if (!req) return null;
                return (<>
                  <Descriptions.Item label="退回申请时间">{req.requestedAt || '—'}</Descriptions.Item>
                  <Descriptions.Item label="申请状态">
                    {req.status === '已驳回' ? <Tag color="red">已驳回{req.rejectReason ? `（${req.rejectReason}）` : ''}</Tag> : req.status}
                  </Descriptions.Item>
                  {req.agentBank ? <Descriptions.Item label="代理商收款账户" span={2}>{req.agentBank}</Descriptions.Item> : null}
                  {req.reason ? <Descriptions.Item label="申请原因/备注" span={2}>{req.reason}</Descriptions.Item> : null}
                  {req.images && req.images.length > 0 ? (
                    <Descriptions.Item label="申请附件" span={2}>
                      <Space wrap size={6}>{req.images.map((im, i) => <AntdImage key={i} src={im} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Space>
                    </Descriptions.Item>
                  ) : null}
                </>);
              })()}
              {(depositTarget.recvBankKey || depositTarget.recvBankSnapshot || depositTarget.recvSnapshot) && <Descriptions.Item label="收款账户" span={2}>{recvSnapshotText(depositTarget) || '—'}</Descriptions.Item>}
              {depositTarget.refundShot && <Descriptions.Item label="退回付款截图" span={2}><AntdImage src={depositTarget.refundShot} width={90} height={90} style={{ objectFit: 'cover', borderRadius: 4 }} /></Descriptions.Item>}
            </Descriptions>
          </>
        )}
      </Modal>

      {/* 销售数据详情（已提交点击看） */}
      <Modal title={`销售数据详情 - ${salesDetail?.month || ''}`} open={!!salesDetail} onCancel={() => setSalesDetail(null)} width={620}
        footer={[<Button key="close" onClick={() => setSalesDetail(null)}>关闭</Button>]}>
        {salesDetail && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="年月">{salesDetail.month}</Descriptions.Item>
            <Descriptions.Item label="提交时间">{salesDetail.submittedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="销售数量">{salesDetail.qty}</Descriptions.Item>
            <Descriptions.Item label="销售额">¥{salesDetail.amount}</Descriptions.Item>
            <Descriptions.Item label="店铺评分">{salesDetail.score || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺">{salesDetail.shopName || salesDetail.companyName || '—'}</Descriptions.Item>
            <Descriptions.Item label="代理商">{salesDetail.agentUsername || '—'}</Descriptions.Item>
            <Descriptions.Item label="品牌">{salesDetail.brandName || '—'}</Descriptions.Item>
            <Descriptions.Item label="凭证图片" span={2}>
              {salesDetail.images && salesDetail.images.length
                ? <Space wrap size={6}>{salesDetail.images.map((im, i) => <AntdImage key={i} src={im} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Space>
                : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 退回保证金详情（品牌方侧查看：双方账户/原因/附件/回传截图/确认状态） */}
      <Modal title={`退回保证金详情 - ${refundDetailReq?.companyName || ''}`} open={!!refundDetailReq} onCancel={() => setRefundDetailReq(null)} width={620}
        footer={[<Button key="close" onClick={() => setRefundDetailReq(null)}>关闭</Button>]}>
        {refundDetailReq && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="退回金额">¥{refundDetailReq.amount || '—'}</Descriptions.Item>
            <Descriptions.Item label="申请时间">{refundDetailReq.requestedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="品牌方退回时间">{refundDetailReq.refundAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="状态">{refundDetailReq.status === '已确认' ? `代理商已确认到账${refundDetailReq.confirmedAt ? `（${refundDetailReq.confirmedAt}）` : ''}` : '已退回（待代理商确认）'}</Descriptions.Item>
            <Descriptions.Item label="代理商收款账户" span={2}>{refundDetailReq.agentBank || '—'}</Descriptions.Item>
            <Descriptions.Item label="我方付款账户" span={2}>{refundDetailReq.payBankName || '—'}</Descriptions.Item>
            {refundDetailReq.reason ? <Descriptions.Item label="申请原因" span={2}>{refundDetailReq.reason}</Descriptions.Item> : null}
            {refundDetailReq.images && refundDetailReq.images.length > 0 ? (
              <Descriptions.Item label="申请附件" span={2}>
                <Space wrap size={6}>{refundDetailReq.images.map((im, i) => <AntdImage key={i} src={im} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Space>
              </Descriptions.Item>
            ) : null}
            <Descriptions.Item label="退回付款截图" span={2}>
              {refundDetailReq.refundShot ? <AntdImage src={refundDetailReq.refundShot} width={90} height={90} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 品牌方主动退保申请弹窗 */}
      <Modal title={`申请退保 - ${brandRefundTarget?.companyName || ''}`} open={!!brandRefundTarget}
        onCancel={() => { setBrandRefundTarget(null); setBrandRefundBank(''); setBrandRefundReason(''); }} width={520}
        onOk={handleBrandInitRefund} okText="确认申请" cancelText="取消">
        {brandRefundTarget && (
          <div>
            <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f0f5ff', borderRadius: 6, border: '1px solid #adc6ff' }}>
              <div style={{ fontSize: 12, color: '#1d39c4', marginBottom: 4 }}>保证金金额</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#f5222d' }}>¥{brandRefundTarget.deposit || '0'}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>代理商收款账户 <span style={{ color: '#f5222d' }}>*</span></div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>填写代理商银行账户信息（户名 / 银行 / 支行 / 账号），默认为代理商申请时填写的账户，可手动修改</div>
              <Input.TextArea rows={2} placeholder="例：瑞安市素全贸易有限公司 / 中国工商银行 / 仙峰支行 / 621222201203007025033"
                value={brandRefundBank} onChange={e => setBrandRefundBank(e.target.value)} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>申请原因</div>
              <Input.TextArea rows={3} placeholder="请填写退保原因（选填）" value={brandRefundReason} onChange={e => setBrandRefundReason(e.target.value)} />
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, fontSize: 12, color: '#d48806' }}>
              点击「确认申请」将自动在财务管理「收/付申请」待审核页面中新增付款申请，支付成功后保证金将标记为"成功退回"。
            </div>
          </div>
        )}
      </Modal>

      {/* 退回申请驳回原因弹窗 */}
      <Modal title="驳回退回申请" open={!!refundRejectTarget} onCancel={() => { setRefundRejectTarget(null); setRefundRejectReason(''); }} width={460}
        onOk={handleRejectRefundSubmit} okText="确认驳回" cancelText="取消">
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>请填写驳回原因，代理商将收到通知并可重新申请。</div>
        <Input.TextArea rows={3} placeholder="请填写驳回原因" value={refundRejectReason} onChange={e => setRefundRejectReason(e.target.value)} />
      </Modal>

      {/* 授权书图查看（可重新上传替换） */}
      <Modal title={`授权书图 - ${certImgView?.companyName || ''}`} open={!!certImgView} onCancel={() => setCertImgView(null)} width={720}
        footer={[
          <Button key="reup" type="primary" icon={<PictureOutlined />} onClick={() => { const t = certImgView; setCertImgView(null); if (t) openUpCert(t); }}>重新上传</Button>,
          <Button key="close" onClick={() => setCertImgView(null)}>关闭</Button>,
        ]}>
        <div style={{ textAlign: 'center' }}>{certImgView?.certImage && <AntdImage src={certImgView.certImage} style={{ maxWidth: '100%' }} />}</div>
      </Modal>

      {/* 显示字段设置（勾选显示+上下箭头/拖动调序） */}
      <FieldConfigModal
        open={ownFieldCfgVisible}
        fields={ownFields}
        order={ownFieldOrder}
        visibility={ownFieldVisResolved}
        onSave={saveOwnFieldCfg}
        onCancel={() => setOwnFieldCfgVisible(false)}
        title="显示字段设置 - 自有品牌申请"
      />
    </div>
  );
};

// ============ 自有品牌台账编辑器 ============
export const OwnBrandEditor: React.FC<{ brands: OwnBrand[]; onChange: (l: OwnBrand[]) => void }> = ({ brands, onChange }) => {
  const { sized: sizedBrands } = useColResize(`brandauth_cols_ownbrands_${getDataOwner()}`);
  const [nb, setNb] = useState<OwnBrand>({ key: '', brandName: '', trademarkNo: '', category: '', signCompany: '', isExclusive: '否' });
  const add = () => {
    if (!nb.brandName.trim()) { message.warning('请输入品牌名称'); return; }
    onChange([...brands, { ...nb, key: genKey('OB') }]);
    setNb({ key: '', brandName: '', trademarkNo: '', category: '', signCompany: '', isExclusive: '否' });
  };
  // 品牌素材上传：图片/压缩包等附件读为 base64 存于品牌条目（单文件限 5MB 防配额丢写）
  const addMat = (r: OwnBrand, f: File) => {
    if (f.size > 5 * 1024 * 1024) { message.warning(`素材「${f.name}」超过 5MB，请压缩后再上传`); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const mat: BrandMaterial = { key: genKey('BM'), name: f.name, mime: f.type || '', size: f.size, dataUrl: String(reader.result || ''), uploadedAt: todayIso() };
      onChange(brands.map(x => (x.key === r.key ? { ...x, materials: [...(x.materials || []), mat] } : x)));
      message.success(`素材「${f.name}」已上传，授权书出具后代理商可下载`);
    };
    reader.readAsDataURL(f);
  };
  return (
    <div>
      {/* 字段用途说明 */}
      <div style={{ marginBottom: 10, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e6eaf0', borderRadius: 4, fontSize: 12, color: '#666', lineHeight: 1.9 }}>
        <div><Text strong style={{ fontSize: 12 }}>字段说明：</Text></div>
        <div>· <Text strong style={{ fontSize: 12 }}>品牌名称</Text>：公司自有品牌名，外部申请页"申请品牌"下拉与销售数据分析的品牌统计据此展示；</div>
        <div>· <Text strong style={{ fontSize: 12 }}>注册商标号</Text>：该品牌在商标局注册的注册号，随申请单与授权书一并展示，供代理商/平台核验授权真实性；</div>
        <div>· <Text strong style={{ fontSize: 12 }}>类目</Text>：商标注册类目（如 25 类），界定授权书的经营授权范围；</div>
        <div>· <Text strong style={{ fontSize: 12 }}>落款公司</Text>：授权书落款盖章的公司名称，留空时默认使用本方公司名称；</div>
        <div>· <Text strong style={{ fontSize: 12 }}>品牌素材</Text>：商标证/LOGO/包装图等品牌资料（单文件≤5MB），授权书出具后代理商可在“我的授权书”下载使用。</div>
        <div>· <Text strong style={{ fontSize: 12 }}>是否专版</Text>：标识该品牌是否为专版品牌，选择“是”或“否”。</div>
      </div>
      <Table rowKey="key" size="small" bordered pagination={false} dataSource={brands}
        columns={sizedBrands([
          { title: <span>品牌名称 <Tooltip title="公司自有品牌名：外部申请页下拉选项与销售品牌统计来源"><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'brandName', key: 'brandName', width: 110 },
          { title: <span>注册商标号 <Tooltip title="商标注册号：随申请单/授权书展示，供核验授权真实性"><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'trademarkNo', key: 'trademarkNo', width: 110 },
          { title: <span>类目 <Tooltip title="商标注册类目（如 25 类）：界定授权经营范围"><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'category', key: 'category', width: 70 },
          {
            title: <span>落款公司 <Tooltip title="授权书落款盖章公司名，留空默认用本方公司名"><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'signCompany', key: 'signCompany', width: 190,
            render: (v, r) => <Input size="small" value={v || ''} placeholder="授权书落款公司（留空用公司名）" onChange={e => onChange(brands.map(x => (x.key === r.key ? { ...x, signCompany: e.target.value } : x)))} />,
          },
          { title: <span>是否专版 <Tooltip title="标识该品牌是否为专版品牌"><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, dataIndex: 'isExclusive', key: 'isExclusive', width: 80, align: 'center',
            render: (v: string) => v === '是' ? <Tag color="red">专版</Tag> : <Tag>普通</Tag>,
          },
          {
            title: <span>品牌素材 <Tooltip title="商标证/LOGO 等资料，授权书出具后代理商可下载"><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></span>, key: 'mats', width: 220,
            render: (_v, r) => (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {(r.materials || []).map(m => (
                  <Tag key={m.key} closable style={{ marginInlineEnd: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClose={() => onChange(brands.map(x => (x.key === r.key ? { ...x, materials: (x.materials || []).filter(y => y.key !== m.key) } : x)))}>{m.name}</Tag>
                ))}
                <Upload multiple showUploadList={false} accept="image/*,.zip,.rar,.7z,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  beforeUpload={f => { addMat(r, f); return false; }}>
                  <Button size="small" icon={<UploadOutlined />}>上传素材</Button>
                </Upload>
              </Space>
            ),
          },
          {
            title: '操作', key: 'op', width: 70, align: 'center',
            render: (_v, r) => <Button type="link" size="small" danger onClick={() => onChange(brands.filter(x => x.key !== r.key))}>删除</Button>,
          },
        ] as ColumnsType<OwnBrand>)} />
      <Divider style={{ margin: '12px 0' }} />
      <Space wrap>
        <Input placeholder="品牌名称" title="公司自有品牌名" style={{ width: 140 }} value={nb.brandName} onChange={e => setNb({ ...nb, brandName: e.target.value })} />
        <Input placeholder="注册商标号" title="商标注册号" style={{ width: 140 }} value={nb.trademarkNo} onChange={e => setNb({ ...nb, trademarkNo: e.target.value })} />
        <Input placeholder="类目" title="商标注册类目，如 25 类" style={{ width: 140 }} value={nb.category} onChange={e => setNb({ ...nb, category: e.target.value })} />
        <Input placeholder="落款公司" title="授权书落款公司，留空用公司名" style={{ width: 180 }} value={nb.signCompany} onChange={e => setNb({ ...nb, signCompany: e.target.value })} />
        <Tooltip title="是否专版：标识该品牌是否为专版品牌，选择“是”或“否”">
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>是否专版</Text>
            <Select value={nb.isExclusive || '否'} onChange={v => setNb({ ...nb, isExclusive: v })} style={{ width: 80 }}>
              <Select.Option value="否">否</Select.Option>
              <Select.Option value="是">是</Select.Option>
            </Select>
            <QuestionCircleOutlined style={{ color: '#999' }} />
          </Space>
        </Tooltip>
        <Button type="primary" icon={<PlusOutlined />} onClick={add}>添加</Button>
      </Space>
    </div>
  );
};

export default OwnBrandPage;
