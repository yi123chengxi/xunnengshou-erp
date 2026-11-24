/**
 * 短信验证码登录路由
 *
 * POST /api/sms/send-code  { phone }        — 发送登录验证码（限频：60s/条、10条/天）
 * POST /api/sms/login      { phone, code }  — 验证码校验通过后返回对应账号 username
 * POST /api/sms/check-ip-trust      { username }                  — 出口 IP 是否在 30 天信任期
 * POST /api/sms/check-device-trust  { username, deviceToken }     — 设备凭证是否在 90 天信任期
 *
 * 验证码 5 分钟有效、最多错 5 次；服务端内存存储（重启即失效，属预期）。
 * 未配置阿里云短信（.env 缺 AccessKey/签名/模板）时 send-code 返回 devMode+devCode 便于联调。
 */
import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { isSmsConfigured, sendSmsCode } from '../services/aliyunSms';
import { store } from '../database/store';
import { issueToken } from './auth.routes';

const router = Router();

interface CodeRec { code: string; expiresAt: number; attempts: number; }
const codeStore = new Map<string, CodeRec>();
const sendThrottle = new Map<string, { last: number; day: string; count: number }>();

// ============ 新设备验证锚点之一：IP 信任期（30 天一个轮回） ============
// 信任记录存服务端 dataset_store 的 sys_trusted_ips_<账号> = [{ip, until}]：
// sys_ 前缀在 syncGuard.isKeyAllowed 里对客户端全禁读写，杜绝调用方「自封可信」。
// 口径：陌生 IP 首次登录需短信验证码；验证通过后该 IP 30 天内免验证；
// 到期后下一个轮回重新验证（不在登录时续期，保证 30 天硬轮回）。
const IP_TRUST_MS = 30 * 24 * 60 * 60 * 1000;

/** 客户端出口 IP：优先 X-Forwarded-For 第一跳（生产 Nginx 反代），缺失回退 req.ip */
export function clientIpOf(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.ip || '');
}

const ipTrustKey = (username: string) => `sys_trusted_ips_${username}`;

async function readTrustedIps(username: string): Promise<{ ip: string; until: number }[]> {
  try {
    const row = await store.getDataset(ipTrustKey(username));
    if (!row) return [];
    const list = JSON.parse(row.dataset_json || '[]');
    return Array.isArray(list) ? list.filter((r: any) => r && typeof r.ip === 'string' && Number(r.until) > 0) : [];
  } catch { return []; }
}

async function writeTrustedIps(username: string, list: { ip: string; until: number }[]): Promise<void> {
  try {
    await store.forceUpsertDataset(ipTrustKey(username), JSON.stringify(list), '', Date.now());
  } catch { /* 存储不可用：信任期失效降级为「每次验证」，不影响登录主链路 */ }
}

/** 当前请求 IP 是否在该账号的信任期内 */
export async function isIpTrustedFor(username: string, req: Request): Promise<boolean> {
  if (!username) return false;
  const ip = clientIpOf(req);
  if (!ip) return false;
  const now = Date.now();
  const list = await readTrustedIps(username);
  const alive = list.filter(r => r.until > now);
  if (alive.length !== list.length) void writeTrustedIps(username, alive); // 顺带剪枝过期记录
  return alive.some(r => r.ip === ip);
}

/** 验证通过后记录信任：自此刻起 30 天免验证码 */
async function markIpTrusted(username: string, req: Request): Promise<void> {
  const ip = clientIpOf(req);
  if (!username || !ip) return;
  const now = Date.now();
  const list = (await readTrustedIps(username)).filter(r => r.until > now && r.ip !== ip);
  list.push({ ip, until: now + IP_TRUST_MS });
  await writeTrustedIps(username, list);
}

// ============ 新设备验证锚点之二：设备凭证信任期（90 天一个轮回） ============
// 仅靠出口 IP 作锚点的缺陷：宽带重拨、运营商 NAT 池轮换都会让 IP 变化，
// 表现为「昨天刚验证过，今天又要验证码」，信任期形同虚设。因此加第二锚点：
// 验证通过时服务端签发一次性随机 deviceToken，浏览器按账号存 localStorage，下次登录带回。
// 服务端 sys_trusted_devices_<账号> 只存 token 的 sha256 摘要（存储副本泄露也无法冒用），
// 且 sys_ 前缀对客户端禁读写，调用方无法自封可信。判定口径：设备凭证命中 OR IP 信任命中，
// 任一成立即免短信验证；两者都 miss 才走短信并双写。与 IP 信任同样不在校验时续期（90 天硬轮回）。
const DEVICE_TRUST_MS = 90 * 24 * 60 * 60 * 1000;
const DEVICE_MAX_ROWS = 10; // 单账号最多保留 10 台受信设备，超出按最早签发淘汰
const deviceTrustKey = (username: string) => `sys_trusted_devices_${username}`;

interface DeviceRec { id: string; until: number; addedAt: number; lastSeenAt: number; ua: string; lastIp: string; }

const hashDeviceToken = (token: string): string => createHash('sha256').update(token).digest('hex');

async function readTrustedDevices(username: string): Promise<DeviceRec[]> {
  try {
    const row = await store.getDataset(deviceTrustKey(username));
    if (!row) return [];
    const list = JSON.parse(row.dataset_json || '[]');
    return Array.isArray(list) ? list.filter((r: any) => r && typeof r.id === 'string' && Number(r.until) > 0) : [];
  } catch { return []; }
}

async function writeTrustedDevices(username: string, list: DeviceRec[]): Promise<void> {
  try {
    await store.forceUpsertDataset(deviceTrustKey(username), JSON.stringify(list), '', Date.now());
  } catch { /* 存储不可用：降级为每次验证，不影响登录主链路 */ }
}

/** 设备凭证是否在信任期内（命中只刷新 lastSeenAt/lastIp，不改 until 以保持硬轮回） */
async function isDeviceTrustedFor(username: string, deviceToken: string, req: Request): Promise<boolean> {
  if (!username) return false;
  const token = String(deviceToken || '').trim();
  if (!/^[0-9a-f]{40,128}$/.test(token)) return false;
  const id = hashDeviceToken(token);
  const now = Date.now();
  const list = await readTrustedDevices(username);
  const alive = list.filter(r => r.until > now);
  if (alive.length !== list.length) void writeTrustedDevices(username, alive); // 顺带剪枝过期记录
  const hit = alive.find(r => r.id === id);
  if (!hit) return false;
  hit.lastSeenAt = now;
  hit.lastIp = clientIpOf(req);
  hit.ua = String(req.headers['user-agent'] || '').slice(0, 200);
  void writeTrustedDevices(username, alive);
  return true;
}

/** 验证通过后签发设备凭证：返回明文 token（仅此一次随响应下发，服务端只留摘要） */
async function issueDeviceToken(username: string, req: Request): Promise<string> {
  if (!username) return '';
  try {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    const list = (await readTrustedDevices(username)).filter(r => r.until > now);
    list.push({ id: hashDeviceToken(token), until: now + DEVICE_TRUST_MS, addedAt: now, lastSeenAt: now, ua: String(req.headers['user-agent'] || '').slice(0, 200), lastIp: clientIpOf(req) });
    // 超量时淘汰最早签发的（最新一条必留）
    const trimmed = list.length > DEVICE_MAX_ROWS ? list.sort((a, b) => a.addedAt - b.addedAt).slice(-DEVICE_MAX_ROWS) : list;
    await writeTrustedDevices(username, trimmed);
    return token;
  } catch { return ''; }
}

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
    // 短信验证码已证明手机号归属：直接签发 JWT，供 /api/sync 鉴权使用
    let token = '';
    try { token = await issueToken(String(u.username), String(u.role || 'supplier')); } catch { /* 签发失败不阻断登录，前端会回退本地模式 */ }
    // 同样签发设备凭证：短信登录本身已完成手机号校验，记住本机后下次换 IP 也不会再弹验证
    const deviceToken = await issueDeviceToken(String(u.username), req);
    res.json({ code: 0, data: { username: u.username, token, deviceToken } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** 新设备验证：查询当前出口 IP 是否在该账号的 30 天信任期内（登录前调用，仅返回布尔） */
router.post('/check-ip-trust', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) { res.json({ code: 400, message: '缺少 username' }); return; }
    res.json({ code: 0, data: { trusted: await isIpTrustedFor(username, req) } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** 新设备验证：查询浏览器持有的设备凭证是否在该账号的 90 天信任期内（仅返回布尔，不泄露摘要内容） */
router.post('/check-device-trust', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) { res.json({ code: 400, message: '缺少 username' }); return; }
    res.json({ code: 0, data: { trusted: await isDeviceTrustedFor(username, String(req.body?.deviceToken || ''), req) } });
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
        // 跳过验证等同信任本次出口 IP 与本设备：否则未配置短信期间每次登录都会弹验证窗
        const skipUser = String(req.body?.username || '').trim();
        if (skipUser) await markIpTrusted(skipUser, req);
        const skipDeviceToken = skipUser ? await issueDeviceToken(skipUser, req) : '';
        res.json({ code: 0, data: { smsUnconfigured: true, deviceToken: skipDeviceToken }, message: '短信服务未配置（生产回退：跳过新设备验证）' });
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

/** 新设备验证：校验验证码（通过后即消费）；携带 username 时双写信任：出口 IP 30 天 + 签发 90 天设备凭证 */
router.post('/verify-code', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) { res.json({ code: 400, message: '手机号或验证码格式不正确' }); return; }
    const rec = codeStore.get(phone);
    if (!rec || Date.now() > rec.expiresAt) { codeStore.delete(phone); res.json({ code: 400, message: '验证码已过期，请重新获取' }); return; }
    if (rec.attempts >= 5) { codeStore.delete(phone); res.json({ code: 400, message: '验证码错误次数过多，请重新获取' }); return; }
    if (rec.code !== code) { rec.attempts += 1; res.json({ code: 400, message: '验证码不正确' }); return; }
    codeStore.delete(phone);
    const trustUser = String(req.body?.username || '').trim();
    let deviceToken = '';
    if (trustUser) {
      await markIpTrusted(trustUser, req);
      deviceToken = await issueDeviceToken(trustUser, req);
    }
    res.json({ code: 0, data: { deviceToken }, message: '验证通过' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
