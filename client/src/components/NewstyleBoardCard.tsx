/**
 * 新款进度看板卡片（供应商首页/采购商首页共用）
 * 数据与统计口径完全复用 NewStyleProgressPage.computeNewstyleBoard（与新款进度页统计卡同值）
 */
import React, { useMemo } from 'react';
import { Card, Table, Tag, Button, Typography, Space, Empty } from 'antd';
import { computeNewstyleBoard } from '../pages/NewStyleProgressPage';

const { Text } = Typography;

interface Props { owner: string; nonce?: number; onMore: () => void; }

const NewstyleBoardCard: React.FC<Props> = ({ owner, nonce, onMore }) => {
  const board = useMemo(() => computeNewstyleBoard(owner), [owner, nonce]);
  const s = board.stats;
  const items = [
    { label: '新款总数', value: s.total, color: '#1a2b45' },
    { label: '货号为空', value: s.emptyCode, color: '#f5222d' },
    { label: '成本价为空', value: s.emptyCost, color: '#fa8c16' },
    { label: '到货逾期', value: s.arrivalOver, color: '#f5222d' },
    { label: '资料未完善', value: s.incomplete, color: '#fa8c16' },
    { label: '拍照逾期', value: s.photoOver, color: '#fa8c16' },
    { label: '上架逾期', value: s.listOver, color: '#f5222d' },
  ];
  const columns: any[] = [
    { title: '货号', dataIndex: 'styleCode', width: 110, render: (v: string) => (v ? <Text strong style={{ color: '#1677ff' }}>{v}</Text> : <Text type="secondary">—</Text>) },
    { title: '成本价', dataIndex: 'costPrice', width: 80, align: 'right', render: (v: any) => (Number(v) > 0 ? `¥${Number(v).toFixed(0)}` : '—') },
    { title: '颜色', dataIndex: 'color', width: 120, ellipsis: true, render: (v: string) => v || '—' },
    { title: '工厂名称', dataIndex: 'factory', width: 110, ellipsis: true, render: (v: string) => v || '—' },
    { title: '品牌', dataIndex: 'brand', width: 90, ellipsis: true, render: (v: string) => v || '—' },
    { title: '创建时间', dataIndex: 'createdAt', width: 100, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{String(v || '').slice(0, 10) || '—'}</Text> },
    {
      title: '状态', key: 'flags', width: 200, render: (_: any, r: any) => {
        const tags: React.ReactNode[] = [];
        if (r.boardArrival === '到货逾期') tags.push(<Tag color="red" key="a">到货逾期</Tag>);
        else if (r.boardArrival === '已到货' || r.boardArrival === '已收到') tags.push(<Tag color="green" key="a">{r.boardArrival}</Tag>);
        if (r.boardPhotoOver) tags.push(<Tag color="orange" key="p">拍照逾期</Tag>);
        if (r.boardListOver) tags.push(<Tag color="red" key="l">上架逾期</Tag>);
        if (r.boardIncomplete) tags.push(<Tag color="orange" key="i">资料未完善</Tag>);
        return tags.length ? <Space size={2} wrap>{tags}</Space> : <Text type="secondary">正常</Text>;
      },
    },
  ];
  return (
    <Card size="small" style={{ borderRadius: 10, marginBottom: 16 }}
      title={<span style={{ fontWeight: 600 }}>新款进度看板</span>}
      extra={<Button type="link" size="small" onClick={onMore}>查看全部</Button>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
        {items.map(it => (
          <div key={it.label} style={{ flex: '1 1 110px', minWidth: 100, background: '#fafcfd', border: '1px solid #eef2f6', borderRadius: 8, padding: '8px 12px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{it.label}</Text>
            <div style={{ fontWeight: 700, fontSize: 18, color: it.color }}>{it.value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>款</span></div>
          </div>
        ))}
      </div>
      {board.rows.length === 0 ? <Empty description="暂无新款记录" /> : (
        <Table rowKey={(r: any) => r.key || r.styleCode || Math.random()} size="small" bordered pagination={false}
          dataSource={board.rows.slice(0, 6)} columns={columns} />
      )}
    </Card>
  );
};

export default NewstyleBoardCard;
