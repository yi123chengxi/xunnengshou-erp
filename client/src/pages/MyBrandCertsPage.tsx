import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table, Tag, Image as AntdImage, Button, Space, Empty, Typography, message, Modal, Input, AutoComplete, List, Spin, Descriptions, Tooltip, DatePicker, InputNumber, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, PrinterOutlined, ReloadOutlined, RollbackOutlined, DeleteOutlined, CopyOutlined, FolderOpenOutlined, RedoOutlined, UploadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ImageSlot from '../components/ImageSlot';
import useStickTableHeight from '../hooks/useStickTableHeight';
import { compressImageFile } from '../utils/imageCompress';
import { readClipboardImage, imageFileFromPasteEvent, clipboardImageFailureText } from '../utils/clipboard';
import { pushBankTransaction, isAccountingMode, writeAutoEntries } from '../utils/accountingBridge';
import {
  getDataOwner, certMirrorKey, appMirrorKey, safeJson, BrandCertView, BrandAppView, printHtml,
  BrandRefundReq, fetchRefundReqs, refundReqKey, genKey, todayIso, writeJson,
  BrandApplication, buildAppView, fetchCertByShareCode, publishAppMirror,
  BrandMaterial, fetchBrandMats,
  BrandRenewReq, fetchRenewReqs, renewReqKey,
  fetchBrandApps, shopTypeStyle, SHOP_TYPES,
  BrandSalesRecord, fetchSalesRecords, salesKey,
} from '../utils/brandAuth';

const { Text } = Typography;

/** 合并行：申请镜像为底，授权书镜像覆盖证书字段；再按品牌方申请键补全全量申请字段 */
type CertRow = BrandAppView & Partial<BrandCertView> & Partial<Pick<BrandApplication,
  'taxpayerCode' | 'legalPerson' | 'phone' | 'address' | 'platformUrl' | 'shopId' | 'shopType' |
  'payShot' | 'payBank' | 'category' | 'businessLicense' | 'idFront' | 'idBack' | 'agreementImage' | 'validFrom' |
  'rejectReason' | 'rejectAt' | 'depositPaymentKey' | 'refundPayBankName'>>;

/**
 * 采购商后台 - 我的授权书（品牌管理子页签）
 * 读取两个镜像键：brandauth_appmir_<本账号>（申请单，提交即可见）
 *                 brandauth_cert_<本账号>（授权书，品牌方上传后自动带图）
 */
const MyBrandCertsPage: React.FC = () => {
  const owner = getDataOwner();
  // 表格贴窗底：表体动态测高 + min-height 锁死，横向滚动条/分页贴窗口底部
  const stick = useStickTableHeight();
  const appKey = appMirrorKey(owner);
  const certKey = certMirrorKey(owner);
  const [rows, setRows] = useState<CertRow[]>([]);
  const [refundReqs, setRefundReqs] = useState<BrandRefundReq[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  // 品牌素材下载弹窗（授权书出具后开放）
  const [matsVisible, setMatsVisible] = useState(false);
  const [matsTitle, setMatsTitle] = useState('');
  const [matsList, setMatsList] = useState<BrandMaterial[]>([]);
  const [matsLoading, setMatsLoading] = useState(false);
  // 续签申请（到期前一个月开放）
  const [renewReqs, setRenewReqs] = useState<BrandRenewReq[]>([]);
  const [renewTarget, setRenewTarget] = useState<CertRow | null>(null);
  const [renewImages, setRenewImages] = useState<string[]>([]);
  const [renewReason, setRenewReason] = useState('');
  // 当前操作人显示名（记账人/审核人）
  const meName = useMemo(() => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find(x => x.username === owner);
      return u?.displayName || u?.companyName || owner;
    } catch { return owner; }
  }, [owner]);
  // 银行账户值串（选项 value 与反查共用同一拼接公式）
  const composeBankValue = (b: any): string =>
    [b.name || b.shortName || '', b.bankName || '', b.branchName || '', b.bankAccountNo || ''].filter(Boolean).join(' / ');

  const reload = () => {
    const appsList = safeJson<BrandAppView[]>(appKey, []);
    const certsList = safeJson<BrandCertView[]>(certKey, []);
    const merged: CertRow[] = appsList.map(a => {
      const c = certsList.find(x => x.appKey === a.appKey);
      return c ? { ...a, ...c } : { ...a };
    });
    // 同浏览器兜底：扫描各品牌方申请键，并入显式绑定本账号的申请（镜像写入口配额静默失败时仍可见；携带 brandOwner 供素材/退回定位）
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (!k.startsWith('brandauth_apps_') || k.endsWith('_ts')) continue;
      const brandOwner = k.slice('brandauth_apps_'.length);
      const appsArr = safeJson<any>(k, null);
      if (!Array.isArray(appsArr)) continue;
      appsArr.forEach((a: BrandApplication) => {
        if (!a || a.agentUsername !== owner) return;
        // 镜像旧条目缺 brandOwner/appNo 等字段时，用本地真值申请补全（素材下载/退回申请定位依赖 brandOwner）
        const ex = merged.find(r => r.appKey === a.key);
        if (ex) {
          if (!ex.brandOwner) ex.brandOwner = brandOwner;
          if (!ex.appNo) ex.appNo = a.appNo || '';
          if (!ex.certImage && a.certImage) ex.certImage = a.certImage;
          if (!ex.certHtml && a.certHtml) ex.certHtml = a.certHtml;
          if (!ex.shareCode && a.shareCode) ex.shareCode = a.shareCode;
          if (!ex.validTo && a.validTo) ex.validTo = a.validTo;
          return;
        }
        const pubArr = safeJson<any[]>(`brandauth_pub_${brandOwner}`, []);
        // 同浏览器直读真值键：授权书图/打印件一并带入（镜像为轻量副本不含图）
        merged.push({ ...buildAppView(a, pubArr[0]?.companyName || '', brandOwner), certImage: a.certImage || '', certHtml: a.certHtml || '' });
      });
    }
    // 仅有授权书镜像（历史数据）而缺申请镜像/本地申请键的补入（放在扫描后，避免遮盖带 brandOwner 的完整行）
    certsList.forEach(c => {
      if (!merged.some(r => r.appKey === c.appKey)) merged.push({ ...c } as CertRow);
    });
    setRows(merged);
    // 续签申请：按行品牌方归属拉取（代理商侧展示"续签已申请"门控）
    const rOwners = Array.from(new Set(merged.map(r => r.brandOwner).filter(Boolean))) as string[];
    if (rOwners.length) Promise.all(rOwners.map(o => fetchRenewReqs(o))).then(ls => setRenewReqs(ls.flat())).catch(() => { /* ignore */ });
    // 全量申请字段：直读品牌方申请键并入行（开店公司/店铺/保证金截图/付款账户等列与详情弹窗用）
    if (rOwners.length) {
      Promise.all(rOwners.map(o => fetchBrandApps(o))).then(ls => {
        const map = new Map<string, BrandApplication>();
        ls.flat().forEach(a => { if (a && a.key) map.set(a.key, a); });
        setRows(prev => prev.map(r => {
          const a = map.get(r.appKey);
          if (!a) return r;
          return {
            ...r,
            companyName: a.companyName || r.companyName, shopName: a.shopName || r.shopName,
            taxpayerCode: a.taxpayerCode || '', legalPerson: a.legalPerson || '', phone: a.phone || '',
            address: a.address || '', platformUrl: a.platformUrl || '', shopId: a.shopId || '',
            shopType: a.shopType || '', payShot: a.payShot || '', payBank: a.payBank || '',
            category: a.category || '', businessLicense: a.businessLicense || '', idFront: a.idFront || '',
            idBack: a.idBack || '', agreementImage: a.agreementImage || '', validFrom: a.validFrom || '',
            // 授权书字段第三通道兜底：品牌方申请键为同步真值源（公开凭证键/证书镜像陈旧或缺图时仍能显示授权书）
            certImage: r.certImage || a.certImage || '',
            certHtml: r.certHtml || a.certHtml || '',
            issuedAt: r.issuedAt || a.certImageAt || a.certAt || '',
            authNo: r.authNo || a.authNo || '',
            status: a.status || r.status,
            rejectReason: a.rejectReason || r.rejectReason || '',
            rejectAt: a.rejectAt || r.rejectAt || '',
            validTo: r.validTo || a.validTo || '',
            depositState: a.depositState || r.depositState || '',
            depositPaymentKey: a.depositPaymentKey || r.depositPaymentKey || '',
            refundShot: r.refundShot || a.refundShot || '',
            refundAt: a.refundAt || r.refundAt || '',
            refundPayBankName: a.refundPayBankName || r.refundPayBankName || '',
          };
        }));
      }).catch(() => { /* ignore */ });
    }
    // 授权书图/打印件按 shareCode 经公开凭证键实时取（服务端优先、本地兜底）
    const need = merged.filter(r => r.shareCode && !r.certImage);
    if (need.length) {
      Promise.all(need.map(r => fetchCertByShareCode(r.shareCode).then(c => ({ k: r.appKey, c })))).then(res => {
        setRows(prev => prev.map(row => {
          const hit = res.find(x => x.k === row.appKey);
          if (hit && hit.c && hit.c.certImage) {
            return { ...row, certImage: hit.c.certImage, certHtml: row.certHtml || hit.c.certHtml, issuedAt: row.issuedAt || hit.c.issuedAt, authNo: row.authNo || hit.c.authNo };
          }
          return row;
        }));
      }).catch(() => { /* ignore */ });
    }
    // 拉取各品牌方的保证金退回申请列表（含品牌方回传状态/截图）；记账改由代理商在详情窗点"确认到账"触发
    const owners = Array.from(new Set(merged.map(r => r.brandOwner).filter(Boolean)));
    Promise.all(owners.map(o => fetchRefundReqs(o))).then(ls => {
      setRefundReqs(ls.flat());
    }).catch(() => { /* ignore */ });
    // 销售数据：按行品牌方归属拉取（销售数据列按筛选月份显示已提交/未提交）
    if (owners.length) Promise.all(owners.map(o => fetchSalesRecords(o))).then(ls => setSalesReqs(ls.flat())).catch(() => { /* ignore */ });
  };

  // 简易账薄-日常记账登记（幂等键写入前先过滤同键旧记录，凭证号按当日 PZ 递增）
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
        amount, counterparty, remark, person: meName,
        recvAccount: type === '收入' ? accountName : '', recvBank: type === '收入' ? bankName : '',
        payAccount: type === '支出' ? accountName : '', payBank: type === '支出' ? bankName : '',
        image: image || '', isPersonalAdvance: false, isReturn: false, advanceRecvAccount: '',
        linkedReimbursementKey: '', department: '', auditor: meName, cashier: meName,
        createdAt: new Date().toISOString(), autoSourceKey: bookKey,
      };
      writeJson(bkKey, [rec, ...cleaned]);
    } catch { /* ignore */ }
  };
  // 保证金退回详情窗（已退待确认 → 确认到账触发记账）
  const [refundDetail, setRefundDetail] = useState<{ row: CertRow; req: BrandRefundReq } | null>(null);
  const openRefundDetail = (r: CertRow, req: BrandRefundReq) => setRefundDetail({ row: r, req });
  // 确认到账：银行明细收入（手输账户无匹配则忽略）+ 简易账薄日记账收入 / 会计账薄分录（借银行存款 贷其他应收款）；幂等键防重复记
  const confirmRefundRecv = (req: BrandRefundReq) => {
    const bookedKey = `brandauth_refundbooked_${owner}`;
    const booked = safeJson<string[]>(bookedKey, []);
    const amt = Number(req.amount) || 0;
    const bas = safeJson<any[]>(`pageData_finance_bank-account_${owner}`, []);
    const acc = req.agentBankNo ? bas.find((b: any) => (b.bankAccountNo || '') === req.agentBankNo) : undefined;
    const accName = acc ? (acc.name || acc.shortName || '') : '';
    const brandInfo = req.brandCompany || '';
    if (!booked.includes(req.key)) {
      if (accName && amt > 0) pushBankTransaction(owner, accName, 'in', amt, `保证金退回收入 — ${brandInfo}`, meName);
      if (isAccountingMode(owner)) {
        if (amt > 0) writeAutoEntries(owner, {
          sourceKey: `ba-refundrecv-${req.key}`, debitSubject: '银行存款', creditSubject: '其他应收款',
          amount: amt, summary: `品牌授权保证金退回${brandInfo}`, date: todayIso(),
          bookkeeper: meName, auditor: meName,
        });
      } else if (amt > 0) {
        writeDailyBook(`bk-agrrefund-${req.key}`, '收入', amt, brandInfo, `保证金退回 — ${brandInfo}`, accName || req.agentBank || '', acc?.bankName || '', req.refundShot || '');
      }
      booked.push(req.key);
      writeJson(bookedKey, booked);
    }
    // 申请闭环：已退回 → 已确认（写品牌方名下键，品牌方侧同步可见）
    fetchRefundReqs(req.brandOwner).then(l => {
      const nl = l.map(q => (q.key === req.key ? { ...q, status: '已确认' as const, confirmedAt: todayIso() } : q));
      writeJson(refundReqKey(req.brandOwner), nl);
      setRefundReqs(nl);
    }).catch(() => { /* ignore */ });
    setRefundDetail(null);
    message.success(accName ? '已确认到账：收入已记入对应银行账户明细及账薄' : '已确认到账：未匹配到本方银行账户，银行明细跳过');
  };
  useEffect(() => { reload(); }, [owner, appKey, certKey]);
  useEffect(() => {
    const onSync = () => reload();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [appKey, certKey]);

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.appliedAt || b.issuedAt || '').localeCompare(a.appliedAt || a.issuedAt || '')), [rows]);

  // 按字段搜索：输入态与已应用态分离，回车/点查询才生效；重置清空全部
  const EMPTY_CSEARCH = { appNo: '', brand: '', company: '', shop: '', platform: '', owner: '', shopType: '', depState: '' };
  const [cInput, setCInput] = useState({ ...EMPTY_CSEARCH });
  const [cApplied, setCApplied] = useState({ ...EMPTY_CSEARCH });
  const applyCertSearch = () => setCApplied({ ...cInput });
  const resetCertSearch = () => { setCInput({ ...EMPTY_CSEARCH }); setCApplied({ ...EMPTY_CSEARCH }); };
  const filteredRows = useMemo(() => {
    const kw = (s: string) => s.trim().toLowerCase();
    const hit = (v: string | undefined, k: string) => !k || (v || '').toLowerCase().includes(k);
    return sorted.filter(r =>
      hit(r.appNo, kw(cApplied.appNo)) &&
      hit(r.brandName, kw(cApplied.brand)) &&
      hit(r.companyName, kw(cApplied.company)) &&
      hit(r.shopName, kw(cApplied.shop)) &&
      hit(r.platform, kw(cApplied.platform)) &&
      hit(r.ownerCompany, kw(cApplied.owner)) &&
      (!cApplied.shopType || (r.shopType || '') === cApplied.shopType) &&
      (!cApplied.depState || (r.depositState || '未确认') === cApplied.depState));
  }, [sorted, cApplied]);

  // 代理商发起保证金退回申请：弹窗填写原因/附件后写入品牌方名下退回申请键
  const [reqTarget, setReqTarget] = useState<CertRow | null>(null);
  const [reqImages, setReqImages] = useState<string[]>([]);
  const [reqReason, setReqReason] = useState('');
  const [reqBank, setReqBank] = useState('');
  const [reqBankNo, setReqBankNo] = useState('');
  const applyRefund = (r: CertRow) => {
    if (!r.brandOwner) { message.warning('缺少品牌方归属信息，无法发起退回'); return; }
    setBankAccounts(safeJson<any[]>(`pageData_finance_bank-account_${owner}`, []));
    setReqTarget(r);
    setReqImages([]);
    setReqReason('');
    setReqBank('');
    setReqBankNo('');
  };
  // 元素级 onPaste 兜底（图片区按 Ctrl+V）：paste 的 clipboardData 不受安全上下文限制
  const pasteImagesTo = (e: React.ClipboardEvent, apply: (url: string) => void) => {
    const file = imageFileFromPasteEvent(e);
    if (!file) return;
    e.preventDefault();
    void compressImageFile(file).then(apply).catch(() => message.error('图片处理失败'));
  };
  const pasteToReq = async () => {
    if (reqImages.length >= 5) { message.warning('最多上传 5 张图片'); return; }
    const res = await readClipboardImage();
    if (!res.ok) { message.warning(clipboardImageFailureText(res.reason)); return; }
    try {
      const url = await compressImageFile(res.blob);
      setReqImages(ls => (ls.length >= 5 ? ls : [...ls, url]));
      message.success('已粘贴剪切板图片');
    } catch { message.error('图片处理失败，请重新截图后再试'); }
  };
  const submitReq = () => {
    if (!reqTarget || !reqTarget.brandOwner) return;
    fetchRefundReqs(reqTarget.brandOwner).then(existing => {
      const req: BrandRefundReq = {
        key: genKey('BR'), appKey: reqTarget.appKey, brandOwner: reqTarget.brandOwner, agentUsername: owner,
        companyName: reqTarget.companyName, amount: reqTarget.deposit, requestedAt: todayIso(), status: '已申请',
        images: reqImages, reason: reqReason.trim(),
        agentBank: reqBank.trim(), agentBankNo: reqBankNo, brandCompany: reqTarget.ownerCompany || '',
      };
      const list = [...existing.filter(q => q.appKey !== reqTarget.appKey), req];
      writeJson(refundReqKey(reqTarget.brandOwner), list);
      setRefundReqs(prev => [...prev.filter(q => q.appKey !== reqTarget.appKey), req]);
      setReqTarget(null);
      message.success('退回申请已提交，品牌方审核处理后将回传付款截图');
    }).catch(() => message.error('提交失败，请重试'));
  };

  // 申请编号点击→全量字段详情弹窗
  const [appDetail, setAppDetail] = useState<CertRow | null>(null);

  // 续签门控：授权已出具且进入到期前一个月窗口；已有待处理续签申请则只展示标签
  const renewPending = (r: CertRow) => renewReqs.some(q => q.appKey === r.appKey && q.status === '已申请');
  const canRenew = (r: CertRow) => !!r.validTo && ['授权书已发', '已生成授权书', '续签成功'].includes(r.status)
    && !dayjs().isBefore(dayjs(r.validTo).subtract(1, 'month'), 'day');
  const openRenew = (r: CertRow) => {
    if (!r.brandOwner) { message.warning('缺少品牌方归属信息，无法发起续签'); return; }
    setRenewTarget(r);
    setRenewImages([]);
    setRenewReason('');
  };
  const pasteToRenew = async () => {
    if (renewImages.length >= 5) { message.warning('最多上传 5 张图片'); return; }
    const res = await readClipboardImage();
    if (!res.ok) { message.warning(clipboardImageFailureText(res.reason)); return; }
    try {
      const url = await compressImageFile(res.blob);
      setRenewImages(ls => (ls.length >= 5 ? ls : [...ls, url]));
      message.success('已粘贴剪切板图片');
    } catch { message.error('图片处理失败，请重新截图后再试'); }
  };
  const submitRenew = () => {
    if (!renewTarget || !renewTarget.brandOwner) return;
    fetchRenewReqs(renewTarget.brandOwner).then(existing => {
      const req: BrandRenewReq = {
        key: genKey('RN'), appKey: renewTarget.appKey, brandOwner: renewTarget.brandOwner || '', agentUsername: owner,
        companyName: renewTarget.companyName, brandName: renewTarget.brandName || '',
        images: renewImages, reason: renewReason.trim(), requestedAt: todayIso(), status: '已申请',
      };
      const list = [...existing.filter(q => !(q.appKey === req.appKey && q.status === '已申请')), req];
      writeJson(renewReqKey(renewTarget.brandOwner || ''), list);
      setRenewReqs(ls => [...ls.filter(q => !(q.appKey === req.appKey && q.status === '已申请')), req]);
      setRenewTarget(null);
      message.success('续签申请已提交，品牌方续签授权书后状态将置为"续签成功"');
    }).catch(() => message.error('提交失败，请重试'));
  };

  // 品牌素材：授权书出具后拉取品牌方发布的素材清单供下载
  const openMats = (r: CertRow) => {
    if (!(r.certImage || r.status === '授权书已发')) { message.info('品牌方出具授权书后方可下载品牌素材'); return; }
    setMatsTitle(`${r.brandName || '品牌'} - 品牌素材`);
    setMatsList([]);
    setMatsVisible(true);
    setMatsLoading(true);
    fetchBrandMats(r.brandOwner || '').then(list => {
      const hit = list.find(x => x.brandName === r.brandName);
      setMatsList(hit?.materials || []);
    }).catch(() => { /* ignore */ }).finally(() => setMatsLoading(false));
  };
  const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

  // ============ 列宽自由调整：拖拽表头右边缘改宽，宽度按账号持久化 ============
  const COLW_KEY = `brandauth_certcols_w_${owner}`;
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(COLW_KEY) || '{}') || {}; } catch { return {}; }
  });
  // ref 镜像最新宽度：mouseup 落盘不依赖 setState updater 副作用（React 可能跳过同引用 updater）
  const colWidthsRef = useRef<Record<string, number>>(colWidths);
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th');
    const startX = e.clientX;
    const startW = th ? th.offsetWidth : 120;
    const move = (ev: MouseEvent) => {
      const w = Math.max(60, startW + ev.clientX - startX);
      colWidthsRef.current = { ...colWidthsRef.current, [key]: w };
      setColWidths(colWidthsRef.current);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try { localStorage.setItem(COLW_KEY, JSON.stringify(colWidthsRef.current)); } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // ============ 销售数据（按月提交交易数据给品牌方） ============
  const [salesReqs, setSalesReqs] = useState<BrandSalesRecord[]>([]);
  const [salesMonth, setSalesMonth] = useState<string>(dayjs().format('YYYY-MM'));
  const [salesTarget, setSalesTarget] = useState<CertRow | null>(null);
  const [salesInputMonth, setSalesInputMonth] = useState<dayjs.Dayjs | null>(dayjs());
  const [salesQty, setSalesQty] = useState<number | null>(null);
  const [salesAmount, setSalesAmount] = useState<number | null>(null);
  const [salesScore, setSalesScore] = useState<number | null>(null);
  const [salesImages, setSalesImages] = useState<string[]>([]);
  const [salesDetail, setSalesDetail] = useState<BrandSalesRecord | null>(null);
  const openSales = (r: CertRow) => {
    if (!r.brandOwner) { message.warning('缺少品牌方归属信息，无法提交销售数据'); return; }
    setSalesTarget(r);
    setSalesInputMonth(dayjs(salesMonth));
    setSalesQty(null); setSalesAmount(null); setSalesScore(null); setSalesImages([]);
  };
  const pasteToSales = async () => {
    if (salesImages.length >= 5) { message.warning('最多上传 5 张图片'); return; }
    const res = await readClipboardImage();
    if (!res.ok) { message.warning(clipboardImageFailureText(res.reason)); return; }
    try {
      const url = await compressImageFile(res.blob);
      setSalesImages(ls => (ls.length >= 5 ? ls : [...ls, url]));
      message.success('已粘贴剪切板图片');
    } catch { message.error('图片处理失败，请重新截图后再试'); }
  };
  const submitSales = () => {
    if (!salesTarget || !salesTarget.brandOwner) { message.warning('缺少品牌方归属信息，无法提交'); return; }
    if (!salesInputMonth) { message.warning('请选择年月'); return; }
    if (salesQty == null || salesAmount == null) { message.warning('请填写销售数量与销售额'); return; }
    const month = salesInputMonth.format('YYYY-MM');
    const rec: BrandSalesRecord = {
      key: genKey('ba-sales'), appKey: salesTarget.appKey, appNo: salesTarget.appNo || '', brandOwner: salesTarget.brandOwner,
      agentUsername: owner, companyName: salesTarget.companyName || '', shopName: salesTarget.shopName || '', brandName: salesTarget.brandName || '',
      month, qty: salesQty, amount: salesAmount, score: salesScore ?? 0, images: salesImages, submittedAt: todayIso(),
    };
    fetchSalesRecords(salesTarget.brandOwner).then(list => {
      const nl = [...list.filter(x => !(x.appKey === rec.appKey && x.month === month)), rec];
      writeJson(salesKey(salesTarget.brandOwner), nl);
      setSalesReqs(prev => [...prev.filter(x => !(x.appKey === rec.appKey && x.month === month)), rec]);
      setSalesTarget(null);
      message.success(`${month} 销售数据已提交，品牌方可在销售数据列查看`);
    }).catch(() => message.error('销售数据提交失败'));
  };

  const columns: ColumnsType<CertRow> = [
    {
      title: '申请编号', dataIndex: 'appNo', key: 'appNo', width: 150, align: 'center',
      render: (v, r) => (v ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setAppDetail(r)}>{v}</Button> : '—'),
    },
    { title: '申请时间', dataIndex: 'appliedAt', key: 'appliedAt', width: 110, align: 'center' },
    { title: '品牌名称', dataIndex: 'brandName', key: 'brandName', width: 110, align: 'center', render: v => (v ? <Tag color="blue">{v}</Tag> : '—') },
    { title: '开店公司', dataIndex: 'companyName', key: 'companyName', width: 160, ellipsis: true },
    { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 120, ellipsis: true },
    {
      title: '店铺类型', dataIndex: 'shopType', key: 'shopType', width: 90, align: 'center',
      render: (v: string) => (v ? <span style={shopTypeStyle(v)}>{v}</span> : '—'),
    },
    {
      title: '保证金截图', dataIndex: 'payShot', key: 'payShot', width: 90, align: 'center',
      render: v => (v ? <AntdImage src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—'),
    },
    {
      title: '付款账户', dataIndex: 'payBank', key: 'payBank', width: 180, ellipsis: true,
      render: v => (v ? <Tooltip title={v}><span>{v}</span></Tooltip> : '—'),
    },
    { title: '授权平台', dataIndex: 'platform', key: 'platform', width: 90, align: 'center' },
    {
      title: '保证金/退回', key: 'deposit', width: 140, align: 'center',
      render: (_v, r) => {
        const req = refundReqs.find(q => q.appKey === r.appKey);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span>{r.deposit ? `¥${r.deposit}` : '—'}</span>
            {r.depositState === '已退回' ? (
              req && req.status === '已退回' ? (
                <Space size={4}>
                  <Button type="link" size="small" danger style={{ padding: 0, fontWeight: 600 }} onClick={() => openRefundDetail(r, req)}>已退待确认</Button>
                  {req.refundShot && <AntdImage src={req.refundShot} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} />}
                </Space>
              ) : (
                <Space size={4}>
                  <Button type="link" size="small" style={{ padding: 0, color: '#52c41a' }} onClick={() => {
                    if (req) {
                      openRefundDetail(r, req);
                    } else {
                      // 品牌方主动退保：无退回申请记录，直接显示申请单上的退回信息
                      Modal.info({
                        title: '保证金退回详情',
                        content: <div style={{ marginTop: 12 }}>
                          <p><strong>退回金额：</strong>¥{r.deposit || '—'}</p>
                          <p><strong>品牌方退回时间：</strong>{r.refundAt || '—'}</p>
                          <p><strong>品牌方付款账户：</strong>{r.refundPayBankName || '—'}</p>
                          <p><strong>退款截图：</strong></p>
                          {r.refundShot ? <AntdImage src={r.refundShot} width={200} style={{ borderRadius: 4 }} /> : '—'}
                        </div>,
                        okText: '关闭',
                      });
                    }
                  }}>成功退回</Button>
                  {(req?.refundShot || r.refundShot) && <AntdImage src={(req?.refundShot || r.refundShot)!} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} />}
                </Space>
              )
            ) : req?.status === '已申请' ? <span style={{ color: '#f5222d', fontWeight: 600, fontSize: 12 }}>已申请（待品牌方审核）</span>
              : req?.status === '已驳回' ? (
                <Tooltip title={`驳回原因：${req.rejectReason || '—'}（${req.rejectAt || ''}）`}>
                  <Button type="link" size="small" danger style={{ padding: 0, fontWeight: 600 }} onClick={() => Modal.info({
                    title: '退回申请已驳回',
                    content: <div>
                      <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>驳回时间：{req.rejectAt || '—'}</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{req.rejectReason || '—'}</div>
                      <div style={{ marginTop: 10, color: '#888', fontSize: 12 }}>可重新申请退回保证金。</div>
                    </div>,
                    okText: '知道了',
                  })}>已驳回</Button>
                </Tooltip>
              )
              : r.depositPaymentKey ? <span style={{ color: '#722ed1', fontWeight: 600, fontSize: 12 }}>退款中</span>
              : (r.depositState === '已确认' || r.status !== '待确认') ? <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => applyRefund(r)}>申请退回保证金</Button>
              : null}
          </div>
        );
      },
    },
    { title: '品牌方', dataIndex: 'ownerCompany', key: 'ownerCompany', width: 170, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 110, align: 'center',
      render: (v, r) => (
        <Tag color={v === '授权书已发' ? 'green' : v === '续签成功' ? 'cyan' : v === '待确认' ? 'orange' : v === '已驳回' ? 'red' : 'blue'}
          style={v === '已驳回' ? { cursor: 'pointer' } : undefined}
          onClick={v === '已驳回' ? () => Modal.info({
            title: `驳回原因 - ${r.appNo || r.companyName || ''}`,
            content: <div>
              <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>驳回时间：{r.rejectAt || '—'}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{r.rejectReason || '—'}</div>
              <div style={{ marginTop: 10, color: '#888', fontSize: 12 }}>可在操作列点"重新申请"修改申请信息后再次提交。</div>
            </div>,
            okText: '知道了',
          }) : undefined}>{v}</Tag>
      ),
    },
    { title: '授权编号', dataIndex: 'authNo', key: 'authNo', width: 170, align: 'center', render: v => (v ? <Tag color="purple">{v}</Tag> : '—') },
    {
      title: '授权书', dataIndex: 'certImage', key: 'certImage', width: 90, align: 'center',
      render: v => (v ? <AntdImage src={v} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ color: '#ccc' }}>未出具</span>),
    },
    { title: '出具日期', dataIndex: 'issuedAt', key: 'issuedAt', width: 110, align: 'center', render: v => v || '—' },
    {
      title: '销售数据', key: 'sales', width: 100, align: 'center',
      render: (_v, r) => {
        const rec = salesReqs.find(x => x.appKey === r.appKey && x.month === salesMonth);
        return rec
          ? <Button type="link" size="small" style={{ padding: 0, height: 'auto', color: '#52c41a', fontWeight: 600 }} onClick={() => setSalesDetail(rec)}>已提交</Button>
          : <span style={{ color: '#999' }}>未提交</span>;
      },
    },
    {
      title: '有效期', key: 'validPeriod', width: 160, align: 'center',
      render: (_v, r) => (
        <div>
          {r.validFrom || r.validTo ? <span>{r.validFrom || '—'} ~ {r.validTo || '—'}</span> : '—'}
          <div style={{ marginTop: 2 }}>
            {renewPending(r)
              ? <Tag color="orange" style={{ margin: 0 }}>续签已申请</Tag>
              : canRenew(r)
                ? <Button type="link" size="small" icon={<RedoOutlined />} onClick={() => openRenew(r)}>续签申请</Button>
                : null}
          </div>
        </div>
      ),
    },
    {
      title: '操作', key: 'op', width: 200, align: 'center',
      render: (_v, r) => (
        <div>
          <Space size={0} wrap>
            {r.status === '已驳回' && (
              <Button type="link" size="small" danger icon={<RedoOutlined />} onClick={() => openReapply(r)}>重新申请</Button>
            )}
            {r.certImage && (
              <Button type="link" size="small" icon={<DownloadOutlined />}
                onClick={() => { const a = document.createElement('a'); a.href = r.certImage; a.download = `授权书-${r.authNo || r.brandName || 'brand'}.jpg`; a.click(); }}>下载</Button>
            )}
            {r.certHtml && (
              <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => printHtml(r.certHtml)}>打印</Button>
            )}
            {(r.certImage || r.status === '授权书已发') && (
              <Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={() => openMats(r)}>素材</Button>
            )}
            <Button type="link" size="small" icon={<UploadOutlined />} onClick={() => openSales(r)}>上传交易数据</Button>
            {!r.certImage && !r.certHtml && <span style={{ color: '#ccc', fontSize: 12 }}>等待品牌方出具</span>}
          </Space>
        </div>
      ),
    },
  ];

  // 重新申请：被驳回后编辑申请信息再次提交（回写品牌方申请键+镜像，品牌方状态自动更新为待确认）
  const [raTarget, setRaTarget] = useState<CertRow | null>(null);
  const [raFields, setRaFields] = useState({ companyName: '', legalPerson: '', phone: '', address: '', shopName: '', platform: '', platformUrl: '' });
  const openReapply = (r: CertRow) => {
    setRaTarget(r);
    setRaFields({
      companyName: r.companyName || '', legalPerson: r.legalPerson || '', phone: r.phone || '', address: r.address || '',
      shopName: r.shopName || '', platform: r.platform || '', platformUrl: r.platformUrl || '',
    });
  };
  const submitReapply = () => {
    if (!raTarget || !raTarget.brandOwner) { message.error('缺少品牌方归属，无法重新申请'); return; }
    if (!raFields.companyName.trim()) { message.warning('请填写公司名称'); return; }
    const k = `brandauth_apps_${raTarget.brandOwner}`;
    const list = safeJson<BrandApplication[]>(k, []);
    const idx = list.findIndex(x => x.key === raTarget.appKey);
    if (idx < 0) { message.error('未找到品牌方申请记录，请刷新后重试'); return; }
    const updated: BrandApplication = { ...list[idx], ...raFields, status: '待确认', rejectReason: '', rejectAt: '', appliedAt: todayIso() };
    list[idx] = updated;
    writeJson(k, list);
    publishAppMirror(updated, raTarget.ownerCompany || '', raTarget.brandOwner);
    setRaTarget(null);
    message.success('已重新提交申请，品牌方页面状态自动更新为待确认');
    reload();
  };

  // 应用自定义列宽并在表头注入拖拽手柄
  const sizedColumns = columns.map(c => ({
    ...c,
    width: colWidths[String(c.key)] || (typeof c.width === 'number' ? c.width : undefined),
    title: (
      <span style={{ display: 'block', position: 'relative' }}>
        {c.title as React.ReactNode}
        <span
          title="拖拽调整列宽"
          onMouseDown={e => startResize(String(c.key), e)}
          onClick={e => e.stopPropagation()}
          style={{ position: 'absolute', right: -7, top: -10, bottom: -10, width: 10, cursor: 'col-resize', zIndex: 3 }}
        />
      </span>
    ),
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Space style={{ marginBottom: 12, flexShrink: 0 }} wrap>
        <Text strong style={{ fontSize: 15 }}>我的授权书</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>提交申请后即显示进度；品牌方上传授权书后自动显示图片，可查看/下载/打印</Text>
        <span style={{ fontSize: 12, color: '#888' }}>销售月份</span>
        <DatePicker picker="month" size="small" allowClear={false} value={dayjs(salesMonth)}
          onChange={d => setSalesMonth(d ? d.format('YYYY-MM') : dayjs().format('YYYY-MM'))} />
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </Space>
      {/* 搜索行：按字段拆分，回车或点查询生效；重置清空全部已填/已选 */}
      <Space wrap style={{ marginBottom: 12, flexShrink: 0 }}>
        <Input placeholder="申请编号" style={{ width: 150 }} allowClear value={cInput.appNo} onPressEnter={applyCertSearch}
          onChange={e => setCInput(s => ({ ...s, appNo: e.target.value }))} />
        <Input placeholder="品牌名称" style={{ width: 120 }} allowClear value={cInput.brand} onPressEnter={applyCertSearch}
          onChange={e => setCInput(s => ({ ...s, brand: e.target.value }))} />
        <Input placeholder="开店公司" style={{ width: 170 }} allowClear value={cInput.company} onPressEnter={applyCertSearch}
          onChange={e => setCInput(s => ({ ...s, company: e.target.value }))} />
        <Input placeholder="店铺名称" style={{ width: 150 }} allowClear value={cInput.shop} onPressEnter={applyCertSearch}
          onChange={e => setCInput(s => ({ ...s, shop: e.target.value }))} />
        <Input placeholder="授权平台" style={{ width: 110 }} allowClear value={cInput.platform} onPressEnter={applyCertSearch}
          onChange={e => setCInput(s => ({ ...s, platform: e.target.value }))} />
        <Input placeholder="品牌方" style={{ width: 170 }} allowClear value={cInput.owner} onPressEnter={applyCertSearch}
          onChange={e => setCInput(s => ({ ...s, owner: e.target.value }))} />
        <Select placeholder="店铺类型" style={{ width: 110 }} allowClear value={cInput.shopType || undefined}
          onChange={(v: string) => setCInput(s => ({ ...s, shopType: v || '' }))}
          options={SHOP_TYPES.map(x => ({ value: x, label: x }))} />
        <Select placeholder="保证金状态" style={{ width: 120 }} allowClear value={cInput.depState || undefined}
          onChange={(v: string) => setCInput(s => ({ ...s, depState: v || '' }))}
          options={['已确认', '已退回', '未确认'].map(x => ({ value: x, label: x }))} />
        <Button type="primary" icon={<SearchOutlined />} onClick={applyCertSearch}>查询</Button>
        <Button onClick={resetCertSearch}>重置</Button>
      </Space>
      <div ref={stick.ref} style={{ flex: 1, minHeight: 0 }}>
        <Table rowKey="appKey" size="small" bordered columns={sizedColumns} dataSource={filteredRows}
          scroll={{ x: 2500, y: stick.scrollY }} pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description="暂无授权申请记录，提交品牌授权申请后自动显示在此处" /> }} />
      </div>

      {/* 申请退回保证金：原因/备注 + 最多5张附件（可粘贴） */}
      <Modal title={`申请退回保证金 - ${reqTarget?.appNo || ''}`} open={!!reqTarget} onCancel={() => setReqTarget(null)} width={640}
        onOk={submitReq} okText="提交退回申请" cancelText="取消">
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>提交后品牌方在"保证金"列审核查看；退回完成后品牌方的付款截图将回传至本列表。</div>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>申请原因 / 备注说明：</div>
        <Input.TextArea rows={3} value={reqReason} onChange={e => setReqReason(e.target.value)} maxLength={300} showCount
          placeholder="请填写退回原因、收款账户说明等（品牌方审核时查看）" />
        <div style={{ margin: '12px 0 4px', fontSize: 12, color: '#666' }}>代理商收款银行账户（默认取银行账户列表，也可手动输入）：</div>
        <AutoComplete style={{ width: '100%' }} value={reqBank} placeholder="选择或手动输入收款银行账户"
          options={bankAccounts.map((b: any) => ({ value: composeBankValue(b) }))}
          onSelect={(v: string) => {
            setReqBank(v);
            const hit = bankAccounts.find((b: any) => composeBankValue(b) === v);
            setReqBankNo(hit?.bankAccountNo || '');
          }}
          onChange={(v: string) => {
            setReqBank(v);
            const hit = bankAccounts.find((b: any) => composeBankValue(b) === v || (v && (b.bankAccountNo || '') === v));
            setReqBankNo(hit?.bankAccountNo || '');
          }}
          allowClear />
        <div style={{ marginTop: 4, color: '#f5222d', fontSize: 12, fontWeight: 600 }}>提醒：填写转账时使用的银行账户，否则可能会被驳回。</div>
        <div style={{ margin: '12px 0 4px', fontSize: 12, color: '#666' }}>附件图片（最多 5 张，支持 Ctrl+V 粘贴）：</div>
        <Space wrap size={8} align="start" style={{ outline: 'none' }} tabIndex={0}
          onPaste={e => pasteImagesTo(e, url => setReqImages(ls => (ls.length >= 5 ? ls : [...ls, url])))}>
          {reqImages.map((img, i) => (
            <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
              <AntdImage src={img} width={84} height={84} style={{ objectFit: 'cover', borderRadius: 4 }} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
                onClick={() => setReqImages(ls => ls.filter((_, j) => j !== i))} />
            </div>
          ))}
          {reqImages.length < 5 && (
            <ImageSlot size={84} tip="添加图片" onChange={v => { if (v) setReqImages(ls => (ls.length >= 5 ? ls : [...ls, v])); }} />
          )}
          <Button icon={<CopyOutlined />} onClick={pasteToReq}>粘贴剪切板</Button>
        </Space>
      </Modal>

      {/* 品牌素材下载：品牌方在自有品牌台账上传，授权书出具后开放 */}
      <Modal title={matsTitle} open={matsVisible} onCancel={() => setMatsVisible(false)} footer={null} width={560}>
        <Spin spinning={matsLoading}>
          {matsList.length ? (
            <List size="small" bordered dataSource={matsList}
              renderItem={m => (
                <List.Item actions={[
                  <Button key="dl" type="link" size="small" icon={<DownloadOutlined />}
                    onClick={() => { const a = document.createElement('a'); a.href = m.dataUrl; a.download = m.name; a.click(); }}>下载</Button>,
                ]}>
                  <List.Item.Meta
                    title={<span style={{ fontSize: 13 }}>{m.name}</span>}
                    description={<span style={{ fontSize: 12 }}>{m.mime || '附件'} · {fmtSize(m.size || 0)} · 上传于 {m.uploadedAt || '—'}</span>} />
                </List.Item>
              )} />
          ) : (!matsLoading && <Empty description="品牌方尚未上传该品牌的素材资料" />)}
        </Spin>
      </Modal>

      {/* 续签申请：说明文字 + 最多5张附件（可粘贴） */}
      <Modal title={`续签申请 - ${renewTarget?.brandName || ''}`} open={!!renewTarget} onCancel={() => setRenewTarget(null)} width={640}
        onOk={submitRenew} okText="提交续签申请" cancelText="取消">
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>授权到期前一个月起可发起续签；提交后品牌方授权书列显示"续签申请"，品牌方上传续签授权书后状态置为"续签成功"并更新有效期止。</div>
        <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>续签说明 / 备注文字：</div>
        <Input.TextArea rows={3} value={renewReason} onChange={e => setRenewReason(e.target.value)} maxLength={300} showCount
          placeholder="请填写续签原因、新授权期说明等（品牌方审核时查看）" />
        <div style={{ margin: '12px 0 4px', fontSize: 12, color: '#666' }}>附件图片（最多 5 张，支持 Ctrl+V 粘贴）：</div>
        <Space wrap size={8} align="start" style={{ outline: 'none' }} tabIndex={0}
          onPaste={e => pasteImagesTo(e, url => setRenewImages(ls => (ls.length >= 5 ? ls : [...ls, url])))}>
          {renewImages.map((img, i) => (
            <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
              <AntdImage src={img} width={84} height={84} style={{ objectFit: 'cover', borderRadius: 4 }} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
                onClick={() => setRenewImages(ls => ls.filter((_, j) => j !== i))} />
            </div>
          ))}
          {renewImages.length < 5 && (
            <ImageSlot size={84} tip="添加图片" onChange={v => { if (v) setRenewImages(ls => (ls.length >= 5 ? ls : [...ls, v])); }} />
          )}
          <Button icon={<CopyOutlined />} onClick={pasteToRenew}>粘贴剪切板</Button>
        </Space>
      </Modal>

      {/* 上传交易数据：年月/销售数量/销售额/店铺评分 + 最多5张凭证图（槽内粘贴） */}
      <Modal title={`上传交易数据 - ${salesTarget?.appNo || ''}`} open={!!salesTarget} onCancel={() => setSalesTarget(null)} width={640}
        onOk={submitSales} okText="提交" cancelText="取消">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 2×2 栅格：标签在上、控件满宽，上下行列对齐 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>年月</div>
              <DatePicker picker="month" allowClear={false} style={{ width: '100%' }} value={salesInputMonth} onChange={d => setSalesInputMonth(d)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>销售数量（件）</div>
              <InputNumber min={0} style={{ width: '100%' }} value={salesQty} onChange={v => setSalesQty(v)} placeholder="件" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>销售额（元）</div>
              <InputNumber min={0} style={{ width: '100%' }} value={salesAmount} onChange={v => setSalesAmount(v)} placeholder="元" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>店铺评分（0-5）</div>
              <InputNumber min={0} max={5} step={0.1} style={{ width: '100%' }} value={salesScore} onChange={v => setSalesScore(v)} placeholder="0-5" />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>交易凭证图片（最多 5 张）</div>
            <Space wrap size={8} style={{ outline: 'none' }} tabIndex={0}
              onPaste={e => pasteImagesTo(e, url => setSalesImages(ls => (ls.length >= 5 ? ls : [...ls, url])))}>
              {salesImages.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <AntdImage src={img} width={84} height={84} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />}
                    style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
                    onClick={() => setSalesImages(ls => ls.filter((_, j) => j !== i))} />
                </div>
              ))}
              {salesImages.length < 5 && (
                <ImageSlot size={84} tip="添加图片" onChange={v => { if (v) setSalesImages(ls => (ls.length >= 5 ? ls : [...ls, v])); }} />
              )}
              <Button icon={<CopyOutlined />} onClick={pasteToSales}>粘贴剪切板</Button>
            </Space>
          </div>
        </div>
      </Modal>

      {/* 销售数据详情（已提交点击看） */}
      <Modal title={`销售数据详情 - ${salesDetail?.month || ''}`} open={!!salesDetail} onCancel={() => setSalesDetail(null)} footer={[<Button key="close" onClick={() => setSalesDetail(null)}>关闭</Button>]} width={620}>
        {salesDetail && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="年月">{salesDetail.month}</Descriptions.Item>
            <Descriptions.Item label="提交时间">{salesDetail.submittedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="销售数量">{salesDetail.qty}</Descriptions.Item>
            <Descriptions.Item label="销售额">¥{salesDetail.amount}</Descriptions.Item>
            <Descriptions.Item label="店铺评分">{salesDetail.score || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺">{salesDetail.shopName || salesDetail.companyName || '—'}</Descriptions.Item>
            <Descriptions.Item label="凭证图片" span={2}>
              {salesDetail.images && salesDetail.images.length
                ? <Space wrap size={6}>{salesDetail.images.map((im, i) => <AntdImage key={i} src={im} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Space>
                : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 保证金退回详情：双方账户+截图，已退待确认时提供确认到账（触发记账） */}
      <Modal title={`保证金退回详情 - ${refundDetail?.req.brandCompany || refundDetail?.row.ownerCompany || ''}`} open={!!refundDetail}
        onCancel={() => setRefundDetail(null)} width={620}
        footer={[
          ...(refundDetail?.req.status === '已退回' ? [
            <Button key="ok" type="primary" onClick={() => refundDetail && confirmRefundRecv(refundDetail.req)}>确认到账</Button>,
          ] : []),
          <Button key="close" onClick={() => setRefundDetail(null)}>关闭</Button>,
        ]}>
        {refundDetail && (
          <Descriptions size="small" bordered column={1}>
            <Descriptions.Item label="退回金额">¥{refundDetail.req.amount || refundDetail.row.deposit || '—'}</Descriptions.Item>
            <Descriptions.Item label="申请时间">{refundDetail.req.requestedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="品牌方退回时间">{refundDetail.req.refundAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="代理商收款账户">{refundDetail.req.agentBank || '—'}</Descriptions.Item>
            <Descriptions.Item label="品牌方付款账户">{refundDetail.req.payBankName || '—'}</Descriptions.Item>
            {refundDetail.req.reason ? <Descriptions.Item label="申请原因">{refundDetail.req.reason}</Descriptions.Item> : null}
            <Descriptions.Item label="退款截图（品牌方回传）">
              {refundDetail.req.refundShot
                ? <AntdImage src={refundDetail.req.refundShot} width={90} height={90} style={{ objectFit: 'cover', borderRadius: 4 }} />
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {refundDetail.req.status === '已退回'
                ? <Tag color="orange" style={{ margin: 0 }}>已退待确认</Tag>
                : <Tag color="green" style={{ margin: 0 }}>已确认到账{refundDetail.req.confirmedAt ? `（${refundDetail.req.confirmedAt}）` : ''}</Tag>}
            </Descriptions.Item>
          </Descriptions>
        )}
        {refundDetail?.req.status === '已退回' && (
          <div style={{ marginTop: 10, color: '#f5222d', fontSize: 12, fontWeight: 600 }}>提醒：核对退款截图与收款账户无误后点击"确认到账"，系统将自动登记本方银行收入明细及账薄。</div>
        )}
      </Modal>

      {/* 申请编号点击：品牌授权申请全量字段信息 */}
      <Modal title={`申请详情 - ${appDetail?.appNo || ''}`} open={!!appDetail} onCancel={() => setAppDetail(null)} footer={null} width={860}>
        {appDetail && (
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="申请编号">{appDetail.appNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="申请时间">{appDetail.appliedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="品牌名称">{appDetail.brandName || '—'}</Descriptions.Item>
            <Descriptions.Item label="注册商标号">{appDetail.trademarkNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="开店公司">{appDetail.companyName || '—'}</Descriptions.Item>
            <Descriptions.Item label="纳税人识别码">{appDetail.taxpayerCode || '—'}</Descriptions.Item>
            <Descriptions.Item label="法人代表">{appDetail.legalPerson || '—'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{appDetail.phone || '—'}</Descriptions.Item>
            <Descriptions.Item label="经营地址" span={2}>{appDetail.address || '—'}</Descriptions.Item>
            <Descriptions.Item label="授权平台">{appDetail.platform || '—'}</Descriptions.Item>
            <Descriptions.Item label="授权平台网址">{appDetail.platformUrl || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺名称">{appDetail.shopName || '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺类型">{appDetail.shopType ? <span style={shopTypeStyle(appDetail.shopType)}>{appDetail.shopType}</span> : '—'}</Descriptions.Item>
            <Descriptions.Item label="店铺ID">{appDetail.shopId || '—'}</Descriptions.Item>
            <Descriptions.Item label="类目">{appDetail.category || '—'}</Descriptions.Item>
            <Descriptions.Item label="保证金">{appDetail.deposit ? `¥${appDetail.deposit}` : '—'}</Descriptions.Item>
            <Descriptions.Item label="付款银行账户" span={2}>{appDetail.payBank || '—'}</Descriptions.Item>
            <Descriptions.Item label="状态">{appDetail.status || '—'}</Descriptions.Item>
            <Descriptions.Item label="授权编号">{appDetail.authNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="有效期起">{appDetail.validFrom || '—'}</Descriptions.Item>
            <Descriptions.Item label="有效期止">{appDetail.validTo || '—'}</Descriptions.Item>
            <Descriptions.Item label="出具日期">{appDetail.issuedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="品牌方">{appDetail.ownerCompany || '—'}</Descriptions.Item>
            <Descriptions.Item label="附件图片" span={2}>
              <Space wrap size={8}>
                {([['保证金截图', appDetail.payShot], ['营业执照', appDetail.businessLicense], ['身份证正面', appDetail.idFront], ['身份证反面', appDetail.idBack], ['协议书', appDetail.agreementImage], ['授权书', appDetail.certImage]] as [string, string][])
                  .filter(([, v]) => !!v)
                  .map(([l, v]) => (
                    <div key={l} style={{ textAlign: 'center' }}>
                      <AntdImage src={v!} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />
                      <div style={{ fontSize: 12, color: '#888' }}>{l}</div>
                    </div>
                  ))}
                {!appDetail.payShot && !appDetail.businessLicense && !appDetail.idFront && !appDetail.idBack && !appDetail.agreementImage && !appDetail.certImage && <span style={{ color: '#ccc' }}>无附件</span>}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 重新申请：被驳回后编辑申请信息再次提交 */}
      <Modal title={`重新申请 - ${raTarget?.appNo || ''}`} open={!!raTarget} onCancel={() => setRaTarget(null)}
        onOk={submitReapply} okText="重新提交申请" cancelText="取消" width={640}>
        {raTarget && (
          <div>
            <div style={{ marginBottom: 10, padding: '6px 10px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4, color: '#f5222d', fontSize: 12 }}>
              驳回原因：{raTarget.rejectReason || '—'}{raTarget.rejectAt ? `（${raTarget.rejectAt}）` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
              <div><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>公司名称 *</div>
                <Input value={raFields.companyName} onChange={e => setRaFields(s => ({ ...s, companyName: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>法人代表</div>
                <Input value={raFields.legalPerson} onChange={e => setRaFields(s => ({ ...s, legalPerson: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>联系电话</div>
                <Input value={raFields.phone} onChange={e => setRaFields(s => ({ ...s, phone: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>店铺名称</div>
                <Input value={raFields.shopName} onChange={e => setRaFields(s => ({ ...s, shopName: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>授权平台</div>
                <Input value={raFields.platform} onChange={e => setRaFields(s => ({ ...s, platform: e.target.value }))} /></div>
              <div><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>授权平台网址</div>
                <Input value={raFields.platformUrl} onChange={e => setRaFields(s => ({ ...s, platformUrl: e.target.value }))} /></div>
              <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>经营地址</div>
                <Input value={raFields.address} onChange={e => setRaFields(s => ({ ...s, address: e.target.value }))} /></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default MyBrandCertsPage;
