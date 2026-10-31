import React, { useState } from 'react';
import { Modal, Input, Button, Space, message } from 'antd';
import { PlusOutlined, FormOutlined } from '@ant-design/icons';
import ImageSlot from './ImageSlot';
import { saveDataset } from '../utils/dataStore';

/**
 * 首页意见反馈窗口：内容 + 最多 4 张截图（ImageSlot 自带槽内粘贴按键与压缩管线）；
 * 提交后按条写入全局同步键 dev_feedback_<id>（dev_ 前缀在 serverSync 白名单内，
 * 开发者后台「意见反馈」页跨租户汇总展示）。
 */
export interface FeedbackEntry {
  key: string;
  username: string;
  company: string;
  platform: string;
  content: string;
  images: string[];
  createdAt: string;
}

export const FEEDBACK_KEY_PREFIX = 'dev_feedback_';

const FeedbackModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>(['']);

  const reset = () => { setContent(''); setImages(['']); };

  const handleSubmit = () => {
    const text = content.trim();
    if (!text) { message.warning('请填写反馈内容'); return; }
    const pics = images.map(s => (s || '').trim()).filter(Boolean);
    const entry: FeedbackEntry = {
      key: `${FEEDBACK_KEY_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      username: localStorage.getItem('username') || '',
      company: localStorage.getItem('companyName') || '',
      platform: window.location.pathname.startsWith('/purchaser') ? '采购商平台' : '供应商平台',
      content: text,
      images: pics,
      createdAt: new Date().toLocaleString('zh-CN'),
    };
    try {
      localStorage.setItem(entry.key, JSON.stringify(entry));
      saveDataset(entry.key, JSON.stringify(entry));
    } catch { message.error('反馈保存失败（存储空间不足），请减少截图后重试'); return; }
    message.success('反馈已提交，感谢您的支持！');
    reset();
    onClose();
  };

  return (
    <Modal title={<span><FormOutlined style={{ marginRight: 6, color: '#1677ff' }} />意见反馈</span>}
      open={open} onCancel={() => { reset(); onClose(); }} width={620}
      onOk={handleSubmit} okText="提交反馈" cancelText="取消">
      <div style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 6, fontSize: 13 }}>反馈内容 <span style={{ color: '#ff4d4f' }}>*</span></div>
        <Input.TextArea rows={5} maxLength={500} showCount value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="请描述您遇到的问题或改进建议（如：某页面操作不便、数据口径疑问、希望新增的功能等）" />
        <div style={{ margin: '12px 0 6px', fontSize: 13 }}>截图（可选，最多 4 张，槽内支持粘贴按键）</div>
        <Space wrap size={10}>
          {images.map((img, i) => (
            <ImageSlot key={i} value={img} size={84} tip={`截图${i + 1}`}
              onChange={v => setImages(prev => {
                if (v) { const next = [...prev]; next[i] = v; return next; }
                const next = prev.filter((_, x) => x !== i);
                return next.length ? next : [''];
              })} />
          ))}
          {images.filter(Boolean).length < 4 && images[images.length - 1] !== '' && (
            <Button type="dashed" icon={<PlusOutlined />} style={{ width: 84, height: 84 }}
              onClick={() => setImages(prev => [...prev, ''])}>添加图片</Button>
          )}
        </Space>
      </div>
    </Modal>
  );
};

export default FeedbackModal;
