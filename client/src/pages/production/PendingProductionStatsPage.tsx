import React, { useCallback, useMemo, useState } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Tag, Tabs, Modal, Tooltip,
  Progress, Input, Select, Empty, Divider, Alert,
} from 'antd';
import {
  ReloadOutlined, ExportOutlined, WarningOutlined, ToolOutlined, ScheduleOutlined,
  CheckCircleOutlined, ClockCircleOutlined, AppstoreOutlined, PieChartOutlined,
  InboxOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useDatasetSyncReload } from '../../utils/useDatasetSyncReload';
import { loadProductionSnapshot, SHIFT_LABEL } from '../../utils/productionStats';
import type { PendingRow, ProductionSnapshot } from '../../utils/productionStats';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

const fmt = (v: number) => (v || 0).toLocaleString();
const STATUS_COLOR: Record<string, string> = {
  待排产: 'orange', 生产中: 'blue', 已完成: 'green', 异常: 'red', 已取消: 'default', 已拆分: 'purple',
};

/** 指标卡：数值可点击下钻到订单明细 */
const MetricCard: React.FC<{
  label: string; value: React.ReactNode; sub?: string; color?: string; bg?: string;
  icon?: React.ReactNode; onClick?: () => void;
}> = ({ label, value, sub, color = PRIMARY, bg = '#f0f5ff', icon, onClick }) => (
  <div
    onClick={onClick}
    style={{
      borderRadius: 10, padding: '10px 14px', background: bg, border: `1px solid ${color}22`,
      cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow .2s', height: '100%',
    }}
    onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 12px rgba(30,74,126,.16)'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
  >
    <div style={{ fontSize: 12, color: '#5a6d85' }}>{icon}{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: '32px' }}>{value}</div>
    <div style={{ fontSize: 11, color: '#8c9bb0', minHeight: 16 }}>{sub}</div>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode; hint?: string; icon?: React.ReactNode }> = ({ children, hint, icon }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 10px' }}>
    <span style={{ fontWeight: 600, fontSize: 14, color: PRIMARY }}>{icon} {children}</span>
    {hint && <span style={{ fontSize: 11, color: '#8c9bb0' }}>{hint}</span>}
  </div>
);

/**
 * 待生产数据统计：生产管理首页统计页
 * - 全部指标由 utils/productionStats 从原始存储键现算，与生产订单页「已用时/超期标红」、排期看板「待排」同口径
 * - 五个页签：待生产池 / 齐套与阻塞 / 超期与节点 / 产能与负荷 / 结构与效率
 * - 指标卡可点击下钻到对应订单明细，明细支持关键字与负责人筛选并导出 CSV
 */
const PendingProductionStatsPage: React.FC = () => {
  const owner = getDataOwner();
  const navigate = useNavigate();
  const [snap, setSnap] = useState<ProductionSnapshot>(() => loadProductionSnapshot(owner));
  const [search, setSearch] = useState('');
  const [fPerson, setFPerson] = useState('');
  const [drill, setDrill] = useState<{ title: string; rows: PendingRow[] } | null>(null);

  const reload = useCallback(() => setSnap(loadProductionSnapshot(owner)), [owner]);
  useDatasetSyncReload(() => setSnap(loadProductionSnapshot(owner)));

  const { totals, bom, risk, nodes, persons, styles, colors, sizes, capacity, efficiency } = snap;

  // 明细筛选（仅作用于待生产池明细表，指标卡保持全量口径）
  const filteredPool = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snap.pool.filter(r => {
      if (fPerson && r.person !== fPerson) return false;
      if (!q) return true;
      return [r.id, r.productName, r.customerName, r.person, r.moldCodes, r.nodeName, r.styleCodes.join('/')]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [snap.pool, search, fPerson]);

  const personOptions = useMemo(
    () => persons.filter(p => p.name !== '（未填写）').map(p => ({ label: `${p.name}（${p.count}）`, value: p.name })),
    [persons],
  );

  const drillRows = (title: string, rows: PendingRow[]) => () => setDrill({ title, rows });

  const poolColumns: ColumnsType<PendingRow> = [
    { title: '生产单号', dataIndex: 'id', width: 150, fixed: 'left', render: (v: string, r) => <span style={{ fontFamily: 'monospace', color: PRIMARY, fontWeight: 600 }}>{v}<div style={{ fontSize: 11, color: '#8c9bb0', fontWeight: 400 }}>{r.createTime}</div></span> },
    { title: '商品 / 客户', dataIndex: 'productName', width: 200, ellipsis: true, render: (v: string, r) => <span>{v || '—'}<div style={{ fontSize: 11, color: '#8c9bb0' }}>{r.customerName || '—'}</div></span> },
    { title: '状态', dataIndex: 'statusLabel', width: 90, render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
    { title: '当前节点', dataIndex: 'nodeName', width: 120, render: (v: string, r) => <Space size={4}>{v || '—'}{r.nodeOverDays > 0 && <Tooltip title={`节点停留 ${r.nodeStayDays.toFixed(1)} 天，预计 ${r.nodeEstDays} 天`}><Tag color="red" style={{ margin: 0 }}>超 {r.nodeOverDays}天</Tag></Tooltip>}</Space> },
    { title: '计划', dataIndex: 'planQty', width: 80, align: 'right', sorter: (a, b) => a.planQty - b.planQty, render: (v: number) => fmt(v) },
    { title: '完工', dataIndex: 'doneQty', width: 80, align: 'right', render: (v: number) => fmt(v) },
    { title: '待生产', dataIndex: 'pendingQty', width: 90, align: 'right', sorter: (a, b) => a.pendingQty - b.pendingQty, defaultSortOrder: 'descend', render: (v: number) => <Text strong style={{ color: '#fa8c16' }}>{fmt(v)}</Text> },
    { title: '未排期', dataIndex: 'remainScheduleQty', width: 90, align: 'right', sorter: (a, b) => a.remainScheduleQty - b.remainScheduleQty, render: (v: number) => (v > 0 ? <Tag color="orange" style={{ margin: 0 }}>{fmt(v)}</Tag> : <Tag color="green" style={{ margin: 0 }}>已排满</Tag>) },
    { title: '完工率', dataIndex: 'progress', width: 110, render: (v: number) => <Progress percent={v} size="small" /> },
    { title: '已用时', dataIndex: 'elapsedDays', width: 90, align: 'right', sorter: (a, b) => a.elapsedDays - b.elapsedDays, render: (v: number, r) => <span style={{ color: r.overdue ? '#ff4d4f' : undefined, fontWeight: r.overdue ? 600 : undefined }} title={r.estDays > 0 ? `节点预计合计 ${r.limitDays} 天` : `模板未填预计用时，按默认 ${r.limitDays} 天`}>{v === 0 ? '当天' : `${v} 天`}</span> },
    { title: '计划完工', dataIndex: 'planEnd', width: 110, render: (v: string, r) => (v ? <span style={{ color: (r.dueInDays ?? 0) < 0 ? '#ff4d4f' : undefined }}>{v}</span> : <Text type="secondary">未填</Text>) },
    { title: '物料清单', dataIndex: 'hasCgsq', width: 90, render: (v: boolean, r) => (v ? <Tag color="green" style={{ margin: 0 }}>已生成</Tag> : <Tag color="red" style={{ margin: 0 }}>未生成</Tag>) },
    { title: '加工清单', dataIndex: 'hasJg', width: 110, render: (v: boolean, r) => (v ? <Tag color="green" style={{ margin: 0 }}>{r.jgDone}/{r.jgTotal}</Tag> : <Tag color="orange" style={{ margin: 0 }}>未生成</Tag>) },
    { title: '模具编号', dataIndex: 'moldCodes', width: 120, render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v || '—'}</span> },
    { title: '负责人', dataIndex: 'person', width: 90, render: (v: string) => v || '—' },
    { title: '标签', dataIndex: 'orderTag', width: 140, render: (_: string, r) => (String(r.record.orderTag || '').split(',').filter(Boolean).map(t => <Tag key={t} style={{ marginBottom: 2 }}>{t}</Tag>)) },
  ];

  const handleExport = () => {
    const head = ['生产单号', '商品名称', '客户名称', '状态', '当前节点', '计划数量', '完工数量', '待生产数量', '已排期数量', '未排期数量', '完工率%', '已用时(天)', '超期阈值(天)', '是否超期', '计划完工', '物料清单', '加工清单', '半成品未完成数量', '模具编号', '负责人', '创建时间'];
    const lines = filteredPool.map(r => [
      r.id, r.productName, r.customerName, r.statusLabel, r.nodeName, r.planQty, r.doneQty, r.pendingQty, r.scheduledQty, r.remainScheduleQty,
      r.progress, r.elapsedDays, r.limitDays, r.overdue ? '是' : '否', r.planEnd, r.hasCgsq ? '已生成' : '未生成',
      r.hasJg ? `${r.jgDone}/${r.jgTotal}` : '未生成', r.jgOpenQty, r.moldCodes, r.person, r.createTime,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([`\uFEFF${[head.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `待生产数据统计_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ===== 页签 1：待生产池 =====
  const tabPool = (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><MetricCard label="待生产订单数" value={totals.poolCount} icon={<InboxOutlined />} sub={`待排产 ${totals.pendingCount} · 生产中 ${totals.processingCount} · 异常 ${totals.warningCount}`} color="#fa8c16" bg="#fff7e6" onClick={drillRows('待生产订单', snap.pool)} /></Col>
        <Col xs={12} md={6}><MetricCard label="待生产总数量" value={fmt(totals.poolQty)} sub={`计划 ${fmt(totals.planQty)} · 已完工 ${fmt(totals.doneQty)}`} onClick={drillRows('待生产订单', snap.pool)} /></Col>
        <Col xs={12} md={6}><MetricCard label="未排期数量" value={fmt(totals.unscheduledQty)} icon={<ScheduleOutlined />} sub={`${totals.unscheduledCount} 单仍有未排数量 · 排期覆盖 ${efficiency.scheduleRate}%`} color="#cf1322" bg="#fff1f0" onClick={drillRows('存在未排期数量的订单', snap.pool.filter(r => r.remainScheduleQty > 0))} /></Col>
        <Col xs={12} md={6}><MetricCard label="暂不生产订单" value={totals.deferredCount} icon={<ClockCircleOutlined />} sub={`占用待排数量 ${fmt(totals.deferredQty)}`} color="#8c9bb0" bg="#f7f9fc" onClick={drillRows('暂不生产订单', snap.pool.filter(r => r.deferred))} /></Col>
      </Row>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><MetricCard label="超期订单" value={`${risk.overdueCount} 单 / ${risk.overdueRate}%`} icon={<WarningOutlined />} sub={`平均超 ${risk.avgOverDays} 天 · 最长 ${risk.maxOverDays} 天`} color="#cf1322" bg="#fff1f0" onClick={drillRows('超期订单（已用时 > 阈值）', snap.pool.filter(r => r.overdue))} /></Col>
        <Col xs={12} md={6}><MetricCard label="前道阻塞订单" value={bom.blockedCount} sub={`清单未齐套或半成品未回厂`} color="#fa541c" bg="#fff2e8" onClick={drillRows('存在前道阻塞的订单', snap.pool.filter(r => !r.hasCgsq || !r.hasJg || r.jgDone < r.jgTotal))} /></Col>
        <Col xs={12} md={6}><MetricCard label="节点停留超时" value={risk.nodeOverCount} sub={`3 天内到期未完工 ${risk.dueSoonCount} 单 · 已过完工日期 ${risk.planEndPassedCount} 单`} color="#d48806" bg="#fffbe6" onClick={drillRows('当前节点停留超时的订单', snap.pool.filter(r => r.nodeOverDays > 0))} /></Col>
        <Col xs={12} md={6}><MetricCard label="平均完工率" value={`${totals.avgProgress}%`} icon={<CheckCircleOutlined />} sub={`未填计划完工日期 ${risk.noPlanEndCount} 单`} color="#52c41a" bg="#f6ffed" /></Col>
      </Row>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Input allowClear size="small" style={{ width: 240 }} prefix={<SearchOutlined style={{ color: '#bbb' }} />} placeholder="搜索单号/商品/客户/模具/款式/节点" value={search} onChange={e => setSearch(e.target.value)} />
        <Select allowClear size="small" style={{ width: 170 }} placeholder="按负责人筛选" options={personOptions} value={fPerson || undefined} onChange={v => setFPerson(v || '')} />
        <Button size="small" icon={<ExportOutlined />} onClick={handleExport}>导出明细</Button>
        <Button size="small" icon={<ToolOutlined />} onClick={() => navigate('/production/production-schedule')}>去排期看板</Button>
        <span style={{ fontSize: 12, color: '#8c9bb0', alignSelf: 'center' }}>明细 {filteredPool.length} / {snap.pool.length} 单（指标卡为全量口径）</span>
      </div>
      <Table<PendingRow> size="small" rowKey="key" columns={poolColumns} dataSource={filteredPool} scroll={{ x: 1900 }} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 单` }} locale={{ emptyText: <Empty description="暂无待生产订单（生产订单全部完工或数量为 0）" /> }} rowClassName={r => (r.overdue ? 'table-row-overdue' : '')} />
    </>
  );

  // ===== 页签 2：齐套与阻塞 =====
  const tabBom = (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><MetricCard label="物料清单未生成" value={bom.noCgsqCount} sub="待生产订单中尚未生成采购申请单" color="#cf1322" bg="#fff1f0" onClick={drillRows('物料清单未生成的订单', snap.pool.filter(r => !r.hasCgsq))} /></Col>
        <Col xs={12} md={6}><MetricCard label="加工清单未生成" value={bom.noJgCount} sub="待生产订单中尚未生成加工订单" color="#d48806" bg="#fffbe6" onClick={drillRows('加工清单未生成的订单', snap.pool.filter(r => !r.hasJg))} /></Col>
        <Col xs={12} md={6}><MetricCard label="半成品未回厂" value={`${bom.jgOpenCount} 单 / ${fmt(bom.jgOpenQty)}`} sub={`在途加工金额 ¥${fmt(Math.round(bom.jgOpenAmount))}`} color="#fa541c" bg="#fff2e8" onClick={drillRows('含未回厂半成品的生产订单', snap.pool.filter(r => r.jgOpenQty > 0))} /></Col>
        <Col xs={12} md={6}><MetricCard label="半成品加工完成率" value={`${bom.jgDoneRate}%`} sub={`加工单 ${bom.jgDoneCount}/${bom.jgTotalCount} 已完成`} color="#52c41a" bg="#f6ffed" /></Col>
      </Row>
      {bom.cgsqOpenCount > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`待生产订单还有 ${bom.cgsqOpenCount} 张采购申请单处于「待采购」（申请数量合计 ${fmt(bom.cgsqOpenQty)}），原材料未到位将直接卡住开线`} />
      )}
      <Row gutter={12}>
        <Col xs={24} lg={12}>
          <SectionTitle hint="来源：加工订单（状态非已完成/已拆分，且归属待生产订单）">半成品未回厂明细</SectionTitle>
          <Table size="small" rowKey={(r: any) => String(r.key || r.id)} dataSource={snap.openJg} pagination={{ pageSize: 8, size: 'small' }} scroll={{ x: 620 }}
            columns={[
              { title: '加工单号', dataIndex: 'id', width: 140, render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
              { title: '来源生产单号', dataIndex: 'poId', width: 140, render: (v: string) => <span style={{ fontFamily: 'monospace', color: PRIMARY }}>{v}</span> },
              { title: '半成品', dataIndex: 'shortName', width: 130, ellipsis: true, render: (v: string, r: any) => v || r.productCode || '—' },
              { title: '未完成数量', dataIndex: 'totalQty', width: 100, align: 'right', render: (v: number) => fmt(Number(v) || 0) },
              { title: '加工厂', dataIndex: 'factoryName', width: 120, render: (v: string) => v || <Text type="secondary">未推送</Text> },
              { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={v === '加工中' ? 'blue' : 'orange'}>{v || '待加工'}</Tag> },
            ]} locale={{ emptyText: <Empty description="无未回厂半成品" /> }} />
        </Col>
        <Col xs={24} lg={12}>
          <SectionTitle hint="来源：采购申请单（状态=待采购，且归属待生产订单）">采购申请未完结明细</SectionTitle>
          <Table size="small" rowKey={(r: any) => String(r.key || r.id)} dataSource={snap.openCgsq} pagination={{ pageSize: 8, size: 'small' }} scroll={{ x: 560 }}
            columns={[
              { title: '申请单号', dataIndex: 'id', width: 150, render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
              { title: '来源生产单号', dataIndex: 'poId', width: 140, render: (v: string) => <span style={{ fontFamily: 'monospace', color: PRIMARY }}>{v}</span> },
              { title: '物料', dataIndex: 'shortName', width: 130, ellipsis: true, render: (v: string, r: any) => v || r.productCode || '—' },
              { title: '申请数量', dataIndex: 'totalQty', width: 100, align: 'right', render: (v: number) => fmt(Number(v) || 0) },
              { title: '供应商', dataIndex: 'supplierName', width: 120, render: (v: string) => v || <Text type="secondary">未指定</Text> },
              { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color="orange">{v || '待采购'}</Tag> },
            ]} locale={{ emptyText: <Empty description="采购申请已全部完结" /> }} />
        </Col>
      </Row>
    </>
  );

  // ===== 页签 3：超期与节点 =====
  const tabRisk = (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><MetricCard label="超期订单 / 占比" value={`${risk.overdueCount} / ${risk.overdueRate}%`} sub="已用时 > 节点预计用时合计（未填按 7 天）" color="#cf1322" bg="#fff1f0" onClick={drillRows('超期订单', snap.pool.filter(r => r.overdue))} /></Col>
        <Col xs={12} md={6}><MetricCard label="平均超期天数" value={`${risk.avgOverDays} 天`} sub={`最长 ${risk.maxOverDays} 天`} color="#d4380d" bg="#fff2e8" /></Col>
        <Col xs={12} md={6}><MetricCard label="节点停留超时" value={risk.nodeOverCount} sub="当前节点实际停留 > 节点预计用时" color="#d48806" bg="#fffbe6" onClick={drillRows('节点停留超时的订单', snap.pool.filter(r => r.nodeOverDays > 0))} /></Col>
        <Col xs={12} md={6}><MetricCard label="交期风险" value={risk.dueSoonCount} sub={`3 天内到期未完工 · 已过完工日期 ${risk.planEndPassedCount} 单 · 未填完工日期 ${risk.noPlanEndCount} 单`} color="#1677ff" bg="#e6f4ff" onClick={drillRows('3 天内到期或已过完工日期的订单', snap.pool.filter(r => r.dueInDays !== null && r.dueInDays <= 3))} /></Col>
      </Row>
      <SectionTitle hint="来源：生产订单流程节点（wf.currentStep 对应节点名）">各节点在制分布</SectionTitle>
      <Table size="small" rowKey="index" dataSource={nodes} pagination={false} style={{ marginBottom: 16 }}
        columns={[
          { title: '顺序', dataIndex: 'index', width: 70, render: (v: number) => v + 1 },
          { title: '节点名称', dataIndex: 'name', width: 160, render: (v: string) => <Text strong>{v}</Text> },
          { title: '在制单数', dataIndex: 'count', width: 100, align: 'right', render: (v: number) => v },
          { title: '在制数量', dataIndex: 'qty', width: 110, align: 'right', render: (v: number) => fmt(v) },
          { title: '平均停留(天)', dataIndex: 'avgStayDays', width: 130, align: 'right' },
          { title: '预计用时(天)', dataIndex: 'estDays', width: 130, align: 'right', render: (v: number) => (v > 0 ? v : <Text type="secondary">未维护</Text>) },
          { title: '超时单数', dataIndex: 'overCount', width: 110, align: 'right', render: (v: number, r: any) => (v > 0 ? <Tag color="red" style={{ margin: 0 }}>{v}</Tag> : <Text type="secondary">0</Text>) },
          { title: '积压占比', dataIndex: 'count', key: 'ratio', width: 180, render: (v: number) => <Progress percent={totals.poolCount ? Math.round((v / totals.poolCount) * 100) : 0} size="small" /> },
        ]} locale={{ emptyText: <Empty description="暂无在制订单" /> }} />
      <SectionTitle hint="按超出阈值天数降序，Top 15">超期订单 Top</SectionTitle>
      <Table<PendingRow> size="small" rowKey="key" dataSource={[...snap.pool].filter(r => r.overdue).sort((a, b) => b.overDays - a.overDays).slice(0, 15)} pagination={false} scroll={{ x: 1000 }}
        columns={[
          { title: '生产单号', dataIndex: 'id', width: 150, render: (v: string) => <span style={{ fontFamily: 'monospace', color: PRIMARY, fontWeight: 600 }}>{v}</span> },
          { title: '商品', dataIndex: 'productName', width: 180, ellipsis: true },
          { title: '客户', dataIndex: 'customerName', width: 130, ellipsis: true },
          { title: '状态', dataIndex: 'statusLabel', width: 90, render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
          { title: '当前节点', dataIndex: 'nodeName', width: 120 },
          { title: '已用时(天)', dataIndex: 'elapsedDays', width: 100, align: 'right', render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v}</Text> },
          { title: '阈值(天)', dataIndex: 'limitDays', width: 90, align: 'right', render: (v: number, r) => <span title={r.estDays > 0 ? '流程节点预计用时合计' : '模板未填预计用时，按默认 7 天'}>{v}</span> },
          { title: '超出(天)', dataIndex: 'overDays', width: 90, align: 'right', render: (v: number) => <Tag color="red" style={{ margin: 0 }}>{Math.round(v)}</Tag> },
          { title: '计划完工', dataIndex: 'planEnd', width: 110, render: (v: string) => v || <Text type="secondary">未填</Text> },
          { title: '负责人', dataIndex: 'person', width: 90 },
        ]} locale={{ emptyText: <Empty description="没有超期订单" /> }} />
    </>
  );

  // ===== 页签 4：产能与负荷 =====
  const tabCapacity = (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><MetricCard label="未来 7 天可排容量" value={fmt(capacity.capacity7)} sub={capacity.hasStandard ? '按各线单班次标准产量 × 3 班次 × 7 天' : '未维护标准产量，按近 14 天单班次实际均产估算'} color={PRIMARY} bg="#f0f5ff" /></Col>
        <Col xs={12} md={6}><MetricCard label="未排期数量" value={fmt(capacity.unscheduledQty)} sub="待生产订单计划数量 − 已排期数量" color="#fa8c16" bg="#fff7e6" onClick={drillRows('存在未排期数量的订单', snap.pool.filter(r => r.remainScheduleQty > 0))} /></Col>
        <Col xs={12} md={6}><MetricCard label={capacity.gap > 0 ? '7 天容量缺口' : '7 天容量富余'} value={fmt(Math.abs(capacity.gap))} sub={capacity.gap > 0 ? '未排期数量超出未来 7 天可排容量' : '未来 7 天容量足以消化未排期数量'} color={capacity.gap > 0 ? '#cf1322' : '#52c41a'} bg={capacity.gap > 0 ? '#fff1f0' : '#f6ffed'} /></Col>
        <Col xs={12} md={6}><MetricCard label="待排积压天数" value={capacity.backlogDays === null ? '—' : `${capacity.backlogDays} 天`} sub={`共 ${capacity.lineCount} 条生产线参与计算`} color="#1677ff" bg="#e6f4ff" /></Col>
      </Row>
      {!capacity.hasStandard && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="尚未维护「生产线单班次标准产量」，容量按该生产线近 14 天有排产班次的实际均产估算" action={<Button size="small" type="link" onClick={() => navigate('/production/production-schedule')}>前往排期看板维护</Button>} />
      )}
      <Row gutter={12}>
        <Col xs={24} lg={12}>
          <SectionTitle hint="标准产量在排期看板产线标签处维护">各生产线产能与负荷</SectionTitle>
          <Table size="small" rowKey="line" dataSource={capacity.lines} pagination={false} scroll={{ x: 620 }}
            columns={[
              { title: '生产线', dataIndex: 'line', width: 110 },
              { title: '单班次标准产量', dataIndex: 'standard', width: 140, align: 'right', render: (v: number) => (v > 0 ? fmt(v) : <Text type="secondary">未维护</Text>) },
              { title: '近14天单班次均产', dataIndex: 'avgShiftOutput', width: 140, align: 'right', render: (v: number) => (v > 0 ? fmt(v) : <Text type="secondary">无排产</Text>) },
              { title: '采用产量', dataIndex: 'usedCapacity', width: 100, align: 'right', render: (v: number) => (v > 0 ? fmt(v) : <Text type="secondary">—</Text>) },
              { title: '未来7天已排', dataIndex: 'scheduled7', width: 110, align: 'right', render: (v: number) => fmt(v) },
              { title: '未来7天容量', dataIndex: 'capacity7', width: 110, align: 'right', render: (v: number) => fmt(v) },
              { title: '负荷率', key: 'load', width: 140, render: (_: any, r: any) => (r.capacity7 > 0 ? <Progress percent={Math.min(999, Math.round((r.scheduled7 / r.capacity7) * 100))} size="small" status={r.scheduled7 > r.capacity7 ? 'exception' : 'normal'} /> : <Text type="secondary">—</Text>) },
            ]} locale={{ emptyText: <Empty description="未配置生产线" /> }} />
        </Col>
        <Col xs={24} lg={12}>
          <SectionTitle hint="已排数量 vs 当日可排容量（3 班次合计）">未来 7 天排产负荷</SectionTitle>
          <Table size="small" rowKey="date" dataSource={capacity.days} pagination={false} scroll={{ x: 520 }}
            columns={[
              { title: '日期', dataIndex: 'label', width: 110 },
              { title: '已排数量', dataIndex: 'scheduled', width: 110, align: 'right', render: (v: number) => fmt(v) },
              { title: '可排容量', dataIndex: 'capacity', width: 110, align: 'right', render: (v: number) => (v > 0 ? fmt(v) : <Text type="secondary">未维护</Text>) },
              { title: '负荷', key: 'load', render: (_: any, r: any) => (r.capacity > 0 ? <Progress percent={Math.min(999, Math.round((r.scheduled / r.capacity) * 100))} size="small" status={r.scheduled > r.capacity ? 'exception' : 'normal'} /> : <Text type="secondary">无法评估（{fmt(r.scheduled)}）</Text>) },
            ]} />
        </Col>
      </Row>
    </>
  );

  // ===== 页签 5：结构与效率 =====
  const specTotal = (list: { qty: number }[]) => list.reduce((s, x) => s + x.qty, 0) || 1;
  const tabStruct = (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><MetricCard label="近 30 天完工订单" value={efficiency.done30Count} icon={<AppstoreOutlined />} sub={`完工数量 ${fmt(efficiency.done30Qty)}`} color="#52c41a" bg="#f6ffed" onClick={drillRows('近 30 天完工订单', snap.done30Rows)} /></Col>
        <Col xs={12} md={6}><MetricCard label="平均完工周期" value={efficiency.avgCycleDays === null ? '—' : `${efficiency.avgCycleDays} 天`} sub="完工日期 − 创建日期（完工日期取生产入库统计）" color={PRIMARY} bg="#f0f5ff" /></Col>
        <Col xs={12} md={6}><MetricCard label="订单完工率" value={`${efficiency.completeRate}%`} sub={`全部 ${totals.allCount} 单中已完工 ${totals.doneCount} 单（已拆分单不计入）`} color="#1677ff" bg="#e6f4ff" onClick={drillRows('已完工订单', snap.completedRows)} /></Col>
        <Col xs={12} md={6}><MetricCard label="排期覆盖率" value={`${efficiency.scheduleRate}%`} sub="待生产池已排期数量 / 计划数量" color="#fa8c16" bg="#fff7e6" /></Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <SectionTitle hint="待生产数量降序">负责人待生产分布</SectionTitle>
          <Table size="small" rowKey="name" dataSource={persons} pagination={false}
            columns={[
              { title: '负责人', dataIndex: 'name', width: 120 },
              { title: '单数', dataIndex: 'count', width: 80, align: 'right' },
              { title: '待生产数量', dataIndex: 'qty', width: 120, align: 'right', render: (v: number) => fmt(v) },
              { title: '其中超期', dataIndex: 'overdueCount', width: 100, align: 'right', render: (v: number) => (v > 0 ? <Tag color="red" style={{ margin: 0 }}>{v}</Tag> : '0') },
              { title: '数量占比', key: 'ratio', width: 150, render: (_: any, r: any) => <Progress percent={totals.poolQty ? Math.round((r.qty / totals.poolQty) * 100) : 0} size="small" /> },
            ]} locale={{ emptyText: <Empty description="暂无数据" /> }} />
        </Col>
        <Col xs={24} lg={12}>
          <SectionTitle hint="来源：生产订单计划明细，款式编码前缀聚合">款式待生产 Top 10</SectionTitle>
          <Table size="small" rowKey="styleCode" dataSource={styles.slice(0, 10)} pagination={false} scroll={{ x: 520 }}
            columns={[
              { title: '款式编码', dataIndex: 'styleCode', width: 110, render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
              { title: '模具编号', dataIndex: 'moldCode', width: 110, render: (v: string) => <span style={{ fontFamily: 'monospace', color: '#722ed1' }}>{v || '—'}</span> },
              { title: '涉及订单', dataIndex: 'orderCount', width: 90, align: 'right' },
              { title: '待生产数量', dataIndex: 'qty', width: 110, align: 'right', render: (v: number) => <Text strong style={{ color: '#fa8c16' }}>{fmt(v)}</Text> },
              { title: '颜色数', dataIndex: 'colors', width: 80, align: 'right' },
              { title: '尺码数', dataIndex: 'sizes', width: 80, align: 'right' },
            ]} locale={{ emptyText: <Empty description="暂无计划明细数据" /> }} />
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} lg={12}>
          <SectionTitle icon={<PieChartOutlined />} hint="待生产数量结构">颜色结构占比</SectionTitle>
          <Table size="small" rowKey="name" dataSource={colors.slice(0, 12)} pagination={false}
            columns={[
              { title: '颜色', dataIndex: 'name', width: 120 },
              { title: '待生产数量', dataIndex: 'qty', width: 110, align: 'right', render: (v: number) => fmt(v) },
              { title: '明细行数', dataIndex: 'orderCount', width: 90, align: 'right' },
              { title: '占比', key: 'ratio', render: (_: any, r: any) => <Progress percent={Math.round((r.qty / specTotal(colors)) * 100)} size="small" /> },
            ]} locale={{ emptyText: <Empty description="计划明细未填颜色" /> }} />
        </Col>
        <Col xs={24} lg={12}>
          <SectionTitle icon={<PieChartOutlined />} hint="待生产数量结构">尺码结构占比</SectionTitle>
          <Table size="small" rowKey="name" dataSource={sizes.slice(0, 12)} pagination={false}
            columns={[
              { title: '尺码', dataIndex: 'name', width: 120 },
              { title: '待生产数量', dataIndex: 'qty', width: 110, align: 'right', render: (v: number) => fmt(v) },
              { title: '明细行数', dataIndex: 'orderCount', width: 90, align: 'right' },
              { title: '占比', key: 'ratio', render: (_: any, r: any) => <Progress percent={Math.round((r.qty / specTotal(sizes)) * 100)} size="small" /> },
            ]} locale={{ emptyText: <Empty description="计划明细未填规格" /> }} />
        </Col>
      </Row>
    </>
  );

  return (
    <div style={{ padding: 0 }}>
      <Card
        size="small"
        title={<Space><InboxOutlined style={{ color: PRIMARY }} /><span>待生产数据统计</span><Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>共 {totals.allCount} 张生产订单 · 数据时间 {snap.generatedAt}</Text></Space>}
        extra={<Space size={6}><Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button><Button size="small" icon={<ExportOutlined />} onClick={handleExport}>导出当前明细</Button></Space>}
        style={{ marginBottom: 12 }}
      >
        <div style={{ fontSize: 12, color: '#5a6d85', lineHeight: 1.9 }}>
          <Space size={16} wrap>
            <span><Text strong style={{ color: PRIMARY }}>{SHIFT_LABEL.morning}/{SHIFT_LABEL.afternoon}/{SHIFT_LABEL.evening}</Text> 三班制与排期看板同口径</span>
            <span>超期阈值 = 流程节点预计用时之和，未维护时按默认 7 天</span>
            <span>待生产数量 = 计划数量 − 完工数量；未排期数量 = 计划数量 − 已排期数量</span>
          </Space>
        </div>
      </Card>

      <Card size="small" bodyStyle={{ paddingTop: 8 }}>
        <Tabs
          defaultActiveKey="pool"
          items={[
            { key: 'pool', label: <span><InboxOutlined /> 待生产池</span>, children: tabPool },
            { key: 'bom', label: <span><ToolOutlined /> 齐套与阻塞</span>, children: tabBom },
            { key: 'risk', label: <span><WarningOutlined /> 超期与节点</span>, children: tabRisk },
            { key: 'capacity', label: <span><ScheduleOutlined /> 产能与负荷</span>, children: tabCapacity },
            { key: 'struct', label: <span><PieChartOutlined /> 结构与效率</span>, children: tabStruct },
          ]}
        />
      </Card>

      <Modal
        open={!!drill}
        title={<Space><AppstoreOutlined />{drill?.title}<Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{drill?.rows.length} 单 · 待生产数量合计 {fmt((drill?.rows || []).reduce((s, r) => s + r.pendingQty, 0))}</Text></Space>}
        width={1100}
        centered
        onCancel={() => setDrill(null)}
        footer={<Button onClick={() => setDrill(null)}>关闭</Button>}
      >
        <Table<PendingRow> size="small" rowKey="key" dataSource={drill?.rows || []} scroll={{ x: 900, y: 460 }} pagination={{ pageSize: 10, size: 'small' }}
          columns={[
            { title: '生产单号', dataIndex: 'id', width: 150, render: (v: string) => <span style={{ fontFamily: 'monospace', color: PRIMARY, fontWeight: 600 }}>{v}</span> },
            { title: '商品', dataIndex: 'productName', width: 180, ellipsis: true },
            { title: '客户', dataIndex: 'customerName', width: 130, ellipsis: true },
            { title: '状态', dataIndex: 'statusLabel', width: 90, render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
            { title: '当前节点', dataIndex: 'nodeName', width: 110 },
            { title: '待生产', dataIndex: 'pendingQty', width: 90, align: 'right', render: (v: number) => fmt(v) },
            { title: '未排期', dataIndex: 'remainScheduleQty', width: 90, align: 'right', render: (v: number) => fmt(v) },
            { title: '已用时(天)', dataIndex: 'elapsedDays', width: 100, align: 'right', render: (v: number, r) => <span style={{ color: r.overdue ? '#ff4d4f' : undefined }}>{v}</span> },
            { title: '计划完工', dataIndex: 'planEnd', width: 110, render: (v: string) => v || '—' },
            { title: '负责人', dataIndex: 'person', width: 90 },
          ]} locale={{ emptyText: <Empty description="没有符合条件的订单" /> }} />
        <Divider style={{ margin: '10px 0' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>明细口径与生产订单页一致，如需修改节点用时或排期，请前往「生产订单」或「生产排期」页面操作。</Text>
      </Modal>
    </div>
  );
};

export default PendingProductionStatsPage;
