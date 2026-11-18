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
        image: (Array.isArray(r.images) && r.images[0]) || r.image || '',
        mode: r.mode || '',
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
      image: (Array.isArray(r.images) && r.images[0]) || r.image || '',
    }));
    res.json({ code: 200, data: { list } });
  } catch (err: any) {
    console.error('[wx] market error:', err.message);
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

// ============ 通用列表（只读，与 Web 各页同源同字段口径） ============

interface ListItem { key: string; title: string; sub: string[]; tag?: string; tone?: string; amount?: number }

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
function finishList(items: ListItem[], q: string): { list: ListItem[]; total: number } {
  const kw = q.trim().toLowerCase();
  const hit = kw
    ? items.filter(it => `${it.title} ${(it.sub || []).join(' ')} ${it.tag || ''}`.toLowerCase().includes(kw))
    : items;
  return { list: hit.slice(0, 100), total: hit.length };
}

const day10 = (v: any): string => pick(v).slice(0, 10);

/** GET /api/wx/lists/:page?q= —— 空白子菜单补齐：日常记账/生产订单/采购订单/新款进度/店铺/仓库统计/品牌/员工/客户 */
router.get('/lists/:page', verifyJWT, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JWTPayload;
    const owner = await ownerOf(user.username);
    const page = String(req.params.page || '');
    const q = String(req.query.q || '');
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
      const rows = await readRows(`pageData_production_production-order_${owner}`);
      items = rows.map((r: any) => {
        const qty = Number(r.planQuantity ?? r.quantity ?? r.productionQty) || 0;
        return {
          key: r.key || r.id, title: pick(r.id, r.orderNo, r.key) || '生产订单',
          tag: r.status,
          sub: [pick(r.styleCode, r.productCode, r.productName), qty ? `计划数量 ${qty}` : '',
            r.orderTag, day10(pick(r.createTime, r.date, r.createDate)), r.person].filter(Boolean) as string[],
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
      const rows = await readRows(`shop_info_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.shopName, title: pick(r.shopName, r.name) || '店铺',
        tag: r.platform,
        sub: [r.brand, r.person && `负责人:${r.person}`, r.status].filter(Boolean) as string[],
      }));
    } else if (page === 'warehouseStats' || page === 'warehouseStock') {
      const rows = (await readRows(`ws_stock_${owner}`)).filter((r: any) => inRange(day10(r.date)));
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
      const rows = (await readRows(`ws_pick_${owner}`)).filter((r: any) => inRange(day10(r.createdAt)));
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
      const rows = (await readRows(`ws_urgent_${owner}`)).filter((r: any) => inRange(day10(pick(r.date, r.qcDate))));
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
      items = persons.map(name => {
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
      const rows = await readRows(`customers_${owner}`);
      items = rows.map((r: any) => ({
        key: r.key || r.id || r.name, title: pick(r.name, r.customerName) || '客户',
        tag: r.level,
        sub: [r.id, r.contact, r.phone, r.region].filter(Boolean) as string[],
      }));
    } else {
      res.status(404).json({ code: 404, message: '未知列表页' });
      return;
    }
    items = items.map(it => ({ ...it, tone: it.tone || toneOf(it.tag) }));
    const data: { list: ListItem[]; total: number; sums?: string[] } = finishList(items, q);
    if (sums) data.sums = sums;
    res.json({ code: 200, data });
  } catch (err: any) {
    console.error('[wx] lists error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
