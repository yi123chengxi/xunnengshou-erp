import React from 'react';
import { Card, Table, Button, Space, Tag, Typography, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';

const { Title } = Typography;

const MaterialList: React.FC = () => {
  const columns = [
    { title: '物料编码', dataIndex: 'material_code', key: 'material_code' },
    { title: '物料名称', dataIndex: 'material_name', key: 'material_name' },
    { title: '分类', dataIndex: 'category', key: 'category' },
    { title: '规格', dataIndex: 'spec', key: 'spec' },
    { title: '单位', dataIndex: 'unit', key: 'unit' },
    { title: '采购价', dataIndex: 'purchase_price', key: 'purchase_price', render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: number) => v === 1 ? <Tag color="success">启用</Tag> : <Tag color="default">停用</Tag> },
    { title: '操作', key: 'action', render: () => (
      <Space><Button type="link" size="small">编辑</Button></Space>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>原材料管理</Title>
        <Space>
          <Input placeholder="搜索物料" prefix={<SearchOutlined />} style={{ width: 200 }} />
          <Button type="primary" icon={<PlusOutlined />}>新增物料</Button>
        </Space>
      </div>
      <Card><Table columns={columns} dataSource={[]} rowKey="id" /></Card>
    </div>
  );
};

export default MaterialList;
