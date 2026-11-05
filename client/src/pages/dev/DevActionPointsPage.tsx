import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Space, Select, DatePicker, Modal, Form, Input, InputNumber, message, Tag, Radio } from 'antd';
import { SearchOutlined, UndoOutlined, GiftOutlined, FileTextOutlined, SettingOutlined, BarChartOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  loadPointRecords, loadPlatformPointRecords, savePlatformPointRecords,
  loadPlatformStaffList, platformKey, getDevIdentity,
} from '../../utils/devStore';
import type { DevPointRecord, AnalyticsPlatform } from '../../utils/devStore';

const SCORE_ITEM_OPTIONS = [
  { key: 'sales-amount', label: '销售额', source: '月末盘点-发货金额' },
  { key: 'sales-qty', label: '销售件数', source: '月末盘点-发货金额' },
  { key: 'profit', label: '利润', source: '月利润表' },
  { key: 'listing-qty', label: '上架数量', source: '新款列表' },
];

const COL_COLORS = ['#eff6ff', '#ecfdf5', '#fffbeb', '#faf5ff', '#fdf2f8', '#ecfeff', '#fff7ed', '#f7fee7'];
const COL_TEXT_COLORS = ['#1d4ed8', '#047857', '#b45309', '#6d28d9', '#be185d', '#0e7490', '#c2410c', '#4d7c0f'];

const MANUAL_TYPE_OPTIONS = [
  { value: 'manual-reward', label: '手动奖励' },
  { value: 'manual-penalty', label: '手动扣除' },
];

const ACTION_TYPE_OPTIONS = [
  ...SCORE_ITEM_OPTIONS.map(o => ({ value: o.key, label: o.label })),
  ...MANUAL_TYPE_OPTIONS,
];

// 兼容旧数据：listing-rate → listing-qty
const normalizeType = (t: string) => t === 'listing-rate' ? 'listing-qty' : t;
const typeLabel = (t: string) => ACTION_TYPE_OPTIONS.find(o => o.value === normalizeType(t))?.label || t;

// 开发者后台 - 业绩分析 - 积分明细
const DevActionPointsPage: React.FC<{ platform?: AnalyticsPlatform }> = ({ platform = 'dev' }) => {
  const [records, setRecords] = useState<DevPointRecord[]>([]);
  // 负责人设置（与积分兑换页共享同一存储键）
  const identity = platform === 'dev' ? getDevIdentity() : { user: localStorage.getItem('username') || '', name: localStorage.getItem('displayName') || localStorage.getItem('username') || '', isSub: false, parent: '' };
  const isMain = platform === 'dev' ? identity.user === 'dev' : localStorage.getItem('isSubAccount') !== 'true';
  const ownerKey = useMemo(() => {
    if (platform === 'dev') return 'dev';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || identity.user) : identity.user;
  }, [platform, identity.user]);
  const managersKey = `points_managers_${ownerKey}`;
  const [managers, setManagers] = useState<string[]>([]);
  const [mgrModalOpen, setMgrModalOpen] = useState(false);
  const [mgrSelected, setMgrSelected] = useState<string[]>([]);
  // 判断是否为负责人
  const isManager = useMemo(() => {
    if (isMain) return true;
    if (managers.length === 0) return true;
    return managers.includes(identity.user);
  }, [isMain, managers, identity.user]);
  // 积分系数配置（与绩效考核页共享同一 localStorage key）
  const COEFF_KEY = platformKey(platform, 'performance_point_coefficients');
  const SCORE_KEY = platformKey(platform, 'performance_scores_v2');
  const [coeffLocked, setCoeffLocked] = useState(true);
  const [pointCoefficients, setPointCoefficients] = useState<Record<string, number>>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(COEFF_KEY) || '');
      if (s && typeof s === 'object') {
        // 兼容旧key：listing-rate → listing-qty
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
  const [scoreColumns, setScoreColumns] = useState<string[]>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SCORE_KEY) || '');
      if (s?.columns?.length) {
        // 兼容旧key：listing-rate → listing-qty
        return s.columns.map((c: string) => c === 'listing-rate' ? 'listing-qty' : c);
      }
    } catch { /* ignore */ }
    return ['sales-amount', 'sales-qty', 'profit', 'listing-qty'];
  });
  // 积分列表筛选（输入/应用双状态）
  const [fStaff, setFStaff] = useState(''); const [aStaff, setAStaff] = useState('');
  const [fType, setFType] = useState(''); const [aType, setAType] = useState('');
  const [fMonth, setFMonth] = useState(''); const [aMonth, setAMonth] = useState('');
  const [fFrom, setFFrom] = useState(''); const [aFrom, setAFrom] = useState('');
  const [fTo, setFTo] = useState(''); const [aTo, setATo] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm] = Form.useForm();

  const staffList = useMemo(() => loadPlatformStaffList(platform), [platform]);

  const load = useCallback(() => {
    setRecords(platform === 'dev' ? loadPointRecords() : loadPlatformPointRecords(platform));
    // 同步读取最新考核项目列（可能在绩效考核页有增删）
    try {
      const s = JSON.parse(localStorage.getItem(SCORE_KEY) || '');
      if (s?.columns?.length) setScoreColumns(s.columns.map((c: string) => c === 'listing-rate' ? 'listing-qty' : c));
    } catch { /* ignore */ }
    // 加载负责人设置
    try { setManagers(JSON.parse(localStorage.getItem(managersKey) || '[]')); } catch { /* ignore */ }
  }, [platform, managersKey]);
  useEffect(() => { load(); }, [load]);

  // ============ 运营积分统计 ============
  const staffStats = useMemo(() => {
    const rows = staffList.map(s => {
      const mine = records.filter(r => r.staffName === s.name);
      const byType = new Map<string, { points: number; count: number }>();
      mine.forEach(r => {
        const normalizedType = normalizeType(r.actionType);
        const cur = byType.get(normalizedType) || { points: 0, count: 0 };
        cur.points += r.points; cur.count++;
        byType.set(normalizedType, cur);
      });
      return { key: s.id, name: s.name, byType, total: mine.reduce((a, r) => a + r.points, 0) };
    });
    const sums = new Map<string, { points: number; count: number }>();
    let grand = 0;
    rows.forEach(r => {
      grand += r.total;
      r.byType.forEach((v, k) => {
        const cur = sums.get(k) || { points: 0, count: 0 };
        cur.points += v.points; cur.count += v.count;
        sums.set(k, cur);
      });
    });
    return { rows, sums, grand };
  }, [staffList, records]);

  // ============ 积分列表 ============
  const filteredRecords = useMemo(() => records.filter(r => {
    const recMonth = (r.actionTitle || '').substring(0, 7) || dayjs(r.createdAt).format('YYYY-MM');
    return (!aStaff || r.staffName === aStaff) && (!aType || normalizeType(r.actionType) === aType) &&
      (!aMonth || recMonth === aMonth) &&
      (!aFrom || r.createdAt >= aFrom) && (!aTo || r.createdAt <= aTo + 'T23:59:59');
  }), [records, aStaff, aType, aMonth, aFrom, aTo]);

  const handleAdjust = () => {
    adjustForm.validateFields().then(values => {
      const staff = staffList.find(s => s.id === values.staffId);
      const entry: DevPointRecord = {
        id: `pr_${Date.now()}`,
        staffName: staff?.name || values.staffId,
        actionType: values.type === 'reward' ? 'manual-reward' : 'manual-penalty',
        actionTitle: values.type === 'reward' ? '手动奖励' : '手动扣除',
        points: values.type === 'reward' ? Math.abs(Number(values.points)) : -Math.abs(Number(values.points)),
        reason: values.reason || '',
        orderNo: values.orderNo || '',
        buyerName: values.buyerName || '',
        triggerStage: 1,
        createdAt: dayjs().format('YYYY-MM-DD'),
      };
      savePlatformPointRecords(platform, [entry, ...(platform === 'dev' ? loadPointRecords() : loadPlatformPointRecords(platform))]);
      message.success(`${entry.actionTitle} ${Math.abs(entry.points)} 积分已记入「${entry.staffName}」`);
      setAdjustOpen(false);
      adjustForm.resetFields();
      load();
    }).catch(() => message.warning('请完善运营人员与积分'));
  };

  const thStyle: React.CSSProperties = { padding: '10px 8px', color: '#8c8c8c', fontWeight: 500, fontSize: 13, textAlign: 'center', background: '#fafafa', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid #f5f5f5' };

  const cellStat = (v: { points: number; count: number } | undefined) => v && v.count > 0 ? (
    <div>
      <div style={{ color: v.points < 0 ? '#ef4444' : '#1677ff', fontWeight: 700 }}>{v.points}</div>
      <div style={{ color: '#bbb', fontSize: 11 }}>{v.count}次</div>
    </div>
  ) : <span style={{ color: '#ddd' }}>—</span>;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>积分明细</div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>配置积分系数，查看由绩效考核自动生成的积分明细，支持手动奖惩。</div>
        </div>
      </div>

      {/* 积分系数设置 */}
      <Card size="small" title={<span><SettingOutlined style={{ color: '#fa8c16', marginRight: 8 }} />积分系数设置</span>}
        extra={<Space size={8}>
          <Button size="small" icon={<SettingOutlined />} onClick={() => { setMgrSelected(managers); setMgrModalOpen(true); }}>负责人设置</Button>
          {/* 按键采用动作语义：可编辑态显示「锁定」（点击后锁定），已锁定态显示「编辑」（点击后开启编辑） */}
          <Button size="small" icon={coeffLocked ? <UnlockOutlined /> : <LockOutlined />}
            disabled={!isManager && !coeffLocked}
            onClick={() => {
              if (!isManager) { message.warning('您不是负责人，无法编辑积分系数'); return; }
              const next = !coeffLocked; setCoeffLocked(next); if (next) message.info('积分系数已锁定'); else message.info('积分系数编辑已开启');
            }}>
            {coeffLocked ? '编辑' : '锁定'}
          </Button>
        </Space>}>
        <p style={{ fontSize: 12, color: '#999', marginTop: 0, marginBottom: 16 }}>
          配置每个考核项目的积分系数。保存薪资到历史时，自动按「实际值 × 系数」计算积分并写入积分明细列表。系数为0则不生成积分。
          {!isManager && <Tag color="orange" style={{ marginLeft: 8 }}>仅负责人可编辑</Tag>}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {scoreColumns.map((col, idx) => {
            const item = SCORE_ITEM_OPTIONS.find(o => o.key === col);
            const label = item?.label || col;
            const source = item?.source || '';
            const coeff = pointCoefficients[col] ?? 0;
            const bgColor = COL_COLORS[idx % COL_COLORS.length];
            const textColor = COL_TEXT_COLORS[idx % COL_TEXT_COLORS.length];
            return (
              <div key={col} style={{ padding: '16px 20px', background: bgColor, borderRadius: 10, border: `1px solid ${textColor}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: textColor }}>{label}</span>
                  <span style={{ fontSize: 11, color: '#999', background: '#fff', padding: '2px 8px', borderRadius: 4 }}>来源：{source}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#666', fontSize: 13, flexShrink: 0 }}>实际值</span>
                  <span style={{ color: textColor, fontWeight: 700, fontSize: 18, flexShrink: 0 }}>×</span>
                  <span style={{ color: '#666', fontSize: 13, flexShrink: 0 }}>系数</span>
                  <InputNumber
                    size="middle"
                    style={{ width: 90, flexShrink: 0 }}
                    step={0.1}
                    min={0}
                    value={coeff}
                    disabled={coeffLocked || !isManager}
                    onChange={v => {
                      const next = { ...pointCoefficients, [col]: Number(v) || 0 };
                      setPointCoefficients(next);
                      localStorage.setItem(COEFF_KEY, JSON.stringify(next));
                    }}
                  />
                  <span style={{ color: '#666', fontSize: 13, flexShrink: 0 }}>= 积分</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 运营积分统计 */}
      <Card
        size="small"
        title={<span><BarChartOutlined style={{ color: '#1677ff', marginRight: 8 }} />运营积分统计</span>}
        extra={<span style={{ fontSize: 13, color: '#666' }}>合计 <span style={{ color: '#16a34a', fontWeight: 800, fontSize: 18 }}>{Math.round(staffStats.grand)}</span> 总积分</span>}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 16, minWidth: 140 }}>运营人员</th>
                {ACTION_TYPE_OPTIONS.map(c => <th key={c.value} style={thStyle}>{c.label}</th>)}
                <th style={thStyle}>总积分</th>
              </tr>
            </thead>
            <tbody>
              {staffStats.rows.map(row => (
                <tr key={row.key} style={{ background: '#fff' }}>
                  <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 16 }}>
                    <Space size={8}>
                      <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#1677ff', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{row.name[0]}</span>
                      <span style={{ fontWeight: 600 }}>{row.name}</span>
                    </Space>
                  </td>
                  {ACTION_TYPE_OPTIONS.map(c => <td key={c.value} style={tdStyle}>{cellStat(row.byType.get(c.value))}</td>)}
                  <td style={{ ...tdStyle, color: '#1677ff', fontWeight: 800 }}>{Math.round(row.total)}</td>
                </tr>
              ))}
              <tr style={{ background: '#fafafa', fontWeight: 700 }}>
                <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 16 }}>汇总</td>
                {ACTION_TYPE_OPTIONS.map(c => <td key={c.value} style={tdStyle}>{cellStat(staffStats.sums.get(c.value))}</td>)}
                <td style={{ ...tdStyle, color: '#16a34a', fontWeight: 800 }}>{Math.round(staffStats.grand)}</td>
              </tr>
              {!staffStats.rows.length && <tr><td colSpan={ACTION_TYPE_OPTIONS.length + 2} style={{ ...tdStyle, color: '#999', padding: 24 }}>暂无运营人员，请先在账号管理创建子账号</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 积分列表 */}
      <Card size="small" title={<span><FileTextOutlined style={{ color: '#722ed1', marginRight: 8 }} />积分列表</span>}>
        <Space wrap align="end" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>运营人员</div>
            <Select style={{ width: 130 }} placeholder="全部" allowClear value={fStaff || undefined} onChange={v => setFStaff(v || '')} options={staffList.map(s => ({ value: s.name, label: s.name }))} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>类型</div>
            <Select style={{ width: 130 }} placeholder="全部类型" allowClear value={fType || undefined} onChange={v => setFType(v || '')} options={ACTION_TYPE_OPTIONS} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>月份</div>
            <DatePicker picker="month" style={{ width: 130 }} placeholder="全部月份" value={fMonth ? dayjs(fMonth) : null} onChange={d => setFMonth(d ? d.format('YYYY-MM') : '')} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>开始日期</div>
            <DatePicker value={fFrom ? dayjs(fFrom) : null} onChange={d => setFFrom(d ? d.format('YYYY-MM-DD') : '')} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>结束日期</div>
            <DatePicker value={fTo ? dayjs(fTo) : null} onChange={d => setFTo(d ? d.format('YYYY-MM-DD') : '')} />
          </div>
          <Button type="primary" icon={<SearchOutlined />} onClick={() => { setAStaff(fStaff); setAType(fType); setAMonth(fMonth); setAFrom(fFrom); setATo(fTo); }}>查询</Button>
          <Button icon={<UndoOutlined />} onClick={() => { setFStaff(''); setFType(''); setFMonth(''); setFFrom(''); setFTo(''); setAStaff(''); setAType(''); setAMonth(''); setAFrom(''); setATo(''); }}>重置</Button>
          <Button type="primary" style={{ background: '#fa8c16', borderColor: '#fa8c16' }} icon={<GiftOutlined />} onClick={() => setAdjustOpen(true)}>积分奖惩</Button>
          <Tag color="purple" style={{ marginLeft: 8 }}>合计 {Math.round(filteredRecords.reduce((s, r) => s + r.points, 0))} 积分 · 共 {filteredRecords.length} 条</Tag>
        </Space>
        <Table rowKey="id" bordered size="middle" pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          dataSource={filteredRecords}
          locale={{ emptyText: '暂无积分记录，点击「积分奖惩」登记或在绩效考核中保存薪资自动生成' }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 130, align: 'center', render: (v: string) => dayjs(v).format('MM/DD HH:mm') },
            { title: '月份', key: 'month', width: 90, align: 'center', render: (_: any, r: DevPointRecord) => { const m = (r.actionTitle || '').substring(0, 7); return m || dayjs(r.createdAt).format('YYYY-MM'); } },
            { title: '运营人员', dataIndex: 'staffName', width: 100, align: 'center' },
            { title: '类型', dataIndex: 'actionType', width: 100, align: 'center', render: (v: string) => <Tag color="blue">{typeLabel(v)}</Tag> },
            { title: '积分值', dataIndex: 'points', width: 80, align: 'center', render: (v: number) => <span style={{ color: v >= 0 ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{v > 0 ? `+${v}` : v}</span> },
            { title: '原因/备注', dataIndex: 'reason', width: 180, align: 'center', render: (v: string) => v || '—' },
          ] as any}
        />
      </Card>

      <Modal title="积分奖惩" open={adjustOpen} onOk={handleAdjust} onCancel={() => setAdjustOpen(false)} okText="确定" cancelText="取消" width={480} destroyOnClose>
        <Form autoComplete="off" form={adjustForm} layout="vertical" style={{ marginTop: 12 }} initialValues={{ type: 'reward' }}>
          <Form.Item name="staffId" label="运营人员" rules={[{ required: true, message: '请选择运营人员' }]}>
            <Select placeholder="选择子账号运营人员" options={staffList.map(s => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Radio.Group options={[{ value: 'reward', label: '手动奖励' }, { value: 'penalty', label: '手动扣除' }]} optionType="button" />
          </Form.Item>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="points" label="积分值" rules={[{ required: true, message: '请输入积分' }]} style={{ width: 140 }}>
              <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} placeholder="正数" />
            </Form.Item>
            <Form.Item name="orderNo" label="订单号（选填）" style={{ width: 150 }}>
              <Input maxLength={30} />
            </Form.Item>
            <Form.Item name="buyerName" label="买家名称（选填）" style={{ width: 150 }}>
              <Input maxLength={30} />
            </Form.Item>
          </Space>
          <Form.Item name="reason" label="原因/备注">
            <Input placeholder="选填" maxLength={50} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 负责人设置弹窗 */}
      <Modal title="负责人设置" open={mgrModalOpen} onCancel={() => setMgrModalOpen(false)}
        onOk={() => {
          if (!isMain) { message.warning('仅管理员可修改负责人设置'); return; }
          setManagers(mgrSelected);
          localStorage.setItem(managersKey, JSON.stringify(mgrSelected));
          message.success('负责人已保存');
          setMgrModalOpen(false);
        }}
        okText="保存" cancelText="取消" width={480} destroyOnClose>
        <div style={{ padding: '12px 0' }}>
          <p style={{ color: '#666', fontSize: 12, margin: '0 0 12px' }}>设置可编辑积分系数的负责人。未设置时所有人员均可编辑；设置后仅负责人和管理员可操作。此设置与积分兑换页共享。</p>
          <Select mode="multiple" style={{ width: '100%' }} placeholder="选择负责人（留空则所有人可操作）"
            value={mgrSelected} onChange={v => setMgrSelected(v)}
            disabled={!isMain}
            options={staffList.map(s => ({ value: s.id, label: s.name }))} />
          {!isMain && <div style={{ marginTop: 8, padding: '6px 10px', background: '#fff7ed', borderRadius: 6, color: '#d46b08', fontSize: 12 }}>仅管理员可修改负责人设置</div>}
        </div>
      </Modal>
    </div>
  );
};

export default DevActionPointsPage;
