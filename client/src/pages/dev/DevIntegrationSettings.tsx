import React, { useState, useEffect, useCallback } from 'react';
import { Card, Form, Input, Button, Space, message, Tag, Alert, Divider, Typography, Popconfirm, Spin } from 'antd';
import { SaveOutlined, ApiOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { API_BASE } from '../../utils/apiBase';

const { Text, Paragraph } = Typography;

interface CfgState {
  apiUrl: string; appCode: string; appKey: string; appSecret: string;
  source: 'db' | 'env' | 'none'; configured: boolean;
}

const DEFAULT_URL = 'https://sys.81api.com/verifyCompany/';

/**
 * 开发者后台 - 系统设置 - 接口配置：企业三要素核验（阿里云市场）
 * 重新订购 / 更换 AppCode 后在此更新即可即时生效，无需改代码重新部署。
 * 配置存服务端 system_settings 表（优先于 server/.env）。
 */
const DevIntegrationSettings: React.FC = () => {
  const [form] = Form.useForm();
  const [testForm] = Form.useForm();
  const [cfg, setCfg] = useState<CfgState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<{ ok: boolean; matched?: boolean; message: string; raw: any } | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/enterprise/config`);
      const json = await res.json();
      if (json.code === 0 && json.data) {
        const d = json.data as CfgState;
        setCfg(d);
        form.setFieldsValue({ apiUrl: d.apiUrl || DEFAULT_URL, appCode: d.appCode, appKey: d.appKey, appSecret: d.appSecret });
      } else {
        message.error(json.message || '读取接口配置失败');
      }
    } catch (e: any) {
      message.error(`读取接口配置失败：${e?.message || '网络异常'}`);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    loadConfig();
    // 测试样例默认填入一组已知真实企业，方便一键连通验证
    testForm.setFieldsValue({ companyName: '瑞安市诚翕贸易有限公司', creditCode: '91330381MA7LBN8A48', legalPerson: '易承翕' });
  }, [loadConfig, testForm]);

  const handleSave = useCallback(async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const res = await fetch(`${API_BASE}/enterprise/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: v.apiUrl?.trim(), appCode: v.appCode?.trim(), appKey: v.appKey?.trim(), appSecret: v.appSecret?.trim() }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success(json.message || '配置已保存');
        await loadConfig();
      } else {
        message.error(json.message || '保存失败');
      }
    } catch (e: any) {
      if (e?.errorFields) { message.warning('请按提示检查表单'); return; }
      message.error(`保存失败：${e?.message || '网络异常'}`);
    } finally {
      setSaving(false);
    }
  }, [form, loadConfig]);

  const handleTest = useCallback(async () => {
    try {
      const tv = await testForm.validateFields();
      const fv = form.getFieldsValue();
      setTesting(true);
      setTestOut(null);
      const res = await fetch(`${API_BASE}/enterprise/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 用表单里"待保存"的 apiUrl/appCode 直接测试（未落库也能验证）
        body: JSON.stringify({
          companyName: tv.companyName?.trim(), creditCode: tv.creditCode?.trim(), legalPerson: tv.legalPerson?.trim(),
          apiUrl: fv.apiUrl?.trim(), appCode: fv.appCode?.trim(),
        }),
      });
      const json = await res.json();
      if (json.code === 0 && json.data) {
        const r = json.data.result || {};
        setTestOut({ ok: !!r.ok, matched: r.matched, message: r.message || (r.ok ? '核验完成' : '核验失败'), raw: json.data.raw });
      } else {
        setTestOut({ ok: false, message: json.message || '测试请求失败', raw: null });
      }
    } catch (e: any) {
      if (e?.errorFields) { message.warning('请填写完整的测试样例'); return; }
      setTestOut({ ok: false, message: `测试失败：${e?.message || '网络异常'}`, raw: null });
    } finally {
      setTesting(false);
    }
  }, [form, testForm]);

  const sourceText = cfg?.source === 'db' ? '后台配置' : cfg?.source === 'env' ? 'server/.env' : '未配置';

  return (
    <div style={{ padding: 16 }}>
      <Spin spinning={loading}>
        <Card
          title={<span><ApiOutlined style={{ marginRight: 8, color: '#1e4a7e' }} />接口配置 · 企业三要素核验</span>}
          extra={cfg?.configured
            ? <Tag icon={<CheckCircleOutlined />} color="green">已配置（{sourceText}）</Tag>
            : <Tag icon={<CloseCircleOutlined />} color="red">未配置</Tag>}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="重新订购或更换 AppCode 后，在此更新并保存即可即时生效，无需修改代码或重新部署服务器。"
            description="配置保存在服务端数据库（优先于 server/.env）。企业名称 + 统一社会信用代码 + 法人姓名三要素核验，每次调用消耗 1 次套餐配额。"
          />

          <Form form={form} layout="vertical" style={{ maxWidth: 720 }} autoComplete="off">
            <Form.Item name="apiUrl" label="接口地址（调用 URL）" rules={[{ required: true, message: '请填写接口地址' }]}>
              <Input placeholder={DEFAULT_URL} allowClear />
            </Form.Item>
            <Form.Item
              name="appCode" label="AppCode"
              extra="阿里云市场「已购买的服务 → AppCode」，请求头以 Authorization: APPCODE <值> 认证。"
              rules={[{ required: true, message: '请填写 AppCode' }, { pattern: /^[a-f0-9]{16,64}$/i, message: '应为 16-64 位十六进制字符串' }]}
            >
              <Input.Password placeholder="请输入 AppCode" visibilityToggle allowClear />
            </Form.Item>
            <Form.Item name="appKey" label="AppKey（选填）" extra="当前采用 AppCode 认证，AppKey/AppSecret 仅作留档，便于日后切换签名认证方式。">
              <Input placeholder="选填" allowClear />
            </Form.Item>
            <Form.Item name="appSecret" label="AppSecret（选填）">
              <Input.Password placeholder="选填" visibilityToggle allowClear />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存配置</Button>
                <Button onClick={loadConfig}>重新加载</Button>
              </Space>
            </Form.Item>
          </Form>

          <Divider style={{ margin: '24px 0' }} />

          <Card type="inner" title="测试连通" size="small">
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
              填写一组真实企业样例，点击测试将用上方「待保存」的接口地址与 AppCode 真实调用一次（<Text strong type="danger">消耗 1 次套餐配额</Text>），用于确认配置是否正确。
            </Paragraph>
            <Form form={testForm} layout="inline" style={{ rowGap: 12, marginBottom: 12 }} autoComplete="off">
              <Form.Item name="companyName" label="企业名称" rules={[{ required: true, message: '请填写' }]}>
                <Input placeholder="企业名称" style={{ width: 220 }} />
              </Form.Item>
              <Form.Item name="creditCode" label="统一社会信用代码" rules={[{ required: true, message: '请填写' }]}>
                <Input placeholder="18 位信用代码" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="legalPerson" label="法人姓名" rules={[{ required: true, message: '请填写' }]}>
                <Input placeholder="法人姓名" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item>
                <Popconfirm title="测试将真实调用接口并消耗 1 次配额，确认继续？" okText="继续测试" cancelText="取消" onConfirm={handleTest}>
                  <Button type="primary" ghost icon={<ApiOutlined />} loading={testing}>测试连通</Button>
                </Popconfirm>
              </Form.Item>
            </Form>

            {testOut && (
              <Alert
                type={testOut.ok && testOut.matched ? 'success' : testOut.ok ? 'warning' : 'error'}
                showIcon
                message={
                  testOut.ok && testOut.matched ? '核验通过：三要素一致'
                    : testOut.ok ? `核验完成但不匹配：${testOut.message}`
                      : `调用失败：${testOut.message}`
                }
                description={
                  <div style={{ fontSize: 12 }}>
                    <div>上游原始响应：</div>
                    <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'rgba(0,0,0,0.04)', padding: 8, borderRadius: 4 }}>
                      {typeof testOut.raw === 'string' ? testOut.raw : JSON.stringify(testOut.raw, null, 2)}
                    </pre>
                  </div>
                }
              />
            )}
          </Card>
        </Card>
      </Spin>
    </div>
  );
};

export default DevIntegrationSettings;
