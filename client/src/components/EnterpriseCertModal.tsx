/**
 * 企业认证弹窗 + 认证徽章（服务端权威，三要素核验 + 法人活体刷脸）
 *
 * - 弹窗：企业名称（锁定预填）+ 统一社会信用代码 + 法人姓名 + 法人身份证号 → POST /api/enterprise/verify；
 *   三要素通过后进入刷脸步骤：POST /face/init 拿 CertifyId+CertifyUrl → antd QRCode 展示二维码；
 *   法人手机扫码完成刷脸后，前端每 3 秒轮询 /face/describe（DescribeFaceVerify），Passed=T 自动完成认证；
 *   已认证时展示状态面板（掩码信用代码/身份证、认证时间、最近巡检时间）。
 * - CertBadge：对账单/列表客户名称后的认证标识；无认证记录渲染 null。
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Modal, Form, Input, Button, Tag, Tooltip, Descriptions, message, Space, Alert, QRCode } from 'antd';
import { SafetyCertificateOutlined, ReloadOutlined, EditOutlined, ArrowLeftOutlined, LockOutlined, QrcodeOutlined } from '@ant-design/icons';

import { API_BASE } from '../utils/apiBase';
export const ENTERPRISE_API_BASE = API_BASE;

/** 加载阿里云实人认证 H5 SDK 并获取 MetaInfo（官方要求：不传真实 MetaInfo 则 InitFaceVerify 不返回 CertifyUrl） */
const getCloudauthMetaInfo = (): Promise<string> => new Promise(resolve => {
  const w = window as any;
  let settled = false;
  const finish = (v: string) => { if (!settled) { settled = true; resolve(v); } };
  const done = () => {
    try {
      if (typeof w.getMetaInfo === 'function') {
        // SDK 返回的是对象而非字符串：直传会被序列化成 "[object Object]"，被阿里云拒为 401 参数非法(metaInfo)
        const raw = w.getMetaInfo();
        const mi = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
        if (mi && mi !== '{}') { finish(mi); return; }
      }
    } catch { /* ignore */ }
    finish('');
  };
  // 全局超时兜底：SDK 加载异常/事件丢失时避免 Promise 悬挂导致刷脸按钮永久 loading
  setTimeout(() => finish(''), 8000);
  if (typeof w.getMetaInfo === 'function') { done(); return; }
  const existing = document.getElementById('cloudauth-jsvm') as HTMLScriptElement | null;
  if (existing) {
    // 历史加载失败的 script 元素不会重发 error 事件，靠超时兜底；加载中则等事件
    if (existing.dataset.loaded === '1') { done(); return; }
    existing.addEventListener('load', () => { existing.dataset.loaded = '1'; done(); });
    existing.addEventListener('error', () => finish(''));
    return;
  }
  const s = document.createElement('script');
  s.id = 'cloudauth-jsvm';
  s.src = 'https://o.alicdn.com/yd-cloudauth/cloudauth-cdn/jsvm_all.js';
  s.onload = () => { s.dataset.loaded = '1'; done(); };
  s.onerror = () => finish('');
  document.head.appendChild(s);
});

export interface CertInfo {
  username: string;
  status: 'certified' | 'abnormal' | 'revoked' | 'pending' | string;
  companyName: string;
  creditCodeMasked: string;
  legalPerson: string;
  idCardMasked?: string;
  verifiedAt: string;
  lastCheckAt: string;
  checkResult: string;
  failReason: string;
}

/** 认证徽章：certified 绿 / abnormal 橙 / revoked 灰；无记录不渲染 */
export const CertBadge: React.FC<{ info?: CertInfo | null; showUncertified?: boolean }> = ({ info, showUncertified }) => {
  if (!info) {
    if (!showUncertified) return null;
    return <Tag style={{ marginLeft: 6, fontSize: 11 }}>未认证</Tag>;
  }
  if (info.status === 'certified') {
    return (
      <Tooltip title={`企业认证通过：${(info.verifiedAt || '').slice(0, 10)}${info.lastCheckAt ? `；最近巡检 ${(info.lastCheckAt || '').slice(0, 10)}` : ''}`}>
        <Tag color="success" style={{ marginLeft: 6, fontSize: 11 }} icon={<SafetyCertificateOutlined />}>已认证</Tag>
      </Tooltip>
    );
  }
  if (info.status === 'abnormal') {
    return (
      <Tooltip title={`认证异常：${info.failReason || '工商信息已变更，请重新认证'}`}>
        <Tag color="warning" style={{ marginLeft: 6, fontSize: 11 }}>认证异常</Tag>
      </Tooltip>
    );
  }
  if (info.status === 'pending') {
    return (
      <Tooltip title="三要素核验已通过，等待法人本人刷脸认证">
        <Tag color="processing" style={{ marginLeft: 6, fontSize: 11 }} icon={<QrcodeOutlined />}>待刷脸</Tag>
      </Tooltip>
    );
  }
  return <Tag style={{ marginLeft: 6, fontSize: 11 }}>认证已撤销</Tag>;
};

/** 批量查询认证状态（对账单/列表徽章用） */
export async function fetchCertBatch(usernames: string[]): Promise<Record<string, CertInfo>> {
  const list = Array.from(new Set(usernames.map(x => String(x || '').trim()).filter(Boolean)));
  if (!list.length) return {};
  try {
    const res = await fetch(`${ENTERPRISE_API_BASE}/enterprise/status-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: list }),
    });
    const j = await res.json();
    return (j.code === 0 && j.data?.map) ? j.data.map : {};
  } catch { return {}; }
}

export async function fetchCertStatus(username: string): Promise<CertInfo | null> {
  if (!username) return null;
  try {
    const res = await fetch(`${ENTERPRISE_API_BASE}/enterprise/status?username=${encodeURIComponent(username)}`);
    const j = await res.json();
    return j.code === 0 ? (j.data || null) : null;
  } catch { return null; }
}

const EnterpriseCertModal: React.FC<{ open: boolean; onClose: () => void; onCertChanged?: () => void }> = ({ open, onClose, onCertChanged }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<CertInfo | null>(null);
  const [reCertMode, setReCertMode] = useState(false);
  // 刷脸步骤状态机：form → face（展示二维码+轮询）→ 成功后回 form（已认证面板）
  const [step, setStep] = useState<'form' | 'face'>('form');
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceInfo, setFaceInfo] = useState<{ certifyId: string; certifyUrl: string; devMode?: boolean } | null>(null);
  const [faceResult, setFaceResult] = useState<{ passed: boolean; message: string } | null>(null);
  const faceRef = useRef<{ certifyId: string; certifyUrl: string; devMode?: boolean } | null>(null);
  const username = useMemo(() => localStorage.getItem('username') || '', []);
  const profile = useMemo(() => {
    try {
      const list: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return list.find((u: any) => u.username === username) || {};
    } catch { return {}; }
  }, [username, open]);

  const loadStatus = useCallback(async () => {
    const s = await fetchCertStatus(username);
    setInfo(s);
    return s;
  }, [username]);

  useEffect(() => {
    if (!open) {
      setReCertMode(false);
      setStep('form'); setFaceInfo(null); setFaceResult(null); faceRef.current = null;
      return;
    }
    void loadStatus();
    form.setFieldsValue({
      companyName: profile.companyName || '',
      creditCode: profile.companyNo || '',
      legalPerson: profile.legalPerson || profile.contactPerson || '',
      idCard: '',
    });
  }, [open]);

  /** 刷脸通过后的统一收尾：更新状态面板 + 通知外部刷新徽章 */
  const finishFacePass = useCallback((cert: CertInfo) => {
    faceRef.current = null;
    setInfo(cert);
    setFaceInfo(null);
    setFaceResult(null);
    setStep('form');
    setReCertMode(false);
    message.success('法人刷脸认证通过，企业认证完成');
    onCertChanged?.();
  }, [onCertChanged]);

  // 刷脸轮询：face 步骤下每 3 秒查询一次结果；未通过时静默继续等（用户可能尚未刷脸）
  useEffect(() => {
    if (step !== 'face' || !faceInfo) return;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || !faceRef.current) return;
      try {
        const res = await fetch(`${ENTERPRISE_API_BASE}/enterprise/face/describe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, certifyId: faceRef.current.certifyId }),
        });
        const j = await res.json();
        if (j.code === 0 && j.data?.passed) {
          if (!stopped && faceRef.current) finishFacePass(j.data.cert);
          stopped = true;
          clearInterval(timer);
        }
        // 未通过（未完成/未扫码）：静默继续轮询，失败反馈由「我已完成刷脸」手动查询给出
      } catch { /* 网络抖动忽略，下一轮重试 */ }
    }, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [step, faceInfo, username, finishFacePass]);

  /** 发起刷脸：拿 CertifyId+CertifyUrl 并展示二维码（10 分钟内服务端复用同一 CertifyId，防重复计费） */
  const startFaceInit = async (force = false) => {
    setFaceLoading(true);
    setFaceResult(null);
    try {
      // 实时获取 MetaInfo（随浏览器/设备变化，官方禁止硬编码）
      const metaInfo = await getCloudauthMetaInfo();
      // 空 MetaInfo 会被阿里云拒为 401 参数非法(metaInfo)：前端先拦截并给出可操作提示，不打服务端
      if (!metaInfo || !metaInfo.startsWith('{')) {
        message.error('阿里云刷脸组件加载失败（MetaInfo 为空）：请检查网络后刷新页面重试，仍失败请改用 Chrome/Edge 浏览器或以 HTTPS 访问');
        setFaceLoading(false);
        return;
      }
      const res = await fetch(`${ENTERPRISE_API_BASE}/enterprise/face/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, metaInfo }),
      });
      const j = await res.json();
      if (j.code === 0 && j.data?.certifyUrl) {
        const fi = { certifyId: j.data.certifyId, certifyUrl: j.data.certifyUrl, devMode: !!j.data.devMode };
        faceRef.current = fi;
        setFaceInfo(fi);
        setStep('face');
        if (!force) message.info('请使用法人本人手机扫码完成刷脸');
      } else {
        message.error(j.message || '发起刷脸认证失败');
      }
    } catch {
      message.error('无法连接服务器，请检查服务是否启动');
    }
    setFaceLoading(false);
  };

  /** 手动查询刷脸结果（未通过时给出明确反馈并停止轮询等待重新生成） */
  const checkFaceNow = async () => {
    if (!faceRef.current) return;
    try {
      const res = await fetch(`${ENTERPRISE_API_BASE}/enterprise/face/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, certifyId: faceRef.current.certifyId }),
      });
      const j = await res.json();
      if (j.code === 0 && j.data?.passed) {
        finishFacePass(j.data.cert);
      } else {
        setFaceResult({ passed: false, message: j.data?.message || j.message || '未查询到通过结果，请确认已完成刷脸' });
      }
    } catch {
      message.error('无法连接服务器，请检查服务是否启动');
    }
  };

  const handleSubmit = async () => {
    const values = form.getFieldsValue();
    setLoading(true);
    try {
      const res = await fetch(`${ENTERPRISE_API_BASE}/enterprise/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, ...values }),
      });
      const j = await res.json();
      if (j.code === 0) {
        if (j.data?.status === 'pending') {
          // 三要素通过 → 进入法人刷脸步骤
          setInfo(j.data || null);
          await startFaceInit();
        } else {
          message.success(reCertMode ? '变更认证成功，已重新通过核验' : (j.message || '企业认证通过'));
          setInfo(j.data || null);
          setReCertMode(false);
          onCertChanged?.();
        }
      } else {
        message.error(j.message || '认证失败');
      }
    } catch {
      message.error('无法连接服务器，请检查服务是否启动');
    }
    setLoading(false);
  };

  const isCertified = info?.status === 'certified';
  const isPending = info?.status === 'pending';
  const showForm = (!isCertified && !isPending) || reCertMode;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={560}
      title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: '#52c41a' }} />{step === 'face' ? '法人刷脸认证' : (reCertMode ? '申请变更认证' : '企业认证')}</span>}
      footer={step === 'face'
        ? <Space><Button icon={<ArrowLeftOutlined />} onClick={() => { setStep('form'); setFaceInfo(null); setFaceResult(null); faceRef.current = null; }}>返回修改</Button><Button type="primary" loading={faceLoading} onClick={() => void startFaceInit(true)}>重新生成二维码</Button></Space>
        : isCertified && !reCertMode
          ? <Space><Button icon={<ReloadOutlined />} onClick={() => void loadStatus()}>刷新状态</Button><Button type="primary" onClick={onClose}>关闭</Button></Space>
          : reCertMode
            ? <Space><Button icon={<ArrowLeftOutlined />} onClick={() => setReCertMode(false)}>返回</Button><Button type="primary" loading={loading} onClick={handleSubmit}>提交变更认证</Button></Space>
            : isPending
              ? <Space><Button onClick={onClose}>关闭</Button><Button type="primary" icon={<QrcodeOutlined />} loading={faceLoading} onClick={() => void startFaceInit()}>继续完成刷脸认证</Button></Space>
              : undefined}
      onOk={showForm ? handleSubmit : undefined}
      okText={reCertMode ? '提交变更认证' : '提交认证'}
      confirmLoading={loading}
      cancelText="取消"
      destroyOnClose
    >
      {step === 'face' && faceInfo ? (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <Alert type="success" showIcon style={{ marginBottom: 16, textAlign: 'left' }}
            message="三要素核验已通过" description="请完成法人活体刷脸以确认法人本人真实意愿，刷脸通过后认证即生效。" />
          <div style={{ display: 'inline-block', padding: 12, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fff' }}>
            <QRCode value={faceInfo.certifyUrl} size={176} />
          </div>
          <div style={{ marginTop: 12, fontSize: 14 }}>
            请使用<b>法人本人</b>手机扫描二维码，按提示完成刷脸
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#8c8c8c' }}>
            认证链接 30 分钟内有效；刷脸完成后本页将在约 3 秒内自动确认，无需刷新
          </div>
          {faceInfo.devMode && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#ad6800' }}>
              开发模式：刷脸接口未配置，当前链接为占位地址，查询结果将直接视为通过
            </div>
          )}
          {faceResult && !faceResult.passed && (
            <Alert type="error" showIcon style={{ marginTop: 12, textAlign: 'left' }} message={faceResult.message} />
          )}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => void checkFaceNow()}>我已完成刷脸</Button>
            <Button icon={<ReloadOutlined />} loading={faceLoading} onClick={() => void startFaceInit(true)}>重新生成二维码</Button>
          </Space>
        </div>
      ) : isCertified && !reCertMode ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <CertBadge info={info} />
            <span style={{ marginLeft: 4, color: '#52c41a', fontWeight: 600 }}>该企业已通过三要素核验与法人活体刷脸</span>
          </div>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="企业名称">{info.companyName}</Descriptions.Item>
            <Descriptions.Item label="统一社会信用代码">{info.creditCodeMasked}</Descriptions.Item>
            <Descriptions.Item label="法人姓名">{info.legalPerson}</Descriptions.Item>
            {info.idCardMasked && <Descriptions.Item label="法人身份证">{info.idCardMasked}</Descriptions.Item>}
            <Descriptions.Item label="认证时间">{(info.verifiedAt || '').replace('T', ' ').slice(0, 16)}</Descriptions.Item>
            <Descriptions.Item label="最近巡检">{info.lastCheckAt ? (info.lastCheckAt || '').replace('T', ' ').slice(0, 16) : '待巡检'}</Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button type="link" icon={<EditOutlined />} onClick={() => {
              setReCertMode(true);
              form.setFieldsValue({
                companyName: info.companyName || profile.companyName || '',
                creditCode: '',
                legalPerson: info.legalPerson || '',
                idCard: '',
              });
            }}>
              申请变更认证信息
            </Button>
          </div>
        </>
      ) : isPending && !reCertMode ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <CertBadge info={info} />
          <div style={{ margin: '12px 0 4px', fontWeight: 600 }}>三要素核验已通过，还差最后一步</div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 16 }}>
            请使用<b>法人本人</b>手机扫码完成活体刷脸，认证方可生效
          </div>
          <Button type="primary" icon={<QrcodeOutlined />} loading={faceLoading} onClick={() => void startFaceInit()}>
            继续完成刷脸认证
          </Button>
        </div>
      ) : (
        <>
          {info && !reCertMode && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, fontSize: 12, color: '#ad6800' }}>
              当前状态：{info.status === 'abnormal' ? `认证异常（${info.failReason || '工商信息已变更'}）` : '认证已撤销'}，请重新提交认证
            </div>
          )}
          {reCertMode && (
            <Alert type="info" showIcon icon={<LockOutlined />} style={{ marginBottom: 12 }}
              message="变更认证信息后，企业名称、统一社会信用代码、法人姓名将重新核验，并需法人重新刷脸认证。" />
          )}
          <Form form={form} layout="vertical">
            <Form.Item name="companyName" label="企业名称" rules={[{ required: true, message: '请输入企业名称' }]}
              extra={reCertMode ? '变更认证时可修改企业名称，将重新核验' : '与注册账号一致，不可修改'}>
              <Input placeholder="请输入企业全称" disabled={!reCertMode} />
            </Form.Item>
            <Form.Item name="creditCode" label="统一社会信用代码" rules={[{ required: true, message: '请输入18位统一社会信用代码' }, { pattern: /^[0-9A-HJ-NPQRTUWXY]{18}$/i, message: '信用代码格式不正确（18位）' }]}>
              <Input placeholder="营业执照上的18位统一社会信用代码" maxLength={18} />
            </Form.Item>
            <Form.Item name="legalPerson" label="法人姓名" rules={[{ required: true, message: '请输入营业执照登记的法人姓名' }]}>
              <Input placeholder="与工商登记一致的法定代表人姓名" />
            </Form.Item>
            <Form.Item name="idCard" label="法人身份证号"
              rules={[{ required: true, message: '请输入法人身份证号码' }, { pattern: /^\d{17}[\dX]$/i, message: '身份证号码格式不正确（18位）' }]}
              extra="用于法人活体刷脸核验本人身份，仅作认证用途">
              <Input placeholder="法人本人的18位身份证号码" maxLength={18} />
            </Form.Item>
          </Form>
          <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.8 }}>
            提交后将调用工商三要素核验接口比对企业名称、信用代码与法人姓名；核验通过后需<b>法人本人</b>手机扫码完成活体刷脸，刷脸通过认证即生效；此后每 30 天自动巡检一次工商状态。
          </div>
        </>
      )}
    </Modal>
  );
};

export default EnterpriseCertModal;
