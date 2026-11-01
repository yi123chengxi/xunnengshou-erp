/**
 * 残留演示账号与其遗留登录会话的一次性清理（应用启动即执行）：
 * 1) 从 registeredUsers（含服务端同步副本）移除内置演示凭据（admin/123456 等）；
 * 2) localStorage 遗留会话的 username 若为已不存在于 registeredUsers 的演示账号，
 *    清除会话键使应用回退登录页（修复测试期会话"打开网址直接进入演示账号"）。
 */
import { safeSetItem } from './storageQuota';
import { flushDatasetUpload } from './serverSync';

// 内置演示身份（已取消；仅当密码仍为初始 123456 时才视为演示凭据，避免误伤同名真实注册账号）
const DEMO_CREDENTIALS = new Set(['admin|123456', 'purchaser1|123456', 'both1|123456']);
const DEMO_USERNAMES = ['admin', 'purchaser1', 'both1'];
// 登录写入的会话键（与 MainLayout 退出登录清理同口径）
const SESSION_KEYS = ['userRole', 'username', 'isViewOnly', 'isSubAccount', 'parentAccount', 'userRoles', 'userCustomPermissions'];

export function cleanupDemoAccountsAndSession() {
  try {
    const list: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const next = list.filter(u => !DEMO_CREDENTIALS.has(`${u?.username}|${u?.password}`));
    if (next.length !== list.length) {
      safeSetItem('registeredUsers', JSON.stringify(next));
      flushDatasetUpload('registeredUsers', JSON.stringify(next));
    }
    // 遗留会话校验：演示账号且已不存在于 registeredUsers → 视为无效会话立即清除
    const un = localStorage.getItem('username') || '';
    if (un && DEMO_USERNAMES.includes(un) && !next.some(u => u?.username === un)) {
      SESSION_KEYS.forEach(k => localStorage.removeItem(k));
    }
  } catch { /* ignore */ }
}
