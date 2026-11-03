import React, { useState } from 'react';
import { Card, Input, Button, Switch, Select, Space, Typography, Row, Col, Divider, message, Tag } from 'antd';
import { SaveOutlined, ReloadOutlined, NotificationOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import ImageSlot from '../../components/ImageSlot';
import AnnouncementPanel, {
  ANNOUNCEMENT_KEY, AnnouncementData, AnnLine, DEFAULT_ANNOUNCEMENT, loadAnnouncement,
} from '../../components/AnnouncementPanel';
import { saveDataset } from '../../utils/dataStore';

const { Text } = Typography;

const LINE_TYPE_OPTIONS = [
  { label: '普通文本', value: 'text' },
  { label: '加粗引导（📣）', value: 'lead' },
  { label: '绿色勾选（✓）', value: 'check' },
];

/**
 * 开发者后台 · 公告管理：编辑首页底部公告模板内容（横幅图/标题/简介/要点行/操作链接）；
 * 保存后写入全局同步键 dev_announcement（dev_ 前缀自动跨浏览器同步，首页即时生效）。
 */
const DevAnnouncementPage: React.FC = () => {
  const [draft, setDraft] = useState<AnnouncementData>(() => loadAnnouncement());
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<AnnouncementData>) => setDraft(prev => ({ ...prev, ...p }));

  const updateLine = (idx: number, p: Partial<AnnLine>) => {
    setDraft(prev => ({ ...prev, lines: prev.lines.map((l, i) => (i === idx ? { ...l, ...p } : l)) }));
  };
  const addLine = () => setDraft(prev => ({ ...prev, lines: [...prev.lines, { type: 'check', text: '' }] }));
  const removeLine = (idx: number) => setDraft(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));

  const handleSave = () => {
    setSaving(true);
    const payload: AnnouncementData = {
      ...draft,
      lines: draft.lines.filter(l => (l.text || '').trim()),
    };
    try {
      localStorage.setItem(ANNOUNCEMENT_KEY, JSON.stringify(payload));
      saveDataset(ANNOUNCEMENT_KEY, JSON.stringify(payload));
    } catch { message.error('保存失败（存储空间不足），请更换较小的横幅图后重试'); setSaving(false); return; }
    setDraft(payload);
    setSaving(false);
    message.success('公告已保存，租户首页即时生效');
  };

  const handleReset = () => {
    setDraft(DEFAULT_ANNOUNCEMENT);
    message.info('已恢复默认模板内容，点击「保存公告」生效');
  };

  return (
    <div style={{ padding: 12 }}>
      <Card size="small" style={{ borderRadius: 10 }}
        title={<span style={{ fontSize: 15 }}><NotificationOutlined style={{ marginRight: 8, color: '#1677ff' }} />公告管理</span>}
        extra={
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>恢复默认</Button>
            <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存公告</Button>
          </Space>
        }>
        <Text type="secondary" style={{ fontSize: 12 }}>
          维护租户首页「意见反馈」右侧的公告模板内容（横幅图、标题、简介、要点行、操作链接）。保存后写入全局同步键
          <Text code style={{ fontSize: 11 }}>{ANNOUNCEMENT_KEY}</Text>，跨浏览器自动同步，供应商/采购商首页即时生效。
        </Text>

        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col xs={24} lg={13}>
            <Card size="small" title="内容编辑" style={{ borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontSize: 13 }}>启用公告</Text>
                <Switch checked={draft.enabled} onChange={v => patch({ enabled: v })} />
              </div>

              <div style={{ marginBottom: 6, fontSize: 13 }}>左侧横幅图 <span style={{ color: '#8c8c8c' }}>（留空使用默认促销样式）</span></div>
              <Space align="start" wrap>
                <ImageSlot value={draft.banner} size={120} tip="横幅图"
              onChange={v => patch({ banner: v || '' })} />
                <div style={{ width: 280 }}>
                  <Input style={{ marginBottom: 8 }} placeholder="横幅点击跳转地址（可空）" value={draft.bannerLink}
                    onChange={e => patch({ bannerLink: e.target.value })} />
                  <Text type="secondary" style={{ fontSize: 12 }}>支持 PNG/JPG，槽内可粘贴剪切板图片；点击横幅按上面的地址跳转。</Text>
                </div>
              </Space>

              <Divider style={{ margin: '14px 0' }} />

              <div style={{ marginBottom: 6, fontSize: 13 }}>公告标题</div>
              <Input placeholder="如：2026双十一-商家白皮书" value={draft.title} onChange={e => patch({ title: e.target.value })} />

              <div style={{ margin: '12px 0 6px', fontSize: 13 }}>简介正文</div>
              <Input.TextArea rows={3} placeholder="如：2026双十一大促在即……让我们携手共创佳绩！" value={draft.intro}
                onChange={e => patch({ intro: e.target.value })} />
              <Space style={{ marginTop: 8 }} size={8}>
                <Input style={{ width: 180 }} placeholder="尾部链接文字（如：点击查看详情）" value={draft.introLinkText}
                  onChange={e => patch({ introLinkText: e.target.value })} />
                <Input style={{ width: 260 }} placeholder="链接地址（可空）" value={draft.introLinkUrl}
                  onChange={e => patch({ introLinkUrl: e.target.value })} />
              </Space>

              <div style={{ margin: '16px 0 6px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13 }}>要点行</Text>
                <Button size="small" icon={<PlusOutlined />} onClick={addLine}>添加一行</Button>
              </div>
              {draft.lines.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>暂无要点行</Text>}
              {draft.lines.map((l, i) => (
                <Space key={i} align="start" style={{ marginBottom: 8, display: 'flex' }}>
                  <Select style={{ width: 150 }} value={l.type} options={LINE_TYPE_OPTIONS}
                    onChange={v => updateLine(i, { type: v })} />
                  <Input style={{ width: 300 }} placeholder="该行显示的文字" value={l.text}
                    onChange={e => updateLine(i, { text: e.target.value })} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(i)} />
                </Space>
              ))}

              <Divider style={{ margin: '14px 0' }} />

              <div style={{ marginBottom: 6, fontSize: 13 }}>底部操作链接</div>
              <Space size={8}>
                <Input style={{ width: 220 }} placeholder="链接文字（如：立即体验智能投产控制台）" value={draft.actionText}
                  onChange={e => patch({ actionText: e.target.value })} />
                <Input style={{ width: 300 }} placeholder="链接地址（可空）" value={draft.actionUrl}
                  onChange={e => patch({ actionUrl: e.target.value })} />
              </Space>
            </Card>
          </Col>

          <Col xs={24} lg={11}>
            <Card size="small" title={<span>实时预览 <Tag color="blue" style={{ marginLeft: 6 }}>租户首页效果</Tag></span>} style={{ borderRadius: 8 }}>
              <AnnouncementPanel data={draft} />
            </Card>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default DevAnnouncementPage;
