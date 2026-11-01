/**
 * 企业认证路由（三要素核验 + 法人活体刷脸，服务端权威）
 *
 * POST /api/sms 同风格免鉴权（Web 登录不签发 JWT），靠限频+配额控成本：
 *   POST /verify          { username, companyName, creditCode, legalPerson, idCard } 提交认证
 *   GET  /status?username=              单账号认证状态（徽章展示）
 *   POST /status-batch    { usernames } 批量状态（对账单/列表徽章）
 *   POST /recheck         { username }  立即复核（开发者后台/事件触发）
 *   POST /revoke          { username, reason } 撤销认证（开发者后台）
 *   POST /face/init       { username }  发起法人刷脸（InitFaceVerify → CertifyId+CertifyUrl）
 *   POST /face/describe   { username, certifyId } 查询刷脸结果（DescribeFaceVerify）
 *
 * 认证状态机：三要素通过 → pending（待刷脸）→ 刷脸通过（Passed=T）→ certified。
 * 控费：certified 同三要素 24h 内直接返回；pending 同要素不重复调三要素接口；
 *       face/init 10 分钟内复用同一 CertifyId（InitFaceVerify 按次计费，30 分钟有效期）；失败 3 次/天、间隔 60s。
 */
import { Router, Request, Response } from 'express';
import { verifyThreeElements } from '../services/enterpriseVerify';
import { initFaceVerify, describeFaceVerify } from '../services/aliyunFaceVerify';
import { stmtGetCert, stmtUpsertCert, stmtUpdateCertStatus, stmtCertFacePass, stmtCertFaceFail } from '../database/sqlite';

const router = Router();

const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const maskCode = (code: string) => (code && code.length >= 8 ? `${code.slice(0, 4)}********${code.slice(-4)}` : code);
const maskIdCard = (s: string) => (s && s.length >= 8 ? `${s.slice(0, 3)}********${s.slice(-4)}` : s);

interface CertRow {
  username: string; company_name: string; credit_code: string; legal_person: string; id_card: string;
  status: string; fail_reason: string; check_result: string; attempts: number;
  verified_at: string; last_verify_at: string; last_check_at: string; face_certify_id: string;
}

const verifyThrottle = new Map<string, { last: number; day: string; fails: number }>();

function publicView(r: CertRow) {
  return {
    username: r.username,
    status: r.status,
    companyName: r.company_name,
    creditCodeMasked: maskCode(r.credit_code),
    legalPerson: r.legal_person,
    idCardMasked: maskIdCard(r.id_card),
    verifiedAt: r.verified_at,
    lastCheckAt: r.last_check_at,
    checkResult: r.check_result,
    failReason: r.fail_reason,
  };
}

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const companyName = String(req.body?.companyName || '').trim();
    const creditCode = String(req.body?.creditCode || '').trim();
    const legalPerson = String(req.body?.legalPerson || '').trim();
    const idCard = String(req.body?.idCard || '').trim().toUpperCase();
    if (!username) { res.json({ code: 400, message: '缺少账号信息' }); return; }
    if (!companyName || !creditCode || !legalPerson) { res.json({ code: 400, message: '企业名称、统一社会信用代码、法人姓名均需填写' }); return; }
    if (!/^\d{17}[\dX]$/.test(idCard)) { res.json({ code: 400, message: '法人身份证号格式不正确（18 位）' }); return; }

    const sameProfile = (r: CertRow) => r.company_name === companyName && r.credit_code === creditCode && r.legal_person === legalPerson && r.id_card === idCard;

    // 待刷脸短路（优先于限频）：同三要素+身份证且仍在 pending → 不重复调三要素接口，直接引导刷脸
    const exist0 = stmtGetCert.get(username) as CertRow | undefined;
    if (exist0 && exist0.status === 'pending' && sameProfile(exist0)) {
      res.json({ code: 0, data: { ...publicView(exist0), cached: true }, message: '三要素已核验通过，请继续完成法人刷脸' });
      return;
    }

    // 限频：60s 间隔 + 每日 3 次失败上限
    const day = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const th = verifyThrottle.get(username);
    if (th && now - th.last < 60_000) { res.json({ code: 429, message: '操作过于频繁，请 60 秒后再试' }); return; }
    if (th && th.day === day && th.fails >= 3) { res.json({ code: 429, message: '今日核验失败次数已达上限，请明天再试' }); return; }

    // 控费缓存：已认证且同三要素（含身份证）24h 内 → 直接返回，不重复调接口
    const exist = stmtGetCert.get(username) as CertRow | undefined;
    if (exist && exist.status === 'certified' && sameProfile(exist)
      && exist.last_verify_at && Date.now() - new Date(exist.last_verify_at.replace(' ', 'T')).getTime() < 24 * 3600_000) {
      res.json({ code: 0, data: { ...publicView(exist), cached: true }, message: '该企业已完成认证' });
      return;
    }

    const r = await verifyThreeElements({ companyName, creditCode, legalPerson });
    verifyThrottle.set(username, { last: now, day, fails: (th && th.day === day ? th.fails : 0) + (r.ok && r.matched ? 0 : 1) });

    if (r.ok && r.matched) {
      const ts = nowStr();
      // 三要素通过 → pending（待法人刷脸）；刷脸通过后由 face/describe 置为 certified
      stmtUpsertCert.run(
        username, companyName, creditCode, legalPerson, idCard, 'pending', '等待法人刷脸认证', r.devMode ? 'devMode' : 'match', 0,
        exist && exist.status === 'certified' ? exist.verified_at : '', ts, ts,
      );
      const row = stmtGetCert.get(username) as CertRow;
      res.json({ code: 0, data: publicView(row), message: '三要素核验通过，请完成法人刷脸认证' });
      return;
    }
    // 核验不通过：记录失败原因；已有认证不立即撤销（以巡检/复核为准）
    if (r.ok) {
      if (exist) {
        stmtUpsertCert.run(exist.username, companyName, creditCode, legalPerson, idCard, exist.status, r.message || '三要素不一致', r.reason || 'mismatch', exist.attempts + 1, exist.verified_at, nowStr(), exist.last_check_at);
      }
      res.json({ code: 400, message: r.message || '三要素与工商登记信息不一致，请核对后重试' });
      return;
    }
    res.json({ code: 500, message: r.message || '核验服务暂时不可用，请稍后重试' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/status', (req: Request, res: Response) => {
  try {
    const username = String(req.query.username || '').trim();
    if (!username) { res.json({ code: 400, message: '缺少 username' }); return; }
    const row = stmtGetCert.get(username) as CertRow | undefined;
    res.json({ code: 0, data: row ? publicView(row) : null });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/status-batch', (req: Request, res: Response) => {
  try {
    const usernames: string[] = Array.isArray(req.body?.usernames) ? req.body.usernames.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
    const map: Record<string, any> = {};
    for (const u of usernames.slice(0, 200)) {
      const row = stmtGetCert.get(u) as CertRow | undefined;
      if (row) map[u] = publicView(row);
    }
    res.json({ code: 0, data: { map } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/recheck', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const row = stmtGetCert.get(username) as CertRow | undefined;
    if (!row) { res.json({ code: 404, message: '该账号无认证记录' }); return; }
    const r = await verifyThreeElements({ companyName: row.company_name, creditCode: row.credit_code, legalPerson: row.legal_person });
    if (!r.ok) { res.json({ code: 500, message: r.message || '核验服务暂时不可用' }); return; }
    const ts = nowStr();
    if (r.matched) {
      stmtUpdateCertStatus.run('certified', '', r.devMode ? 'devMode' : 'match', ts, username);
      res.json({ code: 0, message: '复核通过，认证状态正常' });
    } else {
      stmtUpdateCertStatus.run('abnormal', r.message || '三要素不一致', r.reason || 'mismatch', ts, username);
      res.json({ code: 0, message: `复核不通过：${r.message || '三要素与工商登记不一致'}，已标记为异常` });
    }
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/revoke', (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const reason = String(req.body?.reason || '开发者后台撤销').trim();
    const row = stmtGetCert.get(username) as CertRow | undefined;
    if (!row) { res.json({ code: 404, message: '该账号无认证记录' }); return; }
    stmtUpdateCertStatus.run('revoked', reason, 'revoked', nowStr(), username);
    res.json({ code: 0, message: '已撤销认证' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ============ 法人活体刷脸（阿里云金融级实人认证，H5 扫码） ============

// face/init 复用缓存：10 分钟内同账号复用同一 CertifyId（InitFaceVerify 按次计费且 30 分钟有效期）
const faceInitCache = new Map<string, { certifyId: string; certifyUrl: string; devMode?: boolean; createdAt: number }>();
const faceInitThrottle = new Map<string, number>();
const faceQueryThrottle = new Map<string, number>();

router.post('/face/init', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) { res.json({ code: 400, message: '缺少账号信息' }); return; }
    const row = stmtGetCert.get(username) as CertRow | undefined;
    if (!row || !row.legal_person || !row.id_card) { res.json({ code: 400, message: '请先提交企业认证信息（含法人身份证号）' }); return; }
    const now = Date.now();
    const cached = faceInitCache.get(username);
    if (cached && now - cached.createdAt < 10 * 60_000) {
      res.json({ code: 0, data: { certifyId: cached.certifyId, certifyUrl: cached.certifyUrl, devMode: !!cached.devMode, expireMinutes: 30 } });
      return;
    }
    const th = faceInitThrottle.get(username) || 0;
    if (now - th < 60_000) { res.json({ code: 429, message: '发起过于频繁，请稍后再试' }); return; }
    const outerOrderNo = `F${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 32);
    const metaInfo = String(req.body?.metaInfo || '').trim();
    // 前置校验 MetaInfo：浏览器 SDK 未加载时前端传空，直接调阿里云只会得到晦涩的 401 参数非法(metaInfo)
    if (!metaInfo.startsWith('{') || metaInfo.length < 20) {
      res.json({ code: 400, message: '浏览器刷脸环境信息（MetaInfo）缺失或无效：请刷新页面重试，仍失败请改用 Chrome/Edge 浏览器并确认网络可访问 o.alicdn.com' });
      return;
    }
    const r = await initFaceVerify({ certName: row.legal_person, certNo: row.id_card, outerOrderNo, metaInfo });
    if (!r.ok || !r.certifyId || !r.certifyUrl) {
      res.json({ code: 500, message: r.message || (r.certifyId ? '阿里云未返回认证链接（MetaInfo 无效或缺失），请刷新页面后重试' : '发起刷脸认证失败，请稍后重试') });
      return;
    }
    faceInitCache.set(username, { certifyId: r.certifyId, certifyUrl: r.certifyUrl, devMode: r.devMode, createdAt: now });
    faceInitThrottle.set(username, now);
    res.json({ code: 0, data: { certifyId: r.certifyId, certifyUrl: r.certifyUrl, devMode: !!r.devMode, expireMinutes: 30 } });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/face/describe', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const certifyId = String(req.body?.certifyId || '').trim();
    if (!username || !certifyId) { res.json({ code: 400, message: '缺少账号或认证标识' }); return; }
    const now = Date.now();
    if (now - (faceQueryThrottle.get(username) || 0) < 800) { res.json({ code: 429, message: '查询过于频繁，请稍候' }); return; }
    faceQueryThrottle.set(username, now);
    const row = stmtGetCert.get(username) as CertRow | undefined;
    if (!row) { res.json({ code: 404, message: '该账号无认证记录' }); return; }
    const r = await describeFaceVerify(certifyId);
    if (!r.ok) { res.json({ code: 500, message: r.message || '查询刷脸结果失败' }); return; }
    if (r.passed) {
      // 刷脸通过：置为 certified 并记录刷脸时间（verified_at 刷新，巡检周期重新起算）
      stmtCertFacePass.run(certifyId, username);
      const fresh = stmtGetCert.get(username) as CertRow;
      res.json({ code: 0, data: { passed: true, devMode: !!r.devMode, cert: publicView(fresh) }, message: '法人刷脸认证通过' });
    } else {
      // 未通过/未完成：保持 pending，记录失败原因供前端展示；可重新生成二维码重试
      stmtCertFaceFail.run(r.message || '刷脸未通过', certifyId, username);
      res.json({ code: 0, data: { passed: false, subCode: r.subCode || '', message: r.message || '刷脸未通过' } });
    }
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
