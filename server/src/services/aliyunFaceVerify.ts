/**
 * 阿里云金融级实人认证封装（法人活体刷脸，H5 网页接入）
 *
 * 配置项（server/.env）：
 *   ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET —— RAM 用户的 AccessKey（需含金融级实人认证权限）
 *   ALIYUN_FACE_SCENE_ID —— 智能核身控制台创建的 H5 网页认证场景 ID
 *   ALIYUN_FACE_MODEL —— 活体检测类型（默认 LIVENESS 眨眼；可选 MOVE_ACTION 远近移动+眨眼 等）
 *   ALIYUN_FACE_RETURN_URL —— 手机刷脸完成后的回跳地址（仅回跳展示用，权威结果以 DescribeFaceVerify 为准）
 *
 * 未配置 ALIYUN_FACE_SCENE_ID 时走 devMode（init 返回占位链接、describe 直接返回通过），便于联调 UI。
 * 接口文档：InitFaceVerify / DescribeFaceVerify（cloudauth20190307，H5 方案 ProductCode 固定 ID_PRO）；
 * 主备地域 Endpoint 自动切换（上海 → 北京），业务级错误（code != 500）不重试。
 */
import Cloudauth20190307, * as $Cloudauth from '@alicloud/cloudauth20190307';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';

const ENDPOINTS = ['cloudauth.cn-shanghai.aliyuncs.com', 'cloudauth.cn-beijing.aliyuncs.com'];

export function isFaceConfigured(): boolean {
  return !!(process.env.ALIYUN_ACCESS_KEY_ID && process.env.ALIYUN_ACCESS_KEY_SECRET && process.env.ALIYUN_FACE_SCENE_ID);
}

const clientMap = new Map<string, Cloudauth20190307>();
function getClient(ep: string): Cloudauth20190307 {
  let c = clientMap.get(ep);
  if (!c) {
    const config = new $OpenApi.Config({
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    });
    config.endpoint = ep;
    c = new Cloudauth20190307(config);
    clientMap.set(ep, c);
  }
  return c;
}

export interface FaceInitResult {
  ok: boolean;
  certifyId?: string;   // 实人认证唯一标识（计费统计字段，30 分钟有效、仅可提交一次）
  certifyUrl?: string;  // H5 认证链接（生成二维码用）
  devMode?: boolean;
  message?: string;
}

/** 发起刷脸认证：返回 CertifyId 与 H5 认证链接 */
export async function initFaceVerify(input: { certName: string; certNo: string; outerOrderNo: string }): Promise<FaceInitResult> {
  if (!isFaceConfigured()) {
    // 开发模式：返回占位链接，UI 全流程可联调（describe 将直接返回通过）
    return { ok: true, devMode: true, certifyId: `dev-${Date.now()}`, certifyUrl: 'https://eda.cloudauth.aliyuncs.com/?certifyId=devMode' };
  }
  const req = new $Cloudauth.InitFaceVerifyRequest({
    sceneId: Number(process.env.ALIYUN_FACE_SCENE_ID),
    outerOrderNo: input.outerOrderNo,
    productCode: 'ID_PRO',
    model: process.env.ALIYUN_FACE_MODEL || 'LIVENESS',
    certType: 'IDENTITY_CARD',
    certName: input.certName,
    certNo: input.certNo,
    metaInfo: '{}', // 服务端直调时官方示例传 "{}"；设备信息由 H5 认证页自行采集
    returnUrl: process.env.ALIYUN_FACE_RETURN_URL || 'https://www.aliyun.com',
    // certifyUrlType 不传：部分场景校验严格会报参数非法，未传时由阿里云基于 MetaInfo 自动识别
  });
  const runtime = new $Util.RuntimeOptions({ readTimeout: 10000, connectTimeout: 10000 });
  let lastMsg = '';
  for (const ep of ENDPOINTS) {
    try {
      const resp = await getClient(ep).initFaceVerifyWithOptions(req, runtime);
      const body: any = resp.body || {};
      if (String(body.code) === '200' && body.resultObject?.certifyId) {
        return { ok: true, certifyId: body.resultObject.certifyId, certifyUrl: body.resultObject.certifyUrl };
      }
      lastMsg = FACE_CODE_TEXT[String(body.code)] || `${body.code || ''} ${body.message || ''}`.trim();
      if (String(body.code) !== '500') break; // 业务错误不换端点重试
    } catch (e: any) {
      lastMsg = e?.message || '实人认证服务异常';
    }
  }
  return { ok: false, message: lastMsg || '发起刷脸认证失败' };
}

export interface FaceDescribeResult {
  ok: boolean;
  passed?: boolean;   // 以此字段为准：T 通过 / F 未通过（含放弃、未完成）
  subCode?: string;
  devMode?: boolean;
  message?: string;
}

/** 常见 SubCode 文案（判定结果仍以 Passed 为准） */
const SUB_CODE_TEXT: Record<string, string> = {
  '200': '认证通过',
  '201': '认证通过（疑似）',
};

/** 常见业务错误码友好文案（官方《服务端接口错误码》；避免把 411 RAM无权限 这类原始码直接抛给用户） */
const FACE_CODE_TEXT: Record<string, string> = {
  '410': '服务未开通：请在阿里云控制台开通金融级实人认证并完成 OSS 授权',
  '411': '云账号子账号缺少实人认证权限：需主账号登录 RAM 控制台 → 身份管理 → 用户，为当前 AccessKey 所属子账号添加系统策略 AliyunAntCloudAuthFullAccess',
  '412': '阿里云账号欠费（金融级实人认证或 OSS），请充值后重试',
};

/** 查询刷脸认证结果 */
export async function describeFaceVerify(certifyId: string): Promise<FaceDescribeResult> {
  if (!isFaceConfigured()) {
    return { ok: true, devMode: true, passed: true, subCode: '200', message: '刷脸认证通过（开发模式）' };
  }
  const req = new $Cloudauth.DescribeFaceVerifyRequest({
    sceneId: Number(process.env.ALIYUN_FACE_SCENE_ID),
    certifyId,
  });
  const runtime = new $Util.RuntimeOptions({ readTimeout: 10000, connectTimeout: 10000 });
  let lastMsg = '';
  for (const ep of ENDPOINTS) {
    try {
      const resp = await getClient(ep).describeFaceVerifyWithOptions(req, runtime);
      const body: any = resp.body || {};
      if (String(body.code) === '200' && body.resultObject) {
        const passed = String(body.resultObject.passed || '') === 'T';
        const subCode = String(body.resultObject.subCode || '');
        return {
          ok: true,
          passed,
          subCode,
          message: passed ? '刷脸认证通过' : (SUB_CODE_TEXT[subCode] || `刷脸未通过或未完成（${subCode || '无结果'}）`),
        };
      }
      lastMsg = FACE_CODE_TEXT[String(body.code)] || `${body.code || ''} ${body.message || ''}`.trim();
      if (String(body.code) !== '500') break;
    } catch (e: any) {
      lastMsg = e?.message || '实人认证查询异常';
    }
  }
  return { ok: false, message: lastMsg || '查询刷脸结果失败' };
}
