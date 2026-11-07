/**
 * MySQL 驱动（独立数据库服务器 172.30.52.13/xinnengshu）
 * 方言映射：INSERT OR IGNORE→INSERT IGNORE；ON CONFLICT DO UPDATE→ON DUPLICATE KEY UPDATE；
 * datetime('now')→NOW()；LENGTH() 两者均为字节长度。租户隔离语义与 SQLite 驱动逐条对齐。
 */
import pool from './init';
import { StoreDriver } from './store';

async function q(sql: string, params: any[] = []): Promise<any[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}
async function run(sql: string, params: any[] = []): Promise<number> {
  const [r] = await pool.execute(sql, params);
  return (r as any).affectedRows ?? 0;
}

export const mysqlDriver: StoreDriver = {
  // ---- 数据集 ----
  async getDataset(key) {
    const rows = await q('SELECT dataset_key, dataset_json, updated_at, owner FROM dataset_store WHERE dataset_key = ?', [key]);
    return rows[0];
  },
  async getAllMeta() {
    return q('SELECT dataset_key, updated_at FROM dataset_store');
  },
  async forceUpsertDataset(key, json, owner, ts) {
    await run(
      `INSERT INTO dataset_store (dataset_key, dataset_json, owner, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE dataset_json = VALUES(dataset_json), owner = VALUES(owner), updated_at = VALUES(updated_at)`,
      [key, json, owner, ts]
    );
  },
  async deleteDataset(key) {
    await run('DELETE FROM dataset_store WHERE dataset_key = ?', [key]);
  },
  async allKeySizes() {
    return q('SELECT dataset_key, LENGTH(dataset_json) AS bytes FROM dataset_store');
  },
  // ---- 用量 ----
  async getUsageBytes(owner) {
    const rows = await q('SELECT bytes FROM owner_usage WHERE owner = ?', [owner]);
    return rows.length ? Math.max(0, Number(rows[0].bytes) || 0) : 0;
  },
  async addUsageDelta(owner, delta, ts) {
    await run(
      `INSERT INTO owner_usage (owner, bytes, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE bytes = GREATEST(0, bytes + VALUES(bytes)), updated_at = VALUES(updated_at)`,
      [owner, delta, ts]
    );
  },
  async setUsageBytes(owner, bytes, ts) {
    await run(
      `INSERT INTO owner_usage (owner, bytes, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE bytes = VALUES(bytes), updated_at = VALUES(updated_at)`,
      [owner, bytes, ts]
    );
  },
  async allUsage() {
    return q('SELECT owner, bytes FROM owner_usage');
  },
  async usageCount() {
    const rows = await q('SELECT COUNT(*) AS c FROM owner_usage');
    return Number(rows[0]?.c || 0);
  },
  // ---- 用户 ----
  async getUser(username) {
    const rows = await q('SELECT * FROM registered_users WHERE username = ?', [username]);
    return rows[0];
  },
  async getAllUsers() {
    return q('SELECT * FROM registered_users');
  },
  async insertUser(u) {
    return run(
      `INSERT IGNORE INTO registered_users (username, password, role, company_name, contact_person, phone, email, register_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.username, u.password, u.role, u.company_name, u.contact_person, u.phone, u.email, u.register_date, u.status]
    );
  },
  async updateUser(f, username) {
    await run(
      `UPDATE registered_users SET
        password = COALESCE(?, password), role = COALESCE(?, role), company_name = COALESCE(?, company_name),
        contact_person = COALESCE(?, contact_person), phone = COALESCE(?, phone), email = COALESCE(?, email),
        status = COALESCE(?, status)
       WHERE username = ?`,
      [f.password ?? null, f.role ?? null, f.company_name ?? null, f.contact_person ?? null, f.phone ?? null, f.email ?? null, f.status ?? null, username]
    );
  },
  async deleteUser(username) {
    await run('DELETE FROM registered_users WHERE username = ?', [username]);
  },
  // ---- 设置 ----
  async getSetting(key) {
    const rows = await q('SELECT setting_value FROM system_settings WHERE setting_key = ?', [key]);
    return rows.length ? String(rows[0].setting_value) : undefined;
  },
  async setSetting(key, value) {
    await run(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
      [key, value]
    );
  },
  // ---- 推送 ----
  async upsertPushSub(username, endpoint, p256dh, auth, userAgent) {
    await run(
      `INSERT INTO push_subscriptions (username, endpoint, keys_p256dh, keys_auth, user_agent, updated_at) VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE username = VALUES(username), keys_p256dh = VALUES(keys_p256dh), keys_auth = VALUES(keys_auth),
         user_agent = VALUES(user_agent), updated_at = NOW()`,
      [username, endpoint, p256dh, auth, userAgent]
    );
  },
  async getSubsByUsername(username) {
    return q('SELECT * FROM push_subscriptions WHERE username = ?', [username]);
  },
  async deletePushSub(endpoint) {
    await run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  },
  async deletePushSubsByUsername(username) {
    await run('DELETE FROM push_subscriptions WHERE username = ?', [username]);
  },
  // ---- 企业认证 ----
  async getCert(username) {
    const rows = await q('SELECT * FROM enterprise_cert WHERE username = ?', [username]);
    return rows[0];
  },
  async upsertCert(c) {
    await run(
      `INSERT INTO enterprise_cert (username, company_name, credit_code, legal_person, id_card, status, fail_reason, check_result, attempts, verified_at, last_verify_at, last_check_at, last_change_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), credit_code = VALUES(credit_code), legal_person = VALUES(legal_person),
         id_card = VALUES(id_card), status = VALUES(status), fail_reason = VALUES(fail_reason), check_result = VALUES(check_result),
         attempts = VALUES(attempts), verified_at = VALUES(verified_at), last_verify_at = VALUES(last_verify_at),
         last_check_at = VALUES(last_check_at), last_change_at = VALUES(last_change_at), updated_at = NOW()`,
      [c.username, c.company_name, c.credit_code, c.legal_person, c.id_card, c.status, c.fail_reason, c.check_result, c.attempts, c.verified_at, c.last_verify_at, c.last_check_at, c.last_change_at]
    );
  },
  async updateCertStatus(status, failReason, checkResult, lastCheckAt, username) {
    await run(
      'UPDATE enterprise_cert SET status = ?, fail_reason = ?, check_result = ?, last_check_at = ?, updated_at = NOW() WHERE username = ?',
      [status, failReason, checkResult, lastCheckAt, username]
    );
  },
  async certsDueCheck(cutoff, limit) {
    return q(
      `SELECT * FROM enterprise_cert WHERE status = 'certified' AND (last_check_at = '' OR last_check_at <= ?) ORDER BY last_check_at ASC LIMIT ?`,
      [cutoff, limit]
    );
  },
  async certFacePass(certifyId, username) {
    await run(
      `UPDATE enterprise_cert SET status = 'certified', fail_reason = '', check_result = 'face_ok', face_certify_id = ?,
         verified_at = NOW(), last_check_at = NOW(), updated_at = NOW() WHERE username = ?`,
      [certifyId, username]
    );
  },
  async certFaceFail(reason, certifyId, username) {
    await run('UPDATE enterprise_cert SET fail_reason = ?, face_certify_id = ?, updated_at = NOW() WHERE username = ?', [reason, certifyId, username]);
  },
  // ---- 即时通讯 ----
  async chatInsert(m) {
    await run(
      `INSERT IGNORE INTO chat_messages (id, conv_id, from_user, to_user, content, msg_type, conv_subject, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [m.id, m.conv_id, m.from_user, m.to_user, m.content, m.msg_type, m.conv_subject, m.created_at]
    );
  },
  async chatHistory(convId, before, limit) {
    return q('SELECT * FROM chat_messages WHERE conv_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?', [convId, before, limit]);
  },
  async chatUnreadCount(username) {
    const rows = await q('SELECT COUNT(*) AS cnt FROM chat_messages WHERE to_user = ? AND read_at = 0', [username]);
    return Number(rows[0]?.cnt || 0);
  },
  async chatMarkRead(ts, convId, username) {
    await run('UPDATE chat_messages SET read_at = ? WHERE conv_id = ? AND to_user = ? AND read_at = 0', [ts, convId, username]);
  },
  async chatConversations(username) {
    return q(
      `SELECT
         m.conv_id,
         CASE WHEN m.from_user = ? THEN m.to_user ELSE m.from_user END AS other_user,
         m.content AS last_message,
         m.msg_type AS last_message_type,
         m.conv_subject,
         m.created_at AS last_time
       FROM chat_messages m
       INNER JOIN (
         SELECT conv_id, MAX(created_at) AS max_ts FROM chat_messages WHERE from_user = ? OR to_user = ? GROUP BY conv_id
       ) latest ON m.conv_id = latest.conv_id AND m.created_at = latest.max_ts
       WHERE m.from_user = ? OR m.to_user = ?
       GROUP BY m.conv_id
       ORDER BY m.created_at DESC`,
      [username, username, username, username, username]
    );
  },
  async chatConvUnread(convId, username) {
    const rows = await q('SELECT COUNT(*) AS cnt FROM chat_messages WHERE conv_id = ? AND to_user = ? AND read_at = 0', [convId, username]);
    return Number(rows[0]?.cnt || 0);
  },
  async friendAdd(username, friend, ts) {
    await run('INSERT IGNORE INTO chat_friends (username, friend_username, created_at) VALUES (?, ?, ?)', [username, friend, ts]);
  },
  async friendRemove(username, friend) {
    await run('DELETE FROM chat_friends WHERE username = ? AND friend_username = ?', [username, friend]);
  },
  async friendList(username) {
    return q('SELECT friend_username, remark, created_at FROM chat_friends WHERE username = ? ORDER BY created_at DESC', [username]);
  },
  async friendIs(username, friend) {
    const rows = await q('SELECT 1 AS one FROM chat_friends WHERE username = ? AND friend_username = ?', [username, friend]);
    return rows.length > 0;
  },
  async poolGet(owner) {
    const rows = await q('SELECT members FROM chat_dispatch_pool WHERE owner = ?', [owner]);
    return rows.length ? String(rows[0].members) : undefined;
  },
  async poolSet(owner, membersJson) {
    await run(
      `INSERT INTO chat_dispatch_pool (owner, members) VALUES (?, ?) ON DUPLICATE KEY UPDATE members = VALUES(members)`,
      [owner, membersJson]
    );
  },
  async poolAll() {
    return q('SELECT owner, members FROM chat_dispatch_pool');
  },
  async pendingInsert(p) {
    await run(
      'INSERT INTO chat_pending_messages (id, pool_owner, from_user, content, msg_type, conv_subject, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.id, p.pool_owner, p.from_user, p.content, p.msg_type, p.conv_subject, p.created_at]
    );
  },
  async pendingList(poolOwner) {
    return q('SELECT * FROM chat_pending_messages WHERE pool_owner = ? ORDER BY created_at ASC', [poolOwner]);
  },
  async pendingDelete(id) {
    await run('DELETE FROM chat_pending_messages WHERE id = ?', [id]);
  },
};
