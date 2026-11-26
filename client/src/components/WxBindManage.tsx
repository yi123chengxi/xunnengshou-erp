import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, List, Tag, message, Popconfirm, Empty, Spin } from 'antd';
import { WechatOutlined } from '@ant-design/icons';
import { API_BASE } from '../utils/apiBase';

interface BindBrief { username: string; name: string; company: string }

const tokenOf = (): string => localStorage.getItem('wxToken') || localStorage.getItem('token') || '';

/**
 * 微信绑定管理（个人中心页签）：展示当前微信已绑定的公司账号列表并支持解绑。
 * 服务端 GET /wx/bindings 要求令牌带 wxIdent（即微信登录会话：网页扫码或小程序），
 * 账号密码登录的会话无 wxIdent，服务端返回 400，此处展示引导文案。
 */
const WxBindManage = () => {
  const [list, setList] = useState<BindBrief[] | null>(null);
  const [current, setCurrent] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    const token = tokenOf();
    if (!token) { setErr('未获取到会话令牌'); return; }
    setErr('');
    fetch(`${API_BASE}/wx/bindings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 400 ? '当前会话非微信登录，无法查看绑定列表' : `加载失败(${r.status})`))))
      .then(d => { setList(d.data.list || []); setCurrent(String(d.data.current || '')); })
      .catch(e => { setErr(e?.message || '加载失败'); setList(null); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const unbind = (username: string) => {
    setBusy(username);
    fetch(`${API_BASE}/wx/unbind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOf()}` },
      body: JSON.stringify({ username }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) { message.success(`已解绑 ${username}`); setList(d.data.list || []); }
        else message.error(d?.message || '解绑失败');
      })
      .catch(() => message.error('网络异常，请重试'))
      .finally(() => setBusy(''));
  };

  if (err) {
    return (
      <Alert
        type="warning" showIcon message={err}
        description="通过网页「微信扫码」页签或小程序微信登录后，可在此管理本微信绑定的公司账号。"
      />
    );
  }
  if (!list) return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>;
  if (!list.length) return <Empty description="本微信尚未绑定任何公司账号" />;
  return (
    <List
      size="small"
      dataSource={list}
      renderItem={it => (
        <List.Item
          actions={[
            it.username === current ? <Tag color="blue" key="cur">当前登录</Tag> : null,
            <Popconfirm
              key="unbind"
              title={`解绑 ${it.company || it.username}？`}
              description="解绑后该微信扫码登录将不再能进入该公司"
              onConfirm={() => unbind(it.username)}
              okText="解绑" cancelText="取消"
            >
              <Button size="small" danger loading={busy === it.username}>解绑</Button>
            </Popconfirm>,
          ].filter(Boolean) as React.ReactNode[]}
        >
          <List.Item.Meta
            avatar={<WechatOutlined style={{ color: '#52c41a', fontSize: 20 }} />}
            title={it.company || it.username}
            description={`账号 ${it.username}${it.name ? ` · ${it.name}` : ''}`}
          />
        </List.Item>
      )}
    />
  );
};

export default WxBindManage;
