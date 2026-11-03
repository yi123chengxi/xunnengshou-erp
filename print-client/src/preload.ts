/**
 * 打印客户端 — Preload 脚本
 *
 * 通过 contextBridge 将主进程能力安全暴露给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface PrintAPI {
  login(username: string, password: string): Promise<{ ok: boolean; message?: string; username?: string; name?: string }>;
  getPrinters(): Promise<{ name: string; isDefault: boolean }[]>;
  getStatus(): Promise<{ connected: boolean; username: string; serverUrl: string }>;
  getJobLogs(): Promise<any[]>;
  logout(): Promise<{ ok: boolean }>;
  onStatusChange(callback: (status: string) => void): () => void;
  onJobLog(callback: (log: any) => void): () => void;
  onPrintersUpdated(callback: (printers: { name: string; isDefault: boolean }[]) => void): () => void;
  getSharedPrinters(): Promise<any[]>;
  onSharedPrinters(callback: (printers: any[]) => void): () => void;
  onUpdateEvent(callback: (e: any) => void): () => void;
  onSwitchAccount(callback: () => void): () => void;
  checkUpdate(): Promise<{ ok: boolean }>;
  installUpdate(): Promise<{ ok: boolean; message?: string }>;
  setSharedPrinters(names: string[]): Promise<{ ok: boolean }>;
}

contextBridge.exposeInMainWorld('printAPI', {
  login: (user: string, pass: string) => ipcRenderer.invoke('login', user, pass),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getJobLogs: () => ipcRenderer.invoke('get-job-logs'),
  logout: () => ipcRenderer.invoke('logout'),

  onStatusChange: (callback: (status: string) => void) => {
    const handler = (_event: any, status: string) => callback(status);
    ipcRenderer.on('status-change', handler);
    return () => ipcRenderer.removeListener('status-change', handler);
  },

  onJobLog: (callback: (log: any) => void) => {
    const handler = (_event: any, log: any) => callback(log);
    ipcRenderer.on('job-log', handler);
    return () => ipcRenderer.removeListener('job-log', handler);
  },

  onPrintersUpdated: (callback: (printers: { name: string; isDefault: boolean }[]) => void) => {
    const handler = (_event: any, printers: any[]) => callback(printers);
    ipcRenderer.on('printers-updated', handler);
    return () => ipcRenderer.removeListener('printers-updated', handler);
  },

  getSharedPrinters: () => ipcRenderer.invoke('get-shared-printers'),

  onSharedPrinters: (callback: (printers: any[]) => void) => {
    const handler = (_event: any, printers: any[]) => callback(printers);
    ipcRenderer.on('shared-printers', handler);
    return () => ipcRenderer.removeListener('shared-printers', handler);
  },

  onUpdateEvent: (callback: (e: any) => void) => {
    const handler = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on('update-event', handler);
    return () => ipcRenderer.removeListener('update-event', handler);
  },

  onSwitchAccount: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('switch-account', handler);
    return () => ipcRenderer.removeListener('switch-account', handler);
  },

  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setSharedPrinters: (names: string[]) => ipcRenderer.invoke('set-shared-printers', names),
} satisfies PrintAPI);
