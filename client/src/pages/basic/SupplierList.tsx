import React from 'react';
import { Card, Table, Button, Space, Tag, Typography, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';

const { Title } = Typography;

const SupplierList: React.FC = () => {
  const columns = [
    { title: '供应商编号', dataIndex: 'supplier_code', key: 'supplier_code' },
    { title: '供应商名称', dataIndex: 'supplier_name', key: 'supplier_name' },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '应付余额', dataIndex: 'balance', key: 'balance', render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: number) => v === 1 ? <Tag color="success">正常</Tag> : <Tag color="default">停用</Tag> },
    { title: '操作', key: 'action', render: () => (
      <Space><Button type="link" size="small">编辑</Button><Button type="link" size="small">查看账单</Button></Space>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>供应商管理</Title>
        <Space>
          <Input placeholder="搜索供应商" prefix={<SearchOutlined />} style={{ width: 200 }} />
          <Button type="primary" icon={<PlusOutlined />}>新增供应商</Button>
        </Space>
      </div>
      <Card><Table columns={columns} dataSource={[]} rowKey="id" /></Card>
    </div>
  );
};

export default SupplierList;
