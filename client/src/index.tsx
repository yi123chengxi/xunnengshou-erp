import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';

// dayjs 全局中文地区（DatePicker 月份显示中文）
dayjs.locale('zh-cn');
import { installStorageQuotaGuard, registerSetItemHook, proactiveQuotaCleanup } from './utils/storageQuota';
import { installStorageWriteFailureNotice } from './utils/storageFailureNotice';
import { scheduleDatasetUpload, installUploadQueueRetry } from './utils/serverSync';
import { hydrateProductListCache } from './utils/dataStore';
import { hydrateImageUrlMap } from './utils/imageSpace';
import { initPushNotifications } from './utils/pushNotification';
import { cleanupDemoAccountsAndSession } from './utils/demoAccountCleanup';
import { startBankSyncWatcher } from './utils/supplierBankSync';
import { startInviteConsumeWatcher } from './utils/inviteRegistry';

// 全局 localStorage 配额防护：任何 setItem 配额溢出时自动清理重试，杜绝未捕获 QuotaExceededError 崩溃
installStorageQuotaGuard();
// 写不进时必须当场告知：防护补丁放弃写入会广播 storage-write-failed，避免“提示保存成功但数据未落盘”
installStorageWriteFailureNotice();
// 跨浏览器同步：业务数据写入后防抖上传到后端（后端不可用时静默降级）
registerSetItemHook((key, value) => scheduleDatasetUpload(key, value));
// 待上传队列自动补传：断网/关页面期间未及上传的保存，联网、切回前台或每 30 秒自动重试
installUploadQueueRetry();
// 商品清单内存缓存预热：本地缓存被预算淘汰后，仪表盘等同步读取的页面仍能取到数据
// 图片云端绑定表预热：localStorage 被配额清理删掉时用 IndexedDB 副本回灌，BOM/款式图不致空白
setTimeout(() => {
  try {
    const owner = localStorage.getItem('isSubAccount') === 'true'
      ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '')
      : (localStorage.getItem('username') || '');
    if (owner) {
      void hydrateProductListCache(owner);
      void hydrateImageUrlMap(owner);
    }
  } catch { /* ignore */ }
}, 1200);
// 残留演示账号与遗留登录会话清理：测试期遗留的 admin 等会话在启动时即清除，回退登录页
cleanupDemoAccountsAndSession();
// 供应商银行信息自动同步监听：采购商侧供应商条目银行四字段默认同步供应商企业信息，
// 供应商改动时（服务器同步落地/页面恢复/跨标签变更）自动触发一次更新同步
startBankSyncWatcher();
// 一次性邀约链接消耗监听：采购商同意/拒绝合作完成时自动消耗会话内的邀约码使链接失效
startInviteConsumeWatcher();

// 陈旧 bundle 提醒：本 tab 加载的 main chunk 与服务端最新 manifest 不一致时提示强刷
//（救济已被浏览器缓存旧 index.html 的设备；nginx 已对 index.html 设 no-cache 杜绝新增缓存）
(() => {
  try {
    if (process.env.NODE_ENV !== 'production') return;
    const script = document.querySelector('script[src*="/static/js/main."]');
    const loadedFile = (script?.getAttribute('src') || '').split('/').pop() || '';
    if (!loadedFile) return;
    fetch(`/asset-manifest.json?_=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((mf: any) => {
        const latestFile = (String(mf?.files?.['main.js'] || '')).split('/').pop() || '';
        if (!latestFile || latestFile === loadedFile) return;
        if (sessionStorage.getItem('staleBundleNotified')) return;
        sessionStorage.setItem('staleBundleNotified', '1');
        setTimeout(() => {
          const div = document.createElement('div');
          div.textContent = '系统已更新到新版本，请按 Ctrl+F5 强制刷新加载最新功能';
          div.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;background:#fff7e6;border:1px solid #ffd591;color:#ad6800;padding:8px 16px;border-radius:6px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.15)';
          document.body.appendChild(div);
          setTimeout(() => div.remove(), 8000);
        }, 2000);
      })
      .catch(() => { /* 服务端不可用时静默 */ });
  } catch { /* ignore */ }
})();

// 浏览器会话级登录态：sessionStorage 随浏览器关闭而清空，
// 重启浏览器后再打开网址视为"未登入"——清除上次残留的登录会话并回退登录页，
// 同一浏览器会话内刷新/新开标签页仍保持登录（不影响正常使用）。
// 判定新浏览器会话须同时满足：本标签 sessionStorage 无标记 且 心跳陈旧（>20s）——
// 心跳新鲜说明同浏览器另有存活标签（如已登录的后台标签），手动新开标签不得误杀其会话。
(() => {
  try {
    const hasSession = !!localStorage.getItem('username');
    const alive = sessionStorage.getItem('erpSessionAlive');
    const lastBeat = Number(localStorage.getItem('erpHeartbeat') || 0);
    const heartbeatFresh = lastBeat > 0 && Date.now() - lastBeat <= 20000;
    if (hasSession && alive !== '1' && !heartbeatFresh) {
      ['userRole', 'username', 'isViewOnly', 'isSubAccount', 'parentAccount', 'userRoles', 'userCustomPermissions'].forEach(k => localStorage.removeItem(k));
    }
    sessionStorage.setItem('erpSessionAlive', '1');
  } catch { /* ignore */ }
})();

// 心跳检测（兼容浏览器"恢复上次会话"还原 sessionStorage 的场景）：
// 页面运行期间每 5 秒写一次心跳；启动时若心跳已中断超过 20 秒，
// 说明期间所有页面都已关闭（浏览器重启/标签全关），本次打开视为未登入，
// 清除残留登录会话回退登录页；刷新或同会话内新开标签心跳新鲜，保持登录
(() => {
  try {
    const HEARTBEAT_KEY = 'erpHeartbeat';
    const last = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
    const hasSession = !!localStorage.getItem('username');
    if (hasSession && last && Date.now() - last > 20000) {
      ['userRole', 'username', 'isViewOnly', 'isSubAccount', 'parentAccount', 'userRoles', 'userCustomPermissions'].forEach(k => localStorage.removeItem(k));
      try { sessionStorage.removeItem('erpSessionAlive'); } catch { /* ignore */ }
    }
    const beat = () => { try { localStorage.setItem(HEARTBEAT_KEY, String(Date.now())); } catch { /* ignore */ } };
    beat();
    setInterval(beat, 5000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
  } catch { /* ignore */ }
})();

// 登录鉴权守卫：未登录（无 username 会话）直接打开后台路由时统一重定向到登录页；
// 公开链接（合作确认/货盘分享/品牌公开页/邀约落地页）与开发者入口（自有 devLoggedIn 守卫）除外
(() => {
  const path = window.location.pathname;
  const publicPrefix = /^\/(login|register|cooperation-confirm\/|shared\/|brand-apply\/|brand-cert\/|purchaser-cooperation-confirm\/|purchaser-invite\/|xunnengs\/)/;
  try {
    if (!localStorage.getItem('username') && !publicPrefix.test(path)) {
      window.location.replace('/login');
    }
  } catch { /* ignore */ }
})();
// 启动后延迟主动配额清理：存储占用过高时提前释放，避免关键数据写入静默失败
setTimeout(() => proactiveQuotaCleanup(), 2000);

// Web Push：注册 Service Worker + 请求通知权限 + 创建订阅
// 登录成功后会再次调用以确保订阅与当前用户绑定
initPushNotifications();

// 懒加载 chunk 失败守卫：版本更新后旧页面引用已删除的旧 hash chunk 会 404，
// 未捕获异常将整棵 React 树卸载造成整页空白；此处统一捕获并自动刷新一次加载新版本，
// 刷新仍失败则展示重试界面，杜绝"偶尔空白需手动刷新"问题
class ChunkGuard extends React.Component<{ children: React.ReactNode }, { err: string }> {
  state = { err: '' };
  static getDerivedStateFromError(e: any) {
    return { err: String((e && e.message) || e || 'unknown error') };
  }
  componentDidCatch(e: any) {
    const msg = String((e && e.message) || e || '');
    const isChunk = /Loading chunk|chunk .*failed|Failed to fetch dynamically imported|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg);
    try {
      const last = Number(sessionStorage.getItem('chunkReloadAt') || 0);
      if (isChunk && Date.now() - last > 15000) {
        sessionStorage.setItem('chunkReloadAt', String(Date.now()));
        window.location.reload();
      }
    } catch { /* ignore */ }
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 60, textAlign: 'center', fontFamily: 'sans-serif' }}>
          <p style={{ fontSize: 15, color: '#333' }}>页面资源加载失败（系统可能已更新到新版本）</p>
          <button
            style={{ marginTop: 12, padding: '8px 24px', background: '#1890ff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            onClick={() => window.location.reload()}
          >
            立即刷新
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ChunkGuard>
    <ConfigProvider locale={zhCN} theme={{
      token: {
        colorPrimary: '#1890ff',
        borderRadius: 0,
      },
      components: {
        Button: { borderRadius: 0 },
        Input: { borderRadius: 0 },
        Select: { borderRadius: 0 },
        InputNumber: { borderRadius: 0 },
        DatePicker: { borderRadius: 0 },
        Card: { borderRadiusLG: 0 },
        Table: { borderRadius: 0 },
        Modal: { borderRadiusLG: 0 },
        Tag: { borderRadiusSM: 0 },
        Pagination: { borderRadius: 0 },
        Cascader: { borderRadius: 0 },
        Transfer: { borderRadius: 0 },
      },
    }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
    </ChunkGuard>
  </React.StrictMode>
);
