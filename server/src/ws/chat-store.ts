/**
 * 即时通讯消息持久化 — SQLite 存储
 * 消息体存储在服务端数据库，避免 localStorage 配额溢出
 */
import db from '../database/sqlite';
import crypto from 'crypto';

// ============ 建表 ============
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conv_id TEXT NOT NULL,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    conv_subject TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    read_at INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conv_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_unread ON chat_messages(to_user, read_at);

  CREATE TABLE IF NOT EXISTS chat_friends (
    username TEXT NOT NULL,
    friend_username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    remark TEXT DEFAULT '',
    PRIMARY KEY (username, friend_username)
  );

  CREATE TABLE IF NOT EXISTS chat_dispatch_pool (
    owner TEXT PRIMARY KEY,
    members TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS chat_pending_messages (
    id TEXT PRIMARY KEY,
    pool_owner TEXT NOT NULL,
    from_user TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    conv_subject TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pending_pool ON chat_pending_messages(pool_owner);
`);

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

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO chat_messages (id, conv_id, from_user, to_user, content, msg_type, conv_subject, created_at, read_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`);

const stmtGetHistory = db.prepare(`
  SELECT * FROM chat_messages
  WHERE conv_id = ? AND created_at < ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const stmtGetUnreadCount = db.prepare(`
  SELECT COUNT(*) as cnt FROM chat_messages
  WHERE to_user = ? AND read_at = 0
`);

const stmtMarkRead = db.prepare(`
  UPDATE chat_messages SET read_at = ?
  WHERE conv_id = ? AND to_user = ? AND read_at = 0
`);

const stmtGetConversations = db.prepare(`
  SELECT
    m.conv_id,
    CASE WHEN m.from_user = ? THEN m.to_user ELSE m.from_user END as other_user,
    m.content as last_message,
    m.msg_type as last_message_type,
    m.conv_subject,
    m.created_at as last_time
  FROM chat_messages m
  INNER JOIN (
    SELECT conv_id, MAX(created_at) as max_ts
    FROM chat_messages
    WHERE from_user = ? OR to_user = ?
    GROUP BY conv_id
  ) latest ON m.conv_id = latest.conv_id AND m.created_at = latest.max_ts
  WHERE m.from_user = ? OR m.to_user = ?
  GROUP BY m.conv_id
  ORDER BY m.created_at DESC
`);

const stmtGetConvUnread = db.prepare(`
  SELECT COUNT(*) as cnt FROM chat_messages
  WHERE conv_id = ? AND to_user = ? AND read_at = 0
`);

/** 保存消息（id 可由客户端传入 cid 作幂等键：INSERT OR IGNORE 保证重试不重复） */
export function saveMessage(params: {
  id?: string;
  from_user: string;
  to_user: string;
  content: string;
  msg_type?: string;
  conv_subject?: string;
  conv_from_user?: string; // 用于 conv_id 计算的用户名（子账号场景下使用父账号用户名）
}): ChatMessage {
  const id = params.id || genMsgId();
  // 子账号场景：使用父账号用户名计算 conv_id，确保与采购商端一致
  const convUserA = params.conv_from_user || params.from_user;
  const conv_id = makeConvId(convUserA, params.to_user);
  const now = Date.now();
  stmtInsert.run(
    id,
    conv_id,
    params.from_user,
    params.to_user,
    params.content,
    params.msg_type || 'text',
    params.conv_subject || '',
    now
  );
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
export function getHistory(convId: string, before?: number, limit = 50): ChatMessage[] {
  const ts = before || Date.now() + 1;
  const rows = stmtGetHistory.all(convId, ts, limit) as ChatMessage[];
  return rows.reverse();
}

/** 获取用户总未读数 */
export function getUnreadCount(username: string): number {
  const row = stmtGetUnreadCount.get(username) as { cnt: number };
  return row?.cnt || 0;
}

/** 标记会话已读 */
export function markConvRead(convId: string, username: string): void {
  stmtMarkRead.run(Date.now(), convId, username);
}

/** 获取用户的会话列表 */
export function getConversations(username: string): Conversation[] {
  const rows = stmtGetConversations.all(username, username, username, username, username) as any[];
  return rows.map(r => {
    const unread = (stmtGetConvUnread.get(r.conv_id, username) as { cnt: number })?.cnt || 0;
    return {
      convId: r.conv_id,
      otherUser: r.other_user,
      lastMessage: r.last_message,
      lastMessageType: r.last_message_type,
      lastTime: r.last_time,
      subject: r.conv_subject || '',
      unreadCount: unread,
    };
  });
}

// ============ 好友功能 ============

const stmtAddFriend = db.prepare(`
  INSERT OR IGNORE INTO chat_friends (username, friend_username, created_at)
  VALUES (?, ?, ?)
`);

const stmtRemoveFriend = db.prepare(`
  DELETE FROM chat_friends WHERE username = ? AND friend_username = ?
`);

const stmtGetFriends = db.prepare(`
  SELECT friend_username, remark, created_at
  FROM chat_friends
  WHERE username = ?
  ORDER BY created_at DESC
`);

const stmtIsFriend = db.prepare(`
  SELECT 1 FROM chat_friends WHERE username = ? AND friend_username = ?
`);

export interface Friend {
  friendUsername: string;
  remark: string;
  createdAt: number;
}

export function addFriend(username: string, friendUsername: string): void {
  stmtAddFriend.run(username, friendUsername, Date.now());
}

export function removeFriend(username: string, friendUsername: string): void {
  stmtRemoveFriend.run(username, friendUsername);
}

export function getFriends(username: string): Friend[] {
  const rows = stmtGetFriends.all(username) as any[];
  return rows.map(r => ({
    friendUsername: r.friend_username,
    remark: r.remark || '',
    createdAt: r.created_at,
  }));
}

export function isFriend(username: string, friendUsername: string): boolean {
  return !!stmtIsFriend.get(username, friendUsername);
}

// ============ 分流池功能 ============

const stmtGetPool = db.prepare(`SELECT members FROM chat_dispatch_pool WHERE owner = ?`);
const stmtSetPool = db.prepare(`
  INSERT INTO chat_dispatch_pool (owner, members)
  VALUES (?, ?)
  ON CONFLICT(owner) DO UPDATE SET members = excluded.members
`);
const stmtGetAllPools = db.prepare(`SELECT owner, members FROM chat_dispatch_pool`);

/** 获取分流池成员 */
export function getDispatchPool(owner: string): string[] {
  const row = stmtGetPool.get(owner) as { members: string } | undefined;
  if (!row) return [];
  try { return JSON.parse(row.members); } catch { return []; }
}

/** 设置分流池成员 */
export function setDispatchPool(owner: string, members: string[]): void {
  stmtSetPool.run(owner, JSON.stringify(members));
}

/** 查找用户属于哪个分流池（返回池主） */
export function findPoolOwnerForUser(username: string): string | null {
  const rows = stmtGetAllPools.all() as { owner: string; members: string }[];
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

const stmtInsertPending = db.prepare(`
  INSERT INTO chat_pending_messages (id, pool_owner, from_user, content, msg_type, conv_subject, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetPending = db.prepare(`
  SELECT * FROM chat_pending_messages
  WHERE pool_owner = ?
  ORDER BY created_at ASC
`);

const stmtDeletePending = db.prepare(`DELETE FROM chat_pending_messages WHERE id = ?`);

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
export function savePendingMessage(params: {
  pool_owner: string;
  from_user: string;
  content: string;
  msg_type?: string;
  conv_subject?: string;
}): PendingMessage {
  const id = `pend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  stmtInsertPending.run(id, params.pool_owner, params.from_user, params.content, params.msg_type || 'text', params.conv_subject || '', now);
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
export function getPendingMessages(poolOwner: string): PendingMessage[] {
  return stmtGetPending.all(poolOwner) as PendingMessage[];
}

/** 删除待分配消息 */
export function deletePendingMessage(id: string): void {
  stmtDeletePending.run(id);
}

/** 获取所有分流池配置（用于主账号查看） */
export function getAllDispatchPools(): { owner: string; members: string[] }[] {
  const rows = stmtGetAllPools.all() as { owner: string; members: string }[];
  return rows.map(r => {
    try { return { owner: r.owner, members: JSON.parse(r.members) }; }
    catch { return { owner: r.owner, members: [] }; }
  });
}
