export default defineAppConfig({
  // 页面栈：5 个固定 Tab 页 + 登录/更多/通用模块/审批详情/市场联系会话
  // 底部固定按键由 components/AppTabBar 在每个页面内渲染（非原生 tabBar，保证任何页面按键不变）
  pages: [
    'pages/workbench/index',
    'pages/finance/index',
    'pages/market/index',
    'pages/order/index',
    'pages/mine/index',
    'pages/login/index',
    'pages/more/index',
    'pages/module/index',
    'pages/approval-detail/index',
    'pages/chat/index',
    'pages/messages/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1677ff',
    navigationBarTitleText: '讯能手ERP',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f6f8',
  },
})
