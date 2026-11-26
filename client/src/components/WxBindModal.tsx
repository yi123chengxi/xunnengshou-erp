import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Popconfirm, Space, Spin, Tag, Typography, message } from 'antd';
import { ReloadOutlined, WechatOutlined } from '@ant-design/icons';
import { API_BASE } from '../utils/apiBase';

const { Text } = Typography;

const tokenOf = (): string => localStorage.getItem('token') || '';
const authHeader = (): Record<string, string> => ({ Authorization: `Bearer ${tokenOf()}` });

interface SelfBind { bound: boolean; wechats: string[] }

/** 供布局在菜单渲染前预取绑定状态，使入口文案能直接显示「绑定微信 / 解绑微信」 */
export const fetchWxBound = async (): Promise<boolean> => {
  const t = localStorage.getItem('token') || '';
  if (!t) return false;
  try {
    const res = await fetch(`${API_BASE}/wx/bind/self`, { headers: { Authorization: `Bearer ${t}` } });
    const d = await res.json().catch(() => null);
    return !!(res.ok && d?.data?.bound);
  } catch { return false; }
};

/**
 * 绑定微信弹窗（右上角用户菜单入口）。
 *
 * 与登录页的 /wx/web/qr 不同：这里向 /wx/web/qr/bind 申请的是 purpose=bind 的 state，
 * 开放平台回跳只把微信身份暂存在服务端 state 表里，既不写绑定表也不切会话；
 * 真正的写入由本弹窗点「确认绑定」后带 JWT 调 /wx/bind/self 完成，ident 全程不出服务端，
 * 避免伪造 ident 把他人微信绑到本账号。
 *
 * 未登录会话（无 token）不请求，直接提示刷新页面。
 */
const WxBindModal = ({ open, onClose, onChanged }: {
  open: boolean;
  onClose: () => void;
  onChanged?: (bound: boolean) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<SelfBind>({ bound: false, wechats: [] });
  const [qr, setQr] = useState<{ state: string; url: string } | null>(null);
  const [qrErr, setQrErr] = useState('');
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<any>(null);

  /** 查当前账号的绑定状态，并回传给外层用于切换菜单文案「绑定微信 / 解绑微信」 */
  const loadSelf = useCallback(async () => {
    if (!tokenOf()) { setInfo({ bound: false, wechats: [] }); onChanged?.(false); return; }
    setLoading(true);
    let next: SelfBind = { bound: false, wechats: [] };
    try {
      const res = await fetch(`${API_BASE}/wx/bind/self`, { headers: authHeader() });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.data) next = { bound: !!d.data.bound, wechats: Array.isArray(d.data.wechats) ? d.data.wechats : [] };
    } catch { /* 网络异常按未绑定渲染，用户可在弹窗内重试 */ }
    setInfo(next);
    onChanged?.(next.bound);
    setLoading(false);
  }, [onChanged]);

  /** 申请绑定用途二维码；501/404 说明开放平台网站应用凭据未配或代码未上线 */
  const startQr = useCallback(() => {
    setQr(null); setQrErr(''); setScanned(false);
    fetch(`${API_BASE}/wx/web/qr/bind`, { headers: authHeader() })
      .then(r => (r.status === 501 || r.status === 404
        ? Promise.reject(new Error('not_configured'))
        : r.json()))
      .then(d => { if (d?.data?.state) setQr({ state: String(d.data.state), url: String(d.data.url) }); else setQrErr('二维码获取失败，请重试'); })
      .catch(e => { setQrErr(e?.message === 'not_configured' ? '网页微信扫码暂未开通（需微信开放平台网站应用审核通过后在服务端配置 WX_WEB_APPID/WX_WEB_SECRET）' : '二维码获取失败，请稍后重试'); });
  }, []);

  // 打开弹窗：先查状态，未绑定才出二维码
  useEffect(() => {
    if (!open) return;
    void loadSelf();
  }, [open, loadSelf]);

  useEffect(() => {
    if (open && !loading && !info.bound && !qr && !qrErr) startQr();
  }, [open, loading, info.bound, qr, qrErr, startQr]);

  // 轮询扫码结果；iframe 内回跳页 postMessage 到达时立即补一次
  useEffect(() => {
    if (!open || info.bound || !qr || scanned) return;
    const state = qr.state;
    const hit = async () => {
      try {
        const res = await fetch(`${API_BASE}/wx/web/qr/poll?state=${encodeURIComponent(state)}`, { headers: authHeader() });
        const d = await res.json().catch(() => null);
        const st = d?.data?.status;
        if (st === 'done') { setScanned(true); if (pollRef.current) clearInterval(pollRef.current); return; }
        if (st === 'expired') { setQrErr('二维码已过期，请刷新后重新扫码'); if (pollRef.current) clearInterval(pollRef.current); }
      } catch { /* 抖动继续轮询 */ }
    };
    pollRef.current = setInterval(hit, 2000);
    const onMsg = (ev: MessageEvent) => {
      if (ev.data && ev.data.type === 'wx-qr-done' && ev.data.state === state) void hit();
    };
    window.addEventListener('message', onMsg);
    return () => { if (pollRef.current) clearInterval(pollRef.current); window.removeEventListener('message', onMsg); };
  }, [open, info.bound, qr, scanned]);

  const confirmBind = async () => {
    if (!qr || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/wx/bind/self`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: qr.state }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.data?.bound) {
        message.success('微信绑定成功，之后可用微信一键登录进入本账号');
        setQr(null); setScanned(false);
        await loadSelf();
      } else {
        message.error(d?.message || '绑定失败，请重新扫码');
        startQr();
      }
    } catch { message.error('网络异常，请重试'); }
    finally { setBusy(false); }
  };

  const unbind = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/wx/unbind/self`, { method: 'POST', headers: authHeader() });
      const d = await res.json().catch(() => null);
      if (res.ok) { message.success('已解绑微信'); await loadSelf(); }
      else message.error(d?.message || '解绑失败，请重试');
    } catch { message.error('网络异常，请重试'); }
    finally { setBusy(false); }
  };

  const body = () => {
    if (!tokenOf()) return <Alert type="error" showIcon message="会话已失效，请刷新页面重新登录后再试" />;
    if (loading) return <div style={{ textAlign: 'center', padding: '48px 0' }}><Spin /><div style={{ marginTop: 12 }}><Text type="secondary">加载中…</Text></div></div>;
    if (info.bound) {
      return (
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <WechatOutlined style={{ fontSize: 40, color: '#07c160' }} />
          <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600 }}>已绑定微信</div>
          <div style={{ marginTop: 8 }}>
            {info.wechats.map(w => <Tag key={w} color="green">{w}</Tag>)}
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
            解绑后该微信将无法用微信一键登录进入本账号；同一微信绑定的其它公司账号不受影响。
          </Text>
          <Popconfirm
            title="确定解绑微信？"
            description="解绑后需改用账号密码登录本账号"
            okText="确定解绑"
            cancelText="再想想"
            onConfirm={unbind}
          >
            <Button danger loading={busy} style={{ marginTop: 16 }}>解绑微信</Button>
          </Popconfirm>
        </div>
      );
    }
    if (scanned && qr) {
      return (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <WechatOutlined style={{ fontSize: 36, color: '#07c160' }} />
          <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600 }}>已获取微信授权</div>
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            点击下方按钮，把该微信绑定到当前登录账号（{localStorage.getItem('username') || '本账号'}）。
          </Text>
          <Button type="primary" loading={busy} onClick={confirmBind} style={{ marginTop: 16 }}>确认绑定</Button>
          <div style={{ marginTop: 10 }}>
            <Button type="link" size="small" onClick={startQr}>重新扫码</Button>
          </div>
        </div>
      );
    }
    if (qrErr) {
      return (
        <div style={{ padding: '8px 0' }}>
          <Alert type="warning" showIcon message={qrErr} style={{ marginBottom: 16 }} />
          <Space>
            <Button icon={<ReloadOutlined />} onClick={startQr}>刷新二维码</Button>
            <Button type="link" onClick={() => void loadSelf()}>重新检测</Button>
          </Space>
        </div>
      );
    }
    if (!qr) return <div style={{ textAlign: 'center', padding: '48px 0' }}><Spin /><div style={{ marginTop: 12 }}><Text type="secondary">二维码加载中…</Text></div></div>;
    return (
      <div style={{ textAlign: 'center' }}>
        <iframe title="微信扫码绑定" src={qr.url} style={{ width: 300, height: 400, border: 'none' }} />
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>请使用微信扫一扫并确认授权</Text>
          <Button type="link" size="small" icon={<ReloadOutlined />} onClick={startQr}>刷新二维码</Button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={info.bound ? '解绑微信' : '绑定微信'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={380}
      destroyOnClose
      afterOpenChange={(v) => { if (!v) { setQr(null); setQrErr(''); setScanned(false); } }}
    >
      {body()}
    </Modal>
  );
};

export default WxBindModal;
