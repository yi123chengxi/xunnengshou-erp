import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, Button, Card, Row, Col, message, Result, Descriptions, Spin, Typography, Select, Space, Modal, AutoComplete } from 'antd';
import { SafetyCertificateOutlined, BankOutlined, DownloadOutlined, FileProtectOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import ImageSlot from '../components/ImageSlot';
import {
  baKeys, genKey, genShareCode, genAppNo, todayIso, fetchPublicInfo, fetchOwnBrands, PubInfo, BrandApplication, publishAppMirror,
  fetchAgreement, substituteTokens, printHtml, SHOP_TYPES, shopTypeStyle,
} from '../utils/brandAuth';
import { fetchServerDataset } from '../utils/serverSync';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import { pushBankTransaction, isAccountingMode, writeAutoEntries } from '../utils/accountingBridge';
import { safeSetItem } from '../utils/storageQuota';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// 字段名 → 中文标签（校验未通过时提示缺填字段）
const FIELD_LABELS: Record<string, string> = {
  companyName: '公司名称', taxpayerCode: '纳税人识别码', legalPerson: '法人代表', phone: '联系电话',
  address: '经营地址', province: '省份', city: '城市', district: '县区', shopName: '店铺名称', platform: '授权平台', platformUrl: '授权平台网址', deposit: '保证金',
  brandName: '申请品牌', payShot: '付款截图', businessLicense: '营业执照', idFront: '身份证正面', idBack: '身份证反面', agreementImage: '协议书', shopId: '店铺ID', shopType: '店铺类型', payBank: '付款银行账户',
};

/**
 * 外部品牌授权申请页（无需登录）
 * 路由 /brand-apply/:code，code 为品牌方公司编号（不暴露登录账号；兼容旧链接直传账号）
 * 解析后写入 brandauth_apps_<品牌方账号>，经服务端并集合并进入品牌方"自有品牌"列表
 */
const BrandApplyPage: React.FC = () => {
  const { code = '' } = useParams();
  // 公司编号/简称 → 品牌方登录账号（旧链接直传账号时原样兼容）
  const owner = useMemo(() => {
    const p = String(code || '').trim();
    if (!p) return '';
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const byNo = users.find(u => (u.companyNo || u.companyShortName) === p);
      if (byNo) return byNo.username;
      const byName = users.find(u => u.username === p);
      return byName ? byName.username : p;
    } catch { return p; }
  }, [code]);
  // 邀请链接绑定负责人：?pic=<子账号>，提交时自动写入申请负责人（子账号姓名）
  const picName = useMemo(() => {
    const pic = new URLSearchParams(window.location.search).get('pic') || '';
    if (!pic) return '';
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find(x => x.username === pic);
      return u ? (u.displayName || u.contactPerson || u.name || u.username) : pic;
    } catch { return pic; }
  }, []);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pub, setPub] = useState<PubInfo | null>(null);
  const [done, setDone] = useState(false);
  const [form] = Form.useForm();
  const provV = Form.useWatch('province', form);
  const cityV = Form.useWatch('city', form);
  // 本浏览器已登录软件时自动显示对应账号（提交后申请镜像至该账号后台）
  const [me, setMe] = useState<{ username: string; companyName: string; roleLabel: string } | null>(null);
  // 本浏览器登录账号的 owner（子账号归父）与其银行账户列表（付款银行账户选择源）
  const [meOwner, setMeOwner] = useState('');
  const [myBankAccounts, setMyBankAccounts] = useState<any[]>([]);
  const [payBankNo, setPayBankNo] = useState('');
  // 品牌方发布的协议书文档（查看/下载）
  const [agrDoc, setAgrDoc] = useState<{ html: string; updatedAt: string } | null>(null);
  const [agrView, setAgrView] = useState(false);
  // 协议书生成门控：表单必填填写完整并点"生成协议书"后才可下载
  const [agrReady, setAgrReady] = useState(false);
  const [agrRendered, setAgrRendered] = useState('');
  useEffect(() => {
    const username = localStorage.getItem('username') || '';
    if (!username) { setMe(null); setMeOwner(''); setMyBankAccounts([]); return; }
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    const accOwner = isSub ? (localStorage.getItem('parentAccount') || username) : username;
    setMeOwner(accOwner);
    try { setMyBankAccounts(JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${accOwner}`) || '[]')); } catch { setMyBankAccounts([]); }
    const role = localStorage.getItem('userRole') || '';
    let companyName = '';
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      companyName = users.find(u => u.username === username)?.companyName || '';
    } catch { /* ignore */ }
    const roleLabel = role === 'both' ? '供应商兼采购商账号' : role.includes('purchaser') ? '采购商账号' : role.includes('factory') ? '加工厂账号' : role.includes('supplier') ? '供应商账号' : '软件账号';
    setMe({ username, companyName, roleLabel });
  }, [done]);

  useEffect(() => {
    (async () => {
      // 并行拉取公开信息与自有品牌台账；申请品牌选项以台账为真值源（避免 pub 镜像滞后缺 brands）
      const [info, ledger] = await Promise.all([fetchPublicInfo(owner), fetchOwnBrands(owner)]);
      fetchAgreement(owner).then(setAgrDoc).catch(() => { /* ignore */ });
      setPub({
        companyName: info?.companyName || '',
        recv: info?.recv || { accountName: '', bankName: '', branchName: '', bankAccountNo: '', note: '' },
        brands: ledger.length ? ledger : (info?.brands || []),
      });
      setLoading(false);
    })();
  }, [owner]);

  // 顶部信息栏：左软件名称，右本浏览器登录的软件账号
  const topBar = (
    <div style={{ background: PRIMARY, color: '#fff', padding: '8px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <Space size={8}>
        <SafetyCertificateOutlined />
        <span style={{ fontWeight: 700 }}>讯能手 ERP 管理系统</span>
        <span style={{ opacity: 0.85, fontSize: 12 }}>品牌授权申请平台 · 代理商/分销商在线申请</span>
      </Space>
      <span style={{ fontSize: 12, opacity: 0.95 }}>
        {me
          ? `已登录：${me.companyName || me.username}（${me.username}）· ${me.roleLabel} · 提交后可在“品牌管理-我的授权书”查看进度与授权书`
          : '未登录软件账号 · 本浏览器若已登录讯能手将自动显示并关联对应账号'}
      </span>
    </div>
  );

  // 未登录软件账号：注册入口 + 提示
  const regBanner = !me ? (
    <div style={{ maxWidth: 760, margin: '12px auto 0', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#0958d9' }}>
        还没有软件账号？注册账号并登录后提交申请，可在“品牌管理-我的授权书”查看进度与授权书；本浏览器已登录时将自动关联
      </span>
      <Button size="large" type="primary" style={{ color: '#fff', fontWeight: 600, fontSize: 15, padding: '0 28px', height: 40 }} onClick={() => navigate('/register')}>注册账号</Button>
    </div>
  ) : null;

  // 邀请链接绑定负责人提示（提交后自动登记）
  const picBanner = picName ? (
    <div style={{ maxWidth: 760, margin: '12px auto 0', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#389e0d' }}>
      本链接已绑定负责人：{picName} —— 提交后申请的负责人将自动登记为该负责人
    </div>
  ) : null;

  const submit = () => {
    form.validateFields().then(async v => {
      const appsKey = baKeys(owner).apps;
      // 先读本地再与服务端按 key 并集合并：服务端不可用时也不丢历史申请
      let existing: BrandApplication[] = [];
      try {
        const local = JSON.parse(localStorage.getItem(appsKey) || '[]');
        if (Array.isArray(local)) existing = local;
      } catch { /* ignore */ }
      try {
        const rec = await fetchServerDataset(appsKey);
        if (rec && rec.json) {
          const arr = JSON.parse(rec.json);
          if (Array.isArray(arr)) arr.forEach((r: BrandApplication) => {
            if (r && r.key && !existing.some(x => x.key === r.key)) existing.push(r);
          });
        }
      } catch { /* ignore */ }
      // 若代理商当前已登录采购商账号，自动绑定以便其后台直接查看授权书（子账号归父账号）
      const isSub = localStorage.getItem('isSubAccount') === 'true';
      const meAcc = isSub
        ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '')
        : (localStorage.getItem('username') || '');
      const meRole = localStorage.getItem('userRole') || '';
      // 'both'（供应商兼采购商）同样具备采购商身份，提交后镜像至其后台
      const agentUsername = meAcc && (meRole === 'both' || meRole.includes('purchaser')) ? meAcc : '';
      const selBrand = (pub?.brands || []).find(b => b.brandName === v.brandName);
      const app: BrandApplication = {
        key: genKey('BA'),
        companyName: v.companyName?.trim() || '', taxpayerCode: v.taxpayerCode?.trim() || '',
        legalPerson: v.legalPerson?.trim() || '', address: [v.province, v.city, v.district, v.address?.trim()].filter(Boolean).join(''),
        province: v.province || '', city: v.city || '', district: v.district || '',
        phone: v.phone?.trim() || '', platform: v.platform?.trim() || '', platformUrl: v.platformUrl?.trim() || '',
        deposit: String(v.deposit ?? ''), payShot: v.payShot || '', businessLicense: v.businessLicense || '',
        idFront: v.idFront || '', idBack: v.idBack || '', agreementImage: v.agreementImage || '',
        shopId: v.shopId?.trim() || '', shopType: v.shopType || '',
        payBank: v.payBank || '', payBankNo,
        personInCharge: picName,
        recvSnapshot: pub ? [pub.recv.accountName, pub.recv.bankName, pub.recv.branchName, pub.recv.bankAccountNo].filter(Boolean).join(' / ') : '',
        status: '待确认', appliedAt: todayIso(), appNo: genAppNo(existing), authNo: '', confirmedAt: '',
        shareCode: genShareCode(), agentUsername,
        brandName: v.brandName || '', trademarkNo: selBrand?.trademarkNo || '', category: selBrand?.category || '', shopName: v.shopName?.trim() || '', validFrom: '', validTo: '',
        certHtml: '', certAt: '', remark: '',
      };
      try {
        const appJson = JSON.stringify([...existing, app]);
        const saved1 = safeSetItem(appsKey, appJson);
        if (!saved1) { message.warning('申请数据过大（图片过多），已尝试清理空间后重试仍失败，请减少上传图片后重试'); return; }
        publishAppMirror(app, pub?.companyName || '', owner);
      
        // 自动在品牌方"收/付申请"中创建收款确认单（品牌方在收款确认 Tab 确认到账）
        try {
          const prKey = `payment_requests_${owner}`;
          const prList: any[] = JSON.parse(localStorage.getItem(prKey) || '[]');
          const receiptKey = `recvreq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const skPrefix = `SK${dayjs().format('YYYYMMDD')}`;
          const skSeq = prList.filter((r: any) => r.requestNo?.startsWith(skPrefix)).length + 1;
          const receiptRec: any = {
            key: receiptKey,
            requestNo: `${skPrefix}${String(skSeq).padStart(3, '0')}`,
            amount: Number(app.deposit) || 0,
            category: '收款',
            description: `品牌授权保证金 — ${app.companyName}`,
            recvType: 'bank',
            recvAccountName: app.companyName,
            source: 'manual',
            status: 'pending_confirm',
            recordType: 'receipt',
            payerName: app.companyName,
            brandAppKey: app.key,
            applicant: '',
            applicantName: app.legalPerson || app.companyName,
            applyDate: todayIso(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          safeSetItem(prKey, JSON.stringify([receiptRec, ...prList]));
          // 将收款确认单 key 回写到申请单
          app.depositReceiptKey = receiptKey;
          const saved2 = safeSetItem(appsKey, JSON.stringify([...existing, app]));
          if (!saved2) { message.warning('申请已提交，但回写收款关联时空间不足，请到自有品牌页面手动编辑补充'); }
        } catch { /* ignore receipt creation errors */ }

        // 付款银行账户记账联动：选了本登录账号银行列表中的账户才记（手输无匹配忽略）
        const payAmt = Number(app.deposit) || 0;
        if (meOwner && payBankNo && payAmt > 0) {
          const acc = myBankAccounts.find((b: any) => (b.bankAccountNo || '') === payBankNo);
          const accName = acc ? (acc.name || acc.shortName || '') : '';
          if (accName) {
            const person = me?.companyName || me?.username || '';
            pushBankTransaction(meOwner, accName, 'out', payAmt, `品牌授权保证金缴纳 — ${pub?.companyName || ''}`, person);
            if (isAccountingMode(meOwner)) {
              writeAutoEntries(meOwner, {
                sourceKey: `ba-depositpay-${app.key}`, debitSubject: '其他应收款', creditSubject: '银行存款',
                amount: payAmt, summary: `品牌授权保证金${pub?.companyName || ''}`, date: todayIso(),
                bookkeeper: person, auditor: person,
              });
            } else {
              writeDailyBook(`bk-depositpay-${app.key}`, '支出', payAmt, pub?.companyName || '', `品牌授权保证金缴纳 — ${pub?.companyName || ''}`, accName, acc?.bankName || '', v.payShot || '');
            }
          }
        }
        // 通知同浏览器内自有品牌页面刷新申请列表
        window.dispatchEvent(new Event('sync-data-updated'));
        setDone(true);
      } catch { message.error('提交失败，请重试'); }
    }).catch((err: any) => {
      // 校验未通过：提示具体缺填字段，避免未捕获 rejection 弹出运行时报错遮罩
      const names = (err?.errorFields || [])
        .map((f: any) => FIELD_LABELS[String(f?.name?.[0] ?? '')] || String(f?.name?.[0] ?? ''))
        .filter(Boolean);
      const uniq = Array.from(new Set(names));
      message.error(uniq.length ? `请先填写以下字段：${uniq.join('、')}` : '请先填写必填字段');
    });
  };

  // 银行账户值串（选项 value 与反查共用同一拼接公式）
  const composeBankValue = (b: any): string =>
    [b.name || b.shortName || '', b.bankName || '', b.branchName || '', b.bankAccountNo || ''].filter(Boolean).join(' / ');
  // 简易账薄-日常记账登记（幂等键写入前先过滤同键旧记录，凭证号按当日 PZ 递增）
  const writeDailyBook = (bookKey: string, type: '收入' | '支出', amount: number, counterparty: string, remark: string, accountName: string, bankName: string, image: string) => {
    if (!meOwner) return;
    try {
      const bkKey = `daily_bookkeeping_${meOwner}`;
      const bkList: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const cleaned = bkList.filter((b: any) => b.key !== bookKey);
      const today = todayIso();
      const prefix = `PZ-${today.replace(/-/g, '')}`;
      const seqs = cleaned.map((b: any) => String(b.voucherNo || '')).filter((v: string) => v.startsWith(prefix)).map((v: string) => parseInt(v.slice(-3), 10) || 0);
      const person = me?.companyName || me?.username || '';
      const rec = {
        key: bookKey, voucherNo: `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`,
        bookDate: today, bookType: type, category: type === '收入' ? '其他业务收入-其他收入' : '财务费用-其他支出',
        amount, counterparty, remark, person,
        recvAccount: type === '收入' ? accountName : '', recvBank: type === '收入' ? bankName : '',
        payAccount: type === '支出' ? accountName : '', payBank: type === '支出' ? bankName : '',
        image: image || '', isPersonalAdvance: false, isReturn: false, advanceRecvAccount: '',
        linkedReimbursementKey: '', department: '', auditor: person, cashier: person,
        createdAt: new Date().toISOString(), autoSourceKey: bookKey,
      };
      localStorage.setItem(bkKey, JSON.stringify([rec, ...cleaned]));
    } catch { /* ignore */ }
  };

  // 协议书渲染取值：品牌方公开信息 + 表单已填字段；未填占位符替换为下划线供打印手填
  const agrValues = (): Record<string, string> => {
    const v = form.getFieldsValue();
    const selBrand = (pub?.brands || []).find(b => b.brandName === v.brandName);
    return {
      品牌方公司: pub?.companyName || '', 品牌名称: v.brandName || '', 注册商标号: selBrand?.trademarkNo || '', 商标号: selBrand?.trademarkNo || '',
      类目: selBrand?.category || '', 授权方: v.legalPerson || '', 信用代码: v.taxpayerCode || '', 公司名称: v.companyName || '',
      纳税人识别码: v.taxpayerCode || '', 法人代表: v.legalPerson || '',
      经营地址: [v.province, v.city, v.district, v.address].filter(Boolean).join(''),
      授权平台: v.platform || '', 授权平台网址: v.platformUrl || '', 店铺名称: v.shopName || '', 店铺账号: v.shopId || '', 店铺ID: v.shopId || '', 店铺类型: v.shopType || '', 保证金: v.deposit || '', 年费: '',
      联系人: v.legalPerson || '', 联系电话: v.phone || '', 授权日期: todayIso(),
      // 落款公司优先取所选品牌在自有品牌台账中维护的落款公司（与授权书生成同源），未维护时回退品牌方公司名
      落款公司: (selBrand?.signCompany || '').trim() || pub?.companyName || '', 落款日期: todayIso(),
    };
  };
  const renderAgrHtml = (): string =>
    (agrReady && agrRendered) ? agrRendered
      : substituteTokens(agrDoc?.html || '', agrValues()).replace(/\{[^{}]+\}/g, '＿＿＿＿＿＿＿＿');
  // 生成协议书：先校验表单必填是否填写完整，完整才生成；生成后开放下载
  const genAgr = () => {
    if (!agrDoc) { message.warning('品牌方尚未发布协议书模版'); return; }
    form.validateFields().then(() => {
      setAgrRendered(substituteTokens(agrDoc.html || '', agrValues()).replace(/\{[^{}]+\}/g, '＿＿＿＿＿＿＿＿'));
      setAgrReady(true);
      message.success('协议书已生成，可查看并下载');
    }).catch((err: any) => {
      const names = (err?.errorFields || [])
        .map((f: any) => FIELD_LABELS[String(f?.name?.[0] ?? '')] || String(f?.name?.[0] ?? ''))
        .filter(Boolean);
      const uniq = Array.from(new Set(names));
      message.error(uniq.length ? `请填写完整以下字段后再生成协议书：${uniq.join('、')}` : '请填写完整必填字段后再生成协议书');
    });
  };
  const downloadAgr = () => {
    if (!agrDoc) return;
    if (!agrReady) { message.warning('请先点击"生成协议书"，生成成功后再下载'); return; }
    // Word 兼容 HTML（Office XML 命名空间 + A4 页面设置），存为 .doc 可直接用 Word 打开编辑
    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8" /><title>协议书</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Encoding>UTF-8</w:Encoding></w:WordDocument></xml><![endif]-->
<style>@page { size: A4; margin: 2cm 2.4cm; } body { font-family: SimSun, 'Songti SC', serif; font-size: 15px; line-height: 2; }</style>
</head><body>${renderAgrHtml()}</body></html>`;
    const blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `协议书-${pub?.companyName || '品牌方'}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success('协议书已下载（Word 格式），请打印签署后拍照上传');
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" tip="加载中..." /></div>;

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        {topBar}
        <div style={{ padding: 24 }}>
        {regBanner}
        {picBanner}
        <Card style={{ maxWidth: 640, margin: '40px auto' }}>
          <Result status="success" title="申请已提交" subTitle="品牌方将在确认保证金到账后生成授权编号并出具授权书，请保持电话畅通。" />
          <div style={{ textAlign: 'center' }}>
            <Button type="primary" onClick={() => { setDone(false); form.resetFields(); setPayBankNo(''); }}>再提交一份</Button>
          </div>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      {topBar}
      <div style={{ padding: 24 }}>
      {regBanner}
      {picBanner}
      <Card style={{ maxWidth: 760, margin: '24px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <SafetyCertificateOutlined style={{ fontSize: 36, color: PRIMARY }} />
          <Title level={3} style={{ margin: '8px 0 0', color: PRIMARY }}>品牌授权申请</Title>
          <Text type="secondary">{pub?.companyName || '品牌方'} · 代理商/分销商在线申请品牌授权</Text>
        </div>

        {pub && (pub.recv.accountName || pub.recv.bankAccountNo) && (
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}
            title={<span><BankOutlined /> 品牌方收款账户（请向以下账户缴纳保证金）</span>}>
            <Descriptions.Item label="户名">{pub.recv.accountName || '—'}</Descriptions.Item>
            <Descriptions.Item label="开户银行">{[pub.recv.bankName, pub.recv.branchName].filter(Boolean).join(' ') || '—'}</Descriptions.Item>
            <Descriptions.Item label="银行账号">{pub.recv.bankAccountNo || '—'}</Descriptions.Item>
            {pub.recv.note && <Descriptions.Item label="收款说明">{pub.recv.note}</Descriptions.Item>}
          </Descriptions>
        )}
        {!(pub && (pub.recv.accountName || pub.recv.bankAccountNo)) && (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffe7ba', borderRadius: 6, color: '#ad6800', fontSize: 12 }}>
            <BankOutlined /> 品牌方收款账户：品牌方尚未公开收款银行账户，请先联系品牌方获取后再缴纳保证金。
          </div>
        )}

        {agrDoc ? (
          <Card size="small" style={{ marginBottom: 16 }}
            title={<span><FileProtectOutlined style={{ marginRight: 6 }} />协议书（线上专卖店销售保证书）</span>}
            extra={<Space size={8}><Button size="small" onClick={() => setAgrView(true)}>查看</Button><Button size="small" type="primary" icon={<FileProtectOutlined />} onClick={genAgr}>生成协议书</Button><Button size="small" icon={<DownloadOutlined />} disabled={!agrReady} title={agrReady ? '下载已生成的协议书（Word 格式）' : '请先点击"生成协议书"后再下载'} onClick={downloadAgr}>下载协议书</Button></Space>}>
            <Text type="secondary" style={{ fontSize: 12 }}>表单填写完整后点"生成协议书"，生成后方可下载；请打印、签署盖章后拍照，并在下方"协议书"上传窗口提交；品牌方更新于 {agrDoc.updatedAt || '—'}</Text>
            <div style={{ marginTop: 4, color: '#f5222d', fontSize: 12, fontWeight: 600 }}>提醒：协议书打印前请调整页边距，尽量打印在一张A4纸上。</div>
          </Card>
        ) : (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, color: '#888', fontSize: 12 }}>
            <FileProtectOutlined /> 协议书：品牌方尚未发布协议书模版，如需签署请联系品牌方。
          </div>
        )}

        <Form form={form} layout="vertical" onValuesChange={() => { setAgrReady(false); setAgrRendered(''); }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '必填' }]}><Input placeholder="营业执照上的公司名称" /></Form.Item></Col>
            <Col span={12}><Form.Item name="taxpayerCode" label="纳税人识别码" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="legalPerson" label="法人代表" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="phone" label="联系电话" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="payBank" label="付款银行账户">
                <AutoComplete placeholder="选择或手动填写付款银行账户（非必填）" allowClear
                  options={myBankAccounts.map((b: any) => ({ value: composeBankValue(b) }))}
                  onSelect={(v: string) => {
                    const hit = myBankAccounts.find((b: any) => composeBankValue(b) === v);
                    setPayBankNo(hit?.bankAccountNo || '');
                  }}
                  onChange={(v: string) => {
                    const hit = myBankAccounts.find((b: any) => composeBankValue(b) === v || (v && (b.bankAccountNo || '') === v));
                    setPayBankNo(hit?.bankAccountNo || '');
                  }} />
              </Form.Item>
            </Col>
            <Col span={6}><Form.Item name="province" label="省份" rules={[{ required: true, message: '必选' }]}><Select placeholder="省份" allowClear showSearch options={getProvinceOptions()} onChange={() => form.setFieldsValue({ city: undefined, district: undefined })} /></Form.Item></Col>
            <Col span={6}><Form.Item name="city" label="城市" rules={[{ required: true, message: '必选' }]}><Select placeholder="城市" allowClear showSearch options={getCityOptions(provV)} onChange={() => form.setFieldsValue({ district: undefined })} /></Form.Item></Col>
            <Col span={6}><Form.Item name="district" label="县区" rules={[{ required: true, message: '必选' }]}><Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(provV, cityV)} /></Form.Item></Col>
            <Col span={6}><Form.Item name="address" label="经营地址（详细）" rules={[{ required: true, message: '必填' }]}><Input placeholder="街道、门牌号等" /></Form.Item></Col>
            <Col span={6}><Form.Item name="shopName" label="店铺名称" rules={[{ required: true, message: '必填' }]}><Input placeholder="授权平台上的店铺名称" /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="shopType" label="店铺类型">
                <Select placeholder="选择店铺类型" allowClear
                  options={SHOP_TYPES.map(t => ({ value: t, label: <span style={shopTypeStyle(t)}>{t}</span> }))} />
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="shopId" label="店铺ID"><Input placeholder="平台店铺账号名/ID" /></Form.Item></Col>
            <Col span={12}><Form.Item name="platform" label="授权平台" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 抖音/拼多多/快手" /></Form.Item></Col>
            <Col span={12}><Form.Item name="platformUrl" label="授权平台网址"><Input placeholder="店铺或平台链接" /></Form.Item></Col>
            <Col span={12}><Form.Item name="deposit" label="保证金（元）" rules={[{ required: true, message: '必填' }]}><Input placeholder="缴纳金额" /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="brandName" label="申请品牌" rules={[{ required: true, message: '请选择申请品牌' }]}>
                <Select placeholder="选择要申请授权的品牌" allowClear
                  options={(pub?.brands || []).map(b => ({ value: b.brandName, label: b.trademarkNo ? `${b.brandName}（商标号 ${b.trademarkNo}）` : b.brandName }))}
                  notFoundContent="品牌方尚未维护自有品牌台账" />
              </Form.Item>
            </Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}>
              <Form.Item name="payShot" label="付款截图" rules={[{ required: true, message: '请上传付款截图' }]}>
                <ImageSlot size={84} tip="付款截图" />
              </Form.Item>
            </Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}>
              <Form.Item name="businessLicense" label="营业执照" rules={[{ required: true, message: '请上传营业执照' }]}>
                <ImageSlot size={84} tip="营业执照" />
              </Form.Item>
            </Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}>
              <Form.Item name="idFront" label="身份证正面" rules={[{ required: true, message: '请上传身份证正面' }]}>
                <ImageSlot size={84} tip="身份证正面" />
              </Form.Item>
            </Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}>
              <Form.Item name="idBack" label="身份证反面" rules={[{ required: true, message: '请上传身份证反面' }]}>
                <ImageSlot size={84} tip="身份证反面" />
              </Form.Item>
            </Col>
            <Col flex="1 1 0" style={{ minWidth: 0 }}>
              <Form.Item name="agreementImage" label="协议书（签署后）">
                <ImageSlot size={84} tip="协议书" />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" size="large" block onClick={submit}>提交申请</Button>
        </Form>
      </Card>

      {/* 协议书查看/打印 */}
      <Modal title="协议书 - 查看与打印" open={agrView} onCancel={() => setAgrView(false)} width={860}
        footer={[
          <Button key="dl" icon={<DownloadOutlined />} onClick={downloadAgr}>下载</Button>,
          <Button key="print" type="primary" onClick={() => printHtml(`<div style="font-family:SimSun,'Songti SC',serif;font-size:15px;line-height:2;padding:24px 36px">${renderAgrHtml()}</div>`)}>打印</Button>,
          <Button key="close" onClick={() => setAgrView(false)}>关闭</Button>,
        ]}>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '24px 32px', maxHeight: '60vh', overflow: 'auto', background: '#fff', fontFamily: 'SimSun, "Songti SC", serif', fontSize: 15, lineHeight: 2 }}
          dangerouslySetInnerHTML={{ __html: renderAgrHtml() }} />
      </Modal>
      </div>
    </div>
  );
};

export default BrandApplyPage;
