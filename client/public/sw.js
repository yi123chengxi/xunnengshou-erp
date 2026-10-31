/**
 * Service Worker — Web Push 系统级通知
 * 即使浏览器关闭也能收到推送，点击通知跳转到对应页面
 */

// 安装事件：立即激活，不等待旧版 SW
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// 激活事件：立即接管所有页面
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ============ 推送事件：收到推送时显示系统通知 ============
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '系统通知', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '系统通知';
  const options = {
    body: data.body || '',
    icon: data.icon || '/LOGO.jpg',
    badge: data.badge || '/LOGO.jpg',
    data: data.data || {},
    tag: data.data?.tag || 'default',
    renotify: true,       // 同一 tag 的通知也重新提醒
    requireInteraction: true,  // 通知不自动消失，需用户手动处理
    actions: data.data?.actions || [],
    vibrate: [200, 100, 200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ============ 通知点击事件：跳转或弹窗处理 ============
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action; // 用户点击了哪个 action 按钮

  // 通知数据中携带的 URL
  let targetUrl = data.url || '/';

  // 根据 action 决定行为
  if (action === 'handle') {
    // "立即处理" — 通知数据中已携带目标 URL
    targetUrl = data.url || '/';
  } else if (action === 'dismiss') {
    // "稍后处理" — 关闭通知，不做跳转
    return;
  }

  // 打开/聚焦目标页面
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果已有打开的窗口，尝试聚焦并跳转
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          // 通过 postMessage 通知页面处理跳转
          client.postMessage({
            type: 'PUSH_NOTIFICATION_CLICK',
            data: data,
            action: action,
          });
          return;
        }
      }
      // 没有已有窗口 → 新开一个
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ============ 通知关闭事件（可选：记录日志） ============
self.addEventListener('notificationclose', (event) => {
  // 可在此处发送统计请求
  console.log('[SW] 通知被关闭:', event.notification.tag);
});
