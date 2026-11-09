/**
 * 对账完成联动自愈（对抗并集合并复活）。
 * 背景：completeRecon 采用「删除对账记录 + 回写双方账单」设计，但数组类同步键在旧端 PUT 时
 * 走并集合并（同 id incoming 优先），「已删除的记录」与「已回写的对账完成状态」会被未刷新的
 * 旧标签页复活，导致供应商对账管理长期停留"对方未入账"。服务端合并仅保护 delisted=true 墓碑。
 * 本模块随同步轮询执行（pullAllDatasets 顶部钩子）：
 *  1) 采购商终态账单（按供方入账/已对账/对账完成/不相符）→ 断言回写供应商账单明细行为对账完成；
 *  2) 存活 pending 对账记录若任一侧账单已终态 → 打 delisted 墓碑并补入账日期，
 *     使记录不可被复活且双方列表自然收敛移除。
 */

const BILL_TERMINAL = ['按供方入账', '已对账', '对账完成', '不相符'];
const SUP_ROW_TERMINAL = ['对账完成', '按采方入账', '不相符'];

import { loadAllReconRecordsUnion, upsertRecords } from './reconStore';
import { appendBillLogEntry } from './billLog';

const readList = (k: string): any[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
};

const diffOfBill = (res: string): string =>
  res === '按供方入账' ? '按供方入账，采购商已确认'
    : res === '不相符' ? '账单不相符'
      : '金额一致，双方对账完成';

export function healReconTerminalLinks(): boolean {
  let wrote = false;
  try {
    // 清理历史孤儿键（空 owner 的账单明细键）：该键会被所有租户拉取，存在跨租户串读风险
    try {
      if (localStorage.getItem('pageData_customer_bill-detail_') !== null) {
        localStorage.removeItem('pageData_customer_bill-detail_');
        localStorage.removeItem('pageData_customer_bill-detail__ts');
        wrote = true;
      }
    } catch { /* ignore */ }
    const billKeys: string[] = [];
    const detailKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf('purchaser_bills_') === 0) billKeys.push(k);
      else if (k.indexOf('pageData_customer_bill-detail_') === 0) detailKeys.push(k);
    }
    if (billKeys.length === 0 && detailKeys.length === 0) return false;
    const details = detailKeys.map(k => ({ key: k, rows: readList(k) }));
    const billsAll = billKeys.map(k => readList(k));
    // 全局键墓碑（双端必拉）：携带供应商侧回写断言，使供应商浏览器无需采购商账单键也能自愈明细行
    // 分平台独立库 + 旧全局键的并集（同 key 墓碑优先）
    const recsAll = loadAllReconRecordsUnion();
    const tombs = recsAll.filter((r: any) => r && r.delisted && r.docNo);
    // 区分「完成墓碑」与「撤回墓碑」：完成墓碑携带回写断言（supResult）或确认时间；
    // 撤回墓碑（withdrawn=true 或无断言的 pending 墓碑）仅表示取消对账请求，
    // 绝不能把账单行回写为对账完成（否则「撤回后过一会自动完成」）
    const isCompletionTomb = (t: any): boolean => !!t && t.delisted === true && t.withdrawn !== true &&
      (String(t.supResult || '') !== '' || String(t.reconResult || '') === 'matched' || !!t.confirmedAt);
    // key 内置时间戳（recon-<doc>-<ts> / bill-<ts>），用于区分「历史证据」与「重新发起的新周期」
    const keyTs = (k: any): number => {
      const m = String(k || '').match(/(\d{12,})$/);
      return m ? Number(m[1]) : 0;
    };
    // 同号消歧：同一客户下出库单号可能重复（历史脏数据），仅凭 docNo 无法定位唯一行。
    // 有 orderNo（供应商行 id）时精确定位；否则仅当该 docNo 在该客户行中唯一时才按单号回写，
    // 重复时返回 null（跳过自动回写），避免把另一张同号单误写/双写为对账完成。
    const custOf = (row: any): string => String(row?.customerUsername || row?.customerName || '').trim();
    const targetRowIdCache = new Map<string, string | null>();
    const resolveTargetRowId = (t: any, custHint?: string): string | null => {
      if (t?.orderNo) {
        const hit = details.some(d => d.rows.some((r: any) => r.id === t.orderNo));
        return hit ? String(t.orderNo) : null;
      }
      const ck = custHint || String(t?.customerUsername || t?.customerName || '').trim();
      const cacheKey = String(t?.key || '') + '#' + ck;
      if (targetRowIdCache.has(cacheKey)) return targetRowIdCache.get(cacheKey) || null;
      let id: string | null = null;
      if (t?.docNo) {
        const cands = new Set<string>();
        details.forEach(d => d.rows.forEach((r: any) => {
          if (!r?.outboundNo || String(r.outboundNo).trim() !== String(t.docNo).trim()) return;
          if (ck && custOf(r) && custOf(r) !== ck) return;
          cands.add(String(r.id));
        }));
        if (cands.size === 1) id = Array.from(cands)[0];
      }
      targetRowIdCache.set(cacheKey, id);
      return id;
    };
    const matchRow = (t: any, row: any): boolean => {
      if (t?.orderNo && row?.id === t.orderNo) return true;
      const tid = resolveTargetRowId(t, custOf(row));
      return !!tid && row?.id === tid;
    };
    // 终态采购账单→供应商行回写前的同号消歧：同客户下该单号唯一才允许回写
    const uniqueRowIdFor = (no: string, owner: string): string | null => {
      const cands = new Set<string>();
      details.forEach(d => d.rows.forEach((r: any) => {
        if (!r?.outboundNo || String(r.outboundNo).trim() !== no) return;
        const cu = String(r.customerUsername || '').trim();
        if (owner && cu && cu !== owner) return;
        cands.add(String(r.id));
      }));
      return cands.size === 1 ? Array.from(cands)[0] : null;
    };
    const completionTombOfRow = (row: any): any => tombs.find((t: any) => isCompletionTomb(t) && matchRow(t, row)) || null;
    const withdrawTombOfRow = (row: any): any => tombs.find((t: any) => t.delisted && !isCompletionTomb(t) && matchRow(t, row)) || null;
    const aliveRecs = recsAll.filter((r: any) => r && !r.delisted);
    // 重新发起保护：该账单行存在比证据时间戳更新的存活对账记录 → 新对账周期进行中，
    // 旧周期的终态证据不得回写/墓碑新周期
    const hasNewerAlive = (row: any, evidenceTs: number): boolean => aliveRecs.some((r: any) =>
      ((r.orderNo && row.id === r.orderNo) || (!!r.docNo && !!row.outboundNo && String(r.docNo).trim() === String(row.outboundNo).trim())) &&
      keyTs(r.key) > evidenceTs);
    const terminalBillOfRow = (row: any): any => {
      for (const list of billsAll) {
        const b = list.find((x: any) => BILL_TERMINAL.includes(String(x?.reconcileResult || '')) &&
          !!row.outboundNo && String(x?.outboundNo || '').trim() === String(row.outboundNo).trim());
        if (b) return b;
      }
      return null;
    };
    // 1) 终态账单/完成墓碑 → 供应商账单明细行断言回写（对抗旧端复活的回滚）
    billsAll.forEach((bills, bi) => {
      const owner = billKeys[bi].slice('purchaser_bills_'.length);
      bills.forEach((b: any) => {
        const res = String(b?.reconcileResult || '');
        if (!BILL_TERMINAL.includes(res)) return;
        const no = String(b?.outboundNo || '').trim();
        if (!no) return;
        // 同号消歧：同客户下该出库单号唯一才回写；重复时跳过，避免误写另一张同号单
        const uid = uniqueRowIdFor(no, owner);
        if (!uid) return;
        details.forEach(d => {
          let ch = false;
          d.rows = d.rows.map((row: any) => {
            if (String(row?.outboundNo || '').trim() !== no) return row;
            if (row.id !== uid) return row;
            if (SUP_ROW_TERMINAL.includes(String(row?.reconResult || ''))) return row;
            const tomb = completionTombOfRow(row);
            // 新周期保护：存在比完成墓碑更新的存活记录（完成后重新发起）→ 不回写旧周期结果
            const ct1 = tomb;
            const evTs1 = ct1 ? (keyTs(ct1.key) || (Date.parse(String(ct1.delistedAt || '')) || 0)) : 0;
            if (evTs1 && hasNewerAlive(row, evTs1)) return row;
            const alignAmt = res === '不相符' ? 0 : (Number(tomb ? (tomb.supResult === '按采方入账' ? tomb.theirAmount : tomb.ourAmount) : b.totalAmount) || 0);
            ch = true;
            return {
              ...row,
              reconResult: tomb?.supResult || '对账完成',
              diffDesc: tomb?.supDiff || diffOfBill(res),
              totalAmount: alignAmt > 0 ? alignAmt : row.totalAmount,
              purchaserReconPerson: row.purchaserReconPerson || tomb?.purPerson || b.purchaserReconciler || '',
              supplierReconPerson: row.supplierReconPerson || tomb?.supPerson || b.supplierReconciler || '',
              // 自愈回写补账单日志（对方浏览器完成时本端缺少操作记录）
              billLog: appendBillLogEntry(row.billLog, '对账完成', tomb?.purPerson || b.purchaserReconciler || undefined, tomb?.supDiff || diffOfBill(res)),
            };
          });
          if (ch) { try { localStorage.setItem(d.key, JSON.stringify(d.rows)); wrote = true; } catch { /* ignore */ } }
        });
      });
    });
    // 1.5) 仅有完成墓碑（账单键不在本端，如供应商浏览器）也断言回写明细行；撤回墓碑不参与
    if (tombs.length > 0) {
      details.forEach(d => {
        let ch = false;
        d.rows = d.rows.map((row: any) => {
          if (SUP_ROW_TERMINAL.includes(String(row?.reconResult || ''))) return row;
          const tomb = completionTombOfRow(row);
          if (!tomb) return row;
          const tTs = keyTs(tomb.key) || (Date.parse(String(tomb.delistedAt || '')) || 0);
          if (tTs && hasNewerAlive(row, tTs)) return row;
          const alignAmt = Number(tomb.supResult === '按采方入账' ? tomb.theirAmount : tomb.ourAmount) || 0;
          ch = true;
          return {
            ...row,
            reconResult: tomb.supResult || '对账完成',
            diffDesc: tomb.supDiff || row.diffDesc || '',
            totalAmount: alignAmt > 0 ? alignAmt : row.totalAmount,
            purchaserReconPerson: row.purchaserReconPerson || tomb.purPerson || '',
            supplierReconPerson: row.supplierReconPerson || tomb.supPerson || '',
            billLog: appendBillLogEntry(row.billLog, '对账完成', tomb.purPerson || undefined, tomb.supDiff || '对账完成，对方已确认'),
          };
        });
        if (ch) { try { localStorage.setItem(d.key, JSON.stringify(d.rows)); wrote = true; } catch { /* ignore */ } }
      });
    }
    // 1.2) 完成墓碑 → 采购商账单断言回写（completeRecon 因凭证缺失未能写采购商账单时，采购商浏览器自愈闭环）
    const compTombs = tombs.filter((t: any) => isCompletionTomb(t));
    if (compTombs.length > 0) {
      billsAll.forEach((bills, bi) => {
        let ch = false;
        billsAll[bi] = bills.map((b: any) => {
          if (BILL_TERMINAL.includes(String(b?.reconcileResult || ''))) return b;
          // 同号消歧：本账号下该出库单号重复时不用 docNo 回退匹配（避免两张同号单都被置终态），仅认 matchedBillKey
          const no = String(b?.outboundNo || '').trim();
          const dupDoc = !!no && bills.filter((x: any) => String(x?.outboundNo || '').trim() === no).length > 1;
          const t = compTombs.find((x: any) =>
            (x.matchedBillKey && x.matchedBillKey === b.key) ||
            (!dupDoc && !!x.docNo && !!no && String(x.docNo).trim() === no));
          if (!t) return b;
          ch = true;
          return {
            ...b,
            reconcileResult: '已对账',
            diffNote: t.supDiff || '金额一致，双方对账完成',
            purchaserReconciler: b.purchaserReconciler || t.purPerson || '',
            supplierReconciler: b.supplierReconciler || t.supPerson || '',
            billLog: appendBillLogEntry(b.billLog, '对账完成', t.purPerson || undefined, t.supDiff || '金额一致，双方对账完成'),
          };
        });
        if (ch) { try { localStorage.setItem(billKeys[bi], JSON.stringify(billsAll[bi])); wrote = true; } catch { /* ignore */ } }
      });
    }
    // 1.6) 误置状态修复：被撤回墓碑误回写为终态的账单行（无完成墓碑、无终态账单）还原为待对账
    details.forEach(d => {
      let ch = false;
      d.rows = d.rows.map((row: any) => {
        if (!SUP_ROW_TERMINAL.includes(String(row?.reconResult || ''))) return row;
        if (completionTombOfRow(row) || terminalBillOfRow(row)) return row;
        if (!withdrawTombOfRow(row)) return row;
        ch = true;
        return {
          ...row,
          reconResult: '待对账',
          diffDesc: '',
          purchaserReconPerson: '',
          supplierReconPerson: '',
          billLog: appendBillLogEntry(row.billLog, '撤回对账', undefined, '自愈修复：撤回后被误置的对账完成状态已还原为待对账'),
        };
      });
      if (ch) { try { localStorage.setItem(d.key, JSON.stringify(d.rows)); wrote = true; } catch { /* ignore */ } }
    });
    // 1.7) 孤儿在途状态还原：账单行/采购账单停留“已发起对账”等在途态但对账记录已不存在（仅有墓碑）→ 还原初始态
    const liveOfRow = (row: any): boolean => aliveRecs.some((r: any) =>
      (r.orderNo && row.id === r.orderNo) || (!!r.docNo && !!row.outboundNo && String(r.docNo).trim() === String(row.outboundNo).trim()));
    const tombOfRowAny = (row: any): boolean => tombs.some((t: any) => matchRow(t, row));
    details.forEach(d => {
      let ch = false;
      d.rows = d.rows.map((row: any) => {
        if (String(row?.reconResult || '') !== '已发起对账') return row;
        if (liveOfRow(row) || !tombOfRowAny(row)) return row;
        ch = true;
        return {
          ...row,
          reconResult: '待对账',
          diffDesc: '',
          purchaserReconPerson: '',
          supplierReconPerson: '',
          billLog: appendBillLogEntry(row.billLog, '撤回对账', undefined, '自愈修复：对账记录已不存在，恢复待对账'),
        };
      });
      if (ch) { try { localStorage.setItem(d.key, JSON.stringify(d.rows)); wrote = true; } catch { /* ignore */ } }
    });
    const liveOfBill = (b: any): boolean => aliveRecs.some((r: any) =>
      (r.matchedBillKey && r.matchedBillKey === b.key) || (r.orderNo && r.orderNo === b.key) ||
      (!!r.docNo && !!b.outboundNo && String(r.docNo).trim() === String(b.outboundNo).trim()));
    const tombOfBillAny = (b: any): boolean => tombs.some((t: any) =>
      (t.matchedBillKey && t.matchedBillKey === b.key) || (t.orderNo && t.orderNo === b.key) ||
      (!!t.docNo && !!b.outboundNo && String(t.docNo).trim() === String(b.outboundNo).trim()));
    billsAll.forEach((bills, bi) => {
      let ch = false;
      billsAll[bi] = bills.map((b: any) => {
        const cur = String(b?.reconcileResult || '');
        if (!['已发起对账', '一致', '不一致'].includes(cur)) return b;
        if (liveOfBill(b) || !tombOfBillAny(b)) return b;
        ch = true;
        return {
          ...b,
          reconcileResult: '',
          diffNote: '',
          auxDocNo: '',
          billLog: appendBillLogEntry(b.billLog, '撤回对账', undefined, '自愈修复：对账记录已不存在，恢复未对账'),
        };
      });
      if (ch) { try { localStorage.setItem(billKeys[bi], JSON.stringify(billsAll[bi])); wrote = true; } catch { /* ignore */ } }
    });
    // 2) 存活 pending 记录 + 任一侧已终态 → delisted 墓碑（服务端合并保护墓碑不被复活）
    const recs = recsAll;
    // 3) 采购商账单修复：供应商字段误写为本方公司名/简称 → 按对账记录纠正；
    //    供应商对账人为空或为公司名 → 人名规则（记录供方发起人 → 供应商法人 → 主账号姓名）
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      billKeys.forEach((bk, bi) => {
        const owner = bk.slice('purchaser_bills_'.length);
        const me = users.find((u: any) => u.username === owner);
        const ownNames = [me?.companyName, me?.companyShortName].filter(Boolean) as string[];
        let ch = false;
        const list = billsAll[bi].map((b: any) => {
          const rec = recsAll.find((x: any) => x && x.docNo &&
            ((b.outboundNo && String(x.docNo).trim() === String(b.outboundNo).trim()) || (x.matchedBillKey && x.matchedBillKey === b.key)));
          const supUser = users.find((u: any) => (rec?.supplierUsername && u.username === rec.supplierUsername) || (rec?.supplierName && u.companyName === rec.supplierName));
          const person = rec?.supplierReconPerson || supUser?.legalPerson || supUser?.contactPerson || '';
          let nb = b;
          if (rec && supUser && (!nb.supplier || ownNames.includes(String(nb.supplier)))) {
            nb = { ...nb, supplier: supUser.companyName };
            ch = true;
          }
          if (person && (!nb.supplierReconciler || nb.supplierReconciler === supUser?.companyName || nb.supplierReconciler === rec?.supplierName)) {
            nb = { ...nb, supplierReconciler: person };
            ch = true;
          }
          return nb;
        });
        if (ch) { try { localStorage.setItem(bk, JSON.stringify(list)); wrote = true; } catch { /* ignore */ } }
      });
    } catch { /* ignore */ }
    if (recs.length === 0) return wrote;
    const today = new Date().toISOString().slice(0, 10);
    // 单据键：同一单据可能因多次发起生成不同 key 的重复记录，墓碑归属需按单据+双方凭证判定
    const pairOf = (r: any): string => [
      String(r?.docNo || '').trim(),
      String(r?.supplierUsername || r?.supplierName || '').trim(),
      String(r?.customerUsername || r?.customerName || '').trim(),
    ].join('|');
    const tombByPair = new Map<string, any>();
    recs.forEach((r: any) => {
      // 仅完成墓碑参与重复记录收敛；撤回墓碑不得把存活记录置为完成
      if (!r || !r.delisted || !r.docNo || !isCompletionTomb(r)) return;
      const ts = keyTs(r.key) || (Date.parse(String(r.delistedAt || '')) || 0);
      const pk = pairOf(r);
      const prev = tombByPair.get(pk);
      if (!prev || ts >= (prev.__ts || 0)) tombByPair.set(pk, { ...r, __ts: ts });
    });
    let chR = false;
    const changedRecs: any[] = [];
    recs.forEach((r: any) => {
      if (!r || r.delisted || String(r.reconResult || 'pending') !== 'pending') return r;
      const no = String(r.docNo || '').trim();
      // 同单据同双方已存在更新的完成墓碑 → 本次为旧端重复记录，直接补齐墓碑，避免「删除后刷新又出现」
      const dupTomb = tombByPair.get(pairOf(r));
      if (dupTomb && (keyTs(r.key) || 0) <= (dupTomb.__ts || 0)) {
        chR = true;
        const tombRec = {
          ...r,
          delisted: true,
          delistedAt: new Date().toISOString(),
          reconResult: 'matched',
          theirEntryDate: !r.theirEntryDate || r.theirEntryDate === '-' ? (dupTomb.theirEntryDate || today) : r.theirEntryDate,
          ourEntryDate: !r.ourEntryDate || r.ourEntryDate === '-' ? (dupTomb.ourEntryDate || today) : r.ourEntryDate,
          supResult: dupTomb.supResult || '对账完成',
          supDiff: dupTomb.supDiff || '',
          purPerson: dupTomb.purPerson || '',
          supPerson: dupTomb.supPerson || '',
        };
        changedRecs.push(tombRec);
        return tombRec;
      }
      const hitBill = billsAll.map(list => list.find((b: any) =>
        BILL_TERMINAL.includes(String(b?.reconcileResult || '')) &&
        ((r.matchedBillKey && b.key === r.matchedBillKey) || (!!no && String(b?.outboundNo || '').trim() === no)))).find(Boolean) as any;
      const rowHitPlain = !hitBill && details.some(d => d.rows.some((row: any) =>
        SUP_ROW_TERMINAL.includes(String(row?.reconResult || '')) &&
        ((r.orderNo && row.id === r.orderNo) || (!!no && String(row?.outboundNo || '').trim() === no))));
      // 新周期保护：同单据已存在比本存活记录更早的完成墓碑 → 完成后重新发起的新对账，不得被旧证据收敛
      const ct = tombs.find((t: any) => isCompletionTomb(t) &&
        ((t.orderNo && r.orderNo && t.orderNo === r.orderNo) || (!!t.docNo && !!no && String(t.docNo).trim() === no))) || null;
      const evTs = ct ? (keyTs(ct.key) || (Date.parse(String(ct.delistedAt || '')) || 0)) : 0;
      const reInitiated = !!ct && (keyTs(r.key) || 0) > evTs;
      const billHit = !!hitBill && !reInitiated;
      const rowHit = !billHit && rowHitPlain && !reInitiated;
      if (!billHit && !rowHit) return r;
      chR = true;
      const healed = {
        ...r,
        delisted: true,
        delistedAt: new Date().toISOString(),
        reconResult: 'matched',
        theirEntryDate: !r.theirEntryDate || r.theirEntryDate === '-' ? today : r.theirEntryDate,
        ourEntryDate: !r.ourEntryDate || r.ourEntryDate === '-' ? today : r.ourEntryDate,
        // 墓碑携带回写断言，供任一端（含供应商浏览器）自愈明细行
        supResult: '对账完成',
        supDiff: hitBill ? diffOfBill(String(hitBill.reconcileResult)) : '按供方入账，采购商已确认',
        purPerson: hitBill?.purchaserReconciler || '',
        supPerson: hitBill?.supplierReconciler || '',
      };
      changedRecs.push(healed);
      return healed;
    });
    if (chR) { upsertRecords(changedRecs); wrote = true; }
  } catch { /* ignore */ }
  return wrote;
}
