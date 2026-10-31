import React, { useState, useCallback, useMemo } from 'react';
import {
  Card, Table, Button, Input, Tag, message, Space, Typography, Alert, InputNumber, Collapse,
} from 'antd';
import { ReloadOutlined, CloudSyncOutlined, KeyOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text, Paragraph } = Typography;
import { API_BASE } from '../utils/apiBase';

interface ColDef { key: string; label: string; }

interface DataTypeCfg {
  title: string;
  apiPath: string;
  desc: string;
  preferred: ColDef[];
  buildBiz: (pageIndex: number, pageSize: number) => any;
}

// 近6天时间范围（聚水潭部分查询接口限制时间间隔不能超过7天）
const range6 = () => {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return { modified_begin: fmt(new Date(Date.now() - 6 * 24 * 3600 * 1000)), modified_end: fmt(new Date()) };
};

// 各数据页对应的聚水潭查询接口与优先展示字段
const DATA_CFG: Record<string, DataTypeCfg> = {
  'shop-product': {
    title: '店铺商品',
    apiPath: '/open/skumap/query',
    desc: '查询店铺商品资料（对应商品API-店铺商品资料）',
    preferred: [
      { key: 'sku_id', label: '商品编码' }, { key: 'i_id', label: '款式编码' }, { key: 'name', label: '商品名称' },
      { key: 'shop_id', label: '店铺ID' }, { key: 'shop_price', label: '店铺售价' }, { key: 'shop_qty', label: '店铺库存' },
      { key: 'enabled', label: '状态' }, { key: 'properties_value', label: '属性' },
    ],
    buildBiz: (pi, ps) => ({ ...range6(), page_index: pi, page_size: ps }),
  },
  'data-order': {
    title: '订单',
    apiPath: '/open/orders/single/query',
    desc: '查询聚水潭订单（对应订单API-订单查询）',
    preferred: [
      { key: 'so_id', label: '线上订单号' }, { key: 'o_id', label: '内部单号' }, { key: 'shop_name', label: '店铺' },
      { key: 'order_date', label: '订单日期' }, { key: 'pay_amount', label: '应付金额' }, { key: 'freight', label: '运费' },
      { key: 'status', label: '状态' }, { key: 'receiver_name', label: '收件人' }, { key: 'receiver_state', label: '省' }, { key: 'receiver_city', label: '市' },
    ],
    buildBiz: (pi, ps) => ({ ...range6(), page_index: pi, page_size: ps }),
  },
  'data-inventory': {
    title: '库存管理',
    apiPath: '/open/inventory/query',
    desc: '查询实时库存（对应库存API-库存查询）',
    preferred: [
      { key: 'sku_id', label: '商品编码' }, { key: 'i_id', label: '款式编码' }, { key: 'name', label: '名称' },
      { key: 'qty', label: '库存数' }, { key: 'lock_qty', label: '锁定数' }, { key: 'warehouse', label: '仓库' },
    ],
    buildBiz: (pi, ps) => ({ ...range6(), page_index: pi, page_size: ps }),
  },
  'data-outbound': {
    title: '出库单',
    apiPath: '/open/orders/out/simple/query',
    desc: '查询销售出库单（对应出库API-出库发货）',
    preferred: [
      { key: 'so_id', label: '线上订单号' }, { key: 'o_id', label: '内部单号' }, { key: 'io_id', label: '出库单号' },
      { key: 'shop_name', label: '店铺' }, { key: 'logistics_company', label: '物流公司' }, { key: 'l_id', label: '运单号' },
      { key: 'io_date', label: '出库时间' }, { key: 'receiver_name', label: '收件人' }, { key: 'qty', label: '数量' }, { key: 'pay_amount', label: '应付金额' }, { key: 'status', label: '状态' },
    ],
    buildBiz: (pi, ps) => ({ ...range6(), page_index: pi, page_size: ps }),
  },
};

// 从聚水潭响应中提取数据行（不同接口列表键不同：datas/orders/skus/shops 等）
const extractRows = (jst: any): any[] => {
  if (!jst) return [];
  const d = jst.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k of ['datas', 'orders', 'data', 'list', 'items', 'stocks', 'skus', 'shops']) {
      if (Array.isArray((d as any)[k])) return (d as any)[k];
    }
    for (const v of Object.values(d)) if (Array.isArray(v)) return v as any[];
  }
  return [];
};

// 沙箱无真实记录时用于演示字段布局的示例数据（明确标注，非真实）
const buildSample = (type: string): any[] => {
  const mk = (i: number): any => {
    switch (type) {
      case 'data-order': return { so_id: `SO20260901000${i}`, o_id: `${12340 + i}`, shop_name: '测试店铺', order_date: `2026-09-01 10:0${i}:00`, pay_amount: (147 + i * 10).toFixed(2), freight: '0.00', status: '已付款', receiver_name: '小易', receiver_state: '浙江省', receiver_city: '温州市' };
      case 'data-inventory': return { sku_id: `6980-蓝色-${34 + i}`, i_id: '6980', name: `运动鞋 蓝色 ${34 + i}`, qty: 20 + i * 5, lock_qty: i, warehouse: '主仓' };
      case 'data-outbound': return { so_id: `SO20260901000${i}`, o_id: `${12340 + i}`, io_id: `IO2026090100${i}`, shop_name: '测试店铺', logistics_company: 'ZTO', l_id: `ZT2026090100${i}`, io_date: `2026-09-01 11:0${i}:00`, receiver_name: '小易', qty: 2, pay_amount: (147 + i * 10).toFixed(2), status: '已发货' };
      default: return { sku_id: `6980-蓝色-${34 + i}`, i_id: '6980', name: `运动鞋 蓝色 ${34 + i}`, shop_id: '121', shop_price: '59.00', shop_qty: 20 + i * 2, enabled: 'true', properties_value: `蓝色/${34 + i}` };
    }
  };
  return Array.from({ length: 5 }, (_, i) => ({ ...mk(i + 1), _k: `sample-${i}` }));
};

const JstDataPage: React.FC<{ type: string }> = ({ type }) => {
  const cfg = DATA_CFG[type] || DATA_CFG['shop-product'];
  const [accessToken, setAccessToken] = useState<string>(() => localStorage.getItem('jst_access_token') || '');
  const [pageIndex, setPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [isSample, setIsSample] = useState(false);

  const handleQuery = useCallback(async () => {
    setLoading(true); setError(''); setRows([]);
    try {
      const r = await axios.post(`${API_BASE}/jst/call`, { path: cfg.apiPath, biz: cfg.buildBiz(pageIndex, pageSize), accessToken });
      const jst = r.data?.data;
      setRaw(jst);
      if (jst && Number(jst.code) === 0) {
        const list = extractRows(jst);
        setRows(list.map((x, i) => ({ ...x, _k: x?.sku_id || x?.so_id || x?.o_id || i })));
        setIsSample(false);
        if (list.length === 0) message.info('接口调用成功，但沙箱暂无该时间范围内的数据（可点“加载示例数据”预览字段）');
        else message.success(`获取到 ${list.length} 条测试数据`);
      } else {
        setError(`接口返回：code=${jst?.code}，${jst?.msg || ''}（${jst?.code === 130 ? '缺少 access_token，请先授权或粘贴 token' : '请检查参数/授权'}）`);
      }
    } catch (e: any) {
      setError('后端代理调用失败：' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  }, [cfg, pageIndex, pageSize, accessToken]);

  // 动态列：优先展示配置字段（存在的），否则取数据前若干键
  const columns = useMemo(() => {
    const sample = rows[0] || {};
    const keys = Object.keys(sample).filter(k => k !== '_k');
    const present = cfg.preferred.filter(c => keys.includes(c.key));
    const base = present.length > 0 ? present : keys.slice(0, 8).map(k => ({ key: k, label: k }));
    return base.map(c => ({
      title: c.label, dataIndex: c.key, key: c.key, ellipsis: true,
      render: (v: any) => (v === null || v === undefined || v === '' ? <Text type="secondary">-</Text> : String(v)),
    }));
  }, [rows, cfg]);

  return (
    <div style={{ padding: 16, background: '#f0f2f5', minHeight: '100%' }}>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <CloudSyncOutlined style={{ fontSize: 20, color: '#1e4a7e' }} />
          <span style={{ fontWeight: 700, fontSize: 16, color: '#1e4a7e' }}>聚水潭数据 — {cfg.title}</span>
          <Tag color="blue">{cfg.apiPath}</Tag>
        </div>
        <Paragraph type="secondary" style={{ margin: '6px 0 0', fontSize: 12 }}>{cfg.desc}。使用沙箱公共测试账号调用，获取测试数据。</Paragraph>
      </Card>

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 12 }}><KeyOutlined /> access_token：</span>
          <Input style={{ width: 280 }} value={accessToken} placeholder="粘贴 access_token（空=未授权）"
            onChange={e => { setAccessToken(e.target.value); localStorage.setItem('jst_access_token', e.target.value); }} />
          <span style={{ fontSize: 12 }}>页码</span>
          <InputNumber min={1} value={pageIndex} onChange={v => setPageIndex(v || 1)} style={{ width: 70 }} />
          <span style={{ fontSize: 12 }}>每页</span>
          <InputNumber min={1} max={100} value={pageSize} onChange={v => setPageSize(v || 20)} style={{ width: 70 }} />
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={handleQuery}>查询/同步数据</Button>
          <Button onClick={() => { setRows(buildSample(type)); setIsSample(true); setRaw(null); setError(''); message.info('已加载示例演示数据（非真实沙箱数据）'); }}>加载示例数据(演示)</Button>
        </Space>

        {isSample && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="示例演示数据" description="沙箱当前无该模块真实记录，以下为用于预览字段布局的示例数据，非真实接口返回。" />}

        {error && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="调用提示" description={error} />}

        <Table
          size="small"
          rowKey="_k"
          loading={loading}
          columns={columns as any}
          dataSource={rows}
          scroll={{ x: true }}
          pagination={{ pageSize, total: rows.length, showSizeChanger: false }}
          locale={{ emptyText: '暂无数据（点击"查询/同步数据"拉取测试数据）' }}
        />

        {raw && (
          <Collapse size="small" items={[{
            key: 'raw', label: '原始响应 JSON',
            children: <pre style={{ background: '#0f1e33', color: '#d6e4ff', borderRadius: 6, padding: 10, fontSize: 11, maxHeight: 300, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(raw, null, 2)}</pre>,
          }]} />
        )}
      </Card>
    </div>
  );
};

export default JstDataPage;
