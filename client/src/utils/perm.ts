/**
 * PERM_V2 权限解析器（三态 allow/deny/inherit + deny 优先）
 * 解析链：用户显式覆写 → 开发者客户层（显式 deny / 白名单） → 角色三态层 →  legacy 白名单（仅供应商菜单/子账号） → 默认
 * 兼容契约：
 *  - 主账号（非子账号）不受角色层限制（bypass）
 *  - 开发者白名单 dev_customer_perms_<username> 语义不变（未设置=全部允许；设置后未列入=隐藏）
 *  - 子账号 legacy 角色/独立权限白名单（registeredUsers.roles + customPermissions）语义不变
 *  - 开发者后台子账号沿用 dev 角色 permissions（点号 key）
 */
import { useEffect, useState, useCallback } from 'react';
import { PermScope, PermTri, isMenuPoint } from '../config/permRegistry';
import { getAllRoles, getMergedPermissions, getRolesStorageKey } from '../config/permissions';
import { getDevIdentity, getSubRole } from './devStore';

export const PERM_EVENT = 'perm-changed';
export const emitPermChanged = () => window.dispatchEvent(new Event(PERM_EVENT));

// ===================== 存储读写 =====================
const accountBase = (): string => getRolesStorageKey().slice('roles_'.length);

/** 角色三态覆写：role_permsettings_<账号基> = Record<roleKey, Record<pointKey, PermTri>> */
export const loadRolePermSettings = (): Record<string, Record<string, PermTri>> => {
  try {
    const raw = localStorage.getItem(`role_permsettings_${accountBase()}`);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
export const saveRolePermSettings = (roleKey: string, settings: Record<string, PermTri>) => {
  const all = loadRolePermSettings();
  if (Object.keys(settings).length === 0) delete all[roleKey];
  else all[roleKey] = settings;
  localStorage.setItem(`role_permsettings_${accountBase()}`, JSON.stringify(all));
  appendPermAudit('角色三态权限保存', `角色=${roleKey}；显式设置 ${Object.keys(settings).length} 项`);
  emitPermChanged();
};

/** 开发者客户层显式 deny：dev_customer_deny_<username> = string[] */
export const loadDevDeny = (username?: string): string[] => {
  try {
    const u = username ?? (localStorage.getItem('username') || '');
    const raw = localStorage.getItem(`dev_customer_deny_${u}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
export const saveDevDeny = (username: string, keys: string[]) => {
  localStorage.setItem(`dev_customer_deny_${username}`, JSON.stringify(keys));
  appendPermAudit('开发者显式禁止页保存', `客户=${username}；禁止 ${keys.length} 项`);
  window.dispatchEvent(new Event('dev-perms-changed'));
  emitPermChanged();
};

const readRegisteredUser = (username: string): any => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return users.find(u => u.username === username) || null;
  } catch { return null; }
};

/** 账号个人三态覆写（存 registeredUsers 条目 permOverrides，与角色/独立权限同源） */
export const loadUserPermOverrides = (username: string): Record<string, PermTri> => {
  const u = readRegisteredUser(username);
  return u && u.permOverrides && typeof u.permOverrides === 'object' ? u.permOverrides : {};
};
export const saveUserPermOverrides = (username: string, overrides: Record<string, PermTri>) => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const idx = users.findIndex(u => u.username === username);
    if (idx >= 0) {
      users[idx] = { ...users[idx], permOverrides: overrides };
      localStorage.setItem('registeredUsers', JSON.stringify(users));
    }
  } catch { /* ignore */ }
  appendPermAudit('账号个人覆写保存', `账号=${username}；显式设置 ${Object.keys(overrides).length} 项`);
  emitPermChanged();
};

// ===================== 权限变更审计日志 =====================
export interface PermAuditEntry { time: string; operator: string; action: string; detail: string; }
export const loadPermAudit = (): PermAuditEntry[] => {
  try {
    const raw = localStorage.getItem(`perm_audit_${accountBase()}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
export const appendPermAudit = (action: string, detail: string) => {
  try {
    const list = loadPermAudit();
    list.unshift({ time: new Date().toLocaleString('zh-CN'), operator: localStorage.getItem('displayName') || localStorage.getItem('username') || '-', action, detail });
    localStorage.setItem(`perm_audit_${accountBase()}`, JSON.stringify(list.slice(0, 200)));
  } catch { /* ignore */ }
};

// ===================== 视角预览（以某子账号身份试看菜单/页面门控） =====================
export const getPreviewUser = (): string => localStorage.getItem('perm_preview_user') || '';
export const setPreviewUser = (u: string) => {
  if (u) localStorage.setItem('perm_preview_user', u);
  else localStorage.removeItem('perm_preview_user');
  emitPermChanged();
};

const readDevWhitelist = (username: string): string[] | null => {
  try {
    const raw = localStorage.getItem(`dev_customer_perms_${username}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k: string) => typeof k === 'string' && !k.startsWith('PERM_V')) : null;
  } catch { return null; }
};

// ===================== 解析 =====================
/** 菜单/功能/字段点统一判定 */
export const resolvePerm = (scope: PermScope, key: string): boolean => {
  // 开发者后台：沿用开发者子账号角色 permissions（点号 key），主开发者全通
  if (scope === 'dev') {
    const identity = getDevIdentity();
    if (!identity.isSub) return true;
    const role = getSubRole(identity.user);
    if (!role) return false;
    const dot = key.replace(/^dev\//, '').replace(/\//g, '.');
    return (role.permissions || []).includes(dot);
  }

  let username = getPreviewUser() || (localStorage.getItem('username') || '');
  let isSub = getPreviewUser() ? true : localStorage.getItem('isSubAccount') === 'true';
  // 视角预览：按目标账号的注册信息解析角色层（预览主账号=不受角色限制）
  const pv = getPreviewUser();
  if (pv) {
    const pu = readRegisteredUser(pv);
    isSub = !!pu?.isSubAccount;
  }

  // 1) 用户显式覆写（最高优先级，deny 优先于其下所有层）
  const ov = loadUserPermOverrides(username)[key];
  if (ov === 'allow') return true;
  if (ov === 'deny') return false;

  // 2) 开发者客户层：显式 deny → 拒绝；白名单存在且未列入 → 拒绝
  if (loadDevDeny(username).includes(key)) return false;
  const wl = readDevWhitelist(username);
  if (wl && !wl.includes(key)) return false;

  // 3) 角色层（仅子账号；主账号 bypass）
  if (isSub) {
    const user = readRegisteredUser(username);
    const roleNames: string[] = Array.isArray(user?.roles) ? user.roles : [];
    const customPerms: string[] = Array.isArray(user?.customPermissions) ? user.customPermissions : [];
    const settingsAll = loadRolePermSettings();
    const allRoles = getAllRoles();
    let roleAllow = false;
    for (const name of roleNames) {
      const role = allRoles.find(r => r.name === name);
      if (!role) continue;
      const st = settingsAll[role.key]?.[key];
      if (st === 'deny') return false;
      if (st === 'allow') roleAllow = true;
    }
    if (roleAllow) return true;
    // legacy 白名单：仅供应商菜单点保留「未列入=不可见」语义；其余默认放行
    if (isMenuPoint('supplier', key) && scope === 'supplier') {
      return getMergedPermissions(roleNames, customPerms).includes(key);
    }
    return true;
  }
  return true;
};

export const menuVisible = (scope: PermScope, key: string): boolean => resolvePerm(scope, key);

/** 功能点判定：fn:<菜单key>:<动作> */
export const canFn = (scope: PermScope, menuKey: string, action: string): boolean => resolvePerm(scope, `fn:${menuKey}:${action}`);
/** 字段点判定：field:<菜单key>:<字段>:<view|edit> */
export const canField = (menuKey: string, dataIndex: string, mode: 'view' | 'edit'): boolean => resolvePerm('supplier', `field:${menuKey}:${dataIndex}:${mode}`);

/** 路由 → 菜单权限点；非菜单路由返回 null（不拦截） */
export const menuKeyFromPath = (scope: PermScope, pathname: string): string | null => {
  if (scope === 'supplier') {
    const seg = pathname.replace(/^\//, '').split('/').filter(Boolean);
    if (seg.length === 0 || seg[0] === 'dashboard') return null;
    const key = seg.slice(0, 2).join('/');
    return isMenuPoint('supplier', key) ? key : null;
  }
  const prefix = `/${scope}/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/$/, '');
  if (!rest) return null;
  const key = `${scope}/${rest}`;
  return isMenuPoint(scope, key) ? key : null;
};

// ===================== 响应式 hook =====================
/** 订阅权限变更（本地事件 + 跨标签 storage），返回自增 tick 供 useMemo 依赖 */
export const usePermTick = (): number => {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const k = e.key || '';
      if (k.startsWith('role_permsettings_') || k.startsWith('dev_customer_perms_') || k.startsWith('dev_customer_deny_') || k === 'registeredUsers' || k.startsWith('roles_') || k.startsWith('preset_role_overrides_')) bump();
    };
    window.addEventListener(PERM_EVENT, bump);
    window.addEventListener('dev-perms-changed', bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PERM_EVENT, bump);
      window.removeEventListener('dev-perms-changed', bump);
      window.removeEventListener('storage', onStorage);
    };
  }, [bump]);
  return tick;
};
