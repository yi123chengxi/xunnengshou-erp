import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, Typography } from 'antd';
import { CheckCircleFilled, ThunderboltFilled } from '@ant-design/icons';

/**
 * 首页底部公告模板（意见反馈右侧）：左侧横幅（默认促销样式或自定义图）+ 右侧标题/简介/要点行/操作链接；
 * 内容真值存全局同步键 dev_announcement（dev_ 前缀在 serverSync 白名单内自动跨浏览器同步），
 * 开发者后台「系统设置→公告管理」页自定义编辑；未启用时整块不渲染。
 */
export const ANNOUNCEMENT_KEY = 'dev_announcement';

export interface AnnLine {
  type: 'lead' | 'text' | 'check';
  text: string;
}

export interface AnnouncementData {
  enabled: boolean;
  banner: string;        // 左侧横幅图（dataURL/URL；留空使用默认促销样式）
  bannerLink: string;    // 横幅点击跳转地址（可空）
  title: string;
  intro: string;
  introLinkText: string; // 简介尾部蓝色链接文字（如"点击查看详情"，可空）
  introLinkUrl: string;
  lines: AnnLine[];      // 要点行：lead=加粗引导 / text=普通文本 / check=绿色勾选
  actionText: string;    // 底部操作链接文字（可空）
  actionUrl: string;
}

export const DEFAULT_ANNOUNCEMENT: AnnouncementData = {
  enabled: true,
  banner: '',
  bannerLink: '',
  title: '2026双十一-商家白皮书',
  intro: '2026双十一大促在即，为了助力商家实现作战有准备，风险有预案，系统有保障，努力有硕果，讯能手2026双十一专项服务已全面启动，让我们携手共创佳绩！',
  introLinkText: '点击查看详情',
  introLinkUrl: '',
  lines: [
    { type: 'lead', text: '广告有投产，不等于真赚钱！' },
    { type: 'text', text: '广告智能投产，大促提投产「抖音千川、淘宝/天猫万象台、上新拼多多」：' },
    { type: 'check', text: '识别真利润，及时止损亏钱计划' },
    { type: 'check', text: '综合库存与售后，避免越投越亏' },
    { type: 'check', text: '发现赚钱机会，快速加预算放量' },
    { type: 'check', text: '自动监控风险，告别人工盯盘' },
  ],
  actionText: '立即体验智能投产控制台',
  actionUrl: '',
};

export const loadAnnouncement = (): AnnouncementData => {
  try {
    const raw = localStorage.getItem(ANNOUNCEMENT_KEY);
    if (!raw) return DEFAULT_ANNOUNCEMENT;
    const d = JSON.parse(raw);
    return {
      ...DEFAULT_ANNOUNCEMENT, ...d,
      lines: Array.isArray(d.lines) ? d.lines.filter((l: any) => l && typeof l.text === 'string') : DEFAULT_ANNOUNCEMENT.lines,
    };
  } catch { return DEFAULT_ANNOUNCEMENT; }
};

const { Text } = Typography;

const openUrl = (url: string) => {
  if (url) window.open(url, '_blank', 'noopener');
};

/** 默认促销横幅（未上传自定义图时使用） */
const DefaultBanner: React.FC<{ onClick: () => void; clickable: boolean }> = ({ onClick, clickable }) => (
  <div onClick={onClick}
    style={{
      width: '100%', height: '100%', minHeight: 176, borderRadius: 8, cursor: clickable ? 'pointer' : 'default',
      background: 'linear-gradient(115deg, #ff9a3c 0%, #ff6a3d 40%, #ff3d5e 100%)',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '14px 22px', position: 'relative', overflow: 'hidden',
    }}>
    <div style={{ position: 'absolute', right: -26, top: -26, width: 110, height: 110, borderRadius: '50%', background: 'rgba(255,255,255,0.14)' }} />
    <div style={{ position: 'absolute', right: 30, bottom: -34, width: 90, height: 90, borderRadius: '50%', background: 'rgba(255,255,255,0.10)' }} />
    <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.25)', color: '#fff', fontWeight: 700, fontSize: 13, padding: '2px 12px', borderRadius: 12, letterSpacing: 3 }}>爆款专区</div>
    <div style={{ color: '#fff', fontWeight: 800, fontSize: 32, letterSpacing: 8, lineHeight: 1.15, textShadow: '0 2px 10px rgba(0,0,0,0.18)', marginTop: 4 }}>冲刺大促</div>
    <div style={{ color: '#fff', fontWeight: 600, fontSize: 14, marginTop: 2, letterSpacing: 1 }}>大促爆款 <span style={{ opacity: 0.92 }}>等你来卖</span></div>
    <Button shape="round" size="small" style={{ alignSelf: 'flex-start', marginTop: 10, background: '#fff', color: '#ff4d4f', fontWeight: 700, border: 'none', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
      立即去逛 →
    </Button>
  </div>
);

const AnnouncementPanel: React.FC<{ data?: AnnouncementData }> = ({ data }) => {
  const [tick, setTick] = useState(0);
  // 跨页签实时刷新：开发者后台保存后首页公告即时生效（storage 事件）
  useEffect(() => {
    if (data) return;
    const h = (e: StorageEvent) => { if (!e.key || e.key === ANNOUNCEMENT_KEY) setTick(t => t + 1); };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }, [data]);

  const ann = useMemo(() => (data ? data : (void tick, loadAnnouncement())), [data, tick]);
  if (!ann.enabled) return null;

  return (
    <Card size="small" style={{ borderRadius: 10, height: '100%' }} bodyStyle={{ padding: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', height: '100%' }}>
        {/* 左侧横幅 */}
        <div style={{ width: 300, maxWidth: '38%', flexShrink: 0, borderRadius: 8, overflow: 'hidden', display: 'flex' }}>
          {ann.banner
            ? <img src={ann.banner} alt="公告横幅" onClick={() => openUrl(ann.bannerLink)}
                style={{ width: '100%', height: '100%', minHeight: 176, objectFit: 'cover', cursor: ann.bannerLink ? 'pointer' : 'default', display: 'block' }} />
            : <DefaultBanner onClick={() => openUrl(ann.bannerLink)} clickable={!!ann.bannerLink} />}
        </div>
        {/* 右侧内容 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a2b45' }}>{ann.title}</div>
          <div style={{ fontSize: 12, color: '#5a6d85', lineHeight: 1.7, marginTop: 6 }}>
            {ann.intro}
            {ann.introLinkText && (
              <a style={{ marginLeft: 4, whiteSpace: 'nowrap' }}
                href={ann.introLinkUrl || undefined} target="_blank" rel="noreferrer"
                onClick={e => { if (!ann.introLinkUrl) e.preventDefault(); }}>{ann.introLinkText}</a>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            {ann.lines.map((l, i) => {
              if (l.type === 'lead') {
                return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#1a2b45', marginTop: 6 }}>📣 {l.text}</div>;
              }
              if (l.type === 'check') {
                return (
                  <div key={i} style={{ fontSize: 12, color: '#5a6d85', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircleFilled style={{ color: '#52c41a', fontSize: 13 }} />{l.text}
                  </div>
                );
              }
              return <div key={i} style={{ fontSize: 12, color: '#5a6d85', marginTop: 4 }}>{l.text}</div>;
            })}
          </div>
          {ann.actionText && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ThunderboltFilled style={{ color: '#1677ff', fontSize: 13 }} />
              <a href={ann.actionUrl || undefined} target="_blank" rel="noreferrer"
                onClick={e => { if (!ann.actionUrl) e.preventDefault(); }}>
                <Text strong style={{ color: '#1677ff', fontSize: 13 }}>{ann.actionText}</Text>
              </a>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default AnnouncementPanel;
