/**
 * 客户数据权威真表数据访问层
 *
 * 背景：customers_<owner> / customer_archive_<owner> / credit_adjustments_<owner> / customer_pay_summary_<owner>
 * 曾是「本地优先 + 服务端异步副本」的同步键，整键覆盖/陈旧副本互相覆盖导致归档复活、额度回退。
 * 现改为服务端权威真表：每条记录一行，写路径只 upsert/删除目标行，跨租户代写由 /api/customer/*
 * 的授权接口在服务端校验身份后完成，客户端仅保留只读缓存，四键退出全局键同步。
 *
 * 四表：
 * - customer_profiles(owner=供应商主账号, rec_key=客户 id)：替代 customers_<owner>
 * - customer_archives(owner=供应商主账号, rec_key=归档条目 id)：替代 customer_archive_<owner>
 * - customer_credit_adj(owner=供应商主账号, rec_key=调整记录 id)：替代 credit_adjustments_<owner>
 * - customer_pay_summary(owner=供应商主账号, rec_key=主体名)：替代 customer_pay_summary_<owner>
 *   （本地镜像是 主体名→汇总条目 的对象映射，按条目拆行存储）
 *
 * 双驱动：DB_DRIVER=sqlite 走 better-sqlite3 预编译语句；mysql 走连接池。
 * 表在模块加载时自建（CREATE TABLE IF NOT EXISTS，幂等），不依赖手动 db:init。
 */
import { STORE_DRIVER } from './store';
import * as s from './sqlite';
import pool from './init';

export interface OwnerRow {
  owner: string;
  rec_key: string;
  record_json: string;
  updated_at: number;
}

// ============ 自建表（幂等，启动即执行；失败不抛出——首次查询会再暴露错误） ============
const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS customer_profiles (
    owner VARCHAR(191) NOT NULL COMMENT '供应商主账号',
    rec_key VARCHAR(191) NOT NULL COMMENT '客户条目 id',
    record_json LONGTEXT NOT NULL COMMENT '完整条目 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户档案（服务端权威真表）'`,
  `CREATE TABLE IF NOT EXISTS customer_archives (
    owner VARCHAR(191) NOT NULL COMMENT '供应商主账号',
    rec_key VARCHAR(191) NOT NULL COMMENT '归档条目 id',
    record_json LONGTEXT NOT NULL COMMENT '完整条目 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户归档登记册（服务端权威真表）'`,
  `CREATE TABLE IF NOT EXISTS customer_credit_adj (
    owner VARCHAR(191) NOT NULL COMMENT '供应商主账号',
    rec_key VARCHAR(191) NOT NULL COMMENT '额度调整记录 id',
    record_json LONGTEXT NOT NULL COMMENT '完整条目 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户信用额度调整（服务端权威真表）'`,
  `CREATE TABLE IF NOT EXISTS customer_pay_summary (
    owner VARCHAR(191) NOT NULL COMMENT '供应商主账号',
    rec_key VARCHAR(191) NOT NULL COMMENT '汇总主体名',
    record_json LONGTEXT NOT NULL COMMENT '完整汇总条目 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户欠款汇总（服务端权威真表，按主体名拆行）'`,
];

async function ensureTables(): Promise<void> {
  try {
    if (STORE_DRIVER === 'mysql') {
      for (const ddl of MYSQL_DDL) await pool.execute(ddl);
    }
    // sqlite 驱动建表已在 database/sqlite.ts 的 db.exec 中完成
  } catch (err: any) {
    console.error('[customer-store] 建表失败:', err?.message || err);
  }
}
void ensureTables();

async function q(sql: string, params: any[] = []): Promise<any[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as any[];
}
async function run(sql: string, params: any[] = []): Promise<number> {
  const [r] = await pool.execute(sql, params);
  return (r as any).affectedRows ?? 0;
}

// ============ customer_profiles（客户档案） ============
export async function listCustomerProfiles(owner: string): Promise<OwnerRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, rec_key, record_json, updated_at FROM customer_profiles WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtCustProfList.all(owner) as OwnerRow[];
}

export async function listCustomerProfileKeys(owner: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM customer_profiles WHERE owner = ?', [owner]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtCustProfKeys.all(owner) as any[]).map(r => String(r.rec_key));
}

export async function upsertCustomerProfileRow(owner: string, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO customer_profiles (owner, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtCustProfUpsert.run(owner, recKey, recordJson, updatedAt);
}

export async function deleteCustomerProfileRow(owner: string, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM customer_profiles WHERE owner = ? AND rec_key = ?', [owner, recKey]);
    return;
  }
  s.stmtCustProfDelete.run(owner, recKey);
}

// ============ customer_archives（客户归档登记册） ============
export async function listCustomerArchives(owner: string): Promise<OwnerRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, rec_key, record_json, updated_at FROM customer_archives WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtCustArchList.all(owner) as OwnerRow[];
}

export async function listCustomerArchiveKeys(owner: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM customer_archives WHERE owner = ?', [owner]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtCustArchKeys.all(owner) as any[]).map(r => String(r.rec_key));
}

export async function upsertCustomerArchiveRow(owner: string, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO customer_archives (owner, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtCustArchUpsert.run(owner, recKey, recordJson, updatedAt);
}

export async function deleteCustomerArchiveRow(owner: string, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM customer_archives WHERE owner = ? AND rec_key = ?', [owner, recKey]);
    return;
  }
  s.stmtCustArchDelete.run(owner, recKey);
}

// ============ customer_credit_adj（信用额度调整） ============
export async function listCustomerCreditAdj(owner: string): Promise<OwnerRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, rec_key, record_json, updated_at FROM customer_credit_adj WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtCustCreditList.all(owner) as OwnerRow[];
}

export async function listCustomerCreditAdjKeys(owner: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM customer_credit_adj WHERE owner = ?', [owner]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtCustCreditKeys.all(owner) as any[]).map(r => String(r.rec_key));
}

export async function upsertCustomerCreditAdjRow(owner: string, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO customer_credit_adj (owner, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtCustCreditUpsert.run(owner, recKey, recordJson, updatedAt);
}

export async function deleteCustomerCreditAdjRow(owner: string, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM customer_credit_adj WHERE owner = ? AND rec_key = ?', [owner, recKey]);
    return;
  }
  s.stmtCustCreditDelete.run(owner, recKey);
}

// ============ customer_pay_summary（客户欠款汇总，按主体名拆行） ============
export async function listCustomerPaySummary(owner: string): Promise<OwnerRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, rec_key, record_json, updated_at FROM customer_pay_summary WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtCustSummaryList.all(owner) as OwnerRow[];
}

export async function listCustomerPaySummaryKeys(owner: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM customer_pay_summary WHERE owner = ?', [owner]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtCustSummaryKeys.all(owner) as any[]).map(r => String(r.rec_key));
}

export async function upsertCustomerPaySummaryRow(owner: string, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO customer_pay_summary (owner, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtCustSummaryUpsert.run(owner, recKey, recordJson, updatedAt);
}

export async function deleteCustomerPaySummaryRow(owner: string, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM customer_pay_summary WHERE owner = ? AND rec_key = ?', [owner, recKey]);
    return;
  }
  s.stmtCustSummaryDelete.run(owner, recKey);
}