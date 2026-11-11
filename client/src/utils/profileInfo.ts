/**
 * 企业信息弹窗取数契约：子账号公司级字段继承主账号注册记录
 * - 子账号的 registeredUsers 记录仅含身份/联系字段（用户名/姓名/手机号/角色/权限），
 *   公司级字段（认证主体、公司编号、单号前缀、纳税人识别码、经营地址、注册日期、
 *   审核状态、试用/授权有效期、银行与收款、二维码等）以主账号（parentAccount）记录为准；
 * - 企业认证为公司级行为：子账号的认证状态查询使用主账号 username，继承主账号认证结果。
 */

// 子账号缺失时从主账号记录继承的公司级字段
const COMPANY_INHERIT_FIELDS = [
  'companyShortName', 'companyNo', 'orderPrefix', 'legalPerson', 'taxpayerCode',
  'province', 'city', 'district', 'addressDetail', 'businessAddress',
  'email', 'registerDate', 'status', 'trialEndDate', 'authorizedUntil',
  'accountName', 'bankName', 'branchName', 'bankAccountNo', 'payBankInfo', 'payQrImage', 'wechatQr',
];

/** 企业信息弹窗/头部展示取数：子账号合并主账号公司级字段后返回 */
export const getProfileUserInfo = (): any => {
  try {
    const username = localStorage.getItem('username');
    if (!username) return null;
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    if (!Array.isArray(users)) return null;
    const me = users.find((u: any) => u.username === username) || null;
    if (!me) return null;
    if (localStorage.getItem('isSubAccount') !== 'true') return me;
    const parent = localStorage.getItem('parentAccount') || '';
    const pu = parent ? users.find((u: any) => u.username === parent) : null;
    if (!pu) return me;
    const merged: any = { ...me };
    COMPANY_INHERIT_FIELDS.forEach(f => { if (!merged[f] && pu[f]) merged[f] = pu[f]; });
    // 公司名称与认证主体始终跟随主账号（主账号改名/认证通过后子账号同步可见）
    if (pu.companyName) merged.companyName = pu.companyName;
    return merged;
  } catch { return null; }
};

/** 企业认证状态查询用户名：子账号继承主账号认证结果 */
export const getCertQueryUsername = (): string => {
  try {
    if (localStorage.getItem('isSubAccount') === 'true') {
      return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    }
    return localStorage.getItem('username') || '';
  } catch { return ''; }
};
