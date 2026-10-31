/**
 * 即时通讯 WebSocket 客户端封装
 * 单例模式，App 层登录后初始化
 */

// ============ 类型定义 ============

export interface ChatMessage {
  id: string;
  conv_id: string;
  from_user: string;
  to_user: string;
  content: string;
  msg_type: 'text' | 'image' | 'system';
  conv_subject: string;
  created_at: number;
  read_at: number;
  send_failed?: boolean; // 本地标记：违规被屏蔽/发送失败（气泡旁显示感叹号）
  fail_reason?: string;
}

export interface Conversation {
  convId: string;
  otherUser: string;
  lastMessage: string;
  lastMessageType: string;
  lastTime: number;
  subject: string;
  unreadCount: number;
  otherOnline: boolean;
}

type MessageHandler = (msg: ChatMessage) => void;
type TypingHandler = (from: string) => void;
type PresenceHandler = (username: string, online: boolean) => void;
type SentHandler = (id: string, convId: string, ts: number) => void;
type BlockedHandler = (cid: string, reason: string) => void;

// ============ 单例状态 ============

let ws: WebSocket | null = null;
let reconnectTimer: any = null;
let reconnectDelay = 1000;
let heartbeatTimer: any = null;
let connected = false;
let authenticated = false; // 服务端 auth_ok 后才允许发送（未认证时服务端会静默丢弃）
let lastServerAt = 0; // 最近一次收到服务端消息的时间（存活检测用）
let currentUsername = '';

// 事件监听器
const messageHandlers = new Set<MessageHandler>();
const typingHandlers = new Set<TypingHandler>();
const presenceHandlers = new Set<PresenceHandler>();
const sentHandlers = new Set<SentHandler>();
const markReadHandlers = new Set<() => void>();
const blockedHandlers = new Set<BlockedHandler>();

// ============ 本地发件箱（localStorage 持久化，刷新/重登不丢） ============

// 临时身份（公开页访客聊天）：未登录注册账号时以该身份连接/收发消息
let guestIdentity = (() => { try { return localStorage.getItem('guest_chat_username') || ''; } catch { return ''; } })();
/** 设置临时身份（公开页联系按键：未注册账号时生成） */
export function setGuestIdentity(u: string): void {
  guestIdentity = u;
  try { localStorage.setItem('guest_chat_username', u); } catch { /* ignore */ }
}
/** 当前聊天身份：注册账号优先，其次临时身份 */
export function resolveChatUsername(): string {
  return localStorage.getItem('username') || guestIdentity;
}

interface OutboxItem { cid: string; to: string; content: string; msg_type?: string; subject?: string; dispatch?: boolean; }
const outboxKey = () => `chat_outbox_${resolveChatUsername()}`;
const genCid = () => `cid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// 发送 ack 超时重试表：cid → { 消息体, 定时器 }
const pendingAcks = new Map<string, { item: OutboxItem; timer: any }>();

function loadOutbox(): OutboxItem[] {
  try { const v = JSON.parse(localStorage.getItem(outboxKey()) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveOutbox(list: OutboxItem[]): void {
  try { localStorage.setItem(outboxKey(), JSON.stringify(list)); } catch { /* ignore */ }
}
function pushOutbox(item: OutboxItem): void {
  const list = loadOutbox();
  if (!list.some(x => x.cid === item.cid)) { list.push(item); saveOutbox(list); }
}
function removeOutbox(cid: string): void {
  saveOutbox(loadOutbox().filter(x => x.cid !== cid));
}

// ============ 获取 JWT Token ============

import { API_BASE as API_BASE_URL, API_ORIGIN } from './apiBase';

function getWSUrl(): string {
  return `${API_ORIGIN.replace(/^http/, 'ws')}/ws/chat`;
}

// ============ 连接管理 ============

/** 建立 WebSocket 连接（登录后调用） */
export function connectChatWS(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  currentUsername = resolveChatUsername();
  if (!currentUsername) return;

  try {
    ws = new WebSocket(getWSUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    authenticated = false;
    lastServerAt = Date.now();
    reconnectDelay = 1000;
    // 认证：发送用户名（与项目其他接口一致）
    // 子账号额外传入 parent_username，服务端用于 conv_id 归一化
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    const parentUsername = isSub ? (localStorage.getItem('parentAccount') || '') : '';
    ws!.send(JSON.stringify({ type: 'auth', username: currentUsername, parent_username: parentUsername }));
    // 心跳 + 存活检测：服务端每 30s 发 ping，超过 75s 未收到任何服务端消息判定半死连接，主动关闭触发重连
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && connected && lastServerAt && Date.now() - lastServerAt > 75_000) {
        connected = false;
        authenticated = false;
        try { ws.close(); } catch { /* ignore */ }
      }
    }, 25_000);
  };

  ws.onmessage = (event) => {
    lastServerAt = Date.now();
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    connected = false;
    ws = null;
    clearInterval(heartbeatTimer);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

/** 断开 WebSocket 连接（退出登录调用） */
export function disconnectChatWS(): void {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearInterval(heartbeatTimer);
  pendingAcks.forEach(a => clearTimeout(a.timer));
  pendingAcks.clear();
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  connected = false;
  authenticated = false;
  currentUsername = '';
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectChatWS();
  }, reconnectDelay);
}

// ============ 消息处理 ============

function handleMessage(data: any): void {
  switch (data.type) {
    case 'auth_ok':
      currentUsername = data.username;
      authenticated = true;
      lastServerAt = Date.now();
      // 重连/登录后冲刷持久化发件箱（含断线期间与 ack 失败的消息）
      flushOutbox();
      break;
    case 'new_message':
      messageHandlers.forEach(h => h({
        id: data.id,
        conv_id: data.convId,
        from_user: data.from,
        to_user: data.to,
        content: data.content,
        msg_type: data.msg_type || 'text',
        conv_subject: data.subject || '',
        created_at: data.ts,
        read_at: 0,
      }));
      break;
    case 'message_sent': {
      // 服务端确认：清除对应 cid 的 ack 超时重试与发件箱记录
      const cid = String(data.cid || data.id || '');
      const ack = pendingAcks.get(cid);
      if (ack) { clearTimeout(ack.timer); pendingAcks.delete(cid); }
      if (cid.startsWith('cid-')) removeOutbox(cid);
      sentHandlers.forEach(h => h(data.id, data.convId, data.ts));
      break;
    }
    case 'message_blocked': {
      // 服务端内容审核屏蔽：不落库不转发；清除重试并通知 UI 标记发送失败
      const cid = String(data.cid || '');
      const ack = pendingAcks.get(cid);
      if (ack) { clearTimeout(ack.timer); pendingAcks.delete(cid); }
      if (cid) removeOutbox(cid);
      blockedHandlers.forEach(h => h(cid, String(data.reason || '消息含违规内容，发送失败')));
      break;
    }
    case 'typing':
      typingHandlers.forEach(h => h(data.from));
      break;
    case 'presence':
      presenceHandlers.forEach(h => h(data.username, data.online));
      break;
    case 'history':
      // 历史消息由 getHistory API 处理
      break;
    case 'ping':
      // 服务端心跳，无需响应
      break;
  }
}

// ============ 发送消息 ============

/** WS 发送（带 cid 与 6s ack 超时重试：超时入持久化发件箱并走 HTTP 兜底） */
function doSend(item: OutboxItem): void {
  if (!(ws && ws.readyState === WebSocket.OPEN && connected && authenticated)) return;
  ws.send(JSON.stringify({ type: 'send_message', to: item.to, content: item.content, msg_type: item.msg_type || 'text', subject: item.subject, cid: item.cid, dispatch: item.dispatch || undefined }));
  const timer = setTimeout(() => {
    pendingAcks.delete(item.cid);
    pushOutbox(item);
    void httpSendItem(item);
  }, 6_000);
  pendingAcks.set(item.cid, { item, timer });
}

/** HTTP 兜底发送：WS 不可用/ack 超时时保证消息落库（服务端按 cid 去重，重试不会重复）；403=违规屏蔽 */
async function httpSendItem(item: OutboxItem): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/messages`, {
      method: 'POST',
      body: JSON.stringify({ to: item.to, content: item.content, msg_type: item.msg_type || 'text', subject: item.subject, cid: item.cid, dispatch: item.dispatch || undefined }),
    });
    if (res.status === 403) {
      // 内容审核屏蔽：不重试，标记失败
      let reason = '消息含违规内容，发送失败';
      try { const body = await res.json(); if (body?.reason) reason = String(body.reason); } catch { /* ignore */ }
      removeOutbox(item.cid);
      const ack = pendingAcks.get(item.cid);
      if (ack) { clearTimeout(ack.timer); pendingAcks.delete(item.cid); }
      blockedHandlers.forEach(h => h(item.cid, reason));
      return true;
    }
    if (res.ok) {
      removeOutbox(item.cid);
      const ack = pendingAcks.get(item.cid);
      if (ack) { clearTimeout(ack.timer); pendingAcks.delete(item.cid); }
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** 冲刷持久化发件箱（auth_ok 后调用） */
function flushOutbox(): void {
  const list = loadOutbox();
  if (list.length === 0) return;
  saveOutbox([]);
  list.forEach(item => doSend(item));
}

/** 发送消息（断线时入持久化发件箱 + HTTP 兜底；dispatch=市场联系按键发起的分流消息）；返回 cid 供 UI 关联发送失败标记 */
export function sendMessage(to: string, content: string, subject?: string, dispatch?: boolean): string {
  const item: OutboxItem = { cid: genCid(), to, content, msg_type: 'text', subject, dispatch };
  dispatchItem(item);
  return item.cid;
}

/** 发送图片消息 */
export function sendImageMessage(to: string, dataUrl: string, subject?: string, dispatch?: boolean): string {
  const item: OutboxItem = { cid: genCid(), to, content: dataUrl, msg_type: 'image', subject, dispatch };
  dispatchItem(item);
  return item.cid;
}

function dispatchItem(item: OutboxItem): void {
  if (ws && ws.readyState === WebSocket.OPEN && connected && authenticated) {
    doSend(item);
  } else {
    // 连接不可用：先入持久化发件箱（刷新/重登不丢），同时尝试 HTTP 兜底通道立即落库
    pushOutbox(item);
    void httpSendItem(item);
  }
}

/** 标记会话已读 */
export function markRead(convId: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'mark_read', convId }));
  }
  // 通知已读事件监听器
  markReadHandlers.forEach(h => h());
}

/** 发送输入中提示 */
export function sendTyping(to: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'typing', to }));
  }
}

// ============ 事件订阅 ============

export function onNewMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function onTyping(handler: TypingHandler): () => void {
  typingHandlers.add(handler);
  return () => typingHandlers.delete(handler);
}

export function onPresence(handler: PresenceHandler): () => void {
  presenceHandlers.add(handler);
  return () => presenceHandlers.delete(handler);
}

export function onMessageSent(handler: SentHandler): () => void {
  sentHandlers.add(handler);
  return () => sentHandlers.delete(handler);
}

export function onMarkRead(handler: () => void): () => void {
  markReadHandlers.add(handler);
  return () => markReadHandlers.delete(handler);
}

export function onMessageBlocked(handler: BlockedHandler): () => void {
  blockedHandlers.add(handler);
  return () => blockedHandlers.delete(handler);
}

// ============ 状态查询 ============

export function isChatConnected(): boolean {
  return connected;
}

export function getChatUsername(): string {
  return currentUsername;
}

// ============ REST API 降级 ============

const API_BASE = () => API_BASE_URL;

async function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const username = resolveChatUsername();
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Username': username,
      ...(opts?.headers || {}),
    },
  });
}

/** HTTP: 获取会话列表（子账号合并主账号会话；主账号加载分流池成员会话） */
export async function fetchConversations(): Promise<Conversation[]> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/conversations`);
    if (!res.ok) return [];
    const mine: Conversation[] = await res.json();
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) {
      // 子账号：同时加载主账号的会话并合并去重
      const parent = localStorage.getItem('parentAccount') || '';
      if (parent) {
        try {
          const res2 = await fetch(`${API_BASE()}/chat/conversations`, {
            headers: { 'Content-Type': 'application/json', 'X-Username': parent },
          });
          if (res2.ok) {
            const parentConvs: Conversation[] = await res2.json();
            const existingUsers = new Map(mine.map(c => [c.otherUser, c]));
            for (const c of parentConvs) {
              const existing = existingUsers.get(c.otherUser);
              if (!existing || c.lastTime > existing.lastTime) {
                existingUsers.set(c.otherUser, c);
              }
            }
            mine.length = 0;
            existingUsers.forEach(v => mine.push(v));
          }
        } catch { /* ignore */ }
      }
    } else {
      // 主账号：加载分流池成员的会话
      try {
        const poolRes = await authFetch(`${API_BASE()}/chat/dispatch-pool`);
        if (poolRes.ok) {
          const poolData = await poolRes.json();
          const members: string[] = poolData.members || [];
          for (const member of members) {
            try {
              const res3 = await fetch(`${API_BASE()}/chat/conversations`, {
                headers: { 'Content-Type': 'application/json', 'X-Username': member },
              });
              if (res3.ok) {
                const memberConvs: Conversation[] = await res3.ok ? await res3.json() : [];
                const existingUsers = new Map(mine.map(c => [c.otherUser, c]));
                for (const c of memberConvs) {
                  const existing = existingUsers.get(c.otherUser);
                  if (!existing || c.lastTime > existing.lastTime) {
                    existingUsers.set(c.otherUser, c);
                  }
                }
                mine.length = 0;
                existingUsers.forEach(v => mine.push(v));
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    mine.sort((a, b) => b.lastTime - a.lastTime);
    return mine;
  } catch {
    return [];
  }
}

/** HTTP: 获取历史消息 */
export async function fetchHistory(convId: string, before?: number, limit = 50): Promise<ChatMessage[]> {
  try {
    const params = new URLSearchParams();
    if (before) params.set('before', String(before));
    params.set('limit', String(limit));
    const res = await authFetch(`${API_BASE()}/chat/messages/${convId}?${params}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** HTTP: 获取未读数（子账号同时统计主账号未读） */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/unread-count`);
    if (!res.ok) return 0;
    const data = await res.json();
    let count = data.count || 0;
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) {
      // 子账号同时加载主账号未读数
      const parent = localStorage.getItem('parentAccount') || '';
      if (parent) {
        try {
          const res2 = await fetch(`${API_BASE()}/chat/unread-count`, {
            headers: { 'Content-Type': 'application/json', 'X-Username': parent },
          });
          if (res2.ok) {
            const data2 = await res2.json();
            count += data2.count || 0;
          }
        } catch { /* ignore */ }
      }
    } else {
      // 主账号加载分流池成员的未读数
      try {
        const poolRes = await authFetch(`${API_BASE()}/chat/dispatch-pool`);
        if (poolRes.ok) {
          const poolData = await poolRes.json();
          const members: string[] = poolData.members || [];
          for (const member of members) {
            try {
              const res3 = await fetch(`${API_BASE()}/chat/unread-count`, {
                headers: { 'Content-Type': 'application/json', 'X-Username': member },
              });
              if (res3.ok) {
                const data3 = await res3.json();
                count += data3.count || 0;
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    return count;
  } catch {
    return 0;
  }
}

/** HTTP: 标记已读 */
export async function httpMarkRead(convId: string): Promise<void> {
  try {
    await authFetch(`${API_BASE()}/chat/messages/${convId}/read`, { method: 'PUT' });
    // 通知已读事件监听器
    markReadHandlers.forEach(h => h());
  } catch { /* ignore */ }
}

// ============ 事件总线（供外部触发打开会话） ============

type OpenChatHandler = (username: string, subject?: string) => void;
let openChatCallback: OpenChatHandler | null = null;
let pendingOpenChat: { username: string; subject?: string } | null = null;

export function registerOpenChat(handler: OpenChatHandler): () => void {
  openChatCallback = handler;
  // 消费缓冲的待打开请求
  if (pendingOpenChat) {
    const p = pendingOpenChat;
    pendingOpenChat = null;
    setTimeout(() => handler(p.username, p.subject), 100);
  }
  return () => { openChatCallback = null; };
}

export function triggerOpenChat(username: string, subject?: string): void {
  if (openChatCallback) {
    openChatCallback(username, subject);
  } else {
    // ChatPage 尚未挂载，缓冲请求
    pendingOpenChat = { username, subject };
  }
}

// ============ 好友 API ============

export interface FriendItem {
  friendUsername: string;
  remark: string;
  createdAt: number;
  online: boolean;
}

export async function fetchFriends(): Promise<FriendItem[]> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/friends`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function addFriend(friendUsername: string): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/friends`, {
      method: 'POST',
      body: JSON.stringify({ friendUsername }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeFriend(friendUsername: string): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/friends/${friendUsername}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkIsFriend(friendUsername: string): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/is-friend/${friendUsername}`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.isFriend || false;
  } catch {
    return false;
  }
}

// ============ 分流池功能 ============

export async function fetchDispatchPool(): Promise<{ owner: string; members: string[] }> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/dispatch-pool`);
    if (!res.ok) return { owner: '', members: [] };
    return await res.json();
  } catch {
    return { owner: '', members: [] };
  }
}

export async function setDispatchPoolMembers(members: string[]): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE()}/chat/dispatch-pool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 主账号代子账号发送消息 */
export function sendMessageAs(to: string, content: string, asUser: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'send_as',
    to,
    content,
    msg_type: 'text',
    asUser,
  }));
}
