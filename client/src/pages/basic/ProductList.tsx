import React, { useState, useMemo, useCallback, useEffect } from 'react';
import FieldConfigModal from '../../components/FieldConfigModal';
import {
  Card, Table, Button, Space, Tag, Typography, Input, Popover, Checkbox,
  Divider, Row, Col, Tooltip, Badge,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, SettingOutlined,
  ExportOutlined, ReloadOutlined, EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;
const PRIMARY = '#1e4a7e';

// 列定义接口
interface ColumnDef {
  key: string;
  title: string;
  dataIndex: string;
  group: string;
  defaultVisible: boolean;
  width: number;
  render?: (value: any, record: any) => React.ReactNode;
  sorter?: boolean | ((a: any, b: any) => number);
  align?: 'left' | 'center' | 'right';
  fixed?: 'left' | 'right';
}

// 所有列定义（参考Excel字段）
const ALL_COLUMNS: ColumnDef[] = [
  // 基本信息
  { key: 'styleCode', title: '款式编码', dataIndex: 'styleCode', group: '基本信息', defaultVisible: true, width: 120, fixed: 'left' },
  { key: 'image', title: '图片', dataIndex: 'image', group: '基本信息', defaultVisible: true, width: 70, align: 'center',
    render: (v: string) => v ? <img src={v} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ color: '#d9d9d9' }}>无</span>,
  },
  { key: 'productCode', title: '商品编码', dataIndex: 'productCode', group: '基本信息', defaultVisible: true, width: 140 },
  { key: 'shortName', title: '商品简称', dataIndex: 'shortName', group: '基本信息', defaultVisible: false, width: 120 },
  { key: 'nationalCode', title: '国标码', dataIndex: 'nationalCode', group: '基本信息', defaultVisible: false, width: 130 },
  { key: 'auxCode', title: '辅助码', dataIndex: 'auxCode', group: '基本信息', defaultVisible: false, width: 130 },
  { key: 'productTags', title: '商品标签', dataIndex: 'productTags', group: '基本信息', defaultVisible: false, width: 120,
    render: (v: string) => v ? v.split(',').map((t: string, i: number) => <Tag key={i} style={{ marginBottom: 2 }}>{t.trim()}</Tag>) : '-',
  },
  { key: 'productAttrs', title: '商品属性', dataIndex: 'productAttrs', group: '基本信息', defaultVisible: false, width: 120 },
  { key: 'status', title: '商品状态', dataIndex: 'status', group: '基本信息', defaultVisible: true, width: 90, align: 'center',
    render: (v: string) => {
      const map: Record<string, { color: string; text: string }> = {
        '在售': { color: 'success', text: '在售' },
        '下架': { color: 'default', text: '下架' },
        '预售': { color: 'processing', text: '预售' },
      };
      const s = map[v] || { color: 'default', text: v || '-' };
      return <Tag color={s.color}>{s.text}</Tag>;
    },
  },
  { key: 'supplierName', title: '供应商名称', dataIndex: 'supplierName', group: '基本信息', defaultVisible: false, width: 140 },
  { key: 'supplierCode', title: '供应商编号', dataIndex: 'supplierCode', group: '基本信息', defaultVisible: false, width: 120 },
  { key: 'creator', title: '创建人', dataIndex: 'creator', group: '基本信息', defaultVisible: false, width: 90 },
  { key: 'createdAt', title: '创建时间', dataIndex: 'createdAt', group: '基本信息', defaultVisible: false, width: 110 },
  { key: 'updatedAt', title: '修改时间', dataIndex: 'updatedAt', group: '基本信息', defaultVisible: false, width: 110 },

  // 价格
  { key: 'suggestedPrice', title: '基础售价', dataIndex: 'suggestedPrice', group: '价格', defaultVisible: true, width: 100, align: 'right',
    render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-',
    sorter: (a: any, b: any) => (a.suggestedPrice || 0) - (b.suggestedPrice || 0),
  },
  { key: 'costPrice', title: '成本价', dataIndex: 'costPrice', group: '价格', defaultVisible: false, width: 100, align: 'right',
    render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-',
    sorter: (a: any, b: any) => (a.costPrice || 0) - (b.costPrice || 0),
  },
  { key: 'otherPrice1', title: '其它价格1', dataIndex: 'otherPrice1', group: '价格', defaultVisible: false, width: 100, align: 'right',
    render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-',
  },

  // 规格属性
  { key: 'colorSpec', title: '颜色及规格', dataIndex: 'colorSpec', group: '规格属性', defaultVisible: false, width: 120 },
  { key: 'color', title: '颜色', dataIndex: 'color', group: '规格属性', defaultVisible: true, width: 80 },
  { key: 'spec', title: '规格', dataIndex: 'spec', group: '规格属性', defaultVisible: true, width: 80 },
  { key: 'brand', title: '品牌', dataIndex: 'brand', group: '规格属性', defaultVisible: true, width: 90 },
  { key: 'category', title: '分类', dataIndex: 'category', group: '规格属性', defaultVisible: true, width: 100 },
  { key: 'weight', title: '重量', dataIndex: 'weight', group: '规格属性', defaultVisible: false, width: 80 },
  { key: 'weightKg', title: '重量kg', dataIndex: 'weightKg', group: '规格属性', defaultVisible: false, width: 80, align: 'right',
    render: (v: number) => v != null ? `${v}kg` : '-',
  },

  // 库存
  { key: 'actualStock', title: '实际库存数', dataIndex: 'actualStock', group: '库存', defaultVisible: true, width: 100, align: 'right',
    sorter: (a: any, b: any) => (a.actualStock || 0) - (b.actualStock || 0),
  },
  { key: 'orderReserved', title: '订单占用数', dataIndex: 'orderReserved', group: '库存', defaultVisible: true, width: 100, align: 'right' },
  { key: 'availableStock', title: '可用数', dataIndex: 'availableStock', group: '库存', defaultVisible: false, width: 80, align: 'right',
    render: (v: number, r: any) => {
      const avail = (r.actualStock || 0) - (r.orderReserved || 0);
      return <Text style={{ color: avail < 0 ? '#ff4d4f' : '#52c41a' }}>{avail}</Text>;
    },
  },
  { key: 'pendingShip', title: '仓库待发数', dataIndex: 'pendingShip', group: '库存', defaultVisible: false, width: 110, align: 'right' },
  { key: 'mainWarehouse', title: '主仓位', dataIndex: 'mainWarehouse', group: '库存', defaultVisible: false, width: 90 },
  { key: 'suppWarehouse', title: '补充仓位', dataIndex: 'suppWarehouse', group: '库存', defaultVisible: false, width: 100 },
  { key: 'stockSync', title: '库存同步', dataIndex: 'stockSync', group: '库存', defaultVisible: false, width: 90, align: 'center',
    render: (v: boolean) => v ? <Tag color="green">已同步</Tag> : <Tag color="orange">未同步</Tag>,
  },
  { key: 'stockLower', title: '库容下限', dataIndex: 'stockLower', group: '库存', defaultVisible: false, width: 90, align: 'right' },
  { key: 'stockUpper', title: '库容上限', dataIndex: 'stockUpper', group: '库存', defaultVisible: false, width: 90, align: 'right' },
  { key: 'stdBoxQty', title: '标准装箱数量', dataIndex: 'stdBoxQty', group: '库存', defaultVisible: false, width: 120, align: 'right' },
  { key: 'stdBoxVol', title: '标准装箱体积', dataIndex: 'stdBoxVol', group: '库存', defaultVisible: false, width: 120, align: 'right' },

  // 销售统计
  { key: 'yesterdaySales', title: '昨天销量', dataIndex: 'yesterdaySales', group: '销售统计', defaultVisible: false, width: 90, align: 'right' },
  { key: 'yesterdayShipped', title: '昨天实发量', dataIndex: 'yesterdayShipped', group: '销售统计', defaultVisible: false, width: 100, align: 'right' },
  { key: 'yesterdayReturns', title: '昨天退货量', dataIndex: 'yesterdayReturns', group: '销售统计', defaultVisible: false, width: 100, align: 'right' },
  { key: 'week7Sales', title: '7天销量', dataIndex: 'week7Sales', group: '销售统计', defaultVisible: false, width: 90, align: 'right',
    sorter: (a: any, b: any) => (a.week7Sales || 0) - (b.week7Sales || 0),
  },
  { key: 'week7Shipped', title: '7天实发量', dataIndex: 'week7Shipped', group: '销售统计', defaultVisible: false, width: 100, align: 'right' },
  { key: 'week7Returns', title: '7天退货量', dataIndex: 'week7Returns', group: '销售统计', defaultVisible: false, width: 100, align: 'right' },
  { key: 'day15Sales', title: '15天销量', dataIndex: 'day15Sales', group: '销售统计', defaultVisible: false, width: 90, align: 'right' },
  { key: 'day15Shipped', title: '15天实发量', dataIndex: 'day15Shipped', group: '销售统计', defaultVisible: false, width: 100, align: 'right' },
  { key: 'day15Returns', title: '15天退货量', dataIndex: 'day15Returns', group: '销售统计', defaultVisible: false, width: 100, align: 'right' },

  // 其它
  { key: 'remark', title: '备注', dataIndex: 'remark', group: '其它', defaultVisible: false, width: 150,
    render: (v: string) => v ? <Tooltip title={v}><Text ellipsis style={{ maxWidth: 130 }}>{v}</Text></Tooltip> : '-',
  },
  { key: 'otherProp1', title: '其它属性1', dataIndex: 'otherProp1', group: '其它', defaultVisible: false, width: 100 },
  { key: 'otherProp2', title: '其它属性2', dataIndex: 'otherProp2', group: '其它', defaultVisible: false, width: 100 },
  { key: 'otherProp3', title: '其它属性3', dataIndex: 'otherProp3', group: '其它', defaultVisible: false, width: 100 },
  { key: 'otherProp4', title: '其它属性4', dataIndex: 'otherProp4', group: '其它', defaultVisible: false, width: 100 },
  { key: 'otherProp5', title: '其它属性5', dataIndex: 'otherProp5', group: '其它', defaultVisible: false, width: 100 },
];

// 分组
const COLUMN_GROUPS = ['基本信息', '价格', '规格属性', '库存', '销售统计', '其它'];

// 默认显示的列 key 集合
const DEFAULT_VISIBLE_KEYS = new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// localStorage key
const getVisibleColsKey = () => 'product_visible_columns_' + (localStorage.getItem('username') || '');

const loadVisibleKeys = (): string[] => {
  try {
    const data = localStorage.getItem(getVisibleColsKey());
    if (data) return JSON.parse(data);
  } catch { /* ignore */ }
  return ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
};

const saveVisibleKeys = (keys: string[]) => {
  localStorage.setItem(getVisibleColsKey(), JSON.stringify(keys));
};

// 模拟数据
const generateMockData = () => {
  const brands = ['自主品牌', '代工品牌A', '代工品牌B', ''];
  const categories = ['电子产品', '服装配件', '五金工具', '包装材料', '办公用品', '家居用品'];
  const colors = ['黑色', '白色', '红色', '蓝色', '灰色', ''];
  const specs = ['S', 'M', 'L', 'XL', '标准', '大号', ''];
  const statuses = ['在售', '在售', '在售', '下架', '预售'];
  const suppliers = ['深圳华鑫电子', '广州盛达五金', '东莞永盛包装', '苏州精工科技', ''];
  const warehouses = ['A-01', 'A-02', 'B-01', 'B-03', 'C-01'];

  const data: any[] = [];
  for (let i = 1; i <= 30; i++) {
    const stock = Math.floor(Math.random() * 500) + 10;
    const reserved = Math.floor(Math.random() * stock * 0.3);
    data.push({
      key: String(i),
      styleCode: `SK${String(2024000 + i)}`,
      image: '',
      productCode: `SKU${String(100000 + i)}`,
      shortName: `产品${i}简称`,
      nationalCode: `GB${String(6900000 + Math.floor(Math.random() * 99999))}`,
      auxCode: `AX${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
      productTags: i % 3 === 0 ? '热销,新品' : i % 5 === 0 ? '促销' : '',
      productAttrs: i % 4 === 0 ? '易碎品' : '',
      status: statuses[Math.floor(Math.random() * statuses.length)],
      supplierName: suppliers[Math.floor(Math.random() * suppliers.length)],
      supplierCode: i % 3 === 0 ? `SUP${String(1000 + i)}` : '',
      creator: 'admin',
      createdAt: '2024-06-' + String(Math.floor(Math.random() * 28) + 1).padStart(2, '0'),
      updatedAt: '2024-07-' + String(Math.floor(Math.random() * 18) + 1).padStart(2, '0'),
      suggestedPrice: Math.round((Math.random() * 500 + 10) * 100) / 100,
      costPrice: Math.round((Math.random() * 200 + 5) * 100) / 100,
      otherPrice1: i % 2 === 0 ? Math.round((Math.random() * 100 + 5) * 100) / 100 : null,
      colorSpec: '',
      color: colors[Math.floor(Math.random() * colors.length)],
      spec: specs[Math.floor(Math.random() * specs.length)],
      brand: brands[Math.floor(Math.random() * brands.length)],
      category: categories[Math.floor(Math.random() * categories.length)],
      weight: i % 3 === 0 ? `${Math.floor(Math.random() * 5000 + 100)}g` : '',
      weightKg: i % 3 === 0 ? Math.round(Math.random() * 5 * 100) / 100 : null,
      actualStock: stock,
      orderReserved: reserved,
      availableStock: stock - reserved,
      pendingShip: Math.floor(Math.random() * 20),
      mainWarehouse: warehouses[Math.floor(Math.random() * warehouses.length)],
      suppWarehouse: i % 4 === 0 ? warehouses[Math.floor(Math.random() * warehouses.length)] : '',
      stockSync: Math.random() > 0.3,
      stockLower: Math.floor(Math.random() * 10) + 5,
      stockUpper: Math.floor(Math.random() * 500) + 200,
      stdBoxQty: Math.floor(Math.random() * 100) + 10,
      stdBoxVol: `${(Math.random() * 0.5 + 0.01).toFixed(3)}m³`,
      yesterdaySales: Math.floor(Math.random() * 50),
      yesterdayShipped: Math.floor(Math.random() * 45),
      yesterdayReturns: Math.floor(Math.random() * 5),
      week7Sales: Math.floor(Math.random() * 300),
      week7Shipped: Math.floor(Math.random() * 280),
      week7Returns: Math.floor(Math.random() * 20),
      day15Sales: Math.floor(Math.random() * 600),
      day15Shipped: Math.floor(Math.random() * 550),
      day15Returns: Math.floor(Math.random() * 40),
      remark: i % 5 === 0 ? '需要关注库存变化' : '',
      otherProp1: '', otherProp2: '', otherProp3: '', otherProp4: '', otherProp5: '',
    });
  }
  return data;
};

const ProductList: React.FC = () => {
  const [dataSource] = useState(generateMockData);
  const [searchText, setSearchText] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadVisibleKeys);
  const [colPopoverVisible, setColPopoverVisible] = useState(false);

  // 持久化可见列配置
  useEffect(() => {
    saveVisibleKeys(visibleKeys);
  }, [visibleKeys]);

  // 列选择器内容
  const renderColumnSelector = useCallback(() => {
    const visibleSet = new Set(visibleKeys);
    return (
      <div style={{ width: 320, maxHeight: 420, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13 }}>显示字段设置</Text>
          <Space size="small">
            <Button
              type="link"
              size="small"
              onClick={() => setVisibleKeys(ALL_COLUMNS.map(c => c.key))}
            >
              全选
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => setVisibleKeys(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))}
            >
              恢复默认
            </Button>
          </Space>
        </div>
        {COLUMN_GROUPS.map(group => {
          const groupCols = ALL_COLUMNS.filter(c => c.group === group);
          const checkedCount = groupCols.filter(c => visibleSet.has(c.key)).length;
          return (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <Checkbox
                  checked={checkedCount === groupCols.length}
                  indeterminate={checkedCount > 0 && checkedCount < groupCols.length}
                  onChange={(e) => {
                    const newSet = new Set(visibleKeys);
                    groupCols.forEach(c => {
                      if (e.target.checked) newSet.add(c.key);
                      else newSet.delete(c.key);
                    });
                    setVisibleKeys(Array.from(newSet));
                  }}
                >
                  <Text strong style={{ fontSize: 12, color: PRIMARY }}>{group}</Text>
                </Checkbox>
                <Badge
                  count={`${checkedCount}/${groupCols.length}`}
                  style={{ backgroundColor: checkedCount === groupCols.length ? '#52c41a' : '#d9d9d9', fontSize: 10, marginLeft: 6 }}
                />
              </div>
              <div style={{ marginLeft: 24 }}>
                <Row gutter={[0, 2]}>
                  {groupCols.map(col => (
                    <Col span={8} key={col.key}>
                      <Checkbox
                        checked={visibleSet.has(col.key)}
                        onChange={(e) => {
                          const newSet = new Set(visibleKeys);
                          if (e.target.checked) newSet.add(col.key);
                          else newSet.delete(col.key);
                          setVisibleKeys(Array.from(newSet));
                        }}
                        style={{ fontSize: 12 }}
                      >
                        {col.title}
                      </Checkbox>
                    </Col>
                  ))}
                </Row>
              </div>
              <Divider style={{ margin: '6px 0' }} />
            </div>
          );
        })}
      </div>
    );
  }, [visibleKeys]);

  // 根据可见列构建表格 columns（按 visibleKeys 顺序）
  const columns: ColumnsType<any> = useMemo(() => {
    const vSet = new Set(visibleKeys);
    const cols: ColumnsType<any> = [];
    visibleKeys.forEach(key => {
      const colDef = ALL_COLUMNS.find(c => c.key === key);
      if (!colDef || !vSet.has(colDef.key)) return;
      const col: any = {
        title: colDef.title,
        dataIndex: colDef.dataIndex,
        key: colDef.key,
        width: colDef.width,
        ellipsis: true,
      };
      if (colDef.render) col.render = colDef.render;
      if (colDef.sorter) col.sorter = colDef.sorter;
      if (colDef.align) col.align = colDef.align;
      if (colDef.fixed) col.fixed = colDef.fixed;
      cols.push(col);
    });
    // 操作列始终在最右
    cols.push({
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right' as const,
      render: () => (
        <Space size="small">
          <Button type="link" size="small">编辑</Button>
          <Button type="link" size="small">详情</Button>
        </Space>
      ),
    });
    return cols;
  }, [visibleKeys]);

  // 搜索过滤
  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const lower = searchText.toLowerCase();
    return dataSource.filter(item =>
      (item.styleCode || '').toLowerCase().includes(lower) ||
      (item.productCode || '').toLowerCase().includes(lower) ||
      (item.shortName || '').includes(searchText) ||
      (item.brand || '').includes(searchText) ||
      (item.category || '').includes(searchText)
    );
  }, [dataSource, searchText]);

  return (
    <div>
      {/* 页面头部 */}
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`,
        color: '#fff', padding: '16px 24px', borderRadius: 12, marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>产品管理</Title>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
            管理产品信息、库存、价格和销售数据
          </Text>
        </div>
        <Space>
          <Button ghost icon={<ExportOutlined />}>导出</Button>
          <Button type="primary" ghost icon={<PlusOutlined />}>新增产品</Button>
        </Space>
      </div>

      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Input
            placeholder="搜索款式编码、商品编码、名称、品牌..."
            prefix={<SearchOutlined />}
            style={{ width: 320 }}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={() => setSearchText('')}>
            刷新
          </Button>
        </Space>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已显示 {visibleKeys.length}/{ALL_COLUMNS.length} 个字段
          </Text>
          <Button icon={<SettingOutlined />} type={visibleKeys.length !== DEFAULT_VISIBLE_KEYS.size ? 'primary' : 'default'} onClick={() => setColPopoverVisible(true)}>
            显示字段
            {visibleKeys.length !== DEFAULT_VISIBLE_KEYS.size && (
              <Badge count={visibleKeys.length} style={{ marginLeft: 4, backgroundColor: PRIMARY }} />
            )}
          </Button>
        </Space>
      </div>

      {/* 显示字段设置弹窗（统一卡片式+拖动排序） */}
      <FieldConfigModal
        open={colPopoverVisible}
        fields={ALL_COLUMNS.map(c => ({ key: c.key, label: c.title }))}
        order={visibleKeys}
        visibility={Object.fromEntries(ALL_COLUMNS.map(c => [c.key, visibleKeys.includes(c.key)]))}
        onCancel={() => setColPopoverVisible(false)}
        onSave={(o, v) => { setVisibleKeys(o.filter(k => v[k])); setColPopoverVisible(false); }}
      />

      {/* 表格 */}
      <Card bodyStyle={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="key"
          scroll={{ x: columns.reduce((sum, c: any) => sum + (c.width || 100), 0) }}
          size="small"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条产品`,
            pageSizeOptions: ['10', '20', '50'],
          }}
        />
      </Card>
    </div>
  );
};

export default ProductList;
