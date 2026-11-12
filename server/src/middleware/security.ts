/**
 * 基础安全中间件（不引入额外 npm 依赖，避免 CI 的 npm ci 因 lockfile 未更新失败）：
 * - securityHeaders：通用安全响应头（禁止 MIME 嗅探、禁止被第三方 iframe 嵌入等）
 * - corsGuard：CORS 白名单（同源请求不受影响；跨域仅放行 localhost 开发端口 / file:// 打印客户端 / 环境变量白名单）
 * - rateLimit：进程内固定窗口限流（单实例部署足够；多实例需换共享存储）
 */
import { Request, Response, NextFunction } from 'express';

// ============ 安全响应头 ============

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // 仅在确实走 HTTPS 时下发 HSTS（Nginx 反代场景看 X-Forwarded-Proto），避免内网 HTTP 部署被锁死
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '');
  if (proto.split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

// ============ CORS 白名单 ============

const blockedLogAt = new Map<string, number>();

function envOrigins(): string[] {
  return String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function isLocalDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string): boolean {
  if (process.env.NODE_ENV !== 'production') return true; // 开发/自建环境保持宽松，避免本地调试被拦
  if (process.env.CORS_ALLOW_ANY === '1') return true; // 应急开关：白名单配错时可临时放开
  if (origin === 'null') return true; // file:// 打印客户端（Electron）请求 Origin 为 null
  if (isLocalDevOrigin(origin)) return true;
  return envOrigins().includes(origin.replace(/\/$/, ''));
}

/**
 * CORS 白名单守卫（替代原先全放开的 cors()）：
 * 同源请求不依赖 CORS 响应头，因此不在白名单里的跨域来源只会被浏览器拦截，不会影响本系统页面。
 */
export function corsGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = String(req.headers.origin || '');
  if (!origin) { next(); return; }

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,X-Username');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
    return;
  }

  // 未放行的跨域来源：记录（同来源 5 分钟最多一条），预检直接拒绝
  const now = Date.now();
  if (now - (blockedLogAt.get(origin) || 0) > 5 * 60_000) {
    blockedLogAt.set(origin, now);
    console.warn(`[security] 已拦截未在白名单的跨域来源 ${origin}（如需放行请配置环境变量 CORS_ORIGINS）`);
  }
  if (req.method === 'OPTIONS') { res.status(403).end(); return; }
  next();
}

// ============ 进程内限流 ============

interface Bucket { count: number; resetAt: number; }

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string;
  message?: string;
}

function clientIp(req: Request): string {
  // app.set('trust proxy', 1) 已由 Express 解析 X-Forwarded-For，避免直接信任客户端伪造头
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, name } = options;
  const message = options.message || '操作过于频繁，请稍后再试';

  // 定期清理过期桶，避免长期运行内存膨胀
  const timer = setInterval(() => {
    const now = Date.now();
    buckets.forEach((b, k) => { if (b.resetAt <= now) buckets.delete(k); });
  }, Math.max(windowMs, 60_000));
  if (typeof (timer as any).unref === 'function') (timer as any).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ code: 429, message });
      return;
    }
    next();
  };
}
