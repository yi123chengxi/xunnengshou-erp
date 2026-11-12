import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Input, Button, Select, Upload, Space, message, Typography, Image as AntdImage,
  Tag, Empty, Divider,
} from 'antd';
import {
  UploadOutlined, DeleteOutlined, FormOutlined, DownOutlined, UpOutlined,
  RightOutlined, CheckCircleOutlined, ClockCircleOutlined, HistoryOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { compressImageFile } from '../utils/imageCompress';
import { saveDataset } from '../utils/dataStore';
import { getDataOwner } from '../utils/brandAuth';

/** 开发者处理结果（与开发者后台 DevFeedbackPage 写入的 handled 字段同构） */
export interface FeedbackHandleInfo {
  by: string;      // 处理人（开发者显示名）
  at: string;      // 处理时间
  note: string;    // 处理说明
  images: string[]; // 处理截图（dataURL）
}

/**
 * 首页底部意见反馈面板（展开式提交表单，替代原 FeedbackModal 弹窗）：
 * 反馈内容（200字以内）+ 联系电话 + 分类 + 最多 4 张 PNG/JPG 截图（走共享压缩管线）；
 * 提交后按条写入全局同步键 dev_feedback_<id>（dev_ 前缀在 serverSync 白名单内，
 * 开发者后台「意见反馈」页跨租户汇总展示）。
 * 表单下方「我的反馈记录」列表：点击条目展开查看反馈原文/截图与开发者处理结果。
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
  handled?: FeedbackHandleInfo;
}

export const FEEDBACK_KEY_PREFIX = 'dev_feedback_';

const { Text } = Typography;

const CATEGORIES = ['需求', '改进建议', '程序缺陷', '投诉', '举报', '其他'];
const MAX_IMAGES = 4;
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

/**
 * 当前账号的公司名称：登录链路只写 username/userRole，从不写 localStorage.companyName，
 * 故历史读法（localStorage.getItem('companyName')）恒为空 → 开发者后台公司名称列显示「-」。
 * 统一改为按账号反查 registeredUsers.companyName（子账号取其父账号）。
 */
export const resolveMyCompanyName = (): string => {
  try {
    const me = localStorage.getItem('username') || '';
    const owner = getDataOwner() || me;
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { users = []; }
    const list = Array.isArray(users) ? users : [];
    const hit = list.find((x: any) => x.username === owner) || list.find((x: any) => x.username === me);
    return String(hit?.companyName || localStorage.getItem('companyName') || '').trim();
  } catch { return ''; }
};

/** 反馈时间排序值（历史数据为 zh-CN 本地化字符串，月/日未补零，不能直接字符串比较） */
const timeValue = (s?: string): number => {
  const t = new Date(String(s || '').replace(/-/g, '/')).getTime();
  return isNaN(t) ? 0 : t;
};

/** 扫描本地 dev_feedback_ 键（按条独立存储、全局同步），返回全部租户的反馈记录 */
export const loadFeedbackRecords = (): FeedbackEntry[] => {
  const list: FeedbackEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(FEEDBACK_KEY_PREFIX) || k.endsWith('_ts')) continue; // 跳过 dataStore 伴生时间戳键
    try {
      const e = JSON.parse(localStorage.getItem(k) || '{}');
      if (!e || !e.content) continue;
      list.push({
        key: k,
        username: e.username || '',
        company: e.company || '',
        platform: e.platform || '',
        content: String(e.content),
        images: Array.isArray(e.images) ? e.images.filter(Boolean) : [],
        phone: e.phone || '',
        category: e.category || '',
        createdAt: e.createdAt || '',
        handled: e.handled && typeof e.handled === 'object' ? e.handled : undefined,
      });
    } catch { /* 跳过坏键 */ }
  }
  list.sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  return list;
};

/** 当前租户（含子账号与主账号本人）提交过的反馈记录 */
export const loadMyFeedbackRecords = (): FeedbackEntry[] => {
  const me = localStorage.getItem('username') || '';
  const owner = getDataOwner() || me;
  const mine = new Set([me, owner].filter(Boolean));
  if (!mine.size) return [];
  return loadFeedbackRecords().filter(r => mine.has(r.username));
};

const FeedbackPanel: React.FC = () => {
  // 默认展开显示提交表单（可收起）
  const [collapsed, setCollapsed] = useState(false);
  const [content, setContent] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [images, setImages] = useState<string[]>([]);
  // 我的反馈记录：expandedKey 控制单条展开（一次展开一条，避免列表过长）
  const [records, setRecords] = useState<FeedbackEntry[]>([]);
  const [expandedKey, setExpandedKey] = useState('');

  const reloadRecords = useCallback(() => { setRecords(loadMyFeedbackRecords()); }, []);

  useEffect(() => {
    reloadRecords();
    // 他端新增/开发者处理结果回传：storage（跨标签页）+ sync-data-updated（同步轮询落地）
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith(FEEDBACK_KEY_PREFIX)) reloadRecords(); };
    const onSync = () => reloadRecords();
    window.addEventListener('storage', onStorage);
    window.addEventListener('sync-data-updated', onSync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sync-data-updated', onSync);
    };
  }, [reloadRecords]);

  const reset = () => { setContent(''); setPhone(''); setCategory(undefined); setImages([]); };

  // 表单容器粘贴事件：支持 Ctrl+V 粘贴截图
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleUpload(file);
        }
        break;
      }
    }
  };

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
      company: resolveMyCompanyName(),
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
    reloadRecords();
    setExpandedKey(entry.key); // 提交后自动展开该条记录，便于确认
  };

  return (
    <Card size="small" style={{ borderRadius: 10, height: '100%' }}
      title={<span style={{ fontWeight: 600 }}><FormOutlined style={{ marginRight: 6, color: '#1677ff' }} />意见反馈</span>}
      extra={
        <Button type="link" size="small" icon={collapsed ? <DownOutlined /> : <UpOutlined />}
          onClick={() => setCollapsed(c => !c)}>{collapsed ? '展开' : '收起'}</Button>
      }>
      {collapsed ? null : (
        <div tabIndex={0} onPaste={handlePaste} style={{ outline: 'none' }}>
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
        </div>
      )}

      {/* 我的反馈记录：点击条目展开查看反馈原文/截图与开发者处理结果 */}
      <Divider style={{ margin: '14px 0 8px' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          <HistoryOutlined style={{ marginRight: 6, color: '#1677ff' }} />我的反馈记录
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>共 {records.length} 条</Text>
        </span>
        <Button type="link" size="small" icon={<ReloadOutlined />} onClick={reloadRecords}
          style={{ padding: 0, height: 20, fontSize: 12 }}>刷新</Button>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 2 }}>
        {records.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '10px 0' }}
            description={<span style={{ fontSize: 12 }}>还没有提交过反馈</span>} />
        ) : records.map(r => {
          const open = expandedKey === r.key;
          return (
            <div key={r.key} style={{ border: '1px solid #e8eef5', borderRadius: 8, marginBottom: 8, background: '#fff' }}>
              <div onClick={() => setExpandedKey(open ? '' : r.key)}
                style={{ cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                {open
                  ? <DownOutlined style={{ fontSize: 10, color: '#8c8c8c', flex: '0 0 auto' }} />
                  : <RightOutlined style={{ fontSize: 10, color: '#8c8c8c', flex: '0 0 auto' }} />}
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.content}
                </span>
                <span style={{ fontSize: 11, color: '#8c8c8c', flex: '0 0 auto' }}>{String(r.createdAt || '').split(' ')[0]}</span>
                {r.handled
                  ? <Tag color="green" icon={<CheckCircleOutlined />} style={{ marginRight: 0, fontSize: 11, flex: '0 0 auto' }}>已处理</Tag>
                  : <Tag color="orange" icon={<ClockCircleOutlined />} style={{ marginRight: 0, fontSize: 11, flex: '0 0 auto' }}>待处理</Tag>}
              </div>
              {open && (
                <div style={{ borderTop: '1px dashed #eef2f7', padding: '8px', fontSize: 12 }}>
                  <div style={{ color: '#8c8c8c', marginBottom: 4 }}>
                    {r.createdAt}
                    {r.category ? ` · ${r.category}` : ''}
                    {r.phone ? ` · ${r.phone}` : ''}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{r.content}</div>
                  {r.images?.length > 0 && (
                    <Space wrap size={6} style={{ marginTop: 6 }}>
                      <AntdImage.PreviewGroup>
                        {r.images.map((src, i) => (
                          <AntdImage key={i} src={src} width={48} height={48}
                            style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }} />
                        ))}
                      </AntdImage.PreviewGroup>
                    </Space>
                  )}
                  <div style={{ marginTop: 8 }}>
                    {r.handled ? (
                      <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '6px 8px' }}>
                        <div style={{ color: '#389e0d', fontWeight: 600, marginBottom: 4 }}>开发者处理结果</div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{r.handled.note}</div>
                        {r.handled.images?.length > 0 && (
                          <Space wrap size={6} style={{ marginTop: 6 }}>
                            <AntdImage.PreviewGroup>
                              {r.handled.images.map((src, i) => (
                                <AntdImage key={i} src={src} width={48} height={48}
                                  style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #d9f7be' }} />
                              ))}
                            </AntdImage.PreviewGroup>
                          </Space>
                        )}
                        <div style={{ color: '#8c8c8c', marginTop: 4 }}>{r.handled.by} · {r.handled.at}</div>
                      </div>
                    ) : (
                      <div style={{ color: '#fa8c16' }}>开发团队尚未处理，处理结果会同步显示在这里。</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default FeedbackPanel;
