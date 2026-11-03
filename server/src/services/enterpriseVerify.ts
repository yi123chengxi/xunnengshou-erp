/**
 * 企业三要素核验适配器（企业名称 + 统一社会信用代码 + 法人姓名）
 *
 * 配置项（server/.env）：
 *   ENTERPRISE_APPCODE —— 阿里云市场 AppCode（请求头 Authorization: APPCODE xxx）
 *   ENTERPRISE_API_URL —— 商品接口地址（控制台「接口」页的请求 URL）
 * 未配置时默认拒绝核验（防止错误工商信息被“格式校验通过即匹配”放行），
 * 仅当 .env 显式 ENTERPRISE_DEV_MODE=1 时才走 devMode（直接返回匹配成功，便于联调 UI）。
 *
 * 响应解析采用宽容模式：先识别外层信封 code，再在多层结构中查找匹配标志，
 * 兼容市面常见三要素接口返回形态；拿到正式接口文档后可在 parseMatch 中精确化。
 */
import { stmtGetSetting } from '../database/sqlite';

export interface VerifyInput { companyName: string; creditCode: string; legalPerson: string; }
export interface VerifyResult {
  ok: boolean;            // 调用是否成功（网络/信封层）
  matched?: boolean;      // 三要素是否一致
  reason?: string;        // 不一致/失败原因（not_found / mismatch / error 等）
  message?: string;       // 可读文案
  devMode?: boolean;
}

/** 企业核验配置项（开发者后台可视化维护，存 system_settings；未设置时回退 server/.env） */
export interface EnterpriseConfig { apiUrl: string; appCode: string; appKey: string; appSecret: string; source: 'db' | 'env' | 'none'; }

const DEFAULT_API_URL = 'https://sys.81api.com/verifyCompany/';

function readSetting(key: string): string {
  try {
    const row = stmtGetSetting.get(key) as { setting_value: string } | undefined;
    return String(row?.setting_value || '').trim();
  } catch { return ''; }
}

/**
 * 解析生效配置：优先开发者后台写入的 system_settings，其次 server/.env。
 * 这样重新订购/更换 AppCode 后在后台改一次即时生效，无需改 .env 重新部署。
 */
export function getEnterpriseConfig(): EnterpriseConfig {
  const dbCode = readSetting('enterprise_appcode');
  if (dbCode) {
    return {
      apiUrl: readSetting('enterprise_api_url') || process.env.ENTERPRISE_API_URL || DEFAULT_API_URL,
      appCode: dbCode,
      appKey: readSetting('enterprise_app_key'),
      appSecret: readSetting('enterprise_app_secret'),
      source: 'db',
    };
  }
  const envCode = String(process.env.ENTERPRISE_APPCODE || '').trim();
  if (envCode) {
    return { apiUrl: String(process.env.ENTERPRISE_API_URL || '').trim() || DEFAULT_API_URL, appCode: envCode, appKey: '', appSecret: '', source: 'env' };
  }
  return { apiUrl: '', appCode: '', appKey: '', appSecret: '', source: 'none' };
}

export function isEnterpriseConfigured(): boolean {
  const c = getEnterpriseConfig();
  return !!(c.apiUrl && c.appCode);
}

/** 开发模式开关：仅 .env 显式 ENTERPRISE_DEV_MODE=1 时生效；生产未配置接口地址时必须拒绝核验而非假匹配 */
export function isEnterpriseDevMode(): boolean {
  return process.env.ENTERPRISE_DEV_MODE === '1' || process.env.ENTERPRISE_DEV_MODE === 'true';
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

/**
 * 解析商品接口响应。实测两种形态：
 *   一致：{"status": true,  "message": "查询完成", "result": "三者一致"}
 *   不一致：{"status": false, "message": "查询完成", "reason": "法人姓名与其他二者不一致", "result": "不一致"}
 * → status 即匹配布尔标志（true=三者一致）；message="查询完成" 仅代表本次查询成功执行；reason/result 为详情文案。
 * status=false 且查询已完成 → 不匹配（拒绝认证，非服务异常）；无完成信号且无详情 → 视为服务异常。
 * 兼容未知形态时回退通用信封/标志解析。
 */
function parseVerifyBody(body: any): VerifyResult {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'error', message: '接口返回格式异常' };
  // 商品方标准形态：布尔 status + message/reason/result 文案
  if ('status' in body && typeof body.status === 'boolean') {
    const msg = String(body.message || '').trim();
    const detail = String(body.reason || body.result || '').trim();
    if (body.status === true) return { ok: true, matched: true, message: detail || msg || '三者一致' };
    // status=false：查询已完成（message=查询完成 或带 reason/result 详情）→ 三要素不一致；否则视为服务异常
    if (msg === '查询完成' || detail) return { ok: true, matched: false, reason: 'mismatch', message: detail || '三要素与工商登记信息不一致' };
    return { ok: false, reason: 'error', message: msg || '核验服务异常' };
  }
  // 兼容：仅有 result 文案（无布尔 status）
  if ('result' in body) {
    const resultStr = String(body.result ?? '').trim();
    if (resultStr.includes('不一致')) return { ok: true, matched: false, reason: 'mismatch', message: String(body.reason || resultStr) };
    if (resultStr.includes('三者一致') || resultStr === '一致') return { ok: true, matched: true, message: resultStr };
    if (resultStr) return { ok: true, matched: false, reason: 'mismatch', message: resultStr };
  }
  // 回退：通用信封 + 匹配标志解析（兼容商品方变更返回结构）
  const env = envelopeOk(body);
  if (!env.ok) return { ok: false, reason: 'error', message: env.message || '接口返回失败' };
  const matched = pickMatchFlag(body?.data ?? body?.result ?? body);
  if (matched === null) return { ok: false, reason: 'error', message: '接口返回中未识别到核验结果字段' };
  return matched ? { ok: true, matched: true } : { ok: true, matched: false, reason: 'mismatch', message: '三要素与工商登记信息不一致' };
}

/** 拼接 GET 请求 URL（注意：商品方参数名 ComapnyName 为其接口拼写，非 CompanyName，必须原样传递） */
function buildVerifyUrl(apiUrl: string, input: VerifyInput): string {
  const params = new URLSearchParams({
    ComapnyName: input.companyName,
    CreditCode: input.creditCode,
    LegalPersonName: input.legalPerson,
  });
  return `${apiUrl.replace(/\/+$/, '')}/?${params.toString()}`;
}

/** 真实调用云市场三要素核验接口（GET + Query：ComapnyName/CreditCode/LegalPersonName，APPCODE 头认证） */
async function callRemote(input: VerifyInput, cfg?: EnterpriseConfig): Promise<VerifyResult> {
  const c = cfg || getEnterpriseConfig();
  if (!c.apiUrl || !c.appCode) return { ok: false, reason: 'not_configured', message: '企业三要素核验接口未配置' };
  try {
    const resp = await fetch(buildVerifyUrl(c.apiUrl, input), {
      method: 'GET',
      headers: { Authorization: `APPCODE ${c.appCode}`, Accept: 'application/json' },
    });
    if (!resp.ok) return { ok: false, reason: 'error', message: `接口 HTTP ${resp.status}` };
    const body: any = await resp.json().catch(() => null);
    return parseVerifyBody(body);
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message || '接口调用异常' };
  }
}

/**
 * 供开发者后台「测试连通」使用：用给定样例真实调用一次（消耗 1 次套餐配额），
 * 返回解析结论 + 上游原始响应，便于确认 AppCode/接口地址是否正确。
 */
export async function testEnterpriseConfig(input: VerifyInput, cfg: EnterpriseConfig): Promise<{ result: VerifyResult; raw: any }> {
  if (!cfg.apiUrl || !cfg.appCode) return { result: { ok: false, reason: 'not_configured', message: '请先填写接口地址与 AppCode' }, raw: null };
  try {
    const resp = await fetch(buildVerifyUrl(cfg.apiUrl, input), {
      method: 'GET',
      headers: { Authorization: `APPCODE ${cfg.appCode}`, Accept: 'application/json' },
    });
    const text = await resp.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok) return { result: { ok: false, reason: 'error', message: `接口 HTTP ${resp.status}` }, raw: body ?? text };
    return { result: parseVerifyBody(body), raw: body };
  } catch (e: any) {
    return { result: { ok: false, reason: 'error', message: e?.message || '接口调用异常' }, raw: null };
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
    if (!isEnterpriseDevMode()) {
      return { ok: false, reason: 'not_configured', message: '企业三要素核验接口未配置（服务端 .env 缺 ENTERPRISE_API_URL），本次提交未生效；请联系管理员在阿里云市场控制台补全接口地址后重试' };
    }
    // 开发模式（显式开启）：格式校验通过即视为匹配，便于联调全流程；记录 check_result=devMode 便于识别
    return { ok: true, matched: true, devMode: true, message: '企业认证接口未配置（开发模式）' };
  }
  return callRemote({ companyName, creditCode, legalPerson });
}
