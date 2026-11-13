/**
 * 显式删除申报登记表（「永不缩水键」防擦除不变量的客户端半边）。
 *
 * 服务端对账单/订单/合作镜像这类关键键只做「incoming 并集 + 仅按申报 removedIds 删除」，
 * 绝不整键替换——于是任何「本地副本少了某一行」的意外（陈旧镜像覆盖、同源去重、自愈重建）
 * 都会在服务端被并集保留，物理杜绝误擦除。代价是：合法的行移除必须显式申报，
 * 否则被删的行会被服务端并集复活（表现为删除后刷新又出现）。
 *
 * 因此约定：所有会减少行数的写操作，都必须在写 localStorage 之前调用 declareShrink(key, ids)。
 * 本模块独立于 serverSync：cooperationDedupe / cooperationReconcile 等自愈模块需要引用它，
 * 而 serverSync 已经 import 这些模块，直接从 serverSync 反向 import 会形成循环依赖。
 */
const pendingRemovedIds = new Map<string, string[]>();

/** 登记某键本次被合法移除的行 id（须在写存储前调用） */
export function declareShrink(key: string, removedIds: string[]): void {
  if (!removedIds || removedIds.length === 0) return;
  const prev = pendingRemovedIds.get(key) || [];
  pendingRemovedIds.set(key, Array.from(new Set([...prev, ...removedIds])));
}

/** 取出并清空某键的申报（上传时调用，保证一次申报只随一次上传消费） */
export function takeRemovedIds(key: string): string[] | undefined {
  const ids = pendingRemovedIds.get(key);
  if (!ids || ids.length === 0) return undefined;
  pendingRemovedIds.delete(key);
  return ids;
}

/** 只读查看某键的申报（入持久化上传队列时拍快照，不消费） */
export function peekRemovedIds(key: string): string[] | undefined {
  const ids = pendingRemovedIds.get(key);
  return ids && ids.length > 0 ? ids.slice() : undefined;
}
