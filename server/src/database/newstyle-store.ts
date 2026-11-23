/**
 * 新款进度权威真表数据访问层（newstyle_records）
 *
 * 背景：newstyle_progress_/newstyle_photo_/newstyle_arrival_/newstyle_listing_ 曾是
 * 「每台浏览器全量副本 + 服务端整键 JSON」的双向同步键，整键覆盖/陈旧 state 全量写回
 * 存在跨设备丢数据风险。现改为服务端权威真表：每条记录一行（按 owner+dataset+rec_key），
 * 写路径只 upsert/删除目标行，客户端经 /api/newstyle/* 读写并仅保留只读缓存，
 * 不再参与全局键同步（serverSync EXCLUDE_PREFIXES 已排除四个数据键前缀）。
 *
 * 双驱动：DB_DRIVER=sqlite 走 better-sqlite3 预编译语句；mysql 走连接池。
 * 表在模块加载时自建（CREATE TABLE IF NOT EXISTS，幂等），不依赖手动 db:init。
 */
import { STORE_DRIVER } from './store';
import * as s from './sqlite';
import pool from './init';

export interface NewStyleRow {
  owner: string;
  dataset: string;
  rec_key: string;
  record_json: string;
  updated_at: number;
}

/** 四张数据集：主表单/回传图片/到货款式/商品属性 */
export const NEWSTYLE_DATASETS = ['progress', 'photo', 'arrival', 'listing'] as const;
export type NewStyleDataset = typeof NEWSTYLE_DATASETS[number];

export const isNewStyleDataset = (v: any): v is NewStyleDataset => NEWSTYLE_DATASETS.includes(v);

// ============ 自建表（幂等，启动即执行；失败不抛出——首次查询会再暴露错误） ============
const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS newstyle_records (
    owner VARCHAR(191) NOT NULL COMMENT '租户主账号',
    dataset VARCHAR(32) NOT NULL COMMENT '数据集：progress/photo/arrival/listing',
    rec_key VARCHAR(191) NOT NULL COMMENT '记录键',
    record_json LONGTEXT NOT NULL COMMENT '完整记录 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, dataset, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='新款进度（服务端权威真表）'`,
];

async function ensureTables(): Promise<void> {
  try {
    if (STORE_DRIVER === 'mysql') {
      for (const ddl of MYSQL_DDL) await pool.execute(ddl);
    }
    // sqlite 驱动建表已在 database/sqlite.ts 的 db.exec 中完成
  } catch (err: any) {
    console.error('[newstyle-store] 建表失败:', err?.message || err);
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

// ============ newstyle_records ============
export async function listNewStyleRows(owner: string, dataset: NewStyleDataset): Promise<NewStyleRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, dataset, rec_key, record_json, updated_at FROM newstyle_records WHERE owner = ? AND dataset = ? ORDER BY updated_at ASC', [owner, dataset]);
  }
  return s.stmtNewStyleList.all(owner, dataset) as NewStyleRow[];
}

export async function listNewStyleKeys(owner: string, dataset: NewStyleDataset): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM newstyle_records WHERE owner = ? AND dataset = ?', [owner, dataset]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtNewStyleKeys.all(owner, dataset) as any[]).map(r => String(r.rec_key));
}

export async function upsertNewStyleRow(owner: string, dataset: NewStyleDataset, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO newstyle_records (owner, dataset, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, dataset, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtNewStyleUpsert.run(owner, dataset, recKey, recordJson, updatedAt);
}

export async function deleteNewStyleRow(owner: string, dataset: NewStyleDataset, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM newstyle_records WHERE owner = ? AND dataset = ? AND rec_key = ?', [owner, dataset, recKey]);
    return;
  }
  s.stmtNewStyleDelete.run(owner, dataset, recKey);
}
