import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router();

// ============ 聚水潭开放平台配置（默认使用沙箱公共测试账号） ============
// 测试环境网关 / 沙箱 appKey / appSecret（聚水潭开放平台沙箱提供，可直接调试）
const JST_SERVER_URL = process.env.JST_SERVER_URL || 'https://dev-api.jushuitan.com';
const JST_OPENWEB_URL = process.env.JST_OPENWEB_URL || 'https://openweb.jushuitan.com';
const JST_APP_KEY = process.env.JST_APP_KEY || 'b0b7d1db226d4216a3d58df9ffa2dde5';
const JST_APP_SECRET = process.env.JST_APP_SECRET || '99c4cef262f34ca882975a7064de0b87';
// 沙箱公共测试 access_token（平台提供，可直接拉取测试数据）
const JST_ACCESS_TOKEN = process.env.JST_ACCESS_TOKEN || 'b7e3b1e24e174593af8ca5c397e53dad';

// 兼容 Node18+ 全局 fetch
const doFetch: any = (globalThis as any).fetch;

// ============ 签名算法（与聚水潭开放平台一致） ============
// 规则：参数名 ASCII 升序排序，拼接 secret + key1 + value1 + key2 + value2 ...，MD5 32位小写
function jstSign(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).sort();
  let s = secret;
  for (const k of keys) {
    const v = params[k];
    if (k && v) s += k + v;
  }
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function nowSec(): string {
  return String(Math.floor(Date.now() / 1000));
}

// 表单编码 POST
async function postForm(url: string, params: Record<string, string>): Promise<any> {
  const body = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

// ============ 接口 ============

// 返回当前配置（供前端展示，secret 打码）
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    code: 200,
    data: {
      serverUrl: JST_SERVER_URL,
      openWebUrl: JST_OPENWEB_URL,
      appKey: JST_APP_KEY,
      appSecretMasked: JST_APP_SECRET.slice(0, 6) + '******' + JST_APP_SECRET.slice(-4),
      hasDefaultToken: !!JST_ACCESS_TOKEN,
      env: '测试环境(沙箱)',
    },
  });
});

// 生成业务授权 URL（商家登录授权后回调返回 code）
router.post('/authUrl', (req: Request, res: Response) => {
  try {
    const state = req.body?.state || 'factory-erp';
    const params: Record<string, string> = {
      app_key: JST_APP_KEY,
      timestamp: nowSec(),
      charset: 'utf-8',
      state,
    };
    params.sign = jstSign(params, JST_APP_SECRET);
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    res.json({ code: 200, data: { url: `${JST_OPENWEB_URL}/auth?${qs}` } });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 用授权 code 换取 access_token
router.post('/token', async (req: Request, res: Response) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ code: 400, message: '缺少授权 code' });
    const params: Record<string, string> = {
      app_key: JST_APP_KEY,
      timestamp: nowSec(),
      grant_type: 'authorization_code',
      charset: 'utf-8',
      code,
    };
    params.sign = jstSign(params, JST_APP_SECRET);
    const data = await postForm(`${JST_SERVER_URL}/openWeb/auth/accessToken`, params);
    res.json({ code: 200, data });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 通用业务接口代理：{ path, biz, accessToken }
router.post('/call', async (req: Request, res: Response) => {
  try {
    const { path, biz, accessToken } = req.body || {};
    if (!path) return res.status(400).json({ code: 400, message: '缺少接口路径 path' });
    const bizStr = typeof biz === 'string' ? biz : JSON.stringify(biz || {});
    const params: Record<string, string> = {
      app_key: JST_APP_KEY,
      access_token: accessToken || JST_ACCESS_TOKEN,
      timestamp: nowSec(),
      version: '2',
      charset: 'utf-8',
      biz: bizStr,
    };
    params.sign = jstSign(params, JST_APP_SECRET);
    const data = await postForm(`${JST_SERVER_URL}${path}`, params);
    res.json({ code: 200, data });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

export default router;
