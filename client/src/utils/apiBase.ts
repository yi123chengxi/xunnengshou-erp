/**
 * 统一的后端 API 基址
 *
 * - 开发环境（localhost / 127.0.0.1）：直连本地服务 http://localhost:3000/api
 * - 云部署（其他域名 / IP）：走同源 /api，由 Nginx 反代到 127.0.0.1:3000
 *   （生产安全组不对外开放 3000 端口，直连 :3000 必然失败）
 * - 可用 REACT_APP_API_BASE 编译期覆盖，或 window.__API_BASE__ 运行期覆盖
 */
const explicit = (process.env.REACT_APP_API_BASE as string) ||
  (typeof window !== 'undefined' && (window as any).__API_BASE__
    ? `${String((window as any).__API_BASE__).replace(/\/$/, '')}/api`
    : '');

export const API_BASE: string = explicit ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? `${window.location.protocol}//${window.location.hostname}/api`
    : 'http://localhost:3000/api');

/** 不含 /api 后缀的源地址（WebSocket、Push 等拼接用） */
export const API_ORIGIN: string = API_BASE.replace(/\/api$/, '');
