/**
 * SQLite 驱动（默认/回滚驱动）：把 better-sqlite3 同步预编译语句包装为统一异步门面
 */
import * as s from './sqlite';
import { StoreDriver } from './store';

export const sqliteDriver: StoreDriver = {
  // ---- 数据集 ----
  async getDataset(key) {
    return s.stmtGetDataset.get(key) as any;
  },
  async getAllMeta() {
    return s.stmtGetAllMeta.all() as any;
  },
  async forceUpsertDataset(key, json, owner, ts) {
    s.stmtForceUpsertDataset.run(key, json, owner, ts);
  },
  async deleteDataset(key) {
    s.stmtDeleteDataset.run(key);
  },
  async allKeySizes() {
    return s.stmtAllKeySizes.all() as any;
  },
  // ---- 用量 ----
  async getUsageBytes(owner) {
    const row = s.stmtGetUsageBytes.get(owner) as { bytes: number } | undefined;
    return row ? Math.max(0, Number(row.bytes) || 0) : 0;
  },
  async addUsageDelta(owner, delta, ts) {
    s.stmtAddUsageDelta.run(owner, delta, ts);
  },
  async setUsageBytes(owner, bytes, ts) {
    s.stmtSetUsageBytes.run(owner, bytes, ts);
  },
  async allUsage() {
    return s.stmtAllUsage.all() as any;
  },
  async usageCount() {
    const row = s.stmtUsageCount.get() as { c: number } | undefined;
    return row?.c || 0;
  },
  // ---- 用户 ----
  async getUser(username) {
    return s.stmtGetUser.get(username);
  },
  async getAllUsers() {
    return s.stmtGetAllUsers.all();
  },
  async insertUser(u) {
    const r = s.stmtInsertUser.run(u.username, u.password, u.role, u.company_name, u.contact_person, u.phone, u.email, u.register_date, u.status);
    return r.changes;
  },
  async updateUser(f, username) {
    s.stmtUpdateUser.run(f.password ?? null, f.role ?? null, f.company_name ?? null, f.contact_person ?? null, f.phone ?? null, f.email ?? null, f.status ?? null, username);
  },
  async deleteUser(username) {
    s.stmtDeleteUser.run(username);
  },
  // ---- 设置 ----
  async getSetting(key) {
    const row = s.stmtGetSetting.get(key) as { setting_value: string } | undefined;
    return row ? row.setting_value : undefined;
  },
  async setSetting(key, value) {
    s.stmtSetSetting.run(key, value);
  },
  // ---- 推送 ----
  async upsertPushSub(username, endpoint, p256dh, auth, userAgent) {
    s.stmtUpsertPushSub.run(username, endpoint, p256dh, auth, userAgent);
  },
  async getSubsByUsername(username) {
    return s.stmtGetSubsByUsername.all(username);
  },
  async deletePushSub(endpoint) {
    s.stmtDeletePushSub.run(endpoint);
  },
  async deletePushSubsByUsername(username) {
    s.stmtDeletePushSubByUsername.run(username);
  },
  // ---- 企业认证 ----
  async getCert(username) {
    return s.stmtGetCert.get(username);
  },
  async upsertCert(c) {
    s.stmtUpsertCert.run(c.username, c.company_name, c.credit_code, c.legal_person, c.id_card, c.status, c.fail_reason, c.check_result, c.attempts, c.verified_at, c.last_verify_at, c.last_check_at);
  },
  async updateCertStatus(status, failReason, checkResult, lastCheckAt, username) {
    s.stmtUpdateCertStatus.run(status, failReason, checkResult, lastCheckAt, username);
  },
  async certsDueCheck(cutoff, limit) {
    return s.stmtCertsDueCheck.all(cutoff, limit);
  },
  async certFacePass(certifyId, username) {
    s.stmtCertFacePass.run(certifyId, username);
  },
  async certFaceFail(reason, certifyId, username) {
    s.stmtCertFaceFail.run(reason, certifyId, username);
  },
  // ---- 即时通讯 ----
  async chatInsert(m) {
    s.stmtChatInsert.run(m.id, m.conv_id, m.from_user, m.to_user, m.content, m.msg_type, m.conv_subject, m.created_at);
  },
  async chatHistory(convId, before, limit) {
    return s.stmtChatHistory.all(convId, before, limit);
  },
  async chatUnreadCount(username) {
    const row = s.stmtChatUnreadCount.get(username) as { cnt: number } | undefined;
    return row?.cnt || 0;
  },
  async chatMarkRead(ts, convId, username) {
    s.stmtChatMarkRead.run(ts, convId, username);
  },
  async chatConversations(username) {
    return s.stmtChatConversations.all(username, username, username, username, username);
  },
  async chatConvUnread(convId, username) {
    const row = s.stmtChatConvUnread.get(convId, username) as { cnt: number } | undefined;
    return row?.cnt || 0;
  },
  async friendAdd(username, friend, ts) {
    s.stmtFriendAdd.run(username, friend, ts);
  },
  async friendRemove(username, friend) {
    s.stmtFriendRemove.run(username, friend);
  },
  async friendList(username) {
    return s.stmtFriendList.all(username);
  },
  async friendIs(username, friend) {
    return !!s.stmtFriendIs.get(username, friend);
  },
  async poolGet(owner) {
    const row = s.stmtPoolGet.get(owner) as { members: string } | undefined;
    return row ? row.members : undefined;
  },
  async poolSet(owner, membersJson) {
    s.stmtPoolSet.run(owner, membersJson);
  },
  async poolAll() {
    return s.stmtPoolAll.all() as any;
  },
  async pendingInsert(p) {
    s.stmtPendingInsert.run(p.id, p.pool_owner, p.from_user, p.content, p.msg_type, p.conv_subject, p.created_at);
  },
  async pendingList(poolOwner) {
    return s.stmtPendingList.all(poolOwner);
  },
  async pendingDelete(id) {
    s.stmtPendingDelete.run(id);
  },
};
