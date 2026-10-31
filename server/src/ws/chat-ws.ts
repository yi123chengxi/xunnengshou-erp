/**
 * 即时通讯 WebSocket 服务
 *
 * 协议消息（JSON）：
 *   客户端 → 服务端：
 *     { type: 'auth',         username: string }
 *     { type: 'send_message', to: string, content: string, msg_type?: string, subject?: string }
 *     { type: 'mark_read',    convId: string }
 *     { type: 'typing',       to: string }
 *
 *   服务端 → 客户端：
 *     { type: 'auth_ok',       username: string }
 *     { type: 'new_message',   id, from, to, content, msg_type, convId, ts, subject }
 *     { type: 'message_sent',  id, convId, ts }
 *     { type: 'typing',        from: string }
 *     { type: 'presence',      username: string, online: boolean }
 *     { type: 'ping' }
 */
import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { saveMessage, markConvRead, makeConvId, getHistory, getDispatchPool, findPoolOwnerForUser, savePendingMessage, getPendingMessages, deletePendingMessage } from './chat-store';
import { checkChatContent, blockReason } from '../utils/chatFilter';

// ============ 连接管理 ============

interface ChatClientMeta {
  ws: WebSocket;
  username: string;
  parentUsername: string; // 子账号的父账号用户名（用于 conv_id 归一化）
  authenticated: boolean;
}

/** 按用户分组的连接（支持同一用户多标签页） */
const onlineUsers = new Map<string, Set<ChatClientMeta>>();

/** 父账号 → 子账号集合（用于消息转发） */
const parentToSubs = new Map<string, Set<string>>();

/** 按 WebSocket 实例索引的客户端元信息 */
const wsClientMap = new WeakMap<WebSocket, ChatClientMeta>();

// ============ 公开 API ============

/** 获取指定用户的在线状态 */
export function isUserOnline(username: string): boolean {
  const clients = onlineUsers.get(username);
  return !!clients && clients.size > 0;
}

/** 将已落库消息实时推送给接收方（供 HTTP 兜底通道复用，保证在线接收方即时收到） */
export function pushSavedToRecipient(saved: {
  id: string; conv_id: string; from_user: string; to_user: string;
  content: string; msg_type: string; conv_subject: string; created_at: number;
}): void {
  sendToUser(saved.to_user, {
    type: 'new_message',
    id: saved.id,
    from: saved.from_user,
    to: saved.to_user,
    content: saved.content,
    msg_type: saved.msg_type,
    convId: saved.conv_id,
    ts: saved.created_at,
    subject: saved.conv_subject,
  });
}

/** 向指定用户的所有连接发送消息（如果目标是父账号，同时转发给所有子账号） */
function sendToUser(username: string, data: any): void {
  const clients = onlineUsers.get(username);
  if (clients) {
    const msg = JSON.stringify(data);
    clients.forEach(c => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }
  // 如果目标是父账号，同时转发给所有在线子账号
  const subs = parentToSubs.get(username);
  if (subs) {
    const msg = JSON.stringify(data);
    subs.forEach(subUsername => {
      const subClients = onlineUsers.get(subUsername);
      if (subClients) {
        subClients.forEach(c => {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(msg);
          }
        });
      }
    });
  }
}

// ============ WebSocket 服务初始化 ============

export function initChatWebSocket(server: HTTPServer) {
  const wss = new WebSocketServer({ noServer: true });

  // 手动处理 WebSocket 升级请求（与 print-ws 共存）
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    if (pathname === '/ws/chat') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // 心跳检测：每 30 秒 ping 一次
  setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    });
  }, 30_000);

  wss.on('connection', (ws: WebSocket, req: any) => {
    console.log('[chat-ws] 新连接:', req.socket.remoteAddress);

    const meta: ChatClientMeta = {
      ws,
      username: '',
      parentUsername: '',
      authenticated: false,
    };
    wsClientMap.set(ws, meta);

    // 10 秒内必须完成认证
    const authTimeout = setTimeout(() => {
      if (!meta.authenticated) {
        ws.close(4001, '认证超时');
      }
    }, 10_000);

    ws.on('message', (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // ---- 认证 ----
      if (msg.type === 'auth') {
        const username = msg.username;
        if (!username || typeof username !== 'string') {
          ws.send(JSON.stringify({ type: 'auth_fail', message: '缺少用户名' }));
          ws.close(4002, '认证失败');
          return;
        }
        meta.username = username;
        meta.parentUsername = msg.parent_username || ''; // 子账号传入父账号用户名
        meta.authenticated = true;
        clearTimeout(authTimeout);

        // 注册到在线用户映射
        if (!onlineUsers.has(meta.username)) {
          onlineUsers.set(meta.username, new Set());
        }
        onlineUsers.get(meta.username)!.add(meta);

        // 子账号注册到父账号的子账号列表（用于消息转发）
        if (meta.parentUsername) {
          if (!parentToSubs.has(meta.parentUsername)) {
            parentToSubs.set(meta.parentUsername, new Set());
          }
          parentToSubs.get(meta.parentUsername)!.add(meta.username);
        }

        // 通知认证成功
        ws.send(JSON.stringify({ type: 'auth_ok', username: meta.username }));

        // 广播上线状态给所有在线用户（简化：仅通知有会话的用户）
        broadcastPresence(meta.username, true);
        console.log(`[chat-ws] 用户已认证: ${meta.username}${meta.parentUsername ? ' (parent: ' + meta.parentUsername + ')' : ''}`);

        // 检查是否有待分配消息分配给该用户
        deliverPendingMessages(meta.username);
        return;
      }

      // 后续消息必须已认证
      if (!meta.authenticated) return;

      // ---- 发送消息 ----
      if (msg.type === 'send_message') {
        const { to, content, msg_type, subject } = msg;
        if (!to || !content) return;

        // 内容安全审核：违法/不文明消息不落库不转发，通知发送方发送失败（客户端气泡显示感叹号）
        if ((msg_type || 'text') === 'text') {
          const chk = checkChatContent(content);
          if (chk.blocked) {
            ws.send(JSON.stringify({ type: 'message_blocked', cid: msg.cid || '', reason: blockReason(chk) }));
            return;
          }
        }

        // 分流池路由：仅对市场「联系」按键发起的消息（dispatch=true）生效；
        // 账号一对一直接发送的消息不替代收件人，谁发的对方看到的就是谁
        let actualTo = to;
        let routedPoolOwner: string | null = null;
        if (msg.dispatch === true) {
          const poolOwner = findPoolOwnerForUser(to);
          if (poolOwner) {
            routedPoolOwner = poolOwner;
            const pool = getDispatchPool(poolOwner);
            if (pool.length > 0) {
              // 筛选在线成员
              const onlineMembers = pool.filter(m => isUserOnline(m));
              if (onlineMembers.length > 0) {
                // 随机选择一个在线成员
                actualTo = onlineMembers[Math.floor(Math.random() * onlineMembers.length)];
              } else {
                // 无人在线，存为待分配
                savePendingMessage({
                  pool_owner: poolOwner,
                  from_user: meta.username,
                  content,
                  msg_type: msg_type || 'text',
                  conv_subject: subject || '',
                });
                // 通知发送方消息已暂存
                ws.send(JSON.stringify({
                  type: 'message_queued',
                  to: poolOwner,
                  ts: Date.now(),
                }));
                return;
              }
            }
          }
        }

        // 持久化：子账号使用父账号用户名计算 conv_id，确保与采购商端一致；客户端 cid 作幂等键（重试不重复）
        const convFromUser = meta.parentUsername || meta.username;
        const saved = saveMessage({
          id: typeof msg.cid === 'string' && msg.cid ? msg.cid : undefined,
          from_user: meta.username,
          to_user: actualTo,
          content,
          msg_type: msg_type || 'text',
          conv_subject: subject || '',
          conv_from_user: convFromUser,
        });

        // 通知发送方确认（回传 cid 供客户端清除 ack 超时重试）
        ws.send(JSON.stringify({
          type: 'message_sent',
          id: saved.id,
          cid: msg.cid || saved.id,
          convId: saved.conv_id,
          ts: saved.created_at,
        }));

        // 转发给接收方
        sendToUser(actualTo, {
          type: 'new_message',
          id: saved.id,
          from: meta.username,
          to: saved.to_user,
          content: saved.content,
          msg_type: saved.msg_type,
          convId: saved.conv_id,
          ts: saved.created_at,
          subject: saved.conv_subject,
        });

        // 如果消息被分流，同时通知池主（主账号可实时看到）
        if (actualTo !== to && routedPoolOwner) {
          sendToUser(routedPoolOwner, {
            type: 'new_message',
            id: saved.id,
            from: meta.username,
            to: saved.to_user,
            content: saved.content,
            msg_type: saved.msg_type,
            convId: saved.conv_id,
            ts: saved.created_at,
            subject: saved.conv_subject,
            dispatched: true,
            dispatchTarget: actualTo,
          });
        }
        return;
      }

      // ---- 代发消息（主账号代子账号回复） ----
      if (msg.type === 'send_as') {
        const { to, content, msg_type, subject, asUser } = msg;
        if (!to || !content || !asUser) return;
        // 内容安全审核（代发通道同标准）
        if ((msg_type || 'text') === 'text') {
          const chk = checkChatContent(content);
          if (chk.blocked) {
            ws.send(JSON.stringify({ type: 'message_blocked', cid: msg.cid || '', reason: blockReason(chk) }));
            return;
          }
        }
        // 验证发送者是否为池主（主账号权限）
        const pool = getDispatchPool(meta.username);
        if (!pool.includes(asUser) && meta.username !== asUser) return;

        // 代发消息：使用主账号用户名计算 conv_id
        const saved = saveMessage({
          from_user: asUser,
          to_user: to,
          content,
          msg_type: msg_type || 'text',
          conv_subject: subject || '',
          conv_from_user: meta.username,
        });

        ws.send(JSON.stringify({
          type: 'message_sent',
          id: saved.id,
          convId: saved.conv_id,
          ts: saved.created_at,
        }));

        sendToUser(to, {
          type: 'new_message',
          id: saved.id,
          from: asUser,
          to: saved.to_user,
          content: saved.content,
          msg_type: saved.msg_type,
          convId: saved.conv_id,
          ts: saved.created_at,
          subject: saved.conv_subject,
        });
        return;
      }

      // ---- 标记已读 ----
      if (msg.type === 'mark_read') {
        const { convId } = msg;
        if (!convId) return;
        markConvRead(convId, meta.username);
        return;
      }

      // ---- 输入中提示 ----
      if (msg.type === 'typing') {
        const { to } = msg;
        if (!to) return;
        sendToUser(to, {
          type: 'typing',
          from: meta.username,
        });
        return;
      }

      // ---- 获取历史消息（WS通道，减少HTTP请求） ----
      if (msg.type === 'get_history') {
        const { convId, before, limit } = msg;
        if (!convId) return;
        const messages = getHistory(convId, before, limit || 50);
        ws.send(JSON.stringify({
          type: 'history',
          convId,
          messages,
        }));
        return;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (meta.username && meta.authenticated) {
        const clients = onlineUsers.get(meta.username);
        if (clients) {
          clients.delete(meta);
          if (clients.size === 0) {
            onlineUsers.delete(meta.username);
            // 广播离线状态
            broadcastPresence(meta.username, false);
          }
        }
        console.log(`[chat-ws] 用户断开: ${meta.username}`);
      }
      wsClientMap.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[chat-ws] 连接错误:', err.message);
    });
  });

  console.log('💬 聊天 WebSocket 服务已就绪: ws://localhost:' + (process.env.PORT || 3000) + '/ws/chat');
}

// ============ 内部辅助 ============

/** 广播用户上线/离线状态（仅广播给有会话关系的在线用户） */
function broadcastPresence(username: string, online: boolean) {
  // 简化实现：广播给所有在线用户
  // 生产环境可优化为仅广播给有会话关系的用户
  const msg = JSON.stringify({ type: 'presence', username, online });
  onlineUsers.forEach((clients) => {
    clients.forEach(c => {
      if (c.ws.readyState === WebSocket.OPEN && c.username !== username) {
        c.ws.send(msg);
      }
    });
  });
}

/** 用户上线时，分配待处理消息 */
function deliverPendingMessages(username: string) {
  // 查找该用户属于哪些分流池
  const allPools = getAllPoolsForDispatch();
  for (const { owner, members } of allPools) {
    if (!members.includes(username)) continue;
    // 获取该池的待分配消息
    const pending = getPendingMessages(owner);
    for (const pend of pending) {
      // 保存为正式消息
      const saved = saveMessage({
        from_user: pend.from_user,
        to_user: username,
        content: pend.content,
        msg_type: pend.msg_type,
        conv_subject: pend.conv_subject,
      });
      // 发送给该用户
      sendToUser(username, {
        type: 'new_message',
        id: saved.id,
        from: pend.from_user,
        to: username,
        content: saved.content,
        msg_type: saved.msg_type,
        convId: saved.conv_id,
        ts: saved.created_at,
        subject: saved.conv_subject,
        dispatched: true,
      });
      // 同时通知池主
      if (owner !== username) {
        sendToUser(owner, {
          type: 'new_message',
          id: saved.id,
          from: pend.from_user,
          to: username,
          content: saved.content,
          msg_type: saved.msg_type,
          convId: saved.conv_id,
          ts: saved.created_at,
          subject: saved.conv_subject,
          dispatched: true,
          dispatchTarget: username,
        });
      }
      // 删除待分配记录
      deletePendingMessage(pend.id);
    }
  }
}

/** 获取所有分流池配置（内部辅助） */
function getAllPoolsForDispatch(): { owner: string; members: string[] }[] {
  // 直接调用 chat-store 的导出
  const { getAllDispatchPools } = require('./chat-store');
  return getAllDispatchPools();
}
