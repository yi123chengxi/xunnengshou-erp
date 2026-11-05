/**
 * SQLite 数据库初始化
 * 所有业务数据存储在 server/data/factory.db 文件中
 * 不同浏览器登录同一账号 → 读写同一个数据库文件 → 天然数据同步
 */
import Database, { Statement } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'factory.db');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db: InstanceType<typeof Database> = new Database(DB_PATH);

// 启用 WAL 模式（更好的并发读写性能）
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============ 建表 ============
db.exec(`
  -- 页面数据集存储（替代 localStorage + 文件同步）
  CREATE TABLE IF NOT EXISTS dataset_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_key TEXT NOT NULL UNIQUE,
    dataset_json TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dataset_owner ON dataset_store(owner);

  -- 租户存储用量计数器（增量维护，避免每次查询全表扫描）
  CREATE TABLE IF NOT EXISTS owner_usage (
    owner TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  -- 注册用户表
  CREATE TABLE IF NOT EXISTS registered_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    company_name TEXT DEFAULT '',
    contact_person TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    register_date TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    trial_end_date TEXT DEFAULT '',
    authorized_until TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 系统设置（键值对）
  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Web Push 订阅信息
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    user_agent TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_push_sub_username ON push_subscriptions(username);

  -- 企业认证（三要素核验结果，服务端权威；status: certified/abnormal/revoked）
  CREATE TABLE IF NOT EXISTS enterprise_cert (
    username TEXT PRIMARY KEY,
    company_name TEXT NOT NULL DEFAULT '',
    credit_code TEXT NOT NULL DEFAULT '',
    legal_person TEXT NOT NULL DEFAULT '',
    id_card TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'certified',
    fail_reason TEXT NOT NULL DEFAULT '',
    check_result TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT NOT NULL DEFAULT '',
    last_verify_at TEXT NOT NULL DEFAULT '',
    last_check_at TEXT NOT NULL DEFAULT '',
    face_certify_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 即时通讯消息（原 chat-store 建表迁入，统一由连接模块管理）
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

// 兼容旧库：企业认证表增量列（法人身份证号 / 最近刷脸 CertifyId）
try { db.exec("ALTER TABLE enterprise_cert ADD COLUMN id_card TEXT NOT NULL DEFAULT ''"); } catch { /* 已存在 */ }
try { db.exec("ALTER TABLE enterprise_cert ADD COLUMN face_certify_id TEXT NOT NULL DEFAULT ''"); } catch { /* 已存在 */ }

// ============ 预编译语句 ============

// dataset_store
export const stmtGetDataset: Statement = db.prepare('SELECT dataset_key, dataset_json, updated_at FROM dataset_store WHERE dataset_key = ?');
export const stmtGetAllMeta: Statement = db.prepare('SELECT dataset_key, updated_at FROM dataset_store');
export const stmtUpsertDataset: Statement = db.prepare(`
  INSERT INTO dataset_store (dataset_key, dataset_json, owner, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(dataset_key) DO UPDATE SET
    dataset_json = excluded.dataset_json,
    owner = excluded.owner,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at > dataset_store.updated_at
`);
export const stmtForceUpsertDataset: Statement = db.prepare(`
  INSERT INTO dataset_store (dataset_key, dataset_json, owner, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(dataset_key) DO UPDATE SET
    dataset_json = excluded.dataset_json,
    owner = excluded.owner,
    updated_at = excluded.updated_at
`);
export const stmtDeleteDataset: Statement = db.prepare('DELETE FROM dataset_store WHERE dataset_key = ?');
export const stmtAllKeySizes: Statement = db.prepare('SELECT dataset_key, LENGTH(dataset_json) AS bytes FROM dataset_store');

// owner_usage（增量用量计数器）
export const stmtGetUsageBytes: Statement = db.prepare('SELECT bytes FROM owner_usage WHERE owner = ?');
export const stmtAddUsageDelta: Statement = db.prepare(`
  INSERT INTO owner_usage (owner, bytes, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(owner) DO UPDATE SET bytes = MAX(0, bytes + excluded.bytes), updated_at = excluded.updated_at
`);
export const stmtSetUsageBytes: Statement = db.prepare(`
  INSERT INTO owner_usage (owner, bytes, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(owner) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at
`);
export const stmtAllUsage: Statement = db.prepare('SELECT owner, bytes FROM owner_usage');
export const stmtUsageCount: Statement = db.prepare('SELECT COUNT(*) AS c FROM owner_usage');

// registered_users
export const stmtGetUser: Statement = db.prepare('SELECT * FROM registered_users WHERE username = ?');
export const stmtGetAllUsers: Statement = db.prepare('SELECT * FROM registered_users');
export const stmtInsertUser: Statement = db.prepare(`
  INSERT OR IGNORE INTO registered_users (username, password, role, company_name, contact_person, phone, email, register_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
export const stmtUpdateUser: Statement = db.prepare(`
  UPDATE registered_users SET
    password = COALESCE(?, password),
    role = COALESCE(?, role),
    company_name = COALESCE(?, company_name),
    contact_person = COALESCE(?, contact_person),
    phone = COALESCE(?, phone),
    email = COALESCE(?, email),
    status = COALESCE(?, status),
    updated_at = datetime('now')
  WHERE username = ?
`);
export const stmtDeleteUser: Statement = db.prepare('DELETE FROM registered_users WHERE username = ?');

// system_settings
export const stmtGetSetting: Statement = db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?');
export const stmtSetSetting: Statement = db.prepare(`
  INSERT INTO system_settings (setting_key, setting_value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')
`);

// push_subscriptions
export const stmtUpsertPushSub: Statement = db.prepare(`
  INSERT INTO push_subscriptions (username, endpoint, keys_p256dh, keys_auth, user_agent, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(endpoint) DO UPDATE SET
    username = excluded.username,
    keys_p256dh = excluded.keys_p256dh,
    keys_auth = excluded.keys_auth,
    user_agent = excluded.user_agent,
    updated_at = datetime('now')
`);
export const stmtGetSubsByUsername: Statement = db.prepare('SELECT * FROM push_subscriptions WHERE username = ?');
export const stmtDeletePushSub: Statement = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
export const stmtDeletePushSubByUsername: Statement = db.prepare('DELETE FROM push_subscriptions WHERE username = ?');

// enterprise_cert（企业认证）
export const stmtGetCert: Statement = db.prepare('SELECT * FROM enterprise_cert WHERE username = ?');
export const stmtUpsertCert: Statement = db.prepare(`
  INSERT INTO enterprise_cert (username, company_name, credit_code, legal_person, id_card, status, fail_reason, check_result, attempts, verified_at, last_verify_at, last_check_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(username) DO UPDATE SET
    company_name = excluded.company_name,
    credit_code = excluded.credit_code,
    legal_person = excluded.legal_person,
    id_card = excluded.id_card,
    status = excluded.status,
    fail_reason = excluded.fail_reason,
    check_result = excluded.check_result,
    attempts = excluded.attempts,
    verified_at = excluded.verified_at,
    last_verify_at = excluded.last_verify_at,
    last_check_at = excluded.last_check_at,
    updated_at = datetime('now')
`);
export const stmtUpdateCertStatus: Statement = db.prepare(`
  UPDATE enterprise_cert SET status = ?, fail_reason = ?, check_result = ?, last_check_at = ?, updated_at = datetime('now') WHERE username = ?
`);
export const stmtCertsDueCheck: Statement = db.prepare(`
  SELECT * FROM enterprise_cert WHERE status = 'certified' AND (last_check_at = '' OR last_check_at <= ?) ORDER BY last_check_at ASC LIMIT ?
`);
export const stmtAllCerts: Statement = db.prepare('SELECT * FROM enterprise_cert');

// 刷脸认证结果落库：通过 → certified + 刷脸时间；未通过 → 保持 pending + 失败原因
export const stmtCertFacePass: Statement = db.prepare(`
  UPDATE enterprise_cert SET status = 'certified', fail_reason = '', check_result = 'face_ok', face_certify_id = ?,
    verified_at = datetime('now'), last_check_at = datetime('now'), updated_at = datetime('now') WHERE username = ?
`);
export const stmtCertFaceFail: Statement = db.prepare(`
  UPDATE enterprise_cert SET fail_reason = ?, face_certify_id = ?, updated_at = datetime('now') WHERE username = ?
`);

// ============ 即时通讯（chat_messages / chat_friends / chat_dispatch_pool / chat_pending_messages） ============
export const stmtChatInsert: Statement = db.prepare(`
  INSERT OR IGNORE INTO chat_messages (id, conv_id, from_user, to_user, content, msg_type, conv_subject, created_at, read_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
export const stmtChatHistory: Statement = db.prepare(`
  SELECT * FROM chat_messages WHERE conv_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?
`);
export const stmtChatUnreadCount: Statement = db.prepare(`
  SELECT COUNT(*) as cnt FROM chat_messages WHERE to_user = ? AND read_at = 0
`);
export const stmtChatMarkRead: Statement = db.prepare(`
  UPDATE chat_messages SET read_at = ? WHERE conv_id = ? AND to_user = ? AND read_at = 0
`);
export const stmtChatConversations: Statement = db.prepare(`
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
export const stmtChatConvUnread: Statement = db.prepare(`
  SELECT COUNT(*) as cnt FROM chat_messages WHERE conv_id = ? AND to_user = ? AND read_at = 0
`);
export const stmtFriendAdd: Statement = db.prepare(`
  INSERT OR IGNORE INTO chat_friends (username, friend_username, created_at) VALUES (?, ?, ?)
`);
export const stmtFriendRemove: Statement = db.prepare(`DELETE FROM chat_friends WHERE username = ? AND friend_username = ?`);
export const stmtFriendList: Statement = db.prepare(`
  SELECT friend_username, remark, created_at FROM chat_friends WHERE username = ? ORDER BY created_at DESC
`);
export const stmtFriendIs: Statement = db.prepare(`SELECT 1 FROM chat_friends WHERE username = ? AND friend_username = ?`);
export const stmtPoolGet: Statement = db.prepare(`SELECT members FROM chat_dispatch_pool WHERE owner = ?`);
export const stmtPoolSet: Statement = db.prepare(`
  INSERT INTO chat_dispatch_pool (owner, members) VALUES (?, ?)
  ON CONFLICT(owner) DO UPDATE SET members = excluded.members
`);
export const stmtPoolAll: Statement = db.prepare(`SELECT owner, members FROM chat_dispatch_pool`);
export const stmtPendingInsert: Statement = db.prepare(`
  INSERT INTO chat_pending_messages (id, pool_owner, from_user, content, msg_type, conv_subject, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
export const stmtPendingList: Statement = db.prepare(`
  SELECT * FROM chat_pending_messages WHERE pool_owner = ? ORDER BY created_at ASC
`);
export const stmtPendingDelete: Statement = db.prepare(`DELETE FROM chat_pending_messages WHERE id = ?`);

export default db;
