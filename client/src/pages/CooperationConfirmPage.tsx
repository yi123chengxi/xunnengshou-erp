import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, message, Space, Typography, Descriptions, Tag, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LinkOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { ensureDatasetFromServer } from '../utils/serverSync';
import { safeSetItem } from '../utils/storageQuota';

const { Title, Text, Paragraph } = Typography;

/** 合作令牌存储结构 */
interface CooperationToken {
  token: string;
  purchaserName: string;
  purchaserCompany: string;
  purchaserContact: string;
  purchaserPhone: string;
  supplierName: string;
  supplierId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const CooperationConfirmPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tokenData, setTokenData] = useState<CooperationToken | null>(null);
  const [processed, setProcessed] = useState(false);

  const loadToken = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    const readLocal = (): CooperationToken | null => {
      // 优先读单令牌键（已上云）：采购商生成链接时写入，供应商在本机/他端都能拿到
      try {
        const single = localStorage.getItem(`cooperation_token_${token}`);
        if (single) {
          const rec = JSON.parse(single);
          if (rec && rec.token === token) return rec as CooperationToken;
        }
      } catch { /* ignore */ }
      try {
        const coopTokens: any[] = JSON.parse(localStorage.getItem('cooperation_tokens') || '[]');
        const supplierTokens: any[] = JSON.parse(localStorage.getItem('supplier_cooperation_tokens') || '[]');

        const normalizedSupplierTokens = supplierTokens.map((t: any) => ({
          token: t.token,
          purchaserName: t.purchaserName || '',
          purchaserCompany: t.purchaserCompany || '',
          purchaserContact: t.purchaserContact || '',
          purchaserPhone: '',
          supplierName: t.supplierCompany || t.supplierName || '',
          supplierId: t.supplierUsername || t.supplierId || '',
          status: t.status,
          createdAt: t.createdAt || '',
        }));

        const allTokens = [...coopTokens, ...normalizedSupplierTokens];
        return (allTokens.find((t) => t.token === token) as CooperationToken) || null;
      } catch { return null; }
    };
    try {
      let found = readLocal();
      if (!found) {
        // 链接常由供应商在自己的电脑打开：本地无此令牌时按 URL 中的 token 从服务端精确拉取
        await ensureDatasetFromServer(`cooperation_token_${token}`);
        found = readLocal();
      }
      setTokenData(found);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadToken();
  }, [loadToken]);

  // 写回令牌状态：单令牌键会随同步上传（采购商端可拉到最新结果），本机列表仅作旧流程兼容
  const persistTokenStatus = (status: 'approved' | 'rejected') => {
    if (!token) return;
    try {
      const raw = localStorage.getItem(`cooperation_token_${token}`);
      const rec = raw ? JSON.parse(raw) : tokenData;
      if (rec) safeSetItem(`cooperation_token_${token}`, JSON.stringify({ ...rec, status }));
    } catch { /* ignore */ }
    try {
      const tokens: CooperationToken[] = JSON.parse(localStorage.getItem('cooperation_tokens') || '[]');
      const updatedTokens = tokens.map((t) => (t.token === token ? { ...t, status } : t));
      safeSetItem('cooperation_tokens', JSON.stringify(updatedTokens));
    } catch { /* ignore */ }
  };

  // 供应商同意合作
  const handleApprove = () => {
    if (!tokenData) return;

    // 获取当前登录的供应商信息
    const supplierUsername = localStorage.getItem('username') || '';
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentSupplier = registeredUsers.find((u: any) => u.username === supplierUsername);

    if (!supplierUsername || !currentSupplier) {
      message.error('请先以供应商身份登录');
      return;
    }

    // 1. 更新令牌状态（单令牌键同步上云）
    persistTokenStatus('approved');

    // 2. 更新采购商的供应商列表 - 标记为已合作，并同步供应商企业信息
    const storageKey = `purchaser_suppliers_${tokenData.purchaserName}`;
    try {
      const suppliers = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updatedSuppliers = suppliers.map((s: any) =>
        s.cooperationToken === token || s.id === tokenData.supplierId || s.id === (tokenData as any).purchaserSupplierEntryId
          ? {
              ...s,
              cooperationStatus: 'approved',
              cooperationDate: dayjs().format('YYYY-MM-DD'),
              supplierUsername: supplierUsername,
              supplierName: currentSupplier.companyName || s.supplierName,
              contactPerson: currentSupplier.contactPerson || s.contactPerson,
              contactPhone: currentSupplier.phone || s.contactPhone,
              email: currentSupplier.email || s.email,
              legalPerson: currentSupplier.legalPerson || s.legalPerson || '',
              wechatQr: currentSupplier.wechatQr || s.wechatQr || '',
              businessAddress: currentSupplier.businessAddress || s.businessAddress || '',
            }
          : s
      );
      localStorage.setItem(storageKey, JSON.stringify(updatedSuppliers));
    } catch { /* ignore */ }

    // 3. 作废旧的终止申请，避免 reloadData 误匹配
    const applications = JSON.parse(
      localStorage.getItem('cooperation_applications') || '[]'
    );
    const entryId = (tokenData as any).purchaserSupplierEntryId;
    applications.forEach((app: any) => {
      if (
        app.purchaserUsername === tokenData.purchaserName &&
        (app.targetSupplierName === tokenData.supplierName || app.targetSupplierId === tokenData.supplierId || (entryId && app.purchaserSupplierEntryId === entryId)) &&
        app.type === 'terminate' &&
        app.status === 'approved'
      ) {
        app.superseded = true;
      }
    });

    // 4. 创建合作申请记录（已通过状态）
    applications.push({
      applicationId: `COOP-APP-${Date.now()}`,
      purchaserUsername: tokenData.purchaserName,
      purchaserCompanyName: tokenData.purchaserCompany,
      purchaserCompanyId: '',
      purchaserContact: '',
      purchaserPhone: tokenData.purchaserPhone,
      targetSupplierName: currentSupplier.companyName || tokenData.supplierName,
      targetSupplierId: supplierUsername,
      purchaserSupplierEntryId: (tokenData as any).purchaserSupplierEntryId || '',
      canDirectApprove: true,
      applyDate: tokenData.createdAt,
      status: 'approved',
      remark: '供应商通过链接确认合作',
      type: 'cooperation',
    });
    localStorage.setItem('cooperation_applications', JSON.stringify(applications));
    window.dispatchEvent(new Event('cooperation-applications-changed'));

    // 5. 将采购商企业信息添加到供应商的客户基础信息列表
    try {
      const boundStorageKey = 'boundPurchasers_' + supplierUsername;
      const boundPurchasers: any[] = JSON.parse(localStorage.getItem(boundStorageKey) || '[]');
      const purchaserCompany = tokenData.purchaserCompany || tokenData.purchaserName;
      // 查找采购商的完整企业信息
      const purchaserUser = registeredUsers.find((u: any) => u.username === tokenData.purchaserName);
      const purchaserInfo = {
        purchaserContact: purchaserUser?.contactPerson || tokenData.purchaserContact || '',
        purchaserPhone: purchaserUser?.phone || tokenData.purchaserPhone || '',
        legalPerson: purchaserUser?.legalPerson || '',
        wechatQr: purchaserUser?.wechatQr || '',
        businessAddress: purchaserUser?.businessAddress || '',
        email: purchaserUser?.email || '',
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
          purchaserUsername: tokenData.purchaserName,
          ...purchaserInfo,
        };
      } else {
        boundPurchasers.push({
          key: `bp-${Date.now()}`,
          id: `BIND-${Date.now()}`,
          purchaserName: purchaserCompany,
          purchaserUsername: tokenData.purchaserName,
          ...purchaserInfo,
          bindDate: dayjs().format('YYYY-MM-DD'),
          status: 'approved',
        });
      }
      localStorage.setItem(boundStorageKey, JSON.stringify(boundPurchasers));
      window.dispatchEvent(new Event('bound-purchasers-changed'));
    } catch { /* ignore */ }

    setProcessed(true);
    message.success('已同意合作，合作关系已建立');
  };

  // 供应商拒绝合作
  const handleReject = () => {
    if (!tokenData) return;

    // 更新令牌状态（单令牌键同步上云）
    persistTokenStatus('rejected');

    // 更新采购商的供应商列表
    const storageKey = `purchaser_suppliers_${tokenData.purchaserName}`;
    try {
      const suppliers = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updatedSuppliers = suppliers.map((s: any) =>
        s.cooperationToken === token || s.id === tokenData.supplierId
          ? { ...s, cooperationStatus: 'rejected', cooperationDate: dayjs().format('YYYY-MM-DD') }
          : s
      );
      localStorage.setItem(storageKey, JSON.stringify(updatedSuppliers));
    } catch { /* ignore */ }

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
        <Paragraph>该链接已失效或不存在，请联系采购商重新获取；若您是供应商，请先登录后再打开该链接。</Paragraph>
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
            <span style={{ color: '#52c41a' }}><CheckCircleOutlined /> 已合作</span>
          ) : (
            <span style={{ color: '#ff4d4f' }}><CloseCircleOutlined /> 已拒绝</span>
          )}
        </Title>
        <Paragraph>
          该合作申请已被{tokenData.status === 'approved' ? '同意' : '拒绝'}。
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
          <CheckCircleOutlined /> 操作成功
        </Title>
        <Paragraph>您已成功处理该合作申请。</Paragraph>
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          返回首页
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
          <Descriptions.Item label="采购商公司">{tokenData.purchaserCompany || '-'}</Descriptions.Item>
          <Descriptions.Item label="采购商联系人">{tokenData.purchaserContact || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{tokenData.purchaserPhone || '-'}</Descriptions.Item>
          <Descriptions.Item label="邀请时间">{tokenData.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="合作状态">
            <Tag color="processing">待确认</Tag>
          </Descriptions.Item>
        </Descriptions>

        <Paragraph style={{ textAlign: 'center', fontSize: 16, marginBottom: 16 }}>
          采购商 <Text strong>{tokenData.purchaserCompany || tokenData.purchaserName}</Text> 申请与您建立合作关系，
          <br />
          请确认是否同意该合作申请。
        </Paragraph>
        <Paragraph style={{ textAlign: 'center', fontSize: 13, marginBottom: 30, color: '#999' }}>
          请确保您已以供应商身份登录。同意后合作关系将立即建立。
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

export default CooperationConfirmPage;
