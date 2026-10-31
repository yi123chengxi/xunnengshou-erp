import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, message, Space, Typography, Descriptions, Tag, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LinkOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

/** 合作令牌存储结构 */
interface CooperationToken {
  token: string;
  purchaserName: string;
  purchaserCompany: string;
  purchaserPhone: string;
  supplierName: string;
  supplierId: string;
  customerId?: string;
  customerName?: string;
  purchaserSupplierEntryId?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const PurchaserCooperationConfirmPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tokenData, setTokenData] = useState<CooperationToken | null>(null);
  const [processed, setProcessed] = useState(false);

  const loadToken = useCallback(() => {
    if (!token) return;
    try {
      const coopTokens: any[] = JSON.parse(localStorage.getItem('cooperation_tokens') || '[]');
      const supplierTokensRaw: any[] = JSON.parse(localStorage.getItem('supplier_cooperation_tokens') || '[]');

      const supplierTokens = supplierTokensRaw.map((t: any) => ({
        token: t.token,
        purchaserName: t.purchaserName || '',
        purchaserCompany: t.purchaserCompany || '',
        purchaserPhone: '',
        supplierName: t.supplierCompany || t.supplierName || '',
        supplierId: t.supplierUsername || t.supplierId || '',
        customerId: t.customerId || '',
        customerName: t.customerName || '',
        status: t.status,
        createdAt: t.createdAt || '',
      }));

      let found = coopTokens.find((t) => t.token === token) || supplierTokens.find((t) => t.token === token);

      // 备选: 从 cooperation_applications 中查找
      if (!found) {
        const apps: any[] = JSON.parse(localStorage.getItem('cooperation_applications') || '[]');
        const app = apps.find((a: any) => a.inviteToken === token && a.supplierInitiated);
        if (app) {
          found = {
            token: token,
            purchaserName: app.purchaserUsername || '',
            purchaserCompany: app.purchaserCompanyName || '',
            purchaserPhone: app.purchaserPhone || '',
            supplierName: app.targetSupplierName || '',
            supplierId: app.targetSupplierId || '',
            customerId: app.customerId || '',
            customerName: '',
            status: app.status || 'pending',
            createdAt: app.applyDate || '',
          };
        }
      }

      // 备选: 从 purchaser_suppliers_xxx 中查找
      if (!found) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('purchaser_suppliers_')) {
            try {
              const suppliers: any[] = JSON.parse(localStorage.getItem(key) || '[]');
              const s = suppliers.find((s: any) => s.cooperationToken === token);
              if (s) {
                found = {
                  token: token,
                  purchaserName: key.replace('purchaser_suppliers_', ''),
                  purchaserCompany: '',
                  purchaserPhone: '',
                  supplierName: s.supplierName || '',
                  supplierId: s.id || '',
                  customerId: '',
                  customerName: '',
                  status: 'pending',
                  createdAt: '',
                };
                break;
              }
            } catch { /* continue */ }
          }
        }
      }

      setTokenData(found || null);
    } catch (error) {
      console.error('Error loading token:', error);
      setTokenData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadToken();
  }, [loadToken]);

  // 同意合作 - 直接建立合作关系（邀请链接无需二次审核）
  const handleApprove = () => {
    if (!tokenData) return;

    // 获取当前登录的采购商信息
    const purchaserUsername = localStorage.getItem('username') || '';
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUser = registeredUsers.find((u: any) => u.username === purchaserUsername);

    if (!purchaserUsername || !currentUser) {
      message.error('请先以采购商身份登录');
      return;
    }

    // 0. 反向查找采购商供应商列表中对应的供应商条目（通过供应商账号ID或公司名称匹配）
    let purchaserSupplierEntryId = '';
    try {
      const purchaserSuppliersKey = `purchaser_suppliers_${purchaserUsername}`;
      const purchaserSuppliers: any[] = JSON.parse(localStorage.getItem(purchaserSuppliersKey) || '[]');
      const matchedEntry = purchaserSuppliers.find((s: any) =>
        s.id === tokenData.supplierId ||
        s.supplierName === tokenData.supplierName
      );
      if (matchedEntry) {
        purchaserSupplierEntryId = matchedEntry.id;
      }
    } catch { /* ignore */ }

    // 1. 更新令牌状态（附带采购商供应商条目ID，方便后续匹配）
    const tokens: any[] = JSON.parse(
      localStorage.getItem('cooperation_tokens') || '[]'
    );
    const updatedTokens = tokens.map((t) =>
      t.token === token
        ? {
            ...t,
            status: 'approved' as const,
            purchaserName: purchaserUsername,
            purchaserCompany: currentUser.companyName || purchaserUsername,
            purchaserPhone: currentUser.phone || '',
            purchaserSupplierEntryId,
          }
        : t
    );
    localStorage.setItem('cooperation_tokens', JSON.stringify(updatedTokens));

    // 2. 作废旧的终止申请，避免 reloadData 误匹配
    const applications = JSON.parse(
      localStorage.getItem('cooperation_applications') || '[]'
    );
    applications.forEach((app: any) => {
      if (
        app.purchaserUsername === purchaserUsername &&
        (app.targetSupplierName === tokenData.supplierName || app.targetSupplierId === tokenData.supplierId || (purchaserSupplierEntryId && app.purchaserSupplierEntryId === purchaserSupplierEntryId)) &&
        app.type === 'terminate' &&
        app.status === 'approved'
      ) {
        app.superseded = true;
      }
    });

    // 3. 创建已通过状态的合作申请记录（直接建立合作，无需二次审批）
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    applications.push({
      applicationId: `COOP-APP-${Date.now()}`,
      purchaserUsername: purchaserUsername,
      purchaserCompanyName: currentUser.companyName || purchaserUsername,
      purchaserCompanyId: currentUser.companyId || '',
      purchaserContact: currentUser.contactPerson || '',
      purchaserPhone: currentUser.phone || '',
      targetSupplierName: tokenData.supplierName,
      targetSupplierId: tokenData.supplierId,
      canDirectApprove: true,
      applyDate: now,
      status: 'approved',
      remark: '采购商通过邀约链接直接建立合作',
      type: 'cooperation',
      inviteToken: token,
      customerId: tokenData.customerId || '',
      purchaserSupplierEntryId,
    });
    localStorage.setItem('cooperation_applications', JSON.stringify(applications));
    window.dispatchEvent(new Event('cooperation-applications-changed'));

    // 4. 更新采购商的供应商列表状态为 approved（直接合作）
    // 如果列表中没有对应条目（采购商是通过链接直接申请的），则自动新增一条
    const storageKey = `purchaser_suppliers_${purchaserUsername}`;
    try {
      const suppliers: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const existingIdx = suppliers.findIndex(
        (s: any) => s.cooperationToken === token || s.id === tokenData.supplierId || s.id === purchaserSupplierEntryId
      );
      if (existingIdx >= 0) {
        suppliers[existingIdx] = {
          ...suppliers[existingIdx],
          cooperationStatus: 'approved',
          cooperationDate: dayjs().format('YYYY-MM-DD'),
          cooperationToken: token,
        };
      } else {
        // 列表中无此供应商条目，自动新增为已合作
        suppliers.unshift({
          id: tokenData.supplierId || `SP-${Date.now()}`,
          supplierName: tokenData.supplierName,
          shortName: '',
          contactPerson: '',
          contactPhone: '',
          email: '',
          cooperationStatus: 'approved',
          cooperationDate: dayjs().format('YYYY-MM-DD'),
          addedDate: now,
          cooperationToken: token,
          remark: '通过邀约链接直接建立合作',
          purchaserCompanyId: '',
        });
      }
      localStorage.setItem(storageKey, JSON.stringify(suppliers));
    } catch { /* ignore */ }

    // 5. 将采购商企业信息添加到供应商的客户基础信息列表
    try {
      const boundStorageKey = 'boundPurchasers_' + tokenData.supplierId;
      const boundPurchasers: any[] = JSON.parse(localStorage.getItem(boundStorageKey) || '[]');
      const purchaserCompany = currentUser.companyName || purchaserUsername;
      const purchaserInfo = {
        purchaserContact: currentUser.contactPerson || '',
        purchaserPhone: currentUser.phone || '',
        legalPerson: currentUser.legalPerson || '',
        wechatQr: currentUser.wechatQr || '',
        businessAddress: currentUser.businessAddress || '',
        email: currentUser.email || '',
      };
      const existingIdx = boundPurchasers.findIndex(
        (bp: any) => bp.purchaserName === purchaserCompany
      );
      if (existingIdx >= 0) {
        // 已存在的采购商（如曾终止合作后重新合作），更新状态和企业信息
        boundPurchasers[existingIdx] = {
          ...boundPurchasers[existingIdx],
          status: 'approved',
          bindDate: dayjs().format('YYYY-MM-DD'),
          purchaserUsername: purchaserUsername,
          ...purchaserInfo,
        };
      } else {
        boundPurchasers.push({
          key: `bp-${Date.now()}`,
          id: `BIND-${Date.now()}`,
          purchaserName: purchaserCompany,
          purchaserUsername: purchaserUsername,
          ...purchaserInfo,
          bindDate: dayjs().format('YYYY-MM-DD'),
          status: 'approved',
        });
      }
      localStorage.setItem(boundStorageKey, JSON.stringify(boundPurchasers));
      window.dispatchEvent(new Event('bound-purchasers-changed'));
    } catch { /* ignore */ }

    // 6. 如果链接关联了客户ID（供应商从客户信息页发起的邀约），更新对应客户类型
    if (tokenData.customerId) {
      try {
        const customerStorageKey = 'customers_' + tokenData.supplierId;
        const customers: any[] = JSON.parse(localStorage.getItem(customerStorageKey) || '[]');
        const custIdx = customers.findIndex((c: any) => c.id === tokenData.customerId);
        if (custIdx >= 0) {
          customers[custIdx] = {
            ...customers[custIdx],
            type: '合作客户',
            cooperationDate: dayjs().format('YYYY-MM-DD'),
          };
          localStorage.setItem(customerStorageKey, JSON.stringify(customers));
        }
      } catch { /* ignore */ }
    }

    setProcessed(true);
    message.success('合作关系已建立，双方合作即时生效');
  };

  // 拒绝合作
  const handleReject = () => {
    if (!tokenData) return;

    const purchaserUsername = localStorage.getItem('username') || '';

    // 更新令牌状态
    const tokens: CooperationToken[] = JSON.parse(
      localStorage.getItem('cooperation_tokens') || '[]'
    );
    const updatedTokens = tokens.map((t) =>
      t.token === token ? { ...t, status: 'rejected' as const } : t
    );
    localStorage.setItem('cooperation_tokens', JSON.stringify(updatedTokens));

    // 更新采购商的供应商列表
    if (purchaserUsername) {
      const storageKey = `purchaser_suppliers_${purchaserUsername}`;
      try {
        const suppliers = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const updatedSuppliers = suppliers.map((s: any) =>
          s.cooperationToken === token || s.id === tokenData.supplierId
            ? { ...s, cooperationStatus: 'rejected', cooperationDate: dayjs().format('YYYY-MM-DD') }
            : s
        );
        localStorage.setItem(storageKey, JSON.stringify(updatedSuppliers));
      } catch { /* ignore */ }
    }

    setProcessed(true);
    message.error('已拒绝合作');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!tokenData) {
    return (
      <div style={{ padding: '50px', textAlign: 'center' }}>
        <Title level={3} type="danger">无效的合作链接</Title>
        <Paragraph>该链接已失效或不存在，请联系供应商重新获取。</Paragraph>
        <Button type="primary" onClick={() => navigate('/login')}>
          返回登录
        </Button>
      </div>
    );
  }

  if (tokenData.status !== 'pending') {
    return (
      <div style={{ padding: '50px', textAlign: 'center' }}>
        <Title level={3}>
          {tokenData.status === 'approved' ? (
            <span style={{ color: '#52c41a' }}><CheckCircleOutlined /> 已建立合作</span>
          ) : (
            <span style={{ color: '#ff4d4f' }}><CloseCircleOutlined /> 已拒绝</span>
          )}
        </Title>
        <Paragraph>
          该合作申请已被{tokenData.status === 'approved' ? '确认，合作关系已建立' : '拒绝'}。
        </Paragraph>
        <Button type="primary" onClick={() => navigate('/login')}>
          返回登录
        </Button>
      </div>
    );
  }

  if (processed) {
    return (
      <div style={{ padding: '50px', textAlign: 'center' }}>
        <Title level={3} type="success">
          <CheckCircleOutlined /> 合作已建立
        </Title>
        <Paragraph>合作关系已成功建立，双方合作即时生效。</Paragraph>
        <Button type="primary" onClick={() => navigate('/purchaser/cooperation')}>
          返回供应商管理
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: '50px', maxWidth: 800, margin: '0 auto' }}>
      <Card>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 30 }}>
          <LinkOutlined style={{ marginRight: 8 }} />
          合作确认
        </Title>

        <Descriptions bordered column={1} size="small" style={{ marginBottom: 30 }}>
          <Descriptions.Item label="供应商名称">{tokenData.supplierName}</Descriptions.Item>
          <Descriptions.Item label="邀请时间">{tokenData.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="合作状态">
            <Tag color="processing">待确认</Tag>
          </Descriptions.Item>
        </Descriptions>

        <Paragraph style={{ textAlign: 'center', fontSize: 16, marginBottom: 16 }}>
          供应商 <Text strong>{tokenData.supplierName}</Text> 邀请您建立合作关系，
          <br />
          请确认是否同意该合作申请。
        </Paragraph>
        <Paragraph style={{ textAlign: 'center', fontSize: 13, marginBottom: 30, color: '#999' }}>
          请确保您已以采购商身份登录。确认后合作关系将立即建立，无需额外审批。
        </Paragraph>

        <div style={{ textAlign: 'center' }}>
          <Space size="large">
            <Button
              type="primary"
              size="large"
              icon={<CheckCircleOutlined />}
              onClick={handleApprove}
              style={{ minWidth: 150 }}
            >
              同意合作
            </Button>
            <Button
              danger
              size="large"
              icon={<CloseCircleOutlined />}
              onClick={handleReject}
              style={{ minWidth: 150 }}
            >
              拒绝合作
            </Button>
          </Space>
        </div>
      </Card>
    </div>
  );
};

export default PurchaserCooperationConfirmPage;
