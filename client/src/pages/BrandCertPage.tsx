import React, { useEffect, useState } from 'react';
import { Card, Spin, Result, Descriptions, Button, Space, Image as AntdImage, Typography } from 'antd';
import { DownloadOutlined, PrinterOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { fetchCertByShareCode, BrandCertView, printHtml } from '../utils/brandAuth';

const { Title, Text } = Typography;
const PRIMARY = '#1e4a7e';

/**
 * 授权书公开查询页（无需登录）
 * 路由 /brand-cert/:shareCode，shareCode 为品牌方出具授权书时生成的随机凭证
 */
const BrandCertPage: React.FC = () => {
  const { shareCode = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [cert, setCert] = useState<BrandCertView | null>(null);

  useEffect(() => {
    (async () => {
      const c = await fetchCertByShareCode(shareCode);
      setCert(c);
      setLoading(false);
    })();
  }, [shareCode]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', background: '#f0f2f5', minHeight: '100vh' }}><Spin size="large" tip="加载中..." /></div>;

  if (!cert || !cert.certImage) {
    return (
      <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
        <Card style={{ maxWidth: 640, margin: '40px auto' }}>
          <Result status="info" title="授权书尚未出具" subTitle="品牌方出具授权书后即可凭本链接查看，请稍后再试或联系品牌方。" />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      <Card style={{ maxWidth: 860, margin: '24px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <SafetyCertificateOutlined style={{ fontSize: 36, color: PRIMARY }} />
          <Title level={3} style={{ margin: '8px 0 0', color: PRIMARY }}>品牌授权书</Title>
          <Text type="secondary">{cert.ownerCompany} 出具</Text>
        </div>

        <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="被授权公司" span={2}>{cert.companyName}</Descriptions.Item>
          <Descriptions.Item label="授权品牌">{cert.brandName || '—'}</Descriptions.Item>
          <Descriptions.Item label="授权编号">{cert.authNo || '—'}</Descriptions.Item>
          <Descriptions.Item label="授权平台">{cert.platform || '—'}</Descriptions.Item>
          <Descriptions.Item label="店铺名称">{cert.shopName || '—'}</Descriptions.Item>
          <Descriptions.Item label="有效期" span={2}>{cert.validFrom ? `${cert.validFrom} 至 ${cert.validTo}` : '—'}</Descriptions.Item>
          <Descriptions.Item label="状态">{cert.status}</Descriptions.Item>
          <Descriptions.Item label="出具日期">{cert.issuedAt || '—'}</Descriptions.Item>
        </Descriptions>

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <AntdImage src={cert.certImage} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid #eee' }} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <Space>
            <Button type="primary" icon={<DownloadOutlined />}
              onClick={() => { const a = document.createElement('a'); a.href = cert.certImage; a.download = `授权书-${cert.authNo || cert.brandName || 'brand'}.jpg`; a.click(); }}>
              下载授权书
            </Button>
            {cert.certHtml && <Button icon={<PrinterOutlined />} onClick={() => printHtml(cert.certHtml)}>打印</Button>}
          </Space>
        </div>
      </Card>
    </div>
  );
};

export default BrandCertPage;
