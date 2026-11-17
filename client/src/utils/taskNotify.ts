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

/** 关闭后重新弹出的间隔（毫秒） */
const RESHOW_MS = 30000;
/** 抑制截止时间存储键：{ [通知key]: 到期时间戳 } */
const SUPPRESS_STORE_KEY = 'task_notify_suppress_until';
/** 关闭后到期复检的广播事件名（布局层监听后立即重跑检查） */
export const TASK_NOTIFY_RESHOW_EVENT = 'task-notify-reshow';

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
  notification.warning({
    key,
    message: title,
    description: body,
    duration: 0,
    onClick,
    onClose: () => {
      // 点 X 关闭：抑制 RESHOW_MS 后广播复检事件，由布局层重跑检查重新弹出
      suppressTaskNotify(key, RESHOW_MS);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(TASK_NOTIFY_RESHOW_EVENT, { detail: { key } }));
      }, RESHOW_MS);
    },
  });
  return true;
};
