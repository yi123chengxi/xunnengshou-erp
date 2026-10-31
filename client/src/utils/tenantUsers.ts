// 租户隔离工具：解析当前登录租户的成员账号列表（主账号 + 子账号）
// 背景：registeredUsers 为全局共享存储（所有租户混存），任何"人员选择"类列表
// 必须经 loadTenantUsers 过滤，否则会把其他租户的账号混入本租户选项。

/** 解析数据归属账号（子账号沿 parentAccount 追溯到主账号） */
export const getTenantOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (!isSub) return localStorage.getItem('username') || '';
  return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
};

/** 当前租户的成员账号：主账号本身 + parentAccount 链可追溯到该主账号的全部子账号 */
export const loadTenantUsers = (): any[] => {
  let users: any[] = [];
  try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { return []; }
  if (!Array.isArray(users)) return [];
  const owner = getTenantOwner();
  // 沿 parentAccount 链追溯到主账号（兼容多层子账号与链断裂场景）
  const rootOf = (u: any): string => {
    let cur = u;
    const visited = new Set<string>();
    while (cur && cur.isSubAccount && cur.parentAccount && !visited.has(cur.username)) {
      visited.add(cur.username);
      cur = users.find((x: any) => x.username === cur.parentAccount);
    }
    if (cur && !cur.isSubAccount) return cur.username || '';
    if (u && u.isSubAccount) return u.parentAccount || '';
    return u?.username || '';
  };
  return users.filter((u: any) => rootOf(u) === owner);
};

/** 成员账号显示名称 */
export const tenantUserDisplayName = (u: any): string => u?.contactPerson || u?.companyName || u?.username || '';
