import React, { useState, useEffect, useRef, useCallback } from 'react';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
dayjs.extend(isBetween);
dayjs.extend(isSameOrBefore);
import { Card, Typography, Form, Input, Button, Tabs, message, Divider, Checkbox, Select, Steps, Result, Alert, Descriptions, Modal, Radio, Space } from 'antd';
import { UserOutlined, LockOutlined, ShopOutlined, BankOutlined, PhoneOutlined, MailOutlined, UserAddOutlined, InfoCircleOutlined, SyncOutlined, SafetyCertificateOutlined, MobileOutlined, TagOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { safeSetItem } from '../utils/storageQuota';
import { FREE_PERIOD } from '../utils/billingPolicy';
import { fetchServerDataset, flushDatasetUpload } from '../utils/serverSync';
import { initPushNotifications } from '../utils/pushNotification';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import { PROCESS_TYPE_OPTIONS } from './ContractFactoryPage';

const { Title, Text, Paragraph } = Typography;

const PRIMARY = '#1e4a7e';

// 短信验证码登录接口地址（统一走 apiBase：开发 localhost:3000，生产同源 /api）
import { API_BASE as SMS_API_BASE } from '../utils/apiBase';

// === 安全防护工具函数 ===
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

// 获取登录失败记录
const getLoginAttempts = (username: string): { count: number; lockUntil: string | null } => {
  try {
    const data = JSON.parse(localStorage.getItem(`login_attempts_${username}`) || '{}');
    return { count: data.count || 0, lockUntil: data.lockUntil || null };
  } catch { return { count: 0, lockUntil: null }; }
};

// 检查账号是否被锁定
const isAccountLocked = (username: string): { locked: boolean; remainingMinutes: number } => {
  const { lockUntil } = getLoginAttempts(username);
  if (!lockUntil) return { locked: false, remainingMinutes: 0 };
  const now = dayjs();
  const lockTime = dayjs(lockUntil);
  if (now.isAfter(lockTime)) {
    // 锁定已过期，清除
    localStorage.removeItem(`login_attempts_${username}`);
    return { locked: false, remainingMinutes: 0 };
  }
  return { locked: true, remainingMinutes: lockTime.diff(now, 'minute') + 1 };
};

// 记录登录失败
const recordLoginFailure = (username: string): number => {
  const { count } = getLoginAttempts(username);
  const newCount = count + 1;
  const data: any = { count: newCount, lockUntil: null };
  if (newCount >= MAX_LOGIN_ATTEMPTS) {
    data.lockUntil = dayjs().add(LOCK_DURATION_MINUTES, 'minute').toISOString();
  }
  safeSetItem(`login_attempts_${username}`, JSON.stringify(data));
  return newCount;
};

// 清除登录失败记录
const clearLoginAttempts = (username: string) => {
  localStorage.removeItem(`login_attempts_${username}`);
};

// 记录登录日志
const recordLoginLog = (username: string, success: boolean, detail?: string) => {
  try {
    const logs: any[] = JSON.parse(localStorage.getItem('login_audit_log') || '[]');
    logs.unshift({
      username,
      success,
      detail: detail || (success ? '登录成功' : '登录失败'),
      time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      ip: '127.0.0.1', // 本地演示环境
    });
    // 只保留最近200条
    if (logs.length > 200) logs.length = 200;
    safeSetItem('login_audit_log', JSON.stringify(logs));
  } catch { /* ignore */ }
};

// === 新设备验证工具函数 ===
// 生成设备指纹（基于浏览器特征）
const getDeviceFingerprint = (): string => {
  const nav = window.navigator;
  const screen = window.screen;
  const raw = [
    nav.userAgent,
    nav.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    nav.platform,
    nav.hardwareConcurrency || '',
  ].join('|');
  // 简单 hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'fp_' + Math.abs(hash).toString(36) + '_' + raw.length;
};

// 检查是否为可信设备
const isTrustedDevice = (username: string): boolean => {
  try {
    const devices: string[] = JSON.parse(localStorage.getItem(`trusted_devices_${username}`) || '[]');
    return devices.includes(getDeviceFingerprint());
  } catch { return false; }
};

// 将设备标记为可信
const trustDevice = (username: string) => {
  try {
    const key = `trusted_devices_${username}`;
    const devices: string[] = JSON.parse(localStorage.getItem(key) || '[]');
    const fp = getDeviceFingerprint();
    if (!devices.includes(fp)) {
      devices.push(fp);
      // 最多保留10个可信设备
      if (devices.length > 10) devices.shift();
      safeSetItem(key, JSON.stringify(devices));
    }
  } catch { /* ignore */ }
};

// 内存登录候选（初始为空：演示账号已取消；注册成功后临时追加便于同会话登录，真值源为 registeredUsers）
const mockUsers: { username: string; password: string; role: string; name: string }[] = [];

// 一次性清理残留演示账号：从 registeredUsers（含服务端同步副本）移除内置演示凭据，
// 任何浏览器加载登录页时自动执行，保证部署环境演示身份不可登录
(() => {
  try {
    const list: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const DEMO = new Set(['admin|123456', 'purchaser1|123456', 'both1|123456']);
    const next = list.filter(u => !DEMO.has(`${u?.username}|${u?.password}`));
    if (next.length !== list.length) {
      safeSetItem('registeredUsers', JSON.stringify(next));
      flushDatasetUpload('registeredUsers', JSON.stringify(next));
    }
  } catch { /* ignore */ }
})();

const Auth: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [registerStep, setRegisterStep] = useState(0);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [registeredAccount, setRegisteredAccount] = useState('');
  const [form] = Form.useForm();
  const [forgotForm] = Form.useForm();
  // 注册表单省市区级联
  const regProvince = Form.useWatch('province', form);
  // 注册角色含加工厂时显示工序类型填写字段
  const regRoleWatch = Form.useWatch('role', form);
  const regIsFactory = Array.isArray(regRoleWatch) ? regRoleWatch.includes('factory') : regRoleWatch === 'factory';
  const regCity = Form.useWatch('city', form);
  // 监听协议勾选状态，触发响应式更新
  const agreementChecked = Form.useWatch('agreement', form);
  // 找回密码
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotStep, setForgotStep] = useState(0); // 0=输入邮箱, 1=输入验证码, 2=设置新密码
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotPhone, setForgotPhone] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [matchedUser, setMatchedUser] = useState<{ username: string; index: number } | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // === 新设备验证状态 ===
  const [deviceVerifyVisible, setDeviceVerifyVisible] = useState(false);
  const [deviceVerifyStep, setDeviceVerifyStep] = useState(0); // 0=选择验证方式, 1=输入验证码
  const [deviceVerifyMethod, setDeviceVerifyMethod] = useState<'phone' | 'email'>('phone');
  const [deviceVerifyCode, setDeviceVerifyCode] = useState('');
  const [deviceVerifyInput, setDeviceVerifyInput] = useState('');
  const [deviceVerifyCountdown, setDeviceVerifyCountdown] = useState(0);

  // === 短信验证码登录状态 ===
  const [loginMode, setLoginMode] = useState<'account' | 'sms'>('account');
  const [smsPhone, setSmsPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [smsSending, setSmsSending] = useState(false);
  const [smsLoading, setSmsLoading] = useState(false);
  useEffect(() => {
    if (smsCountdown <= 0) return;
    const t = setTimeout(() => setSmsCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [smsCountdown]);
  const deviceCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const [pendingLoginUser, setPendingLoginUser] = useState<any>(null); // 待登录用户（等待设备验证）
  const [pendingIsViewOnly, setPendingIsViewOnly] = useState(false);

  // 页面加载时清除所有登录锁定（解决重启后账号被误锁的问题）
  useEffect(() => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('login_attempts_')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }, []);

  // 倒计时逻辑
  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => {
      if (countdownRef.current) clearTimeout(countdownRef.current);
    };
  }, [countdown]);

  // 设备验证倒计时
  useEffect(() => {
    if (deviceVerifyCountdown > 0) {
      deviceCountdownRef.current = setTimeout(() => setDeviceVerifyCountdown(deviceVerifyCountdown - 1), 1000);
    }
    return () => {
      if (deviceCountdownRef.current) clearTimeout(deviceCountdownRef.current);
    };
  }, [deviceVerifyCountdown]);

  // 完成登录（设备验证通过后调用）
  const completeLogin = useCallback((foundUser: any, isViewOnly: boolean) => {
    safeSetItem('userRole', foundUser.role);
    safeSetItem('username', foundUser.username);
    safeSetItem('isViewOnly', isViewOnly ? 'true' : 'false');
    safeSetItem('isSubAccount', foundUser.isSubAccount ? 'true' : 'false');

    // 修复子账号的 parentAccount：沿链追溯到真正的主账号
    let resolvedParent = foundUser.parentAccount || '';
    if (foundUser.isSubAccount && resolvedParent) {
      try {
        const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        let current = resolvedParent;
        const visited = new Set<string>();
        while (current && !visited.has(current)) {
          visited.add(current);
          const parent = regUsers.find((u: any) => u.username === current);
          if (!parent || !parent.isSubAccount) break; // 找到了主账号
          current = parent.parentAccount || '';
        }
        if (current && current !== resolvedParent) {
          resolvedParent = current;
          // 同步修复 registeredUsers 中的 parentAccount
          const regUsers2: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const idx = regUsers2.findIndex((u: any) => u.username === foundUser.username);
          if (idx >= 0) {
            regUsers2[idx].parentAccount = current;
            safeSetItem('registeredUsers', JSON.stringify(regUsers2));
          }
        }
      } catch { /* ignore */ }
    }
    safeSetItem('parentAccount', resolvedParent);
    safeSetItem('userRoles', JSON.stringify(foundUser.roles || []));
    safeSetItem('userCustomPermissions', JSON.stringify(foundUser.customPermissions || []));
    safeSetItem('lastActiveTime', Date.now().toString());

    if (isViewOnly) {
      message.info('您的账号已进入数据保留期，仅可查看历史数据，无法进行操作');
    }

    if (foundUser.needsPasswordChange && foundUser.isSubAccount) {
      safeSetItem('forcePasswordChange', 'true');
    }

    // 标记设备为可信
    trustDevice(foundUser.username);
    recordLoginLog(foundUser.username, true, '新设备验证通过，登录成功');

    // 登录成功后初始化 Web Push 推送订阅
    initPushNotifications();

    if (foundUser.role === 'factory' || (String(foundUser.role || '').includes('factory') && !String(foundUser.role || '').includes('supplier') && !String(foundUser.role || '').includes('purchaser'))) {
      navigate('/factory/dashboard');
    } else if (foundUser.role === 'supplier') {
      navigate('/dashboard');
    } else if (foundUser.role === 'purchaser') {
      navigate('/purchaser/dashboard');
    } else if (foundUser.role === 'both') {
      navigate('/dashboard');
      message.info('您既是供应商又是采购商，可以在后台切换视图');
    }
  }, [navigate]);

  // 发送设备验证码（服务端真实短信）
  const sendDeviceCodeRequest = useCallback(async (): Promise<boolean> => {
    const phone = String(pendingLoginUser?.phone || '').trim();
    if (!/^1\d{10}$/.test(phone)) {
      message.error('该账号未绑定有效手机号，无法进行新设备验证，请联系管理员补充手机号');
      return false;
    }
    try {
      const resp = await fetch(`${SMS_API_BASE}/sms/send-device-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await resp.json();
      if (data.code !== 0) {
        message.error(data.message || '验证码发送失败，请稍后重试');
        return false;
      }
      // 生产环境未配置短信服务：服务端返回 smsUnconfigured，回退为跳过新设备验证直接登录
      if (data.data?.smsUnconfigured) {
        if (pendingLoginUser) {
          trustDevice(pendingLoginUser.username);
          setDeviceVerifyVisible(false);
          completeLogin(pendingLoginUser, pendingIsViewOnly);
          message.warning('服务器未配置短信服务，本次已跳过新设备验证；配置阿里云短信后将自动恢复验证');
        }
        return true;
      }
      setDeviceVerifyStep(1);
      setDeviceVerifyCountdown(60);
      setDeviceVerifyInput('');
      if (data.data?.devMode && data.data?.devCode) {
        message.success(`短信服务未配置（开发模式），验证码：${data.data.devCode}`);
      } else {
        message.success('验证码已发送至账号绑定手机');
      }
      return true;
    } catch {
      message.error('网络异常，验证码发送失败，请稍后重试');
      return false;
    }
  }, [pendingLoginUser, pendingIsViewOnly, completeLogin]);

  const handleSendDeviceCode = useCallback(() => {
    sendDeviceCodeRequest();
  }, [sendDeviceCodeRequest]);

  // 验证设备验证码（服务端校验）
  const handleVerifyDeviceCode = useCallback(async () => {
    const phone = String(pendingLoginUser?.phone || '').trim();
    if (!/^\d{6}$/.test(deviceVerifyInput)) {
      message.error('请输入6位数字验证码');
      return;
    }
    try {
      const resp = await fetch(`${SMS_API_BASE}/sms/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: deviceVerifyInput }),
      });
      const data = await resp.json();
      if (data.code !== 0) {
        message.error(data.message || '验证失败，请重新输入');
        return;
      }
      if (!pendingLoginUser) return;
      setDeviceVerifyVisible(false);
      completeLogin(pendingLoginUser, pendingIsViewOnly);
      message.success('设备验证通过，已信任此设备');
    } catch {
      message.error('网络异常，验证失败，请稍后重试');
    }
  }, [deviceVerifyInput, pendingLoginUser, pendingIsViewOnly, completeLogin]);

  // 重新发送设备验证码
  const handleResendDeviceCode = useCallback(() => {
    sendDeviceCodeRequest();
  }, [sendDeviceCodeRequest]);

  // 打开找回密码弹窗
  const openForgotModal = () => {
    forgotForm.resetFields();
    setForgotStep(0);
    setForgotPhone('');
    setInputCode('');
    setCountdown(0);
    setMatchedUser(null);
    setNewPwd('');
    setConfirmPwd('');
    setForgotVisible(true);
  };

  // 关闭找回密码弹窗
  const closeForgotModal = () => {
    setForgotVisible(false);
    setForgotStep(0);
    setForgotPhone('');
    setInputCode('');
    setCountdown(0);
    setMatchedUser(null);
    setNewPwd('');
    setConfirmPwd('');
    forgotForm.resetFields();
  };

  // 清理过期超过6个月的用户数据
  const cleanupExpiredUsers = () => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const now = dayjs();
    const validUsers = registeredUsers.filter((u: any) => {
      const trialEnd = u.trialEndDate ? dayjs(u.trialEndDate) : null;
      if (!trialEnd) return true; // 无试用期记录的保留
      const monthsSinceTrialEnd = now.diff(trialEnd, 'month');
      return monthsSinceTrialEnd <= 6; // 只保留6个月内的
    });
    if (validUsers.length !== registeredUsers.length) {
      safeSetItem('registeredUsers', JSON.stringify(validUsers));
    }
  };

  // 检查公司编号是否已被占用
  const isCompanyNoTaken = (no: string): boolean => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return registeredUsers.some(
      (u: any) => u.companyNo && String(u.companyNo) === String(no)
    );
  };

  // 随机生成一个未被占用的公司编号：8位字母+数字组合，排除包含'4'的组合
  const generateUniqueCompanyNo = (): string => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const usedNos = new Set(registeredUsers.map((u: any) => String(u.companyNo || '')).filter(Boolean));
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '012356789'; // 排除数字'4'
    for (let i = 0; i < 2000; i++) {
      const chars: string[] = [];
      for (let j = 0; j < 4; j++) chars.push(letters[Math.floor(Math.random() * letters.length)]);
      for (let j = 0; j < 4; j++) chars.push(digits[Math.floor(Math.random() * digits.length)]);
      // 洗牌打乱字母数字位置
      for (let j = chars.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [chars[j], chars[k]] = [chars[k], chars[j]];
      }
      const no = chars.join('');
      if (no.includes('4')) continue; // 排除包含'4'的组合
      if (!usedNos.has(no)) return no;
    }
    // 兏底：字母+时间戳（同样剔除'4'）
    return ('AB' + String(Date.now()).slice(-6)).replace(/4/g, '8');
  };
  
  // 随机生成公司编号按钮处理
  const handleRandomCompanyNo = () => {
    const newNo = generateUniqueCompanyNo();
    form.setFieldValue('companyNo', newNo);
    // 手动触发校验，清除重复提示
    form.validateFields(['companyNo']);
  };
  
  // 检查订单号前缀是否已被占用
  const isOrderPrefixTaken = (p: string): boolean => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return registeredUsers.some(
      (u: any) => u.orderPrefix && String(u.orderPrefix) === String(p)
    );
  };
  
  // 跳过包含'4'的数值
  const skipFour = (n: number): number => {
    let x = n;
    while (String(x).includes('4')) x++;
    return x;
  };
  
  // 生成订单号前缀：按注册顺序递增，3位起、上限6位；超过6位后前加1个字母再循环递增；排除含'4'
  const generateNextOrderPrefix = (): string => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const prefixes: string[] = registeredUsers.map((u: any) => String(u.orderPrefix || '')).filter(Boolean);
    const used = new Set(prefixes);
    // 纯数字代：从已有最大纯数字前缀+1 继续递增
    const nums = prefixes.filter(p => /^\d+$/.test(p)).map(p => parseInt(p, 10));
    let next = skipFour(nums.length ? Math.max(...nums) + 1 : 100);
    while (next <= 999999 && used.has(String(next))) next = skipFour(next + 1);
    if (next <= 999999) return String(next);
    // 字母代：A-Z 前缀 + 3~6 位数字循环递增
    for (let ci = 0; ci < 26; ci++) {
      const letter = String.fromCharCode(65 + ci);
      const lnums = prefixes
        .filter(p => p.length > 1 && p[0] === letter && /^\d+$/.test(p.slice(1)))
        .map(p => parseInt(p.slice(1), 10));
      let n = skipFour(lnums.length ? Math.max(...lnums) + 1 : 100);
      while (n <= 999999 && used.has(letter + n)) n = skipFour(n + 1);
      if (n <= 999999) return letter + n;
    }
    // 兏底
    return 'A' + String(Date.now()).slice(-6).replace(/4/g, '8');
  };
  
  // 随机生成订单号前缀按钮处理（重复时点击继续生成）
  const handleRandomOrderPrefix = () => {
    form.setFieldValue('orderPrefix', generateNextOrderPrefix());
    form.validateFields(['orderPrefix']);
  };

  // 命中用户后的公共处理（账号密码登录与短信验证码登录共用）
  const proceedWithUser = (foundUser: any) => {
    // 检查账号是否被禁用
    if (foundUser.accountStatus === 'disabled') {
      message.error('该账号已被禁用，请联系管理员');
      setLoading(false);
      return;
    }

    // === 登录成功：清除失败记录 ===
    clearLoginAttempts(foundUser.username);
    recordLoginLog(foundUser.username, true);

    // 更新账号管理中的最近登录时间
    try {
      const isSub = foundUser.isSubAccount;
      let owner = foundUser.username;
      if (isSub) {
        // 子账号解析到主账号
        const regAll: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        let cur = foundUser.parentAccount || foundUser.username;
        const visited = new Set<string>();
        while (cur && !visited.has(cur)) {
          visited.add(cur);
          const p = regAll.find((u: any) => u.username === cur);
          if (!p || !p.isSubAccount) break;
          cur = p.parentAccount || '';
        }
        owner = cur || foundUser.username;
      }
      const storageKey = 'accounts_' + owner;
      const accounts: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const accIdx = accounts.findIndex((a: any) => a.username === foundUser.username);
      if (accIdx >= 0) {
        accounts[accIdx].lastLogin = new Date().toISOString().split('T')[0];
        safeSetItem(storageKey, JSON.stringify(accounts));
      }
    } catch { /* ignore */ }

    // 判断账号状态
    const trialEnd = foundUser.trialEndDate ? dayjs(foundUser.trialEndDate) : null;
    const authEnd = foundUser.authorizedUntil ? dayjs(foundUser.authorizedUntil) : null;
    const now = dayjs();

    // 判断是否已过期（试用期结束且超过6个月）
    let isExpired = false;
    let isViewOnly = false;
    if (trialEnd && trialEnd.isBefore(now, 'day')) {
      const monthsSinceTrialEnd = now.diff(trialEnd, 'month');
      if (monthsSinceTrialEnd > 6) {
        isExpired = true;
      } else {
        isViewOnly = true;
      }
    }
    // 授权期限判断：如果 authorizedUntil 在未来，覆盖 isViewOnly
    if (authEnd && authEnd.isAfter(now, 'day')) {
      isViewOnly = false;
    } else if (authEnd && authEnd.isBefore(now, 'day')) {
      isViewOnly = true;
    }

    // 采购商平台免费使用：纯采购商账号不受订购/到期限制，不进入只读模式
    const loginRoleStr = String(foundUser.role || '');
    if (loginRoleStr.includes('purchaser') && !loginRoleStr.includes('supplier')) {
      isViewOnly = false;
    }

    // 免费期：所有注册账号不限使用时间，到期/试用过期不触发只读或拦截
    if (FREE_PERIOD) {
      isExpired = false;
      isViewOnly = false;
    }

    if (isExpired) {
      message.error('账号已过期超过6个月，相关数据已清理，请联系管理员');
      setLoading(false);
      return;
    }

    message.success(`登录成功！欢迎回来，${foundUser.name}`);

    // === 安全检查：新设备验证 ===
    if (!isTrustedDevice(foundUser.username)) {
      // 新设备，需要验证
      setPendingLoginUser(foundUser);
      setPendingIsViewOnly(isViewOnly);
      setDeviceVerifyStep(0);
      setDeviceVerifyMethod('phone');
      setDeviceVerifyCode('');
      setDeviceVerifyInput('');
      setDeviceVerifyCountdown(0);
      setDeviceVerifyVisible(true);
      recordLoginLog(foundUser.username, true, '新设备登录，等待验证');
      setLoading(false);
      return;
    }

    // 可信设备，直接登录
    safeSetItem('userRole', foundUser.role);
    safeSetItem('username', foundUser.username);
    safeSetItem('isViewOnly', isViewOnly ? 'true' : 'false');
    safeSetItem('isSubAccount', foundUser.isSubAccount ? 'true' : 'false');

    // 修复子账号的 parentAccount：沿链追溯到真正的主账号
    let resolvedParent2 = foundUser.parentAccount || '';
    if (foundUser.isSubAccount && resolvedParent2) {
      try {
        const regU: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        let cur = resolvedParent2;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          seen.add(cur);
          const p = regU.find((u: any) => u.username === cur);
          if (!p || !p.isSubAccount) break;
          cur = p.parentAccount || '';
        }
        if (cur && cur !== resolvedParent2) {
          resolvedParent2 = cur;
          const regU2: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const idx2 = regU2.findIndex((u: any) => u.username === foundUser.username);
          if (idx2 >= 0) {
            regU2[idx2].parentAccount = cur;
            safeSetItem('registeredUsers', JSON.stringify(regU2));
          }
        }
      } catch { /* ignore */ }
    }
    safeSetItem('parentAccount', resolvedParent2);
    safeSetItem('userRoles', JSON.stringify(foundUser.roles || []));
    safeSetItem('userCustomPermissions', JSON.stringify(foundUser.customPermissions || []));
    safeSetItem('lastActiveTime', Date.now().toString());

    if (isViewOnly) {
      message.info('您的账号已进入数据保留期，仅可查看历史数据，无法进行操作');
    }

    if (foundUser.needsPasswordChange && foundUser.isSubAccount) {
      safeSetItem('forcePasswordChange', 'true');
    }

    if (foundUser.role === 'factory' || (String(foundUser.role || '').includes('factory') && !String(foundUser.role || '').includes('supplier') && !String(foundUser.role || '').includes('purchaser'))) {
      navigate('/factory/dashboard');
    } else if (foundUser.role === 'supplier') {
      navigate('/dashboard');
    } else if (foundUser.role === 'purchaser') {
      navigate('/purchaser/dashboard');
    } else if (foundUser.role === 'both') {
      navigate('/dashboard');
      message.info('您既是供应商又是采购商，可以在后台切换视图');
    }
  };

  // 登录处理
  const handleLogin = async () => {
    try {
      await form.validateFields();
      setLoading(true);

      // 模拟登录请求
      setTimeout(async () => {
        const username = form.getFieldValue('username');
        const password = form.getFieldValue('password');

        // === 安全检查：账号是否被锁定 ===
        const lockCheck = isAccountLocked(username);
        if (lockCheck.locked) {
          message.error(`该账号因多次输入错误密码已被锁定，请 ${lockCheck.remainingMinutes} 分钟后再试`);
          recordLoginLog(username, false, `账号被锁定（剩余${lockCheck.remainingMinutes}分钟）`);
          setLoading(false);
          return;
        }

        let foundUser: any = null;
        let userSource: 'mock' | 'registered' = 'mock';

        // 先在 mockUsers 中查找
        const mockUser = mockUsers.find(u => u.username === username && u.password === password);
        if (mockUser) {
          // 手机号透传：mock 分支也须从 registeredUsers 补齐 phone，否则新设备验证取不到绑定手机号
          let mockPhone = '';
          try {
            const ruForPhone: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            mockPhone = String(ruForPhone.find((u: any) => u.username === mockUser.username)?.phone || '');
          } catch { /* ignore */ }
          foundUser = {
            username: mockUser.username,
            password: mockUser.password,
            role: mockUser.role,
            name: mockUser.name,
            email: '',
            phone: mockPhone,
            trialEndDate: '',
            authorizedUntil: '',
            isSubAccount: false,
            parentAccount: '',
            roles: [],
            needsPasswordChange: false,
          };
          userSource = 'mock';
          // 确保 mock 用户也在 registeredUsers 中，以便 getUserInfo 能正确显示公司名
          try {
            const regUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            if (!regUsers.some((u: any) => u.username === mockUser.username)) {
              regUsers.push({
                username: mockUser.username,
                password: mockUser.password,
                role: mockUser.role,
                companyName: mockUser.name,
                contactPerson: mockUser.name,
                companyNo: `MOCK${String(Date.now()).slice(-4)}`,
                companyShortName: mockUser.name,
                orderPrefix: '0000',
                status: '已审核',
                trialEndDate: '',
                authorizedUntil: '',
                registerDate: new Date().toISOString().split('T')[0],
              });
              safeSetItem('registeredUsers', JSON.stringify(regUsers));
            }
          } catch { /* ignore */ }
        }

        // 跨浏览器登录：本地未找到时先从服务器拉取账号并集合并到本地，再走本地查找
        {
          const localPre: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          if (!localPre.some((u: any) => u.username === username && u.password === password)) {
            try {
              const rec = await fetchServerDataset('registeredUsers');
              if (rec) {
                const serverUsers = JSON.parse(rec.json);
                if (Array.isArray(serverUsers)) {
                  let changed = false;
                  serverUsers.forEach((su: any) => {
                    if (!su || !su.username) return;
                    const localIdx = localPre.findIndex((u: any) => u.username === su.username);
                    if (localIdx < 0) {
                      // 本地不存在，新增
                      localPre.push(su);
                      changed = true;
                    } else if (su.password === password && localPre[localIdx].password !== password) {
                      // 本地存在但密码不匹配，用服务器版本更新（密码变更同步）
                      localPre[localIdx] = { ...localPre[localIdx], ...su };
                      changed = true;
                    }
                  });
                  if (changed) safeSetItem('registeredUsers', JSON.stringify(localPre));
                }
              }
            } catch { /* 服务器不可用时保持纯本地登录 */ }
          }
        }

        // 手机号登录：输入为 11 位手机号时按手机号反查账号；同一号码绑定多个账号（跨租户/跨子账号）时拒绝登录并显示原因
        let loginName = username;
        if (!foundUser && /^1[3-9]\d{9}$/.test(String(username).trim())) {
          const phone = String(username).trim();
          let regForPhone: any[] = [];
          try { regForPhone = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { regForPhone = []; }
          const phoneHits = regForPhone.filter((u: any) => String(u.phone || '').trim() === phone);
          if (phoneHits.length > 1) {
            const tenants = phoneHits.filter((h: any) => !h.isSubAccount).length;
            const subs = phoneHits.length - tenants;
            message.error(`无法使用手机号登录：该号码同时绑定 ${phoneHits.length} 个账号（租户主账号 ${tenants} 个、子账号 ${subs} 个），号码不唯一，请使用对应账号的用户名登录。`);
            recordLoginLog(username, false, `手机号登录被拒绝：号码绑定 ${phoneHits.length} 个账号`);
            setLoading(false);
            return;
          }
          if (phoneHits.length === 1) loginName = phoneHits[0].username;
        }

        // 如果没找到，再从 localStorage 的 registeredUsers 中查找
        if (!foundUser) {
          const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const found = registeredUsers.find((u: any) => u.username === loginName && u.password === password);
          if (found) {
            let role = found.role;
            if (role === 'supplier,purchaser' || role === 'purchaser,supplier') {
              role = 'both';
            }
            foundUser = {
              username: found.username,
              password: found.password,
              role,
              name: found.companyName || found.contactPerson || found.username,
              email: found.email || '',
              phone: found.phone || '',
              trialEndDate: found.trialEndDate || '',
              authorizedUntil: found.authorizedUntil || '',
              isSubAccount: found.isSubAccount || false,
              parentAccount: found.parentAccount || '',
              roles: found.roles || [],
              needsPasswordChange: found.needsPasswordChange || false,
              accountStatus: found.accountStatus || 'normal',
            };
            userSource = 'registered';
          }
        }

        if (foundUser) {
          proceedWithUser(foundUser);
        } else {
          // === 登录失败：记录失败次数 ===
          const failCount = recordLoginFailure(username);
          const remaining = MAX_LOGIN_ATTEMPTS - failCount;
          recordLoginLog(username, false, `密码错误（第${failCount}次）`);
          if (remaining <= 0) {
            message.error(`密码错误次数已达${MAX_LOGIN_ATTEMPTS}次，账号已被锁定${LOCK_DURATION_MINUTES}分钟`);
          } else if (remaining <= 2) {
            message.warning(`账号或密码错误，还剩 ${remaining} 次机会，超过后账号将被锁定${LOCK_DURATION_MINUTES}分钟`);
          } else {
            message.error(`账号或密码错误（还剩 ${remaining} 次机会）`);
          }
        }

        setLoading(false);
      }, 1500);
    } catch (error) {
      message.error('请检查登录信息');
    }
  };

  // 短信登录：获取验证码（服务端经阿里云短信下发；未配置时为开发模式回显）
  const handleSendSmsCode = async () => {
    const phone = (smsPhone || '').trim();
    if (!/^1\d{10}$/.test(phone)) { message.warning('请输入正确的11位手机号'); return; }
    setSmsSending(true);
    try {
      const res = await fetch(`${SMS_API_BASE}/sms/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, scene: 'login' }),
      });
      const j = await res.json();
      if (j.code === 0) {
        setSmsCountdown(60);
        if (j.data?.devMode) {
          message.info(`短信服务未配置（开发模式），验证码：${j.data.devCode}`);
          setSmsCode(String(j.data.devCode));
        } else {
          message.success('验证码已发送，请查收短信');
        }
      } else {
        message.error(j.message || '验证码发送失败');
      }
    } catch {
      message.error('无法连接服务器，请检查服务是否启动');
    }
    setSmsSending(false);
  };

  // 短信登录：校验验证码并登录
  const handleSmsLogin = async () => {
    const phone = (smsPhone || '').trim();
    if (!/^1\d{10}$/.test(phone)) { message.warning('请输入正确的11位手机号'); return; }
    if (!/^\d{6}$/.test((smsCode || '').trim())) { message.warning('请输入6位短信验证码'); return; }
    setSmsLoading(true);
    try {
      const res = await fetch(`${SMS_API_BASE}/sms/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: (smsCode || '').trim() }),
      });
      const j = await res.json();
      if (j.code !== 0) { message.error(j.message || '登录失败'); setSmsLoading(false); return; }
      const username = j.data?.username;
      // 与账号密码登录同口径：先合并服务器账号再本地查找
      const local: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      if (!local.some((u: any) => u.username === username)) {
        try {
          const rec = await fetchServerDataset('registeredUsers');
          if (rec) {
            const serverUsers = JSON.parse(rec.json);
            if (Array.isArray(serverUsers)) {
              let changed = false;
              serverUsers.forEach((su: any) => {
                if (su && su.username && !local.some((u: any) => u.username === su.username)) { local.push(su); changed = true; }
              });
              if (changed) safeSetItem('registeredUsers', JSON.stringify(local));
            }
          }
        } catch { /* 服务器不可用时保持纯本地 */ }
      }
      const found = local.find((u: any) => u.username === username);
      if (!found) {
        message.error('未找到该手机号对应的本地账号，请先用账号密码登录一次同步数据');
        setSmsLoading(false);
        return;
      }
      let role = found.role;
      if (role === 'supplier,purchaser' || role === 'purchaser,supplier') role = 'both';
      const foundUser = {
        username: found.username,
        password: found.password || '',
        role,
        name: found.companyName || found.contactPerson || found.username,
        email: found.email || '',
        phone: found.phone || phone,
        trialEndDate: found.trialEndDate || '',
        authorizedUntil: found.authorizedUntil || '',
        isSubAccount: found.isSubAccount || false,
        parentAccount: found.parentAccount || '',
        roles: found.roles || [],
        needsPasswordChange: found.needsPasswordChange || false,
        accountStatus: found.accountStatus || 'normal',
      };
      proceedWithUser(foundUser);
    } catch {
      message.error('无法连接服务器，请检查服务是否启动');
    }
    setSmsLoading(false);
  };

  // 找回密码 - 步骤0：发送验证码（服务端真实短信，账号+绑定手机号校验）
  const handleSendCode = async () => {
    try {
      await forgotForm.validateFields(['forgotUsername', 'forgotPhone']);
    } catch (error) {
      message.error('请填写账号和手机号');
      return;
    }
    const username = forgotForm.getFieldValue('forgotUsername').trim();
    const phone = forgotForm.getFieldValue('forgotPhone').trim();
    setForgotLoading(true);
    try {
      // 与登录同口径：先合并服务器账号并集，再本地查找（新电脑本地可能无账号数据）
      const registeredUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      if (!registeredUsers.some((u: any) => u.username === username)) {
        try {
          const rec = await fetchServerDataset('registeredUsers');
          if (rec) {
            const serverUsers = JSON.parse(rec.json);
            if (Array.isArray(serverUsers)) {
              let changed = false;
              serverUsers.forEach((su: any) => {
                if (su && su.username && !registeredUsers.some((u: any) => u.username === su.username)) { registeredUsers.push(su); changed = true; }
              });
              if (changed) safeSetItem('registeredUsers', JSON.stringify(registeredUsers));
            }
          }
        } catch { /* 服务器不可用时保持纯本地 */ }
      }
      const idx = registeredUsers.findIndex(
        (u: any) => u.username === username && String(u.phone || '').trim() === phone
      );
      if (idx < 0) {
        message.error('账号与手机号不匹配，请检查后重试');
        setForgotLoading(false);
        return;
      }
      const resp = await fetch(`${SMS_API_BASE}/sms/send-device-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await resp.json();
      if (data.code !== 0) {
        message.error(data.message || '验证码发送失败，请稍后重试');
        setForgotLoading(false);
        return;
      }
      const matched = registeredUsers[idx];
      setForgotPhone(phone);
      setMatchedUser({ username: matched.username, index: idx });
      setCountdown(60);
      setInputCode('');
      setForgotLoading(false);
      setForgotStep(1);
      if (data.data?.devMode && data.data?.devCode) {
        message.info(`短信服务未配置（开发模式），验证码：${data.data.devCode}`);
      } else {
        message.success('验证码已发送至您的手机');
      }
    } catch {
      message.error('无法连接服务器，请稍后重试');
      setForgotLoading(false);
    }
  };

  // 重新发送验证码（服务端真实短信）
  const handleResendCode = async () => {
    if (!/^1\d{10}$/.test(forgotPhone)) { message.error('缺少手机号，请返回上一步重新填写'); return; }
    try {
      const resp = await fetch(`${SMS_API_BASE}/sms/send-device-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: forgotPhone }),
      });
      const data = await resp.json();
      if (data.code !== 0) { message.error(data.message || '验证码发送失败，请稍后重试'); return; }
      setInputCode('');
      setCountdown(60);
      if (data.data?.devMode && data.data?.devCode) {
        message.info(`短信服务未配置（开发模式），验证码：${data.data.devCode}`);
      } else {
        message.success('验证码已重新发送');
      }
    } catch {
      message.error('无法连接服务器，请稍后重试');
    }
  };

  // 找回密码 - 步骤1：验证验证码（服务端校验）
  const handleVerifyCode = async () => {
    if (!/^\d{6}$/.test(inputCode.trim())) {
      message.warning('请输入6位数字验证码');
      return;
    }
    try {
      const resp = await fetch(`${SMS_API_BASE}/sms/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: forgotPhone, code: inputCode.trim() }),
      });
      const data = await resp.json();
      if (data.code !== 0) {
        message.error(data.message || '验证码错误，请重新输入');
        return;
      }
      message.success('验证成功，请设置新密码');
      setForgotStep(2);
    } catch {
      message.error('无法连接服务器，请稍后重试');
    }
  };

  // 找回密码 - 步骤2：重置密码
  const handleResetPassword = () => {
    if (!newPwd.trim()) {
      message.warning('请输入新密码');
      return;
    }
    if (newPwd.length < 6) {
      message.warning('密码长度不能少于6位');
      return;
    }
    if (!/^(?=.*[a-zA-Z])(?=.*\d)/.test(newPwd)) {
      message.warning('密码必须包含字母和数字');
      return;
    }
    if (newPwd !== confirmPwd) {
      message.warning('两次输入的密码不一致');
      return;
    }
    if (!matchedUser) return;

    setForgotLoading(true);
    setTimeout(() => {
      // 更新 localStorage 中的密码
      const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      registeredUsers[matchedUser.index].password = newPwd;
      safeSetItem('registeredUsers', JSON.stringify(registeredUsers));

      // 同时更新 mockUsers
      const mockUser = mockUsers.find(u => u.username === matchedUser.username);
      if (mockUser) {
        mockUser.password = newPwd;
      }

      setForgotLoading(false);
      message.success('密码重置成功，请使用新密码登录');
      closeForgotModal();
    }, 1000);
  };

  // 注册步骤1：填写基本信息
  const handleRegisterStep1 = async () => {
    try {
      await form.validateFields(['companyName', 'companyNo', 'orderPrefix', 'contactPerson', 'phone', 'email', 'role', 'province', 'city', 'district', 'addressDetail']);
      setRegisterStep(1);
    } catch (error) {
      message.warning('请完善基本信息');
    }
  };

  // 注册步骤2：设置登录账号
  const handleRegisterStep2 = async () => {
    try {
      await form.validateFields(['username', 'password', 'confirmPassword']);
      setRegisterStep(2);
    } catch (error) {
      message.warning('请设置登录账号');
    }
  };

  // 提交注册
  const handleRegisterSubmit = async () => {
    try {
      await form.validateFields();
      setLoading(true);
      
      // 模拟注册请求
      setTimeout(() => {
        const username = form.getFieldValue('username');
        const role = form.getFieldValue('role');
        const password = form.getFieldValue('password');
        
        // 计算30天后试用期截止日期
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 30);
        const trialEndStr = trialEnd.toISOString().split('T')[0];
        
        // 生成公司ID：公司编号 + '-' + 4位随机大写字母数字
        const companyNo = String(form.getFieldValue('companyNo') || '');
        const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const companyId = `${companyNo}-${randomSuffix}`;
        
        // 最终重复检查：防止注册过程中其他用户抢占了同一公司编号
        if (isCompanyNoTaken(companyNo)) {
          message.error('该公司编号在您填写过程中已被其他用户占用，请重新生成后提交');
          setLoading(false);
          return;
        }

        // 订单号前缀最终重复检查：重复则提示点击随机重新生成
        const orderPrefix = String(form.getFieldValue('orderPrefix') || '');
        if (isOrderPrefixTaken(orderPrefix)) {
          message.error('该订单号前缀已被其他用户占用，请点击随机重新生成后提交');
          setLoading(false);
          return;
        }
        
        // 将注册信息保存到 localStorage（模拟数据库）
        const newUser = {
          username,
          password,
          role: Array.isArray(role) ? role.join(',') : role,
          companyName: form.getFieldValue('companyName'),
          companyNo,                 // 公司编号（8位字母+数字，唯一）
          companyShortName: companyNo, // 兼容旧字段（公司英文简称→公司编号）
          orderPrefix,               // 订单号前缀（按注册顺序递增，唯一）
          companyId,               // 公司唯一ID
          contactPerson: form.getFieldValue('contactPerson'),
          phone: form.getFieldValue('phone'),
          email: form.getFieldValue('email'),
          province: form.getFieldValue('province') || '',
          city: form.getFieldValue('city') || '',
          district: form.getFieldValue('district') || '',
          addressDetail: form.getFieldValue('addressDetail') || '',
          registerDate: new Date().toISOString().split('T')[0],
          status: '已审核',
          trialEndDate: trialEndStr,
          authorizedUntil: trialEndStr,
          // 加工厂角色：保存注册时填写的工序类型
          ...((Array.isArray(role) ? role.includes('factory') : role === 'factory') ? { processTypes: form.getFieldValue('processTypes') || [] } : {}),
        };
        
        // 读取已有用户数据
        const existingUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        // 检查用户名是否已存在
        if (existingUsers.some((u: any) => u.username === username)) {
          message.error('该账号已存在，请使用其他账号');
          setLoading(false);
          return;
        }
        existingUsers.push(newUser);
        safeSetItem('registeredUsers', JSON.stringify(existingUsers));
        // 立即上传账号到服务器，保证其他浏览器可登录（后端不可用时静默忽略）
        flushDatasetUpload('registeredUsers', JSON.stringify(existingUsers));
        
        // 同时添加到 mockUsers 以便登录（实际项目中不需要，这里只是演示）
        mockUsers.push({
          username,
          password,
          role: Array.isArray(role) ? (role.includes('supplier') && role.includes('purchaser') ? 'both' : role[0]) : role,
          name: form.getFieldValue('companyName'),
        });
        
        setRegisteredAccount(username);
        setRegisterSuccess(true);
        setLoading(false);
        message.success('注册成功！');
      }, 1500);
    } catch (error) {
      message.error('请检查表单信息');
    }
  };

  // 注册成功后的操作
  const handleGoLogin = () => {
    setActiveTab('login');
    setRegisterSuccess(false);
    setRegisterStep(0);
    form.resetFields();
  };

  // 渲染登录表单
  const renderLoginForm = () => (
    <>
      <Radio.Group value={loginMode} onChange={e => setLoginMode(e.target.value)} style={{ marginBottom: 16, width: '100%' }} buttonStyle="solid">
        <Radio.Button value="account" style={{ width: '50%', textAlign: 'center' }}>账号密码登录</Radio.Button>
        <Radio.Button value="sms" style={{ width: '50%', textAlign: 'center' }}>手机验证码登录</Radio.Button>
      </Radio.Group>
      {loginMode === 'account' ? (
      <Form form={form} layout="vertical" size="large">
        <Form.Item
          name="username"
          rules={[{ required: true, message: '请输入登录账号' }]}
        >
          <Input 
            prefix={<UserOutlined />} 
            placeholder="请输入登录账号/手机号码" 
          />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[{ required: true, message: '请输入登录密码' }]}
        >
          <Input.Password 
            prefix={<LockOutlined />} 
            placeholder="请输入登录密码" 
          />
        </Form.Item>

        <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 16 }}>
          <a 
            onClick={openForgotModal}
            style={{ fontSize: 13, color: PRIMARY }}
          >
            忘记密码？
          </a>
        </div>

        <Form.Item>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            block
            onClick={handleLogin}
            style={{ 
              background: PRIMARY, 
              borderColor: PRIMARY,
              height: 44,
              fontSize: 16,
            }}
          >
            登录
          </Button>
        </Form.Item>
      </Form>
      ) : (
        <Form layout="vertical" size="large">
          <Form.Item>
            <Input
              prefix={<MobileOutlined />}
              placeholder="请输入注册时绑定的手机号"
              value={smsPhone}
              onChange={e => setSmsPhone(e.target.value)}
              maxLength={11}
            />
          </Form.Item>
          <Form.Item>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                prefix={<SafetyCertificateOutlined />}
                placeholder="请输入6位短信验证码"
                value={smsCode}
                onChange={e => setSmsCode(e.target.value)}
                maxLength={6}
                onPressEnter={handleSmsLogin}
              />
              <Button disabled={smsCountdown > 0} loading={smsSending} onClick={handleSendSmsCode} style={{ width: 130 }}>
                {smsCountdown > 0 ? `${smsCountdown}s 后重发` : '获取验证码'}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              loading={smsLoading}
              block
              onClick={handleSmsLogin}
              style={{ background: PRIMARY, borderColor: PRIMARY, height: 44, fontSize: 16 }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      )}
    </>
  );

  // 渲染注册表单
  const renderRegisterForm = () => {
    if (registerSuccess) {
      return (
        <Result
          status="success"
          title="注册成功！"
          subTitle={(() => {
                            const r = form.getFieldValue('role');
                            const roleStr = Array.isArray(r) ? (r.includes('supplier') && r.includes('purchaser') ? 'both' : r[0]) : r;
                            return `您的账号 ${registeredAccount} 已创建成功，角色为：${roleStr === 'both' ? '供应商兼采购商' : roleStr === 'supplier' ? '供应商' : roleStr === 'factory' ? '加工厂' : '采购商'}`;
                          })()}
          extra={[
            <Button type="primary" key="login" onClick={handleGoLogin} style={{ background: PRIMARY, borderColor: PRIMARY }}>
              立即登录
            </Button>,
          ]}
        >
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '12px 16px', marginTop: 16 }}>
            <Text style={{ color: '#389e0d', fontSize: 13 }}>
              <InfoCircleOutlined style={{ marginRight: 8 }} />
              提示：注册成功后，您可以使用该账号登录系统。如果您选择的是"供应商兼采购商"，登录后将同时拥有供应商和采购商的权限。
            </Text>
          </div>
        </Result>
      );
    }

    return (
      <>
        {/* 步骤条 */}
        <Steps
          current={registerStep}
          items={[
            { title: '基本信息', description: '填写公司信息' },
            { title: '设置账号', description: '创建登录账号' },
            { title: '完成注册', description: '确认并提交' },
          ]}
          style={{ marginBottom: 32 }}
        />

        <Form form={form} layout="vertical" size="large">
          {/* 步骤1：基本信息 */}
          {registerStep === 0 && (
            <>
              <Form.Item
                name="role"
                label="注册角色"
                rules={[{ required: true, message: '请选择注册角色' }]}
                extra="选择您的身份，可以选择多个"
              >
                <Select placeholder="请选择角色" mode="multiple">
                  <Select.Option value="supplier">供应商</Select.Option>
                  <Select.Option value="purchaser">采购商</Select.Option>
                  <Select.Option value="factory">加工厂</Select.Option>
                </Select>
              </Form.Item>

              {regIsFactory && (
                <Form.Item
                  name="processTypes"
                  label="工序类型"
                  extra="选择加工厂角色时填写：该加工厂可承接的工序类型"
                >
                  <Select mode="multiple" placeholder="请选择工序类型" options={PROCESS_TYPE_OPTIONS} allowClear />
                </Form.Item>
              )}

              <Form.Item
                name="companyName"
                label="公司名称"
                rules={[{ required: true, message: '请输入公司名称' }]}
              >
                <Input prefix={<BankOutlined />} placeholder="请输入公司全称" />
              </Form.Item>

              <Form.Item
                name="companyNo"
                label="公司编号"
                rules={[
                  { required: true, message: '请输入公司编号' },
                  { pattern: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8}$/, message: '公司编号为8位字母+数字组合' },
                  () => ({
                    validator(_, value) {
                      if (!value) return Promise.resolve();
                      if (String(value).includes('4')) {
                        return Promise.reject(new Error('公司编号不能包含数字“4”，请点击随机重新生成'));
                      }
                      if (isCompanyNoTaken(value)) {
                        return Promise.reject(new Error('该公司编号已被其他公司占用，请点击随机重新生成'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
                extra="公司编号为8位字母+数字组合（不含“4”），不可重复，注册后不可修改"
                validateTrigger={['onBlur', 'onChange']}
              >
                <Input
                  prefix={<BankOutlined />}
                  placeholder="如：AB12CD35"
                  maxLength={8}
                  suffix={
                    <Button
                      type="link"
                      size="small"
                      icon={<SyncOutlined />}
                      onClick={handleRandomCompanyNo}
                      style={{ padding: '0 4px', fontSize: 12, color: PRIMARY }}
                      title="随机生成一个可用的公司编号"
                    >
                      随机
                    </Button>
                  }
                  onChange={(e) => {
                    // 只允许字母+数字输入，统一转大写
                    const val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                    form.setFieldValue('companyNo', val);
                  }}
                />
              </Form.Item>

              <Form.Item
                name="orderPrefix"
                label="订单号前缀"
                rules={[
                  { required: true, message: '请输入订单号前缀' },
                  { pattern: /^[A-Z]?\d{3,6}$/, message: '前缀为3~6位数字（超过6位后为1个字母+数字）' },
                  () => ({
                    validator(_, value) {
                      if (!value) return Promise.resolve();
                      if (String(value).includes('4')) {
                        return Promise.reject(new Error('订单号前缀不能包含数字“4”，请点击随机重新生成'));
                      }
                      if (isOrderPrefixTaken(value)) {
                        return Promise.reject(new Error('该前缀已被其他用户占用，请点击随机重新生成'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
                extra="默认按注册顺序递增生成（不含“4”），每个用户不可重复"
                validateTrigger={['onBlur', 'onChange']}
              >
                <Input
                  prefix={<TagOutlined />}
                  placeholder="如：100"
                  maxLength={7}
                  suffix={
                    <Button
                      type="link"
                      size="small"
                      icon={<SyncOutlined />}
                      onClick={handleRandomOrderPrefix}
                      style={{ padding: '0 4px', fontSize: 12, color: PRIMARY }}
                      title="重复时点击继续生成"
                    >
                      随机
                    </Button>
                  }
                  onChange={(e) => {
                    // 只允许字母+数字输入，统一转大写
                    const val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                    form.setFieldValue('orderPrefix', val);
                  }}
                />
              </Form.Item>

              <Form.Item
                name="contactPerson"
                label="联系人"
                rules={[{ required: true, message: '请输入联系人姓名' }]}
              >
                <Input prefix={<UserAddOutlined />} placeholder="请输入联系人姓名" />
              </Form.Item>

              <Form.Item
                name="phone"
                label="联系电话"
                rules={[
                  { required: true, message: '请输入联系电话' },
                  { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
                ]}
              >
                <Input prefix={<PhoneOutlined />} placeholder="请输入手机号码" />
              </Form.Item>

              <Form.Item
                name="email"
                label="电子邮箱"
                rules={[
                  { required: true, message: '请输入电子邮箱' },
                  { type: 'email', message: '请输入正确的邮箱格式' },
                ]}
              >
                <Input prefix={<MailOutlined />} placeholder="请输入电子邮箱" />
              </Form.Item>

              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="province" label="省份" style={{ width: '33%', marginRight: 4 }}>
                  <Select placeholder="选择省份" allowClear showSearch options={getProvinceOptions()}
                    onChange={() => form.setFieldsValue({ city: undefined, district: undefined })} />
                </Form.Item>
                <Form.Item name="city" label="城市" style={{ width: '33%', marginRight: 4 }}>
                  <Select placeholder="选择城市" allowClear showSearch options={getCityOptions(regProvince)}
                    onChange={() => form.setFieldsValue({ district: undefined })} />
                </Form.Item>
                <Form.Item name="district" label="区/县" style={{ width: '34%' }}>
                  <Select placeholder="选择区/县" allowClear showSearch options={getDistrictOptions(regProvince, regCity)} />
                </Form.Item>
              </Space.Compact>

              <Form.Item name="addressDetail" label="详细地址">
                <Input prefix={<EnvironmentOutlined />} placeholder="请输入详细地址（街道、门牌号等）" />
              </Form.Item>

              <div style={{ textAlign: 'right', marginTop: 24 }}>
                <Button type="primary" onClick={handleRegisterStep1} style={{ background: PRIMARY, borderColor: PRIMARY }}>
                  下一步
                </Button>
              </div>
            </>
          )}

          {/* 步骤2：设置账号 */}
          {registerStep === 1 && (
            <>
              <Form.Item
                name="username"
                label="登录账号"
                rules={[
                  { required: true, message: '请输入登录账号' },
                  { pattern: /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/, message: '字母开头，4-20位字母数字下划线' },
                ]}
              >
                <Input prefix={<UserAddOutlined />} placeholder="请输入登录账号" />
              </Form.Item>

              <Form.Item
                name="password"
                label="登录密码"
                rules={[
                  { required: true, message: '请设置登录密码' },
                  { min: 6, message: '密码至少6位' },
                  { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '密码必须包含字母和数字' },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="请设置登录密码（字母+数字）" />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label="确认密码"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请确认密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="请再次输入密码" />
              </Form.Item>

              <Divider />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button onClick={() => setRegisterStep(0)}>上一步</Button>
                <Button type="primary" onClick={handleRegisterStep2} style={{ background: PRIMARY, borderColor: PRIMARY }}>
                  下一步
                </Button>
              </div>
            </>
          )}

          {/* 步骤3：确认信息 */}
          {registerStep === 2 && (
            <>
              <Alert
                message="请确认注册信息"
                description="请仔细核对以下信息，确认无误后提交注册申请。"
                type="warning"
                showIcon
                style={{ marginBottom: 24 }}
              />

              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="注册角色">
                  {form.getFieldValue('role')?.includes('supplier') ? '供应商 ' : ''}
                  {form.getFieldValue('role')?.includes('purchaser') ? '采购商 ' : ''}
                </Descriptions.Item>
                <Descriptions.Item label="公司名称">{form.getFieldValue('companyName')}</Descriptions.Item>
                <Descriptions.Item label="公司编号">{form.getFieldValue('companyNo')}</Descriptions.Item>
                <Descriptions.Item label="联系人">{form.getFieldValue('contactPerson')}</Descriptions.Item>
                <Descriptions.Item label="联系电话">{form.getFieldValue('phone')}</Descriptions.Item>
                <Descriptions.Item label="电子邮箱">{form.getFieldValue('email')}</Descriptions.Item>
                <Descriptions.Item label="所在地区">
                  {[form.getFieldValue('province'), form.getFieldValue('city'), form.getFieldValue('district')].filter(Boolean).join(' ') || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="详细地址">{form.getFieldValue('addressDetail') || '-'}</Descriptions.Item>
                <Descriptions.Item label="登录账号">{form.getFieldValue('username')}</Descriptions.Item>
              </Descriptions>

              <Form.Item name="agreement" valuePropName="checked" style={{ marginTop: 24 }}>
                <Checkbox>
                  我已阅读并同意 <a href="#">《服务协议》</a> 和 <a href="#">《隐私政策》</a>
                </Checkbox>
              </Form.Item>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button onClick={() => setRegisterStep(1)}>上一步</Button>
                <Button 
                  type="primary" 
                  loading={loading}
                  onClick={handleRegisterSubmit}
                  style={{ background: PRIMARY, borderColor: PRIMARY }}
                  disabled={!agreementChecked}
                >
                  提交注册
                </Button>
              </div>
            </>
          )}
        </Form>
      </>
    );
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      background: '#f0f2f5',
    }}>
      {/* 左侧品牌展示区 */}
      <div style={{
        flex: 1,
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #0d2b4a 100%)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 装饰性背景元素 */}
        <div style={{
          position: 'absolute',
          top: -80,
          right: -80,
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)',
        }} />
        <div style={{
          position: 'absolute',
          bottom: -60,
          left: -60,
          width: 240,
          height: 240,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)',
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.02)',
        }} />

        {/* Logo和品牌信息 */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <div style={{ marginBottom: 32 }}>
            <Logo size={80} showText={false} useImage={true} textColor="#fff" />
          </div>
          <div style={{ 
            fontSize: 42, 
            fontWeight: 700, 
            color: '#fff',
            marginBottom: 8,
            letterSpacing: 2,
          }}>
            讯能手
          </div>
          <div style={{ 
            fontSize: 20, 
            color: 'rgba(255,255,255,0.7)',
            marginBottom: 40,
            letterSpacing: 4,
          }}>
            智慧工厂 ERP 管理系统
          </div>

          {/* 品牌特性 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 60 }}>
            {[
              { icon: '📊', title: '数据驱动', desc: '实时掌握生产全流程' },
              { icon: '🔗', title: '供应链协同', desc: '采购商与供应商高效对接' },
              { icon: '🛡️', title: '安全可靠', desc: '企业级数据安全保障' },
            ].map((item, idx) => (
              <div key={idx} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '16px 24px',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 12,
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ fontSize: 28 }}>{item.icon}</div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>{item.title}</div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 底部版权 */}
        <div style={{
          position: 'absolute',
          bottom: 32,
          color: 'rgba(255,255,255,0.35)',
          fontSize: 12,
          zIndex: 1,
        }}>
          © 2026 讯能手 · 保留所有权利
        </div>
      </div>

      {/* 右侧登录表单区 */}
      <div style={{ 
        width: 520,
        minWidth: 520,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        background: '#fff',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {/* 移动端才显示Logo */}
          <div style={{ 
            display: 'none',
            textAlign: 'center', 
            marginBottom: 32,
          }} className="mobile-logo">
            <Logo size={48} showText={true} useImage={true} textColor={PRIMARY} />
          </div>

          <Title level={2} style={{ marginBottom: 4, color: '#1a2b45' }}>
            {activeTab === 'login' ? '欢迎回来' : '创建账号'}
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 32, fontSize: 14 }}>
            {activeTab === 'login' ? '登录您的账号以继续使用系统' : '注册新账号以开始使用系统'}
          </Text>

          {/* 登录/注册切换Tabs */}
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              setRegisterStep(0);
              setRegisterSuccess(false);
              form.resetFields();
              if (key === 'register') {
                // 进入注册页默认预填随机公司编号（8位字母+数字，唯一）与订单号前缀（按注册顺序递增）
                form.setFieldValue('companyNo', generateUniqueCompanyNo());
                form.setFieldValue('orderPrefix', generateNextOrderPrefix());
              }
            }}
            style={{ marginBottom: 8 }}
            items={[
              {
                key: 'login',
                label: (
                  <span>
                    <UserOutlined style={{ marginRight: 8 }} />
                    登录
                  </span>
                ),
              },
              {
                key: 'register',
                label: (
                  <span>
                    <UserAddOutlined style={{ marginRight: 8 }} />
                    注册
                  </span>
                ),
              },
            ]}
          />

          {/* 渲染登录或注册表单 */}
          {activeTab === 'login' ? renderLoginForm() : renderRegisterForm()}

          {/* 底部说明 */}
          <Divider style={{ margin: '16px 0' }} />
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {activeTab === 'login' ? '还没有账号？' : '已有账号？'}
              <a 
                onClick={() => {
                  setActiveTab(activeTab === 'login' ? 'register' : 'login');
                  setRegisterStep(0);
                  setRegisterSuccess(false);
                  form.resetFields();
                }}
                style={{ marginLeft: 8, color: PRIMARY }}
              >
                {activeTab === 'login' ? '立即注册' : '立即登录'}
              </a>
            </Text>
          </div>
        </div>
      </div>

      {/* 找回密码弹窗 */}
      <Modal
        title={forgotStep === 2 ? '设置新密码' : forgotStep === 1 ? '输入验证码' : '找回密码'}
        open={forgotVisible}
        onCancel={closeForgotModal}
        footer={null}
        width={420}
        destroyOnClose
      >
        <div style={{ padding: '12px 0' }}>
          {/* 步骤指示器 */}
          <Steps
            current={forgotStep}
            size="small"
            style={{ marginBottom: 20 }}
            items={[
              { title: '验证手机号' },
              { title: '输入验证码' },
              { title: '设置密码' },
            ]}
          />

          {/* 步骤0：输入账号和手机号 */}
          {forgotStep === 0 && (
            <>
              <Alert
                message="请输入账号和绑定手机号"
                description="系统将向该手机号发送6位数字短信验证码，用于验证身份。"
                type="info"
                showIcon
                style={{ marginBottom: 20 }}
              />
              <Form form={forgotForm} layout="vertical" size="large">
                <Form.Item
                  name="forgotUsername"
                  rules={[{ required: true, message: '请输入登录账号' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="请输入登录账号" />
                </Form.Item>
                <Form.Item
                  name="forgotPhone"
                  rules={[
                    { required: true, message: '请输入绑定手机号' },
                    { pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' },
                  ]}
                >
                  <Input prefix={<MobileOutlined />} placeholder="请输入绑定手机号" maxLength={11} />
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    type="primary"
                    block
                    loading={forgotLoading}
                    onClick={handleSendCode}
                    style={{ background: PRIMARY, borderColor: PRIMARY, height: 44, fontSize: 16 }}
                  >
                    发送验证码
                  </Button>
                </Form.Item>
              </Form>
            </>
          )}

          {/* 步骤1：输入验证码 */}
          {forgotStep === 1 && (
            <>
              <Alert
                message={`验证码已发送至 ${forgotPhone}`}
                description={`账号「${matchedUser?.username}」的绑定手机已收到短信验证码，请在下方输入。`}
                type="success"
                showIcon
                style={{ marginBottom: 20 }}
              />
              <div style={{ marginBottom: 20 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>验证码：</Text>
                <Input
                  size="large"
                  placeholder="请输入6位数字验证码"
                  maxLength={6}
                  value={inputCode}
                  onChange={e => setInputCode(e.target.value.replace(/\D/g, ''))}
                  style={{ textAlign: 'center', fontSize: 18, letterSpacing: 6 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {countdown > 0 ? `${countdown}秒后可重新发送` : '未收到验证码？'}
                  </Text>
                  <Button
                    type="link"
                    size="small"
                    disabled={countdown > 0}
                    onClick={handleResendCode}
                  >
                    重新发送
                  </Button>
                </div>
              </div>
              <Button
                type="primary"
                block
                onClick={handleVerifyCode}
                style={{ background: PRIMARY, borderColor: PRIMARY, height: 44, fontSize: 16 }}
              >
                验证
              </Button>
            </>
          )}

          {/* 步骤2：设置新密码 */}
          {forgotStep === 2 && (
            <>
              <Alert
                message={`正在为账号「${matchedUser?.username}」重置密码`}
                description="验证通过，请设置新的登录密码。"
                type="success"
                showIcon
                style={{ marginBottom: 20 }}
              />
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>新密码：</Text>
                <Input.Password
                  size="large"
                  placeholder="请输入新密码（字母+数字）"
                  prefix={<LockOutlined />}
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>确认密码：</Text>
                <Input.Password
                  size="large"
                  placeholder="请再次输入新密码"
                  prefix={<LockOutlined />}
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                />
              </div>
              <Button
                type="primary"
                block
                loading={forgotLoading}
                onClick={handleResetPassword}
                style={{ background: PRIMARY, borderColor: PRIMARY, height: 44, fontSize: 16 }}
              >
                重置密码
              </Button>
            </>
          )}

          <Divider />

          <div style={{ textAlign: 'center' }}>
            <a onClick={closeForgotModal} style={{ fontSize: 13, color: PRIMARY }}>
              返回登录
            </a>
          </div>
        </div>
      </Modal>

      {/* 新设备验证弹窗 */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#faad14' }} />
            <span>新设备登录验证</span>
          </Space>
        }
        open={deviceVerifyVisible}
        closable={false}
        maskClosable={false}
        footer={null}
        width={460}
      >
        <div style={{ marginBottom: 16 }}>
          <Alert
            message="安全验证"
            description="系统检测到您正在新设备上登录，为保障账号安全，请完成身份验证。"
            type="warning"
            showIcon
          />
        </div>

        {/* 步骤0：选择验证方式 */}
        {deviceVerifyStep === 0 && (
          <>
            <div style={{ marginBottom: 20 }}>
              <Text strong style={{ display: 'block', marginBottom: 12 }}>请选择验证方式：</Text>
              <Radio.Group
                value={deviceVerifyMethod}
                onChange={e => setDeviceVerifyMethod(e.target.value)}
                style={{ width: '100%' }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Radio value="phone" style={{
                    padding: '12px 16px', border: '1px solid #d9d9d9', borderRadius: 8,
                    width: '100%', background: deviceVerifyMethod === 'phone' ? '#e6f7ff' : '#fff',
                  }}>
                    <Space>
                      <MobileOutlined style={{ fontSize: 18, color: PRIMARY }} />
                      <span>手机短信验证码</span>
                    </Space>
                  </Radio>
                </Space>
              </Radio.Group>
            </div>
            <Button
              type="primary"
              block
              onClick={handleSendDeviceCode}
              style={{ background: PRIMARY, borderColor: PRIMARY, height: 44, fontSize: 16 }}
            >
              发送验证码
            </Button>
          </>
        )}

        {/* 步骤1：输入验证码 */}
        {deviceVerifyStep === 1 && (
          <>
            <Alert
              message="验证码已发送至您的手机"
              description={
                <span>
                  账号「{pendingLoginUser?.username}」的绑定手机已收到验证码，请在下方输入。
                </span>
              }
              type="success"
              showIcon
              style={{ marginBottom: 20 }}
            />
            <div style={{ marginBottom: 20 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>验证码：</Text>
              <Input
                size="large"
                placeholder="请输入6位数字验证码"
                maxLength={6}
                value={deviceVerifyInput}
                onChange={e => setDeviceVerifyInput(e.target.value.replace(/\D/g, ''))}
                style={{ textAlign: 'center', fontSize: 18, letterSpacing: 6 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {deviceVerifyCountdown > 0 ? `${deviceVerifyCountdown}秒后可重新发送` : '未收到验证码？'}
                </Text>
                <Button
                  type="link"
                  size="small"
                  disabled={deviceVerifyCountdown > 0}
                  onClick={handleResendDeviceCode}
                >
                  重新发送
                </Button>
              </div>
            </div>
            <Button
              type="primary"
              block
              onClick={handleVerifyDeviceCode}
              style={{ background: PRIMARY, borderColor: PRIMARY, height: 44, fontSize: 16 }}
            >
              验证并登录
            </Button>
          </>
        )}
      </Modal>
    </div>
  );
};

export default Auth;
