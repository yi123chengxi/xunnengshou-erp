/**
 * 企业认证 30 天巡检日任务
 *
 * 每个已认证租户每 30 天复检一次（last_check_at <= 今天-30天 即到期）；
 * 每天最多处理 20 条（控费），当日是否已跑用 system_settings 的
 * enterprise_patrol_last_date 持久化，服务重启不重复跑。
 * 结果处理：匹配→刷新 last_check_at；不匹配→abnormal（工商变更/查无）；
 * 接口错误→仅记 check_result=error 不推进 last_check_at，次日重试。
 */
import { store } from '../database/store';
import { verifyThreeElements } from './enterpriseVerify';

const META_KEY = 'enterprise_patrol_last_date';
const DAY_MS = 24 * 3600_000;
const BATCH_LIMIT = 20;

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export async function runEnterprisePatrolTick(): Promise<number> {
  const today = dayStr(new Date());
  try {
    const lastDate = await store.getSetting(META_KEY);
    if (lastDate === today) return 0; // 当日已跑
    const cutoff = dayStr(new Date(Date.now() - 30 * DAY_MS));
    const due = await store.certsDueCheck(cutoff, BATCH_LIMIT);
    for (const r of due) {
      const res = await verifyThreeElements({
        companyName: r.company_name, creditCode: r.credit_code, legalPerson: r.legal_person,
      });
      if (!res.ok) {
        // 接口故障：不推进巡检日期，次日重试
        await store.updateCertStatus(r.status, r.fail_reason, 'error', r.last_check_at, r.username);
        continue;
      }
      if (res.matched) {
        await store.updateCertStatus('certified', '', res.devMode ? 'devMode' : 'match', nowStr(), r.username);
      } else {
        await store.updateCertStatus('abnormal', res.message || '三要素与工商登记不一致', res.reason || 'mismatch', nowStr(), r.username);
      }
    }
    await store.setSetting(META_KEY, today);
    return due.length;
  } catch {
    return 0;
  }
}

/** 启动 30s 后首跑，之后每小时尝试一次（当日已跑自动跳过） */
export function startEnterprisePatrol(): void {
  setTimeout(() => { void runEnterprisePatrolTick(); }, 30_000);
  setInterval(() => { void runEnterprisePatrolTick(); }, 3600_000);
}
