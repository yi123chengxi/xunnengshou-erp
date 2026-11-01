import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { stmtGetUser, stmtGetAllUsers, stmtGetDataset } from '../database/sqlite';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'factory-management-secret-key-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ============ Mock 用户（演示账号已取消：与客户端 Auth.tsx 的 mockUsers 空数组保持一致，
// 登录仅走 registered_users 表与 registeredUsers 数据集；admin 等演示身份不再可登录） ============
const MOCK_USERS: { username: string; password: string; role: string; name: string; company_name: string }[] = [];

// ============ JWT 中间件 ============
export interface JWTPayload {
  username: string;
  role: string;
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
function signToken(username: string, role: string): string {
  return jwt.sign({ username, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
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
      const token = signToken(mockUser.username, mockUser.role);
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
    const dbUser = stmtGetUser.get(username) as {
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

      const token = signToken(dbUser.username, dbUser.role);
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

    // 3. Web 端注册账号（全局同步数据集 registeredUsers）：与网页登录同口径——明文密码比对、不校验 status
    //    打印客户端等非网页入口必须能登录 Web 注册的账号，否则出现"用户名或密码错误"
    try {
      const rec = stmtGetDataset.get('registeredUsers') as { dataset_json: string } | undefined;
      if (rec) {
        const users: any[] = JSON.parse(rec.dataset_json || '[]');
        const hit = Array.isArray(users) ? users.find((u: any) => u && u.username === username) : null;
        if (hit) {
          if (String(hit.password || '') !== String(password || '')) {
            res.status(401).json({ code: 401, message: '用户名或密码错误' });
            return;
          }
          let role = String(hit.role || 'supplier');
          if (role === 'supplier,purchaser' || role === 'purchaser,supplier') role = 'both';
          const token = signToken(hit.username, role);
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
  res.json({ code: 0, data: { username: user.username, role: user.role } });
});

export default router;
