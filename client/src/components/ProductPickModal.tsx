/**
 * 商品/款式编码多选弹窗（订单管理筛选栏用）：
 * - mode='code' 商品编码列表（去重）；mode='style' 款式编码列表（去重）；
 * - 每页默认 20 行，表体固定高度，超出 20 行出现上下滚动条；
 * - 复选多选 + 搜索过滤，确定后回传所选编码数组。
 */
import React, { useMemo } from 'react';
import { Modal, Input, Table } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

export interface ProductPickRow {
  key: string;
  code: string;
  name: string;
  style: string;
}

const ProductPickModal: React.FC<{
  open: boolean;
  title: string;
  mode: 'code' | 'style';
  owner: string;
  selected: string[];
  setSelected: (v: string[]) => void;
  search: string;
  setSearch: (v: string) => void;
  onClose: () => void;
  onOk: () => void;
}> = ({ open, title, mode, owner, selected, setSelected, search, setSearch, onClose, onOk }) => {
  const rows = useMemo<ProductPickRow[]>(() => {
    let prods: any[] = [];
    try { prods = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${owner}`) || '[]'); } catch { /* ignore */ }
    const seen = new Set<string>();
    const out: ProductPickRow[] = [];
    prods.forEach((p: any) => {
      const code = String(mode === 'code' ? (p.productCode || '') : (p.styleCode || '')).trim();
      if (!code || seen.has(code)) return;
      seen.add(code);
      out.push({ key: code, code, name: p.shortName || p.name || '', style: p.styleCode || '' });
    });
    return out;
  }, [owner, mode]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(r => `${r.code}${r.name}${r.style}`.toLowerCase().includes(kw));
  }, [rows, search]);

  return (
    <Modal title={title} open={open} onCancel={onClose} onOk={onOk} okText="确定" cancelText="取消" width={600} zIndex={1200}>
      <Input placeholder="搜索编码/名称" allowClear prefix={<SearchOutlined style={{ color: '#b0bec5' }} />}
        value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
      <Table size="small" bordered rowKey="key"
        pagination={{ defaultPageSize: 20, pageSizeOptions: ['20', '50', '100'], showSizeChanger: true, size: 'small', showTotal: t => `共 ${t} 条` }}
        scroll={{ y: 780 }}
        dataSource={filtered}
        rowSelection={{ type: 'checkbox', selectedRowKeys: selected, onChange: keys => setSelected(keys as string[]) }}
        columns={mode === 'code' ? [
          { title: '商品编码', dataIndex: 'code', key: 'code' },
          { title: '商品简称', dataIndex: 'name', key: 'name' },
          { title: '款式编码', dataIndex: 'style', key: 'style' },
        ] : [
          { title: '款式编码', dataIndex: 'code', key: 'code' },
          { title: '示例商品', dataIndex: 'name', key: 'name' },
        ]}
        locale={{ emptyText: '暂无商品' }}
      />
    </Modal>
  );
};

export default ProductPickModal;
