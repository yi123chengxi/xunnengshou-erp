import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input, Badge, Image, Spin, Empty, Tooltip } from 'antd';
import { SendOutlined, PictureOutlined, UserOutlined, UserAddOutlined, TeamOutlined, DeleteOutlined, CloseCircleFilled, PlusOutlined, MessageOutlined, CloseOutlined, SettingOutlined, CheckOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import { message as antdMessage } from 'antd';
import {
  fetchConversations,
  fetchHistory,
  sendMessage,
  sendImageMessage,
  markRead,
  sendTyping,
  onNewMessage,
  onTyping,
  onPresence,
  onMessageSent,
  httpMarkRead,
  registerOpenChat,
  fetchFriends,
  addFriend,
  removeFriend,
  checkIsFriend,
  triggerOpenChat,
  fetchDispatchPool,
  setDispatchPoolMembers,
  onMessageBlocked,
} from '../utils/chatSocket';
import type { ChatMessage, Conversation, FriendItem } from '../utils/chatSocket';
import { checkChatContent, blockReason } from '../utils/chatFilter';
import { compressImageFile } from '../utils/imageCompress';

const PRIMARY = '#1e4a7e';
const { TextArea } = Input;

// ============ 工具函数 ============

const getAvatarColor = (name: string): string => {
  const colors = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const getCompanyName = (username: string): string => {
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (!u) return username;
    const company = u.companyName || u.displayName || username;
    // 如果发送者是子账号，在公司名称后追加其姓名
    if (u.isSubAccount) {
      const personalName = u.displayName || u.contactPerson || u.name || '';
      if (personalName && company !== personalName) {
        return `${company}（${personalName}）`;
      }
    }
    return company;
  } catch { return username; }
};

/** 解析租户归属：子账号归父账号 */
const getOwner = (): string => {
  try {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    return localStorage.getItem('username') || '';
  } catch { return ''; }
};

/** 获取当前子账号的姓名（仅当登录者为子账号时返回，否则返回空字符串） */
const getSubAccountName = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (!isSub) return '';
  try {
    const username = localStorage.getItem('username') || '';
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (!u) return username;
    return u.displayName || u.contactPerson || u.name || username;
  } catch { return localStorage.getItem('username') || ''; }
};

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday) return hhmm;
  if (isYesterday) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
};

const formatListTime = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isYesterday) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// 事件总线已移至 chatSocket.ts，支持缓冲未挂载时的请求

// ============ 主组件 ============

const ChatPage: React.FC = () => {
  const currentUser = localStorage.getItem('username') || '';
  const owner = getOwner();
  const subAccountName = getSubAccountName();
  // isMine 判据：子账号时同时认定主账号的消息为“我的”
  const isMyMessage = (fromUser: string) => {
    if (fromUser === currentUser || fromUser === owner) return true;
    // 主账号视角：分流池成员发的消息也视为“我的”
    if (isMainAccount && dispatchMembers.includes(fromUser)) return true;
    return false;
  };
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [leftPanelMode, setLeftPanelMode] = useState<'chat' | 'friends' | 'dispatch'>('chat');
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [currentIsFriend, setCurrentIsFriend] = useState(false);

  // 左侧面板宽度拖拽
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const isDragging = useRef(false);

  // 快捷语模块
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplyTab, setQuickReplyTab] = useState<'personal' | 'company'>('personal');
  const [personalReplies, setPersonalReplies] = useState<{text: string}[]>(() => {
    try { return JSON.parse(localStorage.getItem(`chat_quick_personal_${currentUser}`) || '[]'); } catch { return []; }
  });
  const [companyReplies, setCompanyReplies] = useState<{text: string}[]>(() => {
    try { return JSON.parse(localStorage.getItem(`chat_quick_company_${owner}`) || '[]'); } catch { return []; }
  });
  const [newQuickReply, setNewQuickReply] = useState('');

  // 分流池设置
  const [showDispatchSettings, setShowDispatchSettings] = useState(false);
  const [dispatchMembers, setDispatchMembers] = useState<string[]>([]);
  const [allSubAccounts, setAllSubAccounts] = useState<string[]>([]);
  const isMainAccount = localStorage.getItem('isSubAccount') !== 'true';
  // 市场「联系」按键发起的会话标记：仅该会话内发送的消息参与分流路由；手动选择的会话一对一直发
  const [marketDispatchSession, setMarketDispatchSession] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);
  const sendTypingTimerRef = useRef<any>(null);
  const isInitialLoad = useRef(true);

  // ============ 加载会话列表 ============

  const loadConversations = useCallback(async () => {
    const convs = await fetchConversations();
    setConversations(convs);
    // 更新在线状态
    const online = new Set<string>();
    convs.forEach(c => { if (c.otherOnline) online.add(c.otherUser); });
    setOnlineUsers(prev => {
      const next = new Set(prev);
      online.forEach(u => next.add(u));
      return next;
    });
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ============ 加载好友列表 ============

  const loadFriends = useCallback(async () => {
    const list = await fetchFriends();
    setFriends(list);
  }, []);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  // ============ 加载分流池配置 ============

  useEffect(() => {
    if (!isMainAccount) return;
    // 加载分流池成员
    fetchDispatchPool().then(pool => {
      setDispatchMembers(pool.members);
    });
    // 加载所有子账号列表
    try {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const subs = users
        .filter((u: any) => u.isSubAccount && u.parentAccount === currentUser)
        .map((u: any) => u.username);
      setAllSubAccounts(subs);
    } catch { setAllSubAccounts([]); }
  }, [isMainAccount, currentUser]);

  const handleSaveDispatchPool = useCallback(async () => {
    const ok = await setDispatchPoolMembers(dispatchMembers);
    if (ok) {
      antdMessage.success('分流配置已保存');
      setShowDispatchSettings(false);
    } else {
      antdMessage.error('保存失败');
    }
  }, [dispatchMembers]);

  // ============ 检查当前聊天对象是否为好友 ============

  useEffect(() => {
    if (!selectedUser) { setCurrentIsFriend(false); return; }
    checkIsFriend(selectedUser).then(setCurrentIsFriend);
  }, [selectedUser]);

  // ============ 添加/删除好友 ============

  const handleAddFriend = useCallback(async () => {
    if (!selectedUser) return;
    const ok = await addFriend(selectedUser);
    if (ok) {
      antdMessage.success('已添加为好友');
      setCurrentIsFriend(true);
      loadFriends();
    } else {
      antdMessage.error('添加失败');
    }
  }, [selectedUser, loadFriends]);

  const handleRemoveFriend = useCallback(async (friendUsername: string) => {
    const ok = await removeFriend(friendUsername);
    if (ok) {
      antdMessage.success('已删除好友');
      loadFriends();
      if (friendUsername === selectedUser) setCurrentIsFriend(false);
    }
  }, [selectedUser, loadFriends]);

  // ============ 监听 WS 事件 ============

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(onNewMessage((msg) => {
      // 如果当前正在查看这个会话，追加消息
      if (selectedConvId === msg.conv_id) {
        setMessages(prev => [...prev, msg]);
        // 标记已读
        markRead(msg.conv_id);
        httpMarkRead(msg.conv_id);
      }
      // 刷新会话列表
      loadConversations();
    }));

    unsubs.push(onTyping((from) => {
      if (selectedUser === from) {
        setTypingUser(from);
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setTypingUser(null), 3000);
      }
    }));

    unsubs.push(onPresence((username, online) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (online) next.add(username); else next.delete(username);
        return next;
      });
    }));

    unsubs.push(onMessageSent((_id, serverConvId) => {
      // 消息发送确认：刷新会话列表
      loadConversations();
      // 关键修复：子账号场景下，服务端使用子账号用户名计算 conv_id，
      // 与从父账号合并的会话 conv_id 不同。必须同步更新 selectedConvId，
      // 否则刷新后 fetchHistory(旧convId) 返回空，且对方收不到消息。
      if (serverConvId && serverConvId !== selectedConvId) {
        setSelectedConvId(serverConvId);
      }
    }));

    return () => unsubs.forEach(u => u());
  }, [selectedConvId, selectedUser, loadConversations]);

  // ============ 注册打开会话回调 ============

  // 服务端内容审核屏蔽回执：对应本地气泡标记发送失败（感叹号）
  useEffect(() => {
    return onMessageBlocked((cid, reason) => {
      setMessages(prev => prev.map(m => (m.id === cid ? { ...m, send_failed: true, fail_reason: reason } : m)));
      antdMessage.warning(reason);
    });
  }, []);

  useEffect(() => {
    return registerOpenChat((username: string, subject?: string) => {
      // 市场联系按键入口：本次会话消息参与分流路由
      setMarketDispatchSession(true);
      handleSelectConversation(username, subject);
    });
  }, []);

  // ============ 选择会话 ============

  const handleSelectConversation = useCallback(async (username: string, _subject?: string) => {
    const convId = [currentUser, username].sort().join('_');
    // 使用实际 convId (hash)
    const convs = await fetchConversations();
    const conv = convs.find(c => c.otherUser === username);
    const targetConvId = conv?.convId || convId;

    // 标记为初次加载，确保后续消息加载时使用 instant 滚动
    isInitialLoad.current = true;
    setSelectedUser(username);
    setSelectedConvId(targetConvId);
    setMessages([]);
    setHasMore(true);
    setLoading(true);

    // 加载历史消息
    const msgs = await fetchHistory(targetConvId);
    setMessages(msgs);
    setHasMore(msgs.length >= 50);
    setLoading(false);

    // 标记已读
    markRead(targetConvId);
    httpMarkRead(targetConvId);
    loadConversations();
  }, [currentUser, loadConversations]);

  // ============ 加载更多历史消息 ============

  const loadMoreMessages = useCallback(async () => {
    if (!selectedConvId || !hasMore || loading) return;
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    setLoading(true);
    const older = await fetchHistory(selectedConvId, oldest);
    setMessages(prev => [...older, ...prev]);
    setHasMore(older.length >= 50);
    setLoading(false);
  }, [selectedConvId, hasMore, loading, messages]);

  // ============ 滚动到底部 ============

  useEffect(() => {
    // 消息为空时不滚动，避免消耗 isInitialLoad 标记
    if (messages.length === 0) return;
    if (isInitialLoad.current) {
      // 初次加载消息时直接跳转到底部，不显示滚动动画
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      isInitialLoad.current = false;
    } else {
      // 后续新消息使用平滑滚动
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ============ 发送消息 ============

  const handleSend = useCallback(() => {
    if ((!inputValue.trim() && pendingImages.length === 0) || !selectedUser) return;

    // 发送待发送图片（谁发的就是谁的账号，不替代发送者）
    if (pendingImages.length > 0) {
      pendingImages.forEach(dataUrl => {
        sendImageMessage(selectedUser, dataUrl, undefined, marketDispatchSession);
        const localMsg: ChatMessage = {
          id: `local-img-${Date.now()}-${Math.random()}`,
          conv_id: selectedConvId || '',
          from_user: currentUser,
          to_user: selectedUser,
          content: dataUrl,
          msg_type: 'image',
          conv_subject: '',
          created_at: Date.now(),
          read_at: 0,
        };
        setMessages(prev => [...prev, localMsg]);
      });
      setPendingImages([]);
    }

    // 发送文本（谁发的就是谁的账号姓名，主账号不再代子账号发送）
    if (inputValue.trim()) {
      const content = inputValue.trim();
      setInputValue('');

      // 内容安全预检：违法/不文明消息直接拦截，气泡显示感叹号发送失败
      const chk = checkChatContent(content);
      if (chk.blocked) {
        const reason = blockReason(chk);
        setMessages(prev => [...prev, {
          id: `local-blocked-${Date.now()}`,
          conv_id: selectedConvId || '',
          from_user: currentUser,
          to_user: selectedUser,
          content,
          msg_type: 'text',
          conv_subject: '',
          created_at: Date.now(),
          read_at: 0,
          send_failed: true,
          fail_reason: reason,
        }]);
        antdMessage.warning(reason);
      } else {
        const cid = sendMessage(selectedUser, content, undefined, marketDispatchSession);

        // 乐观更新：本地消息以 cid 为 id，便于服务端屏蔽/确认回执关联标记
        setMessages(prev => [...prev, {
          id: cid,
          conv_id: selectedConvId || '',
          from_user: currentUser,
          to_user: selectedUser,
          content,
          msg_type: 'text',
          conv_subject: '',
          created_at: Date.now(),
          read_at: 0,
        }]);
      }
    }
  }, [inputValue, selectedUser, selectedConvId, currentUser, pendingImages, marketDispatchSession]);

  // ============ 键盘事件 ============

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ============ 输入中提示 ============

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (selectedUser) {
      clearTimeout(sendTypingTimerRef.current);
      sendTypingTimerRef.current = setTimeout(() => {
        sendTyping(selectedUser);
      }, 1500);
    }
  }, [selectedUser]);

  // ============ 图片粘贴 ============

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || !selectedUser) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const dataUrl = await compressImageFile(file);
          setPendingImages(prev => [...prev, dataUrl]);
        } catch { /* ignore */ }
        break;
      }
    }
  }, [selectedUser]);

  // ============ 过滤会话列表 ============

  const filteredConversations = useMemo(() => {
    if (!searchText.trim()) return conversations;
    const q = searchText.trim().toLowerCase();
    return conversations.filter(c => {
      const name = getCompanyName(c.otherUser);
      return name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
    });
  }, [conversations, searchText]);

  // ============ 拖拽调整宽度 ============

  const handleMouseDown = useCallback(() => { isDragging.current = true; }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(200, Math.min(500, e.clientX - 60));
      setLeftPanelWidth(newWidth);
    };
    const handleMouseUp = () => { isDragging.current = false; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ============ 快捷语操作 ============

  const handleAddQuickReply = useCallback(() => {
    if (!newQuickReply.trim()) return;
    const item = { text: newQuickReply.trim() };
    if (quickReplyTab === 'personal') {
      const updated = [...personalReplies, item];
      setPersonalReplies(updated);
      localStorage.setItem(`chat_quick_personal_${currentUser}`, JSON.stringify(updated));
    } else {
      const updated = [...companyReplies, item];
      setCompanyReplies(updated);
      localStorage.setItem(`chat_quick_company_${owner}`, JSON.stringify(updated));
    }
    setNewQuickReply('');
  }, [newQuickReply, quickReplyTab, personalReplies, companyReplies, currentUser, owner]);

  const handleDeleteQuickReply = useCallback((idx: number) => {
    if (quickReplyTab === 'personal') {
      const updated = personalReplies.filter((_, i) => i !== idx);
      setPersonalReplies(updated);
      localStorage.setItem(`chat_quick_personal_${currentUser}`, JSON.stringify(updated));
    } else {
      const updated = companyReplies.filter((_, i) => i !== idx);
      setCompanyReplies(updated);
      localStorage.setItem(`chat_quick_company_${owner}`, JSON.stringify(updated));
    }
  }, [quickReplyTab, personalReplies, companyReplies, currentUser, owner]);

  const handleUseQuickReply = useCallback((text: string) => {
    setInputValue(prev => prev + text);
  }, []);

  // ============ 渲染 ============

  return (
    <div style={{ display: 'flex', height: '100%', background: '#fff', borderRadius: 8, overflow: 'hidden', border: '1px solid #e8e8e8' }}>
      {/* 左侧会话列表 */}
      <div style={{ width: leftPanelWidth, minWidth: 200, maxWidth: 500, borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fafafa', flexShrink: 0 }}>
        {/* 搜索 */}
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f0f0f0' }}>
          <Input
            placeholder="搜索联系人..."
            size="small"
            allowClear
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        {/* 切换标签 */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
          <div
            onClick={() => setLeftPanelMode('chat')}
            style={{
              flex: 1, textAlign: 'center', padding: '8px 0', cursor: 'pointer',
              fontSize: 13, fontWeight: leftPanelMode === 'chat' ? 600 : 400,
              color: leftPanelMode === 'chat' ? PRIMARY : '#666',
              borderBottom: leftPanelMode === 'chat' ? `2px solid ${PRIMARY}` : '2px solid transparent',
            }}
          >
            <TeamOutlined style={{ marginRight: 4 }} />消息
          </div>
          <div
            onClick={() => { setLeftPanelMode('friends'); loadFriends(); }}
            style={{
              flex: 1, textAlign: 'center', padding: '8px 0', cursor: 'pointer',
              fontSize: 13, fontWeight: leftPanelMode === 'friends' ? 600 : 400,
              color: leftPanelMode === 'friends' ? PRIMARY : '#666',
              borderBottom: leftPanelMode === 'friends' ? `2px solid ${PRIMARY}` : '2px solid transparent',
            }}
          >
            <UserOutlined style={{ marginRight: 4 }} />我的好友 ({friends.length})
          </div>
          {isMainAccount && (
            <div
              onClick={() => setLeftPanelMode('dispatch')}
              style={{
                flex: 1, textAlign: 'center', padding: '8px 0', cursor: 'pointer',
                fontSize: 13, fontWeight: leftPanelMode === 'dispatch' ? 600 : 400,
                color: leftPanelMode === 'dispatch' ? PRIMARY : '#666',
                borderBottom: leftPanelMode === 'dispatch' ? `2px solid ${PRIMARY}` : '2px solid transparent',
              }}
            >
              <SettingOutlined style={{ marginRight: 4 }} />分流
            </div>
          )}
        </div>
        {/* 列表内容 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {leftPanelMode === 'dispatch' ? (
            /* 分流设置面板 */
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#333' }}>消息分流配置</div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                采购商发送的消息将随机分配给在线的分流账号。无人在线时消息暂存，待账号上线后自动分配。
              </div>
              {allSubAccounts.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 12 }}>
                  暂无子账号，请先在系统中添加子账号
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#333', fontWeight: 500 }}>选择分流账号：</div>
                  {allSubAccounts.map(sub => {
                    const selected = dispatchMembers.includes(sub);
                    const isOnline = onlineUsers.has(sub);
                    return (
                      <div
                        key={sub}
                        onClick={() => {
                          setDispatchMembers(prev =>
                            selected ? prev.filter(m => m !== sub) : [...prev, sub]
                          );
                        }}
                        style={{
                          padding: '8px 10px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
                          border: selected ? `1px solid ${PRIMARY}` : '1px solid #e8e8e8',
                          background: selected ? '#e6f4ff' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {selected && <CheckOutlined style={{ color: PRIMARY, fontSize: 12 }} />}
                          <span style={{ fontSize: 13 }}>{getCompanyName(sub)}</span>
                        </div>
                        {isOnline && <span style={{ fontSize: 10, color: '#52c41a' }}>在线</span>}
                      </div>
                    );
                  })}
                  <button
                    onClick={handleSaveDispatchPool}
                    style={{
                      width: '100%', marginTop: 12, padding: '8px 0', borderRadius: 6,
                      border: 'none', cursor: 'pointer', background: PRIMARY, color: '#fff',
                      fontSize: 13, fontWeight: 500,
                    }}
                  >
                    保存配置
                  </button>
                </>
              )}
            </div>
          ) : leftPanelMode === 'friends' ? (
            friends.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                <Empty description="暂无好友" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              friends.map(f => {
                const name = getCompanyName(f.friendUsername);
                const isOnline = f.online || onlineUsers.has(f.friendUsername);
                return (
                  <div
                    key={f.friendUsername}
                    onClick={() => {
                      setLeftPanelMode('chat');
                      setMarketDispatchSession(false);
                      handleSelectConversation(f.friendUsername);
                    }}
                    style={{
                      padding: '12px 16px', cursor: 'pointer',
                      borderBottom: '1px solid #f5f5f5',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ position: 'relative' }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: getAvatarColor(name),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 600, fontSize: 16, flexShrink: 0,
                        }}>
                          {name.charAt(0)}
                        </div>
                        {isOnline && (
                          <div style={{
                            position: 'absolute', bottom: 0, right: 0,
                            width: 10, height: 10, borderRadius: '50%',
                            background: '#52c41a', border: '2px solid #fff',
                          }} />
                        )}
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <span style={{ fontSize: 14, color: '#222', fontWeight: 500 }}>{f.remark || name}</span>
                        {isOnline && <span style={{ fontSize: 11, color: '#52c41a', marginLeft: 6 }}>在线</span>}
                      </div>
                      <DeleteOutlined
                        onClick={(e) => { e.stopPropagation(); handleRemoveFriend(f.friendUsername); }}
                        style={{ fontSize: 12, color: '#bbb', cursor: 'pointer' }}
                        title="删除好友"
                      />
                    </div>
                  </div>
                );
              })
            )
          ) : (
            filteredConversations.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                <Empty description="暂无消息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              filteredConversations.map(conv => {
                const isSelected = selectedConvId === conv.convId;
                const companyName = getCompanyName(conv.otherUser);
                const isOnline = onlineUsers.has(conv.otherUser);
                return (
                  <div
                    key={conv.convId}
                    onClick={() => { setMarketDispatchSession(false); handleSelectConversation(conv.otherUser); }}
                    style={{
                      padding: '12px 16px', cursor: 'pointer',
                      background: isSelected ? '#e6f4ff' : 'transparent',
                      borderBottom: '1px solid #f5f5f5',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ position: 'relative' }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: getAvatarColor(companyName),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 600, fontSize: 16, flexShrink: 0,
                        }}>
                          {companyName.charAt(0)}
                        </div>
                        {isOnline && (
                          <div style={{
                            position: 'absolute', bottom: 0, right: 0,
                            width: 10, height: 10, borderRadius: '50%',
                            background: '#52c41a', border: '2px solid #fff',
                          }} />
                        )}
                      </div>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{
                            fontSize: 14, fontWeight: conv.unreadCount > 0 ? 600 : 400,
                            color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {companyName}{subAccountName ? `（${subAccountName}）` : ''}
                          </span>
                          <span style={{ fontSize: 11, color: '#999', flexShrink: 0 }}>
                            {formatListTime(conv.lastTime)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                          <span style={{
                            fontSize: 12, color: '#666',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            maxWidth: 160,
                          }}>
                            {conv.lastMessageType === 'image' ? '[图片]' : conv.lastMessage}
                          </span>
                          {conv.unreadCount > 0 && (
                            <Badge count={conv.unreadCount} style={{ backgroundColor: '#f5222d', flexShrink: 0 }} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      </div>

      {/* 拖拽手柄 */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          width: 4, cursor: 'col-resize', background: '#e8e8e8',
          flexShrink: 0, transition: 'background 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#1677ff')}
        onMouseLeave={e => (e.currentTarget.style.background = '#e8e8e8')}
      />

      {/* 右侧聊天区域 */}
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        {/* 聊天主内容 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selectedUser ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            <div style={{ textAlign: 'center' }}>
              <UserOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
              <div>选择一个会话开始聊天</div>
            </div>
          </div>
        ) : (
          <>
            {/* 顶部栏 */}
            <div style={{
              height: 56, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: '1px solid #e8e8e8', background: '#fff',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#222' }}>
                  {getCompanyName(selectedUser)}
                  {subAccountName ? <span style={{ fontWeight: 400, color: '#666', fontSize: 13, marginLeft: 4 }}>（{subAccountName}）</span> : null}
                </div>
                {onlineUsers.has(selectedUser) && (
                  <span style={{ fontSize: 11, color: '#52c41a', fontWeight: 400 }}>在线</span>
                )}
                {selectedUser !== currentUser && (
                  currentIsFriend ? (
                    <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>已是好友</span>
                  ) : (
                    <span
                      onClick={handleAddFriend}
                      style={{ fontSize: 12, color: '#1677ff', cursor: 'pointer', marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 2 }}
                    >
                      <UserAddOutlined style={{ fontSize: 12 }} />添加好友
                    </span>
                  )
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {messages.length > 0 && messages[0].conv_subject && (
                  <div style={{ fontSize: 12, color: '#999' }}>{messages[0].conv_subject}</div>
                )}
                {/* 快捷语开关 */}
                <span
                  onClick={() => setQuickReplyOpen(!quickReplyOpen)}
                  style={{
                    fontSize: 12, color: quickReplyOpen ? PRIMARY : '#999', cursor: 'pointer',
                    padding: '2px 8px', borderRadius: 4,
                    background: quickReplyOpen ? '#e6f4ff' : 'transparent',
                    border: quickReplyOpen ? `1px solid ${PRIMARY}` : '1px solid #e8e8e8',
                  }}
                >
                  <MessageOutlined style={{ marginRight: 4 }} />快捷语
                </span>
              </div>
            </div>

            {/* 消息区 */}
            <div
              ref={messagesContainerRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop < 50 && hasMore && !loading) {
                  loadMoreMessages();
                }
              }}
              style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#f5f5f5' }}
            >
              {loading && messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
              )}
              {hasMore && messages.length > 0 && (
                <div style={{ textAlign: 'center', padding: '8px 0', color: '#999', fontSize: 12 }}>
                  {loading ? '加载中...' : '向上滚动加载更多'}
                </div>
              )}
              <Image.PreviewGroup>
                {messages.map((msg, idx) => {
                  const isMine = isMyMessage(msg.from_user);
                  const showTime = idx === 0 || (msg.created_at - messages[idx - 1].created_at > 5 * 60 * 1000);
                  const senderName = isMine
                    ? (subAccountName || '我')
                    : getCompanyName(msg.from_user);
                  return (
                    <React.Fragment key={msg.id || idx}>
                      {showTime && (
                        <div style={{ textAlign: 'center', margin: '12px 0', fontSize: 11, color: '#999' }}>
                          {formatTime(msg.created_at)}
                        </div>
                      )}
                      <div style={{ display: 'flex', marginBottom: 12, flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
                        {/* 头像 */}
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%',
                          background: getAvatarColor(isMine ? currentUser : msg.from_user),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 600, fontSize: 14, flexShrink: 0,
                          marginLeft: isMine ? 8 : 0, marginRight: isMine ? 0 : 8,
                        }}>
                          {(isMine ? senderName : getCompanyName(msg.from_user)).charAt(0)}
                        </div>
                        {/* 气泡 */}
                        <div style={{ maxWidth: '65%' }}>
                          {(!isMine || subAccountName) && <div style={{ fontSize: 11, color: '#999', marginBottom: 2, textAlign: isMine ? 'right' : 'left' }}>{senderName}</div>}
                          <div style={{
                            padding: msg.msg_type === 'image' ? 4 : '8px 12px',
                            background: isMine ? '#1677ff' : '#fff',
                            color: isMine ? '#fff' : '#222',
                            borderRadius: isMine ? '12px 12px 0 12px' : '12px 12px 12px 0',
                            fontSize: 14, lineHeight: 1.6,
                            wordBreak: 'break-word',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                          }}>
                            {msg.msg_type === 'image' ? (
                              <Image src={msg.content} style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8 }} />
                            ) : (
                              <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                            )}
                          </div>
                        </div>
                        {/* 发送失败（违规屏蔽）感叹号标记 */}
                        {msg.send_failed && (
                          <Tooltip title={msg.fail_reason || '发送失败'}>
                            <ExclamationCircleFilled
                              style={{ color: '#ff4d4f', fontSize: 18, alignSelf: 'center', flexShrink: 0, margin: isMine ? '0 4px 0 0' : '0 0 0 4px' }}
                            />
                          </Tooltip>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </Image.PreviewGroup>
              {typingUser && (
                <div style={{ fontSize: 12, color: '#999', padding: '4px 0 8px 44px', fontStyle: 'italic' }}>
                  {getCompanyName(typingUser)} 正在输入...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div style={{ borderTop: '1px solid #e8e8e8', padding: '12px 16px', background: '#fff' }}>
              {/* 待发送图片预览 */}
              {pendingImages.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  {pendingImages.map((dataUrl, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 64, height: 64 }}>
                      <img
                        src={dataUrl}
                        alt={`待发送 ${idx + 1}`}
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid #e8e8e8' }}
                      />
                      <CloseCircleFilled
                        onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                        style={{
                          position: 'absolute', top: -6, right: -6,
                          fontSize: 18, color: '#ff4d4f', cursor: 'pointer',
                          background: '#fff', borderRadius: '50%',
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <TextArea
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                autoSize={{ minRows: 2, maxRows: 5 }}
                style={{ marginBottom: 8, resize: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#999' }}>支持粘贴图片 (Ctrl+V)</span>
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() && pendingImages.length === 0}
                  style={{
                    padding: '6px 20px', borderRadius: 4, border: 'none',
                    cursor: (inputValue.trim() || pendingImages.length > 0) ? 'pointer' : 'not-allowed',
                    background: (inputValue.trim() || pendingImages.length > 0) ? PRIMARY : '#d9d9d9',
                    color: '#fff', fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s',
                  }}
                >
                  <SendOutlined /> 发送
                </button>
              </div>
            </div>
          </>
        )}
        </div>

        {/* 快捷语面板 */}
        {quickReplyOpen && (
          <div style={{
            width: 240, flexShrink: 0, borderLeft: '1px solid #e8e8e8',
            display: 'flex', flexDirection: 'column', background: '#fafafa',
          }}>
            {/* 头部 */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>快捷语</span>
              <CloseOutlined onClick={() => setQuickReplyOpen(false)} style={{ fontSize: 12, color: '#999', cursor: 'pointer' }} />
            </div>
            {/* Tab 切换 */}
            <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0' }}>
              <div
                onClick={() => setQuickReplyTab('personal')}
                style={{
                  flex: 1, textAlign: 'center', padding: '7px 0', cursor: 'pointer', fontSize: 12,
                  fontWeight: quickReplyTab === 'personal' ? 600 : 400,
                  color: quickReplyTab === 'personal' ? PRIMARY : '#666',
                  borderBottom: quickReplyTab === 'personal' ? `2px solid ${PRIMARY}` : '2px solid transparent',
                }}
              >个人常用</div>
              <div
                onClick={() => setQuickReplyTab('company')}
                style={{
                  flex: 1, textAlign: 'center', padding: '7px 0', cursor: 'pointer', fontSize: 12,
                  fontWeight: quickReplyTab === 'company' ? 600 : 400,
                  color: quickReplyTab === 'company' ? PRIMARY : '#666',
                  borderBottom: quickReplyTab === 'company' ? `2px solid ${PRIMARY}` : '2px solid transparent',
                }}
              >公司常用</div>
            </div>
            {/* 添加快捷语 */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 6 }}>
              <Input
                size="small"
                placeholder="输入常用话术..."
                value={newQuickReply}
                onChange={e => setNewQuickReply(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddQuickReply(); } }}
                style={{ flex: 1 }}
              />
              <span onClick={handleAddQuickReply} style={{ color: PRIMARY, cursor: 'pointer', fontSize: 16, lineHeight: '24px' }}>
                <PlusOutlined />
              </span>
            </div>
            {/* 快捷语列表 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
              {(quickReplyTab === 'personal' ? personalReplies : companyReplies).length === 0 ? (
                <div style={{ textAlign: 'center', color: '#bbb', fontSize: 12, padding: '20px 0' }}>
                  暂无快捷语，请在上方添加
                </div>
              ) : (
                (quickReplyTab === 'personal' ? personalReplies : companyReplies).map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '6px 8px', marginBottom: 4, background: '#fff', borderRadius: 6,
                      border: '1px solid #f0f0f0', fontSize: 12, cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4,
                    }}
                    onClick={() => handleUseQuickReply(item.text)}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
                    <CloseOutlined
                      onClick={(e) => { e.stopPropagation(); handleDeleteQuickReply(idx); }}
                      style={{ fontSize: 10, color: '#ccc', flexShrink: 0 }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;
