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

export default db;
