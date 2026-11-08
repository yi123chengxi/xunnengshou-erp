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
const SUP_ROW_TERMINAL = ['对账完成', '按采方入账'];

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
    const recsAll = readList('recon_records');
    const tombs = recsAll.filter((r: any) => r && r.delisted && r.docNo);
    const tombOfRow = (row: any): any => tombs.find((t: any) =>
      (t.orderNo && row.id === t.orderNo) ||
      (!!row.outboundNo && String(row.outboundNo).trim() === String(t.docNo).trim())) || null;
    // 1) 终态账单/完成墓碑 → 供应商账单明细行断言回写（对抗旧端复活的回滚）
    billsAll.forEach(bills => {
      bills.forEach((b: any) => {
        const res = String(b?.reconcileResult || '');
        if (!BILL_TERMINAL.includes(res)) return;
        const no = String(b?.outboundNo || '').trim();
        if (!no) return;
        details.forEach(d => {
          let ch = false;
          d.rows = d.rows.map((row: any) => {
            if (String(row?.outboundNo || '').trim() !== no) return row;
            if (SUP_ROW_TERMINAL.includes(String(row?.reconResult || ''))) return row;
            const tomb = tombOfRow(row);
            const alignAmt = res === '不相符' ? 0 : (Number(tomb ? (tomb.supResult === '按采方入账' ? tomb.theirAmount : tomb.ourAmount) : b.totalAmount) || 0);
            ch = true;
            return {
              ...row,
              reconResult: tomb?.supResult || '对账完成',
              diffDesc: tomb?.supDiff || diffOfBill(res),
              totalAmount: alignAmt > 0 ? alignAmt : row.totalAmount,
              purchaserReconPerson: row.purchaserReconPerson || tomb?.purPerson || b.purchaserReconciler || '',
              supplierReconPerson: row.supplierReconPerson || tomb?.supPerson || b.supplierReconciler || '',
            };
          });
          if (ch) { try { localStorage.setItem(d.key, JSON.stringify(d.rows)); wrote = true; } catch { /* ignore */ } }
        });
      });
    });
    // 1.5) 仅有墓碑（账单键不在本端，如供应商浏览器）也断言回写明细行
    if (tombs.length > 0) {
      details.forEach(d => {
        let ch = false;
        d.rows = d.rows.map((row: any) => {
          if (SUP_ROW_TERMINAL.includes(String(row?.reconResult || ''))) return row;
          const tomb = tombOfRow(row);
          if (!tomb) return row;
          const alignAmt = Number(tomb.supResult === '按采方入账' ? tomb.theirAmount : tomb.ourAmount) || 0;
          ch = true;
          return {
            ...row,
            reconResult: tomb.supResult || '对账完成',
            diffDesc: tomb.supDiff || row.diffDesc || '',
            totalAmount: alignAmt > 0 ? alignAmt : row.totalAmount,
            purchaserReconPerson: row.purchaserReconPerson || tomb.purPerson || '',
            supplierReconPerson: row.supplierReconPerson || tomb.supPerson || '',
          };
        });
        if (ch) { try { localStorage.setItem(d.key, JSON.stringify(d.rows)); wrote = true; } catch { /* ignore */ } }
      });
    }
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
    // key 内置时间戳（recon-<doc>-<ts>），用于区分「历史重复记录」与「完成后重新发起」
    const keyTs = (k: any): number => {
      const m = String(k || '').match(/(\d{12,})$/);
      return m ? Number(m[1]) : 0;
    };
    const tombByPair = new Map<string, any>();
    recs.forEach((r: any) => {
      if (!r || !r.delisted || !r.docNo) return;
      const ts = keyTs(r.key) || (Date.parse(String(r.delistedAt || '')) || 0);
      const pk = pairOf(r);
      const prev = tombByPair.get(pk);
      if (!prev || ts >= (prev.__ts || 0)) tombByPair.set(pk, { ...r, __ts: ts });
    });
    let chR = false;
    const next = recs.map((r: any) => {
      if (!r || r.delisted || String(r.reconResult || 'pending') !== 'pending') return r;
      const no = String(r.docNo || '').trim();
      // 同单据同双方已存在更新的完成墓碑 → 本次为旧端重复记录，直接补齐墓碑，避免「删除后刷新又出现」
      const dupTomb = tombByPair.get(pairOf(r));
      if (dupTomb && (keyTs(r.key) || 0) <= (dupTomb.__ts || 0)) {
        chR = true;
        return {
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
      }
      const hitBill = billsAll.map(list => list.find((b: any) =>
        BILL_TERMINAL.includes(String(b?.reconcileResult || '')) &&
        ((r.matchedBillKey && b.key === r.matchedBillKey) || (!!no && String(b?.outboundNo || '').trim() === no)))).find(Boolean) as any;
      const billHit = !!hitBill;
      const rowHit = !billHit && details.some(d => d.rows.some((row: any) =>
        SUP_ROW_TERMINAL.includes(String(row?.reconResult || '')) &&
        ((r.orderNo && row.id === r.orderNo) || (!!no && String(row?.outboundNo || '').trim() === no))));
      if (!billHit && !rowHit) return r;
      chR = true;
      return {
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
    });
    if (chR) { try { localStorage.setItem('recon_records', JSON.stringify(next)); wrote = true; } catch { /* ignore */ } }
  } catch { /* ignore */ }
  return wrote;
}
