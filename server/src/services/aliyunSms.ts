/**
 * 阿里云短信服务封装（短信验证码登录）
 *
 * 配置项（server/.env）：
 *   ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET —— RAM 用户的 AccessKey（建议授予 AliyunDysmsFullAccess）
 *   ALIYUN_SMS_SIGN_NAME —— 短信签名（控制台「签名管理」中可用状态的签名名称）
 *   ALIYUN_SMS_TEMPLATE_CODE —— 短信模板 CODE（控制台「模板管理」审核通过的验证码模板，SMS_ 开头）
 * 未配置时调用方走开发模式（验证码直接返回前端），配置后自动切换真实发送。
 */
import Dysmsapi20170525, * as $Dysmsapi from '@alicloud/dysmsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';

export function isSmsConfigured(): boolean {
  return !!(
    process.env.ALIYUN_ACCESS_KEY_ID &&
    process.env.ALIYUN_ACCESS_KEY_SECRET &&
    process.env.ALIYUN_SMS_SIGN_NAME &&
    process.env.ALIYUN_SMS_TEMPLATE_CODE
  );
}

let client: Dysmsapi20170525 | null = null;
function getClient(): Dysmsapi20170525 {
  if (client) return client;
  const config = new $OpenApi.Config({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
  });
  config.endpoint = 'dysmsapi.aliyuncs.com';
  client = new Dysmsapi20170525(config);
  return client;
}

/** 发送验证码短信；模板变量约定为 ${code} */
export async function sendSmsCode(phone: string, code: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const req = new $Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName: process.env.ALIYUN_SMS_SIGN_NAME,
      templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
      templateParam: JSON.stringify({ code }),
    });
    const runtime = new $Util.RuntimeOptions({});
    const resp = await getClient().sendSmsWithOptions(req, runtime);
    const body: any = resp.body || {};
    if (body.code === 'OK') return { ok: true };
    return { ok: false, message: `${body.code || ''} ${body.message || ''}`.trim() };
  } catch (e: any) {
    return { ok: false, message: e?.message || '短信发送异常' };
  }
}
