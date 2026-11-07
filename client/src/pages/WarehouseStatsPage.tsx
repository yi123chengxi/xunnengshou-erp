import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Form, Row, Col, Tag, message, Statistic, Image as AntdImage, Empty,
  Upload, Tabs, InputNumber, DatePicker, Popconfirm, Tooltip, Card, Badge, AutoComplete, Dropdown, Progress, Radio,
  ConfigProvider, Transfer, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, FileExcelOutlined, ReloadOutlined, SearchOutlined,
  UploadOutlined, CheckCircleOutlined, DollarOutlined, TeamOutlined, SettingOutlined, FileTextOutlined,
  BarChartOutlined, AppstoreOutlined, SyncOutlined, QuestionCircleOutlined, ScanOutlined, TagsOutlined,
  CalendarOutlined, FundOutlined, PieChartOutlined, RiseOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import ImageSlot from '../components/ImageSlot';
import FieldConfigModal from '../components/FieldConfigModal';
import type { FieldConfigItem } from '../components/FieldConfigModal';
import useResizableColumns from '../hooks/useResizableColumns';
import { loadTenantUsers, tenantUserDisplayName } from '../utils/tenantUsers';
import { saveDataset, loadDataset } from '../utils/dataStore';
import { reloadAfterPull } from '../utils/serverSync';

// 表格贴底样式注入
const STICKY_BOTTOM_STYLE = `
.wh-stats-tabs .ant-tabs-content-holder,
.wh-stats-tabs .ant-tabs-content,
.wh-stats-tabs .ant-tabs-tabpane-active {
  flex: 1 !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
}
.wh-stats-tabs .ant-tabs-tabpane {
  overflow: hidden;
}
.wh-stats-tabs .ant-table-wrapper {
  flex: 1 !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
}
.wh-stats-tabs .ant-spin-nested-loading,
.wh-stats-tabs .ant-spin-container,
.wh-stats-tabs .ant-table {
  flex: 1 !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
}
.wh-stats-tabs .ant-table-body {
  flex: 1 !important;
  min-height: 200px !important;
}
`;
const styleEl = document.createElement('style');
styleEl.textContent = STICKY_BOTTOM_STYLE;
document.head.appendChild(styleEl);

// ============ 工具函数 ============
const getDataOwner = (): string => {
  try {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    return localStorage.getItem('username') || '';
  } catch { return ''; }
};
const safeJson = <T,>(k: string, d: T): T => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : (v as T); } catch { return d; }
};
const writeJson = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// 标签统计 IndexedDB 缓存（解决 localStorage 5MB 限制）
const _olKey = (owner: string) => `ws_orderLabel_${owner}`;
let _olCache: { owner: string; list: OrderLabelRecord[] } | null = null;
const readOLSync = (owner: string): OrderLabelRecord[] => {
  if (_olCache && _olCache.owner === owner) return _olCache.list;
  let list: OrderLabelRecord[] = [];
  try { list = JSON.parse(localStorage.getItem(_olKey(owner)) || '[]'); } catch { /* ignore */ }
  _olCache = { owner, list };
  return list;
};
const writeOL = (owner: string, list: OrderLabelRecord[]): void => {
  _olCache = { owner, list };
  const json = JSON.stringify(list);
  saveDataset(_olKey(owner), json);
  if (json.length < 2000000) {
    try { localStorage.setItem(_olKey(owner), json); } catch { /* localStorage 超限忽略，IndexedDB 已保存 */ }
  }
  window.dispatchEvent(new Event('ol-changed'));
};
const genKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const todayIso = () => dayjs().format('YYYY-MM-DD');

// ============ 权限与时间范围 ============
const isAdmin = localStorage.getItem('isSubAccount') !== 'true';
const curUsername = localStorage.getItem('username') || '';

type QuickRange = '' | 'today' | 'yesterday' | 'thisMonth' | 'lastMonth';

const getQuickRange = (type: QuickRange): [string, string] => {
  const now = dayjs();
  if (type === 'today') return [now.format('YYYY-MM-DD'), now.format('YYYY-MM-DD')];
  if (type === 'yesterday') return [now.subtract(1, 'day').format('YYYY-MM-DD'), now.subtract(1, 'day').format('YYYY-MM-DD')];
  if (type === 'thisMonth') return [now.startOf('month').format('YYYY-MM-DD'), now.endOf('month').format('YYYY-MM-DD')];
  if (type === 'lastMonth') return [now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD'), now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD')];
  return ['', ''];
};

const QUICK_LABELS: Record<string, string> = { today: '今日数据', yesterday: '昨日数据', thisMonth: '本月数据', lastMonth: '上月数据' };

// ============ Context 跨 Tab 共享 ============
interface WarehouseCtxType {
  viewManagers: string[];
  editManagers: string[];
  quickRange: QuickRange;
  setQuickRange: (v: QuickRange) => void;
}
const WarehouseCtx = createContext<WarehouseCtxType>({ viewManagers: [], editManagers: [], quickRange: '', setQuickRange: () => {} });
const useWarehouseCtx = () => useContext(WarehouseCtx);
const getDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u) return u.displayName || u.contactPerson || u.name || username;
  } catch { /* ignore */ }
  return username || '未知';
};

// ============ 数据类型 ============
interface StockRecord {
  key: string; month: string; date: string; orderNo: string; productCode: string;
  quantity: number; qcInspector: string; material: string; remark: string;
  image: string; creator: string; priceRate: number; qcWage: number;
  packer: string; packWage: number; lastEditor: string; lastEditTime: string;
  commission: number; person: string; foreignTeam: string;
}
interface PickRecord {
  key: string; orderNo: string; quantity: number; wage: number;
  image: string; createdAt: string; creator: string; month: string; material: string; priceRate: number; picker: string;
}
interface UrgentRecord {
  key: string; isDuplicate: boolean; orderNo: string; inspectorId: string;
  quantity: number; inspector: string; qcDate: string; material: string;
  priceRate: number; wage: number; lastEditTime: string; month: string;
  packWage: number; packer: string; commission: number; foreignTeam: string;
  productCode: string; remark: string; image: string; creator: string;
  date: string; lastEditor: string;
}
interface StockWageRate { key: string; material: string; rate: number; packRate: number; teamRate: number; }
interface UrgentWageRate { key: string; material: string; rate: number; packRate: number; teamRate: number; }
interface PickWageRate { key: string; rate: number; }
interface PackGroup { key: string; id: string; inspector: string; inspectorId: string; packer: string; foreignTeam: string; }
interface NoteItem { key: string; note: string; person: string; amount: number; date: string; month: string; type?: 'reward' | 'punishment'; }
interface OrderLabelRecord { key: string; orderNo: string; label: string; styleNo: string; quantity: number; material: string; createdAt: string; creator: string; }

// ============ 存储键 ============
const SK = (owner: string) => ({
  stock: `ws_stock_${owner}`, pick: `ws_pick_${owner}`, urgent: `ws_urgent_${owner}`,
  wage: `ws_wage_${owner}`, urgentWage: `ws_urgentWage_${owner}`, pickWage: `ws_pickWage_${owner}`,
  group: `ws_group_${owner}`, note: `ws_note_${owner}`, orderLabel: `ws_orderLabel_${owner}`,
});

// ============ 统计卡组件 ============
const StatCard: React.FC<{ title: string; value: number; suffix?: string; color: string; icon: React.ReactNode; precision?: number }> = ({ title, value, suffix, color, icon, precision = 0 }) => (
  <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', minWidth: 150 }} bodyStyle={{ padding: '12px 16px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: `linear-gradient(135deg, ${color}22, ${color}44)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>{title}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#262626' }}>{precision ? `¥${value.toFixed(precision)}` : value}{suffix && <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 2 }}>{suffix}</span>}</div>
      </div>
    </div>
  </Card>
);

// ============ 备货单统计 ============
const emptyStock = (): StockRecord => ({
  key: genKey('WS'), month: dayjs().format('YYYY-MM'), date: todayIso(), orderNo: '', productCode: '',
  quantity: 0, qcInspector: '', material: '', remark: '', image: '', creator: getDisplayName(),
  priceRate: 0, qcWage: 0, packer: '', packWage: 0, lastEditor: getDisplayName(), lastEditTime: todayIso(),
  commission: 0, person: '', foreignTeam: '',
});

const StockTab: React.FC = () => {
  const owner = getDataOwner();
  const sk = SK(owner);
  const { wrapColumns: wrapStockCols } = useResizableColumns<any>(`colWidths_ws_stock_${owner}`);
  const { viewManagers, editManagers, quickRange } = useWarehouseCtx();
  const [records, setRecords] = useState<StockRecord[]>(() => safeJson<StockRecord[]>(sk.stock, []));
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [appliedDateRange, setAppliedDateRange] = useState<[string, string] | null>(null);
  const [fMonth, setFMonth] = useState('');
  const [appliedFMonth, setAppliedFMonth] = useState('');
  const [fInspector, setFInspector] = useState('');
  const [appliedFInspector, setAppliedFInspector] = useState('');
  const [fMaterial, setFMaterial] = useState('');
  const [appliedFMaterial, setAppliedFMaterial] = useState('');
  const [fCompare, setFCompare] = useState('');
  const [appliedFCompare, setAppliedFCompare] = useState('');
  const [fUrgent, setFUrgent] = useState('');
  const [appliedFUrgent, setAppliedFUrgent] = useState('');
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<StockRecord | null>(null);
  const [form] = Form.useForm();
  const [wageRates, setWageRates] = useState<StockWageRate[]>(() => safeJson<StockWageRate[]>(sk.wage, []));
  const [packGroups, setPackGroups] = useState<PackGroup[]>(() => safeJson<PackGroup[]>(sk.group, []));
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [wagePreview, setWagePreview] = useState<{ rate: number; packRate: number; teamRate: number } | null>(null);
  const [compareOrderNo, setCompareOrderNo] = useState<string | null>(null);
  const [urgentTick, setUrgentTick] = useState(0);
  const [olRecords, setOlRecords] = useState<OrderLabelRecord[]>([]);
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(`ws_stockFieldOrder_${owner}`) || '[]'); return Array.isArray(v) && v.length ? v : []; } catch { return []; }
  });
  const [fieldVis, setFieldVis] = useState<Record<string, boolean>>(() => {
    try { const v = JSON.parse(localStorage.getItem(`ws_stockFieldVis_${owner}`) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  });
  // 动态表格高度（视口锚定）
  const stockTableRef = React.useRef<HTMLDivElement>(null);
  const [stockScrollY, setStockScrollY] = useState(400);
  useEffect(() => {
    const calc = () => {
      if (!stockTableRef.current) return;
      const header = stockTableRef.current.querySelector('.ant-table-thead') as HTMLElement;
      if (!header) return;
      const bodyTop = header.getBoundingClientRect().bottom;
      // 用 TabPane 容器实际高度而非 window.innerHeight（容器有 padding，innerHeight 偏大）
      const pane = stockTableRef.current.closest('.ant-tabs-tabpane') as HTMLElement;
      const bottom = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
      const available = Math.max(200, bottom - bodyTop - 52);
      setStockScrollY(available);
      const body = stockTableRef.current.querySelector('.ant-table-body') as HTMLElement;
      if (body) body.style.minHeight = `${available}px`;
    };
    const t1 = setTimeout(calc, 150);
    const t2 = setTimeout(calc, 500);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', calc); };
  }, []);

  // 材质变更时即时重读工价并更新预览
  const handleMaterialChange = (material: string) => {
    const latestWages: StockWageRate[] = safeJson<StockWageRate[]>(sk.wage, []);
    setWageRates(latestWages);
    const rm: Record<string, number> = {}; const prm: Record<string, number> = {}; const trm: Record<string, number> = {};
    latestWages.forEach(w => { rm[w.material] = w.rate; if (w.packRate) prm[w.material] = w.packRate; if (w.teamRate) trm[w.material] = w.teamRate; });
    if (material) {
      setWagePreview({ rate: rm[material] || 0, packRate: prm[material] || 0, teamRate: trm[material] || 0 });
    } else {
      setWagePreview(null);
    }
  };

  // 根据质检员匹配分组中的打包员/外贸组长
  const groupMap = useMemo(() => {
    const m: Record<string, PackGroup> = {};
    packGroups.forEach(g => { if (g.inspector) m[g.inspector] = g; });
    return m;
  }, [packGroups]);

  const handleBatchUpdate = async (type: 'packer' | 'foreignTeam' | 'wages' | 'material' | 'compare' | 'urgentDedup' | 'all') => {
    // 每次强制从 IndexedDB 加载最新导入数据源（解决缓存过时 + localStorage 超限场景）
    let olList: OrderLabelRecord[] = [];
    try {
      const ds = await loadDataset(_olKey(owner));
      if (ds?.json) {
        try {
          const list = JSON.parse(ds.json) as OrderLabelRecord[];
          if (list.length > 0) { _olCache = { owner, list }; olList = list; }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    if (!olList.length) olList = readOLSync(owner);
    if (type === 'compare') {
      setOlRecords(olList);
      message.success(`比对结果已刷新（共加载 ${olList.length} 条导入数据）`);
      return;
    }
    if (type === 'urgentDedup') {
      setUrgentTick(t => t + 1);
      message.success('急采筛重已刷新');
      return;
    }
    const keys = selectAllFiltered ? filtered.map(r => r.key) : selectedRowKeys;
    if (keys.length === 0) { message.warning('请先勾选要更新的记录'); return; }
    // 从 localStorage 重新读取最新工价和分组数据，避免跨标签页状态陈旧
    const latestWages: StockWageRate[] = safeJson<StockWageRate[]>(sk.wage, []);
    const latestGroups: PackGroup[] = safeJson<PackGroup[]>(sk.group, []);
    const freshRateMap: Record<string, number> = {};
    const freshPackRateMap: Record<string, number> = {};
    const freshTeamRateMap: Record<string, number> = {};
    latestWages.forEach(w => { freshRateMap[w.material] = w.rate; if (w.packRate) freshPackRateMap[w.material] = w.packRate; if (w.teamRate) freshTeamRateMap[w.material] = w.teamRate; });
    const freshGroupMap: Record<string, PackGroup> = {};
    latestGroups.forEach(g => { if (g.inspector) freshGroupMap[g.inspector] = g; });
    // 读取标签统计数据（用于更新材质/货号）
    const labelMap: Record<string, OrderLabelRecord> = {};
    if (type === 'material' || type === 'all') {
      olList.forEach(r => { if (r.orderNo) labelMap[r.orderNo] = r; });
    }
    // 同步到组件状态，确保后续渲染也使用最新数据
    setWageRates(latestWages);
    setPackGroups(latestGroups);
    let count = 0;
    const updated = records.map(r => {
      if (!keys.includes(r.key)) return r;
      if (type === 'all') {
        const g = freshGroupMap[r.qcInspector];
        let nr = { ...r };
        if (g) { nr.packer = g.packer || nr.packer; nr.foreignTeam = g.foreignTeam || nr.foreignTeam; }
        const lr = labelMap[r.orderNo];
        if (lr) { nr.material = lr.material || nr.material; nr.productCode = lr.styleNo || nr.productCode; }
        const mat = nr.material;
        const qty = nr.quantity || 0;
        const rate = freshRateMap[mat] || 0;
        nr.priceRate = rate; nr.qcWage = qty * rate; nr.packWage = qty * (freshPackRateMap[mat] || 0); nr.commission = qty * (freshTeamRateMap[mat] || 0);
        return nr;
      }
      if (type === 'wages') {
        const qty = r.quantity || 0;
        const rate = freshRateMap[r.material] || 0;
        return { ...r, priceRate: rate, qcWage: qty * rate, packWage: qty * (freshPackRateMap[r.material] || 0), commission: qty * (freshTeamRateMap[r.material] || 0) };
      }
      if (type === 'material') {
        const lr = labelMap[r.orderNo];
        if (!lr) return r;
        count++;
        return { ...r, material: lr.material || r.material, productCode: lr.styleNo || r.productCode };
      }
      const g = freshGroupMap[r.qcInspector];
      if (!g) return r;
      count++;
      if (type === 'packer') return { ...r, packer: g.packer || r.packer };
      return { ...r, foreignTeam: g.foreignTeam || r.foreignTeam };
    });
    if (type === 'wages' || type === 'all') count = keys.length;
    save(updated);
    setSelectedRowKeys([]);
    setSelectAllFiltered(false);
    if (type === 'all') { setOlRecords(olList); setUrgentTick(t => t + 1); message.success(`已全部更新 ${count} 条记录（打包员、外贸组长、工价、材质、比对结果、急采筛重）`); return; }
    const labels: Record<string, string> = { packer: '打包员', foreignTeam: '外贸组长', wages: '工价', material: '材质' };
    message.success(`已更新 ${count} 条记录的${labels[type]}`);
  };

  const updateMenuItems = [
    { key: 'packer', label: <Tooltip title="根据质检员从「分组」中查找对应的打包员并回填" placement="right"><span>更新打包员</span></Tooltip> },
    { key: 'foreignTeam', label: <Tooltip title="根据质检员从「分组」中查找对应的外贸组长并回填" placement="right"><span>更新外贸组长</span></Tooltip> },
    { key: 'wages', label: <Tooltip title="根据材质从「工价管理」中查找工价并计算质检工资、打包工资、外贸组长工资" placement="right"><span>更新工价</span></Tooltip> },
    { key: 'material', label: <Tooltip title="根据内部单号从「导入数据源」中匹配材质和货号并回填" placement="right"><span>更新材质</span></Tooltip> },
    { key: 'compare', label: <Tooltip title="从「导入数据源」重新加载数据并刷新比对结果列，无需勾选记录" placement="right"><span>更新比对结果</span></Tooltip> },
    { key: 'urgentDedup', label: <Tooltip title="重新比对备货单是否出现在急采统计中，刷新急采单列，无需勾选记录" placement="right"><span>急采筛重</span></Tooltip> },
    { key: 'all', label: <Tooltip title="依次执行以上全部更新：打包员、外贸组长、材质、工价、比对结果、急采筛重" placement="right"><span>全部更新</span></Tooltip> },
  ];

  const save = (list: StockRecord[]) => { setRecords(list); writeJson(sk.stock, list); };
  const reload = () => { setRecords(safeJson<StockRecord[]>(sk.stock, [])); setWageRates(safeJson<StockWageRate[]>(sk.wage, [])); setPackGroups(safeJson<PackGroup[]>(sk.group, [])); };
  useEffect(() => { reload(); }, [owner]);
  useEffect(() => { const fn = () => reload(); window.addEventListener('storage', fn); return () => window.removeEventListener('storage', fn); }, [sk.stock]);
  // 挂载时异步加载导入数据源 + 监听变更事件
  useEffect(() => {
    const refresh = () => setOlRecords(readOLSync(owner));
    refresh();
    loadDataset(_olKey(owner)).then(ds => {
      if (ds?.json) {
        try {
          const list = JSON.parse(ds.json) as OrderLabelRecord[];
          if (list.length > 0) { _olCache = { owner, list }; setOlRecords(list); }
        } catch { /* ignore */ }
      }
    });
    window.addEventListener('ol-changed', refresh);
    return () => window.removeEventListener('ol-changed', refresh);
  }, [owner]);

  const rateMap = useMemo(() => { const m: Record<string, number> = {}; wageRates.forEach(w => { m[w.material] = w.rate; }); return m; }, [wageRates]);
  const packRateMap = useMemo(() => { const m: Record<string, number> = {}; wageRates.forEach(w => { if (w.packRate) m[w.material] = w.packRate; }); return m; }, [wageRates]);
  const teamRateMap = useMemo(() => { const m: Record<string, number> = {}; wageRates.forEach(w => { if (w.teamRate) m[w.material] = w.teamRate; }); return m; }, [wageRates]);
  const inspectors = useMemo(() => {
    const s = new Set<string>();
    packGroups.forEach(g => { if (g.inspector) s.add(g.inspector); });
    records.forEach(r => { if (r.qcInspector) s.add(r.qcInspector); });
    const cur = getDisplayName();
    if (cur && cur !== '未知') s.add(cur);
    return Array.from(s);
  }, [packGroups, records]);
  const packers = useMemo(() => Array.from(new Set(packGroups.map(g => g.packer).filter(Boolean))), [packGroups]);
  const materials = useMemo(() => {
    const s = new Set<string>();
    wageRates.forEach(w => { if (w.material) s.add(w.material); });
    records.forEach(r => { if (r.material) s.add(r.material); });
    return Array.from(s);
  }, [wageRates, records]);

  const handleQuery = () => {
    reloadAfterPull(reload); // 查询时自动刷新表单数据（本地+服务端拉取）
    setAppliedSearch(search.trim());
    setAppliedDateRange(dateRange);
    setAppliedFMonth(fMonth);
    setAppliedFInspector(fInspector);
    setAppliedFMaterial(fMaterial);
    setAppliedFCompare(fCompare);
    setAppliedFUrgent(fUrgent);
  };

  const months = useMemo(() => Array.from(new Set(records.map(r => r.month).filter(Boolean))).sort().reverse(), [records]);

  // 比对数据：导入数据源数量 vs 备货单数量总和
  const labelQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    olRecords.forEach(l => { if (l.orderNo) map[l.orderNo] = (map[l.orderNo] || 0) + (l.quantity || 0); });
    return map;
  }, [olRecords]);
  const stockQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    records.forEach(r => { if (r.orderNo) map[r.orderNo] = (map[r.orderNo] || 0) + (r.quantity || 0); });
    return map;
  }, [records]);
  const compareRecords = useMemo(() => compareOrderNo ? records.filter(r => r.orderNo === compareOrderNo) : [], [records, compareOrderNo]);
  const urgentOrderSet = useMemo(() => {
    const urgentRecs: { orderNo?: string }[] = safeJson<{ orderNo?: string }[]>(sk.urgent, []);
    const set = new Set<string>();
    urgentRecs.forEach(r => { if (r.orderNo) set.add(r.orderNo); });
    return set;
  }, [urgentTick]);

  // 负责人权限判定
  const canViewAll = useMemo(() => {
    if (isAdmin) return true;
    if (viewManagers.length === 0 && editManagers.length === 0) return true;
    return viewManagers.includes(curUsername) || editManagers.includes(curUsername);
  }, [viewManagers, editManagers]);
  const canEditAll = useMemo(() => {
    if (isAdmin) return true;
    return editManagers.includes(curUsername);
  }, [editManagers]);
  const myDisplayName = useMemo(() => getDisplayName(), []);

  const filtered = useMemo(() => records.filter(r => {
    // 负责人过滤：非负责人只能看自己创建的记录
    if (!canViewAll && r.creator !== myDisplayName) return false;
    // 快捷时间范围过滤
    if (quickRange) {
      const [start, end] = getQuickRange(quickRange);
      if (r.date < start || r.date > end) return false;
    }
    if (appliedFMonth && r.month !== appliedFMonth) return false;
    if (appliedFInspector && r.qcInspector !== appliedFInspector) return false;
    if (appliedFMaterial && r.material !== appliedFMaterial) return false;
    if (appliedDateRange) {
      const [start, end] = appliedDateRange;
      if (r.date < start || r.date > end) return false;
    }
    if (appliedSearch) {
      const kw = appliedSearch.toLowerCase();
      const hay = [r.orderNo, r.productCode, r.qcInspector, r.material, r.remark, r.packer, r.person, r.foreignTeam].join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (appliedFCompare) {
      const stockQty = stockQtyMap[r.orderNo] || 0;
      const labelQty = labelQtyMap[r.orderNo];
      let status = '';
      if (!r.orderNo) status = '';
      else if (labelQty === undefined) status = '无源';
      else if (stockQty > labelQty) status = '超记';
      else if (stockQty === labelQty) status = '一致';
      else status = '少于';
      if (status !== appliedFCompare) return false;
    }
    if (appliedFUrgent) {
      const isUrgent = r.orderNo && urgentOrderSet.has(r.orderNo) ? '是' : '否';
      if (isUrgent !== appliedFUrgent) return false;
    }
    return true;
  }), [records, appliedSearch, appliedFMonth, appliedFInspector, appliedFMaterial, appliedDateRange, appliedFCompare, appliedFUrgent, stockQtyMap, labelQtyMap, urgentOrderSet, canViewAll, myDisplayName, quickRange]);

  const stats = useMemo(() => ({
    total: filtered.length,
    totalQty: filtered.reduce((s, r) => s + (r.quantity || 0), 0),
    totalQcWage: filtered.reduce((s, r) => s + (r.qcWage || 0), 0),
    totalPackWage: filtered.reduce((s, r) => s + (r.packWage || 0), 0),
    totalCommission: filtered.reduce((s, r) => s + (r.commission || 0), 0),
  }), [filtered]);

  const openAdd = () => {
    const rec = emptyStock();
    const firstGroup = packGroups[0];
    setEditing(null);
    form.setFieldsValue({
      orderNo: rec.orderNo, productCode: rec.productCode, quantity: rec.quantity, material: rec.material, image: rec.image,
      qcInspector: getDisplayName(),
      packer: firstGroup?.packer || '', foreignTeam: firstGroup?.foreignTeam || '',
    });
    setWagePreview(null);
    setVisible(true);
  };
  const openEdit = (r: StockRecord) => {
    setEditing(r);
    form.setFieldsValue({ orderNo: r.orderNo, productCode: r.productCode, quantity: r.quantity, material: r.material, image: r.image || '', qcInspector: r.qcInspector || '', packer: r.packer || '', foreignTeam: r.foreignTeam || '' });
    // 编辑时自动显示当前材质的工价预览
    if (r.material) {
      handleMaterialChange(r.material);
    } else {
      setWagePreview(null);
    }
    setVisible(true);
  };
  const handleSave = () => {
    form.validateFields().then(v => {
      const dateVal = todayIso();
      const month = dateVal.slice(0, 7);
      const rate = rateMap[v.material] || 0;
      const qty = Number(v.quantity) || 0;
      const qcWage = qty * rate;
      const packWage = qty * (packRateMap[v.material] || 0);
      const commission = qty * (teamRateMap[v.material] || 0);
      const rec: StockRecord = {
        ...(editing || emptyStock()), ...v,
        key: editing?.key || genKey('WS'), date: dateVal, month,
        priceRate: rate, qcWage, packWage, commission, quantity: qty,
        lastEditor: getDisplayName(), lastEditTime: new Date().toISOString(),
      };
      const list = editing ? records.map(x => x.key === editing.key ? rec : x) : [rec, ...records];
      save(list);
      setVisible(false);
      message.success(editing ? '已更新' : '已新增');
    }).catch(() => {});
  };
  const handleDelete = (r: StockRecord) => save(records.filter(x => x.key !== r.key));

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const added: StockRecord[] = rows.map(r => ({
          ...emptyStock(),
          month: String(r['月份'] || ''), date: String(r['日期'] || todayIso()),
          orderNo: String(r['内部单号'] || ''), productCode: String(r['货号'] || ''),
          quantity: Number(r['数量']) || 0, qcInspector: String(r['质检员'] || ''),
          material: String(r['材质'] || ''), remark: String(r['备注'] || ''),
          creator: String(r['创建人'] || getDisplayName()),
          priceRate: Number(r['工价']) || 0, qcWage: Number(r['质检计件工资']) || 0,
          packer: String(r['打包员'] || ''), packWage: Number(r['打包工资']) || 0,
          commission: Number(r['邓智轩提成']) || 0, person: String(r['人员'] || ''),
          foreignTeam: String(r['外贸组长'] || ''),
        }));
        save([...added, ...records]);
        message.success(`已导入 ${added.length} 条`);
      } catch { message.error('导入失败，请检查文件格式'); }
    };
    reader.readAsArrayBuffer(file);
    return false;
  };
  const handleExport = () => {
    const rows = filtered.map(r => ({
      '月份': r.month, '日期': r.date, '内部单号': r.orderNo, '货号': r.productCode,
      '数量': r.quantity, '质检员': r.qcInspector, '材质': r.material, '备注': r.remark,
      '创建人': r.creator, '工价': r.priceRate, '质检计件工资': r.qcWage,
      '打包员': r.packer, '打包工资': r.packWage, '外贸组长工资': r.commission,
      '人员': r.person, '外贸组长': r.foreignTeam,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '备货单统计');
    XLSX.writeFile(wb, `备货单统计_${todayIso()}.xlsx`);
    message.success('已导出');
  };

  const columns: ColumnsType<StockRecord> = [
    { title: '月份', dataIndex: 'month', key: 'month', width: 90, align: 'center', render: v => v ? <Tag>{v}</Tag> : '—' },
    { title: '日期', dataIndex: 'date', key: 'date', width: 110, align: 'center', render: v => v || '—' },
    { title: '内部单号', dataIndex: 'orderNo', key: 'orderNo', width: 150, ellipsis: true, render: v => v ? <span style={{ fontWeight: 500, color: '#1e4a7e' }}>{v}</span> : '—' },
    { title: '货号', dataIndex: 'productCode', key: 'productCode', width: 120, ellipsis: true },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 70, align: 'center', render: v => <span style={{ fontWeight: 600 }}>{v || 0}</span> },
    { title: '质检员', dataIndex: 'qcInspector', key: 'qcInspector', width: 90, align: 'center', render: v => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '材质', dataIndex: 'material', key: 'material', width: 90, align: 'center', render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
    { title: '图片', dataIndex: 'image', key: 'image', width: 60, align: 'center', render: v => v ? <AntdImage src={v} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—' },
    { title: '工价', dataIndex: 'priceRate', key: 'priceRate', width: 70, align: 'right', render: v => v ? `¥${v}` : '—' },
    { title: '质检工资', dataIndex: 'qcWage', key: 'qcWage', width: 100, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#52c41a' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '打包员', dataIndex: 'packer', key: 'packer', width: 90, align: 'center', render: v => v ? <Tag color="purple">{v}</Tag> : '—' },
    { title: <Tooltip title="= 对应材质在工价管理中设置的打包员工价 × 数量">打包工资 <QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip>, dataIndex: 'packWage', key: 'packWage', width: 110, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#722ed1' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: <Tooltip title="= 对应材质在工价管理中设置的外贸组长工价 × 数量">外贸组长工资 <QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip>, dataIndex: 'commission', key: 'commission', width: 130, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#fa8c16' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '人员', dataIndex: 'person', key: 'person', width: 80, align: 'center', render: v => v || '—' },
    { title: '外贸组长', dataIndex: 'foreignTeam', key: 'foreignTeam', width: 100, align: 'center', render: v => v || '—' },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 120, ellipsis: true },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 80, align: 'center', render: v => v || '—' },
    {
      title: <Tooltip title="将备货单与导入数据源按内部单号比对数量：超记=备货数量多于数据源，一致=数量相等，少于=备货少于数据源，无源=数据源中无此单号">比对结果 <QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip>, key: 'compare', width: 90, align: 'center',
      render: (_v, r) => {
        if (!r.orderNo) return '—';
        const stockQty = stockQtyMap[r.orderNo] || 0;
        const labelQty = labelQtyMap[r.orderNo];
        if (labelQty === undefined) return <span style={{ color: '#8c8c8c' }}>无源</span>;
        if (stockQty > labelQty) return <a onClick={() => setCompareOrderNo(r.orderNo)} style={{ color: '#f5222d', fontWeight: 600 }}>超记</a>;
        if (stockQty === labelQty) return <span style={{ color: '#52c41a' }}>一致</span>;
        return <span style={{ color: '#fa8c16' }}>少于</span>;
      },
    },
    {
      title: <Tooltip title="该备货单的内部单号是否同时出现在急采统计中，是=属于急采单，否=不属于急采">急采单 <QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip>, key: 'isUrgent', width: 70, align: 'center',
      render: (_v, r) => {
        if (!r.orderNo) return '';
        return urgentOrderSet.has(r.orderNo)
          ? <span style={{ color: '#f5222d', fontWeight: 600 }}>是</span>
          : <span style={{ color: '#bfbfbf' }}>否</span>;
      },
    },
    {
      title: '操作', key: 'action', width: 100, align: 'center', fixed: 'right',
      render: (_v, r) => {
        const canModify = canEditAll || r.creator === myDisplayName;
        return (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} disabled={!canModify} onClick={() => openEdit(r)} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canModify} />
          </Popconfirm>
        </Space>
        );
      },
    },
  ];

  /* ---- 字段显示控制 ---- */
  const stockFieldItems: FieldConfigItem[] = useMemo(() => [
    { key: 'month', label: '月份' }, { key: 'date', label: '日期' }, { key: 'orderNo', label: '内部单号' },
    { key: 'productCode', label: '货号' }, { key: 'quantity', label: '数量' }, { key: 'qcInspector', label: '质检员' },
    { key: 'material', label: '材质' }, { key: 'image', label: '图片' }, { key: 'priceRate', label: '工价' },
    { key: 'qcWage', label: '质检工资' }, { key: 'packer', label: '打包员' }, { key: 'packWage', label: '打包工资' },
    { key: 'commission', label: '外贸组长工资' }, { key: 'person', label: '人员' }, { key: 'foreignTeam', label: '外贸组长' },
    { key: 'remark', label: '备注' }, { key: 'creator', label: '创建人' }, { key: 'compare', label: '比对结果' }, { key: 'isUrgent', label: '急采单' },
  ], []);
  const visibleColumns = useMemo(() => {
    const order = fieldOrder.length > 0 ? fieldOrder : stockFieldItems.map(f => f.key);
    const colMap: Record<string, any> = {};
    columns.forEach(c => { const k = String(c.key ?? ''); if (k) colMap[k] = c; });
    const actionCol = colMap['action'];
    const ordered = [
      ...order.filter(k => k !== 'action' && colMap[k] && fieldVis[k] !== false),
      ...columns.filter(c => { const k = String(c.key ?? ''); return k && !order.includes(k) && k !== 'action' && fieldVis[k] !== false; }).map(c => String(c.key ?? '')),
    ];
    const result = ordered.map(k => colMap[k]).filter(Boolean);
    if (actionCol) result.push(actionCol);
    return result as ColumnsType<StockRecord>;
  }, [columns, fieldOrder, fieldVis, stockFieldItems]);

  return (
    <ConfigProvider theme={{
      token: { borderRadius: 0 },
      components: {
        Button: { borderRadius: 0 },
        Input: { borderRadius: 0 },
        Select: { borderRadius: 0 },
        InputNumber: { borderRadius: 0 },
        DatePicker: { borderRadius: 0 },
        Card: { borderRadiusLG: 0 },
        Table: { borderRadius: 0 },
        Modal: { borderRadiusLG: 0 },
        Tag: { borderRadiusSM: 0 },
        Pagination: { borderRadius: 0 },
      },
    }}>
    <div className="stock-tab-rect" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <style>{`
        .stock-tab-rect .ant-card, .stock-tab-rect .ant-btn, .stock-tab-rect .ant-input,
        .stock-tab-rect .ant-select-selector, .stock-tab-rect .ant-input-number,
        .stock-tab-rect .ant-picker, .stock-tab-rect .ant-tag, .stock-tab-rect .ant-pagination-item,
        .stock-tab-rect .ant-pagination-prev .ant-pagination-item-link,
        .stock-tab-rect .ant-pagination-next .ant-pagination-item-link,
        .stock-tab-rect .ant-table, .stock-tab-rect .ant-table-thead > tr > th,
        .stock-tab-rect .ant-table-tbody > tr > td,
        .stock-tab-rect .ant-card-body > div > div {
          border-radius: 0 !important;
        }
      `}</style>
      <Row gutter={12} style={{ marginBottom: 8, flexShrink: 0 }}>
        <Col flex="1"><StatCard title="记录数" value={stats.total} suffix="条" color="#1e4a7e" icon={<AppstoreOutlined />} /></Col>
        <Col flex="1"><StatCard title="总数量" value={stats.totalQty} suffix="双" color="#1890ff" icon={<BarChartOutlined />} /></Col>
        <Col flex="1"><StatCard title="质检工资合计" value={stats.totalQcWage} color="#52c41a" icon={<DollarOutlined />} precision={2} /></Col>
        <Col flex="1"><StatCard title="打包工资合计" value={stats.totalPackWage} color="#722ed1" icon={<DollarOutlined />} precision={2} /></Col>
        <Col flex="1"><StatCard title="外贸组长工资合计" value={stats.totalCommission} color="#fa8c16" icon={<DollarOutlined />} precision={2} /></Col>
      </Row>
      <QuickRangeBar />
      <Space wrap style={{ marginBottom: 12, flexShrink: 0 }}>
        <Tooltip title="输入关键字搜索，支持内部单号、货号、质检员、打包员等字段模糊匹配，回车或点击查询生效">
          <Input placeholder="搜索单号/货号/人员" prefix={<SearchOutlined />} style={{ width: 220 }} value={search}
            onChange={e => setSearch(e.target.value)}
            onPressEnter={handleQuery}
            allowClear />
        </Tooltip>
        <Tooltip title="按创建日期范围筛选记录，选好后点击查询生效">
          <DatePicker.RangePicker
          value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
          onChange={vals => {
            if (vals && vals[0] && vals[1]) {
              setDateRange([vals[0].format('YYYY-MM-DD'), vals[1].format('YYYY-MM-DD')]);
            } else {
              setDateRange(null);
            }
          }}
          style={{ width: 240 }}
          placeholder={['开始日期', '结束日期']}
        />
        </Tooltip>
        <Tooltip title="按月份筛选，格式为YYYY-MM，点击查询生效">
          <Select placeholder="月份" style={{ width: 130 }} value={fMonth || undefined} onChange={v => setFMonth(v || '')} allowClear options={months.map(m => ({ value: m, label: m }))} />
        </Tooltip>
        <Tooltip title="按质检员筛选，质检员在新增记录时指定">
          <Select placeholder="质检员" style={{ width: 120 }} value={fInspector || undefined} onChange={v => setFInspector(v || '')} allowClear options={inspectors.map(x => ({ value: x, label: x }))} />
        </Tooltip>
        <Tooltip title="按材质筛选，材质可通过「更新信息→更新材质」从导入数据源自动匹配">
          <Select placeholder="材质" style={{ width: 120 }} value={fMaterial || undefined} onChange={v => setFMaterial(v || '')} allowClear options={materials.map(x => ({ value: x, label: x }))} />
        </Tooltip>
        <Tooltip title="比对备货单与导入数据源的数量差异：超记=备货多于数据源，一致=数量相等，少于=备货少于数据源，无源=数据源中无此单号">
          <Select placeholder="比对结果" style={{ width: 110 }} value={fCompare || undefined} onChange={v => setFCompare(v || '')} allowClear options={[{ value: '超记', label: '超记' }, { value: '一致', label: '一致' }, { value: '少于', label: '少于' }, { value: '无源', label: '无源' }]} />
        </Tooltip>
        <Tooltip title="筛选是否出现在急采统计中的记录，可快速找出哪些备货单属于急采">
          <Select placeholder="急采单" style={{ width: 100 }} value={fUrgent || undefined} onChange={v => setFUrgent(v || '')} allowClear options={[{ value: '是', label: '是' }, { value: '否', label: '否' }]} />
        </Tooltip>
        <Tooltip title="应用上方所有筛选条件，也可在搜索框内按回车">
          <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>查询</Button>
        </Tooltip>
        <Tooltip title="手动新增一条备货单记录，需填写单号、数量、质检员等必填字段">
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增记录</Button>
        </Tooltip>
        <Tooltip title="从Excel文件批量导入备货单，Excel需包含列：单号、数量、质检员、月份等">
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImport}><Button icon={<UploadOutlined />}>导入Excel</Button></Upload>
        </Tooltip>
        <Tooltip title="将当前筛选后的所有记录导出为Excel文件">
          <Button icon={<FileExcelOutlined />} onClick={handleExport}>导出Excel</Button>
        </Tooltip>
        <Tooltip title="批量更新勾选记录的信息：打包员和外贸组长来自「分组」设置，工价来自「工价管理」按材质计算，材质和比对结果来自「导入数据源」">
          <Dropdown menu={{ items: updateMenuItems, onClick: ({ key }) => handleBatchUpdate(key as 'packer' | 'foreignTeam' | 'wages' | 'material' | 'compare' | 'urgentDedup' | 'all') }}>
            <Button icon={<SyncOutlined />}>更新信息{(selectAllFiltered ? filtered.length : selectedRowKeys.length) > 0 ? `(${selectAllFiltered ? filtered.length : selectedRowKeys.length})` : ''}</Button>
          </Dropdown>
        </Tooltip>
        <Tooltip title="重新读取本地存储中的最新数据，当其他页面修改了数据后点击此处同步">
          <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        </Tooltip>
        <Tooltip title="自定义表格中显示或隐藏的列，以及调整列的排列顺序">
          <Button icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示设置</Button>
        </Tooltip>
      </Space>
      <div style={{ marginBottom: 4, fontSize: 12, color: '#1890ff', flexShrink: 0 }}>
        {selectAllFiltered ? (
          <span>已全选全部 <b>{filtered.length}</b> 条筛选记录 <a onClick={() => { setSelectedRowKeys([]); setSelectAllFiltered(false); }}>取消选择</a></span>
        ) : (
          selectedRowKeys.length > 0 && selectedRowKeys.length < filtered.length && (
            <span>已选 {selectedRowKeys.length} 条 <a onClick={() => setSelectAllFiltered(true)}>全选全部 {filtered.length} 条筛选记录</a></span>
          )
        )}
      </div>
      <div ref={stockTableRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Table rowKey="key" size="small" bordered columns={wrapStockCols(visibleColumns)} dataSource={filtered}
        rowSelection={{
          selectedRowKeys: selectAllFiltered ? filtered.map(r => r.key) : selectedRowKeys,
          onChange: keys => { setSelectedRowKeys(keys); setSelectAllFiltered(false); },
        }}
        scroll={{ x: 1800, y: stockScrollY }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'], showTotal: t => `共 ${t} 条` }}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      />
      </div>
      <Modal title={editing ? '编辑备货记录' : '新增备货记录'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={600} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={6}><Form.Item name="orderNo" label="单号" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 ST2025001" /></Form.Item></Col>
            <Col span={6}><Form.Item name="productCode" label="货号"><Input placeholder="如 9001" /></Form.Item></Col>
            <Col span={6}><Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="qcInspector" label="质检员"><Select showSearch allowClear options={inspectors.map(x => ({ value: x, label: x }))} placeholder="选择质检员" /></Form.Item></Col>
            <Col span={6}><Form.Item name="material" label="材质" rules={[{ required: true, message: '必填' }]}><Select showSearch allowClear options={materials.map(x => ({ value: x, label: x }))} placeholder="选择材质" onChange={handleMaterialChange} /></Form.Item></Col>
          </Row>
          {wagePreview && (
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#52c41a' }}>
              <span>工价预览：质检 <b>¥{wagePreview.rate}</b> / 打包 <b>¥{wagePreview.packRate}</b> / 外贸组长 <b>¥{wagePreview.teamRate}</b></span>
            </div>
          )}
          <Form.Item name="packer" hidden><Input /></Form.Item>
          <Form.Item name="foreignTeam" hidden><Input /></Form.Item>
          <Form.Item name="image" label="图片"><ImageSlot size={120} tip="上传图片" /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`比对详情 - ${compareOrderNo || ''}`} open={!!compareOrderNo} onCancel={() => setCompareOrderNo(null)} footer={null} width={860}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>导入数据源数量：</span>
          <span style={{ color: '#1890ff', fontWeight: 700, fontSize: 16 }}>{labelQtyMap[compareOrderNo || ''] ?? '无数据'}</span>
          <span style={{ marginLeft: 24, fontWeight: 600 }}>备货单数量合计：</span>
          <span style={{ color: '#f5222d', fontWeight: 700, fontSize: 16 }}>{stockQtyMap[compareOrderNo || ''] || 0}</span>
        </div>
        <Table rowKey="key" size="small" bordered dataSource={compareRecords}
          columns={[
            { title: '月份', dataIndex: 'month', key: 'month', width: 70, align: 'center', render: v => v ? <Tag>{v}</Tag> : '—' },
            { title: '日期', dataIndex: 'date', key: 'date', width: 100, align: 'center' },
            { title: '货号', dataIndex: 'productCode', key: 'productCode', width: 100, ellipsis: true },
            { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 60, align: 'center', render: v => <span style={{ fontWeight: 600 }}>{v || 0}</span> },
            { title: '质检员', dataIndex: 'qcInspector', key: 'qcInspector', width: 70, align: 'center', render: v => v ? <Tag color="blue">{v}</Tag> : '—' },
            { title: '材质', dataIndex: 'material', key: 'material', width: 70, align: 'center', render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
            { title: '图片', dataIndex: 'image', key: 'image', width: 50, align: 'center', render: v => v ? <AntdImage src={v} width={32} height={32} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '—' },
            { title: '创建人', dataIndex: 'creator', key: 'creator', width: 70, align: 'center', render: v => v || '—' },
            {
              title: '操作', key: 'action', width: 80, align: 'center',
              render: (_v, r) => (
                <Space size={0}>
                  <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                  <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消">
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          pagination={false}
          summary={() => {
            const total = compareRecords.reduce((s, r) => s + (r.quantity || 0), 0);
            return <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={3}><b>合计</b></Table.Summary.Cell><Table.Summary.Cell index={3}><span style={{ fontWeight: 700, fontSize: 14, color: '#f5222d' }}>{total}</span></Table.Summary.Cell><Table.Summary.Cell index={4} /><Table.Summary.Cell index={5} /><Table.Summary.Cell index={6} /><Table.Summary.Cell index={7} /><Table.Summary.Cell index={8} /></Table.Summary.Row>;
          }}
        />
      </Modal>
      <FieldConfigModal
        open={fieldCfgVisible}
        fields={stockFieldItems}
        order={fieldOrder}
        visibility={fieldVis}
        onSave={(order, vis) => {
          setFieldOrder(order); setFieldVis(vis);
          try { localStorage.setItem(`ws_stockFieldOrder_${owner}`, JSON.stringify(order)); } catch { /* ignore */ }
          try { localStorage.setItem(`ws_stockFieldVis_${owner}`, JSON.stringify(vis)); } catch { /* ignore */ }
          setFieldCfgVisible(false);
        }}
        onCancel={() => setFieldCfgVisible(false)}
      />
    </div>
    </ConfigProvider>
  );
};

// ============ 配货统计 ============
const emptyPick = (): PickRecord => ({ key: genKey('PK'), orderNo: '', quantity: 0, wage: 0, image: '', createdAt: todayIso(), creator: getDisplayName(), month: dayjs().format('YYYY-MM'), material: '', priceRate: 0, picker: getDisplayName() });
const PickTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapPickCols } = useResizableColumns<any>(`colWidths_ws_pick_${owner}`);
  const { viewManagers, editManagers, quickRange } = useWarehouseCtx();
  const [records, setRecords] = useState<PickRecord[]>(() => safeJson<PickRecord[]>(sk.pick, []));
  const [search, setSearch] = useState(''); const [fMonth, setFMonth] = useState('');
  const [visible, setVisible] = useState(false); const [editing, setEditing] = useState<PickRecord | null>(null); const [form] = Form.useForm();
  // 动态表格高度（视口锚定）
  const pickTableRef = React.useRef<HTMLDivElement>(null);
  const [pickScrollY, setPickScrollY] = useState(400);
  useEffect(() => {
    const calc = () => {
      if (!pickTableRef.current) return;
      const header = pickTableRef.current.querySelector('.ant-table-thead') as HTMLElement;
      if (!header) return;
      const bodyTop = header.getBoundingClientRect().bottom;
      // 用 TabPane 容器实际高度而非 window.innerHeight（容器有 padding，innerHeight 偏大）
      const pane = pickTableRef.current.closest('.ant-tabs-tabpane') as HTMLElement;
      const bottom = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
      const available = Math.max(200, bottom - bodyTop - 52);
      setPickScrollY(available);
      const body = pickTableRef.current.querySelector('.ant-table-body') as HTMLElement;
      if (body) body.style.minHeight = `${available}px`;
    };
    const t1 = setTimeout(calc, 150);
    const t2 = setTimeout(calc, 500);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', calc); };
  }, []);
  const save = (l: PickRecord[]) => { setRecords(l); writeJson(sk.pick, l); };
  // 负责人权限判定
  const canViewAll = useMemo(() => { if (isAdmin) return true; if (viewManagers.length === 0 && editManagers.length === 0) return true; return viewManagers.includes(curUsername) || editManagers.includes(curUsername); }, [viewManagers, editManagers]);
  const canEditAll = useMemo(() => { if (isAdmin) return true; return editManagers.includes(curUsername); }, [editManagers]);
  const myDisplayName = useMemo(() => getDisplayName(), []);
  const filtered = useMemo(() => records.filter(r => {
    if (!canViewAll && r.creator !== myDisplayName) return false;
    if (quickRange) { const [start, end] = getQuickRange(quickRange); const d = r.createdAt || ''; if (d < start || d > end) return false; }
    if (fMonth && r.month !== fMonth) return false;
    if (search.trim() && ![r.orderNo, r.creator, r.picker].join(' ').toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  }), [records, search, fMonth, canViewAll, myDisplayName, quickRange]);
  const stats = useMemo(() => ({ total: filtered.length, qty: filtered.reduce((s, r) => s + r.quantity, 0), wage: filtered.reduce((s, r) => s + r.wage, 0) }), [filtered]);
  const months = useMemo(() => Array.from(new Set(records.map(r => r.month).filter(Boolean))).sort().reverse(), [records]);
  const openAdd = () => { setEditing(null); form.setFieldsValue({ ...emptyPick() }); setVisible(true); };
  const openEdit = (r: PickRecord) => { setEditing(r); form.setFieldsValue(r); setVisible(true); };
  const handleSave = () => { form.validateFields().then(v => { const qty = Number(v.quantity) || 0; const latestWages: PickWageRate[] = safeJson<PickWageRate[]>(sk.pickWage, []); const unifiedRate = latestWages[0]?.rate || 0; const rec: PickRecord = { ...(editing || emptyPick()), ...v, key: editing?.key || genKey('PK'), material: '', priceRate: unifiedRate, wage: qty * unifiedRate }; const list = editing ? records.map(x => x.key === editing.key ? rec : x) : [rec, ...records]; save(list); setVisible(false); message.success(editing ? '已更新' : '已新增'); }).catch(() => {}); };
  const handleImport = (file: File) => { const reader = new FileReader(); reader.onload = e => { try { const wb = XLSX.read(e.target?.result, { type: 'array' }); const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); const added: PickRecord[] = rows.map(r => ({ ...emptyPick(), orderNo: String(r['内部单号'] || ''), quantity: Number(r['数量']) || 0, wage: Number(r['计件工资']) || 0, creator: String(r['创建人'] || getDisplayName()), picker: String(r['配货员'] || r['创建人'] || getDisplayName()), month: String(r['月份'] || '') })); save([...added, ...records]); message.success(`已导入 ${added.length} 条`); } catch { message.error('导入失败'); } }; reader.readAsArrayBuffer(file); return false; };
  const handleExport = () => { const rows = filtered.map(r => ({ '内部单号': r.orderNo, '数量': r.quantity, '计件工资': r.wage, '创建时间': r.createdAt, '创建人': r.creator, '配货员': r.picker, '月份': r.month })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '配货统计'); XLSX.writeFile(wb, `配货统计_${todayIso()}.xlsx`); message.success('已导出'); };
  const cols: ColumnsType<PickRecord> = [
    { title: '月份', dataIndex: 'month', key: 'month', width: 90, align: 'center', render: v => v ? <Tag>{v}</Tag> : '—' },
    { title: '内部单号', dataIndex: 'orderNo', key: 'orderNo', width: 160, ellipsis: true, render: v => v ? <span style={{ fontWeight: 500, color: '#1e4a7e' }}>{v}</span> : '—' },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'center', render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: '工价', dataIndex: 'priceRate', key: 'priceRate', width: 70, align: 'right', render: v => v ? `¥${v}` : '—' },
    { title: '计件工资', dataIndex: 'wage', key: 'wage', width: 100, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#52c41a' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 120, align: 'center' },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, align: 'center' },
    { title: '配货员', dataIndex: 'picker', key: 'picker', width: 90, align: 'center', render: v => v || '—' },
    { title: '操作', key: 'action', width: 100, align: 'center', fixed: 'right', render: (_v, r) => { const canModify = canEditAll || r.creator === myDisplayName; return (<Space size={0}><Button type="link" size="small" icon={<EditOutlined />} disabled={!canModify} onClick={() => openEdit(r)} /><Popconfirm title="确定删除？" onConfirm={() => save(records.filter(x => x.key !== r.key))}><Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canModify} /></Popconfirm></Space>); } },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Row gutter={12} style={{ marginBottom: 8, flexShrink: 0 }}>
        <Col flex="1"><StatCard title="配货记录" value={stats.total} suffix="条" color="#1890ff" icon={<AppstoreOutlined />} /></Col>
        <Col flex="1"><StatCard title="总数量" value={stats.qty} suffix="双" color="#1e4a7e" icon={<BarChartOutlined />} /></Col>
        <Col flex="1"><StatCard title="工资合计" value={stats.wage} color="#52c41a" icon={<DollarOutlined />} precision={2} /></Col>
      </Row>
      <QuickRangeBar />
      <Space wrap style={{ marginBottom: 12, flexShrink: 0 }}>
        <Input placeholder="搜索单号/创建人" prefix={<SearchOutlined />} style={{ width: 200 }} value={search} onChange={e => setSearch(e.target.value)} allowClear />
        <Select placeholder="月份" style={{ width: 130 }} value={fMonth || undefined} onChange={v => setFMonth(v || '')} allowClear options={months.map(m => ({ value: m, label: m }))} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增</Button>
        <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImport}><Button icon={<UploadOutlined />}>导入</Button></Upload>
        <Button icon={<FileExcelOutlined />} onClick={handleExport}>导出</Button>
      </Space>
      <div ref={pickTableRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Table rowKey="key" size="small" bordered columns={wrapPickCols(cols)} dataSource={filtered} scroll={{ x: 800, y: pickScrollY }} pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'], showTotal: t => `共 ${t} 条` }} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} />
      </div>
      <Modal title={editing ? '编辑配货记录' : '新增配货记录'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" width={480} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}><Form.Item name="orderNo" label="内部单号" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="month" label="月份"><Input placeholder="YYYY-MM" /></Form.Item></Col>
            <Col span={8}><Form.Item name="picker" label="配货员"><Input /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

// ============ 急采统计 ============
const emptyUrgent = (): UrgentRecord => ({ key: genKey('UG'), isDuplicate: false, orderNo: '', inspectorId: '', quantity: 0, inspector: '', qcDate: todayIso(), material: '', priceRate: 0, wage: 0, lastEditTime: todayIso(), month: dayjs().format('YYYY-MM'), packWage: 0, packer: '', commission: 0, foreignTeam: '', productCode: '', remark: '', image: '', creator: getDisplayName(), date: todayIso(), lastEditor: '' });
const UrgentTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapUrgentCols } = useResizableColumns<any>(`colWidths_ws_urgent_${owner}`);
  const { viewManagers, editManagers, quickRange } = useWarehouseCtx();
  const [records, setRecords] = useState<UrgentRecord[]>(() => safeJson<UrgentRecord[]>(sk.urgent, []));
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [appliedDateRange, setAppliedDateRange] = useState<[string, string] | null>(null);
  const [fMonth, setFMonth] = useState('');
  const [appliedFMonth, setAppliedFMonth] = useState('');
  const [fInspector, setFInspector] = useState('');
  const [appliedFInspector, setAppliedFInspector] = useState('');
  const [fMaterial, setFMaterial] = useState('');
  const [appliedFMaterial, setAppliedFMaterial] = useState('');
  const [visible, setVisible] = useState(false); const [editing, setEditing] = useState<UrgentRecord | null>(null); const [form] = Form.useForm();
  const [wageRates, setWageRates] = useState<UrgentWageRate[]>(() => safeJson<UrgentWageRate[]>(sk.urgentWage, []));
  const [packGroups, setPackGroups] = useState<PackGroup[]>(() => safeJson<PackGroup[]>(sk.group, []));
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [defaultInspectorId, setDefaultInspectorId] = useState('');
  const [defaultInspector, setDefaultInspector] = useState('');
  const [defaultQuantity, setDefaultQuantity] = useState<number>(1);
  const [wagePreview, setWagePreview] = useState<{ rate: number; packRate: number; teamRate: number } | null>(null);
  // 动态表格高度（视口锚定）
  const urgentTableRef = React.useRef<HTMLDivElement>(null);
  const [urgentScrollY, setUrgentScrollY] = useState(400);
  useEffect(() => {
    const calc = () => {
      if (!urgentTableRef.current) return;
      const header = urgentTableRef.current.querySelector('.ant-table-thead') as HTMLElement;
      if (!header) return;
      const bodyTop = header.getBoundingClientRect().bottom;
      // 用 TabPane 容器实际高度而非 window.innerHeight（容器有 padding，innerHeight 偏大）
      const pane = urgentTableRef.current.closest('.ant-tabs-tabpane') as HTMLElement;
      const bottom = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
      const available = Math.max(200, bottom - bodyTop - 52);
      setUrgentScrollY(available);
      const body = urgentTableRef.current.querySelector('.ant-table-body') as HTMLElement;
      if (body) body.style.minHeight = `${available}px`;
    };
    const t1 = setTimeout(calc, 150);
    const t2 = setTimeout(calc, 500);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', calc); };
  }, []);

  // 材质变更时即时重读工价并更新预览
  const handleMaterialChange = (material: string) => {
    const latestWages: UrgentWageRate[] = safeJson<UrgentWageRate[]>(sk.urgentWage, []);
    setWageRates(latestWages);
    const rm: Record<string, number> = {}; const prm: Record<string, number> = {}; const trm: Record<string, number> = {};
    latestWages.forEach(w => { rm[w.material] = w.rate; if (w.packRate) prm[w.material] = w.packRate; if (w.teamRate) trm[w.material] = w.teamRate; });
    if (material) {
      setWagePreview({ rate: rm[material] || 0, packRate: prm[material] || 0, teamRate: trm[material] || 0 });
    } else {
      setWagePreview(null);
    }
  };

  const rateMap = useMemo(() => { const m: Record<string, number> = {}; wageRates.forEach(w => { m[w.material] = w.rate; }); return m; }, [wageRates]);
  const packRateMap = useMemo(() => { const m: Record<string, number> = {}; wageRates.forEach(w => { if (w.packRate) m[w.material] = w.packRate; }); return m; }, [wageRates]);
  const teamRateMap = useMemo(() => { const m: Record<string, number> = {}; wageRates.forEach(w => { if (w.teamRate) m[w.material] = w.teamRate; }); return m; }, [wageRates]);
  const groupMap = useMemo(() => { const m: Record<string, PackGroup> = {}; packGroups.forEach(g => { if (g.inspector) m[g.inspector] = g; }); return m; }, [packGroups]);
  const handleBatchUpdate = async (type: 'packer' | 'foreignTeam' | 'wages' | 'material' | 'compare' | 'urgentDedup' | 'all') => {
    // 每次强制从 IndexedDB 加载最新导入数据源
    let olList: OrderLabelRecord[] = [];
    try {
      const ds = await loadDataset(_olKey(owner));
      if (ds?.json) {
        try {
          const list = JSON.parse(ds.json) as OrderLabelRecord[];
          if (list.length > 0) { _olCache = { owner, list }; olList = list; }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    if (!olList.length) olList = readOLSync(owner);
    const keys = selectAllFiltered ? filtered.map(r => r.key) : selectedRowKeys;
    if (keys.length === 0) { message.warning('请先勾选要更新的记录'); return; }
    const latestWages: UrgentWageRate[] = safeJson<UrgentWageRate[]>(sk.urgentWage, []);
    const latestGroups: PackGroup[] = safeJson<PackGroup[]>(sk.group, []);
    const fRM: Record<string, number> = {}; const fPRM: Record<string, number> = {}; const fTRM: Record<string, number> = {};
    latestWages.forEach(w => { fRM[w.material] = w.rate; if (w.packRate) fPRM[w.material] = w.packRate; if (w.teamRate) fTRM[w.material] = w.teamRate; });
    const fGM: Record<string, PackGroup> = {};
    latestGroups.forEach(g => { if (g.inspector) fGM[g.inspector] = g; });
    // 读取标签统计数据（用于更新材质/款号）
    const labelMap: Record<string, OrderLabelRecord> = {};
    if (type === 'material' || type === 'all') {
      olList.forEach(r => { if (r.orderNo) labelMap[r.orderNo] = r; });
    }
    setWageRates(latestWages); setPackGroups(latestGroups);
    let count = 0;
    const updated = records.map(r => {
      if (!keys.includes(r.key)) return r;
      if (type === 'all') {
        let nr = { ...r };
        const g = fGM[r.inspector]; if (g) { nr.packer = g.packer || nr.packer; nr.foreignTeam = g.foreignTeam || nr.foreignTeam; }
        const lr = labelMap[r.orderNo]; if (lr) { nr.material = lr.material || nr.material; nr.productCode = lr.styleNo || nr.productCode; }
        const mat = nr.material;
        const qty = nr.quantity || 0; const rate = fRM[mat] || 0;
        nr.priceRate = rate; nr.wage = qty * rate; nr.packWage = qty * (fPRM[mat] || 0); nr.commission = qty * (fTRM[mat] || 0);
        return nr;
      }
      if (type === 'wages') {
        const qty = r.quantity || 0; const rate = fRM[r.material] || 0;
        return { ...r, priceRate: rate, wage: qty * rate, packWage: qty * (fPRM[r.material] || 0), commission: qty * (fTRM[r.material] || 0) };
      }
      if (type === 'material') {
        const lr = labelMap[r.orderNo];
        if (!lr) return r;
        count++;
        return { ...r, material: lr.material || r.material, productCode: lr.styleNo || r.productCode };
      }
      const g = fGM[r.inspector]; if (!g) return r; count++;
      if (type === 'packer') return { ...r, packer: g.packer || r.packer };
      return { ...r, foreignTeam: g.foreignTeam || r.foreignTeam };
    });
    if (type === 'wages') count = keys.length;
    save(updated); setSelectedRowKeys([]); setSelectAllFiltered(false);
    if (type === 'all') { message.success(`已全部更新 ${keys.length} 条记录（打包员、外贸组长、工价、材质）`); return; }
    const labels: Record<string, string> = { packer: '打包员', foreignTeam: '外贸组长', wages: '工价', material: '材质' };
    message.success(`已更新 ${count} 条记录的${labels[type]}`);
  };
  const updateMenuItems = [
    { key: 'packer', label: <Tooltip title="根据质检员从「分组」中查找对应的打包员并回填" placement="right"><span>更新打包员</span></Tooltip> },
    { key: 'foreignTeam', label: <Tooltip title="根据质检员从「分组」中查找对应的外贸组长并回填" placement="right"><span>更新外贸组长</span></Tooltip> },
    { key: 'wages', label: <Tooltip title="根据材质从「工价管理」中查找工价并计算质检工资、打包工资、外贸组长工资" placement="right"><span>更新工价</span></Tooltip> },
    { key: 'material', label: <Tooltip title="根据内部单号从「导入数据源」中匹配材质和货号并回填" placement="right"><span>更新材质</span></Tooltip> },
    { key: 'all', label: <Tooltip title="依次执行以上全部更新：打包员、外贸组长、材质、工价" placement="right"><span>全部更新</span></Tooltip> },
  ];
  const save = (l: UrgentRecord[]) => { setRecords(l); writeJson(sk.urgent, l); };
  const reload = () => { setRecords(safeJson<UrgentRecord[]>(sk.urgent, [])); setWageRates(safeJson<UrgentWageRate[]>(sk.urgentWage, [])); setPackGroups(safeJson<PackGroup[]>(sk.group, [])); };
  useEffect(() => { reload(); }, [owner]);
  useEffect(() => { const fn = () => reload(); window.addEventListener('storage', fn); return () => window.removeEventListener('storage', fn); }, [sk.urgent]);
  const inspectors = useMemo(() => {
    const s = new Set<string>();
    packGroups.forEach(g => { if (g.inspector) s.add(g.inspector); });
    records.forEach(r => { if (r.inspector) s.add(r.inspector); });
    const cur = getDisplayName(); if (cur && cur !== '未知') s.add(cur);
    return Array.from(s);
  }, [packGroups, records]);
  const materials = useMemo(() => {
    const s = new Set<string>();
    wageRates.forEach(w => { if (w.material) s.add(w.material); });
    records.forEach(r => { if (r.material) s.add(r.material); });
    return Array.from(s);
  }, [wageRates, records]);
  const handleQuery = () => { reloadAfterPull(reload); setAppliedSearch(search.trim()); setAppliedDateRange(dateRange); setAppliedFMonth(fMonth); setAppliedFInspector(fInspector); setAppliedFMaterial(fMaterial); };
  // 负责人权限判定
  const canViewAll = useMemo(() => { if (isAdmin) return true; if (viewManagers.length === 0 && editManagers.length === 0) return true; return viewManagers.includes(curUsername) || editManagers.includes(curUsername); }, [viewManagers, editManagers]);
  const canEditAll = useMemo(() => { if (isAdmin) return true; return editManagers.includes(curUsername); }, [editManagers]);
  const myDisplayName = useMemo(() => getDisplayName(), []);
  const filtered = useMemo(() => records.filter(r => {
    // 负责人过滤：非负责人只能看自己创建的记录
    if (!canViewAll && r.creator !== myDisplayName) return false;
    // 快捷时间范围过滤
    if (quickRange) { const [start, end] = getQuickRange(quickRange); const d = r.date || r.qcDate || ''; if (d < start || d > end) return false; }
    if (appliedFMonth && r.month !== appliedFMonth) return false;
    if (appliedFInspector && r.inspector !== appliedFInspector) return false;
    if (appliedFMaterial && r.material !== appliedFMaterial) return false;
    if (appliedDateRange) { const [start, end] = appliedDateRange; if (r.qcDate < start || r.qcDate > end) return false; }
    if (appliedSearch) { const kw = appliedSearch.toLowerCase(); const hay = [r.orderNo, r.productCode, r.inspector, r.material, r.remark, r.packer, r.foreignTeam].join(' ').toLowerCase(); if (!hay.includes(kw)) return false; }
    return true;
  }), [records, appliedSearch, appliedFMonth, appliedFInspector, appliedFMaterial, appliedDateRange, canViewAll, myDisplayName, quickRange]);
  const stats = useMemo(() => ({ total: filtered.length, qty: filtered.reduce((s, r) => s + r.quantity, 0), wage: filtered.reduce((s, r) => s + r.wage, 0), packWage: filtered.reduce((s, r) => s + r.packWage, 0), commission: filtered.reduce((s, r) => s + r.commission, 0) }), [filtered]);
  const months = useMemo(() => Array.from(new Set(records.map(r => r.month).filter(Boolean))).sort().reverse(), [records]);
  const handleScanCreate = () => {
    const orderNo = scanInput.trim();
    if (!orderNo) { message.warning('请扫码或输入内部单号'); return; }
    if (records.some(r => r.orderNo === orderNo)) {
      Modal.warning({ title: '重复提醒', content: `内部单号「${orderNo}」已存在，无法重复新增！` });
      return;
    }
    const latestGroups: PackGroup[] = safeJson<PackGroup[]>(sk.group, []);
    const matched = latestGroups.find(g => g.inspectorId === defaultInspectorId.trim());
    const inspector = matched?.inspector || '';
    const packer = matched?.packer || '';
    const foreignTeam = matched?.foreignTeam || '';
    const dateVal = todayIso(); const month = dateVal.slice(0, 7);
    const rec: UrgentRecord = { ...emptyUrgent(), orderNo, quantity: defaultQuantity || 1, inspectorId: defaultInspectorId.trim(), inspector, packer, foreignTeam, date: dateVal, month, qcDate: dateVal, creator: getDisplayName(), lastEditor: getDisplayName(), lastEditTime: new Date().toISOString() };
    save([rec, ...records]);
    setScanInput('');
    message.success(`扫码新增: ${orderNo}（质检员: ${inspector || '—'}）`);
  };
  const openAdd = () => {
    const cur = getDisplayName();
    const g = packGroups.find(g => g.inspector === cur) || packGroups[0];
    setEditing(null);
    form.setFieldsValue({ ...emptyUrgent(), inspector: cur, packer: g?.packer || '', foreignTeam: g?.foreignTeam || '' });
    setWagePreview(null);
    setVisible(true);
  };
  const openEdit = (r: UrgentRecord) => {
    setEditing(r);
    form.setFieldsValue(r);
    // 编辑时自动显示当前材质的工价预览
    if (r.material) {
      handleMaterialChange(r.material);
    } else {
      setWagePreview(null);
    }
    setVisible(true);
  };
  const handleSave = () => {
    form.validateFields().then(v => {
      // 新增时检查单号重复（编辑时不检查）
      if (!editing && v.orderNo && records.some(r => r.orderNo === v.orderNo)) {
        Modal.warning({ title: '重复提醒', content: `内部单号「${v.orderNo}」已存在，无法重复新增！` });
        return;
      }
      const dateVal = todayIso(); const month = dateVal.slice(0, 7);
      const latestWages: UrgentWageRate[] = safeJson<UrgentWageRate[]>(sk.urgentWage, []);
      const latestGroups: PackGroup[] = safeJson<PackGroup[]>(sk.group, []);
      const fRM: Record<string, number> = {}; const fPRM: Record<string, number> = {}; const fTRM: Record<string, number> = {};
      latestWages.forEach(w => { fRM[w.material] = w.rate; if (w.packRate) fPRM[w.material] = w.packRate; if (w.teamRate) fTRM[w.material] = w.teamRate; });
      // 根据质检员匹配分组中的打包员/外贸组长
      const matchedGroup = latestGroups.find(g => g.inspector === v.inspector);
      const packer = matchedGroup?.packer || v.packer || '';
      const foreignTeam = matchedGroup?.foreignTeam || v.foreignTeam || '';
      const rate = fRM[v.material] || 0; const qty = Number(v.quantity) || 0;
      const rec: UrgentRecord = {
        ...(editing || emptyUrgent()), ...v, packer, foreignTeam,
        key: editing?.key || genKey('UG'), date: dateVal, month, qcDate: dateVal,
        priceRate: rate, wage: qty * rate, packWage: qty * (fPRM[v.material] || 0), commission: qty * (fTRM[v.material] || 0),
        lastEditor: getDisplayName(), lastEditTime: new Date().toISOString(),
      };
      const list = editing ? records.map(x => x.key === editing.key ? rec : x) : [rec, ...records];
      save(list); setVisible(false); message.success(editing ? '已更新' : '已新增');
    }).catch(() => {});
  };
  const handleDelete = (r: UrgentRecord) => save(records.filter(x => x.key !== r.key));
  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        const added: UrgentRecord[] = rows.map(r => ({
          ...emptyUrgent(),
          month: String(r['月份'] || ''), date: String(r['日期'] || todayIso()), qcDate: String(r['质检日期'] || todayIso()),
          orderNo: String(r['内部单号'] || ''), productCode: String(r['货号'] || ''),
          quantity: Number(r['数量']) || 0, inspector: String(r['质检员'] || ''),
          material: String(r['材质'] || ''), remark: String(r['备注'] || ''),
          creator: String(r['创建人'] || getDisplayName()),
          priceRate: Number(r['工价']) || 0, wage: Number(r['质检工资']) || 0,
          packer: String(r['打包员'] || ''), packWage: Number(r['打包工资']) || 0,
          commission: Number(r['外贸组长工资']) || 0, foreignTeam: String(r['外贸组长'] || ''),
        }));
        save([...added, ...records]); message.success(`已导入 ${added.length} 条`);
      } catch { message.error('导入失败'); }
    };
    reader.readAsArrayBuffer(file); return false;
  };
  const handleExport = () => {
    const rows = filtered.map(r => ({
      '月份': r.month, '日期': r.date, '内部单号': r.orderNo, '货号': r.productCode,
      '数量': r.quantity, '质检员': r.inspector, '质检员编号': r.inspectorId, '材质': r.material, '备注': r.remark,
      '创建人': r.creator, '工价': r.priceRate, '质检工资': r.wage,
      '打包员': r.packer, '打包工资': r.packWage, '外贸组长工资': r.commission,
      '外贸组长': r.foreignTeam,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '急采统计');
    XLSX.writeFile(wb, `急采统计_${todayIso()}.xlsx`); message.success('已导出');
  };
  const cols: ColumnsType<UrgentRecord> = [
    { title: '月份', dataIndex: 'month', key: 'month', width: 90, align: 'center', render: v => v ? <Tag>{v}</Tag> : '—' },
    { title: '日期', dataIndex: 'date', key: 'date', width: 110, align: 'center', render: v => v || '—' },
    { title: '内部单号', dataIndex: 'orderNo', key: 'orderNo', width: 150, ellipsis: true, render: v => v ? <span style={{ fontWeight: 500, color: '#1e4a7e' }}>{v}</span> : '—' },
    { title: '货号', dataIndex: 'productCode', key: 'productCode', width: 120, ellipsis: true },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 70, align: 'center', render: v => <span style={{ fontWeight: 600 }}>{v || 0}</span> },
    { title: '质检员', dataIndex: 'inspector', key: 'inspector', width: 90, align: 'center', render: v => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '质检员编号', dataIndex: 'inspectorId', key: 'inspectorId', width: 110, align: 'center', render: v => v || '—' },
    { title: '材质', dataIndex: 'material', key: 'material', width: 90, align: 'center', render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
    { title: '图片', dataIndex: 'image', key: 'image', width: 60, align: 'center', render: v => v ? <AntdImage src={v} width={36} height={36} style={{ objectFit: 'cover' }} /> : '—' },
    { title: '工价', dataIndex: 'priceRate', key: 'priceRate', width: 70, align: 'right', render: v => v ? `¥${v}` : '—' },
    { title: '质检工资', dataIndex: 'wage', key: 'wage', width: 100, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#52c41a' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '打包员', dataIndex: 'packer', key: 'packer', width: 90, align: 'center', render: v => v ? <Tag color="purple">{v}</Tag> : '—' },
    { title: <Tooltip title="= 对应材质在工价管理中设置的打包员工价 × 数量">打包工资 <QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip>, dataIndex: 'packWage', key: 'packWage', width: 110, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#722ed1' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: <Tooltip title="= 对应材质在工价管理中设置的外贸组长工价 × 数量">外贸组长工资 <QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip>, dataIndex: 'commission', key: 'commission', width: 130, align: 'right', render: v => v ? <span style={{ fontWeight: 600, color: '#fa8c16' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '外贸组长', dataIndex: 'foreignTeam', key: 'foreignTeam', width: 100, align: 'center', render: v => v || '—' },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 120, ellipsis: true },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 80, align: 'center', render: v => v || '—' },
    { title: '操作', key: 'action', width: 100, align: 'center', fixed: 'right',
      render: (_v, r) => { const canModify = canEditAll || r.creator === myDisplayName; return (<Space size={0}><Button type="link" size="small" icon={<EditOutlined />} disabled={!canModify} onClick={() => openEdit(r)} /><Popconfirm title="确定删除？" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消"><Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canModify} /></Popconfirm></Space>); } },
  ];
  return (
    <ConfigProvider theme={{
      token: { borderRadius: 0 },
      components: {
        Button: { borderRadius: 0 },
        Input: { borderRadius: 0 },
        Select: { borderRadius: 0 },
        InputNumber: { borderRadius: 0 },
        DatePicker: { borderRadius: 0 },
        Card: { borderRadiusLG: 0 },
        Table: { borderRadius: 0 },
        Modal: { borderRadiusLG: 0 },
        Tag: { borderRadiusSM: 0 },
        Pagination: { borderRadius: 0 },
      },
    }}>
    <div className="urgent-tab-rect" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <style>{`
        .urgent-tab-rect .ant-card, .urgent-tab-rect .ant-btn, .urgent-tab-rect .ant-input,
        .urgent-tab-rect .ant-select-selector, .urgent-tab-rect .ant-input-number,
        .urgent-tab-rect .ant-picker, .urgent-tab-rect .ant-tag, .urgent-tab-rect .ant-pagination-item,
        .urgent-tab-rect .ant-pagination-prev .ant-pagination-item-link,
        .urgent-tab-rect .ant-pagination-next .ant-pagination-item-link,
        .urgent-tab-rect .ant-table, .urgent-tab-rect .ant-table-thead > tr > th,
        .urgent-tab-rect .ant-table-tbody > tr > td,
        .urgent-tab-rect .ant-card-body > div > div {
          border-radius: 0 !important;
        }
      `}</style>
      <Row gutter={12} style={{ marginBottom: 8, flexShrink: 0 }}>
        <Col flex="1"><StatCard title="急采记录" value={stats.total} suffix="条" color="#fa541c" icon={<AppstoreOutlined />} /></Col>
        <Col flex="1"><StatCard title="总数量" value={stats.qty} suffix="双" color="#1e4a7e" icon={<BarChartOutlined />} /></Col>
        <Col flex="1"><StatCard title="质检工资合计" value={stats.wage} color="#52c41a" icon={<DollarOutlined />} precision={2} /></Col>
        <Col flex="1"><StatCard title="打包工资合计" value={stats.packWage} color="#722ed1" icon={<DollarOutlined />} precision={2} /></Col>
        <Col flex="1"><StatCard title="外贸组长工资合计" value={stats.commission} color="#fa8c16" icon={<DollarOutlined />} precision={2} /></Col>
      </Row>
      <QuickRangeBar />
      {/* 扫码快速新增 */}
      <Card style={{ marginBottom: 12, border: '1px dashed #d9d9d9', flexShrink: 0 }} styles={{ body: { padding: '8px 16px' } }}>
        <Space align="center" wrap>
          <span style={{ fontSize: 13, color: '#595959', whiteSpace: 'nowrap' }}><ScanOutlined style={{ marginRight: 4 }} />扫码快速新增：</span>
          <Select placeholder="质检员" style={{ width: 120 }} value={defaultInspector || undefined}
            onChange={v => {
              setDefaultInspector(v || '');
              const g = packGroups.find(g => g.inspector === v);
              if (g) setDefaultInspectorId(g.inspectorId || '');
            }}
            allowClear showSearch optionFilterProp="label"
            options={packGroups.filter(g => g.inspector).map(g => ({ value: g.inspector, label: g.inspector }))} />
          <Input placeholder="质检员编号" style={{ width: 120 }} value={defaultInspectorId} onChange={e => {
            const val = e.target.value;
            setDefaultInspectorId(val);
            const g = packGroups.find(g => g.inspectorId === val);
            setDefaultInspector(g?.inspector || '');
          }} allowClear />
          <InputNumber placeholder="默认数量" style={{ width: 100 }} min={1} value={defaultQuantity} onChange={v => setDefaultQuantity(v || 1)} />
          <Input placeholder="扫码或输入内部单号后回车" style={{ width: 280 }} value={scanInput}
            onChange={e => setScanInput(e.target.value)} onPressEnter={handleScanCreate} allowClear autoFocus />
          <Button type="primary" size="small" icon={<ScanOutlined />} onClick={handleScanCreate}>扫码新增</Button>
        </Space>
      </Card>
      <Space wrap style={{ marginBottom: 12, flexShrink: 0 }}>
        <Tooltip title="输入关键字搜索，支持内部单号、货号模糊匹配，回车或点击查询生效">
          <Input placeholder="搜索单号/货号/人员" prefix={<SearchOutlined />} style={{ width: 220 }} value={search}
            onChange={e => setSearch(e.target.value)} onPressEnter={handleQuery} allowClear />
        </Tooltip>
        <Tooltip title="按创建日期范围筛选记录，选好后点击查询生效">
          <DatePicker.RangePicker
            value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
            onChange={vals => { if (vals && vals[0] && vals[1]) { setDateRange([vals[0].format('YYYY-MM-DD'), vals[1].format('YYYY-MM-DD')]); } else { setDateRange(null); } }}
            style={{ width: 240 }} placeholder={['开始日期', '结束日期']} />
        </Tooltip>
        <Tooltip title="按月份筛选，格式为YYYY-MM，点击查询生效">
          <Select placeholder="月份" style={{ width: 130 }} value={fMonth || undefined} onChange={v => setFMonth(v || '')} allowClear options={months.map(m => ({ value: m, label: m }))} />
        </Tooltip>
        <Tooltip title="按质检员筛选">
          <Select placeholder="质检员" style={{ width: 120 }} value={fInspector || undefined} onChange={v => setFInspector(v || '')} allowClear options={inspectors.map(x => ({ value: x, label: x }))} />
        </Tooltip>
        <Tooltip title="按材质筛选，材质可通过「更新信息→更新材质」从导入数据源自动匹配">
          <Select placeholder="材质" style={{ width: 120 }} value={fMaterial || undefined} onChange={v => setFMaterial(v || '')} allowClear options={materials.map(x => ({ value: x, label: x }))} />
        </Tooltip>
        <Tooltip title="应用上方所有筛选条件">
          <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>查询</Button>
        </Tooltip>
        <Tooltip title="手动新增一条急采记录，需填写内部单号、数量、质检员等字段">
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增记录</Button>
        </Tooltip>
        <Tooltip title="从Excel文件批量导入急采记录">
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImport}><Button icon={<UploadOutlined />}>导入Excel</Button></Upload>
        </Tooltip>
        <Tooltip title="将当前筛选后的所有记录导出为Excel文件">
          <Button icon={<FileExcelOutlined />} onClick={handleExport}>导出Excel</Button>
        </Tooltip>
        <Tooltip title="批量更新勾选记录的信息，数据来源同备货单统计">
          <Dropdown menu={{ items: updateMenuItems, onClick: ({ key }) => handleBatchUpdate(key as 'packer' | 'foreignTeam' | 'wages' | 'material' | 'compare' | 'urgentDedup' | 'all') }}>
            <Button icon={<SyncOutlined />}>更新信息{(selectAllFiltered ? filtered.length : selectedRowKeys.length) > 0 ? `(${selectAllFiltered ? filtered.length : selectedRowKeys.length})` : ''}</Button>
          </Dropdown>
        </Tooltip>
        <Tooltip title="重新读取本地存储中的最新数据">
          <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        </Tooltip>
      </Space>
      <div style={{ marginBottom: 4, fontSize: 12, color: '#1890ff', flexShrink: 0 }}>
        {selectAllFiltered ? (
          <span>已全选全部 <b>{filtered.length}</b> 条筛选记录 <a onClick={() => { setSelectedRowKeys([]); setSelectAllFiltered(false); }}>取消选择</a></span>
        ) : (
          selectedRowKeys.length > 0 && selectedRowKeys.length < filtered.length && (
            <span>已选 {selectedRowKeys.length} 条 <a onClick={() => setSelectAllFiltered(true)}>全选全部 {filtered.length} 条筛选记录</a></span>
          )
        )}
      </div>
      <div ref={urgentTableRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Table rowKey="key" size="small" bordered columns={wrapUrgentCols(cols)} dataSource={filtered}
        rowSelection={{
          selectedRowKeys: selectAllFiltered ? filtered.map(r => r.key) : selectedRowKeys,
          onChange: keys => { setSelectedRowKeys(keys); setSelectAllFiltered(false); },
        }}
        scroll={{ x: 1800, y: urgentScrollY }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'], showTotal: t => `共 ${t} 条` }}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      />
      </div>
      <Modal title={editing ? '编辑急采记录' : '新增急采记录'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={600} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={6}><Form.Item name="orderNo" label="单号" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 ST2025001" /></Form.Item></Col>
            <Col span={6}><Form.Item name="productCode" label="货号"><Input placeholder="如 9001" /></Form.Item></Col>
            <Col span={6}><Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="inspector" label="质检员"><Select showSearch allowClear options={inspectors.map(x => ({ value: x, label: x }))} placeholder="选择质检员" /></Form.Item></Col>
            <Col span={6}><Form.Item name="inspectorId" label="质检员编号"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="material" label="材质" rules={[{ required: true, message: '必填' }]}><Select showSearch allowClear options={materials.map(x => ({ value: x, label: x }))} placeholder="选择材质" onChange={handleMaterialChange} /></Form.Item></Col>
          </Row>
          {wagePreview && (
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#52c41a' }}>
              <span>工价预览：质检 <b>¥{wagePreview.rate}</b> / 打包 <b>¥{wagePreview.packRate}</b> / 外贸组长 <b>¥{wagePreview.teamRate}</b></span>
            </div>
          )}
          <Form.Item name="packer" hidden><Input /></Form.Item>
          <Form.Item name="foreignTeam" hidden><Input /></Form.Item>
          <Form.Item name="image" label="图片"><ImageSlot size={120} tip="上传图片" /></Form.Item>
        </Form>
      </Modal>
    </div>
    </ConfigProvider>
  );
};

// ============ 工价管理 ============
const WageTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapWageStockCols } = useResizableColumns<any>(`colWidths_ws_wageStock_${owner}`);
  const { wrapColumns: wrapWageUrgentCols } = useResizableColumns<any>(`colWidths_ws_wageUrgent_${owner}`);
  const { wrapColumns: wrapWagePickCols } = useResizableColumns<any>(`colWidths_ws_wagePick_${owner}`);
  // ---- 备货单工价 ----
  const [stockRates, setStockRates] = useState<StockWageRate[]>(() => safeJson<StockWageRate[]>(sk.wage, []));
  const [stockVisible, setStockVisible] = useState(false); const [stockEditing, setStockEditing] = useState<StockWageRate | null>(null); const [stockForm] = Form.useForm();
  const stockSave = (l: StockWageRate[]) => { setStockRates(l); writeJson(sk.wage, l); };
  const stockOpenAdd = () => { setStockEditing(null); stockForm.setFieldsValue({ material: '', rate: 0, packRate: 0, teamRate: 0 }); setStockVisible(true); };
  const stockOpenEdit = (r: StockWageRate) => { setStockEditing(r); stockForm.setFieldsValue({ material: r.material, rate: r.rate, packRate: r.packRate || 0, teamRate: r.teamRate || 0 }); setStockVisible(true); };
  const stockHandleSave = () => { stockForm.validateFields().then(v => { const rec: StockWageRate = { key: stockEditing?.key || genKey('SWR'), material: v.material, rate: v.rate, packRate: Number(v.packRate) || 0, teamRate: Number(v.teamRate) || 0 }; const list = stockEditing ? stockRates.map(x => x.key === stockEditing.key ? rec : x) : [rec, ...stockRates]; stockSave(list); setStockVisible(false); message.success(stockEditing ? '已更新' : '已新增'); }).catch(() => {}); };
  const stockCols: ColumnsType<StockWageRate> = [
    { title: '材质', dataIndex: 'material', key: 'material', render: v => v ? <Tag color="cyan" style={{ fontSize: 14, padding: '2px 12px' }}>{v}</Tag> : '—' },
    { title: '质检工价（元/双）', dataIndex: 'rate', key: 'rate', width: 140, align: 'right', render: v => <span style={{ fontSize: 15, fontWeight: 700, color: '#52c41a' }}>¥{v}</span> },
    { title: '打包员工价（元/双）', dataIndex: 'packRate', key: 'packRate', width: 160, align: 'right', render: v => v ? <span style={{ fontSize: 15, fontWeight: 700, color: '#722ed1' }}>¥{v}</span> : <span style={{ color: '#bfbfbf' }}>—</span> },
    { title: '外贸组长工价（元/双）', dataIndex: 'teamRate', key: 'teamRate', width: 180, align: 'right', render: v => v ? <span style={{ fontSize: 15, fontWeight: 700, color: '#fa8c16' }}>¥{v}</span> : <span style={{ color: '#bfbfbf' }}>—</span> },
    { title: '操作', key: 'action', width: 120, align: 'center', render: (_v, r) => (<Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => stockOpenEdit(r)}>编辑</Button><Popconfirm title="确定删除？" onConfirm={() => stockSave(stockRates.filter(x => x.key !== r.key))}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>) },
  ];
  // ---- 急采工价 ----
  const [urgentRates, setUrgentRates] = useState<UrgentWageRate[]>(() => safeJson<UrgentWageRate[]>(sk.urgentWage, []));
  const [urgentVisible, setUrgentVisible] = useState(false); const [urgentEditing, setUrgentEditing] = useState<UrgentWageRate | null>(null); const [urgentForm] = Form.useForm();
  const urgentSave = (l: UrgentWageRate[]) => { setUrgentRates(l); writeJson(sk.urgentWage, l); };
  const urgentOpenAdd = () => { setUrgentEditing(null); urgentForm.setFieldsValue({ material: '', rate: 0, packRate: 0, teamRate: 0 }); setUrgentVisible(true); };
  const urgentOpenEdit = (r: UrgentWageRate) => { setUrgentEditing(r); urgentForm.setFieldsValue({ material: r.material, rate: r.rate, packRate: r.packRate || 0, teamRate: r.teamRate || 0 }); setUrgentVisible(true); };
  const urgentHandleSave = () => { urgentForm.validateFields().then(v => { const rec: UrgentWageRate = { key: urgentEditing?.key || genKey('UWR'), material: v.material, rate: v.rate, packRate: Number(v.packRate) || 0, teamRate: Number(v.teamRate) || 0 }; const list = urgentEditing ? urgentRates.map(x => x.key === urgentEditing.key ? rec : x) : [rec, ...urgentRates]; urgentSave(list); setUrgentVisible(false); message.success(urgentEditing ? '已更新' : '已新增'); }).catch(() => {}); };
  const urgentCols: ColumnsType<UrgentWageRate> = [
    { title: '材质', dataIndex: 'material', key: 'material', render: v => v ? <Tag color="cyan" style={{ fontSize: 14, padding: '2px 12px' }}>{v}</Tag> : '—' },
    { title: '质检工价（元/双）', dataIndex: 'rate', key: 'rate', width: 140, align: 'right', render: v => <span style={{ fontSize: 15, fontWeight: 700, color: '#52c41a' }}>¥{v}</span> },
    { title: '打包员工价（元/双）', dataIndex: 'packRate', key: 'packRate', width: 160, align: 'right', render: v => v ? <span style={{ fontSize: 15, fontWeight: 700, color: '#722ed1' }}>¥{v}</span> : <span style={{ color: '#bfbfbf' }}>—</span> },
    { title: '外贸组长工价（元/双）', dataIndex: 'teamRate', key: 'teamRate', width: 180, align: 'right', render: v => v ? <span style={{ fontSize: 15, fontWeight: 700, color: '#fa8c16' }}>¥{v}</span> : <span style={{ color: '#bfbfbf' }}>—</span> },
    { title: '操作', key: 'action', width: 120, align: 'center', render: (_v, r) => (<Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => urgentOpenEdit(r)}>编辑</Button><Popconfirm title="确定删除？" onConfirm={() => urgentSave(urgentRates.filter(x => x.key !== r.key))}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>) },
  ];
  // ---- 配货员工价 ----
  const [pickRates, setPickRates] = useState<PickWageRate[]>(() => safeJson<PickWageRate[]>(sk.pickWage, []));
  const [pickVisible, setPickVisible] = useState(false); const [pickEditing, setPickEditing] = useState<PickWageRate | null>(null); const [pickForm] = Form.useForm();
  const pickSave = (l: PickWageRate[]) => { setPickRates(l); writeJson(sk.pickWage, l); };
  const pickOpenAdd = () => { setPickEditing(null); pickForm.setFieldsValue({ rate: 0 }); setPickVisible(true); };
  const pickOpenEdit = (r: PickWageRate) => { setPickEditing(r); pickForm.setFieldsValue({ rate: r.rate }); setPickVisible(true); };
  const pickHandleSave = () => { pickForm.validateFields().then(v => { const rec: PickWageRate = { key: pickEditing?.key || genKey('PWR'), rate: v.rate }; const list = pickEditing ? pickRates.map(x => x.key === pickEditing.key ? rec : x) : [rec, ...pickRates]; pickSave(list); setPickVisible(false); message.success(pickEditing ? '已更新' : '已新增'); }).catch(() => {}); };
  const pickCols: ColumnsType<PickWageRate> = [
    { title: '配货员工价（元/双）', dataIndex: 'rate', key: 'rate', align: 'right', render: v => <span style={{ fontSize: 15, fontWeight: 700, color: '#1890ff' }}>¥{v}</span> },
    { title: '操作', key: 'action', width: 120, align: 'center', render: (_v, r) => (<Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => pickOpenEdit(r)}>编辑</Button><Popconfirm title="确定删除？" onConfirm={() => pickSave(pickRates.filter(x => x.key !== r.key))}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>) },
  ];
  return (
    <div>
      <Row gutter={16}>
        <Col flex={1}>
          {/* 备货单工价 */}
          <Card style={{ marginBottom: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e6f7ff, #f0f5ff)' }} bodyStyle={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><span style={{ fontSize: 15, fontWeight: 600, color: '#1e4a7e' }}>📦 备货单工价</span><span style={{ fontSize: 13, color: '#8c8c8c', marginLeft: 6 }}>共 {stockRates.length} 种</span></div>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={stockOpenAdd}>新增</Button>
            </div>
          </Card>
          <Table rowKey="key" size="small" bordered columns={wrapWageStockCols(stockCols)} dataSource={stockRates} pagination={false} />
        </Col>
        <Col flex={1}>
          {/* 急采工价 */}
          <Card style={{ marginBottom: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #fff7e6, #fffbe6)' }} bodyStyle={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><span style={{ fontSize: 15, fontWeight: 600, color: '#d46b08' }}>⚡ 急采工价</span><span style={{ fontSize: 13, color: '#8c8c8c', marginLeft: 6 }}>共 {urgentRates.length} 种</span></div>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={urgentOpenAdd}>新增</Button>
            </div>
          </Card>
          <Table rowKey="key" size="small" bordered columns={wrapWageUrgentCols(urgentCols)} dataSource={urgentRates} pagination={false} />
        </Col>
        <Col flex={1}>
          {/* 配货员工价 */}
          <Card style={{ marginBottom: 12, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e6f7ff, #e6fffb)' }} bodyStyle={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><span style={{ fontSize: 15, fontWeight: 600, color: '#096dd9' }}>📮 配货员工价</span><span style={{ fontSize: 13, color: '#8c8c8c', marginLeft: 6 }}>统一工价</span></div>
              {pickRates.length === 0 && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={pickOpenAdd}>设置</Button>}
            </div>
          </Card>
          <Table rowKey="key" size="small" bordered columns={wrapWagePickCols(pickCols)} dataSource={pickRates} pagination={false} />
        </Col>
      </Row>
      <Modal title={stockEditing ? '编辑备货单工价' : '新增备货单工价'} open={stockVisible} onOk={stockHandleSave} onCancel={() => setStockVisible(false)} okText="保存" width={480} destroyOnClose>
        <Form autoComplete="off" form={stockForm} layout="vertical">
          <Form.Item name="material" label="材质" rules={[{ required: true, message: '请输入材质名称' }]}><Input placeholder="如 洞洞鞋、棉鞋、单鞋" /></Form.Item>
          <Form.Item name="rate" label="质检工价（元/双）" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="packRate" label="打包员工价（元/双）"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="teamRate" label="外贸组长工价（元/双）"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={urgentEditing ? '编辑急采工价' : '新增急采工价'} open={urgentVisible} onOk={urgentHandleSave} onCancel={() => setUrgentVisible(false)} okText="保存" width={480} destroyOnClose>
        <Form autoComplete="off" form={urgentForm} layout="vertical">
          <Form.Item name="material" label="材质" rules={[{ required: true, message: '请输入材质名称' }]}><Input placeholder="如 洞洞鞋、棉鞋、单鞋" /></Form.Item>
          <Form.Item name="rate" label="质检工价（元/双）" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="packRate" label="打包员工价（元/双）"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="teamRate" label="外贸组长工价（元/双）"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={pickEditing ? '编辑配货员工价' : '设置配货员工价'} open={pickVisible} onOk={pickHandleSave} onCancel={() => setPickVisible(false)} okText="保存" width={360} destroyOnClose>
        <Form autoComplete="off" form={pickForm} layout="vertical">
          <Form.Item name="rate" label="配货员工价（元/双）" rules={[{ required: true, message: '请输入工价' }]}><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// ============ 分组 ============
const GroupTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapGroupCols } = useResizableColumns<any>(`colWidths_ws_group_${owner}`);
  const [groups, setGroups] = useState<PackGroup[]>(() => safeJson<PackGroup[]>(sk.group, []));
  const [visible, setVisible] = useState(false); const [editing, setEditing] = useState<PackGroup | null>(null); const [form] = Form.useForm();
  const staffOpts = useMemo(() =>
    loadTenantUsers().map((u: any) => ({ value: tenantUserDisplayName(u), label: `${tenantUserDisplayName(u)}${u.isSubAccount ? '' : '（管理员）'}` })),
  []);
  const save = (l: PackGroup[]) => { setGroups(l); writeJson(sk.group, l); };
  const openAdd = () => { setEditing(null); form.setFieldsValue({ inspector: '', inspectorId: '', packer: '', foreignTeam: '' }); setVisible(true); };
  const openEdit = (r: PackGroup) => { setEditing(r); form.setFieldsValue(r); setVisible(true); };
  const handleSave = () => { form.validateFields().then(v => { const rec: PackGroup = { key: editing?.key || genKey('PG'), ...v }; const list = editing ? groups.map(x => x.key === editing.key ? rec : x) : [rec, ...groups]; save(list); setVisible(false); message.success(editing ? '已更新' : '已添加'); }).catch(() => {}); };
  const cols: ColumnsType<PackGroup> = [
    { title: '质检员', dataIndex: 'inspector', key: 'inspector', render: v => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '质检员编号', dataIndex: 'inspectorId', key: 'inspectorId', width: 120, align: 'center' },
    { title: '打包员', dataIndex: 'packer', key: 'packer', render: v => v ? <Tag color="purple">{v}</Tag> : '—' },
    { title: '外贸组长', dataIndex: 'foreignTeam', key: 'foreignTeam', render: v => v ? <Tag color="gold">{v}</Tag> : '—' },
    { title: '操作', key: 'action', width: 120, align: 'center', render: (_v, r) => (<Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button><Popconfirm title="确定删除？" onConfirm={() => save(groups.filter(x => x.key !== r.key))}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space>) },
  ];
  return (
    <div>
      <Card style={{ marginBottom: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #f6ffed, #e6f7ff)' }} bodyStyle={{ padding: '12px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><TeamOutlined style={{ color: '#52c41a', marginRight: 8 }} /><span>共 <b>{groups.length}</b> 名成员</span></div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>添加成员</Button>
        </div>
      </Card>
      <Table rowKey="key" size="middle" bordered columns={wrapGroupCols(cols)} dataSource={groups} pagination={false} />
      <Modal title={editing ? '编辑成员' : '添加成员'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" width={480} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="inspector" label="质检员" rules={[{ required: true }]}><AutoComplete options={staffOpts} placeholder="选择或输入姓名" filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={12}><Form.Item name="inspectorId" label="质检员编号"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="packer" label="打包员"><AutoComplete options={staffOpts} placeholder="选择或输入姓名" filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={12}><Form.Item name="foreignTeam" label="外贸组长"><AutoComplete options={staffOpts} placeholder="选择或输入姓名" filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

// ============ 奖惩记录 ============
const NoteTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapNoteCols } = useResizableColumns<any>(`colWidths_ws_note_${owner}`);
  const [notes, setNotes] = useState<NoteItem[]>(() => safeJson<NoteItem[]>(sk.note, []));
  const [visible, setVisible] = useState(false); const [editing, setEditing] = useState<NoteItem | null>(null); const [form] = Form.useForm();
  const save = (l: NoteItem[]) => { setNotes(l); writeJson(sk.note, l); window.dispatchEvent(new Event('note-changed')); };
  // 从分组中收集所有成员（质检员 + 打包员 + 外贸组长）
  const staffOpts = useMemo(() => {
    const groups = safeJson<PackGroup[]>(sk.group, []);
    const set = new Set<string>();
    groups.forEach(g => { if (g.inspector) set.add(g.inspector); if (g.packer) set.add(g.packer); if (g.foreignTeam) set.add(g.foreignTeam); });
    return Array.from(set).sort();
  }, []);
  const openAdd = () => { setEditing(null); form.setFieldsValue({ note: '', person: '', amount: 0, date: todayIso(), month: dayjs().format('YYYY-MM'), type: 'reward' }); setVisible(true); };
  const openEdit = (r: NoteItem) => { setEditing(r); form.setFieldsValue({ ...r, type: r.type || 'reward' }); setVisible(true); };
  const handleSave = () => { form.validateFields().then(v => { const rec: NoteItem = { key: editing?.key || genKey('NT'), ...v }; const list = editing ? notes.map(x => x.key === editing.key ? rec : x) : [rec, ...notes]; save(list); setVisible(false); message.success(editing ? '已更新' : '已新增'); }).catch(() => {}); };
  const cols: ColumnsType<NoteItem> = [
    { title: '类型', dataIndex: 'type', key: 'type', width: 70, align: 'center', render: v => v === 'punishment' ? <Tag color="red">罚款</Tag> : <Tag color="green">奖励</Tag> },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
    { title: '人员', dataIndex: 'person', key: 'person', width: 100, align: 'center', render: v => v ? <Tag>{v}</Tag> : '—' },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, align: 'right', render: (v, r) => v ? <span style={{ fontWeight: 600, color: r.type === 'punishment' ? '#f5222d' : '#52c41a' }}>{r.type === 'punishment' ? '-' : '+'}¥{v}</span> : '—' },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120, align: 'center' },
    { title: '月份', dataIndex: 'month', key: 'month', width: 90, align: 'center', render: v => v ? <Tag>{v}</Tag> : '—' },
    { title: '操作', key: 'action', width: 100, align: 'center', render: (_v, r) => (<Space size={0}><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)} /><Popconfirm title="确定删除？" onConfirm={() => save(notes.filter(x => x.key !== r.key))}><Button type="link" danger icon={<DeleteOutlined />} /></Popconfirm></Space>) },
  ];
  return (
    <div>
      <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{ marginBottom: 12 }}>新增奖惩</Button>
      <Table rowKey="key" size="middle" bordered columns={wrapNoteCols(cols)} dataSource={notes} pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
      <Modal title={editing ? '编辑奖惩' : '新增奖惩'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" width={480} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="reward">奖励</Radio>
              <Radio value="punishment">罚款</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="note" label="备注内容" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="person" label="人员"><Select showSearch allowClear placeholder="选择人员" options={staffOpts.map(s => ({ value: s, label: s }))} filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={8}><Form.Item name="amount" label="金额"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="date" label="日期"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="month" label="月份"><Input placeholder="YYYY-MM" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// ============ 工资汇总（自动计算） ============
const SalaryTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapSalaryCols } = useResizableColumns<any>(`colWidths_ws_salary_${owner}`);
  const { viewManagers, editManagers } = useWarehouseCtx();
  const [stockRecords] = useState<StockRecord[]>(() => safeJson<StockRecord[]>(sk.stock, []));
  const [urgentRecords] = useState<UrgentRecord[]>(() => safeJson<UrgentRecord[]>(sk.urgent, []));
  const [pickRecords] = useState<PickRecord[]>(() => safeJson<PickRecord[]>(sk.pick, []));
  const [noteItems, setNoteItems] = useState<NoteItem[]>(() => safeJson<NoteItem[]>(sk.note, []));
  const [fMonth, setFMonth] = useState(dayjs().format('YYYY-MM'));
  const [noteDetailPerson, setNoteDetailPerson] = useState<string | null>(null);
  const personNotes = useMemo(() => noteDetailPerson ? noteItems.filter(n => n.person === noteDetailPerson && n.month === fMonth) : [], [noteItems, noteDetailPerson, fMonth]);
  // 监听奖惩记录变更，即时从 localStorage 重读并刷新缓存
  useEffect(() => {
    const refresh = () => setNoteItems(safeJson<NoteItem[]>(sk.note, []));
    window.addEventListener('note-changed', refresh);
    return () => window.removeEventListener('note-changed', refresh);
  }, []);

  const allMonths = useMemo(() => {
    const s = new Set<string>();
    stockRecords.forEach(r => r.month && s.add(r.month));
    urgentRecords.forEach(r => r.month && s.add(r.month));
    pickRecords.forEach(r => r.month && s.add(r.month));
    return Array.from(s).sort().reverse();
  }, [stockRecords, urgentRecords, pickRecords]);

  // 增量计算：挂载时一次性预聚合所有月份，切月时 O(1) 查找而非全量重算
  const monthlyCache = useMemo(() => {
    const cache: Record<string, { rows: any[]; stockQty: number; urgentQty: number; pickQty: number }> = {};
    const months = new Set<string>();
    stockRecords.forEach(r => r.month && months.add(r.month));
    urgentRecords.forEach(r => r.month && months.add(r.month));
    pickRecords.forEach(r => r.month && months.add(r.month));
    noteItems.forEach(n => n.month && months.add(n.month));
    months.forEach(m => {
      const qcMap: Record<string, { stockWage: number; urgentWage: number; qty: number }> = {};
      const packMap: Record<string, { stockPack: number; urgentPack: number }> = {};
      const pickMap: Record<string, { wage: number; qty: number }> = {};
      const teamMap: Record<string, number> = {};
      const noteMap: Record<string, number> = {};
      let stockQty = 0, urgentQty = 0, pickQty = 0;
      for (const r of stockRecords) {
        if (r.month !== m) continue;
        stockQty += r.quantity || 0;
        if (r.qcInspector) { if (!qcMap[r.qcInspector]) qcMap[r.qcInspector] = { stockWage: 0, urgentWage: 0, qty: 0 }; qcMap[r.qcInspector].stockWage += r.qcWage || 0; qcMap[r.qcInspector].qty += r.quantity || 0; }
        if (r.packer) { if (!packMap[r.packer]) packMap[r.packer] = { stockPack: 0, urgentPack: 0 }; packMap[r.packer].stockPack += r.packWage || 0; }
        if (r.foreignTeam) { teamMap[r.foreignTeam] = (teamMap[r.foreignTeam] || 0) + (r.commission || 0); }
      }
      for (const r of urgentRecords) {
        if (r.month !== m) continue;
        urgentQty += r.quantity || 0;
        if (r.inspector) { if (!qcMap[r.inspector]) qcMap[r.inspector] = { stockWage: 0, urgentWage: 0, qty: 0 }; qcMap[r.inspector].urgentWage += r.wage || 0; qcMap[r.inspector].qty += r.quantity || 0; }
        if (r.packer) { if (!packMap[r.packer]) packMap[r.packer] = { stockPack: 0, urgentPack: 0 }; packMap[r.packer].urgentPack += r.packWage || 0; }
        if (r.foreignTeam) { teamMap[r.foreignTeam] = (teamMap[r.foreignTeam] || 0) + (r.commission || 0); }
      }
      for (const r of pickRecords) {
        if (r.month !== m) continue;
        pickQty += r.quantity || 0;
        const k = r.picker || r.creator;
        if (k) { if (!pickMap[k]) pickMap[k] = { wage: 0, qty: 0 }; pickMap[k].wage += r.wage || 0; pickMap[k].qty += r.quantity || 0; }
      }
      for (const n of noteItems) {
        if (n.month !== m || !n.person) continue;
        noteMap[n.person] = (noteMap[n.person] || 0) + ((n.type === 'punishment' ? -1 : 1) * (n.amount || 0));
      }
      const allPersons = Array.from(new Set([...Object.keys(qcMap), ...Object.keys(packMap), ...Object.keys(pickMap), ...Object.keys(teamMap), ...Object.keys(noteMap)]));
      const rows = allPersons.map(name => {
        const stockWage = qcMap[name]?.stockWage || 0;
        const urgentWage = qcMap[name]?.urgentWage || 0;
        const pickWage = pickMap[name]?.wage || 0;
        const packStockWage = packMap[name]?.stockPack || 0;
        const packUrgentWage = packMap[name]?.urgentPack || 0;
        const teamWage = teamMap[name] || 0;
        const otherPayable = noteMap[name] || 0;
        return { person: name, stockWage, urgentWage, pickWage, packStockWage, packUrgentWage, teamWage, otherPayable, total: stockWage + urgentWage + pickWage + packStockWage + packUrgentWage + teamWage + otherPayable };
      });
      cache[m] = { rows, stockQty, urgentQty, pickQty };
    });
    return cache;
  }, [noteItems]);
  const salaryData = monthlyCache[fMonth] || { rows: [], stockQty: 0, urgentQty: 0, pickQty: 0 };

  // 负责人权限过滤
  const canViewAll = useMemo(() => { if (isAdmin) return true; if (viewManagers.length === 0 && editManagers.length === 0) return true; return viewManagers.includes(curUsername) || editManagers.includes(curUsername); }, [viewManagers, editManagers]);
  const myDisplayName = useMemo(() => getDisplayName(), []);
  const visibleRows = useMemo(() => canViewAll ? salaryData.rows : salaryData.rows.filter(r => r.person === myDisplayName), [salaryData.rows, canViewAll, myDisplayName]);
  const totalAll = visibleRows.reduce((s, r) => s + r.total, 0);

  const cols: ColumnsType<any> = [
    { title: '人员', dataIndex: 'person', key: 'person', render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: '备货质检工资', dataIndex: 'stockWage', key: 'stockWage', align: 'right', render: v => v ? `¥${v.toFixed(2)}` : '—' },
    { title: '急采质检工资', dataIndex: 'urgentWage', key: 'urgentWage', align: 'right', render: v => v ? `¥${v.toFixed(2)}` : '—' },
    { title: '配货工资', dataIndex: 'pickWage', key: 'pickWage', align: 'right', render: v => v ? <span style={{ color: '#722ed1' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '备货打包工资', dataIndex: 'packStockWage', key: 'packStockWage', align: 'right', render: v => v ? `¥${v.toFixed(2)}` : '—' },
    { title: '急采打包工资', dataIndex: 'packUrgentWage', key: 'packUrgentWage', align: 'right', render: v => v ? `¥${v.toFixed(2)}` : '—' },
    { title: '外贸组长工资', dataIndex: 'teamWage', key: 'teamWage', align: 'right', render: v => v ? <span style={{ color: '#fa8c16' }}>¥{v.toFixed(2)}</span> : '—' },
    { title: '奖惩记录', dataIndex: 'otherPayable', key: 'otherPayable', align: 'right', render: (v, r) => v ? <a onClick={() => setNoteDetailPerson(r.person)} style={{ display: 'block', width: '100%', color: '#fa541c', cursor: 'pointer', textDecoration: 'underline' }}>¥{v.toFixed(2)}</a> : '—' },
    { title: '合计', dataIndex: 'total', key: 'total', align: 'right', render: v => <span style={{ fontWeight: 700, fontSize: 16, color: '#52c41a' }}>¥{v.toFixed(2)}</span> },
  ];

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col flex="1"><StatCard title="备货数量" value={salaryData.stockQty} suffix="双" color="#1890ff" icon={<AppstoreOutlined />} /></Col>
        <Col flex="1"><StatCard title="急采数量" value={salaryData.urgentQty} suffix="双" color="#fa541c" icon={<BarChartOutlined />} /></Col>
        <Col flex="1"><StatCard title="配货数量" value={salaryData.pickQty} suffix="双" color="#722ed1" icon={<CheckCircleOutlined />} /></Col>
        <Col flex="1"><StatCard title="工资总计" value={totalAll} color="#52c41a" icon={<DollarOutlined />} precision={2} /></Col>
      </Row>
      <Space style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 500 }}>统计月份：</span>
        <Select style={{ width: 140 }} value={fMonth} onChange={setFMonth} options={allMonths.map(m => ({ value: m, label: m }))} />
      </Space>
      <Table rowKey="person" size="middle" bordered columns={wrapSalaryCols(cols)} dataSource={visibleRows} pagination={false}
        summary={() => <Table.Summary.Row><Table.Summary.Cell index={0}><b>合计</b></Table.Summary.Cell><Table.Summary.Cell index={1} /><Table.Summary.Cell index={2} /><Table.Summary.Cell index={3} /><Table.Summary.Cell index={4} /><Table.Summary.Cell index={5} /><Table.Summary.Cell index={6} /><Table.Summary.Cell index={7} /><Table.Summary.Cell index={8}><span style={{ fontWeight: 700, fontSize: 18, color: '#52c41a' }}>¥{totalAll.toFixed(2)}</span></Table.Summary.Cell></Table.Summary.Row>} />
      <Modal title={`${noteDetailPerson || ''} - ${fMonth} 奖惩明细`} open={!!noteDetailPerson} onCancel={() => setNoteDetailPerson(null)} footer={null} width={560}>
        <Table rowKey="key" size="small" bordered dataSource={personNotes}
          columns={[
            { title: '类型', dataIndex: 'type', key: 'type', width: 70, align: 'center', render: v => v === 'punishment' ? <Tag color="red">罚款</Tag> : <Tag color="green">奖励</Tag> },
            { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
            { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, align: 'right', render: (v, r) => <span style={{ fontWeight: 600, color: r.type === 'punishment' ? '#f5222d' : '#52c41a' }}>{r.type === 'punishment' ? '-' : '+'}¥{v}</span> },
            { title: '日期', dataIndex: 'date', key: 'date', width: 120, align: 'center' },
          ]}
          pagination={false}
          summary={() => {
            const total = personNotes.reduce((s, n) => s + ((n.type === 'punishment' ? -1 : 1) * (n.amount || 0)), 0);
            return <Table.Summary.Row><Table.Summary.Cell index={0}><b>合计</b></Table.Summary.Cell><Table.Summary.Cell index={1} /><Table.Summary.Cell index={2}><span style={{ fontWeight: 700, fontSize: 14, color: total >= 0 ? '#52c41a' : '#f5222d' }}>{total >= 0 ? '+' : ''}¥{total.toFixed(2)}</span></Table.Summary.Cell><Table.Summary.Cell index={3} /></Table.Summary.Row>;
          }}
        />
      </Modal>
    </div>
  );
};

// ============ 标签统计 ============
const OrderLabelTab: React.FC = () => {
  const owner = getDataOwner(); const sk = SK(owner);
  const { wrapColumns: wrapOLCols } = useResizableColumns<any>(`colWidths_ws_ol_${owner}`);
  const [records, setRecords] = useState<OrderLabelRecord[]>(() => readOLSync(owner));
  // 从 IndexedDB 加载最新数据（解决 localStorage 5MB 限制）
  useEffect(() => {
    loadDataset(_olKey(owner)).then(ds => {
      if (ds?.json) {
        try {
          const list = JSON.parse(ds.json) as OrderLabelRecord[];
          if (list.length > 0) { _olCache = { owner, list }; setRecords(list); window.dispatchEvent(new Event('ol-changed')); }
        } catch { /* ignore */ }
      }
    });
  }, [owner]);
  const [visible, setVisible] = useState(false); const [editing, setEditing] = useState<OrderLabelRecord | null>(null); const [form] = Form.useForm();
  // 搜索字段拆分
  const [searchOrderNo, setSearchOrderNo] = useState('');
  const [searchLabel, setSearchLabel] = useState('');
  const [searchStyleNo, setSearchStyleNo] = useState('');
  const [searchMaterial, setSearchMaterial] = useState('');
  // 已应用搜索状态（点击查询后才生效）
  const [appliedOrderNo, setAppliedOrderNo] = useState('');
  const [appliedLabel, setAppliedLabel] = useState('');
  const [appliedStyleNo, setAppliedStyleNo] = useState('');
  const [appliedMaterial, setAppliedMaterial] = useState('');
  // 时间范围筛选
  const [searchDateRange, setSearchDateRange] = useState<[string, string] | null>(null);
  const [appliedDateRange, setAppliedDateRange] = useState<[string, string] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState({ total: 0, processed: 0, added: 0, updated: 0 });
  // 分页状态
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  // 动态表格高度（视口锚定）
  const tableWrapRef = React.useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(400);
  useEffect(() => {
    const calc = () => {
      if (!tableWrapRef.current) return;
      const header = tableWrapRef.current.querySelector('.ant-table-thead') as HTMLElement;
      if (!header) return;
      const bodyTop = header.getBoundingClientRect().bottom;
      // 用 TabPane 容器实际高度而非 window.innerHeight（容器有 padding，innerHeight 偏大）
      const pane = tableWrapRef.current.closest('.ant-tabs-tabpane') as HTMLElement;
      const bottom = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
      const available = Math.max(200, bottom - bodyTop - 52);
      setTableScrollY(available);
      const body = tableWrapRef.current.querySelector('.ant-table-body') as HTMLElement;
      if (body) body.style.minHeight = `${available}px`;
    };
    const t1 = setTimeout(calc, 150);
    const t2 = setTimeout(calc, 500);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', calc); };
  }, [pageSize]);
  const wageRates = useMemo<StockWageRate[]>(() => safeJson<StockWageRate[]>(sk.wage, []), [sk.wage]);
  const materials = useMemo(() => Array.from(new Set(wageRates.map(w => w.material).filter(Boolean))), [wageRates]);
  const save = (l: OrderLabelRecord[]) => { setRecords(l); writeOL(owner, l); };
  const emptyRec = (): OrderLabelRecord => ({ key: genKey('OL'), orderNo: '', label: '', styleNo: '', quantity: 0, material: '', createdAt: todayIso(), creator: getDisplayName() });
  // 根据标签内容自动匹配材质
  const matchMaterial = (label: string): string => {
    if (!label) return '';
    return materials.find(m => label.includes(m)) || '';
  };
  const openAdd = () => { setEditing(null); form.setFieldsValue({ ...emptyRec() }); setVisible(true); };
  const openEdit = (r: OrderLabelRecord) => { setEditing(r); form.setFieldsValue(r); setVisible(true); };
  const handleSave = () => {
    form.validateFields().then(v => {
      const rec: OrderLabelRecord = { ...(editing || emptyRec()), ...v, key: editing?.key || genKey('OL'), createdAt: editing?.createdAt || todayIso(), creator: editing?.creator || getDisplayName() };
      const list = editing ? records.map(x => x.key === editing.key ? rec : x) : [rec, ...records];
      save(list); setVisible(false); message.success(editing ? '已更新' : '已新增');
    }).catch(() => {});
  };
  const handleDelete = (r: OrderLabelRecord) => save(records.filter(x => x.key !== r.key));
  const handleBatchDelete = () => {
    const keys = selectAllFiltered ? filtered.map(r => r.key) : selectedRowKeys;
    if (keys.length === 0) return;
    Modal.confirm({
      title: '批量删除确认',
      content: `确定要删除选中的 ${keys.length} 条记录吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        save(records.filter(x => !keys.includes(x.key)));
        setSelectedRowKeys([]);
        setSelectAllFiltered(false);
        message.success(`已删除 ${keys.length} 条记录`);
      },
    });
  };
  // 导入并合并：相同内部单号汇总数量，已存在则覆盖
  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<any>(sheet);
        // 按内部单号分组
        const groups: Record<string, any[]> = {};
        raw.forEach(row => {
          const no = String(row['内部订单号'] || row['内部单号'] || '').trim();
          if (!no) return;
          if (!groups[no]) groups[no] = [];
          groups[no].push(row);
        });
        const entries = Object.entries(groups);
        setImporting(true);
        setImportProgress(0);
        setImportStats({ total: entries.length, processed: 0, added: 0, updated: 0 });
        // 即时从缓存重读最新记录（优先 IndexedDB）
        const latestRecords: OrderLabelRecord[] = _olCache?.owner === owner ? [..._olCache.list] : readOLSync(owner);
        const existMap = new Map<string, OrderLabelRecord>();
        latestRecords.forEach(r => existMap.set(r.orderNo, r));
        let added = 0, updated = 0;
        const newRecords: OrderLabelRecord[] = [];
        const updatedRecords: OrderLabelRecord[] = [...latestRecords];
        // 同步处理全部数据
        entries.forEach(([orderNo, rows], idx) => {
          const totalQty = rows.reduce((s, r) => s + (Number(r['数量']) || 0), 0);
          const mergeField = (field: string) => Array.from(new Set(rows.map(r => String(r[field] || '').trim()).filter(Boolean))).join(', ');
          const label = mergeField('标签');
          const styleNo = mergeField('款号');
          const mat = matchMaterial(label);
          const existing = existMap.get(orderNo);
          if (existing) {
            const i = updatedRecords.findIndex(r => r.orderNo === orderNo);
            if (i >= 0) { updatedRecords[i] = { ...existing, label, styleNo, quantity: totalQty, material: mat }; updated++; }
          } else {
            newRecords.push({ key: genKey('OL'), orderNo, label, styleNo, quantity: totalQty, material: mat, createdAt: todayIso(), creator: getDisplayName() });
            added++;
          }
          if (idx % 100 === 0) setImportProgress(Math.round((idx / entries.length) * 100));
        });
        setImportProgress(100);
        setImportStats({ total: entries.length, processed: entries.length, added, updated });
        // 写入 IndexedDB（无容量限制）+ localStorage 缓存
        const finalList = [...newRecords, ...updatedRecords];
        writeOL(owner, finalList);
        setRecords(finalList);
        setTimeout(() => { setImporting(false); message.success(`导入完成：新增 ${added} 条，覆盖 ${updated} 条，共 ${finalList.length} 条`); }, 800);
      } catch { setImporting(false); message.error('导入解析失败'); }
    };
    reader.readAsArrayBuffer(file); return false;
  };
  const handleExport = () => {
    const rows = filtered.map(r => ({ '内部订单号': r.orderNo, '标签': r.label, '款号': r.styleNo, '数量': r.quantity, '材质': r.material, '创建人': r.creator, '创建日期': r.createdAt }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '导入数据源');
    XLSX.writeFile(wb, `导入数据源_${todayIso()}.xlsx`); message.success('已导出');
  };
  // 查询按钮处理
  const handleQuery = () => {
    reloadAfterPull(() => setRecords(readOLSync(owner))); // 查询时自动刷新表单数据（本地+服务端拉取）
    setAppliedOrderNo(searchOrderNo.trim());
    setAppliedLabel(searchLabel.trim());
    setAppliedStyleNo(searchStyleNo.trim());
    setAppliedMaterial(searchMaterial);
    setAppliedDateRange(searchDateRange);
  };
  // 重置筛选
  const handleReset = () => {
    setSearchOrderNo('');
    setSearchLabel('');
    setSearchStyleNo('');
    setSearchMaterial('');
    setSearchDateRange(null);
    setAppliedOrderNo('');
    setAppliedLabel('');
    setAppliedStyleNo('');
    setAppliedMaterial('');
    setAppliedDateRange(null);
  };
  // 从记录中收集所有材质选项
  const allMaterials = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.material) set.add(r.material); });
    return Array.from(set).sort();
  }, [records]);
  const filtered = useMemo(() => records.filter(r => {
    // 内部单号筛选
    if (appliedOrderNo && !r.orderNo.toLowerCase().includes(appliedOrderNo.toLowerCase())) return false;
    // 标签筛选
    if (appliedLabel && !r.label.toLowerCase().includes(appliedLabel.toLowerCase())) return false;
    // 款号筛选
    if (appliedStyleNo && !r.styleNo.toLowerCase().includes(appliedStyleNo.toLowerCase())) return false;
    // 材质筛选
    if (appliedMaterial === '__empty__') {
      if (r.material) return false;
    } else if (appliedMaterial && r.material !== appliedMaterial) {
      return false;
    }
    // 时间范围筛选
    if (appliedDateRange) {
      const [start, end] = appliedDateRange;
      const d = r.createdAt || '';
      if (d < start || d > end) return false;
    }
    return true;
  }), [records, appliedOrderNo, appliedLabel, appliedStyleNo, appliedMaterial, appliedDateRange]);
  const stats = useMemo(() => ({ total: filtered.length, qty: filtered.reduce((s, r) => s + r.quantity, 0) }), [filtered]);
  const cols: ColumnsType<OrderLabelRecord> = [
    { title: '内部订单号', dataIndex: 'orderNo', key: 'orderNo', width: 150, ellipsis: true, render: v => v ? <span style={{ fontWeight: 500, color: '#1e4a7e' }}>{v}</span> : '—' },
    { title: '标签', dataIndex: 'label', key: 'label', width: 180, ellipsis: true, render: v => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '款号', dataIndex: 'styleNo', key: 'styleNo', width: 120, ellipsis: true },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'center', render: v => <span style={{ fontWeight: 600 }}>{v || 0}</span> },
    { title: '材质', dataIndex: 'material', key: 'material', width: 100, align: 'center', render: v => v ? <Tag color="cyan">{v}</Tag> : '—' },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 80, align: 'center', render: v => v || '—' },
    { title: '创建日期', dataIndex: 'createdAt', key: 'createdAt', width: 110, align: 'center', render: v => v || '—' },
    { title: '操作', key: 'action', width: 100, align: 'center', render: (_v, r) => (<Space size={0}><Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} /><Popconfirm title="确定删除？" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消"><Button type="link" size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space>) },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* 搜索栏 - 第一行：筛选字段 + 查询按钮 */}
      <Space wrap size={[8, 8]} style={{ marginBottom: 12, flexShrink: 0 }}>
        <Tooltip title="按内部订单号模糊搜索，支持部分匹配，回车或点击查询生效">
          <Input placeholder="内部单号" style={{ width: 140 }} value={searchOrderNo}
            onChange={e => setSearchOrderNo(e.target.value)} onPressEnter={handleQuery} allowClear />
        </Tooltip>
        <Tooltip title="按标签内容模糊搜索，如输入“TEMU”可筛选包含TEMU的记录">
          <Input placeholder="标签" style={{ width: 140 }} value={searchLabel}
            onChange={e => setSearchLabel(e.target.value)} onPressEnter={handleQuery} allowClear />
        </Tooltip>
        <Tooltip title="按款号模糊搜索">
          <Input placeholder="款号" style={{ width: 120 }} value={searchStyleNo}
            onChange={e => setSearchStyleNo(e.target.value)} onPressEnter={handleQuery} allowClear />
        </Tooltip>
        <Tooltip title="按材质筛选，也可筛选材质为空的记录">
          <Select placeholder="材质" style={{ width: 130 }} value={searchMaterial || undefined}
            onChange={v => setSearchMaterial(v || '')} allowClear showSearch
            options={[
              { value: '__empty__', label: '材质为空' },
              ...allMaterials.map(m => ({ value: m, label: m })),
            ]}
          />
        </Tooltip>
        <Tooltip title="按创建日期范围筛选记录">
          <DatePicker.RangePicker
            value={searchDateRange ? [dayjs(searchDateRange[0]), dayjs(searchDateRange[1])] : null}
            onChange={vals => setSearchDateRange(vals ? [vals[0]!.format('YYYY-MM-DD'), vals[1]!.format('YYYY-MM-DD')] : null)}
            allowClear
            style={{ width: 240 }}
            placeholder={['开始日期', '结束日期']}
          />
        </Tooltip>
        <Tooltip title="应用上方所有筛选条件">
          <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>查询</Button>
        </Tooltip>
        <Tooltip title="清空所有筛选条件并显示全部数据">
          <Button onClick={handleReset}>重置</Button>
        </Tooltip>
        <Tooltip title="手动新增一条导入数据源记录，内部单号、标签为必填">
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增记录</Button>
        </Tooltip>
        <Tooltip title="从Excel批量导入数据，Excel需包含列：内部订单号/内部单号、标签、款号、数量；相同内部单号的数量会自动汇总">
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleImport}><Button icon={<UploadOutlined />}>导入Excel</Button></Upload>
        </Tooltip>
        <Tooltip title="将当前筛选后的所有记录导出为Excel文件">
          <Button icon={<FileExcelOutlined />} onClick={handleExport}>导出Excel</Button>
        </Tooltip>
        <Tooltip title="重新从存储中加载最新数据">
          <Button icon={<ReloadOutlined />} onClick={() => { loadDataset(_olKey(owner)).then(ds => { if (ds?.json) { try { const list = JSON.parse(ds.json) as OrderLabelRecord[]; _olCache = { owner, list }; setRecords(list); message.success(`已刷新，共 ${list.length} 条`); } catch { setRecords(readOLSync(owner)); } } else { setRecords(readOLSync(owner)); } }); }}>刷新</Button>
        </Tooltip>
        {(selectAllFiltered || selectedRowKeys.length > 0) && (
          <Popconfirm title={`确定删除选中的 ${selectAllFiltered ? filtered.length : selectedRowKeys.length} 条记录吗？`} onConfirm={handleBatchDelete} okText="删除" cancelText="取消">
            <Button danger icon={<DeleteOutlined />}>批量删除({selectAllFiltered ? filtered.length : selectedRowKeys.length})</Button>
          </Popconfirm>
        )}
      </Space>
      <div style={{ marginBottom: 4, fontSize: 12, color: '#1890ff', flexShrink: 0 }}>
        {selectAllFiltered ? (
          <span>已全选全部 <b>{filtered.length}</b> 条筛选记录 <a onClick={() => { setSelectedRowKeys([]); setSelectAllFiltered(false); }}>取消选择</a></span>
        ) : (
          selectedRowKeys.length > 0 && selectedRowKeys.length < filtered.length && (
            <span>已选中 <b>{selectedRowKeys.length}</b> 条记录 <a onClick={() => { setSelectedRowKeys(filtered.map(r => r.key)); setSelectAllFiltered(true); }}>全部页全选（共 {filtered.length} 条）</a> | <a onClick={() => setSelectedRowKeys([])}>取消选择</a></span>
          )
        )}
      </div>
      <div ref={tableWrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Table rowKey="key" size="small" bordered columns={wrapOLCols(cols)} dataSource={filtered}
        rowSelection={{
          selectedRowKeys: selectAllFiltered ? filtered.map(r => r.key) : selectedRowKeys,
          onChange: keys => { setSelectedRowKeys(keys); setSelectAllFiltered(false); },
        }}
        scroll={{ x: 900, y: tableScrollY }}
        pagination={{
          current: currentPage,
          pageSize: pageSize,
          showSizeChanger: true,
          showQuickJumper: true,
          pageSizeOptions: ['20', '50', '100', '200'],
          showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
          onChange: (page, size) => { setCurrentPage(page); setPageSize(size); },
          onShowSizeChange: (current, size) => { setPageSize(size); setCurrentPage(1); },
        }}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      />
      </div>
      <Modal title={editing ? '编辑标签记录' : '新增标签记录'} open={visible} onOk={handleSave} onCancel={() => setVisible(false)} okText="保存" cancelText="取消" width={520} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="orderNo" label="内部订单号" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 1231" /></Form.Item></Col>
            <Col span={12}><Form.Item name="label" label="标签" rules={[{ required: true, message: '必填' }]}><Input placeholder="如 洞洞鞋棉鞋" onChange={e => { const mat = matchMaterial(e.target.value); if (mat) form.setFieldValue('material', mat); }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="styleNo" label="款号"><Input placeholder="如 9001" /></Form.Item></Col>
            <Col span={12}><Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="material" label="材质"><Select showSearch allowClear options={materials.map(x => ({ value: x, label: x }))} placeholder="自动匹配或手动选择" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
      {/* 导入进度弹窗 */}
      <Modal title="导入进度" open={importing} footer={null} closable={false} maskClosable={false} width={480}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>字段匹配：</div>
          <div style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: 4, fontSize: 13 }}>
            <div>内部订单号 / 内部单号 → 内部订单号</div>
            <div>标签 → 标签</div>
            <div>款号 → 款号</div>
            <div>数量 → 数量（相同单号汇总）</div>
            <div>材质 → 材质（自动从标签匹配）</div>
          </div>
        </div>
        <Progress percent={importProgress} status={importProgress === 100 ? 'success' : 'active'} />
        <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
          共 {importStats.total} 组，已处理 {importStats.processed} 组，新增 {importStats.added} 条，覆盖 {importStats.updated} 条
        </div>
      </Modal>
    </div>
  );
};

// ============ 数据分析 ============
const DA_COLORS = ['#1e4a7e', '#52c41a', '#ff4d4f', '#faad14', '#13c2c2', '#722ed1', '#eb2f96', '#2f54eb', '#a0d911', '#fa8c16', '#1890ff', '#597ef7'];
const DA_CARD: React.CSSProperties = { borderRadius: 12, border: 'none', background: '#fff' };

const DataAnalysisTab: React.FC = () => {
  const owner = getDataOwner();
  const sk = SK(owner);
  const [stockRecords] = useState<StockRecord[]>(() => safeJson<StockRecord[]>(sk.stock, []));
  const [urgentRecords] = useState<UrgentRecord[]>(() => safeJson<UrgentRecord[]>(sk.urgent, []));
  const [monthFilter, setMonthFilter] = useState<string>('');

  // 所有月份选项
  const allMonths = useMemo(() => {
    const s = new Set<string>();
    stockRecords.forEach(r => { if (r.month) s.add(r.month); });
    urgentRecords.forEach(r => { if (r.month) s.add(r.month); });
    return Array.from(s).sort().reverse();
  }, [stockRecords, urgentRecords]);

  // 按月份过滤
  const stocks = useMemo(() => monthFilter ? stockRecords.filter(r => r.month === monthFilter) : stockRecords, [stockRecords, monthFilter]);
  const urgents = useMemo(() => monthFilter ? urgentRecords.filter(r => r.month === monthFilter) : urgentRecords, [urgentRecords, monthFilter]);

  // ====== 概览统计 ======
  const overview = useMemo(() => {
    const stockQty = stocks.reduce((s, r) => s + r.quantity, 0);
    const urgentQty = urgents.reduce((s, r) => s + r.quantity, 0);
    const qcWage = stocks.reduce((s, r) => s + r.qcWage, 0);
    const packWage = stocks.reduce((s, r) => s + r.packWage, 0);
    const commission = stocks.reduce((s, r) => s + r.commission, 0);
    const urgentWage = urgents.reduce((s, r) => s + r.wage, 0);
    const urgentPackWage = urgents.reduce((s, r) => s + r.packWage, 0);
    const urgentCommission = urgents.reduce((s, r) => s + r.commission, 0);
    return { stockQty, urgentQty, stockCount: stocks.length, urgentCount: urgents.length, qcWage, packWage, commission, urgentWage, urgentPackWage, urgentCommission, totalWage: qcWage + packWage + commission + urgentWage + urgentPackWage + urgentCommission };
  }, [stocks, urgents]);

  // ====== 月度趋势 ======
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { month: string; stockQty: number; urgentQty: number; stockCount: number; urgentCount: number; qcWage: number; packWage: number; commission: number; totalWage: number }>();
    stockRecords.forEach(r => {
      if (!r.month) return;
      const d = map.get(r.month) || { month: r.month, stockQty: 0, urgentQty: 0, stockCount: 0, urgentCount: 0, qcWage: 0, packWage: 0, commission: 0, totalWage: 0 };
      d.stockQty += r.quantity; d.stockCount += 1; d.qcWage += r.qcWage; d.packWage += r.packWage; d.commission += r.commission;
      map.set(r.month, d);
    });
    urgentRecords.forEach(r => {
      if (!r.month) return;
      const d = map.get(r.month) || { month: r.month, stockQty: 0, urgentQty: 0, stockCount: 0, urgentCount: 0, qcWage: 0, packWage: 0, commission: 0, totalWage: 0 };
      d.urgentQty += r.quantity; d.urgentCount += 1;
      map.set(r.month, d);
    });
    const list = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
    list.forEach(d => { d.totalWage = d.qcWage + d.packWage + d.commission; });
    return list;
  }, [stockRecords, urgentRecords]);

  // ====== 材质分布 ======
  const materialDist = useMemo(() => {
    const map = new Map<string, number>();
    stocks.forEach(r => { const m = r.material || '未设置'; map.set(m, (map.get(m) || 0) + r.quantity); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [stocks]);

  // ====== 比对结果分布 ======
  const compareResult = useMemo(() => {
    // 需要导入数据源来算比对结果
    const olRecords = readOLSync(owner);
    const labelQtyMap: Record<string, number> = {};
    olRecords.forEach(r => { if (r.orderNo) labelQtyMap[r.orderNo] = (labelQtyMap[r.orderNo] || 0) + r.quantity; });
    // 备货单按单号汇总数量
    const stockQtyMap: Record<string, number> = {};
    stocks.forEach(r => { if (r.orderNo) stockQtyMap[r.orderNo] = (stockQtyMap[r.orderNo] || 0) + r.quantity; });
    let overCount = 0, matchCount = 0, underCount = 0, noSource = 0;
    Object.keys(stockQtyMap).forEach(orderNo => {
      const stockQty = stockQtyMap[orderNo];
      const labelQty = labelQtyMap[orderNo];
      if (labelQty === undefined) noSource++;
      else if (stockQty > labelQty) overCount++;
      else if (stockQty === labelQty) matchCount++;
      else underCount++;
    });
    return { overCount, matchCount, underCount, noSource };
  }, [stocks, owner]);

  // ====== 人员工作量 ======
  const personnelRank = useMemo(() => {
    const inspMap = new Map<string, { name: string; count: number; qty: number; wage: number }>();
    stocks.forEach(r => {
      if (!r.qcInspector) return;
      const d = inspMap.get(r.qcInspector) || { name: r.qcInspector, count: 0, qty: 0, wage: 0 };
      d.count++; d.qty += r.quantity; d.wage += r.qcWage;
      inspMap.set(r.qcInspector, d);
    });
    const packerMap = new Map<string, { name: string; count: number; qty: number; wage: number }>();
    stocks.forEach(r => {
      if (!r.packer) return;
      const d = packerMap.get(r.packer) || { name: r.packer, count: 0, qty: 0, wage: 0 };
      d.count++; d.qty += r.quantity; d.wage += r.packWage;
      packerMap.set(r.packer, d);
    });
    const teamMap = new Map<string, { name: string; count: number; qty: number; wage: number }>();
    stocks.forEach(r => {
      if (!r.foreignTeam) return;
      const d = teamMap.get(r.foreignTeam) || { name: r.foreignTeam, count: 0, qty: 0, wage: 0 };
      d.count++; d.qty += r.quantity; d.wage += r.commission;
      teamMap.set(r.foreignTeam, d);
    });
    return {
      inspectors: Array.from(inspMap.values()).sort((a, b) => b.qty - a.qty),
      packers: Array.from(packerMap.values()).sort((a, b) => b.qty - a.qty),
      teams: Array.from(teamMap.values()).sort((a, b) => b.qty - a.qty),
    };
  }, [stocks]);

  // ====== 急采材质分布 ======
  const urgentMaterialDist = useMemo(() => {
    const map = new Map<string, number>();
    urgents.forEach(r => { const m = r.material || '未设置'; map.set(m, (map.get(m) || 0) + r.quantity); });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [urgents]);

  // ====== 货号销售排行 ======
  const productRank = useMemo(() => {
    const map = new Map<string, { productCode: string; material: string; count: number; qty: number; qcWage: number; packWage: number; commission: number; totalWage: number }>();
    stocks.forEach(r => {
      if (!r.productCode) return;
      const d = map.get(r.productCode) || { productCode: r.productCode, material: r.material || '', count: 0, qty: 0, qcWage: 0, packWage: 0, commission: 0, totalWage: 0 };
      d.count++; d.qty += r.quantity; d.qcWage += r.qcWage; d.packWage += r.packWage; d.commission += r.commission;
      if (r.material && !d.material) d.material = r.material;
      map.set(r.productCode, d);
    });
    const list = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    list.forEach(d => { d.totalWage = d.qcWage + d.packWage + d.commission; });
    return list;
  }, [stocks]);

  // ====== 质检员每日统计（最近30天） ======
  const inspectorDailyChart = useMemo(() => {
    const thirtyDaysAgo = dayjs().subtract(29, 'day').format('YYYY-MM-DD');
    // 获取所有质检员列表
    const inspectorSet = new Set<string>();
    stocks.forEach(r => { if (r.qcInspector && r.date && r.date >= thirtyDaysAgo) inspectorSet.add(r.qcInspector); });
    const inspectors = Array.from(inspectorSet);
    // 按日期+质检员汇总
    const map = new Map<string, Record<string, number>>();
    stocks.forEach(r => {
      if (!r.qcInspector || !r.date || r.date < thirtyDaysAgo) return;
      if (!map.has(r.date)) map.set(r.date, {});
      const row = map.get(r.date)!;
      row[r.qcInspector] = (row[r.qcInspector] || 0) + r.quantity;
    });
    // 填充日期序列
    const dates: string[] = [];
    for (let i = 29; i >= 0; i--) {
      dates.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
    }
    return { dates, inspectors, map };
  }, [stocks]);

  const inspectorDailyChartOpt = useMemo(() => {
    const { dates, inspectors, map } = inspectorDailyChart;
    const colors = ['#1e4a7e', '#52c41a', '#ff4d4f', '#faad14', '#13c2c2', '#722ed1', '#eb2f96', '#2f54eb', '#a0d911', '#fa8c16', '#1890ff', '#597ef7'];
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { data: inspectors, top: 0, type: 'scroll' as const },
      grid: { left: 50, right: 20, top: 40, bottom: 60 },
      xAxis: { type: 'category' as const, data: dates.map(d => d.slice(5)), axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: { type: 'value' as const, name: '双数' },
      series: inspectors.map((name, idx) => ({
        name,
        type: 'bar' as const,
        data: dates.map(d => {
          const row = map.get(d);
          return row ? (row[name] || 0) : 0;
        }),
        itemStyle: { color: colors[idx % colors.length] },
        barMaxWidth: 16,
        label: { show: inspectors.length <= 6, position: 'top' as const, fontSize: 9, formatter: (p: any) => p.value > 0 ? p.value : '' },
      })),
    };
  }, [inspectorDailyChart]);

  // ====== 月度明细表 ======
  const monthlyTable = useMemo(() => {
    return monthlyTrend.map(d => ({
      key: d.month, month: d.month,
      stockCount: d.stockCount, stockQty: d.stockQty,
      urgentCount: d.urgentCount, urgentQty: d.urgentQty,
      qcWage: d.qcWage, packWage: d.packWage, commission: d.commission, totalWage: d.totalWage,
    })).reverse();
  }, [monthlyTrend]);

  // ====== 图表配置 ======
  // 月度数量趋势 - 双柱图
  const monthlyQtyOpt = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['备货单数量', '急采单数量'], top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category' as const, data: monthlyTrend.map(d => d.month), axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value' as const, name: '双数' },
    series: [
      { name: '备货单数量', type: 'bar', data: monthlyTrend.map(d => d.stockQty), itemStyle: { color: '#1e4a7e' }, barMaxWidth: 30 },
      { name: '急采单数量', type: 'bar', data: monthlyTrend.map(d => d.urgentQty), itemStyle: { color: '#ff4d4f' }, barMaxWidth: 30 },
    ],
  }), [monthlyTrend]);

  // 月度工资趋势 - 折线图
  const monthlyWageOpt = useMemo(() => ({
    tooltip: { trigger: 'axis' as const, formatter: (params: any) => params.map((p: any) => `${p.seriesName}: ¥${p.value.toFixed(2)}`).join('<br/>') },
    legend: { data: ['质检工资', '打包工资', '外贸组长工资', '合计'], top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category' as const, data: monthlyTrend.map(d => d.month), axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value' as const, name: '元', axisLabel: { formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}w` : `${v}` } },
    series: [
      { name: '质检工资', type: 'line', data: monthlyTrend.map(d => d.qcWage), smooth: true, itemStyle: { color: '#1e4a7e' } },
      { name: '打包工资', type: 'line', data: monthlyTrend.map(d => d.packWage), smooth: true, itemStyle: { color: '#52c41a' } },
      { name: '外贸组长工资', type: 'line', data: monthlyTrend.map(d => d.commission), smooth: true, itemStyle: { color: '#faad14' } },
      { name: '合计', type: 'line', data: monthlyTrend.map(d => d.totalWage), smooth: true, lineStyle: { width: 3 }, itemStyle: { color: '#ff4d4f' } },
    ],
  }), [monthlyTrend]);

  // 材质分布饼图
  const materialPieOpt = useMemo(() => ({
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c}双 ({d}%)' },
    legend: { type: 'scroll' as const, orient: 'vertical' as const, right: 10, top: 20, bottom: 20 },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['40%', '50%'],
      label: { show: false }, emphasis: { label: { show: true, fontWeight: 'bold' } },
      data: materialDist.map((d, i) => ({ value: d[1], name: d[0], itemStyle: { color: DA_COLORS[i % DA_COLORS.length] } })),
    }],
  }), [materialDist]);

  // 急采材质分布饼图
  const urgentMaterialPieOpt = useMemo(() => ({
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c}双 ({d}%)' },
    legend: { type: 'scroll' as const, orient: 'vertical' as const, right: 10, top: 20, bottom: 20 },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['40%', '50%'],
      label: { show: false }, emphasis: { label: { show: true, fontWeight: 'bold' } },
      data: urgentMaterialDist.map((d, i) => ({ value: d[1], name: d[0], itemStyle: { color: DA_COLORS[i % DA_COLORS.length] } })),
    }],
  }), [urgentMaterialDist]);

  // 比对结果饼图
  const comparePieOpt = useMemo(() => ({
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c}单 ({d}%)' },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '55%'],
      label: { formatter: '{b}\n{c}单 ({d}%)' },
      data: [
        { value: compareResult.overCount, name: '超记', itemStyle: { color: '#ff4d4f' } },
        { value: compareResult.matchCount, name: '一致', itemStyle: { color: '#52c41a' } },
        { value: compareResult.underCount, name: '少于', itemStyle: { color: '#faad14' } },
        { value: compareResult.noSource, name: '无源', itemStyle: { color: '#bfbfbf' } },
      ],
    }],
  }), [compareResult]);

  // 质检员排名横向柱图
  const inspectorBarOpt = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    grid: { left: 80, right: 55, top: 10, bottom: 25 },
    xAxis: { type: 'value' as const, name: '双数', nameLocation: 'start' as const, nameGap: 8 },
    yAxis: { type: 'category' as const, data: personnelRank.inspectors.slice(0, 10).map(d => d.name).reverse(), axisLabel: { fontSize: 11 } },
    series: [{ type: 'bar', data: personnelRank.inspectors.slice(0, 10).map(d => d.qty).reverse(), itemStyle: { color: '#1e4a7e' }, barMaxWidth: 20, label: { show: true, position: 'right' as const, formatter: '{c}双' } }],
  }), [personnelRank.inspectors]);

  // 打包员排名横向柱图
  const packerBarOpt = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    grid: { left: 80, right: 55, top: 10, bottom: 25 },
    xAxis: { type: 'value' as const, name: '双数', nameLocation: 'start' as const, nameGap: 8 },
    yAxis: { type: 'category' as const, data: personnelRank.packers.slice(0, 10).map(d => d.name).reverse(), axisLabel: { fontSize: 11 } },
    series: [{ type: 'bar', data: personnelRank.packers.slice(0, 10).map(d => d.qty).reverse(), itemStyle: { color: '#52c41a' }, barMaxWidth: 20, label: { show: true, position: 'right' as const, formatter: '{c}双' } }],
  }), [personnelRank.packers]);

  // 外贸组长排名横向柱图
  const teamBarOpt = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    grid: { left: 80, right: 55, top: 10, bottom: 25 },
    xAxis: { type: 'value' as const, name: '双数', nameLocation: 'start' as const, nameGap: 8 },
    yAxis: { type: 'category' as const, data: personnelRank.teams.slice(0, 10).map(d => d.name).reverse(), axisLabel: { fontSize: 11 } },
    series: [{ type: 'bar', data: personnelRank.teams.slice(0, 10).map(d => d.qty).reverse(), itemStyle: { color: '#faad14' }, barMaxWidth: 20, label: { show: true, position: 'right' as const, formatter: '{c}双' } }],
  }), [personnelRank.teams]);

  // 货号销售排行横向柱图
  const productRankBarOpt = useMemo(() => {
    const top15 = productRank.slice(0, 15);
    return {
      tooltip: { trigger: 'axis' as const },
      grid: { left: 70, right: 80, top: 10, bottom: 25 },
      xAxis: { type: 'value' as const, name: '双数', nameLocation: 'end' as const, nameGap: 8 },
      yAxis: { type: 'category' as const, data: top15.map(d => d.productCode).reverse(), axisLabel: { fontSize: 11 } },
      series: [{ type: 'bar', data: top15.map(d => d.qty).reverse(), itemStyle: { color: '#2f54eb' }, barMaxWidth: 20, label: { show: true, position: 'right' as const, formatter: '{c}双' } }],
    };
  }, [productRank]);

  const fmtY = (v: number) => `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sectionTitle = (icon: React.ReactNode, title: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ color: '#1e4a7e', fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{title}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: '0 4px' }}>
      {/* 顶部筛选 */}
      <div style={{ marginBottom: 16, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 500 }}>统计月份：</span>
        <Select style={{ width: 140 }} value={monthFilter} onChange={setMonthFilter} allowClear placeholder="全部月份"
          options={allMonths.map(m => ({ value: m, label: m }))} />
        {monthFilter && <Tag color="blue">已筛选: {monthFilter}</Tag>}
        <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 'auto' }}>
          数据范围：备货单 {stocks.length} 条 / 急采单 {urgents.length} 条
        </span>
      </div>

      {/* 概览卡片 */}
      {sectionTitle(<FundOutlined />, '数据概览')}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col xs={6}><Card size="small" style={{ ...DA_CARD, borderTop: '3px solid #1e4a7e' }}>
          <Statistic title="备货总量" value={overview.stockQty} suffix="双" valueStyle={{ color: '#1e4a7e' }} />
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>共 {overview.stockCount} 条记录</div>
        </Card></Col>
        <Col xs={6}><Card size="small" style={{ ...DA_CARD, borderTop: '3px solid #ff4d4f' }}>
          <Statistic title="急采总量" value={overview.urgentQty} suffix="双" valueStyle={{ color: '#ff4d4f' }} />
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>共 {overview.urgentCount} 条记录</div>
        </Card></Col>
        <Col xs={6}><Card size="small" style={{ ...DA_CARD, borderTop: '3px solid #52c41a' }}>
          <Statistic title="工资总额" value={overview.totalWage} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>质检 ¥{overview.qcWage.toFixed(0)} | 打包 ¥{overview.packWage.toFixed(0)} | 组长 ¥{overview.commission.toFixed(0)}</div>
        </Card></Col>
        <Col xs={6}><Card size="small" style={{ ...DA_CARD, borderTop: '3px solid #faad14' }}>
          <Statistic title="急采占比" value={overview.stockQty > 0 ? (overview.urgentQty / overview.stockQty * 100) : 0} precision={1} suffix="%" valueStyle={{ color: '#faad14' }} />
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>急采/备货数量比</div>
        </Card></Col>
      </Row>

      {/* 月度趋势 */}
      {monthlyTrend.length > 0 && <>
        {sectionTitle(<RiseOutlined />, '月度趋势')}
        <Row gutter={12} style={{ marginBottom: 20 }}>
          <Col xs={24} md={12}>
            <Card size="small" style={DA_CARD}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>备货 vs 急采 月度数量</div>
              <ReactECharts option={monthlyQtyOpt} style={{ height: 300 }} />
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card size="small" style={DA_CARD}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>月度工资走势</div>
              <ReactECharts option={monthlyWageOpt} style={{ height: 300 }} />
            </Card>
          </Col>
        </Row>
      </>}

      {/* 材质分析 */}
      {sectionTitle(<PieChartOutlined />, '材质分析')}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col xs={24} md={12}>
          <Card size="small" style={DA_CARD}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>备货单材质分布</div>
            {materialDist.length > 0 ? <ReactECharts option={materialPieOpt} style={{ height: 280 }} /> : <Empty description="无材质数据" />}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" style={DA_CARD}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>急采单材质分布</div>
            {urgentMaterialDist.length > 0 ? <ReactECharts option={urgentMaterialPieOpt} style={{ height: 280 }} /> : <Empty description="无材质数据" />}
          </Card>
        </Col>
      </Row>

      {/* 货号销售排行 */}
      {productRank.length > 0 && <>
        {sectionTitle(<FundOutlined />, '货号销售排行')}
        <Row gutter={12} style={{ marginBottom: 20 }}>
          <Col xs={24} md={12}>
            <Card size="small" style={DA_CARD}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>TOP15 货号按备货数量排名</div>
              <ReactECharts option={productRankBarOpt} style={{ height: Math.max(460, productRank.slice(0, 15).length * 32) }} />
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card size="small" style={DA_CARD}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>全部货号明细（共 {productRank.length} 个）</div>
              <Table rowKey="productCode" size="small" bordered
                scroll={{ y: 420 }}
                pagination={false}
                dataSource={productRank.map((d, i) => ({ ...d, rank: i + 1 }))}
                columns={[
                  { title: '排名', dataIndex: 'rank', key: 'rank', width: 55, align: 'center', render: (v: number) => v <= 3 ? <Tag color={v === 1 ? 'red' : v === 2 ? 'orange' : 'blue'}>{v}</Tag> : v },
                  { title: '货号', dataIndex: 'productCode', key: 'productCode', width: 90, align: 'center', render: (v: string) => <b>{v}</b> },
                  { title: '材质', dataIndex: 'material', key: 'material', width: 80, align: 'center' },
                  { title: '单数', dataIndex: 'count', key: 'count', width: 60, align: 'center' },
                  { title: '总数量', dataIndex: 'qty', key: 'qty', width: 80, align: 'right', sorter: (a, b) => a.qty - b.qty, defaultSortOrder: 'descend' as const, render: (v: number) => <span style={{ color: '#1e4a7e', fontWeight: 600 }}>{v}</span> },
                  { title: '工资合计', dataIndex: 'totalWage', key: 'totalWage', width: 90, align: 'right', render: (v: number) => fmtY(v) },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </>}

      {/* 比对结果 + 人员分析 */}
      <Row gutter={12} style={{ marginBottom: 20 }}>
        <Col xs={24} md={8}>
          <Card size="small" style={DA_CARD}>
            {sectionTitle(<CheckCircleOutlined />, '比对结果分布')}
            {(compareResult.overCount + compareResult.matchCount + compareResult.underCount + compareResult.noSource) > 0
              ? <ReactECharts option={comparePieOpt} style={{ height: 260 }} />
              : <Empty description="无比对数据" />}
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card size="small" style={DA_CARD}>
            {sectionTitle(<TeamOutlined />, '人员工作量 TOP10')}
            <Row gutter={8}>
              <Col span={8}>
                <div style={{ fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 4 }}>质检员</div>
                {personnelRank.inspectors.length > 0 ? <ReactECharts option={inspectorBarOpt} style={{ height: Math.max(150, personnelRank.inspectors.slice(0, 10).length * 30) }} /> : <Empty description="无数据" />}
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 4 }}>打包员</div>
                {personnelRank.packers.length > 0 ? <ReactECharts option={packerBarOpt} style={{ height: Math.max(150, personnelRank.packers.slice(0, 10).length * 30) }} /> : <Empty description="无数据" />}
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 4 }}>外贸组长</div>
                {personnelRank.teams.length > 0 ? <ReactECharts option={teamBarOpt} style={{ height: Math.max(150, personnelRank.teams.slice(0, 10).length * 30) }} /> : <Empty description="无数据" />}
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 质检员每日统计 */}
      {inspectorDailyChart.inspectors.length > 0 && <>
        {sectionTitle(<TeamOutlined />, '质检员每日数据统计（最近30天）')}
        <Card size="small" style={{ ...DA_CARD, marginBottom: 20 }}>
          <ReactECharts option={inspectorDailyChartOpt} style={{ height: 420 }} />
        </Card>
      </>}

      {/* 月度明细表 */}
      {sectionTitle(<BarChartOutlined />, '月度明细')}
      <Card size="small" style={{ ...DA_CARD, marginBottom: 20 }}>
        <Table rowKey="key" size="small" bordered pagination={false}
          dataSource={monthlyTable}
          columns={[
            { title: '月份', dataIndex: 'month', key: 'month', width: 100, align: 'center', render: (v: string) => <b>{v}</b> },
            { title: '备货单数', dataIndex: 'stockCount', key: 'stockCount', width: 80, align: 'center' },
            { title: '备货双数', dataIndex: 'stockQty', key: 'stockQty', width: 90, align: 'right', render: (v: number) => <span style={{ color: '#1e4a7e', fontWeight: 600 }}>{v}</span> },
            { title: '急采单数', dataIndex: 'urgentCount', key: 'urgentCount', width: 80, align: 'center' },
            { title: '急采双数', dataIndex: 'urgentQty', key: 'urgentQty', width: 90, align: 'right', render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{v}</span> },
            { title: '质检工资', dataIndex: 'qcWage', key: 'qcWage', width: 100, align: 'right', render: (v: number) => fmtY(v) },
            { title: '打包工资', dataIndex: 'packWage', key: 'packWage', width: 100, align: 'right', render: (v: number) => fmtY(v) },
            { title: '组长工资', dataIndex: 'commission', key: 'commission', width: 100, align: 'right', render: (v: number) => fmtY(v) },
            { title: '工资合计', dataIndex: 'totalWage', key: 'totalWage', width: 110, align: 'right', render: (v: number) => <span style={{ fontWeight: 700, color: '#52c41a' }}>{fmtY(v)}</span> },
          ]}
          summary={(pageData) => {
            const tStock = pageData.reduce((s, r) => s + r.stockQty, 0);
            const tUrgent = pageData.reduce((s, r) => s + r.urgentQty, 0);
            const tQc = pageData.reduce((s, r) => s + r.qcWage, 0);
            const tPack = pageData.reduce((s, r) => s + r.packWage, 0);
            const tComm = pageData.reduce((s, r) => s + r.commission, 0);
            const tTotal = pageData.reduce((s, r) => s + r.totalWage, 0);
            return (
              <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
                <Table.Summary.Cell index={0} align="center"><b>合计</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} /><Table.Summary.Cell index={2} align="right"><b>{tStock}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={3} /><Table.Summary.Cell index={4} align="right"><b>{tUrgent}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">{fmtY(tQc)}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">{fmtY(tPack)}</Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">{fmtY(tComm)}</Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right"><span style={{ fontWeight: 700, color: '#52c41a' }}>{fmtY(tTotal)}</span></Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </Card>
    </div>
  );
};

// ============ 快捷时间按钮组件 ============
const QuickRangeBar: React.FC = () => {
  const { quickRange, setQuickRange } = useWarehouseCtx();
  return (
    <Space style={{ marginBottom: 8, flexShrink: 0 }}>
      <CalendarOutlined style={{ color: '#8c8c8c' }} />
      {(['today', 'yesterday', 'thisMonth', 'lastMonth'] as QuickRange[]).map(t => (
        <Button key={t} size="small"
          type={quickRange === t ? 'primary' : 'default'}
          onClick={() => setQuickRange(quickRange === t ? '' : t)}>
          {QUICK_LABELS[t]}
        </Button>
      ))}
      {quickRange && <Button size="small" type="link" onClick={() => setQuickRange('')}>清除</Button>}
    </Space>
  );
};

// ============ 主页面 ============
const WarehouseStatsPage: React.FC = () => {
  const owner = getDataOwner();
  const managersKey = `ws_managers_${owner}`;

  // 负责人设置状态（兼容旧数据）
  const [viewManagers, setViewManagers] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(managersKey) || 'null');
      if (Array.isArray(raw)) return raw; // 兼容旧格式：旧数组作为查看权限
      return raw?.viewManagers || [];
    } catch { return []; }
  });
  const [editManagers, setEditManagers] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(managersKey) || 'null');
      if (Array.isArray(raw)) return raw; // 兼容旧格式：旧数组作为编辑权限
      return raw?.editManagers || [];
    } catch { return []; }
  });
  const [managersVisible, setManagersVisible] = useState(false);
  const [draftView, setDraftView] = useState<string[]>([]);
  const [draftEdit, setDraftEdit] = useState<string[]>([]);
  const [quickRange, setQuickRange] = useState<QuickRange>('');

  // 用户列表（本租户）
  const allUserOptions = useMemo(() => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const resolveOwner = (u: any): string => {
        if (!u.isSubAccount || !u.parentAccount) return u.username;
        const visited = new Set<string>();
        let cur = u.parentAccount;
        while (cur && !visited.has(cur)) {
          visited.add(cur);
          const parent = users.find((x: any) => x.username === cur);
          if (!parent || !parent.isSubAccount) return cur;
          cur = parent.parentAccount || '';
        }
        return cur || u.username;
      };
      return users
        .filter((u: any) => resolveOwner(u) === owner || u.username === owner)
        .map((u: any) => ({ username: u.username, displayName: `${u.displayName || u.contactPerson || u.name || u.username} (${u.username})` }));
    } catch { return []; }
  }, [owner]);

  // 保存负责人
  const saveManagers = () => {
    setViewManagers(draftView);
    setEditManagers(draftEdit);
    const data = { viewManagers: draftView, editManagers: draftEdit };
    try { localStorage.setItem(managersKey, JSON.stringify(data)); } catch { /* ignore */ }
    message.success('负责人设置已保存');
    setManagersVisible(false);
  };

  // 负责人显示名称
  const managerDisplayNames = useMemo(() => {
    const allSet = new Set<string>();
    viewManagers.forEach(u => allSet.add(u));
    editManagers.forEach(u => allSet.add(u));
    const all = Array.from(allSet);
    if (all.length === 0) return '未设置';
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return all.map(un => {
        const u = users.find((x: any) => x.username === un);
        return u?.displayName || u?.contactPerson || u?.name || un;
      }).join('、');
    } catch { return all.join('、'); }
  }, [viewManagers, editManagers]);

  const tabItems = [
    { key: 'stock', label: <span><FileTextOutlined /> 备货单统计</span>, children: <StockTab /> },
    { key: 'pick', label: <span><CheckCircleOutlined /> 配货统计</span>, children: <PickTab /> },
    { key: 'urgent', label: <span><BarChartOutlined /> 急采统计</span>, children: <UrgentTab /> },
    { key: 'wage', label: <span><DollarOutlined /> 工价管理</span>, children: <WageTab /> },
    { key: 'group', label: <span><TeamOutlined /> 分组</span>, children: <GroupTab /> },
    { key: 'note', label: <span><FileTextOutlined /> 奖惩记录</span>, children: <NoteTab /> },
    { key: 'salary', label: <span><BarChartOutlined /> 工资汇总</span>, children: <SalaryTab /> },
    { key: 'orderLabel', label: <span><TagsOutlined /> 导入数据源 <Tooltip placement="bottomLeft" title={<ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: '20px' }}><li>备货单统计：「更新信息→更新材质」按内部单号匹配并回填材质、货号；「更新比对结果」按内部单号比对数量生成超记/一致/少于/无源四态及「导入数据源数量」统计值；材质筛选项依赖回填的材质</li><li>急采统计：同备货单统计，支持更新材质与更新比对结果</li><li>数据分析：「比对结果分布」图表基于本数据源与备货单的数量比对结果统计</li><li>若本数据源缺失或未更新，上述功能将显示「无源」或材质为空，请及时导入/维护最新数据</li></ul>}><QuestionCircleOutlined style={{ color: '#bfbfbf', cursor: 'help' }} /></Tooltip></span>, children: <OrderLabelTab /> },
    { key: 'analysis', label: <span><FundOutlined /> 数据分析</span>, children: <DataAnalysisTab /> },
  ];

  return (
    <WarehouseCtx.Provider value={{ viewManagers, editManagers, quickRange, setQuickRange }}>
    <div style={{ padding: 16, background: '#f5f7fa', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ marginBottom: 16, flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e4a7e' }}>
            <AppstoreOutlined style={{ marginRight: 8 }} />仓库统计表
          </h2>
          <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>质检数量登记 · 拣货配货统计 · 计件工资自动计算</div>
        </div>
        {isAdmin && (
          <Space>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>负责人：{managerDisplayNames}</span>
            <Tooltip title="设置各页面的查看和编辑权限：查看负责人可看到全部记录，编辑负责人可编辑他人创建的记录，未设置时所有人可见可编辑">
              <Button icon={<TeamOutlined />} onClick={() => { setDraftView([...viewManagers]); setDraftEdit([...editManagers]); setManagersVisible(true); }}>负责人设置</Button>
            </Tooltip>
          </Space>
        )}
      </div>
      <Tabs defaultActiveKey="stock" items={tabItems} size="large" className="wh-stats-tabs" style={{ background: '#fff', borderRadius: 12, padding: '0 16px 16px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} />
      {/* 负责人设置弹窗 */}
      <Modal
        title={<span><TeamOutlined style={{ marginRight: 8, color: '#1e4a7e' }} />负责人设置</span>}
        open={managersVisible}
        onCancel={() => setManagersVisible(false)}
        onOk={saveManagers}
        width={560}
      >
        <div style={{ marginBottom: 12, color: '#8c8c8c', fontSize: 12 }}>
          <div>· <b>查看权限</b>：可查看全部记录（统计栏同步），但不能编辑/删除他人创建的记录</div>
          <div>· <b>编辑权限</b>：可查看全部记录，且可编辑/删除他人创建的记录</div>
          <div>· 管理员始终拥有全部权限。未设置时所有人可见全部记录。</div>
        </div>
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
          <div style={{ fontSize: 12, color: '#389e0d', fontWeight: 600, marginBottom: 4 }}>已接入负责人权限的页面：</div>
          <Space size={4} wrap>
            <Tag color="green">备货单统计</Tag>
            <Tag color="green">配货统计</Tag>
            <Tag color="green">急采统计</Tag>
            <Tag color="green">工资汇总</Tag>
          </Space>
        </div>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 4 }}>
          <div style={{ display: 'flex', background: '#fafafa', borderBottom: '1px solid #f0f0f0', padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>
            <div style={{ flex: 1 }}>人员</div>
            <div style={{ width: 70, textAlign: 'center' }}>查看</div>
            <div style={{ width: 70, textAlign: 'center' }}>编辑</div>
          </div>
          {allUserOptions.map(u => (
            <div key={u.username} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ flex: 1, fontSize: 13 }}>{u.displayName}</div>
              <div style={{ width: 70, textAlign: 'center' }}>
                <input type="checkbox"
                  checked={draftView.includes(u.username)}
                  onChange={e => {
                    if (e.target.checked) {
                      setDraftView(prev => [...prev, u.username]);
                    } else {
                      setDraftView(prev => prev.filter(x => x !== u.username));
                      // 取消查看时自动取消编辑
                      setDraftEdit(prev => prev.filter(x => x !== u.username));
                    }
                  }}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
              </div>
              <div style={{ width: 70, textAlign: 'center' }}>
                <input type="checkbox"
                  checked={draftEdit.includes(u.username)}
                  onChange={e => {
                    if (e.target.checked) {
                      setDraftEdit(prev => [...prev, u.username]);
                      // 勾选编辑时自动勾选查看
                      setDraftView(prev => prev.includes(u.username) ? prev : [...prev, u.username]);
                    } else {
                      setDraftEdit(prev => prev.filter(x => x !== u.username));
                    }
                  }}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
    </WarehouseCtx.Provider>
  );
};

export default WarehouseStatsPage;
