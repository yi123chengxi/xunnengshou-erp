/**
 * 账单操作日志工具
 * 存储方式：JSON 字符串存储在账单记录的 billLog 字段内
 * 每条日志：{ time, action, operator, detail? }
 */

// ==================== 类型 ====================

export interface BillLogEntry {
  time: string;         // 操作时间（toLocaleString）
  action: string;       // 操作类型
  operator: string;     // 操作人显示名
  detail?: string;      // 操作详情
}

// ==================== 操作人解析 ====================

/** 获取当前登录用户的显示名称 */
export const getCurrentUserDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const user = users.find((u: any) => u.username === username);
    if (user?.contactPerson) return user.contactPerson;
    if (user?.displayName) return user.displayName;
    if (user?.companyName) return user.companyName;
  } catch { /* ignore */ }
  return username;
};

/** 根据用户名解析显示名称 */
export const resolveOperatorName = (username: string): string => {
  if (!username) return '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const user = users.find((u: any) => u.username === username);
    if (user?.contactPerson) return user.contactPerson;
    if (user?.displayName) return user.displayName;
    if (user?.companyName) return user.companyName;
  } catch { /* ignore */ }
  return username;
};

// ==================== 日志读写 ====================

/** 从账单记录中读取日志 */
export const readBillLog = (record: any): BillLogEntry[] => {
  try {
    if (record?.billLog) return JSON.parse(record.billLog);
  } catch { /* ignore */ }
  return [];
};

/** 向账单记录追加一条日志，返回更新后的 billLog JSON 字符串 */
export const appendBillLogEntry = (
  existingLog: string | undefined,
  action: string,
  operator?: string,
  detail?: string,
): string => {
  const logs: BillLogEntry[] = existingLog ? JSON.parse(existingLog) : [];
  logs.push({
    time: new Date().toLocaleString('zh-CN'),
    action,
    operator: operator || getCurrentUserDisplayName(),
    ...(detail ? { detail } : {}),
  });
  return JSON.stringify(logs);
};

// ==================== 字段映射 ====================

/** 供应商账单明细字段中文映射 */
export const SUPPLIER_BILL_FIELD_MAP: Record<string, string> = {
  id: '订单编号',
  outboundNo: '出库单号',
  auxDocNo: '辅助单据号',
  customerName: '客户名称',
  outboundDate: '出库日期',
  totalCount: '商品总数',
  productDetail: '货品明细',
  totalAmount: '商品总额',
  paidAmount: '已付金额',
  receivableAmount: '应收货款',
  reconResult: '对账结果',
  diffDesc: '差异说明',
  supplierReconPerson: '供应商对账人',
  purchaserReconPerson: '采购商对账人',
  items: '货品明细',
  image: '备注图片',
};

/** 采购商账单字段中文映射 */
export const PURCHASER_BILL_FIELD_MAP: Record<string, string> = {
  outboundNo: '出库单号',
  prefix: '单号前缀',
  supplier: '供应商',
  date: '日期',
  items: '货品明细',
  totalQty: '总数量',
  totalAmount: '采购金额',
  reconcileResult: '对账结果',
  diffNote: '差异说明',
  supplierReconciler: '供应商对账人',
  purchaserReconciler: '采购商对账人',
  recorder: '录入员',
  purchaserImages: '备注图片',
};

/** 通用字段名解析 */
export const resolveFieldName = (key: string, fieldMap: Record<string, string>): string => {
  return fieldMap[key] || key;
};

/**
 * 解析货品明细字符串为 Map<商品编码, 数量>
 * 支持分隔符：中文逗号"，"、英文逗号","、顿号"、"
 * 格式示例："6150-白色-35×3，6108-红色-36×5"
 */
const parseProductDetail = (str: string): Map<string, number> => {
  const map = new Map<string, number>();
  if (!str) return map;
  str.split(/[,，、]/).forEach(part => {
    const p = part.trim();
    if (!p) return;
    const m = p.match(/^(.+?)[×x*](\d+(?:\.\d+)?)$/);
    if (m) {
      const code = m[1].trim();
      const qty = Number(m[2]) || 0;
      map.set(code, (map.get(code) || 0) + qty);
    } else {
      map.set(p, (map.get(p) || 0) + 1);
    }
  });
  return map;
};

/**
 * 比较两个货品明细字符串，返回变更摘要（仅列出有差异的商品编码）
 * 返回 null 表示无差异
 */
const diffProductDetail = (oldStr: string, newStr: string): string | null => {
  const oldMap = parseProductDetail(oldStr);
  const newMap = parseProductDetail(newStr);
  const allCodes = new Set(Array.from(oldMap.keys()).concat(Array.from(newMap.keys())));
  const diffs: string[] = [];
  allCodes.forEach(code => {
    const oq = oldMap.get(code) || 0;
    const nq = newMap.get(code) || 0;
    if (oq === nq) return;
    if (oq === 0) {
      diffs.push(`+${code}×${nq}`);
    } else if (nq === 0) {
      diffs.push(`-${code}×${oq}`);
    } else {
      diffs.push(`${code}：${oq}→${nq}`);
    }
  });
  return diffs.length > 0 ? diffs.join('，') : null;
};

/** 比较两个账单记录的差异，返回变更详情字符串 */
export const diffBillRecords = (
  oldRec: any,
  newRec: any,
  fieldMap: Record<string, string>,
  excludeKeys: string[] = [],
): string => {
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(oldRec || {}), ...Object.keys(newRec || {})]);
  // 排除内部字段
  const skip = new Set(['key', 'billLog', 'createdAt', 'updatedAt', '_manual', ...excludeKeys]);
  allKeys.forEach(key => {
    if (skip.has(key)) return;
    const oldVal = oldRec?.[key];
    const newVal = newRec?.[key];
    // 忽略数组/对象深层比较（货品明细单独处理）
    if (key === 'items') {
      const oldLen = Array.isArray(oldVal) ? oldVal.length : 0;
      const newLen = Array.isArray(newVal) ? newVal.length : 0;
      if (oldLen !== newLen) {
        changes.push(`货品明细：${oldLen}项 → ${newLen}项`);
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        // 列出有变更的商品编码
        const oldCodes = new Map<string, number>();
        const newCodes = new Map<string, number>();
        (Array.isArray(oldVal) ? oldVal : []).forEach((it: any) => {
          const c = it.productCode || it.styleCode || `ITEM`;
          oldCodes.set(c, (oldCodes.get(c) || 0) + (Number(it.quantity) || 0));
        });
        (Array.isArray(newVal) ? newVal : []).forEach((it: any) => {
          const c = it.productCode || it.styleCode || `ITEM`;
          newCodes.set(c, (newCodes.get(c) || 0) + (Number(it.quantity) || 0));
        });
        const allC = new Set(Array.from(oldCodes.keys()).concat(Array.from(newCodes.keys())));
        const diffs: string[] = [];
        allC.forEach(code => {
          const oq = oldCodes.get(code) || 0;
          const nq = newCodes.get(code) || 0;
          if (oq === nq) return;
          if (oq === 0) diffs.push(`+${code}×${nq}`);
          else if (nq === 0) diffs.push(`-${code}×${oq}`);
          else diffs.push(`${code}：${oq}→${nq}`);
        });
        if (diffs.length > 0) {
          changes.push(`货品明细变更：${diffs.join('，')}`);
        } else {
          changes.push('货品明细：内容有修改');
        }
      }
      return;
    }
    // productDetail 字段：智能对比，仅显示有变更的商品编码
    if (key === 'productDetail') {
      const o = String(oldVal ?? '');
      const n = String(newVal ?? '');
      if (o !== n) {
        const diff = diffProductDetail(o, n);
        if (diff) {
          changes.push(`货品明细变更：${diff}`);
        }
        // 不输出完整字符串对比，避免日志过长
      }
      return;
    }
    if (typeof oldVal === 'object' || typeof newVal === 'object') return;
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      const label = resolveFieldName(key, fieldMap);
      const o = oldVal !== undefined && oldVal !== null && oldVal !== '' ? String(oldVal) : '空';
      const n = newVal !== undefined && newVal !== null && newVal !== '' ? String(newVal) : '空';
      changes.push(`${label}：${o} → ${n}`);
    }
  });
  return changes.join('\n');
};

// ==================== 操作颜色 ====================

/** 账单日志操作类型 → 颜色 */
export const billLogColor = (action: string): string => {
  if (action.includes('创建')) return '#fa8c16';
  if (action.includes('编辑')) return '#722ed1';
  if (action.includes('删除')) return '#f5222d';
  if (action.includes('发起对账')) return '#1677ff';
  if (action.includes('撤回')) return '#ff7a45';
  if (action.includes('按供方入账') || action.includes('按采方入账')) return '#13c2c2';
  if (action.includes('确认') || action.includes('对账完成')) return '#52c41a';
  if (action.includes('不相符') || action.includes('账目不符')) return '#f5222d';
  return '#595959';
};
