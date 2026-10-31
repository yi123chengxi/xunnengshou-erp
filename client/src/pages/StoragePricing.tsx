import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Typography,
  Button,
  Tag,
  Modal,
  message,
  Row,
  Col,
  Progress,
  Descriptions,
  Space,
  Table,
  Empty,
  Statistic,
  Alert,
} from 'antd';
import {
  CheckCircleOutlined,
  CrownOutlined,
  ShoppingCartOutlined,
  DatabaseOutlined,
  ArrowLeftOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { STORAGE_SUBSCRIBE_DISABLED } from '../utils/billingPolicy';
import {
  getUserQuota,
  setUserQuota,
  getUsagePercent,
  formatStorageSize,
  gbToKb,
  kbToGb,
  getUsageBreakdown,
  rescanUsage,
} from '../utils/storageQuota';

const { Title, Text } = Typography;

const PRIMARY = '#1e4a7e';
const ACCENT = '#faad14';

// ========== 套餐定义 ==========
interface PricingTier {
  key: string;
  name: string;
  sizeGB: number;
  price: number;
  originalPrice: number;
  popular?: boolean;
  color?: string;
  features: string[];
}

export const PRICING_TIERS: PricingTier[] = [
  {
    key: '1g',
    name: '基础版',
    sizeGB: 1,
    price: 9.9,
    originalPrice: 19.9,
    features: ['1GB 存储空间', '基础数据管理', '标准技术支持'],
  },
  {
    key: '5g',
    name: '标准版',
    sizeGB: 5,
    price: 29.9,
    originalPrice: 49.9,
    features: ['5GB 存储空间', '完整数据管理', '优先技术支持'],
  },
  {
    key: '10g',
    name: '专业版',
    sizeGB: 10,
    price: 49.9,
    originalPrice: 79.9,
    popular: true,
    color: '#1890ff',
    features: ['10GB 存储空间', '高级数据分析', 'API 接口支持', '7x24 技术支持'],
  },
  {
    key: '50g',
    name: '企业版',
    sizeGB: 50,
    price: 149.9,
    originalPrice: 249.9,
    features: ['50GB 存储空间', '全部高级功能', '专属客户经理', '定制化报表', '数据备份保障'],
  },
  {
    key: '100g',
    name: '旗舰版',
    sizeGB: 100,
    price: 249.9,
    originalPrice: 399.9,
    features: ['100GB 存储空间', '全部高级功能', '专属客户经理', '定制化报表', '数据备份保障', 'SLA 99.9%'],
  },
  {
    key: '512g',
    name: '超大规模版',
    sizeGB: 512,
    price: 799.9,
    originalPrice: 1299.9,
    features: ['512GB 存储空间', '无限 API 调用', '专属运维团队', '私有化部署支持'],
  },
  {
    key: '1t',
    name: '1TB 至尊版',
    sizeGB: 1024,
    price: 1299.9,
    originalPrice: 2199.9,
    features: ['1TB 海量存储', '企业级数据中台', '无限子账号', '专属运维团队', '私有化部署', '定制开发'],
  },
  {
    key: '5t',
    name: '5TB 旗舰版',
    sizeGB: 5120,
    price: 3999.9,
    originalPrice: 5999.9,
    features: ['5TB 超大存储', '全部至尊功能', '首席架构师支持', '全球加速节点'],
  },
  {
    key: '10t',
    name: '10TB 至尊版',
    sizeGB: 10240,
    price: 5999.9,
    originalPrice: 8999.9,
    features: ['10TB 超大存储', '全部至尊功能', '首席架构师支持', '全球加速节点', '灾备容灾'],
  },
  {
    key: '16t',
    name: '16TB 顶级版',
    sizeGB: 16384,
    price: 7999.9,
    originalPrice: 12999.9,
    features: ['16TB 顶级存储', '无限存储空间扩展', '专属技术团队', '全球多活部署', '99.99% SLA保障'],
  },
];

// ========== 订单记录 ==========
interface OrderRecord {
  id: string;
  username: string;
  tierName: string;
  sizeGB: number;
  price: number;
  orderTime: string;
  // 升级差价模型：旧套餐按剩余天数退款抵扣
  status?: string;          // 已退款 = 被新套餐替换并退款
  refundAmount?: number;    // 旧套餐实退金额
  refundTime?: string;
  planPrice?: number;       // 新套餐目录月费（price 为实付差价）
  refundCredit?: number;    // 抵扣的旧套餐退款
}

// 空间套餐计费周期（天），与月费口径一致
const CYCLE_DAYS = 30;

function loadOrders(): OrderRecord[] {
  try {
    return JSON.parse(localStorage.getItem('storage_orders') || '[]');
  } catch {
    return [];
  }
}

function saveOrders(orders: OrderRecord[]) {
  localStorage.setItem('storage_orders', JSON.stringify(orders));
}

const StoragePricing: React.FC = () => {
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || '';
  const companyName = localStorage.getItem('companyName') || '';

  const [used, setUsed] = useState(0);
  const [quota, setQuota] = useState(0);
  const [percent, setPercent] = useState(0);
  const [localKB, setLocalKB] = useState(0);
  const [serverKB, setServerKB] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTier, setConfirmTier] = useState<PricingTier | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    refreshUsage();
    setOrders(loadOrders().filter((o) => o.username === username));
  }, []);

  // 用量分解：本地表单缓存（增量账本） + 服务端数据库（增量计数器）
  const refreshUsage = (force = false) => {
    getUsageBreakdown(username, force).then((b) => {
      const q = getUserQuota(username);
      setUsed(b.totalKB);
      setLocalKB(b.localKB);
      setServerKB(b.serverKB);
      setQuota(q);
      setPercent(getUsagePercent(b.totalKB, q));
    });
  };

  // 重新扫描：本地全量重扫 + 服务端单遍全量重算
  const handleRescan = () => {
    setScanning(true);
    rescanUsage(username).then((b) => {
      const q = getUserQuota(username);
      setUsed(b.totalKB);
      setLocalKB(b.localKB);
      setServerKB(b.serverKB);
      setQuota(q);
      setPercent(getUsagePercent(b.totalKB, q));
      setScanning(false);
      message.success('重新扫描完成：已覆盖全部表单与数据库');
    });
  };

  // 当前套餐是叠加的，所以是累计总配额
  const currentQuotaGB = kbToGb(quota);

  // 当前生效套餐 = 最近一笔未退款订单（升级时对它按剩余天数退款）
  const currentPlan = useMemo(() => {
    const mine = orders.filter((o) => o.status !== '已退款');
    return mine.length ? mine[mine.length - 1] : null;
  }, [orders]);

  // 旧套餐剩余天数折算可退金额 + 新套餐实付差价
  const refundInfo = useMemo(() => {
    if (!confirmTier) return null;
    if (!currentPlan) return { remainDays: 0, credit: 0, paid: confirmTier.price };
    const cycleEnd = dayjs(currentPlan.orderTime).add(CYCLE_DAYS, 'day');
    const remainRaw = Math.max(0, Math.min(CYCLE_DAYS, cycleEnd.diff(dayjs(), 'day', true)));
    const credit = Math.round(currentPlan.price * (remainRaw / CYCLE_DAYS) * 100) / 100;
    const paid = Math.max(0, Math.round((confirmTier.price - credit) * 100) / 100);
    return { remainDays: Math.ceil(remainRaw), credit, paid };
  }, [currentPlan, confirmTier]);

  const handleBuy = (tier: PricingTier) => {
    setConfirmTier(tier);
    setConfirmVisible(true);
  };

  const handleConfirm = () => {
    if (!confirmTier) return;
    setLoading(true);

    // 模拟支付延迟
    setTimeout(() => {
      const credit = refundInfo?.credit || 0;
      const paid = refundInfo ? refundInfo.paid : confirmTier.price;
      // 替换式升级：移除旧套餐空间、加入新套餐空间
      const oldKB = currentPlan ? gbToKb(currentPlan.sizeGB) : 0;
      const newQuotaKB = quota - oldKB + gbToKb(confirmTier.sizeGB);
      if (newQuotaKB < used) {
        setLoading(false);
        message.error(`已用空间 ${formatStorageSize(used)} 超出新套餐配额，无法订购`);
        return;
      }
      setUserQuota(username, newQuotaKB);

      const allOrders = loadOrders();
      // 旧套餐退款处理
      if (currentPlan) {
        const i = allOrders.findIndex((o) => o.id === currentPlan.id);
        if (i >= 0) {
          allOrders[i] = { ...allOrders[i], status: '已退款', refundAmount: credit, refundTime: new Date().toISOString() };
        }
      }
      // 记录新订单（price = 实付差价）
      const order: OrderRecord = {
        id: `ORD${Date.now()}`,
        username,
        tierName: confirmTier.name,
        sizeGB: confirmTier.sizeGB,
        price: paid,
        planPrice: confirmTier.price,
        refundCredit: credit,
        orderTime: new Date().toISOString(),
      };
      allOrders.push(order);
      saveOrders(allOrders);
      setOrders(allOrders.filter((o) => o.username === username));

      setConfirmVisible(false);
      setConfirmTier(null);
      setLoading(false);
      refreshUsage();

      message.success(
        credit > 0
          ? `成功订购「${confirmTier.name}」，旧套餐按剩余天数退款 ¥${credit.toFixed(2)} 抵扣，实付差价 ¥${paid.toFixed(2)}！`
          : `成功订购「${confirmTier.name}」(${confirmTier.sizeGB >= 1024 ? (confirmTier.sizeGB / 1024).toFixed(0) + 'TB' : confirmTier.sizeGB + 'GB'})，空间已生效！`,
      );
    }, 800);
  };

  // 订单表格列
  const orderColumns = [
    { title: '订单号', dataIndex: 'id', key: 'id', width: 180 },
    { title: '套餐', dataIndex: 'tierName', key: 'tierName' },
    {
      title: '空间',
      dataIndex: 'sizeGB',
      key: 'sizeGB',
      render: (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(0)}TB` : `${v}GB`),
    },
    {
      title: '金额',
      dataIndex: 'price',
      key: 'price',
      render: (v: number, o: OrderRecord) =>
        o.status === '已退款' ? (
          <Text delete type="secondary">¥{v.toFixed(2)}</Text>
        ) : (
          <span>
            <span style={{ color: '#ff4d4f', fontWeight: 600 }}>¥{v.toFixed(2)}</span>
            {o.refundCredit ? <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>(差价)</Text> : null}
          </span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string, o: OrderRecord) =>
        v === '已退款' ? (
          <Tag color="orange">已退款 ¥{(o.refundAmount || 0).toFixed(2)}</Tag>
        ) : (
          <Tag color="green">已支付</Tag>
        ),
    },
    {
      title: '订购时间',
      dataIndex: 'orderTime',
      key: 'orderTime',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1360, margin: '0 auto' }}>
      {/* 顶部导航 */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={() => navigate(-1)}
        >
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          <ShoppingCartOutlined style={{ marginRight: 8 }} />
          空间订购中心
        </Title>
      </div>

      {STORAGE_SUBSCRIBE_DISABLED && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message="空间订购通道暂未开放"
          description="免费期内所有租户默认赠送 10G 空间，无需订购；收费通道上线后再恢复自助订购。"
        />
      )}

      {/* 当前使用情况卡片 */}
      <Card
        style={{ marginBottom: 24, borderRadius: 12 }}
        extra={
          <Button icon={<ReloadOutlined />} loading={scanning} onClick={handleRescan}>
            重新扫描
          </Button>
        }
      >
        <Descriptions column={2} size="middle" bordered style={{ marginBottom: 20 }}>
          <Descriptions.Item label="当前账号">{username}</Descriptions.Item>
          <Descriptions.Item label="企业名称">{companyName || '-'}</Descriptions.Item>
          <Descriptions.Item label="已用空间">
            <Text strong style={{ color: percent > 90 ? '#ff4d4f' : PRIMARY }}>
              {formatStorageSize(used)}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="当前总额配">
            <Tag color="blue">{formatStorageSize(quota)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="本地表单缓存">
            <Text type="secondary">{formatStorageSize(localKB)}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="服务器数据库">
            <Text type="secondary">{formatStorageSize(serverKB)}</Text>
          </Descriptions.Item>
        </Descriptions>

        {/* 线性进度条 */}
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>空间使用率</Text>
          <Text strong style={{ fontSize: 16, color: percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : '#52c41a' }}>
            {percent.toFixed(1)}%
          </Text>
        </div>
        <Progress
          percent={percent}
          showInfo={false}
          strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : { '0%': '#52c41a', '100%': '#1890ff' }}
          trailColor="#f0f0f0"
          strokeWidth={14}
          strokeLinecap="round"
          style={{ marginBottom: 4 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            已使用 {formatStorageSize(used)}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            总额配 {formatStorageSize(quota)}
          </Text>
        </div>
      </Card>

      {/* 套餐定价 */}
      <Card
        title={
          <span>
            <CrownOutlined style={{ marginRight: 8, color: ACCENT }} />
            空间升级套餐
          </span>
        }
        style={{ borderRadius: 12, marginBottom: 24 }}
      >
        <Row gutter={[16, 16]}>
          {PRICING_TIERS.map((tier) => {
            const isCurrentQuotaTier = tier.sizeGB <= currentQuotaGB;
            return (
              <Col xs={24} sm={12} md={8} lg={6} xl={Math.floor(24 / 5)} key={tier.key}>
                <Card
                  hoverable
                  style={{
                    borderRadius: 12,
                    border: tier.popular ? `2px solid ${tier.color || ACCENT}` : '1px solid #f0f0f0',
                    height: '100%',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  bodyStyle={{ padding: '20px 16px' }}
                >
                  {tier.popular && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: -32,
                        background: tier.color || ACCENT,
                        color: '#fff',
                        padding: '2px 36px',
                        transform: 'rotate(45deg)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      推荐
                    </div>
                  )}
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <DatabaseOutlined
                      style={{
                        fontSize: 36,
                        color: tier.color || PRIMARY,
                        marginBottom: 8,
                      }}
                    />
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{tier.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: tier.color || PRIMARY }}>
                      {tier.sizeGB >= 1024 ? `${(tier.sizeGB / 1024).toFixed(0)}TB` : `${tier.sizeGB}GB`}
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color: '#ff4d4f' }}>
                      ¥{tier.price.toFixed(1)}
                    </span>
                    <span style={{ fontSize: 12, color: '#999' }}>/月</span>
                  </div>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <Text delete type="secondary" style={{ fontSize: 12 }}>
                      ¥{tier.originalPrice.toFixed(1)}/月
                    </Text>
                  </div>

                  <div style={{ marginBottom: 16, minHeight: 100 }}>
                    {tier.features.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#666', marginBottom: 4, paddingLeft: 8 }}>
                        <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                        {f}
                      </div>
                    ))}
                  </div>

                  <Button
                    block
                    icon={isCurrentQuotaTier ? undefined : <ShoppingCartOutlined />}
                    disabled={isCurrentQuotaTier || STORAGE_SUBSCRIBE_DISABLED}
                    onClick={() => handleBuy(tier)}
                    style={{
                      borderRadius: 8,
                      height: 42,
                      fontWeight: 700,
                      fontSize: 15,
                      border: isCurrentQuotaTier ? undefined : 'none',
                      background: STORAGE_SUBSCRIBE_DISABLED
                        ? '#d9d9d9'
                        : isCurrentQuotaTier
                          ? undefined
                          : 'linear-gradient(135deg, #f5a623 0%, #e8960a 50%, #d4890a 100%)',
                      color: STORAGE_SUBSCRIBE_DISABLED
                        ? 'rgba(0,0,0,0.45)'
                        : isCurrentQuotaTier
                          ? undefined
                          : '#fff',
                      boxShadow: isCurrentQuotaTier || STORAGE_SUBSCRIBE_DISABLED
                        ? undefined
                        : '0 4px 14px rgba(245, 166, 35, 0.45)',
                      transition: 'all 0.3s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrentQuotaTier && !STORAGE_SUBSCRIBE_DISABLED) {
                        const btn = e.currentTarget as HTMLElement;
                        btn.style.transform = 'translateY(-2px)';
                        btn.style.boxShadow = '0 6px 20px rgba(245, 166, 35, 0.6)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrentQuotaTier && !STORAGE_SUBSCRIBE_DISABLED) {
                        const btn = e.currentTarget as HTMLElement;
                        btn.style.transform = 'translateY(0)';
                        btn.style.boxShadow = '0 4px 14px rgba(245, 166, 35, 0.45)';
                      }
                    }}
                  >
                    {isCurrentQuotaTier ? '已包含' : STORAGE_SUBSCRIBE_DISABLED ? '暂不支持订购' : '立即订购'}
                  </Button>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      {/* 订购记录 */}
      <Card
        title={
          <span>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            我的订购记录
          </span>
        }
        style={{ borderRadius: 12 }}
      >
        {orders.length > 0 ? (
          <Table
            dataSource={orders}
            columns={orderColumns}
            rowKey="id"
            pagination={false}
            size="middle"
            locale={{ emptyText: '暂无订购记录' }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Text strong>累计消费</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} colSpan={2}>
                  <Text strong style={{ color: '#ff4d4f', fontSize: 16 }}>
                    ¥{orders.filter((o) => o.status !== '已退款').reduce((sum, o) => sum + o.price, 0).toFixed(2)}
                  </Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        ) : (
          <Empty description="暂无订购记录" />
        )}
      </Card>

      {/* 确认订购弹窗 */}
      <Modal
        title={
          <span>
            <ShoppingCartOutlined style={{ marginRight: 8 }} />
            确认订购
          </span>
        }
        open={confirmVisible}
        onCancel={() => {
          setConfirmVisible(false);
          setConfirmTier(null);
        }}
        footer={[
          <Button key="cancel" onClick={() => { setConfirmVisible(false); setConfirmTier(null); }}>
            取消
          </Button>,
          <Button key="confirm" type="primary" loading={loading} onClick={handleConfirm}>
            确认支付 ¥{(refundInfo ? refundInfo.paid : confirmTier?.price || 0).toFixed(2)}
          </Button>,
        ]}
      >
        {confirmTier && (
          <div>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="订购套餐">{confirmTier.name}</Descriptions.Item>
              <Descriptions.Item label="套餐空间">
                <Tag color="blue">{confirmTier.sizeGB >= 1024 ? `${(confirmTier.sizeGB / 1024).toFixed(0)}TB` : `${confirmTier.sizeGB}GB`}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="当前套餐">
                {currentPlan ? (
                  <span>
                    {currentPlan.tierName}
                    <Tag color="blue" style={{ marginLeft: 8 }}>剩余 {refundInfo?.remainDays || 0} 天</Tag>
                  </span>
                ) : <Text type="secondary">无（首次订购）</Text>}
              </Descriptions.Item>
              {currentPlan && (
                <Descriptions.Item label="旧套餐剩余可退">
                  <Text style={{ color: '#52c41a', fontWeight: 600 }}>-¥{(refundInfo?.credit || 0).toFixed(2)}</Text>
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    （按剩余天数折算，自动抵扣）
                  </Text>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="当前总额配">
                {formatStorageSize(quota)}
              </Descriptions.Item>
              <Descriptions.Item label="订购后总配额">
                <Tag color="green">
                  {formatStorageSize(quota - (currentPlan ? gbToKb(currentPlan.sizeGB) : 0) + gbToKb(confirmTier.sizeGB))}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="新套餐月费">
                <Text style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 16 }}>
                  ¥{confirmTier.price.toFixed(1)}
                </Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  (原价 ¥{confirmTier.originalPrice.toFixed(1)})
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="实付差价">
                <Text style={{ color: '#cf1322', fontWeight: 700, fontSize: 18 }}>
                  ¥{(refundInfo?.paid ?? confirmTier.price).toFixed(2)}
                </Text>
              </Descriptions.Item>
            </Descriptions>
            <Text type="secondary">
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              旧套餐按剩余天数自动退款抵扣新套餐费用，仅需支付差价；配额即刻生效，续费将在每月同一天自动扣款。
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default StoragePricing;
