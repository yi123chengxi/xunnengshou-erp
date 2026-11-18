/**
 * 充值审批通知系统级恢复（共享模块）
 * 背景：
 * 1. 财务负责人可能登录供应商平台（MainLayout）或采购商平台（PurchaserLayout），
 *    恢复逻辑必须与布局无关，两个布局成对挂载，防止单侧断链；
 * 2. 生产环境为 HTTP 非安全上下文，浏览器 Notification.permission 恒为 denied，
 *    showNativeNotification 返回 null —— 必须降级 antd notification（右下角页内弹窗），
 *    否则通知静默丢失（参照提现任务恢复的降级模式）。
 * pending 通知带 tag/key 去重 + 30s 周期重弹（用户关闭后自动恢复）；
 * rejected/paid 用 localStorage 已显示标记防重（跨布局同键共享，不会双弹）。
 */
import { notification } from 'antd';
import { showNativeNotification, isNotificationBlocked } from './pushNotification';
import { showTaskNotify } from './taskNotify';
import { getCurrentUserAliases } from './shopScope';

/** 原生通知优先，HTTP/权限受限环境下降级 antd 页内通知（同 key 去重，防止双布局/周期重弹叠加） */
export function showRechargeNotification(
  kind: 'warning' | 'info',
  key: string,
  title: string,
  body: string,
  duration: number,
  onClick?: () => void,
): void {
  const native = showNativeNotification(title, body, onClick, key);
  if (native) return;
  // 常驻待办（duration 0）走任务提醒助手：带 X 关闭、关闭后 30 秒重弹、多条自动折叠
  if (duration === 0) { showTaskNotify(key, title, body, onClick); return; }
  const open = kind === 'warning' ? notification.warning : notification.info;
  open({ key, message: title, description: body, closeIcon: false, duration, onClick });
}

/**
 * 检查一次充值记录并恢复系统级通知（由布局层周期调用）
 * @param owner 数据归属账号（子账号归主账号，用于定位 recharge_record_<owner> 键）
 * @param currentUser 当前登录用户名（用于匹配 financePerson/applicant）
 * @param navigateTo 可选跳转回调（提现记录页）；缺省时仅派发全局事件
 */
export function recoverRechargeNotifications(
  owner: string,
  currentUser: string,
  navigateTo?: (path: string) => void,
): void {
  if (!owner || !currentUser) return;
  try {
    const records: any[] = JSON.parse(localStorage.getItem(`recharge_record_${owner}`) || '[]');
    if (records.length === 0) return;
    // 人员字段 historically 存在“存 username”与“存显示名”两种口径（同 shop.person 的坑），
    // 直接与 username 比较会让部分租户永远匹配不上、审批弹窗静默丢失，改用同一别名集合判定。
    const myAliases = new Set(getCurrentUserAliases(owner));
    const isMe = (val?: string) => !!val && myAliases.has(String(val));
    // 已显示过的通知记录（避免重复；跨布局同键共享）
    const paidShownKey = `rech_paid_shown_${owner}`;
    const rejectedShownKey = `rech_rejected_shown_${owner}`;
    const paidShown: string[] = JSON.parse(localStorage.getItem(paidShownKey) || '[]');
    const rejectedShown: string[] = JSON.parse(localStorage.getItem(rejectedShownKey) || '[]');
    const newPaidShown = [...paidShown];
    const newRejectedShown = [...rejectedShown];

    const goWithdrawal = () => {
      const path = '/finance/shop-management/withdrawal';
      const ecomPath = '/ecommerce/shop-management/withdrawal';
      const here = window.location.pathname;
      if (navigateTo && here !== path && here !== ecomPath) {
        navigateTo(path);
      } else {
        // 已在提现记录页（或无跳转回调）：由页面监听 navigate-to-recharge 切换页签
        window.dispatchEvent(new CustomEvent('navigate-to-recharge'));
      }
    };

    // 点击待审批通知：先派发全局事件（采购商布局全局弹窗/提现页监听会标记已消费）；
    // 下一帧检查无人承接（如供应商平台 dashboard 无监听者）再 sessionStorage 留言 + 跳转，
    // 由提现页挂载时消费打开确认支付（历史缺陷：事件无监听者导致点击无响应）
    const openPending = (recordKey: string) => {
      const markConsumed = () => { sessionStorage.setItem('recharge_pay_consumed', '1'); };
      sessionStorage.removeItem('recharge_pay_consumed');
      window.dispatchEvent(new CustomEvent('show-recharge-pay', { detail: { recordKey, markConsumed } }));
      setTimeout(() => {
        if (sessionStorage.getItem('recharge_pay_consumed') === '1') return;
        sessionStorage.setItem('open_recharge_pay_key', recordKey);
        goWithdrawal();
      }, 0);
    };

    records.forEach((r: any) => {
      const amountStr = `¥${(r.amount || 0).toFixed(2)}`;

      // 财务负责人视角：待审核记录 → 持续通知（关闭后定期重新弹出），点击打开确认支付
      if (r.status === 'pending' && isMe(r.financePerson)) {
        if (!isNotificationBlocked(currentUser)) {
          showRechargeNotification(
            'warning',
            `rech-pending-${r.key}`,
            '【充值审批】' + (r.shopName || ''),
            `${r.shopName} 申请充值 ${amountStr}，请点击处理`,
            0,
            () => openPending(r.key),
          );
        }
      }

      // 申请人视角：被驳回记录 → 仅首次弹出一次（不随间隔重复）
      if (r.status === 'rejected' && isMe(r.applicant) && !rejectedShown.includes(r.key)) {
        if (!isNotificationBlocked(currentUser)) {
          showRechargeNotification(
            'warning',
            `rech-rejected-${r.key}`,
            '【充值被驳回】' + (r.shopName || ''),
            `${r.shopName} 充值申请已被驳回，原因：${r.rejectReason || '未说明'}`,
            0,
            () => {
              sessionStorage.setItem('navigate_recharge_tab', '1');
              goWithdrawal();
            },
          );
        }
        newRejectedShown.push(r.key);
      }

      // 申请人视角：已支付记录 → 页内弹窗，5 秒后自动关闭（仅首次显示）
      // 旧写法优先走原生桌面通知 showTimedNotification：部分系统/权限下原生通知不可见或一闪而过，
      // 而无论是否真正弹出都会写入 paidShown 去重标记，导致「申请人端根本没弹且不再重试」。
      // 改用页内 antd 通知（与已验证可靠的待审批卡片同一可见通道），duration 5 秒自动关闭；
      // 且仅在真正弹出（未被屏蔽）时才登记已显示标记，屏蔽状态下保留下次重试机会。
      if (r.status === 'paid' && isMe(r.applicant) && !paidShown.includes(r.key)) {
        if (!isNotificationBlocked(currentUser)) {
          notification.info({
            key: `rech-paid-${r.key}`,
            message: '【充值已支付】' + (r.shopName || ''),
            description: `${r.shopName} 充值 ${amountStr} 已由财务确认支付`,
            duration: 5,
            onClick: goWithdrawal,
          });
          newPaidShown.push(r.key);
        }
      }
    });

    // 保存已显示记录（避免重复弹出）
    if (newPaidShown.length > paidShown.length) {
      localStorage.setItem(paidShownKey, JSON.stringify(newPaidShown));
    }
    if (newRejectedShown.length > rejectedShown.length) {
      localStorage.setItem(rejectedShownKey, JSON.stringify(newRejectedShown));
    }
  } catch { /* ignore */ }
}
