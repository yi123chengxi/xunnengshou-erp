/**
 * 统一数据访问层（异步门面）
 * 双驱动：DB_DRIVER=sqlite（默认，回滚安全） / DB_DRIVER=mysql（独立数据库服务器）
 * 所有业务读写经此门面，租户隔离语义与 SQLite 时代完全一致：
 *  - dataset_store 以 dataset_key 全局唯一 + owner 列归属租户（键名含 owner 后缀）；
 *  - 聊天/分流池以会话参与方或池主为隔离边界。
 */
import { sqliteDriver } from './store-sqlite';
import { mysqlDriver } from './store-mysql';
import { wbGet, wbPut, wbTombstone, wbAll, wbRemove, wbNoteWriteFailCircuit, wbNoteWriteOk, wbCircuitOpen } from './writeBehind';

export interface DatasetRow { dataset_key: string; dataset_json: string; updated_at: number; owner?: string }

export interface StoreDriver {
  // ---- 数据集（业务 JSON 总仓） ----
  getDataset(key: string): Promise<DatasetRow | undefined>;
  getAllMeta(): Promise<{ dataset_key: string; updated_at: number }[]>;
  forceUpsertDataset(key: string, json: string, owner: string, ts: number): Promise<void>;
  deleteDataset(key: string): Promise<void>;
  allKeySizes(): Promise<{ dataset_key: string; bytes: number }[]>;
  // ---- 租户用量计数器 ----
  getUsageBytes(owner: string): Promise<number>;
  addUsageDelta(owner: string, delta: number, ts: number): Promise<void>;
  setUsageBytes(owner: string, bytes: number, ts: number): Promise<void>;
  allUsage(): Promise<{ owner: string; bytes: number }[]>;
  usageCount(): Promise<number>;
  // ---- 注册用户 ----
  getUser(username: string): Promise<any>;
  getAllUsers(): Promise<any[]>;
  insertUser(u: {
    username: string; password: string; role: string; company_name: string; contact_person: string;
    phone: string; email: string; register_date: string; status: string;
  }): Promise<number>;
  updateUser(f: {
    password?: string | null; role?: string | null; company_name?: string | null; contact_person?: string | null;
    phone?: string | null; email?: string | null; status?: string | null;
  }, username: string): Promise<void>;
  deleteUser(username: string): Promise<void>;
  // ---- 系统设置 ----
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  // ---- Web Push 订阅 ----
  upsertPushSub(username: string, endpoint: string, p256dh: string, auth: string, userAgent: string): Promise<void>;
  getSubsByUsername(username: string): Promise<any[]>;
  deletePushSub(endpoint: string): Promise<void>;
  deletePushSubsByUsername(username: string): Promise<void>;
  // ---- 企业认证 ----
  getCert(username: string): Promise<any>;
  upsertCert(c: {
    username: string; company_name: string; credit_code: string; legal_person: string; id_card: string;
    status: string; fail_reason: string; check_result: string; attempts: number;
    verified_at: string; last_verify_at: string; last_check_at: string; last_change_at: string;
  }): Promise<void>;
  updateCertStatus(status: string, failReason: string, checkResult: string, lastCheckAt: string, username: string): Promise<void>;
  certsDueCheck(cutoff: string, limit: number): Promise<any[]>;
  certFacePass(certifyId: string, username: string): Promise<void>;
  certFaceFail(reason: string, certifyId: string, username: string): Promise<void>;
  // ---- 即时通讯 ----
  chatInsert(m: {
    id: string; conv_id: string; from_user: string; to_user: string; content: string;
    msg_type: string; conv_subject: string; created_at: number;
  }): Promise<void>;
  chatHistory(convId: string, before: number, limit: number): Promise<any[]>;
  chatUnreadCount(username: string): Promise<number>;
  chatMarkRead(ts: number, convId: string, username: string): Promise<void>;
  chatConversations(username: string): Promise<any[]>;
  chatConvUnread(convId: string, username: string): Promise<number>;
  friendAdd(username: string, friend: string, ts: number): Promise<void>;
  friendRemove(username: string, friend: string): Promise<void>;
  friendList(username: string): Promise<any[]>;
  friendIs(username: string, friend: string): Promise<boolean>;
  poolGet(owner: string): Promise<string | undefined>;
  poolSet(owner: string, membersJson: string): Promise<void>;
  poolAll(): Promise<{ owner: string; members: string }[]>;
  pendingInsert(p: {
    id: string; pool_owner: string; from_user: string; content: string; msg_type: string;
    conv_subject: string; created_at: number;
  }): Promise<void>;
  pendingList(poolOwner: string): Promise<any[]>;
  pendingDelete(id: string): Promise<void>;
}

const DRIVER = String(process.env.DB_DRIVER || 'sqlite').toLowerCase();
/** 底层驱动（回放任务直写用，不经兜底包装） */
export const storeBase: StoreDriver = DRIVER === 'mysql' ? mysqlDriver : sqliteDriver;
export const STORE_DRIVER = DRIVER === 'mysql' ? 'mysql' : 'sqlite';

/**
 * 写兜底包装：MySQL 写入失败时数据集落本地磁盘（writeBehind）并立即对外服务，
 * DB 恢复后由回放任务写回并删除兜底文件。读路径以 updated_at 取新者：
 * 兜底副本比库内新（故障期间写入尚未回放）时返回兜底副本；删除以墓碑表达。
 * 读失败不吞异常（保持原有 500 语义），避免「读不到→误判新键→整键覆盖」的丢数据路径。
 */
export const store: StoreDriver = {
  ...storeBase,
  async getDataset(key) {
    const row = await storeBase.getDataset(key);
    const wb = wbGet(key);
    if (!wb) return row;
    if (wb.tombstone) return row && row.updated_at > wb.updated_at ? row : undefined;
    if (!row || wb.updated_at >= row.updated_at) {
      return { dataset_key: key, dataset_json: wb.json, updated_at: wb.updated_at, owner: wb.owner };
    }
    return row;
  },
  async getAllMeta() {
    const rows = await storeBase.getAllMeta();
    const wbList = wbAll();
    if (wbList.length === 0) return rows;
    const map = new Map<string, number>(rows.map((r) => [r.dataset_key, r.updated_at]));
    for (const w of wbList) {
      const cur = map.get(w.key);
      if (w.tombstone) { if (cur !== undefined && cur <= w.updated_at) map.delete(w.key); continue; }
      if (cur === undefined || cur <= w.updated_at) map.set(w.key, w.updated_at);
    }
    return [...map.entries()].map(([dataset_key, updated_at]) => ({ dataset_key, updated_at }));
  },
  async forceUpsertDataset(key, json, owner, ts) {
    // 熔断打开期间不再白等 MySQL 写超时，直接落兜底
    if (!wbCircuitOpen()) {
      try {
        await storeBase.forceUpsertDataset(key, json, owner, ts);
        wbRemove(key);
        wbNoteWriteOk();
        return;
      } catch (err) {
        wbPut(key, json, owner, ts);
        wbNoteWriteFailCircuit(key, err);
        return;
      }
    }
    wbPut(key, json, owner, ts);
  },
  async deleteDataset(key) {
    if (!wbCircuitOpen()) {
      try {
        await storeBase.deleteDataset(key);
        wbRemove(key);
        wbNoteWriteOk();
        return;
      } catch (err) {
        wbTombstone(key, Date.now());
        wbNoteWriteFailCircuit(key, err);
        return;
      }
    }
    wbTombstone(key, Date.now());
  },
};
