/**
 * 供应商菜单 / 合作握手权威真表数据访问层
 *
 * 背景：purchaser_suppliers_<采购商> / boundPurchasers_<供应商> / cooperation_applications（全局键）
 * 曾是「每台浏览器全量副本 + 服务端整键 JSON」的双向同步键，且合作握手需跨租户代写对方账号下的键，
 * 服务端为此专门维护 COOPERATION_MIRROR 定制合并逻辑；整键覆盖/陈旧副本互相覆盖导致状态来回跳动。
 * 现改为服务端权威真表：每条记录一行，写路径只 upsert/删除目标行，跨租户代写由 /api/cooperation/*
 * 的授权接口在服务端校验身份后完成，客户端仅保留只读缓存，三键退出全局键同步。
 *
 * 三表：
 * - supplier_directory(owner=采购商账号, rec_key=条目 id)：替代 purchaser_suppliers_<owner>
 * - bound_purchasers(owner=供应商账号, rec_key=条目 key/id)：替代 boundPurchasers_<owner>
 * - cooperation_apps(app_key=申请 id, purchaser/supplier=双方账号)：替代全局 cooperation_applications，
 *   按 (purchaser=account OR supplier=account) 作用域读，取代「全员拉全量」
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

export interface CoopAppRow {
  app_key: string;
  purchaser: string;
  supplier: string;
  status: string;
  record_json: string;
  updated_at: number;
}

// ============ 自建表（幂等，启动即执行；失败不抛出——首次查询会再暴露错误） ============
const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS supplier_directory (
    owner VARCHAR(191) NOT NULL COMMENT '采购商主账号',
    rec_key VARCHAR(191) NOT NULL COMMENT '供应商条目 id',
    record_json LONGTEXT NOT NULL COMMENT '完整条目 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购商供应商目录（服务端权威真表）'`,
  `CREATE TABLE IF NOT EXISTS bound_purchasers (
    owner VARCHAR(191) NOT NULL COMMENT '供应商主账号',
    rec_key VARCHAR(191) NOT NULL COMMENT '绑定采购商条目 key/id',
    record_json LONGTEXT NOT NULL COMMENT '完整条目 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (owner, rec_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应商已绑定采购商（服务端权威真表）'`,
  `CREATE TABLE IF NOT EXISTS cooperation_apps (
    app_key VARCHAR(191) NOT NULL COMMENT '合作申请 id',
    purchaser VARCHAR(191) NOT NULL DEFAULT '' COMMENT '采购商账号',
    supplier VARCHAR(191) NOT NULL DEFAULT '' COMMENT '供应商账号',
    status VARCHAR(32) NOT NULL DEFAULT '' COMMENT '申请状态',
    record_json LONGTEXT NOT NULL COMMENT '完整申请 JSON',
    updated_at BIGINT NOT NULL DEFAULT 0 COMMENT '版本时间戳',
    PRIMARY KEY (app_key),
    KEY idx_coop_purchaser (purchaser),
    KEY idx_coop_supplier (supplier)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合作申请（服务端权威真表，按双方账号作用域读）'`,
];

async function ensureTables(): Promise<void> {
  try {
    if (STORE_DRIVER === 'mysql') {
      for (const ddl of MYSQL_DDL) await pool.execute(ddl);
    }
    // sqlite 驱动建表已在 database/sqlite.ts 的 db.exec 中完成
  } catch (err: any) {
    console.error('[cooperation-store] 建表失败:', err?.message || err);
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

// ============ supplier_directory（采购商供应商目录） ============
export async function listSupplierDirectory(owner: string): Promise<OwnerRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, rec_key, record_json, updated_at FROM supplier_directory WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtSupDirList.all(owner) as OwnerRow[];
}

export async function listSupplierDirectoryKeys(owner: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM supplier_directory WHERE owner = ?', [owner]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtSupDirKeys.all(owner) as any[]).map(r => String(r.rec_key));
}

export async function upsertSupplierDirectoryRow(owner: string, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO supplier_directory (owner, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtSupDirUpsert.run(owner, recKey, recordJson, updatedAt);
}

export async function deleteSupplierDirectoryRow(owner: string, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM supplier_directory WHERE owner = ? AND rec_key = ?', [owner, recKey]);
    return;
  }
  s.stmtSupDirDelete.run(owner, recKey);
}

// ============ bound_purchasers（供应商已绑定采购商） ============
export async function listBoundPurchasers(owner: string): Promise<OwnerRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT owner, rec_key, record_json, updated_at FROM bound_purchasers WHERE owner = ? ORDER BY updated_at ASC', [owner]);
  }
  return s.stmtBoundPurchList.all(owner) as OwnerRow[];
}

export async function listBoundPurchaserKeys(owner: string): Promise<string[]> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT rec_key FROM bound_purchasers WHERE owner = ?', [owner]);
    return rows.map(r => String(r.rec_key));
  }
  return (s.stmtBoundPurchKeys.all(owner) as any[]).map(r => String(r.rec_key));
}

export async function upsertBoundPurchaserRow(owner: string, recKey: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO bound_purchasers (owner, rec_key, record_json, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [owner, recKey, recordJson, updatedAt]
    );
    return;
  }
  s.stmtBoundPurchUpsert.run(owner, recKey, recordJson, updatedAt);
}

export async function deleteBoundPurchaserRow(owner: string, recKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM bound_purchasers WHERE owner = ? AND rec_key = ?', [owner, recKey]);
    return;
  }
  s.stmtBoundPurchDelete.run(owner, recKey);
}

// ============ cooperation_apps（合作申请） ============
// 说明：cooperation_applications 历史上是全局并集共享键（每个租户浏览器都持有全部申请，
// 客户端按公司编号 amTargetSupplier 自行过滤）。为保持行为 1:1、避免作用域收窄导致漏读，
// 快照读一律返回全量（listAllCoopApps），客户端镜像与既有过滤逻辑不变。
export async function listAllCoopApps(): Promise<CoopAppRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT app_key, purchaser, supplier, status, record_json, updated_at FROM cooperation_apps ORDER BY updated_at ASC');
  }
  return s.stmtCoopAppListAll.all() as CoopAppRow[];
}

export async function listCoopAppsFor(account: string): Promise<CoopAppRow[]> {
  if (STORE_DRIVER === 'mysql') {
    return q('SELECT app_key, purchaser, supplier, status, record_json, updated_at FROM cooperation_apps WHERE purchaser = ? OR supplier = ? ORDER BY updated_at ASC', [account, account]);
  }
  return s.stmtCoopAppListFor.all(account, account) as CoopAppRow[];
}

export async function getCoopApp(appKey: string): Promise<CoopAppRow | null> {
  if (STORE_DRIVER === 'mysql') {
    const rows = await q('SELECT app_key, purchaser, supplier, status, record_json, updated_at FROM cooperation_apps WHERE app_key = ?', [appKey]);
    return rows.length ? rows[0] : null;
  }
  const row = s.stmtCoopAppGet.get(appKey) as CoopAppRow | undefined;
  return row || null;
}

export async function upsertCoopApp(appKey: string, purchaser: string, supplier: string, status: string, recordJson: string, updatedAt: number): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run(
      `INSERT INTO cooperation_apps (app_key, purchaser, supplier, status, record_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE purchaser = VALUES(purchaser), supplier = VALUES(supplier), status = VALUES(status), record_json = VALUES(record_json), updated_at = VALUES(updated_at)`,
      [appKey, purchaser, supplier, status, recordJson, updatedAt]
    );
    return;
  }
  s.stmtCoopAppUpsert.run(appKey, purchaser, supplier, status, recordJson, updatedAt);
}

export async function deleteCoopApp(appKey: string): Promise<void> {
  if (STORE_DRIVER === 'mysql') {
    await run('DELETE FROM cooperation_apps WHERE app_key = ?', [appKey]);
    return;
  }
  s.stmtCoopAppDelete.run(appKey);
}
