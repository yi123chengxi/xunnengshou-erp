import React, { useState } from 'react';
import { Tabs } from 'antd';
import BrandAuthPage from './BrandAuthPage';
import OwnBrandPage from './OwnBrandPage';
import MyBrandCertsPage from './MyBrandCertsPage';

/**
 * 品牌管理（电商常用菜单单一入口）
 * 内部以页签形式承载子页面：授权品牌 / 自有品牌 / 我的授权书
 * 供应商与采购商平台均显示三个页签，数据源一致
 */
const BrandManagePage: React.FC<{ platform?: 'supplier' | 'purchaser' }> = ({ platform = 'supplier' }) => {
  const [tab, setTab] = useState('authorized');
  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* 页签内容撑满链：表格局部滚动 + 横向滚动条/分页贴窗底，外侧不出现滚动条 */}
      <style>{`
        .brand-mgr-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .brand-mgr-tabs .ant-tabs-content-holder { flex: 1; min-height: 0; }
        .brand-mgr-tabs .ant-tabs-content { height: 100%; }
        .brand-mgr-tabs .ant-tabs-tabpane { height: 100%; overflow: hidden; }
      `}</style>
      <Tabs
        className="brand-mgr-tabs"
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'authorized', label: '授权品牌', children: <BrandAuthPage embedded /> },
          { key: 'own', label: '自有品牌', children: <OwnBrandPage embedded /> },
          { key: 'mycerts', label: '我的授权书', children: <MyBrandCertsPage /> },
        ]}
      />
    </div>
  );
};

export default BrandManagePage;
