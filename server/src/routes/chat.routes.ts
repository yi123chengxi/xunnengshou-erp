/**
 * 即时通讯 REST API
 * 供 WebSocket 不可用时降级使用，以及初始加载会话列表/历史消息
 * 认证方式：从 localStorage 存储的 username 识别当前用户（与项目其他接口一致）
 */
import { Router, Request, Response } from 'express';
import {
  getConversations,
  getHistory,
  getUnreadCount,
  saveMessage,
  markConvRead,
  makeConvId,
  addFriend,
  removeFriend,
  getFriends,
  isFriend,
  getDispatchPool,
  setDispatchPool,
  getAllDispatchPools,
} from '../ws/chat-store';
import { isUserOnline, pushSavedToRecipient } from '../ws/chat-ws';
import { checkChatContent, blockReason } from '../utils/chatFilter';

const router = Router();

/** 从请求中获取当前用户名（query 或 header） */
function getUsername(req: Request): string {
  return (req.query.username as string) || req.headers['x-username'] as string || '';
}

/** GET /api/chat/conversations — 获取当前用户的所有会话列表 */
router.get('/conversations', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const convs = getConversations(username);
    // 附加在线状态
    const result = convs.map(c => ({
      ...c,
      otherOnline: isUserOnline(c.otherUser),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/messages/:convId — 获取指定会话的历史消息 */
router.get('/messages/:convId', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const { convId } = req.params;
    const before = req.query.before ? Number(req.query.before) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const messages = getHistory(convId, before, limit);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/unread-count — 获取当前用户总未读数 */
router.get('/unread-count', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const count = getUnreadCount(username);
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/chat/messages — 发送消息（HTTP 备用通道：落库 + 在线接收方实时推送；cid 幂等去重） */
router.post('/messages', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const { to, content, msg_type, subject, cid } = req.body;
    if (!to || !content) { res.status(400).json({ error: '缺少 to 或 content' }); return; }
    // 内容安全审核：违法/不文明消息拒绝落库（403 + reason，客户端标记发送失败不重试）
    if ((msg_type || 'text') === 'text') {
      const chk = checkChatContent(content);
      if (chk.blocked) { res.status(403).json({ error: 'blocked', reason: blockReason(chk), cid: cid || '' }); return; }
    }
    const msg = saveMessage({
      id: typeof cid === 'string' && cid ? cid : undefined,
      from_user: username,
      to_user: to,
      content,
      msg_type: msg_type || 'text',
      conv_subject: subject || '',
    });
    // 接收方在线时实时推送（与 WS 通道体验一致）
    pushSavedToRecipient(msg);
    res.json({ success: true, message: msg });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/chat/messages/:convId/read — 标记会话已读 */
router.put('/messages/:convId/read', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const { convId } = req.params;
    markConvRead(convId, username);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/online/:username — 查询指定用户在线状态 */
router.get('/online/:username', (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    res.json({ online: isUserOnline(username) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/friends — 获取好友列表 */
router.get('/friends', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const friends = getFriends(username);
    const result = friends.map(f => ({
      ...f,
      online: isUserOnline(f.friendUsername),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/chat/friends — 添加好友 */
router.post('/friends', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const { friendUsername } = req.body;
    if (!friendUsername) { res.status(400).json({ error: '缺少 friendUsername' }); return; }
    if (friendUsername === username) { res.status(400).json({ error: '不能添加自己为好友' }); return; }
    addFriend(username, friendUsername);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/chat/friends/:friendUsername — 删除好友 */
router.delete('/friends/:friendUsername', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const { friendUsername } = req.params;
    removeFriend(username, friendUsername);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/is-friend/:username — 查询是否为好友 */
router.get('/is-friend/:username', (req: Request, res: Response) => {
  try {
    const currentUser = getUsername(req);
    if (!currentUser) { res.status(401).json({ error: '未认证' }); return; }
    const { username } = req.params;
    res.json({ isFriend: isFriend(currentUser, username) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/dispatch-pool — 获取分流池配置 */
router.get('/dispatch-pool', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const members = getDispatchPool(username);
    res.json({ owner: username, members });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/chat/dispatch-pool — 设置分流池成员 */
router.post('/dispatch-pool', (req: Request, res: Response) => {
  try {
    const username = getUsername(req);
    if (!username) { res.status(401).json({ error: '未认证' }); return; }
    const { members } = req.body;
    if (!Array.isArray(members)) { res.status(400).json({ error: 'members 必须为数组' }); return; }
    setDispatchPool(username, members);
    res.json({ success: true, owner: username, members });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/chat/dispatch-pools — 获取所有分流池（管理用途） */
router.get('/dispatch-pools', (req: Request, res: Response) => {
  try {
    const pools = getAllDispatchPools();
    res.json(pools);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
