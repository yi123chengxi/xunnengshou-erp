import React, { useMemo, useState } from 'react';
import { Modal, Table, Input, Tag, Space, Button, Empty, Image } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import type { MoldRecord } from '../pages/MoldPage';

const PRIMARY = '#1e4a7e';

interface MoldPickerModalProps {
  open: boolean;
  value?: string;
  onSelect: (moldCode: string) => void;
  onCancel: () => void;
  onAddNew?: () => void;
  zIndex?: number;
}

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (!isSub) return localStorage.getItem('username') || '';
  return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
};

const MoldPickerModal: React.FC<MoldPickerModalProps> = ({ open, value, onSelect, onCancel, onAddNew, zIndex }) => {
  const [search, setSearch] = useState('');

  const records: MoldRecord[] = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(`molds_${getDataOwner()}`) || '[]');
    } catch { return []; }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return records;
    const q = search.trim().toLowerCase();
    return records.filter(r =>
      (r.moldCode || '').toLowerCase().includes(q) ||
      (r.moldName || '').toLowerCase().includes(q) ||
      (r.spec || '').toLowerCase().includes(q)
    );
  }, [records, search]);

  const cols: ColumnsType<MoldRecord> = [
    {
      title: '图片', dataIndex: 'images', key: 'images', width: 70, align: 'center',
      render: (imgs: string[] | undefined) => imgs && imgs.length > 0
        ? <Image src={imgs[0]} width={45} height={45} style={{ objectFit: 'cover', borderRadius: 4 }} />
        : <span style={{ color: '#ccc', fontSize: 12 }}>无图</span>,
    },
    {
      title: '模具编号', dataIndex: 'moldCode', key: 'moldCode', width: 150,
      render: v => v ? <span style={{ fontFamily: 'monospace', fontWeight: 600, color: PRIMARY }}>{v}</span> : '—',
    },
    { title: '模具名称', dataIndex: 'moldName', key: 'moldName', width: 140, render: v => v || '—' },
    { title: '规格型号', dataIndex: 'spec', key: 'spec', width: 110, render: v => v || '—' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 70, align: 'center',
      render: v => {
        const colors: Record<string, string> = { '在用': 'green', '停用': 'orange', '报废': 'red' };
        return <Tag color={colors[v] || 'default'}>{v || '—'}</Tag>;
      },
    },
  ];

  return (
    <Modal
      title={<span style={{ color: PRIMARY }}>选择模具</span>}
      open={open}
      onCancel={onCancel}
      footer={onAddNew ? [
        <Button key="add" icon={<PlusOutlined />} onClick={() => { onCancel(); onAddNew(); }}>新增模具</Button>,
        <Button key="cancel" onClick={onCancel}>取消</Button>,
      ] : [
        <Button key="cancel" onClick={onCancel}>取消</Button>,
      ]}
      width={640}
      destroyOnClose
      zIndex={zIndex}
    >
      <Input
        placeholder="搜索模具编号/名称/规格"
        prefix={<SearchOutlined />}
        style={{ marginBottom: 10 }}
        value={search}
        onChange={e => setSearch(e.target.value)}
        allowClear
        autoFocus
      />
      <Table
        rowKey="key"
        size="small"
        bordered
        columns={cols}
        dataSource={filtered}
        pagination={filtered.length > 10 ? { pageSize: 10, showTotal: t => `共 ${t} 个` } : false}
        locale={{ emptyText: <Empty description="暂无模具，请先在基础数据-模具管理中添加" /> }}
        onRow={(record) => ({
          onClick: () => onSelect(record.moldCode),
          style: {
            cursor: 'pointer',
            background: record.moldCode === value ? '#e6f4ff' : undefined,
          },
        })}
      />
    </Modal>
  );
};

export default MoldPickerModal;
