import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { store } from '../database/store';
import { listMolds } from '../database/mold-store';
import { verifyJWT, verifyCredentials, issueToken, JWTPayload } from './auth.routes';
import { getJwtSecret } from '../utils/jwtSecret';
import { resolveCompanyRoot } from '../services/storageUsage';
import { makeConvId, getHistory as chatHistory, saveMessage as chatSaveMessage, markConvRead as chatMarkRead, getConversations as chatConvs, getUnreadCount as chatUnread } from '../ws/chat-store';
import { isUserOnline, pushSavedToRecipient } from '../ws/chat-ws';
import { checkChatContent, blockReason } from '../utils/chatFilter';
import { canViewMenus, SUPPLIER_MENU_KEYS as WX_MENU_KEYS } from '../services/wxPerms';
import { loadPendingStats, loadSalesMetrics, loadBankMetrics } from '../services/wxDashboard';
import { listDecoratedListings, mergeQuote } from '../services/market-listings';

dotenv.config();

/**
 * 微信小程序后端接口
 * - 登录链路：wx.login code → code2session 换 openid → 查绑定表（settings: wx_openid_bindings）
 *   已绑定直接签发与网页同口径的 JWT；未绑定返回 10 分钟有效的 bindToken 走账号密码绑定。
 * - 审批读写：直接对 dataset_store 做「读-改-写」行级更新（只改目标行字段），
 *   Web 端下次 pull 按「服务端行优先」的行级并集收敛，与现有 sync 架构兼容。
 * - 审核权限与网页同口径：主账号（owner）豁免；子账号须命中负责人名单
 *   （reimbursement_managers_<owner>.review / payment_request_managers_<owner>.review）。
 */

const JWT_SECRET = getJwtSecret();
const WX_APPID = process.env.WX_APPID || '';
const WX_SECRET = process.env.WX_SECRET || '';
const BIND_KEY = 'wx_openid_bindings';

const router = Router();

// ============ 工具 ============
async function readRows(key: string): Promise<any[]> {
  try {
    const row = await store.getDataset(key);
    if (!row) return [];
    const parsed = JSON.parse(row.dataset_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readMap(key: string): Promise<Record<string, any>> {
  try {
    const row = await store.getDataset(key);
    if (!row) return {};
    const parsed = JSON.parse(row.dataset_json || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeRows(key: string, rows: any[], owner: string): Promise<void> {
  await store.forceUpsertDataset(key, JSON.stringify(rows), owner, Date.now());
}

/** 展示名口径与网页 getDisplayName 同源：registeredUsers 的 contactPerson/companyName/displayName 回退 */
async function displayNameOf(username: string): Promise<string> {
  try {
    const users = await readRows('registeredUsers');
    const hit = users.find((u: any) => u && u.username === username);
    if (hit) return String(hit.contactPerson || hit.companyName || hit.displayName || username);
  } catch { /* ignore */ }
  return username;
}

/** 角色解析：registered_users 表优先，回退 registeredUsers 数据集（与登录三源同序） */
async function roleOf(username: string): Promise<string> {
  try {
    const dbUser = await store.getUser(username) as any;
    if (dbUser && dbUser.role) return String(dbUser.role);
  } catch { /* ignore */ }
  try {
    const users = await readRows('registeredUsers');
    const hit = users.find((u: any) => u && u.username === username);
    if (hit && hit.role) {
      let role = String(hit.role);
      if (role === 'supplier,purchaser' || role === 'purchaser,supplier') role = 'both';
      return role;
    }
  } catch { /* ignore */ }
  return 'supplier';
}

async function ownerOf(username: string): Promise<string> {
  try {
    return (await resolveCompanyRoot(username)) || username;
  } catch {
    return username;
  }
}

async function readBindings(): Promise<Record<string, string>> {
  try {
    const raw = await store.getSetting(BIND_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface Code2SessionResult { openid?: string; errcode?: number; errmsg?: string }
async function code2session(code: string): Promise<Code2SessionResult> {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(WX_APPID)}&secret=${encodeURIComponent(WX_SECRET)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  return (await res.json()) as Code2SessionResult;
}

function wxConfigured(): boolean {
  return !!WX_APPID && !!WX_SECRET;
}

const REIMB_STATUS_TEXT: Record<string, string> = {
  pending_review: '待审核', approved: '已通过', rejected: '已拒绝', pending_payment: '待支付', paid: '已支付',
};
const PAY_STATUS_TEXT: Record<string, string> = {
  pending_review: '付款审核', approved: '待支付', rejected: '已拒绝', paid: '已支付',
  pending_confirm: '待确认', confirmed: '已确认',
};

function localYmd(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localYmdHm(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localYmd(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 审核准入：主账号豁免；子账号须命中负责人名单（名单按 username 或展示名匹配） */
async function canAudit(owner: string, username: string, type: 'reimbursement' | 'payment'): Promise<boolean> {
  if (username === owner) return true;
  const key = type === 'reimbursement' ? `reimbursement_managers_${owner}` : `payment_request_managers_${owner}`;
  const mgrs = await readMap(key);
  const list: any[] = Array.isArray(mgrs.review) ? mgrs.review : [];
  if (list.some(m => String(m) === username)) return true;
  const name = await displayNameOf(username);
  return list.some(m => String(m) === name);
}

/** 本租户成员 username 集合（负责人名单有效性过滤：残留的已删除/非本租户账号不算「已设置」，与 Web allUserOptions 同源） */
async function tenantUsernames(owner: string): Promise<Set<string>> {
  const users = await readRows('registeredUsers');
  const resolveOwner = (u: any): string => {
    if (!u.isSubAccount || !u.parentAccount) return String(u.username);
    const visited = new Set<string>();
    let cur = String(u.parentAccount);
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const parent = users.find((x: any) => x && x.username === cur);
      if (!parent || !parent.isSubAccount) return cur;
      cur = String(parent.parentAccount || '');
    }
    return cur || String(u.username);
  };
  const set = new Set<string>([owner]);
  users.forEach((u: any) => { if (u && u.username && (resolveOwner(u) === owner || u.username === owner)) set.add(String(u.username)); });
  return set;
}

/** 负责人名单读取 + 有效性过滤（名单残留无效账号时不算已设置，否则全体子账号会被空态拦住） */
async function validManagersOf(owner: string, key: string, field: string): Promise<string[]> {
  try {
    const raw = await readMap(key);
    const list = Array.isArray(raw[field]) ? raw[field].map(String) : [];
    if (!list.length) return [];
    const members = await tenantUsernames(owner);
    return list.filter(un => members.has(un));
  } catch { return []; }
}

/** 审批页负责人判定（与 Web isTabManager 同源）：管理员豁免 → 未设置或名单全失效全员放行 → 命中名单 */
async function isApprovalManager(owner: string, username: string, type: 'reimbursement' | 'payment', tab: string): Promise<boolean> {
  if (username === owner) return true;
  const key = type === 'reimbursement' ? `reimbursement_managers_${owner}` : `payment_request_managers_${owner}`;
  const valid = await validManagersOf(owner, key, tab);
  if (!valid.length) return true;
  return valid.includes(username);
}

/** 仓库统计负责人名单：ws_managers_<owner> = { viewManagers, editManagers }；旧数组格式双灌两侧（与 Web 兼容分支同源） */
async function wsManagersOf(owner: string): Promise<{ view: string[]; edit: string[] }> {
  try {
    const row = await store.getDataset(`ws_managers_${owner}`);
    const raw = row ? JSON.parse(row.dataset_json || 'null') : null;
    if (Array.isArray(raw)) return { view: raw.map(String), edit: raw.map(String) };
    if (raw && typeof raw === 'object') {
      return {
        view: Array.isArray(raw.viewManagers) ? raw.viewManagers.map(String) : [],
        edit: Array.isArray(raw.editManagers) ? raw.editManagers.map(String) : [],
      };
    }
  } catch { /* ignore */ }
  return { view: [], edit: [] };
}

/** 仓库统计查看权限（与 Web canViewAll 同源）：管理员 / 两名单均空 / 命中查看或编辑负责人 */
async function wsCanViewAll(owner: string, username: string): Promise<boolean> {
  if (username === owner) return true;
  const { view, edit } = await wsManagersOf(owner);
  if (!view.length && !edit.length) return true;
  return view.includes(username) || edit.includes(username);
}

/** 仓库统计编辑权限（与 Web canEditAll 同源）：管理员 / 编辑负责人（查看负责人不隐含编辑权） */
async function wsCanEditAll(owner: string, username: string): Promise<boolean> {
  if (username === owner) return true;
  const { edit } = await wsManagersOf(owner);
  return edit.includes(username);
}

/** 店铺管理可见范围（与 Web shopScope.scopeShops 同源）：管理员 / 未设置 / 勾选查看 → 全部店铺；否则仅本人 + 本组组员的店铺 */
async function scopeShopsFor<T extends { person?: string }>(owner: string, username: string, shops: T[]): Promise<T[]> {
  if (username === owner) return shops;
  let perms: { username: string; view: boolean }[] = [];
  try {
    const row = await store.getDataset(`shopmgr_managers_${owner}`);
    const raw = row ? JSON.parse(row.dataset_json || '[]') : [];
    if (Array.isArray(raw)) {
      perms = raw
        .map((d: any) => typeof d === 'string' ? { username: d, view: true } : { username: String((d && d.username) || ''), view: !!(d && d.view) })
        .filter(p => p.username);
    }
  } catch { /* ignore */ }
  if (!perms.length) return shops;
  const me = perms.find(p => p.username === username);
  if (me && me.view) return shops;
  const myName = await displayNameOf(username);
  const allowed = new Set<string>([myName]);
  // 组长额外含本组组员的店铺（多平台 ops_groups 键合并按 id 去重，与 Web loadOpsGroups 同源）
  const groupKeys = ['dev_ops_groups', `supplier_analytics_${owner}_ops_groups`, `purchaser_analytics_${owner}_ops_groups`, `factory_analytics_${owner}_ops_groups`];
  const seen = new Set<string>();
  const lists = await Promise.all(groupKeys.map(k => readRows(k)));
  lists.forEach(arr => arr.forEach((g: any) => {
    if (!g || !g.id || seen.has(g.id)) return;
    seen.add(g.id);
    if (g.leader === myName && Array.isArray(g.members)) g.members.forEach((m0: any) => allowed.add(String(m0)));
  }));
  return shops.filter(s => allowed.has(String((s && s.person) || '')));
}

// ============ 登录 / 绑定 ============

/** POST /api/wx/login {code} —— 微信 code 换 openid，已绑定直接发令牌 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    if (!wxConfigured()) {
      res.status(501).json({ code: 501, message: '服务端未配置微信小程序（WX_APPID/WX_SECRET）' });
      return;
    }
    const code = String(req.body.code || '');
    if (!code) { res.status(400).json({ code: 400, message: '缺少微信登录 code' }); return; }
    const sess = await code2session(code);
    if (!sess.openid) {
      res.status(401).json({ code: 401, message: `微信登录失败(${sess.errcode || ''} ${sess.errmsg || ''})` });
      return;
    }
    const bindings = await readBindings();
    const username = bindings[sess.openid];
    if (username) {
      const [role, owner, name] = await Promise.all([roleOf(username), ownerOf(username), displayNameOf(username)]);
      const token = await issueToken(username, role);
      res.json({ code: 200, data: { bound: true, token, user: { username, role, owner, name } } });
      return;
    }
    const bindToken = jwt.sign({ openid: sess.openid, typ: 'wx-bind' }, JWT_SECRET, { expiresIn: '10m' } as jwt.SignOptions);
    res.json({ code: 200, data: { bound: false, bindToken } });
  } catch (err: any) {
    console.error('[wx] login error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/bind {bindToken, username, password} —— 首次使用：ERP 账号密码绑定 openid */
router.post('/bind', async (req: Request, res: Response) => {
  try {
    const { bindToken, username, password } = req.body;
    let openid = '';
    try {
      const payload = jwt.verify(String(bindToken || ''), JWT_SECRET) as { openid?: string; typ?: string };
      if (payload.typ !== 'wx-bind' || !payload.openid) throw new Error('bad bind token');
      openid = payload.openid;
    } catch {
      res.status(401).json({ code: 401, message: '绑定凭证无效或已过期，请重新进入小程序' });
      return;
    }
    const result = await verifyCredentials(String(username || ''), String(password || ''));
    if (!result.ok) {
      res.status(result.status).json({ code: result.status, message: result.message });
      return;
    }
    const bindings = await readBindings();
    bindings[openid] = result.user.username;
    await store.setSetting(BIND_KEY, JSON.stringify(bindings));
    const [role, owner] = await Promise.all([roleOf(result.user.username), ownerOf(result.user.username)]);
    const token = await issueToken(result.user.username, role);
    res.json({ code: 200, data: { bound: true, token, user: { ...result.user, role, owner } } });
  } catch (err: any) {
    console.error('[wx] bind error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/me —— 令牌自检 + 归属重算（与 /auth/me 同口径，不回显令牌声明） */
router.get('/me', verifyJWT, async (req: Request, res: Response) => {
  const user = (req as any).user as JWTPayload;
  const owner = await ownerOf(user.username);
  const name = await displayNameOf(user.username);
  res.json({ code: 200, data: { username: user.username, role: user.role, owner, name } });
});

/** 子账号从主账号记录继承的公司级字段（与 Web utils/profileInfo 同一清单） */
const PROFILE_INHERIT_FIELDS = [
  'companyShortName', 'companyNo', 'orderPrefix', 'legalPerson', 'taxpayerCode',
  'province', 'city', 'district', 'addressDetail', 'businessAddress',
  'email', 'registerDate', 'status', 'trialEndDate', 'authorizedUntil',
];

/** GET /api/wx/profile —— 企业信息：与网页版右上角「企业信息」弹窗基本信息同口径；子账号公司级字段继承主账号 */
router.get('/profile', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const users = await readRows('registeredUsers');
    const me: any = users.find((u: any) => u && u.username === user.username) || {};
    const parent: any = owner && owner !== user.username ? (users.find((u: any) => u && u.username === owner) || {}) : {};
    const merged: any = { ...me };
    PROFILE_INHERIT_FIELDS.forEach((f) => { if (!merged[f] && parent[f]) merged[f] = parent[f]; });
    // 公司名称与认证主体始终跟随主账号（与 Web 合并规则一致）
    if (parent.companyName) merged.companyName = parent.companyName;
    const s = (v: any) => String(v ?? '').trim();
    const address = [merged.province, merged.city, merged.district, merged.addressDetail].map(s).filter(Boolean).join(' ') || s(merged.businessAddress);
    res.json({ code: 200, data: { profile: {
      username: user.username,
      role: String(user.role || ''),
      name: await displayNameOf(user.username),
      companyName: s(merged.companyName),
      legalPerson: s(merged.legalPerson),
      companyNo: s(merged.companyNo) || s(merged.companyShortName),
      orderPrefix: s(merged.orderPrefix),
      taxpayerCode: s(merged.taxpayerCode),
      contactPerson: s(me.contactPerson),
      phone: s(me.phone),
      address,
      email: s(merged.email),
      registerDate: s(merged.registerDate),
      status: s(merged.status),
      trialEndDate: s(merged.trialEndDate),
      authorizedUntil: s(merged.authorizedUntil),
    } } });
  } catch (err: any) {
    console.error('[wx] profile error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 工作台 ============

/** GET /api/wx/summary —— 今日统计 + 待办角标 */
router.get('/summary', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const [reimbs, pays, orders] = await Promise.all([
      readRows(`reimbursement_${owner}`),
      readRows(`payment_requests_${owner}`),
      readRows(`pageData_sales_order-manage_${owner}`),
    ]);
    const ymd = localYmd();
    const ym = ymd.slice(0, 7);
    const monthOrders = orders.filter((r: any) => String(r.createTime || r.payTime || '').slice(0, 7) === ym);
    const todayOrders = orders.filter((r: any) => String(r.createTime || r.payTime || '').slice(0, 10) === ymd);
    res.json({
      code: 200,
      data: {
        today: {
          orderCount: todayOrders.length,
          salesAmount: todayOrders.reduce((s: number, r: any) => s + (Number(r.salesAmount) || 0), 0),
        },
        month: {
          salesAmount: monthOrders.reduce((s: number, r: any) => s + (Number(r.salesAmount) || 0), 0),
          orderCount: monthOrders.length,
        },
        todos: {
          reimbPending: reimbs.filter((r: any) => r.status === 'pending_review').length,
          payPending: pays.filter((r: any) => r.recordType !== 'receipt' && r.status === 'pending_review').length,
          recvPending: pays.filter((r: any) => r.recordType === 'receipt' && r.status === 'pending_confirm').length,
        },
      },
    });
  } catch (err: any) {
    console.error('[wx] summary error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * GET /api/wx/dashboard —— 工作台经营看板（指标 + 待生产数据统计）
 * - 指标口径与网页版同源：待生产/今日生产取「生产管理-待生产数据统计」口径层（services/wxDashboard），
 *   今日销售取「销售管理-订单管理」今日新增且已付款完成（已发货/已完成也算），
 *   今日收支取「财务管理-银行账户」交易流水当日 in/out 合计
 * - 权限：按网页版 PERM_V2 菜单点在服务端复算，无权限的指标直接不下发数值（手机端显示 —），
 *   无「待生产数据统计」权限时整块统计不计算也不下发（不依赖前端隐藏，防抓包绕过）
 */
router.get('/dashboard', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const perms = await canViewMenus(user.username, [
      'production/production-pending-stats', 'production/production-order',
      'sales/order-manage', 'finance/bank-account',
    ]);
    const canStats = !!perms['production/production-pending-stats'] || !!perms['production/production-order'];
    const canSales = !!perms['sales/order-manage'];
    const canBank = !!perms['finance/bank-account'];
    const [stats, sales, bank] = await Promise.all([
      canStats ? loadPendingStats(owner) : Promise.resolve(null),
      canSales ? loadSalesMetrics(owner) : Promise.resolve(null),
      canBank ? loadBankMetrics(owner) : Promise.resolve(null),
    ]);
    const t = stats?.totals || null;
    const risk = stats?.risk || null;
    const eff = stats?.efficiency || null;
    res.json({
      code: 200,
      data: {
        perm: {
          productionStats: !!perms['production/production-pending-stats'],
          productionOrder: !!perms['production/production-order'],
          salesOrder: canSales, bankAccount: canBank,
        },
        metrics: {
          // 生产：待生产数量=所有生产订单（未完工部分）待生产合计；今日生产数量=今日完工订单数量合计
          pendingQty: t ? t.poolQty : null,
          pendingCount: t ? t.poolCount : null,
          allOrderCount: t ? t.allCount : null,
          planQtyAll: t ? t.planQtyAll : null,
          todayDoneQty: stats ? stats.doneTodayQty : null,
          todayDoneCount: stats ? stats.doneTodayCount : null,
          // 销售：今日新增且已付款完成（含已发货）
          todaySalesCount: sales ? sales.today.count : null,
          todaySalesQty: sales ? sales.today.qty : null,
          todaySalesAmount: sales ? sales.today.amount : null,
          monthSalesCount: sales ? sales.month.count : null,
          monthSalesAmount: sales ? sales.month.amount : null,
          // 资金：银行账户流水
          todayIncome: bank ? bank.todayIncome : null,
          todayExpense: bank ? bank.todayExpense : null,
          monthIncome: bank ? bank.monthIncome : null,
          monthExpense: bank ? bank.monthExpense : null,
          balanceTotal: bank ? bank.balanceTotal : null,
          accountCount: bank ? bank.accountCount : null,
          // 建议补充的风险/效率指标（同样受生产统计权限约束）
          overdueCount: risk ? risk.overdueCount : null,
          overdueRate: risk ? risk.overdueRate : null,
          unscheduledQty: t ? t.unscheduledQty : null,
          done30Qty: eff ? eff.done30Qty : null,
        },
        pendingStats: stats,
        updatedAt: localYmdHm(),
      },
    });
  } catch (err: any) {
    console.error('[wx] dashboard error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 审批中心 ============

function toApprovalItem(type: 'reimbursement' | 'payment', r: any) {
  if (type === 'reimbursement') {
    return {
      type, key: r.key, no: r.reimbursementNo || r.key, title: r.title || r.category || '',
      applicant: r.applicant || '', applicantName: r.applicantName || r.applicant || '',
      amount: Number(r.amount) || 0, status: r.status || '', statusText: REIMB_STATUS_TEXT[r.status] || r.status || '',
      time: r.applyDate || '', recordType: '', receiptCount: Array.isArray(r.receipts) ? r.receipts.length : 0,
    };
  }
  const isReceipt = r.recordType === 'receipt';
  return {
    type, key: r.key, no: r.requestNo || r.receiptNo || r.key, title: r.description || r.category || '',
    applicant: r.applicant || '', applicantName: r.applicantName || r.applicant || '',
    amount: Number(r.amount) || 0, status: r.status || '',
    statusText: PAY_STATUS_TEXT[r.status] || r.status || '',
    time: r.applyDate || '', recordType: r.recordType || 'payment',
    receiptCount: 0, isReceipt,
  };
}

function isPendingItem(type: 'reimbursement' | 'payment', r: any): boolean {
  if (type === 'reimbursement') return r.status === 'pending_review';
  return r.recordType === 'receipt' ? r.status === 'pending_confirm' : r.status === 'pending_review';
}

/** GET /api/wx/approvals?type=reimbursement|payment&tab=pending|processed|mine */
router.get('/approvals', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const type = req.query.type === 'payment' ? 'payment' : 'reimbursement';
    const tab = String(req.query.tab || 'pending');
    // 菜单点闸：与 Web PERM_V2 菜单可见性一致（finance/reimbursement、finance/payment-request）
    const menuKey = type === 'reimbursement' ? 'finance/reimbursement' : 'finance/payment-request';
    const menuPerms = await canViewMenus(user.username, [menuKey]);
    if (!menuPerms[menuKey]) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const rows = await readRows(type === 'reimbursement' ? `reimbursement_${owner}` : `payment_requests_${owner}`);
    let list = rows.map((r: any) => toApprovalItem(type, r));
    if (tab === 'pending') list = list.filter((it: any) => isPendingItem(type, rows.find((r: any) => r.key === it.key)));
    else if (tab === 'processed') list = list.filter((it: any) => !isPendingItem(type, rows.find((r: any) => r.key === it.key)));
    else if (tab === 'mine') list = list.filter((it: any) => it.applicant === user.username);
    // 负责人闸（与 Web 页签空态同源）：非负责人看不到对应页签记录；我发起不受限
    if (tab !== 'mine') {
      if (type === 'reimbursement') {
        const [mgrReview, mgrPayment] = await Promise.all([
          isApprovalManager(owner, user.username, 'reimbursement', 'review'),
          isApprovalManager(owner, user.username, 'reimbursement', 'payment'),
        ]);
        list = list.filter((it: any) => {
          if (it.status === 'pending_review') return mgrReview;
          if (it.status === 'pending_payment') return mgrPayment;
          return mgrReview || mgrPayment;
        });
      } else {
        const [mgrReceipt, mgrReview, mgrPay] = await Promise.all([
          isApprovalManager(owner, user.username, 'payment', 'receipt'),
          isApprovalManager(owner, user.username, 'payment', 'review'),
          isApprovalManager(owner, user.username, 'payment', 'pay'),
        ]);
        list = list.filter((it: any) => {
          if ((it as any).recordType === 'receipt') return mgrReceipt;
          if (it.status === 'pending_review' || it.status === 'rejected') return mgrReview;
          return mgrPay;
        });
      }
    }
    res.json({ code: 200, data: { list } });
  } catch (err: any) {
    console.error('[wx] approvals error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/approvals/:type/:key —— 详情（含票据图与审核准入标记） */
router.get('/approvals/:type/:key', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const type = req.params.type === 'payment' ? 'payment' : 'reimbursement';
    const rows = await readRows(type === 'reimbursement' ? `reimbursement_${owner}` : `payment_requests_${owner}`);
    const rec = rows.find((r: any) => String(r.key) === req.params.key);
    if (!rec) { res.status(404).json({ code: 404, message: '记录不存在或已删除' }); return; }
    const pending = isPendingItem(type, rec);
    res.json({
      code: 200,
      data: {
        record: rec,
        item: toApprovalItem(type, rec),
        pending,
        canAudit: pending ? await canAudit(owner, user.username, type) : false,
      },
    });
  } catch (err: any) {
    console.error('[wx] approval detail error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/approvals/:type/:key/audit {approved, comment?, mainCategory?} */
router.post('/approvals/:type/:key/audit', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const type = req.params.type === 'payment' ? 'payment' : 'reimbursement';
    const approved = req.body.approved === true;
    const comment = String(req.body.comment || '').trim();
    if (!approved && !comment) {
      res.status(400).json({ code: 400, message: '拒绝时必须填写原因' });
      return;
    }
    const dsKey = type === 'reimbursement' ? `reimbursement_${owner}` : `payment_requests_${owner}`;
    const rows = await readRows(dsKey);
    const rec = rows.find((r: any) => String(r.key) === req.params.key);
    if (!rec) { res.status(404).json({ code: 404, message: '记录不存在或已删除' }); return; }
    if (!isPendingItem(type, rec)) {
      res.status(409).json({ code: 409, message: '该记录已不在待审核状态' });
      return;
    }
    if (type === 'reimbursement' && rec.source === 'daily_book') {
      res.status(409).json({ code: 409, message: '来源日常记账的报销单请在日常记账中修改' });
      return;
    }
    if (!(await canAudit(owner, user.username, type))) {
      res.status(403).json({ code: 403, message: '无审核权限：仅主账号或设置的负责人可审核' });
      return;
    }
    const name = await displayNameOf(user.username);
    if (type === 'reimbursement') {
      // 与网页 ReimbursementPage 审核写入口径一致
      rec.status = approved ? 'approved' : 'rejected';
      rec.financeReviewer = name;
      rec.financeReviewDate = localYmdHm();
      rec.financeComment = comment;
      if (approved && req.body.mainCategory) rec.mainCategory = String(req.body.mainCategory);
    } else {
      // 与网页 PaymentRequestPage 审核写入口径一致
      rec.status = approved ? 'approved' : 'rejected';
      rec.reviewer = name;
      rec.reviewedAt = new Date().toLocaleString('zh-CN');
      rec.updatedAt = new Date().toISOString();
      if (!approved) rec.rejectReason = comment;
    }
    await writeRows(dsKey, rows, owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] audit error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 报销申请（手机填单） ============

/** POST /api/wx/reimbursements {title, category, amount, description?, receipts?} */
router.post('/reimbursements', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const title = String(req.body.title || '').trim();
    const category = String(req.body.category || '').trim();
    const amount = Number(req.body.amount);
    if (!title || !category || !(amount > 0)) {
      res.status(400).json({ code: 400, message: '标题/费用分类/金额(>0)为必填' });
      return;
    }
    const dsKey = `reimbursement_${owner}`;
    const rows = await readRows(dsKey);
    const ymd = localYmd().replace(/-/g, '');
    const seq = rows.filter((r: any) => String(r.reimbursementNo || '').startsWith(`BX${ymd}`)).length + 1;
    const name = await displayNameOf(user.username);
    const rec: any = {
      key: `rb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reimbursementNo: `BX${ymd}${String(seq).padStart(3, '0')}`,
      title, category, amount,
      description: String(req.body.description || ''),
      receipts: Array.isArray(req.body.receipts) ? req.body.receipts.slice(0, 9) : [],
      applicant: user.username, applicantName: name,
      applyDate: localYmd(), status: 'pending_review',
      createTime: new Date().toISOString(), source: 'wechat',
    };
    await writeRows(dsKey, [rec, ...rows], owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] reimburse create error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 日常记账（手机填单，与 Web DailyBookkeepingPage 同口径） ============

const BOOK_INCOME_MAINS = ['主营业务收入', '其他业务收入', '营业外收入'];
const BOOK_EXPENSE_MAINS = ['销售费用', '管理费用', '财务费用'];

/** POST /api/wx/bookkeeping {bookDate, bookType, mainCategory, subCategory?, amount, account?, remark?} */
router.post('/bookkeeping', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const bookType = req.body.bookType === '收入' ? '收入' : req.body.bookType === '支出' ? '支出' : '';
    const bookDate = String(req.body.bookDate || '');
    const mainCategory = String(req.body.mainCategory || '').trim();
    const subCategory = String(req.body.subCategory || '').trim();
    const amountRaw = Number(req.body.amount);
    const account = String(req.body.account || '').trim();
    const remark = String(req.body.remark || '').trim();
    if (!bookType || !/^\d{4}-\d{2}-\d{2}$/.test(bookDate) || !mainCategory || !(amountRaw > 0)) {
      res.status(400).json({ code: 400, message: '记账日期/收支类型/主分类/金额(>0)为必填' });
      return;
    }
    if (bookType === '收入' ? !BOOK_INCOME_MAINS.includes(mainCategory) : !BOOK_EXPENSE_MAINS.includes(mainCategory)) {
      res.status(400).json({ code: 400, message: '主分类与收支类型不匹配' });
      return;
    }
    // 已期末结转月份禁止新增（与 Web 端 closedMonths 守卫同口径）
    const closed = await readMap(`ledger_period_amounts_${owner}`);
    if (closed[bookDate.slice(0, 7)] !== undefined) {
      res.status(409).json({ code: 409, message: `${bookDate.slice(0, 7)} 已期末结转，禁止新增记账` });
      return;
    }
    const dsKey = `daily_bookkeeping_${owner}`;
    const rows = await readRows(dsKey);
    // 凭证号与 Web generateVoucherNo 同格式：PZ-YYYYMMDD-当日序号三位
    const prefix = `PZ-${bookDate.replace(/-/g, '')}`;
    const seq = rows.filter((r: any) => String(r.voucherNo || '').startsWith(prefix)).length + 1;
    // 收入侧子分类含「退货」记负数金额 + isReturn（与 Web 退货模式落库同口径）
    const isReturn = bookType === '收入' && subCategory.includes('退货');
    const rec: any = {
      key: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      voucherNo: `${prefix}-${String(seq).padStart(3, '0')}`,
      bookDate, bookType,
      category: subCategory ? `${mainCategory}-${subCategory}` : mainCategory,
      amount: isReturn ? -Math.abs(amountRaw) : amountRaw,
      ...(isReturn ? { isReturn: true } : {}),
      person: await displayNameOf(user.username),
      payAccount: bookType === '支出' ? account : '',
      recvAccount: bookType === '收入' ? account : '',
      payBank: '', recvBank: '',
      department: '',
      remark,
      createdAt: new Date().toISOString(),
      source: 'wechat',
    };
    await writeRows(dsKey, [rec, ...rows], owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] bookkeeping create error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 查询（库存 / 订单） ============

/** GET /api/wx/inventory?q= —— 商品列表模糊查询（款号/简称/编码） */
router.get('/inventory', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await readRows(`pageData_basic-data_product-list_${owner}`);
    const hit = q
      ? rows.filter((r: any) => `${r.productCode || ''}${r.shortName || ''}${r.styleCode || ''}`.toLowerCase().includes(q))
      : rows;
    const list = hit.slice(0, 50).map((r: any) => ({
      key: r.key, productCode: r.productCode || '', shortName: r.shortName || '',
      styleCode: r.styleCode || '', unit: r.unit || '', productType: r.productType || '',
      productStatus: r.productStatus || '', stock: Number(r.actualStock ?? r.stock) || 0,
    }));
    res.json({ code: 200, data: { list, total: hit.length } });
  } catch (err: any) {
    console.error('[wx] inventory error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/product-cost/:key —— 商品成本明细（与 Web ModuleChildPage「物料明细」同口径）
 *  BOM 键 bom_<货品key>_<owner> 经 serverSync 白名单同步上云，服务端可直接读；
 *  半成品有效价递归口径照抄 Web getSemiEffectivePrice：子BOM成本>0 则用子BOM成本，否则回落 stored price，visited 防环 */
router.get('/product-cost/:key', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const key = String(req.params.key || '');
    if (!key) { res.status(400).json({ code: 400, message: '缺少商品 key' }); return; }
    const loadBom = (k: string) => readMap(`bom_${k}_${owner}`);
    const effPrice = async (item: any, visited: Set<string>): Promise<number> => {
      if (!item || !item.key || visited.has(item.key)) return 0;
      visited.add(item.key);
      const stored = Number(item.price) || 0;
      const sub = await loadBom(item.key);
      const semis = Array.isArray(sub.semiProducts) ? sub.semiProducts : [];
      const raws = Array.isArray(sub.rawMaterials) ? sub.rawMaterials : [];
      const procs = Array.isArray(sub.processes) ? sub.processes : [];
      let s = 0;
      for (const i of semis) {
        if (visited.has(i.key)) continue;
        s += (await effPrice(i, new Set(visited))) * (Number(i.qty) || 1);
      }
      const line = (arr: any[]) => arr.reduce((a: number, i: any) => a + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
      const bomCost = s + line(raws) + line(procs);
      return bomCost > 0 ? bomCost : stored;
    };
    // 名称/单位回查产品列表（与 Web buildBomItemName 同口径：item 自带字段优先）
    const products = await readRows(`pageData_basic-data_product-list_${owner}`);
    const prodOf = new Map(products.map((p: any) => [String(p.key), p]));
    const nameOf = (i: any): string => String(i.name || i.shortName || i.productCode || prodOf.get(String(i.key))?.shortName || prodOf.get(String(i.key))?.productCode || i.key || '—');
    const bom = await loadBom(key);
    const semis = Array.isArray(bom.semiProducts) ? bom.semiProducts : [];
    const raws = Array.isArray(bom.rawMaterials) ? bom.rawMaterials : [];
    const procs = Array.isArray(bom.processes) ? bom.processes : [];
    const semi = [] as any[];
    let semiTotal = 0;
    for (const i of semis) {
      const p = await effPrice(i, new Set());
      const qty = Number(i.qty) || 1;
      semiTotal += p * qty;
      semi.push({ name: nameOf(i), unit: i.unit || '', price: p, qty, amount: p * qty });
    }
    const line = (arr: any[]) => arr.map((i: any) => {
      const p = Number(i.price) || 0;
      const qty = Number(i.qty) || 1;
      return { name: nameOf(i), unit: i.unit || '', price: p, qty, amount: p * qty };
    });
    const raw = line(raws);
    const proc = line(procs);
    // 生产费用：仅成品页口径（Web 按 pageConfig.productTypeFilter==='成品'），服务端以商品 productType 判定
    const me = products.find((p: any) => String(p.key) === key);
    let fees: any[] = [];
    if (String(me?.productType || '') === '成品') {
      const stored = await readRows(`pageData_settings_production-fee_${owner}`);
      fees = stored.filter((f: any) => f.status !== 'disabled').map((f: any) => ({
        name: String(f.name || f.feeName || '生产费用'), price: Number(f.unitCost ?? f.amount) || 0, qty: 1, amount: Number(f.unitCost ?? f.amount) || 0, unit: '',
      }));
    }
    const feeTotal = fees.reduce((a, f) => a + f.amount, 0);
    const totalCost = semiTotal + raw.reduce((a, i) => a + i.amount, 0) + proc.reduce((a, i) => a + i.amount, 0) + feeTotal;
    res.json({ code: 200, data: { semi, raw, proc, fees, totalCost, hasBom: semis.length + raws.length + procs.length + fees.length > 0 } });
  } catch (err: any) {
    console.error('[wx] product-cost error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/orders?q= —— 订单列表模糊查询（单号/客户/货品明细），含货品明细与收件信息
 *  订单状态口径：orderStatus（中文）优先，历史手工单仅存 status('pending') 时映射「待处理」 */
router.get('/orders', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    // 菜单点闸：订单查询/打单拣货与 Web「销售管理→订单管理」菜单同权限
    const orderMenu = await canViewMenus(user.username, ['sales/order-manage']);
    if (!orderMenu['sales/order-manage']) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await readRows(`pageData_sales_order-manage_${owner}`);
    const hit = q
      ? rows.filter((r: any) => `${r.orderNo || ''}${r.id || ''}${r.customerName || ''}${r.productDetail || ''}`.toLowerCase().includes(q))
      : rows;
    /** 订单状态文案：网页版「订单状态」列并非直出 orderStatus，而是按 auditStatus 派生流转文案
     *  （ModuleChildPage tag 渲染分支），这里逐条对齐判定顺序：已发货 > 异常 > 驳回 > 审核流转 > 原始值，
     *  否则同一单小程序显示「已付款」而网页显示「已审核待发货」 */
    const statusTextOf = (r: any): string => {
      const os = String(r.orderStatus || '').trim();
      const audit = String(r.auditStatus || '').trim();
      // 已发货优先：Web 里发货后单据不可再操作，不再按审核态改写
      if (os === '已发货') return '已发货';
      if (audit === '异常') return '异常';
      if (audit.includes('驳回')) return '驳回';
      if (audit === '待财务审核') return '已审核待财审';
      if (audit === '已审核') return '已审核待发货';
      if (audit === '生产排期') {
        // 生产已完成但货款未收清时 Web 显「生产完成待收款」，收清后自动转入打单拣货
        const done = r.productionCompleted === true || r.productionCompleted === 'true';
        return done ? '生产完成待收款' : '已审核待生产';
      }
      if (audit === '已合并') return '已合并';
      if (audit === '已取消') return '已取消';
      if (os) return os;
      const s = String(r.status || '').trim();
      if (s === 'pending') return '待处理';
      if (s === 'processing') return '进行中';
      if (s === 'completed') return '已完成';
      if (s === 'cancelled') return '已取消';
      return s;
    };
    // 订单状态快速筛选：按派生状态文案等值过滤（与列表下发口径一致），空串=全部
    const status = String(req.query.status || '').trim();
    const scoped = status ? hit.filter((r: any) => statusTextOf(r) === status) : hit;
    // 单页上限 20 条（用户指定）：total 仍为筛选后全量数
    const list = scoped.slice(0, 20).map((r: any) => {
      // 货品明细唯一读取源 orderItems（JSON 字符串），解析口径与 Web 端一致（unitPrice 兼容映射 price）
      let items: any[] = [];
      try {
        const raw = typeof r.orderItems === 'string' ? JSON.parse(r.orderItems) : (Array.isArray(r.orderItems) ? r.orderItems : []);
        items = (Array.isArray(raw) ? raw : []).map((it: any) => ({
          productCode: it.productCode || it.styleCode || '', shortName: it.shortName || '',
          styleCode: it.styleCode || '', color: it.color || '', spec: it.spec || '',
          quantity: Number(it.quantity) || 0, price: Number(it.price ?? it.unitPrice) || 0,
          amount: Number(it.amount) || 0, image: it.image || '',
        }));
      } catch { items = []; }
      // 订单日志：与 Web 端 getOrderLogs 同源，读订单记录 orderLog（JSON 字符串数组 time/action/operator/detail）
      let logs: any[] = [];
      try {
        const rawLog = typeof r.orderLog === 'string' ? JSON.parse(r.orderLog) : (Array.isArray(r.orderLog) ? r.orderLog : []);
        logs = (Array.isArray(rawLog) ? rawLog : []).map((l: any) => ({
          time: String(l.time || ''), action: String(l.action || ''),
          operator: String(l.operator || ''), detail: String(l.detail || ''),
        }));
      } catch { logs = []; }
      const receiverAddress = String(r.receiverAddress || '').trim()
        || [r.province, r.city, r.district, r.addressDetail].filter(Boolean).map((s: any) => String(s).trim()).join(' ');
      return {
        key: r.key, orderNo: r.orderNo || r.id || '', customerName: r.customerName || '',
        createTime: r.createTime || r.date || '', orderStatus: statusTextOf(r),
        receiverName: r.receiverName || r.person || '', receiverPhone: r.receiverPhone || '',
        receiverAddress, productAmount: Number(r.productAmount) || Number(r.amount) || 0,
        totalQty: items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0),
        items, logs,
      };
    });
    res.json({ code: 200, data: { list, total: scoped.length } });
  } catch (err: any) {
    console.error('[wx] orders error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/bank-accounts?q= —— 银行账户列表（与 Web 财务管理→银行账户同源同字段，只读）
 *  密码类字段（uShieldPwd/withdrawPwd）一律不下发到手机端 */
router.get('/bank-accounts', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const bankMenu = await canViewMenus(user.username, ['finance/bank-account']);
    if (!bankMenu['finance/bank-account']) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await readRows(`pageData_finance_bank-account_${owner}`);
    const textOf = (r: any): string => [
      r.name, r.shortName, r.bankName, r.branchName, r.bankAccountNo, r.accountType, r.status, r.person,
    ].map(v => String(v || '')).join(' ').toLowerCase();
    const hit = q ? rows.filter((r: any) => textOf(r).includes(q)) : rows;
    const list = hit.slice(0, 100).map((r: any) => {
      // 交易流水只读下发（与 Web normalizeBankTxns 口径一致：type 归一 in/out，余额空回 null），精简字段控制体积
      let txns: any[] = [];
      try {
        const raw = Array.isArray(r.transactions) ? r.transactions : [];
        txns = raw.map((t: any) => ({
          time: t.time || t.date || '',
          type: (t.type === 'in' || t.type === '收入' || t.type === 'income') ? 'in' : 'out',
          amount: Number(t.amount) || 0,
          balanceAfter: (t.balanceAfter === undefined || t.balanceAfter === null || t.balanceAfter === '') ? null : Number(t.balanceAfter),
          counterparty: t.counterparty || '',
          person: t.person || '',
          remark: t.remark || '',
        }));
      } catch { txns = []; }
      return {
        key: r.key || r.id || '', name: r.name || '', shortName: r.shortName || '',
        bankName: r.bankName || '', branchName: r.branchName || '', bankAccountNo: r.bankAccountNo || '',
        accountType: r.accountType || '', balance: Number(r.balance) || 0,
        status: r.status || '', openDate: day10(r.openDate), person: r.person || '',
        txnCount: txns.length, transactions: txns,
      };
    });
    const totalBalance = hit.reduce((s: number, r: any) => s + (Number(r.balance) || 0), 0);
    res.json({ code: 200, data: { list, total: hit.length, totalBalance } });
  } catch (err: any) {
    console.error('[wx] bank-accounts error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 商机市场（只读） ============

/** 公司名实时解析（与 Web 端 resolveCompany 同口径：快照字段失真时回退 registeredUsers） */
async function companyMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const users = await readRows('registeredUsers');
    users.forEach((u: any) => { if (u && u.username && u.companyName) map[u.username] = u.companyName; });
  } catch { /* ignore */ }
  return map;
}

/** 发布方账号：模具租售行存 publisher，成品/发包行存 publisherUsername */
const pubOf = (r: any): string => String(r.publisherUsername || r.publisher || '');
/** 模具类型归一：Web 存 rent/sell，历史数据可能直接存中文 */
const moldModeOf = (r: any): string => {
  const m = String(r.mode || '');
  if (m === 'rent') return '出租';
  if (m === 'sell') return '出售';
  return m;
};
/** 模具价格归一：出租取日租金、出售取售价（与 Web MoldMarketTab 同一取值口径） */
const moldPriceOf = (r: any): number => {
  const v = r.mode === 'sell' ? r.sellPrice : r.mode === 'rent' ? r.rentPrice : pick(r.price, r.targetPrice);
  return Number(v) || 0;
};
/** 图片引用键归一：Web 历史行里混存 localStorage 引用键，服务端无法解析，只保留可直接加载的地址 */
const keepImage = (u: any): string => (
  typeof u === 'string' && /^(https?:\/\/|data:|\/uploads\/|\/api\/)/i.test(u) ? u : ''
);
/** 报价方名称脱敏（与 Web maskName 同口径：对所有查看者统一掩码中间字符） */
const maskName = (s: any): string => {
  const t = String(s || '');
  if (!t) return '';
  if (t.length <= 2) return `${t.slice(0, 1)}*`;
  return `${t[0]}${'*'.repeat(Math.max(1, t.length - 2))}${t[t.length - 1]}`;
};
const firstImage = (r: any): string => {
  if (Array.isArray(r.images)) {
    const hit = r.images.map(keepImage).filter(Boolean)[0];
    if (hit) return hit;
  }
  const own = keepImage(r.image);
  if (own) return own;
  // 主图可能是发布方本机的 blob/引用键（服务端解不出）：回退到随记录同步过来的 SKU 变体图，
  // 与详情接口 images 的取值链保持一致，避免出现「详情有图、列表无图」
  if (Array.isArray(r.variantImages)) {
    const hit = r.variantImages.map((v: any) => keepImage(v && (v.src || v.image))).filter(Boolean)[0];
    if (hit) return hit;
  }
  return '';
};

/** GET /api/wx/market?type=finished|semi|mold —— 商机市场三列表（成品/发包/模具租售） */
router.get('/market', verifyJWT, async (req: Request, res: Response) => {
  try {
    const type = String(req.query.type || 'finished');
    const q = String(req.query.q || '').trim().toLowerCase();
    const companies = await companyMap();
    const coOf = (r: any) => r.publisherCompany || companies[pubOf(r)] || pubOf(r) || '';
    if (type === 'mold') {
      const rows = await readRows('market_mold_listings');
      // 模具搜索口径与 Web MoldMarketTab 同：标题/模具编号/名称/规格
      const hit = q
        ? rows.filter((r: any) => `${r.title || r.name || r.moldName || ''} ${r.moldCode || ''} ${r.moldName || ''} ${r.spec || ''}`.toLowerCase().includes(q))
        : rows;
      const list = hit.slice(0, 50).map((r: any) => ({
        id: r.key || r.id, title: r.title || r.name || r.moldName || '模具租售',
        price: moldPriceOf(r), publisherCompany: coOf(r), publisherUsername: pubOf(r),
        publishTime: r.publishTime || r.createTime || r.createdAt || '', status: r.status || '',
        image: firstImage(r),
        mode: moldModeOf(r), moldCode: r.moldCode || '', spec: r.spec || '',
      }));
      res.json({ code: 200, data: { list } });
      return;
    }
    // 商机市场已迁独立库：经服务层读取存活记录（成品含实时库存 join + 按查看方库存可见性剥离）
    const viewer = ((req as any).user as JWTPayload)?.username || '';
    const all = await listDecoratedListings(viewer);
    const rows = all.filter((r: any) => (type === 'finished' ? r.type === 'finished' : r.type !== 'finished') && r.status !== '已中标');
    // 成品/发包搜索口径与 Web MarketPage 同：单号/款号/简称/发布公司
    const hit = q
      ? rows.filter((r: any) => `${r.id || r.key || ''} ${r.styleCode || ''} ${r.shortName || ''} ${coOf(r)}`.toLowerCase().includes(q))
      : rows;
    const list = hit.slice(0, 50).map((r: any) => ({
      id: r.id || r.key, styleCode: r.styleCode || '', shortName: r.shortName || '',
      quantity: Number(r.quantity) || 0, targetPrice: Number(r.targetPrice) || 0,
      publisherCompany: coOf(r), publisherUsername: pubOf(r),
      publishTime: r.publishTime || '', status: r.status || '',
      quoteCount: Array.isArray(r.quotes) ? r.quotes.length : 0,
      image: firstImage(r),
    }));
    res.json({ code: 200, data: { list } });
  } catch (err: any) {
    console.error('[wx] market error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/market/:type/:id —— 产品详情（字段与 Web MarketPage 详情弹窗 / MoldMarketTab 详情同口径）
 *  脱敏口径与 Web 一致：报价记录只对发布方自己下发（其他账号 Web 做逐列脱敏，手机端不展示脱敏占位）；
 *  跨账号一律不下发对方联系方式，联系走 /wx/chat/* 站内会话 */
router.get('/market/:type/:id', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const type = String(req.params.type || 'finished');
    const id = String(req.params.id || '');
    const me = await ownerOf(user.username);
    const companies = await companyMap();
    const coOf = (u: string, snap?: any) => String(snap || companies[u] || u || '');
    if (type === 'mold') {
      const rows = await readRows('market_mold_listings');
      const r = rows.find((x: any) => String(x.key || x.id || '') === id);
      if (!r) { res.status(404).json({ code: 404, message: '该模具信息已下架或不存在' }); return; }
      const pub = pubOf(r);
      const specs = (Array.isArray(r.specs) ? r.specs : [])
        .filter((s: any) => s && s.specName)
        .map((s: any) => ({ spec: String(s.specName), qty: Number(s.quantity) || 0 }));
      res.json({ code: 200, data: { detail: {
        id, type, title: r.title || r.moldName || '模具租售',
        moldCode: r.moldCode || '', moldName: r.moldName || '', spec: r.spec || '',
        mode: moldModeOf(r), price: moldPriceOf(r), rent: r.mode === 'rent',
        status: r.status || '', dealt: r.dealt === true,
        publishTime: day10(r.publishTime || r.createTime || r.createdAt),
        images: (Array.isArray(r.images) ? r.images.map(keepImage) : [keepImage(r.image)]).filter(Boolean),
        specs, totalQty: Number(r.totalQuantity) || specs.reduce((s: number, x: any) => s + x.qty, 0),
        remark: r.remark || '',
        publisherUsername: pub, publisherCompany: coOf(pub, r.publisherCompany),
        canContact: !!pub && pub !== me,
      } } });
      return;
    }
    // 商机市场已迁独立库：详情同样经服务层取（库存按查看方白名单剥离，canViewInventory 标记下发）
    const allRows = await listDecoratedListings(user.username);
    const r = allRows.find((x: any) => String(x.id || x.key || '') === id
      && (type === 'finished' ? x.type === 'finished' : x.type !== 'finished'));
    if (!r || r.delisted === true) { res.status(404).json({ code: 404, message: '该商品已下架或不存在' }); return; }
    const pub = pubOf(r);
    const isMine = !!pub && pub === me;
    // 库存可见性：发布方本人恒可见；其余须命中供应商的库存同步设置白名单（服务端已剥离未授权库存）
    const canViewInventory = r.canViewInventory !== false || isMine;
    const variants = (Array.isArray(r.variants) ? r.variants : []).map((v: any) => ({
      color: v.color || '', spec: v.spec || '', productCode: v.productCode || '',
      unitPrice: Number(v.suggestedPrice) || 0, stock: canViewInventory ? (Number(v.actualStock) || 0) : -1, status: v.productStatus || '',
    }));
    const variantImages = (Array.isArray(r.variantImages) ? r.variantImages : [])
      .map((e: any) => ({ color: e.color || '', src: keepImage(e.src || e.image) }))
      .filter((e: any) => e.src);
    const quotes = (Array.isArray(r.quotes) ? r.quotes : []).map((q: any) => ({
      company: coOf(String(q.bidderUsername || ''), q.bidderCompany),
      unitPrice: Number(q.unitPrice) || 0, totalPrice: Number(q.totalPrice) || 0,
      quantity: Number(q.quantity) || 0, deliveryDays: Number(q.deliveryDays) || 0,
      contactPerson: q.contactPerson || '', contactPhone: q.contactPhone || '',
      time: day10(q.quoteTime), status: q.status || '',
    }));
    const images = (Array.isArray(r.images) ? r.images.map(keepImage) : [keepImage(r.image)])
      .concat(variantImages.map((e: any) => e.src)).filter(Boolean);
    res.json({ code: 200, data: { detail: {
      id, type: r.type || type, shortName: r.shortName || '', styleCode: r.styleCode || '',
      productCode: r.productCode || '', unit: r.unit || '件',
      quantity: canViewInventory ? (Number(r.quantity) || 0) : -1, targetPrice: Number(r.targetPrice) || 0,
      status: r.status || '', deadline: day10(r.deadline), auto: r.auto === true,
      processTypes: Array.isArray(r.processTypes) ? r.processTypes : [],
      deposit: Number(r.deposit) || 0, depositStatus: r.depositStatus || '',
      remark: r.remark || '', publishTime: day10(r.publishTime),
      shoeUpper: r.shoeUpper || '', shoeSole: r.shoeSole || '',
      images: Array.from(new Set(images)),
      variants, quoteCount: quotes.length,
      // 报价记录仅发包市场有意义；公司名/联系人对所有查看者统一脱敏（同 Web maskName），
      // 联系方式一律不下发（联系走站内会话）；价格仅发布方本人看全量，其余掩码为 -1
      quotes: type === 'semi' ? quotes.map((q: any) => (isMine ? q : ({
        ...q, company: maskName(q.company), contactPerson: maskName(q.contactPerson), contactPhone: '', unitPrice: -1, totalPrice: -1,
      }))) : [],
      isMine,
      canViewInventory,
      totalStock: canViewInventory ? (variants.reduce((s: number, v: any) => s + Math.max(0, v.stock), 0) || Number(r.quantity) || 0) : -1,
      publisherUsername: pub, publisherCompany: coOf(pub, r.publisherCompany),
      canContact: !!pub && pub !== me,
    } } });
  } catch (err: any) {
    console.error('[wx] market detail error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/market/:id/quote —— 加工厂对发包单提交报价（与 Web 同口径：同单允许多厂报价，同厂重复报价覆盖自身那条）
 *  写入独立库 market_listings 目标行的 quotes[]（单行读改写，不再整键覆盖）；待报价首报后流转为报价中 */
router.post('/market/:id/quote', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const me = await ownerOf(user.username);
    const id = String(req.params.id || '');
    const unitPrice = Number(req.body?.unitPrice);
    if (!id || !(unitPrice > 0)) { res.status(400).json({ code: 400, message: '请填写有效的报价单价' }); return; }
    const companies = await companyMap();
    const rows = await listDecoratedListings(user.username);
    const r = rows.find((x: any) => String(x.id || x.key || '') === id && x.type !== 'finished');
    if (!r || r.delisted === true) { res.status(404).json({ code: 404, message: '该发包单已下架或不存在' }); return; }
    if (r.status === '已中标' || r.status === '已关闭') { res.status(400).json({ code: 400, message: `该发包单${r.status}，不可报价` }); return; }
    const mine: any = {
      key: `q_${me}_${Date.now()}`,
      bidderUsername: me, bidderCompany: companies[me] || me,
      factoryUsername: me, factoryCompany: companies[me] || me,
      unitPrice, totalPrice: Number(req.body?.totalPrice) || unitPrice * (Number(r.quantity) || 1),
      quantity: Number(r.quantity) || 0, deliveryDays: Number(req.body?.deliveryDays) || 0,
      contactPerson: String(req.body?.contactPerson || ''), contactPhone: String(req.body?.contactPhone || ''),
      remark: String(req.body?.remark || ''), quoteTime: new Date().toISOString(), status: '待确认',
    };
    const result = await mergeQuote(String(r.key || ''), mine);
    if (!result.ok) { res.status(400).json({ code: 400, message: result.message || '报价失败' }); return; }
    res.json({ code: 200, data: { saved: true, quoteCount: result.quoteCount } });
  } catch (err: any) {
    console.error('[wx] market quote error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 仓库统计手机录入（与 Web WarehouseStatsPage 同口径） ============

/** POST /api/wx/ws/:kind —— kind=stock|pick|urgent|note；工资派生与 Web 保存同公式（数量×材质工价） */
router.post('/ws/:kind', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const kind = String(req.params.kind || '');
    const name = await displayNameOf(user.username);
    const ymd = localYmd();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dateOf = (v: any): string => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ymd);
    if (kind === 'note') {
      const type = req.body.type === 'punishment' ? 'punishment' : 'reward';
      const note = String(req.body.note || '').trim();
      const person = String(req.body.person || '').trim();
      const amount = Number(req.body.amount);
      if (!note || !person || !(amount > 0)) {
        res.status(400).json({ code: 400, message: '备注内容/人员/金额(>0)为必填' });
        return;
      }
      const date = dateOf(req.body.date);
      const dsKey = `ws_note_${owner}`;
      const rows = await readRows(dsKey);
      const rec: any = { key: `NT-${suffix}`, note, person, amount, date, month: date.slice(0, 7), type };
      await writeRows(dsKey, [rec, ...rows], owner);
      res.json({ code: 200, data: { saved: true, record: rec } });
      return;
    }
    if (kind === 'pick') {
      const orderNo = String(req.body.orderNo || '').trim();
      const qty = Number(req.body.quantity);
      if (!orderNo || !(qty > 0)) {
        res.status(400).json({ code: 400, message: '内部单号/数量(>0)为必填' });
        return;
      }
      const dsKey = `ws_pick_${owner}`;
      const rows = await readRows(dsKey);
      // 配货统一工价：与 Web 同口径取工价表第一条
      const rates = await readRows(`ws_pickWage_${owner}`);
      const unifiedRate = Number(rates[0]?.rate) || 0;
      const month = /^\d{4}-\d{2}$/.test(String(req.body.month || '')) ? String(req.body.month) : ymd.slice(0, 7);
      const rec: any = {
        key: `PK-${suffix}`, orderNo, quantity: qty,
        priceRate: unifiedRate, wage: qty * unifiedRate, material: '', image: '',
        createdAt: ymd, creator: name,
        picker: String(req.body.picker || '').trim() || name,
        month,
      };
      await writeRows(dsKey, [rec, ...rows], owner);
      res.json({ code: 200, data: { saved: true, record: rec } });
      return;
    }
    if (kind === 'stock' || kind === 'urgent') {
      const orderNo = String(req.body.orderNo || '').trim();
      const qty = Number(req.body.quantity);
      if (!orderNo || !(qty > 0)) {
        res.status(400).json({ code: 400, message: '内部单号/数量(>0)为必填' });
        return;
      }
      const dsKey = kind === 'stock' ? `ws_stock_${owner}` : `ws_urgent_${owner}`;
      const rows = await readRows(dsKey);
      // 急采内部单号查重（与 Web 新增守卫同口径）
      if (kind === 'urgent' && rows.some((r: any) => String(r.orderNo || '') === orderNo)) {
        res.status(409).json({ code: 409, message: `内部单号 ${orderNo} 已存在，不能重复新增` });
        return;
      }
      const date = dateOf(req.body.date);
      const material = String(req.body.material || '').trim();
      const rates = await readRows(kind === 'stock' ? `ws_wage_${owner}` : `ws_urgentWage_${owner}`);
      const rateRow = rates.find((r: any) => String(r.material || '') === material);
      const rate = Number(rateRow?.rate) || 0;
      const packRate = Number(rateRow?.packRate) || 0;
      const teamRate = Number(rateRow?.teamRate) || 0;
      // 人员默认：质检员默认当前用户，打包员/外贸组长取首条分组（与 Web 新建默认同口径）
      const groups = await readRows(`ws_group_${owner}`);
      const g0 = groups[0] || {};
      const inspector = String(req.body.inspector || '').trim() || name;
      const packer = String(req.body.packer || '').trim() || String(g0.packer || '');
      const foreignTeam = String(req.body.foreignTeam || '').trim() || String(g0.foreignTeam || '');
      const grp = groups.find((g: any) => g && g.inspector === inspector) || {};
      const rec: any = {
        key: `${kind === 'stock' ? 'WS' : 'UG'}-${suffix}`,
        orderNo, quantity: qty, material,
        productCode: String(req.body.productCode || '').trim(),
        priceRate: rate, packWage: qty * packRate, commission: qty * teamRate,
        packer, foreignTeam,
        remark: String(req.body.remark || '').trim(),
        image: String(req.body.image || '').trim(),
        creator: name, lastEditor: name, lastEditTime: new Date().toISOString(),
        date, month: date.slice(0, 7),
      };
      if (kind === 'stock') {
        rec.qcWage = qty * rate;
        rec.qcInspector = inspector;
        rec.person = String(req.body.person || '').trim() || name;
      } else {
        rec.wage = qty * rate;
        rec.qcDate = date;
        rec.inspector = inspector;
        rec.inspectorId = String(req.body.inspectorId || '').trim() || String(grp.inspectorId || '');
        rec.isDuplicate = false;
      }
      await writeRows(dsKey, [rec, ...rows], owner);
      res.json({ code: 200, data: { saved: true, record: rec } });
      return;
    }
    res.status(404).json({ code: 404, message: '未知录入类型' });
  } catch (err: any) {
    console.error('[wx] ws create error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

const WS_KINDS = ['stock', 'pick', 'urgent', 'note'];

/** GET /api/wx/ws/:kind/:key —— 手机详情：回传该记录的原始字段（工资类为已派生值，与 Web 同结构） */
router.get('/ws/:kind/:key', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const name = await displayNameOf(user.username);
    const kind = String(req.params.kind || '');
    if (!WS_KINDS.includes(kind)) {
      res.status(404).json({ code: 404, message: '未知记录类型' });
      return;
    }
    const rows = await readRows(`ws_${kind}_${owner}`);
    const rec = rows.find((r: any) => String(r.key || '') === String(req.params.key || ''));
    if (!rec) {
      res.status(404).json({ code: 404, message: '记录不存在' });
      return;
    }
    // 查看闸（与 Web 非负责人仅见本人记录同源）；奖惩为配置类页签不受负责人过滤
    if (kind !== 'note' && !(await wsCanViewAll(owner, user.username)) && String(rec.creator || '') !== name) {
      res.status(403).json({ code: 403, message: '无权限查看该记录（非负责人仅见本人记录）' });
      return;
    }
    res.json({ code: 200, data: { record: rec } });
  } catch (err: any) {
    console.error('[wx] ws detail error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** PUT /api/wx/ws/:kind/:key —— 手机编辑：只改可录入字段，工资/月份按 Web 保存同公式重新派生 */
router.put('/ws/:kind/:key', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const kind = String(req.params.kind || '');
    if (!WS_KINDS.includes(kind)) {
      res.status(404).json({ code: 404, message: '未知记录类型' });
      return;
    }
    const name = await displayNameOf(user.username);
    const dsKey = `ws_${kind}_${owner}`;
    const rows = await readRows(dsKey);
    const idx = rows.findIndex((r: any) => String(r.key || '') === String(req.params.key || ''));
    if (idx < 0) {
      res.status(404).json({ code: 404, message: '记录不存在' });
      return;
    }
    const rec: any = { ...rows[idx] };
    // 编辑闸（与 Web canModify 同源）：创建人本人或编辑负责人（管理员豁免）；奖惩为配置类页签不闸
    if (kind !== 'note') {
      if (!(await wsCanViewAll(owner, user.username)) && String(rec.creator || '') !== name) {
        res.status(403).json({ code: 403, message: '无权限查看该记录（非负责人仅见本人记录）' });
        return;
      }
      const canModify = (await wsCanEditAll(owner, user.username)) || String(rec.creator || '') === name;
      if (!canModify) {
        res.status(403).json({ code: 403, message: '无权限编辑该记录（仅创建人或编辑负责人可改）' });
        return;
      }
    }
    const str = (k: string) => String(req.body[k] || '').trim();
    const has = (k: string) => req.body[k] !== undefined;
    if (kind === 'note') {
      if (has('person')) rec.person = str('person');
      if (has('note')) rec.note = str('note');
      if (has('amount')) rec.amount = Number(req.body.amount) || 0;
      if (has('type')) rec.type = req.body.type === 'punishment' ? 'punishment' : 'reward';
      if (has('date') && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date))) {
        rec.date = String(req.body.date);
        rec.month = rec.date.slice(0, 7);
      }
      if (!rec.person || !rec.note || !(Number(rec.amount) > 0)) {
        res.status(400).json({ code: 400, message: '人员/备注内容/金额(>0)为必填' });
        return;
      }
    } else if (kind === 'pick') {
      if (has('orderNo')) rec.orderNo = str('orderNo');
      if (has('quantity')) rec.quantity = Number(req.body.quantity) || 0;
      if (has('picker')) rec.picker = str('picker');
      if (has('month') && /^\d{4}-\d{2}$/.test(String(req.body.month))) rec.month = String(req.body.month);
      if (!rec.orderNo || !(Number(rec.quantity) > 0)) {
        res.status(400).json({ code: 400, message: '内部单号/数量(>0)为必填' });
        return;
      }
      // 配货统一工价：与 Web 保存同口径取工价表第一条重算计件工资
      const rates = await readRows(`ws_pickWage_${owner}`);
      const unifiedRate = Number(rates[0]?.rate) || 0;
      rec.priceRate = unifiedRate;
      rec.wage = (Number(rec.quantity) || 0) * unifiedRate;
    } else {
      // 备货/急采：质检员字段名不同（stock=qcInspector，urgent=inspector），工价一律按材质重查
      if (has('orderNo')) rec.orderNo = str('orderNo');
      if (has('quantity')) rec.quantity = Number(req.body.quantity) || 0;
      if (has('material')) rec.material = str('material');
      if (has('productCode')) rec.productCode = str('productCode');
      if (has('remark')) rec.remark = str('remark');
      if (has('image')) rec.image = str('image');
      if (has('packer')) rec.packer = str('packer');
      if (has('foreignTeam')) rec.foreignTeam = str('foreignTeam');
      if (has('inspector')) {
        if (kind === 'stock') rec.qcInspector = str('inspector');
        else rec.inspector = str('inspector');
      }
      if (has('date') && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date))) {
        rec.date = String(req.body.date);
        rec.month = rec.date.slice(0, 7);
        if (kind === 'urgent') rec.qcDate = rec.date;
      }
      if (!rec.orderNo || !(Number(rec.quantity) > 0)) {
        res.status(400).json({ code: 400, message: '内部单号/数量(>0)为必填' });
        return;
      }
      if (kind === 'urgent' && rows.some((r: any) => String(r.key || '') !== String(rec.key || '') && String(r.orderNo || '') === String(rec.orderNo))) {
        res.status(409).json({ code: 409, message: `内部单号 ${rec.orderNo} 已存在，不能重复` });
        return;
      }
      const rates = await readRows(kind === 'stock' ? `ws_wage_${owner}` : `ws_urgentWage_${owner}`);
      const rateRow: any = rates.find((r: any) => String(r.material || '') === String(rec.material || '')) || {};
      const qty = Number(rec.quantity) || 0;
      rec.priceRate = Number(rateRow.rate) || 0;
      if (kind === 'stock') rec.qcWage = qty * rec.priceRate;
      else rec.wage = qty * rec.priceRate;
      rec.packWage = qty * (Number(rateRow.packRate) || 0);
      rec.commission = qty * (Number(rateRow.teamRate) || 0);
      if (kind === 'urgent') {
        const groups = await readRows(`ws_group_${owner}`);
        const grp: any = groups.find((g: any) => g && g.inspector === rec.inspector) || {};
        rec.inspectorId = String(grp.inspectorId || rec.inspectorId || '');
      }
    }
    rec.lastEditor = name;
    rec.lastEditTime = new Date().toISOString();
    const next = [...rows];
    next[idx] = rec;
    await writeRows(dsKey, next, owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] ws update error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/newstyle —— 新款进度主表单手机录入（与 Web 新增新款弹窗同字段同派生口径） */
router.post('/newstyle', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const name = await displayNameOf(user.username);
    const styleCode = String(req.body.styleCode || '').trim();
    if (!styleCode) {
      res.status(400).json({ code: 400, message: '货号为必填' });
      return;
    }
    const dsKey = `newstyle_progress_${owner}`;
    const rows = await readRows(dsKey);
    // 派生字段与 Web handleSave 新增分支同口径：状态类默认值 + 创建日今天 + 创建人当前用户
    const rec: any = {
      key: `ns-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      styleCode,
      image: String(req.body.image || ''),
      costPrice: Number(req.body.costPrice) || 0,
      craft: String(req.body.craft || '').trim(),
      color: String(req.body.color || '').trim(),
      sizeRange: String(req.body.sizeRange || '').trim(),
      factory: String(req.body.factory || '').trim(),
      brand: String(req.body.brand || '').trim(),
      photoThenList: String(req.body.photoThenList || '').trim(),
      photoPlace: '', jstImported: false,
      createdAt: localYmd(),
      photoRecvDate: '', photoRecvStatus: '未收到', photoPlanDate: '',
      arrivalStatus: '未到货', arrivalDate: '', returnDate: '',
      platforms: [], listPlanDate: '', listDoneDate: '',
      remark: String(req.body.remark || '').trim(),
      creator: name,
    };
    await writeRows(dsKey, [rec, ...rows], owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] newstyle create error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/ws-materials/:kind —— 材质下拉候选：工价表材质 ∪ 已有记录材质去重（与 Web 材质下拉同源） */
router.get('/ws-materials/:kind', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const kind = String(req.params.kind || '');
    const wageKey = kind === 'urgent' ? `ws_urgentWage_${owner}` : `ws_wage_${owner}`;
    const recKey = kind === 'urgent' ? `ws_urgent_${owner}` : `ws_stock_${owner}`;
    const [wages, recs] = await Promise.all([readRows(wageKey), readRows(recKey)]);
    const materials = Array.from(new Set([
      ...wages.map((r: any) => String(r.material || '').trim()),
      ...recs.map((r: any) => String(r.material || '').trim()),
    ].filter(Boolean)));
    res.json({ code: 200, data: { materials } });
  } catch (err: any) {
    console.error('[wx] ws-materials error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/schedule-board?date= —— 生产排期看板：生产线×三班网格（与 Web ScheduleBoard 同键同口径） */
router.get('/schedule-board', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const schedMenu = await canViewMenus(user.username, ['production/production-schedule']);
    if (!schedMenu['production/production-schedule']) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : localYmd();
    // 生产线集合与 Web 同键；未配置时回退默认三条线（与 ScheduleBoard 初始化同口径）
    let lines = (await readRows(`production_schedule_lines_${owner}`)).map(String).filter(Boolean);
    if (!lines.length) lines = ['生产线1', '生产线2', '生产线3'];
    const shifts = [
      { key: 'morning', label: '上午', range: '08:00-12:00' },
      { key: 'afternoon', label: '下午', range: '13:00-17:00' },
      { key: 'evening', label: '晚上', range: '18:00-22:00' },
    ];
    const rows = await readRows(`pageData_production_production-schedule_${owner}`);
    const day = rows.filter((r: any) => String(r.startDate || '').slice(0, 10) === date);
    // 订单/加工/商品数据先读：排期格内「款式编码×数量」需按 productionOrderId 回查订单计划明细做款式前缀聚合
    const [poRows, procRows, products] = await Promise.all([
      readRows(`pageData_production_production-order_${owner}`),
      readRows(`pageData_production_processing-order_${owner}`),
      readRows(`pageData_basic-data_product-list_${owner}`),
    ]);
    const prefixOf = (code: any): string => {
      const s = String(code || '');
      const m = s.match(/^[^-]+(?:-[^-]+)*?(?=\s*-\s*[\u4e00-\u9fff])/);
      if (m) return m[0];
      const n = s.match(/^\d+/);
      return n ? n[0] : s;
    };
    // 款式前缀按生产单聚合（与订单卡 styleQty 同源正则）：排期格内改显示「款式编码×数量」替代生产单号
    const stylePrefixByPo = new Map<string, string>();
    poRows.forEach((r: any) => {
      const planItems: any[] = Array.isArray(r.planItems) ? r.planItems : [];
      const src = planItems.length ? planItems.map((it: any) => it.productCode || it.styleCode || '') : [r.styleCode || r.productCode || ''];
      const prefixes = Array.from(new Set(src.map(prefixOf).filter(Boolean)));
      if (prefixes.length) stylePrefixByPo.set(String(r.id || ''), prefixes.join('、'));
    });
    const cells: Record<string, { total: number; items: { no: string; qty: number }[] }> = {};
    lines.forEach(l => shifts.forEach(s => {
      const its = day.filter((r: any) => r.line === l && r.shift === s.key);
      cells[`${l}|${s.key}`] = {
        total: its.reduce((sum: number, r: any) => sum + (Number(r.planQty) || 0), 0),
        items: its.map((r: any) => ({ no: stylePrefixByPo.get(String(r.productionOrderId || '')) || String(r.productionOrderId || r.id || ''), qty: Number(r.planQty) || 0 })),
      };
    }));
    // 待产订单卡片（与 Web ScheduleBoard 左侧待排产面板同源）：PO 前缀 + 非完成/取消；
    // 模具编号按 productCode 回查商品主数据，半成品加工按 poId 聚合，款式编码 X 数量与 production 分支同聚合口径
    const scheduledByPo = new Map<string, number>();
    rows.forEach((r: any) => {
      const k = String(r.productionOrderId || '');
      if (k) scheduledByPo.set(k, (scheduledByPo.get(k) || 0) + (Number(r.planQty) || 0));
    });
    const stText: Record<string, string> = { pending: '待排产', processing: '生产中', completed: '已完成', cancelled: '已取消', warning: '异常' };
    const prodByCode = new Map(products.map((p: any) => [String(p.productCode || ''), p]));
    const orders = poRows
      .filter((r: any) => /^PO-/.test(String(r.id || '')) && !['completed', 'cancelled'].includes(String(r.status || '')))
      .map((r: any) => {
        const plan = Number(r.planQuantity ?? r.quantity ?? r.productionQty) || 0;
        const pending = Math.max(0, plan - (scheduledByPo.get(String(r.id)) || 0));
        const planItems: any[] = Array.isArray(r.planItems) ? r.planItems : [];
        const first: any = planItems[0] || {};
        const prod: any = prodByCode.get(String(first.productCode || r.productCode || '')) || {};
        const moldCode = String(prod.moldCode || first.moldCode || '');
        const qtyByStyle = new Map<string, number>();
        if (planItems.length) {
          planItems.forEach((it: any) => {
            const code = prefixOf(it.productCode || it.styleCode || '');
            if (!code) return;
            qtyByStyle.set(code, (qtyByStyle.get(code) || 0) + (Number(it.productionQty ?? it.quantity) || 0));
          });
        } else {
          const code = prefixOf(r.styleCode || r.productCode || '');
          if (code) qtyByStyle.set(code, plan);
        }
        const styleQty = Array.from(qtyByStyle.entries()).map(([c, q]) => `${c} X ${q}`).join('、');
        const semis = procRows.filter((p: any) => String(p.poId || '') === String(r.id));
        const semiDone = semis.filter((p: any) => String(p.status || '') === 'completed').length;
        const semiText = semis.length ? `${semiDone}/${semis.length} 完成` : '未生成加工单';
        // 排期记录与派生状态：有排期记录即「已排产」，修复「排过仍显示待排产」
        const mySched = rows.filter((r0: any) => String(r0.productionOrderId || '') === String(r.id));
        return {
          id: String(r.id), moldCode, styleQty,
          image: String(first.image || prod.image || ''),
          productName: String(first.productName || prod.shortName || r.productName || ''),
          planQty: plan, pending, semiText,
          scheduledQty: scheduledByPo.get(String(r.id)) || 0,
          statusText: mySched.length ? '已排产' : '待排产',
          schedules: mySched.map((r0: any) => ({
            key: String(r0.key || ''), id: String(r0.id || ''), line: String(r0.line || ''),
            shift: String(r0.shift || ''), startDate: day10(r0.startDate), planQty: Number(r0.planQty) || 0,
          })),
          fields: [
            ['生产单号', String(r.id)],
            ['状态', stText[String(r.status || '')] || pick(r.status, '—')],
            ['客户', pick(r.customerName, '—')],
            ['计划数量', String(plan)],
            ['待排', String(pending)],
            ['模具编号', moldCode || '—'],
            ['款式编码', styleQty || '—'],
            ['计划完工', day10(pick(r.planEnd, r.endDate, '')) || '—'],
            ['负责人', pick(r.person, '—')],
            ['半成品加工', semiText],
          ] as [string, string][],
        };
      })
      .filter((o: any) => !['completed', 'cancelled'].includes(o.statusText === '已排产' ? '' : ''));
    // 注：不再按 pending>0 过滤——待排产区由小程序客户端筛 pending>0，下方全量列表含已排产订单供搜索/改排期
    res.json({
      code: 200,
      data: {
        date, lines, shifts, cells, orders,
        dayTotal: day.reduce((s: number, r: any) => s + (Number(r.planQty) || 0), 0),
      },
    });
  } catch (err: any) {
    console.error('[wx] schedule-board error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/schedule —— 手机排期登记：与 Web ScheduleBoard 拖拽落库同源码同键（PS-YYYYMMDD-NN 编号 + shift 字段 + 待排量钳制） */
router.post('/schedule', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const schedMenu = await canViewMenus(user.username, ['production/production-schedule']);
    if (!schedMenu['production/production-schedule']) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const poId = String(req.body.productionOrderId || '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date || '')) ? String(req.body.date) : localYmd();
    const line = String(req.body.line || '').trim();
    const shift = String(req.body.shift || '').trim();
    const qty = Number(req.body.qty);
    if (!poId || !line || !['morning', 'afternoon', 'evening'].includes(shift) || !(qty > 0)) {
      res.status(400).json({ code: 400, message: '订单/生产线/班次/数量(>0)为必填' });
      return;
    }
    const scKey = `pageData_production_production-schedule_${owner}`;
    const [omRows, scRows] = await Promise.all([
      readRows(`pageData_production_production-order_${owner}`),
      readRows(scKey),
    ]);
    const order = omRows.find((o: any) => String(o.id || '') === poId);
    if (!order) { res.status(404).json({ code: 404, message: '生产订单不存在' }); return; }
    const plan = Number(order.planQuantity ?? order.quantity ?? order.productionQty) || 0;
    const scheduled = scRows.filter((r: any) => String(r.productionOrderId || '') === poId)
      .reduce((s: number, r: any) => s + (Number(r.planQty) || 0), 0);
    const pending = Math.max(0, plan - scheduled);
    if (qty > pending) { res.status(400).json({ code: 400, message: `超出剩余可排数量（${pending}）` }); return; }
    // 编号与 Web genScheduleNo 同源：PS-YYYYMMDD-NN 顺序补位
    const prefix = `PS-${date.replace(/-/g, '')}`;
    const used = new Set(scRows.map((r: any) => String(r.id || '')).filter((v: string) => v.startsWith(prefix)));
    let n = used.size + 1;
    let no = `${prefix}-${String(n).padStart(2, '0')}`;
    while (used.has(no)) { n += 1; no = `${prefix}-${String(n).padStart(2, '0')}`; }
    const rec: any = {
      key: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      id: no, productionOrderId: poId, salesOrderId: order.salesOrderId || '',
      productName: order.productName || '', customerName: order.customerName || '',
      planQty: qty, line, shift, startDate: date, endDate: date,
      person: order.person || '', status: 'pending', createTime: new Date().toLocaleString('zh-CN'),
    };
    await writeRows(scKey, [rec, ...scRows], owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] schedule create error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** PUT /api/wx/schedule/:key —— 手机修改排期：与新增同闸同钳制（可排量 = 计划 − 同单其他排期记录合计） */
router.put('/schedule/:key', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const schedMenu = await canViewMenus(user.username, ['production/production-schedule']);
    if (!schedMenu['production/production-schedule']) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const scKey = `pageData_production_production-schedule_${owner}`;
    const rows = await readRows(scKey);
    const idx = rows.findIndex((r: any) => String(r.key || '') === String(req.params.key || ''));
    if (idx < 0) { res.status(404).json({ code: 404, message: '排期记录不存在' }); return; }
    const rec: any = { ...rows[idx] };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date || '')) ? String(req.body.date) : day10(pick(rec.startDate, ''));
    const line = String(req.body.line || rec.line || '').trim();
    const shift = ['morning', 'afternoon', 'evening'].includes(String(req.body.shift || '')) ? String(req.body.shift) : String(rec.shift || '');
    const qty = Number(req.body.qty);
    if (!line || !shift || !date) { res.status(400).json({ code: 400, message: '日期/生产线/班次不合法' }); return; }
    const [omRows] = await Promise.all([readRows(`pageData_production_production-order_${owner}`)]);
    const order = omRows.find((o: any) => String(o.id || '') === String(rec.productionOrderId || ''));
    const plan = order ? (Number(order.planQuantity ?? order.quantity ?? order.productionQty) || 0) : 0;
    const others = rows.filter((r: any, i: number) => i !== idx && String(r.productionOrderId || '') === String(rec.productionOrderId || ''))
      .reduce((s: number, r: any) => s + (Number(r.planQty) || 0), 0);
    const cap = Math.max(0, plan - others);
    if (!(qty > 0) || qty > cap) { res.status(400).json({ code: 400, message: `排期数量需在 1~${cap} 之间` }); return; }
    rec.startDate = date; rec.endDate = date; rec.line = line; rec.shift = shift; rec.planQty = qty;
    const next = rows.map((r: any, i: number) => (i === idx ? rec : r));
    await writeRows(scKey, next, owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] schedule update error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 上下班打卡（与 Web AttendancePage 同库同口径：hr_attendance_<owner>） ============

const hmMin = (t: string): number => {
  const [h, m] = String(t || '0:0').split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
};
/** 工时与 Web calcWorkHours 同公式：(out-in)/60 保留一位小数 */
function workHoursOf(inT: string | null, outT: string | null): number {
  if (!inT || !outT) return 0;
  return Math.max(0, Math.round((hmMin(outT) - hmMin(inT)) / 60 * 10) / 10);
}
/** 状态与 Web calcStatus 同口径：默认班次 startTime/endTime + lateThreshold */
function attendanceStatusOf(inT: string | null, outT: string | null, shift: any): string {
  if (!inT && !outT) return 'absent';
  const threshold = Number(shift?.lateThreshold) || 0;
  if (inT && hmMin(inT) > hmMin(String(shift?.startTime || '08:00')) + threshold) return 'late';
  if (outT && hmMin(outT) < hmMin(String(shift?.endTime || '17:30')) - threshold) return 'early';
  return 'normal';
}
/** 下发给小程序的精简形状（in/out 语义不变） */
function toMiniAttendance(rec: any) {
  if (!rec) return null;
  return {
    key: rec.key, username: rec.employeeUsername, name: rec.employeeName,
    date: rec.date, in: rec.clockIn || '', out: rec.clockOut || '',
  };
}

/** GET /api/wx/attendance —— 本人今日打卡记录 */
router.get('/attendance', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const ymd = localYmd();
    const rows = await readRows(`hr_attendance_${owner}`);
    const rec = rows.find((r: any) => r.employeeUsername === user.username && r.date === ymd) || null;
    res.json({ code: 200, data: { record: toMiniAttendance(rec), date: ymd } });
  } catch (err: any) {
    console.error('[wx] attendance get error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/attendance {type:'in'|'out'} —— 上班取首次、下班取最新；落库字段与 Web 逐字段同名，source='wechat' */
router.post('/attendance', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const type = req.body.type === 'out' ? 'out' : 'in';
    const dsKey = `hr_attendance_${owner}`;
    const rows = await readRows(dsKey);
    const ymd = localYmd();
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const hm = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    let rec = rows.find((r: any) => r.employeeUsername === user.username && r.date === ymd);
    if (!rec) {
      rec = {
        key: `${user.username}-${ymd}`, date: ymd,
        employeeUsername: user.username, employeeName: await displayNameOf(user.username),
        clockIn: null, clockOut: null, workHours: 0, status: 'normal',
        source: 'wechat', remark: '',
      };
      rows.unshift(rec);
    }
    if (type === 'in') { if (!rec.clockIn) rec.clockIn = hm; }
    else { rec.clockOut = hm; }
    // 班次取默认班（与 Web defaultShift 同口径），微信打卡同样参与迟到/早退判定与工时计算
    const shifts = await readRows(`hr_shifts_${owner}`);
    const shift = shifts.find((s: any) => s && s.isDefault) || shifts[0] || null;
    rec.workHours = workHoursOf(rec.clockIn, rec.clockOut);
    rec.status = attendanceStatusOf(rec.clockIn, rec.clockOut, shift);
    rec.source = 'wechat';
    await writeRows(dsKey, rows, owner);
    res.json({ code: 200, data: { saved: true, record: toMiniAttendance(rec) } });
  } catch (err: any) {
    console.error('[wx] attendance post error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 请假管理（与 Web LeavePage 同口径：hr_leaves_<owner>） ============

/** GET /api/wx/leaves?tab=mine|pending|all */
router.get('/leaves', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const tab = String(req.query.tab || 'mine');
    let rows = await readRows(`hr_leaves_${owner}`);
    if (tab === 'mine') rows = rows.filter((r: any) => r.employeeUsername === user.username);
    else if (tab === 'pending') rows = rows.filter((r: any) => r.status === 'pending');
    res.json({ code: 200, data: { list: rows.slice(0, 100) } });
  } catch (err: any) {
    console.error('[wx] leaves get error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/leaves {type, startDate, endDate, reason?} —— 本人请假申请 */
router.post('/leaves', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const type = String(req.body.type || '').trim();
    const startDate = String(req.body.startDate || '');
    const endDate = String(req.body.endDate || '');
    if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      res.status(400).json({ code: 400, message: '请假类型/开始日期/结束日期为必填' });
      return;
    }
    const days = Number(req.body.days) || Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    if (!(days > 0)) {
      res.status(400).json({ code: 400, message: '结束日期不能早于开始日期' });
      return;
    }
    const dsKey = `hr_leaves_${owner}`;
    const rows = await readRows(dsKey);
    const rec: any = {
      key: `leave_${Date.now()}`,
      employeeUsername: user.username,
      employeeName: await displayNameOf(user.username),
      type, startDate, endDate, days,
      reason: String(req.body.reason || ''),
      status: 'pending', approvedBy: '', approvedAt: '',
      createdAt: new Date().toISOString(),
    };
    await writeRows(dsKey, [rec, ...rows], owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] leave create error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/leaves/:key/audit {approved, rejectReason?} —— 审批写入字段与 Web 逐字段同名；拒绝必须带原因 */
router.post('/leaves/:key/audit', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const approved = req.body.approved === true;
    const rejectReason = String(req.body.rejectReason || '').trim();
    if (!approved && !rejectReason) {
      res.status(400).json({ code: 400, message: '拒绝时必须填写拒绝原因' });
      return;
    }
    const dsKey = `hr_leaves_${owner}`;
    const rows = await readRows(dsKey);
    const rec = rows.find((r: any) => String(r.key) === req.params.key);
    if (!rec) { res.status(404).json({ code: 404, message: '请假单不存在或已删除' }); return; }
    if (rec.status !== 'pending') { res.status(409).json({ code: 409, message: '该请假单已审批' }); return; }
    rec.status = approved ? 'approved' : 'rejected';
    rec.approvedBy = user.username;
    rec.approvedAt = new Date().toISOString();
    // 与 Web LeavePage 同一字段名 rejectReason：拒绝写原因，通过则清空旧值避免脏数据
    rec.rejectReason = approved ? '' : rejectReason;
    await writeRows(dsKey, rows, owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] leave audit error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 通用列表（只读，与 Web 各页同源同字段口径） ============

interface ListItem { key: string; title: string; sub: string[]; tag?: string; tone?: string; amount?: number; row?: string[]; fields?: [string, string][]; subSizes?: number[]; subRight?: string }

/** 取第一个非空值作为展示文本 */
function pick(...vals: any[]): string {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  return '';
}

/** 状态标签默认配色：完成类绿、待办/逾期类橙、否定类红、其余蓝 */
function toneOf(tag?: string): string {
  const t = String(tag || '');
  if (!t) return 'gray';
  if (/拒绝|取消|离职|失败|逾期/.test(t)) return 'red';
  if (/待|未/.test(t)) return 'orange';
  if (/已|通过|在职|正常|完善/.test(t)) return 'green';
  return 'blue';
}

/** 关键字过滤 + 截断（标题/副行/标签参与匹配） */
function finishList(items: ListItem[], q: string, limit = 100): { list: ListItem[]; total: number } {
  const kw = q.trim().toLowerCase();
  const hit = kw
    ? items.filter(it => `${it.title} ${(it.sub || []).join(' ')} ${it.tag || ''}`.toLowerCase().includes(kw))
    : items;
  return { list: hit.slice(0, limit), total: hit.length };
}

const day10 = (v: any): string => pick(v).slice(0, 10);

/** /wx/lists 页 → Web 菜单点映射（仅登记两端语义明确的页；purchase 等两端语义分歧的页暂不登记） */
const LIST_MENU_KEYS: Record<string, string> = {
  production: 'production/production-order',
  'processing-order': 'production/processing-order',
  'workflow-templates': 'production/workflow-templates',
  'production-schedule': 'production/production-schedule',
};

/** GET /api/wx/menus —— 菜单点可见性（Web PERM_V2 菜单点链路服务端复算，供小程序菜单栏过滤） */
router.get('/menus', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const perms = await canViewMenus(user.username, WX_MENU_KEYS);
    res.json({ code: 200, data: { perms } });
  } catch (err: any) {
    console.error('[wx] menus error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 打单拣货（订单派生视图 + 立即发货 / 缺货拆分，与 Web ModuleChildPage 同口径） ============

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** 原始货品明细（保留全部字段，仅按需覆盖 quantity）；解析口径与 Web parseOrderItems 一致 */
function rawItems(order: any): any[] {
  try {
    const raw = typeof order?.orderItems === 'string' ? JSON.parse(order.orderItems || '[]')
      : (Array.isArray(order?.orderItems) ? order.orderItems : []);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
const itemQty = (it: any): number => Number(it?.quantity) || 0;
const itemPrice = (it: any): number => Number(it?.price ?? it?.unitPrice) || 0;
const itemCode = (it: any): string => String(it?.productCode || it?.styleCode || '');
const itemsDetailStr = (its: any[]): string => its.map((it: any) => `${it.shortName || it.productName || it.productCode || ''}${it.color ? '-' + it.color : ''}${it.spec ? '-' + it.spec : ''}×${itemQty(it)}`).join('，');
const itemsTotalQty = (its: any[]): number => its.reduce((s: number, it: any) => s + itemQty(it), 0);

/** 款式编码前缀：剥掉「-颜色-规格」尾段（6851-黑色-38 → 6851），口径与 Web ScheduleBoard / OrdersEmbed 一致 */
function stylePrefixOf(raw: any): string {
  const s = String(raw || '');
  const m = s.match(/^[^-]+(?:-[^-]+)*?(?=\s*-\s*[\u4e00-\u9fff])/);
  if (m) return m[0];
  const numOnly = s.match(/^\d+/);
  return numOnly ? numOnly[0] : s;
}

/** 款式编码×汇总数量：按款式前缀（无款式则退商品编码前缀）合并求和，多款式以空格分隔 */
function styleQtyOf(items: any[]): string {
  const map = new Map<string, number>();
  items.forEach((it: any) => {
    const code = stylePrefixOf(it.styleCode || it.productCode) || '—';
    map.set(code, round2((map.get(code) || 0) + itemQty(it)));
  });
  return Array.from(map.entries()).map(([c, q]) => `${c}×${q}`).join('  ');
}

/** GET /api/wx/picking?q= —— 打单拣货列表：与 Web「销售管理→打单拣货」同口径（已审核+已付款订单派生 + 遗留单只读）
 *  下发卡片三行所需字段：订单编号 / 出库单号 / 款式编码×汇总数量 / 收款人 + 收款人城市，并带货品明细供发货弹层使用 */
router.get('/picking', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const orderMenu = await canViewMenus(user.username, ['sales/order-manage']);
    if (!orderMenu['sales/order-manage']) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    const q = String(req.query.q || '').trim().toLowerCase();
    const [orderRows, legacyRows] = await Promise.all([
      readRows(`pageData_sales_order-manage_${owner}`),
      readRows(`pageData_sales_print-picking_legacy_${owner}`),
    ]);
    const pickRows = [
      ...orderRows.filter((r: any) => r.auditStatus === '已审核' && String(r.orderStatus || '').trim() === '已付款'),
      ...legacyRows.map((r: any) => ({ ...r, _legacy: true })),
    ];
    const timeOf = (r: any): string => pick(r.pickTime, r.createTime, r.createdAt);
    pickRows.sort((a: any, b: any) => timeOf(b).localeCompare(timeOf(a)));
    let list = pickRows.map((r: any) => {
      const items = rawItems(r);
      return {
        key: String(r.key || r.id || ''), id: pick(r.id, r.orderNo, r.key) || '—',
        outboundNo: pick(r.outboundNo, '') || '', styleQty: styleQtyOf(items),
        receiverName: pick(r.receiverName, r.person, ''), receiverCity: pick(r.city, ''),
        receiverPhone: pick(r.receiverPhone, r.phone, ''),
        receiverAddress: String(r.receiverAddress || '').trim()
          || [r.province, r.city, r.district, r.addressDetail || r.receiverDetail].filter(Boolean).map((s: any) => String(s).trim()).join(' '),
        customerName: pick(r.customerName, ''), orderStatus: r._legacy ? '遗留单' : pick(r.orderStatus, ''),
        printStatus: pick(r.printStatus, ''), legacy: !!r._legacy,
        shipImages: Array.isArray(r.shipImages) ? r.shipImages : [],
        totalQty: itemsTotalQty(items), productAmount: round2(Number(r.productAmount) || 0),
        items: items.map((it: any) => ({
          productCode: itemCode(it), shortName: String(it.shortName || it.productName || ''),
          styleCode: String(it.styleCode || ''), color: String(it.color || ''), spec: String(it.spec || ''),
          unit: String(it.unit || ''), quantity: itemQty(it), price: itemPrice(it),
        })),
      };
    });
    if (q) list = list.filter((it: any) => `${it.id} ${it.outboundNo} ${it.styleQty} ${it.receiverName} ${it.customerName}`.toLowerCase().includes(q));
    // 单页上限 20 条（用户指定）：total 仍为全量命中数供计数行展示
    res.json({ code: 200, data: { list: list.slice(0, 20), total: list.length } });
  } catch (err: any) {
    console.error('[wx] picking list error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/picking/:id/ship —— 立即发货（可改数量）：body.quantities 与订单货品明细顺序对齐，逐项钳制 0..原数量
 *  发货部分：生成销售出库单 + 扣减实际库存（出库日志留痕）+ 订单转「已完成」；
 *  若任一项发货数量 < 订单数量，对缺少部分即时缺货拆分：原单瘦身保留发货部分，拆出子单进入生产，
 *  子单订单号 = 原单号-序号、出库单号 = 原出库单号-序号（首次拆分即 -1），拆分金额分摊照抄 Web calcSplit */
router.post('/picking/:id/ship', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const id = String(req.params.id || '');
    const operator = await displayNameOf(user.username);
    const now = new Date().toLocaleString('zh-CN');
    const omKey = `pageData_sales_order-manage_${owner}`;
    const soKey = `sales_outbound_${owner}`;
    const prodKey = `pageData_basic-data_product-list_${owner}`;
    const stockLogKey = `stock_change_log_${owner}`;
    const [omList, soList, prodList, stockLogs, users, pushedOrders, tradeOrders] = await Promise.all([
      readRows(omKey), readRows(soKey), readRows(prodKey), readRows(stockLogKey),
      readRows('registeredUsers'), readRows('purchaser_pushed_orders'), readRows('market_trade_orders'),
    ]);
    const base = omList.find((o: any) => String(o.id) === id || String(o.key) === id);
    if (!base) { res.status(404).json({ code: 404, message: '订单不存在或已移出打单拣货' }); return; }
    const os = String(base.orderStatus || '').trim();
    if (os === '已发货' || os === '已完成' || os === '已取消') {
      res.status(400).json({ code: 400, message: `订单已${os}，不可重复发货` }); return;
    }
    const items = rawItems(base);
    if (!items.length) { res.status(400).json({ code: 400, message: '该订单无结构化货品明细，无法发货' }); return; }
    // 发货数量：与 items 顺序对齐，钳制 0..原数量（修改后不能大于订单数量）
    const reqQ = Array.isArray(req.body?.quantities) ? req.body.quantities : [];
    // 发货凭证图片：小程序侧已压缩并上传到图片空间，这里只存返回的 URL（限 9 张）
    const shipImages = (Array.isArray(req.body?.images) ? req.body.images : [])
      .filter((u: any) => typeof u === 'string' && u).slice(0, 9);
    const shipQtys = items.map((it: any, i: number) => {
      const v = Number(reqQ[i]);
      const q = Number.isFinite(v) ? v : itemQty(it);
      return Math.max(0, Math.min(round2(q), itemQty(it)));
    });
    if (!shipQtys.some(q => q > 0)) { res.status(400).json({ code: 400, message: '发货数量需大于 0' }); return; }
    const needSplit = items.some((it: any, i: number) => round2(itemQty(it) - shipQtys[i]) > 0);

    // 金额分摊（照抄 Web calcSplit：按商品金额逐行分摊、运费按比例、已付守恒）
    const freight = round2(Number(base.freight) || 0);
    const productAmt = round2(items.reduce((s: number, it: any) => s + itemPrice(it) * itemQty(it), 0));
    const oldTotalRaw = round2(Number(base.productAmount) || 0);
    const oldTotal = oldTotalRaw > 0 ? oldTotalRaw : round2(productAmt + freight);
    const paid = round2(Number(base.paidAmount) || 0);
    const shipAmt = round2(items.reduce((s: number, it: any, i: number) => s + itemPrice(it) * shipQtys[i], 0));
    const restAmt = round2(productAmt - shipAmt);
    const freightOrig = productAmt > 0 ? round2(freight * shipAmt / productAmt) : 0;
    const freightChild = round2(freight - freightOrig);
    const origTotal = round2(shipAmt + freightOrig);
    const childTotal = round2(oldTotal - origTotal);
    const linePaidShip = items.map((it: any, i: number) => {
      const qty = itemQty(it);
      const lineAmt = itemPrice(it) * qty;
      const linePaid = productAmt > 0 ? Math.round(paid * 100 * lineAmt / productAmt) / 100 : 0;
      return qty > 0 ? Math.round(linePaid * 100 * shipQtys[i] / qty) / 100 : 0;
    });
    let origPaid = round2(linePaidShip.reduce((s: number, x: number) => s + x, 0));
    let childPaid = round2(paid - origPaid);
    if (paid >= oldTotal - 0.01) { origPaid = origTotal; childPaid = childTotal; }

    // 出库单号：沿用订单审核时生成的 outboundNo（无则用订单号），与既有出库单冲突才重生成
    const genOutboundNo = (existing: string[]): string => {
      let prefix = '0000';
      const u = users.find((x: any) => x && x.username === owner);
      const digits = String(u?.orderPrefix || '').replace(/\D/g, '');
      if (digits) prefix = digits.padEnd(4, '0').slice(0, 4);
      const d = new Date();
      const head = `${prefix}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      let seq = 0;
      existing.forEach(s0 => { const s = String(s0 || ''); if (s.startsWith(head)) { const tail = s.slice(head.length); if (/^\d+$/.test(tail)) seq = Math.max(seq, parseInt(tail, 10)); } });
      return `${head}${seq + 1}`;
    };
    const docBase = String(base.outboundNo || base.id || '');
    const docNo = soList.some((s: any) => s.docNo === docBase) ? genOutboundNo(soList.map((s: any) => s.docNo)) : docBase;

    // 发货明细 + 扣减实际库存（出库日志留痕，允许扣成负数与 Web 强制发货同口径）
    const origItems = items.map((it: any, i: number) => ({ ...it, quantity: shipQtys[i] })).filter((it: any) => itemQty(it) > 0);
    const outItems = origItems.map((it: any) => {
      const prod = prodList.find((p: any) => p.productCode === itemCode(it));
      const before = Number(prod?.actualStock) || 0;
      const qty = itemQty(it);
      const after = round2(before - qty);
      const code = itemCode(it);
      if (code && qty > 0) {
        if (prod) { prod.actualStock = after; }
        stockLogs.unshift({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, productCode: code,
          productName: String(it.shortName || prod?.shortName || prod?.name || code), type: '出库',
          changeQty: -qty, beforeStock: before, afterStock: after, relatedDocNo: docNo,
          operator, createTime: now, remark: `销售出库 ${id}`,
        });
      }
      return {
        code, qty, name: String(it.shortName || prod?.shortName || prod?.name || ''),
        styleCode: String(it.styleCode || ''), color: String(it.color || ''), spec: String(it.spec || ''),
        unit: String(it.unit || prod?.unit || ''), productName: String(it.shortName || prod?.shortName || prod?.name || ''),
        quantity: qty, beforeStock: before, afterStock: after,
      };
    });
    const outbound = {
      key: `so-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, docNo, orderId: id,
      customerName: base.customerName || '', shopName: base.shopName || base.shop || '',
      receiverName: base.receiverName || '', receiverAddress: base.receiverAddress || '',
      productDetail: itemsDetailStr(origItems), totalQty: itemsTotalQty(origItems),
      items: outItems, operator, createTime: now, status: '已发货', remark: '', images: shipImages,
    };
    const nextSo = [outbound, ...soList];

    const addTag = (t: any): string => { const s = String(t || ''); return s.includes('缺货拆分') ? s : (s ? s + ',' : '') + '缺货拆分'; };
    const addTags = (ts: any): any => Array.isArray(ts) ? (ts.includes('缺货拆分') ? ts : ['缺货拆分', ...ts]) : ts;
    const parseLogs = (v: any): any[] => { try { const l = typeof v === 'string' ? JSON.parse(v || '[]') : (Array.isArray(v) ? v : []); return Array.isArray(l) ? l : []; } catch { return []; } };

    // 原单瘦身（保留发货部分）+ 发货完成 + 日志
    const baseLogs = parseLogs(base.orderLog);
    baseLogs.push({ time: now, action: '订单发货', operator, detail: `打单拣货发货：生成出库单 ${docNo}，订单状态变更为已完成` });
    baseLogs.push({ time: now, action: '交易完成', operator, detail: '供应商已发货，订单交易自动完成' });
    const slim: any = {
      orderStatus: '已完成', auditStatus: '', shipTime: now, completeTime: now, outboundNo: docNo,
      shipImages, orderLog: JSON.stringify(baseLogs),
    };

    // 缺货拆分：拆出子单进入生产（订单号/出库单号 = 原单号-序号）
    let child: any = null;
    let childId = '';
    let nextPushed = pushedOrders;
    let nextTrades = tradeOrders;
    if (needSplit) {
      const idSet = new Set<string>(omList.map((o: any) => String(o.id || '')));
      pushedOrders.forEach((p: any) => idSet.add(String(p.id || '')));
      tradeOrders.forEach((p: any) => idSet.add(String(p.id || '')));
      let seq = (Array.isArray(base.splitChildren) ? base.splitChildren.length : 0) + 1;
      childId = `${base.id}-${seq}`;
      while (idSet.has(childId)) { seq += 1; childId = `${base.id}-${seq}`; }
      const childOutboundNo = `${docBase}-${seq}`;
      const childItems = items.map((it: any, i: number) => ({ ...it, quantity: round2(itemQty(it) - shipQtys[i]) })).filter((it: any) => itemQty(it) > 0);
      baseLogs.push({ time: now, action: '缺货拆分', operator, detail: `拆出子单 ${childId}：本次发货货品额 ¥${shipAmt.toFixed(2)}、留后 ¥${restAmt.toFixed(2)}；运费 ${freightOrig.toFixed(2)}/${freightChild.toFixed(2)}；已付 ${origPaid.toFixed(2)}/${childPaid.toFixed(2)}` });
      // 原单仅保留发货部分（金额/明细/标签同步瘦身）
      Object.assign(slim, {
        orderItems: JSON.stringify(origItems), productDetail: itemsDetailStr(origItems), palletCount: itemsTotalQty(origItems),
        productAmount: origTotal, totalAmount: origTotal, freight: freightOrig, paidAmount: origPaid,
        splitChildren: [...(Array.isArray(base.splitChildren) ? base.splitChildren : []), childId],
        orderTag: addTag(base.orderTag), orderTags: addTags(base.orderTags), orderLog: JSON.stringify(baseLogs),
      });
      child = {
        ...base, key: `so-split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, id: childId,
        orderItems: JSON.stringify(childItems), productDetail: itemsDetailStr(childItems), palletCount: itemsTotalQty(childItems),
        productAmount: childTotal, totalAmount: childTotal, freight: freightChild, paidAmount: childPaid,
        orderStatus: childPaid >= childTotal - 0.01 ? '已付款' : '待付款',
        auditStatus: '已审核', splitFromId: base.id, splitSeq: seq, splitChildren: undefined,
        orderTag: addTag(base.orderTag), orderTags: addTags(base.orderTags),
        createTime: now, creator: operator, printStatus: '', outboundNo: childOutboundNo, shipTime: '',
        orderLog: JSON.stringify([...parseLogs(base.orderLog), { time: now, action: '拆分生成', operator, detail: `缺货拆分自 ${base.id}：留后货品额 ¥${restAmt.toFixed(2)}、运费 ¥${freightChild.toFixed(2)}、已付分摊 ¥${childPaid.toFixed(2)}` }]),
      };
      // 采购商推送单镜像同步拆分（两键同构：原镜像瘦身 + 子镜像生成），仅对来源为采购商推送的订单
      if (base.orderSource === '采购商推送') {
        const mirrorLog = (po: any, action: string, detail: string): string => {
          const logs = parseLogs(po?.orderLog);
          if (!logs.some((l: any) => l.action === action && l.detail === detail)) logs.push({ time: now, action, operator, detail });
          return JSON.stringify(logs);
        };
        let orderKey = ''; let purchaserUsername = '';
        if (base.pushRef) { const parts = String(base.pushRef).split('@'); orderKey = parts[0] || ''; purchaserUsername = parts[1] || ''; }
        if (!purchaserUsername) { const po = pushedOrders.find((x: any) => String(x.id) === id); if (po) { orderKey = po.key || ''; purchaserUsername = po.purchaserUsername || ''; } }
        if (purchaserUsername) {
          const hit = pushedOrders.find((p: any) => (orderKey && p.key === orderKey) || String(p.id) === id);
          const seq2 = child.splitSeq;
          const childKey = hit ? `${hit.key}-${seq2}` : `${id}-${seq2}`;
          const childPushed = hit ? {
            ...hit, key: childKey, id: childId, orderItems: child.orderItems, productDetail: child.productDetail,
            palletCount: child.palletCount, productAmount: childTotal, totalAmount: childTotal, freight: freightChild, paidAmount: childPaid,
            splitFromId: id, splitSeq: seq2, pushRef: `${childKey}@${purchaserUsername}`,
            orderLog: mirrorLog(hit, '供应商缺货拆分', `供应商拆分订单：子单 ${childId} 总额 ¥${childTotal.toFixed(2)}、已付 ¥${childPaid.toFixed(2)}`),
          } : null;
          nextPushed = pushedOrders.map((p: any) => (p === hit ? {
            ...p, orderItems: slim.orderItems, productDetail: slim.productDetail, palletCount: slim.palletCount,
            productAmount: origTotal, totalAmount: origTotal, freight: freightOrig, paidAmount: origPaid,
            status: '已完成', shipTime: now, completeTime: now,
            orderLog: mirrorLog(p, '供应商发货', '供应商平台发货完成，订单状态变更为已完成'),
          } : p)).concat(childPushed ? [childPushed] : []);
          const thit = tradeOrders.find((t: any) => String(t.id) === id);
          const childTrade = thit ? {
            ...thit, key: `mt-split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, id: childId,
            orderItems: child.orderItems, productDetail: child.productDetail, palletCount: child.palletCount,
            productAmount: childTotal, freight: freightChild, paidAmount: childPaid, totalAmount: childTotal,
            splitFromId: id, splitSeq: seq2,
            orderLog: mirrorLog(thit, '供应商缺货拆分', `供应商拆分订单：子单 ${childId} 总额 ¥${childTotal.toFixed(2)}、已付 ¥${childPaid.toFixed(2)}`),
          } : null;
          nextTrades = tradeOrders.map((t: any) => (t === thit ? {
            ...t, orderItems: slim.orderItems, productDetail: slim.productDetail, palletCount: slim.palletCount,
            productAmount: origTotal, freight: freightOrig, paidAmount: origPaid, totalAmount: origTotal, status: '已完成',
            orderLog: mirrorLog(t, '供应商发货', '供应商平台发货完成，订单状态变更为已完成'),
          } : t)).concat(childTrade ? [childTrade] : []);
        }
      }
    }

    // 整单发货（未拆分）也需把采购商推送镜像置为已完成，与 Web handleShipNow 同口径
    if (!needSplit && base.orderSource === '采购商推送') {
      const mirrorLog = (po: any, action: string, detail: string): string => {
        const logs = parseLogs(po?.orderLog);
        if (!logs.some((l: any) => l.action === action && l.detail === detail)) logs.push({ time: now, action, operator, detail });
        return JSON.stringify(logs);
      };
      let orderKey = ''; let purchaserUsername = '';
      if (base.pushRef) { const parts = String(base.pushRef).split('@'); orderKey = parts[0] || ''; purchaserUsername = parts[1] || ''; }
      if (!purchaserUsername) { const po = pushedOrders.find((x: any) => String(x.id) === id); if (po) { orderKey = po.key || ''; purchaserUsername = po.purchaserUsername || ''; } }
      if (purchaserUsername) {
        const hit = pushedOrders.find((p: any) => (orderKey && p.key === orderKey) || String(p.id) === id);
        if (hit) nextPushed = pushedOrders.map((p: any) => (p === hit ? { ...p, status: '已完成', shipTime: now, completeTime: now, orderLog: mirrorLog(p, '供应商发货', '供应商平台发货完成，订单状态变更为已完成') } : p));
        const thit = tradeOrders.find((t: any) => String(t.id) === id);
        if (thit) nextTrades = tradeOrders.map((t: any) => (t === thit ? { ...t, status: '已完成', shipTime: now, completeTime: now, orderLog: mirrorLog(t, '供应商发货', '供应商平台发货完成，订单状态变更为已完成') } : t));
      }
    }

    // 落库：订单（原单瘦身 + 子单）、出库单、商品库存、库存日志、镜像键
    const nextOm = omList.map((o: any) => ((String(o.id) === id || String(o.key) === id) ? { ...o, ...slim } : o)).concat(child ? [child] : []);
    await writeRows(omKey, nextOm, owner);
    await writeRows(soKey, nextSo, owner);
    await writeRows(prodKey, prodList, owner);
    await writeRows(stockLogKey, stockLogs, owner);
    if (base.orderSource === '采购商推送') {
      if (nextPushed !== pushedOrders) await writeRows('purchaser_pushed_orders', nextPushed, owner);
      if (nextTrades !== tradeOrders) await writeRows('market_trade_orders', nextTrades, owner);
    }
    res.json({ code: 200, data: { shipped: true, docNo, splitChildId: childId || '', needSplit } });
  } catch (err: any) {
    console.error('[wx] picking ship error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/lists/:page?q= —— 空白子菜单补齐：日常记账/生产订单/采购订单/新款进度/店铺/仓库统计/品牌/员工/客户 */
router.get('/lists/:page', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const page = String(req.params.page || '');
    const q = String(req.query.q || '');
    // 菜单点闸：与 Web PERM_V2 菜单可见性一致，无权限直接 403（小程序侧展示无权限空态）
    const listMenuKey = LIST_MENU_KEYS[page];
    if (listMenuKey) {
      const menuPerms = await canViewMenus(user.username, [listMenuKey]);
      if (!menuPerms[listMenuKey]) { res.status(403).json({ code: 403, message: '无该菜单权限（与网页版菜单权限一致）' }); return; }
    }
    // 快速筛选（今日/昨日/本月）：备货/配货/急采按记录日期过滤并下发汇总行
    const range = String(req.query.range || '');
    let sums: string[] | null = null;
    const inRange = (dateStr: string): boolean => {
      if (range === 'today') return dateStr === localYmd();
      if (range === 'yesterday') return dateStr === localYmd(new Date(Date.now() - 86400000));
      if (range === 'month') return dateStr.slice(0, 7) === localYmd().slice(0, 7);
      return true;
    };
    const money = (v: number): string => (v > 0 ? `¥${v.toFixed(2)}` : '—');
    let items: ListItem[] = [];
    // 仓库统计负责人权限（与 Web WarehouseStatsPage 同源）：非负责人仅见本人创建的记录；奖惩为配置类页签不过滤；工资汇总按人过滤
    let wsViewAll = true;
    let wsMyName = '';
    if (page === 'warehouseStats' || page === 'warehouseStock' || page === 'warehousePick' || page === 'warehouseUrgent' || page === 'warehouseSalary') {
      wsViewAll = await wsCanViewAll(owner, user.username);
      wsMyName = await displayNameOf(user.username);
    }
    // 金额展示统一 ¥ 千分位两位小数（客户卡/账单明细/对账同源）
    const yuan = (v: number) => `¥${(Math.round((Number(v) || 0) * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (page === 'bookkeeping') {
      const rows = await readRows(`daily_bookkeeping_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key, title: pick(r.category, r.mainCategory, r.bookType) || '记账',
        tag: r.bookType, tone: r.bookType === '收入' ? 'green' : 'orange',
        amount: Number(r.amount) || 0,
        sub: [day10(r.bookDate), r.voucherNo, r.person,
          r.payAccount && `付:${r.payAccount}`, r.recvAccount && `收:${r.recvAccount}`, r.remark].filter(Boolean) as string[],
      }));
    } else if (page === 'production') {
      const [rows, scRows] = await Promise.all([
        readRows(`pageData_production_production-order_${owner}`),
        readRows(`pageData_production_production-schedule_${owner}`),
      ]);
      // 状态英文枚举转中文（与 Web 生产订单状态口径对应）
      const prodStatusText: Record<string, string> = { pending: '待排产', processing: '生产中', completed: '已完成', cancelled: '已取消', warning: '异常' };
      // 排期记录按生产单分组（按日期排序）：派生排产状态、卡片副行排期明细（日期+班次+生产线）与详情字段同源
      const SHIFT_TEXT: Record<string, string> = { morning: '上午', afternoon: '下午', evening: '晚上' };
      const schedByPo = new Map<string, any[]>();
      scRows.forEach((s: any) => {
        const k = String(s.productionOrderId || '');
        if (!k) return;
        const arr = schedByPo.get(k) || [];
        arr.push(s);
        schedByPo.set(k, arr);
      });
      const dayOfSched = (s: any) => day10(pick(s.startDate, s.date, ''));
      // 款式编码：与 client ScheduleBoard/OrdersEmbed 同源正则——剥掉商品编码的「-颜色-规格」尾段只留款式前缀
      const stylePrefixOf = (code: any): string => {
        const s = String(code || '');
        const m = s.match(/^[^-]+(?:-[^-]+)*?(?=\s*-\s*[\u4e00-\u9fff])/);
        if (m) return m[0];
        const n = s.match(/^\d+/);
        return n ? n[0] : s;
      };
      // 不显示已完成/已取消：小程序生产订单页只展示待生产池（与 Web 展示层过滤口径一致）
      items = rows
        .filter((r: any) => { const st = String(r.status || ''); return st !== 'completed' && st !== 'cancelled'; })
        .map((r: any) => {
          const qty = Number(r.planQuantity ?? r.quantity ?? r.productionQty) || 0;
          const statusText = prodStatusText[String(r.status || '')] || pick(r.status, '—');
          const date = day10(pick(r.createTime, r.date, r.createDate));
          const planItems: any[] = Array.isArray(r.planItems) ? r.planItems : [];
          const styleSrc = planItems.length ? planItems.map((it: any) => it.productCode || it.styleCode || '') : [pick(r.styleCode, r.productCode, '')];
          const styles = Array.from(new Set(styleSrc.map(stylePrefixOf).filter(Boolean)));
          // 款式前缀×总数量（018-2 X 6：X 前后空格更醒目、不带单位）：明细逐条数量按前缀累加；无明细时单一款式挂整单计划数量
          const qtyByStyle = new Map<string, number>();
          if (planItems.length) {
            planItems.forEach((it: any) => {
              const code = stylePrefixOf(it.productCode || it.styleCode || '');
              if (!code) return;
              qtyByStyle.set(code, (qtyByStyle.get(code) || 0) + (Number(it.productionQty ?? it.quantity) || 0));
            });
          } else if (styles.length) {
            qtyByStyle.set(styles[0], qty);
          }
          const styleQtyStr = qtyByStyle.size
            ? Array.from(qtyByStyle.entries()).map(([c, q]) => `${c} X ${q}`).join('、')
            : styles.join('、');
          const mySched = (schedByPo.get(String(r.id || '')) || [])
            .slice().sort((a: any, b: any) => dayOfSched(a).localeCompare(dayOfSched(b)));
          const schedDates = mySched.map(dayOfSched).filter(Boolean);
          const schedDate = schedDates[0] || day10(pick(r.planStart, ''));
          // 副行排期明细：逐条「日期 班次 生产线」，多条顿号分隔；无排期记录回退计划开始日期
          const schedDetailStr = mySched
            .map((s: any) => [dayOfSched(s), SHIFT_TEXT[String(s.shift || '')] || String(s.shift || ''), String(s.line || '').trim()].filter(Boolean).join(' '))
            .join('、');
          const scheduled = mySched.length > 0;
          return {
            key: r.key || r.id, title: pick(r.id, r.orderNo, r.key) || '生产订单',
            // 右侧 tag 显示排产状态：有排期记录即「已排产」（修复排过仍显示待排产）
            tag: scheduled ? '已排产' : statusText,
            // 已排产绿底白字（行内样式覆盖 tag 类浅底色）
            tagStyle: scheduled ? { color: '#fff', background: '#52c41a', borderColor: '#52c41a' } : undefined,
            // 卡片副信息两行：首行款式编码 X 总数量（如 018-2 X 6），创建日期同行靠右（ListView 按 subRight 渲染）；次行排产日期+班次+生产线
            sub: [styleQtyStr, (schedDetailStr || schedDate) ? `排产 ${schedDetailStr || schedDate}` : ''].filter(Boolean) as string[],
            subRight: date,
            // 排产行字号缩小 50%（24→12）并改绿色字体（subColors 逐行下发）
            subSizes: [14.4, 12],
            subColors: ['', '#52c41a'],
            // 详情弹层字段（点击卡片展示）：含排产日期与计划明细
            fields: [
              ['生产单号', pick(r.id, r.orderNo, r.key) || '—'],
              ['状态', statusText],
              ['排产状态', scheduled ? '已排产' : '待排产'],
              ['款式编码', styles.join('、') || '—'],
              ['计划数量', qty ? String(qty) : '—'],
              ['已完成数量', String(Number(r.completedQuantity ?? r.doneQty) || 0)],
              ['排产明细', schedDetailStr || schedDate || '—'],
              ['计划明细', planItems.length ? planItems.map((it: any) => `${it.productCode || it.productName || '—'} ×${Number(it.productionQty ?? it.quantity) || 0}`).join('\n') : '—'],
              ['订单标签', pick(r.orderTag, '—')],
              ['创建日期', date || '—'],
            ] as [string, string][],
          };
        });
    } else if (page === 'purchase') {
      const rows = await readRows(`pageData_production_purchase-requisition_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.id, title: pick(r.id, r.docNo, r.key) || '采购申请单',
        tag: r.status,
        sub: [r.supplier, Array.isArray(r.items) && r.items.length ? `${r.items.length} 项物料` : '',
          day10(pick(r.createTime, r.date, r.createDate)), r.person].filter(Boolean) as string[],
      }));
    } else if (page === 'picking') {
      // 打单拣货：与 Web「销售管理→打单拣货」同口径——订单派生视图，仅取已审核+已付款，
      // 另并上无关联订单的遗留拣货单（只读）；列取 remap 后的 id/outboundNo/palletCount/pickTime
      const [orderRows, legacyRows] = await Promise.all([
        readRows(`pageData_sales_order-manage_${owner}`),
        readRows(`pageData_sales_print-picking_legacy_${owner}`),
      ]);
      const pickRows = [
        ...orderRows.filter((r: any) => r.auditStatus === '已审核' && String(r.orderStatus || '').trim() === '已付款'),
        ...legacyRows.map((r: any) => ({ ...r, _legacy: true })),
      ];
      const timeOf = (r: any): string => pick(r.pickTime, r.createTime, r.createdAt);
      pickRows.sort((a: any, b: any) => timeOf(b).localeCompare(timeOf(a)));
      items = pickRows.map((r: any) => ({
        key: r.key || r.id, title: pick(r.id, r.orderNo, r.key) || '拣货单',
        tag: r._legacy ? '遗留单' : pick(r.printStatus, '待打单'),
        tone: r._legacy ? 'gray' : undefined,
        row: [pick(r.id, r.orderNo, r.key) || '—', pick(r.outboundNo, '—'),
          String(Number(r.palletCount ?? r.quantity) || 0), day10(timeOf(r)) || '—'],
        sub: [pick(r.customerName), r.orderTag && `标签：${r.orderTag}`,
          pick(r.receiverName) && `收货人：${pick(r.receiverName, '')} ${pick(r.province, '')}${pick(r.city, '')}${pick(r.district, '')}${pick(r.receiverDetail, '')}`.trim(),
          pick(r.productDetail) && `货品：${pick(r.productDetail)}`,
          [pick(r.printer) && `打单人:${pick(r.printer)}`, pick(r.person) && `拣货人:${pick(r.person)}`].filter(Boolean).join(' '),
          pick(r.location) && `库位：${pick(r.location)}`, pick(r.rejectReason) && `驳回：${pick(r.rejectReason)}`,
        ].filter(Boolean) as string[],
      }));
    } else if (page === 'processing-order') {
      // 加工订单（Web 生产管理→加工订单同键）
      const rows = await readRows(`pageData_production_processing-order_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.id, title: pick(r.id, r.key) || '加工单',
        tag: r.status,
        row: [pick(r.id, r.key), pick(r.poId, '—'), pick(r.styleCode, r.productCode, '—'),
          String(r.totalQty ?? ''), pick(r.status, '—')],
        sub: [r.poId && `来源生产单号 ${r.poId}`, pick(r.styleCode, r.productCode), r.shortName,
          r.totalQty !== undefined && r.totalQty !== null && `需求总数量 ${r.totalQty}`,
          r.factoryName, day10(r.createTime), r.operator].filter(Boolean) as string[],
      }));
    } else if (page === 'workflow-templates') {
      // 生产流程模板（与 CustomOrderPage 共用键）
      const rows = await readRows(`pageData_production_custom-order-templates_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.id, title: pick(r.name, r.id) || '流程模板',
        tag: r.industry,
        row: [pick(r.name, r.id), pick(r.industry, '—'), String(Array.isArray(r.nodes) ? r.nodes.length : 0),
          r.isDefault ? '默认' : '—'],
        sub: [r.industry, Array.isArray(r.nodes) && r.nodes.length ? `${r.nodes.length} 个流程节点` : '',
          r.isDefault && '系统预设'].filter(Boolean) as string[],
      }));
    } else if (page === 'production-schedule') {
      // 生产排期：卡片式全字段明细（状态枚举与 Web 筛选同口径）
      const stText: Record<string, string> = { pending: '待排产', processing: '生产中', completed: '已完工', warning: '异常' };
      const stTone: Record<string, string> = { pending: 'orange', processing: 'blue', completed: 'green', warning: 'red' };
      const shiftText: Record<string, string> = { morning: '早班', afternoon: '中班', evening: '晚班' };
      const rows = await readRows(`pageData_production_production-schedule_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.id, title: pick(r.id, r.key) || '生产排期',
        tag: stText[r.status] || r.status, tone: stTone[r.status] || 'blue',
        sub: [
          r.productionOrderId && `关联生产单号：${r.productionOrderId}`,
          r.salesOrderId && `关联销售单号：${r.salesOrderId}`,
          (r.productName || r.customerName) && `产品：${r.productName || '—'}　客户：${r.customerName || '—'}`,
          r.planItems && `计划明细：${r.planItems}`,
          `排产数量：${r.planQty ?? '—'}　生产线：${r.line || '—'}　班次：${shiftText[r.shift] || '—'}　负责人：${r.person || '—'}`,
          (r.startDate || r.endDate) && `计划开工：${day10(r.startDate) || '—'} → 计划完工：${day10(r.endDate) || '—'}`,
        ].filter(Boolean) as string[],
      }));
    } else if (page === 'progress') {
      // 主表单：数据完善状态取自商品属性登记表（与 Web 主表同口径）
      const [rows, listingRows] = await Promise.all([
        readRows(`newstyle_progress_${owner}`), readRows(`newstyle_listing_${owner}`),
      ]);
      const completeOf = (code: string): string => {
        const l = listingRows.find((x: any) => x.styleCode === code);
        return l ? (l.dataComplete === '资料已完善' ? '已完善' : '未完善') : '未登记';
      };
      items = rows.map((r: any) => {
        const code = pick(r.styleCode, r.key);
        return {
          key: r.key || r.styleCode, title: code || '新款',
          tag: pick(r.dataComplete, r.recvStatus, r.status),
          row: [code, pick(r.brand, '—'), completeOf(code), pick(r.creator, '—')],
          sub: [r.brand, r.planListDate && `预计上架 ${r.planListDate}`, r.creator,
            day10(r.createdAt)].filter(Boolean) as string[],
        };
      });
    } else if (page === 'newstylePhoto') {
      // 回传图片
      const rows = await readRows(`newstyle_photo_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.styleCode, title: pick(r.styleCode, r.key) || '回传图片',
        tag: r.recvStatus, tone: r.recvStatus === '已收到' ? 'blue' : 'gray',
        row: [pick(r.styleCode, r.key), pick(r.recvStatus, '未收到'), pick(r.planListDate, '—'), pick(r.creator, '—')],
        sub: [r.recvStatus, r.planListDate && `预计上架 ${r.planListDate}`, r.creator, day10(r.createdAt)].filter(Boolean) as string[],
      }));
    } else if (page === 'newstyleArrival') {
      // 到货款式
      const rows = await readRows(`newstyle_arrival_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.styleCode, title: pick(r.styleCode, r.key) || '到货款式',
        tag: r.arrivalStatus, tone: r.arrivalStatus === '已到货' ? 'green' : 'orange',
        row: [pick(r.styleCode, r.key), pick(r.date, '—'), pick(r.arrivalStatus, '未到货'), pick(r.creator, '—')],
        sub: [day10(r.date), r.arrivalStatus, r.overdueDate && `上架超时 ${r.overdueDate}`, r.creator].filter(Boolean) as string[],
      }));
    } else if (page === 'newstyleListing') {
      // 商品属性
      const rows = await readRows(`newstyle_listing_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.styleCode, title: pick(r.styleCode, r.key) || '商品属性',
        tag: r.dataComplete, tone: r.dataComplete === '资料已完善' ? 'green' : 'orange',
        row: [pick(r.styleCode, r.key), r.dataComplete === '资料已完善' ? '已完善' : '未完善',
          Array.isArray(r.platforms) && r.platforms.length ? r.platforms.join('/') : '—', pick(r.creator, '—')],
        sub: [r.dataComplete, Array.isArray(r.platforms) && r.platforms.length ? `上架平台 ${r.platforms.join('/')}` : '', r.creator, day10(r.date)].filter(Boolean) as string[],
      }));
    } else if (page === 'shops') {
      const scoped = await scopeShopsFor(owner, user.username, await readRows(`shop_info_${owner}`));
      items = scoped.map((r: any) => ({
        key: r.key || r.shopName, title: pick(r.shopName, r.name) || '店铺',
        tag: r.platform,
        sub: [r.brand, r.person && `负责人:${r.person}`, r.status].filter(Boolean) as string[],
      }));
    } else if (page === 'warehouseStats' || page === 'warehouseStock') {
      const rows = (await readRows(`ws_stock_${owner}`)).filter((r: any) => inRange(day10(r.date)) && (wsViewAll || String(r.creator || '') === wsMyName));
      sums = ['', String(rows.reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0)), '',
        money(rows.reduce((s: number, r: any) => s + (Number(r.qcWage) || 0), 0))];
      items = rows.map((r: any) => ({
        key: r.key || r.orderNo || r.productCode, title: pick(r.productCode, r.orderNo, r.key) || '备货记录',
        tag: r.month,
        row: [pick(r.orderNo, r.key), String(r.quantity ?? ''), pick(r.material, '—'),
          (Number(r.qcWage) || 0) ? `¥${Number(r.qcWage).toFixed(2)}` : '—'],
        sub: [day10(r.date), r.orderNo, r.quantity !== undefined && r.quantity !== null && `数量 ${r.quantity}`,
          r.material, r.person, r.packer].filter(Boolean) as string[],
      }));
    } else if (page === 'warehousePick') {
      const rows = (await readRows(`ws_pick_${owner}`)).filter((r: any) => inRange(day10(r.createdAt)) && (wsViewAll || String(r.creator || '') === wsMyName));
      sums = ['', String(rows.reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0)),
        money(rows.reduce((s: number, r: any) => s + (Number(r.wage) || 0), 0))];
      items = rows.map((r: any) => ({
        key: r.key || r.orderNo, title: pick(r.orderNo, r.key) || '配货记录',
        tag: r.month, amount: Number(r.wage) || 0,
        row: [pick(r.orderNo, r.key), String(r.quantity ?? ''), (Number(r.wage) || 0) ? `¥${Number(r.wage).toFixed(2)}` : '—'],
        sub: [r.quantity !== undefined && r.quantity !== null && `数量 ${r.quantity}`,
          r.priceRate && `工价 ¥${r.priceRate}`, r.picker && `配货员:${r.picker}`,
          r.creator, day10(r.createdAt)].filter(Boolean) as string[],
      }));
    } else if (page === 'warehouseUrgent') {
      const rows = (await readRows(`ws_urgent_${owner}`)).filter((r: any) => inRange(day10(pick(r.date, r.qcDate))) && (wsViewAll || String(r.creator || '') === wsMyName));
      sums = ['', String(rows.reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0)), '',
        money(rows.reduce((s: number, r: any) => s + (Number(r.wage) || 0), 0))];
      items = rows.map((r: any) => ({
        key: r.key || r.orderNo || r.productCode, title: pick(r.productCode, r.orderNo, r.key) || '急采记录',
        tag: r.month, amount: Number(r.wage) || 0,
        row: [pick(r.orderNo, r.key), String(r.quantity ?? ''), pick(r.material, '—'),
          (Number(r.wage) || 0) ? `¥${Number(r.wage).toFixed(2)}` : '—'],
        sub: [day10(pick(r.date, r.qcDate)), r.orderNo,
          r.quantity !== undefined && r.quantity !== null && `数量 ${r.quantity}`,
          r.inspector && `质检:${r.inspector}`, r.material,
          r.packer && `打包:${r.packer}`, r.foreignTeam && `外贸组长:${r.foreignTeam}`].filter(Boolean) as string[],
      }));
    } else if (page === 'warehouseNote') {
      const rows = await readRows(`ws_note_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key, title: pick(r.note) || '奖惩记录',
        tag: r.type === 'punishment' ? '罚款' : '奖励', tone: r.type === 'punishment' ? 'red' : 'green',
        amount: (r.type === 'punishment' ? -1 : 1) * (Number(r.amount) || 0),
        row: [pick(r.person), r.type === 'punishment' ? '罚款' : '奖励', String(r.amount ?? '')],
        sub: [r.person, day10(r.date), r.month].filter(Boolean) as string[],
      }));
    } else if (page === 'warehouseSalary') {
      // 工资汇总：与 Web SalaryTab 同口径——按人按月累加备货/急采质检、配货、打包、外贸组长六类工资 + 奖惩净额
      const m = /^\d{4}-\d{2}$/.test(String(req.query.m || '')) ? String(req.query.m) : localYmd().slice(0, 7);
      const [stockR, urgentR, pickR, noteR] = await Promise.all([
        readRows(`ws_stock_${owner}`), readRows(`ws_urgent_${owner}`),
        readRows(`ws_pick_${owner}`), readRows(`ws_note_${owner}`),
      ]);
      const qc: Record<string, { s: number; u: number }> = {};
      const pack: Record<string, { s: number; u: number }> = {};
      const pickM: Record<string, number> = {};
      const team: Record<string, number> = {};
      const noteM: Record<string, number> = {};
      stockR.forEach((r: any) => {
        if (r.month !== m) return;
        if (r.qcInspector) { const e = qc[r.qcInspector] || (qc[r.qcInspector] = { s: 0, u: 0 }); e.s += Number(r.qcWage) || 0; }
        if (r.packer) { const e = pack[r.packer] || (pack[r.packer] = { s: 0, u: 0 }); e.s += Number(r.packWage) || 0; }
        if (r.foreignTeam) team[r.foreignTeam] = (team[r.foreignTeam] || 0) + (Number(r.commission) || 0);
      });
      urgentR.forEach((r: any) => {
        if (r.month !== m) return;
        if (r.inspector) { const e = qc[r.inspector] || (qc[r.inspector] = { s: 0, u: 0 }); e.u += Number(r.wage) || 0; }
        if (r.packer) { const e = pack[r.packer] || (pack[r.packer] = { s: 0, u: 0 }); e.u += Number(r.packWage) || 0; }
        if (r.foreignTeam) team[r.foreignTeam] = (team[r.foreignTeam] || 0) + (Number(r.commission) || 0);
      });
      pickR.forEach((r: any) => {
        if (r.month !== m) return;
        const k = r.picker || r.creator;
        if (k) pickM[k] = (pickM[k] || 0) + (Number(r.wage) || 0);
      });
      noteR.forEach((n: any) => {
        if (n.month !== m || !n.person) return;
        noteM[n.person] = (noteM[n.person] || 0) + ((n.type === 'punishment' ? -1 : 1) * (Number(n.amount) || 0));
      });
      const fmt = (v: number) => `¥${v.toFixed(2)}`;
      const persons = Array.from(new Set([...Object.keys(qc), ...Object.keys(pack), ...Object.keys(pickM), ...Object.keys(team), ...Object.keys(noteM)]));
      // 与 Web SalaryTab visibleRows 同源：非负责人只留本人一行（合计随可见行重算，避免表格见自己、合计全员的泄露）
      const visiblePersons = wsViewAll ? persons : persons.filter(n => n === wsMyName);
      items = visiblePersons.map(name => {
        const stockWage = qc[name]?.s || 0;
        const urgentWage = qc[name]?.u || 0;
        const pickWage = pickM[name] || 0;
        const packS = pack[name]?.s || 0;
        const packU = pack[name]?.u || 0;
        const teamWage = team[name] || 0;
        const noteNet = noteM[name] || 0;
        const total = stockWage + urgentWage + pickWage + packS + packU + teamWage + noteNet;
        return {
          key: name, title: name, tag: m, tone: 'blue', amount: total,
          sub: [stockWage && `备货质检 ${fmt(stockWage)}`, urgentWage && `急采质检 ${fmt(urgentWage)}`,
            pickWage && `配货 ${fmt(pickWage)}`, packS && `备货打包 ${fmt(packS)}`,
            packU && `急采打包 ${fmt(packU)}`, teamWage && `外贸组长 ${fmt(teamWage)}`,
            noteNet && `奖惩 ${fmt(noteNet)}`].filter(Boolean) as string[],
        };
      }).sort((a, b) => (b.amount || 0) - (a.amount || 0));
    } else if (page === 'brands') {
      const [own, auth] = await Promise.all([
        readRows(`brandauth_own_${owner}`), readRows(`brandauth_auth_brandledger_${owner}`),
      ]);
      items = [
        ...own.map((r: any) => ({
          key: r.key || r.brandName, title: pick(r.brandName) || '品牌', tag: '自有品牌', tone: 'blue',
          sub: [r.companyName, r.category].filter(Boolean) as string[],
        })),
        ...auth.map((r: any) => ({
          key: r.key || r.brandName, title: pick(r.brandName) || '品牌', tag: '授权品牌', tone: 'green',
          sub: [r.companyName, r.category].filter(Boolean) as string[],
        })),
      ];
    } else if (page === 'staff') {
      // 员工档案与 Web EmployeePage 同口径：accounts 子账号映射员工 + hr_employee_profiles 补充档案
      const [accounts, profiles] = await Promise.all([
        readRows(`accounts_${owner}`), readRows(`hr_employee_profiles_${owner}`),
      ]);
      const profOf = (u: string) => profiles.find((p: any) => p && p.username === u) || {};
      items = accounts.filter((a: any) => a && a.accountType === '子账号').map((a: any) => {
        const p = profOf(a.username);
        return {
          key: a.username, title: pick(a.displayName, a.person, a.username),
          tag: a.status === 'disabled' ? '离职' : '在职', tone: a.status === 'disabled' ? 'gray' : 'green',
          sub: [a.group, pick(p.position, p.post), pick(p.mobile, p.phone, a.phone), p.bankName].filter(Boolean) as string[],
        };
      });
    } else if (page === 'customers') {
      // 全量客户：直接客户档案 + 未关联直接客户的绑定采购商（与 Web loadAllCustomersFromStorage 同源，关联判定简化为同名）
      const [custRows, bpRows, adjRows, billRows, receiptRows, orderRows] = await Promise.all([
        readRows(`customers_${owner}`),
        readRows(`boundPurchasers_${owner}`),
        readRows(`credit_adjustments_${owner}`),
        readRows(`pageData_customer_bill-detail_${owner}`),
        readRows(`customerReceipts_${owner}`),
        readRows(`pageData_sales_order-manage_${owner}`),
      ]);
      const nm = (v: any) => String(v || '').trim();
      // 财务口径与 Web CustomerInfo 同源：采购总额=Σ账单明细 totalAmount；已收=Σ手工收款台账；
      // 订单占用=未发货完成且余额支付订单 Σ productAmount；剩余额度=有效信用+已收−采购−占用；应收欠款=max(0,采购−已收)
      const purchaseOf = (name: string) => billRows.reduce((s: number, r: any) => s + (nm(r.customerName) === name ? (Number(r.totalAmount) || 0) : 0), 0);
      const receivedOf = (name: string) => receiptRows.reduce((s: number, r: any) => s + (nm(r.customerName) === name ? (Number(r.amount) || 0) : 0), 0);
      const occupiedOf = (name: string) => orderRows.reduce((s: number, o: any) => {
        if (nm(o.customerName) !== name) return s;
        if (['待付款', '已发货', '已完成', '已取消'].includes(String(o.orderStatus || ''))) return s;
        if (!(String(o.payMethod || '') === '余额支付' || String(o.orderTags || '').includes('余额支付') || String(o.orderTag || '').includes('余额支付'))) return s;
        return s + (Number(o.productAmount) || 0);
      }, 0);
      const effectiveCredit = (id: string, name: string, base: number) => Math.round((base + adjRows
        .filter((a: any) => String(a.customerId || '') === String(id || '') || nm(a.customerName) === name)
        .reduce((s: number, a: any) => s + (a.type === 'increase' ? (Number(a.amount) || 0) : -(Number(a.amount) || 0)), 0)) * 100) / 100;
      // 不同客户不同底色：浅色调色板按下标循环
      const CARD_BGS = ['#e6f4ff', '#f6ffed', '#fff7e6', '#fff1f0', '#f9f0ff', '#e6fffb'];
      const direct = custRows.map((r: any) => ({
        id: r.id, name: nm(pick(r.name, r.customerName)) || '客户', level: r.level,
        contact: r.contact, phone: r.phone, region: r.region, credit: Number(r.credit) || 0,
      }));
      const directNames = new Set(direct.map(d => d.name));
      const purchasers = bpRows
        .filter((bp: any) => !directNames.has(nm(bp.purchaserName)))
        .map((bp: any) => ({
          id: bp.id, name: nm(bp.purchaserName) || '客户', level: bp.level || 'B',
          contact: bp.purchaserContact, phone: bp.purchaserPhone, region: bp.region,
          credit: bp.credit !== undefined && bp.credit !== null ? Number(bp.credit) || 0 : 0,
        }));
      items = [...direct, ...purchasers].map((c: any, idx: number) => {
        const purchase = purchaseOf(c.name);
        const received = receivedOf(c.name);
        const occupied = occupiedOf(c.name);
        const credit = effectiveCredit(String(c.id || ''), c.name, c.credit);
        const remain = Math.round((credit + received - purchase - occupied) * 100) / 100;
        const debt = Math.max(0, Math.round((purchase - received) * 100) / 100);
        return {
          key: c.id || c.name, title: c.name,
          tag: c.level,
          cardBg: CARD_BGS[idx % CARD_BGS.length],
          // 第二行信用/剩余额度、第三行采购总额/应收欠款（用户指定）
          sub: [`信用额度 ${yuan(credit)}　剩余额度 ${yuan(remain)}`, `采购总额 ${yuan(purchase)}　应收欠款 ${yuan(debt)}`],
          subSizes: [13, 13],
          fields: [
            ['客户名称', c.name], ['等级', pick(c.level, '—')], ['客户编号', String(c.id || '—')],
            ['联系人', pick(c.contact, '—')], ['电话', pick(c.phone, '—')], ['地区', pick(c.region, '—')],
            ['信用额度', yuan(credit)], ['剩余额度', yuan(remain)],
            ['采购总额', yuan(purchase)], ['已收货款', yuan(received)], ['订单占用', yuan(occupied)], ['应收欠款', yuan(debt)],
          ] as [string, string][],
        };
      });
    } else if (page === 'bill-detail' || page === 'reconciliation') {
      // 账单明细/对账管理：与 Web 账单明细同键（pageData_customer_bill-detail）；extra=客户名时按客户过滤（客户卡入口带入）
      const rows = await readRows(`pageData_customer_bill-detail_${owner}`);
      const extraCust = String(req.query.extra || '').trim();
      items = rows
        .filter((r: any) => !extraCust || String(r.customerName || '').trim() === extraCust)
        .map((r: any) => {
          const amt = Number(r.totalAmount) || 0;
          return page === 'bill-detail' ? {
            key: r.key || r.id, title: r.outboundNo || r.id || '账单',
            tag: r.reconResult || '待对账',
            sub: [String(r.customerName || ''), day10(r.outboundDate), `商品总额 ${yuan(amt)}`].filter(Boolean) as string[],
            subSizes: [13, 13, 13],
            fields: [
              ['出库单号', r.outboundNo || '—'], ['关联订单', r.id || '—'], ['客户', r.customerName || '—'],
              ['出库日期', day10(r.outboundDate) || '—'], ['总数量', String(Number(r.totalCount) || 0)],
              ['商品总额', yuan(amt)], ['货品明细', String(r.productDetail || '—')],
              ['对账结果', r.reconResult || '待对账'], ['差异说明', r.diffDesc || '—'],
            ] as [string, string][],
          } : {
            key: r.key || r.id, title: String(r.customerName || '客户'),
            tag: r.reconResult || '待对账',
            sub: [r.outboundNo || r.id, day10(r.outboundDate), yuan(amt)].filter(Boolean) as string[],
            subSizes: [13, 13, 13],
            fields: [
              ['客户', r.customerName || '—'], ['出库单号', r.outboundNo || '—'], ['关联订单', r.id || '—'],
              ['出库日期', day10(r.outboundDate) || '—'], ['商品总额', yuan(amt)],
              ['对账结果', r.reconResult || '待对账'], ['差异说明', r.diffDesc || '—'],
              ['供应商对账人', r.supplierReconPerson || '—'], ['采购商对账人', r.purchaserReconPerson || '—'],
              ['确认时间', r.confirmTime || '—'],
            ] as [string, string][],
          };
        });
    } else if (page === 'molds') {
      // 模具管理：与 Web MoldPage 同源服务端权威真表（molds 表，/api/molds 同库同记录结构）
      const moldRows = await listMolds(owner);
      items = moldRows.map((row: any) => {
        let r: any = {};
        try { r = JSON.parse(row.record_json || '{}'); } catch { r = {}; }
        const imgCount = Array.isArray(r.images) ? r.images.length : 0;
        return {
          key: r.key || row.mold_key, title: pick(r.moldName, r.moldCode) || '模具',
          tag: r.status,
          sub: [
            [r.moldCode, r.spec].filter(Boolean).join('　'),
            `数量 ${Number(r.totalQuantity) || 0}　创建人 ${pick(r.creator, '—')}`,
          ].filter(Boolean) as string[],
          subSizes: [13, 13],
          fields: [
            ['模具编号', r.moldCode || '—'], ['模具名称', r.moldName || '—'], ['规格型号', r.spec || '—'],
            ['模具数量', String(Number(r.totalQuantity) || 0)], ['状态', r.status || '—'],
            ['图片数', String(imgCount)], ['备注', r.remark || '—'],
            ['创建人', r.creator || '—'], ['创建时间', String(r.createdAt || '—')],
          ] as [string, string][],
        };
      });
    } else {
      res.status(404).json({ code: 404, message: '未知列表页' });
      return;
    }
    items = items.map(it => ({ ...it, tone: it.tone || toneOf(it.tag) }));
    // 生产订单/采购订单单页上限 20 条（用户指定），其余列表页保持 100
    const data: { list: ListItem[]; total: number; sums?: string[] } = finishList(items, q, page === 'production' || page === 'purchase' ? 20 : 100);
    if (sums) data.sums = sums;
    res.json({ code: 200, data });
  } catch (err: any) {
    console.error('[wx] lists error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 站内聊天（市场「联系」：与 Web ChatPage 同一份消息库，HTTP 通道 + 客户端轮询） ============

/** 会话归属账号：子账号沿用 Web 口径以主账号建会话，保证手机/网页看到的是同一个会话 */
function chatConvUser(user: JWTPayload): string {
  const owner = String(user.owner || '');
  return owner && owner !== user.username ? owner : user.username;
}

const toMiniMsg = (m: any, mineUsernames: Set<string>) => ({
  id: String(m.id || ''), from: String(m.from_user || ''), to: String(m.to_user || ''),
  content: String(m.content || ''), type: String(m.msg_type || 'text'),
  subject: String(m.conv_subject || ''), ts: Number(m.created_at) || 0,
  mine: mineUsernames.has(String(m.from_user || '')),
});

/** GET /api/wx/chat/history?to=xxx&limit=50 —— 与指定账号的会话历史（时间升序）+ 对方展示信息 */
router.get('/chat/history', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const to = String(req.query.to || '');
    if (!to) { res.status(400).json({ code: 400, message: '缺少联系对象' }); return; }
    const convUser = chatConvUser(user);
    const convId = makeConvId(convUser, to);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = await chatHistory(convId, undefined, limit);
    const users = await readRows('registeredUsers');
    const hit: any = users.find((u: any) => u && u.username === to) || {};
    const mineSet = new Set([user.username, convUser]);
    res.json({ code: 200, data: {
      convId,
      other: { username: to, name: await displayNameOf(to), company: String(hit.companyName || ''), online: isUserOnline(to) },
      messages: rows.map((m: any) => toMiniMsg(m, mineSet)),
    } });
  } catch (err: any) {
    console.error('[wx] chat history error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/chat/send {to, content, msg_type, subject} —— 发送站内消息
 *  与 Web 同口径：文本过内容审核（403 不落库），落库后接收方在线则实时推送，否则等对方拉历史 */
router.post('/chat/send', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const to = String(req.body?.to || '');
    const content = String(req.body?.content || '');
    const msgType = req.body?.msg_type === 'image' ? 'image' : 'text';
    const subject = String(req.body?.subject || '');
    const convUser = chatConvUser(user);
    if (!to || !content) { res.status(400).json({ code: 400, message: '缺少联系对象或消息内容' }); return; }
    if (to === convUser) { res.status(400).json({ code: 400, message: '不能联系自己' }); return; }
    if (msgType === 'text') {
      const chk = checkChatContent(content);
      if (chk.blocked) { res.status(403).json({ code: 403, message: blockReason(chk) }); return; }
    }
    const saved = await chatSaveMessage({
      from_user: user.username, to_user: to, content, msg_type: msgType,
      conv_subject: subject, conv_from_user: convUser,
    });
    pushSavedToRecipient(saved);
    res.json({ code: 200, data: { saved: true, message: toMiniMsg(saved, new Set([user.username, convUser])) } });
  } catch (err: any) {
    console.error('[wx] chat send error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/chat/read {to} —— 标记会话已读（与 Web 同一张 chat_messages） */
router.post('/chat/read', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const to = String(req.body?.to || '');
    if (!to) { res.status(400).json({ code: 400, message: '缺少联系对象' }); return; }
    await chatMarkRead(makeConvId(chatConvUser(user), to), user.username);
    res.json({ code: 200, data: { saved: true } });
  } catch (err: any) {
    console.error('[wx] chat read error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/chat/conversations —— 会话列表（我的消息）：与 Web ChatPage 左列同一份会话，附加对方展示信息与在线状态 */
router.get('/chat/conversations', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const convs = await chatConvs(user.username);
    const users = await readRows('registeredUsers');
    const coOf = (u: string) => {
      const h: any = users.find((x: any) => x && x.username === u) || {};
      return String(h.companyName || '');
    };
    const list = [];
    for (const c of convs) {
      list.push({
        convId: String(c.convId || ''),
        other: { username: c.otherUser, name: await displayNameOf(c.otherUser), company: coOf(c.otherUser), online: isUserOnline(c.otherUser) },
        lastMessage: String(c.lastMessage || ''),
        lastMessageType: String(c.lastMessageType || 'text'),
        lastTime: Number(c.lastTime) || 0,
        subject: String(c.subject || ''),
        unread: Number(c.unreadCount) || 0,
      });
    }
    res.json({ code: 200, data: { list } });
  } catch (err: any) {
    console.error('[wx] chat conversations error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/chat/unread —— 总未读数（「我的」Tab 气泡与消息列表角标共用同一口径） */
router.get('/chat/unread', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const count = await chatUnread(user.username);
    res.json({ code: 200, data: { count: Number(count) || 0 } });
  } catch (err: any) {
    console.error('[wx] chat unread error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
