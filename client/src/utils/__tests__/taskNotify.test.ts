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
import dayjs from 'dayjs';
import {
  showTaskNotify, closeTaskNotify, pruneTaskNotifs, isTaskNotifySuppressed,
  hasWithdrawRecordAroundLaunch, readWithdrawTaskLaunchAt, withdrawTaskStatusKey,
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

/**
 * 提现任务「已办理」比较口径（对应缺陷：任务提醒拿记录时间与「当前时间-3天」比，
 * 任务发布满 3 天后哪怕记录就写在发布当天也会被判定未提现，负责人端反复弹窗）。
 * 需求口径：以「发布任务时间」为锚点只设下限——记录时间 ≥ 发布前 3 天 即视为已办理，
 * 不设上限（只要提现了就不再催，哪怕发布后过了很久才提）。
 */
describe('提现任务已办理判定以发布任务时间为锚点', () => {
  it('记录与发布同日→已办理（即使该记录距今天已超过 3 天）', () => {
    const records = [{ shopName: '测试2', createdAt: '2026-11-17 16:13:01' }];
    expect(hasWithdrawRecordAroundLaunch(records, '测试2', '2026-11-17 09:00')).toBe(true);
  });

  it('发布前 3 天内的记录（只填了提现日期）同样算已办理', () => {
    const records = [{ shopName: '测试2', withdrawalDate: '2026-11-15' }];
    expect(hasWithdrawRecordAroundLaunch(records, '测试2', '2026-11-17 09:00')).toBe(true);
  });

  it('发布之后任意时间的提现都算已办理（上限已放开，提现了就不再催）', () => {
    const records = [{ shopName: '测试2', createdAt: '2026-12-20 10:00:00' }];
    expect(hasWithdrawRecordAroundLaunch(records, '测试2', '2026-11-17 09:00')).toBe(true);
  });

  it('落在发布前 3 天以外的旧记录不算本任务的提现，仍需提醒', () => {
    const records = [{ shopName: '测试2', createdAt: '2026-11-10 10:00:00' }];
    expect(hasWithdrawRecordAroundLaunch(records, '测试2', '2026-11-17 09:00')).toBe(false);
  });

  it('其他店铺的记录不参与比较', () => {
    const records = [{ shopName: '测试5', createdAt: '2026-11-17 16:13:01' }];
    expect(hasWithdrawRecordAroundLaunch(records, '测试2', '2026-11-17 09:00')).toBe(false);
  });

  it('取不到发布时刻（无在途任务/历史脏数据）→退回旧的「最近 3 天」口径', () => {
    const fresh = [{ shopName: '测试2', createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss') }];
    expect(hasWithdrawRecordAroundLaunch(fresh, '测试2', '')).toBe(true);
    expect(hasWithdrawRecordAroundLaunch(fresh, '测试2', 'not-a-date')).toBe(true);
    expect(hasWithdrawRecordAroundLaunch(fresh, '测试2', undefined)).toBe(true);
    const stale = [{ shopName: '测试2', createdAt: '2026-01-01 10:00:00' }];
    expect(hasWithdrawRecordAroundLaunch(stale, '测试2', '')).toBe(false);
  });

  it('readWithdrawTaskLaunchAt 从 withdrawal_task_status_<owner> 取发布时刻，异常不抛错', () => {
    localStorage.setItem(withdrawTaskStatusKey('owner1'), JSON.stringify({ shopA: '2026-11-17 09:00' }));
    expect(readWithdrawTaskLaunchAt('owner1', 'shopA')).toBe('2026-11-17 09:00');
    expect(readWithdrawTaskLaunchAt('owner1', 'shopB')).toBe('');
    expect(readWithdrawTaskLaunchAt('ownerX', 'shopA')).toBe('');
    localStorage.setItem(withdrawTaskStatusKey('owner2'), '{坏数据');
    expect(readWithdrawTaskLaunchAt('owner2', 'shopA')).toBe('');
  });
});
