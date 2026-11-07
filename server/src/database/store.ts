/**
 * 统一数据访问层（异步门面）
 * 双驱动：DB_DRIVER=sqlite（默认，回滚安全） / DB_DRIVER=mysql（独立数据库服务器）
 * 所有业务读写经此门面，租户隔离语义与 SQLite 时代完全一致：
 *  - dataset_store 以 dataset_key 全局唯一 + owner 列归属租户（键名含 owner 后缀）；
 *  - 聊天/分流池以会话参与方或池主为隔离边界。
 */
import { sqliteDriver } from './store-sqlite';
import { mysqlDriver } from './store-mysql';

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
export const store: StoreDriver = DRIVER === 'mysql' ? mysqlDriver : sqliteDriver;
export const STORE_DRIVER = DRIVER === 'mysql' ? 'mysql' : 'sqlite';
