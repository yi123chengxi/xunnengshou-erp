/**
 * 即时通讯消息持久化 — 统一数据访问层（双驱动：SQLite / MySQL）
 * 消息体存储在服务端数据库，避免 localStorage 配额溢出
 * 租户隔离：会话以参与双方为边界，分流池以池主（租户）为边界
 */
import { store } from '../database/store';
import crypto from 'crypto';

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
}

export interface Conversation {
  convId: string;
  otherUser: string;
  lastMessage: string;
  lastMessageType: string;
  lastTime: number;
  subject: string;
  unreadCount: number;
}

// ============ 工具函数 ============

/** 生成会话ID：两用户名排序后 hash 取前16位 */
export function makeConvId(userA: string, userB: string): string {
  const sorted = [userA, userB].sort();
  return crypto.createHash('sha256').update(sorted.join('_')).digest('hex').slice(0, 16);
}

/** 生成消息ID */
function genMsgId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ CRUD ============

/** 保存消息（id 可由客户端传入 cid 作幂等键：INSERT IGNORE 保证重试不重复） */
export async function saveMessage(params: {
  id?: string;
  from_user: string;
  to_user: string;
  content: string;
  msg_type?: string;
  conv_subject?: string;
  conv_from_user?: string; // 用于 conv_id 计算的用户名（子账号场景下使用父账号用户名）
}): Promise<ChatMessage> {
  const id = params.id || genMsgId();
  // 子账号场景：使用父账号用户名计算 conv_id，确保与采购商端一致
  const convUserA = params.conv_from_user || params.from_user;
  const conv_id = makeConvId(convUserA, params.to_user);
  const now = Date.now();
  await store.chatInsert({
    id,
    conv_id,
    from_user: params.from_user,
    to_user: params.to_user,
    content: params.content,
    msg_type: params.msg_type || 'text',
    conv_subject: params.conv_subject || '',
    created_at: now,
  });
  return {
    id,
    conv_id,
    from_user: params.from_user,
    to_user: params.to_user,
    content: params.content,
    msg_type: (params.msg_type as any) || 'text',
    conv_subject: params.conv_subject || '',
    created_at: now,
    read_at: 0,
  };
}

/** 获取历史消息（分页，返回时间正序） */
export async function getHistory(convId: string, before?: number, limit = 50): Promise<ChatMessage[]> {
  const ts = before || Date.now() + 1;
  const rows = await store.chatHistory(convId, ts, limit);
  return (rows as ChatMessage[]).reverse();
}

/** 获取用户总未读数 */
export async function getUnreadCount(username: string): Promise<number> {
  return store.chatUnreadCount(username);
}

/** 标记会话已读 */
export async function markConvRead(convId: string, username: string): Promise<void> {
  await store.chatMarkRead(Date.now(), convId, username);
}

/** 获取用户的会话列表 */
export async function getConversations(username: string): Promise<Conversation[]> {
  const rows = await store.chatConversations(username);
  const out: Conversation[] = [];
  for (const r of rows as any[]) {
    const unread = await store.chatConvUnread(r.conv_id, username);
    out.push({
      convId: r.conv_id,
      otherUser: r.other_user,
      lastMessage: r.last_message,
      lastMessageType: r.last_message_type,
      lastTime: r.last_time,
      subject: r.conv_subject || '',
      unreadCount: unread,
    });
  }
  return out;
}

// ============ 好友功能 ============

export interface Friend {
  friendUsername: string;
  remark: string;
  createdAt: number;
}

export async function addFriend(username: string, friendUsername: string): Promise<void> {
  await store.friendAdd(username, friendUsername, Date.now());
}

export async function removeFriend(username: string, friendUsername: string): Promise<void> {
  await store.friendRemove(username, friendUsername);
}

export async function getFriends(username: string): Promise<Friend[]> {
  const rows = await store.friendList(username);
  return (rows as any[]).map(r => ({
    friendUsername: r.friend_username,
    remark: r.remark || '',
    createdAt: Number(r.created_at) || 0,
  }));
}

export async function isFriend(username: string, friendUsername: string): Promise<boolean> {
  return store.friendIs(username, friendUsername);
}

// ============ 分流池功能 ============

/** 获取分流池成员 */
export async function getDispatchPool(owner: string): Promise<string[]> {
  const members = await store.poolGet(owner);
  if (!members) return [];
  try { return JSON.parse(members); } catch { return []; }
}

/** 设置分流池成员 */
export async function setDispatchPool(owner: string, members: string[]): Promise<void> {
  await store.poolSet(owner, JSON.stringify(members));
}

/** 查找用户属于哪个分流池（返回池主） */
export async function findPoolOwnerForUser(username: string): Promise<string | null> {
  const rows = await store.poolAll();
  for (const row of rows) {
    // 池主自己也视为池成员
    if (row.owner === username) return row.owner;
    try {
      const members: string[] = JSON.parse(row.members);
      if (members.includes(username)) return row.owner;
    } catch { /* skip */ }
  }
  return null;
}

// ============ 待分配消息 ============

export interface PendingMessage {
  id: string;
  pool_owner: string;
  from_user: string;
  content: string;
  msg_type: string;
  conv_subject: string;
  created_at: number;
}

/** 保存待分配消息 */
export async function savePendingMessage(params: {
  pool_owner: string;
  from_user: string;
  content: string;
  msg_type?: string;
  conv_subject?: string;
}): Promise<PendingMessage> {
  const id = `pend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  await store.pendingInsert({
    id,
    pool_owner: params.pool_owner,
    from_user: params.from_user,
    content: params.content,
    msg_type: params.msg_type || 'text',
    conv_subject: params.conv_subject || '',
    created_at: now,
  });
  return {
    id,
    pool_owner: params.pool_owner,
    from_user: params.from_user,
    content: params.content,
    msg_type: params.msg_type || 'text',
    conv_subject: params.conv_subject || '',
    created_at: now,
  };
}

/** 获取池的待分配消息 */
export async function getPendingMessages(poolOwner: string): Promise<PendingMessage[]> {
  return store.pendingList(poolOwner) as Promise<PendingMessage[]>;
}

/** 删除待分配记录 */
export async function deletePendingMessage(id: string): Promise<void> {
  await store.pendingDelete(id);
}

/** 获取所有分流池配置（用于主账号查看） */
export async function getAllDispatchPools(): Promise<{ owner: string; members: string[] }[]> {
  const rows = await store.poolAll();
  return rows.map(r => {
    try { return { owner: r.owner, members: JSON.parse(r.members) }; }
    catch { return { owner: r.owner, members: [] }; }
  });
}
