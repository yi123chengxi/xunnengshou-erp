/**
 * /api/sync 访问控制：
 * - 解析/校验 JWT（可选与强制两种挂载方式）
 * - 数据集键的公开/共享/私有归属判定（与客户端 serverSync.ts 的 keyOwner 语义保持一致）
 * - registeredUsers 数据集与 registered_users 表的密码哈希化、读取脱敏
 *
 * 背景：原先 /api/sync/* 完全无鉴权，任何人可匿名读写全部租户数据；且 registeredUsers 以明文密码
 * 全量同步到每个浏览器。此处把「匿名可访问」收敛到市场/打印模板/注册账号元数据等公开键。
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getJwtSecret } from '../utils/jwtSecret';

export interface SyncUser {
  username: string;
  role: string;
  /** 数据归属账号：子账号为主账号，主账号为自己 */
  owner: string;
}

export interface SyncJWTPayload extends SyncUser {
  iat?: number;
  exp?: number;
}

// ============ 令牌解析 ============

/** 解析 Authorization: Bearer <token>；无效/过期返回 null，不抛错 */
export function readSyncUser(req: Request): SyncUser | null {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as SyncJWTPayload;
    const username = String(payload.username || '');
    if (!username) return null;
    return { username, role: String(payload.role || ''), owner: String(payload.owner || username) };
  } catch {
    return null;
  }
}

/** 可选鉴权：有合法令牌就挂到 req.user，没有也放行（由具体键决定是否公开） */
export function attachSyncUser(req: Request, _res: Response, next: NextFunction): void {
  const user = readSyncUser(req);
  if (user) (req as any).user = user;
  next();
}

/** 强制鉴权：无合法令牌直接 401 */
export function requireSyncAuth(req: Request, res: Response, next: NextFunction): void {
  const user = readSyncUser(req);
  if (!user) {
    res.status(401).json({ code: 401, message: '未登录或登录已过期，请重新登录' });
    return;
  }
  (req as any).user = user;
  next();
}

export function currentSyncUser(req: Request): SyncUser | null {
  return ((req as any).user as SyncUser) || null;
}

// ============ 键分类 ============

/** 匿名可读写的键（访客分享页、打印模板、注册账号元数据） */
const PUBLIC_EXACT = new Set([
  'registeredUsers',
  'market_publish_orders', 'market_ratings', 'market_trade_orders',
  'market_visitor_cart_shares', 'market_mold_listings',
]);
const PUBLIC_PREFIXES = ['market_', 'print_template_'];

export function isPublicKey(key: string): boolean {
  if (PUBLIC_EXACT.has(key)) return true;
  return PUBLIC_PREFIXES.some(p => key.startsWith(p));
}

/** 跨租户共享键：客户端 keyOwner() 对这些键返回 null（全局数据/双方协作数据） */
const SHARED_EXACT = new Set([
  'registeredUsers', 'subscription_orders', 'storage_orders', 'purchaser_pushed_orders',
  'cooperation_applications', 'cooperation_invites', 'recon_records', 'recon_feedback', 'company_renames',
]);
const SHARED_PREFIXES = [
  'market_', 'recon_db_', 'print_template_', 'dev_', 'cooperation_', 'brandauth_',
  // 双方协作链路会写入对方账号下的数据（供应商推送账单、收款/付款申请、发票、绑定关系等）
  'purchaser_bills_', 'payment_requests_', 'payment_request_managers_',
  'invoice_record_', 'invoice_apply_requests_', 'purchaser_suppliers_', 'boundPurchasers_',
  'published_credit_', 'credit_adjustments_', 'price_strategy_',
  'roles_', 'role_permsettings_', 'preset_role_overrides_',
  // 跨租户协作 / 开发者后台需要跨账号读取的业务键（后缀是对方账号，不能按末段判归属）
  'bound_purchasers_', 'independent_purchasers_',
  'month_end_return_', 'month_end_ship_', 'recharge_record_',
];

/** 严格私有：只允许本租户读写（跨租户不会访问这些键）
 *  注意：user_notice_ 的键格式为 user_notice_<账号>_<id>，末段不是账号，且开发者后台会代写他人通知，未纳入严格私有。 */
const STRICT_PRIVATE_PREFIXES = [
  'customers_', 'accounts_', 'withdrawal_record_', 'month_end_check_',
  'shop_info_', 'shop_profit_', 'inventory_check_', 'stock_change_log_', 'sales_outbound_',
  'customerReceipts_', 'supplier_payments_', 'warehouses_', 'hr_', 'newstyle_', 'custom_',
  'notification_settings_',
  // 图片空间索引（图片空间页面走 /api/images；此处防止经 /api/sync 直读他人图片清单）
  'image_assets_',
  // 财务/账务/业务配置（本租户独有，不允许跨租户读写）
  'reimbursement_', 'daily_bookkeeping_', 'daily_book_categories_', 'daily_book_main_categories_',
  'general_ledger_subjects_', 'ledger_auto_subjects_', 'ledger_mode_', 'ledger_period_amounts_',
  'other_payables_', 'other_receivables_', 'customer_statements_', 'autoReconSettings_',
  'batchAddTemplates_', 'orderQtyTemplates_', 'billQtyTemplates_', 'addColorSpecTemplates_',
  'order_tags_', 'tax_rate_templates_', 'productionFeeQty_', 'production_schedule_lines_',
  'sb_deferred_', 'account_groups_', 'customBanks_', 'picking_reject_reasons_', 'prBomManualQty_',
  // 产品 BOM 与列/字段配置（键末段为账号，不得跨租户读取）
  'bom_', 'mainTablePageSize_', 'bomPrintCols_', 'billDetailColConfig_', 'prBomFieldConfig_',
  'billAddColConfig_', 'pickListFields_',
];

/** 键的归属账号；共享键返回 null（与客户端 keyOwner 一致：取最后一个下划线后的账号名） */
export function keyOwnerOf(key: string): string | null {
  if (SHARED_EXACT.has(key)) return null;
  if (SHARED_PREFIXES.some(p => key.startsWith(p))) return null;
  const idx = key.lastIndexOf('_');
  if (idx < 0) return key;
  return key.slice(idx + 1);
}

function isStrictPrivateKey(key: string): boolean {
  return STRICT_PRIVATE_PREFIXES.some(p => key.startsWith(p));
}

export type SyncAction = 'read' | 'write' | 'delete';

/**
 * 判定当前用户能否对该键执行动作：
 * - 公开键：匿名即可（market_* 访客下单/加购、print_template_* 打印模板、registeredUsers 注册）
 * - 共享键：需要登录
 * - 严格私有键：需要登录且归属账号必须是自己/自己所在的父账号
 * - 其余租户协作键：需要登录（对方账号下的账单/对账/品牌授权等链路按既有业务语义放行）
 */
export function isKeyAllowed(key: string, user: SyncUser | null, action: SyncAction): boolean {
  if (!key) return false;
  if (isPublicKey(key)) return true;
  if (!user) return false;
  if (action === 'read') {
    const owner = keyOwnerOf(key);
    if (owner === null) return true; // 共享键
    if (owner === user.owner || owner === user.username) return true;
    return !isStrictPrivateKey(key);
  }
  if (action === 'write') {
    const owner = keyOwnerOf(key);
    if (owner === null || owner === user.owner || owner === user.username) return true;
    return !isStrictPrivateKey(key);
  }
  // delete：破坏性操作，必须登录；仅严格私有键额外校验归属（其余协作/复合键按既有业务语义放行）
  const owner = keyOwnerOf(key);
  if (owner === null) return true;
  if (owner === user.owner || owner === user.username) return true;
  return !isStrictPrivateKey(key);
}

/** 元信息过滤：匿名只给公开键；登录用户给公开 + 共享 + 自己可读的键 */
export function filterMetaForUser(meta: Record<string, number>, user: SyncUser | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(meta)) {
    if (user ? isKeyAllowed(key, user, 'read') : isPublicKey(key)) out[key] = meta[key];
  }
  return out;
}

// ============ 密码哈希 / 脱敏 ============

const BCRYPT_ROUNDS = 10;
const hashCache = new Map<string, string>(); // sha256(明文) → bcrypt 哈希（同一明文复用，避免每次上传重复计算）

function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

function cacheKeyOf(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

export async function hashPassword(plain: string): Promise<string> {
  const key = cacheKeyOf(plain);
  const hit = hashCache.get(key);
  if (hit) return hit;
  const hash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
  if (hashCache.size > 500) hashCache.clear();
  hashCache.set(key, hash);
  return hash;
}

/** 读取脱敏：去掉 password / passwordHash，客户端不再拿到任何密码凭据 */
export function sanitizeRegisteredUsersJson(json: string): string {
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return json;
    const cleaned = list.map((u: any) => {
      if (!u || typeof u !== 'object') return u;
      const clone: any = { ...u };
      delete clone.password;
      delete clone.passwordHash;
      return clone;
    });
    return JSON.stringify(cleaned);
  } catch {
    return json;
  }
}

/**
 * 写入前处理 registeredUsers：
 * - 明文 password → bcrypt passwordHash，并从记录中删除 password
 * - 明文缺省时沿用服务端已有哈希（客户端拉到的记录本就没有密码凭据）
 * - 服务端存量明文密码顺带升级为哈希
 */
export async function hashRegisteredUsersJson(json: string, existingJson?: string | null): Promise<string> {
  let incoming: any;
  try { incoming = JSON.parse(json); } catch { return json; }
  if (!Array.isArray(incoming)) return json;

  const existingByName = new Map<string, any>();
  if (existingJson) {
    try {
      const old = JSON.parse(existingJson);
      if (Array.isArray(old)) old.forEach((u: any) => { if (u && u.username) existingByName.set(String(u.username), u); });
    } catch { /* ignore */ }
  }

  const out: any[] = [];
  for (const rec of incoming) {
    if (!rec || typeof rec !== 'object') { out.push(rec); continue; }
    const clone: any = { ...rec };
    const old = existingByName.get(String(clone.username || ''));
    const plain = typeof clone.password === 'string' ? clone.password : '';
    const oldHash = old && typeof old.passwordHash === 'string' && isBcryptHash(old.passwordHash) ? old.passwordHash : '';
    const oldPlain = old && typeof old.password === 'string' && !isBcryptHash(old.password) ? old.password : '';

    let hash = typeof clone.passwordHash === 'string' && isBcryptHash(clone.passwordHash) ? clone.passwordHash : '';
    if (!hash) {
      if (plain && !isBcryptHash(plain)) hash = await hashPassword(plain);
      else if (plain) hash = plain; // 客户端误传哈希本身
      else if (oldHash) hash = oldHash;
      else if (oldPlain) hash = await hashPassword(oldPlain);
    }
    delete clone.password;
    if (hash) clone.passwordHash = hash;
    out.push(clone);
  }
  return JSON.stringify(out);
}

/** registered_users 表：把存量明文密码升级为 bcrypt */
export async function upgradePlaintextUserTable(store: {
  getAllUsers: () => Promise<any[]>;
  updateUser: (patch: any, username: string) => Promise<any>;
}): Promise<number> {
  let upgraded = 0;
  try {
    const users = await store.getAllUsers();
    for (const u of users || []) {
      const pwd = String(u?.password || '');
      if (!pwd || isBcryptHash(pwd)) continue;
      const hash = await hashPassword(pwd);
      await store.updateUser({ password: hash }, String(u.username));
      upgraded++;
    }
  } catch (err: any) {
    console.error('[security] registered_users 明文密码升级失败:', err?.message || err);
  }
  return upgraded;
}
