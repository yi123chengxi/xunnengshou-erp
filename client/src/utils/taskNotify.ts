/**
 * 任务提醒弹窗共享助手（提现任务 / 盘点任务 / 充值审批等待办）
 *
 * 统一三条行为，替代此前散落在各布局/页面里、closeIcon:false 的常驻弹窗：
 * 1. 右上角卡片带「X」关闭按钮（不再禁用 closeIcon）；
 * 2. 点 X 关闭后暂时隐藏该条，30 秒后自动重新弹出（记录抑制截止时间 + 触发重检事件，
 *    布局层的周期检查收到事件后立即复检）；
 * 3. 多条待办自动折叠堆叠（由 index.tsx 的 antd <App notification={{ stack }}> 提供，
 *    阈值 1：仅 1 条时正常展开，≥2 条折叠成一摞、悬停展开）。
 *
 * 说明：生产为 HTTP 非安全上下文，原生 Notification 恒 denied，本模块只负责
 * antd 页内降级弹窗分支；原生通道（showNativeNotification）仍由各调用点先行尝试。
 */
import { notification } from 'antd';
import dayjs from 'dayjs';

/** 关闭后重新弹出的间隔（毫秒） */
const RESHOW_MS = 30000;
/** 抑制截止时间存储键：{ [通知key]: 到期时间戳 } */
const SUPPRESS_STORE_KEY = 'task_notify_suppress_until';
/** 关闭后到期复检的广播事件名（布局层监听后立即重跑检查） */
export const TASK_NOTIFY_RESHOW_EVENT = 'task-notify-reshow';

/**
 * 各待办类型的卡片 key 前缀（清扫时按类限定，互不误伤）。
 * 提现任务有三个历史命名：发布端 withdraw-task-<店铺key>、页内重提醒 withdraw-task-remind-<店铺key>、
 * 布局层 wd-task-<店铺key>，撤下残留时三者都要覆盖。
 */
export const WITHDRAW_TASK_NOTIF_PREFIXES = ['wd-task-', 'withdraw-task-'];
export const INVENTORY_TASK_NOTIF_PREFIXES = ['inv-task-'];

const readSuppressMap = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(SUPPRESS_STORE_KEY) || '{}'); } catch { return {}; }
};

/** 该通知 key 当前是否处于「已关闭、暂不弹出」的抑制窗口内 */
export const isTaskNotifySuppressed = (key: string): boolean => {
  const map = readSuppressMap();
  const until = map[key] || 0;
  if (until > Date.now()) return true;
  // 过期项顺手清理，避免存储无限增长
  if (until) { delete map[key]; localStorage.setItem(SUPPRESS_STORE_KEY, JSON.stringify(map)); }
  return false;
};

const suppressTaskNotify = (key: string, ms: number): void => {
  const map = readSuppressMap();
  map[key] = Date.now() + ms;
  localStorage.setItem(SUPPRESS_STORE_KEY, JSON.stringify(map));
};

const clearSuppression = (key: string): void => {
  const map = readSuppressMap();
  if (!(key in map)) return;
  delete map[key];
  localStorage.setItem(SUPPRESS_STORE_KEY, JSON.stringify(map));
};

/**
 * 当前页面上由本模块弹出的卡片 key 集合（内存态）。
 * 待办一旦被处理完，布局层靠它把仍挂在右下角的旧卡片撤下——
 * 此前各恢复逻辑只会「停止再弹」，从不会关闭已弹出的常驻卡片，
 * 导致盘点/提现完成后的提醒必须人工关闭。
 */
const shownKeys = new Set<string>();

/**
 * 撤下一条任务提醒：销毁卡片 + 清掉抑制标记。
 * 必须清抑制标记，否则「任务完成后又新起一个同名任务」会被抑制窗口静默吞掉。
 */
export const closeTaskNotify = (key: string): void => {
  shownKeys.delete(key);
  clearSuppression(key);
  try { notification.destroy(key); } catch { /* ignore */ }
};

/**
 * 清扫：前缀命中且不在 keep 集合内的已弹卡片一律撤下。
 * 限定前缀是为了让各待办类型互不误伤——充值审批（rech-）与提现任务（wd-/withdraw-）
 * 共用同一模块，盘点任务的复检不能顺手关掉别人正在提醒的卡片。
 */
export const pruneTaskNotifs = (prefixes: string[], keep: Set<string>): void => {
  Array.from(shownKeys).forEach(key => {
    if (keep.has(key)) return;
    if (prefixes.some(p => key.startsWith(p))) closeTaskNotify(key);
  });
};

// ===================== 提现任务「已办理」判定（以发布任务时间为锚点） =====================

/** 比较窗口下限：发布任务时间往前 3 天（不设上限——发布之后任意时间的提现都算已办理） */
const WITHDRAW_MATCH_DAYS = 3;

/** 提现任务发布时刻存储键（发布端 WithdrawalRecordPage 写入 { [店铺key]: 'YYYY-MM-DD HH:mm' }） */
export const withdrawTaskStatusKey = (owner: string): string => `withdrawal_task_status_${owner}`;

/** 读取某店铺提现任务的发布时刻；无在途任务或数据异常时返回空串 */
export const readWithdrawTaskLaunchAt = (owner: string, shopKey: string): string => {
  try {
    const map = JSON.parse(localStorage.getItem(withdrawTaskStatusKey(owner)) || '{}');
    const v = map && typeof map === 'object' ? (map as Record<string, any>)[shopKey] : '';
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
};

/** 提现记录参与比较的时间：优先录入时间 createdAt，退回提现日期 withdrawalDate；不可解析则不参与比较 */
const withdrawRecordTime = (r: any) => {
  const t = String(r?.createdAt || r?.withdrawalDate || '').trim();
  if (!t) return null;
  const d = dayjs(t);
  return d.isValid() ? d : null;
};

/**
 * 该店铺是否「已办理提现」——右下角提现任务提醒据此撤下/不再弹出，发起任务弹窗据此禁用勾选。
 *
 * 口径以「发布任务时间」为锚点，只设下限、不设上限：提现记录时间 ≥ 发布时间-3天 即算已办理，
 * 也就是「只要提现了就不再催」（发布后过多久提的都算），且发布前 3 天内已提过的也视为已提现。
 * 此前是 [发布-3天, 发布+3天] 双边窗口，发布超 3 天才去提现的反而被判「未提现」→ 反复弹提醒。
 * 再早一版是拿记录时间与「当前时间-3天」比较，任务发布满 3 天后哪怕记录就写在发布当天也会被判未提现。
 * launchedAt 缺失/不可解析（历史任务数据、或该店铺本就没有在途任务）时退回旧的「最近 3 天」口径。
 */
export const hasWithdrawRecordAroundLaunch = (
  records: any[],
  shopName: string,
  launchedAt?: string,
): boolean => {
  const list = Array.isArray(records) ? records : [];
  const raw = String(launchedAt || '').trim();
  const anchor = raw ? dayjs(raw) : null;
  const base = anchor && anchor.isValid() ? anchor : dayjs();
  const from = base.subtract(WITHDRAW_MATCH_DAYS, 'day').startOf('day');
  const name = String(shopName || '');
  return list.some((r: any) => {
    if (String(r?.shopName || '') !== name) return false;
    const t = withdrawRecordTime(r);
    return !!t && !t.isBefore(from);
  });
};

/**
 * 弹出一条可关闭、关闭后 30 秒重弹的任务提醒（antd 页内卡片）。
 * @returns 是否实际弹出（处于抑制窗口内则跳过并返回 false）
 */
export const showTaskNotify = (
  key: string,
  title: string,
  body: string,
  onClick?: () => void,
): boolean => {
  if (isTaskNotifySuppressed(key)) return false;
  shownKeys.add(key);
  notification.warning({
    key,
    message: title,
    description: body,
    duration: 0,
    onClick,
    onClose: () => {
      // 点 X 关闭：抑制 RESHOW_MS 后广播复检事件，由布局层重跑检查重新弹出
      shownKeys.delete(key);
      suppressTaskNotify(key, RESHOW_MS);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(TASK_NOTIFY_RESHOW_EVENT, { detail: { key } }));
      }, RESHOW_MS);
    },
  });
  return true;
};
