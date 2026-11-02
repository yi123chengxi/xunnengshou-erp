/**
 * 临时计费策略（生产部署准备期总开关；收费通道上线后将对应开关改回 false 即恢复原逻辑）：
 * 1) FREE_PERIOD：所有注册账号不限使用时间——登录不因试用/授权到期进入只读或拦截，
 *    到期提醒横幅与头部倒计时隐藏（头部改显「限时免费」）；
 * 2) SUBSCRIBE_DISABLED：软件订购通道暂关闭——SubscriptionModal「立即订购」不可点击，
 *    套餐价格划线并在下方显示「限时免费」；
 * 3) STORAGE_SUBSCRIBE_DISABLED：订购更多空间暂不支持——入口与空间套餐页按钮置灰，
 *    期间租户默认 2G 空间，企业认证（三要素+法人刷脸）通过后领取 10G 永久空间
 *    （见 utils/storageQuota 的 BASE_QUOTA_KB / CERTIFIED_QUOTA_KB）。
 */
export const FREE_PERIOD = true;
export const SUBSCRIBE_DISABLED = true;
export const STORAGE_SUBSCRIBE_DISABLED = true;
