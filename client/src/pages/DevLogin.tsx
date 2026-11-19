import React, { useState } from 'react';
import { Card, Typography, Form, Input, Button, message, Alert } from 'antd';
import { LockOutlined, UserOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { API_BASE } from '../utils/apiBase';

const { Title, Text } = Typography;

const PRIMARY = '#1e4a7e';

const DevLogin: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleLogin = async () => {
    try {
      await form.validateFields();
      setLoading(true);

      const username = form.getFieldValue('username');
      const password = form.getFieldValue('password');

      // 服务端真实校验并签发 JWT：此前纯前端校验不写 token，开发者后台浏览器对 /api/sync 是匿名会话，
      // meta 只下发公开键，dev_feedback_*（共享键，需登录）永远拉不到——子账号提交的反馈在开发者后台看不到
      try {
        const res = await fetch(`${API_BASE}/auth/dev-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.code !== 200 || !data.data?.token) {
          message.error((data && data.message) || '开发者账号或密码错误');
          setLoading(false);
          return;
        }
        const u = data.data.user || {};
        // 保存同步令牌：后续 /sync/meta 与数据集拉取携此令牌，dev_ 共享键（意见反馈等）方可读写
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('devLoggedIn', 'true');
        localStorage.setItem('devUser', u.username || 'dev');
        localStorage.setItem('devUserName', u.displayName || u.username || '主开发者');
        if (u.isSub) localStorage.setItem('devIsSub', 'true'); else localStorage.removeItem('devIsSub');
        localStorage.setItem('devParent', u.parentDev || 'dev');
        message.success(u.isSub ? `登录成功，欢迎 ${u.displayName || u.username}` : '开发者登录成功！');
        navigate('/xunnengs/customers/all');
      } catch {
        message.error('无法连接服务器，请检查网络后重试');
      }
      setLoading(false);
    } catch (error) {
      message.error('请检查登录信息');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <Card style={{ maxWidth: 420, width: '100%', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        {/* Logo和标题 */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}>
            <Logo size={56} showText={false} useImage={true} />
          </div>
          <Title level={3} style={{ margin: 0, color: '#1a2b45' }}>讯能手 · 开发者后台</Title>
          <Text type="secondary">管理流ERP - 开发者入口</Text>
        </div>

        <Alert
          message="受限入口"
          description="此页面仅限授权人员访问。"
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
        />

        <Form autoComplete="off" form={form} layout="vertical" size="large">
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入开发者账号' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="开发者账号"
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入开发者密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="开发者密码"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              onClick={handleLogin}
              style={{
                background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)',
                borderColor: '#ff6b6b',
                height: 44,
                fontSize: 16,
              }}
            >
              登录开发者后台
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            子账号由主开发者在「系统设置 - 账号管理」创建
          </Text>
        </div>

        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <a onClick={() => navigate('/login')} style={{ fontSize: 12, color: PRIMARY }}>
            返回用户登录
          </a>
        </div>
      </Card>
    </div>
  );
};

export default DevLogin;
