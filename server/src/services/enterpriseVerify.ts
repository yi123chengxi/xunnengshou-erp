/**
 * 企业三要素核验适配器（企业名称 + 统一社会信用代码 + 法人姓名）
 *
 * 配置项（server/.env）：
 *   ENTERPRISE_APPCODE —— 阿里云市场 AppCode（请求头 Authorization: APPCODE xxx）
 *   ENTERPRISE_API_URL —— 商品接口地址（控制台「接口」页的请求 URL）
 * 未配置时走 devMode（直接返回匹配成功，便于联调 UI），配置后自动切换真实调用。
 *
 * 响应解析采用宽容模式：先识别外层信封 code，再在多层结构中查找匹配标志，
 * 兼容市面常见三要素接口返回形态；拿到正式接口文档后可在 parseMatch 中精确化。
 */
export interface VerifyInput { companyName: string; creditCode: string; legalPerson: string; }
export interface VerifyResult {
  ok: boolean;            // 调用是否成功（网络/信封层）
  matched?: boolean;      // 三要素是否一致
  reason?: string;        // 不一致/失败原因（not_found / mismatch / error 等）
  message?: string;       // 可读文案
  devMode?: boolean;
}

export function isEnterpriseConfigured(): boolean {
  return !!(process.env.ENTERPRISE_APPCODE && process.env.ENTERPRISE_API_URL);
}

const TRUTHY = new Set(['1', 'true', 'match', 'matched', 'yes', '一致', '匹配']);
const FALSY = new Set(['0', 'false', 'unmatch', 'unmatched', 'no', '2', '不一致', '不匹配']);

function pickMatchFlag(node: any, depth = 0): boolean | null {
  if (node === null || node === undefined || depth > 4) return null;
  if (typeof node === 'boolean') return node;
  if (typeof node === 'string' || typeof node === 'number') {
    const s = String(node).trim().toLowerCase();
    if (TRUTHY.has(s)) return true;
    if (FALSY.has(s)) return false;
    return null;
  }
  if (Array.isArray(node)) { for (const x of node) { const r = pickMatchFlag(x, depth + 1); if (r !== null) return r; } return null; }
  if (typeof node === 'object') {
    const keys = ['matched', 'isMatch', 'match', 'result', 'verifyResult', 'status', 'res', 'same', 'consistent'];
    for (const k of keys) { if (k in node) { const r = pickMatchFlag(node[k], depth + 1); if (r !== null) return r; } }
    for (const k of Object.keys(node)) { const r = pickMatchFlag(node[k], depth + 1); if (r !== null) return r; }
  }
  return null;
}

function envelopeOk(body: any): { ok: boolean; message?: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: '接口返回格式异常' };
  const code = body.code ?? body.status ?? body.errCode ?? body.retCode ?? body.error_code;
  if (code === undefined) return { ok: true };
  const s = String(code).toLowerCase();
  if (['0', '200', '00000', 'ok', 'success', '10000'].includes(s)) return { ok: true };
  return { ok: false, message: String(body.message ?? body.msg ?? body.errorMsg ?? body.reason ?? code) };
}

/** 真实调用云市场三要素核验接口 */
async function callRemote(input: VerifyInput): Promise<VerifyResult> {
  const url = process.env.ENTERPRISE_API_URL as string;
  const appCode = process.env.ENTERPRISE_APPCODE as string;
  try {
    const params = new URLSearchParams({
      companyName: input.companyName,
      creditCode: input.creditCode,
      legalPerson: input.legalPerson,
    });
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `APPCODE ${appCode}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: params.toString(),
    });
    if (!resp.ok) return { ok: false, reason: 'error', message: `接口 HTTP ${resp.status}` };
    const body: any = await resp.json().catch(() => null);
    const env = envelopeOk(body);
    if (!env.ok) return { ok: false, reason: 'error', message: env.message || '接口返回失败' };
    const matched = pickMatchFlag(body?.data ?? body?.result ?? body);
    if (matched === null) return { ok: false, reason: 'error', message: '接口返回中未识别到核验结果字段' };
    return matched
      ? { ok: true, matched: true }
      : { ok: true, matched: false, reason: 'mismatch', message: '三要素与工商登记信息不一致' };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message || '接口调用异常' };
  }
}

/** 三要素核验入口：未配置走 devMode，配置后真实调用 */
export async function verifyThreeElements(input: VerifyInput): Promise<VerifyResult> {
  const companyName = String(input.companyName || '').trim();
  const creditCode = String(input.creditCode || '').trim();
  const legalPerson = String(input.legalPerson || '').trim();
  if (!companyName || !creditCode || !legalPerson) {
    return { ok: false, reason: 'incomplete', message: '企业名称、统一社会信用代码、法人姓名均需填写' };
  }
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/i.test(creditCode)) {
    return { ok: false, reason: 'badcode', message: '统一社会信用代码格式不正确（18 位）' };
  }
  if (!isEnterpriseConfigured()) {
    // 开发模式：格式校验通过即视为匹配，便于联调全流程；记录 check_result=devMode 便于识别
    return { ok: true, matched: true, devMode: true, message: '企业认证接口未配置（开发模式）' };
  }
  return callRemote({ companyName, creditCode, legalPerson });
}
