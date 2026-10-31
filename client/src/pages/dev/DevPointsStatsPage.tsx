import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Space, Select, DatePicker, Modal, Tag, message, Popconfirm, Image, Form, Input, InputNumber } from 'antd';
import { GiftOutlined, UndoOutlined, SearchOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ImageSlot from '../../components/ImageSlot';
import {
  loadDevRewards, saveDevRewards, loadDevRedeems, saveDevRedeems, loadPointRecords, getDevIdentity, loadDevStaffList,
  loadPlatformRewards, savePlatformRewards, loadPlatformRedeems, savePlatformRedeems,
  loadPlatformPointRecords, loadPlatformStaffList,
} from '../../utils/devStore';
import type { DevReward, DevRedeem, AnalyticsPlatform } from '../../utils/devStore';

const PERIOD_OPTIONS = [
  { value: 'thisMonth', label: '本月汇总' },
  { value: 'last3Months', label: '最近3个月' },
  { value: 'thisYear', label: '今年汇总' },
];

const inPeriod = (dateStr: string, period: string): boolean => {
  const d = dayjs(dateStr);
  const now = dayjs();
  if (period === 'thisMonth') return d.isSame(now, 'month');
  if (period === 'last3Months') return d.isAfter(now.subtract(3, 'month').startOf('month')) && !d.isAfter(now);
  return d.isSame(now, 'year');
};

// IndexedDB 奖品图片存储
const openImgDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open('dev_reward_images', 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('imgs')) req.result.createObjectStore('imgs'); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const putImg = async (key: string, dataUrl: string) => {
  const db = await openImgDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('imgs', 'readwrite');
    tx.objectStore('imgs').put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// 开发者后台 - 业绩分析 - 积分兑换（参考 my-crm customers/points-stats：积分汇总 + 奖品兑换 + 兑换记录审批）
const DevPointsStatsPage: React.FC<{ platform?: AnalyticsPlatform }> = ({ platform = 'dev' }) => {
  const identity = platform === 'dev' ? getDevIdentity() : { user: localStorage.getItem('username') || '', name: localStorage.getItem('displayName') || localStorage.getItem('username') || '', isSub: false, parent: '' };
  const isMain = platform === 'dev' ? identity.user === 'dev' : localStorage.getItem('isSubAccount') !== 'true';
  // 负责人设置
  const owner = useMemo(() => {
    if (platform === 'dev') return 'dev';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || identity.user) : identity.user;
  }, [platform, identity.user]);
  const managersKey = `points_managers_${owner}`;
  const [managers, setManagers] = useState<string[]>([]);
  const [mgrModalOpen, setMgrModalOpen] = useState(false);
  const [mgrSelected, setMgrSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState('thisMonth');
  const [rewards, setRewards] = useState<DevReward[]>([]);
  const [redeems, setRedeems] = useState<DevRedeem[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [redeemModal, setRedeemModal] = useState(false);
  // 新增奖品
  const [addRewardOpen, setAddRewardOpen] = useState(false);
  const [rewardForm] = Form.useForm();
  const [rewardImage, setRewardImage] = useState<string>('');
  // 兑换记录筛选
  const [rStaff, setRStaff] = useState(''); const [rStatus, setRStatus] = useState('');
  const [rFrom, setRFrom] = useState(''); const [rTo, setRTo] = useState('');

  // 判断是否为负责人（管理员或负责人列表中的人员）
  const isManager = useMemo(() => {
    if (isMain) return true;
    if (managers.length === 0) return true; // 未设置负责人时所有人都可操作
    return managers.includes(identity.user);
  }, [isMain, managers, identity.user]);

  const load = useCallback(() => {
    setRewards(platform === 'dev' ? loadDevRewards() : loadPlatformRewards(platform));
    setRedeems(platform === 'dev' ? loadDevRedeems() : loadPlatformRedeems(platform));
    // 加载负责人设置
    try { setManagers(JSON.parse(localStorage.getItem(managersKey) || '[]')); } catch { /* ignore */ }
  }, [platform, managersKey]);
  useEffect(() => { load(); }, [load]);

  const staffList = useMemo(() => loadPlatformStaffList(platform), [platform]);
  const records = useMemo(() => platform === 'dev' ? loadPointRecords() : loadPlatformPointRecords(platform), [redeems, period, platform]);

  // 每人积分汇总（周期内获得 = 动作积分记录合计；已兑换/可用结合兑换记录）
  const stats = useMemo(() => staffList.map(s => {
    const recs = records.filter(r => r.staffName === s.name && inPeriod(r.createdAt, period));
    const rewardPoints = recs.filter(r => r.points > 0).reduce((a, r) => a + r.points, 0);
    const penaltyPoints = recs.filter(r => r.points < 0).reduce((a, r) => a + r.points, 0);
    const totalPoints = rewardPoints + penaltyPoints;
    const myRedeems = redeems.filter(r => r.username === s.id);
    const redeemedPoints = myRedeems.filter(r => r.status === '已兑换').reduce((a, r) => a + r.points, 0);
    const pendingPoints = myRedeems.filter(r => r.status === '待审批').reduce((a, r) => a + r.points, 0);
    const allTimeEarned = records.filter(r => r.staffName === s.name).reduce((a, r) => a + r.points, 0);
    return {
      key: s.id, staffName: s.name,
      totalPoints, recordCount: recs.length, rewardPoints, penaltyPoints,
      redeemedPoints, redeemCount: myRedeems.filter(r => r.status === '已兑换').length,
      allTimeEarned, availablePoints: allTimeEarned - redeemedPoints - pendingPoints,
    };
  }), [staffList, records, redeems, period]);

  const shown = selectedStaff ? stats.filter(s => s.key === selectedStaff) : stats;
  const totalEarned = shown.reduce((s, x) => s + x.totalPoints, 0);
  const totalRedeemed = shown.reduce((s, x) => s + x.redeemedPoints, 0);
  const totalAvailable = shown.reduce((s, x) => s + x.availablePoints, 0);

  const myAvailable = stats.find(s => s.key === identity.user)?.availablePoints ?? 0;

  const handleRedeem = (r: DevReward) => {
    if (myAvailable < r.pointsCost) { message.error(`积分不足：可用 ${myAvailable.toFixed(1)}，需要 ${r.pointsCost}`); return; }
    if (r.stock === 0) { message.error('该奖品库存不足'); return; }
    Modal.confirm({
      title: '确认兑换',
      content: `确定使用 ${r.pointsCost} 积分兑换「${r.name}」吗？兑换后将进入待审批状态。`,
      okText: '确认兑换',
      cancelText: '取消',
      onOk: () => {
        const entry: DevRedeem = {
          id: `rd_${Date.now()}`, rewardId: r.id, rewardName: r.name,
          username: identity.user, displayName: identity.name,
          points: r.pointsCost, status: '待审批', createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
        };
        platform === 'dev' ? saveDevRedeems([entry, ...loadDevRedeems()]) : savePlatformRedeems(platform, [entry, ...loadPlatformRedeems(platform)]);
        message.success(`兑换申请已提交，等待审批（冻结 ${r.pointsCost} 积分）`);
        setRedeemModal(false);
        load();
      },
    });
  };

  const handleApprove = (rec: DevRedeem, ok: boolean) => {
    platform === 'dev'
      ? saveDevRedeems(loadDevRedeems().map(x => x.id === rec.id ? { ...x, status: ok ? '已兑换' as const : '已拒绝' as const, handledBy: identity.name } : x))
      : savePlatformRedeems(platform, loadPlatformRedeems(platform).map(x => x.id === rec.id ? { ...x, status: ok ? '已兑换' as const : '已拒绝' as const, handledBy: identity.name } : x));
    if (ok) {
      platform === 'dev'
        ? saveDevRewards(loadDevRewards().map(r => r.id === rec.rewardId && r.stock > 0 ? { ...r, stock: r.stock - 1 } : r))
        : savePlatformRewards(platform, loadPlatformRewards(platform).map(r => r.id === rec.rewardId && r.stock > 0 ? { ...r, stock: r.stock - 1 } : r));
    }
    message.success(ok ? `已通过 ${rec.displayName} 兑换「${rec.rewardName}」` : `已驳回 ${rec.displayName} 的兑换申请，积分已退回`);
    load();
  };

  const filteredRedeems = redeems.filter(r =>
    (!rStaff || r.displayName === rStaff) && (!rStatus || r.status === rStatus) &&
    (!rFrom || r.createdAt >= rFrom) && (!rTo || r.createdAt <= rTo + ' 23:59'));

  const statColumns: any[] = [
    { title: '子账号', dataIndex: 'staffName', width: 120, render: (v: string, row: any) => <span style={{ fontWeight: 600, cursor: 'pointer', color: row.key === selectedStaff ? '#1677ff' : '#333' }} onClick={() => setSelectedStaff(row.key === selectedStaff ? null : row.key)}>{v}</span> },
    { title: '获得积分', dataIndex: 'totalPoints', align: 'center', render: (v: number) => <span style={{ color: '#1677ff', fontWeight: 700 }}>{v.toFixed(1)}</span> },
    { title: '积分次数', dataIndex: 'recordCount', align: 'center' },
    { title: '奖励', dataIndex: 'rewardPoints', align: 'center', render: (v: number) => <span style={{ color: '#16a34a', fontWeight: 600 }}>{v.toFixed(1)}</span> },
    { title: '惩罚', dataIndex: 'penaltyPoints', align: 'center', render: (v: number) => <span style={{ color: '#ef4444', fontWeight: 600 }}>{v.toFixed(1)}</span> },
    { title: '已兑换', dataIndex: 'redeemedPoints', align: 'center', render: (v: number) => <span style={{ color: '#ca8a04' }}>{v.toFixed(1)}</span> },
    { title: '兑换次数', dataIndex: 'redeemCount', align: 'center' },
    { title: '历史总积分', dataIndex: 'allTimeEarned', align: 'center', render: (v: number) => <span style={{ color: '#9333ea', fontWeight: 600 }}>{v.toFixed(1)}</span> },
    { title: '可用积分', dataIndex: 'availablePoints', align: 'center', render: (v: number) => <span style={{ color: '#16a34a', fontWeight: 700 }}>{v.toFixed(1)}</span> },
  ];

  const redeemColumns: any[] = [
    { title: '兑换人', dataIndex: 'displayName', width: 100, align: 'center' },
    { title: '奖品', dataIndex: 'rewardName', width: 150, align: 'center' },
    { title: '消耗积分', dataIndex: 'points', width: 90, align: 'center', render: (v: number) => <span style={{ color: '#ca8a04', fontWeight: 600 }}>{v}</span> },
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center',
      render: (v: string) => v === '待审批' ? <Tag color="gold">待审批</Tag> : v === '已兑换' ? <Tag color="green">已通过</Tag> : <Tag color="red">已驳回</Tag>,
    },
    { title: '时间', dataIndex: 'createdAt', width: 140, align: 'center' },
    { title: '审批人', dataIndex: 'handledBy', width: 100, align: 'center', render: (v: string) => v || '-' },
    ...(isManager ? [{
      title: '操作', key: 'op', width: 130, align: 'center',
      render: (_: any, r: DevRedeem) => r.status === '待审批' ? (
        <Space size={4}>
          <Popconfirm title={`确定通过该兑换申请？`} onConfirm={() => handleApprove(r, true)}><Button size="small" type="primary" style={{ background: '#16a34a', color: '#fff' }}>通过</Button></Popconfirm>
          <Popconfirm title="驳回后积分将退回用户账户" onConfirm={() => handleApprove(r, false)}><Button size="small" danger>驳回</Button></Popconfirm>
        </Space>
      ) : '—',
    }] : []),
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="积分统计"
        extra={
          <Space>
            {!isMain && <Tag color="purple" style={{ fontSize: 13, padding: '4px 10px' }}>我的可用积分：{myAvailable.toFixed(1)}</Tag>}
            <Button type="primary" icon={<GiftOutlined />} onClick={() => setRedeemModal(true)}>积分兑换</Button>
          </Space>
        }
      >
        <p style={{ color: '#999', fontSize: 12, marginTop: 0 }}>各子账号积分汇总，积分兑换不影响绩效考核</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>本周期获得积分{selectedStaff && <span style={{ marginLeft: 8, color: '#1e40af' }}>「{stats.find(s => s.key === selectedStaff)?.staffName}」</span>}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#1d4ed8' }}>{totalEarned.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>{selectedStaff ? <Button type="link" size="small" onClick={() => setSelectedStaff(null)}>← 查看全部汇总</Button> : `${stats.length} 个子账号`}</div>
          </div>
          <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#ca8a04', fontWeight: 600 }}>已兑换积分</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#a16207' }}>{totalRedeemed.toFixed(1)}</div>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>可用积分合计</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#15803d' }}>{totalAvailable.toFixed(1)}</div>
          </div>
        </div>

        <Space style={{ marginBottom: 12 }}>
          {PERIOD_OPTIONS.map(opt => (
            <Button key={opt.value} size="small" type={period === opt.value ? 'primary' : 'default'} onClick={() => setPeriod(opt.value)}>{opt.label}</Button>
          ))}
        </Space>
        <Table rowKey="key" bordered size="middle" columns={statColumns} dataSource={stats} pagination={false} locale={{ emptyText: '暂无子账号，请先在账号管理创建' }} />

        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700 }}>奖品展示</span>
            <Space size={8}>
              {isMain && <Button size="small" icon={<SettingOutlined />} onClick={() => { setMgrSelected(managers); setMgrModalOpen(true); }}>负责人设置</Button>}
              {isMain && <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { rewardForm.resetFields(); setRewardImage(''); setAddRewardOpen(true); }}>新增奖品</Button>}
            </Space>
          </div>
          {rewards.length === 0 ? (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: '28px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>暂无奖品，请前往「系统设置 - 积分兑换奖品」添加</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 300px))', gap: 16 }}>
              {rewards.map(r => (
                <div key={r.id} style={{ border: '1px solid #f0f0f0', borderRadius: 12, overflow: 'hidden', opacity: r.isActive ? 1 : 0.5, display: 'flex', flexDirection: 'column' }}>
                  {r.imageKey ? <RewardImg imageKey={r.imageKey} /> : <div style={{ width: '100%', aspectRatio: '1/1', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>暂无图片</div>}
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                    {r.description && <div style={{ fontSize: 11, color: '#999' }}>{r.description}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 6, borderTop: '1px solid #f5f5f5' }}>
                      <span style={{ color: '#ca8a04', fontWeight: 700, fontSize: 13 }}>{r.pointsCost} 积分</span>
                      <Button type="primary" size="small" disabled={!r.isActive || r.stock === 0 || myAvailable < r.pointsCost} onClick={() => handleRedeem(r)} style={{ background: (!r.isActive || r.stock === 0 || myAvailable < r.pointsCost) ? '#d9d9d9' : '#16a34a', borderColor: (!r.isActive || r.stock === 0 || myAvailable < r.pointsCost) ? '#d9d9d9' : '#16a34a', color: '#fff' }}>
                        {!r.isActive ? '已下架' : r.stock === 0 ? '库存不足' : myAvailable < r.pointsCost ? '积分不足' : '兑换奖品'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>兑换记录</div>
          <Space wrap style={{ marginBottom: 10 }}>
            <Select style={{ width: 120 }} placeholder="兑换人" allowClear size="small" value={rStaff || undefined} onChange={v => setRStaff(v || '')} options={Array.from(new Set(redeems.map(r => r.displayName))).map(n => ({ value: n, label: n }))} />
            <Select style={{ width: 110 }} placeholder="状态" allowClear size="small" value={rStatus || undefined} onChange={v => setRStatus(v || '')} options={[{ value: '待审批', label: '待审批' }, { value: '已兑换', label: '已通过' }, { value: '已拒绝', label: '已驳回' }]} />
            <DatePicker size="small" value={rFrom ? dayjs(rFrom) : null} onChange={d => setRFrom(d ? d.format('YYYY-MM-DD') : '')} />
            <DatePicker size="small" value={rTo ? dayjs(rTo) : null} onChange={d => setRTo(d ? d.format('YYYY-MM-DD') : '')} />
            {(rStaff || rStatus || rFrom || rTo) && <Button size="small" icon={<UndoOutlined />} onClick={() => { setRStaff(''); setRStatus(''); setRFrom(''); setRTo(''); }}>重置</Button>}
            <span style={{ fontSize: 12, color: '#999' }}>共 {filteredRedeems.length} 条</span>
          </Space>
          <Table rowKey="id" bordered size="middle" columns={redeemColumns}
            dataSource={isMain ? filteredRedeems : filteredRedeems.filter(r => r.username === identity.user)}
            pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }} locale={{ emptyText: '暂无兑换记录' }} />
        </div>
      </Card>

      <Modal title="积分兑换" open={redeemModal} onCancel={() => setRedeemModal(false)} width={560}
        footer={<Button onClick={() => setRedeemModal(false)}>关闭</Button>}>
        {rewards.filter(r => r.isActive).length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '36px 0' }}>暂无可兑换奖品，请联系管理员添加</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {rewards.filter(r => r.isActive).map(r => (
              <div key={r.id} style={{ border: '1px solid #f0f0f0', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                {r.description && <div style={{ fontSize: 12, color: '#999' }}>{r.description}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#ca8a04', fontWeight: 700 }}>{r.pointsCost} 积分</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{r.stock === -1 ? '不限库存' : `库存 ${r.stock}`}</span>
                </div>
                <Button type="primary" disabled={r.stock === 0 || myAvailable < r.pointsCost} onClick={() => handleRedeem(r)}>
                  {r.stock === 0 ? '库存不足' : myAvailable < r.pointsCost ? '积分不足' : '立即兑换'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 新增奖品弹窗 */}
      <Modal title="新增奖品" open={addRewardOpen} onCancel={() => setAddRewardOpen(false)}
        onOk={() => rewardForm.validateFields().then(async values => {
          const name = String(values.name || '').trim();
          if (!name) return;
          let imageKey = '';
          if (rewardImage && rewardImage.startsWith('data:')) {
            imageKey = `reward_${Date.now()}`;
            try { await putImg(imageKey, rewardImage); } catch { message.error('图片保存失败'); return; }
          }
          const entry: DevReward = {
            id: `rw_${Date.now()}`, name, description: values.description || '',
            pointsCost: Number(values.pointsCost) || 0,
            stock: values.stock === undefined || values.stock === null ? -1 : Number(values.stock),
            sortOrder: 0, imageKey, isActive: true,
            createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
          };
          const list = platform === 'dev' ? loadDevRewards() : loadPlatformRewards(platform);
          if (platform === 'dev') saveDevRewards([...list, entry]); else savePlatformRewards(platform, [...list, entry]);
          message.success(`奖品「${name}」已添加`);
          setAddRewardOpen(false);
          setRewardImage('');
          load();
        }).catch(() => message.warning('请完善奖品信息'))}
        okText="保存" cancelText="取消" width={520} destroyOnClose>
        <Form form={rewardForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="奖品名称" rules={[{ required: true, message: '请输入奖品名称' }]}>
            <Input placeholder="如：星巴克咖啡券" maxLength={30} />
          </Form.Item>
          <Form.Item name="description" label="奖品描述">
            <Input.TextArea rows={2} placeholder="选填" maxLength={100} />
          </Form.Item>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="pointsCost" label="所需积分" rules={[{ required: true, message: '请输入' }]} style={{ width: 140 }}>
              <InputNumber min={1} step={10} style={{ width: '100%' }} placeholder="100" />
            </Form.Item>
            <Form.Item name="stock" label="库存数量" style={{ width: 140 }}>
              <InputNumber min={-1} step={1} style={{ width: '100%' }} placeholder="-1=不限" />
            </Form.Item>
          </Space>
          <Form.Item label="奖品图片（选填）">
            <ImageSlot value={rewardImage} onChange={v => setRewardImage(v)} size={120} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 负责人设置弹窗 */}
      <Modal title="负责人设置" open={mgrModalOpen} onCancel={() => setMgrModalOpen(false)}
        onOk={() => {
          setManagers(mgrSelected);
          localStorage.setItem(managersKey, JSON.stringify(mgrSelected));
          message.success('负责人已保存');
          setMgrModalOpen(false);
        }}
        okText="保存" cancelText="取消" width={480} destroyOnClose>
        <div style={{ padding: '12px 0' }}>
          <p style={{ color: '#666', fontSize: 12, margin: '0 0 12px' }}>设置可审核兑换申请和新增奖品的负责人。未设置时所有人员均可操作；设置后仅负责人和管理员可操作。</p>
          <Select mode="multiple" style={{ width: '100%' }} placeholder="选择负责人（留空则所有人可操作）"
            value={mgrSelected} onChange={v => setMgrSelected(v)}
            options={staffList.map(s => ({ value: s.id, label: s.name }))} />
        </div>
      </Modal>
    </div>
  );
};

// 奖品图片（IndexedDB dev_reward_images）
const RewardImg: React.FC<{ imageKey: string }> = ({ imageKey }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const req = indexedDB.open('dev_reward_images', 1);
          req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('imgs')) req.result.createObjectStore('imgs'); };
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const val = await new Promise<string | null>(res => {
          const tx = db.transaction('imgs', 'readonly');
          const rq = tx.objectStore('imgs').get(imageKey);
          rq.onsuccess = () => res(rq.result || null);
          rq.onerror = () => res(null);
        });
        if (alive) setUrl(val);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [imageKey]);
  if (!url) return <div style={{ width: '100%', aspectRatio: '1/1', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>加载中…</div>;
  return <Image src={url} alt="" width="100%" style={{ aspectRatio: '1/1', objectFit: 'cover' }} preview={{ mask: '查看大图' }} />;
};

export default DevPointsStatsPage;
