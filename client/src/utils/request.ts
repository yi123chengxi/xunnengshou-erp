import axios from 'axios';
import { API_BASE } from './apiBase';

const request = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器
request.interceptors.response.use(
  (response) => response,
  (error) => {
    // 打印类接口（/print/render、/print/job 等）在服务端为免鉴权路由：Web 前端本就无 JWT，
    // 若命中的服务端为旧构建（路由仍在 verifyJWT 之后）会误返 401，绝不能因此清空会话跳登录页。
    // 该场景应仅在页面内提示错误，登录态由 localStorage.username 守卫单独判定。
    const reqUrl = String(error.config?.url || '');
    const isPrintApi = /\/print(\/|$)/.test(reqUrl);
    if (error.response?.status === 401 && !isPrintApi) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default request;
