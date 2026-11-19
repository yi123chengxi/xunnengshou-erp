import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { store } from '../database/store';
import { getJwtSecret } from '../utils/jwtSecret';
import { resolveCompanyRoot } from '../services/storageUsage';

dotenv.config();

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ============ Mock 用户（演示账号已取消：与客户端 Auth.tsx 的 mockUsers 空数组保持一致，
// 登录仅走 registered_users 表与 registeredUsers 数据集；admin 等演示身份不再可登录） ============
const MOCK_USERS: { username: string; password: string; role: string; name: string; company_name: string }[] = [];

// ============ JWT 中间件 ============
export interface JWTPayload {
  username: string;
  role: string;
  /** 数据归属账号：子账号为主账号，主账号为自己（/api/sync 的租户校验用） */
  owner?: string;
  iat?: number;
  exp?: number;
}

export function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: '未提供认证令牌' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ code: 401, message: '认证令牌无效或已过期' });
  }
}

// ============ 签发 JWT ============
function signToken(username: string, role: string, owner?: string): string {
  return jwt.sign({ username, role, owner: owner || username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

/** 解析数据归属账号：子账号沿 parentAccount 链追溯到真正的主账号。
 *  走 storageUsage 的 60s 缓存用户索引：/auth/me 与登录每次调用不再重复
 *  parse 数百 KB 的 registeredUsers JSON（刷新关键路径上的服务端 CPU 热点） */
async function resolveOwner(username: string): Promise<string> {
  try {
    return (await resolveCompanyRoot(username)) || username;
  } catch {
    return username;
  }
}

/** 供短信登录等其他入口签发令牌（角色/归属由调用方与数据集解析得出） */
export async function issueToken(username: string, role?: string): Promise<string> {
  let finalRole = String(role || '');
  if (!finalRole) {
    try {
      const dbUser = await store.getUser(username) as any;
      finalRole = String(dbUser?.role || 'supplier');
    } catch { finalRole = 'supplier'; }
  }
  return signToken(username, finalRole, await resolveOwner(username));
}

// ============ 凭据三源校验（mock → registered_users → registeredUsers 数据集）============
/** 所有凭据入口（网页登录 / 短信登录 / 微信小程序绑定）共用；校验顺序不可调整，
 *  口径与网页登录严格一致：明文直接比对、不校验 status（数据集 status 为中文审核态） */
export interface CredentialUser { username: string; role: string; name: string; company_name: string }
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<{ ok: true; user: CredentialUser } | { ok: false; status: number; message: string }> {
  // 1. mock 用户（演示账号已取消，数组恒空，保留分支以维持三源顺序契约）
  const mockUser = MOCK_USERS.find(u => u.username === username && u.password === password);
  if (mockUser) {
    return { ok: true, user: { username: mockUser.username, role: mockUser.role, name: mockUser.name, company_name: mockUser.company_name } };
  }

  // 2. registered_users 表
  const dbUser = await store.getUser(username) as {
    username: string; password: string; role: string;
    company_name: string; contact_person: string; status: string;
  } | undefined;
  if (dbUser) {
    if (dbUser.status !== 'active') return { ok: false, status: 403, message: '该账号已被禁用' };
    let passwordValid = false;
    if (dbUser.password.startsWith('$2a$') || dbUser.password.startsWith('$2b$')) {
      passwordValid = await bcrypt.compare(password, dbUser.password);
    } else {
      passwordValid = dbUser.password === password;
    }
    if (!passwordValid) return { ok: false, status: 401, message: '用户名或密码错误' };
    return {
      ok: true,
      user: {
        username: dbUser.username,
        role: dbUser.role,
        name: dbUser.contact_person || dbUser.company_name || dbUser.username,
        company_name: dbUser.company_name,
      },
    };
  }

  // 3. Web 端注册账号（全局同步数据集 registeredUsers）：兼容 bcrypt 哈希与历史明文两种存储
  try {
    const rec = await store.getDataset('registeredUsers');
    if (rec) {
      const users: any[] = JSON.parse(rec.dataset_json || '[]');
      const hit = Array.isArray(users) ? users.find((u: any) => u && u.username === username) : null;
      if (hit) {
        const storedHash = typeof hit.passwordHash === 'string' ? hit.passwordHash : '';
        const storedPlain = typeof hit.password === 'string' ? hit.password : '';
        let ok = false;
        if (storedHash && /^\$2[aby]\$/.test(storedHash)) {
          ok = await bcrypt.compare(String(password || ''), storedHash);
        } else if (storedHash) {
          ok = storedHash === String(password || '');
        } else if (storedPlain) {
          ok = storedPlain === String(password || '');
        }
        if (!ok) return { ok: false, status: 401, message: '用户名或密码错误' };
        let role = String(hit.role || 'supplier');
        if (role === 'supplier,purchaser' || role === 'purchaser,supplier') role = 'both';
        return {
          ok: true,
          user: {
            username: hit.username,
            role,
            name: hit.contactPerson || hit.companyName || hit.displayName || hit.username,
            company_name: hit.companyName || '',
          },
        };
      }
    }
  } catch (e: any) {
    console.error('[auth] registeredUsers 数据集读取失败:', e.message);
  }
  return { ok: false, status: 401, message: '用户名或密码错误' };
}

// ============ 开发者后台登录 ============
// 背景：开发者后台登录此前是纯前端校验，不签发 JWT——开发者后台浏览器对 /api/sync 而言是匿名会话，
// /sync/meta 只下发公开键，dev_feedback_*（共享键，需登录）永远拉不到，
// 表现为「子账号提交的意见反馈在开发者后台看不到」。此处提供服务端校验 + 令牌签发，
// 使开发者后台具备与业务登录同级的同步读写能力（dev_ 共享键登录即可读写）。

/** 主开发者凭据：环境变量优先，默认值与客户端 DevLogin 历史内置凭据一致 */
const DEV_ADMIN_USER = String(process.env.DEV_ADMIN_USER || 'yichengxi1@qq.com');
const DEV_ADMIN_PASS = String(process.env.DEV_ADMIN_PASS || 'Yi109342668');

/** 定长安全比较：避免凭据校验的计时侧信道 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

// ============ 路由 ============
const router = Router();

/**
 * POST /api/auth/dev-login
 * 开发者后台登录：主开发者凭据（环境变量）或开发者子账号（dev_sub_accounts 数据集），
 * 校验通过签发 JWT（username=dev 或子账号名，role='dev'，owner=归属主开发者）
 */
router.post('/dev-login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};
    const u = String(username || '').trim();
    const p = String(password || '');
    if (!u || !p) { res.status(400).json({ code: 400, message: '账号和密码不能为空' }); return; }
    if (safeEqual(u, DEV_ADMIN_USER) && safeEqual(p, DEV_ADMIN_PASS)) {
      const token = signToken('dev', 'dev', 'dev');
      res.json({ code: 200, data: { token, user: { username: 'dev', displayName: '主开发者', isSub: false, parentDev: 'dev' } }, message: '登录成功' });
      return;
    }
    // 开发者子账号：dev_sub_accounts 为 dev_ 前缀共享数据集（开发者后台「账号管理」写入并经同步落库）
    let subs: any[] = [];
    try {
      const row = await store.getDataset('dev_sub_accounts');
      const parsed = row ? JSON.parse(row.dataset_json || '[]') : [];
      subs = Array.isArray(parsed) ? parsed : [];
    } catch { subs = []; }
    const sub = subs.find((s: any) => s && s.username === u);
    if (sub && sub.status === 'normal' && safeEqual(p, String(sub.password || ''))) {
      const parentDev = String(sub.parentDev || 'dev');
      const token = signToken(sub.username, 'dev', parentDev);
      res.json({ code: 200, data: { token, user: { username: sub.username, displayName: sub.displayName || sub.username, isSub: true, parentDev } }, message: '登录成功' });
      return;
    }
    if (sub) { res.status(403).json({ code: 403, message: '该子账号已被禁用，请联系主开发者' }); return; }
    res.status(401).json({ code: 401, message: '开发者账号或密码错误' });
  } catch (err: any) {
    console.error('[auth] dev-login error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * POST /api/auth/login
 * 验证用户名密码，签发 JWT
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
      return;
    }
    const result = await verifyCredentials(String(username), String(password));
    if (!result.ok) {
      res.status(result.status).json({ code: result.status, message: result.message });
      return;
    }
    const u = result.user;
    const token = signToken(u.username, u.role, await resolveOwner(u.username));
    res.json({ code: 200, data: { token, user: u }, message: '登录成功' });
    return;
  } catch (err: any) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * GET /api/auth/me
 * 返回当前用户信息（需 JWT）
 * owner 一律由服务端沿 registeredUsers 的 parentAccount 链重算（不回显令牌声明）：
 * 历史令牌可能在子账号绑定父账号之前签发（owner=自己），若回显会把子账号
 * 钉死成主账号整整一个有效期，订单/报销写进个人桶而主账号看不到。
 */
router.get('/me', verifyJWT, async (req: Request, res: Response) => {
  const user = (req as any).user as JWTPayload;
  const owner = await resolveOwner(user.username);
  res.json({ code: 0, data: { username: user.username, role: user.role, owner } });
});

export default router;
