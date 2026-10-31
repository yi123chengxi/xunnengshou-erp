import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Tag, DatePicker, InputNumber, Modal, Select, Input, message, Tooltip, Empty, Segmented, Progress, Alert, Tabs } from 'antd';
import { saveDataset } from '../utils/dataStore';
import { safeSetItem } from '../utils/storageQuota';
import { getCurrentUserDisplayName } from '../utils/billLog';
import {
  CalendarOutlined, LeftOutlined, RightOutlined, PlusOutlined, DeleteOutlined,
  WarningOutlined, HolderOutlined, ToolOutlined, DashboardOutlined, ScheduleOutlined,
  AppstoreOutlined, UnorderedListOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

const PRIMARY = '#1e4a7e';

// 班次（排期视图最小单位）：上午/下午/晚上
const SHIFTS = [
  { key: 'morning', label: '上午', range: '08:00-12:00', color: '#faad14' },
  { key: 'afternoon', label: '下午', range: '13:00-17:00', color: '#1890ff' },
  { key: 'evening', label: '晚上', range: '18:00-22:00', color: '#722ed1' },
];

const readList = (key: string): any[] => {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeList = (key: string, list: any[]) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* ignore */ }
};

interface ScheduleBoardProps {
  owner: string;
  /** 排期变更同步到父页面（ModuleChildPage）的 dataSource：父页面同键自动持久化/同步合并逻辑依赖它保持一致，否则会用旧数据复活已删除排期 */
  onSchedulesChange?: (list: any[]) => void;
  /** 排期列表子页面：父级传入的 Table 节点，在"排期列表"Tab 中渲染 */
  listView?: React.ReactNode;
}

/**
 * 生产排期看板：
 * - 「排期看板」视图：左侧待排产生产订单卡片（含半成品加工情况/模具编号/计划生产数量等）可拖拽，
 *   右侧「生产线 × 上午/下午/晚上」格子，拖入即登记排期，格内显示该单位总需生产数量；
 * - 「生产看板」视图：当日排产指标、生产线×班次负荷、生产订单进度总览；
 * - 排期记录与列表视图同源（pageData_production_production-schedule_<owner>），带班次字段 shift；
 * - 同线同班模具编号不一致时弹窗警告，可强制排期，强制后格子标红警示（移除冲突排期自动恢复）；
 * - 已排卡片可在格子间拖动改期，点击可改数量/移除；点击待排卡片单号查看计划明细。
 */
const ScheduleBoard: React.FC<ScheduleBoardProps> = ({ owner, onSchedulesChange, listView }) => {
  const poKey = `pageData_production_production-order_${owner}`;
  const jgKey = `pageData_production_processing-order_${owner}`;
  const scKey = `pageData_production_production-schedule_${owner}`;
  const lineKey = `production_schedule_lines_${owner}`;
  const productKey = `pageData_basic-data_product-list_${owner}`;

  const [viewMode, setViewMode] = useState<'board' | 'dash' | 'list'>('board');
  const [date, setDate] = useState(dayjs());
  const [monthView, setMonthView] = useState(dayjs());
  const [lines, setLines] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(lineKey) || ''); if (Array.isArray(v) && v.length) return v; } catch { /* ignore */ }
    return ['生产线1', '生产线2', '生产线3'];
  });
  const [lineInput, setLineInput] = useState('');
  const [orders, setOrders] = useState<any[]>(() => readList(poKey));
  const [jgRows, setJgRows] = useState<any[]>(() => readList(jgKey));
  const [schedules, setSchedules] = useState<any[]>(() => readList(scKey));
  const [dropTarget, setDropTarget] = useState<{ poId: string; line: string; shift: string } | null>(null);
  const [dropQty, setDropQty] = useState<number>(0);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  // 暂不生产订单集合：标记后自动排到待排产列表最底部，持久化到 localStorage
  const [deferredIds, setDeferredIds] = useState<Set<string>>(() => {
    try { const v = JSON.parse(localStorage.getItem(`sb_deferred_${owner}`) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
  });
  useEffect(() => { try { localStorage.setItem(`sb_deferred_${owner}`, JSON.stringify(Array.from(deferredIds))); } catch { /* ignore */ } }, [deferredIds, owner]);
  const [planPo, setPlanPo] = useState<any | null>(null);
  const [pendingSearch, setPendingSearch] = useState('');
  const dragRef = useRef<{ poId: string; assignKey?: string } | null>(null);
  const products = useMemo(() => readList(productKey), []);

  const dateStr = date.format('YYYY-MM-DD');
  const reload = () => { setOrders(readList(poKey)); setJgRows(readList(jgKey)); setSchedules(readList(scKey)); };

  // 生产订单日志写入：排期操作同步记录到对应生产订单的 orderLog
  const appendPoLog = (poId: string, action: string, detail?: string) => {
    try {
      const saved = localStorage.getItem(poKey);
      if (!saved) return;
      const data = JSON.parse(saved);
      const idx = data.findIndex((r: any) => r.id === poId || r.key === poId);
      if (idx === -1) return;
      const logs: any[] = data[idx].orderLog ? JSON.parse(data[idx].orderLog) : [];
      logs.push({ time: new Date().toLocaleString('zh-CN'), action, operator: getCurrentUserDisplayName(), ...(detail ? { detail } : {}) });
      data[idx].orderLog = JSON.stringify(logs);
      const json = JSON.stringify(data);
      safeSetItem(poKey, json);
      saveDataset(poKey, json);
    } catch { /* ignore */ }
  };

  // 每10秒自动刷新待排产订单数据（生产订单/加工订单/排期记录），无需手动刷新
  useEffect(() => {
    const timer = setInterval(() => {
      setOrders(readList(poKey));
      setJgRows(readList(jgKey));
      setSchedules(readList(scKey));
    }, 10000);
    return () => clearInterval(timer);
  }, [poKey, jgKey, scKey]);

  // 模具编号：按商品编码/名称/简称回查商品主数据；订单号非商品编码时回退按计划明细内商品编码反查
  const moldMap = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p: any) => {
      const mold = p.moldCode || '';
      if (!mold) return;
      [p.productCode, p.productName, p.shortName].forEach(k => { if (k && !m.has(k)) m.set(k, mold); });
    });
    return m;
  }, [products]);
  // 提取款式编码前缀（如 "8002-蓝色-35" → "8002"，"5815" → "5815"）
  const styleCodeOf = (it: any): string => {
    const raw = it?.styleCode || it?.productCode || '';
    const m = String(raw).match(/^[^-]+(?:-[^-]+)*?(?=\s*-\s*[\u4e00-\u9fff])/);
    if (m) return m[0];
    const numOnly = String(raw).match(/^\d+/);
    return numOnly ? numOnly[0] : (raw || '');
  };

  const moldOf = (o: any): string => {
    const direct = moldMap.get(o.productCode || '') || moldMap.get(o.productName || '') || moldMap.get(o.shortName || '') || o.moldCode || '';
    if (direct) return direct;
    const items = Array.isArray(o.planItems) ? o.planItems : [];
    const molds = Array.from(new Set(items.map((it: any) => moldMap.get(it.productCode || '') || '').filter(Boolean)));
    return molds.join(' / ');
  };

  // 每个生产订单的半成品加工情况（加工订单按 poId 聚合）
  const jgByPo = useMemo(() => {
    const m = new Map<string, any[]>();
    jgRows.forEach(r => { const k = r.poId || ''; if (!k) return; const l = m.get(k) || []; l.push(r); m.set(k, l); });
    return m;
  }, [jgRows]);

  // 已排数量（按生产订单聚合，含全部日期）
  const scheduledQtyByPo = useMemo(() => {
    const m = new Map<string, number>();
    schedules.forEach(s => { const k = s.productionOrderId || ''; m.set(k, (m.get(k) || 0) + (Number(s.planQty) || 0)); });
    return m;
  }, [schedules]);
  const remainingOf = (o: any) => Math.max(0, (Number(o.planQuantity ?? o.planQty) || 0) - (scheduledQtyByPo.get(o.id) || 0));

  // 待排产订单卡片列表：仍有剩余数量且未完工（仅取生产订单，过滤存储中混入的加工单行）
  const poOrders = useMemo(() => orders.filter(o => String(o.id || '').toUpperCase().startsWith('PO-')), [orders]);
  // 待排产订单按完工进度降序排列（完工率高的排在最前面），暂不生产的订单始终排到最后
  const pendingOrders = useMemo(() => {
    return poOrders
      .filter(o => o && o.status !== 'completed' && remainingOf(o) > 0)
      .sort((a, b) => {
        const dA = deferredIds.has(a.id) ? 1 : 0;
        const dB = deferredIds.has(b.id) ? 1 : 0;
        if (dA !== dB) return dA - dB;
        const planA = Number(a.planQuantity ?? a.planQty) || 0;
        const planB = Number(b.planQuantity ?? b.planQty) || 0;
        const doneA = Number(a.completedQuantity ?? a.doneQty) || 0;
        const doneB = Number(b.completedQuantity ?? b.doneQty) || 0;
        const pctA = planA > 0 ? doneA / planA : 0;
        const pctB = planB > 0 ? doneB / planB : 0;
        return pctB - pctA;
      });
  }, [poOrders, scheduledQtyByPo, deferredIds]);

  // 搜索过滤待排产订单：匹配生产单号/模具编号/款式编码
  const filteredPendingOrders = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    if (!q) return pendingOrders;
    return pendingOrders.filter(o => {
      if (String(o.id || '').toLowerCase().includes(q)) return true;
      if (String(moldOf(o) || '').toLowerCase().includes(q)) return true;
      const items = Array.isArray(o.planItems) ? o.planItems : [];
      if (items.some((it: any) => {
        const code = styleCodeOf(it);
        return code && code.toLowerCase().includes(q);
      })) return true;
      if (items.some((it: any) => {
        const pc = String(it?.productCode || it?.styleCode || '').trim().toLowerCase();
        return pc && pc.includes(q);
      })) return true;
      return false;
    });
  }, [pendingOrders, pendingSearch, moldMap]);

  // 当日排期（按生产线+班次分组）
  const daySchedules = useMemo(() => schedules.filter(s => (s.startDate || '').slice(0, 10) === dateStr), [schedules, dateStr]);
  const cellOf = (line: string, shift: string) => daySchedules.filter(s => s.line === line && s.shift === shift);
  const cellTotal = (line: string, shift: string) => cellOf(line, shift).reduce((s, x) => s + (Number(x.planQty) || 0), 0);
  const dayTotal = daySchedules.reduce((s, x) => s + (Number(x.planQty) || 0), 0);

  // 排期记录对应生产订单的模具编号
  const scheduleMold = (s: any): string => {
    const order = poOrders.find(o => o.id === s.productionOrderId);
    return order ? moldOf(order) : '';
  };
  // 格子内已有排期的模具集合（去重，excludeKey 可同时匹配 key/id 用于排除自身）
  const cellMolds = (line: string, shift: string, excludeKey?: string): string[] =>
    Array.from(new Set(cellOf(line, shift)
      .filter(x => !excludeKey || (x.key !== excludeKey && x.id !== excludeKey))
      .map(x => scheduleMold(x)).filter(Boolean)));
  // 格子是否模具混排（同线同班内模具编号不一致）
  const cellConflict = (line: string, shift: string): boolean => cellMolds(line, shift).length > 1;

  const saveSchedules = (list: any[]) => {
    setSchedules(list);
    // 同步父页面 dataSource（同键自动持久化/同步合并的数据源），否则父页面会用旧数据复活已删除/已调整的排期
    onSchedulesChange?.(list);
    // 与 ModuleChildPage.pushRecordToPage 同链路三写：localStorage + IndexedDB 数据集 + _ts 时间戳，
    // 防 App 层 pullAllDatasets（60s 轮询/焦点拉取）用服务器旧版本覆盖
    try {
      const json = JSON.stringify(list);
      safeSetItem(scKey, json);
      saveDataset(scKey, json);
      safeSetItem(`${scKey}_ts`, String(Date.now()));
    } catch { /* ignore */ }
  };

  const genScheduleNo = () => {
    const prefix = `PS-${date.format('YYYYMMDD')}`;
    const used = new Set(schedules.map(s => s.id).filter((v: string) => v && v.startsWith(prefix)));
    let n = used.size + 1;
    let no = `${prefix}-${String(n).padStart(2, '0')}`;
    while (used.has(no)) { n += 1; no = `${prefix}-${String(n).padStart(2, '0')}`; }
    return no;
  };

  // 模具混排警告弹窗：同线同班内模具编号不一致时提示，可选择强制排期
  const confirmMoldConflict = (ln: string, sh: string, moldNew: string, molds: string[], onForce: () => void) => {
    Modal.confirm({
      title: '模具编号不一致警告',
      icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div style={{ fontSize: 12 }}>
          <div>班次「{ln} · {SHIFTS.find(s => s.key === sh)?.label || ''}」已有排期模具：<b style={{ fontFamily: 'monospace' }}>{molds.join('、')}</b></div>
          <div style={{ marginTop: 4 }}>当前订单模具：<b style={{ fontFamily: 'monospace', color: '#722ed1' }}>{moldNew}</b></div>
          <div style={{ marginTop: 6, color: '#fa8c16' }}>同线同班混排不同模具需换模调机，影响生产效率；强制排期后该格子将标红警示。</div>
        </div>
      ),
      okText: '强制排期',
      okButtonProps: { danger: true },
      cancelText: '取消排期',
      centered: true,
      onOk: onForce,
    });
  };

  // 拖入格子：登记排期（数量默认剩余可排量）；改期时校验目标班次模具一致性
  const handleDrop = (line: string, shift: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.assignKey) {
      // 已排卡片拖动 = 改期/换线/换班
      const assign = schedules.find(s => s.key === drag.assignKey || s.id === drag.assignKey);
      if (!assign) return;
      const doMove = () => {
        const list = schedules.map(s => (s.key === drag.assignKey || s.id === drag.assignKey) ? { ...s, line, shift, startDate: dateStr, endDate: dateStr } : s);
        saveSchedules(list);
        message.success('排期已调整');
      };
      // 模具一致性检查（排除自身），不一致弹窗警告，可强制排期
      const moldNew = scheduleMold(assign);
      const molds = cellMolds(line, shift, drag.assignKey);
      if (moldNew && molds.length > 0 && !molds.includes(moldNew)) {
        confirmMoldConflict(line, shift, moldNew, molds, doMove);
        return;
      }
      doMove();
      return;
    }
    const order = poOrders.find(o => o.id === drag.poId);
    if (!order) return;
    const remain = remainingOf(order);
    setDropTarget({ poId: order.id, line, shift });
    setDropQty(remain);
  };

  const confirmDrop = () => {
    if (!dropTarget) return;
    const order = poOrders.find(o => o.id === dropTarget.poId);
    if (!order) { setDropTarget(null); return; }
    const qty = Number(dropQty) || 0;
    if (qty <= 0) { message.warning('排产数量需大于 0'); return; }
    if (qty > remainingOf(order)) { message.warning(`超出剩余可排数量（${remainingOf(order)}）`); return; }
    const doSave = () => {
      const rec = {
        key: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        id: genScheduleNo(),
        productionOrderId: order.id,
        salesOrderId: order.salesOrderId || '',
        productName: order.productName || '',
        customerName: order.customerName || '',
        planQty: qty,
        line: dropTarget.line,
        shift: dropTarget.shift,
        startDate: dateStr,
        endDate: dateStr,
        person: order.person || '',
        status: 'pending',
        createTime: new Date().toLocaleString('zh-CN'),
      };
      saveSchedules([rec, ...schedules]);
      setDropTarget(null);
      appendPoLog(order.id, '排期登记', `排入 ${dropTarget.line} · ${SHIFTS.find(s => s.key === dropTarget.shift)?.label || ''}，数量 ${qty}，日期 ${dateStr}`);
      message.success(`已排入 ${dropTarget.line} · ${SHIFTS.find(s => s.key === dropTarget.shift)?.label || ''}`);
    };
    // 模具一致性检查：与目标班次已有排期模具不同时弹窗警告，可强制排期
    const moldNew = moldOf(order);
    const molds = cellMolds(dropTarget.line, dropTarget.shift);
    if (moldNew && molds.length > 0 && !molds.includes(moldNew)) {
      confirmMoldConflict(dropTarget.line, dropTarget.shift, moldNew, molds, doSave);
      return;
    }
    doSave();
  };

  const saveEdit = () => {
    if (!editTarget) return;
    const qty = Number(editTarget.planQty) || 0;
    if (qty <= 0) { message.warning('排产数量需大于 0'); return; }
    const list = schedules.map(s => (s.key === editTarget.key ? { ...editTarget, planQty: qty } : s));
    saveSchedules(list);
    setEditTarget(null);
    appendPoLog(editTarget.productionOrderId, '排期调整', `${editTarget.line} · ${SHIFTS.find(s => s.key === editTarget.shift)?.label || ''}，数量 ${qty}，日期 ${editTarget.startDate || ''}`);
    message.success('排期已更新');
  };

  const removeAssign = (key: string) => {
    const target = schedules.find(s => s.key === key);
    saveSchedules(schedules.filter(s => s.key !== key));
    setEditTarget(null);
    if (target) appendPoLog(target.productionOrderId, '移除排期', `${target.line} · ${SHIFTS.find(s => s.key === target.shift)?.label || ''}，数量 ${target.planQty}，日期 ${target.startDate || ''}`);
    message.success('已移除该排期');
  };

  const addLine = () => {
    const name = lineInput.trim();
    if (!name) { message.warning('请输入生产线名称'); return; }
    if (lines.includes(name)) { message.warning('生产线已存在'); return; }
    const next = [...lines, name];
    setLines(next); writeList(lineKey, next); setLineInput('');
  };

  const jgStatusColor = (st: string) => (st === '已完成' ? 'green' : st === '加工中' ? 'blue' : st === '已拆分' ? 'purple' : 'orange');

  // ===== 生产看板（总览视图）数据 =====
  const jgDone = jgRows.filter(j => j.status === '已完成').length;
  const progressOrders = useMemo(() => poOrders
    .filter(o => o.status !== 'completed')
    .map(o => {
      const plan = Number(o.planQuantity ?? o.planQty) || 0;
      const done = Number(o.completedQuantity ?? o.doneQty) || 0;
      return { o, plan, done, pct: plan > 0 ? Math.min(100, Math.round((done / plan) * 100)) : 0 };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12), [poOrders]);
  const loadMax = Math.max(1, ...lines.flatMap(l => SHIFTS.map(s => cellTotal(l, s.key))));

  // ===== 月度排期视图数据 =====
  const monthDays = useMemo(() => {
    const start = monthView.startOf('month');
    const count = monthView.daysInMonth();
    return Array.from({ length: count }, (_, i) => start.add(i, 'day'));
  }, [monthView]);
  const monthSchedules = useMemo(() => {
    const prefix = monthView.format('YYYY-MM');
    return schedules.filter(s => (s.startDate || '').startsWith(prefix));
  }, [schedules, monthView]);
  const monthDayTotal = (d: string) => monthSchedules.filter(s => (s.startDate || '').slice(0, 10) === d).reduce((sum, s) => sum + (Number(s.planQty) || 0), 0);
  const monthLineTotal = (line: string) => monthSchedules.filter(s => s.line === line).reduce((sum, s) => sum + (Number(s.planQty) || 0), 0);
  const monthActiveDays = new Set(monthSchedules.map(s => (s.startDate || '').slice(0, 10))).size;

  // ===== 生产线使用率数据 =====
  const monthTotalDays = monthView.daysInMonth();
  const lineUtil = (line: string) => {
    let activeShifts = 0;
    monthDays.forEach(d => {
      const ds = d.format('YYYY-MM-DD');
      SHIFTS.forEach(s => {
        const t = monthSchedules.filter(sc => sc.line === line && sc.shift === s.key && (sc.startDate || '').slice(0, 10) === ds).reduce((sum, sc) => sum + (Number(sc.planQty) || 0), 0);
        if (t > 0) activeShifts++;
      });
    });
    const totalShifts = monthTotalDays * SHIFTS.length;
    const pct = totalShifts > 0 ? Math.round((activeShifts / totalShifts) * 100) : 0;
    return { activeShifts, totalShifts, pct };
  };
  const overallUtil = () => {
    if (lines.length === 0) return 0;
    const sum = lines.reduce((s, l) => s + lineUtil(l).pct, 0);
    return Math.round(sum / lines.length);
  };

  const metricCard = (label: string, value: React.ReactNode, sub: string, color: string, bg: string) => (
    <div style={{ flex: 1, minWidth: 150, borderRadius: 10, padding: '10px 14px', background: bg, border: `1px solid ${color}22` }}>
      <div style={{ fontSize: 12, color: '#5a6d85' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: '32px' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#8c9bb0' }}>{sub}</div>
    </div>
  );

  // 切换暂不生产状态：标记后订单自动沉到底部，再次操作可恢复
  const toggleDeferred = (id: string) => {
    setDeferredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); message.success('已恢复排产，订单将按完工进度重新排序'); }
      else { next.add(id); message.success('已标记为暂不生产，订单移至底部'); }
      return next;
    });
  };

  return (
    <>
    <style>{`
      .sb-card { transition: box-shadow .2s, transform .2s; }
      .sb-card:hover { box-shadow: 0 4px 14px rgba(30,74,126,.18); transform: translateY(-1px); }
      .sb-cell { transition: border-color .2s, background .2s; }
      .sb-cell:hover { border-color: #1677ff; border-style: solid; background: #f0f7ff; }
      .sb-po-link:hover { text-decoration: underline; }
      .monthly-cell { transition: background .15s; }
      .monthly-cell:hover { background: #e6f4ff !important; }
      .sb-tabs-flex > .ant-tabs-content-holder { flex: 1; min-height: 0; overflow: hidden; }
      .sb-tabs-flex > .ant-tabs-content-holder > .ant-tabs-content { height: 100%; }
      .sb-tabs-flex > .ant-tabs-content-holder > .ant-tabs-content > .ant-tabs-tabpane-active { height: 100%; display: flex; flex-direction: column; }
    `}</style>
    <Tabs activeKey={viewMode} onChange={(k) => setViewMode(k as 'board' | 'dash' | 'list')}
      className="sb-tabs-flex"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      items={[
        { key: 'board', label: <span><ScheduleOutlined /> 排期看板</span>,
          children: (
          <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 2px 8px rgba(30,74,126,.08)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            {/* 头部 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(120deg, #1e4a7e, #2f6fb5)', borderRadius: 10, padding: '8px 14px', marginBottom: 12 }}>
              <Space size={10}>
                <Tag color="#fff" style={{ color: PRIMARY, fontSize: 13, padding: '2px 10px', border: 'none', fontWeight: 600 }}><ScheduleOutlined /> 生产排期看板</Tag>
                <span style={{ color: 'rgba(255,255,255,.85)', fontSize: 12 }}>{dateStr}</span>
              </Space>
              <Tag color="blue" style={{ borderRadius: 10, padding: '3px 10px', fontWeight: 600, fontSize: 13 }}>当日排产合计：{dayTotal.toLocaleString()}</Tag>
            </div>
            {/* 工具栏 */}
            <Space wrap style={{ marginBottom: 12 }}>
              <Button size="small" icon={<LeftOutlined />} onClick={() => setDate(d => d.subtract(1, 'day'))} />
              <DatePicker size="small" value={date} allowClear={false} onChange={d => d && setDate(d)} />
              <Button size="small" icon={<RightOutlined />} onClick={() => setDate(d => d.add(1, 'day'))} />
              <Button size="small" onClick={() => setDate(dayjs())}>今天</Button>
              <Tag color="blue" style={{ borderRadius: 10 }}>当日排产合计：{dayTotal.toLocaleString()}</Tag>
              <Tag color="orange" style={{ borderRadius: 10 }}>待排产订单：{pendingOrders.length} 单</Tag>
              <Button size="small" icon={<ToolOutlined />} onClick={reload}>刷新</Button>
              <Space size={4} style={{ marginLeft: 8 }}>
                {lines.map(l => (
                  <Tag key={l} closable onClose={() => { const next = lines.filter(x => x !== l); setLines(next); writeList(lineKey, next); }}>{l}</Tag>
                ))}
                <Input size="small" style={{ width: 90 }} placeholder="新增生产线" value={lineInput} onChange={e => setLineInput(e.target.value)} onPressEnter={addLine} />
                <Button size="small" icon={<PlusOutlined />} onClick={addLine} />
              </Space>
            </Space>
            <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
              {/* 左：待排产订单卡片（高度随窗口底部，超出可滚动） */}
              <div style={{ width: 300, flexShrink: 0, border: '1px solid #e8edf3', borderRadius: 10, padding: '8px 8px 20px', overflowY: 'auto', background: 'linear-gradient(180deg,#f7f9fc,#eef3fa)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 8, fontWeight: 600 }}><UnorderedListOutlined /> 待排产生产订单（拖拽到右侧格子排期）</div>
                <Input
                  size="small"
                  placeholder="搜索生产单号/模具编号/款式编码"
                  prefix={<SearchOutlined style={{ color: '#bbb' }} />}
                  allowClear
                  value={pendingSearch}
                  onChange={e => setPendingSearch(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                {pendingSearch && filteredPendingOrders.length !== pendingOrders.length && (
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>筛选结果：{filteredPendingOrders.length}/{pendingOrders.length} 单</div>
                )}
                {filteredPendingOrders.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={pendingSearch ? '无匹配订单' : '暂无待排产订单'} />}
                {filteredPendingOrders.map(o => {
                  const jgs = jgByPo.get(o.id) || [];
                  const doneCnt = jgs.filter(j => j.status === '已完成').length;
                  const overdue = (o.planEnd || o.endDate) && (o.planEnd || o.endDate) < dateStr;
                  const isDeferred = deferredIds.has(o.id);
                  return (
                    <div key={o.id} className="sb-card" draggable
                      onDragStart={() => { dragRef.current = { poId: o.id }; }}
                      style={{ background: '#fff', border: `1px solid ${overdue ? '#ffa39e' : '#d6e4ff'}`, borderLeft: `4px solid ${overdue ? '#ff4d4f' : PRIMARY}`, borderRadius: 8, padding: 8, marginBottom: 8, cursor: 'grab', opacity: isDeferred ? 0.5 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="sb-po-link" title="点击查看计划明细"
                          onClick={e => { e.stopPropagation(); setPlanPo(o); }}
                          style={{ fontFamily: 'monospace', fontSize: 14, color: '#1677ff', fontWeight: 700, cursor: 'pointer' }}>
                          <HolderOutlined style={{ color: '#bbb', marginRight: 4 }} />{o.id}
                        </span>
                        {isDeferred && <Tag color="default" style={{ fontSize: 10, margin: 0 }}>暂不生产</Tag>}
                        {overdue && <Tooltip title={`计划完工 ${o.planEnd || o.endDate} 早于排期日`}><WarningOutlined style={{ color: '#ff4d4f' }} /></Tooltip>}
                      </div>
                      <div style={{ fontSize: 13, color: '#722ed1', margin: '2px 0 2px' }}>
                        模具编号：<span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{moldOf(o) || '—'}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#1677ff', margin: '0 0 4px' }}>
                        {(() => {
                          const items = Array.isArray(o.planItems) ? o.planItems : [];
                          const qtyByCode = new Map<string, number>();
                          items.forEach((it: any) => {
                            const code = styleCodeOf(it);
                            if (!code) return;
                            qtyByCode.set(code, (qtyByCode.get(code) || 0) + (Number(it.productionQty ?? it.quantity) || 0));
                          });
                          if (qtyByCode.size === 0) return <>款式编码：<span style={{ fontFamily: 'monospace', fontWeight: 600 }}>—</span></>;
                          const entries = Array.from(qtyByCode.entries());
                          const display = entries.slice(0, 3).map(([c, q]) => `${c} ×${q}`).join('、');
                          const suffix = entries.length > 3 ? ` 等${entries.length}项` : '';
                          const full = entries.map(([c, q]) => `${c} ×${q}`).join('\n');
                          return <Tooltip title={<pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{full}</pre>} placement="topLeft">款式编码：<span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{display}{suffix}</span></Tooltip>;
                        })()}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, margin: '4px 0' }}>{o.productName || '—'}</div>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{o.customerName || '—'}</div>
                      <Space size={4} wrap style={{ marginBottom: 4 }}>
                        <Tag color="blue" style={{ marginInlineEnd: 0, borderRadius: 10 }}>计划 {(() => {
                          const items = Array.isArray(o.planItems) ? o.planItems : [];
                          const planSum = items.reduce((s: number, it: any) => s + (Number(it.productionQty ?? it.quantity) || 0), 0);
                          return (planSum > 0 ? planSum : (Number(o.planQuantity ?? o.planQty) || 0)).toLocaleString();
                        })()}</Tag>
                        <Tag color="orange" style={{ marginInlineEnd: 0, borderRadius: 10 }}>待排 {remainingOf(o).toLocaleString()}</Tag>
                      </Space>
                      <div style={{ fontSize: 11, color: '#5a6d85', borderTop: '1px dashed #e8edf3', paddingTop: 4 }}>
                        半成品加工：{jgs.length === 0 ? <span style={{ color: '#bbb' }}>未生成加工清单</span> : (
                          <span>
                            <Tag color={doneCnt === jgs.length ? 'green' : 'orange'} style={{ marginInlineEnd: 4 }}>{doneCnt}/{jgs.length} 完成</Tag>
                            {jgs.slice(0, 3).map(j => <Tag key={j.id || j.key} color={jgStatusColor(j.status)} style={{ marginInlineEnd: 2, fontSize: 10 }}>{j.shortName || j.productCode || '半成品'}·{j.status || '待加工'}</Tag>)}
                            {jgs.length > 3 && <span style={{ color: '#999' }}>+{jgs.length - 3}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 右：生产线 × 班次 格子 */}
              <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'auto', minHeight: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${SHIFTS.length}, minmax(260px, 1fr))`, gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 18, color: '#5a6d85', display: 'flex', alignItems: 'center' }}>生产线 \ 班次</div>
                  {SHIFTS.map(s => (
                    <div key={s.key} style={{ textAlign: 'center', fontWeight: 600, fontSize: 18, color: '#fff', background: `linear-gradient(120deg, ${s.color}, ${s.color}cc)`, borderRadius: 8, padding: '6px 0' }}>
                      {s.label} <span style={{ fontSize: 14, color: 'rgba(255,255,255,.85)', fontWeight: 400 }}>{s.range}</span>
                    </div>
                  ))}
                  {lines.map(line => (
                    <React.Fragment key={line}>
                      <div style={{ fontWeight: 600, fontSize: 18, color: PRIMARY, display: 'flex', alignItems: 'center', background: '#f0f5fb', borderRadius: 8, padding: '0 8px' }}>{line}</div>
                      {SHIFTS.map(s => {
                        const items = cellOf(line, s.key);
                        const total = cellTotal(line, s.key);
                        const conflict = cellConflict(line, s.key);
                        return (
                          <div key={s.key} className="sb-cell"
                            onDragOver={e => { e.preventDefault(); }}
                            onDrop={() => handleDrop(line, s.key)}
                            style={{ minHeight: 130, border: `1px dashed ${conflict ? '#ff7875' : total > 0 ? '#91caff' : '#c9d6e8'}`, borderRadius: 10, padding: 6, background: conflict ? '#fff1f0' : total > 0 ? '#f0f7ff' : '#fafbfc' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, color: conflict ? '#cf1322' : '#888', marginBottom: 4 }}>
                              <span>{line} · {s.label}{conflict && <Tooltip title="班次内排期的模具编号不一致（强制排期）"><WarningOutlined style={{ color: '#ff4d4f', marginLeft: 4 }} /></Tooltip>}</span>
                              <Tag color={conflict ? 'red' : total > 0 ? 'blue' : 'default'} style={{ marginInlineEnd: 0, fontSize: 14, borderRadius: 10 }}>需生产 {total.toLocaleString()}</Tag>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto' }}>
                            {items.map(it => {
                              const srcOrder = poOrders.find((oo: any) => oo.id === it.productionOrderId);
                              const mold = srcOrder ? moldOf(srcOrder) : '';
                              const pItems = Array.isArray(it.planItems) ? it.planItems : (srcOrder && Array.isArray(srcOrder.planItems) ? srcOrder.planItems : []);
                              const qtyByCode = new Map<string, number>();
                              if (pItems.length > 0) {
                                const totalPlan = pItems.reduce((s: number, pi: any) => s + (Number(pi.productionQty ?? pi.quantity) || 0), 0);
                                const ratio = totalPlan > 0 ? (Number(it.planQty) || 0) / totalPlan : 1;
                                pItems.forEach((pi: any) => {
                                  const code = styleCodeOf(pi) || '未知';
                                  const itemQty = Math.round((Number(pi.productionQty ?? pi.quantity) || 0) * ratio);
                                  qtyByCode.set(code, (qtyByCode.get(code) || 0) + itemQty);
                                });
                              }
                              return (
                                <div key={it.key || it.id} className="sb-card" draggable
                                  onDragStart={() => { dragRef.current = { poId: it.productionOrderId, assignKey: it.key }; }}
                                  onClick={() => setEditTarget({ ...it })}
                                  style={{ background: '#fff', border: '1px solid #91d5ff', borderLeft: `3px solid ${PRIMARY}`, borderRadius: 6, padding: '6px 8px', cursor: 'grab', flex: 1, minWidth: 0, flexShrink: 0 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 22, marginBottom: 2 }}>
                                    <span className="sb-po-link" title="点击查看计划明细"
                                      onClick={e => { e.stopPropagation(); if (srcOrder) setPlanPo(srcOrder); }}
                                      style={{ fontFamily: 'monospace', color: '#1677ff', fontWeight: 700, cursor: 'pointer' }}>{it.productionOrderId}</span>
                                    <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 18, borderRadius: 10, fontWeight: 600 }}>{Number(it.planQty || 0).toLocaleString()}</Tag>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 18, marginBottom: 2 }}>
                                    <span style={{ color: '#722ed1', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>模具：{mold || '—'}</span>
                                    {Array.from(qtyByCode.entries()).length > 0 ? Array.from(qtyByCode.entries()).map(([code, qty]) => (
                                      <span key={code} style={{ whiteSpace: 'nowrap' }}>
                                        <span style={{ color: '#1677ff', fontWeight: 600 }}>{code}</span>
                                        <span style={{ color: '#888' }}>×{qty}</span>
                                      </span>
                                    )) : <span style={{ color: '#999' }}>{it.productName || '—'}</span>}
                                  </div>
                                </div>
                              );
                            })}
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
                  提示：左侧订单卡片拖入格子登记排期（默认排入剩余数量）；点击单号查看计划明细；格内卡片可拖动到其他格子改期/换线/换班，点击可修改数量或移除；同线同班模具编号不一致时弹窗警告，强制排期后格子标红警示；排期记录同步到下方排期列表。
                </div>
              </div>
            </div>
          </div>
          ),
        },
        { key: 'dash', label: <span><DashboardOutlined /> 生产看板</span>,
          children: (
            <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 2px 8px rgba(30,74,126,.08)', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
              <div style={{ paddingBottom: 40 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                {metricCard('待排产订单', pendingOrders.length, '仍有剩余数量未排产', '#fa8c16', '#fff7e6')}
                {metricCard('当日排产单数', daySchedules.length, `${dateStr}`, '#1890ff', '#e6f4ff')}
                {metricCard('当日排产合计', dayTotal.toLocaleString(), '各线各班需生产总量', PRIMARY, '#f0f5ff')}
                {metricCard('半成品完成', `${jgDone}/${jgRows.length}`, '加工订单完成进度', '#52c41a', '#f6ffed')}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 320, border: '1px solid #e8edf3', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: PRIMARY, marginBottom: 10 }}><AppstoreOutlined /> 当日生产线负荷（上午/下午/晚上）</div>
                  {lines.map(line => (
                    <div key={line} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2b45', marginBottom: 4 }}>{line}</div>
                      {SHIFTS.map(s => {
                        const total = cellTotal(line, s.key);
                        const conflict = cellConflict(line, s.key);
                        return (
                          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ width: 34, fontSize: 11, color: conflict ? '#cf1322' : '#888', flexShrink: 0 }}>{s.label}{conflict && <WarningOutlined style={{ color: '#ff4d4f', fontSize: 10, marginLeft: 2 }} />}</span>
                            <div style={{ flex: 1, height: 12, background: '#f0f2f5', borderRadius: 6, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.round((total / loadMax) * 100)}%`, height: '100%', background: `linear-gradient(90deg, ${conflict ? '#ff4d4f' : s.color}, ${conflict ? '#ff7875' : s.color + 'aa'})`, borderRadius: 6, transition: 'width .3s' }} />
                            </div>
                            <span style={{ width: 64, fontSize: 11, color: '#555', textAlign: 'right', flexShrink: 0 }}>{total.toLocaleString()} 双</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 320, border: '1px solid #e8edf3', borderRadius: 10, padding: 12, maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: PRIMARY, marginBottom: 10, position: 'sticky', top: 0, background: '#fff', zIndex: 1, paddingBottom: 4 }}><UnorderedListOutlined /> 生产订单进度（未完工 Top 12）</div>
                  {progressOrders.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无进行中订单" />}
                  {progressOrders.map(({ o, plan, done, pct }) => {
                    const overdue = (o.planEnd || o.endDate) && String(o.planEnd || o.endDate) < dayjs().format('YYYY-MM-DD');
                    return (
                      <div key={o.id} className="sb-card" style={{ border: `1px solid ${overdue ? '#ffa39e' : '#e8edf3'}`, borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1677ff', fontWeight: 600 }}>
                            {o.id}{overdue && <Tooltip title={`计划完工 ${o.planEnd || o.endDate} 已逾期`}><WarningOutlined style={{ color: '#ff4d4f', marginLeft: 6 }} /></Tooltip>}
                          </span>
                          <span style={{ fontSize: 11, color: '#888' }}>{done.toLocaleString()} / {plan.toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#1677ff', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(() => {
                          const items = Array.isArray(o.planItems) ? o.planItems : [];
                          const qtyByCode = new Map<string, number>();
                          items.forEach((it: any) => {
                            const code = styleCodeOf(it);
                            if (!code) return;
                            qtyByCode.set(code, (qtyByCode.get(code) || 0) + (Number(it.productionQty ?? it.quantity) || 0));
                          });
                          if (qtyByCode.size === 0) return <span style={{ color: '#999' }}>{o.productName || '—'}</span>;
                          const entries = Array.from(qtyByCode.entries());
                          return entries.map(([c, q]) => `${c} ×${q}`).join('、');
                        })()}</div>
                        <Progress percent={pct} size="small" strokeColor={{ from: '#2f6fb5', to: '#52c41a' }} status={pct >= 100 ? 'success' : 'active'} />
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 月度排期视图 */}
              <div style={{ marginTop: 14, borderTop: '1px solid #e8edf3', paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: PRIMARY }}><CalendarOutlined /> 月度排期</div>
                  <Space>
                    <Button size="small" icon={<LeftOutlined />} onClick={() => setMonthView(prev => prev.subtract(1, 'month'))} />
                    <DatePicker picker="month" value={monthView} onChange={v => { if (v) setMonthView(v); }} allowClear={false} style={{ width: 130 }} />
                    <Button size="small" icon={<RightOutlined />} onClick={() => setMonthView(prev => prev.add(1, 'month'))} />
                    <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>排产合计：<b style={{ color: PRIMARY }}>{monthSchedules.reduce((s, x) => s + (Number(x.planQty) || 0), 0).toLocaleString()}</b> 双 · 排产 <b>{monthActiveDays}</b>/{monthTotalDays} 天</span>
                  </Space>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: lines.length > 3 ? 800 : 600 }}>
                    <thead>
                      <tr style={{ background: '#fafafa' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #e8edf3', position: 'sticky', left: 0, background: '#fafafa', zIndex: 1, minWidth: 80 }}>生产线</th>
                        {monthDays.map(d => {
                          const dayStr = d.format('YYYY-MM-DD');
                          const isToday = dayStr === dayjs().format('YYYY-MM-DD');
                          const isWeekend = d.day() === 0 || d.day() === 6;
                          return (
                            <th key={dayStr} style={{ padding: '4px 2px', textAlign: 'center', borderBottom: '2px solid #e8edf3', minWidth: 28, background: isToday ? '#e6f4ff' : '#fafafa' }}>
                              <div style={{ fontSize: 9, color: isWeekend ? '#ff7875' : '#999' }}>{d.format('ddd')}</div>
                              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? PRIMARY : isWeekend ? '#ff7875' : '#333' }}>{d.date()}</div>
                            </th>
                          );
                        })}
                        <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #e8edf3', background: '#fafafa', minWidth: 50 }}>合计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, li) => (
                        <tr key={line} style={{ background: li % 2 === 0 ? '#fff' : '#fafbfc' }}>
                          <td style={{ padding: '4px 8px', fontWeight: 600, fontSize: 11, borderBottom: '1px solid #f0f0f0', position: 'sticky', left: 0, background: li % 2 === 0 ? '#fff' : '#fafbfc', zIndex: 1 }}>{line}</td>
                          {monthDays.map(d => {
                            const dayStr = d.format('YYYY-MM-DD');
                            const dayTotal = monthSchedules.filter(s => s.line === line && (s.startDate || '').slice(0, 10) === dayStr).reduce((sum, s) => sum + (Number(s.planQty) || 0), 0);
                            const dayMax = Math.max(1, ...lines.map(l => monthSchedules.filter(s => s.line === l && (s.startDate || '').slice(0, 10) === dayStr).reduce((sum, s) => sum + (Number(s.planQty) || 0), 0)));
                            const intensity = dayTotal > 0 ? Math.min(1, dayTotal / dayMax) : 0;
                            const bg = dayTotal > 0 ? `rgba(30,74,126,${0.08 + intensity * 0.35})` : 'transparent';
                            return (
                              <td key={dayStr} className="monthly-cell" style={{ padding: '2px', textAlign: 'center', borderBottom: '1px solid #f5f5f5', background: bg, cursor: 'default' }}>
                                <Tooltip title={dayTotal > 0 ? `${line} · ${d.format('M/D')}：${dayTotal.toLocaleString()} 双` : ''}>
                                  <span style={{ fontSize: 10, color: dayTotal > 0 ? '#fff' : 'transparent', fontWeight: 600 }}>{dayTotal > 0 ? dayTotal : '·'}</span>
                                </Tooltip>
                              </td>
                            );
                          })}
                          <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #f0f0f0', color: PRIMARY }}>{monthLineTotal(line).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr style={{ background: '#f0f5ff' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 700, fontSize: 11, borderTop: '2px solid #d6e4ff', position: 'sticky', left: 0, background: '#f0f5ff', zIndex: 1 }}>日合计</td>
                        {monthDays.map(d => {
                          const dayStr = d.format('YYYY-MM-DD');
                          const total = monthDayTotal(dayStr);
                          return <td key={dayStr} style={{ padding: '4px 2px', textAlign: 'center', fontWeight: 600, fontSize: 10, color: total > 0 ? PRIMARY : '#ccc', borderTop: '2px solid #d6e4ff' }}>{total > 0 ? total.toLocaleString() : '—'}</td>;
                        })}
                        <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, fontSize: 13, color: PRIMARY, borderTop: '2px solid #d6e4ff' }}>{monthSchedules.reduce((s, x) => s + (Number(x.planQty) || 0), 0).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {/* 生产线使用率 */}
              <div style={{ marginTop: 14, borderTop: '1px solid #e8edf3', paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: PRIMARY }}><DashboardOutlined /> 生产线使用率 <span style={{ fontSize: 11, color: '#999', fontWeight: 400, marginLeft: 8 }}>使用率 = 有排期班次数 ÷ 总可用班次（{monthTotalDays}天×{SHIFTS.length}班）</span></div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                  {metricCard('综合使用率', `${overallUtil()}%`, `${lines.length}条生产线平均`, overallUtil() >= 60 ? '#52c41a' : overallUtil() >= 30 ? '#faad14' : '#ff4d4f', overallUtil() >= 60 ? '#f6ffed' : overallUtil() >= 30 ? '#fffbe6' : '#fff2f0')}
                  {metricCard('月度排产总量', monthSchedules.reduce((s, x) => s + (Number(x.planQty) || 0), 0).toLocaleString(), '双', PRIMARY, '#f0f5ff')}
                  {metricCard('排产天数', `${monthActiveDays}/${monthTotalDays}`, '天', '#1890ff', '#e6f4ff')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {lines.map(line => {
                    const u = lineUtil(line);
                    const lTotal = monthLineTotal(line);
                    const color = u.pct >= 70 ? '#52c41a' : u.pct >= 40 ? '#faad14' : u.pct > 0 ? '#1890ff' : '#d9d9d9';
                    return (
                      <div key={line} style={{ border: '1px solid #e8edf3', borderRadius: 10, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: '#1a2b45' }}>{line}</span>
                          <span style={{ fontSize: 22, fontWeight: 700, color }}>{u.pct}%</span>
                        </div>
                        <Progress percent={u.pct} showInfo={false} strokeColor={color} trailColor="#f0f2f5" size={['100%', 10]} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#888' }}>
                          <span>排产班次：<b style={{ color: '#333' }}>{u.activeShifts}</b> / {u.totalShifts}</span>
                          <span>排产总量：<b style={{ color: '#333' }}>{lTotal.toLocaleString()}</b> 双</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {lines.length > 0 && (
                  <div style={{ marginTop: 12, border: '1px solid #e8edf3', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: PRIMARY, marginBottom: 10 }}><DashboardOutlined /> 各线使用率对比</div>
                    {lines.map(line => {
                      const u = lineUtil(line);
                      const color = u.pct >= 70 ? '#52c41a' : u.pct >= 40 ? '#faad14' : u.pct > 0 ? '#1890ff' : '#d9d9d9';
                      return (
                        <div key={line} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ width: 80, fontSize: 12, fontWeight: 600, color: '#1a2b45', flexShrink: 0 }}>{line}</span>
                          <div style={{ flex: 1, height: 16, background: '#f0f2f5', borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ width: `${u.pct}%`, height: '100%', background: `linear-gradient(90deg, ${color}, ${color}aa)`, borderRadius: 8, transition: 'width .3s' }} />
                          </div>
                          <span style={{ width: 44, fontSize: 12, color, textAlign: 'right', fontWeight: 700, flexShrink: 0 }}>{u.pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              </div>
            </div>
          ),
        },
        ...(listView ? [{ key: 'list', label: <span><AppstoreOutlined /> 排期列表</span>,
          children: <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 2px 8px rgba(30,74,126,.08)' }}>{listView}</div>,
        }] : []),
      ]}
    />

    {/* 计划明细弹窗（点击待排卡片生产单号） */}
    <Modal title={<span style={{ color: PRIMARY }}><UnorderedListOutlined style={{ marginRight: 8 }} />计划明细 — {planPo?.id || ''}</span>}
      open={!!planPo} onCancel={() => setPlanPo(null)} destroyOnHidden footer={[
        <Button key="defer" onClick={() => { if (planPo) { toggleDeferred(planPo.id); setPlanPo(null); } }}>
          {planPo && deferredIds.has(planPo.id) ? '恢复排产' : '暂不生产'}
        </Button>,
        <Button key="close" onClick={() => setPlanPo(null)}>关闭</Button>,
      ]} width={680}>
      {planPo && (() => {
        const items = Array.isArray(planPo.planItems) ? planPo.planItems : [];
        if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该订单暂无计划明细" />;
        return (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['图片', '款式编码', '商品编码', '产品种类', '数量', '模具编号'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => {
                const product = products.find((p: any) => p.productCode === it.productCode);
                const imgSrc = product ? localStorage.getItem(`prodImg_${owner}_${product.key}`) : null;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '4px 8px' }}>
                      {imgSrc ? <img src={imgSrc} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ color: '#bbb' }}>—</span>}
                    </td>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: '#1677ff' }}>{styleCodeOf(it) || '—'}</td>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{it.productCode || '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{product?.productType ? <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{product.productType}</Tag> : '—'}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 600 }}>{Number(it.productionQty ?? it.quantity) || 0}</td>
                    <td style={{ padding: '4px 8px', color: '#722ed1', fontFamily: 'monospace' }}>{product?.moldCode || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })()}
    </Modal>

    {/* 拖拽确认弹窗 */}
    <Modal title="确认排期" open={!!dropTarget} onOk={confirmDrop} onCancel={() => setDropTarget(null)} width={460}>
      {dropTarget && (() => {
        const regOrder = poOrders.find(o => o.id === dropTarget.poId);
        const moldNew = regOrder ? moldOf(regOrder) : '';
        const molds = cellMolds(dropTarget.line, dropTarget.shift);
        const moldConflict = !!moldNew && molds.length > 0 && !molds.includes(moldNew);
        return (
          <div>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#5a6d85' }}>
              排入：{dropTarget.line} · {SHIFTS.find(s => s.key === dropTarget.shift)?.label}（{dateStr}）
            </div>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#5a6d85' }}>
              剩余可排数量：{remainingOf(poOrders.find(o => o.id === dropTarget.poId) || {}).toLocaleString()}
            </div>
            {moldConflict && (
              <Alert type="warning" showIcon style={{ marginBottom: 8 }}
                message="模具编号不一致"
                description={<span>该班次已有排期模具 <b style={{ fontFamily: 'monospace' }}>{molds.join('、')}</b>，当前订单模具 <b style={{ fontFamily: 'monospace', color: '#722ed1' }}>{moldNew}</b>；确认排期时会再次警告，可选择强制排期（格子将标红）。</span>} />
            )}
            <InputNumber style={{ width: '100%' }} min={1} value={dropQty} onChange={v => setDropQty(Number(v) || 0)} addonBefore="排产数量" />
          </div>
        );
      })()}
    </Modal>

    {/* 已排编辑弹窗 */}
    <Modal title={`排期调整 - ${editTarget?.productionOrderId || ''}`} open={!!editTarget} onCancel={() => setEditTarget(null)} onOk={saveEdit} okText="保存" cancelText="取消" width={460}
      footer={[
        <Button key="del" danger icon={<DeleteOutlined />} onClick={() => editTarget && removeAssign(editTarget.key)}>移除排期</Button>,
        <Button key="c" onClick={() => setEditTarget(null)}>取消</Button>,
        <Button key="s" type="primary" onClick={saveEdit}>保存</Button>,
      ]}>
      {editTarget && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div><div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4 }}>排产数量</div>
            <InputNumber style={{ width: '100%' }} min={1} value={editTarget.planQty} onChange={v => setEditTarget({ ...editTarget, planQty: Number(v) || 0 })} /></div>
          <div><div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4 }}>生产线</div>
            <Select style={{ width: '100%' }} value={editTarget.line} onChange={v => setEditTarget({ ...editTarget, line: v })} options={lines.map(l => ({ value: l, label: l }))} /></div>
          <div><div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4 }}>班次</div>
            <Select style={{ width: '100%' }} value={editTarget.shift} onChange={v => setEditTarget({ ...editTarget, shift: v })} options={SHIFTS.map(s => ({ value: s.key, label: `${s.label}（${s.range}）` }))} /></div>
          <div><div style={{ fontSize: 12, color: '#5a6d85', marginBottom: 4 }}>负责人</div>
            <Input value={editTarget.person || ''} onChange={e => setEditTarget({ ...editTarget, person: e.target.value })} placeholder="负责人" /></div>
        </div>
      )}
    </Modal>
    </>
  );
};

export default ScheduleBoard;
