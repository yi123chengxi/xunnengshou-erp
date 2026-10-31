import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Space, Select, DatePicker, InputNumber, message, Typography, Row, Col, Tag, Tooltip, Modal } from 'antd';
import { ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { AnalyticsPlatform } from '../../utils/devStore';
import { loadNonExclusiveBrands, calcListingStats } from '../../utils/listingStats';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

// ===================== 类型定义 =====================
interface ShopInfo {
  key: string;
  shopName: string;
  accountId: string;
  platform?: string;
  person?: string;
  brand?: string;
  createdAt: string;
}

interface ShipRecord {
  key: string;
  shopName: string;
  shopId: string;
  chargePerson?: string;
  calcMonth: string;
  realOrders: number;
  realQty: number;
  returnOrders: number;
  returnQty: number;
  realCost: number;
  realAmount: number;
  freightCost: number;
  returnCost: number;
  laborCost: number;
  createdAt: string;
  updatedAt: string;
}

interface ProfitRecord {
  key: string;
  shopId: string;
  shopName: string;
  calcMonth: string;
  profit: number;
  [k: string]: any;
}

/** 手动利润记录 */
interface ManualProfitEntry {
  person: string;
  month: string;
  profit: number;
}

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

const fmt = (v: number | undefined | null) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtNum = (v: number | undefined | null) => {
  if (v === undefined || v === null || isNaN(v)) return '0';
  return v.toLocaleString('zh-CN');
};

/** 利润计算（与 ShopProfitPage 保持一致的公式） */
const calcProfit = (r: Record<string, any>): number => {
  const curNet = (r.currentBalance || 0) + (r.pendingAmount || 0) + (r.adFunds || 0)
    + (r.withdrawAmount || 0) + (r.deposit || 0);
  const prevNet = (r.prevBalance || 0) + (r.prevPending || 0) + (r.prevDeposit || 0) + (r.prevAdFunds || 0);
  const totalRecharge = Array.isArray(r.adRecharges) ? r.adRecharges.reduce((s: number, x: any) => s + (x.amount || 0), 0) : 0;
  return Math.round((curNet - prevNet - (r.shippingCost || 0) + (r.refundAmount || 0) - (r.returnFee || 0) - totalRecharge + (r.manualAdjustment || 0)) * 100) / 100;
};

// ===================== 运营统计聚合行 =====================
interface OpsStatsRow {
  key: string;
  person: string;
  shopCount: number;
  shouldList: number;
  notListed: number;
  listingRate: number;
  realOrders: number;
  realQty: number;
  returnOrders: number;
  returnQty: number;
  returnRate: number;
  realAmount: number;
  profit: number;
}

// ===================== 主组件 =====================
export const DevStaffPaymentPage: React.FC<{ platform?: AnalyticsPlatform }> = ({ platform = 'dev' }) => {
  const owner = useMemo(() => getDataOwner(), []);
  const [calcMonth, setCalcMonth] = useState(dayjs().format('YYYY-MM'));
  const [profitSource, setProfitSource] = useState<'table' | 'manual'>('table');
  const [manualProfits, setManualProfits] = useState<Record<string, number>>({});

  // 存储键
  const shopKey = `shop_info_${owner}`;
  const shipKey = `month_end_ship_${owner}`;
  const profitKey = `shop_profit_${owner}`;
  const checkKey = `month_end_check_${owner}`;
  const withdrawKey = `withdrawal_record_${owner}`;
  const returnKey = `month_end_return_${owner}`;
  const rechargeKey = `recharge_record_${owner}`;
  const manualProfitKey = `ops_stats_manual_profit_${owner}`;

  // 数据加载
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [shipRecords, setShipRecords] = useState<ShipRecord[]>([]);
  const [profitRecords, setProfitRecords] = useState<ProfitRecord[]>([]);
  const [monthEndRecords, setMonthEndRecords] = useState<any[]>([]);
  const [withdrawalRecords, setWithdrawalRecords] = useState<any[]>([]);
  const [returnRecords, setReturnRecords] = useState<any[]>([]);
  const [extRechargeRecords, setExtRechargeRecords] = useState<any[]>([]);
  // 新款进度数据（用于计算上架统计）
  const [progressData, setProgressData] = useState<any[]>([]);
  const [photosData, setPhotosData] = useState<any[]>([]);
  // 品牌台账中“是否专版”为“普通”的品牌集合
  const [nonExclusiveBrands, setNonExclusiveBrands] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    try { setShops(JSON.parse(localStorage.getItem(shopKey) || '[]')); } catch { setShops([]); }
    try { setShipRecords(JSON.parse(localStorage.getItem(shipKey) || '[]')); } catch { setShipRecords([]); }
    try { setProfitRecords(JSON.parse(localStorage.getItem(profitKey) || '[]')); } catch { setProfitRecords([]); }
    try { setMonthEndRecords(JSON.parse(localStorage.getItem(checkKey) || '[]')); } catch { setMonthEndRecords([]); }
    try { setWithdrawalRecords(JSON.parse(localStorage.getItem(withdrawKey) || '[]')); } catch { setWithdrawalRecords([]); }
    try { setReturnRecords(JSON.parse(localStorage.getItem(returnKey) || '[]')); } catch { setReturnRecords([]); }
    try { setExtRechargeRecords(JSON.parse(localStorage.getItem(rechargeKey) || '[]')); } catch { setExtRechargeRecords([]); }
    try { setProgressData(JSON.parse(localStorage.getItem(`newstyle_progress_${owner}`) || '[]')); } catch { setProgressData([]); }
    try { setPhotosData(JSON.parse(localStorage.getItem(`newstyle_photo_${owner}`) || '[]')); } catch { setPhotosData([]); }
    setNonExclusiveBrands(loadNonExclusiveBrands(owner));
    try {
      const list: ManualProfitEntry[] = JSON.parse(localStorage.getItem(manualProfitKey) || '[]');
      const map: Record<string, number> = {};
      list.forEach(e => { if (e.month === calcMonth) map[e.person] = e.profit; });
      setManualProfits(map);
    } catch { setManualProfits({}); }
  }, [shopKey, shipKey, profitKey, checkKey, withdrawKey, returnKey, rechargeKey, manualProfitKey, calcMonth]);

  useEffect(() => { reload(); }, [reload]);

  // 运营人员列表（店铺列表中所有负责人去重）
  const personList = useMemo(() => {
    const set = new Set<string>();
    shops.forEach(s => { if (s.person) set.add(s.person); });
    return Array.from(set);
  }, [shops]);

  // 按运营人员聚合发货数据
  const aggRows: OpsStatsRow[] = useMemo(() => {
    // 按月份过滤发货记录
    const filtered = shipRecords.filter(r => r.calcMonth === calcMonth);
    // 按负责人聚合
    const map = new Map<string, OpsStatsRow>();
    // 先为每个运营人员初始化
    personList.forEach(p => {
      const personShops = shops.filter(s => s.person === p);
      // 上架统计：调用共享函数
      const { shouldList, listedCount, notListed, listingRate } = calcListingStats(
        personShops.map((s: any) => ({ shopName: s.shopName || '', brand: s.brand || '' })),
        progressData, photosData, nonExclusiveBrands
      );
      map.set(p, {
        key: p,
        person: p,
        shopCount: personShops.length,
        shouldList, notListed, listingRate,
        realOrders: 0,
        realQty: 0,
        returnOrders: 0,
        returnQty: 0,
        returnRate: 0,
        realAmount: 0,
        profit: 0,
      });
    });
    // 聚合发货记录
    filtered.forEach(r => {
      const person = r.chargePerson || shops.find(s => s.key === r.shopId || s.shopName === r.shopName)?.person || '';
      if (!person) return;
      if (!map.has(person)) {
        const personShops = shops.filter(s => s.person === person);
        const { shouldList, listedCount, notListed, listingRate } = calcListingStats(
          personShops.map((s: any) => ({ shopName: s.shopName || '', brand: s.brand || '' })),
          progressData, photosData, nonExclusiveBrands
        );
        map.set(person, {
          key: person,
          person,
          shopCount: personShops.length,
          shouldList, notListed, listingRate,
          realOrders: 0,
          realQty: 0,
          returnOrders: 0,
          returnQty: 0,
          returnRate: 0,
          realAmount: 0,
          profit: 0,
        });
      }
      const row = map.get(person)!;
      row.realOrders += Number(r.realOrders) || 0;
      row.realQty += Number(r.realQty) || 0;
      row.returnOrders += Number(r.returnOrders) || 0;
      row.returnQty += Number(r.returnQty) || 0;
      row.realAmount += Number(r.realAmount) || 0;
    });
    // 计算退货率
    map.forEach(row => {
      row.returnRate = row.realOrders > 0 ? (row.returnOrders / row.realOrders) * 100 : 0;
    });
    return Array.from(map.values());
  }, [shipRecords, calcMonth, personList, shops, progressData, photosData, nonExclusiveBrands]);

  // 利润数据：根据利润来源填充
  const rowsWithProfit: OpsStatsRow[] = useMemo(() => {
    return aggRows.map(row => {
      let profit = 0;
      if (profitSource === 'table') {
        // 与 ShopProfitPage 完全一致：为每个店铺动态组装记录并计算利润
        const personShops = shops.filter(s => s.person === row.person);
        const prevMonth = dayjs(calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
        personShops.forEach(shop => {
          // 查找已保存的利润记录，或创建空记录
          let rec = profitRecords.find(r => r.shopId === shop.key && r.calcMonth === calcMonth);
          if (!rec) {
            rec = { key: '', shopId: shop.key, shopName: shop.shopName, calcMonth, profit: 0,
              currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0, withdrawAmount: 0,
              shippingCost: 0, realAmount: 0, refundAmount: 0, refundAmountByConfirm: 0,
              returnFee: 0, adRecharges: [], prevBalance: 0, prevPending: 0, prevDeposit: 0, prevAdFunds: 0,
              manualAdjustment: 0 };
          }
          // 上月快照：优先利润表记录，回退到月末盘点
          const prev = profitRecords.find(r => r.shopId === shop.key && r.calcMonth === prevMonth)
            || monthEndRecords.find(r => r.shopId === shop.key && r.calcMonth === prevMonth);
          if (prev) {
            rec = { ...rec, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds };
          }
          // 月末盘点 > 店铺资金（本月数据）
          const checkRec = monthEndRecords.find(r => r.shopId === shop.key && r.calcMonth === calcMonth);
          if (checkRec) {
            rec = { ...rec, currentBalance: checkRec.currentBalance, pendingAmount: checkRec.pendingAmount, adFunds: checkRec.adFunds, deposit: checkRec.deposit };
          }
          // 月末盘点 > 发货金额（发货成本、实发金额、实退成本）
          const shipRec = shipRecords.find(r => r.shopId === shop.key && r.calcMonth === calcMonth)
            || shipRecords.find(r => r.shopName === shop.shopName && r.calcMonth === calcMonth);
          if (shipRec) {
            rec = { ...rec,
              shippingCost: Math.round(((shipRec.realCost || 0) + (shipRec.freightCost || 0)) * 100) / 100,
              realAmount: Math.round((shipRec.realAmount || 0) * 100) / 100,
              refundAmount: Math.round((shipRec.returnCost || 0) * 100) / 100,
            };
          }
          // 月末盘点 > 退货金额（退货金额按确认收货时间、退货费用按支付月份）
          const matchingReturns = returnRecords.filter(r =>
            (r.shopId === shop.key || r.shopName === shop.shopName) && r.calcMonth === calcMonth
          );
          rec = { ...rec, refundAmountByConfirm: Math.round(matchingReturns.reduce((s: number, r: any) => s + (r.actualReceiptAmount || 0), 0) * 100) / 100 };
          const matchingReturnFees = returnRecords.filter(r =>
            (r.shopId === shop.key || r.shopName === shop.shopName) && (r.payMonth || r.calcMonth) === calcMonth
          );
          rec = { ...rec, returnFee: Math.round(matchingReturnFees.reduce((s: number, r: any) => s + (r.returnFee || 0), 0) * 100) / 100 };
          // 提现记录
          const withdrawTotal = withdrawalRecords
            .filter((w: any) => {
              if (w.shopId !== shop.key || !w.confirmed) return false;
              const dateStr = w.withdrawalDate || w.createdAt || '';
              const normalized = dateStr.replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
              return normalized.substring(0, 7) === calcMonth;
            })
            .reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
          rec = { ...rec, withdrawAmount: Math.round(withdrawTotal * 100) / 100 };
          // 外部充值推广费（与 ShopProfitPage 利润列 render 一致）
          const extTotal = extRechargeRecords
            .filter((er: any) => {
              if (er.status !== 'paid' || !er.paidAt) return false;
              const matchShop = er.shopId === shop.key || er.shopName === shop.shopName;
              if (!matchShop) return false;
              return String(er.paidAt).substring(0, 7) === calcMonth;
            })
            .reduce((s: number, er: any) => s + (Number(er.amount) || 0), 0);
          const profitR = extTotal > 0 ? { ...rec, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : rec;
          profit += calcProfit(profitR as any);
        });
      } else {
        // 手动输入
        profit = manualProfits[row.person] || 0;
      }
      return { ...row, profit };
    });
  }, [aggRows, profitSource, profitRecords, monthEndRecords, shipRecords, returnRecords, withdrawalRecords, extRechargeRecords, calcMonth, shops, manualProfits]);

  // 汇总
  const summary = useMemo(() => {
    const total = rowsWithProfit.reduce((acc, r) => ({
      shopCount: acc.shopCount + r.shopCount,
      realOrders: acc.realOrders + r.realOrders,
      realQty: acc.realQty + r.realQty,
      returnOrders: acc.returnOrders + r.returnOrders,
      returnQty: acc.returnQty + r.returnQty,
      realAmount: acc.realAmount + r.realAmount,
      profit: acc.profit + r.profit,
    }), { shopCount: 0, realOrders: 0, realQty: 0, returnOrders: 0, returnQty: 0, realAmount: 0, profit: 0 });
    return {
      ...total,
      returnRate: total.realOrders > 0 ? (total.returnOrders / total.realOrders) * 100 : 0,
    };
  }, [rowsWithProfit]);

  // 手动利润修改
  const handleManualProfitChange = (person: string, value: number | null) => {
    const newProfits = { ...manualProfits, [person]: value || 0 };
    setManualProfits(newProfits);
    // 持久化
    try {
      const existing: ManualProfitEntry[] = JSON.parse(localStorage.getItem(manualProfitKey) || '[]');
      const filtered = existing.filter(e => !(e.person === person && e.month === calcMonth));
      if (value && value !== 0) {
        filtered.push({ person, month: calcMonth, profit: value });
      }
      localStorage.setItem(manualProfitKey, JSON.stringify(filtered));
    } catch { /* ignore */ }
  };

  // 店铺详情弹窗（包含每家店铺的利润和发货后退货率）
  const [shopDetailPerson, setShopDetailPerson] = useState<string | null>(null);
  const shopDetailList = useMemo(() => {
    if (!shopDetailPerson) return [];
    const personShops = shops.filter(s => s.person === shopDetailPerson);
    const prevMonth = dayjs(calcMonth + '-01').subtract(1, 'month').format('YYYY-MM');
    return personShops.map(shop => {
      // 发货记录
      const shipRec = shipRecords.find(r => r.shopId === shop.key && r.calcMonth === calcMonth)
        || shipRecords.find(r => r.shopName === shop.shopName && r.calcMonth === calcMonth);
      const realOrders = shipRec ? (Number(shipRec.realOrders) || 0) : 0;
      const returnOrders = shipRec ? (Number(shipRec.returnOrders) || 0) : 0;
      const returnRate = realOrders > 0 ? (returnOrders / realOrders) * 100 : 0;
      // 利润计算（与主表一致）
      let rec: any = profitRecords.find(r => r.shopId === shop.key && r.calcMonth === calcMonth);
      if (!rec) {
        rec = { shopId: shop.key, shopName: shop.shopName, calcMonth, currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0, withdrawAmount: 0, shippingCost: 0, refundAmount: 0, returnFee: 0, adRecharges: [], prevBalance: 0, prevPending: 0, prevDeposit: 0, prevAdFunds: 0, manualAdjustment: 0 };
      }
      const prev = profitRecords.find(r => r.shopId === shop.key && r.calcMonth === prevMonth)
        || monthEndRecords.find(r => r.shopId === shop.key && r.calcMonth === prevMonth);
      if (prev) rec = { ...rec, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds };
      const checkRec = monthEndRecords.find(r => r.shopId === shop.key && r.calcMonth === calcMonth);
      if (checkRec) rec = { ...rec, currentBalance: checkRec.currentBalance, pendingAmount: checkRec.pendingAmount, adFunds: checkRec.adFunds, deposit: checkRec.deposit };
      if (shipRec) rec = { ...rec, shippingCost: Math.round(((shipRec.realCost || 0) + (shipRec.freightCost || 0)) * 100) / 100, refundAmount: Math.round((shipRec.returnCost || 0) * 100) / 100 };
      const matchingReturns = returnRecords.filter(r => (r.shopId === shop.key || r.shopName === shop.shopName) && r.calcMonth === calcMonth);
      rec = { ...rec, refundAmountByConfirm: Math.round(matchingReturns.reduce((s: number, r: any) => s + (r.actualReceiptAmount || 0), 0) * 100) / 100 };
      const matchingReturnFees = returnRecords.filter(r => (r.shopId === shop.key || r.shopName === shop.shopName) && (r.payMonth || r.calcMonth) === calcMonth);
      rec = { ...rec, returnFee: Math.round(matchingReturnFees.reduce((s: number, r: any) => s + (r.returnFee || 0), 0) * 100) / 100 };
      const withdrawTotal = withdrawalRecords.filter((w: any) => {
        if (w.shopId !== shop.key || !w.confirmed) return false;
        const ds = (w.withdrawalDate || w.createdAt || '').replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
        return ds.substring(0, 7) === calcMonth;
      }).reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
      rec = { ...rec, withdrawAmount: Math.round(withdrawTotal * 100) / 100 };
      const extTotal = extRechargeRecords.filter((er: any) => {
        if (er.status !== 'paid' || !er.paidAt) return false;
        const matchShop = er.shopId === shop.key || er.shopName === shop.shopName;
        if (!matchShop) return false;
        return String(er.paidAt).substring(0, 7) === calcMonth;
      }).reduce((s: number, er: any) => s + (Number(er.amount) || 0), 0);
      const profitR = extTotal > 0 ? { ...rec, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : rec;
      const profit = calcProfit(profitR);
      return { ...shop, realOrders, returnOrders, returnRate, profit };
    });
  }, [shopDetailPerson, shops, calcMonth, shipRecords, profitRecords, monthEndRecords, returnRecords, withdrawalRecords, extRechargeRecords]);

  // 表格列
  const columns: ColumnsType<OpsStatsRow> = [
    {
      title: '运营人员', dataIndex: 'person', key: 'person', width: 120, align: 'center', fixed: 'left',
      render: (v: string) => <Text strong style={{ color: PRIMARY }}>{v}</Text>,
    },
    {
      title: <span>店铺数量 <Tooltip title="点击查看负责的店铺列表"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>,
      dataIndex: 'shopCount', key: 'shopCount', width: 90, align: 'center',
      render: (v: number, r: OpsStatsRow) => (
        <a onClick={() => setShopDetailPerson(r.person)} style={{ color: '#1677ff', fontWeight: 600 }}>
          <Tag color="blue" style={{ cursor: 'pointer' }}>{v}</Tag>
        </a>
      ),
    },
    {
      title: <span>应上架数量 <Tooltip title="负责店铺的品牌与新款进度货号品牌匹配的总店铺×货号对数"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>,
      dataIndex: 'shouldList', key: 'shouldList', width: 100, align: 'center',
      render: (v: number) => <Text strong>{v || 0}</Text>,
    },
    {
      title: <span>未上架数量 <Tooltip title="应上架但尚未上架的店铺×货号对数"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>,
      dataIndex: 'notListed', key: 'notListed', width: 100, align: 'center',
      render: (v: number) => <Text style={{ color: v > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>{v || 0}</Text>,
    },
    {
      title: <span>上架率 <Tooltip title="已上架数量 ÷ 应上架数量 × 100%"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>,
      dataIndex: 'listingRate', key: 'listingRate', width: 90, align: 'center',
      render: (v: number) => <Tag color={v >= 80 ? 'green' : v >= 50 ? 'orange' : 'red'}>{(v || 0).toFixed(1)}%</Tag>,
    },
    {
      title: '实发单数', dataIndex: 'realOrders', key: 'realOrders', width: 100, align: 'center',
      render: (v: number) => <Text>{fmtNum(v)}</Text>,
    },
    {
      title: '实发数量', dataIndex: 'realQty', key: 'realQty', width: 100, align: 'center',
      render: (v: number) => <Text>{fmtNum(v)}</Text>,
    },
    {
      title: '实退单数', dataIndex: 'returnOrders', key: 'returnOrders', width: 100, align: 'center',
      render: (v: number) => <Text style={{ color: v > 0 ? '#ff4d4f' : undefined }}>{fmtNum(v)}</Text>,
    },
    {
      title: '实退数量', dataIndex: 'returnQty', key: 'returnQty', width: 100, align: 'center',
      render: (v: number) => <Text style={{ color: v > 0 ? '#ff4d4f' : undefined }}>{fmtNum(v)}</Text>,
    },
    {
      title: <span>发货后退货率 <Tooltip title="实退单数 ÷ 实发单数 × 100%"><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>,
      dataIndex: 'returnRate', key: 'returnRate', width: 120, align: 'center',
      render: (v: number) => <Tag color={v > 10 ? 'red' : v > 5 ? 'orange' : 'green'}>{v.toFixed(2)}%</Tag>,
    },
    {
      title: '实发金额', dataIndex: 'realAmount', key: 'realAmount', width: 120, align: 'right',
      render: (v: number) => <Text style={{ color: '#52c41a', fontWeight: 600 }}>{fmt(v)}</Text>,
    },
    {
      title: <span>利润 <Tooltip title={profitSource === 'table' ? '数据来源：月利润表中对应月份利润汇总' : '手动输入模式：可自由编辑'}><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>,
      key: 'profit', width: 140, align: 'right',
      render: (_: any, r: OpsStatsRow) => {
        if (profitSource === 'manual') {
          return (
            <InputNumber
              value={manualProfits[r.person] || 0}
              onChange={v => handleManualProfitChange(r.person, v)}
              controls={false}
              precision={2}
              prefix="¥"
              style={{ width: '100%' }}
            />
          );
        }
        return <Text style={{ color: '#722ed1', fontWeight: 700 }}>{fmt(r.profit)}</Text>;
      },
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      {/* 统计卡片 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={4}><Card size="small"><Text type="secondary">实发单数</Text><div style={{ fontSize: 20, fontWeight: 700, color: PRIMARY }}>{fmtNum(summary.realOrders)}</div></Card></Col>
        <Col span={4}><Card size="small"><Text type="secondary">实发数量</Text><div style={{ fontSize: 20, fontWeight: 700, color: PRIMARY }}>{fmtNum(summary.realQty)}</div></Card></Col>
        <Col span={4}><Card size="small"><Text type="secondary">实退单数</Text><div style={{ fontSize: 20, fontWeight: 700, color: '#ff4d4f' }}>{fmtNum(summary.returnOrders)}</div></Card></Col>
        <Col span={4}><Card size="small"><Text type="secondary">退货率</Text><div style={{ fontSize: 20, fontWeight: 700, color: summary.returnRate > 10 ? '#ff4d4f' : '#fa8c16' }}>{summary.returnRate.toFixed(2)}%</div></Card></Col>
        <Col span={4}><Card size="small"><Text type="secondary">实发金额</Text><div style={{ fontSize: 20, fontWeight: 700, color: '#52c41a' }}>{fmt(summary.realAmount)}</div></Card></Col>
        <Col span={4}><Card size="small"><Text type="secondary">利润合计</Text><div style={{ fontSize: 20, fontWeight: 700, color: '#722ed1' }}>{fmt(summary.profit)}</div></Card></Col>
      </Row>

      {/* 主表格 */}
      <Card
        title="运营统计"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: '#666' }}>统计月份</span>
          <DatePicker
            picker="month"
            value={dayjs(calcMonth + '-01')}
            onChange={v => setCalcMonth(v ? v.format('YYYY-MM') : dayjs().format('YYYY-MM'))}
            style={{ width: 140 }}
          />
          <span style={{ fontSize: 13, color: '#666', marginLeft: 16 }}>利润来源</span>
          <Select
            value={profitSource}
            onChange={v => setProfitSource(v)}
            style={{ width: 130 }}
            options={[
              { value: 'table', label: '利润表' },
              { value: 'manual', label: '手动输入' },
            ]}
          />
          {profitSource === 'table' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              （自动汇总月利润表中 {calcMonth} 月份对应运营人员店铺的利润）
            </Text>
          )}
          {profitSource === 'manual' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              （可直接编辑每位运营人员的利润金额）
            </Text>
          )}
        </Space>
        <Table<OpsStatsRow>
          rowKey="key"
          bordered
          size="middle"
          columns={columns}
          dataSource={rowsWithProfit}
          pagination={false}
          scroll={{ x: 1040 }}
          locale={{ emptyText: '暂无数据，请确保店铺列表中已设置负责人并在月末盘点中录入发货数据' }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                <Table.Summary.Cell index={0} align="center">汇总</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center"><Tag color="blue">{summary.shopCount}</Tag></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center">{fmtNum(summary.realOrders)}</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center">{fmtNum(summary.realQty)}</Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="center"><span style={{ color: summary.returnOrders > 0 ? '#ff4d4f' : undefined }}>{fmtNum(summary.returnOrders)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="center"><span style={{ color: summary.returnQty > 0 ? '#ff4d4f' : undefined }}>{fmtNum(summary.returnQty)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="center"><Tag color={summary.returnRate > 10 ? 'red' : summary.returnRate > 5 ? 'orange' : 'green'}>{summary.returnRate.toFixed(2)}%</Tag></Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right"><span style={{ color: '#52c41a' }}>{fmt(summary.realAmount)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right"><span style={{ color: '#722ed1' }}>{fmt(summary.profit)}</span></Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>

      {/* 店铺列表弹窗 */}
      <Modal
        title={`${shopDetailPerson || ''} 负责的店铺`}
        open={!!shopDetailPerson}
        onCancel={() => setShopDetailPerson(null)}
        footer={null}
        width={720}
      >
        <Table
          rowKey="key"
          bordered
          size="small"
          pagination={false}
          dataSource={shopDetailList}
          locale={{ emptyText: '无店铺' }}
          columns={[
            { title: '店铺名称', dataIndex: 'shopName', key: 'shopName', width: 140, render: (v: string) => <Text strong>{v}</Text> },
            { title: '店铺编号', dataIndex: 'accountId', key: 'accountId', width: 100, render: (v: string) => v || <Text type="secondary">—</Text> },
            { title: '所属平台', dataIndex: 'platform', key: 'platform', width: 90, render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
            {
              title: '发货后退货率', key: 'returnRate', width: 110, align: 'center',
              render: (_: any, r: any) => r.returnRate > 0
                ? <Tag color={r.returnRate > 10 ? 'red' : r.returnRate > 5 ? 'orange' : 'green'}>{r.returnRate.toFixed(2)}%</Tag>
                : <Tag color="green">0.00%</Tag>,
            },
            {
              title: '利润', key: 'profit', width: 120, align: 'right',
              render: (_: any, r: any) => <Text strong style={{ color: r.profit >= 0 ? '#52c41a' : '#ff4d4f' }}>{r.profit >= 0 ? '+' : ''}{fmt(r.profit)}</Text>,
            },
          ]}
        />
      </Modal>
    </div>
  );
};

// 保留 DevShopPaymentPage 导出（兼容 App.tsx 路由）
export const DevShopPaymentPage: React.FC = DevStaffPaymentPage as any;
