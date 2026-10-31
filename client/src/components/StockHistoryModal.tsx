import React from 'react';
import { Modal, Table, Tag, Typography } from 'antd';
import { HistoryOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { getStockLogs, StockLogEntry } from '../utils/stockUtils';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  productCode: string;
  productName: string;
}

const StockHistoryModal: React.FC<Props> = ({ open, onClose, productCode, productName }) => {
  // 历史记录缺失业务类型时按关联单据号前缀兑底推导（RK=入库/PD=盘点/CK=出库）
  const logs = React.useMemo<StockLogEntry[]>(
    () => (open && productCode ? getStockLogs(productCode).map(l => {
      if (l.type) return l;
      const doc = String(l.relatedDocNo || '');
      const derived = doc.startsWith('RK') ? '入库' : doc.startsWith('CK') ? '出库' : '盘点';
      return { ...l, type: derived as StockLogEntry['type'] };
    }) : []),
    [open, productCode],
  );

  // 计算库存增减小计
  const totalChange = React.useMemo(() => logs.reduce((s, l) => s + (l.changeQty || 0), 0), [logs]);

  const columns = [
    {
      title: '序号', key: 'index', width: 50, align: 'center' as const,
      render: (_: any, __: any, idx: number) => <span style={{ color: '#8c8c8c' }}>{idx + 1}</span>,
    },
    {
      title: '业务类型', dataIndex: 'type', key: 'type', width: 80, align: 'center' as const,
      render: (v: string) => {
        const colorMap: Record<string, string> = { '入库': 'blue', '盘点': 'orange', '出库': 'red' };
        return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '时间', dataIndex: 'createTime', key: 'createTime', width: 160, align: 'center' as const,
    },
    {
      title: '库存增减数', dataIndex: 'changeQty', key: 'changeQty', width: 110, align: 'center' as const,
      render: (v: number) => {
        if (v > 0) {
          return (
            <span style={{ display: 'inline-block', background: '#52c41a', color: '#fff', borderRadius: 4, padding: '2px 10px', fontWeight: 600, minWidth: 60, fontFamily: 'monospace' }}>
              <ArrowUpOutlined style={{ marginRight: 4 }} />+{v}
            </span>
          );
        }
        if (v < 0) {
          return (
            <span style={{ display: 'inline-block', background: '#ff4d4f', color: '#fff', borderRadius: 4, padding: '2px 10px', fontWeight: 600, minWidth: 60, fontFamily: 'monospace' }}>
              <ArrowDownOutlined style={{ marginRight: 4 }} />{v}
            </span>
          );
        }
        return <span style={{ color: '#8c8c8c', fontFamily: 'monospace' }}>0</span>;
      },
    },
    {
      title: '变动前库存', dataIndex: 'beforeStock', key: 'beforeStock', width: 100, align: 'center' as const,
      render: (v: number) => <span style={{ fontFamily: 'monospace' }}>{v}</span>,
    },
    {
      title: '变动后库存', dataIndex: 'afterStock', key: 'afterStock', width: 100, align: 'center' as const,
      render: (v: number) => <Text strong style={{ fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: '关联单据', dataIndex: 'relatedDocNo', key: 'relatedDocNo', width: 140, align: 'center' as const,
      render: (v: string) => <Text style={{ color: '#1890ff' }}>{v || '—'}</Text>,
    },
    {
      title: '操作人', dataIndex: 'operator', key: 'operator', width: 80, align: 'center' as const,
      render: (v: string) => v || '—',
    },
    {
      title: '备注', dataIndex: 'remark', key: 'remark', width: 150,
      render: (v: string) => v || '—',
    },
  ];

  return (
    <Modal
      title={
        <span>
          <HistoryOutlined style={{ marginRight: 8, color: '#1e4a7e' }} />
          实际库存明细 — {productName || productCode}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={1100}
      zIndex={1300}
      destroyOnClose
    >
      {logs.length > 0 ? (
        <Table
          bordered
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条记录` }}
          dataSource={logs}
          rowKey={(r) => r.id}
          columns={columns}
          scroll={{ y: 400 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3} align="center">
                  <Text strong>小计</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center">
                  {totalChange > 0 ? (
                    <span style={{ display: 'inline-block', background: '#52c41a', color: '#fff', borderRadius: 4, padding: '2px 10px', fontWeight: 600, fontFamily: 'monospace' }}>
                      <ArrowUpOutlined style={{ marginRight: 4 }} />+{totalChange}
                    </span>
                  ) : totalChange < 0 ? (
                    <span style={{ display: 'inline-block', background: '#ff4d4f', color: '#fff', borderRadius: 4, padding: '2px 10px', fontWeight: 600, fontFamily: 'monospace' }}>
                      <ArrowDownOutlined style={{ marginRight: 4 }} />{totalChange}
                    </span>
                  ) : (
                    <Text strong style={{ fontFamily: 'monospace' }}>0</Text>
                  )}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={5} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
          暂无库存变化记录
        </div>
      )}
    </Modal>
  );
};

export default StockHistoryModal;
