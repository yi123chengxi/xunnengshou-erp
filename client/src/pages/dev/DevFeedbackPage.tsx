import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Image, Space, Modal, Input, message, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, FormOutlined, PlusOutlined } from '@ant-design/icons';
import ImageSlot from '../../components/ImageSlot';
import useResizableColumns from '../../hooks/useResizableColumns';
import { getDevIdentity } from '../../utils/devStore';
import { saveDataset } from '../../utils/dataStore';
import { FEEDBACK_KEY_PREFIX, FeedbackEntry } from '../../components/FeedbackModal';

const { Text } = Typography;

/** 处理记录：随反馈条目一并存于 dev_feedback_<id> 键（dev_ 前缀全局同步） */
interface HandleInfo {
  by: string;
  at: string;
  note: string;
  images: string[];
}

interface FeedbackRow extends FeedbackEntry {
  handled?: HandleInfo;
}

/**
 * 开发者后台 · 意见反馈：汇总所有租户在首页「意见反馈」窗口提交的内容与截图；
 * 开发者可点「已处理」填写处理说明/截图，提交后列表显示处理完成状态、处理人与时间。
 * 表格带列边线，列宽可拖拽表头右边缘自由调整（按开发者账号持久化）。
 */
const DevFeedbackPage: React.FC = () => {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const identity = getDevIdentity();
  const { wrapColumns } = useResizableColumns<FeedbackRow>(`colWidths_devFeedback_${identity.user}`);

  // 已处理弹窗
  const [handleVisible, setHandleVisible] = useState(false);
  const [handleTarget, setHandleTarget] = useState<FeedbackRow | null>(null);
  const [handleNote, setHandleNote] = useState('');
  const [handleImages, setHandleImages] = useState<string[]>(['']);

  const load = () => {
    const list: FeedbackRow[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(FEEDBACK_KEY_PREFIX) || k.endsWith('_ts')) continue; // 跳过 dataStore 伴生时间戳键
      try {
        const e = JSON.parse(localStorage.getItem(k) || '{}');
        if (e && e.content) {
          list.push({
            key: k,
            username: e.username || '',
            company: e.company || '',
            platform: e.platform || '',
            content: String(e.content),
            images: Array.isArray(e.images) ? e.images.filter(Boolean) : [],
            createdAt: e.createdAt || '',
            handled: e.handled && typeof e.handled === 'object' ? e.handled : undefined,
          });
        }
      } catch { /* 跳过坏键 */ }
    }
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    setRows(list);
  };

  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => { if (e.key && e.key.startsWith(FEEDBACK_KEY_PREFIX)) load(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const openHandle = (r: FeedbackRow) => {
    setHandleTarget(r);
    setHandleNote(r.handled?.note || '');
    setHandleImages(r.handled?.images?.length ? [...r.handled.images] : ['']);
    setHandleVisible(true);
  };

  const submitHandle = () => {
    if (!handleTarget) return;
    const note = handleNote.trim();
    if (!note) { message.warning('请填写处理说明'); return; }
    const info: HandleInfo = {
      by: identity.name || identity.user || '开发者',
      at: new Date().toLocaleString('zh-CN'),
      note,
      images: handleImages.map(s => (s || '').trim()).filter(Boolean),
    };
    try {
      const raw = JSON.parse(localStorage.getItem(handleTarget.key) || '{}');
      const next = { ...raw, handled: info };
      localStorage.setItem(handleTarget.key, JSON.stringify(next));
      saveDataset(handleTarget.key, JSON.stringify(next));
    } catch { message.error('保存失败（存储空间不足），请减少截图后重试'); return; }
    message.success('已标记处理完成');
    setHandleVisible(false);
    setHandleTarget(null);
    load();
  };

  const columns: any[] = [
    { title: '反馈时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
    { title: '反馈账号', dataIndex: 'username', key: 'username', width: 140, render: (v: string) => v || '-' },
    { title: '公司名称', dataIndex: 'company', key: 'company', width: 200, render: (v: string) => v || '-' },
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 100, render: (v: string) => <Tag color={v === '采购商平台' ? 'purple' : 'blue'}>{v || '-'}</Tag> },
    {
      title: '反馈内容', dataIndex: 'content', key: 'content', width: 360, ellipsis: { showTitle: false },
      render: (v: string) => <Tooltip title={v} placement="topLeft"><span style={{ whiteSpace: 'pre-wrap' }}>{v}</span></Tooltip>,
    },
    {
      title: '截图', dataIndex: 'images', key: 'images', width: 180,
      render: (imgs: string[]) => imgs?.length
        ? <Space size={4}><Image.PreviewGroup>{imgs.map((src, i) => <Image key={i} src={src} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} />)}</Image.PreviewGroup></Space>
        : <Text type="secondary">-</Text>,
    },
    {
      title: '处理状态', key: 'handledState', width: 110, align: 'center',
      render: (_: any, r: FeedbackRow) => r.handled
        ? <Tag color="green" icon={<CheckCircleOutlined />}>处理完成</Tag>
        : <Tag color="orange">待处理</Tag>,
    },
    { title: '处理人', key: 'handledBy', width: 110, render: (_: any, r: FeedbackRow) => r.handled?.by || '-' },
    { title: '处理时间', key: 'handledAt', width: 170, render: (_: any, r: FeedbackRow) => r.handled?.at || '-' },
    {
      title: '处理回复', key: 'handledNote', width: 240, ellipsis: { showTitle: false },
      render: (_: any, r: FeedbackRow) => {
        if (!r.handled) return <Text type="secondary">-</Text>;
        return (
          <Tooltip title={r.handled.note} placement="topLeft">
            <Space size={4}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140, display: 'inline-block' }}>{r.handled.note}</span>
              {r.handled.images?.length > 0 && (
                <Image.PreviewGroup>
                  {r.handled.images.map((src, i) => <Image key={i} src={src} width={28} height={28} style={{ objectFit: 'cover', borderRadius: 4 }} />)}
                </Image.PreviewGroup>
              )}
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: '操作', key: 'action', width: 90, fixed: 'right' as const,
      render: (_: any, r: FeedbackRow) => (
        <Button type="link" size="small" icon={<CheckCircleOutlined />} style={r.handled ? { color: '#8c8c8c' } : { color: '#52c41a', fontWeight: 600 }}
          onClick={() => openHandle(r)}>{r.handled ? '查看/更新' : '已处理'}</Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ borderRadius: 10 }}
        title={<span style={{ fontSize: 15 }}><FormOutlined style={{ marginRight: 8, color: '#1677ff' }} />意见反馈</span>}
        extra={<Space><Text type="secondary" style={{ fontSize: 12 }}>共 {rows.length} 条</Text><Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button></Space>}>
        <Text type="secondary" style={{ fontSize: 12 }}>各租户首页「意见反馈」窗口提交的内容与截图，按条汇总、提交时间倒序展示；图片点击可放大（同组可左右切换）；列宽可拖拽表头右边缘调整。</Text>
        <Table size="small" bordered rowKey="key" columns={wrapColumns(columns)} dataSource={rows} scroll={{ x: 1870 }} style={{ marginTop: 10 }}
          pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }} />
      </Card>

      {/* 已处理弹窗：处理说明 + 截图（ImageSlot 槽内自带粘贴按键） */}
      <Modal title={`处理反馈${handleTarget ? `（${handleTarget.username || '未知账号'} · ${handleTarget.createdAt}）` : ''}`}
        open={handleVisible} onCancel={() => setHandleVisible(false)} onOk={submitHandle}
        okText="提交处理完成" cancelText="取消" width={560}>
        <div style={{ marginTop: 8 }}>
          {handleTarget && (
            <div style={{ background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, padding: '8px 10px', marginBottom: 12, fontSize: 12, color: '#5a6d85', maxHeight: 96, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {handleTarget.content}
            </div>
          )}
          <div style={{ marginBottom: 6, fontSize: 13 }}>处理说明 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input.TextArea rows={4} maxLength={300} showCount value={handleNote} onChange={e => setHandleNote(e.target.value)}
            placeholder="请填写处理结果说明（如：已修复并上线 / 已联系客户说明 / 排期中）" />
          <div style={{ margin: '12px 0 6px', fontSize: 13 }}>处理截图（可选，最多 3 张，槽内支持粘贴按键）</div>
          <Space wrap size={10}>
            {handleImages.map((img, i) => (
              <ImageSlot key={i} value={img} size={80} tip={`截图${i + 1}`}
                onChange={v => setHandleImages(prev => {
                  if (v) { const next = [...prev]; next[i] = v; return next; }
                  const next = prev.filter((_, x) => x !== i);
                  return next.length ? next : [''];
                })} />
            ))}
            {handleImages.filter(Boolean).length < 3 && handleImages[handleImages.length - 1] !== '' && (
              <Button type="dashed" icon={<PlusOutlined />} style={{ width: 80, height: 80 }}
                onClick={() => setHandleImages(prev => [...prev, ''])}>添加图片</Button>
            )}
          </Space>
          {handleTarget?.handled && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#8c8c8c' }}>
              上次处理：{handleTarget.handled.by} · {handleTarget.handled.at}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default DevFeedbackPage;
