import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { store } from '../database/store';
import { verifyJWT, verifyCredentials, issueToken, JWTPayload } from './auth.routes';
import { getJwtSecret } from '../utils/jwtSecret';
import { resolveCompanyRoot } from '../services/storageUsage';

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
    const rows = await readRows(type === 'reimbursement' ? `reimbursement_${owner}` : `payment_requests_${owner}`);
    let list = rows.map((r: any) => toApprovalItem(type, r));
    if (tab === 'pending') list = list.filter((it: any) => isPendingItem(type, rows.find((r: any) => r.key === it.key)));
    else if (tab === 'processed') list = list.filter((it: any) => !isPendingItem(type, rows.find((r: any) => r.key === it.key)));
    else if (tab === 'mine') list = list.filter((it: any) => it.applicant === user.username);
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
      productStatus: r.productStatus || '', stock: typeof r.stock === 'number' ? r.stock : undefined,
    }));
    res.json({ code: 200, data: { list, total: hit.length } });
  } catch (err: any) {
    console.error('[wx] inventory error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/wx/orders?q= —— 订单列表模糊查询（单号/客户） */
router.get('/orders', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await readRows(`pageData_sales_order-manage_${owner}`);
    const hit = q
      ? rows.filter((r: any) => `${r.orderNo || ''}${r.customerName || ''}`.toLowerCase().includes(q))
      : rows;
    const list = hit.slice(0, 50).map((r: any) => ({
      key: r.key, orderNo: r.orderNo || '', customerName: r.customerName || '',
      createTime: r.createTime || '', salesAmount: Number(r.salesAmount) || 0,
      status: r.status || '', person: r.person || '',
    }));
    res.json({ code: 200, data: { list, total: hit.length } });
  } catch (err: any) {
    console.error('[wx] orders error:', err.message);
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

/** GET /api/wx/market?type=finished|semi|mold —— 商机市场三列表（成品/发包/模具租售） */
router.get('/market', verifyJWT, async (req: Request, res: Response) => {
  try {
    const type = String(req.query.type || 'finished');
    const companies = await companyMap();
    const coOf = (r: any) => r.publisherCompany || companies[r.publisherUsername] || r.publisherUsername || '';
    if (type === 'mold') {
      const rows = await readRows('market_mold_listings');
      const list = rows.slice(0, 50).map((r: any) => ({
        id: r.key || r.id, title: r.title || r.name || r.moldName || '模具租售',
        price: Number(r.price || r.targetPrice) || 0, publisherCompany: coOf(r),
        publishTime: r.publishTime || r.createTime || '', status: r.status || '',
      }));
      res.json({ code: 200, data: { list } });
      return;
    }
    const rows = (await readRows('market_publish_orders')).filter((r: any) => r.type === type && r.delisted !== true && r.status !== '已中标');
    const list = rows.slice(0, 50).map((r: any) => ({
      id: r.id || r.key, styleCode: r.styleCode || '', shortName: r.shortName || '',
      quantity: Number(r.quantity) || 0, targetPrice: Number(r.targetPrice) || 0,
      publisherCompany: coOf(r), publishTime: r.publishTime || '', status: r.status || '',
      quoteCount: Array.isArray(r.quotes) ? r.quotes.length : 0,
    }));
    res.json({ code: 200, data: { list } });
  } catch (err: any) {
    console.error('[wx] market error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============ 上下班打卡 ============

/** GET /api/wx/attendance —— 本人今日打卡记录 */
router.get('/attendance', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const ymd = localYmd();
    const rows = await readRows(`attendance_${owner}`);
    const rec = rows.find((r: any) => r.username === user.username && r.date === ymd) || null;
    res.json({ code: 200, data: { record: rec, date: ymd } });
  } catch (err: any) {
    console.error('[wx] attendance get error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/wx/attendance {type:'in'|'out'} —— 上班/下班打卡（上班取首次，下班取最新） */
router.post('/attendance', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const type = req.body.type === 'out' ? 'out' : 'in';
    const dsKey = `attendance_${owner}`;
    const rows = await readRows(dsKey);
    const ymd = localYmd();
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let rec = rows.find((r: any) => r.username === user.username && r.date === ymd);
    if (!rec) {
      rec = { key: `${user.username}-${ymd}`, username: user.username, name: await displayNameOf(user.username), date: ymd, in: '', out: '' };
      rows.unshift(rec);
    }
    if (type === 'in') { if (!rec.in) rec.in = hm; }
    else { rec.out = hm; }
    await writeRows(dsKey, rows, owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
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

/** POST /api/wx/leaves/:key/audit {approved} —— 审批写入字段与 Web 逐字段同名 */
router.post('/leaves/:key/audit', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const approved = req.body.approved === true;
    const dsKey = `hr_leaves_${owner}`;
    const rows = await readRows(dsKey);
    const rec = rows.find((r: any) => String(r.key) === req.params.key);
    if (!rec) { res.status(404).json({ code: 404, message: '请假单不存在或已删除' }); return; }
    if (rec.status !== 'pending') { res.status(409).json({ code: 409, message: '该请假单已审批' }); return; }
    rec.status = approved ? 'approved' : 'rejected';
    rec.approvedBy = user.username;
    rec.approvedAt = new Date().toISOString();
    await writeRows(dsKey, rows, owner);
    res.json({ code: 200, data: { saved: true, record: rec } });
  } catch (err: any) {
    console.error('[wx] leave audit error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
