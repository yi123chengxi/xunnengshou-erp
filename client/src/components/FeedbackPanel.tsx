import React, { useState } from 'react';
import { Card, Input, Button, Select, Upload, Space, message, Typography, Image as AntdImage } from 'antd';
import { UploadOutlined, DeleteOutlined, FormOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { compressImageFile } from '../utils/imageCompress';
import { saveDataset } from '../utils/dataStore';

/**
 * 首页底部意见反馈面板（展开式提交表单，替代原 FeedbackModal 弹窗）：
 * 反馈内容（200字以内）+ 联系电话 + 分类 + 最多 4 张 PNG/JPG 截图（走共享压缩管线）；
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
  phone?: string;
  category?: string;
  createdAt: string;
}

export const FEEDBACK_KEY_PREFIX = 'dev_feedback_';

const { Text } = Typography;

const CATEGORIES = ['需求', '改进建议', '程序缺陷', '投诉', '举报', '其他'];
const MAX_IMAGES = 4;
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

const FeedbackPanel: React.FC = () => {
  // 默认展开显示提交表单（可收起）
  const [collapsed, setCollapsed] = useState(false);
  const [content, setContent] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [images, setImages] = useState<string[]>([]);

  const reset = () => { setContent(''); setPhone(''); setCategory(undefined); setImages([]); };

  // 上传图片：仅限 PNG/JPG，经压缩管线转 dataURL，最多 4 张
  const handleUpload = (f: File) => {
    const t = (f.type || '').toLowerCase();
    if (!ACCEPT_TYPES.includes(t)) { message.warning('仅限PNG/JPG图片'); return false; }
    if (images.length >= MAX_IMAGES) { message.warning(`最多上传 ${MAX_IMAGES} 张图片`); return false; }
    compressImageFile(f)
      .then(url => setImages(prev => (prev.length >= MAX_IMAGES ? prev : [...prev, url])))
      .catch(() => message.error('图片读取失败'));
    return false;
  };

  const handleSubmit = () => {
    const text = content.trim();
    if (!text) { message.warning('请填写反馈内容'); return; }
    const entry: FeedbackEntry = {
      key: `${FEEDBACK_KEY_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      username: localStorage.getItem('username') || '',
      company: localStorage.getItem('companyName') || '',
      platform: window.location.pathname.startsWith('/purchaser') ? '采购商平台' : '供应商平台',
      content: text,
      images: [...images],
      phone: phone.trim(),
      category: category || '',
      createdAt: new Date().toLocaleString('zh-CN'),
    };
    try {
      localStorage.setItem(entry.key, JSON.stringify(entry));
      saveDataset(entry.key, JSON.stringify(entry));
    } catch { message.error('反馈保存失败（存储空间不足），请减少截图后重试'); return; }
    message.success('反馈已提交，感谢您的支持！');
    reset();
  };

  return (
    <Card size="small" style={{ borderRadius: 10, height: '100%' }}
      title={<span style={{ fontWeight: 600 }}><FormOutlined style={{ marginRight: 6, color: '#1677ff' }} />意见反馈</span>}
      extra={
        <Button type="link" size="small" icon={collapsed ? <DownOutlined /> : <UpOutlined />}
          onClick={() => setCollapsed(c => !c)}>{collapsed ? '展开' : '收起'}</Button>
      }>
      {collapsed ? null : (
        <div>
          <Input.TextArea rows={6} maxLength={200} value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="请输入需求、改进建议，反馈程序缺陷及投诉、举报，200字以内" />
          <Input style={{ marginTop: 12 }} maxLength={30} autoComplete="off" value={phone}
            onChange={e => setPhone(e.target.value)} placeholder="请输入手机号或固定号码" />
          <Select style={{ marginTop: 12, width: '100%' }} placeholder="选择分类" value={category}
            onChange={v => setCategory(v)} options={CATEGORIES.map(c => ({ label: c, value: c }))} />
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Upload accept=".png,.jpg,.jpeg" showUploadList={false} beforeUpload={handleUpload}>
              <Button icon={<UploadOutlined />}>上传图片</Button>
            </Upload>
            <Text type="secondary" style={{ fontSize: 12 }}>仅限PNG/JPG</Text>
          </div>
          {images.length > 0 && (
            <Space wrap size={10} style={{ marginTop: 10 }}>
              {images.map((src, i) => (
                <div key={i} style={{ position: 'relative', width: 64, height: 64 }}>
                  <AntdImage src={src} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />}
                    style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }}
                    onClick={() => setImages(prev => prev.filter((_, x) => x !== i))} />
                </div>
              ))}
            </Space>
          )}
          <Button block style={{ marginTop: 16 }} onClick={handleSubmit}>立即提交</Button>
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <Text style={{ fontSize: 13, color: '#7a8ea3' }}>热线电话：400-806-8666</Text>
          </div>
        </div>
      )}
    </Card>
  );
};

export default FeedbackPanel;
