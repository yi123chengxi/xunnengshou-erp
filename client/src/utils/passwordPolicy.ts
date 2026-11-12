/**
 * 统一密码策略（注册 / 重置 / 改密 / 子账号初始密码 共用）
 *
 * 设计口径参考 NIST SP 800-63B：长度优先于复杂度。
 * - 最少 10 位（12 位以上免复杂度要求），最长 64 位（允许短语式密码）；
 * - 12 位以下必须同时含字母与数字；
 * - 拒绝常见弱密码、连续/重复字符；
 * - 不允许包含账号名或手机号片段。
 * 修改本文件即可同时影响所有入口，避免各页面分散写 6 位规则。
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 64;
/** 达到该长度后不再强制字母+数字组合 */
export const PASSWORD_COMPLEXITY_FREE_LENGTH = 12;

/** 常见弱密码（小写比对） */
const WEAK_PASSWORDS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789',
  'password', 'passw0rd', 'p@ssword', 'qwerty', 'qwerty123', 'qwertyuiop',
  'abc123', 'abcd1234', 'a123456', 'a12345678', '111111', '000000', '888888',
  '666666', '123123', '5201314', 'woaini', 'iloveyou', 'admin', 'admin123',
  'administrator', 'root1234', 'asdfgh', 'asdfghjkl', '1qaz2wsx', 'zaq12wsx',
  '123qwe', '1q2w3e4r', 'aa123456', 'abcd123456', 'factory123', 'erp123456',
]);

export interface PasswordCheckResult {
  ok: boolean;
  /** 校验失败时的用户可见提示 */
  message: string;
  /** 0-100 粗略强度评分，供界面展示强弱条 */
  score: number;
}

/** 是否连续字符（123456 / abcdef / 654321 等） */
const hasSequentialRun = (pwd: string): boolean => {
  let run = 1;
  let dir = 0;
  for (let i = 1; i < pwd.length; i++) {
    const diff = pwd.charCodeAt(i) - pwd.charCodeAt(i - 1);
    if (diff === 1 || diff === -1) {
      const d = diff > 0 ? 1 : -1;
      if (d === dir || dir === 0) { run += 1; dir = d; } else { run = 2; dir = d; }
      if (run >= 4) return true;
    } else { run = 1; dir = 0; }
  }
  return false;
};

/** 是否重复字符（aaaa / 1111） */
const hasRepeatedRun = (pwd: string): boolean => /(.)\1{3,}/.test(pwd);

const roughScore = (pwd: string): number => {
  let classes = 0;
  if (/[a-z]/.test(pwd)) classes += 1;
  if (/[A-Z]/.test(pwd)) classes += 1;
  if (/\d/.test(pwd)) classes += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) classes += 1;
  const lenScore = Math.min(60, pwd.length * 5);
  const classScore = classes * 10;
  return Math.max(0, Math.min(100, lenScore + classScore));
};

/**
 * 校验密码强度。
 * @param pwd 待校验密码
 * @param opts.username 账号名（用于禁止密码包含账号名）
 * @param opts.phone 手机号（禁止包含后 6 位）
 * @param opts.min 覆盖最小长度（子账号初始密码等场景可放宽，不建议低于 8）
 */
export const validatePassword = (
  pwd: string,
  opts: { username?: string; phone?: string; min?: number } = {},
): PasswordCheckResult => {
  const value = String(pwd ?? '');
  const min = Math.max(6, Number(opts.min) || PASSWORD_MIN_LENGTH);
  const score = roughScore(value);

  if (!value) return { ok: false, message: '请输入密码', score: 0 };
  if (value.length < min) return { ok: false, message: `密码至少 ${min} 位`, score };
  if (value.length > PASSWORD_MAX_LENGTH) return { ok: false, message: `密码最多 ${PASSWORD_MAX_LENGTH} 位`, score };
  if (/\s/.test(value)) return { ok: false, message: '密码不能包含空格', score };

  const lower = value.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) return { ok: false, message: '密码过于常见，请更换更复杂的密码', score };
  if (hasRepeatedRun(value)) return { ok: false, message: '密码不能包含 4 位以上重复字符', score };
  if (hasSequentialRun(value)) return { ok: false, message: '密码不能包含 4 位以上连续字符', score };

  const uname = String(opts.username || '').trim().toLowerCase();
  if (uname.length >= 3 && lower.includes(uname)) return { ok: false, message: '密码不能包含账号名', score };
  const phone = String(opts.phone || '').trim();
  if (/^\d{11}$/.test(phone) && lower.includes(phone.slice(-6))) return { ok: false, message: '密码不能包含手机号后 6 位', score };

  if (value.length < PASSWORD_COMPLEXITY_FREE_LENGTH) {
    const hasLetter = /[A-Za-z]/.test(value);
    const hasDigit = /\d/.test(value);
    if (!hasLetter || !hasDigit) {
      return { ok: false, message: `密码需同时包含字母和数字（${PASSWORD_COMPLEXITY_FREE_LENGTH} 位以上可免）`, score };
    }
  }
  return { ok: true, message: '', score };
};

/** antd Form.Item 校验规则（注册 / 重置 / 改密通用） */
export const passwordFormRule = (opts: { username?: string; phone?: string; min?: number; required?: boolean } = {}) => ({
  validator: (_rule: any, value: any) => {
    if (!value) {
      return opts.required === false ? Promise.resolve() : Promise.reject(new Error('请输入密码'));
    }
    const r = validatePassword(String(value), opts);
    return r.ok ? Promise.resolve() : Promise.reject(new Error(r.message));
  },
});

/** 强度文案（0-100 → 弱/中/强） */
export const passwordStrengthLabel = (pwd: string): { label: string; color: string } => {
  const s = roughScore(String(pwd || ''));
  if (!pwd) return { label: '', color: '#d9d9d9' };
  if (s < 45) return { label: '弱', color: '#ff4d4f' };
  if (s < 75) return { label: '中', color: '#fa8c16' };
  return { label: '强', color: '#52c41a' };
};
