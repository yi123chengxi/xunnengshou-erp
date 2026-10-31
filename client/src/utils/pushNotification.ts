/**
 * Web Push 推送通知工具
 * 实现系统级通知：即使浏览器/标签页关闭，只要电脑联网就能收到桌面通知
 */

const API_BASE = (typeof window !== 'undefined' && (window as any).__API_BASE__) || 'http://localhost:3000';

// VAPID 公钥缓存
let cachedPublicKey: string | null = null;

/**
 * 获取 VAPID 公钥（从后端）
 */
async function getVapidPublicKey(): Promise<string | null> {
  if (cachedPublicKey) return cachedPublicKey;
  try {
    const res = await fetch(`${API_BASE}/api/push/vapid-public-key`);
    const json = await res.json();
    if (json.code === 0 && json.data?.publicKey) {
      cachedPublicKey = json.data.publicKey;
      return cachedPublicKey;
    }
  } catch {
    console.warn('[Push] 获取 VAPID 公钥失败');
  }
  return null;
}

/**
 * 将 base64 字符串转为 Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(Array.from(rawData).map((char) => char.charCodeAt(0)));
}

/**
 * 注册 Service Worker 并请求推送权限
 * 应在登录成功后或页面加载时调用
 */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] 浏览器不支持 Service Worker 或 Push API');
    return null;
  }

  // 仅 HTTPS 或 localhost 可用
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) {
    console.warn('[Push] 推送功能仅支持 HTTPS 或 localhost');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[Push] Service Worker 已注册');
    return registration;
  } catch (err) {
    console.error('[Push] Service Worker 注册失败:', err);
    return null;
  }
}

/**
 * 请求通知权限并创建推送订阅
 * @param username 当前登录用户名
 */
export async function subscribePush(username: string): Promise<boolean> {
  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    console.error('[Push] 无法获取 VAPID 公钥');
    return false;
  }

  // 请求通知权限
  if (Notification.permission === 'denied') {
    console.warn('[Push] 用户已拒绝通知权限');
    return false;
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] 用户未授予通知权限');
      return false;
    }
  }

  // 获取 Service Worker
  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    registration = await registerPushServiceWorker();
  }

  if (!registration) {
    console.error('[Push] Service Worker 不可用');
    return false;
  }

  // 检查是否已有订阅
  const existingSub = await registration.pushManager.getSubscription();
  if (existingSub) {
    // 已有订阅，直接上报
    await sendSubscriptionToServer(username, existingSub);
    return true;
  }

  // 创建新订阅
  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    await sendSubscriptionToServer(username, subscription);
    console.log('[Push] 推送订阅已创建并保存');
    return true;
  } catch (err) {
    console.error('[Push] 创建推送订阅失败:', err);
    return false;
  }
}

/**
 * 将订阅信息发送到后端保存
 */
async function sendSubscriptionToServer(username: string, subscription: PushSubscription): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        subscription: subscription.toJSON(),
      }),
    });
    const json = await res.json();
    if (json.code === 0) {
      console.log('[Push] 订阅信息已保存到服务器');
    } else {
      console.warn('[Push] 保存订阅信息失败:', json.message);
    }
  } catch (err) {
    console.error('[Push] 发送订阅信息到服务器失败:', err);
  }
}

/**
 * 向后端发送推送通知（通过 API 调用）
 * @param targetUsername 目标用户名（如财务负责人）
 * @param title 通知标题
 * @param body 通知正文
 * @param data 附加数据（可选）
 */
export async function sendPushNotification(
  targetUsername: string,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: targetUsername,
        title,
        body,
        data: {
          ...data,
          tag: `rech-${data?.recordKey || Date.now()}`,
          actions: [
            { action: 'handle', title: '立即处理' },
            { action: 'dismiss', title: '稍后处理' },
          ],
        },
      }),
    });
    const json = await res.json();
    if (json.code === 0) {
      console.log(`[Push] 推送已发送: ${title} → ${targetUsername} (sent: ${json.sent}/${json.total})`);
    } else {
      console.warn('[Push] 推送发送失败:', json.message);
    }
  } catch (err) {
    console.error('[Push] 发送推送通知失败:', err);
  }
}

/**
 * 初始化推送：注册 SW + 请求权限 + 订阅
 * 在登录成功或页面加载后调用
 */
export async function initPushNotifications(): Promise<void> {
  const username = localStorage.getItem('username');
  if (!username) {
    console.warn('[Push] 未登录，跳过推送初始化');
    return;
  }

  // 注册 SW
  await registerPushServiceWorker();

  // 订阅推送
  const success = await subscribePush(username);
  if (success) {
    console.log('[Push] 推送通知已就绪');
  }

  // 监听来自 Service Worker 的点击消息
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PUSH_NOTIFICATION_CLICK') {
      handlePushNotificationClick(event.data);
    }
  });
}

/**
 * 处理 SW 推送通知点击事件
 */
function handlePushNotificationClick(msgData: any) {
  const { data, action } = msgData;
  if (!data) return;
  if (action === 'dismiss') return;

  // 收/付申请待处理通知 → 跳转收/付申请页并打开对应处理弹窗
  if (data.payreqKey) {
    const url = `/finance/payment-request?payreq=${encodeURIComponent(data.payreqKey)}&tab=${data.payreqTab || 'receipt'}`;
    if (window.location.pathname !== '/finance/payment-request') {
      window.location.href = url;
    } else {
      window.dispatchEvent(new CustomEvent('payreq-open-process', { detail: { key: data.payreqKey, tab: data.payreqTab } }));
    }
    return;
  }

  // 充值审批通知 → 触发全局弹窗
  if (data.recordKey) {
    window.dispatchEvent(new CustomEvent('show-recharge-pay', {
      detail: { recordKey: data.recordKey },
    }));
  }
}

/**
 * 获取当前通知权限状态
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * 显示系统级原生桌面通知（出现在 Windows 任务栏 / macOS 通知中心）
 * 与页内 Ant Design 通知不同，系统通知独立于浏览器窗口显示
 * @param title 通知标题
 * @param body 通知正文
 * @param onClick 点击通知时的回调
 * @param tag 通知标签（同一 tag 不会重复弹出）
 */
export function showNativeNotification(
  title: string,
  body: string,
  onClick?: () => void,
  tag?: string
): Notification | null {
  // 检查浏览器是否支持
  if (!('Notification' in window)) {
    console.warn('[Push] 浏览器不支持系统通知');
    return null;
  }

  // 权限已被拒绝 → 静默跳过
  if (Notification.permission === 'denied') return null;

  // 权限未授予 → 请求权限
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        showNativeNotification(title, body, onClick, tag);
      }
    });
    return null;
  }

  // 创建系统通知
  const notif = new Notification(title, {
    body,
    icon: '/LOGO.jpg',
    badge: '/LOGO.jpg',
    tag: tag || `default-${Date.now()}`,
    requireInteraction: true, // 不自动消失，需用户手动处理
    silent: false,
  } as NotificationOptions);

  // 点击通知时触发回调
  if (onClick) {
    notif.onclick = () => {
      window.focus(); // 聚焦浏览器窗口
      onClick();
      notif.close();
    };
  }

  return notif;
}

/**
 * 显示定时自动关闭的系统通知（用于“已支付”等短暂提示）
 * @param title 通知标题
 * @param body 通知正文
 * @param timeoutMs 自动关闭时间（毫秒），默认 5000
 * @param tag 通知标签
 */
export function showTimedNotification(
  title: string,
  body: string,
  timeoutMs: number = 5000,
  tag?: string
): Notification | null {
  if (!('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;

  const notif = new Notification(title, {
    body,
    icon: '/LOGO.jpg',
    badge: '/LOGO.jpg',
    tag: tag || `timed-${Date.now()}`,
    silent: false,
  } as NotificationOptions);

  // 点击即关闭
  notif.onclick = () => { window.focus(); notif.close(); };
  // 定时自动关闭
  setTimeout(() => notif.close(), timeoutMs);
  return notif;
}

/**
 * 检查指定用户是否已屏蔽弹窗通知
 * @param username 要检查的用户名
 */
export function isNotificationBlocked(username: string): boolean {
  try {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    const owner = isSub ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '') : (localStorage.getItem('username') || '');
    const accounts: any[] = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
    const acc = accounts.find((a: any) => a.username === username);
    return acc?.notificationBlocked === true;
  } catch { return false; }
}

/**
 * 通知类型开关设置
 * 存储在 localStorage: `notification_settings_${owner}`
 */
export type NotificationType =
  | 'recharge-apply'      // 充值申请通知
  | 'recharge-result'     // 充值审批结果
  | 'withdraw-task'       // 提现任务通知
  | 'withdraw-receipt'    // 提现到账通知
  | 'sales-task'          // 销售额统计任务通知
  | 'pay-request'         // 收/付申请待处理（收款确认/付款审核/待支付）
  | 'order'               // 订单相关通知
  | 'system-alert';       // 系统预警

const NOTIF_SETTINGS_KEY = 'notification_settings_';

/** 获取通知设置 */
export function getNotificationSettings(owner?: string): Record<NotificationType, boolean> {
  const o = owner || localStorage.getItem('username') || '';
  const defaults: Record<NotificationType, boolean> = {
    'recharge-apply': true,
    'recharge-result': true,
    'withdraw-task': true,
    'withdraw-receipt': true,
    'sales-task': true,
    'pay-request': true,
    'order': true,
    'system-alert': true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(NOTIF_SETTINGS_KEY + o) || '{}');
    return { ...defaults, ...saved };
  } catch { return defaults; }
}

/** 检查某个通知类型是否已开启 */
export function isNotificationTypeEnabled(type: NotificationType, owner?: string): boolean {
  const settings = getNotificationSettings(owner);
  return settings[type] !== false; // 默认为 true
}

/** 保存通知设置 */
export function saveNotificationSettings(settings: Record<string, boolean>, owner?: string): void {
  const o = owner || localStorage.getItem('username') || '';
  localStorage.setItem(NOTIF_SETTINGS_KEY + o, JSON.stringify(settings));
}
