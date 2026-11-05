/**
 * Web Push 推送通知路由
 * 使用 VAPID 协议实现系统级通知（浏览器关闭后仍可收到）
 */
import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import dotenv from 'dotenv';
import { store } from '../database/store';

dotenv.config();

const router = Router();

// ============ VAPID 初始化 ============
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@factory-management.local';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('✅ Web Push VAPID 已初始化');
} else {
  console.warn('⚠️  VAPID 密钥未配置，推送功能不可用');
}

// ============ GET /api/push/vapid-public-key ============
// 返回 VAPID 公钥（前端需要用来生成订阅）
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ code: 500, message: 'VAPID 公钥未配置' });
  }
  res.json({ code: 0, data: { publicKey: VAPID_PUBLIC_KEY } });
});

// ============ POST /api/push/subscribe ============
// 保存用户的推送订阅信息
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { username, subscription } = req.body;
    if (!username || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    const userAgent = req.headers['user-agent'] || '';
    await store.upsertPushSub(
      username,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent
    );
    console.log(`📬 推送订阅已保存: ${username}`);
    res.json({ code: 0, message: '订阅成功' });
  } catch (err: any) {
    console.error('保存推送订阅失败:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ============ POST /api/push/unsubscribe ============
// 删除推送订阅
router.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint, username } = req.body;
    if (endpoint) {
      await store.deletePushSub(endpoint);
    } else if (username) {
      await store.deletePushSubsByUsername(username);
    }
    res.json({ code: 0, message: '已取消订阅' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ============ POST /api/push/send ============
// 向指定用户发送推送通知
router.post('/send', async (req: Request, res: Response) => {
  try {
    if (!VAPID_PUBLIC_KEY) {
      return res.status(500).json({ code: 500, message: 'VAPID 未配置' });
    }
    const { username, title, body, data } = req.body;
    if (!username) {
      return res.status(400).json({ code: 400, message: '缺少 username' });
    }

    const subs: any[] = await store.getSubsByUsername(username);
    if (subs.length === 0) {
      return res.json({ code: 0, message: '该用户无推送订阅', sent: 0 });
    }

    const payload = JSON.stringify({
      title: title || '系统通知',
      body: body || '',
      data: data || {},
      icon: '/LOGO.jpg',
      badge: '/LOGO.jpg',
    });

    let sent = 0;
    const failedEndpoints: string[] = [];

    for (const sub of subs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };
      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (err: any) {
        console.error(`推送失败 [${sub.endpoint}]:`, err.message);
        // 410 Gone 或 404 → 订阅已失效，自动清理
        if (err.statusCode === 410 || err.statusCode === 404) {
          await store.deletePushSub(sub.endpoint);
          console.log(`🗑️  已清理失效订阅: ${sub.endpoint}`);
        }
        failedEndpoints.push(sub.endpoint);
      }
    }

    res.json({ code: 0, message: `推送完成`, sent, total: subs.length, failed: failedEndpoints.length });
  } catch (err: any) {
    console.error('发送推送失败:', err.message);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ============ 内部调用函数：向指定用户推送通知 ============
export async function sendPushToUser(
  username: string,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<{ sent: number; total: number }> {
  if (!VAPID_PUBLIC_KEY) return { sent: 0, total: 0 };

  const subs: any[] = await store.getSubsByUsername(username);
  const payload = JSON.stringify({
    title,
    body,
    data: data || {},
    icon: '/LOGO.jpg',
    badge: '/LOGO.jpg',
  });

  let sent = 0;
  for (const sub of subs) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, payload);
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await store.deletePushSub(sub.endpoint);
      }
    }
  }
  return { sent, total: subs.length };
}

export default router;
