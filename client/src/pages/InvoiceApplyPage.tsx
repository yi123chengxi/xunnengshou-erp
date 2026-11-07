import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Tag, Modal, Empty, Input, Image,
} from 'antd';
import { ReloadOutlined, FileTextOutlined, CheckCircleOutlined, PictureOutlined, DeleteOutlined, SnippetsOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import useResizableColumns from '../hooks/useResizableColumns';
import { readInbox, writeInbox, syncApplicantRecordStatus, normInvoiceStatus, isInvoiceDone, resolveApplicantCompany, InvoiceApplyRequest } from '../utils/invoiceApply';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

// ===================== 主组件 =====================
// 供应商侧「财务管理-开票申请」：接收合作供应商/采购商推送过来的进项票开票申请，
// 标记已开票时回写申请方开票记录（invoice_record_<申请方>）完成闭环
const InvoiceApplyPage: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const [records, setRecords] = useState<InvoiceApplyRequest[]>([]);
  const [searchText, setSearchText] = useState('');

  const reload = useCallback(() => { setRecords(readInbox(owner)); }, [owner]);
  useEffect(() => {
    reload();
    const onSync = () => reload();
    window.addEventListener('sync-data-updated', onSync);
    return () => window.removeEventListener('sync-data-updated', onSync);
  }, [reload]);

  // 开票完成 → 发票上传窗口：确认后本方收件箱落库 + 回写申请方开票记录状态「开票成功」+ 发票图片（闭环）
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<InvoiceApplyRequest | null>(null);
  const [uploadImage, setUploadImage] = useState('');

  const openCompleteUpload = (r: InvoiceApplyRequest) => {
    setUploadTarget(r);
    setUploadImage('');
    setUploadVisible(true);
  };

  // 粘贴键：读取剪贴板图片
  const handlePasteBtn = useCallback(() => {
    const nav = navigator as any;
    if (!nav.clipboard || !nav.clipboard.read) { message.warning('当前浏览器不支持剪贴板读取，请点击上传区域后 Ctrl+V 粘贴'); return; }
    nav.clipboard.read().then((items: any[]) => {
      for (const item of items) {
        const type = (item.types || []).find((t: string) => t.startsWith('image/'));
        if (type) {
          item.getType(type).then((blob: Blob) => {
            const reader = new FileReader();
            reader.onload = ev => setUploadImage(ev.target?.result as string);
            reader.readAsDataURL(blob);
          });
          return;
        }
      }
      message.warning('剪贴板中没有图片');
    }).catch(() => message.warning('无法读取剪贴板，请点击上传区域后 Ctrl+V 粘贴'));
  }, []);

  // 上传区域内 Ctrl+V 粘贴
  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = ev => setUploadImage(ev.target?.result as string);
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, []);

  const handleConfirmComplete = async () => {
    if (!uploadTarget) return;
    const target = uploadTarget;
    const list = records.map(x => (x.applyNo === target.applyNo ? { ...x, status: '开票成功' as const, invoiceImage: uploadImage || x.invoiceImage } : x));
    writeInbox(owner, list);
    setRecords(list);
    // 跨浏览器兼容：本地无申请方开票记录时内部自动改走服务端拉取→回传
    const synced = await syncApplicantRecordStatus(target.applicantUsername, target.applyNo, '开票成功', uploadImage || undefined);
    setUploadVisible(false);
    setUploadTarget(null);
    message.success(synced ? `开票完成，已同步申请方开票记录为「开票成功」${uploadImage ? '并附发票图片' : ''}` : '开票完成（未找到申请方对应记录）');
  };

  // ===================== 过滤 =====================
  const filtered = useMemo(() => {
    if (!searchText.trim()) return records;
    const q = searchText.toLowerCase();
    return records.filter(r =>
      (r.applyNo || '').toLowerCase().includes(q) ||
      (r.applicantCompany || '').toLowerCase().includes(q) ||
      resolveApplicantCompany(r.applicantCompany, r.applicantUsername).toLowerCase().includes(q) ||
      (r.projectName || '').toLowerCase().includes(q) ||
      (r.supplierName || '').toLowerCase().includes(q)
    );
  }, [records, searchText]);

  const pendingCount = useMemo(() => records.filter(r => !isInvoiceDone(r.status)).length, [records]);

  // 列宽拖拽
  const { wrapColumns } = useResizableColumns<InvoiceApplyRequest>(`colWidths_invoiceApply_${owner}`);

  // ===================== 表格列 =====================
  const columns: ColumnsType<InvoiceApplyRequest> = [
    { title: '申请单号', dataIndex: 'applyNo', key: 'applyNo', width: 150, fixed: 'left' as const,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: '申请方公司', dataIndex: 'applicantCompany', key: 'applicantCompany', width: 200,
      render: (v: string, r: InvoiceApplyRequest) => {
        // 历史数据可能存账号名：按账号反查公司名称展示
        const name = resolveApplicantCompany(v, r.applicantUsername);
        return name || <Text type="secondary">—</Text>;
      } },
    { title: '项目名称', dataIndex: 'projectName', key: 'projectName', width: 160, ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '发票金额', dataIndex: 'amount', key: 'amount', width: 130, align: 'right' as const,
      render: (v: number) => v ? <Text strong style={{ color: '#f5222d' }}>¥{Number(v).toFixed(2)}</Text> : <Text type="secondary">—</Text> },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 90, align: 'right' as const,
      render: (v: number) => v ? v : <Text type="secondary">—</Text> },
    { title: '单价', dataIndex: 'unitPrice', key: 'unitPrice', width: 110, align: 'right' as const,
      render: (v: number) => v ? `¥${Number(v).toFixed(2)}` : <Text type="secondary">—</Text> },
    { title: '月份范围', dataIndex: 'months', key: 'months', width: 140,
      render: (v: string[]) => (Array.isArray(v) && v.length) ? v.join('、') : <Text type="secondary">全部</Text> },
    { title: '申请日期', dataIndex: 'applyDate', key: 'applyDate', width: 120,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '开票状态', dataIndex: 'status', key: 'status', width: 100, align: 'center' as const,
      render: (v: string) => isInvoiceDone(v)
        ? <Tag color="green" style={{ margin: 0 }}>{normInvoiceStatus(v)}</Tag>
        : <Tag color="red" style={{ margin: 0 }}>待开票</Tag> },
    { title: '发票图片', dataIndex: 'invoiceImage', key: 'invoiceImage', width: 90, align: 'center' as const,
      render: (v: string) => v ? (
        <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} preview={{ mask: <PictureOutlined /> }} />
      ) : <Text type="secondary">—</Text> },
    { title: '操作', key: 'action', width: 120, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: InvoiceApplyRequest) => isInvoiceDone(r.status)
        ? <Text type="secondary">已完成</Text>
        : (
          <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => openCompleteUpload(r)}>开票完成</Button>
        ) },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 140, ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
  ];

  return (
    <div style={{ padding: 0 }}>
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '16px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Space>
            <FileTextOutlined style={{ fontSize: 22, color: PRIMARY }} />
            <Title level={4} style={{ margin: 0, color: PRIMARY }}>开票申请</Title>
            <Tag color="blue">{records.length} 条申请</Tag>
            {pendingCount > 0 && <Tag color="orange">{pendingCount} 条待开票</Tag>}
          </Space>
          <Space>
            <Text type="secondary">搜索申请单号/申请方/项目名称</Text>
            <Input.Search placeholder="搜索" value={searchText} onChange={e => setSearchText(e.target.value)} allowClear style={{ width: 220 }} />
            <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
          </Space>
        </div>
      </Card>

      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<InvoiceApplyRequest>
          bordered
          columns={wrapColumns(columns)}
          dataSource={filtered}
          rowKey="key"
          scroll={{ x: 1400, y: 'calc(100vh - 360px)' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条申请` }}
          size="middle"
          locale={{ emptyText: <Empty description="暂无开票申请（合作方向您推送开票申请后显示在此处）" /> }}
        />
      </Card>

      {/* 开票完成 - 发票上传弹窗 */}
      <Modal title="发票上传 - 开票完成" open={uploadVisible} onCancel={() => setUploadVisible(false)} width={480}
        footer={
          <Space>
            <Button onClick={() => setUploadVisible(false)}>取消</Button>
            <Button type="primary" onClick={handleConfirmComplete}>确认开票完成</Button>
          </Space>
        }>
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">申请单号：{uploadTarget?.applyNo}　申请方：{resolveApplicantCompany(uploadTarget?.applicantCompany, uploadTarget?.applicantUsername)}　发票金额：¥{Number(uploadTarget?.amount || 0).toFixed(2)}</Text>
        </div>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <Text>发票图片 <Text type="secondary" style={{ fontSize: 12 }}>（选填）</Text></Text>
            <Button size="small" icon={<SnippetsOutlined />} onClick={handlePasteBtn}>粘贴</Button>
          </Space>
        </div>
        <div onPaste={handlePasteImage} tabIndex={0}
          style={{ border: '2px dashed #d9d9d9', borderRadius: 8, padding: 12, outline: 'none', minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
          {uploadImage ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Image src={uploadImage} width={240} style={{ maxHeight: 280, objectFit: 'contain', borderRadius: 4 }} />
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => setUploadImage('')}
                style={{ position: 'absolute', top: -8, right: -8 }} />
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#999', cursor: 'pointer' }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'image/*';
                input.onchange = (ev: any) => {
                  const file = ev.target?.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = e => setUploadImage(e.target?.result as string);
                  reader.readAsDataURL(file);
                };
                input.click();
              }}>
              <PictureOutlined style={{ fontSize: 30 }} />
              <div style={{ marginTop: 6, fontSize: 12 }}>点击选择图片，或点「粘贴」/ 聚焦后 Ctrl+V 粘贴剪贴板</div>
            </div>
          )}
        </div>
        <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
          * 确认开票完成后，申请方开票记录状态将同步为「开票成功」，上传的发票图片一并送达申请方
        </div>
      </Modal>
    </div>
  );
};

export default InvoiceApplyPage;
