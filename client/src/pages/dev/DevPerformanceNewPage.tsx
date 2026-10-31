import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, InputNumber, message, Tag, Select, DatePicker, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined, HistoryOutlined, CloseCircleOutlined, LockOutlined, UnlockOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { platformKey, loadPlatformPointRecords, savePlatformPointRecords } from '../../utils/devStore';
import type { AnalyticsPlatform, DevPointRecord } from '../../utils/devStore';
import { calcListingStats, loadNonExclusiveBrands } from '../../utils/listingStats';

// ============ 工具函数 ============
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

/** 利润计算（与 ShopProfitPage / DevPaymentPages 保持一致的公式） */
const calcProfit = (r: Record<string, any>): number => {
  const curNet = (r.currentBalance || 0) + (r.pendingAmount || 0) + (r.adFunds || 0)
    + (r.withdrawAmount || 0) + (r.deposit || 0);
  const prevNet = (r.prevBalance || 0) + (r.prevPending || 0) + (r.prevDeposit || 0) + (r.prevAdFunds || 0);
  const totalRecharge = Array.isArray(r.adRecharges) ? r.adRecharges.reduce((s: number, x: any) => s + (x.amount || 0), 0) : 0;
  return Math.round((curNet - prevNet - (r.shippingCost || 0) + (r.refundAmount || 0) - (r.returnFee || 0) - totalRecharge + (r.manualAdjustment || 0)) * 100) / 100;
};

// ============ 类型与常量 ============
interface RankItem { id: string; rank: number; name: string; baseSalary: number; targetValue: number; targetBindKey?: string; commissionRate: number; performanceSalary: number; }
interface CellScore { actual: number; target: number; totalScore: number; maxScore: number; }
interface PersonRow { userId: string; userName: string; scores: Record<string, CellScore>; maxTotal?: number; }
type SalaryExtra = { commissionType: string; otherDeduction: number; otherAllowance: number };

const COMMISSION_TYPE_OPTIONS = [
  { key: 'salesAmount', label: '销售额' },
  { key: 'salesQty', label: '销售件数' },
  { key: 'profit', label: '利润' },
  { key: 'listingQty', label: '上架数量' },
];

const SCORE_ITEM_OPTIONS = [
  { key: 'sales-amount', label: '销售额' },
  { key: 'sales-qty', label: '销售件数' },
  { key: 'profit', label: '利润' },
  { key: 'listing-qty', label: '上架数量' },
];

/** 职级绑定键 → 绩效分数据键的映射 */
const BIND_TO_SCORE_KEY: Record<string, string> = {
  salesAmount: 'sales-amount', salesQty: 'sales-qty', profit: 'profit', listingQty: 'listing-qty',
};

const DEFAULT_RANKS: RankItem[] = [];
const RANK_COLORS = ['#1d4ed8', '#047857', '#b45309', '#6d28d9', '#be185d', '#0e7490', '#c2410c', '#4d7c0f'];
const RANK_BG_COLORS = ['#eff6ff', '#ecfdf5', '#fffbeb', '#faf5ff', '#fdf2f8', '#ecfeff', '#fff7ed', '#f7fee7'];
const DEFAULT_COLUMNS = ['sales-amount', 'sales-qty', 'profit', 'listing-qty'];
const COL_COLORS = ['#eff6ff', '#ecfdf5', '#fffbeb', '#faf5ff', '#fdf2f8', '#ecfeff', '#fff7ed', '#f7fee7'];
const COL_TEXT_COLORS = ['#1d4ed8', '#047857', '#b45309', '#6d28d9', '#be185d', '#0e7490', '#c2410c', '#4d7c0f'];

const emptyCell = (): CellScore => ({ actual: 0, target: 0, totalScore: 0, maxScore: 0 });
const calcScore = (cell: CellScore): number => {
  if (!cell.target || !cell.totalScore) return 0;
  return Math.max(0, Math.min((cell.actual / cell.target) * cell.totalScore, cell.maxScore || Infinity));
};

/** 表头带问号提示图标 */
const tip = (label: string, content: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
    {label}
    <Tooltip title={content} placement="top"><QuestionCircleOutlined style={{ color: '#bbb', fontSize: 11, cursor: 'help' }} /></Tooltip>
  </span>
);

// 绩效考核页（数据源：月末盘点-发货金额 + 月利润表）
const DevPerformanceNewPage: React.FC<{ platform?: AnalyticsPlatform }> = ({ platform = 'dev' }) => {
  const RANK_KEY = platformKey(platform, 'performance_ranks');
  const SCORE_KEY = platformKey(platform, 'performance_scores_v2');
  const MONTH_KEY = platformKey(platform, 'performance_month');
  const SALARY_KEY = platformKey(platform, 'performance_salary_v1');
  const HISTORY_KEY = platformKey(platform, 'salary_history_v1');
  const EDIT_STATE_KEY = platformKey(platform, 'performance_edit_state');
  const COEFF_KEY = platformKey(platform, 'performance_point_coefficients');

  const owner = useMemo(() => getDataOwner(), []);
  const [shops, setShops] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);

  const [ranks, setRanks] = useState<RankItem[]>([]);
  const [rankModal, setRankModal] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [rankForm, setRankForm] = useState({ rank: '', name: '', baseSalary: '', targetValue: '', targetBindKey: '', commissionRate: '', performanceSalary: '' });
  const [perfMonth, setPerfMonth] = useState(() => localStorage.getItem(MONTH_KEY) || dayjs().format('YYYY-MM'));
  const [scoreRows, setScoreRows] = useState<PersonRow[]>([]);
  const [scoreColumns, setScoreColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [salaryMap, setSalaryMap] = useState<Record<string, SalaryExtra>>({});
  const [salaryRankMap, setSalaryRankMap] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [batchFill, setBatchFill] = useState<Record<string, { target: string; totalScore: string; maxScore: string; score: string }>>({});
  const [scoreEditing, setScoreEditing] = useState(() => { try { const s = JSON.parse(localStorage.getItem(EDIT_STATE_KEY) || ''); return s?.score !== false; } catch { return true; } });
  const [salaryEditing, setSalaryEditing] = useState(() => { try { const s = JSON.parse(localStorage.getItem(EDIT_STATE_KEY) || ''); return s?.salary !== false; } catch { return true; } });
  const [pointCoefficients, setPointCoefficients] = useState<Record<string, number>>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(COEFF_KEY) || '');
      if (s && typeof s === 'object') {
        if ('listing-rate' in s && !('listing-qty' in s)) {
          s['listing-qty'] = s['listing-rate'];
          delete s['listing-rate'];
          localStorage.setItem(COEFF_KEY, JSON.stringify(s));
        }
        return s;
      }
    } catch { /* ignore */ }
    return {};
  });

  // 加载店铺与运营人员
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`shop_info_${owner}`) || '[]');
      setShops(s);
      const persons = Array.from(new Set(s.map((x: any) => x.person).filter(Boolean))) as string[];
      setStaffList(persons.map((name, i) => ({ id: `person-${i}-${name}`, name })));
    } catch { setShops([]); setStaffList([]); }
  }, [owner]);

  // 月度业务数据：销售额、销售件数、利润、上架数量（按运营人员聚合）
  const monthData = useMemo(() => {
    let shipRecords: any[] = [];
    let profitRecords: any[] = [];
    let monthEndRecords: any[] = [];
    let withdrawalRecords: any[] = [];
    let returnRecords: any[] = [];
    let extRechargeRecords: any[] = [];
    try { shipRecords = JSON.parse(localStorage.getItem(`month_end_ship_${owner}`) || '[]'); } catch { /* */ }
    try { profitRecords = JSON.parse(localStorage.getItem(`shop_profit_${owner}`) || '[]'); } catch { /* */ }
    try { monthEndRecords = JSON.parse(localStorage.getItem(`month_end_check_${owner}`) || '[]'); } catch { /* */ }
    try { withdrawalRecords = JSON.parse(localStorage.getItem(`withdrawal_record_${owner}`) || '[]'); } catch { /* */ }
    try { returnRecords = JSON.parse(localStorage.getItem(`month_end_return_${owner}`) || '[]'); } catch { /* */ }
    try { extRechargeRecords = JSON.parse(localStorage.getItem(`recharge_record_${owner}`) || '[]'); } catch { /* */ }
    // 上架数量数据源
    let progressData: any[] = [];
    let photosData: any[] = [];
    try { progressData = JSON.parse(localStorage.getItem(`newstyle_progress_${owner}`) || '[]'); } catch { /* */ }
    try { photosData = JSON.parse(localStorage.getItem(`newstyle_photo_${owner}`) || '[]'); } catch { /* */ }
    const nonExclusiveBrands = loadNonExclusiveBrands(owner);

    const prevMonth = dayjs(perfMonth + '-01').subtract(1, 'month').format('YYYY-MM');

    const byStaff: Record<string, { salesAmount: number; salesQty: number; profit: number; listingQty: number }> = {};
    staffList.forEach(s => {
      const personShops = shops.filter((sh: any) => sh.person === s.name);
      let salesAmount = 0;
      let salesQty = 0;
      personShops.forEach((shop: any) => {
        shipRecords.filter((r: any) =>
          (r.chargePerson === s.name || r.shopId === shop.key || r.shopName === shop.shopName) && r.calcMonth === perfMonth
        ).forEach((r: any) => {
          salesAmount += r.realAmount || 0;
          salesQty += r.realQty || 0;
        });
      });
      let profit = 0;
      personShops.forEach((shop: any) => {
        let rec: any = profitRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === perfMonth);
        if (!rec) {
          rec = { currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0, withdrawAmount: 0,
            shippingCost: 0, realAmount: 0, refundAmount: 0, refundAmountByConfirm: 0,
            returnFee: 0, adRecharges: [], prevBalance: 0, prevPending: 0, prevDeposit: 0, prevAdFunds: 0,
            manualAdjustment: 0 };
        } else { rec = { ...rec }; }
        const prev = profitRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === prevMonth)
          || monthEndRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === prevMonth);
        if (prev) {
          rec.prevBalance = prev.currentBalance; rec.prevPending = prev.pendingAmount;
          rec.prevDeposit = prev.deposit; rec.prevAdFunds = prev.adFunds;
        }
        const checkRec = monthEndRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === perfMonth);
        if (checkRec) {
          rec.currentBalance = checkRec.currentBalance; rec.pendingAmount = checkRec.pendingAmount;
          rec.adFunds = checkRec.adFunds; rec.deposit = checkRec.deposit;
        }
        const shipRec = shipRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === perfMonth)
          || shipRecords.find((r: any) => r.shopName === shop.shopName && r.calcMonth === perfMonth);
        if (shipRec) {
          rec.shippingCost = Math.round(((shipRec.realCost || 0) + (shipRec.freightCost || 0)) * 100) / 100;
          rec.realAmount = Math.round((shipRec.realAmount || 0) * 100) / 100;
          rec.refundAmount = Math.round((shipRec.returnCost || 0) * 100) / 100;
        }
        const matchingReturns = returnRecords.filter((r: any) =>
          (r.shopId === shop.key || r.shopName === shop.shopName) && r.calcMonth === perfMonth
        );
        rec.refundAmountByConfirm = Math.round(matchingReturns.reduce((s: number, r: any) => s + (r.actualReceiptAmount || 0), 0) * 100) / 100;
        const matchingReturnFees = returnRecords.filter((r: any) =>
          (r.shopId === shop.key || r.shopName === shop.shopName) && (r.payMonth || r.calcMonth) === perfMonth
        );
        rec.returnFee = Math.round(matchingReturnFees.reduce((s: number, r: any) => s + (r.returnFee || 0), 0) * 100) / 100;
        const withdrawTotal = withdrawalRecords
          .filter((w: any) => {
            if (w.shopId !== shop.key || !w.confirmed) return false;
            const dateStr = w.withdrawalDate || w.createdAt || '';
            const normalized = dateStr.replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
            return normalized.substring(0, 7) === perfMonth;
          })
          .reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
        rec.withdrawAmount = Math.round(withdrawTotal * 100) / 100;
        const extTotal = extRechargeRecords
          .filter((er: any) => {
            if (er.status !== 'paid' || !er.paidAt) return false;
            return (er.shopId === shop.key || er.shopName === shop.shopName) && String(er.paidAt).substring(0, 7) === perfMonth;
          })
          .reduce((s: number, er: any) => s + (Number(er.amount) || 0), 0);
        const profitR = extTotal > 0 ? { ...rec, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : rec;
        profit += calcProfit(profitR);
      });
      const listingStats = calcListingStats(
        personShops.map((sh: any) => ({ shopName: sh.shopName || '', brand: sh.brand || '' })),
        progressData, photosData, nonExclusiveBrands
      );
      byStaff[s.name] = { salesAmount: Math.round(salesAmount * 100) / 100, salesQty, profit: Math.round(profit * 100) / 100, listingQty: listingStats.listedCount };
    });
    return { byStaff };
  }, [perfMonth, staffList, shops, owner]);

  const load = useCallback(() => {
    let loadedRanks: RankItem[] = [];
    try { const parsed = JSON.parse(localStorage.getItem(RANK_KEY) || ''); if (Array.isArray(parsed)) loadedRanks = parsed; } catch { /* */ }
    if (loadedRanks.length) setRanks(loadedRanks);
    try {
      const saved = JSON.parse(localStorage.getItem(SCORE_KEY) || '');
      if (saved && Array.isArray(saved.rows)) {
        // 兼容旧key：将 scores 中的 listing-rate 迁移到 listing-qty
        const migratedRows = saved.rows.map((row: any) => {
          if (row.scores?.['listing-rate'] && !row.scores?.['listing-qty']) {
            return { ...row, scores: { ...row.scores, 'listing-qty': row.scores['listing-rate'] } };
          }
          return row;
        });
        setScoreRows(migratedRows);
        setScoreColumns(saved.columns?.length ? saved.columns.map((c: string) => c === 'listing-rate' ? 'listing-qty' : c) : DEFAULT_COLUMNS);
      }
    } catch { /* ignore */ }
    try {
      const sal = JSON.parse(localStorage.getItem(SALARY_KEY) || '');
      setSalaryMap(sal?.extras || {}); setSalaryRankMap(sal?.rankMap || {});
    } catch { /* ignore */ }
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')); } catch { setHistory([]); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // 保证每个运营人员都有绩效分行；切换月份时刷新自动实际值；职级绑定时自动填充目标
  useEffect(() => {
    if (!staffList.length) return; // 人员列表尚未加载完成时跳过，避免清空已保存数据
    localStorage.setItem(MONTH_KEY, perfMonth);
    setScoreRows(prev => {
      const existing = new Map(prev.map(r => [r.userId, r]));
      const rows = staffList.map(s => {
        const row = existing.get(s.id) || { userId: s.id, userName: s.name, scores: {} as Record<string, CellScore> };
        const scores = { ...row.scores };
        const d = monthData.byStaff[s.name] || ({} as any);
        const auto: Record<string, number> = {
          'sales-amount': d.salesAmount || 0,
          'sales-qty': d.salesQty || 0,
          'profit': d.profit || 0,
          'listing-qty': d.listingQty || 0,
        };
        Object.entries(auto).forEach(([k, v]) => { scores[k] = { ...(scores[k] || emptyCell()), actual: v }; });
        // 职级绑定目标值自动填充（仅当该列尚无目标值时才填充，保留手工输入）
        const rankId = salaryRankMap[s.id] || '';
        const rank = ranks.find(r => r.id === rankId);
        if (rank?.targetBindKey) {
          const scoreKey = BIND_TO_SCORE_KEY[rank.targetBindKey];
          if (scoreKey && scores[scoreKey] && !scores[scoreKey].target) {
            scores[scoreKey] = { ...scores[scoreKey], target: rank.targetValue };
          }
        }
        return { ...row, userName: s.name, scores };
      });
      localStorage.setItem(SCORE_KEY, JSON.stringify({ rows, columns: scoreColumns }));
      return rows;
    });
  }, [perfMonth, monthData, staffList, scoreColumns, salaryRankMap, ranks]);

  const saveScoreData = (rows: PersonRow[], cols: string[]) => {
    setScoreRows(rows); setScoreColumns(cols);
    localStorage.setItem(SCORE_KEY, JSON.stringify({ rows, columns: cols }));
  };
  const addScoreColumn = (key: string) => {
    if (!key || scoreColumns.includes(key)) return;
    const cols = [...scoreColumns, key];
    saveScoreData(scoreRows.map(r => ({ ...r, scores: { ...r.scores, [key]: emptyCell() } })), cols);
  };
  const removeScoreColumn = (key: string) => {
    saveScoreData(scoreRows.map(r => { const { [key]: _, ...rest } = r.scores; return { ...r, scores: rest }; }), scoreColumns.filter(c => c !== key));
  };
  const updateCell = (userId: string, col: string, field: keyof CellScore, value: number) => {
    const rows = scoreRows.map(r => r.userId !== userId ? r : { ...r, scores: { ...r.scores, [col]: { ...(r.scores[col] || emptyCell()), [field]: value } } });
    saveScoreData(rows, scoreColumns);
  };
  const applyBatch = (col: string) => {
    const bf = batchFill[col]; if (!bf) return;
    const rows = scoreRows.map(r => {
      const orig = r.scores[col] || emptyCell();
      return {
        ...r, scores: {
          ...r.scores, [col]: {
            ...orig,
            target: bf.target !== '' && bf.target !== undefined ? Number(bf.target) || 0 : orig.target,
            totalScore: bf.totalScore !== '' && bf.totalScore !== undefined ? Number(bf.totalScore) || 0 : orig.totalScore,
            maxScore: bf.maxScore !== '' && bf.maxScore !== undefined ? Number(bf.maxScore) || 0 : orig.maxScore,
          },
        },
      };
    });
    saveScoreData(rows, scoreColumns);
    message.success('批量填充已应用');
  };

  // 职级 CRUD
  const saveRanks = (next: RankItem[]) => { setRanks(next); localStorage.setItem(RANK_KEY, JSON.stringify(next)); };
  const confirmRank = () => {
    if (!rankForm.name.trim()) { message.warning('请输入职级名称'); return; }
    if (!rankForm.targetBindKey) { message.warning('请选择绑定的考核项目'); return; }
    const item: RankItem = {
      id: editIdx !== null ? ranks[editIdx].id : Date.now().toString(),
      rank: parseInt(rankForm.rank) || ranks.length + 1,
      name: rankForm.name.trim(),
      baseSalary: parseFloat(rankForm.baseSalary) || 0,
      targetValue: parseFloat(rankForm.targetValue) || 0,
      targetBindKey: rankForm.targetBindKey || '',
      commissionRate: parseFloat(rankForm.commissionRate) || 0,
      performanceSalary: parseFloat(rankForm.performanceSalary) || 0,
    };
    saveRanks(editIdx !== null ? ranks.map((r, i) => i === editIdx ? item : r) : [...ranks, item]);
    setRankModal(false);
    message.success('职级已保存');
  };

  // 工资计算
  const calcEarnedSalary = (userId: string) => {
    const rankId = salaryRankMap[userId] || '';
    const rank = ranks.find(r => r.id === rankId);
    const baseSalary = rank?.baseSalary || 0;
    const perfSalary = rank?.performanceSalary || 0;
    const commRate = rank?.commissionRate || 0;
    const row = scoreRows.find(r => r.userId === userId);
    let perfScore = 0;
    if (row) {
      perfScore = Object.values(row.scores).reduce((s, c) => s + calcScore(c), 0);
      if (row.maxTotal && row.maxTotal > 0) perfScore = Math.min(perfScore, row.maxTotal);
    }
    const earnedPerfSalary = perfSalary * perfScore / 100;
    const extra = salaryMap[userId] || { commissionType: '', otherDeduction: 0, otherAllowance: 0 };
    const personName = staffList.find(s => s.id === userId)?.name || '';
    const d = monthData.byStaff[personName] || ({} as any);
    const commItem = extra.commissionType ? ((d as any)[extra.commissionType] || 0) : 0;
    const commissionAmount = commItem * commRate;
    const earned = baseSalary + earnedPerfSalary + commissionAmount + extra.otherAllowance - extra.otherDeduction;
    // 本月目标值完成率
    let targetCompletion = 0;
    if (rank?.targetBindKey && rank.targetValue > 0) {
      const actualKey = rank.targetBindKey === 'listingQty' ? 'listingQty' : rank.targetBindKey;
      const actualVal = (d as any)[actualKey] || 0;
      targetCompletion = Math.round((actualVal / rank.targetValue) * 10000) / 100;
    }
    // 上月职级和上月完成率（从历史薪资中查找上月记录）
    let lastMonthRank = '-';
    let lastMonthCompletion = 0;
    const prevMonthStr = dayjs(perfMonth + '-01').subtract(1, 'month').format('YYYY-MM');
    const prevHistory = history.find(h => h.perfMonth === prevMonthStr);
    if (prevHistory) {
      const prevRow = prevHistory.rows?.find((r: any) => r.userName === personName);
      if (prevRow) {
        const prevRankName = prevRow.rankName || '-';
        lastMonthRank = prevRankName !== '-' ? (prevRankName.match(/^P\d+/)?.[0] || prevRankName) : '-';
        lastMonthCompletion = prevRow.targetCompletion || 0;
      }
    }
    return { baseSalary, perfSalary, perfScore, earnedPerfSalary, commItem, commRate, commissionAmount, deduction: extra.otherDeduction, allowance: extra.otherAllowance, earned, rankName: rank ? `P${rank.rank}` : '-', targetCompletion, lastMonthRank, lastMonthCompletion };
  };

  const updateSalaryExtra = (userId: string, field: keyof SalaryExtra, value: any) => {
    const next = { ...salaryMap, [userId]: { ...(salaryMap[userId] || { commissionType: '', otherDeduction: 0, otherAllowance: 0 }), [field]: value } };
    setSalaryMap(next);
    localStorage.setItem(SALARY_KEY, JSON.stringify({ extras: next, rankMap: salaryRankMap }));
  };
  const updateSalaryRank = (userId: string, rankId: string) => {
    const next = { ...salaryRankMap, [userId]: rankId };
    setSalaryRankMap(next);
    localStorage.setItem(SALARY_KEY, JSON.stringify({ extras: salaryMap, rankMap: next }));
  };

  const handleSaveHistory = () => {
    const existingIdx = history.findIndex(h => h.perfMonth === perfMonth);
    if (existingIdx >= 0) {
      Modal.confirm({
        title: '该月份历史薪资已存在',
        content: `${perfMonth} 的历史薪资已保存于 ${history[existingIdx].name}，确定覆盖吗？覆盖后将同时更新对应的积分明细。`,
        okText: '确定覆盖',
        cancelText: '取消',
        onOk: () => doSaveHistory(true),
      });
    } else {
      doSaveHistory(false);
    }
  };

  const doSaveHistory = (overwrite: boolean) => {
    const now = new Date();
    const existingIdx = history.findIndex(h => h.perfMonth === perfMonth);
    const item = {
      id: overwrite ? history[existingIdx].id : Date.now().toString(),
      name: overwrite ? history[existingIdx].name : `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      savedAt: now.toISOString(), perfMonth,
      rows: scoreRows.map(row => ({ userName: row.userName, ...calcEarnedSalary(row.userId) })),
    };
    let next: typeof history;
    if (overwrite) {
      next = history.map((h, i) => i === existingIdx ? item : h);
    } else {
      next = [item, ...history];
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);

    // 自动生成/更新积分明细：每个运营人员 × 每个有系数的考核项目
    const activeCols = scoreColumns.filter(col => (pointCoefficients[col] || 0) > 0);
    if (activeCols.length > 0) {
      const existingRecords = loadPlatformPointRecords(platform);
      // 覆盖模式：先移除该月份旧的绩效积分记录
      const filteredRecords = overwrite
        ? existingRecords.filter(r => !(r.id.startsWith('perf_') && r.actionTitle.startsWith(perfMonth)))
        : existingRecords;
      const newRecords: DevPointRecord[] = [];
      const createdAt = dayjs().format('YYYY-MM-DD HH:mm');
      scoreRows.forEach(row => {
        activeCols.forEach(col => {
          const cell = row.scores[col];
          if (!cell) return;
          const coeff = pointCoefficients[col] || 0;
          const points = Math.round((cell.actual || 0) * coeff * 100) / 100;
          const label = SCORE_ITEM_OPTIONS.find(o => o.key === col)?.label || col;
          const sourceMap: Record<string, string> = { 'sales-amount': '月末盘点-发货金额', 'sales-qty': '月末盘点-发货金额', 'profit': '月利润表', 'listing-qty': '新款列表' };
          const source = sourceMap[col] || '';
          newRecords.push({
            id: `perf_${Date.now()}_${row.userId}_${col}`,
            staffName: row.userName,
            actionType: col,
            actionTitle: `${perfMonth} ${label}`,
            points,
            reason: `${label} ${cell.actual} × 系数${coeff}${source ? `（数据来源：${source}）` : ''}`,
            createdAt,
          });
        });
      });
      if (newRecords.length > 0) {
        savePlatformPointRecords(platform, [...newRecords, ...filteredRecords]);
        message.success(overwrite ? `薪资已覆盖更新，积分明细已同步（${newRecords.length}条）` : `薪资已保存，同时生成 ${newRecords.length} 条积分明细`);
      } else {
        message.success(overwrite ? '薪资已覆盖更新' : '薪资已保存到历史记录');
      }
    } else {
      message.success(overwrite ? '薪资已覆盖更新' : '薪资已保存到历史记录');
    }
  };

  const scoreLabel = (key: string) => SCORE_ITEM_OPTIONS.find(o => o.key === key)?.label || key;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        .perf-locked-input .ant-input-number-input {
          color: #000 !important;
        }
        .perf-locked-select .ant-select-selection-item {
          color: #000 !important;
        }
      `}</style>
      <Card
        title={`绩效考核 - ${perfMonth}`}
        extra={
          <Space>
            <DatePicker picker="month" value={dayjs(perfMonth)} onChange={d => d && setPerfMonth(d.format('YYYY-MM'))} />
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>历史薪资</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveHistory}>保存薪资到历史</Button>
          </Space>
        }
      >
        {/* 职级设置 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>职级设置</span>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => {
              setEditIdx(null);
              setRankForm({ rank: String(ranks.length ? Math.max(...ranks.map(r => r.rank)) + 1 : 1), name: '', baseSalary: '', targetValue: '', targetBindKey: '', commissionRate: '', performanceSalary: '' });
              setRankModal(true);
            }}>新增职级</Button>
          </div>
          <Table rowKey="id" size="small" bordered pagination={false} dataSource={ranks}
            columns={[
              { title: tip('职级', '功能说明：手动配置，由管理员设置职级序号（P1、P2…）'), dataIndex: 'rank', width: 70, align: 'center', render: (v: number, _r: RankItem, i: number) => <span style={{ background: RANK_BG_COLORS[i % RANK_BG_COLORS.length], color: RANK_COLORS[i % RANK_COLORS.length], fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>P{v}</span> },
              { title: tip('名称', '功能说明：手动配置，由管理员设置职级名称'), dataIndex: 'name', width: 140, align: 'center', render: (v: string, _r: RankItem, i: number) => <span style={{ background: RANK_BG_COLORS[i % RANK_BG_COLORS.length], color: RANK_COLORS[i % RANK_COLORS.length], fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>{v}</span> },
              { title: tip('基本工资', '功能说明：手动配置，由管理员设置该职级的基本工资'), dataIndex: 'baseSalary', width: 110, align: 'center', render: (v: number) => `¥${v}` },
              { title: tip('目标值', '功能说明：手动配置，可绑定考核项目作为完成率计算基准'), dataIndex: 'targetValue', width: 150, align: 'center', render: (v: number, r: RankItem) => {
                const bindLabel = COMMISSION_TYPE_OPTIONS.find(o => o.key === r.targetBindKey)?.label;
                return <span>¥{v.toLocaleString()}{bindLabel ? <Tag color="blue" style={{ marginLeft: 4 }}>绑定{bindLabel}</Tag> : null}</span>;
              }},
              { title: tip('提成系数', '功能说明：手动配置，用于工资表中提成金额的计算'), dataIndex: 'commissionRate', width: 100, align: 'center', render: (v: number) => `${(v * 100).toFixed(0)}%` },
              { title: tip('绩效工资', '功能说明：手动配置，该职级的绩效工资基数'), dataIndex: 'performanceSalary', width: 110, align: 'center', render: (v: number) => `¥${v}` },
              {
                title: tip('操作', '功能说明：编辑或删除当前职级配置'), key: 'op', width: 110, align: 'center',
                render: (_: any, _r: RankItem, i: number) => (
                  <Space size={4}>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
                      setEditIdx(i);
                      const r = ranks[i];
                      setRankForm({ rank: String(r.rank), name: r.name, baseSalary: String(r.baseSalary), targetValue: String(r.targetValue), targetBindKey: r.targetBindKey || '', commissionRate: String(r.commissionRate), performanceSalary: String(r.performanceSalary) });
                      setRankModal(true);
                    }} />
                    <Popconfirm title="删除该职级？" onConfirm={() => saveRanks(ranks.filter((_, j) => j !== i))}>
                      <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ] as any}
          />
        </div>


        {/* 绩效分矩阵 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>绩效分（实际值按 {perfMonth} 业务数据自动统计；得分 = 实际/目标×绩效总分，不超过最高分）</span>
            <Space>
              <Select size="small" style={{ width: 180 }} placeholder="添加考核项目列" value={undefined as any}
                options={SCORE_ITEM_OPTIONS.filter(o => !scoreColumns.includes(o.key)).map(o => ({ value: o.key, label: o.label }))}
                onChange={addScoreColumn} />
              <Button size="small" icon={scoreEditing ? <LockOutlined /> : <UnlockOutlined />}
                onClick={() => { const next = !scoreEditing; setScoreEditing(next); localStorage.setItem(EDIT_STATE_KEY, JSON.stringify({ score: next, salary: salaryEditing })); if (!next) message.info('绩效分已锁定保存'); else message.info('绩效分编辑已开启'); }}>
                {scoreEditing ? '锁定' : '编辑'}
              </Button>
            </Space>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th rowSpan={2} style={{ padding: 8, border: '1px solid #f0f0f0', textAlign: 'left', minWidth: 100 }}>{tip('运营人员', '数据来源：店铺管理中的店铺负责人')}</th>
                  {scoreColumns.map((col, ci) => {
                    const sourceMap: Record<string, string> = { 'sales-amount': '月末盘点-发货金额', 'sales-qty': '月末盘点-发货金额', 'profit': '月利润表', 'listing-qty': '新款列表' };
                    return (
                    <th key={col} colSpan={5} style={{ padding: 8, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 320 }}>
                      <Space size={4}>
                        <Tooltip title={`数据来源：${sourceMap[col] || '手动配置'}`}><span style={{ fontWeight: 700, color: COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] }}>{scoreLabel(col)}</span></Tooltip>
                        {scoreEditing && <Button size="small" type="text" danger icon={<CloseCircleOutlined />} onClick={() => removeScoreColumn(col)} />}
                      </Space>
                    </th>
                    );
                  })}
                  <th rowSpan={2} style={{ padding: 8, border: '1px solid #f0f0f0', width: 90 }}>{tip('绩效分合计', '功能说明：自动计算，所有考核项目的绩效得分之和')}</th>
                </tr>
                <tr style={{ background: '#fafafa' }}>
                  {scoreColumns.map((col, ci) => {
                    const subTips: Record<string, string> = {
                      '实际值': `数据来源：根据${scoreLabel(col)}业务数据自动统计`,
                      '目标值': '功能说明：手动配置，该人员的考核目标值',
                      '绩效总分': '功能说明：手动配置，该项目的绩效总分上限',
                      '最高得分': '功能说明：手动配置，得分上限值（超过则截断）',
                      '绩效得分': '功能说明：自动计算，得分 = 实际/目标×总分（不超过最高分）',
                    };
                    return (
                    <React.Fragment key={col}>
                      {['实际值', '目标值', '绩效总分', '最高得分', '绩效得分'].map(sub => (
                        <th key={sub} style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], fontSize: 11, fontWeight: 600, minWidth: sub === '实际值' ? 56 : 48, whiteSpace: 'nowrap', color: COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] }}>{tip(sub, subTips[sub] || '')}</th>
                      ))}
                    </React.Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {scoreEditing && (
                  <tr>
                    <td style={{ padding: 6, border: '1px solid #f0f0f0', fontWeight: 600, background: '#f5f5f5' }}>批量填充</td>
                    {scoreColumns.map((col, ci) => (
                      <React.Fragment key={col}>
                        <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 56 }}><span style={{ color: '#999', fontSize: 11 }}>自动</span></td>
                        <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48 }}><InputNumber controls={false} size="small" style={{ width: '100%' }} placeholder="值" value={Number(batchFill[col]?.target) || null} onChange={v => setBatchFill(b => ({ ...b, [col]: { ...(b[col] || { target: '', totalScore: '', maxScore: '', score: '' }), target: String(v ?? '') } }))} /></td>
                        <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48 }}><InputNumber controls={false} size="small" style={{ width: '100%' }} placeholder="值" value={Number(batchFill[col]?.totalScore) || null} onChange={v => setBatchFill(b => ({ ...b, [col]: { ...(b[col] || { target: '', totalScore: '', maxScore: '', score: '' }), totalScore: String(v ?? '') } }))} /></td>
                        <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48 }}><InputNumber controls={false} size="small" style={{ width: '100%' }} placeholder="值" value={Number(batchFill[col]?.maxScore) || null} onChange={v => setBatchFill(b => ({ ...b, [col]: { ...(b[col] || { target: '', totalScore: '', maxScore: '', score: '' }), maxScore: String(v ?? '') } }))} /></td>
                        <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48, textAlign: 'center' }}><Button size="small" type="primary" onClick={() => applyBatch(col)}>填充</Button></td>
                      </React.Fragment>
                    ))}
                    <td style={{ padding: 6, border: '1px solid #f0f0f0' }}></td>
                  </tr>
                )}
                {scoreRows.map(row => {
                  const total = Object.values(row.scores).reduce((s, c) => s + calcScore(c), 0);
                  return (
                    <tr key={row.userId}>
                      <td style={{ padding: 8, border: '1px solid #f0f0f0', fontWeight: 600 }}>{row.userName}</td>
                      {scoreColumns.map((col, ci) => {
                        const cell = row.scores[col] || emptyCell();
                        return (
                          <React.Fragment key={col}>
                            <td style={{ padding: 6, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 56 }}>
                              <Tooltip title="实际值（自动）"><span style={{ color: scoreEditing ? COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] : '#000', fontWeight: 700 }}>{cell.actual}</span></Tooltip>
                            </td>
                            <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48 }}>
                              <div className={!scoreEditing ? 'perf-locked-input' : undefined}>
                                <InputNumber controls={false} size="small" style={{ width: '100%', color: scoreEditing ? COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] : undefined }} placeholder="目标" disabled={!scoreEditing} value={cell.target || null} onChange={v => updateCell(row.userId, col, 'target', Number(v) || 0)} />
                              </div>
                            </td>
                            <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48 }}>
                              <div className={!scoreEditing ? 'perf-locked-input' : undefined}>
                                <InputNumber controls={false} size="small" style={{ width: '100%', color: scoreEditing ? COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] : undefined }} placeholder="总分" disabled={!scoreEditing} value={cell.totalScore || null} onChange={v => updateCell(row.userId, col, 'totalScore', Number(v) || 0)} />
                              </div>
                            </td>
                            <td style={{ padding: 4, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48 }}>
                              <div className={!scoreEditing ? 'perf-locked-input' : undefined}>
                                <InputNumber controls={false} size="small" style={{ width: '100%', color: scoreEditing ? COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] : undefined }} placeholder="上限" disabled={!scoreEditing} value={cell.maxScore || null} onChange={v => updateCell(row.userId, col, 'maxScore', Number(v) || 0)} />
                              </div>
                            </td>
                            <td style={{ padding: 6, border: '1px solid #f0f0f0', background: COL_COLORS[ci % COL_COLORS.length], minWidth: 48, textAlign: 'center', fontWeight: 700, color: scoreEditing ? COL_TEXT_COLORS[ci % COL_TEXT_COLORS.length] : '#000' }}>{calcScore(cell).toFixed(1)}</td>
                          </React.Fragment>
                        );
                      })}
                      <td style={{ padding: 8, border: '1px solid #f0f0f0', textAlign: 'center', fontWeight: 800, color: scoreEditing ? '#1e3a5f' : '#000' }}>{total.toFixed(1)}</td>
                    </tr>
                  );
                })}
                {!scoreRows.length && <tr><td colSpan={scoreColumns.length * 5 + 2} style={{ padding: 24, textAlign: 'center', color: '#999' }}>暂无运营人员，请先在店铺管理中添加负责人</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* 工资表 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>工资表（应得 = 基本工资 + 绩效工资×绩效分/100 + 提成项目×提成系数 + 其他补助 - 其他扣款）</span>
            <Button size="small" icon={salaryEditing ? <LockOutlined /> : <UnlockOutlined />}
              onClick={() => { const next = !salaryEditing; setSalaryEditing(next); localStorage.setItem(EDIT_STATE_KEY, JSON.stringify({ score: scoreEditing, salary: next })); if (!next) message.info('工资表已锁定保存'); else message.info('工资表编辑已开启'); }}>
              {salaryEditing ? '锁定' : '编辑'}
            </Button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {[
                    { h: '运营人员', t: '数据来源：店铺管理中的店铺负责人' },
                    { h: '职级', t: '功能说明：手动选择，从职级设置中选择' },
                    { h: '上月职级', t: '数据来源：历史薪资中上一次保存的职级' },
                    { h: '上月完成率', t: '数据来源：历史薪资中上一次的目标完成率' },
                    { h: '基本工资', t: '数据来源：职级设置中的基本工资' },
                    { h: '绩效工资', t: '数据来源：职级设置中的绩效工资' },
                    { h: '绩效分', t: '数据来源：绩效分矩阵中自动计算的绩效分合计' },
                    { h: '应得绩效', t: '功能说明：自动计算 = 绩效工资×绩效分/100' },
                    { h: '本月目标完成率', t: '功能说明：自动计算 = 实际值/目标值×100%' },
                    { h: '提成项目', t: '功能说明：手动选择，选择提成计算的基准项目' },
                    { h: '提成项目值', t: '数据来源：根据选择的提成项目自动获取业务数据' },
                    { h: '提成系数', t: '数据来源：职级设置中的提成系数' },
                    { h: '提成金额', t: '功能说明：自动计算 = 提成项目值×提成系数' },
                    { h: '其他扣款', t: '功能说明：手动填写，其他应扣除的项目金额' },
                    { h: '其他补助', t: '功能说明：手动填写，其他应发放的补助金额' },
                    { h: '应得薪资', t: '功能说明：自动计算 = 基本工资+绩效工资×绩效分/100+提成金额+其他补助-其他扣款' },
                  ].map(item => (
                    <th key={item.h} style={{ padding: 8, border: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{tip(item.h, item.t)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffList.map(s => {
                  const cal = calcEarnedSalary(s.id);
                  const extra = salaryMap[s.id] || { commissionType: '', otherDeduction: 0, otherAllowance: 0 };
                  const completionColor = cal.targetCompletion >= 100 ? '#16a34a' : cal.targetCompletion > 0 ? '#d97706' : '#999';
                  return (
                    <tr key={s.id}>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', fontWeight: 600 }}>{s.name}</td>
                      <td style={{ padding: 4, border: '1px solid #f0f0f0', background: salaryEditing ? (ranks.findIndex(r => r.id === salaryRankMap[s.id]) >= 0 ? RANK_BG_COLORS[ranks.findIndex(r => r.id === salaryRankMap[s.id]) % RANK_BG_COLORS.length] : undefined) : undefined, color: salaryEditing ? (ranks.findIndex(r => r.id === salaryRankMap[s.id]) >= 0 ? RANK_COLORS[ranks.findIndex(r => r.id === salaryRankMap[s.id]) % RANK_COLORS.length] : undefined) : undefined }}>
                        <div className={!salaryEditing ? 'perf-locked-select' : undefined}>
                          <Select size="small" style={{ width: '100%' }} placeholder="未定职级" disabled={!salaryEditing}
                            value={salaryRankMap[s.id] || undefined} allowClear
                            options={ranks.map((r, ri) => ({ value: r.id, label: <span style={{ background: RANK_BG_COLORS[ri % RANK_BG_COLORS.length], color: RANK_COLORS[ri % RANK_COLORS.length], fontWeight: 600, padding: '1px 6px', borderRadius: 3 }}>P{r.rank} - {r.name}</span> }))} onChange={v => updateSalaryRank(s.id, v || '')} />
                        </div>
                      </td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'center', color: '#666' }}>{cal.lastMonthRank}</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'center', fontWeight: 600, color: cal.lastMonthCompletion >= 100 ? '#16a34a' : cal.lastMonthCompletion > 0 ? '#d97706' : '#999' }}>
                        {cal.lastMonthCompletion > 0 ? `${cal.lastMonthCompletion.toFixed(1)}%` : '-'}
                      </td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'right' }}>¥{cal.baseSalary}</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'right' }}>¥{cal.perfSalary}</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'center', color: salaryEditing ? '#1d4ed8' : '#000', fontWeight: 700 }}>{cal.perfScore.toFixed(1)}</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'right' }}>¥{cal.earnedPerfSalary.toFixed(2)}</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'center', fontWeight: 700, color: salaryEditing ? completionColor : '#000' }}>
                        {cal.targetCompletion > 0 ? `${cal.targetCompletion.toFixed(1)}%` : '-'}
                      </td>
                      <td style={{ padding: 4, border: '1px solid #f0f0f0' }}>
                        <div className={!salaryEditing ? 'perf-locked-select' : undefined}>
                          <Select size="small" style={{ width: 150 }} placeholder="选择提成项目" disabled={!salaryEditing}
                            value={extra.commissionType || undefined} allowClear
                            options={COMMISSION_TYPE_OPTIONS.map(o => ({ value: o.key, label: o.label }))} onChange={v => updateSalaryExtra(s.id, 'commissionType', v || '')} />
                        </div>
                      </td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'right' }}>{cal.commItem}</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'center' }}>{(cal.commRate * 100).toFixed(0)}%</td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'right' }}>¥{cal.commissionAmount.toFixed(2)}</td>
                      <td style={{ padding: 4, border: '1px solid #f0f0f0' }}><InputNumber size="small" style={{ width: 80 }} disabled={!salaryEditing} value={extra.otherDeduction} onChange={v => updateSalaryExtra(s.id, 'otherDeduction', Number(v) || 0)} /></td>
                      <td style={{ padding: 4, border: '1px solid #f0f0f0' }}><InputNumber size="small" style={{ width: 80 }} disabled={!salaryEditing} value={extra.otherAllowance} onChange={v => updateSalaryExtra(s.id, 'otherAllowance', Number(v) || 0)} /></td>
                      <td style={{ padding: 6, border: '1px solid #f0f0f0', textAlign: 'right', fontWeight: 800, color: salaryEditing ? '#15803d' : '#000' }}>¥{cal.earned.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {!staffList.length && <tr><td colSpan={16} style={{ padding: 24, textAlign: 'center', color: '#999' }}>暂无运营人员</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Modal title={editIdx !== null ? '编辑职级' : '新增职级'} open={rankModal} onOk={confirmRank} onCancel={() => setRankModal(false)} okText="保存" cancelText="取消" width={560} destroyOnClose>
        <Form layout="vertical" style={{ marginTop: 12 }}>
          <Space style={{ display: 'flex' }} size={12} wrap>
            <Form.Item label="职级序号" style={{ width: 100 }}><Input style={{ width: '100%' }} prefix="P" value={rankForm.rank} onChange={e => setRankForm(f => ({ ...f, rank: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="1" /></Form.Item>
            <Form.Item label="职级名称" style={{ width: 160 }}><Input value={rankForm.name} onChange={e => setRankForm(f => ({ ...f, name: e.target.value }))} placeholder="如：初级运营" /></Form.Item>
            <Form.Item label="基本工资" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} value={Number(rankForm.baseSalary) || null} onChange={v => setRankForm(f => ({ ...f, baseSalary: String(v ?? '') }))} /></Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size={12} wrap>
            <Form.Item label="目标值" style={{ width: 140 }}><InputNumber style={{ width: '100%' }} value={Number(rankForm.targetValue) || null} onChange={v => setRankForm(f => ({ ...f, targetValue: String(v ?? '') }))} /></Form.Item>
            <Form.Item label="绑定考核项目" style={{ width: 160 }}>
              <Select placeholder="请选择绑定的考核项目" value={rankForm.targetBindKey || undefined}
                options={COMMISSION_TYPE_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
                onChange={v => setRankForm(f => ({ ...f, targetBindKey: v || '' }))} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size={12} wrap>
            <Form.Item label="提成系数" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} step={1} min={0} max={1000} addonAfter="%" value={Number(rankForm.commissionRate) * 100 || null} onChange={v => setRankForm(f => ({ ...f, commissionRate: String((Number(v) || 0) / 100) }))} /></Form.Item>
            <Form.Item label="绩效工资" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} value={Number(rankForm.performanceSalary) || null} onChange={v => setRankForm(f => ({ ...f, performanceSalary: String(v ?? '') }))} /></Form.Item>
          </Space>
          <div style={{ fontSize: 12, color: '#888', marginTop: -8, marginBottom: 8 }}>
            提示：绑定考核项目后，该职级人员的对应项目"目标值"将自动填充，目标值完成率将在工资表中显示。
          </div>
        </Form>
      </Modal>

      <Modal title="历史薪资" open={historyOpen} onCancel={() => setHistoryOpen(false)} width={900} footer={<Button onClick={() => setHistoryOpen(false)}>关闭</Button>}>
        {history.length === 0 ? <div style={{ textAlign: 'center', color: '#999', padding: '30px 0' }}>暂无历史薪资记录</div> : history.map(h => (
          <div key={h.id} style={{ marginBottom: 16, border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Tag color="blue">{h.name}</Tag>
              <Space>
                <Tag>绩效月份 {h.perfMonth}</Tag>
                <Popconfirm title="删除该历史记录？" onConfirm={() => { const next = history.filter(x => x.id !== h.id); localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setHistory(next); }}>
                  <Button size="small" danger type="link">删除</Button>
                </Popconfirm>
              </Space>
            </div>
            <Table rowKey="userName" size="small" bordered pagination={false} dataSource={h.rows}
              columns={[
                { title: '运营人员', dataIndex: 'userName', width: 100, align: 'center' },
                { title: '职级', dataIndex: 'rankName', width: 130, align: 'center' },
                { title: '基本工资', dataIndex: 'baseSalary', width: 90, align: 'right' },
                { title: '绩效分', dataIndex: 'perfScore', width: 80, align: 'center', render: (v: number) => v?.toFixed(1) },
                { title: '应得绩效', dataIndex: 'earnedPerfSalary', width: 90, align: 'right', render: (v: number) => `¥${(v || 0).toFixed(2)}` },
                { title: '目标值完成率', dataIndex: 'targetCompletion', width: 100, align: 'center', render: (v: number) => {
                  if (!v) return '-';
                  const c = v >= 100 ? '#16a34a' : '#d97706';
                  return <span style={{ fontWeight: 700, color: c }}>{v.toFixed(1)}%</span>;
                }},
                { title: '提成金额', dataIndex: 'commissionAmount', width: 90, align: 'right', render: (v: number) => `¥${(v || 0).toFixed(2)}` },
                { title: '扣款', dataIndex: 'deduction', width: 80, align: 'right' },
                { title: '补助', dataIndex: 'allowance', width: 80, align: 'right' },
                { title: '应得薪资', dataIndex: 'earned', width: 100, align: 'right', render: (v: number) => <span style={{ fontWeight: 800, color: '#15803d' }}>¥{(v || 0).toFixed(2)}</span> },
              ] as any}
            />
          </div>
        ))}
      </Modal>
    </div>
  );
};

export default DevPerformanceNewPage;
