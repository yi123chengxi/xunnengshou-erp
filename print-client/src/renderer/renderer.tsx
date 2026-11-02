/**
 * 讯能手打印客户端 — 渲染进程 React 界面
 *
 * 登录页 + 主界面（连接状态 / 打印机列表 / 任务日志）
 */
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// 类型声明（来自 preload.ts contextBridge）
declare global {
  interface Window {
    printAPI: {
      login(user: string, pass: string): Promise<{ ok: boolean; message?: string; username?: string; name?: string }>;
      getPrinters(): Promise<{ name: string; isDefault: boolean }[]>;
      getStatus(): Promise<{ connected: boolean; username: string; serverUrl: string }>;
      getJobLogs(): Promise<any[]>;
      logout(): Promise<{ ok: boolean }>;
      onStatusChange(cb: (s: string) => void): () => void;
      onJobLog(cb: (log: any) => void): () => void;
      onPrintersUpdated(cb: (p: any[]) => void): () => void;
      getSharedPrinters(): Promise<any[]>;
      onSharedPrinters(cb: (p: any[]) => void): () => void;
      onUpdateEvent(cb: (e: any) => void): () => void;
      checkUpdate(): Promise<{ ok: boolean }>;
      installUpdate(): Promise<{ ok: boolean; message?: string }>;
      setSharedPrinters(names: string[]): Promise<{ ok: boolean }>;
    };
  }
}

const api = window.printAPI;

// 本机共享标记持久化键（手动添加的共享打印机名单）
const SHARED_KEY = 'printclient_shared_printers';

// ============ 登录页 ============
function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!username || !password) {
      setError('请填写所有字段');
      return;
    }
    setLoading(true);
    setError('');
    const result = await api.login(username, password);
    setLoading(false);
    if (result.ok) {
      onLogin();
    } else {
      setError(result.message || '登录失败');
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-title">讯能手打印客户端</div>
        <div className="login-field">
          <label>用户名</label>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="登录账号" />
        </div>
        <div className="login-field">
          <label>密码</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="登录密码"
            onKeyDown={e => e.key === 'Enter' && handleLogin()} />
        </div>
        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? '登录中...' : '登 录'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}

// ============ 主界面 ============
function MainPage() {
  const [status, setStatus] = useState('connecting');
  const [username, setUsername] = useState('');
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
  const [sharedPrinters, setSharedPrinters] = useState<any[]>([]);
  const [sharedNames, setSharedNames] = useState<string[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [update, setUpdate] = useState<any>(null);

  // 共享/取消共享本机打印机：持久化到本地并通知主进程重新上报（仅共享名单进入同租户共享池）
  const toggleShare = (name: string) => {
    const next = sharedNames.includes(name) ? sharedNames.filter(n => n !== name) : [...sharedNames, name];
    setSharedNames(next);
    try { localStorage.setItem(SHARED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    api.setSharedPrinters(next);
  };

  useEffect(() => {
    // 获取初始状态
    api.getStatus().then(s => {
      setUsername(s.username);
      setStatus(s.connected ? 'connected' : 'disconnected');
    });
    api.getPrinters().then(setPrinters);
    api.getJobLogs().then(setLogs);
    api.getSharedPrinters().then(list => { if (Array.isArray(list)) setSharedPrinters(list); });
    // 恢复本机共享标记并同步给主进程（主进程据此过滤上报）
    let savedShared: string[] = [];
    try { savedShared = JSON.parse(localStorage.getItem(SHARED_KEY) || '[]'); } catch { savedShared = []; }
    setSharedNames(Array.isArray(savedShared) ? savedShared : []);
    api.setSharedPrinters(Array.isArray(savedShared) ? savedShared : []);

    // 监听变化
    const unsubStatus = api.onStatusChange(setStatus);
    const unsubLog = api.onJobLog((log) => setLogs(prev => [log, ...prev].slice(0, 100)));
    const unsubPrinters = api.onPrintersUpdated(setPrinters);
    const unsubShared = api.onSharedPrinters((list) => setSharedPrinters(Array.isArray(list) ? list : []));
    const unsubUpdate = api.onUpdateEvent((e: any) => {
      if (e.type === 'checking') { setUpdate({ stage: 'checking' }); return; }
      if (e.type === 'available') { setUpdate({ stage: 'available', version: e.version }); return; }
      if (e.type === 'progress') { setUpdate({ stage: 'progress', percent: e.percent }); return; }
      if (e.type === 'downloaded') { setUpdate({ stage: 'downloaded', version: e.version }); return; }
      if (e.type === 'not-available') { setUpdate({ stage: 'not-available' }); setTimeout(() => setUpdate(null), 3000); return; }
      if (e.type === 'error') { setUpdate({ stage: 'error', message: e.message }); setTimeout(() => setUpdate(null), 4000); return; }
    });

    return () => { unsubStatus(); unsubLog(); unsubPrinters(); unsubShared(); unsubUpdate(); };
  }, []);

  const statusLabel: Record<string, string> = {
    connected: '已连接',
    disconnected: '已断开',
    reconnecting: '重连中...',
    auth_failed: '认证失败',
    connecting: '连接中...',
  };

  const handleLogout = async () => {
    await api.logout();
    window.location.reload();
  };

  return (
    <div className="main-container">
      <div className="main-header">
        <span className="title">{username} - 打印客户端</span>
        <span className="status">
          <span className={`status-dot ${status === 'connected' ? 'connected' : status === 'reconnecting' ? 'reconnecting' : 'disconnected'}`} />
          {statusLabel[status] || status}
        </span>
      </div>

      {/* 客户端更新提示条 */}
      {update && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', borderRadius: 8, fontSize: 12, color: '#1a2b45',
          background: update.stage === 'error' ? '#fff1f0' : '#e6f4ff',
          border: `1px solid ${update.stage === 'error' ? '#ffa39e' : '#91caff'}`,
        }}>
          {update.stage === 'checking' && <span>正在检查更新…</span>}
          {update.stage === 'not-available' && <span>当前已是最新版本</span>}
          {update.stage === 'available' && <span>发现新版本 v{update.version}，正在后台下载更新…</span>}
          {update.stage === 'progress' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, height: 6, background: '#d6e4ff', borderRadius: 3, overflow: 'hidden', display: 'block' }}>
                <span style={{ display: 'block', height: '100%', width: `${update.percent}%`, background: '#1677ff' }} />
              </span>
              <span>下载中 {update.percent}%</span>
            </span>
          )}
          {update.stage === 'downloaded' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>新版本 v{update.version} 已下载，是否立即安装并重启？</span>
              <button className="login-btn" style={{ padding: '4px 12px', fontSize: 12, width: 'auto' }} onClick={() => api.installUpdate()}>立即安装</button>
            </span>
          )}
          {update.stage === 'error' && <span>更新失败：{update.message}</span>}
        </div>
      )}

      <div className="main-body">
        <div className="section">
          <div className="section-title">本机打印机 ({printers.length}) · 点“共享”才加入同租户共享池</div>
          {printers.length === 0 ? (
            <div className="empty-text">暂无打印机</div>
          ) : (
            <ul className="printer-list">
              {printers.map((p, i) => {
                const shared = sharedNames.includes(p.name);
                return (
                  <li key={i} className="printer-item">
                    <span className="name">{p.name}</span>
                    {p.isDefault && <span className="badge">默认</span>}
                    {shared && <span className="badge" style={{ background: '#f6ffed', color: '#389e0d' }}>共享中</span>}
                    <button
                      style={{
                        flexShrink: 0, fontSize: 11, padding: '2px 10px', borderRadius: 4, cursor: 'pointer', border: '1px solid',
                        background: shared ? '#fff1f0' : '#f6ffed',
                        color: shared ? '#cf1322' : '#389e0d',
                        borderColor: shared ? '#ffa39e' : '#b7eb8f',
                      }}
                      onClick={() => toggleShare(p.name)}
                    >{shared ? '取消共享' : '共享'}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="section">
          <div className="section-title">共享打印机（同租户 {sharedPrinters.filter(p => !p.isLocal).length}）</div>
          {sharedPrinters.filter(p => !p.isLocal).length === 0 ? (
            <div className="empty-text">暂无共享打印机：本机打印机需在上方点“共享”手动加入；同租户其他电脑共享的打印机将出现在这里供本机使用</div>
          ) : (
            <ul className="printer-list">
              {sharedPrinters.filter(p => !p.isLocal).map((p, i) => (
                <li key={i} className="printer-item">
                  <span className="name">{p.name}</span>
                  <span className="badge">来自 {p.clientName || '其他电脑'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section">
          <div className="section-title">打印任务日志</div>
          {logs.length === 0 ? (
            <div className="empty-text">暂无打印任务</div>
          ) : (
            <div className="log-list">
              {logs.map((log, i) => (
                <div key={i} className="log-item">
                  <span className="time">{log.time}</span>
                  <span className={`status-tag ${log.status}`}>{log.status}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.jobType === 'url' ? 'URL' : 'PDF'} → {log.printerName}
                  </span>
                  {log.error && <span style={{ color: '#f5222d', fontSize: 11 }}>{log.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="main-footer">
        <button className="logout-btn" style={{ background: '#f0f5ff', color: '#1e4a7e', border: '1px solid #91caff' }} onClick={() => api.checkUpdate()}>检查更新</button>
        <button className="logout-btn" onClick={handleLogout}>退出登录</button>
      </div>
    </div>
  );
}

// ============ 根组件 ============
function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.getStatus().then(s => {
      setLoggedIn(s.connected);
      setChecking(false);
    });
  }, []);

  if (checking) return null;
  return loggedIn ? <MainPage /> : <LoginPage onLogin={() => setLoggedIn(true)} />;
}

// 挂载
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
