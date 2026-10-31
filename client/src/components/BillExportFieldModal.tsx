/**
 * 账单导出字段设置弹窗：按商品编码 / 按款式编码 两种模式分别配置导出字段。
 * 配置按 scope（页面+租户）+ 模式 独立持久化（billExportFields_<scope>_<mode>）；导出时按勾选顺序输出列。
 */
import React, { useEffect, useState } from 'react';
import { Modal, Tabs, Checkbox, Button, Space, message, Row, Col, Typography } from 'antd';
import { exportFieldsOf, loadExportFieldCfg, saveExportFieldCfg } from '../utils/billItemsExport';
import type { BillExportMode } from '../utils/billItemsExport';

const { Text } = Typography;

const BillExportFieldModal: React.FC<{ open: boolean; scope: string; onClose: () => void }> = ({ open, scope, onClose }) => {
  const [mode, setMode] = useState<BillExportMode>('product');
  const [productSel, setProductSel] = useState<string[]>([]);
  const [styleSel, setStyleSel] = useState<string[]>([]);

  // 打开时：读取已保存配置（未配置默认全字段）
  useEffect(() => {
    if (!open) return;
    setProductSel(loadExportFieldCfg(scope, 'product') || exportFieldsOf('product').map(d => d.key));
    setStyleSel(loadExportFieldCfg(scope, 'style') || exportFieldsOf('style').map(d => d.key));
    setMode('product');
  }, [open, scope]);

  const sel = mode === 'product' ? productSel : styleSel;
  const setSel = mode === 'product' ? setProductSel : setStyleSel;
  const defs = exportFieldsOf(mode);

  const toggle = (key: string, checked: boolean) => {
    setSel(prev => (checked ? [...prev, key] : prev.filter(k => k !== key)));
  };

  const handleSave = () => {
    if (!productSel.length || !styleSel.length) {
      message.warning('每种模式至少保留一个导出字段');
      return;
    }
    saveExportFieldCfg(scope, 'product', productSel);
    saveExportFieldCfg(scope, 'style', styleSel);
    message.success('导出字段设置已保存');
    onClose();
  };

  return (
    <Modal title="导出字段设置" open={open} onCancel={onClose} onOk={handleSave} okText="保存" cancelText="取消" width={640}>
      <Tabs activeKey={mode} onChange={k => setMode(k as BillExportMode)} items={[
        { key: 'product', label: `按商品编码（${productSel.length}/${exportFieldsOf('product').length}）` },
        { key: 'style', label: `按款式编码（${styleSel.length}/${exportFieldsOf('style').length}）` },
      ]} />
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>勾选项即导出列（按下方顺序导出）；两种模式的设置相互独立</Text>
        <Space>
          <Button size="small" onClick={() => setSel(defs.map(d => d.key))}>全选</Button>
          <Button size="small" onClick={() => setSel([])}>清空</Button>
        </Space>
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 12 }}>
        <Row gutter={[8, 10]}>
          {defs.map(d => (
            <Col span={8} key={d.key}>
              <Checkbox checked={sel.includes(d.key)} onChange={e => toggle(d.key, e.target.checked)}>{d.label}</Checkbox>
            </Col>
          ))}
        </Row>
      </div>
    </Modal>
  );
};

export default BillExportFieldModal;
