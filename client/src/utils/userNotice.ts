import { saveDataset } from './dataStore';
import { API_BASE } from './apiBase';

/**
 * 每用户站内通知（顶栏铃铛消息中心数据源）：
 * 逐条独立键 user_notice_<username>_<id>（前缀已加入 serverSync SYNC_PREFIXES 白名单，
 * 跨浏览器/设备自动同步；逐条键规避多端并发读改写整份列表的覆盖问题）。
 * 通知读取状态仅由该用户本人改写（markUserNoticeRead），开发者侧只追加新键。
 */
export interface UserNotice {
  id: string;
  username: string;
  type: 'info' | 'warning' | 'error';
  title: string;
  content: string;
  time: string;
  createdAt: number;
  read: boolean;
  feedbackKey?: string;
}

export const USER_NOTICE_PREFIX = 'user_notice_';

/** 同标签页实时刷新事件（storage 事件不触发于写入方自身标签页） */
export const USER_NOTICES_EVENT = 'user-notices-updated';

export const loadUserNotices = (username: string): UserNotice[] => {
  const list: UserNotice[] = [];
  const p = `${USER_NOTICE_PREFIX}${username}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(p) || k.endsWith('_ts')) continue; // 跳过 dataStore 伴生时间戳键
    try {
      const e = JSON.parse(localStorage.getItem(k) || '{}');
      if (e && e.title) list.push({ ...e, id: k } as UserNotice);
    } catch { /* 跳过坏键 */ }
  }
  list.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return list;
};

export const addUserNotice = (
  username: string,
  data: { title: string; content: string; type?: UserNotice['type']; feedbackKey?: string },
) => {
  if (!username) return;
  const key = `${USER_NOTICE_PREFIX}${username}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry: UserNotice = {
    id: key,
    username,
    type: data.type || 'info',
    title: data.title,
    content: data.content,
    time: new Date().toLocaleString('zh-CN'),
    createdAt: Date.now(),
    read: false,
    feedbackKey: data.feedbackKey,
  };
  try {
    localStorage.setItem(key, JSON.stringify(entry));
    saveDataset(key, JSON.stringify(entry));
  } catch { /* 配额满时静默，不阻塞主流程 */ }
  try { window.dispatchEvent(new Event(USER_NOTICES_EVENT)); } catch { /* ignore */ }
};

export const markUserNoticeRead = (id: string) => {
  try {
    const raw = localStorage.getItem(id);
    if (!raw) return;
    const e = JSON.parse(raw);
    if (e.read) return;
    e.read = true;
    localStorage.setItem(id, JSON.stringify(e));
    saveDataset(id, JSON.stringify(e));
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(USER_NOTICES_EVENT)); } catch { /* ignore */ }
};

export const markAllUserNoticesRead = (username: string) => {
  loadUserNotices(username).forEach(n => { if (!n.read) markUserNoticeRead(n.id); });
};

/** 清空该用户全部通知：本地连 _ts 伴生键一起删，并向服务端尽力 DELETE，避免孤儿键回灌 */
export const clearUserNotices = (username: string) => {
  const p = `${USER_NOTICE_PREFIX}${username}_`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(p)) keys.push(k);
  }
  keys.forEach(k => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
    if (!k.endsWith('_ts')) {
      let auth: Record<string, string> = {};
      try { const t = localStorage.getItem('token'); if (t) auth = { Authorization: `Bearer ${t}` }; } catch { /* ignore */ }
      fetch(`${API_BASE}/sync/dataset?key=${encodeURIComponent(k)}`, { method: 'DELETE', headers: auth }).catch(() => { /* ignore */ });
    }
  });
  try { window.dispatchEvent(new Event(USER_NOTICES_EVENT)); } catch { /* ignore */ }
};
