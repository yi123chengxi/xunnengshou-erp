/**
 * JWT 密钥来源（按优先级）：
 * 1. 环境变量 JWT_SECRET（运维显式配置，建议 >= 32 位随机串）
 * 2. 服务端数据目录下的 jwt.secret 文件（首次启动自动生成 96 位十六进制随机串并持久化）
 *
 * 禁止再回退到代码里的固定字符串：固定密钥一旦随仓库泄露，任何持仓库者都能为任意账号
 * 伪造令牌直连 /api/sync 读写全部租户数据。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SECRET_FILE_NAME = 'jwt.secret';
const MIN_STRONG_LENGTH = 32;

let cachedSecret = '';

/** 数据目录与 SQLite 保持一致：<repo>/server/data（开发与编译后均指向同一目录） */
function dataDir(): string {
  return process.env.SERVER_DATA_DIR
    ? String(process.env.SERVER_DATA_DIR)
    : path.join(__dirname, '../../data');
}

function readSecretFile(file: string): string {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw.length >= MIN_STRONG_LENGTH ? raw : '';
  } catch {
    return '';
  }
}

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const fromEnv = String(process.env.JWT_SECRET || '').trim();
  if (fromEnv) {
    if (fromEnv.length < MIN_STRONG_LENGTH) {
      console.warn(`[security] JWT_SECRET 长度不足 ${MIN_STRONG_LENGTH} 位，建议更换为随机长串`);
    }
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  const file = path.join(dataDir(), SECRET_FILE_NAME);
  const existing = readSecretFile(file);
  if (existing) {
    cachedSecret = existing;
    return cachedSecret;
  }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600 });
    console.log(`[security] 已生成 JWT 密钥并持久化: ${file}`);
  } catch (err: any) {
    // 写文件失败（只读文件系统等）时仍使用本次进程内随机密钥，重启后旧令牌失效但服务可用
    console.error('[security] JWT 密钥持久化失败，本次进程使用临时随机密钥:', err?.message || err);
  }
  cachedSecret = generated;
  return cachedSecret;
}
