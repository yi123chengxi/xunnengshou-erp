import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Row, Col, Button, Input, Select, Typography, Tag, message, Spin, Space, Descriptions, Alert, Divider,
} from 'antd';
import {
  ApiOutlined, SendOutlined, LinkOutlined, KeyOutlined, ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const API_BASE = 'http://localhost:3000/api';

interface JstAction {
  key: string;
  label: string;
  path: string;
  desc: string;
  defaultBiz: any;
}

interface JstModule {
  title: string;
  business: string;
  actions: JstAction[];
}

// ============ 聚水潭各接口模块定义（对应开放平台 API 路径） ============
const jstRange6 = () => {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return { modified_begin: fmt(new Date(Date.now() - 6 * 24 * 3600 * 1000)), modified_end: fmt(new Date()) };
};

const JST_MODULES: Record<string, JstModule> = {
  order: {
    title: '订单API',
    business: '分销商订单同步到ERP',
    actions: [
      { key: 'query', label: '订单查询', path: '/open/orders/single/query', desc: '按条件查询聚水潭订单（限7天内）', defaultBiz: { ...jstRange6(), page_index: 1, page_size: 10 } },
      { key: 'upload', label: '订单上传', path: '/open/jushuitan/orders/upload', desc: '上传/推送订单到聚水潭', defaultBiz: { o_id: `TEST${Date.now()}`, shop_id: '1', shop_name: '测试店铺', items: [] } },
    ],
  },
  inventory: {
    title: '库存API',
    business: '实时查询可用库存',
    actions: [
      { key: 'query', label: '库存查询', path: '/open/inventory/query', desc: '查询实时可用库存', defaultBiz: { ...jstRange6(), page_index: 1, page_size: 20 } },
      { key: 'sync', label: '库存同步', path: '/open/jushuitan/inventoryv2/upload', desc: '同步库存到聚水潭', defaultBiz: { items: [] } },
    ],
  },
  product: {
    title: '商品API',
    business: '商品信息同步',
    actions: [
      { key: 'query', label: '商品查询', path: '/open/skumap/query', desc: '查询店铺商品资料', defaultBiz: { ...jstRange6(), page_index: 1, page_size: 20 } },
      { key: 'upload', label: '商品上传', path: '/open/jushuitan/itemsku/upload', desc: '上传普通商品资料', defaultBiz: { skus: [] } },
      { key: 'shopupload', label: '店铺商品资料上传', path: '/open/jushuitan/skumap/upload', desc: '上传店铺商品资料', defaultBiz: { items: [] } },
    ],
  },
  logistics: {
    title: '物流API',
    business: '查询物流状态',
    actions: [
      { key: 'query', label: '发货信息查询', path: '/open/logistic/query', desc: '查询物流/发货跟踪信息', defaultBiz: { ...jstRange6(), page_index: 1, page_size: 10 } },
    ],
  },
  outbound: {
    title: '出库API',
    business: '发货回传',
    actions: [
      { key: 'query', label: '销售出库查询', path: '/open/orders/out/simple/query', desc: '查询销售出库单', defaultBiz: { ...jstRange6(), page_index: 1, page_size: 10 } },
      { key: 'out', label: '出库发货', path: '/open/orders/wms/sent/upload', desc: '出库发货回传', defaultBiz: { o_id: '', so_id: '', logistics_company: 'ZTO', l_id: '' } },
    ],
  },
  shop: {
    title: '店铺API',
    business: '获取店铺编码',
    actions: [
      { key: 'query', label: '店铺查询', path: '/open/shops/query', desc: '查询店铺列表及编码', defaultBiz: { page_index: 1, page_size: 100 } },
    ],
  },
  'logistics-company': {
    title: '物流公司API',
    business: '获取快递编码',
    actions: [
      { key: 'query', label: '快递公司编码查询', path: '/open/logisticscompany/query', desc: '查询快递公司编码', defaultBiz: { page_index: 1, page_size: 100 } },
    ],
  },
};

const JstPage: React.FC = () => {
  const { childKey = 'order' } = useParams();
  const mod = JST_MODULES[childKey] || JST_MODULES.order;

  const [config, setConfig] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string>(() => localStorage.getItem('jst_access_token') || '');
  const [authUrl, setAuthUrl] = useState('');
  const [authCode, setAuthCode] = useState('');

  const [actionKey, setActionKey] = useState(mod.actions[0]?.key || '');
  const [path, setPath] = useState(mod.actions[0]?.path || '');
  const [biz, setBiz] = useState(JSON.stringify(mod.actions[0]?.defaultBiz || {}, null, 2));
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);

  // 切换模块时重置为该模块第一个接口
  useEffect(() => {
    const first = mod.actions[0];
    setActionKey(first?.key || '');
    setPath(first?.path || '');
    setBiz(JSON.stringify(first?.defaultBiz || {}, null, 2));
    setResponse(null);
  }, [childKey]);

  // 加载配置
  useEffect(() => {
    axios.get(`${API_BASE}/jst/config`).then(r => setConfig(r.data?.data)).catch(() => setConfig(null));
  }, []);

  const handleSelectAction = (key: string) => {
    setActionKey(key);
    const act = mod.actions.find(a => a.key === key);
    if (act) {
      setPath(act.path);
      setBiz(JSON.stringify(act.defaultBiz || {}, null, 2));
    }
  };

  const handleGetAuthUrl = async () => {
    try {
      const r = await axios.post(`${API_BASE}/jst/authUrl`, { state: 'factory-erp' });
      const url = r.data?.data?.url || '';
      setAuthUrl(url);
      if (url) message.success('授权链接已生成（15分钟内有效）');
    } catch (e: any) {
      message.error('生成授权链接失败：' + (e?.message || ''));
    }
  };

  const handleExchangeToken = async () => {
    if (!authCode.trim()) { message.warning('请先填写授权回调返回的 code'); return; }
    try {
      const r = await axios.post(`${API_BASE}/jst/token`, { code: authCode.trim() });
      const data = r.data?.data || {};
      const token = data?.data?.access_token || data?.access_token;
      if (token) {
        setAccessToken(token);
        localStorage.setItem('jst_access_token', token);
        message.success('access_token 获取成功');
      } else {
        message.warning('未获取到 access_token：' + JSON.stringify(data));
      }
    } catch (e: any) {
      message.error('换取 token 失败：' + (e?.message || ''));
    }
  };

  const handleSend = useCallback(async () => {
    if (!path.trim()) { message.warning('请填写接口路径'); return; }
    let bizObj: any = {};
    try { bizObj = biz.trim() ? JSON.parse(biz) : {}; } catch { message.error('业务参数 biz 不是合法 JSON'); return; }
    setLoading(true);
    setResponse(null);
    const started = Date.now();
    try {
      const r = await axios.post(`${API_BASE}/jst/call`, { path: path.trim(), biz: bizObj, accessToken });
      setResponse({ ok: true, ms: Date.now() - started, data: r.data });
    } catch (e: any) {
      setResponse({ ok: false, ms: Date.now() - started, data: e?.response?.data || { message: e?.message } });
    } finally {
      setLoading(false);
    }
  }, [path, biz, accessToken]);

  const respText = useMemo(() => (response ? JSON.stringify(response.data, null, 2) : ''), [response]);

  return (
    <div style={{ padding: 16, background: '#f0f2f5', minHeight: '100%' }}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ApiOutlined style={{ fontSize: 20, color: '#1e4a7e' }} />
          <Title level={4} style={{ margin: 0, color: '#1e4a7e' }}>聚水潭数据 — {mod.title}</Title>
          <Tag color="blue">{mod.business}</Tag>
          <Tag color={config?.env ? 'green' : 'default'}>{config?.env || '测试环境(沙箱)'}</Tag>
        </div>
        <Paragraph type="secondary" style={{ margin: '8px 0 0', fontSize: 12 }}>
          通过后端代理调用聚水潭开放平台接口（自动签名），默认使用沙箱公共测试账号。请先获取 access_token 再调用业务接口。
        </Paragraph>
      </Card>

      <Row gutter={12}>
        {/* 左：授权与配置 */}
        <Col xs={24} lg={8}>
          <Card size="small" title={<span><KeyOutlined style={{ marginRight: 6 }} />授权与配置</span>} style={{ marginBottom: 12 }}>
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="环境">{config?.env || '测试环境(沙箱)'}</Descriptions.Item>
              <Descriptions.Item label="网关">{config?.serverUrl || 'https://dev-api.jushuitan.com'}</Descriptions.Item>
              <Descriptions.Item label="appKey"><Text copyable style={{ fontSize: 12 }}>{config?.appKey || '-'}</Text></Descriptions.Item>
              <Descriptions.Item label="appSecret">{config?.appSecretMasked || '******'}</Descriptions.Item>
            </Descriptions>

            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Button icon={<LinkOutlined />} onClick={handleGetAuthUrl} block>生成授权链接</Button>
              {authUrl && (
                <Input.TextArea value={authUrl} autoSize={{ minRows: 2, maxRows: 4 }} readOnly style={{ fontSize: 11 }} />
              )}
              {authUrl && <Button size="small" onClick={() => window.open(authUrl, '_blank')}>打开授权页（商家登录授权）</Button>}
              <Input placeholder="授权回调返回的 code" value={authCode} onChange={e => setAuthCode(e.target.value)} />
              <Button onClick={handleExchangeToken} block>用 code 换取 access_token</Button>
              <Divider style={{ margin: '4px 0' }} />
              <Text style={{ fontSize: 12 }}>access_token（可直接粘贴调试）：</Text>
              <TextArea value={accessToken} onChange={e => { setAccessToken(e.target.value); localStorage.setItem('jst_access_token', e.target.value); }} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="粘贴 access_token" style={{ fontSize: 12 }} />
            </Space>
          </Card>
        </Col>

        {/* 右：接口调试 */}
        <Col xs={24} lg={16}>
          <Card size="small" title={<span><SendOutlined style={{ marginRight: 6 }} />接口调试</span>}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <div>
                <Text style={{ fontSize: 12 }}>选择接口：</Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  value={actionKey}
                  onChange={handleSelectAction}
                  options={mod.actions.map(a => ({ value: a.key, label: `${a.label}（${a.path}）` }))}
                />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {mod.actions.find(a => a.key === actionKey)?.desc || ''}
                </Text>
              </div>
              <div>
                <Text style={{ fontSize: 12 }}>接口路径 path：</Text>
                <Input value={path} onChange={e => setPath(e.target.value)} style={{ marginTop: 4 }} />
              </div>
              <div>
                <Text style={{ fontSize: 12 }}>业务参数 biz（JSON）：</Text>
                <TextArea value={biz} onChange={e => setBiz(e.target.value)} autoSize={{ minRows: 5, maxRows: 12 }} style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }} />
              </div>
              <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={handleSend}>发送请求</Button>

              {response && (
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <Tag color={response.ok ? 'green' : 'red'}>{response.ok ? '请求完成' : '请求失败'}</Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>耗时 {response.ms}ms</Text>
                    <Button size="small" icon={<ReloadOutlined />} onClick={handleSend}>重试</Button>
                  </div>
                  {!response.ok && <Alert type="error" style={{ marginBottom: 6 }} message="后端代理调用失败，请检查后端服务是否启动" />}
                  <pre style={{
                    background: '#0f1e33', color: '#d6e4ff', borderRadius: 6, padding: 10,
                    fontSize: 11, maxHeight: 380, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap',
                  }}>{respText}</pre>
                </div>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {loading && <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.4)', zIndex: 999 }}><Spin size="large" /></div>}
    </div>
  );
};

export default JstPage;
