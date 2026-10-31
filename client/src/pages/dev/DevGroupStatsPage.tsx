import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Table, Button, Space, DatePicker, Modal, Tag, Input, Select, Popconfirm, message, Tooltip, Divider } from 'antd';
import { SettingOutlined, TrophyOutlined, TeamOutlined, PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  loadChampionTitles, saveChampionTitles,
  loadPlatformChampionTitles, savePlatformChampionTitles,
} from '../../utils/devStore';
import type { DevChampionTitle, AnalyticsPlatform } from '../../utils/devStore';
import { loadNonExclusiveBrands, calcListingStats } from '../../utils/listingStats';

const fmtMoney = (v: number) => `¥${(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

/** 利润计算（与 ShopProfitPage / DevPaymentPages 一致） */
const calcProfit = (r: Record<string, any>): number => {
  const curNet = (r.currentBalance || 0) + (r.pendingAmount || 0) + (r.adFunds || 0) + (r.withdrawAmount || 0) + (r.deposit || 0);
  const prevNet = (r.prevBalance || 0) + (r.prevPending || 0) + (r.prevDeposit || 0) + (r.prevAdFunds || 0);
  const totalRecharge = Array.isArray(r.adRecharges) ? r.adRecharges.reduce((s: number, x: any) => s + (x.amount || 0), 0) : 0;
  return Math.round((curNet - prevNet - (r.shippingCost || 0) + (r.refundAmount || 0) - (r.returnFee || 0) - totalRecharge + (r.manualAdjustment || 0)) * 100) / 100;
};

// 运营统计字段
const OPS_METRICS: { key: string; label: string; align?: 'left' | 'center' | 'right'; format?: (v: any) => string }[] = [
  { key: 'shopCount', label: '店铺数量', align: 'center' },
  { key: 'shouldList', label: '应上架数量', align: 'center' },
  { key: 'notListed', label: '未上架数量', align: 'center' },
  { key: 'listingRate', label: '上架率', align: 'center' },
  { key: 'realOrders', label: '实发单数', align: 'center' },
  { key: 'realQty', label: '实发数量', align: 'center' },
  { key: 'returnOrders', label: '实退单数', align: 'center' },
  { key: 'returnQty', label: '实退数量', align: 'center' },
  { key: 'returnRate', label: '发货后退货率', align: 'center' },
  { key: 'realAmount', label: '实发金额', align: 'right' },
  { key: 'opsProfit', label: '利润', align: 'right' },
];

const OPS_CHAMPION_METRICS: { key: string; label: string; inverse?: boolean }[] = [
  { key: 'realOrders', label: '实发单数' },
  { key: 'realAmount', label: '实发金额' },
  { key: 'opsProfit', label: '利润' },
  { key: 'shopCount', label: '店铺数量' },
];

/** 自定义分组定义 */
interface OpsGroupDef {
  id: string;
  name: string;
  leader: string;
  members: string[];
}

interface MemberStat {
  staffName: string; isLeader: boolean; groupName: string;
  shopCount: number; shouldList: number; notListed: number; listingRate: number;
  realOrders: number; realQty: number; returnOrders: number; returnQty: number;
  returnRate: number; realAmount: number; opsProfit: number;
}

// 店铺管理 - 业绩分析 - 分组统计（运营人员自定义分组）
const DevGroupStatsPage: React.FC<{ platform?: AnalyticsPlatform }> = ({ platform = 'dev' }) => {
  const owner = useMemo(() => getDataOwner(), []);
  const pfx = platform === 'dev' ? 'dev_' : `${platform}_analytics_${(() => { const isSub = localStorage.getItem('isSubAccount') === 'true'; if (!isSub) return localStorage.getItem('username') || ''; return localStorage.getItem('parentAccount') || localStorage.getItem('username') || ''; })()}_`;
  const groupsKey = `${pfx}ops_groups`;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [titles, setTitles] = useState<DevChampionTitle[]>([]);
  const [showChampion, setShowChampion] = useState(false);
  const [champForm, setChampForm] = useState<{ id?: string; metricKey: string; name: string; icon: string }>({ metricKey: '', name: '', icon: '' });
  const [, setTick] = useState(0);

  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [opsMonth, setOpsMonth] = useState(dayjs().format('YYYY-MM'));

  // 自定义分组
  const [opsGroups, setOpsGroups] = useState<OpsGroupDef[]>(() => {
    try { return JSON.parse(localStorage.getItem(groupsKey) || '[]'); } catch { return []; }
  });
  // 编辑中的分组
  const [editingGroup, setEditingGroup] = useState<{ id?: string; name: string; leader: string; members: string[] } | null>(null);

  // 运营统计数据
  const [opsShops, setOpsShops] = useState<any[]>([]);
  const [opsShipRecords, setOpsShipRecords] = useState<any[]>([]);
  const [opsProfitRecords, setOpsProfitRecords] = useState<any[]>([]);
  const [opsMonthEndRecords, setOpsMonthEndRecords] = useState<any[]>([]);
  const [opsWithdrawalRecords, setOpsWithdrawalRecords] = useState<any[]>([]);
  const [opsReturnRecords, setOpsReturnRecords] = useState<any[]>([]);
  const [opsExtRechargeRecords, setOpsExtRechargeRecords] = useState<any[]>([]);
  // 新款进度数据（用于计算上架统计）
  const [opsProgress, setOpsProgress] = useState<any[]>([]);
  const [opsPhotos, setOpsPhotos] = useState<any[]>([]);
  // 品牌台账中“是否专版”为“普通”的品牌集合
  const [nonExclusiveBrands, setNonExclusiveBrands] = useState<Set<string>>(new Set());

  const reloadOpsData = useCallback(() => {
    try { setOpsShops(JSON.parse(localStorage.getItem(`shop_info_${owner}`) || '[]')); } catch { setOpsShops([]); }
    try { setOpsShipRecords(JSON.parse(localStorage.getItem(`month_end_ship_${owner}`) || '[]')); } catch { setOpsShipRecords([]); }
    try { setOpsProfitRecords(JSON.parse(localStorage.getItem(`shop_profit_${owner}`) || '[]')); } catch { setOpsProfitRecords([]); }
    try { setOpsMonthEndRecords(JSON.parse(localStorage.getItem(`month_end_check_${owner}`) || '[]')); } catch { setOpsMonthEndRecords([]); }
    try { setOpsWithdrawalRecords(JSON.parse(localStorage.getItem(`withdrawal_record_${owner}`) || '[]')); } catch { setOpsWithdrawalRecords([]); }
    try { setOpsReturnRecords(JSON.parse(localStorage.getItem(`month_end_return_${owner}`) || '[]')); } catch { setOpsReturnRecords([]); }
    try { setOpsExtRechargeRecords(JSON.parse(localStorage.getItem(`recharge_record_${owner}`) || '[]')); } catch { setOpsExtRechargeRecords([]); }
    try { setOpsProgress(JSON.parse(localStorage.getItem(`newstyle_progress_${owner}`) || '[]')); } catch { setOpsProgress([]); }
    try { setOpsPhotos(JSON.parse(localStorage.getItem(`newstyle_photo_${owner}`) || '[]')); } catch { setOpsPhotos([]); }
    setNonExclusiveBrands(loadNonExclusiveBrands(owner));
  }, [owner]);

  useEffect(() => { reloadOpsData(); }, [opsMonth, reloadOpsData]);

  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { setTitles(platform === 'dev' ? loadChampionTitles() : loadPlatformChampionTitles(platform)); }, [platform]);

  // 所有运营人员（店铺列表 person 去重）
  const personList = useMemo(() => {
    const set = new Set<string>();
    opsShops.forEach((s: any) => { if (s.person) set.add(s.person); });
    return Array.from(set);
  }, [opsShops]);

  // 计算单个运营人员的运营统计数据
  const calcOpsStats = useCallback((personName: string) => {
    const personShops = opsShops.filter((s: any) => s.person === personName);
    const filtered = opsShipRecords.filter((r: any) => r.calcMonth === opsMonth);
    const personShipRecords = filtered.filter((r: any) => {
      const cp = r.chargePerson || opsShops.find((s: any) => s.key === r.shopId || s.shopName === r.shopName)?.person || '';
      return cp === personName;
    });
    const realOrders = personShipRecords.reduce((s: number, r: any) => s + (Number(r.realOrders) || 0), 0);
    const realQty = personShipRecords.reduce((s: number, r: any) => s + (Number(r.realQty) || 0), 0);
    const returnOrders = personShipRecords.reduce((s: number, r: any) => s + (Number(r.returnOrders) || 0), 0);
    const returnQty = personShipRecords.reduce((s: number, r: any) => s + (Number(r.returnQty) || 0), 0);
    const realAmount = personShipRecords.reduce((s: number, r: any) => s + (Number(r.realAmount) || 0), 0);
    const returnRate = realOrders > 0 ? (returnOrders / realOrders) * 100 : 0;
    // 上架统计：调用共享函数，确保与新款列表口径一致
    const { shouldList, listedCount, notListed, listingRate } = calcListingStats(
      personShops.map((s: any) => ({ shopName: s.shopName || '', brand: s.brand || '' })),
      opsProgress, opsPhotos, nonExclusiveBrands
    );
    // 利润计算
    const prevMonth = dayjs(opsMonth + '-01').subtract(1, 'month').format('YYYY-MM');
    let totalProfit = 0;
    personShops.forEach((shop: any) => {
      let rec: any = opsProfitRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === opsMonth);
      if (!rec) {
        rec = { shopId: shop.key, shopName: shop.shopName, calcMonth: opsMonth, currentBalance: 0, pendingAmount: 0, adFunds: 0, deposit: 0, withdrawAmount: 0, shippingCost: 0, refundAmount: 0, returnFee: 0, adRecharges: [], prevBalance: 0, prevPending: 0, prevDeposit: 0, prevAdFunds: 0, manualAdjustment: 0 };
      }
      const prev = opsProfitRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === prevMonth)
        || opsMonthEndRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === prevMonth);
      if (prev) rec = { ...rec, prevBalance: prev.currentBalance, prevPending: prev.pendingAmount, prevDeposit: prev.deposit, prevAdFunds: prev.adFunds };
      const checkRec = opsMonthEndRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === opsMonth);
      if (checkRec) rec = { ...rec, currentBalance: checkRec.currentBalance, pendingAmount: checkRec.pendingAmount, adFunds: checkRec.adFunds, deposit: checkRec.deposit };
      const shipRec = opsShipRecords.find((r: any) => r.shopId === shop.key && r.calcMonth === opsMonth)
        || opsShipRecords.find((r: any) => r.shopName === shop.shopName && r.calcMonth === opsMonth);
      if (shipRec) rec = { ...rec, shippingCost: Math.round(((shipRec.realCost || 0) + (shipRec.freightCost || 0)) * 100) / 100, refundAmount: Math.round((shipRec.returnCost || 0) * 100) / 100 };
      const matchingReturns = opsReturnRecords.filter((r: any) => (r.shopId === shop.key || r.shopName === shop.shopName) && r.calcMonth === opsMonth);
      rec = { ...rec, refundAmountByConfirm: Math.round(matchingReturns.reduce((s: number, r: any) => s + (r.actualReceiptAmount || 0), 0) * 100) / 100 };
      const matchingReturnFees = opsReturnRecords.filter((r: any) => (r.shopId === shop.key || r.shopName === shop.shopName) && (r.payMonth || r.calcMonth) === opsMonth);
      rec = { ...rec, returnFee: Math.round(matchingReturnFees.reduce((s: number, r: any) => s + (r.returnFee || 0), 0) * 100) / 100 };
      const withdrawTotal = opsWithdrawalRecords.filter((w: any) => {
        if (w.shopId !== shop.key || !w.confirmed) return false;
        const ds = (w.withdrawalDate || w.createdAt || '').replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
        return ds.substring(0, 7) === opsMonth;
      }).reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
      rec = { ...rec, withdrawAmount: Math.round(withdrawTotal * 100) / 100 };
      const extTotal = opsExtRechargeRecords.filter((er: any) => {
        if (er.status !== 'paid' || !er.paidAt) return false;
        const matchShop = er.shopId === shop.key || er.shopName === shop.shopName;
        if (!matchShop) return false;
        return String(er.paidAt).substring(0, 7) === opsMonth;
      }).reduce((s: number, er: any) => s + (Number(er.amount) || 0), 0);
      const profitR = extTotal > 0 ? { ...rec, adRecharges: [{ key: 'ext', date: '', amount: extTotal, remark: '' }] } : rec;
      totalProfit += calcProfit(profitR);
    });
    return { shopCount: personShops.length, shouldList, notListed, listingRate, realOrders, realQty, returnOrders, returnQty, returnRate, realAmount, opsProfit: totalProfit };
  }, [opsShops, opsShipRecords, opsProfitRecords, opsMonthEndRecords, opsReturnRecords, opsWithdrawalRecords, opsExtRechargeRecords, opsMonth, opsProgress, opsPhotos, nonExclusiveBrands]);

  // 按自定义分组聚合
  const { groups, allMembers } = useMemo(() => {
    const memberStats: MemberStat[] = [];
    const groupList: any[] = [];

    opsGroups.forEach(grp => {
      const allPersons = [grp.leader, ...grp.members.filter(m => m !== grp.leader)];
      const stats = allPersons.map((person, idx) => {
        const ops = calcOpsStats(person);
        const ms: MemberStat = {
          staffName: person, isLeader: idx === 0, groupName: grp.name,
          ...ops,
        };
        memberStats.push(ms);
        return ms;
      });
      const agg = (fn: (m: MemberStat) => number) => stats.reduce((s, m) => s + fn(m), 0);
      const totalRealOrders = agg(m => m.realOrders);
      const totalReturnOrders = agg(m => m.returnOrders);
      groupList.push({
        leaderId: grp.id, leaderName: grp.leader, roleName: grp.name,
        memberCount: stats.length,
        shopCount: agg(m => m.shopCount),
        shouldList: agg(m => m.shouldList), notListed: agg(m => m.notListed),
        listingRate: agg(m => m.shouldList) > 0 ? (agg(m => m.shouldList - m.notListed) / agg(m => m.shouldList)) * 100 : 0,
        realOrders: agg(m => m.realOrders), realQty: agg(m => m.realQty),
        returnOrders: agg(m => m.returnOrders), returnQty: agg(m => m.returnQty),
        returnRate: totalRealOrders > 0 ? (totalReturnOrders / totalRealOrders) * 100 : 0,
        realAmount: agg(m => m.realAmount), opsProfit: agg(m => m.opsProfit),
        members: stats,
      });
    });

    return { groups: groupList, allMembers: memberStats };
  }, [opsGroups, calcOpsStats]);

  // 冠军榜
  const champions = useMemo(() => titles.filter(t => t.isActive && OPS_CHAMPION_METRICS.some(m => m.key === t.metricKey))
    .sort((a, b) => a.sortOrder - b.sortOrder).map(title => {
      let best: MemberStat | null = null; let bestVal = -Infinity;
      allMembers.forEach(m => {
        const val = (m as any)[title.metricKey];
        if (val == null) return;
        if (val > bestVal) { bestVal = val; best = m; }
      });
      return { title, winner: best, value: best === null ? 0 : bestVal };
    }).filter(c => c.winner), [titles, allMembers]);

  const getSortValue = (g: any, key: string): number => {
    if (key === 'memberCount') return g.memberCount;
    return g[key] ?? 0;
  };
  const sortedGroups = useMemo(() => {
    if (!sortKey) return groups;
    return [...groups].sort((a, b) => {
      if (sortKey === 'leaderName') {
        const cmp = a.leaderName.localeCompare(b.leaderName, 'zh-CN');
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const va = getSortValue(a, sortKey); const vb = getSortValue(b, sortKey);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [groups, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const renderOpsVal = (m: any, row: any) => {
    const val = m.key === 'opsProfit' ? row.opsProfit : m.key === 'returnRate' || m.key === 'listingRate' ? row[m.key] : row[m.key];
    if (m.key === 'shopCount') return <Tag color="blue">{val}</Tag>;
    if (m.key === 'listingRate') return <Tag color={val >= 80 ? 'green' : val >= 50 ? 'orange' : 'red'}>{(val || 0).toFixed(1)}%</Tag>;
    if (m.key === 'shouldList') return <span style={{ fontWeight: 600 }}>{val || 0}</span>;
    if (m.key === 'notListed') return <span style={{ color: val > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>{val || 0}</span>;
    if (m.key === 'returnRate') return <Tag color={val > 10 ? 'red' : val > 5 ? 'orange' : 'green'}>{(val || 0).toFixed(2)}%</Tag>;
    if (m.key === 'realAmount') return <span style={{ color: '#52c41a', fontWeight: 600 }}>{fmtMoney(val)}</span>;
    if (m.key === 'opsProfit') return <span style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>{val >= 0 ? '+' : ''}{fmtMoney(val)}</span>;
    if (m.key === 'returnOrders' || m.key === 'returnQty') return <span style={{ color: val > 0 ? '#ff4d4f' : undefined }}>{val || 0}</span>;
    return String(val ?? 0);
  };

  const saveChamp = () => {
    if (!champForm.metricKey || !champForm.name) return;
    if (platform === 'dev') {
      if (champForm.id) {
        saveChampionTitles(loadChampionTitles().map(t => t.id === champForm.id ? { ...t, metricKey: champForm.metricKey, name: champForm.name, icon: champForm.icon || null } : t));
      } else {
        const list = loadChampionTitles();
        saveChampionTitles([...list, { id: `ct_${Date.now()}`, metricKey: champForm.metricKey, name: champForm.name, icon: champForm.icon || null, isActive: true, sortOrder: list.length }]);
      }
      setTitles(loadChampionTitles());
    } else {
      if (champForm.id) {
        savePlatformChampionTitles(platform, loadPlatformChampionTitles(platform).map(t => t.id === champForm.id ? { ...t, metricKey: champForm.metricKey, name: champForm.name, icon: champForm.icon || null } : t));
      } else {
        const list = loadPlatformChampionTitles(platform);
        savePlatformChampionTitles(platform, [...list, { id: `ct_${Date.now()}`, metricKey: champForm.metricKey, name: champForm.name, icon: champForm.icon || null, isActive: true, sortOrder: list.length }]);
      }
      setTitles(loadPlatformChampionTitles(platform));
    }
    setChampForm({ metricKey: '', name: '', icon: '' });
    message.success('冠军头衔已保存');
  };

  // 分组 CRUD
  const saveGroups = (list: OpsGroupDef[]) => {
    setOpsGroups(list);
    localStorage.setItem(groupsKey, JSON.stringify(list));
  };
  const handleSaveGroup = () => {
    if (!editingGroup) return;
    if (!editingGroup.name.trim()) { message.warning('请输入分组名称'); return; }
    if (!editingGroup.leader) { message.warning('请选择组长'); return; }
    if (editingGroup.id) {
      saveGroups(opsGroups.map(g => g.id === editingGroup.id ? { ...g, name: editingGroup.name, leader: editingGroup.leader, members: editingGroup.members } : g));
    } else {
      saveGroups([...opsGroups, { id: `grp_${Date.now()}`, name: editingGroup.name, leader: editingGroup.leader, members: editingGroup.members }]);
    }
    setEditingGroup(null);
    message.success(editingGroup.id ? '分组已更新' : '分组已创建');
  };
  const handleDeleteGroup = (id: string) => {
    saveGroups(opsGroups.filter(g => g.id !== id));
    message.success('分组已删除');
  };

  const thStyle = (align?: string): React.CSSProperties => ({ cursor: 'pointer', textAlign: (align as any) || 'center', whiteSpace: 'nowrap' });

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="分组统计"
        extra={
          <Space>
            <Button icon={<TeamOutlined />} onClick={() => setShowGroupSettings(true)}>分组设置</Button>
          </Space>
        }
      >
        <p style={{ color: '#999', fontSize: 12, marginTop: 0 }}>
          按运营人员维度展示各团队运营数据（数据来源：月末盘点 + 月利润表）
        </p>
        <Space wrap style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#666' }}>统计月份</span>
          <DatePicker
            picker="month"
            value={dayjs(opsMonth + '-01')}
            onChange={v => setOpsMonth(v ? v.format('YYYY-MM') : dayjs().format('YYYY-MM'))}
            style={{ width: 140 }}
          />
        </Space>

        {groups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999', fontSize: 13 }}>
            暂无分组数据，请点击右上角「分组设置」创建分组并配置组长和组员
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                  <th style={thStyle('left')} onClick={() => handleSort('leaderName')}>组长 / 组员 {sortKey === 'leaderName' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                  <th style={thStyle()} onClick={() => handleSort('memberCount')}>人数 {sortKey === 'memberCount' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                  {OPS_METRICS.map(m => (
                    <th key={m.key} style={thStyle(m.align)} onClick={() => handleSort(m.key)}>
                      {m.label}{sortKey === m.key && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map((g: any) => (
                  <React.Fragment key={g.leaderId}>
                    <tr style={{ background: '#f0f5ff', borderTop: '1px solid #f0f0f0', cursor: 'pointer' }} onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(g.leaderId)) n.delete(g.leaderId); else n.add(g.leaderId); return n; })}>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ color: '#bbb', fontSize: 11, marginRight: 6 }}>{expanded.has(g.leaderId) ? '▼' : '▶'}</span>
                        <span style={{ fontWeight: 700 }}>{g.leaderName}</span>
                        {g.roleName && <Tag color="blue" style={{ marginLeft: 6 }}>{g.roleName}</Tag>}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>{g.memberCount}</td>
                      {OPS_METRICS.map(m => (
                        <td key={m.key} style={{ padding: '10px 8px', textAlign: m.align || 'center', fontWeight: 600 }}>{renderOpsVal(m, g)}</td>
                      ))}
                    </tr>
                    {expanded.has(g.leaderId) && g.members.map((mem: MemberStat) => (
                      <tr key={`${g.leaderId}-${mem.staffName}`} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '8px 12px 8px 36px', color: '#666' }}>
                          {mem.staffName}{mem.isLeader && <span style={{ fontSize: 10, color: '#1677ff', marginLeft: 4 }}>(组长)</span>}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', color: '#ccc', fontSize: 11 }}>-</td>
                        {OPS_METRICS.map(m => (
                          <td key={m.key} style={{ padding: '8px', textAlign: m.align || 'center', color: '#888' }}>{renderOpsVal(m, mem)}</td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {champions.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 15 }}><TrophyOutlined style={{ color: '#d97706', marginRight: 6 }} />冠军榜</span>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>头衔名称可在"管理头衔"中编辑修改</div>
              </div>
              <Button size="small" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' }} onClick={() => setShowChampion(true)}>管理头衔</Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {champions.map(c => (
                <div key={c.title.id} style={{ background: 'linear-gradient(135deg, #fffbeb, #fff, #fff7ed)', border: '1px solid #fde68a', borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 22 }}>{c.title.icon || '🏆'}</div>
                      <div style={{ fontWeight: 700 }}>{(c.winner as unknown as MemberStat).staffName}</div>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                        {(c.winner as unknown as MemberStat).groupName} · {
                          (() => {
                            const mk = c.title.metricKey;
                            if (mk === 'realAmount' || mk === 'opsProfit') return fmtMoney(c.value);
                            return c.value;
                          })()
                        }
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: 'rgba(180, 83, 9, .8)' }}>{c.title.name}</div>
                      <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{OPS_CHAMPION_METRICS.find(m => m.key === c.title.metricKey)?.label || c.title.metricKey}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 分组设置弹窗 */}
      <Modal title="分组设置" open={showGroupSettings} onCancel={() => setShowGroupSettings(false)} width={600}
        footer={<Button type="primary" onClick={() => setShowGroupSettings(false)}>关闭</Button>}>
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingGroup({ name: '', leader: '', members: [] })}>
            新增分组
          </Button>
        </div>
        {opsGroups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#999' }}>暂无分组，请点击上方按钮新增</div>
        )}
        {opsGroups.map(grp => (
          <div key={grp.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{grp.name}</span>
              <span style={{ color: '#999', fontSize: 12, marginLeft: 12 }}>组长：{grp.leader}</span>
              <span style={{ color: '#999', fontSize: 12, marginLeft: 12 }}>组员：{grp.members.length > 0 ? grp.members.join('、') : '无'}</span>
            </div>
            <Space>
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditingGroup({ id: grp.id, name: grp.name, leader: grp.leader, members: [...grp.members] })}>编辑</Button>
              <Popconfirm title="确定删除该分组？" onConfirm={() => handleDeleteGroup(grp.id)}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Space>
          </div>
        ))}
      </Modal>

      {/* 编辑/新增分组弹窗 */}
      <Modal
        title={editingGroup?.id ? '编辑分组' : '新增分组'}
        open={!!editingGroup}
        onCancel={() => setEditingGroup(null)}
        onOk={handleSaveGroup}
        okText="保存"
        width={480}
      >
        {editingGroup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>分组名称</div>
              <Input
                value={editingGroup.name}
                onChange={e => setEditingGroup({ ...editingGroup, name: e.target.value })}
                placeholder="请输入分组名称（如：A组、华东区）"
              />
            </div>
            <div>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>组长</div>
              <Select
                value={editingGroup.leader || undefined}
                onChange={v => setEditingGroup({ ...editingGroup, leader: v })}
                placeholder="选择组长（运营人员）"
                style={{ width: '100%' }}
                options={personList.map(p => ({ value: p, label: p }))}
                showSearch
                filterOption={(input, option) => (option?.label as string || '').includes(input)}
              />
            </div>
            <div>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>组员</div>
              <Select
                mode="multiple"
                value={editingGroup.members}
                onChange={v => setEditingGroup({ ...editingGroup, members: v })}
                placeholder="选择组员（运营人员，可多选）"
                style={{ width: '100%' }}
                options={personList.filter(p => p !== editingGroup.leader).map(p => ({ value: p, label: p }))}
                showSearch
                filterOption={(input, option) => (option?.label as string || '').includes(input)}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 冠军头衔管理 */}
      <Modal title="🏆 管理冠军头衔" open={showChampion} onCancel={() => setShowChampion(false)} width={560}
        footer={<Button type="primary" onClick={() => setShowChampion(false)}>关闭</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {titles.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #f0f0f0', borderRadius: 10, padding: '8px 12px', opacity: t.isActive ? 1 : 0.5 }}>
              <span style={{ fontSize: 20, width: 30, textAlign: 'center' }}>{t.icon || '🏆'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: '#999' }}>{OPS_CHAMPION_METRICS.find(m => m.key === t.metricKey)?.label || t.metricKey}</div>
              </div>
              <Button size="small" onClick={() => {
                if (platform === 'dev') {
                  saveChampionTitles(loadChampionTitles().map(x => x.id === t.id ? { ...x, isActive: !x.isActive } : x)); setTitles(loadChampionTitles());
                } else {
                  savePlatformChampionTitles(platform, loadPlatformChampionTitles(platform).map(x => x.id === t.id ? { ...x, isActive: !x.isActive } : x)); setTitles(loadPlatformChampionTitles(platform));
                }
              }}>{t.isActive ? '启用' : '禁用'}</Button>
              <Button size="small" type="link" onClick={() => setChampForm({ id: t.id, metricKey: t.metricKey, name: t.name, icon: t.icon || '' })}>编辑</Button>
              <Popconfirm title="删除该头衔？" onConfirm={() => {
                if (platform === 'dev') {
                  saveChampionTitles(loadChampionTitles().filter(x => x.id !== t.id)); setTitles(loadChampionTitles());
                } else {
                  savePlatformChampionTitles(platform, loadPlatformChampionTitles(platform).filter(x => x.id !== t.id)); setTitles(loadPlatformChampionTitles(platform));
                }
              }}>
                <Button size="small" danger type="link">删除</Button>
              </Popconfirm>
            </div>
          ))}
          {!titles.length && <div style={{ color: '#999', fontSize: 12, textAlign: 'center' }}>暂无头衔，请在下方添加（如：爆单王 👑）</div>}
        </div>
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{champForm.id ? '编辑头衔' : '添加新头衔'}</div>
          <Space wrap>
            <Input style={{ width: 150 }} placeholder="头衔名称*" value={champForm.name} onChange={e => setChampForm(f => ({ ...f, name: e.target.value }))} />
            <Input style={{ width: 90 }} placeholder="图标emoji" value={champForm.icon} onChange={e => setChampForm(f => ({ ...f, icon: e.target.value }))} />
            <Select style={{ width: 160 }} placeholder="关联指标*" value={champForm.metricKey || undefined} onChange={v => setChampForm(f => ({ ...f, metricKey: v }))}
              options={OPS_CHAMPION_METRICS.map(m => ({ value: m.key, label: m.label }))} />
            <Button type="primary" style={{ background: '#f59e0b', borderColor: '#f59e0b' }} disabled={!champForm.metricKey || !champForm.name} onClick={saveChamp}>{champForm.id ? '保存修改' : '添加头衔'}</Button>
            {champForm.id && <Button onClick={() => setChampForm({ metricKey: '', name: '', icon: '' })}>取消编辑</Button>}
          </Space>
        </div>
      </Modal>
      <Button type="text" style={{ display: 'none' }} onClick={refresh} />
    </div>
  );
};

export default DevGroupStatsPage;
