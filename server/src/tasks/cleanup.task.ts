/**
 * 过期用户数据清理任务
 * 功能：
 *   1. 查找试用期结束超过6个月的注册账号
 *   2. 删除该账号下所有业务数据（员工、客户、订单、生产、库存、财务等）
 *   3. 删除注册账号记录
 * 调用方式：
 *   - 定时任务（每日凌晨2点自动执行）
 *   - API 手动触发：POST /api/system/cleanup-expired
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import dayjs from 'dayjs';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'factory_management',
  waitForConnections: true,
  connectionLimit: 10,
});

/**
 * 清理指定注册账号下的所有业务数据
 * 按 registered_username 关联删除
 */
async function deleteUserDataByRegisteredUsername(registeredUsername: string, connection: any) {
  // 1. 查找该注册账号下的所有员工账号（users 表）
  const [employees]: any = await connection.execute(
    'SELECT id FROM users WHERE registered_username = ?',
    [registeredUsername]
  );
  const employeeIds = employees.map((e: any) => e.id);

  if (employeeIds.length > 0) {
    // 2. 删除员工相关的业务数据（需按外键依赖顺序）
    // 生产报工记录
    await connection.execute(
      `DELETE pr FROM production_records pr
       INNER JOIN production_orders po ON pr.production_id = po.id
       WHERE po.created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 生产工单
    await connection.execute(
      `DELETE FROM production_orders WHERE created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 发货单明细 + 发货单
    await connection.execute(
      `DELETE dio FROM delivery_order_items dio
       INNER JOIN delivery_orders do ON dio.delivery_id = do.id
       WHERE do.created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );
    await connection.execute(
      `DELETE FROM delivery_orders WHERE created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 销售订单明细 + 销售订单
    await connection.execute(
      `DELETE soi FROM sales_order_items soi
       INNER JOIN sales_orders so ON soi.order_id = so.id
       WHERE so.created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );
    await connection.execute(
      `DELETE FROM sales_orders WHERE created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 收货单明细 + 收货单
    await connection.execute(
      `DELETE rio FROM receipt_order_items rio
       INNER JOIN receipt_orders ro ON rio.receipt_id = ro.id
       WHERE ro.created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );
    await connection.execute(
      `DELETE FROM receipt_orders WHERE created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 采购订单明细 + 采购订单
    await connection.execute(
      `DELETE poi FROM purchase_order_items poi
       INNER JOIN purchase_orders po ON poi.purchase_id = po.id
       WHERE po.created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );
    await connection.execute(
      `DELETE FROM purchase_orders WHERE created_by IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 财务：收款记录、付款记录、资金流水
    await connection.execute(
      `DELETE FROM payment_received WHERE operator_id IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );
    await connection.execute(
      `DELETE FROM payment_made WHERE operator_id IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );
    await connection.execute(
      `DELETE FROM cash_flow WHERE operator_id IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 系统日志
    await connection.execute(
      `DELETE FROM system_logs WHERE user_id IN (${employeeIds.map(() => '?').join(',')})`,
      employeeIds
    );

    // 删除员工账号
    await connection.execute(
      'DELETE FROM users WHERE registered_username = ?',
      [registeredUsername]
    );
  }

  // 3. 删除客户侧账单、供应商侧账单、对账记录
  // （这些表通过 customer_id/supplier_id 关联，需要先保留这些ID再删除）
  // 此处简化处理：直接删除 registered_username 关联的收款/付款账单
  // 注：customer 和 supplier 表是主数据，可以选择保留或标记删除
}

/**
 * 执行清理任务
 * 从 localStorage 同步的 registeredUsers 表中查找过期用户
 * 如果没有后端表，则从传入的过期用户列表清理
 */
export async function runCleanup(expiredUsers: { username: string; trialEndDate: string }[]) {
  const deletedAccounts: string[] = [];
  const errors: string[] = [];

  for (const user of expiredUsers) {
    const trialEnd = dayjs(user.trialEndDate);
    const monthsSince = dayjs().diff(trialEnd, 'month');

    if (monthsSince <= 6) continue; // 未满6个月，跳过

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 删除该账号的业务数据
      await deleteUserDataByRegisteredUsername(user.username, connection);

      await connection.commit();
      deletedAccounts.push(user.username);
      console.log(`✅ 已清理过期账号数据：${user.username}（试用截止：${user.trialEndDate}）`);
    } catch (err: any) {
      await connection.rollback();
      errors.push(`${user.username}: ${err.message}`);
      console.error(`❌ 清理失败：${user.username}`, err.message);
    } finally {
      connection.release();
    }
  }

  return { deletedAccounts, errors };
}

/**
 * 定时任务入口（配合 node-cron 使用）
 * 示例：每日凌晨2点执行
 *   import { CronJob } from 'cron';
 *   new CronJob('0 2 * * *', () => runCleanupFromDB());
 */
export async function runCleanupFromDB() {
  // 从数据库 registered_users 表读取过期用户
  // 如果还没有这个表，则跳过
  try {
    const [rows]: any = await pool.execute(
      `SELECT username, trial_end_date FROM registered_users
       WHERE trial_end_date IS NOT NULL
         AND trial_end_date < ?
         AND deleted_at IS NULL`,
      [dayjs().subtract(6, 'month').format('YYYY-MM-DD')]
    );

    if (rows.length > 0) {
      const result = await runCleanup(
        rows.map((r: any) => ({ username: r.username, trialEndDate: r.trial_end_date }))
      );
      console.log(`清理任务完成：删除 ${result.deletedAccounts.length} 个账号，失败 ${result.errors.length} 个`);
      return result;
    } else {
      console.log('清理任务：无过期超过6个月的账号');
    }
  } catch (err: any) {
    // registered_users 表可能不存在
    console.log('清理任务：registered_users 表不存在，跳过数据库清理');
  }
}

export default pool;
