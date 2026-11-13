/**
 * 按账号隔离的本地键（旧版裸键兼容层）
 *
 * 背景：部分配置（批量新增模版、自定义银行、表格列配置等）历史上用「裸键」存储，
 * 既不能被同步白名单识别（换电脑丢失），也会在多账号共用同一浏览器时互相串数据。
 * 这里统一改成 `<基名>_<数据归属账号>`，并在读取时把旧裸键的值自动迁移过去。
 */
import { safeSetItem } from './storageQuota';

/** 数据归属账号：子账号归主账号（与 serverSync 的 currentOwner 保持一致） */
export function dataOwner(): string {
  try {
    if (localStorage.getItem('isSubAccount') === 'true') {
      return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    }
    return localStorage.getItem('username') || '';
  } catch { return ''; }
}

/** 裸键 → 带账号后缀的键（如 customBanks → customBanks_admin） */
export function scopedStorageKey(base: string): string {
  return `${base}_${dataOwner()}`;
}

/** 复合键：前缀 + 后缀 + 账号（如 prBomManualQty_<单号>_<账号>）
 *  账号必须落在末段，同步链路的归属判定（keyOwner 取最后一个下划线后的账号）才认得出 */
export function ownerSuffixKey(prefix: string, suffix: string): string {
  return `${prefix}${suffix}_${dataOwner()}`;
}

/** 读取：优先带账号键；不存在时回退旧裸键并迁移（迁移写入会触发同步上传） */
export function readScopedItem(base: string): string | null {
  try {
    const key = scopedStorageKey(base);
    const scoped = localStorage.getItem(key);
    if (scoped !== null) return scoped;
    const legacy = localStorage.getItem(base);
    if (legacy !== null) {
      safeSetItem(key, legacy);
      return legacy;
    }
    return null;
  } catch { return null; }
}

export function writeScopedItem(base: string, value: string): boolean {
  try { return safeSetItem(scopedStorageKey(base), value); } catch { return false; }
}

export function removeScopedItem(base: string): void {
  try { localStorage.removeItem(scopedStorageKey(base)); } catch { /* ignore */ }
}

/** 复合键读取（带旧键迁移） */
export function readOwnerSuffixItem(prefix: string, suffix: string): string | null {
  try {
    const key = ownerSuffixKey(prefix, suffix);
    const scoped = localStorage.getItem(key);
    if (scoped !== null) return scoped;
    const legacy = localStorage.getItem(`${prefix}${suffix}`);
    if (legacy !== null) {
      safeSetItem(key, legacy);
      return legacy;
    }
    return null;
  } catch { return null; }
}

/** 复合键写入 */
export function writeOwnerSuffixItem(prefix: string, suffix: string, value: string): boolean {
  try { return safeSetItem(ownerSuffixKey(prefix, suffix), value); } catch { return false; }
}

export function removeOwnerSuffixItem(prefix: string, suffix: string): void {
  try { localStorage.removeItem(ownerSuffixKey(prefix, suffix)); } catch { /* ignore */ }
}
