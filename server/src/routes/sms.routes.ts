/**
 * 短信验证码登录路由
 *
 * POST /api/sms/send-code  { phone }        — 发送登录验证码（限频：60s/条、10条/天）
 * POST /api/sms/login      { phone, code }  — 验证码校验通过后返回对应账号 username
 *
 * 验证码 5 分钟有效、最多错 5 次；服务端内存存储（重启即失效，属预期）。
 * 未配置阿里云短信（.env 缺 AccessKey/签名/模板）时 send-code 返回 devMode+devCode 便于联调。
 */
import { Router, Request, Response } from 'express';
import { isSmsConfigured, sendSmsCode } from '../services/aliyunSms';
import { store } from '../database/store';

const router = Router();

interface CodeRec { code: string; expiresAt: number; attempts: number; }
const codeStore = new Map<string, CodeRec>();
const sendThrottle = new Map<string, { last: number; day: string; count: number }>();

/** 按手机号查找账号（服务端用户表 + 客户端同步的 registeredUsers 数据集并集） */
async function findUsersByPhone(phone: string): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  try {
    for (const u of await store.getAllUsers()) {
      if (u && u.phone && String(u.phone) === phone && u.username && !seen.has(u.username)) {
        seen.add(u.username);
        out.push(u);
      }
    }
  } catch { /* ignore */ }
  try {
    const row = await store.getDataset('registeredUsers');
    if (row) {
      for (const u of JSON.parse(row.dataset_json || '[]')) {
        if (u && u.phone && String(u.phone) === phone && u.username && !seen.has(u.username)) {
          seen.add(u.username);
          out.push(u);
        }
      }
    }
  } catch { /* ignore */ }
  return out;
}

router.post('/send-code', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    if (!/^1\d{10}$/.test(phone)) { res.json({ code: 400, message: '请输入正确的11位手机号' }); return; }
    const users = await findUsersByPhone(phone);
    if (!users.length) { res.json({ code: 404, message: '该手机号未注册账号，请先注册或使用账号密码登录' }); return; }

    // 限频：同手机号 60 秒间隔、每日 10 条
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    const th = sendThrottle.get(phone);
    if (th && now - th.last < 60_000) { res.json({ code: 429, message: '短信发送过于频繁，请 60 秒后再试' }); return; }
    if (th && th.day === day && th.count >= 10) { res.json({ code: 429, message: '今日发送次数已达上限，请明天再试' }); return; }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (isSmsConfigured()) {
      const r = await sendSmsCode(phone, code);
      if (!r.ok) { res.json({ code: 500, message: `短信发送失败：${r.message || '请检查阿里云配置'}` }); return; }
    } else {
      // 开发模式：未配置阿里云短信时验证码随响应返回；生产环境严禁泄露验证码
      if (process.env.NODE_ENV === 'production') { res.json({ code: 503, message: '短信服务未配置，请联系管理员' }); return; }
      codeStore.set(phone, { code, expiresAt: now + 5 * 60_000, attempts: 0 });
      sendThrottle.set(phone, { last: now, day, count: (th && th.day === day ? th.count : 0) + 1 });
      res.json({ code: 0, data: { devMode: true, devCode: code }, message: '短信服务未配置（开发模式）' });
      return;
    }
    codeStore.set(phone, { code, expiresAt: now + 5 * 60_000, attempts: 0 });
    sendThrottle.set(phone, { last: now, day, count: (th && th.day === day ? th.count : 0) + 1 });
    res.json({ code: 0, message: '验证码已发送' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) { res.json({ code: 400, message: '手机号或验证码格式不正确' }); return; }
    const rec = codeStore.get(phone);
    if (!rec || Date.now() > rec.expiresAt) { codeStore.delete(phone); res.json({ code: 400, message: '验证码已过期，请重新获取' }); return; }
    if (rec.attempts >= 5) { codeStore.delete(phone); res.json({ code: 400, message: '验证码错误次数过多，请重新获取' }); return; }
    if (rec.code !== code) { rec.attempts += 1; res.json({ code: 400, message: '验证码不正确' }); return; }

    const users = await findUsersByPhone(phone);
    if (!users.length) { codeStore.delete(phone); res.json({ code: 404, message: '该手机号未注册账号' }); return; }
    // 多账号两段式：先返回候选名单，前端选定账号后带 username 重提（期间验证码不消费）
    let u = users[0];
    if (users.length > 1) {
      const pick = String(req.body?.username || '').trim();
      const usernames = users.map((x: any) => x.username);
      if (!pick) { res.json({ code: 409, message: '该手机号绑定了多个账号，请选择要登录的账号', data: { usernames } }); return; }
      const picked = users.find((x: any) => x.username === pick);
      if (!picked) { res.json({ code: 409, message: '所选账号不在该手机号绑定列表中', data: { usernames } }); return; }
      u = picked;
    }
    codeStore.delete(phone);
    if (u.accountStatus === 'disabled' || u.status === '禁用') { res.json({ code: 403, message: '该账号已被禁用，请联系管理员' }); return; }
    res.json({ code: 0, data: { username: u.username } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** 新设备验证：发送验证码到账号绑定手机（不依赖服务端用户表，前置门槛为密码已校验通过） */
router.post('/send-device-code', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    if (!/^1\d{10}$/.test(phone)) { res.json({ code: 400, message: '账号未绑定有效手机号，请联系管理员补充' }); return; }
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    const th = sendThrottle.get(phone);
    if (th && now - th.last < 60_000) { res.json({ code: 429, message: '短信发送过于频繁，请 60 秒后再试' }); return; }
    if (th && th.day === day && th.count >= 10) { res.json({ code: 429, message: '今日发送次数已达上限，请明天再试' }); return; }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (isSmsConfigured()) {
      const r = await sendSmsCode(phone, code);
      if (!r.ok) { res.json({ code: 500, message: `短信发送失败：${r.message || '请检查阿里云配置'}` }); return; }
    } else {
      // 未配置阿里云短信：开发模式回显验证码；生产环境默认回退“跳过新设备验证”（密码门槛仍前置生效），
      // 如需生产环境强制验证（宁锁定不跳过）可设环境变量 DEVICE_VERIFY_STRICT=true
      if (process.env.NODE_ENV === 'production') {
        if (process.env.DEVICE_VERIFY_STRICT === 'true') {
          res.json({ code: 503, message: '短信服务未配置：请联系管理员配置阿里云短信，或在服务器环境变量设置 DEVICE_VERIFY_STRICT=false 允许跳过新设备验证' });
          return;
        }
        codeStore.delete(phone);
        res.json({ code: 0, data: { smsUnconfigured: true }, message: '短信服务未配置（生产回退：跳过新设备验证）' });
        return;
      }
      codeStore.set(phone, { code, expiresAt: now + 5 * 60_000, attempts: 0 });
      sendThrottle.set(phone, { last: now, day, count: (th && th.day === day ? th.count : 0) + 1 });
      res.json({ code: 0, data: { devMode: true, devCode: code }, message: '短信服务未配置（开发模式）' });
      return;
    }
    codeStore.set(phone, { code, expiresAt: now + 5 * 60_000, attempts: 0 });
    sendThrottle.set(phone, { last: now, day, count: (th && th.day === day ? th.count : 0) + 1 });
    res.json({ code: 0, message: '验证码已发送' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** 新设备验证：校验验证码（通过后即消费） */
router.post('/verify-code', (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) { res.json({ code: 400, message: '手机号或验证码格式不正确' }); return; }
    const rec = codeStore.get(phone);
    if (!rec || Date.now() > rec.expiresAt) { codeStore.delete(phone); res.json({ code: 400, message: '验证码已过期，请重新获取' }); return; }
    if (rec.attempts >= 5) { codeStore.delete(phone); res.json({ code: 400, message: '验证码错误次数过多，请重新获取' }); return; }
    if (rec.code !== code) { rec.attempts += 1; res.json({ code: 400, message: '验证码不正确' }); return; }
    codeStore.delete(phone);
    res.json({ code: 0, message: '验证通过' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
