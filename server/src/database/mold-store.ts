/**
 * 模具管理权威真表数据访问层（molds）
 *
 * 背景：molds_<owner> 曾是「每台浏览器全量副本 + 服务端整键 JSON」的双向同步键，
 * 整键覆盖/陈旧 state 全量写回导致模具记录跨设备反复丢失。
 * 现改为服务端权威真表：每条模具一行，写路径只 upsert/删除目标行，
 * 客户端经 /api/molds/* 读写并仅保留 IndexedDB 只读缓存，不再参与全局键同步。
 *
 * 双驱动：DB_DRIVER=sqlite 走 better-sqlite3 预编译语句；mysql 走连接池。
 * 表在模块加载时自建（CREATE TABLE IF NOT EXISTS，幂等），不依赖手动 db:init。
 */
import { STORE_DRIVER } from './store';
import * as s from './sqlite';
import pool from './init';

export interface MoldRow {
  owner: string;
  mold_key: string;
  record_json: string;
  updated_at: number;
}

// ============ 自建表（幂等，启动即执行；失败不抛出——首次查询会再暴露错误） ============
const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS molds (
    owner VARCHAR(191) NOT NULL COMMENT '租户主账号',
    mold_key VARCHAR(191) NOT NULL COMMENT '模具记录键（ML*）',
    record_json LONGTEXT NOT NULL COMMENT '完整记录 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, mold_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模具管理（服务端权威真表）'`,
];

async function ensureTables(): Promise<void> {
  try {
    if (STORE_DRIVER === 'mysql') {
      for (const ddl of MYSQL_DDL) await pool.execute(ddl);
    }
    // sqlite 驱动建表已在 database/sqlite.ts 的 db.exec 中完成
  } catch (err: any) {
    console.error('[mold-store] 建表失败:', err?.message || err);
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

// ============ molds ============
export async function listMolds(owner: string): Promise<MoldRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, mold_key, record_json, updated_at FROM molds WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtMoldList.all(owner) as MoldRow[];
}

export async function upsertMold(owner: string, moldKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO molds (owner, mold_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, moldKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtMoldUpsert.run(owner, moldKey, recordJson, updatedAt);
}

export async function deleteMoldRow(owner: string, moldKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM molds WHERE owner = ? AND mold_key = ?', [owner, moldKey]);
    return;
  }
  s.stmtMoldDelete.run(owner, moldKey);
}
