/**
 * 商机市场独立库数据访问层（market_listings / market_inv_sync）
 *
 * 背景：market_publish_orders 曾是「每台浏览器全量副本 + 服务端整键 JSON」的双向同步键，
 * 整键替换/墓碑并集语义导致成品卡片与发包单被残缺副本反复覆盖（市场随机清空）。
 * 现改为服务端权威真表：每条发布单/成品卡片一行，写路径只 upsert 目标行，
 * 客户端经 /api/market/* 读写并仅保留只读缓存，不再参与全局键同步。
 *
 * 双驱动：DB_DRIVER=sqlite 走 better-sqlite3 预编译语句；mysql 走连接池。
 * 表在模块加载时自建（CREATE TABLE IF NOT EXISTS，幂等），不依赖手动 db:init。
 */
import { STORE_DRIVER } from './store';
import * as s from './sqlite';
import pool from './init';

export interface MarketListingRow {
  listing_key: string;
  publisher: string;
  ltype: string;
  record_json: string;
  delisted: number;
  updated_at: number;
}

// ============ 自建表（幂等，启动即执行；失败不抛出——首次查询会再暴露错误） ============
const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS market_listings (
    listing_key VARCHAR(191) NOT NULL PRIMARY KEY COMMENT '记录键（mkt_*）',
    publisher VARCHAR(64) NOT NULL DEFAULT '' COMMENT '发布方主账号',
    ltype VARCHAR(16) NOT NULL DEFAULT 'semi' COMMENT '类型 semi=发包 finished=成品',
    record_json LONGTEXT NOT NULL COMMENT '完整记录 JSON',
    delisted TINYINT NOT NULL DEFAULT 0 COMMENT '下架标记',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    INDEX idx_ml_publisher (publisher),
    INDEX idx_ml_type (ltype)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商机市场发布单/成品卡片（独立库）'`,
  `CREATE TABLE IF NOT EXISTS market_inv_sync (
    publisher VARCHAR(64) NOT NULL COMMENT '供应商主账号',
    viewer VARCHAR(64) NOT NULL COMMENT '可见实际库存的采购商账号',
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (publisher, viewer)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='库存同步设置（白名单，无记录不可见）'`,
];

async function ensureTables(): Promise<void> {
  try {
    if (STORE_DRIVER === 'mysql') {
      for (const ddl of MYSQL_DDL) await pool.execute(ddl);
    }
    // sqlite 驱动建表已在 database/sqlite.ts 的 db.exec 中完成
  } catch (err: any) {
    console.error('[market-store] 建表失败:', err?.message || err);
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

// ============ market_listings ============
export async function listAllListings(): Promise<MarketListingRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT listing_key, publisher, ltype, record_json, delisted, updated_at FROM market_listings');
  }
  return s.stmtMarketListAll.all() as MarketListingRow[];
}

export async function getListing(listingKey: string): Promise<MarketListingRow | undefined> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT listing_key, publisher, ltype, record_json, delisted, updated_at FROM market_listings WHERE listing_key = ?', [listingKey]);
    return rows[0];
  }
  return s.stmtMarketGet.get(listingKey) as MarketListingRow | undefined;
}

export async function upsertListing(row: {
  listingKey: string; publisher: string; ltype: string; recordJson: string; delisted: number; updatedAt: number;
}): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO market_listings (listing_key, publisher, ltype, record_json, delisted, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE publisher = VALUES(publisher), ltype = VALUES(ltype), record_json = VALUES(record_json),
         delisted = VALUES(delisted), updated_at = VALUES(updated_at)`,
      [row.listingKey, row.publisher, row.ltype, row.recordJson, row.delisted, row.updatedAt]
    );
    return;
  }
  s.stmtMarketUpsert.run(row.listingKey, row.publisher, row.ltype, row.recordJson, row.delisted, row.updatedAt);
}

export async function deleteListing(listingKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM market_listings WHERE listing_key = ?', [listingKey]);
    return;
  }
  s.stmtMarketDelete.run(listingKey);
}

// ============ market_inv_sync（库存同步设置白名单） ============
export async function getInvSyncViewers(publisher: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT viewer FROM market_inv_sync WHERE publisher = ?', [publisher]);
    return rows.map((r: any) => String(r.viewer));
  }
  return (s.stmtMarketInvGet.all(publisher) as { viewer: string }[]).map((r) => String(r.viewer));
}

/** 整组覆盖：先清空该供应商的白名单再写入新名单（名单为空即全部采购商不可见库存） */
export async function setInvSyncViewers(publisher: string, viewers: string[]): Promise<void> {
  const ts = Date.now();
  const list = Array.from(new Set(viewers.map((v) => String(v || '').trim()).filter(Boolean)));
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM market_inv_sync WHERE publisher = ?', [publisher]);
    for (const v of list) {
      await run(
        `INSERT INTO market_inv_sync (publisher, viewer, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
        [publisher, v, ts]
      );
    }
    return;
  }
  s.stmtMarketInvDelPublisher.run(publisher);
  for (const v of list) s.stmtMarketInvAdd.run(publisher, v, ts);
}
