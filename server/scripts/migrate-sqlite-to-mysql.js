/**
 * 一次性数据迁移脚本：SQLite(factory.db) → MySQL(xinnengshu)
 * 用法（服务器）：cd /var/www/factory-management/server && set -a && . ./.env && set +a && node scripts/migrate-sqlite-to-mysql.js
 * 幂等：全部按主键/唯一键 ON DUPLICATE KEY UPDATE，可重复执行；只读 SQLite，不修改源库。
 * 租户隔离：dataset_store.owner 列原样搬迁；键名含租户后缀的语义不变。
 */
const path = require('path');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_PATH = path.join(__dirname, '..', 'data', 'factory.db');

// cols = 搬迁列；pk = 其中构成主键/唯一键的列（ON DUPLICATE 时不更新）
const TABLES = [
  { name: 'dataset_store', cols: ['dataset_key', 'dataset_json', 'owner', 'updated_at'], pk: ['dataset_key'] },
  { name: 'owner_usage', cols: ['owner', 'bytes', 'updated_at'], pk: ['owner'] },
  { name: 'registered_users', cols: ['username', 'password', 'role', 'company_name', 'contact_person', 'phone', 'email', 'register_date', 'status', 'trial_end_date', 'authorized_until'], pk: ['username'] },
  { name: 'system_settings', cols: ['setting_key', 'setting_value'], pk: ['setting_key'] },
  { name: 'push_subscriptions', cols: ['username', 'endpoint', 'keys_p256dh', 'keys_auth', 'user_agent'], pk: ['endpoint'] },
  { name: 'enterprise_cert', cols: ['username', 'company_name', 'credit_code', 'legal_person', 'id_card', 'status', 'fail_reason', 'check_result', 'attempts', 'verified_at', 'last_verify_at', 'last_check_at', 'face_certify_id'], pk: ['username'] },
  { name: 'chat_messages', cols: ['id', 'conv_id', 'from_user', 'to_user', 'content', 'msg_type', 'conv_subject', 'created_at', 'read_at'], pk: ['id'] },
  { name: 'chat_friends', cols: ['username', 'friend_username', 'created_at', 'remark'], pk: ['username', 'friend_username'] },
  { name: 'chat_dispatch_pool', cols: ['owner', 'members'], pk: ['owner'] },
  { name: 'chat_pending_messages', cols: ['id', 'pool_owner', 'from_user', 'content', 'msg_type', 'conv_subject', 'created_at'], pk: ['id'] },
];

(async () => {
  const sqlite = new Database(DB_PATH, { readonly: true });
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '172.30.52.13',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'erpuser',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xinnengshu',
  });
  console.log('[migrate] 已连接 MySQL', process.env.DB_HOST);

  let total = 0;
  for (const t of TABLES) {
    let rows;
    try {
      rows = sqlite.prepare(`SELECT ${t.cols.join(', ')} FROM ${t.name}`).all();
    } catch (e) {
      console.log(`[migrate] ${t.name}: SQLite 读取跳过（${e.message}）`);
      continue;
    }
    if (rows.length === 0) { console.log(`[migrate] ${t.name}: 0 行（跳过）`); continue; }
    const upd = t.cols.filter(c => !t.pk.includes(c)).map(c => `${c} = VALUES(${c})`).join(', ');
    const sql = `INSERT INTO ${t.name} (${t.cols.join(', ')}) VALUES (${t.cols.map(() => '?').join(', ')})` +
      (upd ? ` ON DUPLICATE KEY UPDATE ${upd}` : '');
    let n = 0;
    for (const r of rows) {
      const params = t.cols.map(c => {
        const v = r[c];
        if (v === undefined || v === null) return null;
        if (typeof v === 'number' || typeof v === 'string') return v;
        return String(v);
      });
      await conn.execute(sql, params);
      n++;
      if (n % 200 === 0) console.log(`[migrate] ${t.name}: ${n}/${rows.length}`);
    }
    console.log(`[migrate] ${t.name}: 迁移 ${n} 行`);
    total += n;
  }

  // 校验：两侧行数比对
  console.log('[migrate] === 行数校验 ===');
  for (const t of TABLES) {
    let sc = 0;
    try { sc = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get().c; } catch { sc = -1; }
    const [mr] = await conn.execute(`SELECT COUNT(*) AS c FROM ${t.name}`);
    console.log(`[migrate] ${t.name}: sqlite=${sc} mysql=${mr[0].c}`);
  }
  sqlite.close();
  await conn.end();
  console.log(`[migrate] 完成，共迁移 ${total} 行`);
  process.exit(0);
})().catch(e => { console.error('[migrate] 失败:', e.message); process.exit(1); });
