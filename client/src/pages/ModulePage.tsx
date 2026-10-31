import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Statistic, Alert, Tag } from 'antd';
import {
  DatabaseOutlined,
  TeamOutlined,
  BarChartOutlined,
  ToolOutlined,
  ShoppingCartOutlined,
  InboxOutlined,
  DollarOutlined,
  FundOutlined,
  SettingOutlined,
  RightOutlined,
  ArrowUpOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { modules } from '../layouts/MainLayout';

const { Title, Text, Paragraph } = Typography;
const PRIMARY = '#1e4a7e';

const iconMap: Record<string, React.ReactNode> = {
  'basic-data': <DatabaseOutlined />,
  customer: <TeamOutlined />,
  sales: <BarChartOutlined />,
  production: <ToolOutlined />,
  purchase: <ShoppingCartOutlined />,
  inventory: <InboxOutlined />,
  finance: <DollarOutlined />,
  dashboard: <FundOutlined />,
  settings: <SettingOutlined />,
};

const mockStats: Record<string, { total: number; today: number; growth: number }> = {
  'basic-data': { total: 1258, today: 12, growth: 5.6 },
  customer: { total: 3260, today: 8, growth: 12.3 },
  sales: { total: 1580, today: 25, growth: 8.9 },
  production: { total: 892, today: 15, growth: 3.2 },
  purchase: { total: 645, today: 10, growth: -2.1 },
  inventory: { total: 2340, today: 18, growth: 6.7 },
  finance: { total: 412, today: 6, growth: 4.5 },
  dashboard: { total: 1560, today: 22, growth: 7.8 },
  settings: { total: 15, today: 0, growth: 0 },
};

// 模块间业务关联关系
const moduleRelations: Record<string, { moduleKey: string; relation: string }[]> = {
  'basic-data': [
    { moduleKey: 'production', relation: '基础数据是生产管理的核心输入——半成品和工艺路线决定生产工单的物料和工序' },
    { moduleKey: 'purchase', relation: '半成品的物料清单驱动MRP运算，生成采购需求计划' },
    { moduleKey: 'sales', relation: '产品基础信息和定价是销售报价和订单的数据基础' },
    { moduleKey: 'inventory', relation: '产品编码和物料信息是库存管理的核心标识' },
  ],
  customer: [
    { moduleKey: 'sales', relation: '客户是销售订单的主体，客户等级和信用影响订单审核流程' },
    { moduleKey: 'basic-data', relation: '客户需求驱动新款研发流程，产出新半成品和工艺路线' },
    { moduleKey: 'finance', relation: '客户信用额度和回款记录影响应收账款管理' },
  ],
  sales: [
    { moduleKey: 'customer', relation: '销售订单关联客户，RFM分析和客户画像基于销售数据' },
    { moduleKey: 'production', relation: '销售订单确认后生成生产工单，驱动生产计划排程' },
    { moduleKey: 'finance', relation: '销售收入和毛利率是财务分析的核心数据来源' },
    { moduleKey: 'inventory', relation: '销售出库扣减成品库存，销量预测指导库存策略' },
  ],
  production: [
    { moduleKey: 'basic-data', relation: '生产工单引用半成品领料，参照工艺路线排工序' },
    { moduleKey: 'purchase', relation: '生产缺料触发紧急采购需求，外协工序产生委外订单' },
    { moduleKey: 'inventory', relation: '生产完工入库更新库存，生产日报关联入库数据' },
    { moduleKey: 'sales', relation: '生产进度影响订单交付，交货期提醒关联客户满意度' },
  ],
  purchase: [
    { moduleKey: 'basic-data', relation: 'MRP基于BOM计算物料净需求，生成采购建议' },
    { moduleKey: 'production', relation: '采购到货影响生产开工，物料延期导致生产计划调整' },
    { moduleKey: 'inventory', relation: '采购入库更新库存数量和成本，到货预警关联库存安全' },
    { moduleKey: 'finance', relation: '采购成本波动影响产品毛利率，入库后生成应付账款' },
  ],
  inventory: [
    { moduleKey: 'production', relation: '生产入库和领料出库是库存变动的主要来源' },
    { moduleKey: 'purchase', relation: '采购到货入库增加库存，安全库存预警触发采购补货' },
    { moduleKey: 'sales', relation: '销售出库扣减库存，库存预警影响订单交付承诺' },
    { moduleKey: 'finance', relation: '库存期初期末数据是成本核算和资产评估的基础' },
  ],
  finance: [
    { moduleKey: 'purchase', relation: '采购经营分析和成本波动直接影响利润核算' },
    { moduleKey: 'sales', relation: '销售收入确认和毛利率计算是财务核心工作' },
    { moduleKey: 'inventory', relation: '库存盘点差异调整资产价值，库存周转率影响现金流' },
    { moduleKey: 'production', relation: '生产成本归集和核算依赖生产工单的实际工时和用料' },
  ],
  dashboard: [
    { moduleKey: 'sales', relation: '经营看板汇总销售数据，全局监控企业经营指标' },
    { moduleKey: 'production', relation: '看板展示生产完工率和订单执行全局进度' },
    { moduleKey: 'purchase', relation: '看板监控采购到货情况和供应商交付绩效' },
    { moduleKey: 'inventory', relation: '看板展示库存预警和周转率等关键库存指标' },
    { moduleKey: 'finance', relation: '看板呈现核心财务指标：收入、成本、利润趋势' },
  ],
  settings: [
    { moduleKey: 'basic-data', relation: '账号权限控制基础数据的查看和编辑范围' },
    { moduleKey: 'finance', relation: '财务数据敏感度高，需通过账号权限进行访问控制' },
  ],
};

const ModulePage: React.FC = () => {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const navigate = useNavigate();

  const currentModule = modules.find(m => m.key === moduleKey);

  if (!currentModule) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Title level={4}>模块未找到</Title>
      </div>
    );
  }

  const stats = mockStats[moduleKey || ''] || { total: 0, today: 0, growth: 0 };
  const relations = moduleRelations[moduleKey || ''] || [];

  return (
    <div>
      {/* 页面头部 */}
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`,
        color: '#fff',
        padding: '20px 28px',
        borderRadius: 12,
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ fontSize: 22, color: '#fff' }}>
              {iconMap[currentModule.key]}
            </span>
          </div>
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>{currentModule.label}</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              共 {currentModule.children.length} 个子功能模块
            </Text>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ padding: '18px 24px' }}>
            <Statistic title="总记录数" value={stats.total} valueStyle={{ color: '#1a2b45', fontSize: 24 }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ padding: '18px 24px' }}>
            <Statistic title="今日新增" value={stats.today} valueStyle={{ color: PRIMARY, fontSize: 24 }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bodyStyle={{ padding: '18px 24px' }}>
            <Statistic
              title="环比增长"
              value={stats.growth}
              suffix="%"
              valueStyle={{ color: stats.growth >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 24 }}
              prefix={stats.growth >= 0 ? <ArrowUpOutlined /> : undefined}
            />
          </Card>
        </Col>
      </Row>

      {/* 业务关联关系 */}
      {relations.length > 0 && (
        <Card
          title={<span style={{ fontWeight: 600, color: '#1a2b45' }}>
            <LinkOutlined style={{ marginRight: 8, color: PRIMARY }} />
            业务关联关系
          </span>}
          style={{ marginBottom: 16 }}
          bodyStyle={{ padding: '12px 24px' }}
        >
          <Row gutter={[12, 12]}>
            {relations.map((rel, idx) => (
              <Col xs={24} sm={12} key={idx}>
                <div
                  onClick={() => navigate(`/${rel.moduleKey}`)}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid #e8ecf1',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    background: '#fafcfd',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = PRIMARY;
                    el.style.background = '#e8f4fc';
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = '#e8ecf1';
                    el.style.background = '#fafcfd';
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: '#e8f4fc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {iconMap[rel.moduleKey] || <LinkOutlined />}
                  </div>
                  <div>
                    <Text strong style={{ color: PRIMARY, fontSize: 13 }}>
                      {modules.find(m => m.key === rel.moduleKey)?.label}
                      <RightOutlined style={{ fontSize: 10, marginLeft: 4 }} />
                    </Text>
                    <Text style={{ fontSize: 12, color: '#5a6d85', display: 'block', marginTop: 2 }}>
                      {rel.relation}
                    </Text>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      {/* 子功能卡片 */}
      <Card
        title={<span style={{ fontWeight: 600, color: '#1a2b45' }}>功能入口</span>}
        bodyStyle={{ padding: '16px 24px' }}
      >
        <Row gutter={[12, 12]}>
          {currentModule.children.map((child, index) => (
            <Col xs={24} sm={12} md={8} lg={6} xl={4} key={child.key}>
              <div
                onClick={() => navigate(`/${moduleKey}/${child.key}`)}
                style={{
                  padding: '18px 16px',
                  borderRadius: 10,
                  border: '1px solid #e8ecf1',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                  background: '#fafcfd',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = PRIMARY;
                  el.style.boxShadow = '0 4px 16px rgba(30,74,126,0.1)';
                  el.style.background = '#fff';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = '#e8ecf1';
                  el.style.boxShadow = 'none';
                  el.style.background = '#fafcfd';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8,
                      background: '#e8f4fc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, fontWeight: 700, color: PRIMARY, marginBottom: 12,
                    }}>
                      {index + 1}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#1a2b45', marginBottom: 4 }}>
                      {child.label}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>点击进入管理</Text>
                  </div>
                  <RightOutlined style={{ color: '#c5cdd8', marginTop: 4, fontSize: 12 }} />
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  );
};

export default ModulePage;
