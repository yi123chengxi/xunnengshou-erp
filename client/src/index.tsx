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
import { scheduleDatasetUpload } from './utils/serverSync';
import { initPushNotifications } from './utils/pushNotification';
import { cleanupDemoAccountsAndSession } from './utils/demoAccountCleanup';

// 全局 localStorage 配额防护：任何 setItem 配额溢出时自动清理重试，杜绝未捕获 QuotaExceededError 崩溃
installStorageQuotaGuard();
// 跨浏览器同步：业务数据写入后防抖上传到后端（后端不可用时静默降级）
registerSetItemHook((key, value) => scheduleDatasetUpload(key, value));
// 残留演示账号与遗留登录会话清理：测试期遗留的 admin 等会话在启动时即清除，回退登录页
cleanupDemoAccountsAndSession();
// 启动后延迟主动配额清理：存储占用过高时提前释放，避免关键数据写入静默失败
setTimeout(() => proactiveQuotaCleanup(), 2000);

// Web Push：注册 Service Worker + 请求通知权限 + 创建订阅
// 登录成功后会再次调用以确保订阅与当前用户绑定
initPushNotifications();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
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
  </React.StrictMode>
);
