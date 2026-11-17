/**
 * 任务提醒弹窗的撤下契约（对应缺陷：盘点/提现完成后右下角弹窗不自动消失，必须人工关闭）
 *
 * 恢复逻辑原本只有「停止再弹」，没有任何一处会关闭已经挂在屏幕上的常驻卡片，
 * 因此这里锁死两条行为：
 * 1. closeTaskNotify 既销毁卡片，也清掉「已关闭抑制」标记；
 * 2. pruneTaskNotifs 按前缀清扫，只撤下本轮不该再提醒的卡片，不误伤别的待办类型。
 *
 * 项目未安装 @types/jest，不能用 jest.mock/jest.Mock：
 * 直接对 antd notification 对象做运行时打桩（taskNotify 每次调用都实时取属性，打桩即生效）。
 */
import { notification } from 'antd';
import {
  showTaskNotify, closeTaskNotify, pruneTaskNotifs, isTaskNotifySuppressed,
  WITHDRAW_TASK_NOTIF_PREFIXES, INVENTORY_TASK_NOTIF_PREFIXES,
} from '../taskNotify';

type NotifyCfg = { key?: string; duration?: number; onClose?: () => void };

const SUPPRESS_KEY = 'task_notify_suppress_until';
const warnCalls: NotifyCfg[] = [];
const destroyKeys: (string | undefined)[] = [];

// 打桩挂在模块加载时执行一次即可：jest 每个测试文件独占一份模块注册表，
// 这里的 notification 替换不会泄漏到其他测试文件
(notification as any).warning = (cfg: NotifyCfg) => { warnCalls.push(cfg); };
(notification as any).destroy = (key?: string) => { destroyKeys.push(key); };

/** 取最近一次弹出的配置项（用于手工触发 onClose，模拟用户点 X） */
const lastNotifyArgs = (): NotifyCfg => warnCalls[warnCalls.length - 1];

beforeEach(() => {
  warnCalls.length = 0;
  destroyKeys.length = 0;
  localStorage.clear();
});

describe('任务提醒弹窗自动撤下', () => {
  it('弹出常驻卡片：duration 0 且带 key，供后续按 key 销毁', () => {
    expect(showTaskNotify('inv-task-shop1', '盘点任务提醒', 'body')).toBe(true);
    expect(lastNotifyArgs().key).toBe('inv-task-shop1');
    expect(lastNotifyArgs().duration).toBe(0);
  });

  it('用户点 X 关闭后进入抑制窗口，同 key 不再弹出', () => {
    showTaskNotify('inv-task-shop1', '盘点任务提醒', 'body');
    lastNotifyArgs().onClose!();
    expect(isTaskNotifySuppressed('inv-task-shop1')).toBe(true);
    warnCalls.length = 0;
    expect(showTaskNotify('inv-task-shop1', '盘点任务提醒', 'body')).toBe(false);
    expect(warnCalls.length).toBe(0);
  });

  it('closeTaskNotify 同时销毁卡片并清除抑制标记，任务重新发起时能再次弹出', () => {
    showTaskNotify('wd-task-shop2', '提现任务提醒', 'body');
    lastNotifyArgs().onClose!();
    expect(String(localStorage.getItem(SUPPRESS_KEY))).toContain('wd-task-shop2');

    closeTaskNotify('wd-task-shop2');
    expect(destroyKeys).toContain('wd-task-shop2');
    expect(isTaskNotifySuppressed('wd-task-shop2')).toBe(false);
    expect(String(localStorage.getItem(SUPPRESS_KEY))).not.toContain('wd-task-shop2');

    warnCalls.length = 0;
    expect(showTaskNotify('wd-task-shop2', '提现任务提醒', 'body')).toBe(true);
    expect(warnCalls.length).toBe(1);
  });

  it('pruneTaskNotifs 只撤下命中前缀且不在 keep 集合内的卡片，其他待办类型不受影响', () => {
    showTaskNotify('inv-task-shopA', '盘点任务提醒', 'body');
    showTaskNotify('inv-task-shopB', '盘点任务提醒', 'body');
    showTaskNotify('wd-task-shopA', '提现任务提醒', 'body');
    showTaskNotify('rech-pending-r1', '充值审批', 'body');
    destroyKeys.length = 0;

    // 盘点侧复检：shopA 已完成（不在 keep），shopB 仍在提醒；提现与充值卡片必须原样保留
    // （shown 集合是模块级的，跟真实页面生命周期一样跨用例保留，因此只断言“该撤的撤了、不该撤的没被碰”）
    pruneTaskNotifs(INVENTORY_TASK_NOTIF_PREFIXES, new Set(['inv-task-shopB']));
    expect(destroyKeys).toContain('inv-task-shopA');
    expect(destroyKeys).not.toContain('inv-task-shopB');
    expect(destroyKeys).not.toContain('wd-task-shopA');
    expect(destroyKeys).not.toContain('rech-pending-r1');

    // 提现侧复检：任务被发布端排空，keep 为空 → 撤下提现卡片，仍不动充值/盘点卡片
    destroyKeys.length = 0;
    pruneTaskNotifs(WITHDRAW_TASK_NOTIF_PREFIXES, new Set());
    expect(destroyKeys).toContain('wd-task-shopA');
    expect(destroyKeys).not.toContain('rech-pending-r1');
    expect(destroyKeys).not.toContain('inv-task-shopB');
  });

  it('发布端历史命名 withdraw-task-* 也在提现前缀覆盖范围内', () => {
    showTaskNotify('withdraw-task-shopC', '提现任务通知', 'body');
    showTaskNotify('withdraw-task-remind-shopC', '提现任务提醒', 'body');
    destroyKeys.length = 0;
    pruneTaskNotifs(WITHDRAW_TASK_NOTIF_PREFIXES, new Set());
    expect(destroyKeys).toContain('withdraw-task-shopC');
    expect(destroyKeys).toContain('withdraw-task-remind-shopC');
  });
});
