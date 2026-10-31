import React, { useMemo, useState } from 'react';
import { Card, Row, Col, Statistic, DatePicker, Button, Space, Table, Tag, Typography, Empty, Divider } from 'antd';
import { ArrowLeftOutlined, ArrowUpOutlined, ArrowDownOutlined, FundOutlined, AccountBookOutlined, BarChartOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const PRIMARY = '#1e4a7e';
const COLORS = ['#1e4a7e', '#52c41a', '#ff4d4f', '#faad14', '#13c2c2', '#722ed1', '#eb2f96', '#2f54eb', '#a0d911', '#fa8c16', '#1890ff', '#597ef7'];

interface BookRecord {
  key: string; bookDate: string; bookType: '收入' | '支出'; category: string;
  amount: number; counterparty: string; remark: string; person: string;
  payAccount?: string; recvAccount?: string; recvBank?: string; payBank?: string;
  image?: string; createdAt: string;
}

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

const fmt = (v: number) => `¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number, t: number) => t ? `${((v / t) * 100).toFixed(1)}%` : '0%';

const BookkeepingStatsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [range, setRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const goBack = () => {
    const p = location.pathname;
    if (p.startsWith('/purchaser/')) navigate('/purchaser/finance/daily-bookkeeping');
    else if (p.startsWith('/factory/')) navigate('/factory/finance/daily-bookkeeping');
    else navigate('/finance/daily-bookkeeping');
  };

  const allRecords = useMemo<BookRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(`daily_bookkeeping_${getDataOwner()}`) || '[]'); } catch { return []; }
  }, []);

  const records = useMemo(() => {
    if (!range || !range[0] || !range[1]) return allRecords;
    const s = range[0].format('YYYY-MM-DD'), e = range[1].format('YYYY-MM-DD');
    return allRecords.filter(r => r.bookDate >= s && r.bookDate <= e);
  }, [allRecords, range]);

  // 汇总统计
  const stats = useMemo(() => {
    const inc = records.filter(r => r.bookType === '收入').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const out = records.filter(r => r.bookType === '支出').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const incCnt = records.filter(r => r.bookType === '收入').length;
    const outCnt = records.filter(r => r.bookType === '支出').length;
    const months = new Set(records.map(r => r.bookDate?.slice(0, 7)).filter(Boolean)).size || 1;
    return { inc, out, net: inc - out, total: records.length, incCnt, outCnt, avgRec: inc / (incCnt || 1), avgExp: out / (outCnt || 1), monthlyNet: (inc - out) / months };
  }, [records]);

  // 月度趋势
  const monthlyTrend = useMemo(() => {
    const map: Record<string, { inc: number; out: number }> = {};
    records.forEach(r => {
      const m = r.bookDate?.slice(0, 7); if (!m) return;
      if (!map[m]) map[m] = { inc: 0, out: 0 };
      if (r.bookType === '收入') map[m].inc += Number(r.amount) || 0;
      else map[m].out += Number(r.amount) || 0;
    });
    const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    return { months: sorted.map(([k]) => k), incData: sorted.map(([, v]) => v.inc), outData: sorted.map(([, v]) => v.out), netData: sorted.map(([, v]) => v.inc - v.out) };
  }, [records]);

  // 分类分析
  const categoryData = useMemo(() => {
    const incMap: Record<string, number> = {}, outMap: Record<string, number> = {};
    records.forEach(r => { if (!r.category) return; if (r.bookType === '收入') incMap[r.category] = (incMap[r.category] || 0) + Number(r.amount); else outMap[r.category] = (outMap[r.category] || 0) + Number(r.amount); });
    return {
      inc: Object.entries(incMap).map(([n, v]) => ({ name: n, value: v })).sort((a, b) => b.value - a.value),
      out: Object.entries(outMap).map(([n, v]) => ({ name: n, value: v })).sort((a, b) => b.value - a.value),
    };
  }, [records]);

  // 账户分析
  const accountData = useMemo(() => {
    const map: Record<string, { inc: number; out: number }> = {};
    records.forEach(r => {
      const acc = r.bookType === '收入' ? r.recvAccount : r.payAccount;
      if (!acc) return;
      if (!map[acc]) map[acc] = { inc: 0, out: 0 };
      if (r.bookType === '收入') map[acc].inc += Number(r.amount); else map[acc].out += Number(r.amount);
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v, net: v.inc - v.out, total: v.inc + v.out })).sort((a, b) => b.total - a.total);
  }, [records]);

  // 收支对方 TOP10
  const counterpartyData = useMemo(() => {
    const map: Record<string, { inc: number; out: number; cnt: number }> = {};
    records.forEach(r => {
      if (!r.counterparty) return;
      if (!map[r.counterparty]) map[r.counterparty] = { inc: 0, out: 0, cnt: 0 };
      map[r.counterparty].cnt++;
      if (r.bookType === '收入') map[r.counterparty].inc += Number(r.amount); else map[r.counterparty].out += Number(r.amount);
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v, total: v.inc + v.out })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [records]);

  // 记账人分析
  const personData = useMemo(() => {
    const map: Record<string, { inc: number; out: number; cnt: number }> = {};
    records.forEach(r => {
      const p = r.person || '未知';
      if (!map[p]) map[p] = { inc: 0, out: 0, cnt: 0 };
      map[p].cnt++;
      if (r.bookType === '收入') map[p].inc += Number(r.amount); else map[p].out += Number(r.amount);
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cnt - a.cnt);
  }, [records]);

  // 月度明细表
  const monthlyDetail = useMemo(() => {
    const map: Record<string, { inc: number; out: number; cnt: number; cats: Set<string> }> = {};
    records.forEach(r => {
      const m = r.bookDate?.slice(0, 7); if (!m) return;
      if (!map[m]) map[m] = { inc: 0, out: 0, cnt: 0, cats: new Set() };
      map[m].cnt++; map[m].cats.add(r.category);
      if (r.bookType === '收入') map[m].inc += Number(r.amount); else map[m].out += Number(r.amount);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a)).map(([month, v]) => ({
      month, ...v, catCnt: v.cats.size, net: v.inc - v.out,
    }));
  }, [records]);

  // 星期分布
  const weekdayData = useMemo(() => {
    const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const amounts = [0, 0, 0, 0, 0, 0, 0];
    records.forEach(r => {
      if (!r.bookDate) return;
      const d = dayjs(r.bookDate).day();
      counts[d]++; amounts[d] += Number(r.amount);
    });
    return { labels, counts, amounts };
  }, [records]);

  // 金额区间分布
  const amountDist = useMemo(() => {
    const bins = [
      { label: '0-100', min: 0, max: 100, cnt: 0 },
      { label: '100-500', min: 100, max: 500, cnt: 0 },
      { label: '500-1000', min: 500, max: 1000, cnt: 0 },
      { label: '1000-5000', min: 1000, max: 5000, cnt: 0 },
      { label: '5000-1万', min: 5000, max: 10000, cnt: 0 },
      { label: '1万-5万', min: 10000, max: 50000, cnt: 0 },
      { label: '5万以上', min: 50000, max: Infinity, cnt: 0 },
    ];
    records.forEach(r => {
      const a = Number(r.amount);
      const b = bins.find(x => a >= x.min && a < x.max);
      if (b) b.cnt++;
    });
    return bins;
  }, [records]);

  // 最大单笔收支
  const extremes = useMemo(() => {
    const incRecs = records.filter(r => r.bookType === '收入').sort((a, b) => b.amount - a.amount);
    const outRecs = records.filter(r => r.bookType === '支出').sort((a, b) => b.amount - a.amount);
    return { maxInc: incRecs[0], maxOut: outRecs[0] };
  }, [records]);

  if (!allRecords.length) {
    return (
      <div style={{ padding: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack} style={{ marginBottom: 16 }}>返回日常记账</Button>
        <Empty description="暂无记账数据，无法生成统计分析" />
      </div>
    );
  }

  // ===== 图表配置 =====
  const monthlyOpt = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['收入', '支出', '净额'], top: 0 },
    grid: { left: 60, right: 60, bottom: 30, top: 40 },
    xAxis: { type: 'category' as const, data: monthlyTrend.months, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value' as const, axisLabel: { formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    series: [
      { name: '收入', type: 'bar', data: monthlyTrend.incData, itemStyle: { color: '#52c41a' }, barMaxWidth: 40 },
      { name: '支出', type: 'bar', data: monthlyTrend.outData, itemStyle: { color: '#ff4d4f' }, barMaxWidth: 40 },
      { name: '净额', type: 'line', data: monthlyTrend.netData, smooth: true, itemStyle: { color: PRIMARY }, lineStyle: { width: 2 } },
    ],
  };

  const pieOpt = (data: { name: string; value: number }[], title: string) => ({
    title: { text: title, left: 'center', textStyle: { fontSize: 14, color: '#333' } },
    tooltip: { trigger: 'item' as const, formatter: (p: any) => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { type: 'scroll' as const, bottom: 0, textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['35%', '60%'], center: ['50%', '45%'], data, label: { formatter: '{b}\n{d}%', fontSize: 11 },
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      color: COLORS,
    }],
  });

  const accountOpt = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['收入', '支出'], top: 0 },
    grid: { left: 120, right: 40, bottom: 30, top: 40 },
    yAxis: { type: 'category' as const, data: accountData.map(a => a.name), axisLabel: { width: 100, overflow: 'truncate' as const } },
    xAxis: { type: 'value' as const, axisLabel: { formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    series: [
      { name: '收入', type: 'bar', stack: 'total', data: accountData.map(a => a.inc), itemStyle: { color: '#52c41a' }, barMaxWidth: 30 },
      { name: '支出', type: 'bar', stack: 'total', data: accountData.map(a => a.out), itemStyle: { color: '#ff4d4f' }, barMaxWidth: 30 },
    ],
  };

  const counterpartyOpt = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 120, right: 40, bottom: 30, top: 10 },
    yAxis: { type: 'category' as const, data: counterpartyData.map(c => c.name).reverse(), axisLabel: { width: 100, overflow: 'truncate' as const } },
    xAxis: { type: 'value' as const, axisLabel: { formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    series: [{
      type: 'bar', data: [...counterpartyData].reverse().map(c => c.total),
      itemStyle: { color: (p: any) => COLORS[p.dataIndex % COLORS.length] }, barMaxWidth: 25,
    }],
  };

  const personOpt = {
    tooltip: { trigger: 'item' as const, formatter: (p: any) => `${p.name}: ${p.value}笔 (${p.percent}%)` },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: '65%', center: ['50%', '45%'],
      data: personData.map(p => ({ name: p.name, value: p.cnt })),
      label: { formatter: '{b}\n{c}笔 ({d}%)', fontSize: 11 },
      color: COLORS,
    }],
  };

  const weekdayOpt = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 50, right: 50, bottom: 30, top: 30 },
    xAxis: { type: 'category' as const, data: weekdayData.labels },
    yAxis: [
      { type: 'value' as const, name: '笔数', position: 'left' as const },
      { type: 'value' as const, name: '金额', position: 'right' as const, axisLabel: { formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    ],
    series: [
      { name: '记账笔数', type: 'bar', data: weekdayData.counts, itemStyle: { color: PRIMARY }, barMaxWidth: 30 },
      { name: '涉及金额', type: 'line', yAxisIndex: 1, data: weekdayData.amounts, smooth: true, itemStyle: { color: '#faad14' } },
    ],
  };

  const amountDistOpt = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 50, right: 20, bottom: 30, top: 20 },
    xAxis: { type: 'category' as const, data: amountDist.map(b => b.label), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value' as const, minInterval: 1 },
    series: [{
      type: 'bar', data: amountDist.map(b => b.cnt),
      itemStyle: { color: (p: any) => COLORS[p.dataIndex % COLORS.length], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 40,
    }],
  };

  const cardStyle = { height: '100%' };
  const sectionTitle = (icon: React.ReactNode, text: string) => (
    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: PRIMARY, fontSize: 16 }}>{icon}</span>
      <Text strong style={{ fontSize: 15, color: '#333' }}>{text}</Text>
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      {/* 顶部导航 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>返回日常记账</Button>
          <Title level={4} style={{ margin: 0, color: PRIMARY }}><FundOutlined style={{ marginRight: 8 }} />记账统计分析</Title>
        </Space>
        <Space>
          <Text type="secondary" style={{ fontSize: 13 }}>时间范围：</Text>
          <DatePicker.RangePicker value={range as any} onChange={v => setRange(v as any)} allowClear />
          <Text type="secondary" style={{ fontSize: 12 }}>共 {records.length} 条记录</Text>
        </Space>
      </div>

      {/* 概览统计卡片 */}
      {sectionTitle(<AccountBookOutlined />, '总览')}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
            <Statistic title="收入合计" value={stats.inc} precision={2} prefix={<ArrowUpOutlined style={{ color: '#52c41a' }} />} suffix="元" valueStyle={{ color: '#52c41a', fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#fff1f0', borderColor: '#ffa39e' }}>
            <Statistic title="支出合计" value={stats.out} precision={2} prefix={<ArrowDownOutlined style={{ color: '#ff4d4f' }} />} suffix="元" valueStyle={{ color: '#ff4d4f', fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ background: '#f0f5ff', borderColor: '#adc6ff' }}>
            <Statistic title="净额" value={stats.net} precision={2} suffix="元" valueStyle={{ color: stats.net >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="记账笔数" value={stats.total} suffix="笔" valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="收入笔数" value={stats.incCnt} suffix="笔" valueStyle={{ fontSize: 18, color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="支出笔数" value={stats.outCnt} suffix="笔" valueStyle={{ fontSize: 18, color: '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="收入均额" value={stats.avgRec} precision={2} suffix="元" valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="支出均额" value={stats.avgExp} precision={2} suffix="元" valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="月均净额" value={stats.monthlyNet} precision={2} suffix="元" valueStyle={{ fontSize: 18, color: stats.monthlyNet >= 0 ? '#52c41a' : '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="涉及月份" value={new Set(records.map(r => r.bookDate?.slice(0, 7)).filter(Boolean)).size} suffix="月" valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="涉及分类" value={new Set(records.map(r => r.category).filter(Boolean)).size} suffix="个" valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={3}>
          <Card size="small"><Statistic title="涉及对方" value={new Set(records.map(r => r.counterparty).filter(Boolean)).size} suffix="个" valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
      </Row>

      {/* 最大单笔收支 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col span={12}>
          <Card size="small" style={{ borderLeft: '3px solid #52c41a' }}>
            <Text type="secondary">最大单笔收入</Text>
            {extremes.maxInc ? (
              <div style={{ marginTop: 4 }}>
                <Text strong style={{ color: '#52c41a', fontSize: 18 }}>{fmt(extremes.maxInc.amount)}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{extremes.maxInc.category} · {extremes.maxInc.counterparty || '无对方'} · {extremes.maxInc.bookDate}</Text>
              </div>
            ) : <Text type="secondary">—</Text>}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" style={{ borderLeft: '3px solid #ff4d4f' }}>
            <Text type="secondary">最大单笔支出</Text>
            {extremes.maxOut ? (
              <div style={{ marginTop: 4 }}>
                <Text strong style={{ color: '#ff4d4f', fontSize: 18 }}>{fmt(extremes.maxOut.amount)}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{extremes.maxOut.category} · {extremes.maxOut.counterparty || '无对方'} · {extremes.maxOut.bookDate}</Text>
              </div>
            ) : <Text type="secondary">—</Text>}
          </Card>
        </Col>
      </Row>

      {/* 月度趋势 + 分类占比 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={14}>
          <Card size="small" style={cardStyle}>
            {sectionTitle(<BarChartOutlined />, '月度收支趋势')}
            <ReactECharts option={monthlyOpt} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={12} lg={5}>
          <Card size="small" style={cardStyle}>
            <ReactECharts option={pieOpt(categoryData.inc, '收入分类占比')} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={12} lg={5}>
          <Card size="small" style={cardStyle}>
            <ReactECharts option={pieOpt(categoryData.out, '支出分类占比')} style={{ height: 320 }} />
          </Card>
        </Col>
      </Row>

      {/* 账户分析 + 收支对方 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col xs={24} md={12}>
          <Card size="small" style={cardStyle}>
            {sectionTitle(<AccountBookOutlined />, '账户收支分析')}
            {accountData.length ? <ReactECharts option={accountOpt} style={{ height: Math.max(200, accountData.length * 45) }} /> : <Empty description="无账户数据" />}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" style={cardStyle}>
            {sectionTitle(<FundOutlined />, '收支对方 TOP10')}
            {counterpartyData.length ? <ReactECharts option={counterpartyOpt} style={{ height: Math.max(200, counterpartyData.length * 40) }} /> : <Empty description="无对方数据" />}
          </Card>
        </Col>
      </Row>

      {/* 星期分布 + 金额区间 + 记账人 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col xs={24} md={8}>
          <Card size="small" style={cardStyle}>
            {sectionTitle(<BarChartOutlined />, '星期记账分布')}
            <ReactECharts option={weekdayOpt} style={{ height: 250 }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" style={cardStyle}>
            {sectionTitle(<BarChartOutlined />, '金额区间分布')}
            <ReactECharts option={amountDistOpt} style={{ height: 250 }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" style={cardStyle}>
            {sectionTitle(<FundOutlined />, '记账人分析')}
            <ReactECharts option={personOpt} style={{ height: 250 }} />
          </Card>
        </Col>
      </Row>

      {/* 月度明细表 */}
      <Card size="small" style={{ marginBottom: 20 }}>
        {sectionTitle(<BarChartOutlined />, '月度明细')}
        <Table
          bordered size="small" rowKey="month" pagination={false}
          columns={[
            { title: '月份', dataIndex: 'month', key: 'month', width: 100, align: 'center', render: (v: string) => <Text strong>{v}</Text> },
            { title: '收入', dataIndex: 'inc', key: 'inc', width: 130, align: 'right', render: (v: number) => <Text style={{ color: '#52c41a' }}>{fmt(v)}</Text> },
            { title: '支出', dataIndex: 'out', key: 'out', width: 130, align: 'right', render: (v: number) => <Text style={{ color: '#ff4d4f' }}>{fmt(v)}</Text> },
            { title: '净额', dataIndex: 'net', key: 'net', width: 130, align: 'right', render: (v: number) => <Text strong style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '+' : ''}{fmt(v)}</Text> },
            { title: '记账笔数', dataIndex: 'cnt', key: 'cnt', width: 100, align: 'center' },
            { title: '涉及分类数', dataIndex: 'catCnt', key: 'catCnt', width: 110, align: 'center' },
            { title: '笔均金额', key: 'avg', width: 130, align: 'right', render: (_: any, r: any) => fmt((r.inc + r.out) / (r.cnt || 1)) },
          ]}
          dataSource={monthlyDetail}
          summary={(pageData) => {
            const tInc = pageData.reduce((s, r: any) => s + r.inc, 0);
            const tOut = pageData.reduce((s, r: any) => s + r.out, 0);
            const tCnt = pageData.reduce((s, r: any) => s + r.cnt, 0);
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
                  <Table.Summary.Cell index={0} align="center">合计</Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><Text style={{ color: '#52c41a' }}>{fmt(tInc)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><Text style={{ color: '#ff4d4f' }}>{fmt(tOut)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><Text strong style={{ color: tInc - tOut >= 0 ? '#52c41a' : '#ff4d4f' }}>{tInc - tOut >= 0 ? '+' : ''}{fmt(tInc - tOut)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="center">{tCnt}</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="center">—</Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">{fmt((tInc + tOut) / (tCnt || 1))}</Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </Card>

      {/* 分类明细交叉表 */}
      <Card size="small" style={{ marginBottom: 20 }}>
        {sectionTitle(<BarChartOutlined />, '分类收支明细')}
        <Table
          bordered size="small" rowKey="name" pagination={false}
          columns={[
            { title: '分类', dataIndex: 'name', key: 'name', width: 120, render: (v: string) => <Tag>{v}</Tag> },
            { title: '类型', dataIndex: 'type', key: 'type', width: 80, align: 'center', render: (v: string) => <Tag color={v === '收入' ? 'green' : 'red'}>{v}</Tag> },
            { title: '笔数', dataIndex: 'cnt', key: 'cnt', width: 80, align: 'center' },
            { title: '总金额', dataIndex: 'total', key: 'total', width: 140, align: 'right', render: (v: number, r: any) => <Text strong style={{ color: r.type === '收入' ? '#52c41a' : '#ff4d4f' }}>{fmt(v)}</Text> },
            { title: '占比', key: 'pct', width: 100, align: 'center', render: (_: any, r: any) => pct(r.total, r.type === '收入' ? stats.inc : stats.out) },
            { title: '笔均', key: 'avg', width: 130, align: 'right', render: (_: any, r: any) => fmt(r.total / (r.cnt || 1)) },
            { title: '最大单笔', dataIndex: 'max', key: 'max', width: 130, align: 'right', render: (v: number) => fmt(v) },
          ]}
          dataSource={(() => {
            const rows: any[] = [];
            categoryData.inc.forEach(c => {
              const recs = records.filter(r => r.bookType === '收入' && r.category === c.name);
              rows.push({ name: c.name, type: '收入', cnt: recs.length, total: c.value, max: Math.max(...recs.map(r => r.amount)) });
            });
            categoryData.out.forEach(c => {
              const recs = records.filter(r => r.bookType === '支出' && r.category === c.name);
              rows.push({ name: c.name, type: '支出', cnt: recs.length, total: c.value, max: Math.max(...recs.map(r => r.amount)) });
            });
            return rows.sort((a, b) => b.total - a.total);
          })()}
        />
      </Card>

      {/* 记账人明细表 */}
      <Card size="small" style={{ marginBottom: 20 }}>
        {sectionTitle(<FundOutlined />, '记账人明细')}
        <Table
          bordered size="small" rowKey="name" pagination={false}
          columns={[
            { title: '记账人', dataIndex: 'name', key: 'name', width: 120 },
            { title: '记账笔数', dataIndex: 'cnt', key: 'cnt', width: 100, align: 'center' },
            { title: '收入金额', dataIndex: 'inc', key: 'inc', width: 140, align: 'right', render: (v: number) => <Text style={{ color: '#52c41a' }}>{fmt(v)}</Text> },
            { title: '支出金额', dataIndex: 'out', key: 'out', width: 140, align: 'right', render: (v: number) => <Text style={{ color: '#ff4d4f' }}>{fmt(v)}</Text> },
            { title: '涉及总额', key: 'total', width: 140, align: 'right', render: (_: any, r: any) => <Text strong>{fmt(r.inc + r.out)}</Text> },
            { title: '占比', key: 'pct', width: 100, align: 'center', render: (_: any, r: any) => pct(r.inc + r.out, stats.inc + stats.out) },
          ]}
          dataSource={personData}
        />
      </Card>

      {/* 最近交易记录 */}
      <Card size="small">
        {sectionTitle(<AccountBookOutlined />, '最近交易记录（最新50条）')}
        <Table
          bordered size="small" rowKey="key" pagination={false}
          columns={[
            { title: '日期', dataIndex: 'bookDate', key: 'bookDate', width: 110, align: 'center' },
            { title: '类型', dataIndex: 'bookType', key: 'bookType', width: 80, align: 'center', render: (v: string) => <Tag color={v === '收入' ? 'green' : 'red'}>{v}</Tag> },
            { title: '分类', dataIndex: 'category', key: 'category', width: 100 },
            { title: '金额', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: (v: number, r: BookRecord) => (
              <Text strong style={{ color: r.bookType === '收入' ? '#52c41a' : '#ff4d4f', fontFamily: 'monospace' }}>
                {r.bookType === '收入' ? '+' : '-'}{fmt(v)}
              </Text>
            ) },
            { title: '收支对方', dataIndex: 'counterparty', key: 'counterparty', width: 150, render: (v: string) => v || '—' },
            { title: '记账说明', dataIndex: 'remark', key: 'remark', render: (v: string) => v || '—' },
            { title: '记账人', dataIndex: 'person', key: 'person', width: 90 },
          ]}
          dataSource={[...records].sort((a, b) => (b.bookDate || '').localeCompare(a.bookDate || '')).slice(0, 50)}
        />
      </Card>
    </div>
  );
};

export default BookkeepingStatsPage;
