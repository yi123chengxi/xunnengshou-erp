import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { store } from '../database/store';
import { getJwtSecret } from '../utils/jwtSecret';

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

/** 解析数据归属账号：子账号沿 parentAccount 链追溯到真正的主账号 */
async function resolveOwner(username: string): Promise<string> {
  try {
    const rec = await store.getDataset('registeredUsers');
    if (!rec) return username;
    const users: any[] = JSON.parse(rec.dataset_json || '[]');
    if (!Array.isArray(users)) return username;
    let cur = username;
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const u = users.find((x: any) => x && x.username === cur);
      if (!u || !u.isSubAccount || !u.parentAccount) break;
      cur = String(u.parentAccount);
    }
    return cur || username;
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

// ============ 路由 ============
const router = Router();

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

    // 1. 在 mock 用户中查找
    const mockUser = MOCK_USERS.find(u => u.username === username && u.password === password);
    if (mockUser) {
      const token = signToken(mockUser.username, mockUser.role, mockUser.username);
      res.json({
        code: 200,
        data: {
          token,
          user: { username: mockUser.username, role: mockUser.role, name: mockUser.name, company_name: mockUser.company_name },
        },
        message: '登录成功',
      });
      return;
    }

    // 2. 在 registered_users 表中查找
    const dbUser = await store.getUser(username) as {
      username: string; password: string; role: string;
      company_name: string; contact_person: string; status: string;
    } | undefined;

    if (dbUser) {
      if (dbUser.status !== 'active') {
        res.status(403).json({ code: 403, message: '该账号已被禁用' });
        return;
      }

      // 验证密码（支持 bcrypt 和明文两种，兼容历史数据）
      let passwordValid = false;
      if (dbUser.password.startsWith('$2a$') || dbUser.password.startsWith('$2b$')) {
        passwordValid = await bcrypt.compare(password, dbUser.password);
      } else {
        passwordValid = dbUser.password === password;
      }

      if (!passwordValid) {
        res.status(401).json({ code: 401, message: '用户名或密码错误' });
        return;
      }

      const token = signToken(dbUser.username, dbUser.role, await resolveOwner(dbUser.username));
      res.json({
        code: 200,
        data: {
          token,
          user: {
            username: dbUser.username,
            role: dbUser.role,
            name: dbUser.contact_person || dbUser.company_name || dbUser.username,
            company_name: dbUser.company_name,
          },
        },
        message: '登录成功',
      });
      return;
    }

    // 3. Web 端注册账号（全局同步数据集 registeredUsers）：兼容 bcrypt 哈希与历史明文两种存储
    //    打印客户端等非网页入口必须能登录 Web 注册的账号，否则出现"用户名或密码错误"
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
            // 历史数据：明文密码（登录成功后会随下一次同步被服务端哈希化）
            ok = storedPlain === String(password || '');
          }
          if (!ok) {
            res.status(401).json({ code: 401, message: '用户名或密码错误' });
            return;
          }
          let role = String(hit.role || 'supplier');
          if (role === 'supplier,purchaser' || role === 'purchaser,supplier') role = 'both';
          const token = signToken(hit.username, role, await resolveOwner(hit.username));
          res.json({
            code: 200,
            data: {
              token,
              user: {
                username: hit.username,
                role,
                name: hit.contactPerson || hit.companyName || hit.displayName || hit.username,
                company_name: hit.companyName || '',
              },
            },
            message: '登录成功',
          });
          return;
        }
      }
    } catch (e: any) {
      console.error('[auth] registeredUsers 数据集读取失败:', e.message);
    }

    res.status(401).json({ code: 401, message: '用户名或密码错误' });
    return;
  } catch (err: any) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * GET /api/auth/me
 * 返回当前用户信息（需 JWT）
 */
router.get('/me', verifyJWT, (req: Request, res: Response) => {
  const user = (req as any).user as JWTPayload;
  res.json({ code: 0, data: { username: user.username, role: user.role, owner: user.owner || user.username } });
});

export default router;
