/**
 * 打印任务内存存储
 * - 活跃任务存储在 Map 中
 * - 已完成/失败的任务 30 分钟后自动清理
 * - 服务重启时任务丢失（内存存储，符合打印任务的临时性质）
 */
import { v4 as uuid } from 'uuid';

export type PrintJobStatus = 'pending' | 'printing' | 'completed' | 'failed';

export interface PrintJob {
  id: string;
  tenantId: string;         // 租户归属（username）
  type: 'url' | 'pdf';
  content: string;          // URL 或 base64
  printerName: string;      // 目标打印机名称（空字符串=默认打印机）
  copies: number;
  status: PrintJobStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// 任务存储
const jobs = new Map<string, PrintJob>();

// 清理间隔：每 5 分钟清理一次超过 30 分钟的已完成/失败任务
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const JOB_TTL = 30 * 60 * 1000; // 30 分钟

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if ((job.status === 'completed' || job.status === 'failed') && now - job.updatedAt > JOB_TTL) {
      jobs.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

/** 创建打印任务 */
export function createJob(params: {
  tenantId: string;
  type: 'url' | 'pdf';
  content: string;
  printerName?: string;
  copies?: number;
}): PrintJob {
  const now = Date.now();
  const job: PrintJob = {
    id: uuid(),
    tenantId: params.tenantId,
    type: params.type,
    content: params.content,
    printerName: params.printerName || '',
    copies: params.copies || 1,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

/** 获取任务 */
export function getJob(id: string): PrintJob | undefined {
  return jobs.get(id);
}

/** 更新任务状态 */
export function updateJobStatus(id: string, status: PrintJobStatus, error?: string): PrintJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  job.status = status;
  job.updatedAt = Date.now();
  if (error) job.error = error;
  return job;
}

/** 获取指定租户的任务列表（最近 50 条） */
export function getTenantJobs(tenantId: string, limit = 50): PrintJob[] {
  const result: PrintJob[] = [];
  for (const job of jobs.values()) {
    if (job.tenantId === tenantId) result.push(job);
  }
  result.sort((a, b) => b.createdAt - a.createdAt);
  return result.slice(0, limit);
}
